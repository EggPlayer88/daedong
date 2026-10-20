import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/operation-review'`)
const lesson = (id, patch = {}) => ({ id, version: 1, label: '국어', time: { startsAt: '2026-10-18T15:30:00.000Z', endsAt: '2026-10-18T16:15:00.000Z' }, teachers: [{ id: 't1', name: '김교사' }], groupNames: ['1학년 1반'], roomNames: ['국어실'], state: 'scheduled', canRequest: true, allowedTargets: [], ...patch })
const original = lesson('one'), changed = { before: original, after: { ...original, version: 2, time: { startsAt: '2026-10-19T15:30:00.000Z', endsAt: '2026-10-19T16:15:00.000Z' } } }
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('새 편성·취소·시각 변경·그 밖의 변경을 중복 없이 나눈다', () => {
  assert.equal(m.operationChangeKind({ before: null, after: original }), 'added')
  assert.equal(m.operationChangeKind(changed), 'moved')
  assert.equal(m.operationChangeKind({ before: original, after: { ...changed.after, state: 'cancelled' } }), 'cancelled')
  assert.equal(m.operationChangeKind({ before: original, after: { ...original, version: 2 } }), 'updated')
})
check('학교 현지 날짜와 변경 전후 날짜를 모두 찾는다', () => {
  assert.equal(m.selectOperationChanges([changed], 'all', '2026-10-19', 'Asia/Seoul').length, 1)
  assert.equal(m.selectOperationChanges([changed], 'all', '2026-10-20', 'Asia/Seoul').length, 1)
  assert.equal(m.selectOperationChanges([changed], 'all', '2026-10-18', 'Asia/Seoul').length, 0)
})
check('교사·학급·공간·식별 번호와 전각 검색어를 함께 찾는다', () => {
  assert.equal(m.selectOperationChanges([changed], 'all', ' 김교사 １학년 국어실 one ', 'Asia/Seoul').length, 1)
  assert.equal(m.selectOperationChanges([changed], 'all', '없는사람', 'Asia/Seoul').length, 0)
})
check('종류 필터는 검색을 만족해도 다른 종류를 포함하지 않는다', () => {
  assert.equal(m.selectOperationChanges([changed], 'added', '국어', 'Asia/Seoul').length, 0)
  assert.equal(m.selectOperationChanges([changed], 'moved', '국어', 'Asia/Seoul').length, 1)
})
check('선택한 교환 후보는 검색 밖이어도 유지하고 실제 검색 건수를 부풀리지 않는다', () => {
  const rows = [lesson('one'), lesson('two', { label: '수학' })], result = m.selectOperationLessons(rows, '수학', 'one', 'Asia/Seoul')
  assert.equal(result.matches, 1); assert.equal(result.pinned, true); assert.deepEqual(result.rows.map(row => row.id), ['one', 'two'])
})
check('선택이 검색에 포함되면 중복 표시하지 않는다', () => {
  const result = m.selectOperationLessons([original], 'one', 'one', 'Asia/Seoul')
  assert.equal(result.matches, 1); assert.equal(result.pinned, false); assert.equal(result.rows.length, 1)
})
check('현재 목록에 없는 선택은 검색이 복원하거나 추정하지 않는다', () => {
  const result = m.selectOperationLessons([original], '국어', 'missing', 'Asia/Seoul')
  assert.deepEqual(result.rows.map(row => row.id), ['one']); assert.equal(result.pinned, false)
})
check('동명 교사는 ID로 구별하고 한 교사의 여러 수업은 한 명으로 센다', () => {
  const people = [{ id: 't1', name: '김교사' }, { id: 't1', name: '김교사' }, { id: 't2', name: '김교사' }, { id: 't3', name: '이교사' }]
  assert.deepEqual([...m.operationTeacherLabels(people)], [['t1', '김교사 [t1]'], ['t2', '김교사 [t2]'], ['t3', '이교사']])
})
check('요약은 검색과 관계없는 전체 입력 목록을 기준으로 한다', () => {
  const rows = [changed, { before: null, after: lesson('two') }], summary = m.operationChangeSummary(rows, 'Asia/Seoul')
  assert.equal(summary.total, 2); assert.deepEqual(summary.counts, { added: 1, cancelled: 0, moved: 1, updated: 0 }); assert.equal(summary.teachers.length, 1)
  assert.deepEqual(summary.dates, ['2026-10-19', '2026-10-20'])
})
check('변경 전 교사도 영향 요약에서 누락하지 않는다', () => {
  const summary = m.operationChangeSummary([{ before: original, after: { ...original, teachers: [{ id: 't2', name: '김교사' }] } }], 'Asia/Seoul')
  assert.equal(summary.teachers.length, 2)
})
check('빈 목록은 0건으로 반환하고 학교 학급 수를 이름에서 추정하지 않는다', () => {
  const summary = m.operationChangeSummary([], 'Asia/Seoul')
  assert.equal(summary.total, 0); assert.deepEqual(summary.dates, []); assert.equal('groups' in summary, false)
})
check('검색·집계는 원본 순서와 내용을 변경하지 않는다', () => {
  const rows = [changed, { before: null, after: lesson('two') }], before = JSON.stringify(rows)
  m.selectOperationChanges(rows, 'all', '', 'Asia/Seoul'); m.operationChangeSummary(rows, 'Asia/Seoul'); m.selectOperationLessons([original], 'x', 'one', 'Asia/Seoul')
  assert.equal(JSON.stringify(rows), before)
})
console.log(`시간표 변경 검토·후보 검색 검사: ${count}개 통과`)
