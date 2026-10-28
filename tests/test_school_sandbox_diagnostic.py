"""복제 서버의 진단에는 비밀값·사용자 입력을 기록하지 않는다."""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/main/api/workhub-ai'))
from _sandbox_diagnostic import report

REF = 'vfnemvoszjglfblsrzoh'
ENV = {'VITE_SCHOOL_SANDBOX': REF, 'VITE_SUPABASE_URL': 'https://' + REF + '.supabase.co'}
PASS = 0

def failure():
    secret = 'synthetic-private-key-and-prompt'
    raise ValueError(secret)

try:
    failure()
except ValueError as error:
    for env in ({}, {'VITE_SCHOOL_SANDBOX': REF},
                {**ENV, 'VITE_SUPABASE_URL': 'https://production.example.com'},
                {**ENV, 'VITE_SCHOOL_SANDBOX': 'other'}):
        stream = io.StringIO()
        report(error, env, stream)
        assert stream.getvalue() == ''
        PASS += 1
        print('  ✓ 운영·다른 주소에서는 진단을 남기지 않음 ' + str(PASS))
    stream = io.StringIO()
    report(error, ENV, stream)
    value = json.loads(stream.getvalue())
    assert value['sandboxDiagnostic'] == 'ValueError'
    assert value['frames'][-1]['function'] == 'failure'
    assert set(value['frames'][-1]) == {'file', 'line', 'function'}
    assert 'synthetic-private' not in stream.getvalue()
    assert str(Path.home()) not in stream.getvalue()
    PASS += 1
    print('  ✓ 시험 환경도 오류 종류·코드 위치만 기록하고 비밀값은 제외')

print(f'PASS {PASS} / FAIL 0')
