#!/usr/bin/env python3
"""작년 자료에서 물려받은 값 중 확인이 필요한 것 → 확인 카드 안내 (_prefill).

대화에 작년 값을 넣는 일은 chat.js 가 한다 (tests/test_prefill.mjs).
여기서 보는 것은 그 반대편 — 교사가 확정한 값이 **작년 자료의 불확실한 부분을
그대로 물려받았는지** 서버가 알아채는가다.
"""
import importlib.util, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
P = gen._prefill
M = gen.load_manifest()
IDX = gen.load_prefill_index()

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")


print("\n[1] 색인 — 파일명이 아니라 파일 안의 subject/grade")
def t_index():
    assert len(IDX) >= 20, f"{len(IDX)}건뿐"
    assert "수학|3" in IDX and "진로와 직업|2" in IDX, sorted(IDX)[:5]
    # 파일명은 '진로와직업_2.json' 인데 색인 키는 파일 안의 '진로와 직업' 이다
    assert not any(k.startswith("진로와직업") for k in IDX), sorted(IDX)
check("subject|grade 로 묶인다", t_index)

def t_index_safe():
    assert P.load_index(ROOT / "없는폴더") == {}, "없는 폴더에서 터짐"
check("없는 폴더는 빈 색인 (예외 아님)", t_index_safe)


def plan(subject, grade, exam_essay, perf_essays, count=1):
    return {
        "subject": subject, "grade": grade,
        "exam": {"count": count, "rounds": [{"essay_ratio": exam_essay}]},
        "perf_areas": [{"essay_ratio": e} for e in perf_essays],
    }


print("\n[2] % 표기가 없던 교과 — 작년 값을 그대로 쓰면 확인을 요청한다")
def t_flag():
    # 2학년 기술가정: 작년 칸이 '8','30','30' 으로 % 없이 적혀 있었다 (실측)
    n = P.check(plan("기술가정", 2, 8, [30, 30]), IDX)
    assert n, "확인 안내가 없다"
    assert "작년 값 확인 필요" in n[0], n[0]
    assert "% 표기가 없습니다" in n[0], n[0]
    assert "8, 30, 30" in n[0], n[0]
check("작년 값 그대로 → 안내", t_flag)

def t_changed():
    n = P.check(plan("기술가정", 2, 8, [20, 30]), IDX)
    assert n == [], f"교사가 고쳤는데도 안내가 뜬다: {n}"
check("교사가 값을 고치면 안내하지 않는다", t_changed)

def t_pct_ok():
    # 3학년 수학: 작년 칸이 '8%','10%','15%' 로 온전하다 → 확인할 것이 없다
    assert P.check(plan("수학", 3, 8, [10, 15]), IDX) == []
check("% 표기가 온전하면 조용하다", t_pct_ok)

def t_unknown():
    assert P.check(plan("수학", 1, 8, [10, 15]), IDX) == [], "팩 없는 조합에 안내가 뜸"
    assert P.check({"subject": "", "grade": 3}, IDX) == [], "교과 없이 안내가 뜸"
check("팩이 없거나 정보가 모자라면 조용하다", t_unknown)

def t_broken():
    assert P.check({"subject": "수학", "grade": "삼", "exam": "문자열"}, IDX) == []
    assert P.check({"subject": "기술가정", "grade": 2, "exam": None, "perf_areas": "배열아님"}, IDX) == []
check("깨진 입력에도 죽지 않는다", t_broken)


print("\n[3] 확인 카드까지 실리는가 (check_only 응답)")
def full(subject, grade, exam_essay, perf_essays, ratios=None):
    return {
        "year": 2026, "semester": 2, "grade": grade, "subject": subject,
        "teacher_name": "이", "weekly_hours": 3,
        "monthly_plan": [{"month": m, "hours_cum": "", "units": "", "standards": "", "eval_elements": ""}
                         for m in ["8월", "9월", "10월", "11월", "12월"]],
        "eval_purpose": ["", "", ""],
        "exam": {"count": 1, "ratio": 40, "mc_points": 60, "short_points": 10, "essay_points": 30,
                 "rounds": [{"label": "정기시험", "period": "", "standards": "", "ratio": 40,
                             "mc": 60, "short": 10, "essay": 30, "essay_ratio": exam_essay}]},
        "perf_ratio": 60,
        "perf_areas": [
            {"name": f"영역{i+1}", "points": 100,
             "ratio": (ratios or [60 / len(perf_essays)] * len(perf_essays))[i],
             "essay_ratio": e}
            for i, e in enumerate(perf_essays)
        ],
        "achievement_levels": {k: "" for k in "ABCDE"},
        "perf_plans": [{"name": f"영역{i+1}", "absentee_points": "각 영역당 20점"}
                       for i in range(len(perf_essays))],
        "min_achievement_plan": "",
    }

