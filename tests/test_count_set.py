#!/usr/bin/env python3
"""정기시험 횟수 × 수행평가 개수 세트 (2025-2 실측 + 2026-08-18 학교 확정).

규정 검증기(V01~V18)와 다른 점: **막지 않는다.**
세트는 학교가 정한 관행이라, 벗어나도 생성은 진행하고 안내만 한다 (제0원칙).
"""
import importlib.util, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
V = gen._fill
M = gen.load_manifest()
C = gen.load_constants()
RULE = C["perf_count_rule"]

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")


def plan(exams, areas, **kw):
    """세트 검사에 필요한 최소 형태. 배점 정합성은 여기서 보지 않는다."""
    p = {
        "subject": "수학", "grade": 2, "semester": 2,
        "exam": {"count": exams, "ratio": 0 if exams == 0 else 40},
        "perf_areas": [{"name": f"영역{i+1}"} for i in range(areas)],
    }
    p.update(kw)
    return p


def notes(exams, areas, rule=RULE):
    return V.check_perf_count(plan(exams, areas), rule)


# ---------------------------------------------------------------------------
print("\n[1] 확정된 세트는 통과 (안내 없음)")
for exams, areas in ((0, 3), (1, 2), (2, 1), (2, 2)):
    check(
        f"시험 {exams}회 × 수행 {areas}개 → 통과",
        lambda e=exams, a=areas: (lambda n: (_ for _ in ()).throw(AssertionError(n)) if n else None)(notes(e, a)),
    )

print("\n[2] 세트 밖은 안내한다 (거부가 아니다)")
def t_0x4():
    n = notes(0, 4)
    assert n, "시험 0회 × 수행 4개인데 안내가 없다"
    assert "3개입니다" in n[0], n[0]
    assert "현재 4개" in n[0], n[0]
check("시험 0회 × 수행 4개 → 3개 안내 (제외 조합)", t_0x4)

def t_1x3():
    n = notes(1, 3)
    assert n, "시험 1회 × 수행 3개인데 안내가 없다"
    assert "2개입니다" in n[0], n[0]
    assert "유명무실" in n[0], f"이유가 빠짐: {n[0]}"
check("시험 1회 × 수행 3개 → 2개 안내 + 이유", t_1x3)

def t_2x3():
    n = notes(2, 3)
    assert n and "1~2개입니다" in n[0], n
check("시험 2회 × 수행 3개 → 1~2개 안내 (범위형)", t_2x3)

def t_0x1():
    n = notes(0, 1)
    assert n and "3개입니다" in n[0], n
check("시험 0회 × 수행 1개 → 부족도 안내 (min 미달)", t_0x1)

print("\n[3] 전환 안내 — 작년과 달라진 조합")
def t_transition():
    n = notes(1, 3)
    joined = " ".join(n)
    assert "3학년 영어" in joined, f"전환 안내가 붙지 않음: {n}"
    assert "합치거나" in joined or "뺄지" in joined, joined
    assert len(n) == 2, f"안내 문장 수: {len(n)}"
check("시험 1회 × 수행 3개 = 작년 3학년 영어 → 전환 안내 동반", t_transition)

def t_no_transition():
    joined = " ".join(notes(0, 4))
    assert "3학년 영어" not in joined, "관계없는 조합에 전환 안내가 붙음"
check("다른 조합에는 전환 안내가 붙지 않는다", t_no_transition)

print("\n[4] 판정을 못 하는 경우엔 조용히 넘어간다")
check("수행 영역이 아직 없으면 안내 없음", lambda: (lambda n: (_ for _ in ()).throw(AssertionError(n)) if n else None)(notes(1, 0)))
check("규칙 자산이 없으면 안내 없음", lambda: (lambda n: (_ for _ in ()).throw(AssertionError(n)) if n else None)(V.check_perf_count(plan(1, 3), None)))
def t_broken():
    assert V.check_perf_count(plan(1, 3), {"by_exams": {"1": "깨진값"}}) == []
    assert V.check_perf_count({"exam": "문자열", "perf_areas": "배열아님"}, RULE) == []
