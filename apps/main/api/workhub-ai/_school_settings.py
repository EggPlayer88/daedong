"""학교 관리자 키 등록 경계. 비밀은 응답이나 복구 명령에 남기지 않는다."""
import os
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from _school_policy import SchoolClient, ROUTING, encrypt_key, secret
from _assistant import CheckError, _token, exact, identifier, integer, enum, timestamp


def status_result(value, member):
    exact(value, ('contract', 'schoolId', 'memberId', 'policyVersion', 'canManage', 'credential', 'budget', 'models', 'status'))
    if value['contract'] != 'assistant.school.v1' or value['memberId'] != member or type(value['canManage']) is not bool:
        raise CheckError('INVALID_RESPONSE', 502)
    identifier(value['schoolId']); integer(value['policyVersion'])
    enum(value['status'], ('ready', 'key_missing', 'policy_missing', 'budget_exhausted', 'disabled'))
    credential = exact(value['credential'], ('configured', 'version', 'maskedSuffix', 'updatedAt'))
    if type(credential['configured']) is not bool:
        raise CheckError('INVALID_RESPONSE', 502)
    integer(credential['version'])
    if credential['configured']:
        if credential['version'] < 1 or not isinstance(credential['maskedSuffix'], str) or len(credential['maskedSuffix']) != 4:
            raise CheckError('INVALID_RESPONSE', 502)
        timestamp(credential['updatedAt'])
    elif credential['maskedSuffix'] is not None or credential['updatedAt'] is not None:
        raise CheckError('INVALID_RESPONSE', 502)
    budget = exact(value['budget'], ('month', 'timeZone', 'currency', 'limitMicroUsd', 'settledMicroUsd', 'reservedMicroUsd', 'availableMicroUsd'))
    if not isinstance(budget['month'], str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', budget['month']):
        raise CheckError('INVALID_RESPONSE', 502)
    try:
        if not isinstance(budget['timeZone'], str):
            raise ValueError()
        ZoneInfo(budget['timeZone'])
    except (ZoneInfoNotFoundError, ValueError):
        raise CheckError('INVALID_RESPONSE', 502) from None
    if budget['currency'] != 'USD' or budget['limitMicroUsd'] != ROUTING['schoolMonthlyLimitMicroUsd']:
        raise CheckError('INVALID_RESPONSE', 502)
    for key in ('settledMicroUsd', 'reservedMicroUsd', 'availableMicroUsd'):
        integer(budget[key])
    if budget['availableMicroUsd'] != max(0, budget['limitMicroUsd'] - budget['settledMicroUsd'] - budget['reservedMicroUsd']):
        raise CheckError('INVALID_RESPONSE', 502)
    if value['models'] != {tier: {k: row[k] for k in ('id', 'label')} for tier, row in ROUTING['models'].items()}:
        raise CheckError('INVALID_RESPONSE', 502)
    return value


def receipt(value, school, member, key, version):
    exact(value, ('contract', 'schoolId', 'memberId', 'requestKey', 'state', 'credentialVersion'))
    if (value['contract'] != 'assistant.school.v1' or value['schoolId'] != school or value['memberId'] != member or value['requestKey'] != key or
        (value['state'] == 'applied' and value['credentialVersion'] != version + 1) or
        (value['state'] in ('pending', 'closed') and value['credentialVersion'] is not None)):
        raise CheckError('INVALID_RESPONSE', 502)
    enum(value['state'], ('applied', 'pending', 'closed'))
    return value


def execute(payload, authorization, environ=None, client=None):
    authorization = _token(authorization)
    try:
        if not isinstance(payload, dict):
            raise CheckError('INVALID_INPUT', 400)
        action = enum(payload.get('action'), ('status', 'save_key', 'recover_key', 'close_key'))
        keys = ('action', 'memberId') if action == 'status' else ('action', 'memberId', 'requestKey', 'expectedCredentialVersion')
        exact(payload, keys + (('apiKey',) if action == 'save_key' else ()))
        member = identifier(payload['memberId'])
        if action != 'status':
            identifier(payload['requestKey']); integer(payload['expectedCredentialVersion'])
            if len(payload['requestKey']) < 8:
                raise CheckError('INVALID_INPUT', 400)
        if action == 'save_key':
            secret(payload['apiKey'])
    except CheckError:
        raise CheckError('INVALID_INPUT', 400) from None
    env = os.environ if environ is None else environ
    client = client or SchoolClient(environ=env)
    actor = client.user(authorization)
    common = {'p_actor_user_id': actor, 'p_member_id': member}
    current = status_result(client.rpc('workhub_ai_school_status', common), member)
    if action == 'status':
        return current
    if not current['canManage']:
        raise CheckError('FORBIDDEN', 403)
    key, version = payload['requestKey'], payload['expectedCredentialVersion']
    if action in ('recover_key', 'close_key'):
        rpc = 'workhub_ai_school_key_recover' if action == 'recover_key' else 'workhub_ai_school_key_close'
        result = client.rpc(rpc, {**common, 'p_request_key': key, **({'p_expected_version': version} if action == 'close_key' else {})})
    else:
        # 중복 응답은 DB 접수증이 판정한다. 현재 판이 달라졌다고 원키 재확인을 먼저 차단하지 않는다.
        try:
            encrypted = encrypt_key(current['schoolId'], version + 1, payload['apiKey'], env)
        except CheckError:
            # DB 키 저장 함수를 부르기 전 실패한 경우에만 무반영으로 알린다.
            raise CheckError('KEY_UNAVAILABLE', 422) from None
        result = client.rpc('workhub_ai_school_key_save', {**common, 'p_request_key': key, 'p_expected_version': version,
                                                         'p_envelope': encrypted, 'p_masked_suffix': payload['apiKey'][-4:]})
    return receipt(result, current['schoolId'], member, key, version)
