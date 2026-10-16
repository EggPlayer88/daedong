"""Claude 비서 경계 시험. 모든 AI·DB 응답은 합성이며 외부 호출은 하지 않는다."""
import copy
import http.client
import importlib.util
import io
import json
import sys
import threading
import time
from http.server import HTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
API=ROOT/'apps/main/api/workhub-ai'
sys.path.insert(0,str(API))
import _assistant as a
spec=importlib.util.spec_from_file_location('workhub_chat_handler',API/'chat.py');route=importlib.util.module_from_spec(spec);spec.loader.exec_module(route)
PASSED=FAILED=0
TOKEN='Bearer '+('test-token-'*3)
ENV={'ANTHROPIC_API_KEY':'synthetic-key-never-used-remotely'}
KEY='request-original-123'
REF={'kind':'knowledge','id':'school-rule','version':3}
EVIDENCE={'kind':'observation','id':'observation-one','revisionId':'revision-one','sourceHash':'a'*64,'epoch':0,'start':0,'end':3}
def check(name,run):
 global PASSED,FAILED
 try: run();PASSED+=1;print('  ✓ '+name)
 except Exception as error: FAILED+=1;print('  ✗ '+name+': '+repr(error));import traceback;traceback.print_exc()
def eq(actual,expected):
 assert actual==expected,(actual,expected)
def error(run,code):
 try:run()
 except a.CheckError as problem: eq(problem.code,code);return
 raise AssertionError('예외 없음: '+code)
def input(mode='school',intent='school_advice'):
 return {'mode':mode,'intent':intent,'prompt':'제출 절차를 알려 주세요.','threadId':None,'expectedVersion':0,'references':[copy.deepcopy(REF)],'studentContext':None}
def payload(value=None):return {'action':'ask','memberId':'member-one','input':value or input(),'requestKey':KEY}
def env(data,**patch):return {'contract':'assistant.v1','schoolId':'school-one','memberId':'member-one','data':data,**patch}
def claim(value=None):
 return {'state':'claimed','requestKey':KEY,'leaseToken':'lease-one','input':value or input(),'history':[],'sources':[{'key':'source-one','reference':copy.deepcopy(REF),'title':'확정 학교 안내','locator':'제3항','classification':'school_public','body':'담당자에게 제출합니다.'}],'policy':{'approved':True,'configVersion':1,'model':'approved-test-model','maxTokens':100,'budget':{'reservationId':'reservation-one','policyVersion':1,'currency':'USD','reservedMicroUsd':500,'dailyLimitMicroUsd':5000,'monthlyLimitMicroUsd':50000}}}
def provider_output(source_keys=None,draft=None):
 return {'response':{'type':'message','role':'assistant','id':'msg_synthetic','stop_reason':'tool_use','usage':{'input_tokens':20,'output_tokens':15},'content':[{'type':'tool_use','id':'tool-one','name':'deliver_workhub_answer','input':{'segments':[{'text':'담당자에게 제출해 주세요.','sourceKeys':['source-one'] if source_keys is None else source_keys}],'taskDraft':draft}}]}}
def thread(value,result):
 return {'id':'thread-one','mode':value['mode'],'version':1,'title':'학교 업무 대화','exchanges':[{'id':'exchange-one','requestKey':KEY,'intent':value['intent'],'prompt':value['prompt'],'segments':result['segments'],'proposal':None if result['taskDraft'] is None else {'id':'proposal-one','version':1,'kind':'create_personal_task','input':result['taskDraft'],'status':'pending','resourceId':None},'createdAt':'2026-10-16T10:00:00+09:00','studentContext':value['studentContext']}],'nextCursor':None}
