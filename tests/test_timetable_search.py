"""구조화 탐색의 평가 불변·최고안 보존·국소 증명·실제 후보 다양성 회귀."""

from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch
import sys
import time
import math

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/timetable"))
from ortools.sat.python import cp_model
from engine.solver import solve_timetable, ScheduleModel, parse_options, pick_diverse_candidates
from engine.search import Search, restrict_neighborhood, NeighborhoodPolicy
from engine.connected import MoveGraph
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
    places = [{"unitId": "a@0", "day": "d", "start": 1},
              {"unitId": "b@0", "day": "d", "start": 3}, {"unitId": "b@1", "day": "d", "start": 4}]
    for stage in ("neighborhood", "diversity_local", "profile:공강"):
        search = Search(p, {"timeLimitSeconds": 1, "workers": 1, "quality": weights(morningBalance=1)}, time.monotonic(), None)
        record = search.keep(places, None)
        assert record["score"] == 4
        model = search.bounded_model(record)
        restrict_neighborhood(search.sm, model, places, set())
        profile = stage.startswith("profile:")
        if profile:
            model.minimize(0)
        status = search.run(model, time.monotonic() + .5, stage, "profile" if profile else "base")
        assert status == cp_model.OPTIMAL and search.best()["score"] == 4
        c = search.finish()["candidates"][0]
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
        return {"score": score, "placements": [], "_cells": {i: int(i in positions) for i in range(24)}}
    best = record(100, set())
    trap = record(101, set(range(12)))
    alternative = record(102, (set(range(12)) - {0, 1, 2}) | {12, 13, 14})
    chosen, stages = [best, trap], []
    search.pool = {"stub": best}
    def fake_run(model, until, stage, objective="base", original=False):
        stages.append(stage)
        if stage.startswith("diversity"):
            if chosen[1] is alternative:
                search.search_end = time.monotonic() - 1
            return cp_model.INFEASIBLE
        if stage.startswith("profile:"):
            chosen[1] = alternative
        assert len(stages) < 6
        return cp_model.FEASIBLE
    with patch.object(search, "selected", side_effect=lambda: chosen[:]), \
         patch.object(search, "best", return_value=best), \
         patch.object(search, "bounded_model", return_value=Mock()), \
         patch.object(search, "eligible", return_value=[]), \
         patch.object(search, "evaluate", return_value={}), \
         patch("engine.search.neighborhood", return_value=set()), \
         patch.object(search.sm, "distance", return_value=0), \
         patch.object(search, "run", side_effect=fake_run):
        search.candidates_search()
    assert stages[:3] == ["diversity_local", "diversity_local", "diversity"]
    assert stages[3].startswith("profile:") and stages[4] == "diversity_local"


def adaptive_policy_measurements():
    p = normalize(problem(), read_quality())
    search = Search(p, {"timeLimitSeconds": 1}, time.monotonic(), None)
    controller = NeighborhoodPolicy(search.policy)
    for i, name in enumerate(controller.names):
        assert controller.choose() == name
        controller.observe(name, i + 1, 2, cp_model.FEASIBLE)
    assert controller.choose() == "connected"
    assert controller.stats["connected"]["rate"] == 2.5
    controller.observe("connected", 0, 2, cp_model.OPTIMAL)
    assert controller.choose() == "cross"
    controller.observe("cross", -10, 0, cp_model.UNKNOWN)
    assert math.isfinite(controller.stats["cross"]["rate"])
    controller.observe("teacher", 1, 100, cp_model.OPTIMAL)
    assert controller.stats["teacher"]["duration"] <= search.policy["maxRoundSeconds"]
    for _ in range(20):
        name = controller.choose()
        controller.observe(name, 0, 1, cp_model.OPTIMAL)
    assert all(row["calls"] >= 2 for row in controller.stats.values())


