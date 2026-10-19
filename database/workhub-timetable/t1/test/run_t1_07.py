# T1-07 준비 대상 학기 고르기(timetable.target.v1) 시험.
# 임시 PostgreSQL 17 + Supabase 흉내. 운영과 무관. 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → JWT)로 부른다.
# T1-01~03 은 run_t1.py 와 같은 방식으로 이 시험이 설치한다. 받은 응답 예시는 T1_07_CAPTURE 에 남긴다(앱 계약 문서 · Codex 인계용).
#
# 사용: python3 run_t1_07.py   (R1 + P1~P5 + P7 + P8 이 적용된 시험 DB 에서 — run_all_t1_07.sh 가 준비한다)
import datetime, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from run_t1 import (A, admin, api, call, err, check, scalar, key, fill_json, U1, T, M, TODAY, results, W, DAY, MONDAY,
                    src, sqlfile, sqlerr, p, t105, module_sql, n, concurrently, ecode, ok, d, course_cmd, link, slot, pin, fixtures)

OUT = os.environ.get('T1_07_CAPTURE', '')
samples = {}
T107 = 'T1-07_대상학기_선택.sql'
OP_ORIG = "CHECK ((op = ANY (ARRAY['preparation'::text, 'save_draft'::text, 'setup'::text])))"


class B(A):
    """A(T1 공개 함수 7개) + T1-07 공개 함수 2개."""
    def tget(self, tag=None):
        r = self.go('workhub_timetable_target_get')
        if tag and OUT: samples[tag] = r
        return r
    def tset(self, inp, k=None, recover=False, tag=None):
        r = self.go('workhub_timetable_target_set', inp, k or key(), recover)
        if tag and OUT: samples[tag] = {'input': inp, 'response': r}
        return r


def tgt(term, ver): return {'termId': term, 'expectedVersion': ver}
def rows_ok(rows): return all(r[2] in ('ok', 'info') for r in rows)
def fails(rows): return [r[0] for r in rows if r[2] not in ('ok', 'info')]
def fp_struct(): return [r for r in sqlfile(p('T1-00_사전점검_지문.sql')) if r[0] == '지문' and not r[1].startswith('D1')]
def fp_all(): return [r for r in sqlfile(p('T1-00_사전점검_지문.sql')) if r[0] == '지문']
def t108(): return sqlfile(p('T1-08_사후점검_T1-07포함.sql'))
def t109(): return sqlfile(p('T1-09_통합사후점검.sql'))


