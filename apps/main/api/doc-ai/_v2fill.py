#!/usr/bin/env python3
"""manifest v2 계약대로 template.hwpx 를 채우는 로직 (generate.py 가 import).

계약 출처: _assets/template-manifest.json
  direct_tokens          — 토큰 → 값 경로 (점/인덱스 표기)
  perf_plan_block_tokens — 출제계획 블록 b=1,2 × 요소 g=1..3 × 수준 k=1..4
  composition_rules      — EXAM_INTRO / EXAM_RATIO_SENT / methods 2줄 / computed
  unused_handling        — 미사용 토큰 공백 처리 + PP2 블록 삭제
  final_check            — 잔여 '{{' 0 + verify_hwpx

⚠ _hwpx 엔진과 template.hwpx 는 수정하지 않는다. 이 파일만 고친다.
"""
import re
from pathlib import Path

TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


# ---------------------------------------------------------------------------
# 값 조회 — "monthly_plan[0].hours_cum" 같은 경로를 plan JSON 에서 읽는다
# ---------------------------------------------------------------------------
def get_path(data, path: str):
    cur = data
    for part in path.split("."):
        m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\])*)", part)
        if not m:
            return None
        name, idxs = m.group(1), m.group(2)
        if not isinstance(cur, dict):
            return None
        cur = cur.get(name)
        for i in re.findall(r"\[(\d+)\]", idxs):
            if not isinstance(cur, list) or int(i) >= len(cur):
                return None
            cur = cur[int(i)]
    return cur


def as_text(v) -> str:
    if v is None or v is False:
        return ""
    if isinstance(v, bool):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (list, tuple)):
        return ", ".join(as_text(x) for x in v if as_text(x))
    return str(v).strip()


def first_num(v, default=0.0) -> float:
    """'20점(20%)' → 20.0 / 60 → 60.0 / '' → default"""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    m = NUM_RE.search(str(v or ""))
    return float(m.group()) if m else default


def paren_pct(v, fallback: float) -> float:
    """'20점(20%)' → 20.0 (괄호 안 %). 없으면 fallback."""
    m = re.search(r"\(([^)]*?)%\s*\)", str(v or ""))
    return first_num(m.group(1), fallback) if m else fallback


def fmt_num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def pct(x) -> str:
    return f"{fmt_num(first_num(x))}%"


# ---------------------------------------------------------------------------
# 파생값 — AI 에게 묻지 않고 코드가 계산한다 (composition_rules.computed)
# ---------------------------------------------------------------------------
def normalize_method(s: str) -> str:
    """'토의･토론' / '토의·토론' / '토의 토론' 을 같은 것으로 본다."""
    return re.sub(r"[\s·･・.ㆍ]", "", str(s or ""))


def compose_methods(rule: dict, chosen) -> str:
    picked = {normalize_method(x) for x in (chosen or []) if x}
    marks = {}
    for i, opt in enumerate(rule["options_order"], start=1):
        marks[f"c{i}"] = "■" if normalize_method(opt) in picked else "□"
    out = rule["template"]
    for k, v in marks.items():
        out = out.replace("{" + k + "}", v)
    return out


