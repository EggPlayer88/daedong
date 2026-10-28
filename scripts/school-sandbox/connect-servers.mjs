import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker,SANDBOX_REF} from './environment.mjs'

// 배포된 복제 서버만 연결한다. 키는 기존 서버 API가 암호화하며 콘솔에 쓰지 않는다.
const path=process.argv[2],root=dirname(path),config=loadSecrets(path),site='https://daedong-year-sandbox.vercel.app'
const school=JSON.parse(readFileSync(join(root,'school.json'))),people=JSON.parse(readFileSync(join(root,'accounts.json'))),admin=people.find(x=>x.role==='administrator_teacher')
const approval='2026-10-29 사용자 승인: 가상 학교 전체 기능·시험 전용 키·누적 9달러 한도',proof=site+' a183a64 실제 배포와 401 응답 확인 2026-10-29'
const c=await connectSandbox(config),results=[]
async function form(file,input,id=file){
 if((await c.query('select 1 from sandbox_private.activations where path=$1',[id])).rowCount)return
 let sql=readFileSync(file,'utf8').replaceAll('\r\n','\n')
 const re=/((?:p|i)\s+jsonb\s*:=\s*)\$(\w*)\$([\s\S]*?)\$\2\$::jsonb/,m=sql.match(re)
 if(!m)throw new Error('승인 양식 확인 필요 '+file)
 sql=sql.replace(re,(_,prefix,tag)=>prefix+'$'+tag+'$'+JSON.stringify({...JSON.parse(m[3]),...input})+'$'+tag+'$::jsonb')
 await assertMarker(c);await c.query(sql);await c.query('insert into sandbox_private.activations(path)values($1)',[id]);console.log('시험 전용 활성화',id)
}
async function service(name,args){
 assert.match(name,/^workhub_ai_school_(policy_register|control|link_legacy)$/)
 await c.query('begin');try{await c.query('set local role service_role');const x=(await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;if(x.error)throw new Error(JSON.stringify(x.error));await c.query('commit');return x}catch(e){await c.query('rollback');throw e}
}
try{await assertMarker(c)
 for(const endpoint of ['/api/collections/check-hwpx','/api/messages/check-hwpx','/api/workhub-documents/extract-knowledge','/api/workhub-documents/guided','/api/workhub-ai/settings']){
  const payload=endpoint.endsWith('/guided')?{action:'inspect',memberId:admin.memberId,templateId:'sandbox-probe-template',templateVersion:1,responseId:null,responseVersion:null,requestKey:'sandbox-probe-request'}:endpoint.endsWith('/settings')?{action:'status',memberId:admin.memberId}:{memberId:admin.memberId,fileId:'sandbox-probe-file',requestKey:'sandbox-probe-request'}
  const r=await fetch(site+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,401,endpoint);results.push({endpoint,status:r.status});console.log('배포 인증 경계 확인',endpoint,r.status)
 }
 const common={approver_user_id:admin.userId,approval_ref:approval},fileMax=20971520
 await form('database/workhub/r1s/R1S-04_학교활성화_양식.sql',{...common,deployment_ref:proof,deployment_checked_on:'2026-10-29',policies:{effective_from:'2027-03-01',common_file_safety:{extensions:['hwpx'],maxFileBytes:fileMax,maxFiles:5,allowUnscanned:false},school_file_upload:{extensions:['hwpx'],maxFileBytes:fileMax,maxFiles:5,allowUnscanned:false,uploadTtlMinutes:30},school_submission:{allowWithdrawal:true,allowCorrectionWindow:true,maxCorrectionDays:14,unattachedRetentionDays:7}}})
 await form('database/workhub/p3/P3-05_첨부활성화_양식.sql',{...common,max_file_bytes:fileMax,max_files:5,verification_ref:proof})
 for(const module of ['knowledge_import','guided'])await form('database/workhub/p4/P4-05_원문가져오기_양식활성화_양식.sql',{...common,module,max_file_bytes:fileMax,verification_ref:proof},'P4-05-'+module)
 if(!(await c.query("select 1 from workhub_private.t2_installs where batch='T2-02'")).rowCount){await c.query(readFileSync('database/workhub-timetable/t2/T2-02_알림출처_시간표.sql','utf8').replaceAll('\r\n','\n'));console.log('시험 시간표 알림 연결')}
 if(!(await c.query('select 1 from workhub.ai_memory_controls where school_id=$1',[school.schoolId])).rowCount){let sql=readFileSync('database/workhub-ai-memory/m1/M1-03_개인기억_학교승인_양식.sql','utf8').replace("admin_member_id text := ''",`admin_member_id text := '${admin.memberId}'`).replace("approval_ref text := ''",`approval_ref text := '${approval}'`).replace('requested_enabled boolean := NULL','requested_enabled boolean := true');await c.query(sql);console.log('시험 개인 기억 활성화')}
 if(!(await c.query('select 1 from workhub.ai_school_policies where school_id=$1',[school.schoolId])).rowCount){await service('workhub_ai_school_policy_register',[admin.userId,admin.memberId,approval]);console.log('학교별 AI 원정책 등록')}
 const login=await fetch(`https://${SANDBOX_REF}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.anonKey,'content-type':'application/json'},body:JSON.stringify({email:admin.email,password:admin.password})});assert.equal(login.status,200);const auth=await login.json()
 async function settings(body){const r=await fetch(site+'/api/workhub-ai/settings',{method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'content-type':'application/json'},body:JSON.stringify({memberId:admin.memberId,...body})}),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));assert.ok(!v.error);return v}
 const before=await settings({action:'status'})
 if(!before.credential.configured){const result=await settings({action:'save_key',requestKey:'sandbox-key-initial-20261029',expectedCredentialVersion:0,apiKey:readFileSync(join(root,'anthropic-key.txt'),'utf8').trim()});assert.equal(result.state,'applied');console.log('시험 전용 API 키 암호화 저장 확인')}
 // P10이 원래 두 모델 정책을 만든 이후에는 P6-04의 최초 등록 양식이 맞지 않는다.
 // 검증한 시험 관리자와 P10 정책에 한정해 모듈을 연결하며 확정 SQL/정책 판은 수정하지 않는다.
 assert.equal(before.canManage,true)
 if(!(await c.query("select 1 from workhub.module_activations where school_id=$1 and module='assistant'",[school.schoolId])).rowCount){
  await assertMarker(c);await c.query('begin')
  try{
   const policies=await c.query('select count(*)::int n from workhub.ai_school_policies where school_id=$1',[school.schoolId]);assert.equal(policies.rows[0].n,1)
   await c.query("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values($1,'assistant','active',$2,$3)",[school.schoolId,admin.memberId,approval])
   await c.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.userId])
   await c.query("select workhub_private.write_audit(workhub_private.member_actor($1,true),'module.activate','module_activation',$2,NULL,'operator_only',NULL,$3::jsonb)",[admin.memberId,school.schoolId+':assistant',JSON.stringify({module:'assistant',approvalRef:approval,verificationRef:proof,source:'sandbox P10 policy'})])
   await c.query('commit');console.log('P10 원정책으로 시험 비서 모듈 연결')
  }catch(e){await c.query('rollback');throw e}
 }
 const state=await service('workhub_ai_school_control',[admin.userId,admin.memberId,true,approval]);assert.equal(state.status,'ready')
 await service('workhub_ai_school_link_legacy',[admin.userId,admin.memberId,people.map(x=>x.userId),approval])
 await c.query('update sandbox_private.ai_limit set enabled=true where singleton')
 console.log('복제 AI 연결 완료: 누적 9달러 한도 유지, 실제 유료 호출은 아직 없음')
 writeFileSync(join(root,'server-connections.json'),JSON.stringify({at:new Date().toISOString(),site,results,aiStatus:state.status,keyVersion:state.credential.version},null,2))
}finally{await c.end()}
