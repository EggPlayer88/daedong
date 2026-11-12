"""운영 접속 없이 새 localhost PostgreSQL 17 전체 기준 위에 TP1을 검증한다."""
from pathlib import Path
import os,sys,json,importlib.util,datetime,copy,uuid,base64,hashlib
ROOT=Path(__file__).resolve().parents[4];HERE=Path(__file__).resolve().parents[1]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55831')
spec=importlib.util.spec_from_file_location('tp1_tr1',ROOT/'database/workhub-teacher-roster/tr1/build_checks.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B);I=B.I;H=I.H
q=I.run
def svc(name,*args):return I.rpc(name,*args,role='service_role')
def reject(label,sql,args=(),user='postgres'):
 try:q(sql,args,user=user)
 except Exception as e:
  H.check(label,any(x in str(e) for x in ['CONFLICT','FORBIDDEN','INVALID_INPUT','IMMUTABLE_ROW','permission denied','foreign key','exclusion constraint']));return
 raise AssertionError(label+' 거부되지 않음')
def tests():
 B.tests()
 # Supabase Auth의 실제 열을 합성 스키마에 추가한다. 설치 파일은 Auth 스키마를 바꾸지 않는다.
 q("ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb DEFAULT '{}',ADD COLUMN email_confirmed_at timestamptz",user='supabase_admin')
 school,admin=q('SELECT m.school_id,m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s ORDER BY m.id LIMIT 1',(H.ADMIN,))[0]
 q("INSERT INTO workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) VALUES(%s,%s,'TP1 합성 시험','active') ON CONFLICT(school_id) DO UPDATE SET state='active'",(school,admin))
 q("INSERT INTO workhub.school_roster_policies(school_id,active,approved_by_membership_id,approval_ref) VALUES(%s,true,%s,'TP1 합성 시험') ON CONFLICT(school_id) DO UPDATE SET active=true",(school,admin))
 for module in ['assistant','teaching','timetable','timetable_operations']:
  q("INSERT INTO workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) VALUES(%s,%s,'active',%s,'TP1 합성 시험') ON CONFLICT(school_id,module) DO UPDATE SET state='active'",(school,module,admin))
 svc('workhub_ai_school_policy_register',H.ADMIN,admin,'합성 TP1 정책 승인')
 envelope=dict(keyId='test-master',iv=base64.b64encode(b'i'*12).decode(),ciphertext=base64.b64encode(b'c'*80).decode(),tag=base64.b64encode(b't'*16).decode())
 status=svc('workhub_ai_school_status',H.ADMIN,admin)
 if not status['credential']['configured']:svc('workhub_ai_school_key_save',H.ADMIN,admin,'tp1-admin-key',0,envelope,'abcd')
 q('UPDATE workhub.ai_school_controls SET enabled=true WHERE school_id=%s',(school,))
 before=I.preserve(['workhub.ai_school_policies','workhub.ai_school_controls','workhub.assistant_policies','workhub.membership_roles','public.users'])
 pre=q((HERE/'TP1-00_전후점검.sql').read_text(encoding='utf-8'))
 for n in ['01','02']:I.apply(next(HERE.glob('TP1-'+n+'_*.sql')))
 after=q((HERE/'TP1-00_전후점검.sql').read_text(encoding='utf-8'));H.check('설치 전후 7개 기존 자료 지문 보존',[r for r in pre if r[0].startswith('F')]==[r for r in after if r[0].startswith('F')])
 post=q((HERE/'TP1-03_사후점검.sql').read_text(encoding='utf-8'));H.check('설치 사후점검 11행 FAIL 0',len(post)==11 and all(r[2]!='FAIL' for r in post))
 with H.connect(db=I.DB) as c:
  with c.cursor() as cur:
   cur.execute('BEGIN');cur.execute('DROP FUNCTION public.workhub_ai_confirm_task(text,jsonb,text)')
   cur.execute((HERE/'TP1-00_전후점검.sql').read_text(encoding='utf-8'));rows=cur.fetchall();H.check('사전 점검은 함수 1개 누락도 FAIL',next(r for r in rows if r[0]=='TP1-00-03')[2]=='FAIL')
   cur.execute((HERE/'TP1-03_사후점검.sql').read_text(encoding='utf-8'));rows=cur.fetchall();H.check('사후 점검은 함수 1개 누락도 FAIL',next(r for r in rows if r[0]=='TP1-03-06')[2]=='FAIL');cur.execute('ROLLBACK')
 H.check('TP1 설치가 기존 AI정책·비용·역할·회원 보존',before==I.preserve(list(before)))
 H.check('TP1만 설치하면 허용된 계정 없음',q('SELECT count(*) FROM teacher_pilot.members')[0][0]==0)
 school,admin=q('SELECT m.school_id,m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s ORDER BY m.id LIMIT 1',(H.ADMIN,))[0]
 today=q("SELECT workhub_private.today_in('Asia/Seoul')")[0][0]
 def call(name,*args,uid=H.ADMIN):return I.rpc(name,*args,uid=uid)
 get=lambda:call('workhub_teacher_roster_get',admin)['data']
 data=get();p=json.loads((ROOT/'tests/fixtures/teacher-roster/nine-classes.json').read_text(encoding='utf-8'))['plan']
 term=next(t for t in data['terms'] if datetime.date.fromisoformat(t['until'])>today+datetime.timedelta(days=8))
 p['termId']=term['id'];p['from']=(today+datetime.timedelta(days=1)).isoformat();p['until']=term['until']
 p['homerooms']=[dict(classId=p['classes'][i]['id'],teacherId=p['teachers'][i]['id']) for i in range(9)]
 def commit(intent,key):
  v=call('workhub_teacher_roster_preview',admin,intent)
  if 'error' in v:raise AssertionError(v)
  v=v['data'];H.check(key+' 미리보기 차단 없음',not v['findings'])
  r=call('workhub_teacher_roster_commit',admin,dict(previewId=v['id'],hash=v['hash'],intent=v['intent']),key)
  if 'error' in r:raise AssertionError(r)
  return r
 commit(dict(kind='save',expectedRevision=0,plan=p),'tp1-plan-save')
 commit(dict(kind='publish',expectedRevision=1,planId=p['id'],version=1),'tp1-plan-publish')
 original=I.preserve(['teacher_roster.plans','teacher_roster.teachers','teacher_roster.course_maps','workhub.courses','workhub.membership_roles'])
 # 기존 관리자의 실제 연결 한 건은 시험 배치 밖에 두고 보존한다.
 commit(dict(kind='link',expectedRevision=2,teacherId=p['teachers'][10]['id'],memberId=admin,**{'from':today.isoformat(),'until':term['until']}),'tp1-real-link')
 real_links=q('SELECT to_jsonb(t) FROM teacher_roster.links t WHERE member_id=%s',(admin,))
 batch='regression-ten';entries=[]
 for n,t in enumerate(p['teachers'][:10],1):
  uid=str(uuid.UUID(int=100+n));slot=f'T{n:02}';email=f'teacher-pilot-{batch}-{slot.lower()}@example.com';display='[시험] '+t['name']
  metadata=dict(batchId=batch,schoolId=school,teacherId=t['id'],slot=slot,configHash='a'*64)
  q('INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,email_confirmed_at) VALUES(%s,%s,%s,%s,now())',(uid,email,json.dumps(dict(full_name=display)),json.dumps(dict(teacher_pilot=metadata))),user='supabase_admin')
  # 이 저장소 Auth trigger의 가입 전 승인 상태를 실제처럼 고정한다.
  q("UPDATE public.users SET name=%s,is_active=false,role='teacher' WHERE id=%s",(display,uid))
  entries.append(dict(slot=slot,email=email,displayName=display,teacherId=t['id'],authUserId=uid))
 start=q('SELECT clock_timestamp()')[0][0];end=start+datetime.timedelta(days=6)
 args=(school,admin,batch,start,end,json.dumps(entries,ensure_ascii=False),'사용자 승인 합성 시험')
 reg='SELECT teacher_pilot.register(%s,%s,%s,%s,%s,%s,%s)'
 reject('정확히 10명보다 적은 등록 거절',reg,(*args[:5],json.dumps(entries[:9]),args[6]))
 changed=copy.deepcopy(entries);changed[0]['teacherId']=p['teachers'][10]['id']
 reject('실제 연결 교사/메타데이터 변조 거절',reg,(*args[:5],json.dumps(changed),args[6]))
 r=q(reg,args)[0][0];H.check('10명 등록은 준비 상태',r['state']=='prepared' and r['count']==10)
 H.check('같은 등록 요청 결과 보존',q(reg,args)[0][0]==r)
 first=entries[0]['authUserId'];member=q('SELECT member_id FROM teacher_pilot.members WHERE auth_user_id=%s',(first,))[0][0]
 H.check('준비 상태 AI 접근 거절',call('workhub_teacher_pilot_access',uid=first)['allowed'] is False)
 H.check('전역 교사 유지·관리자 역할 추가 없음',q("SELECT count(*) FROM public.users WHERE id=ANY(%s) AND role='teacher'",([e['authUserId'] for e in entries],))[0][0]==10 and original['workhub.membership_roles']==I.digest('workhub.membership_roles'))
 activation='SELECT teacher_pilot.activate(%s,%s,%s,%s,%s,%s,%s)'
 aargs=(school,admin,batch,1,today+datetime.timedelta(days=1),today+datetime.timedelta(days=5),'합성 배포 커밋 test-tp1')
 with H.connect(db=I.DB) as c:
  with c.cursor() as cur:
   cur.execute('BEGIN');cur.execute("UPDATE teacher_pilot.batches SET starts_at=now()+interval '1 day' WHERE id=%s",(batch,));cur.execute('SAVEPOINT attempt')
   try:cur.execute(activation,aargs);raise AssertionError('미래 시작 활성화 허용')
   except H.psycopg2.Error as e:H.check('시작 전에는 8개 일반 업무도 활성화 불가',e.diag.message_primary=='INVALID_INPUT')
   cur.execute('ROLLBACK TO attempt');cur.execute('SELECT count(*) FROM workhub.participant_grants WHERE auth_user_id=ANY(%s::uuid[])',([e['authUserId'] for e in entries],));H.check('시작 전 거절은 업무 허용 0명',cur.fetchone()[0]==0);cur.execute('ROLLBACK')
 r=q(activation,aargs)[0][0];H.check('10명 기간 역할+OP1+AI 동시 활성화',r['state']=='active' and r['revision']==2)
 H.check('같은 활성화 재호출은 원래 결과',q(activation,aargs)[0][0]==r)
 cap=call('workhub_teacher_pilot_access',uid=first);H.check('10명 중 본인만 AI capability',cap['allowed'] and cap['memberId']==member and cap['teacherId']==entries[0]['teacherId'])
 H.check('관리자·기존 일반 교사에 시험 capability 미부여',call('workhub_teacher_pilot_access',uid=H.ADMIN)['allowed'] is False and call('workhub_teacher_pilot_access',uid=H.TEACHER)['allowed'] is False)
 H.check('10명 모두 AI capability 허용',all(call('workhub_teacher_pilot_access',uid=e['authUserId'])['allowed'] for e in entries))
 H.check('기존 22명·9학급·288교시·수업 보존',original==I.preserve(list(original)))
 H.check('기존 실제 연결 보존',real_links==q('SELECT to_jsonb(t) FROM teacher_roster.links t WHERE member_id=%s',(admin,)))
 H.check('AI 대화 목록 RPC 통과', 'data' in call('workhub_ai_policy_threads_list',member,'school',None,uid=first))
 st=svc('workhub_ai_school_status',first,member);H.check('시험 교사는 학교 AI 상태만 읽고 관리 불가',st.get('status')=='ready' and st.get('canManage') is False)
 H.check('시험 교사 학교 키 저장 차단',svc('workhub_ai_school_key_save',first,member,'tp1-forbidden-key',1,envelope,'abcd').get('error',{}).get('code')=='FORBIDDEN')
 request='tp1-cost-stop';prompt=dict(mode='school',intent='school_advice',prompt='시험 질문',threadId=None,expectedVersion=0,references=[],studentContext=None)
 prep=svc('workhub_ai_gateway_prepare',first,'assistant',member,request,'a'*64,'quick',prompt,None)
 if 'error' in prep:raise AssertionError(prep)
 lease=prep['data']['leaseToken'];H.check('시험 교사 공통 AI 예약 성공',prep['data']['state']=='claimed')
 started=svc('workhub_ai_gateway_start',first,'assistant',member,request,lease,120,'b'*64)
 H.check('시험 교사 AI 단일 시작권',started.get('data',{}).get('started') is True)
 second=entries[1]['authUserId'];secondmember=q('SELECT member_id FROM teacher_pilot.members WHERE auth_user_id=%s',(second,))[0][0]
 H.check('시험 계정 사이 소속 사칭 차단',svc('workhub_ai_school_status',second,member).get('error',{}).get('code')=='INACTIVE_MEMBERSHIP')
 H.check('다른 시험 계정의 요청번호 복구는 원응답 비노출',svc('workhub_ai_gateway_recover',second,'assistant',secondmember,request,'a'*64).get('data',{}).get('state')=='missing')
 # 정상 답변도 실제 SQL 종료 경로로 기록하고 다른 시험 교사의 대화와 분리한다.
 prep2=svc('workhub_ai_gateway_prepare',second,'assistant',secondmember,'tp1-own-thread','d'*64,'quick',prompt,None)
 lease2=prep2['data']['leaseToken'];svc('workhub_ai_gateway_start',second,'assistant',secondmember,'tp1-own-thread',lease2,120,'e'*64)
 usage2=dict(inputTokens=120,outputTokens=30);reply2=dict(state='completed',usage=usage2,providerMessageId='msg_tp1_normal',segments=[dict(text='본인 대화',citations=[])],taskDraft=None)
 done2=svc('workhub_ai_gateway_finish',second,'assistant',secondmember,'tp1-own-thread',lease2,dict(state='completed',usage=usage2,providerMessageId='msg_tp1_normal',response=reply2))
 H.check('일반 시험 교사 정상 AI 답변 종료',done2.get('data',{}).get('state')=='completed')
 thread=q('SELECT id FROM workhub.assistant_threads WHERE owner_membership_id=%s',(secondmember,))[0][0]
 H.check('시험 교사 본인 대화 조회', 'data' in call('workhub_ai_policy_thread_get',secondmember,thread,None,uid=second))
 H.check('다른 시험 교사의 대화 비노출',call('workhub_ai_policy_thread_get',member,thread,None,uid=first).get('error',{}).get('code')=='NOT_FOUND')
 # 서비스 진입과 관리자 키 관리가 같은 actor를 쓰더라도 관리자 권한은 생기지 않는다.
 service="SELECT (workhub_private.p6_service_member(%s,%s)).membership_id"
 with H.connect(db=I.DB) as c:
  with c.cursor() as cur:
   cur.execute('SET ROLE service_role')
   # private 함수는 직접 실행 권한이 없다. public gateway 경로만 허용한다.
   try:cur.execute(service,(first,member));raise AssertionError('private direct')
   except Exception as e:H.check('service_role 내부함수 직접 접근 거절','permission denied' in str(e))
 # 만료는 DB clock 기준으로 즉시 차단된다. 합성 설정은 롤백한다.
 with H.connect(db=I.DB) as c:
  with c.cursor() as cur:
   cur.execute('BEGIN');cur.execute("UPDATE teacher_pilot.batches SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=%s",(batch,))
   cur.execute('SELECT teacher_pilot.allowed(%s,%s)',(school,member));H.check('만료 즉시 AI 차단',cur.fetchone()[0] is False)
   cur.execute('SET LOCAL ROLE service_role')
   u=dict(inputTokens=120,outputTokens=30);response=dict(state='completed',usage=u,providerMessageId='msg_tp1_expired',segments=[dict(text='만료 직전 결과',citations=[])],taskDraft=None)
   cur.execute('SELECT public.workhub_ai_gateway_finish(%s,%s,%s,%s,%s,%s)',(first,'assistant',member,request,lease,json.dumps(dict(state='completed',usage=u,providerMessageId='msg_tp1_expired',response=response))))
   finished=cur.fetchone()[0];H.check('만료 뒤 답변 본문 비노출',finished.get('data')==dict(state='failed',code='FORBIDDEN'))
   cur.execute('RESET ROLE');cur.execute('SELECT actual_micro_usd FROM workhub.ai_gateway_requests WHERE request_key=%s',(request,));H.check('만료 뒤 시작한 요청 비용 정산 유지',cur.fetchone()[0]>0);cur.execute('ROLLBACK')
 stop='SELECT teacher_pilot.stop(%s,%s,%s,%s,%s)';sargs=(school,admin,batch,2,'시험 종료')
 r=q(stop,sargs)[0][0];H.check('정지 결과는 삭제 아님',r['state']=='stopped' and not r['deletionAllowed'])
 H.check('정지 재호출은 원래 결과',q(stop,sargs)[0][0]==r)
 H.check('정지 후 전체10명 접근 차단',all(call('workhub_teacher_pilot_access',uid=e['authUserId'])['allowed'] is False for e in entries))
 usage=dict(inputTokens=120,outputTokens=30);response=dict(state='completed',usage=usage,providerMessageId='msg_tp1_stopped',segments=[dict(text='시험 결과',citations=[])],taskDraft=None)
 finished=svc('workhub_ai_gateway_finish',first,'assistant',member,request,lease,dict(state='completed',usage=usage,providerMessageId='msg_tp1_stopped',response=response))
 print('STOP_FINISH',json.dumps(finished,ensure_ascii=False),flush=True)
 cost=q('SELECT state,actual_micro_usd FROM workhub.ai_gateway_requests WHERE request_key=%s',(request,))[0]
 H.check('정지 뒤 이미 시작한 AI 비용은 정산하고 예약 해제',cost[1] is not None and cost[1]>0 and cost[0] not in ['prepared','started','unknown'])
 H.check('정지 뒤 답변 본문 비노출',finished.get('data')==dict(state='failed',code='FORBIDDEN'))
 H.check('시험 요청의 미정산 예약 합계 0',q("SELECT coalesce(sum(CASE WHEN actual_micro_usd IS NULL THEN workhub_private.p10_charge(r) ELSE 0 END),0) FROM workhub.ai_gateway_requests r WHERE actor_user_id=ANY(%s::uuid[])",([e['authUserId'] for e in entries],))[0][0]==0)
 H.check('정지 뒤 새로운 AI 요청 차단',svc('workhub_ai_gateway_prepare',first,'assistant',member,'tp1-after-stop','c'*64,'quick',prompt,None).get('error',{}).get('code')=='FORBIDDEN')
 H.check('미래 담당·담임 취소 후 이력 유지',q('SELECT count(*) FROM workhub.staff_assignments WHERE tp1_cancelled')[0][0]>=9 and q('SELECT count(*) FROM teacher_roster.links WHERE tp1_end_date=from_date')[0][0]==10)
 H.check('과금정책·실제 역할 불변',all(before[t]==I.digest(t) for t in before if t!='public.users'))
 manifest=q('SELECT teacher_pilot.cleanup_manifest(%s,%s,%s)',(school,admin,batch))[0][0]
 H.check('정리 명세는10명ID·자료목록 조회전용',len(manifest['accounts'])==10 and manifest['deletionAllowed'] is False)
 # 원래 관리자는 별개 명부에 연결돼 있어 다른 활성 소속으로 실제 연결을 검증한다.
 q("UPDATE public.users SET is_active=true WHERE id=%s",(H.TEACHER,))
 account=q("INSERT INTO workhub.accounts(auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,email,legacy_approval_state) SELECT id::uuid,id,'same_auth_user',now(),name,email,'approved' FROM public.users WHERE id=%s RETURNING id",(H.TEACHER,))[0][0]
 realmid=q("INSERT INTO workhub.memberships(school_id,account_id,status,employment_type,valid_from,decided_by_membership_id,decided_at,decision_note) VALUES(%s,%s,'active','teacher',%s,%s,now(),'합성 실제 교사') RETURNING id",(school,account,today,admin))[0][0]
 H.check('학교에 연결한 일반 교사는 AI 대상 확대 안 됨',svc('workhub_ai_school_status',H.TEACHER,realmid).get('error',{}).get('code')=='FORBIDDEN')
 rev=get()['revision'];commit(dict(kind='link',expectedRevision=rev,teacherId=entries[0]['teacherId'],memberId=realmid,**{'from':p['from'],'until':p['until']}),'tp1-relink-real')
 H.check('시험 조기 종료 후 같은 시작일의 실제 교사 연결',q('SELECT count(*) FROM teacher_roster.links WHERE teacher_id=%s',(entries[0]['teacherId'],))[0][0]==2)
 reject('시험 원장 삭제 금지','DELETE FROM teacher_pilot.ends WHERE batch_id=%s',(batch,))
 reject('실제 명부 연결은 종료열로 바꿀 수 없음','UPDATE teacher_roster.links SET tp1_end_date=from_date WHERE member_id=%s',(admin,))
 H.check('끝까지 기본표·실제 자료 보존',original==I.preserve(list(original)))
 post=q((HERE/'TP1-03_사후점검.sql').read_text(encoding='utf-8'));H.check('정지·실제연결 뒤 사후점검 11행 FAIL 0',len(post)==11 and all(r[2]!='FAIL' for r in post))
 print('TP1_REPORT',json.dumps(dict(passed=H.PASS,failed=0),ensure_ascii=False),flush=True)
H.tests=tests
if __name__=='__main__':H.main()
