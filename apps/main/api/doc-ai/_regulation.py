#!/usr/bin/env python3
"""학업성적관리규정 검증기 (V01~V18).

근거: docs/평가반영비율_한계선_정리_daedong-v2.md (2026학년도 규정 실측 분석본)
수치·조문·교과 목록은 전부 _assets/regulation-2026.json 에서 읽는다 — 이 파일은 조립만 한다.
규정이 개정되면 자산만 갈아끼운다.

check_scales(_fill) 와 역할이 다르다:
  · check_scales — 문서가 성립하려면 맞아야 하는 **산수** (회차 100점, 비율 합 100%)
  · 이 파일     — 규정이 정한 **한계선** (수행 ≥30%, 영역 ≤40%, 서논술 ≥30% …)

severity:
  ERROR — 생성 차단. 위반 내용 + 근거 조문을 교사에게 보여 입력을 고치게 한다
  WARN  — 생성은 진행하되 확인 카드·완료 안내에 표시
  FLAG  — 위반이 아니라 절차 표식 ("학업성적관리위원회 심의 대상")
  SKIP  — 아직 수집하지 않는 항목이라 검사하지 않음 (기본점수 등)
"""
import re

from _fill import EXAM_METHOD_KEYS, as_text, first_num, fmt_num


# 검사하지 않는 severity — 규칙 정의는 자산에 남기되 판정은 만들지 않는다.
#   SKIP     — 수집 항목이 아직 없어 검사할 수 없다 (기본점수 V11)
#   DISABLED — 학교가 "이 단계에서는 보지 않는다" 고 정했다 (심의 표식 V09)
OFF = ("SKIP", "DISABLED")


def enabled(reg: dict, code: str) -> bool:
    spec = (reg.get("rules") or {}).get(code) or {}
    return spec.get("severity") not in OFF


def _find(reg: dict, code: str, message: str, **extra) -> dict:
    spec = (reg.get("rules") or {}).get(code) or {}
    out = {
        "code": code,
        "severity": spec.get("severity", "WARN"),
        "article": spec.get("article", ""),
        "title": spec.get("title", ""),
        "message": message,
    }
    out.update(extra)
    return out


def _display(names) -> str:
    """안내 문구에 쓸 교과 목록. 표기 변형('진로와 직업'/'진로와직업')은 하나로 묶는다.

    목록은 자산(regulation-2026.json)이 진실이다 — 메시지에 교과명을 적어 두면
    조문이 개정될 때 자산만 고쳐지고 문구는 옛말을 하게 된다.
    """
    seen, out = set(), []
    for n in names or []:
        key = re.sub(r"\s", "", as_text(n))
        if key and key not in seen:
            seen.add(key)
            out.append(as_text(n))
    return "·".join(out)


def _has(subject: str, names) -> bool:
    """교과명 부분 일치 ('기술·가정' 과 '기술가정' 을 모두 잡기 위해)."""
    s = as_text(subject)
    return bool(s) and any(n and n in s for n in (names or []))


def _decimals(x: float) -> int:
    s = f"{round(float(x), 6):f}".rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


# ---------------------------------------------------------------------------
# 계획 유형 (A/B/C/D)
# ---------------------------------------------------------------------------
def infer_plan_type(plan: dict, variant: str = "") -> str:
    """교사가 유형을 고르지 않았을 때만 데이터로 추정한다.

    ⚠ 규정상 유형 B·C 는 임의규정이므로 **강제하지 않는다** (문서 7-2).
      추정은 검증을 돌리기 위한 것이고, 선택 자체는 교사 몫이다.
    """
    t = as_text(plan.get("plan_type")).upper()
    if t in ("A", "B", "C", "D"):
        return t
    if variant == "grade1_free":
        return "D"
    grade = int(first_num(plan.get("grade"), 0))
    semester = int(first_num(plan.get("semester"), 0))
    if grade == 1 and semester == 2:
        return "D"
    count = int(first_num((plan.get("exam") or {}).get("count"), -1))
    if count == 0:
        return "C"
    if count == 1:
        return "B"
    return "A"


