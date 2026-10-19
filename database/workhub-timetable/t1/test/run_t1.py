# T1 시간표 1단계(편성 준비 자료 · 기준판 · 편성 초안) 시험.
# 임시 PostgreSQL 17 + Supabase 흉내. 운영과 무관. 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → JWT)로 부른다.
# 받은 응답은 T1_CAPTURE 에 남겨 app_contract_t1.ts 가 PR #65·#66 앱의 실제 서버 모듈 · parser 에 넣는다.
#
# 사용: python3 run_t1.py   (R1 + P1~P5 + P7 + P8 이 적용된 시험 DB 에서 — run_all.sh 가 준비한다. T1 은 이 시험이 설치한다)
import datetime, json, os, sys, threading
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'workhub', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, U1, T, M, TODAY, results)

S = os.path.join(HERE, '..')
W = os.path.join(HERE, '..', '..', '..', 'workhub')  # 1~8단계 SQL 폴더(T1 은 별도 폴더 database/workhub-timetable)
OUT = os.environ.get('T1_CAPTURE', '')
captures = []
DAY = lambda n=0: (TODAY + datetime.timedelta(days=n)).isoformat()
MONDAY = (TODAY - datetime.timedelta(days=TODAY.weekday())).isoformat()
FILES = ['T1-01_편성기반_모델.sql', 'T1-02_R0증분_학기기준판_제약.sql', 'T1-03_편성기반_공개함수.sql']
DEPLOY = 'PR #65·#66 미리보기 + 준비 자료 입력 화면 배포 확인(시험 합성 값)'


# ----------------------------------------------------------------------------- 도구
def src(path): return open(path, encoding='utf-8').read()
def sqlfile(path=None, text=None):
    a = admin('postgres'); cur = a.cursor()
    try:
        cur.execute(text if text is not None else src(path))
        return cur.fetchall() if cur.description else None
    finally:
        a.close()
def sqlerr(text):
    try:
        sqlfile(text=text); return 'OK'
    except psycopg2.Error as e:
        return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
def p(name): return os.path.join(S, name)
def module_sql(name, module, note):
    t = src(os.path.join(W, 'p2', name))
    for k, v in {'<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>': 'daedong-ms', '<모듈: calendar_batch · cooperation 등>': module, '<사유: 날짜와 이유>': note}.items():
        t = t.replace(k, v)
    return t
def t105(approver=U1, ref='2026-10-18 시간표 정책 확정 · 시험 승인', deploy=DEPLOY):
    return fill_json(p('T1-05_시간표활성화_양식.sql'), {'approver_user_id': approver, 'approval_ref': ref, 'app_deploy_ref': deploy})
def fingerprint(): return [r for r in sqlfile(p('T1-00_사전점검_지문.sql')) if r[0] == '지문']
def postcheck(): return sqlfile(p('T1-04_사후점검.sql'))
def n(table, where='true', args=()): return scalar(f'select count(*) from workhub.{table} where {where}', args)
def concurrently(fns):
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    for t in ts: t.join()
    return outs
def ecode(env):
    if isinstance(env, dict): return (env.get('error') or {}).get('code')
    return env
def ok(env): return isinstance(env, dict) and 'data' in env and set(env) == {'contract', 'schoolId', 'memberId', 'data'}
def d(env): return env.get('data') if isinstance(env, dict) else None


