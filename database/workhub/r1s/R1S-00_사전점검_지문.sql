-- ============================================================================
-- R1S-00  사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) R1S-01 실행 "전" 한 번, (2) R1S-03(사후 점검) 실행 "후" 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok·info 여야 R1S-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '변경'  R1S 가 의도적으로 바꾸는 것. 실행 전에는 "없음", 실행 후에는 "있음"이 정상이다(값이 달라지는 것이 정상).
--   kind = '지문'  R1S 가 건드리면 안 되는 것의 요약값. 실행 전·후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위
--   F1~F9  R1-00 과 같은 식 그대로(기존 public·auth·storage 구조·자료, R0 구조·자료). R1-00 결과와도 비교할 수 있다.
--   G1~G4  R1 이 만든 것: 표·열·제약·트리거(R1S 가 더하는 트리거 file_verification_jobs_not_basic 은 뺀다),
--          R1 함수 본문·설정·권한(R1S 가 교체하는 5개와 새 함수는 뺀다), R1 표의 행 수·행 해시, 수합 버킷·정책·실물 목록.
--          ※ R1S-01·02 는 기존 표에 행을 쓰지 않는다. R1S-04(활성화)는 R0 서비스 주체 표·정책 표에 쓰므로 비교는 R1S-03 까지.
-- ▣ 실제 운영 DB 에서는 두 번 실행하는 사이에 교사가 쓰면 '자료' 지문이 달라질 수 있다.
--   그때는 rows 수 변화가 그 사이 사용으로 설명되는지 보고, 구조 지문(F1~F7·G1·G2)은 반드시 같아야 한다.
-- ============================================================================
WITH
r0_tables(t) AS (VALUES ('workhub.academic_years'),('workhub.accounts'),('workhub.audience_conditions'),('workhub.audience_groups'),
  ('workhub.audience_members'),('workhub.audience_sets'),('workhub.audit_events'),('workhub.departments'),('workhub.event_revisions'),
  ('workhub.events'),('workhub.idempotency_receipts'),('workhub.membership_roles'),('workhub.memberships'),('workhub.outbox'),
  ('workhub.role_catalog'),('workhub.role_permissions'),('workhub.schools'),('workhub.service_principal_scopes'),
  ('workhub.service_principals'),('workhub.tasks'),('workhub.terms'),('workhub_private.db_identity_principals')),
r0_rel AS (SELECT to_regclass(t) AS oid, t FROM r0_tables),
r0_fn_names(n) AS (VALUES ('audience_json'),('audience_matches'),('bootstrap_first_school'),('caller_account'),('claim_receipt'),
  ('emit_outbox'),('event_dto'),('event_readable'),('forbid_change'),('forbid_identity_change'),('js_trim'),('legacy_gate'),
  ('lock_member_roles'),('member_actor'),('member_has_perm'),('member_relations'),('membership_not_self_decided'),
  ('membership_role_within'),('normalize_event_draft'),('normalize_task_input'),('receipt_result_shape'),('request_sha256'),
  ('resolve_service_actor'),('store_audience'),('store_receipt'),('string_array'),('task_dto'),('term_within_year'),('today_in'),('write_audit')),
r0_pub_names(n) AS (VALUES ('workhub_calendar_get'),('workhub_calendar_list'),('workhub_calendar_save'),('workhub_context'),
  ('workhub_task_get'),('workhub_task_list'),('workhub_task_mutate')),
r0_fns AS (
  SELECT p.oid FROM pg_proc p WHERE p.pronamespace = to_regnamespace('workhub_private') AND p.proname IN (SELECT n FROM r0_fn_names)
  UNION ALL
  SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT n FROM r0_pub_names)),
