"""학교 AI의 읽기 전용 운영 메타·무호출 진단. 질문·학생 자료·비밀을 반환하지 않는다."""
import os
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from _assistant import CheckError, LIMITS, exact, identifier, integer, enum, parse_json, _token
from _school_policy import SchoolClient, encryption_keys, decrypt_key
from _school_settings import status_result

READ_RPCS = frozenset(('workhub_ai_school_operations', 'workhub_ai_school_diagnostics'))
BUSINESS_ERRORS = frozenset(('FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_READY'))
STATES = ('prepared', 'started', 'completed', 'rejected', 'unknown', 'failed', 'closed', 'resolved')
FEATURES = ('assistant', 'evaluation')
QUALITIES = ('quick', 'review', 'legacy')
ERROR_CODES = frozenset(('FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT',
    'BUDGET_EXCEEDED', 'NOT_READY', 'SCHOOL_NOT_LINKED', 'KEY_MISSING', 'POLICY_MISSING', 'DISABLED', 'OVER_RESERVATION',
    'OUTPUT_INVALID', 'PROVIDER_REJECTED', 'TRUNCATED', 'COUNT_FAILED', 'INPUT_TOO_LARGE', 'CANCELLED', 'PROVIDER_UNKNOWN'))
PAGE_SIZE = 25


def business_result(value):
    if isinstance(value, dict) and 'error' in value:
        exact(value, ('error',)); exact(value['error'], ('code',))
        code = enum(value['error']['code'], BUSINESS_ERRORS)
        raise CheckError(code, 403 if code in ('FORBIDDEN', 'INACTIVE_MEMBERSHIP') else 409 if code in ('CONFLICT', 'IDEMPOTENCY_CONFLICT') else 503 if code == 'NOT_READY' else 422)
    return value


class OperationsClient(SchoolClient):
    def rpc(self, name, args):
        if name not in READ_RPCS:
            return super().rpc(name, args)
        return business_result(parse_json(self._request('POST', '/rest/v1/rpc/' + name, args, maximum=LIMITS['responseBytes'])))


def utc_time(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value):
            raise ValueError()
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.isoformat(timespec='milliseconds').replace('+00:00', 'Z') != value:
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise CheckError('INVALID_RESPONSE', 502) from None


def month(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9]\d{3}-(0[1-9]|1[0-2])', value):
        raise CheckError('INVALID_RESPONSE', 502)
    return value


def cursor(value):
    if value is None:
        return None
    exact(value, ('month', 'asOf', 'afterId'))
    month(value['month']); utc_time(value['asOf']); identifier(value['afterId'])
    return dict(value)


def request(payload):
    try:
        if not isinstance(payload, dict):
            raise CheckError('INVALID_INPUT', 400)
        action = enum(payload.get('action'), ('list', 'diagnostics'))
        exact(payload, ('action', 'memberId', 'cursor') if action == 'list' else ('action', 'memberId'))
        identifier(payload['memberId'])
        if action == 'list':
            cursor(payload['cursor'])
        return dict(payload)
    except CheckError:
        raise CheckError('INVALID_INPUT', 400) from None


def aggregate(value, with_group=False):
    exact(value, ('requests', 'settledMicroUsd', 'reservedMicroUsd', 'states') + (('feature', 'quality') if with_group else ()))
    for field in ('requests', 'settledMicroUsd', 'reservedMicroUsd'):
        integer(value[field])
    exact(value['states'], STATES)
    for state in STATES:
        integer(value['states'][state])
    if sum(value['states'].values()) != value['requests']:
        raise CheckError('INVALID_RESPONSE', 502)
    return value


