#!/usr/bin/env python3
"""템플릿 패밀리 — variant 결정과 양식 미배치 안내."""
import importlib.util, json, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
M = gen.load_manifest()
V = gen._fill

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

def R(**kw):
    p = {"subject": "수학", "grade": 2, "semester": 2}; p.update(kw)
    return V.resolve_variant(p, M)

print("\n[1] variant 결정 (순서가 의미를 가진다)")
check("2학년 수학 → default", lambda: (_ for _ in ()).throw(AssertionError(R())) if R() != "default" else None)
check("3학년 수학 → grade3", lambda: (_ for _ in ()).throw(AssertionError(R(grade=3))) if R(grade=3) != "grade3" else None)
def t_arts():
    for s in ("음악", "미술", "체육", "보건"):
        got = R(subject=s, grade=2)
        assert got == "arts", f"{s}: {got}"
    assert R(subject="체육", grade=3) == "arts", "3학년 체육이 grade3 으로 감 (예체능이 우선)"
check("음악·미술·체육·보건 → arts (3학년이어도)", t_arts)
def t_free():
    assert R(grade=1, semester=2) == "grade1_free", R(grade=1, semester=2)
    # 자유학기가 예체능보다 우선한다 (선언된 순서)
    assert R(grade=1, semester=2, subject="음악") == "grade1_free", "1학년 음악이 arts 로 감"
check("1학년 2학기 → grade1_free (예체능보다 우선)", t_free)
def t_g1s1():
    assert R(grade=1, semester=1) == "default", R(grade=1, semester=1)
check("1학년 1학기는 자유학기 아님 → default", t_g1s1)
def t_partial():
    assert R(subject="음악감상") == "arts", "부분 일치 안 됨"
    assert R(subject="") == "default"
check("교과명 부분 일치 / 빈 값 처리", t_partial)

print("\n[2] variant 명세")
MASTER = M["template_file"]   # v3 마스터는 전 유형 공용 기반이다
def t_spec():
    d = V.variant_spec(M, "default")
    assert d["template_file"] == MASTER, d
    assert d["scoring"] is True
    for key in ("default", "grade3", "arts"):
        v = V.variant_spec(M, key)
        assert v["template_file"] == MASTER, f"{key} 가 마스터를 안 씀: {v}"
        assert v["limits"]["perf_areas_max"] == 3, f"{key} 한도: {v['limits']}"
    f = V.variant_spec(M, "grade1_free")
    assert f["scoring"] is False, "자유학기는 점수화하지 않는다"
check("점수화 유형은 모두 마스터 양식 / 한도 3", t_spec)
check("모르는 유형은 default 로", lambda: (_ for _ in ()).throw(AssertionError("fallback 실패"))
      if V.variant_spec(M, "없는유형")["template_file"] != MASTER else None)

print("\n[3] 유형별 생성 — 마스터로 나가는 것과 아직 안 나가는 것")
BASE = {"year":2026,"semester":2,"subject":"수학","teacher_name":"이","weekly_hours":4,
        "monthly_plan":[{"month":m,"hours_cum":"","units":"","standards":"","eval_elements":""} for m in ["8월","9월","10월","11월","12월"]],
        "eval_purpose":["","",""],
        # 규정 적합 유형 A (정기 2회 60% / 수행 2영역 20%씩 / 서논술 33%)
        "exam":{"count":2,"ratio":60,"mc_points":60,"short_points":10,"essay_points":30,"rounds":[
            {"label":"1회 정기시험","period":"","standards":"","ratio":30,"mc":"60","short":"10","essay":"30","essay_ratio":"9"},
            {"label":"2회 정기시험","period":"","standards":"","ratio":30,"mc":"60","short":"10","essay":"30","essay_ratio":"9"}]},
        "perf_areas":[{"name":"탐구 보고서","points":100,"ratio":20,"essay_ratio":"8"},
                      {"name":"수행 과정 관찰","points":100,"ratio":20,"essay_ratio":"7"}],
        "essay_total_ratio":33,"achievement_levels":{"A":"","B":"","C":"","D":"","E":""},
        "perf_plans":[{"name":"탐구 보고서","absentee_points":"대체 과제"}],"min_achievement_plan":""}

