-- =====================================================================
-- R0-90 되돌림 (R0-01 ~ R0-03 전체 제거)
--   실행: Supabase SQL Editor (역할 postgres).
--   지우는 것: public.workhub_* 호환 함수 7개, workhub · workhub_private 스키마 전체.
--   지우지 않는 것: public 의 기존 표·함수·정책·자료 (R0 는 이것들을 바꾸지 않았다),
--                  btree_gist 확장 (다른 곳에서 쓸 수 있어 남긴다).
--   주의: 이것은 '자료를 보존하는 복원' 이 아니라 '업무실을 통째로 지우는 되돌림' 이다.
--         workhub 에 쌓인 일정·업무·감사 기록도 함께 사라지고, 되돌릴 수 없다.
--         [1단계] 결과를 저장해 둔 뒤 [2단계]를 실행한다.
--   R0 전용: 후속 배치(교사 연결·수합 등)를 실행한 뒤에는 이 파일을 쓰지 않는다.
--         DROP SCHEMA ... CASCADE 는 다른 스키마에 생긴 종속 객체까지 지울 수 있으므로,
--         그때는 그 배치 전용 되돌림 절차를 따로 만든다.
-- =====================================================================

-- [1단계] 읽기 전용 — 지워질 자료 규모 확인
SELECT c.relname AS table_name, c.reltuples::bigint AS approx_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'workhub' AND c.relkind = 'r'
 ORDER BY 1;

-- [2단계] 제거 — 한 트랜잭션. 중간에 실패하면 아무것도 지워지지 않는다.
BEGIN;
-- R0 전용 안전장치: 후속 배치가 만든 것이 하나라도 있으면 지우기 전에 멈춘다(CASCADE 로 함께 사라지지 않게).
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('workhub','workhub_private') AND c.relkind IN ('r','p','v','m','f')
     AND (n.nspname || '.' || c.relname) NOT IN (
       'workhub.schools','workhub.accounts','workhub.service_principals','workhub.service_principal_scopes',
       'workhub.departments','workhub.role_catalog','workhub.role_permissions','workhub.memberships',
       'workhub.membership_roles','workhub.academic_years','workhub.terms','workhub.idempotency_receipts',
       'workhub.audit_events','workhub.outbox','workhub.audience_sets','workhub.audience_groups',
       'workhub.audience_conditions','workhub.audience_members','workhub.events','workhub.event_revisions',
       'workhub.tasks','workhub_private.db_identity_principals');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'R0-90 중단: R0 이후에 생긴 표가 있습니다(%). 이 파일은 R0 전용입니다. 해당 배치의 되돌림 절차를 쓰세요.', v;
  END IF;
  -- 다른 스키마의 객체가 업무실 표·함수를 참조(FK·뷰·함수 등)하면 CASCADE 가 그것까지 지운다 → 멈춘다
  SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO v
    FROM pg_depend d
    JOIN pg_namespace rn ON rn.oid = CASE d.refclassid
           WHEN 'pg_class'::regclass THEN (SELECT relnamespace FROM pg_class WHERE oid = d.refobjid)
           WHEN 'pg_proc'::regclass  THEN (SELECT pronamespace FROM pg_proc  WHERE oid = d.refobjid)
           WHEN 'pg_type'::regclass  THEN (SELECT typnamespace FROM pg_type  WHERE oid = d.refobjid) END
    JOIN pg_namespace dn ON dn.oid = CASE d.classid
           WHEN 'pg_class'::regclass      THEN (SELECT relnamespace FROM pg_class WHERE oid = d.objid)
           WHEN 'pg_proc'::regclass       THEN (SELECT pronamespace FROM pg_proc  WHERE oid = d.objid)
           WHEN 'pg_type'::regclass       THEN (SELECT typnamespace FROM pg_type  WHERE oid = d.objid)
           WHEN 'pg_constraint'::regclass THEN (SELECT connamespace FROM pg_constraint WHERE oid = d.objid)
           WHEN 'pg_rewrite'::regclass    THEN (SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class WHERE r.oid = d.objid)
           WHEN 'pg_trigger'::regclass    THEN (SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.oid = d.objid AND NOT t.tgisinternal) END
   WHERE rn.nspname IN ('workhub','workhub_private')
     AND d.deptype IN ('n','a')                       -- 내부 의존(toast 등)은 함께 지워지는 게 맞다
     AND dn.nspname NOT IN ('workhub','workhub_private','pg_toast')
     AND NOT (dn.nspname = 'public' AND d.classid = 'pg_proc'::regclass
              AND (SELECT proname FROM pg_proc WHERE oid = d.objid) IN
                  ('workhub_context','workhub_calendar_list','workhub_calendar_get','workhub_calendar_save',
                   'workhub_task_list','workhub_task_get','workhub_task_mutate'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'R0-90 중단: 업무실 밖의 객체가 업무실을 참조합니다(%). CASCADE 로 함께 지워지므로 멈춥니다.', v;
  END IF;
END $$;
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
