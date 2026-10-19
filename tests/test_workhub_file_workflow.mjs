import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createWorkflowStore, validateWorkflowSnapshot, persistentWorkflowSnapshot, createPreviewFileRepository, collectionEntryGuide, responseEntryGuide, fixtureData } = await loadBrowserModule(`
  export {createWorkflowStore,validateWorkflowSnapshot} from '../apps/workhub/src/workflows/store.ts'
  export {persistentWorkflowSnapshot} from '../apps/workhub/src/workflows/file-persistence.ts'
  export {createPreviewFileRepository} from '../apps/workhub/src/files/preview-repository.ts'
  export {collectionEntryGuide,responseEntryGuide} from '../apps/workhub/src/workflows/entry-guide.ts'
  export {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
`)
const members = fixtureData.memberships, date = fixtureData.basisDate, schoolId = 'fixture-school-gaon'
const manager = 'gaon-minjun', author = 'gaon-soyeon', collaborator = 'gaon-seojin'
const policy = { extensions: ['pdf'], maxFileBytes: 2048, maxFiles: 3 }
const body = name => `%PDF-1.4\n합성 문서 ${name}\n%%EOF`
const file = name => new File([body(name)], name, { type: 'application/pdf' })
const stage = (files, name = '합성 제출.pdf', memberId = author, school = schoolId) => files.stage(file(name), policy, { schoolId: school, memberId })
const input = (overrides = {}) => ({ title: '합성 파일 수합', instructions: '합성 문서만 사용합니다.', dueDate: '2026-10-21', reviewMode: 'required', reviewerMemberId: manager, textLabel: '', textRequired: false, numberLabel: '', numberRequired: false, units: [{ label: '2학년', responsibleMemberId: author, contributorMemberIds: [collaborator] }], fileCollection: { policy: structuredClone(policy), required: true, templates: [] }, ...overrides })
function make(options = {}) { const files = options.files ?? createPreviewFileRepository(); return { files, store: createWorkflowStore({ members, date, ...options, files }) } }
function opened(options = {}, requestInput = input()) { const value = make(options); const draft = value.store.createCollection(manager, requestInput, 'create'); const request = value.store.publishCollection(manager, draft.id, 1, 'publish'); return { ...value, request, unit: value.store.listUnits(author, request.id)[0] } }
function save(store, unitId, refs = [], editor = author, key = crypto.randomUUID()) { return store.saveDraft(editor, unitId, { text: '', number: null, files: refs }, store.getDraft(editor, unitId)?.version ?? 0, key) }
function submit(store, unitId, key = crypto.randomUUID(), reason = '') { return store.submit(author, unitId, store.getDraft(author, unitId).version, store.unitSummary(author, unitId).unit.version, key, reason) }
const rejects = (run, code) => assert.throws(run, error => error.code === code)
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) } }

await test('기존 글·숫자 수합은 파일 보관소 없이 같은 제출 계약을 유지한다', () => {
  const store = createWorkflowStore({ members, date }), value = input({ textLabel: '글', textRequired: true, numberLabel: '수량', numberRequired: true }); delete value.fileCollection
  const request = store.createCollection(manager, value, 'create'); store.publishCollection(manager, request.id, 1, 'publish')
  const unit = store.listUnits(author, request.id)[0], draft = store.saveDraft(author, unit.id, { text: '합성 응답', number: 0 }, 0, 'draft')
  const result = store.submit(author, unit.id, draft.version, 1, 'submit')
  assert.equal(result.number, 0); assert.equal(Object.hasOwn(result, 'files'), false)
  assert.deepEqual(persistentWorkflowSnapshot(store.exportState()), store.exportState())
})

await test('파일만 받는 수합은 허용하되 파일 보관소 없는 생성은 명확히 거부한다', () => {
  rejects(() => createWorkflowStore({ members, date }).createCollection(manager, input(), 'create'), 'INVALID_STATE')
  const { store } = make(); assert(store.createCollection(manager, input(), 'create').fileCollection)
  rejects(() => createWorkflowStore({ members, date, snapshot: store.exportState() }), 'INVALID_STATE')
})

await test('양식의 실제 바이트를 게시된 수합 참여자에게만 내려준다', async () => {
  const { store, files } = make(), template = await stage(files, '합성 양식.pdf', manager)
  const request = store.createCollection(manager, input({ fileCollection: { policy, required: true, templates: [template] } }), 'create')
  await assert.rejects(store.getTemplateFile(author, request.id, template.id), error => error.code === 'NOT_FOUND')
  store.publishCollection(manager, request.id, 1, 'publish')
  assert.equal(await (await store.getTemplateFile(author, request.id, template.id)).text(), body(template.name))
  await assert.rejects(store.getTemplateFile('nuri-soyeon', request.id, template.id), error => error.code === 'NOT_FOUND')
})

