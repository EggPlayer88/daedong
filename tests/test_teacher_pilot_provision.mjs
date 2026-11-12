import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateConfig, configHash, planProvision, provision, expectedEntries, findExisting } from '../scripts/teacher-pilot/core.mjs'
import { privateDirectory, atomicJson, withProvisionLock } from '../scripts/teacher-pilot/private-store.mjs'

const base = JSON.parse(readFileSync(new URL('../scripts/teacher-pilot/config.example.json', import.meta.url), 'utf8'))
const copy = value => structuredClone(value)
let passed = 0
async function test(label, action) { await action(); passed++; console.log(`  ✓ ${label}`) }
function fixture() {
  const state = { users: [], creates: [], saved: [], value: null, listCalls: [], beforeCreate: null }
  const admin = {
    async listUsers({ page, perPage }) { state.listCalls.push(page); return { data: { users: state.users.slice((page - 1) * perPage, page * perPage) }, error: null } },
    async createUser(input) {
      state.creates.push(copy(input))
      assert.equal(state.value.entries.find(row => row.email === input.email).status, 'result_unknown')
      const user = { id: `00000000-0000-0000-0000-${String(state.creates.length).padStart(12, '0')}`, email: input.email, user_metadata: copy(input.user_metadata), app_metadata: copy(input.app_metadata) }
      state.users.push(user)
      if (state.beforeCreate) await state.beforeCreate(user)
      return { data: { user }, error: null }
    }
  }
  const store = { async load() { return copy(state.value) }, async save(value) { state.value = copy(value); state.saved.push(copy(value)) } }
  const options = { admin, store, now: Date.parse('2026-11-12T01:00:00Z'), confirmedHash: configHash(base) }
  return { state, admin, store, options }
}

