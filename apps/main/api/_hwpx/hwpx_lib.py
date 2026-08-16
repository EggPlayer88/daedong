#!/usr/bin/env python3
"""hwpx_lib — HWPX 문서 편집 엔진.

v5.1 스킬에서 실전 검증된 규칙을 함수로 고정한 것이다.
매번 코드를 새로 쓰지 말고 여기서 import 해서 쓴다.

    import sys; sys.path.insert(0, 'scripts')
    from hwpx_lib import *

    tree, root, sec = load_section('work/Contents/section0.xml')
    dump_structure(sec)
    ...
    save_section(tree, 'work/Contents/section0.xml')

핵심 원칙 (어기면 문서가 깨진다):
  1. section0.xml을 새로 쓰지 않는다. 기존 요소를 deepcopy해서 텍스트만 바꾼다.
  2. XML을 문자열 조작(replace/re.sub/f-string)하지 않는다. 항상 lxml 트리로 다룬다.
  3. linesegarray는 '실제로 텍스트를 고친 최소 단위 p의 직계'만 지운다.
     하위 전체를 재귀 삭제하면 미수정 셀의 음수 spacing 캐시까지 지워져 양식이 깨진다.
  4. run 안에 t 외의 요소(secPr/ctrl/tbl)가 있으면 그 run은 절대 삭제하지 않는다.
  5. 여러 구간을 교체할 때는 반드시 뒤쪽 구간부터 역순으로 처리한다.
"""
import copy
import zipfile
from pathlib import Path

from lxml import etree

__all__ = [
    "ln", "load_section", "save_section", "find_sec",
    "dump_structure", "audit_runs", "locate_text", "find_text_indices",
    "nearest_p", "remove_own_lineseg", "remove_linesegarray",
    "clone_para", "set_run_text", "replace_text_anywhere",
    "replace_section_body", "SYMBOLS",
    "scan_placeholders", "count_body_paragraphs", "snapshot_para", "assert_para_intact",
    "verify_hwpx",
]


def ln(el) -> str:
    """네임스페이스를 뗀 태그 이름."""
    return etree.QName(el.tag).localname


# ─────────────────────────────────────────────────────────────
# 열기 / 저장
# ─────────────────────────────────────────────────────────────

def load_section(path):
    """section0.xml을 연다. (tree, root, sec) 반환."""
    with open(path, "rb") as f:
        tree = etree.parse(f)
    root = tree.getroot()
    return tree, root, find_sec(root)


def find_sec(root):
    """모든 본문 문단의 공통 부모인 sec 요소를 찾는다."""
    for el in root.iter():
        if ln(el) == "sec":
            return el
    # 루트 자체가 sec인 양식도 있다
    return root if ln(root) == "sec" else None


def save_section(tree, path):
    """원본의 인코딩·standalone 선언을 그대로 유지하며 저장한다."""
    tree.write(
        str(path),
        xml_declaration=True,
        encoding=tree.docinfo.encoding or "UTF-8",
        standalone=tree.docinfo.standalone,
    )


# ─────────────────────────────────────────────────────────────
# 구조 파악 (수정 전 반드시 실행)
# ─────────────────────────────────────────────────────────────

def _para_text(el, limit=None):
    """요소 하위의 모든 t 텍스트를 이어붙인다."""
    s = "".join(t.text or "" for t in el.iter() if ln(t) == "t")
    s = " ".join(s.split())
    return s[:limit] if limit else s


def dump_structure(sec, limit=100, width=72):
    """sec 직계 자식의 인덱스 맵을 출력한다.

    여기서 확인한 인덱스로만 교체 대상을 지정한다.
    텍스트 내용으로 구간을 탐색하면 안 된다.
    """
    children = list(sec)
    print(f"sec 직계 자식 수: {len(children)}\n")
    print(f"{'idx':>4}  {'종류':<6} {'run':>3} {'구조':<12} 내용")
    print("-" * (width + 32))
    for i, ch in enumerate(children[:limit]):
        kind = ln(ch)
        if kind != "p":
            print(f"{i:>4}  {kind:<6}")
            continue
        runs = [c for c in ch if ln(c) == "run"]
        structural = set()
        for r in runs:
            structural |= {ln(c) for c in r if ln(c) != "t"}
        flag = ",".join(sorted(structural)) if structural else ""
        text = _para_text(ch, width) or "(빈 문단)"
        print(f"{i:>4}  p      {len(runs):>3} {flag:<12} {text}")
    if len(children) > limit:
        print(f"... 외 {len(children) - limit}개")
    return children


def audit_runs(p_elem, verbose=True):
    """문단의 run 구성을 감사한다.

    t 외의 요소(secPr/ctrl/tbl 등)를 가진 run은 삭제하면 안 된다.
    삭제 금지 run이 하나라도 있으면 True를 반환한다.
    """
    runs = [c for c in p_elem if ln(c) == "run"]
    protected_any = False
    for i, r in enumerate(runs):
        kinds = sorted({ln(c) for c in r})
        protected = bool(set(kinds) - {"t"})
        protected_any |= protected
        if verbose:
            mark = "  ★삭제금지" if protected else ""
            print(f"  run[{i}] children={kinds}{mark}")
    return protected_any


