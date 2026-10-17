"""정규 TimetableBasis를 직접 계산하는 로컬 CP-SAT 작업자. DB·HTTP·키 접근 없음."""
from collections import Counter, defaultdict
from pathlib import Path
import hashlib
import json
import re
import sys
import time

ASSETS = Path(__file__).resolve().parents[1] / '_assets'
POLICY = json.loads((ASSETS / 'engine-policy.json').read_text(encoding='utf-8'))
LIMIT = json.loads((ASSETS / 'browser-policy.json').read_text(encoding='utf-8'))


class InputError(Exception):
    def __init__(self, code, message, path):
        self.issue = dict(code=code, message=message, path=path)


def fail(code, message, path):
    raise InputError(code, message, path)


def fields(value, keys, path):
    if not isinstance(value, dict) or set(value) != set(keys.split()):
        fail('INVALID_FIELDS', '필수 항목과 지원하지 않는 항목을 확인해 주세요.', path)


def integer(value, lo, hi, path):
    if type(value) is not int or not lo <= value <= hi:
        fail('INVALID_NUMBER', '정수 범위를 확인해 주세요.', path)


def ident(value, path):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        fail('INVALID_ID', '식별자 형식을 확인해 주세요.', path)


def text(value, path):
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-16-le')) // 2 > 200 or any(ord(c) < 32 for c in value):
        fail('INVALID_TEXT', '표시 이름을 확인해 주세요.', path)


def rows(value, limit, path):
    if not isinstance(value, list) or len(value) > limit:
        fail('INVALID_ARRAY', '배열 형식과 입력 한도를 확인해 주세요.', path)
    return value


def interval(value, path):
    integer(value['day'], 1, 7, path)
    integer(value['startMinute'], 0, 1439, path)
    integer(value['endMinute'], 1, 1440, path)
    if value['startMinute'] >= value['endMinute']:
        fail('INVALID_INTERVAL', '종료 시각이 시작 뒤여야 합니다.', path)


def overlap(a, b):
    return a['day'] == b['day'] and a['startMinute'] < b['endMinute'] and b['startMinute'] < a['endMinute']


