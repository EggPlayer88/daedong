import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, fixtureData, collectionWorkbench, filterCollectionRequests, filterCollectionUnits, renderTable, renderDetail } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { CollectionWorkbench } from '../apps/workhub/src/workflows/CollectionWorkbench.tsx'
  import { WorkflowPanel } from '../apps/workhub/src/workflows/WorkflowPanel.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { createWorkflowStore } from '../apps/workhub/src/workflows/store.ts'
  export { collectionWorkbench, filterCollectionRequests, filterCollectionUnits } from '../apps/workhub/src/workflows/collection-workbench.ts'
  export const renderTable = data => renderToStaticMarkup(<CollectionWorkbench data={data} onOpenUnit={() => {}} />)
  export const renderDetail = (store, memberId, requestId, unitId) => renderToStaticMarkup(<WorkflowPanel store={store} member={fixtureData.memberships.find(value => value.id === memberId)} members={fixtureData.memberships} date={fixtureData.basisDate} page="collections" initialRequestId={requestId} initialUnitId={unitId} />)
`)
const members = fixtureData.memberships, date = fixtureData.basisDate, author = 'gaon-soyeon', manager = 'gaon-minjun'
const member = id => members.find(value => value.id === id)
let failed = 0, passed = 0, serial = 0
const key = () => `collection-workbench-${++serial}`
function test(name, run) { try { run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`) } }
function setup({ count = 5, mode = 'required', publish = true } = {}) {
  const store = createWorkflowStore({ members, date })
  let request = store.createCollection(manager, { title: '합성 행사 준비 수합', instructions: '이 안내는 제목 검색에 포함하지 않습니다', dueDate: '2026-10-21', reviewMode: mode, reviewerMemberId: mode === 'required' ? manager : '', textLabel: '준비 내용', textRequired: true, numberLabel: '수량', numberRequired: true, units: Array.from({ length: count }, (_, i) => ({ label: `합성 ${i + 1}반`, responsibleMemberId: author, contributorMemberIds: [] })) }, key())
  if (publish) request = store.publishCollection(manager, request.id, request.version, key())
  return { store, request, units: store.listUnits(manager, request.id) }
}
function submit(store, unit, number = 5) {
  const prior = store.getDraft(author, unit.id)
  const draft = store.saveDraft(author, unit.id, { text: '진행표에 노출되면 안 되는 제출 본문', number }, prior?.version ?? 0, key())
  return store.submit(author, unit.id, draft.version, store.unitSummary(author, unit.id).unit.version, key(), prior ? '합성 정정 이유' : '')
}
function review(store, unit, decision = 'accepted', due = '') {
  const summary = store.unitSummary(manager, unit.id)
  return store.review(manager, unit.id, summary.current.id, decision, decision === 'changes_requested' ? '합성 보완 의견' : '', due, summary.unit.version, key())
}
const table = (store, request, id = manager) => collectionWorkbench(store, member(id), request)