ns AS (SELECT oid FROM pg_namespace WHERE nspname IN ('public','auth','storage')),
r1_bucket AS (SELECT 'workhub-collection-files'::text AS id),
-- 저장소 정책이 다른 버킷으로 한정되어 있는지(R1-03 의 준비 상태 판정과 같은 규칙)
other_bucket AS (
  SELECT pol.polname, pol.polcmd,
         pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
    FROM pg_policy pol
   WHERE pol.polrelid = to_regclass('storage.objects') AND pol.polpermissive
     AND pol.polname NOT IN ('workhub_collection_insert','workhub_collection_select')
     AND (0::oid = ANY (pol.polroles) OR pol.polroles && ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')))),
open_policies AS (
  SELECT polname FROM other_bucket b
   WHERE EXISTS (SELECT 1 FROM (VALUES (CASE WHEN b.polcmd IN ('r','w','d','*') THEN COALESCE(b.q, '') END),
                                       (CASE WHEN b.polcmd = 'a' OR b.w IS NOT NULL THEN COALESCE(b.w, '') END)) x(e)
                  WHERE x.e IS NOT NULL AND NOT (
                        (x.e ~ '^\(bucket_id = ''[^'']*''::text\)$' OR x.e ~ '^\(\(bucket_id = ''[^'']*''::text\) AND ')
                    AND substring(x.e FROM '^\(+bucket_id = ''([^'']*)''::text\)') <> 'workhub-collection-files'))),
-- R1S 가 새로 만들거나 교체하는 것(G 지문에서 뺀다)
r1s_tables(t) AS (VALUES ('workhub_private.r1s_installs'),('workhub.file_check_profiles'),('workhub.basic_profile_activations'),
  ('workhub.basic_profile_activation_log'),('workhub.file_basic_checks'),('workhub.file_basic_leases')),
r1s_fn_names(n) AS (VALUES ('c_require'),('c_file_problem'),('c_parent_resolve'),('c_prepare'),('c_complete'),
  ('basic_activation_stamp'),('basic_activation_logged'),('file_basic_checks_guard'),('file_job_not_basic'),('file_basic_leases_guard'),
  ('c_r1s_ok'),('c_basic_principal_ok'),('c_basic_mode'),('c_basic_activation'),('c_basic_effective'),('c_basic_readiness'),
  ('c_basic_evidence_ok'),('c_file_read_problem'),('c_basic_member'),('c_basic_svc'),('c_basic_req_policy'),('c_basic_max'),
  ('c_basic_close'),('c_basic_claim'),('c_basic_finish'),
  ('workhub_collection_basic_readiness'),('workhub_file_basic_claim'),('workhub_file_basic_finish')),
-- R1 표 = workhub·workhub_private 의 표 중 R0 표·R1S 표가 아닌 것
r1_rel AS (
  SELECT c.oid, c.oid::regclass::text AS t FROM pg_class c
   WHERE c.relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('workhub','workhub_private')) AND c.relkind IN ('r','p')
     AND c.oid::regclass::text NOT IN (SELECT t FROM r0_tables) AND c.oid::regclass::text NOT IN (SELECT t FROM r1s_tables)),
-- R1 함수 = workhub·workhub_private·workhub_storage 함수와 public 의 workhub_collection_*·workhub_file_* 중 R0·R1S 이름이 아닌 것
r1_fns AS (
  SELECT p.oid FROM pg_proc p
   WHERE (p.pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('workhub','workhub_private','workhub_storage'))
          OR (p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%')))
     AND p.oid NOT IN (SELECT oid FROM r0_fns) AND p.proname NOT IN (SELECT n FROM r1s_fn_names)),
r1_md5(n, h) AS (VALUES ('c_require','37dfb2107998536798fd43e062bbacd2'),('c_file_problem','597290578af959aad58320da540b1148'),
  ('c_parent_resolve','8a3154bd345a29fd5112861f8a26ca39'),('c_prepare','5b90d273c1c8f56874abb6b6ece4faa6'),('c_complete','15216adbb3dc7bcd9125698e5c2a21c1')),
r1s_md5(n, h) AS (VALUES ('c_require','3011f8cc751a3793ff377c056cb93aca'),('c_file_problem','6a3270f2dfddc1010313576a1dda9727'),
  ('c_parent_resolve','e24ae043bfc4dfc2d4e57fe092e407f0'),('c_prepare','d26f5611162451865ac8c7f636a87bd7'),('c_complete','0bf16800aa43ec7d880984f77defb8b0')),
replaced AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h FROM pg_proc p
   WHERE p.pronamespace = to_regnamespace('workhub_private') AND p.proname IN (SELECT n FROM r1_md5)),
installs AS (
  SELECT CASE WHEN to_regclass('workhub_private.r1s_installs') IS NULL THEN NULL
              ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '', '' ORDER BY batch) AS v FROM workhub_private.r1s_installs', false, true, '')))[1]::text END AS v)
SELECT '점검' AS kind, 'P1 R0 적용(표 22·함수 37)' AS part,
       CASE WHEN (SELECT count(oid) FROM r0_rel) = 22 AND (SELECT count(*) FROM r0_fns) = 37 THEN 'ok' ELSE 'FAIL' END AS status,
       NULL::text AS fingerprint, (SELECT count(oid) FROM r0_rel) + (SELECT count(*) FROM r0_fns) AS items,
       'FAIL 이면 R0 가 덜 적용됐거나 바뀐 것. R0 를 다시 실행하지 말고 결과를 알려 주세요.' AS note
UNION ALL
SELECT '점검', 'P2 R0-03 학교 초기 설정',
       CASE WHEN to_regclass('workhub.schools') IS NULL THEN 'FAIL'
            WHEN (SELECT count(*) FROM workhub.schools WHERE status = 'active') = 1 THEN 'ok' ELSE 'FAIL' END,
       NULL, CASE WHEN to_regclass('workhub.schools') IS NULL THEN 0 ELSE (SELECT count(*) FROM workhub.schools WHERE status = 'active') END,
       '활성 학교가 정확히 1개여야 한다(대동여중).'
UNION ALL
SELECT '점검', 'P3 오늘이 든 학년도',
       CASE WHEN to_regclass('workhub.academic_years') IS NULL THEN 'FAIL'
            WHEN (SELECT count(*) FROM workhub.academic_years y JOIN workhub.schools s ON s.id = y.school_id AND s.status = 'active'
                   WHERE (now() AT TIME ZONE s.timezone)::date BETWEEN y.starts_on AND y.ends_on) = 1 THEN 'ok' ELSE 'WARN' END,
       NULL, NULL,
       'WARN 이면 설치는 되지만 수합 만들기가 NOT_READY(학년도 없음)로 거부된다.'
UNION ALL
SELECT '점검', 'P4 Storage 표·열',
       CASE WHEN to_regclass('storage.buckets') IS NOT NULL AND (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name IN ('id','bucket_id','name','owner','owner_id')) = 5
            THEN 'ok' ELSE 'FAIL' END, NULL, NULL,
       'storage.objects 에 id·bucket_id·name·owner·owner_id 가 있어야 한다.'
UNION ALL
SELECT '점검', 'P5 다른 버킷까지 여는 Storage 정책',
       CASE WHEN (SELECT count(*) FROM open_policies) = 0 THEN 'ok' ELSE 'WARN' END, NULL, (SELECT count(*) FROM open_policies),
       COALESCE('버킷을 한정하지 않은 정책: ' || (SELECT string_agg(polname, ', ' ORDER BY polname) FROM open_policies)
                || ' → R1 준비 상태가 storage_missing 이 된다(설치는 됨).', '기존 정책은 모두 다른 버킷으로 한정됨')
UNION ALL
SELECT '점검', 'P8 Storage 요청 종류 표식(storage.operation)',
       CASE WHEN to_regprocedure('storage.operation()') IS NOT NULL THEN 'ok' ELSE 'FAIL' END, NULL, NULL,
       'R1-03 의 Storage 정책이 서명 URL 발급을 막으려면 이 함수가 있는 Storage 판이어야 한다. 없으면 R1-03 이 시작 전에 멈춘다.'
UNION ALL
SELECT '점검', 'P6 R1 적용 단계', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.batch_installs') IS NULL THEN '미적용(R1-01 전)'
            ELSE 'R1 표 있음 — 적용된 묶음은 R1-04 결과에서 확인' END
UNION ALL
SELECT '점검', 'P7 수합 버킷', 'info', NULL, (SELECT count(*) FROM storage.buckets WHERE id IN (SELECT id FROM r1_bucket)),
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id IN (SELECT id FROM r1_bucket)) THEN '있음(R1-03 이 만든 것이어야 함)' ELSE '없음(R1-03 전)' END
-- ---------------------------------------------------------------- 지문: 기존 구조
UNION ALL
SELECT '지문', 'F1 기존구조: 표·열', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || COALESCE(array_to_string(c.relacl, ','), '') AS x
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relnamespace IN (SELECT oid FROM ns)
  UNION ALL
  SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '')
    FROM information_schema.columns WHERE table_schema IN ('public','auth','storage')) t