def main():
    try:
        body()
    finally:
        if OUT:
            with open(OUT, 'w', encoding='utf-8') as f: json.dump(samples, f, ensure_ascii=False, indent=1)
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
    assert t2s <= DAY() < t2e and term1, '시험은 2학기 안의 날짜에서 돈다(1학기는 끝남)'
    run = admin()
    call(run, "update workhub.accounts set display_name = case id when 'acc-21' then '김국어' when 'acc-22' then '이정보' when 'acc-24' then '최담임' else display_name end")
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'school_admin', %s)", (s1, y_start))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-kor', %s, %s, '국어', 1), ('subj-info', %s, %s, '정보', 2)",
         (s1, year, s1, year))
    call(run, "insert into workhub.year_classes(id, school_id, academic_year_id, grade, class_no, name, kind, sort_order) values ('cls-1-1', %s, %s, 1, 1, '1-1', 'regular', 1)", (s1, year))
    # 다음 학년도(2학기가 끝난 다음 날부터) — 운영에서는 P7 새 학년도 · P1 학교 관리로 만든다. 학기 2개 · 학급 2개 · 교과 2개.
    ny_s = t2e
    ny_e = (datetime.date.fromisoformat(t2e) + datetime.timedelta(days=366)).isoformat()
    n1_e = (datetime.date.fromisoformat(t2e) + datetime.timedelta(days=170)).isoformat()
    call(run, "insert into workhub.academic_years(id, school_id, school_year, starts_on, ends_on, state) values ('year-next', %s, 2027, %s, %s, 'planning')", (s1, ny_s, ny_e))
    call(run, "insert into workhub.terms(id, school_id, academic_year_id, term_no, label, starts_on, ends_on) values ('term-n1', %s, 'year-next', 1, '1학기', %s, %s), ('term-n2', %s, 'year-next', 2, '2학기', %s, %s)",
         (s1, ny_s, n1_e, s1, n1_e, ny_e))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('nsubj-kor', %s, 'year-next', '국어', 1), ('nsubj-info', %s, 'year-next', '정보', 2)", (s1, s1))
    call(run, "insert into workhub.year_classes(id, school_id, academic_year_id, grade, class_no, name, kind, sort_order) values ('ncls-2-1', %s, 'year-next', 2, 1, '2-1', 'regular', 1), ('ncls-2-2', %s, 'year-next', 2, 2, '2-2', 'regular', 2)",
         (s1, s1))
    # 다른 학교의 학기(고를 수 없어야 함)
    call(run, "insert into workhub.academic_years(id, school_id, school_year, starts_on, ends_on, state) values ('year-s2', 'school-2', 2026, '2026-03-01', %s, 'planning')", (ny_s,))
    call(run, "insert into workhub.terms(id, school_id, academic_year_id, term_no, label, starts_on, ends_on) values ('term-s2', 'school-2', 'year-s2', 1, '1학기', '2026-03-01', %s)", (ny_s,))
    adm = B(U1, m1); a24 = B(T[24], M[24]); t21 = B(T[21], M[21]); t27 = B(T[27], M[27])

    # ======================================================================= A. 설치 순서 · 원본 확인 · 지문
    sqlfile(p('T1-01_편성기반_모델.sql')); sqlfile(p('T1-02_R0증분_학기기준판_제약.sql'))
    check('A01 T1-03 전에 T1-07 → 멈춤(아무것도 만들지 않음)', 'T1-01 · T1-02 · T1-03(2026-10-18.1)을 먼저 적용해 주세요' in sqlerr(src(p(T107)))
          and scalar("select to_regclass('workhub.timetable_term_targets') is null"))
    check('A02 T1-01 · 02 만 적용된 DB: T1-08 · T1-09 FAIL 없음(T1-07 행 info)', rows_ok(t108()) and rows_ok(t109()), fails(t108()) + fails(t109()))
    sqlfile(p('T1-03_편성기반_공개함수.sql'))
    r8 = t108()
    check('A03 T1-03 뒤 · T1-07 전: T1-08 FAIL 없음(11 = info "T1-01 원본 확인") · T1-09 FAIL 없음 · T1-04 FAIL 없음',
          rows_ok(r8) and [r for r in r8 if r[0] == 'T1-08-11'][0][2] == 'info' and rows_ok(t109()) and rows_ok(sqlfile(p('T1-04_사후점검.sql'))), fails(r8))
    # 원본이 아니면 덮어쓰지 않는다: 제약 · 함수 본문을 바꿔 두면 멈춘다
    sqlfile(text="alter table workhub.timetable_requests drop constraint timetable_requests_op_check, add constraint timetable_requests_op_check check (op in ('preparation','save_draft','setup','x'))")
    e1 = sqlerr(src(p(T107)))
    sqlfile(text=f"alter table workhub.timetable_requests drop constraint timetable_requests_op_check, add constraint timetable_requests_op_check check (op in ('preparation','save_draft','setup'))")
    r8 = t108()
    check('A04 timetable_requests 제약이 원본이 아니면 T1-07 멈춤 · 그 상태를 T1-08-11 이 FAIL 로 잡음(되돌린 뒤 ok)', '제약이 T1-01 원본이 아닙니다' in e1
          and scalar("select pg_get_constraintdef(oid) from pg_constraint where conname='timetable_requests_op_check'") == OP_ORIG and rows_ok(r8), (e1, fails(r8)))
    t1src = src(p('T1-01_편성기반_모델.sql'))
    i0 = t1src.index('CREATE FUNCTION workhub_private.t1_term('); orig_fn = t1src[i0:t1src.index('$$;', i0) + 3]
    sqlfile(text=orig_fn.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('ORDER BY (t.starts_on <= p_today) DESC', 'ORDER BY (t.starts_on <= p_today) ASC'))
    e2 = sqlerr(src(p(T107))); f8 = fails(t108())
    sqlfile(text=orig_fn.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    check('A05 t1_term 본문이 원본이 아니면 T1-07 멈춤 · T1-08-11 FAIL(원본으로 되돌리면 통과)', 't1_term 이 T1-01 원본이 아닙니다' in e2 and f8 == ['T1-08-11']
          and rows_ok(t108()), (e2, f8))
    before = fp_all()
    rows7 = sqlfile(p(T107))
    check('A06 T1-07 적용 → 검증 4행 ok', [r[2] for r in rows7] == ['ok'] * 4, rows7)
    r8 = t108(); r9 = t109()
    check('A07 T1-07 뒤 T1-08 FAIL 없음(02 = 12개 · 05 = 9개 · 11 ok · 12 고른 학교 없음) · T1-09 FAIL 없음', rows_ok(r8) and rows_ok(r9)
          and {r[0]: r[3] for r in r8}['T1-08-02'] == '12개' and {r[0]: r[3] for r in r8}['T1-08-05'] == '9개' and {r[0]: r[2] for r in r8}['T1-08-11'] == 'ok', fails(r8) + fails(r9))
    r4 = sqlfile(p('T1-04_사후점검.sql')); r6 = sqlfile(p('T1-06_통합사후점검.sql'))
    check('A08 T1-07 뒤 T1-04 는 02 · 05 · 08 만 FAIL, T1-06 은 FAIL 이 생김 — 그래서 T1-08 · T1-09 로 바꿔 본다(머리말 그대로)',
          fails(r4) == ['T1-04-02', 'T1-04-05', 'T1-04-08'] and len(fails(r6)) > 0, (fails(r4), fails(r6)))
    after = fp_all()
    check('A09 T1-00 지문(S1~S6 구조 · D1 기존 표 전부의 행) T1-07 전후 같음 — 1~8단계 객체 · 기존 행을 바꾸지 않음', before == after,
          [(b, a) for b, a in zip(before, after) if b != a])
    check('A10 T1-07 다시 실행 → 멈춤(이미 적용)', '이미 적용되었습니다' in sqlerr(src(p(T107))))
    check('A11 t1_term_auto 본문 = T1-01 의 t1_term 원본(같은 지문) · t1_term 권한 · 설정 그대로', scalar(
        "select md5(replace(prosrc, chr(13), '')) from pg_proc where proname='t1_term_auto'") == 'f10433b8053c12ab1cb4686aa34b70ac'
          and scalar("select proconfig::text || prosecdef::text || coalesce(proacl::text, '') from pg_proc where proname='t1_term'")
          == scalar("select proconfig::text || prosecdef::text || coalesce(proacl::text, '') from pg_proc where proname='t1_source'"))

    # ======================================================================= B. 접근 경계 · 켜기 전
    c = api(None, 'anon')
    check('B01 anon · service_role 은 새 공개 함수 실행 불가', 'permission denied' in err(c, "select public.workhub_timetable_target_get('m-21')")
          and 'permission denied' in err(api(None, 'service_role'), "select public.workhub_timetable_target_set('m-21','{}'::jsonb,'kkkkkkkk',false)"))
    c = api(T[21])
    check('B02 authenticated 는 새 표 직접 읽기 · 새 내부 함수 실행 불가', 'permission denied' in err(c, 'select * from workhub.timetable_term_targets')
          and 'permission denied' in err(c, "select workhub_private.t1_term_auto('x', current_date)")
          and 'permission denied' in err(c, "select workhub_private.t1_target_installed()"))
    check('B03 남의 소속 ID 로 부르면 거절(member_actor)', 'OK' != err(api(T[21]), "select public.workhub_timetable_target_get('m-22')"))
    r = adm.tget()
    check('B04 켜기 전 조회 · 고르기 → NOT_READY(봉투 contract = timetable.target.v1)', ecode(r) == 'NOT_READY' and r['contract'] == 'timetable.target.v1'
          and r['schoolId'] == s1 and r['memberId'] == m1 and ecode(adm.tset(tgt('term-n1', 0))) == 'NOT_READY', r)
    check('B05 켜기 전 복구 조회(모르는 요청 번호) → NOT_FOUND · 아무것도 쓰지 않음', ecode(adm.tset(tgt('term-n1', 0), recover=True)) == 'NOT_FOUND'
          and n('timetable_term_targets') == 0 and n('timetable_requests') == 0)

    # ======================================================================= C. 켜기(P1 · P5 · T1-05) · 수업
    sqlfile(text=fill_json(os.path.join(W, 'p1', 'P1-04_학교활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인'}))
    sqlfile(text=fill_json(os.path.join(W, 'p5', 'P5-04_수업모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'counseling_scope': 'course_teachers'}))
    def mk(label, term, subj, teachers, vf, vt):
        r_ = adm.tmut(course_cmd(label, term, subj, teachers, vf, vt)); return (r_ if isinstance(r_, dict) else {}).get('entityId') or (d(r_) or {}).get('entityId')
    n1last = (datetime.date.fromisoformat(n1_e) - datetime.timedelta(days=1)).isoformat()
    CA = mk('국어 1-1', term2, 'subj-kor', [M[21]], t2s, t2last)
    NA = mk('국어 2-1', 'term-n1', 'nsubj-kor', [M[21]], ny_s, n1last)
    NB = mk('정보 2-2', 'term-n1', 'nsubj-info', [M[22]], ny_s, n1last)
    check('C01 준비: 이번 학기 수업 1 · 다음 학년도 1학기 수업 2(P5 로 미리 만들 수 있음)', all([CA, NA, NB]) and n('courses', 'term_id=%s', ('term-n1',)) == 2, [CA, NA, NB])
    check('C02 T1-05 켜기', sqlerr(t105()) == 'OK')
    check('C03 일반 교사: 조회 · 고르기 → FORBIDDEN', [ecode(t21.tget()), ecode(t21.tset(tgt('term-n1', 0)))] == ['FORBIDDEN', 'FORBIDDEN'])
    check('C04 다른 학교 관리자: 그 학교는 시간표를 켜지 않음 → NOT_READY', ecode(t27.tget()) == 'NOT_READY' and t27.tget()['schoolId'] == 'school-2')

    # ======================================================================= D. 처음 조회 = 원래 규칙
    g = adm.tget('get_default')
    terms_ = (d(g) or {}).get('terms') or []
    check('D01 처음: termId = automaticTermId = 오늘이 든 2학기 · selectedTermId null · version 0 · 키 정확', ok(g)
          and set(d(g)) == {'termId', 'automaticTermId', 'selectedTermId', 'version', 'terms'}
          and d(g)['termId'] == term2 and d(g)['automaticTermId'] == term2 and d(g)['selectedTermId'] is None and d(g)['version'] == 0, g)
    check('D02 고를 수 있는 학기 = 끝나지 않고 닫히지 않은 학기(끝난 1학기 · 다른 학교 학기 없음) · 시작일 순 · 항목 키 · 날짜 표기(마지막 날 포함)',
          [x['id'] for x in terms_] == [term2, 'term-n1', 'term-n2']
          and all(set(x) == {'id', 'schoolYear', 'label', 'firstDay', 'lastDay', 'state', 'hasBasis', 'hasPreparationDraft'} for x in terms_)
          and terms_[1] == {'id': 'term-n1', 'schoolYear': 2027, 'label': '1학기', 'firstDay': ny_s, 'lastDay': n1last, 'state': 'planning',
                            'hasBasis': False, 'hasPreparationDraft': False}
          and terms_[0]['state'] == 'current' and terms_[0]['lastDay'] == t2last, terms_)
    sg = d(adm.setup())
    check('D03 고르기 전 입력 조회 대상 = 2학기(T1 그대로)', sg['termId'] == term2 and [x['id'] for x in sg['courses']] == [CA], sg)

    # ======================================================================= E. 다음 학기 고르기
    k1 = key(); r1 = adm.tset(tgt('term-n1', 0), k1, tag='set_next')
    check('E01 다음 학년도 1학기 고르기 → 접수증 {requestKey, termId, version 1, effectiveTermId}', ok(r1)
          and d(r1) == {'requestKey': k1, 'termId': 'term-n1', 'version': 1, 'effectiveTermId': 'term-n1'}, r1)
    g = adm.tget('get_selected')
    check('E02 조회: termId = 고른 학기 · automaticTermId = 2학기 그대로 · selectedTermId · version 1', d(g)['termId'] == 'term-n1'
          and d(g)['automaticTermId'] == term2 and d(g)['selectedTermId'] == 'term-n1' and d(g)['version'] == 1, g)
    sg = d(adm.setup())
    check('E03 입력 조회가 고른 학기를 따라옴: termId · 기준일 = 그 학기 첫날(오늘이 아님 — 엑셀이 자정에 만료되지 않음) · 학급 = 다음 학년도 학급 · 수업 = 그 학기 수업',
          sg['termId'] == 'term-n1' and sg['referenceDay'] == ny_s and sg['firstDay'] == ny_s
          and [x['id'] for x in sg['classes']] == ['ncls-2-1', 'ncls-2-2'] and sorted(x['id'] for x in sg['courses']) == sorted([NA, NB]), sg)
    ps = d(adm.prep())
    check('E04 준비 원본도 고른 학기(termId · 수업 2개)', ps['termId'] == 'term-n1' and sorted(c_['id'] for c_ in ps['courses']) == sorted([NA, NB]), ps)
    check('E05 같은 요청 번호 재전송 · 복구 조회 → 같은 접수증 · 다른 내용 → IDEMPOTENCY_CONFLICT · 모르는 번호 복구 → NOT_FOUND',
          adm.tset(tgt('term-n1', 0), k1) == r1 and adm.tset(tgt('term-n1', 0), k1, recover=True) == r1
          and ecode(adm.tset(tgt('term-n2', 0), k1)) == 'IDEMPOTENCY_CONFLICT' and ecode(adm.tset(tgt('term-n1', 0), recover=True)) == 'NOT_FOUND')
    check('E06 감사 1건(timetable.target_set · school 민감도 · 고른 학기 · 이전 학기)', n('audit_events', "operation='timetable.target_set'") == 1
          and scalar("select details::text from workhub.audit_events where operation='timetable.target_set'") == json.dumps({'termId': 'term-n1', 'previousTermId': None}, separators=(', ', ': '))
          and n('audit_events', "operation='timetable.target_set' and sensitivity <> 'school'") == 0)
    check('E07 옛 판(0)으로 고르기 → CONFLICT(다른 담당자가 바꾼 것을 덮어쓰지 않음)', ecode(adm.tset(tgt('term-n2', 0), tag='conflict')) == 'CONFLICT')
    bad = [{'termId': 'term-n2'}, {'expectedVersion': 1}, {**tgt('term-n2', 1), 'x': 1}, tgt(5, 1), tgt('bad id', 1), tgt('', 1), tgt('term-n2', -1),
           tgt('term-n2', 1.5), tgt('term-n2', '1'), tgt('term-n2', None), [], '"term-n2"', None]   # '"…"' = JSON 문자열 값
    got = [ecode(adm.tset(b)) for b in bad]
    check('E08 잘못된 입력(칸 빠짐 · 남는 칸 · 숫자 학기 · 잘못된 ID · 음수 · 소수 · 문자열 판 · null 판 · 배열 · 문자열 · null) → INVALID_INPUT', got == ['INVALID_INPUT'] * len(bad), got)
    check('E09 없는 학기 · 다른 학교 학기 → NOT_FOUND', ecode(adm.tset(tgt('term-nope', 1))) == 'NOT_FOUND' and ecode(adm.tset(tgt('term-s2', 1))) == 'NOT_FOUND')
    check('E10 이미 끝난 1학기 → CONFLICT', ecode(adm.tset(tgt(term1, 1))) == 'CONFLICT')
    call(run, "update workhub.terms set state='closed' where id='term-n2'")
    e_closed = ecode(adm.tset(tgt('term-n2', 1)))
    call(run, "update workhub.terms set state='planning' where id='term-n2'")
    check('E11 닫힌 학기 → CONFLICT', e_closed == 'CONFLICT')
    check('E12 거절은 아무것도 남기지 않음(판 1 · 감사 1 · 원장 1)', scalar("select version from workhub.timetable_term_targets") == 1
          and n('audit_events', "operation='timetable.target_set'") == 1 and n('timetable_requests', "op='target'") == 1)
    r_ = adm.tset(tgt('term-n1', 1))
    check('E13 같은 학기를 다시 고르면 바꾸지 않음(판 1 그대로 · 감사 늘지 않음)', ok(r_) and d(r_)['version'] == 1 and d(r_)['termId'] == 'term-n1'
          and n('audit_events', "operation='timetable.target_set'") == 1, r_)

    # ======================================================================= F. 다음 학기 준비 → 확정 → 편성 초안
    for cmd in (link(NA, None, ['ncls-2-1']), link(NB, None, ['ncls-2-2'])):
        r_ = adm.sx(cmd)
        if not ok(r_): print('  연결 실패', cmd, r_)
    check('F01 다음 학년도 학급으로 연결(ID) · 이번 학년도 학급(cls-1-1)은 다음 학기 수업에 걸 수 없음', n('timetable_course_links') == 2
          and ecode(adm.sx(link(NA, 1, ['cls-1-1']))) == 'INVALID_INPUT')
    sg = d(adm.setup())
    check('F02 다음 학기 미완성 0', sg['termId'] == 'term-n1' and sg['findings'] == [], sg['findings'])
    slots = [slot(1, 1, 540), slot(2, 1, 595), slot(1, 2, 540), slot(2, 2, 595)]
    ids = [x['id'] for x in slots]
    ps = d(adm.prep())
    draft = {'title': '2027 1학기 편성 기준', 'slots': slots,
             'plans': [{'courseId': c_['id'], 'weeklyPeriods': 2, 'blocks': [{'id': f"L{c_['id'][-6:]}-{i}", 'periods': 1, 'allowedSlotIds': ids} for i in range(2)]}
                       for c_ in ps['courses']]}
    rs_ = adm.pex(pin('save', ps, draft))
    DID = (d(rs_) or {}).get('draftId')
    rc = adm.pex(pin('confirm', d(adm.prep()), draft, DID, 1))
    Bn = (d(rc) or {}).get('basis') or {}
    check('F03 다음 학기 준비 초안 저장 → 확정 → 기준판(termId = 다음 학기 · 판 1)', ok(rs_) and ok(rc) and Bn.get('termId') == 'term-n1' and Bn.get('revision') == 1, (rs_, rc))
    check('F04 학기 칸: 다음 학기에만 기준판 · 지금 2학기는 그대로 비어 있음', scalar("select current_timetable_basis_id from workhub.terms where id='term-n1'") == Bn.get('id')
          and scalar("select current_timetable_basis_id from workhub.terms where id=%s", (term2,)) is None)
    check('F05 readiness available · get 의 기준판 = 다음 학기 기준판', d(adm.ready()) == {'available': True} and d(adm.get())['basis'] == Bn)
    L = [l_['id'] for l_ in Bn['lessons']]
    pl = [{'lessonId': lid, 'slotId': ids[i % 4]} for i, lid in enumerate(L)]
    inp = {'basisId': Bn['id'], 'basisRevision': 1, 'sourceFingerprint': Bn['sourceFingerprint'], 'title': '1안', 'conditions': {'fixed': [], 'unavailable': [], 'preferences': []}, 'placements': pl}
    rsv = adm.save(inp)
    check('F06 다음 학기 기준판으로 편성 초안 저장', ok(rsv) and n('timetable_drafts', 'term_id=%s', ('term-n1',)) == 1, rsv)
    tl = {x['id']: x for x in d(adm.tget('get_with_basis'))['terms']}
    check('F07 학기 목록: 다음 학기 hasBasis · hasPreparationDraft true, 2학기는 false', tl['term-n1']['hasBasis'] and tl['term-n1']['hasPreparationDraft']
          and not tl[term2]['hasBasis'] and not tl[term2]['hasPreparationDraft'], tl)

    # ======================================================================= G. 되돌리기 · 다른 화면이 든 옛 학기 자료
    ps_n1 = d(adm.prep())
    k2 = key(); r2 = adm.tset(tgt(None, 1), k2, tag='set_auto')
    check('G01 되돌리기(termId null) → 판 2 · 대상 = 원래 규칙(2학기)', ok(r2) and d(r2) == {'requestKey': k2, 'termId': None, 'version': 2, 'effectiveTermId': term2}, r2)
    g = d(adm.tget())
    check('G02 조회: selectedTermId null · version 2 · termId = automaticTermId = 2학기', g['selectedTermId'] is None and g['version'] == 2
          and g['termId'] == term2 and g['automaticTermId'] == term2, g)
    check('G03 2학기는 기준판 없음 → readiness basis_missing · 준비 원본 = 2학기', d(adm.ready()) == {'available': False, 'reason': 'basis_missing'}
          and d(adm.prep())['termId'] == term2)
    check('G04 다른 화면이 들고 있던 다음 학기 준비 원본으로 저장 → CONFLICT · 다음 학기 기준판으로 편성 저장 → CONFLICT(기존 검사 그대로)',
          ecode(adm.pex(pin('save', ps_n1, draft, DID, 2))) == 'CONFLICT' and ecode(adm.save(dict(inp, title='2안'))) == 'CONFLICT')
    check('G05 되돌려도 다음 학기 자료(기준판 · 준비 초안 · 편성 초안)는 그대로', n('timetable_basis_revisions', 'term_id=%s', ('term-n1',)) == 1
          and n('timetable_prep_drafts', 'term_id=%s', ('term-n1',)) == 1 and n('timetable_drafts', 'term_id=%s', ('term-n1',)) == 1)
    r3 = adm.tset(tgt('term-n1', 2))
    check('G06 다시 고르면(판 3) 다음 학기 기준판 · 편성 초안이 그대로 다시 보임', ok(r3) and d(r3)['version'] == 3 and d(adm.get())['basis'] == Bn
          and len(d(adm.get())['drafts']) == 1, r3)
    check('G07 감사: 바꾼 3번만(되돌리기 포함 · 같은 학기 다시 고르기 제외) · 이전 학기 기록', n('audit_events', "operation='timetable.target_set'") == 3
          and scalar("select string_agg(coalesce(details->>'previousTermId','-') || '>' || coalesce(details->>'termId','-'), ',' order by id) from workhub.audit_events where operation='timetable.target_set'")
          == f'->term-n1,term-n1>-,->term-n1')

    # ======================================================================= H. 동시성
    g = d(adm.tget())
    o = concurrently([lambda: adm.tset(tgt('term-n2', g['version'])), lambda: a24.tset(tgt(term2, g['version']))])
    check('H01 두 담당자가 같은 판으로 동시에 고르기 → 하나만 성공(판 4) · 하나는 CONFLICT', sorted(['ok' if ok(x) else ecode(x) for x in o]) == ['CONFLICT', 'ok']
          and scalar("select version from workhub.timetable_term_targets") == 4, o)
    kk = key(); same = tgt('term-n1', 4)
    o = concurrently([lambda: adm.tset(same, kk), lambda: adm.tset(same, kk)])
    check('H02 같은 요청 번호를 동시에 두 번 → 같은 접수증 · 판 5 한 번만', o[0] == o[1] and ok(o[0]) and d(o[0])['version'] == 5, o)

    # ======================================================================= I. 고른 학기가 닫히거나 빠지면
    call(run, "update workhub.terms set state='closed' where id='term-n1'")
    g = d(adm.tget('get_selected_closed'))
    check('I01 고른 학기가 닫히면 대상 = 원래 규칙(2학기) · selectedTermId 는 남음(화면이 알림) · 목록에서 빠짐', g['termId'] == term2 and g['selectedTermId'] == 'term-n1'
          and 'term-n1' not in [x['id'] for x in g['terms']] and d(adm.setup())['termId'] == term2, g)
    call(run, "update workhub.terms set state='planning' where id='term-n1'")
    check('I02 다시 열리면 고른 학기로 돌아옴', d(adm.tget())['termId'] == 'term-n1')
    r_ = adm.tset(tgt('term-n2', 5))
    check('I03 학기 빼기(P1 · P8-01 이 하는 삭제): 고른 학기를 지워도 막히지 않고 고른 칸만 비움(판 그대로) · 대상 = 원래 규칙',
          ok(r_) and sqlerr("delete from workhub.terms where id='term-n2'") == 'OK' and scalar("select term_id from workhub.timetable_term_targets") is None
          and scalar("select version from workhub.timetable_term_targets") == 6 and d(adm.tget())['termId'] == term2, r_)
    check('I04 기준판이 있는 학기는 여전히 지울 수 없음(T1-02 FK)', sqlerr("delete from workhub.terms where id='term-n1'") != 'OK')

    # ======================================================================= J. 중지 · 사용 뒤 점검
    sqlfile(text=module_sql('P2-80_모듈중지.sql', 'timetable', '시험 중지'))
    check('J01 중지(P2-80) → 조회 · 고르기 NOT_READY · 반영된 요청의 복구 조회는 원래 접수증', ecode(adm.tget()) == 'NOT_READY'
          and ecode(adm.tset(tgt('term-n1', 6))) == 'NOT_READY' and adm.tset(tgt('term-n1', 0), k1, recover=True) == r1)
    post = t108()
    check('J02 사용 뒤 T1-08 FAIL 없음 · 12 행이 고른 학기 상태를 보여 줌', rows_ok(post) and 'daedong-ms: 고르지 않음' in {r[0]: r[3] for r in post}['T1-08-12'], post[-1])
    check('J03 사용 뒤 T1-09 FAIL 없음', rows_ok(t109()), fails(t109()))
    check('J04 사용 뒤에도 T1 밖 구조 지문(S1~S6) 같음', [r for r in before if not r[1].startswith('D1')] == fp_struct())


if __name__ == '__main__':
    main()
