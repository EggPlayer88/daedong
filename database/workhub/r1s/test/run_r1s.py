# R1S HWPX 기본 확인 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로, 확인 API 는 service_role 로 부른다.
# 확인 API 는 PR #45 의 실제 코드(apps/main/api/collections/_hwpx_basic.py 의 check_file)를 그대로 쓰고,
# 그 코드의 Supabase 연결만 시험용으로 바꾼다(rpc → 이 DB 의 service_role 호출, download → 시험 실물 바이트).
# Storage 는 storage.objects 행으로 RLS·실물 정체성만 흉내 낸다(실제 Storage API·HTTP 경로는 미실행).
#
# 사용: python3 run_r1s.py legacy   — R1 작업자 경로 자료(PDF 제출·검증 대기)가 있는 DB 에 R1S 를 올리는 시나리오(주 시험)
#       python3 run_r1s.py fresh    — 실제 운영 DB 와 같은 상태(R1-05·06 미실행)에 R1S 를 올리는 시나리오(활성화 양식·정책 게시)
import datetime, hashlib, io, json, os, subprocess, sys, threading, uuid, zipfile
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
import run_r1 as r1                                    # R1 시험 도구(연결·고정 자료·Storage 흉내)를 그대로 쓴다
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, code, fixtures, fill_json, run_sql, blob, coll_input,
                    upload_object, can_read_object, worker_call, upload_file, verify_all, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
R1_DIR = os.environ['R1_DIR']
OUT = os.environ.get('R1S_CAPTURE', '')
API_DIR = os.environ.get('R1S_API_DIR', '')            # PR #45 의 apps/main/api/collections (없으면 확인 API 왕복 미실행)
captures = []
BLOBS = {}                                             # Storage 실물 흉내: 경로 → 바이트

hb = None
if API_DIR and os.path.isfile(os.path.join(API_DIR, '_hwpx_basic.py')):
    sys.path.insert(0, API_DIR)
    import _hwpx_basic as hb


def sqlfile(name, user='postgres'):
    """SQL Editor 처럼 파일 전체를 한 번에 실행하고 마지막 SELECT 결과를 돌려준다."""
    a = admin(user); cur = a.cursor()
    try:
        cur.execute(open(os.path.join(S, name), encoding='utf-8').read())
        return cur.fetchall() if cur.description else None
    finally:
        a.close()

def sqlerr(text, user='postgres'):
    try:
        a = admin(user); a.cursor().execute(text); a.close(); return 'OK'
    except psycopg2.Error as e:
        return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)

def filled(name, values):
    return fill_json(os.path.join(S, name), values)

def fingerprint():
    rows = sqlfile('R1S-00_사전점검_지문.sql')
    return rows, [r for r in rows if r[0] == '지문']

def hwpx(tag='본문', extra=None, drop=None, mimetype=b'application/hwp+zip'):
    """최소 HWPX(ZIP). extra: 더할 항목, drop: 뺄 필수 항목."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), mimetype, compress_type=zipfile.ZIP_STORED)
        parts = {'META-INF/container.xml': '<container/>', 'Contents/content.hpf': '<package/>',
                 'Contents/section0.xml': f'<sec><p>{tag}</p></sec>'}
        parts.update(extra or {})
        for name, body in parts.items():
            if name != drop:
                z.writestr(name, body, compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()

def rawb(tag, size): return (tag.encode() * (size // len(tag) + 1))[:size]
def meta(raw): return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}

SVC = None
def claim(uid, member, fid, k):
    return call(SVC, 'select public.workhub_file_basic_claim(%s::uuid,%s,%s,%s)', (uid, member, fid, k))
def finish(uid, member, fid, k, tok, obj, res):
    return call(SVC, 'select public.workhub_file_basic_finish(%s::uuid,%s,%s,%s,%s,%s::uuid,%s::jsonb)', (uid, member, fid, k, tok, obj, json.dumps(res)))
def claim_err(*a):
    try: return claim(*a)
    except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '')
def finish_err(*a):
    try: return finish(*a)
    except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '')

def result_for(c, raw, **kw):
    """PR #45 check_file 과 같은 결과 모양(직접 RPC 시험용)."""
    r = {'profile': 'hwpx_basic_v1', 'outcome': 'ready', 'sizeBytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
         'rejectReason': None, 'checks': {'size': True, 'sha256': True, 'hwpx': True}}
    r.update(kw); return r


class FakeClient:
    """PR #45 SupabaseClient 대역: 인증은 시험 UID, rpc 는 이 DB, 내려받기는 BLOBS. DB 원시 오류는 실제처럼 RESULT_UNKNOWN."""
    def __init__(self, uid, tamper=None):
        self.uid, self.tamper, self.calls = uid, tamper, []
    def user(self, authorization): return self.uid
    def rpc(self, name, args):
        try:
            if name == 'workhub_file_basic_claim':
                v = claim(args['p_actor_user_id'], args['p_member_id'], args['p_file_id'], args['p_request_key'])
            else:
                if self.tamper: self.tamper(args)
                v = finish(args['p_actor_user_id'], args['p_member_id'], args['p_file_id'], args['p_request_key'], args['p_lease_token'],
                           args['p_storage_object_id'], args['p_result'])
        except psycopg2.Error:
            raise hb.CheckError('RESULT_UNKNOWN')
        self.calls.append((name, v))
        captures.append({'kind': name, 'raw': v, 'memberId': args['p_member_id']})
        return v
    def download(self, bucket, path, maximum):
        raw = BLOBS[path]
        if len(raw) > maximum: raise hb.FileRejected('FILE_SIZE_LIMIT')
        return raw

def api_check(who, fid, k=None, tamper=None):
    """PR #45 check_file 을 그대로 실행. 성공 응답 또는 오류 코드."""
    c = FakeClient(who.uid, tamper)
    try:
        out = hb.check_file({'memberId': who.member, 'fileId': fid, 'requestKey': k or key()}, 'Bearer ' + 'a' * 40, client=c)
        captures.append({'kind': 'api_status', 'raw': out, 'memberId': who.member, 'schoolId': who.school, 'userId': who.uid, 'fileId': fid})
        return out
    except hb.CheckError as e:
        return e.code

def prepare_put(who, parent, name, raw, claimed=None, complete=True):
    """예약 → Storage 행 + 실물 바이트 → (업로드 확인). 예약 응답과 확인 응답."""
    m = claimed or meta(raw)
    up = who.rpc('workhub_file_prepare', parent, {'name': name, 'extension': name.rsplit('.', 1)[1], 'claimedBytes': m['bytes'], 'claimedSha256': m['sha256']}, key())
    if not data(up): return up, None
    up = data(up)
    assert upload_object(who.uid, up['path']) == 'OK', up
    BLOBS[up['path']] = raw
    st = data(who.rpc('workhub_file_complete', up['fileId'], key())) if complete else None
    return up, st

def readiness(who):
    v = who.rpc('workhub_collection_basic_readiness')
    captures.append({'kind': 'readiness', 'raw': v, 'memberId': who.member, 'schoolId': who.school, 'userId': who.uid})
    return data(v)