UNION ALL
SELECT '지문', 'F2 기존구조: 제약·트리거', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) AS x FROM pg_constraint WHERE connamespace IN (SELECT oid FROM ns)
  UNION ALL
  SELECT tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text || ':' || md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace IN (SELECT oid FROM ns))) t
UNION ALL
SELECT '지문', 'F3 기존구조: 함수(workhub_* 제외)', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || COALESCE(array_to_string(p.proconfig, ','), '') || ':'
         || COALESCE(array_to_string(p.proacl, ','), '') || ':' || p.prosecdef::text AS x
    FROM pg_proc p WHERE p.pronamespace IN (SELECT oid FROM ns) AND p.proname NOT LIKE 'workhub\_%') t
UNION ALL
SELECT '지문', 'F4 기존구조: 정책·스키마 권한', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT schemaname || '.' || tablename || ':' || policyname || ':' || cmd::text || ':' || array_to_string(roles, ',') || ':'
         || COALESCE(qual, '') || ':' || COALESCE(with_check, '') AS x
    FROM pg_policies WHERE schemaname IN ('public','auth','storage')
     AND NOT (schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('workhub_collection_insert','workhub_collection_select'))
  UNION ALL
  SELECT nspname || ':' || COALESCE(array_to_string(nspacl, ','), '') FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private')) t
