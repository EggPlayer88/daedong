-- 읽기 전용. AF2-01 전후 결과를 CSV로 보관하고 F1~F4를 비교한다.
WITH fingerprints AS (
 SELECT 'F1' no,'학교 소속·역할' item,md5(COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.memberships m),'')||COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.membership_roles m),'')) value
 UNION ALL SELECT 'F2','수합·양식·응답',md5(COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.collections m),'')||COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.guided_templates m),'')||COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.guided_responses m),''))
 UNION ALL SELECT 'F3','기존 함수 정의·소유자·권한',md5(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid)||pg_get_userbyid(p.proowner)||COALESCE(p.proacl::text,''),'' ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('workhub_private','public') AND p.prokind='f' AND (n.nspname='workhub_private' OR p.proname LIKE 'workhub_%') AND p.proname NOT LIKE 'af2_%' AND p.proname<>'workhub_collection_presentation'),''))
 UNION ALL SELECT 'F4','알림·접수 원장',md5(COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.notifications m),'')||COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY row_to_json(m)::text) FROM workhub.content_requests m),''))
)
SELECT 'P1' no,'R1·P4·P7 함수' item,CASE WHEN to_regprocedure('workhub_private.p4_tpl_apply(workhub_private.actor_context,jsonb,text)') IS NOT NULL AND to_regprocedure('workhub_private.p7_phase(text,text)') IS NOT NULL AND to_regprocedure('workhub_private.c_mutate(workhub_private.actor_context,jsonb,text)') IS NOT NULL THEN 'ok' ELSE 'FAIL' END status,'선행 설치 확인' value
UNION ALL SELECT 'P2','AF2 설치 여부','info',COALESCE(to_regprocedure('public.workhub_collection_presentation(text,text,jsonb,text)')::text,'미설치')
UNION ALL SELECT no,item,'compare',value FROM fingerprints ORDER BY no;
