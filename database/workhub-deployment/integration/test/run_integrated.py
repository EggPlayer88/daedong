"""운영 DSN 없이 새 localhost PG17에 전체 구축 증분을 순차 설치하고 점검한다."""
from pathlib import Path
import os,sys,json,subprocess
# 공통 실행기를 거치지 않아도 외부 접속·자격증명·libpq 옵션을 받지 않는다.
external={'DATABASE_URL','WORKHUB_TEST_DATABASE_URL','SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ANTHROPIC_API_KEY'}
if any(value and (name.upper().startswith('PG') or name.upper() in external) for name,value in os.environ.items()):
 raise RuntimeError('외부 접속 정보나 자격증명 환경변수가 있으면 통합 시험을 시작하지 않습니다.')
if len(sys.argv)!=1:raise RuntimeError('통합 시험은 인자를 받지 않습니다. 운영 DSN을 지정할 수 없습니다.')
if __name__=='__main__':
 subprocess.run([sys.executable,str(Path(__file__).with_name('test_runner_safety.py'))],check=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
os.environ["P9_PG_BIN"]=os.environ.get("WORKHUB_DEPLOYMENT_PG_BIN",os.environ.get("P9_PG_BIN",""))
os.environ["P9_TEST_PORT"]=os.environ.get("WORKHUB_DEPLOYMENT_TEST_PORT","55609")
sys.path.insert(0,str(ROOT/"database/workhub-school-data/p9/test"))
import run_p9 as H
Q=H.q
REPORT=Path(os.environ.get("WORKHUB_DEPLOYMENT_REPORT",str(H.WORK/"reports"))).resolve()
REPORT.mkdir(parents=True,exist_ok=True)
DB="int05_stages"
def run(sql,args=None,user="postgres"):return Q(sql,args,user=user,db=DB)
def read(path):return Path(path).read_text(encoding="utf-8")
def stage_file(folder,prefix):
 rows=list((ROOT/folder).glob(prefix+"_*.sql"))
 if len(rows)!=1:raise RuntimeError("단계 파일 중복/누락: "+folder+"/"+prefix)
 return rows[0]
def digest(table):
 return run("select md5(coalesce(string_agg(x::text,chr(10) order by x::text),'')),count(*) from (select to_jsonb(t) x from "+table+" t) z")[0]
def preserve(tables):return {table:digest(table) for table in tables}
def apply(path,fill=False):
 text=read(path)
 if fill:
  import gen_int_05
  text=gen_int_05.g.gm.fill_p705(text)
 run(text)
def rpc(name,*args,uid=H.ADMIN,role="authenticated"):
 with H.connect(db=DB) as c:
  with c.cursor() as cur:
   cur.execute("set role "+role)
   if role=="authenticated":cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(uid,))
   cur.execute("select public."+name+"("+",".join(["%s"]*len(args))+")",tuple(json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for v in args))
   return cur.fetchone()[0]
