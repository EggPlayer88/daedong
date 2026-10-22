"""학교 AI 운영 조회·무호출 진단 경계. 학교·키·HTTP 응답은 모두 합성이다."""
import base64
import copy
import http.client
import importlib.util
import json
import sys
import threading
from datetime import datetime, timezone
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / 'apps/main/api/workhub-ai'
sys.path.insert(0, str(API))
import _school_operations as operations
import _school_policy as policy

spec = importlib.util.spec_from_file_location('school_operations_route', API / 'operations.py')
route = importlib.util.module_from_spec(spec); spec.loader.exec_module(route)

TOKEN = 'Bearer ' + 'synthetic-token-' * 3
ACTOR, MEMBER, SCHOOL = '11111111-1111-4111-8111-111111111111', 'member-one', 'school-one'
SECRET = 'sk-ant-only-synthetic-school-secret-1234'
ENV = {'SUPABASE_URL': 'https://' + 'a' * 20 + '.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'sb_secret_synthetic_service_only',
       'WORKHUB_AI_ACTIVE_KEY_ID': 'master-one', 'WORKHUB_AI_KEY_ENCRYPTION_KEYS': json.dumps({'master-one': base64.b64encode(bytes(range(32))).decode()})}
NOW = datetime(2026, 10, 21, 3, tzinfo=timezone.utc)
STAMP = '2026-10-21T03:00:00.000Z'
PASS = FAIL = 0


def check(name, run):
    global PASS, FAIL
    try:
        run(); PASS += 1; print('  ✓ ' + name)
    except Exception as problem:
        FAIL += 1; print('  ✗ ' + name + ': ' + repr(problem))
        import traceback
        traceback.print_exc()


def eq(actual, expected):
    assert actual == expected, (actual, expected)


def error(run, code):
    try:
        run()
    except operations.CheckError as problem:
        eq(problem.code, code); return
    raise AssertionError('예외 없음: ' + code)


def aggregate():
    return dict(requests=0, settledMicroUsd=0, reservedMicroUsd=0, states={state: 0 for state in operations.STATES})


def listing(count=2):
    rows = [dict(id='request-' + str(100 - i), requestKey='request-key-' + str(i), feature='assistant', quality='quick', state='completed',
                 createdAt=f'2026-10-21T01:00:{59-i:02d}.000Z', updatedAt=STAMP, model='claude-haiku-5-5',
                 reservedMicroUsd=0, settledMicroUsd=5, usage=dict(inputTokens=10, outputTokens=8), errorCode=None, observedOverage=False) for i in range(count)]
    totals = aggregate(); totals.update(requests=count, settledMicroUsd=count * 5); totals['states']['completed'] = count
    groups = [dict(**aggregate(), feature=feature, quality=quality) for feature in operations.FEATURES for quality in operations.QUALITIES]
    groups[0].update(copy.deepcopy(totals))
    return dict(contract='assistant.operations.v1', schoolId=SCHOOL, memberId=MEMBER, checkedAt=STAMP, month='2026-10', timeZone='Asia/Seoul', asOf=STAMP,
                totals=totals, groups=groups, unresolved=dict(requests=0, reservedMicroUsd=0, previousMonthRequests=0, previousMonthReservedMicroUsd=0, oldestCreatedAt=None, observedOverageRequests=0),
                items=rows, nextCursor=None)


def status():
    return dict(contract='assistant.school.v1', schoolId=SCHOOL, memberId=MEMBER, policyVersion=1, canManage=True,
                credential=dict(configured=True, version=1, maskedSuffix='1234', updatedAt=STAMP),
                budget=dict(month='2026-10', timeZone='Asia/Seoul', currency='USD', limitMicroUsd=100000000, settledMicroUsd=0, reservedMicroUsd=0, availableMicroUsd=100000000),
                models={tier: {field: row[field] for field in ('id', 'label')} for tier, row in policy.ROUTING['models'].items()}, status='ready')


def source():
    return dict(contract='assistant.school.diagnostics.v1', schoolId=SCHOOL, memberId=MEMBER, policyVersion=1, enabled=True, overageBlocked=False,
                credential=dict(version=1, **policy.encrypt_key(SCHOOL, 1, SECRET, ENV)))


