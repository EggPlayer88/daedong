import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {createModuleChecker,checkModules,exportModuleChecks,ContractError,workhubModules}=await loadBrowserModule(`export * from '../apps/workhub/src/support/module-checks'; export {workhubModules} from '../apps/workhub/src/modules'; export {ContractError} from '../apps/workhub/src/contracts'`)
const member={id:'member',schoolId:'school',userId:'user',name:'비공개 이름',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
const identity={userId:'user',approved:true,profile:{id:'user',name:'비공개 이름',email:'private@example.invalid',role:'superadmin',is_active:true,department_id:null,extra_permissions:[]}}
const envelope=(contract,data)=>({contract,schoolId:'school',memberId:'member',data})
const school=data=>({kind:'workhub-school-admin',schemaVersion:1,schoolId:'school',memberId:'member',data})
const messaging=data=>({contractVersion:1,schoolId:'school',memberId:'member',userId:'user',ok:true,data})
const home={asOf:'2026-10-16T00:00:00Z',items:[],counts:{collection:0,supplement:0,message:0,student_followup:0,cooperation:0},unavailable:[]}
const collection=data=>({contractVersion:1,schoolId:'school',memberId:'member',data})
const catalogScope={schoolId:'school',memberId:'member',ownerUserId:'user'}
const normalResponses={
  calendar:[],tasks:[],school:school({available:true}),
  collections:collection({available:true,reason:'ready',policy:{extensions:['hwpx'],maxFileBytes:1024,maxFiles:3}}),
  messaging:messaging({available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'hwpx_basic_v1'}),
  cooperation:{ok:true,contractVersion:'cooperation.v1',...catalogScope,recipients:[],sourceTasks:[],nextTaskCursor:null},
  knowledge:envelope('knowledge.v1',{items:[],nextCursor:null,canManage:false}),
  documents:envelope('documents.v1',{items:[],nextCursor:null,canShare:false}),
  guided:envelope('guided.v1',{items:[],nextCursor:null,canCreate:false}),
  teaching:{contractVersion:'teaching.v1',...catalogScope,courses:[],terms:[],subjects:[],approvedTeachers:[],canManageCourses:false},
  home:envelope('home.v1',home),
  transitions:envelope('school-transitions.v1',{canManageYear:false,dutyApproval:'admin_review_v1',years:[],recipients:[],resources:[],records:[],nextCursor:null}),
  timetable:envelope('timetable.v1',{available:true}),
  timetableOperations:envelope('timetable-operations.v1',{available:true}),
  timetableInterventions:envelope('timetable-interventions.v1',{available:true,reason:null}),
  participation:{contract:'workhub.participant-admin.v1',schoolId:'school',memberId:'member',grants:[],timetableApprovers:0,interventionsReady:false},
  schoolRoster:envelope('school-roster.v1',{available:true,reason:null,version:1,asOfDate:'2026-10-16',candidates:[],teachers:[]}),
  schoolData:envelope('school-data-maintenance.v1',{available:true,reason:null,courses:[],course:null,students:[],teachers:[]}),
  memory:envelope('memory.v1',{items:[],today:'2026-10-16',canWrite:true}),
}
function fixture(respond=()=>[]){const state={context:{memberships:[structuredClone(member)],schools:[{id:'school'}],basisDate:'2026-10-16'},identity:structuredClone(identity),calls:[],get:async()=>structuredClone(state.identity)};const connection={info:()=>structuredClone(state.context),getIdentity:()=>state.get(),rpcVerified:async(name,args)=>{state.calls.push({name,args});return respond(name,args)}};return{state,connection,run:createModuleChecker(connection,'member',{timeoutMs:1000})}}
const signal=()=>new AbortController().signal
let passed=0
async function test(name,run){await run();passed++;console.log('  ✓ '+name)}
await test('구축된 19개 기능을 모두 명시적인 조회 RPC 하나로만 확인한다',async()=>{for(const item of checkModules){const f=fixture(()=>{throw new ContractError('FORBIDDEN','private@example.invalid')});const result=await f.run(item.id,signal());assert(['FORBIDDEN','CANCELLED'].includes(result.code),item.id+':'+result.code);assert.deepEqual(f.state.calls.map(call=>call.name),[item.rpc]);assert.equal(JSON.stringify(result).includes('private'),false);assert(!/mutate|prepare|download|read_thread|inspect|complete/.test(item.rpc))}})
await test('빈 일정과 업무 목록을 조회 성공으로 확인하되 저장 완료라고 하지 않는다',async()=>{const f=fixture();for(const id of ['calendar','tasks'])assert.equal((await f.run(id,signal())).code,'READ_CONFIRMED')})
await test('학교 준비 응답과 미설치·미설정·권한 제한을 구분한다',async()=>{for(const [data,code] of [[{available:true},'READY_RESPONSE'],[{available:false,reason:'not_installed'},'DATABASE_MISSING'],[{available:false,reason:'not_configured'},'NOT_CONFIGURED'],[{available:false,reason:'forbidden'},'FORBIDDEN']])assert.equal((await fixture(()=>school(data)).run('school',signal())).code,code)})
await test('메시지 준비와 첨부 준비를 합쳐 완성이라고 표시하지 않는다',async()=>{const data={available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'not_configured'};assert.equal((await fixture(()=>messaging(data)).run('messaging',signal())).code,'PARTIAL');data.attachments='hwpx_basic_v1';assert.equal((await fixture(()=>messaging(data)).run('messaging',signal())).code,'READY_RESPONSE')})
await test('홈 일부 기능 미연결은 부분 준비로 유지하고 개수·학생 자료를 보고서에 넣지 않는다',async()=>{const data=structuredClone(home);data.unavailable=['message'];data.counts.message=null;const result=await fixture(()=>envelope('home.v1',data)).run('home',signal());assert.equal(result.code,'PARTIAL');const report=exportModuleChecks([result]);assert(!report.includes('counts'));assert(!report.includes('memberId'))})
await test('홈 조회를 성공하고도 저장·전송 성공으로 확대하지 않는다',async()=>{assert.equal((await fixture(()=>envelope('home.v1',home)).run('home',signal())).code,'READ_CONFIRMED')})
await test('다른 학교의 응답은 현재 연결 확인으로 받아들이지 않는다',async()=>{const result=await fixture(()=>({...envelope('home.v1',home),schoolId:'other'})).run('home',signal());assert.equal(result.code,'INVALID_RESPONSE')})
await test('네트워크 실패나 알 수 없는 오류를 DB 미설치로 단정하지 않는다',async()=>{for(const error of [new Error('private@example.invalid'),{code:'PGRST202',message:'private@example.invalid'}]){const result=await fixture(()=>{throw error}).run('calendar',signal());assert.equal(result.code,'QUERY_FAILED');assert(!exportModuleChecks([result]).includes('private'))}})
await test('부서·역할 변경 뒤 늦은 성공 결과는 폐기한다',async()=>{let release;const f=fixture(()=>new Promise(resolve=>release=resolve));const pending=f.run('calendar',signal());while(!release)await new Promise(resolve=>setTimeout(resolve,1));f.state.context.memberships[0].departmentIds=['changed'];release([]);assert.equal((await pending).code,'CANCELLED')})
await test('이미 중지한 점검은 서버를 호출하지 않는다',async()=>{const f=fixture(),c=new AbortController();c.abort();assert.equal((await f.run('calendar',c.signal)).code,'CANCELLED');assert.equal(f.state.calls.length,0)})
await test('인증 조회 중 중지하면 늦은 인증 뒤에도 서버 조회를 시작하지 않는다',async()=>{let release;const f=fixture(()=>envelope('home.v1',home));f.state.get=()=>new Promise(resolve=>release=resolve);const c=new AbortController(),pending=f.run('home',c.signal);while(!release)await new Promise(resolve=>setTimeout(resolve,1));c.abort();assert.equal((await pending).code,'CANCELLED');release(identity);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.state.calls.length,0)})
await test('시간 초과 뒤 도착한 응답을 성공으로 돌려놓지 않는다',async()=>{let release;const f=fixture(()=>new Promise(resolve=>release=resolve));const run=createModuleChecker(f.connection,'member',{timeoutMs:10});const result=await run('calendar',signal());assert.equal(result.code,'TIMEOUT');release([]);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(result.code,'TIMEOUT');assert.equal(f.state.calls.length,1)})
await test('점검별 결과를 독립적으로 재시도하고 저장 요청을 만들지 않는다',async()=>{let fail=true;const f=fixture(()=>{if(fail)throw new Error('offline');return []});assert.equal((await f.run('calendar',signal())).code,'QUERY_FAILED');fail=false;assert.equal((await f.run('calendar',signal())).code,'READ_CONFIRMED');assert.deepEqual(f.state.calls.map(x=>x.args),[{p_member_id:'member'},{p_member_id:'member'}])})
await test('지원 JSON에서 추가 필드와 개인정보를 제거한다',()=>{const result={id:'home',code:'READ_CONFIRMED',checkedAt:'2026-10-16T00:00:00.000Z',memberId:'private-member',title:'private-title',raw:{email:'private@example.invalid'}};assert.deepEqual(JSON.parse(exportModuleChecks([result])),{format:'workhub-module-check.v1',scope:'read_only',checks:[{id:'home',code:'READ_CONFIRMED',checkedAt:result.checkedAt}]})})
await test('알 수 없는 기능·코드·날짜·중복 결과는 지원 파일에서 거부한다',()=>{const result={id:'home',code:'READ_CONFIRMED',checkedAt:'2026-10-16T00:00:00.000Z'};for(const change of [{id:'private'},{code:'private'},{checkedAt:'2026-02-31T00:00:00.000Z'},{checkedAt:'private'}])assert.throws(()=>exportModuleChecks([{...result,...change}]));assert.throws(()=>exportModuleChecks([result,result]))})
await test('AI 생성·비용·파일 검사는 호출하지 않고 각 항목은 기존 메뉴로만 연결한다',()=>{
  assert.equal(checkModules.length,19)
  assert.equal(new Set(checkModules.map(item=>item.id)).size,checkModules.length)
  assert(!checkModules.some(item=>item.rpc==='workhub_timetable_import_get'),'T4 원본 판 추적 기록은 읽기 전용 점검에서 호출하지 않는다')
  for(const item of checkModules){
    assert(workhubModules.some(module=>module.id===item.page),item.id)
    assert.doesNotMatch(item.rpc,/mutate|prepare|commit|close|inspect|cleanup|generate|assistant|select_memory|delete/)
  }
  assert.throws(()=>createModuleChecker(fixture().connection,'member',{timeoutMs:0}))
})
// 점검 함수를 흉내 내지 않고 각 기능의 실제 어댑터와 응답 파서를 통과시킨다.
for(const item of checkModules)await test(`${item.label}: 정상 계약은 실제 파서를 통과하고 조회 RPC 하나만 사용한다`,async()=>{
  const f=fixture(()=>structuredClone(normalResponses[item.id])),result=await f.run(item.id,signal())
  assert.equal(result.code,['school','collections','messaging','timetable','timetableOperations','timetableInterventions','schoolRoster','schoolData','memory'].includes(item.id)?'READY_RESPONSE':'READ_CONFIRMED',item.id)
  assert.deepEqual(f.state.calls.map(call=>call.name),[item.rpc])
  assert.equal(f.state.calls[0].args.p_member_id,'member')
  assert.deepEqual(Object.keys(result).sort(),['checkedAt','code','id'])
  assert(!/비공개|private|schoolId|memberId|ownerUserId/.test(exportModuleChecks([result])))
})
await test('수합의 DB·저장소·검사·정책 미준비 응답을 각각 구분한다',async()=>{
  for(const reason of ['database_missing','storage_missing','verification_missing','policy_missing']){
    const f=fixture(()=>collection({available:false,reason,policy:null}))
    assert.equal((await f.run('collections',signal())).code,reason.toUpperCase())
    assert.deepEqual(f.state.calls.map(call=>call.name),['workhub_collection_basic_readiness'])
  }
})
await test('메시지의 DB·정책 미준비와 중지 응답을 실제 파서에서 구분한다',async()=>{
  for(const reason of ['database_missing','policy_missing','disabled'])assert.equal((await fixture(()=>messaging({available:false,reason,limits:null,attachments:'not_configured'})).run('messaging',signal())).code,reason.toUpperCase())
})
await test('목록 기반 기능의 준비 중 응답도 빈 목록 성공으로 바꾸지 않는다',async()=>{
  for(const [id,contract] of [['knowledge','knowledge.v1'],['documents','documents.v1'],['guided','guided.v1'],['home','home.v1'],['transitions','school-transitions.v1']]){
    const raw={...envelope(contract,null),error:{code:'NOT_READY'}};delete raw.data
    assert.equal((await fixture(()=>raw).run(id,signal())).code,'NOT_READY',id)
  }
  for(const id of ['cooperation','teaching'])assert.equal((await fixture(()=>({contractVersion:`${id}.v1`,...catalogScope,ok:false,code:'UNAVAILABLE'})).run(id,signal())).code,'UNAVAILABLE',id)
})
await test('인계의 옛 계약과 꺼진 관리자 확인은 모두 부분 준비다',async()=>{
  const modern=structuredClone(normalResponses.transitions);modern.data.dutyApproval=null
  const legacy=structuredClone(modern);delete legacy.data.dutyApproval
  for(const raw of [modern,legacy])assert.equal((await fixture(()=>raw).run('transitions',signal())).code,'PARTIAL')
})
await test('모든 파서에 깨진 응답을 주면 준비 완료나 조회 성공으로 표시하지 않는다',async()=>{
  for(const item of checkModules){
    const result=await fixture(()=>({private:'private@example.invalid'})).run(item.id,signal())
    assert(!['READ_CONFIRMED','READY_RESPONSE','PARTIAL'].includes(result.code),item.id+':'+result.code)
    assert(!exportModuleChecks([result]).includes('private'))
  }
})
await test('모든 조회가 이미 시작된 뒤 중지되면 늦은 성공과 추가 호출을 버린다',async()=>{
  for(const item of checkModules){
    let release;const f=fixture(()=>new Promise(resolve=>release=resolve)),c=new AbortController(),pending=f.run(item.id,c.signal)
    for(let attempts=0;!release&&attempts<100;attempts++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(typeof release,'function',item.id);c.abort()
    const result=await pending;assert.equal(result.code,'CANCELLED',item.id)
    release(structuredClone(normalResponses[item.id]));await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(result.code,'CANCELLED');assert.deepEqual(f.state.calls.map(call=>call.name),[item.rpc])
  }
})
await test('학교 소속이 사라진 뒤 모든 늦은 정상 응답은 이전 결과로 폐기한다',async()=>{
  for(const item of checkModules){
    let release;const f=fixture(()=>new Promise(resolve=>release=resolve)),pending=f.run(item.id,signal())
    for(let attempts=0;!release&&attempts<100;attempts++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(typeof release,'function',item.id);f.state.context.memberships=[]
    release(structuredClone(normalResponses[item.id]));assert.equal((await pending).code,'CANCELLED',item.id)
  }
})
await test('시간표 편성과 운영은 미설치·기준판 미준비·권한 제한을 구분한다',async()=>{
  for(const [id,contract] of [['timetable','timetable.v1'],['timetableOperations','timetable-operations.v1']]){
    for(const [reason,code] of [['not_installed','DATABASE_MISSING'],['basis_missing','NOT_READY'],['not_allowed','FORBIDDEN']]){
      const f=fixture(()=>envelope(contract,{available:false,reason})),result=await f.run(id,signal())
      assert.equal(result.code,code,id+':'+reason)
      assert.equal(f.state.calls.length,1)
      assert.deepEqual(f.state.calls[0].args,{p_member_id:'member'})
    }
  }
})
await test('교사 연결과 자료 정정은 빈 목록과 이용 미설정을 혼동하지 않는다',async()=>{
  for(const id of ['schoolRoster','schoolData']){
    for(const [reason,code] of [['not_configured','NOT_CONFIGURED'],['forbidden','FORBIDDEN']]){
      const raw=structuredClone(normalResponses[id]);raw.data.available=false;raw.data.reason=reason
      const f=fixture(()=>raw),result=await f.run(id,signal());assert.equal(result.code,code,id+':'+reason)
      assert.deepEqual(f.state.calls[0].args,id==='schoolData'?{p_member_id:'member',p_course_id:null}:{p_member_id:'member'})
    }
  }
})
await test('개인 기억의 쓰기가 중지됐으면 기존 기억을 읽어도 준비 응답으로 표시하지 않는다',async()=>{
  const raw=structuredClone(normalResponses.memory);raw.data.canWrite=false
  const entry={id:'memory-private',schoolId:'school',memberId:'member',version:1,title:'비공개 선호',body:'private@example.invalid 개인 습관',category:'preference',enabled:true,expiresOn:null,createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z'}
  for(const items of [[],[entry]]){
    raw.data.items=items
    const f=fixture(()=>raw),result=await f.run('memory',signal())
    assert.equal(result.code,'DISABLED')
    assert.deepEqual(f.state.calls.map(call=>call.name),['workhub_ai_memory_list'])
    assert.doesNotMatch(exportModuleChecks([result]),/private|비공개|습관|canWrite|items|schoolId|memberId/)
  }
})
await test('개인 기억 쓰기 준비는 개별 기억의 선택이나 AI 호출을 대신하지 않는다',async()=>{
  const raw=structuredClone(normalResponses.memory)
  raw.data.items=[{id:'memory-private',schoolId:'school',memberId:'member',version:1,title:'비공개 선호',body:'private@example.invalid',category:'routine',enabled:false,expiresOn:'2026-10-01',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'}]
  const f=fixture(()=>raw),result=await f.run('memory',signal())
  assert.equal(result.code,'READY_RESPONSE')
  assert.deepEqual(f.state.calls.map(call=>call.name),['workhub_ai_memory_list'])
  assert.deepEqual(Object.keys(result).sort(),['checkedAt','code','id'])
})
await test('새 점검도 다른 학교·소속 응답과 준비 중 오류를 성공으로 받지 않는다',async()=>{
  for(const id of ['timetable','timetableOperations','timetableInterventions','schoolRoster','schoolData','memory']){
    for(const field of ['schoolId','memberId']){
      const raw=structuredClone(normalResponses[id]);raw[field]='other'
      assert.equal((await fixture(()=>raw).run(id,signal())).code,'INVALID_RESPONSE',id+':'+field)
    }
    const raw=structuredClone(normalResponses[id]);delete raw.data;raw.error={code:'NOT_READY'}
    assert.equal((await fixture(()=>raw).run(id,signal())).code,'NOT_READY',id)
  }
})
await test('전체 점검을 내보낼 때 조회 원문·교사·수업·기억 식별자는 남지 않는다',async()=>{
  const results=[]
  for(const item of checkModules){
    const f=fixture(()=>structuredClone(normalResponses[item.id]));results.push(await f.run(item.id,signal()))
    assert.deepEqual(f.state.calls.map(call=>call.name),[item.rpc])
  }
  const raw=exportModuleChecks(results),data=JSON.parse(raw)
  assert.equal(data.checks.length,19)
  assert.equal(data.scope,'read_only')
  for(const check of data.checks)assert.deepEqual(Object.keys(check).sort(),['checkedAt','code','id'])
  assert.doesNotMatch(raw,/private|비공개|schoolId|memberId|canWrite|candidates|courses|teachers/)
})
await test('대강·보강의 승인 담당 부족을 설정·권한 부족과 구분한다',async()=>{
  for(const [reason,code] of [['approvers_missing','APPROVERS_MISSING'],['not_configured','NOT_CONFIGURED'],['not_allowed','FORBIDDEN']]){
    const f=fixture(()=>envelope('timetable-interventions.v1',{available:false,reason}))
    assert.equal((await f.run('timetableInterventions',signal())).code,code)
    assert.deepEqual(f.state.calls.map(x=>x.name),['workhub_timetable_interventions_readiness'])
  }
})
await test('참여 허용이 만료되거나 승인 담당이 없어도 목록 조회만 확인한다',async()=>{
  const raw=structuredClone(normalResponses.participation)
  raw.grants=[{memberId:'expired-private',name:'비공개 교사',scopes:['calendar','messages','teaching','timetable'],active:true,effective:false,expiresAt:'2026-10-01T00:00:00Z',revision:1}]
  const f=fixture(()=>raw),result=await f.run('participation',signal())
  assert.equal(result.code,'READ_CONFIRMED')
  assert.deepEqual(f.state.calls.map(x=>x.name),['workhub_participant_administration'])
  assert.doesNotMatch(exportModuleChecks([result]),/expired|비공개|expiresAt|grants|timetableApprovers/)
  for(const field of ['schoolId','memberId']){
    const wrong={...raw,[field]:'other'}
    assert.equal((await fixture(()=>wrong).run('participation',signal())).code,'INVALID_RESPONSE')
  }
})
console.log(`${passed}건 통과`)
