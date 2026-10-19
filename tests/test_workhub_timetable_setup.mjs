import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/setup'; export { createTimetableSetupServer } from '../apps/workhub/src/timetable/setup-server';`)
const source = {
  termId: 'term', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', referenceDay: '2026-10-19',
  sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), canEdit: true,
  spaces: [{ id: 'room', kind: 'room', label: '과학실', capacity: null, version: 3 }, { id: 'equipment', kind: 'equipment', label: '태블릿', capacity: 2, version: 1 }],
  classes: [{ id: 'class-1', label: '1학년 1반', grade: 1 }, { id: 'class-2', label: '1학년 1반', grade: 1 }],
  courses: [{ id: 'course', label: '과학', inTimetable: true, teacherLabels: ['합성 교사'], studentCount: 24, link: null }, { id: 'course-2', label: '과학', inTimetable: true, teacherLabels: ['합성 교사'], studentCount: 12, link: { version: 2, studentGroup: false, classIds: ['class-2'], spaceIds: [] } }], findings: [],
}
const create = { kind: 'space_save', spaceId: null, expectedVersion: null, input: { kind: 'room', label: '  음악실  ', capacity: null } }
const update = { kind: 'space_save', spaceId: 'room', expectedVersion: 3, input: { kind: 'room', label: '과학실', capacity: 2 } }
const remove = { kind: 'space_remove', spaceId: 'room', expectedVersion: 3 }
const link = { kind: 'course_link', courseId: 'course', expectedVersion: null, input: { classIds: ['class-1'], studentGroup: false, spaceIds: ['room'] } }
const membership = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 관리자', role: 'calendar_manager', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
let checks = 0
async function check(name, run) { await run(); checks++; console.log('  ✓ ' + name) }
const code = expected => error => error?.code === expected
const receipt = (command, key = 'request-1') => ({ requestKey: key, kind: command.kind, targetId: command.kind === 'course_link' ? command.courseId : command.spaceId ?? 'new-room', version: (command.expectedVersion ?? 0) + 1, sourceFingerprint: 'b'.repeat(64) })
function connection() {
  const calls = [], receipts = new Map(), commands = new Map()
  let snapshot = structuredClone(source), members = [structuredClone(membership)], identity = { userId: 'user', approved: true, profile: { role: 'superadmin', is_active: true } }, failure = null, getFailure = false, transform = raw => raw, pause = null
  const envelope = data => ({ contract: 'timetable.setup.v1', schoolId: 'school', memberId: 'member', data })
  const serverError = code => ({ contract: 'timetable.setup.v1', schoolId: 'school', memberId: 'member', error: { code } })
  const value = {
    info: () => ({ memberships: structuredClone(members), schools: [{ id: 'school' }, { id: 'other' }], basisDate: '2026-10-19' }),
    getIdentity: async () => structuredClone(identity),
    rpcVerified: async (name, args) => {
      calls.push({ name, args: structuredClone(args) })
      if (pause) await pause
      if (name.endsWith('_get')) { if (getFailure) throw Error('offline'); return transform(envelope(structuredClone(snapshot))) }
      const key = args.p_request_key, command = args.p_command
      if (commands.has(key) && JSON.stringify(commands.get(key)) !== JSON.stringify(command)) return serverError('IDEMPOTENCY_CONFLICT')
      if (args.p_recover_only) return transform(receipts.has(key) ? envelope(structuredClone(receipts.get(key))) : serverError('NOT_FOUND'))
      if (failure && failure !== 'dropped') return serverError(failure)
      commands.set(key, structuredClone(command)); receipts.set(key, receipt(command, key))
      if (failure === 'dropped') { failure = null; throw Error('dropped') }
      return transform(envelope(structuredClone(receipts.get(key))))
    },
  }
  return { value, calls, receipts, setSource: x => snapshot = structuredClone(x), failGet: () => getFailure = true, setFailure: x => failure = x, transform: x => transform = x, setIdentity: x => identity = x, setMember: x => members = [x], pause: promise => pause = promise }
}
await check('미완성 정원 null과 같은 이름의 학급·수업은 ID별 그대로 보존한다', () => {
  const parsed = m.setupSnapshot(source); assert.deepEqual(parsed, source); parsed.spaces[0].capacity = 1; assert.equal(source.spaces[0].capacity, null)
})
await check('빠진 학급·공간 참조와 지원하지 않는 수업 ID를 진단용으로 읽는다', () => {
  const diagnostic = structuredClone(source)
  diagnostic.courses.push({ id: '지원 불가/수업', label: '지원 불가 수업', inTimetable: false, teacherLabels: [], studentCount: 0, link: { version: 1, studentGroup: false, classIds: ['removed-class'], spaceIds: ['removed-room'] } })
  diagnostic.findings = [{ code: 'COURSE_ID_UNSUPPORTED', targetId: '지원 불가/수업', message: '수업 식별자를 확인해 주세요.', blocksConfirm: true }, { code: 'LINK_SPACE_REMOVED', targetId: '지원 불가/수업', message: '빠진 공간 연결을 다시 고르세요.', blocksConfirm: true }, { code: 'TEACHER_LEAVES_IN_TERM', targetId: 'course', message: '교사 소속 기간을 확인해 주세요.', blocksConfirm: true }]
  assert.deepEqual(m.setupSnapshot(diagnostic), diagnostic)
  assert.throws(() => m.setupCommand({ ...link, courseId: '지원 불가/수업' }, diagnostic), code('INVALID_INPUT'))
})
for (const [name, mutate] of [
  ['잘못된 실제 날짜', x => x.firstDay = '2026-02-30'], ['뒤집힌 학기', x => x.firstDay = '2028-01-01'], ['기준일 범위 이탈', x => x.referenceDay = '2027-03-01'],
  ['지문 손상', x => x.sourceFingerprint = 'wrong'], ['최상위 추가 필드', x => x.secret = true], ['배열 자리에 null', x => x.spaces = null],
  ['공간 중복 ID', x => x.spaces.push(structuredClone(x.spaces[0]))], ['학급 중복 ID', x => x.classes.push(structuredClone(x.classes[0]))], ['수업 중복 ID', x => x.courses.push(structuredClone(x.courses[0]))],
  ['권한 거짓 표시', x => x.canEdit = false], ['알 수 없는 진단', x => x.findings.push({ code: 'UNKNOWN', targetId: 'course', message: '설명', blocksConfirm: true })],
  ['진단 차단 여부 바꿔치기', x => x.findings.push({ code: 'TEACHER_LEAVES_IN_TERM', targetId: 'course', message: '설명', blocksConfirm: false })],
  ['공간 판 0', x => x.spaces[0].version = 0], ['정원 소수', x => x.spaces[0].capacity = 1.5], ['수업 교사 문자열 배열 아님', x => x.courses[0].teacherLabels = '교사'],
]) await check('깨진 서버 원본 거부: ' + name, () => { const bad = structuredClone(source); mutate(bad); assert.throws(() => m.setupSnapshot(bad), code('INVALID_RESPONSE')) })
await check('정원 미입력·상한값과 코드포인트 100자의 공간 이름을 허용한다', () => {
  assert.deepEqual(m.setupCommand(create, source), create)
  assert.equal(m.setupCommand({ ...create, input: { ...create.input, label: '😀'.repeat(100), capacity: 1000 } }).input.capacity, 1000)
})
for (const [name, command] of [
  ['공간 판 짝 불일치', { ...create, expectedVersion: 1 }], ['정원 0', { ...create, input: { ...create.input, capacity: 0 } }], ['정원 1001', { ...create, input: { ...create.input, capacity: 1001 } }],
  ['숫자 문자열', { ...create, input: { ...create.input, capacity: '1' } }], ['101자 이름', { ...create, input: { ...create.input, label: '😀'.repeat(101) } }], ['빈 이름', { ...create, input: { ...create.input, label: ' ' } }],
  ['이름 줄바꿈', { ...create, input: { ...create.input, label: '음악\n실' } }], ['이름 단독 서로게이트', { ...create, input: { ...create.input, label: '\ud800' } }],
  ['학급·수강집단 동시 지정', { ...link, input: { ...link.input, studentGroup: true } }], ['학급 중복', { ...link, input: { ...link.input, classIds: ['class-1', 'class-1'] } }],
  ['학급 21개', { ...link, input: { ...link.input, classIds: Array.from({ length: 21 }, (_, i) => 'c' + i) } }], ['공간 11개', { ...link, input: { ...link.input, spaceIds: Array.from({ length: 11 }, (_, i) => 's' + i) } }],
  ['숨은 입력 필드', { ...link, input: { ...link.input, teacherId: 'user' } }], ['삭제 판 null', { ...remove, expectedVersion: null }],
]) await check('미전송 입력 오류 분류: ' + name, () => assert.throws(() => m.setupCommand(command), code('INVALID_INPUT')))
await check('수강집단만 또는 연결 미완성 저장을 허용하고 정원값을 채우지 않는다', () => {
  assert.equal(m.setupCommand({ ...link, input: { classIds: [], studentGroup: true, spaceIds: ['room'] } }, source).input.studentGroup, true)
  assert.deepEqual(m.setupCommand({ ...link, input: { classIds: [], studentGroup: false, spaceIds: [] } }, source).input.classIds, [])
})
await check('없어진 참조를 저장으로 보내지 않고 현재 판 충돌과 구분한다', () => {
  assert.throws(() => m.setupCommand({ ...link, input: { ...link.input, classIds: ['missing'] } }, source), code('INVALID_INPUT'))
  assert.throws(() => m.setupCommand({ ...update, expectedVersion: 2 }, source), code('CONFLICT'))
  assert.throws(() => m.setupCommand({ ...link, courseId: 'course-2' }, source), code('CONFLICT'))
  assert.throws(() => m.setupCommand({ ...create, input: { ...create.input, label: ' 과학실 ' } }, source), code('CONFLICT'))
})
await check('연결된 공간 삭제는 먼저 연결을 고치게 막는다', () => {
  const linked = structuredClone(source); linked.courses[0].link = { version: 1, ...link.input }
  assert.throws(() => m.setupCommand(remove, linked), code('CONFLICT'))
  assert.deepEqual(m.setupCommand(remove, source), remove)
})
for (const command of [create, update, remove, link]) await check(command.kind + ' 접수증의 키·대상·판·지문을 대조한다', () => {
  const original = receipt(command); assert.deepEqual(m.setupReceipt(original, command, 'request-1'), original)
  for (const mutate of [r => r.requestKey = 'other-key', r => r.kind = 'bogus', r => r.version++, r => r.sourceFingerprint = 'broken', r => r.extra = true, r => r.targetId = 'invalid id']) {
    const bad = structuredClone(original); mutate(bad); assert.throws(() => m.setupReceipt(bad, command, 'request-1'), code('INVALID_RESPONSE'))
  }
  if (command.kind === 'course_link' || command.spaceId !== null) assert.throws(() => m.setupReceipt({ ...original, targetId: 'other' }, command, 'request-1'), code('INVALID_RESPONSE'))
  assert.equal(m.setupReceipt({ ...original, sourceFingerprint: null }, command, 'request-1').sourceFingerprint, null)
})
await check('최초 조회 전 새 명령은 보내지 않으며 입력 오류를 먼저 구분한다', () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value)
  assert.throws(() => server.execute('member', create, 'request-1'), code('NOT_READY'))
  assert.throws(() => server.execute('member', { ...create, extra: true }, 'request-1'), code('INVALID_INPUT')); assert.equal(c.calls.length, 0)
})
await check('각 명령을 exact RPC와 원문·원키로 보내며 반환 원본 변조가 캐시를 바꾸지 않는다', async () => {
  for (const command of [create, update, remove, link]) {
    const c = connection(), server = m.createTimetableSetupServer(c.value), view = await server.get('member'); view.spaces.length = 0
    assert.deepEqual(await server.execute('member', command, 'request-1'), receipt(command))
    assert.deepEqual(c.calls.at(-1), { name: 'workhub_timetable_setup_execute', args: { p_command: command, p_request_key: 'request-1', p_recover_only: false, p_member_id: 'member' } })
  }
})
await check('저장된 뒤 응답이 끊겨도 원본 재조회 없이 새 서버 인스턴스에서 복구한다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); c.setFailure('dropped')
  await assert.rejects(() => server.execute('member', create, 'request-1'), code('RESULT_UNKNOWN')); c.failGet(); c.setFailure('NOT_READY')
  const restored = m.createTimetableSetupServer(c.value); assert.deepEqual(await restored.recover('member', create, 'request-1'), receipt(create))
  assert.equal(c.calls.filter(x => x.name.endsWith('_get')).length, 1); assert.deepEqual(c.calls.at(-1).args.p_command, create); assert.equal(c.calls.at(-1).args.p_recover_only, true)
})
await check('결과를 모르는 키에 바뀐 명령을 execute와 recover 모두 보내지 않는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); c.setFailure('dropped')
  await assert.rejects(() => server.execute('member', create, 'request-1'), code('RESULT_UNKNOWN'))
  for (const operation of ['execute', 'recover']) assert.throws(() => server[operation]('member', { ...create, input: { ...create.input, capacity: 2 } }, 'request-1'), code('IDEMPOTENCY_CONFLICT'))
  assert.equal(c.calls.length, 2)
})
await check('복구 원장이 없다는 결과는 새 저장으로 자동 재전송하지 않는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value)
  await assert.rejects(() => server.recover('member', create, 'request-1'), code('NOT_FOUND'))
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].args.p_recover_only, true)
})
for (const wrong of ['schoolId', 'memberId', 'contract']) await check('다른 범위의 저장 응답은 결과 미상으로 남긴다: ' + wrong, async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); c.transform(raw => ({ ...raw, [wrong]: 'other' }))
  await assert.rejects(() => server.execute('member', create, 'request-1'), code('RESULT_UNKNOWN'))
})
await check('저장 접수증 변조와 복구 접수증 변조를 성공으로 표시하지 않는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member')
  c.transform(raw => raw.data ? { ...raw, data: { ...raw.data, version: 99 } } : raw)
  await assert.rejects(() => server.execute('member', create, 'request-1'), code('RESULT_UNKNOWN'))
  await assert.rejects(() => server.recover('member', create, 'request-1'), code('INVALID_RESPONSE'))
})
await check('저장 도중 학교 범위 변경 뒤 늦게 온 응답은 닫는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  const pending = server.execute('member', create, 'request-1'); await new Promise(resolve => setImmediate(resolve)); c.setMember({ ...membership, schoolId: 'other' }); release()
  await assert.rejects(() => pending, code('CANCELLED'))
})
await check('저장 도중 승인·역할 변경 뒤 늦게 온 응답은 닫는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  const pending = server.execute('member', create, 'request-1'); await new Promise(resolve => setImmediate(resolve)); c.setIdentity({ userId: 'user', approved: true, profile: { role: 'teacher', is_active: true } }); release()
  await assert.rejects(() => pending, code('CANCELLED'))
})
await check('권한 변경으로 캐시 범위가 달라지면 저장을 보내지 않는다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); c.setMember({ ...membership, role: 'teacher' })
  assert.throws(() => server.execute('member', create, 'request-1'), code('CANCELLED')); assert.equal(c.calls.length, 1)
})
await check('시간초과 뒤 늦은 성공을 채택하지 않고 원장 조회로만 완료한다', async () => {
  const c = connection(), server = m.createTimetableSetupServer(c.value, { timeoutMs: 20 }); await server.get('member'); let release; c.pause(new Promise(resolve => release = resolve))
  await assert.rejects(() => server.execute('member', create, 'request-1'), code('RESULT_UNKNOWN')); release(); await new Promise(resolve => setImmediate(resolve)); c.pause(null)
  assert.deepEqual(await server.recover('member', create, 'request-1'), receipt(create)); assert.equal(c.calls.filter(x => !x.args.p_recover_only && !x.name.endsWith('_get')).length, 1)
})
await check('서버의 확정 거절 코드와 조회 실패를 그대로 구분한다', async () => {
  for (const error of ['FORBIDDEN', 'NOT_READY', 'CONFLICT', 'INVALID_INPUT', 'NOT_FOUND']) {
    const c = connection(), server = m.createTimetableSetupServer(c.value); await server.get('member'); c.setFailure(error)
    await assert.rejects(() => server.execute('member', create, 'request-1'), code(error))
  }
  const c = connection(), server = m.createTimetableSetupServer(c.value); c.failGet(); await assert.rejects(() => server.get('member'), code('QUERY_FAILED'))
})
// 별도 PG 회귀가 생성한 합성 응답만 지정해 실제 SQL 계약과 대조할 수 있다. 운영 DB에는 접속하지 않는다.
if (process.env.TIMETABLE_SETUP_CAPTURE) {
  const captures = JSON.parse(readFileSync(process.env.TIMETABLE_SETUP_CAPTURE, 'utf8')).captures
  let snapshots = 0, receipts = 0
  for (const capture of captures) {
    if (!capture.raw?.data) continue
    if (capture.kind === 'setup_get') { assert.deepEqual(m.setupSnapshot(capture.raw.data), capture.raw.data); snapshots++ }
    if (capture.kind === 'setup_exec') { assert.deepEqual(m.setupReceipt(capture.raw.data, capture.command, capture.key), capture.raw.data); receipts++ }
  }
  assert.ok(snapshots > 0 && receipts > 0)
  console.log(`  SQL 합성 원본 ${snapshots}건 · 접수증 ${receipts}건 실제 parser 대조 통과`)
}
console.log(`시간표 공간·학급 연결 계약 검사: ${checks}개 통과`)
