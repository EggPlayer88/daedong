"""시간표의 하드조건·완전성·최적성·실제 후보다양성 회귀."""

from copy import deepcopy
from itertools import product
from unittest.mock import patch
from pathlib import Path
import json
import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "timetable"))
from engine.solver import solve_timetable, ScheduleModel, parse_options, pick_diverse_candidates
from ortools.sat.python import cp_model
from engine.model import normalize, inspect_schedule, expand_cells
from engine.quality import read_quality, evaluate_quality


def tiny():
    return {"version": 1, "morningEnd": 1, "days": [{"id": "월", "periods": 2}],
            "classes": [{"id": "c1"}, {"id": "c2"}], "teachers": [{"id": "t1"}, {"id": "t2"}],
            "subjects": [{"id": "s1"}, {"id": "s2"}],
            "lessons": [{"id": f"{c}-{s}", "classId": c, "subjectId": s, "teacherIds": [t], "hours": 1}
                        for c in ["c1", "c2"] for s, t in [("s1", "t1"), ("s2", "t2")]]}


def run(problem, **opts):
    return solve_timetable(problem, {"timeLimitSeconds": 3, "workers": 1, "maxCandidates": 3, "minDifferentCells": 1, **opts})


def one_class(periods=4):
    return {"version": 1, "morningEnd": 2, "days": [{"id": "월", "periods": periods, "breaksAfter": [2]}],
            "classes": [{"id": "c1"}], "teachers": [{"id": "t1"}, {"id": "t2"}],
            "subjects": [{"id": "s1"}, {"id": "s2"}],
            "lessons": [{"id": "a", "classId": "c1", "subjectId": "s1", "teacherIds": ["t1"], "hours": 2, "blocks": [2]},
                        {"id": "b", "classId": "c1", "subjectId": "s2", "teacherIds": ["t2"], "hours": periods-2}]}


checks = 0
def check(name, fn):
    global checks
    try:
        fn()
        checks += 1
        print("  ✓ " + name)
    except Exception:
        print("  ✗ " + name)
        raise


def basic_and_diversity():
    result = run(tiny())
    assert result["status"] == "feasible" and len(result["candidates"]) == 2
    q = read_quality()
    p = normalize(tiny(), q)
    actual = []
    for c in result["candidates"]:
        assert c["hardValidation"]["valid"] and inspect_schedule(p, c["placements"])["valid"]
        assert c["optimality"]["provenOptimal"]
        actual.append(expand_cells(p, c["placements"]))
    assert actual[0] != actual[1] and set(result["candidates"][0]["differentCells"].values()) == {4}
    assert result["diagnostics"]


def exhaustive_quality():
    raw = one_class()
    q = read_quality(); p = normalize(raw, q)
    sm = ScheduleModel(p, q, parse_options(p, {}))
    scores = []
    ids = list(sm.choices)
    for starts in product(*(sm.choices[u] for u in ids)):
        placements = [{"unitId": u, "day": d, "start": s} for u, (d, s) in zip(ids, starts)]
        if inspect_schedule(p, placements)["valid"]:
            scores.append(evaluate_quality(p, placements, q, sm.baselines)["totalPenalty"])
    result = run(raw, maxCandidates=1)
    assert result["candidates"][0]["evaluation"]["totalPenalty"] == min(scores)
    assert result["candidates"][0]["optimality"]["provenOptimal"]
    assert result["candidates"][0]["evaluation"]["breakdown"]["subjectDaily"]["amount"] == 1
    # s1의 필수 2연속은 하나의 활동이다. s2의 두 별도 활동만 중복으로 센다.


def mutation_validation():
    raw = tiny(); p = normalize(raw, read_quality())
    valid = run(raw)["candidates"][0]["placements"]
    assert not inspect_schedule(p, valid[:-1])["valid"]
    assert not inspect_schedule(p, valid + [valid[0]])["valid"]
    bad = deepcopy(valid); bad[0]["start"] = 99
    assert not inspect_schedule(p, bad)["valid"]
    bad = deepcopy(valid)
    for x in bad:
        x["start"] = 1
    assert not inspect_schedule(p, bad)["valid"]


