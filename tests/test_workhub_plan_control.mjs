import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspacePlanControl: parse, parseWorkspacePlan, nextWorkspacePlanStep: next, recordWorkspacePlanOutcome: record } = await loadBrowserModule(`
export * from '../apps/workhub/src/assistant/plan-control.ts'
export * from '../apps/workhub/src/assistant/workspace-plan.ts'`)
const date = '2026-11-11', scope = 'school/member/user'
let failed = 0
function test(name, run) { try { run(); console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }
const plan = parseWorkspacePlan('할 일 자료 확인 완료해줘 그리고 내일 오후 3시부터 4시까지 협의회 일정 만들어줘', date)
assert.equal(plan?.kind, 'plan')
const saved = { plan, scope, selectedId: plan.steps[0].id }
const receipt = { kind:'taskChange', key:'request-original', id:'task-original', title:'자료 확인', version:2, result:{private:'not copied'} }

test('다음 업무의 명시 선택만 분류한다',()=> {
  for (const text of ['다음 업무','다음 단계','다음 업무로 넘어가줘','다음 단계 진행해주세요','다음 업무 준비해 주세요.']) assert.deepEqual(parse(text),{kind:'next'},text)
})
test('숫자와 한국어 단계 번호는 같은 선택 번호다',()=> {
  for (const [text,number] of [['1번',1],['2번 단계',2],['3단계 선택해줘',3],['첫 번째 단계',1],['두 번째 업무로 넘어가줘',2],['셋째 단계',3],['넷째',4],['다섯 번째 단계',5]]) assert.deepEqual(parse(text),{kind:'choose',number},text)
})
test('범위를 벗어난 명시 번호도 유료 일반 질문으로 돌아가지 않도록 분류한다',()=> {
  assert.deepEqual(parse('0번 단계'),{kind:'choose',number:0})
  assert.deepEqual(parse('99번'),{kind:'choose',number:99})
})
test('목록 확인·원문 복원·목록 닫기를 실행 명령과 구분한다',()=> {
  for (const [text,kind] of [['업무 목록 보여줘','show'],['단계 목록 확인','show'],['원문 다시 검토','restore'],['전체 요청 다시 복원해줘','restore'],['업무 목록 닫아줘','dismiss'],['단계 목록 닫기','dismiss']]) assert.deepEqual(parse(text),{kind},text)
})
test('인용·부정·일반 질문·메시지 본문에서 제어 명령을 추출하지 않는다',()=> {
  for (const text of ['“다음 업무”','다음 업무로 넘어가지 마','다음 업무가 무엇인지 설명해줘','메시지 초안: 다음 업무','업무 목록 닫아줘 그리고 시간표 보여줘','학생 기록: 2번','다음 단계도 검토해야 할까?']) assert.equal(parse(text),null,text)
})
test('잘못된 제어 입력은 실행 후보를 만들지 않는다',()=> {
  for (const text of [null,undefined,{},[],true,42,'다음 업무\u0000','']) assert.equal(parse(text),null)
})
test('첫 다음은 첫 단계이며 선택 뒤에는 다음 단계만 준비한다',()=> {
  assert.equal(next({...saved,selectedId:undefined}).id,plan.steps[0].id)
  assert.equal(next(saved).id,plan.steps[1].id)
  assert.equal(next({...saved,selectedId:plan.steps[1].id}),undefined)
  assert.equal(next({...saved,selectedId:'missing-step'}),undefined)
})
test('화면 연결은 서버 처리 확인이 아니다',()=> {
  const result=record(saved,plan.steps[0].prompt,'opened',scope,date)
  assert.deepEqual(result.outcomes,{[plan.steps[0].id]:{kind:'opened'}})
  assert.equal(saved.outcomes,undefined)
})
test('원문을 바꿔 실행하거나 선택하지 않은 요청을 다른 단계에 붙이지 않는다',()=> {
  assert.equal(record(saved,plan.steps[0].prompt+' ','opened',scope,date),saved)
  assert.equal(record(saved,plan.steps[1].prompt,'confirmed',scope,date,receipt),saved)
  const unselected={...saved,selectedId:undefined}
  assert.equal(record(unselected,plan.steps[0].prompt,'confirmed',scope,date,receipt),unselected)
})
test('다른 소속·날짜·이미 닫힌 계획의 늦은 결과를 기록하지 않는다',()=> {
  assert.equal(record(saved,plan.steps[0].prompt,'confirmed','other/member/user',date,receipt),saved)
  assert.equal(record(saved,plan.steps[0].prompt,'confirmed',scope,'2026-11-12',receipt),saved)
  assert.equal(record(undefined,plan.steps[0].prompt,'confirmed',scope,date,receipt),undefined)
})
test('검증된 개인 업무 결과의 필요한 접수 요약만 보관한다',()=> {
  const result=record(saved,plan.steps[0].prompt,'confirmed',scope,date,receipt)
  assert.deepEqual(result.outcomes[plan.steps[0].id],{kind:'confirmed',receipt:{kind:'taskChange',key:'request-original',id:'task-original',title:'자료 확인',version:2}})
  assert.equal(result.outcomes[plan.steps[0].id].receipt.result,undefined)
  assert.equal(result.plan,plan)
})
test('확인 결과가 없는 준비·거절을 서버 처리로 표시하지 않는다',()=> {
  for (const value of [undefined,{...receipt,key:''},{...receipt,id:''},{...receipt,title:''},{...receipt,version:0},{...receipt,version:1.5},{...receipt,version:NaN},{...receipt,kind:'calendarCreate'}]) assert.equal(record(saved,plan.steps[0].prompt,'confirmed',scope,date,value),saved)
})
test('일정은 일정 접수증만 처리 확인으로 표시하고 다른 단계 결과는 보존한다',()=> {
  const previous=record(saved,plan.steps[0].prompt,'confirmed',scope,date,receipt)
  const chosen={...previous,selectedId:plan.steps[1].id}
  assert.equal(record(chosen,plan.steps[1].prompt,'confirmed',scope,date,receipt),chosen)
  const result=record(chosen,plan.steps[1].prompt,'confirmed',scope,date,{...receipt,kind:'calendarCreate',id:'calendar-one',title:'협의회',version:1})
  assert.equal(result.outcomes[plan.steps[0].id].receipt.id,'task-original')
  assert.equal(result.outcomes[plan.steps[1].id].receipt.id,'calendar-one')
})
test('서버 처리 확인 결과를 이후 화면 열기나 중복 응답으로 덮어쓰지 않는다',()=> {
  const confirmed=record(saved,plan.steps[0].prompt,'confirmed',scope,date,receipt)
  assert.equal(record(confirmed,plan.steps[0].prompt,'opened',scope,date),confirmed)
  assert.equal(record(confirmed,plan.steps[0].prompt,'confirmed',scope,date,{...receipt,key:'another-request'}),confirmed)
})
test('다음 단계는 서버 확인된 업무를 건너뛰고 새로운 요청으로 다시 준비하지 않는다',()=> {
  const first=record(saved,plan.steps[0].prompt,'confirmed',scope,date,receipt)
  assert.equal(next({...first,selectedId:undefined}).id,plan.steps[1].id)
  const both=record({...first,selectedId:plan.steps[1].id},plan.steps[1].prompt,'confirmed',scope,date,{...receipt,kind:'calendarCreate',id:'calendar-one',title:'협의회',version:1})
  assert.equal(next({...both,selectedId:undefined}),undefined)
  assert.equal(next({...both,selectedId:plan.steps[0].id}),undefined)
})
test('시간표·문서 열기는 개인 업무 접수증으로 서버 완료를 가장할 수 없다',()=> {
  const otherPlan=parseWorkspacePlan('시간표 보여줘 그리고 평가계획서 작성 화면 열어줘',date)
  const other={plan:otherPlan,scope,selectedId:otherPlan.steps[0].id}
  assert.equal(record(other,otherPlan.steps[0].prompt,'confirmed',scope,date,receipt),other)
})
if(failed)process.exit(1)
