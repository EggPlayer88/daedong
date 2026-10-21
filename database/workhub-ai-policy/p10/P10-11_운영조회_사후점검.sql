-- 읽기 전용. 기존 P10-04와 함께 확인한다.
SELECT 'P10-AI-9' AS no,'운영 조회 두 배치' AS item,CASE WHEN count(*)=2 THEN 'ok' ELSE 'FAIL' END AS status,count(*)::text AS value
FROM workhub_private.p10_ai_installs WHERE release='2026-10-21.2' AND batch IN('P10-AI-09','P10-AI-10')
UNION ALL
SELECT 'P10-AI-10','운영·진단은 service_role 전용',CASE WHEN count(*)=2 AND bool_and(has_function_privilege('service_role',p.oid,'EXECUTE'))
  AND NOT bool_or(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname IN('workhub_ai_school_operations','workhub_ai_school_diagnostics')
UNION ALL
SELECT 'P10-AI-11','새 집계 helper는 API 직접호출 금지',CASE WHEN NOT has_function_privilege('service_role','workhub_private.p10_operations_counts(text[])','EXECUTE')
 AND NOT has_function_privilege('authenticated','workhub_private.p10_operations_counts(text[])','EXECUTE') AND NOT has_function_privilege('anon','workhub_private.p10_operations_counts(text[])','EXECUTE') THEN 'ok' ELSE 'FAIL' END,'';
