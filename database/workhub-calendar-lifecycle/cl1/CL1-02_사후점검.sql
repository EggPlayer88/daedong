-- 읽기 전용. 새 RPC·원문·권한·취소 자료 보호를 확인한다.
WITH expected(signature,hash,security_definer) AS (VALUES ('public.workhub_calendar_cancel(text, jsonb, text, boolean)','97d1e51ea2242d3d1a3063647fc1ab2a',true),
('public.workhub_calendar_cancelled_list(text)','b7f4112354f4aeefa462baa2d9125222',true),
('public.workhub_calendar_get(text, text)','335e8602ebbedca74038d5da9aa4b45e',true),
('public.workhub_calendar_list(text)','71a28428a93ba0c543c01e7ae1cdda78',true),
('public.workhub_calendar_save(text, jsonb)','4bb200d489bbfecbf49d524d9407877d',true),
('workhub_private.cl1_cancelled_guard()','c143d3da7e747d4a7a973caaccd6280f',true),
('workhub_private.cl1_event_dto(workhub.events, text)','b58a957b053a5ee7ffc8a1a5b0ea5fff',false)), checks(no,item,ok,value) AS (
 SELECT 'CL1-02-01','설치 기록',EXISTS(SELECT 1 FROM workhub_private.cl1_installs WHERE batch='CL1-01'),'CL1-01'
 UNION ALL SELECT 'CL1-02-02','함수 원문·소유자·검색 경로',bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND p.prosecdef=e.security_definer AND p.proconfig=ARRAY['search_path=""']::text[] AND md5(replace(p.prosrc,E'\r\n',E'\n'))=e.hash),count(p.oid)::text FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'CL1-02-03','공개 RPC는 authenticated만 실행',bool_and(has_function_privilege('authenticated',to_regprocedure(e.signature),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure(e.signature),'EXECUTE') AND NOT has_function_privilege('service_role',to_regprocedure(e.signature),'EXECUTE')),'기존 학교·소속 권한 유지' FROM expected e WHERE e.signature LIKE 'public.%'
 UNION ALL SELECT 'CL1-02-04','내부 함수 API 직접 실행 차단',NOT EXISTS(SELECT 1 FROM expected e CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE e.signature LIKE 'workhub_private.%' AND has_function_privilege(r.name,to_regprocedure(e.signature),'EXECUTE')),'0개가 정상'
 UNION ALL SELECT 'CL1-02-05','취소 원본 변경 보호',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub.events'::regclass AND tgname='cl1_cancelled_guard' AND NOT tgisinternal AND tgenabled='O' AND tgfoid='workhub_private.cl1_cancelled_guard()'::regprocedure AND md5(pg_get_triggerdef(oid))='ccf2542039ee0641a7db2f781a9888f6'),'취소된 원본은 변경하지 않음'
 UNION ALL SELECT 'CL1-02-06','설치 기록 RLS·API 권한·불변 보호',(SELECT relrowsecurity FROM pg_class WHERE oid='workhub_private.cl1_installs'::regclass) AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE has_table_privilege(r.name,'workhub_private.cl1_installs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub_private.cl1_installs'::regclass AND tgname='cl1_install_immutable' AND tgenabled='O' AND tgfoid='workhub_private.forbid_change()'::regprocedure AND tgtype=27),'기존 권한 변경 없음'
 UNION ALL SELECT 'CL1-02-07','취소 자료·사유 정합성',NOT EXISTS(SELECT 1 FROM workhub.events WHERE status='cancelled' AND (cancelled_at IS NULL OR nullif(btrim(cancel_reason),'') IS NULL)),'취소 시각·사유 보존'
) SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status,value FROM checks ORDER BY no;
