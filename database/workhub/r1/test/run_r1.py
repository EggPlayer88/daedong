# R1 수합 정상·거부 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator 로그인 → set role → request.jwt.claims)로 부른다.
# Storage 는 storage.objects 행 INSERT/SELECT 로 RLS 판정만 흉내 낸다(실제 Storage API·파일 본문은 미실행).
import datetime, hashlib, json, os, re, sys, threading, uuid
from zoneinfo import ZoneInfo
import psycopg2

HOST = os.environ['R0_PGHOST']; PORT = int(os.environ.get('R0_PG_PORT', '55433')); DB = 'r0'
R1_DIR = os.environ['R1_DIR']; OUT = os.environ.get('R1_CAPTURE', '')
U1 = '00000000-0000-0000-0000-000000000001'   # 첫 관리자(R0-03 연결, school_admin) — 수합 관리자
U2 = '00000000-0000-0000-0000-000000000002'   # 일반 교사(legacy teacher) — 공개 대상 아님
T = {n: f'00000000-0000-0000-0000-0000000000{n}' for n in range(21, 29)}
# 21 A단위 책임자 · 22 A단위 공동 · 23 B단위 책임자 · 24 지정 검토자 · 25 무검토 수합 책임자 · 26 B단위 공동 · 27 다른 학교 · 28 소속 끝남
M = {n: f'm-{n}' for n in range(21, 29)}
TODAY = datetime.datetime.now(ZoneInfo('Asia/Seoul')).date()
results = []; captures = []

def admin(user='supabase_admin'):
    c = psycopg2.connect(host=HOST, port=PORT, dbname=DB, user=user); c.autocommit = True; return c

def api(uid=None, role='authenticated'):
    c = psycopg2.connect(host=HOST, port=PORT, dbname=DB, user='authenticator'); c.autocommit = True
    cur = c.cursor(); cur.execute(f'set role {role}')
    claims = {'role': role}
    if uid: claims['sub'] = uid
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    return c

def call(conn, sql, args=()):
    cur = conn.cursor(); cur.execute(sql, args or None)
    if cur.description is None: return None
    row = cur.fetchone(); return row[0] if row else None

def err(conn, sql, args=()):
    try:
        call(conn, sql, args); return 'OK'
    except psycopg2.Error as e:
        return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)

def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -- {str(info)[:400]}'))

def scalar(sql, args=()):
    a = admin(); v = call(a, sql, args); a.close(); return v

def key(): return 'k-' + uuid.uuid4().hex

class Who:
    """한 교사의 API 연결. rpc 는 봉투를 그대로 돌려주고, 앱 계약 검사용으로 기록한다."""
    def __init__(self, uid, member):
        self.uid, self.member, self.c = uid, member, api(uid)
        self.school = scalar('select school_id from workhub.memberships where id=%s', (member,))
    def rpc(self, fn, *args, kind=None, extra=None):
        ph = ','.join(['%s'] * (len(args) + 1))
        conv = [json.dumps(a) if isinstance(a, (dict, list)) else a for a in args]
        sql = f'select public.{fn}({ph})'
        v = call(self.c, sql, (self.member, *conv))
        if kind and OUT:
            captures.append({'kind': kind, 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid}, 'raw': v, **(extra or {})})
        return v
    def mutate(self, cmd, k=None, kind='receipt'):
        k = k or key()
        return self.rpc('workhub_collection_mutate', cmd, k, kind=kind, extra={'key': k})

def data(env): return env.get('data') if isinstance(env, dict) else None
def code(env): return (env.get('error') or {}).get('code') if isinstance(env, dict) else env

R1_TABLES = ['collections','collection_reviewers','collection_schemas','collection_fields','collection_plan_units','collection_plan_unit_members',
  'collection_file_intents','collection_template_files','collection_units','collection_unit_members','unit_drafts','unit_draft_files',
  'submission_versions','submission_files','submission_reviews','correction_requests','submission_withdrawals',
  'collection_correction_fulfillments','correction_windows','file_objects','file_verification_jobs','file_access_grants','deletion_ledger',
  'idempotency_receipts','audit_events','outbox']
def counts():
    parts = ','.join(f"'{t}',(select count(*) from workhub.{t})" for t in R1_TABLES)
    return scalar(f"select jsonb_build_object({parts}, 'objects', (select count(*) from storage.objects))")

def fixtures():
    a = admin(); cur = a.cursor()
    ids = ','.join(f"('{T[n]}','t{n}@x.kr','{{\"full_name\":\"교사{n}\"}}')" for n in T)
    cur.execute(f"insert into auth.users(id,email,raw_user_meta_data) values {ids}")
    cur.execute("update public.users set role='superadmin', is_active=true where id = any(%s)", ([T[n] for n in T],))
    cur.execute("""insert into workhub.accounts(id, auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at, display_name, email, legacy_approval_state)
                   select 'acc-'||right(id,2), id::uuid, id, 'same_auth_user', now(), name, email, 'approved' from public.users where id = any(%s)""", ([T[n] for n in T],))
    cur.execute("insert into workhub.schools(id, code, name, school_level, grade_count, status) values ('school-2','other-ms','다른중학교','middle',3,'active')")
    s1 = call(a, "select id from workhub.schools where code='daedong-ms'")
    start = call(a, "select min(starts_on) from workhub.academic_years where school_id=%s", (s1,))
    for n in T:
        school = 'school-2' if n == 27 else s1
        vto = TODAY.isoformat() if n == 28 else None
        cur.execute("""insert into workhub.memberships(id, school_id, account_id, status, employment_type, valid_from, valid_to, decided_at)
                       values (%s,%s,%s,'active','teacher',%s,%s,now())""", (M[n], school, f'acc-{n}', start, vto))
    a.close()
    return s1

def fill_json(path, values):
    text = open(path, encoding='utf-8').read()
    body = json.dumps(values, ensure_ascii=False)
    new, n = re.subn(r'\$json\$\n\{.*?\n\}\n\$json\$', lambda m: '$json$' + body + '$json$', text, flags=re.S)
    assert n == 1, path
    return new

def run_sql(sql, user='postgres'):
    a = admin(user); cur = a.cursor(); cur.execute(sql); a.close()