def tests():
 import gen_int_05 as G
 # 두 번째 DB는 R0만 설치된 자체 템플릿으로 복사한다. 기존/원격 DB를 받지 않는다.
 Q("create database "+DB+" owner postgres template p9_manifest",user="supabase_admin",db="postgres")
 manifest=G.generate()
 def report():return run(manifest)
 def check_report(label):
  rows=report();H.check(label,len(rows)==18 and all(row[2]!="FAIL" for row in rows))
  return rows
 check_report("새 INT-05가 R0 기준선에서 FAIL 0")
 protected=["auth.users","public.users","public.doc_submissions","storage.objects","workhub.accounts","workhub.memberships","workhub.membership_roles"]
 before=preserve(protected)
 stage_results=[]
 active_before=None
 gate_before=run("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]
 for stage,files,deps in G.g.gm.STAGES[1:]:
  for name in files:apply(Path(G.g.gm.WH)/name,name.endswith("P7-05_R1_P2_보강_별도승인.sql"))
  stage_results.append({"stage":stage,"checks":check_report(stage+" 설치 뒤 INT-05 FAIL 0")})
 for stage,files,deps in G.g.T1_STAGES:
  for name in files:apply(Path(G.g.T1)/name)
  stage_results.append({"stage":stage,"checks":check_report(stage+" 설치 뒤 INT-05 FAIL 0")})
  if stage=="T2-06":
   school,member=run("select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s",(H.ADMIN,))[0]
   run("insert into workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) values(%s,%s,'합성 기존 학교 관리 활성화','active')",(school,member))
   for module in ("teaching","timetable","assistant"):
    run("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,%s,'active',%s,'합성 기존 활성화')",(school,module,member))
   # 미적용 AI SQL이 이전에 시작된 요청도 보존/이관하는지 실제 원장을 만든다.
   run("insert into workhub.assistant_policies(school_id,version,approved_by_membership_id,approval_ref,verification_ref,allowed_members,model,price_table_ref,input_price_micro_usd_per_mtok,output_price_micro_usd_per_mtok,max_input_tokens,max_output_tokens,reserve_micro_usd,member_daily_micro_usd,member_monthly_micro_usd,school_daily_micro_usd,school_monthly_micro_usd) values(%s,1,%s,'합성 이전 승인','합성','all_members','old-model','합성',100000,500000,80000,8000,12000,100000000,100000000,100000000,100000000)",(school,member))
   old_input=dict(mode='school',intent='school_advice',prompt='통합 시험 이전 요청',threadId=None,expectedVersion=0,references=[],studentContext=None)
   old_key='int05-existing-p6-request'
   old=rpc('workhub_ai_prepare',H.ADMIN,member,old_input,old_key,role='service_role')
   old_lease=old['data']['leaseToken']
   rpc('workhub_ai_start',H.ADMIN,member,old_key,old_lease,role='service_role')
   old_requests=digest('workhub.assistant_requests')
   active_before=preserve(["workhub.school_admin_activations","workhub.module_activations"])
 H.check("미적용 전체 설치 중 회원·소속·제출·Storage 목록 보존",preserve(protected)==before)
 H.check("기존 P1·P5·T1 활성화 자료 그대로",active_before==preserve(["workhub.school_admin_activations","workhub.module_activations"]))
 H.check("기존 로그인·승인 게이트 본문 보존",gate_before==run("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0])
 for table in ("school_roster_policies","school_data_policies","timetable_intervention_policies","ai_school_policies","ai_credentials","ai_legacy_school_links","ai_memory_controls"):
  H.check(table+" 새 정책·키·연결 행 자동 생성 0",digest("workhub."+table)[1]==0)
 for folder,prefix in [("database/workhub-school-data/p9","P9-04"),("database/workhub-school-data/p10","P10-04"),("database/workhub-timetable/t3","T3-04"),("database/workhub-timetable/t4","T4-02"),("database/workhub-ai-policy/p10","P10-04"),("database/workhub-ai-policy/p10","P10-11"),("database/workhub-knowledge-history/k1","K1-02"),("database/workhub-ai-memory/m1","M1-02")]:
  rows=run(read(stage_file(folder,prefix)))
  H.check(folder+"/"+prefix+" 최종 동시설치 국소 점검 FAIL 0",all(row[2]!="FAIL" for row in rows))
 H.check("설치 중 기존 P6 원장 내용·예약 그대로",digest('workhub.assistant_requests')==old_requests)
 H.check("이전 시작 요청 공통 원장에 한 번만 이관",run("select count(*),min(origin) from workhub.ai_gateway_requests where request_key=%s",(old_key,))[0]==(1,'legacy_p6'))
 old_result=dict(state='completed',usage=dict(inputTokens=100,outputTokens=10),providerMessageId='msg_int05_legacy',segments=[dict(text='합성 기존 답변',citations=[])],taskDraft=None)
 done=rpc('workhub_ai_finish',H.ADMIN,member,old_key,old_lease,old_result,role='service_role')
 H.check("모든 증분 뒤에도 이전 요청 원번호 종료·이중 원장 정산",done['data']['state']=='completed' and run('select actual_micro_usd from workhub.ai_gateway_requests where request_key=%s',(old_key,))[0][0]==15)
 H.check("학교 자료 P10과 학교 AI P10 설치 기록 분리",run("select (select count(*) from workhub_private.p10_installs),(select count(*) from workhub_private.p10_ai_installs)")[0]==(2,5))
 H.check("학교 AI 설치 뒤 기존 직접 prepare/start 권한은 의도대로 차단",run("select not has_function_privilege('service_role','public.workhub_ai_prepare(uuid,text,jsonb,text)','execute') and not has_function_privilege('service_role','public.workhub_ai_start(uuid,text,text,text)','execute')")[0][0])
 mutations=[
  ("M1 RLS 해제","alter table workhub.ai_memories disable row level security","alter table workhub.ai_memories enable row level security"),
  ("K1 익명 실행","grant execute on function public.workhub_knowledge_get(text,text,integer) to anon","revoke execute on function public.workhub_knowledge_get(text,text,integer) from anon"),
  ("M1 원장 보호 해제","alter table workhub.ai_memory_requests disable trigger ai_memory_requests_immutable","alter table workhub.ai_memory_requests enable trigger ai_memory_requests_immutable"),
  ("M1 직접 표 읽기","grant select on workhub.ai_memories to authenticated","revoke select on workhub.ai_memories from authenticated"),
  ("M1 직접 열 읽기","grant select(body) on workhub.ai_memories to anon","revoke select(body) on workhub.ai_memories from anon"),
  ("스키마 접근","grant usage on schema workhub_private to authenticated","revoke usage on schema workhub_private from authenticated"),
  ("M1 열 추가","alter table workhub.ai_memories add column unexpected_note text","alter table workhub.ai_memories drop column unexpected_note"),
  ("M1 잘못된 기본값","alter table workhub.ai_memories alter column enabled set default true","alter table workhub.ai_memories alter column enabled drop default"),
  ("추가 인덱스","create index int05_bad_index on workhub.ai_memories(title)","drop index workhub.int05_bad_index"),
  ("K1 함수 누락","alter function public.workhub_knowledge_get(text,text,integer) rename to int05_bad_get","alter function public.int05_bad_get(text,text,integer) rename to workhub_knowledge_get"),
  ("M1 함수 소유자 변경","alter function public.workhub_ai_memory_list(text) owner to supabase_admin","alter function public.workhub_ai_memory_list(text) owner to postgres"),
 ]
 for label,damage,restore in mutations:
  run(damage,user="supabase_admin" if label=="M1 함수 소유자 변경" else "postgres");H.check("통합 점검이 "+label+" 검출",any(row[2]=="FAIL" for row in report()))
  run(restore,user="supabase_admin" if label=="M1 함수 소유자 변경" else "postgres");check_report(label+" 복원 뒤 FAIL 0")
 # 원본 함수 본문 훼손과 다른 함수의 오버로드도 별도로 고정한다.
 definition=run("select pg_get_functiondef('public.workhub_ai_memory_list(text)'::regprocedure)")[0][0]
 run(definition.replace("DECLARE","DECLARE\n-- 합성 훼손\n",1))
 H.check("함수 본문 훼손 검출",any(row[2]=="FAIL" for row in report()));run(definition);check_report("함수 본문 복원")
 run("create function public.workhub_ai_memory_list(text,integer) returns jsonb language sql as 'select null::jsonb'")
 H.check("같은 이름 다른 인자 검출",any(row[2]=="FAIL" for row in report()));run("drop function public.workhub_ai_memory_list(text,integer)");check_report("오버로드 제거 복원")
 from app_cases import exercise
 app_captures=exercise(H,run,rpc,REPORT,ROOT)
 check_report("합성 API 동작 뒤 최종 구조 점검 FAIL 0")
 with H.connect(db=DB) as c:
  with c.cursor() as cur:
   cur.execute('begin read only');cur.execute(manifest);readonly_rows=cur.fetchall();cur.execute('rollback')
 H.check("INT-05 실제 읽기 전용 트랜잭션 실행",len(readonly_rows)==18 and all(row[2]!='FAIL' for row in readonly_rows))
 (REPORT/"stage-results.json").write_text(json.dumps(stage_results,ensure_ascii=False,indent=2),encoding="utf-8")
 (REPORT/"summary.json").write_text(json.dumps({"passed":H.PASS,"failed":0,"stages":len(stage_results),"manifestRows":len(report()),"appCaptures":app_captures,"productionDbApplied":False,"realProviderCalls":0,"realMembershipLinks":0,"preservedTables":protected,"baselineActivationsPreserved":True},ensure_ascii=False,indent=2),encoding="utf-8")
 print("배포 통합 검증 기록",REPORT,flush=True)
H.tests=tests
if __name__=="__main__":H.main()
