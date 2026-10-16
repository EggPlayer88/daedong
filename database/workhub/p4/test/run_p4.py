# P4 학교 자료 · HWPX 원문 가져오기 · 문서함 · 질문형 양식 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# Storage 는 storage.objects 행 INSERT/SELECT 로 RLS 판정만 흉내 낸다(파일 본문은 이 도구의 메모리에 둔다).
# 서버 API 는 PR #48 의 실제 apps/main/api/workhub-documents/_knowledge_import.py(run) · _guided_service.py(run) 를 가져와,
#   Supabase 호출만 이 시험 DB(service_role)와 메모리 저장소로 바꿔 끼워 돌린다(P4_APP_SRC 가 없으면 그 시험은 FAIL).
# 받은 응답은 P4_CAPTURE 에 남겨 app_contract_p4.ts 가 PR #48 앱의 실제 어댑터·parser 에 넣는다.
#
# 사용: python3 run_p4.py      (R1-01~03 + P1-01·02 + P2-01·02 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import base64, datetime, hashlib, io, json, os, sys, threading, time, uuid, zipfile
from xml.sax.saxutils import escape
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, coll_input, worker_call, U1, U2, T, M, TODAY, results)
import run_r1

S = os.path.join(HERE, '..')
P2 = os.path.join(HERE, '..', '..', 'p2')
R1 = os.environ['R1_DIR']
OUT = os.environ.get('P4_CAPTURE', '')
APP = os.environ.get('P4_APP_SRC', '')
captures = []
UP, GET = 'storage.object.upload', 'storage.object.get_authenticated'
KB, DB = 'workhub-knowledge-files', 'workhub-document-files'
STORE = {}          # (버킷, 경로) → 실물 바이트(Storage 본문 흉내)
KI = GS = None
API_DIR = os.path.join(APP, 'apps', 'main', 'api', 'workhub-documents') if APP else ''
if APP and os.path.isfile(os.path.join(API_DIR, '_knowledge_import.py')):
    sys.path.insert(0, API_DIR)
    import _knowledge_import as KI  # noqa: E402  (PR #48 실제 서버 API 코드)
    import _guided_service as GS    # noqa: E402
U29, U30, U31 = ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000031')
HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
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

def fingerprint(): return [r for r in sqlfile('P4-00_사전점검_지문.sql') if r[0] == '지문']

P4_TABLES = ['document_policies', 'knowledge_import_policies', 'guided_policies', 'content_requests', 'knowledge_files', 'knowledge_file_leases',
             'knowledge_extractions', 'knowledge_sources', 'knowledge_source_revisions', 'documents', 'document_versions', 'guided_templates',
             'guided_template_versions', 'guided_responses', 'guided_response_versions', 'guided_operations', 'guided_leases', 'guided_artifacts']
def state():
    """P4 표 전부 + 감사·outbox·활성화·Storage 객체의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P4_TABLES)
    return scalar(f"""select jsonb_build_object({parts}, 'audit', (select count(*) from workhub.audit_events),
      'outbox', (select count(*) from workhub.outbox), 'act', (select count(*) from workhub.module_activations), 'objects', (select count(*) from storage.objects))""")

def ecode(env):
    if isinstance(env, dict): return (env.get('error') or {}).get('code')
    return env
def ok(env): return isinstance(env, dict) and 'data' in env

def sha(b): return hashlib.sha256(b).hexdigest()
def zipped(parts):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, raw in parts.items(): z.writestr(name, raw)
    return stream.getvalue()
def para(text): return f'<hp:p><hp:run><hp:t>{escape(text)}</hp:t></hp:run></hp:p>'
def section(body): return (f'<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="{HP}">'
                           + body + '</hs:sec>').encode()
def hwpx(body):
    return zipped({'mimetype': b'application/hwp+zip', 'Contents/content.hpf': b'<package/>', 'Contents/section0.xml': section(body),
                   'META-INF/container.xml': b'<container/>'})
def cell(row, col, text):
    return (f'<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:cellAddr colAddr="{col}" rowAddr="{row}"/><hp:subList>{para(text)}</hp:subList>'
            '</hp:tc></hp:tr></hp:tbl></hp:run></hp:p>')
def doc_hwpx(tag):
    """학교 자료 원문: 문단 3개 + 표 칸 1개 + 그림 1개(누락 개수로 세어야 함)"""
    return hwpx(para(f'{tag} 학업성적관리규정') + para('제3조 평가의 기준은 교과협의회가 정한다.') + cell(0, 1, '성취기준 반영 비율')
                + '<hp:p><hp:run><hp:pic/></hp:run></hp:p>' + para('부칙: 이 규정은 2026년 3월 1일부터 시행한다.'))
def tpl_hwpx(tag):
    """질문형 양식 원본: 채울 문단 3개 + 표 칸 1개 + 여러 run 문단(지원 안 함으로 세어야 함)"""
    return hwpx(para(f'{tag} 연수 결과 보고') + para('성명') + para('연수 내용') + para('제출일') + cell(1, 0, '비고')
                + '<hp:p><hp:run><hp:t>둘로</hp:t></hp:run><hp:run><hp:t>나뉜 문단</hp:t></hp:run></hp:p>')
def fmeta(name, raw): return {'name': name, 'bytes': len(raw), 'sha256': sha(raw)}

def storage_conn(uid, op):
    c = api(uid)
    if op is not None: call(c, "select set_config('storage.operation', %s, false)", (op,))
    return c
def put_object(uid, bucket, path, raw, op=UP, size=None):
    """사용자 SDK 업로드(upsert:false) 흉내: INSERT 정책 판정 + (bucket,name) 유일. 통과하면 본문을 메모리에 둔다."""
    c = storage_conn(uid, op)
    r = err(c, "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values (%s,%s,%s::uuid,%s,%s::jsonb)",
            (bucket, path, uid, uid, json.dumps({'size': len(raw) if size is None else size})))
    c.close()
    if r == 'OK': STORE[(bucket, path)] = raw
    return r
def can_read(uid, bucket, path, op=GET):
    c = storage_conn(uid, op); n = call(c, "select count(*) from storage.objects where bucket_id=%s and name=%s", (bucket, path)); c.close(); return n == 1
def replace_object(bucket, path, owner, raw):
    """서비스 키·대시보드로 실물을 지우고 같은 경로에 다시 올림(실물 id 가 바뀐다)"""
    a = admin()
    call(a, "delete from storage.objects where bucket_id=%s and name=%s", (bucket, path))
    call(a, "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values (%s,%s,%s::uuid,%s,%s::jsonb)",
         (bucket, path, owner, owner, json.dumps({'size': len(raw)})))
    a.close(); STORE[(bucket, path)] = raw

def lock_sql(): return "select pg_advisory_lock(hashtextextended('p4'||chr(31)||%s||chr(31)||%s||chr(31)||%s||chr(31)||%s, 0))"
def holder(school, member, kind, k):
    """같은 요청 번호를 처리 중인 다른 트랜잭션 흉내(세션 잠금). close() 로 푼다."""
    h = psycopg2.connect(host=os.environ['R0_PGHOST'], port=int(os.environ.get('R0_PG_PORT', '55433')), dbname='r0', user='postgres')
    h.autocommit = True; h.cursor().execute(lock_sql(), (school, member, kind, k)); return h

def concurrently(fns, hold_sql=None, hold_args=()):
    h = None
    if hold_sql:
        h = psycopg2.connect(host=os.environ['R0_PGHOST'], port=int(os.environ.get('R0_PG_PORT', '55433')), dbname='r0', user='postgres')
        h.cursor().execute(hold_sql, hold_args)
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    time.sleep(0.8)
    if h: h.commit(); h.close()
    for t in ts: t.join()
    return outs


class P(Who):
    """P4 RPC. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
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
    # 학교 자료
    def kn_list(self, q='', cursor=None): return self.keep('kn_list', self.go('workhub_knowledge_list', q, cursor), query=q, cursor=cursor)
    def kn(self, cmd, k=None):
        k = k or key(); return self.keep('kn_mutate', self.go('workhub_knowledge_mutate', cmd, k), command=cmd, key=k)
    # 원문 가져오기
    def ki_ready(self): return self.keep('ki_ready', self.go('workhub_knowledge_import_readiness'))
    def ki_prepare(self, f, k=None, replay=False, raw=None):
        k = k or key()
        extra = {'file': f, 'key': k, 'replay': replay}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('ki_prepare', self.go('workhub_knowledge_file_prepare_get' if replay else 'workhub_knowledge_file_prepare', f, k), **extra)
    def ki_get(self, fid, k): return self.keep('ki_extract_get', self.go('workhub_knowledge_file_extract_get', fid, k), fileId=fid, key=k)
    def ki_commit(self, imp, k=None, replay=False):
        k = k or key()
        return self.keep('ki_commit', self.go('workhub_knowledge_import_request_get' if replay else 'workhub_knowledge_import_commit', imp, k),
                         input=imp, key=k, replay=replay)
    def ki_original(self, sid, ver, raw=None):
        extra = {'sourceId': sid, 'sourceVersion': ver}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('ki_original', self.go('workhub_knowledge_original_access', sid, ver), **extra)
    # 문서함
    def d_list(self, q='', archived=False, cursor=None):
        return self.keep('doc_list', self.go('workhub_document_list', q.strip(), archived, cursor), query=q, archived=archived, cursor=cursor)
    def d_get(self, did, ver=None): return self.keep('doc_get', self.go('workhub_document_get', did, ver), documentId=did, version=ver)
    def d_hist(self, did): return self.keep('doc_history', self.go('workhub_document_history', did), documentId=did)
    def d(self, cmd, k=None):
        k = k or key(); return self.keep('doc_mutate', self.go('workhub_document_mutate', cmd, k), command=cmd, key=k)
    def d_recover(self, cmd, k): return self.keep('doc_recover', self.go('workhub_document_request_get', cmd, k), command=cmd, key=k)
    # 질문형 양식
    def t_list(self, cursor=None): return self.keep('tpl_list', self.go('workhub_template_list', cursor), cursor=cursor)
    def t_get(self, tid): return self.keep('tpl_get', self.go('workhub_template_get', tid), templateId=tid)
    def t_targets(self): return self.keep('tpl_targets', self.go('workhub_template_collection_targets'))
    def t_prepare(self, f, title, k=None, replay=False, raw=None):
        k = k or key()
        extra = {'file': f, 'title': title, 'key': k, 'replay': replay}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('tpl_prepare', self.go('workhub_template_prepare_get' if replay else 'workhub_template_prepare', f, title, k), **extra)
    def t(self, cmd, k=None):
        k = k or key(); return self.keep('tpl_mutate', self.go('workhub_template_mutate', cmd, k), command=cmd, key=k)
    def t_recover(self, cmd, k): return self.keep('tpl_recover', self.go('workhub_template_request_get', cmd, k), command=cmd, key=k)
    def op_get(self, op): return self.keep('tpl_op_get', self.go('workhub_template_operation_get', op), operation=op)
    def art(self, aid, raw=None):
        extra = {'artifactId': aid}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('tpl_download', self.go('workhub_document_artifact_access', aid), **extra)
    def svc(self, fn, *args, actor=None):
        """서버 API 가 service_role 로 부르는 함수(사람 JWT 없음)"""
        c = api(None, 'service_role')
        try:
            ph = ','.join(['%s'] * (len(args) + 2))
            return call(c, f'select public.{fn}({ph})', (actor or self.uid, self.member) + tuple(json.dumps(a) if isinstance(a, (dict, list)) else a for a in args))
        except psycopg2.Error as e:
            return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
        finally:
            c.close()


