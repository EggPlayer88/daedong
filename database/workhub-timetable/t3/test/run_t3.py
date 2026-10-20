"""T3 격리 PostgreSQL 17 회귀. 운영 DSN을 받지 않으며 localhost 새 클러스터만 사용한다."""
from pathlib import Path
import os,sys,json,subprocess,time,datetime,concurrent.futures
ROOT=Path(__file__).resolve().parents[4]
os.environ['P9_TEST_PORT']=os.environ.get('T3_TEST_PORT','55529')
sys.path.insert(0,str(ROOT/'database/workhub-school-data/p9/test'))
import run_p9 as base
os.environ['R0_PGHOST']='127.0.0.1';os.environ['R0_PG_PORT']=str(base.PORT);os.environ['R1_DIR']=str(ROOT/'database/workhub/r1')
sys.path.insert(0,str(ROOT/'database/workhub-timetable/t2/test'))
import run_t2 as old
q=base.q;file=base.file;check=base.check
CAPTURES=[]
def data(raw):
 assert isinstance(raw,dict) and 'data' in raw,raw
 return raw['data']
def main():
 exe='.exe' if os.name=='nt' else ''
 assert ' 17.' in subprocess.check_output([str(base.PG/('postgres'+exe)),'--version'],text=True)
 log=(base.WORK/'run.log').open('w',encoding='utf8');started=False
 try:
  base.run(base.PG/('initdb'+exe),'-D',base.DATA,'-U','supabase_admin','--encoding=UTF8','--no-locale','-A','trust',stdout=log,stderr=log)
  base.run(base.PG/('pg_ctl'+exe),'-D',base.DATA,'-l',base.WORK/'server.log','-o',f'-h 127.0.0.1 -p {base.PORT}','-w','start',stdout=log,stderr=log);started=True
  base.setup();old.body()
  check('선행 T2 실제 회귀 모두 통과',all(ok for _,ok in old.results))
  for path in ['database/workhub-school-data/p9/P9-01_교사연결_모델과함수.sql','database/workhub-school-data/p9/P9-02_담당교사후보_분리.sql','database/workhub-school-data/p10/P10-01_정정_모델과함수.sql','database/workhub-school-data/p10/P10-02_기존쓰기와시간표_보호.sql']:file(ROOT/path)
  check('P9 P10 결합 설치',True)
  for name in ['T3-01_운영확장_모델.sql','T3-02_운영확장_공개함수.sql','T3-03_기존운영_보존훅.sql']:
   file(ROOT/'database/workhub-timetable/t3'/name);check('설치 '+name,True)
  tests()
  rows=file(ROOT/'database/workhub-timetable/t3/T3-04_사후점검.sql');check('T3 자체 사후점검',all(r[2]=='ok' for r in rows))
  try:file(ROOT/'database/workhub-timetable/t3/T3-05_시범승인_양식.sql')
  except Exception as ex:check('빈 승인 양식은 비활성 유지', '직접 채우고' in str(ex))
  else:check('빈 승인 양식은 비활성 유지',False)
  print(f'T3 PASS {base.PASS} · FAIL 0',flush=True)
 finally:
  target=Path(os.environ.get('T3_CAPTURE',str(base.WORK/'captures.json')));target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(CAPTURES,ensure_ascii=False,indent=2),encoding='utf8')
  print('CAPTURES',target,flush=True)
  if started:base.run(base.PG/('pg_ctl'+exe),'-D',base.DATA,'-m','fast','-w','stop',stdout=log,stderr=log)
  log.close();print('격리 시험 파일',base.WORK,flush=True)
