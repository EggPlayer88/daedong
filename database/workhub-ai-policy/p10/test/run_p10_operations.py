"""신규 조회와 36 가상 교사 경합. 기본 AI 및 줄바꿈 회귀를 포함하며 localhost 임시 PG17 외에는 실행하지 않는다."""
from pathlib import Path
import os,sys,subprocess,json,uuid,random,threading,concurrent.futures,hashlib,base64,time
ROOT=Path(os.environ.get('P10_AI_ROOT',str(Path(__file__).resolve().parents[4])))
SQL=Path(os.environ.get('P10_AI_OPERATIONS_SQL',str(Path(__file__).resolve().parents[1])))
os.environ.setdefault('P10_AI_PORT','55559')
sys.path.insert(0,str(ROOT/'database/workhub-ai-policy/p10/test'))
import run_p10_ai as B
H=B.H;Q=H.q;C=H.check
CAP=[];CALLS=0;MUTEX=threading.Lock();SEED=20261021
STATES=['prepared','started','completed','rejected','unknown','failed','closed','resolved']

def require(ok,message):
    if not ok: raise AssertionError(message)

def call(name,*args,capture=False):
    global CALLS
    with H.connect() as c:
        with c.cursor() as cur:
            cur.execute('set role service_role')
            legacy_array=name=='workhub_ai_school_link_legacy'
            cur.execute('select public.'+name+'('+','.join('%s::uuid[]' if isinstance(a,list) and legacy_array else '%s' for a in args)+')',tuple(json.dumps(a,ensure_ascii=False) if isinstance(a,dict) or isinstance(a,list) and not legacy_array else a for a in args))
            value=cur.fetchone()[0]
    with MUTEX:
        CALLS+=1
        if capture: CAP.append({'rpc':name,'args':list(args),'raw':value})
    return value

def gw(action,uid,key,*args,member=None,feature='evaluation'):
    return call('workhub_ai_gateway_'+action,uid,feature,member,key,*args)

def prepared(uid,key,quality='quick',member=None,feature='evaluation'):
    source=B.inp('가상 반복 자료') if feature=='assistant' else None
    return gw('prepare',uid,key,B.sha({'key':key,'feature':feature}),quality,source,None,member=member,feature=feature)

def started(uid,key,p,member=None,feature='evaluation'):
    return gw('start',uid,key,p['data']['leaseToken'],200,'a'*64,member=member,feature=feature)

def final_input(key,kind='completed'):
    usage={'inputTokens':200,'outputTokens':40}
    return {'state':kind,'usage':usage,'providerMessageId':'msg_'+key,**({'response':{'reply':'합성 원문 비노출 표식','stop_reason':'end_turn','truncated':False,'usage':{'input_tokens':200,'output_tokens':40}}} if kind=='completed' else {'code':'OUTPUT_INVALID'})}

def digest_rows():
    names=['ai_school_policies','ai_school_controls','ai_credentials','ai_legacy_school_links','ai_gateway_requests','ai_gateway_closed_keys','ai_admin_requests','assistant_requests','memberships','membership_roles','audit_events']
    return {n:Q('select md5(coalesce(string_agg(x::text,chr(10) order by x::text),\'\')) from (select to_jsonb(t) x from workhub.'+n+' t) z')[0][0] for n in names}

def functions():
    return dict(Q("select p.oid,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workhub_private') and p.prokind='f'"))

def school_fixture(code):
    school=Q("insert into workhub.schools(code,name,school_level,grade_count,status,support_state) values(%s,%s,'middle',3,'active','synthetic') returning id",(code,'가상 '+code))[0][0]
    account=Q('select id from workhub.accounts where auth_user_id=%s',(H.ADMIN,))[0][0]
    member=Q("insert into workhub.memberships(school_id,account_id,status,valid_from,decided_at,employment_type) values(%s,%s,'active',current_date-365,now(),'teacher') returning id",(school,account))[0][0]
    Q("insert into workhub.membership_roles(school_id,membership_id,role_code,valid_from) values(%s,%s,'school_admin',current_date-365)",(school,member))
    return school,member