class Client:
 def __init__(self,c=None):self.claim=c or claim();self.calls=[];self.started=False;self.result=None;self.deadline=time.monotonic()+45;self.fail_finish=False;self.fail_start=False;self.start_allowed=True;self.auth=True;self.finish_input=None
 def user(self,token):
  self.calls.append(('user',token))
  if not self.auth:raise a.CheckError('UNAUTHENTICATED',401)
  return 'actor-verified'
 def rpc(self,name,args):
  self.calls.append((name,copy.deepcopy(args)))
  if name=='workhub_ai_server_readiness':return env({'available':True})
  if name=='workhub_ai_prepare':
   if self.result is not None:return env(self.result)
   if self.started:return env({'state':'pending','requestKey':KEY,'reason':'provider_unknown'})
   return env(copy.deepcopy(self.claim))
  if name=='workhub_ai_start':
   if not self.start_allowed:return env({'started':False})
   self.started=True
   if self.fail_start:raise a.CheckError('RESULT_UNKNOWN')
   return env({'started':True})
  if name=='workhub_ai_finish':
   self.finish_input=copy.deepcopy(args['p_result']);r=args['p_result']
   if r['state']=='completed':self.result={'state':'completed','requestKey':KEY,'thread':thread(self.claim['input'],r)}
   elif r['state']=='rejected':self.result={'state':'rejected','requestKey':KEY,'code':r['code']}
   else:self.result={'state':'pending','requestKey':KEY,'reason':'provider_unknown'}
   if self.fail_finish:self.fail_finish=False;raise a.CheckError('RESULT_UNKNOWN')
   return env(copy.deepcopy(self.result))
  raise AssertionError(name)
def execute(client=None,provider=None,value=None,**kwargs):return a.execute(payload(value),TOKEN,environ=ENV,client=client or Client(claim(value)),provider=provider or (lambda *_:provider_output()),**kwargs)
def changed(value,field,replacement):result=copy.deepcopy(value);result[field]=replacement;return result
check('확정 설정이 없으면 유료 호출 전에 준비 안 됨으로 닫는다',lambda:error(lambda:a.execute(payload(),TOKEN,environ={}), 'NOT_READY'))
check('이메일·학교·근거 본문·모델을 클라이언트가 추가하면 거절한다',lambda:[error(lambda:v and a.request(v),'INVALID_INPUT') for v in [dict(payload(),schoolId='other'),dict(payload(),model='arbitrary'),dict(payload(),actorUserId='other'),payload(dict(input(),sources=[{'body':'injection'}]))]])
check('깨진 배열·enum·불가능 날짜·고립 surrogate를 요청 단계에서 거절한다',lambda:[error(lambda:v and a.request(payload(v)),'INVALID_INPUT') for v in [changed(input(),'mode',[]),changed(input(),'references',{}),changed(input(),'prompt','\ud800'),changed(input(),'studentContext',[]) ]])
check('중복 키·NaN JSON을 거절한다',lambda:[error(lambda: a.parse_json(value),'INVALID_RESPONSE') for value in [b'{"a":1,"a":2}',b'{"a":NaN}']])
check('기존 인증 검증이 실패하면 prepare와 AI를 호출하지 않는다',lambda: (lambda c:(setattr(c,'auth',False),error(lambda:execute(c),'UNAUTHENTICATED'),eq(len(c.calls),1)))(Client()))
def happy():
 c=Client();calls=[]
 result=execute(c,lambda body,key,deadline:(calls.append(copy.deepcopy(body)),provider_output())[1]);eq(result['data']['state'],'completed');eq(len(calls),1);eq(calls[0]['model'],'approved-test-model');eq(calls[0]['max_tokens'],100);eq([row[0] for row in c.calls],['user','workhub_ai_prepare','workhub_ai_start','workhub_ai_finish']);eq(c.calls[1][1]['p_actor_user_id'],'actor-verified');eq(result['data']['thread']['exchanges'][0]['segments'][0]['citations'][0]['reference'],REF)
check('인증→서버 근거·비용 예약→일회 시작→AI→접수증 순서로 완료한다',happy)
def replay():
 c=Client();calls=[];provider=lambda *_:(calls.append(1),provider_output())[1];first=execute(c,provider);second=execute(c,provider);eq(first,second);eq(len(calls),1)