check("깨진 입력에도 죽지 않는다", t_broken)

print("\n[5] 하드코딩 아님 — 상수를 바꾸면 판정이 따라간다")
def t_derived():
    alt = json.loads(json.dumps(RULE))
    alt["by_exams"]["1"] = {"min": 1, "max": 3}
    assert V.check_perf_count(plan(1, 3), alt) == [], "상수를 넓혔는데 여전히 안내함"
    alt["by_exams"]["2"] = {"min": 1, "max": 1}
    n = V.check_perf_count(plan(2, 2), alt)
    assert n and "1개입니다" in n[0], n
check("min/max 를 바꾸면 통과/안내가 뒤집힌다", t_derived)

print("\n[6] 세트 밖이어도 생성은 막히지 않는다 (제0원칙)")
def full(exams, areas):
    """규정까지 통과하는 계획 — 세트만 벗어나게 한다.

    ⚠ 시험 0회는 유형 C 라 수행 100% 자격이 있는 교과여야 하고(V08),
      논술형만으로 채우면 V10 에 걸린다. 세트 안내를 보려면 규정은 통과해야 한다.
    """
    per = round(100 / areas, 4) if exams == 0 else round(60 / areas, 4)
    methods = ["서술·논술", "프로젝트", "실험·실습", "포트폴리오"]
    p = {
        "subject": "정보" if exams == 0 else "수학",
        "grade": 2, "semester": 2, "weekly_hours": 4,
        "exam": {
            "count": exams,
            "ratio": 0 if exams == 0 else 40,
            "rounds": [{"label": "1회 정기시험", "ratio": 40, "mc": 70, "essay": 30}][:exams],
        },
        "perf_ratio": 100 if exams == 0 else 60,
        "perf_areas": [
            {"name": f"영역{i+1}", "points": 100, "ratio": per,
             "essay_ratio": 30 if i == 0 else 0,
             "method": methods[i % len(methods)], "absent_rule": "결시자는 인정점 처리"}
            for i in range(areas)
        ],
    }
    return p

def t_not_blocked():
    # 시험 0회 × 수행 4개 — 세트 밖이지만 규정 위반은 아니다
    out = gen.generate_v2(M, full(0, 4), check_only=True)
    assert not [f for f in out["findings"] if f["severity"] == "ERROR"], out["findings"]
    assert out["notices"], "세트 안내가 check_only 응답에 없다"
    assert "수행평가는 3개입니다" in out["notices"][0], out["notices"]
check("세트 밖 → check_only 가 ERROR 없이 notices 로 알린다", t_not_blocked)

def t_in_set_quiet():
    out = gen.generate_v2(M, full(0, 3), check_only=True)
    assert out["notices"] == [], out["notices"]
check("세트 안 → notices 비어 있음", t_in_set_quiet)

print("\n[7] 자르는 기준은 언제나 manifest.limits")
def t_capacity():
    cap = M["limits"]["perf_areas_max"]
    # 상수의 요약값과 manifest 한도가 어긋나면 사람이 읽는 문서가 거짓말을 한다
    assert RULE["template_capacity"]["planned"]["perf_columns"] == cap, RULE["template_capacity"]
    p = full(0, 3)
    assert V.apply_capacity(p, M, None) == [], "한도 안인데 잘림"
    assert len(p["perf_areas"]) == 3, p["perf_areas"]
    over = full(0, cap + 1)
    n = V.apply_capacity(over, M, None)
    assert len(over["perf_areas"]) == cap, over["perf_areas"]
    assert n and "한글에서 직접 편집" in n[0], n
check("한도 안은 그대로, 넘으면 자르고 안내", t_capacity)

print()
if FAIL:
    print(f"실패 {len(FAIL)}건: " + ", ".join(FAIL)); raise SystemExit(1)
print("전부 통과")
