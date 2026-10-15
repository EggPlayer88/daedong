import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createPreviewFileRepository, createWorkflowStore, fixtureData } = await loadBrowserModule(`
  export {createPreviewFileRepository} from '../apps/workhub/src/files/preview-repository.ts'
  export {createWorkflowStore} from '../apps/workhub/src/workflows/store.ts'
  export {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
`)
const members = fixtureData.memberships, date = fixtureData.basisDate, schoolId = 'fixture-school-gaon'
const manager = 'gaon-minjun', author = 'gaon-soyeon', collaborator = 'gaon-seojin'
const policy = { extensions: ['pdf'], maxFileBytes: 2048, maxFiles: 3 }
const owner = (memberId = author) => ({ schoolId, memberId })
const scope = (memberId = author) => ({ schoolId, memberIds: [memberId] })
const contents = name => `%PDF-1.4\n합성 원본 ${name}\n%%EOF`
const source = name => new File([contents(name)], name, { type: 'application/pdf' })
const stage = (files, name, memberId = author) => files.stage(source(name), policy, owner(memberId))
const answer = refs => ({ text: '', number: null, files: refs })
const input = (templates = []) => ({ title: '파일 수명 검증 수합', instructions: '합성 파일만 사용합니다.', dueDate: '2026-10-21', reviewMode: 'required', reviewerMemberId: manager, textLabel: '', textRequired: false, numberLabel: '', numberRequired: false, units: [{ label: '2학년', responsibleMemberId: author, contributorMemberIds: [collaborator] }], fileCollection: { policy: structuredClone(policy), required: true, templates } })
const code = expected => error => error.code === expected
function make(options = {}) { const files = options.files ?? createPreviewFileRepository(); return { files, store: createWorkflowStore({ members, date, ...options, files }) } }
function opened(options = {}) { const value = make(options), request = value.store.createCollection(manager, input(), 'create'); value.store.publishCollection(manager, request.id, 1, 'publish'); return { ...value, request, unit: value.store.listUnits(author, request.id)[0] } }
async function readable(files, ref, memberId = author) { assert.equal(await (await files.read(ref, scope(memberId))).text(), contents(ref.name)) }
const unavailable = (files, ref, memberId = author) => assert.rejects(files.read(ref, scope(memberId)), code('FILE_UNAVAILABLE'))
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack || error.message}`) } }

await test('미저장 파일을 반복 회수해 용량을 재사용하고 중복 회수가 상한을 늘리지 않는다', async () => {
  const name = '한칸.pdf', bytes = source(name).size, files = createPreviewFileRepository({ maxTotalBytes: bytes * 2 })
  const saved = await stage(files, name); files.retainSaved([saved])
  for (let turn = 0; turn < 4; turn++) {
    const pending = await stage(files, name)
    await assert.rejects(stage(files, name), code('FILE_MEMORY_LIMIT'))
    files.discardStaged([pending, pending], owner()); files.discardStaged([pending], owner())
    await unavailable(files, pending); await readable(files, saved)
  }
  const pending = await stage(files, name)
  files.discardStaged([saved], owner())
  await assert.rejects(stage(files, name), code('FILE_MEMORY_LIMIT'))
  await readable(files, saved); await readable(files, pending)
})

await test('일괄 보호의 변조 오류와 회수의 소유자 오류는 일부 파일만 처리하지 않는다', async () => {
  const files = createPreviewFileRepository(), first = await stage(files, '첫파일.pdf'), second = await stage(files, '둘파일.pdf')
  assert.throws(() => files.retainSaved([first, { ...second, sha256: '0'.repeat(64) }]), code('FILE_UNAVAILABLE'))
  files.discardStaged([first], owner()); await unavailable(files, first)
  await readable(files, second)
  files.retainSaved([second, second]); const unsaved = await stage(files, '미저장.pdf'), shared = await stage(files, '공동파일.pdf', collaborator)
  assert.throws(() => files.discardStaged([unsaved, shared], owner()), code('FILE_SCOPE_DENIED'))
  await readable(files, unsaved); await readable(files, shared, collaborator)
  assert.throws(() => files.discardStaged([unsaved, { ...second, bytes: second.bytes + 1 }], owner()), code('FILE_UNAVAILABLE'))
  await readable(files, unsaved)
  files.discardStaged([unsaved, second], owner()); await unavailable(files, unsaved); await readable(files, second)
})

await test('저장한 수합 양식은 교체·제거 후에도 과거 멱등 결과의 원본으로 남는다', async () => {
  const { files, store } = make(), first = await stage(files, '최초양식.pdf', manager), firstInput = input([first])
  const request = store.createCollection(manager, firstInput, 'create')
  files.discardStaged([first], owner(manager))
  assert.equal(await (await store.getTemplateFile(manager, request.id, first.id)).text(), contents(first.name))
  const second = await stage(files, '수정양식.pdf', manager), secondInput = input([second])
  const updated = store.updateCollection(manager, request.id, secondInput, 1, 'replace')
  files.discardStaged([first, second], owner(manager))
  assert.deepEqual(store.createCollection(manager, firstInput, 'create'), request)
  assert.equal(await (await store.getTemplateFile(manager, request.id, second.id)).text(), contents(second.name))
  store.updateCollection(manager, request.id, input(), 2, 'remove')
  assert.deepEqual(store.updateCollection(manager, request.id, secondInput, 1, 'replace'), updated)
  for (const ref of [first, second]) await readable(files, ref, manager)
  assert.deepEqual(store.getCollection(manager, request.id).fileCollection.templates, [])
})

await test('수합 생성·수정 저장 실패는 선택을 바꾸거나 새 양식을 보호하지 않는다', async () => {
  for (const operation of ['create', 'update']) {
    let failing = false
    const { files, store } = make({ onChange: () => { if (failing) throw Error('합성 저장 실패') } })
    const request = operation === 'update' ? store.createCollection(manager, input(), 'base') : null
    const ref = await stage(files, '저장실패양식.pdf', manager), selected = input([ref]), original = structuredClone(selected), before = store.exportState()
    failing = true
    assert.throws(() => operation === 'create' ? store.createCollection(manager, selected, 'write') : store.updateCollection(manager, request.id, selected, 1, 'write'), code('STORAGE_FAILED'))
    assert.deepEqual(store.exportState(), before); assert.deepEqual(selected, original); await readable(files, ref, manager)
    files.discardStaged([ref], owner(manager)); await unavailable(files, ref, manager)
  }
})

await test('초안 저장 실패·버전 충돌은 선택을 유지하고 성공한 재시도만 파일을 보호한다', async () => {
  let failing = false
  const { files, store, unit } = opened({ onChange: () => { if (failing) throw Error('합성 저장 실패') } })
  const saved = await stage(files, '저장된응답.pdf'); store.saveDraft(author, unit.id, answer([saved]), 0, 'saved')
  for (const failure of ['storage', 'version']) {
    const ref = await stage(files, failure + '.pdf'), selected = answer([ref]), original = structuredClone(selected), before = store.exportState()
    failing = failure === 'storage'
    assert.throws(() => store.saveDraft(author, unit.id, selected, failure === 'version' ? 0 : 1, failure), code(failure === 'storage' ? 'STORAGE_FAILED' : 'VERSION_CONFLICT'))
    assert.deepEqual(store.exportState(), before); assert.deepEqual(selected, original); await readable(files, ref)
    files.discardStaged([ref], owner()); await unavailable(files, ref); await readable(files, saved)
  }
  const ref = await stage(files, '재시도응답.pdf'), selected = answer([ref])
  failing = true; assert.throws(() => store.saveDraft(author, unit.id, selected, 1, 'retry'), code('STORAGE_FAILED')); await readable(files, ref)
  failing = false; const result = store.saveDraft(author, unit.id, selected, 1, 'retry')
  files.discardStaged([ref], owner()); await readable(files, ref)
  assert.deepEqual(store.saveDraft(author, unit.id, selected, 1, 'retry'), result)
  assert.equal(store.getDraft(author, unit.id).version, 2)
})

await test('공동 초안 교체·제출·정정·철회 후 저장 이력과 모든 제출판 파일을 보존한다', async () => {
  const { files, store, unit } = opened(), original = await stage(files, '공동초안.pdf', collaborator), firstInput = answer([original])
  const firstDraft = store.saveDraft(collaborator, unit.id, firstInput, 0, 'joint')
  files.discardStaged([original], owner(collaborator))
  assert.equal(await (await store.getDraftFile(author, unit.id, original.id)).text(), contents(original.name))
  const first = await stage(files, '첫제출.pdf'); const secondDraft = store.saveDraft(author, unit.id, answer([first]), 1, 'replace')
  files.discardStaged([first], owner())
  assert.deepEqual(store.saveDraft(collaborator, unit.id, firstInput, 0, 'joint'), firstDraft)
  await readable(files, original, collaborator)
  const firstSubmission = store.submit(author, unit.id, secondDraft.version, 1, 'first')
  store.review(manager, unit.id, firstSubmission.id, 'accepted', '', '', 2, 'accept')
  const second = await stage(files, '정정제출.pdf'), thirdDraft = store.saveDraft(author, unit.id, answer([second]), 2, 'correct')
  const secondSubmission = store.submit(author, unit.id, thirdDraft.version, 3, 'second', '합성 정정')
  store.review(manager, unit.id, secondSubmission.id, 'changes_requested', '합성 보완', '2026-10-22', 4, 'changes')
  store.withdraw(author, unit.id, 5, '정정 내용 재확인', 'withdraw')
  files.discardStaged([first, second], owner())
  for (const [submission, ref] of [[firstSubmission, first], [secondSubmission, second]]) assert.equal(await (await store.getSubmissionFile(manager, unit.id, submission.id, ref.id)).text(), contents(ref.name))
  assert.deepEqual(store.submit(author, unit.id, secondDraft.version, 1, 'first'), firstSubmission)
  assert.equal(store.unitSummary(author, unit.id).effective.id, firstSubmission.id)
  assert.equal(store.getSubmissions(author, unit.id).length, 2)
})

await test('선택적 보호가 없는 저장소의 snapshot도 복원할 때 현재·과거 접수 파일을 보호한다', async () => {
  const files = createPreviewFileRepository(), legacy = { ...files, retainSaved: undefined }
  const store = createWorkflowStore({ members, date, files: legacy })
  const oldTemplate = await stage(files, '과거양식.pdf', manager), currentTemplate = await stage(files, '현재양식.pdf', manager)
  const initialInput = input([oldTemplate]), request = store.createCollection(manager, initialInput, 'create')
  store.updateCollection(manager, request.id, input([currentTemplate]), 1, 'replace-template'); store.publishCollection(manager, request.id, 2, 'publish')
  const unit = store.listUnits(author, request.id)[0], oldDraft = await stage(files, '과거초안.pdf', collaborator), oldAnswer = answer([oldDraft])
  const original = store.saveDraft(collaborator, unit.id, oldAnswer, 0, 'old-draft')
  const submitted = await stage(files, '복원제출.pdf'); store.saveDraft(author, unit.id, answer([submitted]), 1, 'current-draft')
  const submission = store.submit(author, unit.id, 2, 1, 'submit')
  const currentDraft = await stage(files, '현재초안.pdf'); store.saveDraft(author, unit.id, answer([currentDraft]), 2, 'new-draft')
  const restored = createWorkflowStore({ members, date, files, snapshot: store.exportState() })
  files.discardStaged([oldTemplate, currentTemplate], owner(manager)); files.discardStaged([oldDraft], owner(collaborator)); files.discardStaged([submitted, currentDraft], owner())
  assert.deepEqual(restored.createCollection(manager, initialInput, 'create'), request)
  assert.deepEqual(restored.saveDraft(collaborator, unit.id, oldAnswer, 0, 'old-draft'), original)
  for (const ref of [oldTemplate, currentTemplate]) await readable(files, ref, manager)
  await readable(files, oldDraft, collaborator)
  assert.equal(await (await restored.getSubmissionFile(manager, unit.id, submission.id, submitted.id)).text(), contents(submitted.name))
  assert.equal(await (await restored.getDraftFile(collaborator, unit.id, currentDraft.id)).text(), contents(currentDraft.name))
})

await test('보호 처리 실패도 초안·버전·접수·변경 알림을 남기지 않고 같은 요청으로 재시도한다', async () => {
  const original = createPreviewFileRepository(); let failing = false, signals = 0
  const files = { ...original, retainSaved: refs => { if (failing) throw Error('합성 보호 실패'); original.retainSaved(refs) } }
  const { store, unit } = opened({ files }), ref = await stage(files, '보호실패.pdf'), selected = answer([ref]), before = store.exportState()
  const unsubscribe = store.subscribe(() => signals++)
  failing = true; assert.throws(() => store.saveDraft(author, unit.id, selected, 0, 'retry'))
  assert.deepEqual(store.exportState(), before); assert.equal(signals, 0); await readable(files, ref)
  failing = false; const result = store.saveDraft(author, unit.id, selected, 0, 'retry')
  files.discardStaged([ref], owner()); await readable(files, ref)
  assert.equal(signals, 1); assert.equal(result.version, 1)
  assert.deepEqual(store.saveDraft(author, unit.id, selected, 0, 'retry'), result); assert.equal(signals, 1)
  unsubscribe()
})

await test('초기화는 보호 파일과 늦은 stage를 무효화하고 다음 선택의 용량 회수를 유지한다', async () => {
  const payload = '%PDF-1.4', file = () => new File([payload], '초기화.pdf'), files = createPreviewFileRepository({ maxTotalBytes: payload.length * 2 })
  const saved = await files.stage(file(), policy, owner()); files.retainSaved([saved])
  let release
  class Delayed extends File { stream() { return new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode(payload)); controller.close() } } }) } }
  const pending = files.stage(new Delayed([payload], '늦은파일.pdf'), policy, owner())
  await Promise.resolve(); assert.equal(typeof release, 'function')
  files.reset(); files.discardStaged([saved], owner()); release()
  await assert.rejects(pending, code('FILE_UNAVAILABLE')); await unavailable(files, saved)
  const next = await files.stage(file(), policy, owner()), another = await files.stage(file(), policy, owner())
  await assert.rejects(files.stage(file(), policy, owner()), code('FILE_MEMORY_LIMIT'))
  files.discardStaged([next, next, another], owner()); await unavailable(files, next); await unavailable(files, another)
  const reused = await files.stage(file(), policy, owner()); assert.equal(await (await files.read(reused, scope())).text(), payload)
})

console.log(`파일 선택·저장 수명: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
