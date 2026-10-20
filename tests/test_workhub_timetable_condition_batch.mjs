import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/condition-batch';export * from '../apps/workhub/src/timetable/sample';export {validateBasis} from '../packages/timetable/src/validate';`)
let count = 0
const check = (name, fn) => { fn(); count++; console.log('  ✓ ' + name) }
const basis = () => m.timetablePracticeSnapshot('2026-10-19').basis
const conditions = b => structuredClone({ fixed: b.fixed, unavailable: b.unavailable, preferences: b.preferences })
const action = (patch = {}) => ({ kind: 'unavailable', resourceIds: ['practice-teacher-a', 'practice-teacher-b'], days: [1, 3], startMinute: 550, endMinute: 570, weight: 3, ...patch })

check('여러 교사·요일의 불가를 미리보고 원본 필수조건과 입력을 그대로 보존한다', () => {
  const b = basis(); b.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); b.unavailable.push({ resourceId: 'practice-class-b', day: 2, startMinute: 500, endMinute: 520 })
  const current = conditions(b), before = JSON.stringify([b, current]), p = m.previewConditionBatch(b, current, action())
  assert.equal(p.rows.length, 4); assert.equal(p.affectedLessons, 6); assert.ok(p.warnings.some(row => row.includes('배치할 시간 없음'))); assert.equal(current.unavailable.length, 1)
  const next = m.applyConditionBatch(b, current, p); assert.equal(next.unavailable.length, 5); assert.deepEqual(next.fixed, b.fixed); assert.deepEqual(next.unavailable[0], b.unavailable[0]); assert.equal(JSON.stringify([b, current]), before); assert.equal(m.validateBasis({ ...b, ...next }).valid, true)
})
check('맞닿은 기존 불가가 전체 시간을 덮으면 추가하지 않고 원본 행을 합치거나 지우지 않는다', () => {
  const b = basis(); b.unavailable = [{ resourceId: 'practice-teacher-a', day: 1, startMinute: 540, endMinute: 560 }, { resourceId: 'practice-teacher-a', day: 1, startMinute: 560, endMinute: 585 }]
  const p = m.previewConditionBatch(b, conditions(b), action({ resourceIds: ['practice-teacher-a'], days: [1], startMinute: 545, endMinute: 580 }))
  assert.equal(p.skipped, 1); assert.equal(p.rows.length, 0); assert.deepEqual(p.conditions.unavailable, b.unavailable); assert.throws(() => m.applyConditionBatch(b, conditions(b), p), /추가할 조건이 없습니다/)
  const partial = m.previewConditionBatch(b, conditions(b), action({ resourceIds: ['practice-teacher-a'], days: [1], startMinute: 580, endMinute: 600 })); assert.equal(partial.rows.length, 1); assert.deepEqual(partial.conditions.unavailable.slice(0, 2), b.unavailable)
})
check('교사와 같은 수업의 학급을 함께 골라도 수업 선호가 중복되거나 가산되지 않는다', () => {
  const b = basis(), p = m.previewConditionBatch(b, conditions(b), action({ kind: 'preferences', resourceIds: ['practice-teacher-a', 'practice-class-a'], days: [1] }))
  assert.equal(p.conditions.preferences.length, 5); assert.equal(new Set(p.conditions.preferences.map(row => row.lessonId)).size, 5); assert.ok(p.conditions.preferences.every(row => row.slotId === 'practice-1-1' && row.weight === 3))
})
check('선호는 기존 강도를 낮추지 않고 더 큰 값으로만 강화하며 원본 필수조건은 유지한다', () => {
  const b = basis(); b.preferences = [{ lessonId: b.lessons[0].id, slotId: b.slots[0].id, weight: 5 }, { lessonId: b.lessons[1].id, slotId: b.slots[0].id, weight: 1 }]
  const p = m.previewConditionBatch(b, conditions(b), action({ kind: 'preferences', days: [1] })); assert.equal(p.skipped, 1); assert.equal(p.rows.length, 5)
  assert.equal(p.conditions.preferences.find(row => row.lessonId === b.lessons[0].id).weight, 5); assert.equal(p.conditions.preferences.find(row => row.lessonId === b.lessons[1].id).weight, 3); assert.ok(p.rows.some(row => row.includes('1 → 3'))); assert.equal(b.preferences[1].weight, 1)
})
check('블록과 부분 구간의 겹침을 실제 시각으로 보고 허용하지 않은 시간·경계만 닿는 시간은 만들지 않는다', () => {
  const b = basis(); b.slots.push({ id: 'block', day: 1, label: '연속수업', startMinute: 540, endMinute: 640, periods: 2 })
  b.lessons[0].periods = 2; b.lessons[0].allowedSlotIds = ['block']; b.courseLoads[0].periods = 3; b.lessons[1].allowedSlotIds = ['practice-2-1']
  const p = m.previewConditionBatch(b, conditions(b), action({ kind: 'preferences', resourceIds: ['practice-class-a'], days: [1], startMinute: 585, endMinute: 595 }))
  assert.deepEqual(p.conditions.preferences, [{ lessonId: b.lessons[0].id, slotId: 'block', weight: 3 }]); assert.ok(p.rows[0].includes('09:00–10:40'))
})
check('선택 대상과 요일 순서를 바꿔도 적용 내용과 미리보기는 같다', () => {
  const b = basis(), a = action(), first = m.previewConditionBatch(b, conditions(b), a)
  a.resourceIds.reverse(); a.days.reverse(); assert.deepEqual(m.previewConditionBatch(b, conditions(b), a), first)
})
check('잘못된 대상·요일·시각·가중치·추가 필드는 일부 조건도 남기지 않는다', () => {
  const b = basis(), current = conditions(b), before = JSON.stringify(current)
  for (const patch of [{ resourceIds: [] }, { resourceIds: ['foreign'] }, { resourceIds: ['practice-teacher-a', 'practice-teacher-a'] }, { days: [] }, { days: [0] }, { days: [1, 1] }, { startMinute: 600, endMinute: 599 }, { startMinute: NaN }, { endMinute: 1441 }, { weight: 0 }, { weight: 1.5 }, { hidden: true }, { kind: 'fixed' }]) assert.throws(() => m.previewConditionBatch(b, current, action(patch)))
  assert.equal(JSON.stringify(current), before)
})
check('학교의 필수조건을 빠뜨린 현재 초안은 편의 기능으로 우회하지 못한다', () => {
  const b = basis(); b.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id })
  assert.throws(() => m.previewConditionBatch(b, { fixed: [], unavailable: [], preferences: [] }, action()), /학교 기준자료/)
})
check('미리보기 뒤 기초판·조건·수업 허용 범위가 바뀌면 원래 입력을 적용하지 않는다', () => {
  const b = basis(), current = conditions(b), p = m.previewConditionBatch(b, current, action())
  for (const change of [b => b.revision++, b => b.sourceFingerprint = 'b'.repeat(64), b => b.lessons[0].allowedSlotIds.pop(), b => b.resources[0].label = '새 교사']) { const next = structuredClone(b); change(next); assert.throws(() => m.applyConditionBatch(next, current, p), /바뀌었습니다/) }
  const changed = structuredClone(current); changed.preferences.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id, weight: 1 }); assert.throws(() => m.applyConditionBatch(b, changed, p), /바뀌었습니다/)
})
check('미리보기 내용을 바꾼 경우 재생성 대조가 막고 원래 조건은 보존한다', () => {
  const b = basis(), current = conditions(b), p = m.previewConditionBatch(b, current, action())
  const altered = structuredClone(p); altered.conditions.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); assert.throws(() => m.applyConditionBatch(b, current, altered), /미리보기 내용/)
  const shortened = structuredClone(p); shortened.rows.pop(); assert.throws(() => m.applyConditionBatch(b, current, shortened), /미리보기 내용/)
  assert.equal(current.fixed.length, 0)
})
check('공동 수업 확장으로 조건 한도를 넘으면 원자적으로 거부한다', () => {
  const b = basis(); b.slots = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, day: 1, label: `교시${i}`, startMinute: 10 + i, endMinute: 60 + i, periods: 1 }))
  b.lessons = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}`, courseId: `c${i}`, label: `수업${i}`, periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-a'], allowedSlotIds: b.slots.map(s => s.id) })); b.courseLoads = b.lessons.map(l => ({ courseId: l.courseId, periods: 1 }))
  assert.equal(m.validateBasis(b).valid, true); const current = conditions(b)
  assert.throws(() => m.previewConditionBatch(b, current, action({ kind: 'preferences', resourceIds: ['practice-teacher-a'], days: [1], startMinute: 0, endMinute: 100 })), /한도를 넘습니다/); assert.equal(current.preferences.length, 0)
})
check('입력 중 판정은 검색을 제외하고 대상·요일·시각·선호 입력을 보존한다', () => {
  const state = m.initialConditionBatch(); assert.equal(m.hasConditionBatchInput(state), false); state.search = '교사'; assert.equal(m.hasConditionBatchInput(state), false)
  for (const patch of [{ resourceIds: ['t'] }, { days: [1] }, { start: '09:00' }, { end: '10:00' }, { kind: 'preferences' }, { weight: '5' }]) assert.equal(m.hasConditionBatchInput({ ...state, ...patch }), true)
  assert.equal(m.conditionBatchMinute('09:05'), 545); assert.equal(m.conditionBatchMinute('24:00'), 1440); assert.ok(Number.isNaN(m.conditionBatchMinute('9:05')))
})
check('같은 이름 수업의 선호 미리보기는 각 수업 ID를 표시한다', () => {
  const b = basis(); b.lessons[0].label = b.lessons[2].label = '국어 1회'
  const p = m.previewConditionBatch(b, conditions(b), action({ kind: 'preferences', days: [1] }))
  for (const lesson of [b.lessons[0], b.lessons[2]]) assert.ok(p.rows.some(row => row.startsWith(`국어 1회 [${lesson.id}] · `)))
  assert.equal(p.conditions.preferences.filter(row => [b.lessons[0].id, b.lessons[2].id].includes(row.lessonId)).length, 2)
})
const slotAction = (patch = {}) => ({ kind: 'unavailable', resourceIds: ['practice-teacher-a'], slotIds: ['practice-1-1', 'practice-3-2'], weight: 3, ...patch })
check('서로 다른 요일·교시를 실제 시간대로 한 번에 반영하고 선택하지 않은 시각은 만들지 않는다', () => {
  const b = basis(), current = conditions(b), p = m.previewConditionBatch(b, current, slotAction())
  assert.deepEqual(p.conditions.unavailable, [{ resourceId: 'practice-teacher-a', day: 1, startMinute: 540, endMinute: 585 }, { resourceId: 'practice-teacher-a', day: 3, startMinute: 595, endMinute: 640 }])
  assert.equal(p.rows.length, 2); assert.equal(current.unavailable.length, 0); assert.deepEqual(m.applyConditionBatch(b, current, p), p.conditions)
})
check('같은 실제 시각의 학년별 시간대는 중복 불가를 만들지 않는다', () => {
  const b = basis(); b.slots.push({ ...b.slots[0], id: 'other-grade-slot' })
  const p = m.previewConditionBatch(b, conditions(b), slotAction({ slotIds: [b.slots[0].id, 'other-grade-slot'] }))
  assert.equal(p.rows.length, 1); assert.equal(p.conditions.unavailable.length, 1); assert.deepEqual(p.action.slotIds, ['other-grade-slot', 'practice-1-1'])
})
check('선택 순서가 달라도 실제 시간대 조건의 미리보기와 결과는 같다', () => {
  const b = basis(), a = slotAction({ resourceIds: ['practice-teacher-a', 'practice-teacher-b'] }), p = m.previewConditionBatch(b, conditions(b), a)
  a.resourceIds.reverse(); a.slotIds.reverse(); assert.deepEqual(m.previewConditionBatch(b, conditions(b), a), p)
})
check('실제 시간대의 선호는 공동 수업·겹친 연속 시간에 중복 가산하지 않는다', () => {
  const b = basis(); b.slots.push({ id: 'long-slot', day: 1, label: '연속', startMinute: 540, endMinute: 640, periods: 2 }); b.preferences.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id, weight: 8 })
  const p = m.previewConditionBatch(b, conditions(b), slotAction({ kind: 'preferences', resourceIds: ['practice-teacher-a', 'practice-class-a'], slotIds: ['long-slot', 'practice-1-1'] }))
  assert.equal(p.conditions.preferences.find(row => row.lessonId === b.lessons[0].id && row.slotId === b.slots[0].id).weight, 8)
  assert.equal(new Set(p.conditions.preferences.map(row => row.lessonId + ':' + row.slotId)).size, p.conditions.preferences.length)
  assert.ok(p.conditions.preferences.every(row => row.slotId === 'practice-1-1' || row.slotId === 'practice-1-2'))
})
check('빈·삭제·중복 시간대와 범위 입력을 섞은 명령은 전체 거절한다', () => {
  const b = basis(), current = conditions(b)
  for (const patch of [{ slotIds: [] }, { slotIds: ['missing'] }, { slotIds: ['practice-1-1', 'practice-1-1'] }, { days: [1] }, { slotIds: null }, { weight: 0 }]) assert.throws(() => m.previewConditionBatch(b, current, slotAction(patch)))
  assert.equal(current.unavailable.length, 0)
})
check('시간대 선택 뒤 시각·권한자료가 바뀌면 기존 미리보기를 재사용하지 않는다', () => {
  const b = basis(), current = conditions(b), p = m.previewConditionBatch(b, current, slotAction()), changed = structuredClone(b)
  changed.slots[0].startMinute++; assert.throws(() => m.applyConditionBatch(changed, current, p), /바뀌었습니다/)
  const altered = structuredClone(p); altered.action.slotIds.pop(); assert.throws(() => m.applyConditionBatch(b, current, altered), /미리보기 내용/)
})
check('시간대 선택은 미반영 입력으로 보존되지만 보기 방식만 바꾸면 잠그지 않는다', () => {
  assert.equal(m.hasConditionBatchInput({ ...m.initialConditionBatch(), inputMode: 'slots' }), false)
  assert.equal(m.hasConditionBatchInput({ ...m.initialConditionBatch(), inputMode: 'slots', slotIds: ['practice-1-1'] }), true)
})
check('실제 시간대 불가가 학교 고정과 충돌해도 학교 조건을 지우거나 선호로 낮추지 않는다', () => {
  const b = basis(); b.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); const p = m.previewConditionBatch(b, conditions(b), slotAction())
  assert.deepEqual(p.conditions.fixed, b.fixed); assert.equal(p.conditions.preferences.length, 0); assert.ok(p.warnings.some(row => row.includes('배치할 시간 없음')))
})
console.log(`시간표 조건 일괄 입력 검사: ${count}개 통과`)
