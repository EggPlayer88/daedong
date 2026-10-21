"""P10 AI 격리 PG17 회귀. localhost 임시 DB만, 외부 호출·운영 DSN·실제 키를 사용하지 않는다."""
from pathlib import Path
import os, sys, subprocess, tempfile, json, hashlib, base64, uuid, concurrent.futures, datetime, re
ROOT=Path(os.environ.get('P10_AI_ROOT',str(Path(__file__).resolve().parents[4])))
STAGE=Path(os.environ.get('P10_AI_SQL',str(Path(__file__).resolve().parents[1])))
os.environ['P9_TEST_PORT']=os.environ.get('P10_AI_PORT','55549')
os.environ['P9_PG_BIN']=os.environ.get('P10_AI_PG_BIN',os.environ.get('P9_PG_BIN',''))
sys.path.insert(0,str(ROOT/'database/workhub-school-data/p9/test'))
import run_p9 as H
W=ROOT/'database/workhub'
Q=H.q
CAP=[]
def check(name,ok):
    if not ok and CAP: print('마지막 응답',json.dumps(CAP[-1]['raw'],ensure_ascii=False),flush=True)
    H.check(name,ok)
def sha(v): return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def key(): return 'p10-'+uuid.uuid4().hex
def svc(name,*args,actor=None,capture=True):
    with H.connect() as c:
        with c.cursor() as cur:
            cur.execute('set role service_role')
            try:
                cur.execute('select public.'+name+'('+','.join('%s::uuid[]' if isinstance(a,list) else '%s' for a in args)+')',tuple(json.dumps(a,ensure_ascii=False) if isinstance(a,dict) else a for a in args))
                value=cur.fetchone()[0]
            except H.psycopg2.Error as e:
                # 학교 설정의 예상 거절은 HTTP 400 SQL 예외가 아니라 실제 JSON 오류여야 한다.
                if name in ('workhub_ai_school_status','workhub_ai_school_key_save','workhub_ai_school_key_recover','workhub_ai_school_key_close'): raise
                value={'error':{'code':e.diag.message_primary}}
    if capture:
        CAP.append({'rpc':name,'args':list(args),'raw':value})
        Path(os.environ.get('P10_AI_CAPTURE',str(H.WORK/'captures.json'))).write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf-8')
    return value
def data(v): return v.get('data',{})
def code(v): return v.get('error',{}).get('code')
def inp(prompt='학교 업무 안내'):
    return dict(mode='school',intent='school_advice',prompt=prompt,threadId=None,expectedVersion=0,references=[],studentContext=None)
def row(k): return Q('select to_jsonb(r) from workhub.ai_gateway_requests r where request_key=%s',(k,))[0][0]
def human(name,member,*args): return H.rpc(name,tuple([member]+[json.dumps(a,ensure_ascii=False) if isinstance(a,dict) else a for a in args]))
def gateway(action,uid,member,k,*args,feature='evaluation'):
    return svc('workhub_ai_gateway_'+action,uid,feature,member,k,*args)
def prepare(uid,member=None,k=None,quality='quick',input=None,review=None,feature='evaluation',hash=None):
    k=k or key(); h=hash or sha(input if input else {'key':k,'quality':quality})
    return k,h,gateway('prepare',uid,member,k,h,quality,input,review,feature=feature)
def start(uid,member,k,p,feature='evaluation',n=120):
    return gateway('start',uid,member,k,data(p)['leaseToken'],n,sha({'provider':k}),feature=feature)
def finish(uid,member,k,p,feature='evaluation',usage=(120,30),response=None):
    u=dict(inputTokens=usage[0],outputTokens=usage[1]); mid='msg_'+uuid.uuid4().hex
    if feature=='assistant': response=response or dict(state='completed',usage=u,providerMessageId=mid,segments=[dict(text='합성 답변',citations=[])],taskDraft=None)
    else: response=response or dict(reply='합성 답변',stop_reason='end_turn',truncated=False,usage=dict(input_tokens=usage[0],output_tokens=usage[1]))
    v=dict(state='completed',response=response,usage=u,providerMessageId=mid)
    return gateway('finish',uid,member,k,data(p)['leaseToken'],v,feature=feature),v
