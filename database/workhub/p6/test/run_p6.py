# P6 Claude 비서 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관. 외부 모델은 부르지 않는다(가짜 응답기).
# 서버 API 는 PR #48 의 실제 apps/main/api/workhub-ai/_assistant.py(execute)를 가져와, Supabase 호출만 이 시험 DB(service_role)로,
#   모델 호출만 가짜 응답기로 바꿔 끼워 돌린다(P6_APP_SRC 가 없으면 그 시험은 FAIL).
# 사람 요청(대화 목록·대화·할 일 확정)은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# 받은 응답은 P6_CAPTURE 에 남겨 app_contract_p6.ts 가 PR #48 앱의 실제 createAssistantServer·parser 에 넣는다.
#
# 사용: python3 run_p6.py      (R1 + P1 + P2 + P4-01·02 + P5-01·02 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import datetime, json, os, sys, threading, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'p5', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, coll_input, worker_call, U1, U2, T, M, TODAY, results)
import run_r1
import run_p5 as P5T

S = os.path.join(HERE, '..')
P2 = os.path.join(HERE, '..', '..', 'p2')
P4 = os.path.join(HERE, '..', '..', 'p4')
P5 = os.path.join(HERE, '..', '..', 'p5')
R1 = os.environ['R1_DIR']
OUT = os.environ.get('P6_CAPTURE', '')
APP = os.environ.get('P6_APP_SRC', '')
captures = []
AS = None
API_DIR = os.path.join(APP, 'apps', 'main', 'api', 'workhub-ai') if APP else ''
if APP and os.path.isfile(os.path.join(API_DIR, '_assistant.py')):
    sys.path.insert(0, API_DIR)
    import _assistant as AS  # noqa: E402  (PR #48 실제 서버 API 코드)
U29, U30, U31 = P5T.U29, P5T.U30, P5T.U31
DAY = lambda n=0: (TODAY + datetime.timedelta(days=n)).isoformat()
ENV = {'ANTHROPIC_API_KEY': 'x' * 40}   # 형식만 맞춘 가짜 키(외부 호출 없음)


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
def stop(note='점검'): sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'assistant', note))
def resume(note='점검 끝'): sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'assistant', note))
def fingerprint(): return [r for r in sqlfile('P6-00_사전점검_지문.sql') if r[0] == '지문']

P6_TABLES = ['assistant_policies', 'assistant_threads', 'assistant_requests', 'assistant_request_sources', 'assistant_exchanges',
             'assistant_proposals', 'assistant_task_requests']
def state():
    """P6 표 전부 + 할 일·감사·outbox·활성화의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P6_TABLES)
    return scalar(f"""select jsonb_build_object({parts}, 'tasks', (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.tasks x),
      'audit', (select count(*) from workhub.audit_events), 'outbox', (select count(*) from workhub.outbox),
      'act', (select md5(string_agg(x::text, ',' order by x::text)) from workhub.module_activations x))""")
def n(table, where='true', args=()): return scalar(f'select count(*) from workhub.{table} where {where}', args)
def req(k, member=None):
    row = scalar("select to_jsonb(r) from workhub.assistant_requests r where request_key=%s" + (" and owner_membership_id=%s" if member else ''),
                 (k, member) if member else (k,))
    return row or {}
def ok(env): return isinstance(env, dict) and 'data' in env
def ecode(env):
    if isinstance(env, dict): return (env.get('error') or {}).get('code')
    if isinstance(env, tuple) and env and env[0] == 'ERR': return env[1]
    return env
def concurrently(fns):
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    for t in ts: t.join()
    return outs


# ----------------------------------------------------------------------------- 가짜 모델 응답기
class Provider:
    """PR #48 anthropic() 자리. 받은 본문(모델에 보낼 것)을 남기고, 정한 방식으로 답한다. 실제 외부 호출은 없다."""
    def __init__(self, mode='ok', task=None, cite='first', usage=(1200, 300)):
        self.mode, self.task, self.cite, self.usage, self.bodies = mode, task, cite, usage, []
    def __call__(self, body, key, deadline):
        self.bodies.append(body)
        if self.mode == 'raise': raise AS.CheckError('RESULT_UNKNOWN')
        if self.mode == 'reject': return {'rejected': True}
        req_ = json.loads(body['messages'][-1]['content'])
        srcs = req_['authorizedEvidence']
        if self.cite == 'first': keys = [srcs[0]['sourceKey']] if srcs else []
        elif self.cite == 'all': keys = [s['sourceKey'] for s in srcs]
        elif self.cite == 'evidence': keys = [s['sourceKey'] for s in srcs if s['title'].startswith(('관찰', '평가'))]
        elif self.cite == 'forged': keys = ['s99']
        else: keys = []
        mid = 'msg_' + key_hex()
        resp = {'id': mid, 'type': 'message', 'role': 'assistant', 'usage': {'input_tokens': self.usage[0], 'output_tokens': self.usage[1]},
                'stop_reason': 'max_tokens' if self.mode == 'truncate' else 'tool_use',
                'content': [{'type': 'tool_use', 'id': 'tu_1', 'name': 'deliver_workhub_answer',
                             'input': {'segments': [{'text': '학교 자료를 확인한 요약입니다.', 'sourceKeys': keys},
                                                    {'text': '근거가 필요하면 원문을 다시 확인해 주세요.', 'sourceKeys': keys if self.cite == 'evidence' else []}],
                                       'taskDraft': self.task}}]}
        return {'response': resp}
def key_hex(): return key()[2:26]


class FakeClient:
    """PR #48 서버 API 의 Supabase 클라이언트 자리: 사용자 확인 = 이 교사, RPC = 시험 DB(service_role).
    PostgREST 오류는 실제 클라이언트와 같게 바꾼다(P0001 FORBIDDEN·INACTIVE_MEMBERSHIP 만 그 코드, 나머지는 RESULT_UNKNOWN)."""
    def __init__(self, uid, lose=None, before=None):
        self.uid, self.lose, self.before, self.calls = uid, lose, before, []
        self.deadline = time.monotonic() + 50
    def user(self, token): return self.uid
    def rpc(self, name, args):
        if name not in AS.RPCS: raise AS.CheckError('INVALID_INPUT', 400)
        if self.before: self.before(name)
        c = api(None, 'service_role')
        try:
            names = list(args)
            v = call(c, f"select public.{name}({','.join(n_ + ' => %s' for n_ in names)})",
                     tuple(json.dumps(args[n_]) if isinstance(args[n_], (dict, list)) else args[n_] for n_ in names))
        except psycopg2.Error as e:
            msg = e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
            self.calls.append((name, msg))
            if msg in ('FORBIDDEN', 'INACTIVE_MEMBERSHIP'): raise AS.CheckError(msg, 403)
            raise AS.CheckError('RESULT_UNKNOWN')
        finally:
            c.close()
        self.calls.append((name, v))
        if self.lose and name == self.lose:
            raise AS.CheckError('RESULT_UNKNOWN')   # DB 는 반영했지만 응답이 오는 길에 끊김
        return json.loads(json.dumps(v))


def ask_input(prompt='학업성적관리규정에서 평가 기준은 누가 정하나요?', mode='school', intent='school_advice', thread=None, ver=0, refs=(), student=None):
    return {'mode': mode, 'intent': intent, 'prompt': prompt, 'threadId': thread, 'expectedVersion': ver, 'references': list(refs), 'studentContext': student}