class A(Who):
    """T1 공개 함수 7개. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
    last_get = None; last_prep = None; fail_get = None; fail_prep = None
    def ctx(self):
        try: return call(self.c, 'select public.workhub_context()')
        except psycopg2.Error: return None
    def keep(self, kind, raw, **extra):
        if OUT:
            captures.append({'kind': kind, 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid}, 'context': self.ctx(),
                             'raw': raw if isinstance(raw, dict) else None, 'error': None if isinstance(raw, dict) else raw, **extra})
        return raw
    def go(self, fn, *args):
        try: return self.rpc(fn, *args)
        except psycopg2.Error as e: return e.pgerror.split('\n')[0].replace('ERROR:  ', '') if e.pgerror else str(e)
    def ready(self): return self.keep('readiness', self.go('workhub_timetable_readiness'))
    def get(self, week=MONDAY):
        r = self.go('workhub_timetable_get', week)
        if ok(r): self.last_get = r; self.fail_get = None
        elif isinstance(r, dict): self.fail_get = r
        return self.keep('get', r, week=week)
    def save(self, inp, k=None, recover=False):
        k = k or key(); return self.keep('save', self.go('workhub_timetable_save_draft', inp, k, recover), input=inp, key=k, recover=recover, getRaw=self.last_get, priorRaw=self.fail_get)
    def prep(self):
        r = self.go('workhub_timetable_preparation_get')
        if ok(r): self.last_prep = r; self.fail_prep = None
        elif isinstance(r, dict): self.fail_prep = r
        return self.keep('prep_get', r)
    def pex(self, inp, k=None, recover=False, source=None):
        k = k or key()
        return self.keep('prep_exec', self.go('workhub_timetable_preparation_execute', inp, k, recover), input=inp, key=k, recover=recover,
                         sourceRaw=source if source is not None else self.last_prep, priorRaw=self.fail_prep)
    def setup(self): return self.keep('setup_get', self.go('workhub_timetable_setup_get'))
    def sx(self, cmd, k=None, recover=False):
        k = k or key(); return self.keep('setup_exec', self.go('workhub_timetable_setup_execute', cmd, k, recover), command=cmd, key=k, recover=recover)
    # P5 수업
    def tmut(self, cmd, k=None): return self.go('workhub_teaching_mutate', cmd, k or key())
    def course(self, c): return self.go('workhub_teaching_course', c)


def course_cmd(label, term, subject, teachers, vf, vt): return {'kind': 'course_create', 'input': {'label': label, 'termId': term, 'subjectId': subject, 'teacherMemberIds': teachers, 'validFrom': vf, 'validThrough': vt}}
def roster(course, ver, rows, vf, vt): return {'kind': 'roster_import', 'courseId': course, 'expectedVersion': ver, 'rows': rows, 'validFrom': vf, 'validThrough': vt}
def srow(k, name, g, c, s): return {'schoolStudentKey': k, 'name': name, 'grade': g, 'classLabel': c, 'seatNumber': s}
def space(kind, label, cap, sid=None, ver=None): return {'kind': 'space_save', 'spaceId': sid, 'expectedVersion': ver, 'input': {'kind': kind, 'label': label, 'capacity': cap}}
def link(course, ver, classes=(), group=False, spaces=()): return {'kind': 'course_link', 'courseId': course, 'expectedVersion': ver, 'input': {'classIds': list(classes), 'studentGroup': group, 'spaceIds': list(spaces)}}
def slot(i, day, start, periods=1, length=45):
    return {'id': f's{day}-{i}', 'day': day, 'label': f'{"월화수목금"[day - 1]} {i}교시', 'startMinute': start, 'endMinute': start + length * periods, 'periods': periods}
def pin(kind, src_, draft, did=None, drev=None):
    return {'kind': kind, 'sourceRevision': src_['sourceRevision'], 'sourceFingerprint': src_['sourceFingerprint'], 'termId': src_['termId'],
            'draftId': did, 'expectedDraftRevision': drev, 'draft': draft}
def finds(sg): return sorted((f['code'], f['targetId']) for f in (sg or {}).get('findings', []))


def main():
    try:
        body()
    finally:
        if OUT:
            with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


def body():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    y_start = scalar("select starts_on::text from workhub.academic_years where id=%s", (year,))
    term1 = scalar("select id from workhub.terms where school_id=%s and term_no=1", (s1,))
    term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
    t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
    assert t2s <= DAY() and DAY(30) <= t2last, '시험은 2학기 안의 날짜에서 돈다'
    run = admin()
    call(run, "update workhub.accounts set display_name = case id when 'acc-21' then '김국어' when 'acc-22' then '이정보' when 'acc-23' then '박과학' when 'acc-24' then '최담임' else display_name end")
    # 다른 학교(school-2): m-27 을 그 학교 관리자로 · 24 는 이 학교 관리자(두 담당자 동시 확정 시험)
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'school_admin', %s)", (s1, y_start))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-kor', %s, %s, '국어', 1), ('subj-info', %s, %s, '정보', 2), ('subj-sci', %s, %s, '과학', 3)",
         (s1, year, s1, year, s1, year))
    # P1 학급(공식 학급). 이름이 아니라 ID 로만 연결한다.
    call(run, """insert into workhub.year_classes(id, school_id, academic_year_id, grade, class_no, name, kind, sort_order) values
                 ('cls-1-1', %s, %s, 1, 1, '1-1', 'regular', 1), ('cls-1-2', %s, %s, 1, 2, '1-2', 'regular', 2), ('cls-2-1', %s, %s, 2, 1, '2-1', 'regular', 3),
                 ('cls-3-1', %s, %s, 3, 1, '3-1', 'regular', 4)""", (s1, year) * 4)
    adm = A(U1, m1); a24 = A(T[24], M[24])
    t = {k: A(T[k], M[k]) for k in (21, 22, 23, 27)}

    # ======================================================================= A. 설치 전 지문 → T1-01~03 → 사후 점검 · 지문 비교
    pre = [r for r in sqlfile(p('T1-00_사전점검_지문.sql')) if r[0] == '점검']
    check('A01 T1-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    before = fingerprint()
    post0 = postcheck()
    check('A02 설치 전 T1-04: 10행 모두 info(미적용) · FAIL 없음', len(post0) == 10 and all(r[2] == 'info' for r in post0), post0)
    part = []
    for i, f in enumerate(FILES):
        sqlfile(p(f)); rows = postcheck() + sqlfile(p('T1-06_통합사후점검.sql'))
        part.append(all(r[2] in ('ok', 'info') for r in rows))
    check('A03 T1-01 → 02 → 03 하나씩: 단계마다 T1-04 · T1-06(통합 점검) FAIL 없음(부분 설치 상태)', all(part), part)
    post = postcheck()
    check('A04 전부 설치 뒤 T1-04: 01~08 ok · 09 활성화 없음 · 10 보호 트리거 7개 켜짐', [r[2] for r in post] == ['ok'] * 8 + ['info', 'ok'] and post[-2][3] == '(활성화 없음)'
          and post[-1][3] == '7개 켜짐', post)
    after = fingerprint()
    check('A05 T1-00 지문(S1~S6 구조 · D1 기존 표 전부의 행) 설치 전후 같음 — 기존 함수 · 표 · 행을 바꾸지 않음', before == after,
          [(b, a) for b, a in zip(before, after) if b != a])
    check('A06 세 파일 다시 실행 → 모두 멈춤(이미 적용)', all('이미 적용되었습니다' in sqlerr(src(p(f))) for f in FILES))
    check('A07 T1-00 은 설치 뒤에도 FAIL 없음', all(r[2] in ('ok', 'info') for r in sqlfile(p('T1-00_사전점검_지문.sql'))))
    lim = json.load(open(os.path.join(W, '..', '..', 'packages', 'timetable', '_assets', 'browser-policy.json'), encoding='utf-8'))
    app_lim = json.load(open(os.path.join(W, '..', '..', 'apps', 'workhub', 'src', 'timetable', 'limits.json'), encoding='utf-8'))
    check('A08 한도 = 앱 browser-policy.json · limits.json(drafts) 그대로', all(scalar('select workhub_private.t1_limit(%s)', (k,)) == lim[k] for k in
          ('maxLessons', 'maxResources', 'maxSlots', 'maxDomainEntries', 'maxConditions', 'maxCapacity', 'maxPeriods', 'maxCoursePeriods', 'maxWeight'))
          and scalar("select workhub_private.t1_limit('drafts')") == app_lim['drafts'])

    # ======================================================================= B. 접근 경계 · 켜기 전
    c = api(None, 'anon')
    check('B01 anon 은 시간표 공개 함수 실행 불가', all('permission denied' in err(c, s_) for s_ in (
        "select public.workhub_timetable_readiness('m-21')", "select public.workhub_timetable_preparation_get('m-21')",
        "select public.workhub_timetable_setup_execute('m-21','{}'::jsonb,'kkkkkkkk',false)")))
    check('B02 service_role 은 실행 불가(사람 전용)', 'permission denied' in err(api(None, 'service_role'), "select public.workhub_timetable_readiness('m-21')"))
    c = api(T[21])
    check('B03 authenticated 는 새 표 직접 읽기 · 내부 함수 실행 불가', all('permission denied' in err(c, f'select * from workhub.{x}')
          for x in ('timetable_spaces', 'timetable_basis_revisions', 'timetable_requests', 'timetable_prep_drafts'))
          and 'permission denied' in err(c, "select workhub_private.t1_installed('T1-01')"))
    check('B04 남의 소속 ID 로 부르면 거절(봉투 없음 — member_actor)', 'OK' != err(api(T[21]), "select public.workhub_timetable_readiness('m-22')"))
    r = adm.ready()
    check('B05 켜기 전 readiness = {available:false, reason:not_installed} · 봉투 키 정확', ok(r) and d(r) == {'available': False, 'reason': 'not_installed'}
          and r['contract'] == 'timetable.v1' and r['schoolId'] == s1 and r['memberId'] == m1, r)
    check('B06 켜기 전 get · 준비 조회 · 입력 조회 · 입력 · 준비 저장 · 편성 저장 → NOT_READY(봉투)',
          [ecode(x) for x in (adm.get(), adm.prep(), adm.setup(), adm.sx(space('room', '과학실', 1)),
                               adm.pex({'kind': 'save'}), adm.save({'basisId': 'b'}))] == ['NOT_READY'] * 6)
    rk = adm.sx(space('room', '과학실', 1), recover=True)
    check('B07 켜기 전 복구 조회(모르는 요청 번호) → NOT_FOUND(원장 먼저 — 켜기 상태와 무관)', ecode(rk) == 'NOT_FOUND', rk)
    check('B08 켜기 전 아무것도 쓰지 않음', n('timetable_spaces') == 0 and n('timetable_requests') == 0 and n('timetable_source_marks') == 0)

    # ======================================================================= C. 켜기 양식(T1-05)
    blank = src(p('T1-05_시간표활성화_양식.sql'))
    st0 = scalar("select count(*) from workhub.module_activations"), scalar("select count(*) from workhub.audit_events")
    check('C01 빈 칸이 남은 T1-05 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(blank))
    check('C02 앱 배포 확인 근거 빈칸 → 멈춤', '앱 배포 확인 근거' in sqlerr(t105(deploy=' ')))
    check('C03 승인 근거 빈칸 → 멈춤', '승인 근거는 1~200자' in sqlerr(t105(ref=' ')))
    check('C04 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(t105(approver=T[21])))
    check('C05 수업(P5)이 준비 상태가 아니면 → 멈춤', '수업(P5, teaching)이 준비 상태가 아닙니다' in sqlerr(t105()))
    check('C06 멈춘 T1-05 는 아무것도 쓰지 않음', (scalar("select count(*) from workhub.module_activations"), scalar("select count(*) from workhub.audit_events")) == st0)
    # 선행 모듈: P1 학교 관리 · P5 수업
    sqlfile(text=fill_json(os.path.join(W, 'p1', 'P1-04_학교활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인'}))
    sqlfile(text=fill_json(os.path.join(W, 'p5', 'P5-04_수업모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'counseling_scope': 'course_teachers'}))
    r = adm.ready()
    check('C07 수업만 켜고 시간표는 아직 → readiness not_installed', d(r) == {'available': False, 'reason': 'not_installed'}, r)

    # 공식 수업(P5) — 관리자가 만들고 담당 교사가 명단을 넣는다
    raw = lambda r_: r_ if isinstance(r_, dict) else {}
    def mk(label, subj, teachers, vf=t2s, vt=t2last):
        r_ = adm.tmut(course_cmd(label, term2, subj, teachers, vf, vt)); return raw(r_).get('entityId') or (d(r_) or {}).get('entityId')
    CA = mk('국어 1-1', 'subj-kor', [M[21]])
    CB = mk('국어 1-2', 'subj-kor', [M[21]]); CC = mk('정보 선택', 'subj-info', [M[22]]); CD = mk('과학 실험', 'subj-sci', [M[23]])
    CE = mk('국어 2-1', 'subj-kor', [M[24]])
    check('C08 준비: 공식 수업 5개(같은 학기 · 학기 전체)', all([CA, CB, CC, CD, CE]) and n('courses', 'term_id=%s', (term2,)) == 5, [CA, CB, CC, CD, CE])
    t[21].tmut(roster(CA, 1, [srow('S-1', '김가', 1, '1', 1), srow('S-2', '이나', 1, '1', 2)], t2s, t2last))
    t[21].tmut(roster(CB, 1, [srow('S-3', '박다', 1, '2', 1)], t2s, t2last))
    t[22].tmut(roster(CC, 1, [srow('S-1', '김가', 1, '1', 1), srow('S-3', '박다', 1, '2', 1)], t2s, t2last))
    check('C09 준비: 수강 5건(정보 선택은 1-1 · 1-2 학생이 섞임)', n('course_memberships') == 5)

    check('C10 T1-05 켜기(배포 확인 근거 포함) → 행 1 · 감사 1', sqlerr(t105()) == 'OK' and n('module_activations', "module='timetable' and state='active'") == 1
          and scalar("select details->>'app_deploy_ref' from workhub.audit_events where operation='module.activate' and resource_id=%s", (s1 + ':timetable',)) == DEPLOY)
    check('C11 T1-05 다시 → 멈춤(다시 켜기는 P2-81)', '이미 활성화 행이 있습니다' in sqlerr(t105()))

    # ======================================================================= D. 권한(정책 4: year.manage 만) · 다른 학교
    r = t[21].ready()
    check('D01 일반 교사 readiness = not_allowed', d(r) == {'available': False, 'reason': 'not_allowed'}, r)
    g = t[21].get()
    check('D02 일반 교사 get = 빈 화면 값(basis null · 설계/저장 불가 · 초안 0 · 수업 0) — 날짜별 수업은 T2',
          ok(g) and d(g) == {'basis': None, 'canDesign': False, 'canSave': False, 'drafts': [], 'weekStart': MONDAY, 'lessons': []}, g)
    check('D03 일반 교사 준비 조회 · 입력 조회 · 입력 · 준비 저장 · 편성 저장 → FORBIDDEN',
          [ecode(x) for x in (t[21].prep(), t[21].setup(), t[21].sx(space('room', '교실', 1)), t[21].pex({'kind': 'save'}), t[21].save({}))] == ['FORBIDDEN'] * 5)
    r = t[27].ready()
    check('D04 다른 학교 관리자: 그 학교는 시간표를 켜지 않음 → not_installed · 이 학교 자료를 볼 수 없음', d(r) == {'available': False, 'reason': 'not_installed'}
          and r['schoolId'] == 'school-2' and ecode(t[27].setup()) == 'NOT_READY', r)
    r = adm.ready()
    check('D05 관리자: 기준판 없음 → basis_missing', d(r) == {'available': False, 'reason': 'basis_missing'}, r)
    g = adm.get()
    check('D06 관리자 get(기준판 없음) = 빈 화면 값', d(g) == {'basis': None, 'canDesign': False, 'canSave': False, 'drafts': [], 'weekStart': MONDAY, 'lessons': []}, g)
    tue = (datetime.date.fromisoformat(MONDAY) + datetime.timedelta(days=1)).isoformat()
    check('D07 get 의 주 시작이 월요일이 아니면 INVALID_INPUT', ecode(adm.get(tue)) == 'INVALID_INPUT')

    # ======================================================================= E. 미완성 조회 · 담당자 입력(정책 1~3)
    sg = d(adm.setup())
    check('E01 입력 조회: 대상 학기 = 오늘이 든 2학기 · 기준일 = 오늘 · 학급은 학년도 P1 학급(순서) · 공간 0', sg and sg['termId'] == term2 and sg['referenceDay'] == DAY()
          and [x['id'] for x in sg['classes']] == ['cls-1-1', 'cls-1-2', 'cls-2-1', 'cls-3-1'] and sg['spaces'] == [] and sg['canEdit'] is True, sg)
    check('E02 연결 없음 = 미완성(COURSE_LINK_MISSING, 확정 차단 아님 — 앱 compile 이 MISSING_STUDENTS 로 막음) · 학생 수 · 교사 이름', sg
          and finds(sg) == sorted(('COURSE_LINK_MISSING', x) for x in (CA, CB, CC, CD, CE))
          and all(f['blocksConfirm'] is False for f in sg['findings'])
          and {x['id']: (x['studentCount'], x['teacherLabels'], x['link'], x['inTimetable']) for x in sg['courses']}[CC] == (2, ['이정보'], None, True), sg)
    ps = d(adm.prep())
    check('E03 준비 원본: 시수 추정 없음(requiredPeriods 전부 null) · 자원 = 교사만(공간 · 학급 추정 없음) · 표현 불가 0', ps
          and all(c_['requiredPeriods'] is None for c_ in ps['courses']) and {r_['kind'] for r_ in ps['resources']} == {'teacher'}
          and ps['unsupportedFeatures'] == [] and ps['savedDraft'] is None and ps['canEdit'] and ps['canConfirm'] and ps['schoolLevel'] == 'middle', ps)
    rev0, fp0 = ps['sourceRevision'], ps['sourceFingerprint']
    ps2 = d(adm.prep())
    check('E04 바뀐 것이 없으면 다시 읽어도 같은 원본 판 · 지문', ps2['sourceRevision'] == rev0 and ps2['sourceFingerprint'] == fp0)
    # 공간: 정원 없이 저장 가능(미완성으로 보임) · 1 로 채우지 않음
    k_lab = key(); rl = adm.sx(space('room', '과학실', None), k_lab)
    LAB = (d(rl) or {}).get('targetId')
    check('E05 공간 저장(정원 비움) → 접수증 {requestKey, kind, targetId, version 1, sourceFingerprint}', ok(rl) and set(d(rl)) == {'requestKey', 'kind', 'targetId', 'version', 'sourceFingerprint'}
          and d(rl)['version'] == 1 and d(rl)['kind'] == 'space_save' and scalar("select capacity from workhub.timetable_spaces where id=%s", (LAB,)) is None, rl)
    check('E06 같은 요청 번호 · 같은 명령 재전송 → 같은 접수증 · 공간 1개', adm.sx(space('room', '과학실', None), k_lab) == rl and n('timetable_spaces') == 1)
    check('E07 같은 요청 번호 · 다른 명령 → IDEMPOTENCY_CONFLICT', ecode(adm.sx(space('room', '과학실', 2), k_lab)) == 'IDEMPOTENCY_CONFLICT')
    check('E08 복구 조회: 아는 요청 번호 → 원래 접수증 · 모르는 번호 → NOT_FOUND', adm.sx(space('room', '과학실', None), k_lab, recover=True) == rl
          and ecode(adm.sx(space('room', '과학실', None), recover=True)) == 'NOT_FOUND')
    bad = [space('room', '과학실2', 0), space('room', '과학실2', 1001), space('room', '과학실2', 1.5), space('room', '과학실2', '2'), space('room', ' ', 1),
           space('room', '과\x07학', 1), space('hall', '강당', 1), space('room', 'x' * 101, 1), {**space('room', '과학실2', 1), 'extra': 1},
           space('room', '과학실2', 1, sid=LAB, ver=None), {'kind': 'unknown'}, link(CA, None, ['cls-1-1'], True), link(CA, None, ['nope']),
           link(CA, None, ['cls-1-1', 'cls-1-1']), link(CA, None, [], False, ['nope']), link(CA, None, ['cls-1-1'] * 0 + ['bad id'])]
    check('E09 잘못된 입력(정원 0 · 1001 · 소수 · 문자열 · 빈 이름 · 제어 문자 · 모르는 종류 · 101자 · 남는 칸 · 판 없는 수정 · 학급과 수강집단 함께 · 모르는 학급/공간 · 중복) → INVALID_INPUT',
          [ecode(adm.sx(b)) for b in bad] == ['INVALID_INPUT'] * len(bad), [ecode(adm.sx(b)) for b in bad])
    check('E10 같은 이름 공간 하나 더 → CONFLICT(살아 있는 공간 이름은 학교 · 종류마다 하나)', ecode(adm.sx(space('room', '과학실', 3))) == 'CONFLICT')
    check('E11 없는 공간 수정 → NOT_FOUND · 판이 다르면 CONFLICT', ecode(adm.sx(space('room', '과학실', 2, sid='nope', ver=1))) == 'NOT_FOUND'
          and ecode(adm.sx(space('room', '과학실', 2, sid=LAB, ver=7))) == 'CONFLICT')
    # 수업 연결(ID 로만): 국어 1-1 → 1-1, 국어 1-2 → 1-2, 정보 선택 → 수강집단, 과학 실험 → 수강집단 + 과학실, 국어 2-1 → 2-1
    for cmd in (link(CA, None, ['cls-1-1']), link(CB, None, ['cls-1-2']), link(CC, None, [], True), link(CD, None, [], True, [LAB]), link(CE, None, ['cls-2-1'])):
        r_ = adm.sx(cmd)
        if not ok(r_): print('  연결 실패', cmd, r_)
    check('E12 처음 연결은 expectedVersion null 이어야 함 · 두 번째 null → CONFLICT · 판 다름 → CONFLICT', ecode(adm.sx(link(CA, None, ['cls-1-1']))) == 'CONFLICT'
          and ecode(adm.sx(link(CA, 5, ['cls-1-1']))) == 'CONFLICT' and n('timetable_course_links') == 5)
    sg = d(adm.setup())
    check('E13 정원 없는 공간 연결 → SPACE_CAPACITY_MISSING(확정 차단) · 수강 겹침(정보 선택 ↔ 국어 1-1 · 1-2) → STUDENT_OVERLAP(확정 차단)',
          finds(sg) == sorted([('SPACE_CAPACITY_MISSING', LAB), ('STUDENT_OVERLAP', '/'.join(sorted([CA, CC]))), ('STUDENT_OVERLAP', '/'.join(sorted([CB, CC])))])
          and all(f['blocksConfirm'] for f in sg['findings']), sg)
    ps = d(adm.prep())
    check('E14 준비 원본: 정원 없는 공간은 자원에 넣지 않음 · 표현 불가 3건 · 원본 판 +1', ps and LAB not in [r_['id'] for r_ in ps['resources']]
          and len(ps['unsupportedFeatures']) == 3 and ps['sourceRevision'] > rev0 and ps['sourceFingerprint'] != fp0, ps)
    # 같은 학생을 묶는 학급으로 다시 연결(이름 추정 없이 담당자가 고름) → 겹침 해소
    lv = {x['id']: (x['link'] or {}).get('version') for x in sg['courses']}
    r_ = adm.sx(link(CC, lv[CC], ['cls-1-1', 'cls-1-2']))
    check('E15 정보 선택을 1-1 · 1-2 두 학급에 연결(판 2) → 수강 겹침 해소', ok(r_) and d(r_)['version'] == 2
          and [f['code'] for f in d(adm.setup())['findings']] == ['SPACE_CAPACITY_MISSING'], r_)
    sp = {x['id']: x for x in d(adm.setup())['spaces']}
    check('E16 정원 있는 공간 삭제는 수업에 연결돼 있으면 CONFLICT(연결 먼저 바꿈)', ecode(adm.sx({'kind': 'space_remove', 'spaceId': LAB, 'expectedVersion': sp[LAB]['version']})) == 'CONFLICT')
    r_ = adm.sx(space('room', '과학실', 1, sid=LAB, ver=sp[LAB]['version']))
    sg = d(adm.setup())
    check('E17 정원 1 입력(판 2) → 미완성 0 · 공간 자원에 정원 그대로', ok(r_) and d(r_)['version'] == 2 and sg['findings'] == []
          and {'id': LAB, 'kind': 'room', 'label': '과학실', 'capacity': 1} in d(adm.prep())['resources'], (r_, sg))
    check('E18 접수증의 sourceFingerprint = 바뀐 뒤 준비 원본 지문', d(r_)['sourceFingerprint'] == d(adm.prep())['sourceFingerprint'])
    # 학급이 학교 구성에서 빠지면 미완성
    call(run, "update workhub.year_classes set removed_at = now() where id = 'cls-3-1'")
    r_ = adm.sx(link(CE, 1, ['cls-2-1']))
    check('E19 빠진 학급(cls-3-1)은 새로 연결할 수 없음', ecode(adm.sx(link(CE, d(r_)['version'], ['cls-3-1']))) == 'INVALID_INPUT')
    call(run, "update workhub.year_classes set removed_at = now() where id = 'cls-2-1'")
    sg = d(adm.setup())
    check('E20 연결한 학급이 나중에 빠지면 LINK_CLASS_REMOVED(확정 차단) · 연결 정보는 그대로', ('LINK_CLASS_REMOVED', CE) in finds(sg)
          and 'cls-2-1' in {x['id']: x['link'] for x in sg['courses']}[CE]['classIds'], sg)
    call(run, "update workhub.year_classes set removed_at = null where id = 'cls-2-1'")
    # 학기 중 시작 · 담당 교체 · 담당 없는 수업
    CF = mk('정보 보충', 'subj-info', [M[22]], vf=DAY(10))
    call(run, "insert into workhub.course_assignments(school_id, course_id, membership_id, account_id, valid_from, valid_to, created_by_membership_id) values (%s, %s, 'm-23', 'acc-23', %s, %s, %s)",
         (s1, CE, DAY(20), t2e, m1))
    call(run, "insert into workhub.courses(id, school_id, academic_year_id, term_id, subject_id, label, valid_from, valid_to, created_by_membership_id) values ('course-noteacher', %s, %s, %s, 'subj-kor', '국어 보충', %s, %s, %s)",
         (s1, year, term2, t2s, t2e, m1))
    sg = d(adm.setup())
    check('E21 학기 중 시작(COURSE_STARTS_LATER) · 학기 중 담당 교체(TEACHER_CHANGES_IN_TERM) = 확정 차단 · 담당 없음 · 연결 없음 = 미완성 알림',
          set(finds(sg)) == {('COURSE_STARTS_LATER', CF), ('TEACHER_CHANGES_IN_TERM', CE), ('COURSE_TEACHER_MISSING', 'course-noteacher'), ('COURSE_LINK_MISSING', 'course-noteacher')}
          and {f['code']: f['blocksConfirm'] for f in sg['findings']} == {'COURSE_STARTS_LATER': True, 'TEACHER_CHANGES_IN_TERM': True, 'COURSE_TEACHER_MISSING': False, 'COURSE_LINK_MISSING': False}
          and {x['id']: x['inTimetable'] for x in sg['courses']}[CF] is False, sg)
    ps = d(adm.prep())
    check('E22 준비 원본: 학기 중 시작 수업은 수업 목록에 없음 · 담당 없는 수업은 있음(자원 없음) · 표현 불가 2건', ps and CF not in [c_['id'] for c_ in ps['courses']]
          and {c_['id']: c_['resourceIds'] for c_ in ps['courses']}['course-noteacher'] == [] and len(ps['unsupportedFeatures']) == 2, ps)

    # ======================================================================= F. 준비 초안 저장 · 기준판 확정
    slots = [slot(1, 1, 540), slot(2, 1, 595), slot(3, 1, 650), slot(1, 2, 540), slot(2, 2, 595), slot(3, 2, 650)]
    ids = [x['id'] for x in slots]
    def plans(src_, loads):
        out = []
        for c_ in src_['courses']:
            nper = loads.get(c_['id'], 1)
            out.append({'courseId': c_['id'], 'weeklyPeriods': nper, 'blocks': [{'id': f"L{c_['id'][-6:]}-{i}", 'periods': 1, 'allowedSlotIds': ids} for i in range(nper)]})
        return out
    draft = {'title': '2학기 편성 기준', 'slots': slots, 'plans': plans(ps, {CA: 2, CB: 2})}
    k1 = key(); r1 = adm.pex(pin('save', ps, draft), k1)
    check('F01 준비 초안 저장(미완성 원본이어도 저장은 됨) → 접수증 {requestKey, kind, draftId, draftRevision 1, sourceFingerprint, basis null}', ok(r1)
          and set(d(r1)) == {'requestKey', 'kind', 'draftId', 'draftRevision', 'sourceFingerprint', 'basis'} and d(r1)['draftRevision'] == 1 and d(r1)['basis'] is None, r1)
    DID = (d(r1) or {}).get('draftId')
    ps = d(adm.prep())
    check('F02 다시 읽으면 savedDraft = 저장한 초안(판 1)', ps['savedDraft'] == {'id': DID, 'revision': 1, 'sourceFingerprint': d(r1)['sourceFingerprint'], 'draft': draft}, ps['savedDraft'])
    check('F03 같은 학기에 새 초안(draftId null) 한 번 더 → CONFLICT · 판이 다르면 CONFLICT', ecode(adm.pex(pin('save', ps, draft))) == 'CONFLICT'
          and ecode(adm.pex(pin('save', ps, draft, DID, 7))) == 'CONFLICT')
    r_ = adm.pex(pin('confirm', ps, draft, DID, 1))
    check('F04 표현 불가 조건이 남은 원본으로 확정 → INVALID_INPUT(앱 compile 과 같음) · 기준판 0', ecode(r_) == 'INVALID_INPUT' and n('timetable_basis_revisions') == 0, r_)
    # 표현 불가 해소: 학기 중 시작 수업 · 담당 교체를 원래대로(시험용 행 정리), 담당 없는 수업에 담당 · 학급
    a_ = admin('supabase_admin'); cur = a_.cursor()
    cur.execute("set session_replication_role = replica")
    cur.execute("delete from workhub.course_assignments where course_id = %s and membership_id = 'm-23'", (CE,))
    cur.execute("update workhub.courses set valid_from = %s where id = %s", (t2s, CF))
    cur.execute("update workhub.course_assignments set valid_from = %s where course_id = %s", (t2s, CF))
    a_.close()
    call(run, "insert into workhub.course_assignments(school_id, course_id, membership_id, account_id, valid_from, valid_to, created_by_membership_id) values (%s, 'course-noteacher', 'm-24', 'acc-24', %s, %s, %s)", (s1, t2s, t2e, m1))
    adm.sx(link(CF, None, ['cls-2-1']))
    ps = d(adm.prep())
    check('F05 담당 · 연결을 고친 뒤: 표현 불가 0 · 원본 판 다시 +1', ps['unsupportedFeatures'] == [] and ps['savedDraft']['sourceFingerprint'] != ps['sourceFingerprint'], ps)
    draft2 = {'title': '2학기 편성 기준', 'slots': slots, 'plans': plans(ps, {CA: 2, CB: 2})}
    r_ = adm.pex(pin('confirm', ps, draft2, DID, 1))
    check('F06 담당 없는 수업 · 학생 연결 없는 수업이 남으면 확정 → INVALID_INPUT(MISSING_STUDENTS — course-noteacher 연결 없음)', ecode(r_) == 'INVALID_INPUT', r_)
    adm.sx(link('course-noteacher', None, ['cls-2-1']))
    ps = d(adm.prep())
    old = pin('save', ps, draft2, DID, 1)
    draft3 = {'title': '2학기 편성 기준', 'slots': slots, 'plans': plans(ps, {CA: 2, CB: 2})}
    bad_load = {**draft3, 'plans': [dict(x, weeklyPeriods=x['weeklyPeriods'] + 1) if x['courseId'] == CA else x for x in draft3['plans']]}
    check('F07 시수와 활동 차시 합이 다르면 확정 → INVALID_INPUT(저장은 됨 — 미완성 초안)', ecode(adm.pex(pin('confirm', ps, bad_load, DID, 1))) == 'INVALID_INPUT')
    zero = {**draft3, 'plans': [dict(x, weeklyPeriods=0, blocks=[]) if x['courseId'] == CB else x for x in draft3['plans']]}
    check('F08 시수 0(아직 입력하지 않음)으로 확정 → INVALID_INPUT', ecode(adm.pex(pin('confirm', ps, zero, DID, 1))) == 'INVALID_INPUT')
    few = {**draft3, 'slots': slots[:2], 'plans': [dict(x, blocks=[dict(b, allowedSlotIds=['s1-1', 's1-2']) for b in x['blocks']]) for x in draft3['plans']]}
    check('F09 학급 1-1 시간 부족(배정 3차시 > 가능 2차시)으로 확정 → INVALID_INPUT(RESOURCE_PERIOD_SHORTAGE)', ecode(adm.pex(pin('confirm', ps, few, DID, 1))) == 'INVALID_INPUT')
    badref = {**draft3, 'plans': draft3['plans'][1:]}
    check('F10 원본 수업 하나를 빼먹은 초안 → INVALID_INPUT(저장도 안 됨)', ecode(adm.pex(pin('save', ps, badref, DID, 1))) == 'INVALID_INPUT')
    stale = dict(pin('confirm', ps, draft3, DID, 1), sourceRevision=ps['sourceRevision'] - 1)
    check('F11 앱이 본 원본 판 · 지문이 지금과 다르면 CONFLICT', ecode(adm.pex(stale)) == 'CONFLICT'
          and ecode(adm.pex(dict(pin('confirm', ps, draft3, DID, 1), sourceFingerprint='0' * 64))) == 'CONFLICT'
          and ecode(adm.pex(dict(pin('confirm', ps, draft3, DID, 1), termId=term1))) == 'CONFLICT')
    check('F12 거절은 원장 · 초안 · 기준판에 아무것도 남기지 않음', n('timetable_requests', "op='preparation'") == 1 and n('timetable_prep_draft_revisions') == 1 and n('timetable_basis_revisions') == 0)
    kc = key(); rc = adm.pex(pin('confirm', ps, draft3, DID, 1), kc)
    B = (d(rc) or {}).get('basis') or {}
    check('F13 확정 → 접수증 basis = 기준판 본문(판 1 · 같은 학교 · 학기 · 지문 · 지원 불가 0 · 조건 비어 있음) · 초안 판 2', ok(rc) and d(rc)['draftRevision'] == 2
          and B.get('revision') == 1 and B.get('schoolId') == s1 and B.get('termId') == term2 and B.get('sourceFingerprint') == ps['sourceFingerprint']
          and B.get('unsupportedFeatures') == [] and B.get('fixed') == [] and B.get('unavailable') == [] and B.get('preferences') == [], rc)
    want_labels = [c_['label'] + f' {i + 1}회' for pl_ in draft3['plans'] for c_ in ps['courses'] if c_['id'] == pl_['courseId'] for i in range(len(pl_['blocks']))]
    check('F14 기준판: 활동 = plans 순서 · 이름 = 수업 이름 + 순번 회 · 자원 = 원본 그대로 · 시간대 = 초안 그대로 · 시수 = 담당자 입력', B.get('resources') == ps['resources']
          and B.get('slots') == slots and [l_['label'] for l_ in B.get('lessons', [])] == want_labels
          and B.get('courseLoads') == [{'courseId': x['courseId'], 'periods': x['weeklyPeriods']} for x in draft3['plans']], B)
    check('F15 학기 칸 = 이 기준판(판 +1) · readiness available', scalar("select current_timetable_basis_id from workhub.terms where id=%s", (term2,)) == B.get('id')
          and d(adm.ready()) == {'available': True})
    check('F16 같은 요청 번호 재전송 → 같은 접수증(기준판 본문 포함) · 기준판 1개', adm.pex(pin('confirm', ps, draft3, DID, 1), kc) == rc and n('timetable_basis_revisions') == 1)
    check('F17 복구 조회 → 같은 접수증', adm.pex(pin('confirm', ps, draft3, DID, 1), kc, recover=True) == rc)
    check('F18 확정 감사: timetable.prep_confirm 1건(school 민감도 · 학생 이름 없음)', n('audit_events', "operation='timetable.prep_confirm'") == 1
          and n('audit_events', "operation like 'timetable.%%' and (sensitivity <> 'school' or details::text like '%%김가%%')") == 0)
    check('F19 기준판 · 초안 이력 · 원장은 고칠 수 없음', all(x != 'OK' for x in (
        sqlerr("update workhub.timetable_basis_revisions set revision = 9"), sqlerr("delete from workhub.timetable_prep_draft_revisions"),
        sqlerr("update workhub.timetable_requests set response = '{}'"), sqlerr("delete from workhub.timetable_source_marks"))))
    check('F20 다른 학기의 기준판을 학기 칸에 걸 수 없음(T1-02 복합 FK)', 'violates foreign key' in sqlerr(
        f"update workhub.terms set current_timetable_basis_id = '{B.get('id')}' where id = '{term1}'"))
    check('F21 기준판이 있는 학기는 지울 수 없음(FK)', sqlerr(f"delete from workhub.terms where id = '{term2}'") != 'OK')

    # ======================================================================= G. 편성 초안(timetable.v1 save_draft) · get
    g = adm.get()
    check('G01 관리자 get: basis = 확정한 기준판 · 설계/저장 가능 · 초안 0 · 수업 0(날짜별은 T2)', ok(g) and d(g)['basis'] == B and d(g)['canDesign'] is True
          and d(g)['canSave'] is True and d(g)['drafts'] == [] and d(g)['lessons'] == [] and d(g)['weekStart'] == MONDAY, g)
    L = {l_['courseId']: [] for l_ in B['lessons']}
    for l_ in B['lessons']: L[l_['courseId']].append(l_['id'])
    plan_ = {CA: ['s1-1', 's2-1'], CB: ['s1-2', 's2-2'], CC: ['s1-3'], CD: ['s1-1'], CE: ['s1-1'], CF: ['s2-3'], 'course-noteacher': ['s1-2']}
    pl = [{'lessonId': lid, 'slotId': plan_[cid][i]} for cid, lids in L.items() for i, lid in enumerate(lids)]
    cond = {'fixed': [{'lessonId': L[CA][0], 'slotId': 's1-1'}], 'unavailable': [{'resourceId': M[22], 'day': 2, 'startMinute': 540, 'endMinute': 590}],
            'preferences': [{'lessonId': L[CC][0], 'slotId': 's1-3', 'weight': 5}]}
    inp = {'basisId': B['id'], 'basisRevision': 1, 'sourceFingerprint': B['sourceFingerprint'], 'title': '1안', 'conditions': cond, 'placements': pl}
    ks = key(); rs = adm.save(inp, ks)
    check('G02 편성 초안 저장 → 접수증 {requestKey, draftId, version 1, basisRevision 1}', ok(rs) and set(d(rs)) == {'requestKey', 'draftId', 'version', 'basisRevision'}
          and d(rs)['version'] == 1 and d(rs)['basisRevision'] == 1, rs)
    check('G03 같은 요청 번호 재전송 · 복구 조회 → 같은 접수증 · 다른 내용 → IDEMPOTENCY_CONFLICT', adm.save(inp, ks) == rs and adm.save(inp, ks, recover=True) == rs
          and ecode(adm.save(dict(inp, title='2안'), ks)) == 'IDEMPOTENCY_CONFLICT' and n('timetable_drafts') == 1)
    g = adm.get()
    check('G04 get 의 drafts = 저장한 초안(id · version 1 · 기준판 · 조건 · 배치 그대로)', d(g)['drafts'] == [{'id': d(rs)['draftId'], 'version': 1, **inp}], d(g)['drafts'])
    clash = [dict(x, slotId='s1-1') if x['lessonId'] == L[CC][0] else x for x in pl]
    moved_fixed = [dict(x, slotId='s2-1') if x['lessonId'] == L[CA][0] else x for x in pl]
    on_unavail = [dict(x, slotId='s2-1') if x['lessonId'] == L[CF][0] else x for x in pl]
    bads = [dict(inp, placements=clash), dict(inp, placements=moved_fixed), dict(inp, placements=on_unavail), dict(inp, placements=pl[1:]),
            dict(inp, title=' '), dict(inp, conditions={**cond, 'fixed': [{'lessonId': 'nope', 'slotId': 's1-1'}]}), dict(inp, extra=1),
            dict(inp, conditions={**cond, 'preferences': [{'lessonId': L[CC][0], 'slotId': 's1-3', 'weight': -1}]})]
    check('G05 필수조건 위반 배치(같은 학급 겹침 · 고정 이동 · 사용 불가 시간 · 빠진 활동) · 빈 제목 · 모르는 활동 · 남는 칸 · 음수 가중치 → INVALID_INPUT',
          [ecode(adm.save(b)) for b in bads] == ['INVALID_INPUT'] * len(bads), [ecode(adm.save(b)) for b in bads])
    check('G07 다른 기준판 ID · 판 · 지문 → CONFLICT', ecode(adm.save(dict(inp, basisId='other'))) == 'CONFLICT'
          and ecode(adm.save(dict(inp, basisRevision=2))) == 'CONFLICT' and ecode(adm.save(dict(inp, sourceFingerprint='0' * 64))) == 'CONFLICT')

    # ======================================================================= H. 동시성 · 다시 확정 · 중지
    ps = d(adm.prep()); d24 = d(a24.prep())
    nxt = dict(draft3, title='2학기 편성 기준(수정)')
    o = concurrently([lambda: adm.pex(pin('confirm', ps, nxt, DID, 2)), lambda: a24.pex(pin('confirm', d24, nxt, DID, 2))])
    check('H01 두 담당자가 같은 초안 판으로 동시에 확정 → 하나만 성공(판 2) · 하나는 CONFLICT', sorted(['ok' if ok(x) else ecode(x) for x in o]) == ['CONFLICT', 'ok']
          and n('timetable_basis_revisions') == 2, o)
    B2 = next(d(x)['basis'] for x in o if ok(x))
    check('H02 새 기준판(판 2)이 학기 칸 · get 에 걸리고, 판 1 의 편성 초안은 목록에서 빠짐(기준판마다 따로)', d(adm.get())['basis'] == B2 and d(adm.get())['drafts'] == [] and B2['revision'] == 2)
    check('H03 판 1 기준으로 편성 초안 저장 → CONFLICT', ecode(adm.save(inp)) == 'CONFLICT')
    k_same = key(); same = space('equipment', '빔 프로젝터', 2)
    o = concurrently([lambda: adm.sx(space('equipment', '노트북 카트', 1)), lambda: a24.sx(space('equipment', '노트북 카트', 1))])
    check('H04 같은 이름 공간을 동시에 → 하나만 성공 · 하나는 CONFLICT', sorted(['ok' if ok(x) else ecode(x) for x in o]) == ['CONFLICT', 'ok'], o)
    o = concurrently([lambda: adm.sx(same, k_same), lambda: adm.sx(same, k_same)])
    check('H05 같은 요청 번호를 동시에 두 번 → 둘 다 같은 접수증 · 공간 1개', o[0] == o[1] and ok(o[0]) and n('timetable_spaces', "label='빔 프로젝터'") == 1, o)
    sqlfile(text=module_sql('P2-80_모듈중지.sql', 'timetable', '시험 중지'))
    check('H06 중지(P2-80) → readiness not_installed · 조회 · 쓰기 NOT_READY', d(adm.ready()) == {'available': False, 'reason': 'not_installed'}
          and ecode(adm.prep()) == 'NOT_READY' and ecode(adm.get()) == 'NOT_READY' and ecode(adm.sx(space('room', '음악실', 1))) == 'NOT_READY')
    check('H07 중지 중에도 반영된 요청의 복구 조회는 원래 접수증(기준판 본문 포함)', adm.pex(pin('confirm', ps, draft3, DID, 1), kc, recover=True) == rc
          and adm.save(inp, ks, recover=True) == rs)
    sqlfile(text=module_sql('P2-81_모듈재개.sql', 'timetable', '시험 재개'))
    check('H08 재개(P2-81) → available', d(adm.ready()) == {'available': True})

    # ======================================================================= J. 재검토 F1 · F2 — 공개 RPC 로만 만든 남은 학기의 변화
    def confirm_now(title):
        ps_ = d(adm.prep()); sd = ps_['savedDraft']
        dr = {'title': title, 'slots': slots, 'plans': plans(ps_, {CA: 2, CB: 2})}
        return ps_, sd, dr
    nb = lambda: n('timetable_basis_revisions')
    done = lambda r: isinstance(r, dict) and (r.get('ok') is True or isinstance(r.get('data'), dict))   # P1 · P5 봉투는 시간표 봉투와 모양이 다르다
    # F2: 담당 교사(m-23, 과학 실험)의 마지막 재직일을 오늘로 줄인다(P1 공개 명령). 담당 기간은 학기 끝까지 그대로.
    ps0, sd0, dr0 = confirm_now('F2 확인')
    rev_p1 = lambda: scalar("select revision from workhub.school_admin_activations where school_id=%s", (s1,))
    syear = scalar("select school_year from workhub.academic_years where id=%s", (year,))
    m23_from = scalar("select valid_from::text from workhub.memberships where id='m-23'")
    review = lambda last: {'kind': 'review_membership', 'expectedVersion': rev_p1(), 'schoolYear': syear, 'targetMemberId': M[23], 'decision': 'active',
                           'startsOn': m23_from, 'lastDay': last, 'reason': '재직 기간 정리'}
    r_ = adm.go('workhub_school_admin_mutate', review(DAY()), key())
    check('J01 [F2 준비] P1 소속 검토로 m-23 의 마지막 재직일 = 오늘(공개 명령 성공 · 담당은 학기 끝까지 그대로)', done(r_)
          and scalar("select valid_to::text from workhub.memberships where id='m-23'") == DAY(1), r_)
    sg = d(adm.setup()); ps1 = d(adm.prep())
    check('J02 [F2] 교사 재직이 학기 중 끝남 → TEACHER_LEAVES_IN_TERM(확정 차단) · 원본 판 +1 · 지문 바뀜 · 표현 불가 1건',
          finds(sg) == [('TEACHER_LEAVES_IN_TERM', CD)] and sg['findings'][0]['blocksConfirm'] is True
          and ps1['sourceRevision'] == ps0['sourceRevision'] + 1 and ps1['sourceFingerprint'] != ps0['sourceFingerprint'] and len(ps1['unsupportedFeatures']) == 1, (sg, ps1))
    b0 = nb()
    r_old = adm.pex(pin('confirm', ps0, dr0, sd0['id'], sd0['revision']))
    r_new = adm.pex(pin('confirm', ps1, dr0, sd0['id'], sd0['revision']))
    check('J03 [F2] 바뀌기 전 원본 판 · 지문으로 확정 → CONFLICT · 새 원본으로 확정 → INVALID_INPUT · 기준판 그대로', ecode(r_old) == 'CONFLICT'
          and ecode(r_new) == 'INVALID_INPUT' and nb() == b0, (r_old, r_new))
    r_ = adm.go('workhub_school_admin_mutate', review('9999-12-31'), key())
    check('J04 [F2] 재직 기간을 되돌리면(무기한) 차단 사라짐', done(r_) and d(adm.setup())['findings'] == [], r_)
    # F1: 기간이 이어지는 이동(겹침 아님)은 막지 않는다 — S-8 은 X2 를 DAY(6)까지, Y2 를 DAY(7)부터
    X2 = mk('정보 이동 전', 'subj-info', [M[22]]); Y2 = mk('국어 이동 후', 'subj-kor', [M[21]])
    rs8a = t[22].tmut(roster(X2, 1, [srow('S-8', '정이동', 2, '1', 8)], t2s, DAY(6)))
    rs8b = t[21].tmut(roster(Y2, 1, [srow('S-8', '정이동', 2, '1', 8)], DAY(7), t2last))
    for cid in (X2, Y2): adm.sx(link(cid, None, [], True))
    sg = d(adm.setup())
    check('J05 [F1] 공개 RPC: S-8 수강 X2(오늘~DAY+6) → Y2(DAY+7~) 이동 = 겹침 아님 → 미완성 0', done(rs8a) and done(rs8b) and sg['findings'] == [], (rs8a, rs8b, sg))
    ps2, sd2, dr2 = confirm_now('기간 이동 확정')
    r_ = adm.pex(pin('confirm', ps2, dr2, sd2['id'], sd2['revision']))
    check('J06 [F1] 기간이 이어지는 이동은 확정됨(정상 이동을 막지 않음)', ok(r_) and nb() == b0 + 1, r_)
    # F1: 같은 학생이 X1 은 학기 내내, Y1 은 다음 주부터 — 기준일에는 겹치지 않지만 남은 학기에 겹친다
    X1 = mk('정보 심화', 'subj-info', [M[22]]); Y1 = mk('국어 심화', 'subj-kor', [M[21]])
    for cid in (X1, Y1): adm.sx(link(cid, None, [], True))
    t[22].tmut(roster(X1, 1, [srow('S-9', '한겹침', 2, '1', 9)], t2s, t2last))
    ps3, sd3, dr3 = confirm_now('겹침 전')
    rs9 = t[21].tmut(roster(Y1, 1, [srow('S-9', '한겹침', 2, '1', 9)], DAY(7), t2last))
    sg = d(adm.setup()); ps4 = d(adm.prep())
    check('J07 [F1] 공개 RPC: S-9 를 Y1 에 다음 주부터 등록 → STUDENT_OVERLAP(X1/Y1, 확정 차단) · X2/Y2 는 겹침 아님 · 원본 판 +1 · 지문 바뀜',
          done(rs9) and finds(sg) == [('STUDENT_OVERLAP', '/'.join(sorted([X1, Y1])))] and ps4['sourceRevision'] == ps3['sourceRevision'] + 1
          and ps4['sourceFingerprint'] != ps3['sourceFingerprint'] and len(ps4['unsupportedFeatures']) == 1, (rs9, sg))
    b1 = nb()
    r_old = adm.pex(pin('confirm', ps3, dr3, sd3['id'], sd3['revision']))
    dr4 = {'title': '겹침 뒤', 'slots': slots, 'plans': plans(ps4, {CA: 2, CB: 2})}
    r_new = adm.pex(pin('confirm', ps4, dr4, sd3['id'], sd3['revision']))
    check('J08 [F1] 겹침 전 원본 판으로 확정 → CONFLICT · 새 원본으로 확정 → INVALID_INPUT · 기준판 그대로(두 수업을 같은 시간에 넣는 기준판이 생기지 않음)',
          ecode(r_old) == 'CONFLICT' and ecode(r_new) == 'INVALID_INPUT' and nb() == b1, (r_old, r_new))
    lv = {x['id']: (x['link'] or {}).get('version') for x in sg['courses']}
    adm.sx(link(Y1, lv[Y1], ['cls-2-1'])); adm.sx(link(X1, lv[X1], ['cls-2-1']))
    check('J09 [F1] 두 수업을 같은 학급 자원으로 묶으면(담당자가 ID 로 고름) 겹침 해소', d(adm.setup())['findings'] == [])

    # ======================================================================= I. 마무리
    post = postcheck()
    check('I01 사용 뒤 T1-04 FAIL 없음 · 켜기 상태', all(r_[2] in ('ok', 'info') for r_ in post) and post[-2][3] == 'daedong-ms:active', post)
    after2 = fingerprint()
    check('I02 사용 뒤에도 T1 밖 구조 지문(S1~S6) 같음', [r_ for r_ in before if not r_[1].startswith('D1')] == [r_ for r_ in after2 if not r_[1].startswith('D1')],
          [(a_[1], b_[3]) for a_, b_ in zip(before, after2) if a_ != b_])
    check('I03 원본 판 표: 학기마다 1부터 빈틈 없이', scalar("select bool_and(revision = rn) from (select revision, row_number() over (partition by term_id order by revision) rn from workhub.timetable_source_marks) z"))



if __name__ == '__main__':
    main()
