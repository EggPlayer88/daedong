#!/usr/bin/env python3
"""HWPX 문서에서 본문 텍스트와 표를 추출한다.

표는 마크다운 표로 변환하므로, 성적표·시간표·계획서의 표를 그대로 읽어
분석하거나 다른 형식으로 옮기기 좋다.

네임스페이스 접두사(hp:, hs: 등)는 생성 프로그램마다 달라질 수 있으므로
태그의 로컬 이름만 보고 처리한다.

사용법:
  python3 extract_text.py 문서.hwpx              # 전체 추출
  python3 extract_text.py 문서.hwpx --tables-only # 표만
  python3 extract_text.py 문서.hwpx --json        # 구조화 출력
"""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def lname(tag: str) -> str:
    """'{네임스페이스}p' -> 'p'"""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def section_names(zf: zipfile.ZipFile):
    names = [n for n in zf.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)]
    return sorted(names, key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)))


def para_text(el) -> str:
    """문단 하나의 텍스트. 표는 건너뛴다(별도 처리)."""
    out = []

    def walk(node):
        tag = lname(node.tag)
        if tag == "tbl":
            return  # 표는 여기서 처리하지 않음
        if tag == "t":
            if node.text:
                out.append(node.text)
        elif tag == "tab":
            out.append("\t")
        elif tag in ("lineBreak", "linebreak"):
            out.append("\n")
        for child in node:
            walk(child)
            if lname(child.tag) == "t" and child.tail:
                pass
    for child in el:
        walk(child)
    return "".join(out).strip()


def parse_table(tbl):
    """<tbl>을 2차원 리스트로. 병합 셀은 정보만 유지하고 단순 배치한다."""
    rows = []
    for tr in tbl:
        if lname(tr.tag) != "tr":
            continue
        row = []
        for tc in tr:
            if lname(tc.tag) != "tc":
                continue
            texts = []
            for p in tc.iter():
                if lname(p.tag) == "p":
                    t = para_text(p)
                    if t:
                        texts.append(t)
            span = tc.find("./{*}cellSpan")
            colspan = rowspan = 1
            if span is not None:
                colspan = int(span.get("colSpan", 1))
                rowspan = int(span.get("rowSpan", 1))
            row.append({
                "text": " ".join(texts),
                "colspan": colspan,
                "rowspan": rowspan,
            })
        if row:
            rows.append(row)
    return rows


def table_to_markdown(rows) -> str:
    if not rows:
        return ""
    lines = []
    width = max(len(r) for r in rows)
    for i, row in enumerate(rows):
        cells = [c["text"].replace("|", "\\|").replace("\n", " ") for c in row]
        cells += [""] * (width - len(cells))
        lines.append("| " + " | ".join(cells) + " |")
        if i == 0:
            lines.append("|" + "---|" * width)
    return "\n".join(lines)


def extract(path: Path):
    blocks = []
    with zipfile.ZipFile(path) as z:
        for sec in section_names(z):
            root = ET.fromstring(z.read(sec))
            sec_no = int(re.search(r"(\d+)", sec.split("/")[-1]).group(1))
            # 표 안쪽 문단은 표로 한 번만 출력하고 본문 문단으로 중복 출력하지 않는다.
            inside_table = set()
            for tbl in root.iter():
                if lname(tbl.tag) == "tbl":
                    for d in tbl.iter():
                        inside_table.add(id(d))
                    inside_table.discard(id(tbl))
            for el in root.iter():
                if id(el) in inside_table:
                    continue
                tag = lname(el.tag)
                if tag == "p":
                    # 표를 품고 있는 문단이면 표를 먼저 뽑는다
                    t = para_text(el)
                    if t:
                        blocks.append({"section": sec_no, "type": "paragraph", "text": t})
                elif tag == "tbl":
                    rows = parse_table(el)
                    if rows:
                        blocks.append({"section": sec_no, "type": "table", "rows": rows})
    return blocks


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1])
    flags = set(sys.argv[2:])
    blocks = extract(path)

    if "--json" in flags:
        print(json.dumps(blocks, ensure_ascii=False, indent=2))
        return 0

    tables_only = "--tables-only" in flags
    for b in blocks:
        if b["type"] == "table":
            print("\n" + table_to_markdown(b["rows"]) + "\n")
        elif not tables_only:
            print(b["text"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