def rejected_inputs():
    samples = []
    p = tiny(); p["teachers"][0]["availability"] = {"allowdDays": ["월"]}; samples.append(p)
    p = tiny(); p["hardConstraints"] = [{"type": "unimplemented"}]; samples.append(p)
    p = tiny(); p["hardConstraints"] = [{"type": []}]; samples.append(p)
    p = tiny(); p["fixed"] = [{"classId": "c1", "subjectId": "s1", "day": [], "period": 1}]; samples.append(p)
    p = tiny(); p["lessons"][0]["hours"] = 0; samples.append(p)
    p = tiny(); p["lessons"][0]["blocks"] = [2]; samples.append(p)
    p = tiny(); p["lessons"] = p["lessons"][:-1]; samples.append(p)
    p = tiny(); p["teachers"].append({"id": "t1"}); samples.append(p)
    p = tiny(); p["lessons"][0]["teacherIds"] = ["missing"]; samples.append(p)
    p = tiny(); p["reservations"] = [{"classId": "c1", "day": "월", "period": 1}]*2; samples.append(p)
    for metadata in [None, [], {"notes": "미확정"}, {"notes": [None]}, {"source": 1}]:
        p = tiny(); p["metadata"] = metadata; samples.append(p)
    for p in samples:
        r = run(p)
        assert r["status"] == "invalid_input" and not r["candidates"], r


def fixed_availability():
    p = tiny(); p["teachers"][0]["availability"] = {"blockedSlots": [{"day": "월", "period": 1}]}
    p["fixed"] = [{"classId": "c1", "subjectId": "s1", "day": "월", "period": 1}]
    assert run(p)["status"] == "infeasible"
    p = tiny(); p["teachers"][0]["availability"] = {"allowedDays": []}
    assert run(p)["status"] == "infeasible"


def companions():
    p = tiny(); p["teachers"].append({"id": "assistant"})
    for l in p["lessons"]:
        l["teacherIds"].append("assistant")
    assert run(p)["status"] == "infeasible"
    p = tiny(); p["teachers"].append({"id": "assistant", "availability": {"allowedDays": []}})
    p["lessons"][0]["teacherIds"].append("assistant")
    assert run(p)["status"] == "infeasible"


def resources():
    p = tiny(); p["resources"] = [{"id": "room", "capacity": 1}]
    for l in p["lessons"]:
        l["resourceIds"] = ["room"]
    assert run(p)["status"] == "infeasible"
    p["resources"][0]["capacity"] = 2
    assert run(p)["status"] == "feasible"
    p["resources"][0]["availability"] = {"maxPeriod": 1}
    assert run(p)["status"] == "infeasible"


def blocks_and_breaks():
    p = one_class()
    p["fixed"] = [{"classId": "c1", "subjectId": "s1", "day": "월", "period": n} for n in [2, 3]]
    assert run(p)["status"] == "feasible"
    p["lessons"][0]["allowAcrossBreak"] = False
    assert run(p)["status"] == "infeasible"


def reservations():
    p = tiny(); p["lessons"] = p["lessons"][:-1]
    p["reservations"] = [{"classId": "c2", "day": "월", "period": 1, "teacherIds": ["t2"]}]
    assert run(p)["status"] == "feasible"
    p["teachers"][1]["availability"] = {"maxPeriod": 0}
    assert run(p)["status"] == "infeasible"


def hard_limits():
    p = tiny(); p["hardConstraints"] = [{"type": "maxDailyLoad", "teacherId": "t1", "max": 1}]
    assert run(p)["status"] == "infeasible"
    p = tiny(); p["hardConstraints"] = [{"type": "maxConsecutive", "teacherId": "t1", "max": 1}]
    assert run(p)["status"] == "infeasible"
    p = one_class(); p["hardConstraints"] = [{"type": "subjectDailyLimit", "classId": "c1", "subjectId": "s1", "max": 1}]
    assert run(p)["status"] == "infeasible"
    p = tiny(); p["hardConstraints"] = [{"type": "sameTime", "lessonIds": ["c1-s1", "c2-s1"]}]
    assert run(p)["status"] == "infeasible"
    p = tiny(); p["hardConstraints"] = [{"type": "differentDays", "lessonIds": ["c1-s1", "c2-s1"]}]
    assert run(p)["status"] == "infeasible"


def partial_and_locks():
    p = tiny(); original = run(p)["candidates"][0]["placements"]
    r = run(p, previous=original)
    assert r["changeOptimality"]["provenMinimumChanges"] and r["candidates"][0]["changedCells"] == 0
    q = read_quality(); model = normalize(p, q); cells = expand_cells(model, original)
    key = next(k for k, v in cells.items() if v[0] == "s1")
    p["teachers"][0]["availability"] = {"blockedSlots": [{"day": key[1], "period": key[2]}]}
    # 이 1일 문제에서는 t1이 하루 전 교시를 담당하므로 새 조건은 불가능하다.
    assert run(p, previous=original)["status"] == "infeasible"
    p = tiny(); key = next(iter(cells)); subject, teachers = cells[key]
    locks = [{"classId": key[0], "day": key[1], "period": key[2], "subjectId": subject, "teacherIds": list(teachers)}]
    r = run(p, locks=locks)
    assert len(r["candidates"]) == 1
    assert inspect_schedule(normalize(p, q), r["candidates"][0]["placements"], locks)["valid"]


