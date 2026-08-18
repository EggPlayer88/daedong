#!/usr/bin/env python3
"""학업성적관리규정 검증기 V01~V18 — 규칙별 위반/통과 케이스."""
import importlib.util, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
REG = gen.load_regulation()
R = gen._regulation

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

def codes(plan, variant=""):
    return {f["code"] for f in R.check(plan, REG, variant)}

def sev(plan, code, variant=""):
    for f in R.check(plan, REG, variant):
        if f["code"] == code:
            return f
    return None

def P(**kw):
    """유형 A 정상안: 정기 2회 60% (각 100점, 서논 30점), 수행 2영역 20%씩, 서논 합 33%"""
    p = {
        "subject": "수학", "grade": 2, "semester": 2, "weekly_hours": 4,
        "exam": {"count": 2, "ratio": 60, "rounds": [
            {"label": "1회 정기시험", "ratio": 30, "mc": 70, "essay": 30, "essay_ratio": 9},
            {"label": "2회 정기시험", "ratio": 30, "mc": 70, "essay": 30, "essay_ratio": 9}]},
        "perf_areas": [
            {"name": "탐구 보고서", "points": 100, "ratio": 20, "essay_ratio": 8},
            {"name": "문제해결 과정 관찰", "points": 100, "ratio": 20, "essay_ratio": 7}],
        "perf_plans": [{"name": "탐구 보고서", "absentee_points": "별도 과제로 대체"}],
        "achievement_levels": {"A": "x", "B": "", "C": "", "D": "", "E": ""},
    }
    p.update(kw); return p

print("\n[0] 정상안은 위반 없음")
def t_clean():
    c = codes(P())
    assert not (c & {"V01","V02","V04","V05","V06","V07","V08","V10","V12","V13","V14","V15","V16","V17","V18"}), c
    assert "V09" not in c, "2회는 심의 대상이 아니다"
check("유형 A 정상안 → ERROR/WARN 없음", t_clean)

print("\n[1] 비율 한계선")
def t_v01():
    p = P(); p["exam"]["ratio"] = 80
    p["perf_areas"] = [{"name": "탐구 보고서", "points": 100, "ratio": 20, "essay_ratio": 20}]
    f = sev(p, "V01"); assert f and f["severity"] == "ERROR", f
    assert "30% 이상" in f["message"] and "제19조" in f["article"], f
check("V01 수행 합계 <30% → ERROR + 조문", t_v01)
def t_v01_ok():
    assert "V01" not in codes(P()), "정상안이 걸림"
check("V01 통과 (수행 40%)", t_v01_ok)
def t_v02():
    p = P(); p["exam"]["ratio"] = 50
    p["perf_areas"] = [{"name": "탐구", "points": 100, "ratio": 50, "essay_ratio": 30}]
    f = sev(p, "V02"); assert f and f["severity"] == "ERROR", f
    assert "40% 를 넘을 수 없" in f["message"], f["message"]
check("V02 영역 >40% (일반교과) → ERROR", t_v02)
def t_v03():
    for subj in ("음악", "미술", "체육"):
        p = P(subject=subj); p["exam"]["ratio"] = 50
        p["perf_areas"] = [{"name": "실기", "points": 100, "ratio": 50, "essay_ratio": 30}]
        f = sev(p, "V03"); assert f and f["severity"] == "WARN", (subj, f)
        assert "V02" not in codes(p), f"{subj}: ERROR 로도 잡힘"
check("V03 영역 >40% (음악·미술·체육) → WARN (완화 단서)", t_v03)
def t_v03_weekly1():
    p = P(subject="한문", weekly_hours=1); p["exam"]["ratio"] = 50
    p["perf_areas"] = [{"name": "한자 쓰기", "points": 100, "ratio": 50, "essay_ratio": 30}]
    assert "V03" in codes(p) and "V02" not in codes(p), codes(p)
