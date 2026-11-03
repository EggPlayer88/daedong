"""확정 SQL을 새 localhost PG17에 설치해 현재 읽기 전용 통합 점검을 생성·검증한다.
운영 연결 인자와 자격증명은 공통 실행기가 거절한다. 기존 SQL은 쓰지 않는다.
"""
from pathlib import Path
import os, sys, json, hashlib
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WRITE = sys.argv[1:] == ['--write']
if sys.argv[1:] and not WRITE:
    raise SystemExit('지원 인자: --write 또는 생략. 운영 연결은 지원하지 않습니다.')
sys.argv = [sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT', '55669')
sys.path.insert(0, str(ROOT / 'database/workhub-deployment/integration/test'))
import run_integrated as I
sys.path.insert(0, str(ROOT / 'database/workhub-messaging-pilot/mp1/test'))
import build_checks as MP

OP1 = ROOT / 'database/workhub-participation/op1'
AF1 = ROOT / 'database/workhub-annual/af1'
AF2 = ROOT / 'database/workhub-annual/af2'
SP1 = ROOT / 'database/site-presentation/sp1'
TARGET = HERE / 'INT-11_SQL편집기용_통합점검.sql'
STAGES = [
    ('AF1-01', 42, 'OP1-01', AF1, 'workhub_private.af1_installs'),
    ('AF1-02', 43, 'AF1-01', AF1, 'workhub_private.af1_installs'),
    ('AF1-03', 44, 'AF1-02', AF1, 'workhub_private.af1_installs'),
    ('AF1-04', 45, 'AF1-03', AF1, 'workhub_private.af1_installs'),
    ('AF2-01', 46, 'AF1-04', AF2, None),
    ('SP1', 47, 'AF2-01', SP1, None),
]

def path(folder, prefix):
    found = list(folder.glob(prefix + '_*.sql'))
    assert len(found) == 1, prefix
    return found[0]

def read(p):
    return p.read_text('utf-8-sig').replace('\r\n', '\n')

def scoped(text):
    # 생성과 검사에 같은 카탈로그를 사용하고 기간 업무의 표·함수도 포함한다.
    return text.replace("'workhub_storage')", "'workhub_storage','site_presentation')").replace(
        "p.proname LIKE 'workhub\\_%'", "(p.proname LIKE 'workhub\\_%' OR p.proname LIKE 'site\\_seasonal\\_%')")

def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)