def provision(school,member):
    call('workhub_ai_school_policy_register',H.ADMIN,member,'격리 합성 정책')
    env=dict(keyId='synthetic-only',iv=base64.b64encode(b'i'*12).decode(),ciphertext=base64.b64encode(b'never-a-real-key'*8).decode(),tag=base64.b64encode(b't'*16).decode())
    call('workhub_ai_school_key_save',H.ADMIN,member,B.key(),0,env,'test')
    call('workhub_ai_school_control',H.ADMIN,member,True,'격리 합성 켜기')
    Q("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,'assistant','active',%s,'격리 합성')",(school,member))

def teacher_fixture(index,school):
    uid=str(uuid.uuid5(uuid.NAMESPACE_URL,'p10-local-teacher-'+str(index)))
    # 격리 mock Auth에만 넣는 가상 자료이며 기존 gate 함수/권한은 고치지 않는다.
    Q('insert into auth.users(id,email,raw_user_meta_data) values(%s,%s,%s::jsonb)',(uid,f't{index}@fixture.invalid',json.dumps({'full_name':f'가상교사{index}'})),user='supabase_admin')
    Q('update public.users set is_active=true where id=%s',(uid,))
    acc=Q("insert into workhub.accounts(auth_user_id,display_name,status,legacy_approval_state) values(%s,%s,'active','approved') returning id",(uid,f'가상교사{index}'))[0][0]
    member=Q("insert into workhub.memberships(school_id,account_id,status,valid_from,decided_at,employment_type) values(%s,%s,'active',current_date-365,now(),'teacher') returning id",(school,acc))[0][0]
    return uid,member

def validate_view(v):
    require(set(v)=={'contract','schoolId','memberId','checkedAt','month','timeZone','asOf','totals','groups','unresolved','items','nextCursor'},'운영 최상위 허용필드')
    require(v['contract']=='assistant.operations.v1' and len(v['groups'])==6 and len(v['items'])<=25,'운영 범위/한도')
    aggkeys={'requests','settledMicroUsd','reservedMicroUsd','states'}
    for ag in [v['totals']]+v['groups']:
        require(set(ag)==(aggkeys if ag is v['totals'] else aggkeys|{'feature','quality'}),'집계 허용필드')
        require(set(ag['states'])==set(STATES) and sum(ag['states'].values())==ag['requests'],'상태 합계')
        require(all(ag[k]>=0 for k in aggkeys-{'states'}),'음수 비용/건수')
    require(all(sum(g[k] for g in v['groups'])==v['totals'][k] for k in aggkeys-{'states'}),'기능/품질 합계')
    allowed={'id','requestKey','feature','quality','state','createdAt','updatedAt','model','reservedMicroUsd','settledMicroUsd','usage','errorCode','observedOverage'}
    for item in v['items']:
        require(set(item)==allowed,'요청 메타 외 필드 비노출')
        require(item['reservedMicroUsd']==0 if item['settledMicroUsd'] is not None else item['reservedMicroUsd']>=0,'정산/예약 중복')
    raw=json.dumps(v)
    require(all(x not in raw for x in ['ciphertext','leaseToken','providerMessageId','actorUserId','합성 원문 비노출 표식','never-a-real-key']),'비밀/원문 비노출')

def operations(member,cursor=None):
    v=call('workhub_ai_school_operations',H.ADMIN,member,cursor,capture=True)
    if 'error' not in v:validate_view(v)
    return v

