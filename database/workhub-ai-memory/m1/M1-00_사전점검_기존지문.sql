-- 읽기 전용. 설치 전·후 결과를 저장해 F1~F8을 비교한다. 파일 본문은 비교하지 않는다.
-- M1 자체와 설치 기록은 기존 지문에서 제외한다. 기존 함수·표·권한·회원·제출 자료를 고치지 않는다.
WITH funcs AS(
 SELECT p.oid::regprocedure::text AS id,pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text AS body
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','workhub_private') AND p.prokind='f' AND p.proname NOT LIKE 'm1\_%' AND p.proname NOT LIKE 'workhub_ai_memory_%'
),rels AS(
 SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','workhub','workhub_private') AND c.relkind IN('r','p','v')
 AND NOT(n.nspname='workhub' AND c.relname IN('ai_memory_controls','ai_memories','ai_memory_requests'))
 AND NOT(n.nspname='workhub_private' AND c.relname='m1_installs')
),structure AS(
 SELECT r.nspname||'.'||r.relname AS id,jsonb_build_object('columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid::regtype::text,a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
 'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=r.oid),
 'acl',(SELECT jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,c.relowner::regrole::text) FROM pg_class c WHERE c.oid=r.oid))::text AS body FROM rels r
)
SELECT 'P1' AS part,'필수 P6 조회 함수 존재' AS item,CASE WHEN to_regprocedure('workhub_private.p6_installed()') IS NULL THEN 'FAIL' ELSE 'ok' END AS status,
 to_regprocedure('workhub_private.p6_installed()')::text AS fingerprint
UNION ALL SELECT 'P2','M1 설치 기록','info',to_regclass('workhub_private.m1_installs')::text
UNION ALL SELECT 'F1','기존 함수·실행권한·소유자','compare',md5(coalesce(string_agg(id||body,E'\n' ORDER BY id),'')) FROM funcs
UNION ALL SELECT 'F2','기존 표·열·제약·트리거·권한','compare',md5(coalesce(string_agg(id||body,E'\n' ORDER BY id),'')) FROM structure
UNION ALL SELECT 'F3','기존 회원','compare',md5(coalesce(string_agg(to_jsonb(u)::text,E'\n' ORDER BY u.id),'')) FROM public.users u
UNION ALL SELECT 'F4','인증 회원','compare',md5(coalesce(string_agg(to_jsonb(u)::text,E'\n' ORDER BY u.id),'')) FROM auth.users u
UNION ALL SELECT 'F5','기존 업무실 소속','compare',md5(coalesce(string_agg(to_jsonb(m)::text,E'\n' ORDER BY m.id),'')) FROM workhub.memberships m
UNION ALL SELECT 'F6','기존 업무실 감사','compare',md5(coalesce(string_agg(to_jsonb(a)::text,E'\n' ORDER BY a.id),'')) FROM workhub.audit_events a
UNION ALL SELECT 'F7','기존 평가계획 제출','compare',md5(coalesce(string_agg(to_jsonb(s)::text,E'\n' ORDER BY s.id),'')) FROM public.doc_submissions s
UNION ALL SELECT 'F8','기존 Storage 목록','compare',md5(coalesce(string_agg(to_jsonb(o)::text,E'\n' ORDER BY o.id),'')) FROM storage.objects o
ORDER BY part;