def validate_basis(b):
    fields(b, 'schemaVersion id revision schoolId termId sourceFingerprint schoolLevel unsupportedFeatures resources slots lessons courseLoads fixed unavailable preferences', 'basis')
    if b['schemaVersion'] != 1 or type(b['schemaVersion']) is not int:
        fail('UNSUPPORTED_VERSION', '기초판 버전 1이 필요합니다.', 'basis.schemaVersion')
    for k in ('id', 'schoolId', 'termId'):
        ident(b[k], 'basis.' + k)
    integer(b['revision'], 1, 9007199254740991, 'basis.revision')
    if not isinstance(b['sourceFingerprint'], str) or not re.fullmatch('[a-f0-9]{64}', b['sourceFingerprint']):
        fail('INVALID_FINGERPRINT', '기초판 원본 지문이 필요합니다.', 'basis.sourceFingerprint')
    if b['schoolLevel'] not in ('primary', 'middle', 'high', 'other'):
        fail('INVALID_SCHOOL_LEVEL', '학교급을 확인해 주세요.', 'basis.schoolLevel')
    for feature in rows(b['unsupportedFeatures'], 100, 'basis.unsupportedFeatures'):
        text(feature, 'basis.unsupportedFeatures')
    if len(set(b['unsupportedFeatures'])) != len(b['unsupportedFeatures']):
        fail('DUPLICATE_REFERENCE', '미지원 조건이 중복되었습니다.', 'basis.unsupportedFeatures')
    resources, slots, lessons = {}, {}, {}
    for key, spec, target, limit in [
        ('resources', 'id kind label capacity', resources, LIMIT['maxResources']),
        ('slots', 'id day label startMinute endMinute periods', slots, LIMIT['maxSlots']),
        ('lessons', 'id courseId label periods resourceIds allowedSlotIds', lessons, LIMIT['maxLessons'])]:
        for i, item in enumerate(rows(b[key], limit, 'basis.' + key)):
            path = f'basis.{key}[{i}]'
            fields(item, spec, path); ident(item['id'], path); text(item['label'], path)
            if item['id'] in target:
                fail('DUPLICATE_ID', '식별자가 중복되었습니다.', path)
            target[item['id']] = item
            if key == 'resources':
                if item['kind'] not in ('teacher', 'class', 'student_group', 'room', 'equipment'):
                    fail('UNKNOWN_RESOURCE_KIND', '자원 종류를 확인해 주세요.', path)
                integer(item['capacity'], 1, LIMIT['maxCapacity'], path)
                if item['kind'] in ('teacher', 'class', 'student_group') and item['capacity'] != 1:
                    fail('IDENTITY_CAPACITY', '교사와 학생 집단은 동시에 한 수업만 가능합니다.', path)
            elif key == 'slots':
                interval(item, path); integer(item['periods'], 1, LIMIT['maxPeriods'], path)
    if not lessons:
        fail('EMPTY_LESSONS', '편성할 수업이 없습니다.', 'basis.lessons')
    loads, entries = Counter(), 0
    for l in lessons.values():
        ident(l['courseId'], 'lesson.courseId'); integer(l['periods'], 1, LIMIT['maxPeriods'], 'lesson.periods')
        loads[l['courseId']] += l['periods']
        for key, target, maximum in [('resourceIds', resources, LIMIT['maxResources']), ('allowedSlotIds', slots, LIMIT['maxSlots'])]:
            arr = rows(l[key], maximum, 'lesson.' + key)
            for x in arr:
                ident(x, 'lesson.' + key)
                if x not in target:
                    fail('UNKNOWN_REFERENCE', '존재하지 않는 자원 또는 시간대입니다.', 'lesson.' + key)
            if not arr or len(set(arr)) != len(arr):
                fail('INVALID_REFERENCE', '빈 목록과 중복 참조를 확인해 주세요.', 'lesson.' + key)
        entries += len(l['allowedSlotIds'])
        kinds = {resources[x]['kind'] for x in l['resourceIds']}
        if 'teacher' not in kinds or not {'class', 'student_group'} & kinds:
            fail('MISSING_PARTICIPANTS', '교사와 수업 집단을 지정해 주세요.', 'lesson.resourceIds')
        if any(slots[x]['periods'] != l['periods'] for x in l['allowedSlotIds']):
            fail('BLOCK_PERIODS_MISMATCH', '수업과 허용 시간대의 시수가 다릅니다.', 'lesson.allowedSlotIds')
    if entries > LIMIT['maxDomainEntries']:
        fail('INPUT_LIMIT', '현재 정규 계약의 입력 한도를 넘었습니다.', 'basis.lessons')
    official = {}
    for l in rows(b['courseLoads'], LIMIT['maxLessons'], 'basis.courseLoads'):
        fields(l, 'courseId periods', 'basis.courseLoads'); ident(l['courseId'], 'basis.courseLoads')
        integer(l['periods'], 1, LIMIT['maxCoursePeriods'], 'basis.courseLoads')
        if l['courseId'] in official:
            fail('DUPLICATE_COURSE', '기준 시수가 중복되었습니다.', 'basis.courseLoads')
        official[l['courseId']] = l['periods']
    if dict(loads) != official:
        fail('COURSE_LOAD_MISMATCH', '기준 시수와 수업 합계가 다릅니다.', 'basis.courseLoads')
    for key in ('fixed', 'preferences'):
        seen = set()
        for r in rows(b[key], LIMIT['maxLessons'] if key == 'fixed' else LIMIT['maxConditions'], 'basis.' + key):
            fields(r, 'lessonId slotId' + (' weight' if key == 'preferences' else ''), 'basis.' + key)
            ident(r['lessonId'], 'basis.' + key); ident(r['slotId'], 'basis.' + key)
            if r['lessonId'] not in lessons or r['slotId'] not in lessons[r['lessonId']]['allowedSlotIds']:
                fail('ILLEGAL_SLOT', '조건 대상의 수업·시간대를 확인해 주세요.', 'basis.' + key)
            pair = r['lessonId'] if key == 'fixed' else (r['lessonId'], r['slotId'])
            if pair in seen:
                fail('DUPLICATE_CONDITION', '조건이 중복되었습니다.', 'basis.' + key)
            seen.add(pair)
            if key == 'preferences':
                integer(r['weight'], 0, LIMIT['maxWeight'], 'basis.preferences')
    for r in rows(b['unavailable'], LIMIT['maxConditions'], 'basis.unavailable'):
        fields(r, 'resourceId day startMinute endMinute', 'basis.unavailable'); ident(r['resourceId'], 'basis.unavailable')
        if r['resourceId'] not in resources:
            fail('UNKNOWN_RESOURCE', '불가 조건의 자원을 찾을 수 없습니다.', 'basis.unavailable')
        interval(r, 'basis.unavailable')
    return resources, slots, lessons