def missing(grade, subject, expect_variant):
    p = dict(BASE, grade=grade, subject=subject)
    try:
        gen.generate({"fields": p})
    except gen.TemplateMissing as e:
        assert e.variant == expect_variant, f"{e.variant} != {expect_variant}"
        assert e.label, "label 이 비었다"
        return
    raise AssertionError("TemplateMissing 이 발생하지 않음")

def made(grade, subject, expect_variant, **over):
    p = dict(BASE, grade=grade, subject=subject, **over)
    fn, b64, _n = gen.generate({"fields": p})
    assert V.resolve_variant(p, M) == expect_variant, V.resolve_variant(p, M)
    assert fn.endswith("(초안).hwpx"), fn

# 3학년·예체능도 이제 마스터로 나간다 — 유형별로 다른 것은 한도와 대화 흐름뿐이다
check("3학년 → grade3 로 판정되고 마스터로 생성", lambda: made(
    3, "수학", "grade3",
    exam={"count": 1, "ratio": 40, "mc_points": 60, "short_points": 10, "essay_points": 30,
          "rounds": [{"label": "정기시험", "period": "", "standards": "", "ratio": 40,
                      "mc": "60", "short": "10", "essay": "30", "essay_ratio": "16"}]},
    perf_areas=[{"name": "탐구 보고서", "points": 100, "ratio": 30, "essay_ratio": "7"},
                {"name": "수행 과정 관찰", "points": 100, "ratio": 30, "essay_ratio": "7"}]))
check("음악 → arts 로 판정되고 마스터로 생성", lambda: made(
    2, "음악", "arts",
    exam={"count": 0, "ratio": 0, "rounds": []},
    perf_areas=[{"name": "가창 실기", "points": 100, "ratio": 40, "essay_ratio": "0"},
                {"name": "기악 실기", "points": 100, "ratio": 30, "essay_ratio": "0"},
                {"name": "감상 보고서", "points": 100, "ratio": 30, "essay_ratio": "0"}]))
def t_free_missing():
    p = dict(BASE, grade=1, semester=2, subject="수학")
    # 자유학기는 배점 자체가 없다 — 배점 검증에 걸리지 않고 양식 안내까지 가야 한다
    p.pop("exam"); p["perf_areas"] = [{"name": "관찰"}]
    try:
        gen.generate({"fields": p})
    except gen.TemplateMissing as e:
        assert e.variant == "grade1_free", e.variant
        return
    raise AssertionError("TemplateMissing 이 발생하지 않음")
# 자유학기만 아직 마스터를 쓰지 않는다 — 그 문서에는 3절(반영비율) 자체가 없다(실측).
# 점수 칸이 있는 마스터로 뽑으면 없는 표를 있는 것처럼 만드는 셈이다 (제0원칙).
check("1학년 자유학기 → 배점 검증 건너뛰고 양식 안내", t_free_missing)
def t_default_ok():
    p = dict(BASE, grade=2, subject="수학")
    fn, b64, notices = gen.generate({"fields": p})
    assert fn.endswith("(초안).hwpx"), fn
check("default 유형은 그대로 생성된다 (회귀)", t_default_ok)

print("\n[4] 유형별로 다른 것은 한도(시험 횟수)뿐")
def t_caps():
    a = V.variant_spec(M, "arts")["limits"]
    g3 = V.variant_spec(M, "grade3")["limits"]
    d = V.variant_spec(M, "default")["limits"]
    # 수행 한도는 이제 전부 같다 (마스터가 3열)
    assert a["perf_areas_max"] == g3["perf_areas_max"] == d["perf_areas_max"] == 3, (a, g3, d)
    # 다른 것은 시험 횟수다 — 예체능 0회, 3학년 0~1회, 기본 0~2회
    assert a["exam_count"] == [0], a
    assert max(g3["exam_count"]) == 1, g3
    assert max(d["exam_count"]) == 2, d
check("수행 한도는 동일(3), 시험 횟수만 유형별로 다르다", t_caps)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
