"""AF1: 합성 자료의 독립 PG17만 생성. 운영 DSN이나 기존 클러스터를 받지 않는다."""
from pathlib import Path
import os,sys,json,subprocess,datetime,uuid,threading,concurrent.futures
ROOT=Path(__file__).resolve().parents[4]
os.environ['T3_TEST_PORT']=os.environ.get('AF1_TEST_PORT','55639')
sys.path.insert(0,str(ROOT/'database/workhub-timetable/t3/test'))
import run_t3 as h
b=h.base;q=b.q;check=b.check
CAP=[]
def key():return str(uuid.uuid4())
def data(r):
 assert 'data' in r,r
 return r['data']
def error(r):return r.get('error',{}).get('code')
def tests():
 school,adm=q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(b.ADMIN,))[0]
 def rpc(op,x,k=None,mid=adm,uid=b.ADMIN):
  r=b.rpc('workhub_annual_operations',(mid,op,json.dumps(x,ensure_ascii=False),k),uid)
  if 'data' in r:CAP.append(dict(kind=op,raw=r,input=x,key=k))
  return r
 def failquery(label,sql,args=()):
  try:q(sql,args)
  except Exception as e:check(label,'CONFLICT' in str(e))
  else:check(label,False)
 check('API 역할 표 접근 없음',not q("select 1 from information_schema.role_table_grants where table_schema='workhub' and table_name like 'annual_%' and grantee in ('anon','authenticated','service_role')"))
 check('신규 표 RLS 5개',q("select count(*),bool_and(relrowsecurity) from pg_class where relnamespace='workhub'::regnamespace and relname like 'annual_%' and relkind='r'")[0]==(5,True))
 check('공개 함수 authenticated 전용',q("select count(*),bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace and proname like 'workhub_annual_%'")[0]==(2,True))
 check('비공개 함수 직접 실행 불가',q("select bool_and(not has_function_privilege('authenticated',oid,'EXECUTE')) from pg_proc where pronamespace='workhub_private'::regnamespace and proname like 'af1_%'")[0][0])
 before=q('select md5(string_agg(row_to_json(m)::text,\'\' order by id)) from workhub.memberships m')[0][0]
 ready=b.rpc('workhub_annual_readiness',(adm,'2027-03-01','2028-03-01'));CAP.append(dict(kind='readiness',raw=ready))
 check('다음 학년도는 소속 재생성 없이 조회',data(ready)['adminGaps']==[])
 check('소속과 기존 종료일을 변경하지 않음',before==q('select md5(string_agg(row_to_json(m)::text,\'\' order by id)) from workhub.memberships m')[0][0])
 for mid,uid in [('m-21',h.old.T[21]),('m-22',h.old.T[22])]:
  check('일반 교사 관리자 자료 차단 '+mid,error(b.rpc('workhub_annual_readiness',(mid,'2027-03-01','2028-03-01'),uid))=='FORBIDDEN')
 roles=q("select id from workhub.membership_roles where school_id=%s and role_code='school_admin' and membership_id<>%s",(school,adm))
 for rid, in roles:q('update workhub.membership_roles set revoked_at=clock_timestamp(),revoke_reason=$$격리 회귀$$ where id=%s',(rid,))
 failquery('마지막 관리자 종료일 단축 차단','update workhub.memberships set valid_to=%s where id=%s',('2027-03-01',adm))
 failquery('마지막 관리자 역할 회수 차단',"update workhub.membership_roles set revoked_at=clock_timestamp(),revoke_reason=$$격리 회귀$$ where school_id=%s and membership_id=%s and role_code='school_admin'",(school,adm))
 # 기존 퇴직일은 관리자가 아닌 교사에게 설정·보존된다.
 q("update workhub.memberships set valid_to='2027-03-01' where id='m-28'")
 check('교사 퇴직·전출 종료일 보존',next(m for m in data(b.rpc('workhub_annual_readiness',(adm,'2027-03-01','2028-03-01')))['members'] if m['id']=='m-28')['until']=='2027-03-01')
 for rid, in roles:q('update workhub.membership_roles set revoked_at=null,revoke_reason=null where id=%s',(rid,))
 # 기존 임시 관리자를 미래까지 자동 연장하지 않는다.
 q("update workhub.membership_roles set valid_to='2027-03-01' where school_id=%s and membership_id<>%s and role_code='school_admin'",(school,adm))
 failquery('오늘은 관리자가 있어도 미래 공백 차단',"update workhub.membership_roles set revoked_at=clock_timestamp(),revoke_reason=$$격리 회귀$$ where membership_id=%s and role_code='school_admin'",(adm,))
 # 두 관리자가 동시에 역할을 회수해도 한 명은 남아야 한다.
 q("update workhub.membership_roles set valid_to=null where school_id=%s and role_code='school_admin'",(school,))
 ids=[r[0] for r in q("select id from workhub.membership_roles where school_id=%s and role_code='school_admin' and revoked_at is null",(school,))]
 barrier=threading.Barrier(2)
 def revoke(rid):
  barrier.wait()
  try:q("update workhub.membership_roles set revoked_at=clock_timestamp(),revoke_reason='동시 회수 시험' where id=%s",(rid,));return 'ok'
  except Exception as e:return 'blocked' if 'CONFLICT' in str(e) else str(e)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(revoke,ids[:2]))
 check('동시 마지막 관리자 회수 직렬화',sorted(results)==['blocked','ok'])
 for rid in ids:q('update workhub.membership_roles set revoked_at=null,revoke_reason=null where id=%s',(rid,))
 anchor=h.old.TODAY+datetime.timedelta(days=46);anchor-=datetime.timedelta(days=anchor.weekday())
 inp=dict(from_=anchor.isoformat(),until=(anchor+datetime.timedelta(days=7)).isoformat(),groupIds=['cls-1-1','cls-1-2'],classification='vacation',reason='가상 방학')
 inp['from']=inp.pop('from_')
 for patch in [dict(classification=None),dict(reason=''),dict(groupIds=[]),dict(groupIds=['cls-1-1','cls-1-1']),dict(until=(anchor+datetime.timedelta(days=63)).isoformat()),dict(groupIds=['unknown'])]:
  check('잘못된 기간 입력 차단 '+str(patch),error(rpc('preview',dict(inp,**patch)))=='INVALID_INPUT')
 check('일반 교사 기간 미리보기 차단',error(rpc('preview',inp,mid='m-21',uid=h.old.T[21]))=='FORBIDDEN')
 p=data(rpc('preview',inp));check('기간 미리보기 전체 날짜',len(p['plan']['days'])==7);check('전체 학급 휴업 무차단',p['plan']['blockers']==[]);check('실제 수업을 포함한 기간',p['plan']['changedCount']>0)
 check('미리보기는 수업 무변경',q('select count(*) from workhub.annual_closure_days')[0][0]==0)
 # 미리보기 뒤 원본 변경은 기간 전체를 막는다.
 changed_id=[c['before']['id'] for day in p['plan']['days'] for c in day['changes']][-1]
 q('update workhub.timetable_lessons set changed_at=clock_timestamp() where id=%s',(changed_id,))
 stale=dict(kind='apply_period',previewId=p['id'],fingerprint=p['fingerprint'])
 check('원본 변경 뒤 전체 거절',error(rpc('execute',stale,key()))=='CONFLICT')
 check('거절된 기간은 일부 날짜도 저장 안 함',q('select count(*) from workhub.annual_closure_days')[0][0]==0)
 p=data(rpc('preview',inp))
 cmd=dict(kind='apply_period',previewId=p['id'],fingerprint=p['fingerprint']);k=key()
 check('타 교사 번호로 관리자 미리보기 적용 차단',error(rpc('execute',cmd,key(),mid='m-21',uid=h.old.T[21]))=='FORBIDDEN')
 # 마지막 변경에서 실패해도 앞 날짜 취소까지 전부 되돌린다.
 q("create function workhub_private.af1_test_failure() returns trigger language plpgsql as $$ begin if NEW.id=%s then raise exception 'CONFLICT';end if;return NEW;end $$",(changed_id,))
 q('create trigger zz_af1_test_failure before update on workhub.timetable_lessons for each row execute function workhub_private.af1_test_failure()')
 check('중간 실패 기간 전체 롤백',error(rpc('execute',cmd,k))=='CONFLICT' and q('select count(*) from workhub.annual_closure_days')[0][0]==0)
 q('drop trigger zz_af1_test_failure on workhub.timetable_lessons');q('drop function workhub_private.af1_test_failure()')
 receipt=data(rpc('execute',cmd,k));check('기간 원자 반영',receipt['changedCount']==p['plan']['changedCount'])
 check('빈 날짜도 휴업 보존',q('select count(*) from workhub.annual_closure_days where period_id=%s',(p['id'],))[0][0]==7)
 check('같은 요청 재전송은 같은 접수증',data(rpc('execute',cmd,k))==receipt)
 check('같은 미리보기 새 번호 중복 반영 차단',error(rpc('execute',cmd,key()))=='CONFLICT')
 check('같은 번호 다른 명령 차단',error(rpc('execute',dict(cmd,fingerprint='0'*64),k))=='IDEMPOTENCY_CONFLICT')
 changed=[c['after']['id'] for d in p['plan']['days'] for c in d['changes']]
 check('공식 방학은 보강 집계 제외',q('select bool_and(not workhub_private.af1_makeup_needed(l)) from workhub.timetable_lessons l where id=any(%s)',(changed,))[0][0])
 review=data(rpc('review',{'from':inp['from'],'until':inp['until']}))
 check('방학 보강 목록 제외',not any(m['id'] in changed for m in review['makeup']))
 empty=next(d for d in review['days'] if d['changedCount']==0)
 release=dict(kind='release_empty_day',changeId=empty['id'],reason='확정 전 입력 오류 정정')
 check('빈 날 휴업 사유 없이 해제 금지',error(rpc('execute',dict(release,reason=''),key()))=='INVALID_INPUT')
 check('빈 날 휴업도 후속 수업 생성 차단',q('select workhub_private.t3_closed(%s,%s,%s::jsonb,null)',(school,empty['date'],json.dumps([{'id':'cls-1-1'}])))[0][0])
 rkey=key();released=data(rpc('execute',release,rkey));check('빈 날 휴업 명시 해제',released['changedCount']==0)
 check('명시 해제 뒤 빈 날 차단 해제',not q('select workhub_private.t3_closed(%s,%s,%s::jsonb,null)',(school,empty['date'],json.dumps([{'id':'cls-1-1'}])))[0][0])
 check('빈 날 해제 원번호 복구',data(rpc('execute',release,rkey))==released)
 check('빈 날 해제 이력 보존',next(d for d in data(rpc('review',{'from':inp['from'],'until':inp['until']}))['days'] if d['id']==empty['id'])['released'])
 temp=dict(inp,**{'from':(anchor+datetime.timedelta(days=7)).isoformat(),'until':(anchor+datetime.timedelta(days=14)).isoformat(),'classification':'temporary','reason':'임시 휴업 시험'})
 tp=data(rpc('preview',temp));tc=dict(kind='apply_period',previewId=tp['id'],fingerprint=tp['fingerprint']);data(rpc('execute',tc,key()))
 cancelled=next(c['after'] for d in tp['plan']['days'] for c in d['changes']);lid=cancelled['id']
 check('임시 휴업은 보강 검토',q('select workhub_private.af1_makeup_needed(l) from workhub.timetable_lessons l where id=%s',(lid,))[0][0])
 close=dict(kind='close_makeup',lessonId=lid,expectedVersion=cancelled['version'],reason='관리자 확인: 별도 운영계획에서 이수 충족')
 for patch in [dict(reason=''),dict(expectedVersion=1)]:check('보강 종결 사유·판 확인',error(rpc('execute',dict(close,**patch),key())) in ['INVALID_INPUT','CONFLICT'])
 ckey=key();cr=data(rpc('execute',close,ckey));check('명시 사유로 종결',cr['changedCount']==1)
 check('종결 원번호 복구',data(rpc('execute',close,ckey))==cr)
 check('원수업·취소 상태와 버전 보존',q('select state,version from workhub.timetable_lessons where id=%s',(lid,))[0]==('cancelled',cancelled['version']))
 check('종결 이력 조회',any(m['id']==lid and m['closedReason']==close['reason'] for m in data(rpc('review',{'from':temp['from'],'until':temp['until']}))['makeup']))
 check('휴업 변경 원본을 삭제하지 않음',q('select count(*) from workhub.annual_closure_days')[0][0]==14)
 # 이미 반영된 접수증은 모듈 중지 후에도 복구한다.
 saved=q("select prosrc from pg_proc where oid='workhub_private.t2_ready(text)'::regprocedure")[0][0]
 q("create or replace function workhub_private.t2_ready(p_school text) returns boolean language sql stable security definer set search_path='' as $$ select false $$")
 check('모듈 중지 후 신규 요청 차단',error(rpc('preview',inp))=='NOT_READY')
 check('모듈 중지 후 기존 번호 복구',data(rpc('execute',cmd,k))==receipt)
 q("create or replace function workhub_private.t2_ready(p_school text) returns boolean language sql stable security definer set search_path='' as %s",(saved,))
 check('타학교 관리자에게 원 접수증 비노출',error(rpc('execute',cmd,k,mid='m-27',uid=h.old.T[27])) in ('NOT_READY','CONFLICT'))
 
 check('인계 알림 출처 표기 함수 반영',"'transitions',t.id" in q("select prosrc from pg_proc where oid='workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)'::regprocedure")[0][0].replace(" ",""))

