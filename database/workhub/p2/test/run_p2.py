# P2 일정 일괄 가져오기 · 협업 요청 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# 받은 응답은 P2_CAPTURE 에 남겨 app_contract_p2.ts 가 PR #48 앱의 실제 어댑터·parser 에 넣는다.
#
# 사용: python3 run_p2.py      (R1-01~03 + P1-01·02 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import copy, datetime, hashlib, json, os, sys, threading, time, uuid
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
OUT = os.environ.get('P2_CAPTURE', '')
captures = []
D = datetime.date
U29, U30, U31 = ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000031')


# ----------------------------------------------------------------------------- 도구
def canon(v):
    """앱 cooperation/protocol.ts canonical 과 같은 규칙(키 정렬 · 배열 순서 유지 · 공백 없음)"""
    if isinstance(v, list): return '[' + ','.join(canon(x) for x in v) + ']'
    if isinstance(v, dict): return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canon(v[k]) for k in sorted(v)) + '}'
    return json.dumps(v, ensure_ascii=False)

def sha(v): return hashlib.sha256(canon(v).encode()).hexdigest()

def sqlfile(name, user='postgres', text=None):
    a = admin(user); cur = a.cursor()
    try:
        cur.execute(text if text is not None else open(os.path.join(S, name), encoding='utf-8').read())
        return cur.fetchall() if cur.description else None
    finally:
        a.close()

def sqlerr(text, user='postgres'):
    try:
        sqlfile(None, user, text); return 'OK'
    except psycopg2.Error as e:
        return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)

def src(name): return open(os.path.join(S, name), encoding='utf-8').read()
def fill_text(name, **kw):
    t = src(name)
    for k, v in kw.items(): t = t.replace(k, v)
    return t
def module_sql(name, school, module, note):
    return fill_text(name, **{'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>': school, '<모듈: calendar_batch · cooperation 등>': module, '<사유: 날짜와 이유>': note})

def fingerprint(): return [r for r in sqlfile('P2-00_사전점검_지문.sql') if r[0] == '지문']

P2_TABLES = ['module_activations', 'request_receipts', 'calendar_import_sources', 'calendar_import_source_editors', 'calendar_import_rows',
             'calendar_import_prepares', 'calendar_import_batches', 'cooperation_requests', 'cooperation_history', 'cooperation_task_links']
def state():
    """P2 와 R0 일정·업무가 쓰는 모든 표의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P2_TABLES)
    return scalar(f"""select jsonb_build_object({parts},
      'events', (select md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from workhub.events x),
      'revisions', (select count(*) from workhub.event_revisions), 'tasks', (select md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from workhub.tasks x),
      'audit', (select count(*) from workhub.audit_events), 'outbox', (select count(*) from workhub.outbox))""")

def ecode(env):
    if isinstance(env, dict): return env.get('code') if env.get('ok') is False else None
    return env


class P(Who):
    """P2 RPC. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
    def ctx(self):
        try: return call(self.c, 'select public.workhub_context()')
        except psycopg2.Error: return None
    def keep(self, kind, raw, **extra):
        if OUT and isinstance(raw, dict):
            captures.append({'kind': kind, 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid},
                             'context': self.ctx(), 'raw': raw, **extra})
        return raw
    def go(self, fn, *args):
        try: return self.rpc(fn, *args)
        except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
    def prepare(self, inp): return self.keep('prepare', self.go('workhub_calendar_batch_prepare', inp), input=inp)
    def commit(self, cmd, k=None):
        k = k or key(); return self.keep('commit', self.go('workhub_calendar_batch_commit', cmd, k), command=cmd, key=k)
    def catalog(self, cursor=None): return self.keep('catalog', self.go('workhub_cooperation_catalog', cursor), cursor=cursor)
    def lst(self, box='received', status='all', query='', cursor=None):
        f = {'box': box, 'status': status, 'query': query, 'cursor': cursor}
        return self.keep('list', self.go('workhub_cooperation_list', f), filter=f)
    def get(self, rid): return self.keep('detail', self.go('workhub_cooperation_get', rid), requestId=rid)
    def mutate(self, cmd, k=None):
        k = k or key(); return self.keep('mutate', self.go('workhub_cooperation_mutate', cmd, k), command=cmd, key=k)
    def task(self, title, due=''):
        return call(self.c, 'select public.workhub_task_mutate(%s, %s::jsonb, %s)',
                    (self.member, json.dumps({'kind': 'create', 'input': {'title': title, 'notes': '', 'dueDate': due}}, ensure_ascii=False), key()))
    def task_status(self, t, status):
        return call(self.c, 'select public.workhub_task_mutate(%s, %s::jsonb, %s)',
                    (self.member, json.dumps({'kind': 'status', 'taskId': t['id'], 'status': status, 'expectedVersion': t['version']}), key()))
    def site_save(self, event_id, version, d):
        return call(self.c, 'select public.workhub_calendar_save(%s, %s::jsonb)',
                    (self.member, json.dumps({'draft': d, 'id': event_id, 'expectedVersion': version, 'idempotencyKey': key()}, ensure_ascii=False)))


def draft(title, start, end=None, all_day=True, st='', et='', vis='school', inc=None, desc='', loc=''):
    return {'title': title, 'description': desc, 'location': loc, 'startDate': start, 'endDate': end or start, 'allDay': all_day,
            'startTime': '' if all_day else st, 'endTime': '' if all_day else et, 'visibility': vis,
            'audience': {'all': vis == 'school', 'groups': [], 'includeMemberIds': inc or [], 'excludeMemberIds': []}}

def row(k, line, sid, d): return {'key': k, 'line': line, 'sourceId': sid, 'sourceHash': sha(d), 'draft': d}
def inp(source_key, rows, label='2026 학사일정', file_tag='f1', omitted=None):
    return {'sourceKey': source_key, 'sourceLabel': label, 'fileHash': hashlib.sha256(file_tag.encode()).hexdigest(),
            'omittedColumns': omitted or [], 'rows': rows}

def selections(prev, keys, conflicts=()):
    """앱 batchCommit 과 같은 방식으로 미리보기에서 선택을 만든다"""
    out = []
    for k in keys:
        r = next(x for x in prev['rows'] if x['key'] == k)
        dec = 'create' if r['state'] == 'new' else 'replace_conflict' if r['state'] == 'conflict' else 'update'
        out.append({'key': r['key'], 'sourceId': r['sourceId'], 'sourceHash': r['sourceHash'], 'eventId': r['eventId'],
                    'expectedVersion': r['expectedVersion'], 'decision': dec})
    return {'kind': 'calendar_batch_commit', 'prepareId': prev['prepareId'], 'previewHash': prev['previewHash'], 'selections': out}

def states(prev): return {r['key']: r['state'] for r in prev['rows']}
def body(env, *drop): return {k: v for k, v in env.items() if k not in ('ok', 'contractVersion', 'schoolId', 'memberId', 'ownerUserId', *drop)}

def concurrently(fns, hold_sql=None, hold_args=()):
    """hold_sql 로 잡은 잠금을 쥔 채 fns 를 동시에 시작하고, 모두 대기에 들어간 뒤 놓는다"""
    holder = None
    if hold_sql:
        holder = psycopg2.connect(host=os.environ['R0_PGHOST'], port=int(os.environ.get('R0_PG_PORT', '55433')), dbname='r0', user='postgres')
        holder.cursor().execute(hold_sql, hold_args)
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    time.sleep(0.8)
    if holder: holder.commit(); holder.close()
    for t in ts: t.join()
    return outs

