import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { normalizeTaskInput } from '../tasks/validation'
import { WorkflowError, type AnswerInput, type CollectionDraft, type CollectionInput, type CollectionRequest, type CollectionUnit, type CommandReceipt, type PersonalTask, type Submission, type TaskInput, type TaskStatus, type WorkflowContext, type WorkflowSnapshot } from './types'

const clone = <T,>(value: T): T => structuredClone(value)
const fail = (code: ConstructorParameters<typeof WorkflowError>[0], message: string): never => { throw new WorkflowError(code, message) }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const text = (value: unknown, label: string, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return fail('INVALID_INPUT', `${label}을(를) 확인해 주세요. 최대 ${max}자입니다.`)
  return value.trim()
}
function dateValue(value: unknown, required = true): string {
  if (!required && value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return fail('INVALID_INPUT', '올바른 날짜를 입력해 주세요.')
  return value
}
const id = () => crypto.randomUUID()
const empty = (): WorkflowSnapshot => ({ schemaVersion: 1, tasks: [], requests: [], units: [], drafts: [], submissions: [], reviews: [], supplements: [], withdrawals: [], receipts: [] })
function contextValue(value: WorkflowContext): WorkflowContext {
  if (!value || !Array.isArray(value.members) || value.members.some(member => !member || typeof member.id !== 'string' || typeof member.schoolId !== 'string' || typeof member.userId !== 'string' || typeof member.name !== 'string' || typeof member.active !== 'boolean' || !['teacher', 'calendar_manager'].includes(member.role) || !strings(member.departmentIds) || !strings(member.gradeIds) || !strings(member.subjectIds))) return fail('INVALID_INPUT', '학교 소속 자료의 형식이 올바르지 않습니다.')
  for (const member of value.members) { dateValue(member.validFrom); dateValue(member.validThrough) }
  if (new Set(value.members.map(member => member.id)).size !== value.members.length) return fail('INVALID_INPUT', '중복 소속 식별자가 있습니다.')
  return { members: clone(value.members), date: dateValue(value.date) }
}
function taskInput(input: unknown): TaskInput {
  if (!object(input)) return fail('INVALID_INPUT', '할 일 입력 형식이 올바르지 않습니다.')
  // 실제 개인 업무 화면과 같은 코드포인트·날짜·공백 규칙을 사용한다.
  try { return normalizeTaskInput({ title: input.title, notes: input.notes, dueDate: input.dueDate }) }
  catch (error) { return fail('INVALID_INPUT', error instanceof Error ? error.message : '할 일 입력을 확인해 주세요.') }
}
function collectionInput(input: unknown): CollectionInput {
  if (!object(input) || !['none', 'required'].includes(String(input.reviewMode)) || typeof input.textRequired !== 'boolean' || typeof input.numberRequired !== 'boolean' || !Array.isArray(input.units) || input.units.length < 1 || input.units.length > 100) return fail('INVALID_INPUT', '수합 설정과 제출 단위를 확인해 주세요.')
  const result: CollectionInput = { title: text(input.title, '수합 제목', 120, true), instructions: text(input.instructions, '안내', 3000), dueDate: dateValue(input.dueDate), reviewMode: input.reviewMode as 'none' | 'required', reviewerMemberId: text(input.reviewerMemberId, '검토자', 200), textLabel: text(input.textLabel, '글 응답 문항', 120), textRequired: input.textRequired, numberLabel: text(input.numberLabel, '숫자 응답 문항', 120), numberRequired: input.numberRequired, units: input.units.map(value => {
    if (!object(value) || !strings(value.contributorMemberIds)) return fail('INVALID_INPUT', '제출 단위 구성원을 확인해 주세요.')
    return { label: text(value.label, '단위 이름', 100, true), responsibleMemberId: text(value.responsibleMemberId, '책임자', 200, true), contributorMemberIds: [...new Set(value.contributorMemberIds)] }
  }) }
  if (!result.textLabel && !result.numberLabel) return fail('INVALID_INPUT', '글 또는 숫자 문항을 하나 이상 설정해 주세요.')
  if ((result.textRequired && !result.textLabel) || (result.numberRequired && !result.numberLabel)) return fail('INVALID_INPUT', '필수 문항에는 질문을 입력해 주세요.')
  if (result.reviewMode === 'required' && !result.reviewerMemberId) return fail('INVALID_INPUT', '검토자를 지정해 주세요.')
  if (new Set(result.units.map(unit => unit.label)).size !== result.units.length) return fail('INVALID_INPUT', '제출 단위 이름이 중복되었습니다.')
  return result
}
function answerInput(input: unknown, request: CollectionRequest, complete: boolean): AnswerInput {
  if (!object(input) || (input.number !== null && (typeof input.number !== 'number' || !Number.isFinite(input.number)))) return fail('INVALID_INPUT', '숫자는 유한한 수로 입력해 주세요. 미입력과 0은 다릅니다.')
  const result = { text: text(input.text, '글 응답', 5000), number: input.number as number | null }
  if ((!request.textLabel && result.text) || (!request.numberLabel && result.number !== null)) return fail('INVALID_INPUT', '설정되지 않은 문항에는 응답할 수 없습니다.')
  if (complete && ((request.textRequired && !result.text) || (request.numberRequired && result.number === null))) return fail('INVALID_INPUT', '필수 응답을 입력한 뒤 제출해 주세요.')
  return result
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function validateWorkflowSnapshot(raw: unknown): WorkflowSnapshot {
  if (!object(raw) || raw.schemaVersion !== 1 || !['tasks', 'requests', 'units', 'drafts', 'submissions', 'reviews', 'supplements', 'withdrawals', 'receipts'].every(key => Array.isArray(raw[key]))) return fail('INVALID_INPUT', '저장된 업무 자료의 형식이 올바르지 않습니다. 자동 초기화하지 않았습니다.')
  let result: WorkflowSnapshot
  try { result = clone(raw) as unknown as WorkflowSnapshot } catch { return fail('INVALID_INPUT', '저장할 수 없는 업무 자료 형식입니다.') }
  const positive = (value: unknown) => Number.isInteger(value) && Number(value) > 0
  const has = (value: unknown, fields: string[]) => object(value) && fields.every(field => typeof value[field] === 'string' && Boolean(value[field]))
  for (const task of result.tasks) {
    if (!has(task, ['id', 'schoolId', 'ownerMemberId']) || !positive(task.version) || !['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(task.status)) return fail('INVALID_INPUT', '저장된 할 일 자료가 손상되었습니다.')
    taskInput(task)
  }
  for (const request of result.requests) {
    if (!has(request, ['id', 'schoolId', 'managerMemberId']) || !positive(request.version) || !['draft', 'published'].includes(request.status) || !(request.publishedAt === null || typeof request.publishedAt === 'string')) return fail('INVALID_INPUT', '저장된 수합 자료가 손상되었습니다.')
    collectionInput(request)
  }
  for (const unit of result.units) {
    if (!has(unit, ['id', 'requestId', 'schoolId', 'label', 'responsibleMemberId']) || !positive(unit.version) || !Array.isArray(unit.members) || !unit.members.length || !unit.members.every(member => has(member, ['id', 'userId', 'name'])) || !unit.members.some(member => member.id === unit.responsibleMemberId) || !strings(unit.withdrawnSubmissionIds) || typeof unit.correctionUntil !== 'string' || typeof unit.correctionReason !== 'string' || ![unit.currentSubmissionId, unit.effectiveSubmissionId].every(value => value === null || typeof value === 'string')) return fail('INVALID_INPUT', '저장된 제출 단위가 손상되었습니다.')
    const request = result.requests.find(value => value.id === unit.requestId)
    if (!request || request.status !== 'published' || request.schoolId !== unit.schoolId) return fail('INVALID_INPUT', '수합과 제출 단위의 연결이 손상되었습니다.')
    dateValue(unit.correctionUntil, false)
  }
  for (const draft of result.drafts) {
    const unit = result.units.find(value => value.id === draft?.unitId)
    if (!has(draft, ['id', 'unitId', 'lastEditorMemberId']) || !positive(draft.version) || !unit || !unit.members.some(member => member.id === draft.lastEditorMemberId)) return fail('INVALID_INPUT', '저장된 공동 초안이 손상되었습니다.')
    answerInput(draft, result.requests.find(value => value.id === unit.requestId)!, false)
  }
  for (const submission of result.submissions) {
    const unit = result.units.find(value => value.id === submission?.unitId)
    if (!has(submission, ['id', 'unitId', 'submittedBy', 'receiptAt', 'requestKey']) || !positive(submission.revision) || !unit || unit.responsibleMemberId !== submission.submittedBy || !['none', 'required'].includes(submission.reviewMode) || typeof submission.initiallyLate !== 'boolean' || typeof submission.correctionReason !== 'string' || !(submission.previousSubmissionId === null || typeof submission.previousSubmissionId === 'string')) return fail('INVALID_INPUT', '저장된 제출판이 손상되었습니다.')
    dateValue(submission.receiptDate); dateValue(submission.dueSnapshot)
    answerInput(submission, result.requests.find(value => value.id === unit.requestId)!, true)
  }
  for (const review of result.reviews) if (!has(review, ['id', 'unitId', 'submissionId', 'reviewerMemberId', 'recordedAt']) || !['accepted', 'changes_requested'].includes(review.decision) || typeof review.note !== 'string' || !result.submissions.some(value => value.id === review.submissionId && value.unitId === review.unitId)) return fail('INVALID_INPUT', '저장된 검토 이력이 손상되었습니다.')
  for (const supplement of result.supplements) {
    if (!has(supplement, ['id', 'unitId', 'submissionId']) || !result.submissions.some(value => value.id === supplement.submissionId && value.unitId === supplement.unitId) || ![supplement.fulfilledSubmissionId, supplement.fulfilledAt].every(value => value === null || typeof value === 'string')) return fail('INVALID_INPUT', '저장된 보완 요청이 손상되었습니다.')
    dateValue(supplement.dueDate)
  }
  for (const unit of result.units) for (const ref of [unit.currentSubmissionId, unit.effectiveSubmissionId, ...unit.withdrawnSubmissionIds]) if (ref && !result.submissions.some(value => value.id === ref && value.unitId === unit.id)) return fail('INVALID_INPUT', '완료본 참조가 손상되었습니다.')
  for (const withdrawal of result.withdrawals) if (!has(withdrawal, ['id', 'unitId', 'submissionId', 'actorMemberId', 'reason', 'recordedAt']) || !result.units.some(unit => unit.id === withdrawal.unitId && unit.withdrawnSubmissionIds.includes(withdrawal.submissionId))) return fail('INVALID_INPUT', '철회 이력이 손상되었습니다.')
  for (const receipt of result.receipts) if (!has(receipt, ['key', 'payload', 'kind', 'resourceId']) || !['task', 'request', 'unit', 'draft', 'submission'].includes(receipt.kind) || !object(receipt.result) || receipt.result.id !== receipt.resourceId) return fail('INVALID_INPUT', '저장된 요청 결과가 손상되었습니다.')
  for (const values of [result.tasks, result.requests, result.units, result.drafts, result.submissions, result.reviews, result.supplements, result.withdrawals]) if (new Set(values.map(value => value.id)).size !== values.length) return fail('INVALID_INPUT', '중복된 자료 식별자가 있습니다.')
  for (const unit of result.units) {
    const request = result.requests.find(value => value.id === unit.requestId)!
    const revisions = result.submissions.filter(value => value.unitId === unit.id).map(value => value.revision).sort((a, b) => a - b)
    if (revisions.some((value, index) => value !== index + 1) || (unit.currentSubmissionId && unit.withdrawnSubmissionIds.includes(unit.currentSubmissionId)) || (unit.effectiveSubmissionId && unit.withdrawnSubmissionIds.includes(unit.effectiveSubmissionId))) return fail('INVALID_INPUT', '제출판 순서 또는 유효 제출 참조가 손상되었습니다.')
    if (request.reviewMode === 'none' && unit.currentSubmissionId !== unit.effectiveSubmissionId) return fail('INVALID_INPUT', '검토 없는 수합의 완료본 참조가 손상되었습니다.')
    if (request.reviewMode === 'required' && unit.effectiveSubmissionId && !result.reviews.some(review => review.submissionId === unit.effectiveSubmissionId && review.decision === 'accepted')) return fail('INVALID_INPUT', '검토하지 않은 판이 완료본으로 지정되었습니다.')
  }
  if (new Set(result.drafts.map(value => value.unitId)).size !== result.drafts.length || new Set(result.receipts.map(value => value.key)).size !== result.receipts.length) return fail('INVALID_INPUT', '중복 초안 또는 중복 요청 결과가 있습니다.')
  return result
}

export function createWorkflowStore({ members, date, snapshot, onChange }: WorkflowContext & { snapshot?: unknown; onChange?: (snapshot: WorkflowSnapshot) => void }) {
  let context = contextValue({ members, date })
  let state = snapshot === undefined ? empty() : validateWorkflowSnapshot(snapshot)
  let revision = 0
  const listeners = new Set<() => void>()
  const signal = () => { revision += 1; listeners.forEach(listener => listener()) }
  const memberFor = (memberId: string): Membership => {
    const member = context.members.find(value => value.id === memberId)
    if (!member || !activeAt(member, context.date)) return fail('INACTIVE_MEMBERSHIP', '현재 학교의 활성 소속이 필요합니다. 종료된 소속에서는 조회·저장할 수 없습니다.')
    return member
  }
  const requestFor = (data: WorkflowSnapshot, member: Membership, requestId: string): CollectionRequest => {
    const request = data.requests.find(value => value.id === requestId)
    if (!request || request.schoolId !== member.schoolId || !(request.managerMemberId === member.id || (request.status === 'published' && (request.reviewerMemberId === member.id || data.units.some(unit => unit.requestId === request.id && unit.members.some(value => value.id === member.id)))))) return fail('NOT_FOUND', '수합이 없거나 이 소속으로 열람할 수 없습니다.')
    return request
  }
  const unitFor = (data: WorkflowSnapshot, member: Membership, unitId: string): CollectionUnit => {
    const unit = data.units.find(value => value.id === unitId)
    if (!unit || unit.schoolId !== member.schoolId) return fail('NOT_FOUND', '제출 단위를 확인할 수 없습니다.')
    const request = requestFor(data, member, unit.requestId)
    if (!unit.members.some(value => value.id === member.id) && request.managerMemberId !== member.id && request.reviewerMemberId !== member.id) return fail('NOT_FOUND', '이 제출 단위를 열람할 수 없습니다.')
    return unit
  }
  const taskFor = (data: WorkflowSnapshot, member: Membership, taskId: string): PersonalTask => {
    const task = data.tasks.find(value => value.id === taskId)
    if (!task || task.schoolId !== member.schoolId || task.ownerMemberId !== member.id) return fail('NOT_FOUND', '내 할 일을 찾을 수 없습니다.')
    return task
  }
  function checkVersion(actual: number, expected: unknown) {
    if (!Number.isInteger(expected) || Number(expected) < 0) return fail('INVALID_INPUT', '확인한 원본 버전이 필요합니다.')
    if (actual !== expected) return fail('VERSION_CONFLICT', '다른 창에서 먼저 변경했습니다. 내 입력을 유지한 채 최신 원본을 다시 확인해 주세요.')
  }
  function checkReceipt(data: WorkflowSnapshot, member: Membership, receipt: CommandReceipt) {
    if (receipt.kind === 'task') taskFor(data, member, receipt.resourceId)
    else if (receipt.kind === 'request') requestFor(data, member, receipt.resourceId)
    else if (receipt.kind === 'unit') unitFor(data, member, receipt.resourceId)
    else {
      const value = (receipt.kind === 'draft' ? data.drafts : data.submissions).find(item => item.id === receipt.resourceId)
      if (!value) return fail('NOT_FOUND', '이전 요청의 원본을 찾을 수 없습니다.')
      const unit = unitFor(data, member, value.unitId)
      if (receipt.kind === 'draft' && !unit.members.some(item => item.id === member.id)) return fail('FORBIDDEN', '제출 전 초안은 지정된 공동 작성자만 볼 수 있습니다.')
    }
  }
  function command<T extends { id: string }>(memberId: string, operation: string, key: string, payload: unknown, kind: CommandReceipt['kind'], apply: (data: WorkflowSnapshot, member: Membership) => T): T {
    const member = memberFor(memberId)
    const requestKey = `${member.schoolId}:${member.id}:${operation}:${text(key, '요청 번호', 200, true)}`
    const fingerprint = canonical(payload)
    const receipt = state.receipts.find(value => value.key === requestKey)
    if (receipt) {
      if (receipt.payload !== fingerprint) return fail('IDEMPOTENCY_CONFLICT', '같은 요청 번호에 다른 입력이 있습니다. 원본을 확인한 뒤 새 요청을 사용해 주세요.')
      checkReceipt(state, member, receipt)
      return clone(receipt.result) as T
    }
    const next = clone(state)
    const result = apply(next, member)
    next.receipts.push({ key: requestKey, payload: fingerprint, kind, resourceId: result.id, result: clone(result) })
    // 외부 영속 저장이 실패하면 이 메모리 원본과 접수 결과도 바뀌지 않는다.
    try { onChange?.(clone(next)) } catch (error) { return fail('STORAGE_FAILED', error instanceof Error ? error.message : '브라우저 저장에 실패했습니다. 입력은 유지했습니다.') }
    state = next; signal()
    return clone(result)
  }
  function validateMembers(request: CollectionInput, schoolId: string) {
    for (const unit of request.units) for (const memberId of [unit.responsibleMemberId, ...unit.contributorMemberIds]) {
      const member = memberFor(memberId)
      if (member.schoolId !== schoolId) return fail('FORBIDDEN', '다른 학교의 교사를 제출 단위에 포함할 수 없습니다.')
    }
    if (request.reviewMode === 'required') {
      const reviewer = memberFor(request.reviewerMemberId)
      if (reviewer.schoolId !== schoolId) return fail('FORBIDDEN', '같은 학교의 검토자를 지정해 주세요.')
      if (request.units.some(unit => unit.responsibleMemberId === reviewer.id)) return fail('FORBIDDEN', '책임자는 자신의 제출을 검토할 수 없습니다. 다른 검토자를 지정해 주세요.')
    }
  }
  const now = () => `${context.date}T09:00:00+09:00`
  function reviewState(data: WorkflowSnapshot, submission: Submission | undefined) {
    if (!submission) return 'not_started' as const
    if (submission.reviewMode === 'none') return 'not_required' as const
    return data.reviews.filter(value => value.submissionId === submission.id).at(-1)?.decision ?? 'pending'
  }
  const store = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getRevision: () => revision,
    exportState: () => clone(state),
    setContext(next: WorkflowContext) { context = contextValue(next); signal() },
    reset() { const next = empty(); try { onChange?.(clone(next)) } catch { return fail('STORAGE_FAILED', '초기화 내용을 저장하지 못했습니다. 기존 자료를 유지합니다.') } state = next; signal() },
    listTasks(memberId: string) { const member = memberFor(memberId); return clone(state.tasks.filter(task => task.schoolId === member.schoolId && task.ownerMemberId === member.id).sort((a, b) => Number(['done', 'cancelled'].includes(a.status)) - Number(['done', 'cancelled'].includes(b.status)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title))) },
    createTask(memberId: string, input: TaskInput, key: string) { const value = taskInput(input); return command(memberId, 'create-task', key, value, 'task', (data, member) => { const result: PersonalTask = { ...value, id: id(), schoolId: member.schoolId, ownerMemberId: member.id, status: 'todo', version: 1 }; data.tasks.push(result); return result }) },
    updateTask(memberId: string, taskId: string, input: TaskInput, expectedVersion: number, key: string) { const value = taskInput(input); return command(memberId, 'update-task', key, { taskId, value, expectedVersion }, 'task', (data, member) => { const task = taskFor(data, member, taskId); checkVersion(task.version, expectedVersion); Object.assign(task, value, { version: task.version + 1 }); return task }) },
    setTaskStatus(memberId: string, taskId: string, status: TaskStatus, expectedVersion: number, key: string) {
      if (!['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(status)) return fail('INVALID_INPUT', '할 일 상태를 확인해 주세요.')
      return command(memberId, 'task-status', key, { taskId, status, expectedVersion }, 'task', (data, member) => { const task = taskFor(data, member, taskId); checkVersion(task.version, expectedVersion); task.status = status; task.version += 1; return task })
    },
    listCollections(memberId: string) { const member = memberFor(memberId); return clone(state.requests.filter(request => { try { requestFor(state, member, request.id); return true } catch { return false } }).sort((a, b) => a.dueDate.localeCompare(b.dueDate))) },
    getCollection(memberId: string, requestId: string) { return clone(requestFor(state, memberFor(memberId), requestId)) },
    createCollection(memberId: string, input: CollectionInput, key: string) {
      const value = collectionInput(input)
      return command(memberId, 'create-collection', key, value, 'request', (data, member) => { validateMembers(value, member.schoolId); const result: CollectionRequest = { ...value, reviewerMemberId: value.reviewMode === 'none' ? '' : value.reviewerMemberId, id: id(), schoolId: member.schoolId, managerMemberId: member.id, status: 'draft', version: 1, publishedAt: null }; data.requests.push(result); return result })
    },
    updateCollection(memberId: string, requestId: string, input: CollectionInput, expectedVersion: number, key: string) {
      const value = collectionInput(input)
      return command(memberId, 'update-collection', key, { requestId, value, expectedVersion }, 'request', (data, member) => { const request = requestFor(data, member, requestId); if (request.managerMemberId !== member.id) return fail('FORBIDDEN', '요청 관리자만 수정할 수 있습니다.'); checkVersion(request.version, expectedVersion); if (request.status !== 'draft') return fail('INVALID_STATE', '게시 후 문항과 대상은 고정됩니다.'); validateMembers(value, member.schoolId); Object.assign(request, value, { reviewerMemberId: value.reviewMode === 'none' ? '' : value.reviewerMemberId, version: request.version + 1 }); return request })
    },
    publishCollection(memberId: string, requestId: string, expectedVersion: number, key: string) {
      return command(memberId, 'publish-collection', key, { requestId, expectedVersion }, 'request', (data, member) => {
        const request = requestFor(data, member, requestId)
        if (request.managerMemberId !== member.id) return fail('FORBIDDEN', '요청 관리자만 게시할 수 있습니다.')
        checkVersion(request.version, expectedVersion)
        if (request.status !== 'draft') return fail('INVALID_STATE', '이미 게시한 수합입니다.')
        validateMembers(request, member.schoolId)
        for (const input of request.units) data.units.push({ id: id(), requestId, schoolId: member.schoolId, label: input.label, responsibleMemberId: input.responsibleMemberId, members: [...new Set([input.responsibleMemberId, ...input.contributorMemberIds])].map(memberId => { const item = memberFor(memberId); return { id: item.id, userId: item.userId, name: item.name } }), version: 1, currentSubmissionId: null, effectiveSubmissionId: null, withdrawnSubmissionIds: [], correctionUntil: '', correctionReason: '' })
        request.status = 'published'; request.publishedAt = now(); request.version += 1
        return request
      })
    },
    listUnits(memberId: string, requestId: string) { const member = memberFor(memberId); requestFor(state, member, requestId); return clone(state.units.filter(unit => unit.requestId === requestId).filter(unit => { try { unitFor(state, member, unit.id); return true } catch { return false } })) },
    getDraft(memberId: string, unitId: string) { const member = memberFor(memberId); const unit = unitFor(state, member, unitId); if (!unit.members.some(value => value.id === member.id)) return fail('FORBIDDEN', '제출 전 초안은 지정된 공동 작성자만 볼 수 있습니다.'); return clone(state.drafts.find(value => value.unitId === unitId) ?? null) },
    saveDraft(memberId: string, unitId: string, input: AnswerInput, expectedVersion: number, key: string) {
      return command(memberId, 'save-draft', key, { unitId, input, expectedVersion }, 'draft', (data, member) => { const unit = unitFor(data, member, unitId); if (!unit.members.some(value => value.id === member.id)) return fail('FORBIDDEN', '공동 작성자만 초안을 편집할 수 있습니다.'); const request = requestFor(data, member, unit.requestId); const value = answerInput(input, request, false); const existing = data.drafts.find(value => value.unitId === unitId); checkVersion(existing?.version ?? 0, expectedVersion); if (existing) { Object.assign(existing, value, { lastEditorMemberId: member.id, version: existing.version + 1 }); return existing } const result: CollectionDraft = { ...value, id: id(), unitId, lastEditorMemberId: member.id, version: 1 }; data.drafts.push(result); return result })
    },
    submit(memberId: string, unitId: string, draftVersion: number, expectedVersion: number, key: string, correctionReason = '') {
      return command(memberId, 'submit', key, { unitId, draftVersion, expectedVersion, correctionReason }, 'submission', (data, member) => {
        const unit = unitFor(data, member, unitId); const request = requestFor(data, member, unit.requestId)
        if (unit.responsibleMemberId !== member.id) return fail('FORBIDDEN', '제출 단위의 책임자만 최종 제출할 수 있습니다.')
        checkVersion(unit.version, expectedVersion)
        const draft = data.drafts.find(value => value.unitId === unitId)
        if (!draft) return fail('INVALID_STATE', '응답 초안을 먼저 저장해 주세요.')
        checkVersion(draft.version, draftVersion)
        const answers = answerInput(draft, request, true)
        const previous = data.submissions.filter(value => value.unitId === unitId)
        const reason = text(correctionReason, '정정 사유', 1000, previous.length > 0)
        // 보완 기한은 지연 판정 기준이다. 해당 단위의 미완료 보완 응답까지 정정 기간으로 차단하지 않는다.
        const pendingSupplements = data.supplements.filter(value => value.unitId === unitId && !value.fulfilledSubmissionId)
        if (previous.length && !pendingSupplements.length && context.date > request.dueDate && (!unit.correctionUntil || context.date > unit.correctionUntil)) return fail('INVALID_STATE', '마감 후 정정은 요청 관리자가 허용 기간을 열어야 합니다.')
        const result: Submission = { ...answers, id: id(), unitId, revision: previous.length + 1, submittedBy: member.id, receiptAt: now(), receiptDate: context.date, dueSnapshot: request.dueDate, initiallyLate: previous.length ? previous[0].initiallyLate : context.date > request.dueDate, correctionReason: reason, previousSubmissionId: unit.currentSubmissionId, reviewMode: request.reviewMode, requestKey: key }
        data.submissions.push(result); unit.currentSubmissionId = result.id; unit.version += 1
        if (request.reviewMode === 'none') unit.effectiveSubmissionId = result.id
        for (const supplement of pendingSupplements) { supplement.fulfilledSubmissionId = result.id; supplement.fulfilledAt = now() }
        return result
      })
    },
    getSubmissions(memberId: string, unitId: string) { unitFor(state, memberFor(memberId), unitId); return clone(state.submissions.filter(value => value.unitId === unitId)) },
    review(memberId: string, unitId: string, submissionId: string, decision: 'accepted' | 'changes_requested', note: string, supplementDue: string, expectedVersion: number, key: string) {
      return command(memberId, 'review', key, { unitId, submissionId, decision, note, supplementDue, expectedVersion }, 'unit', (data, member) => {
        const unit = unitFor(data, member, unitId); const request = requestFor(data, member, unit.requestId)
        if (request.reviewMode !== 'required' || request.reviewerMemberId !== member.id || unit.responsibleMemberId === member.id) return fail('FORBIDDEN', '지정된 다른 검토자만 검토할 수 있습니다.')
        checkVersion(unit.version, expectedVersion)
        const submission = data.submissions.find(value => value.id === submissionId && value.unitId === unitId)
        if (!submission || unit.currentSubmissionId !== submission.id || unit.withdrawnSubmissionIds.includes(submissionId) || reviewState(data, submission) !== 'pending') return fail('INVALID_STATE', '현재 검토 대기 중인 제출판만 처리할 수 있습니다.')
        if (!['accepted', 'changes_requested'].includes(decision)) return fail('INVALID_INPUT', '검토 결과를 선택해 주세요.')
        const cleanNote = text(note, '검토 의견', 1000, decision === 'changes_requested')
        if (decision === 'accepted') unit.effectiveSubmissionId = submissionId
        else { const due = dateValue(supplementDue); if (due < context.date) return fail('INVALID_INPUT', '보완 기한은 현재 기준일 이후여야 합니다.'); data.supplements.push({ id: id(), unitId, submissionId, dueDate: due, fulfilledSubmissionId: null, fulfilledAt: null }); unit.correctionUntil = due; unit.correctionReason = cleanNote }
        data.reviews.push({ id: id(), unitId, submissionId, reviewerMemberId: member.id, decision, note: cleanNote, recordedAt: now() }); unit.version += 1
        return unit
      })
    },
    openCorrection(memberId: string, unitId: string, until: string, reason: string, expectedVersion: number, key: string) {
      return command(memberId, 'open-correction', key, { unitId, until, reason, expectedVersion }, 'unit', (data, member) => { const unit = unitFor(data, member, unitId); const request = requestFor(data, member, unit.requestId); if (request.managerMemberId !== member.id) return fail('FORBIDDEN', '요청 관리자만 정정 기간을 열 수 있습니다.'); checkVersion(unit.version, expectedVersion); const due = dateValue(until); if (due < context.date) return fail('INVALID_INPUT', '정정 종료일은 현재 기준일 이후여야 합니다.'); unit.correctionUntil = due; unit.correctionReason = text(reason, '정정 허용 사유', 1000, true); unit.version += 1; return unit })
    },
    withdraw(memberId: string, unitId: string, expectedVersion: number, reason: string, key: string) {
      return command(memberId, 'withdraw', key, { unitId, expectedVersion, reason }, 'unit', (data, member) => {
        const unit = unitFor(data, member, unitId); const request = requestFor(data, member, unit.requestId)
        if (unit.responsibleMemberId !== member.id) return fail('FORBIDDEN', '책임자만 직접 철회할 수 있습니다.')
        checkVersion(unit.version, expectedVersion)
        const cleanReason = text(reason, '철회 사유', 1000, true)
        const current = data.submissions.find(value => value.id === unit.currentSubmissionId)
        if (!current) return fail('INVALID_STATE', '철회할 현재 제출이 없습니다.')
        if (context.date > request.dueDate && (!unit.correctionUntil || context.date > unit.correctionUntil)) return fail('INVALID_STATE', '마감 후 철회는 요청 관리자의 허용 기간이 필요합니다.')
        if (request.reviewMode === 'required' && reviewState(data, current) === 'accepted') return fail('INVALID_STATE', '검토 완료본은 직접 철회할 수 없습니다. 정정 제출을 사용해 주세요.')
        unit.withdrawnSubmissionIds.push(current.id)
        data.withdrawals.push({ id: id(), unitId, submissionId: current.id, actorMemberId: member.id, reason: cleanReason, recordedAt: now() })
        for (const supplement of data.supplements.filter(value => value.fulfilledSubmissionId === current.id)) { supplement.fulfilledSubmissionId = null; supplement.fulfilledAt = null }
        unit.currentSubmissionId = request.reviewMode === 'required' ? unit.effectiveSubmissionId : null
        if (request.reviewMode === 'none') unit.effectiveSubmissionId = null
        unit.version += 1
        return unit
      })
    },
    unitSummary(memberId: string, unitId: string) {
      const member = memberFor(memberId); const unit = unitFor(state, member, unitId); const request = requestFor(state, member, unit.requestId)
      const history = state.submissions.filter(value => value.unitId === unitId)
      const current = history.find(value => value.id === unit.currentSubmissionId)
      const effective = history.find(value => value.id === unit.effectiveSubmissionId)
      const supplements = state.supplements.filter(value => value.unitId === unitId)
      const pendingSupplements = supplements.filter(value => !value.fulfilledSubmissionId).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      return clone({ unit, request, current: current ?? null, effective: effective ?? null, reviewState: reviewState(state, current), initiallyLate: history[0]?.initiallyLate ?? false, currentlyOverdue: context.date > request.dueDate && !unit.currentSubmissionId, supplementOverdue: pendingSupplements.some(value => value.dueDate < context.date), pendingSupplements, supplements, reviews: state.reviews.filter(value => value.unitId === unitId), withdrawals: state.withdrawals.filter(value => value.unitId === unitId) })
    },
    homeSummary(memberId: string) {
      const member = memberFor(memberId)
      const tasks = store.listTasks(memberId)
      const obligations = state.units.filter(unit => unit.schoolId === member.schoolId && unit.responsibleMemberId === member.id).map(unit => store.unitSummary(memberId, unit.id)).sort((a, b) => a.request.dueDate.localeCompare(b.request.dueDate))
      // 이전 완료본이 복원되어도 남아 있는 보완 요청은 해야 할 업무다.
      return { tasks, openTasks: tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled'), obligations, pendingObligations: obligations.filter(item => !item.effective || item.current?.id !== item.effective.id || item.pendingSupplements.length > 0) }
    },
    collectionSummary(memberId: string, requestId: string) {
      const units = store.listUnits(memberId, requestId).map(unit => store.unitSummary(memberId, unit.id))
      const numbers = units.map(value => value.effective?.number).filter((value): value is number => typeof value === 'number')
      const sum = numbers.reduce((total, value) => total + value, 0)
      return { totalUnits: units.length, submittedUnits: units.filter(value => value.current).length, completedUnits: units.filter(value => value.effective).length, numberResponseUnits: numbers.length, numericTotal: Number.isFinite(sum) ? sum : null }
    },
  }
  return store
}
export type WorkflowStore = ReturnType<typeof createWorkflowStore>
