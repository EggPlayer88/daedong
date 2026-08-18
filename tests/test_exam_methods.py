#!/usr/bin/env python3
"""정기시험 평가방법 3분류 (2026 학교 확정).

  선택형(객관식) / 단답형·완성형(주관식) / 서·논술형(주관식)
  회차 100점 = 셋의 합. **서·논술형 30% 산입은 essay 만** — short 는 주관식이지만 제외.

현행 template.hwpx 의 정기시험 표는 아직 2분류라, 단답형·완성형 배점은 갈 자리가 없다.
합치지 않고 "빠졌다" 고 알린다 (제0원칙).
"""
import importlib.util, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
V = gen._v2fill
M = gen.load_manifest()
REG = gen.load_regulation()

FAIL = []
def check(n, fn):
    try: fn(); print(f"  \u2713 {n}")
    except AssertionError as e: FAIL.append(n); print(f"  \u2717 {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  \u2717 {n}: {type(e).__name__}: {e}")


def R(**kw):
    """정기시험 1회짜리 최소 계획. kw 로 회차 값을 넣는다."""
    r = {"label": "1회 정기시험", "ratio": 40}
    r.update(kw)
    return {"subject": "수학", "exam": {"count": 1, "ratio": 40, "rounds": [r]}}


def full(exams, areas):
    """규정까지 통과하는 계획 (누락 안내를 생성 경로에서 보기 위한 것)."""
    per = round(100 / areas, 4) if exams == 0 else round(60 / areas, 4)
    methods = ["구술·발표", "프로젝트", "실험·실습", "포트폴리오"]
    return {
        "subject": "정보" if exams == 0 else "수학",
        "grade": 2, "semester": 2, "weekly_hours": 4,
        "exam": {"count": exams, "ratio": 0 if exams == 0 else 40, "rounds": []},
        "perf_ratio": 100 if exams == 0 else 60,
        "perf_areas": [
            {"name": f"영역{i+1}", "points": 100, "ratio": per, "essay_ratio": 0,
             "method": methods[i % len(methods)], "absent_rule": "결시자는 인정점 처리"}
            for i in range(areas)
        ],
    }


print("[1] 회차 100점 = 선택형 + 단답형·완성형 + 서·논술형")
def t_three_ok():
    assert V.check_scales(R(mc=60, short=10, essay=30)) == []
    assert V.check_scales(R(mc=70, essay=30)) == [], "단답형 없이 2분류도 100이면 통과"
check("셋의 합이 100이면 통과", t_three_ok)

def t_three_bad():
    p = V.check_scales(R(mc=60, short=5, essay=30))
    assert p and "95점" in p[0], p
    assert "단답형·완성형 5점" in p[0], f"3분류 내역이 안 보임: {p[0]}"
check("합이 95면 세 항목 내역과 함께 거부", t_three_bad)

def t_blank_round():
    assert V.check_scales(R()) == [], "아직 안 정한 회차는 통과해야 한다 (공란 허용)"
check("셋 다 공란인 회차는 통과 (공란은 실패가 아니다)", t_blank_round)

def t_v13():
    """60 + 10 + 30 = 100. short 를 빼고 세면 90점이 되어 V13 이 잘못 걸린다."""
    p = {**R(mc=60, short=10, essay=30), "grade": 2, "semester": 2,
         "perf_areas": [{"name": "말하기", "ratio": 60, "essay_ratio": 30, "absent_rule": "인정점"}]}
    bad = [x for x in gen._regulation.check(p, REG) if x["code"] == "V13"]
    assert not bad, [x["message"] for x in bad]
check("V13(지필 만점 100)이 short 를 합산한다", t_v13)

def t_essay_excludes_short():
    """서·논술형 30% 분모에 short 가 섞이면 안 된다 — essay_ratio 만 본다."""
    base = {
        "subject": "수학", "grade": 2, "semester": 2,
        "exam": {"count": 2, "ratio": 40, "rounds": [
            {"label": "1회 정기시험", "ratio": 20, "mc": 60, "short": 20, "essay": 20, "essay_ratio": 4},
            {"label": "2회 정기시험", "ratio": 20, "mc": 60, "short": 20, "essay": 20, "essay_ratio": 4},
        ]},
        "perf_areas": [{"name": "말하기", "ratio": 30, "essay_ratio": 10, "absent_rule": "인정점"},
                       {"name": "쓰기", "ratio": 30, "essay_ratio": 10, "absent_rule": "인정점"}],
    }
    f = [x for x in gen._regulation.check(base, REG) if x["code"] == "V04"]
    assert f, "서논술 4+4+10+10=28% 인데 V04 가 안 걸렸다 (short 가 섞였을 수 있음)"
    assert "28%" in f[0]["message"], f[0]["message"]
check("V04 분모에 단답형·완성형이 섞이지 않는다", t_essay_excludes_short)

print("\n[2] 현행 양식에 칸 없는 분류 — 숨기지 않고 알린다 (제0원칙)")
def t_gap():
    n = V.check_exam_categories(R(mc=60, short=10, essay=30), M)
    assert n, "단답형 배점이 있는데 안내가 없다"
    assert "단답형·완성형 10점은 문서에 들어가지 않았습니다" in n[0], n[0]
    assert "서버가 임의로 합치지 않습니다" in n[0], n[0]
check("단답형 배점이 있으면 누락 사실을 알린다", t_gap)

def t_no_gap():
    assert V.check_exam_categories(R(mc=70, essay=30), M) == [], "단답형 0인데 안내가 나감"
check("단답형이 없으면 조용하다", t_no_gap)

def t_gap_disappears():
    m2 = json.loads(json.dumps(M))
    m2["exam"]["template_categories"] = ["mc", "short", "essay"]
    assert V.check_exam_categories(R(mc=60, short=10, essay=30), m2) == [], "새 양식인데 안내가 남음"
check("새 마스터 양식이 배치되면 안내가 저절로 사라진다", t_gap_disappears)

def t_gap_generate():
    p = full(2, 2)
    p["exam"]["rounds"] = [
        {"label": "1회 정기시험", "ratio": 20, "mc": 55, "short": 15, "essay": 30, "essay_ratio": 6},
        {"label": "2회 정기시험", "ratio": 20, "mc": 55, "short": 15, "essay": 30, "essay_ratio": 6},
    ]
    p["perf_areas"] = [
        {"name": "말하기", "points": 100, "ratio": 30, "essay_ratio": 9,
         "method": "구술·발표", "absent_rule": "인정점"},
        {"name": "쓰기", "points": 100, "ratio": 30, "essay_ratio": 9,
         "method": "서술·논술", "absent_rule": "인정점"},
    ]
    out = gen.generate_v2(M, p, check_only=True)
    assert any("단답형·완성형" in n for n in out["notices"]), out["notices"]
check("check_only 응답에도 누락 안내가 실린다", t_gap_generate)


print()
if FAIL:
    print(f"실패 {len(FAIL)}건: " + ", ".join(FAIL)); raise SystemExit(1)
print("전부 통과")
