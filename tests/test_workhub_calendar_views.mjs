import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { addDays, monthRange, weekRange, shiftPeriod, monthGrid, daysInRange, dateRange, dayLabel, rangeLabel, overlaps, filterCalendarEvents, upcomingPreview, fixtureData, render } = await loadBrowserModule(`
  export * from '../apps/workhub/src/calendar/presentation.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { CalendarPanel } from '../apps/workhub/src/calendar/CalendarPanel.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export const render = page => renderToStaticMarkup(<CalendarPanel member={fixtureData.memberships[0]} members={fixtureData.memberships} schoolName="합성 학교" date={fixtureData.basisDate} adapter={{list:async()=>[],get:async()=>{throw Error('unused')},save:async()=>{throw Error('unused')}}} revision={0} page={page} onPageChange={()=>{}} homeExtras={<p>독립 업무 카드</p>} />)
`)
const member = fixtureData.memberships[0], today = fixtureData.basisDate
const make = (id, startDate, endDate = startDate, changes = {}) => ({ ...fixtureData.events[0], id, title: id, startDate, endDate, ...changes })
let failures = 0, passed = 0
async function test(name, run) { try { await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failures++; console.error(`  ✗ ${name}: ${error.stack}`) } }

await test('날짜 계산은 월·연도·윤년 경계를 정확히 넘는다', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-03-01', -1), '2028-02-29')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  for (const date of ['2026-02-30', '', '2026-1-01']) assert.throws(() => addDays(date, 1))
})
await test('주는 월요일부터 일요일까지이며 일요일을 다음 주로 밀지 않는다', () => {
  assert.deepEqual(weekRange('2026-10-18'), { start: '2026-10-12', end: '2026-10-18' })
  assert.deepEqual(weekRange('2026-10-19'), { start: '2026-10-19', end: '2026-10-25' })
  assert.deepEqual(weekRange('2027-01-01'), { start: '2026-12-28', end: '2027-01-03' })
})
await test('월 이동은 31일을 짧은 달 말일로 보정하고 윤년을 지킨다', () => {
  assert.equal(shiftPeriod('2026-01-31', 'month', 1), '2026-02-28')
  assert.equal(shiftPeriod('2028-01-31', 'list', 1), '2028-02-29')
  assert.equal(shiftPeriod('2026-10-19', 'week', -1), '2026-10-12')
  assert.deepEqual(monthRange('2028-02-02'), { start: '2028-02-01', end: '2028-02-29' })
})
await test('월간 격자는 전체 주를 채우며 앞뒤 달과 본월을 구분한다', () => {
  const grid = monthGrid('2026-03-17')
  assert.equal(grid.length, 42)
  assert.equal(grid[0].date, '2026-02-23'); assert.equal(grid.at(-1).date, '2026-04-05')
  assert.equal(grid.filter(day => day.inMonth).length, 31)
  assert.equal(new Set(grid.map(day => day.date)).size, grid.length)
  assert.equal(daysInRange(dateRange('week', today)).length, 7)
})
await test('기간 교차·종일 종료일·하루 일정을 포함하고 벗어난 일정은 제외한다', () => {
  const range = { start: '2026-10-01', end: '2026-10-31' }
  assert.equal(overlaps(make('cross', '2026-09-30', '2026-10-01', { allDay: true }), range), true)
  assert.equal(overlaps(make('whole', '2026-09-01', '2026-11-01'), range), true)
  assert.equal(overlaps(make('end', '2026-10-31'), range), true)
  assert.equal(overlaps(make('outside', '2026-11-01'), range), false)
  assert.equal(overlaps(make('past', '2026-09-30'), range), false)
})
await test('목록은 겹치는 원본을 한 번만 세며 제목·장소·안내를 검색한다', () => {
  const events = [make('a', '2026-09-30', '2026-10-03', { description: '미리 준비물 확인' }), make('b', '2026-10-02', undefined, { location: '도서관' }), make('c', '2026-11-03')]
  const filter = { search: '', relation: 'all', range: monthRange(today) }
  assert.deepEqual(filterCalendarEvents(events, member, today, filter).map(row => row.id), ['a', 'b'])
  assert.equal(filterCalendarEvents(events, member, today, { ...filter, search: '  준비물  ' })[0].id, 'a')
  assert.equal(filterCalendarEvents(events, member, today, { ...filter, search: '도서관' })[0].id, 'b')
  assert.equal(filterCalendarEvents(events, member, today, { ...filter, search: '없는 말' }).length, 0)
})
await test('관련 필터는 읽기 권한과 분리하고 타학교·타인 개인 일정을 노출하지 않는다', () => {
  const all = filterCalendarEvents(fixtureData.events, member, today, { search: '', relation: 'all' })
  const related = filterCalendarEvents(fixtureData.events, member, today, { search: '', relation: 'related' })
  assert.ok(all.some(row => row.id === 'fixture-event-research'))
  assert.ok(!related.some(row => row.id === 'fixture-event-research'))
  for (const id of ['fixture-event-restricted', 'fixture-event-private', 'fixture-event-nuri']) assert.ok(!all.some(row => row.id === id))
  assert.ok(related.some(row => row.id === 'fixture-event-my'))
  assert.equal(filterCalendarEvents(fixtureData.events, { ...member, active: false }, today, { search: '', relation: 'all' }).length, 0)
})
await test('진행 중인 관련 일정은 현재 기준일의 활성 소속으로 판정한다', () => {
  const incoming = { ...member, validFrom: today }
  const events = [make('ongoing', '2026-10-16', today)]
  assert.equal(filterCalendarEvents(events, incoming, today, { search: '', relation: 'related' }).length, 1)
})
await test('다가오는 7일은 내일부터 7일째까지이며 진행 중·8일째를 제외하고 4개로 제한한다', () => {
  const events = Array.from({ length: 8 }, (_, index) => make(`future-${index}`, addDays(today, index + 1)))
  events.push(make('ongoing', addDays(today, -1), addDays(today, 3)))
  const preview = upcomingPreview(events, member, today)
  assert.deepEqual(preview.range, { start: '2026-10-20', end: '2026-10-26' })
  assert.equal(preview.total, 7); assert.equal(preview.items.length, 4)
  assert.deepEqual(preview.items.map(row => row.event.id), ['future-0', 'future-1', 'future-2', 'future-3'])
})
await test('같은 날짜는 종일·시간·원본 ID 기준으로 안정 정렬하고 빈 입력은 빈 목록이다', () => {
  const events = [make('z', today), make('a', today), make('all-day', today, today, { allDay: true, startTime: '', endTime: '' })]
  assert.deepEqual(filterCalendarEvents(events, member, today, { search: '', relation: 'all' }).map(row => row.id), ['all-day', 'a', 'z'])
  assert.deepEqual(filterCalendarEvents(null, member, today, { search: '', relation: 'all' }), [])
})
await test('주·월 표제와 SSR 초기 화면은 기준·보기·로딩을 구분한다', () => {
  assert.equal(dayLabel(today), '10월 19일 (월)')
  assert.equal(rangeLabel(monthRange(today), 'month'), '2026년 10월')
  const calendar = render('calendar'), home = render('home')
  for (const text of ['일정 보기 방식', '일정 검색', '표시할 일정', '오늘로', '현재 소속의 일정을 불러오는 중']) assert.ok(calendar.includes(text))
  assert.ok(!calendar.includes('아직 등록된 일정이 없어요'))
  assert.ok(home.includes('독립 업무 카드')); assert.ok(home.includes('현재 소속의 일정을 불러오는 중'))
})
console.log(`\n일정 보기 ${passed}개 통과, ${failures}개 실패`)
if (failures) process.exitCode = 1
