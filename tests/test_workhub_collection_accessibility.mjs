import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, fixtureData, renderPanel, renderPair } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {WorkflowPanel} from '../apps/workhub/src/workflows/WorkflowPanel.tsx'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
  export {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
  export {createWorkflowStore} from '../apps/workhub/src/workflows/store.ts'
  const panel=(store,id,memberId)=> <WorkflowPanel store={store} page="collections" initialRequestId={id} member={fixtureData.memberships.find(m=>m.id===memberId)} members={fixtureData.memberships} date={fixtureData.basisDate}/>;
  export const renderPanel=(store,id,memberId='gaon-minjun')=>renderToStaticMarkup(panel(store,id,memberId));
  export const renderPair=(store,id)=>renderToStaticMarkup(<>{panel(store,id,'gaon-minjun')}{panel(store,id,'gaon-minjun')}</>);
`)
const members = fixtureData.memberships, date = fixtureData.basisDate
const store = createWorkflowStore({ members, date })
let request = store.createCollection('gaon-minjun', { title: '반복 단위 접근성 수합', instructions: '', dueDate: '2026-10-21', reviewMode: 'required', reviewerMemberId: 'gaon-minjun', textLabel: '내용', textRequired: true, numberLabel: '수량', numberRequired: true, units: [1, 2].map(index => ({ label: `${index}반`, responsibleMemberId: 'gaon-soyeon', contributorMemberIds: [] })) }, 'create')
request = store.publishCollection('gaon-minjun', request.id, request.version, 'publish')
for (const unit of store.listUnits('gaon-minjun', request.id)) {
  const draft = store.saveDraft('gaon-soyeon', unit.id, { text: '합성 내용', number: 0 }, 0, `draft-${unit.id}`)
  store.submit('gaon-soyeon', unit.id, draft.version, unit.version, `submit-${unit.id}`)
}
const html = renderPanel(store, request.id)
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const tags = (source, name) => [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(match => match[0])
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('같은 검토 의견 필드가 단위별로 다른 id와 명시적 label 연결을 갖는다', () => {
  const opinions = tags(html, 'textarea').filter(tag => attr(tag, 'aria-label') === '검토 의견')
  assert.equal(opinions.length, 2); const ids = opinions.map(tag => attr(tag, 'id'))
  assert(ids.every(Boolean)); assert.equal(new Set(ids).size, 2)
  for (const id of ids) assert(html.includes(`for="${id}"`))
})
test('검토 기한과 정정 필드는 단위 제목을 설명으로 연결한다', () => {
  const fields = tags(html, 'input').filter(tag => attr(tag, 'id')?.includes('-review-due') || attr(tag, 'id')?.includes('-correction-'))
  assert.equal(fields.length, 6)
  for (const field of fields) {
    const id = attr(field, 'id'), context = attr(field, 'aria-describedby')
    assert(html.includes(`for="${id}"`)); assert.match(html, new RegExp(`<h4 id="${context}">[12]반</h4>`))
  }
})
test('검토 양식은 해당 단위 이름을 포함한 접근 가능한 이름을 갖는다', () => {
  const reviews = tags(html, 'form').filter(tag => attr(tag, 'class') === 'wf-review-form')
  assert.deepEqual(reviews.map(tag => attr(tag, 'aria-label')), ['1반 제출판 검토', '2반 제출판 검토'])
})
test('진행표 설명은 실제 존재하는 결과 상태와 연결되고 전체 상태를 읽는다', () => {
  const region = tags(html, 'div').find(tag => attr(tag, 'aria-label') === '제출 단위 진행표')
  assert.equal(attr(region, 'tabindex'), '0')
  const result = tags(html, 'p').find(tag => attr(tag, 'id') === attr(region, 'aria-describedby'))
  assert.equal(attr(result, 'role'), 'status'); assert.equal(attr(result, 'aria-atomic'), 'true')
})
test('닫힌 응답 편집 버튼은 접힘 상태를 알려주고 없는 양식을 참조하지 않는다', () => {
  const own = renderPanel(store, request.id, 'gaon-soyeon')
  const toggles = tags(own, 'button').filter(tag => attr(tag, 'aria-expanded') !== undefined)
  assert.equal(toggles.length, 2)
  assert(toggles.every(tag => attr(tag, 'aria-expanded') === 'false' && attr(tag, 'aria-controls') === undefined))
  assert(!own.includes('class="wf-response-form"'))
})
test('저장·게시 결과의 원본 제목은 프로그램 초점을 받을 수 있고 탭 순서를 늘리지 않는다', () => {
  assert.match(html, /<h3 tabindex="-1">반복 단위 접근성 수합<\/h3>/)
  const values = [...html.matchAll(/tabindex="([^"]+)"/g)].map(match => Number(match[1]))
  assert(values.length > 0); assert(values.every(value => value === 0 || value === -1))
})
test('수합 화면 두 개를 함께 렌더해도 useId로 생성한 연결이 충돌하지 않는다', () => {
  const pair = renderPair(store, request.id)
  const ids = [...pair.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
  assert(ids.length > 0); assert.equal(ids.length, new Set(ids).size)
})
test('표는 실제 표·열 머리글·행 머리글과 단위별 원본 버튼을 유지한다', () => {
  assert.match(html, /<table class="wf-workbench-table">/); assert.match(html, /scope="col"/); assert.match(html, /scope="row"/)
  assert.match(html, /aria-label="1반 제출 단위 원본 보기"/); assert.match(html, /aria-label="2반 제출 단위 원본 보기"/)
  assert(!html.includes('role="grid"'))
})
console.log(`\n수합 접근성 SSR 검증: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
