import type { SupabaseConnection } from '../connection/supabase-connection'
import { canonical, exact, identifier, isoDate, text, version, ServiceError, validateLocalInput } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import type { OperationLessonChange, OperationsView, PublishInput } from './operations-contracts'
import { parseExchangeInput, parseExchangePreview, parsePublishInput, parseOperationLessonChange } from './operations-server'
import { TIMETABLE_OPERATIONS_NEXT_API } from './operations-next-contracts'
import type { ExchangeRecommendationInput, ExchangeRecommendations, OperationReferenceView, OperationsExtensions, PublicationManifest, PublicationChangePage, SchoolDayChangeInput, SchoolDayChangePreview } from './operations-next-contracts'
import { timetableLocalDate } from './operations-calendar'
import limits from './operations-next-limits.json'
import apiLimits from './operations-api-limits.json'

const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const rows = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail()
const unique = <T>(v: T[]): T[] => new Set(v).size === v.length ? v : fail()
const hash = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail()
const count = (v: unknown, max: number): number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max ? v as number : fail()
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function timestamp(v: unknown): string { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(); return v as string }
function response<T>(read: () => T): T { try { return read() } catch { throw new ServiceError('INVALID_RESPONSE') } }
async function digest(value: unknown): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('') }
function lifetime(created: unknown, expires: unknown, now: number) { const createdAt = timestamp(created), expiresAt = timestamp(expires); if (Date.parse(createdAt) > now + apiLimits.clockSkewMs || Date.parse(expiresAt) <= now || expiresAt <= createdAt || Date.parse(expiresAt) - Date.parse(createdAt) > apiLimits.previewLifetimeMs) fail(); return { createdAt, expiresAt } }
export function parseOperationReferences(v: unknown, view: OperationsView): OperationReferenceView {
  return response(() => {
    exact(v, ['asOf', 'from', 'until', 'lessons'])
    if (v.asOf !== view.asOf || v.from !== view.from || v.until !== view.until) fail()
    const nameMap = new Map<string, string>()
    const refs = (raw: unknown, kind: string) => {
      const result = rows(raw, limits.referencesPerLesson).map(value => { exact(value, ['id', 'name']); const id = identifier(value.id), name = text(value.name, apiLimits.title, true), key = kind + ':' + id; if (nameMap.has(key) && nameMap.get(key) !== name) fail(); nameMap.set(key, name); return { id, name } })
      unique(result.map(item => item.id)); return result
    }
    const lessons = rows(v.lessons, limits.referenceLessons).map(value => {
      exact(value, ['lessonId', 'version', 'groups', 'rooms']); const lessonId = identifier(value.lessonId), revision = version(value.version), source = view.lessons.find(lesson => lesson.id === lessonId && lesson.version === revision)
      if (!source) fail()
      const groups = refs(value.groups, 'group'), rooms = refs(value.rooms, 'room')
      if (!groups.length || !equal(groups.map(item => item.name).sort(), [...source!.groupNames].sort()) || !equal(rooms.map(item => item.name).sort(), [...source!.roomNames].sort())) fail()
      return { lessonId, version: revision, groups, rooms }
    })
    unique(lessons.map(item => item.lessonId)); if (lessons.length !== view.lessons.length) fail()
    return { asOf: view.asOf, from: view.from, until: view.until, lessons }
  })
}
export function parseRecommendationInput(v: unknown): ExchangeRecommendationInput {
  return validateLocalInput(() => { exact(v, ['lessonId', 'expectedVersion', 'reason', 'from', 'until']); const from = isoDate(v.from), until = isoDate(v.until); if (until <= from || Date.parse(until) - Date.parse(from) > apiLimits.listDays * 86400000) throw new ServiceError('INVALID_INPUT'); return { lessonId: identifier(v.lessonId), expectedVersion: version(v.expectedVersion), reason: text(v.reason, apiLimits.reason, true), from, until } })
}
export function parseExchangeRecommendations(v: unknown, input: ExchangeRecommendationInput, view: OperationsView, now = Date.now()): ExchangeRecommendations {
  return response(() => {
    exact(v, ['input', 'sourceAsOf', 'coverage', 'status', 'explanations', 'candidates']); exact(v.coverage, ['from', 'until', 'complete'])
    if (!equal(v.input, input) || v.sourceAsOf !== view.asOf || v.coverage.from !== input.from || v.coverage.until !== input.until || v.coverage.complete !== true || input.from < view.from || input.until > view.until) fail()
    if (!['candidates', 'none_found', 'search_limited'].includes(v.status as string)) fail()
    const explanations = rows(v.explanations, limits.explanations).map(item => text(item, apiLimits.message, true))
    const candidates = rows(v.candidates, limits.recommendations).map(value => {
      exact(value, ['id', 'explanation', 'input', 'preview']); const candidate = parseExchangeInput(value.input)
      if (candidate.lessonId !== input.lessonId || candidate.expectedVersion !== input.expectedVersion || candidate.reason !== input.reason) fail()
      const preview = parseExchangePreview(value.preview, candidate, view, now)
      if (preview.blockers.length || preview.changes.some(change => timetableLocalDate(change.after.time.startsAt, view.timeZone) < input.from || timetableLocalDate(new Date(Date.parse(change.after.time.endsAt) - 1).toISOString(), view.timeZone) >= input.until)) fail()
      return { id: identifier(value.id), explanation: text(value.explanation, apiLimits.message, true), input: candidate, preview }
    })
    unique(candidates.map(item => item.id)); unique(candidates.map(item => canonical(item.input)))
    if (v.status === 'candidates' && !candidates.length || v.status === 'none_found' && candidates.length || !candidates.length && !explanations.length) fail()
    return { input, sourceAsOf: view.asOf, coverage: { from: input.from, until: input.until, complete: true }, status: v.status as ExchangeRecommendations['status'], explanations, candidates }
  })
}
export async function parsePublicationManifest(v: unknown, input: PublishInput, now = Date.now()): Promise<PublicationManifest> {
  const parsed = response(() => {
    exact(v, ['previewId', 'previewHash', 'input', 'timeZone', 'createdAt', 'expiresAt', 'basisFingerprint', 'manifestHash', 'totalChanges', 'pageSize', 'pageHashes', 'blockerCount', 'complete', 'preserved']); exact(v.preserved, ['pastRecords', 'outsideRange', 'existingChanges'])
    if (!equal(parsePublishInput(v.input), input) || v.complete !== true || v.preserved.pastRecords !== true || v.preserved.outsideRange !== true || !['retained', 'blocked'].includes(v.preserved.existingChanges as string)) fail()
    const timeZone = text(v.timeZone, 100, true); new Intl.DateTimeFormat('en', { timeZone })
    const totalChanges = count(v.totalChanges, limits.manifestChanges), pageSize = count(v.pageSize, limits.pageSize), pageHashes = unique(rows(v.pageHashes, limits.pages).map(hash)), blockerCount = count(v.blockerCount, limits.manifestChanges)
    if (pageSize !== limits.pageSize || pageHashes.length !== Math.ceil(totalChanges / pageSize) || !totalChanges && !blockerCount || v.preserved.existingChanges === 'blocked' && !blockerCount) fail()
    return { previewId: identifier(v.previewId), previewHash: hash(v.previewHash), input, timeZone, ...lifetime(v.createdAt, v.expiresAt, now), basisFingerprint: hash(v.basisFingerprint), manifestHash: hash(v.manifestHash), totalChanges, pageSize, pageHashes, blockerCount, complete: true as const, preserved: { pastRecords: true as const, outsideRange: true as const, existingChanges: v.preserved.existingChanges as 'retained' | 'blocked' } }
  })
  const { manifestHash, ...content } = parsed
  if (manifestHash !== await digest(content)) fail()
  return parsed
}
export async function parsePublicationPage(v: unknown, manifest: PublicationManifest, expectedIndex: number): Promise<PublicationChangePage> {
  const parsed = response(() => {
    exact(v, ['previewId', 'manifestHash', 'index', 'pageHash', 'changes'])
    if (v.previewId !== manifest.previewId || v.manifestHash !== manifest.manifestHash || v.index !== expectedIndex || expectedIndex < 0 || expectedIndex >= manifest.pageHashes.length || v.pageHash !== manifest.pageHashes[expectedIndex]) fail()
    const changes: OperationLessonChange[] = rows(v.changes, manifest.pageSize).map(parseOperationLessonChange)
    unique(changes.map(change => change.after.id))
    for (const change of changes) for (const lesson of [change.before, change.after]) if (lesson && (timetableLocalDate(lesson.time.startsAt, manifest.timeZone) < manifest.input.from || timetableLocalDate(new Date(Date.parse(lesson.time.endsAt) - 1).toISOString(), manifest.timeZone) >= manifest.input.until || lesson.time.startsAt <= manifest.createdAt)) fail()
    if (changes.length !== Math.min(manifest.pageSize, manifest.totalChanges - expectedIndex * manifest.pageSize)) fail()
    return { previewId: manifest.previewId, manifestHash: manifest.manifestHash, index: expectedIndex, pageHash: hash(v.pageHash), changes }
  })
  if (parsed.pageHash !== await digest(parsed.changes)) fail()
  return parsed
}
export function parseSchoolDayInput(v: unknown): SchoolDayChangeInput {
  return validateLocalInput(() => {
    exact(v, ['kind', 'date', 'groupIds', 'reason', 'bells'])
    if (!['closure', 'special_bells'].includes(v.kind as string)) fail()
    const date = isoDate(v.date), groupIds = unique(rows(v.groupIds, limits.groups).map(identifier)).sort()
    if (!groupIds.length) fail()
    const bells = rows(v.bells, limits.specialBells).map(item => { exact(item, ['periodId', 'time']); exact(item.time, ['startsAt', 'endsAt']); const startsAt = timestamp(item.time.startsAt), endsAt = timestamp(item.time.endsAt); if (startsAt >= endsAt || Date.parse(endsAt) - Date.parse(startsAt) > apiLimits.lessonMinutes * 60000) fail(); return { periodId: identifier(item.periodId), time: { startsAt, endsAt } } }).sort((a, b) => a.time.startsAt.localeCompare(b.time.startsAt))
    unique(bells.map(item => item.periodId)); if (v.kind === 'closure' ? bells.length : !bells.length) fail()
    if (bells.some((item, index) => index > 0 && bells[index - 1].time.endsAt > item.time.startsAt)) fail()
    return { kind: v.kind as SchoolDayChangeInput['kind'], date, groupIds, reason: text(v.reason, apiLimits.reason, true), bells }
  })
}
export function parseSchoolDayPreview(v: unknown, input: SchoolDayChangeInput, view: OperationsView, references: OperationReferenceView, now = Date.now()): SchoolDayChangePreview {
  return response(() => {
    exact(v, ['input', 'sourceAsOf', 'previewId', 'previewHash', 'expiresAt', 'complete', 'affectedLessons', 'blockers', 'pendingRequests', 'changesActualSchedule'])
    if (!equal(v.input, input) || v.sourceAsOf !== view.asOf || v.complete !== true || v.changesActualSchedule !== false || input.date < view.from || input.date >= view.until) fail()
    const expiresAt = timestamp(v.expiresAt); if (Date.parse(expiresAt) <= now || Date.parse(expiresAt) - now > apiLimits.previewLifetimeMs) fail()
    const affectedLessons = rows(v.affectedLessons, limits.referenceLessons).map(value => { exact(value, ['lessonId', 'version']); const lessonId = identifier(value.lessonId), revision = version(value.version), source = view.lessons.find(lesson => lesson.id === lessonId && lesson.version === revision); if (!source || timetableLocalDate(source.time.startsAt, view.timeZone) !== input.date) fail(); return { lessonId, version: revision } })
    unique(affectedLessons.map(item => item.lessonId))
    const checkedReferences = parseOperationReferences(references, view)
    const expected = view.lessons.filter(lesson => lesson.state === 'scheduled' && timetableLocalDate(lesson.time.startsAt, view.timeZone) === input.date && checkedReferences.lessons.find(ref => ref.lessonId === lesson.id)!.groups.some(group => input.groupIds.includes(group.id))).map(lesson => ({ lessonId: lesson.id, version: lesson.version }))
    const order = (values: { lessonId: string; version: number }[]) => [...values].sort((a, b) => a.lessonId.localeCompare(b.lessonId))
    if (!equal(order(expected), order(affectedLessons))) fail()
    const blockers = rows(v.blockers, apiLimits.blockers).map(value => { exact(value, ['code', 'message']); if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)) fail(); return { code: value.code as string, message: text(value.message, apiLimits.message, true) } })
    return { input, sourceAsOf: view.asOf, previewId: identifier(v.previewId), previewHash: hash(v.previewHash), expiresAt, complete: true, affectedLessons, blockers, pendingRequests: count(v.pendingRequests, apiLimits.requests), changesActualSchedule: false }
  })
}
export function createTimetableOperationsExtensions(connection: SupabaseConnection): OperationsExtensions {
  const rpc = createScopedRpc(connection, TIMETABLE_OPERATIONS_NEXT_API)
  return {
    references: (memberId, view) => rpc.call(memberId, 'workhub_timetable_operations_references', { p_source_as_of: view.asOf, p_from: view.from, p_until: view.until }, raw => parseOperationReferences(raw, view)),
    recommendations: (memberId, raw, view) => { const input = parseRecommendationInput(raw), source = view.lessons.find(lesson => lesson.id === input.lessonId && lesson.version === input.expectedVersion); if (!view.canRequest || !source?.canRequest) throw new ServiceError('FORBIDDEN'); return rpc.call(memberId, 'workhub_timetable_operations_recommend', { p_input: input, p_source_as_of: view.asOf }, value => parseExchangeRecommendations(value, input, view)) },
    publicationManifest: async (memberId, raw) => { const input = parsePublishInput(raw); return await rpc.call(memberId, 'workhub_timetable_operations_publish_manifest', { p_input: input }, value => parsePublicationManifest(value, input)) },
    publicationPage: async (memberId, manifest, index) => { if (!Number.isInteger(index) || index < 0 || index >= manifest.pageHashes.length) throw new ServiceError('INVALID_INPUT'); return await rpc.call(memberId, 'workhub_timetable_operations_publish_page', { p_preview_id: manifest.previewId, p_manifest_hash: manifest.manifestHash, p_index: index }, value => parsePublicationPage(value, manifest, index)) },
    previewSchoolDay: (memberId, raw, view, references) => { if (!view.canPublish) throw new ServiceError('FORBIDDEN'); const input = parseSchoolDayInput(raw), checkedReferences = parseOperationReferences(references, view); if (input.date < view.from || input.date >= view.until || input.groupIds.some(group => !checkedReferences.lessons.some(row => row.groups.some(item => item.id === group))) || input.bells.some(bell => timetableLocalDate(bell.time.startsAt, view.timeZone) !== input.date || timetableLocalDate(new Date(Date.parse(bell.time.endsAt) - 1).toISOString(), view.timeZone) !== input.date)) throw new ServiceError('INVALID_INPUT'); return rpc.call(memberId, 'workhub_timetable_operations_school_day_preview', { p_input: input, p_source_as_of: view.asOf }, value => parseSchoolDayPreview(value, input, view, checkedReferences)) },
  }
}
