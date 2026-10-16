# P3 메신저 · 업무 알림 · 메시지 HWPX 첨부 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# Storage 는 storage.objects 행 INSERT/SELECT 로 RLS 판정만 흉내 낸다(파일 본문은 이 도구의 메모리에 둔다).
# 서버 확인 API 는 PR #48 의 실제 apps/main/api/messages/_message_hwpx.py(check_file)를 가져와,
#   Supabase 호출만 이 시험 DB(service_role)와 메모리 저장소로 바꿔 끼워 돌린다(P3_APP_SRC 가 없으면 그 시험은 FAIL).
# 받은 응답은 P3_CAPTURE 에 남겨 app_contract_p3.ts 가 PR #48 앱의 실제 어댑터·parser 에 넣는다.
#
# 사용: python3 run_p3.py      (R1-01~03 + P1-01·02 + P2-01·02 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import base64, datetime, hashlib, io, json, os, sys, threading, time, uuid, zipfile
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
P2 = os.path.join(HERE, '..', '..', 'p2')
OUT = os.environ.get('P3_CAPTURE', '')
APP = os.environ.get('P3_APP_SRC', '')
captures = []
UP, GET = 'storage.object.upload', 'storage.object.get_authenticated'
BUCKET = 'workhub-message-files'
STORE = {}          # 경로 → 실물 바이트(Storage 본문 흉내)
MH = None
if APP and os.path.isfile(os.path.join(APP, 'apps', 'main', 'api', 'messages', '_message_hwpx.py')):
    sys.path.insert(0, os.path.join(APP, 'apps', 'main', 'api', 'messages'))
    import _message_hwpx as MH  # noqa: E402  (PR #48 실제 wrapper 코드)
U29, U30, U31 = ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000031')


# ----------------------------------------------------------------------------- 도구
def canon(v):
    if isinstance(v, list): return '[' + ','.join(canon(x) for x in v) + ']'
    if isinstance(v, dict): return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canon(v[k]) for k in sorted(v)) + '}'
    return json.dumps(v, ensure_ascii=False)

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

def fingerprint(): return [r for r in sqlfile('P3-00_사전점검_지문.sql') if r[0] == '지문']

P3_TABLES = ['messaging_policies', 'message_file_policies', 'message_threads', 'message_thread_members', 'messages', 'message_files',
             'message_attachments', 'message_file_leases', 'message_requests', 'message_file_requests', 'notifications']
def state():
    """P3 표 전부 + 감사·outbox·Storage 객체의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P3_TABLES)
    return scalar(f"""select jsonb_build_object({parts}, 'audit', (select count(*) from workhub.audit_events),
      'outbox', (select count(*) from workhub.outbox), 'objects', (select count(*) from storage.objects))""")

def ecode(env):
    if isinstance(env, dict): return (env.get('error') or {}).get('code') if env.get('ok') is False else None
    return env
def ok(env): return isinstance(env, dict) and env.get('ok') is True

def hwpx(tag, extra=b''):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, raw in {'mimetype': b'application/hwp+zip', 'Contents/content.hpf': b'<package/>',
                          'Contents/section0.xml': ('<section>' + tag + '</section>').encode() + extra, 'META-INF/container.xml': b'<container/>'}.items():
            z.writestr(name, raw)
    return stream.getvalue()
def sha(b): return hashlib.sha256(b).hexdigest()
def meta(name, raw): return {'name': name, 'claimedBytes': len(raw), 'claimedSha256': sha(raw)}

def storage_conn(uid, op):
    c = api(uid)
    if op is not None: call(c, "select set_config('storage.operation', %s, false)", (op,))
    return c
def put_object(uid, path, raw, op=UP, size=None):
    """사용자 SDK 업로드(upsert:false) 흉내: INSERT 정책 판정 + (bucket,name) 유일. 통과하면 본문을 메모리에 둔다."""
    c = storage_conn(uid, op)
    r = err(c, "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values (%s,%s,%s::uuid,%s,%s::jsonb)",
            (BUCKET, path, uid, uid, json.dumps({'size': len(raw) if size is None else size})))
    c.close()
    if r == 'OK': STORE[path] = raw
    return r
def can_read(uid, path, op=GET):
    c = storage_conn(uid, op); n = call(c, "select count(*) from storage.objects where bucket_id=%s and name=%s", (BUCKET, path)); c.close(); return n == 1

def concurrently(fns, hold_sql=None, hold_args=()):
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


class P(Who):
    """P3 RPC. 응답과 그때의 workhub_context(·준비 상태·대화)를 앱 대조용으로 남긴다."""
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
    def quiet(self, fn, *args):
        v = self.go(fn, *args); return v if isinstance(v, dict) else None
    def readiness(self): return self.keep('readiness', self.go('workhub_messaging_readiness'))
    def recipients(self, q='', cursor=None): return self.keep('recipients', self.go('workhub_message_recipients', q, cursor), query=q, cursor=cursor)
    def threads(self, q='', unread=False, cursor=None):
        return self.keep('threads', self.go('workhub_message_threads', q, unread, cursor), query=q, unread=unread, cursor=cursor)
    def get(self, tid, cursor=None): return self.keep('get', self.go('workhub_message_get', tid, cursor), threadId=tid, cursor=cursor)
    def inbox(self, unread=False, cursor=None): return self.keep('inbox', self.go('workhub_inbox_list', unread, cursor), unread=unread, cursor=cursor)
    def mutate(self, cmd, k=None, replay=False):
        k = k or key()
        ready = self.quiet('workhub_messaging_readiness')
        ctx_get = self.quiet('workhub_message_get', cmd['threadId'], None) if cmd.get('kind') == 'read_thread' and isinstance(cmd.get('threadId'), str) else None
        return self.keep('mutate', self.go('workhub_message_mutate', cmd, k, replay), command=cmd, key=k, replay=replay, ready=ready, threadGet=ctx_get)
    def file_readiness(self): return self.keep('file_readiness', self.go('workhub_message_file_readiness'))
    def prepare(self, m, k=None, replay=False, raw=None):
        k = k or key()
        pol = (data(self.quiet('workhub_message_file_readiness')) or {}).get('policy')
        extra = {'file': m, 'key': k, 'replay': replay, 'policy': pol}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('prepare', self.go('workhub_message_file_prepare', m, k, replay), **extra)
    def complete(self, fid, k): return self.go('workhub_message_file_complete', fid, k)
    def status(self, fid): return self.keep('status', self.go('workhub_message_file_status', fid), fileId=fid)
    def access(self, tid, mid, fid, raw=None):
        extra = {'threadId': tid, 'messageId': mid, 'fileId': fid}
        if raw is not None: extra['bytes'] = base64.b64encode(raw).decode()
        return self.keep('access', self.go('workhub_message_file_access', tid, mid, fid), **extra)
    def svc(self, fn, *args):
        """서버 확인 API 가 service_role 로 부르는 함수(사람 JWT 없음)"""
        c = api(None, 'service_role')
        try:
            ph = ','.join(['%s'] * len(args))
            return call(c, f'select public.{fn}({ph})', tuple(json.dumps(a) if isinstance(a, (dict, list)) else a for a in args))
        except psycopg2.Error as e:
            return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
        finally:
            c.close()
    def claim(self, fid, k, actor=None): return self.svc('workhub_message_file_basic_claim', actor or self.uid, self.member, fid, k)
    def finish(self, fid, k, token, obj, result, actor=None):
        return self.svc('workhub_message_file_basic_finish', actor or self.uid, self.member, fid, k, token, obj, result)


class FakeClient:
    """PR #48 wrapper 의 MessageClient 자리: 사용자 확인 = 이 교사, RPC = 시험 DB(service_role), 내려받기 = 메모리 저장소"""
    def __init__(self, who, truncate=None):
        self.who, self.truncate, self.calls = who, truncate, []
    def user(self, token): return self.who.uid
    def rpc(self, name, args):
        if name not in MH.NAMES: raise MH.basic.CheckError('INVALID_INPUT', 400)
        c = api(None, 'service_role')
        try:
            names = list(args)
            v = call(c, f"select public.{name}({','.join(n + ' => %s' for n in names)})",
                     tuple(json.dumps(args[n]) if isinstance(args[n], dict) else args[n] for n in names))
        finally:
            c.close()
        self.calls.append((name, v))
        return json.loads(json.dumps(v))
    def download(self, bucket, path, maximum):
        raw = STORE[path]
        if len(raw) > maximum: raise MH.basic.FileRejected('FILE_SIZE_LIMIT')
        return raw[:self.truncate] if self.truncate else raw

def wrapper(who, fid, k, truncate=None):
    """실제 wrapper check_file 을 한 번 돌린다 → (공개 응답 또는 ('ERR', code), 호출 기록)"""
    if MH is None: return ('ERR', 'NO_APP'), []
    cl = FakeClient(who, truncate)
    try:
        out = MH.check_file({'memberId': who.member, 'fileId': fid, 'requestKey': k}, 'Bearer ' + 'a' * 40, cl)
    except MH.basic.CheckError as e:
        out = ('ERR', e.code)
    return out, cl.calls