def assemble(base, delta):
    packed = json.loads(base.split('$op1data$')[1])
    attrs = [None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
    rows = [[packed['s'][s], packed['t'][t], packed['k'][k], attrs[a]] for s,t,k,a in packed['r']] + delta
    payload = json.dumps(MP.S3.S2.S1.encode(rows), ensure_ascii=False, separators=(',', ':'))
    tail = scoped(base.split('$op1data$')[2]).replace('INT-10-', 'INT-11-')
    old = "('OP1-01',41,'MP1-01 P8-03 T3-03')"
    tail = replace_once(tail, old, old + ',\n ' + ',\n '.join("('%s',%s,'%s')" % (s,n,d) for s,n,d,_,_ in STAGES))
    old = "('OP1-01','workhub_private.op1_installs',ARRAY['OP1-01'])"
    records = ["('%s','%s',ARRAY['%s'])" % (s,t,s) for s,_,_,_,t in STAGES if t]
    tail = replace_once(tail, old, old + ',\n ' + ',\n '.join(records))
    old = "WHEN to_regclass(rec.tbl) IS NULL THEN 0"
    tail = replace_once(tail, old, """WHEN s.stage = 'AF2-01' THEN (to_regprocedure('public.workhub_collection_presentation(text,text,jsonb,text)') IS NOT NULL)::int + (to_regprocedure('workhub_private.af2_statuses(workhub_private.actor_context,jsonb)') IS NOT NULL)::int
              WHEN s.stage = 'SP1' THEN (to_regclass('site_presentation.seasonal_work') IS NOT NULL)::int + (to_regclass('site_presentation.seasonal_receipts') IS NOT NULL)::int
              """ + old)
    tail = replace_once(tail, "s.stage IN ('R0','K1')", "s.stage IN ('R0','K1','AF2-01','SP1')")
    # 최신 운영 전용이다. 최신 증분 전체가 없는 DB를 정상 완료로 표시하지 않는다.
    tail = replace_once(tail, 'CASE WHEN bool_or(partial) OR bool_or(installed AND EXISTS',
        "CASE WHEN NOT bool_and(installed) OR bool_or(partial) OR bool_or(installed AND EXISTS")
    tail = tail.replace('적용된 단계 조합(부분 적용 · 선행 단계 없이 적용 없음)', '현재 운영 기준 48단계 설치 · 부분 적용과 선행 누락 없음')
    sql = '-- INT-11: AF1·AF2·SP1까지 적용한 운영 전용 읽기 전용 구조 점검. 18행, 12·13 info.\n-- 설치·활성화·권한 변경 명령이 아니다. 기존 INT-10/OP1-02를 덮어쓰지 않는다.\nWITH packed(v) AS (VALUES ($int11data$' + payload + '$int11data$' + tail
    assert len(sql.encode()) < 750000, 'SQL Editor용 크기 상한'
    return sql

def test():
    import gen_int_05 as G
    I.Q('create database ' + I.DB + ' owner postgres template p9_manifest', user='supabase_admin', db='postgres')
    for _, files, _ in G.g.gm.STAGES[1:]:
        for name in files:
            I.apply(Path(G.g.gm.WH)/name, name.endswith('P7-05_R1_P2_보강_별도승인.sql'))
    for _, files, _ in G.g.T1_STAGES:
        for name in files: I.apply(Path(G.g.T1)/name)
    for folder, prefix in [('workhub-storage-download/s1','S1-01'),('workhub-storage-download/s2','S2-01'),('workhub-storage-download/s3','S3-01'),('workhub-messaging-pilot/mp1','MP1-01')]:
        I.apply(path(ROOT/'database'/folder, prefix))
    I.apply(path(OP1, 'OP1-01'))
    base = read(path(OP1, 'INT-10'))
    I.H.check('기존 INT-10 기준선 18행 FAIL 0', len(I.run(base)) == 18 and all(r[2] != 'FAIL' for r in I.run(base)))
    catalog = scoped(G.g.gm.CATALOG_SQL)
    snapshot = lambda: {(k,key):a for k,key,a,_ in I.run(catalog)}
    protected = ['auth.users','public.users','public.doc_submissions','storage.objects','workhub.accounts','workhub.memberships','workhub.membership_roles','workhub.module_activations','workhub.participant_grants','workhub.ai_gateway_requests']
    original_data = I.preserve(protected)
    deltas = []
    for stage, _, _, folder, _ in STAGES:
        before = snapshot()
        I.apply(path(folder, 'SP1-01' if stage == 'SP1' else stage))
        after = snapshot()
        deltas.extend([[stage,k,key,after.get((k,key))] for k,key in sorted(set(before)|set(after)) if before.get((k,key)) != after.get((k,key))])
    I.H.check('이전 INT-10이 정상 AF1·AF2 설치를 FAIL로 오인하는 현상 재현', any(r[2] == 'FAIL' for r in I.run(base)))
    I.H.check('이전 OP1-02도 AF1 인계 함수 변경을 FAIL로 오인함', any(r[2] == 'FAIL' for r in I.run(read(path(OP1,'OP1-02')))))
    candidate = assemble(base, deltas)
    for label, query, rows, status_index in [('INT-11',candidate,18,2),('AF1-05',read(path(AF1,'AF1-05')),8,2),('AF2-02',read(path(AF2,'AF2-02')),4,2),('SP1-02',read(path(SP1,'SP1-02')),7,1)]:
        with I.H.connect(db=I.DB) as connection:
            with connection.cursor() as cursor:
                cursor.execute('BEGIN READ ONLY')
                cursor.execute(query)
                result = cursor.fetchall()
                cursor.execute('ROLLBACK')
        I.H.check(label + ' 읽기 전용 트랜잭션에서 정상 행·FAIL 0', len(result) == rows and all(r[status_index] != 'FAIL' for r in result))
    I.H.check('회원·소속·역할·파일·AI 원장 보존', original_data == I.preserve(protected))
    # 판정기의 검출력을 검사한다. 매 사례는 새 트랜잭션에서 되돌린다.
    original = I.run("select pg_get_functiondef('workhub_private.af2_statuses(workhub_private.actor_context,jsonb)'::regprocedure)")[0][0]
    mutations = [
      ('함수 본문', original.replace('AS $function$', 'AS $function$\n-- 합성 훼손\n', 1), '07'),
      ('함수 소유자', 'ALTER FUNCTION public.site_seasonal_status() OWNER TO supabase_admin', '08'),
      ('상속 실행 권한', 'CREATE ROLE int11_extra; GRANT EXECUTE ON FUNCTION workhub_private.af1_admin_lock() TO int11_extra; GRANT int11_extra TO anon WITH INHERIT TRUE', '04'),
      ('AF1 보호 트리거', 'ALTER TABLE workhub.memberships DISABLE TRIGGER af1_members_guard', '09'),
      ('SP1 RLS', 'ALTER TABLE site_presentation.seasonal_work DISABLE ROW LEVEL SECURITY', '14'),
      ('SP1 열', 'ALTER TABLE site_presentation.seasonal_work ADD COLUMN extra text', '15'),
      ('기존 표 RLS', 'ALTER TABLE workhub.participant_grants DISABLE ROW LEVEL SECURITY', '14'),
      ('AF1 선행 기록 누락', "DELETE FROM workhub_private.af1_installs WHERE batch='AF1-02'", '01'),
      ('신규 함수 누락', 'DROP FUNCTION public.site_seasonal_status()', '02'),
      ('추가 함수', 'CREATE FUNCTION public.site_seasonal_extra() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$', '03'),
    ]
    for label, mutation, row in mutations:
        connection = I.H.connect(user='supabase_admin', db=I.DB)
        try:
            with connection.cursor() as cursor:
                cursor.execute('BEGIN')
                cursor.execute(mutation)
                cursor.execute(candidate)
                result = cursor.fetchall()
                I.H.check(label + ' 훼손을 INT-11-' + row + '에서 검출', next(r for r in result if r[0] == 'INT-11-' + row)[2] == 'FAIL')
                cursor.execute('ROLLBACK')
        finally: connection.close()
    I.H.check('훼손 회귀 뒤 최종 INT-11 정상', all(r[2] != 'FAIL' for r in I.run(candidate)))
    if WRITE:
        TARGET.write_text(candidate, encoding='utf-8', newline='\n')
    else:
        I.H.check('INT-11 재생성이 저장 원문과 동일', read(TARGET) == candidate)
    entries = [(TARGET,18), (path(AF1,'AF1-05'),8), (path(AF2,'AF2-02'),4), (path(SP1,'SP1-02'),7)]
    manifest = {'version':2,'encoding':'UTF-8, LF','postcheck':'INT-11','baseline':'OP1 + AF1 + AF2 + SP1',
      'files':[{'file':p.name,'source':p.relative_to(ROOT).as_posix(),'bytes':len(read(p).encode()),'sha256':hashlib.sha256(read(p).encode()).hexdigest(),'rows':rows} for p,rows in entries]}
    record = HERE/'sql-package.json'
    if WRITE: record.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    else: I.H.check('현재 점검 파일 해시 목록 일치', json.loads(read(record)) == manifest)
    print('INT-11 범위', len(deltas), '변경 객체 · SQL', len(candidate.encode()), 'bytes', flush=True)

I.H.tests = test
if __name__ == '__main__': I.H.main()

