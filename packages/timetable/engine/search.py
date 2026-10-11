"""최고안 보존, 학교 구조의 부분 재최적화, 품질 상한 안의 방향별 대안 탐색."""

from collections import defaultdict
from copy import deepcopy
import math
import random
import time

from ortools.sat.python import cp_model

from .model import inspect_schedule, expand_cells
from .quality import read_quality, evaluate_quality
from . import solver as core
from .connected import connected_neighborhood


def cell_distance(a, b):
    return sum(a[k] != b[k] for k in a)


def selection_key(best, chosen):
    return best["score"], tuple(sorted(tuple(sorted(r["_cells"].items())) for r in chosen))


class NeighborhoodPolicy:
    """개선량/실측초를 기록하되 모든 종류를 주기적으로 다시 탐색한다."""
    names = ("teacher", "class", "days", "cross", "connected")

    def __init__(self, policy):
        self.policy = policy
        self.stats = {name: {"calls": 0, "gain": 0, "seconds": 0, "rate": 0,
                             "last": -1, "stalls": 0, "duration": policy["roundSeconds"]} for name in self.names}
        self.turn = 0

    def choose(self):
        untried = [name for name, row in self.stats.items() if row["calls"] == 0]
        if untried:
            return untried[0]
        if self.turn % self.policy["explorationEvery"] == 0:
            return min(self.names, key=lambda name: self.stats[name]["last"])
        return max(self.names, key=lambda name: (self.stats[name]["rate"] / (1 + self.stats[name]["stalls"]), -self.stats[name]["last"]))

    def observe(self, name, gain, seconds, status):
        row = self.stats[name]
        gain = max(0, gain)
        row["calls"] += 1
        row["gain"] += gain
        row["seconds"] += max(0, seconds)
        rate = gain / seconds if seconds > 0 else 0
        alpha = self.policy["rewardSmoothing"]
        row["rate"] = rate if row["calls"] == 1 else alpha * rate + (1 - alpha) * row["rate"]
        row["stalls"] = 0 if gain else row["stalls"] + 1
        row["last"] = self.turn
        self.turn += 1
        if status == cp_model.OPTIMAL:
            row["duration"] = min(self.policy["maxRoundSeconds"], max(self.policy["minRoundSeconds"], seconds * 1.25))
        elif gain:
            row["duration"] = min(self.policy["maxRoundSeconds"], row["duration"] * 1.25)
        else:
            row["duration"] = self.policy["roundSeconds"]


