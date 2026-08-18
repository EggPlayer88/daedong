#!/usr/bin/env python3
"""양식 라우팅 (manifest v4) — 학년 × 시험 횟수 → 양식 6종.

v3 까지의 variant(교과명 기반)를 대체한다. 한도·성취수준 단계는 **token-map 에서
세어 온다** — routing 표에 적어 두면 양식과 갈라진다.
"""
import importlib.util, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
M = gen.load_manifest()
TM = gen.load_token_map()
V = gen._fill

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")


def key(grade, exams=None, semester=2):
    p = {"grade": grade, "semester": semester}
    if exams is not None:
        p["exam"] = {"count": exams}
    return V.route_key(p, M)


def spec_of(k):
    return V.route_spec(M, TM, k)


print("\n[1] 학년 × 시험 횟수 → 양식")
def t_map():
    want = {
        (2, 2): "tpl-g2-exam2.hwpx",
        (2, 1): "tpl-g2-exam1.hwpx",
        (2, 0): "tpl-g2-perf3-arts.hwpx",
        (3, 1): "tpl-g3-exam1.hwpx",
        (3, 0): "tpl-g3-perf3.hwpx",
    }
    for (g, e), f in want.items():
        k = key(g, e)
        assert spec_of(k)["file"] == f, f"{g}학년 시험{e}회 → {spec_of(k)['file']}"
check("2·3학년 5조합이 각자 양식으로", t_map)

def t_free_first():
    """자유학기는 시험 횟수를 보지 않는다 — 1학년 2학기면 무조건 자유학기 양식."""
    assert key(1, 0) == "grade1_semester2", key(1, 0)
    assert key(1, 2) == "grade1_semester2", "시험 횟수가 자유학기를 덮어씀"
    assert spec_of(key(1, 0))["file"] == "tpl-g1-free.hwpx"
check("1학년 2학기 → 자유학기 (시험 횟수 무관)", t_free_first)

def t_g1s1():
    assert key(1, 2, semester=1) == "grade1_exam2", key(1, 2, semester=1)
    assert spec_of(key(1, 2, semester=1))["file"] == "", "없는 조합에 양식이 붙음"
check("1학년 1학기는 자유학기가 아니다 (양식 없음)", t_g1s1)

def t_missing():
    """표에 없는 조합은 빈 파일명 → 생성 단계에서 안내로 걸린다."""
    k = key(3, 2)
    assert spec_of(k)["file"] == "", spec_of(k)
    assert spec_of(k)["label"] == "3학년 · 정기시험 2회", spec_of(k)["label"]
check("3학년 시험 2회는 표에 없다", t_missing)

def t_no_subject():
    """교과명은 더 이상 양식을 정하지 않는다 (v3 의 arts 판정 폐기)."""
    for subj in ("음악", "수학", "보건", "정보"):
        p = {"grade": 2, "semester": 2, "subject": subj, "exam": {"count": 0}}
        assert V.route_key(p, M) == "grade2_exam0", subj
check("교과명은 양식을 바꾸지 않는다 (시험 횟수가 정한다)", t_no_subject)


print("\n[2] 한도·성취수준은 token-map 에서 센다")
def t_caps():
    want = {
        "grade2_exam2": (2, 2, 0), "grade2_exam1": (2, 2, 0), "grade2_exam0": (3, 3, 0),
        "grade3_exam1": (2, 2, 0), "grade3_exam0": (3, 3, 0), "grade1_semester2": (0, 0, 4),
    }
    for k, (pa, pp, fb) in want.items():
        lim = spec_of(k)["limits"]
        got = (lim["perf_areas_max"], lim["perf_plans_max"], lim["free_blocks_max"])
        assert got == (pa, pp, fb), f"{k}: {got} != {(pa, pp, fb)}"
check("수행 열·출제 블록·활동 블록 수", t_caps)

def t_levels():
    want = {
        "grade2_exam2": list("ABCDE"), "grade2_exam1": list("ABCDE"),
        "grade2_exam0": list("ABC"),
        "grade3_exam1": [], "grade3_exam0": [],       # 3학년은 성취수준 절 자체가 없다
        "grade1_semester2": list("ABCDE"),
    }
    for k, lv in want.items():
        assert spec_of(k)["levels"] == lv, f"{k}: {spec_of(k)['levels']}"
check("성취수준 단계 (3학년은 없음)", t_levels)

def t_derived():
    """routing 표가 아니라 **토큰 목록**이 근거임을 확인한다."""
    tm2 = json.loads(json.dumps(TM))
    tm2["tpl-g2-exam2.hwpx"] = [t for t in tm2["tpl-g2-exam2.hwpx"] if t not in ("LV_D", "LV_E")]
    s2 = V.route_spec(M, tm2, "grade2_exam2")
    assert s2["levels"] == list("ABC"), s2["levels"]
    tm2["tpl-g2-exam2.hwpx"] = [t for t in tm2["tpl-g2-exam2.hwpx"] if not t.startswith("P2_")]
    s3 = V.route_spec(M, tm2, "grade2_exam2")
    assert s3["limits"]["perf_areas_max"] == 1, s3["limits"]
