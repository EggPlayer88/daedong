import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { prepareTaskOperation: prepareTask, prepareCalendarOperation: prepareCalendar, executeWorkspaceOperation: execute, validateWorkspaceOperation: validate, TaskError, ContractError, renderCard } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/workspace-operations.ts'
  export { TaskError } from '../apps/workhub/src/tasks/contracts.ts'
  export { ContractError } from '../apps/workhub/src/contracts.ts'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { WorkspaceOperationCard } from '../apps/workhub/src/assistant/WorkspaceOperationCard.tsx'
  export const renderCard = props => renderToStaticMarkup(<WorkspaceOperationCard {...props} />)
`)
const date = '2026-11-11'
const member = { id: 'member-1', schoolId: 'school-1', userId: 'user-1', name: '합성 교사', active: true, role: 'teacher', validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const original = { id: 'task-1', schoolId: member.schoolId, ownerMemberId: member.id, title: '제출 자료 확인', notes: '기존 메모', dueDate: '2026-11-13', status: 'doing', version: 2 }
const taskRequest = () => ({ key: 'original-task-key', schoolId: member.schoolId, memberId: member.id, basisDate: date, taskId: original.id, title: original.title, expectedVersion: original.version, change: { kind: 'notes', value: '검토 완료' } })
const draft = () => ({ title: '업무 정리', description: '', location: '', startDate: '2026-11-12', endDate: '2026-11-12', startTime: '15:00', endTime: '16:00', allDay: false, visibility: 'private', audience: { all: false, groups: [], includeMemberIds: [member.id], excludeMemberIds: [] } })
const calendarRequest = () => ({ id: 'original-calendar-key', schoolId: member.schoolId, memberId: member.id, draft: draft() })
const calendarResult = value => ({ ...structuredClone(value), id: 'event-1', schoolId: member.schoolId, authorMemberId: member.id, version: 1, updatedAt: '2026-11-11T01:00:00Z' })
function fixture() {
  const calls = []
  let latest = structuredClone(original)
  return {
    calls,
    setLatest(value) { latest = value },
    task: {
      async get(memberId, taskId) { calls.push(['get', memberId, taskId]); return structuredClone(latest) },
      async update(memberId, taskId, input, expectedVersion, key) { calls.push(['update', memberId, taskId, structuredClone(input), expectedVersion, key]); return { ...structuredClone(original), ...input, version: expectedVersion + 1 } },
      async setStatus(memberId, taskId, status, expectedVersion, key) { calls.push(['status', memberId, taskId, status, expectedVersion, key]); return { ...structuredClone(original), status, version: expectedVersion + 1 } },
    },
    calendar: { async save(memberId, command) { calls.push(['calendar', memberId, structuredClone(command)]); return calendarResult(command.draft) } },
  }
}
const writes = f => f.calls.filter(call => call[0] !== 'get')
const rejects = (fn, outcome, code) => assert.rejects(fn, error => error.outcome === outcome && (!code || error.code === code))
let failures = 0
async function test(name, run) { try { await run(); console.log(`  ✓ ${name}`) } catch (error) { failures++; console.log(`  ✗ ${name}: ${error.stack}`) } }

await test('할 일 검토는 최신 개인 원본을 조회하며 검토만으로 저장하지 않는다', async () => {
  const f = fixture(), request = taskRequest(), review = await prepareTask(f.task, request, member, date)
  assert.equal(review.task.before, original.notes); assert.equal(review.task.after, '검토 완료')
  assert.equal(review.userId, member.userId); assert.equal(review.task.original.version, 2)
  request.change.value = '외부 변경'
  assert.equal(review.task.command.input.notes, '검토 완료'); assert.equal(writes(f).length, 0)
})
await test('최초 저장 직전 최신 원본을 다시 확인하고 기존 update를 원키로 호출한다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  const result = await execute(review, f, member, date)
  assert.equal(f.calls.filter(call => call[0] === 'get').length, 2)
  assert.deepEqual(writes(f), [['update', member.id, original.id, { title: original.title, notes: '검토 완료', dueDate: original.dueDate }, 2, review.key]])
  assert.equal(result.id, original.id); assert.equal(result.version, 3); assert.equal(result.key, review.key)
})
await test('완료 검토는 본인 원본 한 건의 기존 상태 변경만 호출한다', async () => {
  const f = fixture(), review = await prepareTask(f.task, { ...taskRequest(), change: { kind: 'complete' } }, member, date)
  const result = await execute(review, f, member, date)
  assert.deepEqual(writes(f), [['status', member.id, original.id, 'done', 2, review.key]])
  assert.equal(result.result.status, 'done')
})
await test('원본의 판·내용·소유자·학교·대상이 바뀌면 저장하지 않는다', async () => {
  for (const patch of [{ version: 3 }, { notes: '다른 창에서 수정' }, { ownerMemberId: 'other' }, { schoolId: 'other' }, { id: 'other' }]) {
    const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
    f.setLatest({ ...original, ...patch })
    await rejects(() => execute(review, f, member, date), 'not_saved')
    assert.equal(writes(f).length, 0)
  }
})
await test('저장 전 원본 조회 실패는 미확정 저장으로 만들지 않는다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  f.task.get = async () => { throw new Error('읽기 연결 실패') }
  await rejects(() => execute(review, f, member, date), 'not_saved'); assert.equal(writes(f).length, 0)
})
await test('응답 유실 복구는 날짜가 바뀌어도 원본 조회 없이 같은 명령과 키를 재전송한다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  let attempt = 0
  const update = f.task.update
  f.task.update = async (...args) => { const result = await update(...args); if (!attempt++) throw new Error('응답 유실'); return result }
  await rejects(() => execute(review, f, member, date), 'unknown')
  f.task.get = async () => { throw new Error('복구 시 기존 판을 재조회하면 안 됨') }
  const receipt = await execute(review, f, member, '2026-11-12', { retry: true })
  assert.equal(receipt.version, 3); assert.deepEqual(writes(f)[0], writes(f)[1])
})
await test('최초 명시적 거절은 종료하지만 전송·접수증·재시도 거절은 원키를 유지한다', async () => {
  for (const [code, outcome] of [['CONFLICT', 'not_saved'], ['FORBIDDEN', 'not_saved'], ['SAVE_FAILED', 'unknown'], ['IDEMPOTENCY_CONFLICT', 'unknown'], ['CANCELLED', 'unknown']]) {
    const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
    f.task.update = async () => { throw new TaskError(code, '시험 오류') }
    await rejects(() => execute(review, f, member, date), outcome, code)
    await rejects(() => execute(review, f, member, date, { retry: true }), 'unknown', code)
  }
})
await test('검토 후 key·명령·대상·표시값 변경과 다른 사용자 계정은 실행하지 않는다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  for (const change of [copy => { copy.key = 'new-key' }, copy => { copy.task.command.input.notes = '다른 내용' }, copy => { copy.task.original.id = 'other' }, copy => { copy.title = '다른 제목' }, copy => { copy.userId = 'other' }]) {
    const copy = structuredClone(review); change(copy)
    await rejects(() => execute(copy, f, member, date), 'not_saved')
    await rejects(() => execute(copy, f, member, date, { retry: true }), 'unknown')
  }
  await rejects(() => execute(review, f, { ...member, userId: 'different-login' }, date), 'not_saved')
  await rejects(() => execute(review, f, { ...member, active: false }, date), 'not_saved')
  await rejects(() => execute(review, f, member, '2026-11-12'), 'not_saved')
  assert.equal(writes(f).length, 0)
})
await test('조회 중 계정 전환은 저장 전 중단하고 저장 후 전환은 결과 미확정으로 보존한다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  let current = true
  f.task.get = async () => { current = false; return original }
  await rejects(() => execute(review, f, member, date, { isCurrent: () => current }), 'not_saved', 'CANCELLED')
  assert.equal(writes(f).length, 0)
  current = true
  f.task.get = async () => original
  const update = f.task.update
  f.task.update = async (...args) => { const result = await update(...args); current = false; return result }
  await rejects(() => execute(review, f, member, date, { isCurrent: () => current }), 'unknown', 'CANCELLED')
  assert.equal(writes(f).length, 1)
})
await test('다른 할 일·내용·판·소유자의 접수증을 성공으로 표시하지 않는다', async () => {
  for (const patch of [{ id: 'other' }, { notes: '원하지 않은 수정' }, { version: 2 }, { ownerMemberId: 'other' }, { schoolId: 'other' }]) {
    const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
    f.task.update = async () => ({ ...original, notes: '검토 완료', version: 3, ...patch })
    await rejects(() => execute(review, f, member, date), 'unknown')
  }
})
await test('일정은 나만 보기 초안 한 건을 검토하고 기존 save에 원키로 전달한다', async () => {
  const f = fixture(), request = calendarRequest(), review = prepareCalendar(request, member, date)
  request.draft.title = '외부 변경'
  assert.equal(writes(f).length, 0); assert.equal(review.title, '업무 정리')
  const receipt = await execute(review, f, member, date)
  assert.deepEqual(writes(f), [['calendar', member.id, { draft: draft(), idempotencyKey: 'original-calendar-key' }]])
  assert.equal(receipt.id, 'event-1'); assert.equal(receipt.version, 1)
})
await test('일정 시간 누락은 편집기 이관용 코드이며 공유 확대·다른 대상은 저장 불가다', async () => {
  assert.throws(() => prepareCalendar({ ...calendarRequest(), draft: { ...draft(), endTime: '' } }, member, date), error => error.code === 'EDITOR_REQUIRED')
  for (const patch of [{ visibility: 'school' }, { visibility: 'audience' }, { endDate: '2026-11-13' }, { audience: [] }, { audience: { all: false, groups: [], includeMemberIds: ['other'], excludeMemberIds: [] } }]) {
    assert.throws(() => prepareCalendar({ ...calendarRequest(), draft: { ...draft(), ...patch } }, member, date))
  }
  const review = prepareCalendar({ ...calendarRequest(), draft: { ...draft(), allDay: true, startTime: '', endTime: '' } }, member, date)
  assert.equal(review.command.draft.allDay, true)
})
await test('일정 응답 유실 뒤 같은 원키 복구와 작성자·공개 범위·내용 접수증 검증을 한다', async () => {
  const f = fixture(), review = prepareCalendar(calendarRequest(), member, date)
  const save = f.calendar.save; let attempt = 0
  f.calendar.save = async (...args) => { const result = await save(...args); if (!attempt++) throw new ContractError('SAVE_FAILED', '응답 유실'); return result }
  await rejects(() => execute(review, f, member, date), 'unknown')
  await execute(review, f, member, '2026-11-12', { retry: true })
  assert.deepEqual(writes(f)[0], writes(f)[1])
  for (const patch of [{ version: 2 }, { authorMemberId: 'other' }, { visibility: 'school' }, { title: '다른 일정' }, { startTime: '14:00' }, { schoolId: 'other' }, { audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] } }]) {
    f.calendar.save = async () => ({ ...calendarResult(draft()), ...patch })
    await rejects(() => execute(review, f, member, date), 'unknown')
  }
})
await test('깨진 복구 자료·비지원 복합 명령은 저장 없이 거절한다', async () => {
  for (const raw of [null, [], {}, { kind: 'sendMessage' }, { ...prepareCalendar(calendarRequest(), member, date), command: { draft: draft(), idempotencyKey: 'different-key' } }]) {
    assert.throws(() => validate(raw, member, date))
  }
  const f = fixture()
  for (const change of [null, [], { kind: 'delete' }, { kind: 'complete', extra: '전부' }, { kind: 'notes', value: [] }]) await rejects(() => prepareTask(f.task, { ...taskRequest(), change }, member, date), 'not_saved')
  assert.equal(f.calls.length, 0)
})
await test('카드는 검토·미확정·완료 상태에서 가능한 행동만 렌더한다', async () => {
  const f = fixture(), review = await prepareTask(f.task, taskRequest(), member, date)
  const actions = { onConfirm() {}, onCancel() {}, onRetry() {}, onOpenResult() {} }
  const markup = renderCard({ ...actions, review, status: 'review' })
  for (const text of ['할 일 변경을 검토해 주세요', '변경 전', '변경 후', '나만 보기', '합성 교사', '원본 v2', '확인한 변경 저장']) assert.ok(markup.includes(text), text)
  const pending = renderCard({ ...actions, review, status: 'pending' })
  assert.ok(pending.includes('같은 요청으로 저장 결과 확인')); assert.ok(!pending.includes('확인한 변경 저장')); assert.ok(!pending.includes('>취소</button>'))
  const saving = renderCard({ ...actions, review, status: 'saving' }); assert.ok(!saving.includes('<button'))
  const receipt = await execute(review, f, member, date)
  const saved = renderCard({ ...actions, review, status: 'saved', receipt })
  assert.ok(saved.includes('저장을 확인했습니다')); assert.ok(saved.includes('저장된 원본 보기')); assert.ok(saved.includes('원본 v3'))
  const calendar = renderCard({ ...actions, review: prepareCalendar(calendarRequest(), member, date), status: 'review' })
  assert.ok(calendar.includes('2026-11-12')); assert.ok(calendar.includes('15:00–16:00')); assert.ok(calendar.includes('확인한 일정 등록'))
})
await test('깨진 카드 입력은 화면을 중단하거나 저장 버튼을 만들지 않는다', () => {
  for (const review of [null, [], {}, { kind: 'taskChange', key: 'key', title: '제목', authorName: '교사', task: { original: null } }, { kind: 'calendarCreate', key: 'key', title: '제목', authorName: '교사', command: { draft: null } }]) {
    const markup = renderCard({ review, status: 'review' }); assert.ok(markup.includes('불러오지 못했습니다')); assert.ok(!markup.includes('<button'))
  }
})
if (failures) process.exit(1)
