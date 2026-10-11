"""구조화 탐색의 평가 불변·최고안 보존·국소 증명·실제 후보 다양성 회귀."""

from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/timetable"))
from ortools.sat.python import cp_model
from engine.solver import solve_timetable, ScheduleModel, parse_options, pick_diverse_candidates
from engine.search import Search, restrict_neighborhood
from engine.model import normalize, inspect_schedule, expand_cells
from engine.quality import read_quality, evaluate_quality


def problem(periods=4):
    return {"version": 1, "morningEnd": 2, "days": [{"id": "d", "periods": periods, "breaksAfter": [2]}],
            "classes": [{"id": "c"}], "teachers": [{"id": "a"}, {"id": "b"}],
            "subjects": [{"id": "s"}, {"id": "t"}],
            "lessons": [{"id": "a", "classId": "c", "subjectId": "s", "teacherIds": ["a"], "hours": 2, "blocks": [2]},
                        {"id": "b", "classId": "c", "subjectId": "t", "teacherIds": ["b"], "hours": periods - 2}]}


def weights(**overrides):
    return {"weights": {k: overrides.get(k, 0) for k in read_quality()["weights"]}}


def run(p, **opts):
    return solve_timetable(p, {"timeLimitSeconds": 1, "workers": 1, "searchStrategy": "adaptive", **opts})


def frozen_score_and_local_proof():
    raw = problem()
    q = read_quality(weights(morningBalance=1))
    p = normalize(raw, q)
    search = Search(p, {"timeLimitSeconds": 1, "workers": 1, "quality": weights(morningBalance=1)}, time.monotonic(), None)
    places = [{"unitId": "a@0", "day": "d", "start": 1},
              {"unitId": "b@0", "day": "d", "start": 3}, {"unitId": "b@1", "day": "d", "start": 4}]
    record = search.keep(places, None)
    assert record["score"] == 4
    model = search.bounded_model(record)
    restrict_neighborhood(search.sm, model, places, set())
    status = search.run(model, time.monotonic() + .5, "neighborhood")
    assert status == cp_model.OPTIMAL and search.best()["score"] == 4
    result = search.finish()
    c = result["candidates"][0]
    assert c["evaluation"]["totalPenalty"] == 4 and c["hardValidation"]["valid"]
    assert not c["optimality"]["provenOptimal"] and c["optimality"]["lowerBound"] == 0


def same_cells_better_block():
    raw = problem(3)
    raw["days"][0]["breaksAfter"] = [1]
    raw["lessons"] = [{"id": "a", "classId": "c", "subjectId": "s", "teacherIds": ["a"], "hours": 3, "blocks": [2]}]
    q = read_quality(weights(blockBreakCrossing=3))
    p = normalize(raw, q)
    search = Search(p, {"timeLimitSeconds": 1, "workers": 1, "quality": weights(blockBreakCrossing=3)}, time.monotonic(), None)
    high = [{"unitId": "a@0", "day": "d", "start": 1}, {"unitId": "a@1", "day": "d", "start": 3}]
    low = [{"unitId": "a@0", "day": "d", "start": 2}, {"unitId": "a@1", "day": "d", "start": 1}]
    assert expand_cells(p, high) == expand_cells(p, low)
    search.keep(high, None)
    search.keep(low, None)
    assert search.best()["score"] == 0 and len(search.pool) == 1
    search.keep(high, 3, {"provenOptimal": True})
    assert search.best()["score"] == 0


def gap_compression_availability():
    raw = problem(7)
    raw["lessons"][0].update(hours=3, blocks=[])
    raw["lessons"][1]["hours"] = 4
    raw["teachers"][0]["availability"] = {"blockedSlots": [{"day": "d", "period": p} for p in (2, 5)]}
    q = read_quality(weights(teacherGaps=1))
    p = normalize(raw, q)
    sm = ScheduleModel(p, q, parse_options(p, {}))
    places = [{"unitId": f"a@{i}", "day": "d", "start": n} for i, n in enumerate((1, 4, 7))]
    places += [{"unitId": f"b@{i}", "day": "d", "start": n} for i, n in enumerate((2, 3, 5, 6))]
    model = sm.m.clone()
    restrict_neighborhood(sm, model, places, set())
    solver = cp_model.CpSolver()
    assert solver.solve(model) == cp_model.OPTIMAL
    e = evaluate_quality(p, sm.placements(solver), q, sm.baselines)
    assert e["totalPenalty"] == 3 and int(solver.value(sm.penalty)) == 3
    assert len(sm.x) < sum(len(v) for v in sm.choices.values())


def canonical_previous():
    raw = problem()
    original = run(raw, maxCandidates=1)["candidates"][0]["placements"]
    swapped = deepcopy(original)
    b = [x for x in swapped if x["unitId"].startswith("b@")]
    b[0]["unitId"], b[1]["unitId"] = b[1]["unitId"], b[0]["unitId"]
    result = run(raw, previous=swapped, changeMode="quality", maxCandidates=1)
    assert result["status"] == "feasible" and result["candidates"][0]["changedCells"] == 0
    assert result["candidates"][0]["evaluation"]["totalPenalty"] <= run(raw, maxCandidates=1)["candidates"][0]["evaluation"]["totalPenalty"]


