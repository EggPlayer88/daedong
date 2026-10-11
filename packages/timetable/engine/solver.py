"""원자적 블록의 CP-SAT 배정, 품질 최소화, 실제 배치가 다른 후보 생성."""

from collections import Counter, defaultdict
from copy import deepcopy
import math
import os
import time

from ortools.sat.python import cp_model

from .model import (InputError, fields, integer, refs, array, fail, normalize, check_fixed,
                    legal_start, inspect_schedule, expand_cells, available, hard_windows)
from .quality import read_quality, teacher_targets, morning_baselines, evaluate_quality


def positive_number(value, path):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and value > 0
    except OverflowError:
        valid = False
    if not valid:
        fail("INVALID_NUMBER", "유한한 양수가 필요합니다.", path)
    return value


def parse_options(problem, raw):
    fields(raw, {"timeLimitSeconds", "maxCandidates", "minDifferentCells", "qualityTolerance", "seed", "workers",
                 "previous", "locks", "changeMode", "quality"}, "options")
    o = deepcopy(raw)
    o["timeLimitSeconds"] = positive_number(o.get("timeLimitSeconds", 180), "options.timeLimitSeconds")
    o["maxCandidates"] = integer(o.get("maxCandidates", 3), "options.maxCandidates")
    if o["maxCandidates"] > 3:
        fail("TOO_MANY_CANDIDATES", "검토할 후보는 최대 3개입니다.")
    o["seed"] = integer(o.get("seed", 1), "options.seed", 0)
    o["workers"] = integer(o.get("workers", min(8, os.cpu_count() or 1)), "options.workers")
    if o["workers"] > 32 or o["seed"] > 2**31 - 1:
        fail("INVALID_SEARCH_PARAMETER", "workers는 32 이하, seed는 32비트 정수 범위여야 합니다.")
    tolerance = o.get("qualityTolerance", 0.05)
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not 0 <= tolerance <= 1:
        fail("INVALID_TOLERANCE", "후보 품질 허용 비율은 0~1이어야 합니다.")
    o["qualityTolerance"] = tolerance
    total = sum(l["hours"] for l in problem["lessons"])
    minimum = 0 if total == 0 else 1
    o["minDifferentCells"] = integer(o.get("minDifferentCells", max(minimum, math.ceil(total * 0.04))), "options.minDifferentCells", minimum)
    if o["minDifferentCells"] > total:
        fail("INVALID_DIVERSITY", "최소 배치 차이는 전체 수업 셀 수 이하여야 합니다.")
    if total == 0:
        o["maxCandidates"] = 1
    o["changeMode"] = o.get("changeMode", "minimize")
    if o["changeMode"] not in ["minimize", "quality"]:
        fail("INVALID_CHANGE_MODE", "changeMode는 minimize 또는 quality입니다.")
    previous = o.get("previous")
    o["previousCells"] = None
    if previous is not None:
        array(previous, "options.previous")
        seen = set()
        for r in previous:
            fields(r, {"unitId", "day", "start"}, "options.previous")
            uid = r.get("unitId")
            refs([uid], problem["unitMap"], "options.previous.unitId")
            if uid in seen:
                fail("DUPLICATE_PREVIOUS_UNIT", "기존 시간표 수업이 중복됐습니다.")
            seen.add(uid)
            start = integer(r.get("start"), "options.previous.start")
            day = r.get("day")
            if not isinstance(day, str) or day not in problem["dayMap"] or start + problem["unitMap"][uid]["length"] - 1 > problem["dayMap"][day]["periods"]:
                fail("INVALID_PREVIOUS_SLOT", "기존 시간표의 교시가 범위 밖입니다.")
        if seen != set(problem["unitMap"]):
            fail("INCOMPLETE_PREVIOUS", "기존 시간표는 모든 수업을 포함해야 합니다.")
        # 새 조건과는 충돌할 수 있지만, 기존 시간표 자체의 중복·빈칸은 거부한다.
        old = expand_cells(problem, previous)
        if len(old) != total or any(k in problem["reservationMap"] for k in old):
            fail("INVALID_PREVIOUS_COVERAGE", "기존 시간표에 중복/예약 침범이 있습니다.")
        old_teachers = Counter((t, d, p) for (_, d, p), (_, teachers) in old.items() for t in teachers)
        if any(n > 1 for n in old_teachers.values()):
            fail("INVALID_PREVIOUS_TEACHERS", "기존 시간표에서 교사가 중복됐습니다.")
        o["previousCells"] = old
    o["fixed"] = problem["fixed"] + array(o.get("locks", []), "options.locks")
    for f in o["fixed"]:
        check_fixed(problem, f, "options.locks")
    return o


