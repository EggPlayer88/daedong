# P8 정책 보강(Q4 학년도 시작 연도 · C6 협업 알림 · Q2 업무 인계 관리자 확인 · 수업 담당/수강 변경) 시험.
# 임시 PostgreSQL 17 + Supabase 흉내. 운영과 무관. 사람 요청은 PostgREST 와 같은 경로(authenticator → set role → JWT)로 부른다.
# 받은 응답은 P8_CAPTURE 에 남겨 app_contract_p8.ts 가 PR #60 앱의 실제 서비스 · parser 에 넣는다.
#
# 사용: python3 run_p8.py   (R1 + P1 + P2 + P3 + P5 + P7 이 적용된 시험 DB 에서 — run_all.sh 가 준비한다. P8 은 이 시험이 설치한다)
#   P8_BRIDGE=0 이면 P7-05(협업 인계 보강) 없이 — 협업 "인계" 알림 행만 건너뛴다.
import datetime, hashlib, json, os, sys, threading
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'r1', 'test'))
from run_r1 import (admin, api, call, err, check, scalar, key, Who, data, fixtures, fill_json, U1, U2, T, M, TODAY, results)

S = os.path.join(HERE, '..')
W = os.path.join(HERE, '..', '..')
OUT = os.environ.get('P8_CAPTURE', '')
BRIDGE = os.environ.get('P8_BRIDGE', '1') != '0'
captures = []
DAY = lambda n=0: (TODAY + datetime.timedelta(days=n)).isoformat()
FILES = ['P8-01_학년도_시작연도.sql', 'P8-02_협업_알림.sql', 'P8-03_업무인계_관리자확인.sql', 'P8-04_수업_담당수강_변경.sql']
DEPLOY = 'PR #60 eee059f 미리보기 배포 확인(시험 합성 값)'


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
def stop(module): sqlfile(text=module_sql('P2-80_모듈중지.sql', module, '시험 중지'))
def resume(module): sqlfile(text=module_sql('P2-81_모듈재개.sql', module, '시험 재개'))
def p806(modules, approver=U1, ref='2026-10-16 정책 확정 · 시험 승인', deploy=DEPLOY):
    return fill_json(p('P8-06_정책모듈활성화_양식.sql'), {'approver_user_id': approver, 'approval_ref': ref, 'app_deploy_ref': deploy, 'modules': modules})
def fingerprint(): return [r for r in sqlfile(p('P8-00_사전점검_지문.sql')) if r[0] == '지문']
def postcheck(): return sqlfile(p('P8-05_사후점검.sql'))
def n(table, where='true', args=()): return scalar(f'select count(*) from workhub.{table} where {where}', args)
def concurrently(fns):
    outs = [None] * len(fns)
    def run(i): outs[i] = fns[i]()
    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(fns))]
    for t in ts: t.start()
    for t in ts: t.join()
    return outs
def canonical(v):
    """앱 relationCanonical 과 같은 규칙(키 정렬 · JSON.stringify 문자열 · 공백 없음)"""
    if isinstance(v, list): return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict): return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(v[k]) for k in sorted(v)) + '}'
    return json.dumps(v, ensure_ascii=False)
