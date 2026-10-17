import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { canonical, createScopedRpc, exact, identifier, isoDate, text, version, ServiceError, validateLocalInput } from '../services/scoped-rpc'
import type { OperationLesson, OperationTime, OperationsView } from './operations-contracts'
import type { OperationReferenceView } from './operations-next-contracts'
import { parseOperationReferences } from './operations-next-server'
import { parseOperationLessonChange, parseOperationsView } from './operations-server'
import { timetableLocalDate } from './operations-calendar'
import { TIMETABLE_SCHOOL_DAY_API } from './school-day-execution-contracts'
import type { SchoolDayCommitCommand, SchoolDayCommitReceipt, SchoolDayExecutionInput, SchoolDayExecutionPreview, SchoolDayExecutionServer } from './school-day-execution-contracts'
import limits from './operations-api-limits.json'
import nextLimits from './operations-next-limits.json'

const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const rows = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : fail()
const unique = <T>(value: T[]): T[] => new Set(value).size === value.length ? value : fail()
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail()
const count = (value: unknown, max: number): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max ? value as number : fail()
const ordered = <T>(values: T[], key: (value: T) => string) => [...values].sort((a, b) => key(a).localeCompare(key(b)))
function stamp(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(); return value as string }
function time(value: unknown): OperationTime { exact(value, ['startsAt', 'endsAt']); const startsAt = stamp(value.startsAt), endsAt = stamp(value.endsAt); if (startsAt >= endsAt || Date.parse(endsAt) - Date.parse(startsAt) > limits.lessonMinutes * 60000) fail(); return { startsAt, endsAt } }
async function digest(value: unknown): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('') }
function parsed<T>(read: () => T): T { try { return read() } catch { return fail() } }
function sameDay(value: OperationTime, date: string, zone: string) { return timetableLocalDate(value.startsAt, zone) === date && timetableLocalDate(new Date(Date.parse(value.endsAt) - 1).toISOString(), zone) === date }
export function parseSchoolDayExecutionInput(value: unknown): SchoolDayExecutionInput {
  return validateLocalInput(() => {
    exact(value, ['kind', 'date', 'groupIds', 'reason', 'bells'])
    if (value.kind !== 'closure' && value.kind !== 'special_bells') fail()
    const groupIds = unique(rows(value.groupIds, nextLimits.groups).map(identifier)).sort()
    if (!groupIds.length) fail()
    const bells = rows(value.bells, nextLimits.specialBells).map(item => { exact(item, ['before', 'after']); return { before: time(item.before), after: time(item.after) } }).sort((a, b) => a.before.startsAt.localeCompare(b.before.startsAt) || a.before.endsAt.localeCompare(b.before.endsAt))
    unique(bells.map(item => canonical(item.before)))
    if (value.kind === 'closure' ? bells.length !== 0 : bells.length === 0) fail()
    return { kind: value.kind as SchoolDayExecutionInput['kind'], date: isoDate(value.date), groupIds, reason: text(value.reason, limits.reason, true), bells }
  })
}
export function schoolDaySourceLessons(input: SchoolDayExecutionInput, view: OperationsView, references: OperationReferenceView): OperationLesson[] {
  const refs = new Map(references.lessons.map(ref => [ref.lessonId, ref])), groups = new Set(input.groupIds)
  return view.lessons.filter(lesson => lesson.state === 'scheduled' && timetableLocalDate(lesson.time.startsAt, view.timeZone) <= input.date && timetableLocalDate(new Date(Date.parse(lesson.time.endsAt) - 1).toISOString(), view.timeZone) >= input.date && refs.get(lesson.id)?.groups.some(group => groups.has(group.id)))
}
function validateContext(input: SchoolDayExecutionInput, view: OperationsView, references: OperationReferenceView) {
  parseOperationReferences(references, view)
  if (!view.canPublish || input.date < view.from || input.date >= view.until || input.groupIds.some(group => !references.lessons.some(ref => ref.groups.some(row => row.id === group)))) fail()
  if (input.bells.some(bell => !sameDay(bell.before, input.date, view.timeZone) || !sameDay(bell.after, input.date, view.timeZone))) fail()
  const source = schoolDaySourceLessons(input, view, references)
  if (input.kind === 'special_bells' && !equal([...new Set(source.map(lesson => canonical(lesson.time)))].sort(), input.bells.map(bell => canonical(bell.before)).sort())) fail()
  return source
}
/** 시간대의 누락·중복 시각은 추정하지 않는다. 특별일과는 분 단위로 입력한다. */
export function schoolDayLocalTime(date: string, clock: string, zone: string): string {
  return validateLocalInput(() => {
    isoDate(date); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) fail()
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const nominal = Date.parse(date + 'T' + clock + ':00.000Z'), matches: string[] = []
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const candidate = new Date(nominal + offset * 60000), parts = formatter.formatToParts(candidate), pick = (kind: string) => parts.find(part => part.type === kind)!.value
      if ([pick('year'), pick('month'), pick('day')].join('-') === date && pick('hour') + ':' + pick('minute') === clock) matches.push(candidate.toISOString())
    }
    if (matches.length !== 1) fail(); return matches[0]
  })
}
export async function parseSchoolDayExecutionPreview(value: unknown, input: SchoolDayExecutionInput, view: OperationsView, references: OperationReferenceView, now = Date.now(), expiredAllowed = false): Promise<SchoolDayExecutionPreview> {
  const result = parsed(() => {
    exact(value, ['input', 'sourceAsOf', 'previewId', 'previewHash', 'createdAt', 'expiresAt', 'complete', 'coverage', 'affectedLessons', 'changes', 'requestEffects', 'blockers', 'preserved', 'lostLessonCount', 'lostMinutes', 'changesActualSchedule'])
    exact(value.coverage, ['date', 'groupIds', 'complete', 'existingRequests']); exact(value.preserved, ['pastRecords', 'outsideTarget', 'existingChanges'])
    if (!equal(value.input, input) || value.sourceAsOf !== view.asOf || value.complete !== true || value.changesActualSchedule !== false || !equal(value.coverage, { date: input.date, groupIds: input.groupIds, complete: true, existingRequests: 'complete' })) fail()
    if (value.preserved.pastRecords !== true || value.preserved.outsideTarget !== true || !['retained', 'blocked'].includes(value.preserved.existingChanges as string)) fail()
    const createdAt = stamp(value.createdAt), expiresAt = stamp(value.expiresAt)
    if (createdAt < view.asOf || Date.parse(createdAt) > now + limits.clockSkewMs || expiresAt <= createdAt || Date.parse(expiresAt) - Date.parse(createdAt) > limits.previewLifetimeMs || !expiredAllowed && Date.parse(expiresAt) <= now) fail()
    const source = validateContext(input, view, references)
    const affectedLessons = rows(value.affectedLessons, limits.lessons).map(row => { exact(row, ['lessonId', 'version']); return { lessonId: identifier(row.lessonId), version: version(row.version) } })
    unique(affectedLessons.map(row => row.lessonId))
    if (!equal(ordered(affectedLessons, row => row.lessonId), ordered(source.map(row => ({ lessonId: row.id, version: row.version })), row => row.lessonId))) fail()
    const blockers = rows(value.blockers, limits.blockers).map(row => { exact(row, ['code', 'message']); if (typeof row.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(row.code)) fail(); return { code: row.code as string, message: text(row.message, limits.message, true) } })
    unique(blockers.map(row => row.code)); const blocked = (code: string) => { if (!blockers.some(row => row.code === code)) fail() }
    const joint = source.filter(lesson => references.lessons.find(ref => ref.lessonId === lesson.id)!.groups.some(group => !input.groupIds.includes(group.id)))
    const past = source.filter(lesson => lesson.time.startsAt <= createdAt)
    const crossing = source.filter(lesson => !sameDay(lesson.time, input.date, view.timeZone))
    if (joint.length) blocked('PARTIAL_GROUP_SCOPE'); if (past.length) blocked('PAST_RECORD'); if (crossing.length) blocked('CROSS_DAY_LESSON'); if (!source.length) blocked('NO_LESSONS')
    const eligible = source.filter(lesson => !joint.includes(lesson) && !past.includes(lesson) && !crossing.includes(lesson))
    const expected = eligible.flatMap(before => {
      const target = input.bells.find(bell => equal(bell.before, before.time))?.after
      if (input.kind === 'special_bells' && equal(target, before.time)) return []
      return [{ before, after: input.kind === 'closure' ? { ...before, version: before.version + 1, state: 'cancelled' as const, canRequest: false, allowedTargets: [] } : { ...before, version: before.version + 1, time: target!, allowedTargets: [], canRequest: false } }]
    })
    const changes = rows(value.changes, limits.lessons).map(parseOperationLessonChange); unique(changes.map(row => row.after.id))
    if (!equal(ordered(changes, row => row.after.id), ordered(expected, row => row.after.id))) fail()
    if (!changes.length && !blockers.length) fail()
    if (changes.some(change => change.after.state !== 'cancelled' && change.after.time.startsAt <= createdAt)) blocked('PAST_TARGET')
    const affected = new Set(source.map(row => row.id))
    const relevantRequests = view.requests.filter(request => ['awaiting_consent', 'awaiting_approval', 'applied'].includes(request.state) && request.changes.some(change => affected.has(change.after.id)))
    const requestEffects = rows(value.requestEffects, limits.requests).map(row => {
      exact(row, ['requestId', 'version', 'state', 'handling']); if (!['awaiting_consent', 'awaiting_approval', 'applied'].includes(row.state as string) || row.handling !== 'blocked') fail()
      return { requestId: identifier(row.requestId), version: version(row.version), state: row.state as SchoolDayExecutionPreview['requestEffects'][number]['state'], handling: 'blocked' as const }
    })
    unique(requestEffects.map(row => row.requestId))
    if (!equal(ordered(requestEffects, row => row.requestId), ordered(relevantRequests.map(row => ({ requestId: row.id, version: row.version, state: row.state, handling: 'blocked' })), row => row.requestId))) fail()
    if (requestEffects.length) { blocked('EXISTING_EXCHANGE'); if (value.preserved.existingChanges !== 'blocked') fail() }
    if (value.preserved.existingChanges === 'blocked' && !blockers.length) fail()
    // 교사와 같은 학생 집단의 중복을 확인한다. 공간 정원은 이 DTO에 없으므로 1로 추정하지 않는다.
    const afterById = new Map(changes.map(change => [change.after.id, change.after])), refsById = new Map(references.lessons.map(ref => [ref.lessonId, ref]))
    const finalLessons = view.lessons.map(lesson => afterById.get(lesson.id) ?? lesson).filter(lesson => lesson.state === 'scheduled' && timetableLocalDate(lesson.time.startsAt, view.timeZone) <= input.date && timetableLocalDate(new Date(Date.parse(lesson.time.endsAt) - 1).toISOString(), view.timeZone) >= input.date).sort((a, b) => a.time.startsAt.localeCompare(b.time.startsAt))
    const changedIds = new Set(changes.map(change => change.after.id))
    for (let index = 0; index < finalLessons.length; index++) for (let other = index + 1; other < finalLessons.length; other++) {
      const a = finalLessons[index], b = finalLessons[other]
      if (b.time.startsAt >= a.time.endsAt) break
      if ((!changedIds.has(a.id) && !changedIds.has(b.id)) || a.time.startsAt >= b.time.endsAt || b.time.startsAt >= a.time.endsAt) continue
      const aRef = refsById.get(a.id)!, bRef = refsById.get(b.id)!
      if (a.teachers.some(teacher => b.teachers.some(row => row.id === teacher.id)) || aRef.groups.some(group => bRef.groups.some(row => row.id === group.id))) blocked('RESOURCE_CONFLICT')
    }
    const lostLessonCount = changes.filter(change => change.after.state === 'cancelled').length
    const lostMinutes = changes.reduce((sum, change) => sum + Math.max(0, (Date.parse(change.before!.time.endsAt) - Date.parse(change.before!.time.startsAt) - (change.after.state === 'cancelled' ? 0 : Date.parse(change.after.time.endsAt) - Date.parse(change.after.time.startsAt))) / 60000), 0)
    if (value.lostLessonCount !== lostLessonCount || value.lostMinutes !== lostMinutes) fail()
    return { input, sourceAsOf: view.asOf, previewId: identifier(value.previewId), previewHash: hash(value.previewHash), createdAt, expiresAt, complete: true as const, coverage: { date: input.date, groupIds: input.groupIds, complete: true as const, existingRequests: 'complete' as const }, affectedLessons, changes, requestEffects, blockers, preserved: { pastRecords: true as const, outsideTarget: true as const, existingChanges: value.preserved.existingChanges as 'retained' | 'blocked' }, lostLessonCount, lostMinutes, changesActualSchedule: false as const }
  })
  const { previewHash, ...content } = result
  if (previewHash !== await digest(content)) fail()
  return result
}
export function schoolDayCommitCommand(result: SchoolDayExecutionPreview, view: OperationsView, references: OperationReferenceView): SchoolDayCommitCommand {
  return structuredClone({ kind: 'school_day', preview: { previewId: result.previewId, previewHash: result.previewHash, expiresAt: result.expiresAt }, context: { view, references, result } })
}
export function schoolDayCompactCommand(command: SchoolDayCommitCommand) { return { kind: 'school_day' as const, preview: { ...command.preview } } }
export const schoolDayCommandHash = (command: SchoolDayCommitCommand) => digest(schoolDayCompactCommand(command))
async function validateCommand(value: SchoolDayCommitCommand, memberId: string, now: number, expiredAllowed: boolean) {
  exact(value, ['kind', 'preview', 'context']); exact(value.preview, ['previewId', 'previewHash', 'expiresAt']); exact(value.context, ['view', 'references', 'result'])
  if (value.kind !== 'school_day') fail()
  const view = parseOperationsView(value.context.view, memberId, value.context.view.from, value.context.view.until, now), references = parseOperationReferences(value.context.references, view)
  const result = await parseSchoolDayExecutionPreview(value.context.result, parseSchoolDayExecutionInput(value.context.result.input), view, references, now, expiredAllowed)
  if (!equal(value.preview, { previewId: result.previewId, previewHash: result.previewHash, expiresAt: result.expiresAt }) || result.blockers.length || !result.changes.length) fail()
  return schoolDayCommitCommand(result, view, references)
}
export async function parseSchoolDayCommitReceipt(value: unknown, command: SchoolDayCommitCommand, key: string, now = Date.now()): Promise<SchoolDayCommitReceipt> {
  const commandHash = await schoolDayCommandHash(command), changesHash = await digest(command.context.result.changes.map(change => ({ id: change.after.id, version: change.after.version })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return parsed(() => {
    exact(value, ['requestKey', 'commandHash', 'kind', 'entityId', 'version', 'status', 'recordedAt', 'changedLessonCount', 'changesHash', 'lostLessonCount'])
    if (value.requestKey !== key || value.commandHash !== commandHash || value.kind !== 'school_day' || value.version !== 1 || value.status !== 'applied' || value.changesHash !== changesHash || value.changedLessonCount !== command.context.result.changes.length || value.lostLessonCount !== command.context.result.lostLessonCount) fail()
    const recordedAt = stamp(value.recordedAt)
    if (recordedAt < command.context.result.createdAt || Date.parse(recordedAt) > now + limits.clockSkewMs || recordedAt >= command.preview.expiresAt) fail()
    return { requestKey: key, commandHash, kind: 'school_day', entityId: identifier(value.entityId), version: 1, status: 'applied', recordedAt, changedLessonCount: count(value.changedLessonCount, limits.lessons), changesHash, lostLessonCount: count(value.lostLessonCount, limits.lessons) }
  })
}
export function createSchoolDayExecutionServer(connection: SupabaseConnection, options: { now?: () => number; timeoutMs?: number } = {}): SchoolDayExecutionServer {
  const rpc = createScopedRpc(connection, TIMETABLE_SCHOOL_DAY_API, { timeoutMs: options.timeoutMs }), previews = new Map<string, string>(), originals = new Map<string, string>(), receipts = new Map<string, string>()
  const now = () => { const result = options.now ? options.now() : Date.now(); if (!Number.isFinite(result)) throw new ServiceError('INVALID_INPUT'); return result }
  const scope = (memberId: string) => { const member = connection.info().memberships.find(row => row.id === identifier(memberId)); if (!member) throw new ServiceError('CANCELLED'); return recoveryScope(member) }
  async function send(memberId: string, value: SchoolDayCommitCommand, requestedKey: string, recover: boolean) {
    const key = validateLocalInput(() => { const key = text(requestedKey, 200, true); if (key.length < 8) fail(); return key }), originalScope = scope(memberId)
    const command = await validateCommand(value, memberId, now(), recover), identity = originalScope + ':' + key, compact = schoolDayCompactCommand(command)
    if (originals.has(identity) && originals.get(identity) !== canonical(command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    if (!recover && previews.get(originalScope + ':' + command.preview.previewId) !== canonical(command)) throw new ServiceError('NOT_READY')
    if (scope(memberId) !== originalScope) throw new ServiceError('CANCELLED')
    originals.set(identity, canonical(command))
    // 복구는 접수증 조회만 허용하며 만료된 미리보기로 새 반영을 하지 않는다.
    return rpc.call(memberId, 'workhub_timetable_school_day_execute', { p_command: compact, p_request_key: key, p_recover_only: recover }, async raw => {
      const receipt = await parseSchoolDayCommitReceipt(raw, command, key, now()), content = canonical(receipt)
      if (receipts.has(identity) && receipts.get(identity) !== content) fail()
      receipts.set(identity, content); return receipt
    }, !recover)
  }
  return {
    async preview(memberId, raw, view, references) {
      if (!view.canPublish) throw new ServiceError('FORBIDDEN')
      const input = parseSchoolDayExecutionInput(raw), originalScope = scope(memberId)
      validateLocalInput(() => validateContext(input, view, references))
      const result = await rpc.call(memberId, 'workhub_timetable_school_day_preview', { p_input: input, p_source_as_of: view.asOf, p_from: view.from, p_until: view.until }, value => parseSchoolDayExecutionPreview(value, input, view, references, now()))
      if (scope(memberId) !== originalScope) throw new ServiceError('CANCELLED')
      previews.set(originalScope + ':' + result.previewId, canonical(schoolDayCommitCommand(result, view, references)))
      return result
    },
    execute: (memberId, command, key) => send(memberId, command, key, false),
    recover: (memberId, command, key) => send(memberId, command, key, true),
  }
}
