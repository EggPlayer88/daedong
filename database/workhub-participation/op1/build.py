"""INT-09 확정 목록으로 원문을 잠근 뒤 참여 진입점만 교체하는 새 증분을 만든다."""
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
SCOPES=json.loads((ROOT/'apps/workhub/src/participation/scopes.json').read_text(encoding='utf-8'))
BASE=ROOT/'database/workhub-messaging-pilot/mp1/INT-09_SQL편집기용_통합점검.sql'

def baseline():
 d=json.loads(BASE.read_text(encoding='utf-8').split('$mp1data$')[1]);latest={}
 attrs=[None if ids is None else dict(d['p'][i] for i in ids) for ids in d['a']]
 for s,t,k,a in d['r']:
  if d['t'][t]=='function':latest[d['k'][k]]=attrs[a]
 return latest

def scope_for(name):
 for prefix,scope in [('public.workhub_calendar_','calendar'),('public.workhub_task_','tasks'),
  ('public.workhub_cooperation_','cooperation'),('public.workhub_collection_','collections'),
  ('public.workhub_school_transition_','transitions'),('public.workhub_teaching_','teaching'),
  ('public.workhub_timetable_','timetable')]:
  if name.startswith(prefix):return scope
 if name in ['public.workhub_file_'+n for n in ['prepare','complete','status','access']]:return 'collections'
 return {'workhub_storage.object_insertable':'collections','workhub_storage.object_readable':'collections',
  'workhub_private.c_basic_member':'collections'}.get(name)

def patches():
 result=[]
 extra={'workhub_private.p2_coop_apply':'cooperation','workhub_private.p7_recipient_ok':'transitions',
 'workhub_private.p7_tr_mutate':'transitions','workhub_private.p8_handover_recheck':'transitions','workhub_private.t3_member':'timetable'}
 for key,a in baseline().items():
  if not a:continue
  name=key.split('(')[0];scope=scope_for(name);steps=[]
  if scope:steps.append(['workhub_private.member_actor(',f'workhub_private.op1_actor_{scope}('])
  reachable=extra.get(name) or ('cooperation' if name=='public.workhub_cooperation_catalog' else None)
  if reachable:steps.append(['workhub_private.p2_member_reachable(',f'workhub_private.op1_reachable_{reachable}('])
  if name=='workhub_private.mp1_allowed':steps.append(['SELECT EXISTS (',"SELECT workhub_private.op1_allowed(p_school,p_member,'messages') OR EXISTS ("])
  if name=='workhub_private.mp1_actor':steps.append(['PERFORM 1 FROM workhub.messaging_pilot_grants WHERE singleton FOR SHARE;',
   'PERFORM 1 FROM workhub.messaging_pilot_grants WHERE singleton FOR SHARE;\n     PERFORM 1 FROM workhub.participant_grants WHERE school_id=s.id AND membership_id=m.id FOR SHARE;'])
  if name=='workhub_private.t2_approvers':steps.append(["WHERE m.school_id = p_school AND m.status = 'active'", "WHERE workhub_private.op1_reachable(p_school,m.id,'timetable') AND m.school_id = p_school AND m.status = 'active'"])
  if not steps:continue
  args=key[key.index('(')+1:-1]
  signature=name+'('+','.join(x.strip().split(' ',1)[1] for x in args.split(','))+')'
  result.append(dict(key=key,signature=signature,attrs=a,steps=steps,scope=scope or reachable or 'messages'))
 return result