check('같은 요청 완료 재전송은 저장 접수증만 반환하고 AI를 다시 부르지 않는다',replay)
def lost_finish():
 c=Client();c.fail_finish=True;calls=[];provider=lambda *_:(calls.append(1),provider_output())[1];eq(execute(c,provider)['data']['state'],'pending');eq(execute(c,provider)['data']['state'],'completed');eq(len(calls),1)
check('finish 응답 유실 뒤 같은 요청으로 완료 기록을 복원한다',lost_finish)
def lost_start():
 c=Client();c.fail_start=True;calls=[];provider=lambda *_:calls.append(1);error(lambda:execute(c,provider),'RESULT_UNKNOWN');eq(execute(c,provider)['data']['state'],'pending');eq(calls,[])
check('시작권 응답이 사라져도 새 AI 호출을 만들지 않는다',lost_start)
def timed_out():
 c=Client();calls=[]
 def provider(*_):calls.append(1);raise a.CheckError('RESULT_UNKNOWN')
 eq(execute(c,provider)['data']['state'],'pending');eq(execute(c,provider)['data']['state'],'pending');eq(len(calls),1);eq(c.finish_input['state'],'provider_unknown')
check('AI 제한시간 초과는 미확정으로 보존하며 자동 재시도하지 않는다',timed_out)
check('다른 실행자가 시작한 요청은 AI 호출 없이 처리 중으로 응답한다',lambda:(lambda c:(setattr(c,'start_allowed',False),eq(execute(c,lambda *_:(_ for _ in()).throw(AssertionError('provider called')))['data']['reason'],'in_progress')))(Client()))
def invalid_claims():
 for edit in [lambda c:c['policy'].update(approved=False),lambda c:c['policy'].update(model='https://evil'),lambda c:c['policy']['budget'].update(reservedMicroUsd=999999),lambda c:c['sources'][0].update(classification='owner_private'),lambda c:c['input'].update(prompt='다른 요청')]:
  c=claim();edit(c);client=Client(c)
  try:execute(client,lambda *_:(_ for _ in()).throw(AssertionError('provider called')))
  except a.CheckError:pass
  else:raise AssertionError('claim accepted')
  eq(client.started,False)
check('미승인 설정·예약 상한·학교 범위·원문 불일치는 호출 전에 차단한다',invalid_claims)
check('학교 안내에는 개인 할 일 근거를 혼입할 수 없다',lambda:error(lambda:a.claimed(dict(claim(),sources=[{'key':'t','reference':{'kind':'task','id':'private','version':1},'title':'개인','locator':'본문','classification':'school_public','body':'private'}]),input(),KEY),'INVALID_RESPONSE'))
def evidence():
 value=input('personal','student_record_draft');value['studentContext']={'studentId':'student-one','courseId':'course-one','evidence':[copy.deepcopy(EVIDENCE)]};c=claim(value);c['sources']=[{'key':'source-one','reference':copy.deepcopy(EVIDENCE),'title':'관찰 기록','locator':'선택한 3자','classification':'student_learning','body':'가😀나'}];a.claimed(c,value,KEY);r=execute(Client(c),value=value);eq(r['data']['thread']['exchanges'][0]['segments'][0]['citations'][0]['reference'],EVIDENCE)
 for ref in [dict(EVIDENCE,epoch=1),dict(EVIDENCE,sourceHash='b'*64),dict(EVIDENCE,revisionId='new'),dict(EVIDENCE,end=2)]:
  broken=copy.deepcopy(c);broken['sources'][0]['reference']=ref;error(lambda:a.claimed(broken,value,KEY),'INVALID_RESPONSE')