check("V03 주당 1시수 과목도 완화 대상", t_v03_weekly1)

print("\n[2] 서·논술형 30% — 분모는 학기말 총 배점 (문서 7-4)")
def t_v04():
    p = P()
    for r in p["exam"]["rounds"]: r["essay_ratio"] = 3
    for a in p["perf_areas"]: a["essay_ratio"] = 2
    f = sev(p, "V04"); assert f and f["severity"] == "ERROR", f
    assert "10%" in f["message"], f["message"]           # 3+3+2+2
    assert "지필+수행 환산 합계" in f["message"], "분모 설명 없음"
check("V04 서논술 합계 <30% → ERROR + 분모 설명", t_v04)
def t_v04_denominator():
    """정기시험 '내' 30% 가 아니라 총 배점 30% 임을 고정."""
    p = P()
    # 정기시험 내부로는 30/100 = 30% 지만, 총 배점 환산으로는 9+9=18% 뿐
    for a in p["perf_areas"]: a["essay_ratio"] = 0
    f = sev(p, "V04")
    assert f, "정기시험 내 30% 를 총 배점 30% 로 오인해 통과시킴"
    assert "18%" in f["message"], f["message"]
check("V04 정기시험 내 30% 는 총 배점 30% 가 아니다", t_v04_denominator)
def t_v04_ok():
    assert "V04" not in codes(P()), "정상안(33%)이 걸림"
check("V04 통과 (9+9+8+7=33%)", t_v04_ok)
def t_v04_skip_c():
    p = P(subject="정보"); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    p["perf_areas"] = [{"name": "프로젝트 산출물", "points": 100, "ratio": 40, "essay_ratio": 0},
                       {"name": "코드 리뷰 활동", "points": 100, "ratio": 30, "essay_ratio": 0},
                       {"name": "실습 수행 관찰", "points": 100, "ratio": 30, "essay_ratio": 0}]
    assert "V04" not in codes(p), "유형 C 인데 서논술 30% 를 강제함"
check("V04 유형 C 는 적용 제외 (협의회 결정 사항)", t_v04_skip_c)

print("\n[3] 정기시험 규칙")
def t_v05():
    p = P(); p["exam"]["rounds"][1]["essay"] = 0; p["exam"]["rounds"][1]["mc"] = 100
    f = sev(p, "V05"); assert f and f["severity"] == "ERROR", f
    assert "2회 정기시험" in f["message"], f["message"]
check("V05 서논술 없는 회차 → ERROR (회차명 명시)", t_v05)
def t_v06():
    p = P(subject="도덕"); p["exam"] = {"count": 1, "ratio": 50, "rounds": [
        {"label": "정기시험", "ratio": 50, "mc": 70, "essay": 30, "essay_ratio": 15}]}
    p["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 50, "essay_ratio": 20}]
    f = sev(p, "V06"); assert f and f["severity"] == "ERROR", f
    assert "40%" in f["message"], f["message"]
check("V06 지필 1회인데 >40% → ERROR", t_v06)
def t_v06_ok():
    p = P(subject="도덕"); p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 12}]}
    p["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 30, "essay_ratio": 10},
                       {"name": "생활 실천 기록", "points": 100, "ratio": 30, "essay_ratio": 10}]
    assert "V06" not in codes(p) and "V07" not in codes(p), codes(p)
check("V06/V07 통과 — 도덕 40:60", t_v06_ok)
def t_v07():
    p = P(subject="수학", grade=2); p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 12}]}
    p["perf_areas"] = [{"name": "탐구 보고서", "points": 100, "ratio": 30, "essay_ratio": 10},
                       {"name": "문제해결 관찰", "points": 100, "ratio": 30, "essay_ratio": 10}]
    f = sev(p, "V07"); assert f and f["severity"] == "ERROR", f
