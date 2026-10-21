"""격리 PostgreSQL 운영 조회·진단 응답을 실제 Python 경계와 대조한다. 외부 호출 없음."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/main/api/workhub-ai'))
import _school_operations as operations

rows = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
count = lists = diagnostics = errors = 0
for row in rows:
    name, args, value = row['rpc'], row['args'], row['raw']
    if name not in operations.READ_RPCS:
        continue
    member = args['p_member_id'] if isinstance(args, dict) else args[1]
    if isinstance(value, dict) and 'error' in value:
        try:
            operations.business_result(value)
        except operations.CheckError as problem:
            assert problem.code == value['error']['code'], (name, problem.code)
        else:
            raise AssertionError('거절 응답을 성공으로 해석함')
        errors += 1
    elif name == 'workhub_ai_school_operations':
        cursor = args.get('p_cursor') if isinstance(args, dict) else args[2] if len(args) > 2 else None
        operations.operations_result(value, member, cursor)
        lists += 1
    else:
        operations.diagnostics_source(value, member, value['schoolId'])
        diagnostics += 1
    count += 1

assert lists > 0 and diagnostics > 0, (lists, diagnostics)
print(f'학교 AI 운영 실제 PG → Python {count}건 통과 (목록 {lists}, 내부 진단 {diagnostics}, 업무 거절 {errors}) · 외부 호출 0')
