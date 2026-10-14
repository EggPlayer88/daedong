-- =====================================================================
-- R0-00 기존 구조 지문 (읽기 전용)
--   R0-01 실행 "전"과 R0-03 실행 "후"에 한 번씩 실행해, 두 결과의 fingerprint 가 모두 같은지 본다.
--   같으면 기존 public · auth · storage 의 표·열·제약·함수·(사용자 작성)트리거·정책·권한이 바뀌지 않은 것이다.
--   범위 밖(지문이 같아도 보장하지 않는 것):
--   - PostgreSQL 내부 트리거(tgisinternal). R0 의 accounts.auth_user_id → auth.users FK(ON DELETE RESTRICT)는
--     auth.users 에 내부 참조 무결성 트리거를 더하고, 연결된 Auth 계정의 삭제를 막는다(의도한 변화, 설계결정 J8).
--   - 자료 값. 행 수(rows)만 참고로 보이며, 그 사이 교사가 가입·제출하면 바뀔 수 있다.
--   (public.workhub_* 호환 함수 7개는 R0 가 새로 만드는 것이라 지문에서 뺀다.)
-- =====================================================================
WITH ns AS (SELECT oid FROM pg_namespace WHERE nspname IN ('public','auth','storage'))
SELECT 'tables' AS part, md5(string_agg(x, '|' ORDER BY x)) AS fingerprint, count(*) AS items FROM (
  SELECT n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(array_to_string(c.relacl, ','), '') AS x
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relnamespace IN (SELECT oid FROM ns)) t
UNION ALL
SELECT 'columns', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
  FROM information_schema.columns WHERE table_schema IN ('public','auth','storage')) t
UNION ALL
SELECT 'constraints', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) AS x
  FROM pg_constraint WHERE connamespace IN (SELECT oid FROM ns)) t
UNION ALL
SELECT 'functions', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') || ':' || p.prosecdef::text AS x
  FROM pg_proc p WHERE p.pronamespace IN (SELECT oid FROM ns) AND p.prokind = 'f' AND p.proname NOT LIKE 'workhub\_%') t
UNION ALL
SELECT 'triggers', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text || ':' || md5(pg_get_triggerdef(oid)) AS x
  FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace IN (SELECT oid FROM ns))) t
UNION ALL
SELECT 'policies', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT schemaname || '.' || tablename || ':' || policyname || ':' || cmd::text || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') AS x
  FROM pg_policies WHERE schemaname IN ('public','auth','storage')) t
UNION ALL
SELECT 'schema_acl', md5(string_agg(x, '|' ORDER BY x)), count(*) FROM (
  SELECT nspname || ':' || coalesce(array_to_string(nspacl, ','), '') AS x FROM pg_namespace WHERE nspname IN ('public','auth','storage')) t
UNION ALL
SELECT 'rows: public.users', NULL, (SELECT count(*) FROM public.users)
UNION ALL
SELECT 'rows: auth.users', NULL, (SELECT count(*) FROM auth.users)
ORDER BY 1;
