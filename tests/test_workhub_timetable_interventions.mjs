import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const api = await loadBrowserModule(`
export * from '../apps/workhub/src/timetable/interventions-domain'
export * from '../apps/workhub/src/timetable/interventions-server'
export * from '../apps/workhub/src/timetable/interventions-assistant'
`)
const now = Date.parse('2026-10-20T00:00:00.000Z'), iso = '2026-10-20T00:00:00.000Z'
const span = { startsAt: '2026-10-21T01:00:00.000Z', endsAt: '2026-10-21T01:45:00.000Z' }
const nextSpan = { startsAt: '2026-10-22T01:00:00.000Z', endsAt: '2026-10-22T01:45:00.000Z' }
const teacher = (id = 'm1') => ({ id, name: '교사 ' + id })
const lesson = (patch = {}) => ({ id: 'l1', version: 1, label: '국어 1회', time: { ...span }, teachers: [teacher()], groupNames: ['1-1'], roomNames: ['1-1'], state: 'scheduled', canRequest: true, allowedTargets: [{ ...nextSpan }], ...patch })
const source = () => ({ asOf: iso, timeZone: 'Asia/Seoul', from: '2026-10-20', until: '2026-10-27', lessons: [lesson()], teachers: [teacher(), teacher('m2')], closures: [], requests: [] })
const input = () => ({ kind: 'substitute', lessonId: 'l1', expectedVersion: 1, substituteTeacherId: 'm2', reason: '연수로 대강 요청' })
const preview = () => ({ previewId: 'p1', previewHash: 'a'.repeat(64), createdAt: iso, expiresAt: '2026-10-20T00:15:00.000Z', input: input(), complete: true,
  changes: [{ before: lesson({ canRequest: false, allowedTargets: [] }), after: lesson({ version: 2, teachers: [teacher('m2')], canRequest: false, allowedTargets: [] }) }],
  participants: [teacher(), teacher('m2')], blockers: [], hours: { removedSeconds: 0, addedSeconds: 0 } })