check('학생 근거는 개정·해시·세대·Unicode 구간을 손실 없이 검증한다',evidence)
check('상담·임의 종류를 학생 근거로 허용하지 않는다',lambda:[error(lambda:a.reference(dict(EVIDENCE,kind=value)),'INVALID_RESPONSE') for value in ['counseling','health',[]]])
check('독립 문서함의 승인된 판 정보를 근거로 유지한다',lambda:eq(a.reference({'kind':'document','id':'document-one','version':3}),{'kind':'document','id':'document-one','version':3}))
check('모델의 존재하지 않는 출처를 출력 거부하고 사용량을 기록한다',lambda:(lambda c:(eq(execute(c,lambda *_:provider_output(['invented']))['data']['code'],'OUTPUT_INVALID'),eq(c.finish_input['usage']['inputTokens'],20)))(Client()))
check('학교 안내에서 모델이 생성한 쓰기 제안은 거부한다',lambda:eq(execute(provider=lambda *_:provider_output(draft={'title':'할 일','notes':'','dueDate':''}))['data']['code'],'OUTPUT_INVALID'))
check('개인 비서의 할 일은 제안만 저장하고 실제 task mutation은 호출하지 않는다',lambda:(lambda c:(eq(execute(c,lambda *_:provider_output(draft={'title':'초안','notes':'메모','dueDate':'2026-10-20'}),value=c.claim['input'])['data']['thread']['exchanges'][0]['proposal']['status'],'pending'),eq([x[0] for x in c.calls][-1],'workhub_ai_finish')))(Client(claim(input('personal','personal_assistant')))))
check('틀린 날짜 제안은 출력 거부한다',lambda:eq(execute(Client(claim(input('personal','personal_assistant'))),lambda *_:provider_output(draft={'title':'초안','notes':'','dueDate':'2026-02-30'}),value=input('personal','personal_assistant'))['data']['code'],'OUTPUT_INVALID'))
def invalid_outputs():
 for edit in [lambda r:r['response'].update(stop_reason='end_turn'),lambda r:r['response'].update(content=[{'type':'text','text':'raw answer'}]),lambda r:r['response']['content'][0]['input']['segments'][0].update(sourceKeys=['source-one','source-one']),lambda r:r['response']['content'][0]['input'].update(segments=[]),lambda r:r['response']['content'][0]['input'].update(action='delete')]:
  value=provider_output();edit(value);eq(execute(provider=lambda *_:value)['data']['code'],'OUTPUT_INVALID')
check('자유 텍스트·중복 근거·빈 답변·임의 실행 필드를 안전하게 거부한다',invalid_outputs)
check('토큰 상한에서 잘린 답변은 완료로 저장하지 않는다',lambda:eq(execute(provider=lambda *_:{'response':dict(provider_output()['response'],stop_reason='max_tokens')})['data']['code'],'TRUNCATED'))
check('provider 4xx 확정 거절과 불명확 응답을 구분한다',lambda:(eq(execute(provider=lambda *_:{'rejected':True})['data']['code'],'PROVIDER_REJECTED'),eq(execute(provider=lambda *_:{'response':{'error':'secret'}})['data']['state'],'pending')))
def replay_mismatch():
 for edit in [lambda r:r['thread'].update(version=9),lambda r:r['thread']['exchanges'][0].update(prompt='다른 요청'),lambda r:r['thread'].update(mode='personal')]:
  c=Client();result=execute(c)['data'];edit(result);c.result=result;error(lambda:execute(c),'INVALID_RESPONSE')
check('재전송 접수증도 원 질문·모드·기대 판과 일치해야 한다',replay_mismatch)
def student_uncited():
 value=input('personal','student_record_draft');value['studentContext']={'studentId':'student-one','courseId':'course-one','evidence':[copy.deepcopy(EVIDENCE)]};c=claim(value);c['sources']=[{'key':'source-one','reference':copy.deepcopy(EVIDENCE),'title':'관찰','locator':'선택 구간','classification':'student_learning','body':'가😀나'}]
 eq(execute(Client(c),lambda *_:provider_output([]),value=value)['data']['code'],'OUTPUT_INVALID')