def tests():
 school,adm=q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(base.ADMIN,))[0]
 auth_before=q('select count(*) from auth.users')[0][0];legacy_before=q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]
 def rpc(op,args=(),member=adm,uid=base.ADMIN,capture=True,**meta):
  r=base.rpc('workhub_timetable_interventions_'+op,(member,*[json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for v in args]),uid)
  if capture and 'data' in r: CAPTURES.append({'kind':op,'raw':r,'memberId':member,'schoolId':school,'now':int(time.time()*1000),**meta})
  return r
 def ec(r):return r.get('error',{}).get('code')
 def concurrent_revocation(sql,args,cmd,key,member,uid,expected):
  transaction=base.connect();transaction.autocommit=False
  with transaction.cursor() as cur:cur.execute(sql,args)
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(base.rpc,'workhub_timetable_operations_execute',(member,json.dumps(cmd),key,False),uid)
   time.sleep(0.15);waiting=not future.done();transaction.commit();result=future.result()
  transaction.close();check('T2 시범 회수 잠금 직렬화 '+key,waiting and ec(result)==expected)

 check('설치만으로 비활성',data(rpc('readiness'))=={'available':False,'reason':'not_configured'})
 check('직접 표 접근 권한 없음',q("select count(*) from information_schema.role_table_grants where grantee in('authenticated','anon','service_role') and table_schema='workhub' and table_name like 'timetable_intervention%'")[0][0]==0)
 check('공개 RPC 7개 authenticated 전용',q("select count(*),bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace and proname like 'workhub_timetable_interventions_%'")[0]==(7,True))
 allowed=[adm,'m-21','m-22','m-23','m-24','m-25']
 q("insert into workhub.timetable_intervention_policies(school_id,active,allowed_member_ids,approved_by_membership_id,approval_ref) values(%s,true,%s,%s,'격리 합성 시험 승인')",(school,allowed,adm))
 check('실제 승인자 2계정 준비',data(rpc('readiness'))=={'available':True,'reason':None})
 q("update workhub.timetable_intervention_policies set allowed_member_ids=array_remove(allowed_member_ids,'m-24')")
 check('승인자 1계정은 비활성',data(rpc('readiness'))['reason']=='approvers_missing')
 q('update workhub.timetable_intervention_policies set allowed_member_ids=%s',(allowed,))
 anchor=old.TODAY+datetime.timedelta(days=42);anchor-=datetime.timedelta(days=anchor.weekday())
 f=anchor.isoformat();u=(anchor+datetime.timedelta(days=28)).isoformat()
 template=q("select to_jsonb(l) from workhub.timetable_lessons l where l.school_id=%s and l.teacher_ids=array['m-21'] and l.state='scheduled' order by l.starts_at desc limit 1",(school,))[0][0]
 publication=q('select to_jsonb(p) from workhub.timetable_publications p where id=%s',(template['publication_id'],))[0][0]
 publication.update(id='t3-fixture-publication',preview_id='t3-fixture-publication-preview',from_date=f,until_date=u,request_key='t3-fixture-publication-key',excluded_days=[])
 q('insert into workhub.timetable_publications select (jsonb_populate_record(null::workhub.timetable_publications,%s::jsonb)).*',(json.dumps(publication),));template['publication_id']=publication['id']
 def fixture(name,offset=0,minute=540,teachers=None):
  x=dict(template);day=anchor+datetime.timedelta(days=offset);t=datetime.datetime.combine(day,datetime.time(),datetime.timezone(datetime.timedelta(hours=9)))+datetime.timedelta(minutes=minute)
  x.update(id='t3-fixture-'+name,activity_id='t3-activity-'+name,occurrence_date=day.isoformat(),starts_at=t.isoformat(),ends_at=(t+datetime.timedelta(minutes=45)).isoformat(),version=1,state='scheduled',pinned=False,changed_by='publish')
  if teachers:
   x['teacher_ids']=teachers;x['uses']=[r for r in x['uses'] if r['kind']!='teacher']+[{'id':a,'kind':'teacher','capacity':1} for a in teachers]
  q('insert into workhub.timetable_lessons select (jsonb_populate_record(null::workhub.timetable_lessons,%s::jsonb)).*',(json.dumps(x),))
  return x['id']
 lid=fixture('substitute');cancelid=fixture('cancel',1);closeid=fixture('close',2);reopenid=fixture('reopen',3);raceid=fixture('race',4);denyid=fixture('denied',7);collisionid=fixture('collision',8)
 def view(member=adm,uid=base.ADMIN):return data(rpc('get',(f,u),member,uid,range={'from':f,'until':u}))
 def preview(inp,member=adm,uid=base.ADMIN):
  src=view(member,uid);return rpc('preview',(inp,),member,uid,input=inp,source=src)
 def command(p):return {'kind':'submit','preview':{k:p[k] for k in ('previewId','previewHash','expiresAt','input')}}
 def execute(c,k,member=adm,uid=base.ADMIN,recover=False):return rpc('execute',(c,k,recover),member,uid,command=c,key=k,recover=recover)
 def close(c,k,member=adm,uid=base.ADMIN):return rpc('close',(c,k),member,uid,command=c,key=k)
 def req(rid):return q('select version,proposal_hash,state from workhub.timetable_interventions where id=%s',(rid,))[0]
 def action(rid,a,member=adm,uid=base.ADMIN,key=None):
  v,h,s=req(rid);c={'kind':'action','requestId':rid,'expectedVersion':v,'proposalHash':h,'action':a};return execute(c,key or old.key(),member,uid)
 def submit(inp,member=adm,uid=base.ADMIN):
  p=data(preview(inp,member,uid));check('미리보기 무차단 '+inp['kind'],not p['blockers']);c=command(p);r=execute(c,old.key(),member,uid);return data(r)['entityId'],p,c,r
 def approve(rid,participants=('m-21',)):
  for mid in participants:
   state=req(rid)[2]
   if state=='awaiting_consent':data(action(rid,'accept',mid,old.T[int(mid[2:])]))
  return action(rid,'approve','m-24',old.T[24])
 v=view();check('조회 범위 계약',any(l['id']==lid for l in v['lessons']) and v['from']==f)
 for bad in ({},None,{'kind':'cancel','lessonId':lid,'expectedVersion':1,'reason':'','extra':1}):check('깨진 입력 차단',ec(rpc('preview',(bad,),capture=False))=='INVALID_INPUT')
 inp={'kind':'substitute','lessonId':lid,'expectedVersion':1,'substituteTeacherId':'m-22','reason':'대강 시험'}
 rid,p,c,submitted=submit(inp,'m-21',old.T[21]);check('원교사와 대강 교사 동의 대상',sorted(t['id'] for t in p['participants'])==['m-21','m-22'])
 check('동의 전 최종 승인 불가',ec(action(rid,'approve','m-24',old.T[24]))=='FORBIDDEN')
 check('본인 수업도 진행 요청 보호',ec(preview({'kind':'cancel','lessonId':lid,'expectedVersion':1,'reason':'중복 휴강'})) is None)
 check('현재 자원 원장은 승인 전 유지',q('select teacher_ids from workhub.timetable_lessons where id=%s',(lid,))[0][0]==['m-21'])
 try:q('update workhub.timetable_lessons set version=version+1 where id=%s',(lid,))
 except Exception as ex:check('T2 쓰기 공통 수업 장벽', 'CONFLICT' in str(ex))
 else:check('T2 쓰기 공통 수업 장벽',False)
 data(action(rid,'accept','m-22',old.T[22]));check('영향 교사 계정 최종 승인 차단',ec(action(rid,'approve','m-22',old.T[22]))=='FORBIDDEN')
 applied=data(approve(rid,()));check('대강 반영과 원본 이력',applied['status']=='applied' and q('select teacher_ids,version,changed_by from workhub.timetable_lessons where id=%s',(lid,))[0]==(['m-22'],2,'intervention'))
 check('대강 시수 0',p['hours']=={'addedSeconds':0,'removedSeconds':0})
 check('원수업 교사 자원 교체',q("select uses @> '[{\"id\":\"m-22\",\"kind\":\"teacher\"}]' and not uses @> '[{\"id\":\"m-21\",\"kind\":\"teacher\"}]' from workhub.timetable_lessons where id=%s",(lid,))[0][0])
 rid2,p2,c2,r2=submit({'kind':'cancel','lessonId':cancelid,'expectedVersion':1,'reason':'개별 휴강'},'m-21',old.T[21]);check('본인 단독 교사는 승인 대기',data(r2)['status']=='awaiting_approval');data(approve(rid2,()))
 check('휴강 시수와 취소 원본 유지',p2['hours']=={'removedSeconds':2700,'addedSeconds':0} and q('select state from workhub.timetable_lessons where id=%s',(cancelid,))[0][0]=='cancelled')
 targetDay=anchor+datetime.timedelta(days=9);start=datetime.datetime.combine(targetDay,datetime.time(9),datetime.timezone(datetime.timedelta(hours=9)))
 makeup={'kind':'makeup','lessonId':cancelid,'expectedVersion':2,'target':{'startsAt':old.iso(start),'endsAt':old.iso(start+datetime.timedelta(minutes=45))},'reason':'원수업 연결 보강'}
 rid3,p3,c3,r3=submit(makeup,'m-21',old.T[21]);a3=data(approve(rid3,()));newid=a3['changedLessons'][0]['id']
 check('보강 신규 수업과 원수업 연결',newid!=cancelid and q('select original_lesson_id,makeup_lesson_id from workhub.timetable_makeup_links where intervention_id=%s',(rid3,))[0]==(cancelid,newid))
 check('보강이 원취소 판을 바꾸지 않음',q('select version,state from workhub.timetable_lessons where id=%s',(cancelid,))[0]==(2,'cancelled') and p3['hours']=={'removedSeconds':0,'addedSeconds':2700})
 check('중복 보강 차단',any(x['code']=='ALREADY_MADE_UP' for x in data(preview(makeup))['blockers']))
 # 원래 학사 변경 RPC가 만든 휴업 전체를 원변경 ID로 복원한다.
 oa=old.O(base.ADMIN,adm);G=data(oa.oget(f,u));day=(anchor+datetime.timedelta(days=3)).isoformat();groups=sorted(g['id'] for g in template['groups'])
 sp=data(oa.sdprev({'kind':'closure','date':day,'groupIds':groups,'reason':'복원 시험 휴업','bells':[]},G['asOf'],f,u));sr=data(oa.sdexec({'kind':'school_day','preview':{k:sp[k] for k in ('previewId','previewHash','expiresAt')}}));sdid=sr['entityId']
 check('학사 변경 출처 생성',q("select count(*) from workhub.timetable_intervention_sources where kind='school_day' and entity_id=%s",(sdid,))[0][0]==1)
 rid4,p4,c4,r4=submit({'kind':'reopen','schoolDayChangeId':sdid,'reason':'휴업 취소 확인'});data(approve(rid4))
 check('휴업 복원 전체 적용',q('select state,version from workhub.timetable_lessons where id=%s',(reopenid,))[0]==('scheduled',3))
 check('휴업 복원 원장 보존',q('select count(*) from workhub.timetable_reopened_days where school_day_change_id=%s',(sdid,))[0][0]==1)
 check('동일 휴업 중복 복원 거절',ec(preview({'kind':'reopen','schoolDayChangeId':sdid,'reason':'중복'}))=='CONFLICT')
 # 동일 키 복구는 활성 정책보다 먼저며, close 원장은 늦은 commit을 차단한다.
 cp=data(preview({'kind':'cancel','lessonId':closeid,'expectedVersion':1,'reason':'결과 유실 닫기'}));cc=command(cp)
 check('미반영 복구는 NOT_FOUND',ec(execute(cc,'close-key',recover=True))=='NOT_FOUND')
 q('update workhub.timetable_intervention_policies set active=false')
 q("update workhub.module_activations set state='stopped' where school_id=%s and module='timetable_operations'",(school,))
 cr=data(close(cc,'close-key'));check('모듈 중지 뒤 닫기',cr['outcome']=='closed' and cr['receipt'] is None)
 check('닫기 멱등',data(close(cc,'close-key'))==cr);check('닫은 번호 늦은 반영 차단',ec(execute(cc,'close-key'))=='CONFLICT')
 check('이미 쓴 미리보기 다른 키 닫기 거절',ec(close(c2,'different-used-key','m-21',old.T[21]))=='CONFLICT')
 check('원접수증 중지 뒤 복구',data(execute(c2,data(r2)['requestKey'],'m-21',old.T[21]))==data(r2))
 check('이미 적용 닫기는 원접수증',data(close(c2,data(r2)['requestKey'],'m-21',old.T[21]))['receipt']==data(r2))
 modified=json.loads(json.dumps(cc));modified['preview']['input']['reason']='원문 변경'
 check('같은 번호 다른 원문 차단',ec(close(modified,'close-key'))=='IDEMPOTENCY_CONFLICT')
 q('update workhub.timetable_intervention_policies set active=true')
 q("update workhub.module_activations set state='active' where school_id=%s and module='timetable_operations'",(school,))
 expired=q("insert into workhub.timetable_intervention_previews(school_id,membership_id,account_id,input,plan,preview_hash,created_at,expires_at) select school_id,membership_id,account_id,input,plan,preview_hash,now()-interval '2 hours',now()-interval '1 hour' from workhub.timetable_intervention_previews where id=%s returning id,workhub_private.t2_ts(expires_at)",(cp['previewId'],))[0]
 xc=json.loads(json.dumps(cc));xc['preview']['previewId']=expired[0];xc['preview']['expiresAt']=expired[1]
 check('만료 원명령 확정 거절',ec(execute(xc,'expired-test-key'))=='CONFLICT')
 check('만료 뒤 명시 닫기 장벽',data(close(xc,'expired-test-key'))['outcome']=='closed' and ec(execute(xc,'expired-test-key'))=='CONFLICT')
 check('정책 재개해도 닫기 유지',ec(execute(cc,'close-key'))=='CONFLICT')
 q("update workhub.memberships set status='suspended' where id='m-21'")
 try:execute(c2,data(r2)['requestKey'],'m-21',old.T[21])
 except Exception as ex:check('접수증 복구도 현재 소속 경계 유지','INACTIVE_MEMBERSHIP' in str(ex))
 else:check('접수증 복구도 현재 소속 경계 유지',False)
 q("update workhub.memberships set status='active' where id='m-21'")
 check('다른 사용자 미리보기 닫기 비노출',ec(close(cc,'different-user','m-22',old.T[22]))=='NOT_FOUND')
 check('다른 학교 명령 비노출',ec(close(cc,'different-school','m-27',old.T[27]))=='NOT_FOUND')
 # 같은 키 execute/close 경쟁과 중복 실행.
 for n in range(3):
  rp=data(preview({'kind':'cancel','lessonId':raceid,'expectedVersion':1,'reason':'경합 확인'}));rc=command(rp);rk='race-key-'+str(n)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(execute,rc,rk);b=pool.submit(close,rc,rk);ar,br=a.result(),data(b.result())
  check('반영 닫기 경합 단일결론 '+str(n),data(ar)==br['receipt'] if br['outcome']=='applied' else ec(ar)=='CONFLICT')
  if br['outcome']=='applied':data(action(br['receipt']['entityId'],'withdraw'))
 rp=data(preview({'kind':'cancel','lessonId':raceid,'expectedVersion':1,'reason':'중복 실행'}));rc=command(rp)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rr=list(pool.map(lambda _:execute(rc,'parallel-key'),range(2)))
 check('동시 동일키 원접수증 1개',rr[0]==rr[1] and 'data' in rr[0]);data(action(data(rr[0])['entityId'],'withdraw'))
 # 승인 직전 소속/승인 회수, 충돌이 생기면 원안은 반영되지 않는다.
 dr,dp,dc,dres=submit({'kind':'cancel','lessonId':denyid,'expectedVersion':1,'reason':'현재 소속 검사'},'m-21',old.T[21])
 q("update public.users set is_active=false where id=%s",(old.T[21],));check('영향 교사 승인 회수 후 반영 차단',ec(approve(dr,()))=='CONFLICT');q('update public.users set is_active=true where id=%s',(old.T[21],))
 data(action(dr,'withdraw','m-21',old.T[21]))
 fixture('teacher-collision',8,540,['m-22'])
 collision=data(preview({'kind':'substitute','lessonId':collisionid,'expectedVersion':1,'substituteTeacherId':'m-22','reason':'충돌 확인'}));check('대강 자원 충돌 차단',any(b['code']=='RESOURCE_CONFLICT' for b in collision['blockers']))
 check('차단 미리보기 제출 불가',ec(execute(command(collision),'blocked-key'))=='INVALID_INPUT')
 # 기존 T2 이동·교환도 시범 자격과 자원 원장을 함께 지킨다.
 oa21=old.O(old.T[21],'m-21');oa22=old.O(old.T[22],'m-22')
 moveTarget=datetime.datetime.combine(anchor+datetime.timedelta(days=10),datetime.time(9),datetime.timezone(datetime.timedelta(hours=9)))
 mi={'kind':'move','lessonId':denyid,'expectedVersion':1,'target':{'startsAt':old.iso(moveTarget),'endsAt':old.iso(moveTarget+datetime.timedelta(minutes=45))},'reason':'T3 후 이동'}
 mp=data(oa21.xprev(mi));check('T3 후 T2 이동 미리보기',not mp['blockers']);mr=data(oa21.oexec({'kind':'submit','preview':{k:mp[k] for k in ('previewId','previewHash','expiresAt','input')}}))
 mreq=next(x for x in data(oa.oget(f,u))['requests'] if x['id']==mr['entityId'])
 check('T3 요약에 기존 T2 승인 포함',data(rpc('summary'))['pendingApproval']>=1)
 mac={'kind':'action','requestId':mreq['id'],'expectedVersion':mreq['version'],'proposalHash':mreq['proposalHash'],'action':'approve'}
 concurrent_revocation('update workhub.timetable_intervention_policies set active=false where school_id=%s',(school,),mac,'t2-policy-race',adm,base.ADMIN,'NOT_READY')
 q('update workhub.timetable_intervention_policies set active=true where school_id=%s',(school,))
 concurrent_revocation('update public.users set is_active=false where id=%s',(old.T[21],),mac,'t2-member-race',adm,base.ADMIN,'CONFLICT')
 q('update public.users set is_active=true where id=%s',(old.T[21],))
 check('T3 후 T2 이동 승인',data(oa.oexec(mac))['status']=='applied')
 swa=fixture('swap-a',14,540,['m-21']);swb=fixture('swap-b',16,540,['m-22'])
 si={'kind':'swap','lessonId':swa,'expectedVersion':1,'otherLessonId':swb,'otherExpectedVersion':1,'reason':'T3 후 교환'}
 sx=data(oa21.xprev(si));check('T3 후 T2 교환 미리보기',not sx['blockers']);swapcmd={'kind':'submit','preview':{k:sx[k] for k in ('previewId','previewHash','expiresAt','input')}}
 concurrent_revocation('update public.users set is_active=false where id=%s',(old.T[22],),swapcmd,'t2-submit-race','m-21',old.T[21],'CONFLICT')
 q('update public.users set is_active=true where id=%s',(old.T[22],));sreq=data(oa21.oexec(swapcmd))
 sr=next(x for x in data(oa22.oget(f,u))['requests'] if x['id']==sreq['entityId']);data(oa22.oexec({'kind':'action','requestId':sr['id'],'expectedVersion':sr['version'],'proposalHash':sr['proposalHash'],'action':'accept'}))
 sr=next(x for x in data(oa.oget(f,u))['requests'] if x['id']==sreq['entityId']);check('T3 후 T2 교환 최종 승인',data(oa.oexec({'kind':'action','requestId':sr['id'],'expectedVersion':sr['version'],'proposalHash':sr['proposalHash'],'action':'approve'}))['status']=='applied')
 # 실제 편성 활동의 개별 휴강은 재공개가 되살리지 않는다.
 real=q("select id,version,occurrence_date,activity_id from workhub.timetable_lessons where school_id=%s and teacher_ids=array['m-21'] and state='scheduled' and id not like 't3-%%' order by starts_at desc limit 1",(school,))[0]
 realinput={'kind':'cancel','lessonId':real[0],'expectedVersion':real[1],'reason':'실제 공개 활동 보존'}
 realfrom=real[2].isoformat();realuntil=(real[2]+datetime.timedelta(days=5)).isoformat()
 realview=data(rpc('get',(realfrom,realuntil),range={'from':realfrom,'until':realuntil}));realp=data(rpc('preview',(realinput,),input=realinput,source=realview));realr=data(execute(command(realp),'real-preserve-key'));data(approve(realr['entityId']))
 draft=q('select id,1 from workhub.timetable_drafts where school_id=%s order by created_at desc,id desc limit 1',(school,))[0]
 pubin={'draftId':draft[0],'draftVersion':draft[1],'from':realfrom,'until':realuntil};pv=data(oa.pprev(pubin))
 check('개별 휴강 재공개 보존',not any(ch['after']['id']==real[0] for ch in pv['changes']) and not any(ch['before'] is None and ch['after']['label']==template['label'] and ch['after']['time']['startsAt'].startswith(realfrom) for ch in pv['changes']))
 check('휴강 보존 실제 재공개에 차단 없음',not pv['blockers'])
 pubcmd={'kind':'publish','preview':{k:pv[k] for k in ('previewId','previewHash','expiresAt','input')}}
 check('휴강 보존 실제 재공개 확정',data(oa.oexec(pubcmd))['status']=='published')
 check('재공개 후 원활동 취소 유지 및 중복 예정 없음',q("select state from workhub.timetable_lessons where id=%s",(real[0],))[0][0]=='cancelled' and q("select count(*) from workhub.timetable_lessons where school_id=%s and activity_id=%s and occurrence_date=%s and state<>'cancelled'",(school,real[3],real[2]))[0][0]==0)
 # 모든 신규 운영 고정 수업은 공개 계획의 retained에 남아 실제 행이 바뀌지 않는다.
 before=q("select id,version,state,teacher_ids,starts_at from workhub.timetable_lessons where changed_by='intervention' order by id")
 puball=data(oa.pprev({'draftId':draft[0],'draftVersion':draft[1],'from':f,'until':u}))
 protected={row[0] for row in before};check('대강 휴강 보강 복원 재공개 계획 보존',not protected.intersection(ch['after']['id'] for ch in puball['changes']))
 check('재공개 미리보기 원장 불변',q("select id,version,state,teacher_ids,starts_at from workhub.timetable_lessons where changed_by='intervention' order by id")==before)
 termstate=q('select state from workhub.terms where id=%s',(template['term_id'],))[0][0]
 q("update workhub.terms set state='closed' where id=%s",(template['term_id'],))
 check('닫힌 학기 신규 운영 변경 차단',ec(preview({'kind':'cancel','lessonId':closeid,'expectedVersion':1,'reason':'닫힌 학기'}))=='CONFLICT')
 q('update workhub.terms set state=%s where id=%s',(termstate,template['term_id']))
 # 출처·홈 할 일·원본 보호.
 for sid, in q('select id from workhub.timetable_intervention_sources where school_id=%s',(school,)):
  data(rpc('resolve',(sid,),sourceId=sid))
 sid=q("select id from workhub.timetable_intervention_sources where entity_id=%s",(rid,))[0][0]
 check('다른 학교 알림 출처 비노출',ec(rpc('resolve',(sid,),'m-27',old.T[27],capture=False)) in ('NOT_READY','NOT_FOUND'))
 summary=data(rpc('summary'));check('홈 할 일 상한과 시수 연결',len(summary['items'])<=20 and summary['makeupNeeded']>=0)
 view();view('m-22',old.T[22])
 check('legacy gate 원문과 auth 수 보존',q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]==legacy_before and q('select count(*) from auth.users')[0][0]==auth_before)
 try:q("update workhub.timetable_intervention_commands set receipt='{}' where request_key='close-key'")
 except Exception:check('접수증·닫기 원장 불변',True)
 else:check('접수증·닫기 원장 불변',False)

if __name__=='__main__':main()
