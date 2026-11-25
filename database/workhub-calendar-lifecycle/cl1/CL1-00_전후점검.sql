-- 읽기 전용. 설치 직전·직후 F1~F5는 같아야 한다. 설치는 기존 행을 바꾸지 않는다.
WITH checks(no,item,status,value) AS (
 SELECT 'CL1-00-01','NT1 선행 설치',CASE WHEN to_regclass('workhub_private.nt1_installs') IS NOT NULL THEN 'ok' ELSE 'FAIL' END,'INT-15 기준'
 UNION ALL SELECT 'CL1-00-02','CL1 설치 여부','info',CASE WHEN to_regclass('workhub_private.cl1_installs') IS NULL THEN '미설치' ELSE '설치됨 · CL1-02 확인' END
 UNION ALL SELECT 'F1','기존 일정·판·대상','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.events t UNION ALL SELECT to_jsonb(t)::text FROM workhub.event_revisions t UNION ALL SELECT to_jsonb(t)::text FROM workhub.audience_sets t) x
 UNION ALL SELECT 'F2','기존 접수증·감사·알림','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.idempotency_receipts t UNION ALL SELECT to_jsonb(t)::text FROM workhub.audit_events t UNION ALL SELECT to_jsonb(t)::text FROM workhub.notifications t) x
 UNION ALL SELECT 'F3','기존 소속·역할·시험 허용','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.memberships t UNION ALL SELECT to_jsonb(t)::text FROM workhub.membership_roles t UNION ALL SELECT to_jsonb(t)::text FROM workhub.participant_grants t) x
 UNION ALL SELECT 'F4','기존 수합·메시지','compare',md5(coalesce(string_agg(v,chr(10) ORDER BY v),'')) FROM (SELECT to_jsonb(t)::text v FROM workhub.collections t UNION ALL SELECT to_jsonb(t)::text FROM workhub.messages t) x
 UNION ALL SELECT 'F5','기존 AI 정책','compare',md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY t.school_id),'')) FROM workhub.assistant_policies t
) SELECT * FROM checks ORDER BY no;
