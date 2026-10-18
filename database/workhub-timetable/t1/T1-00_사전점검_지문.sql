-- ============================================================================
-- T1-00  시간표 1단계(T1) 사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) T1-01 실행 "전" 한 번, (2) T1-03 과 T1-04(사후 점검) 뒤 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok · info 여야 T1-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '지문'  T1 이 건드리면 안 되는 것의 요약값. 실행 전 · 후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위 — public · auth · storage · workhub · workhub_private · workhub_storage 전체에서 T1 이 의도적으로 만들거나 바꾸는 것만 뺀 나머지
--   S1 열 · S2 제약 · S3 트리거 · S4 함수 본문 · 설정 · 권한 · S5 표 권한 · S6 RLS 정책 · D1 기존 표 전부의 행 수 · 행 해시.
--   T1 이 바꾸는 것(지문에서 빼고 T1-04 가 대조하는 것)
--     제약 2개(같은 자리): workhub.terms 의 terms_timetable_basis_pending(R0, T1-02 가 지움) → terms_timetable_basis_fkey(T1-02 가 붙임)
--     새로 만드는 것: 표 workhub_private.t1_installs · workhub.timetable_* 11개, 함수 workhub_private.t1_* · public.workhub_timetable_* 7개
--   T1-01~03 은 기존 표에 행을 쓰지 않는다(학기 행도 그대로). 켜기(T1-05)는 module_activations 1행 + 감사 1건을 쓴다.
--   ※ 실제 운영 DB 에서 두 번 실행하는 사이에 교사가 쓰면 D1 이 달라질 수 있다 — 그때는 S1~S6(구조)만 반드시 같아야 한다.
-- ============================================================================
WITH
sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private','workhub_storage')),
t1_rel AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE (n.nspname = 'workhub_private' AND c.relname = 't1_installs') OR (n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%')),
t1_con(n) AS (VALUES ('terms_timetable_basis_pending'),('terms_timetable_basis_fkey')),
rels AS (SELECT c.oid, c.relname, n.nspname FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND c.oid NOT IN (SELECT oid FROM t1_rel)),
fns AS (SELECT p.oid, p.proname, n.nspname FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
         WHERE NOT ((n.nspname = 'workhub_private' AND p.proname LIKE 't1\_%') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_timetable\_%'))),
data AS (SELECT r.nspname || '.' || r.relname AS t,
                (xpath('/row/v/text()', query_to_xml(format(
                   'SELECT count(*) || '':'' || md5(COALESCE(string_agg(x::text, chr(10) ORDER BY x::text), '''')) AS v FROM %I.%I x', r.nspname, r.relname),
                   false, true, '')))[1]::text AS v
           FROM rels r JOIN pg_class c ON c.oid = r.oid WHERE c.relkind IN ('r','p')),
installs(stage, tbl, batches, release) AS (VALUES
  ('P1', 'workhub_private.p1_installs', ARRAY['P1-01','P1-02'], '2026-10-16.1'),
  ('P2', 'workhub_private.p2_installs', ARRAY['P2-01','P2-02'], '2026-10-16.1'),
  ('P5', 'workhub_private.p5_installs', ARRAY['P5-01','P5-02'], '2026-10-16.1'),
  ('P7', 'workhub_private.p7_installs', ARRAY['P7-01','P7-02'], '2026-10-16.1'),
  ('P8', 'workhub_private.p8_installs', ARRAY['P8-01','P8-04'], '2026-10-16.1')),
inst AS (SELECT stage, to_regclass(tbl) IS NOT NULL
                AND (xpath('/row/v/text()', query_to_xml(format('SELECT count(*) AS v FROM %s WHERE batch = ANY (%L) AND release = %L', tbl, batches, release),
                                                         false, true, '')))[1]::text::int = cardinality(batches) AS ok
           FROM installs),
t1 AS (SELECT CASE WHEN to_regclass('workhub_private.t1_installs') IS NULL THEN ''
                   ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch, '','' ORDER BY batch) AS v FROM workhub_private.t1_installs', false, true, '')))[1]::text
              END AS done),
tc AS (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname IN (SELECT n FROM t1_con))
SELECT '점검' AS kind, 'C1 P1 · P2 · P5 · P7 · P8-01 · P8-04(2026-10-16.1) 적용' AS part,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'FAIL' END AS status, NULL::text AS fingerprint, NULL::bigint AS items,
       COALESCE('없음: ' || string_agg(stage, ' · ') FILTER (WHERE NOT ok),
                'T1 은 수업(P5) · 담당/수강 변경(P8-04) · 학교 구성(P1) · 모듈 켜기(P2) · 요청 검사 도구(P7)를 쓴다') AS note
  FROM inst
UNION ALL
SELECT '점검', 'C2 T1 적용 단계', 'info', NULL, NULL, CASE WHEN (SELECT done FROM t1) = '' THEN '미적용(T1-01 전)' ELSE (SELECT done FROM t1) END
UNION ALL
SELECT '점검', 'C3 학기 기준판 칸 제약(T1-02 전 = R0 원본 CHECK, 뒤 = 복합 FK)',
       CASE WHEN position('T1-02' IN (SELECT done FROM t1)) > 0
              THEN CASE WHEN (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_fkey')
                               = 'FOREIGN KEY (school_id, current_timetable_basis_id, id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id)'
                         AND NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_pending') THEN 'ok' ELSE 'FAIL' END
            WHEN (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_pending') = 'CHECK ((current_timetable_basis_id IS NULL))'
             AND NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_fkey') THEN 'ok' ELSE 'FAIL' END,
       NULL, NULL, COALESCE((SELECT string_agg(conname || ': ' || def, ' / ' ORDER BY conname) FROM tc), '(둘 다 없음)')
UNION ALL
SELECT '점검', 'C4 학기 기준판 칸이 모두 비어 있음(T1-02 전)',
       CASE WHEN position('T1-02' IN (SELECT done FROM t1)) > 0 OR NOT EXISTS (SELECT 1 FROM workhub.terms WHERE current_timetable_basis_id IS NOT NULL)
            THEN 'ok' ELSE 'FAIL' END, NULL, (SELECT count(*) FROM workhub.terms), 'FAIL 이면 T1-02 가 멈춘다 — R0 CHECK 를 누가 우회했는지 먼저 확인'
UNION ALL
SELECT '점검', 'C5 같은 이름 표 · 함수 없음(T1-01 전)',
       CASE WHEN (SELECT done FROM t1) <> '' OR (
              NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%')
              AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 't1\_%' OR proname LIKE 'workhub\_timetable\_%'))
            THEN 'ok' ELSE 'FAIL' END, NULL, NULL, 'FAIL 이면 누가 만든 표 · 함수인지 먼저 확인(T1-01 이 멈춘다)'
UNION ALL
SELECT '점검', 'C6 켜진 시간표 모듈', 'info', NULL,
       (SELECT count(*) FROM workhub.module_activations WHERE module = 'timetable'),
       COALESCE((SELECT string_agg(s.code || ':' || a.state, ', ' ORDER BY s.code) FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
                  WHERE a.module = 'timetable'), '(없음 — 켜기는 T1-05, 입력 화면 배포 뒤)')
UNION ALL
SELECT '지문', 'S1 열', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                     || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), chr(10) ORDER BY r.nspname, r.relname, a.attnum)
                     FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                     LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum), '')),
       (SELECT count(*) FROM rels), '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S2 제약(T1-02 가 바꾸는 학기 제약 자리 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), chr(10) ORDER BY r.nspname, r.relname, k.conname)
                     FROM rels r JOIN pg_constraint k ON k.conrelid = r.oid WHERE k.conname NOT IN (SELECT n FROM t1_con)), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S3 트리거(정의 · 켜짐 상태 — 꺼 둔 보호 트리거도 다르게 나온다)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || g.tgname || ':' || pg_get_triggerdef(g.oid) || ':' || g.tgenabled::text, chr(10) ORDER BY r.nspname, r.relname, g.tgname)
                     FROM rels r JOIN pg_trigger g ON g.tgrelid = r.oid AND NOT g.tgisinternal), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S4 함수(T1 새 함수 제외 — 기존 함수는 하나도 바꾸지 않는다)', 'ok',
       md5(COALESCE((SELECT string_agg(f.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):'
                     || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef || ':' || COALESCE(array_to_string(p.proconfig, ','), '')
                     || ':' || COALESCE(array_to_string(p.proacl, ','), ''), chr(10) ORDER BY f.nspname, f.proname, pg_get_function_identity_arguments(p.oid))
                     FROM fns f JOIN pg_proc p ON p.oid = f.oid), '')),
       (SELECT count(*) FROM fns), '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S5 표 권한', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || ':' || COALESCE(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity, chr(10) ORDER BY r.nspname, r.relname)
                     FROM rels r JOIN pg_class c ON c.oid = r.oid), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S6 RLS 정책', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || pol.polname || ':' || pol.polcmd::text || ':' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
                     || ':' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), chr(10) ORDER BY r.nspname, r.relname, pol.polname)
                     FROM rels r JOIN pg_policy pol ON pol.polrelid = r.oid), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'D1 기존 표 행 수 · 행 해시', 'ok',
       md5(COALESCE((SELECT string_agg(t || '=' || v, chr(10) ORDER BY t) FROM data), '')),
       (SELECT count(*) FROM data), '실행 전 · 후 같아야 한다(그사이 사용이 있었다면 달라질 수 있음 — 위 머리말)'
ORDER BY 1 DESC, 2;