def one_case(uid,index,round_no):
    rng=random.Random(SEED+index*100+round_no); key=f'seed-{SEED}-{index:02d}-{round_no:02d}'; kind=(index+round_no)%6
    quality=rng.choice(['quick','quick','review']);p=None
    if kind==2:
        closed=gw('release',uid,key,None,'CANCELLED')
        require(closed.get('data',{}).get('state')=='closed','선행 close')
        require(prepared(uid,key,quality)==closed and gw('release',uid,key,None,'CANCELLED')==closed,'늦은 prepare 장벽')
        return kind
    p=prepared(uid,key,quality); require(p.get('data',{}).get('state')=='claimed','반복 prepare')
    lease=p['data']['leaseToken']
    if kind==0:
        with concurrent.futures.ThreadPoolExecutor(3) as ex: wins=list(ex.map(lambda _:started(uid,key,p),range(3)))
        require(sum(x.get('data',{}).get('started') is True for x in wins)==1,'start 한 번')
        inp=final_input(key);done=gw('finish',uid,key,lease,inp)
        require(done.get('data',{}).get('state')=='completed','완료')
        require(gw('finish',uid,key,lease,inp)==done and gw('recover',uid,key,B.sha({'key':key,'feature':'evaluation'}))==done,'완료 원접수증')
    elif kind==1:
        require(prepared(uid,key,quality).get('data',{}).get('state')=='pending','같은키 중복 준비')
        require(gw('release',uid,key,lease,'COUNT_FAILED').get('data')=={'state':'failed','code':'COUNT_FAILED'},'count 실패 해제')
        require(started(uid,key,p).get('data',{}).get('started') is False,'해제 후 늦은 시작')
    elif kind==3:
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            fs=ex.submit(started,uid,key,p);fc=ex.submit(gw,'release',uid,key,None,'CANCELLED');s,c=fs.result(),fc.result()
        if s.get('data',{}).get('started'):
            require(c.get('data',{}).get('state')=='pending','start 승리시 close 해제불가')
            require(gw('finish',uid,key,lease,final_input(key)).get('data',{}).get('state')=='completed','경합후 완료')
        else:require(c.get('data',{}).get('state')=='closed','close 승리시 시작불가')
    elif kind==4:
        require(started(uid,key,p).get('data',{}).get('started') is True,'unknown 시작')
        unknown=gw('finish',uid,key,lease,{'state':'provider_unknown'})
        require(unknown.get('data',{}).get('reason')=='provider_unknown','unknown 보존')
        require(gw('release',uid,key,None,'CANCELLED')==unknown,'unknown 취소 해제불가')
    else:
        bad=gw('prepare',uid,key,'b'*64,quality,None,None)
        require(bad.get('error',{}).get('code')=='IDEMPOTENCY_CONFLICT','동일키 변경 입력 거절')
        require(started(uid,key,p).get('data',{}).get('started') is True,'거절 출력 시작')
        failed=gw('finish',uid,key,lease,final_input(key,'rejected'))
        require(failed.get('data',{}).get('state')=='failed','거절 출력 비용 보존')
    return kind

