import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { captureTaskPlanOrigin: capture, recordTaskPlanReceipt: record, parseWorkspacePlan: parse, hasWorkspacePlanResult, nextWorkspacePlanStep } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/plan-task-receipts.ts'
  export * from '../apps/workhub/src/assistant/workspace-plan.ts'
  export * from '../apps/workhub/src/assistant/plan-control.ts'
`)
const date='2026-11-13',scope='school/member/user'
const plan=parse('안내장 준비 할 일로 넣어 줄래?\n내일 학년 회의 일정 잡아줘',date)
assert.equal(plan.kind,'plan')
const saved={instanceId:'instance-one',plan,scope,selectedId:plan.steps[0].id}
const prompt=plan.steps[0].prompt
const receipt={requestKey:'task-request-one',proposalId:'proposal-one',proposalVersion:2,taskId:'task-one',taskVersion:1,threadVersion:2}
const check=(name,run)=>{run();console.log('  ✓ '+name)}
check('B1 선택된 할 일 단계의 계획 판·요청·소속·날짜를 접수 전에 고정한다',()=>{
  assert.deepEqual(capture(saved,prompt),{instanceId:'instance-one',stepId:'step-1',prompt,scope,date})
  for(const value of [undefined,{...saved,instanceId:undefined},{...saved,selectedId:'step-2'},{...saved,selectedId:'missing'}]) assert.equal(capture(value,prompt),undefined)
  assert.equal(capture(saved,prompt+' 다른 내용'),undefined)
})
check('B1 실제 할 일 접수증이 온 단계만 서버 처리 확인으로 고정한다',()=>{
  const before=structuredClone(saved),origin=capture(saved,prompt)
  const next=record(Object.freeze(saved),origin,receipt,'안내장 준비',scope,date)
  assert.deepEqual(next.outcomes['step-1'],{kind:'confirmed',receipt:{kind:'taskCreate',key:receipt.requestKey,id:receipt.taskId,title:'안내장 준비',version:1}})
  assert.deepEqual(saved,before);assert.equal(hasWorkspacePlanResult(next.outcomes['step-1']),true)
  assert.equal(nextWorkspacePlanStep(next).id,'step-2')
  assert.equal(capture(next,prompt),undefined)
  assert.equal(record(next,origin,{...receipt,taskId:'another'},'다른 제목',scope,date),next)
})
check('B1 응답 시 다른 단계를 보고 있어도 접수한 원래 단계로 귀속한다',()=>{
  const origin=capture(saved,prompt),changed={...saved,selectedId:'step-2'}
  const next=record(changed,origin,receipt,'안내장 준비',scope,date)
  assert.equal(next.selectedId,'step-2');assert.equal(next.outcomes['step-1'].kind,'confirmed');assert.equal(next.outcomes['step-2'],undefined)
})
check('B1 새 목록·다른 소속·날짜에는 늦은 이전 접수증을 붙이지 않는다',()=>{
  const origin=capture(saved,prompt)
  for(const changed of [undefined,{...saved,instanceId:'new-instance'}, {...saved,scope:'other/member'}, {...saved,plan:{...plan,basisDate:'2026-11-14'}},
    {...saved,plan:{...plan,steps:[{...plan.steps[0],prompt:'다른 요청'}]}}, {...saved,plan:{...plan,steps:[{...plan.steps[0],command:{kind:'navigate',page:'tasks'}}]}}])
    assert.equal(record(changed,origin,receipt,'안내장 준비',scope,date),changed)
  for(const [currentScope,currentDate] of [['other/member',date],[scope,'2026-11-14']]) assert.equal(record(saved,origin,receipt,'안내장 준비',currentScope,currentDate),saved)
})
check('B1 저장 근거 없는 결과·열기만 한 단계·기존 처리 결과를 구별한다',()=>{
  const origin=capture(saved,prompt)
  for(const wrong of [{...receipt,taskId:''},{...receipt,requestKey:''},{...receipt,taskVersion:0},{...receipt,taskVersion:1.5}])
    assert.equal(record(saved,origin,wrong,'안내장 준비',scope,date),saved)
  assert.equal(record(saved,origin,receipt,' ',scope,date),saved)
  const opened={...saved,outcomes:{'step-1':{kind:'opened'}}}
  assert.ok(capture(opened,prompt));assert.equal(record(opened,capture(opened,prompt),receipt,'안내장 준비',scope,date).outcomes['step-1'].kind,'confirmed')
  const recorded={...saved,outcomes:{'step-1':{kind:'recorded',results:[]}}}
  assert.equal(capture(recorded,prompt),undefined);assert.equal(record(recorded,origin,receipt,'안내장 준비',scope,date),recorded)
})
console.log('\nAI 실사용 계획 결과 회귀: 5묶음 통과')
