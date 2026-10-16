"""사용자가 확인한 실제 문단만 채우는 독립 엔진. 공식 평가계획 양식은 수정하지 않는다."""
import hashlib
import io
import json
import re
import sys
import zipfile
import zlib
from datetime import date
from pathlib import Path
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collections"))
import _hwpx_basic as basic

LIMITS = json.loads((Path(__file__).parent / "_assets/guided-limits.json").read_text(encoding="utf-8"))
HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
SECTION = re.compile(r"Contents/section(\d+)\.xml")
KINDS = ("text", "longtext", "number", "date", "select")


class MappingError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise MappingError("INVALID_INPUT")


def text(value, maximum, required=False):
    if (not isinstance(value, str) or len(value) > maximum or
        re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]", value) or
        (required and not value.strip())):
        raise MappingError("INVALID_INPUT")
    return value


def _sections(raw):
    basic.inspect_hwpx(raw)
    archive = zipfile.ZipFile(io.BytesIO(raw))
    try:
        names = sorted((name for name in archive.namelist() if SECTION.fullmatch(name)), key=lambda name: int(SECTION.fullmatch(name)[1]))
        if not names:
            raise MappingError("UNSUPPORTED_TEMPLATE")
        trees = {}
        for name in names:
            try:
                source = archive.read(name)
            except (zipfile.BadZipFile, EOFError, RuntimeError, NotImplementedError, zlib.error):
                # 목록 검사 뒤 발견된 CRC·압축 오류는 미확정 서버 작업이 아니라 잘못된 원본이다.
                raise MappingError("UNSUPPORTED_TEMPLATE") from None
            if len(source) > LIMITS["maxXmlBytes"] or b"<!DOCTYPE" in source.upper() or b"<!ENTITY" in source.upper():
                raise MappingError("UNSUPPORTED_TEMPLATE")
            try:
                root = etree.fromstring(source, etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, remove_blank_text=False))
            except (etree.XMLSyntaxError, ValueError):
                raise MappingError("UNSUPPORTED_TEMPLATE") from None
            if root.getroottree().docinfo.doctype or sum(1 for _ in root.iter()) > LIMITS["maxXmlNodes"]:
                raise MappingError("UNSUPPORTED_TEMPLATE")
            trees[name] = root
        return archive, trees
    except Exception:
        archive.close()
        raise


def _anchors(trees):
    result, targets, skipped = [], {}, 0
    for name, root in trees.items():
        paragraphs = list(root.iter("{" + HP + "}p"))
        for index, paragraph in enumerate(paragraphs):
            runs = paragraph.findall("{" + HP + "}run")
            # 필드·그림·다중 run·복합 제어는 추측해 고치지 않는다. 줄 배치는 HWP가 다시 계산한다.
            runs_only = all(child.tag in ("{" + HP + "}run", "{" + HP + "}linesegarray") for child in paragraph)
            if not runs_only or len(runs) != 1 or len(runs[0]) != 1 or runs[0][0].tag != "{" + HP + "}t" or any(child.tag != "{" + HP + "}lineBreak" or len(child) or child.attrib or child.text for child in runs[0][0]):
                skipped += 1
                continue
            node = runs[0][0]
            source = (node.text or "") + "".join("\n" + (child.tail or "") for child in node)
            if len(source) > LIMITS["maxSourceCharacters"] or any(ord(c) < 32 and c not in "\n\t\r" for c in source):
                skipped += 1
                continue
            anchor = f"{name}:p{index:06d}"
            cell = next((parent for parent in paragraph.iterancestors() if parent.tag == "{" + HP + "}tc"), None)
            cell_address = None
            if cell is not None:
                address = cell.find("{" + HP + "}cellAddr")
                if address is not None:
                    cell_address = {"row": address.get("rowAddr", ""), "column": address.get("colAddr", "")}
            result.append({"id": anchor, "section": name, "paragraph": index, "sourceText": source, "sourceHash": hashlib.sha256(source.encode("utf-8")).hexdigest(), "cell": cell_address})
            targets[anchor] = (node, paragraph)
            if len(result) > LIMITS["maxAnchors"]:
                raise MappingError("UNSUPPORTED_TEMPLATE")
    return result, targets, skipped


def inspect_template(raw):
    archive, trees = _sections(raw)
    try:
        anchors, _, skipped = _anchors(trees)
        if not anchors:
            raise MappingError("UNSUPPORTED_TEMPLATE")
        return {"profile": LIMITS["profile"], "templateSha256": hashlib.sha256(raw).hexdigest(), "anchors": anchors, "unsupportedParagraphs": skipped}
    finally:
        archive.close()