class FakeClient:
    """PR #48 서버 API 의 Supabase 클라이언트 자리: 사용자 확인 = 이 교사, RPC = 시험 DB(service_role), 내려받기·올리기 = 메모리 저장소"""
    def __init__(self, who, names, bucket, truncate=None, lose_finish=False):
        self.who, self.names, self.bucket, self.truncate, self.lose_finish, self.calls = who, names, bucket, truncate, lose_finish, []
    def user(self, token): return self.who.uid
    def rpc(self, name, args):
        if name not in self.names: raise KI.basic.CheckError('INVALID_INPUT', 400)
        c = api(None, 'service_role')
        try:
            names = list(args)
            v = call(c, f"select public.{name}({','.join(n + ' => %s' for n in names)})",
                     tuple(json.dumps(args[n]) if isinstance(args[n], (dict, list)) else args[n] for n in names))
        finally:
            c.close()
        self.calls.append((name, v))
        if self.lose_finish and name.endswith('_finish'):
            raise KI.basic.CheckError('RESULT_UNKNOWN')   # DB 는 반영했지만 응답이 오는 길에 끊김
        return json.loads(json.dumps(v))
    def download(self, bucket, path, maximum):
        assert bucket == self.bucket
        raw = STORE[(bucket, path)]
        if len(raw) > maximum: raise KI.basic.FileRejected('FILE_SIZE_LIMIT')
        return raw[:self.truncate] if self.truncate else raw
    def upload(self, path, raw):
        """서버(service_role)가 생성 파일을 올림. 이미 있으면 같은 실물만 재사용(GuidedClient.upload 와 같은 규칙)."""
        if (DB, path) in STORE and scalar("select count(*) from storage.objects where bucket_id=%s and name=%s", (DB, path)) == 1:
            if STORE[(DB, path)] != raw: raise GS.basic.CheckError('CONFLICT', 409)
            return
        a = admin(); call(a, "insert into storage.objects(bucket_id,name,metadata) values (%s,%s,%s::jsonb)", (DB, path, json.dumps({'size': len(raw)}))); a.close()
        STORE[(DB, path)] = raw

def extract(who, fid, k, truncate=None, lose_finish=False):
    """실제 _knowledge_import.run 을 한 번 돌린다 → (응답 또는 ('ERR', code), 호출 기록). 응답은 앱 대조용으로 남긴다."""
    if KI is None: return ('ERR', 'NO_APP'), []
    cl = FakeClient(who, (KI.CLAIM, KI.FINISH), KB, truncate, lose_finish)
    status = 200
    try:
        out = KI.run({'memberId': who.member, 'fileId': fid, 'requestKey': k}, 'Bearer ' + 'a' * 40, cl)
    except KI.basic.CheckError as e:
        out, status = ('ERR', e.code), e.status
    if OUT:
        captures.append({'kind': 'ki_extract', 'scope': {'schoolId': who.school, 'memberId': who.member, 'userId': who.uid}, 'context': who.ctx(),
                         'raw': out if isinstance(out, dict) else None, 'error': None if isinstance(out, dict) else out[1], 'status': status, 'fileId': fid, 'key': k})
    return out, cl.calls

def guided(who, action, tid, tver, rid=None, rver=None, k=None, truncate=None, lose_finish=False):
    """실제 _guided_service.run 을 한 번 돌린다(inspect · render)."""
    k = k or key()
    if GS is None: return ('ERR', 'NO_APP'), [], k
    cl = FakeClient(who, GS.RPCS, DB, truncate, lose_finish)
    payload = {'action': action, 'memberId': who.member, 'templateId': tid, 'templateVersion': tver, 'responseId': rid, 'responseVersion': rver, 'requestKey': k}
    status = 200
    try:
        out = GS.run(payload, 'Bearer ' + 'a' * 40, cl)
    except GS.basic.CheckError as e:
        out, status = ('ERR', e.code), e.status
    if OUT:
        captures.append({'kind': 'tpl_' + action, 'scope': {'schoolId': who.school, 'memberId': who.member, 'userId': who.uid}, 'context': who.ctx(),
                         'raw': out if isinstance(out, dict) else None, 'error': None if isinstance(out, dict) else out[1], 'status': status, 'payload': payload})
    return out, cl.calls, k


def kin(title='학업성적관리규정 요약', body='제3조 평가의 기준은 교과협의회가 정한다.', kind='regulation', locator='규정 제3조', frm=None, thr=''):
    return {'title': title, 'kind': kind, 'body': body, 'locator': locator, 'effectiveFrom': frm or DAY(-30), 'effectiveThrough': thr}
def din(title='가정통신문 초안', body='학부모님께 알려 드립니다.', kind='parent_letter', vis='private', sources=(), basis=None, student=None):
    return {'title': title, 'kind': kind, 'body': body, 'visibility': vis, 'sources': list(sources), 'basisDate': basis or DAY(), 'studentContext': student}
