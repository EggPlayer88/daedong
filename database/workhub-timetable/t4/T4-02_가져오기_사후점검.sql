-- 읽기 전용. T4-01 설치 후 전 행 ok인지 확인한다. 기능 활성화나 데이터 변경은 하지 않는다.
WITH funcs AS (
 SELECT p.*, n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname LIKE 'workhub_timetable_import_%')
 OR (n.nspname='workhub_private' AND p.proname IN('t4_envelope','t4_input','t4_plan','t4_mutate'))
), checks(no,item,passed) AS (
 SELECT 'T4-02-01','가져오기 표 2개 RLS 및 API 직접 접근 없음',
  count(*)=2 AND bool_and(c.relrowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
 FROM pg_class c WHERE c.relnamespace='workhub'::regnamespace AND c.relname IN('timetable_import_previews','timetable_import_requests') AND c.relkind='r'
 UNION ALL SELECT 'T4-02-02','공개 함수 4개 · 인증 계정만 실행 · 고정 search_path',
  count(*)=4 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres'
   AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',oid,'EXECUTE')) FROM funcs WHERE nspname='public'
 UNION ALL SELECT 'T4-02-03','내부 함수 4개 · API 실행 권한 없음',
  count(*)=4 AND bool_and(NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',oid,'EXECUTE') AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""'])
 FROM funcs WHERE nspname='workhub_private'
 UNION ALL SELECT 'T4-02-04','미리보기·접수 원장 불변 보호',
  count(*)=2 AND bool_and(t.tgenabled='O' AND t.tgfoid='workhub_private.forbid_change()'::regprocedure)
 FROM pg_trigger t WHERE NOT t.tgisinternal AND (t.tgrelid,t.tgname) IN
  (('workhub.timetable_import_previews'::regclass,'timetable_import_preview_immutable'),
   ('workhub.timetable_import_requests'::regclass,'timetable_import_request_immutable'))
 UNION ALL SELECT 'T4-02-05','원 요청 번호·미리보기 중복 저장 방지 제약',
  count(*)=4 FROM pg_constraint WHERE conrelid='workhub.timetable_import_requests'::regclass
  AND contype IN('p','u','f') AND (contype IN('p','u') OR confrelid IN('workhub.memberships'::regclass,'workhub.timetable_import_previews'::regclass))
)
SELECT no,item,CASE WHEN passed THEN 'ok' ELSE 'FAIL' END AS status FROM checks ORDER BY no;