def lease_age(fid, seconds):
    """임대 시각을 과거로 돌린다(만료 시험). 임대 보호 트리거를 잠시 끄고 되돌린다."""
    run_sql("alter table workhub.file_basic_leases disable trigger file_basic_leases_guard;"
            f"update workhub.file_basic_leases set issued_at = issued_at - interval '{seconds} seconds', expires_at = expires_at - interval '{seconds} seconds' where file_id = '{fid}';"
            "alter table workhub.file_basic_leases enable trigger file_basic_leases_guard", 'supabase_admin')

def replace_object(uid, path):
    # 사용자 업로드 정책은 확인 뒤 덮어쓰기를 막는다(R1). 여기서는 관리 경로(서버 키 등)로 같은 경로에 새 객체가 생긴 경우를 흉내 낸다.
    run_sql(f"delete from storage.objects where bucket_id='workhub-collection-files' and name='{path}';"
            f"insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values ('workhub-collection-files','{path}','{uid}'::uuid,'{uid}','{{}}')", 'supabase_admin')

def policies(common_ext, school_ext, maxb=8000000, unscanned=False, frm=None):
    return {'effective_from': (frm or (TODAY - datetime.timedelta(days=1))).isoformat(),
            'common_file_safety': {'extensions': common_ext, 'maxFileBytes': 10000000, 'maxFiles': 5, 'allowUnscanned': unscanned},
            'school_file_upload': {'extensions': school_ext, 'maxFileBytes': maxb, 'maxFiles': 4, 'allowUnscanned': unscanned, 'uploadTtlMinutes': 30},
            'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 14, 'unattachedRetentionDays': 7}}

def activation(pol='existing', **kw):
    v = {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)', 'deployment_ref': '시험 배포(합성 값)',
         'deployment_checked_on': TODAY.isoformat(), 'policies': pol}
    v.update(kw); return filled('R1S-04_학교활성화_양식.sql', v)

def stop_resume(name, code_, reason='시험'):
    t = open(os.path.join(S, name), encoding='utf-8').read()
    t = t.replace("'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>'", f"'{code_}'")
    t = t.replace("'<사유: 날짜와 이유>'", f"'{reason}'").replace("'<사유: 날짜와 이유(재배포했다면 그 확인값도)>'", f"'{reason}'")
    return sqlerr(t)


def install_r1s(tag):
    """R1S-00(전) → 01 → 02 → 03 → 00(후). 지문이 같아야 한다."""
    before_all, before = fingerprint()
    # P2(활성 학교 정확히 1곳)는 시험 고정 자료가 다른 학교 1곳을 더 만들어 FAIL 이 정상이다(운영 DB 는 1곳).
    pre = [r for r in before_all if r[0] == '점검' and not r[1].startswith('P2 ')]
    check(f'{tag}-I01 R1S-00 사전 점검: FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    check(f'{tag}-I02 R1S-00: 교체 대상 함수 5개 = R1-03 원문', any(r[1].startswith('Q3') and 'R1-03 원문' in r[5] for r in pre))
    r = sqlfile('R1S-01_모델_쓰기게이트.sql')
    check(f'{tag}-I03 R1S-01 검증 5행 ok', len(r) == 5 and all(x[2] == 'ok' for x in r), r)
    r = sqlfile('R1S-02_공개함수_권한.sql')
    check(f'{tag}-I04 R1S-02 검증 4행 ok', len(r) == 4 and all(x[2] == 'ok' for x in r), r)
    r = sqlfile('R1S-03_사후점검.sql')
    check(f'{tag}-I05 R1S-03 사후 점검 20행, FAIL 없음', len(r) == 20 and not any(x[2] == 'FAIL' for x in r), [x for x in r if x[2] == 'FAIL'])
    check(f'{tag}-I06 활성화 전: 기본 확인 사용 불가(verification_missing)', r[-1][2] == 'info' and 'verification_missing' in r[-1][3], r[-1])
    after_all, after = fingerprint()
    diff = [(a, b) for a, b in zip(before, after) if a != b] + ([('행 수', len(before), len(after))] if len(before) != len(after) else [])
    check(f'{tag}-I07 R1S-00 지문(기존 구조·R0 구조·R0 자료·기존 자료·R1 구조·R1 함수·R1 자료·수합 Storage) 전후 동일', not diff, diff[:3])
    check(f'{tag}-I08 R1S-00 사후: 교체 함수 5개 = R1S 판', any(r[1].startswith('Q3') and 'R1S 판' in r[5] for r in after_all))
    r4 = sqlfile(os.path.join('..', 'r1', 'R1-04_사후점검.sql'))
    fails = sorted(x[0] for x in r4 if x[2] == 'FAIL')
    check(f'{tag}-I09 R1-04 는 의도한 3행(03 공개 함수 수 · 04 권한 분류 · 09 작업 목록 CHECK)만 FAIL — R1S-03 이 대신함',
          fails == ['R1-04-03', 'R1-04-04', 'R1-04-09'], fails)
    check(f'{tag}-I10 R1S-01 다시 실행 → 멈춤', '이미 적용되었습니다' in sqlerr(open(os.path.join(S, 'R1S-01_모델_쓰기게이트.sql'), encoding='utf-8').read()))
    check(f'{tag}-I11 R1S-02 다시 실행 → 멈춤', '이미 적용되었습니다' in sqlerr(open(os.path.join(S, 'R1S-02_공개함수_권한.sql'), encoding='utf-8').read()))
    _, again = fingerprint()
    check(f'{tag}-I12 멈춘 재실행·R1-04·R1S-03 은 지문을 바꾸지 않음', again == after)
    return before, after


def scenario_fresh():
    """실제 운영 DB 와 같은 상태(R0 + R1-01~03, R1-05·06 미실행)에 R1S 를 올리고 R1S-04 로 정책까지 함께 켠다."""
    global SVC
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    adm = Who(U1, m1)
    check('F00 R1S 전 R1 준비 상태 = verification_missing(작업자·정책 없음)', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    install_r1s('F')
    SVC = api(None, 'service_role')
    check('F01 R1S-04 칸을 채우지 않으면 멈춤(아무것도 쓰지 않음)', '입력 칸' in sqlerr(open(os.path.join(S, 'R1S-04_학교활성화_양식.sql'), encoding='utf-8').read())
          and scalar('select count(*) from workhub.basic_profile_activations') == 0)
    check('F02 정책 없음 + "existing" → 멈춤', '정책 3종이 없거나' in sqlerr(activation('existing')))
    check('F03 미검사 허용 정책 → 멈춤', 'allowUnscanned 는 false' in sqlerr(activation(policies(['pdf', 'hwpx'], ['pdf', 'hwpx'], unscanned=True))))
    check('F04 hwpx 없는 정책 → 멈춤', 'hwpx 를 포함' in sqlerr(activation(policies(['pdf', 'hwpx'], ['pdf']))))
    check('F05 배포 확인일이 미래 → 멈춤', '오늘보다 뒤' in sqlerr(activation(policies(['hwpx'], ['hwpx']), deployment_checked_on=(TODAY + datetime.timedelta(days=1)).isoformat())))
    check('F06 학교 관리자가 아닌 승인자 → 멈춤', 'school_admin' in sqlerr(activation(policies(['hwpx'], ['hwpx']), approver_user_id=T[21])))
    check('F07 정책 모양이 틀리면 → 멈춤', '모양·범위' in sqlerr(activation({**policies(['hwpx'], ['hwpx']), 'school_submission': {'allowWithdrawal': True}})))
    check('F08 멈춘 양식은 주체·범위·정책·활성화를 남기지 않음', scalar("""select (select count(*) from workhub.service_principals where id='svc_hwpx_basic')
          + (select count(*) from workhub.policy_versions) + (select count(*) from workhub.basic_profile_activations)""") == 0)
    r = sqlerr(activation(policies(['pdf', 'hwpx', 'docx'], ['pdf', 'hwpx'])))
    check('F09 R1S-04 (정책 3종 게시 + 활성화) 실행', r == 'OK', r)
    rd = readiness(adm)
    check('F10 기본 확인 준비 상태 ready, 정책 = HWPX 만 · 상한 = min(학교·공통·30MiB)',
          rd == {'available': True, 'reason': 'ready', 'policy': {'extensions': ['hwpx'], 'maxFileBytes': 8000000, 'maxFiles': 4}}, rd)
    check('F11 R1 작업자 경로 준비 상태는 여전히 verification_missing(작업자 없음 — 기본 확인과 별개)',
          data(adm.rpc('workhub_collection_readiness'))['reason'] == 'verification_missing')
    check('F12 게시한 정책 3종이 allowUnscanned=false 로 기록', scalar("""select count(*) from workhub.policy_versions where state='published'
          and coalesce((value->>'allowUnscanned')::boolean, false) = false""") == 3)
    check('F13 R1S-04 다시 실행 → 멈춤(이미 활성화)', '이미 활성화 행' in sqlerr(activation('existing')))
    r = sqlfile('R1S-03_사후점검.sql')
    check('F14 활성화 뒤 R1S-03: FAIL 없음 · 이 학교 ready(시험용 다른 학교는 미활성)', not any(x[2] == 'FAIL' for x in r) and f'{s1}=ready' in r[-1][3], [x for x in r if x[2] in ('FAIL',)] or r[-1])
    # 쓰기 한 바퀴: 요청 만들기·게시 → 단위 교사가 HWPX 를 올려 확인 → 초안·제출
    e = adm.mutate({'kind': 'create', 'input': coll_input(fileCollection={'policy': {'extensions': ['hwpx'], 'maxFileBytes': 5000000, 'maxFiles': 3}, 'required': False, 'templates': []})})
    rid = data(e)['requestId'] if data(e) else None
    check('F15 기본 확인 학교에서 수합 만들기(HWPX 요청 정책)', rid is not None, e)
    e = adm.mutate({'kind': 'create', 'input': coll_input(fileCollection={'policy': {'extensions': ['pdf'], 'maxFileBytes': 5000000, 'maxFiles': 3}, 'required': False, 'templates': []})})
    check('F16 PDF 만 받는 요청은 만들 수 없음(쓰기 정책 = HWPX)', code(e) == 'INVALID_INPUT', e)
    adm.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 1})
    uA = scalar("select id from workhub.collection_units where collection_id=%s order by ordinal limit 1", (rid,))
    t21 = Who(T[21], M[21])
    raw = hwpx('fresh')
    up, st = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 0}, '보고.hwpx', raw)
    check('F17 업로드 확인 → 확인 대기(pending_verification), 작업자 대기열 없음', st['state'] == 'pending_verification'
          and scalar('select count(*) from workhub.file_verification_jobs where file_id=%s', (up['fileId'],)) == 0, st)
    if hb:
        out = api_check(t21, up['fileId'])
        check('F18 PR #45 check_file 왕복 → ready (확인값 = 실물)', isinstance(out, dict) and out['data']['state'] == 'ready'
              and out['data']['file'] == {'id': up['fileId'], 'name': '보고.hwpx', 'extension': 'hwpx', **meta(raw)}, out)
        e = t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 0, 'input': {'text': '보고', 'number': None, 'files': [out['data']['file']]}})
        check('F19 확인된 HWPX 로 초안 저장', data(e) is not None, e)
    else:
        check('F18 PR #45 확인 API 코드(R1S_API_DIR) 없음 — 왕복 미실행', False, 'R1S_API_DIR')
    return s1


