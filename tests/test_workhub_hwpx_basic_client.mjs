import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createBasicFileCheck } = await loadBrowserModule(`export { createBasicFileCheck } from '../apps/workhub/src/collections/basic-file-check'`)
const input = { memberId: 'member', fileId: 'file', requestKey: 'original-request-key' }
const session = userId => ({ user: { id: userId }, access_token: 'fake-browser-jwt-for-tests-only' })
const body = { contractVersion: 1, schoolId: 'school', memberId: 'member', data: { fileId: 'file', state: 'pending_verification', file: null } }
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const waitUntil = async test => { for (let index = 0; index < 200; index++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 1)) } throw Error('합성 요청 대기 실패') }
const fails = (operation, code) => assert.rejects(operation, error => error.code === code && !/private-trace|fake-browser-jwt|server-secret/.test(error.message))
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`) } }

await test('같은 사이트의 고정 API에 사용자 JWT와 요청 식별자 세 개만 보낸다', async () => {
  const calls = [], checker = createBasicFileCheck({ getSession: async () => session('user'), fetch: async (...args) => { calls.push(args); return json(body) } })
  assert.deepEqual(await checker.check({ ...input, bucket: 'forbidden-extra', serverKey: 'server-secret' }, 'user'), body)
  assert.equal(calls.length, 1)
  const [url, init] = calls[0]
  assert.equal(url, '/api/collections/check-hwpx'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store')
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer fake-browser-jwt-for-tests-only' }); assert.deepEqual(JSON.parse(init.body), input)
  assert.ok(init.signal instanceof AbortSignal)
})
await test('첫 세션 대기 중 호출자가 입력을 바꿔도 최초 파일·요청 번호를 전송한다', async () => {
  const first = deferred(), mutable = { ...input }, calls = []; let sessions = 0
  const checker = createBasicFileCheck({ getSession: () => ++sessions === 1 ? first.promise : Promise.resolve(session('user')), fetch: async (_url, init) => { calls.push(init.body); return json(body) } })
  const pending = checker.check(mutable, 'user'); mutable.memberId = 'other-member'; mutable.fileId = 'other-file'; mutable.requestKey = 'other-key'; first.resolve(session('user'))
  await pending; assert.deepEqual(JSON.parse(calls[0]), input)
})
await test('초기 세션 없음·다른 계정·토큰 없음은 서버를 부르지 않는다', async () => {
  for (const current of [null, session('other'), { user: { id: 'user' } }]) {
    let calls = 0; const checker = createBasicFileCheck({ getSession: async () => current, fetch: async () => { calls++; return json(body) } })
    await fails(() => checker.check(input, 'user'), 'CANCELLED'); assert.equal(calls, 0)
  }
})
await test('API 응답을 기다리는 동안 계정이 바뀌면 성공·권한 실패 모두 폐기한다', async () => {
  for (const status of [200, 403]) {
    const response = deferred(); let user = 'user', started = false
    const checker = createBasicFileCheck({ getSession: async () => session(user), fetch: () => { started = true; return response.promise } })
    const pending = checker.check(input, 'user'); await waitUntil(() => started); user = 'other'; response.resolve(status === 200 ? json(body) : new Response('private-trace', { status }))
    await fails(() => pending, 'CANCELLED')
  }
})
await test('응답 헤더 이후 본문을 받는 도중의 계정 변경도 폐기한다', async () => {
  let user = 'user', sessions = 0, streamController
  const stream = new ReadableStream({ start(controller) { streamController = controller } })
  const checker = createBasicFileCheck({ getSession: async () => { sessions++; return session(user) }, fetch: async () => new Response(stream) })
  const pending = checker.check(input, 'user'); await waitUntil(() => sessions >= 2); user = 'other'
  streamController.enqueue(new TextEncoder().encode(JSON.stringify(body))); streamController.close()
  await fails(() => pending, 'CANCELLED')
})
await test('세션 조회가 처음이나 응답 후에 실패하면 원시 오류 없이 결과 불명으로 남긴다', async () => {
  for (const failAt of [1, 2, 3]) {
    let sessions = 0, calls = 0
    const checker = createBasicFileCheck({ getSession: async () => { if (++sessions === failAt) throw Error('private-trace server-secret'); return session('user') }, fetch: async () => { calls++; return json(body) } })
    await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); if (failAt === 1) assert.equal(calls, 0)
  }
})
await test('초기 세션이 멈춰도 제한 시간에 끝나고 늦게 돌아온 세션으로 전송하지 않는다', async () => {
  const first = deferred(); let calls = 0
  const checker = createBasicFileCheck({ timeoutMs: 10, getSession: () => first.promise, fetch: async () => { calls++; return json(body) } })
  await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); first.resolve(session('user')); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls, 0)
})
await test('응답 크기는 문자 수가 아닌 16KiB 바이트로 제한한다', async () => {
  const maximum = '"' + 'x'.repeat(16384 - 2) + '"', tooManyBytes = '"' + '가'.repeat(6000) + '"'
  const accepted = createBasicFileCheck({ getSession: async () => session('user'), fetch: async () => new Response(maximum) })
  assert.equal((await accepted.check(input, 'user')).length, 16382)
  const rejected = createBasicFileCheck({ getSession: async () => session('user'), fetch: async () => new Response(tooManyBytes) })
  await fails(() => rejected.check(input, 'user'), 'RESULT_UNKNOWN')
})
await test('끝없는 큰 응답은 전체를 받기 전에 읽기를 중단하고 스트림을 취소한다', async () => {
  let pulls = 0, cancelled = false
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(9000)) }, cancel() { cancelled = true } })
  const checker = createBasicFileCheck({ getSession: async () => session('user'), fetch: async () => new Response(stream) })
  await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); assert.equal(cancelled, true); assert.ok(pulls <= 3)
})
await test('JSON·UTF-8 손상과 본문 읽기 오류는 파일 거절로 단정하지 않는다', async () => {
  const values = ['<html>private-trace</html>', new Uint8Array([0xff]), new ReadableStream({ start(controller) { controller.error(Error('private-trace')) } })]
  for (const value of values) {
    const checker = createBasicFileCheck({ getSession: async () => session('user'), fetch: async () => new Response(value) })
    await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN')
  }
})
await test('401·403만 권한 거절이며 다른 HTTP 실패는 원시 본문 없이 결과 불명이다', async () => {
  for (const status of [401, 403, 404, 409, 422, 429, 500, 503]) {
    const checker = createBasicFileCheck({ getSession: async () => session('user'), fetch: async () => new Response('private-trace server-secret', { status }) })
    await fails(() => checker.check(input, 'user'), [401, 403].includes(status) ? 'FORBIDDEN' : 'RESULT_UNKNOWN')
  }
})
await test('확인된 업무 오류는 결과 불명으로 감추지 않고 서버 준비 오류에도 입력 재시도 경로를 유지한다', async () => {
  for (const [code, status] of [['NOT_READY',503], ['IDEMPOTENCY_CONFLICT',409], ['CONFLICT',409], ['FILE_FAILED',422], ['NOT_FOUND',404]]) {
    const checker=createBasicFileCheck({getSession:async()=>session('user'),fetch:async()=>new Response(JSON.stringify({error:{code}}),{status})})
    await fails(()=>checker.check(input,'user'),code)
  }
})
await test('네트워크 예외는 결과 불명이며 도중 계정 변경이 있으면 취소된다', async () => {
  for (const switched of [false, true]) {
    let user = 'user'
    const checker = createBasicFileCheck({ getSession: async () => session(user), fetch: async () => { if (switched) user = 'other'; throw Error('private-trace server-secret') } })
    await fails(() => checker.check(input, 'user'), switched ? 'CANCELLED' : 'RESULT_UNKNOWN')
  }
})
await test('fetch가 abort를 무시해도 제한 시간에 결과 불명으로 끝난다', async () => {
  let signal
  const checker = createBasicFileCheck({ timeoutMs: 10, getSession: async () => session('user'), fetch: (_url, init) => { signal = init.signal; return new Promise(() => {}) } })
  await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); assert.equal(signal.aborted, true)
})
await test('본문 전송이 멈춰도 제한 시간에 읽기를 취소하고 결과 불명을 유지한다', async () => {
  let cancelled = false
  const stream = new ReadableStream({ cancel() { cancelled = true } })
  const checker = createBasicFileCheck({ timeoutMs: 10, getSession: async () => session('user'), fetch: async () => new Response(stream) })
  await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); assert.equal(cancelled, true)
})
await test('전송 실패 후 재시도에서도 파일과 요청 번호를 새로 만들지 않는다', async () => {
  const calls = [], checker = createBasicFileCheck({ getSession: async () => session('user'), fetch: async (_url, init) => { calls.push(init.body); if (calls.length === 1) throw Error('private-trace'); return json(body) } })
  await fails(() => checker.check(input, 'user'), 'RESULT_UNKNOWN'); assert.deepEqual(await checker.check(input, 'user'), body); assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]); assert.equal(JSON.parse(calls[1]).requestKey, input.requestKey)
})
await test('잘못된 시간 설정은 API 요청 전에 거부한다', async () => {
  for (const timeoutMs of [0, -1, Infinity, NaN, 60001]) assert.throws(() => createBasicFileCheck({ timeoutMs, getSession: async () => session('user') }), error => error.code === 'INVALID_INPUT')
})
console.log(`\nHWPX 기본 확인 API 클라이언트: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
