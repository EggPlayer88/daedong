import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule("export * from '../apps/workhub/src/timetable/pilot/fixture'; export * from '../apps/workhub/src/timetable/pilot/roster'; export * from '../apps/workhub/src/timetable/pilot/timetable-replacement'")
const fixture = m.getPilotFixture()
const csv = m.exportPilotTimetableCsv(fixture)
const changedCsv = () => csv.replace('"국어"', '"국어 심화"')
const preview = () => m.previewTimetableReplacement(fixture, changedCsv(), '2026-03-16', '2026-03-09')
const quoted = values => values.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')
function editRows(edit) {
  const rows = m.parsePilotCsvRows(csv); edit(rows)
  return rows.map(quoted).join('\r\n')
}
let count = 0
async function check(name, test) { await test(); count++; console.log('  ✓ ' + name) }
await check('279칸을 CSV로 내려받고 바꾸지 않으면 새 판을 만들지 않는다', async () => {
  assert.equal(m.parsePilotCsvRows(csv).length, 280)
  await assert.rejects(() => m.previewTimetableReplacement(fixture, csv, '2026-03-16', '2026-03-09'), error => error.code === 'NO_CHANGES')
})
await check('수업 한 칸 변경을 전후 비교하고 원본 CSV와 기준판 지문을 고정한다', async () => {
  const p = await preview()
  assert.equal(p.changes.length, 1); assert.equal(p.lessons.length, 279)
  assert.match(p.csvFingerprint, /^[a-f0-9]{64}$/); assert.equal(p.baseFingerprint, await m.fingerprintPilotFixture(fixture))
  assert.ok(p.changes[0].after.includes('국어 심화')); assert.ok(p.changes[0].before.includes('국어 /'))
  assert.deepEqual(await m.validateTimetableReplacementPreview(fixture, p, '2026-03-09'), p)
})
await check('변경 비교·시각·원본 수업을 조작하거나 판이 달라지면 거부한다', async () => {
  for (const edit of [p => { p.lessons[0].subject = '조작' }, p => { p.changes = [] }, p => { p.effectiveFrom = '2026-03-17' }, p => { p.baseRevision++ }, p => { p.schoolId = 'other' }, p => { p.hidden = true }]) {
    const p = await preview(); edit(p)
    await assert.rejects(() => m.validateTimetableReplacementPreview(fixture, p, '2026-03-09'))
  }
})
await check('누락·중복 수업 행을 정상적인 빈 교시로 처리하지 않는다', async () => {
  for (const edit of [rows => { rows.pop() }, rows => { rows.push(rows[1]) }, rows => { rows[1][1] = '6' }, rows => { rows[1][2] = '07' }]) {
    await assert.rejects(() => m.previewTimetableReplacement(fixture, editRows(edit), '2026-03-16', '2026-03-09'))
  }
})
await check('CSV에 없는 교사·학급·교실·교시를 추정해서 생성하지 않는다', async () => {
  for (const [column, value] of [[5, 'real-teacher-guess'], [3, 'other-class'], [6, 'other-room'], [2, '8']]) {
    await assert.rejects(() => m.previewTimetableReplacement(fixture, editRows(rows => { rows[1][column] = value }), '2026-03-16', '2026-03-09'))
  }
})
await check('서로 다른 반의 같은 시각 담당이 겹치면 공개 후보를 만들지 않는다', async () => {
  const broken = editRows(rows => {
    const first = rows[1], other = rows.slice(2).find(row => row[1] === first[1] && row[2] === first[2] && row[3] !== first[3])
    other[5] = first[5]
  })
  await assert.rejects(() => m.previewTimetableReplacement(fixture, broken, '2026-03-16', '2026-03-09'), error => error.code === 'RESOURCE_CONFLICT')
})
await check('과거 적용일·학기 밖·확정 중 지난 날짜를 거부한다', async () => {
  for (const date of ['2026-03-08', '2026-08-16']) await assert.rejects(() => m.previewTimetableReplacement(fixture, changedCsv(), date, '2026-03-09'), error => error.code === 'INVALID_EFFECTIVE_DATE')
  const p = await preview(); await assert.rejects(() => m.validateTimetableReplacementPreview(fixture, p, '2026-03-17'), error => error.code === 'INVALID_EFFECTIVE_DATE')
})
await check('수업 ID만 바꿔 이력 연결을 끊는 파일은 별도 안내로 거부한다', async () => {
  await assert.rejects(() => m.previewTimetableReplacement(fixture, editRows(rows => { rows[1][0] = 'new-identity' }), '2026-03-16', '2026-03-09'), error => error.code === 'LESSON_ID_ONLY_CHANGE')
})
await check('교체 시 연결 계획의 실교사 중복도 재검사한다', async () => {
  const roster = await m.createPilotRoster(fixture), bindings = m.rosterBindingsOn(roster, '2026-03-09')
  bindings[0] = { ...bindings[0], kind: 'registered-reference', candidateId: 'member-1', label: '교사' }
  bindings[6] = { ...bindings[6], kind: 'registered-reference', candidateId: 'member-1', label: '교사' }
  await assert.rejects(() => m.previewTimetableReplacement(fixture, changedCsv(), '2026-03-16', '2026-03-09', bindings), error => error.code === 'TEACHER_TIME_CONFLICT')
})
await check('기간 교체는 원본을 수정하지 않아 과거 수업과 요청의 근거를 보존한다', async () => {
  const before = JSON.stringify(fixture); await preview(); assert.equal(JSON.stringify(fixture), before)
})
console.log(`\n시간표 CSV 교체 ${count}개 통과`)
