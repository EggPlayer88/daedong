import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, collectionHomeSummary, fixtureData, renderHome, renderDetail } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { WorkflowPanel, HomeWorkSummary } from '../apps/workhub/src/workflows/WorkflowPanel.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { createWorkflowStore } from '../apps/workhub/src/workflows/store.ts'
  export { collectionHomeSummary } from '../apps/workhub/src/workflows/presentation.ts'
  const member = id => fixtureData.memberships.find(value => value.id === id)
  export function renderHome(store, memberId, includeTasks = false) { return renderToStaticMarkup(<HomeWorkSummary store={store} member={member(memberId)} members={fixtureData.memberships} date={fixtureData.basisDate} includeTasks={includeTasks} onOpenCollections={() => {}} />) }
  export function renderDetail(store, memberId, requestId, unitId) { return renderToStaticMarkup(<WorkflowPanel store={store} page="collections" initialRequestId={requestId} initialUnitId={unitId} member={member(memberId)} members={fixtureData.memberships} date={fixtureData.basisDate} />) }
`)
const members = fixtureData.memberships, date = fixtureData.basisDate
const author = 'gaon-soyeon', reviewer = 'gaon-minjun', collaborator = 'gaon-seojin'
const member = id => members.find(value => value.id === id)
let failed = 0
function test(name, action) { try { action(); console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`) } }
function setup({ mode = 'required', sharedReviewer = false, units, publish = true } = {}) {
  const store = createWorkflowStore({ members, date })
  const request = store.createCollection(reviewer, { title: '합성 행사 수량', instructions: '가상 응답 안내', dueDate: '2026-10-21', reviewMode: mode, reviewerMemberId: mode === 'required' ? reviewer : '', textLabel: '확인 내용', textRequired: true, numberLabel: '수량', numberRequired: true,
    units: units ?? [{ label: '2학년 단위', responsibleMemberId: author, contributorMemberIds: sharedReviewer ? [reviewer, collaborator] : [collaborator] }],
  }, 'create')
  if (publish) store.publishCollection(reviewer, request.id, request.version, 'publish')
  return { store, request, unit: publish ? store.listUnits(author, request.id)[0] : undefined }
}
function submit(store, unitId, key = 'first') {
  const saved = store.getDraft(author, unitId)
  const draft = store.saveDraft(author, unitId, { text: '홈에 복제하면 안 되는 응답본문', number: 0 }, saved?.version ?? 0, `draft-${key}`)
  const unit = store.unitSummary(author, unitId).unit
  return store.submit(author, unitId, draft.version, unit.version, key, key === 'first' ? '' : '합성 보완 사유')
}
const summary = (store, id, at = date) => collectionHomeSummary(store, member(id), at)

