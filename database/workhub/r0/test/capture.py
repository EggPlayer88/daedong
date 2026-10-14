import json, psycopg2, uuid
c = psycopg2.connect(host='/var/tmp/r0pg', port=55433, dbname='r0', user='authenticator'); c.autocommit = True
cur = c.cursor(); cur.execute('set role authenticated')
cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({'sub': '00000000-0000-0000-0000-000000000001', 'role': 'authenticated'}),))
out = []
def run(label, sql, args=()):
    try:
        cur.execute(sql, args); r = cur.fetchone()[0]; out.append((label, sql % tuple(repr(a) for a in args) if args else sql, 'OK', r)); return r
    except psycopg2.Error as e:
        out.append((label, sql % tuple(repr(a) for a in args) if args else sql, 'ERROR', {'message': e.diag.message_primary, 'details': e.diag.message_detail})); return None
ctx = run('workhub_context', 'select public.workhub_context()')
m = ctx['memberships'][0]['id']
d = {'title': '2학기 학부모 상담 주간', 'description': '', 'location': '각 교실', 'startDate': '2026-10-27', 'endDate': '2026-10-31',
     'allDay': True, 'startTime': '', 'endTime': '', 'visibility': 'school', 'audience': {'all': True, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}}
k = '7b0c1f1e-2d9a-4c55-9a39-1f6f2a3b4c5d'
e = run('workhub_calendar_save (생성)', 'select public.workhub_calendar_save(%s, %s::jsonb)', (m, json.dumps({'draft': d, 'idempotencyKey': k}, ensure_ascii=False)))
run('workhub_calendar_save (같은 번호 재전송 → 같은 결과)', 'select public.workhub_calendar_save(%s, %s::jsonb)', (m, json.dumps({'draft': d, 'idempotencyKey': k}, ensure_ascii=False)))
d2 = dict(d, title='2학기 학부모 상담 주간(연장)', endDate='2026-11-04')
run('workhub_calendar_save (수정)', 'select public.workhub_calendar_save(%s, %s::jsonb)', (m, json.dumps({'draft': d2, 'id': e['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())}, ensure_ascii=False)))
run('workhub_calendar_save (옛 판 → CONFLICT)', 'select public.workhub_calendar_save(%s, %s::jsonb)', (m, json.dumps({'draft': d, 'id': e['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())}, ensure_ascii=False)))
run('workhub_calendar_save (같은 번호·다른 입력 → IDEMPOTENCY_CONFLICT)', 'select public.workhub_calendar_save(%s, %s::jsonb)', (m, json.dumps({'draft': d2, 'idempotencyKey': k}, ensure_ascii=False)))
run('workhub_calendar_list', 'select public.workhub_calendar_list(%s)', (m,))
run('workhub_calendar_get (없는 일정)', 'select public.workhub_calendar_get(%s, %s)', (m, 'no-such-id'))
tk = 'f3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
t = run('workhub_task_mutate (create)', 'select public.workhub_task_mutate(%s, %s::jsonb, %s)', (m, json.dumps({'kind': 'create', 'input': {'title': '평가계획서 제출', 'notes': '교과협의회 회의록 첨부', 'dueDate': '2026-10-31'}}, ensure_ascii=False), tk))
run('workhub_task_mutate (status)', 'select public.workhub_task_mutate(%s, %s::jsonb, %s)', (m, json.dumps({'kind': 'status', 'taskId': t['id'], 'status': 'done', 'expectedVersion': 1}), str(uuid.uuid4())))
run('workhub_task_mutate (update, 옛 판 → CONFLICT)', 'select public.workhub_task_mutate(%s, %s::jsonb, %s)', (m, json.dumps({'kind': 'update', 'taskId': t['id'], 'input': {'title': 'x', 'notes': '', 'dueDate': ''}, 'expectedVersion': 1}), str(uuid.uuid4())))
run('workhub_task_list', 'select public.workhub_task_list(%s)', (m,))
run('workhub_task_get', 'select public.workhub_task_get(%s, %s)', (m, t['id']))
run('다른 학교 소속 id 로 호출', 'select public.workhub_task_list(%s)', ('m-other-school',))
cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({'sub': '00000000-0000-0000-0000-000000000003', 'role': 'authenticated'}),))
run('승인 대기 계정', 'select public.workhub_context()')
json.dump(out, open('/tmp/claude-0/b01/test/rpc_examples.json', 'w'), ensure_ascii=False, indent=1)