class A(Who):
    """비서. 서버 API(실제 PR #48 execute)와 앱 함수(사람 JWT). 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
    def ctx(self):
        try: return call(self.c, 'select public.workhub_context()')
        except psycopg2.Error: return None
    def keep(self, kind, raw, **extra):
        if OUT:
            captures.append({'kind': kind, 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid},
                             'context': self.ctx(), 'raw': raw if isinstance(raw, dict) else None,
                             'error': None if isinstance(raw, dict) else ecode(raw), **extra})
        return raw
    def go(self, fn, *args):
        try: return self.rpc(fn, *args)
        except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
    def svc(self, fn, *args, actor=None):
        """서버 API 함수를 직접(service_role, 사람 JWT 없음)"""
        c = api(None, 'service_role')
        try:
            ph = ','.join(['%s'] * (len(args) + 2))
            return call(c, f'select public.{fn}({ph})', (actor or self.uid, self.member) + tuple(json.dumps(a) if isinstance(a, (dict, list)) else a for a in args))
        except psycopg2.Error as e:
            return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
        finally:
            c.close()
    def run(self, payload, provider=None, client=None, record=True):
        """실제 _assistant.execute 한 번 → (응답 봉투 또는 ('ERR', code), 클라이언트)"""
        if AS is None: return ('ERR', 'NO_APP'), None
        cl = client or FakeClient(self.uid)
        status = 200
        try:
            out = AS.execute(payload, 'Bearer ' + 'a' * 40, ENV, cl, provider or Provider())
        except AS.CheckError as e:
            out, status = ('ERR', e.code), e.status
        if record:
            kind = 'readiness' if payload.get('action') == 'readiness' else 'ask'
            # chat.py 와 같은 HTTP 응답: 성공 200 + 봉투, 실패 그 상태 + {"error":{"code"}}
            self.keep(kind, out if isinstance(out, dict) else ('ERR', out[1]), payload=payload, status=status)
        return out, cl
    def ready(self): return self.run({'action': 'readiness', 'memberId': self.member})[0]
    def ask(self, inp, k=None, provider=None, client=None):
        k = k or key()
        out, cl = self.run({'action': 'ask', 'memberId': self.member, 'input': inp, 'requestKey': k}, provider, client)
        return out, k, cl
    def threads(self, mode='school', cursor=None): return self.keep('list', self.go('workhub_ai_threads_list', mode, cursor), mode=mode, cursor=cursor)
    def thread(self, tid, cursor=None): return self.keep('get', self.go('workhub_ai_thread_get', tid, cursor), threadId=tid, cursor=cursor)
    def confirm(self, inp, k=None):
        k = k or key(); return self.keep('confirm', self.go('workhub_ai_confirm_task', inp, k), input=inp, key=k)


def adata(out):
    """execute 결과에서 AskResult(data)"""
    return out['data'] if isinstance(out, dict) else None
def astate(out): d = adata(out); return d.get('state') if isinstance(d, dict) else ecode(out)


def main():
    if AS is None:
        check('Z00 PR #48 서버 코드(_assistant.py) — P6_APP_SRC 를 지정하지 않음', False); print('합계: PASS 0 · FAIL 1'); sys.exit(1)
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    start_day = scalar("select starts_on from workhub.academic_years where id=%s", (year,))
    term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
    t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
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
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-31', %s, 'acc-031', 'suspended', 'teacher', %s, now())", (s1, start_day))
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-u2', id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = %s""", (U2,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-u2', %s, 'acc-u2', 'active', 'teacher', %s, now())", (s1, start_day))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-ethics', %s, %s, '도덕', 1)", (s1, year))
    # 다른 학교(school-2): m-27 을 그 학교 관리자로
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    # 수합 1건(참여자에게만 보이는 자료): R1 시험과 같은 합성 정책·작업자로 켜고 관리자(U1)가 게시
    sqlfile(None, text=fill_json(f'{R1}/R1-06_정책게시_양식.sql', {
        'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'effective_from': DAY(-1),
        'common_file_safety': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 10000000, 'maxFiles': 5, 'allowUnscanned': False},
        'school_file_upload': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 8000000, 'maxFiles': 4, 'allowUnscanned': False, 'uploadTtlMinutes': 30},
        'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 14, 'unattachedRetentionDays': 7}}))
    sqlfile(None, text=fill_json(f'{R1}/R1-05_검증작업자연결_양식.sql', {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)'}))
    run_r1.WORKER = api(None, 'service_role')
    worker_call('workhub_file_worker_heartbeat', s1, 'w1', {'checks': ['size', 'sha256', 'signature', 'container', 'encryption', 'malware'], 'release': 'test-1'}, 1800)
    adm0 = Who(U1, m1)
    col = data(adm0.mutate({'kind': 'create', 'input': coll_input(title='연수 결과 보고 수합')}))['resourceId']
    adm0.mutate({'kind': 'publish', 'requestId': col, 'expectedVersion': 1})
    col_ver = scalar("select version from workhub.collections where id=%s", (col,))
    # 일정: 학교 공개 1 · 나만 보기 1 (R0 표에 직접 — 일정 화면으로 만든 것과 같은 꼴)
    call(run, """insert into workhub.events(id, scope, school_id, kind, visibility, title, description, location, start_date, end_date, author_account_id, author_membership_id)
                 values ('ev-pub', 'school', %s, 'shared', 'school', '2학기 지필평가', '1·2교시 국어 수학', '각 교실', %s, %s, 'acc-21', 'm-21'),
                        ('ev-mine', 'school', %s, 'personal', 'private', '병원 예약', '', '', %s, %s, 'acc-21', 'm-21')""", (s1, DAY(7), DAY(8), s1, DAY(3), DAY(3)))
    call(run, "insert into workhub.tasks(id, scope, school_id, owner_account_id, title, note) values ('task-21', 'school', %s, 'acc-21', '수행평가 채점', '2반까지')", (s1,))
    # P4 학교 자료·문서함 켜기(이미 시험된 P4-04 양식) + P5 수업 켜기
    sqlfile(None, text=fill_json(os.path.join(P4, 'P4-04_자료문서함활성화_양식.sql'),
                                 {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'document_school_share': 'school_admin'}))
    sqlfile(None, text=fill_json(os.path.join(P5, 'P5-04_수업모듈활성화_양식.sql'),
                                 {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'counseling_scope': 'course_teachers'}))
    sqlfile(None, text=fill_json(os.path.join(P4, 'P4-04_자료문서함활성화_양식.sql'),
                                 {'approver_user_id': T[27], 'approval_ref': '다른 학교 시험 승인', 'document_school_share': 'school_admin'}))

    t = {k: A(T[k], M[k]) for k in (21, 22, 23, 24, 25, 27, 28)}
    adm = A(U1, m1)
    # 학교 자료: 게시 2건(규정 · 학사 안내) + 초안 1건, 다른 학교 게시 1건
    def kin(title, body, locator='규정 제3조'):
        return {'title': title, 'kind': 'regulation', 'body': body, 'locator': locator, 'effectiveFrom': DAY(-30), 'effectiveThrough': ''}
    def kpub(who, title, body, locator='규정 제3조'):
        sid = data(who.go('workhub_knowledge_mutate', {'kind': 'create', 'input': kin(title, body, locator)}, key()))['id']
        who.go('workhub_knowledge_mutate', {'kind': 'publish', 'id': sid, 'expectedVersion': 1, 'reason': '시험 게시'}, key())
        return sid
    K1 = kpub(adm, '학업성적관리규정 평가 기준', '제3조 평가의 기준과 방법은 교과협의회가 정하고 학업성적관리위원회 심의를 거친다.')
    K2 = kpub(adm, '2학기 지필평가 안내', '지필평가는 학년별 일정에 따른다. 평가 기준 공개는 2주 전.', '학사 안내 2쪽')
    KD = data(adm.go('workhub_knowledge_mutate', {'kind': 'create', 'input': kin('초안 자료', '평가 기준 초안')}, key()))['id']
    KO = kpub(t[27], '다른 학교 평가 기준', '다른 학교 규정 평가 기준')
    K1V, K2V, KOV = (scalar("select version from workhub.knowledge_sources where id=%s", (x,)) for x in (K1, K2, KO))
    assert scalar("select bool_and(status='published') from workhub.knowledge_sources where id = any(%s)", ([K1, K2, KO],)), '학교 자료 게시 준비 실패'
    # 문서: 21 의 나만 보기 · 관리자 학교 공유
    def din(title, body, vis='private'):
        return {'title': title, 'kind': 'general', 'body': body, 'visibility': vis, 'sources': [], 'basisDate': DAY(), 'studentContext': None}
    D21 = data(t[21].go('workhub_document_mutate', {'kind': 'create', 'input': din('내 메모', '수행평가 채점 메모'), 'origin': None}, key()))
    DS = data(adm.go('workhub_document_mutate', {'kind': 'create', 'input': din('학교 공유 안내문', '학부모 안내문 공유본', 'school'), 'origin': None}, key()))
    assert D21 and DS, 'P4 문서 준비 실패'
    D21, DS = D21['documentId'], DS['documentId']
    # 수업·학생(P5): 관리자가 수업(교사 21) → 21 이 명부(같은 이름 학생 2) → 관찰 · 평가 확정
    q21, qadm = P5T.Q(T[21], M[21]), P5T.Q(U1, m1)
    C1 = P5T.ent(qadm.mut(P5T.course_cmd('2학년 도덕 A', term2, 'subj-ethics', [M[21]], t2s, t2last)))
    q21.mut(P5T.roster(C1, 1, [P5T.srow('S-0001', '김민준', 2, '1', 1), P5T.srow('S-0002', '김민준', 2, '1', 2)], t2s, t2last))
    studs = {s['schoolStudentKey']: s for s in q21.course(C1)['students']}
    SA, SB = studs['S-0001'], studs['S-0002']
    A21 = {x['id']: x for x in q21.catalog()['courses']}[C1]['assignmentId']
    OBS = P5T.ent(q21.mut(P5T.obs(C1, SA, A21, text='모둠 토론에서 근거를 들어 반론을 정리하고 친구의 의견을 존중함.')))
    RB = q21.mut(P5T.rubric(C1, P5T.crit(5)))
    RBV = q21.course(C1)['rubrics'][0]['revisionId']
    ASM = P5T.ent(q21.mut(P5T.assess(C1, SA, A21, P5T.ent(RB), RBV, [P5T.sc(1, pts=5)], True, comment='자료를 비교해 타당한 결론을 냄.')))
    def evidence(student, kinds=('observation',)):
        st_ = q21.student(C1, student['id'])
        out = []
        for o in st_['observations'] if 'observation' in kinds else []:
            out.append({'kind': 'observation', 'id': o['id'], 'revisionId': o['revisionId'], 'sourceHash': o['contentHash'], 'epoch': o['epoch'], 'start': 0, 'end': len(o['text'])})
        for a in st_['assessments'] if 'assessment' in kinds else []:
            out.append({'kind': 'assessment', 'id': a['id'], 'revisionId': a['revisionId'], 'sourceHash': a['contentHash'], 'epoch': a['epoch'], 'start': 0, 'end': len(a['comment'])})
        return {'studentId': student['id'], 'courseId': C1, 'evidence': out}

    # ======================================================================= A. 설치 전 지문 → P6-01·02·03 → 지문 비교
    before = fingerprint()
    pre = [r for r in sqlfile('P6-00_사전점검_지문.sql') if r[0] == '점검']
    check('A01 P6-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    sqlfile('P6-01_비서_모델.sql'); sqlfile('P6-02_비서_공개함수.sql')
    post = sqlfile('P6-03_사후점검.sql')
    check('A02 P6-03 사후 점검 FAIL 없음, 활성화 없음', all(r[2] in ('ok', 'info') for r in post) and post[-2][3] == '(활성화 없음)', post)
    after = fingerprint()
    check('A03 P6-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A04 P6-01 다시 실행 → 멈춤', 'P6-01 이 이미 적용되었습니다' in sqlerr(src('P6-01_비서_모델.sql')))
    check('A05 P6-02 다시 실행 → 멈춤', 'P6-02 가 이미 적용되었습니다' in sqlerr(src('P6-02_비서_공개함수.sql')))

    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 P6 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_ai_threads_list('x','school',null)")
          and 'permission denied' in err(c, "select public.workhub_ai_prepare(%s::uuid,'m-21','{}'::jsonb,'kkkkkkkk')", (T[21],)))
    c = api(T[21])
    check('B02 로그인한 사람(authenticated)은 서버 API 함수 실행 불가', all('permission denied' in err(c, f"select public.{f}(%s::uuid,'m-21')", (T[21],))
          for f in ('workhub_ai_server_readiness',)) and 'permission denied' in err(c, "select public.workhub_ai_start(%s::uuid,'m-21','kkkkkkkk','x')", (T[21],)))
    c = api(None, 'service_role')
    check('B03 service_role 은 앱 함수 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_ai_confirm_task('m-21','{}'::jsonb,'kkkkkkkk')"))
    c = api(T[21])
    check('B04 authenticated 는 새 표 직접 읽기 불가', all('permission denied' in err(c, f'select * from workhub.{x}') for x in P6_TABLES))
    check('B05 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p6_installed()"))
    hc = api(T[21], 'service_role')
    check('B06 사람 JWT 를 실은 service_role 호출 → FORBIDDEN', err(hc, "select public.workhub_ai_server_readiness(%s::uuid,'m-21')", (T[21],)) == 'FORBIDDEN')
    check('B07 superadmin 아닌 교사(U2) → FORBIDDEN(서버 API 도 · 앱 함수도)', A(U2, 'm-u2').svc('workhub_ai_server_readiness') == 'FORBIDDEN'
          and A(U2, 'm-u2').go('workhub_ai_threads_list', 'school', None) == 'FORBIDDEN')
    check('B08 다른 학교 소속 ID(m-27) · 소속 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', A(T[21], M[27]).svc('workhub_ai_server_readiness') == 'INACTIVE_MEMBERSHIP'
          and t[28].svc('workhub_ai_server_readiness') == 'INACTIVE_MEMBERSHIP' and t[28].go('workhub_ai_threads_list', 'school', None) == 'INACTIVE_MEMBERSHIP')
    check('B09 가입 대기(m-29)·거절(m-30)·정지(m-31) → INACTIVE_MEMBERSHIP',
          [A(u, m).svc('workhub_ai_server_readiness') for u, m in ((U29, 'm-29'), (U30, 'm-30'), (U31, 'm-31'))] == ['INACTIVE_MEMBERSHIP'] * 3)
    st = state()
    r0 = t[21].ready()
    check('B10 설치만 → 서버 준비 상태 not_configured(실제 서버 코드)', adata(r0) == {'available': False, 'reason': 'not_configured'}, r0)
    p0 = Provider(); out, k0, _ = t[21].ask(ask_input(), provider=p0)
    check('B11 설치만 → 질문 NOT_READY · 외부 호출 0', ecode(out) == 'NOT_READY' and p0.bodies == [], out)
    check('B12 설치만 → 대화 목록·대화 NOT_READY', ecode(t[21].threads()) == 'NOT_READY' and ecode(t[21].thread('x')) == 'NOT_READY')
    check('B13 설치만 → 아무것도 쓰지 않음(요청 원장 0)', state() == st)
    check('B14 서버 코드: 키가 없거나 형식이 다르면 DB 호출 전에 NOT_READY',
          all(_raises(lambda e_=e_: AS.execute({'action': 'readiness', 'memberId': M[21]}, 'Bearer ' + 'a' * 40, e_, FakeClient(T[21]), Provider())) == 'NOT_READY'
                  for e_ in ({}, {'ANTHROPIC_API_KEY': 'short'})))

    # ======================================================================= C. P6-04 비서 켜기 · 설정 판
    p64 = os.path.join(S, 'P6-04_비서활성화_설정_양식.sql')
    good = {'approver_user_id': U1, 'approval_ref': '2026-10-20 교무회의 비서 시범 승인', 'verification_ref': '2026-10-20 배포·키 설정 확인(시험 합성)',
            'allowed_members': 'all_members', 'model': 'test-model-1', 'price_table_ref': '시험 합성 가격표',
            'input_price_micro_usd_per_mtok': 3000000, 'output_price_micro_usd_per_mtok': 15000000, 'max_input_tokens': 20000, 'max_output_tokens': 2000,
            'member_daily_micro_usd': 20000000, 'member_monthly_micro_usd': 50000000, 'school_daily_micro_usd': 30000000, 'school_monthly_micro_usd': 100000000}
    check('C01 빈 칸이 남은 P6-04 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P6-04_비서활성화_설정_양식.sql')))
    check('C02 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(fill_json(p64, {**good, 'approver_user_id': T[21]})))
    check('C03 허용 범위 · 모델 · 근거 · 숫자(문자열·0·소수) · 칸 이름 틀림 → 멈춤', all(
        '중단' in sqlerr(fill_json(p64, v)) for v in ({**good, 'allowed_members': 'everyone'}, {**good, 'model': 'bad model'}, {**good, 'verification_ref': ' '},
                                                      {**good, 'max_output_tokens': '2000'}, {**good, 'max_input_tokens': 0}, {**good, 'input_price_micro_usd_per_mtok': 1.5},
                                                      {k: v for k, v in good.items() if k != 'model'})))
    check('C04 1회 예약액이 사람 하루 한도보다 큼 · 한도 순서 틀림 → 멈춤', '한도 순서가 맞지 않습니다' in sqlerr(fill_json(p64, {**good, 'member_daily_micro_usd': 50000}))
          and '한도 순서가 맞지 않습니다' in sqlerr(fill_json(p64, {**good, 'school_daily_micro_usd': 1000000})))
    check('C05 멈춘 P6-04 는 아무것도 쓰지 않음', state() == st)
    check('C06 P6-04 정상 실행(예약액 = ceil((2만×3,000,000 + 2천×15,000,000)/100만) = 90,000)', sqlerr(fill_json(p64, good)) == 'OK'
          and scalar("select reserve_micro_usd from workhub.assistant_policies where school_id=%s and version=1", (s1,)) == 90000)
    check('C07 준비 사유 ready · 다른 학교 policy_missing', scalar("select array[workhub_private.p6_reason(%s), workhub_private.p6_reason('school-2')]::text", (s1,)) == '{ready,policy_missing}')
    check('C08 설정 판은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.assistant_policies set model='other'") == 'IMMUTABLE_ROW')
    check('C09 다른 학교(m-27)는 여전히 not_configured', adata(t[27].ready()) == {'available': False, 'reason': 'not_configured'})
    r1 = t[21].ready()
    check('C10 켠 뒤 서버 준비 상태 available', adata(r1) == {'available': True}, r1)

    # ======================================================================= D. 질문 → 근거 → 한 번 호출 → 대화
    pa = Provider()
    out, ka, cla = t[21].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}]), provider=pa)
    d = adata(out) or {}; th = d.get('thread') or {}
    src1 = json.loads(pa.bodies[0]['messages'][-1]['content'])['authorizedEvidence'] if pa.bodies else []
    check('D01 학교 모드 + 고른 학교 자료 → completed · 새 대화 판 1 · 교환 1(실제 서버 코드)', d.get('state') == 'completed' and th.get('version') == 1
          and len(th.get('exchanges', [])) == 1 and th['exchanges'][0]['requestKey'] == ka, out)
    check('D02 모델에 간 근거: 고른 자료 판 그대로 + 질문 낱말로 찾은 게시 자료(초안·다른 학교 제외) · 모두 학교 공개',
          [s_['title'] for s_ in src1][:1] == ['학업성적관리규정 평가 기준'] and '2학기 지필평가 안내' in [s_['title'] for s_ in src1]
          and not {'초안 자료', '다른 학교 평가 기준'} & {s_['title'] for s_ in src1}
          and scalar("select bool_and(classification='school_public') from workhub.assistant_request_sources")
          and pa.bodies[0]['model'] == 'test-model-1' and pa.bodies[0]['max_tokens'] == 2000, src1)
    check('D03 인용 = 근거 snapshot 그대로(종류·ID·판·제목·위치)', th.get('exchanges') and th['exchanges'][0]['segments'][0]['citations'] ==
          [{'reference': {'kind': 'knowledge', 'id': K1, 'version': K1V}, 'title': '학업성적관리규정 평가 기준', 'locator': '규정 제3조'}], th)
    ra = req(ka)
    check('D04 원장: 완료 · 정산(1200·300 토큰 → 8,100 micro USD) · 호출 1번 · 대화 제목 = 질문 첫 줄',
          ra.get('state') == 'completed' and ra.get('cost_state') == 'settled' and ra.get('actual_micro_usd') == 8100 and len(pa.bodies) == 1
          and th.get('title') == '학업성적관리규정에서 평가 기준은 누가 정하나요?', ra)
    check('D05 원장에 근거 본문 없음(snapshot 은 ID·판·제목·위치)', scalar("select count(*) from workhub.assistant_request_sources where reference::text like '%%교과협의회%%' or title like '%%교과협의회%%'") == 0)
    TH = th.get('id')
    pr = Provider(); out2, _, cl2 = t[21].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}]), ka, provider=pr)
    check('D06 같은 번호·같은 내용(응답 유실 뒤 재전송) → 같은 completed · 외부 호출 0', adata(out2) == d and pr.bodies == []
          and [x[0] for x in cl2.calls] == ['workhub_ai_prepare'], out2)
    out3, _, _ = t[21].ask(ask_input(prompt='다른 질문'), ka)
    check('D07 같은 번호·다른 내용 → IDEMPOTENCY_CONFLICT', ecode(out3) == 'IDEMPOTENCY_CONFLICT', out3)
    pf = Provider()
    out4, kf, _ = t[21].ask(ask_input(prompt='그럼 공개는 언제 하나요?', thread=TH, ver=1), provider=pf)
    d4 = adata(out4) or {}
    check('D08 같은 대화 이어 묻기 → 판 2 · 교환 2 · 모델에 이전 대화(질문·답) 2메시지 + 새 질문', d4.get('state') == 'completed' and d4['thread']['version'] == 2
          and len(d4['thread']['exchanges']) == 2 and [m_['role'] for m_ in pf.bodies[0]['messages']] == ['user', 'assistant', 'user']
          and pf.bodies[0]['messages'][0]['content'] == '학업성적관리규정에서 평가 기준은 누가 정하나요?', out4)
    st = state()
    bad = [ask_input(thread=TH, ver=1),                                                     # 지난 판
           ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V - 1}])]                  # 지난 자료 판
    check('D09 지난 대화 판 · 지난 자료 판 → CONFLICT', [ecode(t[21].ask(b)[0]) for b in bad] == ['CONFLICT'] * 2)
    nf = [ask_input(refs=[{'kind': 'knowledge', 'id': KD, 'version': 1}]), ask_input(refs=[{'kind': 'knowledge', 'id': KO, 'version': KOV}]),
          ask_input(mode='personal', refs=[{'kind': 'document', 'id': D21, 'version': 1}]),
          ask_input(mode='personal', refs=[{'kind': 'task', 'id': 'task-21', 'version': 1}]), ask_input(mode='personal', refs=[{'kind': 'calendar', 'id': 'ev-mine', 'version': 1}]),
          ask_input(mode='personal', refs=[{'kind': 'collection', 'id': 'nope', 'version': 1}])]
    who = [t[21], t[21], t[22], t[22], t[22], t[22]]
    got = [ecode(w.ask(x)[0]) for w, x in zip(who, nf)]
    check('D10 초안 자료 · 다른 학교 자료 · 남의 나만 보기 문서 · 남의 할 일 · 남의 개인 일정 · 없는 수합 → NOT_FOUND', got == ['NOT_FOUND'] * 6, got)
    inv = [ask_input(refs=[{'kind': 'document', 'id': D21, 'version': 1}]), ask_input(refs=[{'kind': 'task', 'id': 'task-21', 'version': 1}]),
           ask_input(refs=[{'kind': 'calendar', 'id': 'ev-mine', 'version': 1}]), ask_input(refs=[{'kind': 'collection', 'id': col, 'version': col_ver}]),
           ask_input(thread=TH, ver=2, mode='personal', intent='personal_assistant')]
    got = [ecode(t[21].ask(x)[0]) for x in inv]
    check('D11 학교 모드에 나만 보기 문서·할 일·개인 일정·수합(참여자 자료) → INVALID_INPUT · 학교 대화를 개인 모드로 → INVALID_INPUT', got == ['INVALID_INPUT'] * 5, got)
    th22 = t[22].ask(ask_input(thread=TH, ver=2))[0]
    check('D12 남의 대화에 이어 묻기 → NOT_FOUND', ecode(th22) == 'NOT_FOUND', th22)
    local = [ask_input(mode='school', intent='personal_assistant'), ask_input(prompt=' '), ask_input(prompt='a' * 4001), ask_input(thread=None, ver=1),
             {**ask_input(), 'x': 1}, ask_input(intent='student_record_draft', mode='personal'),
             ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}] * 2)]
    got = [ecode(t[21].ask(x)[0]) for x in local]
    check('D13 입력 규칙(모드·빈 질문·4,000자 초과·판·모르는 칸·학생 맥락 없는 학생 초안·중복 근거) → INVALID_INPUT(서버 코드가 DB 전에)', got == ['INVALID_INPUT'] * 7, got)
    direct = [t[21].svc('workhub_ai_prepare', x, key()) for x in local] + [t[21].svc('workhub_ai_prepare', ask_input(), 'short')]
    check('D14 같은 입력을 DB 에 직접 → INVALID_INPUT 봉투(서버 코드를 거치지 않아도 같은 규칙)', [ecode(x) for x in direct] == ['INVALID_INPUT'] * 8, [ecode(x) for x in direct])
    check('D15 거절은 아무것도 쓰지 않음', state() == st)
    out, kd, _ = t[22].ask(ask_input(refs=[{'kind': 'document', 'id': DS, 'version': 1}, {'kind': 'calendar', 'id': 'ev-pub', 'version': 1}]))
    check('D16 학교 공유 문서 · 학교 공개 일정은 학교 모드 근거로', astate(out) == 'completed'
          and {x['classification'] for x in scalar("select jsonb_agg(to_jsonb(s)) from workhub.assistant_request_sources s join workhub.assistant_requests r on r.id=s.request_id where r.request_key=%s", (kd,))}
          == {'school_public'}, out)

    # ======================================================================= E. 개인 모드 · 할 일 제안 · 확정
    pt = Provider(task={'title': '평가 기준 공개 공문 확인', 'notes': '교무부 확인', 'dueDate': DAY(5)}, cite='all')
    out, kp, _ = t[21].ask(ask_input(prompt='할 일 정리해 줘', mode='personal', intent='personal_assistant',
                                     refs=[{'kind': 'task', 'id': 'task-21', 'version': 1}, {'kind': 'calendar', 'id': 'ev-mine', 'version': 1},
                                           {'kind': 'document', 'id': D21, 'version': 1}, {'kind': 'collection', 'id': col, 'version': col_ver}]), provider=pt)
    dp = adata(out) or {}
    ex = (dp.get('thread') or {}).get('exchanges', [{}])[-1]
    prop = ex.get('proposal') or {}
    check('E01 개인 모드: 내 할 일 · 개인 일정 · 나만 보기 문서 · 수합 근거 → completed · 할 일 제안 pending 판 1', dp.get('state') == 'completed'
          and prop.get('status') == 'pending' and prop.get('version') == 1 and prop.get('resourceId') is None
          and {c_['reference']['kind'] for c_ in ex['segments'][0]['citations']} == {'task', 'calendar', 'document', 'collection'}, out)
    TP = dp.get('thread', {}).get('id')
    check('E02 개인 근거 분류 owner_private(할 일은 언제나)', scalar("select array_agg(distinct s.classification) from workhub.assistant_request_sources s join workhub.assistant_requests r on r.id=s.request_id where r.request_key=%s", (kp,)) == ['owner_private'])
    ci = {'threadId': TP, 'proposalId': prop.get('id'), 'expectedVersion': 1, 'input': {'title': '평가 기준 공개 공문 확인(수정)', 'notes': '', 'dueDate': DAY(6)}}
    kc = key(); e = t[21].confirm(ci, kc); rc = data(e) or {}
    tk = scalar("select to_jsonb(t) from workhub.tasks t where id=%s", (rc.get('taskId'),)) or {}
    check('E03 제안 확정 → 내 할 일 1개(교사가 고친 내용) · 제안 판 2 · 대화 판 +1', rc.get('proposalVersion') == 2 and rc.get('taskVersion') == 1
          and rc.get('threadVersion') == 2 and tk.get('title') == '평가 기준 공개 공문 확인(수정)' and tk.get('owner_account_id') == 'acc-21'
          and tk.get('source_type') == 'direct', e)
    check('E04 확정은 R0 업무와 같은 감사(task.create · owner_only) · outbox task.saved', scalar(
        "select count(*) from workhub.audit_events where operation='task.create' and resource_id=%s and sensitivity='owner_only'", (rc.get('taskId'),)) == 1
          and scalar("select count(*) from workhub.outbox where topic='task.saved' and aggregate_id=%s", (rc.get('taskId'),)) == 1)
    check('E05 같은 번호 재전송 → 처음 접수증 · 할 일 1개', data(t[21].confirm(ci, kc)) == rc and n('tasks', "owner_account_id='acc-21'") == 2)
    check('E06 같은 번호·다른 내용 → IDEMPOTENCY_CONFLICT', ecode(t[21].confirm({**ci, 'input': {**ci['input'], 'notes': '다름'}}, kc)) == 'IDEMPOTENCY_CONFLICT')
    check('E07 이미 확정된 제안 다시(새 번호) → CONFLICT', ecode(t[21].confirm(ci)) == 'CONFLICT')
    g = t[21].thread(TP); gx = (data(g) or {}).get('exchanges', [{}])[-1].get('proposal') or {}
    check('E08 대화 다시 열기: 제안 applied · 할 일 ID · 확정한 내용', gx.get('status') == 'applied' and gx.get('resourceId') == rc.get('taskId')
          and gx.get('input', {}).get('title') == '평가 기준 공개 공문 확인(수정)' and data(g)['version'] == 2, g)
    st = state()
    pt2 = Provider(task={'title': '긴 제목 확인', 'notes': '', 'dueDate': ''})
    out, _, _ = t[21].ask(ask_input(prompt='하나 더', mode='personal', intent='personal_assistant', thread=TP, ver=2), provider=pt2)
    p2 = (adata(out) or {}).get('thread', {}).get('exchanges', [{}])[-1].get('proposal') or {}
    ci2 = {'threadId': TP, 'proposalId': p2.get('id'), 'expectedVersion': 1, 'input': {'title': '가' * 121, 'notes': '', 'dueDate': ''}}
    check('E09 할 일 제목 121자(앱 초안 한도 200 안, R0 업무 한도 120 밖) → INVALID_INPUT(계약 차이 — 보고)', ecode(t[21].confirm(ci2)) == 'INVALID_INPUT')
    check('E10 남의 제안(22) → NOT_FOUND · 지난 제안 판 → CONFLICT', ecode(t[22].confirm({**ci2, 'input': {'title': '확인', 'notes': '', 'dueDate': ''}})) == 'NOT_FOUND'
          and ecode(t[21].confirm({**ci2, 'expectedVersion': 2, 'input': {'title': '확인', 'notes': '', 'dueDate': ''}})) == 'CONFLICT')
    bad_c = [{**ci2, 'x': 1}, {**ci2, 'input': {'title': '확인', 'notes': '', 'dueDate': '2026-02-30'}}, {**ci2, 'expectedVersion': 0}]
    check('E11 확정 입력 규칙(모르는 칸 · 없는 날짜 · 판 0) → INVALID_INPUT', [ecode(t[21].confirm(b)) for b in bad_c] == ['INVALID_INPUT'] * 3)
    # 강제 실패: 할 일 저장 중 → 모든 표 원상태, 같은 번호 재시도 → 한 번만
    st = state()
    sqlfile(None, text="create function workhub_private.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM_TEST'; end $$;"
                       "create trigger zz_boom before insert on workhub.assistant_task_requests for each row execute function workhub_private.zz_boom()")
    ci3 = {**ci2, 'input': {'title': '확인', 'notes': '', 'dueDate': ''}}; kb = key()
    rb = t[21].confirm(ci3, kb)
    check('E12 확정 중 강제 실패(마지막 원장 기록에서) → 오류 그대로 · 할 일·제안·대화·감사·outbox 원상태', rb == 'BOOM_TEST' and state() == st, rb)
    sqlfile(None, text="drop trigger zz_boom on workhub.assistant_task_requests; drop function workhub_private.zz_boom()")
    e = t[21].confirm(ci3, kb)
    check('E13 같은 번호 재시도 → 한 번만 반영', data(e) and data(t[21].confirm(ci3, kb)) == data(e) and n('tasks', "title='확인'") == 1, e)

    # ======================================================================= F. 학생 기록 초안(P5 근거)
    ev = evidence(SA, ('observation', 'assessment'))
    pe = Provider(cite='evidence')
    out, ks, _ = t[21].ask(ask_input(prompt='관찰과 평가 의견으로 세부능력특기사항 초안을 써 줘', mode='personal', intent='student_record_draft', student=ev), provider=pe)
    ds = adata(out) or {}
    srcs = json.loads(pe.bodies[0]['messages'][-1]['content'])['authorizedEvidence'] if pe.bodies else []
    check('F01 학생 기록 초안: 현재 관찰·확정 평가의 정확한 구간만 근거 · completed · 모든 문단에 학생 근거 인용(서버 검사 통과)',
          ds.get('state') == 'completed' and [s_['body'] for s_ in srcs] == ['모둠 토론에서 근거를 들어 반론을 정리하고 친구의 의견을 존중함.', '자료를 비교해 타당한 결론을 냄.']
          and ds['thread']['exchanges'][0]['studentContext'] == ev, out)
    check('F02 학생 기록 초안에는 학교 자료를 찾아 붙이지 않음 · 분류 student_learning', len(srcs) == 2 and scalar(
        "select array_agg(distinct s.classification) from workhub.assistant_request_sources s join workhub.assistant_requests r on r.id=s.request_id where r.request_key=%s", (ks,)) == ['student_learning'])
    part = {**ev, 'evidence': [{**ev['evidence'][0], 'start': 3, 'end': 10}]}
    pe2 = Provider(cite='evidence'); out, _, _ = t[21].ask(ask_input(prompt='한 구간만', mode='personal', intent='student_record_draft', student=part), provider=pe2)
    check('F03 구간 근거(3~10) → 모델에 그 7자만', astate(out) == 'completed' and json.loads(pe2.bodies[0]['messages'][-1]['content'])['authorizedEvidence'][0]['body']
          == '모둠 토론에서 근거를 들어 반론을 정리하고 친구의 의견을 존중함.'[3:10], out)
    TS = ds.get('thread', {}).get('id')
    bad_e = [{**ev, 'evidence': [{**ev['evidence'][0], 'sourceHash': '0' * 64}]}, {**ev, 'evidence': [{**ev['evidence'][0], 'end': 999}]},
             {**ev, 'studentId': SB['id']}]
    got = [ecode(t[21].ask(ask_input(prompt='x', mode='personal', intent='student_record_draft', student=b))[0]) for b in bad_e]
    check('F04 지문 다름 · 구간 밖 → CONFLICT · 다른 학생(같은 이름) → NOT_FOUND', got == ['CONFLICT', 'CONFLICT', 'NOT_FOUND'], got)
    check('F05 남의 학생 근거(22 가 21 의 관찰) → NOT_FOUND', ecode(t[22].ask(ask_input(prompt='x', mode='personal', intent='student_record_draft', student=ev))[0]) == 'NOT_FOUND')
    out, kfg, _ = t[21].ask(ask_input(prompt='근거 없는 문장', mode='personal', intent='student_record_draft', student=ev), provider=Provider(cite='none'))
    check('F06 모델이 학생 근거 없는 문단을 내면 → rejected OUTPUT_INVALID(서버 검사) · 사용량은 정산', astate(out) == 'rejected' and adata(out)['code'] == 'OUTPUT_INVALID'
          and req(kfg).get('cost_state') == 'settled', out)
    # 관찰 정정 → 그 근거로 만든 교환은 대화에서 빠지고, 재조회는 CONFLICT
    obs_now = q21.student(C1, SA['id'])['observations'][0]
    q21.mut(P5T.obs(C1, SA, A21, text='정정한 관찰 기록', rid=OBS, ver=obs_now['version'], reason='표현 정정'))
    g = t[21].thread(TS)
    check('F07 관찰 정정 뒤: 그 근거의 교환은 대화에서 빠짐(목록에는 대화가 남음)', ok(g) and data(g)['exchanges'] == [] and TS in [x['id'] for x in data(t[21].threads('personal'))['items']], g)
    out, _, _ = t[21].ask(ask_input(prompt='관찰과 평가 의견으로 세부능력특기사항 초안을 써 줘', mode='personal', intent='student_record_draft', student=ev), ks)
    check('F08 정정 뒤 같은 번호 재조회 → CONFLICT · 옛 근거로 새 질문 → CONFLICT', ecode(out) == 'CONFLICT'
          and ecode(t[21].ask(ask_input(prompt='다시', mode='personal', intent='student_record_draft', student=ev))[0]) == 'CONFLICT', out)

    # ======================================================================= G. 외부 호출 결과 · 응답 유실 · 시간 초과 · 동시
    st0 = n('assistant_requests')
    out, kr, _ = t[22].ask(ask_input(prompt='거절 시험'), provider=Provider('reject'))
    rr = req(kr)
    check('G01 모델 회사 거절(4xx) → rejected PROVIDER_REJECTED · 사용량 없음 → 청구 미확인(예약액으로 셈)', astate(out) == 'rejected' and adata(out)['code'] == 'PROVIDER_REJECTED'
          and rr.get('cost_state') == 'unknown' and rr.get('actual_micro_usd') is None, out)
    out, kt, _ = t[22].ask(ask_input(prompt='잘림 시험'), provider=Provider('truncate'))
    check('G02 출력 한도에서 잘림 → rejected TRUNCATED · 사용량 정산', adata(out) == {'state': 'rejected', 'requestKey': kt, 'code': 'TRUNCATED'} and req(kt).get('cost_state') == 'settled', out)
    out, kx, _ = t[22].ask(ask_input(prompt='위조 시험'), provider=Provider(cite='forged'))
    check('G03 모델이 없는 근거 키를 대면 → rejected OUTPUT_INVALID(답 저장 없음)', adata(out) == {'state': 'rejected', 'requestKey': kx, 'code': 'OUTPUT_INVALID'}
          and req(kx).get('exchange_id') is None, out)
    pu = Provider('raise')
    out, ku, _ = t[22].ask(ask_input(prompt='시간 초과 시험'), provider=pu)
    check('G04 호출 중 시간 초과·연결 끊김 → pending provider_unknown · 청구 미확인', adata(out) == {'state': 'pending', 'requestKey': ku, 'reason': 'provider_unknown'}
          and req(ku).get('state') == 'provider_unknown' and req(ku).get('cost_state') == 'unknown', out)
    pz = Provider(); out, _, cz = t[22].ask(ask_input(prompt='시간 초과 시험'), ku, provider=pz)
    check('G05 결과 불명 재조회 → 같은 pending · 다시 호출하지 않음', adata(out) == {'state': 'pending', 'requestKey': ku, 'reason': 'provider_unknown'} and pz.bodies == [])
    pl = Provider()
    out, kl, cl = t[22].ask(ask_input(prompt='응답 유실 시험'), provider=pl, client=FakeClient(T[22], lose='workhub_ai_finish'))
    check('G06 완료 기록 응답이 사라짐 → 서버는 pending provider_unknown(새 호출 없음) · DB 는 completed', adata(out) == {'state': 'pending', 'requestKey': kl, 'reason': 'provider_unknown'}
          and req(kl).get('state') == 'completed' and len(pl.bodies) == 1, out)
    pl2 = Provider(); out, _, _ = t[22].ask(ask_input(prompt='응답 유실 시험'), kl, provider=pl2)
    check('G07 같은 번호 재조회 → completed 회복 · 호출 0', astate(out) == 'completed' and pl2.bodies == [], out)
    # 같은 번호 동시 2건 → 외부 호출 1번
    kk = key(); pc = Provider(); inp = ask_input(prompt='동시 같은 번호')
    outs = concurrently([lambda: t[22].ask(inp, kk, provider=pc)[0], lambda: t[22].ask(inp, kk, provider=pc)[0]])
    check('G08 같은 번호 동시 2건 → 외부 호출 1번 · 하나는 completed', len(pc.bodies) == 1 and 'completed' in [astate(o) for o in outs]
          and all(astate(o) in ('completed', 'pending') for o in outs), [astate(o) for o in outs])
    # 같은 대화에 다른 번호 동시 2건 → 하나만
    o1 = adata(t[22].ask(ask_input(prompt='대화 시작'))[0]); T22 = o1['thread']['id']
    pc2 = Provider()
    outs = concurrently([lambda: t[22].ask(ask_input(prompt='동시 A', thread=T22, ver=1), provider=pc2)[0],
                         lambda: t[22].ask(ask_input(prompt='동시 B', thread=T22, ver=1), provider=pc2)[0]])
    check('G09 같은 대화 같은 판에 동시 2건 → 하나 completed · 하나 CONFLICT(답이 겹쳐 붙지 않음)', sorted(str(astate(o)) for o in outs) == ['CONFLICT', 'completed'], outs)
    # 준비 → 시작을 직접: 시작권은 한 번
    k2 = key(); pp = t[22].svc('workhub_ai_prepare', ask_input(prompt='직접 준비'), k2)
    lt = (pp.get('data') or {}).get('leaseToken')
    s1_ = t[22].svc('workhub_ai_start', k2, lt); s2_ = t[22].svc('workhub_ai_start', k2, lt)
    check('G10 시작 두 번 → true 한 번 · 두 번째 false', data(s1_) == {'started': True} and data(s2_) == {'started': False}, (s1_, s2_))
    check('G11 시작한 요청 재조회 → pending in_progress', data(t[22].svc('workhub_ai_prepare', ask_input(prompt='직접 준비'), k2)) == {'state': 'pending', 'requestKey': k2, 'reason': 'in_progress'})
    seg = [{'text': '답', 'citations': [{'reference': {'kind': 'knowledge', 'id': K1, 'version': K1V}, 'title': '가짜', 'locator': '가짜'}]}]
    fin = lambda res, lease=lt: t[22].svc('workhub_ai_finish', k2, lease, res)
    st = state()
    forged = [{'state': 'completed', 'usage': {'inputTokens': 1, 'outputTokens': 1}, 'providerMessageId': 'msg_x1', 'segments': seg, 'taskDraft': None},
              {'state': 'completed', 'usage': None, 'providerMessageId': None, 'segments': [{'text': '답', 'citations': []}], 'taskDraft': None},
              {'state': 'completed', 'usage': {'inputTokens': 1, 'outputTokens': 1}, 'providerMessageId': 'msg_x1', 'segments': [{'text': '답', 'citations': []}],
               'taskDraft': {'title': '학교 모드 제안', 'notes': '', 'dueDate': ''}},
              {'state': 'rejected', 'code': 'OTHER', 'usage': None, 'providerMessageId': None},
              {'state': 'provider_unknown', 'usage': {'inputTokens': 1, 'outputTokens': 1}, 'providerMessageId': None}]
    check('G12 결과 모양 위반(snapshot 에 없는 인용 · 사용량 없는 완료 · 학교 모드 할 일 초안 · 모르는 코드 · 짝 안 맞는 사용량) → INVALID_INPUT · 쓰기 0',
          [ecode(fin(x)) for x in forged] == ['INVALID_INPUT'] * 5 and state() == st, [ecode(fin(x)) for x in forged])
    good_fin = {'state': 'completed', 'usage': {'inputTokens': 10, 'outputTokens': 5}, 'providerMessageId': req(kl).get('provider_message_id'),
                'segments': [{'text': '답', 'citations': []}], 'taskDraft': None}
    check('G13 다른 요청의 응답 ID 재사용 → INVALID_INPUT · 다른 임대 토큰 → CONFLICT', ecode(fin(good_fin)) == 'INVALID_INPUT'
          and ecode(fin({**good_fin, 'providerMessageId': 'msg_new1'}, 'f' * 64)) == 'CONFLICT')
    # 끝 기록 중 강제 실패 → 원장·대화 원상태, 같은 끝 재시도 → 한 번만
    sqlfile(None, text="create function workhub_private.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM_TEST'; end $$;"
                       "create trigger zz_boom before insert on workhub.assistant_exchanges for each row execute function workhub_private.zz_boom()")
    gf = {**good_fin, 'providerMessageId': 'msg_new1'}
    st = state(); rbm = fin(gf)
    check('G14 완료 기록 중 강제 실패 → 오류 그대로 · 원장(started)·대화·감사 원상태', rbm == 'BOOM_TEST' and state() == st and req(k2).get('state') == 'started', rbm)
    sqlfile(None, text="drop trigger zz_boom on workhub.assistant_exchanges; drop function workhub_private.zz_boom()")
    f1 = fin(gf); f2 = fin(gf)
    check('G15 같은 끝 재시도 → completed 한 번 · 같은 결과 재전송은 같은 응답 · 다른 결과는 IDEMPOTENCY_CONFLICT', astate(f1) == 'completed' and f1 == f2
          and ecode(fin({**gf, 'segments': [{'text': '다른 답', 'citations': []}]})) == 'IDEMPOTENCY_CONFLICT' and n('assistant_exchanges', 'request_id=%s', (req(k2)['id'],)) == 1, f1)
    # 임대 만료 → 다시 인수(시작 전이라 호출 없었음이 확실)
    k3 = key(); p3 = t[22].svc('workhub_ai_prepare', ask_input(prompt='임대 만료'), k3)
    call(admin(), "update workhub.assistant_requests set lease_until = clock_timestamp() - interval '1 second' where request_key=%s", (k3,))
    check('G16 임대 끝난 시작 전 요청은 예산 0 · 옛 임대로 시작 → false', scalar("select workhub_private.p6_charge(r) from workhub.assistant_requests r where request_key=%s", (k3,)) == 0
          and data(t[22].svc('workhub_ai_start', k3, p3['data']['leaseToken'])) == {'started': False})
    pg = Provider(); out, _, _ = t[22].ask(ask_input(prompt='임대 만료'), k3, provider=pg)
    check('G17 같은 번호 재전송 → 모든 확인을 다시 하고 새 임대로 한 번 호출 · completed(claims 2)', astate(out) == 'completed' and len(pg.bodies) == 1
          and req(k3).get('claims') == 2 and req(k3).get('lease_token') != p3['data']['leaseToken'], out)

    # ======================================================================= H. 예산 · 허용 범위 · 중지 · 역할 회수
    tight = {**good, 'approval_ref': '시험: 예산 줄임', 'member_daily_micro_usd': 200000, 'member_monthly_micro_usd': 50000000}
    check('H01 설정 새 판(예산 줄임) → 판 2 · 활성화 1행 그대로', sqlerr(fill_json(p64, tight)) == 'OK'
          and scalar("select max(version) from workhub.assistant_policies where school_id=%s", (s1,)) == 2 and n('module_activations', "module='assistant'") == 1)
    out, kb1, _ = t[23].ask(ask_input(prompt='예산 시험 1'))
    kq1, kq2, kq3 = key(), key(), key()
    a1 = t[23].svc('workhub_ai_prepare', ask_input(prompt='예산 2'), kq1); a2 = t[23].svc('workhub_ai_prepare', ask_input(prompt='예산 3'), kq2)
    a3 = t[23].svc('workhub_ai_prepare', ask_input(prompt='예산 4'), kq3)
    check('H02 사용 8,100 + 예약 90,000 × 2 ≤ 하루 200,000 · 세 번째 예약 → BUDGET_EXCEEDED · 준비 상태 budget_exhausted', astate(out) == 'completed'
          and data(a1)['state'] == 'claimed' and data(a2)['state'] == 'claimed' and ecode(a3) == 'BUDGET_EXCEEDED' and ecode(t[23].ask(ask_input(prompt='예산 5'))[0]) == 'BUDGET_EXCEEDED'
          and adata(t[23].ready()) == {'available': False, 'reason': 'budget_exhausted'}, (a1, a2, a3))
    check('H03 다른 교사(24)는 자기 한도로 계속', adata(t[24].ready()) == {'available': True})
    check('H04 예약 정보: 판 2 · 예약액 · 사람 한도(서버가 검사)', data(a1)['policy']['budget'] == {'reservationId': req(kq1)['id'], 'policyVersion': 2, 'currency': 'USD',
          'reservedMicroUsd': 90000, 'dailyLimitMicroUsd': 200000, 'monthlyLimitMicroUsd': 50000000} and data(a1)['policy']['configVersion'] == 2, data(a1))
    call(admin(), "update workhub.assistant_requests set lease_until = clock_timestamp() - interval '1 second' where request_key = any(%s)", ([kq1, kq2],))
    check('H05 시작 안 한 예약의 임대가 끝나면 한도가 돌아옴', adata(t[23].ready()) == {'available': True})
    # 학교 하루 한도: 동시에 여러 사람이 예약해도 넘지 않음(학교 잠금)
    sch = {**good, 'approval_ref': '시험: 학교 하루 한도', 'member_daily_micro_usd': 200000, 'school_daily_micro_usd': 200000 + int(scalar(
        "select coalesce(sum(workhub_private.p6_charge(r)),0) from workhub.assistant_requests r where school_id=%s and budget_day=%s::date", (s1, DAY())))}
    sqlerr(fill_json(p64, sch))
    outs = concurrently([lambda w=w: w.svc('workhub_ai_prepare', ask_input(prompt='학교 한도'), key()) for w in (t[24], t[25], t[21], adm)])
    check('H06 학교 하루 한도: 4명 동시 예약 → 2명만(90,000 × 2 ≤ 남은 200,000)', sorted(str(data(o)['state'] if ok(o) else ecode(o)) for o in outs)
          == ['BUDGET_EXCEEDED', 'BUDGET_EXCEEDED', 'claimed', 'claimed'], [ecode(o) or 'claimed' for o in outs])
    call(admin(), "update workhub.assistant_requests set lease_until = clock_timestamp() - interval '1 second' where state='claimed'")
    restricted = {**good, 'approval_ref': '시험: 관리자만', 'allowed_members': 'school_admin'}
    sqlerr(fill_json(p64, restricted))
    check('H07 허용 범위 school_admin → 교사 준비 상태 not_allowed · 질문 FORBIDDEN · 관리자는 가능', adata(t[21].ready()) == {'available': False, 'reason': 'not_allowed'}
          and ecode(t[21].ask(ask_input(prompt='관리자만'))[0]) == 'FORBIDDEN' and astate(adm.ask(ask_input(prompt='관리자 질문'))[0]) == 'completed')
    check('H08 허용 범위가 줄어도 이미 끝난 요청 재조회 · 내 대화 읽기는 됨', astate(t[21].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}]), ka)[0]) == 'completed'
          and ok(t[21].thread(TH)))
    # 관리자 역할 회수 → 즉시 not_allowed
    call(admin(), "update workhub.membership_roles set revoked_at = now(), revoke_reason='시험 회수' where membership_id=%s and role_code='school_admin'", (m1,))
    check('H09 관리자 역할 회수 → 즉시 not_allowed', adata(adm.ready()) == {'available': False, 'reason': 'not_allowed'})
    call(admin(), "update workhub.membership_roles set revoked_at = null, revoke_reason = null where membership_id=%s and role_code='school_admin'", (m1,))
    sqlerr(fill_json(p64, {**good, 'approval_ref': '시험: 원래 설정으로'}))
    # 준비 뒤 · 시작 전 중지 → 시작 NOT_READY · 호출 0
    k4 = key(); p4 = t[24].svc('workhub_ai_prepare', ask_input(prompt='중지 시험'), k4)
    stop()
    check('H10 P2-80 중지 → 준비한 요청의 시작 NOT_READY(외부 호출 없음) · 새 질문 NOT_READY · 목록 NOT_READY · 준비 상태 not_configured',
          ecode(t[24].svc('workhub_ai_start', k4, p4['data']['leaseToken'])) == 'NOT_READY' and ecode(t[21].ask(ask_input(prompt='중지 중'))[0]) == 'NOT_READY'
          and ecode(t[21].threads()) == 'NOT_READY' and adata(t[21].ready()) == {'available': False, 'reason': 'not_configured'})
    check('H11 중지 중에도 이미 끝난 요청의 재조회(응답 유실 복구)는 원래 결과', astate(t[21].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}]), ka)[0]) == 'completed')
    resume()
    check('H12 P2-81 재개 → 다시 질문', astate(t[21].ask(ask_input(prompt='재개 뒤'))[0]) == 'completed')
    # 호출 중 소속 정지 → 사용량은 남기고 답은 보류
    k5 = key(); p5 = t[25].svc('workhub_ai_prepare', ask_input(prompt='호출 중 정지'), k5); t[25].svc('workhub_ai_start', k5, p5['data']['leaseToken'])
    call(admin(), "update workhub.memberships set status='suspended' where id='m-25'")
    f5 = t[25].svc('workhub_ai_finish', k5, p5['data']['leaseToken'],
                   {'state': 'completed', 'usage': {'inputTokens': 100, 'outputTokens': 10}, 'providerMessageId': 'msg_susp1',
                    'segments': [{'text': '답', 'citations': []}], 'taskDraft': None})
    r5 = req(k5)
    check('H13 호출 중 소속 정지 → 끝 기록은 됨: 사용량 정산 · 답 보류(OUTPUT_INVALID, access_lost) · 대화 없음', data(f5) == {'state': 'rejected', 'requestKey': k5, 'code': 'OUTPUT_INVALID'}
          and r5.get('cost_state') == 'settled' and r5.get('withheld_reason') == 'access_lost' and r5.get('exchange_id') is None, (f5, r5))
    check('H14 정지된 사람의 새 요청 → INACTIVE_MEMBERSHIP', ecode(t[25].ask(ask_input())[0]) == 'INACTIVE_MEMBERSHIP')
    call(admin(), "update workhub.memberships set status='active' where id='m-25'")

    # ======================================================================= I. 관리 확인(P6-05)
    p65 = os.path.join(S, 'P6-05_비서요청_관리확인_양식.sql')
    rs = {'request_key': ku, 'owner_user_id': T[22], 'resolution': 'charged', 'input_tokens': 2000, 'output_tokens': 500, 'provider_message_id': 'msg_console1',
          'evidence_ref': '2026-10-20 관리자 콘솔 사용량 확인(시험)', 'resolver_user_id': U1}
    check('I01 빈 칸이 남은 P6-05 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P6-05_비서요청_관리확인_양식.sql')))
    check('I02 확인자가 학교 관리자가 아님 → 멈춤 · 대상 아닌 요청(완료) → 멈춤', '현재 학교 관리자(school_admin)가 아닙니다' in sqlerr(fill_json(p65, {**rs, 'resolver_user_id': T[21]}))
          and '관리 확인 대상이 아닙니다' in sqlerr(fill_json(p65, {**rs, 'request_key': ka, 'owner_user_id': T[21]})))
    check('I03 charged 인데 토큰 0 · not_charged 인데 토큰 있음 → 멈춤', '토큰 수를 적어' in sqlerr(fill_json(p65, {**rs, 'input_tokens': 0, 'output_tokens': 0}))
          and 'not_charged 면 토큰 수는 0' in sqlerr(fill_json(p65, {**rs, 'resolution': 'not_charged'})))
    check('I04 결과 불명 → charged 확정: resolved · 실사용 13,500 · 시작 기록 그대로 · 감사 operator_only', sqlerr(fill_json(p65, rs)) == 'OK'
          and req(ku).get('state') == 'resolved' and req(ku).get('cost_state') == 'resolved' and req(ku).get('actual_micro_usd') == 13500 and req(ku).get('started_at')
          and scalar("select count(*) from workhub.audit_events where operation='assistant.resolve' and resource_id=%s and sensitivity='operator_only'", (req(ku)['id'],)) == 1)
    out, _, _ = t[22].ask(ask_input(prompt='시간 초과 시험'), ku)
    check('I05 확정 뒤 재조회 → rejected PROVIDER_REJECTED · 같은 요청에 두 번 → 멈춤', adata(out) == {'state': 'rejected', 'requestKey': ku, 'code': 'PROVIDER_REJECTED'}
          and '관리 확인 대상이 아닙니다' in sqlerr(fill_json(p65, rs)), out)
    check('I06 청구 미확인 거절 → not_charged 확정(0) · 상태는 rejected 그대로', sqlerr(fill_json(p65, {**rs, 'request_key': kr, 'resolution': 'not_charged', 'input_tokens': 0,
          'output_tokens': 0, 'provider_message_id': ''})) == 'OK' and req(kr).get('state') == 'rejected' and req(kr).get('actual_micro_usd') == 0)
    # 끝나지 않은 호출(10분 넘음): 시험에서는 시작 시각만 당긴다(원장 보호 트리거를 잠깐 끔 — 시험 준비)
    k6 = key(); p6_ = t[24].svc('workhub_ai_prepare', ask_input(prompt='멈춘 호출'), k6); t[24].svc('workhub_ai_start', k6, p6_['data']['leaseToken'])
    sqlfile(None, text=f"alter table workhub.assistant_requests disable trigger assistant_requests_guard; update workhub.assistant_requests set started_at = started_at - interval '11 minutes' where request_key='{k6}'; alter table workhub.assistant_requests enable trigger assistant_requests_guard")
    check('I07 10분 넘게 끝나지 않은 호출은 P6-03 에 보이고 같은 대화를 막지 않음 · charged 확정 → resolved', '10분 넘게 끝나지 않음 1' in sqlfile('P6-03_사후점검.sql')[-1][3]
          and sqlerr(fill_json(p65, {**rs, 'request_key': k6, 'owner_user_id': T[24], 'provider_message_id': ''})) == 'OK' and req(k6).get('state') == 'resolved')
    check('I08 확정한 뒤 늦게 온 끝 기록 → IDEMPOTENCY_CONFLICT(답을 붙이지 않음)', ecode(t[24].svc('workhub_ai_finish', k6, p6_['data']['leaseToken'],
          {'state': 'completed', 'usage': {'inputTokens': 1, 'outputTokens': 1}, 'providerMessageId': 'msg_late1', 'segments': [{'text': '늦은 답', 'citations': []}], 'taskDraft': None})) == 'IDEMPOTENCY_CONFLICT')

    # ======================================================================= J. 목록 · 쪽 넘김 · 두 학교
    for i in range(51):
        t[24].ask(ask_input(prompt=f'목록 시험 {i}'), provider=Provider(cite='none'))
    l1 = t[24].threads(); l2 = t[24].threads('school', data(l1)['nextCursor']) if ok(l1) else None
    ids = [x['id'] for x in data(l1)['items']] + [x['id'] for x in data(l2)['items']] if ok(l2) else []
    check('J01 대화 목록 50 + 나머지 · 위치 값으로 이어 받기 · 겹침 없음', ok(l1) and len(data(l1)['items']) == 50 and data(l1)['nextCursor'] and len(ids) == len(set(ids)) == n('assistant_threads', "owner_account_id='acc-24' and mode='school'")
          and data(l2)['nextCursor'] is None, l1)
    check('J02 위치 값 위조 · 다른 모드에 쓰기 → INVALID_INPUT', ecode(t[24].threads('school', 'zz')) == 'INVALID_INPUT' and ecode(t[24].threads('personal', data(l1)['nextCursor'])) == 'INVALID_INPUT'
          and ecode(t[24].threads('other')) == 'INVALID_INPUT')
    o = adata(t[24].ask(ask_input(prompt='긴 대화 0'), provider=Provider(cite='none'))[0]); TL = o['thread']['id']; v = 1
    for i in range(1, 52):
        o = adata(t[24].ask(ask_input(prompt=f'긴 대화 {i}', thread=TL, ver=v), provider=Provider(cite='none'))[0]); v = o['thread']['version']
    g1 = t[24].thread(TL); g2 = t[24].thread(TL, data(g1)['nextCursor'])
    check('J03 대화 한 쪽 = 최근 50 교환(오래된 → 새것) · 다음 쪽 2 · 질문 결과도 같은 쪽', ok(g1) and len(data(g1)['exchanges']) == 50 and data(g1)['exchanges'][-1]['prompt'] == '긴 대화 51'
          and len(data(g2)['exchanges']) == 2 and data(g2)['nextCursor'] is None and len(o['thread']['exchanges']) == 50 and o['thread']['nextCursor'], g2)
    t[24].ask(ask_input(prompt='판 바꾸기', thread=TL, ver=v), provider=Provider(cite='none'))
    check('J04 대화 판이 바뀐 뒤 옛 위치 값 → CONFLICT', ecode(t[24].thread(TL, data(g1)['nextCursor'])) == 'CONFLICT')
    check('J05 같은 이름 교사(22·23)는 자기 대화만 · 남의 대화 열기 NOT_FOUND', ecode(t[23].thread(T22)) == 'NOT_FOUND'
          and not set(x['id'] for x in data(t[23].threads())['items']) & set(x['id'] for x in data(t[22].threads())['items']))
    sqlerr(fill_json(p64, {**good, 'approver_user_id': T[27], 'approval_ref': '다른 학교 비서 승인', 'model': 'other-model'}))
    kz = key(); oz, _, _ = t[27].ask(ask_input(prompt='평가 기준 알려 줘'), kz); oy, _, _ = t[21].ask(ask_input(prompt='평가 기준 알려 줘'), kz)
    check('J06 두 학교: 같은 요청 번호를 따로 씀 · 다른 학교 질문은 그 학교 자료만 · 그 학교 설정(모델)', astate(oz) == 'completed' and astate(oy) == 'completed'
          and scalar("select array_agg(distinct s.school_id) from workhub.assistant_request_sources s join workhub.assistant_requests r on r.id=s.request_id where r.request_key=%s and r.school_id='school-2'", (kz,)) == ['school-2'],
          (oz, oy))
    check('J07 다른 학교 교사가 이 학교 대화 · 자료 → NOT_FOUND', ecode(t[27].thread(TH)) == 'NOT_FOUND' and ecode(t[27].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K1, 'version': K1V}]))[0]) == 'NOT_FOUND')
    # 자료 교체: 학교 자료 은퇴 → NOT_FOUND · 문서 새 판 → 옛 판 근거 CONFLICT
    adm.go('workhub_knowledge_mutate', {'kind': 'retire', 'id': K2, 'expectedVersion': K2V, 'reason': '시험: 새 안내로 바뀜'}, key())
    adm.go('workhub_document_mutate', {'kind': 'update', 'documentId': DS, 'expectedVersion': 1, 'input': din('학교 공유 안내문', '바뀐 공유본', 'school')}, key())
    got = [ecode(t[21].ask(ask_input(refs=[{'kind': 'knowledge', 'id': K2, 'version': K2V}]))[0]), ecode(t[22].ask(ask_input(refs=[{'kind': 'document', 'id': DS, 'version': 1}]))[0]),
           astate(t[22].ask(ask_input(refs=[{'kind': 'document', 'id': DS, 'version': 2}]))[0])]
    check('J08 은퇴한 학교 자료 → NOT_FOUND · 문서가 새 판으로 바뀌면 옛 판 근거 → CONFLICT · 새 판은 됨', got == ['NOT_FOUND', 'CONFLICT', 'completed'], got)

    # ======================================================================= K. 마무리
    post = sqlfile('P6-03_사후점검.sql')
    check('K01 P6-03 사후 점검 FAIL 없음(완료 = 교환 · 대화 판 = 교환 + 확정 · 확정 = 할 일 + 접수증)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] == 'FAIL'])
    after2 = fingerprint()
    check('K02 사용 뒤에도 P6 밖 구조 지문(S1~S6) 같음', [r for r in before if r[1] != 'D1 기존 표 행 수·행 해시'] == [r for r in after2 if r[1] != 'D1 기존 표 행 수·행 해시'])
    check('K03 감사: 비서 기록은 ai_run/tool_proposal owner_only(관리 확인만 operator_only) · 질문·답 본문 없음', scalar(
        "select count(*) from workhub.audit_events where resource_type in ('ai_run','tool_proposal') and sensitivity not in ('owner_only','operator_only')") == 0
          and scalar("select count(*) from workhub.audit_events where details::text like '%%평가 기준%%' or details::text like '%%학교 자료를 확인한%%'") == 0)
    check('K04 원장 · 근거 snapshot · 교환 · 제안은 지울 수 없음', all('IMMUTABLE_ROW' in sqlerr(f'delete from workhub.{x}') for x in ('assistant_requests', 'assistant_exchanges', 'assistant_proposals', 'assistant_threads'))
          and 'IMMUTABLE_ROW' in sqlerr('delete from workhub.assistant_request_sources'))

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


def _raises(fn):
    try: fn(); return None
    except AS.CheckError as e: return e.code


if __name__ == '__main__':
    main()
