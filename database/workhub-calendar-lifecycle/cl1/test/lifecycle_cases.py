"""기존 일정 RPC와 새 취소 RPC의 실제 PostgreSQL 회귀. 유료·외부 호출 없음."""
import json,concurrent.futures,threading,hashlib,subprocess,datetime
from pathlib import Path

def configure(integration):
 global I,H,q,R,ADMIN,SCHOOL
 I=integration;H=I.H;q=I.run
 import notification_cases as N
 R=N.R;ADMIN=N.ADMIN;SCHOOL=N.SCHOOL

def guard_tests(install):
 for label,mutation in [('원문',"SELECT pg_get_functiondef('public.workhub_calendar_save(text,jsonb)'::regprocedure)"),('소유자',None),('검색 경로','ALTER FUNCTION public.workhub_calendar_save(text,jsonb) SET search_path=public'),('실행 문맥','ALTER FUNCTION public.workhub_calendar_save(text,jsonb) SECURITY INVOKER')]:
  with H.connect(user='supabase_admin',db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('BEGIN')
    if label=='원문':
     cur.execute(mutation);cur.execute(cur.fetchone()[0].replace('BEGIN','BEGIN\n -- CL1 실패 주입',1))
    elif mutation:cur.execute(mutation)
    else:cur.execute('ALTER FUNCTION public.workhub_calendar_save(text,jsonb) OWNER TO supabase_admin')
    cur.execute('SET LOCAL ROLE postgres');cur.execute('SAVEPOINT guard')
    try:cur.execute(install);raise AssertionError('훼손 기준 설치 허용')
    except H.psycopg2.Error as e:H.check('CL1 '+label+' 가드','선행 함수 원문/소유자 불일치' in str(e))
    cur.execute('ROLLBACK TO guard');cur.execute("SELECT to_regclass('workhub_private.cl1_installs')");H.check('CL1 '+label+' 거절 후 새 객체 없음',cur.fetchone()[0] is None);cur.execute('ROLLBACK')

def draft(title='취소 회귀',visibility='school',audience=None):
 return dict(title=title,description='원문을 보존합니다',location='교무실',startDate='2026-11-18',endDate='2026-11-18',allDay=True,startTime='',endTime='',visibility=visibility,audience=audience or dict(all=visibility=='school',groups=[],includeMemberIds=[],excludeMemberIds=[]))
def save(key,d=None,mid=None,uid=None,**kw):return I.rpc('workhub_calendar_save',mid or ADMIN,dict(draft=d or draft(),idempotencyKey=key,**kw),uid=uid or H.ADMIN)
def command(e,reason='일정 변경에 따른 취소'):return dict(eventId=e['id'],expectedVersion=e['version'],reason=reason)
def cancel(cmd,key,mid=None,uid=None,recover=False):return I.rpc('workhub_calendar_cancel',mid or ADMIN,cmd,key,recover,uid=uid or H.ADMIN)
def expect_error(fn,code):
 try:
  r=fn()
  return r.get('code')==code if isinstance(r,dict) else False
 except H.psycopg2.Error as e:return e.diag.message_primary==code
def counts():return I.preserve(['workhub.events','workhub.event_revisions','workhub.idempotency_receipts','workhub.audit_events','workhub.outbox','workhub.audience_sets'])

def tests():
 for n in [21,22,23]:q("UPDATE workhub.participant_grants SET scopes=ARRAY['calendar','messages','collections'] WHERE membership_id=%s",(R.M[n],))
 e=save('cl1-create');cmd=command(e);original=q('SELECT snapshot FROM workhub.event_revisions WHERE event_id=%s',(e['id'],))[0][0]
 H.check('기존 생성 응답은 active와 빈 취소 정보',e['status']=='active' and e['cancelledAt'] is None and e['cancelReason'] is None)
 before=counts();unknown=cancel(cmd,'cl1-cancel',recover=True)
 H.check('원키 미접수 조회는 unknown·변경 없음',unknown['outcome']=='unknown' and unknown['code']=='SAVE_UNCERTAIN' and counts()==before)
 H.check('거절·미확정 봉투의 명령 해시는 앱 canonical과 동일',unknown['commandHash']==hashlib.sha256(json.dumps(cmd,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest())
 result=cancel(cmd,'cl1-cancel');cancelled=result['event']
 H.check('명시 취소는 원본 보존·판 1 증가·사유 시각',result['ok'] and cancelled['version']==e['version']+1 and cancelled['status']=='cancelled' and cancelled['cancelReason']==cmd['reason'] and cancelled['cancelledAt'] is not None)
 H.check('표준 응답의 현재 학교·계정·소속',result['contractVersion']=='calendar.lifecycle.v1' and result['schoolId']==SCHOOL and result['memberId']==ADMIN and result['ownerUserId']==H.ADMIN and result['requestKey']=='cl1-cancel')
 H.check('원키 재전송·결과 조회의 응답과 접수 시각 불변',cancel(cmd,'cl1-cancel')==result and cancel(cmd,'cl1-cancel',recover=True)==result)
 H.check('미접수 조회 뒤 지연 최초 요청도 같은 원키로 복구',unknown['outcome']=='unknown' and cancel(cmd,'cl1-cancel',recover=True)==result)
 rows=q('SELECT snapshot,change_kind FROM workhub.event_revisions WHERE event_id=%s ORDER BY revision_no',(e['id'],))
 H.check('원래 판과 취소 판 원본·대상 스냅샷 동일',len(rows)==2 and rows[0][0]==rows[1][0]==original and rows[-1][1]=='cancel')
 H.check('취소 목록에만 표시하고 원본 직접 조회 가능',not any(x['id']==e['id'] for x in I.rpc('workhub_calendar_list',ADMIN)) and any(x['id']==e['id'] for x in I.rpc('workhub_calendar_cancelled_list',ADMIN)) and I.rpc('workhub_calendar_get',ADMIN,e['id'])==cancelled)
 H.check('취소 전 저장 원키 복구는 현재 취소 상태를 반환',save('cl1-create')==cancelled)
 before=counts();H.check('취소 후 새 저장은 판이 맞아도 거부',expect_error(lambda:save('cl1-revive',id=e['id'],expectedVersion=cancelled['version']),'CONFLICT') and counts()==before)
 H.check('취소 원키 다른 내용은 거부',expect_error(lambda:cancel(command(e,'다른 사유'),'cl1-cancel'),'IDEMPOTENCY_CONFLICT'))
 H.check('새 번호로 이미 취소한 일정 재취소는 거부',expect_error(lambda:cancel(command(cancelled),'cl1-second-cancel'),'CONFLICT'))
 for label,bad in [('공백 사유',command(e,'  ')),('긴 사유',command(e,'가'*501)),('제어문자 사유',command(e,'취소\x01사유')),('잘못된 판',{**cmd,'expectedVersion':0}),('추가 필드',{**cmd,'ownerUserId':H.ADMIN})]:
  r=cancel(bad,'cl1-invalid-'+label);H.check(label+' 확정 거절·명령 해시',r['code']=='INVALID_INPUT' and r['outcome']=='rejected' and len(r['commandHash'])==64)
 own=save('cl1-teacher',mid=R.M[21],uid=R.T[21]);H.check('다른 일반 교사는 공유 일정 취소 불가',expect_error(lambda:cancel(command(own),'cl1-other',R.M[22],R.T[22]),'FORBIDDEN'))
 H.check('작성자 일반 교사 취소 가능',cancel(command(own),'cl1-own-cancel',R.M[21],R.T[21])['ok'])
 q('UPDATE workhub.participant_grants SET active=false WHERE membership_id=%s',(R.M[21],))
 H.check('허용 철회 후 본인 원접수증도 권한 우회 불가',expect_error(lambda:cancel(command(own),'cl1-own-cancel',R.M[21],R.T[21],True),'FORBIDDEN'))
 q('UPDATE workhub.participant_grants SET active=true WHERE membership_id=%s',(R.M[21],))
 p=save('cl1-private',draft(visibility='private'),R.M[21],R.T[21]);H.check('관리자도 다른 사람의 비공개 원본 취소 불가',expect_error(lambda:cancel(command(p),'cl1-private-admin'),'NOT_FOUND'))
 pr=cancel(command(p),'cl1-private-own',R.M[21],R.T[21]);H.check('비공개 취소 원본은 작성자만 조회',pr['ok'] and not any(x['id']==p['id'] for x in I.rpc('workhub_calendar_cancelled_list',ADMIN)))
 aud=dict(all=True,groups=[],includeMemberIds=[R.M[21]],excludeMemberIds=[R.M[21]])
 ae=save('cl1-audience',draft(audience=aud));ar=cancel(command(ae),'cl1-audience-cancel')
 H.check('취소 판은 전체·겹친 명시 포함·제외 대상 그대로 보존',ar['event']['audience']==ae['audience']==aud)
 other=cancel(cmd,'cl1-cancel',R.M[27],R.T[27],True)
 H.check('다른 학교는 원접수증을 받지 못함',other['outcome']=='unknown' and other['schoolId']!=SCHOOL and 'event' not in other)
 H.check('다른 학교는 취소할 수 없음',expect_error(lambda:cancel(cmd,'cl1-other-school',R.M[27],R.T[27]),'NOT_FOUND'))
 H.check('남의 소속 번호 도용 차단',expect_error(lambda:cancel(cmd,'cl1-spoof',ADMIN,R.T[21]),'INACTIVE_MEMBERSHIP'))
 c=save('cl1-manager-target',mid=R.M[21],uid=R.T[21]);H.check('기존 shared_manage 관리자는 공유 일정 취소 가능',cancel(command(c),'cl1-manager')['ok'])
 # 담당 부서에서 빠지면 관리 권한은 유지돼도 대상 한정 원문을 볼 수 없게 된다.
 today=q("SELECT workhub_private.today_in('Asia/Seoul')")[0][0]
 year=q('SELECT academic_year_id FROM workhub.terms WHERE school_id=%s AND starts_on<=%s AND ends_on>%s ORDER BY starts_on LIMIT 1',(SCHOOL,today,today))[0][0]
 q("INSERT INTO workhub.year_departments(id,school_id,academic_year_id,name,sort_order) VALUES('cl1-dept',%s,%s,'취소 복구 시험 부서',99)",(SCHOOL,year))
 q("INSERT INTO workhub.staff_assignments(id,school_id,academic_year_id,membership_id,kind,department_id,label,valid_from,valid_to,assigned_by_membership_id) VALUES('cl1-dept-role',%s,%s,%s,'department','cl1-dept','취소 복구 시험',%s,%s,%s)",(SCHOOL,year,ADMIN,today-datetime.timedelta(days=1),today+datetime.timedelta(days=1),ADMIN))
 group=dict(all=False,groups=[dict(departmentIds=['cl1-dept'],gradeIds=[],subjectIds=[])],includeMemberIds=[],excludeMemberIds=[])
 visible=save('cl1-manager-group',draft(visibility='audience',audience=group),R.M[21],R.T[21]);vcommand=command(visible)
 vr=cancel(vcommand,'cl1-manager-group-cancel');H.check('담당 부서 대상으로 보이는 일정은 기존 관리자 취소 가능',vr['ok'])
 q("UPDATE workhub.staff_assignments SET valid_to=%s,status='ended',ended_at=clock_timestamp(),ended_by_membership_id=%s WHERE id='cl1-dept-role'",(today,ADMIN))
 before=counts();hidden=cancel(vcommand,'cl1-manager-group-cancel',recover=True)
 H.check('이미 접수된 원문 가시성 철회는 unknown·원문 비노출·원키 보존',hidden['outcome']=='unknown' and hidden['code']=='SAVE_UNCERTAIN' and 'event' not in hidden and counts()==before)
 denied=cancel(vcommand,'cl1-manager-group-new')
 H.check('가시성 없는 새 취소는 확정 NOT_FOUND',denied['outcome']=='rejected' and denied['code']=='NOT_FOUND')
 q("UPDATE workhub.staff_assignments SET valid_to=%s,status='active',ended_at=NULL,ended_by_membership_id=NULL WHERE id='cl1-dept-role'",(today+datetime.timedelta(days=1),))
 H.check('가시성 복구 뒤 같은 번호로 원접수 결과 확인',cancel(vcommand,'cl1-manager-group-cancel',recover=True)==vr)
 stale=save('cl1-stale');new=save('cl1-update',id=stale['id'],expectedVersion=1)
 H.check('다른 곳에서 수정한 일정은 오래된 판 취소 거부',expect_error(lambda:cancel(command(stale),'cl1-stale-cancel'),'CONFLICT') and I.rpc('workhub_calendar_get',ADMIN,new['id'])==new)
 official=save('cl1-official');q("UPDATE workhub.events SET kind='official',official_state='confirmed' WHERE id=%s",(official['id'],))
 H.check('학사·휴업 공식 일정 취소는 별도 경로 유지',expect_error(lambda:cancel(command(official),'cl1-official-cancel'),'FORBIDDEN'))
 parallel=save('cl1-parallel-create');parallel_cmd=command(parallel)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(lambda _:cancel(parallel_cmd,'cl1-parallel'),range(2)))
 H.check('동시 원키 취소 두 건은 접수·판·감사 1건',rs[0]==rs[1] and q("SELECT count(*) FROM workhub.event_revisions WHERE event_id=%s AND change_kind='cancel'",(parallel['id'],))[0][0]==1)
 # 취소와 저장이 경쟁하면 행 잠금·기대 판으로 하나만 성공해야 한다.
 race=save('cl1-race-create');barrier=threading.Barrier(2)
 def race_save():
  barrier.wait()
  try:return ('save',save('cl1-race-save',id=race['id'],expectedVersion=1))
  except H.psycopg2.Error as ex:return ('save',{'code':ex.diag.message_primary})
 def race_cancel():barrier.wait();return ('cancel',cancel(command(race),'cl1-race-cancel'))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  f1=pool.submit(race_save);f2=pool.submit(race_cancel);rr=[f1.result()[1],f2.result()[1]]
 H.check('동시 저장·취소는 하나만 성공하고 판 2',sum('code' not in x for x in rr)==1 and q('SELECT version FROM workhub.events WHERE id=%s',(race['id'],))[0][0]==2)
 # outbox 오류는 취소 상태·판·접수·감사까지 원자적으로 되돌린다.
 fail=save('cl1-fail-create');q("CREATE FUNCTION workhub_private.cl1_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='event.cancelled' THEN RAISE EXCEPTION 'CL1_TEST_FAILURE'; END IF;RETURN NEW;END $$;CREATE TRIGGER cl1_test_fail BEFORE INSERT ON workhub.outbox FOR EACH ROW EXECUTE FUNCTION workhub_private.cl1_test_fail()")
 before=counts();H.check('후속 outbox 실패는 전체 롤백',expect_error(lambda:cancel(command(fail),'cl1-fail'),'CL1_TEST_FAILURE') and counts()==before)
 q('DROP TRIGGER cl1_test_fail ON workhub.outbox;DROP FUNCTION workhub_private.cl1_test_fail()')
 H.check('롤백 뒤 같은 원키 재전송은 정상 종결',cancel(command(fail),'cl1-fail')['ok'])
 H.check('취소 접수증은 본문 없이 ID·판·시각만 저장',all(set(row[0])=={'resource_type','resource_id','resource_version','recorded_at'} for row in q("SELECT result FROM workhub.idempotency_receipts WHERE operation='calendar.cancel'")))
 for role in ['anon','service_role']:
  H.check(role+' 취소 API 직접 실행 차단',not q("SELECT has_function_privilege(%s,'public.workhub_calendar_cancel(text,jsonb,text,boolean)','EXECUTE')",(role,))[0][0])
 capture=dict(scope=dict(schoolId=SCHOOL,memberId=ADMIN,ownerUserId=H.ADMIN),members=[dict(id=ADMIN,schoolId=SCHOOL,userId=H.ADMIN,role='school_admin')],command=cmd,key='cl1-cancel',active=e,receipt=result,recovered=cancel(cmd,'cl1-cancel',recover=True),unknown=unknown)
 target=H.WORK/'cl1-app-captures.json';target.write_text(json.dumps(capture,ensure_ascii=False),encoding='utf-8')
 subprocess.run(['node',str(Path(__file__).with_name('app_contract.mjs')),str(target)],cwd=I.ROOT,check=True)
 H.check('실제 SQL 응답과 앱 취소 parser 대조',True)