def derive(plan: dict, manifest: dict) -> dict:
    """direct_tokens 가 참조하지만 plan 에 없는 파생 경로들을 계산해 채운다."""
    exam = plan.get("exam") or {}
    count = int(first_num(exam.get("count"), 0))
    count = count if count in (0, 1, 2) else 0

    exam_ratio = 0.0 if count == 0 else first_num(exam.get("ratio"), 0)
    perf_ratio = 100.0 - exam_ratio

    areas = plan.get("perf_areas") or []
    if not isinstance(areas, list):
        areas = []

    # 합계: 정기 반영비율(=환산 점수) + 수행 영역 만점 합
    perf_points = sum(first_num(a.get("points"), 0) for a in areas if isinstance(a, dict))
    perf_pcts = sum(
        paren_pct(a.get("points"), first_num(a.get("points"), 0))
        for a in areas if isinstance(a, dict)
    )
    points_sum = exam_ratio + perf_points
    pct_sum = exam_ratio + perf_pcts

    # 수행 서·논술형 반영비율 합계
    perf_essay = sum(
        first_num(a.get("essay_ratio"), 0) for a in areas if isinstance(a, dict)
    )
    # 수행 성취기준 합치기 (중복 제거, 순서 유지)
    seen, combined = set(), []
    for a in areas:
        s = as_text(a.get("standards")) if isinstance(a, dict) else ""
        if s and s not in seen:
            seen.add(s)
            combined.append(s)

    d = dict(plan)
    d["exam"] = dict(exam)
    d["exam"]["ratio_display"] = pct(exam_ratio)
    d["perf"] = {
        "ratio_display": pct(perf_ratio),
        "essay_ratio_display": pct(perf_essay) if perf_essay else "",
        "standards_combined": ", ".join(combined),
    }
    d["computed"] = {"points_sum": f"{fmt_num(points_sum)}점({fmt_num(pct_sum)}%)"}
    ess = plan.get("essay_total_ratio")
    d["essay_total_ratio_display"] = pct(ess) if as_text(ess) else ""
    d["_exam_count"] = count
    return d


def compose_sentences(plan: dict, manifest: dict) -> dict:
    """EXAM_INTRO / EXAM_RATIO_SENT — count 에 따라 고정 문구를 고른다."""
    rules = manifest["composition_rules"]
    count = plan["_exam_count"]
    exam = plan.get("exam") or {}

    intro = rules["EXAM_INTRO"].get(str(count), "")

    if count == 0:
        ratio_sent = rules["EXAM_RATIO_SENT"]["0"]
    else:
        ratio_sent = rules["EXAM_RATIO_SENT"]["ge1"]
        for key, val in (
            ("{exam.ratio}", fmt_num(first_num(exam.get("ratio"), 0))),
            ("{exam.mc_points}", fmt_num(first_num(exam.get("mc_points"), 0))),
            ("{exam.essay_points}", fmt_num(first_num(exam.get("essay_points"), 0))),
        ):
            ratio_sent = ratio_sent.replace(key, val)

    return {"EXAM_INTRO": intro, "EXAM_RATIO_SENT": ratio_sent}


# ---------------------------------------------------------------------------
# 토큰 → 값 표 만들기
# ---------------------------------------------------------------------------
def build_token_values(plan: dict, manifest: dict) -> dict:
    data = derive(plan, manifest)
    values = {}

    # 1) direct_tokens
    for token, path in manifest["direct_tokens"].items():
        if not token.startswith("{{"):
            continue  # _comment
        values[token] = as_text(get_path(data, path))

    # 2) 조립 문구
    for name, text in compose_sentences(data, manifest).items():
        values["{{" + name + "}}"] = text

    # 3) 출제계획 블록 (b=1,2 × g=1..3 × k=1..4)
    block = manifest["perf_plan_block_tokens"]
    pattern = dict(block["pattern"])
    pattern.pop("_comment", None)
    extra = {k: v for k, v in block.items() if k.startswith("{{")}

    plans = data.get("perf_plans") or []
    if not isinstance(plans, list):
        plans = []
    max_b = int(manifest.get("limits", {}).get("perf_plans_max", 2))

    m_line1 = manifest["composition_rules"]["methods_line1"]
    m_line2 = manifest["composition_rules"]["methods_line2"]

    for b in range(1, max_b + 1):
        item = plans[b - 1] if b - 1 < len(plans) and isinstance(plans[b - 1], dict) else {}
        elements = item.get("elements") or []
        if not isinstance(elements, list):
            elements = []

        for tpl, path in list(pattern.items()) + list(extra.items()):
            tok = tpl.replace("{b}", str(b))
            if "{g}" not in tok:
                if "METHODS1" in tok:
                    values[tok] = compose_methods(m_line1, item.get("methods"))
                elif "METHODS2" in tok:
                    values[tok] = compose_methods(m_line2, item.get("methods"))
                else:
                    field = path.rsplit(".", 1)[-1]
                    values[tok] = as_text(item.get(field))
                continue

            for g in range(1, 4):
                grp = elements[g - 1] if g - 1 < len(elements) and isinstance(elements[g - 1], dict) else {}
                levels = grp.get("levels") or []
                if not isinstance(levels, list):
                    levels = []
                tok_g = tok.replace("{g}", str(g))
                if "{k}" not in tok_g:
                    values[tok_g] = as_text(grp.get("name"))
                    continue
                for k in range(1, 5):
                    lv = levels[k - 1] if k - 1 < len(levels) and isinstance(levels[k - 1], dict) else {}
                    tok_k = tok_g.replace("{k}", str(k))
                    values[tok_k] = as_text(lv.get("points") if tok_k.endswith("_PTS}}") else lv.get("desc"))

    # 4) unused_handling — 미사용 회차/영역은 빈칸
    count = data["_exam_count"]
    blanks = []
    if count <= 1:
        blanks += ["EX2_MC", "EX2_ESSAY", "EX2_ESSAY_RATIO", "EX2_STD", "EX2_PERIOD"]
    if count == 0:
        blanks += ["EX1_MC", "EX1_ESSAY", "EX1_ESSAY_RATIO", "EX1_STD", "EX1_PERIOD"]
    areas = data.get("perf_areas") or []
    if len(areas) < 2:
        blanks += ["P2_NAME", "P2_POINTS", "P2_PERIOD"]
    for name in blanks:
        values["{{" + name + "}}"] = ""

    return values, data