def locate_text(p_elem, needle):
    """needle이 직계 run에 있는지, 표 내부에 있는지 판별.

    반환: 'direct' | 'nested_tbl' | None
    """
    for r in p_elem:
        if ln(r) != "run":
            continue
        for c in r:
            k = ln(c)
            if k == "t" and c.text and needle in c.text:
                return "direct"
            if k == "tbl":
                for t in c.iter():
                    if ln(t) == "t" and t.text and needle in t.text:
                        return "nested_tbl"
    return None


def find_text_indices(sec, needle):
    """sec 직계 자식 중 needle을 포함한 문단의 인덱스 목록."""
    hits = []
    for i, ch in enumerate(sec):
        if needle in _para_text(ch):
            hits.append(i)
    return hits


# ─────────────────────────────────────────────────────────────
# linesegarray (줄 배치 캐시)
# ─────────────────────────────────────────────────────────────

def nearest_p(elem):
    """elem을 감싸는 가장 가까운 p 요소."""
    cur = elem.getparent()
    while cur is not None and ln(cur) != "p":
        cur = cur.getparent()
    return cur


def remove_own_lineseg(p):
    """해당 p의 '직계' linesegarray만 삭제.

    하위 표 안의 캐시는 절대 건드리지 않는다. 미수정 셀의 음수 spacing
    캐시(예: spacing=-240)가 지워지면 줄 높이가 재계산되어 양식이 깨진다.
    """
    for c in list(p):
        if ln(c) == "linesegarray":
            p.remove(c)


remove_linesegarray = remove_own_lineseg  # v5.1 호환 별칭


# ─────────────────────────────────────────────────────────────
# 텍스트 교체
# ─────────────────────────────────────────────────────────────

def set_run_text(p_elem, run_idx, new_text, remove_extra_runs=False):
    """직계 run의 텍스트를 교체한다.

    remove_extra_runs=True는 뒤쪽 run을 지우므로 위험하다.
    구조 요소를 가진 run이 있으면 예외를 던져 사고를 막는다.
    """
    runs = [c for c in p_elem if ln(c) == "run"]
    if run_idx < len(runs):
        for t in runs[run_idx]:
            if ln(t) == "t":
                t.text = new_text
                break
    if remove_extra_runs:
        for r in runs[run_idx + 1:]:
            kinds = {ln(c) for c in r}
            if kinds - {"t"}:
                raise RuntimeError(
                    f"run에 구조 요소 {sorted(kinds - {'t'})}가 있어 삭제할 수 없습니다. "
                    "replace_text_anywhere를 사용하세요. (5-0-1 규칙)"
                )
            p_elem.remove(r)
    remove_own_lineseg(p_elem)


def replace_text_anywhere(p_elem, old_text, new_text, required=True):
    """p_elem 하위 전체(표 내부 포함)에서 old_text를 포함한 t 노드만 교체.

    구조 요소는 추가·삭제하지 않으므로 제목 테두리 표가 보존된다.
    lineseg는 실제로 고친 t가 속한 최소 단위 p의 직계만 지운다.
    """
    replaced = 0
    for t in p_elem.iter():
        if ln(t) == "t" and t.text and old_text in t.text:
            t.text = t.text.replace(old_text, new_text)
            replaced += 1
            host = nearest_p(t)
            if host is not None:
                remove_own_lineseg(host)
    if required and replaced == 0:
        raise AssertionError(
            f"'{old_text}' 를 찾지 못했습니다. dump_structure 출력에서 자리표시 텍스트를 재확인하세요."
        )
    return replaced


def smart_replace(sec, needle, new_text):
    """sec 전체에서 needle을 찾아 위치에 맞는 방식으로 교체한다."""
    idxs = find_text_indices(sec, needle)
    if not idxs:
        raise AssertionError(f"'{needle}' 를 찾지 못했습니다.")
    total = 0
    for i in idxs:
        total += replace_text_anywhere(list(sec)[i], needle, new_text, required=False)
    return total


# ─────────────────────────────────────────────────────────────
# 본문 구간 교체
# ─────────────────────────────────────────────────────────────

SYMBOLS = {
    "box":    (" □  ", True),    # 소제목 — run 2개 구조(기호 + 본문)
    "circle": ("  ○ ", False),
    "dash":   ("   ― ", False),
    "note":   ("     ※ ", False),
}


