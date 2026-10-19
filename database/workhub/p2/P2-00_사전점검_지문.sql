-- ============================================================================
-- P2-00  사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) P2-01 실행 "전" 한 번, (2) P2-03(사후 점검) 실행 "후" 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok·info 여야 P2-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '변경'  P2 가 의도적으로 바꾸는 것(새 표 수). 실행 전·후 값이 달라지는 것이 정상이다.
--   kind = '지문'  P2 가 건드리면 안 되는 것의 요약값. 실행 전·후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위 — public · auth · storage · workhub · workhub_private · workhub_storage 전체에서 P2 가 만드는 것만 뺀 나머지
--   S1 열 · S2 제약 · S3 트리거 · S4 함수 본문·설정·권한(P2 새 함수 제외) · S5 표 권한 · S6 RLS 정책
--   D1 기존 표 전부의 행 수·행 해시(P2 새 표 제외). P2-01·02 는 기존 표에 행을 쓰지 않는다(기존 함수·제약도 바꾸지 않는다).
--   ※ 실제 운영 DB 에서 두 번 실행하는 사이에 교사가 쓰면 D1 이 달라질 수 있다 — 그때는 S1~S6(구조)만 반드시 같아야 한다.
-- ============================================================================
WITH
sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private','workhub_storage')),
p2_tables(t) AS (VALUES ('workhub_private.p2_installs'),('workhub.module_activations'),('workhub.request_receipts'),
  ('workhub.calendar_import_sources'),('workhub.calendar_import_source_editors'),('workhub.calendar_import_rows'),
  ('workhub.calendar_import_prepares'),('workhub.calendar_import_batches'),('workhub.cooperation_requests'),
  ('workhub.cooperation_history'),('workhub.cooperation_task_links')),
p2_rel AS (SELECT to_regclass(t) AS oid FROM p2_tables WHERE to_regclass(t) IS NOT NULL),
rels AS (SELECT c.oid, c.relname, n.nspname FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND c.oid NOT IN (SELECT oid FROM p2_rel)),
fns AS (SELECT p.oid, p.proname, n.nspname FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
         WHERE NOT (p.proname LIKE 'p2\_%' OR p.proname LIKE 'workhub\_calendar\_batch\_%' OR p.proname LIKE 'workhub\_cooperation\_%')),
data AS (SELECT r.nspname || '.' || r.relname AS t,
                (xpath('/row/v/text()', query_to_xml(format(
                   'SELECT count(*) || '':'' || md5(COALESCE(string_agg(x::text, chr(10) ORDER BY x::text), '''')) AS v FROM %I.%I x', r.nspname, r.relname),
                   false, true, '')))[1]::text AS v
           FROM rels r JOIN pg_class c ON c.oid = r.oid WHERE c.relkind IN ('r','p'))
SELECT '점검' AS kind, 'C1 P1-01·02(2026-10-16.1) 적용' AS part,
       CASE WHEN to_regclass('workhub_private.p1_installs') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub_private.p1_installs WHERE batch IN (''P1-01'',''P1-02'') AND release = ''2026-10-16.1''', false, true, '')))[1]::text = '2'
            THEN 'ok' ELSE 'FAIL' END AS status, NULL::text AS fingerprint, NULL::bigint AS items,
       'FAIL 이면 P1(학교 관리)이 아직 적용되지 않은 것. P1 을 먼저 적용해 주세요.' AS note
UNION ALL
SELECT '점검', 'C2 PostgreSQL 15 이상', CASE WHEN current_setting('server_version_num')::integer >= 150000 THEN 'ok' ELSE 'FAIL' END,
       NULL, current_setting('server_version_num')::bigint, 'P2 는 regexp_count(PG15+)를 쓴다'
UNION ALL
SELECT '점검', 'C3 P2 적용 단계', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.p2_installs') IS NULL THEN '미적용(P2-01 전)'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '', '' ORDER BY batch) AS v FROM workhub_private.p2_installs', false, true, '')))[1]::text END
UNION ALL
SELECT '변경', 'V1 P2 새 표', 'info', NULL, (SELECT count(*) FROM p2_rel), '전 0 / 후 11'
UNION ALL
SELECT '지문', 'S1 열', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                     || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), chr(10) ORDER BY r.nspname, r.relname, a.attnum)
                     FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                     LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum), '')),
       (SELECT count(*) FROM rels), '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S2 제약', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), chr(10) ORDER BY r.nspname, r.relname, k.conname)
                     FROM rels r JOIN pg_constraint k ON k.conrelid = r.oid), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S3 트리거', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || g.tgname || ':' || pg_get_triggerdef(g.oid), chr(10) ORDER BY r.nspname, r.relname, g.tgname)
                     FROM rels r JOIN pg_trigger g ON g.tgrelid = r.oid AND NOT g.tgisinternal), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S4 함수(P2 새 함수 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(f.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):'
                     || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef || ':' || COALESCE(array_to_string(p.proconfig, ','), '')
                     || ':' || COALESCE(array_to_string(p.proacl, ','), ''), chr(10) ORDER BY f.nspname, f.proname, pg_get_function_identity_arguments(p.oid))
                     FROM fns f JOIN pg_proc p ON p.oid = f.oid), '')),
       (SELECT count(*) FROM fns), '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S5 표 권한', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || ':' || COALESCE(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity, chr(10) ORDER BY r.nspname, r.relname)
                     FROM rels r JOIN pg_class c ON c.oid = r.oid), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S6 RLS 정책', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || pol.polname || ':' || pol.polcmd::text || ':' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
                     || ':' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), chr(10) ORDER BY r.nspname, r.relname, pol.polname)
                     FROM rels r JOIN pg_policy pol ON pol.polrelid = r.oid), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'D1 기존 표 행 수·행 해시', 'ok',
       md5(COALESCE((SELECT string_agg(t || '=' || v, chr(10) ORDER BY t) FROM data), '')),
       (SELECT count(*) FROM data), '실행 전·후 같아야 한다(그사이 사용이 있었다면 달라질 수 있음 — 위 머리말)'
ORDER BY 1 DESC, 2;
