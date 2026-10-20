import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/setup-batch'; export * from '../apps/workhub/src/timetable/setup'; export { ServiceError } from '../apps/workhub/src/services/scoped-rpc';`)
const original = {
  termId: 'term', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', referenceDay: '2026-10-19', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), canEdit: true,
  spaces: [{ id: 'room', kind: 'room', label: '과학실', capacity: null, version: 3 }, { id: 'other-room', kind: 'room', label: '음악실', capacity: 1, version: 1 }],
  classes: [{ id: 'class-1', label: '1학년 1반', grade: 1 }, { id: 'class-2', label: '1학년 1반', grade: 1 }],
  courses: [{ id: 'course', label: '과학', inTimetable: true, teacherLabels: ['합성 교사'], studentCount: 24, link: null }, { id: 'course-2', label: '과학', inTimetable: true, teacherLabels: ['다른 교사'], studentCount: 12, link: { version: 1, studentGroup: false, classIds: ['class-2'], spaceIds: [] } }], findings: [],
}
const scope = { schoolId: 'school', memberId: 'member', scopeKey: 'school/member/current' }
const space = { kind: 'space_save', spaceId: 'room', expectedVersion: 3, input: { kind: 'room', label: ' 과학실 ', capacity: 2 } }
const course = { kind: 'course_link', courseId: 'course', expectedVersion: null, input: { classIds: ['class-1'], studentGroup: false, spaceIds: ['room'] } }
const course2 = { kind: 'course_link', courseId: 'course-2', expectedVersion: 1, input: { classIds: [], studentGroup: true, spaceIds: [] } }
const item = (command, i) => ({ id: 'row-' + i, label: '검토 항목 ' + i, command: structuredClone(command), before: ['이전 값'], after: ['확인한 값'] })
const batch = (commands = [space, course], source = original) => { let i = 0; return m.createSetupBatch(source, commands.map(item), scope, () => 'request-key-' + (++i)) }
const clone = value => structuredClone(value)
const code = value => error => error?.code === value
let checks = 0
async function check(name, run) { await run(); checks++; console.log('  ✓ ' + name) }
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
function fake() {
  const calls = [], receipts = new Map()
  let source = clone(original), nextError = null, getError = null, beforeGet = null, beforeWrite = null, transform = x => x
  function apply(command, key) {
    if (receipts.has(key)) return clone(receipts.get(key))
    m.setupCommand(command, source)
    const targetId = command.kind === 'course_link' ? command.courseId : command.spaceId
    const receipt = { requestKey: key, kind: command.kind, targetId, version: (command.expectedVersion ?? 0) + 1, sourceFingerprint: 'b'.repeat(64) }
    if (command.kind === 'space_save') Object.assign(source.spaces.find(row => row.id === targetId), command.input, { label: command.input.label.trim(), version: receipt.version })
    else source.courses.find(row => row.id === targetId).link = { version: receipt.version, ...clone(command.input) }
    source.sourceRevision++; source.sourceFingerprint = receipt.sourceFingerprint
    receipts.set(key, clone(receipt)); return receipt
  }
  const server = {
    async get(memberId) { calls.push({ kind: 'get', memberId }); await beforeGet?.(); if (getError) throw new m.ServiceError(getError); return clone(source) },
    async execute(memberId, command, key) {
      calls.push({ kind: 'execute', memberId, command: clone(command), key }); await beforeWrite?.()
      const error = nextError; nextError = null
      if (error && error !== 'drop') throw new m.ServiceError(error)
      const receipt = apply(command, key)
      if (error === 'drop') throw new m.ServiceError('RESULT_UNKNOWN')
      return transform(clone(receipt))
    },
    async recover(memberId, command, key) {
      calls.push({ kind: 'recover', memberId, command: clone(command), key })
      if (!receipts.has(key)) throw new m.ServiceError('NOT_FOUND')
      return transform(clone(receipts.get(key)))
    },
  }
  return { server, calls, receipts, apply, get source() { return source }, setSource: value => source = clone(value), error: value => nextError = value, failGet: value => getError = value, beforeGet: value => beforeGet = value, beforeWrite: value => beforeWrite = value, transform: value => transform = value }
}
await check('검토한 원본·명령·순서·원키를 외부 객체 변경과 분리해 고정한다', () => {
  const input = clone(original), rows = [item(space, 0)], created = m.createSetupBatch(input, rows, scope, () => 'request-key-1')
  input.spaces[0].capacity = 99; rows[0].command.input.capacity = 99
  assert.equal(created.source.spaces[0].capacity, null); assert.equal(created.jobs[0].command.input.capacity, 2)
})
for (const [name, commands] of [
  ['새 공간', [{ ...space, spaceId: null, expectedVersion: null }]], ['공간 삭제', [{ kind: 'space_remove', spaceId: 'room', expectedVersion: 3 }]], ['동일 대상 중복', [space, space]], ['빈 목록', []],
]) await check('일괄 저장 범위 밖은 접수하지 않는다: ' + name, () => assert.throws(() => batch(commands), code('INVALID_INPUT')))
await check('중복 요청 번호는 실행 전에 거부한다', () => assert.throws(() => m.createSetupBatch(original, [space, course].map(item), scope, () => 'request-key-1'), code('INVALID_INPUT')))
await check('공간 저장 후 그 공간을 연결해도 자기 변경을 외부 충돌로 오인하지 않는다', async () => {
  const f = fake(), changes = [], result = await m.runSetupBatch(batch(), f.server, { onChange: next => changes.push(clone(next)) })
  assert.equal(result.phase, 'complete'); assert.equal(result.jobs.filter(x => x.status === 'saved').length, 2)
  assert.deepEqual(f.calls.map(x => x.kind), ['get', 'execute', 'get', 'execute'])
  assert.equal(f.source.spaces[0].label, '과학실'); assert.deepEqual(f.source.courses[0].link.spaceIds, ['room'])
  assert.ok(changes.some(x => x.jobs[0].status === 'saving' && x.jobs[1].status === 'waiting'))
})
await check('지문 null 접수증도 정상이고 다음 항목은 실제 관련 원본을 대조한다', async () => {
  const f = fake(); f.transform(r => ({ ...r, sourceFingerprint: null })); const result = await m.runSetupBatch(batch(), f.server)
  assert.equal(result.phase, 'complete'); assert.equal(result.jobs[0].receipt.sourceFingerprint, null)
})
await check('관련 없는 다른 수업 변경 때문에 준비 전체를 막지 않는다', async () => {
  const f = fake(); f.source.courses[1].studentCount++; f.source.sourceFingerprint = 'c'.repeat(64)
  assert.equal((await m.runSetupBatch(batch([course]), f.server)).phase, 'complete')
})
for (const [name, mutate] of [
  ['공간 정원', s => s.spaces[0].capacity = 9], ['공간 종류', s => s.spaces[0].kind = 'equipment'], ['공간 판', s => s.spaces[0].version++],
  ['학급 표시', s => s.classes[0].label = '다른 반'], ['학급 학년', s => s.classes[0].grade = 2], ['수업 교사', s => s.courses[0].teacherLabels = ['바뀐 교사']],
  ['수업 학생 수', s => s.courses[0].studentCount++], ['수업 배정 상태', s => s.courses[0].inTimetable = false],
  ['학기 선택', s => s.termId = 'other-term'], ['학기 기간', s => s.lastDay = '2027-02-27'], ['판단 기준일', s => s.referenceDay = '2026-10-20'],
  ['학기 중 교사 종료 진단', s => s.findings.push({ code: 'TEACHER_LEAVES_IN_TERM', targetId: 'course', message: '교사 소속 종료', blocksConfirm: true })],
  ['학생 겹침 진단', s => s.findings.push({ code: 'STUDENT_OVERLAP', targetId: 'course/course-2', message: '수강 겹침', blocksConfirm: true })],
]) await check('새 원본을 자동 채택하지 않는다: ' + name, async () => {
  const f = fake(); mutate(f.source); const result = await m.runSetupBatch(batch([course]), f.server)
  assert.equal(result.phase, 'blocked'); assert.equal(result.jobs[0].errorCode, 'CONFLICT'); assert.equal(f.calls.filter(x => x.kind === 'execute').length, 0)
})
await check('첫 항목 거절이면 이후 항목의 조회·저장도 시작하지 않는다', async () => {
  const f = fake(); f.error('FORBIDDEN'); const result = await m.runSetupBatch(batch(), f.server)
  assert.equal(result.phase, 'blocked'); assert.equal(result.jobs[1].status, 'waiting'); assert.deepEqual(f.calls.map(x => x.kind), ['get', 'execute'])
})
await check('중간 실패여도 먼저 저장한 접수증을 보존하고 명시 재개 때 다시 쓰지 않는다', async () => {
  const f = fake(); let writes = 0; f.beforeWrite(() => { if (++writes === 2) f.error('NOT_READY') })
  const stopped = await m.runSetupBatch(batch(), f.server); assert.equal(stopped.jobs[0].status, 'saved'); assert.equal(stopped.jobs[1].status, 'rejected')
  const result = await m.runSetupBatch(stopped, f.server)
  assert.equal(result.phase, 'complete'); assert.deepEqual(f.calls.filter(x => x.kind === 'execute').map(x => x.key), ['request-key-1', 'request-key-2', 'request-key-2'])
})
await check('저장 뒤 응답 유실은 다음 항목을 멈추고 원키 복구만 허용한다', async () => {
  const f = fake(); f.error('drop'); const stopped = await m.runSetupBatch(batch(), f.server)
  assert.equal(stopped.phase, 'unknown'); assert.equal(m.batchHasUnknown(stopped), true)
  await assert.rejects(() => m.runSetupBatch(stopped, f.server), code('RESULT_UNKNOWN'))
  f.failGet('QUERY_FAILED'); const count = f.calls.length, recovered = await m.recoverSetupBatch(stopped, f.server)
  assert.equal(recovered.phase, 'paused'); assert.equal(recovered.jobs[0].status, 'saved'); assert.equal(f.calls.length, count + 1)
  assert.deepEqual(f.calls.at(-1), { kind: 'recover', memberId: 'member', command: space, key: 'request-key-1' })
  assert.equal(recovered.jobs[1].status, 'waiting')
})
await check('응답 변조를 저장 성공이나 확정 거절로 표시하지 않는다', async () => {
  const f = fake(); f.transform(r => ({ ...r, targetId: 'other' })); const stopped = await m.runSetupBatch(batch(), f.server)
  assert.equal(stopped.phase, 'unknown'); assert.equal(stopped.jobs[0].errorCode, 'INVALID_RESPONSE')
  const restored = await m.recoverSetupBatch(stopped, f.server); assert.equal(restored.phase, 'unknown'); assert.equal(restored.jobs[1].status, 'waiting')
})
await check('미접수 확인은 자동 재전송하지 않고 명시 재개에서 같은 키를 쓴다', async () => {
  const f = fake(); f.error('RESULT_UNKNOWN'); const stopped = await m.runSetupBatch(batch([course]), f.server)
  const missing = await m.recoverSetupBatch(stopped, f.server)
  assert.equal(missing.jobs[0].status, 'not_found'); assert.equal(f.calls.filter(x => x.kind === 'execute').length, 1)
  const result = await m.runSetupBatch(missing, f.server)
  assert.equal(result.phase, 'complete'); assert.deepEqual(f.calls.filter(x => x.kind === 'execute').map(x => x.key), ['request-key-1', 'request-key-1'])
})
await check('미접수 확인 뒤 최초 요청이 늦게 끝난 충돌은 원장 복구로 돌아간다', async () => {
  const f = fake(); f.error('RESULT_UNKNOWN'); const stopped = await m.runSetupBatch(batch([course]), f.server), missing = await m.recoverSetupBatch(stopped, f.server)
  f.apply(course, 'request-key-1')
  const conflict = await m.runSetupBatch(missing, f.server); assert.equal(conflict.phase, 'unknown'); assert.equal(conflict.jobs[0].errorCode, 'CONFLICT')
  const result = await m.recoverSetupBatch(conflict, f.server); assert.equal(result.phase, 'complete'); assert.equal(f.calls.filter(x => x.kind === 'execute').length, 1)
})
await check('쓰기 전부터 저장 중 상태를 기억하고 화면 재진입에서는 복구로 바꾼다', async () => {
  const f = fake(), wait = deferred(); let memory; f.beforeWrite(() => wait.promise)
  const running = m.runSetupBatch(batch(), f.server, { onChange: next => memory = clone(next) })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(memory.jobs[0].status, 'saving')
  const restored = m.restoreSetupBatch(memory, scope); assert.equal(restored.phase, 'unknown'); assert.equal(restored.jobs[0].requestKey, 'request-key-1')
  wait.resolve(); await running
})
await check('원본 조회 중 멈추면 새 쓰기를 보내지 않는다', async () => {
  const f = fake(), wait = deferred(); let pause = false; f.beforeGet(() => wait.promise)
  const running = m.runSetupBatch(batch(), f.server, { shouldPause: () => pause }); await new Promise(resolve => setImmediate(resolve)); pause = true; wait.resolve()
  const stopped = await running; assert.equal(stopped.phase, 'paused'); assert.deepEqual(f.calls.map(x => x.kind), ['get'])
})
await check('원본 조회 중 계정 범위가 바뀌면 쓰기와 새 범위 화면 갱신을 하지 않는다', async () => {
  const f = fake(), wait = deferred(); let current = true, updates = 0; f.beforeGet(() => wait.promise)
  const running = m.runSetupBatch(batch(), f.server, { isActive: () => current, onChange: () => updates++ }); await new Promise(resolve => setImmediate(resolve)); const count = updates; current = false; wait.resolve(); await running
  assert.equal(updates, count); assert.deepEqual(f.calls.map(x => x.kind), ['get'])
})
await check('쓰기 도중 중지는 그 한 건 결과를 보존하고 다음 건 전에 멈춘다', async () => {
  const f = fake(), wait = deferred(); let pause = false; f.beforeWrite(() => wait.promise)
  const running = m.runSetupBatch(batch(), f.server, { shouldPause: () => pause }); await new Promise(resolve => setImmediate(resolve)); pause = true; wait.resolve()
  const stopped = await running; assert.equal(stopped.phase, 'paused'); assert.equal(stopped.jobs[0].status, 'saved'); assert.equal(stopped.jobs[1].status, 'waiting'); assert.deepEqual(f.calls.map(x => x.kind), ['get', 'execute'])
})
await check('쓰기 도중 범위 변경이면 늦은 성공을 새 화면에 채택하지 않는다', async () => {
  const f = fake(), wait = deferred(); let current = true, memory, updates = 0; f.beforeWrite(() => wait.promise)
  const running = m.runSetupBatch(batch(), f.server, { isCurrent: () => current, onChange: next => { memory = clone(next); updates++ } }); await new Promise(resolve => setImmediate(resolve)); const count = updates; current = false; wait.resolve(); await running
  assert.equal(updates, count); assert.equal(memory.jobs[0].status, 'saving'); assert.equal(m.restoreSetupBatch(memory, scope).jobs[0].status, 'unknown'); assert.equal(f.calls.filter(x => x.kind === 'execute').length, 1)
})
await check('동일 묶음 중복 시작은 첫 쓰기 전에 거부한다', async () => {
  const f = fake(), wait = deferred(), input = batch(); f.beforeGet(() => wait.promise)
  const running = m.runSetupBatch(input, f.server); await new Promise(resolve => setImmediate(resolve)); await assert.rejects(() => m.runSetupBatch(clone(input), f.server), code('CONFLICT')); wait.resolve(); await running
})
await check('기억장소 저장 실패 뒤에는 서버 쓰기를 시작하지 않는다', async () => {
  const f = fake(); await assert.rejects(() => m.runSetupBatch(batch(), f.server, { onChange: next => { if (next.jobs[0].status === 'saving') throw Error('memory unavailable') } }), /memory unavailable/)
  assert.equal(f.calls.filter(x => x.kind === 'execute').length, 0)
})
for (const [name, mutate] of [
  ['명령 변경', b => b.jobs[0].command.input.capacity = 99], ['원키 변경', b => b.jobs[0].requestKey = 'other-request'], ['승인 원본 변경', b => b.source.spaces[0].capacity = 99],
  ['범위 변경', b => b.scope.memberId = 'other-member'], ['항목 바꿔치기', b => b.jobs.reverse()], ['성공 표시만 변경', b => b.jobs[0].status = 'saved'], ['현재 값 유지 표시만 변경', b => b.jobs[0].status = 'skipped'],
]) await check('보관 자료 변조는 서버 호출 전에 거절한다: ' + name, async () => {
  const f = fake(), bad = batch(); mutate(bad); await assert.rejects(() => m.runSetupBatch(bad, f.server), code('INVALID_INPUT')); assert.equal(f.calls.length, 0)
})
await check('다른 학교·소속·역할 범위로 보관 작업을 복원하지 않는다', () => {
  for (const changed of [{ ...scope, schoolId: 'other' }, { ...scope, memberId: 'other' }, { ...scope, scopeKey: 'changed-role' }]) assert.throws(() => m.restoreSetupBatch(batch(), changed), code('CANCELLED'))
})
await check('완료한 묶음 재실행은 조회·저장을 추가하지 않는다', async () => {
  const f = fake(), completed = await m.runSetupBatch(batch(), f.server), count = f.calls.length
  assert.deepEqual(await m.runSetupBatch(completed, f.server), completed); assert.equal(f.calls.length, count)
})
for (const lost of [false, true]) await check('자기 연결로 해소된 학생 겹침은 나머지 저장을 막지 않는다' + (lost ? ' · 원키 복구 뒤' : ''), async () => {
  const source=clone(original);source.courses[0].link={version:1,studentGroup:false,classIds:['class-1'],spaceIds:[]}
  source.findings=[{code:'STUDENT_OVERLAP',targetId:'course/course-2',message:'서로 다른 학급으로 연결된 겹치는 학생',blocksConfirm:true}]
  const first={...clone(course),expectedVersion:1,input:{classIds:['class-2'],studentGroup:false,spaceIds:[]}}
  const second={...clone(course2),input:{classIds:['class-2'],studentGroup:false,spaceIds:['room']}}
  const f=fake();f.setSource(source);f.beforeGet(()=>{if(f.source.courses[0].link.classIds.includes('class-2'))f.source.findings=[]})
  if(lost)f.error('drop')
  let value=await m.runSetupBatch(batch([first,second],source),f.server)
  if(lost){assert.equal(value.phase,'unknown');value=await m.recoverSetupBatch(value,f.server);value=await m.runSetupBatch(value,f.server)}
  assert.equal(value.phase,'complete');assert.equal(f.calls.filter(row=>row.kind==='execute').length,2);assert.equal(value.jobs.filter(row=>row.status==='saved').length,2)
})

