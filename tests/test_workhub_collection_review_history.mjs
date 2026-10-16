import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { fixtureData, createWorkflowStore, collectionReviewHistory, render } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { CollectionReviewHistory } from '../apps/workhub/src/workflows/CollectionReviewHistory.tsx'
  export { collectionReviewHistory } from '../apps/workhub/src/workflows/collection-review-history.ts'
  export { createWorkflowStore } from '../apps/workhub/src/workflows/store.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export function render(summary, submissions, members, date) { return renderToStaticMarkup(<CollectionReviewHistory summary={summary} submissions={submissions} members={members} date={date} />) }
`)
const members = fixtureData.memberships, date = fixtureData.basisDate
const author = 'gaon-soyeon', reviewer = 'gaon-minjun'
let failed = 0, passed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
function setup(mode = 'required', units = 1) {
  const store = createWorkflowStore({ members, date })
  const request = store.createCollection(reviewer, { title: '합성 검토 이력', instructions: '', dueDate: '2026-10-21', reviewMode: mode, reviewerMemberId: mode === 'required' ? reviewer : '', textLabel: '응답', textRequired: true, numberLabel: '', numberRequired: false, units: Array.from({ length: units }, (_, index) => ({ label: `합성 단위 ${index + 1}`, responsibleMemberId: author, contributorMemberIds: [] })) }, 'request')
  store.publishCollection(reviewer, request.id, request.version, 'publish')
  const unit = store.listUnits(author, request.id)[0]
  let serial = 0
  const summary = () => store.unitSummary(author, unit.id)
  const submissions = () => store.getSubmissions(author, unit.id)
  return { store, unit, request, summary, submissions,
    submit() { const version = store.getDraft(author, unit.id)?.version ?? 0; const draft = store.saveDraft(author, unit.id, { text: '검토 이력에 복제하지 않을 응답 본문', number: null }, version, `draft-${++serial}`); return store.submit(author, unit.id, draft.version, summary().unit.version, `submit-${++serial}`, version ? '합성 정정 사유' : '') },
    review(decision, note, due = '2026-10-21') { return store.review(reviewer, unit.id, summary().current.id, decision, note, decision === 'accepted' ? '' : due, summary().unit.version, `review-${++serial}`) },
    withdraw() { return store.withdraw(author, unit.id, summary().unit.version, '합성 철회 사유', `withdraw-${++serial}`) },
    view(at = date) { return collectionReviewHistory(summary(), submissions(), members, at) },
    html(at = date) { return render(summary(), submissions(), members, at) },
  }
}
const currentSection = html => html.split('aria-label="현재 제출판 검토 결과"')[1]?.split('</section>')[0] ?? ''

test('v1 보완 의견은 v2 검토 대기의 현재 의견으로 표시되지 않는다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', 'v1에만 해당하는 보완 의견'); flow.submit()
  const view = flow.view(), html = flow.html(), current = currentSection(html)
  assert.equal(view.currentRevision, 2); assert.equal(view.currentState, 'pending'); assert.equal(view.currentReview, null); assert.deepEqual(view.pending, [])
  assert(current.includes('현재 제출 v2 · 검토 대기')); assert(current.includes('이 제출판에는 아직 검토 의견이 없습니다.'))
  assert(!html.split('<details')[0].includes('v1에만 해당하는 보완 의견'))
  assert(html.includes('v1 · 보완 요청')); assert(html.includes('v1 보완에 v2 제출')); assert(html.includes('해당 제출판의 검토 결과는 별도입니다.'))
})
test('현재판 검토 완료는 해당 판의 의견·검토자·시점을 표시한다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '과거 보완'); flow.submit(); flow.review('accepted', '현재판 확인 완료')
  const current = currentSection(flow.html()), view = flow.view()
  assert.equal(view.currentReview.decision, 'accepted'); assert.equal(view.effectiveRevision, 2)
  assert(current.includes('현재 제출 v2 · 검토 완료')); assert(current.includes('현재판 확인 완료')); assert(current.includes('이민준')); assert(/<time datetime="/i.test(current))
  assert(!current.includes('과거 보완'))
})
test('이전 완료본을 유지하는 새 제출판은 검토 대기와 완료본을 구분한다', () => {
  const flow = setup(); flow.submit(); flow.review('accepted', 'v1 완료 의견'); flow.submit()
  const view = flow.view(), current = currentSection(flow.html())
  assert.equal(view.currentRevision, 2); assert.equal(view.effectiveRevision, 1); assert.equal(view.currentState, 'pending')
  assert(current.includes('완료본 v1은 별도로 유지됩니다.')); assert(!current.includes('v1 완료 의견'))
})
test('철회로 되살아난 여러 보완은 원래 판·사유·기한을 정확하게 묶는다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '첫 판의 보완 이유', '2026-10-20'); flow.submit(); flow.review('changes_requested', '둘째 판의 보완 이유', '2026-10-23'); flow.withdraw()
  const view = flow.view('2026-10-22'), html = flow.html('2026-10-22')
  assert.deepEqual(view.pending.map(value => [value.revision, value.review.note, value.dueDate, value.overdue]), [[1, '첫 판의 보완 이유', '2026-10-20', true], [2, '둘째 판의 보완 이유', '2026-10-23', false]])
  assert.equal(view.currentRevision, null); assert(!view.history.some(value => value.kind === 'supplement_fulfilled'))
  assert(html.includes('보완 제출 기한: 2026-10-20 · 가장 빠른 기한')); assert(html.includes('남은 보완 요청 2건 · 기한이 빠른 순서'))
  assert(html.includes('v2 · 제출 철회')); assert(html.includes('합성 철회 사유')); assert(html.includes('보완 기한 초과'))
})
test('현재 완료본으로 돌아왔어도 철회한 새 판의 보완 사유는 새 판에 연결한다', () => {
  const flow = setup(); flow.submit(); flow.review('accepted', '첫 완료본 의견'); flow.submit(); flow.review('changes_requested', '두 번째 판 보완'); flow.withdraw()
  const view = flow.view(), current = currentSection(flow.html())
  assert.equal(view.currentRevision, 1); assert.equal(view.effectiveRevision, 1); assert.equal(view.currentReview.note, '첫 완료본 의견')
  assert.equal(view.pending[0].revision, 2); assert.equal(view.pending[0].review.note, '두 번째 판 보완'); assert(!current.includes('두 번째 판 보완'))
})
test('검토 없는 제출은 검토 승인이나 검토 대기로 바꾸지 않는다', () => {
  const flow = setup('none'); flow.submit()
  assert.equal(flow.view().currentState, 'not_required'); assert.equal(flow.view().currentReview, null)
  assert(flow.html().includes('현재 제출 v1 · 검토 없이 응답 완료')); assert(!flow.html().includes('<details'))
})
test('같은 판번호·위조된 같은 제출 ID여도 다른 단위의 의견과 사유를 섞지 않는다', () => {
  const flow = setup('required', 2); const submission = flow.submit(); flow.review('changes_requested', '본 단위 보완')
  const raw = flow.summary(), foreignUnit = flow.store.listUnits(author, flow.request.id)[1]
  const fakeReview = { ...raw.reviews[0], id: 'other-review', unitId: foreignUnit.id, note: '다른 단위 비공개 의견' }
  const fakeSupplement = { ...raw.pendingSupplements[0], id: 'other-supplement', unitId: foreignUnit.id }
  const mixed = { ...raw, reviews: [fakeReview, ...raw.reviews], pendingSupplements: [fakeSupplement, ...raw.pendingSupplements], supplements: [fakeSupplement, ...raw.supplements], withdrawals: [{ id: 'other-withdrawal', unitId: foreignUnit.id, submissionId: submission.id, reason: '다른 단위 철회 이유', actorMemberId: author, recordedAt: submission.receiptAt }] }
  const versions = [...flow.submissions(), { ...submission, unitId: foreignUnit.id, revision: 99 }]
  const view = collectionReviewHistory(mixed, versions, members, date), html = render(mixed, versions, members, date)
  assert.equal(view.currentRevision, 1); assert.equal(view.pending.length, 1); assert.equal(view.currentReview.note, '본 단위 보완')
  assert(!html.includes('다른 단위')); assert(!html.includes('v99'))
})
test('원본 판을 읽지 못한 기록이나 다른 단위의 보완 응답 판을 임의로 표시하지 않는다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '첫 판'); flow.submit()
  const raw = flow.summary(), versions = flow.submissions()
  const withoutSource = collectionReviewHistory(raw, [versions[1]], members, date)
  assert.deepEqual(withoutSource.history, []); assert.equal(withoutSource.currentRevision, 2)
  const foreignTarget = { ...versions[1], unitId: 'another-unit' }
  const withoutTarget = collectionReviewHistory(raw, [versions[0], foreignTarget], members, date)
  assert(!withoutTarget.history.some(value => value.kind === 'supplement_fulfilled')); assert.equal(withoutTarget.currentRevision, null)
})
test('보완 사유가 없으면 다른 판의 의견을 가져오지 않고 확인 불가로 안내한다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '제거된 원래 의견')
  const raw = { ...flow.summary(), reviews: [] }, html = render(raw, flow.submissions(), members, date)
  assert(html.includes('이 제출판의 보완 사유를 확인할 수 없습니다.')); assert(!html.includes('제거된 원래 의견'))
})
test('다른 학교의 같은 소속 ID나 사라진 이름은 검토자 이름으로 쓰지 않는다', () => {
  const flow = setup(); flow.submit(); flow.review('accepted', '확인')
  const foreign = members.filter(value => value.id !== reviewer).concat({ ...members.find(value => value.id === reviewer), schoolId: 'another-school', name: '다른 학교 이름' })
  const html = render(flow.summary(), flow.submissions(), foreign, date)
  assert(html.includes('교사 이름 확인 불가')); assert(!html.includes('다른 학교 이름'))
})
test('검토·철회 본문은 줄바꿈을 보존하고 HTML을 문자로 출력한다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '<img src=x onerror=alert(1)>\n두 번째 줄 & 확인'); flow.withdraw()
  const html = flow.html()
  assert(html.includes('&lt;img src=x onerror=alert(1)&gt;\n두 번째 줄 &amp; 확인')); assert(!html.includes('<img src=x'))
  assert(html.includes('white-space:pre-wrap')); assert(html.includes('overflow-wrap:anywhere'))
})
test('이력은 기본 접힌 native details·summary와 키보드 초점 표시를 제공한다', () => {
  const flow = setup(); flow.submit(); flow.review('accepted', '검토 기록')
  const html = flow.html()
  assert(html.includes('<details class="wf-review-history"><summary>검토·보완·철회 이력 · 1건</summary>'))
  assert(!/<details[^>]*\bopen(?:=|\s|>)/.test(html)); assert(html.includes('summary:focus-visible'))
  assert(!html.includes('role="button"')); assert(!html.includes('tabindex="-1"'))
})
test('깨진 목록·없는 요약·다른 요청의 단위에도 내용을 추측하지 않고 렌더한다', () => {
  const flow = setup(); flow.submit(); const raw = flow.summary()
  assert.doesNotThrow(() => render({ ...raw, reviews: null, withdrawals: 'wrong', supplements: null, pendingSupplements: null }, flow.submissions(), null, date))
  assert.equal(render(null, [], members, date), '')
  assert.equal(render({ ...raw, request: { ...raw.request, id: 'other-request' } }, flow.submissions(), members, date), '')
  assert.equal(render(raw, null, members, date), '')
})
test('표시 계산은 전달된 원본을 바꾸거나 제출 본문·파일 정보를 복제하지 않는다', () => {
  const flow = setup(); flow.submit(); flow.review('changes_requested', '검토 의견'); flow.submit()
  const raw = flow.summary(), versions = flow.submissions(), before = JSON.stringify({ raw, versions, members })
  versions[0].files = [{ id: 'do-not-copy', name: '숨겨둘파일.pdf', extension: 'pdf', bytes: 12, sha256: '0'.repeat(64) }]
  const versionBefore = JSON.stringify(versions), view = collectionReviewHistory(raw, versions, members, date)
  assert.equal(JSON.stringify(versions), versionBefore); assert.equal(JSON.stringify({ raw, versions: flow.submissions(), members }), before)
  assert(!JSON.stringify(view).includes('복제하지 않을')); assert(!JSON.stringify(view).includes('숨겨둘파일')); assert(!JSON.stringify(view).includes('sha256'))
})
console.log(`\n수합 검토 이력: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