check('학생 초안 문단이 선택한 학습 근거를 인용하지 않으면 저장하지 않는다',student_uncited)
check('고정 시스템 지시문과 자료 JSON만 제공하며 브라우저·쓰기 도구는 없다',lambda:(lambda b:(eq(b['system'],a.POLICY),eq(b['tool_choice'],{'type':'tool','name':'deliver_workhub_answer'}),eq(len(b['tools']),1),eq(b['stream'],False),eq(json.loads(b['messages'][-1]['content'])['authorizedEvidence'][0]['sourceKey'],'source-one')))(a.provider_body(claim())))
class Response:
 def __init__(self,status=200,body=None,headers=None):self.status=status;self.raw=json.dumps(provider_output()['response']).encode() if body is None else body;self.body=io.BytesIO(self.raw);self.headers=headers or {}
 def getheader(self,name,default=None):return self.headers.get(name,default)
 def read1(self,size):return self.body.read(size)
class Connection:
 def __init__(self,response):self.response=response;self.closed=False;self.sock=None;self.requested=None
 def request(self,*args,**kwargs):self.requested=(args,kwargs)
 def getresponse(self):return self.response
 def close(self):self.closed=True
def transport():
 calls=[];conn=Connection(Response());r=a.anthropic(a.provider_body(claim()),'synthetic-key',45,connection_factory=lambda *args,**kwargs:(calls.append((args,kwargs)),conn)[1],clock=lambda:0);eq(calls[0][0],('api.anthropic.com',443));eq(conn.requested[0],('POST','/v1/messages'));eq(conn.requested[1]['headers']['anthropic-version'],'2023-06-01');eq(conn.closed,True);eq(r['response']['id'],'msg_synthetic')
check('네트워크 경로는 Anthropic 고정 host·path이며 한 번만 전송한다',transport)
def transport_failures():
 for response in [Response(302),Response(500),Response(headers={'Content-Encoding':'gzip'}),Response(headers={'Content-Length':'99999999'}),Response(body=b'{}',headers={'Content-Length':'100'}),Response(body=b'x'*(a.LIMITS['responseBytes']+1))]:
  conn=Connection(response);error(lambda:a.anthropic({},'synthetic',45,connection_factory=lambda *_args,**_kwargs:conn,clock=lambda:0),'RESULT_UNKNOWN');eq(conn.closed,True)
check('리디렉션·5xx·압축·과대·잘린 응답을 재시도 없이 미확정 처리한다',transport_failures)
check('전송 시작 전 전체 제한시간이 지나면 요청하지 않는다',lambda:error(lambda:a.anthropic({},'synthetic',3,connection_factory=lambda *_a,**_k:(_ for _ in()).throw(AssertionError('network')),clock=lambda:0),'RESULT_UNKNOWN'))
def scope_reply():
 c=Client();original=c.rpc
 def rpc(name,args):r=original(name,args);r['schoolId']='other-school' if name=='workhub_ai_start' else r['schoolId'];return r
 c.rpc=rpc;error(lambda:execute(c),'INVALID_RESPONSE')
