#!/usr/bin/env python3
"""시수/누계 고정표 주입 검증 (generate 쪽)."""
import base64, importlib.util, io, json, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROOT = ROOT; API = ROOT/"apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API/"generate.py"); gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
TBL = gen.load_fixed_hours()
FAIL=[]
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

def base_plan(**kw):
    p = {"year":2026,"semester":2,"grade":2,"subject":"과학","teacher_name":"이영준","weekly_hours":4,
         "monthly_plan":[{"month":m,"hours_cum":"AI가_계산한_값","units":f"단원{i}","standards":"","eval_elements":""}
                         for i,m in enumerate(["8월","9월","10월","11월","12월"])],
         "eval_purpose":["","",""],
         "exam":{"count":0,"ratio":0,"mc_points":0,"essay_points":0,"rounds":[]},
         "perf_areas":[{"name":"포트폴리오","points":"100점(100%)"}],
         "perf_plans":[{"name":"포트폴리오"}]}
    p.update(kw); return p

def body_of(b64):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))) as z:
        return z.read("Contents/section0.xml").decode()

print("\n[1] 고정표 주입 (apply_fixed_hours)")
def t_default():
    p = base_plan()
    r = gen._v2fill.apply_fixed_hours(p, TBL)
    assert r["applied"] and r["reason"]=="fixed_table", r
    assert [x["hours_cum"] for x in p["monthly_plan"]] == ["8/8","16/24","16/40","16/56","16/72"], p["monthly_plan"]
check("주당 4 → 8/8, 16/24, 16/40, 16/56, 16/72 (AI 값 덮어씀)", t_default)
def t_all():
    exp = TBL["variants"][TBL["default_variant"]]
    for k in ("1","2","3","4","5"):
        p = base_plan(weekly_hours=int(k))
        gen._v2fill.apply_fixed_hours(p, TBL)
        got = [x["hours_cum"] for x in p["monthly_plan"]]
        assert got == exp[k]["months"], f"주당 {k}: {got}"
check("주당 1~5 전부 표와 일치", t_all)
def t_manual():
    p = base_plan(hours_manual=True)
    r = gen._v2fill.apply_fixed_hours(p, TBL)
    assert not r["applied"] and r["reason"]=="hours_manual", r
    assert all(x["hours_cum"]=="AI가_계산한_값" for x in p["monthly_plan"]), "교사 값이 덮어써짐"
check("hours_manual=true → 교사 값 보존", t_manual)
def t_manual_str():
    p = base_plan(hours_manual="true")
    assert not gen._v2fill.apply_fixed_hours(p, TBL)["applied"], "문자열 true 를 못 알아봄"
check("hours_manual 이 문자열 'true' 여도 인식", t_manual_str)
def t_range():
    for wh in (0, 6, 4.5, "", None, "네시간"):
        p = base_plan(weekly_hours=wh)
        r = gen._v2fill.apply_fixed_hours(p, TBL)
        assert not r["applied"], f"weekly_hours={wh!r} 인데 주입됨"
        assert all(x["hours_cum"]=="AI가_계산한_값" for x in p["monthly_plan"]), f"{wh!r}: 값 손실"
check("범위 밖(0/6/4.5/빈값/문자)은 주입 안 함 + 교사 값 보존", t_range)
def t_str_num():
    p = base_plan(weekly_hours="4")
    assert gen._v2fill.apply_fixed_hours(p, TBL)["applied"], "문자열 '4' 미인식"
check("weekly_hours 가 문자열 '4' 여도 주입", t_str_num)

print("\n[2] 실제 문서에 반영")
def t_doc():
    fn, b64, _ = gen.generate({"fields": base_plan()})
    b = body_of(b64)
    for s in ["8/8","16/24","16/40","16/56","16/72"]:
        assert s in b, f"문서에 없음: {s}"
    assert "AI가_계산한_값" not in b, "AI 값이 문서에 남음"
    assert "{{" not in b
check("생성 문서의 시수 칸이 고정표 값", t_doc)
def t_doc_manual():
    p = base_plan(hours_manual=True)
    for i, v in enumerate(["9/9","16/25","17/42","16/58","18/76"]):
        p["monthly_plan"][i]["hours_cum"] = v
    fn, b64, _ = gen.generate({"fields": p})
    b = body_of(b64)
    assert "17/42" in b and "18/76" in b, "교사 값이 문서에 없음"
    assert "16/72" not in b, "고정표 값이 섞임"
check("hours_manual 이면 교사 값이 문서에 들어감", t_doc_manual)
def t_doc_range():
    p = base_plan(weekly_hours=6)
    for i, v in enumerate(["12/12","24/36","24/60","24/84","24/108"]):
        p["monthly_plan"][i]["hours_cum"] = v
    b = body_of(gen.generate({"fields": p})[1])
    assert "24/108" in b, "범위 밖인데 교사 값도 안 들어감"
check("주당 6시간(범위 밖)도 문서는 정상 생성", t_doc_range)

print("\n[3] 표 자체 무결성")
def t_table():
    v = TBL["variants"][TBL["default_variant"]]
    for k, row in v.items():
        assert len(row["months"]) == len(TBL["months"]) == 5, f"주당 {k}: 행 수 {len(row['months'])}"
        # 누계가 단조 증가하고 마지막 누계 == total
        cums = [int(x.split("/")[1]) for x in row["months"]]
        assert cums == sorted(cums), f"주당 {k}: 누계 역행 {cums}"
        assert cums[-1] == row["total"], f"주당 {k}: 누계 끝 {cums[-1]} != total {row['total']}"
        # 월 시수 합 == total
        assert sum(int(x.split("/")[0]) for x in row["months"]) == row["total"], f"주당 {k}: 합 불일치"
        assert (row["total"] >= row["min_required"]) == row["ok"], f"주당 {k}: ok 플래그 불일치"
check("default_variant 5행·누계 단조·합계·ok 플래그 정합", t_table)
def t_variants():
    assert TBL["default_variant"] == "common", TBL["default_variant"]
    g2 = TBL["variants"]["g2"]
    assert all(not r["ok"] for r in g2.values()), "g2 는 최소기준 미달이어야 함(참고용)"
check("default 는 common, g2(미달)는 참고용으로만 존재", t_variants)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
