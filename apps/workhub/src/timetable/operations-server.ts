import { recoveryScope } from '../app/pending-requests'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, canonical, exact, identifier, isoDate, text, version, ServiceError } from '../services/scoped-rpc'
import { TIMETABLE_OPERATIONS_API } from './operations-contracts'
import type { OperationTime, OperationTeacher, OperationLesson, OperationLessonChange, OperationBlocker, PublishInput, ExchangeInput, PublishPreview, ExchangePreview, ExchangeRequestView, RequestAction, RequestState, OperationsView, OperationsReadiness, OperationCommand, OperationReceipt, TimetableOperationsServer } from './operations-contracts'
import limits from './operations-api-limits.json'

const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail()
const rows = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail()
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T => values.includes(v as T) ? v as T : fail()
const unique = <T>(v: T[]): T[] => new Set(v).size === v.length ? v : fail()
const hash = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail()
const states: RequestState[] = ['awaiting_consent', 'awaiting_approval', 'applied', 'rejected', 'withdrawn', 'expired', 'stale']
const actions: RequestAction[] = ['accept', 'reject', 'withdraw', 'approve', 'rejectApproval']
const activeStates: RequestState[] = ['awaiting_consent', 'awaiting_approval']
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function timestamp(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail()
  return v as string
}
function time(v: unknown): OperationTime {
  exact(v, ['startsAt', 'endsAt'])
  const startsAt = timestamp(v.startsAt), endsAt = timestamp(v.endsAt)
  if (startsAt >= endsAt || Date.parse(endsAt) - Date.parse(startsAt) > limits.lessonMinutes * 60000) fail()
  return { startsAt, endsAt }
}
function range(from: unknown, until: unknown, max: number) {
  const first = isoDate(from), last = isoDate(until), days = (Date.parse(last) - Date.parse(first)) / 86400000
  if (days < 1 || days > max) fail()
  return { from: first, until: last }
}
function localDate(at: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-')
}
function teacher(v: unknown): OperationTeacher {
  exact(v, ['id', 'name']); return { id: identifier(v.id), name: text(v.name, limits.title, true) }
}
function teachers(v: unknown): OperationTeacher[] {
  const result = rows(v, limits.teachers).map(teacher); unique(result.map(t => t.id)); return result
}
function lesson(v: unknown): OperationLesson {
  exact(v, ['id', 'version', 'label', 'time', 'teachers', 'groupNames', 'roomNames', 'state', 'canRequest', 'allowedTargets'])
  const names = (value: unknown) => rows(value, limits.namesPerLesson).map(name => text(name, limits.title, true))
  const result: OperationLesson = {
    id: identifier(v.id), version: version(v.version), label: text(v.label, limits.title, true), time: time(v.time), teachers: teachers(v.teachers),
    groupNames: names(v.groupNames), roomNames: names(v.roomNames), state: oneOf(v.state, ['scheduled', 'performed', 'cancelled']), canRequest: bool(v.canRequest),
    allowedTargets: rows(v.allowedTargets, limits.targets).map(time),
  }
  if (!result.teachers.length || !result.groupNames.length || result.canRequest && result.state !== 'scheduled') fail()
  unique(result.allowedTargets.map(canonical))
  return result
}
function changes(v: unknown): OperationLessonChange[] {
  const result = rows(v, limits.changes).map(value => {
    exact(value, ['before', 'after']); const before = value.before === null ? null : lesson(value.before), after = lesson(value.after)
    if (before ? after.id !== before.id || after.version !== before.version + 1 || before.state !== 'scheduled' : after.version !== 1) fail()
    if (after.state === 'performed') fail()
    return { before, after }
  })
  unique(result.map(c => c.after.id)); return result
}
function relatedTeachers(changed: OperationLessonChange[]): OperationTeacher[] {
  const map = new Map<string, OperationTeacher>()
  for (const row of changed) for (const t of [...(row.before?.teachers ?? []), ...row.after.teachers]) {
    const old = map.get(t.id); if (old && old.name !== t.name) fail(); map.set(t.id, t)
  }
  return [...map.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function sameTeachers(actual: OperationTeacher[], expected: OperationTeacher[]) {
  const sorted = (v: OperationTeacher[]) => [...v].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (!equal(sorted(actual), sorted(expected))) fail()
}
function blockers(v: unknown, ids: string[]): OperationBlocker[] {
  return rows(v, limits.blockers).map(value => {
    exact(value, ['code', 'message', 'lessonIds'])
    if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)) fail()
    const lessonIds = unique(rows(value.lessonIds, limits.changes).map(identifier)); if (lessonIds.some(id => !ids.includes(id))) fail()
    return { code: value.code as string, message: text(value.message, limits.message, true), lessonIds }
  })
}
function response<T>(read: () => T): T { try { return read() } catch { throw new ServiceError('INVALID_RESPONSE') } }
function input<T>(read: () => T): T { try { return read() } catch { throw new ServiceError('INVALID_INPUT') } }
function publishInputRaw(v: unknown): PublishInput {
  exact(v, ['draftId', 'draftVersion', 'from', 'until'])
  return { draftId: identifier(v.draftId), draftVersion: version(v.draftVersion), ...range(v.from, v.until, limits.publishDays) }
}
export const parsePublishInput = (v: unknown): PublishInput => input(() => publishInputRaw(v))
function exchangeInputRaw(v: unknown): ExchangeInput {
  if (!v || typeof v !== 'object' || !('kind' in v)) fail()
  if ((v as { kind: unknown }).kind === 'move') {
    exact(v, ['kind', 'lessonId', 'expectedVersion', 'target', 'reason'])
    return { kind: 'move', lessonId: identifier(v.lessonId), expectedVersion: version(v.expectedVersion), target: time(v.target), reason: text(v.reason, limits.reason) }
  }
  exact(v, ['kind', 'lessonId', 'expectedVersion', 'otherLessonId', 'otherExpectedVersion', 'reason'])
  if (v.kind !== 'swap' || v.lessonId === v.otherLessonId) fail()
  return { kind: 'swap', lessonId: identifier(v.lessonId), expectedVersion: version(v.expectedVersion), otherLessonId: identifier(v.otherLessonId), otherExpectedVersion: version(v.otherExpectedVersion), reason: text(v.reason, limits.reason) }
}
export const parseExchangeInput = (v: unknown): ExchangeInput => input(() => exchangeInputRaw(v))
function readonlyLesson(l: OperationLesson) { const { time: _time, version: _version, ...rest } = l; return rest }
function checkExchangeChanges(changed: OperationLessonChange[], kind: 'move' | 'swap') {
  if (changed.length !== (kind === 'move' ? 1 : 2)) fail()
  for (const c of changed) {
    if (!c.before || c.after.state !== 'scheduled' || !equal(readonlyLesson(c.before), readonlyLesson(c.after)) || equal(c.before.time, c.after.time)) fail()
    if (Date.parse(c.before!.time.endsAt) - Date.parse(c.before!.time.startsAt) !== Date.parse(c.after.time.endsAt) - Date.parse(c.after.time.startsAt)) fail()
    if (!c.before!.allowedTargets.some(t => equal(t, c.after.time))) fail()
  }
  if (kind === 'swap' && !equal(changed.map(c => canonical(c.before!.time)).sort(), changed.map(c => canonical(c.after.time)).sort())) fail()
}
function previewBase<T>(v: Record<string, unknown>, command: T, parseInput: (v: unknown) => T, now: number) {
  const actualInput = parseInput(v.input); if (!equal(actualInput, command) || v.complete !== true) fail()
  const createdAt = timestamp(v.createdAt), expiresAt = timestamp(v.expiresAt), created = Date.parse(createdAt), expires = Date.parse(expiresAt)
  if (created > now + limits.clockSkewMs || expires <= now || expires <= created || expires - created > limits.previewLifetimeMs) fail()
  const changed = changes(v.changes), participants = teachers(v.participants)
  sameTeachers(participants, relatedTeachers(changed))
  const blocked = blockers(v.blockers, changed.map(c => c.after.id))
  if (!changed.length && !blocked.length) fail()
  return { previewId: identifier(v.previewId), previewHash: hash(v.previewHash), createdAt, expiresAt, input: actualInput, complete: true as const, changes: changed, participants, blockers: blocked }
}
export function parsePublishPreview(v: unknown, command: PublishInput, zone: string, now = Date.now()): PublishPreview {
  return response(() => {
    exact(v, ['previewId', 'previewHash', 'createdAt', 'expiresAt', 'input', 'complete', 'changes', 'participants', 'blockers', 'preserved', 'excludedDays'])
    const p = previewBase(v, command, publishInputRaw, now)
    exact(v.preserved, ['outsideRange', 'pastRecords', 'existingChanges'])
    if (v.preserved.outsideRange !== true || v.preserved.pastRecords !== true) fail()
    const existingChanges = oneOf(v.preserved.existingChanges, ['retained', 'blocked'])
    if (existingChanges === 'blocked' && !p.blockers.length) fail()
    for (const c of p.changes) for (const l of [c.before, c.after]) if (l) {
      if (localDate(l.time.startsAt, zone) < command.from || localDate(new Date(Date.parse(l.time.endsAt) - 1).toISOString(), zone) >= command.until || Date.parse(l.time.startsAt) <= now) fail()
    }
    const excludedDays = rows(v.excludedDays, limits.publishDays).map(value => {
      exact(value, ['date', 'reason']); const date = isoDate(value.date)
      if (date < command.from || date >= command.until) fail()
      return { date, reason: text(value.reason, limits.message, true) }
    })
    unique(excludedDays.map(day => day.date))
    for (const c of p.changes) if (c.after.state !== 'cancelled' && excludedDays.some(day => localDate(c.after.time.startsAt, zone) === day.date)) fail()
    return { ...p, excludedDays, preserved: { outsideRange: true, pastRecords: true, existingChanges } }
  })
}
export function parseExchangePreview(v: unknown, command: ExchangeInput, source: OperationsView, now = Date.now()): ExchangePreview {
  return response(() => {
    exact(v, ['previewId', 'previewHash', 'createdAt', 'expiresAt', 'input', 'complete', 'changes', 'participants', 'blockers'])
    const p = previewBase(v, command, exchangeInputRaw, now); checkExchangeChanges(p.changes, command.kind)
    const expected = command.kind === 'move' ? [{ id: command.lessonId, version: command.expectedVersion, target: command.target }] : [
      { id: command.lessonId, version: command.expectedVersion, target: source.lessons.find(l => l.id === command.otherLessonId)?.time },
      { id: command.otherLessonId, version: command.otherExpectedVersion, target: source.lessons.find(l => l.id === command.lessonId)?.time },
    ]
    for (const e of expected) {
      const c = p.changes.find(row => row.after.id === e.id), original = source.lessons.find(l => l.id === e.id)
      if (!c?.before || !original || !equal(c.before, original) || c.before.version !== e.version || !equal(c.after.time, e.target) || Date.parse(c.before.time.startsAt) <= now || Date.parse(c.after.time.startsAt) <= now) fail()
    }
    return p
  })
}
function requestView(v: unknown, memberId: string, asOf: string): ExchangeRequestView {
  exact(v, ['id', 'version', 'proposalHash', 'state', 'kind', 'requester', 'requesterIsViewer', 'createdAt', 'expiresAt', 'reason', 'changes', 'participants', 'actions'])
  const changed = changes(v.changes), kind = oneOf(v.kind, ['move', 'swap']), state = oneOf(v.state, states), createdAt = timestamp(v.createdAt), expiresAt = timestamp(v.expiresAt)
  checkExchangeChanges(changed, kind)
  if (createdAt > asOf || createdAt >= expiresAt || activeStates.includes(state) && expiresAt <= asOf || state === 'expired' && expiresAt > asOf) fail()
  const requester = teacher(v.requester), requesterIsViewer = bool(v.requesterIsViewer)
  if (requester.id === memberId && !requesterIsViewer || !changed.some(c => c.before!.teachers.some(t => t.id === requester.id))) fail()
  const participants = rows(v.participants, limits.teachers).map(value => {
    exact(value, ['id', 'name', 'response', 'respondedAt'])
    const result = { id: identifier(value.id), name: text(value.name, limits.title, true), response: oneOf(value.response, ['pending', 'accepted', 'rejected']), respondedAt: value.respondedAt === null ? null : timestamp(value.respondedAt) }
    if ((result.response === 'pending') !== (result.respondedAt === null) || result.respondedAt && (result.respondedAt < createdAt || result.respondedAt > asOf || result.respondedAt >= expiresAt)) fail()
    return result
  })
  unique(participants.map(t => t.id)); sameTeachers(participants.map(({ id, name }) => ({ id, name })), relatedTeachers(changed))
  const allAccepted = participants.length > 0 && participants.every(p => p.response === 'accepted')
  if (['awaiting_approval', 'applied'].includes(state) && !allAccepted || state === 'awaiting_consent' && (allAccepted || participants.some(p => p.response === 'rejected'))) fail()
  const allowed = unique(rows(v.actions, actions.length).map(a => oneOf(a, actions)))
  for (const action of allowed) {
    if (!activeStates.includes(state)) fail()
    if (['accept', 'reject'].includes(action) && (state !== 'awaiting_consent' || !participants.some(p => p.id === memberId && p.response === 'pending'))) fail()
    if (action === 'withdraw' && !requesterIsViewer) fail()
    if (['approve', 'rejectApproval'].includes(action) && (state !== 'awaiting_approval' || !allAccepted || requesterIsViewer)) fail()
  }
  return { id: identifier(v.id), version: version(v.version), proposalHash: hash(v.proposalHash), state, kind, requester, requesterIsViewer, createdAt, expiresAt, reason: text(v.reason, limits.reason), changes: changed, participants, actions: allowed }
}
export function parseOperationsView(v: unknown, memberId: string, from: string, until: string, now = Date.now()): OperationsView {
  return response(() => {
    exact(v, ['asOf', 'timeZone', 'from', 'until', 'canPublish', 'canRequest', 'drafts', 'lessons', 'requests', 'publications'])
    if (v.from !== from || v.until !== until) fail()
    const asOf = timestamp(v.asOf); if (Date.parse(asOf) > now + limits.clockSkewMs) fail()
    const timeZone = text(v.timeZone, 100, true); new Intl.DateTimeFormat('en', { timeZone })
    const canPublish = bool(v.canPublish), canRequest = bool(v.canRequest)
    const drafts = rows(v.drafts, limits.drafts).map(value => { exact(value, ['id', 'version', 'title']); return { id: identifier(value.id), version: version(value.version), title: text(value.title, limits.title, true) } })
    unique(drafts.map(d => d.id)); if (!canPublish && drafts.length) fail()
    const lessons = rows(v.lessons, limits.lessons).map(lesson); unique(lessons.map(l => l.id))
    for (const l of lessons) if (localDate(l.time.startsAt, timeZone) < from || localDate(new Date(Date.parse(l.time.endsAt) - 1).toISOString(), timeZone) >= until || !canRequest && l.canRequest) fail()
    const requests = rows(v.requests, limits.requests).map(value => requestView(value, memberId, asOf)); unique(requests.map(r => r.id))
    const publications = rows(v.publications, limits.publications).map(value => {
      exact(value, ['id', 'version', 'title', 'from', 'until', 'publishedAt'])
      const period = range(value.from, value.until, limits.publishDays)
      if (period.until <= from || period.from >= until) fail()
      return { id: identifier(value.id), version: version(value.version), title: text(value.title, limits.title, true), ...period, publishedAt: timestamp(value.publishedAt) }
    })
    unique(publications.map(p => p.id))
    return { asOf, timeZone, from, until, canPublish, canRequest, drafts, lessons, requests, publications }
  })
}
export function parseOperationsReadiness(v: unknown): OperationsReadiness {
  return response(() => {
    if (v && typeof v === 'object' && 'available' in v && v.available === true) { exact(v, ['available']); return { available: true } }
    exact(v, ['available', 'reason']); if (v.available !== false) fail()
    return { available: false, reason: oneOf(v.reason, ['not_installed', 'not_allowed', 'basis_missing']) }
  })
}
function commandRaw(v: unknown): OperationCommand {
  if (!v || typeof v !== 'object' || !('kind' in v)) fail()
  if ((v as { kind: unknown }).kind === 'action') {
    exact(v, ['kind', 'requestId', 'expectedVersion', 'proposalHash', 'action'])
    return { kind: 'action', requestId: identifier(v.requestId), expectedVersion: version(v.expectedVersion), proposalHash: hash(v.proposalHash), action: oneOf(v.action, actions) }
  }
  exact(v, ['kind', 'preview']); exact(v.preview, ['previewId', 'previewHash', 'expiresAt', 'input'])
  const reference = { previewId: identifier(v.preview.previewId), previewHash: hash(v.preview.previewHash), expiresAt: timestamp(v.preview.expiresAt) }
  if (v.kind === 'publish') return { kind: 'publish', preview: { ...reference, input: publishInputRaw(v.preview.input) } }
  if (v.kind === 'submit') return { kind: 'submit', preview: { ...reference, input: exchangeInputRaw(v.preview.input) } }
  return fail()
}
export const parseOperationCommand = (v: unknown): OperationCommand => input(() => commandRaw(v))
export const publishCommand = (p: PublishPreview): OperationCommand => parseOperationCommand({ kind: 'publish', preview: { previewId: p.previewId, previewHash: p.previewHash, expiresAt: p.expiresAt, input: p.input } })
export const exchangeCommand = (p: ExchangePreview): OperationCommand => parseOperationCommand({ kind: 'submit', preview: { previewId: p.previewId, previewHash: p.previewHash, expiresAt: p.expiresAt, input: p.input } })
export const actionCommand = (r: ExchangeRequestView, action: RequestAction): OperationCommand => {
  if (!r.actions.includes(action)) throw new ServiceError('INVALID_INPUT')
  return parseOperationCommand({ kind: 'action', requestId: r.id, expectedVersion: r.version, proposalHash: r.proposalHash, action })
}
export async function operationCommandHash(command: OperationCommand): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(command)))), b => b.toString(16).padStart(2, '0')).join('')
}

