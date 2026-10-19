# P1 학교 관리 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# 받은 응답은 P1_CAPTURE 에 남겨 app_contract_p1.ts 가 PR #48 앱의 실제 parser 에 넣는다.
#
# 사용: python3 run_p1.py      (R1-01~03 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import copy, datetime, json, os, sys, threading, uuid
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, code, fixtures, fill_json, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
OUT = os.environ.get('P1_CAPTURE', '')
captures = []
D = datetime.date


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

def filled(name, values):
    return fill_json(os.path.join(S, name), values)

def fill_text(name, **kw):
    t = open(os.path.join(S, name), encoding='utf-8').read()
    for k, v in kw.items():
        t = t.replace(k, v)
    return t

def fingerprint():
    return [r for r in sqlfile('P1-00_사전점검_지문.sql') if r[0] == '지문']

def state():
    """학교 관리가 쓰는 모든 표의 요약(오류 거절 뒤 '변경 0' 확인용)"""
    return scalar("""select jsonb_build_object(
      'act', (select jsonb_agg(to_jsonb(a) - 'updated_at' order by school_id) from workhub.school_admin_activations a),
      'years', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.academic_years t),
      'terms', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.terms t),
      'schools', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.schools t),
      'dept', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.year_departments t),
      'cls', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.year_classes t),
      'subj', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.year_subjects t),
      'asg', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.staff_assignments t),
      'mem', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.memberships t),
      'roles', (select md5(string_agg(t::text, ',' order by t.id)) from workhub.membership_roles t),
      'changes', (select count(*) from workhub.school_admin_changes),
      'receipts', (select count(*) from workhub.idempotency_receipts),
      'audit', (select count(*) from workhub.audit_events),
      'outbox', (select count(*) from workhub.outbox))""")


class Admin(Who):
    """학교 관리 RPC. 응답을 앱 parser 대조용으로 남긴다."""
    def ready(self):
        v = self.rpc('workhub_school_admin_readiness')
        captures.append({'kind': 'readiness', 'scope': self.scope(), 'raw': v}); return v
    def get(self, year=None):
        v = self.rpc('workhub_school_admin_get', year)
        captures.append({'kind': 'snapshot', 'scope': self.scope(), 'raw': v, 'year': year}); return v
    def mutate(self, cmd, k=None):
        k = k or key()
        v = self.rpc('workhub_school_admin_mutate', cmd, k)
        captures.append({'kind': 'receipt', 'scope': self.scope(), 'raw': v, 'command': cmd, 'key': k}); return v
    def raw(self, fn, *args):
        try: return self.rpc(fn, *args)
        except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '')
    def scope(self): return {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid}

def ecode(env): return (env.get('error') or {}).get('code') if isinstance(env, dict) else env

def cfg_cmd(snap, mode='update', **change):
    c = {'kind': 'save_configuration', 'expectedVersion': snap['version'], 'mode': mode,
         'configuration': copy.deepcopy(snap['configuration']), 'subjects': copy.deepcopy(snap['subjects']), 'reason': '구성 정리'}
    c.update(change); return c

