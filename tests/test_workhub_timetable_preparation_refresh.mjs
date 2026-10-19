import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/preparation-refresh';export * from '../apps/workhub/src/timetable/preparation';`)
const source = { sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), schoolId: 'school', schoolLevel: 'middle', termId: 'term', termLabel: '2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', canEdit: true, canConfirm: true, resources: [{ id: 'teacher', kind: 'teacher', label: '교사', capacity: 1 }, { id: 'class', kind: 'class', label: '1반', capacity: 1 }, { id: 'space', kind: 'room', label: '특별실', capacity: 1 }], courses: [{ id: 'course', label: '국어', requiredPeriods: null, resourceIds: ['teacher', 'class'] }], unsupportedFeatures: [], savedDraft: null }
const draft = { title: '보관한 준비', slots: [{ id: 'slot', day: 1, label: '1교시', startMinute: 540, endMinute: 585, periods: 1 }], plans: [{ courseId: 'course', weeklyPeriods: 1, blocks: [{ id: 'block', periods: 1, allowedSlotIds: ['slot'] }] }] }
const session = { sourceRevision: 1, sourceFingerprint: source.sourceFingerprint, termId: 'term', draftId: null, revision: null, draft, dirty: false, reviewedSource: source }
const changed = () => { const next = structuredClone(source); next.sourceRevision = 2; next.sourceFingerprint = 'b'.repeat(64); next.courses[0].resourceIds.push('space'); return next }
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('공간 연결 후 시수·일과·활동 식별값을 보존하고 저장이 필요한 초안으로 채택한다', () => {
  const next = changed(), before = JSON.stringify({ source, session, next }), result = m.adoptPreparationSource(session, next)
  assert.deepEqual(result.draft, draft); assert.equal(result.dirty, true); assert.equal(result.sourceFingerprint, next.sourceFingerprint)
  assert.equal(result.sourceRevision, 2); assert.deepEqual(result.reviewedSource, next); assert.equal(JSON.stringify({ source, session, next }), before)
  result.draft.plans[0].weeklyPeriods = 5; assert.equal(draft.plans[0].weeklyPeriods, 1)
})
check('교사·학급·공간과 수업 연결의 변경 전후를 식별값까지 보여 준다', () => {
  const next = changed(); next.resources[0].label = '새 교사'; next.resources[2].capacity = 2
  const result = m.reviewPreparationRefresh(session, next)
  assert.equal(result.allowed, true); assert.ok(result.changes.some(row => row.before.includes('교사 [teacher]') && row.after.includes('새 교사 [teacher]')))
  assert.ok(result.changes.some(row => row.after.includes('동시 2'))); assert.ok(result.changes.some(row => row.label.includes('수업') && row.after.includes('특별실 [space]')))
})
for (const [name, mutate] of [
  ['다른 학기', s => s.termId = 'other'], ['다른 학교', s => s.schoolId = 'other'],
  ['편집 권한 제거', s => s.canEdit = false], ['새 공식 수업', s => s.courses.push({ ...s.courses[0], id: 'new' })],
  ['공식 수업 삭제', s => s.courses = []], ['학교 확정 시수 변경', s => s.courses[0].requiredPeriods = 3],
  ['다른 사람의 새 초안', s => s.savedDraft = { id: 'server-draft', revision: 1, sourceFingerprint: s.sourceFingerprint, draft }],
]) check(`${name}이면 보관한 초안을 자동 이관하지 않는다`, () => {
  const next = changed(); mutate(next); assert.equal(m.reviewPreparationRefresh(session, next).allowed, false)
  assert.throws(() => m.adoptPreparationSource(session, next), error => error.code === 'CONFLICT'); assert.deepEqual(session.draft, draft)
})
check('저장한 초안의 같은 판만 채택하며 서버 판 증가·교체·삭제는 거절한다', () => {
  const own = { ...session, draftId: 'draft', revision: 4 }, next = changed()
  next.savedDraft = { id: 'draft', revision: 4, sourceFingerprint: source.sourceFingerprint, draft: structuredClone(draft) }
  assert.equal(m.reviewPreparationRefresh(own, next).allowed, true)
  const adopted = m.adoptPreparationSource(own, next); assert.equal(adopted.draftId, 'draft'); assert.equal(adopted.revision, 4)
  for (const mutate of [s => s.savedDraft.revision++, s => s.savedDraft.id = 'other', s => s.savedDraft = null]) {
    const conflict = structuredClone(next); mutate(conflict); assert.equal(m.reviewPreparationRefresh(own, conflict).allowed, false)
  }
})
check('이전 상세가 없는 오래된 서버 초안도 현재 연결 전체를 보여 주고 명시 확인을 요구한다', () => {
  const old = { ...session, reviewedSource: undefined }, next = changed(), result = m.reviewPreparationRefresh(old, next)
  assert.equal(result.allowed, true); assert.equal(result.previousKnown, false)
  assert.ok(result.changes.every(row => row.before === '이전 상세 없음')); assert.ok(result.changes.some(row => row.after.includes('[teacher]')))
})
check('기준판 생성 제한이 생겨도 초안은 보존하되 새 제한을 비교에 표시하고 확정하지 않는다', () => {
  const next = changed(); next.unsupportedFeatures = ['TEACHER_LEAVES_IN_TERM']
  assert.equal(m.reviewPreparationRefresh(session, next).allowed, true)
  assert.ok(m.reviewPreparationRefresh(session, next).changes.some(row => row.after === 'TEACHER_LEAVES_IN_TERM'))
  assert.equal(m.compilePreparation(next, m.adoptPreparationSource(session, next).draft).basis, null)
})
check('자료 배열 순서만 바뀌어도 원래 계획·시간대 순서를 재작성하지 않는다', () => {
  const next = changed(); next.resources.reverse(); next.courses.reverse()
  assert.deepEqual(m.adoptPreparationSource(session, next).draft, draft)
})
check('일과 입력 자체가 깨졌으면 채택하지 않으며 정규화로 숨기지 않는다', () => {
  const invalid = structuredClone(session); invalid.draft.plans[0].blocks[0].allowedSlotIds = ['missing']
  assert.equal(m.reviewPreparationRefresh(invalid, changed()).allowed, false)
})
check('읽기 재시도는 변경된 공식 자료에 이전 입력을 덮어쓰지 않는다', () => {
  assert.equal(m.retainPreparationSession(session, changed()), true)
  assert.equal(m.retainPreparationSession({ ...session, dirty: true }, source), true)
  assert.equal(m.retainPreparationSession(session, { ...source, sourceRevision: 2 }), true)
  assert.equal(m.retainPreparationSession(session, source), false)
  assert.equal(m.retainPreparationSession(undefined, source), false)
})
console.log(`시간표 공식자료 변경·입력 보존 검사: ${count}개 통과`)
