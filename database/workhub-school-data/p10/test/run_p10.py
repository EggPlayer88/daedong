"""P10 격리 PostgreSQL 17 회귀. 외부 DSN을 받지 않는다."""
from pathlib import Path
import os,sys,json,datetime,concurrent.futures
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'database/workhub-school-data/p9/test'))
os.environ.setdefault('P9_TEST_PORT','55549')
import run_p9 as b
import gen_p9_05 as gen
P10=Path(__file__).resolve().parents[1]
CAP=[]
original_connect=b.connect
b.connect=lambda user='postgres',db='p9_manifest':original_connect(user,db)
q=b.q
# b.q의 기본 db는 r0이므로 명시적으로 검증 전용 DB에 보낸다.
def q(s,a=None,user='postgres'):return b.q(s,a,user,db='p9_manifest')
def count(s):return q(s)[0][0]
def rpc(n,args=(),uid=b.ADMIN):
 with original_connect(db='p9_manifest') as c:
  with c.cursor() as cur:
   cur.execute('set role authenticated');cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(uid,));cur.execute('select public.'+n+'('+','.join(['%s']*len(args))+')',args);return cur.fetchone()[0]
def file(p):return q(Path(p).read_text(encoding='utf-8'))
def err(s,args=None):
 try:q(s,args)
 except Exception as e:return str(e)
 return ''
def ctxerr(s,args=()):
 try:
  with original_connect(db='p9_manifest') as c:
   with c.cursor() as cur:
    cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(b.ADMIN,));cur.execute(s,args)
 except Exception as e:return str(e)
 return ''
