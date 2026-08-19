#!/usr/bin/env python3
"""manifest v3 계약대로 template-master.hwpx 를 채우는 로직 (generate.py 가 import).

계약 출처: _assets/template-manifest.json (= doc-ai-template-v3 FINAL + 수집 명세)
  token_paths            — 토큰 → 값 경로. FINAL 의 direct_tokens + pattern_tokens 를
                           기계가 읽을 수 있게 펼친 표 (170개 전수 대조는 tests/test_v3.py)
  perf_plan_block_tokens — 출제계획 블록 b=1..3(가·나·다) × 요소 g=1..3 × 수준 k=1..4
  composition_rules      — EXAM_INTRO / EXAM_RATIO_SENT(3분류) / methods 2줄
  unused_handling        — 미사용 칸 '˙' + PP3·PP2 블록 삭제
  final_check            — 잔여 '{{' 0 + verify_hwpx + 회차 100점 + 비율 합 100

⚠ _hwpx 엔진과 template-master.hwpx 는 수정하지 않는다. 이 파일만 고친다.
"""
import re
from pathlib import Path

TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")

# 구조적으로 쓰이지 않는 칸에 찍는 기호 (U+02D9 DOT ABOVE) — 학교 관행 실측.
# 교사가 아직 안 정해 비워 둔 "공란" 과는 다르다. 공란은 빈 문자열 그대로 둔다.
UNUSED_MARK = "\u02d9"
NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")

# 정기시험 평가방법 3분류 (2026 학교 확정). 회차 100점 = mc + short + essay.
# ⚠ 서·논술형 30% 산입은 essay 만이다 — short(단답형·완성형)는 주관식이지만 제외된다.
# 검토 표식 — **대화·확인 카드 전용**이다. 결재 문서에 ⚠ 가 인쇄되면 안 된다.
# AI 가 성취기준 코드를 제안하면 "⚠ 원문 대조 확인 필요" 를 붙이는데, 그 표식이
# 필드 값에 섞여 들어오는 일이 있다. 문서로 나가기 직전에 걷어낸다.
REVIEW_MARK_RE = re.compile(r"\s*[⚠※]\s*원문\s*대조\s*확인\s*필요\s*|\s*⚠\s*검토\s*필요\s*|⚠")

EXAM_METHOD_KEYS = ("mc", "short", "essay")
EXAM_METHOD_LABELS = {"mc": "선택형", "short": "단답형·완성형", "essay": "서·논술형"}


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
# 라우팅 — 학년 × 시험 횟수로 양식을 정한다 (manifest v4 routing)
#
# v3 까지는 "마스터 한 장 + 예외" 였지만 v4 는 유형별 양식 6종이다. 학년·회차 라벨·
# '˙'·유형 문장 구조가 **양식에 인쇄돼 있어** 코드가 만들 것이 그만큼 줄었다.
# 어떤 칸이 있는지는 token-map.json 이 유일한 근거다 — 여기서 추측하지 않는다.
# ---------------------------------------------------------------------------
LEVEL_KEYS = ("A", "B", "C", "D", "E")


def route_key(plan: dict, manifest: dict) -> str:
    """계획 → routing 키. 자유학기가 먼저다 (1학년 2학기는 시험 횟수를 보지 않는다)."""
    routing = manifest.get("routing") or {}
    grade = int(first_num(plan.get("grade"), 0))
    semester = int(first_num(plan.get("semester"), 0))
    if grade == 1 and semester == 2 and "grade1_semester2" in routing:
        return "grade1_semester2"
    exam = plan.get("exam")
    count = int(first_num((exam or {}).get("count"), 0)) if isinstance(exam, dict) else 0
    return f"grade{grade}_exam{count}"


def token_set(manifest: dict, token_map: dict, key: str) -> set:
    """그 양식이 실제로 가진 토큰 이름. 없는 키면 빈 집합."""
    entry = (manifest.get("routing") or {}).get(key) or {}
    return set(token_map.get(entry.get("file"), []))


