import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// SDK 경계만 바꿔 실제 공용 Storage 래퍼와 실제 인증 연결을 함께 실행한다.
const storageCalls = []
let uploadResult = async () => ({ data: {}, error: null }), downloadResult = async () => ({ data: null, error: null })
globalThis.__collectionStorageMock = { storage: { from(bucket) { return { async upload(path, file, options) { storageCalls.push({ kind: 'upload', bucket, path, file, options }); return uploadResult() }, async download(path) { storageCalls.push({ kind: 'download', bucket, path }); return downloadResult() } } } } }
const built = await build({
  stdin: { contents: `export { legacyStorage } from '../apps/workhub/src/collections/legacy-storage'; export { createSupabaseCollectionServer } from '../apps/workhub/src/collections/supabase-collections'; export { createSupabaseConnection } from '../apps/workhub/src/connection/supabase-connection'`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', define: { 'import.meta.env': '{}' },
  plugins: [{ name: '공용-SDK-시험-경계', setup(builder) {
    builder.onResolve({ filter: /^@daedong\/shared$/ }, () => ({ path: 'shared', namespace: 'storage-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'storage-test' }, () => ({ contents: `export const supabase = globalThis.__collectionStorageMock; const unavailable = () => { throw Error('제공한 LegacyServices만 사용해야 합니다') }; export const getSession = unavailable, fetchMyProfile = unavailable, onAuthStateChange = unavailable, signInWithGoogle = unavailable, signOut = unavailable;`, loader: 'js' }))
  } }],
})
const { legacyStorage, createSupabaseCollectionServer, createSupabaseConnection } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
let passed = 0, failed = 0
const test = async (name, run) => { try { storageCalls.length = 0; uploadResult = async () => ({ data: {}, error: null }); downloadResult = async () => ({ data: null, error: null }); await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.message}`) } }
const fails = (run, code) => assert.rejects(async () => run(), error => error.code === code)
const file = new File(['%PDF-1.7\n원본'], '자료.pdf', { type: 'application/pdf' })
const policy = { extensions: ['pdf'], maxFileBytes: 1024, maxFiles: 3 }
const envelope = data => ({ contractVersion: 1, schoolId: 'school', memberId: 'member', data })
const intent = { fileId: 'file', bucket: 'workhub-collection-files', path: 'school/file/0123456789abcdef', expiresAt: '2099-01-01T00:00:00Z', state: 'awaiting_upload' }
const parent = { kind: 'template', requestId: 'request', version: 1 }
const ref = { id: 'file', name: file.name, extension: 'pdf', bytes: file.size, sha256: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex') }
async function connected(options = {}) {
  let userId = 'user', active = true, sessionFailure = false
  let rpc = async () => ({ data: envelope({ available: true, reason: 'ready', policy }), error: null })
  const calls = []
  const context = { schools: [{ id: 'school', name: '학교' }], memberships: [{ id: 'member', schoolId: 'school', userId: 'user', name: '교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }], basisDate: '2026-10-15', schoolLabels: { school: { departmentIds: [], gradeIds: [], subjectIds: [] } } }
  const services = {
    async getSession() { if (sessionFailure) throw Error('세션 원시 오류'); return userId ? { user: { id: userId } } : null },
    async fetchMyProfile(id) { return { id, name: '교사', email: 'test@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: active } },
    onAuthStateChange() { return () => {} }, async signInWithGoogle() {}, async signOut() {},
    async rpc(name, args) { calls.push({ name, args }); if (name === 'workhub_context') return { data: structuredClone(context), error: null }; return rpc(name, args) },
  }
  const connection = createSupabaseConnection(services)
  await connection.loadContext('school')
  const server = createSupabaseCollectionServer(connection, { timeoutMs: 100, ...options })
  return { connection, server, calls, respond(fn) { rpc = fn }, user(value) { userId = value }, active(value) { active = value }, sessionFailure(value) { sessionFailure = value } }
}

await test('공용 Storage는 비공개 원본을 덮어쓰지 않고 캐시를 허용하지 않음', async () => {
  await legacyStorage.upload(intent.bucket, intent.path, file)
  assert.deepEqual(storageCalls[0], { kind: 'upload', bucket: intent.bucket, path: intent.path, file, options: { upsert: false, cacheControl: '0', contentType: 'application/pdf' } })
})
await test('Storage의 업로드 오류는 원시 오류 대신 결과 불명으로 전달', async () => {
  uploadResult = async () => ({ data: null, error: { message: 'internal bucket and path detail' } })
  await assert.rejects(() => legacyStorage.upload(intent.bucket, intent.path, file), error => error.code === 'RESULT_UNKNOWN' && !error.message.includes('internal'))
})
await test('실제 SDK 경계의 내려받기는 Blob만 성공으로 인정', async () => {
  for (const value of [null, {}, 'url']) { downloadResult = async () => ({ data: value, error: null }); await fails(() => legacyStorage.download(intent.bucket, intent.path), 'FILE_FAILED') }
  downloadResult = async () => ({ data: file, error: { message: 'denied' } }); await fails(() => legacyStorage.download(intent.bucket, intent.path), 'FILE_FAILED')
  downloadResult = async () => ({ data: file, error: null }); assert.equal(await legacyStorage.download(intent.bucket, intent.path), file)
})
await test('실제 인증 연결로 준비 RPC 응답 범위를 확인', async () => { const s = await connected(); assert.deepEqual(await s.server.readiness('member'), { available: true, reason: 'ready', policy }); assert.equal(s.connection.info().memberships[0].id, 'member') })
await test('실제 rpcVerified의 PGRST202는 연결 실패이며 기존 컨텍스트를 거짓 초기화하지 않음', async () => { const s = await connected(); s.respond(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })); await fails(() => s.server.readiness('member'), 'QUERY_FAILED'); assert.equal(s.connection.info().memberships.length, 1) })
await test('업무 거부 봉투는 실제 인증 연결에서도 확정 충돌로 전달', async () => { const s = await connected(); s.respond(async () => ({ data: { contractVersion: 1, schoolId: 'school', memberId: 'member', error: { code: 'CONFLICT' } }, error: null })); await fails(() => s.server.mutate('member', { kind: 'publish', requestId: 'request', expectedVersion: 1 }, 'retry-key'), 'CONFLICT') })
await test('실제 승인 회수는 기존 인증 연결이 캐시를 비우고 수합 응답도 폐기', async () => { const s = await connected(); s.active(false); await fails(() => s.server.list('member'), 'CANCELLED'); assert.deepEqual(s.connection.info().memberships, []) })
await test('기존 RPC 권한 예외는 연결 캐시를 무효화하고 자료를 전달하지 않음', async () => { const s = await connected(); s.respond(async () => ({ data: null, error: { message: 'FORBIDDEN' } })); await fails(() => s.server.list('member'), 'CANCELLED'); assert.deepEqual(s.connection.info().memberships, []) })
await test('실제 연결에서 늦은 성공과 통신 거절 모두 계정 변경을 감지', async () => { for (const rejecting of [false, true]) { const s = await connected(); s.respond(async () => { s.user('other'); if (rejecting) throw Error('old RPC rejection'); return { data: envelope({ items: [], nextCursor: null }), error: null } }); await fails(() => s.server.list('member'), 'CANCELLED'); assert.deepEqual(s.connection.info().memberships, []) } })
await test('실제 연결의 세션 조회 실패는 이전 학교 자료를 반환하지 않음', async () => { const s = await connected(); s.respond(async () => { s.sessionFailure(true); return { data: envelope({ items: [], nextCursor: null }), error: null } }); await fails(() => s.server.list('member'), 'CANCELLED'); assert.deepEqual(s.connection.info().memberships, []) })
await test('기본 Storage 포트까지 연결한 업로드 성공도 ready 선언 없이 완료', async () => { const s = await connected(); s.respond(async () => ({ data: envelope(intent), error: null })); const issued = await s.server.prepareUpload('member', parent, file, policy, 'prepare-key'); assert.equal(await s.server.upload('member', issued, file), undefined); assert.equal(storageCalls[0].options.upsert, false) })
await test('SDK가 예외를 던져도 어댑터는 경로 노출 없이 업로드 결과 불명', async () => { const s = await connected(); s.respond(async () => ({ data: envelope(intent), error: null })); const issued = await s.server.prepareUpload('member', parent, file, policy, 'prepare-key'); uploadResult = async () => { throw Error('internal storage object path') }; await assert.rejects(() => s.server.upload('member', issued, file), error => error.code === 'RESULT_UNKNOWN' && !error.message.includes('internal')) })
await test('실제 Storage 포트의 응답 단절은 타임아웃 후 같은 파일 상태 재확인 가능', async () => { const s = await connected({ timeoutMs: 15 }); s.respond(async name => ({ data: name === 'workhub_file_prepare' ? envelope(intent) : envelope({ fileId: 'file', state: 'ready', file: ref }), error: null })); const issued = await s.server.prepareUpload('member', parent, file, policy, 'prepare-key'); uploadResult = () => new Promise(() => {}); await fails(() => s.server.upload('member', issued, file), 'RESULT_UNKNOWN'); assert.deepEqual((await s.server.fileStatus('member', 'file')).file, ref) })
await test('기본 내려받기 포트와 실제 인증으로 원문 무결성·권한 재확인', async () => { const s = await connected(); s.respond(async () => ({ data: envelope({ file: ref, bucket: intent.bucket, path: intent.path }), error: null })); downloadResult = async () => ({ data: file, error: null }); assert.equal(await s.server.download('member', parent, ref), file); assert.equal(s.calls.filter(call => call.name === 'workhub_file_access').length, 2) })
console.log(`\n문서 수합 실제 인증·Storage 경계: ${passed}개 통과, ${failed}개 실패`)
delete globalThis.__collectionStorageMock
if (failed) process.exitCode = 1
