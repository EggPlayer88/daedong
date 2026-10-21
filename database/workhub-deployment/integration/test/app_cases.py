"""전체 증분을 한 DB에 설치한 상태의 실제 RPC 응답을 앱 계약에 대조한다."""
from pathlib import Path
import json,subprocess,os

def exercise(H,run,rpc,report,root):
 school,member=run("select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s",(H.ADMIN,))[0]
 captures=[]
 def memory(kind,command=None,key=None):
  args=(member,) if kind=='list' else (member,command) if kind=='select' else (member,command,key)
  raw=rpc('workhub_ai_memory_'+kind,*args)
  captures.append(dict(module='memory',kind=kind,raw=raw,command=command,key=key,schoolId=school,memberId=member))
  return raw
 def knowledge(kind,source,number=None):
  raw=rpc('workhub_knowledge_'+kind,member,source,number)
  captures.append(dict(module='knowledge',kind=kind,raw=raw,sourceId=source,number=number,schoolId=school,memberId=member))
  return raw
 def status():
  raw=rpc('workhub_ai_school_status',H.ADMIN,member,role='service_role')
  captures.append(dict(module='ai-status',kind='status',raw=raw,schoolId=school,memberId=member))
  return raw
 def mutation(command,key):
  raw=rpc('workhub_knowledge_mutate',member,command,key)
  if 'data' not in raw:raise AssertionError(raw)
  return raw['data']
 def code(raw):return raw.get('error',{}).get('code')
 H.check('전체 설치 뒤에도 학교 AI 정책·키 기본 미등록',status()['status']=='policy_missing')
 H.check('전체 설치 뒤 개인 기억 기본 쓰기 중지',memory('list')['data']['canWrite'] is False)
 cmd=dict(kind='create',id='int05-memory',title='업무 설명 방식',body='핵심을 먼저 두 줄로 설명해 주세요.',category='preference',enabled=True,expiresOn=None,confirmed=True)
 H.check('미승인 기억 생성은 NOT_READY',code(memory('mutate',cmd,'int05-memory-off'))=='NOT_READY')
 H.check('미승인 기억 선택은 NOT_READY',code(memory('select',[dict(id=cmd['id'],version=1)]))=='NOT_READY')
 H.check('닫지 않은 미접수 번호는 missing',memory('recover',cmd,'int05-memory-off')['data']['state']=='missing')
 H.check('미승인 상태에서도 내 미접수 번호 닫기',memory('close',cmd,'int05-memory-off')['data']['state']=='closed')
 H.check('닫힌 번호 뒤늦은 접수 거부',code(memory('mutate',cmd,'int05-memory-off'))=='CONFLICT')
 H.check('전체 설치 뒤 미활성 원문 조회는 NOT_READY',code(knowledge('get','int05-absent',1))=='NOT_READY')
 # 이 아래 활성화는 새 임시 DB의 합성 자료에만 적용한다. 설치 동작과 구분한다.
 path=next((root/'database/workhub-ai-memory/m1').glob('M1-03_*.sql'))
 filled=path.read_text(encoding='utf8').replace("admin_member_id text := '';",f"admin_member_id text := '{member}';").replace("approval_ref text := '';","approval_ref text := 'INT05 격리 합성 자료 승인';").replace('requested_enabled boolean := NULL;','requested_enabled boolean := true;')
 run(filled)
 receipt=memory('mutate',cmd,'int05-memory-create')['data']
 H.check('전체 증분 환경에서 기억 생성·판1',receipt['version']==1)
 H.check('원번호 복구·닫기는 같은 접수증',memory('recover',cmd,'int05-memory-create')['data']==receipt and memory('close',cmd,'int05-memory-create')['data']==receipt)
 H.check('기억 같은 번호 다른 원문 거부',code(memory('mutate',{**cmd,'body':'다른 원문'},'int05-memory-create'))=='IDEMPOTENCY_CONFLICT')
 selected=memory('select',[dict(id=cmd['id'],version=1)])
 H.check('선택 기억은 원문·현재 판 유지',selected['data']['items'][0]['body']==cmd['body'])
 update={**cmd,'kind':'update','expectedVersion':1,'title':'짧은 설명'}
 H.check('기억 편집 판2',memory('mutate',update,'int05-memory-update')['data']['version']==2)
 H.check('옛 판 선택 거부',code(memory('select',[dict(id=cmd['id'],version=1)]))=='CONFLICT')
 H.check('현재 판 선택 가능',memory('select',[dict(id=cmd['id'],version=2)])['data']['items'][0]['version']==2)
 deletion=dict(kind='delete',id=cmd['id'],expectedVersion=2,confirmed=True)
 H.check('기억 삭제 판3',memory('mutate',deletion,'int05-memory-delete')['data']['version']==3)
 H.check('삭제된 원문 목록 비노출',memory('list')['data']['items']==[])
 H.check('삭제 뒤 옛 요청 복구로 원문 부활 없음',memory('recover',cmd,'int05-memory-create')['data']==receipt and memory('list')['data']['items']==[])
 run("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,'knowledge','active',%s,'INT05 합성 자료 시험')",(school,member))
 inp=dict(title='시험 학교 규정',kind='regulation',body='첫판 본문',locator='제1조',effectiveFrom='2020-01-01',effectiveThrough='')
 source=mutation(dict(kind='create',input=inp),'int05-source-create')['id']
 mutation(dict(kind='update',id=source,expectedVersion=1,input={**inp,'title':'바뀐 규정','body':'둘째판 본문'}),'int05-source-update')
 mutation(dict(kind='publish',id=source,expectedVersion=2,reason='격리 합성 게시'),'int05-source-publish')
 H.check('다른 신규 모듈 설치 뒤도 K1 과거 원문 그대로',knowledge('get',source,1)['data']['source']['body']=='첫판 본문')
 H.check('K1 최신 게시판 정확 조회',knowledge('get',source,3)['data']['source']['status']=='published')
 H.check('K1 이력 판별 내림차순·누락 없음',[r['version'] for r in knowledge('history',source)['data']['items']]==[3,2,1])
 H.check('K1 없는 판은 NOT_FOUND',code(knowledge('get',source,99))=='NOT_FOUND')
 H.check('기억·자료 게시가 AI 정책과 키를 자동 활성화하지 않음',status()['status']=='policy_missing' and run('select (select count(*) from workhub.ai_credentials),(select count(*) from workhub.ai_school_policies)')[0]==(0,0))
 capture=report/'integrated-app-captures.json'
 capture.write_text(json.dumps(captures,ensure_ascii=False,indent=2),encoding='utf8')
 bridge=Path(__file__).with_name('verify_app_captures.mjs')
 result=subprocess.run(['node',str(bridge),str(capture)],cwd=root,capture_output=True,text=True,encoding='utf8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
 (report/'integrated-app.log').write_text(result.stdout+result.stderr,encoding='utf8')
 if result.returncode:raise RuntimeError(result.stdout+result.stderr)
 print(result.stdout,flush=True)
 H.check('전체 동시설치 실제 RPC 응답 모두 앱 parser 일치',True)
 return len(captures)