await test('위조·타학교·다른 소유자의 양식은 생성·수정에서 원자적으로 거부한다', async () => {
  const { store, files } = make(), own = await stage(files, '담당자 양식.pdf', manager), other = await stage(files, '작성자 양식.pdf'), foreign = await stage(files, '외부 양식.pdf', 'nuri-soyeon', 'fixture-school-nuri')
  const request = store.createCollection(manager, input(), 'create')
  for (const ref of [{ ...own, sha256: '0'.repeat(64) }, other, foreign]) {
    const value = input({ fileCollection: { policy, required: true, templates: [ref] } }), before = store.exportState()
    assert.throws(() => store.createCollection(manager, value, crypto.randomUUID()))
    assert.throws(() => store.updateCollection(manager, request.id, value, 1, crypto.randomUUID()))
    assert.deepEqual(store.exportState(), before)
  }
})

await test('양식 파일이 사라지면 게시하지 않고 요청·대상·접수 결과를 보존한다', async () => {
  const { store, files } = make(), template = await stage(files, '양식.pdf', manager)
  const request = store.createCollection(manager, input({ fileCollection: { policy, required: true, templates: [template] } }), 'create'), before = store.exportState()
  files.reset(); rejects(() => store.publishCollection(manager, request.id, 1, 'publish'), 'FILE_UNAVAILABLE')
  assert.deepEqual(store.exportState(), before)
})

await test('잘못된 파일 설정은 생성과 snapshot 복원에서 거부한다', () => {
  const { store } = make()
  for (const value of [null, {}, { policy, required: 'true', templates: [] }, { policy: { ...policy, maxFiles: 0 }, required: true, templates: [] }, { policy, required: true, templates: null }]) rejects(() => store.createCollection(manager, input({ fileCollection: value }), crypto.randomUUID()), 'INVALID_INPUT')
  store.createCollection(manager, input(), 'valid'); const snapshot = store.exportState(); snapshot.requests[0].fileCollection.templates = [{ id: 'fake' }]
  rejects(() => validateWorkflowSnapshot(snapshot), 'INVALID_INPUT')
})

await test('빈 파일 초안은 저장되지만 필수 파일 없는 제출은 상태를 바꾸지 않는다', () => {
  const { store, unit } = opened(); const draft = save(store, unit.id)
  assert.deepEqual(draft.files, []); const before = store.exportState()
  rejects(() => submit(store, unit.id), 'INVALID_INPUT'); assert.deepEqual(store.exportState(), before)
})

await test('공동 작성자가 올린 파일을 책임자가 제출하고 관리자는 제출 후에만 읽는다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files, '공동 응답.pdf', collaborator)
  save(store, unit.id, [ref], collaborator)
  assert.equal(await (await store.getDraftFile(author, unit.id, ref.id)).text(), body(ref.name))
  await assert.rejects(store.getDraftFile(manager, unit.id, ref.id), error => error.code === 'FORBIDDEN')
  rejects(() => store.submit(collaborator, unit.id, 1, 1, 'wrong-submitter'), 'FORBIDDEN')
  const submission = submit(store, unit.id)
  assert.equal(await (await store.getSubmissionFile(manager, unit.id, submission.id, ref.id)).text(), body(ref.name))
})

await test('파일 미설정 수합·다른 단위 소유자·중복·위조 첨부를 저장하지 않는다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files), foreignOwner = await stage(files, '담당자만 가진 파일.pdf', manager)
  for (const refs of [[foreignOwner], [ref, ref], [{ ...ref, bytes: ref.bytes + 1 }], [{ ...ref, extra: '임의 메타데이터' }], null]) {
    assert.throws(() => save(store, unit.id, refs)); assert.equal(store.getDraft(author, unit.id), null)
  }
  const textInput = input({ textLabel: '글' }); delete textInput.fileCollection
  const request = store.createCollection(manager, textInput, 'text'); store.publishCollection(manager, request.id, 1, 'text-publish')
  const textUnit = store.listUnits(author, request.id)[0]
  rejects(() => save(store, textUnit.id, [ref]), 'INVALID_INPUT')
})

await test('선택 파일은 비어 있어도 제출할 수 있고 요청별 파일 수 상한은 유지된다', async () => {
  const { store, files, unit } = opened({}, input({ fileCollection: { policy: { ...policy, maxFiles: 1 }, required: false, templates: [] } }))
  save(store, unit.id); assert.deepEqual(submit(store, unit.id).files, [])
  const one = await stage(files, '하나.pdf'), two = await stage(files, '둘.pdf')
  rejects(() => save(store, unit.id, [one, two]), 'INVALID_INPUT')
})

