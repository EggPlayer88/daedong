# P7 수합 운영 · 홈 요약 · 업무 인계 · 새 학년도 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# 받은 응답은 P7_CAPTURE 에 남겨 app_contract_p7.ts 가 PR #48 앱의 실제 서비스 · parser 에 넣는다.
#
# 사용: python3 run_p7.py      (R1 + P1 + P2 + P3 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다. P5 는 있어도 없어도 된다)
#   P7_BRIDGE=0 이면 P7-05(R1 · P2 보강, 별도 승인) 단계를 건너뛴다(보강 없는 운영 순서만 시험).
import datetime, json, os, sys, threading, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, coll_input, worker_call, U1, U2, T, M, TODAY, results)
import run_r1

S = os.path.join(HERE, '..')
P1 = os.path.join(HERE, '..', '..', 'p1')
P2 = os.path.join(HERE, '..', '..', 'p2')
P3 = os.path.join(HERE, '..', '..', 'p3')
R1 = os.environ['R1_DIR']
OUT = os.environ.get('P7_CAPTURE', '')
BRIDGE = os.environ.get('P7_BRIDGE', '1') != '0'
captures = []
U29, U30, U31 = ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000031')
DAY = lambda n=0: (TODAY + datetime.timedelta(days=n)).isoformat()


# ----------------------------------------------------------------------------- 도구
def sqlfile(name, user='postgres', text=None, base=None):
    a = admin(user); cur = a.cursor()
    try:
        cur.execute(text if text is not None else open(os.path.join(base or S, name), encoding='utf-8').read())
        return cur.fetchall() if cur.description else None
    finally:
        a.close()

def sqlerr(text, user='postgres'):
    try:
        sqlfile(None, user, text); return 'OK'
    except psycopg2.Error as e:
        return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)

def src(name, base=None): return open(os.path.join(base or S, name), encoding='utf-8').read()
def module_sql(name, school, module, note):
    t = src(name, P2)
    for k, v in {'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>': school, '<모듈: calendar_batch · cooperation 등>': module, '<사유: 날짜와 이유>': note}.items():
        t = t.replace(k, v)
    return t
def stop(module, note='점검'): sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', module, note))
def resume(module, note='점검 끝'): sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', module, note))
def fingerprint(): return [r for r in sqlfile('P7-00_사전점검_지문.sql') if r[0] == '지문']

P7_TABLES = ['operation_requests', 'collection_operations', 'collection_operation_history', 'collection_reminders',
             'transition_records', 'transition_items', 'transition_history']
def state():
    """P7 표 전부 + P7 이 쓰는 기존 표(수합 · 협업 · 학교 관리 · 학년도 · 알림 · 감사)의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P7_TABLES
                     + ['collections', 'cooperation_requests', 'cooperation_history', 'staff_assignments', 'school_admin_activations',
                        'academic_years', 'terms', 'year_departments', 'notifications', 'module_activations'])
    return scalar(f"select jsonb_build_object({parts}, 'audit', (select count(*) from workhub.audit_events), 'outbox', (select count(*) from workhub.outbox))")
def n(table, where='true', args=()): return scalar(f'select count(*) from workhub.{table} where {where}', args)
def ok(env): return isinstance(env, dict) and 'data' in env
def ecode(env):
    if isinstance(env, dict): return (env.get('error') or {}).get('code')
    return env
def concurrently(fns):
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    for t in ts: t.join()
    return outs


class O(Who):
    """P7 RPC. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
    def ctx(self):
        try: return call(self.c, 'select public.workhub_context()')
        except psycopg2.Error: return None
    def keep(self, kind, raw, **extra):
        if OUT:
            captures.append({'kind': kind, 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid},
                             'context': self.ctx(), 'raw': raw if isinstance(raw, dict) else None,
                             'error': None if isinstance(raw, dict) else raw, **extra})
        return raw
    def go(self, fn, *args):
        try: return self.rpc(fn, *args)
        except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
    def ops(self, rid): return self.keep('ops_get', self.go('workhub_collection_operations_get', rid), requestId=rid)
    def opm(self, cmd, k=None):
        k = k or key(); return self.keep('ops_mutate', self.go('workhub_collection_operations_mutate', cmd, k), command=cmd, key=k)
    def home(self): return self.keep('home', self.go('workhub_home_overview'))
    def tl(self, cursor=None): return self.keep('tr_list', self.go('workhub_school_transition_list', cursor), cursor=cursor)
    # 미리보기 · 명령 직전의 목록도 남긴다 — PR #60 앱은 보내기 전에 목록으로 서버 판(관리자 확인 계약)을 확인한다(읽기 전용)
    def listed(self):
        if not OUT: return {}
        raw = self.go('workhub_school_transition_list', None)
        return {'listRaw': raw if isinstance(raw, dict) else None}
    def duty(self, cmd):
        if not OUT or not isinstance(cmd, dict): return {}
        if cmd.get('kind') == 'apply':
            return {'dutyRecord': any(r.get('kind') == 'duty' for r in (cmd.get('plan') or {}).get('resources') or [])}
        return {'dutyRecord': bool(scalar("select count(*) from workhub.transition_items where record_id = %s and kind = 'duty'", (str(cmd.get('recordId')),)))}
    def tp(self, plan):
        extra = self.listed(); return self.keep('tr_preview', self.go('workhub_school_transition_preview', plan), plan=plan, **extra, **self.duty({'kind': 'apply', 'plan': plan}))
    def tm(self, cmd, k=None):
        k = k or key(); extra = {**self.listed(), **self.duty(cmd)}
        return self.keep('tr_mutate', self.go('workhub_school_transition_mutate', cmd, k), command=cmd, key=k, **extra)
    def r1(self, cmd): return self.mutate(cmd)


def oc(kind, rid, ver, reason='운영 메모', **kw): return {'kind': kind, 'requestId': rid, 'expectedVersion': ver, 'reason': reason, **kw}
def rcp(unit, member, ver): return {'unitId': unit, 'memberId': member, 'expectedVersion': ver}
def ho(recipient, rver, resources, note='인계 메모입니다'):
    return {'kind': 'handover', 'recipientMemberId': recipient, 'recipientVersion': rver, 'resources': resources, 'note': note}
def res(kind, rid, ver, label='자원'): return {'kind': kind, 'id': rid, 'version': ver, 'label': label}
def ny(source, year, first, last, t1f, t1l, t2f, t2l, copy=True):
    return {'kind': 'new_year', 'sourceYearId': source, 'targetYear': year, 'firstDay': first, 'lastDay': last, 'term1First': t1f,
            'term1Last': t1l, 'term2First': t2f, 'term2Last': t2l, 'copyStructure': copy}
