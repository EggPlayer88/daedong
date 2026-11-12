import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { eventResponse, connectedEventResponse, fixtureData } = await loadBrowserModule(`
export { eventResponse } from '../apps/workhub/src/calendar/event-response.ts'
export { eventResponse as connectedEventResponse } from '../apps/workhub/src/connection/validation.ts'
export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
`)
const event = fixtureData.events.find(row => row.id === 'fixture-event-my')
const members = fixtureData.memberships
const parse = value => eventResponse(value, event.schoolId, members)
let failures = 0
function test(name, run) {
  try { run(); console.log('  ✓ ' + name) }
  catch (error) { failures++; console.error('  ✗ ' + name, error) }
}
function rejects(values) {
  for (const value of values) for (const validate of [eventResponse, connectedEventResponse]) {
    assert.throws(() => validate(value, event.schoolId, members), error =>
      error.code === 'QUERY_FAILED' && error.message === '서버 응답 형식을 확인할 수 없습니다. 다시 연결해 주세요.')
  }
}

test('일정 화면과 기존 연결 경로가 같은 응답 검증 함수 원본을 사용한다', () => {
  assert.equal(eventResponse, connectedEventResponse)
  assert.deepEqual(parse(event), event)
})
test('정상 일정의 서버 번호·버전·시각을 유지하고 기존 정규화와 깊은 복제를 수행한다', () => {
  const raw = { ...structuredClone(event), title: '  합성 일정  ', description: '  설명  ', location: '  장소  ', allDay: true, startTime: '09:00', endTime: '10:00' }
  const result = parse(raw)
  assert.deepEqual(result, { ...raw, title: '합성 일정', description: '설명', location: '장소', startTime: '', endTime: '' })
  assert.notEqual(result, raw)
  assert.notEqual(result.audience, raw.audience)
  assert.equal(raw.title, '  합성 일정  ')
})
test('객체가 아닌 일정 응답을 기존 오류로 거부한다', () => {
  rejects([null, undefined, [], true, 3, 'event'])
})
test('다른 학교와 존재하지 않는 작성자·일정 번호를 거부한다', () => {
  rejects([{ ...event, schoolId: 'other-school' }, { ...event, authorMemberId: 'missing-author' },
    { ...event, authorMemberId: members.find(row => row.schoolId !== event.schoolId).id },
    ...[undefined, null, '', 4, 'x'.repeat(201)].map(id => ({ ...event, id }))])
})
test('누락·문자열·비정수·범위 밖 서버 버전을 거부한다', () => {
  rejects([undefined, null, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(version => ({ ...event, version })))
})
test('누락·비문자열·해석 불가·길이 초과 서버 시각을 거부한다', () => {
  rejects([undefined, null, 123, '', 'not-a-date', 'x'.repeat(61)].map(updatedAt => ({ ...event, updatedAt })))
})
test('기본 입력의 잘못된 타입과 글자 수를 거부한다', () => {
  rejects([
    ...['title', 'description', 'location', 'startDate', 'endDate', 'startTime', 'endTime', 'visibility'].map(key => ({ ...event, [key]: null })),
    { ...event, allDay: 'true' }, { ...event, title: ' ' }, { ...event, title: '가'.repeat(101) },
    { ...event, description: '가'.repeat(2001) }, { ...event, location: '가'.repeat(101) }, { ...event, visibility: 'public' },
  ])
})
test('실제 달력에 없는 날짜·역전 날짜·잘못된 시간을 거부한다', () => {
  rejects([
    { ...event, startDate: '2026-02-30' }, { ...event, endDate: '2026-13-01' },
    { ...event, startDate: '2026-11-02', endDate: '2026-11-01' },
    ...[['24:00', '25:00'], ['10:00', '09:00'], ['09:00', '09:00']].map(([startTime, endTime]) =>
      ({ ...event, allDay: false, startDate: '2026-11-01', endDate: '2026-11-01', startTime, endTime })),
  ])
})
test('관련 대상의 잘못된 배열·그룹 형식과 다른 학교의 교사를 거부한다', () => {
  const audience = event.audience
  rejects([
    ...[null, { ...audience, all: 'true' }, { ...audience, groups: null }, { ...audience, groups: [null] },
      { ...audience, groups: [{ departmentIds: null, gradeIds: [], subjectIds: [] }] },
      { ...audience, includeMemberIds: 'member' }, { ...audience, excludeMemberIds: [3] },
      { ...audience, includeMemberIds: [members.find(row => row.schoolId !== event.schoolId).id] },
      { ...audience, excludeMemberIds: ['missing-member'] }].map(audience => ({ ...event, audience })),
    { ...event, visibility: 'school', audience: { all: false, groups: [], includeMemberIds: [], excludeMemberIds: [] } },
  ])
})
test('보호 검사를 그대로 실행한 실제 오프라인 미리보기를 생성한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workhub-calendar-preview-'))
  try {
    const output = join(directory, 'preview.html')
    const run = spawnSync(process.execPath, ['scripts/export-workhub-preview.mjs', output], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true,
    })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const html = readFileSync(output, 'utf8')
    assert.ok(html.includes("connect-src 'none'"))
    assert.ok(html.includes('<div id="root"></div>'))
    for (const name of ['workhub_calendar_list', 'workhub_task_save', 'createSupabaseConnection']) assert.equal(html.includes(name), false)
  } finally {
    // 이 시험에서 만든 임시 폴더만 정리한다.
    rmSync(directory, { recursive: true, force: true })
  }
})

if (failures) process.exitCode = 1
