"""품질 모델을 솔버·운영 평가기와 독립인 분 단위 완전열거로 대조한다."""

from collections import Counter, defaultdict
from copy import deepcopy
from itertools import product
from pathlib import Path
import json
import math
import random
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packages/timetable/engine'))
from ortools.sat.python import cp_model as cp
from balanced_engine import Model, daily_upper
import balanced_quality
from runner import validate_basis

POLICY = json.loads((ROOT / 'packages/timetable/_assets/balanced-policy.json').read_text(encoding='utf-8'))
OPTIONS = dict(improveTeacherBalance=True, spreadCourses=True)
checks = 0
enumerated = 0


def reference(basis, places, options=OPTIONS):
    """검사기·품질기의 도메인/합집합/점유 헬퍼를 재사용하지 않는 오라클."""
    lessons = {l['id']: l for l in basis['lessons']}
    slots = {s['id']: s for s in basis['slots']}
    resources = {r['id']: r for r in basis['resources']}
    if len(places) != len(lessons) or {p['lessonId'] for p in places} != set(lessons):
        return None
    assigned = {p['lessonId']: slots[p['slotId']] for p in places}
    fixed = {p['lessonId']: p['slotId'] for p in basis['fixed']}
    occupancy = Counter()
    for p in places:
        lesson, slot = lessons[p['lessonId']], assigned[p['lessonId']]
        if p['slotId'] not in lesson['allowedSlotIds'] or fixed.get(lesson['id'], p['slotId']) != p['slotId'] or slot['periods'] != lesson['periods']:
            return None
        for rid in lesson['resourceIds']:
            for minute in range(slot['startMinute'], slot['endMinute']):
                if any(u['resourceId'] == rid and u['day'] == slot['day'] and u['startMinute'] <= minute < u['endMinute'] for u in basis['unavailable']):
                    return None
                occupancy[rid, slot['day'], minute] += 1
                if occupancy[rid, slot['day'], minute] > resources[rid]['capacity']:
                    return None

    teachers = {r['id'] for r in basis['resources'] if r['kind'] == 'teacher'}
    allowed_minutes, totals = defaultdict(set), Counter()
    for lesson in basis['lessons']:
        for rid in teachers.intersection(lesson['resourceIds']):
            totals[rid] += lesson['periods']
            for sid in lesson['allowedSlotIds']:
                slot = slots[sid]
                if any(u['resourceId'] in lesson['resourceIds'] and u['day'] == slot['day'] and max(u['startMinute'], slot['startMinute']) < min(u['endMinute'], slot['endMinute']) for u in basis['unavailable']):
                    continue
                allowed_minutes[rid, slot['day']].update(range(slot['startMinute'], slot['endMinute']))
    target = {rid: math.ceil(total / max(1, len({day for teacher, day in allowed_minutes if teacher == rid}))) for rid, total in totals.items()}
    courses, loads, teacher_minutes = Counter(), Counter(), defaultdict(set)
    preferences = {(p['lessonId'], p['slotId']): p['weight'] for p in basis['preferences']}
    raw = dict(preferencePenalty=0, teacherDailyExcess=0, teacherWorstExcess=0, courseDailyPairs=0, courseAdjacency=0, teacherGapMinutes=0)
    for p in places:
        lesson, slot = lessons[p['lessonId']], assigned[p['lessonId']]
        audience = tuple(sorted(r for r in lesson['resourceIds'] if resources[r]['kind'] in ('class', 'student_group')))
        courses[lesson['courseId'], audience, slot['day']] += 1
        raw['preferencePenalty'] += preferences.get((lesson['id'], p['slotId']), 0)
        for rid in teachers.intersection(lesson['resourceIds']):
            loads[rid, slot['day']] += lesson['periods']
            teacher_minutes[rid, slot['day']].update(range(slot['startMinute'], slot['endMinute']))
    burdens = Counter()
    for (rid, day), periods in loads.items():
        excess = max(0, periods - target[rid]) ** 2
        burdens[rid] += excess
        raw['teacherDailyExcess'] += excess
        actual = teacher_minutes[rid, day]
        raw['teacherGapMinutes'] += len({minute for minute in allowed_minutes[rid, day] if min(actual) <= minute <= max(actual)} - actual)
    raw['teacherWorstExcess'] = max(burdens.values(), default=0)
    raw['courseDailyPairs'] = sum(n * (n - 1) // 2 for n in courses.values())
    raw['courseAdjacency'] = sum((course, audience, day + 1) in courses for course, audience, day in courses)
    total = 0
    for metric, weight in POLICY['weights'].items():
        enabled = options.get('improveTeacherBalance', True) if metric.startswith('teacher') else options.get('spreadCourses', True) if metric.startswith('course') else True
        total += raw[metric] * (weight if enabled else 0)
    return dict(totalPenalty=total, **raw)


def assignments(basis):
    for slots in product(*(l['allowedSlotIds'] for l in basis['lessons'])):
        yield [dict(lessonId=l['id'], slotId=sid) for l, sid in zip(basis['lessons'], slots)]


def solve(model):
    solver = cp.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 281118
    solver.parameters.max_time_in_seconds = 3
    return solver, solver.solve(model)


def check_terms(sm, solver, expected, label):
    actual = {metric: sum(int(solver.value(term)) for term in terms) for metric, terms in sm.terms.items()}
    assert actual == {k: expected[k] for k in POLICY['weights']}, (label, '항목별 원시 비용', actual, expected)
    assert int(solver.value(sm.penalty)) == expected['totalPenalty'], (label, '가중 합계', expected)


def fixture(slots=None):
    slots = slots or [dict(id='s0', day=1, label='월1', startMinute=0, endMinute=4, periods=1),
                      dict(id='s1', day=1, label='월2', startMinute=5, endMinute=9, periods=1),
                      dict(id='s2', day=2, label='화1', startMinute=0, endMinute=4, periods=1)]
    return dict(schemaVersion=1, id='audit', revision=1, schoolId='school', termId='term', sourceFingerprint='a' * 64,
                schoolLevel='middle', unsupportedFeatures=[], slots=slots,
                resources=[dict(id='t0', kind='teacher', label='교사0', capacity=1), dict(id='c0', kind='class', label='학급0', capacity=1)],
                lessons=[dict(id=lid, courseId='course', label='수업', periods=1, resourceIds=['t0', 'c0'], allowedSlotIds=[s['id'] for s in slots]) for lid in ('a', 'b')],
                courseLoads=[dict(courseId='course', periods=2)], fixed=[], unavailable=[], preferences=[])


def randomized_case(index, rng):
    b = fixture()
    for i in (1, 2):
        b['resources'].extend([dict(id=f't{i}', kind='teacher', label=f'교사{i}', capacity=1), dict(id=f'c{i}', kind='class', label=f'학급{i}', capacity=1)])
    b['resources'].extend([dict(id='g', kind='student_group', label='수강 교집합', capacity=1), dict(id='room', kind='room', label='공간', capacity=1 + index % 2)])
    b['slots'] = [dict(id=f's{i}', day=1 + rng.randrange(2), label=f'시간{i}', startMinute=i * 4, endMinute=i * 4 + 3 + rng.randrange(3), periods=1) for i in range(4)]
    if index % 3 == 0:
        b['slots'][3] = {**b['slots'][0], 'id': 's3', 'label': '동일 시각 별칭'}
    block = index % 4 == 0
    if block:
        b['slots'].extend([dict(id='block0', day=1, label='월 블록', startMinute=0, endMinute=10, periods=2), dict(id='block1', day=2, label='화 블록', startMinute=5, endMinute=17, periods=2)])
    b['lessons'] = []
    for i in range(4 if index % 6 == 0 else 3):
        ids = [f't{rng.randrange(2)}', f'c{rng.randrange(2)}', 'room']
        if index % 5 == 0 and i == 0:
            ids.append('t2')
        if index % 3 == 0 and i < 2:
            ids.append('g')
        allowed = ['block0', 'block1'] if block and i == 0 else [f's{k}' for k in range(4) if k == 0 or rng.randrange(2)]
        b['lessons'].append(dict(id=f'l{i}', courseId='course' if i < 2 else f'course{i}', label=f'수업{i}', periods=2 if block and i == 0 else 1, resourceIds=ids, allowedSlotIds=allowed))
    if index % 7 == 0 and not block:
        for lesson in b['lessons']:
            lesson['resourceIds'] = ['t0', 'c0', 'room']
            lesson['allowedSlotIds'] = ['s0']
    totals = Counter()
    for lesson in b['lessons']:
        totals[lesson['courseId']] += lesson['periods']
        for sid in lesson['allowedSlotIds']:
            b['preferences'].append(dict(lessonId=lesson['id'], slotId=sid, weight=rng.randrange(4)))
    b['courseLoads'] = [dict(courseId=k, periods=n) for k, n in totals.items()]
    if index % 2 == 0:
        first = b['lessons'][0]
        b['fixed'] = [dict(lessonId=first['id'], slotId=first['allowedSlotIds'][0])]
    if index % 4 == 1:
        b['unavailable'] = [dict(resourceId='t0', day=1, startMinute=4, endMinute=9)]
    return b


# 일일 시수 상한이 낮게 계산되면 합법 배치를 잘라내므로 모든 구간 부분집합과 대조한다.
upper_rng = random.Random(181126)
upper_cases = [{}, {(0, 4): 1, (4, 8): 1, (0, 8): 3}, {(0, 8): 1, (2, 8): 4, (8, 12): 2},
               {(0, 12): 2, (0, 4): 1, (4, 8): 1, (8, 12): 1}]
for _ in range(20):
    intervals = {}
    for _ in range(8):
        start = upper_rng.randrange(12)
        interval = start, start + 1 + upper_rng.randrange(6)
        intervals[interval] = max(intervals.get(interval, 0), 1 + upper_rng.randrange(4))
    upper_cases.append(intervals)
for intervals in upper_cases:
    expected = 0
    rows = list(intervals.items())
    for bits in product((0, 1), repeat=len(rows)):
        selected = [(span, periods) for (span, periods), chosen in zip(rows, bits) if chosen]
        if all(a[1] <= b[0] or b[1] <= a[0] for i, (a, _) in enumerate(selected) for b, _ in selected[i + 1:]):
            expected = max(expected, sum(periods for _, periods in selected))
    assert daily_upper(intervals) == expected, ('일일 시수 상한', intervals, expected)
checks += 1
print('  ✓ 가중 구간 일일 시수 상한: 경계·중첩·동일 종료·24개 구간 집합의 독립 부분집합 대조')

rng = random.Random(271118)
feasible_cases = infeasible_cases = 0
for index in range(24):
    b = randomized_case(index, rng)
    options = dict(improveTeacherBalance=index % 5 != 1, spreadCourses=index % 5 != 2)
    validate_basis(b)
    feasible = []
    for places in assignments(b):
        enumerated += 1
        expected = reference(b, places, options)
        if expected is not None:
            feasible.append((expected['totalPenalty'], places))
    sm = Model(b, options, time.monotonic() + 10)
    solver, status = solve(sm.m)
    if not feasible:
        infeasible_cases += 1
        assert status == cp.INFEASIBLE, (index, '독립 오라클은 불가능', solver.status_name(status), b)
    else:
        feasible_cases += 1
        assert status == cp.OPTIMAL, (index, '작은 문제 최적성', solver.status_name(status), b)
        places = sm.placements(solver)
        expected = reference(b, places, options)
        assert expected is not None, (index, '반환 배치의 하드조건', places, b)
        assert expected['totalPenalty'] == min(score for score, _ in feasible), (index, expected, feasible, b)
        check_terms(sm, solver, expected, index)
        assert balanced_quality.evaluate(b, places, options) == expected, (index, '독립 Python 평가값', b)
    checks += 1
    print(f'  ✓ 독립 완전열거 {index + 1:02d}: 블록·분 구간·공동교사·학생집단·용량·품질')
assert feasible_cases and infeasible_cases, (feasible_cases, infeasible_cases)


def fix_assignment(sm, model, places):
    chosen = Counter((sm.by_lesson[p['lessonId']], p['slotId']) for p in places)
    if any(key not in sm.x for key in chosen):
        model.add(False)
    for key, var in sm.x.items():
        # 같은 그룹의 같은 시간에 두 활동을 놓는 불법 배치도 그대로 검사한다.
        model.add(var == chosen[key])


# 작은 무작위 문제의 0·1 초과량만 맞추는 잘못된 선형식을 놓치지 않는다.
b = fixture([dict(id=f'd{day}s{i}', day=day, label=f'{day}요일 {i}교시', startMinute=i * 2, endMinute=i * 2 + 1, periods=1) for day in (1, 2, 3) for i in range(6)])
b['lessons'] = [{**b['lessons'][0], 'id': f'l{i}'} for i in range(6)]
b['courseLoads'][0]['periods'] = 6
validate_basis(b)
sm = Model(b, OPTIONS, time.monotonic() + 10)
for distribution in ((6, 0, 0), (4, 2, 0), (3, 3, 0), (2, 2, 2), (1, 4, 1)):
    slots = [f'd{day}s{i}' for day, number in enumerate(distribution, 1) for i in range(number)]
    places = [dict(lessonId=f'l{i}', slotId=sid) for i, sid in enumerate(slots)]
    expected = reference(b, places)
    assert expected is not None
    assert expected['teacherDailyExcess'] == sum(max(0, n - 2) ** 2 for n in distribution)
    assert expected['courseDailyPairs'] == sum(n * (n - 1) // 2 for n in distribution)
    frozen = sm.m.clone()
    fix_assignment(sm, frozen, places)
    solver, status = solve(frozen)
    assert status == cp.OPTIMAL, ('높은 초과량', distribution, solver.status_name(status))
    check_terms(sm, solver, expected, distribution)
    assert balanced_quality.evaluate(b, places) == expected
checks += 1
print('  ✓ 6활동의 5가지 요일 분포에서 큰 제곱초과·3회 이상 같은 과목 활동 쌍 정확성')


for variant in ('동일 카드 묶음', '개별 선호', '개별 고정', '서로 다른 도메인', '슬롯 별칭', '불가 시간'):
    b = fixture()
    if variant == '개별 선호':
        b['preferences'] = [dict(lessonId='a', slotId='s0', weight=7)]
    elif variant == '개별 고정':
        b['fixed'] = [dict(lessonId='a', slotId='s0')]
    elif variant == '서로 다른 도메인':
        b['lessons'][1]['allowedSlotIds'] = ['s1']
    elif variant == '슬롯 별칭':
        b['slots'].append({**b['slots'][0], 'id': 'alias'})
        for lesson in b['lessons']:
            lesson['allowedSlotIds'].append('alias')
    elif variant == '불가 시간':
        b['unavailable'] = [dict(resourceId='t0', day=1, startMinute=0, endMinute=4)]
    validate_basis(b)
    sm = Model(b, OPTIONS, time.monotonic() + 10)
    assert len(sm.groups) == (2 if variant in ('개별 선호', '개별 고정', '서로 다른 도메인') else 1), variant
    for places in assignments(b):
        enumerated += 1
        expected = reference(b, places)
        model = sm.m.clone()
        fix_assignment(sm, model, places)
        solver, status = solve(model)
        assert status == (cp.OPTIMAL if expected is not None else cp.INFEASIBLE), (variant, places, expected, solver.status_name(status))
        if expected is not None:
            check_terms(sm, solver, expected, variant)
            assert balanced_quality.evaluate(b, places) == expected, (variant, places)
    checks += 1
    print(f'  ✓ {variant}: 모든 배치를 고정하여 원래 하드해집합과 원시 품질 비용 대조')


b = fixture()
places = [dict(lessonId='a', slotId='s0'), dict(lessonId='b', slotId='s1')]
expected = reference(b, places)
assert expected is not None and expected['teacherDailyExcess'] == 1
sm = Model(b, OPTIONS, time.monotonic() + 10)
frozen = sm.m.clone()
fix_assignment(sm, frozen, places)
solver, status = solve(frozen)
assert status == cp.OPTIMAL
check_terms(sm, solver, expected, '부분 동결')
fixed_basis = deepcopy(b)
fixed_basis['fixed'] = places
fixed_model = Model(fixed_basis, OPTIONS, time.monotonic() + 10)
solver, status = solve(fixed_model.m)
assert status == cp.OPTIMAL
check_terms(fixed_model, solver, expected, '입력 고정 이후 평가 기준 보존')
assert reference(fixed_basis, places) == expected
assert balanced_quality.evaluate(fixed_basis, places) == expected
checks += 1
print('  ✓ 모델 부분 동결·입력 고정 전후 배정가능요일과 품질 기준 불변')


for block in (False, True):
    if block:
        slots = [dict(id='early', day=1, label='앞 단일', startMinute=0, endMinute=4, periods=1),
                 dict(id='late', day=1, label='뒤 단일', startMinute=8, endMinute=12, periods=1),
                 dict(id='block0', day=1, label='앞 블록', startMinute=0, endMinute=8, periods=2),
                 dict(id='block1', day=1, label='뒤 블록', startMinute=4, endMinute=12, periods=2)]
        b = fixture(slots)
        b['lessons'][0].update(periods=2, allowedSlotIds=['block0', 'block1'])
        b['lessons'][1]['allowedSlotIds'] = ['early', 'late']
        b['courseLoads'][0]['periods'] = 3
        anchor = [dict(lessonId='a', slotId='block0'), dict(lessonId='b', slotId='late')]
    else:
        b = fixture()
        b['slots'] = b['slots'][:2]
        for lesson in b['lessons']:
            lesson['allowedSlotIds'] = ['s0', 's1']
        anchor = [dict(lessonId='a', slotId='s0'), dict(lessonId='b', slotId='s1')]
    validate_basis(b)
    assert reference(b, anchor) is not None
    sm = Model(b, OPTIONS, time.monotonic() + 10)
    different = sm.m.clone()
    sm.distance(different, balanced_quality.cells(b, anchor), 1)
    _, status = solve(different)
    assert status == cp.INFEASIBLE, ('블록 경계' if block else '활동 ID 순열', status)
    checks += 1
    print('  ✓ 실제 점유가 같은 ' + ('블록 경계 변경' if block else '활동 ID 순열') + '은 새 후보에서 제외')

print(f'전부 통과 — {checks}건, 독립 완전열거 {enumerated}배치, 합성 가능 {feasible_cases}·불가능 {infeasible_cases}문제')