def sha(b): return hashlib.sha256(b).hexdigest()
def blob(tag, size=1000):
    raw = (tag.encode() * (size // len(tag) + 1))[:size]; return {'bytes': size, 'sha256': sha(raw)}

def coll_input(**kw):
    d = {'title': '2학기 수업 보고', 'instructions': '양식에 맞춰 올려 주세요.', 'dueDate': (TODAY + datetime.timedelta(days=7)).isoformat(),
         'reviewMode': 'required', 'reviewerMemberId': M[24], 'textLabel': '보고 내용', 'textRequired': True, 'numberLabel': '건수',
         'numberRequired': False,
         'units': [{'label': '1학년', 'responsibleMemberId': M[21], 'contributorMemberIds': [M[22]]},
                   {'label': '2학년', 'responsibleMemberId': M[23], 'contributorMemberIds': [M[26]]}],
         'fileCollection': {'policy': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 5000000, 'maxFiles': 3}, 'required': False, 'templates': []}}
    d.update(kw); return d

def upload_object(uid, path):
    c = api(uid); r = err(c, "insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values ('workhub-collection-files',%s,%s::uuid,%s,'{}')", (path, uid, uid)); c.close(); return r

def can_read_object(uid, path):
    c = api(uid); n = call(c, "select count(*) from storage.objects where bucket_id='workhub-collection-files' and name=%s", (path,)); c.close(); return n == 1

WORKER = None
def worker_call(fn, *args):
    return call(WORKER, f"select public.{fn}({','.join(['%s']*len(args))})", tuple(json.dumps(a) if isinstance(a, (dict, list)) else a for a in args))

def ready_result(f, **kw):
    r = {'outcome': 'ready', 'sizeBytes': f['bytes'], 'sha256': f['sha256'], 'detectedMime': 'application/pdf', 'expandedBytes': None,
         'scanState': 'clean', 'rejectReason': None,
         'checks': {'size': True, 'sha256': True, 'signature': True, 'container': True, 'encryption': True, 'malware': True}}
    r.update(kw); return r

def verify_all(school, outcomes=None):
    """대기 중인 검증 작업을 모두 인수해 봉인한다. outcomes: fileId → 결과 dict(없으면 신고값과 같은 ready)"""
    outcomes = outcomes or {}
    jobs = worker_call('workhub_file_worker_claim', school, 'w1', 20)
    for j in jobs:
        res = outcomes.get(j['fileId']) or ready_result({'bytes': j['claimedBytes'], 'sha256': j['claimedSha256']})
        worker_call('workhub_file_worker_seal', j['jobId'], j['leaseToken'], j['fileId'], j['path'], j['storageObjectId'], res)
    return jobs

def upload_file(who, parent, name, f, verify=True, school=None):
    """prepare → Storage INSERT → complete → (검증) → 상태. FileReference 를 돌려준다."""
    ext = name.rsplit('.', 1)[1]
    up = data(who.rpc('workhub_file_prepare', parent, {'name': name, 'extension': ext, 'claimedBytes': f['bytes'], 'claimedSha256': f['sha256']}, key(), kind='upload'))
    assert up, name
    assert upload_object(who.uid, up['path']) == 'OK', up
    st = data(who.rpc('workhub_file_complete', up['fileId'], key(), kind='status', extra={'fileId': up['fileId']}))
    if verify:
        verify_all(school or who.school)
        st = data(who.rpc('workhub_file_status', up['fileId'], kind='status', extra={'fileId': up['fileId']}))
    return up, st

def main():
    global WORKER
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    adm = Who(U1, m1); t21, t22, t23, t24, t25, t26 = (Who(T[n], M[n]) for n in (21, 22, 23, 24, 25, 26))

    # ======================================================================= 접근 경계
    c = api(None, 'anon')
    check('A01 anon 은 수합 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_collection_readiness('x')"))
    c = api(None)
    check('A02 로그인 없는 authenticated → FORBIDDEN(봉투 없음, R0 경로)', err(c, "select public.workhub_collection_readiness('x')") == 'FORBIDDEN')
    c = api(U2)
    check('A03 superadmin 이 아닌 교사 → FORBIDDEN', err(c, "select public.workhub_collection_list('m-02', null)") == 'FORBIDDEN')
    c = api(U1)
    check('A04 남의 소속 ID(다른 학교 m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_collection_list(%s, null)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('A05 authenticated 는 작업자 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_file_worker_claim('x','w',1)"))
    check('A06 authenticated 는 workhub 표 직접 읽기 불가', 'permission denied' in err(c, 'select * from workhub.file_objects'))
    check('A07 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.c_switch()"))
    c = api(None, 'service_role')
    check('A08 service_role 은 사람용 수합 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_collection_readiness('x')"))
    check('A09 service_role 이어도 작업자 연결(R1-05) 전에는 작업자 함수 FORBIDDEN', err(c, "select public.workhub_file_worker_claim(%s,'w',1)", (s1,)) == 'FORBIDDEN')
    c = api(U1, 'service_role')
    check('A10 사람 JWT(sub) 가 실린 service_role 호출은 작업자로 인정하지 않음', err(c, "select public.workhub_file_worker_claim(%s,'w',1)", (s1,)) == 'FORBIDDEN')

    # ======================================================================= 준비 상태(SQL 만 적용)
    r = adm.rpc('workhub_collection_readiness', kind='readiness')
    check('B01 SQL 만 적용 → available=false, verification_missing, policy=null',
          r['data'] == {'available': False, 'reason': 'verification_missing', 'policy': None} and r['schoolId'] == s1 and r['memberId'] == m1, r)
    before = counts()
    e = adm.mutate({'kind': 'create', 'input': coll_input()})
    check('B02 준비 전 create → NOT_READY 봉투, 변경 0건', code(e) == 'NOT_READY' and counts() == before, e)
    check('B03 준비 전에도 목록은 빈 목록(오류와 구별)', data(adm.rpc('workhub_collection_list', None, kind='list')) == {'items': [], 'nextCursor': None})

    # 정책·작업자 연결(시험 값). 운영 값이 아니다.
    run_sql(fill_json(f'{R1_DIR}/R1-06_정책게시_양식.sql', {
        'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'effective_from': (TODAY - datetime.timedelta(days=1)).isoformat(),
        'common_file_safety': {'extensions': ['pdf', 'hwpx', 'docx', 'xlsx'], 'maxFileBytes': 10000000, 'maxFiles': 5, 'allowUnscanned': False},
        'school_file_upload': {'extensions': ['pdf', 'hwp', 'hwpx', 'docx'], 'maxFileBytes': 8000000, 'maxFiles': 4, 'allowUnscanned': False, 'uploadTtlMinutes': 30},
        'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 14, 'unattachedRetentionDays': 7}}))
    check('B04 정책 게시 후에도 작업자 없으면 verification_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    check('B05 R1-06 을 다시 실행하면 겹침 제약으로 멈춤', 'policy_versions_no_overlap' in err(admin('postgres'), fill_json(f'{R1_DIR}/R1-06_정책게시_양식.sql', {
        'approver_user_id': U1, 'approval_ref': 'x', 'effective_from': TODAY.isoformat(),
        'common_file_safety': {'extensions': ['pdf'], 'maxFileBytes': 1, 'maxFiles': 1, 'allowUnscanned': False},
        'school_file_upload': {'extensions': ['pdf'], 'maxFileBytes': 1, 'maxFiles': 1, 'allowUnscanned': False, 'uploadTtlMinutes': 30},
        'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 1, 'unattachedRetentionDays': 1}})))
    check('B06 양식 칸이 남은 R1-05 는 아무것도 쓰지 않고 멈춤', '입력 칸' in err(admin('postgres'), open(f'{R1_DIR}/R1-05_검증작업자연결_양식.sql', encoding='utf-8').read()))
    run_sql(fill_json(f'{R1_DIR}/R1-05_검증작업자연결_양식.sql', {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)'}))
    WORKER = api(None, 'service_role')
    check('B07 작업자 연결 후에도 heartbeat 전에는 verification_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    worker_call('workhub_file_worker_heartbeat', s1, 'w1', {'checks': ['size', 'sha256', 'signature', 'container', 'encryption'], 'release': 'test-1'}, 120)
    check('B08 악성 검사 없는 작업자 + 미검사 불허 정책 → verification_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    worker_call('workhub_file_worker_heartbeat', s1, 'w1', {'checks': ['size', 'sha256', 'signature', 'container', 'encryption', 'malware'], 'release': 'test-1'}, 120)
    r = data(adm.rpc('workhub_collection_readiness', kind='readiness'))
    check('B09 정책+작업자 → ready, 정책 = 학교∩공통(형식 순서 고정·작은 상한)',
          r == {'available': True, 'reason': 'ready', 'policy': {'extensions': ['pdf', 'hwpx', 'docx'], 'maxFileBytes': 8000000, 'maxFiles': 4}}, r)
    check('B10 heartbeat 의 TTL 범위 밖(30초) 거부', err(WORKER, "select public.workhub_file_worker_heartbeat(%s,'w1','{\"checks\":[],\"release\":\"x\"}'::jsonb,30)", (s1,)) == 'INVALID_INPUT')
    run_sql("update workhub.service_principals set active=false where id='svc_file_worker'")
    check('B11 작업자 주체 비활성 → verification_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    run_sql("update workhub.service_principals set active=true where id='svc_file_worker'")
    run_sql("create policy x_open_all on storage.objects for select to authenticated using (true)", 'supabase_admin')
    check('B12 다른 permissive 정책이 모든 버킷을 열면 storage_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'storage_missing')
    run_sql("drop policy x_open_all on storage.objects; create policy x_other on storage.objects for select to authenticated using (bucket_id = 'other' and auth.uid() is not null)", 'supabase_admin')
    check('B13 다른 버킷으로 한정된 정책은 준비 상태를 막지 않음', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'ready')
    run_sql("drop policy x_other on storage.objects", 'supabase_admin')
    run_sql("update storage.buckets set public = true where id = 'workhub-collection-files'", 'supabase_admin')
    check('B14 버킷이 공개로 바뀌면 storage_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'storage_missing')
    run_sql("update storage.buckets set public = false where id = 'workhub-collection-files'", 'supabase_admin')

    # ======================================================================= 요청 작성·게시
    before = counts(); k = key(); inp = coll_input()
    e1 = adm.mutate({'kind': 'create', 'input': inp}, k)
    rc = data(e1); rid = rc['requestId'] if rc else None
    check('C01 create → 접수증(requestId=resourceId, 판 1, ISO 시각, 요청 번호)',
          rc and rc['resourceId'] == rid and rc['resourceVersion'] == 1 and rc['requestKey'] == k and rc['recordedAt'].endswith('Z'), e1)
    after = counts()
    check('C02 create 는 수합·문항판·문항·대상 명단·검토자·접수증·감사·outbox 를 한 번에 기록',
          after['collections'] == 1 and after['collection_fields'] == 3 and after['collection_plan_units'] == 2 and after['collection_reviewers'] == 1
          and after['idempotency_receipts'] == before['idempotency_receipts'] + 1 and after['audit_events'] == before['audit_events'] + 1
          and after['outbox'] == before['outbox'] + 1, after)
    e2 = adm.mutate({'kind': 'create', 'input': inp}, k)
    check('C03 같은 키·같은 본문 재전송 → 같은 접수증, 변경 0건', e2 == e1 and counts() == after, e2)
    e3 = adm.mutate({'kind': 'create', 'input': coll_input(title='다른 제목')}, k)
    check('C04 같은 키·다른 본문 → IDEMPOTENCY_CONFLICT, 변경 0건', code(e3) == 'IDEMPOTENCY_CONFLICT' and counts() == after, e3)
    year = scalar('select academic_year_id from workhub.collections where id=%s', (rid,))
    check('C05 학년도는 서버가 오늘 기준 정확히 하나로 고정', year == scalar("select id from workhub.academic_years where school_id=%s", (s1,)))
    d = data(adm.rpc('workhub_collection_get', rid, kind='detail', extra={'requestId': rid}))
    check('C06 관리자 상세: 게시 전 단위 0, 요청 본문은 입력과 같음', d and d['units'] == [] and d['request']['status'] == 'draft'
          and d['request']['units'] == inp['units'] and d['request']['fileCollection'] == inp['fileCollection'], d)
    check('C07 대상 교사는 게시 전 요청을 못 봄(상세 NOT_FOUND, 목록 0)', code(t21.rpc('workhub_collection_get', rid)) == 'NOT_FOUND'
          and data(t21.rpc('workhub_collection_list', None))['items'] == [])
    before = counts()
    bad = [
      ('C08 기대판이 문자열 숫자', {'kind': 'update', 'requestId': rid, 'expectedVersion': '1', 'input': inp}, 'INVALID_INPUT'),
      ('C09 모르는 키', {'kind': 'publish', 'requestId': rid, 'expectedVersion': 1, 'force': True}, 'INVALID_INPUT'),
      ('C10 제목이 공백뿐', {'kind': 'create', 'input': coll_input(title='   ')}, 'INVALID_INPUT'),
      ('C11 단위 101개', {'kind': 'create', 'input': coll_input(units=[{'label': f'u{i}', 'responsibleMemberId': M[21], 'contributorMemberIds': []} for i in range(101)])}, 'INVALID_INPUT'),
      ('C12 제목 61자 이모지(JS 길이 122)', {'kind': 'create', 'input': coll_input(title='😀' * 61)}, 'INVALID_INPUT'),
      ('C13 요청 파일 정책이 학교 정책 밖(xlsx)', {'kind': 'create', 'input': coll_input(fileCollection={'policy': {'extensions': ['xlsx'], 'maxFileBytes': 100, 'maxFiles': 1}, 'required': False, 'templates': []})}, 'INVALID_INPUT'),
      ('C14 생성 때 배부 파일 포함', {'kind': 'create', 'input': coll_input(fileCollection={'policy': {'extensions': ['pdf'], 'maxFileBytes': 100, 'maxFiles': 1}, 'required': False,
          'templates': [{'id': 'f1', 'name': 'a.pdf', 'extension': 'pdf', 'bytes': 10, 'sha256': '0' * 64}]})}, 'INVALID_INPUT'),
      ('C15 검토자 = 단위 책임자(자기검토)', {'kind': 'create', 'input': coll_input(reviewerMemberId=M[21])}, 'FORBIDDEN'),
      ('C16 소속 끝난 교사를 대상으로', {'kind': 'create', 'input': coll_input(units=[{'label': 'x', 'responsibleMemberId': M[28], 'contributorMemberIds': []}])}, 'INVALID_INPUT'),
      ('C17 다른 학교 교사를 대상으로', {'kind': 'create', 'input': coll_input(units=[{'label': 'x', 'responsibleMemberId': M[27], 'contributorMemberIds': []}])}, 'INVALID_INPUT'),
      ('C18 공동 작성자에 책임자 중복', {'kind': 'create', 'input': coll_input(units=[{'label': 'x', 'responsibleMemberId': M[21], 'contributorMemberIds': [M[21]]}])}, 'INVALID_INPUT'),
      ('C19 기대판 충돌(update v9)', {'kind': 'update', 'requestId': rid, 'expectedVersion': 9, 'input': inp}, 'CONFLICT'),
      ('C20 없는 요청 update', {'kind': 'update', 'requestId': 'nope', 'expectedVersion': 1, 'input': inp}, 'NOT_FOUND'),
      ('C21 검토형인데 검토자 없음', {'kind': 'create', 'input': coll_input(reviewerMemberId='')}, 'INVALID_INPUT'),
    ]
    for name, cmd, want in bad:
        e = adm.mutate(cmd)
        check(f'{name} → {want}', code(e) == want, e)
    check('C22 위 거부 14건 모두 원본·접수증·감사·outbox 변경 0건', counts() == before, (before, counts()))
    check('C23 교사(대상)가 남의 게시 전 요청 update → NOT_FOUND', code(t21.mutate({'kind': 'update', 'requestId': rid, 'expectedVersion': 1, 'input': inp})) == 'NOT_FOUND')
    check('C24 제목 60자 이모지(JS 길이 120)는 통과', data(adm.mutate({'kind': 'create', 'input': coll_input(title='😀' * 60, units=[{'label': 'x', 'responsibleMemberId': M[25], 'contributorMemberIds': []}], reviewMode='none', reviewerMemberId='')})) is not None)

    # 배부 파일: 저장된 요청 초안(판 1)에 올린 뒤 update 로 연결
    tpl_f = blob('template', 2048)
    up, st = upload_file(adm, {'kind': 'template', 'requestId': rid, 'version': 1}, '양식.hwpx', tpl_f)
    check('C25 업로드 예약: 경로 = 학교/fileId/불투명키, 만료 시각, awaiting_upload',
          up['path'].split('/')[:2] == [s1, up['fileId']] and re.fullmatch(r'[A-Za-z0-9_-]{16,100}', up['path'].split('/')[2]) and up['state'] == 'awaiting_upload'
          and up['bucket'] == 'workhub-collection-files', up)
    check('C26 검증 후 상태 ready + 서버 검증값 FileReference', st['state'] == 'ready' and st['file'] == {'id': up['fileId'], 'name': '양식.hwpx', 'extension': 'hwpx', **tpl_f}, st)
    tref = st['file']
    e = adm.mutate({'kind': 'update', 'requestId': rid, 'expectedVersion': 1,
                    'input': coll_input(fileCollection={**inp['fileCollection'], 'templates': [tref]})})
    check('C27 update 로 배부 파일 연결 → 판 2', data(e) and data(e)['resourceVersion'] == 2, e)
    e = adm.mutate({'kind': 'update', 'requestId': rid, 'expectedVersion': 2,
                    'input': coll_input(fileCollection={**inp['fileCollection'], 'templates': [{**tref, 'sha256': '1' * 64}]})})
    check('C28 배부 파일 참조값이 서버 값과 다르면 INVALID_INPUT', code(e) == 'INVALID_INPUT', e)
    e = adm.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 1})
    check('C29 publish 기대판 충돌 → CONFLICT', code(e) == 'CONFLICT', e)
    e = t21.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 2})
    check('C30 관리자 아닌 교사 publish → NOT_FOUND(게시 전이라 읽을 수 없음)', code(e) == 'NOT_FOUND', e)
    e = adm.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 2})
    check('C31 publish → 판 3', data(e) and data(e)['resourceVersion'] == 3, e)
    check('C32 게시 후 publish 다시 → FORBIDDEN(이미 게시)', code(adm.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 3})) == 'FORBIDDEN')
    check('C33 게시 후 update → FORBIDDEN', code(adm.mutate({'kind': 'update', 'requestId': rid, 'expectedVersion': 3, 'input': inp})) == 'FORBIDDEN')
    units = scalar("select jsonb_agg(jsonb_build_object('id',id,'key',unit_key,'resp',responsible_membership_id) order by ordinal) from workhub.collection_units where collection_id=%s", (rid,))
    uA, uB = units[0]['id'], units[1]['id']
    check('C34 게시 때 단위 u001·u002 와 구성원 snapshot 생성', [u['key'] for u in units] == ['u001', 'u002']
          and scalar("select count(*) from workhub.collection_unit_members where collection_id=%s", (rid,)) == 4, units)
    check('C35 게시된 문항판에 정책판 3종 고정 + 지문', scalar("""select policy_version_id is not null and common_policy_version_id is not null
          and submission_policy_version_id is not null and definition_sha256 ~ '^[0-9a-f]{64}$' from workhub.collection_schemas where collection_id=%s""", (rid,)))
    try:
        run_sql(f"update workhub.collection_schemas set title='x' where collection_id='{rid}'"); ok = False
    except psycopg2.Error as ex: ok = 'IMMUTABLE_ROW' in str(ex)
    check('C36 게시된 문항판은 DB 에서도 고칠 수 없음(트리거)', ok)
    ls = data(t21.rpc('workhub_collection_list', None, kind='list'))
    check('C37 게시 후 대상 교사 목록에 보임', [i['id'] for i in ls['items']] == [rid], ls)
    d23 = data(t23.rpc('workhub_collection_get', rid, kind='detail', extra={'requestId': rid}))
    check('C38 B단위 교사는 자기 단위만 봄', [u['id'] for u in d23['units']] == [uB], d23['units'])
    d24 = data(t24.rpc('workhub_collection_get', rid, kind='detail', extra={'requestId': rid}))
    check('C39 지정 검토자는 모든 단위를 봄', [u['id'] for u in d24['units']] == [uA, uB])
    check('C40 단위 구성원 DTO {id,userId,name}', d24['units'][0]['members'][0] == {'id': M[21], 'userId': T[21], 'name': '교사21'}, d24['units'][0]['members'])

    # ======================================================================= 공동 초안
    e = t22.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 0, 'input': {'text': '초안', 'number': 0, 'files': []}})
    rc = data(e); draftA = rc['resourceId'] if rc else None
    check('D01 공동 작성자 첫 저장(기대판 0) → 초안 판 1 접수증', rc and rc['resourceVersion'] == 1 and rc['requestId'] == rid, e)
    check('D02 같은 기대판 0 으로 다시 저장 → CONFLICT', code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 0, 'input': {'text': 'x', 'number': None}})) == 'CONFLICT')
    dr = data(t21.rpc('workhub_collection_draft_get', rid, uA, kind='draft', extra={'unitId': uA}))
    check('D03 초안 DTO: 숫자 0 보존, 마지막 편집자, files 키', dr == {'id': draftA, 'unitId': uA, 'lastEditorMemberId': M[22], 'version': 1, 'text': '초안', 'number': 0, 'files': []}, dr)
    check('D04 관리자는 초안을 못 읽음(FORBIDDEN)', code(adm.rpc('workhub_collection_draft_get', rid, uA)) == 'FORBIDDEN')
    check('D05 검토자도 초안을 못 읽음(FORBIDDEN)', code(t24.rpc('workhub_collection_draft_get', rid, uA)) == 'FORBIDDEN')
    check('D06 다른 단위 교사는 존재도 모름(NOT_FOUND)', code(t23.rpc('workhub_collection_draft_get', rid, uA)) == 'NOT_FOUND')
    check('D07 관리자 상세에 drafts 키 없음', 'drafts' not in data(adm.rpc('workhub_collection_get', rid)))
    check('D08 관리자가 초안 저장 → FORBIDDEN', code(adm.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 1, 'input': {'text': '', 'number': None}})) == 'FORBIDDEN')
    # 같은 키 재시도: v2 저장 응답 유실 → 다른 교사 v3 저장 → 같은 키 재시도는 여전히 v2
    k2 = key(); body = {'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 1, 'input': {'text': 'v2', 'number': 2}}
    r2 = data(t21.mutate(body, k2))
    t22.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 2, 'input': {'text': 'v3', 'number': 3}})
    r2b = data(t21.mutate(body, k2))
    check('D09 응답 유실 후 같은 키 재시도 → 최초 접수판 2 그대로(최신 3 으로 바꾸지 않음)', r2 == r2b and r2b['resourceVersion'] == 2
          and data(t21.rpc('workhub_collection_draft_get', rid, uA))['version'] == 3, (r2, r2b))
    # 동시 저장: 같은 기대판 3 으로 두 교사가 동시에 → 하나만 성공
    out = {}
    def save_as(w, tag): out[tag] = code(w.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 3, 'input': {'text': tag, 'number': None}})) or 'OK'
    th = [threading.Thread(target=save_as, args=(Who(T[21], M[21]), 'a')), threading.Thread(target=save_as, args=(Who(T[22], M[22]), 'b'))]
    [t.start() for t in th]; [t.join() for t in th]
    check('D10 같은 기대판 동시 저장 → 하나 OK, 하나 CONFLICT', sorted(out.values()) == ['CONFLICT', 'OK'], out)
    check('D11 없는 문항(파일 문항 없는 수합의 files)·제어문자 거부', code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 4, 'input': {'text': 'a\u0001', 'number': None}})) == 'INVALID_INPUT')
    check('D12 숫자 자리에 문자열 → INVALID_INPUT', code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 4, 'input': {'text': '', 'number': '3'}})) == 'INVALID_INPUT')

    # 초안 첨부
    fA = blob('draft-a', 3000)
    up, st = upload_file(t22, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 4}, '보고서.pdf', fA)
    refA = st['file']
    fB = blob('draft-b', 1500)
    upB, stB = upload_file(t23, {'kind': 'draft', 'requestId': rid, 'unitId': uB, 'version': 0}, 'b단위.pdf', fB)
    e = t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 4, 'input': {'text': '본문', 'number': 5, 'files': [stB['file']]}})
    check('D13 다른 단위에 올린 파일을 붙이면 FORBIDDEN', code(e) == 'FORBIDDEN', e)
    fP = blob('pending', 900)
    upP, stP = upload_file(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 4}, '대기.pdf', fP, verify=False)
    check('D14 업로드 확인 직후 상태 pending_verification(브라우저 신고값으로 ready 가 되지 않음)', stP['state'] == 'pending_verification' and stP['file'] is None, stP)
    pend_ref = {'id': upP['fileId'], 'name': '대기.pdf', 'extension': 'pdf', **fP}
    e = t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 4, 'input': {'text': '본문', 'number': 5, 'files': [refA, pend_ref]}})
    check('D15 검증 전 파일을 붙이면 FILE_NOT_READY', code(e) == 'FILE_NOT_READY', e)
    e = t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 4, 'input': {'text': '본문', 'number': 5, 'files': [refA]}})
    check('D16 다른 공동 작성자가 올린 같은 단위 파일 첨부 → 판 5', data(e) and data(e)['resourceVersion'] == 5, e)
    dr = data(t22.rpc('workhub_collection_draft_get', rid, uA, kind='draft', extra={'unitId': uA}))
    check('D17 초안 files 에 서버 검증값', dr['files'] == [refA], dr)

    # ======================================================================= 제출·검토·보완
    sub = lambda w, unit, dv, uv, reason='', **kw: w.mutate({'kind': 'submit', 'requestId': rid, 'unitId': unit, 'draftId': kw.pop('draft', draftA),
          'expectedDraftVersion': dv, 'expectedVersion': uv, 'reason': reason, **kw})
    check('E01 공동 작성자(책임자 아님) 제출 → FORBIDDEN', code(sub(t22, uA, 5, 1)) == 'FORBIDDEN')
    check('E02 초안 기대판 충돌 → CONFLICT', code(sub(t21, uA, 4, 1)) == 'CONFLICT')
    check('E03 단위 기대판 충돌 → CONFLICT', code(sub(t21, uA, 5, 9)) == 'CONFLICT')
    e = sub(t21, uA, 5, 1)
    rc = data(e); s1A = rc['resourceId'] if rc else None
    check('E04 책임자 제출 → 제출판 revision 1 접수증', rc and rc['resourceVersion'] == 1, e)
    d = data(adm.rpc('workhub_collection_get', rid, kind='detail', extra={'requestId': rid}))
    uAd = [u for u in d['units'] if u['id'] == uA][0]; sv = [s for s in d['submissions'] if s['id'] == s1A][0]
    check('E05 검토형: current=새 판, effective=null, 단위 판 2', uAd['currentSubmissionId'] == s1A and uAd['effectiveSubmissionId'] is None and uAd['version'] == 2, uAd)
    check('E06 제출판 snapshot: 제출자·검토 방식·마감·최초 지연 false·files·requestKey', sv['submittedBy'] == M[21] and sv['reviewMode'] == 'required'
          and sv['initiallyLate'] is False and sv['files'] == [refA] and sv['previousSubmissionId'] is None and sv['number'] == 5 and len(sv['requestKey']) >= 8, sv)
    check('E07 관리자(지정 검토자 아님) 검토 → FORBIDDEN', code(adm.mutate({'kind': 'review', 'requestId': rid, 'unitId': uA, 'submissionId': s1A, 'expectedVersion': 2,
          'decision': 'accepted', 'note': '', 'dueDate': ''})) == 'FORBIDDEN')
    rv = lambda w, s, v, dec, note='', due='': w.mutate({'kind': 'review', 'requestId': rid, 'unitId': uA, 'submissionId': s, 'expectedVersion': v, 'decision': dec, 'note': note, 'dueDate': due})
    check('E08 보완 요청 기한이 과거 → INVALID_INPUT', code(rv(t24, s1A, 2, 'changes_requested', '표 보완', (TODAY - datetime.timedelta(days=1)).isoformat())) == 'INVALID_INPUT')
    check('E09 보완 요청 의견 없음 → INVALID_INPUT', code(rv(t24, s1A, 2, 'changes_requested', '', TODAY.isoformat())) == 'INVALID_INPUT')
    e = rv(t24, s1A, 2, 'changes_requested', '표 보완', (TODAY + datetime.timedelta(days=3)).isoformat())
    check('E10 검토자 보완 요청 → 단위 판 3 접수증(resourceId=unit)', data(e) and data(e)['resourceId'] == uA and data(e)['resourceVersion'] == 3, e)
    check('E11 같은 제출판 다시 검토 → CONFLICT', code(rv(t24, s1A, 3, 'accepted')) == 'CONFLICT')
    d = data(adm.rpc('workhub_collection_get', rid)); sup = d['supplements'][0]
    check('E12 보완 요청 DTO: 열림(fulfilled null)', sup['submissionId'] == s1A and sup['fulfilledSubmissionId'] is None, sup)
    t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 5, 'input': {'text': '보완본', 'number': 6, 'files': [refA]}})
    check('E13 이전 제출이 있는데 사유 없이 재제출 → INVALID_INPUT', code(sub(t21, uA, 6, 3)) == 'INVALID_INPUT')
    check('E14 없는 보완 ID → NOT_FOUND', code(sub(t21, uA, 6, 3, '보완', correctionRequestId='nope')) == 'NOT_FOUND')
    e = sub(t21, uA, 6, 3, '표 보완 반영', correctionRequestId=sup['id']); s2A = data(e)['resourceId'] if data(e) else None
    d = data(adm.rpc('workhub_collection_get', rid)); sup = d['supplements'][0]; sv2 = [s for s in d['submissions'] if s['id'] == s2A][0]
    check('E15 보완 응답 제출 → revision 2, previous=1판, 보완 충족', sv2['revision'] == 2 and sv2['previousSubmissionId'] == s1A
          and sup['fulfilledSubmissionId'] == s2A and sv2['correctionReason'] == '표 보완 반영', (sv2, sup))
    check('E16 이미 충족된 보완 ID 로 또 제출 → CONFLICT', code(sub(t21, uA, 6, 4, '또', correctionRequestId=sup['id'])) == 'CONFLICT')
    e = rv(t24, s2A, 4, 'accepted')
    uAd = [u for u in data(adm.rpc('workhub_collection_get', rid))['units'] if u['id'] == uA][0]
    check('E17 승인 → effective=2판', data(e) and uAd['effectiveSubmissionId'] == s2A and uAd['currentSubmissionId'] == s2A, uAd)
    check('E18 승인 완료판 직접 철회 → FORBIDDEN', code(t21.mutate({'kind': 'withdraw', 'requestId': rid, 'unitId': uA, 'submissionId': s2A, 'expectedVersion': 5, 'reason': '실수'})) == 'FORBIDDEN')
    e = sub(t21, uA, 6, 5, '추가 수정'); s3A = data(e)['resourceId'] if data(e) else None
    e = t21.mutate({'kind': 'withdraw', 'requestId': rid, 'unitId': uA, 'submissionId': s3A, 'expectedVersion': 6, 'reason': '잘못 올림'})
    uAd = [u for u in data(adm.rpc('workhub_collection_get', rid))['units'] if u['id'] == uA][0]
    check('E19 검토형 미승인 3판 철회 → current=effective=2판(자동 부활 아님, 완료본 유지)', data(e) and uAd['currentSubmissionId'] == s2A
          and uAd['effectiveSubmissionId'] == s2A and uAd['withdrawnSubmissionIds'] == [s3A], uAd)
    e = sub(t21, uA, 6, 7, '다시 제출'); s4A = data(e)['resourceId'] if data(e) else None
    sv4 = [s for s in data(adm.rpc('workhub_collection_get', rid))['submissions'] if s['id'] == s4A][0]
    check('E20 철회 뒤 재제출 → previous=2판(제출 당시 current)', sv4['previousSubmissionId'] == s2A and sv4['revision'] == 4, sv4)

    # B 단위: 보완 충족판 철회 → 보완 의무 복구
    eB = t23.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uB, 'expectedVersion': 0, 'input': {'text': 'B', 'number': None, 'files': [stB['file']]}})
    draftB = data(eB)['resourceId']
    s1B = data(sub(t23, uB, 1, 1, draft=draftB))['resourceId']
    t24.mutate({'kind': 'review', 'requestId': rid, 'unitId': uB, 'submissionId': s1B, 'expectedVersion': 2, 'decision': 'changes_requested', 'note': '누락', 'dueDate': TODAY.isoformat()})
    supB = [s for s in data(adm.rpc('workhub_collection_get', rid))['supplements'] if s['unitId'] == uB][0]
    s2B = data(sub(t23, uB, 1, 3, '보완', draft=draftB, correctionRequestId=supB['id']))['resourceId']
    e = t23.mutate({'kind': 'withdraw', 'requestId': rid, 'unitId': uB, 'submissionId': s2B, 'expectedVersion': 4, 'reason': '파일 잘못'})
    d = data(adm.rpc('workhub_collection_get', rid)); supB = [s for s in d['supplements'] if s['unitId'] == uB][0]; uBd = [u for u in d['units'] if u['id'] == uB][0]
    check('E21 보완 충족판 철회 → 보완 다시 열림(fulfilled null), current=effective=null', data(e) and supB['fulfilledSubmissionId'] is None
          and uBd['currentSubmissionId'] is None and uBd['effectiveSubmissionId'] is None, (supB, uBd))
    check('E22 철회 이력 DTO(행위자·사유·시각)', any(w['submissionId'] == s2B and w['actorMemberId'] == M[23] and w['reason'] == '파일 잘못' for w in d['withdrawals']), d['withdrawals'])
    check('E23 공동 작성자는 철회 불가(FORBIDDEN)', code(t26.mutate({'kind': 'withdraw', 'requestId': rid, 'unitId': uB, 'submissionId': s1B, 'expectedVersion': 5, 'reason': 'x'})) == 'FORBIDDEN')

    # ======================================================================= 무검토형·마감 뒤
    yest = (TODAY - datetime.timedelta(days=1)).isoformat()
    inp2 = coll_input(title='마감 지난 수합', dueDate=yest, reviewMode='none', reviewerMemberId='', numberLabel='', fileCollection=None,
                      units=[{'label': '담당', 'responsibleMemberId': M[25], 'contributorMemberIds': []}])
    del inp2['fileCollection']
    rid2 = data(adm.mutate({'kind': 'create', 'input': inp2}))['requestId']
    adm.mutate({'kind': 'publish', 'requestId': rid2, 'expectedVersion': 1})
    u2 = scalar('select id from workhub.collection_units where collection_id=%s', (rid2,))
    sv_ = lambda dv, uv, reason='', **kw: t25.mutate({'kind': 'submit', 'requestId': rid2, 'unitId': u2, 'draftId': kw.pop('draft'), 'expectedDraftVersion': dv, 'expectedVersion': uv, 'reason': reason, **kw})
    check('F01 파일 문항 없는 수합에 files 를 보내면 INVALID_INPUT', code(t25.mutate({'kind': 'save_draft', 'requestId': rid2, 'unitId': u2, 'expectedVersion': 0,
          'input': {'text': 'x', 'number': None, 'files': [refA]}})) == 'INVALID_INPUT')
    check('F02 숫자 문항 없는 수합에 숫자 → INVALID_INPUT', code(t25.mutate({'kind': 'save_draft', 'requestId': rid2, 'unitId': u2, 'expectedVersion': 0,
          'input': {'text': 'x', 'number': 1}})) == 'INVALID_INPUT')
    d2 = data(t25.mutate({'kind': 'save_draft', 'requestId': rid2, 'unitId': u2, 'expectedVersion': 0, 'input': {'text': '늦은 제출', 'number': None}}))['resourceId']
    e = sv_(1, 1, draft=d2); n1 = data(e)['resourceId'] if data(e) else None
    det = data(t25.rpc('workhub_collection_get', rid2, kind='detail', extra={'requestId': rid2}))
    check('F03 마감 뒤 첫 제출은 받음: initiallyLate=true, 무검토 current=effective', det['submissions'][0]['initiallyLate'] is True
          and det['units'][0]['currentSubmissionId'] == n1 and det['units'][0]['effectiveSubmissionId'] == n1 and 'files' not in det['submissions'][0], det)
    check('F04 마감 뒤 재제출(정정창 없음) → FORBIDDEN', code(sv_(1, 2, '수정', draft=d2)) == 'FORBIDDEN')
    check('F05 마감 뒤 철회(정정창 없음) → FORBIDDEN', code(t25.mutate({'kind': 'withdraw', 'requestId': rid2, 'unitId': u2, 'submissionId': n1, 'expectedVersion': 2, 'reason': 'x'})) == 'FORBIDDEN')
    oc = lambda w, due, v=2: w.mutate({'kind': 'open_correction', 'requestId': rid2, 'unitId': u2, 'expectedVersion': v, 'dueDate': due, 'reason': '오기 정정'})
    check('F06 관리자 아닌 교사가 정정창 → FORBIDDEN', code(oc(t25, TODAY.isoformat())) == 'FORBIDDEN')
    check('F07 정정창 기한이 정책 최대(14일) 초과 → INVALID_INPUT', code(oc(adm, (TODAY + datetime.timedelta(days=15)).isoformat())) == 'INVALID_INPUT')
    e = oc(adm, (TODAY + datetime.timedelta(days=2)).isoformat())
    det = data(t25.rpc('workhub_collection_get', rid2))
    check('F08 정정창 → 단위 판 3, DTO correctionUntil/Reason', data(e) and det['units'][0]['correctionUntil'] == (TODAY + datetime.timedelta(days=2)).isoformat()
          and det['units'][0]['correctionReason'] == '오기 정정', det['units'][0])
    e = sv_(1, 3, '오기 정정', draft=d2); s2 = data(e)['resourceId'] if data(e) else None
    check('F09 정정창 안 재제출 → revision 2, previous=1판', s2 and data(t25.rpc('workhub_collection_get', rid2))['submissions'][1]['previousSubmissionId'] == n1, e)
    e = t25.mutate({'kind': 'withdraw', 'requestId': rid2, 'unitId': u2, 'submissionId': s2, 'expectedVersion': 4, 'reason': '전부 다시'})
    det = data(t25.rpc('workhub_collection_get', rid2))
    check('F10 무검토형 현재판 철회 → current=effective=null(1판 자동 부활 없음)', data(e) and det['units'][0]['currentSubmissionId'] is None
          and det['units'][0]['effectiveSubmissionId'] is None, det['units'][0])
    e = sv_(1, 5, '재제출', draft=d2)
    det = data(t25.rpc('workhub_collection_get', rid2))
    check('F11 철회 뒤 재제출 → previous=null', data(e) and det['submissions'][-1]['previousSubmissionId'] is None and det['submissions'][-1]['revision'] == 3, det['submissions'][-1])
    check('F12 지연 판정은 서버 시각 기준(is_late 저장 = receipt_at ≥ due)', scalar("select bool_and(is_late = (receipt_at >= due_snapshot)) and bool_and(is_late) from workhub.submission_versions where collection_id=%s", (rid2,)))

    # ======================================================================= 파일·Storage
    before = counts()
    check('G01 제출판을 부모로 업로드 예약 → INVALID_INPUT', code(t21.rpc('workhub_file_prepare', {'kind': 'submission', 'requestId': rid, 'unitId': uA, 'submissionId': s1A},
          {'name': 'a.pdf', 'extension': 'pdf', 'claimedBytes': 10, 'claimedSha256': '0' * 64}, key())) == 'INVALID_INPUT')
    check('G02 요청 정책 밖 형식(docx) → FILE_FAILED', code(t21.rpc('workhub_file_prepare', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6},
          {'name': 'a.docx', 'extension': 'docx', 'claimedBytes': 10, 'claimedSha256': '0' * 64}, key())) == 'FILE_FAILED')
    check('G03 이름과 확장자 불일치 → INVALID_INPUT', code(t21.rpc('workhub_file_prepare', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6},
          {'name': 'a.pdf', 'extension': 'hwpx', 'claimedBytes': 10, 'claimedSha256': '0' * 64}, key())) == 'INVALID_INPUT')
    check('G04 초안 기대판이 다르면 CONFLICT', code(t21.rpc('workhub_file_prepare', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 1},
          {'name': 'a.pdf', 'extension': 'pdf', 'claimedBytes': 10, 'claimedSha256': '0' * 64}, key())) == 'CONFLICT')
    check('G05 거부 4건 변경 0건', counts() == before)
    kp = key(); par = {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6}; fq = blob('again', 777)
    meta = {'name': '재시도.pdf', 'extension': 'pdf', 'claimedBytes': fq['bytes'], 'claimedSha256': fq['sha256']}
    p1 = data(t21.rpc('workhub_file_prepare', par, meta, kp)); p2 = data(t21.rpc('workhub_file_prepare', par, meta, kp))
    check('G06 같은 키 재시도 → 같은 fileId·경로(새 예약 없음)', p1 == p2 and scalar('select count(*) from workhub.file_objects where id=%s', (p1['fileId'],)) == 1, (p1, p2))
    check('G07 같은 키·다른 파일 → IDEMPOTENCY_CONFLICT', code(t21.rpc('workhub_file_prepare', par, {**meta, 'claimedBytes': 778}, kp)) == 'IDEMPOTENCY_CONFLICT')
    kc = key()
    st = data(t21.rpc('workhub_file_complete', p1['fileId'], kc))
    check('G08 실물 올리기 전 complete → awaiting_upload', st == {'fileId': p1['fileId'], 'state': 'awaiting_upload', 'file': None}, st)
    check('G09 남이 그 경로에 업로드 → RLS 거부', 'row-level security' in upload_object(T[22], p1['path']))
    check('G10 발급하지 않은 경로에 업로드 → RLS 거부', 'row-level security' in upload_object(T[21], f'{s1}/{p1["fileId"]}/AAAAAAAAAAAAAAAAAAAA'))
    check('G11 다른 버킷 경로 흉내(학교 폴더 밖) → RLS 거부', 'row-level security' in upload_object(T[21], f'other/{p1["fileId"]}/x'))
    check('G12 업로더 본인 정확한 경로 → 업로드 허용', upload_object(T[21], p1['path']) == 'OK')
    check('G13 같은 경로 두 번째 업로드(덮어쓰기) 불가', upload_object(T[21], p1['path']) != 'OK')
    cc = api(T[21])
    n = call(cc, "with x as (update storage.objects set name = name || 'x' where bucket_id='workhub-collection-files' returning 1) select count(*) from x")
    check('G14 authenticated UPDATE 는 0행(UPDATE 정책 없음)', n == 0, n)
    n = call(cc, "with x as (delete from storage.objects where bucket_id='workhub-collection-files' returning 1) select count(*) from x")
    check('G15 authenticated DELETE 는 0행(삭제 정책 없음)', n == 0, n)
    st = data(t21.rpc('workhub_file_complete', p1['fileId'], kc, kind='status', extra={'fileId': p1['fileId']}))
    check('G16 같은 complete 키 재시도가 현재 상태를 다시 평가 → pending_verification', st['state'] == 'pending_verification', st)
    data(t21.rpc('workhub_file_complete', p1['fileId'], key()))
    check('G17 complete 여러 번이어도 검증 작업 1건', scalar('select count(*) from workhub.file_verification_jobs where file_id=%s', (p1['fileId'],)) == 1)
    check('G18 다른 교사는 상태 조회 불가(NOT_FOUND)', code(t22.rpc('workhub_file_status', p1['fileId'])) == 'NOT_FOUND')
    check('G19 검증 중 파일은 업로더도 Storage 에서 읽지 못함', not can_read_object(T[21], p1['path']))
    # 작업자 봉인 경계
    jobs = worker_call('workhub_file_worker_claim', s1, 'w1', 20)
    j = [x for x in jobs if x['fileId'] == p1['fileId']][0]
    seal = lambda **kw: err(WORKER, 'select public.workhub_file_worker_seal(%s,%s,%s,%s,%s,%s::jsonb)', (kw.get('job', j['jobId']), kw.get('token', j['leaseToken']),
           kw.get('file', j['fileId']), kw.get('path', j['path']), kw.get('obj', j['storageObjectId']), json.dumps(kw.get('res', ready_result(fq)))))
    check('G20 lease token 이 다르면 CONFLICT', seal(token=j['leaseToken'] + 1) == 'CONFLICT')
    check('G21 경로가 다르면 CONFLICT', seal(path=j['path'] + 'x') == 'CONFLICT')
    check('G22 실물 ID 가 다르면 CONFLICT', seal(obj=str(uuid.uuid4())) == 'CONFLICT')
    check('G23 실제 해시가 신고값과 다른데 ready → INVALID_INPUT', seal(res=ready_result(fq, sha256='e' * 64)) == 'INVALID_INPUT')
    check('G24 악성 검사 결과 없이 clean ready → INVALID_INPUT', seal(res=ready_result(fq, checks={'size': True, 'sha256': True, 'signature': True, 'container': True, 'encryption': True})) == 'INVALID_INPUT')
    check('G25 authenticated 가 봉인 함수 호출 → permission denied', 'permission denied' in err(api(T[21]), "select public.workhub_file_worker_seal('a',1,'a','a',null,'{}')"))
    check('G26 정상 봉인', seal() == 'OK')
    check('G27 같은 결과 재봉인 → 같은 응답(멱등)', call(WORKER, 'select public.workhub_file_worker_seal(%s,%s,%s,%s,%s,%s::jsonb)', (j['jobId'], j['leaseToken'], j['fileId'], j['path'], j['storageObjectId'], json.dumps(ready_result(fq))))['replayed'] is True)
    check('G28 끝난 작업에 다른 결과 → CONFLICT', seal(res={**ready_result(fq), 'outcome': 'rejected', 'rejectReason': 'late_change'}) == 'CONFLICT')
    for jj in jobs:
        if jj['fileId'] != p1['fileId']:
            worker_call('workhub_file_worker_seal', jj['jobId'], jj['leaseToken'], jj['fileId'], jj['path'], jj['storageObjectId'], ready_result({'bytes': jj['claimedBytes'], 'sha256': jj['claimedSha256']}))
    try:
        run_sql(f"update workhub.file_objects set sha256 = repeat('f',64) where id = '{p1['fileId']}'"); ok = False
    except psycopg2.Error as ex: ok = 'IMMUTABLE_ROW' in str(ex)
    check('G29 검증 끝난 파일의 해시는 DB 에서도 바꿀 수 없음', ok)
    # 격리(악성) 결과
    fx = blob('virus', 640)
    upx, _ = upload_file(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6}, '의심.pdf', fx, verify=False)
    verify_all(s1, {upx['fileId']: {'outcome': 'quarantined', 'sizeBytes': fx['bytes'], 'sha256': fx['sha256'], 'detectedMime': 'application/pdf', 'expandedBytes': None,
               'scanState': 'rejected', 'rejectReason': 'malware_detected', 'checks': {'malware': False}}})
    stx = data(t21.rpc('workhub_file_status', upx['fileId'], kind='status', extra={'fileId': upx['fileId']}))
    check('G30 격리 파일 상태 rejected, file=null', stx == {'fileId': upx['fileId'], 'state': 'rejected', 'file': None}, stx)
    check('G31 격리 파일을 초안에 붙이면 FILE_FAILED', code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 6,
          'input': {'text': 'x', 'number': None, 'files': [{'id': upx['fileId'], 'name': '의심.pdf', 'extension': 'pdf', **fx}]}})) == 'FILE_FAILED')
    # 작업자 실패·재시도
    fr = blob('retry', 512)
    upr, _ = upload_file(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6}, '재시도2.pdf', fr, verify=False)
    jr = [x for x in worker_call('workhub_file_worker_claim', s1, 'w2', 20) if x['fileId'] == upr['fileId']][0]
    worker_call('workhub_file_worker_fail', jr['jobId'], jr['leaseToken'], 'scanner_timeout', 10)
    check('G32 작업자 실패 → 다시 대기(pending_verification), 다음 시도 시각 뒤로', data(t21.rpc('workhub_file_status', upr['fileId']))['state'] == 'pending_verification'
          and scalar("select state = 'queued' and next_attempt_at > clock_timestamp() from workhub.file_verification_jobs where file_id=%s", (upr['fileId'],)))

    # 내려받기
    acc = lambda w, parent, fid: w.rpc('workhub_file_access', parent, fid, kind='access', extra={'expected': None})
    parS = {'kind': 'submission', 'requestId': rid, 'unitId': uA, 'submissionId': s2A}
    a1 = data(t24.rpc('workhub_file_access', parS, refA['id'], kind='access', extra={'expected': refA})); a2 = data(t24.rpc('workhub_file_access', parS, refA['id']))
    check('G33 검토자 제출판 파일 access → {file,bucket,path}, 두 번 같음', a1 == a2 and a1['file'] == refA and a1['path'].startswith(s1 + '/' + refA['id'] + '/'), a1)
    check('G34 access 받은 검토자는 Storage 에서 읽힘', can_read_object(T[24], a1['path']))
    check('G35 access 없이 같은 경로 직접 요청(B단위 교사) → 안 읽힘', not can_read_object(T[23], a1['path']))
    check('G36 B단위 교사가 A단위 제출 파일 access → NOT_FOUND', code(t23.rpc('workhub_file_access', parS, refA['id'])) == 'NOT_FOUND')
    check('G37 관리자가 초안 파일 access → FORBIDDEN', code(adm.rpc('workhub_file_access', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 6}, refA['id'])) == 'FORBIDDEN')
    check('G38 초안 판이 다르면 CONFLICT', code(t22.rpc('workhub_file_access', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, refA['id'])) == 'CONFLICT')
    check('G39 철회된 제출판 파일 → FORBIDDEN', code(t23.rpc('workhub_file_access', {'kind': 'submission', 'requestId': rid, 'unitId': uB, 'submissionId': s2B}, stB['file']['id'])) == 'FORBIDDEN')
    ab = data(t26.rpc('workhub_file_access', {'kind': 'submission', 'requestId': rid, 'unitId': uB, 'submissionId': s1B}, stB['file']['id'], kind='access', extra={'expected': stB['file']}))
    check('G40 B단위 공동 작성자 access 후 읽힘', can_read_object(T[26], ab['path']))
    run_sql(f"update workhub.memberships set valid_to = '{TODAY.isoformat()}' where id = '{M[26]}'", 'supabase_admin')
    check('G41 access 뒤 소속이 끝나면 같은 접근 기록으로도 Storage 에서 안 읽힘', not can_read_object(T[26], ab['path']))
    at = data(t21.rpc('workhub_file_access', {'kind': 'template', 'requestId': rid, 'version': 3}, tref['id'], kind='access', extra={'expected': tref}))
    check('G42 대상 교사 배부 파일 access(게시판 판 3)', at and at['file'] == tref, at)
    check('G43 배부 파일 판이 다르면 CONFLICT', code(t21.rpc('workhub_file_access', {'kind': 'template', 'requestId': rid, 'version': 2}, tref['id'])) == 'CONFLICT')
    cc = api(T[24])
    check('G44 버킷 전체 목록 조회 → access 받은 파일만 보임', call(cc, "select count(*) from storage.objects where bucket_id='workhub-collection-files'") == 1)

    # ======================================================================= 정리(GC)
    a = admin(); cur = a.cursor()
    pol = call(a, "select id from workhub.policy_versions where policy_key='collection.file_upload'")
    com = call(a, "select id from workhub.policy_versions where policy_key='file.safety'")
    acc21 = 'acc-21'
    cur.execute("""insert into workhub.file_objects (id, school_id, owner_account_id, owner_membership_id, storage_key, original_name, extension, claimed_bytes,
        claimed_sha256, upload_expires_at, safety_policy_scope_key, safety_policy_version_id, common_safety_policy_version_id, created_at)
      values ('gc-expired', %s, %s, %s, %s || '/gc-expired/AAAAAAAAAAAAAAAAAAAA', 'a.pdf', 'pdf', 10, repeat('a',64), now() - interval '3 days', 's:'||%s, %s, %s, now() - interval '3 days')""",
      (s1, acc21, M[21], s1, s1, pol, com))
    a.close()
    old_ready = 'gc-oldready'
    a = admin(); cur = a.cursor()
    cur.execute("""insert into workhub.file_objects (id, school_id, owner_account_id, owner_membership_id, storage_key, original_name, extension, claimed_bytes, claimed_sha256,
        upload_expires_at, safety_policy_scope_key, safety_policy_version_id, common_safety_policy_version_id, created_at, state, storage_object_id, uploaded_at,
        sha256, size_bytes, detected_mime, verified_at, verification, verified_by_service_id, scan_state)
      values (%s, %s, %s, %s, %s || '/gc-oldready/BBBBBBBBBBBBBBBBBBBB', 'b.pdf', 'pdf', 10, repeat('b',64), now() - interval '20 days', 's:'||%s, %s, %s, now() - interval '20 days',
        'ready', gen_random_uuid(), now() - interval '20 days', repeat('b',64), 10, 'application/pdf', now(), '{}', 'svc_file_worker', 'clean')""",
      (old_ready, s1, acc21, M[21], s1, s1, pol, com))
    cur.execute("insert into storage.objects(bucket_id,name,owner_id) values ('workhub-collection-files', %s || '/gc-oldready/BBBBBBBBBBBBBBBBBBBB', %s)", (s1, T[21]))
    a.close()
    cl = worker_call('workhub_file_worker_cleanup_claim', s1, 'gc1', 50)
    ids = sorted(x['fileId'] for x in cl)
    check('G45 정리 인수: 만료된 미업로드·보존 기간 지난 미첨부 파일만(연결된 파일 제외)', ids == ['gc-expired', old_ready], ids)
    lg = {x['fileId']: x for x in cl}
    gcd = lambda fid, out='deleted', reason=None, token=None: err(WORKER, 'select public.workhub_file_worker_cleanup_done(%s,%s,%s,%s)', (lg[fid]['ledgerId'], token or lg[fid]['leaseToken'], out, reason))
    check('G46 Storage 실물이 남아 있는데 deleted 확정 → CONFLICT', gcd(old_ready) == 'CONFLICT')
    run_sql(f"delete from storage.objects where name = '{s1}/gc-oldready/BBBBBBBBBBBBBBBBBBBB'", 'supabase_admin')   # Storage API 삭제 흉내
    r47 = gcd(old_ready)
    check('G47 실물 삭제 뒤 deleted 확정 → 파일 deleted·원장 completed', r47 == 'OK'
          and scalar("select f.state = 'deleted' and l.state = 'completed' from workhub.file_objects f join workhub.deletion_ledger l on l.resource_id = f.id where f.id=%s", (old_ready,)), r47)
    r48 = gcd('gc-expired', 'retained', 'manual_hold')
    check('G48 retained 확정(사유 기록, 파일 보존)', r48 == 'OK'
          and scalar("select state from workhub.file_objects where id='gc-expired'") == 'uploading', r48)
    check('G49 다시 인수하면 대상 없음(연결된·처리된 파일 보존)', worker_call('workhub_file_worker_cleanup_claim', s1, 'gc1', 50) == [])
    check('G50 첨부된 파일은 정리 원장에 없음', scalar("select count(*) from workhub.deletion_ledger l join workhub.file_objects f on f.id=l.resource_id where f.first_linked_at is not null") == 0)
    a2 = admin('postgres'); a2.autocommit = False; cur2 = a2.cursor()
    cur2.execute("update workhub.policy_versions set effective_to = current_date + 30 where policy_key = 'collection.submission' and state = 'published'")
    cur2.execute("update workhub.policy_versions set state = 'retired' where policy_key = 'collection.submission' and state = 'published'")
    check('G51 게시 정책판에 종료일 지정·은퇴는 허용(생성 열 비교 회귀)', cur2.rowcount == 1); a2.rollback()
    check('G52 게시 정책판 값 변경은 IMMUTABLE_ROW', err(admin('postgres'), "update workhub.policy_versions set approval_ref = 'x' where state = 'published'") == 'IMMUTABLE_ROW')

    # ======================================================================= 중지·재개(R1-80/81)
    def switch(state):
        txt = open(f'{R1_DIR}/R1-80_중지.sql' if state != 'open' else f'{R1_DIR}/R1-81_재개.sql', encoding='utf-8').read()
        txt = txt.replace("'<중지 단계: writes_stopped 또는 all_stopped>'", f"'{state}'").replace("'<사유: 날짜와 이유>'", "'시험'")
        run_sql(txt)
    switch('writes_stopped')
    check('S01 쓰기 중지: 준비 상태 database_missing', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'database_missing')
    check('S02 쓰기 중지: 새 명령 NOT_READY', code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 6, 'input': {'text': 'x', 'number': None}})) == 'NOT_READY')
    check('S03 쓰기 중지: 목록·상세·내려받기 허가는 그대로', data(t21.rpc('workhub_collection_list', None))['items'] and data(t24.rpc('workhub_file_access', parS, refA['id'])))
    check('S04 쓰기 중지: 같은 키 재전송은 최초 접수증(이중 접수 없음)', t21.mutate(body, k2) == {'contractVersion': 1, 'schoolId': s1, 'memberId': M[21], 'data': r2})
    check('S05 쓰기 중지: Storage 업로드 차단', 'row-level security' in upload_object(T[21], data(t21.rpc('workhub_file_prepare', par, meta, kp))['path'] + 'z'))
    check('S06 쓰기 중지: 작업자 인수 0건', worker_call('workhub_file_worker_claim', s1, 'w1', 5) == [])
    switch('all_stopped')
    check('S07 전체 중지: 조회도 NOT_READY, Storage 읽기 차단', code(t21.rpc('workhub_collection_list', None)) == 'NOT_READY' and not can_read_object(T[24], a1['path']))
    r0task = call(api(U1), "select public.workhub_task_mutate(%s, %s::jsonb, %s)", (m1, json.dumps({'kind': 'create', 'input': {'title': 'R1 중지 중 R0 업무', 'notes': '', 'dueDate': ''}}), key()))
    check('S08 R1 전체 중지 중에도 R0 개인 업무는 동작', r0task and r0task.get('title') == 'R1 중지 중 R0 업무', r0task)
    switch('open')
    check('S09 재개: ready', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'ready')
    check('S10 중지·재개 이력 3건 기록', scalar('select count(*) from workhub_private.r1_switch_log') == 3)

    # ======================================================================= 목록 cursor
    for i in range(52):
        adm.mutate({'kind': 'create', 'input': coll_input(title=f'목록 {i:02d}', reviewMode='none', reviewerMemberId='', units=[{'label': 'x', 'responsibleMemberId': M[25], 'contributorMemberIds': []}])})
    p1l = data(adm.rpc('workhub_collection_list', None, kind='list'))
    p2l = data(adm.rpc('workhub_collection_list', p1l['nextCursor'], kind='list'))
    allids = [i['id'] for i in p1l['items']] + [i['id'] for i in p2l['items']]
    total = scalar('select count(*) from workhub.collections')
    check('L01 1쪽 50개 + cursor, 2쪽 나머지, 중복 없음·전체 일치', len(p1l['items']) == 50 and p2l['nextCursor'] is None and len(set(allids)) == len(allids) == total, (len(p1l['items']), len(p2l['items']), total))
    check('L02 cursor 문법 [A-Za-z0-9_=-] ≤2048', re.fullmatch(r'[A-Za-z0-9_=-]{1,2048}', p1l['nextCursor']) is not None)
    check('L03 다른 교사가 같은 cursor 를 쓰면 INVALID_INPUT', code(t21.rpc('workhub_collection_list', p1l['nextCursor'])) == 'INVALID_INPUT')
    forged = p1l['nextCursor'][:-1] + ('A' if p1l['nextCursor'][-1] != 'A' else 'B')
    check('L04 위조 cursor → INVALID_INPUT', code(adm.rpc('workhub_collection_list', forged)) == 'INVALID_INPUT')

    # ======================================================================= 원자성(DB 오류)
    before = counts()
    try:
        call(api(T[21]), 'select public.workhub_collection_mutate(%s, %s::jsonb, %s)', (M[21], json.dumps({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 6,
             'input': {'text': 'x' * 5000, 'number': 1e308 * 10 if False else None}}), 'short'))
    except psycopg2.Error: pass
    check('X01 요청 번호 7자 → INVALID_INPUT 봉투, 변경 0건', code(t21.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 1}, 'short')) == 'INVALID_INPUT' and counts() == before)
    check('X02 업무 오류 뒤에도 감사·outbox·접수증 증가 0', counts() == before)

    if OUT:
        json.dump({'captures': captures, 'schoolId': s1}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'run_r1: {sum(1 for _, ok in results if ok)}/{len(results)} 통과')
    return 0 if all(ok for _, ok in results) else 1

if __name__ == '__main__':
    sys.exit(main())