test('미제출 책임자와 공동작성자의 실제 다음 행동을 구분한다', () => {
  const { store, unit } = setup()
  const owner = summary(store, author), shared = summary(store, collaborator)
  assert.equal(owner.counts.submit, 1); assert.equal(owner.cards[0].unitId, unit.id)
  assert.equal(shared.counts.contribute, 1); assert.equal(shared.cards[0].actionLabel, '공동 초안 작성하기')
  assert.equal(summary(store, reviewer).actionCount, 0)
})
test('제출 후 책임자와 공동작성자는 대기, 지정 검토자는 실제 할 일로 표시한다', () => {
  const { store, unit } = setup(); submit(store, unit.id)
  for (const id of [author, collaborator]) { const value = summary(store, id); assert.equal(value.actionCount, 0); assert.equal(value.waitingCount, 1); assert.equal(value.cards[0].category, 'waiting') }
  const value = summary(store, reviewer)
  assert.equal(value.counts.review, 1); assert.equal(value.actionCount, 1); assert.equal(value.cards[0].actionLabel, '제출판 검토하기')
})
test('공동작성자와 검토자가 겹치면 한 카드에 두 역할과 검토 행동을 표시한다', () => {
  const { store, unit } = setup({ sharedReviewer: true }); submit(store, unit.id)
  const value = summary(store, reviewer)
  assert.equal(value.cards.length, 1); assert.deepEqual(value.cards[0].roles, ['contributor', 'reviewer'])
  assert.equal(value.cards[0].category, 'review'); assert.equal(value.counts.waiting, 0)
})
test('책임자에게 자기 검토 행동을 제안하지 않는다', () => {
  const { store, unit } = setup(); submit(store, unit.id)
  const reader = { listCollections: id => store.listCollections(id).map(value => ({ ...value, reviewerMemberId: author })), listUnits: store.listUnits, unitSummary: store.unitSummary }
  const value = collectionHomeSummary(reader, member(author), date)
  assert.equal(value.counts.review, 0); assert.deepEqual(value.cards[0].roles, ['submitter']); assert.equal(value.cards[0].category, 'waiting')
})
test('검토 없는 완료와 검토 승인 완료는 홈의 열린 업무에서 제외한다', () => {
  const first = setup({ mode: 'none' }); submit(first.store, first.unit.id)
  assert.equal(summary(first.store, author).cards.length, 0)
  const second = setup(); const submission = submit(second.store, second.unit.id)
  second.store.review(reviewer, second.unit.id, submission.id, 'accepted', '', '', second.store.unitSummary(reviewer, second.unit.id).unit.version, 'accept')
  assert.equal(summary(second.store, author).cards.length, 0); assert.equal(summary(second.store, reviewer).cards.length, 0)
})
test('이전 완료본이 있어도 보완판 철회 후 남은 보완은 제출 업무로 유지한다', () => {
  const { store, unit } = setup(); const first = submit(store, unit.id)
  store.review(reviewer, unit.id, first.id, 'accepted', '', '', store.unitSummary(reviewer, unit.id).unit.version, 'accept')
  const second = submit(store, unit.id, 'second')
  store.review(reviewer, unit.id, second.id, 'changes_requested', '합성 재확인', '2026-10-20', store.unitSummary(reviewer, unit.id).unit.version, 'request-fix')
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '합성 철회 사유', 'withdraw')
  store.setContext({ members, date: '2026-10-22' })
  const value = summary(store, author, '2026-10-22')
  assert.equal(value.counts.submit, 1); assert.equal(value.cards[0].effectiveRevision, 1)
  assert.equal(value.cards[0].dueDate, '2026-10-20'); assert.equal(value.cards[0].overdue, true)
  assert.equal(value.cards[0].hasPendingSupplement, true); assert.equal(value.cards[0].pendingSupplementCount, 1)
})
test('보완 재제출 후에는 검토 대기로, 그 판 철회 후에는 다시 보완으로 바뀐다', () => {
  const { store, unit } = setup(); const first = submit(store, unit.id)
  store.review(reviewer, unit.id, first.id, 'changes_requested', '합성 보완', '2026-10-21', store.unitSummary(reviewer, unit.id).unit.version, 'changes')
  submit(store, unit.id, 'second'); assert.equal(summary(store, author).cards[0].category, 'waiting')
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '합성 내용 확인', 'withdraw')
  assert.equal(summary(store, author).cards[0].category, 'submit')
})