def tests():
    before_defs=functions();before_rows=digest_rows()
    for name in ('P10-09_운영현황_조회.sql','P10-10_서버진단_조회.sql'):H.file(SQL/name)
    after_defs=functions()
    C('추가조회 설치는 기존 함수·ACL·소유자 지문 보존',all(after_defs.get(k)==v for k,v in before_defs.items()))
    C('추가조회 설치는 기존 설정·회원·원장·감사 데이터 보존',digest_rows()==before_rows)
    sa,ma=school_fixture('ai-stress-a');sb,mb=school_fixture('ai-stress-b')
    empty=operations(ma);C('정책 미등록 빈 학교 운영현황 6그룹·0건',empty['totals']['requests']==0 and empty['items']==[])
    d=call('workhub_ai_school_diagnostics',H.ADMIN,ma,capture=True)
    C('정책/키 미등록 진단은 false/null',d['policyVersion']==0 and d['credential'] is None and not d['enabled'])
    provision(sa,ma);provision(sb,mb)
    teachers=[teacher_fixture(i,sa) for i in range(36)]
    outsiders=[teacher_fixture(100+i,sb) for i in range(2)]
    call('workhub_ai_school_link_legacy',H.ADMIN,ma,[u for u,m in teachers],'격리 가상 36명 명시 연결')
    call('workhub_ai_school_link_legacy',H.ADMIN,mb,[u for u,m in outsiders],'격리 다른 학교 명시 연결')
    C('36명은 실제 teacher 역할 유지',Q('select count(*) from public.users where id=ANY(%s) and role=\'teacher\'',([u for u,m in teachers],))[0][0]==36)
    denies=[prepared(u,'assistant-denied-'+str(i),member=m,feature='assistant') for i,(u,m) in enumerate(teachers)]
    C('36명 일반교사 기존 업무실 gate 거절을 유지',all(v.get('error',{}).get('code')=='FORBIDDEN' for v in denies))
    C('일반교사 관리자 운영·진단 거절',call('workhub_ai_school_operations',teachers[0][0],teachers[0][1],None)=={'error':{'code':'FORBIDDEN'}} and call('workhub_ai_school_diagnostics',teachers[0][0],teachers[0][1])=={'error':{'code':'FORBIDDEN'}})
    scenario_counts={i:0 for i in range(6)}
    for round_no in range(6):
        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            kinds=list(ex.map(lambda pair:one_case(pair[1][0],pair[0],round_no),enumerate(teachers)))
        for kind in kinds:scenario_counts[kind]+=1
        C(f'seed {SEED} 가상교사36명 반복 {round_no+1}/6',len(kinds)==36)
    C('각 원키·경합·미상 흐름 36번씩 총216시나리오',all(n==36 for n in scenario_counts.values()))
    other_key='isolated-other-school';op=prepared(outsiders[0][0],other_key)
    C('다른 학교도 별도 예약 가능',op.get('data',{}).get('state')=='claimed')
    oldschool,oldmember=Q('select school_id,id from workhub.memberships where id not in(%s,%s) and account_id=(select id from workhub.accounts where auth_user_id=%s) order by created_at limit 1',(ma,mb,H.ADMIN))[0]
    old=operations(oldmember);C('이전 P6 legacy 품질 집계 포함',sum(g['requests'] for g in old['groups'] if g['quality']=='legacy')>=1)
    C('초과관측은 원문 없이 여부·미상건수만 반환',old['unresolved']['observedOverageRequests']==1 and any(i['observedOverage'] for i in old['items']))
    full=operations(ma);C('36명 반복 현황 합계·학교격리',full['totals']['requests']==180 and all(i['requestKey']!=other_key for i in full['items']))
    expected=Q('select count(*),coalesce(sum(actual_micro_usd),0),coalesce(sum(case when actual_micro_usd is null then workhub_private.p10_charge(g) else 0 end),0) from workhub.ai_gateway_requests g where school_id=%s and budget_month=%s::date and created_at<=%s::timestamptz',(sa,full['month']+'-01',full['asOf']))[0]
    C('실제 원장 비용과 운영 집계 일치',tuple(full['totals'][k] for k in ('requests','settledMicroUsd','reservedMicroUsd'))==expected)
    # 페이지 시작 뒤 생성된 요청은 새로고침 전 포함하지 않는다. 원시 마이크로초 순서를 SQL anchor로 보존한다.
    target_ids=[r[0] for r in Q('select id from workhub.ai_gateway_requests where school_id=%s and budget_month=%s::date and created_at<=%s::timestamptz order by created_at desc,id desc',(sa,full['month']+'-01',full['asOf']))]
    fresh='created-after-first-page';prepared(teachers[0][0],fresh)
    seen=[i['id'] for i in full['items']];page=full
    while page['nextCursor']:
        page=operations(ma,page['nextCursor']);seen.extend(i['id'] for i in page['items'])
    C('고정 상한 keyset 모든 페이지 중복·누락 없음',seen==target_ids and len(seen)==len(set(seen)))
    C('새로고침에만 새 요청 포함',operations(ma)['totals']['requests']==181)
    # 준비 원장이 아직 미커밋이면 조회 상한이 먼저 확정되지 않아야 한다.
    pending=H.connect();pending.autocommit=False
    with pending.cursor() as cur:
        cur.execute('set role service_role')
        cur.execute('select public.workhub_ai_gateway_prepare(%s,\'evaluation\',null,%s,%s,\'quick\',null,null)',(teachers[0][0],'read-barrier-pending','c'*64))
        require(cur.fetchone()[0].get('data',{}).get('state')=='claimed','장벽 시험 예약')
    ready=threading.Event();reader_pid=[]
    def read_waiting():
        with H.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('set role service_role');reader_pid.append(conn.get_backend_pid());ready.set()
                cur.execute('select public.workhub_ai_school_operations(%s,%s,null)',(H.ADMIN,ma));return cur.fetchone()[0]
    with concurrent.futures.ThreadPoolExecutor(1) as ex:
        future=ex.submit(read_waiting);ready.wait(3);blocked=False
        for _ in range(100):
            status=Q('select wait_event_type from pg_stat_activity where pid=%s',(reader_pid[0],))
            if status and status[0][0]=='Lock':blocked=True;break
            time.sleep(.01)
        pending.commit();pending.close();snapshot=future.result(timeout=10)
    C('선행 미커밋 예약 뒤 조회 상한 확정',blocked and any(i['requestKey']=='read-barrier-pending' for i in snapshot['items']))
    for bad in ({},[],{'month':'2026-13','asOf':full['asOf'],'afterId':seen[0]},dict(full['nextCursor'],afterId='not-a-row'),dict(full['nextCursor'],asOf='2999-01-01T00:00:00.000Z'),dict(full['nextCursor'],month='2000-01')):
        C('깨진 cursor 확정거절',operations(ma,bad)=={'error':{'code':'INVALID_INPUT'}})
    C('다른 학교 cursor는 비노출 거절',operations(mb,full['nextCursor'])=={'error':{'code':'INVALID_INPUT'}})
    # 지난달 미정산 합성 행은 새 INSERT로 준비한다. 기존 불변 트리거를 끄지 않는다.
    old_ids=[]
    for offset in range(3):
        old_ids.append(Q("""insert into workhub.ai_gateway_requests(school_id,actor_user_id,feature,member_id,request_key,payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,state,budget_day,budget_month,reserved_micro_usd,created_at,updated_at)
          select school_id,actor_user_id,feature,member_id,%s,payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,'prepared',(budget_month-interval '1 month')::date,(budget_month-interval '1 month')::date,reserved_micro_usd,((budget_month-interval '1 month')::date+10)::timestamp at time zone 'Asia/Seoul',((budget_month-interval '1 month')::date+10)::timestamp at time zone 'Asia/Seoul'
          from workhub.ai_gateway_requests where school_id=%s and request_key=%s returning id""",(f'previous-month-{offset}',sa,fresh))[0][0])
    v=operations(ma);C('이전월 미정산을 현재월 밖에서도 집계',v['unresolved']['previousMonthRequests']==3 and v['unresolved']['previousMonthReservedMicroUsd']==42000)
    mon,asof=Q("select to_char(budget_month,'YYYY-MM'),workhub_private.p2_ts(created_at+interval '1 day') from workhub.ai_gateway_requests where id=%s",(old_ids[0],))[0]
    old_ids.sort(reverse=True);prev=operations(ma,{'month':mon,'asOf':asof,'afterId':old_ids[0]})
    C('월경계 이후에도 cursor의 지난달 유지·동일시각 ID순서',prev['month']==mon and [i['id'] for i in prev['items']]==old_ids[1:])
    call('workhub_ai_school_control',H.ADMIN,ma,False,'격리 조회중 중지')
    v=operations(ma);diag=call('workhub_ai_school_diagnostics',H.ADMIN,ma,capture=True)
    C('정책 중지에도 관리자 운영·진단 가능',v['contract']=='assistant.operations.v1' and not diag['enabled'] and diag['credential']['version']==1)
    before=digest_rows()
    for _ in range(4):operations(ma);call('workhub_ai_school_diagnostics',H.ADMIN,ma)
    C('반복 조회는 원장·설정·감사 로그 무변경',before==digest_rows())
    Q("update workhub.membership_roles set revoked_at=clock_timestamp(),revoke_reason='합성 회수' where membership_id=%s",(ma,))
    C('관리역할 현재 회수뒤 두 조회 거절',operations(ma)=={'error':{'code':'FORBIDDEN'}} and call('workhub_ai_school_diagnostics',H.ADMIN,ma)=={'error':{'code':'FORBIDDEN'}})
    Q('update workhub.membership_roles set revoked_at=null,revoke_reason=null where membership_id=%s',(ma,))
    Q("update workhub.memberships set status='suspended' where id=%s",(ma,))
    C('현재 소속 중지뒤 두 조회 거절',operations(ma)=={'error':{'code':'INACTIVE_MEMBERSHIP'}} and call('workhub_ai_school_diagnostics',H.ADMIN,ma)=={'error':{'code':'INACTIVE_MEMBERSHIP'}})
    Q("update workhub.memberships set status='active' where id=%s",(ma,))
    for rpc,args in [('workhub_ai_school_operations',(H.ADMIN,ma,None)),('workhub_ai_school_diagnostics',(H.ADMIN,ma))]:
        try:H.rpc(rpc,args)
        except H.psycopg2.Error as ex:C('브라우저 직접 RPC 권한 없음',ex.pgcode=='42501')
        else:C('브라우저 직접 RPC 권한 없음',False)
    with H.connect() as c:
        with c.cursor() as cur:
            cur.execute('set role service_role');cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(H.ADMIN,))
            cur.execute('select public.workhub_ai_school_operations(%s,%s,null)',(H.ADMIN,ma));r=cur.fetchone()[0]
    C('service_role에도 사람 JWT 혼합 거절',r=={'error':{'code':'FORBIDDEN'}})
    # 학교 A의 남은 예산만 합성 청구로 줄인다. 승인 상한은 바꾸지 않고 동시 요청 수를 검증한다.
    call('workhub_ai_school_control',H.ADMIN,ma,True,'격리 재개')
    total=Q('select workhub_private.p10_total(%s,(workhub_private.p6_window(%s))[2])',(sa,sa))[0][0]
    source=Q("select id from workhub.ai_gateway_requests where school_id=%s and state='completed' limit 1",(sa,))[0][0]
    Q("""insert into workhub.ai_gateway_requests(school_id,actor_user_id,feature,member_id,request_key,payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,state,budget_day,budget_month,reserved_micro_usd,actual_micro_usd,input_tokens,output_tokens,started_at,finished_at,finish_sha256,receipt)
      select school_id,actor_user_id,feature,member_id,'budget-fixture',payload_sha256,requested_quality,quality,policy_version,assistant_policy_version,credential_version,lease_token,lease_until,state,budget_day,budget_month,reserved_micro_usd,%s,input_tokens,output_tokens,started_at,finished_at,finish_sha256,receipt from workhub.ai_gateway_requests where id=%s""",(100000000-total-28000,source))
    with concurrent.futures.ThreadPoolExecutor(12) as ex:race=list(ex.map(lambda pair:prepared(pair[1][0],'budget-race-'+str(pair[0])),enumerate(teachers)))
    C('36명 동시 월예산 마지막 두 예약만 허용',sum(r.get('data',{}).get('state')=='claimed' for r in race)==2 and sum(r.get('error',{}).get('code')=='BUDGET_EXCEEDED' for r in race)==34)
    C('학교 A 예산 소진해도 B 예산 독립',prepared(outsiders[1][0],'school-b-independent').get('data',{}).get('state')=='claimed')
    C('월예산 상한 숫자는 양 학교 그대로',Q('select bool_and(monthly_limit_micro_usd=100000000) from workhub.ai_school_policies where school_id in(%s,%s)',(sa,sb))[0][0])
    C('최종 새 사후점검 FAIL 0',all(r[2]=='ok' for r in H.file(SQL/'P10-11_운영조회_사후점검.sql')))
    C('기존 사후점검 FAIL 0',all(r[2] in('ok','info') for r in H.file(B.STAGE/'P10-04_사후점검.sql')))
    C('시험중 기존 함수·권한 지문 보존',all(functions().get(k)==v for k,v in before_defs.items()))
    out=Path(os.environ.get('P10_AI_OPERATIONS_CAPTURE',str(H.WORK/'operations-captures.json')));out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'seed':SEED,'teachers':36,'otherSchoolTeachers':2,'scenarios':216,'gatewayAndReadCalls':CALLS,'scenarioCounts':scenario_counts,'captures':str(out),'pass':H.PASS,'paidCalls':0}
    return report

