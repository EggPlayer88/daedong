import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { runReadinessCheck, exportReport, fixtureData, relationLabels } = await loadBrowserModule(`
  export { runReadinessCheck, exportReport } from '../apps/workhub/src/connection/readiness.ts'
  export { fixtureData, relationLabels } from '../apps/workhub/src/preview/fixtures.ts'
`)
const userId = 'fixture-soyeon'
const profile = { id: userId, name: '합성 관리자', email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true }
const context = () => ({ ...structuredClone(fixtureData), schoolLabels: Object.fromEntries(fixtureData.schools.map(school => [school.id, relationLabels])) })
function fake(overrides = {}) {
  const calls = []
  const services = {
    async getSession() { calls.push('session'); return { user: { id: userId }, access_token: 'synthetic-secret-token' } },
    async fetchMyProfile(id) { calls.push('profile'); assert.equal(id, userId); return structuredClone(profile) },
    async rpc(name, args) { calls.push(name); assert.equal(name, 'workhub_context'); assert.equal(args, undefined); return { data: context(), error: null } },
    onAuthStateChange() { throw new Error('진단 중 인증 구독 금지') },
    signInWithGoogle() { throw new Error('진단 중 로그인 금지') },
    signOut() { throw new Error('진단 중 로그아웃 금지') },
    ...overrides,
  }
  return { services, calls }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let failed = 0
async function test(name, run) { try { await run(); console.log(`  ✓ ${name}`) } catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) } }
function resultIs(result, stage, code, count = 0) {
  assert.equal(result.stage, stage); assert.equal(result.code, code); assert.equal(result.readySchoolCount, count)
  assert.equal(new Date(result.checkedAt).toISOString(), result.checkedAt)
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'code', 'readySchoolCount', 'stage'])
}

