# T2 시간표 운영(공개 · 교환 요청 · 학사 변경 · 실시 기록 · 알림) 시험.
# 임시 PostgreSQL 17 + Supabase 흉내. 운영과 무관. 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → JWT)로 부른다.
# T1-01~03 · T1-07 · T2-01~06 을 이 시험이 설치한다. 받은 응답은 T2_CAPTURE 에 남겨 app_contract_t2.ts 가 PR #72 앱 parser 에 넣는다.
#
# 사용: python3 run_t2.py   (R1 + P1~P5 + P7 + P8 이 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import datetime, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 't1', 'test'))
from run_t1 import (A, admin, api, call, err, check, scalar, key, fill_json, U1, T, M, TODAY, results, W, DAY,
                    src, sqlfile, sqlerr, t105, module_sql, n, concurrently, ecode, ok, d, course_cmd, link, slot, pin, fixtures)

S2 = os.path.join(HERE, '..'); S1 = os.path.join(HERE, '..', '..', 't1')
OUT = os.environ.get('T2_CAPTURE', '')
captures = []
T1F = ['T1-01_편성기반_모델.sql', 'T1-02_R0증분_학기기준판_제약.sql', 'T1-03_편성기반_공개함수.sql', 'T1-07_대상학기_선택.sql']
T2F = ['T2-01_운영_모델.sql', 'T2-03_조회_공개.sql', 'T2-04_교환_요청.sql', 'T2-05_학사변경.sql', 'T2-06_실시기록.sql']
DEPLOY = 'PR #72 시간표 운영 앱 배포 확인(시험 합성 값)'
POLICY = json.load(open(os.path.join(W, '..', '..', 'apps', 'workhub', 'src', 'timetable', 'execution-records-policy.json'), encoding='utf-8')) \
    if os.path.exists(os.path.join(W, '..', '..', 'apps', 'workhub', 'src', 'timetable', 'execution-records-policy.json')) else None


def p2(name): return os.path.join(S2, name)
def p1(name): return os.path.join(S1, name)
def t208(approver=U1, ref='2026-10-20 시간표 운영 정책 확정 · 시험 승인', deploy=DEPLOY):
    return fill_json(p2('T2-08_시간표운영활성화_양식.sql'), {'approver_user_id': approver, 'approval_ref': ref, 'app_deploy_ref': deploy})
def t207(): return sqlfile(p2('T2-07_통합사후점검.sql'))
def fails(rows): return [r[0] for r in rows if r[2] not in ('ok', 'info')]
def iso(dt): return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'


class O(A):
    """T1 공개 함수(A) + T2 공개 함수 16개. 응답을 앱 대조용으로 남긴다."""
    def keep2(self, kind, raw, **extra):
        if OUT: captures.append({'kind': kind, 'at': int(time.time() * 1000), 'scope': {'schoolId': self.school, 'memberId': self.member, 'userId': self.uid}, 'raw': raw if isinstance(raw, dict) else None,
                                 'error': None if isinstance(raw, dict) else raw, **extra})
        return raw
    def oready(self): return self.keep2('ops_readiness', self.go('workhub_timetable_operations_readiness'))
    def oget(self, f, u): return self.keep2('ops_get', self.go('workhub_timetable_operations_get', f, u), range={'from': f, 'until': u})
    def pprev(self, inp): return self.keep2('publish_preview', self.go('workhub_timetable_operations_publish_preview', inp), input=inp)
    def oexec(self, cmd, k=None, recover=False):
        k = k or key(); return self.keep2('ops_execute', self.go('workhub_timetable_operations_execute', cmd, k, recover), command=cmd, key=k, recover=recover)
    def refs(self, as_of, f, u): return self.keep2('references', self.go('workhub_timetable_operations_references', as_of, f, u), asOf=as_of)
    def manifest(self, inp): return self.keep2('publish_manifest', self.go('workhub_timetable_operations_publish_manifest', inp), input=inp)
    def page(self, pid, h, i): return self.keep2('publish_page', self.go('workhub_timetable_operations_publish_page', pid, h, i))
    def pubexec(self, cmd, k=None, recover=False):
        k = k or key(); return self.keep2('publication_execute', self.go('workhub_timetable_publication_execute', cmd, k, recover), command=cmd, key=k, recover=recover)
    def xprev(self, inp): return self.keep2('exchange_preview', self.go('workhub_timetable_operations_exchange_preview', inp), input=inp)
    def recommend(self, inp, as_of): return self.keep2('recommend', self.go('workhub_timetable_operations_recommend', inp, as_of), input=inp)
    def sdprev(self, inp, as_of, f, u): return self.keep2('school_day_preview', self.go('workhub_timetable_school_day_preview', inp, as_of, f, u), input=inp)
    def sdexec(self, cmd, k=None, recover=False):
        k = k or key(); return self.keep2('school_day_execute', self.go('workhub_timetable_school_day_execute', cmd, k, recover), command=cmd, key=k, recover=recover)
    def eget(self, lid): return self.keep2('execution_get', self.go('workhub_timetable_execution_get', lid), lessonId=lid)
    def ehist(self, lid, anchor, cur, size=20): return self.keep2('execution_history', self.go('workhub_timetable_execution_history', lid, anchor, cur, size), lessonId=lid, anchor=anchor, cursor=cur)
    def erec(self, cmd, k=None, recover=False):
        k = k or key(); return self.keep2('execution_record', self.go('workhub_timetable_execution_record', cmd, k, recover), command=cmd, key=k, recover=recover)
    # 요청 번호 포기 — 앱 parser 가 아직 없어(Codex 와 계약 맞추는 중) 앱 대조용으로 남기지 않는다
    def abandon(self, kind, cmd, k): return self.go('workhub_timetable_operations_abandon', kind, cmd, k)


def main():
    try:
        body()
    finally:
        if OUT:
            with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


def ecmd(lesson, lver, rver, rid, outcome, note, reason=None):
    return {'lessonId': lesson, 'expectedLessonVersion': lver, 'expectedRecordVersion': rver, 'expectedRecordId': rid, 'outcome': outcome, 'note': note, 'correctionReason': reason}


