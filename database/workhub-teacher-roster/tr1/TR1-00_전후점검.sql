-- 읽기 전용. 설치 직전/직후 CSV의 F1~F4를 비교한다. 앱에서 명부를 입력하기 전에 비교한다.
SELECT 'TR1-00-01' no,'P9·수업·담임·T1 기반' item,
 CASE WHEN to_regprocedure('workhub_private.p9_teacher_assignable(text,text)') IS NOT NULL
 AND to_regclass('workhub.course_assignments') IS NOT NULL AND to_regclass('workhub.staff_assignments') IS NOT NULL
 AND to_regclass('workhub.timetable_course_links') IS NOT NULL THEN 'ok' ELSE 'FAIL' END status,NULL::text value
UNION ALL SELECT 'TR1-00-02','명부 설치 여부','info',COALESCE(to_regnamespace('teacher_roster')::text,'미설치')
UNION ALL SELECT 'F1','기존 함수 원문','compare',md5(string_agg(n.nspname||'.'||p.proname||pg_get_function_identity_arguments(p.oid)||replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),E'\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND (n.nspname LIKE 'workhub%' OR n.nspname IN('public','auth','neis_private','site_presentation')) AND p.proname NOT LIKE 'workhub_teacher_roster_%'
UNION ALL SELECT 'F2','기존 회원·소속·역할','compare',md5(concat(
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM public.users x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.memberships x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY to_jsonb(x)::text) FROM workhub.membership_roles x)))
UNION ALL SELECT 'F3','기존 시간표','compare',md5(concat(
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.timetable_drafts x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.timetable_lessons x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.timetable_publications x)))
UNION ALL SELECT 'F4','기존 수업·담임·교과','compare',md5(concat(
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.courses x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.course_assignments x),
 (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY id) FROM workhub.staff_assignments x)))
ORDER BY no;
