import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

// 실제 학교 원문 어댑터를 실행하고 파일·신원·전송 지연만 합성한다. 실제 서비스는 호출하지 않는다.
const { createKnowledgeImportService, blobSha } = await loadBrowserModule(
  `export { createKnowledgeImportService } from '../apps/workhub/src/knowledge/import-adapter'; export { blobSha } from '../apps/workhub/src/documents/guided-adapter'`,
  { env: { MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon' } },
)
const member = { id: 'member', userId: 'user', schoolId: 'school', name: '가상 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const file = new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], '학교규정.hwpx', { type: 'application/hwp+zip' })
const bytes = await file.arrayBuffer(), hash = await blobSha(file)
const extraction = { profile: 'hwpx_text_v1', fileSha256: hash, extractionSha256: 'b'.repeat(64), blocks: [{ id: 'Contents/section0.xml:p000000', locator: 'Contents/section0.xml / 문단 1', text: '학교 규정의 확인한 원문' }], omittedObjects: 2 }
const result = { fileId: 'file', fileVersion: 1, name: file.name, extraction }
const envelope = data => ({ contract: 'knowledge-import.v1', schoolId: 'school', memberId: 'member', data })
const reserved = (uploaded = false) => envelope({ fileId: 'file', fileVersion: 1, bucket: 'workhub-knowledge-files', path: 'school/member/file/original.hwpx', bytes: file.size, sha256: hash, uploaded })
const access = () => envelope({ available: true, sourceId: 'source', sourceVersion: 3, fileId: 'file', fileVersion: 1, ownerMemberId: 'member', bucket: 'workhub-knowledge-files', path: 'school/member/file/original.hwpx', name: file.name, bytes: file.size, sha256: hash, extractionSha256: extraction.extractionSha256 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
async function fails(promise, code) {
  let timer
  try { await assert.rejects(Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('시간 제한이 적용되지 않았습니다.')), 1000) })]), error => error.code === code) }
  finally { clearTimeout(timer) }
}
function harness(timeoutMs = 40) {
  let current = structuredClone(member), identity = { userId: 'user', approved: true }, handler, identityHandler
  const calls = [], uploads = [], downloads = [], extracts = [], identities = []
  const connection = {
    info: () => ({ memberships: current ? [current] : [], schools: current ? [{ id: current.schoolId }] : [], basisDate: '2026-10-21' }),
    getIdentity: async () => { identities.push('identity'); return identityHandler ? identityHandler() : identity },
    rpcVerified: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return handler ? handler(name, args) : name === 'workhub_knowledge_original_access' ? access() : name === 'workhub_knowledge_file_extract_get' ? envelope(result) : reserved() },
  }
  const port = {
    async upload(path, value) { uploads.push({ path, value }) },
    async download(path) { downloads.push(path); return file },
    async extract(input, userId) { extracts.push({ input, userId }); return envelope(result) },
  }
  const service = createKnowledgeImportService(connection, port, { timeoutMs })
  return { service, port, calls, uploads, downloads, extracts, identities, respond(value) { handler = value }, changeMember(value) { current = value }, changeIdentity(value) { identity = value }, identityWith(value) { identityHandler = value } }
}
let passed = 0, failed = 0
async function test(name, run) {
  try { await run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.message) }
}

await test('정상 원문은 예약한 경로로 전송하고 원본 판·해시를 두 번 확인한 뒤 내려받는다', async () => {
  const h = harness(1000)
  assert.deepEqual(await h.service.prepare('member', file, 'prepare-original-key'), { fileId: 'file', fileVersion: 1, uploaded: false })
  await h.service.upload('member', 'file', file)
  assert.deepEqual(await h.service.extract('member', 'file', 'extract-original-key'), result)
  assert.deepEqual(await h.service.original('member', 'source', 3), { blob: file, name: file.name, fileVersion: 1 })
  assert.equal(h.uploads[0].path, 'school/member/file/original.hwpx')
  assert.deepEqual(h.extracts, [{ input: { memberId: 'member', fileId: 'file', requestKey: 'extract-original-key' }, userId: 'user' }])
  assert.deepEqual(h.calls.map(call => call.name), ['workhub_knowledge_file_prepare', 'workhub_knowledge_original_access', 'workhub_knowledge_original_access'])
})