await test('초안 뒤 실물이 사라진 파일은 제출하지 않고 기존 초안을 남긴다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files); save(store, unit.id, [ref]); const before = store.exportState()
  files.reset(); rejects(() => submit(store, unit.id), 'FILE_UNAVAILABLE'); assert.deepEqual(store.exportState(), before)
})

await test('입력·반환값·snapshot 변경이 제출판의 파일 이름·지문·정책을 바꾸지 못한다', async () => {
  const { store, files, unit, request } = opened(), ref = await stage(files), savedName = ref.name
  const draft = save(store, unit.id, [ref]); ref.name = '외부 수정.pdf'; draft.files[0].sha256 = '0'.repeat(64)
  const submission = submit(store, unit.id), snapshot = store.exportState(); submission.files[0].name = '반환 수정.pdf'; snapshot.submissions[0].files.length = 0
  request.fileCollection.policy.extensions.push('exe')
  assert.equal(store.getSubmissions(author, unit.id)[0].files[0].name, savedName)
  assert.deepEqual(store.getCollection(author, request.id).fileCollection.policy.extensions, ['pdf'])
  assert.notEqual(store.getDraft(author, unit.id).files[0].sha256, '0'.repeat(64))
})

await test('같은 파일 제출 요청은 한 판만 만들고 다른 입력 재사용과 오래된 초안은 거부한다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files), draft = save(store, unit.id, [ref]), submission = submit(store, unit.id, 'same')
  assert.deepEqual(store.submit(author, unit.id, draft.version, 1, 'same'), submission)
  rejects(() => store.submit(author, unit.id, draft.version, 1, 'same', '다른 이유'), 'IDEMPOTENCY_CONFLICT')
  rejects(() => store.saveDraft(author, unit.id, { text: '', number: null, files: [] }, 0, 'stale'), 'VERSION_CONFLICT')
  assert.equal(store.getSubmissions(author, unit.id).length, 1); assert.equal(store.getDraft(author, unit.id).files.length, 1)
})

await test('검토·보완·철회가 새 파일판과 이전 완료본을 구분하고 과거 파일을 유지한다', async () => {
  const { store, files, unit } = opened(), first = await stage(files, '첫 제출.pdf'); save(store, unit.id, [first]); const firstSubmission = submit(store, unit.id)
  store.review(manager, unit.id, firstSubmission.id, 'accepted', '', '', 2, 'accept')
  const second = await stage(files, '정정 제출.pdf'); save(store, unit.id, [second]); const secondSubmission = submit(store, unit.id, 'second', '내용 정정')
  assert.equal(store.unitSummary(author, unit.id).effective.id, firstSubmission.id)
  store.review(manager, unit.id, secondSubmission.id, 'changes_requested', '내용 확인', '2026-10-22', 4, 'changes')
  store.withdraw(author, unit.id, 5, '다시 확인', 'withdraw')
  assert.equal(store.unitSummary(author, unit.id).current.id, firstSubmission.id)
  assert.equal(await (await store.getSubmissionFile(manager, unit.id, firstSubmission.id, first.id)).text(), body(first.name))
  assert.equal(await (await store.getSubmissionFile(manager, unit.id, secondSubmission.id, second.id)).text(), body(second.name))
  assert.equal(store.unitSummary(author, unit.id).pendingSupplements.length, 1)
})

await test('다운로드는 원본에 없는 파일·다른 제출판·타학교·종료 소속을 거부한다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files); save(store, unit.id, [ref]); const submission = submit(store, unit.id)
  for (const [member, submissionId, fileId, code] of [[manager, 'wrong-submission', ref.id, 'NOT_FOUND'], [manager, submission.id, 'wrong-file', 'NOT_FOUND'], ['nuri-soyeon', submission.id, ref.id, 'NOT_FOUND'], ['gaon-ended', submission.id, ref.id, 'INACTIVE_MEMBERSHIP']]) await assert.rejects(store.getSubmissionFile(member, unit.id, submissionId, fileId), error => error.code === code)
})