export function parseOperationReceipt(v: unknown, command: OperationCommand, key: string, commandHash: string, now = Date.now(), expectedChanges?: { id: string; version: number }[], expectedStatus?: RequestState): OperationReceipt {
  return response(() => {
    exact(v, ['requestKey', 'commandHash', 'kind', 'entityId', 'version', 'status', 'recordedAt', 'changedLessons'])
    if (v.requestKey !== key || v.commandHash !== commandHash || v.kind !== command.kind) fail()
    const entityId = identifier(v.entityId), receivedVersion = version(v.version), recordedAt = timestamp(v.recordedAt)
    if (Date.parse(recordedAt) > now + limits.clockSkewMs || receivedVersion !== (command.kind === 'action' ? command.expectedVersion + 1 : 1)) fail()
    if (command.kind === 'action' && entityId !== command.requestId) fail()
    const allowed: (RequestState | 'published')[] = command.kind === 'publish' ? ['published'] : command.kind === 'submit' ? ['awaiting_consent', 'awaiting_approval'] :
      command.action === 'accept' ? ['awaiting_consent', 'awaiting_approval'] : command.action === 'withdraw' ? ['withdrawn'] : command.action === 'approve' ? ['applied'] : ['rejected']
    const status = oneOf(v.status, allowed); if (expectedStatus && status !== expectedStatus) fail()
    const changedLessons = rows(v.changedLessons, limits.changes).map(value => { exact(value, ['id', 'version']); return { id: identifier(value.id), version: version(value.version) } })
    unique(changedLessons.map(l => l.id))
    const changesRequired = command.kind === 'publish' || command.kind === 'action' && command.action === 'approve'
    if (changesRequired ? !changedLessons.length : changedLessons.length !== 0) fail()
    if (expectedChanges && !equal([...changedLessons].sort((a, b) => a.id.localeCompare(b.id)), [...expectedChanges].sort((a, b) => a.id.localeCompare(b.id)))) fail()
    return { requestKey: key, commandHash, kind: command.kind, entityId, version: receivedVersion, status, recordedAt, changedLessons }
  })
}

