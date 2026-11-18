"""하드모델을 보존하는 품질 우선 탐색과 실제 점유가 다른 우수안 수집."""
from collections import Counter, defaultdict
from bisect import bisect_right
from itertools import combinations
import math
import random
import time

from ortools.sat.python import cp_model as cp
import balanced_quality as quality


def daily_upper(intervals):
    """한 교사가 겹치지 않게 점유할 수 있는 시수의 안전한 상한. 활동 수 제한은 생략한다."""
    ordered = sorted((b, a, periods) for (a, b), periods in intervals.items())
    ends, best = [], [0]
    for end, start, periods in ordered:
        best.append(max(best[-1], best[bisect_right(ends, start)] + periods))
        ends.append(end)
    return best[-1]


class Model:
    def __init__(self, basis, options, deadline):
        self.b, self.o = basis, options
        self.m = cp.CpModel()
        self.context = quality.context(basis)
        self.bounds = quality.bounds(basis)
        self.slots = {s['id']: s for s in basis['slots']}
        self.resources = {r['id']: r for r in basis['resources']}
        fixed = {f['lessonId']: f['slotId'] for f in basis['fixed']}
        preferences = defaultdict(dict)
        for row in basis['preferences']:
            preferences[row['lessonId']][row['slotId']] = row['weight']
        groups = {}
        for lesson in sorted(basis['lessons'], key=lambda l: l['id']):
            if time.monotonic() >= deadline:
                raise TimeoutError()
            domain = tuple(sorted(s['id'] for s in quality.legal_slots(basis, lesson) if fixed.get(lesson['id'], s['id']) == s['id']))
            # 내용뿐 아니라 허용 범위·고정·개별 선호까지 같은 활동만 묶는다.
            signature = (lesson['courseId'], lesson['periods'], tuple(sorted(lesson['resourceIds'])), domain, tuple(sorted(preferences[lesson['id']].items())))
            groups.setdefault(signature, []).append(lesson)
        self.groups = list(groups.values())
        self.x, self.by_lesson, self.cell_terms = {}, {}, defaultdict(list)
        intervals, teacher_days, teacher_times, course_days = defaultdict(list), defaultdict(list), defaultdict(lambda: defaultdict(list)), defaultdict(list)
        teacher_intervals = defaultdict(dict)
        self.terms = {k: [] for k in quality.POLICY['weights']}
        for gid, (signature, members) in enumerate(groups.items()):
            lesson, domain = members[0], signature[3]
            for member in members:
                self.by_lesson[member['id']] = gid
            variables = []
            for sid in domain:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                s = self.slots[sid]
                var = self.m.new_bool_var(f'x:{gid}:{sid}')
                self.x[gid, sid] = var; variables.append(var)
                span = self.m.new_optional_fixed_size_interval_var(s['day'] * 1440 + s['startMinute'], s['endMinute'] - s['startMinute'], var, '')
                for rid in lesson['resourceIds']:
                    intervals[rid].append(span)
                    if self.resources[rid]['kind'] == 'teacher':
                        teacher_days[rid, s['day']].append(lesson['periods'] * var)
                        teacher_times[rid, s['day']][s['startMinute'], s['endMinute']].append(var)
                        span_key = (s['startMinute'], s['endMinute'])
                        teacher_intervals[rid, s['day']][span_key] = max(lesson['periods'], teacher_intervals[rid, s['day']].get(span_key, 0))
                course_days[quality.course_key(basis, lesson), s['day']].append(var)
                self.terms['preferencePenalty'].append(preferences[lesson['id']].get(sid, 0) * var)
                for cell in quality.slot_cells(lesson, s, self.bounds):
                    self.cell_terms[cell].append(var)
            self.m.add(sum(variables) == len(members))
        for rid, spans in intervals.items():
            self.m.add_cumulative(spans, [1] * len(spans), self.resources[rid]['capacity'])
        total = sum(l['periods'] for l in basis['lessons'])
        course_counts = Counter(quality.course_key(basis, lesson) for lesson in basis['lessons'])
        burdens = defaultdict(list)
        for (rid, day), terms in teacher_days.items():
            maximum = min(daily_upper(teacher_intervals[rid, day]), sum(l['periods'] for l in basis['lessons'] if rid in l['resourceIds']))
            load = sum(terms); target = self.context[1][rid]
            cost = self.m.new_int_var(0, maximum ** 2, '')
            self.m.add_max_equality(cost, [0] + [(2 * k - 1) * (load - target) - k * (k - 1) for k in range(1, max(0, maximum - target) + 1)])
            burdens[rid].append(cost); self.terms['teacherDailyExcess'].append(cost)
            calendar = self.context[0][rid, day]
            length = sum(b - a for a, b in calendar)
            starts, ends, occupied = [], [], []
            for (a, b), present in teacher_times[rid, day].items():
                used = self.m.new_bool_var('')
                self.m.add(used == sum(present))
                start, end = quality.rank(calendar, a), quality.rank(calendar, b)
                starts.append(start * used + length * (1 - used)); ends.append(end * used)
                occupied.append((b - a) * used)
            first, last = self.m.new_int_var(0, length, ''), self.m.new_int_var(0, length, '')
            self.m.add_min_equality(first, starts); self.m.add_max_equality(last, ends)
            gap = self.m.new_int_var(0, length, '')
            self.m.add_max_equality(gap, [0, last - first - sum(occupied)])
            self.terms['teacherGapMinutes'].append(gap)
        worst = self.m.new_int_var(0, total ** 2, '')
        self.m.add_max_equality(worst, [sum(values) for values in burdens.values()] or [0])
        self.terms['teacherWorstExcess'].append(worst)
        active = {}
        for (course, day), terms in course_days.items():
            n = sum(terms)
            maximum = course_counts[course]
            cost = self.m.new_int_var(0, maximum * (maximum - 1) // 2, '')
            self.m.add_max_equality(cost, [0] + [k * n - k * (k + 1) // 2 for k in range(1, maximum)])
            self.terms['courseDailyPairs'].append(cost)
            flag = self.m.new_bool_var('')
            self.m.add(n >= 1).only_enforce_if(flag); self.m.add(n == 0).only_enforce_if(flag.Not())
            active[course, day] = flag
        for (course, day), flag in active.items():
            other = active.get((course, day + 1))
            if other is not None:
                both = self.m.new_bool_var('')
                self.m.add_min_equality(both, [flag, other]); self.terms['courseAdjacency'].append(both)
        self.penalty = sum(quality.enabled_weights(options)[k] * sum(terms) for k, terms in self.terms.items())
        self.m.minimize(self.penalty)

    def placements(self, solver):
        selected = defaultdict(list)
        for (gid, sid), var in self.x.items():
            if solver.boolean_value(var):
                selected[gid].append(sid)
        return [dict(lessonId=l['id'], slotId=sid) for gid, members in enumerate(self.groups) for l, sid in zip(members, sorted(selected[gid]))]

    def selection(self, places):
        return {(self.by_lesson[p['lessonId']], p['slotId']) for p in places}

    def hint(self, model, places):
        model.clear_hints()
        chosen = self.selection(places)
        for key, var in self.x.items():
            model.add_hint(var, int(key in chosen))

    def distance(self, model, anchor, minimum):
        # 실제 점유의 빠진 분과 새로 생긴 분을 모두 검사한다. 슬롯 별칭·카드 순열은 0이다.
        lost = sum((cell[2] - cell[1]) * (1 - sum(self.cell_terms.get(cell, []))) for cell in anchor)
        added = sum((cell[2] - cell[1]) * sum(terms) for cell, terms in self.cell_terms.items() if cell not in anchor)
        distance = model.new_int_var(0, sum(max(self.slots[s]['endMinute'] - self.slots[s]['startMinute'] for s in l['allowedSlotIds']) for l in self.b['lessons']), '')
        model.add_max_equality(distance, [lost, added]); model.add(distance >= minimum)


class Search:
    def __init__(self, request, result, started, validate, objective):
        self.r, self.b, self.o, self.result = request, request['basis'], request['options'], result
        self.validate, self.objective = validate, objective
        self.started = started
        self.deadline = started + self.o['maxSeconds'] - min(quality.POLICY['verificationReserveSeconds'], self.o['maxSeconds'] * quality.POLICY['verificationReserveFraction'])
        self.pool, self.protected = {}, set()
        self.rng = random.Random(self.o['seed'])
        self.model, self.prepared = None, None
        self.rounds = 0
        self.stats = {k: dict(calls=0, gain=0., seconds=0., last=-1) for k in ('class', 'days', 'teacher', 'cross')}

    def keep(self, places, expected=None):
        self.validate(self.b, places)
        assessment = quality.evaluate(self.b, places, self.o, self.prepared)
        if expected is not None and assessment['totalPenalty'] != expected:
            raise RuntimeError('품질 목적함수와 독립 평가가 다릅니다.')
        cells = quality.cells(self.b, places, self.model.bounds if self.model else None)
        old = self.pool.get(cells)
        if old is None or assessment['totalPenalty'] < old['quality']['totalPenalty']:
            self.pool[cells] = dict(placements=places, quality=assessment, cells=cells)
        if len(self.pool) > quality.POLICY['poolCapacity']:
            best = self.best()
            eligible = [c for c in self.pool if c != best['cells'] and c not in self.protected]
            if not eligible:
                eligible = [c for c in self.pool if c != best['cells']]
            del self.pool[max(eligible, key=lambda c: self.pool[c]['quality']['totalPenalty'])]

    def best(self):
        return min(self.pool.values(), key=lambda p: p['quality']['totalPenalty']) if self.pool else None

    def chosen(self):
        best = self.best()
        if best is None:
            return []
        if self.o['maxCandidates'] == 1:
            return [best]
        limit = quality.ceiling(best['quality']['totalPenalty'])
        minimum = quality.required_difference(best['cells'])
        others = sorted([p for p in self.pool.values() if p is not best and p['quality']['totalPenalty'] <= limit and quality.difference(p['cells'], best['cells']) >= minimum], key=lambda p: p['quality']['totalPenalty'])
        if self.o['maxCandidates'] >= 3:
            for a, b in combinations(others, 2):
                if quality.difference(a['cells'], b['cells']) >= minimum:
                    return [best, a, b]
        return [best, *others[:1]]

    def run(self, model, until):
        remaining = min(self.deadline, until) - time.monotonic()
        if remaining <= 0:
            self.result['stats']['stoppedByLimit'] = True
            return None
        owner = self
        class Capture(cp.CpSolverSolutionCallback):
            def on_solution_callback(self):
                owner.keep(owner.model.placements(self), int(self.value(owner.model.penalty)))
        solver = cp.CpSolver()
        solver.parameters.max_time_in_seconds = remaining
        solver.parameters.num_search_workers = quality.POLICY['workers']
        solver.parameters.random_seed = (self.o['seed'] + self.rounds * 104729) % 2147483647
        self.rounds += 1
        status = solver.solve(model, Capture())
        self.result['stats']['branches'] += solver.num_branches
        if status == cp.MODEL_INVALID:
            raise RuntimeError(model.validate())
        if status in (cp.OPTIMAL, cp.FEASIBLE):
            self.keep(self.model.placements(solver), int(solver.value(self.model.penalty)))
        self.protected = {p['cells'] for p in self.chosen()}
        return status

    def bounded(self, ceiling=None):
        model = self.model.m.clone()
        best = self.best()
        if best:
            model.add(self.model.penalty <= (best['quality']['totalPenalty'] if ceiling is None else ceiling))
            self.model.hint(model, best['placements'])
        return model

    def neighborhood(self, model, action, visit):
        best = self.best()
        lessons = {l['id']: l for l in self.b['lessons']}
        classes = [r['id'] for r in self.b['resources'] if r['kind'] in ('class', 'student_group')]
        days = sorted({s['day'] for s in self.b['slots']})
        selected_days = set(self.rng.sample(days, min(2, len(days))))
        selected_classes = set(self.rng.sample(classes, min(len(classes), max(1, math.ceil(len(classes) * (.3 if visit % 3 else .5))))))
        if action == 'teacher':
            teachers = sorted({r['id'] for r in self.b['resources'] if r['kind'] == 'teacher'})
            teacher = teachers[visit % len(teachers)]
            selected_classes = {r for l in self.b['lessons'] if teacher in l['resourceIds'] for r in l['resourceIds'] if r in classes}
        frozen = set()
        for p in best['placements']:
            lesson, slot = lessons[p['lessonId']], self.model.slots[p['slotId']]
            class_match, day_match = bool(set(lesson['resourceIds']) & selected_classes), slot['day'] in selected_days
            free = day_match if action == 'days' else class_match and day_match if action == 'cross' else class_match
            if not free:
                frozen.add((self.model.by_lesson[p['lessonId']], p['slotId']))
        for key in frozen:
            model.add(self.model.x[key] == 1)

    def optimize(self):
        previous = self.r['previous']
        if previous:
            # 새 조건에서도 유효한 이전 안만 모델 작성 이전부터 보존한다.
            try:
                self.validate(self.b, previous['placements'])
            except Exception as error:
                if not hasattr(error, 'issue'):
                    raise
            else:
                self.keep(previous['placements'])
        try:
            self.model = Model(self.b, self.o, self.deadline)
        except TimeoutError:
            self.result['stats']['stoppedByLimit'] = True
            return self.finish()
        self.prepared = self.model.context
        fraction = quality.POLICY['warmInitialFraction'] if self.pool else quality.POLICY['initialFraction']
        status = self.run(self.bounded(), self.started + self.o['maxSeconds'] * fraction)
        if not self.pool and status != cp.INFEASIBLE:
            status = self.run(self.bounded(), self.deadline)
        if not self.pool:
            return self.finish(infeasible=status == cp.INFEASIBLE)
        turn = 0
        proved = status == cp.OPTIMAL
        while not proved and time.monotonic() < self.deadline - (self.o['maxSeconds'] * quality.POLICY['candidateReserveFraction'] if self.o['maxCandidates'] > 1 else 0):
            until = self.deadline - (self.o['maxSeconds'] * quality.POLICY['candidateReserveFraction'] if self.o['maxCandidates'] > 1 else 0)
            untried = [k for k, v in self.stats.items() if not v['calls']]
            action = untried[0] if untried else min(self.stats, key=lambda k: self.stats[k]['last']) if turn % 4 == 0 else max(self.stats, key=lambda k: self.stats[k]['gain'] / max(.01, self.stats[k]['seconds']))
            model = self.bounded()
            restart = turn > 0 and turn % quality.POLICY['restartEvery'] == 0
            if not restart:
                self.neighborhood(model, action, self.stats[action]['calls'])
            before, at = self.best()['quality']['totalPenalty'], time.monotonic()
            status = self.run(model, min(until, at + quality.POLICY['roundSeconds']))
            if status is None:
                break
            if restart and status == cp.OPTIMAL:
                proved = True
            row = self.stats[action]
            row.update(calls=row['calls'] + 1, gain=.7 * max(0, before - self.best()['quality']['totalPenalty']) + .3 * row['gain'], seconds=.7 * (time.monotonic() - at) + .3 * row['seconds'], last=turn)
            turn += 1
        attempts = 0
        while self.o['maxCandidates'] > 1 and time.monotonic() < self.deadline:
            chosen, best = self.chosen(), self.best()
            if len(chosen) == self.o['maxCandidates'] and best['quality']['totalPenalty'] == 0:
                break
            model = self.bounded(quality.ceiling(best['quality']['totalPenalty']))
            if len(chosen) < self.o['maxCandidates']:
                for candidate in chosen:
                    self.model.distance(model, candidate['cells'], quality.required_difference(best['cells']))
                model.clear_hints()
                if attempts % 3 != 2:
                    self.neighborhood(model, 'cross', attempts)
            else:
                # 서로 다른 장점의 대안을 상한 안에서 탐색한다. 원래 종합 점수로만 보관한다.
                kinds = [('teacherGapMinutes',), ('teacherDailyExcess', 'teacherWorstExcess'), ('courseDailyPairs', 'courseAdjacency')][attempts % 3]
                model.minimize(sum(quality.enabled_weights(self.o)[k] * sum(self.model.terms[k]) for k in kinds))
            status = self.run(model, min(self.deadline, time.monotonic() + quality.POLICY['roundSeconds']))
            if status is None:
                break
            if status == cp.INFEASIBLE and len(chosen) < self.o['maxCandidates'] and attempts % 3 == 2:
                break
            attempts += 1
        return self.finish()

    def finish(self, infeasible=False):
        if time.monotonic() >= self.deadline:
            self.result['stats']['stoppedByLimit'] = True
        chosen = self.chosen()
        for record in chosen:
            self.validate(self.b, record['placements'])
            self.result['candidates'].append(dict(placements=record['placements'], objective=self.objective(self.b, record['placements'], self.r['previous']), optimal=False, quality=record['quality']))
        if chosen:
            self.result['status'] = 'feasible'
        else:
            self.result['status'] = 'infeasible' if infeasible else 'unknown'
            self.result['stats']['stoppedByLimit'] = not infeasible
            self.result['issues'] = [dict(code='NO_SOLUTION' if infeasible else 'SEARCH_LIMIT', message='명시된 필수조건을 함께 만족하는 배치가 없습니다.' if infeasible else '제한 안에 유효안을 찾지 못했습니다. 불가능 판정이 아닙니다.', path='basis' if infeasible else 'options')]
        return self.result


def optimize(request, result, started, validate, objective):
    return Search(request, result, started, validate, objective).optimize()
