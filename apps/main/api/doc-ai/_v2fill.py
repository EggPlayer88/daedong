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

# 구조적으로 쓰이지 않는 칸에 찍는 기호 (U+02D9 DOT ABOVE) — 학교 관행 실측.
# 교사가 아직 안 정해 비워 둔 "공란" 과는 다르다. 공란은 빈 문자열 그대로 둔다.
UNUSED_MARK = "\u02d9"
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
# 시수/누계 — 학사일정 기반 고정표로 주입 (AI 계산 금지)
# ---------------------------------------------------------------------------
def hours_row(table: dict, weekly_hours, variant: str | None = None) -> dict | None:
    """고정표에서 주당시수에 해당하는 행을 찾는다. 범위를 벗어나면 None."""
    if table is None:
        return None
    n = first_num(weekly_hours, 0)
    if n <= 0 or n != int(n):
        return None
    key = str(int(n))
    variants = table.get("variants") or {}
    var = variant or table.get("default_variant") or "common"
    row = (variants.get(var) or {}).get(key)
    return row if isinstance(row, dict) and row.get("months") else None


def apply_fixed_hours(plan: dict, table: dict) -> dict:
    """monthly_plan[].hours_cum 을 고정표 값으로 덮어쓴다.

    - fields.hours_manual 이 참이면 교사가 준 값을 그대로 둔다.
    - weekly_hours 가 표의 범위(1~5)를 벗어나면 덮어쓰지 않고 교사 값을 둔다
      (계획서를 못 만드는 것보다 낫다).

    반환: {"applied": bool, "reason": str, "months": [...], "row": {...}|None}
    """
    rows = plan.get("monthly_plan")
    if not isinstance(rows, list) or not rows:
        return {"applied": False, "reason": "monthly_plan 없음", "months": [], "row": None}

    if plan.get("hours_manual") in (True, "true", "True", 1):
        return {"applied": False, "reason": "hours_manual", "months": [], "row": None}

    row = hours_row(table, plan.get("weekly_hours"))
    if row is None:
        return {
            "applied": False,
            "reason": "weekly_hours 가 고정표 범위를 벗어남",
            "months": [],
            "row": None,
        }

    months = row["months"]
    for i, r in enumerate(rows):
        if isinstance(r, dict) and i < len(months):
            r["hours_cum"] = months[i]
    return {"applied": True, "reason": "fixed_table", "months": months, "row": row}


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

    # ── 만점 표기 "N(M%)" — M = N × 해당 반영비율 ÷ 100 (코드가 계산) ────────
    # 정기시험 회차: 회차 반영비율이 있으면 그것, 없으면 전체 ÷ 회차 수로 균등 배분
    even = (exam_ratio / count) if count else 0.0
    rounds = exam.get("rounds") or []
    if isinstance(rounds, list):
        d["exam"]["rounds"] = [
            {**r,
             "mc": points_label(r.get("mc"), first_num(r.get("ratio"), even)),
             "essay": points_label(r.get("essay"), first_num(r.get("ratio"), even))}
            if isinstance(r, dict) else r
            for r in rounds
        ]
    # 수행평가: **각 영역이 100점 만점**이고 가중치는 영역별 반영비율로만 준다.
    # 영역 비율이 없으면 수행 전체를 영역 수로 균등 배분 (제안값이며 교사가 조정)
    even_perf = (perf_ratio / len(areas)) if areas else 0.0
    d["perf_areas"] = [
        {**a,
         "points": points_label(a.get("points") or 100, first_num(a.get("ratio"), even_perf))}
        if isinstance(a, dict) else a
        for a in areas
    ]

    d["perf"] = {
        "ratio_display": pct(perf_ratio),
        "essay_ratio_display": pct(perf_essay) if perf_essay else "",
        "standards_combined": ", ".join(combined),
    }
    # 합계 칸: 최종 성적 척도는 100점. % 는 정기+수행 반영비율 합(정상이면 100).
    # 표기 관행은 만점 칸과 같은 "N(M%)" 형태다.
    d["computed"] = {"points_sum": f"100({fmt_num(exam_ratio + perf_ratio)}%)"}
    ess = plan.get("essay_total_ratio")
    d["essay_total_ratio_display"] = pct(ess) if as_text(ess) else ""
    d["_exam_count"] = count
    return d