# ---------------------------------------------------------------------------
# 검증
# ---------------------------------------------------------------------------
def check(plan: dict, reg: dict, variant: str = "") -> list:
    """규정 위반·확인사항을 찾아 목록으로 돌려준다 (ERROR/WARN/FLAG)."""
    if not reg:
        return []

    th = reg.get("thresholds") or {}
    el = reg.get("eligibility") or {}
    findings = []

    subject = as_text(plan.get("subject"))
    grade = int(first_num(plan.get("grade"), 0))
    semester = int(first_num(plan.get("semester"), 0))
    weekly = first_num(plan.get("weekly_hours"), 0)
    ptype = infer_plan_type(plan, variant)

    exam = plan.get("exam") or {}
    count = int(first_num(exam.get("count"), 0))
    rounds = exam.get("rounds") if isinstance(exam.get("rounds"), list) else []
    rounds = [r for r in rounds if isinstance(r, dict)][:count]

    exam_ratio = 0.0 if count == 0 else first_num(exam.get("ratio"), 0)
    areas = plan.get("perf_areas") if isinstance(plan.get("perf_areas"), list) else []
    areas = [a for a in areas if isinstance(a, dict)]

    area_ratios = [first_num(a.get("ratio"), 0) for a in areas]
    perf_total = sum(area_ratios) if any(area_ratios) else (100.0 - exam_ratio)

    # 서·논술형 환산 합계 — 분모는 **학기말 총 배점**(지필 환산 + 수행 환산 = 100).
    # 정기시험 내 30% 가 아니다 (문서 7-4). AI 가 준 essay_total_ratio 를 믿지 않고 재계산한다.
    # ⚠ 정기시험 3분류 중 **essay(서·논술형)만** 산입한다. short(단답형·완성형)는
    #    주관식이지만 규정이 말하는 서·논술형이 아니다 (2026 학교 확정).
    essay_from_exam = sum(first_num(r.get("essay_ratio"), 0) for r in rounds)
    essay_from_perf = sum(first_num(a.get("essay_ratio"), 0) for a in areas)
    essay_total = essay_from_exam + essay_from_perf

    scoring = ptype != "D"

    # ── V12: 자유학기에 정기시험 ────────────────────────────────────────────
    if ptype == "D" and count > 0:
        findings.append(_find(reg, "V12",
            f"자유학기(1학년 2학기)에는 정기시험을 실시하지 않습니다. "
            f"현재 {count}회로 잡혀 있습니다."))

    if not scoring:
        # 자유학기는 점수화하지 않으므로 비율 규칙이 성립하지 않는다
        findings += _soft_checks(plan, reg, areas, subject)
        return [f for f in findings if f.get("severity") not in OFF]

    # ── V01: 수행 반영 합계 ≥ 30% ──────────────────────────────────────────
    if round(perf_total, 3) < th.get("perf_total_min", 30):
        findings.append(_find(reg, "V01",
            f"수행평가 반영 합계가 {fmt_num(perf_total)}% 입니다. "
            f"규정상 {th.get('perf_total_min', 30)}% 이상이어야 합니다."))

    # ── V02 / V03: 수행 단일 영역 ≤ 40% (완화 단서 대상은 WARN) ─────────────
    cap = th.get("perf_area_max", 40)
    relaxed = _has(subject, el.get("relaxed_area_cap_subjects")) or weekly == 1
    for i, a in enumerate(areas):
        r = first_num(a.get("ratio"), 0)
        if r > cap:
            name = as_text(a.get("name")) or f"{i + 1}번째 영역"
            if relaxed:
                findings.append(_find(reg, "V03",
                    f"수행평가 '{name}' 이 {fmt_num(r)}% 입니다. "
                    f"{subject or '이 교과'}는 영역당 {cap}% 상한의 완화 단서 대상일 수 있으니 "
                    f"위원회 심의에서 확인해 주세요."))
            else:
                findings.append(_find(reg, "V02",
                    f"수행평가 '{name}' 이 {fmt_num(r)}% 입니다. "
                    f"수행평가 한 영역은 {cap}% 를 넘을 수 없습니다."))

    # ── V04: 서·논술형 ≥ 총 배점의 30% (유형 C·D 제외) ──────────────────────
    if ptype not in ("C", "D"):
        need = th.get("essay_total_min", 30)
        if round(essay_total, 3) < need:
            findings.append(_find(reg, "V04",
                f"서·논술형 반영비율 합계가 {fmt_num(essay_total)}% 입니다 "
                f"(정기시험 {fmt_num(essay_from_exam)}% + 수행 {fmt_num(essay_from_perf)}%). "
                f"학기말 총 배점의 {need}% 이상이어야 합니다 — "
                f"분모는 정기시험이 아니라 지필+수행 환산 합계입니다."))

    # ── V05: 정기시험 매 회차에 서·논술형 포함 ──────────────────────────────
    for i, r in enumerate(rounds):
        if all(as_text(r.get(k)) == "" for k in EXAM_METHOD_KEYS):
            continue  # 아직 안 정한 회차
        if first_num(r.get("essay"), 0) <= 0:
            label = as_text(r.get("label")) or f"{i + 1}회 정기시험"
            findings.append(_find(reg, "V05",
                f"{label} 에 서·논술형 문항이 없습니다. 정기시험은 매 회차 서·논술형을 포함해야 합니다."))

    # ── V06: 지필 1회면 반영 ≤ 40% ─────────────────────────────────────────
    single_cap = th.get("written_max_when_single_round", 40)
    if count == 1 and exam_ratio > single_cap:
        findings.append(_find(reg, "V06",
            f"정기시험을 1회만 실시하면 반영비율이 {single_cap}% 를 넘을 수 없습니다 "
            f"(현재 {fmt_num(exam_ratio)}%)."))

    # ── V07: 지필 1회 선택 자격 ────────────────────────────────────────────
    if count == 1:
        eligible = (
            _has(subject, el.get("type_b_subjects"))
            or (grade == 3 and semester == 2)
            or _has(subject, el.get("type_c_subjects"))
        )
        if not eligible:
            findings.append(_find(reg, "V07",
                f"{subject or '이 교과'}는 정기시험 1회 실시 대상이 아닙니다. "
                f"규정이 정한 대상은 {_display(el.get('type_b_subjects'))}, "
                f"{el.get('type_b_always_allowed_when', '3학년 2학기 편성 교과')}, "
                f"그리고 수행 100% 가능 교과입니다."))

    # ── V08: 수행 100% 선택 자격 ───────────────────────────────────────────
    if count == 0:
        eligible = _has(subject, el.get("type_c_subjects")) or weekly == 1
        if not eligible:
            findings.append(_find(reg, "V08",
                f"{subject or '이 교과'}는 수행평가 100% 대상이 아닙니다. "
                f"규정이 정한 대상은 {_display(el.get('type_c_subjects'))} 과목과 "
                f"주당 1시수 과목입니다."))

    # ── V09: 심의 대상 표식 — 기본 비활성 (자산의 severity 가 DISABLED) ─────
    #    횟수 선택은 교과 교사 재량이고 최종 검토는 관리자 단계에서 한다.
    if count <= 1 and enabled(reg, "V09"):
        why = "정기시험 1회" if count == 1 else "수행평가 100%"
        findings.append(_find(reg, "V09",
            f"{why} 는 학업성적관리위원회 심의와 학교장 결정이 필요합니다. "
            f"수강자 수·환산 처리 기준일도 위원회에서 별도로 정합니다.",
            review_reason=why))

    # ── V10: 수행을 논술형만으로 실시 불가 ──────────────────────────────────
    if areas and all(
        first_num(a.get("essay_ratio"), 0) > 0
        and first_num(a.get("essay_ratio"), 0) >= first_num(a.get("ratio"), 0) > 0
        for a in areas
    ):
        findings.append(_find(reg, "V10",
            "수행평가를 논술형만으로 실시할 수 없습니다. 논술형이 아닌 영역이 하나 이상 필요합니다."))

    # ── V13: 지필 만점 100점 ───────────────────────────────────────────────
    full = th.get("written_full_marks", 100)
    for i, r in enumerate(rounds):
        if all(as_text(r.get(k)) == "" for k in EXAM_METHOD_KEYS):
            continue
        total = sum(first_num(r.get(k), 0) for k in EXAM_METHOD_KEYS)
        if round(total, 3) != full:
            label = as_text(r.get("label")) or f"{i + 1}회 정기시험"
            findings.append(_find(reg, "V13",
                f"{label} 만점이 {fmt_num(total)}점입니다. 특별한 사유가 없으면 {full}점 만점으로 출제합니다."))

    # ── V14: 환산점수 소수 자리 ────────────────────────────────────────────
    maxdec = th.get("decimal_places_max", 2)
    bad = []
    for i, r in enumerate(rounds):
        rr = first_num(r.get("ratio"), exam_ratio / count if count else 0)
        for key in EXAM_METHOD_KEYS:
            v = first_num(r.get(key), 0) * rr / 100.0
            if v and _decimals(v) > maxdec:
                bad.append(f"{as_text(r.get('label')) or f'{i + 1}회'} {key}")
    for r in area_ratios:
        if r and _decimals(r) > maxdec:
            bad.append("수행 영역 반영비율")
    if bad:
        findings.append(_find(reg, "V14",
            f"환산점수에 소수 {maxdec}자리를 넘는 값이 생깁니다 ({', '.join(bad[:3])}). "
            f"배점·비율을 조정하면 성적 처리가 깔끔해집니다."))

    findings += _soft_checks(plan, reg, areas, subject)
    return [f for f in findings if f.get("severity") not in OFF]