def main():
    exe='.exe' if os.name=='nt' else '';started_db=False
    require(' 17.' in subprocess.check_output([str(H.PG/('postgres'+exe)),'--version'],text=True),'PG17만 허용')
    frozen={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'database/workhub-ai-policy/p10').glob('P10-0[1-8]_*.sql')}
    log=(H.WORK/'run.log').open('w',encoding='utf-8')
    try:
        H.run(H.PG/('initdb'+exe),'-D',H.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
        H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-l',H.WORK/'server.log','-o',f'-h 127.0.0.1 -p {H.PORT}','-w','start',stdout=log,stderr=log);started_db=True
        C('격리 임시 DB 경로 확인',Path(Q('show data_directory',user='supabase_admin',db='postgres')[0][0]).resolve()==H.DATA)
        H.setup();B.tests();report=tests()
        C('기존 P10-01~08 파일 SHA 보존',frozen=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'database/workhub-ai-policy/p10').glob('P10-0[1-8]_*.sql')})
        report['pass']=H.PASS
        (Path(report['captures']).parent/'operations-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print('OPERATIONS_REPORT',json.dumps(report,ensure_ascii=False),flush=True)
        print('PASS',H.PASS,'FAIL 0',flush=True)
    finally:
        if started_db:H.run(H.PG/('pg_ctl'+exe),'-D',H.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
        log.close();print('격리 파일',H.WORK,flush=True)
if __name__=='__main__':main()