def validate_placements(b, places):
    resources, slots, lessons = validate_basis(b)
    if b['unsupportedFeatures']:
        fail('UNSUPPORTED_FEATURE', '미지원 조건은 검증할 수 없습니다.', 'basis.unsupportedFeatures')
    seen, occupied = set(), defaultdict(list)
    fixed = {r['lessonId']: r['slotId'] for r in b['fixed']}
    for p in rows(places, LIMIT['maxLessons'], 'placements'):
        fields(p, 'lessonId slotId', 'placements'); ident(p['lessonId'], 'placements'); ident(p['slotId'], 'placements')
        if p['lessonId'] not in lessons or p['slotId'] not in slots or p['lessonId'] in seen:
            fail('INVALID_PLACEMENT', '배치 참조 또는 중복을 확인해 주세요.', 'placements')
        seen.add(p['lessonId'])
        l, s = lessons[p['lessonId']], slots[p['slotId']]
        if s['id'] not in l['allowedSlotIds'] or fixed.get(l['id'], s['id']) != s['id']:
            fail('ILLEGAL_SLOT', '허용 시간·고정 조건을 어긴 배치입니다.', 'placements')
        for rid in l['resourceIds']:
            if any(u['resourceId'] == rid and overlap(s, u) for u in b['unavailable']):
                fail('UNAVAILABLE', '불가 시간에 배치했습니다.', 'placements')
            occupied[rid].extend([(s['day'], s['startMinute'], 1), (s['day'], s['endMinute'], -1)])
    if seen != set(lessons):
        fail('MISSING_LESSON', '수업 배치가 누락되었습니다.', 'placements')
    for rid, edges in occupied.items():
        count = 0
        for _, _, delta in sorted(edges):
            count += delta
            if count > resources[rid]['capacity']:
                fail('RESOURCE_COLLISION', '실제 시각의 자원 수용량을 넘었습니다.', 'placements')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('중복 JSON 항목')
        result[key] = value
    return result