def _soft_checks(plan: dict, reg: dict, areas: list, subject: str) -> list:
    """유형과 무관하게 보는 확인사항 (V15~V18)."""
    el = reg.get("eligibility") or {}
    findings = []

    # V15: 과제형 수행평가로 보이는 영역명
    hints = reg.get("homework_type_hints") or []
    hit = [as_text(a.get("name")) for a in areas if _has(a.get("name"), hints)]
    if hit:
        findings.append(_find(reg, "V15",
            f"'{', '.join(h for h in hit if h)}' 이(가) 과제형 수행평가로 보입니다. "
            f"수행평가는 수업 중 실시가 원칙이며 과제형은 금지됩니다 — 명칭이나 방식을 확인해 주세요."))

    # V16: 추상적인 영역명
    abstract = reg.get("abstract_area_name_hints") or []
    vague = [
        as_text(a.get("name")) for a in areas
        if as_text(a.get("name")) and (
            _has(a.get("name"), abstract) or re.fullmatch(r"\S{0,3}\d", as_text(a.get("name")))
        )
    ]
    if vague:
        findings.append(_find(reg, "V16",
            f"수행평가 영역명 '{', '.join(vague)}' 이(가) 추상적입니다. "
            f"무엇을 평가하는지 드러나는 이름이면 학생 안내와 기록에 좋습니다."))

    # V17: 결시·학적변동자 처리 기준 누락
    #  ⚠ v3 양식에서 이 칸의 의미는 **점수**다 ("각 영역당 20점"). 기준 문장이 아니라
    #    미응시 시 몇 점을 주는지를 적는다 — 필드명도 absentee_points 로 바뀌었다.
    plans = plan.get("perf_plans") if isinstance(plan.get("perf_plans"), list) else []
    named = [p for p in plans if isinstance(p, dict) and as_text(p.get("name"))]
    if named and not any(as_text(p.get("absentee_points")) for p in named):
        findings.append(_find(reg, "V17",
            "수행평가 미응시자 점수가 비어 있습니다 (예: 각 영역당 20점). "
            "평가계획서 필수 기재 항목입니다."))

    # V18: 체육·예술인데 성취도 A~E 표기
    if _has(subject, el.get("arts_pe_subjects")):
        levels = plan.get("achievement_levels")
        if isinstance(levels, dict) and any(as_text(levels.get(k)) for k in ("D", "E")):
            findings.append(_find(reg, "V18",
                f"{subject}는 성취도를 A~C 로 산출합니다. D·E 진술이 입력되어 있습니다."))

    return findings


# ---------------------------------------------------------------------------
# 결과 정리
# ---------------------------------------------------------------------------
def split(findings: list) -> dict:
    out = {"ERROR": [], "WARN": [], "FLAG": []}
    for f in findings:
        out.setdefault(f.get("severity", "WARN"), []).append(f)
    return out


def format_line(f: dict) -> str:
    art = f" ({f['article']})" if f.get("article") else ""
    return f"[{f['code']}] {f['message']}{art}"