-- ---------------------------------------------------------------- 지문: R0 구조
UNION ALL
SELECT '지문', 'F5 R0구조: 표·열·RLS·권한', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT r.t || ':' || c.relrowsecurity::text || ':' || COALESCE(array_to_string(c.relacl, ','), '') AS x FROM r0_rel r JOIN pg_class c ON c.oid = r.oid
  UNION ALL
  SELECT r.t || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
         || COALESCE(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attgenerated::text
    FROM r0_rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL
  SELECT 'actor_context.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a WHERE a.attrelid = to_regclass('workhub_private.actor_context') AND a.attnum > 0 AND NOT a.attisdropped) t
UNION ALL
SELECT '지문', 'F6 R0구조: 제약·트리거(작업 목록 CHECK 제외)', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT r.t || ':' || co.conname || ':' || pg_get_constraintdef(co.oid) AS x
    FROM r0_rel r JOIN pg_constraint co ON co.conrelid = r.oid WHERE co.conname <> 'service_principals_action_registry'
  UNION ALL
  SELECT r.t || ':' || tg.tgname || ':' || tg.tgenabled::text || ':' || md5(pg_get_triggerdef(tg.oid))
    FROM r0_rel r JOIN pg_trigger tg ON tg.tgrelid = r.oid WHERE NOT tg.tgisinternal) t
UNION ALL
SELECT '지문', 'F7 R0구조: 함수 37개', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT p.pronamespace::regnamespace::text || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':'
         || COALESCE(array_to_string(p.proconfig, ','), '') || ':' || COALESCE(array_to_string(p.proacl, ','), '') || ':' || p.prosecdef::text AS x
    FROM pg_proc p WHERE p.oid IN (SELECT oid FROM r0_fns)) t
-- ---------------------------------------------------------------- 지문: 자료
UNION ALL
SELECT '지문', 'F8 R0자료: ' || r.t, NULL,
       (xpath('/row/h/text()', query_to_xml(format('SELECT md5(COALESCE(string_agg(x::text, %L ORDER BY x::text), %L)) AS h FROM %s x', '|', '', r.t), false, true, '')))[1]::text,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', r.t), false, true, '')))[1]::text::bigint, NULL
  FROM r0_rel r WHERE r.oid IS NOT NULL
UNION ALL
SELECT '지문', 'F9 기존자료: ' || c.oid::regclass::text, NULL,
       (xpath('/row/h/text()', query_to_xml(format('SELECT md5(COALESCE(string_agg(x::text, %L ORDER BY x::text), %L)) AS h FROM %s x', '|', '', c.oid::regclass), false, true, '')))[1]::text,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', c.oid::regclass), false, true, '')))[1]::text::bigint, NULL
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
UNION ALL
SELECT '지문', 'F9 기존자료: auth.users(id 목록만)', NULL, md5(COALESCE(string_agg(id::text, '|' ORDER BY id), '')), count(*), NULL FROM auth.users
UNION ALL
SELECT '지문', 'F9 기존자료: storage.buckets(수합 버킷 제외)', NULL, md5(COALESCE(string_agg(b::text, '|' ORDER BY b.id), '')), count(*), NULL
  FROM storage.buckets b WHERE b.id NOT IN (SELECT id FROM r1_bucket)
