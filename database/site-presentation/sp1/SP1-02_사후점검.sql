-- 읽기 전용 사후 점검. 메뉴 표시는 기능 권한과 별개다.
SELECT 'SP1-02-01' AS no, CASE WHEN count(*)=2 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='site_presentation' AND c.relkind='r'
UNION ALL
SELECT 'SP1-02-02',CASE WHEN count(*)=0 THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM information_schema.table_privileges WHERE table_schema='site_presentation' AND grantee IN ('PUBLIC','anon','authenticated')
UNION ALL
SELECT 'SP1-02-03',CASE WHEN count(*)=2 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'] AND pg_get_userbyid(p.proowner)='postgres') THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('site_seasonal_status','site_seasonal_set')
UNION ALL
SELECT 'SP1-02-04',CASE WHEN count(*)=1 AND bool_and(version>=1) THEN 'ok' ELSE 'FAIL' END,count(*)::text FROM site_presentation.seasonal_work
UNION ALL
SELECT 'SP1-02-05',CASE WHEN count(*)=2 AND bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('site_seasonal_status','site_seasonal_set')
UNION ALL
SELECT 'SP1-02-06',CASE WHEN NOT has_schema_privilege('authenticated','site_presentation','USAGE') AND NOT has_schema_privilege('anon','site_presentation','USAGE') THEN 'ok' ELSE 'FAIL' END,'API 역할의 내부 스키마 접근 없음'
UNION ALL
SELECT 'SP1-02-07','info',jsonb_build_object('feature',feature,'visible',enabled,'version',version)::text FROM site_presentation.seasonal_work
ORDER BY no;
