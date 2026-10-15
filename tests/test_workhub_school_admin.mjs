import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const api = await loadBrowserModule(`
 export * from '../apps/workhub/src/setup/school-admin-contract.ts'
 export * from '../apps/workhub/src/setup/school-admin-server.ts'
 export * from '../apps/workhub/src/setup/school-admin-edit.ts'
 export * from '../apps/workhub/src/setup/contract.ts'
 export { ContractError } from '../apps/workhub/src/contracts.ts'
 import React from 'react'
 import { renderToStaticMarkup } from 'react-dom/server'
 import { SchoolAdminPanel, SchoolAdminReview } from '../apps/workhub/src/setup/SchoolAdminPanel.tsx'
 import { SchoolConfigurationEditor } from '../apps/workhub/src/setup/SchoolConfigurationEditor.tsx'
 export const renderPanel = props => renderToStaticMarkup(<SchoolAdminPanel {...props}/>)
 export const renderReview = props => renderToStaticMarkup(<SchoolAdminReview {...props}/>)
 export const renderEditor = props => renderToStaticMarkup(<SchoolConfigurationEditor {...props}/>)
`)
const scope = {schoolId:'school-one',memberId:'member-one',userId:'user-one'}
const member = {id:scope.memberId,schoolId:scope.schoolId,userId:scope.userId,name:'검증 교사',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
function config() { return {draftId:'year-one',schoolName:'합성 중학교',schoolCode:'synthetic-middle',schoolType:'middle',gradeCount:'3',schoolYear:'2026',startsOn:'2026-03-01',lastDay:'2027-02-28',terms:[{id:'term-one',termNo:'1',name:'1학기',startsOn:'2026-03-01',lastDay:'2026-08-12'},{id:'term-two',termNo:'2',name:'2학기',startsOn:'2026-08-13',lastDay:'2027-02-28'}],departments:[{id:'dept-one',name:'교육과정부'}],classes:[{id:'class-one',grade:'1',classNo:'1',name:'1학년 1반',kind:'regular'}]} }
function snapshot() { return {version:3,asOfDate:'2026-10-16',availableYears:[2026],configuration:config(),subjects:[{id:'subject-one',name:'도덕'}],memberships:[{id:'member-one',name:'검증 교사',status:'active',startsOn:'2026-03-01',lastDay:'2027-02-28',version:1}],assignments:[{id:'assignment-one',memberId:'member-one',kind:'homeroom',targetId:'class-one',label:'1학년 1반 담임',startsOn:'2026-03-01',lastDay:'2027-02-28',status:'active',version:1}],capabilities:{configuration:true,memberships:true,assignments:true}} }
function command() { return {kind:'save_configuration',expectedVersion:3,mode:'update',configuration:config(),subjects:[{id:'subject-one',name:'도덕'}],reason:'공식 학교 자료 확인'} }
function envelope(data,override={}) { return {kind:'workhub-school-admin',schemaVersion:1,schoolId:scope.schoolId,memberId:scope.memberId,data,...override} }
function receipt(command,key) { return {requestKey:key,kind:command.kind,version:4,schoolYear:command.kind==='save_configuration'?Number(command.configuration.schoolYear):command.schoolYear,recordedAt:'2026-10-16T09:20:00+09:00'} }
function fixture(run) {
  let context = {schools:[{id:scope.schoolId,name:'합성 중학교'}],memberships:[structuredClone(member)],basisDate:'2026-10-16'}
  let identity = {userId:scope.userId,approved:true,profile:null}
  const calls=[]
  const connection={info:()=>structuredClone(context),getIdentity:async()=>structuredClone(identity),rpcVerified:async(name,args)=>{calls.push({name,args:structuredClone(args)});return run?run(name,args):envelope(name.endsWith('readiness')?{available:true}:name.endsWith('mutate')?receipt(args.p_command,args.p_request_key):snapshot())}}
  return {connection,calls,server:api.createSupabaseSchoolAdminServer(connection,{timeoutMs:30}),setContext:value=>{context=value},setIdentity:value=>{identity=value}}
}
let passed=0,failed=0
async function test(name,run) { try{await run();passed++;console.log(`  ✓ ${name}`)}catch(error){failed++;console.log(`  ✗ ${name}: ${error.stack||error.message}`)} }
const rejectsCode=(run,code)=>assert.rejects(run,error=>error.code===code)
const throwsCode=(run,code)=>assert.throws(run,error=>error.code===code)

await test('현재 학교·소속·버전이 일치하는 전체 관리 자료를 손실 없이 읽는다',()=>{
 const source=snapshot(),result=api.schoolAdminSnapshot(api.schoolAdminEnvelope(envelope(source),scope),2026)
 assert.deepEqual(result,source);result.configuration.schoolName='외부 변경';assert.notEqual(source.configuration.schoolName,result.configuration.schoolName)
})
await test('다른 학교·소속의 성공과 오류 응답을 모두 거부한다',()=>{
 for(const override of [{schoolId:'other-school'},{memberId:'other-member'},{schemaVersion:2},{kind:'other'}]) throwsCode(()=>api.schoolAdminEnvelope(envelope(snapshot(),override),scope),'INVALID_RESPONSE')
 throwsCode(()=>api.schoolAdminEnvelope({kind:'workhub-school-admin',schemaVersion:1,schoolId:'other-school',memberId:scope.memberId,error:{code:'FORBIDDEN'}},scope),'INVALID_RESPONSE')
})
await test('임의 오류 원문과 추가 필드·알 수 없는 계약은 표시하지 않는다',()=>{
 for(const value of [null,[],{...envelope({available:true}),debug:'secret'}, {...envelope({available:true}),data:undefined,error:{code:'QUERY_FAILED'}}, {kind:'workhub-school-admin',schemaVersion:1,schoolId:scope.schoolId,memberId:scope.memberId,error:{code:'FORBIDDEN',message:'secret'}}]) throwsCode(()=>api.schoolAdminEnvelope(value,scope),'INVALID_RESPONSE')
})
await test('설치 전 준비 상태는 저장 가능으로 바꾸지 않는다',()=>{
 assert.deepEqual(api.schoolAdminReadiness({available:false,reason:'not_installed'}),{available:false,reason:'not_installed'})
 for(const raw of [{available:true,reason:'ready'},{available:'true'},{available:false,reason:'unknown'},null])throwsCode(()=>api.schoolAdminReadiness(raw),'INVALID_RESPONSE')
})
await test('중·고 학년 4 이상과 같은 학년·반을 다른 이름으로 중복 등록하는 경우를 거부한다',()=>{
 for(const type of ['middle','high']) {const value=config();value.schoolType=type;value.gradeCount='4';assert(api.validateSetupDraft(value).some(issue=>issue.path==='gradeCount'))}
 const value=config();value.classes.push({...value.classes[0],id:'class-two',name:'다른 이름'});assert(api.validateSetupDraft(value).some(issue=>issue.path==='classes.1.classNo'))
})
await test('초등 6학년·특수학교 여러 과정은 지원하고 법정 학년 수를 임의 확정하지 않는다',()=>{
 for(const [schoolType,gradeCount] of [['elementary','6'],['special','12'],['other','9']]){const value=config();value.schoolType=schoolType;value.gradeCount=gradeCount;value.classes[0].grade=gradeCount;assert.deepEqual(api.validateSetupDraft(value),[])}
})
await test('조회 연도·날짜·행 중복·잘못된 권한 응답을 실패로 처리한다',()=>{
 const edits=[value=>value.version=0,value=>value.asOfDate='2026-02-30',value=>value.availableYears=[2027],value=>value.memberships.push({...value.memberships[0]}),value=>value.capabilities.configuration='true',value=>value.subjects[0].id=value.configuration.classes[0].id,value=>value.memberships[0].lastDay='2025-01-01']
 for(const edit of edits){const value=snapshot();edit(value);throwsCode(()=>api.schoolAdminSnapshot(value),'INVALID_RESPONSE')}
 throwsCode(()=>api.schoolAdminSnapshot(snapshot(),2027),'INVALID_RESPONSE')
})
await test('담당이 학교 내 실제 교사·학급·부서·교과와 연결되는지 확인한다',()=>{
 for(const edit of [value=>value.assignments[0].memberId='foreign-member',value=>value.assignments[0].targetId='foreign-class',value=>value.assignments[0].lastDay='2028-01-01',value=>value.assignments[0].kind='duty']){const value=snapshot();edit(value);throwsCode(()=>api.schoolAdminSnapshot(value),'INVALID_RESPONSE')}
 const value=snapshot();value.assignments[0]={...value.assignments[0],kind:'duty',targetId:null,label:'평가계획 수합'};assert.equal(api.schoolAdminSnapshot(value).assignments[0].kind,'duty')
})
await test('구성 명령은 날짜·버전·ID·변경 사유를 검증하며 다중 줄 사유를 보존한다',()=>{
 const value=command();value.reason=`공식 학사일정 확인
교무회의 확정`;assert.equal(api.schoolAdminCommand(value).reason,value.reason)
 for(const edit of [v=>v.expectedVersion=1.5,v=>v.reason='',v=>v.configuration.terms[1].startsOn=v.configuration.terms[0].lastDay,v=>v.subjects[0].id=v.configuration.departments[0].id,v=>v.extra_permissions=['admin']]){const input=command();edit(input);throwsCode(()=>api.schoolAdminCommand(input),'INVALID_RESPONSE')}
})
await test('담당·종료·학교 소속 명령의 필요한 필드만 허용한다',()=>{
 const duty={kind:'assign_duty',expectedVersion:3,schoolYear:2026,memberId:'member-one',assignmentKind:'homeroom',targetId:'class-one',label:'담임',startsOn:'2026-03-01',lastDay:'2027-02-28',reason:'공식 배정'}
 assert.deepEqual(api.schoolAdminCommand(duty),duty)
 for(const value of [{...duty,targetId:null},{...duty,assignmentKind:'duty'},{...duty,startsOn:'2028-01-01'},{...duty,userId:'other'}])throwsCode(()=>api.schoolAdminCommand(value),'INVALID_RESPONSE')
 const end={kind:'end_assignment',expectedVersion:3,schoolYear:2026,assignmentId:'assignment-one',lastDay:'2026-10-30',reason:'담당 이관'};assert.deepEqual(api.schoolAdminCommand(end),end)
 const membership={kind:'review_membership',expectedVersion:3,schoolYear:2026,targetMemberId:'member-one',decision:'active',startsOn:'2026-03-01',lastDay:'2027-02-28',reason:'공식 소속 확인'};assert.deepEqual(api.schoolAdminCommand(membership),membership)
 throwsCode(()=>api.schoolAdminCommand({...membership,decision:'superadmin'}),'INVALID_RESPONSE')
})
await test('접수증의 요청·명령·학년도·버전·기록 시각을 전부 확인한다',()=>{
 const cmd=command(),valid=receipt(cmd,'request-one');assert.deepEqual(api.schoolAdminReceipt(valid,cmd,'request-one'),valid)
 for(const edit of [x=>x.requestKey='other',x=>x.kind='assign_duty',x=>x.schoolYear=2027,x=>x.version=3,x=>x.recordedAt='2026-02-30T00:00:00Z',x=>x.recordedAt='yesterday']){const r={...valid};edit(r);throwsCode(()=>api.schoolAdminReceipt(r,cmd,'request-one'),'INVALID_RESPONSE')}
})
await test('어댑터는 공통 승인 확인 연결과 지정 RPC만 사용한다',async()=>{
 const f=fixture();assert.deepEqual(await f.server.readiness(member.id),{available:true});assert.equal((await f.server.get(member.id,2026)).version,3);assert.equal((await f.server.mutate(member.id,command(),'request-one')).requestKey,'request-one')
 assert.deepEqual(f.calls.map(call=>call.name),['workhub_school_admin_readiness','workhub_school_admin_get','workhub_school_admin_mutate'])
 assert(f.calls.every(call=>call.args.p_member_id===member.id));assert.equal(f.calls[1].args.p_school_year,2026)
 assert(!f.calls.some(call=>'p_user_id' in call.args||'p_school_id' in call.args))
})
await test('미등록 RPC는 준비 오류를 알리고 가짜 저장 성공을 만들지 않는다',async()=>{
 const f=fixture(()=>{throw new api.ContractError('QUERY_FAILED','secret database path')})
 await rejectsCode(()=>f.server.readiness(member.id),'QUERY_FAILED')
 await rejectsCode(()=>f.server.mutate(member.id,command(),'request-one'),'RESULT_UNKNOWN')
})
await test('활성 소속이 없는 학교와 다른 로그인 사용자로는 요청하지 않는다',async()=>{
 const f=fixture();f.setIdentity({userId:'other-user',approved:true});await rejectsCode(()=>f.server.get(member.id),'CANCELLED');assert.equal(f.calls.length,0)
 const g=fixture();g.setContext({schools:[{id:scope.schoolId}],memberships:[{...member,active:false}],basisDate:'2026-10-16'});await rejectsCode(async()=>g.server.get(member.id),'INACTIVE_MEMBERSHIP');assert.equal(g.calls.length,0)
})
await test('서버 응답 도중 계정이 바뀌면 이전 학교 자료를 표시하지 않는다',async()=>{
 let f;f=fixture(()=>{f.setIdentity({userId:'other-user',approved:true});return envelope(snapshot())});await rejectsCode(()=>f.server.get(member.id),'CANCELLED')
})
await test('응답 도중 역할·유효기간·공식 관계가 바뀌면 이전 결과를 취소한다',async()=>{
 for(const patch of [{role:'calendar_manager'},{validThrough:'2026-12-31'},{departmentIds:['changed-dept']}]){let f;f=fixture(()=>{f.setContext({schools:[{id:scope.schoolId}],memberships:[{...member,...patch}],basisDate:'2026-10-16'});return envelope(snapshot())});await rejectsCode(()=>f.server.get(member.id),'CANCELLED')}
})
await test('쓰기 후 승인 상태가 바뀌면 비변경 거절로 단정하지 않고 요청을 보존할 오류로 돌려준다',async()=>{
 let f;f=fixture((name,args)=>{f.setIdentity({userId:scope.userId,approved:false});return envelope(receipt(args.p_command,args.p_request_key))});await rejectsCode(()=>f.server.mutate(member.id,command(),'request-one'),'CANCELLED')
})
await test('쓰기 응답이 깨지거나 학교 범위가 다르면 처리 결과 미확정이다',async()=>{
 for(const run of [()=>envelope(null),()=>envelope(receipt(command(),'request-one'),{schoolId:'other-school'})]){const f=fixture(run);await rejectsCode(()=>f.server.mutate(member.id,command(),'request-one'),'RESULT_UNKNOWN')}
})
await test('서버가 확정한 충돌은 입력 유실 없이 구별할 수 있는 코드로 전달한다',async()=>{
 const f=fixture(()=>({kind:'workhub-school-admin',schemaVersion:1,schoolId:scope.schoolId,memberId:scope.memberId,error:{code:'CONFLICT'}}));await rejectsCode(()=>f.server.mutate(member.id,command(),'request-one'),'CONFLICT')
})
await test('응답 단절 후 동일 요청 번호·동일 입력으로 재전송하고 다른 입력 재사용은 막는다',async()=>{
 let first=true;const f=fixture((name,args)=>{if(first){first=false;throw Error('network interrupted')}return envelope(receipt(args.p_command,args.p_request_key))})
 const cmd=command();await rejectsCode(()=>f.server.mutate(member.id,cmd,'same-request'),'RESULT_UNKNOWN')
 assert.equal((await f.server.mutate(member.id,structuredClone(cmd),'same-request')).requestKey,'same-request')
 const changed=command();changed.configuration.schoolName='바뀐 이름';await rejectsCode(async()=>f.server.mutate(member.id,changed,'same-request'),'IDEMPOTENCY_CONFLICT')
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].args,f.calls[1].args)
})
await test('읽기 제한시간과 쓰기 제한시간 초과를 구별한다',async()=>{
 const f=fixture(()=>new Promise(()=>{}));await rejectsCode(()=>f.server.get(member.id),'QUERY_FAILED');await rejectsCode(()=>f.server.mutate(member.id,command(),'request-one'),'RESULT_UNKNOWN')
})
await test('승인 확인 제한시간 뒤 늦은 성공은 학교관리 저장을 시작하지 않는다',async()=>{
 const f=fixture();let release;f.connection.getIdentity=()=>new Promise(resolve=>{release=resolve})
 await rejectsCode(()=>f.server.mutate(member.id,command(),'late-preflight'),'QUERY_FAILED')
 release({userId:scope.userId,approved:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0)
})
await test('이미 전송한 저장의 늦은 성공은 미확정으로 남기고 원래 요청 번호로만 복구한다',async()=>{
 let release,first=true;const f=fixture((name,args)=>{const result=envelope(receipt(args.p_command,args.p_request_key));if(first){first=false;return new Promise(resolve=>{release=()=>resolve(result)})}return result})
 const cmd=command();await rejectsCode(()=>f.server.mutate(member.id,cmd,'late-write'),'RESULT_UNKNOWN')
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1)
 await rejectsCode(async()=>f.server.mutate(member.id,{...cmd,reason:'다른 입력'},'late-write'),'IDEMPOTENCY_CONFLICT')
 assert.equal((await f.server.mutate(member.id,cmd,'late-write')).requestKey,'late-write');assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].args,f.calls[1].args)
})
await test('명령·요청 번호를 검증하지 못하면 서버에 보내지 않는다',async()=>{
 const f=fixture();await rejectsCode(async()=>f.server.mutate(member.id,{...command(),expectedVersion:0},'request-one'),'INVALID_INPUT');await rejectsCode(async()=>f.server.mutate(member.id,command(),'../invalid'),'INVALID_INPUT');assert.equal(f.calls.length,0)
})
await test('서로 다른 학교 필드·같은 행의 다른 필드 변경은 양쪽을 모두 보존한다',()=>{
 const base=api.schoolConfigurationValue(snapshot()),mine=structuredClone(base),latest=structuredClone(base)
 mine.configuration.schoolName='내가 바꾼 이름';mine.configuration.classes[0].name='별빛반';latest.configuration.gradeCount='2';latest.configuration.classes[0].classNo='2';latest.subjects.push({id:'subject-two',name:'국어'})
 const merged=api.reconcileSchoolConfiguration(base,mine,latest);assert.equal(merged.unresolved.length,0);assert.equal(merged.value.configuration.schoolName,'내가 바꾼 이름');assert.equal(merged.value.configuration.gradeCount,'2');assert.equal(merged.value.configuration.classes[0].name,'별빛반');assert.equal(merged.value.configuration.classes[0].classNo,'2');assert.equal(merged.value.subjects.length,2)
})
await test('같은 칸의 상충 변경은 양쪽 값을 보여 주고 명시적 선택 후에만 해결된다',()=>{
 const base=api.schoolConfigurationValue(snapshot()),mine=structuredClone(base),latest=structuredClone(base);mine.configuration.schoolName='내 이름';latest.configuration.schoolName='다른 이름'
 const conflict=api.reconcileSchoolConfiguration(base,mine,latest);assert.equal(conflict.unresolved.length,1);assert.deepEqual(conflict.conflicts[0],{path:'schoolName',label:'학교명',original:'합성 중학교',mine:'내 이름',latest:'다른 이름'})
 const resolved=api.reconcileSchoolConfiguration(base,mine,latest,{schoolName:'latest'});assert.equal(resolved.unresolved.length,0);assert.equal(resolved.value.configuration.schoolName,'다른 이름')
})
await test('삭제와 수정이 충돌한 행을 조용히 지우지 않는다',()=>{
 const base=api.schoolConfigurationValue(snapshot()),mine=structuredClone(base),latest=structuredClone(base);mine.configuration.classes=[];latest.configuration.classes[0].name='수정한 학급'
 const merged=api.reconcileSchoolConfiguration(base,mine,latest);assert.equal(merged.unresolved[0].path,'classes.class-one');assert.equal(merged.unresolved[0].mine,null)
 const resolved=api.reconcileSchoolConfiguration(base,mine,latest,{'classes.class-one':'latest'});assert.equal(resolved.value.configuration.classes[0].name,'수정한 학급')
})
await test('서로 다른 새 행과 상대방의 변경 없는 삭제를 보존한다',()=>{
 const base=api.schoolConfigurationValue(snapshot()),mine=structuredClone(base),latest=structuredClone(base);mine.subjects.push({id:'subject-local',name:'국어'});latest.subjects.push({id:'subject-remote',name:'수학'});latest.configuration.departments=[]
 const result=api.reconcileSchoolConfiguration(base,mine,latest);assert.equal(result.unresolved.length,0);assert.deepEqual(new Set(result.value.subjects.map(x=>x.name)),new Set(['도덕','국어','수학']));assert.equal(result.value.configuration.departments.length,0)
})
await test('같은 새 행 ID 충돌과 같은 결과 수정은 다르게 처리한다',()=>{
 const base=api.schoolConfigurationValue(snapshot()),mine=structuredClone(base),latest=structuredClone(base);mine.subjects.push({id:'new-subject',name:'국어'});latest.subjects.push({id:'new-subject',name:'수학'});assert.equal(api.reconcileSchoolConfiguration(base,mine,latest).unresolved.length,1)
 latest.subjects[1].name='국어';assert.equal(api.reconcileSchoolConfiguration(base,mine,latest).unresolved.length,0)
})
await test('전체 변경 비교는 학기 날짜·학급 반 번호·교과·삭제 항목을 빠뜨리지 않는다',()=>{
 const before=api.schoolConfigurationValue(snapshot()),after=structuredClone(before);after.configuration.terms[0].lastDay='2026-08-11';after.configuration.classes[0].classNo='2';after.configuration.departments=[];after.subjects[0].name='국어'
 const changes=api.schoolConfigurationChanges(before,after);assert.equal(changes.length,4);assert(changes.some(x=>x.before.includes('2026-08-12')&&x.after.includes('2026-08-11')));assert(changes.some(x=>x.after.includes('반 번호: 2')));assert(changes.some(x=>x.after==='없음'));assert(changes.some(x=>x.before.includes('도덕')&&x.after.includes('국어')))
})
await test('변경 검토 화면은 변경 전후의 전체 값을 HTML 안전하게 보여 준다',()=>{
 const base=snapshot(),cmd=command();cmd.configuration.classes[0].name='<script>공격</script>';cmd.configuration.terms[0].lastDay='2026-08-11'
 const html=api.renderReview({command:cmd,base});assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('2026-08-12')&&html.includes('2026-08-11'));assert(html.includes('반 번호: 1'))
})
await test('소속 관리 검토는 기존·변경 기간과 상태를 함께 보여 준다',()=>{
 const cmd={kind:'review_membership',expectedVersion:3,schoolYear:2026,targetMemberId:'member-one',decision:'suspended',startsOn:'2026-03-03',lastDay:'2026-12-31',reason:'공식 소속 확인'}
 const html=api.renderReview({command:cmd,base:snapshot()});assert(html.includes('재직')&&html.includes('이용 중지'));assert(html.includes('2026-03-01')&&html.includes('2026-03-03'));assert(html.includes('2027-02-28')&&html.includes('2026-12-31'))
})
await test('구성 편집 화면은 레이블과 읽기 전용 연도·코드를 제공하고 빈 목록도 렌더된다',()=>{
 const html=api.renderEditor({value:config(),subjects:[],createYear:false,disabled:false,onChange(){}});assert(html.includes('학교명'));assert(html.includes('학기 마지막 날 (포함)'));assert(html.includes('readonly'));assert(html.includes('등록된 교과 항목이 없습니다.'))
 const disabled=api.renderEditor({value:config(),subjects:[],createYear:true,disabled:true,onChange(){}});assert(disabled.includes('disabled'))
})
await test('연결 전 화면은 서버 확인 중이며 실제 저장 완료나 학교 자료를 지어내지 않는다',()=>{
 const html=api.renderPanel({connection:fixture().connection,member,date:'2026-10-16',server:fixture().server});assert(html.includes('학교 관리 정보를 확인하고 있습니다'));assert(!html.includes('학교 구성 수정'));assert(!html.includes('반영을 확인했습니다'));assert(!html.includes('합성 중학교'))
})
console.log(`\n학교 관리 검증: ${passed} 통과, ${failed} 실패`)
if(failed) process.exit(1)