await test('비동기 파일 읽기 중 소속 회수나 초기화가 발생하면 늦은 바이트를 반환하지 않는다', async () => {
  for (const change of ['membership', 'reset']) {
    const original = createPreviewFileRepository(); let release
    const files = { ...original, read: async (...args) => { const blob = await original.read(...args); return new Promise(resolve => { release = () => resolve(blob) }) } }
    const { store, unit } = opened({ files }), ref = await stage(files); save(store, unit.id, [ref]); const submission = submit(store, unit.id)
    const promise = store.getSubmissionFile(author, unit.id, submission.id, ref.id)
    for (let turn = 0; !release && turn < 50; turn++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(typeof release, 'function', '합성 원본 읽기가 시작되어야 한다')
    if (change === 'reset') store.reset()
    else { const changed = structuredClone(members); changed.find(member => member.id === author).active = false; store.setContext({ members: changed, date }) }
    release(); await assert.rejects(promise, error => ['INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(error.code))
  }
})

await test('파일 수합의 모든 관계와 접수 이력은 영구 저장에서 빠지고 글·숫자·업무는 남는다', async () => {
  const { store, files, unit } = opened(), ref = await stage(files, '영구 저장 금지.pdf'); save(store, unit.id, [ref]); const submission = submit(store, unit.id)
  store.review(manager, unit.id, submission.id, 'changes_requested', '합성 보완', '2026-10-22', 2, 'review'); store.withdraw(author, unit.id, 3, '합성 철회', 'withdraw')
  const textInput = input({ title: '기존 글 수합', textLabel: '글' }); delete textInput.fileCollection
  const textRequest = store.createCollection(manager, textInput, 'text'); store.publishCollection(manager, textRequest.id, 1, 'text-publish')
  const textUnit = store.listUnits(author, textRequest.id)[0]; store.saveDraft(author, textUnit.id, { text: '기존 응답', number: null }, 0, 'text-draft')
  store.createTask(author, { title: '기존 할 일', notes: '메모 유지', dueDate: '' }, 'task')
  const before = store.exportState(), persistent = persistentWorkflowSnapshot(before), serialized = JSON.stringify(persistent)
  assert.equal(serialized.includes(ref.name), false); assert.equal(serialized.includes(ref.id), false); assert.equal(serialized.includes(ref.sha256), false)
  assert.deepEqual(persistent.requests.map(value => value.id), [textRequest.id]); assert.deepEqual(persistent.units.map(value => value.id), [textUnit.id]); assert.equal(persistent.drafts[0].text, '기존 응답'); assert.equal(persistent.tasks[0].notes, '메모 유지')
  for (const key of ['submissions', 'reviews', 'supplements', 'withdrawals']) assert.deepEqual(persistent[key], [])
  validateWorkflowSnapshot(persistent); assert.deepEqual(store.exportState(), before)
  persistent.drafts[0].text = '외부 변경'; assert.equal(store.getDraft(author, textUnit.id).text, '기존 응답')
})

await test('파일 수합을 글 수합으로 바꿔도 이전 접수 결과의 양식 이름을 영구 저장하지 않는다', async () => {
  const { store, files } = make(), template = await stage(files, '과거 양식.pdf', manager)
  const request = store.createCollection(manager, input({ fileCollection: { policy, required: true, templates: [template] } }), 'create'), textInput = input({ textLabel: '글' }); delete textInput.fileCollection
  store.updateCollection(manager, request.id, textInput, 1, 'update')
  assert.equal(store.getCollection(manager, request.id).fileCollection, undefined)
  const persistent = persistentWorkflowSnapshot(store.exportState()); assert.equal(persistent.requests.length, 0); assert.equal(persistent.receipts.length, 0)
})

await test('파일 수합 저장 callback 실패는 제출판·버전·멱등 접수를 모두 되돌린다', async () => {
  let failing = false; const { store, files, unit } = opened({ onChange: () => { if (failing) throw new Error('합성 저장 실패') } }), ref = await stage(files)
  save(store, unit.id, [ref]); const before = store.exportState(); failing = true
  rejects(() => submit(store, unit.id, 'retry'), 'STORAGE_FAILED'); assert.deepEqual(store.exportState(), before)
  failing = false; assert(submit(store, unit.id, 'retry').id); assert.equal(store.getSubmissions(author, unit.id).length, 1)
})

await test('파일 입력 안내는 필수 첨부·선택 첨부·손상 정책을 구분하며 기존 라벨을 유지한다', async () => {
  const value = input(), guide = collectionEntryGuide(value, members, schoolId, date), files = createPreviewFileRepository(), ref = await stage(files)
  assert.equal(guide.issues.length, 0); assert.equal(guide.requiredQuestionCount, 1); assert(guide.checks.find(check => check.label === '응답 문항').ready)
  assert.equal(responseEntryGuide(value, { text: '', number: null }, false, '')[0].ready, false)
  assert.equal(responseEntryGuide(value, { text: '', number: null, files: [ref] }, false, '')[0].ready, true)
  value.fileCollection.required = false; assert.equal(responseEntryGuide(value, { text: '', number: null, files: [] }, false, '')[0].ready, true)
  value.fileCollection.policy.maxFiles = 0; assert(collectionEntryGuide(value, members, schoolId, date).issues.length > 0); assert.equal(responseEntryGuide(value, { text: '', number: null, files: [ref] }, false, '')[0].ready, false)
})

console.log(`파일 수합 상태·원본·영구 저장 분리: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
