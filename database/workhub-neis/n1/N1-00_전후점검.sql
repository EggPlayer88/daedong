-- 읽기 전용. 설치 전·후 CSV를 보관하고 F1~F3을 비교한다. 현재 적용된 확정본을 재실행하지 않는다.
SELECT 'N1-00-01' no,'기존 일정 기반' item,
 CASE WHEN to_regprocedure('public.workhub_calendar_save(text,jsonb)') IS NOT NULL AND to_regprocedure('workhub_private.p2_exact(jsonb,text[])') IS NOT NULL THEN 'ok' ELSE 'FAIL' END status,
 NULL::text value
UNION ALL SELECT 'N1-00-02','나이스 설치 여부','info',COALESCE(to_regnamespace('neis_private')::text,'미설치')
UNION ALL SELECT 'F1','기존 함수 원문','compare',md5(string_agg(n.nspname||'.'||p.proname||pg_get_function_identity_arguments(p.oid)||pg_get_functiondef(p.oid),E'\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname LIKE 'workhub%' OR n.nspname IN ('public','auth')) AND p.prokind='f' AND p.proname NOT LIKE 'workhub_neis_%'
UNION ALL SELECT 'F2','기존 회원 자료','compare',md5(COALESCE((SELECT string_agg(to_jsonb(u)::text,E'\n' ORDER BY id) FROM public.users u),''))
UNION ALL SELECT 'F3','기존 일정 자료','compare',md5(COALESCE((SELECT string_agg(to_jsonb(e)::text,E'\n' ORDER BY id) FROM workhub.events e),''))
ORDER BY no;