def route_spec(manifest: dict, token_map: dict, key: str) -> dict:
    """양식 명세. **한도·성취수준은 token-map 에서 센다** — 두 곳에 적지 않는다.

    양식 파일이 없는 조합(예: 3학년 시험 2회)은 file 이 빈 문자열로 나가고,
    generate 가 "해당 유형 양식 없음" 으로 안내한다.
    """
    entry = (manifest.get("routing") or {}).get(key) or {}
    toks = token_set(manifest, token_map, key)
    perf_areas = sum(1 for n in range(1, 10) if f"P{n}_NAME" in toks)
    perf_plans = sum(1 for n in range(1, 10) if f"PP{n}_NAME" in toks)
    free_blocks = sum(1 for n in range(1, 10) if f"FPP{n}_NAME" in toks)
    exam_rounds = sum(1 for r in range(1, 5) if f"EX{r}_MC" in toks)
    return {
        "key": key,
        "label": route_label(key, entry),
        "file": entry.get("file", ""),
        "tokens": toks,
        "levels": [lv for lv in LEVEL_KEYS if f"LV_{lv}_1" in toks],
        "level_cells": max((c for lv in LEVEL_KEYS for c in range(1, 9)
                            if f"LV_{lv}_{c}" in toks), default=0),
        "scoring": entry.get("scoring", True),
        "special": entry.get("special", ""),
        "subjects_hint": entry.get("subjects_hint") or [],
        "limits": {
            "exam_count": [exam_rounds],
            "perf_areas_max": perf_areas,
            "perf_plans_max": perf_plans,
            "free_blocks_max": free_blocks,
        },
    }


def subject_matches(subject, names) -> bool:
    """교과명 부분 일치 ('기술·가정' 과 '기술가정' 을 같은 것으로 본다)."""
    s = re.sub(r"[\s·・･ㆍ]", "", as_text(subject))
    if not s:
        return False
    for n in names or []:
        t = re.sub(r"[\s·・･ㆍ]", "", as_text(n))
        if t and (t in s or s in t):
            return True
    return False


def route_label(key: str, entry: dict) -> str:
    if entry.get("type"):
        return entry["type"]
    m = re.fullmatch(r"grade(\d)_exam(\d)", key or "")
    if m:
        return f"{m.group(1)}학년 · 정기시험 {m.group(2)}회"
    return key or "미상"


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

    if as_text(plan.get("weekly_hours")) == "":
        # 자유학기라도 시수는 받아야 한다 — 시수는 점수가 아니라 수업 계획이다
        return {"applied": False, "reason": "weekly_hours 미입력", "months": [], "row": None}

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


UNCHECKED, CHECKED = "\u25a1", "\u25a0"   # □ / ■


def methods_rule(manifest: dict, n) -> dict | None:
    """평가방법 체크박스 규칙. v4 FINAL 은 담지 않아 우리 쪽 methods_lines 를 먼저 본다."""
    lines = manifest.get("methods_lines") or {}
    return lines.get(f"line{n}") or (manifest.get("composition_rules") or {}).get(f"methods_line{n}")


