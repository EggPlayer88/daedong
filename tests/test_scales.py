#!/usr/bin/env python3
"""배점 정합성 + 만점 표기 + 한도 초과 처리 검증."""
import base64, importlib.util, io, json, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API/"generate.py"); gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
M = gen.load_manifest()
FAIL=[]
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")
def body_of(b64):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))) as z: return z.read("Contents/section0.xml").decode()

def P(**kw):
    p = {"year":2026,"semester":2,"grade":2,"subject":"과학","teacher_name":"이","weekly_hours":4,
         "monthly_plan":[{"month":m,"hours_cum":"","units":"","standards":"","eval_elements":""} for m in ["8월","9월","10월","11월","12월"]],
         "eval_purpose":["","",""],
         "exam":{"count":2,"ratio":60,"mc_points":70,"essay_points":30,"rounds":[
             {"label":"1회 정기시험","period":"9.29.","standards":"","mc":"70","essay":"30","essay_ratio":"9"},
             {"label":"2회 정기시험","period":"12.1.","standards":"","mc":"70","essay":"30","essay_ratio":"9"}]},
         "perf_areas":[{"name":"실험","points":"60","essay_ratio":"10","standards":"","period":"10월"},
                       {"name":"발표","points":"40","essay_ratio":"5","standards":"","period":"11월"}],
         "essay_total_ratio":33,
         "achievement_levels":{"A":"","B":"","C":"","D":"","E":""},
         "perf_plans":[{"name":"실험"},{"name":"발표"}],
         "min_achievement_plan":""}
    p.update(kw); return p

print("\n[1] 배점 정합성 검증 (거부 + 어느 합이 몇 점인지)")
def bad(plan, *needles):
    try: gen.generate({"fields": plan})
    except gen.BadRequest as e:
        for n in needles: assert n in str(e), f"메시지에 '{n}' 없음: {e}"
        return
    raise AssertionError("거부되지 않음")
check("정상(회차 100 / 수행 100 / 비율 100) 통과", lambda: gen.generate({"fields": P()}))
def t_round():
    p = P(); p["exam"]["rounds"][1]["mc"] = "60"   # 60+30=90
    bad(p, "2회 정기시험", "90점", "100점이어야")
check("회차 합 90점 → 어느 회차·몇 점인지 명시하며 거부", t_round)
def t_perf():
    p = P(); p["perf_areas"][1]["points"] = "30"   # 60+30=90
    bad(p, "수행평가 영역 만점 합", "실험 60점", "발표 30점", "90점")
check("수행 합 90점 → 영역별 내역과 함께 거부", t_perf)
def t_ratio():
    p = P(); p["exam"]["ratio"] = 50; p["perf_ratio"] = 40
    bad(p, "반영비율 합", "50%", "40%", "90%")
check("반영비율 합 90% → 거부", t_ratio)
def t_blank_round():
    p = P(); p["exam"]["rounds"][1]["mc"] = ""; p["exam"]["rounds"][1]["essay"] = ""
    gen.generate({"fields": p})   # 아직 안 정한 회차는 공란 허용
check("배점 미정 회차는 공란 허용 (통과)", t_blank_round)

print("\n[2] 만점 표기 N점(M%) — 서버가 계산")
R={}
def t_label():
    fn, b64, notices = gen.generate({"fields": P()})
    R["b"] = body_of(b64)
    # 회차 반영비율 = 60/2 = 30% → 선택형 70점(21%), 서논술 30점(9%)
    assert "70점(21%)" in R["b"], "선택형 표기 오류"
    assert "30점(9%)" in R["b"], "서논술 표기 오류"
    # 수행 반영비율 40% → 60점(24%), 40점(16%)
    assert "60점(24%)" in R["b"], "수행1 표기 오류"
    assert "40점(16%)" in R["b"], "수행2 표기 오류"
check("회차 70점(21%)·30점(9%) / 수행 60점(24%)·40점(16%)", t_label)
check("합계 100점(100%)", lambda: (_ for _ in ()).throw(AssertionError("합계 표기 오류")) if "100점(100%)" not in R["b"] else None)
def t_override():
    p = P(); p["perf_areas"][0]["points"] = "60점(99%)"   # AI 가 잘못 계산한 경우
    b = body_of(gen.generate({"fields": p})[1])
    assert "60점(24%)" in b, "서버가 다시 계산하지 않음"
    assert "99%" not in b, "AI 의 잘못된 % 가 남음"
check("AI 가 준 괄호 %가 틀려도 서버가 다시 계산", t_override)

print("\n[3] 한도 초과 — 거부하지 않고 수용분만 + 안내")
def t_over_areas():
    p = P(); p["perf_areas"] = [{"name":f"영역{i}","points":"25","essay_ratio":"5"} for i in range(1,5)]
    p["perf_plans"] = [{"name":f"영역{i}"} for i in range(1,5)]
    fn, b64, notices = gen.generate({"fields": p})
    b = body_of(b64)
    assert "{{" not in b, "토큰 잔존"
    assert len(notices) >= 2, notices
    joined = " ".join(notices)
    assert "영역3" in joined and "영역4" in joined, f"빠진 항목명 없음: {joined}"
    assert "한글에서 직접 편집" in joined, "편집 안내 없음"
    assert "영역1" in b and "영역2" in b, "수용분이 안 들어감"
    assert "영역3" not in b, "한도 넘은 항목이 들어감"
check("수행 4개 → 2개 생성 + 빠진 항목명·사유 안내", t_over_areas)
def t_over_exam():
    p = P(); p["exam"]["count"] = 3
    p["exam"]["rounds"].append({"label":"3회","period":"","standards":"","mc":"70","essay":"30","essay_ratio":"9"})
    fn, b64, notices = gen.generate({"fields": p})
    joined = " ".join(notices)
    assert "정기시험 3회 중 2회분" in joined, joined
    assert "한글에서 직접 편집" in joined
check("정기시험 3회 → 2회분 생성 + 안내 (거부 아님)", t_over_exam)
def t_no_notice():
    fn, b64, notices = gen.generate({"fields": P()})
    assert notices == [], notices
check("한도 안이면 안내 없음", t_no_notice)

print("\n[4] 응답 계약")
def t_shape():
    r = gen.generate({"fields": P()})
    assert isinstance(r, tuple) and len(r) == 3, r
    assert isinstance(r[2], list), type(r[2])
check("generate 는 (filename, base64, notices) 3튜플", t_shape)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
