import assert from 'node:assert/strict'
import{loadBrowserModule}from'./helpers/load-browser-module.mjs'
const{api,render}=await loadBrowserModule(`import * as api from '../apps/workhub/src/administration/transitions';import{SchoolTransitions}from'../apps/workhub/src/administration/SchoolTransitions';import{renderToStaticMarkup}from'react-dom/server';export{api};export const render=p=>renderToStaticMarkup(<SchoolTransitions {...p}/>);`)
const member={id:'m',schoolId:'s',userId:'u',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const year={kind:'new_year',sourceYearId:'y26',targetYear:2027,firstDay:'2027-03-01',lastDay:'2028-02-29',term1First:'2027-03-01',term1Last:'2027-08-12',term2First:'2027-08-13',term2Last:'2028-02-29',copyStructure:true}
const handover={kind:'handover',recipientMemberId:'next',recipientVersion:2,resources:[{kind:'collection',id:'c1',version:3,label:'평가 자료'}],note:'담당 변경'}
const catalog={canManageYear:true,years:[{id:'y26',year:2026,label:'2026학년도'}],recipients:[{memberId:'next',name:'인수 교사',version:2}],resources:handover.resources,records:[],nextCursor:null}
const modern={...catalog,dutyApproval:'admin_review_v1'}
const waiting={id:'r',kind:'handover',title:'공식 담당 인계',version:1,state:'awaiting_admin',canAccept:false,canCancel:false,summary:['과학 담당'],requesterMemberId:'sender',requiresAdminReview:true,canAdminReview:true,adminReview:null}
const review={memberId:'admin',name:'학교 관리자',decision:'confirmed',reason:'공식 담당 확인',recordedAt:'2026-10-16T01:00:00Z'}
const duty={...handover,resources:[{kind:'duty',id:'d1',version:2,label:'과학 담당'}]}
const env=data=>({contract:'school-transitions.v1',schoolId:'s',memberId:'m',data})
function setup(){let value=env(catalog),listValue=env(modern);const calls=[];const connection={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-16'}),getIdentity:async()=>({userId:'u',approved:true}),rpcVerified:async(name,args)=>{calls.push({name,args:structuredClone(args)});return name.endsWith('_list')?listValue:value}};return{connection,calls,client:api.createTransitionService(connection),set:v=>value=v,setList:v=>listValue=v}}
let count=0;async function test(name,run){await run();console.log('  ✓ '+name);count++}
await test('윤년과 실제 학기 순서를 검사하고 빈 공식 날짜는 추측하지 않는다',()=>{assert.deepEqual(api.transitionPlan(year),year);for(const change of [{firstDay:''},{lastDay:'2027-02-29'},{term1Last:'2027-08-13'},{term2First:'2027-02-01'}])assert.throws(()=>api.transitionPlan({...year,...change}))})
await test('학교관리와 새 학년도 생성은 2020·2100 경계를 공유하고 바깥 학년도는 보내지 않는다',async()=>{for(const value of [2020,2100]){assert.equal(api.transitionPlan({...year,targetYear:value,firstDay:value+'-03-01',term1First:value+'-03-01',term1Last:value+'-08-12',term2First:value+'-08-13',term2Last:(value+1)+'-02-28',lastDay:(value+1)+'-02-28'}).targetYear,value);assert.equal(api.transitionCatalog({...catalog,years:[{id:'boundary',label:'경계 학년도',year:value}]}).years[0].year,value)}const x=setup();for(const value of [2019,2101,2000,2200]){assert.throws(()=>api.transitionPlan({...year,targetYear:value}));assert.throws(()=>api.transitionCatalog({...catalog,years:[{id:'outside',label:'범위 밖',year:value}]}));await assert.rejects(async()=>x.client.preview('m',{...year,targetYear:value}))}assert.equal(x.calls.length,0)})
await test('인계는 공식 종류만 허용하며 상담과 개인메모를 섞지 않는다',()=>{assert.deepEqual(api.transitionPlan(handover),handover);for(const kind of ['counseling','observation','personal_note','message'])assert.throws(()=>api.transitionPlan({...handover,resources:[{...handover.resources[0],kind}]}))})
await test('중복 대상·빈 사유·추가 임의 원본 데이터는 인계하지 않는다',()=>{assert.throws(()=>api.transitionPlan({...handover,resources:[...handover.resources,...handover.resources]}));assert.throws(()=>api.transitionPlan({...handover,note:''}));assert.throws(()=>api.transitionPlan({...handover,privateContent:'secret'}))})
await test('이미 끝난 인계에 인수·취소권이 붙으면 잘못된 응답으로 처리한다',()=>{assert.throws(()=>api.transitionCatalog({...catalog,records:[{id:'r',kind:'handover',title:'인계',version:1,state:'accepted',canAccept:true,canCancel:false,summary:[]}]}))})
await test('미리보기는 원본 판과 공식 날짜를 전달하고 영향 설명을 검증한다',async()=>{const x=setup();x.set(env({fingerprint:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',summary:['학급 구조'],excluded:['학생 자료'],affectedCount:3}));const result=await x.client.preview('m',year);assert.equal(x.calls[0].name,'workhub_school_transition_preview');assert.deepEqual(x.calls[0].args.p_plan,year);assert.deepEqual(result.excluded,['학생 자료'])})
await test('인계 요청 접수와 수신 교사 인수 완료를 혼동하지 않는다',async()=>{const x=setup(),command={kind:'apply',plan:handover,fingerprint:'a'.repeat(64)};x.set(env({requestKey:'handover-key',recordId:'r',version:1,state:'accepted',recordedAt:'2026-10-16T01:00:00Z'}));await assert.rejects(()=>x.client.mutate('m',command,'handover-key'),e=>e.code==='RESULT_UNKNOWN');x.set(env({requestKey:'handover-key',recordId:'r',version:1,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}));assert.equal((await x.client.mutate('m',command,'handover-key')).state,'pending')})
await test('인수 판과 접수증 기록이 어긋나면 성공으로 표시하지 않는다',async()=>{const x=setup();x.set(env({requestKey:'accept-key',recordId:'other',version:3,state:'accepted',recordedAt:'2026-10-16T01:00:00Z'}));await assert.rejects(()=>x.client.mutate('m',{kind:'accept',recordId:'r',expectedVersion:2,reason:'확인'},'accept-key'),e=>e.code==='RESULT_UNKNOWN')})
await test('계획 수정은 기존 결과미확정 요청 번호를 재사용하지 못한다',async()=>{const x=setup();x.set(null);const command={kind:'apply',plan:year,fingerprint:'a'.repeat(64)};await assert.rejects(()=>x.client.mutate('m',command,'year-key'),e=>e.code==='RESULT_UNKNOWN');await assert.rejects(()=>x.client.mutate('m',{...command,plan:{...year,copyStructure:false}},'year-key'),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(x.calls.length,1)})
await test('조회 전 화면에는 서버 처리 완료나 복사된 학생 자료가 없다',()=>{const x=setup(),html=render({connection:x.connection,member});assert.match(html,/업무 인계와 새 학년도 준비/);assert.doesNotMatch(html,/인계 요청을 저장했습니다/)})
await test('인계 계획의 모양·판·종류 오류는 입력 오류이며 미리보기 RPC를 시작하지 않는다',async()=>{
 const inputs=[null,[],{}, {...handover,extra:'민감 원문'},{...handover,recipientVersion:0},{...handover,resources:[null]},{...handover,resources:[{...handover.resources[0],version:0}]},{...handover,resources:[{...handover.resources[0],kind:'counseling'}]},{...handover,resources:[{...handover.resources[0],extra:'비공개'}]}]
 const x=setup();for(const input of inputs){assert.throws(()=>api.transitionPlan(input),e=>e.code==='INVALID_INPUT'&&!e.message.includes('민감'));await assert.rejects(async()=>x.client.preview('m',input),e=>e.code==='INVALID_INPUT')};assert.equal(x.calls.length,0)
})
await test('인계 명령과 학년도 계획의 깨진 필드는 전송 전에 입력 오류로 구분한다',async()=>{
 const action={kind:'accept',recordId:'r',expectedVersion:2,reason:'확인'}
 const inputs=[null,[],{}, {...action,extra:'원문'},{...action,expectedVersion:0},{...action,expectedVersion:'2'}, {kind:'apply',plan:null,fingerprint:'a'.repeat(64)}, {kind:'apply',plan:{...year,extra:'원문'},fingerprint:'a'.repeat(64)}]
 const x=setup();for(const input of inputs){assert.throws(()=>api.transitionCommand(input),e=>e.code==='INVALID_INPUT');await assert.rejects(async()=>x.client.mutate('m',input,'input-key'),e=>e.code==='INVALID_INPUT')};assert.equal(x.calls.length,0)
})
await test('목록 커서의 길이·형식 오류는 서버 호출 전에 막는다',async()=>{
 const x=setup();for(const cursor of ['',{},'a'.repeat(1001),'비공개\u0007'])await assert.rejects(async()=>x.client.list('m',cursor),e=>e.code==='INVALID_INPUT');assert.equal(x.calls.length,0)
 await x.client.list('m','a'.repeat(1000));assert.equal(x.calls[0].args.p_cursor.length,1000)
})
await test('서버가 보낸 잘못된 판·자원·미리보기는 입력 오류로 바뀌지 않는다',async()=>{
 for(const value of [{...catalog,recipients:[{...catalog.recipients[0],version:0}]},{...catalog,resources:[{...handover.resources[0],kind:'counseling'}]},{...catalog,extra:'서버 원문'}]){const x=setup();x.setList(env(value));await assert.rejects(()=>x.client.list('m'),e=>e.code==='INVALID_RESPONSE')}
 const x=setup();x.set(env({fingerprint:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',summary:[],excluded:[],affectedCount:1,extra:'원문'}));await assert.rejects(()=>x.client.preview('m',year),e=>e.code==='INVALID_RESPONSE')
})
await test('로컬 입력 거절 뒤에도 이미 전송한 인계의 원래 키·명령을 보존한다',async()=>{
 const x=setup(),command={kind:'apply',plan:handover,fingerprint:'a'.repeat(64)};x.set(null)
 await assert.rejects(()=>x.client.mutate('m',command,'same-key'),e=>e.code==='RESULT_UNKNOWN')
 await assert.rejects(async()=>x.client.mutate('m',{...command,plan:{...handover,recipientVersion:0}},'same-key'),e=>e.code==='INVALID_INPUT');assert.equal(x.calls.length,1)
 x.set(env({requestKey:'same-key',recordId:'r',version:1,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}));await x.client.mutate('m',command,'same-key');assert.deepEqual(x.calls[0].args,x.calls[1].args)
})
await test('학년도와 시작일 연도는 새 미리보기·명령에서만 같아야 하고 종료일의 다음 해는 허용한다',async()=>{
 const legacy={...year,targetYear:2026},command={kind:'apply',plan:legacy,fingerprint:'a'.repeat(64)},x=setup()
 assert.throws(()=>api.transitionPlan(legacy),e=>e.code==='INVALID_INPUT')
 await assert.rejects(()=>x.client.preview('m',legacy),e=>e.code==='INVALID_INPUT')
 await assert.rejects(()=>x.client.mutate('m',command,'legacy-year-key'),e=>e.code==='INVALID_INPUT');assert.equal(x.calls.length,0)
 x.set(env({requestKey:'legacy-year-key',recordId:'year-old',version:1,state:'completed',recordedAt:'2026-10-16T01:00:00Z'}))
 await x.client.recover('m',command,'legacy-year-key');assert.deepEqual(x.calls[0].args.p_command,command)
 assert.deepEqual(api.transitionCommand(command,{recovering:true}),command)
 const january={...year,firstDay:'2027-01-15',term1First:'2027-01-15'};assert.deepEqual(api.transitionPlan(january),january)
 assert.deepEqual(api.transitionCatalog({...catalog,years:[{id:'legacy',year:2026,label:'과거 학년도'}]}).years,[{id:'legacy',year:2026,label:'과거 학년도'}])
})
await test('구 SQL 목록은 읽되 공식 담당 미리보기·요청과 구 기록 인수는 전송하지 않는다',async()=>{
 const x=setup();x.setList(env(catalog));const parsed=await x.client.list('m');assert.equal(parsed.dutyApproval,null)
 for(const run of [()=>x.client.preview('m',duty),()=>x.client.mutate('m',{kind:'apply',plan:duty,fingerprint:'a'.repeat(64)},'duty-key'),()=>x.client.mutate('m',{kind:'accept',recordId:'r',expectedVersion:1,reason:'확인'},'accept-key')])await assert.rejects(run,e=>e.code==='NOT_READY')
 assert.equal(x.calls.filter(x=>!x.name.endsWith('_list')).length,0)
 const legacy=api.transitionCatalog({...catalog,records:[{id:'r',kind:'handover',title:'구 기록',version:1,state:'pending',canAccept:true,canCancel:true,summary:[]}]})
 assert.equal(api.transitionActionAllowed(legacy,{kind:'accept',recordId:'r',expectedVersion:1,reason:'확인'}),false)
 assert.equal(api.transitionActionAllowed(legacy,{kind:'cancel',recordId:'r',expectedVersion:1,reason:'취소'}),true)
})
await test('공식 담당은 관리자 확인 대기 접수증만 성공으로 보고 수신자 대기를 건너뛰지 않는다',async()=>{
 const x=setup(),command={kind:'apply',plan:duty,fingerprint:'a'.repeat(64)}
 x.set(env({requestKey:'duty-request',recordId:'r',version:1,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}));await assert.rejects(()=>x.client.mutate('m',command,'duty-request'),e=>e.code==='RESULT_UNKNOWN')
 x.set(env({requestKey:'duty-request',recordId:'r',version:1,state:'awaiting_admin',recordedAt:'2026-10-16T01:00:00Z'}));assert.equal((await x.client.recover('m',command,'duty-request')).state,'awaiting_admin')
 const calls=x.calls.filter(x=>x.name.endsWith('_mutate'));assert.deepEqual(calls[0].args,calls[1].args)
 x.set(env({requestKey:'duty-request',recordId:'r',version:1,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}));assert.equal((await x.client.recover('m',command,'duty-request')).legacyDutyReceipt,true)
})
await test('관리자 확인·반려는 정확한 다음 판을 검사하고 자기 요청 확인을 막는다',async()=>{
 const x=setup();x.setList(env({...modern,records:[waiting]}))
 for(const [kind,state]of [['admin_confirm','pending'],['admin_reject','rejected']]){
  const command={kind,recordId:'r',expectedVersion:1,reason:'검토 완료'},key=kind+'-key'
  x.set(env({requestKey:key,recordId:'r',version:2,state,recordedAt:'2026-10-16T01:00:00Z'}));assert.equal((await x.client.mutate('m',command,key)).state,state)
 }
 x.setList(env({...modern,records:[{...waiting,requesterMemberId:'m',canAdminReview:false}]}))
 const count=x.calls.filter(x=>x.name.endsWith('_mutate')).length
 await assert.rejects(()=>x.client.mutate('m',{kind:'admin_confirm',recordId:'r',expectedVersion:1,reason:'내 요청'},'self-confirm'),e=>e.code==='FORBIDDEN')
 assert.equal(x.calls.filter(x=>x.name.endsWith('_mutate')).length,count)
})
await test('부분 확장·관리자 자기 확인·확인 없는 인수·잘못된 판과 상태 혼합을 응답에서 거부한다',()=>{
 const accepted={...waiting,state:'accepted',version:3,canAdminReview:false,adminReview:review}
 assert.equal(api.transitionCatalog({...modern,records:[waiting]},'m').records[0].canAdminReview,true)
 assert.equal(api.transitionCatalog({...modern,records:[accepted]},'m').records[0].adminReview.name,'학교 관리자')
 const altered=[{...waiting,adminReview:undefined},{...waiting,requesterMemberId:'m'},{...waiting,canAccept:true},{...waiting,state:'pending',version:2,canAdminReview:false},{...accepted,adminReview:{...review,memberId:'sender'}},{...accepted,version:2},{...accepted,adminReview:{...review,decision:'rejected'}},{...waiting,requiresAdminReview:false},{...accepted,requiresAdminReview:false,state:'completed',adminReview:null},{...accepted,adminReview:{...review,recordedAt:'2026-10-16T01:00:00'}},{...accepted,adminReview:{...review,recordedAt:'2026-02-30T01:00:00Z'}}]
 for(const record of altered)assert.throws(()=>api.transitionCatalog({...modern,records:[record]},'m'))
 assert.throws(()=>api.transitionCatalog({...catalog,records:[waiting]},'m'))
 const partial={...waiting};delete partial.canAdminReview;assert.throws(()=>api.transitionCatalog({...modern,records:[partial]},'m'))
 assert.throws(()=>api.transitionCatalog({...modern,canManageYear:false,records:[waiting]},'m'))
 assert.throws(()=>api.transitionCatalog({...modern,records:[waiting,{...waiting,id:'other',requesterMemberId:undefined}]},'m'))
})
await test('인계 검토 판이 바뀌면 이전 화면의 확인 버튼 권한도 재사용하지 않는다',()=>{
 const parsed=api.transitionCatalog({...modern,records:[waiting]},'m')
 assert.equal(api.transitionActionAllowed(parsed,{kind:'admin_confirm',recordId:'r',expectedVersion:1,reason:'확인'}),true)
 assert.equal(api.transitionActionAllowed(parsed,{kind:'admin_confirm',recordId:'r',expectedVersion:2,reason:'확인'}),false)
 assert.equal(api.transitionActionAllowed(parsed,{kind:'accept',recordId:'r',expectedVersion:1,reason:'확인'}),false)
})
await test('결과 미상 관리자 명령은 준비 상태 조회 실패로 확정 거절하거나 원키를 바꾸지 않는다',async()=>{
 const x=setup(),command={kind:'admin_confirm',recordId:'r',expectedVersion:1,reason:'확인'},key='admin-unknown-key'
 x.setList(env({...modern,records:[waiting]}));x.set(null);await assert.rejects(()=>x.client.mutate('m',command,key),e=>e.code==='RESULT_UNKNOWN')
 x.setList({contract:'school-transitions.v1',schoolId:'s',memberId:'m',error:{code:'FORBIDDEN'}})
 await assert.rejects(()=>x.client.recover('m',command,key),e=>e.code==='NOT_READY')
 x.setList(env(modern));x.set(env({requestKey:key,recordId:'r',version:2,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}));await x.client.recover('m',command,key)
 const writes=x.calls.filter(x=>x.name.endsWith('_mutate'));assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args)
})
console.log('학교 전환 '+count+'건 통과')
