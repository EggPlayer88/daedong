"""새 localhost PG17에서 전체 설치 + 일반 교사 한 명의 메시지/첨부 경계를 검증한다."""
from pathlib import Path
import json,os,sys,datetime,subprocess
ROOT=Path(__file__).resolve().parents[4]; HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'database/workhub-storage-download/s3/test'))
import run_s3 as S3
from build_mp1 import build,changes
from build_checks import save_or_check
I=S3.I;H=I.H

def tests():
 S3.tests()
 import gen_int_05 as G
 def snap():return {(k,key):a for k,key,a,_ in I.run(G.g.gm.CATALOG_SQL)}
 before=snap(); protected=I.preserve(['auth.users','public.users','workhub.accounts','workhub.memberships','workhub.membership_roles','storage.objects','workhub.module_activations'])
 gates=I.run("select proname,prosrc,proacl from pg_proc where proname in ('legacy_gate','member_actor','p2_member_reachable') order by proname")
 patch=build();H.check('MP1 생성 파일 일치',(HERE/'MP1-01_메신저시험_모델과함수.sql').read_text(encoding='utf-8')==patch)
 I.run(patch)
 after=snap();delta=[[k,key,after.get((k,key))] for k,key in sorted(set(before)|set(after)) if before.get((k,key))!=after.get((k,key))]
 manifest=save_or_check(delta,G.g.gm.CATALOG_SQL,os.environ.get('MP1_WRITE_CHECKS')=='1')
 post=(HERE/'MP1-02_사후점검.sql').read_text(encoding='utf-8')
 H.check('MP1-02 7행 정상',len(I.run(post))==7 and all(r[2]!='FAIL' for r in I.run(post)))
 H.check('설치 시 회원·역할·소속·기존 자료·활성화 보존',I.preserve(list(protected))==protected)
 H.check('공통 업무실·P2 권한 게이트 원문·ACL 보존',gates==I.run("select proname,prosrc,proacl from pg_proc where proname in ('legacy_gate','member_actor','p2_member_reachable') order by proname"))
 H.check('설치 기본 허용 0명',I.run('select count(*) from workhub.messaging_pilot_grants')[0][0]==0)
 rows=I.run(manifest);H.check('INT-09 전체 18행 FAIL 0',len(rows)==18 and all(r[2]!='FAIL' for r in rows))
 os.environ['P3_APP_SRC']=str(ROOT);sys.path.insert(0,str(ROOT/'database/workhub/p3/test'))
 import run_p3 as P
 school,admin_member=I.run('select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(P.U1,))[0]
 for uid in ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000902'):
  I.run("insert into auth.users(id,email,raw_user_meta_data) values(%s,%s,'{\"full_name\":\"합성 일반 교사\"}')",(uid,uid+'@example.invalid'),user='supabase_admin')
  I.run("update public.users set role='teacher',is_active=true where id=%s",(uid,))
  I.run("insert into workhub.accounts(id,auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,email,legacy_approval_state) select 'mp1-acc-'||right(id,3),id::uuid,id,'same_auth_user',now(),name,email,'approved' from public.users where id=%s",(uid,))
  I.run("insert into workhub.memberships(id,school_id,account_id,status,employment_type,valid_from,decided_at) values(%s,%s,%s,'active','teacher',current_date-1,now())",('mp1-m-'+uid[-3:],school,'mp1-acc-'+uid[-3:]))
 uid='00000000-0000-0000-0000-000000000901'; mid='mp1-m-901';other='00000000-0000-0000-0000-000000000902'
 adm=P.P(P.U1,admin_member);teacher=P.P(uid,mid);outsider=P.P(other,'mp1-m-902')
 def selfrpc(fn,who=uid):return I.rpc(fn,uid=who)
 H.check('허용 전 일반 교사 RPC 거부',not selfrpc('workhub_messaging_pilot_access')['allowed'] and P.ecode(teacher.readiness())=='FORBIDDEN')
 expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).isoformat()
 enable=(HERE/'MP1-03_시험계정한명_허용양식.sql').read_text(encoding='utf-8').replace('p_user_id uuid:=NULL',f"p_user_id uuid:='{uid}'").replace('p_admin_user_id uuid:=NULL',f"p_admin_user_id uuid:='{P.U1}'").replace('<시험 계정 소속 ID>',mid).replace('<학교 ID>',school).replace('p_expires_at timestamptz:=NULL',f"p_expires_at timestamptz:='{expiry}'").replace('<승인 일시와 근거>','격리 시험 · 운영 아님')
 I.run(enable)
 access=selfrpc('workhub_messaging_pilot_access');context=selfrpc('workhub_messaging_pilot_context')
 H.check('허용 후 teacher 유지·본인 소속 하나만 제공',access['allowed'] and context['memberships'][0]['id']==mid and len(context['memberships'])==1 and I.run('select role from public.users where id=%s',(uid,))[0][0]=='teacher')
 H.check('명단 밖 교사 self 조회는 개인정보 없이 거절',selfrpc('workhub_messaging_pilot_access',other)==dict(contract='messaging.pilot.v1',userId=other,allowed=False) and P.ecode(outsider.readiness())=='FORBIDDEN')
 for fn,args in [('workhub_context',()),('workhub_school_roster_get',(mid,)),('workhub_message_threads',(admin_member,'',False,None))]:
  try:I.rpc(fn,*args,uid=uid);denied=False
  except Exception as e:denied=any(c in str(e) for c in ['FORBIDDEN','INACTIVE_MEMBERSHIP'])
  H.check('일반 업무실·학교관리·남의 소속 우회 거부 '+fn,denied)
 for name,values in [('P3-04_메신저활성화_양식.sql',dict(approver_user_id=P.U1,approval_ref='격리 메신저 시험',body_characters=5000,title_characters=100,recipients=100)),('P3-05_메시지HWPX활성화_양식.sql',dict(approver_user_id=P.U1,approval_ref='격리 파일 시험',max_file_bytes=20971520,max_files=5,verification_ref='격리 Python SQL 응답 · 운영 아님'))]:
  # 파일명은 확정 폴더에서 접두사로 찾는다.
  file=next((ROOT/'database/workhub/p3').glob(name[:5]+'_*.sql'));I.run(P.fill_json(str(file),values))
 H.check('교사 메시지·첨부 준비 상태',P.data(teacher.readiness())['available'] and P.data(teacher.file_readiness())['available'])
 H.check('관리자 수신 목록에 한 명 포함·일반 다른 교사 제외',mid in [r['memberId'] for r in P.data(adm.recipients())['items']] and 'mp1-m-902' not in [r['memberId'] for r in P.data(adm.recipients())['items']])
 raw=P.hwpx('합성 교사 메시지 원본');upload=P.send_file(teacher,'시험.hwpx',raw)
 H.check('교사 prepare·Storage INSERT·complete·실제 Python 기본 검사',upload['put']=='OK' and P.data(upload['check'])['state']=='ready')
 command=P.start('direct',[P.rv(teacher,admin_member)],body='일반 교사 시험',files=[upload['id']]);key=P.key()
 sent=teacher.mutate(command,key);receipt=P.data(sent);assert receipt,sent
 H.check('같은 요청 번호 재전송 이중 전송 없음',teacher.mutate(command,key,True)==sent)
 tid=receipt['deliveries'][0]['threadId']
 got=P.data(adm.get(tid))
 message=got['items'][0]
 read=adm.mutate(dict(kind='read_thread',threadId=tid,throughSequence=message['sequence']))
 H.check('관리자 열람·읽음 확인',P.ok(read))
 H.check('수신자 첨부 접근 RPC',P.data(adm.access(tid,message['id'],upload['id'])) is not None)
 for who in (P.U1,uid):
  for op in ('object.get_authenticated','object.get_authenticated_info','storage.object.get_authenticated_info'):
   H.check('참여자 Storage 본문·정보 '+who[-3:]+op,P.can_read(who,upload['path'],op))
 for who,op in [(other,'object.get_authenticated_info'),(P.T[27],'object.get_authenticated_info'),(None,'object.get_authenticated'),(uid,'object.sign'),(uid,'object.list'),(uid,'object.get_public')]:
  H.check('타인·타학교·익명·공개/서명 우회 거부 '+str(who)+op,not P.can_read(who,upload['path'],op))
 H.check('첨부 원본 바이트 동일',P.STORE[upload['path']]==raw)
 # 반대 방향: 관리자의 기존 업로드와 일반 교사의 수신·읽음·다운로드도 유지한다.
 admin_raw=P.hwpx('관리자 회신 원본');admin_file=P.send_file(adm,'답장.hwpx',admin_raw)
 replied=adm.mutate(P.reply(got['thread'],admin_member,files=[admin_file['id']]))
 H.check('관리자 HWPX 첨부 회신',P.data(admin_file['check'])['state']=='ready' and P.ok(replied))
 received=P.data(teacher.get(tid));latest=received['items'][-1]
 H.check('교사 수신·읽음',latest['senderMemberId']==admin_member and P.ok(teacher.mutate(dict(kind='read_thread',threadId=tid,throughSequence=latest['sequence']))))
 H.check('교사 수신 첨부 접근·정보·본문·바이트',P.data(teacher.access(tid,latest['id'],admin_file['id'])) is not None and P.can_read(uid,admin_file['path'],'object.get_authenticated_info') and P.can_read(uid,admin_file['path']) and P.STORE[admin_file['path']]==admin_raw)
 stranger=P.P(P.T[21],P.M[21]);H.check('같은 학교 비참여 관리자도 대화 거부',P.ecode(stranger.get(tid))=='NOT_FOUND');stranger.c.close()
 one=I.preserve(['workhub.messaging_pilot_grants','workhub.audit_events'])
 try:I.run(enable.replace(uid,other).replace(mid,'mp1-m-902'));denied=False
 except Exception as e:denied='한 명만 허용' in str(e)
 H.check('두 번째 교사 활성화 거부·원래 허용과 감사 보존',denied and I.preserve(list(one))==one)
 H.check('교사에게 내부 함수·명단 표 API 권한 없음',I.run("select not has_table_privilege('authenticated','workhub.messaging_pilot_grants','SELECT') and not has_function_privilege('authenticated','workhub_private.mp1_allowed(text,text)','EXECUTE')")[0][0])
 capture=H.WORK/'mp1.json';capture.write_text(json.dumps(dict(access=access,context=context,profile=dict(id=uid,name='합성 교사',email='synthetic@example.invalid',role='teacher',is_active=True,extra_permissions=[]),memberId=mid,schoolId=school,readiness=teacher.readiness(),recipients=teacher.recipients(),threads=teacher.threads(),thread=teacher.get(tid),fileReadiness=teacher.file_readiness()),ensure_ascii=False),encoding='utf-8')
 app=subprocess.run(['node',str(HERE/'test/app_contract.mjs'),str(capture)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
 print(app.stdout,flush=True)
 if app.returncode:print(app.stderr,flush=True)
 H.check('실제 SQL·일반 교사 앱 parser 대조',app.returncode==0)
 for label,change,undo in [
  ('만료',"update workhub.messaging_pilot_grants set expires_at=now()-interval '1 minute'",enable),
  ('소속 중지',"update workhub.memberships set status='suspended' where id='mp1-m-901'","update workhub.memberships set status='active' where id='mp1-m-901'"),
  ('가입 승인 취소',"update public.users set is_active=false where id='"+uid+"'","update public.users set is_active=true where id='"+uid+"'"),
  ('계정 중지',"update workhub.accounts set status='suspended' where id='mp1-acc-901'","update workhub.accounts set status='active' where id='mp1-acc-901'"),
 ]:
  I.run(change);H.check(label+'이면 화면·RPC·Storage 접근 차단',not selfrpc('workhub_messaging_pilot_access')['allowed'] and P.ecode(teacher.threads())=='FORBIDDEN' and not P.can_read(uid,upload['path'],'object.get_authenticated_info'));I.run(undo)
 stop=(HERE/'MP1-80_시험허용_중지.sql').read_text(encoding='utf-8').replace('p_user_id uuid:=NULL',f"p_user_id uuid:='{uid}'").replace('<중지 일시와 사유>','시험 종료')
 I.run(stop);H.check('명시 중지 후 교사 차단·관리자 기존 메시지 보존',not selfrpc('workhub_messaging_pilot_access')['allowed'] and P.ecode(teacher.threads())=='FORBIDDEN' and P.data(adm.get(tid)) is not None)
 I.run(enable)
 for label,sql,undo in [('RLS 끄기','alter table workhub.messaging_pilot_grants disable row level security','alter table workhub.messaging_pilot_grants enable row level security'),('API 표 권한','grant select on workhub.messaging_pilot_grants to authenticated','revoke select on workhub.messaging_pilot_grants from authenticated'),('내부 실행 권한','grant execute on function workhub_private.mp1_allowed(text,text) to authenticated','revoke execute on function workhub_private.mp1_allowed(text,text) from authenticated')]:
  I.run(sql);H.check('국소·INT-09 훼손 탐지 '+label,any(r[2]=='FAIL' for r in I.run(manifest)) and any(r[2]=='FAIL' for r in I.run(post)));I.run(undo)
 H.check('최종 INT-09 FAIL 0',all(r[2]!='FAIL' for r in I.run(manifest)))
 for person in (adm,teacher,outsider):person.c.close()

H.tests=tests
if __name__=='__main__':H.main()
