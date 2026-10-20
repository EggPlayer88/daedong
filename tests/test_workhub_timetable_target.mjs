import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/target'; export { createTimetableTargetServer } from '../apps/workhub/src/timetable/target-server';`)
const term = (id, year, firstDay, lastDay, state = 'planning') => ({ id, schoolYear: year, label: '1학기', firstDay, lastDay, state, hasBasis: false, hasPreparationDraft: false })
const source = { termId: 'now', automaticTermId: 'now', selectedTermId: null, version: 0, terms: [term('now', 2026, '2026-08-13', '2027-02-28', 'current'), term('next', 2027, '2027-03-01', '2027-08-15')] }
const input = { termId: 'next', expectedVersion: 0 }
const member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 관리자', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
const copy = value => structuredClone(value), code = expected => error => error?.code === expected
let count = 0
async function test(name, run) { await run(); count++; console.log('  ✓ ' + name) }
function connection() {
  const calls = [], receipts = new Map(), commands = new Map()
  let snapshot = copy(source), members = [copy(member)], identity = { userId: 'user', approved: true, profile: { role: 'superadmin', is_active: true } }, failure, failGet, transform = value => value, pause
  const envelope = data => ({ contract: 'timetable.target.v1', schoolId: 'school', memberId: 'member', data })
  const error = code => ({ contract: 'timetable.target.v1', schoolId: 'school', memberId: 'member', error: { code } })
  const value = { info: () => ({ memberships: copy(members), schools: [{ id: 'school' }, { id: 'other' }], basisDate: '2026-10-19' }), getIdentity: async () => copy(identity), rpcVerified: async (name, args) => {
    calls.push({ name, args: copy(args) }); if (pause) await pause
    if (name.endsWith('_get')) { if (failGet) throw failGet; return transform(envelope(copy(snapshot))) }
    const input = args.p_input, key = args.p_request_key
    if (commands.has(key) && JSON.stringify(input) !== JSON.stringify(commands.get(key))) return error('IDEMPOTENCY_CONFLICT')
    if (receipts.has(key)) return transform(envelope(copy(receipts.get(key))))
    if (args.p_recover_only) return error('NOT_FOUND')
    if (failure && failure !== 'drop') return error(failure)
    if (input.expectedVersion !== snapshot.version) return error('CONFLICT')
    commands.set(key, copy(input))
    if (input.termId !== snapshot.selectedTermId) snapshot.version++
    snapshot.selectedTermId = input.termId; snapshot.termId = input.termId ?? snapshot.automaticTermId
    const receipt = { requestKey: key, termId: input.termId, version: snapshot.version, effectiveTermId: snapshot.termId }; receipts.set(key, receipt)
    if (failure === 'drop') { failure = undefined; throw Error('연결 끊김') }
    return transform(envelope(copy(receipt)))
  } }
  return { value, calls, setSource: x => snapshot = copy(x), failGet: x => failGet = x, failure: x => failure = x, transform: x => transform = x, setMember: x => members = [x], setIdentity: x => identity = x, pause: x => pause = x }
}
await test('자동 학기와 다음 학기, 초안·기준판 표시는 복제된 exact 계약으로 읽는다', () => {
  const view = m.targetSnapshot(source); assert.deepEqual(view, source); view.terms[0].label = '변경'; assert.equal(source.terms[0].label, '1학기')
  assert.match(m.targetTermLabel(source.terms[1]), /2027학년도 1학기.*next/)
})
await test('학기 없음과 자동 대상 없음, 선택 학기 닫힘을 구분한다', () => {
  assert.deepEqual(m.targetSnapshot({ termId: null, automaticTermId: null, selectedTermId: null, version: 0, terms: [] }).terms, [])
  assert.equal(m.targetSnapshot({ ...source, selectedTermId: 'closed', version: 2 }).termId, 'now')
  assert.equal(m.targetSnapshot({ ...source, termId: 'outside', selectedTermId: 'outside', version: 2 }).termId, 'outside')
})
for (const [name, change] of [
  ['최상위 추가칸', x => x.extra = true], ['학기 추가칸', x => x.terms[0].hidden = true], ['중복 학기', x => x.terms.push(copy(x.terms[0]))], ['학기 수 한도', x => x.terms = Array.from({ length: 21 }, (_, i) => ({ ...source.terms[0], id: 'term-' + i }))],
  ['날짜 역전', x => x.terms[0].firstDay = '2027-03-01'], ['실재하지 않는 날짜', x => x.terms[0].lastDay = '2027-02-30'], ['배열 아님', x => x.terms = null], ['정렬 역전', x => x.terms.reverse()],
  ['상태 closed', x => x.terms[0].state = 'closed'], ['기준판 표시 숫자', x => x.terms[0].hasBasis = 1], ['초안 표시 null', x => x.terms[0].hasPreparationDraft = null], ['학년도 소수', x => x.terms[0].schoolYear = 2026.5], ['학년도 상한', x => x.terms[0].schoolYear = 2101],
  ['학기명 빈칸', x => x.terms[0].label = ' '], ['학기명 상한', x => x.terms[0].label = '가'.repeat(31)], ['학기 ID', x => x.terms[0].id = 'bad id'], ['판 음수', x => x.version = -1], ['판 문자열', x => x.version = '1'], ['판 int 범위', x => x.version = 2147483648],
  ['판 없는 수동선택', x => x.selectedTermId = 'next'], ['자동 값 불일치', x => x.termId = 'next'], ['현재 선택 불일치', x => { x.selectedTermId = 'next'; x.version = 1 }], ['무관한 실효 학기', x => { x.selectedTermId = 'closed'; x.termId = 'alien'; x.version = 1 }],
]) await test('깨진 조회 응답 거부: ' + name, () => { const bad = copy(source); change(bad); assert.throws(() => m.targetSnapshot(bad), code('INVALID_RESPONSE')) })
for (const bad of [{ ...input, hidden: true }, { termId: 'next' }, { termId: 'bad id', expectedVersion: 0 }, { ...input, expectedVersion: -1 }, { ...input, expectedVersion: 2147483648 }, { ...input, expectedVersion: null }]) await test('전송 전 입력 오류는 INVALID_INPUT', () => assert.throws(() => m.targetCommand(bad), code('INVALID_INPUT')))
await test('선택 입력은 원문을 보존하고 조회한 판과 학기만 새 명령으로 허용한다', () => {
  assert.deepEqual(m.targetCommand(input, source), input); assert.deepEqual(m.targetCommand({ termId: null, expectedVersion: 0 }, source), { termId: null, expectedVersion: 0 })
  assert.throws(() => m.targetCommand({ ...input, expectedVersion: 1 }, source), code('CONFLICT'))
  assert.throws(() => m.targetCommand({ ...input, termId: 'not-listed' }, source), code('NOT_FOUND'))
})
const receipt = { requestKey: 'request-1', termId: 'next', version: 1, effectiveTermId: 'next' }
await test('실제 변경과 같은 선택 재전송의 판 규칙을 구분한다', () => {
  assert.deepEqual(m.targetReceipt(receipt, input, 'request-1', source), receipt)
  assert.equal(m.targetReceipt({ ...receipt, version: 4 }, { termId: 'next', expectedVersion: 4 }, 'request-1', { ...source, selectedTermId: 'next', version: 4 }).version, 4)
  assert.equal(m.targetReceipt({ ...receipt, termId: null, effectiveTermId: 'now', version: 0 }, { termId: null, expectedVersion: 0 }, 'request-1').version, 0)
  assert.equal(m.targetReceipt({ ...receipt, termId: null, effectiveTermId: null, version: 5 }, { termId: null, expectedVersion: 4 }, 'request-1').effectiveTermId, null)
})
await test('선택 학기 삭제 뒤 null 복귀 no-op은 같은 판과 서버의 현재 자동 학기를 읽는다', () => {
  const before = { ...source, termId: 'next', selectedTermId: 'next', version: 4 }
  for (const effectiveTermId of ['now', 'replacement', null]) {
    const result = { requestKey: 'request-1', termId: null, version: 4, effectiveTermId }
    assert.deepEqual(m.targetReceipt(result, { termId: null, expectedVersion: 4 }, 'request-1', before), result)
  }
})
await test('학기 삭제 예외는 다른 학기 선택과 판 증가 변조까지 넓히지 않는다', () => {
  const before = { ...source, termId: 'next', selectedTermId: 'next', version: 4 }
  assert.throws(() => m.targetReceipt({ ...receipt, termId: 'now', effectiveTermId: 'now', version: 4 }, { termId: 'now', expectedVersion: 4 }, 'request-1', before), code('INVALID_RESPONSE'))
  assert.throws(() => m.targetReceipt({ ...receipt, termId: null, effectiveTermId: 'now', version: 6 }, { termId: null, expectedVersion: 4 }, 'request-1', before), code('INVALID_RESPONSE'))
  assert.throws(() => m.targetReceipt({ ...receipt, termId: null, effectiveTermId: 'now', version: 5 }, { termId: null, expectedVersion: 4 }, 'request-1', { ...before, selectedTermId: null }), code('INVALID_RESPONSE'))
})
await test('조회와 저장 사이 학기 삭제는 성공 접수증으로 받고 최신 자동 대상을 별도로 다시 읽는다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  c.setSource({ ...source, termId: 'next', selectedTermId: 'next', version: 4 }); await server.get('member')
  c.setSource({ ...source, termId: null, automaticTermId: null, selectedTermId: null, version: 4, terms: [] })
  assert.deepEqual(await server.execute('member', { termId: null, expectedVersion: 4 }, 'request-1'), { requestKey: 'request-1', termId: null, version: 4, effectiveTermId: null })
  assert.equal(c.calls.length, 2)
  assert.equal((await server.get('member')).termId, null)
  assert.equal(c.calls.filter(row => row.name.endsWith('_set')).length, 1)
})
for (const [name, change] of [['요청 번호', r => r.requestKey = 'different'], ['선택 학기', r => r.termId = 'now'], ['실효 학기', r => r.effectiveTermId = 'now'], ['판 증가 초과', r => r.version = 2], ['초기 선택 판 0', r => r.version = 0], ['추가 필드', r => r.extra = true]]) await test('접수증 변조 거부: ' + name, () => { const bad = copy(receipt); change(bad); assert.throws(() => m.targetReceipt(bad, input, 'request-1'), code('INVALID_RESPONSE')) })
await test('최초 조회 없이 새 쓰기는 보내지 않고 복구는 바로 조회한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  assert.throws(() => server.execute('member', input, 'request-1'), code('NOT_READY')); assert.equal(c.calls.length, 0)
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('NOT_FOUND')); assert.equal(c.calls.length, 1); assert.equal(c.calls[0].args.p_recover_only, true)
})
await test('정확한 RPC·두 입력칸·원래 번호를 보내고 캐시를 외부 변조할 수 없다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value), view = await server.get('member'); view.version = 9; view.terms = []
  assert.deepEqual(await server.execute('member', input, 'request-1'), receipt)
  assert.deepEqual(c.calls.at(-1), { name: 'workhub_timetable_target_set', args: { p_input: input, p_request_key: 'request-1', p_recover_only: false, p_member_id: 'member' } })
})
await test('응답 유실·모듈 중지·조회 실패 뒤 원래 접수증만 복구한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); c.failure('drop')
  await assert.rejects(() => server.execute('member', input, 'request-1'), code('RESULT_UNKNOWN'))
  c.failGet(Error('offline')); c.failure('NOT_READY'); c.setSource({ ...source, version: 2 })
  const restored = m.createTimetableTargetServer(c.value); assert.deepEqual(await restored.recover('member', input, 'request-1'), receipt)
  assert.equal(c.calls.filter(row => row.name.endsWith('_get')).length, 1); assert.equal(c.calls.filter(row => row.name.endsWith('_set') && !row.args.p_recover_only).length, 1)
})
await test('결과를 모르는 같은 키로 다른 입력을 보내지 않는다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); c.failure('drop')
  await assert.rejects(() => server.execute('member', input, 'request-1'), code('RESULT_UNKNOWN'))
  for (const operation of ['execute', 'recover']) assert.throws(() => server[operation]('member', { termId: null, expectedVersion: 0 }, 'request-1'), code('IDEMPOTENCY_CONFLICT'))
  assert.equal(c.calls.length, 2)
})
for (const field of ['schoolId', 'memberId', 'contract']) await test('다른 범위 응답은 성공으로 채택하지 않는다: ' + field, async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); c.transform(raw => ({ ...raw, [field]: 'other' }))
  await assert.rejects(() => server.execute('member', input, 'request-1'), code('RESULT_UNKNOWN'))
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('INVALID_RESPONSE'))
})
await test('권한·학교 범위가 바뀐 캐시는 새 쓰기에 쓰이지 않는다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); c.setMember({ ...member, role: 'school_admin' })
  assert.throws(() => server.execute('member', input, 'request-1'), code('CANCELLED')); assert.equal(c.calls.length, 1)
})
await test('쓰기 중 계정 승인 정보 변경 뒤 늦은 응답을 닫는다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  const pending = server.execute('member', input, 'request-1'); await new Promise(resolve => setImmediate(resolve)); c.setIdentity({ userId: 'user', approved: true, profile: { role: 'teacher', is_active: true } }); release()
  await assert.rejects(() => pending, code('CANCELLED'))
})
await test('시간초과 후 늦은 성공은 복구 전까지 결과 미상으로 보존한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value, { timeoutMs: 20 }); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  await assert.rejects(() => server.execute('member', input, 'request-1'), code('RESULT_UNKNOWN')); release(); await new Promise(resolve => setImmediate(resolve)); c.pause(undefined)
  assert.deepEqual(await server.recover('member', input, 'request-1'), receipt)
})
await test('명확한 함수 부재와 일반 통신 실패를 구별한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); c.failGet({ code: 'PGRST202' }); await assert.rejects(() => server.get('member'), code('NOT_READY'))
  c.failGet(Error('network')); await assert.rejects(() => server.get('member'), code('QUERY_FAILED'))
})
for (const error of ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'CONFLICT', 'NOT_FOUND', 'INVALID_INPUT']) await test('확정 거절을 결과 미상과 구별한다: ' + error, async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value); await server.get('member'); c.failure(error)
  await assert.rejects(() => server.execute('member', input, 'request-1'), code(error))
})
await test('원장 없음 확인 전에는 원래 번호 재전송을 열지 않는다', () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  assert.throws(() => server.resend('member', input, 'request-1'), code('NOT_READY')); assert.equal(c.calls.length, 0)
})
await test('NOT_FOUND 뒤 정말 미접수인 명령은 조회한 원키·원문만 저장한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('NOT_FOUND')); c.failGet(Error('offline'))
  assert.throws(() => server.resend('member', { termId: null, expectedVersion: 0 }, 'request-1'), code('IDEMPOTENCY_CONFLICT'))
  assert.throws(() => server.resend('member', input, 'request-new'), code('NOT_READY'))
  assert.deepEqual(await server.resend('member', input, 'request-1'), receipt)
  assert.equal(c.calls.length, 2); assert.equal(c.calls[1].args.p_recover_only, false); assert.deepEqual(c.calls[0].args.p_input, c.calls[1].args.p_input); assert.equal(c.calls[0].args.p_request_key, c.calls[1].args.p_request_key)
})
await test('NOT_FOUND 뒤 최초 요청이 늦게 저장돼도 원키 재전송은 같은 접수증을 읽는다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value, { timeoutMs: 20 }); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  await assert.rejects(() => server.execute('member', input, 'request-1'), code('RESULT_UNKNOWN')); c.pause(undefined)
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('NOT_FOUND')); release(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await server.resend('member', input, 'request-1'), receipt); assert.equal(c.calls.filter(row => row.name.endsWith('_set')).length, 3)
  assert.equal((await server.get('member')).version, 1)
})
await test('원키 재전송은 현재 판으로 고치지 않으며 한 번 뒤에는 다시 원장을 확인한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('NOT_FOUND')); c.setSource({ ...source, version: 2 })
  await assert.rejects(() => server.resend('member', input, 'request-1'), code('CONFLICT'))
  assert.equal(c.calls.at(-1).args.p_input.expectedVersion, 0); assert.throws(() => server.resend('member', input, 'request-1'), code('NOT_READY'))
})
await test('원키 재전송도 학교·소속 범위와 응답 변조 검사를 유지한다', async () => {
  const c = connection(), server = m.createTimetableTargetServer(c.value)
  await assert.rejects(() => server.recover('member', input, 'request-1'), code('NOT_FOUND')); c.setMember({ ...member, schoolId: 'other' })
  assert.throws(() => server.resend('member', input, 'request-1'), code('NOT_READY')); c.setMember(member); c.transform(raw => ({ ...raw, schoolId: 'other' }))
  await assert.rejects(() => server.resend('member', input, 'request-1'), code('RESULT_UNKNOWN'))
})
// Claude의 격리 PostgreSQL T1_07_CAPTURE 결과를 추가로 대조할 수 있다. 운영 접속은 하지 않는다.
if (process.env.TIMETABLE_TARGET_CAPTURE) {
  const captures = JSON.parse(readFileSync(process.env.TIMETABLE_TARGET_CAPTURE, 'utf8'))
  let snapshots = 0, receipts = 0
  for (const row of Object.values(captures)) {
    const raw = row.response ?? row
    if (raw?.contract !== 'timetable.target.v1' || !raw.data) continue
    if (row.input) { assert.deepEqual(m.targetReceipt(raw.data, row.input, raw.data.requestKey), raw.data); receipts++ }
    else { assert.deepEqual(m.targetSnapshot(raw.data), raw.data); snapshots++ }
  }
  assert.ok(snapshots > 0 && receipts > 0)
  console.log(`  SQL 합성 원본 ${snapshots}건 · 접수증 ${receipts}건 실제 parser 대조 통과`)
}
console.log(`시간표 대상 학기 계약 검사: ${count}개 통과`)
