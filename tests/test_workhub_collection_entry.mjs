import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { collectionEntryGuide, responseEntryGuide, renderGuide, renderPublish, fixtureData, createWorkflowStore } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionRequestPreview, EntryChecklist, EntryIssues} from '../apps/workhub/src/workflows/CollectionEntryGuide.tsx'
  import {collectionEntryGuide} from '../apps/workhub/src/workflows/entry-guide.ts'
  import {WorkflowPanel} from '../apps/workhub/src/workflows/WorkflowPanel.tsx'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
  export {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
  export {createWorkflowStore} from '../apps/workhub/src/workflows/store.ts'
  export {collectionEntryGuide,responseEntryGuide} from '../apps/workhub/src/workflows/entry-guide.ts'
  export const renderGuide = input => {const guide=collectionEntryGuide(input,fixtureData.memberships,'fixture-school-gaon',fixtureData.basisDate);return renderToStaticMarkup(<><EntryChecklist checks={guide.checks} label="저장 전 입력 확인"/><CollectionRequestPreview input={input} guide={guide}/><EntryIssues guide={guide}/></>)}
  export const renderPublish = (store,id) => renderToStaticMarkup(<WorkflowPanel store={store} page="collections" initialRequestId={id} member={fixtureData.memberships.find(m=>m.id==='gaon-minjun')} members={fixtureData.memberships} date={fixtureData.basisDate}/>);
`)
const members = fixtureData.memberships, date = fixtureData.basisDate, school = 'fixture-school-gaon'
const base = () => ({ title: '합성 현장체험 수합', instructions: '반별 준비 내용을 작성합니다.', dueDate: '2026-10-21', reviewMode: 'required', reviewerMemberId: 'gaon-minjun', textLabel: '안내 사항', textRequired: true, numberLabel: '준비 수량', numberRequired: true, units: [{ label: '2학년 1반', responsibleMemberId: 'gaon-soyeon', contributorMemberIds: ['gaon-seojin'] }] })
const guide = input => collectionEntryGuide(input, members, school, date)
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('안내는 제출 부수와 중복을 뺀 작성 교사 수를 구분한다', () => {
  const input = base(); input.units.push({ label: '2학년 2반', responsibleMemberId: 'gaon-soyeon', contributorMemberIds: ['gaon-seojin', 'gaon-seojin'] })
  const value = guide(input)
  assert.equal(value.unitCount, 2); assert.equal(value.memberCount, 2); assert.equal(value.requiredQuestionCount, 2)
  assert.equal(value.reviewerName, '이민준'); assert.equal(value.issues.length, 0); assert(value.checks.every(check => check.ready))
  assert.deepEqual(value.units[0].contributors, ['김서진'])
})
test('제목·날짜·문항·단위 누락을 입력 중에 함께 설명한다', () => {
  const input = base(); Object.assign(input, { title: '  ', dueDate: '2026-02-30', textLabel: '', numberLabel: '', units: [] })
  const value = guide(input)
  assert(value.issues.some(text => text.includes('제목'))); assert(value.issues.some(text => text.includes('마감일')))
  assert(value.issues.some(text => text.includes('문항'))); assert(value.issues.some(text => text.includes('단위')))
  assert.equal(value.checks.filter(check => !check.ready).length, 3)
})
test('공백 제거 후 중복 단위 이름은 기존 저장소와 같이 안내한다', () => {
  const input = base(); input.units.push({ ...input.units[0], label: '  2학년 1반  ' })
  assert(guide(input).issues.some(text => text.includes('중복')))
  assert.throws(() => createWorkflowStore({ members, date }).createCollection('gaon-minjun', input, 'duplicate'), /중복/)
})
test('검토자와 책임자 중복을 알리고 공동작성자 겸임은 허용한다', () => {
  const input = base(); input.reviewerMemberId = 'gaon-soyeon'
  assert(guide(input).issues.some(text => text.includes('겹칩니다')))
  const store = createWorkflowStore({ members, date }); assert.throws(() => store.createCollection('gaon-minjun', input, 'own-review'), /자신의 제출/)
  input.reviewerMemberId = 'gaon-seojin'; assert.equal(guide(input).issues.length, 0); assert(store.createCollection('gaon-minjun', input, 'contributor-review').id)
})
test('같은 학교의 현재 소속만 대상과 검토자로 안내한다', () => {
  const input = base(); input.units[0].responsibleMemberId = 'nuri-soyeon'; input.units[0].contributorMemberIds = ['gaon-ended']; input.reviewerMemberId = 'gaon-ended'
  const value = guide(input)
  assert.equal(value.memberCount, 0); assert.equal(value.reviewerName, ''); assert.equal(value.units[0].responsible, '책임자 확인 필요')
  assert.equal(value.issues.length, 3)
})
test('마감 당일은 정상이고 지난 마감은 경고만 하며 저장을 임의 차단하지 않는다', () => {
  const input = base(); input.dueDate = date; assert.equal(guide(input).warnings.length, 0)
  input.dueDate = '2026-10-18'; const value = guide(input)
  assert.equal(value.issues.length, 0); assert.equal(value.warnings.length, 1)
  assert(createWorkflowStore({ members, date }).createCollection('gaon-minjun', input, 'past-date').id)
})
test('선택 문항만 받는 수합은 안내 문구와 저장소에서 모두 허용한다', () => {
  const input = base(); input.textRequired = false; input.numberRequired = false; input.reviewMode = 'none'; input.reviewerMemberId = ''
  const value = guide(input); assert.equal(value.requiredQuestionCount, 0); assert.equal(value.issues.length, 0)
  assert(value.checks.find(check => check.label === '응답 문항').detail.includes('모두 선택 응답'))
  assert(createWorkflowStore({ members, date }).createCollection('gaon-minjun', input, 'optional').id)
})
test('책임자가 공동 작성자 배열에도 있어도 같은 교사를 중복 표시하지 않는다', () => {
  const input = base(); input.units[0].contributorMemberIds = ['gaon-soyeon', 'gaon-seojin', 'gaon-seojin']
  const value = guide(input); assert.equal(value.memberCount, 2); assert.deepEqual(value.units[0].contributors, ['김서진'])
})
test('기존 저장소의 제출 단위 100개 한도를 안내하고 101개는 확인 필요로 표시한다', () => {
  const input = base(); input.units = Array.from({ length: 100 }, (_, i) => ({ ...input.units[0], label: `단위 ${i + 1}` }))
  assert(guide(input).checks.find(check => check.label === '제출 대상').ready)
  const store = createWorkflowStore({ members, date }); assert(store.createCollection('gaon-minjun', input, 'limit-100').id)
  input.units.push({ ...input.units[0], label: '단위 101' })
  assert.equal(guide(input).checks.find(check => check.label === '제출 대상').ready, false)
  assert(guide(input).issues.some(issue => issue.includes('최대 100개')))
  assert.throws(() => store.createCollection('gaon-minjun', input, 'limit-101'), /제출 단위/)
})
test('깨진 대상 배열과 null은 입력 안내를 중단시키지 않는다', () => {
  assert.equal(guide({ ...base(), units: null }).unitCount, 0)
  assert.equal(guide({ ...base(), units: 'invalid' }).unitCount, 0)
  const value = guide({ ...base(), units: [null] }); assert.equal(value.units[0].responsible, '책임자 확인 필요')
  assert(collectionEntryGuide(null, null, school, date).issues.length > 0)
})
test('필수 글·숫자가 비어 있으면 최종 제출 안내만 미완료로 표시한다', () => {
  const input = base(), checks = responseEntryGuide(input, { text: ' ', number: null }, false, '')
  assert.equal(checks.filter(check => !check.ready).length, 2)
  const store = createWorkflowStore({ members, date }), request = store.createCollection('gaon-minjun', input, 'create')
  store.publishCollection('gaon-minjun', request.id, request.version, 'publish'); const unit = store.listUnits('gaon-soyeon', request.id)[0]
  const draft = store.saveDraft('gaon-soyeon', unit.id, { text: '', number: null }, 0, 'draft')
  assert(draft.id); assert.throws(() => store.submit('gaon-soyeon', unit.id, draft.version, unit.version, 'submit'), /필수 응답/)
})
test('숫자 0·음수·소수는 유효한 응답이고 무한대·NaN은 확인 대상으로 남긴다', () => {
  for (const number of [0, -2, 1.25]) assert(responseEntryGuide(base(), { text: '합성 응답', number }, false, '').every(check => check.ready))
  for (const number of [Infinity, -Infinity, NaN]) assert.equal(responseEntryGuide(base(), { text: '합성 응답', number }, false, '')[1].ready, false)
})
test('선택 숫자의 null과 0을 모두 허용하고 잘못된 숫자는 구분한다', () => {
  const input = { ...base(), textRequired: false, numberRequired: false }
  assert(responseEntryGuide(input, { text: '', number: null }, false, '').every(check => check.ready))
  assert(responseEntryGuide(input, { text: '', number: 0 }, false, '').every(check => check.ready))
  assert.equal(responseEntryGuide(input, { text: '', number: NaN }, false, '')[1].ready, false)
})
test('재제출 사유는 최초 응답에 요구하지 않고 새 판에만 안내한다', () => {
  const response = { text: '합성 응답', number: 0 }
  assert.equal(responseEntryGuide(base(), response, false, '').length, 2)
  assert.equal(responseEntryGuide(base(), response, true, '  ').at(-1).ready, false)
  assert.equal(responseEntryGuide(base(), response, true, '수량 재확인').at(-1).ready, true)
})
test('미리보기 SSR은 글·숫자 필수와 책임자·공동작성자·검토자를 구분한다', () => {
  const html = renderGuide(base())
  assert.match(html, /작성 중인 수합 미리보기/); assert.match(html, /저장 전 입력 확인/); assert.match(html, /최종 제출: 한소연/)
  assert.match(html, /공동 작성: 김서진/); assert.match(html, /이민준 · 검토 후 완료/); assert.match(html, /안내 사항/); assert.match(html, /준비 수량/)
})
test('입력된 HTML은 미리보기에서 실행 요소로 해석하지 않는다', () => {
  const input = base(); input.title = '<script>alert(1)</script>'; input.instructions = '<img src=x onerror=alert(1)>'
  const html = renderGuide(input); assert(!html.includes('<script>')); assert(!html.includes('<img ')); assert.match(html, /&lt;script&gt;/)
})
test('게시 전 미리보기는 저장 원본의 대상과 문항을 사용한다', () => {
  const input = base(), store = createWorkflowStore({ members, date }), request = store.createCollection('gaon-minjun', input, 'create')
  input.title = '저장하지 않은 변경'; const html = renderPublish(store, request.id)
  assert.match(html, /게시 전 대상 확인/); assert.match(html, /게시할 수합 미리보기/); assert.match(html, /합성 현장체험 수합/); assert(!html.includes('저장하지 않은 변경'))
  assert.match(html, /게시할 때 최신 원본과 대상 소속을 다시 확인/); assert.match(html, /대상 확인 · 게시/)
})
console.log(`\n수합 입력 안내 검증: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
