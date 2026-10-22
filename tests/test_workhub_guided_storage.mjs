import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

// 실제 질문형 문서 어댑터를 실행하고 네트워크·Storage 경계만 가상 교사 자료로 대신한다.
const { createGuidedService, blobSha } = await loadBrowserModule(
  `export { createGuidedService, blobSha } from '../apps/workhub/src/documents/guided-adapter'`,
  { env: { MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon' } },
)
const member = { id: 'member', userId: 'user', schoolId: 'school', name: '가상 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const file = new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], '양식.hwpx', { type: 'application/hwp+zip' })
const bytes = await file.arrayBuffer(), hash = await blobSha(file)
const artifact = { artifactId: 'artifact', templateId: 'template', templateVersion: 1, responseId: 'response', responseVersion: 1, bytes: file.size, sha256: hash }
const envelope = data => ({ contract: 'guided.v1', schoolId: 'school', memberId: 'member', data })
const access = () => envelope({ artifact, bucket: 'workhub-document-files', path: 'school/member/artifact/output.hwpx', ownerMemberId: 'member' })
const reserved = uploaded => envelope({ templateId: 'template', templateVersion: 1, bucket: 'workhub-document-files', path: 'school/member/template/source.hwpx', bytes: file.size, sha256: hash, uploaded })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
async function fails(promise, code) {
  let timer
  try {
    await assert.rejects(Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('시간 제한이 적용되지 않았습니다.')), 1000) })]), error => error.code === code)
  } finally { clearTimeout(timer) }
}
function harness(timeoutMs = 40) {
  let current = structuredClone(member), identity = { userId: 'user', approved: true }, handler, identityHandler
  const calls = [], uploads = [], downloads = [], identities = []
  const connection = {
    info: () => ({ memberships: current ? [current] : [], schools: current ? [{ id: current.schoolId }] : [], basisDate: '2026-10-21' }),
    getIdentity: async () => { identities.push('identity'); return identityHandler ? identityHandler() : identity },
    rpcVerified: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return handler ? handler(name, args) : name === 'workhub_document_artifact_access' ? access() : reserved(false) },
  }
  const port = {
    async upload(path, value) { uploads.push({ path, value }) },
    async download(path) { downloads.push(path); return file },
    async run() { throw new Error('파일 전송 시험에서 분석·생성을 새로 호출하지 않습니다.') },
  }
  const service = createGuidedService(connection, port, { timeoutMs })
  return { service, port, calls, uploads, downloads, identities, respond(value) { handler = value }, changeMember(value) { current = value }, changeIdentity(value) { identity = value }, identityWith(value) { identityHandler = value } }
}
let passed = 0, failed = 0
async function test(name, run) {
  try { await run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.message) }
}

await test('정상 준비·업로드는 원래 예약 경로를 사용하며 파일 검사 완료로 표시하지 않는다', async () => {
  const h = harness(1000)
  const result = await h.service.prepare('member', file, '수합 양식', 'prepare-original-key')
  await h.service.upload('member', result.templateId, file)
  assert.equal(h.uploads.length, 1)
  assert.equal(h.uploads[0].path, 'school/member/template/source.hwpx')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].args.p_request_key, 'prepare-original-key')
})

await test('업로드 응답이 멎으면 결과 미상으로 풀리고 늦은 완료 뒤 후속 검사를 진행하지 않는다', async () => {
  const h = harness(), gate = deferred()
  await h.service.prepare('member', file, '수합 양식', 'prepare-original-key')
  let sent = false
  h.port.upload = async () => { sent = true; await gate.promise }
  await fails(h.service.upload('member', 'template', file), 'RESULT_UNKNOWN')
  assert.equal(sent, true)
  const identityCount = h.identities.length, callCount = h.calls.length
  gate.resolve(); await settle()
  assert.equal(h.identities.length, identityCount)
  assert.equal(h.calls.length, callCount)
})

await test('미상 업로드 뒤 원래 예약 번호와 검사 번호로 기존 결과를 조회한다', async () => {
  const h = harness(), gate = deferred()
  await h.service.prepare('member', file, '수합 양식', 'prepare-original-key')
  h.port.upload = async () => gate.promise
  await fails(h.service.upload('member', 'template', file), 'RESULT_UNKNOWN')
  h.respond(name => name === 'workhub_template_prepare_get' ? reserved(true) : envelope(artifact))
  const recovered = await h.service.prepare('member', file, '수합 양식', 'prepare-original-key', true)
  assert.equal(recovered.uploaded, true)
  await h.service.recoverOperation('member', { action: 'render', templateId: 'template', templateVersion: 1, responseId: 'response', responseVersion: 1, requestKey: 'render-original-key' })
  assert.deepEqual(h.calls.map(call => call.name), ['workhub_template_prepare', 'workhub_template_prepare_get', 'workhub_template_operation_get'])
  assert.equal(h.calls[1].args.p_request_key, 'prepare-original-key')
  assert.equal(h.calls[2].args.p_operation.requestKey, 'render-original-key')
  gate.resolve(); await settle()
  assert.equal(h.calls.length, 3)
})

await test('준비 전 파일 읽기가 멎으면 늦은 해시 결과로 새 예약을 만들지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new File([bytes], file.name, { type: file.type })
  slow.arrayBuffer = async () => gate.promise
  await fails(h.service.prepare('member', slow, '수합 양식', 'prepare-original-key'), 'RESULT_UNKNOWN')
  assert.equal(h.calls.length, 0)
  gate.resolve(bytes); await settle()
  assert.equal(h.calls.length, 0)
})

