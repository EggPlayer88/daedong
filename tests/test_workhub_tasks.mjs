import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createSupabaseTaskAdapter, createSupabaseConnection, TaskError, ContractError, normalizeTaskInput, taskResponse, fixtureData, relationLabels } = await loadBrowserModule(`
  export { createSupabaseTaskAdapter } from '../apps/workhub/src/tasks/supabase-task-adapter.ts'
  export { TaskError } from '../apps/workhub/src/tasks/contracts.ts'
  export { normalizeTaskInput, taskResponse } from '../apps/workhub/src/tasks/validation.ts'
  export { createSupabaseConnection } from '../apps/workhub/src/connection/supabase-connection.ts'
  export { ContractError } from '../apps/workhub/src/contracts.ts'
  export { fixtureData, relationLabels } from '../apps/workhub/src/preview/fixtures.ts'
`)
const memberId = 'gaon-soyeon', schoolId = 'fixture-school-gaon', userId = 'fixture-soyeon'
const input = { title: '합성 행사 준비', notes: '개인 메모', dueDate: '2026-10-21' }
const task = () => ({ ...input, id: 'synthetic-task-1', schoolId, ownerMemberId: memberId, status: 'todo', version: 1 })
const context = () => ({ ...structuredClone(fixtureData), schoolLabels: Object.fromEntries(fixtureData.schools.map(school => [school.id, relationLabels])) })
function fake(respond = async name => name === 'workhub_task_list' ? [task()] : task()) {
  let current = context()
  const calls = []
  const connection = { info: () => structuredClone(current), rpcVerified: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return respond(name, args) } }
  return { adapter: createSupabaseTaskAdapter(connection), calls, change: value => { current = value } }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const rejects = (run, code) => assert.rejects(run, error => error instanceof TaskError && error.code === code)
let failed = 0
async function test(name, run) { try { await run(); console.log(`  ✓ ${name}`) } catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) } }

