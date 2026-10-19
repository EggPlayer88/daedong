"""로컬 작업 계약. 계산 요청·결과는 기존 CP-SAT 계약을 독립 재검증한다."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re

import runner

POLICY = json.loads((Path(__file__).resolve().parents[1] / '_assets' / 'job-policy.json').read_text(encoding='utf-8'))
CONTRACT = POLICY['contract']
TERMINAL = frozenset(('succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted'))
STATES = TERMINAL | {'queued', 'running', 'cancel_requested'}
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
# JavaScript String.trim / String.length와 같은 기준으로 앱과 경계를 맞춘다.
JS_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


class JobError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(ok, code='INVALID_JOB', message='작업 파일의 형식이나 원본이 맞지 않습니다.'):
    if not ok:
        raise JobError(code, message)


def exact(value, names):
    require(type(value) is dict and set(value) == set(names.split()))


def timestamp(value):
    require(type(value) is str and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value)))
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise JobError('INVALID_JOB', '작업 시각 형식이 맞지 않습니다.') from None


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def validate_queue(value):
    exact(value, 'contract queueId createdAt policyVersion')
    require(value['contract'] == CONTRACT and bool(UUID.fullmatch(str(value['queueId']))) and type(value['policyVersion']) is int and value['policyVersion'] == POLICY['version'])
    timestamp(value['createdAt'])
    return value


def validate_marker(value, queue, request_id, cancel=False):
    time_key = 'requestedAt' if cancel else 'queuedAt'
    exact(value, f'contract queueId requestId inputHash {time_key}')
    require(value['contract'] == CONTRACT and value['queueId'] == queue['queueId'] and value['requestId'] == request_id and bool(UUID.fullmatch(request_id)))
    require(type(value['inputHash']) is str and bool(re.fullmatch('[a-f0-9]{64}', value['inputHash'])))
    timestamp(value[time_key])
    return value


def validate_request(value, marker):
    try:
        runner.validate_request(value)
    except (runner.InputError, ValueError, TypeError, KeyError, OverflowError):
        raise JobError('INVALID_REQUEST', '계산 요청과 요청 지문이 맞지 않습니다.') from None
    require(value['requestId'] == marker['requestId'] and value['inputHash'] == marker['inputHash'], 'REQUEST_CONFLICT', '같은 작업 번호의 원본이 달라졌습니다.')
    return value


def validate_status(value, marker):
    exact(value, 'contract queueId requestId inputHash sequence state queuedAt updatedAt startedAt finishedAt code')
    require(all(value[key] == marker[key] for key in ('contract', 'queueId', 'requestId', 'inputHash', 'queuedAt')))
    require(type(value['sequence']) is int and 0 < value['sequence'] <= 9007199254740991 and value['state'] in STATES)
    timestamp(value['updatedAt'])
    for key in ('startedAt', 'finishedAt'):
        if value[key] is not None:
            timestamp(value[key])
    require(value['code'] is None or (type(value['code']) is str and bool(re.fullmatch('[A-Z][A-Z0-9_]{0,99}', value['code']))))
    require((value['state'] in TERMINAL) == (value['finishedAt'] is not None))
    require(value['state'] not in ('running', 'cancel_requested', 'succeeded', 'timed_out') or value['startedAt'] is not None)
    require(value['updatedAt'] >= value['queuedAt'])
    require(value['startedAt'] is None or value['queuedAt'] <= value['startedAt'] <= value['updatedAt'])
    require(value['finishedAt'] is None or (value['startedAt'] or value['queuedAt']) <= value['finishedAt'] <= value['updatedAt'])
    require(value['state'] != 'succeeded' or value['code'] is None)
    return value


def validate_result(request, value):
    """자식 프로세스의 성공 종료만으로 결과를 믿지 않고 배치·목적함수까지 확인한다."""
    try:
        exact(value, 'contract requestId inputHash engineVersion status candidates issues stats')
        require(all(value[key] == request[key] for key in ('contract', 'requestId', 'inputHash')))
        require(value['engineVersion'] == runner.POLICY['engineVersion'])
        require(value['status'] in ('feasible', 'infeasible', 'unknown', 'invalid', 'unsupported', 'error'))
        exact(value['stats'], 'elapsedMs branches stoppedByLimit')
        stats = value['stats']
        require(type(stats['elapsedMs']) in (int, float) and math.isfinite(stats['elapsedMs']) and stats['elapsedMs'] >= 0)
        require(type(stats['branches']) is int and 0 <= stats['branches'] <= 9007199254740991 and type(stats['stoppedByLimit']) is bool)
        require(type(value['candidates']) is list and len(value['candidates']) <= request['options']['maxCandidates'])
        require(type(value['issues']) is list and len(value['issues']) <= 101)
        for issue in value['issues']:
            exact(issue, 'code message path')
            require(type(issue['code']) is str and bool(re.fullmatch('[A-Z_]{1,100}', issue['code'])))
            require(type(issue['message']) is str and bool(issue['message'].strip(JS_WHITESPACE)) and len(issue['message'].encode('utf-16-le', errors='surrogatepass')) // 2 <= 2000)
            require(type(issue['path']) is str and len(issue['path'].encode('utf-16-le', errors='surrogatepass')) // 2 <= 500)
        require((value['status'] == 'feasible') == bool(value['candidates']))
        require((value['status'] == 'feasible') == (not value['issues']))
        require(value['status'] != 'unknown' or stats['stoppedByLimit'])
        require(value['status'] != 'infeasible' or not stats['stoppedByLimit'])
        require(value['status'] != 'unsupported' or bool(request['basis']['unsupportedFeatures']))
        require(value['status'] not in ('feasible', 'infeasible', 'unknown') or not request['basis']['unsupportedFeatures'])
        seen = set()
        for candidate in value['candidates']:
            exact(candidate, 'placements objective optimal')
            require(type(candidate['optimal']) is bool)
            exact(candidate['objective'], 'changedLessons movedLessons preferencePenalty teacherPeakPeriods courseRepeats')
            require(all(type(number) is int and 0 <= number <= 9007199254740991 for number in candidate['objective'].values()))
            runner.validate_placements(request['basis'], candidate['placements'])
            require(candidate['objective'] == runner.objective(request['basis'], candidate['placements'], request['previous']))
            signature = runner.canonical(sorted(candidate['placements'], key=lambda item: item['lessonId']))
            require(signature not in seen)
            seen.add(signature)
        return value
    except (JobError, runner.InputError, KeyError, TypeError, ValueError, OverflowError):
        raise JobError('RESULT_INVALID', '계산 결과의 원본·배치·목적함수를 확인할 수 없습니다.') from None


def digest(value):
    return hashlib.sha256(runner.canonical(value).encode('utf-8')).hexdigest()