def points_label(raw, ratio) -> str:
    """만점 표기를 학교 관행인 "N(M%)" 로 정규화한다. M = N × ratio ÷ 100.

    실측(2025~2026 원본 3절 표): **각 평가가 각각 100점 만점**이고 가중치는
    반영비율로만 준다. 수행 영역이면 N=100 이므로 "100(40%)" 가 된다.
    정기시험 회차의 선택형/서·논술형은 100점 안의 배점이라 "70(21%)" 형태.

    AI 가 준 문자열의 괄호 안 숫자는 신뢰하지 않고 다시 계산한다
    (교사가 보는 값과 문서에 들어가는 값이 갈라지지 않게).
    반영비율을 모르면 괄호 없이 만점만 적는다 — 0% 같은 거짓 숫자를 넣지 않는다.
    """
    if as_text(raw) == "":
        return ""
    n = first_num(raw, 0)
    if n <= 0:
        return as_text(raw)
    r = first_num(ratio, 0)
    if r <= 0:
        return fmt_num(n)
    m = n * r / 100.0
    return f"{fmt_num(n)}({fmt_num(round(m, 1))}%)"


# ---------------------------------------------------------------------------
# 정합성 검증 — 위반 시 "어느 합이 몇 점인지" 를 문장으로 돌려준다
# ---------------------------------------------------------------------------
def check_scales(plan: dict) -> list:
    """배점 불변식 (2025~2026 원본 3절 표 실측).

    **각 평가가 각각 100점 만점**이고 가중치는 반영비율로만 준다:
      · 정기시험 각 회차 — 선택형 + 서·논술형 = 100점
      · 수행평가 각 영역 — 만점 100점 (영역 합이 아니라 '각각')
      · 반영비율 합 = 100% (정기 + 수행), 영역별 비율 합 = 수행 전체 비율
    """
    problems = []
    exam = plan.get("exam") or {}
    count = int(first_num(exam.get("count"), 0))
    rounds = exam.get("rounds") or []
    if not isinstance(rounds, list):
        rounds = []

    for i in range(min(count, len(rounds))):
        r = rounds[i] if isinstance(rounds[i], dict) else {}
        mc = first_num(r.get("mc"), 0)
        essay = first_num(r.get("essay"), 0)
        if as_text(r.get("mc")) == "" and as_text(r.get("essay")) == "":
            continue  # 아직 안 정한 회차는 통과 (공란 허용)
        total = mc + essay
        if round(total, 3) != 100:
            label = as_text(r.get("label")) or f"{i + 1}회 정기시험"
            problems.append(
                f"{label}: 선택형 {fmt_num(mc)}점 + 서·논술형 {fmt_num(essay)}점 "
                f"= {fmt_num(total)}점 (각 회차는 100점 만점이어야 합니다)"
            )

    exam_ratio = 0.0 if count == 0 else first_num(exam.get("ratio"), 0)
    perf_ratio = first_num(plan.get("perf_ratio"), 100.0 - exam_ratio)

    areas = plan.get("perf_areas") or []
    if isinstance(areas, list) and areas:
        # 각 영역은 100점 만점 (합이 아니다)
        for i, a in enumerate(areas):
            if not isinstance(a, dict):
                continue
            if as_text(a.get("points")) == "":
                continue  # 안 적었으면 100 으로 채워진다
            n = first_num(a.get("points"), 0)
            if round(n, 3) != 100:
                name = as_text(a.get("name")) or f"영역{i + 1}"
                problems.append(
                    f"수행평가 '{name}' 만점 {fmt_num(n)}점 — 각 평가는 100점 만점이고 "
                    f"가중치는 반영비율(%)로만 줍니다"
                )
        # 영역별 반영비율 합 = 수행평가 전체 반영비율
        ratios = [first_num(a.get("ratio"), 0) for a in areas if isinstance(a, dict)]
        if any(r > 0 for r in ratios):
            total = sum(ratios)
            if round(total, 3) != round(perf_ratio, 3):
                detail = " + ".join(
                    f"{as_text(a.get('name')) or f'영역{i + 1}'} {fmt_num(first_num(a.get('ratio'), 0))}%"
                    for i, a in enumerate(areas) if isinstance(a, dict)
                )
                problems.append(
                    f"수행평가 영역 반영비율 합: {detail} = {fmt_num(total)}% "
                    f"(수행평가 전체 {fmt_num(perf_ratio)}% 와 같아야 합니다)"
                )

    # 정기시험 회차별 반영비율 합 = 정기시험 전체 반영비율
    r_ratios = [
        first_num(rounds[i].get("ratio"), 0)
        for i in range(min(count, len(rounds))) if isinstance(rounds[i], dict)
    ]
    if any(r > 0 for r in r_ratios):
        total = sum(r_ratios)
        if round(total, 3) != round(exam_ratio, 3):
            problems.append(
                f"정기시험 회차별 반영비율 합: {fmt_num(total)}% "
                f"(정기시험 전체 {fmt_num(exam_ratio)}% 와 같아야 합니다)"
            )

    if round(exam_ratio + perf_ratio, 3) != 100:
        problems.append(
            f"반영비율 합: 정기시험 {fmt_num(exam_ratio)}% + 수행평가 {fmt_num(perf_ratio)}% "
            f"= {fmt_num(exam_ratio + perf_ratio)}% (100%여야 합니다)"
        )
    return problems