class ScheduleModel:
    def __init__(self, problem, quality, options):
        self.p, self.q, self.o = problem, quality, options
        self.m = cp_model.CpModel()
        self.choices, self.x = {}, {}
        self.class_occ, self.teacher_occ, self.resource_occ = defaultdict(list), defaultdict(list), defaultdict(list)
        self.sessions, self.am = defaultdict(list), defaultdict(list)
        self.position, self.unit_day = {}, {}
        for u in problem["units"]:
            lesson = problem["lessonMap"][u["lessonId"]]
            choices = [(d["id"], p) for d in problem["days"] for p in range(1, d["periods"] + 1)
                       if legal_start(problem, u, d["id"], p, options["fixed"])]
            if not choices:
                fail("NO_LEGAL_PLACEMENT", f"{u['id']}: 모든 하드조건을 지키는 배정 위치가 없습니다.")
            self.choices[u["id"]] = choices
            flags, positions, days = [], [], []
            for d, start in choices:
                v = self.m.new_bool_var(f"x_{u['id']}_{d}_{start}")
                self.x[u["id"], d, start] = v
                flags.append(v)
                di = list(problem["dayMap"]).index(d)
                positions.append(v * (di * (max(x["periods"] for x in problem["days"]) + 1) + start))
                days.append(v * di)
                self.sessions[lesson["classId"], lesson["subjectId"], d].append(v)
                self.am[lesson["classId"], lesson["subjectId"]].append(v * sum(p <= problem["morningEnd"] for p in range(start, start + u["length"])))
                for p in range(start, start + u["length"]):
                    self.class_occ[lesson["classId"], d, p].append((v, lesson))
                    for t in lesson["teacherIds"]:
                        self.teacher_occ[t, d, p].append(v)
                    for r in lesson["resourceIds"]:
                        self.resource_occ[r, d, p].append(v)
            self.m.add_exactly_one(flags)
            self.position[u["id"]] = sum(positions)
            self.unit_day[u["id"]] = sum(days)
        # 같은 수업의 카드 번호만 바꾸는 대칭을 제거한다. 실제 배치는 보존한다.
        groups = defaultdict(list)
        for u in problem["units"]:
            groups[u["lessonId"], u["length"]].append(u["id"])
        for group in groups.values():
            for a, b in zip(group, group[1:]):
                self.m.add(self.position[a] < self.position[b])
        self.res_teacher, self.res_resource = Counter(), Counter()
        for r in problem["reservations"]:
            if not available(problem, problem["classMap"][r["classId"]].get("availability", {}), r["day"], r["period"]):
                fail("RESERVATION_UNAVAILABLE", f"예약 학급 {r['classId']}이 해당 시간에 참여할 수 없습니다.")
            for t in r["teacherIds"]:
                if not available(problem, problem["teacherMap"][t].get("availability", {}), r["day"], r["period"]):
                    fail("RESERVATION_UNAVAILABLE", f"예약에 참여하는 교사 {t}가 근무할 수 없습니다.")
                self.res_teacher[t, r["day"], r["period"]] += 1
            for rid in r["resourceIds"]:
                if not available(problem, problem["resourceMap"][rid].get("availability", {}), r["day"], r["period"]):
                    fail("RESERVATION_UNAVAILABLE", f"예약 자원 {rid}를 이용할 수 없습니다.")
                self.res_resource[rid, r["day"], r["period"]] += 1
        for c in problem["classMap"]:
            for d in problem["days"]:
                for p in range(1, d["periods"] + 1):
                    key = c, d["id"], p
                    flags = [v for v, _ in self.class_occ[key]]
                    self.m.add(sum(flags) == (0 if key in problem["reservationMap"] else 1))
        self.busy = {}
        for t in problem["teacherMap"]:
            for d in problem["days"]:
                for p in range(1, d["periods"] + 1):
                    k = t, d["id"], p
                    b = self.m.new_bool_var(f"busy_{t}_{d['id']}_{p}")
                    self.m.add(b == sum(self.teacher_occ[k]) + self.res_teacher[k])
                    self.busy[k] = b
        for r in problem["resources"]:
            for d in problem["days"]:
                for p in range(1, d["periods"] + 1):
                    k = r["id"], d["id"], p
                    self.m.add(sum(self.resource_occ[k]) + self.res_resource[k] <= r["capacity"])
        self.add_hard_constraints()
        self.baselines = morning_baselines(problem, self.choices)
        self.penalty = self.add_quality()
        self.changes = self.distance(options["previousCells"]) if options["previousCells"] is not None else None
        self.m.minimize(self.penalty)

    def add_hard_constraints(self):
        for h in self.p["hardConstraints"]:
            kind = h["type"]
            if kind in ["maxDailyLoad", "maxConsecutive"]:
                for d in self.p["days"]:
                    if kind == "maxDailyLoad":
                        self.m.add(sum(self.busy[h["teacherId"], d["id"], p] for p in range(1, d["periods"] + 1)) <= h["max"])
                    else:
                        for window in hard_windows(self.p, d["id"], h["max"] + 1, h["acrossBreak"]):
                            self.m.add(sum(self.busy[h["teacherId"], d["id"], p] for p in window) <= h["max"])
            if kind == "subjectDailyLimit":
                for d in self.p["days"]:
                    flags = [v for p in range(1, d["periods"] + 1) for v, l in self.class_occ[h["classId"], d["id"], p] if l["subjectId"] == h["subjectId"]]
                    self.m.add(sum(flags) <= h["max"])
            units = [u["id"] for u in self.p["units"] if u["lessonId"] in h.get("lessonIds", [])]
            if kind == "sameTime":
                for a, b in zip(units, units[1:]):
                    self.m.add(self.position[a] == self.position[b])
            if kind == "differentDays":
                days = []
                for u in units:
                    v = self.m.new_int_var(0, len(self.p["days"]) - 1, "hard_day")
                    self.m.add(v == self.unit_day[u])
                    days.append(v)
                self.m.add_all_different(days)

    def mapped_cost(self, expression, values, name):
        value = self.m.new_int_var(0, len(values) - 1, "value_" + name)
        self.m.add(value == expression)
        cost = self.m.new_int_var(min(values), max(values), "cost_" + name)
        self.m.add_element(value, values, cost)
        return cost

    def and_var(self, flags, name):
        v = self.m.new_bool_var(name)
        self.m.add_bool_and(flags).only_enforce_if(v)
        self.m.add_bool_or([f.Not() for f in flags]).only_enforce_if(v.Not())
        return v

    def active_var(self, expression, name):
        v = self.m.new_bool_var(name)
        self.m.add(expression >= 1).only_enforce_if(v)
        self.m.add(expression == 0).only_enforce_if(v.Not())
        return v

    def add_quality(self):
        raw = defaultdict(list)
        for (uid, day, start), flag in self.x.items():
            length = self.p["unitMap"][uid]["length"]
            crossings = sum(start <= b < start + length - 1 for b in set(self.p["dayMap"][day].get("breaksAfter", [])))
            if crossings:
                raw["blockBreakCrossing"].append(flag * crossings)
        groups = defaultdict(list)
        for u in self.p["units"]:
            l = self.p["lessonMap"][u["lessonId"]]
            groups[l["classId"], l["subjectId"]].append(u)
        for (c, s), units in groups.items():
            count = len(units)
            acts = []
            for d in self.p["days"]:
                expr = sum(self.sessions[c, s, d["id"]])
                raw["subjectDaily"].append(self.mapped_cost(expr, [i * (i - 1) // 2 for i in range(count + 1)], "subject_daily"))
                acts.append(self.active_var(expr, "subject_active"))
            raw["subjectAdjacency"] += [self.and_var([a, b], "subject_adjacent") for a, b in zip(acts, acts[1:])]
            hours = sum(u["length"] for u in units)
            absolute = self.m.new_int_var(0, hours, "morning_absolute")
            self.m.add_abs_equality(absolute, 2 * sum(self.am[c, s]) - hours)
            excess = self.m.new_int_var(0, hours, "morning_excess")
            self.m.add_max_equality(excess, [0, absolute - self.baselines[c, s]])
            raw["morningBalance"].append(excess)
        targets = teacher_targets(self.p)
        personal = []
        for t, teacher in self.p["teacherMap"].items():
            burdens = defaultdict(list)
            late = []
            for d in self.p["days"]:
                flags = [self.busy[t, d["id"], p] for p in range(1, d["periods"] + 1)]
                load = self.mapped_cost(sum(flags), [max(0, i - targets[t]["daily"]) ** 2 for i in range(d["periods"] + 1)], "daily_load")
                burdens["teacherDailyLoad"].append(load)
                for p in range(2, d["periods"]):
                    if available(self.p, teacher.get("availability", {}), d["id"], p):
                        before = self.active_var(sum(flags[:p-1]), "before_gap")
                        after = self.active_var(sum(flags[p:]), "after_gap")
                        burdens["teacherGaps"].append(self.and_var([before, after, flags[p-1].Not()], "gap"))
                for window in hard_windows(self.p, d["id"], self.q["preferredMaxConsecutive"] + 1, self.q["consecutiveAcrossBreak"]):
                    burdens["teacherConsecutive"].append(self.and_var([self.busy[t, d["id"], p] for p in window], "long_run"))
                late.append(flags[-1])
            burdens["lateSpread"].append(self.mapped_cost(sum(late), [max(0, i - targets[t]["late"]) ** 2 for i in range(len(late) + 1)], "late_spread"))
            personal.append(sum(v * self.q["weights"][k] for k, vs in burdens.items() for v in vs))
            for k, vs in burdens.items():
                raw[k] += vs
        # 상한은 입력 크기와 가중치에서 유도한다. 임의의 학교 시수 상한을 넣지 않는다.
        upper = sum(sum(d["periods"] ** 2 + d["periods"] for d in self.p["days"]) * w for w in self.q["weights"].values()) + len(self.p["days"]) ** 2 * sum(self.q["weights"].values())
        fairness = self.m.new_int_var(0, upper, "worst_teacher_burden")
        self.m.add_max_equality(fairness, personal or [0])
        raw["teacherFairness"].append(fairness)
        self.raw_terms = raw
        personal_upper = (sum(d["periods"] ** 2 for d in self.p["days"]) * self.q["weights"]["teacherDailyLoad"]
                          + sum(d["periods"] for d in self.p["days"]) * (self.q["weights"]["teacherGaps"] + self.q["weights"]["teacherConsecutive"])
                          + len(self.p["days"]) ** 2 * self.q["weights"]["lateSpread"])
        self.quality_upper = (sum(len(us) * (len(us) - 1) // 2 for us in groups.values()) * self.q["weights"]["subjectDaily"]
                              + len(groups) * max(0, len(self.p["days"]) - 1) * self.q["weights"]["subjectAdjacency"]
                              + sum(l["hours"] for l in self.p["lessons"]) * self.q["weights"]["morningBalance"]
                              + sum(u["length"] - 1 for u in self.p["units"]) * self.q["weights"]["blockBreakCrossing"]
                              + len(self.p["teachers"]) * personal_upper
                              + personal_upper * self.q["weights"]["teacherFairness"])
        if self.quality_upper >= 2**50:
            fail("OBJECTIVE_OVERFLOW", "평가표의 가중치/문제 크기가 솔버 정수 범위를 넘습니다.")
        return sum(v * self.q["weights"][k] for k, vs in raw.items() for v in vs)

    def distance(self, cells):
        matches = []
        for (c, d, p), (subject, teachers) in cells.items():
            matches += [v for v, l in self.class_occ[c, d, p] if l["subjectId"] == subject and tuple(sorted(l["teacherIds"])) == teachers]
        return len(cells) - sum(matches)

    def placements(self, solver):
        return [{"unitId": uid, "day": d, "start": p} for (uid, d, p), x in self.x.items() if solver.boolean_value(x)]


def cp_run(model, options, seconds, seed, progress=None, capture=None):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.001, seconds)
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = options["workers"]
    solver.parameters.relative_gap_limit = 0
    solver.parameters.absolute_gap_limit = 0
    class Callback(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            if progress:
                progress({"event": "incumbent", "objective": self.objective_value, "lowerBound": self.best_objective_bound})
            if capture:
                capture(self)
    status = solver.solve(model, Callback())
    return solver, status


def proven(solver, status):
    return status == cp_model.OPTIMAL and solver.objective_value - solver.best_objective_bound < 1 - 1e-6


def pick_diverse_candidates(candidates, minimum, maximum):
    """최고안을 보존하고, 후보 수를 최대화한 뒤 대안의 합산 패널티를 최소화한다."""
    ordered = sorted(candidates, key=lambda c: (c["evaluation"]["totalPenalty"], not c["optimality"]["provenOptimal"]))
    if maximum == 1:
        return ordered[:1]
    distances = {}
    def distance(i, j):
        key = min(i, j), max(i, j)
        if key not in distances:
            distances[key] = sum(ordered[i]["_cells"][k] != ordered[j]["_cells"][k] for k in ordered[i]["_cells"])
        return distances[key]
    alternatives = [i for i in range(1, len(ordered)) if distance(0, i) >= minimum]
    if maximum == 3:
        pairs = [(i, j) for n, i in enumerate(alternatives) for j in alternatives[n+1:] if distance(i, j) >= minimum]
        if pairs:
            def rank(pair):
                i, j = pair
                scores = [ordered[i]["evaluation"]["totalPenalty"], ordered[j]["evaluation"]["totalPenalty"]]
                return sum(scores), max(scores), -min(distance(0, i), distance(0, j), distance(i, j))
            i, j = min(pairs, key=rank)
            return [ordered[0], ordered[i], ordered[j]]
    return [ordered[0]] + ([ordered[alternatives[0]]] if alternatives else [])


def solve_timetable(raw, options=None, progress=None):
    """완전하고 검증된 후보만 반환한다. 99점 환산이나 최적성 증명을 만들어내지 않는다."""
    started = time.monotonic()
    try:
        opts_raw = options if options is not None else {}
        fields(opts_raw, {"timeLimitSeconds", "maxCandidates", "minDifferentCells", "qualityTolerance", "seed", "workers",
                          "previous", "locks", "changeMode", "quality"}, "options")
        quality = read_quality(opts_raw.get("quality"))
        problem = normalize(raw, quality)
        opts = parse_options(problem, opts_raw)
        sm = ScheduleModel(problem, quality, opts)
        remaining = lambda: opts["timeLimitSeconds"] - (time.monotonic() - started)
        candidates, notes = [], []
        change_proven, change_bound, change_best = False, None, None
        lex = sm.changes is not None and opts["changeMode"] == "minimize"
        multiplier = sm.quality_upper + 1
        if lex:
            if multiplier * len(opts["previousCells"]) + sm.quality_upper >= 2**50:
                fail("OBJECTIVE_OVERFLOW", "변경량 우선 목적함수가 최적성 하한의 안전한 정수 정밀도 범위를 넘습니다.")
            # 품질의 엄밀 상한보다 큰 계수이므로 1칸 덜 변경하는 것이 항상 우선이다.
            sm.m.minimize(sm.changes * multiplier + sm.penalty)
        fallback = None
        if opts.get("previous") is not None:
            old = inspect_schedule(problem, opts["previous"], opts["fixed"])
            for place in opts["previous"]:
                key = place["unitId"], place["day"], place["start"]
                if key in sm.x:
                    sm.m.add_hint(sm.x[key], 1)
            if old["valid"]:
                evaluation = evaluate_quality(problem, opts["previous"], quality, sm.baselines)
                # 유효한 기존 해보다 품질이 나쁜 해를 배제해 재최적화 탐색을 줄인다.
                sm.m.add(sm.penalty <= evaluation["totalPenalty"])
                fallback = {"placements": opts["previous"], "evaluation": evaluation, "hardValidation": old,
                    "optimality": {"provenOptimal": False, "lowerBound": 0, "absoluteGap": evaluation["totalPenalty"],
                                   "scope": "minimum_changes" if lex else "original", "solverStatus": "NOT_RUN"},
                    "differentCells": {}, "changedCells": 0, "_cells": opts["previousCells"]}
                if lex:
                    change_best, change_bound, change_proven = 0, 0, True
                    sm.m.add(sm.changes == 0)
        best_penalty = fallback["evaluation"]["totalPenalty"] if fallback is not None else None
        pool = {}
        last_status = None
        for index in range(opts["maxCandidates"]):
            if remaining() <= 0:
                notes.append("탐색 시간 예산이 끝났습니다.")
                break
            # 최고안 탐색에 시간을 더 주고 남은 시간을 대안 탐색에 배분한다.
            fraction = 1 if opts["maxCandidates"] == index + 1 else (0.60 if index == 0 else 0.5)
            def capture(solution):
                # 중간 유효 해도 대안으로 보존한다. 검증·평가는 탐색 뒤에 독립적으로 수행한다.
                places = sm.placements(solution)
                cells = expand_cells(problem, places)
                fingerprint = tuple(sorted(cells.items()))
                changed = sum(cells[k] != opts["previousCells"][k] for k in cells) if opts["previousCells"] is not None else None
                penalty = int(solution.value(sm.penalty))
                bound = solution.best_objective_bound
                if lex:
                    change_lower = max(0, math.ceil(bound - 1e-6) // multiplier)
                    bound = max(0, bound - multiplier * changed) if change_lower >= changed else 0
                record = {"placements": places, "reported": penalty, "changedCells": changed, "_cells": cells,
                          "scope": "original" if index == 0 and not lex else "diversity_and_change_constraints",
                          "lowerBound": bound}
                old_record = pool.get(fingerprint)
                if old_record is None or record["lowerBound"] > old_record["lowerBound"]:
                    pool[fingerprint] = record
                if len(pool) > 50:
                    worst = max(pool, key=lambda k: (pool[k]["changedCells"] if lex else 0, pool[k]["reported"]))
                    del pool[worst]
            solver, status = cp_run(sm.m, opts, remaining() * fraction, (opts["seed"] + index) % (2**31), progress, capture)
            last_status = status
            if status == cp_model.MODEL_INVALID:
                raise RuntimeError(sm.m.validate())
            if status not in [cp_model.FEASIBLE, cp_model.OPTIMAL]:
                if index:
                    notes.append("품질 허용 범위와 배치 다양성을 함께 충족하는 추가 후보를 찾지 못했습니다. 조건을 완화하지 않았습니다.")
                break
            placements = sm.placements(solver)
            validation = inspect_schedule(problem, placements, opts["fixed"])
            if not validation["valid"]:
                raise RuntimeError(f"솔버 결과 독립 검증 실패: {validation['errors']}")
            evaluation = evaluate_quality(problem, placements, quality, sm.baselines)
            reported = int(solver.value(sm.penalty))
            if evaluation["totalPenalty"] != reported:
                raise RuntimeError(f"품질 점수 불일치: 모델 {reported}, 독립 계산 {evaluation['totalPenalty']}")
            cells = expand_cells(problem, placements)
            distance = {str(i+1): sum(cells[k] != other["_cells"][k] for k in cells) for i, other in enumerate(candidates)}
            if any(n < opts["minDifferentCells"] for n in distance.values()):
                raise RuntimeError("후보의 실제 배치 다양성 검증에 실패했습니다.")
            changed = sum(cells[k] != opts["previousCells"][k] for k in cells) if opts["previousCells"] is not None else None
            lower_bound = solver.best_objective_bound
            if lex:
                bound = max(0, math.ceil(solver.best_objective_bound - 1e-6) // multiplier)
                if index == 0:
                    change_bound = bound
                    change_proven = change_proven or bound >= changed
                if change_best is None or changed < change_best:
                    change_best = changed
                    best_penalty = None
                sm.m.add(sm.changes <= change_best)
                lower_bound = max(0, solver.best_objective_bound - multiplier * changed) if bound >= changed else 0
            best_penalty = reported if best_penalty is None else min(best_penalty, reported)
            candidates.append({"placements": placements, "evaluation": evaluation, "hardValidation": validation,
                "optimality": {"provenOptimal": proven(solver, status), "lowerBound": lower_bound,
                    "absoluteGap": max(0, reported - lower_bound),
                    "scope": "original" if index == 0 and change_best is None else "diversity_and_change_constraints",
                    "solverStatus": solver.status_name(status)},
                "differentCells": distance, "changedCells": changed, "_cells": cells})
            sm.m.add(sm.distance(cells) >= opts["minDifferentCells"])
            if not lex or change_proven:
                sm.m.add(sm.penalty <= best_penalty + math.floor(best_penalty * opts["qualityTolerance"]))
            sm.m.clear_hints()
            # 이미 찾은 중간 해가 새 다양성 조건을 만족하면 그 유효 배치를 다음 탐색의 힌트로 쓴다.
            hint_options = [r for r in pool.values()
                            if (not lex or r["changedCells"] <= change_best)
                            and ((lex and not change_proven) or r["reported"] <= best_penalty + math.floor(best_penalty * opts["qualityTolerance"]))
                            and all(sum(r["_cells"][k] != c["_cells"][k] for k in r["_cells"]) >= opts["minDifferentCells"] for c in candidates)]
            hint = min(hint_options, key=lambda r: r["reported"])["placements"] if hint_options else placements
            hint_keys = {(p["unitId"], p["day"], p["start"]) for p in hint}
            for key, x in sm.x.items():
                sm.m.add_hint(x, int(key in hint_keys))
        for record in pool.values():
            validation = inspect_schedule(problem, record["placements"], opts["fixed"])
            if not validation["valid"]:
                raise RuntimeError(f"중간 후보 독립 검증 실패: {validation['errors']}")
            evaluation = evaluate_quality(problem, record["placements"], quality, sm.baselines)
            if evaluation["totalPenalty"] != record["reported"]:
                raise RuntimeError("중간 후보의 품질 점수가 일치하지 않습니다.")
            candidates.append({"placements": record["placements"], "evaluation": evaluation, "hardValidation": validation,
                               "changedCells": record["changedCells"], "_cells": record["_cells"], "differentCells": {},
                               "optimality": {"provenOptimal": False, "lowerBound": record["lowerBound"],
                                   "absoluteGap": max(0, record["reported"] - record["lowerBound"]),
                                   "scope": record["scope"], "solverStatus": "INTERMEDIATE_FEASIBLE"}})
        if fallback is not None:
            if not candidates:
                notes.append("탐색이 종료되어 독립 검증을 통과한 기존 시간표를 보존했습니다.")
            candidates.append(fallback)
        if candidates:
            # 대안 탐색이 기준안보다 좋아질 수도 있다. 최종 최고 품질 기준으로 재선별한다.
            if lex:
                change_best = min(c["changedCells"] for c in candidates)
            eligible = [c for c in candidates if not lex or c["changedCells"] == change_best]
            best_penalty = min(c["evaluation"]["totalPenalty"] for c in eligible)
            ceiling = best_penalty + math.floor(best_penalty * opts["qualityTolerance"])
            accepted = [c for c in eligible if c["evaluation"]["totalPenalty"] <= ceiling]
            retained = pick_diverse_candidates(accepted, opts["minDifferentCells"], opts["maxCandidates"])
            if len(accepted) < len(eligible):
                notes.append("더 좋은 안이 발견되어 최종 최고안의 품질 허용 범위를 넘은 후보를 제외했습니다.")
            candidates = sorted(retained, key=lambda c: c["evaluation"]["totalPenalty"])
            for i, c in enumerate(candidates):
                c["differentCells"] = {str(j+1): sum(c["_cells"][k] != other["_cells"][k] for k in c["_cells"])
                                       for j, other in enumerate(candidates) if j != i}
            for c in candidates:
                c.pop("_cells")
        # 부분 수정의 변경량 최적성은 품질 최적성과 따로 보고한다.
        return {"status": "feasible" if candidates else ("infeasible" if last_status == cp_model.INFEASIBLE else "unknown"),
                "candidates": candidates, "diagnostics": notes, "qualityPolicy": quality,
                "modelNotes": deepcopy(problem.get("metadata", {}).get("notes", [])),
                "changeOptimality": {"provenMinimumChanges": change_proven, "bestChangedCells": change_best, "lowerBound": change_bound},
                "search": {"elapsedSeconds": time.monotonic() - started, "seed": opts["seed"], "workers": opts["workers"],
                           "requestedCandidates": opts["maxCandidates"], "minDifferentCells": opts["minDifferentCells"],
                           "intermediateCandidates": len(pool),
                           "qualityTolerance": opts["qualityTolerance"]}}
    except InputError as exc:
        infeasible = exc.issue["code"] in ["NO_LEGAL_PLACEMENT", "RESERVATION_UNAVAILABLE"]
        return {"status": "infeasible" if infeasible else "invalid_input", "candidates": [], "diagnostics": [exc.issue]}