def send_file(who, name, raw, check_now=True, kp=None, kc=None):
    """앱 순서대로: prepare → 업로드 → complete → (pending 이면) 서버 확인. 마지막 상태를 돌려준다."""
    kp, kc = kp or key(), kc or key()
    it = data(who.prepare(meta(name, raw), kp, raw=raw))
    put = put_object(who.uid, it['path'], raw)
    st = who.complete(it['fileId'], kc)
    chk = None
    if check_now and data(st) and data(st)['state'] == 'pending_basic':
        chk, _ = wrapper(who, it['fileId'], kc)
    if OUT:
        captures.append({'kind': 'complete', 'scope': {'schoolId': who.school, 'memberId': who.member, 'userId': who.uid},
                         'context': who.ctx(), 'raw': st, 'fileId': it['fileId'], 'key': kc,
                         'check': chk if isinstance(chk, dict) else None})
    return {'id': it['fileId'], 'path': it['path'], 'intent': it, 'put': put, 'complete': st, 'check': chk, 'kc': kc, 'kp': kp, 'raw': raw}

def start(mode, rcpts, body='안녕하세요', title='', files=()):
    rs = sorted(rcpts, key=lambda r: r['memberId'])
    return {'kind': 'start', 'mode': mode, 'recipients': rs, 'title': title, 'body': body, 'attachmentIds': list(files)}
def reply(thread, me, body='답장입니다', files=(), version=None, others=None):
    o = others if others is not None else sorted(p['memberId'] for p in thread['participants'] if p['memberId'] != me)
    return {'kind': 'reply', 'threadId': thread['id'], 'expectedVersion': version or thread['version'], 'recipientMemberIds': o, 'body': body, 'attachmentIds': list(files)}
