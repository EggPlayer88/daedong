# R0 정상·거부 시험 (임시 PostgreSQL 17.6 + Supabase 흉내). 운영과 무관.
import json, os, sys, threading, time, uuid
import psycopg2, psycopg2.extras

# 시험 서버 위치는 env.sh 가 정한다(유닉스 소켓 폴더·포트). 직접 실행할 때도 같은 변수를 쓴다.
HOST = os.environ['R0_PGHOST']; PORT = int(os.environ.get('R0_PG_PORT', '55433')); DB = 'r0'
U1 = '00000000-0000-0000-0000-000000000001'  # 첫 관리자(초기 설정으로 연결, 일정 관리자)
U2 = '00000000-0000-0000-0000-000000000002'  # 일반 교사(legacy teacher, 승인됨)
U3 = '00000000-0000-0000-0000-000000000003'  # 승인 대기 교사
U5 = '00000000-0000-0000-0000-000000000005'  # 승인 대기 superadmin
U7 = '00000000-0000-0000-0000-000000000007'  # 다른 학교 superadmin
U8 = '00000000-0000-0000-0000-000000000008'  # 소속 정지 superadmin
U9 = '00000000-0000-0000-0000-000000000009'  # 역할 없는 superadmin (같은 학교)
U10 = '00000000-0000-0000-0000-000000000010'  # 계정 연결 전 superadmin

results = []

def admin():
    c = psycopg2.connect(host=HOST, port=PORT, dbname=DB, user='supabase_admin'); c.autocommit = True; return c

def api(uid=None, role='authenticated'):
    """PostgREST 와 같은 경로: authenticator 로그인 → 역할 전환 → JWT claims 설정."""
    c = psycopg2.connect(host=HOST, port=PORT, dbname=DB, user='authenticator'); c.autocommit = True
    cur = c.cursor()
    cur.execute(f'set role {role}')
    claims = {'role': role}
    if uid: claims['sub'] = uid
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    return c

def call(conn, sql, args=()):
    cur = conn.cursor()
    cur.execute(sql, args)
    row = cur.fetchone()
    return row[0] if row else None

def err(conn, sql, args=()):
    try:
        call(conn, sql, args)
        return ('OK', None)
    except psycopg2.Error as e:
        conn.rollback() if not conn.autocommit else None
        return (e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e), e.diag.message_detail)

def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -- {info}'))

def scalar(sql, args=()):
    a = admin(); v = call(a, sql, args); a.close(); return v

def draft(title='전체 회의', **kw):
    d = {'title': title, 'description': '', 'location': '', 'startDate': '2026-10-20', 'endDate': '2026-10-20',
         'allDay': True, 'startTime': '', 'endTime': '', 'visibility': 'school',
         'audience': {'all': True, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}}
    d.update(kw); return d

def save(conn, member, cmd):
    return call(conn, 'select public.workhub_calendar_save(%s, %s::jsonb)', (member, json.dumps(cmd)))

def mutate(conn, member, cmd, key):
    return call(conn, 'select public.workhub_task_mutate(%s, %s::jsonb, %s)', (member, json.dumps(cmd), key))

def counts():
    return scalar("""select jsonb_build_object('events',(select count(*) from workhub.events),
      'revisions',(select count(*) from workhub.event_revisions),'tasks',(select count(*) from workhub.tasks),
      'receipts',(select count(*) from workhub.idempotency_receipts),'audit',(select count(*) from workhub.audit_events),
      'outbox',(select count(*) from workhub.outbox),'sets',(select count(*) from workhub.audience_sets))""")

# ---------------------------------------------------------------- 시험용 추가 자료
def fixtures():
    a = admin(); cur = a.cursor()
    cur.execute("""
    insert into auth.users(id,email,raw_user_meta_data) values
      ('00000000-0000-0000-0000-000000000007','g@x.kr','{"full_name":"타학교관리자"}'),
      ('00000000-0000-0000-0000-000000000008','h@x.kr','{"full_name":"정지관리자"}'),
      ('00000000-0000-0000-0000-000000000009','i@x.kr','{"full_name":"역할없음"}'),
      ('00000000-0000-0000-0000-000000000010','j@x.kr','{"full_name":"미연결"}');
    update public.users set role='superadmin', is_active=true where id in
      ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008',
       '00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010');
    insert into workhub.schools(id, code, name, school_level, grade_count, status) values ('school-2','other-ms','다른중학교','middle',3,'active');
    insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
    select 'acc-'||right(id,2), id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users
     where id in ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000007',
                  '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
    insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values
      ('m-02', (select id from workhub.schools where code='daedong-ms'), 'acc-02', 'active', 'teacher', '2026-03-01', now()),
      ('m-05', (select id from workhub.schools where code='daedong-ms'), 'acc-05', 'active', 'teacher', '2026-03-01', now()),
      ('m-07', 'school-2', 'acc-07', 'active', 'teacher', '2026-03-01', now()),
      ('m-08', (select id from workhub.schools where code='daedong-ms'), 'acc-08', 'suspended', 'teacher', '2026-03-01', now()),
      ('m-09', (select id from workhub.schools where code='daedong-ms'), 'acc-09', 'active', 'teacher', '2026-03-01', now());
    """)
    a.close()

