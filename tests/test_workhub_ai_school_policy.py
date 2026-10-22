"""학교 키·요청 복구·토큰 사전검사의 서버 경계. 모든 자료와 공급자 응답은 합성이다."""
import base64
import copy
import json
import sys
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/main/api/workhub-ai'))
import _school_policy as p
import _school_settings as settings

PASS = FAIL = 0
ENV = {'WORKHUB_AI_ACTIVE_KEY_ID': 'master-one', 'WORKHUB_AI_KEY_ENCRYPTION_KEYS': json.dumps({'master-one': base64.b64encode(bytes(range(32))).decode()})}
SECRET = 'sk-ant-synthetic-no-real-service-key-1234'
TOKEN = 'Bearer ' + 'synthetic-token-' * 3
ACTOR, MEMBER, SCHOOL, KEY = 'actor-one', 'member-one', 'school-one', 'request-school-policy-one'
REF = {'kind': 'knowledge', 'id': 'rule-one', 'version': 1}


def check(name, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('  ✓ ' + name)
    except Exception as problem:
        FAIL += 1; print('  ✗ ' + name + ': ' + repr(problem))
        import traceback
        traceback.print_exc()


def eq(actual, expected):
    assert actual == expected, (actual, expected)


def error(fn, code):
    try:
        fn()
    except p.CheckError as problem:
        eq(problem.code, code); return
    raise AssertionError('예외 없음: ' + code)


def input():
    return {'mode': 'school', 'intent': 'school_advice', 'prompt': '제출 절차를 알려 줘', 'threadId': None, 'expectedVersion': 0, 'references': [copy.deepcopy(REF)], 'studentContext': None, 'quality': 'quick', 'reviewOf': None}


def payload(value=None, action='ask'):
    return {'action': action, 'memberId': MEMBER, 'requestKey': KEY, 'input': value or input()}


def envelope(data, school=SCHOOL):
    return {'contract': 'ai-gateway.v1', 'schoolId': school, 'actorUserId': ACTOR, 'feature': 'assistant', 'requestKey': KEY, 'data': data}


def claim():
    source = {'key': 'source-one', 'reference': copy.deepcopy(REF), 'title': '학교 안내', 'locator': '1절', 'classification': 'school_public', 'body': '담당자에게 제출합니다.'}
    plain = {k: v for k, v in input().items() if k not in ('quality', 'reviewOf')}
    model = p.ROUTING['models']['quick']
    reserve = (p.ROUTING['reserveInputTokens'] * model['inputMicroUsdPerMtok'] + p.ROUTING['maxOutputTokens'] * model['outputMicroUsdPerMtok']) // 1000000
    policy = {'version': 1, 'model': model['id'], 'maxInputTokens': 80000, 'maxOutputTokens': 8000, 'reservedMicroUsd': reserve}
    assistant = {'state': 'claimed', 'requestKey': KEY, 'leaseToken': 'p6-lease', 'input': plain, 'history': [], 'sources': [source],
                 'policy': {'approved': True, 'configVersion': 1, 'model': model['id'], 'maxTokens': 8000,
                            'budget': {'reservationId': 'reservation-one', 'policyVersion': 1, 'currency': 'USD', 'reservedMicroUsd': reserve, 'dailyLimitMicroUsd': 100000000, 'monthlyLimitMicroUsd': 100000000}}}
    return {'state': 'claimed', 'leaseToken': 'lease-one', 'policy': policy,
            'credential': {'version': 1, **p.encrypt_key(SCHOOL, 1, SECRET, ENV)}, 'assistant': assistant,
            'execution': {'quality': 'quick', 'model': model['id'], 'reviewOf': None}}


def provider(body, key, deadline):
    eq(key, SECRET)
    return {'response': {'type': 'message', 'role': 'assistant', 'id': 'msg_synthetic', 'model': body['model'], 'stop_reason': 'end_turn',
                         'usage': {'input_tokens': 31, 'output_tokens': 20},
                         'content': [{'type': 'thinking', 'thinking': '표시하지 않을 내부 블록', 'signature': 'synthetic'},
                                     {'type': 'text', 'text': json.dumps({'segments': [{'text': '담당자에게 제출해 주세요.', 'sourceKeys': ['source-one']}], 'taskDraft': None})}]}}


def result_thread(result):
    return {'state': 'completed', 'requestKey': KEY,
            'thread': {'id': 'thread-one', 'mode': 'school', 'version': 1, 'title': '학교 안내', 'nextCursor': None,
                       'exchanges': [{'id': 'exchange-one', 'requestKey': KEY, 'intent': 'school_advice', 'prompt': input()['prompt'],
                                      'segments': result['segments'], 'proposal': None, 'createdAt': '2026-10-21T10:00:00Z', 'studentContext': None,
                                      'execution': {'quality': 'quick', 'model': p.ROUTING['models']['quick']['id'], 'reviewOf': None}}]}}


class Client:
    def __init__(self):
        self.calls = []; self.value = claim(); self.final = None; self.started = False; self.deadline = time.monotonic() + 45
        self.fail_finish = False; self.fail_start = False; self.start_allowed = True; self.auth = True

    def user(self, token):
        self.calls.append(('user', token))
        if not self.auth:
            raise p.CheckError('UNAUTHENTICATED', 401)
        return ACTOR

    def rpc(self, name, args):
        self.calls.append((name, copy.deepcopy(args)))
        if name == 'workhub_ai_gateway_prepare':
            if self.final is not None:
                return envelope(self.final)
            if self.started:
                return envelope({'state': 'pending', 'reason': 'provider_unknown'})
            return envelope(copy.deepcopy(self.value))
        if name == 'workhub_ai_gateway_recover':
            return envelope(self.final or {'state': 'pending', 'reason': 'provider_unknown'})
        if name == 'workhub_ai_gateway_start':
            if not self.start_allowed:
                return envelope({'started': False})
            self.started = True
            if self.fail_start:
                raise p.CheckError('RESULT_UNKNOWN')
            return envelope({'started': True})
        if name == 'workhub_ai_gateway_release':
            self.final = {'state': 'failed', 'code': args['p_reason']}
            return envelope(self.final)
        if name == 'workhub_ai_gateway_finish':
            value = args['p_result']
            self.final = ({'state': 'completed', 'response': result_thread(value['response']), 'quality': 'quick', 'model': self.value['policy']['model'], 'usage': value['usage']}
                          if value['state'] == 'completed' else {'state': 'pending', 'reason': 'provider_unknown'} if value['state'] == 'provider_unknown' else value)
            if self.fail_finish:
                self.fail_finish = False
                raise p.CheckError('RESULT_UNKNOWN')
            return envelope(self.final)
        raise AssertionError(name)


def run(client=None, supplied=None, counter=None, action='ask', env=None):
    return p.execute(payload(action=action), TOKEN, ENV if env is None else env, client or Client(), supplied or provider, counter or (lambda *_: 31))


def crypto_roundtrip():
    sealed = p.encrypt_key(SCHOOL, 1, SECRET, ENV)
    assert SECRET not in json.dumps(sealed)
    eq(p.decrypt_key(SCHOOL, {'version': 1, **sealed}, ENV), SECRET)
    assert sealed != p.encrypt_key(SCHOOL, 1, SECRET, ENV)
    for school, version in [('other-school', 1), (SCHOOL, 2)]:
        error(lambda: p.decrypt_key(school, {'version': version, **sealed}, ENV), 'KEY_UNAVAILABLE')
    for field in ('iv', 'ciphertext', 'tag'):
        bad = dict(sealed); bad[field] = base64.b64encode(b'x' * len(base64.b64decode(sealed[field]))).decode()
        error(lambda: p.decrypt_key(SCHOOL, {'version': 1, **bad}, ENV), 'KEY_UNAVAILABLE')


check('암호문은 학교·키 판에 묶이고 IV가 매번 달라 복사·변조를 거부한다', crypto_roundtrip)
check('학교 키가 없을 때 전역 ANTHROPIC_API_KEY로 대체하지 않는다', lambda: error(lambda: p.decrypt_key(SCHOOL, claim()['credential'], {'ANTHROPIC_API_KEY': SECRET}), 'KEY_UNAVAILABLE'))
check('옛 7필드 요청에는 기본값을 삽입하지 않고 원형을 보존한다', lambda: eq(p.parse_request(payload(claim()['assistant']['input']))['input'], claim()['assistant']['input']))
check('임의 모델·학교·원키 필드를 요청에 넣으면 거부한다', lambda: [error(lambda value=value: p.parse_request(value), 'INVALID_INPUT') for value in [dict(payload(), schoolId='other'), dict(payload(), model='opus'), payload(dict(input(), apiKey=SECRET)), payload(dict(input(), quality='anything'))]])
check('기본 요청에 reviewOf만 넣어 승격할 수 없다', lambda: error(lambda: p.parse_request(payload(dict(input(), reviewOf={'requestKey': KEY, 'exchangeId': 'exchange-one'}))), 'INVALID_INPUT'))


def happy():
    client = Client(); sent = []
    result = run(client, lambda *args: (sent.append(args[0]), provider(*args))[1])
    eq(result['data']['state'], 'completed'); eq(len(sent), 1)
    eq(sent[0]['model'], 'claude-haiku-5-5')
    assert 'tool_choice' not in sent[0] and 'tools' not in sent[0]
    assert 'cache_control' not in json.dumps(sent[0]) and 'maxLength' not in json.dumps(sent[0]['output_config']['format']['schema']).replace('maxLength=', '')
    eq([row[0] for row in client.calls], ['user', 'workhub_ai_gateway_prepare', 'workhub_ai_gateway_start', 'workhub_ai_gateway_finish'])
    assert '내부 블록' not in json.dumps(result, ensure_ascii=False) and SECRET not in json.dumps(result)


check('학교 키로 기본 Haiku를 한 번 호출하고 thinking·키는 결과에 노출하지 않는다', happy)


def replay(lost=False):
    client = Client(); client.fail_finish = lost; sent = []
    send = lambda *args: (sent.append(1), provider(*args))[1]
    first = run(client, send); second = run(client, send, action='recover')
    eq(first['data']['state'], 'pending' if lost else 'completed'); eq(second['data']['state'], 'completed'); eq(len(sent), 1)


check('완료 원키 복구는 새 예약·공급자 호출 없이 원래 답변을 반환한다', lambda: replay())
check('finish 응답 유실 뒤 조회로 결과를 찾고 중복 과금하지 않는다', lambda: replay(True))


def unknown():
    client = Client(); sent = []
    def send(*_):
        sent.append(1); raise p.CheckError('RESULT_UNKNOWN')
    eq(run(client, send)['data']['state'], 'pending')
    eq(run(client, send, action='recover')['data']['state'], 'pending')
    eq(sent, [1]); assert not any(name.endswith('release') for name, _ in client.calls)


check('공급자 결과 미상은 예약을 남기며 Sonnet·새 호출로 우회하지 않는다', unknown)


def preflight_failure(counter, expected):
    client = Client(); sent = []
    error(lambda: run(client, lambda *_: sent.append(1), counter), expected)
    eq(sent, []); eq([x[0] for x in client.calls][-1], 'workhub_ai_gateway_release')
    assert not client.started


check('토큰 계수 실패는 유료 생성 전 예약만 해제한다', lambda: preflight_failure(lambda *_: (_ for _ in ()).throw(p.CheckError('COUNT_FAILED')), 'COUNT_FAILED'))
check('입력 80,000토큰 초과는 공급자 생성 전에 차단한다', lambda: preflight_failure(lambda *_: 80001, 'INVALID_INPUT'))


def start_lost():
    client = Client(); client.fail_start = True; sent = []
    error(lambda: run(client, lambda *_: sent.append(1)), 'RESULT_UNKNOWN')
    eq(run(client, lambda *_: sent.append(1), action='recover')['data']['state'], 'pending'); eq(sent, [])


check('시작권 응답 유실을 성공으로 추측하지 않는다', start_lost)


def output_mutation(edit, expected):
    client = Client()
    def send(*args):
        value = provider(*args); edit(value['response']); return value
    eq(run(client, send)['data']['state'], expected)


check('다른 모델 응답은 원장을 미확정으로 남기고 표시하지 않는다', lambda: output_mutation(lambda v: v.update(model='arbitrary-model'), 'pending'))
check('잘린 답변의 알려진 사용량은 rejected 정산으로 전달한다', lambda: output_mutation(lambda v: v.update(stop_reason='max_tokens'), 'rejected'))
check('깨진 JSON 답변은 자동 재호출 없이 알려진 사용량과 함께 거절한다', lambda: output_mutation(lambda v: v.update(content=[{'type': 'text', 'text': '{broken'}]), 'rejected'))


def forged_source():
    client = Client()
    def send(*args):
        value = provider(*args); value['response']['content'] = [{'type': 'text', 'text': json.dumps({'segments': [{'text': '잘못된 인용', 'sourceKeys': ['forged']}], 'taskDraft': None})}]; return value
    result = run(client, send); eq(result['data']['code'], 'OUTPUT_INVALID')


check('실제 공급자 JSON 형식을 읽은 뒤 존재하지 않는 근거를 다시 거부한다', forged_source)
check('인증 실패 시 DB 예약과 공급자 호출은 없다', lambda: (lambda c: (setattr(c, 'auth', False), error(lambda: run(c), 'UNAUTHENTICATED'), eq(len(c.calls), 1)))(Client()))


def settings_status():
    return {'contract': 'assistant.school.v1', 'schoolId': SCHOOL, 'memberId': MEMBER, 'policyVersion': 1, 'canManage': True,
            'credential': {'configured': False, 'version': 0, 'maskedSuffix': None, 'updatedAt': None},
            'budget': {'month': '2026-10', 'timeZone': 'Asia/Seoul', 'currency': 'USD', 'limitMicroUsd': 100000000, 'settledMicroUsd': 1000, 'reservedMicroUsd': 2000, 'availableMicroUsd': 99997000},
            'models': {tier: {k: row[k] for k in ('id', 'label')} for tier, row in p.ROUTING['models'].items()}, 'status': 'key_missing'}


class SettingsClient:
    def __init__(self):
        self.calls = []; self.status = settings_status()
    def user(self, _):
        return ACTOR
    def rpc(self, name, args):
        self.calls.append((name, copy.deepcopy(args)))
        if name == 'workhub_ai_school_status':
            return self.status
        return {'contract': 'assistant.school.v1', 'schoolId': SCHOOL, 'memberId': MEMBER, 'requestKey': KEY, 'state': 'applied', 'credentialVersion': 1}


def settings_save():
    client = SettingsClient()
    result = settings.execute({'action': 'save_key', 'memberId': MEMBER, 'requestKey': KEY, 'expectedCredentialVersion': 0, 'apiKey': SECRET}, TOKEN, ENV, client)
    assert SECRET not in json.dumps(result) and SECRET not in json.dumps(client.calls)
    args = client.calls[-1][1]
    eq(p.decrypt_key(SCHOOL, {'version': 1, **args['p_envelope']}, ENV), SECRET)
    eq(args['p_masked_suffix'], '1234')


check('키 등록은 인증·관리권한 확인 후 암호문만 DB로 보내고 마스킹 접수증만 반환한다', settings_save)
check('키 없는 복구 명령으로 등록 결과를 조회할 수 있다', lambda: eq(settings.execute({'action': 'recover_key', 'memberId': MEMBER, 'requestKey': KEY, 'expectedCredentialVersion': 0}, TOKEN, ENV, SettingsClient())['state'], 'applied'))
check('조회 응답에 암호문·원키 필드가 끼면 공개하지 않는다', lambda: error(lambda: settings.status_result(dict(settings_status(), apiKey=SECRET), MEMBER), 'INVALID_RESPONSE'))
check('학교 예산 잔액이 정산·예약과 다르면 표시하지 않는다', lambda: error(lambda: settings.status_result({**settings_status(), 'budget': {**settings_status()['budget'], 'availableMicroUsd': 100000000}}, MEMBER), 'INVALID_RESPONSE'))

def cross_crypto():
    # 모두 합성 키다. Python 설정 서버가 만든 암호문을 Node 평가계획 경로에서 읽고 역방향도 검증한다.
    sealed = p.encrypt_key(SCHOOL, 1, SECRET, ENV)
    script = """
import {encryptSchoolKey,decryptSchoolKey} from './apps/main/api/_ai-policy/gateway.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const v=JSON.parse(input);
const decoded=decryptSchoolKey({schoolId:v.school,credentialVersion:1,envelope:v.sealed},v.env);
if(decoded!==v.secret)throw Error('교차 복호화 불일치');
console.log(JSON.stringify(encryptSchoolKey({schoolId:v.school,credentialVersion:1,apiKey:v.secret},v.env)));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
        input=json.dumps({'school': SCHOOL, 'secret': SECRET, 'sealed': sealed, 'env': ENV}),
        capture_output=True, text=True, encoding='utf-8', timeout=10, check=True)
    eq(p.decrypt_key(SCHOOL, {'version': 1, **json.loads(result.stdout)}, ENV), SECRET)


def usage_overage():
    client = Client()
    def send(*args):
        value = provider(*args); value['response']['usage']['input_tokens'] = 100001; return value
    eq(run(client, send)['data']['state'], 'pending')
    result = [args['p_result'] for name, args in client.calls if name.endswith('_finish')][0]
    eq(result, {'state': 'provider_unknown', 'observedUsage': {'inputTokens': 100001, 'outputTokens': 20}})
    assert not any(name.endswith('_release') for name, _ in client.calls)


def settings_closed():
    class Closed(SettingsClient):
        def rpc(self, name, args):
            if name == 'workhub_ai_school_key_close':
                self.calls.append((name, copy.deepcopy(args)))
                return {'contract': 'assistant.school.v1', 'schoolId': SCHOOL, 'memberId': MEMBER, 'requestKey': KEY, 'state': 'closed', 'credentialVersion': None}
            return super().rpc(name, args)
    client = Closed()
    result = settings.execute({'action': 'close_key', 'memberId': MEMBER, 'requestKey': KEY, 'expectedCredentialVersion': 0}, TOKEN, ENV, client)
    eq(result['state'], 'closed'); eq(client.calls[-1][1]['p_expected_version'], 0)
    assert SECRET not in json.dumps(client.calls)


def settings_encryption_missing():
    client = SettingsClient()
    error(lambda: settings.execute({'action': 'save_key', 'memberId': MEMBER, 'requestKey': KEY, 'expectedCredentialVersion': 0, 'apiKey': SECRET}, TOKEN, {}, client), 'KEY_UNAVAILABLE')
    eq([name for name, _ in client.calls], ['workhub_ai_school_status'])


check('Python 비서 설정과 Node 평가계획은 같은 학교 키 암호문을 서로 읽는다', cross_crypto)
check('예약 범위를 넘은 관측 사용량은 자동 정산하지 않고 미확정 자료로 전달한다', usage_overage)
check('키 등록 닫기는 원키 없이 같은 번호와 기준판으로만 호출하고 닫힘 확인 후 종료한다', settings_closed)
check('암호화 설정 누락은 저장 전 무반영 오류이며 DB 키 쓰기를 부르지 않는다', settings_encryption_missing)
check('학교 예산의 잘못된 월·시간대는 거부한다', lambda: [error(lambda: settings.status_result({**settings_status(), 'budget': {**settings_status()['budget'], **bad}}, MEMBER), 'INVALID_RESPONSE') for bad in ({'month': '2026-99'}, {'timeZone': 'invalid-zone'})])


def review_context():
    raw = claim(); original = input(); original.update(quality='review', reviewOf={'requestKey': 'original-quick', 'exchangeId': 'original-exchange'})
    raw['reviewSnapshot'] = {**original['reviewOf'], 'segments': [{'text': '검토해야 할 원래 답변', 'citations': []}]}
    cl = p.checked_claim(raw['assistant'], raw['assistant']['input'], KEY)
    body = p.attach_context(p.provider_body(cl, raw['policy']), raw, original)
    assert '검토해야 할 원래 답변' in body['messages'][-1]['content']
    assert '기존 기본 답변의 정밀 검토' in body['system']
    raw['reviewSnapshot']['exchangeId'] = 'another-exchange'
    error(lambda: p.attach_context(p.provider_body(cl, raw['policy']), raw, original), 'INVALID_RESPONSE')


def student_context():
    raw = claim(); original = input(); original.update(intent='student_record_draft', studentContext={'studentId': 'student-one'})
    raw['studentIdentity'] = {'studentId': 'student-one', 'schoolStudentKey': '10101', 'name': '시험학생'}
    cl = p.checked_claim(raw['assistant'], raw['assistant']['input'], KEY)
    body = p.attach_context(p.provider_body(cl, raw['policy']), raw, original)
    eq(json.loads(body['messages'][-1]['content'])['authorizedStudent'], raw['studentIdentity'])
    raw['studentIdentity']['studentId'] = 'different-student'
    error(lambda: p.attach_context(p.provider_body(cl, raw['policy']), raw, original), 'INVALID_RESPONSE')


def tier_changed():
    client = Client(); sent = []
    client.value['policy']['model'] = p.ROUTING['models']['review']['id']; client.value['policy']['reservedMicroUsd'] = 280000
    error(lambda: run(client, lambda *_: sent.append(1)), 'KEY_UNAVAILABLE')
    eq(sent, []); assert not client.started


def disabled_readiness():
    class Ready(SettingsClient):
        def rpc(self, name, args):
            if name == 'workhub_ai_server_readiness':
                return p.legacy.public_envelope(SCHOOL, MEMBER, {'available': False, 'reason': 'not_allowed'})
            value = super().rpc(name, args); value['status'] = 'ready'; return value
    result = p.execute({'action': 'readiness', 'memberId': MEMBER}, TOKEN, ENV, Ready())
    eq(result['data'], {'available': False, 'reason': 'not_allowed'})


check('정밀 검토는 서버의 원답변 본문을 포함하고 다른 교환의 본문은 거부한다', review_context)
check('학생 초안은 서버의 해당 학생 번호·이름만 전송하고 다른 학생을 거부한다', student_context)
check('quick 요청에 서버가 Sonnet 정책을 주어도 호출 전에 예약을 해제한다', tier_changed)
check('키·예산 준비가 끝나도 기존 비서 모듈과 권한 판정을 건너뛰지 않는다', disabled_readiness)
check('SQL claim의 사전 계수 상한이 앱과 다르면 거부한다', lambda: error(lambda: p.checked_claim({**claim()['assistant'], 'policy': {**claim()['assistant']['policy'], 'maxInputTokens': 100000}}, claim()['assistant']['input'], KEY), 'INVALID_RESPONSE'))

print(f'\n학교 AI 서버 {PASS} 통과 / {FAIL} 실패')
sys.exit(1 if FAIL else 0)
