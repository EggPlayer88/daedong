import { createHash, randomBytes } from 'node:crypto'

export const CONTRACT = 'teacher.pilot.provision.v1'
export const SLOTS = Object.freeze(Array.from({ length: 10 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`))
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)

// 실명·학교 ID는 Git에 넣지 않고 실행자가 제공한 비공개 설정에서만 읽는다.
export function validateConfig(input) {
  if (!exact(input, ['contract', 'projectRef', 'schoolId', 'batchId', 'startsAt', 'expiresAt', 'teachers']) || input.contract !== CONTRACT) fail('INVALID_CONFIG')
  if (typeof input.projectRef !== 'string' || !/^[a-z]{20}$/.test(input.projectRef) || typeof input.schoolId !== 'string' || !ID.test(input.schoolId) || typeof input.batchId !== 'string' || !/^[a-z][a-z0-9-]{2,47}$/.test(input.batchId)) fail('INVALID_IDENTITY')
  const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  if (!stamp(input.startsAt) || !stamp(input.expiresAt)) fail('INVALID_PERIOD')
  const length = Date.parse(input.expiresAt) - Date.parse(input.startsAt)
  if (length <= 0 || length > 7 * 86400000) fail('INVALID_PERIOD')
  if (!Array.isArray(input.teachers) || input.teachers.length !== SLOTS.length) fail('EXACTLY_TEN_REQUIRED')
  const ids = new Set(), names = new Set()
  const teachers = [...input.teachers].sort((a, b) => String(a?.slot).localeCompare(String(b?.slot))).map((row, i) => {
    if (!exact(row, ['slot', 'teacherId', 'displayName']) || row.slot !== SLOTS[i] || typeof row.teacherId !== 'string' || !ID.test(row.teacherId)) fail('INVALID_TEACHER')
    if (!clean(row.displayName, 50) || !row.displayName.startsWith('[시험] ') || row.displayName.length <= 5 || ids.has(row.teacherId) || names.has(row.displayName)) fail('INVALID_TEACHER')
    ids.add(row.teacherId); names.add(row.displayName)
    return { slot: row.slot, teacherId: row.teacherId, displayName: row.displayName }
  })
  return { contract: CONTRACT, projectRef: input.projectRef, schoolId: input.schoolId, batchId: input.batchId, startsAt: input.startsAt, expiresAt: input.expiresAt, teachers }
}

export function configHash(config) { return createHash('sha256').update(JSON.stringify(validateConfig(config))).digest('hex') }
export function expectedEntries(input) {
  const config = validateConfig(input)
  return config.teachers.map(row => ({ ...row, email: `teacher-pilot-${config.batchId}-${row.slot.toLowerCase()}@example.com` }))
}
export function planProvision(input) {
  const config = validateConfig(input)
  return { contract: CONTRACT, mode: 'dry-run', projectRef: config.projectRef, schoolId: config.schoolId, batchId: config.batchId, startsAt: config.startsAt, expiresAt: config.expiresAt, configHash: configHash(config), entries: expectedEntries(config), actions: ['Auth 계정 10개 생성 또는 동일 시험 계정 재확인', '가입 승인·학교 연결·AI 허용은 별도 TP1 단계'], writesPerformed: false }
}

function marker(config, entry) { return { batchId: config.batchId, schoolId: config.schoolId, teacherId: entry.teacherId, slot: entry.slot, configHash: configHash(config) } }
function sameManagedUser(user, config, entry) {
  const m = user?.app_metadata?.teacher_pilot, expected = marker(config, entry)
  return UUID.test(user?.id ?? '') && typeof user.email === 'string' && user.email.toLowerCase() === entry.email &&
    user.is_anonymous !== true && user.user_metadata?.full_name === entry.displayName &&
    exact(m, Object.keys(expected)) && Object.entries(expected).every(([key, value]) => m[key] === value)
}

// 목록 응답 원문에는 다른 사용자 정보가 있으므로 필요한 이메일만 남긴다.
export async function findExisting(admin, entries) {
  const emails = new Set(entries.map(row => row.email)), found = new Map()
  for (let page = 1; page <= 100; page++) {
    let response
    try { response = await admin.listUsers({ page, perPage: 100 }) } catch { fail('AUTH_LOOKUP_FAILED') }
    if (response?.error || !Array.isArray(response?.data?.users)) fail('AUTH_LOOKUP_FAILED')
    const users = response.data.users
    for (const user of users) {
      const email = typeof user.email === 'string' ? user.email.toLowerCase() : ''
      if (!emails.has(email)) continue
      if (found.has(email)) fail('DUPLICATE_AUTH_EMAIL')
      found.set(email, user)
    }
    if (users.length < 100) return found
  }
  fail('AUTH_LOOKUP_LIMIT')
}

function validateJournal(value, config) {
  if (!value || value.contract !== CONTRACT || value.configHash !== configHash(config) || value.batchId !== config.batchId || !Array.isArray(value.entries) || value.entries.length !== 10) fail('JOURNAL_MISMATCH')
  const expected = expectedEntries(config)
  for (let i = 0; i < expected.length; i++) {
    const row = value.entries[i]
    if (!row || !Object.entries(expected[i]).every(([key, item]) => row[key] === item) || !/^[A-Za-z0-9_-]{32}$/.test(row.password) || !['prepared', 'result_unknown', 'confirmed'].includes(row.status) || (row.authUserId !== null && !UUID.test(row.authUserId))) fail('JOURNAL_MISMATCH')
  }
  return value
}

/** Auth 쓰기만 담당한다. 기존 계정 수정·승인·비밀번호 교체·삭제를 호출하지 않는다. */
export async function provision(input, { admin, store, confirmedHash, now = Date.now(), randomPassword = () => randomBytes(24).toString('base64url') }) {
  const config = validateConfig(input), hash = configHash(config), expected = expectedEntries(config)
  if (confirmedHash !== hash) fail('CONFIRM_HASH_MISMATCH')
  if (!Number.isFinite(now) || now >= Date.parse(config.expiresAt)) fail('BATCH_EXPIRED')
  const existing = await findExisting(admin, expected)
  // 전체 대상의 충돌을 먼저 검사하여 기존 실계정에 부분 변경조차 하지 않는다.
  for (const entry of expected) if (existing.has(entry.email) && !sameManagedUser(existing.get(entry.email), config, entry)) fail('ACCOUNT_COLLISION')
  let journal = await store.load()
  if (journal) validateJournal(journal, config)
  else {
    if (existing.size) fail('CREDENTIALS_MISSING')
    journal = { contract: CONTRACT, configHash: hash, batchId: config.batchId, entries: expected.map(row => ({ ...row, password: randomPassword(), authUserId: null, status: 'prepared' })) }
    validateJournal(journal, config)
    if (new Set(journal.entries.map(row => row.password)).size !== 10) fail('PASSWORD_COLLISION')
    await store.save(journal)
  }
  for (const row of journal.entries) {
    const user = existing.get(row.email)
    if (user) {
      if (row.authUserId !== null && row.authUserId !== user.id) fail('AUTH_ID_CHANGED')
      row.authUserId = user.id; row.status = 'confirmed'; await store.save(journal)
      continue
    }
    if (row.status === 'confirmed' || row.authUserId !== null) fail('ACCOUNT_DISAPPEARED')
    // 생성 직전에도 기록한다. 응답이 끊기면 다음 실행의 목록 조회로만 확인한다.
    row.status = 'result_unknown'; await store.save(journal)
    let result
    try {
      result = await admin.createUser({ email: row.email, password: row.password, email_confirm: true,
        user_metadata: { full_name: row.displayName }, app_metadata: { teacher_pilot: marker(config, row) } })
    } catch { fail('CREATE_RESULT_UNKNOWN') }
    if (result?.error || !sameManagedUser(result?.data?.user, config, row)) fail('CREATE_RESULT_UNKNOWN')
    row.authUserId = result.data.user.id; row.status = 'confirmed'; await store.save(journal)
  }
  return { contract: CONTRACT, projectRef: config.projectRef, schoolId: config.schoolId, batchId: config.batchId,
    startsAt: config.startsAt, expiresAt: config.expiresAt, configHash: hash,
    entries: journal.entries.map(({ slot, email, displayName, teacherId, authUserId }) => ({ slot, email, displayName, teacherId, authUserId })) }
}
