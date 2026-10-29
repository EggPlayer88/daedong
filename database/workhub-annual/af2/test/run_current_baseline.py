"""현재 운영 설치 조합(INT-10/OP1) 위에서 AF1·AF2를 함께 검증한다.
접속 정보는 받지 않는다. 공통 실행기가 새 localhost PG17만 만들고 종료한다.
확정 SQL·카탈로그를 재생성하거나 운영 DB에 접속하지 않는다.
"""
from pathlib import Path
import os,sys,re
ROOT=Path(__file__).resolve().parents[4]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55659')
sys.path.insert(0,str(ROOT/'database/workhub-deployment/integration/test'))
import run_integrated as I
q=I.run;check=I.H.check
AF1=ROOT/'database/workhub-annual/af1'
AF2=ROOT/'database/workhub-annual/af2'
OP1=ROOT/'database/workhub-participation/op1'
def sql(folder,prefix):return next(folder.glob(prefix+'_*.sql')).read_text('utf-8')
def rows_ok(rows,n):return len(rows)==n and all(r[2]!='FAIL' for r in rows)
def fingerprint(folder,prefix):return {r[0]:r[3] for r in q(sql(folder,prefix)) if r[0].startswith('F')}
def functions():return dict(q("select oid::regprocedure::text,pg_get_functiondef(oid)||pg_get_userbyid(proowner)||coalesce(proacl::text,'') from pg_proc where pronamespace in ('workhub_private'::regnamespace,'public'::regnamespace) and prokind='f'"))
def denied(label,op,inp,mid,uid):
 try:out=I.rpc('workhub_collection_presentation',mid,op,inp,None,uid=uid)
 except Exception as ex:check(label,'FORBIDDEN' in str(ex) or 'INACTIVE_MEMBERSHIP' in str(ex));return
 check(label,out.get('error',{}).get('code') in ('FORBIDDEN','INACTIVE_MEMBERSHIP'))