UNION ALL
SELECT '지문', 'F9 기존자료: storage.objects(수합 버킷 제외, 목록 4열 — 본문 아님)', NULL,
       md5(COALESCE(string_agg(o.bucket_id || '/' || o.name || ':' || o.id::text || ':' || COALESCE(o.owner::text, ''), '|' ORDER BY o.bucket_id, o.name, o.id), '')), count(*), NULL
  FROM storage.objects o WHERE o.bucket_id NOT IN (SELECT id FROM r1_bucket)

-- ---------------------------------------------------------------- R1S 점검
UNION ALL
SELECT '점검', 'Q1 R1-01·02·03 적용(판 2026-10-15.1)',
       CASE WHEN to_regclass('workhub_private.batch_installs') IS NOT NULL
             AND (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM workhub_private.batch_installs WHERE batch IN (''R1-01'',''R1-02'',''R1-03'') AND release = ''2026-10-15.1''', false, true, '')))[1]::text = '3'
            THEN 'ok' ELSE 'FAIL' END, NULL, NULL, 'R1S 는 R1-01~03 위에만 올린다. R1-04 결과가 정상이어야 한다.'
UNION ALL
SELECT '점검', 'Q2 R1S 적용 단계', 'info', NULL, NULL, COALESCE((SELECT v FROM installs), '미적용(R1S-01 전)')
UNION ALL
SELECT '점검', 'Q3 교체 대상 함수 5개의 판',
       CASE WHEN (SELECT count(*) FROM replaced r JOIN r1_md5 x ON x.n = r.proname AND x.h = r.h) = 5 THEN 'ok'
            WHEN (SELECT count(*) FROM replaced r JOIN r1s_md5 x ON x.n = r.proname AND x.h = r.h) = 5 THEN 'ok'
            ELSE 'FAIL' END, NULL,
       (SELECT count(*) FROM replaced),
       CASE WHEN (SELECT count(*) FROM replaced r JOIN r1_md5 x ON x.n = r.proname AND x.h = r.h) = 5 THEN 'R1-03 원문(R1S-01 전)'
            WHEN (SELECT count(*) FROM replaced r JOIN r1s_md5 x ON x.n = r.proname AND x.h = r.h) = 5 THEN 'R1S 판(R1S-01 후)'
            ELSE '원문도 R1S 판도 아님 — 누가 바꿨는지 확인 전에는 진행하지 않는다' END
UNION ALL
SELECT '점검', 'Q4 R1 중지 스위치', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.r1_switch') IS NULL THEN '없음'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT state AS v FROM workhub_private.r1_switch', false, true, '')))[1]::text END
UNION ALL
SELECT '점검', 'Q5 검증 작업자 연결(R1-05)', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.api_role_principals') IS NULL THEN '없음'
            ELSE 'service_role 연결 ' || (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub_private.api_role_principals WHERE revoked_at IS NULL', false, true, '')))[1]::text
                 || '건 (0 이 정상 — R1-05 는 실행하지 않는다)' END
UNION ALL
SELECT '점검', 'Q6 게시된 정책(R1-06)', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub.policy_versions') IS NULL THEN '없음'
            ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(policy_key || '' v'' || policy_version || '' '' || (value ->> ''extensions'') || '' allowUnscanned='' || COALESCE(value ->> ''allowUnscanned'', ''-''), ''; '' ORDER BY policy_key) AS v FROM workhub.policy_versions WHERE state = ''published''', false, true, '')))[1]::text,
                          '없음 — R1S-04 에서 함께 게시할 수 있다') END
UNION ALL
SELECT '점검', 'Q7 검증 대기 파일(작업자 경로)', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub.file_verification_jobs') IS NULL THEN '없음'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub.file_verification_jobs WHERE state IN (''queued'',''leased'')', false, true, '')))[1]::text
                 || '건 — 기본 확인을 켜도 이 파일들은 작업자 경로로 남는다(설계결정 5절)' END