def operations_result(value, member, previous=None):
    business_result(value)
    exact(value, ('contract', 'schoolId', 'memberId', 'checkedAt', 'month', 'timeZone', 'asOf', 'totals', 'groups', 'unresolved', 'items', 'nextCursor'))
    if value['contract'] != 'assistant.operations.v1' or value['memberId'] != member:
        raise CheckError('INVALID_RESPONSE', 502)
    identifier(value['schoolId']); identifier(member); month(value['month'])
    checked, as_of = utc_time(value['checkedAt']), utc_time(value['asOf'])
    try:
        if not isinstance(value['timeZone'], str):
            raise ValueError()
        zone = ZoneInfo(value['timeZone'])
    except (ZoneInfoNotFoundError, ValueError):
        raise CheckError('INVALID_RESPONSE', 502) from None
    if as_of > checked or as_of.astimezone(zone).strftime('%Y-%m') != value['month']:
        raise CheckError('INVALID_RESPONSE', 502)
    if previous is not None and any(previous[field] != value[field] for field in ('month', 'asOf')):
        raise CheckError('INVALID_RESPONSE', 502)
    aggregate(value['totals'])
    groups = value['groups']
    if not isinstance(groups, list) or len(groups) != len(FEATURES) * len(QUALITIES):
        raise CheckError('INVALID_RESPONSE', 502)
    for row, (feature, quality) in zip(groups, ((feature, quality) for feature in FEATURES for quality in QUALITIES)):
        aggregate(row, True)
        if row['feature'] != feature or row['quality'] != quality:
            raise CheckError('INVALID_RESPONSE', 502)
    if any(sum(row[field] for row in groups) != value['totals'][field] for field in ('requests', 'settledMicroUsd', 'reservedMicroUsd')) or any(
        sum(row['states'][state] for row in groups) != value['totals']['states'][state] for state in STATES):
        raise CheckError('INVALID_RESPONSE', 502)
    unresolved = exact(value['unresolved'], ('requests', 'reservedMicroUsd', 'previousMonthRequests', 'previousMonthReservedMicroUsd', 'oldestCreatedAt', 'observedOverageRequests'))
    for field in ('requests', 'reservedMicroUsd', 'previousMonthRequests', 'previousMonthReservedMicroUsd', 'observedOverageRequests'):
        integer(unresolved[field])
    if (unresolved['previousMonthRequests'] > unresolved['requests'] or unresolved['observedOverageRequests'] > unresolved['requests'] or
        unresolved['previousMonthReservedMicroUsd'] > unresolved['reservedMicroUsd'] or
        (unresolved['oldestCreatedAt'] is None) != (unresolved['requests'] == 0)):
        raise CheckError('INVALID_RESPONSE', 502)
    if unresolved['oldestCreatedAt'] is not None and utc_time(unresolved['oldestCreatedAt']) > checked:
        raise CheckError('INVALID_RESPONSE', 502)
    rows = value['items']
    if not isinstance(rows, list) or len(rows) > PAGE_SIZE or len(rows) > value['totals']['requests']:
        raise CheckError('INVALID_RESPONSE', 502)
    seen, last_created = set(), None
    for row in rows:
        exact(row, ('id', 'requestKey', 'feature', 'quality', 'state', 'createdAt', 'updatedAt', 'model', 'reservedMicroUsd', 'settledMicroUsd', 'usage', 'errorCode', 'observedOverage'))
        row_id = identifier(row['id']); identifier(row['requestKey'])
        if len(row['requestKey']) < 8:
            raise CheckError('INVALID_RESPONSE', 502)
        enum(row['feature'], FEATURES); enum(row['quality'], QUALITIES); enum(row['state'], STATES)
        created, updated = utc_time(row['createdAt']), utc_time(row['updatedAt'])
        # 같은 밀리초 안의 원시 시각은 SQL만 안다. 표시 시각이 같은 행의 ID 순서를 추정하지 않는다.
        if row_id in seen or created > as_of or updated < created or updated > checked or (last_created is not None and created > last_created):
            raise CheckError('INVALID_RESPONSE', 502)
        if previous is not None and row_id == previous['afterId']:
            raise CheckError('INVALID_RESPONSE', 502)
        seen.add(row_id); last_created = created
        if not isinstance(row['model'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,150}', row['model']):
            raise CheckError('INVALID_RESPONSE', 502)
        integer(row['reservedMicroUsd'])
        if row['settledMicroUsd'] is not None:
            integer(row['settledMicroUsd'])
            if row['reservedMicroUsd'] != 0:
                raise CheckError('INVALID_RESPONSE', 502)
        if row['usage'] is not None:
            exact(row['usage'], ('inputTokens', 'outputTokens'))
            integer(row['usage']['inputTokens']); integer(row['usage']['outputTokens'])
        if row['errorCode'] is not None:
            enum(row['errorCode'], ERROR_CODES)
        if type(row['observedOverage']) is not bool:
            raise CheckError('INVALID_RESPONSE', 502)
    after = cursor(value['nextCursor'])
    if after is not None and (len(rows) != PAGE_SIZE or after['afterId'] != rows[-1]['id'] or any(after[field] != value[field] for field in ('month', 'asOf'))):
        raise CheckError('INVALID_RESPONSE', 502)
    return value


def diagnostics_source(value, member, school):
    business_result(value)
    exact(value, ('contract', 'schoolId', 'memberId', 'policyVersion', 'enabled', 'overageBlocked', 'credential'))
    if value['contract'] != 'assistant.school.diagnostics.v1' or value['memberId'] != member or value['schoolId'] != school:
        raise CheckError('INVALID_RESPONSE', 502)
    integer(value['policyVersion'])
    if type(value['enabled']) is not bool or type(value['overageBlocked']) is not bool:
        raise CheckError('INVALID_RESPONSE', 502)
    if value['credential'] is not None:
        exact(value['credential'], ('version', 'keyId', 'iv', 'ciphertext', 'tag'))
        integer(value['credential']['version'], 1)
        for field, maximum in (('keyId', 80), ('iv', 32), ('ciphertext', 4096), ('tag', 32)):
            if not isinstance(value['credential'][field], str) or not 1 <= len(value['credential'][field]) <= maximum:
                raise CheckError('INVALID_RESPONSE', 502)
    return value


def diagnostics(client, common, current, env, now):
    member, school = common['p_member_id'], current['schoolId']
    source = None
    try:
        source = diagnostics_source(client.rpc('workhub_ai_school_diagnostics', common), member, school)
    except CheckError as problem:
        # 새 조회 함수가 아직 준비되지 않은 경우에만 확인된 관리자 범위에서 부분 진단한다.
        if problem.code != 'NOT_READY':
            raise
    checks = [dict(id='authorization', ok=True, code='AUTHORIZED'), dict(id='serviceConfiguration', ok=True, code='SERVICE_AUTHENTICATED')]
    checks.append(dict(id='database', ok=True if source else None, code='SQL_READY' if source else 'SQL_READ_UNAVAILABLE'))
    if source:
        policy_code = 'POLICY_MISSING' if source['policyVersion'] == 0 else 'OVERAGE_BLOCKED' if source['overageBlocked'] else 'POLICY_ENABLED' if source['enabled'] else 'POLICY_DISABLED'
        checks.append(dict(id='policy', ok=policy_code == 'POLICY_ENABLED', code=policy_code))
        has_key = source['credential'] is not None
    else:
        checks.append(dict(id='policy', ok=False if current['policyVersion'] == 0 else None, code='POLICY_MISSING' if current['policyVersion'] == 0 else 'SQL_READ_UNAVAILABLE'))
        has_key = current['credential']['configured']
    checks.append(dict(id='schoolKey', ok=has_key, code='KEY_PRESENT' if has_key else 'KEY_MISSING'))
    try:
        encryption_keys(env)
        encryption_ok = True
    except CheckError:
        encryption_ok = False
    checks.append(dict(id='serverEncryption', ok=encryption_ok, code='ENCRYPTION_CONFIGURED' if encryption_ok else 'ENCRYPTION_CONFIG_INVALID'))
    if source is None:
        decryption_ok, decryption_code = None, 'SQL_READ_UNAVAILABLE'
    elif not has_key:
        decryption_ok, decryption_code = None, 'KEY_MISSING'
    elif not encryption_ok:
        decryption_ok, decryption_code = None, 'ENCRYPTION_CONFIG_INVALID'
    else:
        try:
            # 복호화 결과는 확인에만 쓰고 외부 전송·응답·로그에 저장하지 않는다.
            decrypt_key(school, source['credential'], env)
            decryption_ok, decryption_code = True, 'KEY_DECRYPTABLE'
        except CheckError:
            decryption_ok, decryption_code = False, 'KEY_UNAVAILABLE'
    checks.extend((dict(id='keyDecryption', ok=decryption_ok, code=decryption_code), dict(id='providerConnection', ok=None, code='NOT_CHECKED')))
    checked = now().astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    utc_time(checked)
    return dict(contract='assistant.school.diagnostics.v1', schoolId=school, memberId=member, checkedAt=checked, providerContacted=False, checks=checks)


def execute(payload, authorization, environ=None, client=None, now=None):
    payload = request(payload); authorization = _token(authorization)
    env = os.environ if environ is None else environ
    client = client or OperationsClient(environ=env)
    actor = client.user(authorization)
    common = dict(p_actor_user_id=actor, p_member_id=payload['memberId'])
    if payload['action'] == 'list':
        # SQL이 현재 소속·학교 관리 권한을 확인한다. 학교 ID는 클라이언트에서 받지 않는다.
        value = client.rpc('workhub_ai_school_operations', {**common, 'p_cursor': payload['cursor']})
        return operations_result(value, payload['memberId'], payload['cursor'])
    current = status_result(business_result(client.rpc('workhub_ai_school_status', common)), payload['memberId'])
    if not current['canManage']:
        raise CheckError('FORBIDDEN', 403)
    return diagnostics(client, common, current, env, now or (lambda: datetime.now(timezone.utc)))