check("토큰이 빠지면 한도·단계가 따라 줄어든다", t_derived)

def t_scoring():
    assert spec_of("grade1_semester2")["scoring"] is False, "자유학기가 점수형으로 잡힘"
    for k in ("grade2_exam2", "grade3_exam0"):
        assert spec_of(k)["scoring"] is True, k
check("자유학기만 scoring=false", t_scoring)


print("\n[3] 정보·진로 — 예체능판을 쓰지만 성취 절이 맞지 않는다")
def t_special():
    sp = spec_of("grade2_exam0")["special"]
    assert sp, "special 안내가 없다"
    assert "정보" in sp and "진로" in sp, sp
    assert "교사가 한글에서 수정" in sp, sp
check("routing 에 special 안내가 있다", t_special)

def t_special_notice():
    """생성 완료 메시지(notices)에 반드시 실려야 한다 — 교사가 모르면 그대로 결재된다."""
    p = {
        "year": 2026, "semester": 2, "grade": 2, "subject": "정보",
        "teacher_name": "이", "weekly_hours": 2,
        "monthly_plan": [{"month": m, "hours_cum": "", "units": "", "standards": "", "eval_elements": ""}
                         for m in ["8월", "9월", "10월", "11월", "12월"]],
        "eval_purpose": ["", "", ""],
        "exam": {"count": 0, "ratio": 0, "rounds": []},
        "perf_ratio": 100,
        "perf_areas": [{"name": f"영역{i+1}", "points": 100, "ratio": r, "essay_ratio": 0,
                        "period": ""} for i, r in enumerate((40, 30, 30))],
        "achievement_levels": {k: "" for k in "ABC"},
        "perf_plans": [{"name": f"영역{i+1}", "absentee_points": "각 영역당 20점"} for i in range(3)],
        "min_achievement_plan": "",
    }
    out = gen.generate_v2(M, json.loads(json.dumps(p)), check_only=True)
    assert any("양식 안내" in n for n in out["notices"]), out["notices"]
    assert any("교사가 한글에서 수정" in n for n in out["notices"]), out["notices"]
    # 실제 생성 경로에도 실린다
    _fn, _b64, notices = gen.generate_v2(M, json.loads(json.dumps(p)))
    assert any("양식 안내" in n for n in notices), notices
check("정보 2학년 → 생성 안내에 실린다", t_special_notice)

def t_no_special_elsewhere():
    p = {"grade": 2, "semester": 2, "subject": "수학", "exam": {"count": 2}}
    assert spec_of(V.route_key(p, M))["special"] == "", "관계없는 유형에 안내가 붙음"
check("다른 유형에는 붙지 않는다", t_no_special_elsewhere)

def t_special_only_for_outsiders():
    """이 양식의 본래 교과(음악·미술·체육)에는 알릴 것이 없다 — 소음이 된다."""
    def notices(subject):
        p = {
            "year": 2026, "semester": 2, "grade": 2, "subject": subject,
            "teacher_name": "이", "weekly_hours": 2,
            "monthly_plan": [{"month": m, "hours_cum": "", "units": "", "standards": "", "eval_elements": ""}
                             for m in ["8월", "9월", "10월", "11월", "12월"]],
            "eval_purpose": ["", "", ""],
            "exam": {"count": 0, "ratio": 0, "rounds": []},
            "perf_ratio": 100,
            "perf_areas": [{"name": f"영역{i+1}", "points": 100, "ratio": r, "essay_ratio": 0,
                            "period": ""} for i, r in enumerate((40, 30, 30))],
            "achievement_levels": {k: "" for k in "ABC"},
            "perf_plans": [{"name": f"영역{i+1}", "absentee_points": "각 영역당 20점"} for i in range(3)],
            "min_achievement_plan": "",
        }
        out = gen.generate_v2(M, json.loads(json.dumps(p)), check_only=True)
        return [n for n in out["notices"] if n.startswith("[양식 안내]")]

    for s_ in M["routing"]["grade2_exam0"]["subjects_hint"]:
        assert notices(s_) == [], f"{s_} 에 불필요한 안내: {notices(s_)}"
    assert notices("정보"), "정보에 안내가 없다"
check("음악·미술·체육에는 안내하지 않고 정보에만 한다", t_special_only_for_outsiders)

print()
if FAIL:
    print(f"실패 {len(FAIL)}건: " + ", ".join(FAIL)); raise SystemExit(1)
print("전부 통과")
