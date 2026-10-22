"""운영 DSN을 받지 않는 localhost 임시 PostgreSQL 17 개인 기억 시험."""
from pathlib import Path
import os,sys,json,subprocess,importlib.util,concurrent.futures,datetime
ROOT=Path(__file__).resolve().parents[4]
M1=Path(__file__).resolve().parents[1]
os.environ['P9_PG_BIN']=os.environ.get('M1_PG_BIN',os.environ.get('P10_AI_PG_BIN',os.environ.get('P9_PG_BIN','')))
os.environ['P9_TEST_PORT']=os.environ.get('M1_TEST_PORT','55589')
spec=importlib.util.spec_from_file_location('m1_foundation',ROOT/'database/workhub-school-data/p9/test/run_p9.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
q=H.q;check=H.check;CAPTURES=[]

def file(prefix):return next(M1.glob(prefix+'_*.sql'))
def failure(name,action,expected=None):
 try:action()
 except H.psycopg2.Error as ex:check(name,expected is None or expected in str(ex))
 else:check(name,False)
def tests():
 for n in ('01','02'):H.file(next((H.W/'p6').glob('P6-'+n+'_*.sql')))
 # 현재 앱의 학교별 AI 게이트를 함께 올린 뒤 M1이 기존 SQL을 건드리지 않는지 확인한다.
 p10=ROOT/'database/workhub-ai-policy/p10'
 for n in ('01','02','03','09','10'):H.file(next(p10.glob('P10-'+n+'_*.sql')))
 before={r[0]:r[3:] for r in H.file(file('M1-00')) if r[0].startswith('F')}
 H.file(file('M1-01'))
 after={r[0]:r[3:] for r in H.file(file('M1-00')) if r[0].startswith('F')}
 check('기존 구조·함수·회원·감사 지문 보존',before==after)
 check('설치 사후 점검 FAIL 0',all(r[2]!='FAIL' for r in H.file(file('M1-02'))))
 failure('설치 재실행 거절',lambda:H.file(file('M1-01')),'이미 설치')
 school,member=q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(H.ADMIN,))[0]
 today=q("select workhub_private.today_in('Asia/Seoul')::text")[0][0]
 yesterday=(datetime.date.fromisoformat(today)-datetime.timedelta(days=1)).isoformat()
 oldday=(datetime.date.fromisoformat(today)-datetime.timedelta(days=2)).isoformat()
 def call(kind,c=None,key=None,mid=member,uid=H.ADMIN):
  args=(mid,) if kind=='list' else (mid,json.dumps(c,ensure_ascii=False)) if kind=='select' else (mid,json.dumps(c,ensure_ascii=False),key)
  raw=H.rpc('workhub_ai_memory_'+kind,args,uid)
  CAPTURES.append({'kind':kind,'raw':raw,'command':c,'key':key,'schoolId':raw['schoolId'],'memberId':mid})
  return raw
 def create(entry_id,**extra):return {'kind':'create','id':entry_id,'title':' 업무 선호 ','body':'  핵심 먼저\n두 줄로 설명해 주세요.  ','category':'preference','enabled':True,'expiresOn':None,'confirmed':True,**extra}
 def error(raw,code):return raw.get('error',{}).get('code')==code
 def mutate(c,key):return call('mutate',c,key)
 def activate(on):
  script=file('M1-03').read_text(encoding='utf8').replace("admin_member_id text := '';",f"admin_member_id text := '{member}';").replace("approval_ref text := '';","approval_ref text := '격리 가상 학교 시험 승인';").replace('requested_enabled boolean := NULL;',f"requested_enabled boolean := {'true' if on else 'false'};")
  q(script)
 check('기본 목록 비활성',call('list')['data']=={'items':[],'today':today,'canWrite':False})
 check('기본 새 기억 거절',error(mutate(create('off'),'create-off'),'NOT_READY'))
 check('기본 참고 선택 거절',error(call('select',[{'id':'off','version':1}]),'NOT_READY'))
 check('미접수 복구',call('recover',create('off'),'create-off')['data']=={'state':'missing','requestKey':'create-off'})
 check('중지 상태 닫기',call('close',create('off'),'create-off')['data']['state']=='closed')
 check('닫힌 번호 늦은 반영 거절',error(mutate(create('off'),'create-off'),'CONFLICT'))
 failure('빈 승인 양식 실행 차단',lambda:H.file(file('M1-03')),'직접 채우세요')
 activate(True)
 check('학교별 쓰기 승인',call('list')['data']['canWrite'])
 first=create('first',body='삭제할 원문 고유표식 M1-SENTINEL')
 receipt=mutate(first,'create-first')['data']
 check('create 판 1 접수증',receipt=={'state':'applied','requestKey':'create-first','kind':'create','entryId':'first','version':1})
 check('동일 요청 접수증 재사용',mutate(first,'create-first')['data']==receipt)
 check('recover 원래 결과',call('recover',first,'create-first')['data']==receipt)
 check('적용된 요청 닫기 원래 결과',call('close',first,'create-first')['data']==receipt)
 check('동일 번호 다른 명령 차단',error(mutate({**first,'body':'다른 내용'},'create-first'),'IDEMPOTENCY_CONFLICT'))
 check('앞뒤 공백 원문 보존',call('list')['data']['items'][0]['title']==' 업무 선호 ')
 update={**first,'kind':'update','expectedVersion':1,'title':'바꾼 제목'}
 check('update 판 2',mutate(update,'update-first')['data']['version']==2)
 check('동시 편집 오래된 판 거절',error(mutate(update,'update-stale'),'CONFLICT'))
 check('선택 오래된 판 거절',error(call('select',[{'id':'first','version':1}]),'CONFLICT'))
 selected=call('select',[{'id':'first','version':2}])
 check('현재 판 선택',selected['data']['items'][0]['version']==2)
 delete={'kind':'delete','id':'first','expectedVersion':2,'confirmed':True}
 check('삭제 판 3',mutate(delete,'delete-first')['data']['version']==3)
 check('삭제 항목 목록 제외',call('list')['data']['items']==[])
 check('삭제 제목·본문·기한 실제 제거',q("select title,body,expires_on,enabled,deleted_at is not null from workhub.ai_memories where id='first'")[0]==(None,None,None,False,True))
 check('접수증·감사에 기억 원문 없음',q("select not exists(select 1 from workhub.ai_memory_requests r where row_to_json(r)::text like '%M1-SENTINEL%') and not exists(select 1 from workhub.audit_events a where row_to_json(a)::text like '%M1-SENTINEL%')")[0][0])
 check('삭제 뒤 과거 create 결과만 복구',mutate(first,'create-first')['data']==receipt and call('list')['data']['items']==[])
 check('삭제 뒤 과거 update 결과만 복구',mutate(update,'update-first')['data']['version']==2 and call('list')['data']['items']==[])
 check('삭제 ID 신규 생성 금지',error(mutate(first,'recreate-first'),'CONFLICT'))
 check('삭제 항목 재선택 거절',error(call('select',[{'id':'first','version':3}]),'NOT_FOUND'))
 for index,patch in enumerate(({'title':' '},{'body':'\u00a0'},{'title':'a'*81},{'body':'x'*1001},{'category':'student'},{'confirmed':False},{'enabled':'true'},{'expiresOn':'2026-02-30'},{'expiresOn':'0000-01-01'},{'expiresOn':yesterday},{'title':'\u0001'},{'extra':True},{'id':'잘못된id'})):
  check(f'잘못된 명령 {index+1}',error(mutate(create('bad',**patch),f'bad-input-{index}'),'INVALID_INPUT'))
 for index,v in enumerate((0,-1,1.2,2147483648,'1',None,1e20)):
  check(f'잘못된 판 {index+1}',error(mutate({**update,'expectedVersion':v},f'bad-version-{index}'),'INVALID_INPUT'))
 for id in ('z','A','_','a','Z'):
  check('목록 정렬 자료 '+id,mutate(create(id),'sorting-'+id)['data']['version']==1)
 check('ID ASCII 순서', [x['id'] for x in call('list')['data']['items']]==['A','Z','_','a','z'])
 refs=[{'id':'z','version':1},{'id':'A','version':1}]
 check('선택은 요청 순서',[x['id'] for x in call('select',refs)['data']['items']]==['z','A'])
 for index,refs in enumerate(([],[{'id':'z','version':1}]*2,[{'id':str(i),'version':1} for i in range(6)],None,[{'id':'z','version':1,'extra':1}])):
  check(f'선택 형식 제한 {index+1}',error(call('select',refs),'INVALID_INPUT'))
 check('혼합 선택 부분 결과 반환 안 함',error(call('select',[{'id':'z','version':1},{'id':'absent','version':1}]),'NOT_FOUND'))
 check('만료일 당일 생성',mutate(create('today',expiresOn=today),'create-today')['data']['version']==1)
 check('만료일 당일 선택',call('select',[{'id':'today','version':1}])['data']['items'][0]['id']=='today')
 check('중지 항목 생성',mutate(create('paused',enabled=False),'create-paused')['data']['version']==1)
 check('중지 항목 선택 차단',error(call('select',[{'id':'paused','version':1}]),'CONFLICT'))
 q("update workhub.ai_memories set expires_on=%s,version=version+1 where id='today'",(yesterday,))
 check('만료 항목 선택 차단',error(call('select',[{'id':'today','version':2}]),'CONFLICT'))
 expired={**create('today',expiresOn=yesterday,enabled=False),'kind':'update','expectedVersion':2}
 check('만료일 유지한 중지 허용',mutate(expired,'pause-expired')['data']['version']==3)
 check('다른 과거 만료일로 수정 거절',error(mutate({**expired,'expectedVersion':3,'expiresOn':oldday},'change-expired'),'INVALID_INPUT'))
 check('astral 문자 코드포인트 제한',mutate(create('emoji',title='😀'*80),'create-emoji')['data']['version']==1)
 # 승인된 가상 superadmin 두 명/두 학교로 소유자·테넌트 격리를 확인한다.
 other='00000000-0000-0000-0000-000000000005'
 q('update public.users set is_active=true where id=%s',(other,))
 account=q("insert into workhub.accounts(auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,status,legacy_approval_state) values(%s,%s,'same_auth_user',now(),'가상 두번째 교사','active','approved') returning id",(other,other))[0][0]
 othermember=q("insert into workhub.memberships(school_id,account_id,status,valid_from,decided_at,employment_type) values(%s,%s,'active',current_date-365,now(),'teacher') returning id",(school,account))[0][0]
 check('동일 학교 타 교사 목록 비노출',call('list',mid=othermember,uid=other)['data']['items']==[])
 failure('다른 회원 소속 ID 위조 차단',lambda:call('list',mid=member,uid=other),'INACTIVE_MEMBERSHIP')
 check('타 교사 기억 직접 선택 거절',error(call('select',[{'id':'z','version':1}],mid=othermember,uid=other),'NOT_FOUND'))
 check('타 교사 같은 번호 복구는 missing',call('recover',first,'create-first',mid=othermember,uid=other)['data']['state']=='missing')
 check('타 교사 같은 번호 독립 생성',call('mutate',first,'create-first',mid=othermember,uid=other)['data']['version']==1)
 other_school=q("insert into workhub.schools(code,name,school_level,grade_count,status,support_state) values('memory-other','가상 다른 학교','middle',3,'active','synthetic') returning id")[0][0]
 own_account=q('select account_id from workhub.memberships where id=%s',(member,))[0][0]
 other_school_member=q("insert into workhub.memberships(school_id,account_id,status,valid_from,decided_at,employment_type) values(%s,%s,'active',current_date-365,now(),'teacher') returning id",(other_school,own_account))[0][0]
 check('같은 계정 다른 학교 목록 격리',call('list',mid=other_school_member)['data']['items']==[])
 check('같은 계정 다른 학교 원번호 격리',call('recover',first,'create-first',mid=other_school_member)['data']['state']=='missing')
 q("update workhub.memberships set status='suspended' where id=%s",(othermember,))
 failure('중지된 소속 목록 거절',lambda:call('list',mid=othermember,uid=other),'INACTIVE_MEMBERSHIP')
 q("update workhub.memberships set status='active' where id=%s",(othermember,))
 # 경합에서도 owner advisory lock과 요청 원장으로 한 결과만 확정한다.
 race=create('race')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(mutate,race,'race-create') for _ in range(2)];results=[f.result() for f in futures]
 check('중복 동시 전송 단일 결과',results[0]==results[1] and q("select count(*) from workhub.ai_memories where id='race'")[0][0]==1)
 a={**race,'kind':'update','expectedVersion':1};b={**a,'body':'다른 편집'}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(mutate,c,k) for c,k in ((a,'race-edit-a'),(b,'race-edit-b'))];results=[f.result() for f in futures]
 check('같은 판 동시 편집 하나만 반영',sum('data' in r for r in results)==1 and sum(error(r,'CONFLICT') for r in results)==1)
 for i in range(6):
  c=create('close-race-'+str(i));key='close-race-key-'+str(i)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(mutate,c,key);b=pool.submit(call,'close',c,key);written,closed=a.result(),b.result()
  state=closed['data']['state']
  check(f'원요청·닫기 경합 {i+1}',(written.get('data')==closed['data'] if state=='applied' else error(written,'CONFLICT')) and call('recover',c,key)['data']==closed['data'])
  check(f'원번호 닫기 재확인 {i+1}',call('close',c,key)==closed)
 live=q('select count(*) from workhub.ai_memories where member_id=%s and deleted_at is null',(member,))[0][0]
 for i in range(49-live):mutate(create('capacity-'+str(i)),'capacity-request-'+str(i))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(mutate,create('capacity-last-'+str(i)),'capacity-last-key-'+str(i)) for i in range(2)];results=[f.result() for f in futures]
 check('50개 경합 한도 초과 없음',sum('data' in r for r in results)==1 and sum(error(r,'CONFLICT') for r in results)==1 and len(call('list')['data']['items'])==50)
 check('삭제 항목은 개수 제외',mutate({'kind':'delete','id':'A','expectedVersion':1,'confirmed':True},'capacity-delete')['data']['version']==2 and mutate(create('after-delete'),'after-delete-key')['data']['version']==1)
 activate(False)
 check('중지 뒤 목록과 canWrite',not call('list')['data']['canWrite'] and len(call('list')['data']['items'])==50)
 check('중지 뒤 선택 차단',error(call('select',[{'id':'z','version':1}]),'NOT_READY'))
 check('중지 뒤 새 생성 차단',error(mutate(create('stop-new'),'stop-new-key'),'NOT_READY'))
 check('중지 뒤 수정 차단',error(mutate({**create('z'),'kind':'update','expectedVersion':1},'stop-edit-key'),'NOT_READY'))
 check('중지 뒤 삭제 허용',mutate({'kind':'delete','id':'z','expectedVersion':1,'confirmed':True},'stop-delete-key')['data']['version']==2)
 check('중지 뒤 이전 접수증 복구',call('recover',first,'create-first')['data']==receipt)
 check('중지 뒤 미전송 닫기 허용',call('close',create('stop-new'),'stop-new-key')['data']['state']=='closed')
 q("alter table workhub.ai_memories disable trigger ai_memories_guard; update workhub.ai_memories set version=2147483647 where id='Z'; alter table workhub.ai_memories enable trigger ai_memories_guard")
 check('최대 판 삭제는 overflow 대신 CONFLICT',error(mutate({'kind':'delete','id':'Z','expectedVersion':2147483647,'confirmed':True},'max-version-key'),'CONFLICT'))
 failure('authenticated 표 직접 조회 차단',lambda:q('set role authenticated; select * from workhub.ai_memories'),'permission denied')
 failure('anon 공개 함수 실행 차단',lambda:q('set role anon; select public.workhub_ai_memory_list(%s)',(member,)),'permission denied')
 failure('접수 원장 변조 차단',lambda:q("update workhub.ai_memory_requests set command_sha256=repeat('0',64)"),'IMMUTABLE')
 failure('기억 실제 행 삭제 차단',lambda:q('delete from workhub.ai_memories'),'IMMUTABLE')
 check('최종 사후 점검 FAIL 0',all(r[2]!='FAIL' for r in H.file(file('M1-02'))))
 q('alter table workhub.ai_memories disable trigger ai_memories_guard')
 check('사후 점검 보호 트리거 훼손 탐지',any(r[0]=='M1-02-08' and r[2]=='FAIL' for r in H.file(file('M1-02'))))
 q('alter table workhub.ai_memories enable trigger ai_memories_guard')
 check('사후 점검 보호 복구',all(r[2]!='FAIL' for r in H.file(file('M1-02'))))
 q('grant execute on function workhub_private.m1_entry_guard() to authenticated')
 check('사후 점검 내부 실행권한 훼손 탐지',any(r[0]=='M1-02-06' and r[2]=='FAIL' for r in H.file(file('M1-02'))))
 q('revoke execute on function workhub_private.m1_entry_guard() from authenticated')
 q('alter table workhub.ai_memories disable row level security')
 check('사후 점검 RLS 훼손 탐지',any(r[0]=='M1-02-02' and r[2]=='FAIL' for r in H.file(file('M1-02'))))
 q('alter table workhub.ai_memories enable row level security')
 check('최종 보안 점검 복구',all(r[2]!='FAIL' for r in H.file(file('M1-02'))))
 target=Path(os.environ.get('M1_CAPTURE',str(H.WORK/'captures.json')))
 target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(CAPTURES,ensure_ascii=False,indent=2),encoding='utf8')
 print('CAPTURES',target,flush=True)

def main():
 exe='.exe' if os.name=='nt' else ''
 version=subprocess.check_output([str(H.PG/('postgres'+exe)),'--version'],text=True)
 if ' 17.' not in version:raise RuntimeError('PostgreSQL 17만 지원합니다.')
 log=(H.WORK/'run.log').open('w',encoding='utf8');started=False
 try:
  H.run(H.PG/('initdb'+exe),'-D',H.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
  H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-l',H.WORK/'server.log','-o',f'-h 127.0.0.1 -p {H.PORT}','-w','start',stdout=log,stderr=log);started=True
  check('임시 시험 서버 경로',Path(q('show data_directory',user='supabase_admin',db='postgres')[0][0]).resolve()==H.DATA)
  H.setup();tests();print(f'합계 PASS {H.PASS} · FAIL 0',flush=True)
 finally:
  if started:H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
  log.close();print('격리 시험 파일',H.WORK,flush=True)
if __name__=='__main__':main()
