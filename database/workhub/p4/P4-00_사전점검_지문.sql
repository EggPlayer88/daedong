-- ============================================================================
-- P4-00  사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) P4-01 실행 "전" 한 번, (2) P4-03(사후 점검) 실행 "후" 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok·info 여야 P4-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '변경'  P4 가 의도적으로 바꾸는 것(새 표·버킷·Storage 정책 수). 실행 전·후 값이 달라지는 것이 정상이다.
--   kind = '지문'  P4 가 건드리면 안 되는 것의 요약값. 실행 전·후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위 — public · auth · storage · workhub · workhub_private · workhub_storage 전체에서 P4 가 만드는 것만 뺀 나머지
--   S1 열 · S2 제약 · S3 트리거 · S4 함수 본문·설정·권한(P4 새 함수 제외) · S5 표 권한 · S6 RLS 정책(P4 Storage 정책 4개 제외)
--   D1 기존 표 전부의 행 수·행 해시(P4 새 표 제외, storage.buckets 는 새 버킷 2행만 제외).
--   P4-01·02 는 기존 표에 행을 쓰지 않는다(버킷 2행 추가만). 수합·메시지 버킷과 R1·R1S·P3 Storage 정책도 그대로다.
--   ※ 실제 운영 DB 에서 두 번 실행하는 사이에 교사가 쓰면 D1 이 달라질 수 있다 — 그때는 S1~S6(구조)만 반드시 같아야 한다.
-- ============================================================================
WITH
sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private','workhub_storage')),
p4_tables(t) AS (VALUES ('workhub_private.p4_installs'),('workhub_private.p4_storage_policies'),('workhub.document_policies'),
  ('workhub.knowledge_import_policies'),('workhub.guided_policies'),('workhub.content_requests'),('workhub.knowledge_files'),
  ('workhub.knowledge_file_leases'),('workhub.knowledge_extractions'),('workhub.knowledge_sources'),('workhub.knowledge_source_revisions'),
  ('workhub.documents'),('workhub.document_versions'),('workhub.guided_templates'),('workhub.guided_template_versions'),('workhub.guided_responses'),
  ('workhub.guided_response_versions'),('workhub.guided_operations'),('workhub.guided_leases'),('workhub.guided_artifacts')),
p4_rel AS (SELECT to_regclass(t) AS oid FROM p4_tables WHERE to_regclass(t) IS NOT NULL),
rels AS (SELECT c.oid, c.relname, n.nspname FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND c.oid NOT IN (SELECT oid FROM p4_rel)),
fns AS (SELECT p.oid, p.proname, n.nspname FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
         WHERE NOT (p.proname LIKE 'p4\_%' OR (n.nspname = 'public' AND (p.proname LIKE 'workhub\_knowledge\_%' OR p.proname LIKE 'workhub\_document\_%'
                                                                        OR p.proname LIKE 'workhub\_template\_%'))
                    OR (n.nspname = 'workhub_storage' AND p.proname IN ('knowledge_insertable','knowledge_readable','document_insertable','document_readable')))),
