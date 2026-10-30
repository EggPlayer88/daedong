from pathlib import Path
import re,hashlib
root=Path('database/workhub-annual/af2')
s=next(root.glob('AF2-01*.sql')).read_text(encoding='utf-8')
items=[(name,hashlib.md5(body.replace('\r','').encode()).hexdigest()) for name,body in re.findall(r'CREATE FUNCTION ((?:public|workhub_private)\.[a-z0-9_]+)\(.*? AS \$\$(.*?)\$\$;',s,re.S)]
assert len(items)==4
values=',\n'.join("('%s','%s')"%row for row in items)
s="""-- AF2 설치 직후 읽기 전용 검사. 기존 INT 점검 원문은 유지한다.
WITH expected(name,hash) AS (VALUES
"""+values+"""
), f AS (
 SELECT e.*,p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,md5(replace(p.prosrc,chr(13),'')) actual
 FROM expected e LEFT JOIN pg_proc p ON p.pronamespace::regnamespace::text||'.'||p.proname=e.name
), checks AS (
 SELECT 'AF2-02-01' no,'신규 함수 4개' item,(SELECT count(*)=4 AND count(oid)=4 FROM f) ok
 UNION ALL SELECT 'AF2-02-02','함수 원문·소유자·search_path',NOT EXISTS(SELECT 1 FROM f WHERE oid IS NULL OR actual<>hash OR owner<>'postgres' OR NOT prosecdef OR ('search_path=""'=ANY(proconfig)) IS DISTINCT FROM TRUE)
 UNION ALL SELECT 'AF2-02-03','비공개 함수 실행 권한',NOT EXISTS(SELECT 1 FROM f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE name LIKE 'workhub_private.%' AND has_function_privilege(r,oid,'EXECUTE'))
 UNION ALL SELECT 'AF2-02-04','공개 RPC는 authenticated 전용',NOT EXISTS(SELECT 1 FROM f CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE name LIKE 'public.%' AND has_function_privilege(r,oid,'EXECUTE') IS DISTINCT FROM (r='authenticated'))
)
SELECT no,item,CASE WHEN ok THEN 'ok' ELSE 'FAIL' END status FROM checks ORDER BY no;
"""
(root/'AF2-02_사후점검.sql').write_text(s,encoding='utf-8')
print('AF2 함수 원문 4개 고정')