def sha(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()


class A(Who):
    """P8 이 닿는 공개 함수. 응답과 그때의 workhub_context 를 앱 대조용으로 남긴다."""
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
    # P7 업무 전환(앱 #60 은 미리보기 · 명령 전에 목록을 다시 읽는다 → 그 순간의 목록도 같이 남긴다)
    def tl(self, cursor=None): return self.keep('tr_list', self.go('workhub_school_transition_list', cursor), cursor=cursor)
    def tp(self, plan):
        lr = self.go('workhub_school_transition_list', None)
        return self.keep('tr_preview', self.go('workhub_school_transition_preview', plan), plan=plan, listRaw=lr if isinstance(lr, dict) else None)
    def tm(self, cmd, k=None):
        k = k or key(); lr = self.go('workhub_school_transition_list', None)
        return self.keep('tr_mutate', self.go('workhub_school_transition_mutate', cmd, k), command=cmd, key=k, listRaw=lr if isinstance(lr, dict) else None)
    # P1 학교 관리
    def sa_get(self, year=None): return self.keep('sa_get', self.go('workhub_school_admin_get', year), year=year)
    def sa_mut(self, cmd, k=None):
        k = k or key(); return self.keep('sa_mutate', self.go('workhub_school_admin_mutate', cmd, k), command=cmd, key=k)
    # P2 협업 · P3 알림
    def co(self, cmd, k=None):
        k = k or key(); return self.keep('coop_mutate', self.go('workhub_cooperation_mutate', cmd, k), command=cmd, key=k)
    def cg(self, rid): return self.keep('coop_get', self.go('workhub_cooperation_get', rid), requestId=rid)
    def inbox(self, cursor=None): return self.keep('inbox', self.go('workhub_inbox_list', False, cursor), cursor=cursor)
    def msg(self, cmd, k=None):
        k = k or key(); return self.keep('message_mutate', self.go('workhub_message_mutate', cmd, k, False), command=cmd, key=k)
    # P5 수업 · P8 관계
    def catalog(self): return self.keep('catalog', self.go('workhub_teaching_catalog'))
    def course(self, c): return self.keep('course', self.go('workhub_teaching_course', c), courseId=c)
    def tmut(self, cmd, k=None):
        k = k or key(); return self.keep('teaching_mutate', self.go('workhub_teaching_mutate', cmd, k), command=cmd, key=k)
    def rel(self, c): return self.keep('rel_snapshot', self.go('workhub_teaching_relations', c), courseId=c)
    def rpv(self, intent):
        # 앱 #60 은 미리보기 전에 그 수업의 관계 조회를 먼저 해 둔다 → 그 순간의 조회 응답도 같이 남긴다(읽기 전용)
        sr = self.go('workhub_teaching_relations', intent.get('courseId')) if isinstance(intent, dict) and isinstance(intent.get('courseId'), str) else None
        return self.keep('rel_preview', self.go('workhub_teaching_relation_preview', intent), intent=intent, snapshotRaw=sr if isinstance(sr, dict) else None)
    def rcm(self, cmd, k=None):
        k = k or key(); return self.keep('rel_commit', self.go('workhub_teaching_relation_commit', cmd, k), command=cmd, key=k)


def ecode(env):
    """P7 · P1 봉투 {error:{code}} · P2/P5/P8 봉투 {ok:false, code} · 봉투 없는 예외 문자열"""
    if isinstance(env, dict):
        if env.get('ok') is False: return env.get('code')
        return (env.get('error') or {}).get('code')
    return env
def ok7(env): return isinstance(env, dict) and 'data' in env
def okr(env): return isinstance(env, dict) and env.get('ok') is not False and env.get('contractVersion') == 'teaching-relations.v1'
def ho(recipient, rver, resources, note='인계 메모입니다'):
    return {'kind': 'handover', 'recipientMemberId': recipient, 'recipientVersion': rver, 'resources': resources, 'note': note}
def res(kind, rid, ver, label='자원'): return {'kind': kind, 'id': rid, 'version': ver, 'label': label}
def ny(source, year, first, last, t1f, t1l, t2f, t2l, copy=False):
    return {'kind': 'new_year', 'sourceYearId': source, 'targetYear': year, 'firstDay': first, 'lastDay': last, 'term1First': t1f,
            'term1Last': t1l, 'term2First': t2f, 'term2Last': t2l, 'copyStructure': copy}
def apply(plan, fp): return {'kind': 'apply', 'plan': plan, 'fingerprint': fp}
def act(kind, rid, ver, reason='확인했습니다'): return {'kind': kind, 'recordId': rid, 'expectedVersion': ver, 'reason': reason}
def mver(m): return scalar('select version from workhub.memberships where id=%s', (m,))
def coop_create(rcpt, title='평가 자료 협조', desc='학생 이름과 상담 내용이 들어간 설명(알림에 복사되면 안 됨)'):
    return {'kind': 'create', 'recipientMemberId': rcpt, 'title': title, 'description': desc, 'dueDate': '', 'sourceTask': None}
def coop_move(rid, ver, action, comment='의견 본문(알림에 복사되면 안 됨)'):
    return {'kind': 'transition', 'requestId': rid, 'expectedVersion': ver, 'action': action, 'comment': comment}
def cver(rid): return scalar('select version from workhub.cooperation_requests where id=%s', (rid,))
def course_cmd(label, term, subject, teachers, vf, vt): return {'kind': 'course_create', 'input': {'label': label, 'termId': term, 'subjectId': subject, 'teacherMemberIds': teachers, 'validFrom': vf, 'validThrough': vt}}
def roster(course, ver, rows, vf, vt): return {'kind': 'roster_import', 'courseId': course, 'expectedVersion': ver, 'rows': rows, 'validFrom': vf, 'validThrough': vt}
def srow(k, name, g, c, s): return {'schoolStudentKey': k, 'name': name, 'grade': g, 'classLabel': c, 'seatNumber': s}
def obs(course, st, assign, on, text='수업 중 토론에서 근거를 들어 의견을 말함.'):
    return {'kind': 'observation_save', 'courseId': course, 'studentId': st['id'], 'courseMembershipId': st['courseMembershipId'], 'assignmentId': assign,
            'recordId': None, 'expectedVersion': 0, 'input': {'occurredOn': on, 'text': text, 'followUpOn': '', 'reason': ''}}
def intent(kind, course, cver_, rel, rver, last, student=None, enrollment=None, repl=None, reason='학교 관리자 결정(시험)'):
    return {'kind': kind, 'courseId': course, 'expectedCourseVersion': cver_, 'relationId': rel, 'expectedRelationVersion': rver, 'studentId': student,
            'enrollmentId': enrollment, 'lastDay': last, 'replacementMemberId': repl, 'reason': reason}
def commit_of(pv): return {'previewId': pv['previewId'], 'previewFingerprint': pv['fingerprint'], 'intent': pv['intent'],
                           'expectedChanges': [{'kind': c['kind'], 'id': c['id'], 'version': c['version']} for c in pv['changes']]}
def course_ver(c): return scalar('select version from workhub.courses where id=%s', (c,))


def main():
    s1 = fixtures()
    m1 = scalar("select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s", (U1,))
    year = scalar("select id from workhub.academic_years where school_id=%s order by starts_on limit 1", (s1,))
    y_start, y_end = scalar("select array[starts_on::text, ends_on::text] from workhub.academic_years where id=%s", (year,))
    term2, t2s, t2e = scalar("select array[id, starts_on::text, ends_on::text] from workhub.terms where school_id=%s and term_no=2", (s1,))
    t2last = (datetime.date.fromisoformat(t2e) - datetime.timedelta(days=1)).isoformat()
    assert t2s <= DAY() and DAY(12) <= t2last, '시험은 2학기 안의 날짜에서 돈다'
    run = admin()
    call(run, "update workhub.accounts set display_name='김하늘' where id in ('acc-22','acc-23')")
    # 다른 학교(school-2): m-27 을 그 학교 관리자로
    call(run, "update workhub.memberships set valid_from='2026-03-01' where id='m-27'")
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values ('school-2', 'm-27', 'school_admin', '2026-03-01')")
    # 24 도 이 학교 관리자(받는 사람이 관리자일 때 자기 확인 금지 · 두 관리자 동시 확인 시험)
    call(run, "insert into workhub.membership_roles(school_id, membership_id, role_code, valid_from) values (%s, 'm-24', 'school_admin', %s)", (s1, y_start))
    # 교과(P5) · 공식 담당(P7)
    call(run, "insert into workhub.year_subjects(id, school_id, academic_year_id, name, sort_order) values ('subj-ethics', %s, %s, '도덕', 1), ('subj-info', %s, %s, '정보', 2)",
         (s1, year, s1, year))
    for aid, m, label in (('duty-21', 'm-21', '방과후 업무'), ('duty-21b', 'm-21', '정보 업무'), ('duty-21c', 'm-21', '도서 업무'),
                          ('duty-21d', 'm-21', '안전 업무'), ('duty-a1', m1, '관리자 본인 업무'), ('duty-25', 'm-25', '진로 업무')):
        call(run, """insert into workhub.staff_assignments(id, school_id, academic_year_id, membership_id, kind, label, valid_from, valid_to, assigned_by_membership_id)
                     values (%s, %s, %s, %s, 'duty', %s, %s, %s, %s)""", (aid, s1, year, m, label, DAY(-20), y_end, m1))
    adm = A(U1, m1)
    t = {k: A(T[k], M[k]) for k in (21, 22, 23, 24, 25, 26, 27, 28)}

    # ======================================================================= A. 설치 전 지문 → P8-01~04 → 사후 점검 · 지문 비교
    pre = [r for r in sqlfile(p('P8-00_사전점검_지문.sql')) if r[0] == '점검']
    check('A01 P8-00 사전 점검(설치 전) FAIL 없음', all(r[2] in ('ok', 'info') for r in pre), [r for r in pre if r[2] not in ('ok', 'info')])
    before = fingerprint()
    CHANGED = ['workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)', 'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)',
               'workhub_private.p7_record_guard()', 'workhub_private.p7_resources(text,text,text,date,text)',
               'workhub_private.p7_tr_preview(workhub_private.actor_context,jsonb)', 'workhub_private.p7_tr_list(workhub_private.actor_context,text)',
               'workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)', 'workhub_private.p5_current_assignment(workhub_private.actor_context,text)',
               'workhub_private.p5_course_visible(workhub_private.actor_context,text)', 'workhub_private.p5_catalog(workhub_private.actor_context)',
               'workhub_private.p5_roster_import(workhub_private.actor_context,jsonb,text)']
    body = lambda: {f: scalar("select array[prosrc, pg_get_function_result(oid), proacl::text, prosecdef::text, proconfig::text] from pg_proc where oid=%s::regprocedure", (f,)) for f in CHANGED}
    body0 = body()
    post0 = postcheck()
    check('A02 설치 전 P8-05: 10행 모두 info(미적용) · FAIL 없음', len(post0) == 10 and all(r[2] == 'info' for r in post0 if r[0] != 'P8-05-10'), post0)
    # 순서대로 하나씩 — 각 단계 뒤 P8-05 FAIL 없음(부분 설치 상태도 정상으로 읽힘)
    part = []
    for i, f in enumerate(FILES):
        sqlfile(p(f))
        rows = postcheck()
        part.append(all(r[2] in ('ok', 'info') for r in rows) and sum(r[2] == 'ok' for r in rows) >= i + 1)
    check('A03 P8-01 → 02 → 03 → 04 하나씩: 단계마다 P8-05 FAIL 없음(부분 설치 상태)', all(part), part)
    post = postcheck()
    check('A04 전부 설치 뒤 P8-05: 01~09 ok · 10 활성화 없음', [r[2] for r in post] == ['ok'] * 9 + ['info'] and post[-1][3] == '(활성화 없음)', post)
    after = fingerprint()
    import difflib
    body1 = body(); unmarked = []
    for f in CHANGED[:2] + CHANGED[7:]:      # P8-01 · P8-04 는 원본에 몇 줄을 끼운 것 — 차이마다 표시. P8-03 의 5개는 본문 교체(머리 주석 [P8-03])
        a, b = body0[f][0].splitlines(), body1[f][0].splitlines()
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if op != 'equal' and not any('P8-0' in x for x in b[max(0, j1 - 3):j2 + 1] + a[max(0, i1 - 3):i2 + 1]):
                unmarked.append((f.split('(')[0], op, a[i1:i2][:2], b[j1:j2][:2]))
    check('A04a 바꾼 함수 11개: 이름 · 인자 · 반환 · 권한 · SECURITY DEFINER · search_path 그대로, P8-01 · P8-04 가 끼운 줄은 모두 [P8-0x] 표시 곁에만',
          all(body0[f][1:] == body1[f][1:] and body0[f][0] != body1[f][0] for f in CHANGED) and not unmarked, unmarked[:6])
    check('A05 P8-00 지문(S1~S6 구조 · D1 자료 — P8 이 바꾸는 것 제외) 설치 전후 같음', before == after, [(b, a) for b, a in zip(before, after) if b != a])
    check('A06 네 파일 다시 실행 → 모두 멈춤(이미 적용)', all('이미 적용되었습니다' in sqlerr(src(p(f))) for f in FILES))
    check('A07 P8-00 은 설치 뒤에도 FAIL 없음(바꿀 함수 검사는 남은 파일 몫만)', all(r[2] in ('ok', 'info') for r in sqlfile(p('P8-00_사전점검_지문.sql'))))

    # ======================================================================= B. 접근 경계 · 설치만(정책 모듈 켜지 않음) — 옛 앱 경로 보존
    c = api(None, 'anon')
    check('B01 anon 은 관계 공개 함수 실행 불가', all('permission denied' in err(c, s) for s in (
        "select public.workhub_teaching_relations('m-21','c')", "select public.workhub_teaching_relation_preview('m-21','{}'::jsonb)",
        "select public.workhub_teaching_relation_commit('m-21','{}'::jsonb,'kkkkkkkk')")))
    check('B02 service_role 은 관계 함수 실행 불가(사람 전용)', 'permission denied' in err(api(None, 'service_role'), "select public.workhub_teaching_relations('m-21','c')"))
    c = api(T[21])
    check('B03 authenticated 는 새 표 직접 읽기 · 내부 함수 실행 불가', all('permission denied' in err(c, f'select * from workhub.{x}')
          for x in ('teaching_relation_ends', 'teaching_relation_previews', 'teaching_relation_commits'))
          and 'permission denied' in err(c, "select workhub_private.p8_installed('P8-01')"))
    # 선행 모듈 켜기(P1 학교 관리 · P2 협업 · P3 메신저 · P5 수업 · P7 업무 전환 · 공식 담당 인계)
    sqlfile(text=fill_json(os.path.join(W, 'p1', 'P1-04_학교활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인'}))
    sqlfile(text=fill_json(os.path.join(W, 'p2', 'P2-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'modules': ['cooperation']}))
    sqlfile(text=fill_json(os.path.join(W, 'p3', 'P3-04_메시지활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'body_characters': 2000,
                                                                              'title_characters': 100, 'recipients': 60}))
    sqlfile(text=fill_json(os.path.join(W, 'p5', 'P5-04_수업모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'counseling_scope': 'course_teachers'}))
    sqlfile(text=fill_json(os.path.join(W, 'p7', 'P7-04_모듈활성화_양식.sql'), {'approver_user_id': U1, 'approval_ref': '시험 승인', 'modules': ['transitions', 'duty_handover']}))
    L = t[21].tl(); d = data(L) or {}
    check('B04 켜기 전 업무 전환 목록 = 옛 모양(dutyApproval 칸 없음) · 공식 담당은 인계할 자원에 없음',
          ok7(L) and 'dutyApproval' not in d and set(d) == {'canManageYear', 'years', 'recipients', 'resources', 'records', 'nextCursor'}
          and d['resources'] == [], L)
    plan = ho(M[22], mver(M[22]), [res('duty', 'duty-21', 1)])
    check('B05 켜기 전 공식 담당 인계: 미리보기 · 적용 NOT_READY(관리자 확인 없는 옛 흐름으로 만들지 않음)',
          ecode(t[21].tp(plan)) == 'NOT_READY' and ecode(t[21].tm(apply(plan, 'a' * 64))) == 'NOT_READY' and n('transition_items', "kind='duty'") == 0)
    k0 = key(); r0 = t[21].co(coop_create(M[23], '켜기 전 협업'), k0)
    CO0 = r0.get('entityId') if isinstance(r0, dict) else None
    t[23].co(coop_move(CO0, 1, 'accept'))
    check('B06 켜기 전 협업 생성 · 수락 → 협업 출처 알림 0(옛 앱 알림함이 모르는 출처를 만들지 않음)', CO0 and cver(CO0) == 2
          and n('notifications', "source_module='cooperation'") == 0, r0)
    cat = t[21].catalog()
    rs = t[21].rel('nope'); rp = t[21].rpv(intent('membership_end', 'c', 1, 'r', 1, DAY(), 's', 'e'))
    kk = key(); rc = t[21].rcm({'previewId': 'p', 'previewFingerprint': 'a' * 64, 'intent': intent('membership_end', 'c', 1, 'r', 1, DAY(), 's', 'e'),
                                'expectedChanges': [{'kind': 'course_membership', 'id': 'r', 'version': 1}]}, kk)
    check('B07 켜기 전 관계 함수 3개 → UNAVAILABLE 봉투(확정은 요청 번호 · 명령 지문 포함) · 수업 조회는 그대로', ecode(rs) == 'UNAVAILABLE' and ecode(rp) == 'UNAVAILABLE'
          and ecode(rc) == 'UNAVAILABLE' and rc.get('requestKey') == kk and len(rc.get('commandHash', '')) == 64
          and set(rs) == {'contractVersion', 'schoolId', 'memberId', 'ownerUserId', 'ok', 'code'} and isinstance(cat, dict) and cat.get('ok') is True, (rs, rc, cat))
    check('B08 켜기 전 관계 확정 거절은 아무것도 쓰지 않음', n('teaching_relation_ends') == 0 and n('teaching_relation_commits') == 0 and n('teaching_relation_previews') == 0)

    # ======================================================================= C. 켜기 양식(P8-06)
    blank = src(p('P8-06_정책모듈활성화_양식.sql'))
    st0 = scalar("select count(*) from workhub.module_activations") , scalar("select count(*) from workhub.audit_events")
    check('C01 빈 칸이 남은 P8-06 → 멈춤', '입력 칸(<...>)을 모두 채워 주세요' in sqlerr(blank))
    check('C02 앱 배포 확인 근거가 빈칸 → 멈춤(옛 앱에 켜지 않음)', '앱 배포 확인 근거' in sqlerr(p806(['duty_admin_review'], deploy=' ')))
    check('C03 모르는 모듈 · 중복 · 0개 · 4개 → 멈춤', all('modules 는' in sqlerr(p806(m)) for m in (
        ['assistant'], ['duty_admin_review', 'duty_admin_review'], [], ['cooperation_notices', 'duty_admin_review', 'teaching_relations', 'x'])))
    check('C04 승인자가 학교 관리자가 아님 → 멈춤', '학교 관리자(school_admin)인 활성 학교가 없습니다' in sqlerr(p806(['duty_admin_review'], approver=T[21])))
    check('C05 승인 근거 빈칸 → 멈춤', '승인 근거는 1~200자' in sqlerr(p806(['duty_admin_review'], ref=' ')))
    check('C06 멈춘 P8-06 은 아무것도 쓰지 않음', (scalar("select count(*) from workhub.module_activations"), scalar("select count(*) from workhub.audit_events")) == st0)

    # ======================================================================= D. Q4 — 새 학년도 시작 연도 = 학년도 숫자(월·일 강제 없음 · 소급 거절 없음)
    sa = data(adm.sa_get()) or {}
    def y_cfg(sy, start, last, t1, t2):
        return {'draftId': 'draft-' + key(), 'schoolName': sa['configuration']['schoolName'], 'schoolCode': sa['configuration']['schoolCode'],
                'schoolType': sa['configuration']['schoolType'], 'gradeCount': sa['configuration']['gradeCount'], 'schoolYear': str(sy), 'startsOn': start, 'lastDay': last,
                'terms': [{'id': 'draft-' + key(), 'termNo': '1', 'name': '1학기', 'startsOn': t1[0], 'lastDay': t1[1]},
                          {'id': 'draft-' + key(), 'termNo': '2', 'name': '2학기', 'startsOn': t2[0], 'lastDay': t2[1]}],
                'departments': [], 'classes': []}
    def cy(cfg): return {'kind': 'save_configuration', 'expectedVersion': (data(adm.sa_get()) or {}).get('version'), 'mode': 'create_year',
                         'configuration': cfg, 'subjects': [], 'reason': '새 학년도 준비'}
    bad27 = y_cfg(2027, '2028-01-04', '2028-12-31', ('2028-01-04', '2028-06-30'), ('2028-07-01', '2028-12-31'))
    yrs0 = n('academic_years')
    check('D01 P1 새 학년도: 2027 학년도인데 시작일이 2028년 → INVALID_INPUT · 만들지 않음', ecode(adm.sa_mut(cy(bad27))) == 'INVALID_INPUT' and n('academic_years') == yrs0)
    good27 = y_cfg(2027, '2027-04-01', '2028-03-31', ('2027-04-01', '2027-09-15'), ('2027-09-16', '2028-03-31'))
    k27 = key(); r27 = adm.sa_mut(cy(good27), k27)
    check('D02 P1 새 학년도: 2027 학년도 · 4월 1일 시작 · 다음 해 3월 31일 끝 → 생성(3월 1일 강제 없음 · 끝은 다음 해)', ok7(r27) and data(r27)['schoolYear'] == 2027
          and scalar("select starts_on::text from workhub.academic_years where school_id=%s and school_year=2027", (s1,)) == '2027-04-01', r27)
    # 소급 거절 없음: 이 정책 전에 만들어진(시작 연도 ≠ 학년도) 학년도 — 조회 · 수정은 그대로
    call(run, "insert into workhub.academic_years(id, school_id, school_year, starts_on, ends_on, state) values ('y-legacy', %s, 2032, '2031-12-01', '2032-12-01', 'planning')", (s1,))
    call(run, """insert into workhub.terms(id, school_id, academic_year_id, term_no, label, starts_on, ends_on) values
                 ('t-legacy-1', %s, 'y-legacy', 1, '1학기', '2031-12-01', '2032-06-01'), ('t-legacy-2', %s, 'y-legacy', 2, '2학기', '2032-06-01', '2032-12-01')""", (s1, s1))
    g32 = data(adm.sa_get(2032)) or {}
    up = adm.sa_mut({'kind': 'save_configuration', 'expectedVersion': g32.get('version'), 'mode': 'update', 'configuration': {**g32.get('configuration', {}),
                     'departments': [{'id': 'draft-' + key(), 'name': '교무부'}]}, 'subjects': g32.get('subjects', []), 'reason': '기존 학년도 수정'})
    check('D03 기존 학년도(시작 2031-12 · 2032 학년도) 조회 · 수정은 그대로 됨 — 소급 거절 없음', g32.get('configuration', {}).get('startsOn') == '2031-12-01' and ok7(up), up)
    LA = data(adm.tl()) or {}
    src_year = year
    bad28 = ny(src_year, 2028, '2027-05-01', '2029-04-30', '2027-05-01', '2027-10-31', '2027-11-01', '2029-04-30')
    check('D04 P7 새 학년도 미리보기: 2028 학년도인데 시작일 2027년 → INVALID_INPUT', ecode(adm.tp(bad28)) == 'INVALID_INPUT')
    good28 = ny(src_year, 2028, '2028-05-01', '2029-04-30', '2028-05-01', '2028-10-31', '2028-11-01', '2029-04-30')
    pv28 = adm.tp(good28); k28 = key()
    r28 = adm.tm(apply(good28, (data(pv28) or {}).get('fingerprint', 'x')), k28)
    check('D05 P7 새 학년도: 2028 학년도 · 5월 1일 시작 · 다음 해 4월 끝 → completed', ok7(r28) and data(r28)['state'] == 'completed'
          and scalar("select starts_on::text from workhub.academic_years where school_id=%s and school_year=2028", (s1,)) == '2028-05-01', (pv28, r28))
    check('D06 같은 요청 번호 재전송 → 원래 접수증(원장 먼저)', adm.tm(apply(good28, data(pv28)['fingerprint']), k28) == r28)
    check('D07 업무 전환 목록의 학년도에 기존 학년도(2032) 그대로', 2032 in [y['year'] for y in (data(adm.tl()) or {}).get('years', [])] and LA.get('canManageYear') is True)

    # ======================================================================= E. C6 — 협업 사이트 알림
    check('E00 P8-06: 협업 알림 켜기(배포 확인 근거 포함)', sqlerr(p806(['cooperation_notices'])) == 'OK'
          and scalar("select details->>'app_deploy_ref' from workhub.audit_events where operation='module.activate' and resource_id like %s", ('%:cooperation_notices',)) == DEPLOY)
    def notes(owner): return scalar("""select coalesce(jsonb_agg(jsonb_build_object('title', title, 'body', body, 'src', source_module, 'id', source_id, 'k', dedupe_key)
                                       order by created_at, id), '[]') from workhub.notifications where owner_membership_id=%s and source_module='cooperation'""", (owner,))
    n0 = n('notifications')
    kc = key(); rc1 = t[21].co(coop_create(M[23], '3학년 평가 자료 협조'), kc); CO = rc1.get('entityId')
    t[23].co(coop_move(CO, 1, 'accept')); t[23].co(coop_move(CO, 2, 'request_completion')); t[21].co(coop_move(CO, 3, 'return_completion'))
    t[23].co(coop_move(CO, 4, 'request_completion')); t[23].co(coop_move(CO, 5, 'retract_completion')); t[23].co(coop_move(CO, 6, 'request_completion'))
    t[21].co(coop_move(CO, 7, 'confirm_completion'))
    CD = t[21].co(coop_create(M[23], '거절될 요청')).get('entityId'); t[23].co(coop_move(CD, 1, 'decline'))
    CX = t[21].co(coop_create(M[23], '취소될 요청')).get('entityId'); t[21].co(coop_move(CX, 1, 'cancel'))
    to23 = notes(M[23]); to21 = notes(M[21])
    want23 = [('협업 요청이 왔습니다', CO, 1), ('협업 완료 확인이 반려되었습니다', CO, 4), ('협업 완료가 확인되었습니다', CO, 8),
              ('협업 요청이 왔습니다', CD, 1), ('협업 요청이 왔습니다', CX, 1), ('협업 요청이 취소되었습니다', CX, 2)]
    want21 = [('협업 요청이 수락되었습니다', CO, 2), ('협업 완료 확인 요청이 왔습니다', CO, 3), ('협업 완료 확인 요청이 왔습니다', CO, 5),
              ('협업 완료 확인 요청이 철회되었습니다', CO, 6), ('협업 완료 확인 요청이 왔습니다', CO, 7), ('협업 요청이 거절되었습니다', CD, 2)]
    got23 = [(x['title'], x['id'], int(x['k'].split(':')[-1])) for x in to23]; got21 = [(x['title'], x['id'], int(x['k'].split(':')[-1])) for x in to21]
    check('E01 행동 × 받는 사람 표: 보낸 사람이 한 것(생성 · 반려 · 완료 확인 · 취소)은 받는 사람에게, 받는 사람이 한 것(수락 · 거절 · 완료 요청 · 철회)은 보낸 사람에게 — 이력 판마다 1건',
          got23 == want23 and got21 == want21, (got23, got21))
    allc = to23 + to21
    check('E02 출처 = 정확히 {module:cooperation, id:요청 ID} · 중복 방지 키 p8:coop:요청:판 · 본문 = 협업 제목만(설명 · 의견 복사 없음)',
          all(x['src'] == 'cooperation' and x['k'] == f"p8:coop:{x['id']}:{x['k'].split(':')[-1]}" for x in allc)
          and all(x['body'] in ('3학년 평가 자료 협조', '거절될 요청', '취소될 요청') for x in allc)
          and scalar("select count(*) from workhub.notifications where source_module='cooperation' and (body like '%%학생 이름%%' or body like '%%의견 본문%%' or title like '%%의견%%')") == 0, allc)
    check('E03 알림 수 = 이력 행 수(켠 뒤) · 행동한 사람 본인에게는 알림 없음', n('notifications') - n0 == 12 and n('notifications', "source_module='cooperation' and owner_membership_id not in ('m-21','m-23')") == 0)
    before_n = n('notifications'); r_again = t[21].co(coop_create(M[23], '3학년 평가 자료 협조'), kc)
    check('E04 같은 요청 번호 재전송 → 원래 접수증 · 알림 늘지 않음(중복 없음)', isinstance(r_again, dict) and r_again.get('entityId') == CO and r_again.get('outcome') == 'replayed'
          and n('notifications') == before_n, r_again)
    check('E05 같은 (받는 사람, 중복 방지 키) 알림은 표가 한 번만 받음', scalar("select workhub_private.p3_notify(%s, 'm-23', 'x', 'y', 'cooperation', %s, %s)", (s1, CO, f'p8:coop:{CO}:1')) is None)
    # 읽음 ≠ 수락
    CR = t[21].co(coop_create(M[23], '읽기만 할 요청')).get('entityId')
    ib = data(t[23].inbox()) or {}
    item = next((x for x in ib.get('items', []) if (x.get('source') or {}).get('id') == CR), None)
    rd = t[23].msg({'kind': 'read_notice', 'noticeId': item['id'] if item else 'x', 'expectedVersion': 1})
    check('E06 알림함 항목의 출처 {module:cooperation,id} · 알림을 읽어도 협업은 requested 그대로(읽음 ≠ 수락)', item is not None and item['source'] == {'module': 'cooperation', 'id': CR}
          and ok7(rd) and scalar("select status from workhub.cooperation_requests where id=%s", (CR,)) == 'requested' and cver(CR) == 1, (item, rd))
    # 원본 변경과 같은 트랜잭션: 알림 쓰기가 실패하면 협업 변경도 없음
    sqlfile(text="""create function workhub_private.p8_test_fail() returns trigger language plpgsql as $$ begin raise exception 'P8_TEST_FAILURE'; end $$;
                    create trigger p8_test_fail before insert on workhub.notifications for each row execute function workhub_private.p8_test_fail();""")
    h0 = n('cooperation_history'); r_fail = t[23].co(coop_move(CR, 1, 'accept'))
    sqlfile(text="drop trigger p8_test_fail on workhub.notifications; drop function workhub_private.p8_test_fail();")
    check('E07 알림 쓰기 강제 실패 → 협업 수락도 되돌림(판 · 이력 그대로) · 봉투 없는 오류', r_fail == 'P8_TEST_FAILURE' and cver(CR) == 1 and n('cooperation_history') == h0, r_fail)
    stop('cooperation_notices'); b = n('notifications'); t[23].co(coop_move(CR, 1, 'accept'))
    check('E08 협업 알림 중지(P2-80) → 협업은 그대로 되고 알림 0', cver(CR) == 2 and n('notifications') == b)
    resume('cooperation_notices')
    stop('messaging'); b = n('notifications'); t[23].co(coop_move(CR, 2, 'request_completion'))
    check('E09 메신저 중지(준비 아님) → 협업은 그대로 되고 알림 0', cver(CR) == 3 and n('notifications') == b)
    resume('messaging')
    check('E10 다른 학교에는 협업 알림 없음', scalar("select count(*) from workhub.notifications where school_id='school-2'") == 0)
    if BRIDGE:
        # 협업 인계(P7-05 보강) — 새 받는 사람이 한 인계 → 보낸 사람에게. 권한을 잃은 이전 받는 사람은 알림이 있어도 원본을 열 수 없다.
        sqlfile(text=src(os.path.join(W, 'p7', 'P7-05_R1_P2_보강_별도승인.sql')).replace('"<승인한 사람(예: 계란)>"', '"시험"').replace('"<승인 근거(날짜 · 대화 · 문서)>"', '"시험(합성 값)"'))
        base_s = fingerprint()   # P7-05 는 R1 · P2 함수를 바꾼다 → 구조 지문 기준을 여기서 다시 잡는다
        CH = t[21].co(coop_create(M[23], '인계될 요청')).get('entityId'); t[23].co(coop_move(CH, 1, 'accept'))
        hp = ho(M[24], mver(M[24]), [res('cooperation', CH, cver(CH))])
        pvh = data(t[23].tp(hp)) or {}
        rh = data(t[23].tm(apply(hp, pvh.get('fingerprint', 'x')))) or {}
        acc = t[24].tm(act('accept', rh.get('recordId', 'x'), 1))
        last21 = notes(M[21])[-1] if notes(M[21]) else {}
        check('E11 협업 인계 수락(새 받는 사람 24) → 보낸 사람(21)에게 "받는 사람이 바뀌었습니다" 1건 · 새 받는 사람 본인에게는 없음',
              ok7(acc) and last21.get('title') == '협업 받는 사람이 바뀌었습니다' and last21.get('id') == CH and notes(M[24]) == [], (acc, last21))
        old = t[23].cg(CH)
        has_note = scalar("select count(*) from workhub.notifications where owner_membership_id='m-23' and source_module='cooperation' and source_id=%s", (CH,))
        check('E12 권한을 잃은 이전 받는 사람(23): 알림은 남아 있어도 원본 조회 NOT_FOUND(알림이 열람 권한이 아님)', has_note >= 1 and ecode(old) == 'NOT_FOUND', old)
    else:
        check('E11 P8_BRIDGE=0 — 협업 인계 알림은 P7-05 보강이 있어야 생김(건너뜀)', True)
        base_s = fingerprint()
    t[23].inbox(); t[21].inbox()

    # ======================================================================= F. Q2 — 공식 담당 인계: 관리자 확인 → 받는 사람 수락
    check('F00 P8-06: 업무 인계 관리자 확인 켜기', sqlerr(p806(['duty_admin_review'])) == 'OK')
    L = t[21].tl(); d = data(L) or {}
    check('F01 켠 뒤 목록 = 새 모양(dutyApproval admin_review_v1) · 기록마다 4칸 · 공식 담당 자원 4건(관리자 확인 전에는 없던 것)',
          d.get('dutyApproval') == 'admin_review_v1' and all({'requesterMemberId', 'requiresAdminReview', 'canAdminReview', 'adminReview'} <= set(r) for r in d.get('records', []))
          and [x['id'] for x in d.get('resources', []) if x['kind'] == 'duty'] == ['duty-21', 'duty-21b', 'duty-21c', 'duty-21d'], L)
    plan = ho(M[22], mver(M[22]), [res('duty', 'duty-21', 1, '방과후')])
    P = data(t[21].tp(plan)) or {}
    check('F02 공식 담당 미리보기: 빠지는 것에 "학교 관리자가 먼저 확인" 안내', any('학교 관리자가 먼저 확인' in x for x in P.get('excluded', [])), P)
    nb = n('notifications'); kap = key(); ra = t[21].tm(apply(plan, P.get('fingerprint', 'x')), kap); HO = (data(ra) or {}).get('recordId')
    check('F03 적용 → awaiting_admin 판 1 · 이력 apply · 받는 사람에게 알리지 않음 · 담당은 그대로', ok7(ra) and data(ra)['state'] == 'awaiting_admin' and data(ra)['version'] == 1
          and n('notifications') == nb and scalar("select membership_id from workhub.staff_assignments where id='duty-21'") == 'm-21', ra)
    rec = lambda who, rid: next((x for x in (data(who.tl()) or {}).get('records', []) if x['id'] == rid), None)
    r21, r22, ra1, r24 = rec(t[21], HO), rec(t[22], HO), rec(adm, HO), rec(t[24], HO)
    check('F04 목록: 요청자 canCancel · 받는 사람 canAccept false · 관리자 canAdminReview true · 관리자(24, 당사자 아님)도 true · 요청자 ID · 확인 기록 없음',
          r21 and r21['canCancel'] and not r21['canAdminReview'] and r21['requiresAdminReview'] is True and r21['requesterMemberId'] == M[21] and r21['adminReview'] is None
          and r22 and r22['canAccept'] is False and r22['state'] == 'awaiting_admin' and ra1 and ra1['canAdminReview'] is True and r24 and r24['canAdminReview'] is True,
          (r21, r22, ra1, r24))
    check('F05 받는 사람이 확인 전에 수락 · 거절 → CONFLICT', ecode(t[22].tm(act('accept', HO, 1))) == 'CONFLICT' and ecode(t[22].tm(act('reject', HO, 1))) == 'CONFLICT')
    check('F06 관리자 아닌 교사: 당사자(21 · 22)면 FORBIDDEN · 제3자(25) NOT_FOUND', ecode(t[21].tm(act('admin_confirm', HO, 1))) == 'FORBIDDEN'
          and ecode(t[22].tm(act('admin_confirm', HO, 1))) == 'FORBIDDEN' and ecode(t[25].tm(act('admin_confirm', HO, 1))) == 'NOT_FOUND')
    check('F07 판 다름 → CONFLICT · 모양 틀림(사유 빈칸 · 모르는 칸) → INVALID_INPUT', ecode(adm.tm(act('admin_confirm', HO, 2))) == 'CONFLICT'
          and ecode(adm.tm(act('admin_confirm', HO, 1, ' '))) == 'INVALID_INPUT' and ecode(adm.tm({**act('admin_confirm', HO, 1), 'x': 1})) == 'INVALID_INPUT')
    # 자기 확인 금지: 관리자 본인이 요청한 인계 · 관리자가 받는 인계
    pa = ho(M[25], mver(M[25]), [res('duty', 'duty-a1', 1)]); Ha = data(adm.tm(apply(pa, data(adm.tp(pa))['fingerprint'])))['recordId']
    pb = ho(M[24], mver(M[24]), [res('duty', 'duty-21b', 1)]); Hb = data(t[21].tm(apply(pb, data(t[21].tp(pb))['fingerprint'])))['recordId']
    check('F08 자기 확인 금지: 요청자가 관리자(m1) → 본인 확인 FORBIDDEN · canAdminReview false / 받는 사람이 관리자(24) → FORBIDDEN · 다른 관리자는 가능',
          ecode(adm.tm(act('admin_confirm', Ha, 1))) == 'FORBIDDEN' and rec(adm, Ha)['canAdminReview'] is False and rec(t[24], Ha)['canAdminReview'] is True
          and ecode(t[24].tm(act('admin_confirm', Hb, 1))) == 'FORBIDDEN' and rec(t[24], Hb)['canAdminReview'] is False and rec(adm, Hb)['canAdminReview'] is True)
    # 확인 때 다시 검사: 받는 사람 소속 정지 → CONFLICT
    call(run, "update workhub.memberships set status='suspended' where id='m-22'")
    check('F09 확인 때 다시 검사: 받는 사람 소속이 정지되면 확인 → CONFLICT', ecode(adm.tm(act('admin_confirm', HO, 1))) == 'CONFLICT' and rec(t[21], HO)['state'] == 'awaiting_admin')
    call(run, "update workhub.memberships set status='active' where id='m-22'")
    nb = n('notifications'); kcf = key(); rcf = adm.tm(act('admin_confirm', HO, 1, '담당 교체 확인'), kcf)
    r22 = rec(t[22], HO)
    check('F10 관리자 확인 → pending 판 2 · 이력 admin_confirm · 받는 사람 · 요청자에게 알림 각 1 · 받는 사람 canAccept · 확인 기록(이름 · 결정 · 사유 · 시각)',
          ok7(rcf) and data(rcf)['state'] == 'pending' and data(rcf)['version'] == 2 and n('notifications') == nb + 2
          and n('transition_history', "record_id=%s and action='admin_confirm' and version=2", (HO,)) == 1
          and r22 and r22['canAccept'] is True and r22['adminReview'] and r22['adminReview']['decision'] == 'confirmed' and r22['adminReview']['memberId'] == m1
          and r22['adminReview']['reason'] == '담당 교체 확인' and r22['adminReview']['recordedAt'].endswith('Z'), (rcf, r22))
    check('F11 같은 요청 번호 재전송 → 원래 접수증 · 다시 확인 → CONFLICT', adm.tm(act('admin_confirm', HO, 1, '담당 교체 확인'), kcf) == rcf
          and ecode(adm.tm(act('admin_confirm', HO, 2))) == 'CONFLICT')
    check('F12 확인 뒤 관리자 · 요청자는 수락할 수 없음(FORBIDDEN) · 확인 뒤 요청자 취소는 가능 상태(canCancel)', ecode(adm.tm(act('accept', HO, 2))) == 'NOT_FOUND'
          and ecode(t[21].tm(act('accept', HO, 2))) == 'FORBIDDEN' and rec(t[21], HO)['canCancel'] is True)
    # 수락 중간 강제 실패(이력 기록 단계, 담당 이전 뒤) — 봉투 없는 오류(앱: 결과 모름) · 담당 · 판 · 원장 모두 되돌림
    dut0 = scalar("select count(*) from workhub.staff_assignments where membership_id='m-22' and kind='duty'")
    sqlfile(text="""create function workhub_private.p8_test_fail() returns trigger language plpgsql as $$ begin raise exception 'P8_TEST_FAILURE'; end $$;
                     create trigger p8_test_fail before insert on workhub.transition_history for each row execute function workhub_private.p8_test_fail();""")
    r_ff = t[22].tm(act('accept', HO, 2, '인수합니다'))
    sqlfile(text="drop trigger p8_test_fail on workhub.transition_history; drop function workhub_private.p8_test_fail();")
    check('F12a 수락 중간 강제 실패 → 봉투 없는 오류 · pending 판 2 그대로 · 담당 이전 없음', r_ff == 'P8_TEST_FAILURE' and rec(t[22], HO)['version'] == 2
          and rec(t[22], HO)['state'] == 'pending' and scalar("select count(*) from workhub.staff_assignments where membership_id='m-22' and kind='duty'") == dut0, r_ff)
    kac = key(); rac = t[22].tm(act('accept', HO, 2, '인수합니다'), kac)
    check('F13 받는 사람 수락 → accepted 판 3 · 같은 트랜잭션에서 담당 이전(21 은 어제까지 · 22 는 오늘부터)', ok7(rac) and data(rac)['state'] == 'accepted' and data(rac)['version'] == 3
          and scalar("select count(*) from workhub.staff_assignments where membership_id='m-22' and kind='duty' and valid_from=%s", (DAY(),)) == 1, rac)
    r_all = rec(t[22], HO)
    check('F14 수락 뒤 기록: accepted 3 · 확인 기록 그대로 · canAccept false', r_all and r_all['state'] == 'accepted' and r_all['version'] == 3
          and r_all['adminReview']['decision'] == 'confirmed' and not r_all['canAccept'], r_all)
    # 관리자 반려 → 아무것도 넘어가지 않음 · 자원 다시 인계 가능
    rr = adm.tm(act('admin_reject', Hb, 1, '시기를 다시 정해 주세요'))
    check('F15 관리자 반려 → rejected 판 2 · 요청자에게 알림 · 자원은 다시 인계할 수 있음', ok7(rr) and data(rr)['state'] == 'rejected' and data(rr)['version'] == 2
          and rec(t[21], Hb)['adminReview']['decision'] == 'rejected' and 'duty-21b' in [x['id'] for x in data(t[21].tl())['resources']], rr)
    # 확인 전 철회 → 받는 사람에게 알리지 않음
    pc = ho(M[24], mver(M[24]), [res('duty', 'duty-21c', 1)]); Hc = data(t[21].tm(apply(pc, data(t[21].tp(pc))['fingerprint'])))['recordId']
    nb = n('notifications'); rc_ = t[21].tm(act('cancel', Hc, 1, '잘못 보냄'))
    check('F16 확인 전 요청자 철회 → cancelled 판 2 · 받는 사람에게 알림 없음', ok7(rc_) and data(rc_)['state'] == 'cancelled' and data(rc_)['version'] == 2
          and n('notifications') == nb and rec(t[21], Hc)['adminReview'] is None, rc_)
    # 확인 뒤 받는 사람 거절 → rejected 3
    pd_ = ho(M[24], mver(M[24]), [res('duty', 'duty-21c', 1)]); Hd = data(t[21].tm(apply(pd_, data(t[21].tp(pd_))['fingerprint'])))['recordId']
    adm.tm(act('admin_confirm', Hd, 1)); rj = t[24].tm(act('reject', Hd, 2, '어렵습니다'))
    check('F17 확인 뒤 받는 사람 거절 → rejected 판 3 · 확인 기록 confirmed 그대로', ok7(rj) and data(rj)['version'] == 3 and rec(t[24], Hd)['adminReview']['decision'] == 'confirmed', rj)
    # 확인 뒤 원본이 바뀌면 수락 때 다시 검사 → CONFLICT
    pe = ho(M[26], mver(M[26]), [res('duty', 'duty-21c', 1)]); He = data(t[21].tm(apply(pe, data(t[21].tp(pe))['fingerprint'])))['recordId']
    adm.tm(act('admin_confirm', He, 1))
    call(run, "update workhub.staff_assignments set valid_to=valid_to - 1, version=version+1 where id='duty-21c'")
    check('F18 확인 뒤 담당이 바뀌면(학교 관리에서 기간 수정) 수락 → CONFLICT · 판 그대로', ecode(t[26].tm(act('accept', He, 2))) == 'CONFLICT' and rec(t[26], He)['version'] == 2)
    # 동시성: 두 관리자 동시 확인 · 수락과 취소 동시
    pf = ho(M[25], mver(M[25]), [res('duty', 'duty-21d', 1)]); Hf = data(t[21].tm(apply(pf, data(t[21].tp(pf))['fingerprint'])))['recordId']
    outs = concurrently([lambda: adm.tm(act('admin_confirm', Hf, 1)), lambda: t[24].tm(act('admin_confirm', Hf, 1))])
    check('F19 두 관리자가 동시에 확인 → 하나만 pending 2, 하나는 CONFLICT · 확인 이력 1', sorted(str(data(o)['state']) if ok7(o) else ecode(o) for o in outs) == ['CONFLICT', 'pending']
          and n('transition_history', "record_id=%s and action='admin_confirm'", (Hf,)) == 1, outs)
    outs = concurrently([lambda: t[25].tm(act('accept', Hf, 2)), lambda: t[21].tm(act('cancel', Hf, 2))])
    check('F20 수락과 취소가 동시에 → 하나만 반영(판 3), 하나는 CONFLICT', sorted(str(data(o)['state']) if ok7(o) else ecode(o) for o in outs) in (['CONFLICT', 'accepted'], ['CONFLICT', 'cancelled'])
          and rec(t[21], Hf)['version'] == 3, outs)
    # 자기 확인을 표가 한 번 더 막지는 않지만(함수가 막음), 정해진 길 밖의 직접 변경은 표가 막음
    check('F21 확인 대기 기록을 직접 accepted 로 바꾸면 거부(IMMUTABLE_ROW)', 'IMMUTABLE_ROW' in sqlerr(f"update workhub.transition_records set state='accepted', version=2 where id='{Ha}'"))
    # 중지: 목록은 새 모양 유지(dutyApproval null) · 확인 · 공식 담당 수락 NOT_READY · 원장 재전송은 그대로
    pg = ho(M[26], mver(M[26]), [res('duty', 'duty-25', 1)]); Hg = data(t[25].tm(apply(pg, data(t[25].tp(pg))['fingerprint'])))['recordId']
    adm.tm(act('admin_confirm', Hg, 1))
    stop('duty_admin_review')
    Ls = data(t[21].tl()) or {}
    check('F22 관리자 확인 중지(P2-80) → 목록 새 모양 유지(dutyApproval null) · 공식 담당 자원 없음 · 확인 · 공식 담당 수락 NOT_READY · 재전송은 원래 접수증',
          'dutyApproval' in Ls and Ls['dutyApproval'] is None and not [x for x in Ls.get('resources', []) if x['kind'] == 'duty']
          and ecode(t[24].tm(act('admin_confirm', Ha, 1))) == 'NOT_READY' and ecode(t[26].tm(act('accept', Hg, 2))) == 'NOT_READY'
          and adm.tm(act('admin_confirm', HO, 1, '담당 교체 확인'), kcf) == rcf, Ls)
    check('F23 중지 중에도 취소 · 거절은 됨(정리 경로)', ok7(t[26].tm(act('reject', Hg, 2, '중지 중 정리'))))
    resume('duty_admin_review')
    check('F24 재개 뒤 dutyApproval admin_review_v1 · 자기 확인이 아닌 관리자는 확인 가능', (data(t[21].tl()) or {}).get('dutyApproval') == 'admin_review_v1'
          and ok7(t[24].tm(act('admin_confirm', Ha, 1))))
    # 협업만 든 인계는 지금처럼(pending 1 → 수락 2)
    if BRIDGE:
        CQ = t[21].co(coop_create(M[23], '협업만 인계')).get('entityId')
        pq = ho(M[25], mver(M[25]), [res('cooperation', CQ, 1)])
        rq = t[23].tm(apply(pq, (data(t[23].tp(pq)) or {}).get('fingerprint', 'x')))
        rqa = t[25].tm(act('accept', (data(rq) or {}).get('recordId', 'x'), 1))
        check('F25 협업만 든 인계 = 관리자 확인 없음(pending 1 → accepted 2 · requiresAdminReview false)', ok7(rq) and data(rq)['state'] == 'pending'
              and ok7(rqa) and data(rqa)['version'] == 2 and rec(t[25], data(rq)['recordId'])['requiresAdminReview'] is False, (rq, rqa))
    check('F26 P8-05-05(공식 담당 기록은 모두 관리자 확인 흐름) ok', dict((r[0], r[2]) for r in postcheck())['P8-05-05'] == 'ok')
    check('F27 관리자 목록에는 남의 공식 담당 인계도 보이고, 남의 협업 인계는 보이지 않음', HO in [x['id'] for x in data(adm.tl())['records']]
          and (not BRIDGE or data(rq)['recordId'] not in [x['id'] for x in data(adm.tl())['records']]))

    # ======================================================================= G. 수업 담당 교체 · 종료 · 수강 종료 · 전출
    C1 = adm.tmut(course_cmd('2학년 도덕 A', term2, 'subj-ethics', [M[21], M[22]], t2s, t2last)).get('entityId')
    C2 = adm.tmut(course_cmd('2학년 정보 B', term2, 'subj-info', [M[23]], t2s, t2last)).get('entityId')
    C3 = adm.tmut(course_cmd('방과후 토론', term2, 'subj-ethics', [M[25]], t2s, t2last)).get('entityId')
    rows = [srow('S-0001', '김민준', 2, '1', 1), srow('S-0002', '이서연', 2, '1', 2), srow('S-0003', '박지후', 2, '2', 3)]
    t[21].tmut(roster(C1, 1, rows, t2s, t2last))
    t[23].tmut(roster(C2, 1, [srow('S-0001', '김민준', 2, '1', 1), srow('S-0004', '최하준', 2, '2', 7)], t2s, t2last))
    t[25].tmut(roster(C3, 1, [srow('S-0004', '최하준', 2, '2', 7)], DAY(10), t2last))
    studs = {s['schoolStudentKey']: s for s in (t[21].course(C1) or {}).get('students', [])}
    SA, SB, SC = studs.get('S-0001'), studs.get('S-0002'), studs.get('S-0003')
    cs = {x['id']: x for x in (t[21].catalog() or {}).get('courses', [])}; A21 = cs.get(C1, {}).get('assignmentId')
    A22 = {x['id']: x for x in t[22].catalog()['courses']}[C1]['assignmentId']
    check('G00 준비: 수업 3 · 학생 4 · 담당 4', C1 and C2 and C3 and SA and SB and SC and A21 and A22 and n('course_assignments') == 4 and n('students') == 4)
    base_ids = scalar("""select jsonb_build_object('a', (select array_agg(id) from workhub.course_assignments), 'm', (select array_agg(id) from workhub.course_memberships),
                                                     'e', (select array_agg(id) from workhub.student_enrollments))""")
    keep_rows = lambda: scalar("""select jsonb_build_object('a', (select md5(string_agg(x::text, ',' order by x.id)) from workhub.course_assignments x where x.id = any(%s)),
                                   'm', (select md5(string_agg(x::text, ',' order by x.id)) from workhub.course_memberships x where x.id = any(%s)),
                                   'e', (select md5(string_agg(x::text, ',' order by x.id)) from workhub.student_enrollments x where x.id = any(%s)))""",
                               (base_ids['a'], base_ids['m'], base_ids['e']))
    kept0 = keep_rows()
    check('G01 켜기 전(teaching_relations 없음) → 관계 조회 UNAVAILABLE · 수업 조회는 그대로(읽기를 막지 않음)', ecode(t[21].rel(C1)) == 'UNAVAILABLE' and t[21].course(C1).get('ok') is True)
    check('G02 P8-06: 수업 관계 변경 켜기', sqlerr(p806(['teaching_relations'])) == 'OK')
    sn = adm.rel(C1)
    check('G03 관리자 관계 조회: 봉투(ok 없음) · 담당 2(판 1 · 유효 끝 = 원래 끝) · 학생 3(수강 · 학적) · 권한 셋 다 · 승인 교사 목록(수업 기간 안으로)',
          okr(sn) and 'ok' not in sn and sn['courseId'] == C1 and sn['courseVersion'] == course_ver(C1) and sn['basisDate'] == DAY()
          and sn['capabilities'] == {'manageAssignments': True, 'endMemberships': True, 'transferStudents': True}
          and sorted((a['memberId'], a['version'], a['effectiveThrough']) for a in sn['assignments']) == [(M[21], 1, t2last), (M[22], 1, t2last)]
          and len(sn['students']) == 3 and all(s['membership']['kind'] == 'course_membership' and s['enrollment']['kind'] == 'enrollment' for s in sn['students'])
          and all(t2s <= x['validFrom'] and x['validThrough'] <= t2last for x in sn['approvedTeachers']) and M[24] in [x['memberId'] for x in sn['approvedTeachers']],
          {k: v for k, v in sn.items() if k not in ('students',)} if isinstance(sn, dict) else sn)
    s21 = t[21].rel(C1)
    check('G04 담당 교사(21): 수강 종료만 · 승인 교사 목록 빈 배열', okr(s21) and s21['capabilities'] == {'manageAssignments': False, 'endMemberships': True, 'transferStudents': False}
          and s21['approvedTeachers'] == [], s21)
    got = [ecode(t[26].rel(C1)), ecode(t[27].rel(C1)), ecode(t[21].rel('a b'))]
    check('G05 담당 아닌 교사(26) → NOT_FOUND · 다른 학교(27) → UNAVAILABLE · 형식 틀린 ID → NOT_FOUND', got == ['NOT_FOUND', 'UNAVAILABLE', 'NOT_FOUND'], got)
    stu = lambda snap, sid: next(s for s in snap['students'] if s['studentId'] == sid)
    mB = stu(sn, SB['id'])['membership']; eA = stu(sn, SA['id'])['enrollment']; mA = stu(sn, SA['id'])['membership']
    cv1 = sn['courseVersion']
    bad_int = [{**intent('membership_end', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId']), 'x': 1},
               intent('student_transfer_out', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId']),      # 전출인데 relationId ≠ enrollmentId
               intent('membership_end', C1, cv1, mB['id'], 1, '2026-02-30', SB['id'], mB['enrollmentId']),
               intent('membership_end', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId'], reason='가' * 2001),
               intent('membership_end', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId'], reason=' '),
               intent('assignment_end', C1, cv1, A21, 1, DAY(), SB['id'], None),
               intent('assignment_replace', C1, cv1, A21, 1, DAY(), None, None, None),
               {**intent('membership_end', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId']), 'kind': 'end_all'}]
    got = [ecode(adm.rpv(x)) for x in bad_int]
    check('G06 모양이 틀린 의도 8종 → INVALID_INPUT', got == ['INVALID_INPUT'] * 8, got)
    got = [ecode(t[21].rpv(intent('assignment_end', C1, cv1, A22, 1, DAY()))), ecode(t[21].rpv(intent('student_transfer_out', C1, cv1, eA['id'], 1, DAY(), SA['id'], eA['id']))),
           ecode(t[23].rpv(intent('membership_end', C1, cv1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId'])))]
    check('G07 권한: 담당 교사의 담당 종료 · 전출 → FORBIDDEN, 이 수업 담당이 아닌 교사(23) → NOT_FOUND', got == ['FORBIDDEN', 'FORBIDDEN', 'NOT_FOUND'], got)
    got = [ecode(adm.rpv(intent('membership_end', C1, cv1 + 1, mB['id'], 1, DAY(), SB['id'], mB['enrollmentId']))),
           ecode(adm.rpv(intent('membership_end', C1, cv1, mB['id'], 2, DAY(), SB['id'], mB['enrollmentId']))),
           ecode(adm.rpv(intent('membership_end', C1, cv1, 'nope', 1, DAY(), SB['id'], mB['enrollmentId']))),
           ecode(adm.rpv(intent('membership_end', C1, cv1, mB['id'], 1, DAY(-1), SB['id'], mB['enrollmentId']))),
           ecode(adm.rpv(intent('membership_end', C1, cv1, mB['id'], 1, t2last, SB['id'], mB['enrollmentId'])))]
    check('G08 수업 판 · 관계 판 다름 → CONFLICT, 없는 관계 → NOT_FOUND, 어제(소급) · 원래 마지막 날 이후 → INVALID_INPUT', got == ['CONFLICT', 'CONFLICT', 'NOT_FOUND', 'INVALID_INPUT', 'INVALID_INPUT'], got)
    # 종료일 뒤 기록이 이미 있으면 거절
    ob = t[21].tmut(obs(C1, SA, A21, DAY(3)))
    got = [ecode(t[21].rpv(intent('membership_end', C1, course_ver(C1), mA['id'], 1, DAY(1), SA['id'], mA['enrollmentId']))),
           ecode(adm.rpv(intent('assignment_end', C1, course_ver(C1), A21, 1, DAY(2))))]
    pv_ok = t[21].rpv(intent('membership_end', C1, course_ver(C1), mA['id'], 1, DAY(3), SA['id'], mA['enrollmentId']))
    check('G09 종료일 뒤 날짜의 관찰이 있으면 수강 종료 · 담당 종료 → CONFLICT(원문 고치지 않음) · 그 날까지면 됨', ob.get('ok') is True and got == ['CONFLICT', 'CONFLICT'] and okr(pv_ok), (ob, got, pv_ok))
    # 수강 종료(담당 교사) — 미리보기 · 확정 · 재전송
    st_n = n('teaching_relation_ends')
    pv = t[21].rpv(intent('membership_end', C1, course_ver(C1), mB['id'], 1, DAY(), SB['id'], mB['enrollmentId'], reason='전학 예정으로 수강 종료'))
    ch = (pv.get('changes') or [{}])[0] if okr(pv) else {}
    check('G10 수강 종료 미리보기: 봉투 · 미리보기 ID · 지문 64 · 10분 만료 · 영향 1(판 1 · afterThrough 오늘 · end) · 기록 보존 · 이력 이전 없음 · 관계 그대로',
          okr(pv) and len(pv['fingerprint']) == 64 and pv['expiresAt'].endswith('Z') and len(pv['changes']) == 1 and ch['id'] == mB['id'] and ch['version'] == 1
          and ch['afterThrough'] == DAY() and ch['effect'] == 'end' and ch['effectiveThrough'] == t2last and pv['replacement'] is None
          and pv['recordsPreserved'] is True and pv['historyNotTransferred'] is True and n('teaching_relation_ends') == st_n, pv)
    cm = commit_of(pv); kB = key(); cvB = course_ver(C1)
    rb = t[21].rcm(cm, kB)
    check('G11 확정 → applied · 판 2 · 수업 판 +1 · 종료 사건 1 · 원래 행 그대로(UPDATE 없음)', okr(rb) and rb['outcome'] == 'applied' and rb['requestKey'] == kB
          and rb['changes'] == [{'kind': 'course_membership', 'id': mB['id'], 'version': 2}] and rb['replacementAssignmentId'] is None
          and course_ver(C1) == cvB + 1 and n('teaching_relation_ends') == st_n + 1 and keep_rows() == kept0, rb)
    sn2 = adm.rel(C1); mB2 = stu(sn2, SB['id'])['membership']
    check('G12 다시 조회: 수강 판 2 · 유효 끝 = 오늘 · 원래 끝(validThrough) 그대로', mB2['version'] == 2 and mB2['effectiveThrough'] == DAY() and mB2['validThrough'] == t2last, mB2)
    r2 = t[21].rcm(cm, kB)
    check('G13 같은 번호 · 같은 명령 재전송 → replayed · 같은 시각 · 쓰기 0', okr(r2) and r2['outcome'] == 'replayed' and r2['appliedAt'] == rb['appliedAt']
          and n('teaching_relation_ends') == st_n + 1, r2)
    cm_other = {**cm, 'intent': {**cm['intent'], 'reason': '다른 사유'}}
    ri = t[21].rcm(cm_other, kB)
    check('G14 같은 번호 · 다른 명령 → IDEMPOTENCY_CONFLICT 봉투(요청 번호 · 그 명령의 지문 = SHA-256(정규화 JSON))', ecode(ri) == 'IDEMPOTENCY_CONFLICT'
          and ri.get('requestKey') == kB and ri.get('commandHash') == sha(canonical(cm_other)), ri)
    check('G15 쓴 미리보기를 새 번호로 다시 → CONFLICT', ecode(t[21].rcm(cm)) == 'CONFLICT')
    obB = t[21].tmut(obs(C1, SB, A21, DAY(1)))
    obB0 = t[21].tmut(obs(C1, SB, A21, DAY()))
    check('G16 종료 뒤 그 수강의 새 관찰: 종료일 다음날 → INVALID_INPUT(트리거) · 종료일 당일 → 됨', ecode(obB) == 'INVALID_INPUT' and obB0.get('ok') is True, (obB, obB0))
    # 미리보기 위조 · 남의 미리보기 · 만료
    pv3 = adm.rpv(intent('membership_end', C1, course_ver(C1), stu(sn2, SC['id'])['membership']['id'], 1, DAY(5), SC['id'], stu(sn2, SC['id'])['membership']['enrollmentId']))
    c3 = commit_of(pv3)
    got = [ecode(adm.rcm({**c3, 'previewFingerprint': 'f' * 64})), ecode(t[21].rcm(c3)),
           ecode(adm.rcm({**c3, 'intent': {**c3['intent'], 'reason': '바꾼 사유'}})),
           ecode(adm.rcm({**c3, 'expectedChanges': [{**c3['expectedChanges'][0], 'version': 2}]})),
           ecode(adm.rcm({**c3, 'previewId': 'nope'})), ecode(adm.rcm({**c3, 'x': 1})), ecode(adm.rcm(c3, 'k 1'))]
    check('G17 지문 다름 · 다른 사람(21)의 확정 · 의도 바꿈 · 기대 판 다름 · 없는 미리보기 → CONFLICT, 모르는 칸 · 요청 번호 형식 → INVALID_INPUT',
          got == ['CONFLICT'] * 5 + ['INVALID_INPUT', 'INVALID_INPUT'], got)
    sqlfile(text=f"alter table workhub.teaching_relation_previews disable trigger teaching_relation_previews_guard; "
                 f"update workhub.teaching_relation_previews set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes' where id='{pv3['previewId']}'; "
                 f"alter table workhub.teaching_relation_previews enable trigger teaching_relation_previews_guard;")
    check('G18 만료된 미리보기로 새 확정 → CONFLICT(다시 미리보기)', ecode(adm.rcm(c3)) == 'CONFLICT')
    stop('teaching_relations')
    check('G19 기능 중지 중에도 완료된 접수의 같은 번호 재전송은 replayed(원장 먼저) · 새 미리보기는 UNAVAILABLE · 수업 조회는 그대로',
          (t[21].rcm(cm, kB) or {}).get('outcome') == 'replayed' and ecode(t[21].rpv(pv['intent'])) == 'UNAVAILABLE' and t[21].catalog().get('ok') is True)
    resume('teaching_relations')
    # 미리보기 뒤 상태가 바뀌면(수업 판 · 영향 집합) 확정 → CONFLICT
    pv4 = adm.rpv(intent('membership_end', C1, course_ver(C1), stu(sn2, SC['id'])['membership']['id'], 1, DAY(5), SC['id'], stu(sn2, SC['id'])['membership']['enrollmentId']))
    t[21].tmut(roster(C1, course_ver(C1), [srow('S-0005', '정우진', 2, '3', 1)], t2s, t2last))
    check('G20 미리보기 뒤 명부가 바뀌어 수업 판이 오르면 확정 → CONFLICT · 아무것도 안 바뀜', ecode(adm.rcm(commit_of(pv4))) == 'CONFLICT'
          and stu(adm.rel(C1), SC['id'])['membership']['version'] == 1)
    # 담당 교체: 21 → 24, 오늘까지. G09 의 21 관찰이 3일 뒤라 오늘 교체는 먼저 CONFLICT — 그 관찰을 철회하고 진행
    pvr0 = adm.rpv(intent('assignment_replace', C1, course_ver(C1), A21, 1, DAY(), repl=M[24]))
    oid = ob.get('entityId')
    wd = t[21].tmut({'kind': 'record_withdraw', 'recordKind': 'observation', 'courseId': C1, 'studentId': SA['id'], 'recordId': oid, 'expectedVersion': 1, 'reason': '날짜 잘못'})
    cvR = course_ver(C1)
    got = [ecode(adm.rpv(intent('assignment_replace', C1, cvR, A21, 1, DAY(), repl=M[22]))),     # 이미 같은 수업 담당(기간 겹침)
           ecode(adm.rpv(intent('assignment_replace', C1, cvR, A21, 1, DAY(), repl=M[21]))),     # 같은 교사
           ecode(adm.rpv(intent('assignment_replace', C1, cvR, A21, 1, DAY(), repl=M[27]))),     # 다른 학교
           ecode(adm.rpv(intent('assignment_replace', C1, cvR, A21, 1, DAY(), repl=M[28])))]     # 소속 끝남
    check('G21 새 담당: 이미 같은 수업 담당 · 같은 교사 · 다른 학교 · 소속 끝난 교사 → INVALID_INPUT', got == ['INVALID_INPUT'] * 4, got)
    pvr = adm.rpv(intent('assignment_replace', C1, cvR, A21, 1, DAY(), repl=M[24], reason='담당 교사 교체(시험)'))
    check('G22 담당 교체 미리보기: 종료일 뒤 21 의 관찰이 있으면 CONFLICT → 철회 뒤에는 됨(철회 기록은 막지 않음) · 새 담당 다음날 ~ 원래 끝',
          ecode(pvr0) == 'CONFLICT' and wd.get('ok') is True and okr(pvr)
          and pvr['replacement'] == {'memberId': M[24], 'label': '교사24', 'validFrom': DAY(1), 'validThrough': t2last}, (pvr0, wd, pvr))
    rr = adm.rcm(commit_of(pvr))
    newA = rr.get('replacementAssignmentId') if okr(rr) else None
    check('G23 담당 교체 확정 → 옛 담당 종료 사건 + 새 담당 1행(같은 트랜잭션) · 새 담당 ID 응답', okr(rr) and newA and rr['changes'] == [{'kind': 'assignment', 'id': A21, 'version': 2}]
          and scalar("select array[membership_id, valid_from::text, valid_to::text] from workhub.course_assignments where id=%s", (newA,)) == [M[24], DAY(1), t2e], rr)
    c21 = {x['id']: x for x in t[21].catalog()['courses']}; c24 = {x['id']: x for x in t[24].catalog()['courses']}
    check('G24 교체 뒤: 21 은 오늘까지 담당(쓰기 가능) · 24 는 수업이 보이지만 오늘은 담당 아님(내일부터)', c21[C1]['assignmentId'] == A21 and c21[C1]['canRecord']
          and C1 in c24 and c24[C1]['assignmentId'] is None and not c24[C1]['canRecord'], (c21.get(C1), c24.get(C1)))
    check('G25 21 의 내일 날짜 관찰 → INVALID_INPUT(담당 유효 끝)', ecode(t[21].tmut(obs(C1, SA, A21, DAY(1)))) == 'INVALID_INPUT')
    # 담당 종료(22, 5일 뒤까지) · 활동 원문판 가드
    pve = adm.rpv(intent('assignment_end', C1, course_ver(C1), A22, 1, DAY(5)))
    re_ = adm.rcm(commit_of(pve))
    check('G26 담당 종료(22 · 5일 뒤까지) → 판 2 · 22 의 6일 뒤 관찰 INVALID_INPUT · 5일 뒤 관찰은 됨', okr(re_)
          and ecode(t[22].tmut(obs(C1, SA, A22, DAY(6)))) == 'INVALID_INPUT' and t[22].tmut(obs(C1, SA, A22, DAY(5))).get('ok') is True, re_)
    # 시작 전 취소(전출의 영향): S-0004 는 C2(지금) · C3(10일 뒤 시작) 수강 — 3일 뒤까지 전출하면 C3 수강은 시작 전 취소
    s3 = adm.rel(C3); eD = s3['students'][0]['enrollment']; mD = s3['students'][0]['membership']
    pvc = adm.rpv(intent('student_transfer_out', C3, s3['courseVersion'], eD['id'], 1, DAY(3), eD['studentId'], eD['id'], reason='전출'))
    chc = {c['courseId']: c for c in pvc.get('changes', []) if c['kind'] == 'course_membership'} if okr(pvc) else {}
    rcn = adm.rcm(commit_of(pvc)) if okr(pvc) else pvc
    mD2 = adm.rel(C3)['students'][0]['membership']
    check('G27 전출 영향: 시작 전 수강(C3)은 cancel_before_start · afterThrough null, 진행 중 수강(C2)은 end · 확정 뒤 C3 effectiveThrough null(빈 기간)',
          chc.get(C3, {}).get('effect') == 'cancel_before_start' and chc.get(C3, {}).get('afterThrough') is None
          and chc.get(C2, {}).get('effect') == 'end' and chc.get(C2, {}).get('afterThrough') == DAY(3)
          and okr(rcn) and mD2['effectiveThrough'] is None and mD2['version'] == 2, (pvc, mD2))
    check('G28 이미 취소된 관계는 다시 바꿀 수 없음 → INVALID_INPUT', ecode(adm.rpv(intent('membership_end', C3, course_ver(C3), mD['id'], 2, DAY(), mD['studentId'], mD['enrollmentId']))) == 'INVALID_INPUT')
    # 전출: SA 학적 → C1 · C2 수강까지(다른 수업 포함)
    snA = adm.rel(C1); eA = stu(snA, SA['id'])['enrollment']
    pvt = adm.rpv(intent('student_transfer_out', C1, snA['courseVersion'], eA['id'], 1, DAY(5), SA['id'], eA['id'], reason='전출'))
    kinds = sorted((c['kind'], c.get('courseId')) for c in pvt.get('changes', [])) if okr(pvt) else []
    cv2 = course_ver(C2)
    rt = adm.rcm(commit_of(pvt))
    check('G29 전출 미리보기 = 학적 1 + 이 학적의 모든 수강(C1 · C2, 다른 수업 포함) → 확정 · 두 수업 판 +1', kinds == sorted([('enrollment', None), ('course_membership', C1), ('course_membership', C2)])
          and okr(rt) and len(rt['changes']) == 3 and course_ver(C2) == cv2 + 1, (pvt, rt))
    check('G30 전출 뒤 다른 수업(C2) 관계 조회에도 수강 유효 끝 = 전출일', stu(adm.rel(C2), SA['id'])['membership']['effectiveThrough'] == DAY(5))
    got = [ecode(t[23].tmut(roster(C2, course_ver(C2), [srow('S-0001', '김민준', 2, '1', 1)], t2s, t2last))),
           ecode(t[25].tmut(roster(C3, course_ver(C3), [srow('S-0001', '김민준', 2, '1', 1)], DAY(10), t2last)))]
    check('G31 전출 학생을 명부 재업로드로 되살리거나(같은 수업) 다른 수업에 새로 넣기 → CONFLICT', got == ['CONFLICT', 'CONFLICT'], got)
    # 동시성: 같은 관계를 두 미리보기로 동시에 · 같은 번호 동시 3번
    snx = adm.rel(C1); mC = stu(snx, SC['id'])['membership']
    pa_ = adm.rpv(intent('membership_end', C1, snx['courseVersion'], mC['id'], 1, DAY(4), SC['id'], mC['enrollmentId']))
    pb_ = adm.rpv(intent('membership_end', C1, snx['courseVersion'], mC['id'], 1, DAY(6), SC['id'], mC['enrollmentId']))
    outs = concurrently([lambda: adm.rcm(commit_of(pa_)), lambda: adm.rcm(commit_of(pb_))])
    check('G32 같은 수강을 다른 미리보기로 동시에 확정 → 하나만 applied, 하나는 CONFLICT · 종료 사건 1', sorted(o.get('outcome') if okr(o) else ecode(o) for o in outs) == ['CONFLICT', 'applied']
          and n('teaching_relation_ends', "relation_id=%s", (mC['id'],)) == 1, outs)
    snx = adm.rel(C1); m5 = next(s for s in snx['students'] if s['membership']['version'] == 1)['membership']
    pz = adm.rpv(intent('membership_end', C1, snx['courseVersion'], m5['id'], 1, DAY(8), m5['studentId'], m5['enrollmentId'])); kz = key()
    outs = concurrently([lambda: adm.rcm(commit_of(pz), kz) for _ in range(3)])
    check('G33 같은 번호 동시 3번 → applied 1 · replayed 2 · 같은 시각', sorted(o.get('outcome') for o in outs if okr(o)) == ['applied', 'replayed', 'replayed']
          and len({o.get('appliedAt') for o in outs}) == 1, outs)
    # 불변 · 감사 · 원래 P5 행 보존
    check('G34 종료 사건 · 확정 원장은 고칠 · 지울 수 없음 · 미리보기는 한 번 사용 처리 외 고칠 수 없음', all('IMMUTABLE_ROW' in sqlerr(s) for s in (
        "update workhub.teaching_relation_ends set last_day = last_day + 1", "delete from workhub.teaching_relation_ends",
        "update workhub.teaching_relation_commits set changes='[]'", "delete from workhub.teaching_relation_commits",
        "update workhub.teaching_relation_previews set fingerprint='x'", "delete from workhub.teaching_relation_previews")))
    check('G35 원래 P5 담당 · 수강 · 학적 행은 한 줄도 바뀌지 않음(증분만 — 종료 · 교체 · 전출 뒤에도)', keep_rows() == kept0, (keep_rows(), kept0))
    check('G36 종료 사건 직접 넣기: 기간을 늘리거나 판을 건너뛰면 표가 거부', all('P8_RELATION_END_INVALID' in sqlerr(s) for s in (
        f"insert into workhub.teaching_relation_ends(school_id,kind,relation_id,version,last_day,reason,request_key,recorded_by_membership_id) values ('{s1}','course_membership','{mB['id']}',3,'{t2last}','x','k-x','{m1}')",
        f"insert into workhub.teaching_relation_ends(school_id,kind,relation_id,version,last_day,reason,request_key,recorded_by_membership_id) values ('{s1}','course_membership','{mB['id']}',5,'{DAY()}','x','k-x','{m1}')")))
    check('G37 감사: teaching.relation_change 는 school 민감도 · 사유 · 학생 이름 없음', n('audit_events', "operation='teaching.relation_change'") >= 6
          and n('audit_events', "operation='teaching.relation_change' and (sensitivity <> 'school' or details::text like '%%전학%%' or details::text like '%%김민준%%')") == 0)
    check('G38 P8-05-07(종료된 관계 뒤에 남은 기록 없음) ok', dict((r[0], r[2]) for r in postcheck())['P8-05-07'] == 'ok')
    t[21].course(C1); adm.course(C1)

    # ======================================================================= H. 마무리
    post = postcheck()
    check('H01 사용 뒤 P8-05 FAIL 없음 · 켜기 상태 3개 모듈', all(r[2] in ('ok', 'info') for r in post)
          and post[-1][3] == 'daedong-ms:cooperation_notices=active, daedong-ms:duty_admin_review=active, daedong-ms:teaching_relations=active', post)
    after2 = fingerprint()
    check('H02 사용 뒤에도 P8 밖 구조 지문(S1~S6) 같음' + (' — P7-05 보강 뒤 기준' if BRIDGE else ''), [r for r in base_s if not r[1].startswith('D1')] == [r for r in after2 if not r[1].startswith('D1')],
          [(a[1], b[3]) for a, b in zip(base_s, after2) if a != b])
    check('H03 P8-06 같은 모듈 다시 → 멈춤(다시 켜기는 P2-81)', '이미 활성화 행이 있습니다' in sqlerr(p806(['teaching_relations'])))

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f: json.dump({'captures': captures, 'bridge': BRIDGE}, f, ensure_ascii=False)
    n_ok = sum(1 for _, v in results if v)
    print(f'합계: PASS {n_ok} · FAIL {len(results) - n_ok}')
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == '__main__':
    main()
