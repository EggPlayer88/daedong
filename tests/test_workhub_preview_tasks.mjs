// 실제 로컬 업무 저장소와 비동기 화면 어댑터를 함께 검증한다. 운영 DB·로그인은 사용하지 않는다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createPreviewTaskAdapter, createWorkflowStore, TaskError, WorkflowError, fixtureData } = await loadBrowserModule(`
  export { createPreviewTaskAdapter } from '../apps/workhub/src/preview/task-adapter.ts'
  export { createWorkflowStore } from '../apps/workhub/src/workflows/store.ts'
  export { TaskError } from '../apps/workhub/src/tasks/contracts.ts'
  export { WorkflowError } from '../apps/workhub/src/workflows/types.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
`)
const members = fixtureData.memberships, date = fixtureData.basisDate
const owner = members.find(member => member.id === 'gaon-soyeon')
const colleague = members.find(member => member.id === 'gaon-minjun')
const otherSchool = members.find(member => member.id === 'nuri-soyeon')
const input = { title: '합성 준비 업무', notes: '내가 볼 메모', dueDate: date }
function setup(options = {}) { const store = createWorkflowStore({ members, date, ...options }); return { store, adapter: createPreviewTaskAdapter(store) } }
const rejects = (action, code, verify = () => true) => assert.rejects(action, error => error instanceof TaskError && error.code === code && verify(error))
let passed = 0, failed = 0
async function test(name, action) { try { await action(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`) } }