def rv(who, mid):
    """받는 사람 목록에서 그 사람 {memberId, expectedVersion}"""
    v = scalar('select version from workhub.memberships where id=%s', (mid,))
    return {'memberId': mid, 'expectedVersion': v}


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    start_day = scalar("select min(starts_on) from workhub.academic_years where school_id=%s", (s1,))
    run = admin()
    # 같은 이름 교사 2명(22·23), 가입 대기(29)·거절(30)·정지(31), 페이지 시험용 교사 55명(41~95), 업무실 자격 없는 교사(acc-02 = U2 teacher)
    call(run, "update workhub.accounts set display_name='김하늘' where id in ('acc-22','acc-23')")
    call(run, f"""insert into auth.users(id,email,raw_user_meta_data) values
        ('{U29}','t29@x.kr','{{"full_name":"대기교사"}}'),('{U30}','t30@x.kr','{{"full_name":"거절교사"}}'),('{U31}','t31@x.kr','{{"full_name":"정지교사"}}')""")
    extra = [f'00000000-0000-0000-0000-0000000001{n:02d}' for n in range(41, 96)]
    call(run, "insert into auth.users(id,email,raw_user_meta_data) select u::uuid, 'x'||right(u,3)||'@x.kr', jsonb_build_object('full_name', '가나교사'||right(u,2)) from unnest(%s::text[]) u",
         (extra,))
    call(run, "update public.users set role='superadmin', is_active=true where id = any(%s)", ([U29, U30, U31] + extra,))
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-'||right(id,3), id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = any(%s)""", ([U29, U30, U31] + extra,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type) values ('m-29', %s, 'acc-029', 'pending', 'teacher')", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, decided_at) values ('m-30', %s, 'acc-030', 'rejected', 'teacher', now())", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-31', %s, 'acc-031', 'suspended', 'teacher', %s, now())", (s1, start_day))
    call(run, """insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at)
                 select 'm-x'||right(u,3), %s, 'acc-'||right(u,3), 'active', 'teacher', %s, now() from unnest(%s::text[]) u""", (s1, start_day, extra))
    # U2(legacy teacher, 업무실 자격 없음)에게도 학교 소속을 준다 — 받는 사람에서 빠져야 한다
    call(run, """insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                 select 'acc-u2', id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = %s""", (U2,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, decided_at) values ('m-u2', %s, 'acc-u2', 'active', 'teacher', %s, now())", (s1, start_day))

    # ======================================================================= A. 설치 전 지문 → P3-01·02·03 → 지문 비교
    before = fingerprint()
    sqlfile('P3-01_메시지_알림_모델.sql'); sqlfile('P3-02_메시지_공개함수_Storage.sql')
    post = sqlfile('P3-03_사후점검.sql')
    check('A01 P3-03 사후 점검 FAIL 없음, 메시지·첨부 활성화 없음', all(r[2] in ('ok', 'info') for r in post) and post[-2][3] == '(활성화 없음)', post)
    after = fingerprint()
    check('A02 P3-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A03 P3-01 다시 실행 → 멈춤', 'P3-01 이 이미 적용되었습니다' in sqlerr(src('P3-01_메시지_알림_모델.sql')))
    check('A04 P3-02 다시 실행 → 멈춤', 'P3-02 가 이미 적용되었습니다' in sqlerr(src('P3-02_메시지_공개함수_Storage.sql')))
    check('A05 수합 버킷 준비 판정(R1)이 P3 정책을 다른 버킷으로 인식', scalar('select workhub_private.c_storage_ok()') is True)
    check('A06 메시지 버킷 준비 판정 = 정상(P3-02 그대로)', scalar('select workhub_private.p3_storage_ok()') is True)

    t = {n: P(T[n], M[n]) for n in (21, 22, 23, 24, 25, 26, 27)}
    adm = P(U1, m1)
    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 메시지 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_messaging_readiness('x')"))
    c = api(None, 'service_role')
    check('B02 service_role 은 앱 함수 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_message_threads('x','',false,null)"))
    c = api(T[21])
    check('B03 authenticated 는 서버 확인 함수(claim·finish) 실행 불가',
          'permission denied' in err(c, "select public.workhub_message_file_basic_claim(%s::uuid,'m-21','f','kkkkkkkk')", (T[21],))
          and 'permission denied' in err(c, "select public.workhub_message_file_basic_finish(%s::uuid,'m-21','f','kkkkkkkk','t',gen_random_uuid(),'{}')", (T[21],)))
    check('B04 authenticated 는 새 표 직접 읽기 불가', 'permission denied' in err(c, 'select * from workhub.messages'))
    check('B05 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p3_installed()"))
    check('B06 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', err(api(U2), "select public.workhub_messaging_readiness('m-u2')") == 'FORBIDDEN')
    check('B07 다른 학교 소속 ID(m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_messaging_readiness(%s)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('B08 소속이 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', P(T[28], M[28]).go('workhub_messaging_readiness') == 'INACTIVE_MEMBERSHIP')
    check('B09 가입 대기(m-29)·정지(m-31) → INACTIVE_MEMBERSHIP',
          P(U29, 'm-29').go('workhub_messaging_readiness') == 'INACTIVE_MEMBERSHIP' and P(U31, 'm-31').go('workhub_messaging_readiness') == 'INACTIVE_MEMBERSHIP')
    st = state()
    r0 = t[21].readiness()
    check('B10 설치만 → 준비 policy_missing · 한도 null · 첨부 not_configured',
          data(r0) == {'available': False, 'reason': 'policy_missing', 'limits': None, 'attachments': 'not_configured'}, r0)
    check('B11 설치만 → 받는 사람·대화·알림 NOT_READY',
          [ecode(t[21].recipients()), ecode(t[21].threads()), ecode(t[21].inbox()), ecode(t[21].get('x'))] == ['NOT_READY'] * 4)
    check('B12 설치만 → 보내기 NOT_READY, 원장 없음', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])]))) == 'NOT_READY')
    fr0 = t[21].file_readiness()
    check('B13 설치만 → 첨부 준비 verification_missing · policy null', data(fr0) == {'available': False, 'reason': 'verification_missing', 'policy': None}, fr0)
    check('B14 설치만 → 첨부 예약 NOT_READY', ecode(t[21].prepare(meta('a.hwpx', hwpx('a')))) == 'NOT_READY')
    check('B15 설치만 → 어떤 경로도 Storage 업로드 불가', put_object(T[21], f'{s1}/m-21/x/original.hwpx', hwpx('x')) != 'OK')
    check('B16 설치만 → 조회·거절은 아무것도 쓰지 않음', state() == st)

    # ======================================================================= C. P3-04 메시지 켜기
    p4 = os.path.join(S, 'P3-04_메시지활성화_양식.sql')
    check('C01 빈 칸이 남은 P3-04 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P3-04_메시지활성화_양식.sql')))
    good = {'approver_user_id': U1, 'approval_ref': '2026-10-20 교무회의 메신저 시범 승인', 'body_characters': 2000, 'title_characters': 100, 'recipients': 60}
    check('C02 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(fill_json(p4, {**good, 'approver_user_id': T[21]})))
    check('C03 한도 범위 밖(본문 0) → 멈춤', '한도는' in sqlerr(fill_json(p4, {**good, 'body_characters': 0})))
    check('C04 한도를 문자열로 → 멈춤', '한도는' in sqlerr(fill_json(p4, {**good, 'recipients': '60'})))
    check('C05 승인 근거 빈칸 → 멈춤', '승인 근거는 1~200자' in sqlerr(fill_json(p4, {**good, 'approval_ref': ' '})))
    check('C06 멈춘 P3-04 는 아무것도 쓰지 않음', state() == st)
    check('C07 P3-04 정상 실행', sqlerr(fill_json(p4, good)) == 'OK')
    check('C08 P3-04 두 번째 → 멈춤', '이미 메시지 활성화·정책이 있습니다' in sqlerr(fill_json(p4, good)))
    r1 = t[21].readiness()
    check('C09 준비 ready · 학교 정책 한도 그대로 · 첨부는 아직 not_configured',
          data(r1) == {'available': True, 'reason': 'ready', 'limits': {'bodyCharacters': 2000, 'titleCharacters': 100, 'recipients': 60}, 'attachments': 'not_configured'}, r1)
    check('C10 다른 학교(m-27)는 여전히 policy_missing', data(t[27].readiness())['reason'] == 'policy_missing')
    check('C11 정책 행은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.messaging_policies set recipients = 500") == 'IMMUTABLE_ROW')

    # ======================================================================= D. 받는 사람
    p1 = t[21].recipients(); d1 = data(p1)
    p2_ = t[21].recipients(cursor=d1['nextCursor']); d2 = data(p2_)
    ids = [r['memberId'] for r in d1['items'] + d2['items']]
    check('D01 받는 사람 50명 + 나머지, 겹침 없음, 다음 위치 없음으로 끝', len(d1['items']) == 50 and d2['nextCursor'] is None and len(ids) == len(set(ids)), (len(d1['items']), len(d2['items'])))
    want = {m1, M[22], M[23], M[24], M[25], M[26]} | {f'm-x1{n:02d}' for n in range(41, 96)}
    check('D02 본인·다른 학교·끝남·대기·거절·정지·업무실 자격 없는 교사(U2) 제외', set(ids) == want, sorted(set(ids) ^ want)[:10])
    check('D03 정렬: 이름 → id', [(r['name'], r['memberId']) for r in d1['items'] + d2['items']] == sorted((r['name'], r['memberId']) for r in d1['items'] + d2['items']))
    same = [r for r in d1['items'] + d2['items'] if r['name'] == '김하늘']
    check('D04 같은 이름 2명은 서로 다른 memberId 로 구분', len(same) == 2 and len({r['memberId'] for r in same}) == 2, same)
    q = data(t[21].recipients('김하늘'))
    check('D05 이름 검색(서버 전체) → 2명', sorted(r['memberId'] for r in q['items']) == [M[22], M[23]], q)
    check('D06 검색어의 %·_ 는 글자 그대로', data(t[21].recipients('%'))['items'] == [] and data(t[21].recipients('_'))['items'] == [])
    check('D07 다른 검색어에 위치 값 재사용 → INVALID_INPUT', ecode(t[21].recipients('가나', d1['nextCursor'])) == 'INVALID_INPUT')
    check('D08 다른 사람이 위치 값 사용 → INVALID_INPUT', ecode(t[22].recipients('', d1['nextCursor'])) == 'INVALID_INPUT')
    check('D09 위치 값 위조(16진 아님·JSON 아님) → INVALID_INPUT', ecode(t[21].recipients('', 'zz')) == 'INVALID_INPUT' and ecode(t[21].recipients('', '7b')) == 'INVALID_INPUT')
    check('D10 검색어 제어 문자·200자 초과 → INVALID_INPUT', ecode(t[21].recipients('a\u0001')) == 'INVALID_INPUT' and ecode(t[21].recipients('가' * 201)) == 'INVALID_INPUT')
    check('D11 다른 학교(m-27) 받는 사람 = NOT_READY(그 학교는 꺼짐)', ecode(t[27].recipients()) == 'NOT_READY')

    # ======================================================================= E. 1:1 보내기 · 같은 번호 재전송 · 응답 유실
    st = state()
    k1 = key(); c1 = start('direct', [rv(t[21], M[22])], '첫 메시지')
    e1 = t[21].mutate(c1, k1); r = data(e1)
    check('E01 1:1 시작 → 접수증(deliveries 1, 받는 사람 = 요청 명단, 나머지 null)',
          ok(e1) and r['kind'] == 'start' and len(r['deliveries']) == 1 and r['deliveries'][0]['recipientMemberIds'] == [M[22]]
          and r['deliveries'][0]['sequence'] == 1 and (r['threadId'], r['throughSequence'], r['noticeId'], r['version']) == (None, None, None, None), e1)
    th1 = r['deliveries'][0]['threadId']
    check('E02 같은 번호·같은 내용 재전송(응답 유실 뒤) → 처음 접수증 그대로, 메시지 1개', t[21].mutate(c1, k1) == e1
          and scalar('select count(*) from workhub.messages where thread_id=%s', (th1,)) == 1)
    check('E03 같은 번호·다른 내용 → IDEMPOTENCY_CONFLICT', ecode(t[21].mutate({**c1, 'body': '바꾼 내용'}, k1)) == 'IDEMPOTENCY_CONFLICT')
    check('E04 replay_only + 있는 번호 → 처음 접수증', t[21].mutate(c1, k1, replay=True) == e1)
    check('E05 replay_only + 없는 번호 → NOT_FOUND, 새로 쓰지 않음', ecode(t[21].mutate(c1, key(), replay=True)) == 'NOT_FOUND'
          and scalar('select count(*) from workhub.messages where thread_id=%s', (th1,)) == 1)
    check('E06 같은 번호라도 다른 소속(22)이 쓰면 별개 요청', ok(t[22].mutate(start('direct', [rv(t[22], M[21])], '저도요'), k1)))
    check('E07 1:1 은 두 사람 조합으로 하나 — 상대가 시작해도 같은 대화(순번 2)',
          scalar("select count(*) from workhub.message_threads where kind='direct'") == 1 and scalar('select latest_sequence from workhub.message_threads where id=%s', (th1,)) == 2)
    g22 = data(t[22].get(th1)); g21 = data(t[21].get(th1))
    check('E08 대화 열기: 참여자 2명 · 순번 오름차순 · 보낸 사람 이름 보존', [m['sequence'] for m in g22['items']] == [1, 2]
          and g22['items'][0]['senderName'] == '교사21' and len(g22['thread']['participants']) == 2, g22)
    check('E09 읽지 않은 수 = 받은 메시지 중 읽은 순번 이후(자기 전송 제외)', g22['thread']['unreadCount'] == 1 and g21['thread']['unreadCount'] == 1, (g22['thread'], g21['thread']))
    check('E10 열기만으로는 읽음을 쓰지 않음', scalar('select max(read_sequence) from workhub.message_thread_members where thread_id=%s', (th1,)) == 0)
    check('E11 학교 관리자(U1)도 남의 1:1 대화는 NOT_FOUND', ecode(adm.get(th1)) == 'NOT_FOUND')
    check('E12 참여자 아닌 교사(23) → NOT_FOUND, 대화 목록에도 없음', ecode(t[23].get(th1)) == 'NOT_FOUND' and data(t[23].threads())['items'] == [])
    tl = data(t[21].threads())
    check('E13 대화 목록 · 최근 순 · 참여자 정보', [x['id'] for x in tl['items']] == [th1] and tl['items'][0]['canSend'] is True, tl)

    # ======================================================================= F. 단체 대화 · 답장 · 판 확인
    cg = start('group', [rv(t[21], M[22]), rv(t[21], M[23]), rv(t[21], M[24])], '평가 계획 회의 안내', title='  2학년 협의  ')
    eg = t[21].mutate(cg); rg = data(eg)
    tg = rg['deliveries'][0]['threadId']
    check('F01 단체 시작 → delivery 1개, 받는 사람 3명', ok(eg) and len(rg['deliveries']) == 1 and rg['deliveries'][0]['recipientMemberIds'] == sorted([M[22], M[23], M[24]]), eg)
    gg = data(t[23].get(tg))['thread']
    check('F02 단체 대화: 제목은 앞뒤 공백 걷어 저장 · 참여자 4명 · kind group', gg['title'] == '2학년 협의' and len(gg['participants']) == 4 and gg['kind'] == 'group', gg)
    check('F03 단체 제목 없음 → INVALID_INPUT', ecode(t[21].mutate(start('group', [rv(t[21], M[22]), rv(t[21], M[23])], 'x', title='  '))) == 'INVALID_INPUT')
    check('F04 단체 받는 사람 1명 → INVALID_INPUT', ecode(t[21].mutate(start('group', [rv(t[21], M[22])], 'x', title='a'))) == 'INVALID_INPUT')
    check('F05 단체 제목이 학교 한도(100) 초과 → INVALID_INPUT',
          ecode(t[21].mutate(start('group', [rv(t[21], M[22]), rv(t[21], M[23])], 'x', title='가' * 101))) == 'INVALID_INPUT')
    er = t[23].mutate(reply(gg, M[23], '참석합니다'))
    check('F06 답장 → delivery 1개, 최상위 threadId = 요청 대화, 받는 사람 = 다른 참여자', ok(er) and data(er)['threadId'] == tg
          and data(er)['deliveries'][0]['recipientMemberIds'] == sorted([M[21], M[22], M[24]]) and data(er)['deliveries'][0]['sequence'] == 2, er)
    check('F07 답장: 화면이 본 판과 다름 → CONFLICT', ecode(t[23].mutate(reply(gg, M[23], version=gg['version'] + 1))) == 'CONFLICT')
    check('F08 답장: 확인한 참여자 명단이 다름 → CONFLICT', ecode(t[23].mutate(reply(gg, M[23], others=[M[21], M[22]]))) == 'CONFLICT')
    check('F09 참여자 아닌 사람의 답장 → NOT_FOUND', ecode(t[25].mutate(reply(gg, M[25], others=[M[21], M[22], M[23], M[24]]))) == 'NOT_FOUND')
    check('F10 메시지가 늘어도 대화 판은 그대로(답장이 충돌하지 않음)', data(t[22].get(tg))['thread']['version'] == gg['version'])
    check('F11 제목·참여자 이름으로 대화 목록 검색', [x['id'] for x in data(t[22].threads('2학년'))['items']] == [tg]
          and tg in [x['id'] for x in data(t[22].threads('교사24'))['items']] and data(t[22].threads('없는제목'))['items'] == [])

    # ======================================================================= G. 개별 일괄 전송
    ci = start('individual', [rv(t[25], M[22]), rv(t[25], M[23]), rv(t[25], M[26])], '개별 안내: 회신 부탁드립니다')
    ei = t[25].mutate(ci); ri = data(ei)
    check('G01 개별 전송 → 받는 사람마다 delivery 1개(각 1명), 접수증 받는 사람 = 요청 명단',
          ok(ei) and len(ri['deliveries']) == 3 and all(len(d['recipientMemberIds']) == 1 for d in ri['deliveries'])
          and sorted(d['recipientMemberIds'][0] for d in ri['deliveries']) == sorted([M[22], M[23], M[26]]), ei)
    th23 = next(d['threadId'] for d in ri['deliveries'] if d['recipientMemberIds'] == [M[23]])
    v23 = data(t[23].get(th23))
    check('G02 받는 사람은 1:1 대화만 봄(다른 받는 사람 명단 노출 없음)', v23['thread']['kind'] == 'direct' and len(v23['thread']['participants']) == 2, v23['thread'])
    check('G03 개별 전송 한 번 = 한 원장 행 · 메시지 3개(같은 요청 번호)', scalar("select count(*) from workhub.message_requests where membership_id='m-25'") == 1
          and scalar("select count(*) from workhub.messages where sender_membership_id='m-25'") == 3)
    check('G04 개별 전송이 기존 1:1 대화를 이어 씀(25→22 대화가 생기고 다음엔 순번 2)',
          data(t[25].mutate(start('individual', [rv(t[25], M[22])], '두 번째')))['deliveries'][0]['sequence'] == 2)
    st = state()
    bad = start('individual', [rv(t[25], M[22]), {'memberId': M[23], 'expectedVersion': 99}, rv(t[25], M[26])], '일부만 가면 안 됨')
    check('G05 한 명이라도 판이 다르면 전체 CONFLICT, 아무에게도 보내지 않음', ecode(t[25].mutate(bad)) == 'CONFLICT' and state() == st)
    check('G06 학교 한도(받는 사람 60명) 초과 → INVALID_INPUT',
          ecode(t[21].mutate(start('individual', [rv(t[21], f'm-x1{n:02d}') for n in range(41, 96)] + [rv(t[21], M[n]) for n in (22, 23, 24, 25, 26, 24 + 0)][:6], 'x'))) == 'INVALID_INPUT')

    # ======================================================================= H. 받는 사람 자격 · 판 · 입력
    st = state()
    check('H01 모르는 소속 id → NOT_FOUND', ecode(t[21].mutate(start('direct', [{'memberId': 'm-none', 'expectedVersion': 1}]))) == 'NOT_FOUND')
    check('H02 다른 학교 소속(m-27) → NOT_FOUND', ecode(t[21].mutate(start('direct', [rv(t[21], M[27])]))) == 'NOT_FOUND')
    check('H03 본인 포함 → INVALID_INPUT', ecode(t[21].mutate(start('group', [rv(t[21], M[21]), rv(t[21], M[22])], title='a'))) == 'INVALID_INPUT')
    check('H04 받는 사람 중복 → INVALID_INPUT', ecode(t[21].mutate({**start('group', [rv(t[21], M[22])], title='a'),
                                                                     'recipients': [rv(t[21], M[22]), rv(t[21], M[22])]})) == 'INVALID_INPUT')
    check('H05 끝난 소속(m-28)·대기(m-29)·정지(m-31)·자격 없는 교사(m-u2) → CONFLICT',
          [ecode(t[21].mutate(start('direct', [rv(t[21], x)]))) for x in (M[28], 'm-29', 'm-31', 'm-u2')] == ['CONFLICT'] * 4)
    check('H06 본문 학교 한도(2000) 초과 → INVALID_INPUT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], '가' * 2001))) == 'INVALID_INPUT')
    check('H07 본문 이모지는 UTF-16 길이로(1000개 = 2000) 통과 · 1001개 거절',
          ok(t[21].mutate(start('direct', [rv(t[21], M[24])], '😀' * 1000))) and ecode(t[21].mutate(start('direct', [rv(t[21], M[24])], '😀' * 1001))) == 'INVALID_INPUT')
    st = state()
    check('H08 빈 본문 + 첨부 없음 → INVALID_INPUT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], '   '))) == 'INVALID_INPUT')
    check('H09 본문 제어 문자 → INVALID_INPUT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'a\u0007b'))) == 'INVALID_INPUT')
    check('H10 모르는 항목·모르는 kind·mode → INVALID_INPUT',
          [ecode(t[21].mutate({**start('direct', [rv(t[21], M[22])]), 'extra': 1})), ecode(t[21].mutate({'kind': 'delete'})),
           ecode(t[21].mutate({**start('direct', [rv(t[21], M[22])]), 'mode': 'all'}))] == ['INVALID_INPUT'] * 3)
    check('H11 요청 번호 형식 오류 → INVALID_INPUT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])]), 'a b')) == 'INVALID_INPUT')
    check('H12 거절은 아무것도 쓰지 않음(원장·메시지·감사 그대로)', state() == st)
    # 받는 사람의 자격 변화: 판(version) 이 오르면 화면이 본 판과 다름
    call(run, "update workhub.memberships set version = version + 1 where id = 'm-26'")
    check('H13 받는 사람 판이 오름(자격·기간 변경) → CONFLICT', ecode(t[21].mutate(start('direct', [{'memberId': M[26], 'expectedVersion': 1}]))) == 'CONFLICT')
    # 역할 회수: 받는 사람이 업무실 자격을 잃음 → 그 사람이 있는 대화는 canSend=false · 답장 CONFLICT
    call(run, "update public.users set role='teacher' where id=%s", (T[24],))
    gg2 = data(t[22].get(tg))['thread']
    check('H14 참여자 한 명이 자격을 잃으면 canSend=false, 답장 CONFLICT', gg2['canSend'] is False and ecode(t[22].mutate(reply(gg2, M[22]))) == 'CONFLICT', gg2)
    check('H15 자격 잃은 사람은 받는 사람 목록에서 빠짐', M[24] not in [r['memberId'] for r in data(t[21].recipients('교사24'))['items']])
    call(run, "update public.users set role='superadmin' where id=%s", (T[24],))
    check('H16 자격을 되찾으면 답장 가능', ok(t[22].mutate(reply(data(t[22].get(tg))['thread'], M[22], '다시 보냄'))))
    # 보내는 사람 역할 회수: 업무실 gate 자체가 막는다(봉투 없음). 이미 성공한 요청의 접수증은 자격을 되찾은 뒤 다시 조회된다
    call(run, "update public.users set role='teacher' where id=%s", (T[21],))
    check('H17 보내는 사람 자격 회수 → FORBIDDEN(봉투 없음), 재조회도 막힘', t[21].go('workhub_message_mutate', c1, k1, True) == 'FORBIDDEN')
    call(run, "update public.users set role='superadmin' where id=%s", (T[21],))
    check('H18 자격 회복 뒤 같은 번호 재조회 → 처음 접수증', t[21].mutate(c1, k1, replay=True) == e1)

    # ======================================================================= I. 읽음
    k_r = key(); rd = t[22].mutate({'kind': 'read_thread', 'threadId': th1, 'throughSequence': 2}, k_r)
    check('I01 읽음 → 접수증(threadId·throughSequence 만, deliveries 빈 배열)', ok(rd) and data(rd)['deliveries'] == [] and data(rd)['threadId'] == th1
          and data(rd)['throughSequence'] == 2 and data(rd)['noticeId'] is None and data(rd)['version'] is None, rd)
    check('I02 읽음 뒤 읽지 않은 수 0', data(t[22].get(th1))['thread']['unreadCount'] == 0)
    rl = t[22].mutate({'kind': 'read_thread', 'threadId': th1, 'throughSequence': 1})
    check('I03 낮은 순번 읽음 → 성공 접수증(요청 순번 그대로) · 서버 읽은 순번은 내려가지 않음', ok(rl) and data(rl)['throughSequence'] == 1
          and scalar("select read_sequence from workhub.message_thread_members where thread_id=%s and membership_id='m-22'", (th1,)) == 2)
    check('I04 최신보다 큰 순번 → INVALID_INPUT', ecode(t[22].mutate({'kind': 'read_thread', 'threadId': th1, 'throughSequence': 99})) == 'INVALID_INPUT')
    check('I05 남의 대화 읽음 → NOT_FOUND', ecode(t[23].mutate({'kind': 'read_thread', 'threadId': th1, 'throughSequence': 1})) == 'NOT_FOUND')
    check('I06 읽음 재전송 → 같은 접수증', t[22].mutate({'kind': 'read_thread', 'threadId': th1, 'throughSequence': 2}, k_r) == rd)
    check('I07 읽음 순번 직접 낮추기는 DB 가 막음', 'P3_READ_MONOTONIC' in sqlerr(f"update workhub.message_thread_members set read_sequence = 0 where thread_id='{th1}'"))
    t[21].mutate(reply(data(t[21].get(th1))['thread'], M[21], '새 소식'))
    un = data(t[22].threads(unread=True))
    check('I08 안 읽은 대화만 보기 → 새 메시지가 온 대화만', th1 in [x['id'] for x in un['items']] and all(x['unreadCount'] > 0 for x in un['items']), un)

    # ======================================================================= J. 업무 알림함
    for i in range(53):
        call(run, "select workhub_private.p3_notify(%s, 'm-22', %s, '', 'tasks', %s, %s)", (s1, f'업무 알림 {i:02d}', f'task-{i}', f'task:{i}'))
    check('J01 같은 dedupe 키는 한 번만', scalar("select workhub_private.p3_notify(%s, 'm-22', '중복', '', 'tasks', 'task-0', 'task:0')", (s1,)) is None
          and scalar("select count(*) from workhub.notifications where owner_membership_id='m-22'") == 53)
    call(run, "select workhub_private.p3_notify(%s, 'm-23', '남의 알림', '', null, null, 'x:1')", (s1,))
    n1 = data(t[22].inbox()); n2 = data(t[22].inbox(cursor=n1['nextCursor']))
    nids = [n['id'] for n in n1['items'] + n2['items']]
    check('J02 알림 50 + 3, 최신순, 겹침 없음, 내 것만', len(n1['items']) == 50 and len(n2['items']) == 3 and n2['nextCursor'] is None and len(set(nids)) == 53
          and all(n['ownerMemberId'] == M[22] for n in n1['items'] + n2['items']))
    nt = n1['items'][0]
    kn = key(); rn = t[22].mutate({'kind': 'read_notice', 'noticeId': nt['id'], 'expectedVersion': 1}, kn)
    check('I09 알림 읽음 → 접수증(noticeId·version 만), version 2', ok(rn) and data(rn)['noticeId'] == nt['id'] and data(rn)['version'] == 2
          and data(rn)['threadId'] is None and data(rn)['deliveries'] == [], rn)
    check('J03 이미 읽은 알림을 다른 번호로 다시 읽음 → 멱등 성공(version 그대로)',
          data(t[22].mutate({'kind': 'read_notice', 'noticeId': nt['id'], 'expectedVersion': 1}))['version'] == 2)
    check('J04 안 읽은 알림 판이 다름 → CONFLICT', ecode(t[22].mutate({'kind': 'read_notice', 'noticeId': n1['items'][1]['id'], 'expectedVersion': 2})) == 'CONFLICT')
    other = scalar("select id from workhub.notifications where owner_membership_id='m-23'")
    check('J05 남의 알림 읽음 → NOT_FOUND', ecode(t[22].mutate({'kind': 'read_notice', 'noticeId': other, 'expectedVersion': 1})) == 'NOT_FOUND')
    check('J06 안 읽은 알림만 보기 → 52건', len(data(t[22].inbox(True))['items']) + len(data(t[22].inbox(True, data(t[22].inbox(True))['nextCursor']))['items']) == 52)
    check('J07 알림 위치 값을 다른 필터에 재사용 → INVALID_INPUT', ecode(t[22].inbox(True, n1['nextCursor'])) == 'INVALID_INPUT')
    check('J08 알림 제목·본문 직접 고치기는 DB 가 막음', sqlerr("update workhub.notifications set title='x'") == 'IMMUTABLE_IDENTITY' and sqlerr("update workhub.notifications set body='x'") == 'IMMUTABLE_IDENTITY')

    # ======================================================================= K. 동시 실행
    kk = key(); ck = start('direct', [rv(t[23], M[24])], '동시에 두 번')
    t23b = P(T[23], M[23])
    outs = concurrently([lambda: t[23].mutate(ck, kk), lambda: t23b.mutate(ck, kk)],
                        "select pg_advisory_lock(hashtextextended('p3'||chr(31)||%s||chr(31)||'m-23'||chr(31)||'mutate'||chr(31)||%s, 0))", (s1, kk))
    check('K01 같은 번호 동시 2회 → 같은 접수증, 메시지 1개', ok(outs[0]) and outs[0] == outs[1]
          and scalar("select count(*) from workhub.messages where request_key=%s", (kk,)) == 1, outs)
    t24b = P(T[24], M[24])
    xa, xb = P(extra[0], 'm-x141'), P(extra[1], 'm-x142')   # 아직 서로 대화가 없는 두 사람
    outs = concurrently([lambda: xa.mutate(start('direct', [rv(xa, 'm-x142')], '먼저')), lambda: xb.mutate(start('direct', [rv(xb, 'm-x141')], '나도'))],
                        "lock table workhub.message_threads in exclusive mode")
    check('K02 두 사람이 서로에게 동시에 첫 1:1 → 대화 1개, 순번 1·2',
          all(ok(o) for o in outs) and scalar("select count(*) from workhub.message_threads where direct_key = 'm-x141|m-x142'") == 1
          and sorted(data(o)['deliveries'][0]['sequence'] for o in outs) == [1, 2], outs)
    gnow = data(t[22].get(tg))['thread']
    outs = concurrently([lambda w=w: w.mutate(reply(data(w.get(tg))['thread'], w.member, f'동시 답장 {w.member}')) for w in (t[21], t[22], t[23], t24b)],
                        "lock table workhub.message_threads in exclusive mode")
    seqs = sorted(data(o)['deliveries'][0]['sequence'] for o in outs)
    check('K03 단체 대화 동시 답장 4건 → 순번 빈칸·중복 없이', all(ok(o) for o in outs) and seqs == list(range(gnow['latestSequence'] + 1, gnow['latestSequence'] + 5)), outs)
    nr = n1['items'][2]
    outs = concurrently([lambda: t[22].mutate({'kind': 'read_notice', 'noticeId': nr['id'], 'expectedVersion': 1}),
                         lambda: P(T[22], M[22]).mutate({'kind': 'read_notice', 'noticeId': nr['id'], 'expectedVersion': 1})],
                        "lock table workhub.notifications in exclusive mode")
    check('K04 같은 알림 동시 읽음(다른 번호) → 둘 다 성공 version 2', all(ok(o) and data(o)['version'] == 2 for o in outs), outs)

    # ======================================================================= L. 중간 강제 실패 → 원상태
    call(run, """create function public.p3_test_fail() returns trigger language plpgsql as $$
                 begin if new.body = '강제 실패' then raise exception 'P3_TEST_FAIL'; end if; return new; end $$""")
    call(run, "create trigger p3_test_fail before insert on workhub.messages for each row execute function public.p3_test_fail()")
    kf = key(); cf = start('individual', [rv(t[21], M[22]), rv(t[21], M[23])], '강제 실패')
    st = state()
    out = t[21].mutate(cf, kf)
    check('L01 메시지 기록 중 강제 실패 → 봉투 없는 오류, 대화·메시지·원장·감사 원상태', out == 'P3_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p3_test_fail on workhub.messages"); call(run, "drop function public.p3_test_fail()")
    check('L02 원인 제거 뒤 같은 번호 → 정상 반영(중복 없음)', ok(t[21].mutate(cf, kf)) and scalar("select count(*) from workhub.messages where request_key=%s", (kf,)) == 2)

    # ======================================================================= M. 보내는 사람 소속 · 학교 이동
    call(run, "update workhub.memberships set valid_to = %s where id='m-26'", (TODAY,))
    check('M01 보내는 사람 소속이 끝나면 → INACTIVE_MEMBERSHIP(봉투 없음)', P(T[26], M[26]).go('workhub_message_threads', '', False, None) == 'INACTIVE_MEMBERSHIP')
    th_26 = scalar("select id from workhub.message_threads where direct_key = 'm-25|m-26'")
    check('M02 끝난 사람과의 1:1 은 canSend=false', data(t[25].get(th_26))['thread']['canSend'] is False)
    call(run, "update workhub.memberships set valid_to = null where id='m-26'")

    # ======================================================================= N. 중지 · 재개(P2-80·81 재사용)
    sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'messaging', '2026-10-21 점검'))
    check('N01 중지 → 준비 disabled · 한도 null', data(t[21].readiness()) == {'available': False, 'reason': 'disabled', 'limits': None, 'attachments': 'not_configured'})
    check('N02 중지 → 조회·새 변경 NOT_READY', [ecode(t[21].threads()), ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], '중지 중')))] == ['NOT_READY'] * 2)
    check('N03 중지 중에도 미확정 요청 재조회(replay_only) → 처음 접수증', t[21].mutate(c1, k1, replay=True) == e1)
    check('N04 중지 중 같은 번호 다른 내용 → IDEMPOTENCY_CONFLICT(원장 대조가 먼저)', ecode(t[21].mutate({**c1, 'body': 'x'}, k1, replay=True)) == 'IDEMPOTENCY_CONFLICT')
    sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'messaging', '2026-10-21 점검 끝'))
    check('N05 재개 → ready', data(t[21].readiness())['reason'] == 'ready')

    # ======================================================================= O. 첨부(HWPX) — P3-05 · 예약 · 업로드 · 기본 확인 · 첨부 · 내려받기
    p5 = os.path.join(S, 'P3-05_첨부활성화_양식.sql')
    check('O01 빈 칸이 남은 P3-05 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P3-05_첨부활성화_양식.sql')))
    fgood = {'approver_user_id': U1, 'approval_ref': '2026-10-22 첨부 시범 승인', 'max_file_bytes': 200000, 'max_files': 3,
             'verification_ref': 'vercel dpl_test · 2026-10-22 check-hwpx 401 확인'}
    check('O02 크기 상한 30MiB 초과 → 멈춤', '한도는' in sqlerr(fill_json(p5, {**fgood, 'max_file_bytes': 31457281})))
    check('O03 확인 기록 빈칸 → 멈춤', '배포 확인 기록은 1~200자' in sqlerr(fill_json(p5, {**fgood, 'verification_ref': ''})))
    sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'messaging', '첨부 전 시험'))
    check('O04 메시지가 중지 중이면 P3-05 멈춤', '메시지가 켜져 있지 않습니다' in sqlerr(fill_json(p5, fgood)))
    sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'messaging', '첨부 전 시험 끝'))
    check('O05 P3-05 정상 실행', sqlerr(fill_json(p5, fgood)) == 'OK')
    fr = t[21].file_readiness()
    check('O06 첨부 준비 ready · 정책 = 앱 hwpx 정책 모양', data(fr) == {'available': True, 'reason': 'ready',
          'policy': {'extensions': ['hwpx'], 'maxFileBytes': 200000, 'maxFiles': 3}}, fr)
    check('O07 메시지 준비의 attachments = hwpx_basic_v1', data(t[21].readiness())['attachments'] == 'hwpx_basic_v1')

    raw_a = hwpx('평가계획 A')
    st = state()
    check('O08 이름 규칙: 확장자·경로 문자·앞뒤 공백·방향 제어·예약 이름·240바이트 → INVALID_INPUT',
          [ecode(t[21].prepare(meta(n, raw_a))) for n in ('a.hwp', 'a/b.hwpx', ' a.hwpx', 'a‮.hwpx', 'con.hwpx', '가' * 79 + '.hwpx', '.hwpx', '..hwpx')]
          == ['INVALID_INPUT'] * 8)
    check('O09 신고 크기가 학교 정책(200000) 초과 → INVALID_INPUT', ecode(t[21].prepare({'name': 'a.hwpx', 'claimedBytes': 200001, 'claimedSha256': sha(b'x')})) == 'INVALID_INPUT')
    check('O10 거절된 예약은 아무것도 쓰지 않음', state() == st)
    kp = key(); m_a = meta('평가계획 A.hwpx', raw_a)
    ia = t[21].prepare(m_a, kp, raw=raw_a); ia_d = data(ia)
    check('O11 예약 → {fileId, 전용 버킷, 학교/소속/파일/original.hwpx, 만료, awaiting_upload}', ok(ia) and ia_d['bucket'] == BUCKET
          and ia_d['path'] == f"{s1}/m-21/{ia_d['fileId']}/original.hwpx" and ia_d['state'] == 'awaiting_upload', ia)
    check('O12 같은 번호·같은 신고값 → 같은 예약', t[21].prepare(m_a, kp, raw=raw_a) == ia)
    check('O13 같은 번호·다른 신고값 → IDEMPOTENCY_CONFLICT', ecode(t[21].prepare(meta('평가계획 A.hwpx', hwpx('다른')), kp, raw=hwpx('다른'))) == 'IDEMPOTENCY_CONFLICT')
    check('O14 replay_only + 있는 번호 → 같은 예약 · 없는 번호 → NOT_FOUND', t[21].prepare(m_a, kp, replay=True, raw=raw_a) == ia
          and ecode(t[21].prepare(m_a, key(), replay=True, raw=raw_a)) == 'NOT_FOUND')
    fa = ia_d['fileId']; kc = key()
    s_a = t[21].complete(fa, kc)
    check('O15 실물 없이 complete → awaiting_upload(성공으로 고정하지 않음)', data(s_a) == {'fileId': fa, 'state': 'awaiting_upload', 'storageObjectId': None, 'file': None}, s_a)
    check('O16 남이 그 경로에 업로드 → 거부', put_object(T[22], ia_d['path'], raw_a) != 'OK')
    check('O17 서명 URL 업로드 요청 종류 → 거부', put_object(T[21], ia_d['path'], raw_a, op='storage.object.sign_upload_url') != 'OK')
    check('O18 예약하지 않은 경로 → 거부', put_object(T[21], f"{s1}/m-21/other/original.hwpx", raw_a) != 'OK')
    check('O19 수합 버킷 경로로는 메시지 파일을 올릴 수 없음(다른 원장)', err(storage_conn(T[21], UP),
          "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values ('workhub-collection-files',%s,%s::uuid,%s,'{}')", (ia_d['path'], T[21], T[21])) != 'OK')
    check('O20 본인 업로드 → 통과', put_object(T[21], ia_d['path'], raw_a) == 'OK')
    check('O21 같은 경로 다시 업로드(덮어쓰기) → 거부', put_object(T[21], ia_d['path'], hwpx('바꿔치기')) != 'OK' and STORE[ia_d['path']] == raw_a)
    s_b = t[21].complete(fa, kc)
    check('O22 같은 complete 번호로 다시 → pending_basic · 실물 id 고정', data(s_b)['state'] == 'pending_basic' and data(s_b)['storageObjectId'] is not None, s_b)
    check('O23 complete 번호를 다른 파일에 → IDEMPOTENCY_CONFLICT', ecode(t[21].complete('other-file', kc)) == 'IDEMPOTENCY_CONFLICT')
    check('O24 남의 파일 complete·상태 → NOT_FOUND', ecode(t[22].complete(fa, key())) == 'NOT_FOUND' and ecode(t[22].status(fa)) == 'NOT_FOUND')
    # 서버 확인(service_role) — claim · finish 직접
    cl = t[21].claim(fa, kc); cd = data(cl)
    check('O25 claim → 임대(token 64자 · 90초 · 전용 경로 · 신고값 · 정책 상한 · 실물 id)', ok(cl) and cd['state'] == 'checking' and len(cd['leaseToken']) == 64
          and cd['path'] == ia_d['path'] and cd['maxFileBytes'] == 200000 and cd['storageObjectId'] == data(s_b)['storageObjectId']
          and cd['claimedSha256'] == sha(raw_a) and cl['userId'] == T[21], cl)
    check('O26 임대 중 다시 claim → {checking, leaseToken:null} 만', data(t[21].claim(fa, kc)) == {'fileId': fa, 'state': 'checking', 'leaseToken': None})
    check('O27 claim: complete 하지 않은 번호 → NOT_FOUND · 다른 파일 번호 → IDEMPOTENCY_CONFLICT',
          ecode(t[21].claim(fa, key())) == 'NOT_FOUND' and ecode(t[21].claim('zzz', kc)) == 'IDEMPOTENCY_CONFLICT')
    check('O28 claim: 다른 사람 UID 로 → INACTIVE_MEMBERSHIP(소속 확인 실패)', t[21].claim(fa, kc, actor=T[22]) == 'INACTIVE_MEMBERSHIP')
    check('O29 claim: 사람 JWT 를 실은 service 호출 → FORBIDDEN', err(api(T[21], 'service_role'),
          "select public.workhub_message_file_basic_claim(%s::uuid,'m-21',%s,%s)", (T[21], fa, kc)) == 'FORBIDDEN')
    good_res = {'profile': 'hwpx_basic_v1', 'accepted': True, 'actualBytes': len(raw_a), 'actualSha256': sha(raw_a), 'reasonCode': None}
    bads = [{**good_res, 'extra': 1}, {**good_res, 'profile': 'x'}, {**good_res, 'actualBytes': len(raw_a) + 1}, {**good_res, 'reasonCode': 'FILE_ENCRYPTED'},
            {**good_res, 'accepted': False}, {**good_res, 'accepted': False, 'reasonCode': 'FILE_SIZE_LIMIT'},
            {**good_res, 'accepted': False, 'reasonCode': 'FILE_HASH_MISMATCH'}, {**good_res, 'malwareScan': 'clean'}]
    check('O30 finish 결과 모양·앞뒤가 맞지 않으면 INVALID_INPUT(악성코드 항목 같은 다른 필드도 거부)',
          [ecode(t[21].finish(fa, kc, cd['leaseToken'], cd['storageObjectId'], b)) for b in bads] == ['INVALID_INPUT'] * len(bads))
    check('O31 finish: 다른 token → CONFLICT · 다른 실물 id → CONFLICT',
          ecode(t[21].finish(fa, kc, 'f' * 64, cd['storageObjectId'], good_res)) == 'CONFLICT'
          and ecode(t[21].finish(fa, kc, cd['leaseToken'], str(uuid.uuid4()), good_res)) == 'CONFLICT')
    fin = t[21].finish(fa, kc, cd['leaseToken'], cd['storageObjectId'], good_res)
    check('O32 finish → ready · 첨부 정보(id·이름·실제 크기·SHA·hwpx_basic_v1)', data(fin) == {'fileId': fa, 'state': 'ready', 'storageObjectId': cd['storageObjectId'],
          'file': {'id': fa, 'name': '평가계획 A.hwpx', 'bytes': len(raw_a), 'sha256': sha(raw_a), 'profile': 'hwpx_basic_v1'}}, fin)
    check('O33 같은 임대·같은 결과 재전송 → 같은 상태 · 다른 결과 → CONFLICT', t[21].finish(fa, kc, cd['leaseToken'], cd['storageObjectId'], good_res) == fin
          and ecode(t[21].finish(fa, kc, cd['leaseToken'], cd['storageObjectId'], {**good_res, 'accepted': False, 'reasonCode': 'FILE_STRUCTURE_INVALID'})) == 'CONFLICT')
    check('O34 ready 뒤 claim → FileStatus(ready) 그대로', data(t[21].claim(fa, kc)) == data(fin))
    check('O35 확인 결과는 DB 에서 직접 바꿀 수 없음', 'P3_FILE_IMMUTABLE' in sqlerr(f"update workhub.message_files set state='rejected', reject_code='x' where id='{fa}'"))
    check('O36 감사 기록에 악성코드 검사 완료 주장 없음(malware_scan=false)', scalar(
        "select bool_and((details->>'malware_scan')::boolean is false) from workhub.audit_events where operation='message_file.basic_check' and resource_id=%s", (fa,)) is True)

    # 실제 wrapper(check_file)로 왕복
    raw_b = hwpx('주간 계획 B')
    fb = send_file(t[21], '주간 계획 B.hwpx', raw_b)
    check('O37 [wrapper] PR #48 check_file: claim → 실물 내려받기 → 기본 확인 → finish → ready', isinstance(fb['check'], dict) and fb['check']['data']['state'] == 'ready'
          and fb['check']['data']['file']['sha256'] == sha(raw_b), fb['check'])
    raw_bad = hwpx('구조 불량', b'')[:-30] + b'\x00' * 30
    fbad = send_file(t[21], '깨진 파일.hwpx', raw_bad)
    check('O38 [wrapper] 구조가 깨진 HWPX → rejected(사유 코드 기록)', isinstance(fbad['check'], dict) and fbad['check']['data']['state'] == 'rejected'
          and scalar('select reject_code from workhub.message_files where id=%s', (fbad['id'],)) in ('FILE_STRUCTURE_INVALID', 'FILE_SIGNATURE_MISMATCH'), fbad['check'])
    raw_c = hwpx('짧게 받음 C')
    fc = send_file(t[21], '짧게 받음 C.hwpx', raw_c, check_now=False)
    out_c, calls_c = wrapper(t[21], fc['id'], fc['kc'], truncate=len(raw_c) - 10)
    check('O39 [wrapper] 내려받기가 짧게 끊김 → RESULT_UNKNOWN, finish 없음, 파일은 pending_basic 유지(영구 거절 아님)',
          out_c == ('ERR', 'RESULT_UNKNOWN') and [n for n, _ in calls_c] == ['workhub_message_file_basic_claim']
          and scalar('select state from workhub.message_files where id=%s', (fc['id'],)) == 'pending_basic', (out_c, calls_c))
    out_c2, _ = wrapper(t[21], fc['id'], fc['kc'])
    check('O40 [wrapper] 임대가 남아 있으면 두 번째 실행은 pending_basic 만 돌려줌(내려받지 않음)', isinstance(out_c2, dict) and out_c2['data'] == {
          'fileId': fc['id'], 'state': 'pending_basic', 'storageObjectId': None, 'file': None}, out_c2)
    # 90초 기다리는 대신 임대 만료 시각만 과거로(만료 시각은 기록 뒤 못 바꾸게 막혀 있어 트리거를 잠시 끄고)
    sqlfile(None, "supabase_admin", text=f"set session_replication_role = replica; update workhub.message_file_leases set expires_at = clock_timestamp() - interval '1 second' where file_id='{fc['id']}' and state='issued'")
    out_c3, _ = wrapper(t[21], fc['id'], fc['kc'])
    check('O41 [wrapper] 임대가 끝난 뒤 다시 → 정상 확인 ready', isinstance(out_c3, dict) and out_c3['data']['state'] == 'ready', out_c3)
    # 실물 바꿔치기(서비스 키·대시보드로 삭제 후 다시 올림) → claim 이 거절로 고정
    raw_d = hwpx('바꿔치기 D')
    fd = send_file(t[21], '바꿔치기 D.hwpx', raw_d, check_now=False)
    call(run, "delete from storage.objects where bucket_id=%s and name=%s", (BUCKET, fd['path']))
    call(run, "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values (%s,%s,%s::uuid,%s,%s::jsonb)", (BUCKET, fd['path'], T[21], T[21], json.dumps({'size': len(raw_d)})))
    od, _ = wrapper(t[21], fd['id'], fd['kc'])
    check('O42 complete 뒤 실물이 바뀜(object id 다름) → rejected object_changed, 내려받지 않음', isinstance(od, dict) and od['data']['state'] == 'rejected'
          and scalar('select reject_code from workhub.message_files where id=%s', (fd['id'],)) == 'object_changed', od)
    raw_e = hwpx('크기 다름 E')
    ke = key()
    ie = data(t[21].prepare(meta('크기 다름 E.hwpx', raw_e), ke, raw=raw_e))
    put_object(T[21], ie['path'], raw_e, size=len(raw_e) + 5)
    check('O43 Storage 가 기록한 크기 ≠ 신고값 → complete 에서 rejected(object_size_mismatch)', data(t[21].complete(ie['fileId'], key()))['state'] == 'rejected'
          and scalar('select reject_code from workhub.message_files where id=%s', (ie['fileId'],)) == 'object_size_mismatch')
    raw_f = hwpx('만료 F')
    kf = key()
    i_f = data(t[21].prepare(meta('만료 F.hwpx', raw_f), kf, raw=raw_f))
    call(run, "alter table workhub.message_files disable trigger message_files_guard")
    call(run, "update workhub.message_files set upload_expires_at = clock_timestamp() - interval '1 second' where id=%s", (i_f['fileId'],))
    call(run, "alter table workhub.message_files enable trigger message_files_guard")
    check('O44 기한 지난 예약 경로로 업로드 → 거부', put_object(T[21], i_f['path'], raw_f) != 'OK')
    check('O45 기한 지난 예약: 상태 rejected 로 보이고 complete 가 upload_expired 로 고정 · 그 예약 재조회는 CONFLICT',
          data(t[21].status(i_f['fileId']))['state'] == 'rejected' and data(t[21].complete(i_f['fileId'], key()))['state'] == 'rejected'
          and scalar('select reject_code from workhub.message_files where id=%s', (i_f['fileId'],)) == 'upload_expired')

    # prepare 의 CONFLICT = "이 요청 번호로 만든 예약이 끝났다(rejected)" — 앱이 이것만 보고 "새로 첨부해 주세요"로 바꿔도 되는지(Codex C5).
    # 같은 번호 · 같은 내용일 때만 나온다(내용이 다르면 IDEMPOTENCY_CONFLICT 가 먼저). 다른 RPC 의 CONFLICT · 시간 초과에는 이 뜻이 없다.
    for nm, who_k, f_meta, fid, why in [
        ('기본 확인 거절', fbad['kp'], meta('깨진 파일.hwpx', raw_bad), fbad['id'], scalar('select reject_code from workhub.message_files where id=%s', (fbad['id'],))),
        ('실물 바뀜', fd['kp'], meta('바꿔치기 D.hwpx', raw_d), fd['id'], 'object_changed'),
        ('Storage 크기 다름', ke, meta('크기 다름 E.hwpx', raw_e), ie['fileId'], 'object_size_mismatch'),
        ('업로드 기한 지남', kf, meta('만료 F.hwpx', raw_f), i_f['fileId'], 'upload_expired')]:
        r_on, r_off = t[21].prepare(f_meta, who_k, replay=True), t[21].prepare(f_meta, who_k, replay=False)
        check(f'O45c 끝난 예약({nm} · {why}) 같은 번호 재조회 → replay_only 참 · 거짓 모두 CONFLICT, 상태 조회는 rejected, 새 예약 안 생김',
              ecode(r_on) == 'CONFLICT' and ecode(r_off) == 'CONFLICT' and data(t[21].status(fid))['state'] == 'rejected'
              and scalar("select count(*) from workhub.message_file_requests where action='prepare' and request_key=%s", (who_k,)) == 1, (r_on, r_off))
    r_idem = t[21].prepare({**meta('만료 F.hwpx', raw_f), 'name': '만료 F2.hwpx'}, kf, replay=True)
    check('O45d 끝난 예약 번호 + 다른 내용 → IDEMPOTENCY_CONFLICT(CONFLICT 아님 — 끝난 예약 뜻으로 읽으면 안 됨)', ecode(r_idem) == 'IDEMPOTENCY_CONFLICT', r_idem)
    r_new = t[21].prepare(meta('만료 F.hwpx', raw_f), key(), raw=raw_f)
    check('O45e 같은 파일을 새 요청 번호로 다시 첨부 → 새 예약(awaiting_upload, 다른 fileId)', ok(r_new) and data(r_new)['state'] == 'awaiting_upload'
          and data(r_new)['fileId'] != i_f['fileId'], r_new)

    # 첨부해서 보내기
    th_a = None
    ea = t[21].mutate(start('direct', [rv(t[21], M[23])], '', files=[fa]))
    check('O46 빈 본문 + ready 첨부 → 전송, 메시지에 첨부 정보', ok(ea) and data(t[23].get(data(ea)['deliveries'][0]['threadId']))['items'][-1]['attachments'][0]['id'] == fa, ea)
    th_a = data(ea)['deliveries'][0]['threadId']; msg_a = data(ea)['deliveries'][0]['messageId']
    check('O47 같은 파일을 다른 전송에 다시 붙임 → CONFLICT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'x', files=[fa]))) == 'CONFLICT')
    check('O48 남의 파일·없는 파일 id → NOT_FOUND', ecode(t[22].mutate(start('direct', [rv(t[22], M[23])], 'x', files=[fb['id']]))) == 'NOT_FOUND'
          and ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'x', files=['nope']))) == 'NOT_FOUND')
    check('O49 ready 아닌 파일(rejected·pending) → CONFLICT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'x', files=[fbad['id']]))) == 'CONFLICT')
    check('O50 학교 정책 파일 수(3) 초과 → INVALID_INPUT', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'x', files=['a1', 'a2', 'a3', 'a4']))) == 'INVALID_INPUT')
    ac = t[23].access(th_a, msg_a, fa, raw=raw_a)
    check('O51 받는 사람 내려받기 위치 → 전용 버킷·올린 사람 경로·실물 id(URL 없음)', ok(ac) and data(ac)['path'] == ia_d['path'] and data(ac)['ownerMemberId'] == M[21]
          and data(ac)['storageObjectId'] == cd['storageObjectId'] and 'url' not in json.dumps(data(ac)).lower(), ac)
    check('O52 대화 참여자 아님 → NOT_FOUND · 다른 메시지 id 로 → NOT_FOUND', ecode(t[22].access(th_a, msg_a, fa)) == 'NOT_FOUND'
          and ecode(t[23].access(th_a, data(e1)['deliveries'][0]['messageId'], fa)) == 'NOT_FOUND')
    check('O53 Storage 직접 읽기: 받는 사람·올린 사람 가능, 참여자 아님·서명 URL·목록 요청 불가',
          can_read(T[23], ia_d['path']) and can_read(T[21], ia_d['path']) and not can_read(T[22], ia_d['path'])
          and not can_read(T[23], ia_d['path'], op='storage.object.sign') and not can_read(T[23], ia_d['path'], op=None))
    check('O54 보내지 않은 ready 파일은 올린 사람만 읽음', can_read(T[21], fb['path']) and not can_read(T[23], fb['path']))
    ki = key(); cia = start('individual', [rv(t[21], M[22]), rv(t[21], M[24])], '개별 첨부', files=[fb['id']])
    ei2 = t[21].mutate(cia, ki)
    check('O55 개별 전송 첨부: 같은 파일이 받는 사람별 메시지에 각각 연결, 각자만 읽음',
          ok(ei2) and scalar("select count(*) from workhub.message_attachments where file_id=%s", (fb['id'],)) == 2
          and can_read(T[22], fb['path']) and can_read(T[24], fb['path']) and not can_read(T[23], fb['path']), ei2)
    acs = [t[21].access(th_a, msg_a, fa, raw=raw_a)] + [(t[22] if d['recipientMemberIds'] == [M[22]] else t[24]).access(d['threadId'], d['messageId'], fb['id'], raw=fb['raw'])
                                                      for d in (data(ei2) or {}).get('deliveries', [])]
    check('O55b 올린 사람·개별 전송 받는 사람 각자 내려받기 위치를 받음(같은 파일, 각자 다른 대화·메시지)', len(acs) == 3 and all(ok(a) for a in acs)
          and len({data(a)['threadId'] for a in acs[1:]}) == 2 and {data(a)['path'] for a in acs[1:]} == {fb['path']}, acs)
    call(run, "update public.users set role='teacher' where id=%s", (T[23],))
    check('O56 받는 사람이 자격을 잃으면 Storage 직접 읽기도 막힘', not can_read(T[23], ia_d['path']))
    call(run, "update public.users set role='superadmin' where id=%s", (T[23],))
    sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'message_files', '첨부 점검'))
    check('O57 첨부 중지 → 준비 disabled · 메시지 attachments not_configured · 예약·내려받기 NOT_READY · Storage 읽기 불가',
          data(t[21].file_readiness())['reason'] == 'disabled' and data(t[21].readiness())['attachments'] == 'not_configured'
          and ecode(t[21].prepare(meta('x.hwpx', raw_a))) == 'NOT_READY' and ecode(t[23].access(th_a, msg_a, fa)) == 'NOT_READY' and not can_read(T[23], ia_d['path']))
    rp58, st58 = t[21].prepare(m_a, kp, replay=True, raw=raw_a), t[21].status(fa)
    check('O58 첨부 중지 중에도 예약 재조회(replay_only, 지금 상태 ready 로)·상태 조회는 됨', ok(rp58) and {**data(rp58), 'state': 'x'} == {**ia_d, 'state': 'x'} and data(rp58)['state'] == 'ready' and data(st58)['state'] == 'ready', (rp58, ia, st58))
    check('O59 첨부 중지 중 첨부 전송 → NOT_READY, 첨부 없는 메시지는 계속', ecode(t[21].mutate(start('direct', [rv(t[21], M[22])], 'x', files=['f1']))) == 'NOT_READY'
          and ok(t[21].mutate(start('direct', [rv(t[21], M[22])], '첨부 없이'))))
    sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'message_files', '첨부 점검 끝'))
    check('O60 첨부 재개 → ready, 내려받기 다시 가능', data(t[21].file_readiness())['reason'] == 'ready' and can_read(T[23], ia_d['path']))
    # Storage 정책을 누가 넓히면 첨부 준비가 storage_missing 으로 내려간다
    call(run, "create policy p3_test_open on storage.objects for select to authenticated using (true)")
    check('O61 메시지 버킷을 여는 다른 정책이 생기면 첨부 준비 storage_missing', data(t[21].file_readiness())['reason'] == 'storage_missing')
    call(run, "drop policy p3_test_open on storage.objects")
    check('O62 정책을 되돌리면 다시 ready', data(t[21].file_readiness())['reason'] == 'ready')

    # ======================================================================= P. 두 학교 · 사후 점검
    check('P01 다른 학교(m-27 의 학교)에는 메시지·파일이 하나도 없음', scalar("select count(*) from workhub.message_threads t join workhub.memberships m on m.school_id=t.school_id where m.id=%s", (M[27],)) == 0
          and scalar("select count(*) from workhub.message_files f join workhub.memberships m on m.school_id=f.school_id where m.id=%s", (M[27],)) == 0
          and scalar("select count(distinct school_id) from workhub.memberships where id in (%s,%s)", (M[21], M[27])) == 2
          and data(t[27].file_readiness())['reason'] == 'verification_missing')
    post = sqlfile('P3-03_사후점검.sql')
    check('P02 P3-03 사후 점검 FAIL 없음(순번 빈칸 없음 · 참여자 수 · 첨부 상태 · 원장 = 메시지 묶음)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] == 'FAIL'])
    after2 = fingerprint()
    check('P03 사용 뒤에도 P3 밖 구조 지문(S1~S6) 같음', [r for r in before if r[1] != 'D1 기존 표 행 수·행 해시'] == [r for r in after2 if r[1] != 'D1 기존 표 행 수·행 해시'])

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == '__main__':
    main()
