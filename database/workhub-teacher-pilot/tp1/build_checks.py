"""새 localhost PG17에 전체 기준을 설치해 TP1 포함 INT-14를 생성·대조한다."""
from pathlib import Path
import os, sys, json, importlib.util, hashlib

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WRITE = sys.argv[1:] == ['--write']
if sys.argv[1:] and not WRITE:
    raise SystemExit('지원 인자: --write 또는 생략')
sys.argv = [sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT', '55801')
spec = importlib.util.spec_from_file_location('tp1_int13_base', ROOT / 'database/workhub-teacher-roster/tr1/build_checks.py')
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
I = B.I
TARGET = HERE / 'INT-14_시험교사포함_통합점검.sql'
read = B.B.B.read
replace_once = B.B.B.replace_once


def scoped(source):
    return source.replace("'site_presentation','neis_private','teacher_roster')",
                          "'site_presentation','neis_private','teacher_roster','teacher_pilot')")


def assemble(base, delta):
    packed = json.loads(base.split('$int13data$')[1])
    attrs = [None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
    rows = [[packed['s'][s], packed['t'][t], packed['k'][k], attrs[a]] for s, t, k, a in packed['r']] + delta
    payload = json.dumps(B.B.B.MP.S3.S2.S1.encode(rows), ensure_ascii=False, separators=(',', ':'))
    tail = scoped(base.split('$int13data$')[2]).replace('INT-13-', 'INT-14-').replace('50단계', '52단계')
    tail = replace_once(tail, "('TR1',49,'N1')", "('TR1',49,'N1'),\n ('TP1-01',50,'TR1'),\n ('TP1-02',51,'TP1-01')")
    tail = replace_once(tail, "WHEN s.stage = 'TR1' THEN", "WHEN s.stage = 'TP1-01' THEN (to_regnamespace('teacher_pilot') IS NOT NULL)::int + (to_regprocedure('teacher_pilot.register(text,text,text,timestamp with time zone,timestamp with time zone,jsonb,text)') IS NOT NULL)::int\n              WHEN s.stage = 'TP1-02' THEN (to_regprocedure('public.workhub_teacher_pilot_access()') IS NOT NULL)::int + (to_regprocedure('teacher_pilot.stop(text,text,text,integer,text)') IS NOT NULL)::int\n              WHEN s.stage = 'TR1' THEN")
    tail = replace_once(tail, "s.stage IN ('R0','K1','AF2-01','SP1','N1','TR1')", "s.stage IN ('R0','K1','AF2-01','SP1','N1','TR1','TP1-01','TP1-02')")
    return '-- INT-14: 기존 INT-13 + 시험 교사 TP1. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int14data$' + payload + '$int14data$' + tail


def tests():
    B.tests()
    import gen_int_05 as G
    catalog = scoped(B.scoped(B.B.scoped(B.B.B.scoped(G.g.gm.CATALOG_SQL))))
    snapshot = lambda: {(kind, key): attrs for kind, key, attrs, _ in I.run(catalog)}
    protected = ['public.users', 'auth.users', 'workhub.accounts', 'workhub.memberships',
                 'workhub.membership_roles', 'workhub.course_assignments',
                 'workhub.ai_school_policies', 'workhub.ai_school_controls', 'workhub.ai_gateway_requests',
                 'teacher_roster.plans', 'teacher_roster.teachers']
    original = I.preserve(protected)
    staff_query = "SELECT to_jsonb(t)-'tp1_cancelled' FROM workhub.staff_assignments t ORDER BY id"
    staff_before = I.run(staff_query)
    delta = []
    for stage in ['TP1-01', 'TP1-02']:
        before = snapshot()
        I.apply(next(HERE.glob(stage + '_*.sql')))
        after = snapshot()
        delta.extend([[stage, kind, key, after.get((kind, key))]
                      for kind, key in sorted(set(before) | set(after))
                      if before.get((kind, key)) != after.get((kind, key))])
    I.H.check('TP1 설치는 기존 회원·소속·역할·수업·AI 정책·원장 보존', original == I.preserve(protected))
    I.H.check('담임 배정은 새 종료 표시 열 외 기존 값 보존', staff_before == I.run(staff_query))
    candidate = assemble(read(B.TARGET), delta)
    rows = I.run(candidate)
    I.H.check('INT-14 18행 FAIL 0', len(rows) == 18 and all(r[2] != 'FAIL' for r in rows))
    I.H.check('TP1 설치는 시험 계정을 자동 생성하지 않음', I.run('SELECT count(*) FROM teacher_pilot.members')[0][0] == 0)
    for label, mutation, suffix in [
        ('시험 명단 RLS', 'ALTER TABLE teacher_pilot.members DISABLE ROW LEVEL SECURITY', '14'),
        ('추가 열', 'ALTER TABLE teacher_pilot.members ADD COLUMN unexpected text', '15'),
        ('익명 실행', 'GRANT EXECUTE ON FUNCTION public.workhub_teacher_pilot_access() TO anon', '04'),
        ('공개 함수 소유자', 'ALTER FUNCTION public.workhub_teacher_pilot_access() OWNER TO supabase_admin', '08'),
    ]:
        with I.H.connect(user='supabase_admin', db=I.DB) as c:
            with c.cursor() as cur:
                cur.execute('BEGIN')
                cur.execute(mutation)
                cur.execute(candidate)
                result = cur.fetchall()
                I.H.check(label + ' 훼손 검출', next(r for r in result if r[0] == 'INT-14-' + suffix)[2] == 'FAIL')
                cur.execute('ROLLBACK')
    if WRITE:
        TARGET.write_text(candidate, encoding='utf-8', newline='\n')
    else:
        I.H.check('INT-14 재생성 일치', read(TARGET) == candidate)
    manifest = {'postcheck': 'INT-14', 'baseline': 'INT-13 + TP1-01 + TP1-02', 'rows': 18,
                'source': TARGET.relative_to(ROOT).as_posix(), 'bytes': len(candidate.encode()),
                'sha256': hashlib.sha256(candidate.encode()).hexdigest(), 'deltaObjects': len(delta)}
    if WRITE:
        (HERE / 'checks.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    else:
        I.H.check('INT-14 해시 일치', json.loads(read(HERE / 'checks.json')) == manifest)
    print('INT-14', len(delta), '변경 객체', len(candidate.encode()), 'bytes', flush=True)


I.H.tests = tests
if __name__ == '__main__':
    I.H.main()