def failed_search_preserves_best():
    raw = problem()
    old = run(raw, maxCandidates=1)["candidates"][0]["placements"]
    with patch("engine.solver.cp_run", return_value=(None, cp_model.UNKNOWN)):
        result = run(raw, previous=old, changeMode="quality", timeLimitSeconds=.01)
    assert result["status"] == "feasible" and result["candidates"][0]["changedCells"] == 0
    assert not result["candidates"][0]["optimality"]["provenOptimal"]
    assert result["search"]["elapsedSeconds"] < .5
    q = read_quality()
    p = normalize(raw, q)
    search = Search(p, {"timeLimitSeconds": .01, "workers": 1}, time.monotonic() - 1, None)
    with patch("engine.solver.cp_run") as call:
        search.quality_search()
        search.candidates_search()
        assert call.call_count == 0


def repeated_blocks_and_hard_limits():
    raw = problem(6)
    raw["lessons"][0].update(hours=5, blocks=[2, 2])
    raw["lessons"][1]["hours"] = 1
    result = run(raw, maxCandidates=1)
    assert result["candidates"][0]["hardValidation"]["valid"]
    assert sorted(x["unitId"] for x in result["candidates"][0]["placements"]) == ["a@0", "a@1", "a@2", "b@0"]
    raw["hardConstraints"] = [{"type": "differentDays", "lessonIds": ["a"]}]
    assert run(raw)["status"] == "infeasible"
    raw = problem()
    old = run(raw, maxCandidates=1)["candidates"][0]["placements"]
    partial = run(raw, previous=old)
    assert partial["search"]["strategy"] == "standard" and partial["changeOptimality"]["provenMinimumChanges"]
    assert run(raw, searchStrategy="invented")["status"] == "invalid_input"


def strengths_and_tradeoffs():
    def candidate(score, cells, profile):
        return {"evaluation": {"totalPenalty": score}, "optimality": {"provenOptimal": False},
                "_cells": dict(enumerate(cells)), "_profileCosts": profile}
    best = candidate(100, "0123", [5, 5, 5])
    ordinary = candidate(101, "1032", [5, 5, 6])
    special = candidate(103, "2301", [3, 8, 4])
    assert pick_diverse_candidates([best, ordinary, special], 2, 2, tradeoffs=True) == [best, special]
    result = run(problem(), qualityTolerance=1, minDifferentCells=1)
    p = normalize(problem(), read_quality())
    scores = [c["evaluation"]["totalPenalty"] for c in result["candidates"]]
    for c in result["candidates"]:
        assert inspect_schedule(p, c["placements"])["valid"]
        assert c["evaluation"]["totalPenalty"] <= min(scores) * 2
        assert all(n >= 1 for n in c["differentCells"].values())
        assert isinstance(c["strengths"], list)


def retry_diversity_for_new_anchors():
    raw = problem()
    p = normalize(raw, read_quality())
    search = Search(p, {"timeLimitSeconds": 1, "workers": 1}, time.monotonic(), None)
    def record(score, positions):
        return {"score": score, "_cells": {i: int(i in positions) for i in range(24)}}
    best = record(100, set())
    trap = record(101, set(range(12)))
    alternative = record(102, (set(range(12)) - {0, 1, 2}) | {12, 13, 14})
    chosen, stages = [best, trap], []
    search.pool = {"stub": best}
    def fake_run(model, until, stage, objective="base", original=False):
        stages.append(stage)
        if stage == "diversity" and stages.count(stage) == 1:
            return cp_model.INFEASIBLE
        if stage.startswith("profile:"):
            chosen[1] = alternative
        if stages.count("diversity") == 2:
            search.search_end = time.monotonic() - 1
        assert len(stages) < 5
        return cp_model.FEASIBLE
    with patch.object(search, "selected", side_effect=lambda: chosen[:]), \
         patch.object(search, "best", return_value=best), \
         patch.object(search, "bounded_model", return_value=Mock()), \
         patch.object(search, "eligible", return_value=[]), \
         patch.object(search.sm, "distance", return_value=0), \
         patch.object(search, "run", side_effect=fake_run):
        search.candidates_search()
    assert stages[0] == stages[2] == "diversity" and stages[1].startswith("profile:")


checks = 0
for name, fn in [("부분 고정 전후 품질 기준 불변·국소 증명 격리", frozen_score_and_local_proof),
                 ("같은 실제 셀에서도 더 좋은 블록 구성을 보존", same_cells_better_block),
                 ("불연속 근무 가능 교시의 정확한 공강 압축", gap_compression_availability),
                 ("동일 카드 ID 순서와 무관한 기존 안 재최적화", canonical_previous),
                 ("실패 후 최고안 보존·단일 전체 시간 예산", failed_search_preserves_best),
                 ("반복 블록·분리 하드조건·변경 최소화 우선", repeated_blocks_and_hard_limits),
                 ("최고안과 다른 품질 장점의 대안 선별", strengths_and_tradeoffs),
                 ("동점 후보 조합 변경 뒤 다양성 탐색 재시도", retry_diversity_for_new_anchors)]:
    fn()
    checks += 1
    print("  ✓ " + name)
print(f"전부 통과 — {checks}건")