await test('기본 실행은 비밀·네트워크 없이 정확한 10명 계획만 출력', () => {
  const result = spawnSync(process.execPath, ['scripts/teacher-pilot/provision.mjs', '--config', 'scripts/teacher-pilot/config.example.json'], { encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '' } })
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.entries.length, 10); assert.equal(plan.writesPerformed, false)
  assert.ok(!/password|service_role_key/i.test(result.stdout))
})
for (const [name, change] of [
  ['9명', c => c.teachers.pop()], ['11명', c => c.teachers.push(copy(c.teachers[0]))],
  ['중복 교사', c => c.teachers[1].teacherId = c.teachers[0].teacherId], ['중복 표시 이름', c => c.teachers[1].displayName = c.teachers[0].displayName],
  ['슬롯 누락', c => c.teachers[0].slot = 'T11'], ['실계정 이름', c => c.teachers[0].displayName = '합성 교사'],
  ['임의 이메일', c => c.teachers[0].email = 'real@example.org'], ['추가 관리자 필드', c => c.teachers[0].role = 'superadmin'],
  ['학교 null', c => c.schoolId = null], ['교사 null', c => c.teachers[0].teacherId = null],
  ['프로젝트 URL 주입', c => c.projectRef = 'example.com/path'], ['긴 승인 기간', c => c.expiresAt = '2026-11-24T00:00:00.000Z'],
  ['0일 승인', c => c.expiresAt = c.startsAt], ['잘못된 실제 날짜', c => c.startsAt = '2026-02-30T00:00:00.000Z'],
  ['로그 개행', c => c.teachers[0].displayName += '\n'], ['SQL 표시 이름 한도 초과', c => c.teachers[0].displayName = '[시험] ' + '가'.repeat(46)], ['설정 API 키', c => c.serviceKey = 'secret']
]) await test(`${name} 설정은 생성 전 거절`, () => { const changed = copy(base); change(changed); assert.throws(() => validateConfig(changed)) })
await test('배열 순서만 달라져도 교사별 해시는 동일', () => { const reversed = copy(base); reversed.teachers.reverse(); assert.equal(configHash(reversed), configHash(base)) })
await test('확인 해시 불일치는 조회도 하지 않음', async () => { const f = fixture(); await assert.rejects(provision(base, { ...f.options, confirmedHash: 'x' }), { code: 'CONFIRM_HASH_MISMATCH' }); assert.equal(f.state.listCalls.length, 0) })
await test('만료된 시험은 조회·비밀 저장·계정 생성 전에 거절', async () => {
  const f = fixture()
  await assert.rejects(provision(base, { ...f.options, now: Date.parse(base.expiresAt) }), { code: 'BATCH_EXPIRED' })
  assert.equal(f.state.listCalls.length, 0); assert.equal(f.state.saved.length, 0); assert.equal(f.state.creates.length, 0)
})
await test('기존 실계정 이메일 충돌은 전체 쓰기 전 중단', async () => {
  const f = fixture(); f.state.users.push({ id: '00000000-0000-0000-0000-000000000001', email: expectedEntries(base)[9].email, user_metadata: {}, app_metadata: {} })
  await assert.rejects(provision(base, f.options), { code: 'ACCOUNT_COLLISION' }); assert.equal(f.state.creates.length, 0); assert.equal(f.state.saved.length, 0)
})
await test('새 계정은 10개만 생성하고 비밀을 등록 명세에 넣지 않음', async () => {
  const f = fixture(), result = await provision(base, f.options)
  assert.equal(f.state.creates.length, 10); assert.equal(result.entries.length, 10)
  assert.equal(new Set(f.state.creates.map(row => row.password)).size, 10)
  assert.ok(f.state.creates.every(row => row.email_confirm === true && row.app_metadata.teacher_pilot.configHash === configHash(base)))
  assert.ok(!/password|service_role/i.test(JSON.stringify(result)))
  assert.ok(f.state.creates.every(row => !('role' in row) && Object.keys(row.app_metadata).join() === 'teacher_pilot'))
  assert.ok(f.state.value.entries.every(row => row.status === 'confirmed'))
})
await test('같은 설정 재실행은 기존 10개를 재사용하고 암호를 바꾸지 않음', async () => {
  const f = fixture(), first = await provision(base, f.options), passwords = f.state.value.entries.map(row => row.password)
  const second = await provision(base, f.options)
  assert.deepEqual(second, first); assert.equal(f.state.creates.length, 10); assert.deepEqual(f.state.value.entries.map(row => row.password), passwords)
})
await test('생성 응답 유실 뒤 목록 조회로 회복하며 중복 생성하지 않음', async () => {
  const f = fixture(); f.state.beforeCreate = () => { throw new Error('provider echoed secret') }
  await assert.rejects(provision(base, f.options), { code: 'CREATE_RESULT_UNKNOWN' })
  assert.equal(f.state.value.entries[0].status, 'result_unknown'); assert.equal(f.state.creates.length, 1)
  const password = f.state.value.entries[0].password; f.state.beforeCreate = null
  const result = await provision(base, f.options)
  assert.equal(result.entries.length, 10); assert.equal(f.state.creates.length, 10); assert.equal(f.state.value.entries[0].password, password)
})
await test('기존 시험 계정의 비밀 보관본이 없으면 암호 재설정하지 않음', async () => {
  const f = fixture(); await provision(base, f.options); f.state.value = null
  await assert.rejects(provision(base, f.options), { code: 'CREDENTIALS_MISSING' }); assert.equal(f.state.creates.length, 10)
})
await test('등록 뒤 사용자 ID가 바뀌면 재사용하지 않음', async () => {
  const f = fixture(); await provision(base, f.options); f.state.users[0].id = '11111111-1111-1111-1111-111111111111'
  await assert.rejects(provision(base, f.options), { code: 'AUTH_ID_CHANGED' }); assert.equal(f.state.creates.length, 10)
})
await test('완료한 시험 계정이 없어졌을 때 다시 생성하지 않음', async () => {
  const f = fixture(); await provision(base, f.options); f.state.users.pop()
  await assert.rejects(provision(base, f.options), { code: 'ACCOUNT_DISAPPEARED' }); assert.equal(f.state.creates.length, 10)
})
await test('다른 설정으로 저장한 암호 보관본을 거절', async () => {
  const f = fixture(); await provision(base, f.options); f.state.value.configHash = 'x'
  await assert.rejects(provision(base, f.options), { code: 'JOURNAL_MISMATCH' })
})
await test('암호 선보관 실패 때 API 쓰기를 하지 않음', async () => {
  const f = fixture(); f.options.store.save = async () => { throw new Error('disk full') }
  await assert.rejects(provision(base, f.options), /disk full/); assert.equal(f.state.creates.length, 0)
})
await test('반복 암호 생성기는 거절', async () => {
  const f = fixture(); await assert.rejects(provision(base, { ...f.options, randomPassword: () => 'a'.repeat(32) }), { code: 'PASSWORD_COLLISION' }); assert.equal(f.state.creates.length, 0)
})
await test('사용자 목록은 페이지 전체를 확인하되 다른 계정은 결과에 남기지 않음', async () => {
  const f = fixture(); f.state.users = Array.from({ length: 100 }, (_, i) => ({ email: `unrelated-${i}@example.org` }))
  f.state.users.push({ email: expectedEntries(base)[0].email })
  const found = await findExisting(f.admin, expectedEntries(base)); assert.equal(found.size, 1); assert.deepEqual(f.state.listCalls, [1, 2])
})
await test('조회 실패의 민감한 서버 원문을 노출하지 않음', async () => {
  const f = fixture(); f.admin.listUsers = async () => { throw new Error('secret-key-here') }
  await assert.rejects(provision(base, f.options), e => e.code === 'AUTH_LOOKUP_FAILED' && !e.message.includes('secret'))
})
await test('CLI에 비밀 문자열 옵션 전달을 허용하지 않음', () => {
  const result = spawnSync(process.execPath, ['scripts/teacher-pilot/provision.mjs', '--service-key', 'secret-key-here'], { encoding: 'utf8' })
  assert.equal(result.status, 1); assert.ok(!result.stderr.includes('secret-key-here')); assert.equal(JSON.parse(result.stderr).code, 'INVALID_ARGUMENT')
})
await test('생성 도구는 역할 수정·초대·삭제 API를 갖지 않음', () => {
  const source = readFileSync(new URL('../scripts/teacher-pilot/core.mjs', import.meta.url), 'utf8')
  assert.ok(!/admin\.(?:deleteUser|updateUserById|inviteUserByEmail|generateLink)\(/.test(source))
  assert.equal(planProvision(base).writesPerformed, false)
})
const tempRoot = mkdtempSync(join(tmpdir(), 'teacher-pilot-provision-test-'))
try {
  await test('만료 계획은 dry-run 가능하지만 CLI 실행은 키·폴더 확인 전에 거절', () => {
    const expired = { ...copy(base), startsAt: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-02T00:00:00.000Z' }
    const path = join(tempRoot, 'expired-synthetic.json'), output = join(tempRoot, 'must-not-create')
    atomicJson(path, expired)
    const env = { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '' }
    const dry = spawnSync(process.execPath, ['scripts/teacher-pilot/provision.mjs', '--config', path], { encoding: 'utf8', env })
    assert.equal(dry.status, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).mode, 'dry-run')
    const execute = spawnSync(process.execPath, ['scripts/teacher-pilot/provision.mjs', '--config', path, '--execute', '--private-dir', output, '--confirm-hash', configHash(expired)], { encoding: 'utf8', env })
    assert.equal(execute.status, 1); assert.equal(JSON.parse(execute.stderr).code, 'BATCH_EXPIRED')
    assert.equal(execute.stdout, ''); assert.equal(existsSync(output), false)
  })
  await test('비밀 보관은 저장소 안이나 상대 경로를 거절', () => {
    assert.throws(() => privateDirectory(process.cwd(), 'private-test', process.cwd()), { code: 'PRIVATE_DIRECTORY_MUST_BE_OUTSIDE_REPOSITORY' })
    assert.throws(() => privateDirectory('.', 'private-test', process.cwd()), { code: 'PRIVATE_PARENT_REQUIRED' })
    assert.throws(() => privateDirectory(tempRoot, '../escape', process.cwd()), { code: 'INVALID_BATCH_DIRECTORY' })
  })
  const aclCalls = [], mockWindowsAcl = process.platform === 'win32' && process.env.TEACHER_PILOT_VERIFY_REAL_ACL !== '1'
  const aclOptions = mockWindowsAcl ? { run: (file, args) => { aclCalls.push({ file, args }); return file === 'whoami.exe' ? 'synthetic\\tester\n' : '' } } : {}
  const privateDir = privateDirectory(tempRoot, 'private-test', process.cwd(), aclOptions)
  await test('비공개 폴더의 권한 명령과 원자적 교체 확인', () => {
    const file = join(privateDir, 'synthetic.json')
    atomicJson(file, { fake: 1 }); atomicJson(file, { fake: 2 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { fake: 2 })
    if (process.platform !== 'win32') { assert.equal(statSync(privateDir).mode & 0o777, 0o700); assert.equal(statSync(file).mode & 0o777, 0o600) }
    // AppContainer 밖 권한 변경은 운영 전 별도 smoke로 확인하며 회귀는 관리자 명령을 대조한다.
    if (mockWindowsAcl) {
      assert.equal(aclCalls[1].file, 'icacls.exe'); assert.ok(aclCalls[1].args.includes('/inheritance:r'))
      assert.ok(aclCalls[1].args.includes('synthetic\\tester:(OI)(CI)F'))
      assert.ok(Buffer.from(aclCalls[2].args.at(-1), 'base64').toString('utf16le').includes('GetAccessControl'))
    }
  })
  await test('동일 시험의 동시 생성 프로세스는 잠금으로 거절', async () => {
    await withProvisionLock(privateDir, async () => {
      await assert.rejects(withProvisionLock(privateDir, async () => assert.fail('잠금을 우회하면 안 됨')), { code: 'PROVISION_ALREADY_RUNNING' })
    })
    assert.equal(existsSync(join(privateDir, 'provision.lock')), false)
  })
  await test('생성 처리 실패 뒤 본인 잠금만 해제', async () => {
    await assert.rejects(withProvisionLock(privateDir, async () => { throw new Error('synthetic failure') }), /synthetic failure/)
    assert.equal(existsSync(join(privateDir, 'provision.lock')), false)
  })
} finally {
  // mkdtemp로 만든 정확한 경로가 OS 임시 폴더 아래임을 확인한 뒤 합성 파일만 정리한다.
  const tempBase = resolve(tmpdir()), absolute = resolve(tempRoot), rel = relative(tempBase, absolute)
  if (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) && rel.startsWith('teacher-pilot-provision-test-')) rmSync(absolute, { recursive: true, force: true })
}
console.log(`\n${passed} passed, 0 failed`)
