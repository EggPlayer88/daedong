"""확정 P3 원문을 읽어 메신저 진입점만 바꾸는 증분을 만든다. 기존 파일은 쓰지 않는다."""
from pathlib import Path
import hashlib, json, re, sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'database/workhub-storage-download/s3/test'))
import build_s3_check as S3
BASE_ROWS,_=S3.S2.S1.parse(S3.S2.S1.SOURCE.read_text(encoding='utf-8'))
FUNCTION=re.compile(r'CREATE FUNCTION ([\w.]+)\((.*?)\) RETURNS (.*?)\n(LANGUAGE .*?) AS \$\$(.*?)\$\$;',re.S)
def digest(s):return hashlib.md5(s.encode()).hexdigest()
def changes():
 result=[]
 for filename in ('P3-01_메시지_알림_모델.sql','P3-02_메시지_공개함수_Storage.sql'):
  for match in FUNCTION.finditer((ROOT/'database/workhub/p3'/filename).read_text(encoding='utf-8')):
   name,args,returns,options,body=match.groups()
   if name=='workhub_private.p3_reachable':
    new=body.replace('workhub_private.p2_member_reachable(p_school, p_membership)',
      'workhub_private.p2_member_reachable(p_school, p_membership) OR workhub_private.mp1_allowed(p_school, p_membership)')
   elif 'workhub_private.member_actor(' in body:
    new=body.replace('workhub_private.member_actor(', 'workhub_private.mp1_actor(')
    if name=='workhub_storage.message_readable':
     new=new.replace("v_op NOT IN ('object.upload','object.get_authenticated')", "v_op NOT IN ('object.upload','object.get_authenticated','object.get_authenticated_info')")
     new=new.replace("v_op <> 'object.get_authenticated'", "v_op NOT IN ('object.get_authenticated','object.get_authenticated_info')")
   else:continue
   key=name+'('+args+')'
   attrs=[r[3] for r in BASE_ROWS if r[1:3]==['function',key]][-1]
   assert attrs['body']==digest(body),(key,attrs['body'],digest(body))
   signature=name+'('+','.join(a.strip().split()[1] for a in args.split(','))+')'
   result.append(dict(key=key,signature=signature,old=digest(body),new=digest(new),attrs=attrs,
     definition=f'CREATE OR REPLACE FUNCTION {key} RETURNS {returns}\n{options} AS $$'+new+'$$;'))
 assert len(result)==15,len(result)
 return result

def build():
 patches=changes()
 values=',\n'.join("('%s','%s','%s','%s','%s')"%(p['signature'],p['old'],p['attrs']['eff'],p['attrs']['lang'],'s' if ' STABLE ' in p['definition'] else 'v') for p in patches)
 guard="""BEGIN;
DO $guard$
DECLARE r record;p pg_proc; actual_api text;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'MP1: SQL Editor 관리 연결에서만 실행하세요.'; END IF;
 IF to_regclass('workhub_private.mp1_installs') IS NOT NULL THEN RAISE EXCEPTION 'MP1: 이미 설치했습니다. 재설치 대신 MP1-02로 확인해 주세요.'; END IF;
 IF to_regprocedure('public.workhub_school_roster_get(text)') IS NULL THEN RAISE EXCEPTION 'MP1: P9 설치가 필요합니다.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('workhub_storage.knowledge_readable(text,uuid)') AND md5(replace(prosrc,chr(13),''))='8bc5e3e6ef6762573f8230127b0dd70d') THEN RAISE EXCEPTION 'MP1: S3 설치와 INT-08 결과를 확인해 주세요.'; END IF;
 FOR r IN SELECT * FROM (VALUES
"""+values+"""
 ) v(signature,hash,api,lang,volatility) LOOP
   SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
   SELECT coalesce(string_agg(x,' ' ORDER BY x),'') INTO actual_api
   FROM unnest(ARRAY['anon','authenticated','service_role']) x WHERE has_function_privilege(x,p.oid,'EXECUTE');
   IF p.oid IS NULL OR md5(replace(p.prosrc,chr(13),''))<>r.hash
     OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.provolatile::text<>r.volatility OR (SELECT lanname FROM pg_language WHERE oid=p.prolang)<>r.lang
     OR actual_api<>r.api
     OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') THEN
     RAISE EXCEPTION 'MP1: 확정 P3 함수 원문·소유자·권한·속성이 다릅니다: %',r.signature;
   END IF;
 END LOOP;
END $guard$;
"""
 sql='-- MP1-01 일반 교사 한 명의 메신저 시범 경로 설치. 설치만으로 접근을 허용하지 않습니다.\n'+guard
 sql+=HERE.joinpath('core.sql.inc').read_text(encoding='utf-8')+'\n'
 sql+='\n'.join(p['definition'] for p in patches)
 sql+="\nINSERT INTO workhub_private.mp1_installs(batch) VALUES('MP1-01');\nCOMMIT;\nSELECT 'MP1-01' AS no,'메신저 시험 경로 설치 · 허용 명단은 비어 있음' AS item,'ok' AS status;\n"
 return sql

if __name__=='__main__':
 sql=build();target=HERE/'MP1-01_메신저시험_모델과함수.sql'
 if sys.argv[1:]==['write']:target.write_text(sql,encoding='utf-8',newline='\n')
 else:assert target.read_text(encoding='utf-8')==sql
 print('PASS MP1-01 확정 원문·메신저 한정 교체 15개')
