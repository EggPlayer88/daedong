-- AF1 설치 직후 읽기 전용 점검. 기존 INT-09 원문은 바꾸지 않는다.
WITH expected(name,hash) AS (VALUES
('workhub_private.af1_admin_coverage','c5d62329a2e27236ec9ab059a9535366'),
('workhub_private.af1_admin_lock','e4e54579d33e67ec39ea75186c0d148f'),
('workhub_private.af1_admin_guard','8e3fe8219fb259c4f7a8b44175e22465'),
('public.workhub_annual_readiness','1d3e5f18abba858139df359b9dc55faa'),
('workhub_private.t2_recommend(workhub_private.actor_context,jsonb,text)','765930a76d6606c34c5fd797e5638d4b'),
('workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)','27f04a9e7535e6c4eb963788d3cb7787'),
('workhub_private.af1_makeup_needed','3955d84f2247a3a5b7aed81caaea469a'),
('workhub_private.af1_period_plan','f03959ca18365fe9ead93e814c35fdac'),
('workhub_private.af1_period_execute','e5a1db6d8961855bc41889db453bb6af'),
('public.workhub_annual_operations','489b08f78f50179639c57649f5eeba7c'),
('workhub_private.t3_summary(workhub_private.actor_context)','09655c68c0779f532210b4650cd1a16b'),
('workhub_private.t3_closed(text,date,jsonb,text)','9f1311ec178442c25b3a058f79c91a50'),
('workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone)','c10c6ed652905a9e59007e1e7642c0e1'),
('workhub_private.t3_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone,text)','6c8fb2b13c84752ae0e0f4b900484518')
), functions AS (
 SELECT e.*,p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,md5(replace(p.prosrc,chr(13),'')) actual
 FROM expected e LEFT JOIN pg_proc p ON (CASE WHEN position('(' in e.name)>0 THEN p.oid::regprocedure::text=e.name ELSE p.pronamespace::regnamespace::text||'.'||p.proname=e.name END)
), checks AS (
 SELECT 'AF1-05-01' no,'설치 단계 4개' item,(SELECT count(*)=4 FROM workhub_private.af1_installs WHERE batch IN('AF1-01','AF1-02','AF1-03','AF1-04')) ok
 UNION ALL SELECT 'AF1-05-02','함수 원문·소유자·search_path',NOT EXISTS(SELECT 1 FROM functions WHERE oid IS NULL OR hash<>actual OR owner<>'postgres' OR NOT prosecdef OR NOT ('search_path=""'=ANY(proconfig)))
 UNION ALL SELECT 'AF1-05-03','신규 표 RLS·소유자',(SELECT count(*)=5 AND bool_and(relrowsecurity AND pg_get_userbyid(relowner)='postgres') FROM pg_class WHERE relnamespace='workhub'::regnamespace AND relkind='r' AND relname IN('annual_closure_previews','annual_closure_days','annual_empty_releases','annual_makeup_resolutions','annual_commands'))
 UNION ALL SELECT 'AF1-05-04','API 역할 직접 표 접근 없음',NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='workhub'::regnamespace AND c.relname LIKE 'annual_%' AND c.relkind='r' AND EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 UNION ALL SELECT 'AF1-05-05','비공개 함수·공개 RPC 실행 권한',NOT EXISTS(SELECT 1 FROM functions f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE (f.name LIKE 'workhub_private.af1_%' AND has_function_privilege(r,f.oid,'EXECUTE')) OR (f.name LIKE 'public.workhub_annual_%' AND has_function_privilege(r,f.oid,'EXECUTE') IS DISTINCT FROM (r='authenticated')))
 UNION ALL SELECT 'AF1-05-06','관리자 기간 보호 4개',(SELECT count(*)=4 AND bool_and(tgenabled='O') FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('af1_members_lock','af1_members_guard','af1_roles_lock','af1_roles_guard'))
 UNION ALL SELECT 'AF1-05-07','연간 기록 수정 방지 5개',(SELECT count(*)=5 AND bool_and(tgenabled='O') FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('annual_closure_previews_immutable','annual_closure_days_immutable','annual_empty_releases_immutable','annual_makeup_resolutions_immutable','annual_commands_immutable'))
 UNION ALL SELECT 'AF1-05-08','빈 날 휴업은 AF1 원장과 연결',NOT EXISTS(SELECT 1 FROM workhub.timetable_school_day_changes c WHERE jsonb_array_length(c.changed_lessons)=0 AND NOT EXISTS(SELECT 1 FROM workhub.annual_closure_days d WHERE d.school_id=c.school_id AND d.change_id=c.id AND d.period_id=c.input->>'annualPeriodId'))
)
SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END status FROM checks ORDER BY no;