def coop_create(rcpt, title='자료 협조 요청', desc='3학년 평가 자료를 부탁드립니다.', due='', task=None):
    return {'kind': 'create', 'recipientMemberId': rcpt, 'title': title, 'description': desc, 'dueDate': due, 'sourceTask': task}
def coop_move(rid, ver, action, comment='확인했습니다'):
    return {'kind': 'transition', 'requestId': rid, 'expectedVersion': ver, 'action': action, 'comment': comment}


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    start = scalar("select min(starts_on) from workhub.academic_years where school_id=%s", (s1,))
    run = admin()
    # 같은 이름 교사 2명(22·23), 가입 대기(29)·거절(30)·정지(31) 소속
    call(run, "update workhub.accounts set display_name='김하늘' where id in ('acc-22','acc-23')")
    call(run, f"""insert into auth.users(id,email,raw_user_meta_data) values
        ('{U29}','t29@x.kr','{{"full_name":"대기교사"}}'),('{U30}','t30@x.kr','{{"full_name":"거절교사"}}'),('{U31}','t31@x.kr','{{"full_name":"정지교사"}}')""")
    call(run, "update public.users set role='superadmin', is_active=true where id = any(%s)", ([U29, U30, U31],))
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-'||right(id,2), id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = any(%s)""", ([U29, U30, U31],))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type) values ('m-29', %s, 'acc-29', 'pending', 'teacher')", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, decided_at) values ('m-30', %s, 'acc-30', 'rejected', 'teacher', now())", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-31', %s, 'acc-31', 'suspended', 'teacher', %s, now())", (s1, start))
    # 24 = 공유 일정 관리자(calendar_manager)
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'calendar_manager', %s)", (s1, start))

    # ======================================================================= A. 설치 전 지문 → P2-01·02·03 → 지문 비교
    before = fingerprint()
    sqlfile('P2-01_일정일괄_협업_모델.sql'); sqlfile('P2-02_일정일괄_협업_공개함수.sql')
    post = sqlfile('P2-03_사후점검.sql')
    check('A01 P2-03 사후 점검 FAIL 없음, 모듈 활성화 없음', all(r[2] in ('ok', 'info') for r in post) and post[-1][3] == '(활성화 없음)', post)
    after = fingerprint()
    check('A02 P2-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A03 P2-01 다시 실행 → 멈춤', 'P2-01 이 이미 적용되었습니다' in sqlerr(src('P2-01_일정일괄_협업_모델.sql')))
    check('A04 P2-02 다시 실행 → 멈춤', 'P2-02 가 이미 적용되었습니다' in sqlerr(src('P2-02_일정일괄_협업_공개함수.sql')))
    sample = {'b': [3, {'z': '한글 "따옴표"\n줄', 'a': None}], 'a': True, '가': '😀', 'c': '\u0001\u001f/\u007f\u2028'}
    v1 = scalar('select workhub_private.p2_canonical(%s::jsonb)', (json.dumps(sample, ensure_ascii=False),))
    check('A05 서버 canonical = 앱 canonical(한글·이모지·제어문자·중첩)', v1 == canon(sample), (v1, canon(sample)))

    t = {n: P(T[n], M[n]) for n in (21, 22, 23, 24, 25, 26, 27)}
    adm = P(U1, m1)
    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 P2 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_calendar_batch_prepare('x', '{}')"))
    c = api(None, 'service_role')
    check('B02 service_role 도 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_cooperation_list('x', '{}')"))
    c = api(T[21])
    check('B03 authenticated 는 새 표 직접 읽기 불가', 'permission denied' in err(c, 'select * from workhub.cooperation_requests'))
    check('B04 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p2_installed()"))
    check('B05 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', err(api(U2), "select public.workhub_cooperation_catalog('x', null)") == 'FORBIDDEN')
    check('B06 다른 학교 소속 ID(m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_cooperation_catalog(%s, null)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('B07 소속이 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', P(T[28], M[28]).go('workhub_cooperation_catalog', None) == 'INACTIVE_MEMBERSHIP')
    check('B08 가입 대기(m-29) → INACTIVE_MEMBERSHIP', P(U29, 'm-29').go('workhub_cooperation_catalog', None) == 'INACTIVE_MEMBERSHIP')
    check('B09 정지(m-31) → INACTIVE_MEMBERSHIP', P(U31, 'm-31').go('workhub_cooperation_catalog', None) == 'INACTIVE_MEMBERSHIP')
    d0 = draft('설치만 시험', '2026-11-02')
    st = state()
    check('B10 설치만 → 일정 비교 UNAVAILABLE', ecode(t[21].prepare(inp('k0', [row('r1', 2, 'S0', d0)]))) == 'UNAVAILABLE')
    check('B11 설치만 → 협업 목록·상세·목록 UNAVAILABLE', [ecode(t[21].catalog()), ecode(t[21].lst()), ecode(t[21].get('x'))] == ['UNAVAILABLE'] * 3)
    check('B12 설치만 → 비교·조회는 아무것도 쓰지 않음', state() == st)
    k_un = key(); cmd_un = coop_create(M[22])
    r_un = t[21].mutate(cmd_un, k_un)
    check('B13 설치만 → 협업 변경 UNAVAILABLE, 거절 봉투(requestKey·commandHash·rejected)',
          ecode(r_un) == 'UNAVAILABLE' and r_un['requestKey'] == k_un and r_un['commandHash'] == sha(cmd_un) and r_un['outcome'] == 'rejected', r_un)
    check('B14 거절 접수증만 남고 업무 자료 변경 0', scalar("select count(*) from workhub.request_receipts where outcome='rejected' and error_code='UNAVAILABLE'") == 1
          and scalar('select count(*) from workhub.cooperation_requests') == 0)

    # ======================================================================= C. P2-04 활성화 양식
    check('C01 P2-04 칸이 남아 있으면 멈춤', '입력 칸(<...>)을 모두 채워' in sqlerr(src('P2-04_모듈활성화_양식.sql')))
    check('C02 학교 관리자가 아닌 승인자 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in
          sqlerr(fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': T[21], 'approval_ref': '시험', 'modules': ['cooperation']})))
    check('C03 모르는 모듈 → 멈춤', 'modules 는' in
          sqlerr(fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험', 'modules': ['timetable']})))
    check('C04 같은 모듈 두 번 → 멈춤', 'modules 는' in
          sqlerr(fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험', 'modules': ['cooperation', 'cooperation']})))
    check('C05 승인 근거 공백 → 멈춤', '승인 근거는 1~200자' in
          sqlerr(fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '  ', 'modules': ['cooperation']})))
    check('C06 멈춘 P2-04 는 아무것도 쓰지 않음', scalar('select count(*) from workhub.module_activations') == 0)
    a0 = scalar('select count(*) from workhub.audit_events')
    sqlfile(None, text=fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'),
                                 {'approver_user_id': U1, 'approval_ref': '2026-10-20 교무회의 승인(시험)', 'modules': ['calendar_batch', 'cooperation']}))
    check('C07 P2-04 → 대동여중 두 모듈 active, 감사 2건, 다른 학교는 그대로',
          scalar("select string_agg(module||'='||state, ',' order by module) from workhub.module_activations where school_id=%s", (s1,)) == 'calendar_batch=active,cooperation=active'
          and scalar("select count(*) from workhub.module_activations where school_id='school-2'") == 0
          and scalar('select count(*) from workhub.audit_events') == a0 + 2)
    check('C08 P2-04 다시 실행 → 멈춤(이미 행이 있음)', '이미 활성화 행이 있습니다' in
          sqlerr(fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '다시', 'modules': ['cooperation']})))
    r_un2 = t[21].mutate(cmd_un, k_un)
    check('C09 활성화 뒤 같은 요청 번호 재전송 → 처음 확정 거절(UNAVAILABLE) 그대로', r_un2 == r_un, r_un2)
    # 다른 학교도 켠다(학교 경계 시험용): m-27 을 그 학교 관리자로
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', %s)", (start,))
    check('C10 다른 학교는 활성화 전 UNAVAILABLE(학교별 활성화)', ecode(t[27].catalog()) == 'UNAVAILABLE')
    sqlfile(None, text=fill_json(os.path.join(S, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': T[27], 'approval_ref': '다른 학교 승인', 'modules': ['cooperation']}))
    check('C11 다른 학교 관리자 승인 → 그 학교만 협업 활성', ecode(t[27].catalog()) is None
          and scalar("select count(*) from workhub.module_activations where school_id='school-2'") == 1)

    # ======================================================================= D. 일정 비교(prepare) — 처음 가져오기
    da = draft('2학기 기말고사', '2026-12-08', '2026-12-10')
    db = draft('3학년 진로 상담', '2026-11-12', all_day=False, st='14:00', et='15:30', vis='audience', inc=[M[22], M[23]], loc='상담실')
    dc = draft('개인 메모', '2026-11-13', vis='private', desc='준비물 확인')
    i1 = inp('haksa-2026', [row('r1', 2, 'S-001', da), row('r2', 3, 'S-002', db), row('r3', 4, 'S-003', dc)])
    st = state()
    p1 = t[21].prepare(i1)
    check('D01 처음 비교 → 3행 모두 new, 원본 내용 그대로', ecode(p1) is None and states(p1) == {'r1': 'new', 'r2': 'new', 'r3': 'new'}
          and [r['incoming'] for r in p1['rows']] == [da, db, dc], p1)
    check('D02 previewHash = sha256(canonical(미리보기 본문)) — 앱이 다시 계산할 수 있음', p1['previewHash'] == sha(body(p1, 'previewHash')))
    check('D03 비교는 일정·계보를 쓰지 않음(비교 결과 1건만)', scalar('select count(*) from workhub.calendar_import_prepares') == 1
          and {k: v for k, v in state().items() if k != 'calendar_import_prepares'} == {k: v for k, v in st.items() if k != 'calendar_import_prepares'})
    bad = [('sourceHash 불일치', lambda x: x['rows'][0].__setitem__('sourceHash', '0' * 64)),
           ('같은 key 2개', lambda x: x['rows'][1].__setitem__('key', 'r1')),
           ('같은 sourceId 2개', lambda x: x['rows'][1].__setitem__('sourceId', 'S-001')),
           ('모르는 항목', lambda x: x.__setitem__('extra', 1)),
           ('행 0개', lambda x: x.__setitem__('rows', [])),
           ('행 51개', lambda x: x.__setitem__('rows', [row(f'k{i}', 2, f'X{i}', da) for i in range(51)])),
           ('fileHash 대문자', lambda x: x.__setitem__('fileHash', 'A' * 64)),
           ('sourceId 제어문자', lambda x: x['rows'][0].__setitem__('sourceId', 'S\u0001')),
           ('line 1', lambda x: x['rows'][0].__setitem__('line', 1)),
           ('제목 101자', lambda x: (x['rows'][0]['draft'].__setitem__('title', 'ㄱ' * 101), x['rows'][0].__setitem__('sourceHash', sha(x['rows'][0]['draft'])))),
           ('다른 학교 교사 직접 포함', lambda x: (x['rows'][1]['draft']['audience'].__setitem__('includeMemberIds', [M[27]]), x['rows'][1].__setitem__('sourceHash', sha(x['rows'][1]['draft'])))),
           ('종료일 < 시작일', lambda x: (x['rows'][0]['draft'].__setitem__('endDate', '2026-12-01'), x['rows'][0].__setitem__('sourceHash', sha(x['rows'][0]['draft']))))]
    st = state(); outs = []
    for name, f in bad:
        x = copy.deepcopy(i1); f(x); outs.append((name, ecode(t[21].prepare(x))))
    check('D04 입력 오류 12종 → 모두 INVALID_INPUT', all(o == 'INVALID_INPUT' for _, o in outs), outs)
    check('D05 입력 오류는 아무것도 쓰지 않음', state() == st)

    # ======================================================================= E. 적용(commit)
    cmd1 = selections(p1, ['r1', 'r2', 'r3']); k1 = key()
    st = state()
    r1 = t[21].commit(cmd1, k1)
    ev = {i['key']: i['eventId'] for i in (r1.get('items') or [])} if isinstance(r1, dict) else {}
    check('E01 new 3행 적용 → applied, 모두 판 1, 요청 번호·prepareId·previewHash 그대로',
          ecode(r1) is None and r1['outcome'] == 'applied' and r1['requestKey'] == k1 and r1['prepareId'] == p1['prepareId']
          and r1['previewHash'] == p1['previewHash'] and [i['version'] for i in r1['items']] == [1, 1, 1], r1)
    check('E02 일정 3건 작성자 = m-21, 계보 3행(판 1), 적용 묶음 1, 이력 import_apply 3',
          scalar("select count(*) from workhub.events where id = any(%s) and author_membership_id='m-21'", (list(ev.values()),)) == 3
          and scalar("select count(*) from workhub.calendar_import_rows where revision=1 and applied_event_version=1") == 3
          and scalar("select count(*) from workhub.calendar_import_batches") == 1
          and scalar("select count(*) from workhub.event_revisions where change_kind='import_apply'") == 3)
    check('E03 감사: 일정별 event.import_apply 3 + calendar.batch_commit 1, outbox event.saved 3, 개인 일정 감사는 owner_only',
          scalar("select count(*) from workhub.audit_events where operation='event.import_apply'") == 3
          and scalar("select count(*) from workhub.audit_events where operation='calendar.batch_commit'") == 1
          and scalar("select count(*) from workhub.outbox where topic='event.saved' and aggregate_id = any(%s)", (list(ev.values()),)) == 3
          and scalar("select sensitivity from workhub.audit_events where operation='event.import_apply' and resource_id=%s", (ev['r3'],)) == 'owner_only')
    lst21 = call(api(T[21]), 'select public.workhub_calendar_list(%s)', (M[21],))
    got = {e['id']: e for e in lst21}
    check('E04 사이트 일정 목록(R0)에 3건이 보이고 내용 = 서버 정규화(직접 포함 정렬)',
          all(i in got for i in ev.values()) and got[ev['r2']]['audience']['includeMemberIds'] == [M[22], M[23]]
          and got[ev['r2']]['startTime'] == '14:00' and got[ev['r1']]['endDate'] == '2026-12-10', [got.get(i) for i in ev.values()])
    check('E05 받는 사람 범위: m-22 는 r2(대상)를 보고 r3(개인)는 못 봄',
          {e['id'] for e in call(api(T[22]), 'select public.workhub_calendar_list(%s)', (M[22],))} >= {ev['r1'], ev['r2']}
          and ev['r3'] not in {e['id'] for e in call(api(T[22]), 'select public.workhub_calendar_list(%s)', (M[22],))})
    st = state()
    r1b = t[21].commit(cmd1, k1)
    check('E06 같은 요청 번호 재전송(응답 유실) → replayed, 본문 동일, 변경 0', r1b.get('outcome') == 'replayed' and body(r1b, 'outcome') == body(r1, 'outcome') and state() == st, r1b)
    cmd1x = copy.deepcopy(cmd1); cmd1x['selections'] = cmd1x['selections'][:2]
    r1x = t[21].commit(cmd1x, k1)
    check('E07 같은 요청 번호 · 다른 내용 → IDEMPOTENCY_CONFLICT, commandHash = 이번 명령 지문, 접수증 추가 없음',
          ecode(r1x) == 'IDEMPOTENCY_CONFLICT' and r1x['commandHash'] == sha(cmd1x) and state() == st, r1x)
    r1y = t[21].commit(cmd1)
    check('E08 같은 비교 결과를 새 요청 번호로 다시 적용 → CONFLICT(일정 그대로, 거절 접수증 1)', ecode(r1y) == 'CONFLICT'
          and scalar('select count(*) from workhub.events') == scalar("select count(*) from workhub.events") and scalar('select count(*) from workhub.calendar_import_batches') == 1)
    check('E09 남의 소속으로 같은 비교 결과 적용 → NOT_FOUND', ecode(t[22].commit(cmd1)) == 'NOT_FOUND')
    check('E10 다른 학교 교사가 같은 비교 결과 적용 → UNAVAILABLE(그 학교는 일정 일괄 비활성)', ecode(t[27].commit(cmd1)) == 'UNAVAILABLE')

    # ======================================================================= F. 다시 가져오기: duplicate · changed · conflict · held
    p2 = t[21].prepare(i1)
    check('F01 같은 파일 다시 비교 → 3행 duplicate, eventId·판·baseline·current 채움',
          states(p2) == {'r1': 'duplicate', 'r2': 'duplicate', 'r3': 'duplicate'}
          and all(r['eventId'] == ev[r['key']] and r['expectedVersion'] == 1 and r['baseline'] == r['incoming'] for r in p2['rows']), p2)
    db_rev = copy.deepcopy(db); db_rev['audience']['includeMemberIds'] = [M[23], M[22]]
    p2b = t[21].prepare(inp('haksa-2026', [row('r2', 3, 'S-002', db_rev)]))
    check('F01b 같은 내용이라도 직접 포함 교사 순서만 다르면 changed(서버 기준선은 정렬본, 비교는 앱이 보낸 원문 그대로 — 앱 parser 규칙과 같음)',
          states(p2b) == {'r2': 'changed'}, p2b)
    da2 = dict(da, title='2학기 기말고사(변경)')
    db_site = dict(db, location='진로실')
    e_b = got[ev['r2']]
    t[21].site_save(ev['r2'], 1, db_site)      # 사이트에서 직접 고침 → conflict
    call(run, "update workhub.events set deleted_at = now(), deleted_by_account_id = 'acc-21' where id=%s", (ev['r3'],))   # 사이트에서 삭제 → held
    i2 = inp('haksa-2026', [row('r1', 2, 'S-001', da2), row('r2', 3, 'S-002', db), row('r3', 4, 'S-003', dc),
                           row('r4', 5, 'S-004', draft('체육대회', '2026-11-20'))], file_tag='f2')
    p3 = t[21].prepare(i2)
    check('F02 바뀐 원본 → r1 changed · r2 conflict(사이트 수정) · r3 held(삭제됨) · r4 new',
          states(p3) == {'r1': 'changed', 'r2': 'conflict', 'r3': 'held', 'r4': 'new'}, states(p3))
    r3row = next(r for r in p3['rows'] if r['key'] == 'r3')
    check('F03 held 행은 eventId·판·baseline·current 가 null 이고 사유가 있음',
          r3row['eventId'] is None and r3row['baseline'] is None and r3row['current'] is None and '삭제' in r3row['reason'])
    st = state()
    held_cmd = selections(p3, ['r4']); held_cmd['selections'].append({'key': 'r3', 'sourceId': 'S-003', 'sourceHash': r3row['sourceHash'],
                                                                     'eventId': None, 'expectedVersion': None, 'decision': 'create'})
    check('F04 held 행을 create 로 끼워 넣기 → INVALID_INPUT, 아무것도 적용 안 됨', ecode(t[21].commit(held_cmd)) == 'INVALID_INPUT'
          and scalar('select count(*) from workhub.calendar_import_batches') == 1)
    tam = selections(p3, ['r1']); tam['selections'][0]['eventId'] = ev['r3']
    check('F05 선택의 eventId 를 바꿔치기 → INVALID_INPUT', ecode(t[21].commit(tam)) == 'INVALID_INPUT')
    tam = selections(p3, ['r1']); tam['previewHash'] = '0' * 64
    check('F06 previewHash 위조 → INVALID_INPUT', ecode(t[21].commit(tam)) == 'INVALID_INPUT')
    tam = selections(p3, ['r2']); tam['selections'][0]['decision'] = 'update'
    check('F07 conflict 행을 update 로 보냄(교체 동의 없이) → INVALID_INPUT', ecode(t[21].commit(tam)) == 'INVALID_INPUT')
    check('F08 거절 4건은 일정·계보를 바꾸지 않음(거절 접수증만)',
          {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'})
    cmd3 = selections(p3, ['r1', 'r2', 'r4'], conflicts=['r2'])
    r3 = t[21].commit(cmd3)
    vers = {i['key']: i['version'] for i in r3.get('items', [])}
    check('F09 changed·conflict·new 한 번에 적용 → r1 판 2, r2 판 3(사이트 수정 위 교체), r4 판 1', vers == {'r1': 2, 'r2': 3, 'r4': 1}, r3)
    check('F10 계보: r1·r2 revision 2, 마지막 묶음 = 이번 묶음, baseline = 새 원본',
          scalar("select count(*) from workhub.calendar_import_rows where source_row_id in ('S-001','S-002') and revision=2") == 2
          and scalar("select baseline->>'title' from workhub.calendar_import_rows where source_row_id='S-001'") == '2학기 기말고사(변경)'
          and scalar("select count(distinct last_batch_id) from workhub.calendar_import_rows where source_row_id in ('S-001','S-002','S-004')") == 1)
    check('F11 교체된 r2 는 원본 내용(장소 상담실)으로 돌아감', call(api(T[21]), 'select public.workhub_calendar_get(%s,%s)', (M[21], ev['r2']))['location'] == '상담실')
    # 감사 기록에 교체 결정이 남는다
    check('F12 replace_conflict 결정이 감사에 남음', scalar("select count(*) from workhub.audit_events where operation='event.import_apply' and details->>'decision'='replace_conflict'") == 1)

    # ======================================================================= G. 만료 · 동시 적용 · 강제 실패
    ev4 = next(i['eventId'] for i in r3['items'] if i['key'] == 'r4')
    i3 = inp('haksa-2026', [row('r4', 5, 'S-004', draft('체육대회(우천 연기)', '2026-11-21'))], file_tag='f3')
    p4 = t[21].prepare(i3)
    call(run, "set session_replication_role = replica")
    call(run, "update workhub.calendar_import_prepares set expires_at = now() - interval '1 second' where id=%s", (p4['prepareId'],))
    call(run, "set session_replication_role = origin")
    st = state()
    check('G01 만료된 비교 결과 적용 → CONFLICT, 일정 그대로', ecode(t[21].commit(selections(p4, ['r4']))) == 'CONFLICT'
          and {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'})
    p5 = t[21].prepare(i3)
    c5a, c5b = selections(p5, ['r4']), selections(p5, ['r4'])
    sid = scalar("select id from workhub.calendar_import_sources where source_key='haksa-2026'")
    outs = concurrently([lambda: P(T[21], M[21]).commit(c5a), lambda: P(T[21], M[21]).commit(c5b)],
                        'select 1 from workhub.calendar_import_sources where id=%s for update', (sid,))
    check('G02 같은 비교 결과를 동시에 두 요청 번호로 → 하나만 applied, 다른 하나 CONFLICT, 일정 판 +1',
          sorted(o.get('outcome') for o in outs) == ['applied', 'rejected'] and scalar('select version from workhub.events where id=%s', (ev4,)) == 2, outs)
    p6 = t[21].prepare(inp('haksa-2026', [row('r4', 5, 'S-004', draft('체육대회(실내)', '2026-11-21'))], file_tag='f4'))
    c6 = selections(p6, ['r4']); k6 = key()
    outs = concurrently([lambda: P(T[21], M[21]).commit(c6, k6), lambda: P(T[21], M[21]).commit(c6, k6)],
                        'select 1 from workhub.calendar_import_sources where id=%s for update', (sid,))
    check('G03 같은 요청 번호를 두 연결에서 동시에 → applied 1 · replayed 1(같은 결과), 일정 판 +1',
          sorted(o.get('outcome') for o in outs) == ['applied', 'replayed'] and body(outs[0], 'outcome') == body(outs[1], 'outcome')
          and scalar('select version from workhub.events where id=%s', (ev4,)) == 3, outs)
    # 트랜잭션 중간 강제 실패: 일정 2건을 고친 뒤 묶음 기록 시점에서 오류 → 일정·계보·감사·접수증 모두 원상태
    call(run, """create function public.p2_test_fail() returns trigger language plpgsql as $$
                 begin raise exception 'P2_TEST_FAIL'; end $$""")
    call(run, "create trigger p2_test_fail before insert on workhub.calendar_import_batches for each row execute function public.p2_test_fail()")
    p7 = t[21].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', dict(da2, description='강제 실패')), row('r4', 5, 'S-004', draft('체육대회(강제)', '2026-11-22'))], file_tag='f5'))
    c7 = selections(p7, ['r1', 'r4']); k7 = key()
    st = state()
    out = t[21].commit(c7, k7)
    check('G04 중간 강제 실패 → 봉투 없는 오류(앱 SAVE_UNCERTAIN), 모든 표 원상태(접수증도 없음)', out == 'P2_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p2_test_fail on workhub.calendar_import_batches"); call(run, "drop function public.p2_test_fail()")
    out = t[21].commit(c7, k7)
    check('G05 원인 제거 뒤 같은 요청 번호 재전송 → 이번에 applied(앞 실패는 기록되지 않았음)', out.get('outcome') == 'applied', out)
    # 두 번째 행에서 실패하면 첫 행도 반영되지 않는다(한 트랜잭션)
    p8 = t[21].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', dict(da2, title='원자성 1')), row('r4', 5, 'S-004', draft('원자성 2', '2026-11-23'))], file_tag='f6'))
    t[21].site_save(ev4, scalar('select version from workhub.events where id=%s', (ev4,)), draft('사이트에서 바꿈', '2026-11-23'))
    st = state()
    out = t[21].commit(selections(p8, ['r1', 'r4']))
    check('G06 비교 뒤 둘째 일정이 사이트에서 바뀜 → CONFLICT, 첫째 일정도 미적용(전부 아니면 전무)', ecode(out) == 'CONFLICT'
          and {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'}, out)

    # ======================================================================= H. 원본 묶음 소유 · 공유 일정 관리자 · 역할 회수
    p9 = t[22].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', da2)], file_tag='f7'))
    check('H01 다른 교사가 만든 원본 묶음(sourceKey) → 모든 행 held(담당자 안내)', states(p9) == {'r1': 'held'} and '다른 교사' in p9['rows'][0]['reason'], p9)
    pa, pb = t[22].prepare(inp('newsrc', [row('r1', 2, 'N-1', da)])), t[23].prepare(inp('newsrc', [row('r1', 2, 'N-1', da)]))
    ra = t[22].commit(selections(pa, ['r1'])); rb = t[23].commit(selections(pb, ['r1']))
    check('H02 같은 새 sourceKey 를 두 교사가 비교 → 먼저 적용한 쪽이 소유, 뒤 적용은 CONFLICT', ra.get('outcome') == 'applied' and ecode(rb) == 'CONFLICT', (ra, rb))
    # 공유 일정 관리자(m-24): 원본 묶음 편집자로 지정되면 m-21 의 공개 일정을 갱신할 수 있다
    call(run, "insert into workhub.calendar_import_source_editors(school_id, source_id, account_id, added_by_account_id) values (%s,%s,'acc-24','acc-21')", (s1, sid))
    cur1 = call(api(T[21]), 'select public.workhub_calendar_get(%s,%s)', (M[21], ev['r1']))
    da3 = dict(da2, title='관리자가 고친 기말고사')
    p10 = t[24].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', da3), row('r3', 4, 'S-003', dc)], file_tag='f8'))
    check('H03 편집자로 지정된 공유 일정 관리자 → r1 changed(남의 공개 일정), r3 held(삭제)', states(p10) == {'r1': 'changed', 'r3': 'held'}, p10)
    call(run, "update workhub.membership_roles set revoked_at = now(), revoke_reason = 'test' where membership_id='m-24' and role_code='calendar_manager'")
    st = state()
    out = t[24].commit(selections(p10, ['r1']))
    check('H04 비교 뒤 관리자 역할 회수 → 적용 FORBIDDEN, 일정 그대로', ecode(out) == 'FORBIDDEN'
          and call(api(T[21]), 'select public.workhub_calendar_get(%s,%s)', (M[21], ev['r1']))['version'] == cur1['version'], out)
    p11 = t[24].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', da3)], file_tag='f9'))
    check('H05 역할 회수 뒤 다시 비교 → held(수정할 수 없음)', states(p11) == {'r1': 'held'} and '수정할 수 없는' in p11['rows'][0]['reason'], p11)
    call(run, "update workhub.membership_roles set revoked_at = null, revoke_reason = null where membership_id='m-24' and role_code='calendar_manager'")
    p12 = t[24].prepare(inp('haksa-2026', [row('r1', 2, 'S-001', dict(da3, visibility='private', audience={'all': False, 'groups': [], 'includeMemberIds': [], 'excludeMemberIds': []}))], file_tag='f10'))
    check('H06 관리자가 남의 일정을 나만 보기로 바꾸려 함 → held', states(p12) == {'r1': 'held'} and '나만 보기' in p12['rows'][0]['reason'], p12)
    call(run, "update public.users set role='teacher' where id=%s", (T[24],))
    check('H07 업무실 접근 자격(superadmin) 회수 → 봉투 없는 FORBIDDEN', t[24].go('workhub_calendar_batch_prepare', i1) == 'FORBIDDEN')
    call(run, "update public.users set role='superadmin' where id=%s", (T[24],))

    # ======================================================================= I. 일정 일괄 중지·재개(P2-80·81)
    st_cmd = selections(p1, ['r1'])
    sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'calendar_batch', '2026-10-16 시험 중지'))
    st = state()
    check('I01 중지 → 비교 UNAVAILABLE, 새 적용 UNAVAILABLE(확정 거절)', ecode(t[21].prepare(i1)) == 'UNAVAILABLE' and ecode(t[21].commit(st_cmd)) == 'UNAVAILABLE')
    check('I02 중지 중에도 이미 반영된 요청 재조회 → 처음 결과(replayed)', body(t[21].commit(cmd1, k1), 'outcome') == body(r1, 'outcome'))
    check('I03 중지 중 일정 자료 변경 0', {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'})
    check('I04 이미 중지된 모듈 다시 중지 → 멈춤', '이미 stopped' in sqlerr(module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'calendar_batch', '다시')))
    check('I05 활성화 행 없는 학교·모듈 중지 → 멈춤', '활성화 행이 없습니다' in sqlerr(module_sql('P2-80_모듈중지.sql', 'other-ms', 'calendar_batch', '없음')))
    sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'calendar_batch', '2026-10-16 시험 재개'))
    check('I06 재개 → 비교 다시 됨', ecode(t[21].prepare(i1)) is None)
    check('I07 중지·재개 감사 각 1건', scalar("select count(*) from workhub.audit_events where operation in ('module.stopped','module.active')") == 2)
    check('I08 칸이 남은 P2-80 → 멈춤', '칸을 채워' in sqlerr(src('P2-80_모듈중지.sql')))

    # ======================================================================= J. 협업 — 받는 사람 목록 · 원본 업무
    cat = t[21].catalog()
    rec = [r['memberId'] for r in (cat.get('recipients') or [])]
    check('J01 받는 사람: 같은 학교 · 지금 유효 · 활성 · 승인만(본인·다른 학교·끝남·대기·거절·정지 제외)',
          set(rec) == {m1, M[22], M[23], M[24], M[25], M[26]}, rec)
    same = [r for r in cat['recipients'] if r['name'] == '김하늘']
    check('J02 같은 이름 2명은 서로 다른 memberId 로 따로 나옴(이름순 뒤 id 순)', [r['memberId'] for r in same] == [M[22], M[23]], same)
    check('J03 받는 사람 정렬: 이름 → id', [(r['name'], r['memberId']) for r in cat['recipients']] == sorted((r['name'], r['memberId']) for r in cat['recipients']))
    tasks = [t[21].task(f'업무 {i:02d}', (D(2026, 11, 1) + datetime.timedelta(days=i % 7)).isoformat() if i % 3 else '') for i in range(45)]
    done = t[21].task('끝난 업무'); t[21].task_status(done, 'done')
    c1 = t[21].catalog(); c2 = t[21].catalog(c1.get('nextTaskCursor'))
    allt = [x['id'] for x in c1['sourceTasks'] + c2['sourceTasks']]
    want = [x['id'] for x in sorted(tasks, key=lambda x: (x['dueDate'] == '', x['dueDate'] or '9999', x['title'].encode(), x['id'].encode()))]
    check('J04 원본 업무 45개 → 40 + 5, 마감일(빈 값 마지막)·제목·id 순, 끝난 업무 제외',
          len(c1['sourceTasks']) == 40 and len(c2['sourceTasks']) == 5 and c2['nextTaskCursor'] is None and allt == want, (len(c1['sourceTasks']), allt[:3], want[:3]))
    check('J05 다른 교사의 위치 값 → INVALID_INPUT', ecode(t[22].catalog(c1['nextTaskCursor'])) == 'INVALID_INPUT')
    check('J06 망가진 위치 값 → INVALID_INPUT', ecode(t[21].catalog('zz')) == 'INVALID_INPUT' and ecode(t[21].catalog('7b7d')) == 'INVALID_INPUT')
    check('J07 다른 학교(m-27) 받는 사람 = 그 학교 사람만(없음)', t[27].catalog().get('recipients') == [])

    # ======================================================================= K. 협업 — 만들기
    tk = tasks[0]
    cc = coop_create(M[22], due='2026-11-05', task={'id': tk['id'], 'expectedVersion': tk['version']}); kc = key()
    rc = t[21].mutate(cc, kc)
    rid = rc.get('entityId')
    check('K01 요청 만들기 → applied, 판 1, 받는 사람 m-22(같은 이름 중 지정한 사람)', rc.get('outcome') == 'applied' and rc['version'] == 1
          and scalar('select recipient_membership_id from workhub.cooperation_requests where id=%s', (rid,)) == M[22], rc)
    check('K02 이력 1(create, 보낸 사람) · 원본 업무 연결 1 · 감사 owner_only · 알림 사건은 받는 사람에게',
          scalar("select count(*) from workhub.cooperation_history where request_id=%s and version=1 and action='create' and actor_membership_id='m-21'", (rid,)) == 1
          and scalar('select count(*) from workhub.cooperation_task_links where request_id=%s', (rid,)) == 1
          and scalar("select sensitivity from workhub.audit_events where operation='cooperation.create' and resource_id=%s", (rid,)) == 'owner_only'
          and scalar("select payload->>'notify_membership_id' from workhub.outbox where topic='cooperation.requested' and aggregate_id=%s", (rid,)) == M[22])
    st = state()
    check('K03 응답 유실 뒤 같은 요청 번호 → replayed, 같은 요청, 변경 0', t[21].mutate(cc, kc).get('entityId') == rid and state() == st)
    bads = [('본인에게', coop_create(M[21]), 'INVALID_INPUT'), ('다른 학교 교사', coop_create(M[27]), 'NOT_FOUND'),
            ('소속 끝난 교사', coop_create(M[28]), 'NOT_FOUND'), ('가입 대기', coop_create('m-29'), 'NOT_FOUND'),
            ('가입 거절', coop_create('m-30'), 'NOT_FOUND'), ('정지', coop_create('m-31'), 'NOT_FOUND'),
            ('없는 사람', coop_create('m-99'), 'NOT_FOUND'), ('제목 공백', coop_create(M[22], title='  '), 'INVALID_INPUT'),
            ('없는 날짜', coop_create(M[22], due='2026-02-30'), 'INVALID_INPUT'), ('모르는 항목', dict(coop_create(M[22]), x=1), 'INVALID_INPUT'),
            ('설명 8001자', coop_create(M[22], desc='가' * 8001), 'INVALID_INPUT'), ('제어문자', coop_create(M[22], title='a\u0007'), 'INVALID_INPUT'),
            ('옛 판 업무', coop_create(M[23], task={'id': tasks[1]['id'], 'expectedVersion': 9}), 'CONFLICT'),
            ('끝난 업무', coop_create(M[23], task={'id': done['id'], 'expectedVersion': done['version'] + 1}), 'CONFLICT'),
            ('남의 업무', coop_create(M[23], task={'id': t[22].task('남의 업무')['id'], 'expectedVersion': 1}), 'NOT_FOUND')]
    st = state(); outs = []
    for name, cmd, want_code in bads:
        k = key(); o = t[21].mutate(cmd, k)
        outs.append((name, ecode(o), want_code, isinstance(o, dict) and o.get('commandHash') == sha(cmd) and o.get('requestKey') == k))
    check('K04 잘못된 만들기 15종 → 각각 정한 코드 · 거절 봉투(지문 일치)', all(o[1] == o[2] and o[3] for o in outs), [o for o in outs if not (o[1] == o[2] and o[3])])
    check('K05 거절은 요청·이력·연결·업무를 바꾸지 않음(거절 접수증만)',
          {k: v for k, v in state().items() if k not in ('request_receipts', 'tasks')} == {k: v for k, v in st.items() if k not in ('request_receipts', 'tasks')})
    check('K06 잘못된 요청 번호(공백 포함) → INVALID_INPUT, 접수증 남기지 않음',
          ecode(t[21].mutate(coop_create(M[22]), 'bad key')) == 'INVALID_INPUT' and scalar("select count(*) from workhub.request_receipts where request_key='bad key'") == 0)

    # ======================================================================= L. 협업 — 상태 전이 전부
    def mv(who, r, v, action, comment='확인했습니다', k=None): return who.mutate(coop_move(r, v, action, comment), k)
    path = [(22, 'accept', ''), (22, 'request_completion', '완료했습니다'), (21, 'return_completion', '보완 부탁'), (22, 'request_completion', '보완 완료'),
            (22, 'retract_completion', '다시 볼게요'), (22, 'request_completion', '최종 완료'), (21, 'confirm_completion', '')]
    v = 1; seq = []
    for who, action, cm in path:
        o = mv(t[who], rid, v, action, cm); seq.append((action, o.get('version'))); v += 1
    check('L01 accept → 완료 요청 → 반려 → 완료 요청 → 철회 → 완료 요청 → 완료 확인: 판 2..8, 상태 completed',
          [x[1] for x in seq] == list(range(2, 9)) and scalar('select status from workhub.cooperation_requests where id=%s', (rid,)) == 'completed', seq)
    det = t[21].get(rid)
    check('L02 상세: 이력 8건 = 판, 1..8 차례, 첫 이력 create', [h['version'] for h in det['history']] == list(range(1, 9)) and det['history'][0]['action'] == 'create', det)
    check('L03 원본 업무 연결은 보낸 사람에게만 보임', det['request']['taskLink'] == {'taskId': tk['id'], 'ownerUserId': T[21]} and t[22].get(rid)['request']['taskLink'] is None)
    check('L04 제3자(m-23) 상세 → NOT_FOUND', ecode(t[23].get(rid)) == 'NOT_FOUND')
    check('L05 다른 학교(m-27) 상세 → NOT_FOUND', ecode(t[27].get(rid)) == 'NOT_FOUND')
    x1 = t[21].mutate(coop_create(M[23], title='거절될 요청'))['entityId']
    x2 = t[21].mutate(coop_create(M[23], title='요청 중 취소'))['entityId']
    x3 = t[21].mutate(coop_create(M[23], title='수락 뒤 취소'))['entityId']
    x4 = t[21].mutate(coop_create(M[23], title='완료 요청 중 취소'))['entityId']
    ok_moves = [mv(t[23], x1, 1, 'decline', '이번 주는 어렵습니다'), mv(t[21], x2, 1, 'cancel', '필요 없어짐'),
                mv(t[23], x3, 1, 'accept', ''), mv(t[21], x3, 2, 'cancel', '취소'),
                mv(t[23], x4, 1, 'accept', ''), mv(t[23], x4, 2, 'request_completion', '완료'), mv(t[21], x4, 3, 'cancel', '취소')]
    check('L06 거절 · 요청 중 취소 · 수락 뒤 취소 · 완료 요청 중 취소 모두 applied',
          all(o.get('outcome') == 'applied' for o in ok_moves)
          and scalar("select string_agg(status, ',' order by title) from workhub.cooperation_requests where id = any(%s)", ([x1, x2, x3, x4],)) == 'declined,cancelled,cancelled,cancelled', ok_moves)
    y = t[21].mutate(coop_create(M[23], title='전이 거부 시험'))['entityId']
    st = state()
    wrong = [('보낸 사람이 수락', mv(t[21], y, 1, 'accept', ''), 'FORBIDDEN'), ('받는 사람이 취소', mv(t[23], y, 1, 'cancel'), 'FORBIDDEN'),
             ('옛 판', mv(t[23], y, 5, 'accept', ''), 'CONFLICT'), ('완료 요청 없이 확인', mv(t[21], y, 1, 'confirm_completion', ''), 'CONFLICT'),
             ('제3자', mv(t[24], y, 1, 'accept', ''), 'NOT_FOUND'), ('거절 사유 공백', mv(t[23], y, 1, 'decline', ' '), 'INVALID_INPUT'),
             ('모르는 동작', mv(t[23], y, 1, 'archive'), 'INVALID_INPUT'), ('끝난 요청 수락', mv(t[22], rid, 8, 'accept', ''), 'CONFLICT'),
             ('취소된 요청 다시 취소', mv(t[21], x2, 2, 'cancel'), 'CONFLICT')]
    check('L07 잘못된 전이 9종 → 각각 정한 코드', all(o[2] == ecode(o[1]) for o in wrong), [(o[0], ecode(o[1])) for o in wrong if o[2] != ecode(o[1])])
    check('L08 잘못된 전이는 요청·이력을 바꾸지 않음', {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'})

    # ======================================================================= M. 협업 — 동시성 · 강제 실패 · 소속 변동
    z = t[21].mutate(coop_create(M[23], title='동시 수락'))['entityId']
    outs = concurrently([lambda: P(T[23], M[23]).mutate(coop_move(z, 1, 'accept', '')), lambda: P(T[23], M[23]).mutate(coop_move(z, 1, 'decline', '안 됨'))],
                        'select 1 from workhub.cooperation_requests where id=%s for update', (z,))
    check('M01 같은 판으로 수락·거절 동시 → 하나만 applied, 다른 하나 CONFLICT, 이력 2', sorted(ecode(o) or 'applied' for o in outs) == ['CONFLICT', 'applied']
          and scalar('select count(*) from workhub.cooperation_history where request_id=%s', (z,)) == 2, outs)
    z2 = t[21].mutate(coop_create(M[23], title='수락 대 취소'))['entityId']
    outs = concurrently([lambda: P(T[23], M[23]).mutate(coop_move(z2, 1, 'accept', '')), lambda: P(T[21], M[21]).mutate(coop_move(z2, 1, 'cancel', '취소'))],
                        'select 1 from workhub.cooperation_requests where id=%s for update', (z2,))
    check('M02 받는 사람 수락 vs 보낸 사람 취소 동시 → 하나만 반영', sorted(ecode(o) or 'applied' for o in outs) == ['CONFLICT', 'applied'], outs)
    kk = key(); cz = coop_create(M[25], title='같은 번호 동시')
    outs = concurrently([lambda: P(T[21], M[21]).mutate(cz, kk), lambda: P(T[21], M[21]).mutate(cz, kk)])
    check('M03 같은 요청 번호 만들기 동시 → applied 1 · replayed 1, 요청 1건', sorted(o.get('outcome') for o in outs) == ['applied', 'replayed']
          and scalar("select count(*) from workhub.cooperation_requests where title='같은 번호 동시'") == 1, outs)
    call(run, """create function public.p2_test_fail() returns trigger language plpgsql as $$
                 begin if new.comment = '강제 실패' then raise exception 'P2_TEST_FAIL'; end if; return new; end $$""")
    call(run, "create trigger p2_test_fail before insert on workhub.cooperation_history for each row execute function public.p2_test_fail()")
    w = t[21].mutate(coop_create(M[23], title='강제 실패 대상'))['entityId']
    kf = key(); st = state()
    out = t[23].mutate(coop_move(w, 1, 'decline', '강제 실패'), kf)
    check('M04 이력 기록 시점 강제 실패 → 봉투 없는 오류, 요청 상태·판·접수증 원상태', out == 'P2_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p2_test_fail on workhub.cooperation_history"); call(run, "drop function public.p2_test_fail()")
    check('M05 원인 제거 뒤 같은 요청 번호 → applied', t[23].mutate(coop_move(w, 1, 'decline', '강제 실패'), kf).get('outcome') == 'applied')
    w2 = t[21].mutate(coop_create(M[26], title='소속 끝남'))['entityId']
    call(run, "update workhub.memberships set valid_to = %s where id='m-26'", (TODAY,))
    check('M06 받는 사람 소속이 끝나면 그 사람의 수락 → INACTIVE_MEMBERSHIP(봉투 없음)', t[26].go('workhub_cooperation_mutate', coop_move(w2, 1, 'accept', ''), key()) == 'INACTIVE_MEMBERSHIP')
    check('M07 소속이 끝난 사람에게 새 요청 → NOT_FOUND, 목록에서도 빠짐', ecode(t[21].mutate(coop_create(M[26]))) == 'NOT_FOUND'
          and M[26] not in [r['memberId'] for r in t[21].catalog()['recipients']])
    check('M08 보낸 사람은 끝난 사람에게 보낸 요청을 취소할 수 있음', t[21].mutate(coop_move(w2, 1, 'cancel', '담당 변경')).get('outcome') == 'applied')
    call(run, "update workhub.memberships set valid_to = null where id='m-26'")
    call(run, "update workhub.accounts set status='suspended' where id='acc-25'")
    check('M09 계정 정지된 교사는 받는 사람 목록에서 빠짐', M[25] not in [r['memberId'] for r in t[21].catalog()['recipients']])
    call(run, "update workhub.accounts set status='active' where id='acc-25'")
    # 2026-10-16 결정 "좁히기": 받는 사람 = 지금 업무실에 들어올 수 있는 사람(기존 회원표 활성 · superadmin)
    call(run, "update public.users set role='teacher' where id=%s", (T[25],))
    check('M10 업무실 자격(superadmin)이 없는 교사는 받는 사람 목록에서 빠지고 새 요청 → NOT_FOUND',
          M[25] not in [r['memberId'] for r in t[21].catalog()['recipients']] and ecode(t[21].mutate(coop_create(M[25]))) == 'NOT_FOUND')
    call(run, "update public.users set role='superadmin', is_active=false where id=%s", (T[25],))
    check('M11 기존 회원표에서 비활성인 사람도 받는 사람 목록에서 빠짐', M[25] not in [r['memberId'] for r in t[21].catalog()['recipients']])
    call(run, "update public.users set is_active=true where id=%s", (T[25],))
    check('M12 자격을 되찾으면 다시 받는 사람 목록에 나옴', M[25] in [r['memberId'] for r in t[21].catalog()['recipients']])

    # ======================================================================= N. 협업 — 목록 · 검색 · 위치 값
    for i in range(45):
        t[25].mutate(coop_create(M[26], title=f'자료 요청 {i:02d}', desc='학년말 정리' if i % 2 else '평가 계획'))
    f1 = t[26].lst('received'); f2 = t[26].lst('received', cursor=f1.get('nextCursor'))
    ids = [r['id'] for r in f1['items'] + f2['items']]
    want = scalar("select jsonb_agg(id order by created_at desc, id collate \"C\" desc) from workhub.cooperation_requests where recipient_membership_id='m-26'")
    check('N01 받은 요청 45건(+앞 요청) → 40 + 나머지, 최신순, 겹침·빠짐 없음', len(f1['items']) == 40 and f2['nextCursor'] is None and ids == want, (len(ids), len(want)))
    check('N02 보낸 함 / 받은 함 구분', all(r['senderMemberId'] == M[25] for r in t[25].lst('sent')['items'])
          and [r['title'] for r in t[25].lst('received')['items']] == ['같은 번호 동시'])
    q = t[26].lst('received', query='학년말')
    check('N03 검색(제목·설명, 대소문자 무시) → 22건', len(q['items']) == 22 and q['nextCursor'] is None, len(q['items']))
    check('N04 상태 필터 cancelled → 끝난 사람에게 보낸 취소 1건', [r['title'] for r in t[26].lst('received', 'cancelled')['items']] == ['소속 끝남'])
    check('N05 다른 필터에 위치 값 재사용 → INVALID_INPUT', ecode(t[26].lst('received', 'requested', cursor=f1['nextCursor'])) == 'INVALID_INPUT')
    check('N06 다른 사람이 위치 값 사용 → INVALID_INPUT', ecode(t[25].lst('received', cursor=f1['nextCursor'])) == 'INVALID_INPUT')
    check('N07 필터 형식 오류(모르는 함·상태·항목) → INVALID_INPUT',
          [ecode(t[26].go('workhub_cooperation_list', x)) for x in ({'box': 'all', 'status': 'all', 'query': '', 'cursor': None},
                                                                     {'box': 'sent', 'status': 'done', 'query': '', 'cursor': None},
                                                                     {'box': 'sent', 'status': 'all', 'query': '', 'cursor': None, 'x': 1})] == ['INVALID_INPUT'] * 3)

    # ======================================================================= O. 협업 중지·재개
    kr = key(); cr = coop_create(M[24], title='중지 전 요청'); rr = t[21].mutate(cr, kr)
    sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'cooperation', '2026-10-16 협업 시험 중지'))
    st = state()
    check('O01 중지 → 목록·상세·받는 사람 UNAVAILABLE, 새 변경 UNAVAILABLE',
          [ecode(t[21].catalog()), ecode(t[21].lst()), ecode(t[21].get(rid)), ecode(t[21].mutate(coop_create(M[24])))] == ['UNAVAILABLE'] * 4)
    check('O02 중지 중 이미 반영된 요청 재조회 → 처음 결과', body(t[21].mutate(cr, kr), 'outcome') == body(rr, 'outcome'))
    check('O03 중지 중 요청 자료 변경 0', {k: v for k, v in state().items() if k != 'request_receipts'} == {k: v for k, v in st.items() if k != 'request_receipts'})
    check('O04 다른 학교 협업은 계속 동작(학교별 중지)', ecode(t[27].catalog()) is None)
    sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'cooperation', '2026-10-16 협업 시험 재개'))
    check('O05 재개 → 상세 다시 열림, 판 그대로', t[21].get(rid)['request']['version'] == 8)

    # ======================================================================= P. 마무리 점검
    post = sqlfile('P2-03_사후점검.sql')
    check('P01 P2-03 사후 점검 FAIL 없음(반영 접수증 = 적용 묶음, 계보·이력 정합)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] not in ('ok', 'info')])
    check('P02 R0 일정·업무 호환 함수는 그대로 동작', isinstance(call(api(T[21]), 'select public.workhub_task_list(%s)', (M[21],)), list))
    check('P03 P1 학교 관리 준비 상태 함수 그대로(활성화 전 not_configured)',
          (call(api(U1), 'select public.workhub_school_admin_readiness(%s)', (m1,)) or {}).get('data') == {'available': False, 'reason': 'not_configured'})

    if OUT:
        json.dump({'captures': captures}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'합계: PASS {sum(1 for _, ok in results if ok)} · FAIL {sum(1 for _, ok in results if not ok)}')
    sys.exit(0 if all(ok for _, ok in results) else 1)


if __name__ == '__main__':
    main()
