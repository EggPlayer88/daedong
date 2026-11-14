"""실제 기존 RPC를 호출하는 합성 알림 회귀. 외부·운영·AI 호출 없음."""
from pathlib import Path
import os,sys,json,datetime,concurrent.futures,subprocess

def configure(integration):
 global I,H,q,HERE,ROOT,R
 I=integration;H=I.H;q=I.run;ROOT=I.ROOT;HERE=Path(__file__).resolve().parents[1]
 # 기존 R1 시험 fixture만 재사용한다. 연결 대상은 방금 생성한 고정 localhost DB로 바꾼다.
 os.environ['R0_PGHOST']='127.0.0.1';os.environ['R0_PG_PORT']=str(H.PORT);os.environ['R1_DIR']=str(ROOT/'database/workhub/r1')
 sys.path.insert(0,str(ROOT/'database/workhub/r1/test'));import run_r1
 R=run_r1;R.DB=I.DB

def checked(response):
 if not isinstance(response,dict) or 'error' in response:raise AssertionError(response)
 return response.get('data',response)

def mutate(command,key,mid=None,uid=None):return I.rpc('workhub_message_mutate',mid or ADMIN,command,key,False,uid=uid or H.ADMIN)
def collection(command,key):return I.rpc('workhub_collection_mutate',ADMIN,command,key)
def notices():return q("SELECT owner_membership_id,title,body,source_module,source_id,dedupe_key FROM workhub.notifications ORDER BY id")
def counts():return I.preserve(['workhub.messages','workhub.notifications','workhub.collections','workhub.collection_schemas','workhub.collection_units','workhub.collection_unit_members','workhub.message_threads','workhub.message_thread_members','workhub.message_requests','workhub.idempotency_receipts'])

def injected_failure(operation):
 try:
  operation()
 except H.psycopg2.Error as error:
  return 'NT1_TEST_FAILURE' in str(error)
 return False
def new_start(mode='group'):
 return dict(kind='start',mode=mode,recipients=[dict(memberId=R.M[n],expectedVersion=1) for n in ([21] if mode=='direct' else [21,22])],title='알림 합성 대화',body='알림에 복제하지 않을 민감한 원문',attachmentIds=[])
def create_collection(key):
 inp=R.coll_input(reviewMode='none',reviewerMemberId='',fileCollection=None,units=[dict(label='1반',responsibleMemberId=R.M[21],contributorMemberIds=[R.M[22]]),dict(label='2반',responsibleMemberId=R.M[23],contributorMemberIds=[R.M[22]]),dict(label='관리자',responsibleMemberId=ADMIN,contributorMemberIds=[])])
 del inp['fileCollection']
 result=checked(collection(dict(kind='create',input=inp),key))
 return dict(kind='publish',requestId=result['requestId'],expectedVersion=result['resourceVersion'])

def before():
 global ADMIN,SCHOOL
 R.fixtures()
 SCHOOL,ADMIN=q('SELECT m.school_id,m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s ORDER BY m.id LIMIT 1',(H.ADMIN,))[0]
 q(R.fill_json(str(ROOT/'database/workhub/p3/P3-04_메시지활성화_양식.sql'),dict(approver_user_id=H.ADMIN,approval_ref='NT1 격리 회귀',body_characters=2000,title_characters=100,recipients=60)))
 today=q("SELECT workhub_private.today_in('Asia/Seoul')")[0][0]
 q(R.fill_json(str(ROOT/'database/workhub/r1s/R1S-04_학교활성화_양식.sql'),dict(approver_user_id=H.ADMIN,approval_ref='NT1 격리 회귀',deployment_ref='합성 서버',deployment_checked_on=today.isoformat(),policies=dict(effective_from=(today-datetime.timedelta(days=1)).isoformat(),common_file_safety=dict(extensions=['hwpx'],maxFileBytes=20971520,maxFiles=5,allowUnscanned=False),school_file_upload=dict(extensions=['hwpx'],maxFileBytes=20971520,maxFiles=5,allowUnscanned=False,uploadTtlMinutes=30),school_submission=dict(allowWithdrawal=True,allowCorrectionWindow=True,maxCorrectionDays=14,unattachedRetentionDays=7)))))
 checked(mutate(new_start(),'nt1-before-message'))
 checked(collection(create_collection('nt1-before-create'),'nt1-before-publish'))
 H.check('B3 수정 전 실제 메시지·수합 공개는 알림 0건으로 재현',len(notices())==0)
 # 대상 범위는 시험 DB 안에서 기존 OP1 계약대로 설정한다. 전역 superadmin 권한으로 검증을 대신하지 않는다.
 for n in [21,22,23]:
  q("UPDATE public.users SET role='teacher' WHERE id=%s",(R.T[n],))
  q("INSERT INTO workhub.participant_grants(school_id,membership_id,auth_user_id,scopes,active,expires_at,approved_by_membership_id,approval_ref,app_deploy_ref) VALUES(%s,%s,%s,ARRAY['messages','collections'],true,clock_timestamp()+interval '1 day',%s,'격리 회귀','격리 앱')",(SCHOOL,R.M[n],R.T[n],ADMIN))
 H.check('시험 수신 교사는 일반 교사 유지',q("SELECT count(*) FROM public.users WHERE id=ANY(%s) AND role='teacher'",([R.T[n] for n in [21,22,23]],))[0][0]==3)

