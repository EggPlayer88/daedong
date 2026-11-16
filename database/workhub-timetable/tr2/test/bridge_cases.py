"""전체 확정 SQL·CL1·TR2 위 합성 22명/9학급/288교시 운영 변환 회귀."""
from pathlib import Path
import json,datetime,uuid,copy,subprocess,concurrent.futures

def configure(integration):
 global I,H,q,ROOT,HERE,CAPTURES
 I=integration;H=I.H;q=I.run;ROOT=I.ROOT;HERE=Path(__file__).resolve().parents[1];CAPTURES=[]

def rpc(name,*args,uid=None):
 value=I.rpc('workhub_timetable_roster_bridge_'+name,*args,uid=uid or H.ADMIN)
 if 'data' in value:CAPTURES.append(dict(name=name,args=args,data=value['data']))
 return value

def checked(value):
 if 'error' in value:raise AssertionError(value)
 return value['data']

def expect(operation,code):
 try:return operation().get('error',{}).get('code')==code
 except H.psycopg2.Error as e:return e.diag.message_primary==code

def tests():
 school,mid=q("SELECT m.school_id,m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s ORDER BY m.id LIMIT 1",(H.ADMIN,))[0]
 q("INSERT INTO workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) VALUES(%s,%s,'TR2 격리 학교 준비','active') ON CONFLICT(school_id) DO UPDATE SET state='active'",(school,mid))
 q("INSERT INTO workhub.teaching_policies(school_id,counseling_scope,approved_by_membership_id,approval_ref) VALUES(%s,'off',%s,'TR2 격리 수업 정책') ON CONFLICT(school_id) DO NOTHING",(school,mid))
 for module in ['teaching','timetable','timetable_operations']:q("INSERT INTO workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) VALUES(%s,%s,'active',%s,'TR2 격리 준비') ON CONFLICT(school_id,module) DO UPDATE SET state='active'",(school,module,mid))
 today=q("SELECT workhub_private.today_in('Asia/Seoul')")[0][0]
 data=checked(I.rpc('workhub_teacher_roster_get',mid));term=next(t for t in data['terms'] if datetime.date.fromisoformat(t['until'])>today+datetime.timedelta(days=25))
 p=json.loads((ROOT/'tests/fixtures/teacher-roster/nine-classes.json').read_text(encoding='utf-8'))['plan'];p['id']='tr2_full_plan';p['termId']=term['id'];p['from']=max(today+datetime.timedelta(days=1),datetime.date.fromisoformat(term['from'])).isoformat();p['until']=term['until'];p['homerooms']=[]
 def tr1apply(intent,key):
  v=checked(I.rpc('workhub_teacher_roster_preview',mid,intent))
  if v['findings']:raise AssertionError(v['findings'])
  return checked(I.rpc('workhub_teacher_roster_commit',mid,dict(previewId=v['id'],hash=v['hash'],intent=intent),key))
 tr1apply(dict(kind='save',expectedRevision=data['revision'],plan=p),'tr2-full-save')
 rev=q('SELECT revision FROM teacher_roster.schools WHERE school_id=%s',(school,))[0][0]
 tr1apply(dict(kind='publish',expectedRevision=rev,planId=p['id'],version=1),'tr2-full-publish')
 base=datetime.date.fromisoformat(p['from']);start=base+datetime.timedelta(days=(7-base.weekday())%7);end=start+datetime.timedelta(days=7)
 i=dict(planId=p['id'],planVersion=2,**{'from':start.isoformat(),'until':end.isoformat()})
 def value(kind,*args):return checked(rpc(kind,mid,*args))
 def preview(inp=None):return value('preview',inp or i)
 def command(v):return dict(previewId=v['id'],hash=v['hash'],input=v['input'])
 H.check('TR2 기본표 목록 22명·9학급·288교시',next(x for x in value('get')['plans'] if x['id']==p['id'])['weeklyLessons']==288)
 b=preview();H.check('미연결 교사는 추측하지 않고 발행 차단',any(x['code']=='TEACHER_UNLINKED' for x in b['blockers']))
 H.check('미연결 미리보기는 기준판도 만들지 않음',q('SELECT count(*) FROM timetable_roster_bridge.sources')[0][0]==0)
 q("INSERT INTO workhub.school_roster_policies(school_id,active,allowed_user_ids,approved_by_membership_id,approval_ref) VALUES(%s,true,ARRAY[%s]::uuid[],%s,'TR2 격리 시험') ON CONFLICT(school_id) DO UPDATE SET active=true",(school,H.ADMIN,mid))
 users=[]
 for j,teacher in enumerate(p['teachers']):
  uid=str(uuid.uuid4());aid='tr2-account-'+str(j);tid='tr2-member-'+str(j);users.append((uid,tid))
  q("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%s,%s,%s::jsonb)",(uid,f'tr2-{j}@example.invalid',json.dumps({'full_name':teacher['name']})),user='supabase_admin')
  q("UPDATE public.users SET is_active=true,role='teacher' WHERE id=%s",(uid,))
  q("INSERT INTO workhub.accounts(id,auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,status,legacy_approval_state) VALUES(%s,%s,%s,'same_auth_user',now(),%s,'active','approved')",(aid,uid,uid,teacher['name']))
  q("INSERT INTO workhub.memberships(id,school_id,account_id,status,employment_type,valid_from,valid_to,decided_at) VALUES(%s,%s,%s,'active','teacher',%s,%s,now())",(tid,school,aid,today,p['until']))
  rev=q('SELECT revision FROM teacher_roster.schools WHERE school_id=%s',(school,))[0][0]
  tr1apply(dict(kind='link',expectedRevision=rev,teacherId=teacher['id'],memberId=tid,**{'from':p['from'],'until':p['until']}),'tr2-link-'+str(j))
 protected=['workhub.terms','workhub.timetable_prep_drafts','workhub.timetable_prep_draft_revisions','workhub.membership_roles','public.users','workhub.course_assignments','workhub.memberships']
 original=I.preserve(protected);old_lessons=I.preserve(['workhub.timetable_lessons'])
 v=preview()
 if v['blockers']:raise AssertionError(v['blockers'][:3])
 H.check('288교시 전체 기간 실제 소속 연결 대조',len(v['changes'])==288 and v['summary']['weeklyLessons']==288)
 H.check('미리보기는 현재기준판·준비입력·날짜별수업 불변',I.preserve(protected)==original and I.preserve(['workhub.timetable_lessons'])==old_lessons)
 c=command(v);r=value('commit',c,'tr2-publish-one',False)
 H.check('공유 현재기준판 교체 없이 실제288수업 발행',r['changedLessons']==288 and q('SELECT count(*) FROM workhub.timetable_lessons WHERE publication_id=%s',(r['publicationId'],))[0][0]==288)
 H.check('기본 배치는 유지하며 같은 길이 일과의 이동 후보 허용',q('SELECT min(cardinality(allowed_slot_ids)) FROM workhub.timetable_lessons WHERE publication_id=%s',(r['publicationId'],))[0][0]>1)
 H.check('교사·요일·교시 시각은 원본과 정확히 일치',q("SELECT count(*) FROM workhub.timetable_lessons l JOIN jsonb_array_elements(%s::jsonb->'lessons') x ON l.activity_id='tr2a_'||workhub_private.p2_sha(jsonb_build_array(%s::text,x->>'id')) JOIN jsonb_array_elements(%s::jsonb->'slots') z ON z->>'id'=x->>'slotId' JOIN jsonb_array_elements(%s::jsonb->'courses') c ON c->>'id'=x->>'courseId' JOIN teacher_roster.links li ON li.school_id=l.school_id AND li.teacher_id=c->>'teacherId' WHERE l.publication_id=%s AND l.course_id=x->>'courseId' AND l.teacher_ids=ARRAY[li.member_id] AND extract(isodow FROM l.starts_at AT TIME ZONE 'Asia/Seoul')=(z->>'day')::int AND extract(hour FROM l.starts_at AT TIME ZONE 'Asia/Seoul')*60+extract(minute FROM l.starts_at AT TIME ZONE 'Asia/Seoul')=(z->>'start')::int AND extract(hour FROM l.ends_at AT TIME ZONE 'Asia/Seoul')*60+extract(minute FROM l.ends_at AT TIME ZONE 'Asia/Seoul')=(z->>'end')::int",(json.dumps(p),p['id'],json.dumps(p),json.dumps(p),r['publicationId']))[0][0]==288)
 H.check('원번호 재확인은 같은 접수증',value('commit',c,'tr2-publish-one',True)==r)
 H.check('같은 원번호 재전송도 중복 생성 없음',value('commit',c,'tr2-publish-one',False)==r)
 H.check('동일 기본표 재검토는 변경0',preview()['changes']==[])
 H.check('기존학기 기준판·준비입력·실제권한·담당배정 보존',I.preserve(protected)==original)
 H.check('다른 판·기간·추가 입력 거절',expect(lambda:rpc('preview',mid,{**i,'planVersion':1}),'CONFLICT') and expect(lambda:rpc('preview',mid,{**i,'from':'2000-01-01'}),'INVALID_INPUT') and expect(lambda:rpc('preview',mid,{**i,'extra':True}),'INVALID_INPUT'))
 H.check('같은 원번호 다른 명령 거절',expect(lambda:rpc('commit',mid,{**c,'hash':'b'*64},'tr2-publish-one',False),'IDEMPOTENCY_CONFLICT'))
 H.check('기존 게이트는 일반 교사의 관리자 소속 도용 차단',expect(lambda:rpc('get',mid,uid=users[0][0]),'FORBIDDEN'))
 H.check('일반교사의 관리 API 차단',expect(lambda:rpc('get',users[0][1],uid=users[0][0]),'FORBIDDEN'))
 next_i={**i,'from':end.isoformat(),'until':(end+datetime.timedelta(days=7)).isoformat()};n=preview(next_i);nc=command(n)
 q("UPDATE workhub.memberships SET status='suspended' WHERE id=%s",(users[1][1],))
 H.check('미리보기 뒤 교사 소속 중지는 확정 전에 재검증',expect(lambda:rpc('commit',mid,nc,'tr2-teacher-changed',False),'CONFLICT'))
 q("UPDATE workhub.memberships SET status='active' WHERE id=%s",(users[1][1],))
 H.check('미접수 원번호 복구는 쓰기 없이 NOT_FOUND',expect(lambda:rpc('commit',mid,nc,'tr2-never-sent',True),'NOT_FOUND'))
 H.check('명시 닫기와 반복 닫기의 결과 동일',value('close',nc,'tr2-close-one')==value('close',nc,'tr2-close-one')==dict(outcome='closed',receipt=None))
 H.check('닫힌 원번호의 늦은 최초 요청 거절',expect(lambda:rpc('commit',mid,nc,'tr2-close-one',False),'CONFLICT'))
 q("UPDATE timetable_roster_bridge.previews SET expires_at=clock_timestamp()-interval '1 second' WHERE id=%s",(n['id'],))
 H.check('만료된 미리보기는 새 발행 금지',expect(lambda:rpc('commit',mid,nc,'tr2-expired-one',False),'CONFLICT'))
 # 학교 모듈 중지 뒤에도 이미 끝난 본인 원번호 확인/닫기는 가능하다.
 q("UPDATE workhub.module_activations SET state='stopped' WHERE school_id=%s AND module='timetable_operations'",(school,))
 H.check('모듈 중지 뒤 기존 접수증 복구',value('commit',c,'tr2-publish-one',True)==r)
 H.check('모듈 중지 뒤 이미 처리된 원번호 닫기',value('close',c,'tr2-publish-one')==dict(outcome='applied',receipt=r))
 q("UPDATE workhub.module_activations SET state='active' WHERE school_id=%s AND module='timetable_operations'",(school,))
 # 원본 기간의 변경·동의 기록을 보존한다. 기존 T2의 pinned 규칙을 그대로 이용한다.
 ids=q('SELECT id FROM workhub.timetable_lessons WHERE publication_id=%s ORDER BY id LIMIT 2',(r['publicationId'],));q("UPDATE workhub.timetable_lessons SET state='cancelled',pinned=true,changed_by='school_day' WHERE id=%s",(ids[0][0],));q("UPDATE workhub.timetable_lessons SET pinned=true,changed_by='exchange' WHERE id=%s",(ids[1][0],))
 pinned=q('SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id=ANY(%s) ORDER BY id',([x[0] for x in ids],));versions=I.preserve(['workhub.timetable_lesson_versions','workhub.timetable_exchange_requests'])
 H.check('휴업취소·교환 pinned 수업은 재발행 변경0',preview()['changes']==[])
 H.check('휴업·교환 판·시각·동의 기록 불변',pinned==q('SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id=ANY(%s) ORDER BY id',([x[0] for x in ids],)) and I.preserve(['workhub.timetable_lesson_versions','workhub.timetable_exchange_requests'])==versions)
 # 기존 T1 출처 기준판과 날짜별 시험 수업을 만들어 범위 안/밖 보존과 중복을 검증한다.
 q("INSERT INTO workhub.timetable_prep_drafts(id,school_id,term_id,revision,source_fingerprint,draft,updated_by_membership_id) VALUES('tr2-legacy-prep',%s,%s,1,%s,'{}',%s)",(school,p['termId'],'0'*64,mid))
 q("INSERT INTO workhub.timetable_prep_draft_revisions(school_id,draft_id,revision,kind,source_fingerprint,draft,membership_id,request_key) VALUES(%s,'tr2-legacy-prep',1,'save',%s,'{}',%s,'tr2-legacy-prep')",(school,'0'*64,mid))
 q("INSERT INTO workhub.timetable_basis_revisions(id,school_id,term_id,revision,source_fingerprint,basis,prep_draft_id,prep_draft_revision,created_by_membership_id,request_key) SELECT 'tr2-legacy-basis',school_id,term_id,999,source_fingerprint,basis||jsonb_build_object('id','tr2-legacy-basis','revision',999),'tr2-legacy-prep',1,created_by_membership_id,'tr2-legacy' FROM workhub.timetable_basis_revisions WHERE roster_source_id IS NOT NULL LIMIT 1")
 # SQL fixture만 복사: 기존 교시시각을 하루 뒤 저녁으로 옮겨 현재 기본표와 충돌하지 않게 한다.
 q("INSERT INTO workhub.timetable_lessons SELECT (jsonb_populate_record(NULL::workhub.timetable_lessons,to_jsonb(t)||jsonb_build_object('id','tr2-legacy-unrelated','basis_id','tr2-legacy-basis','activity_id','legacy-other','starts_at',t.starts_at+interval '8 hours','ends_at',t.ends_at+interval '8 hours','pinned',false,'state','scheduled','changed_by','publish'))).* FROM workhub.timetable_lessons t WHERE publication_id=%s AND state='scheduled' LIMIT 1",(r['publicationId'],))
 legacy=q("SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id='tr2-legacy-unrelated'")
 H.check('범위 안 다른 T1 계보의 수업 자동 취소 없음',not any(x['after']['id']=='tr2-legacy-unrelated' for x in preview()['changes']))
 H.check('다른 T1 계보 원문 보존',legacy==q("SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id='tr2-legacy-unrelated'"))
 # 다음 주에 교사/학급이 같은 기존 시험 수업을 배치하면 덮어쓰지 않고 차단한다.
 q("INSERT INTO workhub.timetable_lessons SELECT (jsonb_populate_record(NULL::workhub.timetable_lessons,to_jsonb(t)||jsonb_build_object('id','tr2-legacy-conflict','basis_id','tr2-legacy-basis','activity_id','legacy-conflict','occurrence_date',t.occurrence_date+7,'starts_at',t.starts_at+interval '7 days','ends_at',t.ends_at+interval '7 days','pinned',false,'state','scheduled','changed_by','publish'))).* FROM workhub.timetable_lessons t WHERE publication_id=%s AND state='scheduled' LIMIT 1",(r['publicationId'],))
 blocked=preview(next_i)
 H.check('기존 T1 시험수업과 중복은 충돌 미리보기',any(x['code']=='RESOURCE_CONFLICT' for x in blocked['blockers']))
 H.check('충돌 미리보기는 확정 거절·기존 수업 불변',expect(lambda:rpc('commit',mid,command(blocked),'tr2-blocked-confirm',False),'CONFLICT'))
 q("UPDATE workhub.timetable_lessons SET starts_at=starts_at+interval '8 hours',ends_at=ends_at+interval '8 hours' WHERE id='tr2-legacy-conflict'")
 n=preview(next_i);nc=command(n);old=I.preserve(['workhub.timetable_prep_drafts','workhub.timetable_prep_draft_revisions','workhub.terms']);old_rows=q("SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id LIKE 'tr2-legacy-%' ORDER BY id")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:value('commit',nc,'tr2-parallel-one',False),range(2)))
 H.check('동시 원번호 발행은 같은 접수증·1개 공개',results[0]==results[1] and q("SELECT count(*) FROM workhub.timetable_publications WHERE request_key='tr2-parallel-one'")[0][0]==1)
 H.check('추가 기간 발행 후 이전·범위 밖·T1 시험자료와 준비입력 보존',old==I.preserve(['workhub.timetable_prep_drafts','workhub.timetable_prep_draft_revisions','workhub.terms']) and old_rows==q("SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id LIKE 'tr2-legacy-%' ORDER BY id") and pinned==q('SELECT to_jsonb(t) FROM workhub.timetable_lessons t WHERE id=ANY(%s) ORDER BY id',([x[0] for x in ids],)))
 for role in ['anon','authenticated','service_role']:
  H.check(role+' 원본·미리보기·원장 직접 접근 차단',all(not q("SELECT has_table_privilege(%s,%s,'SELECT,INSERT,UPDATE,DELETE')",(role,'timetable_roster_bridge.'+table))[0][0] for table in ['sources','previews','requests']))
 target=H.WORK/'tr2-app-captures.json';target.write_text(json.dumps(CAPTURES,ensure_ascii=False),encoding='utf-8');subprocess.run(['node',str(HERE/'test/app_contract.mjs'),str(target)],cwd=ROOT,check=True)
 H.check('실제 SQL 응답과 앱 parser 대조',True)
 print('TR2_OPERATIONAL_CASES_DONE',flush=True)