class Client:
    def __init__(self):
        self.calls = []; self.status = status(); self.source = source(); self.list = listing(); self.reject = {}

    def user(self, token):
        self.calls.append(('user', token))
        if 'user' in self.reject:
            raise operations.CheckError(self.reject['user'], 401)
        return ACTOR

    def rpc(self, name, args):
        self.calls.append((name, copy.deepcopy(args)))
        if name in self.reject:
            raise operations.CheckError(self.reject[name])
        if name == 'workhub_ai_school_status':
            return copy.deepcopy(self.status)
        if name == 'workhub_ai_school_diagnostics':
            return copy.deepcopy(self.source)
        if name == 'workhub_ai_school_operations':
            return copy.deepcopy(self.list)
        raise AssertionError('허용하지 않은 RPC: ' + name)


def run(client=None, action='diagnostics', env=None):
    payload = dict(action=action, memberId=MEMBER)
    if action == 'list':
        payload['cursor'] = None
    return operations.execute(payload, TOKEN, ENV if env is None else env, client or Client(), lambda: NOW)


def check_map(value):
    return {row['id']: (row['ok'], row['code']) for row in value['checks']}


check('정상 운영 메타는 비용·상태 합계를 검증하고 원문 없이 반환한다', lambda: eq(run(action='list'), listing()))


def request_boundaries():
    for value in [None, [], {}, dict(action='list', memberId=MEMBER), dict(action='diagnostics', memberId=MEMBER, schoolId='other'),
                  dict(action='diagnostics', memberId=MEMBER, apiKey=SECRET), dict(action='save', memberId=MEMBER),
                  dict(action='list', memberId=MEMBER, cursor=dict(month='2026-13', asOf=STAMP, afterId='x')),
                  dict(action='list', memberId=MEMBER, cursor=dict(month='2026-10', asOf=STAMP, afterId='x', limit=200))]:
        error(lambda: operations.request(value), 'INVALID_INPUT')
    eq(operations.request(dict(action='list', memberId=MEMBER, cursor=None)), dict(action='list', memberId=MEMBER, cursor=None))


check('실제 요청 파서는 학교·키·쓰기 action·임의 페이지 크기를 받지 않는다', request_boundaries)


def list_mutations():
    mutations = [lambda x: x.update(memberId='other'), lambda x: x.update(prompt='학생 내용'), lambda x: x['items'][0].update(actorUserId=ACTOR),
                 lambda x: x['items'][0].update(ciphertext='secret'), lambda x: x['items'][0].update(errorCode='원문 오류'),
                 lambda x: x['totals']['states'].update(completed=100), lambda x: x['groups'].reverse(),
                 lambda x: x['groups'][0].update(settledMicroUsd=9), lambda x: x['items'][1].update(id=x['items'][0]['id']),
                 lambda x: x['items'][0].update(usage=dict(inputTokens=-1, outputTokens=3)), lambda x: x.update(timeZone='bad-zone'),
                 lambda x: x.update(month='2026-11'), lambda x: x.update(asOf='2026-10-22T03:00:00.000Z'),
                 lambda x: x['items'][0].update(model='provider model\nsecret'), lambda x: x['items'][0].update(observedOverage=1),
                 lambda x: x['items'][0].update(reservedMicroUsd=14000), lambda x: x['items'][0].update(requestKey='short')]
    for change in mutations:
        value = listing(); change(value)
        error(lambda: operations.operations_result(value, MEMBER), 'INVALID_RESPONSE')


check('추가 민감 필드·합계 변조·중복 ID·잘못된 월/모델/사용량은 목록 전체를 거부한다', list_mutations)


def pagination():
    value = listing(25); value['nextCursor'] = dict(month=value['month'], asOf=value['asOf'], afterId=value['items'][-1]['id'])
    eq(operations.operations_result(value, MEMBER), value)
    prior = dict(value['nextCursor'])
    page = listing(1); page['items'][0]['id'] = 'later-request'
    eq(operations.operations_result(page, MEMBER, prior), page)
    for field, bad in [('month', '2026-11'), ('asOf', '2026-10-21T02:00:00.000Z')]:
        broken = dict(prior); broken[field] = bad
        error(lambda: operations.operations_result(page, MEMBER, broken), 'INVALID_RESPONSE')
    value['nextCursor']['afterId'] = 'not-last'
    error(lambda: operations.operations_result(value, MEMBER), 'INVALID_RESPONSE')