def clone_para(ref_p, run_texts):
    """참조 문단을 깊은 복사해 텍스트만 갈아끼운다.

    run_texts: ['run0 텍스트', 'run1 텍스트', ...]
    남는 run은 제거한다(참조 문단은 t만 가진 순수 본문 문단이어야 한다).
    """
    new_p = copy.deepcopy(ref_p)
    remove_own_lineseg(new_p)
    runs = [c for c in new_p if ln(c) == "run"]
    for i, txt in enumerate(run_texts):
        if i < len(runs):
            for t in runs[i]:
                if ln(t) == "t":
                    t.text = txt
                    break
    for r in runs[len(run_texts):]:
        kinds = {ln(c) for c in r}
        if kinds - {"t"}:
            raise RuntimeError(
                "참조 문단에 구조 요소를 가진 run이 있습니다. "
                "순수 본문 문단(□/○/―/※)을 참조로 고르세요."
            )
        new_p.remove(r)
    return new_p


def replace_section_body(sec, start_idx, end_idx, refs, content_list):
    """[start_idx, end_idx) 구간의 문단을 content_list로 통째 교체.

    refs        : {'box': p, 'circle': p, 'dash': p, 'note': p} — 반드시 수정 전 deepcopy
    content_list: [('box'|'circle'|'dash'|'note', '텍스트'), ...]

    ★ 여러 구간을 교체할 때는 반드시 뒤쪽 구간부터 역순으로 호출한다.
      앞에서부터 하면 삽입·삭제로 이후 인덱스가 전부 틀어진다.
    """
    for child in list(sec)[start_idx:end_idx]:
        sec.remove(child)

    pos = start_idx
    for typ, text in content_list:
        sym, two_run = SYMBOLS[typ]
        ref_p = refs[typ]
        new_p = clone_para(ref_p, [sym, text] if two_run else [sym + text])
        sec.insert(pos, new_p)
        pos += 1
    return pos - start_idx


# ─────────────────────────────────────────────────────────────
# 검증
# ─────────────────────────────────────────────────────────────

DEFAULT_PLACEHOLDERS = [
    "보고서 양식(제목)", "제 목", "기관명", "헤드라인M 폰트",
    "휴면명조", "휴먼명조", "중고딕", "세부내용", "○○", "◇◇",
]


def scan_placeholders(sec, extra=None, allow=None):
    """자리표시 텍스트가 남아 있는지 문서 전체를 훑는다."""
    targets = list(DEFAULT_PLACEHOLDERS) + list(extra or [])
    allowed = set(allow or [])
    leftover = []
    for t in sec.iter():
        if ln(t) == "t" and t.text:
            for ph in targets:
                if ph in t.text and ph not in allowed:
                    leftover.append((ph, t.text.strip()[:50]))
    return leftover


def count_body_paragraphs(sec):
    """□/○/―/※ 등으로 시작하는 실질 본문 문단 수."""
    n = 0
    for p in sec:
        if ln(p) != "p":
            continue
        s = _para_text(p).strip()
        if s and s[0] in "□○ㅇ―-※*":
            n += 1
    return n


def snapshot_para(p_elem):
    """수정 전 문단의 구조를 기록해 둔다 (나중에 훼손 여부 검증용)."""
    return {
        "runs": sum(1 for c in p_elem if ln(c) == "run"),
        "tbls": sum(1 for c in p_elem.iter() if ln(c) == "tbl"),
        "ctrls": sum(1 for c in p_elem.iter() if ln(c) == "ctrl"),
    }


def assert_para_intact(p_elem, before, label="제목 문단"):
    """구조가 그대로인지 확인한다. 어긋나면 즉시 실패시킨다."""
    now = snapshot_para(p_elem)
    if now != before:
        raise AssertionError(
            f"{label} 구조 훼손: {before} → {now}\n"
            "  원본 section0.xml에서 해당 문단을 deepcopy해 통째로 교체한 뒤 "
            "텍스트 교체만 다시 수행하세요."
        )
    return True


def verify_hwpx(path, expect_texts=None, forbid_texts=None):
    """완성된 hwpx의 무결성과 내용을 확인한다."""
    path = Path(path)
    with zipfile.ZipFile(path) as zf:
        assert zf.testzip() is None, "ZIP 손상"
        mt = zf.getinfo("mimetype")
        assert zf.namelist()[0] == "mimetype", "mimetype이 첫 엔트리가 아님"
        assert mt.compress_type == zipfile.ZIP_STORED, "mimetype이 압축됨"
        names = [n for n in zf.namelist() if n.startswith("Contents/section")]
        body = ""
        for n in sorted(names):
            t = etree.fromstring(zf.read(n))  # 파싱 실패하면 여기서 예외
            body += _para_text(t)
    problems = []
    for s in expect_texts or []:
        if s not in body:
            problems.append(f"누락: {s}")
    for s in forbid_texts or []:
        if s in body:
            problems.append(f"잔존: {s}")
    if problems:
        raise AssertionError("검증 실패 — " + " / ".join(problems))
    print(f"검증 통과: {path.name} ({path.stat().st_size:,} bytes)")
    return True
