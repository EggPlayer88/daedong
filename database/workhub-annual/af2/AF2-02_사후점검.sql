-- AF2 설치 직후 읽기 전용 검사. 기존 INT 점검 원문은 유지한다.
WITH expected(name,hash) AS (VALUES
('workhub_private.af2_statuses','0fffe8e5cbc2e328806168e8b932e29f'),
('workhub_private.af2_targets','38230a7ad96021a80abc653a25af3cd4'),
('workhub_private.af2_publish','52eeb4f5c62d9cdcd93b369f5f85162b'),
('public.workhub_collection_presentation','ca6549e8682906a8166d2c40bc275341')
), f AS (
 SELECT e.*,p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,md5(replace(p.prosrc,chr(13),'')) actual
 FROM expected e LEFT JOIN pg_proc p ON p.pronamespace::regnamespace::text||'.'||p.proname=e.name
), checks AS (
 SELECT 'AF2-02-01' no,'신규 함수 4개' item,(SELECT count(*)=4 AND count(oid)=4 FROM f) ok
 UNION ALL SELECT 'AF2-02-02','함수 원문·소유자·search_path',NOT EXISTS(SELECT 1 FROM f WHERE oid IS NULL OR actual<>hash OR owner<>'postgres' OR NOT prosecdef OR ('search_path=""'=ANY(proconfig)) IS DISTINCT FROM TRUE)
 UNION ALL SELECT 'AF2-02-03','비공개 함수 실행 권한',NOT EXISTS(SELECT 1 FROM f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE name LIKE 'workhub_private.%' AND has_function_privilege(r,oid,'EXECUTE'))
 UNION ALL SELECT 'AF2-02-04','공개 RPC는 authenticated 전용',NOT EXISTS(SELECT 1 FROM f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE name LIKE 'public.%' AND has_function_privilege(r,oid,'EXECUTE') IS DISTINCT FROM (r='authenticated'))
)
SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END status FROM checks ORDER BY no;
