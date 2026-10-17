import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {TimetablePreflightPanel} from '../apps/workhub/src/timetable/TimetablePreflightPanel';
import {FoundationPanel} from '../apps/workhub/src/timetable/FoundationPanel';
export {reviewTimetablePreflight} from '../apps/workhub/src/timetable/preflight';
export {validateBasis,validatePlacements} from '../packages/timetable/src/validate';
export {solveTimetable} from '../packages/timetable/src/solver';
export {timetablePracticeSnapshot} from '../apps/workhub/src/timetable/sample';
export const render=(basis,foundation=false)=>renderToStaticMarkup(React.createElement(foundation?FoundationPanel:TimetablePreflightPanel,{basis}));
`)
let count = 0
const check = (name, run) => { run(); count++; console.log('  ✓ ' + name) }
const slot = (id, start = 540, end = 585, periods = 1, day = 1) => ({ id, label: id, day, startMinute: start, endMinute: end, periods })
function fixture({ n = 3, capacity = 1, slots = [slot('s1'), slot('s2', 600, 645), slot('s3', 660, 705)] } = {}) {
  const b = m.timetablePracticeSnapshot('2026-10-19').basis
  b.slots = slots; b.resources = [{ id: 'room', label: '공유 실험실', kind: 'room', capacity }]; b.lessons = []; b.courseLoads = []
  for (let i = 1; i <= n; i++) {
    b.resources.push({ id: `t${i}`, label: `교사 ${i}`, kind: 'teacher', capacity: 1 }, { id: `g${i}`, label: `학급 ${i}`, kind: 'class', capacity: 1 })
    b.lessons.push({ id: `l${i}`, courseId: `c${i}`, label: `과학 ${i}`, periods: 1, resourceIds: [`t${i}`, `g${i}`, 'room'], allowedSlotIds: slots.filter(s => s.periods === 1).map(s => s.id) })
    b.courseLoads.push({ courseId: `c${i}`, periods: 1 })
  }
  return b
}
const review = b => { assert.equal(m.validateBasis(b).valid, true); return m.reviewTimetablePreflight(b) }
const code = (r, c) => r.cards.filter(row => row.code === c)

check('확정 충돌 없음은 가능 판정이 아니라 미판정이며 계산을 허용한다', () => {
  const r = review(fixture()); assert.equal(r.status, 'undetermined'); assert.equal(r.canCalculate, true); assert.equal(r.cards.length, 0)
  const html = m.render(fixture()); assert.match(html, /편성 가능 여부는 아직 미판정/); assert.match(html, /전체 필수조건 검사를 따로/); assert.match(html, /조건을 자동으로 바꾸지/)
})
check('기존 기초검사가 통과하던 같은 교사 고정 겹침을 수업·자원·시간으로 설명한다', () => {
  const b = m.timetablePracticeSnapshot('2026-10-19').basis
  b.fixed = b.lessons.slice(0, 2).map(l => ({ lessonId: l.id, slotId: b.slots[0].id }))
  const r = review(b), conflict = code(r, 'FIXED_RESOURCE_COLLISION').find(c => c.resourceId === 'practice-teacher-a')
  assert.equal(r.canCalculate, false); assert.equal(conflict.lessons.length, 2); assert.match(conflict.message, /월 09:00–09:45/)
  assert.ok(conflict.lessons.some(l => l.label === '예시 1반 과학 2회')); assert.equal(m.solveTimetable(b).status, 'infeasible')
  assert.doesNotMatch(m.render(b, true), /기초 자료의 시수·배정·시간대 검사 통과/)
})
check('교시 이름과 ID가 달라도 실제 시각이 겹치면 고정 충돌이다', () => {
  const b = fixture({ n: 2, slots: [slot('grade1-period1'), slot('grade2-period1', 570, 615)] })
  b.slots[0].label = '1학년 1교시'; b.slots[1].label = '2학년 1교시'
  b.fixed = [{ lessonId: 'l1', slotId: b.slots[0].id }, { lessonId: 'l2', slotId: b.slots[1].id }]
  const r = review(b); assert.equal(code(r, 'FIXED_RESOURCE_COLLISION').length, 1); assert.match(r.cards[0].message, /09:30–09:45/)
})
check('종료와 시작이 같은 교시 및 다른 요일은 고정 충돌이 아니다', () => {
  for (const second of [slot('s2', 585, 630), slot('s2', 540, 585, 1, 2)]) {
    const b = fixture({ n: 2, slots: [slot('s1'), second] }); b.fixed = [{ lessonId: 'l1', slotId: 's1' }, { lessonId: 'l2', slotId: 's2' }]
    assert.equal(review(b).canCalculate, true); assert.equal(m.validatePlacements(b, b.fixed).valid, true)
  }
})
check('2개 수용 공간의 같은 시간 수업 두 개는 허용하고 세 개는 확정 충돌이다', () => {
  for (const n of [2, 3]) {
    const b = fixture({ n, capacity: 2, slots: [slot('s1')] }); b.fixed = b.lessons.map(l => ({ lessonId: l.id, slotId: 's1' }))
    const r = review(b); assert.equal(r.canCalculate, n === 2); assert.equal(code(r, 'FIXED_RESOURCE_COLLISION').length, n === 2 ? 0 : 1)
    assert.equal(m.validatePlacements(b, b.fixed).valid, n === 2)
  }
})
check('겹침 연결이 있어도 세 수업이 동시에 겹치지 않으면 2개 수용 공간을 막지 않는다', () => {
  const b = fixture({ capacity: 2, slots: [slot('s1', 540, 600), slot('s2', 570, 630), slot('s3', 600, 660)] })
  b.fixed = b.lessons.map((l, i) => ({ lessonId: l.id, slotId: b.slots[i].id }))
  assert.equal(review(b).canCalculate, true); assert.equal(m.validatePlacements(b, b.fixed).valid, true)
})
check('다른 시간이 남아 있어도 고정 시간과 불가 시간이 겹치면 해당 수업을 설명한다', () => {
  const b = fixture({ n: 1 }); b.fixed = [{ lessonId: 'l1', slotId: 's1' }]; b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 550, endMinute: 560 }]
  const r = review(b), card = code(r, 'NO_AVAILABLE_SLOT')[0]; assert.equal(r.canCalculate, false); assert.match(card.message, /고정한 시간/); assert.match(card.message, /교사 1/); assert.deepEqual(card.slots.map(s => s.id), ['s1'])
})
check('서로 다른 참여자의 불가 조건이 각각 허용 시간을 없애도 합쳐 설명한다', () => {
  const b = fixture({ n: 1, slots: [slot('s1'), slot('s2', 600, 645)] })
  b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 540, endMinute: 585 }, { resourceId: 'room', day: 1, startMinute: 600, endMinute: 645 }]
  const card = code(review(b), 'NO_AVAILABLE_SLOT')[0]; assert.match(card.message, /허용 시간 2곳이 모두/); assert.match(card.message, /교사 1/); assert.match(card.message, /공유 실험실/)
})
check('중복·맞닿은 불가 시간은 합치고 경계만 닿은 수업은 허용한다', () => {
  const b = fixture({ n: 1 }); b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 500, endMinute: 520 }, { resourceId: 't1', day: 1, startMinute: 520, endMinute: 540 }, { resourceId: 't1', day: 1, startMinute: 500, endMinute: 530 }]
  assert.equal(review(b).canCalculate, true); assert.equal(code(review(b), 'NO_AVAILABLE_SLOT').length, 0)
})
check('교시 별칭을 더하지 않고 실제 시각 기준 시수 상한 부족을 증명한다', () => {
  const b = fixture({ slots: [slot('s1'), slot('same_time')] }), r = review(b), card = code(r, 'RESOURCE_PERIOD_SHORTAGE')[0]
  assert.equal(card.resourceId, 'room'); assert.equal(card.requiredPeriods, 3); assert.equal(card.availableUpperBound, 1); assert.equal(r.canCalculate, false)
})
check('자원 수용량을 곱한 안전한 상한으로 부족을 판정한다', () => {
  const b = fixture({ capacity: 2, slots: [slot('s1')] }), card = code(review(b), 'RESOURCE_PERIOD_SHORTAGE')[0]
  assert.equal(card.requiredPeriods, 3); assert.equal(card.availableUpperBound, 2)
  b.resources[0].capacity = 3; assert.equal(review(b).canCalculate, true)
})
check('긴 연속 블록의 시수를 보존하고 겹치는 낱개 교시와 중복 합산하지 않는다', () => {
  const b = fixture({ n: 2, slots: [slot('s1'), slot('s2', 595, 640), slot('block', 540, 640, 2)] })
  b.lessons[0].periods = 2; b.lessons[0].allowedSlotIds = ['block']; b.courseLoads[0].periods = 2
  const r = review(b), card = code(r, 'RESOURCE_PERIOD_SHORTAGE').find(c => c.resourceId === 'room')
  assert.equal(card.requiredPeriods, 3); assert.equal(card.availableUpperBound, 2); assert.equal(m.solveTimetable(b).status, 'infeasible')
})
check('블록 시수 불일치·중복 고정·누락 자원·모르는 필드는 충돌 증명보다 먼저 입력 오류로 분리한다', () => {
  const changes = [b => { b.slots[0].periods = 2 }, b => { b.fixed = [{ lessonId: 'l1', slotId: 's1' }, { lessonId: 'l1', slotId: 's2' }] }, b => { b.lessons[0].resourceIds.push('foreign') }, b => { b.extra = true }]
  for (const change of changes) { const b = fixture(); change(b); const r = m.reviewTimetablePreflight(b); assert.equal(r.status, 'invalid'); assert.equal(r.canCalculate, false); assert.deepEqual(r.cards, []); assert.ok(r.inputIssues.length) }
  for (const invalid of [null, {}, { lessons: null }]) assert.equal(m.reviewTimetablePreflight(invalid).status, 'invalid')
})
check('미지원 조건은 불가능 판정으로 바꾸지 않고 미판정 이유를 보존한다', () => {
  const b = fixture(); b.unsupportedFeatures = ['선택과목 이동 시간']; const r = review(b)
  assert.equal(r.status, 'unsupported'); assert.equal(r.canCalculate, false); assert.deepEqual(r.cards, []); assert.match(m.render(b), /아직 검사할 수 없는 조건/)
})
check('모든 선호 벌점을 바꿔도 필수조건 충돌 판정은 같고 원본은 변하지 않는다', () => {
  const b = fixture({ slots: [slot('s1')] }), before = JSON.stringify(b), initial = review(b)
  assert.equal(JSON.stringify(b), before); b.preferences = b.lessons.map(l => ({ lessonId: l.id, slotId: 's1', weight: 1000000 }))
  assert.deepEqual(review(b), initial)
})
check('수업·교시·자원·조건 순서를 바꿔도 진단과 관련 자료 순서는 같다', () => {
  const b = fixture(); b.fixed = b.lessons.map(l => ({ lessonId: l.id, slotId: 's1' })); b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 540, endMinute: 585 }, { resourceId: 'g2', day: 1, startMinute: 550, endMinute: 570 }]
  const first = review(b); for (const field of ['resources', 'slots', 'lessons', 'courseLoads', 'fixed', 'unavailable']) b[field].reverse()
  for (const l of b.lessons) { l.resourceIds.reverse(); l.allowedSlotIds.reverse() }
  assert.deepEqual(review(b), first)
})
check('일부 수업 집합의 복합 충돌은 미판정으로 남아 해가 있다고 오인하지 않는다', () => {
  const b = fixture({ n: 4, slots: [slot('s1'), slot('s2', 600, 645), slot('s3', 660, 705), slot('s4', 720, 765)] })
  b.lessons.slice(0, 3).forEach(l => { l.allowedSlotIds = ['s1', 's2'] }); b.lessons[3].allowedSlotIds = ['s3', 's4']
  assert.equal(review(b).status, 'undetermined'); assert.equal(m.solveTimetable(b, { maxNodes: 500000, maxMs: 10000 }).status, 'infeasible')
})
check('작은 기초판 192개를 독립 완전탐색하여 가능한 시간표를 잘못 차단하지 않는다', () => {
  let feasible = 0, blocked = 0
  for (let seed = 0; seed < 192; seed++) {
    const b = fixture({ capacity: seed % 2 + 1, slots: [slot('s1'), slot('alias', 560, 605), slot('s2', 585, 630), slot('s3', 645, 690)] })
    for (let i = 0; i < b.lessons.length; i++) b.lessons[i].allowedSlotIds = b.slots.filter((s, j) => (seed >> (j + i)) & 1 || j === (seed + i) % 4).map(s => s.id)
    if (seed % 3 === 0) b.fixed = [{ lessonId: 'l1', slotId: b.lessons[0].allowedSlotIds[0] }]
    if (seed % 5 === 0) b.unavailable = [{ resourceId: seed % 10 === 0 ? 'room' : 't2', day: 1, startMinute: 555, endMinute: 590 }]
    const r = review(b); let exists = false
    for (const a of b.lessons[0].allowedSlotIds) for (const c of b.lessons[1].allowedSlotIds) for (const d of b.lessons[2].allowedSlotIds) {
      if (m.validatePlacements(b, [{ lessonId: 'l1', slotId: a }, { lessonId: 'l2', slotId: c }, { lessonId: 'l3', slotId: d }]).valid) exists = true
    }
    if (exists) { feasible++; assert.equal(r.canCalculate, true, `feasible seed ${seed}: ${JSON.stringify(r.cards)}`) }
    if (r.status === 'blocked') { blocked++; assert.equal(exists, false, `false proof seed ${seed}`) }
  }
  assert.ok(feasible > 20); assert.ok(blocked > 20)
})
console.log(`시간표 계산 전 충돌 설명 검사: ${count}개 통과`)