def ksrc(sid, ver, kind='knowledge', locator='규정 제3조', quote='평가의 기준'):
    return {'kind': kind, 'sourceId': sid, 'sourceVersion': ver, 'locator': locator, 'quote': quote}


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    start_day = scalar("select min(starts_on) from workhub.academic_years where school_id=%s", (s1,))
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
    # 질문형 양식이 이을 수합: R1 시험과 같은 합성 정책·작업자로 수합을 켜고 관리자(U1)가 HWPX 파일 칸이 있는 수합을 게시한다(운영 값 아님)
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
    col2 = data(adm0.mutate({'kind': 'create', 'input': coll_input(title='PDF 만 받는 수합', fileCollection={'policy': {'extensions': ['pdf'], 'maxFileBytes': 100000, 'maxFiles': 1}, 'required': False, 'templates': []})}))['resourceId']
    adm0.mutate({'kind': 'publish', 'requestId': col2, 'expectedVersion': 1})
    col_ver = scalar('select version from workhub.collections where id=%s', (col,))
    assert scalar("select state from workhub.collections where id=%s", (col,)) == 'published', '수합 게시 준비 실패'

    # ======================================================================= A. 설치 전 지문 → P4-01·02·03 → 지문 비교
    before = fingerprint()
    pre = [r for r in sqlfile('P4-00_사전점검_지문.sql') if r[0] == '점검']
    check('A01 P4-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    sqlfile('P4-01_자료_문서_모델.sql'); sqlfile('P4-02_자료_문서_공개함수_Storage.sql')
    post = sqlfile('P4-03_사후점검.sql')
    check('A02 P4-03 사후 점검 FAIL 없음, 네 모듈 활성화 없음', all(r[2] in ('ok', 'info') for r in post) and post[-2][3] == '(활성화 없음)', post)
    after = fingerprint()
    check('A03 P4-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A04 P4-01 다시 실행 → 멈춤', 'P4-01 이 이미 적용되었습니다' in sqlerr(src('P4-01_자료_문서_모델.sql')))
    check('A05 P4-02 다시 실행 → 멈춤', 'P4-02 가 이미 적용되었습니다' in sqlerr(src('P4-02_자료_문서_공개함수_Storage.sql')))
    check('A06 수합 버킷 준비 판정(R1)이 P4 정책을 다른 버킷으로 인식', scalar('select workhub_private.c_storage_ok()') is True)
    check('A07 두 버킷 준비 판정 = 정상(P4-02 그대로)', scalar("select workhub_private.p4_storage_ok('workhub-knowledge-files') and workhub_private.p4_storage_ok('workhub-document-files')") is True)
    check('A08 수합은 그대로 ready(P4 설치가 R1 준비를 바꾸지 않음)', data(adm0.rpc('workhub_collection_readiness'))['reason'] == 'ready')

    t = {n: P(T[n], M[n]) for n in (21, 22, 23, 24, 25, 26, 27)}
    adm = P(U1, m1)
    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 P4 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_knowledge_list('x','',null)"))
    c = api(None, 'service_role')
    check('B02 service_role 은 앱 함수 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_document_list('x','',false,null)"))
    c = api(T[21])
    check('B03 authenticated 는 서버 API 함수(claim·finish) 실행 불가',
          'permission denied' in err(c, "select public.workhub_knowledge_file_extract_claim(%s::uuid,'m-21','f','kkkkkkkk')", (T[21],))
          and 'permission denied' in err(c, "select public.workhub_template_render_finish(%s::uuid,'m-21','t',1,'r',1,'kkkkkkkk','t',gen_random_uuid(),'{}')", (T[21],)))
    check('B04 authenticated 는 새 표 직접 읽기 불가', 'permission denied' in err(c, 'select * from workhub.documents')
          and 'permission denied' in err(c, 'select * from workhub.knowledge_sources'))
    check('B05 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p4_installed()"))
    check('B06 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', err(api(U2), "select public.workhub_knowledge_list('m-u2','',null)") == 'FORBIDDEN')
    check('B07 다른 학교 소속 ID(m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_document_list(%s,'',false,null)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('B08 소속 기간이 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', P(T[28], M[28]).go('workhub_knowledge_list', '', None) == 'INACTIVE_MEMBERSHIP')
    check('B09 가입 대기(m-29)·거절(m-30)·정지(m-31) → INACTIVE_MEMBERSHIP',
          [P(u, m).go('workhub_document_list', '', False, None) for u, m in ((U29, 'm-29'), (U30, 'm-30'), (U31, 'm-31'))] == ['INACTIVE_MEMBERSHIP'] * 3)
    st = state()
    check('B10 설치만 → 학교 자료·문서함·양식 목록 NOT_READY',
          [ecode(t[21].kn_list()), ecode(t[21].d_list()), ecode(t[21].t_list()), ecode(t[21].t_targets())] == ['NOT_READY'] * 4)
    check('B11 설치만 → 원문 가져오기 준비 available=false', data(t[21].ki_ready()) == {'available': False})
    check('B12 설치만 → 쓰기·예약 NOT_READY',
          [ecode(t[21].kn({'kind': 'create', 'input': kin()})), ecode(t[21].d({'kind': 'create', 'input': din(), 'origin': None})),
           ecode(t[21].ki_prepare(fmeta('a.hwpx', b'x'))), ecode(t[21].t_prepare(fmeta('a.hwpx', b'x'), '양식'))] == ['NOT_READY'] * 4)
    check('B13 설치만 → 어떤 경로도 Storage 업로드 불가', put_object(T[21], KB, f'{s1}/m-21/x/original.hwpx', b'x') != 'OK'
          and put_object(T[21], DB, f'{s1}/m-21/x/source.hwpx', b'x') != 'OK')
    check('B14 설치만 → 조회·거절은 아무것도 쓰지 않음', state() == st)

    # ======================================================================= C. P4-04 학교 자료·문서함 켜기
    p44 = os.path.join(S, 'P4-04_자료문서함활성화_양식.sql')
    good = {'approver_user_id': U1, 'approval_ref': '2026-10-20 교무회의 학교 자료·문서함 시범 승인', 'document_school_share': 'school_admin'}
    check('C01 빈 칸이 남은 P4-04 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P4-04_자료문서함활성화_양식.sql')))
    check('C02 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(fill_json(p44, {**good, 'approver_user_id': T[21]})))
    check('C03 공유 범위 값이 목록 밖 → 멈춤', 'document_school_share 는' in sqlerr(fill_json(p44, {**good, 'document_school_share': 'everyone'})))
    check('C04 승인 근거 빈칸 → 멈춤', '승인 근거는 1~200자' in sqlerr(fill_json(p44, {**good, 'approval_ref': '  '})))
    check('C05 멈춘 P4-04 는 아무것도 쓰지 않음', state() == st)
    check('C06 P4-04 정상 실행', sqlerr(fill_json(p44, good)) == 'OK')
    check('C07 P4-04 두 번째 → 멈춤', '이미 학교 자료·문서함 활성화·정책이 있습니다' in sqlerr(fill_json(p44, good)))
    check('C08 준비 사유: 자료·문서함 ready, 원문 가져오기·양식은 policy_missing',
          scalar("select array[workhub_private.p4_reason(%s,'knowledge'),workhub_private.p4_reason(%s,'documents'),workhub_private.p4_reason(%s,'knowledge_import'),workhub_private.p4_reason(%s,'guided')]::text", (s1, s1, s1, s1))
          == '{ready,ready,policy_missing,policy_missing}')
    check('C09 다른 학교(m-27)는 여전히 NOT_READY', ecode(t[27].kn_list()) == 'NOT_READY' and ecode(t[27].d_list()) == 'NOT_READY')
    check('C10 문서함 정책 행은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.document_policies set school_share = 'all_members'") == 'IMMUTABLE_ROW')

    # ======================================================================= D. 학교 자료
    st = state()
    k1 = key(); c1 = {'kind': 'create', 'input': kin(title='  학업성적관리규정 요약  ')}
    e1 = t[21].kn(c1, k1); r1 = data(e1)
    check('D01 교사 초안 만들기 → 접수증(id·판 1·요청 번호·시각)', ok(e1) and r1['version'] == 1 and r1['requestKey'] == k1 and set(r1) == {'id', 'version', 'requestKey', 'recordedAt'}, e1)
    s_a = r1['id']
    check('D02 같은 번호·같은 내용(응답 유실 뒤 재전송) → 처음 접수증, 자료 1개', t[21].kn(c1, k1) == e1
          and scalar("select count(*) from workhub.knowledge_sources where author_membership_id='m-21'") == 1)
    check('D03 같은 번호·다른 내용 → IDEMPOTENCY_CONFLICT', ecode(t[21].kn({'kind': 'create', 'input': kin(title='다른 제목')}, k1)) == 'IDEMPOTENCY_CONFLICT')
    check('D04 같은 번호라도 다른 소속이 쓰면 별개 요청', ok(t[22].kn({'kind': 'create', 'input': kin(title='22의 초안')}, k1)))
    l21 = data(t[21].kn_list())
    check('D05 제목 앞뒤 공백은 걷어 저장 · 목록에 내 초안 · canManage=false', l21['canManage'] is False
          and [(x['id'], x['title'], x['status']) for x in l21['items'] if x['id'] == s_a] == [(s_a, '학업성적관리규정 요약', 'draft')], l21)
    check('D06 다른 교사(23)는 남의 초안을 보지 못함', s_a not in [x['id'] for x in data(t[23].kn_list())['items']])
    la = data(adm.kn_list())
    check('D07 학교 관리자(year.manage)는 모든 초안을 봄 · canManage=true', la['canManage'] is True and s_a in [x['id'] for x in la['items']], la)
    check('D08 남의 초안 수정(23) → NOT_FOUND', ecode(t[23].kn({'kind': 'update', 'id': s_a, 'expectedVersion': 1, 'input': kin()})) == 'NOT_FOUND')
    check('D09 작성자도 게시는 못 함 → FORBIDDEN', ecode(t[21].kn({'kind': 'publish', 'id': s_a, 'expectedVersion': 1, 'reason': '게시'})) == 'FORBIDDEN')
    st = state()
    bads = [{'kind': 'create', 'input': kin(frm=DAY(), thr=DAY(-1))}, {'kind': 'create', 'input': kin(kind='law')},
            {'kind': 'create', 'input': {**kin(), 'extra': 1}}, {'kind': 'create', 'input': kin(title='   ')},
            {'kind': 'create', 'input': kin(body='a\u0007b')}, {'kind': 'create', 'input': kin(frm='2026-02-30')},
            {'kind': 'publish', 'id': s_a, 'expectedVersion': 1, 'reason': '  '}, {'kind': 'delete', 'id': s_a}, {'kind': 'create', 'input': kin(), 'x': 1}]
    check('D10 입력 규칙(기간 역전·모르는 종류·모르는 칸·빈 제목·제어 문자·없는 날짜·빈 사유·모르는 동작) → INVALID_INPUT',
          [ecode(adm.kn(b)) for b in bads] == ['INVALID_INPUT'] * len(bads))
    check('D11 요청 번호 형식 오류 → INVALID_INPUT', ecode(t[21].kn(c1, 'a b')) == 'INVALID_INPUT' and ecode(t[21].kn(c1, 'short')) == 'INVALID_INPUT')
    check('D12 거절은 아무것도 쓰지 않음', state() == st)
    e2 = t[21].kn({'kind': 'update', 'id': s_a, 'expectedVersion': 1, 'input': kin(body='제3조 평가의 기준은 교과협의회가 정하고 학업성적관리위원회가 심의한다.')})
    check('D13 작성자 초안 수정 → 판 2', data(e2) and data(e2)['version'] == 2, e2)
    check('D14 지난 판으로 수정 → CONFLICT', ecode(t[21].kn({'kind': 'update', 'id': s_a, 'expectedVersion': 1, 'input': kin()})) == 'CONFLICT')
    ob = scalar('select count(*) from workhub.outbox')
    e3 = adm.kn({'kind': 'publish', 'id': s_a, 'expectedVersion': 2, 'reason': '2026-10-20 교무회의 확인'})
    check('D15 관리자 게시 → 판 3 · outbox knowledge.published 1건(본문 없음)', data(e3) and data(e3)['version'] == 3
          and scalar('select count(*) from workhub.outbox') == ob + 1
          and scalar("select payload ? 'body' from workhub.outbox where topic='knowledge.published' order by id desc limit 1") is False, e3)
    check('D16 게시된 자료는 다른 교사(23)도 봄', s_a in [x['id'] for x in data(t[23].kn_list())['items']])
    check('D17 게시된 자료 수정 → CONFLICT(초안만 고침)', ecode(t[21].kn({'kind': 'update', 'id': s_a, 'expectedVersion': 3, 'input': kin()})) == 'CONFLICT')
    check('D18 게시된 자료 다시 게시 → CONFLICT', ecode(adm.kn({'kind': 'publish', 'id': s_a, 'expectedVersion': 3, 'reason': 'x'})) == 'CONFLICT')
    check('D19 판 기록: 만들기·수정·게시 3행, 게시 사유 남음',
          scalar("select string_agg(action||':'||coalesce(reason,''), ',' order by version) from workhub.knowledge_source_revisions where source_id=%s", (s_a,))
          == 'create:,update:,publish:2026-10-20 교무회의 확인')
    q = data(t[23].kn_list('학업성적관리위원회'))
    check('D20 본문 검색(서버 전체) · %·_ 는 글자 그대로', [x['id'] for x in q['items']] == [s_a] and data(t[23].kn_list('%'))['items'] == [] and data(t[23].kn_list('_'))['items'] == [], q)
    check('D21 검색어 200자 초과·제어 문자 → INVALID_INPUT', ecode(t[23].kn_list('가' * 201)) == 'INVALID_INPUT' and ecode(t[23].kn_list('a\u0001')) == 'INVALID_INPUT')
    # 페이지: 관리자가 55건을 만든다
    for i in range(55): adm.kn({'kind': 'create', 'input': kin(title=f'업무 안내 {i:02d}', kind='school_guide', locator=f'안내 {i}')})
    p1 = data(adm.kn_list('업무 안내')); p2 = data(adm.kn_list('업무 안내', p1['nextCursor']))
    ids = [x['id'] for x in p1['items'] + p2['items']]
    check('D22 50건 + 나머지, 겹침 없음, 마지막은 다음 위치 없음', len(p1['items']) == 50 and len(p2['items']) == 5 and len(set(ids)) == 55 and p2['nextCursor'] is None)
    check('D23 위치 값을 다른 검색어·다른 사람이 쓰면 INVALID_INPUT, 위조 값도 INVALID_INPUT',
          ecode(adm.kn_list('', p1['nextCursor'])) == 'INVALID_INPUT' and ecode(t[21].kn_list('업무 안내', p1['nextCursor'])) == 'INVALID_INPUT'
          and ecode(adm.kn_list('', 'zz')) == 'INVALID_INPUT')
    e4 = adm.kn({'kind': 'retire', 'id': s_a, 'expectedVersion': 3, 'reason': '규정 개정'})
    check('D24 종료 → 판 4 retired · outbox knowledge.retired · 종료한 자료도 목록에 남음(근거 추적)', data(e4) and data(e4)['version'] == 4
          and scalar("select count(*) from workhub.outbox where topic='knowledge.retired'") == 1
          and [x['status'] for x in data(t[23].kn_list('학업성적관리위원회'))['items']] == ['retired'], e4)
    check('D25 종료한 자료 다시 종료 → CONFLICT', ecode(adm.kn({'kind': 'retire', 'id': s_a, 'expectedVersion': 4, 'reason': 'x'})) == 'CONFLICT')
    # 역할 회수: 25 에게 학교 관리자 역할을 줬다가 회수
    call(run, """insert into workhub.membership_roles(school_id, membership_id, role_code, scope_type, valid_from, granted_by_membership_id)
                 values (%s, 'm-25', 'school_admin', 'school', %s, %s)""", (s1, start_day, m1))
    s_b = data(t[21].kn({'kind': 'create', 'input': kin(title='역할 회수 시험 자료')}))['id']
    check('D26 역할을 받은 25 는 관리자(canManage·남의 초안 열람)', data(t[25].kn_list())['canManage'] is True and s_b in [x['id'] for x in data(t[25].kn_list())['items']])
    call(run, "update workhub.membership_roles set revoked_at = now(), revoke_reason = '시험 회수' where membership_id = 'm-25' and role_code = 'school_admin'")
    check('D27 역할 회수 뒤 25 → canManage=false · 남의 초안 안 보임 · 게시 NOT_FOUND', data(t[25].kn_list())['canManage'] is False
          and s_b not in [x['id'] for x in data(t[25].kn_list())['items']]
          and ecode(t[25].kn({'kind': 'publish', 'id': s_b, 'expectedVersion': 1, 'reason': 'x'})) == 'NOT_FOUND')
    call(run, "update public.users set role='teacher' where id=%s", (T[21],))
    check('D28 작성자가 업무실 자격을 잃으면 FORBIDDEN(봉투 없음), 이미 받은 접수증 재조회도 막힘', t[21].go('workhub_knowledge_mutate', c1, k1) == 'FORBIDDEN')
    call(run, "update public.users set role='superadmin' where id=%s", (T[21],))
    check('D29 자격 회복 뒤 같은 번호 → 처음 접수증', t[21].kn(c1, k1) == e1)
    # 동시 실행
    kk = key(); ck = {'kind': 'create', 'input': kin(title='동시 생성')}
    t21b = P(T[21], M[21])
    outs = concurrently([lambda: t[21].kn(ck, kk), lambda: t21b.kn(ck, kk)], lock_sql(), (s1, M[21], 'knowledge:mutate', kk))
    check('D30 같은 번호 동시 2회 → 같은 접수증, 자료 1개', ok(outs[0]) and outs[0] == outs[1]
          and scalar("select count(*) from workhub.knowledge_sources where title='동시 생성'") == 1, outs)
    outs = concurrently([lambda w=w: w.kn({'kind': 'update', 'id': s_b, 'expectedVersion': 1, 'input': kin(title=f'동시 수정 {i}')}) for i, w in enumerate((t[21], t21b))],
                        "lock table workhub.knowledge_sources in exclusive mode")
    check('D31 같은 판을 동시에 수정(다른 번호) → 하나만 판 2, 하나는 CONFLICT', sorted(str(data(o)['version']) if ok(o) else ecode(o) for o in outs) == ['2', 'CONFLICT'], outs)
    # 중간 강제 실패
    call(run, """create function public.p4_test_fail() returns trigger language plpgsql as $$
                 begin if new.title = '강제 실패' then raise exception 'P4_TEST_FAIL'; end if; return new; end $$""")
    call(run, "create trigger p4_test_fail before insert on workhub.knowledge_source_revisions for each row execute function public.p4_test_fail()")
    kf = key(); cf = {'kind': 'create', 'input': kin(title='강제 실패')}
    st = state()
    out = t[21].kn(cf, kf)
    check('D32 판 기록 중 강제 실패 → 봉투 없는 오류, 자료·판·원장·감사 원상태', out == 'P4_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p4_test_fail on workhub.knowledge_source_revisions")
    check('D33 원인 제거 뒤 같은 번호 → 정상 반영(1건)', ok(t[21].kn(cf, kf)) and scalar("select count(*) from workhub.knowledge_sources where title='강제 실패'") == 1)
    # 기간: 시행 끝난 자료도 그대로 저장·열람(유효 판단은 앱 sourceEffective)
    e_old = adm.kn({'kind': 'create', 'input': kin(title='지난 학년도 계획', kind='annual_plan', frm=DAY(-400), thr=DAY(-40))})
    s_old = data(e_old)['id']
    adm.kn({'kind': 'publish', 'id': s_old, 'expectedVersion': 1, 'reason': '보관용 게시'})
    check('D34 시행 기간이 끝난 자료도 게시·열람(유효 여부는 날짜로 표시)', [x['effectiveThrough'] for x in data(t[23].kn_list('지난 학년도'))['items']] == [DAY(-40)])

    # ======================================================================= E. 문서함
    k_pub = [x for x in data(t[23].kn_list('학업성적관리위원회'))['items']][0]
    st = state()
    cd1 = {'kind': 'create', 'input': din(sources=[ksrc(s_a, 3)]), 'origin': None}
    kd1 = key(); ed1 = t[22].d(cd1, kd1)
    check('E01 게시판(3) 근거를 단 개인 문서 만들기 → 접수증(문서 id·판 1)', ok(ed1) and data(ed1)['version'] == 1 and set(data(ed1)) == {'documentId', 'version', 'requestKey', 'recordedAt'}, ed1)
    d1 = data(ed1)['documentId']
    check('E02 같은 번호 재전송 → 같은 접수증 · 다른 내용 → IDEMPOTENCY_CONFLICT', t[22].d(cd1, kd1) == ed1
          and ecode(t[22].d({**cd1, 'input': din(title='다름')}, kd1)) == 'IDEMPOTENCY_CONFLICT')
    check('E03 접수증 재조회(request_get) → 같은 접수증 · 없는 번호 → NOT_FOUND', t[22].d_recover(cd1, kd1) == ed1 and ecode(t[22].d_recover(cd1, key())) == 'NOT_FOUND')
    h = holder(s1, M[22], 'documents:mutate', kd1)
    check('E04 같은 번호를 처리 중이면 재조회 → RESULT_UNKNOWN(아무것도 쓰지 않음)', ecode(t[22].d_recover(cd1, kd1)) == 'RESULT_UNKNOWN')
    h.close()
    check('E05 근거: 초안 판(1)·없는 자료·남의 초안 → NOT_FOUND',
          [ecode(t[22].d({'kind': 'create', 'input': din(sources=[ksrc(s_a, 1)]), 'origin': None})),
           ecode(t[22].d({'kind': 'create', 'input': din(sources=[ksrc('nope', 1)]), 'origin': None})),
           ecode(t[22].d({'kind': 'create', 'input': din(sources=[ksrc(s_b, 2)]), 'origin': None}))] == ['NOT_FOUND'] * 3)
    check('E06 근거: 수합(현재판 이하만)·업무(내 것만)', ok(t[21].d({'kind': 'create', 'input': din(sources=[ksrc(col, col_ver, 'collection', '수합 안내')]), 'origin': None}))
          and ecode(t[21].d({'kind': 'create', 'input': din(sources=[ksrc(col, col_ver + 1, 'collection', '수합 안내')]), 'origin': None})) == 'NOT_FOUND')
    st = state()
    check('E07 학교 공유는 문서함 정책(school_admin)대로: 교사 → FORBIDDEN', ecode(t[22].d({'kind': 'create', 'input': din(vis='school'), 'origin': None})) == 'FORBIDDEN')
    ev = {'kind': 'observation', 'id': 'obs-1', 'revisionId': 'rev-1', 'sourceHash': 'a' * 64, 'epoch': 0, 'start': 0, 'end': 10}
    stu = {'studentId': 'stu-1', 'courseId': 'course-1', 'evidence': [ev]}
    bad_ev = [[{'kind': 'observation', 'id': 'obs-1'}], [{**ev, 'start': 10}], [{**ev, 'kind': 'knowledge'}], [ev, ev], [{**ev, 'sourceHash': 'A' * 64}]]
    check('E08 학생 기록 초안: 맥락 없음·학교 공유·근거 모양 오류(앱 assistantReference 와 같은 규칙) → INVALID_INPUT, 정상 모양 → NOT_READY(5단계 전)',
          [ecode(t[22].d({'kind': 'create', 'input': din(kind='student_record'), 'origin': None})),
           ecode(t[22].d({'kind': 'create', 'input': din(kind='student_record', vis='school', student=stu), 'origin': None})),
           *[ecode(t[22].d({'kind': 'create', 'input': din(kind='student_record', student={**stu, 'evidence': b}), 'origin': None})) for b in bad_ev],
           ecode(t[22].d({'kind': 'create', 'input': din(kind='student_record', student=stu), 'origin': None}))] == ['INVALID_INPUT'] * 7 + ['NOT_READY'])
    check('E09 입력 규칙(모르는 종류·근거 중복·근거 모르는 칸·없는 기준일·빈 본문) → INVALID_INPUT',
          [ecode(t[22].d({'kind': 'create', 'input': x, 'origin': None})) for x in (din(kind='memo'), din(sources=[ksrc(s_a, 3), ksrc(s_a, 3)]),
            din(sources=[{**ksrc(s_a, 3), 'x': 1}]), din(basis='2026-13-01'), din(body=''))] == ['INVALID_INPUT'] * 5)
    check('E10 거절은 아무것도 쓰지 않음', state() == st)
    ea = adm.d({'kind': 'create', 'input': din(title='2학기 행사 계획(공유)', kind='event_plan', vis='school', body='행사 계획 본문'), 'origin': None})
    da = data(ea)['documentId']
    check('E11 관리자 학교 공유 문서 → 다른 교사(22·23) 목록·열람 가능, canEdit=false', ok(ea)
          and da in [x['id'] for x in data(t[22].d_list())['items']] and data(t[23].d_get(da))['canEdit'] is False and data(adm.d_get(da))['canEdit'] is True, ea)
    check('E12 남의 학교 공유 문서 수정·확정 → FORBIDDEN(읽기만)', ecode(t[22].d({'kind': 'update', 'documentId': da, 'expectedVersion': 1, 'input': din(vis='school')})) == 'FORBIDDEN'
          and ecode(t[22].d({'kind': 'confirm', 'documentId': da, 'expectedVersion': 1})) == 'FORBIDDEN')
    check('E13 같은 이름(김하늘) 23 은 22 의 개인 문서를 볼 수 없음(소속 id 로 구분) · 관리자도 못 봄',
          ecode(t[23].d_get(d1)) == 'NOT_FOUND' and ecode(adm.d_get(d1)) == 'NOT_FOUND' and d1 not in [x['id'] for x in data(t[23].d_list())['items']])
    ec = t[23].d({'kind': 'create', 'input': din(title='사본', kind='event_plan', body='행사 계획 본문 사본'), 'origin': {'documentId': da, 'version': 1}})
    check('E14 공유 문서 사본 만들기(origin) → 내 문서, origin 기록', ok(ec) and data(t[23].d_get(data(ec)['documentId']))['origin'] == {'documentId': da, 'version': 1}, ec)
    check('E15 볼 수 없는 문서를 원본으로 사본 → NOT_FOUND', ecode(t[23].d({'kind': 'create', 'input': din(), 'origin': {'documentId': d1, 'version': 1}})) == 'NOT_FOUND')
    eu = t[22].d({'kind': 'update', 'documentId': d1, 'expectedVersion': 1, 'input': din(title='가정통신문 수정', sources=[ksrc(s_a, 3)])})
    check('E16 수정 → 판 2 draft', data(eu) and data(eu)['version'] == 2 and data(t[22].d_get(d1))['status'] == 'draft', eu)
    check('E17 지난 판으로 수정 → CONFLICT', ecode(t[22].d({'kind': 'update', 'documentId': d1, 'expectedVersion': 1, 'input': din()})) == 'CONFLICT')
    check('E18 확정 → 판 3 confirmed · 다시 확정 → CONFLICT', data(t[22].d({'kind': 'confirm', 'documentId': d1, 'expectedVersion': 2}))['version'] == 3
          and ecode(t[22].d({'kind': 'confirm', 'documentId': d1, 'expectedVersion': 3})) == 'CONFLICT')
    check('E19 확정 뒤 수정 → 판 4 다시 draft', data(t[22].d({'kind': 'update', 'documentId': d1, 'expectedVersion': 3, 'input': din(title='가정통신문 재수정')}))['version'] == 4
          and data(t[22].d_get(d1))['status'] == 'draft')
    check('E20 학생 기록 ↔ 일반 문서 종류 바꾸기 → INVALID_INPUT', ecode(t[22].d({'kind': 'update', 'documentId': d1, 'expectedVersion': 4, 'input': din(kind='student_record', student=stu)})) == 'INVALID_INPUT')
    check('E21 보관 → 판 5 archived · 보관함 목록에만', data(t[22].d({'kind': 'archive', 'documentId': d1, 'expectedVersion': 4}))['version'] == 5
          and d1 in [x['id'] for x in data(t[22].d_list('', True))['items']] and d1 not in [x['id'] for x in data(t[22].d_list())['items']])
    check('E22 보관한 문서 수정·다시 보관 → CONFLICT', ecode(t[22].d({'kind': 'update', 'documentId': d1, 'expectedVersion': 5, 'input': din()})) == 'CONFLICT'
          and ecode(t[22].d({'kind': 'archive', 'documentId': d1, 'expectedVersion': 5})) == 'CONFLICT')
    hi = data(t[22].d_hist(d1))
    check('E23 판 이력 5개 최신순, 상태 기록', [(x['version'], x['status']) for x in hi['versions']] == [(5, 'archived'), (4, 'draft'), (3, 'confirmed'), (2, 'draft'), (1, 'draft')], hi)
    g2 = data(t[22].d_get(d1, 2))
    check('E24 지난 판 열람(version=2) → 그 판 내용, canEdit=false', g2['version'] == 2 and g2['title'] == '가정통신문 수정' and g2['canEdit'] is False and g2['latestVersion'] == 5, g2)
    adm.d({'kind': 'update', 'documentId': da, 'expectedVersion': 1, 'input': din(title='2학기 행사 계획(비공개 전환)', kind='event_plan', body='행사 계획 본문')})
    check('E25 공유 문서를 개인으로 돌리면 다른 교사는 지난 공유 판도 못 봄(목록·판·이력 NOT_FOUND)', ecode(t[23].d_get(da)) == 'NOT_FOUND'
          and ecode(t[23].d_get(da, 1)) == 'NOT_FOUND' and ecode(t[23].d_hist(da)) == 'NOT_FOUND' and da not in [x['id'] for x in data(t[23].d_list())['items']])
    check('E26 사본 원본이 비공개가 되어도 내 사본은 그대로', ok(t[23].d_get(data(ec)['documentId'])))
    check('E27 canShare: 관리자 true · 교사 false(정책 school_admin)', data(adm.d_list())['canShare'] is True and data(t[22].d_list())['canShare'] is False)
    # 동시 수정·강제 실패
    dd = data(t[24].d({'kind': 'create', 'input': din(title='동시 수정 대상'), 'origin': None}))['documentId']
    t24b = P(T[24], M[24])
    outs = concurrently([lambda w=w, i=i: w.d({'kind': 'update', 'documentId': dd, 'expectedVersion': 1, 'input': din(title=f'동시 {i}')}) for i, w in enumerate((t[24], t24b))],
                        "lock table workhub.documents in exclusive mode")
    check('E28 같은 판 동시 수정 → 하나만 판 2, 하나 CONFLICT', sorted(str(data(o)['version']) if ok(o) else ecode(o) for o in outs) == ['2', 'CONFLICT'], outs)
    call(run, "create trigger p4_test_fail before insert on workhub.document_versions for each row execute function public.p4_test_fail()")
    st = state(); kfd = key()
    out = t[24].d({'kind': 'create', 'input': din(title='강제 실패'), 'origin': None}, kfd)
    check('E29 문서 판 기록 중 강제 실패 → 원상태', out == 'P4_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p4_test_fail on workhub.document_versions")
    check('E30 원인 제거 뒤 같은 번호 → 정상 반영', ok(t[24].d({'kind': 'create', 'input': din(title='강제 실패'), 'origin': None}, kfd)))
    # 중지·재개
    stop('documents')
    check('E31 문서함 중지 → 목록·쓰기 NOT_READY, 접수증 재조회는 됨', ecode(t[22].d_list()) == 'NOT_READY'
          and ecode(t[22].d({'kind': 'create', 'input': din(), 'origin': None})) == 'NOT_READY' and t[22].d_recover(cd1, kd1) == ed1)
    resume('documents')
    check('E32 재개 → 다시 열람', ok(t[22].d_list()))

    # ======================================================================= F. P4-05 원문 가져오기
    p45 = os.path.join(S, 'P4-05_원문가져오기_양식활성화_양식.sql')
    kgood = {'module': 'knowledge_import', 'approver_user_id': U1, 'approval_ref': '2026-10-22 원문 가져오기 시범 승인', 'max_file_bytes': 200000,
             'verification_ref': 'vercel dpl_test · 2026-10-22 extract-knowledge 401 확인'}
    check('F01 빈 칸이 남은 P4-05 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P4-05_원문가져오기_양식활성화_양식.sql')))
    check('F02 모듈 이름 오류 → 멈춤', 'module 은 knowledge_import 또는 guided' in sqlerr(fill_json(p45, {**kgood, 'module': 'documents'})))
    check('F03 크기 30MiB 초과·문자열 → 멈춤', '파일 크기는' in sqlerr(fill_json(p45, {**kgood, 'max_file_bytes': 31457281}))
          and '파일 크기는' in sqlerr(fill_json(p45, {**kgood, 'max_file_bytes': '200000'})))
    check('F04 배포 확인 기록 빈칸 → 멈춤', '배포 확인 기록은 1~200자' in sqlerr(fill_json(p45, {**kgood, 'verification_ref': ''})))
    stop('knowledge')
    check('F05 학교 자료가 중지 중이면 원문 가져오기 P4-05 멈춤', '학교 자료가 켜져 있지 않습니다' in sqlerr(fill_json(p45, kgood)))
    resume('knowledge')
    check('F06 P4-05(knowledge_import) 정상 실행 · 두 번째 멈춤', sqlerr(fill_json(p45, kgood)) == 'OK' and '이미 knowledge_import 활성화·정책이 있습니다' in sqlerr(fill_json(p45, kgood)))
    check('F07 원문 가져오기 준비 available=true · 감사에 악성코드 검사 주장 없음', data(t[21].ki_ready()) == {'available': True}
          and scalar("select bool_and((details->>'malware_scan')::boolean is false) from workhub.audit_events where operation='module.activate' and details->>'module'='knowledge_import'") is True)
    raw_a = doc_hwpx('대동여중')
    st = state()
    check('F08 이름 규칙: 확장자·경로 문자·앞뒤 공백·방향 제어·예약 이름·.hwpx 만 → INVALID_INPUT',
          [ecode(t[21].ki_prepare(fmeta(n, raw_a))) for n in ('a.hwp', 'a/b.hwpx', ' a.hwpx', 'a‮.hwpx', 'con.hwpx', '.hwpx', '가' * 236 + '.hwpx')] == ['INVALID_INPUT'] * 7)
    check('F09 신고 크기가 학교 정책(200000) 초과 → INVALID_INPUT', ecode(t[21].ki_prepare({'name': 'a.hwpx', 'bytes': 200001, 'sha256': sha(b'x')})) == 'INVALID_INPUT')
    check('F10 거절된 예약은 아무것도 쓰지 않음', state() == st)
    kp = key(); m_a = fmeta('학업성적관리규정.hwpx', raw_a)
    ia = t[21].ki_prepare(m_a, kp, raw=raw_a); ia_d = data(ia)
    check('F11 예약 → {fileId, 판 1, 전용 버킷, 학교/소속/파일/original.hwpx, 신고값, uploaded=false}', ok(ia) and ia_d['bucket'] == KB and ia_d['fileVersion'] == 1
          and ia_d['path'] == f"{s1}/m-21/{ia_d['fileId']}/original.hwpx" and ia_d['uploaded'] is False and ia_d['sha256'] == sha(raw_a), ia)
    fa = ia_d['fileId']
    check('F12 같은 번호·같은 신고값 → 같은 예약 · 다른 신고값 → IDEMPOTENCY_CONFLICT', t[21].ki_prepare(m_a, kp, raw=raw_a) == ia
          and ecode(t[21].ki_prepare(fmeta('학업성적관리규정.hwpx', b'PK..'), kp)) == 'IDEMPOTENCY_CONFLICT')
    check('F13 예약 재조회(prepare_get) → 같은 예약 · 없는 번호 → NOT_FOUND', t[21].ki_prepare(m_a, kp, replay=True, raw=raw_a) == ia
          and ecode(t[21].ki_prepare(m_a, key(), replay=True, raw=raw_a)) == 'NOT_FOUND')
    check('F14 남이 그 경로에 업로드 → 거부 · 서명 URL 업로드 → 거부 · 예약 안 한 경로 → 거부',
          put_object(T[22], KB, ia_d['path'], raw_a) != 'OK' and put_object(T[21], KB, ia_d['path'], raw_a, op='storage.object.sign_upload_url') != 'OK'
          and put_object(T[21], KB, f'{s1}/m-21/other/original.hwpx', raw_a) != 'OK')
    check('F15 문서 버킷 경로로는 원문 파일을 올릴 수 없음(다른 원장)', put_object(T[21], DB, ia_d['path'], raw_a) != 'OK')
    check('F16 본인 업로드 → 통과 · 같은 경로 덮어쓰기 → 거부', put_object(T[21], KB, ia_d['path'], raw_a) == 'OK'
          and put_object(T[21], KB, ia_d['path'], doc_hwpx('바꿔치기')) != 'OK' and STORE[(KB, ia_d['path'])] == raw_a)
    check('F17 업로드 뒤 예약 재조회 → uploaded=true', data(t[21].ki_prepare(m_a, kp, replay=True, raw=raw_a))['uploaded'] is True)
    # 서버 API(service_role) — claim · finish 직접
    kx = key()
    check('F18 추출 결과 재조회: 아직 추출 요청이 없으면 NOT_FOUND', ecode(t[21].ki_get(fa, kx)) == 'NOT_FOUND')
    cl = t[21].svc('workhub_knowledge_file_extract_claim', fa, kx); cd = data(cl)
    check('F19 claim → 임대(token 64자 · 120초 · 전용 경로 · 신고 크기·SHA · 고정한 실물 id)', ok(cl) and cd['state'] == 'leased' and len(cd['leaseToken']) == 64
          and cd['path'] == ia_d['path'] and cd['bytes'] == len(raw_a) and cd['sha256'] == sha(raw_a) and cd['fileVersion'] == 1 and cd['name'] == '학업성적관리규정.hwpx', cl)
    check('F20 임대 중 다시 claim → {state:pending} 만 · 재조회는 RESULT_UNKNOWN(미확정)', data(t[21].svc('workhub_knowledge_file_extract_claim', fa, kx)) == {'state': 'pending'}
          and ecode(t[21].ki_get(fa, kx)) == 'RESULT_UNKNOWN')
    check('F21 claim: 남의 파일(22) → NOT_FOUND · 다른 사람 UID → INACTIVE_MEMBERSHIP', ecode(t[22].svc('workhub_knowledge_file_extract_claim', fa, key())) == 'NOT_FOUND'
          and t[21].svc('workhub_knowledge_file_extract_claim', fa, key(), actor=T[22]) == 'INACTIVE_MEMBERSHIP')
    check('F22 claim: 사람 JWT 를 실은 service 호출 → FORBIDDEN', err(api(T[21], 'service_role'),
          "select public.workhub_knowledge_file_extract_claim(%s::uuid,'m-21',%s,%s)", (T[21], fa, kx)) == 'FORBIDDEN')
    good_ex = None
    if KI is not None:
        good_ex = {'fileId': fa, 'fileVersion': 1, 'name': '학업성적관리규정.hwpx', 'extraction': KI.extract_text(raw_a)}
    if good_ex:
        e = good_ex['extraction']
        bads = [{**good_ex, 'extra': 1}, {**good_ex, 'fileVersion': 2}, {**good_ex, 'name': 'x.hwpx'}, {**good_ex, 'extraction': {**e, 'profile': 'x'}},
                {**good_ex, 'extraction': {**e, 'fileSha256': '0' * 64}}, {**good_ex, 'extraction': {**e, 'extractionSha256': '0' * 64}},
                {**good_ex, 'extraction': {**e, 'blocks': []}}, {**good_ex, 'extraction': {**e, 'malwareScan': 'clean'}},
                {**good_ex, 'extraction': {**e, 'blocks': [{**e['blocks'][0], 'id': 'x'}]}}]
        check('F23 finish 결과 모양·SHA·파일 정체성이 맞지 않으면 INVALID_INPUT(악성코드 항목 같은 다른 칸도 거부)',
              [ecode(t[21].svc('workhub_knowledge_file_extract_finish', fa, kx, cd['leaseToken'], cd['storageObjectId'], b)) for b in bads] == ['INVALID_INPUT'] * len(bads))
        check('F24 finish: 다른 token · 다른 실물 id → CONFLICT',
              ecode(t[21].svc('workhub_knowledge_file_extract_finish', fa, kx, 'f' * 64, cd['storageObjectId'], good_ex)) == 'CONFLICT'
              and ecode(t[21].svc('workhub_knowledge_file_extract_finish', fa, kx, cd['leaseToken'], str(uuid.uuid4()), good_ex)) == 'CONFLICT')
        check('F25 Python 추출 SHA(json.dumps sort_keys) = DB 표준형 SHA (한글·탭·줄바꿈 포함)',
              scalar("select encode(sha256(convert_to(workhub_private.p2_canonical(%s::jsonb), 'UTF8')), 'hex')", (json.dumps(e['blocks']),)) == e['extractionSha256'])
    else:
        check('F23 finish 결과 검증 — P4_APP_SRC 없음(실제 추출기 필요)', False); check('F24 finish 임대 대조 — P4_APP_SRC 없음', False); check('F25 SHA 대조 — P4_APP_SRC 없음', False)
    # 임대를 끝내고 실제 서버 API 로 왕복
    sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.knowledge_file_leases set expires_at = clock_timestamp() - interval '1 second' where file_id='{fa}' and state='issued'")
    out, calls = extract(t[21], fa, kx)
    check('F26 [서버 API] PR #48 _knowledge_import.run: claim → 내려받기 → 본문 추출 → finish → 결과 봉투', isinstance(out, dict) and out['data']['fileId'] == fa
          and [n for n, _ in calls] == ['workhub_knowledge_file_extract_claim', 'workhub_knowledge_file_extract_finish']
          and len(out['data']['extraction']['blocks']) == 4 and out['data']['extraction']['omittedObjects'] == 1, (out, calls))
    ex_a = out['data'] if isinstance(out, dict) else None
    check('F27 추출문: 표 칸 위치·문단 위치 기록, 그림은 누락 수로만', ex_a is not None and any('표 1행 2열' in b['locator'] for b in ex_a['extraction']['blocks']), ex_a)
    out2, calls2 = extract(t[21], fa, kx)
    check('F28 [서버 API] 같은 번호로 다시 → 확정된 결과 그대로(내려받지 않음)', isinstance(out2, dict) and out2['data'] == ex_a and [n for n, _ in calls2] == ['workhub_knowledge_file_extract_claim'])
    out3, calls3 = extract(t[21], fa, key())
    check('F29 [서버 API] 다른 번호로 같은 파일 → 이미 확정된 추출문(다시 파싱하지 않음)', isinstance(out3, dict) and out3['data'] == ex_a and len(calls3) == 1)
    check('F30 추출 결과 재조회(extract_get) → 같은 결과', data(t[21].ki_get(fa, kx)) == ex_a)
    if good_ex:
        check('F31 finish 재전송: 같은 결과 → 같은 결과 · 다른 결과 → CONFLICT',
              data(t[21].svc('workhub_knowledge_file_extract_finish', fa, kx, 'f' * 64, cd['storageObjectId'], ex_a)) == ex_a
              and ecode(t[21].svc('workhub_knowledge_file_extract_finish', fa, kx, 'f' * 64, cd['storageObjectId'],
                                  {**ex_a, 'extraction': KI.extract_text(doc_hwpx('다른 결과')) | {'fileSha256': sha(raw_a)}})) in ('CONFLICT', 'INVALID_INPUT'))
    else:
        check('F31 finish 재전송 — P4_APP_SRC 없음', False)
    check('F32 추출문은 DB 에서 고칠 수 없음', sqlerr("update workhub.knowledge_extractions set block_count = 1") == 'IMMUTABLE_ROW')
    # 초안 만들기
    imp = {'fileId': fa, 'fileVersion': 1, 'extractionSha256': (ex_a or {}).get('extraction', {}).get('extractionSha256', '0' * 64),
           'input': kin(title='학업성적관리규정', body='\n\n'.join(b['text'] for b in (ex_a or {}).get('extraction', {}).get('blocks', [{'text': 'x'}])),
                        locator='학업성적관리규정.hwpx / HWPX 원문 문단 4개', kind='school_guide', frm=DAY())}
    st = state()
    check('F33 초안 만들기: 다른 추출 SHA · 판 2 → CONFLICT, 남의 파일(22) → NOT_FOUND',
          [ecode(t[21].ki_commit({**imp, 'extractionSha256': '1' * 64})), ecode(t[21].ki_commit({**imp, 'fileVersion': 2})), ecode(t[22].ki_commit(imp))]
          == ['CONFLICT', 'CONFLICT', 'NOT_FOUND'] and state() == st)
    kc = key()
    t21c = P(T[21], M[21])
    outs = concurrently([lambda: t[21].ki_commit(imp, kc), lambda: t21c.ki_commit(imp)], "lock table workhub.knowledge_sources in exclusive mode")
    check('F34 같은 원본으로 동시에 초안 2번(다른 번호) → 하나만 성공, 하나 CONFLICT', sorted('ok' if ok(o) else ecode(o) for o in outs) == ['CONFLICT', 'ok'], outs)
    ok_commit = outs[0] if ok(outs[0]) else t[21].ki_commit(imp, kc)
    s_imp = data(ok_commit)['id'] if ok(ok_commit) else None
    if not ok(outs[0]):   # 성공한 쪽이 두 번째였다면 첫 번째 번호는 원장이 없다 → 원본 하나에 자료 하나 규칙으로 CONFLICT
        s_imp = data(outs[1])['id']; kc = None
    check('F35 초안 접수증 재조회(import_request_get)·같은 번호 다른 내용', s_imp is not None and (kc is None or (
          t[21].ki_commit(imp, kc, replay=True) == outs[0] and ecode(t[21].ki_commit({**imp, 'input': kin(title='다름')}, kc)) == 'IDEMPOTENCY_CONFLICT')), outs)
    check('F36 판 기록에 원본 파일·추출 SHA 연결', scalar("select file_id||':'||extraction_sha256 from workhub.knowledge_source_revisions where source_id=%s and version=1", (s_imp,))
          == f"{fa}:{imp['extractionSha256']}")
    oa = t[21].ki_original(s_imp, 1, raw=raw_a)
    check('F37 원본 위치(original_access): 작성자 → available·경로·크기·SHA·추출 SHA', data(oa) and data(oa)['available'] is True and data(oa)['path'] == ia_d['path']
          and data(oa)['sha256'] == sha(raw_a) and data(oa)['extractionSha256'] == imp['extractionSha256'], oa)
    check('F38 원본 없는 자료판 → {available:false} · 볼 수 없는 초안(23) → NOT_FOUND', data(t[23].ki_original(s_a, 3)) == {'available': False}
          and ecode(t[23].ki_original(s_imp, 1)) == 'NOT_FOUND')
    check('F39 Storage 직접 읽기: 올린 사람 가능 · 초안 단계 다른 교사 불가 · 서명 URL·목록 요청 불가', can_read(T[21], KB, ia_d['path'])
          and not can_read(T[23], KB, ia_d['path']) and not can_read(T[21], KB, ia_d['path'], op='storage.object.sign') and not can_read(T[21], KB, ia_d['path'], op=None))
    adm.kn({'kind': 'update', 'id': s_imp, 'expectedVersion': 1, 'input': {**imp['input'], 'title': '학업성적관리규정(원문)'}})
    adm.kn({'kind': 'publish', 'id': s_imp, 'expectedVersion': 2, 'reason': '원문 확인 후 게시'})
    check('F40 관리자가 고쳐 게시해도 판 기록이 원본 연결을 이어 감', scalar("select count(*) from workhub.knowledge_source_revisions where source_id=%s and file_id=%s", (s_imp, fa)) == 3)
    o23 = t[23].ki_original(s_imp, 3, raw=raw_a)
    check('F41 게시 뒤 다른 교사(23)도 원본 위치·Storage 읽기 가능', data(o23) and data(o23)['available'] is True and can_read(T[23], KB, ia_d['path']), o23)
    call(run, "update public.users set role='teacher' where id=%s", (T[23],))
    check('F42 업무실 자격을 잃으면 원본 Storage 읽기도 막힘', not can_read(T[23], KB, ia_d['path']))
    call(run, "update public.users set role='superadmin' where id=%s", (T[23],))
    check('F43 다른 학교(27)는 원본 읽기 불가', not can_read(T[27], KB, ia_d['path']))
    # 응답 유실·짧은 내려받기·실물 바꿔치기·크기 다름·기한 지남
    raw_b = doc_hwpx('주간 안내'); ib = data(t[21].ki_prepare(fmeta('주간 안내.hwpx', raw_b), raw=raw_b)); put_object(T[21], KB, ib['path'], raw_b)
    kb_ = key()
    out_b, calls_b = extract(t[21], ib['fileId'], kb_, truncate=len(raw_b) - 10)
    check('F44 [서버 API] 내려받기가 짧게 끊김 → CONFLICT, finish 없음, 추출문 없음(영구 실패 아님)', out_b == ('ERR', 'CONFLICT')
          and [n for n, _ in calls_b] == ['workhub_knowledge_file_extract_claim'] and scalar('select count(*) from workhub.knowledge_extractions where file_id=%s', (ib['fileId'],)) == 0, (out_b, calls_b))
    out_b2, _ = extract(t[21], ib['fileId'], kb_)
    check('F45 [서버 API] 임대가 남아 있으면 두 번째 실행은 RESULT_UNKNOWN(내려받지 않음)', out_b2 == ('ERR', 'RESULT_UNKNOWN'), out_b2)
    sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.knowledge_file_leases set expires_at = clock_timestamp() - interval '1 second' where file_id='{ib['fileId']}' and state='issued'")
    out_b3, _ = extract(t[21], ib['fileId'], kb_, lose_finish=True)
    check('F46 [서버 API] finish 응답이 오는 길에 끊김 → RESULT_UNKNOWN 이지만 DB 는 확정', out_b3 == ('ERR', 'RESULT_UNKNOWN')
          and scalar('select count(*) from workhub.knowledge_extractions where file_id=%s', (ib['fileId'],)) == 1)
    out_b4, calls_b4 = extract(t[21], ib['fileId'], kb_)
    check('F47 [서버 API] 같은 번호로 다시 → 확정된 결과(다시 내려받지 않음) · 재조회도 같은 결과', isinstance(out_b4, dict) and len(calls_b4) == 1
          and data(t[21].ki_get(ib['fileId'], kb_)) == out_b4['data'], out_b4)
    raw_c = doc_hwpx('바꿔치기 전'); ic = data(t[21].ki_prepare(fmeta('바꿔치기.hwpx', raw_c), raw=raw_c)); put_object(T[21], KB, ic['path'], raw_c)
    kcx = key(); first = t[21].svc('workhub_knowledge_file_extract_claim', ic['fileId'], kcx)
    replace_object(KB, ic['path'], T[21], raw_c)
    sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.knowledge_file_leases set expires_at = clock_timestamp() - interval '1 second' where file_id='{ic['fileId']}' and state='issued'")
    oc, _ = extract(t[21], ic['fileId'], kcx)
    check('F48 처음 고정한 뒤 실물이 바뀜(object id 다름) → claim CONFLICT, 내려받지 않음', ok(first) and oc == ('ERR', 'CONFLICT'), (first, oc))
    raw_d = doc_hwpx('크기 다름'); i_d = data(t[21].ki_prepare(fmeta('크기.hwpx', raw_d), raw=raw_d)); put_object(T[21], KB, i_d['path'], raw_d, size=len(raw_d) + 5)
    check('F49 Storage 가 기록한 크기 ≠ 신고값 → claim CONFLICT', ecode(t[21].svc('workhub_knowledge_file_extract_claim', i_d['fileId'], key())) == 'CONFLICT')
    raw_e = doc_hwpx('만료'); ke = key(); i_e = data(t[21].ki_prepare(fmeta('만료.hwpx', raw_e), ke, raw=raw_e))
    sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.knowledge_files set upload_expires_at = clock_timestamp() - interval '1 second' where id='{i_e['fileId']}'")
    check('F50 기한 지난 예약 경로로 업로드 → 거부 · 그 예약 재조회 → CONFLICT', put_object(T[21], KB, i_e['path'], raw_e) != 'OK'
          and ecode(t[21].ki_prepare(fmeta('만료.hwpx', raw_e), ke, replay=True)) == 'CONFLICT')
    # 반복 호출 상한
    raw_f = doc_hwpx('상한'); i_f = data(t[21].ki_prepare(fmeta('상한.hwpx', raw_f), raw=raw_f)); put_object(T[21], KB, i_f['path'], raw_f)
    leases = []
    for i in range(7):
        leases.append(data(t[21].svc('workhub_knowledge_file_extract_claim', i_f['fileId'], key())))
        sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.knowledge_file_leases set expires_at = clock_timestamp() - interval '1 second' where file_id='{i_f['fileId']}' and state='issued'")
    check('F51 같은 파일 10분 6번 임대 뒤 7번째 → pending(내려받기 증폭 방지)', [x['state'] for x in leases] == ['leased'] * 6 + ['pending'], leases)
    # 중지 중
    stop('knowledge_import')
    check('F52 원문 가져오기 중지 → 준비 false · 예약 NOT_READY · Storage 읽기 불가 · 재조회(prepare_get·extract_get)는 됨',
          data(t[21].ki_ready()) == {'available': False} and ecode(t[21].ki_prepare(fmeta('x.hwpx', raw_a))) == 'NOT_READY'
          and not can_read(T[21], KB, ia_d['path']) and ok(t[21].ki_prepare(m_a, kp, replay=True)) and data(t[21].ki_get(fa, kx)) == ex_a)
    check('F53 중지 중 원본 위치 → NOT_READY · 원본 없는 자료판은 그대로 available:false', ecode(t[21].ki_original(s_imp, 3)) == 'NOT_READY'
          and data(t[21].ki_original(s_a, 3)) == {'available': False})
    resume('knowledge_import')
    check('F54 재개 → 다시 준비 · Storage 읽기 가능', data(t[21].ki_ready()) == {'available': True} and can_read(T[21], KB, ia_d['path']))
    call(run, "create policy p4_test_open on storage.objects for select to authenticated using (true)")
    check('F55 원문 버킷을 여는 다른 정책이 생기면 준비 storage_missing(available=false)', data(t[21].ki_ready()) == {'available': False}
          and scalar("select workhub_private.p4_reason(%s,'knowledge_import')", (s1,)) == 'storage_missing')
    call(run, "drop policy p4_test_open on storage.objects")
    check('F56 정책을 되돌리면 다시 준비', data(t[21].ki_ready()) == {'available': True})

    # ======================================================================= G. 질문형 양식
    ggood = {**kgood, 'module': 'guided', 'approval_ref': '2026-10-23 질문형 양식 시범 승인', 'verification_ref': 'vercel dpl_test · 2026-10-23 guided 401 확인'}
    check('G01 양식 켜기 전 → 목록 NOT_READY', ecode(adm.t_list()) == 'NOT_READY')
    check('G02 P4-05(guided) 정상 실행', sqlerr(fill_json(p45, ggood)) == 'OK')
    check('G03 목록: 빈 목록 · canCreate=true', data(adm.t_list()) == {'items': [], 'nextCursor': None, 'canCreate': True})
    tg = data(adm.t_targets())
    check('G04 이을 수 있는 수합 = 내가 담당하는 게시 수합 중 HWPX 파일 칸이 있는 것(PDF 만 받는 수합 제외)', [x['requestId'] for x in tg['items']] == [col]
          and tg['items'][0]['version'] == col_ver, tg)
    check('G05 수합 담당이 아닌 교사(21)의 대상 목록은 빈 목록', data(t[21].t_targets()) == {'items': []})
    raw_t = tpl_hwpx('2026'); kt = key(); mt = fmeta('연수 결과 보고.hwpx', raw_t)
    it = adm.t_prepare(mt, '연수 결과 보고', kt, raw=raw_t); it_d = data(it)
    check('G06 양식 원본 예약 → {templateId, 판 1, 문서 버킷, …/source.hwpx, uploaded=false}', ok(it) and it_d['templateVersion'] == 1 and it_d['bucket'] == DB
          and it_d['path'] == f"{s1}/{m1}/{it_d['templateId']}/source.hwpx" and it_d['uploaded'] is False, it)
    tid = it_d['templateId']
    check('G07 같은 번호·같은 파일·같은 제목 → 같은 예약 · 제목만 달라도 IDEMPOTENCY_CONFLICT · 재조회 같은 예약',
          adm.t_prepare(mt, '연수 결과 보고', kt, raw=raw_t) == it and ecode(adm.t_prepare(mt, '다른 제목', kt)) == 'IDEMPOTENCY_CONFLICT'
          and adm.t_prepare(mt, '연수 결과 보고', kt, replay=True, raw=raw_t) == it)
    check('G08 생성 파일 경로(output.hwpx)·남의 경로로는 업로드 불가', put_object(U1, DB, f"{s1}/{m1}/{tid}/output.hwpx", raw_t) != 'OK'
          and put_object(T[21], DB, it_d['path'], raw_t) != 'OK')
    check('G09 원본 업로드 → 통과 · 다시 올리기 거부', put_object(U1, DB, it_d['path'], raw_t) == 'OK' and put_object(U1, DB, it_d['path'], raw_t) != 'OK')
    check('G10 양식 원본은 브라우저 직접 읽기 불가(서버 API 만 읽음)', not can_read(U1, DB, it_d['path']))
    lt = data(adm.t_list())
    check('G11 초안 양식: 담당자 목록에 있음(분석 전) · 다른 교사(21)는 못 봄', [x['id'] for x in lt['items']] == [tid] and lt['items'][0]['inspection'] is None
          and data(t[21].t_list())['items'] == [] and ecode(t[21].t_get(tid)) == 'NOT_FOUND', lt)
    # 분석(inspect) — 실제 서버 API
    ins, calls_i, ki_ = guided(adm, 'inspect', tid, 1)
    check('G12 [서버 API] PR #48 _guided_service.run inspect: claim → 원본 내려받기 → 분석 → finish', isinstance(ins, dict)
          and [n for n, _ in calls_i] == ['workhub_template_inspect_claim', 'workhub_template_inspect_finish'] and len(ins['data']['inspection']['anchors']) == 5
          and ins['data']['inspection']['unsupportedParagraphs'] >= 1, (ins, calls_i))
    insp = ins['data']['inspection'] if isinstance(ins, dict) else None
    check('G13 분석 결과가 양식에 고정됨(templateSha256 = 원본 SHA)', insp is not None and data(adm.t_get(tid))['template']['inspection'] == insp and insp['templateSha256'] == sha(raw_t))
    ins2, calls_i2, _ = guided(adm, 'inspect', tid, 1)
    check('G14 [서버 API] 다른 번호로 다시 분석 → 확정된 분석 그대로(다시 내려받지 않음)', isinstance(ins2, dict) and ins2['data']['inspection'] == insp and len(calls_i2) == 1)
    opi = {'action': 'inspect', 'templateId': tid, 'templateVersion': 1, 'responseId': None, 'responseVersion': None, 'requestKey': ki_}
    check('G15 작업 결과 재조회(operation_get) → 같은 분석 · 없는 번호 NOT_FOUND · 같은 번호 다른 대상 IDEMPOTENCY_CONFLICT',
          data(adm.op_get(opi)) == ins['data'] and ecode(adm.op_get({**opi, 'requestKey': key()})) == 'NOT_FOUND'
          and ecode(adm.op_get({**opi, 'templateVersion': 2})) == 'IDEMPOTENCY_CONFLICT')
    check('G16 분석은 담당자만: 다른 교사 claim → NOT_FOUND', ecode(t[21].svc('workhub_template_inspect_claim', tid, 1, None, None, key())) == 'NOT_FOUND')
    anchors = insp['anchors'] if insp else []
    def q(i, qid, label, kind='text', req=True, mx=200, opts=()):
        a = anchors[i]
        return {'id': qid, 'label': label, 'kind': kind, 'required': req, 'maxLength': mx, 'options': list(opts), 'anchorId': a['id'], 'sourceText': a['sourceText'], 'sourceHash': a['sourceHash']}
    mapping = {'profile': 'explicit_paragraph_v1', 'templateSha256': sha(raw_t),
               'questions': [q(1, 'name', '성명'), q(2, 'content', '연수 내용', 'longtext', True, 2000), q(3, 'date', '제출일', 'date'),
                             q(4, 'note', '비고', 'select', False, 20, ('없음', '있음'))]} if len(anchors) >= 5 else {}
    st = state()
    check('G17 매핑 규칙: 분석에 없는 칸·다른 원문 → CONFLICT, 같은 칸 두 번·선택지 없는 select → INVALID_INPUT',
          [ecode(adm.t({'kind': 'save_mapping', 'templateId': tid, 'expectedVersion': 1, 'title': '연수 결과 보고', 'mapping': m}))
           for m in ({**mapping, 'questions': [{**mapping['questions'][0], 'sourceText': '바꾼 원문'}]},
                     {**mapping, 'questions': [{**mapping['questions'][0], 'anchorId': 'Contents/section0.xml:p000099'}]},
                     {**mapping, 'questions': [mapping['questions'][0], {**mapping['questions'][1], 'anchorId': mapping['questions'][0]['anchorId'],
                                                                         'sourceText': mapping['questions'][0]['sourceText'], 'sourceHash': mapping['questions'][0]['sourceHash']}]},
                     {**mapping, 'questions': [{**mapping['questions'][3], 'options': []}]})] == ['CONFLICT', 'CONFLICT', 'INVALID_INPUT', 'INVALID_INPUT'] and state() == st)
    check('G18 남(21)의 초안 양식 매핑 → NOT_FOUND', ecode(t[21].t({'kind': 'save_mapping', 'templateId': tid, 'expectedVersion': 1, 'title': 'x', 'mapping': mapping})) == 'NOT_FOUND')
    km = key(); cm = {'kind': 'save_mapping', 'templateId': tid, 'expectedVersion': 1, 'title': '연수 결과 보고', 'mapping': mapping}
    em = adm.t(cm, km)
    check('G19 매핑 저장 → 접수증(양식판 2, 응답 칸 null)', data(em) == {'requestKey': km, 'templateId': tid, 'templateVersion': 2, 'responseId': None, 'responseVersion': None}, em)
    check('G20 같은 번호 재전송 → 같은 접수증 · 재조회 같은 접수증 · 다른 내용 IDEMPOTENCY_CONFLICT', adm.t(cm, km) == em and adm.t_recover(cm, km) == em
          and ecode(adm.t({**cm, 'title': '다름'}, km)) == 'IDEMPOTENCY_CONFLICT')
    check('G21 지난 판으로 매핑 → CONFLICT', ecode(adm.t({**cm, 'expectedVersion': 1})) == 'CONFLICT')
    check('G22 초안 양식에 실제 답변(preview=false) → INVALID_INPUT', ecode(adm.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 2, 'responseId': None,
                                                                              'expectedVersion': 0, 'answers': {}, 'preview': False})) == 'INVALID_INPUT')
    ans = {'name': '관리자', 'content': '평가 연수\n2차시 이수', 'date': DAY(), 'note': '없음'}
    ep = adm.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 2, 'responseId': None, 'expectedVersion': 0, 'answers': {'name': '관리자'}, 'preview': True})
    rid = data(ep)['responseId'] if ok(ep) else None
    check('G23 시험 답변 임시 저장(필수 빈칸 허용) → 답변 판 1', ok(ep) and data(ep)['responseVersion'] == 1, ep)
    check('G24 답변 규칙: 모르는 질문·숫자 아닌 날짜·선택지 밖·줄바꿈 금지 칸 → INVALID_INPUT',
          [ecode(adm.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 2, 'responseId': rid, 'expectedVersion': 1, 'answers': a, 'preview': True}))
           for a in ({'x': '1'}, {'date': '2026-02-30'}, {'note': '모름'}, {'name': '줄\n바꿈'})] == ['INVALID_INPUT'] * 4)
    rr0, _, _ = guided(adm, 'render', tid, 2, rid, 1)
    check('G25 [서버 API] 필수 칸이 빈 답변으로 생성 → INVALID_INPUT(서버 claim 단계에서 거절)', rr0 == ('ERR', 'INVALID_INPUT'), rr0)
    ep2 = adm.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 2, 'responseId': rid, 'expectedVersion': 1, 'answers': ans, 'preview': True})
    check('G26 답변 판 2', data(ep2) and data(ep2)['responseVersion'] == 2, ep2)
    rr, calls_r, kr = guided(adm, 'render', tid, 2, rid, 2)
    check('G27 [서버 API] 생성: claim → 원본 내려받기 → 칸 채우기 → 출력 올리기 → finish → 생성 파일', isinstance(rr, dict)
          and [n for n, _ in calls_r] == ['workhub_template_render_claim', 'workhub_template_render_finish'] and rr['data']['responseVersion'] == 2, (rr, calls_r))
    art = rr['data'] if isinstance(rr, dict) else {'artifactId': 'none'}
    out_path = f"{s1}/{m1}/{art['artifactId']}/output.hwpx"
    check('G28 생성 파일: 양식 판·답변 판·크기·SHA 고정, 상세 조회에 보임', isinstance(rr, dict) and data(adm.t_get(tid))['response']['artifact'] == art
          and art['sha256'] == sha(STORE[(DB, out_path)]))
    if GS is not None and isinstance(rr, dict):
        from _guided_hwpx import inspect_template
        filled = {a['id']: a['sourceText'] for a in inspect_template(STORE[(DB, out_path)])['anchors']}
        check('G29 생성 파일을 다시 열면 고른 칸만 답변으로 바뀜(나머지 문단 그대로)', filled[anchors[1]['id']] == '관리자' and filled[anchors[2]['id']] == '평가 연수\n2차시 이수'
              and filled[anchors[0]['id']] == anchors[0]['sourceText'], filled)
    else:
        check('G29 생성 파일 대조 — P4_APP_SRC 없음', False)
    acc = adm.art(art['artifactId'], raw=STORE.get((DB, out_path)))
    check('G30 생성 파일 내려받기 위치: 본인 → 경로·판 · 다른 교사 → NOT_FOUND', data(acc) and data(acc)['path'] == out_path and data(acc)['artifact'] == art
          and ecode(t[21].art(art['artifactId'])) == 'NOT_FOUND', acc)
    check('G31 Storage: 본인 직접 읽기 가능 · 다른 교사·서명 URL 불가', can_read(U1, DB, out_path) and not can_read(T[21], DB, out_path)
          and not can_read(U1, DB, out_path, op='storage.object.sign'))
    opr = {'action': 'render', 'templateId': tid, 'templateVersion': 2, 'responseId': rid, 'responseVersion': 2, 'requestKey': kr}
    check('G32 생성 결과 재조회 → 같은 생성 파일', data(adm.op_get(opr)) == art)
    rr2, calls_r2, _ = guided(adm, 'render', tid, 2, rid, 2, k=kr)
    check('G33 [서버 API] 같은 번호로 다시 생성 → 확정된 결과(다시 만들지 않음)', isinstance(rr2, dict) and rr2['data'] == art and len(calls_r2) == 1)
    # 게시
    st = state()
    pub = {'kind': 'publish', 'templateId': tid, 'expectedVersion': 2, 'previewArtifactId': art['artifactId'], 'collectionRequestId': col, 'collectionVersion': col_ver}
    check('G34 게시 조건: 수합 판 다름·HWPX 칸 없는 수합 → CONFLICT, 남의 수합 없음 → NOT_FOUND, 21 → NOT_FOUND',
          [ecode(adm.t({**pub, 'collectionVersion': col_ver + 1})), ecode(adm.t({**pub, 'collectionRequestId': col2, 'collectionVersion': scalar('select version from workhub.collections where id=%s', (col2,))})),
           ecode(adm.t({**pub, 'collectionRequestId': 'nope'})), ecode(t[21].t(pub))] == ['CONFLICT', 'CONFLICT', 'NOT_FOUND', 'NOT_FOUND'] and state() == st)
    ep3 = adm.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 2, 'responseId': rid, 'expectedVersion': 2, 'answers': {**ans, 'name': '관리자2'}, 'preview': True})
    check('G35 시험 답변을 고친 뒤 옛 생성 파일로 게시 → CONFLICT(현재 답변판으로 다시 생성해야 함)', ok(ep3) and ecode(adm.t(pub)) == 'CONFLICT')
    rr3, _, _ = guided(adm, 'render', tid, 2, rid, 3)
    art3 = rr3['data'] if isinstance(rr3, dict) else {'artifactId': 'none'}
    kpub = key(); epub = adm.t({**pub, 'previewArtifactId': art3['artifactId']}, kpub)
    check('G36 게시 → 양식판 3 published, 수합 연결', data(epub) == {'requestKey': kpub, 'templateId': tid, 'templateVersion': 3, 'responseId': None, 'responseVersion': None}
          and data(adm.t_get(tid))['template']['state'] == 'published' and data(adm.t_get(tid))['template']['collectionRequestId'] == col, epub)
    check('G37 게시판은 고칠 수 없음(매핑 저장 CONFLICT · DB 직접 수정 P4_TEMPLATE_IMMUTABLE)', ecode(adm.t({**cm, 'expectedVersion': 3})) == 'CONFLICT'
          and 'P4_TEMPLATE_IMMUTABLE' in sqlerr(f"update workhub.guided_templates set title='x' where id='{tid}'"))
    check('G38 게시 뒤 수합 대상 목록에서 빠짐(수합 1건당 게시 양식 1개)', data(adm.t_targets()) == {'items': []})
    # 대상 교사의 실제 답변
    g21 = data(t[21].t_get(tid))
    check('G39 수합 대상 교사(21)는 게시 양식을 봄(canManage=false, 내 답변 없음) · 대상 아닌 교사(25) NOT_FOUND', g21 and g21['template']['canManage'] is False
          and g21['response'] is None and ecode(t[25].t_get(tid)) == 'NOT_FOUND' and data(t[25].t_list())['items'] == [], g21)
    check('G40 대상 교사 시험 답변(preview=true) → INVALID_INPUT · 대상 아닌 교사 → NOT_FOUND',
          ecode(t[21].t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 3, 'responseId': None, 'expectedVersion': 0, 'answers': {}, 'preview': True})) == 'INVALID_INPUT'
          and ecode(t[25].t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 3, 'responseId': None, 'expectedVersion': 0, 'answers': {}, 'preview': False})) == 'NOT_FOUND')
    t21d = P(T[21], M[21])
    ans21 = {'name': '교사21', 'content': '연수 이수', 'date': DAY(), 'note': '있음'}
    outs = concurrently([lambda w=w: w.t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 3, 'responseId': None, 'expectedVersion': 0, 'answers': ans21, 'preview': False})
                         for w in (t[21], t21d)], "lock table workhub.guided_responses in exclusive mode")
    check('G41 같은 교사가 첫 답변을 동시에 2번 → 하나만 생성, 하나 CONFLICT', sorted('ok' if ok(o) else ecode(o) for o in outs) == ['CONFLICT', 'ok'], outs)
    r21 = next(data(o) for o in outs if ok(o))
    rr21, _, _ = guided(t[21], 'render', tid, 3, r21['responseId'], 1)
    check('G42 [서버 API] 대상 교사 생성 → 그 교사 경로의 생성 파일', isinstance(rr21, dict) and ok(t[21].art(rr21['data']['artifactId'], raw=STORE.get((DB, f"{s1}/m-21/{rr21['data']['artifactId']}/output.hwpx"))))
          and ecode(adm.art(rr21['data']['artifactId'])) == 'NOT_FOUND', rr21)
    check('G43 남의 답변으로 생성 claim → NOT_FOUND', ecode(t[22].svc('workhub_template_render_claim', tid, 3, r21['responseId'], 1, key())) == 'NOT_FOUND')
    # 응답 유실 · 미확정 재조회
    ep22 = t[22].t({'kind': 'save_answers', 'templateId': tid, 'templateVersion': 3, 'responseId': None, 'expectedVersion': 0, 'answers': {**ans21, 'name': '김하늘'}, 'preview': False})
    r22 = data(ep22)
    kr22 = key(); cl22 = t[22].svc('workhub_template_render_claim', tid, 3, r22['responseId'], 1, kr22)
    op22 = {'action': 'render', 'templateId': tid, 'templateVersion': 3, 'responseId': r22['responseId'], 'responseVersion': 1, 'requestKey': kr22}
    check('G44 생성 임대 중 재조회 → RESULT_UNKNOWN · 다시 claim → pending', ok(cl22) and data(cl22)['state'] == 'leased' and ecode(t[22].op_get(op22)) == 'RESULT_UNKNOWN'
          and data(t[22].svc('workhub_template_render_claim', tid, 3, r22['responseId'], 1, kr22)) == {'state': 'pending'}, cl22)
    check('G45 같은 번호로 다른 답변판 생성 → IDEMPOTENCY_CONFLICT', ecode(t[22].svc('workhub_template_render_claim', tid, 3, r22['responseId'], 2, kr22)) == 'IDEMPOTENCY_CONFLICT')
    check('G46 finish 전 출력 실물이 없으면 CONFLICT(올렸다고 주장만으로 확정 안 함)',
          ecode(t[22].svc('workhub_template_render_finish', tid, 3, r22['responseId'], 1, kr22, data(cl22)['leaseToken'], data(cl22)['source']['storageObjectId'],
                          {'artifactId': data(cl22)['target']['artifactId'], 'templateId': tid, 'templateVersion': 3, 'responseId': r22['responseId'],
                           'responseVersion': 1, 'bytes': 100, 'sha256': '0' * 64})) == 'CONFLICT')
    sqlfile(None, 'supabase_admin', text=f"set session_replication_role = replica; update workhub.guided_leases set expires_at = clock_timestamp() - interval '1 second' where state='issued'")
    rl, _, _ = guided(t[22], 'render', tid, 3, r22['responseId'], 1, k=kr22, lose_finish=True)
    check('G47 [서버 API] finish 응답 유실 → RESULT_UNKNOWN, DB 는 확정 · 재조회 → 생성 파일', rl == ('ERR', 'RESULT_UNKNOWN') and ok(t[22].op_get(op22)), rl)
    art22 = data(t[22].op_get(op22))
    rl2, _, _ = guided(t[22], 'render', tid, 3, r22['responseId'], 1, k=kr22)
    check('G48 [서버 API] 같은 번호 재실행 → 같은 생성 파일(출력 위치는 처음 claim 때 고정)', isinstance(rl2, dict) and rl2['data'] == art22, rl2)
    # 실물 바꿔치기
    replace_object(DB, f"{s1}/m-22/{art22['artifactId']}/output.hwpx", None, b'PK\x03\x04 changed')
    check('G49 생성 파일 실물이 바뀌면 내려받기 위치 CONFLICT · Storage 읽기 불가', ecode(t[22].art(art22['artifactId'])) == 'CONFLICT'
          and not can_read(T[22], DB, f"{s1}/m-22/{art22['artifactId']}/output.hwpx"))
    replace_object(DB, it_d['path'], U1, raw_t)
    rx, _, _ = guided(t[21], 'render', tid, 3, r21['responseId'], 1, k=key())
    check('G50 [서버 API] 양식 원본 실물이 바뀌면 새 생성 claim → CONFLICT', rx == ('ERR', 'CONFLICT'), rx)
    # 자격 회수 · 중지
    call(run, "update public.users set role='teacher' where id=%s", (T[21],))
    check('G51 대상 교사가 업무실 자격을 잃으면 FORBIDDEN(봉투 없음) · 생성 파일 Storage 읽기 불가', t[21].go('workhub_template_get', tid) == 'FORBIDDEN'
          and not can_read(T[21], DB, f"{s1}/m-21/{rr21['data']['artifactId']}/output.hwpx" if isinstance(rr21, dict) else 'x'))
    call(run, "update public.users set role='superadmin' where id=%s", (T[21],))
    stop('guided')
    check('G52 양식 중지 → 목록·준비 NOT_READY, 접수증·작업 재조회는 됨', ecode(adm.t_list()) == 'NOT_READY' and adm.t_recover(cm, km) == em and data(adm.op_get(opr)) == art)
    resume('guided')
    check('G53 재개 → 목록 다시', ok(adm.t_list()))

    # ======================================================================= H. 두 학교 · 사후 점검
    check('H01 다른 학교(m-27)에는 P4 자료가 하나도 없음 · 그 학교는 모두 policy_missing',
          scalar("select count(*) from workhub.knowledge_sources where school_id='school-2'") == 0 and scalar("select count(*) from workhub.documents where school_id='school-2'") == 0
          and scalar("select count(*) from workhub.guided_templates where school_id='school-2'") == 0
          and scalar("select array[workhub_private.p4_reason('school-2','knowledge'),workhub_private.p4_reason('school-2','guided')]::text") == '{policy_missing,policy_missing}')
    post = sqlfile('P4-03_사후점검.sql')
    check('H02 P4-03 사후 점검 FAIL 없음(판 기록 = 현재 · 추출문 1:1 · 학생 기록 나만 보기 · 생성 파일 = 완료 작업)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] == 'FAIL'])
    after2 = fingerprint()
    check('H03 사용 뒤에도 P4 밖 구조 지문(S1~S6) 같음', [r for r in before if r[1] != 'D1 기존 표 행 수·행 해시'] == [r for r in after2 if r[1] != 'D1 기존 표 행 수·행 해시'])

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == '__main__':
    main()