def shared_move_blockers():
    raw = {"version": 1, "morningEnd": 2, "days": [{"id": "d", "periods": 3}],
           "classes": [{"id": f"c{i}"} for i in range(4)], "teachers": [{"id": "native"}],
           "subjects": [{"id": "s"}], "resources": [{"id": "room", "capacity": 2}], "lessons": [],
           "hardConstraints": [{"type": "sameTime", "lessonIds": ["c0a", "c3a"]}]}
    places = []
    for c in range(4):
        for start, letter in enumerate("abc", 1):
            uid = f"c{c}{letter}"
            raw["teachers"].append({"id": uid})
            raw["lessons"].append({"id": uid, "classId": f"c{c}", "subjectId": "s", "hours": 1,
                                    "teacherIds": [uid] + (["native"] if uid in ("c0a", "c1b") else []),
                                    "resourceIds": ["room"] if uid in ("c0a", "c1a", "c2b") else []})
            places.append({"unitId": uid + "@0", "day": "d", "start": start})
    def graph(data, positions):
        p = normalize(data, read_quality())
        assert inspect_schedule(p, positions)["valid"]
        return MoveGraph(ScheduleModel(p, read_quality(), parse_options(p, {})), positions)
    g = graph(raw, places)
    blocked = g.blockers("c0a@0", "d", 2)
    assert {"c0a@0", "c3a@0", "c0b@0", "c3b@0", "c1b@0"} <= blocked
    assert "c2b@0" not in blocked
    limited = deepcopy(raw)
    limited["resources"][0]["capacity"] = 1
    next(l for l in limited["lessons"] if l["id"] == "c1a")["resourceIds"] = []
    assert "c2b@0" in graph(limited, places).blockers("c0a@0", "d", 2)
    reserved = deepcopy(raw)
    reserved["lessons"] = [l for l in reserved["lessons"] if l["id"] != "c2c"]
    reserved["reservations"] = [{"classId": "c2", "day": "d", "period": 3, "teacherIds": ["native"]}]
    assert graph(reserved, [p for p in places if p["unitId"] != "c2c@0"]).blockers("c0a@0", "d", 3) is None


def profile_representatives_survive():
    p = normalize(problem(), read_quality())
    search = Search(p, {"timeLimitSeconds": 1}, time.monotonic(), None)
    search.policy = {**search.policy, "poolCapacity": 8}
    def add(label, score, costs):
        breakdown = {k: {"penalty": 0} for k in read_quality()["weights"]}
        for key, value in zip(("teacherGaps", "teacherDailyLoad", "subjectDaily"), costs):
            breakdown[key]["penalty"] = value
        breakdown["morningBalance"]["penalty"] = score - sum(costs)
        cells = {("c", "d", 1): (label, ("t",))}
        fingerprint = tuple(sorted(cells.items()))
        search.pool[fingerprint] = {"score": score, "_cells": cells, "evaluation": {"breakdown": breakdown}}
        search.prune()
        assert len(search.pool) <= 8
        return fingerprint
    protected = {add("best", 100, [20, 20, 20]), add("gaps", 103, [2, 50, 20]),
                 add("load", 104, [25, 1, 35]), add("subjects", 105, [25, 30, 0])}
    for i in range(100):
        add(str(i), 101 + i % 2, [21, 21, 21])
    assert protected <= search.pool.keys()
    extreme = add("too_expensive", 120, [0, 0, 0])
    assert extreme not in search.pool
    for row in search.pool.values():
        for cost in row["evaluation"]["breakdown"].values():
            cost["penalty"] = 0
    for i in range(100):
        add("zero" + str(i), 101, [0, 0, 0])
    assert search.best()["score"] == 100