# ---------------------------------------------------------------------------
# 양식 수용 한도 — 넘치면 거부하지 않고 수용분만 채우고 안내한다
# ---------------------------------------------------------------------------
def apply_capacity(plan: dict, manifest: dict) -> list:
    """한도를 넘는 항목을 잘라내고, 무엇이 왜 빠졌는지 안내 문구를 돌려준다."""
    limits = manifest.get("limits") or {}
    notices = []

    for key, cap, label in (
        ("perf_areas", limits.get("perf_areas_max"), "수행평가 영역"),
        ("perf_plans", limits.get("perf_plans_max"), "수행평가 출제 계획"),
    ):
        items = plan.get(key)
        if cap is None or not isinstance(items, list) or len(items) <= cap:
            continue
        dropped = items[cap:]
        plan[key] = items[:cap]
        names = ", ".join(
            as_text(x.get("name")) or f"{i + cap + 1}번째"
            for i, x in enumerate(dropped) if isinstance(x, dict)
        )
        notices.append(
            f"{label} {len(items)}개 중 {cap}개만 문서에 넣었습니다. "
            f"빠진 항목: {names}. 현재 양식이 {cap}개까지만 담을 수 있어서이며, "
            f"빠진 내용은 한글에서 직접 편집해 추가해야 합니다."
        )

    exam = plan.get("exam")
    if isinstance(exam, dict):
        allowed = limits.get("exam_count") or [0, 1, 2]
        count = int(first_num(exam.get("count"), 0))
        cap = max(allowed)
        if count > cap:
            exam["count"] = cap
            rounds = exam.get("rounds")
            if isinstance(rounds, list) and len(rounds) > cap:
                exam["rounds"] = rounds[:cap]
            notices.append(
                f"정기시험 {count}회 중 {cap}회분만 문서에 넣었습니다. "
                f"현재 양식이 {cap}회까지만 담을 수 있어서이며, "
                f"나머지 회차는 한글에서 직접 편집해 추가해야 합니다."
            )

    return notices


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

    # 4) unused_handling — 미사용 회차/영역 칸은 UNUSED_MARK 로 채운다.
    #    ⚠ "교사가 아직 안 정해서 비운 칸(공란)" 과 다르다.
    #      여기 있는 것은 **구조적으로 쓰이지 않는 칸**(시험 1회인데 2회차 칸,
    #      수행 1개인데 2번째 열)이고, 학교 관행상 '˙' 를 찍는다 (실측).
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
        values["{{" + name + "}}"] = UNUSED_MARK

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