test('미제출·검토대기·보완·완료·완료본과 새판 상태를 단위당 한 번 집계한다', () => {
  const { store, request, units } = setup()
  submit(store, units[1]); submit(store, units[2]); review(store, units[2], 'changes_requested', '2026-10-22')
  submit(store, units[3], 0); review(store, units[3]); submit(store, units[4], 10); review(store, units[4]); submit(store, units[4], 100)
  const value = table(store, request)
  assert.deepEqual(value.counts, { missing: 1, pending: 1, changes: 1, complete: 1, revising: 1 })
  assert.equal(value.rows[4].currentRevision, 2); assert.equal(value.rows[4].effectiveRevision, 1)
  assert.equal(store.collectionSummary(manager, request.id).numericTotal, 10)
})
test('완료본이 있어도 남은 보완을 우선 표시하며 완료본 집계는 유지한다', () => {
  const { store, request, units } = setup({ count: 1 }); const unit = units[0]
  submit(store, unit, 7); review(store, unit); submit(store, unit, 900); review(store, unit, 'changes_requested', '2026-10-21')
  let row = table(store, request).rows[0]
  assert.equal(row.state, 'changes'); assert.equal(row.effectiveRevision, 1); assert.equal(row.currentRevision, 2)
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '합성 철회 사유', key())
  row = table(store, request).rows[0]
  assert.equal(row.state, 'changes'); assert.equal(row.currentRevision, 1); assert.equal(row.pendingSupplementCount, 1)
  assert.equal(store.collectionSummary(manager, request.id).numericTotal, 7)
})
test('마감 당일은 연체가 아니며 다음날 미제출 기한 초과만 집계한다', () => {
  const { store, request, units } = setup({ count: 2 }); submit(store, units[1])
  store.setContext({ members, date: request.dueDate }); assert.equal(table(store, request).overdueCount, 0)
  store.setContext({ members, date: '2026-10-22' }); const value = table(store, request)
  assert.equal(value.overdueCount, 1); assert.equal(value.rows[0].overdue, true); assert.equal(value.rows[1].overdue, false)
})
test('최초 제출 지연과 현재 미제출·보완 연체를 섞지 않는다', () => {
  const { store, request, units } = setup({ count: 1 }); const unit = units[0]
  store.setContext({ members, date: '2026-10-22' })
  store.openCorrection(manager, unit.id, '2026-10-25', '합성 제출 허용', unit.version, key()); submit(store, unit)
  let row = table(store, request).rows[0]; assert.equal(row.initiallyLate, true); assert.equal(row.overdue, false)
  review(store, unit, 'changes_requested', '2026-10-23'); store.setContext({ members, date: '2026-10-24' })
  row = table(store, request).rows[0]; assert.equal(row.overdue, true); assert.equal(row.dueDate, '2026-10-23'); assert.equal(row.state, 'changes')
  const html = renderTable(table(store, request)); assert.match(html, /최초 제출 지연/); assert.match(html, /보완 기한 초과/)
})
test('완료본은 검토없는 응답의 숫자 0도 완료로 표시한다', () => {
  const { store, request, units } = setup({ mode: 'none', count: 1 }); submit(store, units[0], 0)
  const row = table(store, request).rows[0]
  assert.equal(row.state, 'complete'); assert.equal(row.nextStep, '검토 없이 응답 완료'); assert.equal(store.collectionSummary(manager, request.id).numberResponseUnits, 1)
})
test('초안·본문·숫자·검토의견을 메타데이터나 검색에 복제하지 않는다', () => {
  const { store, request, units } = setup({ count: 2 }); submit(store, units[0]); review(store, units[0], 'changes_requested', '2026-10-23')
  store.saveDraft(author, units[1].id, { text: '비공개 공동초안', number: 999 }, 0, key())
  const value = table(store, request), content = JSON.stringify(value) + renderTable(value)
  for (const text of ['진행표에 노출되면 안 되는 제출 본문', '비공개 공동초안', '합성 보완 의견', '999']) assert(!content.includes(text))
  assert.equal(filterCollectionUnits(value.rows, '비공개 공동초안', 'all', false).length, 0)
})
test('현재 열람 가능한 제출 단위만 분모에 넣는다', () => {
  const { store } = setup({ count: 1 })
  const draft = store.createCollection(manager, { title: '단위 권한 분리', instructions: '', dueDate: '2026-10-21', reviewMode: 'none', reviewerMemberId: '', textLabel: '내용', textRequired: false, numberLabel: '', numberRequired: false, units: [{ label: '내 단위', responsibleMemberId: author, contributorMemberIds: [] }, { label: '다른 교사 단위', responsibleMemberId: 'gaon-seojin', contributorMemberIds: [] }] }, key())
  const request = store.publishCollection(manager, draft.id, draft.version, key())
  assert.equal(table(store, request).rows.length, 2); const own = table(store, request, author)
  assert.equal(own.rows.length, 1); assert.equal(own.rows[0].label, '내 단위'); assert.equal(own.counts.missing, 1)
})
test('다른 학교·열람 불가·잘못된 읽기 결과를 성공한 빈 현황으로 처리하지 않는다', () => {
  const { store, request } = setup()
  assert.throws(() => table(store, request, 'nuri-soyeon'))
  assert.throws(() => table(store, request, 'gaon-ended'))
  assert.throws(() => collectionWorkbench({ listUnits: () => 'invalid', unitSummary: store.unitSummary }, member(manager), request))
  assert.throws(() => collectionWorkbench({ listUnits: () => [{ schoolId: 'other', requestId: request.id }], unitSummary: store.unitSummary }, member(manager), request))
})
test('제목 검색은 유니코드 정규화와 여러 낱말 조건을 지원한다', () => {
  const { store } = setup({ publish: false }); const requests = store.listCollections(manager)
  assert.equal(filterCollectionRequests(requests, '행사 합성'.normalize('NFD'), 'draft').length, 1)
  assert.equal(filterCollectionRequests(requests, '합성 없음', 'all').length, 0)
  assert.equal(filterCollectionRequests(requests, '이 안내는', 'all').length, 0)
  assert.equal(filterCollectionRequests(requests, '', 'published').length, 0)
  assert.equal(filterCollectionRequests(store.listCollections(author), '', 'draft').length, 0)
})
test('단위 이름·책임자 찾기와 상태·기한 조건을 함께 적용한다', () => {
  const { store, request, units } = setup({ count: 2 }); submit(store, units[1]); store.setContext({ members, date: '2026-10-22' })
  const value = table(store, request)
  assert.equal(filterCollectionUnits(value.rows, '한소연 1반', 'missing', true).length, 1)
  assert.equal(filterCollectionUnits(value.rows, '2반', 'pending', false).length, 1)
  assert.equal(filterCollectionUnits(value.rows, '2반', 'pending', true).length, 0)
  assert.equal(value.rows.length, 2)
})
test('깨진 필터 배열은 화면 예외 대신 빈 결과를 반환한다', () => {
  assert.deepEqual(filterCollectionRequests(null, '', 'all'), [])
  assert.deepEqual(filterCollectionRequests([null, {}, { title: 5 }], '', 'all'), [])
  assert.deepEqual(filterCollectionUnits('invalid', '', 'all', false), [])
  assert.deepEqual(filterCollectionUnits([null, { label: 3 }], '', 'all', false), [])
})
test('진행표 SSR은 접근성 이름과 명시적인 단위 원본 버튼을 제공한다', () => {
  const { store, request } = setup({ count: 2 }); const html = renderTable(table(store, request))
  assert.match(html, /aria-label="제출 단위 진행현황"/); assert.match(html, /<table/); assert.match(html, /scope="row"/)
  assert.match(html, /합성 2반 제출 단위 원본 보기/); assert.match(html, /공동 초안 내용은 이 표에 표시하지 않습니다/)
})
test('20부를 넘으면 첫 페이지 표만 표시하며 전체 분모는 유지한다', () => {
  const { store, request } = setup({ count: 23 }); const html = renderTable(table(store, request))
  assert.equal((html.match(/data-wf-progress-unit=/g) ?? []).length, 20)
  assert.match(html, /현재 열람 가능한 23부/); assert.match(html, /제출 단위 표 페이지/); assert(!html.includes('합성 23반 제출 단위 원본 보기'))
})
test('수합 원본은 완료본 숫자 집계와 기존 단위 직접 이동 표시를 유지한다', () => {
  const { store, request, units } = setup({ count: 2 }); submit(store, units[0], 0); review(store, units[0])
  const html = renderDetail(store, manager, request.id, units[1].id)
  assert.match(html, /수량 합계: <strong>0<\/strong>/); assert.match(html, /수합 제목 찾기/); assert.match(html, /wf-unit-target/)
  assert.match(html, /현재 열람 가능한 2부/); assert.match(html, /data-wf-unit-id=/)
})
test('현재 요청에 없는 초기 단위는 다른 단위로 대체하지 않는다', () => {
  const { store, request } = setup({ count: 1 }); const html = renderDetail(store, manager, request.id, 'missing-unit')
  assert.match(html, /요청한 제출 단위를 현재 확인할 수 없습니다/); assert(!html.includes('wf-unit-target'))
})
test('현황 읽기와 렌더는 저장된 수합을 변경하지 않는다', () => {
  const { store, request } = setup({ count: 2 }); const before = JSON.stringify(store.exportState())
  renderTable(table(store, request)); renderDetail(store, manager, request.id)
  assert.equal(JSON.stringify(store.exportState()), before)
})
console.log(`\n수합 작업현황 검증: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