const mine = review => Object.fromEntries(review.items.map(row => [row.id, 'mine']))
async function conflictBatch(commands = [space, course]) {
  const f = fake(); f.source.spaces[0].capacity = 9; f.source.spaces[0].version = 8
  const stopped = await m.runSetupBatch(batch(commands), f.server)
  return { f, stopped, review: m.previewSetupBatchConflict(stopped, f.source, scope) }
}
await check('U2 최신 판 변경 충돌을 원키 재실행하지 않고 읽기 비교·명시 재승인 후 새키로 저장한다', async () => {
  const { f, stopped, review } = await conflictBatch(); const before = f.calls.length
  await assert.rejects(() => m.runSetupBatch(stopped, f.server), code('CONFLICT')); assert.equal(f.calls.length, before)
  assert.match(review.items[0].current.join(' '), /9/); assert.equal(review.items[0].command.expectedVersion, 8)
  const revised = m.approveSetupBatchConflict(stopped, review, mine(review), scope, () => 'new-conflict-key')
  assert.equal(f.calls.length, before); assert.equal(revised.jobs[0].requestKey, 'new-conflict-key'); assert.equal(revised.jobs[1].requestKey, 'request-key-2')
  assert.deepEqual(revised.jobs[0].replacedRequests, [{ command: space, requestKey: 'request-key-1' }])
  const result = await m.runSetupBatch(revised, f.server)
  assert.equal(result.phase, 'complete'); assert.equal(f.source.spaces[0].capacity, 2); assert.deepEqual(f.calls.filter(row => row.kind === 'execute').map(row => row.key), ['new-conflict-key', 'request-key-2'])
})
await check('U2 앞선 완료 접수증은 그대로 두고 두 번째 충돌만 새 판으로 이어 저장한다', async () => {
  const f = fake(); let gets = 0
  f.beforeGet(() => { if (++gets === 2) f.source.courses[0].link = { version: 3, studentGroup: true, classIds: [], spaceIds: [] } })
  const stopped = await m.runSetupBatch(batch(), f.server), receipt = clone(stopped.jobs[0])
  assert.equal(stopped.jobs[0].status, 'saved'); assert.equal(stopped.jobs[1].errorCode, 'CONFLICT')
  const review = m.previewSetupBatchConflict(stopped, f.source, scope), revised = m.approveSetupBatchConflict(stopped, review, mine(review), scope, () => 'next-conflict-key')
  assert.deepEqual(revised.jobs[0], receipt); assert.equal(revised.jobs[1].command.expectedVersion, 3)
  assert.equal((await m.runSetupBatch(m.restoreSetupBatch(revised, scope), f.server)).phase, 'complete')
  assert.deepEqual(f.calls.filter(row => row.kind === 'execute').map(row => row.key), ['request-key-1', 'next-conflict-key'])
})
await check('U2 현재 서버 유지를 고른 행은 저장하지 않고 남은 행만 원래 미전송 키로 보낸다', async () => {
  const { f, stopped, review } = await conflictBatch()
  const choices = mine(review); choices[review.items[0].id] = 'server'
  const revised = m.approveSetupBatchConflict(stopped, review, choices, scope, () => { throw Error('새 키 불필요') })
  assert.equal(revised.jobs[0].status, 'skipped'); assert.equal(revised.jobs[0].command.expectedVersion, 3)
  const result = await m.runSetupBatch(revised, f.server)
  assert.equal(result.phase, 'complete'); assert.equal(f.source.spaces[0].capacity, 9)
  assert.deepEqual(f.calls.filter(row => row.kind === 'execute').map(row => row.key), ['request-key-2'])
})
await check('U2 전부 현재 값 유지를 선택하면 쓰기 없이 종료하고 입력·원키는 결과에 보존한다', async () => {
  const { f, stopped, review } = await conflictBatch()
  const revised = m.approveSetupBatchConflict(stopped, review, Object.fromEntries(review.items.map(row => [row.id, 'server'])), scope)
  const count = f.calls.length; assert.equal(revised.phase, 'complete'); await m.runSetupBatch(revised, f.server); assert.equal(f.calls.length, count)
  assert.deepEqual(revised.jobs.map(row => [row.command, row.requestKey]), stopped.jobs.map(row => [row.command, row.requestKey]))
})
await check('U2 삭제된 대상은 내 입력 덮어쓰기를 허용하지 않고 현재 유지 선택만 허용한다', async () => {
  const { f, stopped } = await conflictBatch(); f.source.spaces.shift()
  const review = m.previewSetupBatchConflict(stopped, f.source, scope)
  assert.equal(review.items[0].command, null); assert.equal(review.items[0].errorCode, 'NOT_FOUND')
  assert.throws(() => m.approveSetupBatchConflict(stopped, review, mine(review), scope), code('INVALID_INPUT'))
  const choices = Object.fromEntries(review.items.map(row => [row.id, 'server']))
  assert.equal(m.approveSetupBatchConflict(stopped, review, choices, scope).phase, 'complete')
})
await check('U2 선택 누락·새키 재사용·비교결과 변조는 쓰기 전에 거부한다', async () => {
  const { stopped, review } = await conflictBatch()
  for (const choices of [{}, { [review.items[0].id]: 'mine' }, { ...mine(review), fake: 'mine' }, { ...mine(review), [review.items[0].id]: 'auto' }]) assert.throws(() => m.approveSetupBatchConflict(stopped, review, choices, scope), code('INVALID_INPUT'))
  assert.throws(() => m.approveSetupBatchConflict(stopped, review, mine(review), scope, () => 'request-key-2'), code('INVALID_INPUT'))
  const bad = clone(review); bad.items[0].command.input.capacity = 99
  assert.throws(() => m.approveSetupBatchConflict(stopped, bad, mine(bad), scope), code('INVALID_INPUT'))
})
await check('U2 unknown·not_found는 새키·새명령 재계획을 허용하지 않는다', async () => {
  const f = fake(); f.error('RESULT_UNKNOWN'); const unknown = await m.runSetupBatch(batch(), f.server)
  assert.throws(() => m.previewSetupBatchConflict(unknown, f.source, scope), code('RESULT_UNKNOWN'))
  const missing = await m.recoverSetupBatch(unknown, f.server)
  assert.throws(() => m.previewSetupBatchConflict(missing, f.source, scope), code('RESULT_UNKNOWN'))
  assert.deepEqual(missing.jobs[0].command, space); assert.equal(missing.jobs[0].requestKey, 'request-key-1')
})
await check('U2 다른 학기·학교·소속·역할의 원본으로 재승인하지 않는다', async () => {
  const { stopped, f, review } = await conflictBatch()
  assert.throws(() => m.previewSetupBatchConflict(stopped, { ...f.source, termId: 'next-term' }, scope), code('CONFLICT'))
  for (const changed of [{ ...scope, schoolId: 'other' }, { ...scope, memberId: 'other' }, { ...scope, scopeKey: 'different-role' }]) assert.throws(() => m.approveSetupBatchConflict(stopped, review, mine(review), changed), code('CANCELLED'))
})
await check('U2 재검토 이후 다시 바뀐 자료는 쓰기 전 또 충돌시키고 이전 승인으로 덮지 않는다', async () => {
  const { stopped, f, review } = await conflictBatch()
  const revised = m.approveSetupBatchConflict(stopped, review, mine(review), scope, () => 'new-first-key')
  f.source.spaces[0].version++; f.source.spaces[0].capacity = 10
  const again = await m.runSetupBatch(revised, f.server)
  assert.equal(again.jobs[0].errorCode, 'CONFLICT'); assert.equal(f.calls.filter(row => row.kind === 'execute').length, 0)
  const againReview = m.previewSetupBatchConflict(again, f.source, scope), next = m.approveSetupBatchConflict(again, againReview, mine(againReview), scope, () => 'new-second-key')
  assert.deepEqual(next.jobs[0].replacedRequests.map(row => row.requestKey), ['request-key-1', 'new-first-key'])
  assert.equal((await m.runSetupBatch(next, f.server)).phase, 'complete')
})
await check('U2 새 승인 뒤 응답 유실도 새로 승인된 원키로 복구하고 완료 행은 재전송하지 않는다', async () => {
  const { stopped, f, review } = await conflictBatch()
  const revised = m.approveSetupBatchConflict(stopped, review, mine(review), scope, () => 'new-unknown-key')
  f.error('drop'); const unknown = await m.runSetupBatch(revised, f.server)
  assert.equal(unknown.phase, 'unknown'); assert.throws(() => m.previewSetupBatchConflict(unknown, f.source, scope), code('RESULT_UNKNOWN'))
  const recovered = await m.recoverSetupBatch(unknown, f.server)
  assert.equal(recovered.jobs[0].receipt.requestKey, 'new-unknown-key'); assert.equal((await m.runSetupBatch(recovered, f.server)).phase, 'complete')
  assert.deepEqual(f.calls.filter(row => row.kind === 'execute').map(row => row.key), ['new-unknown-key', 'request-key-2'])
})

console.log(`시간표 준비 일괄 저장 실행 검사: ${checks}개 통과`)