def neighborhood(sm, placements, evaluation, step, rng, fraction):
    """빈칸 없는 학급의 교환 순환을 열고, 동일 카드 그룹·동시 활동을 함께 푼다."""
    info = {}
    for p in placements:
        u = sm.p["unitMap"][p["unitId"]]
        lesson = sm.p["lessonMap"][u["lessonId"]]
        info[p["unitId"]] = (lesson, p["day"])
    classes = list(sm.p["classMap"])
    days = list(sm.p["dayMap"])
    kind = step % 4
    if kind == 0:
        teachers = sorted(evaluation["teacherBurden"], key=lambda t: evaluation["teacherBurden"][t]["penalty"], reverse=True)
        teacher = teachers[(step // 4) % len(teachers)] if teachers else None
        free = {uid for uid, (l, _) in info.items() if teacher in l["teacherIds"]}
        class_days = {(info[uid][0]["classId"], info[uid][1]) for uid in free}
        # 동반 교사만 풀면 학급의 다른 카드가 자리를 막으므로 연결된 학급·요일도 푼다.
        free |= {uid for uid, (l, day) in info.items() if (l["classId"], day) in class_days}
    elif kind == 1:
        losses = defaultdict(int)
        for issue in evaluation["weaknesses"]:
            if "classId" in issue:
                losses[issue["classId"]] += issue["penalty"]
        ranked = sorted(classes, key=lambda c: losses[c], reverse=True)
        chosen = set(ranked[:max(1, math.ceil(len(classes) * fraction))])
        free = {uid for uid, (l, _) in info.items() if l["classId"] in chosen}
    elif kind == 2:
        chosen = set(rng.sample(days, min(2, len(days))))
        free = {uid for uid, (_, day) in info.items() if day in chosen}
    else:
        chosen_classes = set(rng.sample(classes, max(1, math.ceil(len(classes) * fraction))))
        chosen_days = set(rng.sample(days, min(2, len(days))))
        free = {uid for uid, (l, day) in info.items() if l["classId"] in chosen_classes and day in chosen_days}
    changed = True
    while changed:
        before = len(free)
        if kind < 2:
            # 넓은 주간 탐색과 작은 요일 탐색을 섞는다. 그룹 변수는 카드 순서 제약이 없다.
            reps = {sm.representative[u] for u in free}
            free |= {u for u, rep in sm.representative.items() if rep in reps}
        for h in sm.p["hardConstraints"]:
            if h["type"] == "sameTime":
                connected = {uid for uid, (l, _) in info.items() if l["id"] in h["lessonIds"]}
                if connected & free:
                    free |= connected
        changed = len(free) != before
    return free


def restrict_neighborhood(sm, model, placements, free):
    """원모델을 복제해 동결한다. 가용 위치·오전 기준은 다시 계산하지 않는다."""
    for p in placements:
        if p["unitId"] not in free:
            key = sm.representative[p["unitId"]], p["day"], p["start"]
            model.add(sm.x[key] == 1)


class Search:
    def __init__(self, problem, raw_options, started, progress):
        self.policy = core.search_policy()
        self.q = read_quality(raw_options.get("quality"))
        self.p = problem
        self.o = core.parse_options(problem, raw_options)
        self.sm = core.ScheduleModel(problem, self.q, self.o)
        self.started, self.progress = started, progress
        self.end = started + self.o["timeLimitSeconds"]
        reserve = min(self.policy["verificationReserveSeconds"], self.o["timeLimitSeconds"] * 0.05)
        self.search_end = self.end - reserve
        self.pool, self.stages, self.protected = {}, [], set()
        self.bound, self.proved_value = 0, None
        self.last_original_status = None
        self.rng = random.Random(self.o["seed"])
        self.notes = []
        self.controller = NeighborhoodPolicy(self.policy)
        if self.o.get("previous") is not None:
            old = inspect_schedule(problem, self.o["previous"], self.o["fixed"])
            if old["valid"]:
                self.keep(self.o["previous"], None)
                self.sm.hint(self.sm.m, self.o["previous"])

    def evaluate(self, record):
        if "evaluation" not in record:
            valid = inspect_schedule(self.p, record["placements"], self.o["fixed"])
            if not valid["valid"]:
                raise RuntimeError(f"후보 독립 검증 실패: {valid['errors']}")
            evaluation = evaluate_quality(self.p, record["placements"], self.q, self.sm.baselines)
            if evaluation["totalPenalty"] != record["score"]:
                raise RuntimeError("탐색 목적값과 독립 품질 점수가 일치하지 않습니다.")
            record["evaluation"], record["hardValidation"] = evaluation, valid
        return record["evaluation"]

    def keep(self, placements, score, proof=None, protect=False):
        cells = expand_cells(self.p, placements)
        key = tuple(sorted(cells.items()))
        if score is None:
            score = evaluate_quality(self.p, placements, self.q, self.sm.baselines)["totalPenalty"]
        record = {"placements": placements, "score": score, "_cells": cells, "proof": proof,
                  "changedCells": None if self.o["previousCells"] is None else cell_distance(cells, self.o["previousCells"])}
        old = self.pool.get(key)
        if old is None or score < old["score"] or (score == old["score"] and proof is not None):
            self.pool[key] = record
        if protect:
            self.protected.add(key)
        self.prune()
        return self.pool.get(key, record)

    def prune(self):
        if len(self.pool) > self.policy["poolCapacity"]:
            # 선택된 대안과 품질 상한 안의 방향별 대표가 비슷한 중간 해에 밀리지 않게 한다.
            protected = set(self.protected)
            eligible = self.eligible()
            for kinds in self.policy["profiles"].values():
                representative = min(eligible, key=lambda r: (sum(self.evaluate(r)["breakdown"][k]["penalty"] for k in kinds), r["score"]))
                protected.add(tuple(sorted(representative["_cells"].items())))
            best = self.best()
            protected.add(tuple(sorted(best["_cells"].items())))
            expendable = [k for k in self.pool if k not in protected]
            if not expendable:
                expendable = [k for k in self.pool if self.pool[k] is not best]
            worst = max(expendable, key=lambda k: self.pool[k]["score"])
            del self.pool[worst]

    def best(self):
        return min(self.pool.values(), key=lambda r: r["score"]) if self.pool else None

    def run(self, model, until, stage, objective="base", original=False, stop_after_first=False, details=None):
        remaining = min(until, self.search_end) - time.monotonic()
        if remaining <= 0:
            return None
        score_before = self.best()["score"] if self.pool else None
        if self.progress:
            self.progress({"event": "stage", "stage": stage, "remainingSeconds": remaining, "bestPenalty": score_before})
        seed = (self.o["seed"] + len(self.stages) * 104729) % (2**31)
        start = time.monotonic()
        profile_kinds = self.policy["profiles"].get(stage.removeprefix("profile:")) if objective == "profile" else None
        def profile_minimum():
            return min((sum(self.evaluate(r)["breakdown"][k]["penalty"] for k in profile_kinds) for r in self.eligible()), default=None)
        profile_before = profile_minimum() if profile_kinds else None
        def capture(solution):
            score = int(solution.value(self.sm.penalty))
            self.keep(self.sm.placements(solution), score)
            if self.progress:
                self.progress({"event": "incumbent", "stage": stage, "objective": score, "bestPenalty": self.best()["score"]})
            if stop_after_first:
                solution.stop_search()
        # 후보 평가와 진행 콜백이 소비한 시간도 전체 예산에 포함한다.
        remaining = min(until, self.search_end) - time.monotonic()
        if remaining <= 0:
            return None
        solver, status = core.cp_run(model, self.o, remaining, seed, None, capture)
        if status == cp_model.MODEL_INVALID:
            raise RuntimeError(model.validate())
        if original:
            self.last_original_status = status
        if status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            score = int(solver.value(self.sm.penalty))
            proof = None
            if objective == "base":
                if original:
                    self.bound = max(self.bound, solver.best_objective_bound)
                    if core.proven(solver, status):
                        self.proved_value = score
                elif stage == "diversity" and core.proven(solver, status):
                    proof = {"provenOptimal": True, "lowerBound": solver.best_objective_bound,
                             "absoluteGap": max(0, score - solver.best_objective_bound),
                             "scope": "diversity_and_change_constraints", "solverStatus": "OPTIMAL"}
            record = self.keep(self.sm.placements(solver), score, proof, protect=True)
            self.evaluate(record)
        score_after = self.best()["score"] if self.pool else None
        chosen = self.selected()
        self.stages.append({"stage": stage, "status": "UNKNOWN" if solver is None else solver.status_name(status),
                            "elapsedSeconds": time.monotonic() - start, "bestPenalty": score_after,
                            "improvement": 0 if score_before is None or score_after is None else max(0, score_before - score_after),
                            "candidateCount": len(chosen), **(details or {})})
        if profile_kinds:
            self.stages[-1].update(profileBefore=profile_before, profileAfter=profile_minimum())
        self.protected = {tuple(sorted(c["_cells"].items())) for c in chosen}
        return status

    def bounded_model(self, hint, ceiling=None):
        model = self.sm.m.clone()
        if hint is not None:
            model.add(self.sm.penalty <= (hint["score"] if ceiling is None else ceiling))
            self.sm.hint(model, hint["placements"])
        return model

    def quality_search(self):
        # 최고안 모델은 끝까지 원문제의 전체 배치를 허용한다.
        initial_fraction = self.policy["warmInitialFraction"] if self.best() else self.policy["initialFraction"]
        initial_end = self.started + self.o["timeLimitSeconds"] * initial_fraction
        status = self.run(self.bounded_model(self.best()), initial_end, "initial", original=True)
        if status == cp_model.INFEASIBLE and not self.pool:
            return
        if not self.pool:
            # 짧은 회차의 재시작을 반복하지 않고 남은 시간으로 첫 유효해를 확보한다.
            self.run(self.bounded_model(None), self.search_end, "recovery", original=True, stop_after_first=True)
        step = 0
        while self.pool and self.proved_value is None:
            chosen = self.selected()
            reserve = 0 if self.o["maxCandidates"] == 1 else min(self.o["timeLimitSeconds"] * self.policy["candidateReserveFraction"],
                      self.policy["candidateReserveSeconds"] + self.policy["missingCandidateSeconds"] * (self.o["maxCandidates"] - len(chosen)))
            quality_end = self.search_end - reserve
            if time.monotonic() >= quality_end:
                break
            best = self.best()
            model = self.bounded_model(best)
            stage = "restart" if step and step % self.policy["restartEvery"] == 0 else "neighborhood"
            action = self.controller.choose()
            row = self.controller.stats[action]
            duration = row["duration"]
            details = {}
            if stage == "neighborhood":
                fraction = self.policy["neighborhoodFractions"][min(row["stalls"], len(self.policy["neighborhoodFractions"]) - 1)]
                if action == "connected":
                    free = connected_neighborhood(self.sm, best["placements"], self.evaluate(best), self.rng, row["calls"], fraction, self.policy)
                else:
                    cursor = self.controller.names.index(action) + 4 * row["calls"]
                    free = neighborhood(self.sm, best["placements"], self.evaluate(best), cursor, self.rng, fraction)
                restrict_neighborhood(self.sm, model, best["placements"], free)
                details = {"operator": action, "freeActivities": len(free)}
            status = self.run(model, min(quality_end, time.monotonic() + duration), stage, original=stage == "restart", details=details)
            if status is not None and stage == "neighborhood":
                result = self.stages[-1]
                self.controller.observe(action, result["improvement"], result["elapsedSeconds"], status)
            step += 1

    def eligible(self):
        best = self.best()
        if best is None:
            return []
        ceiling = best["score"] + math.floor(best["score"] * self.o["qualityTolerance"])
        return [r for r in self.pool.values() if r["score"] <= ceiling]

    def selected(self):
        candidates = []
        for r in self.eligible():
            evaluation = self.evaluate(r)
            costs = [sum(evaluation["breakdown"][k]["penalty"] for k in kinds) for kinds in self.policy["profiles"].values()]
            candidates.append({**r, "evaluation": evaluation, "_profileCosts": costs,
                               "optimality": r["proof"] or {"provenOptimal": False}})
        if not candidates:
            return []
        return core.pick_diverse_candidates(candidates, self.o["minDifferentCells"], self.o["maxCandidates"], tradeoffs=True)

    def candidates_search(self):
        step = 0
        profiles = list(self.policy["profiles"].items())
        diversity_failed_for = None
        tried_profiles = set()
        diversity_attempts = 0
        # 각 회차는 원본 복제로 시작해 이전 대안의 거리 조건이 최고안 개선을 제한하지 않는다.
        while self.pool and time.monotonic() < self.search_end and self.o["maxCandidates"] > 1:
            chosen = self.selected()
            best = self.best()
            anchors_key = selection_key(best, chosen)
            if diversity_failed_for is not None and diversity_failed_for != anchors_key:
                # 최고 점수가 같아도 후보 조합이 달라지면 새 대안이 가능할 수 있다.
                diversity_failed_for = None
                tried_profiles.clear()
            ceiling = best["score"] + math.floor(best["score"] * self.o["qualityTolerance"])
            model = self.bounded_model(best, ceiling)
            if len(chosen) < self.o["maxCandidates"] and diversity_failed_for != anchors_key:
                anchors = chosen
                for r in anchors:
                    model.add(self.sm.distance(r["_cells"]) >= self.o["minDifferentCells"])
                hints = [r for r in self.eligible() if all(cell_distance(r["_cells"], a["_cells"]) >= self.o["minDifferentCells"] for a in anchors)]
                if hints:
                    self.sm.hint(model, min(hints, key=lambda r: r["score"])["placements"])
                else:
                    model.clear_hints()
                stage, objective = "diversity", "base"
                if diversity_attempts % 3 != 2:
                    # 새 최고안 때문에 대안이 상한 밖으로 밀려도 작은 영역부터 빠르게 보충한다.
                    fraction = self.policy["neighborhoodFractions"][min(diversity_attempts // 3, len(self.policy["neighborhoodFractions"]) - 1)]
                    cursor = 3 + 4 * diversity_attempts
                    free = neighborhood(self.sm, best["placements"], self.evaluate(best), cursor, self.rng, fraction)
                    restrict_neighborhood(self.sm, model, best["placements"], free)
                    stage = "diversity_local"
                diversity_attempts += 1
            else:
                profile, kinds = profiles[step % len(profiles)]
                tried_profiles.add(profile)
                expression = sum(v * self.q["weights"][k] for k in kinds for v in self.sm.raw_terms[k])
                model.minimize(expression)
                stage, objective = "profile:" + profile, "profile"
            duration = self.policy["localDiversitySeconds"] if stage == "diversity_local" else self.policy["roundSeconds"]
            status = self.run(model, min(self.search_end, time.monotonic() + duration), stage, objective)
            if status == cp_model.INFEASIBLE and stage == "diversity":
                diversity_failed_for = anchors_key
            if diversity_failed_for == selection_key(self.best(), self.selected()) and len(tried_profiles) == len(profiles):
                break
            step += 1

    def finish(self):
        for record in self.pool.values():
            self.evaluate(record)
        chosen = self.selected()
        candidates = []
        for item in chosen:
            record = self.pool[tuple(sorted(item["_cells"].items()))]
            proof = record["proof"] or {"provenOptimal": self.proved_value == record["score"],
                    "lowerBound": self.bound, "absoluteGap": max(0, record["score"] - self.bound),
                    "scope": "original", "solverStatus": "OPTIMAL" if self.proved_value == record["score"] else "FEASIBLE"}
            candidates.append({"placements": record["placements"], "evaluation": record["evaluation"],
                               "hardValidation": record["hardValidation"], "optimality": proof,
                               "changedCells": record["changedCells"], "differentCells": {},
                               "_cells": record["_cells"]})
        for i, candidate in enumerate(candidates):
            candidate["differentCells"] = {str(j + 1): cell_distance(candidate["_cells"], other["_cells"])
                                           for j, other in enumerate(candidates) if j != i}
            candidate["strengths"] = [name for name, kinds in self.policy["profiles"].items()
                                      if sum(candidate["evaluation"]["breakdown"][k]["penalty"] for k in kinds)
                                      == min(sum(other["evaluation"]["breakdown"][k]["penalty"] for k in kinds) for other in candidates)]
        for candidate in candidates:
            candidate.pop("_cells")
        if len(candidates) < self.o["maxCandidates"]:
            self.notes.append("품질 상한과 실제 배치 차이를 함께 만족하는 후보를 요청 수만큼 확보하지 못했습니다. 조건은 완화하지 않았습니다.")
        return {"status": "feasible" if candidates else ("infeasible" if self.last_original_status == cp_model.INFEASIBLE else "unknown"),
                "candidates": candidates, "diagnostics": self.notes, "qualityPolicy": self.q,
                "modelNotes": deepcopy(self.p.get("metadata", {}).get("notes", [])),
                "changeOptimality": {"provenMinimumChanges": False, "bestChangedCells": None, "lowerBound": None},
                "search": {"elapsedSeconds": time.monotonic() - self.started, "strategy": "adaptive", "seed": self.o["seed"],
                           "workers": self.o["workers"], "requestedCandidates": self.o["maxCandidates"],
                           "minDifferentCells": self.o["minDifferentCells"], "qualityTolerance": self.o["qualityTolerance"],
                           "intermediateCandidates": len(self.pool), "stages": self.stages,
                           "operators": deepcopy(self.controller.stats),
                           "modelVariables": len(self.sm.m.proto.variables), "startVariables": len(self.sm.x)}}


def optimize(problem, options, started, progress=None):
    search = Search(problem, options, started, progress)
    search.quality_search()
    search.candidates_search()
    return search.finish()