# ---------------------------------------------------------------------------
# 문서에 적용
# ---------------------------------------------------------------------------
def fill_document(sec, values: dict, data: dict, manifest: dict, *, ln, find_text_indices,
                  replace_text_anywhere, para_text):
    """토큰 치환 + 미사용 블록 삭제. 엔진 함수는 인자로 주입받는다(_hwpx 무수정)."""
    plans = data.get("perf_plans") or []
    used_blocks = sum(
        1 for p in plans if isinstance(p, dict) and as_text(p.get("name"))
    )
    max_b = int(manifest.get("limits", {}).get("perf_plans_max", 2))

    # (1) 미사용 출제계획 블록 삭제 — 치환 전에 먼저 (인덱스 흔들림 최소화)
    deleted = []
    for b in range(max_b, max(used_blocks, 1), -1):
        deleted += delete_perf_block(sec, b, ln=ln, para_text=para_text)

    # (2) 토큰 치환 (긴 토큰부터 — {{PP1_E1_L1}} 이 {{PP1_E1_L1_PTS}} 를 잘라먹지 않게)
    replaced = 0
    for token in sorted(values, key=len, reverse=True):
        text = values[token]
        idxs = find_text_indices(sec, token)
        if not idxs:
            continue
        children = list(sec)
        for i in idxs:
            replaced += replace_text_anywhere(children[i], token, text, required=False)

    return {"replaced": replaced, "deleted_paras": deleted, "used_blocks": used_blocks}


def delete_perf_block(sec, b: int, *, ln, para_text) -> list:
    """PP{b} 블록(직전 빈 문단 + 이름 문단 + 표 문단 + 결시자 문단)을 제거한다."""
    name_tok, absent_tok = f"{{{{PP{b}_NAME}}}}", f"{{{{PP{b}_ABSENT}}}}"
    kids = list(sec)
    start = end = None
    for i, ch in enumerate(kids):
        txt = para_text(ch)
        if name_tok in txt and start is None:
            start = i
        if absent_tok in txt:
            end = i
    if start is None or end is None or end < start:
        return []

    # 직전 빈 문단 1개까지 함께 (양식에 빈 줄이 남지 않게)
    if start - 1 >= 0 and not para_text(kids[start - 1]).strip():
        start -= 1

    removed = list(range(start, end + 1))
    for ch in kids[start : end + 1]:
        sec.remove(ch)
    return removed


def leftover_tokens(sec, *, ln) -> list:
    """문서 전체에 남은 {{...}} 토큰 목록 (final_check)."""
    found = []
    for t in sec.iter():
        if ln(t) == "t" and t.text and "{{" in t.text:
            found += TOKEN_RE.findall(t.text)
            if "{{" in t.text and not TOKEN_RE.search(t.text):
                found.append(t.text.strip()[:40])
    return sorted(set(found))
