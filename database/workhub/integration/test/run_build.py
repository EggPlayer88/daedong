# 통합 II · III: R0 만 적용된 시험 DB 하나에 R1 → R1S → P1 → … → P7 → P7-05 를 파일 하나씩 운영 순서로 적용한다(DB 초기화 없음).
#   파일마다 INT-03(통합 사후 점검)을, 단계가 끝날 때마다 지금까지 적용한 모든 단계의 사후 점검(-03 · R1-04 · R1S-03)을 돌린다.
#   기존 자료(public · auth 표 행 · 기존 정책 · 기존 함수)가 처음과 끝에 같은지 본다.
#   III: 다 설치된 DB 에서 기존 R1 함수의 권한 · search_path 등을 실제로 망가뜨리면 INT-03 이 정확한 행으로 FAIL 하는지, 되돌리면 ok 인지 본다.
#
# 사용: python3 run_build.py      (R0 만 적용된 시험 DB 에서 — run_integration.sh 가 준비한다)
import os, sys
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
WH = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from gen_manifest import STAGES, fill_p705

results = []
def check(name, cond, info=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -- {str(info)[:600]}'))

def conn():
    c = psycopg2.connect(host=os.environ['R0_PGHOST'], port=int(os.environ.get('R0_PG_PORT', '55433')), dbname='r0', user='postgres')
    c.autocommit = True; return c

def run(sql):
    c = conn(); cur = c.cursor(); cur.execute(sql); r = cur.fetchall() if cur.description else []; c.close(); return r

def run_file(path):
    text = open(os.path.join(WH, path), encoding='utf-8').read()
    if path.endswith('P7-05_R1_P2_보강_별도승인.sql'): text = fill_p705(text)
    return run(text)

def int03(): return run_file('integration/INT-03_통합사후점검.sql')
def fails(rows): return sorted(r[0] for r in rows if r[2] == 'FAIL')

# 단계별 사후 점검 파일
POST = {'R1': 'r1/R1-04_사후점검.sql', 'R1S': 'r1s/R1S-03_사후점검.sql', 'P1': 'p1/P1-03_사후점검.sql', 'P2': 'p2/P2-03_사후점검.sql',
        'P3': 'p3/P3-03_사후점검.sql', 'P4': 'p4/P4-03_사후점검.sql', 'P5': 'p5/P5-03_사후점검.sql', 'P6': 'p6/P6-03_사후점검.sql',
        'P7': 'p7/P7-03_사후점검.sql'}
# R1S 뒤 R1-04 의 03 · 04 · 09 는 FAIL 로 보이는 것이 설계다(INT-03-13 · R1S_설계결정). 그 밖의 FAIL 은 없어야 한다.
EXPECTED_R1_04 = ['R1-04-03', 'R1-04-04', 'R1-04-09']

# 기존 자료 · 기존 구조(R0 이전부터 있던 것) — public · auth 표의 행 해시, workhub 로 시작하지 않는 정책 · 함수 · 버킷
PRESERVE_SQL = r"""
SELECT 'rows:' || n.nspname || '.' || c.relname,
       (xpath('/row/h/text()', query_to_xml(format('SELECT md5(COALESCE(string_agg(t::text, %L ORDER BY t::text), %L)) AS h FROM %I.%I t',
                                                   '|', '', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public','auth') AND c.relkind = 'r'
UNION ALL
SELECT 'policies(기존)', md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || concat_ws('|', permissive, roles::text, cmd, qual, with_check), ',' ORDER BY policyname))
  FROM pg_policies WHERE policyname NOT LIKE 'workhub%' AND schemaname NOT IN ('workhub','workhub_private','workhub_storage')
UNION ALL
SELECT 'functions(기존)', md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || COALESCE(array_to_string(p.proacl, ','), ''), ',' ORDER BY p.oid::regprocedure::text))
  FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace) AND p.prokind = 'f' AND p.proname NOT LIKE 'workhub\_%'
UNION ALL
SELECT 'buckets(기존)', md5(COALESCE(string_agg(b::text, ',' ORDER BY b.id), '')) FROM storage.buckets b WHERE b.id NOT LIKE 'workhub%'
ORDER BY 1"""


def build():
    print('== II. 한 DB 에 차례로 설치(초기화 없음) — 파일마다 INT-03, 단계마다 모든 사후 점검')
    before = run(PRESERVE_SQL)
    r = int03()
    check('II-00 R0 만: INT-03 FAIL 없음 · 조합 R0', fails(r) == [] and r[0][3] == 'R0', r[:2])
    done = []
    for stage, files, _ in STAGES[1:]:
        for i, f in enumerate(files):
            run_file(f)
            r = int03()
            if i < len(files) - 1:
                check(f'II-{stage} {os.path.basename(f)} 만 적용 → INT-03-01 "부분 적용" FAIL(다음 파일 전 상태를 알아챔)',
                      'INT-03-01' in fails(r) and '(부분 적용!)' in r[0][3], r[0])
        done.append(stage)
        check(f'II-{stage} 적용 뒤 INT-03 FAIL 없음 — {r[0][3]}', fails(r) == [], [x for x in r if x[2] == 'FAIL'])
        bad = {}
        for s in done:
            if s in POST:
                f = fails(run_file(POST[s]))
                if f != (EXPECTED_R1_04 if s == 'R1' and 'R1S' in done else []): bad[s] = f
        r104 = fails(run_file(POST['R1']))
        check(f'II-{stage} 지금까지 적용한 모든 단계의 사후 점검 FAIL 없음'
              + (' (R1-04 는 03 · 04 · 09 만 — INT-03 이 대신 확인)' if 'R1S' in done else ''), not bad, bad)
    after = run(PRESERVE_SQL)
    diff = [(a[0], a[1], b[1]) for a, b in zip(before, after) if a != b] + ([('개수', len(before), len(after))] if len(before) != len(after) else [])
    check(f'II-99 기존 자료 · 구조 보존: public · auth 표 {sum(1 for x in before if x[0].startswith("rows:"))}개 행 해시 · 기존 정책 · 기존 함수 · 기존 버킷이 처음과 같음',
          not diff, diff[:5])


ALL_OWNER = """DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\\_%')
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO {to}', f); END LOOP; END $$"""


def breaks():
    print('== III. 다 설치된 DB 에서 실제로 망가뜨리기 → INT-03 이 정확한 행으로 FAIL → 되돌리면 ok')
    fn = "public.workhub_collection_get(p_member_id text, p_request_id text)"
    wfn = "public.workhub_file_worker_claim(p_school_id text, p_worker_id text, p_limit integer)"
    body_fn = "workhub_private.c_require(p_ctx workhub_private.actor_context, p_level text)"
    home = "public.workhub_home_overview(p_member_id text)"
    orig_body = run("select pg_get_functiondef('workhub_private.c_require(workhub_private.actor_context, text)'::regprocedure)")[0][0]
    orig_home = run("select pg_get_functiondef('public.workhub_home_overview(text)'::regprocedure)")[0][0]
    con = run("select pg_get_constraintdef(oid) from pg_constraint where conname='service_principals_action_registry'")[0][0]
    qual = run("select qual from pg_policies where policyname='workhub_collection_select'")[0][0]
    r104 = fails(run_file(POST['R1']))
    cases = [
        ('기존 R1 앱 함수에 anon 실행 권한', f"GRANT EXECUTE ON FUNCTION {fn} TO anon", f"REVOKE EXECUTE ON FUNCTION {fn} FROM anon", 'INT-03-04'),
        ('R1 작업자 함수에 authenticated 실행 권한', f"GRANT EXECUTE ON FUNCTION {wfn} TO authenticated", f"REVOKE EXECUTE ON FUNCTION {wfn} FROM authenticated", 'INT-03-04'),
        ('R1 함수에 PUBLIC 실행 권한', f"GRANT EXECUTE ON FUNCTION {fn} TO PUBLIC", f"REVOKE EXECUTE ON FUNCTION {fn} FROM PUBLIC", 'INT-03-04'),
        ('R1 함수 search_path 를 public 으로', f"ALTER FUNCTION {fn} SET search_path = public", f"ALTER FUNCTION {fn} SET search_path = ''", 'INT-03-05'),
        ('R1 함수 SECURITY INVOKER 로', f"ALTER FUNCTION {fn} SECURITY INVOKER", f"ALTER FUNCTION {fn} SECURITY DEFINER", 'INT-03-05'),
        ('R1 함수와 같은 이름 다른 인자(오버로드)', "CREATE FUNCTION public.workhub_collection_get(p_member_id text) RETURNS jsonb LANGUAGE sql AS 'select null::jsonb'",
         "DROP FUNCTION public.workhub_collection_get(text)", 'INT-03-03'),
        ('목록에 없는 내부 함수', "CREATE FUNCTION workhub_private.zz_unknown() RETURNS int LANGUAGE sql AS 'select 1'", "DROP FUNCTION workhub_private.zz_unknown()", 'INT-03-03'),
        ('R1S 가 교체한 R1 함수 본문을 손으로 바꿈', orig_body.replace('BEGIN', 'BEGIN\n  -- 손으로 바꿈', 1), orig_body, 'INT-03-07'),
        # 소유자를 바꾸려면 새 소유자가 그 스키마에 CREATE 권한이 있어야 한다 → 시험용 역할을 잠깐 만들고 되돌릴 때 지운다
        ('함수 소유자를 다른 역할로', f"DROP ROLE IF EXISTS int_test_owner; CREATE ROLE int_test_owner; GRANT int_test_owner TO postgres; GRANT CREATE ON SCHEMA public TO int_test_owner; ALTER FUNCTION {fn} OWNER TO int_test_owner",
         f"ALTER FUNCTION {fn} OWNER TO postgres; REVOKE CREATE ON SCHEMA public FROM int_test_owner; DROP ROLE int_test_owner", 'INT-03-08'),
        # 직접 부여 없이 상속으로 열린 실행 권한: 그룹 역할에 EXECUTE 를 주고 anon 을 그 그룹의 (상속하는) 구성원으로 → 함수 ACL 에는 anon 이 없다.
        # Supabase 의 anon 은 NOINHERIT 라 그냥 GRANT 하면 상속되지 않는다 — 상속이 실제로 열리는 PostgreSQL 16+ 구문(WITH INHERIT TRUE)으로 만든다.
        ('상속으로 anon 실행 권한(그룹 역할에 EXECUTE, anon 이 상속 구성원)', f"DROP ROLE IF EXISTS int_test_group; CREATE ROLE int_test_group NOLOGIN; GRANT EXECUTE ON FUNCTION {fn} TO int_test_group; GRANT int_test_group TO anon WITH INHERIT TRUE",
         f"REVOKE int_test_group FROM anon; REVOKE EXECUTE ON FUNCTION {fn} FROM int_test_group; DROP ROLE int_test_group", 'INT-03-04'),
        # 소유자 전부를 한꺼번에 다른 역할로 — "가장 많은 소유자"와 비교하면 그 역할이 기준이 되어 놓친다 → 허용표로 잡는지
        ('점검 범위 함수의 소유자를 전부 다른 역할로', "DROP ROLE IF EXISTS int_test_owner; CREATE ROLE int_test_owner; GRANT int_test_owner TO postgres;"
         " GRANT CREATE ON SCHEMA public, workhub, workhub_private, workhub_storage TO int_test_owner;" + ALL_OWNER.format(to='int_test_owner'),
         ALL_OWNER.format(to='postgres') + "; REVOKE CREATE ON SCHEMA public, workhub, workhub_private, workhub_storage FROM int_test_owner; DROP ROLE int_test_owner", 'INT-03-08', 'R1-04 생략'),
        ('P7 공개 함수를 지움', f"DROP FUNCTION {home}",
         orig_home + f";\nREVOKE ALL ON FUNCTION {home} FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION {home} TO authenticated", 'INT-03-02'),
        ('R1 표 트리거를 끔', "ALTER TABLE workhub.collections DISABLE TRIGGER collections_identity", "ALTER TABLE workhub.collections ENABLE TRIGGER collections_identity", 'INT-03-09'),
        ('R0 · R1S 작업 목록 CHECK 를 지움', "ALTER TABLE workhub.service_principals DROP CONSTRAINT service_principals_action_registry",
         f"ALTER TABLE workhub.service_principals ADD CONSTRAINT service_principals_action_registry {con}", 'INT-03-10'),
        ('수합 Storage 읽기 정책을 넓힘', "ALTER POLICY workhub_collection_select ON storage.objects USING (true)",
         f"ALTER POLICY workhub_collection_select ON storage.objects USING ({qual})", 'INT-03-11'),
    ]
    for name, brk, fix, row, *opt in cases:
        # 소유자 전부를 바꾸면 R1-04 가 부르는 SECURITY DEFINER 함수가 새 소유자 권한(Storage 없음)으로 돌아 R1-04 자체가 멈춘다 → 그 경우만 R1-04 생략
        run(brk); r = int03(); f = fails(r); r1 = r104 if opt else fails(run_file(POST['R1']))
        run(fix); r2 = fails(int03())
        check(f'III {name} → {row} FAIL' + (f' ({opt[0]})' if opt else ' (R1-04 는 그대로라 못 알아챔)' if r1 == r104 else ' (R1-04 도 바뀜)') + ' → 되돌리면 FAIL 없음',
              row in f and f == [row] and r2 == [], (f, [x for x in r if x[2] == 'FAIL'][:2], r2))


if __name__ == '__main__':
    build(); breaks()
    print(f'합계: PASS {sum(results)} · FAIL {len(results) - sum(results)}')
    sys.exit(0 if all(results) else 1)
