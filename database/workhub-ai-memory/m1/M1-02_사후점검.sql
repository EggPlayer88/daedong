-- 읽기 전용. 모든 필수 항목은 ok여야 한다. 켜진 학교 수는 info이며 이 파일은 켜지 않는다.
WITH tables AS(
 SELECT c.oid,c.relrowsecurity,c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE
 (n.nspname='workhub' AND c.relname IN('ai_memory_controls','ai_memories','ai_memory_requests'))
 OR(n.nspname='workhub_private' AND c.relname='m1_installs')
),expected(signature,args) AS(VALUES
 ('public.workhub_ai_memory_list(text)',ARRAY['p_member_id']),
 ('public.workhub_ai_memory_select(text,jsonb)',ARRAY['p_member_id','p_references']),
 ('public.workhub_ai_memory_mutate(text,jsonb,text)',ARRAY['p_member_id','p_command','p_request_key']),
 ('public.workhub_ai_memory_recover(text,jsonb,text)',ARRAY['p_member_id','p_command','p_request_key']),
 ('public.workhub_ai_memory_close(text,jsonb,text)',ARRAY['p_member_id','p_command','p_request_key'])
),funcs AS(
 SELECT p.* FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'workhub_ai_memory_%'
),internals AS(
 SELECT p.* FROM pg_proc p WHERE p.pronamespace='workhub_private'::regnamespace AND p.proname LIKE 'm1\_%'
),checks AS(
 SELECT 'M1-02-01' AS no,'설치 기록' AS item,(SELECT count(*)=1 FROM workhub_private.m1_installs WHERE batch='M1-01' AND release='2026-10-21.1') AS ok
 UNION ALL SELECT 'M1-02-02','새 표 4개 RLS·소유자',count(*)=4 AND bool_and(relrowsecurity AND relowner='postgres'::regrole) FROM tables
 UNION ALL SELECT 'M1-02-03','API 역할 직접 표 권한 0',NOT EXISTS(SELECT 1 FROM tables t CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 UNION ALL SELECT 'M1-02-04','공개 함수 5개·인자·고정 search_path',(SELECT count(*)=5 FROM funcs) AND count(p.oid)=5 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND p.proargnames=e.args AND p.prorettype='jsonb'::regtype) FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'M1-02-05','authenticated만 공개 함수 실행',NOT EXISTS(SELECT 1 FROM funcs f WHERE NOT has_function_privilege('authenticated',f.oid,'EXECUTE') OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE'))
 UNION ALL SELECT 'M1-02-06','내부 함수 API 실행권한 0',NOT EXISTS(SELECT 1 FROM internals f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,f.oid,'EXECUTE'))
 UNION ALL SELECT 'M1-02-07','함수 소유자 postgres',NOT EXISTS(SELECT 1 FROM (SELECT proowner FROM funcs UNION ALL SELECT proowner FROM internals) f WHERE f.proowner<>'postgres'::regrole)
 UNION ALL SELECT 'M1-02-08','보호 트리거 3개 켜짐',count(*)=3 AND bool_and(tgenabled='O') FROM pg_trigger WHERE NOT tgisinternal AND
 ((tgname='m1_installs_immutable' AND tgrelid='workhub_private.m1_installs'::regclass AND tgfoid='workhub_private.forbid_change()'::regprocedure)
 OR(tgname='ai_memory_requests_immutable' AND tgrelid='workhub.ai_memory_requests'::regclass AND tgfoid='workhub_private.forbid_change()'::regprocedure)
 OR(tgname='ai_memories_guard' AND tgrelid='workhub.ai_memories'::regclass AND tgfoid='workhub_private.m1_entry_guard()'::regprocedure))
 UNION ALL SELECT 'M1-02-09','삭제 본문·제목 제거',NOT EXISTS(SELECT 1 FROM workhub.ai_memories WHERE deleted_at IS NOT NULL AND(title IS NOT NULL OR body IS NOT NULL OR enabled OR expires_on IS NOT NULL))
 UNION ALL SELECT 'M1-02-10','접수증에 본문·명령 없음',NOT EXISTS(SELECT 1 FROM workhub.ai_memory_requests WHERE receipt ?| ARRAY['title','body','command','input'])
)
SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status FROM checks
UNION ALL SELECT 'M1-02-11','켜진 학교 '||(SELECT count(*) FROM workhub.ai_memory_controls WHERE enabled)::text,'info'
ORDER BY no;
