import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/condition-review';export * from '../apps/workhub/src/timetable/sample';import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{ConditionCards}from'../apps/workhub/src/timetable/ConditionCards';export const render=props=>renderToStaticMarkup(React.createElement(ConditionCards,{...props,disabled:false,onRemove(){}}));`)
let count = 0
const check = (name, fn) => { fn(); count++; console.log('  ✓ ' + name) }
const basis = () => m.timetablePracticeSnapshot('2026-10-19').basis
const conditions = b => structuredClone({ fixed: b.fixed, unavailable: b.unavailable, preferences: b.preferences })
check('동명 교사·수업을 ID로 구분하고 연결된 교사·학급 이름으로 고정 수업을 찾는다', () => {
  const b = basis(); b.lessons[0].label = b.lessons[2].label = '국어 1회'; b.resources.filter(r => r.kind === 'teacher').forEach(r => r.label = '동명 교사')
  const c = conditions(b); c.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); c.unavailable.push({ resourceId: 'practice-teacher-b', day: 2, startMinute: 540, endMinute: 585 })
  const review = m.reviewConditions(b, c)
  assert.ok(review.rows[0].label.includes('[practice-lesson-a1]')); assert.ok(review.rows[1].label.includes('[practice-teacher-b]'))
  for (const text of ['practice-teacher-a', 'practice-class-a', '예시 1반']) assert.ok(review.rows[0].search.includes(m.conditionReviewSearch(text)))
})
check('학교가 고정한 필수조건만 삭제를 막고 검색용 자료가 원본 배열을 바꾸지 않는다', () => {
  const b = basis(); b.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); b.preferences.push({ lessonId: b.lessons[1].id, slotId: b.slots[0].id, weight: 3 })
  const c = conditions(b); c.unavailable.push({ resourceId: 'practice-teacher-a', day: 2, startMinute: 540, endMinute: 585 }); const before = JSON.stringify([b, c]), r = m.reviewConditions(b, c)
  assert.equal(r.rows.find(row => row.kind === 'fixed').protected, true); assert.equal(r.rows.find(row => row.kind === 'preferences').protected, false); assert.equal(r.rows.find(row => row.kind === 'unavailable').inherited, false); assert.equal(JSON.stringify([b, c]), before)
})
check('검색에서 제외한 조건 앞뒤에도 원래 종류별 행 번호를 보존한다', () => {
  const b = basis(), c = conditions(b); c.unavailable = Array.from({ length: 45 }, (_, i) => ({ resourceId: 'practice-teacher-a', day: 1, startMinute: i * 2, endMinute: i * 2 + 1 }))
  const rows = m.reviewConditions(b, c).rows; assert.deepEqual(rows.slice(20, 40).map(row => row.index), Array.from({ length: 20 }, (_, i) => i + 20)); assert.equal(rows[44].key, 'unavailable:44')
})
check('배치할 시간 없음은 그 수업의 고정과 실제로 겹치는 불가만 연결하고 선호는 원인으로 꼽지 않는다', () => {
  const b = basis(), c = conditions(b); c.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); c.unavailable.push({ resourceId: 'practice-teacher-a', day: 1, startMinute: 550, endMinute: 560 }, { resourceId: 'practice-teacher-a', day: 2, startMinute: 550, endMinute: 560 }); c.preferences.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id, weight: 5 })
  const r = m.reviewConditions(b, c), issue = r.issues.find(row => row.id === 'domain:practice-lesson-a1')
  assert.deepEqual(issue.conditionKeys, ['fixed:0', 'unavailable:0']); assert.ok(issue.title.includes('[practice-lesson-a1]')); assert.ok(issue.message.includes('practice-teacher-a')); assert.equal(r.rows.find(row => row.kind === 'preferences').issueIds.length, 0)
})
check('고정 수업 충돌은 해당 고정 조건을 함께 보여 주고 불가 조건을 잘못 붙이지 않는다', () => {
  const b = basis(), c = conditions(b); c.fixed.push(...b.lessons.slice(0, 2).map(l => ({ lessonId: l.id, slotId: b.slots[0].id }))); c.unavailable.push({ resourceId: 'practice-teacher-a', day: 2, startMinute: 550, endMinute: 560 })
  const r = m.reviewConditions(b, c), issue = r.issues.find(row => row.id === 'fixed:practice-teacher-a:1'); assert.deepEqual(issue.conditionKeys, ['fixed:0', 'fixed:1']); assert.equal(issue.conditionKeys.includes('unavailable:0'), false)
})
check('시수 상한 부족인데 지울 조건이 없으면 빈 관련조건으로 기초자료 수정을 안내한다', () => {
  const b = basis(); b.lessons.forEach(l => l.allowedSlotIds = [b.slots[0].id]); const r = m.reviewConditions(b, conditions(b)); assert.ok(r.issues.some(row => row.id.startsWith('capacity:') && row.conditionKeys.length === 0)); assert.equal(r.rows.length, 0)
})
check('학교 필수조건을 뺀 초안이나 외부 대상 조건을 읽을 수 있는 것으로 꾸미지 않는다', () => {
  const b = basis(); b.fixed.push({ lessonId: b.lessons[0].id, slotId: b.slots[0].id }); assert.throws(() => m.reviewConditions(b, { fixed: [], unavailable: [], preferences: [] })); const c = conditions(b); c.unavailable.push({ resourceId: 'foreign', day: 1, startMinute: 1, endMinute: 2 }); assert.throws(() => m.reviewConditions(b, c))
})
check('많은 조건을 처음부터 전부 렌더하지 않고 출처·페이지·검색 안내를 제공한다', () => {
  const b = basis(), c = conditions(b); c.unavailable = Array.from({ length: 45 }, (_, i) => ({ resourceId: 'practice-teacher-a', day: 1, startMinute: i * 2, endMinute: i * 2 + 1 })); const html = m.render({ basis: b, conditions: c }); assert.equal((html.match(/조건 삭제/g) ?? []).length, 20); assert.ok(html.includes('다음 사용할 수 없는 시간 조건')); assert.ok(html.includes('등록한 조건 출처')); assert.ok(html.includes('사용할 수 없는 시간 · 45건'))
})
check('깨진 조건 배열과 null 원본은 삭제 버튼 대신 재확인 안내를 표시한다', () => {
  for (const input of [{ basis: basis(), conditions: null }, { basis: basis(), conditions: { fixed: [], unavailable: 'broken', preferences: [] } }, { basis: null, conditions: { fixed: [], unavailable: [], preferences: [] } }]) { const html = m.render(input); assert.ok(html.includes('현재 조건을 기준자료와 대조하지 못했습니다')); assert.ok(!html.includes('조건 삭제')) }
})
console.log(`시간표 조건 검토 검사: ${count}개 통과`)
