"""품질 우선 모드의 독립 평가. 솔버 변수·탐색 점유표를 사용하지 않는다."""
from collections import Counter, defaultdict
from pathlib import Path
import json
import math

POLICY = json.loads((Path(__file__).resolve().parents[1] / '_assets/balanced-policy.json').read_text(encoding='utf-8'))


def course_key(basis, lesson):
    kinds = {r['id']: r['kind'] for r in basis['resources']}
    return lesson['courseId'], tuple(sorted(r for r in lesson['resourceIds'] if kinds[r] in ('class', 'student_group')))


def legal_slots(basis, lesson):
    allowed = set(lesson['allowedSlotIds'])
    return [s for s in basis['slots'] if s['id'] in allowed and not any(u['resourceId'] in lesson['resourceIds'] and u['day'] == s['day'] and s['startMinute'] < u['endMinute'] and u['startMinute'] < s['endMinute'] for u in basis['unavailable'])]


def context(basis):
    teachers = {r['id'] for r in basis['resources'] if r['kind'] == 'teacher'}
    calendars, totals = defaultdict(list), Counter()
    for lesson in basis['lessons']:
        legal = legal_slots(basis, lesson)
        for rid in teachers.intersection(lesson['resourceIds']):
            totals[rid] += lesson['periods']
            for s in legal:
                calendars[rid, s['day']].append((s['startMinute'], s['endMinute']))
    for key, intervals in calendars.items():
        merged = []
        for a, b in sorted(intervals):
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        calendars[key] = merged
    targets = {rid: math.ceil(total / max(1, sum(t == rid for t, day in calendars))) for rid, total in totals.items()}
    return dict(calendars), targets


def rank(intervals, minute):
    return sum(max(0, min(minute, b) - a) for a, b in intervals)


def evaluate(basis, places, options=None, prepared=None):
    options = options or {}
    calendars, targets = prepared if prepared is not None else context(basis)
    teachers = {r['id'] for r in basis['resources'] if r['kind'] == 'teacher'}
    lessons, slots = {l['id']: l for l in basis['lessons']}, {s['id']: s for s in basis['slots']}
    weights = {(p['lessonId'], p['slotId']): p['weight'] for p in basis['preferences']}
    course_days, day_load, day_times = Counter(), Counter(), defaultdict(list)
    result = dict(totalPenalty=0, preferencePenalty=0, teacherDailyExcess=0, teacherWorstExcess=0, courseDailyPairs=0, courseAdjacency=0, teacherGapMinutes=0)
    for p in places:
        l, s = lessons[p['lessonId']], slots[p['slotId']]
        result['preferencePenalty'] += weights.get((l['id'], s['id']), 0)
        course_days[course_key(basis, l), s['day']] += 1
        for rid in teachers.intersection(l['resourceIds']):
            day_load[rid, s['day']] += l['periods']
            day_times[rid, s['day']].append((s['startMinute'], s['endMinute']))
    burdens = Counter()
    for (rid, day), periods in day_load.items():
        excess = max(0, periods - targets[rid]) ** 2
        result['teacherDailyExcess'] += excess
        burdens[rid] += excess
        times = day_times[rid, day]
        first, last = min(a for a, b in times), max(b for a, b in times)
        result['teacherGapMinutes'] += rank(calendars[rid, day], last) - rank(calendars[rid, day], first) - sum(b - a for a, b in times)
    result['teacherWorstExcess'] = max(burdens.values(), default=0)
    result['courseDailyPairs'] = sum(n * (n - 1) // 2 for n in course_days.values())
    result['courseAdjacency'] = sum((course, day + 1) in course_days for course, day in course_days)
    result['totalPenalty'] = sum(result[k] * weight for k, weight in enabled_weights(options).items())
    return result


def enabled_weights(options):
    return {k: w if (options.get('improveTeacherBalance', True) if k.startswith('teacher') else options.get('spreadCourses', True) if k.startswith('course') else True) else 0 for k, w in POLICY['weights'].items()}


def bounds(basis):
    days = defaultdict(set)
    for s in basis['slots']:
        days[s['day']].update((s['startMinute'], s['endMinute']))
    return {day: sorted(times) for day, times in days.items()}


def slot_cells(lesson, slot, boundaries):
    times = boundaries[slot['day']]
    return [(slot['day'], a, b, lesson['courseId'], tuple(sorted(lesson['resourceIds']))) for a, b in zip(times, times[1:]) if a >= slot['startMinute'] and b <= slot['endMinute']]


def cells(basis, places, boundaries=None):
    boundaries = boundaries or bounds(basis)
    lessons, slots = {l['id']: l for l in basis['lessons']}, {s['id']: s for s in basis['slots']}
    return frozenset(cell for p in places for cell in slot_cells(lessons[p['lessonId']], slots[p['slotId']], boundaries))


def difference(left, right):
    return max(sum(c[2] - c[1] for c in left - right), sum(c[2] - c[1] for c in right - left))


def required_difference(record):
    return max(1, math.ceil(sum(c[2] - c[1] for c in record) * POLICY['minimumDifferenceFraction']))


def ceiling(score):
    return score + max(POLICY['absoluteQualityTolerance'], math.floor(score * POLICY['relativeQualityTolerance']))
