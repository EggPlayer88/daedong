import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { parseWorkspaceCommand, calendarQuestion, continueCalendar } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/workspace-commands.ts'
  export * from '../apps/workhub/src/assistant/calendar-conversation.ts'
`)
const date = '2026-11-04'
const start = (text, basis = date) => {
  const result = parseWorkspaceCommand(text, basis)
  assert.equal(result?.kind, 'calendar', text)
  return result
}
const answer = (partial, reply, basis = date) => {
  const result = continueCalendar(Object.freeze(partial), reply, basis)
  assert.equal(result.kind, 'calendar', reply)
  return result.command
}
const rejects = (partial, reply) =>
  assert.equal(continueCalendar(Object.freeze(partial), reply, date).kind, 'clarify', reply)

let passed = 0, failed = 0
function test(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) }
}

test('날짜와 제목이 있는 첫 요청 뒤에는 시각만으로 초안을 완성한다', () => {
  for (const prompt of ['내일 회의 일정 잡아줘', '내일 회의 잡아줘']) {
    const partial = start(prompt)
    assert.match(calendarQuestion(partial), /몇 시부터 몇 시까지/)
    const ready = answer(partial, '오후 3시부터 4시')
    assert.deepEqual([ready.title, ready.date, ready.startTime, ready.endTime], ['회의', '2026-11-05', '15:00', '16:00'])
    assert.equal(calendarQuestion(ready), null)
    assert.equal(ready.prompt, prompt + '\n오후 3시부터 4시')
  }
})

test('제목, 날짜, 시작과 종료를 각각 받아도 먼저 입력한 값이 그대로다', () => {
  let draft = start('일정 잡아줘')
  assert.match(calendarQuestion(draft), /제목/)
  draft = answer(draft, '학년 협의회')
  assert.match(calendarQuestion(draft), /날짜/)
  draft = answer(draft, '모레')
  assert.match(calendarQuestion(draft), /몇 시부터/)
  draft = answer(draft, '오후 1시 반부터')
  assert.match(calendarQuestion(draft), /몇 시에 끝/)
  draft = answer(draft, '오후 3시')
  assert.deepEqual([draft.title, draft.date, draft.startTime, draft.endTime], ['학년 협의회', '2026-11-06', '13:30', '15:00'])
  assert.equal(calendarQuestion(draft), null)
})

test('종료만 먼저 말한 경우 뒤에 온 시각은 시작이다', () => {
  const draft = answer(start('내일 회의 일정 만들어줘'), '16:30까지')
  assert.match(calendarQuestion(draft), /시작/)
  const ready = answer(draft, '시작은 15:00')
  assert.deepEqual([ready.startTime, ready.endTime], ['15:00', '16:30'])
})

test('종일을 명시하면 시각을 묻지 않고, 비어 있는 제목만 채울 수 있다', () => {
  let draft = start('내일 일정 잡아줘')
  draft = answer(draft, '종일이요')
  assert.match(calendarQuestion(draft), /제목/)
  const ready = answer(draft, '제목: 교육과정 협의')
  assert.equal(calendarQuestion(ready), null)
  assert.deepEqual([ready.title, ready.allDay, ready.startTime, ready.endTime], ['교육과정 협의', true, null, null])
})

test('없는 날짜·모호한 날짜·역전 시각을 답해도 기존 입력은 보존된다', () => {
  const draft = start('오후 3시 회의 일정 만들어줘')
  for (const reply of ['2026-02-30', '금요일', '내일부터 모레까지', '종료: 14:00', '종료: 15:00', '4시까지', '24:00까지']) rejects(draft, reply)
  const withDate = answer(draft, '날짜: 다음 주 월요일')
  const ready = answer(withDate, '종료는 오후 4시예요')
  assert.deepEqual([ready.date, ready.title, ready.startTime, ready.endTime], ['2026-11-09','회의','15:00','16:00'])
})

test('부분 답변에 같은 날짜를 포함해도 받을 수 있지만 다른 값은 덮어쓰지 않는다', () => {
  const draft = start('내일 회의 일정 잡아줘')
  const ready = answer(draft, '내일 15:00~16:00')
  assert.equal(ready.date, draft.date)
  for (const reply of ['모레 15:00~16:00', '연수 15:00~16:00']) rejects(draft, reply)
})

test('종일과 시각을 섞거나 시작/종료 표기를 모순되게 조합하지 않는다', () => {
  const draft = start('내일 15:00부터 회의 일정 만들어줘')
  for (const reply of ['종일', '시작: 16:00까지', '종료: 16:00부터', '종료: 15:00~16:00', '종료: 종일']) rejects(draft, reply)
  const allDay = start('종일 회의 일정 만들어줘')
  rejects(allDay, '내일 오후 3시')
})

test('취소는 초안 대화만 끝낸다. 인용, 새 명령, 다른 질문은 값을 메우지 않는다', () => {
  const draft = start('내일 종일 일정 만들어줘')
  for (const reply of ['그만', '취소', '일정 초안 취소해 주세요.'])
    assert.deepEqual(continueCalendar(draft, reply, date), { kind: 'cancel' })
  for (const reply of ['“취소”', '내 할 일 완료해줘', '시간표 열어줘', '어떻게 하면 돼?', '회의하지 말고', '오늘 날씨를 알려줘']) rejects(draft, reply)
  assert.equal(answer(draft, '준비 회의').title, '준비 회의')
})

test('제어 문자·깨진 UTF-16·지나치게 긴 제목·입력은 이어 쓰지 않는다', () => {
  const draft = start('내일 종일 일정 만들어줘')
  for (const reply of ['회의\u0085', '회의\ud800', '가'.repeat(101), '가'.repeat(4001)]) rejects(draft, reply)
})

test('인식한 날짜를 나중 응답의 기준일로 다시 계산하지 않는다', () => {
  const draft = start('내일 회의 일정 잡아줘', '2026-12-31')
  const ready = answer(draft, '09:00~10:00', '2027-01-01')
  assert.equal(ready.date, '2027-01-01')
})

test('언제든 이미 채운 시간의 다른 뜻을 사용자에게 다시 확인한다', () => {
  const draft = start('내일 오후 3시 회의 일정 잡아줘')
  rejects(draft, '오후 4시부터')
  rejects(draft, '오후 1시까지')
  assert.equal(answer(draft, '오후 4시까지').endTime, '16:00')
})

test('회의 단축 요청도 날짜는 추정하지 않으며 혼합된 수행 요청을 접수하지 않는다', () => {
  assert.equal(start('회의 잡아줘').date, null)
  for (const text of ['자료 확인을 완료하고 내일 회의 잡아줘', '회의를 수정해 주고 내일 연수 잡아줘'])
    assert.equal(parseWorkspaceCommand(text, date)?.kind, 'clarify', text)
})
test('완성된 일정에 추가 답변을 붙여 두 번째 전달로 만들지 않는다', () => {
  rejects(start('내일 종일 회의 일정 잡아줘'), '오후 3시')
})
console.log(`\n일정 대화 이어 쓰기: ${passed} 통과, ${failed} 실패`)
if (failed) process.exitCode = 1