check("V07 2학년 수학 지필 1회 → ERROR (자격 없음)", t_v07)
def t_v07_grade3():
    p = P(subject="수학", grade=3, semester=2)
    p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 12}]}
    p["perf_areas"] = [{"name": "탐구 보고서", "points": 100, "ratio": 30, "essay_ratio": 10},
                       {"name": "문제해결 관찰", "points": 100, "ratio": 30, "essay_ratio": 10}]
    assert "V07" not in codes(p), "3학년 2학기는 허용되어야 한다"
check("V07 3학년 2학기는 지필 1회 허용", t_v07_grade3)
def t_v08():
    p = P(subject="수학"); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    p["perf_areas"] = [{"name": "탐구 보고서", "points": 100, "ratio": 40, "essay_ratio": 40},
                       {"name": "문제해결 관찰", "points": 100, "ratio": 30, "essay_ratio": 0},
                       {"name": "포트폴리오", "points": 100, "ratio": 30, "essay_ratio": 0}]
    f = sev(p, "V08"); assert f and f["severity"] == "ERROR", f
check("V08 수학 수행 100% → ERROR (자격 없음)", t_v08)
def t_v08_ok():
    for subj in ("정보", "체육", "음악", "미술", "한문"):
        p = P(subject=subj); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
        p["perf_areas"] = [{"name": "실기 수행", "points": 100, "ratio": 40, "essay_ratio": 0},
                           {"name": "활동 관찰 기록", "points": 100, "ratio": 30, "essay_ratio": 0},
                           {"name": "포트폴리오", "points": 100, "ratio": 30, "essay_ratio": 0}]
        assert "V08" not in codes(p), f"{subj} 가 자격 없음으로 잡힘"
check("V08 정보·체육·음악·미술·한문은 허용", t_v08_ok)

print("\n[4] V09 심의 표식 — 비활성 (2026-08-18)")
# 횟수 선택은 교과 교사 재량이고 최종 검토는 관리자 단계에서 한다.
# 규칙 정의는 자산에 남아 있지만 판정은 만들어지지 않아야 한다.
def t_v09_off_b():
    p = P(subject="도덕"); p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 12}]}
    p["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 30, "essay_ratio": 10},
                       {"name": "실천 기록", "points": 100, "ratio": 30, "essay_ratio": 10}]
    assert sev(p, "V09") is None, "지필 1회에 심의 표식이 다시 뜬다"
check("지필 1회 → 심의 표식 없음", t_v09_off_b)

def t_v09_off_c():
    p = P(subject="음악"); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    p["perf_areas"] = [{"name": "가창 실기", "points": 100, "ratio": 40, "essay_ratio": 0},
                       {"name": "기악 실기", "points": 100, "ratio": 30, "essay_ratio": 0},
                       {"name": "감상 활동 기록", "points": 100, "ratio": 30, "essay_ratio": 0}]
    assert sev(p, "V09") is None, "수행 100% 에 심의 표식이 다시 뜬다"
check("수행 100% → 심의 표식 없음", t_v09_off_c)

def t_v09_asset():
    """규칙 정의는 남아 있어야 한다 — 되살릴 때의 근거(조문·사유)가 자산에 있다."""
    r = REG["rules"]["V09"]
    assert r["severity"] == "DISABLED", r["severity"]
    assert r.get("_disabled_reason"), "비활성 사유가 없다"
    assert r["article"], "조문 근거가 지워졌다"
check("규칙 정의와 비활성 사유는 자산에 남는다", t_v09_asset)

def t_v09_revive():
    """severity 를 FLAG 로 되돌리면 그대로 되살아난다 (코드 수정 없이)."""
    r2 = json.loads(json.dumps(REG))
    r2["rules"]["V09"]["severity"] = "FLAG"
    p = P(subject="도덕"); p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 12}]}
    p["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 30, "essay_ratio": 10},
                       {"name": "실천 기록", "points": 100, "ratio": 30, "essay_ratio": 10}]
    f = [x for x in R.check(p, r2) if x["code"] == "V09"]
    assert f and f[0].get("review_reason") == "정기시험 1회", f