def adaptive_deadline_and_recovery():
    raw = problem()
    p = normalize(raw, read_quality())
    places = [{"unitId": "a@0", "day": "d", "start": 1},
              {"unitId": "b@0", "day": "d", "start": 3}, {"unitId": "b@1", "day": "d", "start": 4}]
    clock = [1000.0]
    search = Search(p, {"timeLimitSeconds": 60, "previous": places, "changeMode": "quality"}, clock[0], None)
    calls = []
    def timeout(model, options, seconds, seed, progress, capture):
        assert 0 < seconds <= search.search_end - clock[0] + 1e-8
        calls.append(seconds)
        clock[0] += seconds + .01
        return None, cp_model.UNKNOWN
    with patch("engine.search.time.monotonic", side_effect=lambda: clock[0]), patch("engine.solver.cp_run", side_effect=timeout):
        search.quality_search()
        search.candidates_search()
        before = len(calls)
        search.quality_search()
        search.candidates_search()
        assert len(calls) == before
        assert search.finish()["candidates"][0]["changedCells"] == 0
    assert clock[0] - search.started < 60
    clock[0] = 1000.0
    search = Search(p, {"timeLimitSeconds": 60}, clock[0], None)
    selected = {search.sm.x[search.sm.representative[x["unitId"]], x["day"], x["start"]].index for x in places}
    class Solution:
        stopped = False
        objective_value = evaluate_quality(p, places, search.q, search.sm.baselines)["totalPenalty"]
        best_objective_bound = 0
        def value(self, expression): return self.objective_value
        def boolean_value(self, flag): return flag.index in selected
        def stop_search(self): self.stopped = True
        def status_name(self, status): return "FEASIBLE"
    solution = Solution()
    calls.clear()
    def recover(model, options, seconds, seed, progress, capture):
        calls.append(seconds)
        if len(calls) == 1:
            clock[0] += seconds
            return None, cp_model.UNKNOWN
        capture(solution)
        clock[0] = search.search_end
        return solution, cp_model.FEASIBLE
    with patch("engine.search.time.monotonic", side_effect=lambda: clock[0]), patch("engine.solver.cp_run", side_effect=recover):
        search.quality_search()
        result = search.finish()
    assert solution.stopped and len(calls) == 2
    assert calls[1] > calls[0] and result["status"] == "feasible"
    assert not result["candidates"][0]["optimality"]["provenOptimal"]
    clock[0] = 1000.0
    search = Search(p, {"timeLimitSeconds": 60, "previous": places, "changeMode": "quality"}, clock[0], None)
    evaluate = search.evaluate
    def slow_evaluation(record):
        clock[0] += 20
        return evaluate(record)
    with patch("engine.search.time.monotonic", side_effect=lambda: clock[0]), \
         patch.object(search, "evaluate", side_effect=slow_evaluation), patch("engine.solver.cp_run") as cp:
        assert search.run(search.sm.m, 1010, "profile:공강", "profile") is None
        assert cp.call_count == 0


def benchmark_korean_input():
    from benchmark_search import run as compare_run, HERE
    raw = problem()
    raw["days"][0]["id"] = "월요일"
    raw["metadata"] = {"source": "대동여중", "notes": ["원어민·창체 입력의 유니코드 전달"]}
    q = read_quality()
    p = normalize(raw, q)
    sm = ScheduleModel(p, q, parse_options(p, {}))
    result = compare_run(HERE, raw, {"timeLimitSeconds": .5, "maxCandidates": 1, "workers": 1}, p, q, sm.baselines)
    assert result["status"] == "feasible" and result["candidates"][0]["hardValidation"]["valid"]


checks = 0
for name, fn in [("부분 고정 전후 품질 기준 불변·국소 증명 격리", frozen_score_and_local_proof),
                 ("같은 실제 셀에서도 더 좋은 블록 구성을 보존", same_cells_better_block),
                 ("불연속 근무 가능 교시의 정확한 공강 압축", gap_compression_availability),
                 ("동일 카드 ID 순서와 무관한 기존 안 재최적화", canonical_previous),
                 ("실패 후 최고안 보존·단일 전체 시간 예산", failed_search_preserves_best),
                 ("반복 블록·분리 하드조건·변경 최소화 우선", repeated_blocks_and_hard_limits),
                 ("최고안과 다른 품질 장점의 대안 선별", strengths_and_tradeoffs),
                 ("동점 후보 조합 변경 뒤 다양성 탐색 재시도", retry_diversity_for_new_anchors),
                 ("실측 개선 효율·정체·회차 시간 상한", adaptive_policy_measurements),
                 ("공동교사·동시수업·자원 용량·예약의 이동 연결", shared_move_blockers),
                 ("품질 상한 안의 방향별 대표와 최고안 보존", profile_representatives_survive),
                 ("모든 탐색의 단일 마감·첫 해 복구·시간 초과 보존", adaptive_deadline_and_recovery),
                 ("별도 프로세스 비교의 한국어 입력·출력", benchmark_korean_input)]:
    fn()
    checks += 1
    print("  ✓ " + name)
print(f"전부 통과 — {checks}건")
