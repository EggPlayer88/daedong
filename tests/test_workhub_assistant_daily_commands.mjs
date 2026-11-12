import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand: parse } = await loadBrowserModule(`export * from '../apps/workhub/src/assistant/workspace-commands.ts'`)
const { parseWorkspacePlan: plan } = await loadBrowserModule(`export * from '../apps/workhub/src/assistant/workspace-plan.ts'`)
const day = '2026-11-11'
let failed = 0
function test(name, run) { try { run(); console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }
test('오늘 요약과 일반 할 일 목록을 구별한다', () => {
  for (const text of ['오늘 업무 요약해줘','오늘 내 할 일 보여줘','내 업무 현황 알려줘','오늘 일정과 할 일 보여줘']) assert.deepEqual(parse(text,day),{kind:'daily',view:'overview',date:day},text)
  assert.deepEqual(parse('내 할 일 보여줘',day),{kind:'navigate',page:'tasks'})
})
test('업무 알림은 메시지 작성과 구별한다', () => {
  for (const text of ['알림 보여줘','내 업무 알림 확인해줘','업무 알림 목록 열어줘']) assert.deepEqual(parse(text,day),{kind:'daily',view:'notifications',date:day},text)
  assert.deepEqual(parse('메시지 열어줘',day),{kind:'navigate',page:'messages'})
})
test('급식은 생략한 날짜만 오늘로 잡고 내일·명시 날짜는 보존한다', () => {
  for (const [text,date] of [['급식 알려줘',day],['오늘 급식 메뉴 보여줘',day],['내일 급식 알려줘','2026-11-12'],['2026-11-16 급식은 뭐야','2026-11-16'],['오늘의 급식 식단 알려줘',day]]) assert.deepEqual(parse(text,day),{kind:'daily',view:'meals',date},text)
})
test('해석할 수 없는 급식 날짜는 추측하지 않는다', () => {
  for (const text of ['2026-02-30 급식 알려줘','언젠가 급식 알려줘','다다음 학기 급식 알려줘']) assert.equal(parse(text,day)?.kind,'clarify',text)
})
test('인용·부정·일반 질문을 조회 명령으로 실행하지 않는다', () => {
  for (const text of ['“오늘 업무 요약해줘”','알림 보여주지 마','급식 보여주지 마','오늘 업무 요약은 왜 필요한가요','급식은 어떻게 구성되나요']) assert.notEqual(parse(text,day)?.kind,'daily',text)
})
test('급식 변경이나 복합 명령을 단일 조회로 오인하지 않는다', () => {
  for (const text of ['급식 메뉴 바꿔줘','오늘 업무 요약해줘 그리고 할 일 모두 삭제해줘','알림 모두 읽음 처리해줘']) assert.notEqual(parse(text,day)?.kind,'daily',text)
})
test('여러 조회를 명시한 계획도 원본·날짜 고정한 검토 목록이다', () => {
  const result=plan('오늘 업무 요약해줘; 내일 급식 알려줘; 업무 알림 보여줘',day)
  assert.equal(result.kind,'plan');assert.deepEqual(result.steps.map(step=>step.command.view),['overview','meals','notifications'])
  assert.equal(result.steps[1].command.date,'2026-11-12');assert.equal(result.steps.length,3)
  assert(result.steps.every(step=>!('requestKey' in step)))
})
if(failed) process.exit(1)