def guard_tests(install):
 # 본문·소유자가 달라진 기존 함수는 설치 전체를 중단하며 새 객체를 남기지 않는다.
 for label,mutation in [('본문 변조',"SELECT pg_get_functiondef('workhub_private.p3_post(workhub_private.actor_context,text,text,text[],text)'::regprocedure)"),('소유자 변조',None)]:
  with H.connect(user='supabase_admin',db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('BEGIN')
    if mutation:
     cur.execute(mutation);body=cur.fetchone()[0].replace('BEGIN','BEGIN\n -- NT1 실패 주입',1);cur.execute(body)
    else:cur.execute('ALTER FUNCTION workhub_private.p3_post(workhub_private.actor_context,text,text,text[],text) OWNER TO supabase_admin')
    cur.execute('SET LOCAL ROLE postgres');cur.execute('SAVEPOINT guard')
    try:cur.execute(install);raise AssertionError('훼손 원문 설치 허용')
    except H.psycopg2.Error as e:H.check(label+' 설치 가드', '선행 함수 원문/소유자 불일치' in str(e))
    cur.execute('ROLLBACK TO guard');cur.execute("SELECT to_regclass('workhub_private.nt1_installs'),to_regprocedure('workhub_private.nt1_message_notice()')");H.check(label+' 중단은 새 객체 0',cur.fetchone()==(None,None));cur.execute('ROLLBACK')

def after():
 start=new_start();key='nt1-start';receipt=checked(mutate(start,key));thread=receipt['deliveries'][0]['threadId'];message=receipt['deliveries'][0]['messageId']
 n=notices();H.check('새 단체 메시지는 본인 제외 2명에게 알림',len(n)==2 and {x[0] for x in n}=={R.M[21],R.M[22]})
 H.check('메시지 원문 복제 없이 정확한 대화로 연결',all(x[3]=='messages' and x[4]==thread and '민감한 원문' not in x[2] for x in n))
 H.check('같은 메시지 요청 재전송 접수증 불변·중복 0',checked(mutate(start,key))==receipt and notices()==n)
 thread_data=checked(I.rpc('workhub_message_get',R.M[21],thread,None,uid=R.T[21]))['thread']
 reply=dict(kind='reply',threadId=thread,expectedVersion=thread_data['version'],recipientMemberIds=[ADMIN,R.M[22]],body='합성 답장',attachmentIds=[])
 replied=checked(mutate(reply,'nt1-reply',R.M[21],R.T[21]));after_reply=notices()
 add=[x for x in after_reply if x not in n]
 H.check('일반 교사 답장은 발신 교사를 제외한 나머지 2명 알림',len(add)==2 and {x[0] for x in add}=={ADMIN,R.M[22]})
 H.check('답장 재전송 접수증 불변·중복 0',checked(mutate(reply,'nt1-reply',R.M[21],R.T[21]))==replied and notices()==after_reply)
 inbox=checked(I.rpc('workhub_inbox_list',R.M[21],True,None,uid=R.T[21]))
 H.check('기존 업무 알림 RPC에 본인 도착 알림과 원본 링크 제공',len(inbox['items'])==1 and inbox['items'][0]['source']==dict(module='messages',id=thread))
 uid,mid=R.T[27],R.M[27]
 other=I.rpc('workhub_inbox_list',mid,True,None,uid=uid)
 H.check('다른 학교는 도착 알림을 조회하지 못함',other.get('error',{}).get('code')=='NOT_READY')
 command=create_collection('nt1-create');before_publish=notices();published=checked(collection(command,'nt1-publish'));after_publish=notices()
 new=[x for x in after_publish if x not in before_publish]
 H.check('수합 공개는 책임자·공동작성자 3명에게 각 1회',len(new)==3 and {x[0] for x in new}=={R.M[n] for n in [21,22,23]})
 H.check('수합 본인은 제외하고 정확한 수합으로 연결',all(x[3]=='collections' and x[4]==command['requestId'] for x in new))
 H.check('수합 공개 재전송 접수증 불변·중복 0',checked(collection(command,'nt1-publish'))==published and notices()==after_publish)
 c=checked(I.rpc('workhub_inbox_list',R.M[22],True,None,uid=R.T[22]))
 H.check('공동작성자 업무 알림에 수합 공개가 보임',any(x['source']==dict(module='collections',id=command['requestId']) for x in c['items']))
 # DB 원장을 통한 idempotency를 병렬 재전송에도 확인한다.
 direct=new_start('direct');before_parallel=len(notices())
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(lambda _:checked(mutate(direct,'nt1-parallel')),range(2)))
 H.check('동시 재전송은 같은 접수증·새 알림 1개',rs[0]==rs[1] and len(notices())==before_parallel+1)
 # 알림 INSERT가 중간에 실패하면 메시지·수합도 같은 트랜잭션에서 되돌아가야 한다.
 q("CREATE FUNCTION workhub_private.nt1_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_membership_id='m-22' THEN RAISE EXCEPTION 'NT1_TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER nt1_test_fail BEFORE INSERT ON workhub.notifications FOR EACH ROW EXECUTE FUNCTION workhub_private.nt1_test_fail()")
 before=counts();failed=injected_failure(lambda:mutate(new_start(),'nt1-fail-message'));H.check('메시지 알림 실패는 메시지·알림·접수증 전체 롤백',failed and counts()==before)
 command=create_collection('nt1-fail-create');before=counts();failed=injected_failure(lambda:collection(command,'nt1-fail-publish'));H.check('수합 알림 실패는 공개·제출단위·알림·접수증 전체 롤백',failed and counts()==before)
 q('DROP TRIGGER nt1_test_fail ON workhub.notifications;DROP FUNCTION workhub_private.nt1_test_fail()')
 checked(collection(command,'nt1-fail-publish'));H.check('실패한 공개는 같은 번호로 재시도해 정상 공개 가능',q('SELECT state FROM workhub.collections WHERE id=%s',(command['requestId'],))[0][0]=='published')
 # API 역할은 새 트리거 함수를 임의 호출할 수 없다.
 for role in ['anon','authenticated','service_role']:
  with H.connect(db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('SET ROLE '+role)
    try:cur.execute('SELECT workhub_private.nt1_message_notice()');raise AssertionError('권한 누출')
    except H.psycopg2.Error as e:H.check(role+' 내부 함수 직접 호출 차단','permission denied' in str(e))
 H.check('알림 연결은 기존 메시지 읽음 순번을 바꾸지 않음',q('SELECT count(*) FROM workhub.message_thread_members WHERE read_sequence<>0')[0][0]==0)
 capture=dict(inboxes=[dict(scope=dict(schoolId=SCHOOL,memberId=R.M[n],userId=R.T[n]),raw=I.rpc('workhub_inbox_list',R.M[n],False,None,uid=R.T[n])) for n in [21,22,23]],messages=[dict(raw=receipt,command=start,key=key,self=ADMIN),dict(raw=replied,command=reply,key='nt1-reply',self=R.M[21])],collection=dict(raw=published,key='nt1-publish',requestId=published['requestId']))
 target=H.WORK/'nt1-app-captures.json';target.write_text(json.dumps(capture,ensure_ascii=False),encoding='utf-8')
 subprocess.run(['node',str(HERE/'test/app_contract.mjs'),str(target)],cwd=ROOT,check=True)
 H.check('실제 SQL 응답 6건의 현재 앱 parser 대조',True)