await test('업로드 전 파일 재확인 시간 초과는 늦은 Storage 전송을 만들지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new File([bytes], file.name, { type: file.type })
  await h.service.prepare('member', file, '수합 양식', 'prepare-original-key')
  slow.arrayBuffer = async () => gate.promise
  await fails(h.service.upload('member', 'template', slow), 'RESULT_UNKNOWN')
  gate.resolve(bytes); await settle()
  assert.equal(h.uploads.length, 0)
  assert.equal(h.calls.length, 1)
})

await test('다운로드가 멎으면 읽기 실패로 풀리고 늦은 파일을 다시 접근 조회하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.port.download = async () => gate.promise
  await fails(h.service.download('member', 'artifact'), 'QUERY_FAILED')
  assert.equal(h.calls.filter(call => call.name === 'workhub_document_artifact_access').length, 1)
  gate.resolve(file); await settle()
  assert.equal(h.calls.filter(call => call.name === 'workhub_document_artifact_access').length, 1)
})

await test('다운로드 뒤 파일 읽기가 멎으면 늦은 해시 뒤 권한 조회를 진행하지 않는다', async () => {
  const h = harness(), gate = deferred(), slow = new Blob([bytes])
  slow.arrayBuffer = async () => gate.promise
  h.port.download = async () => slow
  await fails(h.service.download('member', 'artifact'), 'QUERY_FAILED')
  gate.resolve(bytes); await settle()
  assert.equal(h.calls.filter(call => call.name === 'workhub_document_artifact_access').length, 1)
})

await test('정상 생성 파일은 크기·해시와 두 번째 접근 결과를 확인한 뒤 반환한다', async () => {
  const h = harness(1000)
  assert.equal(await h.service.download('member', 'artifact'), file)
  assert.deepEqual(h.downloads, ['school/member/artifact/output.hwpx'])
  assert.equal(h.calls.filter(call => call.name === 'workhub_document_artifact_access').length, 2)
})

await test('같은 크기의 변조 파일은 수합으로 전달할 수 없다', async () => {
  const h = harness(1000)
  h.port.download = async () => new Blob([new Uint8Array(file.size)])
  await fails(h.service.download('member', 'artifact'), 'CONFLICT')
  assert.equal(h.calls.filter(call => call.name === 'workhub_document_artifact_access').length, 1)
})

await test('파일 읽는 동안 계정이 바뀌면 이전 계정 파일을 반환하지 않는다', async () => {
  const h = harness(1000)
  h.port.download = async () => { h.changeIdentity({ userId: 'other-user', approved: true }); return file }
  await fails(h.service.download('member', 'artifact'), 'CANCELLED')
})

await test('파일 읽는 동안 학교 소속이 없어지면 이전 학교 파일을 반환하지 않는다', async () => {
  const h = harness(1000)
  h.port.download = async () => { h.changeMember(null); return file }
  await assert.rejects(h.service.download('member', 'artifact'), error => ['CANCELLED', 'INACTIVE_MEMBERSHIP'].includes(error.code))
})

await test('같은 소속 번호의 역할이 바뀌어도 다운로드 시작 범위를 이어 쓰지 않는다', async () => {
  const h = harness(1000)
  h.port.download = async () => { h.changeMember({ ...member, role: 'admin' }); return file }
  await fails(h.service.download('member', 'artifact'), 'CANCELLED')
  assert.equal(h.calls.length, 1)
})

await test('같은 소속 번호의 학교가 바뀌면 새 학교 접근으로 재해석하지 않는다', async () => {
  const h = harness(1000)
  h.port.download = async () => { h.changeMember({ ...member, schoolId: 'other-school' }); return file }
  await fails(h.service.download('member', 'artifact'), 'CANCELLED')
  assert.equal(h.calls.length, 1)
})

await test('늦은 준비 응답이 와도 만료된 예약으로 후속 업로드하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.respond(async () => gate.promise)
  await fails(h.service.prepare('member', file, '수합 양식', 'prepare-original-key'), 'RESULT_UNKNOWN')
  gate.resolve(reserved(false)); await settle()
  await fails(h.service.upload('member', 'template', file), 'INVALID_INPUT')
  assert.equal(h.uploads.length, 0)
})

await test('준비 신원 조회가 제한시간 뒤 끝나도 새 예약 RPC를 보내지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.prepare('member', file, '수합 양식', 'prepare-original-key'), 'RESULT_UNKNOWN')
  assert.equal(h.calls.length, 0)
  gate.resolve(); await settle()
  assert.equal(h.calls.length, 0)
  assert.equal(h.uploads.length, 0)
})

await test('다운로드 신원 조회가 제한시간 뒤 끝나도 접근 RPC와 Storage를 시작하지 않는다', async () => {
  const h = harness(), gate = deferred()
  h.identityWith(async () => { await gate.promise; return { userId: 'user', approved: true } })
  await fails(h.service.download('member', 'artifact'), 'QUERY_FAILED')
  assert.equal(h.calls.length, 0)
  gate.resolve(); await settle()
  assert.equal(h.calls.length, 0)
  assert.equal(h.downloads.length, 0)
})

await test('다운로드 오류는 내부 경로를 노출하지 않는 읽기 오류로 반환한다', async () => {
  const h = harness(1000)
  h.port.download = async () => { throw new Error('private-storage-path-secret') }
  await assert.rejects(h.service.download('member', 'artifact'), error => error.code === 'QUERY_FAILED' && !error.message.includes('private-storage-path-secret'))
})

console.log(`\n질문형 HWPX Storage 연결: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1

