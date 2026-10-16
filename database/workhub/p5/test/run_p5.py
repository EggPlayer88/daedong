# P5 수업 · 학생 · 관찰 · 상담 · 평가 · 활동 CSV 시험 (임시 PostgreSQL 17 + Supabase 흉내). 운영과 무관.
# 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → request.jwt.claims)로 부른다(R1 시험 도구 재사용).
# 받은 응답은 P5_CAPTURE 에 남겨 app_contract_p5.ts 가 PR #48 앱의 실제 수업 어댑터(createTeachingAdapter)·parser 에 넣는다.
# P4 가 먼저 적용된 DB 에서 돌리면(run_all.sh IV) 문서함의 학생 기록 초안이 P5 근거 확인으로 열리는지도 본다.
#
# 사용: python3 run_p5.py      (R1-01~03 + P1-01·02 + P2-01·02 까지 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import datetime, hashlib, json, os, sys, threading, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, fixtures, fill_json, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
P2 = os.path.join(HERE, '..', '..', 'p2')
P4 = os.path.join(HERE, '..', '..', 'p4')
OUT = os.environ.get('P5_CAPTURE', '')
captures = []
U29, U30, U31 = ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000031')
DAY = lambda n=0: (TODAY + datetime.timedelta(days=n)).isoformat()
GRADING = ['자리번호·별명', '현재 단계', '제출 여부', '나의 결정', '직접 제안', '선택한 근거', '근거를 고른 이유', '다른 사람', '영향', '필요한 조건', '심화 (평가 제외)']


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
def stop(note='점검'): sqlfile(None, text=module_sql('P2-80_모듈중지.sql', 'daedong-ms', 'teaching', note))
def resume(note='점검 끝'): sqlfile(None, text=module_sql('P2-81_모듈재개.sql', 'daedong-ms', 'teaching', note))
def fingerprint(): return [r for r in sqlfile('P5-00_사전점검_지문.sql') if r[0] == '지문']

P5_TABLES = ['teaching_policies', 'teaching_requests', 'courses', 'course_assignments', 'students', 'student_enrollments', 'course_memberships',
             'activity_imports', 'activity_items', 'activity_item_revisions', 'activity_item_omissions', 'teaching_records', 'teaching_record_revisions',
             'rubrics', 'rubric_revisions', 'assessments', 'assessment_revisions']
def state():
    """P5 표 전부 + 감사·outbox·활성화의 요약(거절 뒤 '변경 0' 확인용)"""
    parts = ','.join(f"'{t}',(select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from workhub.{t} x)" for t in P5_TABLES)
    return scalar(f"""select jsonb_build_object({parts}, 'audit', (select count(*) from workhub.audit_events),
      'outbox', (select count(*) from workhub.outbox), 'act', (select md5(string_agg(x::text, ',' order by x::text)) from workhub.module_activations x))""")
def n(table, where='true', args=()): return scalar(f'select count(*) from workhub.{table} where {where}', args)

def ok(env): return isinstance(env, dict) and env.get('ok') is True
def code(env):
    if isinstance(env, dict): return env.get('code') if env.get('ok') is False else None
    return env
def ent(env): return env['entityId'] if ok(env) else None

def concurrently(fns):
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    for t in ts: t.join()
    return outs