check('다음 페이지는 같은 월·상한 시각과 마지막 행 커서를 유지해야 한다', pagination)


def precise_timestamps():
    value = listing()
    value['items'][1]['createdAt'] = value['items'][0]['createdAt']
    value['items'][1]['id'] = 'z-higher-id'
    eq(operations.operations_result(value, MEMBER), value)
    for bad in ['2026-10-21T03:00:00Z', '2026-02-30T03:00:00.000Z', '2026-10-21T03:00:00.000+00:00']:
        error(lambda: operations.utc_time(bad), 'INVALID_RESPONSE')


check('같은 표시 밀리초의 원시 정렬을 추측하지 않고 canonical UTC 형식만 수용한다', precise_timestamps)


def successful_diagnostics():
    client = Client(); result = run(client); checks = check_map(result)
    eq([item['id'] for item in result['checks']], ['authorization', 'serviceConfiguration', 'database', 'policy', 'schoolKey', 'serverEncryption', 'keyDecryption', 'providerConnection'])
    eq(checks['keyDecryption'], (True, 'KEY_DECRYPTABLE')); eq(checks['providerConnection'], (None, 'NOT_CHECKED'))
    eq(result['providerContacted'], False); eq(result['checkedAt'], STAMP)
    for secret in [SECRET, ACTOR, 'master-one', 'ciphertext', 'maskedSuffix', ENV['SUPABASE_SERVICE_ROLE_KEY']]:
        assert secret not in json.dumps(result)
    eq([name for name, _ in client.calls], ['user', 'workhub_ai_school_status', 'workhub_ai_school_diagnostics'])


check('관리자 진단은 같은 학교 키 복호화만 확인하며 공급자 접속은 미확인으로 표시한다', successful_diagnostics)


