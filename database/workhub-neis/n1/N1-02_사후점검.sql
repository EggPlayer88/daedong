-- 읽기 전용. N1 설치 후·연결 등록 후 같은 파일을 사용한다.
WITH tables AS (
 SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='neis_private' AND c.relkind='r'
), funcs AS (
 SELECT p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'workhub_neis_%'
), checks AS (
 SELECT 'N1-02-01' no,'나이스 표 4개·RLS' item,(SELECT count(*)=4 AND bool_and(relrowsecurity) FROM tables) pass
 UNION ALL SELECT 'N1-02-02','API 직접 표 권한 없음',NOT EXISTS(
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN(VALUES('anon'),('authenticated'),('service_role')) r(role)
 WHERE n.nspname='neis_private' AND c.relkind='r' AND has_table_privilege(r.role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 UNION ALL SELECT 'N1-02-03','공개 함수 6개·고정 검색경로', (SELECT count(*)=6 AND bool_and(prosecdef AND 'search_path=""'=ANY(proconfig)) FROM funcs)
 UNION ALL SELECT 'N1-02-04','인증 역할 조회·반영·종료만 허용', (SELECT count(*)=6 AND bool_and(has_function_privilege('authenticated',oid,'EXECUTE')=(proname IN ('workhub_neis_status','workhub_neis_apply','workhub_neis_close'))) FROM funcs)
 UNION ALL SELECT 'N1-02-05','서비스 역할 갱신 함수만 허용', (SELECT count(*)=6 AND bool_and(has_function_privilege('service_role',oid,'EXECUTE')=(proname IN ('workhub_neis_refresh_targets','workhub_neis_claim','workhub_neis_finish'))) FROM funcs)
 UNION ALL SELECT 'N1-02-06','익명·PUBLIC 실행권한 없음', (SELECT count(*)=6 AND bool_and(NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=funcs.oid),acldefault('f',(SELECT proowner FROM pg_proc WHERE oid=funcs.oid)))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM funcs)
 UNION ALL SELECT 'N1-02-07','기존 일정 저장 함수 유지',to_regprocedure('public.workhub_calendar_save(text,jsonb)') IS NOT NULL
 UNION ALL SELECT 'N1-02-08','학교 1곳 이하·명시 연결', (SELECT count(*)<=1 AND bool_and(office_code ~ '^[A-Z][0-9]{2}$' AND school_code ~ '^[0-9]{7}$') FROM neis_private.connections)
)
SELECT no,item,CASE WHEN COALESCE(pass,no='N1-02-08') THEN 'ok' ELSE 'FAIL' END status,NULL::jsonb value FROM checks
UNION ALL SELECT 'N1-02-09','연결 학교·자료','info',jsonb_build_object('activeSchools',(SELECT count(*) FROM neis_private.connections WHERE active),'datasets',(SELECT count(*) FROM neis_private.datasets),'linkedEvents',(SELECT count(*) FROM neis_private.schedule_sources WHERE event_id IS NOT NULL))
ORDER BY no;
