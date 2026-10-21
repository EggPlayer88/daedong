-- K1 한정 사후 점검(읽기 전용). 운영 전체 통합 점검을 대신하지 않는다.
WITH expected(name,args) AS (
 VALUES ('workhub_knowledge_get','text, text, integer'),('workhub_knowledge_history','text, text, integer')
), actual AS (
 SELECT p.*,r.rolname AS owner FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN (SELECT name FROM expected)
)
SELECT 'K1-02-01' AS no,'조회 함수 2개·인자 일치·오버로드 없음' AS item,
 CASE WHEN (SELECT count(*) FROM actual)=2 AND NOT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a ON a.proname=e.name AND oidvectortypes(a.proargtypes)=e.args WHERE a.oid IS NULL) THEN 'ok' ELSE 'FAIL' END AS status
UNION ALL
SELECT 'K1-02-02','postgres 소유·SECURITY DEFINER·search_path 고정',
 CASE WHEN count(*)=2 AND bool_and(owner='postgres' AND prosecdef AND proconfig @> ARRAY['search_path=""']) THEN 'ok' ELSE 'FAIL' END FROM actual
UNION ALL
SELECT 'K1-02-03','authenticated만 실행·PUBLIC/anon/service_role 불가',
 CASE WHEN count(*)=2 AND bool_and(has_function_privilege('authenticated',oid,'execute')
 AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('service_role',oid,'execute')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE')) THEN 'ok' ELSE 'FAIL' END FROM actual
UNION ALL
SELECT 'K1-02-04','P4 설치·원본 판 기록 보호',
 CASE WHEN workhub_private.p4_installed() AND EXISTS(
 SELECT 1 FROM pg_trigger WHERE tgrelid='workhub.knowledge_source_revisions'::regclass
 AND tgname='knowledge_source_revisions_immutable' AND tgenabled IN ('O','A')) THEN 'ok' ELSE 'FAIL' END
ORDER BY no;