def tests():
    school,member=Q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(H.ADMIN,))[0]
    before=Q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]
    gate=Q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]
    for p in sorted((W/'p6').glob('P6-0[12]_*.sql')): H.file(p)
    # 적용 전 시작한 P6 원장 하나를 마련한다. 새 원장 이관과 예전 원키 복구를 검증한다.
    Q("insert into workhub.assistant_policies(school_id,version,approved_by_membership_id,approval_ref,verification_ref,allowed_members,model,price_table_ref,input_price_micro_usd_per_mtok,output_price_micro_usd_per_mtok,max_input_tokens,max_output_tokens,reserve_micro_usd,member_daily_micro_usd,member_monthly_micro_usd,school_daily_micro_usd,school_monthly_micro_usd) values(%s,1,%s,'합성 이전 승인','합성','all_members','old-model','합성',100000,500000,80000,8000,12000,100000000,100000000,100000000,100000000)",(school,member))
    Q("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,'assistant','active',%s,'합성 이전 활성화')",(school,member))
    oldkey=key(); old=svc('workhub_ai_prepare',H.ADMIN,member,inp('이전 요청'),oldkey); oldlease=data(old)['leaseToken']
    svc('workhub_ai_start',H.ADMIN,member,oldkey,oldlease)
    for p in sorted(STAGE.glob('P10-0[123]_*.sql')):
        if '.body.' not in p.name: H.file(p)
    check('이전 원장을 공통 원장에 한 번만 이관',row(oldkey)['origin']=='legacy_p6')
    check('새 준비 직접 우회 차단', 'permission denied' in code(svc('workhub_ai_prepare',H.ADMIN,member,inp(),key())))
    oldresult=dict(state='completed',usage=dict(inputTokens=100,outputTokens=10),providerMessageId='msg_old',segments=[dict(text='이전 원답변',citations=[])],taskDraft=None)
    olddone=svc('workhub_ai_finish',H.ADMIN,member,oldkey,oldlease,oldresult)
    check('이전 시작 요청 원키로 마무리 및 공통 원장 정산',data(olddone).get('state')=='completed' and row(oldkey)['actual_micro_usd']==15)
    st=svc('workhub_ai_school_status',H.ADMIN,member)
    check('정책·키 기본 미등록',st.get('status')=='policy_missing' and st['credential']['configured']==False)
    reg=svc('workhub_ai_school_policy_register',H.ADMIN,member,'2026-10-21 합성 정책 승인')
    check('정책 등록은 키·활성화 만들지 않음',reg.get('status')=='key_missing' and Q('select enabled from workhub.ai_school_controls where school_id=%s',(school,))[0][0]==False)
    env=dict(keyId='test-master',iv=base64.b64encode(b'i'*12).decode(),ciphertext=base64.b64encode(b'c'*80).decode(),tag=base64.b64encode(b't'*16).decode())
    kk=key(); saved=svc('workhub_ai_school_key_save',H.ADMIN,member,kk,0,env,'abcd')
    check('암호문만 학교별 최초 키 저장',saved.get('credentialVersion')==1 and saved.get('state')=='applied')
    check('키 저장 동일키 원접수증',svc('workhub_ai_school_key_save',H.ADMIN,member,kk,0,env,'abcd')==saved)
    check('키 저장 복구 원접수증',svc('workhub_ai_school_key_recover',H.ADMIN,member,kk)==saved)
    check('키 저장 동일키 다른암호문 충돌',code(svc('workhub_ai_school_key_save',H.ADMIN,member,kk,0,{**env,'keyId':'other'},'abcd'))=='IDEMPOTENCY_CONFLICT')
    check('키 저장 기대판 불일치 차단',code(svc('workhub_ai_school_key_save',H.ADMIN,member,key(),0,env,'abcd'))=='CONFLICT')
    check('키 충돌은 암호문·접수증 추가 없음',Q('select count(*) from workhub.ai_credentials where school_id=%s',(school,))[0][0]==1 and Q('select count(*) from workhub.ai_admin_requests where school_id=%s',(school,))[0][0]==1)
    kc=key(); c=svc('workhub_ai_school_key_close',H.ADMIN,member,kc,1)
    check('미접수 키 저장 명시닫기',c.get('state')=='closed' and c.get('credentialVersion') is None)
    check('닫은 키 저장의 늦은 저장 차단',svc('workhub_ai_school_key_save',H.ADMIN,member,kc,1,env,'abcd')==c)
    check('키 닫기 원접수증 복구',svc('workhub_ai_school_key_recover',H.ADMIN,member,kc)==c)
    check('이미 저장한 키 닫기는 원접수증',svc('workhub_ai_school_key_close',H.ADMIN,member,kk,0)==saved)
    check('일반 평가계획 교사도 소속 추정 없음',code(prepare(H.TEACHER)[2])=='SCHOOL_NOT_LINKED')
    linked=svc('workhub_ai_school_link_legacy',H.ADMIN,member,[H.ADMIN,H.TEACHER],'명시 두 UID 승인')
    check('명시 승인 두 UID 연결',linked.get('linked')==2)
    check('연결·키 등록 뒤에도 기본 꺼짐',code(prepare(H.TEACHER)[2])=='DISABLED')
    Q('update workhub.ai_school_controls set enabled=true where school_id=%s',(school,))
    svc('workhub_ai_school_status',H.ADMIN,member)
    k,h,p=prepare(H.TEACHER)
    check('기존 일반교사 평가계획 허용·업무실 gate 보존',data(p).get('state')=='claimed' and data(p)['assistant'] is None)
    check('quick 모델·예약14,000·입력80k·출력8k 고정',data(p)['policy']==dict(version=1,model='claude-haiku-5-5',maxInputTokens=80000,maxOutputTokens=8000,reservedMicroUsd=14000))
    check('동일키 중복 준비는 새 호출권 없음',data(prepare(H.TEACHER,k=k,hash=h)[2]).get('state')=='pending')
    check('동일키 다른 입력 차단',code(prepare(H.TEACHER,k=k,hash='b'*64)[2])=='IDEMPOTENCY_CONFLICT')
    check('같은키 다른 모델 차단',code(prepare(H.TEACHER,k=k,quality='review',hash=h)[2])=='IDEMPOTENCY_CONFLICT')
    check('count 80k 초과 시작 차단',code(start(H.TEACHER,None,k,p,n=80001))=='INVALID_INPUT')
    with concurrent.futures.ThreadPoolExecutor(2) as ex: starts=list(ex.map(lambda _:start(H.TEACHER,None,k,p),range(2)))
    check('동시 시작 중 한 번만 호출권',sum(data(x).get('started') is True for x in starts)==1)
    done,raw=finish(H.TEACHER,None,k,p)
    check('실제 사용량 정산과 원응답 보관',data(done).get('state')=='completed' and row(k)['actual_micro_usd']==27)
    check('완료 끝 처리 멱등',gateway('finish',H.TEACHER,None,k,data(p)['leaseToken'],raw)==done)
    check('완료 복구 외부호출 없음',gateway('recover',H.TEACHER,None,k,h)==done)
    check('완료 같은키 prepare 원접수증',prepare(H.TEACHER,k=k,hash=h)[2]==done)
    check('다른 사용자에게 원답변 비노출',data(gateway('recover',H.ADMIN,None,k,h)).get('state')=='missing')
    ku,hu,pu=prepare(H.TEACHER);start(H.TEACHER,None,ku,pu)
    unknown=gateway('finish',H.TEACHER,None,ku,data(pu)['leaseToken'],dict(state='provider_unknown'))
    check('시작뒤 결과미상 원예약 보존',data(unknown).get('reason')=='provider_unknown' and row(ku)['actual_micro_usd'] is None)
    check('결과미상 취소로 0원 해제 불가',data(gateway('release',H.TEACHER,None,ku,None,'CANCELLED')).get('reason')=='provider_unknown')
    kc,hc,pc=prepare(H.TEACHER)
    closed=gateway('release',H.TEACHER,None,kc,data(pc)['leaseToken'],'COUNT_FAILED')
    check('count 실패 외부호출 전 0원 해제',data(closed)==dict(state='failed',code='COUNT_FAILED') and row(kc)['actual_micro_usd']==0)
    check('해제뒤 늦은 시작 차단',data(start(H.TEACHER,None,kc,pc)).get('started') is False)
    kl=key(); closed=gateway('release',H.TEACHER,None,kl,None,'CANCELLED')
    check('준비 도착전 명시닫기 원장',data(closed)==dict(state='closed'))
    check('닫기뒤 늦은 준비 차단',data(prepare(H.TEACHER,k=kl)[2])==dict(state='closed'))
    ka,ha,pa=prepare(H.ADMIN,member,input=inp(),feature='assistant')
    check('P6 대화·근거 준비와 공통 예약 원자 결합',data(pa).get('assistant',{}).get('state')=='claimed' and row(ka)['assistant_request_id'] is not None)
    check('비서 quick도 정확한 Haiku가격판',data(pa)['assistant']['policy']['model']=='claude-haiku-5-5')
    start(H.ADMIN,member,ka,pa,feature='assistant'); adone,araw=finish(H.ADMIN,member,ka,pa,feature='assistant')
    check('비서 P6 응답과 새 execution 메타',data(adone).get('state')=='completed' and data(adone)['response']['thread']['exchanges'][-1]['execution']['quality']=='quick')
    t=data(adone)['response']['thread']; x=t['exchanges'][-1]
    rv=inp();rv.update(threadId=t['id'],expectedVersion=t['version'])
    review=dict(requestKey=ka,exchangeId=x['id']);kr,hr,pr=prepare(H.ADMIN,member,input=rv,quality='review',review=review,feature='assistant')
    check('원답변 명시 정밀검토 Sonnet 예약280,000',data(pr).get('policy',{}).get('reservedMicroUsd')==280000 and data(pr)['execution']['reviewOf']==review)
    check('정밀검토에 원quick답변 본문 정확히포함',data(pr)['reviewSnapshot']==dict(requestKey=ka,exchangeId=x['id'],segments=x['segments']))
    start(H.ADMIN,member,kr,pr,feature='assistant');rdone,_=finish(H.ADMIN,member,kr,pr,feature='assistant')
    check('정밀검토도 P6와공통원장 같은 실제비용',data(rdone).get('state')=='completed' and row(kr)['actual_micro_usd']==540 and Q('select actual_micro_usd from workhub.assistant_requests where id=%s',(row(kr)['assistant_request_id'],))[0][0]==540)
    reread=H.rpc('workhub_ai_policy_thread_get',(member,t['id'],None))
    CAP.append(dict(rpc='workhub_ai_policy_thread_get',args=[member,t['id'],None],raw=reread))
    check('이전 대화 재조회에도 실행 모델메타 유지',reread['data']['exchanges'][-1]['execution']['quality']=='review')
    bad=inp();bad.update(threadId=t['id'],expectedVersion=2,prompt='다른 질문')
    check('원질문 바꾼 정밀검토 차단',code(prepare(H.ADMIN,member,input=bad,quality='review',review=review,feature='assistant')[2])=='CONFLICT')
    # 실제 P5 명부·관찰 계약으로 학생 식별 전송을 검증한다. 상담 내용을 읽는 경로는 없다.
    activation=(W/'p5/P5-04_수업모듈활성화_양식.sql').read_text(encoding='utf-8')
    activation=re.sub(r'\$json\$\n\{.*?\n\}\n\$json\$',lambda _: '$json$'+json.dumps(dict(approver_user_id=H.ADMIN,approval_ref='학생 AI 합성 시험',counseling_scope='off'),ensure_ascii=False)+'$json$',activation,flags=re.S)
    Q(activation)
    term,year,first,last=Q("select id,academic_year_id,starts_on::text,(ends_on-1)::text from workhub.terms where school_id=%s order by term_no desc limit 1",(school,))[0]
    Q("insert into workhub.year_subjects(id,school_id,academic_year_id,name,sort_order) values('p10-subject',%s,%s,'합성 국어',1)",(school,year))
    course=human('workhub_teaching_mutate',member,dict(kind='course_create',input=dict(label='AI 학생 시험',termId=term,subjectId='p10-subject',teacherMemberIds=[member],validFrom=first,validThrough=last)),key())['entityId']
    human('workhub_teaching_mutate',member,dict(kind='roster_import',courseId=course,expectedVersion=1,rows=[dict(schoolStudentKey='LOCAL-0001',name='합성학생',grade=1,classLabel='1',seatNumber=1)],validFrom=first,validThrough=last),key())
    cv=human('workhub_teaching_course',member,course); student=cv['students'][0]
    assignment=next(c['assignmentId'] for c in human('workhub_teaching_catalog',member)['courses'] if c['id']==course)
    human('workhub_teaching_mutate',member,dict(kind='observation_save',courseId=course,studentId=student['id'],courseMembershipId=student['courseMembershipId'],assignmentId=assignment,recordId=None,expectedVersion=0,input=dict(occurredOn=first,text='근거를 들어 의견을 설명함.',followUpOn='',reason='')),key())
    obs=human('workhub_teaching_student',member,course,student['id'],None)['observations'][0]
    evidence=dict(kind='observation',id=obs['id'],revisionId=obs['revisionId'],sourceHash=obs['contentHash'],epoch=obs['epoch'],start=0,end=len(obs['text']))
    si=inp('수업 기록 초안을 작성해 주세요');si.update(mode='personal',intent='student_record_draft',studentContext=dict(studentId=student['id'],courseId=course,evidence=[evidence]))
    ks,hs,ps=prepare(H.ADMIN,member,input=si,feature='assistant')
    check('현재 P5검사뒤 학교등록학생번호·이름만 조회',data(ps).get('studentIdentity')==dict(studentId=student['id'],schoolStudentKey='LOCAL-0001',name='합성학생'))
    check('학생초안 quick입력에도 실제 Sonnet예약',data(ps)['execution']['quality']=='review' and data(ps)['policy']['reservedMicroUsd']==280000)
    scbad=json.loads(json.dumps(si));scbad['studentContext']['evidence'][0]['kind']='counseling'
    check('상담 근거를 학생AI로 전송할 수 없음',code(prepare(H.ADMIN,member,input=scbad,feature='assistant')[2])=='INVALID_INPUT')
    gateway('release',H.ADMIN,member,ks,None,'CANCELLED',feature='assistant')
    # 만료·정책중지·예산 월 변경 후에도 시작 전 원키를 닫고 해제할 수 있다.
    ke,he,pe=prepare(H.TEACHER)
    Q("alter table workhub.ai_gateway_requests disable trigger ai_gateway_requests_guard; update workhub.ai_gateway_requests set lease_until=clock_timestamp()-interval '1 second' where request_key=%s; alter table workhub.ai_gateway_requests enable trigger ai_gateway_requests_guard",(ke,))
    check('만료 예약 늦은 시작 차단',data(start(H.TEACHER,None,ke,pe)).get('started') is False)
    check('만료 예약 원키 명시닫기 해제',data(gateway('release',H.TEACHER,None,ke,None,'CANCELLED')).get('state')=='closed' and row(ke)['actual_micro_usd']==0)
    km,hm,pm=prepare(H.TEACHER)
    Q("alter table workhub.ai_gateway_requests disable trigger ai_gateway_requests_guard; update workhub.ai_gateway_requests set budget_month=(budget_month-interval '1 month')::date where request_key=%s; alter table workhub.ai_gateway_requests enable trigger ai_gateway_requests_guard",(km,))
    check('예산월이 바뀐 예약 시작 차단',code(start(H.TEACHER,None,km,pm))=='CONFLICT')
    check('예산월 변경 원키닫기 해제',data(gateway('release',H.TEACHER,None,km,None,'CANCELLED')).get('state')=='closed')
    kd,hd,pd=prepare(H.TEACHER)
    svc('workhub_ai_school_control',H.ADMIN,member,False,'합성 중지')
    check('정책 중지뒤 새 시작 차단',code(start(H.TEACHER,None,kd,pd))=='DISABLED')
    check('정책 중지중 준비원키 해제 가능',data(gateway('release',H.TEACHER,None,kd,None,'CANCELLED')).get('state')=='closed')
    check('정책 중지중 기존 완료복구 가능',gateway('recover',H.TEACHER,None,k,h)==done)
    svc('workhub_ai_school_control',H.ADMIN,member,True,'합성 재개')
    klost,hlost,plost=prepare(H.TEACHER);start(H.TEACHER,None,klost,plost)
    Q('update workhub.ai_legacy_school_links set revoked_at=clock_timestamp() where auth_user_id=%s and revoked_at is null',(H.TEACHER,))
    lost,_=finish(H.TEACHER,None,klost,plost)
    check('학교 연결 회수뒤도 비용 기록·답변 비노출',data(lost)==dict(state='failed',code='FORBIDDEN') and row(klost)['actual_micro_usd']==27)
    check('학교 연결 회수 새 요청 거부',code(prepare(H.TEACHER)[2])=='SCHOOL_NOT_LINKED')
    svc('workhub_ai_school_link_legacy',H.ADMIN,member,[H.TEACHER],'합성 재연결')
    kauth,hauth,pauth=prepare(H.ADMIN,member,input=inp('현재소속 회수 시험'),feature='assistant')
    Q("update workhub.memberships set status='suspended' where id=%s",(member,))
    check('비서 prepare후 현재소속 회수 시작 차단',code(start(H.ADMIN,member,kauth,pauth,feature='assistant'))=='INACTIVE_MEMBERSHIP')
    check('학교설정 현재권한 거절 JSON 계약',svc('workhub_ai_school_status',H.ADMIN,member)=={'error':{'code':'INACTIVE_MEMBERSHIP'}} and svc('workhub_ai_school_key_recover',H.ADMIN,member,kk)=={'error':{'code':'INACTIVE_MEMBERSHIP'}} and svc('workhub_ai_school_key_close',H.ADMIN,member,key(),1)=={'error':{'code':'INACTIVE_MEMBERSHIP'}} and svc('workhub_ai_school_key_save',H.ADMIN,member,key(),1,env,'abcd')=={'error':{'code':'INACTIVE_MEMBERSHIP'}})
    Q("update workhub.memberships set status='active' where id=%s",(member,))
    gateway('release',H.ADMIN,member,kauth,None,'CANCELLED',feature='assistant')
    resolved=svc('workhub_ai_school_resolve',H.ADMIN,member,row(ku)['id'],0,0,'합성 공급자 미청구 확인')
    check('결과미상은 관리자 청구근거로만 정산',resolved.get('actualMicroUsd')==0 and row(ku)['state']=='resolved')
    kp,hp,pp=prepare(H.TEACHER)
    svc('workhub_ai_school_key_save',H.ADMIN,member,key(),1,env,'efgh')
    check('키 회전 전 예약은 이전키로 새 시작 금지',code(start(H.TEACHER,None,kp,pp))=='CONFLICT')
    gateway('release',H.TEACHER,None,kp,None,'CANCELLED')
    ko,ho,po=prepare(H.TEACHER);start(H.TEACHER,None,ko,po)
    over,_=finish(H.TEACHER,None,ko,po,usage=(100001,30))
    check('관측초과 실제값 보존·자동정산 없음',data(over).get('reason')=='provider_unknown' and row(ko)['actual_micro_usd'] is None and row(ko)['observed_usage']==dict(inputTokens=100001,outputTokens=30))
    check('관측초과 학교 추가 호출 정지',code(prepare(H.TEACHER)[2])=='OVER_RESERVATION')
    check('관측초과 수동정산도 추가승인 없이불가',code(svc('workhub_ai_school_resolve',H.ADMIN,member,row(ko)['id'],1,1,'합성'))=='CONFLICT')
    st=svc('workhub_ai_school_status',H.ADMIN,member)
    check('학교 status 초과관측은 disabled·예약유지',st['status']=='disabled' and st['budget']['reservedMicroUsd']>=14000)
    check('켜기 양식으로 초과관측 차단을 풀 수 없음',code(svc('workhub_ai_school_control',H.ADMIN,member,True,'합성 재개 시도'))=='OVER_RESERVATION')
    # 별도 합성 예산 경계. 과거 청구 합계 fixture로 20,000micro만 남긴 뒤 양 경로를 동시에 예약한다.
    Q('update workhub.ai_school_controls set overage_blocked=false where school_id=%s',(school,))
    total=Q('select workhub_private.p10_total(%s,(workhub_private.p6_window(%s))[2])',(school,school))[0][0]
    Q("""insert into workhub.ai_gateway_requests(school_id,actor_user_id,feature,member_id,request_key,payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,state,budget_day,budget_month,reserved_micro_usd,actual_micro_usd,input_tokens,output_tokens,started_at,finished_at,finish_sha256,receipt)
      select school_id,actor_user_id,feature,member_id,%s,payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,'completed',budget_day,budget_month,reserved_micro_usd,%s,0,0,started_at,finished_at,finish_sha256,receipt from workhub.ai_gateway_requests where request_key=%s""",(key(),100000000-total-20000,k))
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        futures=[ex.submit(prepare,H.TEACHER),ex.submit(prepare,H.ADMIN,member,input=inp('공통예산 경합'),feature='assistant')]
        race=[f.result() for f in futures]
    check('두AI경로 월예산 경합 중 하나만예약',sum(data(p).get('state')=='claimed' for _,_,p in race)==1 and sum(code(p)=='BUDGET_EXCEEDED' for _,_,p in race)==1)
    budgetstatus=svc('workhub_ai_school_status',H.ADMIN,member)
    check('잔액6000도 다음최소예약불가 상태',budgetstatus['budget']['availableMicroUsd']==6000 and budgetstatus['status']=='budget_exhausted')
    Q('update workhub.ai_school_controls set overage_blocked=true where school_id=%s',(school,))
    post=H.file(STAGE/'P10-04_사후점검.sql')
    check('P10 사후점검 FAIL 0',all(r[2] in('ok','info') for r in post))
    check('기존 회원 원본 보존',Q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]==before)
    check('legacy_gate 원문 보존',Q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]==gate)
    check('원장·키 표 API 직접권한 0',Q("select count(*) from information_schema.role_table_grants where grantee in('anon','authenticated','service_role') and table_schema='workhub' and table_name like 'ai_%'")[0][0]==0)
    out=Path(os.environ.get('P10_AI_CAPTURE',str(H.WORK/'captures.json')));out.write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf-8');print('CAPTURES',out,flush=True)
def main():
    exe='.exe' if os.name=='nt' else '';started=False
    version=subprocess.check_output([str(H.PG/('postgres'+exe)),'--version'],text=True)
    if ' 17.' not in version: raise RuntimeError('PG17만 허용')
    log=(H.WORK/'run.log').open('w',encoding='utf-8')
    try:
        H.run(H.PG/('initdb'+exe),'-D',H.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
        H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-l',H.WORK/'server.log','-o',f'-h 127.0.0.1 -p {H.PORT}','-w','start',stdout=log,stderr=log);started=True
        check('격리 임시 DB 경로 확인',Path(Q('show data_directory',user='supabase_admin',db='postgres')[0][0]).resolve()==H.DATA)
        H.setup();tests();print('PASS',H.PASS,'FAIL 0',flush=True)
    finally:
        if started:H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
        log.close();print('격리 파일',H.WORK,flush=True)
if __name__=='__main__':main()