def build():
 items=patches();payload=json.dumps(items,ensure_ascii=False,separators=(',',':'))
 valid="p IS NOT NULL AND cardinality(p) BETWEEN 1 AND %d AND array_position(p,NULL) IS NULL AND p <@ ARRAY[%s]::text[] AND cardinality(p)=(SELECT count(DISTINCT x) FROM unnest(p) x)"%(len(SCOPES),','.join("'%s'"%s['id'] for s in SCOPES))
 for s in SCOPES:
  if s['requires']:valid+=" AND (NOT '%s'=ANY(p) OR ARRAY[%s]::text[] <@ p)"%(s['id'],','.join("'%s'"%x for x in s['requires']))
 wrappers=''
 for s in SCOPES:
  scope=s['id']
  wrappers+=f"""CREATE FUNCTION workhub_private.op1_actor_{scope}(p_member_id text,p_lock boolean) RETURNS workhub_private.actor_context
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT workhub_private.op1_actor(p_member_id,p_lock,'{scope}') $$;
CREATE FUNCTION workhub_private.op1_reachable_{scope}(p_school text,p_member text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT workhub_private.op1_reachable(p_school,p_member,'{scope}') $$;
REVOKE ALL ON FUNCTION workhub_private.op1_actor_{scope}(text,boolean),workhub_private.op1_reachable_{scope}(text,text) FROM PUBLIC,anon,authenticated,service_role;
"""
 guard="""BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE x jsonb;p pg_proc;api text;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'OP1: SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF to_regclass('workhub_private.op1_installs') IS NOT NULL THEN RAISE EXCEPTION 'OP1: 이미 설치했습니다. 사후 점검을 사용하세요.';END IF;
 IF to_regclass('workhub_private.mp1_installs') IS NULL THEN RAISE EXCEPTION 'OP1: MP1과 INT-09 기준선이 필요합니다.';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements($patches$"""+payload+"""$patches$::jsonb) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(x->>'signature');
  SELECT coalesce(string_agg(r,' ' ORDER BY r),'') INTO api FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,p.oid,'EXECUTE');
  IF p.oid IS NULL OR md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM x->'attrs'->>'body'
  OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR api IS DISTINCT FROM x->'attrs'->>'eff' OR (SELECT lanname FROM pg_language WHERE oid=p.prolang) IS DISTINCT FROM x->'attrs'->>'lang'
  OR pg_get_function_result(p.oid) IS DISTINCT FROM x->'attrs'->>'result'
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') THEN
   RAISE EXCEPTION 'OP1: 원본·소유자·실효 권한 불일치: %',x->>'signature';END IF;
 END LOOP;
END $guard$;
"""
 # 모든 대상은 서명과 기존 본문을 먼저 확인한다. 이름 패턴만으로 운영 함수를 찾아 바꾸지 않는다.
 patch="""DO $patch$
DECLARE x jsonb;s jsonb;definition text;body text;changed boolean;
BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements($patches$"""+payload+"""$patches$::jsonb) LOOP
  SELECT pg_get_functiondef(oid),replace(prosrc,chr(13),'') INTO definition,body FROM pg_proc WHERE oid=to_regprocedure(x->>'signature');
  definition:=replace(definition,chr(13),'');changed:=false;
  FOR s IN SELECT value FROM jsonb_array_elements(x->'steps') LOOP
   IF position(s->>0 IN body)>0 THEN definition:=replace(definition,s->>0,s->>1);changed:=true;END IF;
  END LOOP;
  IF NOT changed THEN RAISE EXCEPTION 'OP1: 변경할 진입점이 없습니다: %',x->>'signature';END IF;
  EXECUTE definition;
 END LOOP;
END $patch$;
"""
 return '-- OP1-01 지정 계정 업무 참여 경로. 설치만으로 계정·권한·정책을 활성화하지 않습니다.\n'+guard+f"CREATE FUNCTION workhub_private.op1_valid_scopes(p text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT {valid} $$;\n"+(HERE/'core.sql.inc').read_text(encoding='utf-8')+'\n'+wrappers+patch+(HERE/'grant.sql.inc').read_text(encoding='utf-8')+"\nINSERT INTO workhub_private.op1_installs(batch) VALUES('OP1-01');\nNOTIFY pgrst,'reload schema';\nCOMMIT;\nSELECT 'OP1-01' AS no,'ok' AS status,'설치 완료 · 계정 허용 0명' AS detail;\n"

if __name__=='__main__':
 target=HERE/'OP1-01_업무참여_모델과함수.sql';text=build()
 if sys.argv[1:]==['write']:
  target.write_text(text,encoding='utf-8',newline='\n')
  (HERE/'patches.json').write_text(json.dumps(patches(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 else:assert target.read_text(encoding='utf-8')==text
 print('OP1 진입점',len(patches()))