await test('준비 전 파일 읽기가 멎으면 시간 초과 뒤 해시가 나와도 예약 RPC를 보내지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new File([bytes], file.name)
  slow.arrayBuffer = async () => gate.promise
  await fails(h.service.prepare('member', slow, 'prepare-original-key'), 'RESULT_UNKNOWN')
  assert.equal(h.calls.length, 0)
  gate.resolve(bytes); await settle()
  assert.equal(h.calls.length, 0)
})

await test('준비 전 신원 조회가 멎으면 늦은 성공 뒤 새 예약을 보내지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.prepare('member', file, 'prepare-original-key'), 'RESULT_UNKNOWN')
  gate.resolve(); await settle()
  assert.equal(h.calls.length, 0)
})

await test('늦은 예약 응답은 전송용 캐시에 들어가지 않고 같은 번호 조회로만 복구한다', async () => {
  const h = harness(), gate = deferred()
  h.respond(async () => gate.promise)
  await fails(h.service.prepare('member', file, 'prepare-original-key'), 'RESULT_UNKNOWN')
  gate.resolve(reserved()); await settle()
  await fails(h.service.upload('member', 'file', file), 'INVALID_INPUT')
  assert.equal(h.uploads.length, 0)
  h.respond(name => name === 'workhub_knowledge_file_prepare_get' ? reserved(true) : envelope(result))
  assert.equal((await h.service.prepare('member', file, 'prepare-original-key', true)).uploaded, true)
  assert.deepEqual(await h.service.extract('member', 'file', 'extract-original-key', true), result)
  assert.deepEqual(h.calls.map(call => call.name), ['workhub_knowledge_file_prepare', 'workhub_knowledge_file_prepare_get', 'workhub_knowledge_file_extract_get'])
  assert.equal(h.calls[1].args.p_request_key, 'prepare-original-key')
  assert.equal(h.calls[2].args.p_request_key, 'extract-original-key')
  assert.equal(h.extracts.length, 0)
})

await test('예약 후 신원 확인 지연도 완료된 예약으로 표시하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { if (h.identities.length > 1) await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.prepare('member', file, 'prepare-original-key'), 'RESULT_UNKNOWN')
  gate.resolve(); await settle()
  await fails(h.service.upload('member', 'file', file), 'INVALID_INPUT')
  assert.equal(h.calls.length, 1)
  assert.equal(h.uploads.length, 0)
})

await test('업로드 응답이 멎으면 결과 미상으로 풀리고 늦은 완료 뒤 신원을 다시 조회하지 않는다', async () => {
  const h = harness(), gate = deferred()
  await h.service.prepare('member', file, 'prepare-original-key')
  let sent = false
  h.port.upload = async () => { sent = true; await gate.promise }
  await fails(h.service.upload('member', 'file', file), 'RESULT_UNKNOWN')
  assert.equal(sent, true)
  const count = h.identities.length
  gate.resolve(); await settle()
  assert.equal(h.identities.length, count)
  assert.equal(h.calls.length, 1)
})

await test('업로드 전 파일 읽기 지연은 시간 초과 뒤 Storage 전송을 시작하지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new File([bytes], file.name)
  await h.service.prepare('member', file, 'prepare-original-key')
  slow.arrayBuffer = async () => gate.promise
  await fails(h.service.upload('member', 'file', slow), 'RESULT_UNKNOWN')
  gate.resolve(bytes); await settle()
  assert.equal(h.uploads.length, 0)
})