def validate_request(r):
    fields(r, 'contract requestId inputHash basis previous options', 'request')
    if r['contract'] != POLICY['contract']:
        fail('UNSUPPORTED_VERSION', '계산 요청 계약 버전이 다릅니다.', 'contract')
    ident(r['requestId'], 'requestId')
    payload = {k: v for k, v in r.items() if k != 'inputHash'}
    if r['inputHash'] != hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest():
        fail('INPUT_HASH_MISMATCH', '원래 계산 입력의 지문이 다릅니다.', 'inputHash')
    validate_basis(r['basis'])
    lessons = r['basis']['lessons']
    if sum(len(l['allowedSlotIds']) for l in lessons) > POLICY['maximumModelChoices'] or sum(len(l['allowedSlotIds']) * len(l['resourceIds']) for l in lessons) > POLICY['maximumResourceChoices']:
        fail('MODEL_LIMIT', '계산 모델 크기 한도를 넘었습니다.', 'basis.lessons')
    if r['previous'] is not None:
        old = r['previous']; fields(old, 'basis placements', 'previous')
        validate_placements(old['basis'], old['placements'])
        if any(old['basis'][k] != r['basis'][k] for k in ('schoolId', 'termId')):
            fail('PREVIOUS_CONTEXT_MISMATCH', '이전 시간표의 학교·학기가 다릅니다.', 'previous')
    o = r['options']; fields(o, 'maxSeconds maxCandidates seed minimizeChanges improveTeacherBalance spreadCourses', 'options')
    integer(o['maxSeconds'], 1, POLICY['maximumMaxSeconds'], 'options.maxSeconds')
    integer(o['maxCandidates'], 1, POLICY['maximumCandidates'], 'options.maxCandidates')
    integer(o['seed'], 0, 2147483647, 'options.seed')
    for k in ('minimizeChanges', 'improveTeacherBalance', 'spreadCourses'):
        if type(o[k]) is not bool:
            fail('INVALID_OPTIONS', '최적화 옵션은 참·거짓으로 지정합니다.', 'options.' + k)


def previous_data(previous):
    if previous is None:
        return {}, {}, {}
    b = previous['basis']
    return ({l['id']: l for l in b['lessons']}, {p['lessonId']: p['slotId'] for p in previous['placements']}, {s['id']: s for s in b['slots']})


def changed(lesson, slot, previous):
    old_lessons, old_places, old_slots = previous
    if not old_lessons:
        return 0
    old = old_lessons.get(lesson['id'])
    if old is None:
        return 1
    before = old_slots[old_places[lesson['id']]]
    return int(old['courseId'] != lesson['courseId'] or old['periods'] != lesson['periods'] or set(old['resourceIds']) != set(lesson['resourceIds']) or any(before[k] != slot[k] for k in ('day', 'startMinute', 'endMinute')))


def moved(lesson, slot, previous):
    old_lessons, old_places, old_slots = previous
    if lesson['id'] not in old_lessons:
        return 0
    before = old_slots[old_places[lesson['id']]]
    return int(any(before[k] != slot[k] for k in ('day', 'startMinute', 'endMinute')))


def objective(b, places, previous):
    resources, slots, lessons = validate_basis(b)
    old = previous_data(previous)
    weights = {(p['lessonId'], p['slotId']): p['weight'] for p in b['preferences']}
    teacher_days, course_days = Counter(), Counter()
    count, moves, penalty = 0, 0, 0
    for p in places:
        l, s = lessons[p['lessonId']], slots[p['slotId']]
        count += changed(l, s, old); moves += moved(l, s, old); penalty += weights.get((l['id'], s['id']), 0)
        course_days[l['courseId'], s['day']] += 1
        for rid in l['resourceIds']:
            if resources[rid]['kind'] == 'teacher':
                teacher_days[rid, s['day']] += l['periods']
    count += len(set(old[0]) - set(lessons))
    return dict(changedLessons=count, movedLessons=moves, preferencePenalty=penalty, teacherPeakPeriods=max(teacher_days.values(), default=0), courseRepeats=sum(max(0, n - 1) for n in course_days.values()))