def tests():
 import gen_int_05 as G
 I.Q('create database '+I.DB+' owner postgres template p9_manifest',user='supabase_admin',db='postgres')
 for stage,files,deps in G.g.gm.STAGES[1:]:
  for name in files:I.apply(Path(G.g.gm.WH)/name,name.endswith('P7-05_R1_P2_보강_별도승인.sql'))
 for stage,files,deps in G.g.T1_STAGES:
  for name in files:I.apply(Path(G.g.T1)/name)
 for folder,prefix in [('workhub-storage-download/s1','S1-01'),('workhub-storage-download/s2','S2-01'),('workhub-storage-download/s3','S3-01'),('workhub-messaging-pilot/mp1','MP1-01')]:q(sql(ROOT/'database'/folder,prefix))
 q(sql(OP1,'OP1-01'))
 check('현재 INT-10 기준선 18행 FAIL 0',rows_ok(q(sql(OP1,'INT-10')),18))
 check('OP1 사후 점검 8행 FAIL 0',rows_ok(q(sql(OP1,'OP1-02')),8))
 # 합성 일반 교사 한 명과 기존 OP1 제한을 설치 전부터 둔다.
 school,admin=q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(I.H.ADMIN,))[0]
 uid=I.H.TEACHER;mid='af-op1-teacher'
 q("insert into workhub.accounts(id,auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,email,legacy_approval_state) select 'af-op1-account',id::uuid,id,'same_auth_user',now(),name,email,'approved' from public.users where id=%s",(uid,))
 q("insert into workhub.memberships(id,school_id,account_id,status,employment_type,valid_from,decided_at) values(%s,%s,'af-op1-account','active','teacher',current_date-1,now())",(mid,school))
 q("insert into workhub.participant_grants(school_id,membership_id,auth_user_id,scopes,active,expires_at,approved_by_membership_id,approval_ref,app_deploy_ref) values(%s,%s,%s,ARRAY['collections'],true,now()+interval '1 day',%s,'격리 회귀','격리 앱')",(school,mid,uid,admin))
 protected=['auth.users','public.users','public.doc_submissions','storage.objects','workhub.accounts','workhub.memberships','workhub.membership_roles','workhub.participant_grants','workhub.module_activations','workhub.ai_credentials','workhub.ai_gateway_requests']
 before=I.preserve(protected);func_before=functions();f1=fingerprint(AF1,'AF1-00')
 check('운영 조합 AF1 사전 점검 P1 ok',next(r for r in q(sql(AF1,'AF1-00')) if r[0]=='P1')[2]=='ok')
 q(sql(AF1,'AF1-01'))
 # 이전 AF1-02는 OP1 해시를 모르므로 중간에 멈췄다. 그 실패도 전체 트랜잭션으로 되돌아간다.
 broken=sql(AF1,'AF1-02').replace('390c1fa721426116119dc19c4ba96078','7920e6628ffce39ceefab33e01d84898')
 prior=functions()
 try:q(broken)
 except Exception as ex:check('수정 전 OP1 함수 원문 불일치 재현','p7_tr_mutate 원문 불일치' in str(ex))
 else:check('수정 전 OP1 함수 원문 불일치 재현',False)
 check('실패한 AF1-02는 앞 함수 교체도 전부 롤백',functions()==prior and not q("select 1 from workhub_private.af1_installs where batch='AF1-02'"))
 for prefix in ('AF1-02','AF1-03','AF1-04'):q(sql(AF1,prefix))
 check('OP1 위 AF1 사후 점검 8행 모두 ok',all(r[2]=='ok' for r in q(sql(AF1,'AF1-05'))) and len(q(sql(AF1,'AF1-05')))==8)
 check('AF1 설치 전후 F1~F6 동일',f1==fingerprint(AF1,'AF1-00'))
 body=q("select prosrc from pg_proc where oid='workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)'::regprocedure")[0][0]
 check('인계의 OP1 참여 판정 보존',body.count('workhub_private.op1_reachable_transitions(')==1 and 'workhub_private.p2_member_reachable(' not in body)
 expected=set()
 for path in AF1.glob('AF1-0[1-4]*.sql'):expected.update(re.findall(r"f regprocedure:='([^']+)'",path.read_text('utf-8')))
 # regprocedure 출력은 timestamp with time zone을 줄일 수 있으므로 서버 이름으로 정규화한다.
 expected={q('select %s::regprocedure::text',(name,))[0][0] for name in expected}
 after=functions();changed={name for name,value in func_before.items() if after.get(name)!=value}
 check('AF1 승인한 기존 함수 외 정의·소유자·권한 보존',changed==expected)
 f2=fingerprint(AF2,'AF2-00');check('운영 조합 AF2 사전 점검 P1 ok',next(r for r in q(sql(AF2,'AF2-00')) if r[0]=='P1')[2]=='ok')
 q(sql(AF2,'AF2-01'))
 check('AF2 사후 점검 4행 모두 ok',len(q(sql(AF2,'AF2-02')))==4 and all(r[2]=='ok' for r in q(sql(AF2,'AF2-02'))))
 check('AF2 설치 전후 F1~F4 동일',f2==fingerprint(AF2,'AF2-00'))
 check('동시 설치 뒤 회원·소속·역할·참여범위·자료·AI 원장 보존',before==I.preserve(protected))
 out=I.rpc('workhub_collection_presentation',mid,'statuses',{'ids':[]},None,uid=uid)
 check('기존 OP1 수합 허용 교사의 상태 조회',out.get('data',{}).get('items')==[])
 original=q("select pg_get_functiondef('public.workhub_collection_presentation(text,text,jsonb,text)'::regprocedure)")[0][0]
 # 보완 전 member_actor만 사용하던 버전은 같은 교사를 막았다.
 old=original.replace("p_operation='statuses' AND to_regprocedure", "false AND to_regprocedure")
 q(old);denied('수정 전 OP1 교사 상태 조회 거절 재현','statuses',{'ids':[]},mid,uid);q(original)
 for op in ('targets','publish','recover'):denied('일반 교사 양식 권한을 확대하지 않음 '+op,op,{},mid,uid)
 denied('다른 소속 ID 상태 조회 차단','statuses',{'ids':[]},admin,uid)
 out=I.rpc('workhub_collection_presentation',mid,'statuses',{'ids':['other-collection']},None,uid=uid)
 check('허용 교사도 접근할 수 없는 수합은 NOT_FOUND',out.get('error',{}).get('code')=='NOT_FOUND')
 for label,update in [('참여 중지',"active=false"),('허용 기한 만료',"expires_at=now()-interval '1 second'"),('수합 범위 없음',"scopes=ARRAY['calendar']")]:
  q('update workhub.participant_grants set '+update+' where membership_id=%s',(mid,))
  denied(label+' 상태 조회 거절','statuses',{'ids':[]},mid,uid)
  q("update workhub.participant_grants set active=true,expires_at=now()+interval '1 day',scopes=ARRAY['collections'] where membership_id=%s",(mid,))
 check('두 패키지 뒤 공통 인증 게이트 정의 보존',all(functions()[name]==func_before[name] for name in func_before if name.startswith(('workhub_private.member_actor(','workhub_private.legacy_gate(','workhub_private.op1_actor('))))
 check('최종 AF1·AF2 점검 FAIL 0',rows_ok(q(sql(AF1,'AF1-05')),8) and rows_ok(q(sql(AF2,'AF2-02')),4))
 print('현재 운영 조합 + AF1 + AF2 PASS',I.H.PASS,'FAIL 0',flush=True)
I.H.tests=tests
if __name__=='__main__':I.H.main()
