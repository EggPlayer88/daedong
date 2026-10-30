"""새 localhost PG17 클러스터에서만 실행한다. 운영 DSN은 받지 않는다."""
from pathlib import Path
import os,sys,json,uuid,datetime,concurrent.futures
ROOT=Path(__file__).resolve().parents[4]
os.environ['P9_TEST_PORT']=os.environ.get('AF2_TEST_PORT','55649')
sys.path.insert(0,str(ROOT/'database/workhub-school-data/p9/test'))
import run_p9 as b
os.environ.update(R0_PGHOST='127.0.0.1',R0_PG_PORT=str(b.PORT),R1_DIR=str(ROOT/'database/workhub/r1'),P4_APP_SRC=str(ROOT))
sys.path.insert(0,str(ROOT/'database/workhub/p4/test'))
import run_p4 as p
q=b.q;check=b.check;data=p.data;key=p.key;CAP=[]
def tests():
 school=p.fixtures();mid=q('select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(p.U1,))[0][0]
 adm=p.P(p.U1,mid)
 policy=dict(approver_user_id=p.U1,approval_ref='격리 자동 시험',effective_from=p.DAY(-1),common_file_safety=dict(extensions=['pdf','hwpx'],maxFileBytes=10000000,maxFiles=5,allowUnscanned=False),school_file_upload=dict(extensions=['pdf','hwpx'],maxFileBytes=8000000,maxFiles=4,allowUnscanned=False,uploadTtlMinutes=30),school_submission=dict(allowWithdrawal=True,allowCorrectionWindow=True,maxCorrectionDays=14,unattachedRetentionDays=7))
 q(p.fill_json(next((ROOT/'database/workhub/r1').glob('R1-06*.sql')),policy))
 q(p.fill_json(next((ROOT/'database/workhub/r1').glob('R1-05*.sql')),dict(approver_user_id=p.U1,approval_ref='격리 자동 시험')))
 p.run_r1.WORKER=p.api(None,'service_role');p.worker_call('workhub_file_worker_heartbeat',school,'w1',dict(checks=['size','sha256','signature','container','encryption','malware'],release='test-1'),1800)
 q(p.fill_json(next((ROOT/'database/workhub/p4').glob('P4-04*.sql')),dict(approver_user_id=p.U1,approval_ref='격리 자동 시험',document_school_share='school_admin')))
 q(p.fill_json(next((ROOT/'database/workhub/p4').glob('P4-05*.sql')),dict(module='guided',approver_user_id=p.U1,approval_ref='격리 자동 시험',max_file_bytes=200000,verification_ref='격리 API 합성 연결')))
 def rpc(op,x,k=None,m=mid,u=p.U1):
  out=b.rpc('workhub_collection_presentation',(m,op,json.dumps(x,ensure_ascii=False),k),u)
  CAP.append(dict(op=op,raw=out,input=x,key=k));return out
 def err(out):return out.get('error',{}).get('code')
 def collection(title='함께 게시할 수합'):
  return data(adm.mutate(dict(kind='create',input=p.coll_input(title=title))))['resourceId']
 def source():
  raw=p.tpl_hwpx(key());it=data(adm.t_prepare(p.fmeta('시험.hwpx',raw),'시험 양식'));tid=it['templateId'];assert p.put_object(p.U1,p.DB,it['path'],raw)=='OK'
  ins,_,_=p.guided(adm,'inspect',tid,1);a=ins['data']['inspection']['anchors'][1]
  mapping=dict(profile='explicit_paragraph_v1',templateSha256=p.sha(raw),questions=[dict(id='name',label='이름',kind='text',required=True,maxLength=100,options=[],anchorId=a['id'],sourceText=a['sourceText'],sourceHash=a['sourceHash'])])
  assert 'data' in adm.t(dict(kind='save_mapping',templateId=tid,expectedVersion=1,title='확인한 양식',mapping=mapping))
  response=data(adm.t(dict(kind='save_answers',templateId=tid,templateVersion=2,responseId=None,expectedVersion=0,answers={'name':'시험'},preview=True)))
  art,_,_=p.guided(adm,'render',tid,2,response['responseId'],1)
  return tid,art['data']['artifactId']
 col=collection();tid,artifact=source();cmd=dict(kind='publish_collection',templateId=tid,expectedVersion=2,previewArtifactId=artifact,collectionRequestId=col,collectionVersion=1)
 check('초안 수합도 게시 대상에 표시',next(t for t in data(rpc('targets',{}))['items'] if t['requestId']==col)['publication']==dict(state='draft',dueDate=p.DAY(7),unitLabels=['1학년','2학년'],recipientCount=4))
 check('다른 교사 수합 대상 비노출',data(rpc('targets',{},m='m-21',u=p.T[21]))['items']==[])
 check('초안 상태 조회',data(rpc('statuses',{'ids':[col]}))['items'][0]['status']=='draft')
 for x in [{'ids':[col,col]},{'ids':['bad']},{'ids':[col]*51},{'ids':None}]:check('잘못된 상태조회 거절 '+str(x)[:60],err(rpc('statuses',x)) in ['INVALID_INPUT','NOT_FOUND'])
 check('타학교 상태조회 차단',err(rpc('statuses',{'ids':[col]},m='m-27',u=p.T[27])) in ['NOT_FOUND','NOT_READY'])
 check('타인 소속 실행 차단', 'data' not in rpc('publish',cmd,key(),m='m-21',u=p.T[21]))
 for patch in [dict(expectedVersion=9),dict(collectionVersion=9),dict(previewArtifactId='missing')]:
  before=p.state();out=rpc('publish',dict(cmd,**patch),key());check('충돌이면 두 게시·원장·알림 모두 무변경 '+str(patch),err(out)=='CONFLICT' and p.state()==before and q('select state,version from workhub.collections where id=%s',(col,))[0]==('draft',1))
 # 양식 마지막 감사 단계에서 실패시키면 앞선 수합 게시와 수신 대상 생성까지 롤백한다.
 q("create function workhub_private.af2_fail() returns trigger language plpgsql as $$ begin if NEW.operation='guided_template.publish' then raise exception 'CONFLICT';end if;return NEW;end $$")
 q('create trigger af2_fail before insert on workhub.audit_events for each row execute function workhub_private.af2_fail()')
 before=p.state();out=rpc('publish',cmd,key());check('최종 단계 실패는 양쪽 게시 전체 롤백',err(out)=='CONFLICT' and p.state()==before and q('select count(*) from workhub.collection_units where collection_id=%s',(col,))[0][0]==0)
 q('drop trigger af2_fail on workhub.audit_events');q('drop function workhub_private.af2_fail()')
 k=key();out=rpc('publish',cmd,k);check('수합과 양식 함께 게시',data(out)['templateVersion']==3 and q('select state,version from workhub.collections where id=%s',(col,))[0]==('published',2))
 check('서버 게시판 연결값 고정',q('select state,collection_id,collection_version from workhub.guided_templates where id=%s',(tid,))[0]==('published',col,2))
 check('같은 번호 재전송 같은 접수증',rpc('publish',cmd,k)==out)
 check('같은 번호 조회만 복구 같은 접수증',rpc('recover',cmd,k)==out)
 check('같은 번호 다른 입력 거절',err(rpc('recover',dict(cmd,collectionVersion=2),k))=='IDEMPOTENCY_CONFLICT')
 check('다른 새 번호로 중복 게시 거절',err(rpc('publish',cmd,key()))=='CONFLICT')
 check('연결한 수합은 새 대상에서 제외',all(t['requestId']!=col for t in data(rpc('targets',{}))['items']))
 p.stop('guided');check('중지 후 원접수증 복구',rpc('recover',cmd,k)==out);check('중지 후 신규 게시 차단',err(rpc('publish',cmd,key()))=='NOT_READY');p.resume('guided')
 # 게시 경쟁은 같은 원본에서 한 번만 성공한다.
 c2=collection();t2,a2=source();c3=dict(cmd,templateId=t2,previewArtifactId=a2,collectionRequestId=c2)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:r=list(pool.map(lambda _:rpc('publish',c3,key()),range(2)))
 check('동시 두 게시 중 한 번만 반영',sum('data' in a for a in r)==1 and sum(err(a)=='CONFLICT' for a in r)==1)
 check('빈 상태 목록도 학교 날짜 반환',data(rpc('statuses',{'ids':[]}))['items']==[])
 check('공개한 수합은 열린 상태',data(rpc('statuses',{'ids':[c2]}))['items'][0]['phase']=='open')
 q('insert into workhub.collection_operations(school_id,collection_id,phase,version) values(%s,%s,%s,2)',(school,c2,'closed'))
 check('담당자 마감 상태는 기한과 별도',data(rpc('statuses',{'ids':[c2]}))['items'][0]['phase']=='closed')
 q("update workhub.collection_operations set phase='archived',version=3 where school_id=%s and collection_id=%s",(school,c2))
 check('보관 상태 유지',data(rpc('statuses',{'ids':[c2]}))['items'][0]['phase']=='archived')
 check('중복 수신 대상 생성 없음',q('select count(*) from workhub.collection_units where collection_id=%s',(c2,))[0][0]==2)
 check('신규 함수 비공개 실행 권한 차단',q("select bool_and(not has_function_privilege('authenticated',oid,'execute')) from pg_proc where pronamespace='workhub_private'::regnamespace and proname like 'af2_%'")[0][0])
 check('RPC는 authenticated만 실행',q("select has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') from pg_proc where oid='public.workhub_collection_presentation(text,text,jsonb,text)'::regprocedure")[0][0])

def main():
 exe='.exe' if os.name=='nt' else '';started=False;log=(b.WORK/'run.log').open('w',encoding='utf8')
 try:
  b.run(b.PG/('initdb'+exe),'-D',b.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
  b.run(b.PG/('pg_ctl'+exe),'-D',b.DATA,'-l',b.WORK/'server.log','-o',f'-h 127.0.0.1 -p {b.PORT}','-w','start',stdout=log,stderr=log);started=True
  b.setup();pre=q(next((ROOT/'database/workhub-annual/af2').glob('AF2-00*.sql')).read_text('utf8'));before=p.state();b.file(next((ROOT/'database/workhub-annual/af2').glob('AF2-01*.sql')));check('설치는 기존 자료·권한 설정 무변경',p.state()==before);after=q(next((ROOT/'database/workhub-annual/af2').glob('AF2-00*.sql')).read_text('utf8'));check('사전·사후 F1~F4 지문 동일',[x for x in pre if x[0].startswith('F')]==[x for x in after if x[0].startswith('F')])
  tests();post=q(next((ROOT/'database/workhub-annual/af2').glob('AF2-02*.sql')).read_text('utf8'));check('사후 점검 4행 모두 ok',len(post)==4 and all(x[2]=='ok' for x in post));print(f'AF2 PASS {b.PASS} FAIL 0',flush=True)
 finally:
  target=Path(os.environ.get('AF2_CAPTURE',str(b.WORK/'af2-captures.json')));target.write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf8');print('CAPTURES',target)
  if started:b.run(b.PG/('pg_ctl'+exe),'-D',b.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
  log.close()
if __name__=='__main__':main()