def make_model(cp, r, excluded, deadline):
    b = r['basis']; resources, slots, lessons = validate_basis(b)
    model, choices, intervals = cp.CpModel(), {}, defaultdict(list)
    fixed = {p['lessonId']: p['slotId'] for p in b['fixed']}
    old = previous_data(r['previous'])
    preferences = {(p['lessonId'], p['slotId']): p['weight'] for p in b['preferences']}
    change_terms, move_terms, preference_terms = [], [], []
    teacher_days, course_days = defaultdict(list), defaultdict(list)
    for lid, l in sorted(lessons.items()):
        if time.monotonic() >= deadline:
            raise TimeoutError()
        allowed = []
        for sid in sorted(l['allowedSlotIds']):
            s = slots[sid]
            if fixed.get(lid, sid) != sid or any(u['resourceId'] in l['resourceIds'] and overlap(s, u) for u in b['unavailable']):
                continue
            var = model.new_bool_var(f'{lid}:{sid}'); choices[lid, sid] = var; allowed.append(var)
            at = s['day'] * 1440 + s['startMinute']
            span = model.new_optional_fixed_size_interval_var(at, s['endMinute'] - s['startMinute'], var, f'interval:{lid}:{sid}')
            for rid in l['resourceIds']:
                intervals[rid].append(span)
                if resources[rid]['kind'] == 'teacher':
                    teacher_days[rid, s['day']].append(l['periods'] * var)
            course_days[l['courseId'], s['day']].append(var)
            change_terms.append(changed(l, s, old) * var); move_terms.append(moved(l, s, old) * var); preference_terms.append(preferences.get((lid, sid), 0) * var)
            if old[1].get(lid) == sid:
                model.add_hint(var, 1)
        model.add_exactly_one(allowed)
    for rid, spans in intervals.items():
        model.add_cumulative(spans, [1] * len(spans), resources[rid]['capacity'])
    for places in excluded:
        model.add(sum(choices[p['lessonId'], p['slotId']] for p in places) <= len(places) - 1)
    peak = model.new_int_var(0, sum(l['periods'] for l in b['lessons']), 'teacher_peak')
    model.add_max_equality(peak, [sum(terms) for terms in teacher_days.values()] or [0])
    repeats = []
    for i, terms in enumerate(course_days.values()):
        n = model.new_int_var(0, len(terms), f'course_repeats:{i}')
        model.add_max_equality(n, [sum(terms) - 1, 0]); repeats.append(n)
    metrics = dict(changedLessons=sum(change_terms) + len(set(old[0]) - set(lessons)), movedLessons=sum(move_terms), preferencePenalty=sum(preference_terms), teacherPeakPeriods=peak, courseRepeats=sum(repeats))
    stages = (['changedLessons', 'movedLessons'] if r['options']['minimizeChanges'] and r['previous'] else []) + ['preferencePenalty'] + (['teacherPeakPeriods'] if r['options']['improveTeacherBalance'] else []) + (['courseRepeats'] if r['options']['spreadCourses'] else [])
    return model, choices, metrics, stages