def quality_cannot_change_hard_rules():
    p = tiny()
    assert run(p, quality={"morningEnd": 99})["status"] == "invalid_input"
    p["teachers"][0]["availability"] = {"morningOnly": True}
    assert run(p, quality={"weights": {"morningBalance": 0}})["status"] == "infeasible"


def repaired_minimum_changes():
    p = one_class(); p["lessons"][0]["blocks"] = []
    previous = run(p, maxCandidates=1)["candidates"][0]["placements"]
    before = expand_cells(normalize(p, read_quality()), previous)
    occupied = next(k for k, value in before.items() if value[0] == "s1")
    p["teachers"][0]["availability"] = {"blockedSlots": [{"day": occupied[1], "period": occupied[2]}]}
    q = read_quality(); model = normalize(p, q); opts = parse_options(model, {"previous": previous})
    sm = ScheduleModel(model, q, opts); ids = list(sm.choices)
    exhaustive = []
    for starts in product(*(sm.choices[u] for u in ids)):
        places = [{"unitId": u, "day": d, "start": s} for u, (d, s) in zip(ids, starts)]
        if inspect_schedule(model, places)["valid"]:
            cells = expand_cells(model, places)
            exhaustive.append((sum(cells[k] != before[k] for k in cells),
                               evaluate_quality(model, places, q, sm.baselines)["totalPenalty"]))
    r = run(p, previous=previous, maxCandidates=1)
    c = r["candidates"][0]
    assert (c["changedCells"], c["evaluation"]["totalPenalty"]) == min(exhaustive)
    assert c["changedCells"] == 2 and c["hardValidation"]["valid"]
    assert r["changeOptimality"]["provenMinimumChanges"]
    assert r["changeOptimality"]["lowerBound"] == 2 and c["optimality"]["provenOptimal"]


def deterministic_and_time_limit():
    p = tiny()
    assert run(p)["candidates"] == run(p)["candidates"]
    p = json.loads((ROOT / "packages/timetable/_assets/school-2026-2.json").read_text(encoding="utf-8"))
    r = run(p, timeLimitSeconds=0.000001)
    assert r["status"] == "unknown" and not r["candidates"]


def preserved_incumbent_and_numeric_inputs():
    p = tiny(); previous = run(p)["candidates"][0]["placements"]
    with patch("engine.solver.cp_run", return_value=(None, cp_model.UNKNOWN)):
        r = run(p, previous=previous)
    assert r["status"] == "feasible" and r["candidates"][0]["changedCells"] == 0
    assert r["changeOptimality"]["provenMinimumChanges"]
    assert not r["candidates"][0]["optimality"]["provenOptimal"]
    for options in [{"timeLimitSeconds": 10**1000}, {"qualityTolerance": 10**1000},
                    {"minDifferentCells": 10**30}, {"quality": {"weights": {"teacherGaps": 10**30}}}]:
        assert run(p, **options)["status"] == "invalid_input"
    for extra in [{"type": "maxDailyLoad", "teacherId": "t1", "max": 10**30}]:
        p["hardConstraints"] = [extra]
        assert run(p)["status"] == "invalid_input"
    p = tiny(); p["lessons"][0]["hours"] = 10**12
    assert run(p)["status"] == "invalid_input"


def unavoidable_block_balance():
    p = one_class()
    p["lessons"][1]["blocks"] = [2]
    for l in p["lessons"]:
        l["allowAcrossBreak"] = False
    r = run(p, maxCandidates=1)
    e = r["candidates"][0]["evaluation"]
    assert e["breakdown"]["subjectDaily"]["amount"] == 0
    assert e["breakdown"]["morningBalance"]["amount"] == 0


def class_reservation_availability():
    p = tiny(); p["lessons"] = p["lessons"][:-1]
    p["reservations"] = [{"classId": "c2", "day": "월", "period": 1}]
    p["classes"][1]["availability"] = {"blockedSlots": [{"day": "월", "period": 1}]}
    assert run(p)["status"] == "infeasible"


def reservation_only():
    p = {"version": 1, "morningEnd": 1, "days": [{"id": "월", "periods": 1}],
         "classes": [{"id": "c1"}], "teachers": [], "subjects": [], "lessons": [],
         "reservations": [{"classId": "c1", "day": "월", "period": 1}]}
    r = solve_timetable(p, {"timeLimitSeconds": 1, "workers": 1})
    assert r["status"] == "feasible" and len(r["candidates"]) == 1
    assert r["candidates"][0]["hardValidation"]["valid"] and r["candidates"][0]["placements"] == []
    assert r["candidates"][0]["evaluation"]["totalPenalty"] == 0


