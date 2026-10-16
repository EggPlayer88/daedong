import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
import{loadBrowserModule}from'./helpers/load-browser-module.mjs'
const limits=JSON.parse(readFileSync(new URL('../apps/workhub/src/setup/assets/school-admin.json',import.meta.url),'utf8'))
const{api,render}=await loadBrowserModule(`import * as api from '../apps/workhub/src/administration/transitions';import{SchoolTransitions}from'../apps/workhub/src/administration/SchoolTransitions';import{renderToStaticMarkup}from'react-dom/server';export{api};export const render=p=>renderToStaticMarkup(<SchoolTransitions {...p}/>);`)
const member={id:'m',schoolId:'s',userId:'u',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const year={kind:'new_year',sourceYearId:'y26',targetYear:2027,firstDay:'2027-03-01',lastDay:'2028-02-29',term1First:'2027-03-01',term1Last:'2027-08-12',term2First:'2027-08-13',term2Last:'2028-02-29',copyStructure:true}
const handover={kind:'handover',recipientMemberId:'next',recipientVersion:2,resources:[{kind:'collection',id:'c1',version:3,label:'평가 자료'}],note:'담당 변경'}
const catalog={canManageYear:true,years:[{id:'y26',year:2026,label:'2026학년도'}],recipients:[{memberId:'next',name:'인수 교사',version:2}],resources:handover.resources,records:[],nextCursor:null}
const modern={...catalog,dutyApproval:'admin_review_v1'}
const waiting={id:'r',kind:'handover',title:'공식 담당 인계',version:1,state:'awaiting_admin',canAccept:false,canCancel:false,summary:['과학 담당'],requesterMemberId:'sender',requiresAdminReview:true,canAdminReview:true,adminReview:null}
const review={memberId:'admin',name:'학교 관리자',decision:'confirmed',reason:'공식 담당 확인',recordedAt:'2026-10-16T01:00:00Z'}
const duty={...handover,resources:[{kind:'duty',id:'d1',version:2,label:'과학 담당'}]}
const oldPending={id:'r',kind:'handover',title:'협업·수합 인계',version:1,state:'pending',canAccept:true,canCancel:true,summary:['담당자 변경']}
const pending={...oldPending,requesterMemberId:'sender',requiresAdminReview:false,canAdminReview:false,adminReview:null}
const receipt=(key,command)=>({requestKey:key,recordId:command.recordId??'r',version:command.expectedVersion+1,state:({accept:'accepted',reject:'rejected',cancel:'cancelled',admin_confirm:'pending',admin_reject:'rejected'})[command.kind],recordedAt:'2026-10-16T01:00:00Z'})
const env=data=>({contract:'school-transitions.v1',schoolId:'s',memberId:'m',data})
function setup(){let value=env(catalog),listValue=env(modern);const calls=[];const connection={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-16'}),getIdentity:async()=>({userId:'u',approved:true}),rpcVerified:async(name,args)=>{calls.push({name,args:structuredClone(args)});return name.endsWith('_list')?(typeof listValue==='function'?listValue(args):listValue):value}};return{connection,calls,client:api.createTransitionService(connection),set:v=>value=v,setList:v=>listValue=v}}
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
await test('구 SQL과 관리자 확인 중지 목록도 협업·수합 수락·반려 버튼은 기록의 권한과 판으로 판단한다',()=>{
 for(const value of [{...catalog,records:[oldPending]},{...modern,dutyApproval:null,records:[pending]},{...modern,records:[pending]}]){
  const parsed=api.transitionCatalog(value,'m')
  for(const kind of ['accept','reject','cancel'])assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'r',expectedVersion:1,reason:'확인'}),true)
  for(const kind of ['accept','reject']){
   assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'r',expectedVersion:2,reason:'확인'}),false)
   assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'other',expectedVersion:1,reason:'확인'}),false)
   assert.equal(api.transitionActionAllowed({...parsed,records:[{...parsed.records[0],canAccept:false}]},{kind,recordId:'r',expectedVersion:1,reason:'확인'}),false)
  }
  for(const kind of ['admin_confirm','admin_reject'])assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'r',expectedVersion:1,reason:'확인'}),false)
 }
})
await test('구 SQL과 관리자 확인 중지 상태의 협업·수합 수락·반려는 관리자 확인 준비를 요구하지 않는다',async()=>{
 for(const shape of ['legacy','stopped'])for(const resourceKind of ['cooperation','collection'])for(const kind of ['accept','reject']){
  const x=setup(),recordId=resourceKind+'-record',command={kind,recordId,expectedVersion:1,reason:'인계 내용 확인'},key=shape+'-'+resourceKind+'-'+kind
  const record=shape==='legacy'?{...oldPending,id:recordId}:{...pending,id:recordId}
  x.setList(env({...catalog,...(shape==='stopped'?{dutyApproval:null}:{}),canManageYear:false,records:[record]}))
  x.set(env(receipt(key,command)));assert.equal((await x.client.mutate('m',command,key)).state,receipt(key,command).state)
  const writes=x.calls.filter(call=>call.name.endsWith('_mutate'));assert.equal(writes.length,1);assert.deepEqual(writes[0].args.p_command,command);assert.equal(writes[0].args.p_request_key,key)
 }
})
await test('구 SQL과 관리자 확인 중지 상태는 새 공식 담당 미리보기·신청·관리자 확인·반려를 계속 막는다',async()=>{
 for(const value of [catalog,{...modern,dutyApproval:null}]){
  const x=setup();x.setList(env(value));assert.equal((await x.client.list('m')).dutyApproval,null)
  const commands=[{kind:'apply',plan:duty,fingerprint:'a'.repeat(64)},...['admin_confirm','admin_reject'].map(kind=>({kind,recordId:'r',expectedVersion:1,reason:'확인'}))]
  await assert.rejects(()=>x.client.preview('m',duty),e=>e.code==='NOT_READY')
  for(const command of commands)await assert.rejects(()=>x.client.mutate('m',command,'new-duty-'+command.kind),e=>e.code==='NOT_READY')
  assert.equal(x.calls.filter(call=>!call.name.endsWith('_list')).length,0)
 }
})
await test('관리자 확인이 중지되어도 협업·수합 인계의 새 미리보기와 신청은 기존 계약을 유지한다',async()=>{
 for(const kind of ['cooperation','collection']){
  const x=setup(),plan={...handover,resources:[{...handover.resources[0],kind}]},key='ordinary-handover-'+kind
  x.setList(env({...modern,dutyApproval:null}));x.set(env({fingerprint:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',summary:['담당자 변경'],excluded:['개인 기록'],affectedCount:1}))
  await x.client.preview('m',plan)
  x.set(env({requestKey:key,recordId:'r',version:1,state:'pending',recordedAt:'2026-10-16T01:00:00Z'}))
  assert.equal((await x.client.mutate('m',{kind:'apply',plan,fingerprint:'a'.repeat(64)},key)).state,'pending')
  assert.deepEqual(x.calls.map(call=>call.name),['workhub_school_transition_preview','workhub_school_transition_mutate'])
 }
})
await test('공식 담당 모듈 중지 때 새 수락은 막되 반려는 허용하고 미확인 기록은 계속 막는다',()=>{
 const confirmed={...waiting,version:2,state:'pending',canAccept:true,canAdminReview:false,adminReview:review}
 const parsed=api.transitionCatalog({...modern,dutyApproval:null,records:[waiting, {...confirmed,id:'confirmed'}]},'m')
 for(const kind of ['accept','reject']){
  assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'confirmed',expectedVersion:2,reason:'확인'}),kind==='reject')
  assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'r',expectedVersion:1,reason:'확인'}),false)
 }
 for(const kind of ['admin_confirm','admin_reject'])assert.equal(api.transitionActionAllowed(parsed,{kind,recordId:'r',expectedVersion:1,reason:'확인'}),false)
})
await test('두 번째 목록의 공식 담당 기록도 새 수락은 관리자 확인 준비를 요구하고 반려는 보낸다',async()=>{
 const confirmed={...waiting,version:2,state:'pending',canAccept:true,canAdminReview:false,adminReview:review},x=setup()
 x.setList(args=>env({...modern,dutyApproval:null,records:args.p_cursor?[confirmed]:[],nextCursor:args.p_cursor?null:'next-page'}))
 await assert.rejects(()=>x.client.mutate('m',{kind:'accept',recordId:'r',expectedVersion:2,reason:'인수'},'page-two-duty-accept'),e=>e.code==='NOT_READY')
 assert.equal(x.calls.filter(call=>call.name.endsWith('_mutate')).length,0)
 assert.deepEqual(x.calls.filter(call=>call.name.endsWith('_list')).map(call=>call.args.p_cursor),[null,'next-page'])
 const command={kind:'reject',recordId:'r',expectedVersion:2,reason:'담당 확인 필요'},key='page-two-duty-reject';x.set(env(receipt(key,command)))
 assert.equal((await x.client.mutate('m',command,key)).state,'rejected')
})
await test('두 번째 목록의 구 기록·일반 인계와 목록 밖 기록은 서버의 인수 판정을 유지한다',async()=>{
 for(const shape of ['legacy','general','outside']){
  const x=setup(),command={kind:'accept',recordId:'r',expectedVersion:1,reason:'기존 인계 인수'},key='page-two-'+shape
  x.setList(args=>env({...catalog,...(shape==='legacy'?{}:{dutyApproval:null}),records:args.p_cursor?(shape==='outside'?[]:[shape==='legacy'?oldPending:pending]):[],nextCursor:args.p_cursor?null:'next-page'}))
  x.set(env(receipt(key,command)));assert.equal((await x.client.mutate('m',command,key)).state,'accepted')
  const writes=x.calls.filter(call=>call.name.endsWith('_mutate'));assert.equal(writes.length,1);assert.deepEqual(writes[0].args.p_command,command)
 }
})
await test('새 인수의 준비 목록 커서가 반복되거나 응답이 깨지면 쓰기 전에 멈춘다',async()=>{
 const command={kind:'accept',recordId:'r',expectedVersion:1,reason:'목록 확인'}
 const cycle=setup();cycle.setList(env({...modern,records:[],nextCursor:'same-page'}))
 await assert.rejects(()=>cycle.client.mutate('m',command,'cursor-cycle-key'),e=>e.code==='INVALID_RESPONSE')
 assert.equal(cycle.calls.length,2);assert.equal(cycle.calls.filter(call=>call.name.endsWith('_mutate')).length,0)
 const invalid=setup();invalid.setList(env({...modern,records:[],nextCursor:'next-page',extra:'잘못된 응답'}))
 await assert.rejects(()=>invalid.client.mutate('m',command,'invalid-page-key'),e=>e.code==='INVALID_RESPONSE')
 assert.equal(invalid.calls.length,1);assert.equal(invalid.calls[0].name,'workhub_school_transition_list')
})
await test('서로 다른 커서가 계속 와도 자산의 조회 한도에서 멈추고 마지막 허용 페이지의 인계는 처리한다',async()=>{
 const command={kind:'accept',recordId:'r',expectedVersion:1,reason:'인계 확인'},x=setup(),key='bounded-page-accept'
 let pages=0
 x.setList(()=>env({...modern,dutyApproval:null,records:[],nextCursor:'page-'+(++pages)}))
 await assert.rejects(()=>x.client.mutate('m',command,key),e=>e.code==='QUERY_FAILED')
 assert.equal(pages,limits.transitionLookupPages);assert.equal(x.calls.length,limits.transitionLookupPages)
 assert.equal(x.calls.filter(call=>call.name.endsWith('_mutate')).length,0)
 assert.equal(new Set(x.calls.map(call=>call.args.p_cursor)).size,limits.transitionLookupPages)
 const boundary=setup();pages=0
 boundary.setList(()=>env({...modern,dutyApproval:null,records:++pages===limits.transitionLookupPages?[pending]:[],nextCursor:'page-'+pages}))
 boundary.set(env(receipt(key,command)));assert.equal((await boundary.client.mutate('m',command,key)).state,'accepted')
 assert.equal(pages,limits.transitionLookupPages);assert.equal(boundary.calls.filter(call=>call.name.endsWith('_mutate')).length,1)
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
await test('결과 미상 관리자 명령은 준비 상태 조회가 실패해도 원키·명령으로 접수증을 복구한다',async()=>{
 const x=setup(),command={kind:'admin_confirm',recordId:'r',expectedVersion:1,reason:'확인'},key='admin-unknown-key'
 x.setList(env({...modern,records:[waiting]}));x.set(null);await assert.rejects(()=>x.client.mutate('m',command,key),e=>e.code==='RESULT_UNKNOWN')
 x.setList({contract:'school-transitions.v1',schoolId:'s',memberId:'m',error:{code:'FORBIDDEN'}})
 x.set(env(receipt(key,command)));assert.equal((await x.client.recover('m',command,key)).state,'pending')
 const writes=x.calls.filter(x=>x.name.endsWith('_mutate'));assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args)
 assert.equal(x.calls.filter(x=>x.name.endsWith('_list')).length,1)
})
await test('수락·반려·취소·관리자 명령 원키 복구는 목록 실패·페이지 밖·관리자 확인 중지와 무관하다',async()=>{
 const unavailable=[{contract:'school-transitions.v1',schoolId:'s',memberId:'m',error:{code:'FORBIDDEN'}},env({...modern,records:[],nextCursor:'next-page'}),env({...modern,dutyApproval:null,records:[]})]
 for(const listValue of unavailable)for(const kind of ['accept','reject','cancel','admin_confirm','admin_reject']){
  const x=setup(),command={kind,recordId:'r',expectedVersion:1,reason:'원래 인계 확인'},key='recover-'+kind
  x.setList(env({...modern,records:[waiting]}));x.set(null)
  await assert.rejects(()=>x.client.mutate('m',command,key),e=>e.code==='RESULT_UNKNOWN')
  x.setList(listValue);x.set(env(receipt(key,command)));const before=x.calls.length
  assert.equal((await x.client.recover('m',command,key)).state,receipt(key,command).state)
  assert.equal(x.calls.length,before+1);assert.equal(x.calls.at(-1).name,'workhub_school_transition_mutate')
  const writes=x.calls.filter(call=>call.name.endsWith('_mutate'));assert.deepEqual(writes[0].args,writes[1].args)
  await assert.rejects(()=>x.client.recover('m',{...command,reason:'바뀐 이유'},key),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(x.calls.length,before+1)
 }
})
await test('공식 담당 신청의 기존 접수증 복구도 중지된 준비 조회 대신 서버 응답을 확인한다',async()=>{
 const x=setup(),command={kind:'apply',plan:duty,fingerprint:'a'.repeat(64)},key='duty-stopped-recovery'
 x.set(null);await assert.rejects(()=>x.client.mutate('m',command,key),e=>e.code==='RESULT_UNKNOWN')
 x.setList(env({...modern,dutyApproval:null}));x.set(env({requestKey:key,recordId:'r',version:1,state:'awaiting_admin',recordedAt:'2026-10-16T01:00:00Z'}))
 assert.equal((await x.client.recover('m',command,key)).state,'awaiting_admin')
 assert.equal(x.calls.filter(call=>call.name.endsWith('_list')).length,1)
 const writes=x.calls.filter(call=>call.name.endsWith('_mutate'));assert.deepEqual(writes[0].args,writes[1].args)
})
await test('복구 접수증도 기록·원키·다음 판·명령 상태가 어긋나면 성공으로 표시하지 않는다',async()=>{
 for(const kind of ['accept','reject','cancel','admin_confirm','admin_reject'])for(const change of [{recordId:'other'},{requestKey:'other-key'},{version:1},{version:3},{state:'completed'}]){
  const x=setup(),command={kind,recordId:'r',expectedVersion:1,reason:'결과 확인'},key='strict-recover-'+kind
  x.setList(env({...modern,dutyApproval:null}));x.set(env({...receipt(key,command),...change}))
  await assert.rejects(()=>x.client.recover('m',command,key),e=>e.code==='RESULT_UNKNOWN')
  x.set(env(receipt(key,command)));assert.equal((await x.client.recover('m',command,key)).state,receipt(key,command).state)
  assert.equal(x.calls.length,2);assert.deepEqual(x.calls[0].args,x.calls[1].args)
 }
})
await test('목록을 거치지 않는 복구도 서버의 현재 권한·정책 거절을 성공으로 바꾸지 않는다',async()=>{
 for(const code of ['NOT_READY','FORBIDDEN','CONFLICT','IDEMPOTENCY_CONFLICT']){
  const x=setup(),command={kind:'accept',recordId:'r',expectedVersion:1,reason:'기존 접수증 확인'},key='server-denied-'+code
  x.set({contract:'school-transitions.v1',schoolId:'s',memberId:'m',error:{code}})
  await assert.rejects(()=>x.client.recover('m',command,key),e=>e.code===code)
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].name,'workhub_school_transition_mutate')
 }
})
console.log('학교 전환 '+count+'건 통과')
