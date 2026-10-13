import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, validateWorkflowSnapshot, fixtureData, renderWorkflow, renderHome } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { WorkflowPanel, HomeWorkSummary } from '../apps/workhub/src/workflows/WorkflowPanel.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { createWorkflowStore, validateWorkflowSnapshot } from '../apps/workhub/src/workflows/store.ts'
  export function renderWorkflow(store, page, memberId = 'gaon-soyeon', requestId) { return renderToStaticMarkup(<WorkflowPanel store={store} page={page} initialRequestId={requestId} member={fixtureData.memberships.find(m => m.id === memberId)} members={fixtureData.memberships} date={fixtureData.basisDate} />) }
  export function renderHome(store) { return renderToStaticMarkup(<HomeWorkSummary store={store} member={fixtureData.memberships[0]} members={fixtureData.memberships} date={fixtureData.basisDate} onOpenCollections={() => {}} />) }
`)
const members = fixtureData.memberships
const date = fixtureData.basisDate
const author = 'gaon-soyeon'
const manager = 'gaon-minjun'
const collaborator = 'gaon-seojin'
const make = (options = {}) => createWorkflowStore({ members, date, ...options })
const taskInput = { title: '가상 안내 내용 확인', notes: '개인 준비 메모', dueDate: '2026-10-20' }
const collectionInput = (mode = 'required') => ({ title: '가상 행사 준비 수량', instructions: '글과 숫자로 응답합니다.', dueDate: '2026-10-21', reviewMode: mode, reviewerMemberId: mode === 'required' ? manager : '', textLabel: '준비 내용', textRequired: true, numberLabel: '필요 수량', numberRequired: true, units: [{ label: '2학년', responsibleMemberId: author, contributorMemberIds: [collaborator] }] })
let failed = 0
function test(name, run) { try { run(); console.log(`  ✓ ${name}`) } catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) } }
const rejects = (run, code) => assert.throws(run, error => error.code === code)
function opened(mode = 'required', input = collectionInput(mode)) { const store = make(); const draft = store.createCollection(manager, input, 'create'); const request = store.publishCollection(manager, draft.id, 1, 'publish'); const unit = store.listUnits(author, request.id)[0]; return { store, request, unit } }
function submit(store, unitId, { text = '확인한 합성 응답', number = 0, reason = '', key = 'submission' } = {}) { const previous = store.getDraft(author, unitId); const draft = store.saveDraft(author, unitId, { text, number }, previous?.version ?? 0, `draft-${key}`); const unit = store.unitSummary(author, unitId).unit; return store.submit(author, unitId, draft.version, unit.version, key, reason) }

test('개인 할 일 생성·수정·완료·재개·취소와 마감순 정렬', () => {
  const store = make()
  const later = store.createTask(author, taskInput, 'later')
  const earlier = store.createTask(author, { ...taskInput, title: '먼저 할 일', dueDate: date }, 'earlier')
  assert.equal(store.listTasks(author)[0].id, earlier.id)
  const updated = store.updateTask(author, later.id, { ...taskInput, notes: '메모 보존' }, 1, 'edit')
  assert.equal(updated.version, 2)
  let task = store.setTaskStatus(author, later.id, 'done', 2, 'done')
  assert.equal(store.homeSummary(author).openTasks.length, 1)
  task = store.setTaskStatus(author, later.id, 'todo', task.version, 'reopen')
  assert.equal(task.notes, '메모 보존')
  task = store.setTaskStatus(author, later.id, 'cancelled', task.version, 'cancel')
  assert.equal(task.status, 'cancelled')
})
test('개인 할 일 본문과 건수는 작성자·학교 범위에만 보인다', () => {
  const store = make(); const task = store.createTask(author, taskInput, 'private')
  assert.deepEqual(store.listTasks(manager), [])
  assert.deepEqual(store.listTasks('nuri-soyeon'), [])
  rejects(() => store.updateTask(manager, task.id, taskInput, 1, 'attack'), 'NOT_FOUND')
})
test('할 일 동시 수정 충돌은 원본과 입력을 보존한다', () => {
  const store = make(); const task = store.createTask(author, taskInput, 'create')
  store.setTaskStatus(author, task.id, 'doing', 1, 'progress')
  const input = { ...taskInput, title: '유지할 입력' }
  rejects(() => store.updateTask(author, task.id, input, 1, 'stale'), 'VERSION_CONFLICT')
  assert.equal(input.title, '유지할 입력')
  assert.equal(store.listTasks(author)[0].title, taskInput.title)
})
test('같은 요청은 한 번만 저장하고 다른 본문은 거부한다', () => {
  const store = make(); const task = store.createTask(author, taskInput, 'same')
  assert.deepEqual(store.createTask(author, taskInput, 'same'), task)
  assert.equal(store.listTasks(author).length, 1)
  rejects(() => store.createTask(author, { ...taskInput, title: '다른 입력' }, 'same'), 'IDEMPOTENCY_CONFLICT')
})
test('영속 저장 callback 실패는 원본과 접수 결과를 모두 취소한다', () => {
  let fail = true; let saved
  const store = make({ onChange: value => { if (fail) throw new Error('공간 부족'); saved = value } })
  rejects(() => store.createTask(author, taskInput, 'retry'), 'STORAGE_FAILED')
  assert.equal(store.exportState().tasks.length, 0); assert.equal(store.exportState().receipts.length, 0)
  fail = false
  store.createTask(author, taskInput, 'retry')
  assert.equal(saved.tasks.length, 1)
})
test('손상된 입력을 일반 예외 대신 계약 오류로 거부한다', () => {
  const store = make()
  for (const input of [null, {}, { ...taskInput, title: null }, { ...taskInput, dueDate: '2026-02-30' }]) rejects(() => store.createTask(author, input, 'bad'), 'INVALID_INPUT')
  for (const input of [null, {}, { ...collectionInput(), units: '문자열' }, { ...collectionInput(), units: [null] }, { ...collectionInput(), units: [{ label: '학급', responsibleMemberId: author, contributorMemberIds: null }] }]) rejects(() => store.createCollection(manager, input, 'bad'), 'INVALID_INPUT')
  rejects(() => make({ members: null }), 'INVALID_INPUT')
})
test('작성 중 수합은 작성자만 보며 게시 시에만 제출 의무를 만든다', () => {
  const store = make(); const request = store.createCollection(manager, collectionInput(), 'new')
  assert.equal(store.listCollections(author).length, 0)
  assert.equal(store.exportState().units.length, 0)
  rejects(() => store.getCollection(author, request.id), 'NOT_FOUND')
  store.publishCollection(manager, request.id, 1, 'publish')
  assert.equal(store.listCollections(author).length, 1)
  assert.equal(store.listUnits(author, request.id).length, 1)
})
test('공동 3명은 한 제출 단위이며 게시 재시도로 의무를 늘리지 않는다', () => {
  const store = make(); const input = collectionInput('none'); input.units[0].contributorMemberIds = [collaborator, manager, author]
  const request = store.createCollection(manager, input, 'new')
  const published = store.publishCollection(manager, request.id, 1, 'publish')
  assert.deepEqual(store.publishCollection(manager, request.id, 1, 'publish'), published)
  const units = store.listUnits(author, request.id)
  assert.equal(units.length, 1); assert.equal(units[0].members.length, 3)
})
test('다른 학교 대상·종료 소속 대상·자기 검토 설정을 거부한다', () => {
  const store = make()
  rejects(() => store.createCollection(manager, { ...collectionInput(), units: [{ label: '외부', responsibleMemberId: 'nuri-soyeon', contributorMemberIds: [] }] }, 'foreign'), 'FORBIDDEN')
  rejects(() => store.createCollection(manager, { ...collectionInput(), units: [{ label: '종료', responsibleMemberId: 'gaon-ended', contributorMemberIds: [] }] }, 'ended'), 'INACTIVE_MEMBERSHIP')
  rejects(() => store.createCollection(manager, { ...collectionInput(), reviewerMemberId: author }, 'self'), 'FORBIDDEN')
})
test('게시 이후 문항·대상 변경은 거부하고 당시 구성원 snapshot을 보존한다', () => {
  const { store, request, unit } = opened()
  rejects(() => store.updateCollection(manager, request.id, collectionInput(), request.version, 'change'), 'INVALID_STATE')
  const changedMembers = structuredClone(members); changedMembers.find(value => value.id === author).name = '변경된 이름'
  store.setContext({ members: changedMembers, date })
  assert.equal(store.listUnits(author, request.id)[0].members.find(value => value.id === author).name, unit.members.find(value => value.id === author).name)
})
test('미제출 공동 초안은 구성원만 읽고 관리자·검토자는 자동 열람하지 못한다', () => {
  const { store, unit } = opened()
  store.saveDraft(author, unit.id, { text: '비공개 준비 초안', number: null }, 0, 'draft')
  assert.equal(store.getDraft(collaborator, unit.id).text, '비공개 준비 초안')
  rejects(() => store.getDraft(manager, unit.id), 'FORBIDDEN')
  assert.equal(store.unitSummary(manager, unit.id).reviewState, 'not_started')
  assert.deepEqual(store.getSubmissions(manager, unit.id), [])
})
test('공동 초안의 동시 편집과 책임자 아닌 최종 제출을 거부한다', () => {
  const { store, unit } = opened()
  store.saveDraft(author, unit.id, { text: '첫 초안', number: 1 }, 0, 'one')
  store.saveDraft(collaborator, unit.id, { text: '공동 수정', number: 2 }, 1, 'two')
  rejects(() => store.saveDraft(author, unit.id, { text: '낡은 초안', number: 3 }, 1, 'three'), 'VERSION_CONFLICT')
  rejects(() => store.submit(collaborator, unit.id, 2, 1, 'other-submit'), 'FORBIDDEN')
  assert.equal(store.getDraft(author, unit.id).text, '공동 수정')
})
test('필수 응답의 미입력과 숫자 0을 구별한다', () => {
  const { store, unit } = opened('none')
  store.saveDraft(author, unit.id, { text: '확인', number: null }, 0, 'empty')
  rejects(() => store.submit(author, unit.id, 1, 1, 'empty-submit'), 'INVALID_INPUT')
  const result = submit(store, unit.id, { number: 0 })
  assert.equal(result.number, 0)
  rejects(() => store.saveDraft(author, unit.id, { text: null, number: 1 }, 2, 'bad'), 'INVALID_INPUT')
  rejects(() => store.saveDraft(author, unit.id, { text: '확인', number: Infinity }, 2, 'infinity'), 'INVALID_INPUT')
})
test('검토 없는 수합은 제출 즉시 current/effective가 같고 승인 동작이 없다', () => {
  const { store, unit } = opened('none'); const submission = submit(store, unit.id)
  const summary = store.unitSummary(author, unit.id)
  assert.equal(summary.current.id, submission.id); assert.equal(summary.effective.id, submission.id)
  assert.equal(summary.reviewState, 'not_required')
  assert.equal(store.homeSummary(author).pendingObligations.length, 0)
  rejects(() => store.review(manager, unit.id, submission.id, 'accepted', '', '', summary.unit.version, 'approve-none'), 'FORBIDDEN')
})
test('검토 있음은 제출 접수와 완료본 확정을 구분한다', () => {
  const { store, unit } = opened(); const submission = submit(store, unit.id)
  let summary = store.unitSummary(author, unit.id)
  assert.equal(summary.reviewState, 'pending'); assert.equal(summary.effective, null)
  store.review(manager, unit.id, submission.id, 'accepted', '확인했습니다.', '', summary.unit.version, 'review')
  summary = store.unitSummary(author, unit.id)
  assert.equal(summary.effective.id, submission.id); assert.equal(summary.reviewState, 'accepted')
})
test('숫자 집계는 완료본만 사용하고 대기 중인 정정판으로 바뀌지 않는다', () => {
  const { store, unit, request } = opened(); const v1 = submit(store, unit.id, { number: 2 })
  assert.equal(store.collectionSummary(manager, request.id).numericTotal, 0)
  store.review(manager, unit.id, v1.id, 'accepted', '', '', 2, 'approve-v1')
  submit(store, unit.id, { key: 'v2', reason: '수량 정정', number: 9 })
  assert.equal(store.collectionSummary(manager, request.id).numericTotal, 2)
  assert.equal(store.collectionSummary(manager, request.id).completedUnits, 1)
})
test('완료 v1 뒤 v2 제출은 완료본 v1을 유지하고 v2 승인 때만 바뀐다', () => {
  const { store, unit } = opened(); const v1 = submit(store, unit.id)
  store.review(manager, unit.id, v1.id, 'accepted', '', '', 2, 'approve-v1')
  const v2 = submit(store, unit.id, { key: 'v2', text: '수정 응답', number: 2, reason: '수량 변경' })
  let summary = store.unitSummary(author, unit.id)
  assert.equal(summary.current.id, v2.id); assert.equal(summary.effective.id, v1.id)
  assert.equal(store.homeSummary(author).pendingObligations.length, 1)
  store.review(manager, unit.id, v2.id, 'accepted', '', '', summary.unit.version, 'approve-v2')
  summary = store.unitSummary(author, unit.id)
  assert.equal(summary.effective.id, v2.id)
  assert.equal(store.getSubmissions(author, unit.id)[0].text, v1.text)
})
test('보완 요청·늦은 보완·재제출은 현재 초과와 최초 지연을 따로 계산한다', () => {
  const { store, unit } = opened(); const v1 = submit(store, unit.id)
  store.review(manager, unit.id, v1.id, 'changes_requested', '수량 확인', '2026-10-20', 2, 'changes')
  store.setContext({ members, date: '2026-10-21' })
  assert.equal(store.unitSummary(author, unit.id).supplementOverdue, true)
  const v2 = submit(store, unit.id, { key: 'fixed', reason: '수량 확인 후 보완' })
  const summary = store.unitSummary(author, unit.id)
  assert.equal(summary.initiallyLate, false); assert.equal(summary.supplementOverdue, false)
  assert.equal(summary.supplements[0].fulfilledSubmissionId, v2.id)
  assert(summary.supplements[0].fulfilledAt)
})
test('최초 지연과 현재 미제출 연체는 다른 축이며 정정해도 최초 판정을 바꾸지 않는다', () => {
  const { store, unit } = opened('none')
  store.setContext({ members, date: '2026-10-22' })
  assert.equal(store.unitSummary(author, unit.id).currentlyOverdue, true)
  submit(store, unit.id)
  let summary = store.unitSummary(author, unit.id)
  assert.equal(summary.initiallyLate, true); assert.equal(summary.currentlyOverdue, false)
  rejects(() => submit(store, unit.id, { key: 'v2-blocked', reason: '정정' }), 'INVALID_STATE')
  summary = store.unitSummary(manager, unit.id)
  store.openCorrection(manager, unit.id, '2026-10-24', '수량 정정 허용', summary.unit.version, 'window')
  submit(store, unit.id, { key: 'v2', reason: '수량 정정' })
  assert.equal(store.unitSummary(author, unit.id).initiallyLate, true)
})
test('검토 없는 완료본 철회는 과거판을 부활시키지 않고 철회 사유를 보존한다', () => {
  const { store, unit } = opened('none')
  submit(store, unit.id); submit(store, unit.id, { key: 'v2', reason: '정정' })
  const summary = store.unitSummary(author, unit.id)
  store.withdraw(author, unit.id, summary.unit.version, '다시 확인', 'withdraw')
  const withdrawn = store.unitSummary(author, unit.id)
  assert.equal(withdrawn.current, null); assert.equal(withdrawn.effective, null)
  assert.equal(withdrawn.withdrawals[0].reason, '다시 확인')
  assert.equal(store.getSubmissions(author, unit.id).length, 2)
})
test('검토 완료 v1 뒤 대기 v2 철회는 current/effective 모두 v1로 돌아간다', () => {
  const { store, unit } = opened(); const v1 = submit(store, unit.id)
  store.review(manager, unit.id, v1.id, 'accepted', '', '', 2, 'approve')
  submit(store, unit.id, { key: 'v2', reason: '정정' })
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '정정 취소', 'withdraw')
  const summary = store.unitSummary(author, unit.id)
  assert.equal(summary.current.id, v1.id); assert.equal(summary.effective.id, v1.id)
  rejects(() => store.withdraw(author, unit.id, summary.unit.version, '완료본 철회', 'approved-withdraw'), 'INVALID_STATE')
})
test('보완 제출 철회는 유효 보완 완료를 해제하여 초과 상태를 다시 계산한다', () => {
  const { store, unit } = opened(); const v1 = submit(store, unit.id)
  store.review(manager, unit.id, v1.id, 'changes_requested', '확인 요청', '2026-10-20', 2, 'changes')
  submit(store, unit.id, { key: 'v2', reason: '보완 제출' })
  const before = store.unitSummary(author, unit.id)
  store.withdraw(author, unit.id, before.unit.version, '보완 내용 재확인', 'withdraw')
  store.setContext({ members, date: '2026-10-21' })
  assert.equal(store.unitSummary(author, unit.id).supplementOverdue, true)
})
test('완료본 뒤 보완 요청판 철회는 완료본과 별개로 홈 보완 의무를 유지한다', () => {
  const { store, unit, request } = opened(); const v1 = submit(store, unit.id, { number: 3 })
  store.review(manager, unit.id, v1.id, 'accepted', '', '', 2, 'approve')
  const v2 = submit(store, unit.id, { key: 'v2', reason: '수량 정정', number: 9 })
  store.review(manager, unit.id, v2.id, 'changes_requested', '수량을 확인해 주세요', '2026-10-20', store.unitSummary(manager, unit.id).unit.version, 'changes')
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '정정판 다시 확인', 'withdraw')
  let summary = store.unitSummary(author, unit.id)
  assert.equal(summary.current.id, v1.id); assert.equal(summary.effective.id, v1.id)
  assert.equal(summary.pendingSupplements.length, 1); assert.equal(summary.supplementOverdue, false)
  assert.equal(store.homeSummary(author).pendingObligations.length, 1)
  assert.equal(store.collectionSummary(manager, request.id).numericTotal, 3)
  store.setContext({ members, date: '2026-10-21' })
  summary = store.unitSummary(author, unit.id)
  assert.equal(summary.supplementOverdue, true)
  const html = renderHome(store)
  assert(html.includes('처리할 1건')); assert(html.includes('보완 제출 필요'))
  assert(html.includes('완료본 v1')); assert(html.includes('남은 보완 1건 · 2026-10-20까지'))
  assert(html.includes('보완 기한 초과'))
})
test('완료본 뒤 보완 재제출 대기판 철회는 홈 의무를 다시 열고 재완료 때 닫는다', () => {
  const { store, unit } = opened(); const v1 = submit(store, unit.id)
  store.review(manager, unit.id, v1.id, 'accepted', '', '', 2, 'approve')
  const v2 = submit(store, unit.id, { key: 'v2', reason: '정정' })
  store.review(manager, unit.id, v2.id, 'changes_requested', '내용 확인', '2026-10-20', store.unitSummary(manager, unit.id).unit.version, 'changes')
  const v3 = submit(store, unit.id, { key: 'v3', reason: '보완 재제출' })
  assert.equal(store.unitSummary(author, unit.id).pendingSupplements.length, 0)
  assert.equal(store.homeSummary(author).pendingObligations.length, 1)
  store.withdraw(author, unit.id, store.unitSummary(author, unit.id).unit.version, '재제출 내용 재확인', 'withdraw')
  const restored = make({ snapshot: store.exportState() })
  const summary = restored.unitSummary(author, unit.id)
  assert(summary.unit.withdrawnSubmissionIds.includes(v3.id))
  assert.equal(summary.current.id, v1.id); assert.equal(summary.effective.id, v1.id)
  assert.equal(summary.pendingSupplements.length, 1)
  assert.equal(summary.pendingSupplements[0].fulfilledSubmissionId, null)
  assert.equal(summary.pendingSupplements[0].fulfilledAt, null)
  assert.equal(restored.homeSummary(author).pendingObligations.length, 1)
  assert(renderHome(restored).includes('보완 제출 필요'))
  const v4 = submit(restored, unit.id, { key: 'v4', reason: '보완 재확인 완료' })
  restored.review(manager, unit.id, v4.id, 'accepted', '', '', restored.unitSummary(manager, unit.id).unit.version, 'approve-v4')
  assert.equal(restored.unitSummary(author, unit.id).pendingSupplements.length, 0)
  assert.equal(restored.homeSummary(author).pendingObligations.length, 0)
  assert(!renderHome(restored).includes('보완 제출 필요'))
})
test('수합 제출의 중복 재시도는 같은 접수증이며 한 판만 만든다', () => {
  const { store, unit } = opened('none')
  const draft = store.saveDraft(author, unit.id, { text: '확인', number: 0 }, 0, 'draft')
  const first = store.submit(author, unit.id, draft.version, 1, 'submit')
  assert.deepEqual(store.submit(author, unit.id, draft.version, 1, 'submit'), first)
  assert.equal(store.getSubmissions(author, unit.id).length, 1)
})
test('소속 종료 이후 조회·변경·성공 응답 재시도를 모두 거부한다', () => {
  const store = make(); store.createTask(author, taskInput, 'same')
  const ended = structuredClone(members); ended.find(value => value.id === author).active = false
  store.setContext({ members: ended, date })
  rejects(() => store.listTasks(author), 'INACTIVE_MEMBERSHIP')
  rejects(() => store.createTask(author, taskInput, 'same'), 'INACTIVE_MEMBERSHIP')
})
test('공동 초안과 제출판은 다른 학교 소속으로 직접 조회할 수 없다', () => {
  const { store, unit } = opened(); submit(store, unit.id)
  rejects(() => store.getDraft('nuri-soyeon', unit.id), 'NOT_FOUND')
  rejects(() => store.getSubmissions('nuri-soyeon', unit.id), 'NOT_FOUND')
})
test('snapshot으로 원본·불변 판·요청 접수 결과를 함께 복원한다', () => {
  const { store, unit } = opened(); const submitted = submit(store, unit.id)
  store.review(manager, unit.id, submitted.id, 'accepted', '', '', 2, 'review')
  store.createTask(author, taskInput, 'task')
  const snapshot = store.exportState()
  const restored = make({ snapshot })
  assert.deepEqual(restored.exportState(), snapshot)
  assert.equal(restored.unitSummary(author, unit.id).effective.id, submitted.id)
  const task = restored.createTask(author, taskInput, 'task')
  assert.equal(restored.listTasks(author).length, 1); assert(task.id)
  snapshot.tasks[0].title = '외부 변조'
  assert.equal(restored.listTasks(author)[0].title, taskInput.title)
})
test('손상 snapshot은 자동 초기화하지 않고 명시적으로 실패한다', () => {
  for (const snapshot of [null, {}, { ...make().exportState(), tasks: 'bad' }, { ...make().exportState(), requests: [null] }]) rejects(() => validateWorkflowSnapshot(snapshot), 'INVALID_INPUT')
  const { store, unit } = opened(); submit(store, unit.id)
  const broken = store.exportState(); broken.units[0].effectiveSubmissionId = broken.submissions[0].id
  rejects(() => make({ snapshot: broken }), 'INVALID_INPUT')
})
test('초기화 저장 실패는 기존 업무를 유지하고 성공 때만 비운다', () => {
  let fail = false
  const store = make({ onChange: () => { if (fail) throw new Error('저장 실패') } })
  store.createTask(author, taskInput, 'task'); fail = true
  rejects(() => store.reset(), 'STORAGE_FAILED'); assert.equal(store.listTasks(author).length, 1)
  fail = false; store.reset(); assert.equal(store.listTasks(author).length, 0)
})
test('실제 홈 JSX에 개인 체크와 수합 원본 행동을 구분하여 표시한다', () => {
  const { store } = opened('none'); store.createTask(author, taskInput, 'task')
  const html = renderHome(store)
  assert(html.includes('해야 할 일')); assert(html.includes('수합 원본 보기')); assert(html.includes('수합은 원본 화면에서 제출하거나 검토합니다'))
  assert(html.includes('가상 안내 내용 확인'))
})
test('실제 수합 화면 JSX는 지원 범위와 받은/보낸 업무를 안내한다', () => {
  const html = renderWorkflow(make(), 'collections')
  assert(html.includes('받은 수합')); assert(html.includes('내가 만든 수합')); assert(html.includes('글·숫자 응답만 지원'))
  assert(!html.includes('type="file"'))
})
test('홈 원본 링크의 수합 ID로 직접 열고 명시적 검토 입력 이름을 제공한다', () => {
  const { store, unit, request } = opened(); submit(store, unit.id)
  const html = renderWorkflow(store, 'collections', manager, request.id)
  assert(html.includes('aria-label="검토 의견"'))
  assert(html.includes('현재 제출 내용 · v1'))
  assert(html.includes('완료본 중 숫자 응답'))
  assert(renderWorkflow(store, 'tasks').includes('aria-label="나만 보는 메모"'))
})
test('종료 소속의 실제 JSX는 빈 목록 대신 계약 거부를 안내한다', () => {
  const html = renderWorkflow(make(), 'tasks', 'gaon-ended')
  assert(html.includes('활성 소속이 필요합니다'))
  assert(!html.includes('첫 할 일을 추가'))
})

if (failed) process.exitCode = 1
