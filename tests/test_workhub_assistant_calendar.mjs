import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { buildAssistantCalendarDraft: build, validateAssistantCalendarDraftRequest: validate, fixtureData } = await loadBrowserModule(`
  export * from '../apps/workhub/src/calendar/assistant-draft.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
`)
const member = fixtureData.memberships.find(row => row.id === 'gaon-soyeon')
const date = fixtureData.basisDate
const command = () => ({ title: '부서 회의', date, startTime: '15:00', endTime: '16:00', allDay: false })
const request = () => ({ id: 'calendar-draft-1', schoolId: member.schoolId, memberId: member.id, draft: build(command(), member, date) })
let failures = 0
function test(name, run) { try { run(); console.log(`  ✓ ${name}`) } catch (error) { failures++; console.log(`  ✗ ${name}: ${error.stack}`) } }
const rejects = (fn, code = 'INVALID_INPUT') => assert.throws(fn, error => error.code === code)

test('대화 일정은 나만 보기와 본인 대상으로 만들고 외부 값 참조를 공유하지 않는다', () => {
  const source = command(), result = build(source, member, date)
  assert.equal(result.visibility, 'private')
  assert.deepEqual(result.audience, { all: false, groups: [], includeMemberIds: [member.id], excludeMemberIds: [] })
  source.title = '외부 변경'; assert.equal(result.title, '부서 회의')
  assert.equal(result.startDate, result.endDate)
})
test('날짜나 제목이 없으면 임의로 채우지 않고 거절한다', () => {
  for (const changed of [{ date: null }, { date: '' }, { title: '' }, { title: ' ' }]) rejects(() => build({ ...command(), ...changed }, member, date))
})
test('누락된 시간은 빈칸으로 두고 종일은 숨은 시간을 제거한다', () => {
  const partial = build({ ...command(), startTime: null, endTime: null }, member, date)
  assert.equal(partial.startTime, ''); assert.equal(partial.endTime, '')
  const allDay = build({ ...command(), allDay: true }, member, date)
  assert.equal(allDay.startTime, ''); assert.equal(allDay.endTime, '')
})
test('윤일·잘못된 날짜·역전 시간·자정 넘김을 검증한다', () => {
  assert.equal(build({ ...command(), date: '2028-02-29' }, member, date).startDate, '2028-02-29')
  for (const changed of [{ date: '2027-02-29' }, { date: '2026-13-01' }, { startTime: '24:00' }, { endTime: '14:00' }, { endTime: '15:00' }, { startTime: '23:00', endTime: '01:00' }]) rejects(() => build({ ...command(), ...changed }, member, date))
})
test('제목 코드포인트 길이와 제어 문자·짝 없는 서로게이트를 검사한다', () => {
  assert.equal(Array.from(build({ ...command(), title: '😀'.repeat(100) }, member, date).title).length, 100)
  for (const title of ['😀'.repeat(101), '회의\u0085', '회의\uD800', '회의\n다음']) rejects(() => build({ ...command(), title }, member, date))
})
test('비활성·종료 소속과 잘못된 기준일로 초안을 만들거나 열지 않는다', () => {
  rejects(() => build(command(), { ...member, active: false }, date), 'INACTIVE_MEMBERSHIP')
  rejects(() => validate(request(), { ...member, validThrough: '2000-01-01' }, date), 'INACTIVE_MEMBERSHIP')
  rejects(() => build(command(), member, 'not-a-date'), 'INACTIVE_MEMBERSHIP')
})
test('이관된 초안은 학교·소속을 다시 확인하고 복사한다', () => {
  const raw = request(), checked = validate(raw, member, date)
  raw.draft.title = '이관 뒤 외부 수정'; assert.equal(checked.draft.title, '부서 회의')
  rejects(() => validate({ ...request(), schoolId: 'other' }, member, date), 'FORBIDDEN')
  rejects(() => validate({ ...request(), memberId: 'other' }, member, date), 'FORBIDDEN')
})
test('대화에서 전달한 초안의 공유 확대·외부 대상·그룹 지정을 거절한다', () => {
  for (const patch of [{ visibility: 'school' }, { visibility: 'audience' }, { audience: { all: true, groups: [], includeMemberIds: [member.id], excludeMemberIds: [] } }, { audience: { all: false, groups: [], includeMemberIds: ['other'], excludeMemberIds: [] } }, { audience: { all: false, groups: [{}], includeMemberIds: [member.id], excludeMemberIds: [] } }]) {
    const raw = request(); Object.assign(raw.draft, patch); rejects(() => validate(raw, member, date))
  }
})
test('이관 경계에서 형식·날짜·시간·숨은 종일 시간을 다시 검사한다', () => {
  for (const raw of [null, [], {}, { ...request(), id: '../foreign' }, { ...request(), draft: null }]) rejects(() => validate(raw, member, date))
  for (const patch of [{ title: [] }, { startDate: '2026-02-31' }, { endDate: '2099-01-01' }, { startTime: '25:30' }, { allDay: true }, { description: '\u0000' }]) {
    const raw = request(); Object.assign(raw.draft, patch); rejects(() => validate(raw, member, date))
  }
})
if (failures) process.exit(1)
