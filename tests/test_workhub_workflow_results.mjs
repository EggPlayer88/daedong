import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const {
  copyWorkflowResult: copy, workflowResultLabel: label,
  captureWorkflowPlanOrigin: capture, recordWorkflowPlanResult: record,
  hasWorkspacePlanResult: hasResult, nextWorkspacePlanStep: next, recordWorkspacePlanOutcome: mark,
  messageAttempt, blankMessageDraft, retryMessageAttempt,
} = await loadBrowserModule(`
export * from '../apps/workhub/src/app/workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-control.ts'
export * from '../apps/workhub/src/messaging/composer.ts'`)

const date='2026-11-12', scope='school/member/user', stamp='2026-11-12T01:02:03.000Z'
const base={scope,key:'key-one',recordedAt:stamp}
const message={...base,kind:'message',action:'start',deliveries:[{threadId:'thread-a',messageId:'message-a',sequence:1},{threadId:'thread-b',messageId:'message-b',sequence:3}]}
const collection={...base,kind:'collection',action:'create',requestId:'collection-a',resourceId:'collection-a',resourceVersion:1}
const timetable={...base,kind:'timetable',action:'approve',requestId:'exchange-a',requestVersion:3,changedLessonIds:['lesson-a','lesson-b']}
function saved(command={kind:'navigate',page:'messages'}) {
  return {scope,selectedId:'step-1',plan:{kind:'plan',prompt:'원문 전체',basisDate:date,steps:[
    {id:'step-1',prompt:'첫 업무 원문',label:'첫 업무',command},
    {id:'step-2',prompt:'둘째 업무 원문',label:'둘째 업무',command:{kind:'navigate',page:'timetable'}},
  ]}}
}
function origin(value,target) { return capture(value,value.plan.steps[0].prompt,scope,date,target) }
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value }
let failed=0, passed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}