def no_authority():
    for code in ['UNAUTHENTICATED', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP']:
        client = Client(); client.reject['user' if code == 'UNAUTHENTICATED' else 'workhub_ai_school_status'] = code
        error(lambda: run(client), code)
        assert not any(name.endswith('_diagnostics') for name, _ in client.calls)
    client = Client(); client.status['canManage'] = False
    error(lambda: run(client, env={}), 'FORBIDDEN')
    eq(len(client.calls), 2)


check('로그인·현재 소속·학교 관리자 확인 실패 시 환경 진단도 반환하지 않는다', no_authority)


def service_not_configured():
    for env in [{}, {**ENV, 'SUPABASE_SERVICE_ROLE_KEY': ''}, {**ENV, 'SUPABASE_URL': 'https://elsewhere.example'}]:
        error(lambda: operations.execute(dict(action='diagnostics', memberId=MEMBER), TOKEN, env), 'NOT_READY')
    error(lambda: operations.execute(dict(action='diagnostics', memberId=MEMBER), None, ENV), 'UNAUTHENTICATED')


check('서버 서비스 설정이 없어 인증할 수 없으면 진단 정보를 만들지 않는다', service_not_configured)


def installation_fallback():
    client = Client(); client.reject['workhub_ai_school_diagnostics'] = 'NOT_READY'
    result = check_map(run(client))
    eq(result['database'], (None, 'SQL_READ_UNAVAILABLE')); eq(result['policy'], (None, 'SQL_READ_UNAVAILABLE'))
    eq(result['schoolKey'], (True, 'KEY_PRESENT')); eq(result['keyDecryption'], (None, 'SQL_READ_UNAVAILABLE'))
    for code in ['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'FORBIDDEN']:
        client.reject['workhub_ai_school_diagnostics'] = code
        error(lambda: run(client), code)
    client.reject['workhub_ai_school_status'] = 'NOT_READY'
    error(lambda: run(client), 'NOT_READY')


check('신규 SQL 미준비만 확인된 관리자에게 부분 안내하고 시간초과·권한 오류는 숨기지 않는다', installation_fallback)


def policy_states():
    for patch, expected in [(dict(policyVersion=0), 'POLICY_MISSING'), (dict(enabled=False), 'POLICY_DISABLED'), (dict(overageBlocked=True), 'OVERAGE_BLOCKED')]:
        client = Client(); client.source.update(patch)
        eq(check_map(run(client))['policy'], (False, expected))
    client = Client(); client.source['credential'] = None
    value = check_map(run(client)); eq(value['schoolKey'], (False, 'KEY_MISSING')); eq(value['keyDecryption'], (None, 'KEY_MISSING'))


check('정책 누락·중지·초과 차단·학교 키 미등록을 성공과 구분한다', policy_states)


def encryption_states():
    for env in [{}, {**ENV, 'WORKHUB_AI_ACTIVE_KEY_ID': 'not-in-keyring'}, {**ENV, 'WORKHUB_AI_KEY_ENCRYPTION_KEYS': '{broken'}]:
        result = check_map(run(env=env)); eq(result['serverEncryption'], (False, 'ENCRYPTION_CONFIG_INVALID')); eq(result['keyDecryption'], (None, 'ENCRYPTION_CONFIG_INVALID'))
    changed = dict(ENV); changed['WORKHUB_AI_KEY_ENCRYPTION_KEYS'] = json.dumps({'master-one': base64.b64encode(bytes(reversed(range(32)))).decode()})
    eq(check_map(run(env=changed))['keyDecryption'], (False, 'KEY_UNAVAILABLE'))
    client = Client(); client.source['credential']['iv'] = base64.b64encode(b'x' * 12).decode()
    eq(check_map(run(client))['keyDecryption'], (False, 'KEY_UNAVAILABLE'))


check('마스터 키 누락·불일치·변조 암호문을 구분하며 기존 전역 키를 대체 사용하지 않는다', encryption_states)


def rotation():
    env = dict(ENV); keys = json.loads(env['WORKHUB_AI_KEY_ENCRYPTION_KEYS']); keys['new-master'] = base64.b64encode(bytes(reversed(range(32)))).decode()
    env.update(WORKHUB_AI_ACTIVE_KEY_ID='new-master', WORKHUB_AI_KEY_ENCRYPTION_KEYS=json.dumps(keys))
    eq(check_map(run(env=env))['keyDecryption'], (True, 'KEY_DECRYPTABLE'))


check('회전 후 이전 학교 키의 마스터가 남아 있으면 정확한 키 판으로 복호화한다', rotation)


def diagnostics_scope():
    for field, value in [('schoolId', 'another-school'), ('memberId', 'another-member'), ('apiKey', SECRET), ('enabled', 'true')]:
        client = Client(); client.source[field] = value
        error(lambda: run(client), 'INVALID_RESPONSE')
    client = Client(); client.source['credential']['extra'] = SECRET
    error(lambda: run(client), 'INVALID_RESPONSE')


check('다른 학교/소속의 진단·추가 암호문 필드는 공개 응답으로 흘리지 않는다', diagnostics_scope)


class Response:
    def __init__(self, value=None, status=200, headers=None):
        self.status = status; self.body = json.dumps(value).encode(); self.at = 0; self.headers = headers or {}
    def getheader(self, name, default=None):
        return self.headers.get(name, default)
    def read(self, size):
        return self.read1(size)
    def read1(self, size):
        part = self.body[self.at:self.at + size]; self.at += len(part); return part


class Connection:
    sock = None
    def __init__(self, response):
        self.response = response; self.calls = []; self.closed = False
    def request(self, method, path, body=None, headers=None):
        self.calls.append((method, path, body, headers))
    def getresponse(self):
        if isinstance(self.response, Exception):
            raise self.response
        return self.response
    def close(self):
        self.closed = True


def transport():
    queue = [Response(dict(id=ACTOR)), Response(status()), Response(source())]; sent = []
    def factory(host, port, timeout):
        eq(host, 'a' * 20 + '.supabase.co'); eq(port, 443); assert 0 < timeout <= 12
        conn = Connection(queue.pop(0)); sent.append(conn); return conn
    client = operations.OperationsClient(environ=ENV, connection_factory=factory)
    value = run(client); eq(check_map(value)['keyDecryption'], (True, 'KEY_DECRYPTABLE'))
    paths = [conn.calls[0][1] for conn in sent]
    eq(paths, ['/auth/v1/user', '/rest/v1/rpc/workhub_ai_school_status', '/rest/v1/rpc/workhub_ai_school_diagnostics'])
    assert all(conn.closed for conn in sent)
    for conn in sent[1:]:
        body = json.loads(conn.calls[0][2]); eq(body, dict(p_actor_user_id=ACTOR, p_member_id=MEMBER))


check('실제 Supabase HTTP 어댑터는 검증한 actor와 현재 소속의 조회 RPC만 보낸다', transport)


def transport_errors():
    for reply, expected in [(Response(dict(error=dict(code='FORBIDDEN'))), 'FORBIDDEN'), (Response(dict(error=dict(code='NOT_READY'))), 'NOT_READY'),
                            (Response(dict(error=dict(code='SECRET ' + SECRET))), 'INVALID_RESPONSE'), (Response({}, 404), 'NOT_READY'),
                            (Response({}, 500), 'RESULT_UNKNOWN'), (TimeoutError(SECRET), 'RESULT_UNKNOWN'),
                            (Response({}, headers={'Content-Length': '9999999'}), 'INVALID_RESPONSE'), (Response({}, headers={'Content-Length': '200'}), 'RESULT_UNKNOWN')]:
        conn = Connection(reply); client = operations.OperationsClient(environ=ENV, connection_factory=lambda *_args, **_kwargs: conn)
        error(lambda: client.rpc('workhub_ai_school_operations', dict(p_actor_user_id=ACTOR, p_member_id=MEMBER, p_cursor=None)), expected)
        eq(len(conn.calls), 1); eq(conn.closed, True)


check('실제 RPC 전송은 좁은 오류만 공개하고 시간초과·과대/잘린 본문을 재시도하지 않는다', transport_errors)


def expired_deadline():
    sent = []; clock = [0]
    client = operations.OperationsClient(environ=ENV, clock=lambda: clock[0], connection_factory=lambda *_a, **_k: sent.append(1))
    clock[0] = 100
    error(lambda: client.rpc('workhub_ai_school_operations', {}), 'RESULT_UNKNOWN'); eq(sent, [])


check('전체 읽기 기한이 지난 뒤 늦은 RPC를 시작하지 않는다', expired_deadline)


def actual_http():
    original = route.execute; calls = []; mode = ['ok']
    def execute(payload, token):
        calls.append((payload, token))
        if mode[0] == 'unexpected':
            raise RuntimeError(SECRET)
        return operations.execute(payload, token, ENV, Client(), lambda: NOW)
    route.execute = execute
    server = HTTPServer(('127.0.0.1', 0), route.handler); worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    try:
        def send(body=None, headers=None, method='POST'):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            try:
                connection.request(method, '/api/workhub-ai/operations', body=body, headers=headers or {'Content-Type': 'application/json', 'Authorization': TOKEN})
                result = connection.getresponse(); return result.status, result.read(), dict(result.getheaders())
            finally:
                connection.close()
        value = send(json.dumps(dict(action='diagnostics', memberId=MEMBER)))
        eq(value[0], 200); eq(value[2]['Cache-Control'], 'no-store'); eq(value[2]['X-Content-Type-Options'], 'nosniff')
        eq(check_map(json.loads(value[1]))['providerConnection'], (None, 'NOT_CHECKED'))
        eq(send(json.dumps(dict(action='list', memberId=MEMBER, cursor=None)))[0], 200)
        # 잘못된 Content-Type은 본문을 읽기 전에 거절해야 한다. 길이만 선언하고
        # 보내지 않아 Windows에서 응답과 미수신 본문으로 생기는 TCP reset 경합을 피한다.
        # 길이는 정상 범위(2)로 유지하므로 길이 오류로 이 검사를 통과할 수 없다.
        for body, headers in [('{"action":"list","action":"diagnostics"}', None), (None, {'Content-Type': 'text/plain', 'Content-Length': '2'}), ('', None),
                              (None, {'Content-Type': 'application/json', 'Content-Length': '8193'})]:
            eq(send(body, headers)[0], 400)
        eq(send(method='GET')[0], 405)
        mode[0] = 'unexpected'; value = send(json.dumps(dict(action='diagnostics', memberId=MEMBER)))
        eq(value[0], 503); eq(json.loads(value[1]), dict(error=dict(code='RESULT_UNKNOWN'))); assert SECRET.encode() not in value[1]
        eq(len(calls), 3)
    finally:
        server.shutdown(); server.server_close(); worker.join(); route.execute = original


check('실제 로컬 HTTP로 GET·중복 JSON·본문 한도·캐시 금지와 예외 비밀 비노출을 확인한다', actual_http)

print(f'\n학교 AI 운영 API {PASS} 통과 / {FAIL} 실패')
sys.exit(1 if FAIL else 0)