def solve(request):
    started = time.monotonic()
    result = dict(contract=POLICY['contract'], requestId=request.get('requestId', '') if isinstance(request, dict) else '', inputHash=request.get('inputHash', '') if isinstance(request, dict) else '', engineVersion=POLICY['engineVersion'], status='invalid', candidates=[], issues=[], stats=dict(elapsedMs=0, branches=0, stoppedByLimit=False))
    try:
        validate_request(request); b = request['basis']
        if b['unsupportedFeatures']:
            result['status'] = 'unsupported'
            result['issues'] = [dict(code='UNSUPPORTED_FEATURE', message='아직 계산할 수 없는 조건: ' + x, path='basis.unsupportedFeatures') for x in b['unsupportedFeatures']]
            return result
        try:
            import ortools
            from ortools.sat.python import cp_model as cp
            if ortools.__version__ != POLICY['ortoolsVersion']:
                raise ImportError('지원 버전 불일치')
        except ImportError:
            result['status'] = 'error'
            result['issues'] = [dict(code='ENGINE_UNAVAILABLE', message='고정 버전 OR-Tools 계산 환경이 필요합니다.', path='engine')]
            return result
        deadline = started + request['options']['maxSeconds']; excluded = []
        for _ in range(request['options']['maxCandidates']):
            model, choices, metrics, stages = make_model(cp, request, excluded, deadline)
            best, optimal = None, True
            for stage in stages:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    result['stats']['stoppedByLimit'], optimal = True, False
                    break
                model.minimize(metrics[stage]); solver = cp.CpSolver()
                solver.parameters.max_time_in_seconds = remaining
                solver.parameters.num_search_workers = 1; solver.parameters.random_seed = request['options']['seed']
                status = solver.solve(model); result['stats']['branches'] += solver.num_branches
                if status == cp.MODEL_INVALID:
                    fail('MODEL_INVALID', '계산 모델 검증에 실패했습니다.', 'engine')
                if status == cp.INFEASIBLE:
                    break
                if status not in (cp.OPTIMAL, cp.FEASIBLE):
                    result['stats']['stoppedByLimit'], optimal = True, False
                    break
                best = [dict(lessonId=lid, slotId=sid) for (lid, sid), var in sorted(choices.items()) if solver.value(var)]
                if status != cp.OPTIMAL:
                    result['stats']['stoppedByLimit'], optimal = True, False
                    break
                model.add(metrics[stage] == solver.value(metrics[stage]))
            if best is None:
                break
            validate_placements(b, best)
            result['candidates'].append(dict(placements=best, objective=objective(b, best, request['previous']), optimal=optimal)); excluded.append(best)
            if not optimal or time.monotonic() >= deadline:
                break
        if result['candidates']:
            result['status'] = 'feasible'
        elif result['stats']['stoppedByLimit']:
            result['status'] = 'unknown'
            result['issues'] = [dict(code='SEARCH_LIMIT', message='제한 안에 결론을 내리지 못했습니다. 불가능 판정이 아닙니다.', path='options')]
        else:
            result['status'] = 'infeasible'
            result['issues'] = [dict(code='NO_SOLUTION', message='명시된 필수조건을 함께 만족하는 배치가 없습니다.', path='basis')]
    except InputError as error:
        result['status'], result['candidates'], result['issues'] = 'invalid', [], [error.issue]
    except TimeoutError:
        result['stats']['stoppedByLimit'] = True
        if result['candidates']:
            result['status'] = 'feasible'
        else:
            result['status'] = 'unknown'
            result['issues'] = [dict(code='SEARCH_LIMIT', message='모델 준비 시간 안에 결론을 내리지 못했습니다.', path='options')]
    except Exception:
        result['status'], result['candidates'], result['issues'] = 'error', [], [dict(code='ENGINE_ERROR', message='계산이 완료되지 않았습니다. 이 결과를 사용하지 마세요.', path='engine')]
    finally:
        result['stats']['elapsedMs'] = round((time.monotonic() - started) * 1000, 3)
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='시간표 계산 요청 한 개를 검증하고 계산합니다.')
    parser.add_argument('--input', help='UTF-8 요청 JSON. 생략하면 stdin')
    parser.add_argument('--output', help='새 UTF-8 결과 JSON. 기존 파일을 덮어쓰지 않습니다.')
    args = parser.parse_args()
    # stdin 한 요청/한 응답이며 전역 서버·운영 큐는 따로 연결해야 한다.
    if args.input:
        with open(args.input, 'rb') as stream:
            raw = stream.read(POLICY['maximumRequestBytes'] + 1)
    else:
        raw = sys.stdin.buffer.read(POLICY['maximumRequestBytes'] + 1)
    try:
        if len(raw) > POLICY['maximumRequestBytes']:
            raise ValueError('입력 한도 초과')
        request = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeError):
        request = None
    output = json.dumps(solve(request), ensure_ascii=False, separators=(',', ':'))
    if args.output:
        with open(args.output, 'x', encoding='utf-8') as stream:
            stream.write(output + '\n')
    else:
        sys.stdout.reconfigure(encoding='utf-8')
        print(output)