-- ---------------------------------------------------------------- R1S 가 의도적으로 바꾸는 것
UNION ALL
SELECT '변경', 'V1 R1S 새 표', 'info', NULL, (SELECT count(*) FROM r1s_tables WHERE to_regclass(t) IS NOT NULL),
       CASE WHEN (SELECT count(*) FROM r1s_tables WHERE to_regclass(t) IS NOT NULL) = 0 THEN '없음' ELSE '있음' END
UNION ALL
SELECT '변경', 'V2 서비스 주체 작업 목록 CHECK', 'info', NULL, NULL,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = to_regclass('workhub.service_principals') AND conname = 'service_principals_action_registry')
UNION ALL
SELECT '변경', 'V3 검증 작업 대기열 배타 트리거', 'info', NULL, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'file_verification_jobs_not_basic') THEN '있음' ELSE '없음' END
UNION ALL
SELECT '변경', 'V4 R1S 공개 함수', 'info', NULL,
       (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('workhub_collection_basic_readiness','workhub_file_basic_claim','workhub_file_basic_finish')),
       NULL
-- ---------------------------------------------------------------- 지문: R1 (R1S 가 건드리면 안 되는 것)
UNION ALL
SELECT '지문', 'G1 R1구조: 표·열·제약·트리거·RLS·권한', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT r.t || ':' || c.relrowsecurity::text || ':' || COALESCE(array_to_string(c.relacl, ','), '') AS x FROM r1_rel r JOIN pg_class c ON c.oid = r.oid
  UNION ALL
  SELECT r.t || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
         || COALESCE(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attgenerated::text
    FROM r1_rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL
  SELECT r.t || ':' || co.conname || ':' || pg_get_constraintdef(co.oid) FROM r1_rel r JOIN pg_constraint co ON co.conrelid = r.oid
  UNION ALL
  SELECT r.t || ':' || tg.tgname || ':' || tg.tgenabled::text || ':' || md5(pg_get_triggerdef(tg.oid))
    FROM r1_rel r JOIN pg_trigger tg ON tg.tgrelid = r.oid WHERE NOT tg.tgisinternal AND tg.tgname <> 'file_verification_jobs_not_basic'
  UNION ALL
  SELECT 'index:' || i.indexrelid::regclass::text || ':' || md5(pg_get_indexdef(i.indexrelid)) FROM r1_rel r JOIN pg_index i ON i.indrelid = r.oid) t
UNION ALL
SELECT '지문', 'G2 R1구조: 함수(교체 5개·R1S 새 함수 제외)', NULL, md5(string_agg(x, '|' ORDER BY x)), count(*), NULL FROM (
  SELECT p.pronamespace::regnamespace::text || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':'
         || COALESCE(array_to_string(p.proconfig, ','), '') || ':' || COALESCE(array_to_string(p.proacl, ','), '') || ':' || p.prosecdef::text AS x
    FROM pg_proc p WHERE p.oid IN (SELECT oid FROM r1_fns)) t
UNION ALL
SELECT '지문', 'G3 R1자료: ' || r.t, NULL,
       (xpath('/row/h/text()', query_to_xml(format('SELECT md5(COALESCE(string_agg(x::text, %L ORDER BY x::text), %L)) AS h FROM %s x', '|', '', r.t), false, true, '')))[1]::text,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', r.t), false, true, '')))[1]::text::bigint, NULL
  FROM r1_rel r
UNION ALL
SELECT '지문', 'G4 R1 Storage: 수합 버킷·정책 2개·실물 목록(4열)', NULL,
       md5(COALESCE((SELECT string_agg(b::text, '|') FROM storage.buckets b WHERE b.id IN (SELECT id FROM r1_bucket)), '') || '#'
           || COALESCE((SELECT string_agg(pol.polname || ':' || pol.polcmd::text || ':' || md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')), '|' ORDER BY pol.polname)
                          FROM pg_policy pol WHERE pol.polrelid = to_regclass('storage.objects') AND pol.polname IN ('workhub_collection_insert','workhub_collection_select')), '') || '#'
           || COALESCE((SELECT string_agg(o.name || ':' || o.id::text || ':' || COALESCE(o.owner::text, ''), '|' ORDER BY o.name, o.id)
                          FROM storage.objects o WHERE o.bucket_id IN (SELECT id FROM r1_bucket)), '')),
       (SELECT count(*) FROM storage.objects o WHERE o.bucket_id IN (SELECT id FROM r1_bucket)), NULL
ORDER BY 1, 2;