check("자산에서 되살릴 수 있다 (코드 수정 없이)", t_v09_revive)

def t_errors_stay():
    """산수 오류 차단은 그대로 — 심의와 범주가 다르다 (오타 방지)."""
    p = P(subject="도덕"); p["exam"] = {"count": 1, "ratio": 40, "rounds": [
        {"label": "정기시험", "ratio": 40, "mc": 70, "essay": 30, "essay_ratio": 1}]}
    p["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 30, "essay_ratio": 1},
                       {"name": "실천 기록", "points": 100, "ratio": 30, "essay_ratio": 1}]
    c = codes(p)
    assert "V04" in c, f"서논술 30% 미달이 안 잡힌다: {c}"
check("ERROR 류(V04 등)는 그대로 막는다", t_errors_stay)

print("\n[5] 나머지 규칙")
def t_v10():
    p = P(subject="정보"); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    p["perf_areas"] = [{"name": "논술 평가", "points": 100, "ratio": 50, "essay_ratio": 50},
                       {"name": "서술 평가", "points": 100, "ratio": 50, "essay_ratio": 50}]
    f = sev(p, "V10"); assert f and f["severity"] == "ERROR", f
check("V10 수행 전 영역이 논술형 → ERROR", t_v10)
def t_v11_skip():
    assert REG["rules"]["V11"]["severity"] == "SKIP", "기본점수는 보류 상태여야 한다"
    assert "V11" not in codes(P()), "수집하지 않는 항목을 검사함"
check("V11 기본점수 — 보류(SKIP), 검사하지 않음", t_v11_skip)
def t_v12():
    p = P(grade=1, semester=2)
    f = sev(p, "V12", variant="grade1_free")
    assert f and f["severity"] == "ERROR", f
    assert "자유학기" in f["message"], f["message"]
check("V12 자유학기에 정기시험 → ERROR", t_v12)
def t_v12_ok():
    p = P(grade=1, semester=2); p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    c = codes(p, variant="grade1_free")
    assert "V12" not in c, c
    assert not (c & {"V01", "V04", "V08"}), f"자유학기에 비율 규칙이 걸림: {c}"
check("V12 통과 — 자유학기는 비율 규칙 자체를 적용하지 않는다", t_v12_ok)
def t_v13():
    p = P(); p["exam"]["rounds"][0]["mc"] = 60   # 60+30 = 90
    f = sev(p, "V13"); assert f and f["severity"] == "WARN", f
check("V13 지필 만점 ≠100 → WARN", t_v13)
def t_v14():
    p = P(); p["perf_areas"][0]["ratio"] = 20.333
    f = sev(p, "V14"); assert f and f["severity"] == "WARN", f
check("V14 소수 2자리 초과 → WARN", t_v14)
def t_v15():
    p = P(); p["perf_areas"][0]["name"] = "가정학습 과제"
    f = sev(p, "V15"); assert f and f["severity"] == "WARN", f
    assert "수업 중 실시가 원칙" in f["message"], f["message"]
check("V15 과제형 영역명 → WARN", t_v15)
def t_v16():
    p = P(); p["perf_areas"][0]["name"] = "수행1"
    f = sev(p, "V16"); assert f and f["severity"] == "WARN", f
check("V16 추상적 영역명 → WARN", t_v16)
def t_v16_ok():
    assert "V16" not in codes(P()), "구체적 이름이 걸림"
check("V16 통과 — '탐구 보고서' 는 구체적", t_v16_ok)
def t_v17():
    p = P(); p["perf_plans"] = [{"name": "탐구 보고서", "absentee_points": ""}]
    f = sev(p, "V17"); assert f and f["severity"] == "WARN", f
