-- ============================================================================
-- R1-00  사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) R1-01 실행 "전" 한 번, (2) R1-04(사후 점검) 실행 "후" 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태를 보여 준다. 실행 전에는 status 가 모두 ok 또는 info 여야 R1-01 로 넘어간다.
--                  FAIL 이 있으면 멈추고 그 행의 note 를 알려 주세요. WARN 은 진행은 되지만 확인이 필요한 것.
--   kind = '지문'  R1 이 건드리면 안 되는 것의 요약값. 실행 전·후 두 결과의 '지문' 행이 모두 같아야 한다.
--                  (점검 행은 단계에 따라 달라지는 것이 정상이다.)
-- ▣ 지문 범위
--   기존구조   public·auth·storage 의 표·열·제약·함수·트리거·정책·권한 (R1 이 새로 만드는 public.workhub_collection_*·
--              workhub_file_* 함수, storage 정책 workhub_collection_insert·select 는 빼고 본다)
--   R0구조     R0 표 22개의 열·제약·트리거·RLS·권한, R0 함수 37개의 본문·설정·권한, actor_context 형
--              (R0 작업 목록 CHECK service_principals_action_registry 는 R1-01 이 의도적으로 넓히므로 뺀다 — 설계결정 참고)
--   R0자료     R0 표 22개의 행 수·행 해시 (R1-01~04 는 R0 자료를 쓰지 않는다. R1-05·06 은 쓴다 → 비교는 R1-04 까지)
--   기존자료   public 의 모든 표 행 수·행 해시, auth.users 의 id 목록, storage 의 다른 버킷 행·파일 목록
--              ※ 범위의 한계: auth 는 id 만, storage.objects 는 버킷·경로·객체 ID·owner 네 열만 본다.
--                 파일 본문 바이트·비밀번호·세션 같은 나머지 열은 지문에 없다 → "같음"은 그 범위에서만의 증거다.
--                 파일 본문 보존은 실행안내 7번(기존 파일 1개 내려받아 열기)으로 따로 확인한다.
-- ▣ 실제 운영 DB 에서는 두 번 실행하는 사이에 교사가 가입·제출·로그인하면 '자료' 지문이 달라질 수 있다.
--   그때는 rows 수 변화가 그 사이 사용으로 설명되는지 보고, 구조 지문(기존구조·R0구조)은 반드시 같아야 한다.
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
                    AND substring(x.e FROM '^\(+bucket_id = ''([^'']*)''::text\)') <> 'workhub-collection-files')))
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
ORDER BY 1, 2;