test('두 보완 요청이 되살아난 철회에서는 홈과 상세 모두 가장 빠른 남은 기한을 안내한다', () => {
  const { store, request, unit } = setup(); const first = submit(store, unit.id)
  store.review(reviewer, unit.id, first.id, 'changes_requested', '첫 보완', '2026-10-21', store.unitSummary(reviewer, unit.id).unit.version, 'changes-first')
  const second = submit(store, unit.id, 'second')
  store.review(reviewer, unit.id, second.id, 'changes_requested', '두 번째 보완', '2026-10-23', store.unitSummary(reviewer, unit.id).unit.version, 'changes-second')
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '두 보완 내용 재확인', 'withdraw-second')
  assert.deepEqual(store.unitSummary(author, unit.id).pendingSupplements.map(value => value.dueDate), ['2026-10-21', '2026-10-23'])
  const home = summary(store, author), detail = renderDetail(store, author, request.id, unit.id)
  assert.equal(home.cards[0].dueDate, '2026-10-21'); assert.equal(home.cards[0].pendingSupplementCount, 2)
  assert(detail.includes('보완 제출 기한: 2026-10-21 · 가장 빠른 기한'))
  assert(detail.includes('남은 보완 요청 2건 · 기한이 빠른 순서'))
  assert(detail.includes('<li>2026-10-21까지</li><li>2026-10-23까지</li>'))
})
test('다른 학교·무관 구성원은 자료를 얻지 못하고 종료 소속은 명시 실패한다', () => {
  const { store } = setup({ units: [{ label: '단독 단위', responsibleMemberId: author, contributorMemberIds: [] }] })
  assert.equal(summary(store, 'nuri-soyeon').cards.length, 0); assert.equal(summary(store, collaborator).cards.length, 0)
  assert.throws(() => summary(store, 'gaon-ended'), error => error.code === 'INACTIVE_MEMBERSHIP')
})
test('목록이나 단위 조회 실패를 빈 업무로 삼지 않는다', () => {
  const { store } = setup()
  assert.throws(() => summary({ ...store, listCollections() { throw new Error('합성 조회 실패') } }, author), /합성 조회 실패/)
  assert.throws(() => summary({ ...store, unitSummary() { throw new Error('합성 단위 실패') } }, author), /합성 단위 실패/)
})
test('홈 DTO에는 초안·제출본문·숫자·스냅샷이 포함되지 않는다', () => {
  const { store, unit } = setup(); submit(store, unit.id)
  const reader = { listCollections: store.listCollections, listUnits: store.listUnits, unitSummary: store.unitSummary }
  const value = collectionHomeSummary(reader, member(reviewer), date)
  assert(!JSON.stringify(value).includes('복제하면 안 되는')); assert(!('number' in value.cards[0])); assert(!('text' in value.cards[0]))
})
test('실제 JSX는 대기를 직접 처리할 업무 수와 분리하고 기존 개인 할 일 옵션을 유지한다', () => {
  const { store, unit } = setup(); submit(store, unit.id)
  store.createTask(author, { title: '가상 개인 준비', notes: '', dueDate: date }, 'task')
  const html = renderHome(store, author)
  assert(html.includes('직접 처리할 0건 수합 · 검토 대기 1건')); assert(html.includes('제출 후 검토 대기'))
  assert(!html.includes('가상 개인 준비')); assert(renderHome(store, author, true).includes('가상 개인 준비'))
})
test('실제 JSX는 조회 실패와 정상 0건을 구별하며 다시 확인 행동을 제공한다', () => {
  const store = createWorkflowStore({ members, date })
  const empty = renderHome(store, author)
  assert(empty.includes('직접 처리할 0건 수합')); assert(empty.includes('지금 처리하거나 검토를 기다리는 수합이 없습니다'))
  const failed = renderHome({ ...store, listCollections() { throw new Error('합성 조회 실패') } }, author)
  assert(failed.includes('수합 현황 확인 안 됨')); assert(failed.includes('수합 현황 다시 확인')); assert(!failed.includes('직접 처리할 0건'))
})
test('원본 요청 안의 정확한 단위만 강조하고 초점 가능한 원본을 제공한다', () => {
  const { store, request } = setup({ units: [{ label: '첫 단위', responsibleMemberId: author, contributorMemberIds: [] }, { label: '둘째 단위', responsibleMemberId: author, contributorMemberIds: [] }] })
  const units = store.listUnits(author, request.id), html = renderDetail(store, author, request.id, units[1].id)
  assert.equal((html.match(/class="wf-unit wf-unit-target"/g) || []).length, 1)
  assert(html.includes(`class="wf-unit wf-unit-target" data-wf-unit-id="${units[1].id}"`)); assert(html.includes('선택한 제출 단위')); assert(html.includes('tabindex="-1"'))
})

test('직접 연 본인 비공개 초안은 내가 만든 수합 목록과 원본을 함께 표시한다', () => {
  const { store, request } = setup({ publish: false })
  const html = renderDetail(store, reviewer, request.id)
  assert(html.includes('<button aria-pressed="true">내가 만든 수합</button>'))
  assert(html.includes('<button aria-pressed="false">받은 수합</button>'))
  assert(html.includes('class="wf-request-card" aria-pressed="true"'))
  assert(html.includes('아직 게시하지 않음')); assert(!html.includes('현재 열람할 수 있는 수합이 없습니다'))
  const denied = renderDetail(store, author, request.id)
  assert(denied.includes('요청한 수합을 확인할 수 없습니다')); assert(!denied.includes('합성 행사 수량'))
})

test('게시한 요청의 관리만 맡으면 보낸 목록, 제출·검토에 참여하면 받은 목록을 선택한다', () => {
  const managed = setup({ mode: 'none' })
  const managerHtml = renderDetail(managed.store, reviewer, managed.request.id)
  assert(managerHtml.includes('<button aria-pressed="true">내가 만든 수합</button>'))
  assert(managerHtml.includes('class="wf-request-card" aria-pressed="true"'))
  const participantHtml = renderDetail(managed.store, author, managed.request.id)
  assert(participantHtml.includes('<button aria-pressed="true">받은 수합</button>'))
  const reviewed = setup()
  assert(renderDetail(reviewed.store, reviewer, reviewed.request.id).includes('<button aria-pressed="true">받은 수합</button>'))
})
test('없는 단위와 다른 요청의 단위를 임의의 첫 단위로 대체하지 않는다', () => {
  const { store, request } = setup()
  const html = renderDetail(store, author, request.id, '없는-단위')
  assert(html.includes('요청한 제출 단위를 현재 확인할 수 없습니다')); assert(!html.includes('wf-unit wf-unit-target'))
  const inaccessible = renderDetail(store, 'nuri-soyeon', request.id, '없는-단위')
  assert(inaccessible.includes('요청한 수합을 확인할 수 없습니다')); assert(!inaccessible.includes('합성 행사 수량'))
})
if (failed) process.exitCode = 1