await test('기존 승인 최고관리자의 본인 활성 학교만 읽어 확인하며 세션을 전후 재검증한다', async () => {
  const { services, calls } = fake()
  resultIs(await runReadinessCheck(services), 'ready', 'CONTEXT_READY', 2)
  assert.deepEqual(calls, ['session', 'profile', 'session', 'workhub_context', 'session'])
})
await test('로그아웃 상태는 프로필과 학교 RPC를 호출하지 않는다', async () => {
  const { services, calls } = fake({ getSession: async () => null })
  resultIs(await runReadinessCheck(services), 'logged_out', 'SESSION_ABSENT')
  assert.deepEqual(calls, [])
})
await test('프로필 없음과 기존 승인 대기를 구별하며 학교 RPC를 호출하지 않는다', async () => {
  for (const [raw, stage, code] of [[null, 'profile_missing', 'PROFILE_ABSENT'], [{ ...profile, is_active: false }, 'pending', 'APPROVAL_PENDING']]) {
    const { services, calls } = fake({ fetchMyProfile: async () => raw })
    resultIs(await runReadinessCheck(services), stage, code)
    assert.deepEqual(calls, ['session', 'session'])
  }
})
await test('승인된 일반 교사와 관리자도 최고관리자가 아니면 학교 진단을 진행하지 않는다', async () => {
  for (const role of ['teacher', 'admin', 'SUPERADMIN']) {
    const { services, calls } = fake({ fetchMyProfile: async () => ({ ...profile, role }) })
    resultIs(await runReadinessCheck(services), 'forbidden', 'SUPERADMIN_REQUIRED')
    assert(!calls.includes('workhub_context'))
  }
})
await test('누락되거나 손상된 서비스 연결과 진단 옵션은 네트워크 호출 전에 거부한다', async () => {
  for (const services of [null, undefined, {}, { getSession: 'bad' }]) resultIs(await runReadinessCheck(services), 'invalid_configuration', 'INVALID_CONFIGURATION')
  for (const options of [null, [], { timeoutMs: null }, { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: NaN }, { timeoutMs: 60_001 }, { timeoutMs: '1' }, { signal: {} }]) {
    const { services, calls } = fake()
    resultIs(await runReadinessCheck(services, options), 'invalid_configuration', 'INVALID_OPTIONS')
    assert.deepEqual(calls, [])
  }
})
await test('깨진 세션 응답은 로그아웃이나 설정 없음으로 오인하지 않는다', async () => {
  for (const value of [undefined, {}, { user: null }, { user: { id: '' } }, { user: { id: 1 } }]) {
    const { services } = fake({ getSession: async () => value })
    resultIs(await runReadinessCheck(services), 'unavailable', 'SESSION_INVALID')
  }
})
await test('세션과 프로필 읽기 장애는 원문 없이 단계별 불가 상태를 반환한다', async () => {
  const session = fake({ getSession: async () => { throw new Error('synthetic-secret-token@example.invalid') } })
  resultIs(await runReadinessCheck(session.services), 'unavailable', 'SESSION_READ_FAILED')
  const profileRead = fake({ fetchMyProfile: async () => { throw new Error('missing configuration') } })
  resultIs(await runReadinessCheck(profileRead.services), 'unavailable', 'PROFILE_READ_FAILED')
  assert(!profileRead.calls.includes('workhub_context'))
})
await test('다른 사용자 프로필이나 승인 필드 손상은 권한을 부여하지 않는다', async () => {
  for (const value of [{ ...profile, id: 'other-user' }, { ...profile, is_active: 'true' }, { ...profile, email: null }, undefined]) {
    const { services, calls } = fake({ fetchMyProfile: async () => value })
    resultIs(await runReadinessCheck(services), 'unavailable', 'PROFILE_INVALID')
    assert(!calls.includes('workhub_context'))
  }
})
await test('프로필 응답 중 계정 변경 또는 로그아웃은 학교 조회 전에 결과를 폐기한다', async () => {
  for (const after of [null, { user: { id: 'other-user' } }]) {
    let sessions = 0
    const { services, calls } = fake({ getSession: async () => ++sessions === 1 ? { user: { id: userId } } : after })
    resultIs(await runReadinessCheck(services), 'unavailable', 'SESSION_CHANGED')
    assert(!calls.includes('workhub_context'))
  }
})
await test('학교 조회 응답 중 계정 변경은 준비 완료와 함수 없음 결과를 모두 폐기한다', async () => {
  for (const error of [null, { code: 'PGRST202', message: '원문' }]) {
    let sessions = 0
    const { services } = fake({ getSession: async () => ({ user: { id: ++sessions === 3 ? 'other-user' : userId } }), rpc: async () => ({ data: context(), error }) })
    resultIs(await runReadinessCheck(services), 'unavailable', 'SESSION_CHANGED')
  }
})
await test('최종 세션 재조회 실패는 앞서 받은 학교 결과를 준비 완료로 표시하지 않는다', async () => {
  let sessions = 0
  const { services } = fake({ getSession: async () => { if (++sessions === 3) throw new Error('network'); return { user: { id: userId } } } })
  resultIs(await runReadinessCheck(services), 'unavailable', 'SESSION_RECHECK_FAILED')
})
await test('함수 부재 또는 캐시 미갱신의 명확한 PGRST202만 기반 미연결로 분류한다', async () => {
  const { services } = fake({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: '임의 원문', details: '이메일과 학교명 원문' } }) })
  resultIs(await runReadinessCheck(services), 'foundation_missing', 'CONTEXT_FUNCTION_MISSING')
})
await test('네트워크·스키마 캐시 접속 장애·비슷한 오류 원문은 함수 미설치로 오인하지 않는다', async () => {
  for (const error of [{ message: 'PGRST202 missing function' }, { code: 'PGRST002' }, { code: '42P01' }, { code: '42883' }, { code: 'PGRST202-other' }]) {
    const { services } = fake({ rpc: async () => ({ data: null, error }) })
    resultIs(await runReadinessCheck(services), 'unavailable', 'CONTEXT_READ_FAILED')
  }
  const { services } = fake({ rpc: async () => { throw new TypeError('Failed to fetch PGRST202') } })
  resultIs(await runReadinessCheck(services), 'unavailable', 'CONTEXT_READ_FAILED')
})
await test('서버가 거부한 권한과 종료 소속을 구별한다', async () => {
  for (const error of [{ message: 'FORBIDDEN' }, { code: '42501' }]) {
    const { services } = fake({ rpc: async () => ({ data: null, error }) })
    resultIs(await runReadinessCheck(services), 'forbidden', 'SERVER_FORBIDDEN')
  }
  const { services } = fake({ rpc: async () => ({ data: null, error: { message: 'INACTIVE_MEMBERSHIP' } }) })
  resultIs(await runReadinessCheck(services), 'no_membership', 'NO_ACTIVE_MEMBERSHIP')
})
await test('학교 컨텍스트 형식 오류는 준비 완료나 설정 없음으로 처리하지 않는다', async () => {
  for (const response of [null, {}, { data: context() }, { data: context(), error: 'bad' }, { data: null, error: null }, { data: { ...context(), memberships: 'bad' }, error: null }]) {
    const { services } = fake({ rpc: async () => response })
    resultIs(await runReadinessCheck(services), 'unavailable', 'CONTEXT_INVALID')
  }
})
await test('같은 학교의 여러 소속은 한 학교로 계산하고 타인 소속은 준비 건수에서 제외한다', async () => {
  const data = context()
  data.memberships.push({ ...data.memberships[0], id: 'same-school-second-membership' })
  const { services } = fake({ rpc: async () => ({ data, error: null }) })
  resultIs(await runReadinessCheck(services), 'ready', 'CONTEXT_READY', 2)
})
await test('학교 목록만 존재하거나 본인의 활성 기간 밖 소속만 있으면 소속 없음을 표시한다', async () => {
  for (const change of [member => ({ ...member, active: false }), member => ({ ...member, validFrom: '2026-10-20' }), member => ({ ...member, validThrough: '2026-10-18' }), member => ({ ...member, userId: 'other-user' })]) {
    const data = context(); data.memberships = data.memberships.map(member => member.userId === userId ? change(member) : member)
    const { services } = fake({ rpc: async () => ({ data, error: null }) })
    resultIs(await runReadinessCheck(services), 'no_membership', 'NO_ACTIVE_MEMBERSHIP')
  }
  const data = { schools: [], memberships: [], basisDate: fixtureData.basisDate, schoolLabels: {} }
  resultIs(await runReadinessCheck(fake({ rpc: async () => ({ data, error: null }) }).services), 'no_membership', 'NO_ACTIVE_MEMBERSHIP')
})
await test('세션 토큰만 갱신되고 UID가 같으면 진단을 계속한다', async () => {
  let count = 0
  const { services } = fake({ getSession: async () => ({ user: { id: userId }, access_token: `changed-${count++}` }) })
  resultIs(await runReadinessCheck(services), 'ready', 'CONTEXT_READY', 2)
})
await test('진단 시간 초과 후 늦은 프로필 응답이 학교 RPC로 이어지지 않는다', async () => {
  const gate = deferred()
  const { services, calls } = fake({ fetchMyProfile: () => gate.promise })
  resultIs(await runReadinessCheck(services, { timeoutMs: 15 }), 'unavailable', 'TIMEOUT')
  gate.resolve(profile); await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['session'])
})
await test('시작 전 취소는 읽기 호출도 하지 않는다', async () => {
  const controller = new AbortController(); controller.abort()
  const { services, calls } = fake()
  resultIs(await runReadinessCheck(services, { signal: controller.signal }), 'unavailable', 'CANCELLED')
  assert.deepEqual(calls, [])
})
await test('진행 중 취소 후 늦은 학교 응답은 준비 완료나 최종 세션 조회로 이어지지 않는다', async () => {
  const gate = deferred(); const entered = deferred(); const controller = new AbortController()
  const { services, calls } = fake({ rpc: () => { entered.resolve(); return gate.promise } })
  const result = runReadinessCheck(services, { signal: controller.signal })
  await entered.promise; controller.abort()
  resultIs(await result, 'unavailable', 'CANCELLED')
  gate.resolve({ data: context(), error: null }); await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['session', 'profile', 'session'])
})
await test('지원 JSON에는 네 필드 외 개인정보·기술 원문·임의 필드를 담지 않는다', async () => {
  const result = await runReadinessCheck(fake().services)
  const json = exportReport({ ...result, email: profile.email, userId, schoolName: fixtureData.schools[0].name, token: 'synthetic-secret-token', message: '기술 원문' })
  assert.deepEqual(JSON.parse(json), result)
  for (const secret of [profile.email, userId, fixtureData.schools[0].name, 'synthetic-secret-token', '기술 원문']) assert(!json.includes(secret))
  const failure = await runReadinessCheck(fake({ rpc: async () => ({ data: null, error: { code: 'unknown-private-code', message: profile.email, details: userId } }) }).services)
  assert(!JSON.stringify(failure).includes('private')); assert(!exportReport(failure).includes(profile.email))
})
await test('손상·오염된 지원 보고서는 안전한 고정 코드로 내보낸다', async () => {
  const valid = await runReadinessCheck(fake().services)
  for (const value of [null, {}, { ...valid, code: profile.email }, { ...valid, stage: 'logged_out' }, { ...valid, checkedAt: profile.email }, { ...valid, checkedAt: '2026-02-30T00:00:00.000Z' }, { ...valid, readySchoolCount: -1 }, { ...valid, readySchoolCount: 0 }]) {
    resultIs(JSON.parse(exportReport(value)), 'unavailable', 'INVALID_REPORT')
  }
  resultIs(JSON.parse(exportReport({ stage: 'unavailable', code: 'NETWORK_OFFLINE', checkedAt: valid.checkedAt, readySchoolCount: 0 })), 'unavailable', 'NETWORK_OFFLINE')
})

if (failed) process.exitCode = 1