def lunch_block_preference():
    p = one_class()
    weights = {k: 0 for k in read_quality()["weights"]}
    weights["blockBreakCrossing"] = 5
    r = run(p, maxCandidates=1, quality={"weights": weights})
    assert r["candidates"][0]["evaluation"]["totalPenalty"] == 0
    p["fixed"] = [{"classId": "c1", "subjectId": "s1", "day": "월", "period": n} for n in [2, 3]]
    c = run(p, maxCandidates=1, quality={"weights": weights})["candidates"][0]
    assert c["hardValidation"]["valid"] and c["evaluation"]["totalPenalty"] == 5
    assert c["evaluation"]["breakdown"]["blockBreakCrossing"]["amount"] == 1
    p["lessons"][0]["allowAcrossBreak"] = False
    assert run(p, quality={"weights": weights})["status"] == "infeasible"


def confirmed_school_staff():
    p = json.loads((ROOT / "packages/timetable/_assets/school-2026-2.json").read_text(encoding="utf-8"))
    native = [l for l in p["lessons"] if l["subjectId"] == "s24"]
    assert len(native) == len(p["classes"])
    assert all(len(l["teacherIds"]) == 2 and l["teacherIds"][1] == "native-1" for l in native)
    homeroom = {l["classId"]: l["teacherIds"][1] for l in p["lessons"] if l["subjectId"] == "s11"}
    assert all(r["teacherIds"] == [homeroom[r["classId"]]] for r in p["reservations"])
    assert all(l["allowAcrossBreak"] for l in p["lessons"] if l["blocks"])


def diverse_pair_selection():
    def candidate(score, positions):
        return {"evaluation": {"totalPenalty": score}, "optimality": {"provenOptimal": False},
                "_cells": {i: int(i in positions) for i in range(24)}}
    best = candidate(100, set())
    greedy_trap = candidate(101, set(range(12)))
    b = candidate(102, (set(range(12)) - {0, 1, 2}) | {12, 13, 14})
    c = candidate(102, (set(range(12)) - {3, 4, 5}) | {15, 16, 17})
    chosen = pick_diverse_candidates([best, greedy_trap, b, c], 12, 3)
    assert chosen == [best, b, c]
    assert pick_diverse_candidates([best, greedy_trap, b, c], 12, 2) == [best, greedy_trap]
    tied = [{"evaluation": {"totalPenalty": 100}, "optimality": {"provenOptimal": False},
             "_cells": dict(enumerate(permutation))} for permutation in ["012345", "102345", "013245", "210354"]]
    chosen = pick_diverse_candidates(tied, 4, 3)
    assert len(chosen) == 3 and all(c in chosen for c in tied[1:])


for name, fn in [("완전 배정·중복 제거·실제 배치 다양성", basic_and_diversity),
                 ("작은 문제 전수탐색과 최적 점수 일치", exhaustive_quality),
                 ("삭제·중복·교시 변이 독립 검증", mutation_validation),
                 ("알 수 없는 조건·깨진 입력·시수·블록 오류 거부", rejected_inputs),
                 ("고정 수업도 교사 가용시간 준수", fixed_availability),
                 ("동반교사 충돌과 근무 제한", companions), ("공유 자원 용량·가용시간", resources),
                 ("블록 전체 점유·점심 경계 하드조건", blocks_and_breaks), ("예약 교사의 실제 의무와 가용시간", reservations),
                 ("일일·연속·과목·동시·분리 하드조건", hard_limits), ("변경 최소화와 사용자 잠금", partial_and_locks),
                 ("품질 설정으로 하드조건 완화 금지", quality_cannot_change_hard_rules),
                 ("새 불가시간의 실제 변경 최소량·품질 전수검증", repaired_minimum_changes),
                 ("단일 워커 재현성과 시간 초과의 정직한 반환", deterministic_and_time_limit)]:
    check(name, fn)
for name, fn in [("탐색 실패에도 기존 유효 해 보존·수치 범위 방어", preserved_incumbent_and_numeric_inputs),
                 ("필수 블록의 불가피한 오전·오후 손실 제외", unavoidable_block_balance),
                 ("예약 학급도 모든 가용시간 조건 준수", class_reservation_availability),
                 ("일반 수업 없이 예약으로 완전한 시간표", reservation_only),
                 ("점심 경계 블록은 허용하되 품질 선호로 회피", lunch_block_preference),
                 ("확인된 원어민 공동교사·창체 담임 자산", confirmed_school_staff),
                 ("최고안 보존·가능한 다양한 대안 쌍 전수선별", diverse_pair_selection)]:
    check(name, fn)
print(f"전부 통과 — {checks}건")
