import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, fixtureData, render } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {WorkflowPanel} from '../apps/workhub/src/workflows/WorkflowPanel'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures'
  export {fixtureData} from '../apps/workhub/src/preview/fixtures'
  export {createWorkflowStore} from '../apps/workhub/src/workflows/store'
  export const render=(store, requestId, unitId, memberId='gaon-minjun')=>renderToStaticMarkup(<WorkflowPanel member={fixtureData.memberships.find(m=>m.id===memberId)} members={fixtureData.memberships} date={fixtureData.basisDate} store={store} page="collections" initialRequestId={requestId} initialUnitId={unitId}/>);
`)
const members = fixtureData.memberships, date = fixtureData.basisDate, manager = 'gaon-minjun', author = 'gaon-soyeon'
let serial = 0, passed = 0, failed = 0
const key = () => `수합-페이지-${++serial}`
const store = createWorkflowStore({ members, date })
let request = store.createCollection(manager, { title: '합성 대량 수합', instructions: '', dueDate: '2026-10-21', reviewMode: 'none', reviewerMemberId: '', textLabel: '내용', textRequired: true, numberLabel: '수량', numberRequired: true, units: Array.from({ length: 100 }, (_, i) => ({ label: `합성 ${i + 1}반`, responsibleMemberId: author, contributorMemberIds: [] })) }, key())
request = store.publishCollection(manager, request.id, request.version, key())
const units = store.listUnits(manager, request.id)
for (const unit of [units[0], units[99]]) {
  for (let revision = 1; revision <= 3; revision++) {
    const prior = store.getDraft(author, unit.id), draft = store.saveDraft(author, unit.id, { text: `제출 원문 ${revision}`, number: revision }, prior?.version ?? 0, key())
    store.submit(author, unit.id, draft.version, store.unitSummary(author, unit.id).unit.version, key(), revision > 1 ? `이력 사유 ${revision}` : '')
  }
}
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
test('100개 단위 중 20개 상세만 만들고 표와 총계는 전체 자료를 따른다', () => {
  const html = render(store, request.id)
  assert.equal((html.match(/data-wf-unit-id=/g) ?? []).length, 20)
  assert.equal((html.match(/data-wf-progress-unit=/g) ?? []).length, 20)
  assert.match(html, /열람 가능한 단위 <strong>100부/)
  assert.match(html, /수량 합계: <strong>6<\/strong>/)
  assert.match(html, /aria-label="제출 단위 원본 페이지"/)
})
test('초기 원본 단위가 마지막 쪽에 있어도 그 단위와 해당 쪽만 렌더한다', () => {
  const html = render(store, request.id, units[99].id)
  assert(html.includes(`data-wf-unit-id="${units[99].id}"`))
  assert(!html.includes(`data-wf-unit-id="${units[0].id}"`))
  assert.match(html, /선택한 제출 단위/)
  assert.equal((html.match(/data-wf-unit-id=/g) ?? []).length, 20)
})
test('닫힌 이력은 건수와 펼침 제목만 출력하며 현재 제출은 그대로 보여 준다', () => {
  const html = render(store, request.id)
  assert.match(html, /제출 이력 · 3판/)
  assert.match(html, /제출 원문 3/)
  assert(!html.includes('제출 원문 1')); assert(!html.includes('이력 사유 2'))
})
test('현재 학교에 없는 초기 단위는 다른 단위로 대체하지 않는다', () => {
  const html = render(store, request.id, '없는-단위')
  assert.match(html, /요청한 제출 단위를 현재 확인할 수 없습니다/)
  assert(!html.includes('선택한 제출 단위'))
})
test('1000개 요청은 정확한 초기 요청이 포함된 20개만 렌더한다', () => {
  const snapshot = store.exportState()
  const template = snapshot.requests[0]
  snapshot.requests.push(...Array.from({ length: 999 }, (_, i) => ({ ...template, id: `합성-요청-${i}`, title: `합성 요청 ${i}`, status: 'draft', publishedAt: null, units: template.units.slice(0, 1) })))
  const large = createWorkflowStore({ members, date, snapshot })
  const html = render(large, '합성-요청-998')
  assert.equal((html.match(/class="wf-request-card"/g) ?? []).length, 20)
  assert.match(html, /내가 만든 수합 1000건 중 조건에 맞는 수합 1000건/)
  assert.match(html, /aria-label="수합 요청 목록 페이지"/)
  assert.match(html, /aria-pressed="true"[^>]*><span[^>]*>작성 중 · 비공개<\/span><strong>합성 요청 998/)
})
test('다른 학교 소속은 요청·단위·수량을 렌더하지 않는다', () => {
  const html = render(store, request.id, units[99].id, 'nuri-soyeon')
  assert.match(html, /요청한 수합을 확인할 수 없습니다/)
  assert(!html.includes('data-wf-unit-id=')); assert(!html.includes('수량 합계:'))
})
test('깨진 요청 배열은 성공한 빈 목록 대신 읽기 오류로 보여 준다', () => {
  for (const value of [null, '손상된 배열']) {
    const html = render({ ...store, listCollections: () => value }, request.id)
    assert.match(html, /role="alert"/); assert(!html.includes('wf-request-card'))
  }
})
test('페이지 렌더와 닫힌 이력은 저장된 원본을 변경하지 않는다', () => {
  const before = JSON.stringify(store.exportState()); render(store, request.id, units[99].id)
  assert.equal(JSON.stringify(store.exportState()), before)
})
console.log(`\n수합 목록 페이지 검증: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