def tests():
 gen.g.build()
 school,member=q('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(b.ADMIN,))[0]
 before=q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]
 for n in ('01','02'):file(next(P10.glob('P10-'+n+'_*.sql')))
 b.check('P10 표 RLS 및 API 권한 없음',count("select count(*) from pg_class where relnamespace='workhub'::regnamespace and relname like 'school_data_%' and relkind='r' and relrowsecurity")==4 and count("select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='workhub' and table_name like 'school_data_%'")==0)
 get=lambda cid=None:rpc('workhub_school_data_get',(member,cid))
 b.check('기본 비활성 빈 화면',get()['data']['reason']=='not_configured')
 CAP.append({'kind':'get','raw':get(),'schoolId':school,'memberId':member})
 q("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,'teaching','active',%s,'P10 시험 승인')",(school,member))
 q("insert into workhub.teaching_policies(school_id,counseling_scope,approved_by_membership_id,approval_ref) values(%s,'off',%s,'P10 시험 승인')",(school,member))
 q("insert into workhub.school_data_policies(school_id,active,approved_by,approval_ref) values(%s,true,%s,'P10 시험 승인')",(school,member))
 year=q("select extract(year from current_date)::integer+1")[0][0];vf=f'{year}-03-01';vt=f'{year}-09-01'
 q("insert into workhub.academic_years(id,school_id,school_year,starts_on,ends_on,state) values('p10-y',%s,%s,%s,%s,'planning')",(school,year,vf,f'{year+1}-03-01'))
 q("insert into workhub.terms(id,school_id,academic_year_id,term_no,label,starts_on,ends_on,state) values('p10-t',%s,'p10-y',1,'시험 1학기',%s,%s,'planning')",(school,vf,vt))
 q("insert into workhub.year_subjects(id,school_id,academic_year_id,name,sort_order) values('p10-sub',%s,'p10-y','국어',1)",(school,))
 for cid in ['c1','c2','c3']:
  q("insert into workhub.courses(id,school_id,academic_year_id,term_id,subject_id,label,valid_from,valid_to,created_by_membership_id) values(%s,%s,'p10-y','p10-t','p10-sub',%s,%s,%s,%s)",(cid,school,cid,vf,vt,member))
  q("insert into workhub.course_assignments(school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id) select %s,%s,id,account_id,%s,%s,%s from workhub.memberships where id=%s",(school,cid,vf,vt,member,member))
 q("insert into workhub.students(id,school_id,school_student_key,name,created_by_membership_id) values('s1',%s,'student-1','학생 갑',%s)",(school,member))
 q("insert into workhub.student_enrollments(id,school_id,student_id,academic_year_id,grade,class_label,seat_number,valid_from,valid_to,created_by_membership_id) values('e1',%s,'s1','p10-y',1,'1',1,%s,%s,%s)",(school,vf,f'{year+1}-03-01',member))
 q("insert into workhub.course_memberships(id,school_id,course_id,student_id,enrollment_id,valid_from,valid_to,created_by_membership_id) values('cm1',%s,'c1','s1','e1',%s,%s,%s)",(school,vf,vt,member))
 def intent(kind='course_correct',entity='c1',changes=None,course='c1'):
  ek='course' if kind.startswith('course_') else 'student' if kind.startswith('student_') else 'enrollment'
  v=q('select workhub_private.p10_version(%s,%s,%s)',(school,ek,entity))[0][0]
  return dict(kind=kind,courseId=course,entityId=entity,expectedVersion=v,changes=changes if changes is not None else dict(label='정정된 국어',validFrom=vf,validThrough=(datetime.date.fromisoformat(vt)-datetime.timedelta(days=1)).isoformat()),reason='학교 자료 정정 근거')
 def preview(i):return rpc('workhub_school_data_preview',(member,json.dumps(i,ensure_ascii=False)))
 def command(p):return {k:p[k] for k in ['previewId','fingerprint','intent']}
 def commit(c,k):return rpc('workhub_school_data_commit',(member,json.dumps(c,ensure_ascii=False),k))
 def close(c,k):return rpc('workhub_school_data_close',(member,json.dumps(c,ensure_ascii=False),k))
 for bad in [None,[],{},dict(intent(),changes={}),dict(intent(),expectedVersion=0),dict(intent(),reason='\u0085'),dict(intent(),changes=dict(intent()['changes'],label='😀'*61))]:b.check('잘못된 입력 거부',preview(bad).get('error',{}).get('code')=='INVALID_INPUT')
 i=intent();p=preview(i)['data'];b.check('수업 이름 정정 영향 미리보기',p['allowed'] and p['impact']['assignments']==1 and p['impact']['courseMemberships']==1)
 CAP.append({'kind':'preview','raw':{'contract':'school-data-maintenance.v1','schoolId':school,'memberId':member,'data':p},'intent':i,'schoolId':school,'memberId':member})
 c=command(p);r=commit(c,'correct-course-01');b.check('수업 같은 ID 정정과 다음 판',r.get('data',{}).get('version')==2 and q("select label from workhub.courses where id='c1'")[0][0]=='정정된 국어')
 CAP.append({'kind':'receipt','raw':r,'command':c,'key':'correct-course-01','schoolId':school,'memberId':member})
 b.check('원래 번호 재전송 동일 결과',commit(c,'correct-course-01')==r)
 CAP.append({'kind':'close','raw':close(c,'correct-course-01'),'command':c,'key':'correct-course-01','schoolId':school,'memberId':member})
 b.check('적용된 번호 닫기 원접수증',close(c,'correct-course-01')['data']['receipt']==r['data'])
 b.check('같은 키 다른 내용 거부',commit(dict(c,intent=dict(i,reason='다른 이유')),'correct-course-01')['error']['code']=='IDEMPOTENCY_CONFLICT')
 b.check('직접 학생 수정은 원장 없으면 거부','CONFLICT' in err("update workhub.students set name='위조' where id='s1'"))
 b.check('직접 수업 이름 수정 거부','CONFLICT' in err("update workhub.courses set label='위조' where id='c1'"))
 for kind,entity,ch in [('student_correct','s1',dict(name='학생 이름 정정',schoolStudentKey='student-1-fixed')),('enrollment_correct','e1',dict(grade=1,classLabel='2',seatNumber=3))]:
  i=intent(kind,entity,ch);p=preview(i)['data'];b.check(kind+' 미리보기',p['allowed']);r=commit(command(p),'correct-'+entity+'-01');b.check(kind+' 적용',r.get('data',{}).get('version')==2)
  CAP.append({'kind':'preview','raw':{'contract':'school-data-maintenance.v1','schoolId':school,'memberId':member,'data':p},'intent':i,'schoolId':school,'memberId':member})
 i=intent('course_archive','c1',{});p=preview(i)['data'];c=command(p);r=commit(c,'archive-course-01');b.check('수업 보관',r.get('data',{}).get('version')==3)
 b.check('보관 수업 P5 기존 쓰기 경로 거부','CONFLICT' in ctxerr("select workhub_private.p5_course_get(workhub_private.member_actor(%s,false),'c1','update')",(member,)))
 b.check('보관 수업 과거 원행 보존',count("select count(*) from workhub.courses where id='c1'")==1 and count("select count(*) from workhub.course_memberships where course_id='c1'")==1)
 i=intent('course_restore','c1',{});p=preview(i)['data'];b.check('보관 복원 가능',p['allowed']);b.check('보관 복원 적용',commit(command(p),'restore-course-01').get('data',{}).get('version')==4)
 i=intent('student_void','s1',{});p=preview(i)['data'];b.check('내용 없는 학생 등록 취소 가능',p['allowed']);b.check('학생 취소 ID 보존',commit(command(p),'void-student-01').get('data',{}).get('version')==3 and count("select count(*) from workhub.students where id='s1'")==1)
 b.check('취소 학생 재등록 연결 차단','CONFLICT' in err("insert into workhub.course_memberships(school_id,course_id,student_id,enrollment_id,valid_from,valid_to,created_by_membership_id) values(%s,'c2','s1','e1',%s,%s,%s)",(school,vf,vt,member)))
 i=intent('course_cancel','c2',{},'c2');p=preview(i)['data'];b.check('비공개 수업 등록 취소 허용',p['allowed']);b.check('수업 취소 적용',commit(command(p),'cancel-course-02').get('data',{}).get('version')==2)
 b.check('취소 수업 복원 오인 차단','ALREADY_CLOSED' in preview(intent('course_restore','c2',{},'c2'))['data']['blockers'])
 i=intent('course_correct','c3',dict(label='세 번째 수정',validFrom=vf,validThrough=(datetime.date.fromisoformat(vt)-datetime.timedelta(days=1)).isoformat()),'c3');p=preview(i)['data'];c=command(p)
 # 원래 정책을 꺼도 본인 요청 닫기와 기존 접수증 조회는 유지한다.
 q('update workhub.school_data_policies set active=false');closed=close(c,'closed-request-03');b.check('정책 중지 뒤 명시 닫기',closed['data']['outcome']=='closed');b.check('닫기 뒤 늦은 적용 거부',commit(c,'closed-request-03')['error']['code']=='CONFLICT');b.check('닫기 재조회 동일 결과',close(c,'closed-request-03')==closed)
 CAP.append({'kind':'close','raw':closed,'command':c,'key':'closed-request-03','schoolId':school,'memberId':member})
 q('update workhub.school_data_policies set active=true')
 # 취소 학생의 같은 ID 복원. 과거 관계와 번호를 그대로 유지한다.
 i=intent('student_restore','s1',{});p=preview(i)['data'];b.check('등록 취소 학생 원래 ID 복원 허용',p['allowed']);b.check('학생 원래 ID 복원',commit(command(p),'restore-student-01')['data']['version']==4)
 CAP.append({'kind':'preview','raw':{'contract':'school-data-maintenance.v1','schoolId':school,'memberId':member,'data':p},'intent':i,'schoolId':school,'memberId':member})
 # 실제 기존 회원을 P9로 연결한 후보만 미래 학기 전체 담당으로 정정한다.
 q("insert into workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) values(%s,%s,'P10 합성 승인','active')",(school,member))
 q("insert into workhub.school_roster_policies(school_id,active,allowed_user_ids,approved_by_membership_id,approval_ref) values(%s,true,%s::uuid[],%s,'P10 합성 승인')",(school,[b.TEACHER],member))
 ri={'expectedVersion':1,'targetUserIds':[b.TEACHER],'startsOn':q('select current_date::text')[0][0],'lastDay':None,'reason':'P10 시험 후보 연결'}
 rp=rpc('workhub_school_roster_preview',(member,json.dumps(ri)))['data'];rc={k:rp[k] for k in ['previewId','fingerprint','intent']}
 linked=rpc('workhub_school_roster_commit',(member,json.dumps(rc),'p10-roster-teacher'))['data']['items'][0]['memberId']
 i=intent('course_teacher_correct','c3',{'teacherMemberIds':[linked]},'c3');p=preview(i)['data'];b.check('기존 가입 교사 미래 전체기간 담당 정정 허용',p['allowed']);rr=commit(command(p),'future-teacher-01');b.check('미래 전체기간 담당 교체 원자적 반영',rr.get('data',{}).get('version')==2)
 b.check('이전 담당 행 보존하고 시작 전 종료 사건',q("select count(*) from workhub.course_assignments a where course_id='c3' and membership_id=%s and valid_from=workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)",(member,))[0][0]==1)
 b.check('새 담당 전체 학기 기간 일치',q("select valid_from::text,valid_to::text from workhub.course_assignments where course_id='c3' and membership_id=%s",(linked,))[0]==(vf,vt))
 CAP.append({'kind':'preview','raw':{'contract':'school-data-maintenance.v1','schoolId':school,'memberId':member,'data':p},'intent':i,'schoolId':school,'memberId':member})
 i=intent('course_teacher_correct','c3',{'teacherMemberIds':[member]},'c3');p=preview(i)['data'];b.check('취소된 이전 담당자로 되돌리기 허용',p['allowed']);b.check('원행 삭제 없이 이전 담당 새 배정',commit(command(p),'future-teacher-back')['data']['version']==3)
 b.check('살아 있는 동일 교사 중복 배정 차단','CONFLICT' in err("insert into workhub.course_assignments(school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id) select school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id from workhub.course_assignments where course_id='c3' and membership_id=%s and valid_from<workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)",(member,)))
 b.check('다른 사람 소속으로 관리 조회 거부',''!=ctxerr('select public.workhub_school_data_get(%s,null)',(linked,)))
 # 현재 메뉴 게이트는 교사에게 그대로 유지된다. 후보 연결로 입장 권한을 넓히지 않는다.
 b.check('신규 교사 연결로 기존 메뉴 자격 확대 없음',q('select workhub_private.p2_member_reachable(%s,%s)',(school,linked))[0][0]==False)
 # 실제 P5 원장 부모에 내용이 생긴 뒤 등록 취소·계획 담당 정정은 거부한다.
 q("insert into workhub.rubrics(id,school_id,course_id,owner_account_id,owner_membership_id) select 'rb1',%s,'c1',account_id,id from workhub.memberships where id=%s",(school,member))
 b.check('기록이 있는 수업 등록 취소 거부','HAS_CONTENT' in preview(intent('course_cancel','c1',{}))['data']['blockers'])
 b.check('기록이 있는 미래 담당 정정 거부','HAS_CONTENT' in preview(intent('course_teacher_correct','c1',{'teacherMemberIds':[linked]}))['data']['blockers'])
 p=preview(intent('course_archive','c1',{}))['data'];b.check('기록을 남긴 수업 보관 적용',bool(commit(command(p),'archive-content-01').get('data')))
 b.check('보관 뒤 기존 평가 기준 쓰기 차단','CONFLICT' in err("update workhub.rubrics set version=version+1 where id='rb1'"))
 b.check('보관 뒤 원래 평가 기준 원행 보존',count("select count(*) from workhub.rubrics where id='rb1'")==1)
 source=q("select workhub_private.t1_build(%s,'p10-t',current_date)",(school,))[0][0]
 b.check('시간표 준비 원천에서 보관·취소 수업 제외',sorted(c['id'] for c in source['courses'])==['c3'])
 # 원래 명령이 오래 걸린 뒤 만료되어도 닫기 장벽으로 안전하게 끝낸다.
 i=intent('course_correct','c3',dict(label='동시 처리',validFrom=vf,validThrough=(datetime.date.fromisoformat(vt)-datetime.timedelta(days=1)).isoformat()),'c3');p=preview(i)['data'];c=command(p)
 exp=q("insert into workhub.school_data_previews(school_id,membership_id,intent,fingerprint,plan,expires_at) select school_id,membership_id,intent,fingerprint,plan,now()-interval '1 second' from workhub.school_data_previews where id=%s returning id",(p['previewId'],))[0][0];ec=dict(c,previewId=exp)
 b.check('만료 미리보기 신규 적용 거부',commit(ec,'expired-p10-01')['error']['code']=='CONFLICT');b.check('만료 요청 닫기',close(ec,'expired-p10-01')['data']['outcome']=='closed')
 p=preview(i)['data'];c=command(p)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  fs=[pool.submit(commit,c,'parallel-p10-01'),pool.submit(close,c,'parallel-p10-01')];results=[f.result() for f in fs]
 final=close(c,'parallel-p10-01')['data'];b.check('동시 적용·닫기 둘 중 하나의 최종 결과',final['outcome'] in ['closed','applied'])
 b.check('동시 요청 원장 한 건',q("select count(*) from workhub.school_data_requests where request_key='parallel-p10-01'")[0][0]==1)
 b.check('닫힌 요청은 늦게 적용되지 않음 또는 원접수증',commit(c,'parallel-p10-01').get('data')==final['receipt'] if final['outcome']=='applied' else commit(c,'parallel-p10-01')['error']['code']=='CONFLICT')
 # 미리보기 이후 상태가 바뀌면 새 번호 재작성 전에 변경을 다시 비교한다.
 i=intent('course_correct','c3',dict(label='원본 변경 후 거부',validFrom=vf,validThrough=(datetime.date.fromisoformat(vt)-datetime.timedelta(days=1)).isoformat()),'c3');p=preview(i)['data'];c=command(p);q("update workhub.courses set version=version+1 where id='c3'")
 b.check('미리보기 뒤 원본 판 변경 차단',commit(c,'stale-preview-01')['error']['code']=='CONFLICT');b.check('오래된 미리보기 요청 명시 닫기',close(c,'stale-preview-01')['data']['outcome']=='closed')
 CAP.append({'kind':'get','raw':get('c1'),'schoolId':school,'memberId':member})

 b.check('취소 수업으로 T2 새 예정 수업 작성 차단','CONFLICT' in err("insert into workhub.timetable_lessons(id,school_id,course_id,state) values('blocked-lesson',%s,'c2','scheduled')",(school,)))
 q("insert into workhub.schools(id,code,name,school_level,grade_count,status) values('other-school','other-school','다른 학교','middle',3,'active')")
 q("insert into workhub.memberships(id,school_id,account_id,status,valid_from,decided_at) select 'other-admin','other-school',account_id,'active',valid_from,now() from workhub.memberships where id=%s",(member,))
 q("insert into workhub.membership_roles(school_id,membership_id,role_code,valid_from) select 'other-school','other-admin','school_admin',valid_from from workhub.memberships where id='other-admin'")
 b.check('다른 학교 동일 원키 접수증 비노출',rpc('workhub_school_data_close',('other-admin',json.dumps(c),'stale-preview-01'))['error']['code']=='NOT_FOUND')
 q("update workhub.membership_roles set revoked_at=now(),revoke_reason='P10 권한 회수 시험' where membership_id=%s",(member,))
 b.check('현재 관리 권한 회수 시 목록 비노출',get()['data']['reason']=='forbidden')
 b.check('권한 회수 시 이전 요청 닫기도 거부',close(c,'stale-preview-01')['error']['code']=='FORBIDDEN')
 q("insert into workhub.membership_roles(school_id,membership_id,role_code,valid_from) select %s,%s,'school_admin',valid_from from workhub.memberships where id=%s",(school,member,member))
 post=next(P10.glob('P10-04_*.sql'));b.check('P10 사후 점검 9행 FAIL 0',len(file(post))==9 and all(r[2]!='FAIL' for r in file(post)))
 q('alter table workhub.students disable trigger students_immutable');b.check('사후 점검이 기존 자료 보호 꺼짐 탐지',any(r[2]=='FAIL' for r in file(post)));q('alter table workhub.students enable trigger students_immutable')
 b.check('빈 승인 양식은 실행 거부','직접 채우세요' in err(next(P10.glob('P10-03_*.sql')).read_text(encoding='utf-8')))
 activate=next(P10.glob('P10-03_*.sql')).read_text(encoding='utf-8').replace('<학교 ID>',school).replace('p_approver_user_id uuid:=NULL',"p_approver_user_id uuid:='"+b.ADMIN+"'").replace('<승인 일시와 근거>','P10 자동 시험 승인').replace('<P10 앱 배포 확인 근거>','격리 시험 앱 응답 검증').replace('p_enable boolean:=false','p_enable boolean:=true')
 q(activate);b.check('별도 승인 양식은 기능만 켜고 자료 추가하지 않음',get('c1')['data']['available'] and count('select count(*) from workhub.courses')==3)
 stop=next(P10.glob('P10-80_*.sql')).read_text(encoding='utf-8').replace('<학교 ID>',school).replace('<중지 근거>','P10 비파괴 중지 시험');q(stop)
 b.check('비파괴 중지 뒤 원자료·원장 보존',get()['data']['reason']=='not_configured' and count('select count(*) from workhub.school_data_revisions')>0)
 b.check('비파괴 중지 뒤 원키 닫기 결과 복구',close(c,'stale-preview-01')['data']['outcome']=='closed')
 q(activate)
 b.check('기존 회원 원본 보존',q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]==before)

 target=Path(os.environ.get('P10_CAPTURE',str(b.WORK/'p10-captures.json')));target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(CAP,ensure_ascii=False,indent=2),encoding='utf-8');print('P10_CAPTURE',target,flush=True)
# 원래 설정은 r0 DB를 만든다. 명시 DB 인자는 그대로 보존한다.
b.tests=tests
if __name__=='__main__':b.main()
