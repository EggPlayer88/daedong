-- 읽기 전용. 설치 직전·직후 실행해 F1~F4를 비교한다.
WITH expected(signature,hash) AS (VALUES
('workhub_private.p3_post(workhub_private.actor_context,text,text,text[],text)','de571a19885bc5016eb32cb5dc9af4ab'),
 ('workhub_private.c_cmd_publish(workhub_private.actor_context,jsonb,jsonb)','b586e8ac750e816d4d9b73eb7a0edb88'),
 ('workhub_private.p3_notify(text,text,text,text,text,text,text)','91003e540f773b97879f2ce5418cb725')), baseline AS (SELECT e.signature,e.hash,p.prosrc,p.proowner FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)), checks(no,item,status,value) AS (
 SELECT 'NT1-00-01','기존 R1·P3 함수 원문과 소유자',CASE WHEN bool_and(prosrc IS NOT NULL AND proowner='postgres'::regrole AND md5(replace(prosrc,E'\r\n',E'\n'))=hash) THEN 'ok' ELSE 'FAIL' END,count(prosrc)::text FROM baseline
 UNION ALL SELECT 'NT1-00-02','NT1 설치 여부','info',CASE WHEN to_regclass('workhub_private.nt1_installs') IS NULL THEN '미설치' ELSE '설치됨 · NT1-02 확인' END
 UNION ALL SELECT 'F1','기존 메시지·대화','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.messages t UNION ALL SELECT to_jsonb(t)::text FROM workhub.message_threads t) x
 UNION ALL SELECT 'F2','기존 수합·제출 단위','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.collections t UNION ALL SELECT to_jsonb(t)::text FROM workhub.collection_units t) x
 UNION ALL SELECT 'F3','기존 알림','compare',md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY t.id),'')) FROM workhub.notifications t
 UNION ALL SELECT 'F4','기존 소속·역할','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.memberships t UNION ALL SELECT to_jsonb(t)::text FROM workhub.membership_roles t) x
) SELECT * FROM checks ORDER BY no;