export function createTimetableOperationsServer(connection: SupabaseConnection, options: { timeoutMs?: number; now?: () => number } = {}): TimetableOperationsServer {
  if (options.now !== undefined && typeof options.now !== 'function') throw new ServiceError('INVALID_INPUT')
  const now = () => { const value = options.now ? options.now() : Date.now(); if (!Number.isFinite(value)) throw new ServiceError('INVALID_INPUT'); return value }
  now()
  const rpc = createScopedRpc(connection, TIMETABLE_OPERATIONS_API, { timeoutMs: options.timeoutMs })
  const views = new Map<string, { data: OperationsView; scope: string }>()
  const previews = new Map<string, { scope: string; kind: 'publish' | 'submit'; data: PublishPreview | ExchangePreview }>()
  const generations = new Map<string, number>()
  const originals = new Map<string, { command: OperationCommand; changes: { id: string; version: number }[]; status?: RequestState }>()
  const scope = (memberId: string) => {
    identifier(memberId); const member = connection.info().memberships.find(m => m.id === memberId)
    if (!member) throw new ServiceError('CANCELLED'); return recoveryScope(member)
  }
  const invalidate = (memberId: string) => {
    views.delete(memberId); generations.set(memberId, (generations.get(memberId) ?? 0) + 1)
    for (const key of previews.keys()) if (key.startsWith(memberId + ':')) previews.delete(key)
  }
  const current = (memberId: string) => {
    const row = views.get(memberId); if (!row) throw new ServiceError('NOT_READY')
    if (row.scope !== scope(memberId)) { invalidate(memberId); throw new ServiceError('CANCELLED') }
    return row.data
  }
  const keyFor = (memberId: string, key: string) => scope(memberId) + ':' + key
  const requestKey = (key: unknown) => input(() => { text(key, 200, true); if ((key as string).length < 8) fail(); return key as string })
  const canPublish = (memberId: string, command: PublishInput) => {
    const view = current(memberId)
    if (!view.canPublish) throw new ServiceError('FORBIDDEN')
    if (!view.drafts.some(d => d.id === command.draftId && d.version === command.draftVersion)) throw new ServiceError('CONFLICT')
    return view
  }
  const canExchange = (memberId: string, command: ExchangeInput) => {
    const view = current(memberId), source = view.lessons.find(l => l.id === command.lessonId)
    if (!view.canRequest || !source?.canRequest) throw new ServiceError('FORBIDDEN')
    if (source.version !== command.expectedVersion || source.state !== 'scheduled' || Date.parse(source.time.startsAt) <= now()) throw new ServiceError('CONFLICT')
    if (command.kind === 'move') {
      if (!source.allowedTargets.some(t => equal(t, command.target)) || equal(source.time, command.target) || Date.parse(command.target.startsAt) <= now()) throw new ServiceError('INVALID_INPUT')
    } else {
      const other = view.lessons.find(l => l.id === command.otherLessonId)
      if (!other || other.version !== command.otherExpectedVersion || other.state !== 'scheduled' || Date.parse(other.time.startsAt) <= now()) throw new ServiceError('CONFLICT')
      if (!source.allowedTargets.some(t => equal(t, other.time)) || !other.allowedTargets.some(t => equal(t, source.time)) || equal(source.time, other.time)) throw new ServiceError('INVALID_INPUT')
    }
    return view
  }
  return {
    async readiness(memberId) {
      invalidate(memberId); const generation = generations.get(memberId)
      try {
        const result = await rpc.call(memberId, 'workhub_timetable_operations_readiness', {}, parseOperationsReadiness)
        if (generation !== generations.get(memberId)) throw new ServiceError('CANCELLED')
        if (!result.available) invalidate(memberId)
        return result
      } catch (error) { if (generation === generations.get(memberId)) invalidate(memberId); throw error }
    },
    async get(memberId, from, until) {
      const period = input(() => range(from, until, limits.listDays))
      invalidate(memberId); const generation = generations.get(memberId)
      try {
        const result = await rpc.call(memberId, 'workhub_timetable_operations_get', { p_from: period.from, p_until: period.until }, raw => parseOperationsView(raw, memberId, period.from, period.until, now()))
        if (generation !== generations.get(memberId)) throw new ServiceError('CANCELLED')
        views.set(memberId, { data: structuredClone(result), scope: scope(memberId) }); return result
      } catch (error) { if (generation === generations.get(memberId)) invalidate(memberId); throw error }
    },
    async previewPublish(memberId, value) {
      const command = parsePublishInput(value), view = canPublish(memberId, command), originalScope = scope(memberId), generation = generations.get(memberId)
      let result: PublishPreview
      try { result = await rpc.call(memberId, 'workhub_timetable_operations_publish_preview', { p_input: command }, raw => parsePublishPreview(raw, command, view.timeZone, now())) }
      catch (error) { if (generation === generations.get(memberId)) invalidate(memberId); throw error }
      if (originalScope !== scope(memberId) || generation !== generations.get(memberId)) throw new ServiceError('CANCELLED')
      previews.set(memberId + ':publish:' + result.previewId, { scope: originalScope, kind: 'publish', data: structuredClone(result) }); return result
    },
    async previewExchange(memberId, value) {
      const command = parseExchangeInput(value), view = canExchange(memberId, command), originalScope = scope(memberId), generation = generations.get(memberId)
      let result: ExchangePreview
      try { result = await rpc.call(memberId, 'workhub_timetable_operations_exchange_preview', { p_input: command }, raw => parseExchangePreview(raw, command, view, now())) }
      catch (error) { if (generation === generations.get(memberId)) invalidate(memberId); throw error }
      if (originalScope !== scope(memberId) || generation !== generations.get(memberId)) throw new ServiceError('CANCELLED')
      previews.set(memberId + ':submit:' + result.previewId, { scope: originalScope, kind: 'submit', data: structuredClone(result) }); return result
    },
    async execute(memberId, value, requestedKey) {
      const command = parseOperationCommand(value), key = requestKey(requestedKey), originalScope = scope(memberId), cacheKey = keyFor(memberId, key), generation = generations.get(memberId)
      const original = originals.get(cacheKey)
      if (original && !equal(original.command, command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
      let expectedChanges: { id: string; version: number }[] = [], expectedStatus: RequestState | undefined
      if (command.kind !== 'action') {
        const cached = previews.get(memberId + ':' + command.kind + ':' + command.preview.previewId)
        if (!cached) throw new ServiceError('NOT_READY')
        if (cached.scope !== originalScope) throw new ServiceError('CANCELLED')
        const p = cached.data
        if (!equal(command.preview, { previewId: p.previewId, previewHash: p.previewHash, expiresAt: p.expiresAt, input: p.input }) || Date.parse(p.expiresAt) <= now()) throw new ServiceError('CONFLICT')
        if (p.blockers.length || !p.changes.length) throw new ServiceError('INVALID_INPUT')
        if (command.kind === 'publish') {
          const view = canPublish(memberId, command.preview.input)
          try { parsePublishPreview(p, command.preview.input, view.timeZone, now()) } catch { throw new ServiceError('CONFLICT') }
          expectedChanges = p.changes.map(c => ({ id: c.after.id, version: c.after.version }))
        } else {
          const view = canExchange(memberId, command.preview.input)
          try { parseExchangePreview(p, command.preview.input, view, now()) } catch { throw new ServiceError('CONFLICT') }
          expectedStatus = p.participants.every(t => t.id === memberId) ? 'awaiting_approval' : 'awaiting_consent'
        }
      } else {
        const row = current(memberId).requests.find(r => r.id === command.requestId)
        if (!row || row.version !== command.expectedVersion || row.proposalHash !== command.proposalHash) throw new ServiceError('CONFLICT')
        if (!row.actions.includes(command.action) || Date.parse(row.expiresAt) <= now()) throw new ServiceError('FORBIDDEN')
        if (['approve', 'accept'].includes(command.action) && row.changes.some(c => Date.parse(c.before!.time.startsAt) <= now() || Date.parse(c.after.time.startsAt) <= now())) throw new ServiceError('CONFLICT')
        if (command.action === 'approve') expectedChanges = row.changes.map(c => ({ id: c.after.id, version: c.after.version }))
        expectedStatus = command.action === 'approve' ? 'applied' : command.action === 'withdraw' ? 'withdrawn' : command.action === 'reject' || command.action === 'rejectApproval' ? 'rejected' :
          row.participants.every(p => p.id === memberId || p.response === 'accepted') ? 'awaiting_approval' : 'awaiting_consent'
      }
      originals.set(cacheKey, { command: structuredClone(command), changes: structuredClone(expectedChanges), status: expectedStatus })
      const commandHash = await operationCommandHash(command)
      if (originalScope !== scope(memberId) || generation !== generations.get(memberId)) throw new ServiceError('CANCELLED')
      const receipt = await rpc.call(memberId, 'workhub_timetable_operations_execute', { p_command: command, p_request_key: key, p_recover_only: false }, raw => parseOperationReceipt(raw, command, key, commandHash, now(), expectedChanges, expectedStatus), true)
      invalidate(memberId); return receipt
    },
    async recover(memberId, value, requestedKey) {
      const command = parseOperationCommand(value), key = requestKey(requestedKey), originalScope = scope(memberId), original = originals.get(keyFor(memberId, key))
      if (original && !equal(original.command, command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
      const commandHash = await operationCommandHash(command)
      if (originalScope !== scope(memberId)) throw new ServiceError('CANCELLED')
      // 마감·최신판과 무관하게 원래 명령의 원장 결과만 읽는다. 신규 실행은 절대 금지한다.
      const result = await rpc.call(memberId, 'workhub_timetable_operations_execute', { p_command: command, p_request_key: key, p_recover_only: true }, raw => parseOperationReceipt(raw, command, key, commandHash, now(), original?.changes, original?.status))
      invalidate(memberId); return result
    },
  }
}
