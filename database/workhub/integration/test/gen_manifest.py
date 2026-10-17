# INT-03 통합 사후 점검의 "단계별 예상 객체 목록(manifest)"을 시험 DB 에서 기계로 만든다.
#   R0 만 적용된 시험 DB(run_integration.sh 가 준비)에서 R1 → R1S → P1 → … → P7 → P7-05 → P8-01~04 를 한 파일씩 적용하며
#   매 단계 전후의 함수 · 트리거 · 제약 · Storage 정책 목록(CATALOG_SQL)을 떠서, 그 단계가 새로 만든 것 · 바꾼 것을 기록한다.
#   손으로 쓴 목록이 아니므로 SQL 파일과 목록이 어긋날 수 없다. --check 는 다시 만들어 저장소의 INT-03 과 한 글자라도 다르면 실패.
#
# 사용: python3 gen_manifest.py write|check      (R0 만 적용된 시험 DB 에서 — run_integration.sh 가 준비한다)
import json, os, re, sys
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
WH = os.path.abspath(os.path.join(HERE, '..', '..'))
OUTFILE = os.path.join(WH, 'integration', 'INT-03_통합사후점검.sql')
HOST = os.environ['R0_PGHOST']; PORT = int(os.environ.get('R0_PG_PORT', '55433'))

# 단계 · 적용 순서(운영 순서) · 선행 단계 · 적용 기록
STAGES = [
    ('R0',    [],                                                                    []),
    ('R1',    ['r1/R1-01_정책_파일_실행.sql', 'r1/R1-02_수합_원본.sql', 'r1/R1-03_공개함수_Storage.sql'], ['R0']),
    ('R1S',   ['r1s/R1S-01_모델_쓰기게이트.sql', 'r1s/R1S-02_공개함수_권한.sql'],          ['R1']),
    ('P1',    ['p1/P1-01_학교관리_모델.sql', 'p1/P1-02_학교관리_공개함수.sql'],              ['R1']),
    ('P2',    ['p2/P2-01_일정일괄_협업_모델.sql', 'p2/P2-02_일정일괄_협업_공개함수.sql'],      ['P1']),
    ('P3',    ['p3/P3-01_메시지_알림_모델.sql', 'p3/P3-02_메시지_공개함수_Storage.sql'],     ['P2', 'R1']),
    ('P4',    ['p4/P4-01_자료_문서_모델.sql', 'p4/P4-02_자료_문서_공개함수_Storage.sql'],    ['P2', 'R1']),
    ('P5',    ['p5/P5-01_수업학생_모델.sql', 'p5/P5-02_수업학생_공개함수.sql'],             ['P1', 'P2']),
    ('P6',    ['p6/P6-01_비서_모델.sql', 'p6/P6-02_비서_공개함수.sql'],                    ['P2', 'P4', 'P5']),
    ('P7',    ['p7/P7-01_운영_전환_모델.sql', 'p7/P7-02_운영_전환_공개함수.sql'],           ['R1', 'P1', 'P2', 'P3']),
    ('P7-05', ['p7/P7-05_R1_P2_보강_별도승인.sql'],                                       ['P7']),
    # 8단계(정책 보강) — 파일마다 따로 설치할 수 있어 단계를 나눈다. P7-05 와 바꾸는 객체가 겹치지 않아 순서가 바뀌어도 목록은 같다(시험 II-P8 순서).
    ('P8-01', ['p8/P8-01_학년도_시작연도.sql'],                                           ['P1', 'P7']),
    ('P8-02', ['p8/P8-02_협업_알림.sql'],                                                ['P8-01', 'P2', 'P3']),
    ('P8-03', ['p8/P8-03_업무인계_관리자확인.sql'],                                      ['P8-01']),
    ('P8-04', ['p8/P8-04_수업_담당수강_변경.sql'],                                       ['P8-01', 'P5']),
]