const command = () => api.interventionSubmit(preview())
const key = 'request-one', digest = await api.interventionHash(command())
const receipt = (patch = {}) => ({ requestKey: key, commandHash: digest, kind: 'submit', entityId: 'request-entity', version: 1, status: 'awaiting_consent', recordedAt: iso, changedLessons: [], ...patch })
const request = (patch = {}) => ({ id: 'request-entity', version: 1, proposalHash: 'a'.repeat(64), state: 'awaiting_consent', kind: 'substitute', input: input(), requester: teacher(), requesterIsViewer: true, createdAt: iso, expiresAt: '2026-10-21T00:00:00.000Z', reason: input().reason, changes: preview().changes, participants: [teacher(), teacher('m2')].map(t => ({ ...t, response: 'pending', respondedAt: null })), actions: ['accept', 'reject', 'withdraw'], ...patch })
const member = { id: 'm1', schoolId: 'school-one', userId: 'user-one', name: '교사 1', role: 'school_admin', active: true, validFrom: '2020-01-01', validThrough: '2100-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const envelope = data => ({ contract: 'timetable-interventions.v1', schoolId: member.schoolId, memberId: member.id, data })
function fixture(run) {
  let current = structuredClone(member)
  const calls = []
  const identity = { userId: member.userId, approved: true, profile: { role: 'superadmin', is_active: true, department_id: null, extra_permissions: [] } }
  const connection = { info: () => ({ memberships: [current], schools: [{ id: current.schoolId }], basisDate: '2026-10-20' }), getIdentity: async () => identity,
    rpcVerified: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return run ? run(name, args) : envelope(receipt()) } }
  return { server: api.createTimetableInterventionsServer(connection, { now: () => now, timeoutMs: 1000 }), calls, connection, changeMember: value => { current = value } }
}
let total = 0
async function test(name, run) { await run(); total++; console.log('  ✓', name) }
const invalid = fn => assert.throws(fn, e => e.code === 'INVALID_RESPONSE')
const rejects = (fn, code) => assert.rejects(async () => fn(), e => e.code === code)
await test('T3 함수 부재만 NOT_READY로 구분하고 통신·권한 오류는 유지', async () => {
  for (const method of ['readiness', 'summary', 'resolve']) {
    const call = f => method === 'resolve' ? f.server.resolve(member.id, 'source-one') : f.server[method](member.id)
    await rejects(() => call(fixture(() => { throw { code: 'PGRST202' } })), 'NOT_READY')
    await rejects(() => call(fixture(() => { throw { code: 'QUERY_FAILED', rpcCode: 'PGRST202' } })), 'NOT_READY')
    await rejects(() => call(fixture(() => { throw Error('network') })), 'QUERY_FAILED')
    await rejects(() => call(fixture(() => { throw { code: 'FORBIDDEN' } })), 'FORBIDDEN')
  }
})
await test('대강은 기존 수업·시수와 전체 당사자 동의를 보존', () => assert.deepEqual(api.parseInterventionPreview(preview(), input(), source(), now), preview()))
await test('조회용 권한 플래그와 미리보기 권한 플래그 차이는 내용 변경으로 보지 않음', () => {
  assert.equal(source().lessons[0].canRequest, true)
  assert.equal(api.parseInterventionPreview(preview(), input(), source(), now).changes[0].before.canRequest, false)
})
await test('원수업 판·시각·학급 변경과 대강 교사 위조는 거부', () => {
  for (const edit of [p => p.changes[0].before.version = 2, p => p.changes[0].after.groupNames = ['2-1'], p => p.changes[0].after.teachers = [teacher('other')], p => p.changes[0].after.time = nextSpan]) {
    const p = preview(); edit(p); invalid(() => api.parseInterventionPreview(p, input(), source(), now))
  }
})
await test('공동수업 당사자 누락 및 중복 동의 대상 거부', () => {
  const p = preview(); p.participants = [teacher('m2')]; invalid(() => api.parseInterventionPreview(p, input(), source(), now))
  p.participants = [teacher(), teacher(), teacher('m2')]; invalid(() => api.parseInterventionPreview(p, input(), source(), now))
})
await test('다른 요청·과거 만료·과도한 유효시간 미리보기 거부', () => {
  for (const patch of [{ input: { ...input(), reason: '다른 요청' } }, { expiresAt: iso }, { expiresAt: '2026-10-20T01:00:00.000Z' }]) invalid(() => api.parseInterventionPreview({ ...preview(), ...patch }, input(), source(), now))
})
await test('휴강의 결손 초를 응답 숫자로 믿지 않고 검산', () => {
  const i = { kind: 'cancel', lessonId: 'l1', expectedVersion: 1, reason: '행사' }, p = preview()
  Object.assign(p, { input: i, participants: [teacher()], changes: [{ before: lesson(), after: lesson({ version: 2, state: 'cancelled', canRequest: false }) }], hours: { removedSeconds: 2700, addedSeconds: 0 } })
  assert.equal(api.parseInterventionPreview(p, i, source(), now).hours.removedSeconds, 2700)
  p.hours.removedSeconds--; invalid(() => api.parseInterventionPreview(p, i, source(), now))
})
await test('보강은 취소 원수업을 유지하고 새 수업 ID·같은 길이로 생성', () => {
  const s = source(); s.lessons = [lesson({ state: 'cancelled', canRequest: false })]
  const i = { kind: 'makeup', lessonId: 'l1', expectedVersion: 1, target: nextSpan, reason: '미실시 보강' }, p = preview()
  Object.assign(p, { input: i, participants: [teacher()], changes: [{ before: null, after: lesson({ id: 'new-lesson', time: nextSpan, canRequest: false }) }], hours: { removedSeconds: 0, addedSeconds: 2700 } })
  assert.equal(api.parseInterventionPreview(p, i, s, now).changes[0].after.id, 'new-lesson')
  p.changes[0].after.id = 'l1'; invalid(() => api.parseInterventionPreview(p, i, s, now))
})
await test('보강의 원담당·학급 바꾸기와 과거 원판 바꾸기는 거부', () => {
  const s = source(); s.lessons = [lesson({ state: 'cancelled', canRequest: false })]
  const i = { kind: 'makeup', lessonId: 'l1', expectedVersion: 1, target: nextSpan, reason: '보강' }
  for (const patch of [{ teachers: [teacher('m2')] }, { groupNames: ['2-1'] }, { label: '수학' }]) {
    const p = { ...preview(), input: i, participants: [teacher()], changes: [{ before: null, after: lesson({ id: 'new-lesson', time: nextSpan, ...patch }) }], hours: { removedSeconds: 0, addedSeconds: 2700 } }
    invalid(() => api.parseInterventionPreview(p, i, s, now))
  }
})
await test('휴업 취소는 원휴업의 전체 수업을 복구', () => {
  const s = source(); s.lessons = [lesson({ state: 'cancelled', canRequest: false })]; s.closures = [{ id: 'closure-one', date: '2026-10-21', reason: '휴업', lessonIds: ['l1'], reopened: false }]
  const i = { kind: 'reopen', schoolDayChangeId: 'closure-one', reason: '휴업 취소' }, p = { ...preview(), input: i, participants: [teacher()], changes: [{ before: s.lessons[0], after: lesson({ version: 2 }) }], hours: { removedSeconds: 0, addedSeconds: 2700 } }
  assert.equal(api.parseInterventionPreview(p, i, s, now).input.kind, 'reopen')
  s.closures[0].lessonIds.push('missing'); invalid(() => api.parseInterventionPreview(p, i, s, now))
})
await test('요청 목록은 교사 동의 전 승인과 본인 승인을 거부', () => {
  const s = source(); s.requests = [request()]
  assert.equal(api.parseInterventionsView(s, 'm1', s.from, s.until, now).requests.length, 1)
  s.requests[0].actions = ['approve']; invalid(() => api.parseInterventionsView(s, 'm1', s.from, s.until, now))
  s.requests[0].state = 'awaiting_approval'; s.requests[0].participants.forEach(p => { p.response = 'accepted'; p.respondedAt = iso }); invalid(() => api.parseInterventionsView(s, 'm1', s.from, s.until, now))
})
await test('별도 승인자의 정상 승인 가능 상태 수신', () => {
  const s = source(); s.requests = [request({ state: 'awaiting_approval', requesterIsViewer: false, actions: ['approve', 'rejectApproval'] })]
  s.requests[0].participants.forEach(p => { p.response = 'accepted'; p.respondedAt = iso })
  assert.equal(api.parseInterventionsView(s, 'manager', s.from, s.until, now).requests[0].actions[0], 'approve')
})
await test('원접수증 요청 번호·명령 해시·판·상태를 대조', () => {
  assert.deepEqual(api.parseInterventionReceipt(receipt(), command(), key, digest, now), receipt())
  for (const patch of [{ requestKey: 'different' }, { commandHash: 'f'.repeat(64) }, { version: 2 }, { status: 'applied' }]) invalid(() => api.parseInterventionReceipt(receipt(patch), command(), key, digest, now))
})
await test('닫힘은 원키 장벽 또는 원접수증이며 CONFLICT를 닫힘으로 추정하지 않음', () => {
  const closed = { requestKey: key, commandHash: digest, outcome: 'closed', receipt: null, decidedAt: iso }
  assert.equal(api.parseInterventionClose(closed, command(), key, digest, now).outcome, 'closed')
  assert.equal(api.parseInterventionClose({ ...closed, outcome: 'applied', receipt: receipt() }, command(), key, digest, now).receipt.entityId, 'request-entity')
  for (const patch of [{ outcome: 'CONFLICT' }, { receipt: receipt() }, { requestKey: 'other' }, { decidedAt: '2026-10-19T00:00:00.000Z', outcome: 'applied', receipt: receipt() }]) invalid(() => api.parseInterventionClose({ ...closed, ...patch }, command(), key, digest, now))
})
await test('미설정·승인자 부족 준비 상태와 서버 알림 원본 해석', () => {
  assert.equal(api.parseInterventionsReadiness({ available: false, reason: 'approvers_missing' }).available, false)
  invalid(() => api.parseInterventionsReadiness({ available: true, reason: 'not_allowed' }))
  assert.equal(api.parseInterventionSource({ kind: 'school_day', requestId: null, schoolDayChangeId: 'closure-one', date: '2026-10-21', lessonId: 'l1' }).kind, 'school_day')
  invalid(() => api.parseInterventionSource({ kind: 'school_day', requestId: 'wrong', schoolDayChangeId: 'closure-one', date: '2026-10-21', lessonId: 'l1' }))
})
await test('홈 요약은 20건 한도와 전체 개수·항목 종류 대조', () => {
  const s = { asOf: iso, pendingConsent: 1, pendingApproval: 0, makeupNeeded: 0, items: [{ id: 'i1', kind: 'consent', label: '대강', date: '2026-10-21', lessonId: 'l1', requestId: 'r1' }] }
  assert.equal(api.parseInterventionsSummary(s, now).items.length, 1)
  invalid(() => api.parseInterventionsSummary({ ...s, pendingConsent: 0 }, now))
  invalid(() => api.parseInterventionsSummary({ ...s, items: Array.from({ length: 21 }, (_, i) => ({ ...s.items[0], id: 'i' + i })) }, now))
})
await test('로컬 입력 오류는 전송 전에 INVALID_INPUT', async () => {
  const f = fixture()
  await rejects(() => f.server.preview(member.id, { ...input(), expectedVersion: 0 }, source()), 'INVALID_INPUT')
  assert.equal(f.calls.length, 0)
})
await test('쓰기 결과 미상 후 원키·원문 복구, 다른 내용 재사용 거부', async () => {
  let first = true
  const f = fixture(() => { if (first) { first = false; throw Error('network') } return envelope(receipt()) })
  await rejects(() => f.server.execute(member.id, command(), key), 'RESULT_UNKNOWN')
  assert.equal((await f.server.recover(member.id, command(), key)).entityId, 'request-entity')
  assert.equal(f.calls[0].args.p_recover_only, false); assert.equal(f.calls[1].args.p_recover_only, true)
  assert.deepEqual(f.calls[0].args.p_command, f.calls[1].args.p_command)
  const changed = command(); changed.preview.input.reason = '새 내용'
  await rejects(() => f.server.execute(member.id, changed, key), 'IDEMPOTENCY_CONFLICT')
  assert.equal(f.calls.length, 2)
})
await test('닫기 뒤 늦은 실행은 로컬에서도 차단하고 닫기 원응답만 수신', async () => {
  const f = fixture(() => envelope({ requestKey: key, commandHash: digest, outcome: 'closed', receipt: null, decidedAt: iso }))
  await f.server.close(member.id, command(), key)
  await rejects(() => f.server.execute(member.id, command(), key), 'CONFLICT')
  assert.equal(f.calls.length, 1)
})
await test('이미 처리된 접수증과 닫힘으로 뒤집힌 결과는 허용하지 않음', async () => {
  const f = fixture(name => envelope(name.endsWith('_close') ? { requestKey: key, commandHash: digest, outcome: 'closed', receipt: null, decidedAt: iso } : receipt()))
  await f.server.execute(member.id, command(), key)
  await rejects(() => f.server.close(member.id, command(), key), 'RESULT_UNKNOWN')
})
await test('모듈 준비 상태를 다시 확인하지 않고 원번호 복구', async () => {
  const f = fixture()
  await f.server.recover(member.id, command(), key)
  assert.deepEqual(f.calls.map(row => row.name), ['workhub_timetable_interventions_execute'])
})
await test('학교 바뀐 응답과 다른 학교 봉투는 노출하지 않음', async () => {
  const f = fixture(() => ({ ...envelope(receipt()), schoolId: 'another' }))
  await rejects(() => f.server.execute(member.id, command(), key), 'RESULT_UNKNOWN')
  let g; g = fixture(() => { g.changeMember({ ...member, schoolId: 'another' }); return envelope(receipt()) })
  await rejects(() => g.server.execute(member.id, command(), key), 'CANCELLED')
})
function aiResult(req, value) { return { state: 'completed', requestKey: key, thread: { exchanges: [{ requestKey: key, prompt: req.input.prompt, intent: req.input.intent, segments: [{ text: JSON.stringify(value), citations: [] }] }] } } }
await test('긴 학교 목록은 후보 수를 줄여 기존 비서 4000자 한도를 유지', async () => {
  const data = source()
  data.lessons = Array.from({ length: 30 }, (_, i) => lesson({ id: i ? 'lesson-' + i : 'l1', label: '긴 수업 이름'.repeat(20), groupNames: Array.from({ length: 20 }, () => '학급'.repeat(20)) }))
  data.teachers = Array.from({ length: 30 }, (_, i) => ({ id: 'teacher-' + i, name: '교사 이름'.repeat(20) }))
  const exchanges = { ...data, canRequest: true, canPublish: false, drafts: [], publications: [] }
  exchanges.lessons = exchanges.lessons.map(row => ({ ...row, allowedTargets: Array.from({ length: 20 }, () => nextSpan) }))
  const request = await api.buildOperationsAiRequest(data, exchanges, 'l1', '요청'.repeat(450))
  assert(Array.from(request.input.prompt).length <= 4000); assert.equal(request.lessons[0], 'l1'); assert(request.input.prompt.includes('요청'.repeat(450)))
})
await test('Claude 상담은 별칭·조회 일부만 보내고 기존 school_advice 사용', async () => {
  const req = await api.buildOperationsAiRequest(source(), null, 'l1', '대강 부탁합니다')
  assert.equal(req.input.intent, 'school_advice'); assert.equal(req.input.studentContext, null)
  assert(!req.input.prompt.includes('"m1"')); assert(!req.input.prompt.includes('"id":"l1"'))
  const result = api.parseOperationsAiAnswer(aiResult(req, { contextHash: req.fingerprint, summary: '대강 제안', questions: [], proposal: { kind: 'substitute', lesson: 'l0', teacher: 't1', reason: '연수' } }), req, key)
  assert.equal(result.proposal.substituteTeacherId, 'm2')
})
await test('AI가 다른 범위 교사나 원시 ID·수업을 제안하면 입력에 채우지 않음', async () => {
  const req = await api.buildOperationsAiRequest(source(), null, 'l1', '대강')
  for (const proposal of [{ kind: 'substitute', lesson: 'l0', teacher: 'm2', reason: '사유' }, { kind: 'substitute', lesson: 'l0', teacher: 't99', reason: '사유' }, { kind: 'cancel', lesson: 'l9', reason: '사유' }]) assert.equal(api.parseOperationsAiAnswer(aiResult(req, { contextHash: req.fingerprint, summary: '검토', questions: [], proposal }), req, key).proposal, null)
})
await test('AI의 확인 질문·오래된 지문·완료 안 된 요청으로 실행하지 않음', async () => {
  const req = await api.buildOperationsAiRequest(source(), null, 'l1', '일정이 있어요')
  assert.equal(api.parseOperationsAiAnswer(aiResult(req, { contextHash: req.fingerprint, summary: '날짜 확인', questions: ['언제인가요?'], proposal: null }), req, key).questions.length, 1)
  assert.equal(api.parseOperationsAiAnswer(aiResult(req, { contextHash: 'x'.repeat(64), summary: '취소', questions: [], proposal: { kind: 'cancel', lesson: 'l0', reason: '사유' } }), req, key).proposal, null)
  invalid(() => api.parseOperationsAiAnswer({ state: 'pending', requestKey: key }, req, key))
})
await test('수업판과 명단 변화는 AI 근거 지문을 바꾸고 단순 조회시각은 유지', async () => {
  const s = source(), before = await api.operationsAiFingerprint(s, null)
  s.asOf = '2026-10-20T00:01:00.000Z'; assert.equal(await api.operationsAiFingerprint(s, null), before)
  s.lessons[0].version++; assert.notEqual(await api.operationsAiFingerprint(s, null), before)
})
await test('내 확인·진행·종료 필터는 서버 행동을 늘리지 않고 우선순위 정렬', () => {
  const rows = [request({ id: 'done', state: 'applied', actions: [] }), request({ id: 'waiting', actions: ['withdraw'] }), request({ id: 'mine' })]
  const before = structuredClone(rows)
  assert.deepEqual(api.selectInterventionRequests(rows, { query: '', filter: 'all' }, now).map(row => row.id), ['mine', 'waiting', 'done'])
  assert.deepEqual(api.selectInterventionRequests(rows, { query: '', filter: 'mine' }, now).map(row => row.id), ['mine'])
  assert.deepEqual(api.selectInterventionRequests(rows, { query: '', filter: 'finished' }, now).map(row => row.id), ['done'])
  assert.deepEqual(rows, before)
})
await test('요청 검색은 학급·수업·사유·교사와 종류를 함께 좁힘', () => {
  const rows = [request(), request({ id: 'other', kind: 'cancel', reason: '다른 이유' })]
  assert.equal(api.selectInterventionRequests(rows, { query: '1-1 연수', filter: 'all', kind: 'substitute' }, now).length, 1)
  assert.equal(api.selectInterventionRequests(rows, { query: '없는 교사', filter: 'all' }, now).length, 0)
})
await test('화면에서 기한이 지나도 원문은 유지하고 내 확인 수에서 제외', () => {
  const row = request(), late = Date.parse(row.expiresAt)
  assert.equal(api.interventionDisplayState(row, late), 'expired')
  assert.equal(api.interventionNeedsMyAction(row, late), false); assert.equal(row.state, 'awaiting_consent')
  assert.equal(api.selectInterventionRequests([row], { query: '', filter: 'finished' }, late).length, 1)
})
await test('같은 대상·판·대강 교사는 사유만 바꿔 중복 전송하지 않음', () => {
  const row = request()
  assert.equal(api.duplicateInterventionRequests({ ...input(), reason: '다시 쓴 사유' }, [row], now).length, 1)
  assert.equal(api.duplicateInterventionRequests({ ...input(), substituteTeacherId: 'm3' }, [row], now).length, 0)
  assert.equal(api.duplicateInterventionRequests(input(), [{ ...row, state: 'rejected' }], now).length, 0)
  assert.equal(api.duplicateInterventionRequests(input(), [row], Date.parse(row.expiresAt)).length, 0)
})
await test('반영된 보강은 날짜·판·사유를 바꾸어도 같은 원수업 중복을 안내', () => {
  const i = { kind: 'makeup', lessonId: 'l1', expectedVersion: 1, target: nextSpan, reason: '보강' }
  const row = request({ kind: 'makeup', input: i, state: 'applied' })
  assert.equal(api.duplicateInterventionRequests({ ...i, expectedVersion: 2, target: span }, [row], now).length, 1)
  assert.equal(api.duplicateInterventionRequests({ ...i, lessonId: 'other' }, [row], now).length, 0)
})
await test('대강 같은 교사·없는 대상·지난 수업을 RPC 전에 설명', () => {
  const s = source()
  assert.match(api.interventionInputProblem({ ...input(), substituteTeacherId: 'm1' }, s, now), /다른 대강/)
  assert.match(api.interventionInputProblem({ ...input(), substituteTeacherId: 'unknown' }, s, now), /현재 학교/)
  assert.match(api.interventionInputProblem(input(), s, Date.parse(span.startsAt)), /이미 시작/)
  assert.equal(api.interventionInputProblem(input(), s, now), null)
})
await test('보강 길이·미래 시각·자정 경계는 원수업 기준으로 확인', () => {
  const s = source(); s.lessons[0].state = 'cancelled'
  const i = { kind: 'makeup', lessonId: 'l1', expectedVersion: 1, target: nextSpan, reason: '보강' }
  assert.equal(api.interventionInputProblem(i, s, now), null)
  assert.match(api.interventionInputProblem(i, s, Date.parse(nextSpan.startsAt)), /현재 시각 이후/)
  assert.match(api.interventionInputProblem({ ...i, target: { ...nextSpan, endsAt: '2026-10-22T02:00:00.000Z' } }, s, now), /원수업과 같게/)
  assert.match(api.interventionInputProblem({ ...i, target: { startsAt: '2026-10-22T14:30:00.000Z', endsAt: '2026-10-22T15:15:00.000Z' } }, s, now), /같은 날/)
  assert.equal(api.interventionInputProblem({ ...i, target: { startsAt: '2026-10-22T14:15:00.000Z', endsAt: '2026-10-22T15:00:00.000Z' } }, s, now), null)
})
console.log(`시간표 실제 운영 확장 ${total}건 통과`)
