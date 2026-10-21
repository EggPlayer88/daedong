"""격리 PG의 실제 봉투를 Python 서버 파서·공급자 입력 조립에 대조한다. 유료 호출 없음."""
import base64
import copy
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/main/api/workhub-ai'))
import _school_policy as p
import _school_settings as settings

rows = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
ENV = {'WORKHUB_AI_ACTIVE_KEY_ID': 'capture-master', 'WORKHUB_AI_KEY_ENCRYPTION_KEYS': json.dumps({'capture-master': base64.b64encode(bytes(range(32))).decode()})}
SECRET = 'sk-ant-capture-only-not-a-live-key'
count = claimed = 0
inputs = {}

for row in rows:
    name, args, raw = row['rpc'], row['args'], row['raw']
    if not isinstance(raw, dict):
        continue
    if name in ('workhub_ai_school_status', 'workhub_ai_school_key_save', 'workhub_ai_school_key_recover', 'workhub_ai_school_key_close') and 'error' in raw:
        assert raw['error']['code'] in ('FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_READY')
        count += 1; continue
    if name == 'workhub_ai_school_status':
        settings.status_result(raw, args[1]); count += 1
    if name in ('workhub_ai_school_key_save', 'workhub_ai_school_key_recover', 'workhub_ai_school_key_close'):
        expected = args[3] if len(args) > 3 else max(0, (raw.get('credentialVersion') or 1) - 1)
        settings.receipt(raw, raw['schoolId'], args[1], args[2], expected); count += 1
    if not name.startswith('workhub_ai_gateway_') or args[1] != 'assistant':
        continue
    actor, _, member, key = args[:4]
    if 'error' in raw:
        try:
            p.unwrap(raw, actor, key)
        except p.CheckError as error:
            assert error.code != 'INVALID_RESPONSE', (name, raw)
            count += 1
        else:
            raise AssertionError('SQL 거절이 성공으로 바뀜')
        continue
    data = p.unwrap(raw, actor, key)
    if name.endswith('_prepare'):
        original = {**args[6], 'quality': args[5], 'reviewOf': args[7]}
        inputs[key] = original
        if data.get('state') == 'claimed':
            # DB 회귀의 고의 가짜 암호문만 같은 학교·판의 합성키로 대체한다. 나머지 실제 봉투는 그대로다.
            value = copy.deepcopy(raw)
            version = value['data']['credential']['version']
            value['data']['credential'] = {'version': version, **p.encrypt_key(raw['schoolId'], version, SECRET, ENV)}
            calls, bodies = [], []
            class Client:
                deadline = time.monotonic() + 45
                def user(self, _): return actor
                def rpc(self, rpc, sent):
                    calls.append((rpc, sent))
                    if rpc.endswith('_prepare'): return value
                    datum = {'started': True} if rpc.endswith('_start') else {'state': 'pending', 'reason': 'provider_unknown'}
                    return {**raw, 'data': datum}
            def provider(body, key_value, _deadline):
                assert key_value == SECRET
                bodies.append(body)
                sources = data['assistant']['sources']
                answer = {'segments': [{'text': '합성 답변', 'sourceKeys': [sources[0]['key']] if sources else []}], 'taskDraft': None}
                return {'response': {'id': 'msg_capture', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 30, 'output_tokens': 20}, 'content': [{'type': 'text', 'text': json.dumps(answer)}]}}
            result = p.execute({'action': 'ask', 'memberId': member, 'requestKey': key, 'input': original}, 'Bearer ' + 'capture-token-' * 3, ENV, Client(), provider, lambda *_: 30)
            assert len(bodies) == 1 and calls[-1][0].endswith('_finish'), calls
            assert calls[-1][1]['p_result']['state'] == 'completed', calls[-1]
            if original['reviewOf'] is not None:
                assert json.loads(bodies[0]['messages'][-1]['content'])['previousAnswerToReview'] == data['reviewSnapshot']
            if original['intent'] == 'student_record_draft':
                assert json.loads(bodies[0]['messages'][-1]['content'])['authorizedStudent'] == data['studentIdentity']
            claimed += 1; count += 1
            continue
    if name.endswith('_start'):
        assert data in ({'started': True}, {'started': False}); count += 1
    elif key in inputs:
        try:
            p.public_result(data.get('response', data), key, inputs[key])
        except p.CheckError as error:
            assert error.code in ('FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'COUNT_FAILED', 'INVALID_INPUT', 'NOT_FOUND', 'KEY_UNAVAILABLE'), (error.code, raw)
        count += 1

assert claimed > 0
print(f'실제 PG → Python {count} 봉투 통과 · claim 공급자입력 {claimed}건(암호문만 합성키 대체) · 실제 공급자 호출 0')