def compose_methods(rule: dict, chosen) -> str:
    """평가방법 체크박스 줄을 만든다. 선택된 항목만 ■ 로 바꾼다.

    템플릿 표기가 두 가지다:
      · v2 — "{c1} 서술·논술 …"  (자리표시자)
      · v3 — "□ 서술·논술 …"     (원본 그대로. 계란님 한글 원본을 살린 형태)
    둘 다 지원한다. 항목 문자열(반각 ･ 포함)은 원본을 건드리지 않는다.
    """
    if not isinstance(rule, dict):
        return ""
    picked = {normalize_method(x) for x in (chosen or []) if x}
    order = rule["options_order"]
    marks = [CHECKED if normalize_method(o) in picked else UNCHECKED for o in order]
    out = rule["template"]

    if "{c1}" in out:                      # v2 자리표시자
        for i, m in enumerate(marks, start=1):
            out = out.replace("{c" + str(i) + "}", m)
        return out

    # v3 — n번째 □ 를 순서대로 교체한다. options_order 와 □ 개수가 맞아야 하며,
    # 어긋나면 원본을 그대로 둔다 (체크가 엉뚱한 항목에 붙는 것보다 낫다).
    if out.count(UNCHECKED) != len(marks):
        return out
    parts = out.split(UNCHECKED)
    return "".join(parts[i] + marks[i] for i in range(len(marks))) + parts[-1]


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
            {**r, **{
                k: points_label(r.get(k), first_num(r.get("ratio"), even))
                for k in EXAM_METHOD_KEYS
            }}
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

    # 서·논술형 전체 반영비율 — **서버가 재계산한다.** AI 가 준 essay_total_ratio 는
    # 쓰지 않는다. 분모는 학기말 총 배점(지필 환산 + 수행 환산 = 100)이고,
    # 분자는 essay 만이다 — 단답형·완성형(short)은 주관식이지만 산입하지 않는다.
    exam_essay = sum(
        first_num(r.get("essay_ratio"), 0)
        for r in (rounds if isinstance(rounds, list) else [])[:count]
        if isinstance(r, dict)
    )
    essay_total = exam_essay + perf_essay
    d["essay_total_ratio_display"] = pct(essay_total) if essay_total else ""
    d["_essay_total"] = essay_total
    d["_exam_count"] = count
    # 월 이름은 **행 순서로 서버가 정한다** (학년 무관 8~12월 5행 고정).
    # 작년 1학년 자료에 "12, 1월" 처럼 병합된 표기가 있지만 계승하지 않는다 —
    # 올해 양식은 어느 학년이든 5행이고 1월 행이 없다 (2026-08-19 계란님 확정).
    d["_months"] = list(((manifest.get("monthly_plan") or {}).get("months")) or [])
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
        if all(as_text(r.get(k)) == "" for k in EXAM_METHOD_KEYS):
            continue  # 아직 안 정한 회차는 통과 (공란 허용)
        parts = [(EXAM_METHOD_LABELS[k], first_num(r.get(k), 0)) for k in EXAM_METHOD_KEYS]
        total = sum(v for _n, v in parts)
        if round(total, 3) != 100:
            label = as_text(r.get("label")) or f"{i + 1}회 정기시험"
            detail = " + ".join(f"{n} {fmt_num(v)}점" for n, v in parts)
            problems.append(
                f"{label}: {detail} = {fmt_num(total)}점 (각 회차는 100점 만점이어야 합니다)"
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
# 평가방법 3분류 ↔ 현행 양식의 칸 (과도기)
# ---------------------------------------------------------------------------
def check_exam_categories(plan: dict, manifest: dict) -> list:
    """양식에 칸이 없는 분류에 배점이 들어오면 알린다.

    3분류는 확정됐지만 현행 template.hwpx 의 정기시험 표는 2분류(선택형·서·논술형)
    뿐이다. 단답형·완성형 배점은 갈 자리가 없다.

    **합치지 않는다.** 선택형에 몰래 더하면 교사가 본 값과 문서 값이 갈라진다.
    빠졌다는 사실을 알리고 어떻게 할지는 교사가 정한다 (제0원칙).
    새 마스터 양식이 배치되면 manifest.exam.template_categories 가 3개가 되어
    이 안내는 저절로 사라진다.
    """
    spec = (manifest or {}).get("exam") or {}
    cats = spec.get("method_categories")
    have = spec.get("template_categories")
    if not isinstance(cats, list) or not isinstance(have, list):
        return []
    missing = [c for c in cats if isinstance(c, dict) and c.get("key") not in have]
    if not missing:
        return []

    exam = plan.get("exam")
    exam = exam if isinstance(exam, dict) else {}
    count = int(first_num(exam.get("count"), 0))
    rounds = exam.get("rounds") if isinstance(exam.get("rounds"), list) else []

    notices = []
    for i, r in enumerate(rounds[:count]):
        if not isinstance(r, dict):
            continue
        for c in missing:
            v = first_num(r.get(c["key"]), 0)
            if v <= 0:
                continue
            label = as_text(r.get("label")) or f"{i + 1}회 정기시험"
            names = " · ".join(
                as_text(x.get("short_label") or x.get("label"))
                for x in cats if x.get("key") in have
            )
            notices.append(
                f"{label}의 {as_text(c.get('short_label') or c.get('label'))} "
                f"{fmt_num(v)}점은 문서에 들어가지 않았습니다. "
                f"현행 양식의 정기시험 표에는 {names} 칸만 있습니다. "
                f"새 양식이 배포되기 전까지는 한글에서 직접 편집해 추가해 주세요 "
                f"(선택형 칸에 합산해 적을지는 교사가 정합니다 — 서버가 임의로 합치지 않습니다)."
            )
    return notices


# ---------------------------------------------------------------------------
# 횟수 세트 — 시험 횟수 × 수행 개수 (실측 + 학교 확정)
# ---------------------------------------------------------------------------
def check_perf_count(plan: dict, rule: dict | None) -> list:
    """세트(시험 0→수행 3 / 1→2 / 2→1~2)를 벗어나면 안내 문구를 돌려준다.

    **막지 않는다.** 규정 위반(_regulation)과 달리 이건 학교가 정한 관행이라,
    교사가 그대로 원하면 담기는 만큼 만들고 무엇이 빠졌는지 알린다 (제0원칙).
    수치·이유·전환 안내는 전부 school-constants 의 perf_count_rule 에서 읽는다.
    """
    if not isinstance(rule, dict):
        return []
    exam = plan.get("exam")
    exam = exam if isinstance(exam, dict) else {}
    count = int(first_num(exam.get("count"), 0))
    spec = (rule.get("by_exams") or {}).get(str(count))
    areas = plan.get("perf_areas")
    n = len(areas) if isinstance(areas, list) else 0
    if not isinstance(spec, dict) or n == 0:
        return []

    lo, hi = spec.get("min"), spec.get("max")
    if not isinstance(lo, int) or not isinstance(hi, int) or lo <= n <= hi:
        return []

    want = f"{lo}개" if lo == hi else f"{lo}~{hi}개"
    msg = f"정기시험 {count}회면 수행평가는 {want}입니다 (현재 {n}개)."
    if as_text(spec.get("note")):
        msg += f" {as_text(spec['note'])}."
    msgs = [msg]

    # 작년과 달라진 조합이면 "무엇을 어떻게 정해야 하는지" 까지 알린다
    for t in rule.get("transition_notes") or []:
        was = (t or {}).get("was") or {}
        if int(first_num(was.get("exams"), -1)) == count and int(first_num(was.get("perf_areas"), -1)) == n:
            msgs.append(f"{as_text(t.get('case'))}: {as_text(t.get('guidance'))}")
    return msgs


# ---------------------------------------------------------------------------
# 양식 수용 한도 — 넘치면 거부하지 않고 수용분만 채우고 안내한다
# ---------------------------------------------------------------------------
def check_plan_blocks(plan: dict, limits: dict | None = None) -> list:
    """수행평가 영역 수와 출제 계획 수가 다르면 알린다.

    문서에는 **내용이 있는 계획만큼만** 블록이 들어간다. 빈 블록을 남기면
    "* 수행평가 미응시자 :" 줄만 덩그러니 찍혀 앞 블록과 중복처럼 보인다.
    """
    limits = limits or {}
    areas = plan.get("perf_areas")
    plans = plan.get("perf_plans")
    n_areas = len(areas) if isinstance(areas, list) else 0
    named = sum(1 for p in (plans or []) if isinstance(p, dict) and as_text(p.get("name")))
    cap = int(limits.get("perf_plans_max") or 0)
    n_areas = min(n_areas, cap) if cap else n_areas
    if not n_areas or named >= n_areas:
        return []
    missing = [
        as_text(a.get("name")) or f"{i + 1}번째"
        for i, a in enumerate(areas[:n_areas]) if isinstance(a, dict)
    ][named:]
    return [
        f"수행평가는 {n_areas}개인데 출제 계획은 {named}개만 받았습니다. "
        f"계획이 없는 항목({', '.join(missing)})은 출제 계획 블록이 문서에 들어가지 않았습니다. "
        f"한글에서 직접 추가하거나, 대화로 계획을 채운 뒤 다시 생성해 주세요."
    ]


def apply_capacity(plan: dict, manifest: dict, limits: dict | None = None) -> list:
    """한도를 넘는 항목을 잘라내고, 무엇이 왜 빠졌는지 안내 문구를 돌려준다.

    limits 를 주면 그것을 쓴다 (양식 유형별 한도). 없으면 manifest 최상위 값.
    """
    limits = limits or manifest.get("limits") or {}
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
    """EXAM_INTRO / EXAM_RATIO_SENT — 회차 수에 따라 고정 문구를 고른다.

    배점 대표값은 exam.{k}_points 를 쓰되 없으면 **1회차 값**으로 채운다 —
    교사가 회차별로만 적었을 때 문장이 0점으로 나가지 않게.
    단답형·완성형이 0점이면 그 항을 아예 빼야 한다. "단답형·완성형 0점" 이라고
    적힌 공문서는 출제하지 않는 유형을 출제하는 것처럼 읽힌다 (FINAL _note).
    """
    rules = manifest["composition_rules"]
    count = plan["_exam_count"]
    exam = plan.get("exam") or {}
    rounds = exam.get("rounds") if isinstance(exam.get("rounds"), list) else []
    first = rounds[0] if rounds and isinstance(rounds[0], dict) else {}

    intro = rules["EXAM_INTRO"].get(str(count), "")

    if count == 0:
        ratio_sent = rules["EXAM_RATIO_SENT"]["0"]
    else:
        ratio_sent = rules["EXAM_RATIO_SENT"]["ge1"]
        vals = {}
        for k in EXAM_METHOD_KEYS:
            raw = exam.get(f"{k}_points")
            if as_text(raw) == "":
                raw = first.get(k)
            vals[k] = first_num(raw, 0)
        if vals["short"] <= 0:
            ratio_sent = re.sub(r"\s*단답형·완성형 \{short\}점,", "", ratio_sent)
        subs = {"{exam_ratio}": fmt_num(first_num(exam.get("ratio"), 0)),
                "{exam.ratio}": fmt_num(first_num(exam.get("ratio"), 0))}
        for k, v in vals.items():
            subs["{" + k + "}"] = fmt_num(v)
            subs["{exam." + k + "_points}"] = fmt_num(v)   # v2 표기 호환
        for key, val in subs.items():
            ratio_sent = ratio_sent.replace(key, val)

    out = {"EXAM_INTRO": intro, "EXAM_RATIO_SENT": ratio_sent}

    # RATIO_BASIS — 시험이 없으면 "정기시험 및" 이 붙으면 안 된다 (v3.1 양식)
    basis = rules.get("RATIO_BASIS")
    if isinstance(basis, dict):
        out["RATIO_BASIS"] = basis.get("0" if count == 0 else "ge1", "")
    return out


# ---------------------------------------------------------------------------
# 토큰 → 값 표 만들기
#
# v4 부터는 **양식이 가진 토큰만** 채운다 (token-map.json). 치환표를 따로 두면
# 양식이 늘 때마다 두 곳을 고쳐야 하고, 한쪽만 고치면 '{{' 가 남은 문서가 나간다.
# ---------------------------------------------------------------------------
MONTH_RE = re.compile(r"^M([1-9])_(MONTH|HOURS|UNITS|STD|EVAL)$")
EXAM_RE = re.compile(r"^EX([1-9])_(MC|SHORT|ESSAY|ESSAY_RATIO|STD|PERIOD)$")
AREA_RE = re.compile(r"^P([1-9])_(NAME|POINTS|PERIOD)$")
# v4.1 — 성취수준은 수준당 4칸이다. 칸마다 성취기준 하나의 진술이 들어간다.
LV_RE = re.compile(r"^LV_([A-E])_([1-4])$")
PLAN_RE = re.compile(r"^PP([1-9])_(NAME|TASK|STD|HIGH|MID|LOW|METHODS1|METHODS2|ABSENT)$")
ELEM_RE = re.compile(r"^PP([1-9])_E([1-9])_(NAME|L([1-9])(_PTS)?)$")
FREE_RE = re.compile(r"^FPP([1-9])_(NAME|TASK|STD|METHODS1|METHODS2|LV_([A-E]))$")

PLAN_FIELD = {
    "NAME": "name", "TASK": "task", "STD": "standards",
    "HIGH": "criteria_high", "MID": "criteria_mid", "LOW": "criteria_low",
    "ABSENT": "absentee_points",
}
MONTH_FIELD = {"MONTH": "month", "HOURS": "hours_cum", "UNITS": "units",
               "STD": "standards", "EVAL": "eval_elements"}
EXAM_FIELD = {"MC": "mc", "SHORT": "short", "ESSAY": "essay",
              "ESSAY_RATIO": "essay_ratio", "STD": "standards", "PERIOD": "period"}
AREA_FIELD = {"NAME": "name", "POINTS": "points", "PERIOD": "period"}


def _at(seq, i):
    """리스트 i번째 dict. 없으면 빈 dict — 미사용 칸은 자연스럽게 공란이 된다."""
    if isinstance(seq, list) and 0 <= i < len(seq) and isinstance(seq[i], dict):
        return seq[i]
    return {}


def token_value(name: str, data: dict, manifest: dict, composed: dict) -> str:
    """토큰 이름 하나 → 문자열. 모르는 토큰이면 None (호출부가 알아채게)."""
    if name in composed:
        return composed[name]

    simple = {"SUBJECT": "subject", "MIN_ACH": "min_achievement_plan"}
    if name in simple:
        return as_text(data.get(simple[name]))
    if name in ("PURPOSE1", "PURPOSE2", "PURPOSE3"):
        return as_text(_seq(data.get("eval_purpose"), int(name[-1]) - 1))
    if name == "EXAM_TOTAL_RATIO":
        return as_text(get_path(data, "exam.ratio_display"))
    if name == "PERF_TOTAL_RATIO":
        return as_text(get_path(data, "perf.ratio_display"))
    if name == "PERF_ESSAY_RATIO":
        return as_text(get_path(data, "perf.essay_ratio_display"))
    if name == "POINTS_SUM":
        return as_text(get_path(data, "computed.points_sum"))
    if name == "ESSAY_TOTAL_RATIO":
        return as_text(data.get("essay_total_ratio_display"))

    m = MONTH_RE.match(name)
    if m:
        i, kind = int(m.group(1)) - 1, m.group(2)
        if kind == "MONTH":
            # 서버 고정값. 교사·AI 가 준 월 라벨은 쓰지 않는다 (행 순서가 곧 월이다)
            return as_text(_seq(data.get("_months"), i))
        return as_text(_at(data.get("monthly_plan"), i).get(MONTH_FIELD[kind]))
    m = EXAM_RE.match(name)
    if m:
        rounds = (data.get("exam") or {}).get("rounds")
        return as_text(_at(rounds, int(m.group(1)) - 1).get(EXAM_FIELD[m.group(2)]))
    m = AREA_RE.match(name)
    if m:
        return as_text(_at(data.get("perf_areas"), int(m.group(1)) - 1).get(AREA_FIELD[m.group(2)]))
    m = LV_RE.match(name)
    if m:
        return as_text(_seq(level_cells(data.get("achievement_levels"), m.group(1)), int(m.group(2)) - 1))

    m = ELEM_RE.match(name)
    if m:
        b, g, kind = int(m.group(1)), int(m.group(2)), m.group(3)
        grp = _at(_at(data.get("perf_plans"), b - 1).get("elements"), g - 1)
        if kind == "NAME":
            return as_text(grp.get("name"))
        k = int(m.group(4))
        lv = _at(grp.get("levels"), k - 1)
        return as_text(lv.get("points") if kind.endswith("_PTS") else lv.get("desc"))
    m = PLAN_RE.match(name)
    if m:
        item = _at(data.get("perf_plans"), int(m.group(1)) - 1)
        kind = m.group(2)
        if kind.startswith("METHODS"):
            return compose_methods(methods_rule(manifest, kind[-1]), item.get("methods"))
        return as_text(item.get(PLAN_FIELD[kind]))

    m = FREE_RE.match(name)
    if m:
        item = _at(data.get("free_activities"), int(m.group(1)) - 1)
        kind = m.group(2)
        if kind.startswith("METHODS"):
            return compose_methods(methods_rule(manifest, kind[-1]), item.get("methods"))
        if m.group(3):
            levels = item.get("levels")
            return as_text(levels.get(m.group(3))) if isinstance(levels, dict) else ""
        return as_text(item.get(PLAN_FIELD[kind]))

    return None


def _seq(seq, i):
    return seq[i] if isinstance(seq, list) and 0 <= i < len(seq) else ""


def level_cells(levels, key) -> list:
    """한 수준(A~E)의 칸 목록. 문자열 하나만 와도 1칸짜리로 받는다.

    v4.1 부터 수준마다 칸이 4개다. AI 가 예전처럼 문장 하나만 주더라도 문서가
    깨지지 않게 하되, **여러 기준을 한 줄로 압축하는 것**은 프롬프트가 막는다.
    """
    if not isinstance(levels, dict):
        return []
    v = levels.get(key)
    if isinstance(v, list):
        return v
    return [v] if as_text(v) else []


def strip_review_marks(text: str) -> str:
    """문서용 문자열에서 검토 표식을 걷어낸다. 문장 자체는 살린다."""
    if not text or ("⚠" not in text and "※ 원문" not in text):
        return text
    return REVIEW_MARK_RE.sub(" ", text).strip()


def review_marked_fields(values: dict) -> list:
    """검토 표식이 섞여 있던 토큰 이름 (교사에게 알리기 위해)."""
    return sorted(t.strip("{}") for t, v in values.items() if isinstance(v, str) and "⚠" in v)


def build_token_values(plan: dict, manifest: dict, spec: dict) -> tuple:
    """이 양식이 가진 토큰만 채운다. 모르는 토큰이 있으면 즉시 알린다.

    ⚠ 조용히 넘기지 않는다 — 치환되지 않은 '{{TOKEN}}' 이 그대로 인쇄된 공문서가
      나가는 것보다, 생성 단계에서 막히고 원인을 말해 주는 편이 낫다.
    """
    data = derive(plan, manifest)
    composed = compose_sentences(data, manifest)
    values, unknown = {}, []
    for name in sorted(spec["tokens"]):
        v = token_value(name, data, manifest, composed)
        if v is None:
            unknown.append(name)
            continue
        values["{{" + name + "}}"] = v
    if unknown:
        raise KeyError(f"치환 규칙이 없는 토큰: {', '.join(unknown[:8])}")

    # 검토 표식은 여기서 끝난다 — 결재 문서에 ⚠ 를 인쇄하지 않는다
    marked = review_marked_fields(values)
    for tok in values:
        values[tok] = strip_review_marks(values[tok])

    # unused_handling — v4 는 대부분 양식에 내장돼 있고 남는 것은 아래 한 가지다.
    #   "수행 1개인데 2열 양식" → P2 계열에 '˙'. (블록 삭제는 fill_document 가 한다)
    areas = data.get("perf_areas")
    used = len(areas) if isinstance(areas, list) else 0
    for n in range(used + 1, spec["limits"]["perf_areas_max"] + 1):
        for suffix in ("NAME", "POINTS", "PERIOD"):
            tok = "{{" + f"P{n}_{suffix}" + "}}"
            if tok in values:
                values[tok] = UNUSED_MARK
    data["_review_marked"] = marked
    return values, data


# ---------------------------------------------------------------------------
# 문서에 적용
# ---------------------------------------------------------------------------
def fill_document(sec, values: dict, data: dict, manifest: dict, spec: dict, *, ln,
                  find_text_indices, replace_text_anywhere, para_text):
    """미사용 블록 삭제 → 토큰 치환. 엔진 함수는 인자로 주입받는다(_hwpx 무수정)."""
    lim = spec["limits"]
    if lim["free_blocks_max"]:
        acts = data.get("free_activities")
        used = sum(1 for a in (acts or []) if isinstance(a, dict) and as_text(a.get("name")))
        prefix, cap = "FPP", lim["free_blocks_max"]
    else:
        plans = data.get("perf_plans")
        named = sum(1 for p in (plans or []) if isinstance(p, dict) and as_text(p.get("name")))
        # ⚠ **내용이 있는 출제 계획만큼만** 블록을 남긴다.
        #   예전에는 수행평가 영역 수까지 세어 "교사가 한글에서 채우도록" 빈 블록을
        #   남겼는데, 그 블록은 제목·표가 비고 "* 수행평가 미응시자 :" 줄만 보여서
        #   앞 블록의 같은 줄과 나란히 찍힌 것처럼 읽혔다 (실사용 신고).
        #   빠진 계획은 notices 로 알린다 — 유령 블록보다 문장 한 줄이 낫다.
        used = named
        prefix, cap = "PP", lim["perf_plans_max"]
    used = max(1, min(used, cap)) if cap else 0

    deleted = []
    for b in range(cap, used, -1):
        deleted += delete_block(sec, f"{prefix}{b}_", ln=ln, para_text=para_text)

    # 긴 토큰부터 — {{PP1_E1_L1}} 이 {{PP1_E1_L1_PTS}} 를 잘라먹지 않게
    replaced = 0
    for token in sorted(values, key=len, reverse=True):
        idxs = find_text_indices(sec, token)
        if not idxs:
            continue
        children = list(sec)
        for i in idxs:
            replaced += replace_text_anywhere(children[i], token, values[token], required=False)

    return {"replaced": replaced, "deleted_paras": deleted, "used_blocks": used}


def delete_block(sec, prefix: str, *, ln, para_text) -> list:
    """{{prefix...}} 토큰이 있는 문단 구간을 통째로 지운다 (앞의 빈 문단 1개 포함).

    시작·끝을 토큰 이름으로 못박지 않고 **그 접두를 가진 첫 문단 ~ 마지막 문단**으로
    잡는다. 양식마다 블록 안의 항목 순서가 달라도 따라간다.
    ⚠ 'PP1_' 은 'FPP1_' 과 겹치지 않는다 — 여는 중괄호까지 붙여 찾기 때문이다.
    """
    mark = "{{" + prefix
    kids = list(sec)
    hits = [i for i, ch in enumerate(kids) if mark in para_text(ch)]
    if not hits:
        return []
    start, end = min(hits), max(hits)
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