def t_card():
    # ⚠ 영역별 서·논술 비율이 영역 비율과 같으면 V10(논술형만 실시)에 걸린다.
    #   여기서 보려는 것은 그 규칙이 아니라 안내 전달이므로 비율을 갈라 둔다.
    out = gen.generate_v2(M, full("기술가정", 2, 8, [35, 25], ratios=[40, 20]), check_only=True)
    assert not [f for f in out["findings"] if f["severity"] == "ERROR"], out["findings"]
    assert any("작년 값 확인 필요" in n for n in out["notices"]), out["notices"]
check("기술가정 2학년 → notices 에 실린다", t_card)

def t_card_quiet():
    out = gen.generate_v2(M, full("수학", 3, 8, [10, 15]), check_only=True)
    assert not [f for f in out["findings"] if f["severity"] == "ERROR"], out["findings"]
    assert not [n for n in out["notices"] if "작년 값" in n], out["notices"]
check("수학 3학년 → 불필요한 안내 없음", t_card_quiet)


print("\n[4] 회귀 — 서·논술형 칸을 전부 세는가 (파서 v1 버그)")
def t_v04_ok():
    """수학 3학년 작년 실적 8 + 10 + 15 = 33% 는 규정(30%)을 충족한다.

    파서 v1 은 회차·영역의 **첫 칸만** 수집해 18% 로 읽었고, 그 값 그대로면
    멀쩡한 계획이 V04 로 거부됐다. prefill 의 essay_detail 이 진실이다.
    """
    ed = IDX["수학|3"]["essay_detail"]
    assert ed["computed_sum"] == 33.0, ed
    cells = [float(x.rstrip("%")) for x in ed["exam_cells"] + ed["perf_cells"]]
    assert sum(cells) == ed["computed_sum"], (cells, ed["computed_sum"])
    # 작년 문서의 합계 칸과도 일치해야 한다 (검산)
    assert float(str(ed["total_cell_last_year"]).rstrip("%")) == ed["computed_sum"], ed
    out = gen.generate_v2(M, full("수학", 3, 8, [10, 15]), check_only=True)
    assert "V04" not in [f["code"] for f in out["findings"]], out["findings"]
check("작년 그대로(33%) → V04 통과", t_v04_ok)

def t_v04_still_blocks():
    """규칙 자체는 그대로다 — 진짜 미달이면 여전히 막는다."""
    try:
        gen.generate_v2(M, full("수학", 3, 4, [5, 5]), check_only=True)
    except gen.RegulationViolation as e:
        assert any(f["code"] == "V04" for f in e.findings), e.findings
        return
    raise AssertionError("14% 인데 통과했다")
check("진짜 미달(14%)은 여전히 거부", t_v04_still_blocks)

def t_all_blocks_pass():
    """정기시험이 있는 교과는 작년 실적이 전부 규정을 충족해야 한다 (계란님 확인)."""
    need = gen.load_regulation()["thresholds"]["essay_total_min"]
    bad = []
    for key, d in IDX.items():
        ed = d.get("essay_detail") or {}
        if int(gen._fill.first_num((d.get("exam") or {}).get("count"), 0)) == 0:
            continue  # 유형 C 는 서·논술 규정 대상이 아니다
        s = ed.get("computed_sum")
        if s is None or s < need:
            bad.append((key, s))
    assert not bad, f"작년 실적이 규정 미달인 교과: {bad}"
check("정기시험 있는 전 교과가 작년 실적으로 30% 이상", t_all_blocks_pass)

print()
if FAIL:
    print(f"실패 {len(FAIL)}건: " + ", ".join(FAIL)); raise SystemExit(1)
print("전부 통과")
