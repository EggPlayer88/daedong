"""실제 생성·최소 검사 코드를 쓰는 합성 HWPX 자료. 운영 양식과 네트워크는 사용하지 않는다."""
import argparse
import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/main/api/workhub-documents"))
from _guided_hwpx import HP, MappingError, fill_template, inspect_template
import _hwpx_basic as basic


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def sample():
    paragraphs = ["교사 이름", "학급", "확인 내용", "학교 공통 안내: 수정하지 않는 문단"]
    xml = ('<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="' + HP + '">'
           + "".join('<hp:p id="' + str(index) + '"><hp:run><hp:t>' + text
                     + '</hp:t></hp:run></hp:p>' for index, text in enumerate(paragraphs))
           + '</hs:sec>').encode()
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w") as archive:
        # 고정 ZIP 날짜로 같은 입력의 바이트·해시를 반복 대조한다.
        for name, content in [("mimetype", b"application/hwp+zip"), ("Contents/section0.xml", xml),
                              ("Contents/content.hpf", b"<manifest/>"),
                              ("META-INF/container.xml", b"<container/>"),
                              ("BinData/original.bin", b"preserved-school-artifact")]:
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            archive.writestr(info, content)
    return result.getvalue()


def examine(raw):
    basic.inspect_hwpx(raw)
    result = inspect_template(raw)
    return {"sha256": digest(raw), "bytes": len(raw), "paragraphs": [a["sourceText"] for a in result["anchors"]]}


def fixture(count):
    raw = sample()
    inspection = inspect_template(raw)
    mapping = {"profile": "explicit_paragraph_v1", "templateSha256": inspection["templateSha256"], "questions": []}
    for index, (key, label, kind) in enumerate([("teacher", "교사 이름", "text"), ("class", "학급", "text"), ("note", "확인 내용", "longtext")]):
        anchor = inspection["anchors"][index]
        mapping["questions"].append({"id": key, "label": label, "kind": kind, "required": True,
            "maxLength": 1000, "options": [], "anchorId": anchor["id"], "sourceText": anchor["sourceText"], "sourceHash": anchor["sourceHash"]})

    def render(index, revision=1):
        name = f"가상교사 {index // 2 + 1:02d}"  # 동명이인을 포함한다. 식별은 번호로 한다.
        class_label = f"{index % 9 // 3 + 1}학년 {index % 3 + 1}반"
        member_id = f"pipeline-teacher-{index + 1:02d}"
        answers = {"teacher": name, "class": class_label,
                   "note": f"{member_id}의 {revision}판 확인\n<수업 준비> & 자료 점검 완료"}
        generated = fill_template(raw, mapping, answers)
        checked = examine(generated)
        assert checked["paragraphs"] == [answers["teacher"], answers["class"], answers["note"], "학교 공통 안내: 수정하지 않는 문단"]
        with zipfile.ZipFile(io.BytesIO(generated)) as archive:
            assert archive.read("BinData/original.bin") == b"preserved-school-artifact"
        assert fill_template(raw, mapping, answers) == generated
        return {"memberId": member_id, "name": name, "classLabel": class_label, "revision": revision, "answers": answers,
                "file": {"id": f"pipeline-file-{index + 1:02d}-v{revision}", "name": "응답.hwpx", "extension": "hwpx",
                         "bytes": len(generated), "sha256": digest(generated)},
                "base64": base64.b64encode(generated).decode(), "paragraphs": checked["paragraphs"]}

    rejections = []
    for label, bad in [("not_zip", b"not a HWPX file"), ("truncated", raw[:50]), ("wrong_mimetype", raw.replace(b"application/hwp+zip", b"application/bad+zip"))]:
        try:
            basic.inspect_hwpx(bad)
        except basic.FileRejected as error:
            rejections.append({"case": label, "code": error.code})
        else:
            raise AssertionError(label + " 파일을 거부하지 않았습니다")
    try:
        fill_template(raw, {**mapping, "templateSha256": "0" * 64}, {"teacher": "가상교사", "class": "1반", "note": "확인"})
    except MappingError as error:
        assert error.code == "CONFLICT"
        rejections.append({"case": "changed_template", "code": error.code})
    else:
        raise AssertionError("원본 해시가 다른 매핑을 거부하지 않았습니다")
    return {"notice": "합성 단순 문단 HWPX. 실제 한글 프로그램의 시각적 호환성 시험은 별도.",
            "template": {"name": "질문형 양식.hwpx", "base64": base64.b64encode(raw).decode(), "bytes": len(raw), "sha256": digest(raw)},
            "inspection": inspection, "mapping": mapping, "documents": [render(index) for index in range(count)],
            "correction": render(0, 2), "rejections": rejections}