await test('생성·목록·원본 조회는 현재 학교와 소유자를 유지하며 정규화한다', async () => {
  const { adapter } = setup()
  const result = await adapter.create(owner.id, { title: '\u3000준비 업무\t', notes: '\n개인 메모\u00a0', dueDate: '' }, 'create')
  assert.equal(result.title, '준비 업무'); assert.equal(result.notes, '개인 메모')
  assert.equal(result.schoolId, owner.schoolId); assert.equal(result.ownerMemberId, owner.id)
  assert.equal(result.status, 'todo'); assert.equal(result.version, 1)
  assert.deepEqual(await adapter.list(owner.id), [result])
  assert.deepEqual(await adapter.get(owner.id, result.id), result)
})
await test('같은 생성 요청 재시도는 한 업무와 한 영속화 결과만 만든다', async () => {
  const writes = [], { store, adapter } = setup({ onChange: snapshot => writes.push(snapshot) })
  const first = await adapter.create(owner.id, input, 'same-create')
  assert.deepEqual(await adapter.create(owner.id, input, 'same-create'), first)
  assert.equal((await adapter.list(owner.id)).length, 1)
  assert.equal(store.exportState().receipts.length, 1); assert.equal(writes.length, 1)
})
await test('같은 요청 키에 다른 본문을 보내면 원본 변경 없이 충돌한다', async () => {
  const { store, adapter } = setup()
  await adapter.create(owner.id, input, 'same-create')
  const before = store.exportState()
  await rejects(() => adapter.create(owner.id, { ...input, title: '다른 요청' }, 'same-create'), 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(store.exportState(), before)
})
await test('수정과 상태 재시도도 같은 판을 반환하며 버전을 중복 증가시키지 않는다', async () => {
  const { adapter } = setup()
  const first = await adapter.create(owner.id, input, 'create')
  const changed = { ...input, title: '수정한 업무' }
  const second = await adapter.update(owner.id, first.id, changed, 1, 'update')
  assert.equal(second.version, 2)
  assert.deepEqual(await adapter.update(owner.id, first.id, changed, 1, 'update'), second)
  const completed = await adapter.setStatus(owner.id, first.id, 'done', 2, 'complete')
  assert.deepEqual(await adapter.setStatus(owner.id, first.id, 'done', 2, 'complete'), completed)
  assert.equal((await adapter.get(owner.id, first.id)).version, 3)
})
await test('오래된 버전의 수정·상태 변경은 본인 최신 원본과 함께 CONFLICT를 반환한다', async () => {
  const { store, adapter } = setup()
  const first = await adapter.create(owner.id, input, 'create')
  const latest = await adapter.update(owner.id, first.id, { ...input, notes: '먼저 저장한 메모' }, 1, 'first-update')
  const before = store.exportState()
  await rejects(() => adapter.update(owner.id, first.id, input, 1, 'stale-update'), 'CONFLICT', error => { assert.deepEqual(error.current, latest); return true })
  await rejects(() => adapter.setStatus(owner.id, first.id, 'done', 1, 'stale-status'), 'CONFLICT', error => { assert.deepEqual(error.current, latest); return true })
  assert.deepEqual(store.exportState(), before)
})
await test('충돌 후 현재 원본 재조회 권한이 없으면 current를 내보내지 않는다', async () => {
  const adapter = createPreviewTaskAdapter({ updateTask() { throw new WorkflowError('VERSION_CONFLICT', '버전 충돌') }, listTasks() { throw new WorkflowError('FORBIDDEN', '원본 열람 불가') } })
  await rejects(() => adapter.update(owner.id, 'private-task', input, 1, 'update'), 'CONFLICT', error => error.current === undefined)
})
await test('같은 학교 관리자와 겸임 학교 소속 모두 타인 개인 업무를 조회·수정할 수 없다', async () => {
  const { adapter } = setup()
  const privateTask = await adapter.create(owner.id, input, 'create')
  for (const other of [colleague, otherSchool]) {
    assert.deepEqual(await adapter.list(other.id), [])
    for (const action of [() => adapter.get(other.id, privateTask.id), () => adapter.update(other.id, privateTask.id, input, 0, 'foreign-update'), () => adapter.setStatus(other.id, privateTask.id, 'done', 0, 'foreign-status')]) await rejects(action, 'NOT_FOUND', error => error.current === undefined)
  }
  const otherTask = await adapter.create(otherSchool.id, input, 'create')
  assert.notEqual(privateTask.id, otherTask.id)
  assert.deepEqual(await adapter.list(owner.id), [privateTask])
  assert.deepEqual(await adapter.list(otherSchool.id), [otherTask])
})
await test('소속 종료는 읽기와 기존 접수증 재시도를 모두 거부한다', async () => {
  const { store, adapter } = setup()
  const task = await adapter.create(owner.id, input, 'create')
  store.setContext({ members: members.map(member => member.id === owner.id ? { ...member, active: false } : member), date })
  for (const action of [() => adapter.list(owner.id), () => adapter.get(owner.id, task.id), () => adapter.create(owner.id, input, 'create'), () => adapter.update(owner.id, task.id, input, 1, 'update'), () => adapter.setStatus(owner.id, task.id, 'done', 1, 'done')]) await rejects(action, 'INACTIVE_MEMBERSHIP', error => error.current === undefined)
})
await test('상태 다섯 종류의 전환과 완료·취소 후 재개가 같은 업무를 유지한다', async () => {
  const { adapter } = setup()
  let task = await adapter.create(owner.id, input, 'create')
  const originalId = task.id
  for (const status of ['doing', 'waiting', 'done', 'todo', 'cancelled', 'todo']) {
    task = await adapter.setStatus(owner.id, task.id, status, task.version, `${status}-${task.version}`)
    assert.equal(task.id, originalId); assert.equal(task.status, status)
  }
  assert.equal(task.version, 7); assert.equal((await adapter.list(owner.id)).length, 1)
})
await test('이모지 코드포인트 한도가 실제 업무와 같고 저장 상태를 다시 읽어도 유지된다', async () => {
  const { store, adapter } = setup()
  const value = { title: '😀'.repeat(120), notes: '😀'.repeat(2000), dueDate: '' }
  const task = await adapter.create(owner.id, value, 'emoji')
  assert.equal(task.title, value.title); assert.equal(task.notes, value.notes)
  const restored = setup({ snapshot: store.exportState() })
  assert.deepEqual(await restored.adapter.get(owner.id, task.id), task)
  assert.deepEqual(await restored.adapter.create(owner.id, value, 'emoji'), task)
  await rejects(() => adapter.create(owner.id, { ...value, title: '😀'.repeat(121) }, 'long-title'), 'INVALID_INPUT')
  await rejects(() => adapter.create(owner.id, { ...value, notes: '😀'.repeat(2001) }, 'long-note'), 'INVALID_INPUT')
})
await test('깨진 입력과 잘못된 날짜·NUL·잘못된 상태는 업무나 접수증을 만들지 않는다', async () => {
  const { store, adapter } = setup()
  for (const value of [null, [], {}, { ...input, title: ' \t ' }, { ...input, title: '\ud800' }, { ...input, notes: '메모\0' }, { ...input, notes: null }, { ...input, dueDate: '2026-02-30' }, { ...input, dueDate: '0000-01-01' }]) await rejects(() => adapter.create(owner.id, value, 'invalid'), 'INVALID_INPUT')
  assert.equal(store.exportState().tasks.length, 0); assert.equal(store.exportState().receipts.length, 0)
  const task = await adapter.create(owner.id, input, 'valid')
  await rejects(() => adapter.setStatus(owner.id, task.id, 'approved', 1, 'invalid-status'), 'INVALID_INPUT')
  assert.equal((await adapter.get(owner.id, task.id)).version, 1)
})
await test('영속 저장 실패는 SAVE_FAILED로 변환하고 메모리·접수증을 보존한 채 같은 요청으로 재시도한다', async () => {
  let broken = true
  const { store, adapter } = setup({ onChange() { if (broken) throw new Error('합성 저장 실패') } })
  const before = store.exportState()
  await rejects(() => adapter.create(owner.id, input, 'recover-create'), 'SAVE_FAILED')
  assert.deepEqual(store.exportState(), before)
  broken = false
  const task = await adapter.create(owner.id, input, 'recover-create')
  assert.deepEqual(await adapter.create(owner.id, input, 'recover-create'), task)
  broken = true
  const saved = store.exportState()
  await rejects(() => adapter.setStatus(owner.id, task.id, 'done', 1, 'recover-status'), 'SAVE_FAILED')
  assert.deepEqual(store.exportState(), saved)
  broken = false
  assert.equal((await adapter.setStatus(owner.id, task.id, 'done', 1, 'recover-status')).version, 2)
})
await test('예상하지 못한 저장소 오류 원문을 어댑터 밖으로 반환하지 않는다', async () => {
  const adapter = createPreviewTaskAdapter({ listTasks() { throw new Error('SECRET-storage-internal') } })
  await rejects(() => adapter.list(owner.id), 'QUERY_FAILED', error => !error.message.includes('SECRET'))
})
await test('호출자가 반환 자료를 바꾸어도 저장된 업무와 충돌 원본은 바뀌지 않는다', async () => {
  const { adapter } = setup()
  const first = await adapter.create(owner.id, input, 'create')
  first.title = '외부 변조'
  const list = await adapter.list(owner.id); list[0].notes = '외부 변조'
  const current = await adapter.get(owner.id, first.id)
  assert.equal(current.title, input.title); assert.equal(current.notes, input.notes)
  await adapter.setStatus(owner.id, first.id, 'done', 1, 'done')
  await rejects(() => adapter.update(owner.id, first.id, input, 1, 'stale'), 'CONFLICT', error => { error.current.notes = '충돌 변조'; return true })
  assert.equal((await adapter.get(owner.id, first.id)).notes, input.notes)
})
console.log(`\n미리보기 개인 업무 ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
