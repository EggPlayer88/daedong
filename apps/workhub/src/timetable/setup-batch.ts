import { canonical, exact, identifier, ServiceError, type ServiceCode } from '../services/scoped-rpc'
import { setupCommand, setupReceipt, setupSnapshot, type SetupCommand, type SetupReceipt, type SetupServer, type SetupSnapshot } from './setup'
import policy from './setup-policy.json'

export interface SetupBatchScope { schoolId: string; memberId: string; scopeKey: string }
export interface SetupBatchItem { id: string; label: string; command: SetupCommand; before?: string[]; after?: string[] }
export type SetupBatchJobStatus = 'waiting' | 'saving' | 'saved' | 'rejected' | 'unknown' | 'not_found'
export type SetupBatchPhase = 'ready' | 'running' | 'paused' | 'blocked' | 'unknown' | 'complete'
export interface SetupBatchJob extends SetupBatchItem {
  before: string[]; after: string[]; requestKey: string; status: SetupBatchJobStatus
  errorCode: ServiceCode | null; receipt: SetupReceipt | null
}
export interface SetupBatch {
  version: 1; scope: SetupBatchScope; source: SetupSnapshot; jobs: SetupBatchJob[]
  phase: SetupBatchPhase; approvalSeal: string
}
export interface SetupBatchOptions {
  onChange?: (batch: SetupBatch) => void
  onUpdate?: (batch: SetupBatch) => void
  shouldPause?: () => boolean
  isActive?: () => boolean
  isCurrent?: () => boolean
}
const copy = <T,>(value: T): T => structuredClone(value)
const phases: SetupBatchPhase[] = ['ready', 'running', 'paused', 'blocked', 'unknown', 'complete']
const statuses: SetupBatchJobStatus[] = ['waiting', 'saving', 'saved', 'rejected', 'unknown', 'not_found']
const codes: ServiceCode[] = ['NOT_READY', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CANCELLED', 'QUERY_FAILED', 'RESULT_UNKNOWN', 'INVALID_RESPONSE']
const rejectedCodes: ServiceCode[] = ['NOT_READY', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT']
const running = new Set<string>()
function invalid(): never { throw new ServiceError('INVALID_INPUT') }
const plain = (value: unknown): string => typeof value === 'string' && value.trim() && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid()
const lines = (value: unknown): string[] => Array.isArray(value) && value.every(row => typeof row === 'string') ? copy(value) : invalid()
const target = (command: SetupCommand) => command.kind === 'course_link' ? 'course:' + command.courseId : 'space:' + command.spaceId
const errorCode = (error: unknown, fallback: ServiceCode): ServiceCode => error instanceof ServiceError ? error.code : fallback
function validScope(value: SetupBatchScope): SetupBatchScope {
  exact(value, ['schoolId', 'memberId', 'scopeKey'])
  identifier(value.schoolId); identifier(value.memberId); plain(value.scopeKey)
  return copy(value) as unknown as SetupBatchScope
}
function batchCommand(raw: unknown, source?: SetupSnapshot): SetupCommand {
  const command = setupCommand(raw)
  // 새 공간의 반환 ID에 뒤 항목을 자동 연결하거나 삭제를 함께 실행하지 않는다.
  if (command.kind === 'space_remove' || command.kind === 'space_save' && command.spaceId === null) invalid()
  return source ? setupCommand(command, source) : command
}
function seal(batch: Pick<SetupBatch, 'scope' | 'source' | 'jobs'>): string {
  return canonical({ scope: batch.scope, source: batch.source, items: batch.jobs.map(({ id, label, command, before, after, requestKey }) => ({ id, label, command, before, after, requestKey })) })
}

/** 확인 화면에서 승인한 원본·명령·요청 번호를 한 묶음으로 고정한다. 보안 경계는 기존 서버에 있다. */
export function createSetupBatch(source: SetupSnapshot, items: SetupBatchItem[], scope: SetupBatchScope, keyFactory: () => string = () => crypto.randomUUID()): SetupBatch {
  const approved = setupSnapshot(source), bound = validScope(scope)
  if (!Array.isArray(items) || !items.length) invalid()
  const keys = new Set<string>(), ids = new Set<string>(), targets = new Set<string>()
  const jobs = items.map(item => {
    const command = batchCommand(item.command, approved), id = plain(item.id), label = plain(item.label), requestKey = identifier(keyFactory())
    if (requestKey.length < policy.minRequestKeyLength || keys.has(requestKey) || ids.has(id) || targets.has(target(command))) invalid()
    keys.add(requestKey); ids.add(id); targets.add(target(command))
    return { id, label, command, before: lines(item.before ?? []), after: lines(item.after ?? []), requestKey, status: 'waiting' as const, errorCode: null, receipt: null }
  })
  const batch: SetupBatch = { version: 1, scope: bound, source: approved, jobs, phase: 'ready', approvalSeal: '' }
  batch.approvalSeal = seal(batch)
  return batch
}

function checked(raw: SetupBatch, scope?: SetupBatchScope): SetupBatch {
  try {
    exact(raw, ['version', 'scope', 'source', 'jobs', 'phase', 'approvalSeal'])
    if (raw.version !== 1 || !phases.includes(raw.phase as SetupBatchPhase) || !Array.isArray(raw.jobs) || !raw.jobs.length) invalid()
    const bound = validScope(raw.scope as SetupBatchScope), source = setupSnapshot(raw.source)
    if (scope && canonical(bound) !== canonical(validScope(scope))) throw new ServiceError('CANCELLED')
    const ids = new Set<string>(), targets = new Set<string>(), keys = new Set<string>()
    let pastSaved = false, stopped = false, waitingSeen = false
    for (const row of raw.jobs) {
      exact(row, ['id', 'label', 'command', 'before', 'after', 'requestKey', 'status', 'errorCode', 'receipt'])
      const command = batchCommand(row.command, source), id = plain(row.id), key = identifier(row.requestKey)
      plain(row.label); lines(row.before); lines(row.after)
      if (key.length < policy.minRequestKeyLength || ids.has(id) || keys.has(key) || targets.has(target(command)) || !statuses.includes(row.status as SetupBatchJobStatus) || row.errorCode !== null && !codes.includes(row.errorCode as ServiceCode)) invalid()
      ids.add(id); keys.add(key); targets.add(target(command))
      if (row.status === 'saved') {
        if (pastSaved || row.errorCode !== null) invalid()
        setupReceipt(row.receipt, command, key)
      } else {
        pastSaved = true
        if (row.receipt !== null) invalid()
        if (row.status !== 'waiting') { if (stopped || waitingSeen) invalid(); stopped = true }
        else { waitingSeen = true; if (row.errorCode !== null) invalid() }
      }
    }
    const batch = copy(raw) as unknown as SetupBatch
    if (batch.approvalSeal !== seal(batch)) invalid()
    const unknown = batch.jobs.some(row => row.status === 'unknown'), allSaved = batch.jobs.every(row => row.status === 'saved')
    if ((batch.phase === 'complete') !== allSaved || unknown && batch.phase !== 'unknown' || batch.phase === 'unknown' && !unknown) invalid()
    return batch
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'CANCELLED') throw error
    return invalid()
  }
}

/** 새 화면은 진행 중이던 쓰기를 재실행하지 않고 기존 원장부터 확인한다. */
export function restoreSetupBatch(raw: SetupBatch, scope: SetupBatchScope): SetupBatch {
  const batch = checked(raw, scope)
  const saving = batch.jobs.find(row => row.status === 'saving')
  if (saving) { saving.status = 'unknown'; saving.errorCode = 'RESULT_UNKNOWN'; batch.phase = 'unknown' }
  else if (batch.phase === 'running') batch.phase = 'paused'
  return batch
}
export const batchHasUnknown = (batch: SetupBatch): boolean => batch.jobs.some(row => row.status === 'unknown' || row.status === 'saving')

function applyReceipt(source: SetupSnapshot, job: SetupBatchJob): void {
  const receipt = job.receipt!
  if (job.command.kind === 'space_save') {
    const spaceId = job.command.spaceId
    const index = source.spaces.findIndex(row => row.id === spaceId)
    if (index < 0) invalid()
    source.spaces[index] = { id: receipt.targetId, ...job.command.input, label: job.command.input.label.trim(), version: receipt.version }
  } else if (job.command.kind === 'course_link') {
    const courseId = job.command.courseId
    const row = source.courses.find(course => course.id === courseId)
    if (!row) invalid()
    row.link = { version: receipt.version, ...copy(job.command.input) }
    // 앞서 승인·저장한 연결이 두 수업을 같은 공식 학급으로 묶으면 그 겹침 진단은 해소된다.
    // 수강 인원을 추정하거나 새 진단을 무시하지 않는다. 다른 변화는 다음 조회에서 멈춘다.
    source.findings = source.findings.filter(finding => {
      const ids = finding.targetId.split('/')
      if (finding.code !== 'STUDENT_OVERLAP' || ids.length !== 2 || !ids.includes(courseId)) return true
      const [left, right] = ids.map(id => source.courses.find(course => course.id === id)?.link)
      return !left?.classIds.some(id => source.classes.some(value => value.id === id) && right?.classIds.includes(id))
    })
  }
  if (receipt.sourceFingerprint !== null) source.sourceFingerprint = receipt.sourceFingerprint
}
function expectedSource(batch: SetupBatch): SetupSnapshot {
  const source = copy(batch.source)
  for (const job of batch.jobs) { if (job.status !== 'saved') break; applyReceipt(source, job) }
  return source
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right)
function verifyCurrent(approved: SetupSnapshot, current: SetupSnapshot, command: SetupCommand): void {
  // 다른 항목의 정상 변경은 허용하되 학기와 현재 항목의 판단 근거는 다시 승인받는다.
  for (const field of ['termId', 'termLabel', 'firstDay', 'lastDay', 'referenceDay'] as const) if (approved[field] !== current[field]) throw new ServiceError('CONFLICT')
  if (command.kind === 'space_save') {
    if (!same(approved.spaces.find(row => row.id === command.spaceId), current.spaces.find(row => row.id === command.spaceId))) throw new ServiceError('CONFLICT')
  } else if (command.kind === 'course_link') {
    const before = approved.courses.find(row => row.id === command.courseId), now = current.courses.find(row => row.id === command.courseId)
    if (!same(before, now)) throw new ServiceError('CONFLICT')
    const classIds = new Set([...(before?.link?.classIds ?? []), ...command.input.classIds])
    const spaceIds = new Set([...(before?.link?.spaceIds ?? []), ...command.input.spaceIds])
    for (const id of classIds) if (!same(approved.classes.find(row => row.id === id), current.classes.find(row => row.id === id))) throw new ServiceError('CONFLICT')
    for (const id of spaceIds) if (!same(approved.spaces.find(row => row.id === id), current.spaces.find(row => row.id === id))) throw new ServiceError('CONFLICT')
  }
  const targetId = command.kind === 'course_link' ? command.courseId : command.spaceId
  const findings = (source: SetupSnapshot) => source.findings.filter(row => row.targetId === targetId || row.targetId.split('/').includes(targetId ?? '')).map(canonical).sort()
  if (!same(findings(approved), findings(current))) throw new ServiceError('CONFLICT')
  batchCommand(command, current)
}
function active(options: SetupBatchOptions): boolean { return (options.isActive?.() ?? true) && (options.isCurrent?.() ?? true) }
function publish(batch: SetupBatch, options: SetupBatchOptions): void {
  if (active(options)) (options.onChange ?? options.onUpdate)?.(copy(batch))
}
function lease(batch: SetupBatch): () => void {
  const token = canonical([batch.scope, batch.jobs[0].requestKey])
  if (running.has(token)) throw new ServiceError('CONFLICT')
  running.add(token)
  return () => running.delete(token)
}
function paused(batch: SetupBatch, options: SetupBatchOptions): boolean {
  if (!active(options) || options.shouldPause?.()) { batch.phase = 'paused'; publish(batch, options); return true }
  return false
}

/** 전체 원자 저장이 아니다. 한 건씩 접수하며 첫 오류에서 멈추고 완료된 접수증을 보존한다. */
export async function runSetupBatch(raw: SetupBatch, server: SetupServer, options: SetupBatchOptions = {}): Promise<SetupBatch> {
  const batch = checked(raw)
  if (batchHasUnknown(batch)) throw new ServiceError('RESULT_UNKNOWN')
  if (batch.phase === 'complete') return batch
  const release = lease(batch)
  try {
    const expected = expectedSource(batch)
    for (const job of batch.jobs) {
      if (job.status === 'saved') continue
      const retryingMissing = job.status === 'not_found'
      if (paused(batch, options)) return batch
      batch.phase = 'running'; publish(batch, options)
      try {
        const current = setupSnapshot(await server.get(batch.scope.memberId))
        // 조회를 기다리는 동안의 중지·언마운트 요청도 쓰기 전에 확인한다.
        if (paused(batch, options)) return batch
        verifyCurrent(expected, current, job.command)
      } catch (error) {
        if (!active(options)) return batch
        job.errorCode = errorCode(error, 'QUERY_FAILED')
        // 원장 없음 확인 직후 늦은 최초 요청이 끝났을 수 있으므로 충돌을 폐기 근거로 쓰지 않는다.
        job.status = retryingMissing && job.errorCode === 'CONFLICT' ? 'unknown' : retryingMissing ? 'not_found' : 'rejected'
        batch.phase = job.status === 'unknown' ? 'unknown' : 'blocked'; publish(batch, options); return batch
      }
      if (paused(batch, options)) return batch
      job.status = 'saving'; job.errorCode = null
      // 원래 명령과 키를 화면 기억장소에 먼저 남긴다. 기록 실패 시 서버 호출은 하지 않는다.
      publish(batch, options)
      if (!active(options)) return batch
      if (options.shouldPause?.()) { job.status = 'waiting'; batch.phase = 'paused'; publish(batch, options); return batch }
      try {
        const result = setupReceipt(await server.execute(batch.scope.memberId, copy(job.command), job.requestKey), job.command, job.requestKey)
        if (!active(options)) return batch
        job.status = 'saved'; job.receipt = result; job.errorCode = null
        applyReceipt(expected, job)
        batch.phase = batch.jobs.every(row => row.status === 'saved') ? 'complete' : 'running'
      } catch (error) {
        if (!active(options)) return batch
        const code = errorCode(error, 'RESULT_UNKNOWN')
        job.status = rejectedCodes.includes(code) && !(retryingMissing && code === 'CONFLICT') ? 'rejected' : 'unknown'
        job.errorCode = code; batch.phase = job.status === 'unknown' ? 'unknown' : 'blocked'
        publish(batch, options); return batch
      }
      publish(batch, options)
    }
    return batch
  } finally { release() }
}

/** 원본 조회나 신규 저장 없이, 고정한 키·명령의 최초 접수증만 확인한다. */
export async function recoverSetupBatch(raw: SetupBatch, server: SetupServer, options: SetupBatchOptions = {}): Promise<SetupBatch> {
  const batch = restoreSetupBatch(raw, raw.scope), job = batch.jobs.find(row => row.status === 'unknown')
  if (!job) throw new ServiceError('INVALID_INPUT')
  if (!active(options)) return batch
  const release = lease(batch)
  try {
    try {
      const result = setupReceipt(await server.recover(batch.scope.memberId, copy(job.command), job.requestKey), job.command, job.requestKey)
      if (!active(options)) return batch
      job.status = 'saved'; job.receipt = result; job.errorCode = null
      // 복구 성공 뒤에도 남은 항목은 사용자가 다시 시작해야 한다.
      batch.phase = batch.jobs.every(row => row.status === 'saved') ? 'complete' : 'paused'
    } catch (error) {
      if (!active(options)) return batch
      const code = errorCode(error, 'RESULT_UNKNOWN')
      job.errorCode = code
      if (code === 'NOT_FOUND') { job.status = 'not_found'; batch.phase = 'blocked' }
      else { job.status = 'unknown'; batch.phase = 'unknown' }
    }
    publish(batch, options)
    return batch
  } finally { release() }
}