def main():
 exe='.exe' if os.name=='nt' else '';started=False;log=(b.WORK/'run.log').open('w',encoding='utf8')
 try:
  b.run(b.PG/('initdb'+exe),'-D',b.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
  b.run(b.PG/('pg_ctl'+exe),'-D',b.DATA,'-l',b.WORK/'server.log','-o',f'-h 127.0.0.1 -p {b.PORT}','-w','start',stdout=log,stderr=log);started=True
  b.setup();h.old.body();check('선행 T2 회귀',all(ok for _,ok in h.old.results))
  for path in ['database/workhub-school-data/p9/P9-01_교사연결_모델과함수.sql','database/workhub-school-data/p9/P9-02_담당교사후보_분리.sql','database/workhub-school-data/p10/P10-01_정정_모델과함수.sql','database/workhub-school-data/p10/P10-02_기존쓰기와시간표_보호.sql']:b.file(ROOT/path)
  for name in ['T3-01_운영확장_모델.sql','T3-02_운영확장_공개함수.sql','T3-03_기존운영_보존훅.sql']:b.file(ROOT/'database/workhub-timetable/t3'/name)
  pre_path=ROOT/'database/workhub-annual/af1/AF1-00_사전점검_지문.sql'
  before=b.file(pre_path)
  check('사전 점검 8행과 비교 지문 6개',len(before)==8 and len([r for r in before if r[0].startswith('F') and r[2]=='compare'])==6)
  check('정상 T3 설치는 사전 점검 ok',next(r for r in before if r[0]=='P1')[2]=='ok')
  check('AF1 설치 전 상태는 미설치',next(r for r in before if r[0]=='P2')[3]=='미설치')
  # 잘못된 3인자 서명은 실제 5인자 함수를 찾지 못한다. 수정 전 거짓 FAIL을 고정한다.
  wrong=pre_path.read_text('utf8').replace('t3_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone,text)','t3_plan(workhub_private.actor_context,jsonb,timestamp with time zone)')
  check('수정 전 서명은 정상 T3를 FAIL로 오판',next(r for r in q(wrong) if r[0]=='P1')[2]=='FAIL')
  for path in sorted((ROOT/'database/workhub-annual/af1').glob('AF1-0[1-4]*.sql')):b.file(path);check('설치 '+path.name,True)
  after=b.file(ROOT/'database/workhub-annual/af1/AF1-00_사전점검_지문.sql');check('설치 전후 기존 자료 지문 6개 동일',before[:6]==after[:6])
  check('설치 후 사전 점검 상태',next(r for r in after if r[0]=='P1')[2]=='ok' and next(r for r in after if r[0]=='P2')[3]=='workhub_private.af1_installs')
  post_path=ROOT/'database/workhub-annual/af1/AF1-05_사후점검.sql'
  rows=b.file(post_path);check('AF1 사후 점검',len(rows)==8 and all(r[2]=='ok' for r in rows))
  # 고정 search_path를 지운 훼손도 NULL 논리로 빠지지 않고 FAIL이어야 한다.
  signature='workhub_private.af1_admin_coverage(text,jsonb,jsonb)'
  q('ALTER FUNCTION '+signature+' RESET search_path')
  try:
   check('search_path 누락은 사후 점검 FAIL',next(r for r in b.file(post_path) if r[0]=='AF1-05-02')[2]=='FAIL')
   legacy=post_path.read_text('utf8').replace("('search_path=\"\"'=ANY(proconfig)) IS DISTINCT FROM TRUE","NOT ('search_path=\"\"'=ANY(proconfig))")
   check('수정 전 검사는 NULL 설정 훼손을 놓침',next(r for r in q(legacy) if r[0]=='AF1-05-02')[2]=='ok')
  finally:q('ALTER FUNCTION '+signature+" SET search_path='' ")
  check('설정 복원 뒤 사후 점검 모두 ok',all(r[2]=='ok' for r in b.file(post_path)))
  tests();print(f'AF1 PASS {b.PASS} FAIL 0',flush=True)
 finally:
  target=Path(os.environ.get('AF1_CAPTURE',str(b.WORK/'af1-captures.json')));target.write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf8');print('CAPTURES',target)
  if started:b.run(b.PG/('pg_ctl'+exe),'-D',b.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
  log.close()
if __name__=='__main__':main()
