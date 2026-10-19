import { canonical, exact, identifier, text, ServiceError } from '../services/scoped-rpc'
import policy from './execution-records-policy.json'

export const EXECUTION_RECORDS_CONTRACT = 'timetable.execution-records.v1' as const
export type ExecutionOutcome = 'completed' | 'not_performed' | 'needs_review'
export const executionOutcomeLabels: Record<ExecutionOutcome, string> = { completed: '실시 완료', not_performed: '미실시', needs_review: '확인 필요' }
export interface ExecutionLesson { id: string; version: number; label: string; startsAt: string; endsAt: string; state: 'scheduled' | 'performed' | 'cancelled'; teacherIds: string[] }
export interface ExecutionRecord { id: string; version: number; lessonId: string; lessonVersion: number; outcome: ExecutionOutcome; note: string; correctionReason: string | null; recordedBy: { id: string; name: string }; recordedAt: string }
export interface ExecutionRecordsView { asOf: string; timeZone: string; lesson: ExecutionLesson; allowedOutcomes: ExecutionOutcome[]; current: ExecutionRecord | null; history: ExecutionRecord[]; nextCursor: string | null }
export interface ExecutionHistoryPage { lessonId: string; anchorRecordVersion: number; history: ExecutionRecord[]; nextCursor: string | null }
export interface ExecutionRecordCommand { lessonId: string; expectedLessonVersion: number; expectedRecordVersion: number; expectedRecordId: string | null; outcome: ExecutionOutcome; note: string; correctionReason: string | null }
export interface ExecutionRecordReceipt { requestKey: string; commandHash: string; record: ExecutionRecord }
export interface TimetableExecutionRecordsServer {
  get(memberId: string, lessonId: string): Promise<ExecutionRecordsView>
  history(memberId: string, lessonId: string, anchorRecordVersion: number, cursor: string): Promise<ExecutionHistoryPage>
  execute(memberId: string, command: ExecutionRecordCommand, key: string): Promise<ExecutionRecordReceipt>
  recover(memberId: string, command: ExecutionRecordCommand, key: string): Promise<ExecutionRecordReceipt>
  resend(memberId: string, command: ExecutionRecordCommand, key: string): Promise<ExecutionRecordReceipt>
}
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const oneOf = <T extends string>(v: unknown, choices: readonly T[]): T => choices.includes(v as T) ? v as T : fail()
const outcomes: ExecutionOutcome[] = ['completed', 'not_performed', 'needs_review']
const number = (v: unknown, zero = false): number => Number.isInteger(v) && (v as number) >= (zero ? 0 : 1) && (v as number) <= policy.maxVersion ? v as number : fail()
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail()
const unique = <T>(v: T[]): T[] => new Set(v).size === v.length ? v : fail()
const cursor = (v: unknown): string | null => v === null ? null : /^[A-Za-z0-9_-]{1,200}$/.test(text(v, 200, true)) ? v as string : fail()
function timestamp(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail()
  return v as string
}
function read<T>(fn: () => T): T { try { return fn() } catch { throw new ServiceError('INVALID_RESPONSE') } }
function input<T>(fn: () => T): T { try { return fn() } catch { throw new ServiceError('INVALID_INPUT') } }
function lesson(raw: unknown): ExecutionLesson {
  exact(raw, ['id', 'version', 'label', 'startsAt', 'endsAt', 'state', 'teacherIds'])
  const startsAt = timestamp(raw.startsAt), endsAt = timestamp(raw.endsAt), teacherIds = unique(list(raw.teacherIds, policy.teachers).map(identifier))
  if (!teacherIds.length || !startsAt.endsWith('.000Z') || !endsAt.endsWith('.000Z') || endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > policy.maxLessonSeconds * 1000) fail()
  return { id: identifier(raw.id), version: number(raw.version), label: text(raw.label, policy.label, true), startsAt, endsAt, state: oneOf(raw.state, ['scheduled', 'performed', 'cancelled']), teacherIds }
}
function record(raw: unknown): ExecutionRecord {
  exact(raw, ['id', 'version', 'lessonId', 'lessonVersion', 'outcome', 'note', 'correctionReason', 'recordedBy', 'recordedAt']); exact(raw.recordedBy, ['id', 'name'])
  const version = number(raw.version), outcome = oneOf(raw.outcome, outcomes), note = text(raw.note, policy.note, outcome !== 'completed')
  const correctionReason = raw.correctionReason === null ? null : text(raw.correctionReason, policy.correctionReason, true)
  if ((version === 1) !== (correctionReason === null)) fail()
  return { id: identifier(raw.id), version, lessonId: identifier(raw.lessonId), lessonVersion: number(raw.lessonVersion), outcome, note, correctionReason, recordedBy: { id: identifier(raw.recordedBy.id), name: text(raw.recordedBy.name, policy.label, true) }, recordedAt: timestamp(raw.recordedAt) }
}
function history(raw: unknown, next: unknown, lessonId: string, fromVersion: number, maxLessonVersion?: number, asOf?: string) {
  const rows = list(raw, policy.pageSize).map(record), nextCursor = cursor(next)
  if (rows.length !== Math.min(policy.pageSize, fromVersion)) fail()
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.lessonId !== lessonId || row.version !== fromVersion - index || maxLessonVersion !== undefined && row.lessonVersion > maxLessonVersion || asOf && row.recordedAt > asOf) fail()
    if (index && (row.id !== rows[0].id || row.recordedAt > rows[index - 1].recordedAt || row.lessonVersion > rows[index - 1].lessonVersion)) fail()
  }
  if ((fromVersion > rows.length) !== (nextCursor !== null)) fail()
  return { history: rows, nextCursor }
}
export function parseExecutionRecordsView(raw: unknown, lessonId: string, now = Date.now()): ExecutionRecordsView {
  return read(() => {
    exact(raw, ['asOf', 'timeZone', 'lesson', 'allowedOutcomes', 'current', 'history', 'nextCursor'])
    const asOf = timestamp(raw.asOf), source = lesson(raw.lesson), timeZone = text(raw.timeZone, 100, true)
    new Intl.DateTimeFormat('en', { timeZone })
    if (source.id !== lessonId || Date.parse(asOf) > now + policy.clockSkewMs) fail()
    const allowedOutcomes = unique(list(raw.allowedOutcomes, outcomes.length).map(v => oneOf(v, outcomes))), current = raw.current === null ? null : record(raw.current)
    // 시각이 지났다는 이유로 완료를 추정하지 않는다. 미래 수업 쓰기는 서버와 앱 양쪽에서 막는다.
    if (source.endsAt > asOf && allowedOutcomes.length || current && (current.lessonId !== lessonId || current.lessonVersion > source.version || current.recordedAt > asOf)) fail()
    const page = history(raw.history, raw.nextCursor, lessonId, current?.version ?? 0, source.version, asOf)
    if (current && canonical(current) !== canonical(page.history[0])) fail()
    return { asOf, timeZone, lesson: source, allowedOutcomes, current, ...page }
  })
}
export function parseExecutionHistoryPage(raw: unknown, lessonId: string, anchorRecordVersion: number, fromVersion: number, recordId: string, lastRecord: ExecutionRecord, asOf: string): ExecutionHistoryPage {
  return read(() => {
    exact(raw, ['lessonId', 'anchorRecordVersion', 'history', 'nextCursor'])
    if (raw.lessonId !== lessonId || raw.anchorRecordVersion !== anchorRecordVersion) fail()
    const page = history(raw.history, raw.nextCursor, lessonId, fromVersion, lastRecord.lessonVersion, asOf)
    if (!page.history.length || page.history[0].id !== recordId || page.history[0].recordedAt > lastRecord.recordedAt) fail()
    return { lessonId, anchorRecordVersion, ...page }
  })
}
export function executionRecordCommand(raw: unknown, source?: ExecutionRecordsView): ExecutionRecordCommand {
  const command = input(() => {
    exact(raw, ['lessonId', 'expectedLessonVersion', 'expectedRecordVersion', 'expectedRecordId', 'outcome', 'note', 'correctionReason'])
    const expectedRecordVersion = number(raw.expectedRecordVersion, true), outcome = oneOf(raw.outcome, outcomes)
    if (expectedRecordVersion === policy.maxVersion) fail()
    const expectedRecordId = raw.expectedRecordId === null ? null : identifier(raw.expectedRecordId)
    if ((expectedRecordVersion === 0) !== (expectedRecordId === null)) fail()
    const correctionReason = raw.correctionReason === null ? null : text(raw.correctionReason, policy.correctionReason, true)
    if ((expectedRecordVersion === 0) !== (correctionReason === null)) fail()
    return { lessonId: identifier(raw.lessonId), expectedLessonVersion: number(raw.expectedLessonVersion), expectedRecordVersion, expectedRecordId, outcome, note: text(raw.note, policy.note, outcome !== 'completed'), correctionReason }
  })
  if (source) {
    if (command.lessonId !== source.lesson.id || command.expectedLessonVersion !== source.lesson.version || command.expectedRecordVersion !== (source.current?.version ?? 0) || command.expectedRecordId !== (source.current?.id ?? null)) throw new ServiceError('CONFLICT')
    if (!source.allowedOutcomes.includes(command.outcome)) throw new ServiceError('FORBIDDEN')
  }
  return command
}
export async function executionRecordCommandHash(command: ExecutionRecordCommand): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(command)))), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function parseExecutionRecordReceipt(raw: unknown, command: ExecutionRecordCommand, key: string, commandHash: string, memberId: string, now = Date.now()): ExecutionRecordReceipt {
  return read(() => {
    exact(raw, ['requestKey', 'commandHash', 'record']); const saved = record(raw.record)
    if (raw.requestKey !== key || raw.commandHash !== commandHash || saved.lessonId !== command.lessonId || saved.lessonVersion !== command.expectedLessonVersion || saved.version !== command.expectedRecordVersion + 1 || command.expectedRecordId !== null && saved.id !== command.expectedRecordId || saved.outcome !== command.outcome || saved.note !== command.note || saved.correctionReason !== command.correctionReason || saved.recordedBy.id !== memberId || Date.parse(saved.recordedAt) > now + policy.clockSkewMs) fail()
    return { requestKey: key, commandHash, record: saved }
  })
}
