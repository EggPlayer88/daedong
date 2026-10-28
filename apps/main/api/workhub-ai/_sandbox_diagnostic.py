"""복제 환경에서만 오류 종류·코드 위치를 기록한다. 메시지·입력·키는 남기지 않는다."""
import json
import os
import sys
import traceback
from pathlib import Path


def report(error, env=None, stream=None):
    env = os.environ if env is None else env
    ref = 'vfnemvoszjglfblsrzoh'
    if env.get('VITE_SCHOOL_SANDBOX') != ref or env.get('VITE_SUPABASE_URL', '').rstrip('/') != 'https://' + ref + '.supabase.co':
        return
    frames = [{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
              for frame in traceback.extract_tb(error.__traceback__)[-8:]]
    print(json.dumps({'sandboxDiagnostic': type(error).__name__, 'frames': frames}), file=stream or sys.stderr)