def scenario_legacy():
    """R1 작업자 경로로 이미 PDF 를 받은 DB 에 R1S 를 올린다(기존 자료 보존·작업자 경로 비간섭·읽기/쓰기 분리)."""
    global SVC
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    adm = Who(U1, m1); t21, t22, t23, t24, t25 = (Who(T[n], M[n]) for n in (21, 22, 23, 24, 25))
    # ------------------------------------------------------------ R1 작업자 경로 자료(시험 전용: 운영에서는 R1-05·06 을 실행하지 않는다)
    run_sql(fill_json(f'{R1_DIR}/R1-06_정책게시_양식.sql', {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)',
        'effective_from': (TODAY - datetime.timedelta(days=1)).isoformat(),
        'common_file_safety': {'extensions': ['pdf', 'hwpx', 'docx'], 'maxFileBytes': 10000000, 'maxFiles': 5, 'allowUnscanned': False},
        'school_file_upload': {'extensions': ['pdf', 'hwp', 'hwpx', 'docx'], 'maxFileBytes': 8000000, 'maxFiles': 4, 'allowUnscanned': False, 'uploadTtlMinutes': 30},
        'school_submission': {'allowWithdrawal': True, 'allowCorrectionWindow': True, 'maxCorrectionDays': 14, 'unattachedRetentionDays': 7}}))
    run_sql(fill_json(f'{R1_DIR}/R1-05_검증작업자연결_양식.sql', {'approver_user_id': U1, 'approval_ref': '시험 승인(합성 값)'}))
    r1.WORKER = api(None, 'service_role')
    worker_call('workhub_file_worker_heartbeat', s1, 'w1', {'checks': ['size', 'sha256', 'signature', 'container', 'encryption', 'malware'], 'release': 't'}, 1800)
    inp = coll_input(fileCollection={'policy': {'extensions': ['pdf', 'hwpx'], 'maxFileBytes': 5000000, 'maxFiles': 3}, 'required': False, 'templates': []})
    rid = data(adm.mutate({'kind': 'create', 'input': inp}))['requestId']
    adm.mutate({'kind': 'publish', 'requestId': rid, 'expectedVersion': 1})
    units = scalar("select jsonb_agg(id order by ordinal) from workhub.collection_units where collection_id=%s", (rid,))
    uA, uB = units
    pdfA = blob('legacy-pdf-a', 3000)
    _, stA = upload_file(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 0}, '작년보고.pdf', pdfA)
    refA = stA['file']
    dA = data(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 0, 'input': {'text': 'PDF 보고', 'number': None, 'files': [refA]}}))['resourceId']
    sA = data(t21.mutate({'kind': 'submit', 'requestId': rid, 'unitId': uA, 'draftId': dA, 'expectedDraftVersion': 1, 'expectedVersion': 1, 'reason': ''}))['resourceId']
    pdfB = blob('legacy-pdf-b', 2000)
    _, stB = upload_file(t23, {'kind': 'draft', 'requestId': rid, 'unitId': uB, 'version': 0}, '초안첨부.pdf', pdfB)
    refB = stB['file']
    t23.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uB, 'expectedVersion': 0, 'input': {'text': '초안', 'number': None, 'files': [refB]}})
    parS = {'kind': 'submission', 'requestId': rid, 'unitId': uA, 'submissionId': sA}
    pathA = scalar('select storage_key from workhub.file_objects where id=%s', (refA['id'],))
    check('L00 R1 작업자 경로 자료 준비: PDF 제출 1 · PDF 초안 1', refA['extension'] == 'pdf' and refB['extension'] == 'pdf')

    # ------------------------------------------------------------ 설치(활성화 전)
    install_r1s('L')
    SVC = api(None, 'service_role')
    check('L01 활성화 전: R1 쓰기 판정 그대로(작업자 경로 ready)', data(adm.rpc('workhub_collection_readiness'))['reason'] == 'ready')
    check('L02 활성화 전: 기본 확인 준비 상태 verification_missing', readiness(adm) == {'available': False, 'reason': 'verification_missing', 'policy': None})
    up0, st0 = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 1}, '활성화전.pdf', rawb('pre', 900))
    jobs = verify_all(s1)
    check('L03 활성화 전: 새 PDF 업로드는 작업자 대기열 → 작업자가 봉인(기존 흐름 그대로)',
          up0['fileId'] in [j['fileId'] for j in jobs] and data(t21.rpc('workhub_file_status', up0['fileId']))['state'] == 'ready')
    # 작업자가 아직 처리하지 않은 PDF 1건(활성화 뒤에도 작업자 경로로 남아야 한다)
    upP, stP = upload_file(t23, {'kind': 'draft', 'requestId': rid, 'unitId': uB, 'version': 1}, '검증대기.pdf', blob('legacy-pending', 1500), verify=False)
    check('L04 활성화 전: 작업자 경로 파일에 기본 확인 claim → NOT_FOUND', code(claim(T[23], M[23], upP['fileId'], key())) == 'NOT_FOUND')
    check('L05 확인 기록이 없는 파일은 기본 확인 대상이 아님(검증 대기 파일 그대로)', scalar("select state from workhub.file_objects where id=%s", (upP['fileId'],)) == 'uploaded')

    # ------------------------------------------------------------ 권한 경계
    c = api(T[21])
    check('L06 authenticated 는 claim 실행 불가', 'permission denied' in err(c, "select public.workhub_file_basic_claim(%s::uuid,'m','f','kkkkkkkk')", (T[21],)))
    check('L07 authenticated 는 finish 실행 불가', 'permission denied' in err(c, "select public.workhub_file_basic_finish(%s::uuid,'m','f','kkkkkkkk','t',gen_random_uuid(),'{}')", (T[21],)))
    check('L08 anon 은 기본 확인 준비 상태 실행 불가', 'permission denied' in err(api(None, 'anon'), "select public.workhub_collection_basic_readiness('x')"))
    check('L09 service_role 은 사람용 준비 상태 실행 불가', 'permission denied' in err(SVC, "select public.workhub_collection_basic_readiness('x')"))
    check('L10 사람 JWT(sub) 가 실린 service_role 호출 → FORBIDDEN', err(api(T[21], 'service_role'), "select public.workhub_file_basic_claim(%s::uuid,%s,'f','kkkkkkkk')", (T[21], M[21])) == 'FORBIDDEN')
    check('L11 승인되지 않은 교사(U2) UID → FORBIDDEN(기존 승인 gate)', claim_err(U2, M[21], 'f', key()) == 'FORBIDDEN')
    check('L12 남의 소속 ID(다른 사람 UID + m-21) → INACTIVE_MEMBERSHIP', claim_err(T[23], M[21], 'f', key()) == 'INACTIVE_MEMBERSHIP')
    check('L13 소속 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', claim_err(T[28], M[28], 'f', key()) == 'INACTIVE_MEMBERSHIP')
    check('L14 UID 없음 → FORBIDDEN', claim_err(None, M[21], 'f', key()) == 'FORBIDDEN')
    a = admin('authenticator'); cur = a.cursor(); a.autocommit = False
    cur.execute('set local role service_role'); cur.execute("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
    cur.execute('select public.workhub_file_basic_claim(%s::uuid,%s,%s,%s)', (T[21], M[21], 'nope', key()))
    cur.execute("select auth.uid() is null, current_setting('request.jwt.claims', true)")
    uid_after = cur.fetchone(); a.rollback(); a.close()
    check('L15 claim 뒤 같은 트랜잭션의 요청 주체는 원래대로(사람 UID 가 남지 않음)', uid_after == (True, '{"role":"service_role"}'), uid_after)

    # ------------------------------------------------------------ 활성화
    r = sqlerr(activation('existing'))
    check('L16 R1S-04 ("existing" 정책 + 활성화) 실행', r == 'OK', r)
    rd = readiness(adm)
    check('L17 기본 확인 ready · 정책 = HWPX 만, 상한 = min(학교 8MB, 공통 10MB, 30MiB)',
          rd == {'available': True, 'reason': 'ready', 'policy': {'extensions': ['hwpx'], 'maxFileBytes': 8000000, 'maxFiles': 4}}, rd)
    check('L18 활성화 행·로그·주체(file.basic_check 하나)·학교 범위 승인', scalar("""select (select count(*) from workhub.basic_profile_activations where state='active')
          + (select count(*) from workhub.basic_profile_activation_log) + (select count(*) from workhub.service_principals where id='svc_hwpx_basic' and allowed_actions = array['file.basic_check'])
          + (select count(*) from workhub.service_principal_scopes where service_principal_id='svc_hwpx_basic' and revoked_at is null)""") == 4)
    check('L19 기본 확인 주체는 service_role 연결(api_role_principals)이 없음 — 작업자 함수로 쓸 수 없음',
          scalar("select count(*) from workhub_private.api_role_principals where service_principal_id='svc_hwpx_basic'") == 0)
    check('L20 활성화 행 승인·배포값은 바꿀 수 없음', 'IMMUTABLE' in sqlerr("update workhub.basic_profile_activations set deployment_ref='x'"))
    check('L21 활성화 행은 지울 수 없음', 'IMMUTABLE' in sqlerr('delete from workhub.basic_profile_activations'))
    check('L22 프로필 행은 바꿀 수 없음(악성 검사 위장 금지)', 'IMMUTABLE' in sqlerr("update workhub.file_check_profiles set malware_scan=true"))
    check('L23 악성 검사·내용 검증을 하는 프로필은 넣을 수 없음', 'file_check_profiles_no_malware' in sqlerr(
          "insert into workhub.file_check_profiles(profile,label,description,extensions,max_file_bytes,checks,malware_scan) values ('x_fake','x','x',array['hwpx'],1,array['size'],true)"))

    # ------------------------------------------------------------ 쓰기 판정·업로드
    up, st = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 1}, '새보고.pdf', rawb('new-pdf', 800))
    check('L24 활성화 뒤 새 PDF 예약 → FILE_FAILED(쓰기 정책 = HWPX 만)', code(up) == 'FILE_FAILED', up)
    raw1 = hwpx('보고서 1')
    up1, st1 = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 1}, '보고서.hwpx', raw1)
    check('L25 HWPX 예약·업로드 확인 → pending_verification, 확인 기록 1 · 작업자 대기열 0', st1 == {'fileId': up1['fileId'], 'state': 'pending_verification', 'file': None}
          and scalar('select count(*) from workhub.file_basic_checks where file_id=%s', (up1['fileId'],)) == 1
          and scalar('select count(*) from workhub.file_verification_jobs where file_id=%s', (up1['fileId'],)) == 0, st1)
    check('L26 기본 확인 파일을 작업자 대기열에 넣으려 하면 DB 가 거부', 'BASIC_PROFILE_CONFLICT' in sqlerr(
          f"insert into workhub.file_verification_jobs(school_id, file_id) values ('{s1}', '{up1['fileId']}')"))
    check('L27 작업자 경로 파일(검증 대기)에 확인 기록을 붙이면 DB 가 거부', 'BASIC_PROFILE_CONFLICT' in sqlerr(
          f"insert into workhub.file_basic_checks(file_id, school_id, profile, activation_id) select '{upP['fileId']}', '{s1}', 'hwpx_basic_v1', id from workhub.basic_profile_activations"))
    jobs = worker_call('workhub_file_worker_claim', s1, 'w1', 20)
    check('L28 작업자 claim 은 기본 확인 파일을 가져가지 않고, 기존 검증 대기 PDF 는 그대로 처리', [j['fileId'] for j in jobs] == [upP['fileId']], jobs)
    for j in jobs:
        worker_call('workhub_file_worker_seal', j['jobId'], j['leaseToken'], j['fileId'], j['path'], j['storageObjectId'],
                    r1.ready_result({'bytes': j['claimedBytes'], 'sha256': j['claimedSha256']}))
    check('L29 활성화 뒤에도 기존 작업자 경로 파일은 봉인되어 ready', data(t23.rpc('workhub_file_status', upP['fileId']))['state'] == 'ready')

    # ------------------------------------------------------------ PR #45 확인 API 왕복
    if hb:
        k1 = key()
        out = api_check(t21, up1['fileId'], k1)
        check('L30 check_file 왕복 → ready, FileReference = 실물 크기·해시', isinstance(out, dict) and out['data'] == {'fileId': up1['fileId'], 'state': 'ready',
              'file': {'id': up1['fileId'], 'name': '보고서.hwpx', 'extension': 'hwpx', **meta(raw1)}} and out['schoolId'] == s1 and out['memberId'] == M[21], out)
        f = scalar("select to_jsonb(f) from workhub.file_objects f where id=%s", (up1['fileId'],))
        check('L31 파일 행: scan_state not_scanned · 악성 검사 안 함 표시 · 확인 주체 svc_hwpx_basic · application/hwp+zip',
              f['scan_state'] == 'not_scanned' and f['verification'] == {'profile': 'hwpx_basic_v1', 'checks': {'size': True, 'sha256': True, 'hwpx': True},
              'malwareScan': False, 'contentValidation': False} and f['verified_by_service_id'] == 'svc_hwpx_basic' and f['detected_mime'] == 'application/hwp+zip', f)
        check('L32 감사: claim·확정 모두 확인 주체(service) 로, 요청 소속은 details 에', scalar("""select count(*) from workhub.audit_events where resource_id=%s
              and operation in ('file.basic_claim','file.basic_check') and actor_service_principal_id='svc_hwpx_basic' and actor_account_id is null
              and details->>'member_id' = %s""", (up1['fileId'], M[21])) == 2)
        check('L33 outbox file.verified 1건', scalar("select count(*) from workhub.outbox where aggregate_id=%s and topic='file.verified'", (up1['fileId'],)) == 1)
        out2 = api_check(t21, up1['fileId'], k1)
        check('L34 같은 요청 번호로 다시 확인 → 같은 ready(재확인·재다운로드 없음)', out2 == out, out2)
        check('L35 다른 요청 번호로 다시 확인 → 같은 ready', api_check(t21, up1['fileId']) == out)
        ref1 = out['data']['file']
        e = t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 1, 'input': {'text': 'HWPX 보고', 'number': None, 'files': [ref1]}})
        check('L36 확인된 HWPX 를 초안에 연결', data(e) is not None, e)
        e = t21.mutate({'kind': 'submit', 'requestId': rid, 'unitId': uA, 'draftId': dA, 'expectedDraftVersion': 2, 'expectedVersion': 2, 'reason': 'HWPX 로 다시'})
        check('L37 HWPX 로 다시 제출(제출판 2)', data(e) is not None, e)
        sA2 = data(e)['resourceId'] if data(e) else None
        par2 = {'kind': 'submission', 'requestId': rid, 'unitId': uA, 'submissionId': sA2}
        acc = t24.rpc('workhub_file_access', par2, ref1['id'])
        check('L38 검토자가 HWPX 제출 파일 내려받기 허가 + Storage 읽기', data(acc) is not None and can_read_object(T[24], data(acc)['path']), acc)
        captures.append({'kind': 'access', 'raw': acc, 'memberId': M[24], 'schoolId': s1, 'userId': T[24], 'expected': ref1})
        # 거절 경로 — API 의 고정 코드가 DB 에 그대로 남는다
        bad = [('L39 ZIP 이 아님 → FILE_SIGNATURE_MISMATCH', b'not a zip file at all' * 10, 'FILE_SIGNATURE_MISMATCH'),
               ('L40 필수 항목 없음 → FILE_HWPX_REQUIRED_PART', hwpx('x', drop='Contents/section0.xml'), 'FILE_HWPX_REQUIRED_PART'),
               ('L41 mimetype 다름 → FILE_SIGNATURE_MISMATCH', hwpx('x', mimetype=b'application/zip'), 'FILE_SIGNATURE_MISMATCH'),
               ('L42 경로 탈출 항목 → FILE_STRUCTURE_INVALID', hwpx('x', extra={'../evil.xml': 'x'}), 'FILE_STRUCTURE_INVALID')]
        for name, raw, want in bad:
            u, s = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '거절.hwpx', raw)
            o = api_check(t21, u['fileId'])
            got = scalar('select reject_reason from workhub.file_objects where id=%s', (u['fileId'],))
            check(name, isinstance(o, dict) and o['data'] == {'fileId': u['fileId'], 'state': 'rejected', 'file': None} and got == want.lower(), (o, got))
        raw = hwpx('바꿔치기')
        u, s = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '해시.hwpx', raw)
        BLOBS[u['path']] = raw[:-1] + bytes([raw[-1] ^ 1])
        o = api_check(t21, u['fileId'])
        check('L43 실물이 신고 해시와 다름 → FILE_HASH_MISMATCH 로 rejected', isinstance(o, dict) and o['data']['state'] == 'rejected'
              and scalar('select reject_reason from workhub.file_objects where id=%s', (u['fileId'],)) == 'file_hash_mismatch', o)
        u, s = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '크기.hwpx', raw, claimed={'bytes': len(raw) + 5, 'sha256': meta(raw)['sha256']})
        o = api_check(t21, u['fileId'])
        check('L44 실물 크기가 신고와 다름 → FILE_SIZE_MISMATCH 로 rejected', isinstance(o, dict) and o['data']['state'] == 'rejected'
              and scalar('select reject_reason from workhub.file_objects where id=%s', (u['fileId'],)) == 'file_size_mismatch', o)
        # API 결과가 앞뒤가 맞지 않으면 DB 가 막는다(크기·해시는 DB 가 신고값과 대조). HWPX 구조 판정 자체는 승인된 확인 주체를 믿는다.
        raw = hwpx('위조')
        u, s = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '위조.hwpx', raw)
        BLOBS[u['path']] = raw[:-1] + bytes([raw[-1] ^ 1])
        def forge(args): args['p_result'] = {**args['p_result'], 'outcome': 'ready', 'rejectReason': None, 'checks': {'size': True, 'sha256': True, 'hwpx': True}}
        o = api_check(t21, u['fileId'], tamper=forge)
        check('L45 해시 불일치를 ready 로 꾸민 결과 → DB 가 INVALID_INPUT 봉투(파일은 확인 중 그대로)', o == 'INVALID_INPUT'
              and scalar('select state from workhub.file_objects where id=%s', (u['fileId'],)) == 'verifying', o)
    else:
        check('L30 PR #45 확인 API 코드(R1S_API_DIR) 없음 — 왕복 미실행', False, 'R1S_API_DIR')
        return

    # ------------------------------------------------------------ claim/finish 직접 대조
    raw2 = hwpx('직접')
    u2, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '직접.hwpx', raw2)
    f2 = u2['fileId']
    check('L46 남의 파일 claim(같은 학교 다른 교사) → NOT_FOUND', code(claim(T[22], M[22], f2, key())) == 'NOT_FOUND')
    check('L47 없는 파일 → NOT_FOUND', code(claim(T[21], M[21], 'no-such-file', key())) == 'NOT_FOUND')
    check('L48 작업자 경로 파일 claim → NOT_FOUND', code(claim(T[23], M[23], upP['fileId'], key())) == 'NOT_FOUND')
    u3, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '미완료.hwpx', hwpx('미완료'), complete=False)
    check('L49 업로드 확인 전 파일 → FILE_NOT_READY', code(claim(T[21], M[21], u3['fileId'], key())) == 'FILE_NOT_READY')
    kc = key()
    c1 = data(claim(T[21], M[21], f2, kc))
    check('L50 claim → 임대 token(64자) · 90초 · 경로·실물 ID·신고값·상한', c1 and len(c1['leaseToken']) == 64 and c1['state'] == 'checking'
          and c1['maxFileBytes'] == 5000000 and c1['claimedBytes'] == len(raw2) and c1['path'] == u2['path'] and c1['name'] == '직접.hwpx', c1)
    check('L51 token 원문은 DB 에 없음(해시만)', scalar('select count(*) from workhub.file_basic_leases where file_id=%s and token_sha256=%s', (f2, hashlib.sha256(c1['leaseToken'].encode()).hexdigest())) == 1
          and scalar("select count(*) from workhub.file_basic_leases where token_sha256=%s", (c1['leaseToken'],)) == 0)
    c2 = data(claim(T[21], M[21], f2, key()))
    check('L52 임대 중 다시 claim → leaseToken null(다른 확인 진행 중)', c2 == {'fileId': f2, 'state': 'checking', 'leaseToken': None, 'leaseExpiresAt': c1['leaseExpiresAt']}, c2)
    check('L53 같은 요청 번호를 다른 파일에 → IDEMPOTENCY_CONFLICT', code(claim(T[21], M[21], u3['fileId'], kc)) == 'IDEMPOTENCY_CONFLICT')
    good = result_for(c1, raw2)
    fin = lambda tok=c1['leaseToken'], obj=c1['storageObjectId'], res=good, k=kc, fid=f2: finish(T[21], M[21], fid, k, tok, obj, res)
    check('L54 틀린 token → CONFLICT', code(fin(tok='0' * 64)) == 'CONFLICT')
    check('L55 token 모양이 틀림 → INVALID_INPUT', code(fin(tok='xyz')) == 'INVALID_INPUT')
    check('L56 다른 실물 ID → CONFLICT', code(fin(obj=str(uuid.uuid4()))) == 'CONFLICT')
    shape_bad = [('L57 모르는 키', {**good, 'malware': True}), ('L58 프로필 다름', {**good, 'profile': 'hwpx_basic_v2'}),
                 ('L59 ready 인데 해시가 신고와 다름', {**good, 'sha256': '0' * 64, 'checks': {'size': True, 'sha256': False, 'hwpx': True}}),
                 ('L60 ready 인데 거절 코드 있음', {**good, 'rejectReason': 'FILE_ENCRYPTED'}),
                 ('L61 ready 인데 hwpx 확인 false', {**good, 'checks': {'size': True, 'sha256': True, 'hwpx': False}}),
                 ('L62 거절인데 코드 없음', {**good, 'outcome': 'rejected', 'checks': {'size': True, 'sha256': True, 'hwpx': False}}),
                 ('L63 모르는 거절 코드', {**good, 'outcome': 'rejected', 'rejectReason': 'VIRUS_FOUND', 'checks': {'size': True, 'sha256': True, 'hwpx': False}}),
                 ('L64 FILE_SIZE_LIMIT 인데 크기 값 있음', {**good, 'outcome': 'rejected', 'rejectReason': 'FILE_SIZE_LIMIT', 'checks': {'size': False, 'sha256': False, 'hwpx': False}}),
                 ('L65 크기 확인 값이 실제 비교와 다름', {**good, 'outcome': 'rejected', 'rejectReason': 'FILE_STRUCTURE_INVALID', 'checks': {'size': False, 'sha256': True, 'hwpx': False}}),
                 ('L66 크기가 문자열', {**good, 'sizeBytes': str(len(raw2))}), ('L67 결과가 배열', [good])]
    for name, res in shape_bad:
        check(f'{name} → INVALID_INPUT', code(fin(res=res)) == 'INVALID_INPUT', res)
    check('L68 거절된 시도들은 아무것도 바꾸지 않음(파일 verifying · 확인 기록 열림 · 임대 열림)', scalar("""select f.state = 'verifying' and b.outcome is null
          and (select count(*) from workhub.file_basic_leases l where l.file_id = f.id and l.state = 'issued') = 1
          from workhub.file_objects f join workhub.file_basic_checks b on b.file_id = f.id where f.id=%s""", (f2,)))
    r = fin()
    check('L69 올바른 finish → ready', data(r) and data(r)['state'] == 'ready' and data(r)['file']['sha256'] == meta(raw2)['sha256'], r)
    check('L70 같은 인자 재전송(응답 유실) → 같은 응답', fin() == r)
    check('L71 끝난 파일에 다른 결과 → CONFLICT', code(fin(res={**good, 'outcome': 'rejected', 'rejectReason': 'FILE_ENCRYPTED', 'checks': {'size': True, 'sha256': True, 'hwpx': False}})) == 'CONFLICT')
    check('L72 같은 요청 번호로 다른 파일 finish → IDEMPOTENCY_CONFLICT', code(fin(fid=u3['fileId'])) == 'IDEMPOTENCY_CONFLICT')
    check('L73 임대 finished · 확인 기록 결과 1회 고정(DB 에서도 못 바꿈)', scalar("select state from workhub.file_basic_leases where file_id=%s", (f2,)) == 'finished'
          and 'IMMUTABLE' in sqlerr(f"update workhub.file_basic_checks set outcome='rejected' where file_id='{f2}'"))
    check('L74 ready 파일의 결과는 DB 에서도 못 바꿈(R1 보호 그대로)', 'IMMUTABLE' in sqlerr(f"update workhub.file_objects set scan_state='clean' where id='{f2}'"))

    # 임대 만료·옛 token
    u4, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '만료.hwpx', hwpx('만료'))
    f4 = u4['fileId']; c4 = data(claim(T[21], M[21], f4, key())); raw4 = BLOBS[u4['path']]
    lease_age(f4, 100)
    check('L75 만료된 임대로 finish → CONFLICT', code(finish(T[21], M[21], f4, key(), c4['leaseToken'], c4['storageObjectId'], result_for(c4, raw4))) == 'CONFLICT')
    c4b = data(claim(T[21], M[21], f4, key()))
    check('L76 만료 뒤 다시 claim → 새 token, 옛 임대 expired', c4b['leaseToken'] and c4b['leaseToken'] != c4['leaseToken']
          and scalar("select count(*) from workhub.file_basic_leases where file_id=%s and state='expired'", (f4,)) == 1)
    check('L77 옛 token 으로 finish → CONFLICT', code(finish(T[21], M[21], f4, key(), c4['leaseToken'], c4['storageObjectId'], result_for(c4, raw4))) == 'CONFLICT')
    check('L78 새 token 으로 finish → ready', data(finish(T[21], M[21], f4, key(), c4b['leaseToken'], c4b['storageObjectId'], result_for(c4b, raw4)))['state'] == 'ready')

    # 동시 claim — 정확히 하나만 token
    u5, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '동시.hwpx', hwpx('동시'))
    got = []
    def go():
        c = api(None, 'service_role')
        got.append(call(c, 'select public.workhub_file_basic_claim(%s::uuid,%s,%s,%s)', (T[21], M[21], u5['fileId'], key())))
        c.close()
    th = [threading.Thread(target=go) for _ in range(5)]
    [t.start() for t in th]; [t.join() for t in th]
    toks = [data(g)['leaseToken'] for g in got if data(g)]
    check('L79 동시 claim 5건 → token 은 정확히 1건, 나머지는 진행 중', len(toks) == 5 and sum(1 for t in toks if t) == 1, got)

    # 실물 삭제·교체
    u6, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '삭제.hwpx', hwpx('삭제'))
    run_sql(f"delete from storage.objects where name='{u6['path']}'", 'supabase_admin')
    r = data(claim(T[21], M[21], u6['fileId'], key()))
    check('L80 확인 전 실물이 사라짐 → claim 이 rejected 로 닫음(object_missing)', r == {'fileId': u6['fileId'], 'state': 'rejected', 'file': None}
          and scalar("select reject_reason || '/' || (select close_reason from workhub.file_basic_checks where file_id=f.id) from workhub.file_objects f where id=%s", (u6['fileId'],)) == 'object_missing/object_missing', r)
    u7, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '교체.hwpx', hwpx('교체'))
    c7 = data(claim(T[21], M[21], u7['fileId'], key()))
    replace_object(T[21], u7['path'])
    check('L81 claim 뒤 실물이 바뀜(같은 경로 새 객체) → finish CONFLICT', code(finish(T[21], M[21], u7['fileId'], key(), c7['leaseToken'], c7['storageObjectId'], result_for(c7, BLOBS[u7['path']]))) == 'CONFLICT')
    lease_age(u7['fileId'], 100)
    r = data(claim(T[21], M[21], u7['fileId'], key()))
    check('L82 임대가 끝난 뒤 claim → rejected 로 닫음(object_changed)', r and r['state'] == 'rejected'
          and scalar('select reject_reason from workhub.file_objects where id=%s', (u7['fileId'],)) == 'object_changed', r)

    # 횟수 제한
    u8, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '반복.hwpx', hwpx('반복'))
    toks = []
    for i in range(7):
        toks.append(data(claim(T[21], M[21], u8['fileId'], key())) or code(claim(T[21], M[21], u8['fileId'], key())))
        lease_age(u8['fileId'], 95)
    check('L83 파일당 10분에 6번까지 임대 → 7번째는 NOT_READY', [isinstance(t, dict) and bool(t.get('leaseToken')) for t in toks[:6]] == [True] * 6 and toks[6] == 'NOT_READY', toks[6])

    # 확인 도중 중지(R1S-80)·재개(R1S-81)
    u9, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '중지.hwpx', hwpx('중지'))
    c9 = data(claim(T[21], M[21], u9['fileId'], key()))
    code_ = scalar("select code from workhub.schools where id=%s", (s1,))
    check('L84 R1S-80 칸을 채우지 않으면 멈춤', '칸을 채워' in sqlerr(open(os.path.join(S, 'R1S-80_학교중지.sql'), encoding='utf-8').read()))
    check('L85 R1S-80 학교 중지', stop_resume('R1S-80_학교중지.sql', code_) == 'OK')
    check('L86 중지 중 finish → NOT_READY(확정하지 않음)', code(finish(T[21], M[21], u9['fileId'], key(), c9['leaseToken'], c9['storageObjectId'], result_for(c9, BLOBS[u9['path']]))) == 'NOT_READY')
    check('L87 중지 중 기본 확인 준비 상태 verification_missing', readiness(adm)['reason'] == 'verification_missing')
    check('L88 중지 중 쓰기 판정은 R1 작업자 경로로 돌아감(시험 DB 에는 작업자가 있어 ready) — 기본 확인 파일은 새로 붙이지 못함',
          code(t21.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uA, 'expectedVersion': 2, 'input': {'text': 'x', 'number': None, 'files': [data(fin())['file']]}})) == 'FILE_FAILED')
    check('L89 중지 중에도 이미 받은 HWPX·PDF 내려받기 그대로', data(t24.rpc('workhub_file_access', par2, ref1['id'])) is not None and data(t24.rpc('workhub_file_access', parS, refA['id'])) is not None)
    check('L90 이미 중지면 R1S-80 은 멈춤', '이미 꺼져' in stop_resume('R1S-80_학교중지.sql', code_))
    check('L91 R1S-81 재개', stop_resume('R1S-81_학교재개.sql', code_) == 'OK' and readiness(adm)['reason'] == 'ready')
    check('L92 재개 직후 claim → 기존 임대가 살아 있으면 진행 중', data(claim(T[21], M[21], u9['fileId'], key()))['leaseToken'] is None)
    check('L93 활성화 로그: active → stopped → active (3행)', scalar("select string_agg(coalesce(old_state,'-')||'>'||new_state, ',' order by id) from workhub.basic_profile_activation_log") == '->active,active>stopped,stopped>active')

    # 주체 범위 회수 → 즉시 닫힘
    run_sql("update workhub.service_principal_scopes set revoked_at = now() where service_principal_id='svc_hwpx_basic' and revoked_at is null")
    check('L94 확인 주체 범위 회수 → 기본 확인 verification_missing, claim NOT_READY', readiness(adm)['reason'] == 'verification_missing'
          and code(claim(T[21], M[21], u9['fileId'], key())) in ('NOT_READY',))
    check('L95 회수 중 HWPX 예약 → NOT_READY(작업자 경로로 넘어가지 않음 — 켜 둔 학교는 프로필 조건으로만)',
          code(t21.rpc('workhub_file_prepare', {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, {'name': 'a.hwpx', 'extension': 'hwpx', 'claimedBytes': 10, 'claimedSha256': 'a' * 64}, key())) == 'NOT_READY')
    run_sql(f"""insert into workhub.service_principal_scopes (service_principal_id, scope_type, school_id, valid_from, approved_by_account_id, approval_ref, approved_at)
                select 'svc_hwpx_basic', 'school', '{s1}', clock_timestamp(), approved_by_account_id, '시험 재승인', clock_timestamp() from workhub.service_principals where id='svc_hwpx_basic'""")
    check('L96 범위 재승인 → 다시 ready', readiness(adm)['reason'] == 'ready')

    # 정책 축소: HWPX 만 받도록 바꿔도 과거 PDF 는 읽는다 · 확인 중 상한이 줄면 확정하지 않는다
    u10, _ = prepare_put(t21, {'kind': 'draft', 'requestId': rid, 'unitId': uA, 'version': 2}, '축소.hwpx', hwpx('축소', extra={'BinData/image1.bin': os.urandom(3000)}))
    c10 = data(claim(T[21], M[21], u10['fileId'], key()))
    run_sql(f"""update workhub.policy_versions set effective_to = current_date where state = 'published' and policy_key in ('collection.file_upload','file.safety');
      insert into workhub.policy_versions (scope, school_id, policy_key, policy_version, applies_to_scopes, value, state, effective_from,
          approved_by_account_id, approved_by_membership_id, approved_at, approval_ref)
      select scope, school_id, policy_key, policy_version + 1, applies_to_scopes,
             value || jsonb_build_object('extensions', '["hwpx"]'::jsonb, 'maxFileBytes', 1000), 'published', current_date,
             approved_by_account_id, approved_by_membership_id, approved_at, approval_ref || ' (HWPX 전용·상한 축소 시험)'
        from workhub.policy_versions where policy_key in ('collection.file_upload','file.safety') and state = 'published' and effective_to = current_date""")
    rd = readiness(adm)
    check('L97 정책을 HWPX 전용·1000바이트로 줄이면 준비 상태 상한도 1000', rd['policy'] == {'extensions': ['hwpx'], 'maxFileBytes': 1000, 'maxFiles': 4}, rd)
    check('L98 확인 중 상한이 실물보다 작아짐 → finish CONFLICT(확정 안 함)',
          code(finish(T[21], M[21], u10['fileId'], key(), c10['leaseToken'], c10['storageObjectId'], result_for(c10, BLOBS[u10['path']]))) == 'CONFLICT')
    lease_age(u10['fileId'], 100)
    o = api_check(t21, u10['fileId'])
    check('L99 임대가 끝난 뒤 다시 확인 → 새 상한으로 FILE_SIZE_LIMIT 거절', isinstance(o, dict) and o['data']['state'] == 'rejected'
          and scalar('select reject_reason from workhub.file_objects where id=%s', (u10['fileId'],)) == 'file_size_limit', o)
    acc = t24.rpc('workhub_file_access', parS, refA['id'])
    check('L100 HWPX 전용으로 줄여도 과거 PDF 제출 파일 내려받기 허가 + Storage 읽기 그대로', data(acc) is not None and can_read_object(T[24], pathA), acc)
    captures.append({'kind': 'access', 'raw': acc, 'memberId': M[24], 'schoolId': s1, 'userId': T[24], 'expected': refA})
    check('L101 과거 HWPX(상한 1000 초과)도 계속 읽음', data(t24.rpc('workhub_file_access', par2, ref1['id'])) is not None)
    check('L102 HWPX 전용 뒤 과거 PDF 를 새 초안에 다시 붙이면 FILE_FAILED(새 쓰기에만 새 정책)',
          code(t23.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uB, 'expectedVersion': 1, 'input': {'text': '재저장', 'number': None, 'files': [refB]}})) == 'FILE_FAILED')
    check('L103 PDF 를 빼고 다시 저장하면 통과', data(t23.mutate({'kind': 'save_draft', 'requestId': rid, 'unitId': uB, 'expectedVersion': 1, 'input': {'text': '재저장', 'number': None, 'files': []}})) is not None)

    # 정리 원장과의 경합: 예약만 하고 올리지 않은 기본 확인 파일이 만료돼 원장에 오르면 claim 은 rejected 를 돌려준다
    run_sql("alter table workhub.file_objects disable trigger file_objects_guard;"
            f"update workhub.file_objects set upload_expires_at = now() - interval '2 days' where id = '{u3['fileId']}';"
            "alter table workhub.file_objects enable trigger file_objects_guard", 'supabase_admin')
    run_sql(f"delete from storage.objects where name='{u3['path']}'", 'supabase_admin')
    cl = worker_call('workhub_file_worker_cleanup_claim', s1, 'gc1', 50)
    check('L104 정리 작업자는 만료된 미업로드 기본 확인 파일을 원장에 올릴 수 있음(기존 정리 규칙 그대로)', u3['fileId'] in [x['fileId'] for x in cl], cl)
    r = data(claim(T[21], M[21], u3['fileId'], key()))
    check('L105 원장에 오른 파일 claim → rejected(새 임대 없음)', r == {'fileId': u3['fileId'], 'state': 'rejected', 'file': None}
          and scalar('select count(*) from workhub.file_basic_leases where file_id=%s', (u3['fileId'],)) == 0, r)
    check('L106 작업자 claim 은 끝까지 기본 확인 파일을 가져가지 않음', all(j['fileId'] not in
          scalar("select coalesce(jsonb_agg(file_id), '[]') from workhub.file_basic_checks") for j in worker_call('workhub_file_worker_claim', s1, 'w1', 20)))
    r = sqlfile('R1S-03_사후점검.sql')
    check('L107 시나리오 끝 R1S-03: FAIL 없음', not any(x[2] == 'FAIL' for x in r), [x for x in r if x[2] == 'FAIL'])


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'legacy'
    if not hb:
        print('미실행 PR #45 확인 API 코드 없음(R1S_API_DIR) — check_file 왕복 시험은 건너뛰지 않고 FAIL 로 센다')
    scenario_fresh() if mode == 'fresh' else scenario_legacy()
    if OUT:
        json.dump({'captures': captures}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'run_r1s({mode}): {sum(1 for _, ok in results if ok)}/{len(results)} 통과')
    return 0 if all(ok for _, ok in results) else 1

if __name__ == '__main__':
    sys.exit(main())