await test('목록과 상세는 지정한 읽기 RPC만 호출하고 기존 업무 타입을 반환한다', async () => {
  const { adapter, calls } = fake()
  assert.deepEqual(await adapter.list(memberId), [task()])
  assert.deepEqual(await adapter.get(memberId, task().id), task())
  assert.deepEqual(calls, [{ name: 'workhub_task_list', args: { p_member_id: memberId } }, { name: 'workhub_task_get', args: { p_member_id: memberId, p_task_id: task().id } }])
})
await test('생성과 수정은 입력을 정규화하고 요청 키와 확인한 버전을 서버에 전달한다', async () => {
  const { adapter, calls } = fake()
  await adapter.create(memberId, { title: '\u00a0제목\u3000', notes: '\t메모\n', dueDate: '' }, ' create-key ')
  await adapter.update(memberId, task().id, input, 3, 'update-key')
  assert.deepEqual(calls[0], { name: 'workhub_task_mutate', args: { p_member_id: memberId, p_command: { kind: 'create', input: { title: '제목', notes: '메모', dueDate: '' } }, p_request_key: ' create-key ' } })
  assert.deepEqual(calls[1], { name: 'workhub_task_mutate', args: { p_member_id: memberId, p_command: { kind: 'update', taskId: task().id, input, expectedVersion: 3 }, p_request_key: 'update-key' } })
})
await test('완료·재개·대기·진행·취소는 status 명령으로만 전달한다', async () => {
  const { adapter, calls } = fake()
  for (const status of ['todo', 'doing', 'waiting', 'done', 'cancelled']) await adapter.setStatus(memberId, task().id, status, 2, `status-${status}`)
  assert.deepEqual(calls.map(call => call.args.p_command), ['todo', 'doing', 'waiting', 'done', 'cancelled'].map(status => ({ kind: 'status', taskId: task().id, status, expectedVersion: 2 })))
})
await test('깨진 입력·추가 필드·잘못된 날짜는 RPC 전에 거부한다', async () => {
  const { adapter, calls } = fake()
  for (const value of [null, [], {}, { ...input, title: null }, { ...input, title: '\t\n\u3000' }, { ...input, notes: null }, { ...input, dueDate: '2026-02-30' }, { ...input, dueDate: '0000-01-01' }, { ...input, dueDate: ' 2026-10-21' }, { ...input, dueDate: null }, { ...input, ownerMemberId: 'other' }]) await rejects(() => adapter.create(memberId, value, 'key'), 'INVALID_INPUT')
  assert.deepEqual(calls, [])
  assert.equal(normalizeTaskInput({ ...input, dueDate: '2028-02-29' }).dueDate, '2028-02-29')
})
await test('원문 코드포인트 한도와 ECMAScript 공백 정규화를 서버 계약에 맞춘다', async () => {
  const spaces = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
  assert.deepEqual(normalizeTaskInput({ title: `${spaces}제목${spaces}`, notes: `${spaces}메모${spaces}`, dueDate: '' }), { title: '제목', notes: '메모', dueDate: '' })
  assert.equal(normalizeTaskInput({ title: '😀'.repeat(120), notes: '😀'.repeat(2000), dueDate: '' }).title, '😀'.repeat(120))
  const { adapter, calls } = fake()
  for (const value of [{ ...input, title: '😀'.repeat(121) }, { ...input, title: ` ${'가'.repeat(119)} ` }, { ...input, notes: '😀'.repeat(2001) }]) await rejects(() => adapter.create(memberId, value, 'key'), 'INVALID_INPUT')
  assert.deepEqual(calls, [])
})
await test('잘못된 식별자·버전·상태·멱등 키는 서버에 보내지 않는다', async () => {
  const { adapter, calls } = fake()
  for (const value of [null, '', '  ', 'k'.repeat(201)]) await rejects(() => adapter.create(memberId, input, value), 'INVALID_INPUT')
  for (const value of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) await rejects(() => adapter.update(memberId, task().id, input, value, 'key'), 'INVALID_INPUT')
  for (const value of ['approved', null, ['done']]) await rejects(() => adapter.setStatus(memberId, task().id, value, 1, 'key'), 'INVALID_INPUT')
  for (const value of [null, '', ' task ', 'a'.repeat(201)]) await rejects(() => adapter.get(memberId, value), 'INVALID_INPUT')
  await rejects(() => adapter.list(null), 'INVALID_INPUT')
  assert.deepEqual(calls, [])
})
await test('JSONB에 저장할 수 없는 NUL·짝 없는 서로게이트를 요청 전에 거부한다', async () => {
  const { adapter, calls } = fake()
  for (const value of ['문자\0열', '\ud800', '\udc00', '앞\ud800뒤', '\ud800\ud800\udc00']) {
    await rejects(() => adapter.create(memberId, { ...input, title: value }, 'key'), 'INVALID_INPUT')
    await rejects(() => adapter.create(memberId, { ...input, notes: value }, 'key'), 'INVALID_INPUT')
    await rejects(() => adapter.create(memberId, input, value), 'INVALID_INPUT')
  }
  assert.deepEqual(calls, [])
  assert.equal(normalizeTaskInput({ ...input, title: '😀' }).title, '😀')
})
await test('종료 소속과 컨텍스트에 없는 소속은 호출 전에 거부한다', async () => {
  const { adapter, calls } = fake()
  await rejects(() => adapter.list('gaon-ended'), 'INACTIVE_MEMBERSHIP')
  await rejects(() => adapter.create('unknown-member', input, 'key'), 'QUERY_FAILED')
  assert.deepEqual(calls, [])
})
await test('목록에 다른 학교·다른 작성자·중복 ID가 섞이면 전체 응답을 거부한다', async () => {
  for (const rows of [[task(), { ...task(), id: 'other', schoolId: 'fixture-school-nuri' }], [task(), { ...task(), id: 'other', ownerMemberId: 'gaon-minjun' }], [task(), task()], null, { rows: [task()] }]) await rejects(() => fake(async () => rows).adapter.list(memberId), 'QUERY_FAILED')
})
await test('손상된 응답과 미정규화된 공백은 목록·상세·저장 모두 안전하게 거부한다', async () => {
  for (const value of [null, {}, { ...task(), title: ' 제목 ' }, { ...task(), notes: '메모\n' }, { ...task(), title: '가'.repeat(121) }, { ...task(), dueDate: '2026-02-29' }, { ...task(), status: 'approved' }, { ...task(), version: 0 }, { ...task(), version: 1.5 }, { ...task(), notes: null }]) {
    await rejects(() => fake(async () => value).adapter.get(memberId, task().id), 'QUERY_FAILED')
    await rejects(() => fake(async () => value).adapter.create(memberId, input, 'key'), 'SAVE_FAILED')
  }
})
await test('상세·수정·상태 결과는 요청한 업무 ID와도 일치해야 한다', async () => {
  const { adapter } = fake(async () => ({ ...task(), id: 'another-task' }))
  await rejects(() => adapter.get(memberId, task().id), 'QUERY_FAILED')
  await rejects(() => adapter.update(memberId, task().id, input, 1, 'key'), 'SAVE_FAILED')
  await rejects(() => adapter.setStatus(memberId, task().id, 'done', 1, 'status'), 'SAVE_FAILED')
})
await test('응답은 허용 필드만 새 객체로 반환하여 추가 개인정보·원문을 제거한다', async () => {
  const raw = { ...task(), email: 'private@example.invalid', token: 'synthetic-token', details: { raw: '추가 원문' } }
  const parsed = await fake(async () => raw).adapter.get(memberId, task().id)
  assert.deepEqual(parsed, task()); assert.notEqual(parsed, raw)
  raw.title = '외부 변경'; assert.equal(parsed.title, input.title)
})
await test('허용된 충돌 원본만 검증하여 TaskError.current로 전달한다', async () => {
  const current = { ...task(), version: 2, title: '서버 최신 제목', token: '제거할 추가 필드' }
  const { adapter } = fake(async () => { throw new ContractError('CONFLICT', '민감한 오류 원문', current) })
  await assert.rejects(() => adapter.update(memberId, task().id, input, 1, 'key'), error => {
    assert(error instanceof TaskError); assert.equal(error.code, 'CONFLICT')
    assert.deepEqual(error.current, { ...task(), version: 2, title: '서버 최신 제목' })
    assert(!JSON.stringify(error).includes('추가 필드')); assert(!error.message.includes('민감한'))
    return true
  })
})
await test('다른 학교·작성자·업무 또는 손상된 충돌 원문은 노출하지 않는다', async () => {
  for (const current of [null, {}, { ...task(), schoolId: 'fixture-school-nuri' }, { ...task(), ownerMemberId: 'gaon-minjun' }, { ...task(), id: 'another-task' }, { ...task(), version: '2' }, { ...task(), title: null }]) {
    const { adapter } = fake(async () => { throw new ContractError('CONFLICT', '원문', current) })
    await assert.rejects(() => adapter.update(memberId, task().id, input, 1, 'key'), error => error instanceof TaskError && error.code === 'CONFLICT' && error.current === undefined)
  }
})
await test('알려진 서버 실패 코드는 보존하고 기술 원문을 교사용 고정 메시지로 바꾼다', async () => {
  for (const code of ['INVALID_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'IDEMPOTENCY_CONFLICT', 'CANCELLED']) {
    const { adapter } = fake(async () => { throw new ContractError(code, 'secret@example.invalid') })
    await assert.rejects(() => adapter.create(memberId, input, 'key'), error => error instanceof TaskError && error.code === code && !error.message.includes('secret'))
  }
})
await test('미확인 저장 결과는 SAVE_FAILED이며 조회 장애와 구별하고 원문은 숨긴다', async () => {
  for (const failure of [new Error('secret@example.invalid'), new ContractError('QUERY_FAILED', '원문'), { code: 'CONFLICT', current: task(), message: '가짜 오류' }]) {
    const { adapter } = fake(async () => { throw failure })
    await rejects(() => adapter.list(memberId), 'QUERY_FAILED')
    await rejects(() => adapter.create(memberId, input, 'key'), 'SAVE_FAILED')
  }
})
await test('동일 입력과 요청 키의 재시도는 새 키를 만들지 않고 그대로 서버로 전달한다', async () => {
  let first = true
  const { adapter, calls } = fake(async () => { if (first) { first = false; throw new Error('응답 유실') } return task() })
  await rejects(() => adapter.create(memberId, input, 'same-key'), 'SAVE_FAILED')
  assert.deepEqual(await adapter.create(memberId, input, 'same-key'), task())
  assert.deepEqual(calls[0], calls[1])
})
await test('응답 대기 중 학교·UID·소속 상태가 바뀌면 이전 업무 본문을 폐기한다', async () => {
  for (const changeMember of [member => ({ ...member, schoolId: 'fixture-school-nuri' }), member => ({ ...member, userId: 'different-user' }), member => ({ ...member, active: false })]) {
    const gate = deferred(); const started = deferred()
    const { adapter, change } = fake(async () => { started.resolve(); return gate.promise })
    const result = adapter.get(memberId, task().id); await started.promise
    const next = context(); next.memberships = next.memberships.map(member => member.id === memberId ? changeMember(member) : member)
    change(next); gate.resolve(task())
    await rejects(() => result, 'CANCELLED')
  }
})
await test('연결 컨텍스트를 비운 뒤 도착한 충돌 원본도 과거 컨텍스트로 우회하지 않는다', async () => {
  const gate = deferred(); const started = deferred()
  const { adapter, change } = fake(async () => { started.resolve(); await gate.promise; throw new ContractError('CONFLICT', '원문', { ...task(), version: 2 }) })
  const result = adapter.update(memberId, task().id, input, 1, 'key'); await started.promise
  change({ ...context(), schools: [], memberships: [] }); gate.resolve()
  await rejects(() => result, 'CANCELLED')
})
await test('실제 rpcVerified와 함께 세션 변경 시 성공 및 충돌 응답을 모두 폐기한다', async () => {
  for (const conflict of [false, true]) {
    let sessionUser = userId
    const gate = deferred(); const entered = deferred()
    const services = {
      getSession: async () => ({ user: { id: sessionUser } }),
      fetchMyProfile: async id => ({ id, name: '합성 교사', email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true }),
      onAuthStateChange: () => () => {}, signInWithGoogle: async () => { throw new Error('호출 금지') }, signOut: async () => { throw new Error('호출 금지') },
      rpc: async name => { if (name === 'workhub_context') return { data: context(), error: null }; entered.resolve(); await gate.promise; return conflict ? { data: null, error: { message: 'CONFLICT', details: JSON.stringify({ ...task(), version: 2 }) } } : { data: task(), error: null } },
    }
    const connection = createSupabaseConnection(services); await connection.loadContext()
    const result = createSupabaseTaskAdapter(connection).update(memberId, task().id, input, 1, 'key')
    await entered.promise; sessionUser = 'different-user'; gate.resolve()
    await rejects(() => result, 'CANCELLED')
  }
})
await test('실제 rpcVerified의 충돌 details를 업무 응답으로 다시 검증한다', async () => {
  const services = {
    getSession: async () => ({ user: { id: userId } }), fetchMyProfile: async () => ({ id: userId, name: '합성', email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true }),
    onAuthStateChange: () => () => {}, signInWithGoogle: async () => {}, signOut: async () => {},
    rpc: async name => name === 'workhub_context' ? { data: context(), error: null } : { data: null, error: { message: 'CONFLICT', details: JSON.stringify({ ...task(), version: 2 }) } },
  }
  const connection = createSupabaseConnection(services); await connection.loadContext()
  await assert.rejects(() => createSupabaseTaskAdapter(connection).update(memberId, task().id, input, 1, 'key'), error => error instanceof TaskError && error.current?.version === 2)
})

if (failed) process.exitCode = 1
