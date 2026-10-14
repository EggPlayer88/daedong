-- =====================================================================
-- R0-90 되돌림 (R0-01 ~ R0-03 전체 제거)
--   실행: Supabase SQL Editor (역할 postgres).
--   지우는 것: public.workhub_* 호환 함수 7개, workhub · workhub_private 스키마 전체.
--   지우지 않는 것: public 의 기존 표·함수·정책·자료 (R0 는 이것들을 바꾸지 않았다),
--                  btree_gist 확장 (다른 곳에서 쓸 수 있어 남긴다).
--   주의: workhub 에 쌓인 일정·업무·감사 기록도 함께 사라진다. 되돌릴 수 없다.
--         [1단계] 결과를 저장해 둔 뒤 [2단계]를 실행한다.
-- =====================================================================

-- [1단계] 읽기 전용 — 지워질 자료 규모 확인
SELECT c.relname AS table_name, c.reltuples::bigint AS approx_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'workhub' AND c.relkind = 'r'
 ORDER BY 1;

-- [2단계] 제거 — 한 트랜잭션. 중간에 실패하면 아무것도 지워지지 않는다.
BEGIN;
DROP FUNCTION IF EXISTS public.workhub_context();
DROP FUNCTION IF EXISTS public.workhub_calendar_list(text);
DROP FUNCTION IF EXISTS public.workhub_calendar_get(text, text);
DROP FUNCTION IF EXISTS public.workhub_calendar_save(text, jsonb);
DROP FUNCTION IF EXISTS public.workhub_task_list(text);
DROP FUNCTION IF EXISTS public.workhub_task_get(text, text);
DROP FUNCTION IF EXISTS public.workhub_task_mutate(text, jsonb, text);
DROP SCHEMA IF EXISTS workhub CASCADE;
DROP SCHEMA IF EXISTS workhub_private CASCADE;

-- 남은 것이 없는지 확인. 남아 있으면 ROLLBACK 된다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('workhub','workhub_private')) THEN
    RAISE EXCEPTION 'R0-90: workhub 스키마가 남아 있습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'workhub\_%') THEN
    RAISE EXCEPTION 'R0-90: public.workhub_* 함수가 남아 있습니다.';
  END IF;
END $$;
COMMIT;

-- [3단계] 읽기 전용 — 확인 (모두 true)
SELECT NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('workhub','workhub_private')) AS schemas_gone,
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname LIKE 'workhub\_%')           AS functions_gone,
       (SELECT count(*) FROM public.users) > 0                                             AS legacy_users_intact;
