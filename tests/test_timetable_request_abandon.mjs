import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
export * from '../apps/workhub/src/timetable/request-abandon';
export * from '../apps/workhub/src/timetable/operations-server';
export * from '../apps/workhub/src/timetable/publication-execution-server';
export * from '../apps/workhub/src/timetable/school-day-execution-server';
export * from '../apps/workhub/src/timetable/execution-records-server';
export * from '../apps/workhub/src/timetable/execution-records';
export { canonical } from '../apps/workhub/src/services/scoped-rpc';`)
const now = Date.parse('2026-10-18T00:00:00.000Z'), at = offset => new Date(now + offset).toISOString()
const clone = structuredClone, hash = value => createHash('sha256').update(m.canonical(value)).digest('hex'), key = 'original-key'
const member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const lesson = { id: 'lesson', version: 1, label: '국어', time: { startsAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-10-20T00:45:00.000Z' }, teachers: [{ id: 'member', name: '합성 교사' }], groupNames: ['1반'], roomNames: [], state: 'scheduled', canRequest: true, allowedTargets: [] }
const view = { asOf: at(0), timeZone: 'Asia/Seoul', from: '2026-10-18', until: '2026-10-31', canPublish: true, canRequest: true, drafts: [], lessons: [lesson], requests: [], publications: [] }
const references = { asOf: view.asOf, from: view.from, until: view.until, lessons: [{ lessonId: 'lesson', version: 1, groups: [{ id: 'group', name: '1반' }], rooms: [] }] }
function command(kind, variant = false) {
  if (kind === 'operations') return { kind: 'action', requestId: 'exchange', expectedVersion: 1, proposalHash: 'a'.repeat(64), action: variant ? 'reject' : 'accept' }
  if (kind === 'publication') {
    const body = { previewId: 'publication-preview', previewHash: 'b'.repeat(64), input: { draftId: 'draft', draftVersion: variant ? 2 : 1, from: '2026-10-20', until: '2026-10-31' }, timeZone: 'Asia/Seoul', createdAt: at(0), expiresAt: at(600000), basisFingerprint: 'c'.repeat(64), totalChanges: 1, pageSize: 200, pageHashes: ['d'.repeat(64)], blockerCount: 0, complete: true, preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
    return { kind: 'publish_manifest', manifest: { ...body, manifestHash: hash(body) } }
  }
  if (kind === 'school_day') {
    const input = { kind: 'closure', date: '2026-10-20', groupIds: ['group'], reason: variant ? '변경 사유' : '학교 행사', bells: [] }
    const body = { input, sourceAsOf: view.asOf, previewId: 'school-preview', createdAt: at(0), expiresAt: at(600000), complete: true, coverage: { date: input.date, groupIds: input.groupIds, complete: true, existingRequests: 'complete' }, affectedLessons: [{ lessonId: 'lesson', version: 1 }], changes: [{ before: clone(lesson), after: { ...clone(lesson), version: 2, state: 'cancelled', canRequest: false, allowedTargets: [] } }], requestEffects: [], blockers: [], preserved: { pastRecords: true, outsideTarget: true, existingChanges: 'retained' }, lostLessonCount: 1, lostSeconds: 2700, changesActualSchedule: false }
    return m.schoolDayCommitCommand({ ...body, previewHash: hash(body) }, clone(view), clone(references))
  }
  return { lessonId: 'past-lesson', expectedLessonVersion: 1, expectedRecordVersion: 0, expectedRecordId: null, outcome: 'completed', note: variant ? '수정한 내용' : '직접 확인', correctionReason: null }
}
const compact = (kind, c) => kind === 'publication' ? m.publicationCommitReference(c) : kind === 'school_day' ? m.schoolDayCompactCommand(c) : c
const contracts = { operations: 'timetable-operations.v1', publication: 'timetable-publication.v1', school_day: 'timetable-school-day.v1', execution: 'timetable.execution-records.v1' }
const constructors = { operations: m.createTimetableOperationsServer, publication: m.createPublicationExecutionServer, school_day: m.createSchoolDayExecutionServer, execution: m.createTimetableExecutionRecordsServer }
function receipt(kind, c, requestedKey = key) {
  const base = { requestKey: requestedKey, commandHash: hash(compact(kind, c)) }
  if (kind === 'operations') return { ...base, kind: c.kind, entityId: c.requestId, version: c.expectedVersion + 1, status: c.action === 'reject' ? 'rejected' : 'awaiting_approval', recordedAt: at(1000), changedLessons: [] }
  if (kind === 'publication') return { ...base, kind: c.kind, entityId: 'publication', version: 1, status: 'published', recordedAt: at(1000), manifestHash: c.manifest.manifestHash, basisFingerprint: c.manifest.basisFingerprint, changedCount: c.manifest.totalChanges }
  if (kind === 'school_day') return { ...base, kind: c.kind, entityId: 'day-event', version: 1, status: 'applied', recordedAt: at(1000), changedLessonCount: 1, changesHash: hash([{ id: 'lesson', version: 2 }]), lostLessonCount: 1 }
  return { ...base, record: { id: 'record', version: 1, lessonId: c.lessonId, lessonVersion: 1, outcome: c.outcome, note: c.note, correctionReason: null, recordedBy: { id: 'member', name: '합성 교사' }, recordedAt: at(1000) } }
}
function closed(kind, c, outcome = 'abandoned', requestedKey = key) {
  return { kind, requestKey: requestedKey, commandHash: hash(compact(kind, c)), outcome, receipt: outcome === 'applied' ? receipt(kind, c, requestedKey) : null, decidedAt: at(2000) }
}
const envelope = (contract, data) => ({ contract, schoolId: 'school', memberId: 'member', data })
const rejectEnvelope = (contract, code) => ({ contract, schoolId: 'school', memberId: 'member', error: { code } })
function connection(handler) {
  const calls = []; let live = clone(member), identity = { userId: 'user', approved: true }
  const value = { info: () => ({ memberships: [clone(live)], schools: [{ id: live.schoolId }], basisDate: '2026-10-18' }), getIdentity: async () => clone(identity), rpcVerified: async (name, args) => { calls.push({ name, args: clone(args) }); return handler(name, args) } }
  return { value, calls, change: patch => { live = { ...live, ...patch } }, identity: value => { identity = value } }
}
const wrong = expected => error => error?.code === expected
const rejects = (fn, code) => assert.rejects(async () => fn(), wrong(code))
let count = 0
async function test(name, run) { await run(); count++; console.log('  ✓ ' + name) }
for (const kind of Object.keys(contracts)) {
  await test(kind + ': 만료된 원문으로 모듈 조회 없이 정확한 닫기 RPC만 보낸다', async () => {
    const cmd = command(kind), c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd))), s = constructors[kind](c.value, { now: () => now + 3600000 })
    assert.deepEqual(await s.abandon('member', cmd, key), closed(kind, cmd))
    assert.deepEqual(c.calls, [{ name: 'workhub_timetable_operations_abandon', args: { p_kind: kind, p_command: compact(kind, cmd), p_request_key: key, p_member_id: 'member' } }])
    if (kind === 'publication') assert.equal(Object.hasOwn(c.calls[0].args.p_command, 'manifest'), false)
    if (kind === 'school_day') assert.equal(Object.hasOwn(c.calls[0].args.p_command, 'context'), false)
  })
  await test(kind + ': 이미 처리된 요청은 기존 strict 접수증을 돌려준다', async () => {
    const cmd = command(kind), c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd, 'applied'))), s = constructors[kind](c.value, { now: () => now + 3600000 })
    assert.deepEqual((await s.abandon('member', cmd, key)).receipt, receipt(kind, cmd))
  })
  await test(kind + ': 닫힌 번호는 조회·실행·재전송으로 다시 반영하지 않는다', async () => {
    const cmd = command(kind), c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd))), s = constructors[kind](c.value, { now: () => now + 2000 })
    await s.abandon('member', cmd, key)
    for (const method of ['recover', 'execute', 'resend']) await rejects(() => s[method]('member', cmd, key), 'CONFLICT')
    assert.equal(c.calls.length, 1)
    await rejects(() => s.abandon('member', command(kind, true), key), 'IDEMPOTENCY_CONFLICT')
    assert.equal(c.calls.length, 1)
    assert.deepEqual(await s.abandon('member', cmd, key), closed(kind, cmd))
    assert.deepEqual(c.calls[0].args, c.calls[1].args)
  })
  await test(kind + ': 알려진 접수증을 닫힘으로 뒤집지 않는다', async () => {
    const cmd = command(kind), c = connection(async name => name.endsWith('_abandon') ? envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd)) : envelope(contracts[kind], receipt(kind, cmd))), s = constructors[kind](c.value, { now: () => now + 2000 })
    await s.recover('member', cmd, key)
    await rejects(() => s.abandon('member', cmd, key), 'RESULT_UNKNOWN')
  })
  await test(kind + ': 원래 접수증과 다른 실제 결과는 닫힘 응답에서도 거부한다', async () => {
    const cmd = command(kind); let altered = false
    const c = connection(async name => { if (!name.endsWith('_abandon')) return envelope(contracts[kind], receipt(kind, cmd)); const result = closed(kind, cmd, 'applied'); if (kind === 'execution') result.receipt.record.id = 'other-record'; else result.receipt.recordedAt = at(1500); altered = true; return envelope(m.TIMETABLE_REQUEST_ABANDON_API, result) }), s = constructors[kind](c.value, { now: () => now + 2000 })
    await s.recover('member', cmd, key)
    await rejects(() => s.abandon('member', cmd, key), 'RESULT_UNKNOWN'); assert.equal(altered, true)
  })
  await test(kind + ': 닫기 응답 유실 뒤 같은 원문·번호로만 재시도한다', async () => {
    const cmd = command(kind); let calls = 0
    const c = connection(async () => { if (++calls === 1) throw Error('통신 단절'); return envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd)) }), s = constructors[kind](c.value, { now: () => now + 2000 })
    await rejects(() => s.abandon('member', cmd, key), 'RESULT_UNKNOWN')
    await rejects(() => s.abandon('member', command(kind, true), key), 'IDEMPOTENCY_CONFLICT')
    assert.equal((await s.abandon('member', cmd, key)).outcome, 'abandoned'); assert.deepEqual(c.calls[0].args, c.calls[1].args)
  })
  await test(kind + ': 닫기와 늦은 성공 응답이 모순되면 늦은 성공을 거부한다', async () => {
    const cmd = command(kind); let release
    const c = connection(async name => name.endsWith('_abandon') ? envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd)) : new Promise(resolve => { release = () => resolve(envelope(contracts[kind], receipt(kind, cmd))) })), s = constructors[kind](c.value, { now: () => now + 2000 })
    const pending = s.recover('member', cmd, key)
    while (!release) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal((await s.abandon('member', cmd, key)).outcome, 'abandoned'); release()
    await rejects(() => pending, 'INVALID_RESPONSE')
  })
  await test(kind + ': 재전송 쓰기와 닫힘이 모순되면 결과 미상으로 보존한다', async () => {
    const cmd = command(kind); let release
    const c = connection(async (name, args) => name.endsWith('_abandon') ? envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed(kind, cmd)) : args.p_recover_only ? rejectEnvelope(contracts[kind], 'NOT_FOUND') : new Promise(resolve => { release = () => resolve(envelope(contracts[kind], receipt(kind, cmd))) })), s = constructors[kind](c.value, { now: () => now + 2000 })
    await rejects(() => s.recover('member', cmd, key), 'NOT_FOUND')
    const pending = s.resend('member', cmd, key)
    while (!release) await new Promise(resolve => setTimeout(resolve, 1))
    await s.abandon('member', cmd, key); release()
    await rejects(() => pending, 'RESULT_UNKNOWN')
  })
  await test(kind + ': 만료 뒤 잘못된 명령은 전송 전에 INVALID_INPUT', async () => {
    const c = connection(() => assert.fail('잘못된 명령 전송 금지')), s = constructors[kind](c.value, { now: () => now + 3600000 })
    await rejects(() => s.abandon('member', { ...command(kind), extra: true }, key), 'INVALID_INPUT'); assert.equal(c.calls.length, 0)
    for (const invalidKey of ['short', 'invalid.key', 'invalid key', '한글-request']) await rejects(() => s.abandon('member', command(kind), invalidKey), 'INVALID_INPUT'); assert.equal(c.calls.length, 0)
  })
  await test(kind + ': 소속 범위가 바뀐 요청은 닫지 않는다', async () => {
    const cmd = command(kind), c = connection(() => assert.fail('이전 소속 전송 금지')), s = constructors[kind](c.value, { now: () => now + 2000 })
    const pending = s.abandon('member', cmd, key); c.change({ departmentIds: ['changed'] })
    await rejects(() => pending, 'CANCELLED'); assert.equal(c.calls.length, 0)
  })
  await test(kind + ': 이미 비활성 소속은 본인 확인을 우회하지 못한다', async () => {
    const c = connection(() => assert.fail('비활성 소속 전송 금지')); c.change({ active: false })
    await rejects(() => constructors[kind](c.value, { now: () => now + 2000 }).abandon('member', command(kind), key), 'INACTIVE_MEMBERSHIP'); assert.equal(c.calls.length, 0)
  })
  await test(kind + ': applied 접수증 자체의 변조도 기존 parser가 거부한다', async () => {
    const cmd = command(kind), result = closed(kind, cmd, 'applied'); result.receipt.commandHash = 'f'.repeat(64)
    const c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, result))
    await rejects(() => constructors[kind](c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'RESULT_UNKNOWN')
  })
}
for (const [label, modify] of [
  ['종류', value => value.kind = 'execution'], ['원키', value => value.requestKey = 'another-key'], ['지문', value => value.commandHash = 'e'.repeat(64)],
  ['없는 결과', value => value.outcome = 'cancelled'], ['추가 칸', value => value.extra = true], ['빠진 칸', value => delete value.receipt], ['닫힘에 접수증', value => value.receipt = {}],
  ['미래 시각', value => value.decidedAt = at(100000)], ['초 단위 시각', value => value.decidedAt = value.decidedAt.replace('.000', '')], ['존재하지 않는 날짜', value => value.decidedAt = '2026-02-30T00:00:00.000Z'],
  ['다른 시간대 표기', value => value.decidedAt = '2026-10-18T09:00:02.000+09:00'], ['null 시각', value => value.decidedAt = null],
]) await test('exact 닫힘 응답 변조 거부: ' + label, async () => {
  const cmd = command('operations'), value = closed('operations', cmd); modify(value)
  const c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, value))
  await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'RESULT_UNKNOWN')
})
for (const field of ['contract', 'schoolId', 'memberId']) await test('다른 ' + field + ' 봉투로 잠금 해제 금지', async () => {
  const cmd = command('operations'), c = connection(async () => ({ ...envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed('operations', cmd)), [field]: 'other' }))
  await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'RESULT_UNKNOWN')
})
for (const code of ['CONFLICT', 'IDEMPOTENCY_CONFLICT', 'FORBIDDEN', 'NOT_READY']) await test('서버 오류 ' + code + '는 닫힘으로 바꾸지 않는다', async () => {
  const cmd = command('operations'), c = connection(async () => rejectEnvelope(m.TIMETABLE_REQUEST_ABANDON_API, code)), s = m.createTimetableOperationsServer(c.value, { now: () => now + 2000 })
  await rejects(() => s.abandon('member', cmd, key), code)
})
await test('닫힌 원키의 결정시각은 다시 닫아도 달라질 수 없다', async () => {
  const cmd = command('operations'); let again = false
  const c = connection(async () => { const result = closed('operations', cmd); if (again) result.decidedAt = at(2500); return envelope(m.TIMETABLE_REQUEST_ABANDON_API, result) }), s = m.createTimetableOperationsServer(c.value, { now: () => now + 3000 })
  await s.abandon('member', cmd, key); again = true; await rejects(() => s.abandon('member', cmd, key), 'RESULT_UNKNOWN')
})
await test('applied 기록시각이 결정시각보다 늦으면 거부한다', async () => {
  const cmd = command('operations'), result = closed('operations', cmd, 'applied'); result.decidedAt = at(500)
  const c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, result))
  await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'RESULT_UNKNOWN')
})
await test('시간초과 닫기 뒤 늦은 응답이 로컬 원키를 닫지 않는다', async () => {
  const cmd = command('operations'); let release
  const c = connection(async name => name.endsWith('_abandon') ? new Promise(resolve => { release = () => resolve(envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed('operations', cmd))) }) : envelope(contracts.operations, receipt('operations', cmd))), s = m.createTimetableOperationsServer(c.value, { now: () => now + 2000, timeoutMs: 30 })
  await rejects(() => s.abandon('member', cmd, key), 'RESULT_UNKNOWN'); release(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(await s.recover('member', cmd, key), receipt('operations', cmd))
})
await test('소속 변화가 응답 중 발생하면 닫힘 접수증을 화면으로 돌려주지 않는다', async () => {
  const cmd = command('operations'), c = connection(async () => { c.change({ subjectIds: ['changed'] }); return envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed('operations', cmd)) })
  await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'CANCELLED')
})
await test('applied 응답은 접수증이 없거나 배열이면 닫힘으로 인정하지 않는다', async () => {
  for (const missing of [null, [], {}]) {
    const cmd = command('operations'), result = closed('operations', cmd, 'applied'); result.receipt = missing
    const c = connection(async () => envelope(m.TIMETABLE_REQUEST_ABANDON_API, result))
    await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', cmd, key), 'RESULT_UNKNOWN')
  }
})
await test('원래 요청 성공이 닫기보다 먼저 도착하면 모순된 닫힘을 받아들이지 않는다', async () => {
  const cmd = command('operations'); let release
  const c = connection(async name => name.endsWith('_abandon') ? new Promise(resolve => { release = () => resolve(envelope(m.TIMETABLE_REQUEST_ABANDON_API, closed('operations', cmd))) }) : envelope(contracts.operations, receipt('operations', cmd))), s = m.createTimetableOperationsServer(c.value, { now: () => now + 2000 })
  const pending = s.abandon('member', cmd, key)
  while (!release) await new Promise(resolve => setTimeout(resolve, 1))
  assert.deepEqual(await s.recover('member', cmd, key), receipt('operations', cmd)); release()
  await rejects(() => pending, 'RESULT_UNKNOWN')
})
for (const identity of [{ userId: 'other-user', approved: true }, { userId: 'user', approved: false }]) await test('계정·승인 본인 확인 실패는 닫기 호출을 보내지 않는다: ' + identity.userId + '/' + identity.approved, async () => {
  const c = connection(() => assert.fail('인증 불일치 전송 금지')); c.identity(identity)
  await rejects(() => m.createTimetableOperationsServer(c.value, { now: () => now + 2000 }).abandon('member', command('operations'), key), 'CANCELLED')
  assert.equal(c.calls.length, 0)
})
await test('직접 parser 소비자도 위조 응답은 INVALID_RESPONSE로 받는다', async () => {
  const cmd = command('operations'), value = closed('operations', cmd)
  const parsed = await m.parseRequestAbandonResult(value, 'operations', key, hash(cmd), () => assert.fail('abandoned에서 접수증 파싱 금지'), now + 2000)
  assert.deepEqual(parsed, value)
  await rejects(() => m.parseRequestAbandonResult({ ...value, extra: true }, 'operations', key, hash(cmd), value => value, now + 2000), 'INVALID_RESPONSE')
})
console.log(`시간표 원키 닫기·접수증·범위·경합 검증 ${count}개 통과`)