check('시작 응답의 학교가 예약 범위와 다르면 외부 호출하지 않는다',scope_reply)
def http_handler():
 original=route.execute;calls=[];route.execute=lambda p,token:(calls.append((p,token)),env({'available':True}))[1]
 server=HTTPServer(('127.0.0.1',0),route.handler);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
 try:
  def request(body,headers=None,method='POST',label='정상 요청'):
   conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5);stage='송신'
   try:
    conn.request(method,'/api/workhub-ai/chat',body=body,headers=headers or {'Content-Type':'application/json','Authorization':TOKEN})
    stage='응답 헤더';response=conn.getresponse();stage='응답 본문'
    return response.status,response.read(),response.getheader('Cache-Control')
   except Exception as failure:
    raise AssertionError(f'{label} / {stage}: {failure!r}') from failure
   finally:conn.close()
  result=request(json.dumps({'action':'readiness','memberId':'member-one'}));eq(result[0],200);eq(result[2],'no-store');eq(len(calls),1)
  for label,body,headers in [('내용 유형','{}',{'Content-Type':'text/plain'}),('중복 JSON 키','{"a":1,"a":2}',{'Content-Type':'application/json'}),('빈 본문','',{'Content-Type':'application/json'})]:
   eq(request(body,headers,label=label)[0],400)
  # 길이 상한은 본문을 읽기 전에 거부해야 한다. 큰 본문을 동시에 송신하면 Windows의 TCP 종료 경합을 시험하게 된다.
  # 헤더만 보내서 400과 오류 본문을 확인하며, 연결 중단을 성공으로 취급하거나 재시도하지 않는다.
  result=request(None,{'Content-Type':'application/json','Content-Length':str(a.LIMITS['requestBytes']+1)},label='본문 전 길이 상한')
  eq(result[0],400);eq(json.loads(result[1]),{'error':{'code':'INVALID_INPUT'}});eq(len(calls),1)
  eq(request(None,method='GET',label='GET 거절')[0],405);eq(len(calls),1)
 finally:server.shutdown();server.server_close();worker.join();route.execute=original
check('실제 로컬 HTTP에서 제한된 JSON 읽기·중복 키·내용 유형·GET 거절을 확인한다',http_handler)

def task_limits():
 value=input('personal','personal_assistant');c=claim(value)
 for title,notes in [('😀'*120,'메'*2000),('가'*120,'😀'*2000)]:
  draft={'title':title,'notes':notes,'dueDate':''};result=a.checked_output(provider_output(draft=draft),c);eq(result['state'],'completed');eq(result['taskDraft'],draft)
 for draft in [{'title':'가'*121,'notes':'','dueDate':''},{'title':'제목','notes':'메'*2001,'dueDate':''},{'title':' '+'가'*120,'notes':'','dueDate':''}]:
  result=a.checked_output(provider_output(draft=draft),c);eq(result['code'],'OUTPUT_INVALID');eq(result['usage'],{'inputTokens':20,'outputTokens':15})
 schema=a.TOOL['input_schema']['properties']['taskDraft']['anyOf'][1]['properties'];eq(schema['title']['maxLength'],a.TASK_LIMITS['titleChars']);eq(schema['notes']['maxLength'],a.TASK_LIMITS['notesChars'])
check('새 AI 할 일은 단일 자산의 120·2000 코드포인트 경계를 넘으면 잘라내지 않고 출력 거부한다',task_limits)

def task_normalization():
 draft={'title':'\ufeff 제목 \u00a0','notes':' 메모\n','dueDate':''};eq(a.task_input(draft),{'title':'제목','notes':'메모','dueDate':''})
 eq(a.task_input(dict(draft,title='\u0085'))['title'],'\u0085')
 error(lambda:a.task_input(dict(draft,title='\u0085'),legacy_read=True),'INVALID_RESPONSE')
 for title in ['\ufeff','\ud800','\x00']:
  error(lambda:a.task_input(dict(draft,title=title)),'INVALID_RESPONSE')
check('새 제안의 앞뒤 공백은 기존 업무의 ECMAScript trim과 일치한다',task_normalization)

def old_task_read():
 value=input('personal','personal_assistant');draft={'title':'😀'*200,'notes':'메'*4000,'dueDate':''}
 t=thread(value,{'segments':[{'text':'확인해 주세요.','citations':[]}],'taskDraft':draft});eq(a.public_thread(t),t);error(lambda:a.task_input(draft),'INVALID_RESPONSE')
 t['exchanges'][0]['proposal']['input']['notes']+='가';error(lambda:a.public_thread(t),'INVALID_RESPONSE')
check('과거 200·4000자 대화 제안은 서버가 원문 그대로 읽고 새 출력 검증과 구분한다',old_task_read)
print(f'\nClaude 비서 서버: {PASSED} 통과, {FAILED} 실패')
sys.exit(1 if FAILED else 0)