def real_templates():
    """확정 양식은 읽기만 한다. 지원하는 문단 하나를 메모리 사본에서만 바꿔 보존 범위를 대조한다."""
    directory = Path(__file__).resolve().parents[2] / "apps/main/api/doc-ai/_assets"
    results = []
    for path in sorted(directory.glob("tpl-*.hwpx")):
        raw = path.read_bytes()
        original_sha = digest(raw)
        try:
            inspection = inspect_template(raw)
        except (MappingError, basic.FileRejected) as error:
            results.append({"name": path.name, "supported": False, "reason": error.code, "originalSha256": original_sha})
            continue
        if not inspection["anchors"]:
            results.append({"name": path.name, "supported": False, "reason": "NO_SUPPORTED_PARAGRAPH", "originalSha256": original_sha})
            continue
        anchor = inspection["anchors"][0]
        answer = "가상 문서 호환성 확인: <교사> & 1학년 1반"
        question = {"id": "compatibility", "label": "명시적으로 선택한 문단", "kind": "text", "required": True,
                    "maxLength": 1000, "options": [], "anchorId": anchor["id"], "sourceText": anchor["sourceText"], "sourceHash": anchor["sourceHash"]}
        mapping = {"profile": "explicit_paragraph_v1", "templateSha256": original_sha, "questions": [question]}
        generated = fill_template(raw, mapping, {"compatibility": answer})
        basic.inspect_hwpx(generated)
        after = inspect_template(generated)
        expected = {item["id"]: item["sourceText"] for item in inspection["anchors"]}
        expected[anchor["id"]] = answer
        assert {item["id"]: item["sourceText"] for item in after["anchors"]} == expected
        with zipfile.ZipFile(io.BytesIO(raw)) as before_zip, zipfile.ZipFile(io.BytesIO(generated)) as after_zip:
            assert before_zip.namelist() == after_zip.namelist()
            preserved = []
            for entry in before_zip.namelist():
                if entry != anchor["section"]:
                    assert before_zip.read(entry) == after_zip.read(entry), path.name + ": " + entry
                    preserved.append(entry)
            # 변경한 문단 외의 복합 표·제어·서식까지 같은 XML 구조인지 대조한다.
            trees = [etree.fromstring(archive.read(anchor["section"]),
                                     etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
                     for archive in (before_zip, after_zip)]
            for tree in trees:
                selected = list(tree.iter("{" + HP + "}p"))[anchor["paragraph"]]
                selected.getparent().remove(selected)
            assert etree.tostring(trees[0], method="c14n") == etree.tostring(trees[1], method="c14n"), path.name
        assert digest(path.read_bytes()) == original_sha, "확정 양식 파일은 변경하지 않아야 합니다"
        results.append({"name": path.name, "supported": True, "originalSha256": original_sha,
                        "generatedSha256": digest(generated), "anchorId": anchor["id"], "supportedParagraphs": len(inspection["anchors"]),
                        "unsupportedParagraphs": inspection["unsupportedParagraphs"], "preservedEntries": len(preserved),
                        "originalBytes": len(raw), "generatedBytes": len(generated)})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=36)
    parser.add_argument("--inspect-stdin", action="store_true")
    parser.add_argument("--real-templates", action="store_true")
    args = parser.parse_args()
    if args.real_templates:
        output = real_templates()
    elif args.inspect_stdin:
        # JS에서 만든 ZIP을 해제한 파일을 다시 실제 Python 검사기와 XML 추출기로 대조한다.
        values = json.loads(sys.stdin.read())
        output = [examine(base64.b64decode(value, validate=True)) for value in values]
    else:
        if not 1 <= args.count <= 36:
            parser.error("count는 1~36입니다")
        output = fixture(args.count)
    print(json.dumps(output, ensure_ascii=False))