data AS (SELECT r.nspname || '.' || r.relname AS t,
                (xpath('/row/v/text()', query_to_xml(format(
                   'SELECT count(*) || '':'' || md5(COALESCE(string_agg(x::text, chr(10) ORDER BY x::text), '''')) AS v FROM %I.%I x%s', r.nspname, r.relname,
                   CASE WHEN r.nspname = 'storage' AND r.relname = 'buckets' THEN ' WHERE x.id NOT IN (''workhub-knowledge-files'',''workhub-document-files'')' ELSE '' END),
                   false, true, '')))[1]::text AS v
           FROM rels r JOIN pg_class c ON c.oid = r.oid WHERE c.relkind IN ('r','p'))
SELECT '점검' AS kind, 'C1 P2-01·02(2026-10-16.1) 적용' AS part,
       CASE WHEN to_regclass('workhub_private.p2_installs') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub_private.p2_installs WHERE batch IN (''P2-01'',''P2-02'') AND release = ''2026-10-16.1''', false, true, '')))[1]::text = '2'
            THEN 'ok' ELSE 'FAIL' END AS status, NULL::text AS fingerprint, NULL::bigint AS items,
       'FAIL 이면 P2(일정 일괄·협업)가 아직 적용되지 않은 것. P2 를 먼저 적용해 주세요(P4 는 P3 없이도 된다).' AS note
UNION ALL
SELECT '점검', 'C2 R1-03 Storage 판정 함수', CASE WHEN to_regprocedure('workhub_private.c_object_owner(text,text)') IS NOT NULL
             AND to_regprocedure('workhub_private.c_storage_op()') IS NOT NULL THEN 'ok' ELSE 'FAIL' END, NULL, NULL, 'R1-02·03(수합·Storage 판정)이 적용되어 있어야 한다'
UNION ALL
SELECT '점검', 'C3 storage.objects RLS 켜짐', CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN 'ok' ELSE 'FAIL' END,
       NULL, NULL, 'FAIL 이면 Storage 설정을 먼저 확인'
UNION ALL
SELECT '점검', 'C4 PostgreSQL 15 이상', CASE WHEN current_setting('server_version_num')::integer >= 150000 THEN 'ok' ELSE 'FAIL' END,
       NULL, current_setting('server_version_num')::bigint, 'P2 의 regexp_count(PG15+)를 쓴다'
UNION ALL
SELECT '점검', 'C5 P4 적용 단계', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.p4_installs') IS NULL THEN '미적용(P4-01 전)'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '', '' ORDER BY batch) AS v FROM workhub_private.p4_installs', false, true, '')))[1]::text END
UNION ALL
SELECT '점검', 'C6 같은 이름 버킷·정책 없음(P4-01 전)', CASE WHEN to_regclass('workhub_private.p4_installs') IS NOT NULL
             OR (NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('workhub-knowledge-files','workhub-document-files'))
                 AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
                                   AND (polname LIKE 'workhub\_knowledge%' OR polname LIKE 'workhub\_document%'))) THEN 'ok' ELSE 'FAIL' END,
       NULL, NULL, 'FAIL 이면 누가 만든 버킷·정책인지 먼저 확인(P4-02 가 멈춘다)'
UNION ALL
SELECT '변경', 'V1 P4 새 표', 'info', NULL, (SELECT count(*) FROM p4_rel), '전 0 / 후 20'
UNION ALL
SELECT '변경', 'V2 버킷 workhub-knowledge-files · workhub-document-files', 'info', NULL,
       (SELECT count(*) FROM storage.buckets WHERE id IN ('workhub-knowledge-files','workhub-document-files')), '전 0 / 후 2(비공개)'
UNION ALL
SELECT '변경', 'V3 Storage 정책 workhub_knowledge_files_* · workhub_document_files_*', 'info', NULL,
       (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
         AND (polname LIKE 'workhub\_knowledge\_files\_%' OR polname LIKE 'workhub\_document\_files\_%')), '전 0 / 후 4'
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
SELECT '지문', 'S4 함수(P4 새 함수 제외)', 'ok',
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
SELECT '지문', 'S6 RLS 정책(P4 Storage 정책 4개 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || pol.polname || ':' || pol.polcmd::text || ':' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
                     || ':' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), chr(10) ORDER BY r.nspname, r.relname, pol.polname)
                     FROM rels r JOIN pg_policy pol ON pol.polrelid = r.oid
                    WHERE NOT (r.nspname = 'storage' AND r.relname = 'objects' AND (pol.polname LIKE 'workhub\_knowledge\_files\_%' OR pol.polname LIKE 'workhub\_document\_files\_%'))), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'D1 기존 표 행 수·행 해시', 'ok',
       md5(COALESCE((SELECT string_agg(t || '=' || v, chr(10) ORDER BY t) FROM data), '')),
       (SELECT count(*) FROM data), '실행 전·후 같아야 한다(그사이 사용이 있었다면 달라질 수 있음 — 위 머리말)'
ORDER BY 1 DESC, 2;