def sha(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()
def qcell(v):
    return '"' + v.replace('"', '""') + '"' if any(ch in v for ch in ',"\r\n') else v
def csv_text(headers, rows, bom=True):
    """BOM · CRLF · 따옴표 · 셀 안 줄바꿈이 있는 원문(디지털윤리 내보내기와 같은 꼴)"""
    return ('﻿' if bom else '') + '\r\n'.join(','.join(qcell(c) for c in r) for r in [headers, *rows]) + '\r\n'
def grading_row(alias, decision, reason='', extra='심화 응답'):
    return [alias, '제출 완료', '제출', decision, '사람이 마지막에 확인', '근거 A', reason or '이유, 쉼표 포함', '친구', '영향\n두 줄', "'=SUM(A1)", extra]
def act_input(values, picks, label='AI 수행평가 1차', on=None, kind='grading', headers=None, raw=None, supersedes=None):
    raw = raw if raw is not None else csv_text(headers or GRADING, values)
    rows = []
    for i, v in enumerate(values):
        d, sid, mid, why = picks.get(i, ('hold', None, None, ''))
        rows.append({'rowNumber': i + 2, 'alias': v[0], 'values': v, 'disposition': d, 'studentId': sid, 'courseMembershipId': mid, 'reason': why})
    return {'label': label, 'occurredOn': on or DAY(-2), 'questionVersion': 'q-2026-10', 'questionSnapshot': '자율주행 차가 사고를 피할 수 없을 때 누구를 보호해야 할까?',
            'kind': kind, 'parserVersion': 'digital-ethics.csv.v1', 'rawCsv': raw, 'fileHash': sha(raw), 'headers': headers or GRADING, 'rows': rows,
            'supersedesImportId': supersedes}


class Q(Who):
    """P5 RPC. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
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
    def catalog(self): return self.keep('catalog', self.go('workhub_teaching_catalog'))
    def course(self, c): return self.keep('course', self.go('workhub_teaching_course', c), courseId=c)
    def student(self, c, s, cur=None): return self.keep('student', self.go('workhub_teaching_student', c, s, cur), courseId=c, studentId=s, cursor=cur)
    def counsel(self, c, s, cur=None): return self.keep('counseling', self.go('workhub_teaching_counseling', c, s, cur), courseId=c, studentId=s, cursor=cur)
    def activity(self, c, i): return self.keep('activity', self.go('workhub_teaching_activity', c, i), courseId=c, importId=i)
    def rubric_rev(self, c, r, v): return self.keep('rubric_revision', self.go('workhub_teaching_rubric_revision', c, r, v), courseId=c, rubricId=r, revisionId=v)
    def mut(self, cmd, k=None):
        k = k or key(); return self.keep('mutate', self.go('workhub_teaching_mutate', cmd, k), command=cmd, key=k)


def course_cmd(label, term, subject, teachers, vf, vt): return {'kind': 'course_create', 'input': {'label': label, 'termId': term, 'subjectId': subject, 'teacherMemberIds': teachers, 'validFrom': vf, 'validThrough': vt}}
def roster(course, ver, rows, vf, vt): return {'kind': 'roster_import', 'courseId': course, 'expectedVersion': ver, 'rows': rows, 'validFrom': vf, 'validThrough': vt}
def srow(k, name, g, c, s): return {'schoolStudentKey': k, 'name': name, 'grade': g, 'classLabel': c, 'seatNumber': s}
def obs(course, st, assign, text='수업 중 토론에서 근거를 들어 의견을 말함.', rid=None, ver=0, on=None, reason='', follow='', kind='observation_save', source=None):
    c = {'kind': kind, 'courseId': course, 'studentId': st['id'], 'courseMembershipId': st['courseMembershipId'], 'assignmentId': assign, 'recordId': rid,
         'expectedVersion': ver, 'input': {'occurredOn': on or DAY(), 'text': text, 'followUpOn': follow, 'reason': reason}}
    if source: c['sourceActivity'] = source
    return c
def withdraw(kind, course, st, rid, ver, reason='잘못 기록함'): return {'kind': 'record_withdraw', 'recordKind': kind, 'courseId': course, 'studentId': st['id'], 'recordId': rid, 'expectedVersion': ver, 'reason': reason}
def rubric(course, crit, rid=None, ver=0, label='AI 수행평가 기준'): return {'kind': 'rubric_save', 'courseId': course, 'rubricId': rid, 'expectedVersion': ver, 'label': label, 'criteria': crit}
def crit(*maxes): return [{'key': f'criterion-{i + 1}', 'label': f'항목 {i + 1}', 'maximum': m} for i, m in enumerate(maxes)]
def sc(k, state='scored', pts=None): return {'criterionKey': f'criterion-{k}', 'state': state, 'points': pts}
def assess(course, st, assign, rb, rv, scores, confirmed=False, comment='근거를 비교해 판단함.', rid=None, ver=0, reason='', on=None):
    return {'kind': 'assessment_save', 'courseId': course, 'studentId': st['id'], 'courseMembershipId': st['courseMembershipId'], 'assignmentId': assign,
            'recordId': rid, 'expectedVersion': ver, 'rubricId': rb, 'rubricRevisionId': rv, 'occurredOn': on or DAY(), 'comment': comment, 'scores': scores,
            'confirmed': confirmed, 'reason': reason}
def review(course, imp, item, ver, disp, st=None, reason='교사가 확인함'):
    return {'kind': 'activity_review', 'courseId': course, 'importId': imp, 'itemId': item, 'expectedVersion': ver, 'disposition': disp,
            'studentId': st['id'] if st else None, 'courseMembershipId': st['courseMembershipId'] if st else None, 'reason': reason}
def ctx_sql(member):
    """P4 가 넘기는 것과 같은 실제 주체 맥락(시험 관리자 연결에서 직접 만들 때)"""
    return ("(select row('member', m.account_id, m.id, null, m.school_id, 's:'||m.school_id, a.auth_user_id, workhub_private.today_in(s.timezone), s.timezone)"
            "::workhub_private.actor_context from workhub.memberships m join workhub.accounts a on a.id=m.account_id join workhub.schools s on s.id=m.school_id"
            f" where m.id='{member}')")
def doc_check(member, sc_):
    return sqlerr(f"select workhub_private.p5_document_student_check({ctx_sql(member)}, '{json.dumps(sc_, ensure_ascii=False)}'::jsonb)")


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    start_day = scalar("select starts_on from workhub.academic_years where id=%s", (year,))
    term1, t1s, t1e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=1", (s1,))
    term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
    t1last = (datetime.date.fromisoformat(t1e) - datetime.timedelta(days=1)).isoformat()
    t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
    assert t2s <= DAY() <= t2last, '시험은 2학기 안의 날짜에서 돈다(오늘이 2학기 밖이면 고정 날짜를 조정)'
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
    # 학교 교과(P1 표에 직접 — 학교 관리 화면으로 만든 것과 같은 꼴). 폐지 교과 1개 포함.
    call(run, """insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order, removed_at) values
                 ('subj-ethics', %s, %s, '도덕', 1, null), ('subj-info', %s, %s, '정보', 2, null), ('subj-old', %s, %s, '폐지과목', 3, now())""",
         (s1, year, s1, year, s1, year))
    # 다른 학교(school-2): 학년도·학기·교과 + m-27 을 그 학교 관리자로
    call(run, "insert into workhub.academic_years(id, school_id, school_year, starts_on, ends_on, state) values ('y2', 'school-2', 2026, '2026-03-01', '2027-03-01', 'current')")
    call(run, "insert into workhub.terms(id, school_id, academic_year_id, term_no, label, starts_on, ends_on, state) values ('t2-1', 'school-2', 'y2', 1, '1학기', '2026-03-01', '2027-03-01', 'current')")
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj2-eth', 'school-2', 'y2', '도덕', 1)")
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")

    # ======================================================================= A. 설치 전 지문 → P5-01·02·03 → 지문 비교
    before = fingerprint()
    pre = [r for r in sqlfile('P5-00_사전점검_지문.sql') if r[0] == '점검']
    check('A01 P5-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    sqlfile('P5-01_수업학생_모델.sql'); sqlfile('P5-02_수업학생_공개함수.sql')
    post = sqlfile('P5-03_사후점검.sql')
    check('A02 P5-03 사후 점검 FAIL 없음, 활성화 없음', all(r[2] in ('ok', 'info') for r in post) and post[-1][3] == '(활성화 없음)', post)
    after = fingerprint()
    check('A03 P5-00 지문(S1~S6 구조 · D1 자료) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A04 P5-01 다시 실행 → 멈춤', 'P5-01 이 이미 적용되었습니다' in sqlerr(src('P5-01_수업학생_모델.sql')))
    check('A05 P5-02 다시 실행 → 멈춤', 'P5-02 가 이미 적용되었습니다' in sqlerr(src('P5-02_수업학생_공개함수.sql')))
    has_p4 = scalar("select to_regprocedure('workhub_private.p4_doc_student(workhub_private.actor_context,jsonb)') is not null")

    t = {k: Q(T[k], M[k]) for k in (21, 22, 23, 24, 25, 27)}
    adm = Q(U1, m1)
    # ======================================================================= B. 접근 경계 · 설치만(활성화 0)
    c = api(None, 'anon')
    check('B01 anon 은 P5 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_teaching_catalog('x')"))
    c = api(None, 'service_role')
    check('B02 service_role 은 앱 함수 실행 불가(사람 전용)', 'permission denied' in err(c, "select public.workhub_teaching_mutate('x','{}','k')"))
    c = api(T[21])
    check('B03 authenticated 는 새 표 직접 읽기 불가', all('permission denied' in err(c, f'select * from workhub.{x}') for x in ('students', 'teaching_records', 'assessments', 'activity_imports')))
    check('B04 authenticated 는 내부 함수 실행 불가', 'permission denied' in err(c, "select workhub_private.p5_installed()")
          and 'permission denied' in err(c, "select workhub_private.p5_csv('a')"))
    check('B05 superadmin 아닌 교사(U2) → FORBIDDEN(봉투 없음)', err(api(U2), "select public.workhub_teaching_catalog('m-u2')") == 'FORBIDDEN')
    check('B06 다른 학교 소속 ID(m-27) → INACTIVE_MEMBERSHIP', err(c, "select public.workhub_teaching_catalog(%s)", (M[27],)) == 'INACTIVE_MEMBERSHIP')
    check('B07 소속 기간이 끝난 교사(m-28) → INACTIVE_MEMBERSHIP', Q(T[28], M[28]).go('workhub_teaching_catalog') == 'INACTIVE_MEMBERSHIP')
    check('B08 가입 대기(m-29)·거절(m-30)·정지(m-31) → INACTIVE_MEMBERSHIP',
          [Q(u, m).go('workhub_teaching_catalog') for u, m in ((U29, 'm-29'), (U30, 'm-30'), (U31, 'm-31'))] == ['INACTIVE_MEMBERSHIP'] * 3)
    st = state()
    check('B09 설치만 → 조회 7종 모두 UNAVAILABLE(봉투)', [code(x) for x in (t[21].catalog(), t[21].course('c'), t[21].student('c', 's'), t[21].counsel('c', 's'),
          t[21].activity('c', 'i'), t[21].rubric_rev('c', 'r', 'v'))] == ['UNAVAILABLE'] * 6)
    check('B10 설치만 → 쓰기 UNAVAILABLE', code(adm.mut(course_cmd('수업', term2, 'subj-ethics', [M[21]], t2s, t2last))) == 'UNAVAILABLE')
    check('B11 설치만 → 조회·거절은 아무것도 쓰지 않음', state() == st)
    check('B12 설치만 → 문서함 학생 근거 확인 NOT_READY', doc_check(M[21], {'courseId': 'c', 'studentId': 's', 'evidence': []}) == 'NOT_READY')

    # ======================================================================= C. P5-04 수업 켜기
    p54 = os.path.join(S, 'P5-04_수업모듈활성화_양식.sql')
    good = {'approver_user_id': U1, 'approval_ref': '2026-10-20 교무회의 수업·학생 시범 승인', 'counseling_scope': 'course_teachers'}
    check('C01 빈 칸이 남은 P5-04 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(src('P5-04_수업모듈활성화_양식.sql')))
    check('C02 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(fill_json(p54, {**good, 'approver_user_id': T[21]})))
    check('C03 상담 범위 값이 목록 밖 → 멈춤', 'counseling_scope 는' in sqlerr(fill_json(p54, {**good, 'counseling_scope': 'admins'})))
    check('C04 승인 근거 빈칸 → 멈춤', '승인 근거는 1~200자' in sqlerr(fill_json(p54, {**good, 'approval_ref': ' '})))
    check('C05 멈춘 P5-04 는 아무것도 쓰지 않음', state() == st)
    check('C06 P5-04 정상 실행', sqlerr(fill_json(p54, good)) == 'OK')
    check('C07 P5-04 두 번째 → 멈춤', '이미 수업 모듈 활성화·정책이 있습니다' in sqlerr(fill_json(p54, good)))
    check('C08 준비 사유 ready · 다른 학교 policy_missing', scalar("select array[workhub_private.p5_reason(%s), workhub_private.p5_reason('school-2')]::text", (s1,)) == '{ready,policy_missing}')
    check('C09 다른 학교(m-27)는 여전히 UNAVAILABLE', code(t[27].catalog()) == 'UNAVAILABLE')
    check('C10 수업 정책 행은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.teaching_policies set counseling_scope='off'") == 'IMMUTABLE_ROW')
    check('C11 다른 학교도 켜기(상담 off)', sqlerr(fill_json(p54, {'approver_user_id': T[27], 'approval_ref': '다른 학교 시범 승인', 'counseling_scope': 'off'})) == 'OK')

    # ======================================================================= D. 수업 · 담당
    ca = adm.catalog(); c21 = t[21].catalog()
    tids = [x['id'] for x in (ca.get('approvedTeachers') or [])] if ok(ca) else []
    check('D01 관리자 카탈로그: canManageCourses · 승인 교사 목록(같은 이름 교사 둘 다, 대기·거절·정지·종료·자격 없음·다른 학교 제외)', ok(ca) and ca['canManageCourses'] is True
          and {M[22], M[23], M[21]} <= set(tids) and not {'m-29', 'm-30', 'm-31', 'm-u2', M[27], M[28]} & set(tids)
          and [x['label'] for x in ca['approvedTeachers']].count('김하늘') == 2, ca)
    check('D02 교과: 살아 있는 교과만(폐지 교과 제외) · 학기 2개(양 끝 포함 날짜)', ok(ca) and [s['id'] for s in ca['subjects']] == ['subj-ethics', 'subj-info']
          and [(x['id'], x['firstDay'], x['lastDay']) for x in ca['terms']] == [(term1, t1s, t1last), (term2, t2s, t2last)], ca)
    check('D03 일반 교사 카탈로그: 관리 불가 · 승인 교사 목록 빈 배열 · 수업 0', ok(c21) and c21['canManageCourses'] is False and c21['approvedTeachers'] == [] and c21['courses'] == [], c21)
    st = state()
    check('D04 일반 교사 수업 만들기 → FORBIDDEN', code(t[21].mut(course_cmd('도덕', term2, 'subj-ethics', [M[21]], t2s, t2last))) == 'FORBIDDEN')
    bads = [course_cmd('도덕', term2, 'subj-ethics', [M[21]], t1s, t2last),           # 학기 밖
            course_cmd('도덕', term2, 'subj-ethics', [M[21]], t2last, t2s),           # 기간 역전
            course_cmd('도덕', term2, 'subj-ethics', [M[21], M[21]], t2s, t2last),    # 같은 교사 두 번
            course_cmd('도덕', term2, 'subj-ethics', [], t2s, t2last),
            course_cmd('  ', term2, 'subj-ethics', [M[21]], t2s, t2last),
            {**course_cmd('도덕', term2, 'subj-ethics', [M[21]], t2s, t2last), 'x': 1},
            course_cmd('도덕', term2, 'subj-ethics', [M[21]], '2026-02-30', t2last)]
    check('D05 입력 규칙(학기 밖·역전·중복 교사·교사 없음·빈 이름·모르는 칸·없는 날짜) → INVALID_INPUT', [code(adm.mut(b)) for b in bads] == ['INVALID_INPUT'] * len(bads),
          [code(adm.mut(b)) for b in bads])
    nf = [course_cmd('도덕', term2, 'subj-old', [M[21]], t2s, t2last), course_cmd('도덕', term2, 'subj2-eth', [M[21]], t2s, t2last),
          course_cmd('도덕', 't2-1', 'subj-ethics', [M[21]], t2s, t2last)] + [course_cmd('도덕', term2, 'subj-ethics', [x], t2s, t2last) for x in ('m-u2', M[27], 'm-29', 'm-31', M[28])]
    check('D06 폐지 교과·다른 학교 교과/학기·업무실 못 쓰는 교사(자격 없음·다른 학교·대기·정지·종료) → NOT_FOUND', [code(adm.mut(b)) for b in nf] == ['NOT_FOUND'] * len(nf),
          [code(adm.mut(b)) for b in nf])
    check('D07 요청 번호 형식 오류 → INVALID_INPUT', code(adm.mut(course_cmd('도덕', term2, 'subj-ethics', [M[21]], t2s, t2last), 'a b')) == 'INVALID_INPUT')
    check('D08 거절은 아무것도 쓰지 않음', state() == st)
    kc = key(); cc = course_cmd('2학년 도덕 A', term2, 'subj-ethics', [M[21], M[22]], t2s, t2last)
    e = adm.mut(cc, kc); C1 = ent(e)
    check('D09 관리자 수업 만들기(교사 21·22) → 접수증 판 1', ok(e) and e['version'] == 1 and e['commandKind'] == 'course_create' and e['outcome'] == 'applied'
          and e['requestKey'] == kc and e['ownerUserId'] == U1 and e['contractVersion'] == 'teaching.v1', e)
    e2 = adm.mut(cc, kc)
    check('D10 같은 번호·같은 내용(응답 유실 뒤 재전송) → 처음 접수증(replayed), 수업 1개', ok(e2) and e2['outcome'] == 'replayed' and e2['entityId'] == C1
          and e2['appliedAt'] == e['appliedAt'] and n('courses') == 1, e2)
    check('D11 같은 번호·다른 내용 → IDEMPOTENCY_CONFLICT', code(adm.mut({**cc, 'input': {**cc['input'], 'label': '다른 이름'}}, kc)) == 'IDEMPOTENCY_CONFLICT')
    C2 = ent(adm.mut(course_cmd('2학년 정보 B', term2, 'subj-info', [M[23]], t2s, t2last)))
    C3 = ent(adm.mut(course_cmd('1학기 도덕(지난 담당)', term1, 'subj-ethics', [M[21]], t1s, t1last)))
    check('D12 같은 수업에 겹치는 담당은 DB 가 막음(겹침 제약)', 'course_assignments_no_overlap' in sqlerr(
        f"insert into workhub.course_assignments(school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id) values ('{s1}','{C1}','m-21','acc-21','{t2s}','{t2e}','{m1}')"))
    c21 = t[21].catalog(); cs = {x['id']: x for x in c21.get('courses', [])} if ok(c21) else {}
    check('D13 교사 21 카탈로그: 지금 수업은 기록·상담·명부 가능, 지난 학기 수업은 읽기만(assignmentId null)', set(cs) == {C1, C3}
          and cs[C1]['canRecord'] and cs[C1]['canCounsel'] and cs[C1]['canManageRoster'] and cs[C1]['assignmentId']
          and cs[C3]['assignmentId'] is None and not cs[C3]['canRecord'] and not cs[C3]['canCounsel'] and not cs[C3]['canManageRoster'], c21)
    A21 = cs.get(C1, {}).get('assignmentId'); A22 = {x['id']: x for x in t[22].catalog()['courses']}[C1]['assignmentId']
    A23 = {x['id']: x for x in t[23].catalog()['courses']}[C2]['assignmentId']
    check('D14 담당 없는 교사(24)는 수업 0 · 수업 상세 NOT_FOUND', t[24].catalog()['courses'] == [] and code(t[24].course(C1)) == 'NOT_FOUND')
    check('D15 다른 학교 관리자(m-27)는 이 학교 수업 NOT_FOUND', code(t[27].course(C1)) == 'NOT_FOUND')
    ca = adm.catalog()
    check('D16 관리자는 담당 없이도 모든 수업을 보되 기록 권한 없음(canRecord false, 명부만)', ok(ca) and {x['id'] for x in ca['courses']} == {C1, C2, C3}
          and all(not x['canRecord'] and not x['canCounsel'] and x['canManageRoster'] and x['assignmentId'] is None for x in ca['courses']), ca)

    # ======================================================================= E. 명부(안정 학생키 · 학적 · 수강)
    rows = [srow('S-0001', '김민준', 2, '1', 1), srow('S-0002', '김민준', 2, '1', 2), srow('S-0003', '이서연', 2, '2', 5)]
    e = t[21].mut(roster(C1, 1, rows, t2s, t2last))
    check('E01 담당 교사 명부 가져오기 → 수업 판 2 · 학생 3(같은 이름 두 명은 학생키로 구별)', ok(e) and e['entityId'] == C1 and e['version'] == 2
          and n('students') == 3 and n('course_memberships') == 3, e)
    snap = t[21].course(C1); studs = {s['schoolStudentKey']: s for s in snap['students']} if ok(snap) else {}
    SA, SB, SC = studs.get('S-0001'), studs.get('S-0002'), studs.get('S-0003')
    check('E02 수업 상세: 학생 3 · 학년·반·번호 · 수강 기간(양 끝 포함) · 기준·활동 없음', ok(snap) and len(studs) == 3 and SA['name'] == SB['name'] == '김민준'
          and SA['id'] != SB['id'] and SA['validFrom'] == t2s and SA['validThrough'] == t2last and snap['course']['version'] == 2
          and snap['rubrics'] == [] and snap['imports'] == [], snap)
    e = t[21].mut(roster(C1, 2, rows, t2s, t2last))
    check('E03 같은 명부 다시 → 판 3 · 학생·수강 늘지 않음', ok(e) and e['version'] == 3 and n('students') == 3 and n('course_memberships') == 3, e)
    st = state()
    conf = [roster(C1, 3, [srow('S-0001', '김민지', 2, '1', 1)], t2s, t2last),       # 같은 키 다른 이름
            roster(C1, 3, [srow('S-0001', '김민준', 2, '3', 9)], t2s, t2last),       # 같은 학년도 다른 학적
            roster(C1, 3, [srow('S-0009', '박지후', 2, '1', 1)], t2s, t2last),       # 이미 있는 자리
            roster(C1, 3, [srow('S-0001', '김민준', 2, '1', 1)], DAY(), t2last),     # 같은 수강 다른 기간
            roster(C1, 2, rows, t2s, t2last)]                                         # 지난 판
    check('E04 같은 키 다른 이름·다른 학적·자리 겹침·다른 수강 기간·지난 판 → CONFLICT(자동 덮어쓰기 없음)', [code(t[21].mut(x)) for x in conf] == ['CONFLICT'] * len(conf),
          [code(t[21].mut(x)) for x in conf])
    inv = [roster(C1, 3, [srow('S-0004', '최하준', 4, '1', 7)], t2s, t2last),        # 중학교 4학년
           roster(C1, 3, [srow('S-0004', '최하준', 2, '1', 7)], t1s, t2last),        # 수업 기간 밖
           roster(C1, 3, [srow('S-0004', '최하준', 2, '1', 7), srow('S-0004', '최하준', 2, '1', 8)], t2s, t2last),
           roster(C1, 3, [srow('S-0004', '최하준', 2, '1', 7), srow('S-0005', '정우진', 2, '1', 7)], t2s, t2last),
           roster(C1, 3, [srow('S-0004', '최\u0007하준', 2, '1', 7)], t2s, t2last), roster(C1, 3, [], t2s, t2last),
           roster(C1, 3, [{**srow('S-0004', '최하준', 2, '1', 7), 'grade': '2'}], t2s, t2last)]
    check('E05 학교 학년 수 초과·기간 밖·키 중복·자리 중복·제어 문자·빈 명부·문자열 학년 → INVALID_INPUT', [code(t[21].mut(x)) for x in inv] == ['INVALID_INPUT'] * len(inv),
          [code(t[21].mut(x)) for x in inv])
    check('E06 담당 아닌 교사(23)는 이 수업 명부 NOT_FOUND', code(t[23].mut(roster(C1, 3, rows, t2s, t2last))) == 'NOT_FOUND')
    check('E07 거절은 아무것도 쓰지 않음', state() == st)
    e = adm.mut(roster(C1, 3, [rows[0]], t2s, t2last))
    check('E08 관리자가 일부만 담은 명부 → 판 4, 파일에 없는 학생은 지우지 않음', ok(e) and e['version'] == 4 and len(t[21].course(C1)['students']) == 3, e)
    e = t[23].mut(roster(C2, 1, [srow('S-0001', '김민준', 2, '1', 1), srow('S-0004', '최하준', 2, '1', 7)], DAY(-30), t2last))
    check('E09 다른 수업(정보 B)은 같은 학생을 다른 기간으로 수강 가능 · 학적은 공유', ok(e) and n('students') == 4 and n('student_enrollments') == 4, e)
    outs = concurrently([lambda: t[21].mut(roster(C1, 4, [srow('S-0005', '정우진', 2, '2', 1)], t2s, t2last)),
                         lambda: t[22].mut(roster(C1, 4, [srow('S-0006', '한예린', 2, '2', 2)], t2s, t2last))])
    check('E10 같은 판으로 동시에 명부 → 하나만 반영, 하나는 CONFLICT', sorted([code(x) or 'OK' for x in outs]) == ['CONFLICT', 'OK']
          and scalar('select version from workhub.courses where id=%s', (C1,)) == 5, outs)
    VER = scalar('select version from workhub.courses where id=%s', (C1,))
    check('E11 학생·학적·수강 행은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.students set name='x'") == 'IMMUTABLE_ROW'
          and sqlerr("delete from workhub.course_memberships") == 'IMMUTABLE_ROW')

    # ======================================================================= F. 관찰 · 상담 · 철회 · 쪽 넘김
    k = key(); oc = obs(C1, SA, A21)
    e = t[21].mut(oc, k); O1 = ent(e)
    check('F01 관찰 새로 쓰기 → 판 1', ok(e) and e['version'] == 1 and e['commandKind'] == 'observation_save', e)
    sn = t[21].student(C1, SA['id']); o = (sn.get('observations') or [{}])[0] if ok(sn) else {}
    check('F02 학생 기록: 관찰 1 · 작성자 = 나 · epoch 0 · 재검토 아님 · 내용 지문 · 상담은 섞이지 않음', ok(sn) and len(sn['observations']) == 1 and o['id'] == O1
          and o['ownerUserId'] == T[21] and o['epoch'] == 0 and o['sourceReviewRequired'] is False and len(o['contentHash']) == 64 and o['kind'] == 'observation'
          and 'followUpOn' not in o and sn['nextCursor'] is None and sn['assessments'] == [], sn)
    t[21].go('workhub_teaching_mutate', oc, k)   # 응답 유실 흉내: 결과를 버리고 같은 요청을 다시
    e = t[21].mut(oc, k)
    check('F03 응답 유실 뒤 같은 번호 재전송 → replayed · 관찰 1건 · 판 기록 1', ok(e) and e['outcome'] == 'replayed' and e['entityId'] == O1
          and n('teaching_records', "owner_account_id='acc-21'") == 1 and n('teaching_record_revisions') == 1, e)
    check('F04 같은 번호·다른 본문 → IDEMPOTENCY_CONFLICT', code(t[21].mut(obs(C1, SA, A21, text='다른 본문'), k)) == 'IDEMPOTENCY_CONFLICT')
    st = state()
    check('F05 정정에 사유 없음 · 관찰에 후속일 · 새 기록인데 판 1 · 모르는 칸 → INVALID_INPUT',
          [code(t[21].mut(x)) for x in (obs(C1, SA, A21, rid=O1, ver=1), obs(C1, SA, A21, follow=DAY(3)), obs(C1, SA, A21, ver=1),
                                         {**obs(C1, SA, A21), 'owner': T[22]})] == ['INVALID_INPUT'] * 4)
    check('F06 수강·담당 기간 밖 날짜 → INVALID_INPUT', code(t[21].mut(obs(C1, SA, A21, on=t1s))) == 'INVALID_INPUT')
    check('F07 현재 담당이 아닌 assignmentId(옛 판) → CONFLICT · 다른 학생의 수강 ID → NOT_FOUND',
          code(t[21].mut(obs(C1, SA, A22))) == 'CONFLICT' and code(t[21].mut(obs(C1, {**SA, 'courseMembershipId': SB['courseMembershipId']}, A21))) == 'NOT_FOUND')
    check('F08 공동 담당(22)은 남의 관찰을 고칠 수 없음(NOT_FOUND) · 보이지도 않음', code(t[22].mut(obs(C1, SA, A22, rid=O1, ver=1, reason='수정'))) == 'NOT_FOUND'
          and t[22].student(C1, SA['id'])['observations'] == [])
    check('F09 관리자(담당 없음)는 수업을 보지만 관찰 쓰기 FORBIDDEN · 남의 관찰 0건', code(adm.mut(obs(C1, SA, A21))) == 'FORBIDDEN'
          and adm.student(C1, SA['id'])['observations'] == [])
    check('F10 지난 학기 수업(담당 끝남)에 쓰기 → FORBIDDEN', code(t[21].mut(obs(C3, SA, A21, on=t1s))) == 'FORBIDDEN')
    check('F11 수업에 없는 학생 → NOT_FOUND', code(t[21].student(C1, 'nope')) == 'NOT_FOUND')
    check('F12 거절은 아무것도 쓰지 않음', state() == st)
    e = t[21].mut(obs(C1, SA, A21, text='정정한 본문', rid=O1, ver=1, reason='날짜 착오 정정'))
    o = t[21].student(C1, SA['id'])['observations'][0]
    check('F13 정정 → 판 2 · epoch 1 · 본문 바뀜 · 원래 판 보존', ok(e) and e['version'] == 2 and o['epoch'] == 1 and o['text'] == '정정한 본문'
          and n('teaching_record_revisions', 'record_id=%s', (O1,)) == 2 and scalar("select body from workhub.teaching_record_revisions where record_id=%s and version=1", (O1,)) == oc['input']['text'], e)
    outs = concurrently([lambda: t[21].mut(obs(C1, SA, A21, text='동시 정정 1', rid=O1, ver=2, reason='a')),
                         lambda: t[21].mut(obs(C1, SA, A21, text='동시 정정 2', rid=O1, ver=2, reason='b'))])
    check('F14 같은 판으로 동시 정정 → 하나만, 하나는 CONFLICT(마지막 저장이 이기지 않음)', sorted([code(x) or 'OK' for x in outs]) == ['CONFLICT', 'OK'], outs)
    kk = key(); cmd = obs(C1, SB, A21, text='같은 번호 동시 전송')
    outs = concurrently([lambda: t[21].mut(cmd, kk), lambda: t[21].mut(cmd, kk)])
    check('F15 같은 번호 동시 전송 → 같은 기록 하나(applied 1 · replayed 1)', all(ok(x) for x in outs) and outs[0]['entityId'] == outs[1]['entityId']
          and sorted(x['outcome'] for x in outs) == ['applied', 'replayed'] and n('teaching_records', 'student_id=%s', (SB['id'],)) == 1, outs)
    # 상담
    k = key(); cc_ = obs(C1, SA, A21, text='진로 고민 상담', kind='counseling_save', follow=DAY(7))
    e = t[21].mut(cc_, k); CN = ent(e)
    cs_ = t[21].counsel(C1, SA['id'])
    check('F16 상담 쓰기 → 상담 목록에만(후속일) · 학생 기록(관찰)에는 없음', ok(e) and ok(cs_) and [r['id'] for r in cs_['records']] == [CN]
          and cs_['records'][0]['followUpOn'] == DAY(7) and cs_['records'][0]['kind'] == 'counseling'
          and CN not in [x['id'] for x in t[21].student(C1, SA['id'])['observations']], cs_)
    check('F17 관리자는 상담 FORBIDDEN(관리자 역할로 열리지 않음) · 공동 담당은 자기 상담만(0건)', code(adm.counsel(C1, SA['id'])) == 'FORBIDDEN'
          and t[22].counsel(C1, SA['id'])['records'] == [])
    check('F18 상담 정정에 활동 근거 · 관찰 명령으로 상담 정정 → 거절', code(t[21].mut({**obs(C1, SA, A21, kind='counseling_save'), 'sourceActivity': {'itemId': 'x', 'itemVersion': 1}})) == 'INVALID_INPUT'
          and code(t[21].mut(obs(C1, SA, A21, rid=CN, ver=1, reason='정정'))) == 'NOT_FOUND')
    check('F19 지난 학기 담당은 지난 상담 열람 가능(쓰기는 불가)', ok(t[21].counsel(C3, SA['id'])) if n('course_memberships', 'course_id=%s', (C3,)) else True)
    O1v = scalar('select version from workhub.teaching_records where id=%s', (O1,))
    e = t[21].mut(withdraw('observation', C1, SA, O1, O1v))
    o = [x for x in t[21].student(C1, SA['id'])['observations'] if x['id'] == O1][0]
    check('F20 관찰 철회 → 새 판(withdrawn) · epoch 증가 · 본문 보존 · 물리 삭제 없음', ok(e) and e['version'] == O1v + 1 and o['state'] == 'withdrawn'
          and o['text'] in ('동시 정정 1', '동시 정정 2') and n('teaching_records', 'id=%s', (O1,)) == 1, e)
    check('F21 철회한 기록 다시 철회·정정(되살리기) → CONFLICT', code(t[21].mut(withdraw('observation', C1, SA, O1, O1v + 1))) == 'CONFLICT'
          and code(t[21].mut(obs(C1, SA, A21, rid=O1, ver=O1v + 1, reason='되살리기'))) == 'CONFLICT')
    e = t[21].mut(withdraw('counseling', C1, SA, CN, 1))
    check('F22 상담 철회 → 판 2', ok(e) and e['version'] == 2, e)
    # 쪽 넘김: 학생 C 에 관찰 105건
    for i in range(105): t[21].go('workhub_teaching_mutate', obs(C1, SC, A21, text=f'관찰 {i:03d}'), key())
    p1 = t[21].student(C1, SC['id'])
    p2 = t[21].student(C1, SC['id'], p1.get('nextCursor'))
    ids = [x['id'] for x in p1['observations']] + [x['id'] for x in p2['observations']]
    check('F23 쪽 넘김: 100 + 5 · 중복·빠짐 없음 · 최신순 · 끝나면 nextCursor null', len(p1['observations']) == 100 and len(p2['observations']) == 5
          and len(set(ids)) == 105 and p2['nextCursor'] is None and p1['observations'][0]['text'] == '관찰 104', (len(p1['observations']), len(p2.get('observations') or [])))
    t[21].go('workhub_teaching_mutate', obs(C1, SC, A21, text='쪽 넘기는 중 새 관찰'), key())
    p2b = t[21].student(C1, SC['id'], p1['nextCursor'])
    check('F24 같은 위치 재전송 → 같은 쪽(사이에 새 기록이 생겨도 중복 없음)', [x['id'] for x in p2b['observations']] == [x['id'] for x in p2['observations']])
    check('F25 커서를 다른 학생·다른 교사·상담 목록에 쓰거나 위조 → INVALID_INPUT', [code(x) for x in (t[21].student(C1, SA['id'], p1['nextCursor']),
          t[22].student(C1, SC['id'], p1['nextCursor']), t[21].counsel(C1, SC['id'], p1['nextCursor']), t[21].student(C1, SC['id'], 'zz'),
          t[21].student(C1, SC['id'], '7b7d'))] == ['INVALID_INPUT'] * 5)

    # ======================================================================= G. 평가 기준 · 평가
    e = t[21].mut(rubric(C1, crit(10, 5.5))); R1 = ent(e)
    rb = [r for r in t[21].course(C1)['rubrics'] if r['id'] == R1][0]; RV1 = rb['revisionId']
    check('G01 평가 기준 만들기 → 판 1 · 수업 상세에 내 기준만', ok(e) and e['version'] == 1 and rb['criteria'][1]['maximum'] == 5.5 and rb['archived'] is False
          and t[22].course(C1)['rubrics'] == [], e)
    st = state()
    bad_c = [crit(), crit(0), crit(10.001), crit(10001), [{'key': 'c1', 'label': 'a', 'maximum': 1}], crit(1) + crit(1), [{'key': 'criterion-1', 'label': ' ', 'maximum': 1}],
             [{'key': 'criterion-1', 'label': 'a', 'maximum': '1'}], [{'key': 'criterion-1', 'label': 'a', 'maximum': 1, 'x': 1}]]
    check('G02 기준 규칙(빈 목록·만점 0·소수 셋째·한도 초과·키 형식·키 중복·빈 이름·문자열 만점·모르는 칸) → INVALID_INPUT',
          [code(t[21].mut(rubric(C1, x))) for x in bad_c] == ['INVALID_INPUT'] * len(bad_c), [code(t[21].mut(rubric(C1, x))) for x in bad_c])
    bad_s = [[sc(1, pts=7.5)], [sc(1, pts=11), sc(2, pts=1)], [sc(1, pts=7.555), sc(2, pts=1)], [sc(1, pts=-1), sc(2, pts=1)],
             [sc(1, 'absent', 0), sc(2, pts=1)], [sc(1, pts=None), sc(2, pts=1)], [sc(1, pts=1), sc(3, pts=1)], [sc(1, pts=1), sc(1, pts=1)],
             [sc(1, pts='7'), sc(2, pts=1)], [sc(1, 'late'), sc(2, pts=1)]]
    check('G03 점수 규칙(항목 누락·만점 초과·소수 셋째·음수·결시에 0점·채점인데 null·다른 판 항목·중복·문자열·모르는 상태) → INVALID_INPUT',
          [code(t[21].mut(assess(C1, SA, A21, R1, RV1, x))) for x in bad_s] == ['INVALID_INPUT'] * len(bad_s),
          [code(t[21].mut(assess(C1, SA, A21, R1, RV1, x))) for x in bad_s])
    check('G04 미확인 항목이 있는데 확정 → INVALID_INPUT', code(t[21].mut(assess(C1, SA, A21, R1, RV1, [sc(1, 'unconfirmed'), sc(2, pts=1)], True))) == 'INVALID_INPUT')
    check('G05 남의 기준(22 의 기준 없음 → 21 기준을 22 가) → NOT_FOUND', code(t[22].mut(assess(C1, SA, A22, R1, RV1, [sc(1, pts=1), sc(2, pts=1)]))) == 'NOT_FOUND')
    check('G06 거절은 아무것도 쓰지 않음', state() == st)
    e = t[21].mut(assess(C1, SA, A21, R1, RV1, [sc(1, pts=7.5), sc(2, pts=5)], True)); AS1 = ent(e)
    e2 = t[21].mut(assess(C1, SB, A21, R1, RV1, [sc(1, pts=0), sc(2, 'absent')], False)); AS2 = ent(e2)
    e3 = t[21].mut(assess(C1, SC, A21, R1, RV1, [sc(1, 'missing'), sc(2, 'unconfirmed')], False, comment=''))
    a1 = t[21].student(C1, SA['id'])['assessments'][0]; a2 = t[21].student(C1, SB['id'])['assessments'][0]
    check('G07 평가: 모두 채점이면 합계(12.5) · 0점과 결시가 섞이면 합계 null(0점으로 바꾸지 않음) · 빈 의견 허용', ok(e) and ok(e2) and ok(e3)
          and a1['total'] == 12.5 and a1['confirmed'] is True and a2['total'] is None and a2['scores'][0]['points'] == 0 and a2['scores'][1]['points'] is None
          and a1['sourceReviewRequired'] is False and a1['rubricRevisionId'] == RV1, (a1, a2))
    e = t[21].mut(rubric(C1, crit(20, 5.5), R1, 1, label='AI 수행평가 기준(개정)'))
    RV2 = [r for r in t[21].course(C1)['rubrics'] if r['id'] == R1][0]['revisionId']
    check('G08 기준 새 판 → 판 2 · 예전 판은 그대로(과거판 조회로 만점 10 보존)', ok(e) and e['version'] == 2 and RV2 != RV1
          and t[21].rubric_rev(C1, R1, RV1)['rubric']['criteria'][0]['maximum'] == 10 and t[21].rubric_rev(C1, R1, RV1)['rubric']['version'] == 1, e)
    check('G09 새 평가에 예전 기준판 → CONFLICT · 기존 평가 정정에서 판 바꾸기 → CONFLICT',
          code(t[21].mut(assess(C1, SC, A21, R1, RV1, [sc(1, pts=1), sc(2, pts=1)]))) == 'CONFLICT'
          and code(t[21].mut(assess(C1, SA, A21, R1, RV2, [sc(1, pts=15), sc(2, pts=1)], rid=AS1, ver=1, reason='새 기준'))) == 'CONFLICT')
    e = t[21].mut(assess(C1, SA, A21, R1, RV1, [sc(1, pts=8), sc(2, pts=5)], True, rid=AS1, ver=1, reason='채점 착오'))
    a1 = t[21].student(C1, SA['id'])['assessments'][0]
    check('G10 기존 평가는 처음 판 그대로 정정 → 판 2 · epoch 1 · 합계 13', ok(e) and a1['version'] == 2 and a1['epoch'] == 1 and a1['total'] == 13, a1)
    check('G11 과거판 조회: 남의 기준·없는 판·다른 수업 → NOT_FOUND', [code(x) for x in (t[22].rubric_rev(C1, R1, RV1), t[21].rubric_rev(C1, R1, 'nope'),
          t[23].rubric_rev(C2, R1, RV1))] == ['NOT_FOUND'] * 3)
    e = t[21].mut(withdraw('assessment', C1, SB, AS2, 1))
    check('G12 평가 철회 → 판 2(withdrawn) · 되살리기 CONFLICT', ok(e) and e['version'] == 2
          and code(t[21].mut(assess(C1, SB, A21, R1, RV1, [sc(1, pts=1), sc(2, pts=1)], rid=AS2, ver=2, reason='되살리기'))) == 'CONFLICT', e)
    check('G13 평가 판·기준 판은 고칠 수 없음(IMMUTABLE_ROW)', sqlerr("update workhub.assessment_revisions set comment='x'") == 'IMMUTABLE_ROW'
          and sqlerr("update workhub.rubric_revisions set label='x'") == 'IMMUTABLE_ROW')

    # ======================================================================= H. 활동 CSV · 채택 · 재연결 · 정정
    VER = scalar('select version from workhub.courses where id=%s', (C1,))
    vals = [grading_row('1번 별명A', '사람이 결정'), grading_row('2번, 쉼표', 'AI 가 결정'), grading_row('3번 "따옴표"', '함께 결정')]
    inp = act_input(vals, {0: ('adopt', SA['id'], SA['courseMembershipId'], ''), 2: ('exclude', None, None, '시험 응답(교사 확인)')})
    st = state()
    raw = inp['rawCsv']
    bad_i = [{**inp, 'fileHash': sha(raw + 'x')},                                                   # 지문 다름
             act_input(vals, {}, kind='dilemmas', headers=GRADING),                                 # 형식과 머리글 다름
             {**inp, 'rows': [{**inp['rows'][0], 'values': inp['rows'][0]['values'][:-1] + ['바꾼 값']}] + inp['rows'][1:]},
             {**inp, 'rows': [{**inp['rows'][0], 'rowNumber': 3}] + inp['rows'][1:]},
             act_input(vals, {0: ('adopt', 'nobody', SA['courseMembershipId'], '')}),
             act_input(vals, {2: ('exclude', None, None, '')}),
             act_input(vals, {0: ('adopt', SA['id'], SA['courseMembershipId'], ''), 1: ('adopt', SA['id'], SA['courseMembershipId'], '같은 학생')}),
             act_input(vals, {}, raw='﻿' + ','.join(GRADING) + '\r\n"열린 따옴표,a\r\n'),
             act_input(vals, {}, on=t1s), act_input(vals, {}, supersedes='imp-x'), {**inp, 'parserVersion': 'v2'},
             act_input([], {}), {**inp, 'rows': inp['rows'][:2]}]
    check('H01 원문 확인(지문·형식·값 바꿈·행 번호·수강 아닌 학생·사유 없는 제외·사유 없는 중복 연결·깨진 CSV·수업 기간 밖·정정 대상·파서판·빈 활동·행 누락) → INVALID_INPUT',
          [code(t[21].mut({'kind': 'activity_import', 'courseId': C1, 'assignmentId': A21, 'expectedVersion': VER, 'input': x})) for x in bad_i] == ['INVALID_INPUT'] * len(bad_i),
          [code(t[21].mut({'kind': 'activity_import', 'courseId': C1, 'assignmentId': A21, 'expectedVersion': VER, 'input': x})) for x in bad_i])
    check('H02 지난 수업판 → CONFLICT · 담당 아닌 교사 → NOT_FOUND', code(t[21].mut({'kind': 'activity_import', 'courseId': C1, 'assignmentId': A21, 'expectedVersion': VER - 1, 'input': inp})) == 'CONFLICT'
          and code(t[23].mut({'kind': 'activity_import', 'courseId': C1, 'assignmentId': A23, 'expectedVersion': VER, 'input': inp})) == 'NOT_FOUND')
    check('H03 거절은 아무것도 쓰지 않음', state() == st)
    ka = key(); ic = {'kind': 'activity_import', 'courseId': C1, 'assignmentId': A21, 'expectedVersion': VER, 'input': inp}
    e = t[21].mut(ic, ka); I1 = ent(e)
    av = t[21].activity(C1, I1); items = {x['rowNumber']: x for x in av.get('items', [])} if ok(av) else {}
    summ = [x for x in t[21].course(C1)['imports'] if x['id'] == I1]
    check('H04 활동 가져오기 → 판 1 · 원문 그대로 보존(BOM·CRLF·따옴표·셀 안 줄바꿈·수식 보호 작은따옴표) · 해석 값 = 원문', ok(e) and e['version'] == 1
          and scalar('select raw_csv from workhub.activity_imports where id=%s', (I1,)) == raw and items[2]['values'] == vals[0] and items[3]['alias'] == '2번, 쉼표'
          and items[2]['values'][8] == '영향\n두 줄' and items[2]['values'][9] == "'=SUM(A1)" and av['headers'] == GRADING and av['state'] == 'active', av)
    check('H05 요약: 채택 1 · 보류 1 · 제외 1 · 다른 교사에겐 안 보임', summ and (summ[0]['adopted'], summ[0]['held'], summ[0]['excluded']) == (1, 1, 1)
          and t[22].course(C1)['imports'] == [] and code(t[22].activity(C1, I1)) == 'NOT_FOUND', summ)
    e = t[21].mut(ic, ka)
    check('H06 응답 유실 뒤 같은 번호 → 같은 원문판(replayed) · 원문판 1', ok(e) and e['outcome'] == 'replayed' and e['entityId'] == I1 and n('activity_imports') == 1)
    check('H07 같은 활동 회차(같은 날·같은 이름)를 다른 번호로 → CONFLICT', code(t[21].mut(ic)) == 'CONFLICT')
    it2, it3, it4 = items[2], items[3], items[4]
    src_ = {'itemId': it2['id'], 'itemVersion': it2['version']}
    st = state()
    check('H08 활동 근거 관찰: 행 판 다름·보류 행·다른 학생·활동일 이전 날짜 → 거절', [code(t[21].mut(x)) for x in (
        obs(C1, SA, A21, source={**src_, 'itemVersion': 9}), obs(C1, SA, A21, source={'itemId': it3['id'], 'itemVersion': 1}),
        obs(C1, SB, A21, source=src_), obs(C1, SA, A21, on=DAY(-3), source=src_))] == ['CONFLICT', 'CONFLICT', 'CONFLICT', 'INVALID_INPUT'])
    check('H09 거절은 아무것도 쓰지 않음', state() == st)
    e = t[21].mut(obs(C1, SA, A21, text='활동에서 사람이 마지막에 확인해야 한다고 씀', source=src_)); OS = ent(e)
    check('H10 활동 근거 관찰 → 판 1 · 재검토 아님', ok(e) and [x for x in t[21].student(C1, SA['id'])['observations'] if x['id'] == OS][0]['sourceReviewRequired'] is False)
    st = state()
    check('H11 연결 변경: 지난 판·채택 아닌 행 철회·수강 아닌 학생·빈 사유 → 거절', [code(t[21].mut(x)) for x in (
        review(C1, I1, it3['id'], 9, 'adopt', SB), review(C1, I1, it3['id'], 1, 'withdraw'), review(C1, I1, it3['id'], 1, 'adopt', {'id': 'x', 'courseMembershipId': 'y'}),
        review(C1, I1, it3['id'], 1, 'adopt', SB, reason=' '))] == ['CONFLICT', 'CONFLICT', 'INVALID_INPUT', 'INVALID_INPUT'])
    check('H12 거절은 아무것도 쓰지 않음', state() == st)
    e = t[21].mut(review(C1, I1, it3['id'], 1, 'adopt', SB))
    av2 = t[21].activity(C1, I1)
    check('H13 보류 → 채택(학생 직접 선택) → 행 판 2 · 연결판 2 · 원문판도 판 2', ok(e) and e['entityId'] == it3['id'] and e['version'] == 2
          and av2['version'] == 2 and [x for x in av2['items'] if x['id'] == it3['id']][0]['mappingVersion'] == 2, e)
    e = t[21].mut(review(C1, I1, it2['id'], 1, 'withdraw', reason='다른 학생 응답이었음'))
    o = [x for x in t[21].student(C1, SA['id'])['observations'] if x['id'] == OS][0]
    check('H14 채택 철회 → 그 행을 쓴 관찰이 재검토 상태(epoch +1) · 본문은 그대로', ok(e) and o['sourceReviewRequired'] is True and o['epoch'] == 1
          and o['text'] == '활동에서 사람이 마지막에 확인해야 한다고 씀', o)
    check('H15 일반 본문 정정은 재검토 표시를 지우지 않음', ok(t[21].mut(obs(C1, SA, A21, text='다시 씀', rid=OS, ver=1, reason='표현 수정')))
          and [x for x in t[21].student(C1, SA['id'])['observations'] if x['id'] == OS][0]['sourceReviewRequired'] is True)
    # 원문 정정판: 1행(정정) · 2행(새 행 = 예전 3행 대응) · 예전 2행 제외 · 예전 4행은 새 3행에 대응
    av = t[21].activity(C1, I1); prev = {x['rowNumber']: x for x in av['items']}
    vals2 = [grading_row('1번 별명A', '사람이 결정(정정)'), grading_row('3번 "따옴표"', '함께 결정'), grading_row('5번 새 학생', '추가')]
    inp2 = act_input(vals2, {}, supersedes=I1)
    corr = {'reason': '내보내기 누락 행 보충', 'previousRows': [{'itemId': x['id'], 'itemVersion': x['version']} for x in av['items']],
            'rows': [{'rowNumber': 2, 'previousItemId': prev[2]['id'], 'reason': ''}, {'rowNumber': 3, 'previousItemId': prev[4]['id'], 'reason': ''},
                     {'rowNumber': 4, 'previousItemId': None, 'reason': '새로 제출한 학생'}],
            'omitted': [{'itemId': prev[3]['id'], 'reason': '중복 제출 행'}]}
    cc2 = {'kind': 'activity_correct', 'courseId': C1, 'assignmentId': A21, 'previousImportId': I1, 'expectedVersion': av['version'], 'expectedFileHash': av['fileHash'],
           'input': inp2, 'correspondence': corr}
    st = state()
    bad_x = [{**cc2, 'input': act_input(vals, {}, supersedes=I1)},                                                  # 같은 원문
             {**cc2, 'correspondence': {**corr, 'omitted': []}},                                                     # 예전 행 하나가 대응 없음
             {**cc2, 'correspondence': {**corr, 'rows': [corr['rows'][0], {**corr['rows'][1], 'previousItemId': prev[2]['id']}, corr['rows'][2]]}},  # 두 번 대응
             {**cc2, 'correspondence': {**corr, 'previousRows': corr['previousRows'][:2] + [{'itemId': 'other', 'itemVersion': 1}]}},
             {**cc2, 'correspondence': {**corr, 'rows': corr['rows'][:2]}},                                          # 새 행 누락
             {**cc2, 'correspondence': {**corr, 'rows': corr['rows'][:2] + [{**corr['rows'][2], 'reason': ''}]}},   # 추가 행 사유 없음
             {**cc2, 'input': {**inp2, 'supersedesImportId': None}}]
    check('H16 정정 대응 규칙(같은 원문·대응 없는 예전 행·두 번 대응·다른 원문판 행·새 행 누락·추가 사유 없음·정정 대상 없음) → INVALID_INPUT',
          [code(t[21].mut(x)) for x in bad_x] == ['INVALID_INPUT'] * len(bad_x), [code(t[21].mut(x)) for x in bad_x])
    bad_y = [{**cc2, 'expectedVersion': 1}, {**cc2, 'expectedFileHash': sha('x')},
             {**cc2, 'correspondence': {**corr, 'previousRows': [{**corr['previousRows'][0], 'itemVersion': 1}] + corr['previousRows'][1:]}}]
    check('H17 원문판 판·지문·행 판이 준비 뒤 바뀜 → CONFLICT', [code(t[21].mut(x)) for x in bad_y] == ['CONFLICT'] * 3, [code(t[21].mut(x)) for x in bad_y])
    check('H18 거절은 아무것도 쓰지 않음', state() == st)
    kx = key()
    # 강제 중간 실패: 제외 행 기록에서 터지게 → 전부 되돌아감(이전 판 active 그대로 · 새 판 0 · 원장 0)
    sqlfile(None, text="create function workhub_private.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM_TEST'; end $$;"
                       "create trigger zz_boom before insert on workhub.activity_item_omissions for each row execute function workhub_private.zz_boom()")
    r = t[21].mut(cc2, kx)
    check('H19 강제 중간 실패 → 오류 그대로(확정 거절 아님) · 이전 판 active · 새 판·원장·감사 없음', r == 'BOOM_TEST' and state() == st, r)
    sqlfile(None, text="drop trigger zz_boom on workhub.activity_item_omissions; drop function workhub_private.zz_boom()")
    e = t[21].mut(cc2, kx); I2 = ent(e)
    av_old = t[21].activity(C1, I1); av_new = t[21].activity(C1, I2)
    check('H20 같은 번호 재시도 → 새 원문판(판 1) · 이전 판 superseded(후속판 ID, 판 +1) · 계보 연결', ok(e) and e['version'] == 1 and I2 != I1
          and av_old['state'] == 'superseded' and av_old['supersededByImportId'] == I2 and av_old['version'] == av['version'] + 1
          and av_new['supersedesImportId'] == I1 and av_new['state'] == 'active' and all(x['disposition'] == 'hold' for x in av_new['items']), (e, av_old.get('state')))
    e = t[21].mut(cc2, kx)
    check('H21 응답 유실 뒤 같은 번호 → 같은 새 원문판(replayed) · 원문판 2개뿐', ok(e) and e['entityId'] == I2 and e['outcome'] == 'replayed' and n('activity_imports') == 2)
    check('H22 제외 행 사유 기록 · 대응 행은 이전 행을 가리킴 · 예전 원문 보존', n('activity_item_omissions', 'item_id=%s', (prev[3]['id'],)) == 1
          and scalar('select previous_item_id from workhub.activity_items where import_id=%s and row_number=3', (I2,)) == prev[4]['id']
          and scalar('select raw_csv from workhub.activity_imports where id=%s', (I1,)) == raw)
    o = [x for x in t[21].student(C1, SB['id'])['observations']]
    check('H23 정정 전 판은 읽기 전용: 연결 변경·정정·새 근거 → CONFLICT', [code(t[21].mut(x)) for x in (
        review(C1, I1, it3['id'], 2, 'hold'), {**cc2, 'expectedVersion': av_old['version']},
        obs(C1, SB, A21, source={'itemId': it3['id'], 'itemVersion': 2}))] == ['CONFLICT'] * 3)
    vals3 = vals2 + [grading_row('6번', '또 추가')]
    av_new = t[21].activity(C1, I2); pv = {x['rowNumber']: x for x in av_new['items']}
    mk = lambda tag: {'kind': 'activity_correct', 'courseId': C1, 'assignmentId': A21, 'previousImportId': I2, 'expectedVersion': av_new['version'],
                      'expectedFileHash': av_new['fileHash'], 'input': act_input(vals3 + [grading_row(tag, 'x')], {}, supersedes=I2),
                      'correspondence': {'reason': '동시 정정', 'previousRows': [{'itemId': x['id'], 'itemVersion': x['version']} for x in av_new['items']],
                                         'rows': [{'rowNumber': r, 'previousItemId': pv[r]['id'], 'reason': ''} for r in (2, 3, 4)]
                                                 + [{'rowNumber': 5, 'previousItemId': None, 'reason': '추가'}, {'rowNumber': 6, 'previousItemId': None, 'reason': '추가'}],
                                         'omitted': []}}
    outs = concurrently([lambda: t[21].mut(mk('7번')), lambda: t[21].mut(mk('8번'))])
    check('H24 같은 원문판을 동시에 정정 → 하나만 · 하나는 CONFLICT · 현재판 하나', sorted([code(x) or 'OK' for x in outs]) == ['CONFLICT', 'OK']
          and n('activity_imports', "state='active'") == 1, outs)
    check('H25 원문판 행은 원문을 바꿀 수 없음', sqlerr("update workhub.activity_imports set raw_csv='x'") == 'P5_IMPORT_IMMUTABLE'
          and sqlerr("update workhub.activity_items set row_values='[]'") == 'IMMUTABLE_IDENTITY' or 'IMMUTABLE' in sqlerr("update workhub.activity_items set row_values='[]'"))

    # ======================================================================= I. 문서함 학생 기록 근거 확인(P4 가 부르는 함수)
    sa = t[21].student(C1, SA['id']); a1 = sa['assessments'][0]
    oA = [x for x in t[21].student(C1, SB['id'])['observations']][0]
    ev_o = {'kind': 'observation', 'id': oA['id'], 'revisionId': oA['revisionId'], 'sourceHash': oA['contentHash'], 'epoch': oA['epoch'], 'start': 0, 'end': len(oA['text'])}
    ev_a = {'kind': 'assessment', 'id': a1['id'], 'revisionId': a1['revisionId'], 'sourceHash': a1['contentHash'], 'epoch': a1['epoch'], 'start': 0, 'end': len(a1['comment'])}
    stale = [x for x in sa['observations'] if x['id'] == OS][0]
    check('I01 본인 현재 관찰·확정 평가 근거 → 통과', doc_check(M[21], {'courseId': C1, 'studentId': SB['id'], 'evidence': [ev_o]}) == 'OK'
          and doc_check(M[21], {'courseId': C1, 'studentId': SA['id'], 'evidence': [ev_a]}) == 'OK')
    check('I02 판·지문·epoch 다름 · 구간이 본문 밖 · 재검토 관찰 · 철회 관찰 → CONFLICT', [doc_check(M[21], {'courseId': C1, 'studentId': s_, 'evidence': [x]}) for s_, x in (
        (SB['id'], {**ev_o, 'epoch': 5}), (SB['id'], {**ev_o, 'sourceHash': '0' * 64}), (SB['id'], {**ev_o, 'end': 999}),
        (SA['id'], {'kind': 'observation', 'id': OS, 'revisionId': stale['revisionId'], 'sourceHash': stale['contentHash'], 'epoch': stale['epoch'], 'start': 0, 'end': 1}),
        (SA['id'], {'kind': 'observation', 'id': O1, 'revisionId': 'x', 'sourceHash': '0' * 64, 'epoch': 0, 'start': 0, 'end': 1}))] == ['CONFLICT'] * 5)
    check('I03 남의 기록(22 가 21 의 관찰) · 다른 학생 · 상담 근거 → NOT_FOUND/거절', doc_check(M[22], {'courseId': C1, 'studentId': SB['id'], 'evidence': [ev_o]}) == 'NOT_FOUND'
          and doc_check(M[21], {'courseId': C1, 'studentId': SA['id'], 'evidence': [ev_o]}) == 'NOT_FOUND'
          and doc_check(M[21], {'courseId': C1, 'studentId': SA['id'], 'evidence': [{**ev_o, 'kind': 'counseling', 'id': CN}]}) == 'INVALID_INPUT')
    check('I04 확정 아닌 평가 근거 → CONFLICT', doc_check(M[21], {'courseId': C1, 'studentId': SC['id'], 'evidence': [{**ev_a, 'id': ent(e3),
          'revisionId': t[21].student(C1, SC['id'])['assessments'][0]['revisionId'], 'sourceHash': t[21].student(C1, SC['id'])['assessments'][0]['contentHash'], 'epoch': 0, 'end': 1}]}) == 'CONFLICT')
    if has_p4:
        # 실제 문서함 경로: P4-04 로 문서함을 켜고 학생 기록 초안을 만든다(P5 가 있으면 NOT_READY 가 아니어야 한다)
        sqlfile(None, text=fill_json(os.path.join(P4, 'P4-04_자료문서함활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험(합성)', 'document_school_share': 'off'}))
        din = lambda ev, s_: {'title': '학생 기록 초안', 'kind': 'student_record', 'body': '근거를 들어 판단함.', 'visibility': 'private', 'sources': [],
                              'basisDate': DAY(), 'studentContext': {'studentId': s_, 'courseId': C1, 'evidence': [ev]}}
        d_ok = t[21].go('workhub_document_mutate', {'kind': 'create', 'input': din(ev_o, SB['id']), 'origin': None}, key())
        d_bad = t[21].go('workhub_document_mutate', {'kind': 'create', 'input': din({**ev_o, 'epoch': 9}, SB['id']), 'origin': None}, key())
        d_oth = t[22].go('workhub_document_mutate', {'kind': 'create', 'input': din(ev_o, SB['id']), 'origin': None}, key())
        check('I05 (P4 있음) 문서함 학생 기록 초안: 현재 근거 → 저장 · 바뀐 근거 → CONFLICT · 남의 근거 → NOT_FOUND',
              isinstance(d_ok, dict) and 'data' in d_ok and (d_bad.get('error') or {}).get('code') == 'CONFLICT' and (d_oth.get('error') or {}).get('code') == 'NOT_FOUND',
              (d_ok, d_bad, d_oth))
    else:
        check('I05 (P4 없음) 근거 확인 함수는 P4 없이도 독립 동작', doc_check(M[21], {'courseId': C1, 'studentId': SB['id'], 'evidence': [ev_o]}) == 'OK')

    # ======================================================================= J. 역할 회수 · 원장 재생 · 중지/재개 · 강제 실패
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'school_admin', %s)", (s1, start_day))
    k24 = key(); c24 = course_cmd('1학년 도덕 C', term2, 'subj-ethics', [M[24]], t2s, t2last)
    e = t[24].mut(c24, k24)
    check('J01 관리자 역할 받은 교사(24) → 수업 만들기 · 승인 교사 목록 보임', ok(e) and len(t[24].catalog()['approvedTeachers']) > 0, e)
    call(run, "update workhub.membership_roles set revoked_at=now(), revoke_reason='시험 회수' where membership_id='m-24' and revoked_at is null")
    c24c = t[24].catalog()
    check('J02 역할 회수 → canManageCourses false · 승인 교사 목록 빈 배열 · 새 수업 FORBIDDEN', c24c['canManageCourses'] is False and c24c['approvedTeachers'] == []
          and code(t[24].mut(course_cmd('또', term2, 'subj-ethics', [M[24]], t2s, t2last))) == 'FORBIDDEN')
    e2 = t[24].mut(c24, k24)
    check('J03 회수 뒤에도 이미 반영된 요청의 재전송은 처음 접수증(성공을 실패로 바꾸지 않음)', ok(e2) and e2['outcome'] == 'replayed' and e2['entityId'] == e['entityId'], e2)
    call(run, "update workhub.memberships set status='suspended' where id='m-22'")
    check('J04 소속 정지된 공동 담당(22) → INACTIVE_MEMBERSHIP(봉투 없음)', t[22].go('workhub_teaching_catalog') == 'INACTIVE_MEMBERSHIP')
    call(run, "update workhub.memberships set status='active' where id='m-22'")
    stop()
    kq = key(); oq = obs(C1, SB, A21, text='중지 중')
    check('J05 중지 → 조회·새 쓰기 UNAVAILABLE · 이미 받은 요청 재전송은 접수증', code(t[21].catalog()) == 'UNAVAILABLE' and code(t[21].mut(oq, kq)) == 'UNAVAILABLE'
          and t[21].mut(ic, ka)['outcome'] == 'replayed')
    resume()
    check('J06 재개 → 다시 조회·쓰기', ok(t[21].catalog()) and ok(t[21].mut(oq, kq)))
    st = state()
    sqlfile(None, text="create function workhub_private.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM_TEST'; end $$;"
                       "create trigger zz_boom before insert on workhub.teaching_record_revisions for each row execute function workhub_private.zz_boom()")
    kb = key(); ob = obs(C1, SB, A21, text='강제 실패')
    r = t[21].mut(ob, kb)
    check('J07 관찰 저장 중 강제 실패 → 오류 그대로 · 머리·판·원장·감사 0', r == 'BOOM_TEST' and state() == st, r)
    sqlfile(None, text="drop trigger zz_boom on workhub.teaching_record_revisions; drop function workhub_private.zz_boom()")
    e = t[21].mut(ob, kb)
    check('J08 같은 번호 재시도 → 한 번만 반영', ok(e) and e['outcome'] == 'applied' and t[21].mut(ob, kb)['outcome'] == 'replayed', e)

    # ======================================================================= K. 두 학교 · 상담 off 학교 · 사후 점검
    C9 = ent(t[27].mut(course_cmd('도덕', 't2-1', 'subj2-eth', [M[27]], '2026-03-01', '2027-02-28')))
    e = t[27].mut(roster(C9, 1, [srow('S-0001', '다른학교학생', 1, '1', 1)], '2026-03-01', '2027-02-28'))
    s9 = t[27].course(C9)['students'][0]; a9 = [x for x in t[27].catalog()['courses'] if x['id'] == C9][0]
    check('K01 다른 학교: 같은 학생키를 따로 씀(학교 범위 키) · 상담 off 라 canCounsel false', ok(e) and s9['name'] == '다른학교학생' and a9['canCounsel'] is False and a9['canRecord'], a9)
    check('K02 상담 off 학교: 상담 쓰기·읽기 FORBIDDEN · 관찰은 됨', code(t[27].mut(obs(C9, s9, a9['assignmentId'], kind='counseling_save'))) == 'FORBIDDEN'
          and code(t[27].counsel(C9, s9['id'])) == 'FORBIDDEN' and ok(t[27].mut(obs(C9, s9, a9['assignmentId']))))
    check('K03 학교를 넘는 참조: 이 학교 교사가 다른 학교 수업·학생 → NOT_FOUND', code(t[21].course(C9)) == 'NOT_FOUND' and code(t[21].student(C1, s9['id'])) == 'NOT_FOUND'
          and code(t[27].student(C1, SA['id'])) == 'NOT_FOUND')
    check('K04 두 학교 자료 분리(학교마다 자기 학생·기록만)', n('students', "school_id='school-2'") == 1 and n('teaching_records', "school_id='school-2'") == 1)
    post = sqlfile('P5-03_사후점검.sql')
    check('K05 P5-03 사후 점검 FAIL 없음(판 기록 = 현재 · 기준판 소속 · 계보 1:1 · 수강 = 학적)', all(r[2] in ('ok', 'info') for r in post), [r for r in post if r[2] == 'FAIL'])
    after2 = fingerprint()
    check('K06 사용 뒤에도 P5 밖 구조 지문(S1~S6) 같음', [r for r in before if r[1] != 'D1 기존 표 행 수·행 해시'] == [r for r in after2 if r[1] != 'D1 기존 표 행 수·행 해시'])
    check('K07 감사: 개인 기록(관찰·상담·평가·활동)은 owner_only · 본문이 감사에 없음', scalar(
        "select count(*) from workhub.audit_events where operation like 'teaching.%%' and resource_type in ('observation','counselling_record','assessment','activity_import','activity_item') and sensitivity <> 'owner_only'") == 0
          and scalar("select count(*) from workhub.audit_events where operation like 'teaching.%%' and details::text like '%%관찰%%'") == 0)

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == '__main__':
    main()
