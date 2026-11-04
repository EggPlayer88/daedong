import type { PersonalTask, TaskCommand } from '../../apps/workhub/src/tasks/contracts'

export function createDialogueTaskFixture(member: { id: string; schoolId: string }) {
  const rows = new Map<string, PersonalTask>()
  const receipts = new Map<string, PersonalTask>()
  let failAfter = false
  let writes = 0
  function seed() {
    rows.clear()
    receipts.clear()
    writes = 0
    for (const [id, dueDate, notes] of [
      ['task-a', '2026-10-26', '1학년 자료'],
      ['task-b', '2026-10-28', '2학년 자료'],
    ]) {
      rows.set(id, {
        id, schoolId: member.schoolId, ownerMemberId: member.id,
        title: '제출 자료 확인', notes, dueDate, status: 'todo', version: 1,
      })
    }
  }
  function revise(id: string) {
    const task = rows.get(id)!
    task.version++
    task.notes = '다른 화면에서 정정한 내용'
  }
  const ok = (data: unknown) => ({ data: structuredClone(data), error: null })
  const error = (message: string, current?: PersonalTask) => ({
    data: null, error: { message, ...(current ? { details: JSON.stringify(current) } : {}) },
  })
  function rpc(name: string, args: { p_member_id: string; p_task_id?: string; p_command?: TaskCommand; p_request_key?: string }) {
    if (args.p_member_id !== member.id) return error('FORBIDDEN')
    if (name === 'workhub_task_list') return ok([...rows.values()])
    if (name === 'workhub_task_get') {
      const task = rows.get(args.p_task_id!)
      return task ? ok(task) : error('NOT_FOUND')
    }
    const command = args.p_command
    const key = args.p_request_key
    if (!command || command.kind === 'create' || !key) return error('INVALID_INPUT')
    if (receipts.has(key)) return ok(receipts.get(key))
    const task = rows.get(command.taskId)
    if (!task) return error('NOT_FOUND')
    if (command.expectedVersion !== task.version) return error('CONFLICT', task)
    if (command.kind === 'update') Object.assign(task, command.input)
    else task.status = command.status
    task.version++
    writes++
    receipts.set(key, structuredClone(task))
    if (failAfter) { failAfter = false; return error('QUERY_FAILED') }
    return ok(task)
  }
  return { seed, revise, rpc, loseNextReply() { failAfter = true }, snapshot: () => ({ rows: [...rows.values()], writes }) }
}
