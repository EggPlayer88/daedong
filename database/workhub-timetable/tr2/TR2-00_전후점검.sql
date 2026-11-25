-- TR2-00: 설치 전후 CSV를 비교한다. 읽기 전용이며 자료를 변경하지 않는다.
WITH evidence AS (
 SELECT 'P1' no,'전신 TR1·T2 설치' item,
  CASE WHEN to_regprocedure('teacher_roster.actor(text,boolean)') IS NOT NULL AND to_regprocedure('workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone)') IS NOT NULL THEN 'ok' ELSE 'FAIL' END status,
  current_database() value
 UNION ALL SELECT 'P2','명부 운영 연결 설치 상태','info',CASE WHEN to_regnamespace('timetable_roster_bridge') IS NULL THEN '미설치' ELSE '설치됨' END
 UNION ALL SELECT 'F1','기존 계정·소속·권한','compare',md5(coalesce(string_agg(v::text,chr(10) ORDER BY v::text),'')) FROM (
  SELECT 'account' k,to_jsonb(t) v FROM workhub.accounts t UNION ALL SELECT 'membership',to_jsonb(t) FROM workhub.memberships t UNION ALL SELECT 'role',to_jsonb(t) FROM workhub.membership_roles t) a
 UNION ALL SELECT 'F2','현재 기준판·기존 편성·날짜별 자료','compare',md5(coalesce(string_agg(v::text,chr(10) ORDER BY v::text),'')) FROM (
  SELECT to_jsonb(t) v FROM workhub.terms t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_prep_drafts t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_prep_draft_revisions t UNION ALL SELECT to_jsonb(t)-'roster_source_id' FROM workhub.timetable_basis_revisions t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_drafts t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_lessons t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_lesson_versions t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_publications t UNION ALL SELECT to_jsonb(t) FROM workhub.timetable_exchange_requests t) b
 UNION ALL SELECT 'F3','교사 명부·확정 기본표·수업 담당','compare',md5(coalesce(string_agg(v::text,chr(10) ORDER BY v::text),'')) FROM (
  SELECT to_jsonb(t) v FROM teacher_roster.plans t UNION ALL SELECT to_jsonb(t) FROM teacher_roster.links t UNION ALL SELECT to_jsonb(t) FROM workhub.courses t UNION ALL SELECT to_jsonb(t) FROM workhub.course_assignments t) c
 UNION ALL SELECT 'F4','기존 시간표·명부 내부 함수','compare',md5(string_agg(p.oid::regprocedure::text||chr(10)||replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),chr(10) ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='teacher_roster' OR n.nspname='workhub_private' AND (p.proname LIKE 't1_%' OR p.proname LIKE 't2_%' OR p.proname LIKE 't3_%')
) SELECT no,item,status,value FROM evidence ORDER BY CASE WHEN no LIKE 'P%' THEN 0 ELSE 1 END,no;
