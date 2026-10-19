import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
  export { createMessageFileServer, messageFileStatus, messageFileReadiness, MessageFileReservationEndedError } from '../apps/workhub/src/messaging/files'
  export { createMessageFileCheck } from '../apps/workhub/src/messaging/message-file-check'
  export { MessagingError } from '../apps/workhub/src/messaging/contracts'
`)
const scope = { schoolId: 'school', memberId: 'teacher', userId: 'user' }
const member = { id: scope.memberId, schoolId: scope.schoolId, userId: scope.userId, name: '교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const policy = { extensions: ['hwpx'], maxFileBytes: 1024, maxFiles: 2 }
const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]), hash = createHash('sha256').update(bytes).digest('hex')
const file = () => new File([bytes], '학교자료.hwpx', { type: 'application/hwp+zip' })
const ref = { id: 'message-file', name: '학교자료.hwpx', bytes: bytes.length, sha256: hash, profile: 'hwpx_basic_v1' }
const intent = () => ({ fileId: ref.id, bucket: 'workhub-message-files', path: 'school/teacher/message-file/original.hwpx', expiresAt: '2099-10-16T12:00:00Z', state: 'awaiting_upload' })
const status = state => ({ fileId: ref.id, state, storageObjectId: state === 'ready' || state === 'pending_basic' ? 'object-one' : null, file: state === 'ready' ? ref : null })
const envelope = data => ({ contractVersion: 1, ...scope, ok: true, data })
function harness(handler, portOverrides = {}) {
  let approved = true, uid = scope.userId, currentMember = structuredClone(member)
  const calls = [], uploads = []
  const connection = {
    info: () => ({ basisDate: '2026-10-16', schools: [{ id: scope.schoolId }], memberships: [currentMember] }), getIdentity: async () => ({ userId: uid, approved }),
    rpcVerified: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return handler(name, args) },
  }
  const port = { async upload(bucket, path, blob) { uploads.push({ bucket, path, size: blob.size }) }, async download() { return new Blob([bytes]) }, async check() { return envelope(status('ready')) }, ...portOverrides }
  return { server: m.createMessageFileServer(connection, { port, timeoutMs: 100 }), connection, calls, uploads, changeUser() { uid = 'other' }, revoke() { approved = false }, changeRole() { currentMember = { ...currentMember, role: 'calendar_manager' } } }
}
const base = name => envelope(name === 'workhub_message_file_readiness' ? { available: true, reason: 'ready', policy } : name === 'workhub_message_file_prepare' ? intent() : status('pending_basic'))
let count = 0
async function check(name, run) { await run(); count++; console.log(`  ✓ ${name}`) }
const rejects = (run, code) => assert.rejects(run, error => error instanceof m.MessagingError && error.code === code)
await check('첨부 준비 상태는 HWPX 전용 정책과 ready를 함께 확인한다', () => {
  assert.equal(m.messageFileReadiness({ available: true, reason: 'ready', policy }).policy.maxFiles, 2)
  assert.throws(() => m.messageFileReadiness({ available: true, reason: 'verification_missing', policy }))
  assert.throws(() => m.messageFileReadiness({ available: true, reason: 'ready', policy: { ...policy, extensions: ['hwpx', 'pdf'] } }))
})
await check('ready는 실물 ID와 확인된 HWPX 메타데이터 없이는 성립하지 않는다', () => {
  for (const changed of [{ file: null }, { storageObjectId: null }, { file: { ...ref, profile: 'clean' } }, { file: { ...ref, id: 'other' } }]) assert.throws(() => m.messageFileStatus({ ...status('ready'), ...changed }, ref.id))
})
await check('예약은 실제 파일 해시·크기를 보내고 메시지 전용 버킷만 받는다', async () => {
  const h = harness(base), reservation = await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  assert.equal(reservation.bucket, 'workhub-message-files'); assert.equal(h.calls[0].args.p_file.claimedSha256, hash); assert.equal(h.calls[0].args.p_file.claimedBytes, bytes.length)
})
await check('수합 버킷과 다른 학교·작성자·fileId 경로는 업로드 예약으로 받지 않는다', async () => {
  for (const changed of [{ bucket: 'workhub-collection-files' }, { path: 'other/teacher/message-file/original.hwpx' }, { path: 'school/other/message-file/original.hwpx' }, { path: 'school/teacher/../../file' }]) {
    const h = harness(() => envelope({ ...intent(), ...changed })); await rejects(() => h.server.prepare(scope.memberId, file(), policy, 'prepare-one'), 'RESULT_UNKNOWN'); assert.equal(h.uploads.length, 0)
  }
})
await check('사용자가 지어낸 업로드 예약과 원본을 바꾼 재전송을 거부한다', async () => {
  const h = harness(base); await rejects(() => h.server.upload(scope.memberId, intent(), file()), 'INVALID_INPUT')
  const reservation = await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  await rejects(() => h.server.upload(scope.memberId, reservation, new File([new Uint8Array([80, 75, 3, 4, 9, 9, 9])], '학교자료.hwpx')), 'INVALID_INPUT'); assert.equal(h.uploads.length, 0)
})
await check('확장자만 바꾼 파일과 PDF는 기본 메타데이터·표식에서 막는다', async () => {
  const h = harness(base)
  await rejects(() => h.server.prepare(scope.memberId, new File(['PDF'], '학교자료.hwpx'), policy, 'bad-one'), 'INVALID_INPUT')
  await rejects(() => h.server.prepare(scope.memberId, new File([bytes], '학교자료.pdf'), policy, 'bad-two'), 'INVALID_INPUT'); assert.equal(h.calls.length, 0)
})
await check('Storage 전송 뒤에도 서버 기본 확인 전에는 ready로 만들지 않는다', async () => {
  const h = harness(base, { async check() { return envelope(status('pending_basic')) } })
  const reservation = await h.server.prepare(scope.memberId, file(), policy, 'prepare-one'); await h.server.upload(scope.memberId, reservation, file())
  const result = await h.server.complete(scope.memberId, ref.id, 'complete-one')
  assert.equal(h.uploads.length, 1); assert.equal(result.state, 'pending_basic'); assert.equal(result.file, null)
})
await check('검사 wrapper가 준비되지 않았으면 기존 요청을 결과 미확정으로 남긴다', async () => {
  const h = harness(base, { async check() { throw new Error('404') } }); await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  await rejects(() => h.server.complete(scope.memberId, ref.id, 'complete-one'), 'RESULT_UNKNOWN')
})
await check('완료 재시도는 동일 번호를 보내며 예약 원문과 다른 확인 결과를 거부한다', async () => {
  let tries = 0
  const h = harness(base, { async check() { if (++tries === 1) throw new Error('응답 유실'); return envelope(status('ready')) } })
  await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  await rejects(() => h.server.complete(scope.memberId, ref.id, 'complete-one'), 'RESULT_UNKNOWN')
  assert.equal((await h.server.complete(scope.memberId, ref.id, 'complete-one')).state, 'ready')
  const calls = h.calls.filter(c => c.name === 'workhub_message_file_complete'); assert.deepEqual(calls[0].args, calls[1].args)
  const mismatched = harness(base, { async check() { return envelope({ ...status('ready'), file: { ...ref, sha256: 'a'.repeat(64) } }) } })
  await mismatched.server.prepare(scope.memberId, file(), policy, 'prepare-one'); await rejects(() => mismatched.server.complete(scope.memberId, ref.id, 'complete-one'), 'RESULT_UNKNOWN')
})
await check('첨부 처리 중 사용자·역할 변경은 이전 파일 응답을 폐기한다', async () => {
  let h; h = harness((name, args) => { h.changeRole(); return base(name, args) })
  await rejects(() => h.server.prepare(scope.memberId, file(), policy, 'prepare-one'), 'CANCELLED')
})
const access = () => ({ threadId: 'thread', messageId: 'message', file: ref, bucket: 'workhub-message-files', path: 'school/sender/message-file/original.hwpx', ownerMemberId: 'sender', storageObjectId: 'object-one' })
await check('내려받기는 실제 메시지·원본 메타데이터·전후 권한을 확인한다', async () => {
  const h = harness(() => envelope(access()))
  const blob = await h.server.download(scope.memberId, 'thread', 'message', ref)
  assert.equal(blob.size, bytes.length); assert.equal(h.calls.filter(c => c.name === 'workhub_message_file_access').length, 2)
})
await check('내려받는 동안 실물 ID·권한이 바뀌거나 내용 해시가 다르면 파일을 넘기지 않는다', async () => {
  let calls = 0
  const h = harness(() => envelope({ ...access(), storageObjectId: ++calls === 1 ? 'object-one' : 'object-two' }))
  await rejects(() => h.server.download(scope.memberId, 'thread', 'message', ref), 'INVALID_RESPONSE')
  const wrong = harness(() => envelope(access()), { async download() { return new Blob([new Uint8Array([80, 75, 3, 4, 9, 9, 9])]) } })
  await rejects(() => wrong.server.download(scope.memberId, 'thread', 'message', ref), 'QUERY_FAILED')
})
await check('검사 HTTP는 작은 식별자만 전달하고 사용자 JWT 외 서버 키·Storage 경로를 보내지 않는다', async () => {
  let call
  const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: 'user' }, access_token: 'fake-jwt' }), fetch: async (url, options) => { call = { url, options }; return new Response(JSON.stringify(envelope(status('ready'))), { status: 200 }) } })
  await checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user')
  assert.equal(call.url, '/api/messages/check-hwpx'); assert.deepEqual(JSON.parse(call.options.body), { memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, 'Bearer fake-jwt')
})
await check('HTTP 설정 실패·HTML 오류·큰 응답·타임아웃은 파일 성공으로 해석하지 않는다', async () => {
  for (const response of [new Response('없음', { status: 404 }), new Response('<html>오류</html>', { status: 200 }), new Response('x'.repeat(17000), { status: 200 })]) {
    const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: 'user' }, access_token: 'fake' }), fetch: async () => response })
    await rejects(() => checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user'), 'RESULT_UNKNOWN')
  }
  const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: 'user' }, access_token: 'fake' }), fetch: async () => new Promise(() => {}), timeoutMs: 10 })
  await rejects(() => checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user'), 'RESULT_UNKNOWN')
})
await check('HTTP 응답 후 사용자가 달라지면 본문을 전달하지 않는다', async () => {
  let changed = false
  const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: changed ? 'other' : 'user' }, access_token: 'fake' }), fetch: async () => { changed = true; return new Response(JSON.stringify(envelope(status('ready')))) } })
  await rejects(() => checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user'), 'CANCELLED')
})
await check('첨부 예약 replay는 기존 payload를 유지하고 새 예약 금지 인자를 전달한다', async () => {
  const h = harness(base); await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  await h.server.prepare(scope.memberId, file(), policy, 'prepare-one', { replayOnly: true })
  assert.equal(h.calls[1].args.p_replay_only, true); assert.deepEqual(h.calls[0].args.p_file, h.calls[1].args.p_file)
})
await check('첨부 완료 이후 승인 조회 실패도 미확정 결과를 보존한다', async () => {
  let h
  h = harness(name => { if (name === 'workhub_message_file_complete') { h.revoke(); return envelope(status('ready')) } return base(name) })
  await h.server.prepare(scope.memberId, file(), policy, 'prepare-one')
  await rejects(() => h.server.complete(scope.memberId, ref.id, 'complete-one'), 'CANCELLED')
})
await check('서버 wrapper의 제한된 업무 오류 코드는 유지하고 임의 오류 본문은 숨긴다', async () => {
  for (const code of ['NOT_READY', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND']) {
    const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: 'user' }, access_token: 'fake' }), fetch: async () => new Response(JSON.stringify({ error: { code } }), { status: 503 }) })
    await rejects(() => checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user'), code)
  }
  const checker = m.createMessageFileCheck({ getSession: async () => ({ user: { id: 'user' }, access_token: 'fake' }), fetch: async () => new Response(JSON.stringify({ error: { code: 'NOT_READY', sql: '비밀' } }), { status: 503 }) })
  await rejects(() => checker.check({ memberId: 'teacher', fileId: ref.id, requestKey: 'check-one' }, 'user'), 'RESULT_UNKNOWN')
})
await check('첨부 완료 사전 조회가 늦게 풀려도 만료 뒤 RPC를 시작하지 않는다', async () => {
  const h = harness(base), server = m.createMessageFileServer(h.connection, { timeoutMs: 20 })
  let release
  h.connection.getIdentity = () => new Promise(resolve => { release = resolve })
  await rejects(() => server.complete(scope.memberId, ref.id, 'late-preflight'), 'RESULT_UNKNOWN')
  release({ userId: scope.userId, approved: true }); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(h.calls.length, 0)
})
for (const action of ['upload', 'check']) await check(`첨부 모듈 로딩이 만료 뒤 끝나도 ${action}을 시작하지 않는다`, async () => {
  let release, actions = 0
  const h = harness(base)
  // 실제 지연 import와 같은 Promise 경계를 만든다. 파일 전송 함수 자체는 호출 시 바로 계수한다.
  const port = { then(resolve) { release = () => resolve({ async upload() { actions++ }, async check() { actions++; return envelope(status('ready')) } }) } }
  const server = m.createMessageFileServer(h.connection, { port, timeoutMs: 25 })
  if (action === 'upload') {
    const reservation = await server.prepare(scope.memberId, file(), policy, 'prepare-late-port')
    await rejects(() => server.upload(scope.memberId, reservation, file()), 'RESULT_UNKNOWN')
  } else await rejects(() => server.complete(scope.memberId, ref.id, 'complete-late-port'), 'RESULT_UNKNOWN')
  assert.equal(typeof release, 'function'); release(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(actions, 0)
})
await check('첨부 완료가 서버에서 끝나고 응답만 늦으면 같은 완료 번호로 복구한다', async () => {
  let release, saved = 0
  const records = new Map()
  const h = harness((_, args) => {
    if (records.has(args.p_request_key)) return records.get(args.p_request_key)
    saved++; const result = envelope(status('ready')); records.set(args.p_request_key, result)
    return new Promise(resolve => { release = () => resolve(result) })
  }), server = m.createMessageFileServer(h.connection, { timeoutMs: 20 })
  await rejects(() => server.complete(scope.memberId, ref.id, 'late-complete'), 'RESULT_UNKNOWN')
  release(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await server.complete(scope.memberId, ref.id, 'late-complete')).state, 'ready')
  assert.equal(saved, 1); assert.deepEqual(h.calls[0].args, h.calls[1].args)
})
await check('prepare의 같은 학교·사용자 검증을 통과한 CONFLICT만 종료된 첨부로 구분한다', async () => {
  const raw = { contractVersion: 1, ...scope, ok: false, error: { code: 'CONFLICT' } }
  const h = harness(() => raw)
  await assert.rejects(() => h.server.prepare(scope.memberId, file(), policy, 'ended', { replayOnly: true }), error => error instanceof m.MessageFileReservationEndedError && error.code === 'CONFLICT')
  assert.equal(h.calls[0].args.p_replay_only, true); assert.equal(h.uploads.length, 0)
})
await check('다른 범위·추가 필드·운송 계층의 CONFLICT는 첨부 종료로 판단하지 않는다', async () => {
  const raw = { contractVersion: 1, ...scope, ok: false, error: { code: 'CONFLICT' } }
  for (const response of [{ ...raw, schoolId: 'other' }, { ...raw, userId: 'other' }, { ...raw, memberId: 'other' }, { ...raw, error: { code: 'CONFLICT', reason: 'extra' } }]) {
    const h = harness(() => response)
    await assert.rejects(() => h.server.prepare(scope.memberId, file(), policy, 'not-ended'), error => !(error instanceof m.MessageFileReservationEndedError) && error.code === 'RESULT_UNKNOWN')
  }
  const h = harness(() => { throw new m.MessagingError('CONFLICT') })
  await assert.rejects(() => h.server.prepare(scope.memberId, file(), policy, 'transport-conflict'), error => !(error instanceof m.MessageFileReservationEndedError) && error.code === 'CONFLICT')
})
await check('complete·status의 일반 CONFLICT는 종료된 예약 오류로 바꾸지 않는다', async () => {
  const h = harness(() => ({ contractVersion: 1, ...scope, ok: false, error: { code: 'CONFLICT' } }))
  for (const run of [() => h.server.complete(scope.memberId, ref.id, 'complete-conflict'), () => h.server.status(scope.memberId, ref.id)]) {
    await assert.rejects(run, error => !(error instanceof m.MessageFileReservationEndedError) && error.code === 'CONFLICT')
  }
})
await check('화면 재연결로 예약 캐시가 없어도 파일 원본과 조회한 ready 메타데이터를 대조한다', async () => {
  const h = harness(() => envelope(status('ready')))
  assert.equal((await h.server.status(scope.memberId, ref.id, { file: file(), policy })).state, 'ready')
  assert.deepEqual(h.calls.map(call => call.name), ['workhub_message_file_status'])
  for (const changed of [{ name: '다른파일.hwpx' }, { bytes: bytes.length + 1 }, { sha256: 'a'.repeat(64) }]) {
    const wrong = harness(() => envelope({ ...status('ready'), file: { ...ref, ...changed } }))
    await rejects(() => wrong.server.status(scope.memberId, ref.id, { file: file(), policy }), 'INVALID_RESPONSE')
  }
})
await check('복구 조회의 거절과 기한 만료는 파일을 성공 첨부하지 않고 terminal 상태 그대로 반환한다', async () => {
  const h = harness(() => envelope(status('rejected')))
  const result = await h.server.status(scope.memberId, ref.id, { file: file(), policy })
  assert.equal(result.state, 'rejected'); assert.equal(result.file, null); assert.equal(h.uploads.length, 0)
})
console.log(`메신저 HWPX 전용 첨부 ${count}건 통과`)


