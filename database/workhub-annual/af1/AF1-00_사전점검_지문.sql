-- AF1 사전·전후 대조. 읽기 전용이며 설치 전 결과를 CSV로 보관한다.
WITH fingerprints AS (
 SELECT 'F1' no,'학교 소속·역할' item,md5(COALESCE((SELECT string_agg(row_to_json(m)::text,'' ORDER BY id) FROM workhub.memberships m),'' )||COALESCE((SELECT string_agg(row_to_json(r)::text,'' ORDER BY id) FROM workhub.membership_roles r),'')) value
 UNION ALL SELECT 'F2','회원·학교',md5(COALESCE((SELECT string_agg(row_to_json(a)::text,'' ORDER BY id) FROM workhub.accounts a),'')||COALESCE((SELECT string_agg(row_to_json(s)::text,'' ORDER BY id) FROM workhub.schools s),''))
 UNION ALL SELECT 'F3','시간표 수업·학사 변경',md5(COALESCE((SELECT string_agg(row_to_json(l)::text,'' ORDER BY id) FROM workhub.timetable_lessons l),'')||COALESCE((SELECT string_agg(row_to_json(c)::text,'' ORDER BY id) FROM workhub.timetable_school_day_changes c),''))
 UNION ALL SELECT 'F4','실시 기록',md5(COALESCE((SELECT string_agg(row_to_json(r)::text,'' ORDER BY id) FROM workhub.timetable_execution_records r),''))
 UNION ALL SELECT 'F5','학년도·담당 배정',md5(COALESCE((SELECT string_agg(row_to_json(y)::text,'' ORDER BY id) FROM workhub.academic_years y),'')||COALESCE((SELECT string_agg(row_to_json(a)::text,'' ORDER BY id) FROM workhub.staff_assignments a),''))
 UNION ALL SELECT 'F6','기존 알림',md5(COALESCE((SELECT string_agg(row_to_json(n)::text,'' ORDER BY id) FROM workhub.notifications n),''))
)
SELECT 'P1' no,'T3 선행 설치' item,CASE WHEN to_regprocedure('workhub_private.t3_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone,text)') IS NOT NULL THEN 'ok' ELSE 'FAIL' END status,'AF1 전에 기존 INT-10 기준선을 별도로 보관' value
UNION ALL SELECT 'P2','AF1 설치 여부','info',COALESCE(to_regclass('workhub_private.af1_installs')::text,'미설치')
UNION ALL SELECT no,item,'compare',value FROM fingerprints ORDER BY no;
