-- 읽기 전용. 새 트리거·함수·권한과 기존 함수의 불변을 확인한다.
WITH expected(signature,hash) AS (VALUES
('workhub_private.p3_post(workhub_private.actor_context,text,text,text[],text)','de571a19885bc5016eb32cb5dc9af4ab'),
 ('workhub_private.c_cmd_publish(workhub_private.actor_context,jsonb,jsonb)','b586e8ac750e816d4d9b73eb7a0edb88'),
 ('workhub_private.p3_notify(text,text,text,text,text,text,text)','91003e540f773b97879f2ce5418cb725')), fresh(signature,hash) AS (VALUES
('workhub_private.nt1_message_notice()','a3e41bea6d098b3ed4e2fa0fd37fe199'),
 ('workhub_private.nt1_collection_notice()','c25d0e77638311e9c4f830fb96ee56cc')), checks(no,item,ok,value) AS (
 SELECT 'NT1-02-01','설치 기록',EXISTS(SELECT 1 FROM workhub_private.nt1_installs WHERE batch='NT1-01'),'NT1-01'
 UNION ALL SELECT 'NT1-02-02','기존 함수 원문·소유자',bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND md5(replace(p.prosrc,E'\r\n',E'\n'))=e.hash),count(p.oid)::text FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'NT1-02-03','새 알림 함수 원문·소유자·고정 검색 경로',bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND md5(replace(p.prosrc,E'\r\n',E'\n'))=e.hash),count(p.oid)::text FROM fresh e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'NT1-02-04','API 역할의 새 내부 함수 직접 실행 차단',NOT EXISTS(SELECT 1 FROM fresh e CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE has_function_privilege(r.name,to_regprocedure(e.signature),'EXECUTE')),'0개가 정상'
 UNION ALL SELECT 'NT1-02-05','메시지 트리거',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub.messages'::regclass AND tgname='nt1_message_notice' AND NOT tgisinternal AND tgenabled='O' AND tgtype=5 AND tgfoid='workhub_private.nt1_message_notice()'::regprocedure AND tgqual IS NULL AND tgattr::text=''),'INSERT 후 1행'
 UNION ALL SELECT 'NT1-02-06','수합 최초 공개 트리거',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub.collections'::regclass AND tgname='nt1_collection_notice' AND NOT tgisinternal AND tgenabled='O' AND tgtype=17 AND tgfoid='workhub_private.nt1_collection_notice()'::regprocedure AND md5(pg_get_triggerdef(oid))='__COLLECTION_TRIGGER_HASH__'),'draft → published만'
 UNION ALL SELECT 'NT1-02-07','설치 기록 RLS·API 권한·불변 보호',
 (SELECT relrowsecurity FROM pg_class WHERE oid='workhub_private.nt1_installs'::regclass)
 AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated'),('service_role')) r(name) WHERE has_table_privilege(r.name,'workhub_private.nt1_installs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub_private.nt1_installs'::regclass AND tgname='nt1_install_immutable' AND tgenabled='O' AND tgfoid='workhub_private.forbid_change()'::regprocedure AND tgtype=27),'기존 권한 변경 없음'
) SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status,value FROM checks ORDER BY no;