await test('업로드 전 신원 조회 지연은 시간 초과 뒤 전송을 시작하지 않는다', async () => {
  const h = harness(), gate = deferred()
  await h.service.prepare('member', file, 'prepare-original-key')
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.upload('member', 'file', file), 'RESULT_UNKNOWN')
  gate.resolve(); await settle()
  assert.equal(h.uploads.length, 0)
})

await test('추출 전 신원 조회가 멎으면 시간 초과 뒤 HTTP 호출을 시작하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.extract('member', 'file', 'extract-original-key'), 'RESULT_UNKNOWN')
  gate.resolve(); await settle()
  assert.equal(h.extracts.length, 0)
  assert.equal(h.calls.length, 0)
})

await test('추출 HTTP 지연은 늦은 응답을 닫고 원래 번호의 읽기 조회로 복구한다', async () => {
  const h = harness(), gate = deferred()
  let sent = 0
  h.port.extract = async () => { sent++; return gate.promise }
  await fails(h.service.extract('member', 'file', 'extract-original-key'), 'RESULT_UNKNOWN')
  assert.equal(sent, 1)
  const count = h.identities.length
  gate.resolve(envelope(result)); await settle()
  assert.equal(h.identities.length, count)
  assert.deepEqual(await h.service.extract('member', 'file', 'extract-original-key', true), result)
  assert.equal(sent, 1)
  assert.deepEqual(h.calls.map(call => call.name), ['workhub_knowledge_file_extract_get'])
  assert.equal(h.calls[0].args.p_request_key, 'extract-original-key')
})

await test('추출 뒤 신원 조회 지연은 결과를 확정하지 않고 같은 번호 조회를 유지한다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { if (h.identities.length > 1) await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.extract('member', 'file', 'extract-original-key'), 'RESULT_UNKNOWN')
  assert.equal(h.extracts.length, 1)
  gate.resolve(); await settle()
  h.identityWith(undefined)
  assert.deepEqual(await h.service.extract('member', 'file', 'extract-original-key', true), result)
  assert.equal(h.extracts.length, 1)
  assert.equal(h.calls[0].args.p_request_key, 'extract-original-key')
})

await test('추출 대기 중 계정이 바뀌면 이전 계정 결과를 돌려주지 않는다', async () => {
  const h = harness(1000)
  h.port.extract = async () => { h.changeIdentity({ userId: 'other-user', approved: true }); return envelope(result) }
  await fails(h.service.extract('member', 'file', 'extract-original-key'), 'CANCELLED')
})

await test('추출 대기 중 학교 또는 소속 역할이 바뀌면 결과를 확정하지 않는다', async () => {
  for (const current of [{ ...member, schoolId: 'other-school' }, { ...member, role: 'admin' }, null]) {
    const h = harness(1000)
    h.port.extract = async () => { h.changeMember(current); return envelope(result) }
    await fails(h.service.extract('member', 'file', 'extract-original-key'), 'CANCELLED')
    assert.equal(h.calls.length, 0)
  }
})

await test('학교가 바뀌면 이전 학교의 예약을 재사용해 업로드하지 않는다', async () => {
  const h = harness(1000)
  await h.service.prepare('member', file, 'prepare-original-key')
  h.changeMember({ ...member, schoolId: 'other-school' })
  await fails(h.service.upload('member', 'file', file), 'INVALID_INPUT')
  assert.equal(h.uploads.length, 0)
})

await test('원본 다운로드 전 신원 조회 지연은 접근 RPC와 Storage를 시작하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.original('member', 'source', 3), 'QUERY_FAILED')
  gate.resolve(); await settle()
  assert.equal(h.calls.length, 0)
  assert.equal(h.downloads.length, 0)
})

await test('원본 첫 접근 응답이 늦으면 만료 후 Storage를 시작하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.respond(async () => gate.promise)
  await fails(h.service.original('member', 'source', 3), 'QUERY_FAILED')
  gate.resolve(access()); await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.downloads.length, 0)
})

