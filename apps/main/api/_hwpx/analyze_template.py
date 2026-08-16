#!/usr/bin/env python3
"""HWPX 문서의 '서식 청사진'을 뽑아낸다.

새 문서를 만들 때 header.xml의 스타일 ID를 그대로 재사용해야 한글에서
서식이 깨지지 않는다. 이 스크립트는 어떤 ID가 존재하고 각각이 무엇인지
알려주는 것이 목적이다.

사용법:
  python3 analyze_template.py 템플릿.hwpx
  python3 analyze_template.py 템플릿.hwpx --extract-header /tmp/header.xml
  python3 analyze_template.py 템플릿.hwpx --extract-section /tmp/section0.xml
"""
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

HWPUNIT = 7200.0  # 1인치 = 7200 HWPUNIT
MAX_MAP = 120     # 인덱스 맵 최대 출력 개수


def lname(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def mm(v):
    """HWPUNIT -> mm 문자열"""
    try:
        return f"{float(v) / HWPUNIT * 25.4:.1f}mm"
    except (TypeError, ValueError):
        return str(v)


def pt(v):
    """글자 크기 단위(1/100 pt) -> pt"""
    try:
        return f"{float(v) / 100:g}pt"
    except (TypeError, ValueError):
        return str(v)


def find_all(root, name):
    return [e for e in root.iter() if lname(e.tag) == name]


def analyze_header(data: bytes):
    root = ET.fromstring(data)
    print("=" * 66)
    print("HEADER.XML — 서식 정의")
    print("=" * 66)

    fonts = {}
    for ff in find_all(root, "font"):
        fid = ff.get("id")
        if fid is not None and fid not in fonts:
            fonts[fid] = ff.get("face", "?")
    if fonts:
        print("\n[글꼴]")
        for fid, face in sorted(fonts.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0):
            print(f"  id={fid:<4} {face}")

    print("\n[글자 모양 charPr] — run의 charPrIDRef로 참조")
    for cp in find_all(root, "charPr"):
        cid = cp.get("id")
        height = pt(cp.get("height", "?"))
        bold = " 굵게" if cp.find("./{*}bold") is not None else ""
        italic = " 기울임" if cp.find("./{*}italic") is not None else ""
        underline = " 밑줄" if cp.find("./{*}underline") is not None else ""
        color = cp.get("textColor", "")
        color = f" 색={color}" if color and color != "#000000" else ""
        face = ""
        fr = cp.find("./{*}fontRef")
        if fr is not None:
            fid = fr.get("hangul") or fr.get("latin")
            face = f" 글꼴={fonts.get(fid, fid)}"
        print(f"  id={cid:<4} {height}{face}{bold}{italic}{underline}{color}")

    print("\n[문단 모양 paraPr] — p의 paraPrIDRef로 참조")
    for pp in find_all(root, "paraPr"):
        pid = pp.get("id")
        align = pp.find("./{*}align")
        horz = align.get("horizontal", "?") if align is not None else "?"
        margin = pp.find("./{*}margin")
        info = ""
        if margin is not None:
            parts = []
            for side, label in (("left", "왼"), ("right", "오"), ("intent", "들여")):
                el = margin.find(f"./{{*}}{side}")
                if el is not None and el.get("value", "0") != "0":
                    parts.append(f"{label}={mm(el.get('value'))}")
            if parts:
                info = " " + " ".join(parts)
        ls = pp.find("./{*}lineSpacing")
        spacing = f" 줄간격={ls.get('value')}%" if ls is not None else ""
        print(f"  id={pid:<4} 정렬={horz}{info}{spacing}")

    print("\n[스타일 style] — p의 styleIDRef로 참조  ★ 가장 중요")
    for st in find_all(root, "style"):
        print(
            f"  id={st.get('id'):<4} {st.get('name', '?'):<16}"
            f" (영문명={st.get('engName', '?')})"
            f" paraPr={st.get('paraPrIDRef')} charPr={st.get('charPrIDRef')}"
        )

    bfs = find_all(root, "borderFill")
    print(f"\n[테두리/배경 borderFill] — 표 셀의 borderFillIDRef로 참조 (총 {len(bfs)}개)")
    for bf in bfs[:15]:
        sides = []
        for side, label in (("leftBorder", "좌"), ("rightBorder", "우"),
                            ("topBorder", "상"), ("bottomBorder", "하")):
            el = bf.find(f"./{{*}}{side}")
            if el is not None:
                t = el.get("type", "NONE")
                if t != "NONE":
                    sides.append(f"{label}={t}")
        fill = "채움있음" if bf.find("./{*}fillBrush") is not None else ""
        print(f"  id={bf.get('id'):<4} {' '.join(sides) or '테두리없음':<40} {fill}")
    if len(bfs) > 15:
        print(f"  ... 외 {len(bfs) - 15}개")


def analyze_section(data: bytes, label: str):
    root = ET.fromstring(data)
    print("\n" + "=" * 66)
    print(f"{label} — 용지 설정 및 본문 구조")
    print("=" * 66)

    for sp in find_all(root, "secPr"):
        pg = sp.find("./{*}pagePr")
        if pg is None:
            continue
        print(f"\n[용지] 가로={mm(pg.get('width'))} 세로={mm(pg.get('height'))}"
              f" 방향={pg.get('landscape', 'WIDELY')}")
        mg = pg.find("./{*}margin")
        if mg is not None:
            print("[여백] " + " ".join(
                f"{label2}={mm(mg.get(k, 0))}"
                for k, label2 in (("left", "좌"), ("right", "우"), ("top", "상"),
                                  ("bottom", "하"), ("header", "머리말"), ("footer", "꼬리말"))
            ))
        break

    # ── sec 직계 자식 인덱스 맵 (편집 작업의 좌표계) ──
    sec = None
    for el in root.iter():
        if lname(el.tag) == "sec":
            sec = el
            break
    if sec is None and lname(root.tag) == "sec":
        sec = root

    if sec is not None:
        kids = list(sec)
        print(f"\n[sec 직계 자식 인덱스 맵 — 총 {len(kids)}개]  ★ 편집은 이 인덱스로만 지정한다")
        print(f"  {'idx':>4}  {'run':>3}  {'구조':<14} {'style/para':<11} 내용")
        print("  " + "-" * 96)
        for i, ch in enumerate(kids[:MAX_MAP]):
            if lname(ch.tag) != "p":
                print(f"  {i:>4}  {'':>3}  {lname(ch.tag)}")
                continue
            runs = [r for r in ch if lname(r.tag) == "run"]
            structural = set()
            for r in runs:
                structural |= {lname(c.tag) for c in r if lname(c.tag) != "t"}
            flag = ",".join(sorted(structural))
            if flag:
                flag += " ★"
            ids = f"{ch.get('styleIDRef', '-')}/{ch.get('paraPrIDRef', '-')}"
            text = " ".join("".join(
                t.text or "" for t in ch.iter() if lname(t.tag) == "t").split())[:52]
            print(f"  {i:>4}  {len(runs):>3}  {flag:<14} {ids:<11} {text or '(빈 문단)'}")
        if len(kids) > MAX_MAP:
            print(f"  ... 외 {len(kids) - MAX_MAP}개")
        print("\n  ★ 표시 = run 안에 secPr/ctrl/tbl 등 구조 요소가 있음."
              " 이 문단은 run을 삭제하면 안 되고 replace_text_anywhere만 쓴다.")

    # ── 자리표시 후보 ──
    cands = []
    for t in root.iter():
        if lname(t.tag) != "t" or not t.text:
            continue
        s = t.text.strip()
        if not s:
            continue
        if (any(m in s for m in ("○○", "◇◇", "△△", "＿", "____"))
                or any(w in s for w in ("양식", "자리", "제 목", "기관명", "세부내용", "홍길동"))
                or re.fullmatch(r"\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?", s)):
            if s not in cands:
                cands.append(s)
    if cands:
        print("\n[자리표시 후보 — 교체 대상일 가능성이 높은 텍스트]")
        for c in cands[:25]:
            print(f"  · {c[:60]}")

    tbls = find_all(root, "tbl")
    if tbls:
        print(f"\n[표 구조 — 총 {len(tbls)}개]")
        for i, tbl in enumerate(tbls, 1):
            trs = [x for x in tbl if lname(x.tag) == "tr"]
            ncol = len([c for c in trs[0] if lname(c.tag) == "tc"]) if trs else 0
            widths = []
            if trs:
                for tc in trs[0]:
                    if lname(tc.tag) != "tc":
                        continue
                    sz = tc.find("./{*}cellSz")
                    if sz is not None:
                        widths.append(mm(sz.get("width")))
            print(f"  표{i}: {len(trs)}행 × {ncol}열  열너비=[{', '.join(widths)}]")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1])
    args = sys.argv[2:]

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        print(f"파일: {path.name}")
        print(f"내부 항목 {len(names)}개\n")

        if "Contents/header.xml" in names:
            analyze_header(z.read("Contents/header.xml"))

        for n in sorted(x for x in names if re.fullmatch(r"Contents/section\d+\.xml", x)):
            analyze_section(z.read(n), n)

        if "--extract-header" in args:
            out = Path(args[args.index("--extract-header") + 1])
            out.write_bytes(z.read("Contents/header.xml"))
            print(f"\n[저장] header.xml -> {out}")
        if "--extract-section" in args:
            out = Path(args[args.index("--extract-section") + 1])
            out.write_bytes(z.read("Contents/section0.xml"))
            print(f"[저장] section0.xml -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