check("V17 결시 기준 누락 → WARN", t_v17)
def t_v17_ok():
    assert "V17" not in codes(P()), "기재했는데 걸림"
check("V17 통과", t_v17_ok)
def t_v18():
    p = P(subject="체육"); p["achievement_levels"] = {"A": "x", "B": "y", "C": "z", "D": "w", "E": ""}
    p["exam"] = {"count": 0, "ratio": 0, "rounds": []}
    p["perf_areas"] = [{"name": "체력 측정", "points": 100, "ratio": 40, "essay_ratio": 0},
                       {"name": "경기 수행", "points": 100, "ratio": 30, "essay_ratio": 0},
                       {"name": "활동 기록", "points": 100, "ratio": 30, "essay_ratio": 0}]
    f = sev(p, "V18"); assert f and f["severity"] == "WARN", f
    assert "A~C" in f["message"], f["message"]
check("V18 체육인데 D·E 진술 → WARN", t_v18)

print("\n[6] 유형 판정 (강제 금지 — 교사 선택 우선)")
def t_type():
    assert R.infer_plan_type({"plan_type": "A", "exam": {"count": 0}}) == "A", "교사 선택이 무시됨"
    assert R.infer_plan_type({"exam": {"count": 2}}) == "A"
    assert R.infer_plan_type({"exam": {"count": 1}}) == "B"
    assert R.infer_plan_type({"exam": {"count": 0}}) == "C"
    assert R.infer_plan_type({"grade": 1, "semester": 2, "exam": {"count": 0}}) == "D"
    assert R.infer_plan_type({}, variant="grade1_free") == "D"
check("유형은 교사 선택 우선, 없으면 데이터로 추정", t_type)
def t_type_optional():
    """자격이 있어도 A 형을 택할 수 있다 (임의규정, 문서 7-2)."""
    p = P(subject="음악", plan_type="A")   # 음악이지만 일반형 선택
    c = codes(p)
    assert "V08" not in c, "A 형 선택인데 수행100% 자격을 따짐"
    assert "V04" in c or "V04" not in c    # 유형 A 이므로 서논술 규칙은 적용 대상
check("유형 B·C 는 임의규정 — A 형 선택 가능", t_type_optional)

print("\n[7] 생성 경로 연결")
def t_block():
    # 배점 산수는 맞고(회차 40+40=80) 규정만 어기는 케이스여야 V01 을 확인할 수 있다
    p = P(); p["exam"]["ratio"] = 80
    for r in p["exam"]["rounds"]: r["ratio"] = 40
    p["perf_areas"] = [{"name": "탐구 보고서", "points": 100, "ratio": 20, "essay_ratio": 20}]
    full = dict(p, year=2026, teacher_name="이", weekly_hours=4,
                monthly_plan=[{"month": m} for m in ["8월","9월","10월","11월","12월"]],
                eval_purpose=["","",""], essay_total_ratio=40,
                perf_plans=[{"name": "탐구 보고서", "absentee_points": "대체"}],
                min_achievement_plan="")
    try:
        gen.generate({"fields": full})
    except gen.RegulationViolation as e:
        assert any(f["code"] == "V01" for f in e.findings), e.findings
        assert all(f["severity"] == "ERROR" for f in e.findings)
        return
    raise AssertionError("ERROR 인데 생성이 차단되지 않음")
check("ERROR → 생성 차단 (RegulationViolation)", t_block)
def t_check_only():
    full = dict(P(), year=2026, teacher_name="이",
                monthly_plan=[{"month": m} for m in ["8월","9월","10월","11월","12월"]],
                eval_purpose=["","",""], essay_total_ratio=33,
                min_achievement_plan="")
    out = gen.generate({"fields": full, "check_only": True})
    assert isinstance(out, dict) and "findings" in out, out
    assert out["variant"] == "grade2_exam2" and out["template_ready"] is True, out
check("check_only → 문서 없이 판정만 반환", t_check_only)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