await test('원본 다운로드가 멎으면 늦은 파일 뒤 두 번째 접근 RPC를 보내지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.port.download = async () => gate.promise
  await fails(h.service.original('member', 'source', 3), 'QUERY_FAILED')
  assert.equal(h.calls.length, 1)
  gate.resolve(file); await settle()
  assert.equal(h.calls.length, 1)
})

await test('다운로드한 원본의 해시 읽기가 멎으면 늦은 결과로 접근 RPC를 보내지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new Blob([bytes])
  slow.arrayBuffer = async () => gate.promise
  h.port.download = async () => slow
  await fails(h.service.original('member', 'source', 3), 'QUERY_FAILED')
  gate.resolve(bytes); await settle()
  assert.equal(h.calls.length, 1)
})

await test('원본 재확인 RPC가 멎으면 내려받은 파일을 성공 결과로 반환하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.respond(async () => h.calls.length === 1 ? access() : gate.promise)
  await fails(h.service.original('member', 'source', 3), 'QUERY_FAILED')
  assert.equal(h.downloads.length, 1)
  assert.equal(h.calls.length, 2)
  gate.resolve(access()); await settle()
  assert.equal(h.calls.length, 2)
})

await test('같은 크기의 변조 원본은 해시 검사에서 거절하고 재확인 RPC를 보내지 않는다', async () => {
  const h = harness(1000)
  h.port.download = async () => new Blob([new Uint8Array(file.size)])
  await fails(h.service.original('member', 'source', 3), 'CONFLICT')
  assert.equal(h.calls.length, 1)
})

await test('다운로드 중 원본 판이 바뀌면 파일을 반환하지 않는다', async () => {
  const h = harness(1000)
  h.respond(() => { const value = access(); if (h.calls.length > 1) value.data.fileVersion = 2; return value })
  await fails(h.service.original('member', 'source', 3), 'CONFLICT')
  assert.equal(h.calls.length, 2)
})

await test('다운로드 중 학교·소속·역할이 바뀌면 이전 파일을 새 범위에서 재조회하지 않는다', async () => {
  for (const current of [{ ...member, schoolId: 'other-school' }, { ...member, role: 'admin' }, null]) {
    const h = harness(1000)
    h.port.download = async () => { h.changeMember(current); return file }
    await fails(h.service.original('member', 'source', 3), 'CANCELLED')
    assert.equal(h.calls.length, 1)
  }
})

await test('다운로드 중 계정이 바뀌면 두 번째 접근 RPC 전에 닫는다', async () => {
  const h = harness(1000)
  h.port.download = async () => { h.changeIdentity({ userId: 'other-user', approved: true }); return file }
  await fails(h.service.original('member', 'source', 3), 'CANCELLED')
  assert.equal(h.calls.length, 1)
})

await test('파일 없는 자료는 null로 표시하고 다운로드 성공이나 추출 성공으로 만들지 않는다', async () => {
  const h = harness(1000)
  h.respond(() => envelope({ available: false }))
  assert.equal(await h.service.original('member', 'source', 3), null)
  assert.equal(h.downloads.length, 0)
  assert.equal(h.extracts.length, 0)
})

await test('전송·추출·다운로드의 외부 오류 내용은 사용자 오류에 노출하지 않는다', async () => {
  for (const operation of ['upload', 'extract', 'original']) {
    const h = harness(1000)
    await h.service.prepare('member', file, 'prepare-original-key')
    h.port[operation === 'original' ? 'download' : operation] = async () => { throw new Error('private-storage-path-secret') }
    const promise = operation === 'upload' ? h.service.upload('member', 'file', file) : operation === 'extract' ? h.service.extract('member', 'file', 'extract-original-key') : h.service.original('member', 'source', 3)
    await assert.rejects(promise, error => error.code === (operation === 'original' ? 'QUERY_FAILED' : 'RESULT_UNKNOWN') && !error.message.includes('private-storage-path-secret'))
  }
})

console.log(`\n학교 원문 HWPX Storage 연결: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
