-- 읽기 전용. P9 국소 점검이다. 기존 T2-07 전체 기대 지문을 대신한다고 주장하지 않는다.
WITH tables AS(
 SELECT c.oid,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='workhub' AND c.relname IN('school_roster_policies','school_roster_previews','school_roster_requests','school_roster_links') AND c.relkind='r'
),f AS(
 SELECT p.oid,p.prosecdef,p.proconfig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('workhub_school_roster_get','workhub_school_roster_preview','workhub_school_roster_commit','workhub_school_roster_close')
)
SELECT 'P9-04-01' no,'신규 4표 RLS + API 직접 권한 0' item,
 CASE WHEN (SELECT count(*) FROM tables)=4 AND NOT EXISTS(SELECT 1 FROM tables WHERE NOT relrowsecurity
 OR has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END status
UNION ALL
SELECT 'P9-04-02','공개 RPC 4개, search_path 고정, authenticated만',
 CASE WHEN (SELECT count(*) FROM f)=4 AND NOT EXISTS(SELECT 1 FROM f WHERE NOT prosecdef OR NOT('search_path=""'=ANY(proconfig))
 OR has_function_privilege('anon',oid,'EXECUTE') OR NOT has_function_privilege('authenticated',oid,'EXECUTE')) THEN 'ok' ELSE 'FAIL' END
UNION ALL
SELECT 'P9-04-03','내부 함수 API 실행 0',CASE WHEN NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='workhub_private'::regnamespace AND p.proname LIKE 'p9_%'
 AND(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END
UNION ALL
SELECT 'P9-04-04','연결 원장 UID 정확 일치',CASE WHEN NOT EXISTS(SELECT 1 FROM workhub.school_roster_links l JOIN workhub.accounts a ON a.id=l.account_id
 WHERE a.auth_user_id<>l.legacy_user_id OR a.legacy_user_id<>l.legacy_user_id::text OR a.legacy_link_method<>'same_auth_user') THEN 'ok' ELSE 'FAIL' END
UNION ALL
SELECT 'P9-04-05','수업 담당 후보 함수 4개만 분리',
 CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname IN('p5_catalog','p5_course_create','p8_rel_snapshot','p8_rel_eval')
 AND pg_get_functiondef(oid) LIKE '%workhub_private.p9_teacher_assignable%')=4 THEN 'ok' ELSE 'FAIL' END
ORDER BY no;