def draft(): return 'draft-' + str(uuid.uuid4())


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year_start = scalar("select min(starts_on) from workhub.academic_years where school_id=%s", (s1,))

    # ======================================================================= 0. 설치 전 지문 → P1-01·02·03 → 지문 비교
    before = fingerprint()
    sqlfile('P1-01_학교관리_모델.sql'); sqlfile('P1-02_학교관리_공개함수.sql')
    post = sqlfile('P1-03_사후점검.sql')
    check('A01 P1-03 사후 점검 FAIL 없음, 학교 관리 상태 not_configured',
          all(r[2] in ('ok', 'info') for r in post) and post[-1][3] == 'daedong-ms=not_configured, other-ms=not_configured', post)
    after = fingerprint()
    check('A02 P1-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A03 P1-01 다시 실행 → 멈춤', 'P1-01 이 이미 적용되었습니다' in sqlerr(open(os.path.join(S, 'P1-01_학교관리_모델.sql'), encoding='utf-8').read()))
    check('A04 P1-02 다시 실행 → 멈춤', 'P1-02 가 이미 적용되었습니다' in sqlerr(open(os.path.join(S, 'P1-02_학교관리_공개함수.sql'), encoding='utf-8').read()))

    adm = Admin(U1, m1); t = {n: Admin(T[n], M[n]) for n in (21, 22, 23, 24, 25, 26, 27, 28)}
    # ======================================================================= B. 접근 경계 · 준비 상태(설치만)
    c = api(None, 'anon')
    check('B01 anon 은 학교 관리 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_school_admin_readiness('x')"))
    c = api(None, 'service_role')
    check('B02 service_role 도 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_school_admin_get('x', null)"))
    c = api(U1)
    check('B03 authenticated 는 새 표 직접 읽기 불가', 'permission denied' in err(c, 'select * from workhub.staff_assignments'))
    check('B04 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p1_installed()"))
    check('B05 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', err(api(U2), "select public.workhub_school_admin_readiness('x')") == 'FORBIDDEN')
    check('B06 남의 소속 ID(다른 학교 m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_school_admin_get(%s, null)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('B07 소속이 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', t[28].raw('workhub_school_admin_readiness') == 'INACTIVE_MEMBERSHIP')
    r = adm.ready()
    check('B08 설치만(활성화 0) → available=false, not_configured', r.get('data') == {'available': False, 'reason': 'not_configured'}
          and r['schoolId'] == s1 and r['memberId'] == m1 and r['kind'] == 'workhub-school-admin' and r['schemaVersion'] == 1, r)
    check('B09 설치만 → get NOT_READY', ecode(adm.get()) == 'NOT_READY')
    st = state()
    check('B10 설치만 → mutate NOT_READY, 변경 0', ecode(adm.mutate({'kind': 'assign_duty'})) == 'NOT_READY' and state() == st)

    # ======================================================================= C. 활성화(P1-04)
    check('C01 P1-04 칸이 남아 있으면 멈춤', '입력 칸(<...>)을 모두 채워' in sqlerr(open(os.path.join(S, 'P1-04_학교활성화_양식.sql'), encoding='utf-8').read()))
    check('C02 P1-04 학교 관리자가 아닌 승인자 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in
          sqlerr(filled('P1-04_학교활성화_양식.sql', {'approver_user_id': T[21], 'approval_ref': '시험'})))
    sqlfile(None, text=filled('P1-04_학교활성화_양식.sql', {'approver_user_id': U1, 'approval_ref': '2026-10-16 시험 승인'}))
    check('C03 P1-04 → 활성화 1행, 판 1, 감사 1건', scalar("select revision from workhub.school_admin_activations where school_id=%s", (s1,)) == 1
          and scalar("select count(*) from workhub.audit_events where operation='school_admin.activate'") == 1)
    check('C04 P1-04 다시 실행 → 멈춤', '이미 활성화 행이 있습니다' in
          sqlerr(filled('P1-04_학교활성화_양식.sql', {'approver_user_id': U1, 'approval_ref': '다시'})))
    r = adm.ready()
    check('C05 활성화 뒤 관리자 → available=true', r.get('data') == {'available': True}, r)
    r = t[21].ready()
    check('C06 관리 역할 없는 교사 → available=false, forbidden', r.get('data') == {'available': False, 'reason': 'forbidden'}, r)
    check('C07 관리 역할 없는 교사 get → FORBIDDEN 봉투(소속 목록 없음)', ecode(t[21].get()) == 'FORBIDDEN')
    r = t[27].ready()
    check('C08 다른 학교(활성화 안 됨) 관리 역할 없는 교사 → not_configured', r.get('data') == {'available': False, 'reason': 'not_configured'}, r)

    # ======================================================================= D. 스냅샷
    g = adm.get(); s0 = data(g)
    check('D01 기본 학년도 = 오늘이 든 학년도(2026), 판 1, 학기 2, 부서·학급·교과 0',
          s0 and s0['version'] == 1 and s0['configuration']['schoolYear'] == '2026' and len(s0['configuration']['terms']) == 2
          and s0['configuration']['departments'] == [] and s0['subjects'] == [] and s0['availableYears'] == [2026]
          and s0['asOfDate'] == TODAY.isoformat(), g)
    check('D02 capabilities 셋 다 true(관리자)', s0['capabilities'] == {'configuration': True, 'memberships': True, 'assignments': True})
    mem = {x['id']: x for x in s0['memberships']}
    check('D03 소속 목록 = 이 학교 전체(다른 학교 m-27 없음), 무기한은 9999-12-31, 끝난 m-28 은 마지막 날 어제',
          M[27] not in mem and mem[M[21]]['lastDay'] == '9999-12-31' and mem[M[28]]['lastDay'] == (TODAY - datetime.timedelta(days=1)).isoformat()
          and len(mem) == scalar("select count(*) from workhub.memberships where school_id=%s", (s1,)), mem.get(M[28]))
    check('D04 응답에 이메일·Auth ID·역할 내부 정보 없음', 'auth_user_id' not in json.dumps(g) and '@x.kr' not in json.dumps(g) and 'role' not in json.dumps(s0['memberships']))
    check('D05 없는 학년도 → NOT_FOUND', ecode(adm.get(2030)) == 'NOT_FOUND')
    check('D06 범위 밖 학년도 → INVALID_INPUT', ecode(adm.rpc('workhub_school_admin_get', 2019)) == 'INVALID_INPUT')

    # ======================================================================= E. 구성 저장(update)
    cfg = s0['configuration']
    d_ids = [draft() for _ in range(3)]; c_ids = [draft() for _ in range(5)]; j_ids = [draft() for _ in range(3)]
    new_cfg = dict(cfg, departments=[{'id': d_ids[0], 'name': '교무부'}, {'id': d_ids[1], 'name': '정보부'}, {'id': d_ids[2], 'name': ' 연구부 '}],
                   classes=[{'id': c_ids[0], 'grade': '1', 'classNo': '1', 'name': '1-1', 'kind': 'regular'},
                            {'id': c_ids[1], 'grade': '1', 'classNo': '2', 'name': '1-2', 'kind': 'regular'},
                            {'id': c_ids[2], 'grade': '2', 'classNo': '1', 'name': '2-1', 'kind': 'regular'},
                            {'id': c_ids[3], 'grade': '3', 'classNo': '', 'name': '도움반', 'kind': 'special'},
                            {'id': c_ids[4], 'grade': '3', 'classNo': '', 'name': '복식반', 'kind': 'multigrade'}],
                   terms=[dict(cfg['terms'][0], name='1학기(봄)'), cfg['terms'][1]])
    cmd = cfg_cmd(s0, configuration=new_cfg, subjects=[{'id': j_ids[0], 'name': '국어'}, {'id': j_ids[1], 'name': '수학'}, {'id': j_ids[2], 'name': '정보'}],
                  reason='2026 구성 입력\n교무회의 결정')
    k_cfg = key(); rc = adm.mutate(cmd, k_cfg)
    check('E01 구성 저장 → 접수증(판 2, 학년도 2026, recordedAt ISO)', data(rc) and data(rc)['version'] == 2 and data(rc)['schoolYear'] == 2026
          and data(rc)['kind'] == 'save_configuration' and data(rc)['requestKey'] == k_cfg and data(rc)['recordedAt'].endswith('Z'), rc)
    s2 = data(adm.get())
    ids_ok = all(not x['id'].startswith('draft-') for x in s2['configuration']['departments'] + s2['configuration']['classes'] + s2['subjects'])
    check('E02 새 행은 서버 ID, 이름 앞뒤 공백 정리, 입력 순서 유지, 학년도 ID 유지',
          ids_ok and [x['name'] for x in s2['configuration']['departments']] == ['교무부', '정보부', '연구부']
          and [x['name'] for x in s2['configuration']['classes']] == ['1-1', '1-2', '2-1', '도움반', '복식반']
          and s2['configuration']['draftId'] == cfg['draftId'] and s2['version'] == 2, s2['configuration'])
    check('E03 학기 이름만 바뀌고 학기 ID 유지', s2['configuration']['terms'][0]['name'] == '1학기(봄)' and s2['configuration']['terms'][0]['id'] == cfg['terms'][0]['id'])
    ch = scalar("select jsonb_build_object('reason', reason, 'rev', revision, 'before', before_state is not null, 'after', after_state ? 'configuration', 'key', request_key) from workhub.school_admin_changes where revision=2")
    check('E04 변경 원장: 사유 줄바꿈 보존 · 전/후 · 요청 번호 · 판', ch == {'reason': '2026 구성 입력\n교무회의 결정', 'rev': 2, 'before': True, 'after': True, 'key': k_cfg}, ch)
    check('E05 감사·outbox 각 1건(school_admin.save_configuration)', scalar("select count(*) from workhub.audit_events where operation='school_admin.save_configuration'") == 1
          and scalar("select count(*) from workhub.outbox where topic='school_admin.changed'") == 1)
    # 재전송 · 멱등
    st = state(); again = adm.mutate(cmd, k_cfg)
    check('E06 같은 키·같은 원문 재전송 → 처음 접수증 그대로, 변경 0', data(again) == data(rc) and state() == st, again)
    cmd2 = dict(cmd, reason='다른 사유')
    check('E07 같은 키·다른 원문 → IDEMPOTENCY_CONFLICT, 변경 0', ecode(adm.mutate(cmd2, k_cfg)) == 'IDEMPOTENCY_CONFLICT' and state() == st)
    check('E08 오래된 판(expectedVersion 1) → CONFLICT, 변경 0', ecode(adm.mutate(dict(cmd, expectedVersion=1))) == 'CONFLICT' and state() == st)

    # ======================================================================= F. 입력 거부(INVALID_INPUT, 변경 0)
    base = cfg_cmd(s2)
    def bad(name, mutate_fn, want='INVALID_INPUT'):
        c2 = copy.deepcopy(base); mutate_fn(c2); before_s = state(); r2 = adm.mutate(c2)
        check(name, ecode(r2) == want and state() == before_s, r2)
    cf = lambda c2: c2['configuration']
    bad('F01 명령에 모르는 키', lambda c2: c2.update(extra=1))
    bad('F02 구성에 모르는 키', lambda c2: cf(c2).update(deploymentState='applied'))
    bad('F03 중학교 학년 수 4', lambda c2: cf(c2).update(gradeCount='4'))
    bad('F04 같은 학년·반 번호 중복', lambda c2: cf(c2)['classes'][1].update(classNo='1'))
    bad('F05 학급 이름 중복(앞뒤 공백 무시)', lambda c2: cf(c2)['classes'][1].update(name=' 1-1 '))
    bad('F06 학급 학년이 학년 수 초과', lambda c2: cf(c2)['classes'][0].update(grade='4'))
    bad('F07 학기 마지막 날 = 다음 학기 시작일(마지막 날 포함 → 겹침)', lambda c2: cf(c2)['terms'][0].update(lastDay=cf(c2)['terms'][1]['startsOn']))
    bad('F08 학기가 학년도 밖', lambda c2: cf(c2)['terms'][1].update(lastDay='2027-03-01'))
    bad('F09 학교 코드 변경', lambda c2: cf(c2).update(schoolCode='new-code'))
    bad('F10 update 로 학년도 숫자 변경', lambda c2: cf(c2).update(schoolYear='2027'))
    other_dept = scalar("select gen_random_uuid()::text")
    bad('F11 모르는(다른 학교·학년도) 부서 ID 주입', lambda c2: cf(c2)['departments'].append({'id': other_dept, 'name': '외부'}))
    bad('F12 숫자 자리에 문자열이 아닌 숫자', lambda c2: cf(c2).update(gradeCount=3))
    bad('F13 이름에 제어 문자', lambda c2: cf(c2)['departments'][0].update(name='교무\u0007부'))
    bad('F14 사유가 공백뿐', lambda c2: c2.update(reason='  \n '))
    bad('F15 expectedVersion 0', lambda c2: c2.update(expectedVersion=0))
    bad('F16 expectedVersion 소수', lambda c2: c2.update(expectedVersion=2.5))
    bad('F17 expectedVersion 문자열', lambda c2: c2.update(expectedVersion='2'))
    bad('F18 학년도 마지막 날 9999-12-31', lambda c2: cf(c2).update(lastDay='9999-12-31'))
    bad('F19 없는 날짜(2026-02-30)', lambda c2: cf(c2)['terms'][0].update(startsOn='2026-02-30'))
    bad('F20 학기 0개', lambda c2: cf(c2).update(terms=[]))
    bad('F21 기존 학기 번호 변경', lambda c2: cf(c2)['terms'][1].update(termNo='3'))
    bad('F22 반 번호 100', lambda c2: cf(c2)['classes'][0].update(classNo='100'))
    bad('F23 학급 유형 모름', lambda c2: cf(c2)['classes'][0].update(kind='virtual'))
    bad('F24 교과 이름 중복', lambda c2: c2['subjects'][1].update(name='국어'))
    bad('F25 교과 ID 가 구성 ID 와 중복', lambda c2: c2['subjects'][0].update(id=cf(c2)['departments'][0]['id']))
    bad('F26 사유 1001자', lambda c2: c2.update(reason='가' * 1001))
    bad('F27 kind 모름', lambda c2: c2.update(kind='drop_school'))
    bad('F28 학교 이름 101자', lambda c2: cf(c2).update(schoolName='가' * 101))
    st = state()
    check('F29 요청 번호 7자 → INVALID_INPUT', ecode(adm.mutate(base, 'k-12345')) == 'INVALID_INPUT' and state() == st)
    check('F30 명령이 배열 → INVALID_INPUT', ecode(adm.rpc('workhub_school_admin_mutate', [1], key())) == 'INVALID_INPUT')

    # ======================================================================= G. 새 학년도 · 행 바꾸기 · 학기 이동
    y27 = {'draftId': draft(), 'schoolName': cfg['schoolName'], 'schoolCode': cfg['schoolCode'], 'schoolType': 'middle', 'gradeCount': '3',
           'schoolYear': '2027', 'startsOn': '2027-03-01', 'lastDay': '2028-02-29',
           'terms': [{'id': draft(), 'termNo': '1', 'name': '1학기', 'startsOn': '2027-03-02', 'lastDay': '2027-08-15'},
                     {'id': draft(), 'termNo': '2', 'name': '2학기', 'startsOn': '2027-08-16', 'lastDay': '2028-02-29'}],
           'departments': [{'id': draft(), 'name': '교무부'}], 'classes': [{'id': draft(), 'grade': '1', 'classNo': '1', 'name': '1-1', 'kind': 'regular'}]}
    bad_y = copy.deepcopy(y27); bad_y['lastDay'] = '2027-02-29'; st = state()
    check('G01 없는 날(2027-02-29) → INVALID_INPUT', ecode(adm.mutate(cfg_cmd(s2, 'create_year', configuration=bad_y, subjects=[]))) == 'INVALID_INPUT' and state() == st)
    over = copy.deepcopy(y27); over['startsOn'] = '2027-02-20'; over['terms'][0]['startsOn'] = '2027-02-20'
    check('G02 다른 학년도와 기간 겹침 → INVALID_INPUT', ecode(adm.mutate(cfg_cmd(s2, 'create_year', configuration=over, subjects=[]))) == 'INVALID_INPUT' and state() == st)
    rc = adm.mutate(cfg_cmd(s2, 'create_year', configuration=y27, subjects=[{'id': draft(), 'name': '국어'}], reason='2027 준비'))
    check('G03 새 학년도 2027(윤년 마지막 날 2028-02-29) → 판 3', data(rc) and data(rc)['version'] == 3 and data(rc)['schoolYear'] == 2027, rc)
    s27 = data(adm.get(2027))
    check('G04 2027 구성: 같은 이름이라도 2026 행과 다른 ID(자동 병합 없음), 담당·소속 복사 없음',
          s27['configuration']['departments'][0]['id'] != s2['configuration']['departments'][0]['id'] and s27['assignments'] == []
          and s27['availableYears'] == [2026, 2027] and s27['configuration']['lastDay'] == '2028-02-29', s27['configuration'])
    check('G05 기본 조회는 여전히 오늘이 든 2026', data(adm.get())['configuration']['schoolYear'] == '2026')
    st = state()
    check('G06 같은 학년도 다시 생성 → CONFLICT, 변경 0', ecode(adm.mutate(cfg_cmd(s27, 'create_year', configuration=dict(y27, draftId=draft()), subjects=[]))) == 'CONFLICT' and state() == st)
    # 이름·번호 맞바꾸기와 학기 경계 동시 이동(중간 상태의 일시 중복이 실패로 이어지지 않음)
    s2 = data(adm.get()); c2 = cfg_cmd(s2, reason='이름 맞바꿈·학기 이동'); cc = c2['configuration']
    cc['departments'][0]['name'], cc['departments'][1]['name'] = cc['departments'][1]['name'], cc['departments'][0]['name']
    cc['classes'][0]['classNo'], cc['classes'][1]['classNo'] = '2', '1'
    cc['classes'][0]['name'], cc['classes'][1]['name'] = '1-2', '1-1'
    t1, t2 = cc['terms']
    t1['lastDay'] = (D.fromisoformat(t1['lastDay']) + datetime.timedelta(days=5)).isoformat()
    t2['startsOn'] = (D.fromisoformat(t2['startsOn']) + datetime.timedelta(days=5)).isoformat()
    rc = adm.mutate(c2)
    s2b = data(adm.get())
    check('G07 부서 이름·학급 번호 맞바꾸기 + 1학기 끝·2학기 시작 동시 이동 → 성공, ID 유지',
          data(rc) and data(rc)['version'] == 4 and [x['name'] for x in s2b['configuration']['departments']][:2] == ['정보부', '교무부']
          and s2b['configuration']['classes'][0] == dict(s2['configuration']['classes'][0], classNo='2', name='1-2')
          and s2b['configuration']['terms'][0]['lastDay'] == t1['lastDay'], (rc, s2b['configuration']))

    # ======================================================================= H. 공식 담당
    s = s2b; sc = s['configuration']
    cls11 = next(x for x in sc['classes'] if x['name'] == '1-1'); dept = sc['departments'][0]; subj = s['subjects'][0]
    y_last = sc['lastDay']
    def duty(member, kind, target, label, start, last, exp=None, year=2026):
        return {'kind': 'assign_duty', 'expectedVersion': exp, 'schoolYear': year, 'memberId': member, 'assignmentKind': kind,
                'targetId': target, 'label': label, 'startsOn': start, 'lastDay': last, 'reason': '담당 배정'}
    v = s['version']
    r = adm.mutate(duty(M[21], 'homeroom', cls11['id'], '1-1 담임', year_start.isoformat(), y_last, v)); v += 1
    check('H01 담임 배정 → 접수증', data(r) and data(r)['version'] == v and data(r)['kind'] == 'assign_duty', r)
    st = state()
    check('H02 같은 학급 주담임 기간 겹침(다른 교사) → CONFLICT, 변경 0',
          ecode(adm.mutate(duty(M[22], 'homeroom', cls11['id'], '1-1 담임', year_start.isoformat(), y_last, v))) == 'CONFLICT' and state() == st)
    r = adm.mutate(duty(M[21], 'department', dept['id'], dept['name'], year_start.isoformat(), y_last, v)); v += 1
    r = adm.mutate(duty(M[21], 'subject', subj['id'], '국어', year_start.isoformat(), y_last, v)); v += 1
    r = adm.mutate(duty(M[21], 'duty', None, '정보부장', TODAY.isoformat(), y_last, v)); v += 1
    check('H03 부서·교과·일반 업무 배정 → 접수증', data(r) and data(r)['version'] == v, r)
    st = state()
    check('H04 같은 교사·같은 부서 기간 겹침 → CONFLICT', ecode(adm.mutate(duty(M[21], 'department', dept['id'], '부서', TODAY.isoformat(), y_last, v))) == 'CONFLICT' and state() == st)
    r22 = adm.mutate(duty(M[22], 'department', dept['id'], dept['name'], year_start.isoformat(), y_last, v)); v += 1
    check('H05 부서는 여러 교사 가능', data(r22) is not None, r22)
    st = state()
    cls27 = s27['configuration']['classes'][0]['id']
    check('H06 다른 학년도(2027) 학급을 2026 담임으로 → NOT_FOUND', ecode(adm.mutate(duty(M[23], 'homeroom', cls27, '담임', year_start.isoformat(), y_last, v))) == 'NOT_FOUND' and state() == st)
    check('H07 다른 학교 교사(m-27) → NOT_FOUND', ecode(adm.mutate(duty(M[27], 'duty', None, '업무', TODAY.isoformat(), y_last, v))) == 'NOT_FOUND' and state() == st)
    check('H08 소속이 끝난 교사(m-28) 기간 → INVALID_INPUT', ecode(adm.mutate(duty(M[28], 'duty', None, '업무', TODAY.isoformat(), y_last, v))) == 'INVALID_INPUT' and state() == st)
    check('H09 학년도 밖 기간 → INVALID_INPUT', ecode(adm.mutate(duty(M[23], 'duty', None, '업무', TODAY.isoformat(), '2027-03-01', v))) == 'INVALID_INPUT' and state() == st)
    check('H10 일반 업무에 대상 ID → INVALID_INPUT', ecode(adm.mutate(duty(M[23], 'duty', cls11['id'], '업무', TODAY.isoformat(), y_last, v))) == 'INVALID_INPUT' and state() == st)
    check('H11 담임에 대상 없음 → INVALID_INPUT', ecode(adm.mutate(duty(M[23], 'homeroom', None, '담임', TODAY.isoformat(), y_last, v))) == 'INVALID_INPUT' and state() == st)
    check('H12 없는 학년도 2030 → NOT_FOUND', ecode(adm.mutate(duty(M[23], 'duty', None, '업무', TODAY.isoformat(), y_last, v, 2030))) == 'NOT_FOUND' and state() == st)
    check('H13 관리 권한 없는 교사의 배정 → FORBIDDEN', ecode(t[21].mutate(duty(M[23], 'duty', None, '업무', TODAY.isoformat(), y_last, v))) == 'FORBIDDEN' and state() == st)
    # 업무실 관계(workhub_context · member_relations)
    ctx21 = call(api(T[21]), 'select public.workhub_context()')
    me = next(x for x in ctx21['memberships'] if x['id'] == M[21]); lab = ctx21['schoolLabels'][s1]
    check('H14 workhub_context: 담당에서 부서·학년·교과 관계, 이름 표시는 현재 학년도 정의',
          me['departmentIds'] == [dept['id']] and me['gradeIds'] == ['1'] and me['subjectIds'] == [subj['id']]
          and {'id': dept['id'], 'name': dept['name']} in lab['departmentIds'] and {'id': subj['id'], 'name': '국어'} in lab['subjectIds']
          and not any(x['id'] == s27['configuration']['departments'][0]['id'] for x in lab['departmentIds']), (me, lab))
    ctx27 = call(api(T[27]), 'select public.workhub_context()')
    check('H15 다른 학교 교사의 관계·이름표에 섞이지 않음', ctx27['schoolLabels'].get('school-2', {}).get('subjectIds') == []
          and all(x['departmentIds'] == [] for x in ctx27['memberships']), ctx27)
    m22 = next(x for x in call(api(T[22]), 'select public.workhub_context()')['memberships'] if x['id'] == M[22])
    check('H16 부서 담당만인 교사: 학년·교과 관계 없음', m22['departmentIds'] == [dept['id']] and m22['gradeIds'] == [] and m22['subjectIds'] == [], m22)
    # 참조 중인 구성 행 빼기 / 학년도 줄이기
    s = data(adm.get()); c3 = cfg_cmd(s); c3['configuration']['departments'] = [x for x in c3['configuration']['departments'] if x['id'] != dept['id']]
    st = state()
    check('H17 공식 담당이 참조하는 부서 빼기 → CONFLICT, 변경 0', ecode(adm.mutate(c3)) == 'CONFLICT' and state() == st)
    c4 = cfg_cmd(s); c4['configuration']['lastDay'] = (D.fromisoformat(y_last) - datetime.timedelta(days=10)).isoformat()
    c4['configuration']['terms'][1]['lastDay'] = c4['configuration']['lastDay']
    check('H18 담당 기간보다 학년도를 줄이기 → CONFLICT', ecode(adm.mutate(c4)) == 'CONFLICT' and state() == st)
    unused = s['configuration']['departments'][2]['id']
    c5 = cfg_cmd(s, reason='연구부 폐지'); c5['configuration']['departments'] = [x for x in c5['configuration']['departments'] if x['id'] != unused]
    r = adm.mutate(c5); v = data(r)['version'] if data(r) else v
    check('H19 쓰이지 않는 부서 빼기 → 지우지 않고 닫음(removed_at), 원장에 이전 이름',
          data(r) and scalar("select removed_at is not null and name = '연구부' from workhub.year_departments where id=%s", (unused,))
          and scalar("select before_state::text like '%%연구부%%' from workhub.school_admin_changes where revision=%s", (v,)), r)

    # ======================================================================= I. 담당 종료
    asg = {(x['memberId'], x['kind']): x for x in data(adm.get())['assignments']}
    hr = asg[(M[21], 'homeroom')]
    def m21ctx():
        return next(x for x in call(api(T[21]), 'select public.workhub_context()')['memberships'] if x['id'] == M[21])
    def end(aid, last, exp):
        return {'kind': 'end_assignment', 'expectedVersion': exp, 'schoolYear': 2026, 'assignmentId': aid, 'lastDay': last, 'reason': '담임 교체'}
    st = state()
    check('I01 시작일보다 앞선 종료일 → INVALID_INPUT', ecode(adm.mutate(end(hr['id'], (year_start - datetime.timedelta(days=1)).isoformat(), v))) == 'INVALID_INPUT' and state() == st)
    check('I02 기존 마지막 날보다 늦게 → INVALID_INPUT', ecode(adm.mutate(end(hr['id'], (D.fromisoformat(y_last) + datetime.timedelta(days=1)).isoformat(), v))) == 'INVALID_INPUT' and state() == st)
    r = adm.mutate(end(hr['id'], TODAY.isoformat(), v)); v += 1
    a2 = next(x for x in data(adm.get())['assignments'] if x['id'] == hr['id'])
    check('I03 종료 → status ended, 마지막 날 오늘(포함), 판 올림, 행 보존', data(r) and a2['status'] == 'ended' and a2['lastDay'] == TODAY.isoformat() and a2['version'] == 2, a2)
    check('I04 종료한 담당 다시 종료 → CONFLICT', ecode(adm.mutate(end(hr['id'], TODAY.isoformat(), v))) == 'CONFLICT')
    nxt = (TODAY + datetime.timedelta(days=1)).isoformat()
    r = adm.mutate(duty(M[22], 'homeroom', cls11['id'], '1-1 담임', nxt, y_last, v)); v += 1
    check('I05 종료 다음 날부터 새 담임 → 성공(마지막 날 포함 경계)', data(r) is not None, r)
    check('I06 오늘은 아직 m-21 이 담임(종료일 포함)', m21ctx()['gradeIds'] == ['1'], m21ctx())
    r = adm.mutate(end(hr['id'], TODAY.isoformat(), v - 2))
    check('I07 이미 종료한 요청과 같은 원문을 새 키로(오래된 판) → CONFLICT', ecode(r) == 'CONFLICT')

    # ======================================================================= J. 교사 소속
    def review(target, decision, start, last, exp, reason='소속 처리'):
        return {'kind': 'review_membership', 'expectedVersion': exp, 'schoolYear': 2026, 'targetMemberId': target, 'decision': decision,
                'startsOn': start, 'lastDay': last, 'reason': reason}
    ys = year_start.isoformat()
    st = state()
    check('J01 자기 소속 변경 → FORBIDDEN', ecode(adm.mutate(review(m1, 'suspended', ys, '9999-12-31', v))) == 'FORBIDDEN' and state() == st)
    check('J02 담당이 남은 교사 중지 → CONFLICT', ecode(adm.mutate(review(M[22], 'suspended', ys, '9999-12-31', v))) == 'CONFLICT' and state() == st)
    check('J03 담당보다 먼저 끝나는 소속 종료 → CONFLICT', ecode(adm.mutate(review(M[21], 'ended', ys, (TODAY + datetime.timedelta(days=3)).isoformat(), v))) == 'CONFLICT' and state() == st)
    check('J04 종료에 무기한 마지막 날 → INVALID_INPUT', ecode(adm.mutate(review(M[23], 'ended', ys, '9999-12-31', v))) == 'INVALID_INPUT' and state() == st)
    check('J05 다른 학교 소속 → NOT_FOUND', ecode(adm.mutate(review(M[27], 'suspended', ys, '9999-12-31', v))) == 'NOT_FOUND' and state() == st)
    r = adm.mutate(review(M[23], 'suspended', ys, '9999-12-31', v)); v += 1
    check('J06 재직 → 이용 중지', data(r) and next(x for x in data(adm.get())['memberships'] if x['id'] == M[23])['status'] == 'suspended', r)
    check('J07 중지된 교사는 바로 INACTIVE_MEMBERSHIP', t[23].raw('workhub_school_admin_readiness') == 'INACTIVE_MEMBERSHIP')
    r = adm.mutate(review(M[23], 'active', ys, '9999-12-31', v)); v += 1
    check('J08 중지 → 재직', data(r) is not None and data(t[23].ready()) == {'available': False, 'reason': 'forbidden'}, r)
    last = (TODAY - datetime.timedelta(days=1)).isoformat()
    r = adm.mutate(review(M[23], 'ended', ys, last, v)); v += 1
    me23 = next(x for x in data(adm.get())['memberships'] if x['id'] == M[23])
    check('J09 재직 → 소속 종료(R0 left, left_reason other, 마지막 날 포함 변환)', data(r) and me23['status'] == 'ended' and me23['lastDay'] == last
          and scalar("select status = 'left' and left_reason = 'other' and valid_to = %s::date + 1 from workhub.memberships where id=%s", (last, M[23])), me23)
    st = state()
    check('J10 종료 → 중지(허용하지 않는 전이) → INVALID_INPUT', ecode(adm.mutate(review(M[23], 'suspended', ys, last, v))) == 'INVALID_INPUT' and state() == st)
    # 승인 대기 신청(다른 학교 교사 t27 이 이 학교에 신청) → 승인
    run = admin()
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, requested_at) values ('m-p27', %s, 'acc-27', 'pending', now())", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, requested_at) values ('m-p21', %s, 'acc-21', 'pending', now())", (s1,))
    call(run, "insert into workhub.memberships(id, school_id, account_id, status, requested_at) values ('m-p26', %s, 'acc-26', 'pending', now())", (s1,))
    sp = {x['id']: x for x in data(adm.get())['memberships']}
    check('J11 대기 신청: 시작일 = 신청일, 마지막 날 9999-12-31', sp['m-p27']['status'] == 'pending' and sp['m-p27']['startsOn'] == TODAY.isoformat()
          and sp['m-p27']['lastDay'] == '9999-12-31', sp['m-p27'])
    v = data(adm.get())['version']
    st = state()
    check('J12 대기 → 중지(허용 안 함) → INVALID_INPUT', ecode(adm.mutate(review('m-p27', 'suspended', TODAY.isoformat(), '9999-12-31', v))) == 'INVALID_INPUT' and state() == st)
    check('J13 같은 계정의 기존 재직 기간과 겹치는 승인 → CONFLICT(R0 EXCLUDE), 변경 0',
          ecode(adm.mutate(review('m-p21', 'active', TODAY.isoformat(), '9999-12-31', v))) == 'CONFLICT' and state() == st)
    r = adm.mutate(review('m-p27', 'active', TODAY.isoformat(), '2027-02-28', v)); v += 1
    check('J14 대기 → 재직(기간 지정)', data(r) and scalar("select status='active' and valid_from=%s and valid_to='2027-03-01' and decided_by_membership_id=%s from workhub.memberships where id='m-p27'", (TODAY, m1)), r)
    r = adm.mutate(review('m-p26', 'rejected', TODAY.isoformat(), '9999-12-31', v)); v += 1
    check('J15 대기 → 반려(기간 기록 없음)', data(r) and scalar("select status='rejected' and valid_from is null from workhub.memberships where id='m-p26'"), r)
    r = adm.mutate(review(M[23], 'active', TODAY.isoformat(), '9999-12-31', v)); v += 1
    check('J16 종료 → 재직 복구(새 기간), 원장에 이전 기간', data(r) and scalar("select before_state->>'status' = 'ended' and after_state->>'status' = 'active' from workhub.school_admin_changes where revision=%s", (v,)), r)
    # 관리자 역할을 가진 다른 교사 종료 → 역할 기간도 소속 마지막 날로 줄어듦
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, %s, 'school_admin', %s)", (s1, M[24], year_start))
    r = adm.mutate(review(M[24], 'ended', ys, last, v)); v += 1
    check('J17 관리자 역할을 가진 교사 종료 → 역할 마지막 날도 소속과 같게(새로 주지 않음)', data(r) and scalar(
        "select bool_and(valid_to = %s::date + 1) from workhub.membership_roles where membership_id=%s", (last, M[24])), r)
    # 게시된 수합 책임자
    call(run, "set session_replication_role = replica")
    call(run, """insert into workhub.collections(id, school_id, title, owner_membership_id, owner_account_id, academic_year_id, review_mode,
                   due_on, due_at, state, published_at, current_schema_id)
                 select 'c-p1', %s, '시험 수합', %s, 'acc-25', id, 'none', %s, now(), 'published', now(), 'sch-x' from workhub.academic_years where school_id=%s and school_year=2026""",
         (s1, M[25], TODAY, s1))
    call(run, "set session_replication_role = origin")
    st = state()
    check('J18 게시된 수합 책임자 중지 → CONFLICT(인계 먼저)', ecode(adm.mutate(review(M[25], 'suspended', ys, '9999-12-31', v))) == 'CONFLICT' and state() == st)
    check('J19 관리 권한(소속 승인) 없는 교사의 소속 변경 → FORBIDDEN', ecode(t[22].mutate(review(M[26], 'suspended', ys, '9999-12-31', v))) == 'FORBIDDEN')

    # ======================================================================= K. 동시성 · 원자성
    s = data(adm.get()); v = s['version']
    outs = []
    def go(n):
        who = Admin(U1, m1)
        outs.append(who.mutate(duty(M[26], 'duty', None, f'동시 업무 {n}', TODAY.isoformat(), y_last, v)))
    th = [threading.Thread(target=go, args=(i,)) for i in range(4)]
    [x.start() for x in th]; [x.join() for x in th]
    codes = sorted('ok' if data(o) else ecode(o) for o in outs)
    check('K01 같은 판으로 동시 변경 4건 → 1건만 성공, 나머지 CONFLICT, 판 +1', codes == ['CONFLICT', 'CONFLICT', 'CONFLICT', 'ok']
          and data(adm.get())['version'] == v + 1, codes)
    v += 1
    k_same = key(); cmd_same = duty(M[26], 'duty', None, '같은 키 동시', TODAY.isoformat(), y_last, v); outs = []
    def same():
        outs.append(Admin(U1, m1).mutate(cmd_same, k_same))
    th = [threading.Thread(target=same) for _ in range(3)]
    [x.start() for x in th]; [x.join() for x in th]
    check('K02 같은 키·같은 원문 동시 3건 → 모두 같은 접수증, 반영 1번', all(data(o) == data(outs[0]) for o in outs) and data(outs[0])
          and scalar("select count(*) from workhub.staff_assignments where label='같은 키 동시'") == 1, outs)
    v += 1
    # 응답 유실 뒤 재전송: 다른 변경으로 판이 오른 뒤에도 처음 접수증
    r_lost = adm.mutate(duty(M[26], 'duty', None, '응답 유실', TODAY.isoformat(), y_last, v), k_lost := key()); v += 1
    adm.mutate(duty(M[26], 'duty', None, '다른 변경', TODAY.isoformat(), y_last, v)); v += 1
    st = state()
    again = adm.mutate(duty(M[26], 'duty', None, '응답 유실', TODAY.isoformat(), y_last, v - 2), k_lost)
    check('K03 응답 유실 뒤 같은 키 재전송(현재 판보다 이전) → 처음 접수증, 변경 0', data(again) == data(r_lost) and state() == st, again)
    # 트랜잭션 중간 강제 실패: 원장 기록 시점에 오류 → 학교 구성·판·원장·감사·접수증 모두 그대로
    call(run, """create function public.p1_test_fail() returns trigger language plpgsql as $$
                 begin if new.reason = '강제 실패' then raise exception 'P1_TEST_FAIL'; end if; return new; end $$""")
    call(run, "create trigger p1_test_fail before insert on workhub.school_admin_changes for each row execute function public.p1_test_fail()")
    st = state()
    cfail = cfg_cmd(data(adm.get()), reason='강제 실패'); cfail['configuration']['schoolName'] = '바뀌면 안 되는 이름'
    out = adm.raw('workhub_school_admin_mutate', cfail, key())
    check('K04 중간 강제 실패 → 봉투 없는 오류(앱 RESULT_UNKNOWN), 모든 표 원상태', out == 'P1_TEST_FAIL' and state() == st, out)
    call(run, "drop trigger p1_test_fail on workhub.school_admin_changes"); call(run, "drop function public.p1_test_fail()")
    # 권한 회수 뒤 재전송: 같은 키라도 현재 권한을 먼저 본다
    k_rev = key(); c_rev = duty(M[26], 'duty', None, '회수 전', TODAY.isoformat(), y_last, v)
    r_rev = adm.mutate(c_rev, k_rev); v += 1
    call(run, "update workhub.membership_roles set revoked_at = now(), revoke_reason = 'test' where membership_id=%s and role_code='school_admin'", (m1,))
    check('K05 역할 회수 뒤 같은 키 재전송 → FORBIDDEN(접수증을 주지 않음)', ecode(adm.mutate(c_rev, k_rev)) == 'FORBIDDEN')
    call(run, "update workhub.membership_roles set revoked_at = null, revoke_reason = null where membership_id=%s and role_code='school_admin'", (m1,))

    # ======================================================================= L. 중지·재개(P1-80·81)
    sqlfile(None, text=fill_text('P1-80_학교중지.sql', **{'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>': 'daedong-ms', '<사유: 날짜와 이유>': '2026-10-16 시험 중지'}))
    check('L01 중지 → readiness not_configured, get NOT_READY', data(adm.ready()) == {'available': False, 'reason': 'not_configured'} and ecode(adm.get()) == 'NOT_READY')
    st = state()
    check('L02 중지 중 새 변경 → NOT_READY, 변경 0', ecode(adm.mutate(duty(M[26], 'duty', None, '중지 중', TODAY.isoformat(), y_last, v))) == 'NOT_READY' and state() == st)
    check('L03 중지 중에도 이미 반영된 요청 재조회 → 처음 접수증', data(adm.mutate(c_rev, k_rev)) == data(r_rev))
    check('L04 중지 중에도 업무실 관계는 그대로(담당 기록은 유효)', m21ctx()['departmentIds'] == [dept['id']], m21ctx())
    sqlfile(None, text=fill_text('P1-81_학교재개.sql', **{'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>': 'daedong-ms', '<사유: 날짜와 이유>': '2026-10-16 시험 재개'}))
    check('L05 재개 → available, 판 이어짐', data(adm.ready()) == {'available': True} and data(adm.get())['version'] == v)

    # ======================================================================= M. 마무리 점검
    post = sqlfile('P1-03_사후점검.sql')
    check('M01 P1-03 사후 점검 FAIL 없음(원장 = 판 - 1, 접수증 = 원장)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] not in ('ok', 'info')])
    check('M02 R0 일정·업무 호환 함수는 그대로 동작(업무 목록)', isinstance(call(api(T[21]), 'select public.workhub_task_list(%s)', (M[21],)), list))

    if OUT:
        json.dump({'captures': captures}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'합계: PASS {sum(1 for _, ok in results if ok)} · FAIL {sum(1 for _, ok in results if not ok)}')
    sys.exit(0 if all(ok for _, ok in results) else 1)


if __name__ == '__main__':
    main()
