-- 읽기 전용. TR2 새 함수·권한·원본 보호와 기존 기준판 계보 보존을 확인한다.
WITH expected(signature,hash,security_definer) AS (VALUES ('public.workhub_timetable_roster_bridge_close(text, jsonb, text)','dc4879ad0efe59ea75cb8fe712a786b2',true),
('public.workhub_timetable_roster_bridge_commit(text, jsonb, text, boolean)','a7b0db463192fc817f19c6398745a7ed',true),
('public.workhub_timetable_roster_bridge_get(text)','a9579814e79c1a22bd4b8b2933542835',true),
('public.workhub_timetable_roster_bridge_preview(text, jsonb)','c9dfc476aa10becd90d872da18b6ab0a',true),
('timetable_roster_bridge.actor(text, boolean)','4ffe9b24d8df66650b6fb5ce9b947094',false),
('timetable_roster_bridge.envelope(workhub_private.actor_context, jsonb)','d12145a6427f4da9691797fc540d7d8d',false),
('timetable_roster_bridge.execute(workhub_private.actor_context, jsonb, text, boolean, boolean)','cb62662f1d554f5064368709f5e56fb8',false),
('timetable_roster_bridge.input(jsonb)','5984de09ef04f13455b0050dbecf243e',false),
('timetable_roster_bridge.plan(workhub_private.actor_context, text, jsonb, text, timestamp with time zone)','7eadd0f267ca139012382326d4336c5c',false),
('timetable_roster_bridge.prepare(workhub_private.actor_context, jsonb)','373fc8e156e27ee15470fcda04e2952d',false),
('timetable_roster_bridge.source(workhub_private.actor_context, jsonb)','10102ae6e8ac8d45bf4bf9c9da043166',false)), trigger_expected(name,hash,relation) AS (VALUES ('tr2_requests_immutable','3ea41000e7248fe915f7675e3b74072b','timetable_roster_bridge.requests'),
('tr2_sources_immutable','e3f35faec0adf4670d94b12ea4f44079','timetable_roster_bridge.sources')), constraint_expected(name,hash) AS (VALUES ('timetable_basis_origin_check','0d6ad2e8552e25165295529e9a0a6feb'),
('timetable_basis_roster_origin_fkey','23a30c1539a5cd4135efaa50b6db4e61')), checks(no,item,ok,value) AS (
 SELECT 'TR2-02-01','명부 시간표 운영 연결 설치',to_regnamespace('timetable_roster_bridge') IS NOT NULL AND to_regprocedure('public.workhub_timetable_roster_bridge_commit(text,jsonb,text,boolean)') IS NOT NULL,'TR2-01'
 UNION ALL SELECT 'TR2-02-02','함수 원문·소유자·검색 경로',bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND p.prosecdef=e.security_definer AND p.proconfig=ARRAY['search_path=""']::text[] AND md5(replace(p.prosrc,E'\r\n',E'\n'))=e.hash),count(p.oid)::text FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'TR2-02-03','공개 RPC는 authenticated만 실행',bool_and(has_function_privilege('authenticated',to_regprocedure(e.signature),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure(e.signature),'EXECUTE') AND NOT has_function_privilege('service_role',to_regprocedure(e.signature),'EXECUTE')),'기존 관리자 판정 유지' FROM expected e WHERE e.signature LIKE 'public.%'
 UNION ALL SELECT 'TR2-02-04','내부 함수·스키마 API 직접 실행 차단',NOT EXISTS(SELECT 1 FROM expected e CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE e.signature LIKE 'timetable_roster_bridge.%' AND has_function_privilege(r.name,to_regprocedure(e.signature),'EXECUTE')) AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE has_schema_privilege(r.name,'timetable_roster_bridge','USAGE,CREATE')),'0개가 정상'
 UNION ALL SELECT 'TR2-02-05','새 원장·미리보기 RLS·API 차단',(SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='timetable_roster_bridge'::regnamespace AND relkind='r') AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE c.relnamespace='timetable_roster_bridge'::regnamespace AND c.relkind='r' AND has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'sources · previews · requests'
 UNION ALL SELECT 'TR2-02-06','원본·요청 원장 불변 트리거',bool_and(t.oid IS NOT NULL AND NOT t.tgisinternal AND t.tgenabled='O' AND md5(pg_get_triggerdef(t.oid))=e.hash),count(t.oid)::text FROM trigger_expected e LEFT JOIN pg_trigger t ON t.tgname=e.name AND t.tgrelid=to_regclass(e.relation)
 UNION ALL SELECT 'TR2-02-07','기준판 출처 CHECK·학교 학기 FK',count(c.oid)=2 AND bool_and(md5(pg_get_constraintdef(c.oid))=e.hash AND c.convalidated),'기존 T1 출처 또는 불변 TR2 출처 중 하나' FROM constraint_expected e LEFT JOIN pg_constraint c ON c.conname=e.name AND c.conrelid='workhub.timetable_basis_revisions'::regclass
 UNION ALL SELECT 'TR2-02-08','기준판 출처 열과 기존 자료 계보',
 (SELECT count(*)=3 AND bool_and(NOT attnotnull) FROM pg_attribute WHERE attrelid='workhub.timetable_basis_revisions'::regclass AND attname IN('prep_draft_id','prep_draft_revision','roster_source_id') AND NOT attisdropped)
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_basis_revisions WHERE NOT((roster_source_id IS NULL AND prep_draft_id IS NOT NULL AND prep_draft_revision IS NOT NULL) OR(roster_source_id IS NOT NULL AND prep_draft_id IS NULL AND prep_draft_revision IS NULL))),'현재 기준판 자동 변경 없음'
) SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status,value FROM checks ORDER BY no;