def body():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    y_start = scalar("select starts_on::text from workhub.academic_years where id=%s", (year,))
    term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
    t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
    assert t2s <= DAY() and DAY(40) <= t2last, '시험은 2학기 안의 날짜에서 돈다'
    run = admin()
    call(run, "update workhub.accounts set display_name = case id when 'acc-21' then '김국어' when 'acc-22' then '이정보' when 'acc-23' then '박과학' when 'acc-24' then '최담임' else display_name end")
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'school_admin', %s)", (s1, y_start))
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-kor', %s, %s, '국어', 1), ('subj-info', %s, %s, '정보', 2), ('subj-sci', %s, %s, '과학', 3)",
         (s1, year, s1, year, s1, year))
    call(run, "insert into workhub.year_classes(id, school_id, academic_year_id, grade, class_no, name, kind, sort_order) values ('cls-1-1', %s, %s, 1, 1, '1-1', 'regular', 1), ('cls-1-2', %s, %s, 1, 2, '1-2', 'regular', 2)",
         (s1, year, s1, year))
    adm = O(U1, m1); a24 = O(T[24], M[24])
    t = {k: O(T[k], M[k]) for k in (21, 22, 23, 25, 27)}

    # ======================================================================= A. 설치 순서 · 원본 확인 · 통합 점검
    e0 = sqlerr(src(p2('T2-01_운영_모델.sql')))
    check('A01 T1-07 전에 T2-01 → 멈춤(아무것도 만들지 않음)', 'T2 중단' in e0 and scalar("select to_regclass('workhub.timetable_lessons') is null"), e0)
    for f in T1F: sqlfile(p1(f))
    r7 = t207()
    check('A02 T2 전(T1 · T1-07 까지): T2-07 FAIL 없음', not fails(r7), fails(r7))
    e2, e3 = sqlerr(src(p2('T2-02_알림출처_시간표.sql'))), sqlerr(src(p2('T2-03_조회_공개.sql')))
    check('A03 T2-01 전에 T2-02 · T2-03 → 멈춤', 'T2-01' in e2 and 'T2-01' in e3, (e2, e3))
    part = []
    for f in T2F:
        rows = sqlfile(p2(f)); r7 = t207()
        part.append((f, all(r[2] == 'ok' for r in rows), fails(r7)))
    check('A04 T2-01 → 03 → 04 → 05 → 06 하나씩: 파일 검증행 모두 ok · 단계마다 T2-07 FAIL 없음', all(a and not b for _, a, b in part), part)
    check('A05 다섯 파일 다시 실행 → 모두 멈춤(이미 적용 또는 같은 이름 있음)', all(sqlerr(src(p2(f))) != 'OK' for f in T2F))
    r9 = sqlfile(p1('T1-09_통합사후점검.sql'))
    r8 = sqlfile(p1('T1-08_사후점검_T1-07포함.sql'))
    check('A06 T2 뒤 T1-09 는 03 · 09 · 10, T1-08 은 02 · 05 · 08 · 10 행이 FAIL(T2 표 · 함수 · 트리거를 모름) — 그래서 T2-07 로 바꿔 본다',
          fails(r9) == ['T1-09-03', 'T1-09-09', 'T1-09-10'] and fails(r8) == ['T1-08-02', 'T1-08-05', 'T1-08-08', 'T1-08-10'], (fails(r9), fails(r8)))
    # 알림 출처(T2-02): 원본이 아니면 멈춤 → 되돌리면 적용
    orig = scalar("select pg_get_constraintdef(oid) from pg_constraint where conname='notifications_source_check'")
    sqlfile(text="alter table workhub.notifications drop constraint notifications_source_check, add constraint notifications_source_check check (source_module is null or source_id is not null)")
    e1 = sqlerr(src(p2('T2-02_알림출처_시간표.sql')))
    sqlfile(text=f"alter table workhub.notifications drop constraint notifications_source_check, add constraint notifications_source_check {orig}")
    check('A07 알림 출처 CHECK 가 P8-02 판이 아니면 T2-02 멈춤(되돌린 뒤 T2-07 FAIL 없음)', 'P8-02 판과 다릅니다' in e1 and not fails(t207()), e1)

    # ======================================================================= B. 접근 경계 · 켜기 전
    c = api(None, 'anon')
    pubs = [r[0] for r in sqlfile(text="select p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname ~ '^workhub_timetable_(operations|publication|exchange|school_day|execution)_' order by 1")]
    check('B01 T2 공개 함수 16개 · anon · service_role 실행 불가 · authenticated 만', len(pubs) == 16 and scalar(
        "select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname ~ '^workhub_timetable_(operations|publication|exchange|school_day|execution)_'"),
          pubs)
    c = api(T[21])
    check('B02 authenticated 는 T2 표 직접 읽기 · 내부 함수 실행 불가', all('permission denied' in err(c, f'select * from workhub.{x}') for x in (
        'timetable_lessons', 'timetable_exchange_requests', 'timetable_execution_records', 'timetable_execution_record_versions', 'timetable_operation_requests'))
          and 'permission denied' in err(c, "select workhub_private.t2_installed_all()"))
    r = adm.oready()
    check('B03 켜기 전 readiness = not_installed · 봉투(contract timetable-operations.v1)', ok(r) and d(r) == {'available': False, 'reason': 'not_installed'}
          and r['contract'] == 'timetable-operations.v1' and r['schoolId'] == s1 and r['memberId'] == m1, r)
    b4 = [adm.oget(DAY(1), DAY(8)), adm.eget('l-x'), adm.xprev({'kind': 'move'})]
    check('B04 켜기 전 조회 · 미리보기 · 기록 조회 → NOT_READY · 계약 이름 그대로', [ecode(x) for x in b4]
          == ['NOT_READY'] * 3 and adm.eget('l-x')['contract'] == 'timetable.execution-records.v1'
          and adm.go('workhub_timetable_school_day_preview', {}, '2026-01-01T00:00:00.000Z', DAY(), DAY(1))['contract'] == 'timetable-school-day.v1', b4)
    check('B05 켜기 전 복구 조회(모르는 번호) → NOT_FOUND(원장 먼저)', [ecode(x) for x in (adm.oexec({'kind': 'publish'}, recover=True),
          adm.erec(ecmd('l-x', 1, 0, None, 'completed', ''), recover=True), adm.sdexec({'kind': 'school_day'}, recover=True))] == ['NOT_FOUND'] * 3)

    # ======================================================================= C. T1 준비(기준판 · 편성 초안) · T2-08 켜기
    sqlfile(text=fill_json(os.path.join(W, 'p1', 'P1-04_학교활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인'}))
    sqlfile(text=fill_json(os.path.join(W, 'p5', 'P5-04_수업모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'counseling_scope': 'course_teachers'}))
    def mk(label, subj, teachers):
        r_ = adm.tmut(course_cmd(label, term2, subj, teachers, t2s, t2last)); return (r_ if isinstance(r_, dict) else {}).get('entityId') or (d(r_) or {}).get('entityId')
    CA = mk('국어 1-1', 'subj-kor', [M[21]]); CB = mk('정보 1-2', 'subj-info', [M[22]]); CC = mk('과학 1-1', 'subj-sci', [M[23]])
    check('C01 T2-08: T1(timetable) 이 켜지지 않았으면 멈춤', 'T2-08 중단' in sqlerr(t208()) and n('module_activations', "module='timetable_operations'") == 0)
    check('C02 T1-05 켜기', sqlerr(t105()) == 'OK')
    for cmd in (link(CA, None, ['cls-1-1']), link(CB, None, ['cls-1-2']), link(CC, None, ['cls-1-1'])):
        r_ = adm.sx(cmd)
        if not ok(r_): print('  연결 실패', cmd, r_)
    slots = [slot(i, dd, 540 + 55 * (i - 1)) for dd in range(1, 6) for i in (1, 2, 3)]
    ids = [x['id'] for x in slots]
    ps = d(adm.prep())
    draft = {'title': '2학기 운영 기준', 'slots': slots,
             'plans': [{'courseId': c_['id'], 'weeklyPeriods': 2, 'blocks': [{'id': f"L{c_['id'][-6:]}-{i}", 'periods': 1, 'allowedSlotIds': ids} for i in range(2)]}
                       for c_ in ps['courses']]}
    rs_ = adm.pex(pin('save', ps, draft)); DID = (d(rs_) or {}).get('draftId')
    rc = adm.pex(pin('confirm', d(adm.prep()), draft, DID, 1)); B = (d(rc) or {}).get('basis') or {}
    L = {}
    for l_ in B.get('lessons', []): L.setdefault(l_['courseId'], []).append(l_['id'])
    plan_ = {CA: ['s1-1', 's3-1'], CB: ['s1-1', 's3-2'], CC: ['s1-2', 's4-1']}
    pl = [{'lessonId': lid, 'slotId': plan_[cid][i]} for cid, lids in L.items() for i, lid in enumerate(lids)]
    inp = {'basisId': B.get('id'), 'basisRevision': 1, 'sourceFingerprint': B.get('sourceFingerprint'), 'title': '운영 1안',
           'conditions': {'fixed': [], 'unavailable': [], 'preferences': []}, 'placements': pl}
    rsv = adm.save(inp); DRAFT = (d(rsv) or {}).get('draftId')
    check('C03 준비: 기준판 확정 · 편성 초안 저장(국어 · 정보 · 과학 각 주 2회)', ok(rc) and ok(rsv) and len(pl) == 6, (rc, rsv))
    check('C04 T2-08 빈 칸 · 근거 빈칸 · 관리자 아님 → 멈춤(아무것도 쓰지 않음)', 'T2-08 중단: 입력 칸' in sqlerr(src(p2('T2-08_시간표운영활성화_양식.sql')))
          and '앱 배포 확인 근거' in sqlerr(t208(deploy=' ')) and '승인 근거는 1~200자' in sqlerr(t208(ref=' '))
          and '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(t208(approver=T[21])) and n('module_activations', "module='timetable_operations'") == 0)
    check('C05 T2-08 켜기 → 행 1 · 감사 1(배포 근거) · 다시 → 멈춤', sqlerr(t208()) == 'OK' and n('module_activations', "module='timetable_operations' and state='active'") == 1
          and scalar("select details->>'app_deploy_ref' from workhub.audit_events where operation='module.activate' and resource_id=%s", (s1 + ':timetable_operations',)) == DEPLOY
          and '이미 활성화 행이 있습니다' in sqlerr(t208()))
    r = t[21].oready()
    check('C06 교사 readiness = basis_missing(아직 공개 없음) · 관리자 = available(기준판 있음)', d(r) == {'available': False, 'reason': 'basis_missing'}
          and d(adm.oready()) == {'available': True}, r)
    check('C07 다른 학교 관리자 → not_installed(그 학교는 켜지 않음)', d(t[27].oready()) == {'available': False, 'reason': 'not_installed'})

    # ======================================================================= D. 공개(확정)
    F, U = DAY(1), DAY(15)
    pin_ = {'draftId': DRAFT, 'draftVersion': 1, 'from': F, 'until': U}
    check('D01 교사는 공개 미리보기 FORBIDDEN', ecode(t[21].pprev(pin_)) == 'FORBIDDEN')
    bads = [dict(pin_, extra=1), dict(pin_, until=F), dict(pin_, until=DAY(400)), dict(pin_, draftVersion=0), dict(pin_, draftId='bad id'), dict(pin_, **{'from': '2026-1-1'})]
    check('D02 잘못된 공개 입력(남는 칸 · 0일 · 366일 초과 · 판 0 · 잘못된 ID · 날짜 형식) → INVALID_INPUT', [ecode(adm.pprev(b)) for b in bads] == ['INVALID_INPUT'] * len(bads),
          [ecode(adm.pprev(b)) for b in bads])
    check('D03 없는 초안 → NOT_FOUND', ecode(adm.pprev(dict(pin_, draftId='nope'))) == 'NOT_FOUND')
    pv = adm.pprev(pin_); P = d(pv) or {}
    nweek = sum(1 for k in range(1, 15) if (TODAY + datetime.timedelta(days=k)).isoweekday() in (1, 3, 4))
    exp_n = sum({1: 3, 3: 2, 4: 1}.get((TODAY + datetime.timedelta(days=k)).isoweekday(), 0) for k in range(1, 15))
    check('D04 공개 미리보기: 키 정확 · 바뀌는 수업 = 14일치 배치 · 모두 new(before null) · 차단 0 · 참여 교사 3명', ok(pv)
          and set(P) == {'input', 'complete', 'changes', 'participants', 'blockers', 'preserved', 'excludedDays', 'previewId', 'previewHash', 'createdAt', 'expiresAt'}
          and len(P['changes']) == exp_n and all(c_['before'] is None for c_ in P['changes']) and P['blockers'] == []
          and [x['id'] for x in P['participants']] == sorted([M[21], M[22], M[23]]), (nweek, exp_n, pv if not ok(pv) else {k: v for k, v in P.items() if k != 'changes'}))
    k_pub = key(); cmd_pub = {'kind': 'publish', 'preview': {'previewId': P.get('previewId'), 'previewHash': P.get('previewHash'), 'expiresAt': P.get('expiresAt'), 'input': pin_}}
    check('D05 미리보기 지문이 다르면 → CONFLICT', ecode(adm.oexec(dict(cmd_pub, preview=dict(cmd_pub['preview'], previewHash='0' * 64)))) == 'CONFLICT')
    rp = adm.oexec(cmd_pub, k_pub)
    check('D06 공개 확정 → 접수증(kind publish · status published · changedLessons = 미리보기 순서 · 판 1)', ok(rp) and d(rp)['kind'] == 'publish' and d(rp)['status'] == 'published'
          and [x['id'] for x in d(rp)['changedLessons']] == [c_['after']['id'] for c_ in P['changes']] and all(x['version'] == 1 for x in d(rp)['changedLessons'])
          and n('timetable_lessons') == exp_n, rp)
    check('D07 같은 번호 재전송 · 복구 → 같은 접수증 · 다른 내용 → IDEMPOTENCY_CONFLICT', adm.oexec(cmd_pub, k_pub) == rp and adm.oexec(cmd_pub, k_pub, recover=True) == rp
          and ecode(adm.oexec(dict(cmd_pub, kind='submit'), k_pub)) == 'IDEMPOTENCY_CONFLICT' and n('timetable_publications') == 1)
    pv2 = adm.pprev(pin_)
    check('D08 같은 초안을 다시 미리보기 → 바뀔 것 없음(NO_CHANGES 차단)', ok(pv2) and [b['code'] for b in d(pv2)['blockers']] == ['NO_CHANGES'] and d(pv2)['changes'] == [], pv2)
    g = t[21].oget(F, DAY(8)); G = d(g) or {}
    mine = [l_ for l_ in G.get('lessons', []) if any(x['id'] == M[21] for x in l_['teachers'])]
    check('D09 교사 조회: 공개된 수업 전부 보임 · 자기 수업만 canRequest · 남의 수업은 false · 공개 이력 1 · 초안 목록 없음(관리자만)', ok(g) and len(G['lessons']) > 0
          and all(l_['canRequest'] for l_ in mine) and not any(l_['canRequest'] for l_ in G['lessons'] if l_ not in mine)
          and len(G['publications']) == 1 and G['drafts'] == [] and G['canPublish'] is False, g)
    check('D10 교사 readiness = available(공개 있음)', d(t[21].oready()) == {'available': True})
    rf = t[21].refs(G.get('asOf'), F, DAY(8))
    check('D11 학급 · 공간 참조: 조회한 수업마다 groups(ID · 이름) · 판', ok(rf) and [x['lessonId'] for x in d(rf)['lessons']] == [l_['id'] for l_ in G['lessons']]
          and all(x['groups'] for x in d(rf)['lessons']), rf)
    # 큰 공개 명세(manifest) 경로: 다음 기간
    pin2 = {'draftId': DRAFT, 'draftVersion': 1, 'from': DAY(15), 'until': DAY(29)}
    mf = adm.manifest(pin2); MF = d(mf) or {}
    pg0 = adm.page(MF.get('previewId'), MF.get('manifestHash'), 0)
    check('D12 확정 명세: totalChanges · 쪽 지문 · 첫 쪽 = 그 쪽 지문 · 다른 지문으로 쪽 요청 → CONFLICT', ok(mf) and MF['totalChanges'] > 0 and len(MF['pageHashes']) == 1
          and ok(pg0) and ecode(adm.page(MF['previewId'], '0' * 64, 0)) == 'CONFLICT', (mf, pg0))
    mcmd = {'kind': 'publish_manifest', 'previewId': MF.get('previewId'), 'previewHash': MF.get('previewHash'), 'manifestHash': MF.get('manifestHash'),
            'basisFingerprint': MF.get('basisFingerprint'), 'input': pin2, 'expiresAt': MF.get('expiresAt'), 'totalChanges': MF.get('totalChanges')}
    rm = adm.pubexec(mcmd)
    check('D13 확정 명세 참조로 공개 → 접수증(changedCount = totalChanges)', ok(rm) and d(rm)['changedCount'] == MF['totalChanges'] and n('timetable_publications') == 2, rm)

    # ======================================================================= E. 교환 · 이동 요청 → 동의 → 승인 · 알림
    G = d(t[21].oget(F, DAY(8)))
    la = next(l_ for l_ in G['lessons'] if any(x['id'] == M[21] for x in l_['teachers']) and l_['canRequest']
              and any(x != l_['time'] and x['startsAt'] > G['asOf'] for x in l_['allowedTargets']))
    tgt = next(x for x in la['allowedTargets'] if x != la['time'] and x['startsAt'] > G['asOf'])
    mv = {'kind': 'move', 'lessonId': la['id'], 'expectedVersion': la['version'], 'target': {'startsAt': tgt['startsAt'], 'endsAt': tgt['endsAt']}, 'reason': '출장'}
    check('E01 남의 수업 이동 미리보기 → FORBIDDEN · 판 다름 → CONFLICT', ecode(t[22].xprev(mv)) == 'FORBIDDEN' and ecode(t[21].xprev(dict(mv, expectedVersion=9))) == 'CONFLICT')
    xp = t[21].xprev(mv); X = d(xp) or {}
    check('E02 이동 미리보기: 바뀌는 수업 1 · 참여 = 본인 · 차단 0', ok(xp) and len(X['changes']) == 1 and [x['id'] for x in X['participants']] == [M[21]] and X['blockers'] == [], xp)
    sub = {'kind': 'submit', 'preview': {'previewId': X.get('previewId'), 'previewHash': X.get('previewHash'), 'expiresAt': X.get('expiresAt'), 'input': mv}}
    rsub = t[21].oexec(sub)
    check('E03 이동 요청 제출(본인만 참여) → 승인 대기 · 수업은 아직 그대로', ok(rsub) and d(rsub)['status'] == 'awaiting_approval'
          and scalar("select starts_at from workhub.timetable_lessons where id=%s", (la['id'],)) is not None, rsub)
    REQ = d(rsub).get('entityId') if ok(rsub) else None
    rq = next((x for x in d(adm.oget(F, DAY(8)))['requests'] if x['id'] == REQ), {})
    check('E04 관리자 조회: 요청 보임 · actions = approve · rejectApproval', set(rq.get('actions', [])) == {'approve', 'rejectApproval'}, rq)
    check('E05 같은 수업 다시 요청 미리보기 → CONFLICT(화면이 본 수업과 달라짐 — 앱이 다시 조회)', ecode(t[21].xprev(mv)) == 'CONFLICT')
    act = lambda who, a_, r_=None: who.oexec({'kind': 'action', 'requestId': REQ, 'expectedVersion': (r_ or rq)['version'], 'proposalHash': (r_ or rq)['proposalHash'], 'action': a_})
    check('E06 다른 교사가 승인 → NOT_FOUND(볼 수 없음) · 요청자 본인이 승인 → FORBIDDEN', ecode(act(t[22], 'approve')) == 'NOT_FOUND'
          and ecode(act(t[21], 'approve')) == 'FORBIDDEN')
    ra = act(adm, 'approve')
    check('E07 관리자 승인 → 적용 · 수업 시각 = 목표 시각 · 판 +1 · pinned', ok(ra) and d(ra)['status'] == 'applied'
          and scalar("select to_char(starts_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') from workhub.timetable_lessons where id=%s", (la['id'],)) == tgt['startsAt']
          and scalar("select version from workhub.timetable_lessons where id=%s", (la['id'],)) == la['version'] + 1
          and scalar("select pinned from workhub.timetable_lessons where id=%s", (la['id'],)), ra)
    check('E08 T2-02 전: 알림 0(출처 timetable 없음)', n('notifications', "source_module='timetable'") == 0)
    rows = sqlfile(p2('T2-02_알림출처_시간표.sql'))
    check('E09 T2-02 적용 → 검증 2행 ok · T2-07 FAIL 없음', [r[2] for r in rows] == ['ok', 'ok'] and not fails(t207()), rows)
    # 메신저(P3) 모듈 켜기 — 알림은 메신저가 준비일 때만
    e_msg = sqlerr(fill_json(os.path.join(W, 'p3', 'P3-04_메시지활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인',
                                                                                'body_characters': 5000, 'title_characters': 200, 'recipients': 100}))
    msg_ready = scalar("select workhub_private.p3_messaging_reason(%s)", (s1,))
    check('E09b 메신저(P3-04) 켜기 → 준비(알림을 만들 수 있음)', msg_ready == 'ready', (e_msg, msg_ready))
    # 교환(swap): 김국어 수업 ↔ 이정보 수업
    G = d(t[21].oget(F, DAY(15)))
    G22 = d(t[22].oget(F, DAY(15)))
    pairs = [(lb, lc) for lb in G['lessons'] if any(x['id'] == M[21] for x in lb['teachers']) and lb['canRequest']
             for lc in G22['lessons'] if any(x['id'] == M[22] for x in lc['teachers']) and lc['canRequest']
             and lc['time'] in lb['allowedTargets'] and lb['time'] in lc['allowedTargets'] and lc['time'] != lb['time']]
    xs, XS, sw = None, {}, None
    for lb, lc in pairs:
        sw = {'kind': 'swap', 'lessonId': lb['id'], 'expectedVersion': lb['version'], 'otherLessonId': lc['id'], 'otherExpectedVersion': lc['version'], 'reason': ''}
        xs = t[21].xprev(sw); XS = d(xs) or {}
        if ok(xs) and not XS['blockers']: break
    check('E10 교환 미리보기: 바뀌는 수업 2 · 참여 2명', ok(xs) and len(XS['changes']) == 2 and len(XS['participants']) == 2, xs)
    rs2 = t[21].oexec({'kind': 'submit', 'preview': {'previewId': XS.get('previewId'), 'previewHash': XS.get('previewHash'), 'expiresAt': XS.get('expiresAt'), 'input': sw}})
    R2 = (d(rs2) or {}).get('entityId')
    check('E11 교환 요청 → 동의 대기 · (메신저 준비면) 상대 교사에게 동의 요청 알림 1', ok(rs2) and d(rs2)['status'] == 'awaiting_consent'
          and (msg_ready != 'ready' or n('notifications', "source_module='timetable' and owner_membership_id='m-22' and source_id=%s", (R2,)) == 1), (rs2, msg_ready))
    rq2 = next(x for x in d(t[22].oget(F, DAY(15)))['requests'] if x['id'] == R2)
    check('E12 상대 교사: actions = accept · reject', set(rq2['actions']) == {'accept', 'reject'}, rq2)
    rr = t[22].oexec({'kind': 'action', 'requestId': R2, 'expectedVersion': rq2['version'], 'proposalHash': rq2['proposalHash'], 'action': 'accept'})
    rq2b = next(x for x in d(adm.oget(F, DAY(15)))['requests'] if x['id'] == R2)
    check('E13 동의 → 승인 대기 · 관리자 actions = approve', ok(rr) and rq2b['state'] == 'awaiting_approval' and 'approve' in rq2b['actions'], (rr, rq2b))
    old = t[22].oexec({'kind': 'action', 'requestId': R2, 'expectedVersion': rq2['version'], 'proposalHash': rq2['proposalHash'], 'action': 'reject'})
    check('E14 옛 판으로 다시 응답 → CONFLICT', ecode(old) == 'CONFLICT', old)
    ra2 = adm.oexec({'kind': 'action', 'requestId': R2, 'expectedVersion': rq2b['version'], 'proposalHash': rq2b['proposalHash'], 'action': 'approve'})
    check('E15 승인 → 두 수업 시각이 서로 바뀜', ok(ra2) and d(ra2)['status'] == 'applied'
          and scalar("select starts_at from workhub.timetable_lessons where id=%s", (lb['id'],)) == scalar("select (%s)::timestamptz", (lc['time']['startsAt'],)), ra2)
    check('E16 감사: 교환 제출 2 · 승인 2(school 민감도)', n('audit_events', "operation='timetable.exchange_submit'") == 2
          and n('audit_events', "operation='timetable.exchange_approve'") == 2, scalar("select string_agg(operation, ',') from workhub.audit_events where operation like 'timetable.%%'"))
    # 추천
    G = d(t[21].oget(F, DAY(8)))
    ld = next(l_ for l_ in G['lessons'] if any(x['id'] == M[21] for x in l_['teachers']) and l_['canRequest'])
    rec = t[21].recommend({'lessonId': ld['id'], 'expectedVersion': ld['version'], 'reason': '연수', 'from': F, 'until': DAY(8)}, G['asOf'])
    check('E17 추천: status 는 candidates · none_found · search_limited 중 하나 · 후보마다 미리보기 그대로 제출 가능 모양', ok(rec)
          and d(rec).get('status') in ('candidates', 'none_found', 'search_limited'), rec)

    # ======================================================================= F. 학사 변경(휴업)
    G = d(adm.oget(F, DAY(8)))
    day_ = next(l_['time']['startsAt'] for l_ in G['lessons'] if not l_['canRequest'] is None)
    target_day = None
    for k in range(2, 8):
        dd = DAY(k)
        ls = [l_ for l_ in G['lessons'] if datetime.datetime.fromisoformat(l_['time']['startsAt'].replace('Z', '+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat() == dd]
        if ls and all(l_['state'] == 'scheduled' for l_ in ls): target_day = dd; break
    refs_ = d(adm.refs(G['asOf'], F, DAY(8)))
    gids = sorted({g_['id'] for x in refs_['lessons'] for g_ in x['groups']})
    sd = {'kind': 'closure', 'date': target_day, 'groupIds': gids, 'reason': '재량휴업', 'bells': []}
    check('F01 교사는 학사 변경 미리보기 FORBIDDEN', ecode(t[21].sdprev(sd, G['asOf'], F, DAY(8))) == 'FORBIDDEN')
    sp = adm.sdprev(sd, G['asOf'], F, DAY(8)); SP = d(sp) or {}
    check('F02 휴업 미리보기: 그날 수업 전부 취소 · 차단 0(또는 EXISTING_EXCHANGE 만)', ok(sp) and all(c_['after']['state'] == 'cancelled' for c_ in SP.get('changes', [])), sp)
    if ok(sp) and not SP['blockers']:
        rx = adm.sdexec({'kind': 'school_day', 'preview': {'previewId': SP['previewId'], 'previewHash': SP['previewHash'], 'expiresAt': SP['expiresAt']}})
        check('F03 휴업 반영 → 접수증(applied · changedLessonCount) · 수업 cancelled · changed_by school_day', ok(rx) and d(rx)['changedLessonCount'] == len(SP['changes'])
              and n('timetable_lessons', "state='cancelled' and changed_by='school_day'") == len(SP['changes']), rx)
    else:
        check('F03 휴업 반영(미리보기에 차단이 있어 건너뜀)', False, SP.get('blockers'))
    check('F04 옛 asOf 로 학사 변경 미리보기 → CONFLICT(그 뒤 바뀐 수업)', ecode(adm.sdprev(sd, G['asOf'], F, DAY(8))) == 'CONFLICT')

    # ======================================================================= G. 실시 기록
    G = d(t[21].oget(F, DAY(8)))
    le = next(l_ for l_ in G['lessons'] if any(x['id'] == M[21] for x in l_['teachers']) and l_['state'] == 'scheduled')
    eg = t[21].eget(le['id']); EG = d(eg) or {}
    check('G01 끝나지 않은 수업: allowedOutcomes [] · current null · history [] · nextCursor null · 키 정확', ok(eg)
          and set(EG) == {'asOf', 'timeZone', 'lesson', 'allowedOutcomes', 'current', 'history', 'nextCursor'} and EG['allowedOutcomes'] == []
          and EG['current'] is None and EG['history'] == [] and EG['nextCursor'] is None and set(EG['lesson']) == {'id', 'version', 'label', 'startsAt', 'endsAt', 'state', 'teacherIds'}, eg)
    check('G02 끝나지 않은 수업 기록 → FORBIDDEN', ecode(t[21].erec(ecmd(le['id'], le['version'], 0, None, 'completed', ''))) == 'FORBIDDEN')
    check('G03 담당이 아닌 교사 조회 → FORBIDDEN · 관리자는 조회만(allowedOutcomes [])', ecode(t[22].eget(le['id'])) == 'FORBIDDEN'
          and ok(adm.eget(le['id'])) and d(adm.eget(le['id']))['allowedOutcomes'] == [] and ecode(t[21].eget('nope')) == 'NOT_FOUND'
          and ecode(t[27].eget(le['id'])) == 'NOT_READY')
    # 시간 흐름 흉내: 이 수업을 지난 주로 옮긴다(시험 전용 — 앱 · 운영 경로 아님)
    call(run, "update workhub.timetable_lessons set starts_at = starts_at - interval '14 days', ends_at = ends_at - interval '14 days' where id=%s", (le['id'],))
    eg = t[21].eget(le['id']); EG = d(eg)
    check('G04 끝난 수업: 담당 교사 allowedOutcomes = 3종 · 관리자는 []', EG['allowedOutcomes'] == ['completed', 'not_performed', 'needs_review']
          and d(adm.eget(le['id']))['allowedOutcomes'] == [], eg)
    check('G05 관리자 대리 기록 → FORBIDDEN', ecode(adm.erec(ecmd(le['id'], le['version'], 0, None, 'completed', ''))) == 'FORBIDDEN')
    bad = [ecmd(le['id'], le['version'], 0, None, 'not_performed', ''), ecmd(le['id'], le['version'], 0, None, 'needs_review', '  '),
           ecmd(le['id'], le['version'], 0, None, 'done', ''), ecmd(le['id'], le['version'], 0, 'r-1', 'completed', ''),
           ecmd(le['id'], le['version'], 0, None, 'completed', '', '사유'), ecmd(le['id'], le['version'], 1, None, 'completed', '', '사유'),
           ecmd(le['id'], le['version'], 1, 'r-1', 'completed', '', None), ecmd(le['id'], 0, 0, None, 'completed', ''),
           ecmd(le['id'], le['version'], 0, None, 'completed', 'x' * 1001), dict(ecmd(le['id'], le['version'], 0, None, 'completed', ''), extra=1),
           ecmd(le['id'], le['version'], 2147483647, 'r-1', 'completed', '', '사유')]
    got = [ecode(t[21].erec(b)) for b in bad]
    check('G06 잘못된 기록(메모 필수 빈칸 · 공백 · 모르는 결과 · 초판 ID · 초판 사유 · 정정 ID 없음 · 정정 사유 없음 · 수업 판 0 · 1001자 · 남는 칸 · 판 넘침) → INVALID_INPUT',
          got == ['INVALID_INPUT'] * len(bad), got)
    check('G07 수업 판이 다르면 CONFLICT', ecode(t[21].erec(ecmd(le['id'], le['version'] + 1, 0, None, 'completed', ''))) == 'CONFLICT')
    k1 = key(); c1 = ecmd(le['id'], le['version'], 0, None, 'completed', '직접 확인')
    r1 = t[21].erec(c1, k1); R1 = d(r1) or {}
    check('G08 첫 기록 → {requestKey, commandHash, record} · 판 1 · correctionReason null · recordedBy = 본인 이름', ok(r1) and set(R1) == {'requestKey', 'commandHash', 'record'}
          and R1['record']['version'] == 1 and R1['record']['correctionReason'] is None and R1['record']['recordedBy'] == {'id': M[21], 'name': '김국어'}
          and R1['record']['lessonVersion'] == le['version'] and R1['commandHash'] == scalar("select workhub_private.p2_sha(%s::jsonb)", (json.dumps(c1),)), r1)
    check('G09 같은 번호 재전송 · 복구 → 같은 접수증 · 다른 내용 → IDEMPOTENCY_CONFLICT · 모르는 번호 복구 → NOT_FOUND', t[21].erec(c1, k1) == r1
          and t[21].erec(c1, k1, recover=True) == r1 and ecode(t[21].erec(dict(c1, note='x'), k1)) == 'IDEMPOTENCY_CONFLICT'
          and ecode(t[21].erec(c1, recover=True)) == 'NOT_FOUND')
    check('G10 같은 수업 두 번째 첫 기록(판 0) → CONFLICT · 수업 state 그대로 scheduled', ecode(t[21].erec(c1)) == 'CONFLICT'
          and scalar("select state from workhub.timetable_lessons where id=%s", (le['id'],)) == 'scheduled')
    EG = d(t[21].eget(le['id']))
    check('G11 조회: current = history[0] = 접수증의 record', EG['current'] == R1['record'] and EG['history'] == [R1['record']] and EG['nextCursor'] is None, EG)
    rid = R1['record']['id']
    # 정정 21판까지
    cur_v = 1; outs = ['not_performed', 'needs_review', 'completed']
    for i in range(2, 23):
        r_ = t[21].erec(ecmd(le['id'], le['version'], cur_v, rid, outs[i % 3], f'정정 {i}', f'사유 {i}'))
        if not ok(r_): print('  정정 실패', i, r_); break
        cur_v = d(r_)['record']['version']
    check('G12 정정 21번 → 판 22 · 같은 원장 ID · 이력 22행', cur_v == 22 and n('timetable_execution_record_versions', 'record_id=%s', (rid,)) == 22)
    eg = t[21].eget(le['id']); EG = d(eg)
    check('G13 22판 조회: 첫 쪽 22..3(20개) · nextCursor 있음 · current = history[0]', [x['version'] for x in EG['history']] == list(range(22, 2, -1))
          and EG['nextCursor'] and EG['current'] == EG['history'][0], eg)
    t[21].erec(ecmd(le['id'], le['version'], 22, rid, 'completed', '정정 23', '사유 23'))
    h = t[21].ehist(le['id'], 22, EG['nextCursor']); H = d(h) or {}
    check('G14 다음 쪽(그 사이 23판이 생겨도 anchor 22 기준): 2..1 · nextCursor null · 키 정확', ok(h) and set(H) == {'lessonId', 'anchorRecordVersion', 'history', 'nextCursor'}
          and [x['version'] for x in H['history']] == [2, 1] and H['nextCursor'] is None and H['anchorRecordVersion'] == 22, h)
    tamper = EG['nextCursor'][:-1] + ('0' if EG['nextCursor'][-1] != '0' else '1')
    check('G15 변조 cursor · 다른 anchor · 쪽 크기 21 · 다른 교사 → CONFLICT · CONFLICT · INVALID_INPUT · FORBIDDEN',
          [ecode(t[21].ehist(le['id'], 22, tamper)), ecode(t[21].ehist(le['id'], 21, EG['nextCursor'])), ecode(t[21].ehist(le['id'], 22, EG['nextCursor'], 21)),
           ecode(t[22].ehist(le['id'], 22, EG['nextCursor']))] == ['CONFLICT', 'CONFLICT', 'INVALID_INPUT', 'FORBIDDEN'])
    check('G16 이력 행은 고칠 수 없음', sqlerr("update workhub.timetable_execution_record_versions set note='x'") != 'OK'
          and sqlerr("delete from workhub.timetable_execution_record_versions") != 'OK')
    check('G17 감사: 첫 기록 1 · 정정 22 · 메모 원문 없음', n('audit_events', "operation='timetable.execution_record'") == 1
          and n('audit_events', "operation='timetable.execution_correct'") == 22 and n('audit_events', "operation like 'timetable.execution%%' and details::text like '%%정정%%'") == 0)
    # 동시 첫 기록 — 다른 수업
    lf = next(l_ for l_ in G['lessons'] if any(x['id'] == M[21] for x in l_['teachers']) and l_['state'] == 'scheduled' and l_['id'] != le['id'])
    call(run, "update workhub.timetable_lessons set starts_at = starts_at - interval '14 days', ends_at = ends_at - interval '14 days' where id=%s", (lf['id'],))
    cf = ecmd(lf['id'], lf['version'], 0, None, 'needs_review', '확인 필요')
    o = concurrently([lambda: t[21].erec(cf), lambda: t[21].erec(cf)])
    check('G18 두 탭이 같은 수업 첫 기록을 동시에(다른 번호) → 하나만 성공 · 하나 CONFLICT · 원장 1', sorted(['ok' if ok(x) else ecode(x) for x in o]) == ['CONFLICT', 'ok']
          and n('timetable_execution_records', 'lesson_id=%s', (lf['id'],)) == 1, o)
    kk = key(); cg = ecmd(lf['id'], lf['version'], 1, d(next(x for x in o if ok(x)))['record']['id'], 'completed', '', '확인함')
    o = concurrently([lambda: t[21].erec(cg, kk), lambda: t[21].erec(cg, kk)])
    check('G19 같은 번호를 동시에 두 번 → 같은 접수증 · 판 2 한 번만', o[0] == o[1] and ok(o[0]) and d(o[0])['record']['version'] == 2, o)

    # ======================================================================= H. 중지 · 사용 뒤 점검
    sqlfile(text=module_sql('P2-80_모듈중지.sql', 'timetable_operations', '시험 중지'))
    check('H01 중지 → readiness not_installed · 조회 · 기록 NOT_READY · 반영된 요청 복구는 원래 접수증', d(adm.oready()) == {'available': False, 'reason': 'not_installed'}
          and ecode(t[21].oget(F, DAY(8))) == 'NOT_READY' and ecode(t[21].eget(le['id'])) == 'NOT_READY'
          and t[21].erec(c1, k1, recover=True) == r1 and adm.oexec(cmd_pub, k_pub, recover=True) == rp)
    sqlfile(text=module_sql('P2-81_모듈재개.sql', 'timetable_operations', '시험 재개'))
    check('H02 재개 → available', d(adm.oready()) == {'available': True})
    sqlfile(text=module_sql('P2-80_모듈중지.sql', 'timetable', '시험 중지'))
    check('H03 시간표(T1)를 끄면 운영도 NOT_READY', d(adm.oready()) == {'available': False, 'reason': 'not_installed'})
    sqlfile(text=module_sql('P2-81_모듈재개.sql', 'timetable', '시험 재개'))
    check('H04 사용 뒤 T2-07 FAIL 없음', not fails(t207()), fails(t207()))
    check('H05 원장(요청 번호) 행은 고칠 수 없음', sqlerr("update workhub.timetable_operation_requests set response='{}'") != 'OK')
    # ======================================================================= I. 요청 번호 포기(취소 기록)
    def eligible(exclude):
        G_ = d(t[21].oget(F, DAY(29)))
        return [l_ for l_ in G_['lessons'] if any(x['id'] == M[21] for x in l_['teachers']) and l_['state'] == 'scheduled' and l_['id'] not in exclude]
    ab = adm.abandon('operations', cmd_pub, k_pub); AB = d(ab) or {}
    check('I01 이미 반영된 번호 포기 → outcome applied · 원래 접수증 그대로 · 원장 행 그대로', ok(ab) and AB.get('outcome') == 'applied'
          and AB['receipt'] == d(rp) and set(AB) == {'kind', 'requestKey', 'commandHash', 'outcome', 'receipt', 'decidedAt'}
          and n('timetable_operation_requests', "outcome='abandoned'") == 0, ab)
    check('I02 반영된 번호를 다른 명령으로 포기 → IDEMPOTENCY_CONFLICT', ecode(adm.abandon('operations', dict(cmd_pub, kind='submit'), k_pub)) == 'IDEMPOTENCY_CONFLICT')
    lg, lh, li = eligible({le['id'], lf['id']})[:3]
    for l_ in (lg, lh, li):
        call(run, "update workhub.timetable_lessons set starts_at = starts_at - interval '14 days', ends_at = ends_at - interval '14 days' where id=%s", (l_['id'],))
    kg = key(); cmd_g = ecmd(lg['id'], lg['version'], 0, None, 'completed', '늦은 원요청')
    a1 = t[21].abandon('execution', cmd_g, kg); a2 = t[21].abandon('execution', cmd_g, kg); A1 = d(a1) or {}
    check('I03 모르는 번호 포기 → outcome abandoned · receipt null · 다시 포기해도 같은 응답(같은 decidedAt)', ok(a1) and A1['outcome'] == 'abandoned'
          and A1['receipt'] is None and A1['commandHash'] == scalar("select workhub_private.p2_sha(%s::jsonb)", (json.dumps(cmd_g),)) and a1 == a2
          and n('timetable_operation_requests', "outcome='abandoned'") == 1, [a1, a2])
    check('I04 포기한 번호로 늦게 온 최초 요청 · 복구 조회 → CONFLICT · 다른 명령 → IDEMPOTENCY_CONFLICT · 기록 0 · 새 번호로는 기록됨',
          [ecode(t[21].erec(cmd_g, kg)), ecode(t[21].erec(cmd_g, kg, recover=True)), ecode(t[21].erec(dict(cmd_g, note='x'), kg))] == ['CONFLICT', 'CONFLICT', 'IDEMPOTENCY_CONFLICT']
          and n('timetable_execution_records', 'lesson_id=%s', (lg['id'],)) == 0 and ok(t[21].erec(cmd_g))
          and n('timetable_execution_records', 'lesson_id=%s', (lg['id'],)) == 1)
    got = [ecode(t[21].abandon('lessons', cmd_g, key())), ecode(t[21].abandon('execution', [1], key())), ecode(t[21].abandon('execution', cmd_g, 'bad key'))]
    check('I05 모르는 종류 · 객체 아닌 명령 · 잘못된 번호 → INVALID_INPUT', got == ['INVALID_INPUT'] * 3, got)
    check('I06 같은 번호도 다른 교사의 포기는 내 번호에 영향 없음(소속마다 원장)', d(t[22].abandon('execution', cmd_g, kg))['outcome'] == 'abandoned'
          and d(t[21].abandon('execution', cmd_g, kg)) == A1)
    for _ in range(3):
        kh = key(); cmd_h = ecmd(lh['id'], lh['version'], 0, None, 'needs_review', '경합')
        o = concurrently([lambda: t[21].erec(cmd_h, kh), lambda: t[21].abandon('execution', cmd_h, kh)])
        recs = n('timetable_execution_records', 'lesson_id=%s', (lh['id'],))
        good = (ok(o[0]) and d(o[1])['outcome'] == 'applied' and d(o[1])['receipt'] == d(o[0]) and recs == 1) or \
               (ecode(o[0]) == 'CONFLICT' and d(o[1])['outcome'] == 'abandoned' and recs == 0)
        if not good or recs == 1: break
    check('I07 최초 요청과 포기가 동시에 → (반영 + 포기 응답이 그 접수증) 또는 (포기 + 요청 CONFLICT · 기록 0) 둘 중 하나', good, o)
    sqlfile(text=module_sql('P2-80_모듈중지.sql', 'timetable_operations', '시험 중지'))
    ki = key(); cmd_i = ecmd(li['id'], li['version'], 0, None, 'completed', '')
    a3 = t[21].abandon('execution', cmd_i, ki)
    check('I08 모듈을 꺼도 포기는 됨(NOT_READY 아님) · 켠 뒤에도 그 번호는 CONFLICT', ok(a3) and d(a3)['outcome'] == 'abandoned', a3)
    spoof = O(T[22], M[21]).abandon('execution', cmd_i, ki); other = O(T[21], M[22]).abandon('execution', cmd_i, key())
    check('I10 모듈 중지 중에도 본인 확인 유지: 남의 소속 ID 로 포기 → 거부(소속 아님) · 원장 그대로', not ok(spoof) and not ok(other)
          and 'INACTIVE_MEMBERSHIP' in str(spoof) + str(other) and n('timetable_operation_requests', 'request_key=%s', (ki,)) == 1, [spoof, other])
    sqlfile(text=module_sql('P2-81_모듈재개.sql', 'timetable_operations', '시험 재개'))
    check('I09 재개 뒤 포기한 번호 CONFLICT · 원장 행은 고칠 수 없음 · T2-07 FAIL 없음', ecode(t[21].erec(cmd_i, ki)) == 'CONFLICT'
          and sqlerr("update workhub.timetable_operation_requests set outcome='applied' where outcome='abandoned'") != 'OK' and not fails(t207()), fails(t207()))
    if POLICY:
        check('H06 한도 = 앱 execution-records-policy.json(메모 1000 · 사유 500 · 쪽 20 · 수업 14400초)', POLICY['note'] == 1000 and POLICY['correctionReason'] == 500
              and POLICY['pageSize'] == 20 and POLICY['maxLessonSeconds'] == 14400)


if __name__ == '__main__':
    main()