# 점검 범위: workhub · workhub_private · workhub_storage 의 모든 함수와 public.workhub_* 함수, 그 스키마의 표에 걸린(또는 그 함수를 부르는) 트리거,
# 그 스키마 표의 제약, 이름이 workhub 로 시작하는 정책. 함수의 권한은 API 역할(PUBLIC · anon · authenticated · service_role) 실행 권한만 본다.
# exec = 함수 ACL 에 직접 적힌 부여, eff = 그 역할이 실제로 실행할 수 있는지(has_function_privilege — 다른 역할을 물려받아 생긴 권한까지).
# 직접 부여만 보면 "그룹 역할에 EXECUTE → anon 이 그 그룹의 구성원" 처럼 상속으로 열린 길을 놓친다.
CATALOG_SQL = r"""SELECT 'function' AS kind, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS key,
         jsonb_build_object('result', pg_get_function_result(p.oid), 'lang', l.lanname, 'secdef', p.prosecdef,
           'config', COALESCE(array_to_string(p.proconfig, ' '), ''),
           'exec', COALESCE((SELECT string_agg(g, ' ' ORDER BY g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS g
                      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                     WHERE a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role'))) x), ''),
           'eff', COALESCE((SELECT string_agg(r.rolname, ' ' ORDER BY r.rolname) FROM pg_roles r
                     WHERE r.rolname IN ('anon','authenticated','service_role') AND has_function_privilege(r.oid, p.oid, 'EXECUTE')), ''),
           'body', md5(replace(p.prosrc, chr(13), ''))) AS attrs,
         (SELECT rolname FROM pg_roles WHERE oid = p.proowner)::text AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_%')
  UNION ALL
  SELECT 'trigger', c.relnamespace::regnamespace::text || '.' || c.relname || '.' || t.tgname,
         jsonb_build_object('def', md5(pg_get_triggerdef(t.oid)), 'enabled', t.tgenabled::text), NULL
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc f ON f.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND (c.relnamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage')
                                 OR f.pronamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage'))
  UNION ALL
  SELECT 'constraint', c.relnamespace::regnamespace::text || '.' || c.relname || '.' || k.conname,
         jsonb_build_object('def', md5(pg_get_constraintdef(k.oid))), NULL
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE c.relnamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage')
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
         jsonb_build_object('def', md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))), NULL
    FROM pg_policies WHERE policyname LIKE 'workhub%' OR schemaname IN ('workhub','workhub_private','workhub_storage')"""

# 점검 범위 밖에 함수를 만드는 단계가 있으면 목록이 그 함수를 놓친다 → 만들 때 멈춘다.
OUTSIDE_SQL = r"""SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','workhub','workhub_private','workhub_storage')
     AND NOT (n.nspname = 'public' AND p.proname LIKE 'workhub\_%')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')"""


def conn():
    c = psycopg2.connect(host=HOST, port=PORT, dbname='r0', user='postgres'); c.autocommit = True; return c

def rows(sql):
    c = conn(); cur = c.cursor(); cur.execute(sql); r = cur.fetchall(); c.close(); return r

def snapshot():
    return {(k, key): json.dumps(a, sort_keys=True, ensure_ascii=False) for k, key, a, _ in rows(CATALOG_SQL)}

def fill_p705(text):
    return text.replace('"<승인한 사람(예: 계란)>"', '"manifest"').replace('"<승인 근거(날짜 · 대화 · 문서)>"', '"manifest 생성(시험 DB)"')

def apply(path):
    text = open(os.path.join(WH, path), encoding='utf-8').read()
    if path.endswith('P7-05_R1_P2_보강_별도승인.sql'): text = fill_p705(text)
    c = conn(); c.cursor().execute(text); c.close()

def build():
    manifest = []                      # (stage, kind, key, attrs | None)
    prev = snapshot()
    outside0 = set(r[0] for r in rows(OUTSIDE_SQL))
    for k, v in sorted(prev.items()): manifest.append(('R0', k[0], k[1], v))
    for stage, files, _ in STAGES[1:]:
        for f in files: apply(f)
        cur = snapshot()
        outside = set(r[0] for r in rows(OUTSIDE_SQL)) - outside0
        if outside: sys.exit(f'중단: {stage} 가 점검 범위 밖에 함수를 만들었습니다: {sorted(outside)}')
        for k in sorted(set(prev) | set(cur)):
            if prev.get(k) != cur.get(k): manifest.append((stage, k[0], k[1], cur.get(k)))
        prev = cur
    return manifest

def lit(s): return 'NULL' if s is None else "'" + s.replace("'", "''") + "'"

def render(manifest):
    tpl = open(os.path.join(HERE, 'INT-03.template.sql'), encoding='utf-8').read()
    counts = {}
    for st, kind, _, _ in manifest: counts[(st, kind)] = counts.get((st, kind), 0) + 1
    summary = ' · '.join(f"{st} {sum(v for (s, _), v in counts.items() if s == st)}" for st, _, _ in STAGES)
    values = ',\n'.join(f"  ({lit(st)}, {lit(kind)}, {lit(key)}, {lit(a)})" for st, kind, key, a in manifest)
    stages = ',\n'.join(f"  ({lit(st)}, {i}, {lit(' '.join(deps))})" for i, (st, _, deps) in enumerate(STAGES))
    return (tpl.replace('{{CATALOG}}', CATALOG_SQL).replace('{{MANIFEST}}', values).replace('{{STAGES}}', stages)
               .replace('{{SUMMARY}}', summary).replace('{{COUNT}}', str(len(manifest))))

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    out = render(build())
    if mode == 'write':
        open(OUTFILE, 'w', encoding='utf-8', newline='\n').write(out); print(f'INT-03 작성: 목록 {out.count(chr(10))} 줄')
    else:
        same = open(OUTFILE, encoding='utf-8').read() == out
        print(('PASS' if same else 'FAIL') + ' INT-03 의 단계별 예상 목록 = 지금 SQL 파일을 차례로 적용해 만든 목록(손으로 고친 곳 · 낡은 목록 없음)')
        if not same: open(OUTFILE + '.new', 'w', encoding='utf-8', newline='\n').write(out)
        sys.exit(0 if same else 1)