test('메시지 결과는 여러 대화의 원본 번호와 순서를 보존하고 민감 내용은 복제하지 않는다',()=>{
  const raw={...message,body:'private body',recipients:[{name:'private name'}],deliveries:message.deliveries.map(row=>({...row,recipientMemberIds:['private-member']}))}
  const result=copy(raw)
  assert.deepEqual(result,message)
  assert.notEqual(result.deliveries,raw.deliveries)
  assert.notEqual(result.deliveries[0],raw.deliveries[0])
})
test('수합과 시간표 결과도 내용·학생 정보·명령을 제외한 원본 접수 요약만 복제한다',()=>{
  assert.deepEqual(copy({...collection,input:{students:['private']},command:{kind:'publish'}}),collection)
  const result=copy({...timetable,reason:'private reason',members:['private']})
  assert.deepEqual(result,timetable)
  assert.notEqual(result.changedLessonIds,timetable.changedLessonIds)
})
test('학교 범위·원 요청 번호·접수 시각이 없거나 잘못되면 결과를 표시하지 않는다',()=>{
  for(const raw of [null,undefined,{},[],true,{...message,scope:''},{...message,key:''},{...message,recordedAt:'yesterday'},{...message,key:'bad\nkey'},{...message,recordedAt:null}])assert.equal(copy(raw),undefined)
})
test('작성 출처는 검증된 표시 메타만 복사하고 잘못된 값은 결과에서 제외한다',()=>{
  assert.deepEqual(copy({...message,composeId:'compose-a'}),{...message,composeId:'compose-a'})
  for(const composeId of ['',null,34,'bad\nvalue','x'.repeat(513)])assert.equal(copy({...message,composeId}),undefined)
})
test('읽음·알림 읽음·빈 전송·잘못된 메시지 순번은 전송 결과가 아니다',()=>{
  for(const raw of [{...message,action:'read_thread'},{...message,action:'read_notice'},{...message,deliveries:[]},{...message,deliveries:[null]},{...message,deliveries:[{...message.deliveries[0],sequence:0}]},{...message,deliveries:[{...message.deliveries[0],sequence:1.5}]},{...message,deliveries:[message.deliveries[0],{...message.deliveries[1],messageId:'message-a'}]}])assert.equal(copy(raw),undefined)
})
test('기존 서버가 허용하는 100개 초과 개별 전송의 결과도 전부 보존한다',()=>{
  const deliveries=Array.from({length:101},(_,i)=>({threadId:'thread-'+i,messageId:'message-'+i,sequence:1}))
  assert.equal(copy({...message,deliveries}).deliveries.length,101)
})
test('잘못된 수합 원본 번호·판·실행 이름은 접수 기록으로 승격하지 않는다',()=>{
  for(const raw of [{...collection,action:'delete'},{...collection,requestId:''},{...collection,resourceId:null},{...collection,resourceVersion:0},{...collection,resourceVersion:Infinity}])assert.equal(copy(raw),undefined)
})
test('승인 전 요청과 비어 있거나 중복된 변경 수업은 승인 결과가 아니다',()=>{
  for(const raw of [{...timetable,action:'accept'},{...timetable,requestVersion:0},{...timetable,changedLessonIds:[]},{...timetable,changedLessonIds:['lesson-a','lesson-a']},{...timetable,changedLessonIds:['']}])assert.equal(copy(raw),undefined)
})
test('초안·공개·최종 제출·철회는 서로 다른 결과 문구로 표시한다',()=>{
  const expected={create:'수합 초안 저장 · 아직 미공개',update:'수합 초안 변경 저장 · 아직 미공개',publish:'수합 공개',save_draft:'제출 초안 저장 · 최종 제출 전',submit:'최종 제출 접수',review:'제출 검토 결과 저장',withdraw:'제출 철회',open_correction:'정정 기간 저장'}
  for(const [action,text] of Object.entries(expected))assert.equal(label(copy({...collection,action})),text)
  assert.equal(label(message),'메시지 전송 · 2개 대화 접수')
  assert.equal(label({...message,action:'reply'}),'답장 전송 · 2개 대화 접수')
  assert.equal(label(timetable),'시간표 교환·이동 승인 · 수업 2건 반영')
})
test('선택한 단계의 정확한 원문과 계획 객체를 출처로 고정한다',()=>{
  const value=saved(), target={kind:'message',id:'thread-a'}, bound=origin(value,target)
  assert.equal(bound.plan,value.plan)
  assert.equal(bound.stepId,'step-1')
  assert.equal(bound.prompt,value.plan.steps[0].prompt)
  assert.deepEqual(bound.target,target)
  assert.notEqual(bound.target,target)
})
test('선택하지 않은 입력·다른 원문·학교·날짜는 계획 출처를 만들지 않는다',()=>{
  const value=saved()
  assert.equal(capture(undefined,'첫 업무 원문',scope,date),undefined)
  assert.equal(capture({...value,selectedId:undefined},'첫 업무 원문',scope,date),undefined)
  assert.equal(capture(value,'첫 업무 원문 ',scope,date),undefined)
  assert.equal(capture(value,'첫 업무 원문','another-school/member/user',date),undefined)
  assert.equal(capture(value,'첫 업무 원문',scope,'2026-11-13'),undefined)
})
test('화면만 연결한 단계는 출처를 만들지만 처리 결과가 있는 단계는 다시 연결하지 않는다',()=>{
  const value=saved(), opened={...value,outcomes:{'step-1':{kind:'opened'}}}
  assert(origin(opened))
  assert.equal(origin({...value,outcomes:{'step-1':{kind:'confirmed',receipt:{}}}}),undefined)
  assert.equal(origin({...value,outcomes:{'step-1':{kind:'recorded',results:[message]}}}),undefined)
})
test('목록을 다시 만들어 단계 번호·문구가 같아도 이전 출처의 늦은 결과를 받지 않는다',()=>{
  const before=saved(), bound=origin(before), newer={...before,plan:structuredClone(before.plan)}
  assert.equal(record(newer,bound,message,scope,date),newer)
  assert.equal(record(undefined,bound,message,scope,date),undefined)
})
test('현재 학교·소속·기준일 또는 결과의 범위가 달라지면 이전 처리를 기록하지 않는다',()=>{
  const value=saved(), bound=origin(value)
  assert.equal(record(value,bound,message,'other-scope',date),value)
  assert.equal(record(value,bound,message,scope,'2026-11-13'),value)
  const moved={...value,scope:'other'}
  assert.equal(record(moved,bound,message,scope,date),moved)
  assert.equal(record(value,bound,{...message,scope:'other'},scope,date),value)
})
test('검색으로 고른 대화와 다른 대화 결과를 붙이지 않는다',()=>{
  const value=saved({kind:'search',query:'자료',kinds:['message']}), bound=origin(value,{kind:'message',id:'thread-a'})
  assert.equal(record(value,bound,message,scope,date),value)
  const allowed={...message,deliveries:[message.deliveries[0]]}
  assert.equal(record(value,bound,allowed,scope,date).outcomes['step-1'].results[0].deliveries[0].threadId,'thread-a')
})
test('검색으로 고른 수합 번호와 다른 수합·잘못된 종류를 연결하지 않는다',()=>{
  const value=saved({kind:'search',query:'보고서',kinds:['collection']}), bound=origin(value,{kind:'collection',id:'collection-a'})
  assert.equal(record(value,bound,{...collection,requestId:'collection-b'},scope,date),value)
  assert.equal(record(value,bound,message,scope,date),value)
  assert.equal(record(value,origin(value,{kind:'message',id:'collection-a'}),collection,scope,date),value)
  assert.equal(record(value,bound,collection,scope,date).outcomes['step-1'].results[0].requestId,'collection-a')
})
test('서로 다른 명령 종류의 접수 결과를 다른 단계의 처리로 표시하지 않는다',()=>{
  const cases=[
    [{kind:'navigate',page:'messages'},collection],
    [{kind:'messageDraft',prompt:'메시지'},collection],
    [{kind:'collectionDraft',prompt:'수합'},message],
    [{kind:'navigate',page:'documents'},message],
    [{kind:'specialist',task:'timetablePrepare'},timetable],
    [{kind:'search',query:'수업',kinds:['course']},timetable],
    [{kind:'calendar',prompt:'일정'},collection],
  ]
  for(const [command,result] of cases){const value=saved(command),target=command.kind.endsWith('Draft')?{kind:'compose',id:'compose-a'}:undefined;assert.equal(record(value,origin(value,target),result,scope,date),value)}
})
test('메시지 초안·수합 초안·시간표 교환의 허용된 결과를 각각 연결한다',()=>{
  for(const [command,result] of [[{kind:'messageDraft',prompt:'메시지'},message],[{kind:'collectionDraft',prompt:'수합'},collection],[{kind:'specialist',task:'timetableExchange'},timetable],[{kind:'navigate',page:'timetable'},timetable]]){
    const value=saved(command), target=command.kind.endsWith('Draft')?{kind:'compose',id:'compose-a'}:undefined
    const matched=target?{...result,composeId:target.id}:result
    const updated=record(value,origin(value,target),matched,scope,date)
    assert.deepEqual(updated.outcomes['step-1'].results,[matched])
  }
})
test('새 작성은 정확한 작성 번호를 고정하고 출처 없는 기존 복구를 추측하지 않는다',()=>{
  for(const [kind,result] of [['messageDraft',message],['collectionDraft',collection]]){
    const value=saved({kind,prompt:'새 작성'}),target={kind:'compose',id:'compose-a'}
    assert.equal(origin(value),undefined)
    assert.equal(origin(value,{kind:'message',id:'thread-a'}),undefined)
    const bound=origin(value,target)
    assert.equal(record(value,bound,result,scope,date),value)
    assert.equal(record(value,bound,{...result,composeId:'compose-b'},scope,date),value)
    assert.equal(record(value,bound,{...result,composeId:'compose-a'},scope,date).outcomes['step-1'].kind,'recorded')
  }
})
test('AI 초안을 취소한 뒤 다른 답장이나 최종 제출을 첫 결과로 오귀속하지 않는다',()=>{
  const messagePlan=saved({kind:'messageDraft',prompt:'새 메시지'}),messageOrigin=origin(messagePlan,{kind:'compose',id:'compose-a'})
  for(const composeId of [undefined,'compose-a'])assert.equal(record(messagePlan,messageOrigin,{...message,action:'reply',composeId},scope,date),messagePlan)
  const collectionPlan=saved({kind:'collectionDraft',prompt:'새 수합'}),collectionOrigin=origin(collectionPlan,{kind:'compose',id:'compose-a'})
  for(const action of ['publish','save_draft','submit','review','withdraw','open_correction']){
    assert.equal(record(collectionPlan,collectionOrigin,{...collection,action},scope,date),collectionPlan)
    assert.equal(record(collectionPlan,collectionOrigin,{...collection,action,composeId:'compose-a'},scope,date),collectionPlan)
  }
})
test('작성 번호로 최초 저장한 수합만 이후 공개·제출을 같은 수합 결과로 이어 붙인다',()=>{
  const value=saved({kind:'collectionDraft',prompt:'새 수합'}),bound=origin(value,{kind:'compose',id:'compose-a'})
  let state=record(value,bound,{...collection,composeId:'compose-a'},scope,date)
  for(const action of ['publish','save_draft','submit'])state=record(state,bound,{...collection,action,key:action,resourceId:action+'-a'},scope,date)
  assert.deepEqual(state.outcomes['step-1'].results.map(row=>row.action),['create','publish','save_draft','submit'])
  assert.equal(record(state,bound,{...collection,action:'submit',key:'other-key',requestId:'other-request'},scope,date),state)
})
test('같은 작성 번호라도 새 계획 객체로 바뀐 뒤에는 늦게 온 접수를 옮기지 않는다',()=>{
  const value=saved({kind:'messageDraft',prompt:'새 메시지'}),bound=origin(value,{kind:'compose',id:'compose-a'})
  const newer={...value,plan:structuredClone(value.plan)}
  assert.equal(record(newer,bound,{...message,composeId:'compose-a'},scope,date),newer)
})
test('메시지 작성 출처는 원키 복구까지 유지하되 서버 명령은 바꾸지 않는다',()=>{
  const recipient={memberId:'member-other',name:'시험 교사',department:null,version:1}
  const draft={...blankMessageDraft(),body:'확인 부탁합니다',recipients:[recipient]}
  const plain=messageAttempt(draft,'member-self','message-request')
  const sourced=messageAttempt({...draft,composeId:'compose-a'},'member-self','message-request')
  assert.equal(sourced.composeId,'compose-a')
  assert.deepEqual(sourced.command,plain.command)
  assert.equal(Object.hasOwn(sourced.command,'composeId'),false)
  assert.deepEqual(retryMessageAttempt(sourced),sourced)
})
test('새 수동 메시지와 답장에는 폐기한 AI 작성 출처가 남지 않는다',()=>{
  const recipient={memberId:'member-other',name:'시험 교사',department:null,version:1}
  const draft={...blankMessageDraft(),body:'수동 작성',recipients:[recipient]}
  assert.equal(messageAttempt(draft,'member-self','message-request').composeId,undefined)
  const thread={id:'thread-a',version:1,participants:[{...recipient},{...recipient,memberId:'member-self'}]}
  assert.equal(messageAttempt({...draft,thread,composeId:'old-compose'},'member-self','reply-request').composeId,undefined)
})
test('원래 단계에 받은 결과는 현재 선택 번호로 잘못 옮겨 기록하지 않는다',()=>{
  const value=saved(), bound=origin(value), changed={...value,selectedId:'step-2'}
  const result=record(changed,bound,message,scope,date)
  assert.deepEqual(result.outcomes['step-1'].results,[message])
  assert.equal(result.outcomes['step-2'],undefined)
})
test('동일 요청 번호의 재확인과 다른 내용의 같은 번호는 결과를 중복 추가하지 않는다',()=>{
  const value=saved(), bound=origin(value), first=record(value,bound,message,scope,date)
  assert.equal(record(first,bound,structuredClone(message),scope,date),first)
  assert.equal(record(first,bound,{...message,recordedAt:'2026-11-12T02:00:00.000Z'},scope,date),first)
  assert.equal(first.outcomes['step-1'].results.length,1)
})
test('같은 여러 대화 중 답장을 기록하되 다른 대화를 새 처리 결과로 섞지 않는다',()=>{
  const value=saved(), bound=origin(value), first=record(value,bound,message,scope,date)
  const reply={...message,key:'reply-key',action:'reply',deliveries:[{threadId:'thread-b',messageId:'reply-message',sequence:4}]}
  const second=record(first,bound,reply,scope,date)
  assert.equal(second.outcomes['step-1'].results.length,2)
  assert.equal(second.outcomes['step-1'].results[0].deliveries.length,2)
  assert.equal(record(second,bound,{...reply,key:'different',deliveries:[{threadId:'thread-c',messageId:'another',sequence:1}]},scope,date),second)
})
test('같은 수합의 초안·공개·제출 초안·최종 제출을 각각 남기고 대상 수합을 고정한다',()=>{
  const value=saved({kind:'navigate',page:'collections'}), bound=origin(value)
  let state=record(value,bound,collection,scope,date)
  const stages=[
    {...collection,key:'publish-key',action:'publish',resourceVersion:2},
    {...collection,key:'draft-key',action:'save_draft',resourceId:'draft-a',resourceVersion:1},
    {...collection,key:'submit-key',action:'submit',resourceId:'submission-a',resourceVersion:1},
  ]
  for(const result of stages)state=record(state,bound,result,scope,date)
  assert.deepEqual(state.outcomes['step-1'].results.map(row=>row.action),['create','publish','save_draft','submit'])
  assert.deepEqual(state.outcomes['step-1'].results.map(row=>row.resourceId),['collection-a','collection-a','draft-a','submission-a'])
  assert.equal(record(state,bound,{...collection,key:'another-key',requestId:'collection-b'},scope,date),state)
})
test('시간표 승인은 같은 교환 요청의 결과만 이어 기록한다',()=>{
  const value=saved({kind:'specialist',task:'timetableExchange'}), bound=origin(value), first=record(value,bound,timetable,scope,date)
  assert.equal(record(first,bound,{...timetable,key:'another-key',requestId:'exchange-b'},scope,date),first)
  assert.equal(first.outcomes['step-1'].results[0].changedLessonIds.length,2)
})
test('화면 연결이나 개인 업무 결과를 다른 의미의 처리 결과로 덮어쓰지 않는다',()=>{
  const value=saved(), bound=origin(value), first=record({...value,outcomes:{'step-1':{kind:'opened'}}},bound,message,scope,date)
  assert.equal(first.outcomes['step-1'].kind,'recorded')
  assert.equal(mark(first,'첫 업무 원문','opened',scope,date),first)
  const confirmed={...value,outcomes:{'step-1':{kind:'confirmed',receipt:{kind:'taskChange',key:'key',id:'id',title:'title',version:1}}}}
  assert.equal(record(confirmed,bound,message,scope,date),confirmed)
})
test('원본 계획·접수 자료를 수정하지 않고 후속 원본 변경에도 표시 기록은 유지한다',()=>{
  const value=freeze(saved()), before=JSON.stringify(value), bound=origin(value), raw=structuredClone(message)
  const result=record(value,bound,raw,scope,date)
  assert.equal(JSON.stringify(value),before)
  assert.equal(result.plan,value.plan)
  raw.deliveries[0].messageId='changed-after-record'
  raw.deliveries.push({threadId:'other',messageId:'extra',sequence:1})
  assert.equal(result.outcomes['step-1'].results[0].deliveries[0].messageId,'message-a')
  assert.equal(result.outcomes['step-1'].results[0].deliveries.length,2)
})
test('처리 기록이 있는 단계는 다음 선택에서 건너뛰되 단순 화면 연결은 처리로 세지 않는다',()=>{
  assert.equal(hasResult(undefined),false)
  assert.equal(hasResult({kind:'opened'}),false)
  assert.equal(hasResult({kind:'confirmed',receipt:{}}),true)
  assert.equal(hasResult({kind:'recorded',results:[message]}),true)
  const value=saved(), first=record(value,origin(value),message,scope,date)
  assert.equal(next({...first,selectedId:undefined}).id,'step-2')
  const all={...first,outcomes:{...first.outcomes,'step-2':{kind:'recorded',results:[timetable]}}}
  assert.equal(next({...all,selectedId:undefined}),undefined)
})
console.log(`업무 접수 결과 연결: ${passed} 통과, ${failed} 실패`)
if(failed)process.exit(1)
