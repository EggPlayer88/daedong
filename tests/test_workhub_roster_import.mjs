import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
import { teachingRosterFixture } from './fixtures/teaching-roster-import.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/teaching/roster-import'; export {parseRosterCsv} from '../apps/workhub/src/teaching/csv';`)
const fixture = teachingRosterFixture, csv = rows => m.rosterRawCsv(rows)
let passed = 0
async function test(name, run) { await run(); passed++; console.log('  ✓', name) }
await test('신규 후보·정확 일치·파일 누락 유지 수를 구분하고 원본은 바꾸지 않는다', () => {
  const { course, row } = fixture(), original = structuredClone(course)
  const result = m.compareRosterImport([course.students[0], row], course, '2026-03-03', '2026-07-16')
  assert.deepEqual([result.added, result.matched, result.corrections, result.kept], [1, 1, 0, 1]); assert.deepEqual(course, original)
})
await test('같은 이름만으로 학생을 연결하지 않는다', () => {
  const { course, row } = fixture(); row.name = course.students[0].name
  const result = m.compareRosterImport([row], course, '2026-03-03', '2026-07-16')
  assert.equal(result.rows[0].state, 'new'); assert.equal(result.rows[0].existing, null)
})
await test('앞자리 0이 있는 공식 학생번호는 CSV와 XLSX에서 그대로 유지한다', () => {
  const { course } = fixture(); const sheets = m.rosterWorkbookSheets(course, true), raw = m.rosterWorkbookCsv(sheets, course)
  assert.equal(m.parseRosterCsv(raw)[0].schoolStudentKey, '001001'); assert.ok(m.rosterWorkbook(course, true).length > 100)
})
await test('이름·학년·반·번호가 바뀌면 각각 정정 필요로 막는다', () => {
  for (const [key, value] of [['name', '다른 이름'], ['grade', 2], ['classLabel', '3'], ['seatNumber', 9]]) {
    const { course } = fixture(), row = { ...course.students[0], [key]: value }
    const r = m.compareRosterImport([row], course, '2026-03-03', '2026-07-16')
    assert.equal(r.corrections, 1); assert.equal(r.rows[0].state, 'correction'); assert.equal(r.rows[0].existing.id, 'student-a')
  }
})
await test('기존 학생의 수강 기간을 명부 가져오기로 바꾸지 않는다', () => {
  const { course } = fixture(); const r = m.compareRosterImport([course.students[0]], course, '2026-04-01', '2026-07-16')
  assert.equal(r.corrections, 1); assert.match(r.rows[0].differences[0], /수강 기간/)
})
await test('같은 기간 같은 좌석에 다른 학생번호면 확인 전까지 막는다', () => {
  const { course, row } = fixture(); row.seatNumber = 1
  assert.equal(m.compareRosterImport([row], course, '2026-03-03', '2026-07-16').corrections, 1)
  course.students[0].validThrough = '2026-03-10'
  assert.equal(m.compareRosterImport([row], course, '2026-03-11', '2026-07-16').corrections, 0)
})
await test('잘못된 날짜·역전·수업 기간 밖 입력을 거부한다', () => {
  const { course, row } = fixture()
  for (const dates of [['2026-02-30', '2026-07-16'], ['2026-07-17', '2026-07-16'], ['2026-03-01', '2026-07-16'], ['2026-03-03', '2026-08-01']])
    assert.notEqual(m.compareRosterImport([row], course, ...dates).periodError, '')
})
await test('현재 명부의 중복 공식 학생번호도 임의로 한 학생에 맞추지 않는다', () => {
  const { course } = fixture(); course.students[1].schoolStudentKey = course.students[0].schoolStudentKey
  const r = m.compareRosterImport([course.students[0]], course, '2026-03-03', '2026-07-16')
  assert.equal(r.corrections, 1); assert.equal(r.rows[0].existing, null)
})
await test('확인 기준판은 목록 정렬에 영향받지 않고 학생·수업·소속 변경을 감지한다', () => {
  const { course } = fixture(), basis = m.rosterReviewBasis(course), reversed = structuredClone(course); reversed.students.reverse()
  assert.equal(m.rosterReviewBasis(reversed), basis)
  for (const mutate of [c => c.course.version++, c => c.students[0].name += '정정', c => c.students[0].version++, c => c.memberId = 'other', c => c.ownerUserId = 'other', c => c.course.validFrom = '2026-03-04']) {
    const changed = structuredClone(course); mutate(changed); assert.notEqual(m.rosterReviewBasis(changed), basis)
  }
})
await test('최종 저장 전 기준·판·정정·권한을 다시 검증한다', () => {
  const { course, row, draft } = fixture(), input = { ...draft, roster: [row], rosterBasis: m.rosterReviewBasis(course) }
  assert.equal(m.assertRosterImportReady(input, course).added, 1)
  for (const value of [{ ...input, rosterBasis: undefined }, { ...input, expectedVersion: 1 }, { ...input, roster: [] }]) assert.throws(() => m.assertRosterImportReady(value, course))
  const revoked = structuredClone(course); revoked.course.canManageRoster = false; assert.throws(() => m.assertRosterImportReady(input, revoked))
})
await test('학교·수업이 다른 엑셀과 메타 없는 파일을 거부한다', () => {
  const { course } = fixture()
  for (const mutate of [s => s.pop(), s => s[2].rows[1][1] = 'school-other', s => s[2].rows[2][1] = 'course-other']) {
    const sheets = m.rosterWorkbookSheets(course, true); mutate(sheets); assert.throws(() => m.rosterWorkbookCsv(sheets, course))
  }
})
await test('양식 열 변경·추가 열·공백 파일·중복 학생을 거부한다', () => {
  const { course } = fixture()
  for (const mutate of [s => s[0].rows[0].reverse(), s => s[0].rows[1].push('추가'), s => s[0].rows.splice(1), s => s[0].rows.push(s[0].rows[1])]) {
    const sheets = m.rosterWorkbookSheets(course, true); mutate(sheets); assert.throws(() => m.rosterWorkbookCsv(sheets, course))
  }
})
await test('500행 한도를 넘긴 현재 명부 내려받기와 가져오기를 거부한다', () => {
  const { course } = fixture(); course.students = Array.from({ length: 501 }, (_, i) => ({ ...course.students[0], id: `s${i}`, schoolStudentKey: `k${i}`, seatNumber: i + 1 }))
  assert.throws(() => m.rosterWorkbookSheets(course, true))
  const sheets = m.rosterWorkbookSheets(course); sheets[0].rows.push(...course.students.map(s => [s.schoolStudentKey, s.name, String(s.grade), s.classLabel, String(s.seatNumber)]))
  assert.throws(() => m.rosterWorkbookCsv(sheets, course))
})
await test('수식 모양 이름과 쉼표·따옴표도 내부 대조 값을 바꾸지 않는다', () => {
  const { course, row } = fixture(); row.name = '=1+1,"학생"'
  assert.equal(m.parseRosterCsv(csv([row]))[0].name, row.name)
  const sheets = m.rosterWorkbookSheets(course); sheets[0].rows.push([row.schoolStudentKey, row.name, '1', '1', '3'])
  assert.equal(m.parseRosterCsv(m.rosterWorkbookCsv(sheets, course))[0].name, row.name)
})
await test('CSV 파일은 원문 지문과 파일명을 보존하고 잘못된 형식·인코딩을 거부한다', async () => {
  const { course, row } = fixture(), raw = csv([row]), result = await m.readRosterFile(new File([raw], '명부.csv'), course)
  assert.equal(result.rawCsv, raw); assert.equal(result.file.name, '명부.csv'); assert.equal(result.file.format, 'csv'); assert.match(result.file.fingerprint, /^[0-9a-f]{64}$/)
  await assert.rejects(m.readRosterFile(new File([raw], '명부.xls'), course))
  await assert.rejects(m.readRosterFile(new File([Uint8Array.of(255, 255)], '명부.csv'), course))
})
console.log(`학생 명부 실제 전환 ${passed}개 통과`)