def apply(plan, fp): return {'kind': 'apply', 'plan': plan, 'fingerprint': fp}
def act(kind, rid, ver, reason='확인했습니다'): return {'kind': kind, 'recordId': rid, 'expectedVersion': ver, 'reason': reason}
def mver(m): return scalar('select version from workhub.memberships where id=%s', (m,))
def rev(s): return scalar('select revision from workhub.school_admin_activations where school_id=%s', (s,))


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    y_start, y_end = scalar("select array[starts_on::text, ends_on::text] from workhub.academic_years where id=%s", (year,))
    y_school = scalar("select school_year from workhub.academic_years where id=%s", (year,))
    run = admin()
    # 같은 이름 교사 2명(22·23), 가입 대기(29)·거절(30)·정지(31), 업무실 자격 없는 교사(U2 = legacy teacher)
    call(run, "update workhub.accounts set display_name='김하늘' where id in ('acc-22','acc-23')")
    call(run, f"""insert into auth.users(id,email,raw_user_meta_data) values
        ('{U29}','t29@x.kr','{{"full_name":"대기교사"}}'),('{U30}','t30@x.kr','{{"full_name":"거절교사"}}'),('{U31}','t31@x.kr','{{"full_name":"정지교사"}}')""")
    call(run, "update public.users set role='superadmin', is_active=true where id = any(%s)", ([U29, U30, U31],))
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-'||right(id,3), id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = any(%s)""", ([U29, U30, U31],))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type) values ('m-29', %s, 'acc-029', 'pending', 'teacher')", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, decided_at) values ('m-30', %s, 'acc-030', 'rejected', 'teacher', now())", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-31', %s, 'acc-031', 'suspended', 'teacher', %s, now())", (s1, y_start))
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-u2', id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = %s""", (U2,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-u2', %s, 'acc-u2', 'active', 'teacher', %s, now())", (s1, y_start))
    # 다른 학교(school-2): m-27 을 그 학교 관리자로, 학년도 1개
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    call(run, "insert into workhub.academic_years(id, school_id, school_year, starts_on, ends_on, state) values ('y2-2026', 'school-2', %s, %s, %s, 'current')", (y_school, y_start, y_end))
    # 학교 구성(P1 정의) — 새 학년도 복사 대상: 부서 2 · 학급 2(하나는 지운 행) · 교과 1
    call(run, """insert into workhub.year_departments(id, school_id, academic_year_id, name, sort_order) values ('dep-1', %s, %s, '교무부', 1), ('dep-2', %s, %s, '연구부', 2)""", (s1, year, s1, year))
    call(run, """insert into workhub.year_classes(id, school_id, academic_year_id, grade, class_no, name, kind, sort_order, removed_at)
                 values ('cls-11', %s, %s, 1, 1, '1-1', 'regular', 1, null), ('cls-12', %s, %s, 1, 2, '1-2', 'regular', 2, now())""", (s1, year, s1, year))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-1', %s, %s, '국어', 1)", (s1, year))
    # 공식 담당(일반 업무): 21 · 25 · 다른 학교 27. 오늘 시작한 담당(21, 인계 목록에 안 나옴)
    for aid, m, label, vf in (('duty-21', 'm-21', '방과후 업무', DAY(-20)), ('duty-21b', 'm-21', '정보 업무', DAY(-20)), ('duty-21c', 'm-21', '오늘 시작 업무', DAY(0)),
                              ('duty-25', 'm-25', '도서 업무', DAY(-20))):
        call(run, """insert into workhub.staff_assignments(id, school_id, academic_year_id, membership_id, kind, label, valid_from, valid_to, assigned_by_membership_id)
                     values (%s, %s, %s, %s, 'duty', %s, %s, %s, %s)""", (aid, s1, year, m, label, vf, y_end, m1))

    # R1 정책 · 작업자(합성 값) → 관리자(U1)가 수합 2건 게시(검토형 A · 무검토 B), 초안 1건
    sqlfile(None, text=fill_json(f'{R1}/R1-06_정책게시_양식.sql', {
        'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'effective_from': DAY(-1),
        'common_file_safety': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 10000000, 'maxFiles': 5, 'allowUnscanned': False},
        'school_file_upload': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 8000000, 'maxFiles': 4, 'allowUnscanned': False, 'uploadTtlMinutes': 30},
        'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 14, 'unattachedRetentionDays': 7}}))
    sqlfile(None, text=fill_json(f'{R1}/R1-05_검증작업자연결_양식.sql', {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)'}))
    run_r1.WORKER = api(None, 'service_role')
    worker_call('workhub_file_worker_heartbeat', s1, 'w1', {'checks': ['size', 'sha256', 'signature', 'container', 'encryption', 'malware'], 'release': 'test-1'}, 1800)
    adm = O(U1, m1)
    t = {k: O(T[k], M[k]) for k in (21, 22, 23, 24, 25, 26, 27, 28)}
    CA = data(adm.r1({'kind': 'create', 'input': coll_input(title='연수 결과 보고 수합', dueDate=DAY(1))}))['resourceId']
    adm.r1({'kind': 'publish', 'requestId': CA, 'expectedVersion': 1})
    _cb = adm.r1({'kind': 'create', 'input': coll_input(title='무검토 설문', reviewMode='none', reviewerMemberId='',
                                                       units=[{'label': '전체', 'responsibleMemberId': M[25], 'contributorMemberIds': []}])})
    assert data(_cb), f'무검토 수합 준비 실패: {_cb}'
    CB = data(_cb)['resourceId']
    adm.r1({'kind': 'publish', 'requestId': CB, 'expectedVersion': 1})
    CD = data(adm.r1({'kind': 'create', 'input': coll_input(title='초안 수합')}))['resourceId']
    assert scalar("select count(*) from workhub.collections where state='published'") == 2, '수합 게시 준비 실패'
    units = scalar("select jsonb_agg(jsonb_build_object('id',id,'resp',responsible_membership_id,'v',version) order by ordinal) from workhub.collection_units where collection_id=%s", (CA,))
    uA, uB = units[0]['id'], units[1]['id']
    uC = scalar("select id from workhub.collection_units where collection_id=%s", (CB,))
    uv = lambda u: scalar("select version from workhub.collection_units where id=%s", (u,))
    # A단위: 21 이 제출 → 24 가 승인 / B단위: 미제출 / 무검토 C: 25 미제출
    dA = data(t[21].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uA, 'expectedVersion': 0, 'input': {'text': '보고', 'number': 1, 'files': []}}))
    sA = data(t[21].r1({'kind': 'submit', 'requestId': CA, 'unitId': uA, 'draftId': dA['resourceId'], 'expectedDraftVersion': 1, 'expectedVersion': 1, 'reason': ''}))
    assert sA, '제출 준비 실패'
    subA = scalar("select effective_submission_id from workhub.collection_units where id=%s", (uA,)) or scalar("select current_submission_id from workhub.collection_units where id=%s", (uA,))

    # ======================================================================= A. 설치 전 지문 → P7-01·02·03 → 지문 비교
    before = fingerprint()
    r104_before = {r[0]: r for r in sqlfile('R1-04_사후점검.sql', base=R1)}
    pre = [r for r in sqlfile('P7-00_사전점검_지문.sql') if r[0] == '점검']
    check('A01 P7-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    sqlfile('P7-01_운영_전환_모델.sql'); sqlfile('P7-02_운영_전환_공개함수.sql')
    post = sqlfile('P7-03_사후점검.sql')
    check('A02 P7-03 사후 점검 FAIL 없음, 활성화 없음, 보강 미적용', all(r[2] in ('ok', 'info') for r in post) and len(post) == 12
          and dict((r[0], r[3]) for r in post)['P7-03-10'] == '(활성화 없음)' and dict((r[0], r[3]) for r in post)['P7-03-11'].startswith('미적용'), post)
    after = fingerprint()
    check('A03 P7-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A04 P7-01 다시 실행 → 멈춤', 'P7-01 이 이미 적용되었습니다' in sqlerr(src('P7-01_운영_전환_모델.sql')))
    check('A05 P7-02 다시 실행 → 멈춤', 'P7-02 가 이미 적용되었습니다' in sqlerr(src('P7-02_운영_전환_공개함수.sql')))

    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 P7 함수 실행 불가', all('permission denied' in err(c, sql) for sql in (
        "select public.workhub_home_overview('m-21')", "select public.workhub_collection_operations_get('m-21','x')",
        "select public.workhub_school_transition_mutate('m-21','{}'::jsonb,'kkkkkkkk')")))
    c = api(T[21])
    check('B02 authenticated 는 새 표 직접 읽기 · 내부 함수 실행 불가', all('permission denied' in err(c, f'select * from workhub.{x}') for x in P7_TABLES)
          and 'permission denied' in err(c, "select workhub_private.p7_installed()"))
    check('B03 service_role 은 P7 함수 실행 불가(사람 전용)', 'permission denied' in err(api(None, 'service_role'), "select public.workhub_home_overview('m-21')"))
    check('B04 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', O(U2, 'm-u2').home() == 'FORBIDDEN' and O(U2, 'm-u2').tl() == 'FORBIDDEN')
    check('B05 다른 학교 소속 ID(m-27, 21 계정) · 소속 끝난 교사(m-28) → INACTIVE_MEMBERSHIP',
          O(T[21], M[27]).home() == 'INACTIVE_MEMBERSHIP' and t[28].home() == 'INACTIVE_MEMBERSHIP' and t[28].opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], 1)])) == 'INACTIVE_MEMBERSHIP')
    check('B06 가입 대기(m-29)·거절(m-30)·정지(m-31) → INACTIVE_MEMBERSHIP',
          [O(u, m).home() for u, m in ((U29, 'm-29'), (U30, 'm-30'), (U31, 'm-31'))] == ['INACTIVE_MEMBERSHIP'] * 3)
    st = state()
    got = [ecode(adm.ops(CA)), ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], 1)]))), ecode(t[21].home()), ecode(t[21].tl()),
           ecode(t[21].tp(ho(M[22], 1, [res('duty', 'duty-21', 1)]))), ecode(t[21].tm(apply(ho(M[22], 1, [res('duty', 'duty-21', 1)]), 'a' * 64)))]
    check('B07 설치만 → 6개 함수 모두 NOT_READY(봉투) · 변경 0', got == ['NOT_READY'] * 6 and state() == st, got)

    # ======================================================================= C. 활성화 양식(P7-04) · 선행 모듈 켜기
    p74 = os.path.join(S, 'P7-04_모듈활성화_양식.sql')
    check('C01 빈 칸이 남은 P7-04 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P7-04_모듈활성화_양식.sql')))
    check('C02 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(fill_json(p74, {'approver_user_id': T[21], 'approval_ref': '시험', 'modules': ['home']})))
    check('C03 모르는 모듈 · 중복 · 0개 · 근거 빈칸 → 멈춤', all('중단' in sqlerr(fill_json(p74, v)) for v in (
        {'approver_user_id': U1, 'approval_ref': '시험', 'modules': ['assistant']}, {'approver_user_id': U1, 'approval_ref': '시험', 'modules': ['home', 'home']},
        {'approver_user_id': U1, 'approval_ref': '시험', 'modules': []}, {'approver_user_id': U1, 'approval_ref': ' ', 'modules': ['home']})))
    check('C04 멈춘 P7-04 는 아무것도 쓰지 않음', state() == st)
    check('C05 P7-04 정상 실행(수합 운영 · 홈 · 업무 전환)', sqlerr(fill_json(p74, {'approver_user_id': U1, 'approval_ref': '2026-10-20 시범 승인(시험)',
                                                                       'modules': ['collection_ops', 'home', 'transitions']})) == 'OK'
          and n('module_activations', "module in ('collection_ops','home','transitions') and state='active'") == 3)
    check('C06 같은 모듈 다시 → 멈춤', '이미 활성화 행이 있습니다' in sqlerr(fill_json(p74, {'approver_user_id': U1, 'approval_ref': '다시', 'modules': ['home']})))
    check('C07 다른 학교는 여전히 NOT_READY', ecode(t[27].home()) == 'NOT_READY')
    # 선행: 학교 관리(P1-04) · 협업(P2-04) · 메신저(P3-04)
    sqlfile(None, text=fill_json(os.path.join(P1, 'P1-04_학교활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인'}))
    sqlfile(None, text=fill_json(os.path.join(P2, 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'modules': ['cooperation']}))

    # ======================================================================= D. 수합 운영 — 읽기
    g = adm.ops(CA); d = data(g) or {}
    check('D01 관리자: open · 판 1 · 기한 = R1 기한 · 단위 2(A 제출 · B 미제출) · 합계 일치', d.get('phase') == 'open' and d.get('version') == 1
          and d.get('dueDate') == DAY(1) and d.get('canManage') is True
          and [(u['id'], u['state'], u['responsibleMemberId']) for u in d.get('units', [])] == [(uA, 'submitted', M[21]), (uB, 'missing', M[23])]
          and d.get('totals') == {'total': 2, 'missing': 1, 'submitted': 1, 'accepted': 0, 'changesRequested': 0}, g)
    g23 = data(t[23].ops(CA)) or {}
    check('D02 단위 구성원(23): 관리 불가 · 단위 목록 비움 · 자기 단위 합계만', g23.get('canManage') is False and g23.get('units') == []
          and g23.get('totals') == {'total': 1, 'missing': 1, 'submitted': 0, 'accepted': 0, 'changesRequested': 0}, g23)
    g24 = data(t[24].ops(CA)) or {}
    check('D03 지정 검토자(24): 관리 불가 · 모든 단위 합계', g24.get('canManage') is False and g24.get('units') == [] and g24.get('totals', {}).get('total') == 2, g24)
    got = [ecode(t[25].ops(CA)), ecode(t[27].ops(CA)), ecode(adm.ops(CD)), ecode(adm.ops('nope'))]
    check('D04 관계없는 교사(25) · 초안 수합 · 없는 ID → NOT_FOUND, 다른 학교(27)는 그 학교 활성화가 없어 NOT_READY', got == ['NOT_FOUND', 'NOT_READY', 'NOT_FOUND', 'NOT_FOUND'], got)
    check('D05 ID 형식 틀림(공백 · 101자) → INVALID_INPUT', ecode(adm.ops('a b')) == 'INVALID_INPUT' and ecode(adm.ops('a' * 101)) == 'INVALID_INPUT')
    t[24].r1({'kind': 'review', 'requestId': CA, 'unitId': uA, 'submissionId': subA, 'expectedVersion': uv(uA), 'decision': 'accepted', 'note': '', 'dueDate': ''})
    d = data(adm.ops(CA)) or {}
    check('D06 검토 승인 뒤 A단위 accepted', [u['state'] for u in d.get('units', [])] == ['accepted', 'missing'] and d['totals']['accepted'] == 1, d)

    # ======================================================================= E. 수합 운영 — 제출 알림(보강 없이도 됨)
    st = state()
    r = adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))]))
    check('E01 메신저가 꺼져 있으면 알림 → NOT_READY · 변경 0', ecode(r) == 'NOT_READY' and state() == st, r)
    sqlfile(None, text=fill_json(os.path.join(P3, 'P3-04_메시지활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'body_characters': 2000,
                                                                              'title_characters': 100, 'recipients': 60}))
    st = state()
    check('E02 마감 · 연장 · 보관 · 재개 → 보강(P7-05) 전 NOT_READY · 변경 0',
          [ecode(adm.opm(oc('close', CA, 1))), ecode(adm.opm(oc('extend', CA, 1, dueDate=DAY(5)))), ecode(adm.opm(oc('archive', CA, 1))),
           ecode(adm.opm(oc('reopen', CA, 1, dueDate=DAY(5))))] == ['NOT_READY'] * 4 and state() == st)
    bad = [oc('remind', CA, 1, recipients=[]), oc('remind', CA, 1, recipients=[rcp(uB, M[23], 1), rcp(uB, M[23], 1)]), oc('remind', CA, 0, recipients=[rcp(uB, M[23], 1)]),
           oc('remind', CA, 1, reason=' ', recipients=[rcp(uB, M[23], 1)]), oc('remind', CA, 1, reason='a' * 1001, recipients=[rcp(uB, M[23], 1)]),
           {**oc('remind', CA, 1, recipients=[rcp(uB, M[23], 1)]), 'extra': 1}, oc('close', CA, 1, dueDate=DAY(3)), oc('extend', CA, 1, dueDate='2026-02-30'),
           oc('remind', CA, '1', recipients=[rcp(uB, M[23], 1)]), oc('remind', CA, 1, recipients=[{'unitId': uB, 'memberId': M[23]}]),
           oc('shout', CA, 1), oc('remind', CA, 1, reason='줄\u0007바꿈', recipients=[rcp(uB, M[23], 1)])]
    got = [ecode(adm.opm(x)) for x in bad]
    check('E03 모양이 틀린 명령 12종 → INVALID_INPUT · 변경 0', got == ['INVALID_INPUT'] * 12 and state() == st, got)
    check('E04 요청 번호 7자 · 허용 밖 문자 → INVALID_INPUT', ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))]), 'k-12345')) == 'INVALID_INPUT'
          and ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))]), 'k:1234567')) == 'INVALID_INPUT')
    check('E05 관리자가 아닌 단위 구성원(23) · 검토자(24) → FORBIDDEN, 관계없는 25 → NOT_FOUND',
          [ecode(t[23].opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))]))), ecode(t[24].opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))]))),
           ecode(t[25].opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB))])))] == ['FORBIDDEN', 'FORBIDDEN', 'NOT_FOUND'])
    got = [ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uA, M[21], uv(uA))]))), ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[21], uv(uB))]))),
           ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB) + 1)]))), ecode(adm.opm(oc('remind', CA, 2, recipients=[rcp(uB, M[23], uv(uB))]))),
           ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp(uB, M[23], uv(uB)), rcp(uA, M[21], uv(uA))]))),
           ecode(adm.opm(oc('remind', CA, 1, recipients=[rcp('nope', M[23], 1)])))]
    check('E06 이미 승인된 단위 · 담당자 아님 · 단위 판 다름 · 운영 판 다름 · 하나라도 틀린 묶음 → CONFLICT, 없는 단위 → NOT_FOUND · 변경 0',
          got == ['CONFLICT'] * 5 + ['NOT_FOUND'] and state() == st, got)
    k = key(); cmd = oc('remind', CA, 1, reason='오늘까지 제출 부탁드립니다', recipients=[rcp(uB, M[23], uv(uB))])
    r = adm.opm(cmd, k); d = data(r) or {}
    check('E07 제출 알림 → 판 2 · 알림 1(23에게, 수합 출처) · 이력 remind · 감사', d.get('version') == 2 and d.get('requestKey') == k and d.get('requestId') == CA
          and d.get('recordedAt', '').endswith('Z') and n('collection_reminders') == 1
          and scalar("select count(*) from workhub.notifications where owner_membership_id='m-23' and source_module='collections' and source_id=%s", (CA,)) == 1
          and n('collection_operation_history', "kind='remind' and version=2") == 1 and n('audit_events', "operation='collection_ops.remind'") == 1, r)
    nid, nv = scalar("select array[id, version::text] from workhub.notifications where owner_membership_id='m-23' and source_module='collections' order by created_at desc limit 1")
    rn = call(api(T[23]), "select public.workhub_message_mutate('m-23', %s::jsonb, %s, false)", (json.dumps({'kind': 'read_notice', 'noticeId': nid, 'expectedVersion': int(nv)}), key()))
    check('E07a 알림을 읽어도 제출 상태는 그대로(미제출) · 운영판 그대로', isinstance(rn, dict) and rn.get('ok') is True
          and [u['state'] for u in data(adm.ops(CA))['units']] == ['accepted', 'missing'] and data(adm.ops(CA))['version'] == 2, rn)
    st = state()
    r2 = adm.opm(cmd, k)
    check('E08 응답 유실 뒤 같은 번호 · 같은 내용 → 처음 응답 그대로 · 쓰기 0', r2 == r and state() == st, r2)
    check('E09 같은 번호 · 다른 내용 → IDEMPOTENCY_CONFLICT · 쓰기 0', ecode(adm.opm({**cmd, 'reason': '다른 문구'}, k)) == 'IDEMPOTENCY_CONFLICT' and state() == st)
    check('E10 같은 번호를 다른 사람(24)이 쓰면 따로(그 사람 기준 판정 → FORBIDDEN)', ecode(t[24].opm(cmd, k)) == 'FORBIDDEN')
    k3 = key(); cmd3 = oc('remind', CA, 2, recipients=[rcp(uB, M[23], uv(uB))])
    outs = concurrently([lambda: adm.opm(cmd3, k3), lambda: adm.opm(cmd3, k3), lambda: adm.opm(cmd3, k3)])
    check('E11 같은 번호 동시 3번 → 한 번만 반영 · 셋 다 같은 응답', all(o == outs[0] for o in outs) and ok(outs[0]) and data(outs[0])['version'] == 3
          and n('collection_reminders') == 2, outs)
    outs = concurrently([lambda: adm.opm(oc('remind', CA, 3, recipients=[rcp(uB, M[23], uv(uB))])), lambda: adm.opm(oc('remind', CA, 3, recipients=[rcp(uB, M[23], uv(uB))]))])
    check('E12 다른 번호 · 같은 기대 판 동시 2번 → 하나만 판 4, 하나는 CONFLICT', sorted([data(o)['version'] if ok(o) else ecode(o) for o in outs], key=str) == [4, 'CONFLICT'], outs)
    st = state()
    sqlfile(None, text="""create function workhub_private.p7_test_fail() returns trigger language plpgsql as $$ begin raise exception 'P7_TEST_FAILURE'; end $$;
                          create trigger p7_test_fail before insert on workhub.collection_reminders for each row execute function workhub_private.p7_test_fail();""")
    r = adm.opm(oc('remind', CA, 4, recipients=[rcp(uB, M[23], uv(uB))]))
    sqlfile(None, text="drop trigger p7_test_fail on workhub.collection_reminders; drop function workhub_private.p7_test_fail();")
    check('E13 중간 강제 실패(알림 기록 단계) → 봉투 없는 오류(앱: RESULT_UNKNOWN) · 운영판 · 이력 · 알림 · 원장 모두 되돌림', r == 'P7_TEST_FAILURE' and state() == st, r)
    call(run, "update workhub.memberships set status='suspended' where id='m-23'")
    check('E14 받는 사람 소속이 정지되면 알림 → CONFLICT', ecode(adm.opm(oc('remind', CA, 4, recipients=[rcp(uB, M[23], uv(uB))]))) == 'CONFLICT')
    call(run, "update workhub.memberships set status='active' where id='m-23'")
    stop('collection_ops')
    check('E15 수합 운영 중지(P2-80) → 읽기 · 쓰기 NOT_READY, 같은 번호 재전송은 처음 응답', ecode(adm.ops(CA)) == 'NOT_READY'
          and ecode(adm.opm(oc('remind', CA, 4, recipients=[rcp(uB, M[23], uv(uB))]))) == 'NOT_READY' and adm.opm(cmd, k) == r2)
    resume('collection_ops')
    check('E16 재개(P2-81) 뒤 다시 읽힘', ok(adm.ops(CA)))

    # ======================================================================= F. 홈 요약
    # 23 에게 협업 요청 1(21→23) · 메시지 1(21→23), 25 는 무검토 수합 미제출
    co = call(api(T[21]), "select public.workhub_cooperation_mutate('m-21', %s::jsonb, %s)",
              (json.dumps({'kind': 'create', 'recipientMemberId': M[23], 'title': '평가 자료 협조', 'description': '부탁드립니다', 'dueDate': DAY(0), 'sourceTask': None}, ensure_ascii=False), key()))
    COOP = scalar("select id from workhub.cooperation_requests where title='평가 자료 협조'")
    msg = call(api(T[21]), "select public.workhub_message_mutate('m-21', %s::jsonb, %s, false)",
               (json.dumps({'kind': 'start', 'mode': 'direct', 'recipients': [{'memberId': M[23], 'expectedVersion': mver(M[23])}], 'title': '', 'body': '확인 부탁해요', 'attachmentIds': []}, ensure_ascii=False), key()))
    check('F00 준비: 협업 요청 · 메시지 각 1', COOP is not None and n('message_threads') == 1, (co, msg))
    h = t[23].home(); d = data(h) or {}
    p5 = scalar("select to_regclass('workhub_private.p5_installs') is not null")
    check('F01 23 의 홈: 수합 미제출 1 · 협업 1 · 메시지 1 · 보완 0 · 학생 후속 unavailable(' + ('P5 설치만, 수업 모듈 꺼짐' if p5 else 'P5 없음') + ')',
          d.get('counts') == {'collection': 1, 'supplement': 0, 'message': 1, 'student_followup': None, 'cooperation': 1}
          and d.get('unavailable') == ['student_followup'] and len(d.get('items', [])) == 3, h)
    kinds = [i['kind'] for i in d.get('items', [])]
    check('F02 정렬: 급한 것(기한 내일까지) 먼저 → 기한 순 → 기한 없음 뒤 · 항목 출처 ID', kinds[:2] == ['cooperation', 'collection'] and kinds[2] == 'message'
          and [i['priority'] for i in d['items']] == ['urgent', 'urgent', 'normal'] and d['items'][1]['sourceId'] == CA and d['items'][0]['sourceId'] == COOP
          and d['items'][2]['dueDate'] is None and d['items'][1]['label'] == '미제출', d.get('items'))
    d21 = data(t[21].home()) or {}
    check('F03 21 의 홈: 제출 끝낸 수합 · 보낸 협업 요청(대기) · 자기 메시지는 세지 않음', d21.get('counts', {}).get('collection') == 0 and d21['counts']['cooperation'] == 0
          and d21['counts']['message'] == 0 and d21.get('items') == [], d21)
    d25 = data(t[25].home()) or {}
    check('F04 무검토 수합 담당(25): 수합 1 · 기한 7일 뒤라 normal', d25.get('counts', {}).get('collection') == 1 and d25['items'][0]['priority'] == 'normal', d25)
    d27 = data(t[27].home())
    check('F05 다른 학교(27) 홈은 그 학교 활성화가 없어 NOT_READY', ecode(t[27].home()) == 'NOT_READY', d27)
    rd = call(api(T[23]), "select public.workhub_message_mutate('m-23', %s::jsonb, %s, false)",
         (json.dumps({'kind': 'read_thread', 'threadId': scalar("select id from workhub.message_threads limit 1"), 'throughSequence': scalar("select latest_sequence from workhub.message_threads limit 1")}), key()))
    check('F06 메시지를 읽으면 메시지 0', (data(t[23].home()) or {}).get('counts', {}).get('message') == 0, rd)
    stop('messaging'); stop('cooperation')
    d = data(t[23].home()) or {}
    check('F07 메신저 · 협업 중지 → 그 칸 null + unavailable, 항목에서도 빠짐', d.get('counts', {}).get('message') is None and d['counts']['cooperation'] is None
          and set(d.get('unavailable', [])) >= {'message', 'cooperation'} and all(i['kind'] not in ('message', 'cooperation') for i in d['items']), d)
    resume('messaging'); resume('cooperation')
    stop('home')
    check('F08 홈 중지 → NOT_READY', ecode(t[23].home()) == 'NOT_READY')
    resume('home')
    # 항목 8건 한도: 25 에게 협업 요청 9건
    for i in range(9):
        call(api(T[21]), "select public.workhub_cooperation_mutate('m-21', %s::jsonb, %s)",
             (json.dumps({'kind': 'create', 'recipientMemberId': M[25], 'title': f'요청 {i}', 'description': '', 'dueDate': DAY(i), 'sourceTask': None}, ensure_ascii=False), key()))
    d = data(t[25].home()) or {}
    check('F09 할 일 10건 → 개수는 전부(협업 9) · 항목은 8건 · 같은 종류+출처 중복 없음', d.get('counts', {}).get('cooperation') == 9 and len(d.get('items', [])) == 8
          and len({(i['kind'], i['sourceId']) for i in d['items']}) == 8, d)
    if p5:
        # 학생 후속(P5 가 있을 때): 수업 모듈을 켜고, 22 의 활동 근거 관찰이 '근거 바뀜(재검토)'이 되면 홈에 수업 하나당 항목 1
        sys.path.insert(0, os.path.join(HERE, '..', '..', 'p5', 'test'))
        import run_p5 as P5T
        check('F10 P5 설치만(수업 모듈 꺼짐) → 학생 후속 null + unavailable', (data(t[22].home()) or {}).get('counts', {}).get('student_followup', 'x') is None)
        sqlfile(None, text=fill_json(os.path.join(HERE, '..', '..', 'p5', 'P5-04_수업모듈활성화_양식.sql'),
                                     {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'counseling_scope': 'course_teachers'}))
        term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
        t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
        q22, qadm = P5T.Q(T[22], M[22]), P5T.Q(U1, m1)
        C1 = P5T.ent(qadm.mut(P5T.course_cmd('2학년 국어 A', term2, 'subj-1', [M[22]], t2s, t2last)))
        q22.mut(P5T.roster(C1, 1, [P5T.srow('S-0001', '김민준', 2, '1', 1), P5T.srow('S-0002', '김민준', 2, '1', 2)], t2s, t2last))
        SA = {x['schoolStudentKey']: x for x in q22.course(C1)['students']}['S-0001']
        A22 = {x['id']: x for x in q22.catalog()['courses']}[C1]['assignmentId']
        inp = P5T.act_input([P5T.grading_row('1번', '사람이 결정')], {0: ('adopt', SA['id'], SA['courseMembershipId'], '')})
        I1 = P5T.ent(q22.mut({'kind': 'activity_import', 'courseId': C1, 'assignmentId': A22, 'expectedVersion': scalar('select version from workhub.courses where id=%s', (C1,)), 'input': inp}))
        it = q22.activity(C1, I1)['items'][0]
        OS = P5T.ent(q22.mut(P5T.obs(C1, SA, A22, text='활동에서 근거를 들어 말함', source={'itemId': it['id'], 'itemVersion': it['version']})))
        d = data(t[22].home()) or {}
        check('F11 근거가 그대로인 관찰 → 학생 후속 0 · 항목 없음', d.get('counts', {}).get('student_followup') == 0 and all(i['kind'] != 'student_followup' for i in d.get('items', [])), d)
        q22.mut(P5T.review(C1, I1, it['id'], it['version'], 'withdraw', reason='다른 학생 응답이었음'))
        d = data(t[22].home()) or {}
        sf = [i for i in d.get('items', []) if i['kind'] == 'student_followup']
        check('F12 채택 철회로 관찰이 재검토 상태 → 학생 후속 1 · 항목 출처 = 수업 · 학생 이름 · 본문 없음', OS and d.get('counts', {}).get('student_followup') == 1
              and len(sf) == 1 and sf[0]['sourceId'] == C1 and sf[0]['label'] == '근거 변경 1건' and '김민준' not in json.dumps(sf, ensure_ascii=False)
              and '근거를 들어' not in json.dumps(sf, ensure_ascii=False), d)
        check('F13 같은 학교 다른 교사(23)의 홈에는 22 의 학생 후속이 없음', (data(t[23].home()) or {}).get('counts', {}).get('student_followup') == 0)

    # ======================================================================= G. 업무 인계 · 새 학년도(보강 없이: 공식 담당 · 새 학년도)
    L = data(t[21].tl()) or {}
    names = [(r['memberId'], r['name']) for r in L.get('recipients', [])]
    check('G01 받는 사람: 나 · 업무실 자격 없는 교사(U2) · 대기/거절/정지 · 소속 끝남 · 다른 학교 제외, 같은 이름 둘 다(다른 ID)',
          M[21] not in [m for m, _ in names] and 'm-u2' not in [m for m, _ in names] and not {'m-29', 'm-30', 'm-31', M[28], M[27]} & {m for m, _ in names}
          and [m for m, nm in names if nm == '김하늘'] == [M[22], M[23]], names)
    check('G02 공식 담당 인계 모듈이 꺼져 있으면 인계할 자원 0 · 연도 관리 아님', L.get('resources') == [] and L.get('canManageYear') is False and L.get('years') == [], L)
    plan = ho(M[22], mver(M[22]), [res('duty', 'duty-21', 1, '방과후 업무')])
    check('G03 공식 담당 인계 모듈 꺼짐 → 미리보기 NOT_READY', ecode(t[21].tp(plan)) == 'NOT_READY')
    sqlerr(fill_json(p74, {'approver_user_id': U1, 'approval_ref': '2026-10-20 공식 담당 인계 시범 승인(시험)', 'modules': ['duty_handover']}))
    L = data(t[21].tl()) or {}
    check('G04 켠 뒤 인계할 자원: 진행 중인 내 공식 담당 2(오늘 시작한 것 · 남의 것 제외)', [(r['kind'], r['id']) for r in L.get('resources', [])] == [('duty', 'duty-21'), ('duty', 'duty-21b')]
          and L['resources'][0]['label'] == '공식 담당: 방과후 업무', L)
    pv = t[21].tp(plan); P = data(pv) or {}
    check('G05 미리보기: 지문 64자 · 만료 시각 · 요약(받는 사람 · 자원) · 빠지는 것 · 1건', len(P.get('fingerprint', '')) == 64 and P.get('expiresAt', '').endswith('Z')
          and P.get('summary') == ['받는 사람: 김하늘', '공식 담당: 방과후 업무'] and P.get('affectedCount') == 1 and len(P.get('excluded', [])) == 2, pv)
    got = [ecode(t[21].tp(ho(M[21], mver(M[21]), [res('duty', 'duty-21', 1)]))), ecode(t[21].tp(ho('m-u2', mver('m-u2'), [res('duty', 'duty-21', 1)]))),
           ecode(t[21].tp(ho(M[27], mver(M[27]), [res('duty', 'duty-21', 1)]))), ecode(t[21].tp(ho('m-29', mver('m-29'), [res('duty', 'duty-21', 1)]))),
           ecode(t[21].tp(ho(M[22], mver(M[22]) + 1, [res('duty', 'duty-21', 1)]))), ecode(t[21].tp(ho(M[22], mver(M[22]), [res('duty', 'duty-25', 1)]))),
           ecode(t[21].tp(ho(M[22], mver(M[22]), [res('duty', 'duty-21c', 1)]))), ecode(t[21].tp(ho(M[22], mver(M[22]), [res('duty', 'duty-21', 9)]))),
           ecode(t[21].tp(ho(M[22], mver(M[22]), [res('cooperation', COOP, 1)])))]
    check('G06 나 자신 · 자격 없는 교사 · 다른 학교 · 대기 소속 → NOT_FOUND, 받는 사람 판 다름 → CONFLICT, 남의 담당 · 오늘 시작 → NOT_FOUND, 판 다름 → CONFLICT, 협업(보강 전) → NOT_READY',
          got == ['NOT_FOUND'] * 4 + ['CONFLICT', 'NOT_FOUND', 'NOT_FOUND', 'CONFLICT', 'NOT_READY'], got)
    badp = [ho(M[22], 1, []), ho(M[22], 1, [res('duty', 'duty-21', 1)] * 2), ho(M[22], 1, [res('duty', 'duty-21', 1)], note=''),
            ho(M[22], 1, [res('room', 'x', 1)]), {**plan, 'x': 1}, ny(year, 2019, '2027-03-01', '2028-02-28', '2027-03-02', '2027-07-20', '2027-08-20', '2028-02-10'),
            ny(year, 2027, '2027-03-01', '2028-02-28', '2027-03-02', '2027-08-20', '2027-08-20', '2028-02-10'),
            ny(year, 2027, '2027-03-01', '2027-03-01', '2027-03-01', '2027-03-01', '2027-03-02', '2027-03-01'), {'kind': 'other'},
            ny(year, 2027, '2027-03-01', '2028-02-28', '2027-03-02', '2027-07-20', '2027-08-20', '2027-02-29')]
    got = [ecode(t[21].tp(x)) for x in badp]
    check('G07 모양이 틀린 계획 10종(없는 날짜 2027-02-29 포함) → INVALID_INPUT', got == ['INVALID_INPUT'] * 10, got)
    st = state()
    check('G08 지문이 다르거나 형식이 틀림 → CONFLICT / INVALID_INPUT · 변경 0', ecode(t[21].tm(apply(plan, 'f' * 64))) == 'CONFLICT'
          and ecode(t[21].tm(apply(plan, 'F' * 64))) == 'INVALID_INPUT' and state() == st)
    k = key(); r = t[21].tm(apply(plan, P['fingerprint']), k); d = data(r) or {}
    HO = d.get('recordId')
    check('G09 적용 → 대기(pending) 판 1 · 항목 1 · 이력 apply · 받는 사람(22)에게 알림 · 자원은 아직 안 넘어감', d.get('state') == 'pending' and d.get('version') == 1
          and n('transition_items', 'record_id=%s', (HO,)) == 1 and n('notifications', "owner_membership_id='m-22' and dedupe_key like 'p7:transition:%%'") == 1
          and scalar("select membership_id from workhub.staff_assignments where id='duty-21'") == 'm-21', r)
    check('G10 응답 유실 뒤 같은 번호 재전송 → 같은 응답, 지문이 만료돼도', t[21].tm(apply(plan, P['fingerprint']), k) == r)
    check('G11 같은 자원을 다시 인계 → 목록에서 빠지고 미리보기 CONFLICT', ecode(t[21].tp(plan)) == 'CONFLICT'
          and [x['id'] for x in data(t[21].tl())['resources']] == ['duty-21b'])
    L21, L22, L23 = data(t[21].tl()), data(t[22].tl()), data(t[23].tl())
    check('G12 기록: 요청한 사람은 취소만 · 받는 사람은 수락만 · 같은 이름 다른 교사(23)에게는 안 보임',
          [(x['id'], x['canAccept'], x['canCancel']) for x in L21['records']] == [(HO, False, True)]
          and [(x['id'], x['canAccept'], x['canCancel']) for x in L22['records']] == [(HO, True, False)] and L23['records'] == [], (L21, L22, L23))
    check('G13 요청한 사람이 수락 · 받는 사람이 취소 → FORBIDDEN, 제3자 → NOT_FOUND, 판 다름 → CONFLICT',
          [ecode(t[21].tm(act('accept', HO, 1))), ecode(t[22].tm(act('cancel', HO, 1))), ecode(t[23].tm(act('accept', HO, 1))), ecode(t[22].tm(act('accept', HO, 2)))]
          == ['FORBIDDEN', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'])
    r0 = rev(s1); st = state()
    sqlfile(None, text="""create function workhub_private.p7_test_fail() returns trigger language plpgsql as $$ begin raise exception 'P7_TEST_FAILURE'; end $$;
                          create trigger p7_test_fail before insert on workhub.transition_history for each row execute function workhub_private.p7_test_fail();""")
    r = t[22].tm(act('accept', HO, 1))
    sqlfile(None, text="drop trigger p7_test_fail on workhub.transition_history; drop function workhub_private.p7_test_fail();")
    check('G14 수락 중간 강제 실패(이력 기록 단계, 담당 교체 뒤) → 봉투 없는 오류 · 담당 · 학교 관리 판 · 원장 모두 되돌림', r == 'P7_TEST_FAILURE' and state() == st and rev(s1) == r0, r)
    call(run, "update public.users set role='teacher' where id=%s", (T[22],))
    check('G15 받는 사람의 업무실 자격 회수 → 봉투 없는 FORBIDDEN', t[22].tm(act('accept', HO, 1)) == 'FORBIDDEN')
    call(run, "update public.users set role='superadmin' where id=%s", (T[22],))
    k = key(); r = t[22].tm(act('accept', HO, 1, '인수합니다'), k); d = data(r) or {}
    new_duty = scalar("select to_jsonb(a) from workhub.staff_assignments a where membership_id='m-22' and label='방과후 업무'") or {}
    check('G16 수락 → accepted 판 2 · 내 담당은 어제까지(ended) · 22 담당 오늘부터 원래 끝까지 · 학교 관리 판 +2 · 변경 원장 2 · 요청한 사람에게 알림',
          d.get('state') == 'accepted' and d.get('version') == 2 and d.get('recordId') == HO
          and scalar("select array[status, valid_to::text] from workhub.staff_assignments where id='duty-21'") == ['ended', DAY(0)]
          and new_duty.get('valid_from') == DAY(0) and new_duty.get('valid_to') == y_end and rev(s1) == r0 + 2
          and n('school_admin_changes', "reason like '업무 인계 수락%%'") == 2 and n('notifications', "owner_membership_id='m-21' and dedupe_key like 'p7:transition:%%'") == 1, r)
    check('G17 같은 번호 재전송 → 같은 응답 · 쓰기 0', t[22].tm(act('accept', HO, 1, '인수합니다'), k) == r)
    check('G18 끝난 인계를 취소 · 다시 수락 → CONFLICT', ecode(t[21].tm(act('cancel', HO, 2))) == 'CONFLICT' and ecode(t[22].tm(act('accept', HO, 2))) == 'CONFLICT')
    # 거절 · 취소 · 자원 바뀜(대상 교체)
    p2 = ho(M[24], mver(M[24]), [res('duty', 'duty-21b', 1)])
    r = t[21].tm(apply(p2, data(t[21].tp(p2))['fingerprint'])); H2 = data(r)['recordId']
    check('G19 받는 사람 거절 → rejected · 자원 그대로 · 다시 인계할 수 있음', data(t[24].tm(act('reject', H2, 1, '어렵습니다')))['state'] == 'rejected'
          and scalar("select membership_id from workhub.staff_assignments where id='duty-21b'") == 'm-21' and [x['id'] for x in data(t[21].tl())['resources']] == ['duty-21b'])
    r = t[21].tm(apply(p2, data(t[21].tp(p2))['fingerprint'])); H3 = data(r)['recordId']
    check('G20 요청한 사람 취소 → cancelled', data(t[21].tm(act('cancel', H3, 1, '잘못 보냄')))['state'] == 'cancelled')
    r = t[21].tm(apply(p2, data(t[21].tp(p2))['fingerprint'])); H4 = data(r)['recordId']
    call(run, "update workhub.staff_assignments set valid_to=valid_to - 1, version=version+1 where id='duty-21b'")
    st = state()
    check('G21 신청 뒤 담당이 바뀌면(학교 관리에서 기간 수정) 수락 → CONFLICT · 변경 0', ecode(t[24].tm(act('accept', H4, 1))) == 'CONFLICT' and state() == st)
    t[21].tm(act('cancel', H4, 1))
    p3 = ho(M[22], mver(M[22]), [res('duty', 'duty-21b', 2)])
    fp3 = data(t[21].tp(p3))['fingerprint']
    call(run, "update workhub.memberships set version=version+1 where id='m-22'")
    check('G22 미리보기 뒤 받는 사람 소속 판이 바뀌면 적용 → CONFLICT(다시 미리보기)', ecode(t[21].tm(apply(p3, fp3))) == 'CONFLICT')
    p3 = ho(M[22], mver(M[22]), [res('duty', 'duty-21b', 2)]); fp3 = data(t[21].tp(p3))['fingerprint']
    outs = concurrently([lambda: t[21].tm(apply(p3, fp3)), lambda: t[21].tm(apply(p3, fp3))])
    check('G23 같은 자원 인계를 다른 번호로 동시에 2번 → 하나만 pending, 하나는 CONFLICT', sorted([data(o)['state'] if ok(o) else ecode(o) for o in outs]) == ['CONFLICT', 'pending'], outs)
    # 새 학년도
    c21 = ny(year, y_school + 1, f'{y_school + 1}-03-01', f'{y_school + 2}-02-28', f'{y_school + 1}-03-02', f'{y_school + 1}-07-20', f'{y_school + 1}-08-20', f'{y_school + 2}-02-10')
    check('G24 연도 관리 권한 없는 교사(21) 새 학년도 → FORBIDDEN', ecode(t[21].tp(c21)) == 'FORBIDDEN')
    LA = data(adm.tl()) or {}
    check('G25 관리자: 연도 관리 가능 · 학년도 목록', LA.get('canManageYear') is True and [y['id'] for y in LA.get('years', [])] == [year]
          and LA['years'][0]['label'] == f'{y_school}학년도', LA)
    pv = adm.tp(c21); P = data(pv) or {}
    check('G26 새 학년도 미리보기: 구성 복사(지운 학급 제외) 부서 2 · 학급 1 · 교과 1 → 영향 7', P.get('affectedCount') == 7
          and P.get('summary', [''])[3].endswith('부서 2개 · 학급 1개 · 교과 1개'), pv)
    got = [ecode(adm.tp({**c21, 'targetYear': y_school})), ecode(adm.tp(ny(year, y_school + 1, DAY(30), f'{y_school + 2}-02-28', DAY(30), DAY(60), DAY(61), f'{y_school + 2}-02-10'))),
           ecode(adm.tp({**c21, 'sourceYearId': 'y2-2026'}))]
    check('G27 이미 있는 학년도 → CONFLICT, 기존 학년도와 기간 겹침 → INVALID_INPUT, 다른 학교 학년도 → NOT_FOUND', got == ['CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'], got)
    fp = P['fingerprint']
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-2', %s, %s, '수학', 2)", (s1, year))
    check('G28 미리보기 뒤 원본 구성이 바뀌면 적용 → CONFLICT', ecode(adm.tm(apply(c21, fp))) == 'CONFLICT')
    r0 = rev(s1); fp = data(adm.tp(c21))['fingerprint']; k = key()
    keep = lambda: scalar("""select md5(concat_ws('|',
        (select string_agg(x::text, ',' order by x::text) from workhub.academic_years x where id=%s),
        (select string_agg(x::text, ',' order by x::text) from workhub.terms x where academic_year_id=%s),
        (select string_agg(x::text, ',' order by x::text) from workhub.year_departments x where academic_year_id=%s),
        (select string_agg(x::text, ',' order by x::text) from workhub.year_classes x where academic_year_id=%s),
        (select string_agg(x::text, ',' order by x::text) from workhub.year_subjects x where academic_year_id=%s),
        (select string_agg(x::text, ',' order by x::text) from workhub.staff_assignments x),
        (select string_agg(x::text, ',' order by x::text) from workhub.memberships x),
        (select string_agg(x::text, ',' order by x::text) from workhub.accounts x)))""", (year,) * 5)
    kept = keep()
    r = adm.tm(apply(c21, fp), k); d = data(r) or {}
    check('G28a 새 학년도 적용 뒤 원래 학년도 · 학기 · 구성 · 담당 · 소속 · 계정은 그대로', keep() == kept)
    ny_id = scalar("select id from workhub.academic_years where school_id=%s and school_year=%s", (s1, y_school + 1))
    check('G29 새 학년도 적용 → completed 판 1 · 학년도(준비 상태 · 끝 다음날 배타) · 학기 2 · 구성 복사 · 학교 관리 판 +1 · 변경 원장',
          d.get('state') == 'completed' and d.get('version') == 1 and ny_id is not None
          and scalar("select array[state, starts_on::text, ends_on::text] from workhub.academic_years where id=%s", (ny_id,)) == ['planning', f'{y_school + 1}-03-01', f'{y_school + 2}-02-29' if (y_school + 2) % 4 == 0 else f'{y_school + 2}-03-01']
          and scalar("select array_agg(label || ':' || starts_on || '~' || ends_on order by term_no) from workhub.terms where academic_year_id=%s", (ny_id,))
              == [f'1학기:{y_school + 1}-03-02~{y_school + 1}-07-21', f'2학기:{y_school + 1}-08-20~{y_school + 2}-02-11']
          and n('year_departments', 'academic_year_id=%s', (ny_id,)) == 2 and n('year_classes', 'academic_year_id=%s', (ny_id,)) == 1
          and n('year_subjects', 'academic_year_id=%s', (ny_id,)) == 2 and rev(s1) == r0 + 1
          and n('school_admin_changes', "command_kind='save_configuration' and target_id=%s", (ny_id,)) == 1, r)
    check('G30 같은 번호 재전송 → 같은 응답 · 같은 학년도 다시 → CONFLICT', adm.tm(apply(c21, fp), k) == r and ecode(adm.tp(c21)) == 'CONFLICT')
    check('G31 학교 관리 판이 바뀌어 P1 화면의 옛 판 명령은 CONFLICT(학교 관리와 한 줄)', ecode(call(api(U1), "select public.workhub_school_admin_mutate(%s, %s::jsonb, %s)",
          (m1, json.dumps({'kind': 'end_assignment', 'expectedVersion': r0, 'schoolYear': y_school, 'assignmentId': 'duty-25', 'lastDay': DAY(0), 'reason': 'x'}), key())))
          in ('CONFLICT', 'INVALID_INPUT'))
    call(run, "update workhub.membership_roles set revoked_at=now(), revoke_reason='시험 해제' where membership_id=%s and role_code='school_admin'", (m1,))
    check('G32 관리자 역할 회수 → 새 학년도 FORBIDDEN · 연도 관리 false', ecode(adm.tp({**c21, 'targetYear': y_school + 2})) == 'FORBIDDEN'
          and data(adm.tl())['canManageYear'] is False)
    call(run, "update workhub.membership_roles set revoked_at=null, revoke_reason=null where membership_id=%s and role_code='school_admin'", (m1,))
    # 목록 쪽수: 25 가 실제 함수로 인계 신청 → 취소를 51번(기록 > 50) 하면 다음 위치가 생긴다
    ndv = scalar("select version from workhub.staff_assignments where id='duty-25'")
    for i in range(51):
        pl = ho(M[24], mver(M[24]), [res('duty', 'duty-25', ndv)], note=f'쪽수 시험 {i}')
        rid = data(t[25].tm(apply(pl, data(t[25].tp(pl))['fingerprint'])))['recordId']
        t[25].tm(act('cancel', rid, 1, '쪽수 시험'))
    first = data(t[25].tl()) or {}
    nxt = data(t[25].tl(first.get('nextCursor'))) or {}
    ids = [x['id'] for x in first.get('records', [])] + [x['id'] for x in nxt.get('records', [])]
    check('G33 기록 50건씩 · 다음 위치로 나머지 · 겹침 없음', len(first.get('records', [])) == 50 and first.get('nextCursor') and nxt.get('nextCursor') is None
          and len(ids) == len(set(ids)) == n('transition_records', "requester_membership_id='m-25' or recipient_membership_id='m-25'"), (len(first.get('records', [])), nxt.get('nextCursor')))
    check('G34 다른 사람의 위치 값 · 망가진 위치 값 → INVALID_INPUT', ecode(t[23].tl(first.get('nextCursor'))) == 'INVALID_INPUT' and ecode(t[25].tl('zz')) == 'INVALID_INPUT')
    stop('transitions')
    check('G35 업무 전환 중지 → 목록 · 미리보기 · 명령 NOT_READY', [ecode(t[21].tl()), ecode(t[21].tp(p2)), ecode(t[21].tm(act('cancel', HO, 2)))] == ['NOT_READY'] * 3)
    resume('transitions')

    # ======================================================================= H. P7-05 보강(별도 승인) — 마감 · 연장 · 수합/협업 인계
    if BRIDGE:
        p75 = 'P7-05_R1_P2_보강_별도승인.sql'
        check('H01 빈 칸이 남은 P7-05 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src(p75)))
        sqlfile(None, text="create or replace function workhub_private.collections_guard() returns trigger language plpgsql set search_path = '' as $$ begin return new; end $$")
        check('H02 R1 원본 정의가 다르면 P7-05 → 멈춤(아무것도 안 바꿈)', 'R1 · P2 원본 정의가 이 파일이 아는 판과 다릅니다' in sqlerr(fill_json(os.path.join(S, p75), {'approved_by': '계란', 'approval_ref': '시험'}))
              and not scalar("select workhub_private.p7_bridge()"))
        # R1-02 원본 함수 본문으로 되돌린다
        r1src = src('R1-02_수합_원본.sql', R1)
        i = r1src.index('CREATE FUNCTION workhub_private.collections_guard()'); j = r1src.index('END $$;', i) + len('END $$;')
        sqlfile(None, text=r1src[i:j].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
        check('H03 P7-05 정상 실행(승인 근거 입력)', sqlerr(fill_json(os.path.join(S, p75), {'approved_by': '계란', 'approval_ref': '2026-10-20 시험 승인'})) == 'OK'
              and scalar("select workhub_private.p7_bridge()"))
        check('H04 P7-05 다시 실행 → 멈춤', '이미 적용되었습니다' in sqlerr(fill_json(os.path.join(S, p75), {'approved_by': '계란', 'approval_ref': '다시'})))
        check('H05 보강 뒤에도 게시된 수합을 직접 바꾸면 거부(표시 없음)', 'IMMUTABLE_ROW' in sqlerr(f"update workhub.collections set due_on=due_on+1, version=version+1 where id='{CA}'")
              and 'IMMUTABLE_ROW' in sqlerr(f"update workhub.collections set owner_membership_id='m-21', owner_account_id='acc-21', version=version+1 where id='{CA}'"))
        check('H06 초안 수합의 관리자도 바꿀 수 없음', 'IMMUTABLE_ROW' in sqlerr(f"update workhub.collections set owner_membership_id='m-21', owner_account_id='acc-21' where id='{CD}'"))
        v = data(adm.ops(CA))['version']
        r = adm.opm(oc('close', CA, v, '기한 종료'))
        check('H07 마감 → closed · 판 +1', data(r) and data(r)['version'] == v + 1 and data(adm.ops(CA))['phase'] == 'closed', r)
        st = state(); r1c = scalar("select count(*) from workhub.unit_drafts") + scalar("select count(*) from workhub.submission_versions")
        e1 = t[23].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uB, 'expectedVersion': 0, 'input': {'text': '늦은 초안', 'number': 1, 'files': []}})
        check('H08 마감된 수합에 R1 함수로 직접 초안 저장 → CONFLICT · R1 쓰기 0', (e1.get('error') or {}).get('code') == 'CONFLICT'
              and scalar("select count(*) from workhub.unit_drafts") + scalar("select count(*) from workhub.submission_versions") == r1c, e1)
        check('H09 마감 상태: 연장 · 알림 → CONFLICT, 과거 날짜로 재개 → INVALID_INPUT', [ecode(adm.opm(oc('extend', CA, v + 1, dueDate=DAY(5)))),
              ecode(adm.opm(oc('remind', CA, v + 1, recipients=[rcp(uB, M[23], uv(uB))]))), ecode(adm.opm(oc('reopen', CA, v + 1, dueDate=DAY(-1))))]
              == ['CONFLICT', 'CONFLICT', 'INVALID_INPUT'])
        r = adm.opm(oc('reopen', CA, v + 1, '추가 제출 허용', dueDate=DAY(5)))
        check('H10 재개(기한 5일 뒤) → open · R1 기한 · 마감 시각 · 기한 판 2', data(r) and data(adm.ops(CA))['phase'] == 'open'
              and scalar("select array[due_on::text, due_change_revision::text, (due_at = ((due_on + 1)::timestamp at time zone 'Asia/Seoul'))::text] from workhub.collections where id=%s", (CA,))
              == [DAY(5), '2', 'true'], r)
        e2 = t[23].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uB, 'expectedVersion': 0, 'input': {'text': '초안', 'number': 1, 'files': []}})
        e3 = t[23].r1({'kind': 'submit', 'requestId': CA, 'unitId': uB, 'draftId': (data(e2) or {}).get('resourceId'), 'expectedDraftVersion': 1, 'expectedVersion': uv(uB), 'reason': ''})
        check('H11 재개 뒤 R1 제출 됨 · 제출판에 기한 판 2 기록', data(e3) and scalar("select due_change_revision from workhub.submission_versions where unit_id=%s order by receipt_at desc limit 1", (uB,)) == 2, (e2, e3))
        v = data(adm.ops(CA))['version']
        check('H12 연장: 지금 기한 이하 → INVALID_INPUT, 뒤 날짜 → 기한 판 3', ecode(adm.opm(oc('extend', CA, v, dueDate=DAY(5)))) == 'INVALID_INPUT'
              and data(adm.opm(oc('extend', CA, v, dueDate=DAY(9)))) and scalar("select due_change_revision from workhub.collections where id=%s", (CA,)) == 3)
        v = data(adm.ops(CA))['version']
        check('H13 open 에서 보관 → CONFLICT', ecode(adm.opm(oc('archive', CA, v))) == 'CONFLICT')
        adm.opm(oc('close', CA, v)); v += 1
        sB = scalar("select current_submission_id from workhub.collection_units where id=%s", (uB,))
        e4 = t[24].r1({'kind': 'review', 'requestId': CA, 'unitId': uB, 'submissionId': sB, 'expectedVersion': uv(uB), 'decision': 'changes_requested', 'note': '보완', 'dueDate': DAY(3)})
        check('H14 마감 뒤에도 검토 · 보완 요청은 됨(보완 기한 3일 뒤)', data(e4) is not None, e4)
        # ---- 마감 뒤 보완(통합 검토 2번): 보완 요청 받은 단위만, 보완 기한까지 저장 · 파일 · 그 보완에 대한 제출 → 검토 수락까지
        CRB = scalar("select id from workhub.correction_requests where unit_id=%s and state='open'", (uB,))
        d23 = data(t[23].home()) or {}
        check('H15 마감된 수합: 미제출 항목은 빠지고 보완 요청 받은 교사(23) 홈에는 보완 1건(보완 기한)',
              d23.get('counts', {}).get('supplement') == 1 and d23['counts']['collection'] == 0
              and [(i['kind'], i['sourceId'], i['dueDate']) for i in d23['items'] if i['kind'] == 'supplement'] == [('supplement', CA, DAY(3))], d23)
        r1n = lambda: scalar("select count(*) from workhub.unit_drafts") + scalar("select count(*) from workhub.submission_versions") + scalar("select count(*) from workhub.collection_file_intents")
        c0 = r1n()
        dAv = scalar("select version from workhub.unit_drafts where unit_id=%s", (uA,))
        eA = [t[21].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uA, 'expectedVersion': dAv, 'input': {'text': '마감 뒤 수정', 'number': 1, 'files': []}}),
              t[21].go('workhub_file_prepare', {'kind': 'draft', 'requestId': CA, 'unitId': uA, 'version': dAv},
                       {'name': '추가.pdf', 'extension': 'pdf', 'claimedBytes': 1000, 'claimedSha256': 'a' * 64}, key())]
        check('H15a 보완 요청이 없는 다른 단위(A): 초안 저장 · 파일 올리기 예약 → CONFLICT · R1 쓰기 0', [ecode(x) for x in eA] == ['CONFLICT', 'CONFLICT'] and r1n() == c0, eA)
        dBv = scalar("select version from workhub.unit_drafts where unit_id=%s", (uB,))
        eB = t[23].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uB, 'expectedVersion': dBv, 'input': {'text': '보완 반영', 'number': 2, 'files': []}})
        fB = t[23].go('workhub_file_prepare', {'kind': 'draft', 'requestId': CA, 'unitId': uB, 'version': dBv + 1},
                      {'name': '보완.pdf', 'extension': 'pdf', 'claimedBytes': 1000, 'claimedSha256': 'b' * 64}, key())
        check('H15b 보완 대상 단위(B): 마감 뒤에도 초안 저장 · 파일 올리기 예약 됨', data(eB) is not None and data(fB) is not None, (eB, fB))
        def set_fix_due(d):   # 보완 기한이 지난 상황 흉내(R1 표 가드를 잠깐 끄고 바꿈 — 시험 DB 에서만)
            sqlfile(None, text=f"alter table workhub.correction_requests disable trigger correction_requests_guard; "
                               f"update workhub.correction_requests set due_on='{d}' where id='{CRB}'; "
                               f"alter table workhub.correction_requests enable trigger correction_requests_guard")
        set_fix_due(DAY(-1))
        ex = t[23].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uB, 'expectedVersion': dBv + 1, 'input': {'text': '기한 지남', 'number': 2, 'files': []}})
        dx = data(t[23].home()) or {}
        set_fix_due(DAY(3))
        check('H15b2 보완 기한이 지나면(어제) 마감된 수합의 보완 저장도 CONFLICT · 홈 보완 0', ecode(ex) == 'CONFLICT' and dx.get('counts', {}).get('supplement') == 0, (ex, dx))
        e6 = t[23].r1({'kind': 'submit', 'requestId': CA, 'unitId': uB, 'draftId': data(eB)['resourceId'], 'expectedDraftVersion': dBv + 1, 'expectedVersion': uv(uB), 'reason': '보완 없이 다시'})
        e7 = t[23].r1({'kind': 'submit', 'requestId': CA, 'unitId': uB, 'draftId': data(eB)['resourceId'], 'expectedDraftVersion': dBv + 1, 'expectedVersion': uv(uB),
                       'reason': '보완 반영', 'correctionRequestId': CRB})
        check('H15c 마감 뒤 제출은 그 보완 요청을 가리킬 때만: 가리키지 않으면 CONFLICT, 가리키면 제출 · 보완 요청 충족',
              ecode(e6) == 'CONFLICT' and data(e7) is not None
              and scalar("select state from workhub.correction_requests where id=%s", (CRB,)) == 'fulfilled', (e6, e7))
        sB3 = scalar("select current_submission_id from workhub.collection_units where id=%s", (uB,))
        e8 = t[24].r1({'kind': 'review', 'requestId': CA, 'unitId': uB, 'submissionId': sB3, 'expectedVersion': uv(uB), 'decision': 'accepted', 'note': '', 'dueDate': ''})
        d23 = data(t[23].home()) or {}
        units = {u['id']: u['state'] for u in (data(adm.ops(CA)) or {}).get('units', [])}
        check('H15d 마감 상태 그대로 검토 수락 → 단위 B accepted · 23 홈의 보완 0 · 운영 단계 closed 유지',
              data(e8) is not None and units.get(uB) == 'accepted' and d23.get('counts', {}).get('supplement') == 0 and data(adm.ops(CA))['phase'] == 'closed', (e8, units, d23))
        e9 = t[23].r1({'kind': 'save_draft', 'requestId': CA, 'unitId': uB, 'expectedVersion': scalar("select version from workhub.unit_drafts where unit_id=%s", (uB,)),
                       'input': {'text': '수락 뒤 또', 'number': 3, 'files': []}})
        check('H15e 보완을 마친 단위는 다시 막힘(열린 보완 요청 없음) → CONFLICT', ecode(e9) == 'CONFLICT', e9)
        sB4 = sB3
        e10 = t[24].r1({'kind': 'review', 'requestId': CA, 'unitId': uB, 'submissionId': sB4, 'expectedVersion': uv(uB), 'decision': 'changes_requested', 'note': '또 보완', 'dueDate': TODAY.isoformat()})
        check('H15f 이미 수락한 제출판은 다시 검토할 수 없음(R1 규칙 그대로) → CONFLICT', ecode(e10) == 'CONFLICT', e10)
        subs = lambda: scalar("select md5(string_agg(x::text, ',' order by x::text)) from (select * from workhub.submission_versions where collection_id=%s) x", (CA,))
        before_sub = subs()
        r = adm.opm(oc('archive', CA, v)); v += 1
        check('H16 보관 → archived · 제출판(내용 · 해시) 그대로 · 관리자 · 담당 교사의 R1 읽기는 그대로', data(r) and data(adm.ops(CA))['phase'] == 'archived'
              and subs() == before_sub and data(adm.rpc('workhub_collection_get', CA)) is not None and data(t[23].rpc('workhub_collection_get', CA)) is not None, r)
        sB2 = scalar("select current_submission_id from workhub.collection_units where id=%s", (uB,))
        nrev = n('submission_reviews')
        e5 = t[24].r1({'kind': 'review', 'requestId': CA, 'unitId': uB, 'submissionId': sB2, 'expectedVersion': uv(uB), 'decision': 'accepted', 'note': '', 'dueDate': ''})
        check('H16a 보관된 수합에는 R1 함수로 직접 검토해도 CONFLICT · 검토 0', (e5.get('error') or {}).get('code') == 'CONFLICT'
              and n('submission_reviews') == nrev, e5)
        r = adm.opm(oc('reopen', CA, v, '다시 받기', dueDate=DAY(10)))
        check('H16b 보관 → 재개(open) 가능 · 다시 마감 · 보관', data(r) and data(adm.ops(CA))['phase'] == 'open'
              and data(adm.opm(oc('close', CA, v + 1))) and data(adm.opm(oc('archive', CA, v + 2))) and data(adm.ops(CA))['phase'] == 'archived', r)
        v += 3
        # 수합 · 협업 인계
        L = data(adm.tl()) or {}
        check('H17 관리자 인계 자원: 게시된 수합 중 보관 전 것(B)만 · 협업은 받는 사람인 것만', [(x['kind'], x['id']) for x in L.get('resources', [])] == [('collection', CB)], L.get('resources'))
        pc = ho(M[21], mver(M[21]), [res('collection', CB, data(adm.ops(CB))['version'])])
        r = adm.tm(apply(pc, data(adm.tp(pc))['fingerprint'])); HC = data(r)['recordId']
        r = t[21].tm(act('accept', HC, 1))
        check('H18 수합 인계 수락 → 관리자 21 · 운영판 +1 · 이력 handover · 전 관리자는 R1 기준대로 더 못 봄(NOT_FOUND) · 새 관리자 관리', data(r) and data(r)['state'] == 'accepted'
              and scalar("select owner_membership_id from workhub.collections where id=%s", (CB,)) == 'm-21'
              and n('collection_operation_history', "kind='handover' and collection_id=%s", (CB,)) == 1
              and ecode(adm.opm(oc('remind', CB, data(t[21].ops(CB))['version'], recipients=[rcp(uC, M[25], uv(uC))]))) == 'NOT_FOUND'
              and ecode(adm.ops(CB)) == 'NOT_FOUND' and data(t[21].ops(CB))['canManage'] is True, r)
        # 협업: 23 이 받은 요청(21→23)을 24 에게 인계
        cv = scalar("select version from workhub.cooperation_requests where id=%s", (COOP,))
        check('H19 협업 요청을 그 요청을 보낸 사람(21)에게 넘기는 계획 → INVALID_INPUT(P2: 보낸 사람 ≠ 받는 사람)',
              ecode(t[23].tp(ho(M[21], mver(M[21]), [res('cooperation', COOP, cv)]))) == 'INVALID_INPUT')
        pcoop = ho(M[24], mver(M[24]), [res('cooperation', COOP, cv)])
        r = t[23].tm(apply(pcoop, data(t[23].tp(pcoop))['fingerprint'])); HP = data(r)['recordId']
        r = t[24].tm(act('accept', HP, 1))
        check('H20 협업 인계 수락 → 받는 사람 24 · 판 +1 · 이력 handover(이력 수 = 판)', data(r) and scalar("select array[recipient_membership_id, version::text] from workhub.cooperation_requests where id=%s", (COOP,)) == ['m-24', str(cv + 1)]
              and scalar("select count(*) from workhub.cooperation_history where request_id=%s", (COOP,)) == cv + 1
              and n('cooperation_history', "request_id=%s and action='handover'", (COOP,)) == 1, r)
        r = call(api(T[24]), "select public.workhub_cooperation_mutate('m-24', %s::jsonb, %s)",
                 (json.dumps({'kind': 'transition', 'requestId': COOP, 'expectedVersion': cv + 1, 'action': 'accept', 'comment': '맡겠습니다'}, ensure_ascii=False), key()))
        r23 = call(api(T[23]), "select public.workhub_cooperation_get('m-23', %s)", (COOP,))
        check('H21 새 받는 사람(24)이 P2 로 수락 가능 · 전 받는 사람(23)은 이제 볼 수 없음', isinstance(r, dict) and r.get('ok') is True
              and isinstance(r23, dict) and r23.get('ok') is False, (r, r23))
        p2c = [x for x in sqlfile('P2-03_사후점검.sql', base=P2) if x[2] == 'FAIL']
        check('H22 P2-03 사후 점검 FAIL 없음(이력 수 = 판 유지)', p2c == [], p2c)
        check('H23 협업 받는 사람을 직접 바꾸면 거부(표시 없음)', 'IMMUTABLE_ROW' in sqlerr(f"update workhub.cooperation_requests set recipient_membership_id='m-25', recipient_account_id='acc-25', version=version+1 where id='{COOP}'"))

        # ---- 협업 인계 뒤 상세 이력 계약(2026-10-16 통합 검토 1번): 과거 처리자는 그대로, 행마다 그때의 받는 사람
        def cg(w, rid): return t[w].keep('coop_get', t[w].go('workhub_cooperation_get', rid), requestId=rid)
        def cmv(w, rid, ver, action, comment='확인했습니다'):
            cmd = {'kind': 'transition', 'requestId': rid, 'expectedVersion': ver, 'action': action, 'comment': comment}
            v = t[w].go('workhub_cooperation_mutate', cmd, key()); return isinstance(v, dict) and v.get('ok') is True and v
        def cver(rid): return scalar("select version from workhub.cooperation_requests where id=%s", (rid,))
        def hand(src, dst, rid):
            p = ho(M[dst], mver(M[dst]), [res('cooperation', rid, cver(rid))])
            rec = data(t[src].tm(apply(p, data(t[src].tp(p))['fingerprint'])))['recordId']
            return data(t[dst].tm(act('accept', rec, 1)))
        def hist(env): return [(h['action'], h['actorMemberId'], h['recipientMemberId'], h['previousRecipientMemberId']) for h in env['history']]
        def name(m): return scalar('select a.display_name from workhub.memberships x join workhub.accounts a on a.id=x.account_id where x.id=%s', (m,))
        tk21 = call(api(T[21]), 'select public.workhub_task_mutate(%s, %s::jsonb, %s)',
                    ('m-21', json.dumps({'kind': 'create', 'input': {'title': '보낸 사람 원본 업무', 'notes': '', 'dueDate': ''}}, ensure_ascii=False), key()))
        cx = call(api(T[21]), "select public.workhub_cooperation_mutate('m-21', %s::jsonb, %s)",
                  (json.dumps({'kind': 'create', 'recipientMemberId': M[22], 'title': '인계 이력 확인', 'description': '', 'dueDate': '',
                               'sourceTask': {'id': tk21['id'], 'expectedVersion': tk21['version']}}, ensure_ascii=False), key()))
        CX = cx['entityId']
        ok22 = [cmv(22, CX, 1, 'accept', ''), cmv(22, CX, 2, 'request_completion', '1차 완료')]
        # 받는 사람(22)의 개인 업무 연결(지금 공개 명령은 없음 — 앞으로 생길 연결을 흉내 낸 자료). 인계 뒤에도 22 의 것으로 남아야 한다.
        tk22 = call(api(T[22]), 'select public.workhub_task_mutate(%s, %s::jsonb, %s)',
                    ('m-22', json.dumps({'kind': 'create', 'input': {'title': '받은 협업 내 업무', 'notes': '', 'dueDate': ''}}, ensure_ascii=False), key()))
        sqlfile(None, text=f"insert into workhub.cooperation_task_links(school_id, request_id, account_id, task_id, linked_at) "
                           f"select school_id, id, 'acc-22', '{tk22['id']}', now() from workhub.cooperation_requests where id='{CX}'")
        pre = [cg(21, CX), cg(22, CX)]          # 인계 전 상세(지금 앱과의 호환 확인용)
        check('H23a 인계 전 상세: 이력 3행, 행마다 받는 사람 22 · 넘겨준 사람 없음', all(x.get('ok') is True and hist(x) ==
              [('create', M[21], M[22], None), ('accept', M[22], M[22], None), ('request_completion', M[22], M[22], None)] for x in pre), pre)
        h1 = hand(22, 24, CX)
        d21, d24, d22 = cg(21, CX), cg(24, CX), cg(22, CX)
        want1 = [('create', M[21], M[22], None), ('accept', M[22], M[22], None), ('request_completion', M[22], M[22], None), ('handover', M[24], M[24], M[22])]
        check('H24 완료 확인 대기 중 인계(22→24): 상태 그대로 · 이력 4행 — 과거 처리자 22 그대로, 행마다 그 뒤의 받는 사람, 인계 행만 넘겨준 사람',
              all(ok22) and h1 and h1['state'] == 'accepted' and d21.get('ok') is True and d21['request']['status'] == 'completion_requested'
              and d21['request']['recipientMemberId'] == M[24] and hist(d21) == want1, (ok22, h1, d21))
        check('H25 처리자 이름은 그때 처리한 사람(이전 받는 사람 22 · 새 받는 사람 24) — 요청 본문의 받는 사람 이름과 다름',
              [h['actorName'] for h in d21['history']] == [name(M[21]), name(M[22]), name(M[22]), name(M[24])], d21['history'])
        check('H26 새 받는 사람(24)도 같은 이력 · 개인 업무 연결은 자기 것만(22 의 연결 · 21 의 원본 연결 안 보임 → null)',
              d24.get('ok') is True and hist(d24) == want1 and d24['request']['taskLink'] is None, d24)
        check('H27 보낸 사람(21)은 자기 원본 업무 연결만 보임', d21['request']['taskLink'] == {'taskId': tk21['id'], 'ownerUserId': T[21]}, d21['request'])
        check('H28 이전 받는 사람(22): 상세 NOT_FOUND · 받은 함에서 빠짐 · 22 의 개인 업무와 연결 행은 그대로(이관 · 삭제 없음)',
              d22.get('ok') is False and d22.get('code') == 'NOT_FOUND'
              and all(x['id'] != CX for x in (t[22].go('workhub_cooperation_list', {'box': 'received', 'status': 'all', 'query': '', 'cursor': None}).get('items') or []))
              and n('cooperation_task_links', "request_id=%s and account_id='acc-22'", (CX,)) == 1
              and scalar("select owner_account_id from workhub.tasks where id=%s", (tk22['id'],)) == 'acc-22', d22)
        # 보낸 사람이 보완 요청 → 24 가 다시 완료 요청 → 24 가 25 에게 재인계(완료 확인 대기) → 보낸 사람 완료 확인
        r5 = [cmv(21, CX, 4, 'return_completion', '보완 부탁'), cmv(24, CX, 5, 'request_completion', '보완 완료')]
        h2 = hand(24, 25, CX)
        r8 = cmv(21, CX, 7, 'confirm_completion', '')
        d25, d21b, d24b = cg(25, CX), cg(21, CX), cg(24, CX)
        want2 = [('create', M[21], M[22], None), ('accept', M[22], M[22], None), ('request_completion', M[22], M[22], None),
                 ('handover', M[24], M[24], M[22]), ('return_completion', M[21], M[24], None), ('request_completion', M[24], M[24], None),
                 ('handover', M[25], M[25], M[24]), ('confirm_completion', M[21], M[25], None)]
        check('H29 재인계(24→25) 뒤 완료 확인: 이력 8행 = 판 · 받는 사람 22→24→25 · 각 인계 행의 넘겨준 사람 22 · 24',
              all(r5) and h2 and r8 and d25.get('ok') is True and d25['request']['status'] == 'completed' and hist(d25) == want2
              and hist(d21b) == want2 and d25['request']['version'] == 8, (r5, h2, r8, d25))
        check('H30 재인계 뒤 24 도 NOT_FOUND · 25 의 업무 연결 null', d24b.get('code') == 'NOT_FOUND' and d25['request']['taskLink'] is None, (d24b, d25))
        bad = sqlerr(f"insert into workhub.cooperation_history(school_id, request_id, version, action, actor_membership_id, actor_account_id) "
                     f"select school_id, id, 99, 'handover', 'm-25', 'acc-25' from workhub.cooperation_requests where id='{CX}'")
        check('H31 넘겨준 사람 없는 인계 이력 행은 표 제약이 거부', 'cooperation_history_previous_check' in bad, bad)
        p2c = [x for x in sqlfile('P2-03_사후점검.sql', base=P2) if x[2] == 'FAIL']
        check('H32 P2-03-10(행마다 처리자 = 그때의 당사자) FAIL 없음 — 인계 2번 포함', p2c == [], p2c)
    else:
        check('H00 P7_BRIDGE=0 — 보강 없이 운영 순서만 시험', True)

    # ======================================================================= I. 두 학교 · 마무리
    sqlerr(fill_json(p74, {'approver_user_id': T[27], 'approval_ref': '다른 학교 시험 승인', 'modules': ['home', 'transitions']}))
    k = key()
    check('I01 다른 학교(27)는 자기 학교 기록만 · 같은 요청 번호를 따로 씀', data(t[27].tl())['records'] == [] and ecode(t[27].tm(act('cancel', HO, 2), k)) == 'NOT_FOUND'
          and ecode(t[21].tm(act('cancel', HO, 2), k)) == 'CONFLICT')
    check('I02 다른 학교 홈: 협업 · 메시지 꺼짐 → unavailable · 수합 0', (data(t[27].home()) or {}).get('counts', {}).get('collection') == 0
          and {'message', 'cooperation'} <= set((data(t[27].home()) or {}).get('unavailable', [])))
    post = sqlfile('P7-03_사후점검.sql')
    check('I03 P7-03 사후 점검 FAIL 없음', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] == 'FAIL'])
    r104 = {r[0]: r for r in sqlfile('R1-04_사후점검.sql', base=R1)}
    changed = sorted(k for k in r104 if k in r104_before and r104[k][2] != r104_before[k][2] and r104[k][2] == 'FAIL')
    check('I03a R1-04 가 P7 뒤 새로 FAIL 로 바뀐 행은 03·04 뿐이고 값이 정확히 +2(이름이 workhub_collection_ 인 P7 함수 2개) · P7-03-12 ok',
          set(changed) <= {'R1-04-03', 'R1-04-04'} and int(r104['R1-04-03'][3]) == int(r104_before['R1-04-03'][3]) + 2
          and int(r104['R1-04-04'][3]) == int(r104_before['R1-04-04'][3]) + 2 and dict((r[0], r[2]) for r in post)['P7-03-12'] == 'ok',
          (changed, r104_before.get('R1-04-03'), r104.get('R1-04-03')))
    after2 = fingerprint()
    if not BRIDGE:
        check('I04 사용 뒤에도 P7 밖 구조 지문(S1~S6) 같음', [r for r in before if r[1] != 'D1 기존 표 행 수·행 해시'] == [r for r in after2 if r[1] != 'D1 기존 표 행 수·행 해시'])
    else:
        diff = [r[1] for b, r in zip(before, after2) if b != r]
        check('I04 보강 뒤 구조 지문은 제약 · 트리거 · 함수(S2 · S3 · S4)만 달라짐(열 · 표 권한 · RLS 그대로)', set(diff) <= {'S2 제약', 'S3 트리거', 'S4 함수(P7 새 함수 제외)', 'D1 기존 표 행 수·행 해시'}, diff)
    check('I05 원장 · 이력 · 알림 기록은 지울 수 없음', all('IMMUTABLE_ROW' in sqlerr(f'delete from workhub.{x}')
                                                for x in ('operation_requests', 'collection_operations', 'collection_operation_history', 'collection_reminders',
                                                          'transition_records', 'transition_history', 'transition_items')))
    check('I06 감사: P7 기록은 school 민감도 · 본문(사유) 없음', scalar("select count(*) from workhub.audit_events where (operation like 'collection_ops.%%' or operation like 'transitions.%%') and sensitivity <> 'school'") == 0
          and scalar("select count(*) from workhub.audit_events where details::text like '%%제출 부탁%%'") == 0)

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == '__main__':
    main()
