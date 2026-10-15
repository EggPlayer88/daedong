"""HWPX 본문 읽기 전용 추출. 그림·OCR·내용 추정과 양식 수정은 하지 않는다."""
import hashlib
import json
from pathlib import Path
from _guided_hwpx import _sections, HP, MappingError

LIMITS = json.loads((Path(__file__).parent / "_assets/knowledge-import-limits.json").read_text(encoding="utf-8"))
PROFILE = LIMITS["profile"]
MAX_TEXT = LIMITS["maxCharacters"]
MAX_BLOCKS = LIMITS["maxBlocks"]


def extract_text(raw):
    archive, trees = _sections(raw)
    blocks, omitted, total = [], 0, 0
    try:
        for section, root in trees.items():
            paragraphs = list(root.iter("{" + HP + "}p"))
            for index, paragraph in enumerate(paragraphs):
                pieces = []
                for node in paragraph.iter("{" + HP + "}t"):
                    nearest = next((p for p in node.iterancestors() if p.tag == "{" + HP + "}p"), None)
                    if nearest is not paragraph:
                        continue
                    pieces.append(node.text or "")
                    for child in node:
                        if child.tag == "{" + HP + "}lineBreak":
                            pieces.append("\n")
                        elif child.tag == "{" + HP + "}tab":
                            pieces.append("\t")
                        else:
                            # 표시를 알 수 없는 제어는 공란으로 두며 누락 수를 알린다.
                            omitted += 1
                        pieces.append(child.tail or "")
                content = "".join(pieces)
                if not content.strip():
                    continue
                total += len(content) + (2 if blocks else 0)
                if total > MAX_TEXT or len(blocks) >= MAX_BLOCKS:
                    raise MappingError("EXTRACTION_TOO_LARGE")
                cell = next((p for p in paragraph.iterancestors() if p.tag == "{" + HP + "}tc"), None)
                location = f"{section} / 문단 {index + 1}"
                if cell is not None:
                    address = cell.find("{" + HP + "}cellAddr")
                    if address is not None and (address.get("rowAddr") or "").isdigit() and (address.get("colAddr") or "").isdigit():
                        location += f' / 표 {int(address.get("rowAddr")) + 1}행 {int(address.get("colAddr")) + 1}열'
                blocks.append({"id": f"{section}:p{index:06d}", "locator": location, "text": content})
            for node in root.iter():
                if node.tag in ("{" + HP + "}pic", "{" + HP + "}equation", "{" + HP + "}ole", "{" + HP + "}chart"):
                    omitted += 1
        if not blocks:
            raise MappingError("NO_TEXT")
        canonical = json.dumps(blocks, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return {"profile": PROFILE, "fileSha256": hashlib.sha256(raw).hexdigest(), "extractionSha256": hashlib.sha256(canonical).hexdigest(), "blocks": blocks, "omittedObjects": omitted}
    finally:
        archive.close()