def validate_mapping(mapping, inspection):
    exact(mapping, ("profile", "templateSha256", "questions"))
    questions = mapping["questions"]
    if mapping["profile"] != LIMITS["profile"] or mapping["templateSha256"] != inspection["templateSha256"]:
        raise MappingError("CONFLICT")
    if not isinstance(questions, list) or not 1 <= len(questions) <= LIMITS["maxQuestions"]:
        raise MappingError("INVALID_INPUT")
    by_id = {anchor["id"]: anchor for anchor in inspection["anchors"]}
    ids, anchors = set(), set()
    for question in questions:
        exact(question, ("id", "label", "kind", "required", "maxLength", "options", "anchorId", "sourceText", "sourceHash"))
        text(question["anchorId"], 120, True)
        if not basic._id(question["id"]) or question["id"] in ids or question["anchorId"] in anchors:
            raise MappingError("INVALID_INPUT")
        ids.add(question["id"])
        anchors.add(question["anchorId"])
        text(question["label"], 200, True)
        if question["kind"] not in KINDS or type(question["required"]) is not bool or type(question["maxLength"]) is not int or not 1 <= question["maxLength"] <= LIMITS["maxAnswerCharacters"]:
            raise MappingError("INVALID_INPUT")
        options = question["options"]
        if not isinstance(options, list) or len(options) > LIMITS["maxOptions"]:
            raise MappingError("INVALID_INPUT")
        for option in options:
            text(option, 200, True)
        if len(set(options)) != len(options):
            raise MappingError("INVALID_INPUT")
        if (question["kind"] == "select") != bool(options):
            raise MappingError("INVALID_INPUT")
        anchor = by_id.get(question["anchorId"])
        if not anchor or question["sourceText"] != anchor["sourceText"] or question["sourceHash"] != anchor["sourceHash"]:
            raise MappingError("CONFLICT")
    return mapping


def validate_answers(mapping, answers, complete=True):
    if not isinstance(answers, dict) or set(answers) - {q["id"] for q in mapping["questions"]}:
        raise MappingError("INVALID_INPUT")
    result = {}
    for question in mapping["questions"]:
        answer = text(answers.get(question["id"], ""), question["maxLength"], complete and question["required"])
        if answer:
            if question["kind"] == "number" and re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", answer) is None:
                raise MappingError("INVALID_INPUT")
            if question["kind"] == "date":
                try:
                    if date.fromisoformat(answer).isoformat() != answer:
                        raise ValueError()
                except ValueError:
                    raise MappingError("INVALID_INPUT") from None
            if question["kind"] == "select" and answer not in question["options"]:
                raise MappingError("INVALID_INPUT")
            if question["kind"] != "longtext" and ("\n" in answer or "\r" in answer):
                raise MappingError("INVALID_INPUT")
        result[question["id"]] = answer
    if sum(map(len, result.values())) > LIMITS["maxTotalAnswerCharacters"]:
        raise MappingError("INVALID_INPUT")
    return result


def fill_template(raw, mapping, answers):
    inspection = inspect_template(raw)
    validate_mapping(mapping, inspection)
    answers = validate_answers(mapping, answers)
    archive, trees = _sections(raw)
    try:
        anchors, targets, _ = _anchors(trees)
        changed_sections = set()
        for question in mapping["questions"]:
            node, paragraph = targets[question["anchorId"]]
            for child in list(node):
                node.remove(child)
            parts = answers[question["id"]].replace("\r\n", "\n").replace("\r", "\n").split("\n")
            node.text = parts[0]
            for part in parts[1:]:
                etree.SubElement(node, "{" + HP + "}lineBreak").tail = part
            # 캐시된 줄 위치를 남기면 입력한 새 문장 일부가 가려질 수 있다.
            for cache in paragraph.findall("{" + HP + "}linesegarray"):
                paragraph.remove(cache)
            changed_sections.add(question["anchorId"].split(":", 1)[0])
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as generated:
            for info in archive.infolist():
                content = archive.read(info.filename)
                if info.filename in changed_sections:
                    content = etree.tostring(trees[info.filename], encoding="UTF-8", xml_declaration=True)
                generated.writestr(info, content)
        result = output.getvalue()
        if len(result) > basic.LIMITS["maxFileBytes"]:
            raise MappingError("OUTPUT_TOO_LARGE")
        # ZIP와 XML을 다시 열고 선택하지 않은 문단까지 대조한다.
        reopened = inspect_template(result)
        after = {anchor["id"]: anchor["sourceText"] for anchor in reopened["anchors"]}
        expected = {anchor["id"]: anchor["sourceText"] for anchor in anchors}
        for question in mapping["questions"]:
            expected[question["anchorId"]] = answers[question["id"]].replace("\r\n", "\n").replace("\r", "\n")
        if expected != after:
            raise MappingError("OUTPUT_INVALID")
        return result
    finally:
        archive.close()