def main():
    fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    s1 = scalar("select id from workhub.schools where code='daedong-ms'")

    # ------------------------------------------------------------ 접근 거부
    c = api(None, 'anon')
    check('T01 anon 은 호환 함수 실행 불가', 'permission denied' in err(c, 'select public.workhub_context()')[0])
    check('T01b anon 은 workhub 표 접근 불가', 'permission denied' in err(c, 'select * from workhub.events')[0])
    c = api(None)
    check('T02 로그인 없는 authenticated → FORBIDDEN', err(c, 'select public.workhub_context()')[0] == 'FORBIDDEN')
    for uid, label in [(U2, '일반 교사'), (U3, '승인 대기 교사'), (U5, '승인 대기 superadmin')]:
        c = api(uid)
        check(f'T03 {label} → FORBIDDEN (context)', err(c, 'select public.workhub_context()')[0] == 'FORBIDDEN')
    c = api(U2); check('T03b 일반 교사 → FORBIDDEN (일정 목록, 소속 있어도)', err(c, "select public.workhub_calendar_list('m-02')")[0] == 'FORBIDDEN')
    c = api(U5); check('T03c 승인 대기 superadmin → FORBIDDEN (저장)', err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', ('m-05', json.dumps({'draft': draft(), 'idempotencyKey': str(uuid.uuid4())})))[0] == 'FORBIDDEN')
    c = api(U1)
    check('T04 authenticated 도 workhub 표 직접 접근 불가', 'permission denied' in err(c, 'select * from workhub.events')[0])
    check('T04b authenticated 는 초기 설정 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.bootstrap_first_school('{}'::jsonb)")[0])
    check('T04c authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.legacy_gate(false)")[0])
    c = api(None, 'service_role')
    check('T04d service_role 도 호환 함수 실행 불가', 'permission denied' in err(c, 'select public.workhub_context()')[0])

    # ------------------------------------------------------------ 맥락
    c = api(U10); ctx = call(c, 'select public.workhub_context()')
    check('T05 계정 연결 전 superadmin → 빈 맥락', ctx['schools'] == [] and ctx['memberships'] == [] and len(ctx['basisDate']) == 10, ctx)
    c = api(U1); ctx = call(c, 'select public.workhub_context()')
    me = [m for m in ctx['memberships'] if m['id'] == m1]
    check('T06 관리자 맥락: 학교 1개(다른 학교 안 보임)', [s['id'] for s in ctx['schools']] == [s1], ctx['schools'])
    check('T06b 본인 소속 role=calendar_manager, 무기한=9999-12-31, userId=Auth UID',
          me and me[0]['role'] == 'calendar_manager' and me[0]['validThrough'] == '9999-12-31' and me[0]['userId'] == U1, me)
    m9 = [m for m in ctx['memberships'] if m['id'] == 'm-09']
    m8 = [m for m in ctx['memberships'] if m['id'] == 'm-08']
    check('T06c 역할 없는 교사 role=teacher, 정지 소속 active=false', m9 and m9[0]['role'] == 'teacher' and m8 and m8[0]['active'] is False)
    check('T06d 다른 학교 소속(m-07) 안 보임', all(m['schoolId'] == s1 for m in ctx['memberships']))
    lab = ctx['schoolLabels'][s1]
    check('T06e 학년 라벨 1~3학년, 과목 빈 배열', [g['name'] for g in lab['gradeIds']] == ['1학년', '2학년', '3학년'] and lab['subjectIds'] == [], lab)
    want_keys = {'id', 'schoolId', 'userId', 'name', 'role', 'active', 'validFrom', 'validThrough', 'departmentIds', 'gradeIds', 'subjectIds'}
    check('T06f 소속 DTO 키가 앱 계약과 같음', all(set(m) == want_keys for m in ctx['memberships']), [set(m) ^ want_keys for m in ctx['memberships']])

    # ------------------------------------------------------------ 일정 정상 왕복
    before = counts()
    k1 = str(uuid.uuid4())
    e = save(c, m1, {'draft': draft(), 'idempotencyKey': k1})
    check('T10 일정 생성 version=1, 작성자=본인 소속', e['version'] == 1 and e['authorMemberId'] == m1 and e['schoolId'] == s1, e)
    after = counts()
    check('T10b 생성 1건 = 일정1·이력1·접수증1·감사1·outbox1·대상1',
          all(after[k] - before[k] == v for k, v in {'events': 1, 'revisions': 1, 'receipts': 1, 'audit': 1, 'outbox': 1, 'sets': 1}.items()), (before, after))
    want_ev = {'id', 'schoolId', 'authorMemberId', 'version', 'updatedAt', 'title', 'description', 'location', 'startDate', 'endDate',
               'allDay', 'startTime', 'endTime', 'visibility', 'audience'}
    check('T10c 일정 DTO 키가 앱 계약과 같음', set(e) == want_ev, set(e) ^ want_ev)
    check('T10d updatedAt 은 UTC ISO(Z)', e['updatedAt'].endswith('Z'), e['updatedAt'])
    lst = call(c, 'select public.workhub_calendar_list(%s)', (m1,))
    check('T11 목록에 보임', any(x['id'] == e['id'] for x in lst))
    check('T11b 단건 조회', call(c, 'select public.workhub_calendar_get(%s,%s)', (m1, e['id']))['id'] == e['id'])

    # 같은 요청 번호 재전송(응답 유실 후 재시도)
    b2 = counts()
    e2 = save(c, m1, {'draft': draft(), 'idempotencyKey': k1})
    check('T12 같은 번호·같은 입력 재전송 → 같은 일정, 새로 만들지 않음', e2['id'] == e['id'] and counts() == b2, (e2, counts(), b2))
    # 앱의 '현재 내용으로 바꾸기' 경로처럼 draft 에 여분 키가 있어도 무시
    d_extra = dict(draft(), id=e['id'], version=1, updatedAt='x', schoolId=s1)
    e3 = save(c, m1, {'draft': d_extra, 'idempotencyKey': k1})
    check('T12b draft 의 여분 키는 무시(같은 지문)', e3['id'] == e['id'] and counts() == b2)
    r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps({'draft': draft('다른 제목'), 'idempotencyKey': k1})))
    check('T13 같은 번호·다른 입력 → IDEMPOTENCY_CONFLICT, 아무것도 안 바뀜', r[0] == 'IDEMPOTENCY_CONFLICT' and counts() == b2, r)

    # 수정·판 충돌
    ku = str(uuid.uuid4())
    u = save(c, m1, {'draft': draft('전체 회의(변경)'), 'id': e['id'], 'expectedVersion': 1, 'idempotencyKey': ku})
    check('T14 수정 → version=2', u['version'] == 2 and u['title'] == '전체 회의(변경)', u)
    b3 = counts()
    u2 = save(c, m1, {'draft': draft('전체 회의(변경)'), 'id': e['id'], 'expectedVersion': 1, 'idempotencyKey': ku})
    check('T15 수정 응답 유실 후 같은 번호 재시도 → version 2 그대로(3 아님)', u2['version'] == 2 and counts() == b3, u2)
    r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps({'draft': draft('늦은 수정'), 'id': e['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())})))
    det = json.loads(r[1]) if r[1] else {}
    check('T16 옛 판으로 수정 → CONFLICT + 현재 원본(version 2) 동봉', r[0] == 'CONFLICT' and det.get('version') == 2 and det.get('title') == '전체 회의(변경)', r)
    check('T16b 충돌은 아무것도 남기지 않음', counts() == b3)

    # 시각 있는 일정: 학교 시간대 저장
    t = save(c, m1, {'draft': draft('수업 공개', allDay=False, startTime='09:00', endTime='09:45'), 'idempotencyKey': str(uuid.uuid4())})
    utc = scalar("select to_char(starts_at at time zone 'UTC','HH24:MI') from workhub.events where id=%s", (t['id'],))
    check('T17 09:00(서울) → 00:00 UTC 저장, DTO 는 09:00', utc == '00:00' and t['startTime'] == '09:00' and t['endTime'] == '09:45', (utc, t))

    # 입력 거부
    bad = [('빈 제목', {'draft': draft('   '), 'idempotencyKey': str(uuid.uuid4())}),
           ('모르는 명령 키', {'draft': draft(), 'idempotencyKey': str(uuid.uuid4()), 'x': 1}),
           ('짧은 요청 번호', {'draft': draft(), 'idempotencyKey': 'abc'}),
           ('끝날이 시작보다 앞', {'draft': draft(startDate='2026-10-21', endDate='2026-10-20'), 'idempotencyKey': str(uuid.uuid4())}),
           ('없는 날짜', {'draft': draft(startDate='2026-02-30', endDate='2026-02-30'), 'idempotencyKey': str(uuid.uuid4())}),
           ('생성인데 expectedVersion', {'draft': draft(), 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())}),
           ('대상 없음', {'draft': draft(visibility='audience', audience={'all': False, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}), 'idempotencyKey': str(uuid.uuid4())}),
           ('다른 학교 교사 포함', {'draft': draft(visibility='audience', audience={'all': False, 'groups': [], 'includeMemberIds': ['m-07'], 'excludeMemberIds': []}), 'idempotencyKey': str(uuid.uuid4())})]
    b4 = counts()
    for label, cmd in bad:
        r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps(cmd)))
        check(f'T18 입력 거부: {label} → INVALID_INPUT', r[0] == 'INVALID_INPUT', r)
    check('T18b 거부는 아무것도 남기지 않음', counts() == b4)

    # ------------------------------------------------------------ 다른 학교·정지·소속 위장
    c7 = api(U7)
    check('T20 다른 학교 관리자가 우리 소속 id 로 호출 → INACTIVE_MEMBERSHIP', err(c7, 'select public.workhub_calendar_list(%s)', (m1,))[0] == 'INACTIVE_MEMBERSHIP')
    check('T20b 다른 학교 관리자 자기 소속으로 우리 일정 조회 → NOT_FOUND', err(c7, 'select public.workhub_calendar_get(%s,%s)', ('m-07', e['id']))[0] == 'NOT_FOUND')
    r = err(c7, 'select public.workhub_calendar_save(%s,%s::jsonb)', ('m-07', json.dumps({'draft': draft('탈취'), 'id': e['id'], 'expectedVersion': 2, 'idempotencyKey': str(uuid.uuid4())})))
    check('T20c 다른 학교 관리자가 우리 일정 수정 → NOT_FOUND', r[0] == 'NOT_FOUND', r)
    check('T20d 다른 학교 목록에 우리 일정 없음', call(c7, 'select public.workhub_calendar_list(%s)', ('m-07',)) == [])
    check('T20e 우리 관리자가 다른 학교 소속 id 로 호출 → INACTIVE_MEMBERSHIP', err(c, 'select public.workhub_task_list(%s)', ('m-07',))[0] == 'INACTIVE_MEMBERSHIP')
    c8 = api(U8)
    check('T21 정지된 소속 → INACTIVE_MEMBERSHIP', err(c8, 'select public.workhub_calendar_list(%s)', ('m-08',))[0] == 'INACTIVE_MEMBERSHIP')

    # ------------------------------------------------------------ 열람 범위·관리자 권한
    c9 = api(U9)
    check('T22 같은 학교 교사: 학교 공개 일정 읽기', any(x['id'] == e['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',))))
    r = err(c9, 'select public.workhub_calendar_save(%s,%s::jsonb)', ('m-09', json.dumps({'draft': draft('남의 일정'), 'id': e['id'], 'expectedVersion': 2, 'idempotencyKey': str(uuid.uuid4())})))
    check('T22b 역할 없는 교사가 남의 일정 수정 → FORBIDDEN', r[0] == 'FORBIDDEN', r)
    p9 = save(c9, 'm-09', {'draft': draft('개인 일정', visibility='private', audience={'all': False, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}), 'idempotencyKey': str(uuid.uuid4())})
    check('T23 개인 일정은 관리자에게도 안 보임(목록)', not any(x['id'] == p9['id'] for x in call(c, 'select public.workhub_calendar_list(%s)', (m1,))))
    check('T23b 개인 일정 단건 → NOT_FOUND', err(c, 'select public.workhub_calendar_get(%s,%s)', (m1, p9['id']))[0] == 'NOT_FOUND')
    a9 = save(c, m1, {'draft': draft('부장 회의', visibility='audience', audience={'all': False, 'groups': [], 'includeMemberIds': ['m-09'], 'excludeMemberIds': []}), 'idempotencyKey': str(uuid.uuid4())})
    check('T24 직접 포함된 교사는 대상 일정 읽기', any(x['id'] == a9['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',))))
    a0 = save(c, m1, {'draft': draft('학년 협의', visibility='audience', audience={'all': False, 'groups': [{'departmentIds': [], 'gradeIds': ['2'], 'subjectIds': []}], 'includeMemberIds': [], 'excludeMemberIds': []}), 'idempotencyKey': str(uuid.uuid4())})
    check('T24b 학년 조건 일정은 R0 에서 담당 정보가 없어 작성자 외에는 안 보임',
          not any(x['id'] == a0['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',)))
          and any(x['id'] == a0['id'] for x in call(c, 'select public.workhub_calendar_list(%s)', (m1,))))
    ex = save(c, m1, {'draft': draft('제외 시험', audience={'all': True, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': ['m-09']}, visibility='audience'), 'idempotencyKey': str(uuid.uuid4())})
    check('T24c 제외된 교사는 대상 일정 안 보임', not any(x['id'] == ex['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',))))
    # 같은 교사를 직접 포함과 제외에 함께 두면 제외가 우선(앱 화면 안내와 같음). 거부하지 않는다.
    def overlap(label, aud):
        k = str(uuid.uuid4())
        cmd = {'draft': draft(label, visibility='audience', audience=aud), 'idempotencyKey': k}
        r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps(cmd)))
        if r[0] != 'OK':
            return None, None, r
        n1 = counts()
        return save(c, m1, cmd), n1, r  # 같은 번호 재전송 → 첫 저장 원본을 돌려줌
    for tag, label, aud in [
            ('T24d', '전체+겹침', {'all': True, 'groups': [], 'includeMemberIds': ['m-09'], 'excludeMemberIds': ['m-09']}),
            ('T24e', '조건+겹침', {'all': False, 'groups': [{'departmentIds': [], 'gradeIds': ['g1'], 'subjectIds': []}], 'includeMemberIds': ['m-09'], 'excludeMemberIds': ['m-09']}),
            ('T24f', '유일한 포함자 제외', {'all': False, 'groups': [], 'includeMemberIds': ['m-09'], 'excludeMemberIds': ['m-09']})]:
        b = counts()
        ov, n1, r = overlap(label, aud)
        if ov is None:
            check(f'{tag} 포함·제외 겹침({label}) 저장됨', False, r); continue
        n = counts()
        check(f'{tag}0 같은 번호 재전송은 새 행을 만들지 않음', n == n1, (n, n1))
        check(f'{tag} 포함·제외 겹침({label}) 저장, DTO 는 입력 그대로', ov['audience'] == aud and ov['version'] == 1, ov)
        check(f'{tag}b 겹친 교사는 못 봄(제외 우선)', not any(x['id'] == ov['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',)))
              and err(c9, 'select public.workhub_calendar_get(%s,%s)', ('m-09', ov['id']))[0] == 'NOT_FOUND')
        modes = scalar("select jsonb_agg(m.mode order by m.mode) from workhub.audience_members m join workhub.events e on e.audience_set_id=m.audience_set_id where e.id=%s", (ov['id'],))
        check(f'{tag}c 대상 표에는 효력만(제외 1행, 직접 포함 없음)', modes == ['exclude'], modes)
        g = call(c, 'select public.workhub_calendar_get(%s,%s)', (m1, ov['id']))
        check(f'{tag}d 다시 읽어도 입력 그대로, 일정은 1건만 생김', g == ov and n['events'] == b['events'] + 1, (g, n, b))
    # 겹침 일정 수정: 겹침을 풀면 그 교사가 다시 보인다(새 대상 묶음)
    u = save(c, m1, {'draft': draft('유일한 포함자 제외', visibility='audience', audience={'all': False, 'groups': [], 'includeMemberIds': ['m-09'], 'excludeMemberIds': []}),
                     'id': ov['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())})
    check('T24g 겹침을 푼 수정 → version 2, 그 교사가 다시 봄', u['version'] == 2 and u['audience']['excludeMemberIds'] == []
          and any(x['id'] == ov['id'] for x in call(c9, 'select public.workhub_calendar_list(%s)', ('m-09',))), u)
    s9 = save(c9, 'm-09', {'draft': draft('교사 공유 일정'), 'idempotencyKey': str(uuid.uuid4())})
    mg = save(c, m1, {'draft': draft('관리자가 고침'), 'id': s9['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())})
    check('T25 일정 관리자는 남의 공유 일정 수정 가능', mg['version'] == 2 and mg['authorMemberId'] == 'm-09', mg)
    r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps({'draft': draft('숨기기', visibility='private', audience={'all': False, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}), 'id': s9['id'], 'expectedVersion': 2, 'idempotencyKey': str(uuid.uuid4())})))
    check('T25b 관리자도 남의 일정을 개인 일정으로 바꿀 수 없음 → FORBIDDEN', r[0] == 'FORBIDDEN', r)
    # 역할 회수 즉시 반영
    a = admin(); call(a, "update workhub.membership_roles set revoked_at=now(), revoke_reason='시험' where membership_id=%s and role_code='calendar_manager' returning id", (m1,)); a.close()
    r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps({'draft': draft('회수 뒤'), 'id': s9['id'], 'expectedVersion': 2, 'idempotencyKey': str(uuid.uuid4())})))
    ctx = call(c, 'select public.workhub_context()')
    check('T26 관리자 역할 회수 → 남의 일정 수정 FORBIDDEN, 맥락 role=teacher',
          r[0] == 'FORBIDDEN' and [m for m in ctx['memberships'] if m['id'] == m1][0]['role'] == 'teacher', r)
    a = admin(); call(a, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s,%s,'calendar_manager',current_date) returning id", (s1, m1)); a.close()

    # 기존 승인 해제 즉시 반영 (public.users.is_active)
    a = admin(); call(a, "update public.users set is_active=false where id=%s returning id", (U9,)); a.close()
    check('T27 기존 사이트에서 승인 해제 → 즉시 FORBIDDEN', err(c9, 'select public.workhub_task_list(%s)', ('m-09',))[0] == 'FORBIDDEN')
    a = admin(); call(a, "update public.users set is_active=true where id=%s returning id", (U9,)); a.close()
    # 소속 기간 종료
    a = admin(); call(a, "update workhub.memberships set valid_to=(now() at time zone 'Asia/Seoul')::date where id='m-09' returning id"); a.close()
    check('T28 소속 기간 끝남 → INACTIVE_MEMBERSHIP', err(c9, 'select public.workhub_task_list(%s)', ('m-09',))[0] == 'INACTIVE_MEMBERSHIP')
    a = admin(); call(a, "update workhub.memberships set valid_to=null where id='m-09' returning id"); a.close()

    # ------------------------------------------------------------ 업무
    b5 = counts(); tk = str(uuid.uuid4())
    t1 = mutate(c, m1, {'kind': 'create', 'input': {'title': '평가계획 제출', 'notes': '', 'dueDate': '2026-10-31'}}, tk)
    want_t = {'id', 'schoolId', 'ownerMemberId', 'title', 'notes', 'dueDate', 'status', 'version'}
    check('T30 업무 생성 version=1, status=todo, DTO 키 일치', t1['version'] == 1 and t1['status'] == 'todo' and set(t1) == want_t, t1)
    check('T30b 학년도 연결됨', scalar('select academic_year_id is not null from workhub.tasks where id=%s', (t1['id'],)))
    t1b = mutate(c, m1, {'kind': 'create', 'input': {'title': '평가계획 제출', 'notes': '', 'dueDate': '2026-10-31'}}, tk)
    after5 = counts()
    check('T31 같은 번호 재전송 → 같은 업무, 하나만 생김', t1b['id'] == t1['id'] and after5['tasks'] - b5['tasks'] == 1, (t1b, after5, b5))
    r = err(c, 'select public.workhub_task_mutate(%s,%s::jsonb,%s)', (m1, json.dumps({'kind': 'create', 'input': {'title': '다른 업무', 'notes': '', 'dueDate': ''}}), tk))
    check('T32 같은 번호·다른 입력 → IDEMPOTENCY_CONFLICT', r[0] == 'IDEMPOTENCY_CONFLICT', r)
    sk = str(uuid.uuid4())
    t2 = mutate(c, m1, {'kind': 'status', 'taskId': t1['id'], 'status': 'done', 'expectedVersion': 1}, sk)
    check('T33 상태 변경 done → version 2, 완료 시각 기록', t2['status'] == 'done' and t2['version'] == 2
          and scalar('select done_at is not null from workhub.tasks where id=%s', (t1['id'],)), t2)
    t2b = mutate(c, m1, {'kind': 'status', 'taskId': t1['id'], 'status': 'done', 'expectedVersion': 1}, sk)
    check('T34 상태 변경 응답 유실 후 재시도 → version 2 그대로', t2b['version'] == 2, t2b)
    r = err(c, 'select public.workhub_task_mutate(%s,%s::jsonb,%s)', (m1, json.dumps({'kind': 'update', 'taskId': t1['id'], 'input': {'title': 'x', 'notes': '', 'dueDate': ''}, 'expectedVersion': 1}), str(uuid.uuid4())))
    check('T35 옛 판으로 업무 수정 → CONFLICT + 현재 원본', r[0] == 'CONFLICT' and json.loads(r[1])['version'] == 2, r)
    t3 = mutate(c, m1, {'kind': 'update', 'taskId': t1['id'], 'input': {'title': '평가계획 제출(수정)', 'notes': '메모', 'dueDate': ''}, 'expectedVersion': 2}, str(uuid.uuid4()))
    check('T36 업무 수정 → version 3, 마감 비움', t3['version'] == 3 and t3['dueDate'] == '' and t3['notes'] == '메모', t3)
    check('T37 남의 업무는 관리자도 못 봄 → NOT_FOUND', err(c9, 'select public.workhub_task_get(%s,%s)', ('m-09', t1['id']))[0] == 'NOT_FOUND')
    r = err(c9, 'select public.workhub_task_mutate(%s,%s::jsonb,%s)', ('m-09', json.dumps({'kind': 'status', 'taskId': t1['id'], 'status': 'cancelled', 'expectedVersion': 3}), str(uuid.uuid4())))
    check('T37b 남의 업무 변경 → NOT_FOUND', r[0] == 'NOT_FOUND', r)
    check('T37c 다른 학교 관리자 업무 목록 비어 있음', call(c7, 'select public.workhub_task_list(%s)', ('m-07',)) == [])
    for label, cmd in [('제목 121자', {'kind': 'create', 'input': {'title': 'x' * 121, 'notes': '', 'dueDate': ''}}),
                       ('모르는 상태', {'kind': 'status', 'taskId': t1['id'], 'status': 'archived', 'expectedVersion': 3}),
                       ('모르는 종류', {'kind': 'delete', 'taskId': t1['id']}),
                       ('여분 키', {'kind': 'create', 'input': {'title': 'a', 'notes': '', 'dueDate': ''}, 'ownerMemberId': 'm-09'})]:
        r = err(c, 'select public.workhub_task_mutate(%s,%s::jsonb,%s)', (m1, json.dumps(cmd), str(uuid.uuid4())))
        check(f'T38 업무 입력 거부: {label} → INVALID_INPUT', r[0] == 'INVALID_INPUT', r)
    # 같은 번호를 다른 사람이 써도 서로 섞이지 않음(접수증은 주체별)
    t9 = mutate(c9, 'm-09', {'kind': 'create', 'input': {'title': '평가계획 제출', 'notes': '', 'dueDate': '2026-10-31'}}, tk)
    check('T39 같은 요청 번호라도 다른 사람이면 별개', t9['id'] != t1['id'] and t9['ownerMemberId'] == 'm-09')

    # ------------------------------------------------------------ 감사·outbox 모양
    bad_audit = scalar("""select count(*) from workhub.audit_events
       where (actor_account_id is null) = (actor_service_principal_id is null)""")
    check('T40 감사 기록은 모두 사람 XOR 서비스 주체', bad_audit == 0)
    check('T40b 접수증 result 에 본문 없음(id·판·시각만)', scalar("""select count(*) from workhub.idempotency_receipts r
       where exists (select 1 from jsonb_object_keys(r.result) k where k not in ('resource_type','resource_id','resource_version','recorded_at'))""") == 0)
    check('T40c 개인 일정·업무 감사는 owner_only', scalar("""select bool_and(sensitivity='owner_only') from workhub.audit_events
       where operation like 'task.%%' or resource_id=%s""", (p9['id'],)))

    # ------------------------------------------------------------ 원자성: outbox 기록 실패 시 전부 롤백
    a = admin(); cur = a.cursor()
    cur.execute("create function public.t_fail() returns trigger language plpgsql as $$ begin raise exception 'OUTBOX_DOWN'; end $$")
    cur.execute('create trigger t_fail before insert on workhub.outbox for each row execute function public.t_fail()')
    b6 = counts()
    r = err(c, 'select public.workhub_calendar_save(%s,%s::jsonb)', (m1, json.dumps({'draft': draft('롤백 시험'), 'idempotencyKey': str(uuid.uuid4())})))
    r2 = err(c, 'select public.workhub_task_mutate(%s,%s::jsonb,%s)', (m1, json.dumps({'kind': 'create', 'input': {'title': '롤백', 'notes': '', 'dueDate': ''}}), str(uuid.uuid4())))
    check('T41 마지막 단계(outbox) 실패 → 일정·이력·접수증·감사 모두 남지 않음', 'OUTBOX_DOWN' in r[0] and 'OUTBOX_DOWN' in r2[0] and counts() == b6, (r, r2, counts(), b6))
    cur.execute('drop trigger t_fail on workhub.outbox; drop function public.t_fail()'); a.close()

    # ------------------------------------------------------------ 동시성
    # (1) 같은 번호 두 요청이 동시에: 하나만 만들고 둘 다 같은 결과
    ck = str(uuid.uuid4()); cmd = {'draft': draft('동시 생성'), 'idempotencyKey': ck}
    ca, cb = api(U1), api(U1); ca.autocommit = False; cb.autocommit = False
    for x in (ca, cb):
        cur = x.cursor(); cur.execute('set role authenticated')
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({'sub': U1, 'role': 'authenticated'}),))
    ra = save(ca, m1, cmd)            # A 는 잠금을 쥔 채 아직 커밋 안 함
    out = {}
    def run_b():
        try: out['b'] = save(cb, m1, cmd); cb.commit()
        except psycopg2.Error as e: out['b'] = e.pgerror; cb.rollback()
    th = threading.Thread(target=run_b); th.start(); time.sleep(0.5)
    blocked = th.is_alive(); ca.commit(); th.join(5)
    n = scalar('select count(*) from workhub.events where title=%s', ('동시 생성',))
    check('T50 같은 번호 동시 2건 → B 는 A 를 기다렸다가 같은 일정을 받음, 1건만 생성',
          blocked and isinstance(out.get('b'), dict) and out['b']['id'] == ra['id'] and n == 1, (blocked, out, n))
    # (2) 같은 판을 다른 번호로 동시에 수정: 하나만 이기고 다른 하나는 CONFLICT
    base = ra
    ra2 = save(ca, m1, {'draft': draft('A 수정'), 'id': base['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())})
    out = {}
    def run_b2():
        try: out['b'] = save(cb, m1, {'draft': draft('B 수정'), 'id': base['id'], 'expectedVersion': 1, 'idempotencyKey': str(uuid.uuid4())}); cb.commit()
        except psycopg2.Error as e: out['b'] = e.pgerror.split('\n')[0]; cb.rollback()
    th = threading.Thread(target=run_b2); th.start(); time.sleep(0.5)
    blocked = th.is_alive(); ca.commit(); th.join(5)
    final = scalar('select jsonb_build_object(\'t\', title, \'v\', version) from workhub.events where id=%s', (base['id'],))
    check('T51 같은 판 동시 수정 → 하나만 반영, 다른 쪽 CONFLICT', blocked and 'CONFLICT' in str(out.get('b')) and final == {'t': 'A 수정', 'v': 2}, (blocked, out, final))
    # (3) 저장 중 승인 해제: 해제 트랜잭션은 저장이 끝날 때까지 기다린다(FOR SHARE)
    ra3 = save(ca, m1, {'draft': draft('잠금 시험'), 'idempotencyKey': str(uuid.uuid4())})
    adm = admin(); adm.autocommit = True
    out = {}
    def revoke():
        t0 = time.time()
        c2 = psycopg2.connect(host=HOST, port=PORT, dbname=DB, user='supabase_admin'); c2.autocommit = True
        c2.cursor().execute('update public.users set is_active=false where id=%s', (U1,)); out['wait'] = time.time() - t0; c2.close()
    th = threading.Thread(target=revoke); th.start(); time.sleep(0.5)
    blocked = th.is_alive(); ca.commit(); th.join(5)
    check('T52 저장 중 승인 해제는 저장 커밋까지 기다림(회원 행 공유 잠금)', blocked and out.get('wait', 0) >= 0.4, (blocked, out))
    call(adm, 'update public.users set is_active=true where id=%s returning id', (U1,)); adm.close()
    ca.close(); cb.close()

    # ------------------------------------------------------------ 초기 설정 재실행·서비스 주체
    a = admin()
    r = err(a, "select workhub_private.bootstrap_first_school(%s::jsonb)", (json.dumps({'admin_user_id': U9}),))
    check('T60 초기 설정 두 번째 실행 거부', 'BOOTSTRAP' in r[0], r)
    r = err(a, "select workhub_private.resolve_service_actor('school.bootstrap','svc')")
    check('T61 초기 설정 서비스 주체는 승인 회수 뒤 쓸 수 없음', r[0] == 'FORBIDDEN', r)
    a.close()

    print()
    fails = [x for x in results if not x[1]]
    print(f'== {len(results) - len(fails)}/{len(results)} PASS')
    json.dump([{'name': n, 'pass': p} for n, p, _ in results], open(os.path.join(os.environ['R0_WORK'], 'rpc_results.json'), 'w'), ensure_ascii=False, indent=1)
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
