import { canonical, exact, identifier, isoDate, ServiceError, text, validateLocalInput, version } from '../services/scoped-rpc'
import type { OperationLesson, OperationLessonChange, OperationTeacher, RequestAction, RequestState } from './operations-contracts'
import type { InterventionInput, InterventionCommand, InterventionPreview, InterventionReceipt, InterventionRequest, InterventionsView, InterventionCloseResult, InterventionSource, InterventionsReadiness, InterventionsSummary } from './interventions-contracts'
import { INTERVENTIONS_LIMITS } from './interventions-contracts'
import limits from './operations-api-limits.json'

export const interventionLabels = { substitute: '대강', cancel: '휴강', makeup: '보강', reopen: '휴업 취소' } as const
export const interventionActionLabels: Record<RequestAction, string> = { accept: '수락', reject: '반려', withdraw: '철회', approve: '최종 승인', rejectApproval: '승인 반려' }
export const interventionStateLabels: Record<RequestState, string> = { awaiting_consent: '교사 동의 대기', awaiting_approval: '담당자 승인 대기', applied: '반영 완료', rejected: '반려', withdrawn: '철회', expired: '기한 만료', stale: '수업 변경으로 재확인 필요' }
function fail(): never { throw new ServiceError('INVALID_RESPONSE') }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const rows = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail()
const unique = <T>(v: T[]): T[] => new Set(v).size === v.length ? v : fail()
const choice = <T extends string>(v: unknown, allowed: readonly T[]): T => allowed.includes(v as T) ? v as T : fail()
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail()
const count = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail()
const hash = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail()
const stateValues: RequestState[] = ['awaiting_consent', 'awaiting_approval', 'applied', 'rejected', 'withdrawn', 'expired', 'stale']
const actionValues: RequestAction[] = ['accept', 'reject', 'withdraw', 'approve', 'rejectApproval']
const activeStates = ['awaiting_consent', 'awaiting_approval']
function response<T>(read: () => T): T { try { return read() } catch { return fail() } }
export function interventionTimestamp(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail()
  return v
}
function time(v: unknown) {
  exact(v, ['startsAt', 'endsAt'])
  const startsAt = interventionTimestamp(v.startsAt), endsAt = interventionTimestamp(v.endsAt)
  if (!startsAt.endsWith('.000Z') || !endsAt.endsWith('.000Z') || startsAt >= endsAt || Date.parse(endsAt) - Date.parse(startsAt) > limits.lessonMinutes * 60000) fail()
  return { startsAt, endsAt }
}
function teacher(v: unknown): OperationTeacher { exact(v, ['id', 'name']); return { id: identifier(v.id), name: text(v.name, limits.title, true) } }
function teachers(v: unknown) { const list = rows(v, limits.teachers).map(teacher); unique(list.map(row => row.id)); return list }
export function parseInterventionLesson(v: unknown): OperationLesson {
  return response(() => {
    exact(v, ['id', 'version', 'label', 'time', 'teachers', 'groupNames', 'roomNames', 'state', 'canRequest', 'allowedTargets'])
    const names = (value: unknown) => rows(value, limits.namesPerLesson).map(item => text(item, limits.title, true))
    const value: OperationLesson = { id: identifier(v.id), version: version(v.version), label: text(v.label, limits.title, true), time: time(v.time), teachers: teachers(v.teachers), groupNames: names(v.groupNames), roomNames: names(v.roomNames), state: choice(v.state, ['scheduled', 'performed', 'cancelled']), canRequest: bool(v.canRequest), allowedTargets: rows(v.allowedTargets, limits.targets).map(time) }
    if (!value.teachers.length || !value.groupNames.length || value.canRequest && value.state !== 'scheduled') fail()
    unique(value.allowedTargets.map(canonical)); return value
  })
}
export function interventionInput(raw: unknown): InterventionInput {
  return validateLocalInput(() => {
    if (!raw || typeof raw !== 'object' || !('kind' in raw)) fail()
    const value = raw as Record<string, unknown>
    const kind = choice(value.kind, ['substitute', 'cancel', 'makeup', 'reopen'])
    if (kind === 'reopen') { exact(value, ['kind', 'schoolDayChangeId', 'reason']); return { kind, schoolDayChangeId: identifier(value.schoolDayChangeId), reason: text(value.reason, limits.reason, true) } }
    exact(value, ['kind', 'lessonId', 'expectedVersion', 'reason', ...(kind === 'substitute' ? ['substituteTeacherId'] : kind === 'makeup' ? ['target'] : [])])
    const base = { lessonId: identifier(value.lessonId), expectedVersion: version(value.expectedVersion), reason: text(value.reason, limits.reason, true) }
    if (kind === 'substitute') return { kind, ...base, substituteTeacherId: identifier(value.substituteTeacherId) }
    if (kind === 'makeup') return { kind, ...base, target: time(value.target) }
    return { kind, ...base }
  })
}
function changes(raw: unknown): OperationLessonChange[] {
  const list = rows(raw, INTERVENTIONS_LIMITS.reopenedLessons).map(v => {
    exact(v, ['before', 'after'])
    const before = v.before === null ? null : parseInterventionLesson(v.before), after = parseInterventionLesson(v.after)
    if (before ? before.id !== after.id || before.version + 1 !== after.version || before.state === 'performed' : after.version !== 1) fail()
    if (after.state === 'performed') fail()
    return { before, after }
  })
  unique(list.map(row => row.after.id)); return list
}
function lessonIdentity(v: OperationLesson) { return { label: v.label, groupNames: v.groupNames, roomNames: v.roomNames } }
function lessonSnapshot(v: OperationLesson) { const { canRequest: _canRequest, allowedTargets: _targets, ...snapshot } = v; return snapshot }
function checkMeaning(input: InterventionInput, list: OperationLessonChange[], source?: InterventionsView) {
  if (!list.length) return
  if (input.kind !== 'reopen' && list.length !== 1) fail()
  for (const { before, after } of list) {
    if (before && !same(lessonIdentity(before), lessonIdentity(after))) fail()
    if (input.kind === 'makeup') {
      if (before || after.id === input.lessonId || after.state !== 'scheduled' || !same(after.time, input.target)) fail()
      const original = source?.lessons.find(row => row.id === input.lessonId)
      if (source && (!original || original.state !== 'cancelled' || original.version !== input.expectedVersion || !same(lessonIdentity(original), lessonIdentity(after)) || !same(original.teachers, after.teachers) || seconds(original) !== seconds(after))) fail()
    } else {
      if (!before) fail()
      if (input.kind !== 'reopen' && (before.id !== input.lessonId || before.version !== input.expectedVersion)) fail()
      if (!same(before.time, after.time)) fail()
      if (input.kind === 'substitute' && (before.state !== 'scheduled' || after.state !== 'scheduled' || after.teachers.length !== 1 || after.teachers[0].id !== input.substituteTeacherId || same(before.teachers, after.teachers))) fail()
      if (input.kind === 'cancel' && (before.state !== 'scheduled' || after.state !== 'cancelled' || !same(before.teachers, after.teachers))) fail()
      if (input.kind === 'reopen' && (before.state !== 'cancelled' || after.state !== 'scheduled' || !same(before.teachers, after.teachers))) fail()
      if (source) {
        const original = source.lessons.find(row => row.id === before.id)
        if (!original || !same(lessonSnapshot(original), lessonSnapshot(before))) fail()
      }
    }
  }
  if (source && input.kind === 'reopen') {
    const closure = source.closures.find(row => row.id === input.schoolDayChangeId)
    if (!closure || closure.reopened || !same([...closure.lessonIds].sort(), list.map(row => row.after.id).sort())) fail()
  }
}
const seconds = (lesson: OperationLesson) => (Date.parse(lesson.time.endsAt) - Date.parse(lesson.time.startsAt)) / 1000
function participantSet(changed: OperationLessonChange[]) {
  const found = new Map<string, OperationTeacher>()
  for (const row of changed) for (const item of [...(row.before?.teachers ?? []), ...row.after.teachers]) {
    if (found.has(item.id) && found.get(item.id)!.name !== item.name) fail()
    found.set(item.id, item)
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'))
}
function sameParticipants(actual: OperationTeacher[], changed: OperationLessonChange[]) {
  if (!same([...actual].sort((a, b) => a.id.localeCompare(b.id, 'en')), participantSet(changed))) fail()
}
export function parseInterventionPreview(raw: unknown, input: InterventionInput, source: InterventionsView, now = Date.now()): InterventionPreview {
  return response(() => {
    exact(raw, ['previewId', 'previewHash', 'createdAt', 'expiresAt', 'input', 'complete', 'changes', 'participants', 'blockers', 'hours'])
    if (!same(interventionInput(raw.input), input) || raw.complete !== true) fail()
    const createdAt = interventionTimestamp(raw.createdAt), expiresAt = interventionTimestamp(raw.expiresAt)
    if (Date.parse(createdAt) > now + limits.clockSkewMs || Date.parse(expiresAt) <= now || createdAt >= expiresAt || Date.parse(expiresAt) - Date.parse(createdAt) > limits.previewLifetimeMs) fail()
    const changed = changes(raw.changes), participants = teachers(raw.participants)
    checkMeaning(input, changed, source); sameParticipants(participants, changed)
    const blockers = rows(raw.blockers, limits.blockers).map(value => {
      exact(value, ['code', 'message', 'lessonIds'])
      if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)) fail()
      return { code: value.code, message: text(value.message, limits.message, true), lessonIds: unique(rows(value.lessonIds, INTERVENTIONS_LIMITS.reopenedLessons).map(identifier)) }
    })
    if (!changed.length && !blockers.length) fail()
    exact(raw.hours, ['removedSeconds', 'addedSeconds'])
    const hours = { removedSeconds: count(raw.hours.removedSeconds), addedSeconds: count(raw.hours.addedSeconds) }
    const expected = {
      removedSeconds: changed.reduce((n, row) => n + (row.before?.state === 'scheduled' && row.after.state === 'cancelled' ? seconds(row.before) : 0), 0),
      addedSeconds: changed.reduce((n, row) => n + ((!row.before || row.before.state === 'cancelled') && row.after.state === 'scheduled' ? seconds(row.after) : 0), 0),
    }
    if (!same(hours, expected)) fail()
    return { previewId: identifier(raw.previewId), previewHash: hash(raw.previewHash), createdAt, expiresAt, input, complete: true, changes: changed, participants, blockers, hours }
  })
}
function request(raw: unknown, memberId: string, asOf: string): InterventionRequest {
  exact(raw, ['id', 'version', 'proposalHash', 'state', 'kind', 'input', 'requester', 'requesterIsViewer', 'createdAt', 'expiresAt', 'reason', 'changes', 'participants', 'actions'])
  const input = interventionInput(raw.input), state = choice(raw.state, stateValues), changed = changes(raw.changes)
  if (raw.kind !== input.kind || raw.reason !== input.reason || !changed.length) fail()
  checkMeaning(input, changed)
  const createdAt = interventionTimestamp(raw.createdAt), expiresAt = interventionTimestamp(raw.expiresAt)
  if (createdAt > asOf || createdAt >= expiresAt || activeStates.includes(state) && expiresAt <= asOf || state === 'expired' && expiresAt > asOf) fail()
  const requester = teacher(raw.requester), requesterIsViewer = bool(raw.requesterIsViewer)
  if (requesterIsViewer !== (requester.id === memberId)) fail()
  const participants = rows(raw.participants, limits.teachers).map(value => {
    exact(value, ['id', 'name', 'response', 'respondedAt'])
    const row = { ...teacher({ id: value.id, name: value.name }), response: choice(value.response, ['pending', 'accepted', 'rejected']), respondedAt: value.respondedAt === null ? null : interventionTimestamp(value.respondedAt) }
    if ((row.response === 'pending') !== (row.respondedAt === null) || row.respondedAt && (row.respondedAt < createdAt || row.respondedAt > asOf || row.respondedAt >= expiresAt)) fail()
    return row
  })
  unique(participants.map(row => row.id)); sameParticipants(participants.map(({ id, name }) => ({ id, name })), changed)
  const all = participants.length > 0 && participants.every(row => row.response === 'accepted')
  if (['applied', 'awaiting_approval'].includes(state) && !all || state === 'awaiting_consent' && (all || participants.some(row => row.response === 'rejected'))) fail()
  const actions = unique(rows(raw.actions, actionValues.length).map(value => choice(value, actionValues)))
  for (const action of actions) {
    if (!activeStates.includes(state)) fail()
    if (['accept', 'reject'].includes(action) && (state !== 'awaiting_consent' || !participants.some(row => row.id === memberId && row.response === 'pending'))) fail()
    if (action === 'withdraw' && !requesterIsViewer) fail()
    if (['approve', 'rejectApproval'].includes(action) && (state !== 'awaiting_approval' || !all || requesterIsViewer || participants.some(row => row.id === memberId))) fail()
  }
  return { id: identifier(raw.id), version: version(raw.version), proposalHash: hash(raw.proposalHash), state, kind: input.kind, input, requester, requesterIsViewer, createdAt, expiresAt, reason: input.reason, changes: changed, participants, actions }
}
export function interventionRange(from: unknown, until: unknown) {
  return validateLocalInput(() => {
    const first = isoDate(from), last = isoDate(until), days = (Date.parse(last) - Date.parse(first)) / 86400000
    if (days < 1 || days > limits.listDays) fail()
    return { from: first, until: last }
  })
}
export function parseInterventionsView(raw: unknown, memberId: string, from: string, until: string, now = Date.now()): InterventionsView {
  return response(() => {
    exact(raw, ['asOf', 'timeZone', 'from', 'until', 'lessons', 'teachers', 'closures', 'requests'])
    if (raw.from !== from || raw.until !== until) fail()
    const asOf = interventionTimestamp(raw.asOf), timeZone = text(raw.timeZone, 100, true)
    if (Date.parse(asOf) > now + limits.clockSkewMs) fail()
    new Intl.DateTimeFormat('en', { timeZone })
    const lessons = rows(raw.lessons, limits.lessons).map(parseInterventionLesson), people = teachers(raw.teachers)
    unique(lessons.map(row => row.id))
    const closures = rows(raw.closures, limits.changes).map(value => {
      exact(value, ['id', 'date', 'reason', 'lessonIds', 'reopened'])
      const day = isoDate(value.date), lessonIds = unique(rows(value.lessonIds, INTERVENTIONS_LIMITS.reopenedLessons).map(identifier))
      if (day < from || day >= until || !lessonIds.length) fail()
      return { id: identifier(value.id), date: day, reason: text(value.reason, limits.reason, true), lessonIds, reopened: bool(value.reopened) }
    })
    unique(closures.map(row => row.id))
    const requests = rows(raw.requests, limits.requests).map(value => request(value, memberId, asOf))
    unique(requests.map(row => row.id))
    return { asOf, timeZone, from, until, lessons, teachers: people, closures, requests }
  })
}
export function interventionCommand(raw: unknown): InterventionCommand {
  return validateLocalInput(() => {
    if (!raw || typeof raw !== 'object' || !('kind' in raw)) fail()
    const value = raw as Record<string, unknown>
    if (value.kind === 'action') {
      exact(value, ['kind', 'requestId', 'expectedVersion', 'proposalHash', 'action'])
      return { kind: 'action', requestId: identifier(value.requestId), expectedVersion: version(value.expectedVersion), proposalHash: hash(value.proposalHash), action: choice(value.action, actionValues) }
    }
    exact(value, ['kind', 'preview']); if (value.kind !== 'submit') fail()
    exact(value.preview, ['previewId', 'previewHash', 'expiresAt', 'input'])
    return { kind: 'submit', preview: { previewId: identifier(value.preview.previewId), previewHash: hash(value.preview.previewHash), expiresAt: interventionTimestamp(value.preview.expiresAt), input: interventionInput(value.preview.input) } }
  })
}
export const interventionSubmit = (preview: InterventionPreview) => interventionCommand({ kind: 'submit', preview: { previewId: preview.previewId, previewHash: preview.previewHash, expiresAt: preview.expiresAt, input: preview.input } })
export function interventionAction(row: InterventionRequest, action: RequestAction) {
  if (!row.actions.includes(action)) throw new ServiceError('INVALID_INPUT')
  return interventionCommand({ kind: 'action', requestId: row.id, expectedVersion: row.version, proposalHash: row.proposalHash, action })
}
export async function interventionHash(value: unknown): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('') }
export function parseInterventionReceipt(raw: unknown, command: InterventionCommand, key: string, digest: string, now = Date.now()): InterventionReceipt {
  return response(() => {
    exact(raw, ['requestKey', 'commandHash', 'kind', 'entityId', 'version', 'status', 'recordedAt', 'changedLessons'])
    const status = choice(raw.status, stateValues), savedVersion = version(raw.version), recordedAt = interventionTimestamp(raw.recordedAt)
    if (raw.requestKey !== key || raw.commandHash !== digest || raw.kind !== command.kind || Date.parse(recordedAt) > now + limits.clockSkewMs) fail()
    if (command.kind === 'submit' && (savedVersion !== 1 || !activeStates.includes(status))) fail()
    if (command.kind === 'action') {
      const expected: Record<RequestAction, RequestState[]> = { accept: ['awaiting_consent', 'awaiting_approval'], reject: ['rejected'], withdraw: ['withdrawn'], approve: ['applied', 'stale', 'expired'], rejectApproval: ['rejected'] }
      if (raw.entityId !== command.requestId || savedVersion !== command.expectedVersion + 1 || !expected[command.action].includes(status)) fail()
    }
    const changedLessons = rows(raw.changedLessons, INTERVENTIONS_LIMITS.reopenedLessons).map(value => { exact(value, ['id', 'version']); return { id: identifier(value.id), version: version(value.version) } })
    unique(changedLessons.map(row => row.id))
    if ((status === 'applied') !== !!changedLessons.length) fail()
    return { requestKey: key, commandHash: digest, kind: command.kind, entityId: identifier(raw.entityId), version: savedVersion, status, recordedAt, changedLessons }
  })
}
export function parseInterventionClose(raw: unknown, command: InterventionCommand, key: string, digest: string, now = Date.now()): InterventionCloseResult {
  return response(() => {
    exact(raw, ['requestKey', 'commandHash', 'outcome', 'receipt', 'decidedAt'])
    const decidedAt = interventionTimestamp(raw.decidedAt)
    if (raw.requestKey !== key || raw.commandHash !== digest || Date.parse(decidedAt) > now + limits.clockSkewMs) fail()
    if (raw.outcome === 'closed') { if (raw.receipt !== null) fail(); return { requestKey: key, commandHash: digest, decidedAt, outcome: 'closed', receipt: null } }
    if (raw.outcome !== 'applied') fail()
    const receipt = parseInterventionReceipt(raw.receipt, command, key, digest, now)
    if (receipt.recordedAt > decidedAt) fail()
    return { requestKey: key, commandHash: digest, decidedAt, outcome: 'applied', receipt }
  })
}
export function parseInterventionsReadiness(raw: unknown): InterventionsReadiness {
  return response(() => { exact(raw, ['available', 'reason']); if (raw.available === true) { if (raw.reason !== null) fail(); return { available: true, reason: null } } if (raw.available !== false) fail(); return { available: false, reason: choice(raw.reason, ['not_configured', 'not_allowed', 'approvers_missing']) } })
}
export function parseInterventionSource(raw: unknown): InterventionSource {
  return response(() => {
    exact(raw, ['kind', 'requestId', 'schoolDayChangeId', 'date', 'lessonId'])
    const kind = choice(raw.kind, ['intervention', 'exchange', 'school_day']), requestId = raw.requestId === null ? null : identifier(raw.requestId), schoolDayChangeId = raw.schoolDayChangeId === null ? null : identifier(raw.schoolDayChangeId)
    if (kind === 'school_day' ? requestId !== null || schoolDayChangeId === null : requestId === null || schoolDayChangeId !== null) fail()
    return { kind, requestId, schoolDayChangeId, date: isoDate(raw.date), lessonId: raw.lessonId === null ? null : identifier(raw.lessonId) }
  })
}
export function parseInterventionsSummary(raw: unknown, now = Date.now()): InterventionsSummary {
  return response(() => {
    exact(raw, ['asOf', 'pendingConsent', 'pendingApproval', 'makeupNeeded', 'items'])
    const asOf = interventionTimestamp(raw.asOf)
    if (Date.parse(asOf) > now + limits.clockSkewMs) fail()
    const pendingConsent = count(raw.pendingConsent), pendingApproval = count(raw.pendingApproval), makeupNeeded = count(raw.makeupNeeded)
    const items = rows(raw.items, INTERVENTIONS_LIMITS.summaryItems).map(value => {
      exact(value, ['id', 'kind', 'label', 'date', 'lessonId', 'requestId'])
      const kind = choice(value.kind, ['consent', 'approval', 'makeup']), lessonId = value.lessonId === null ? null : identifier(value.lessonId), requestId = value.requestId === null ? null : identifier(value.requestId)
      if (kind === 'makeup' ? !lessonId || requestId !== null : !requestId) fail()
      return { id: identifier(value.id), kind, label: text(value.label, limits.title, true), date: isoDate(value.date), lessonId, requestId }
    })
    unique(items.map(row => row.id))
    for (const [kind, total] of [['consent', pendingConsent], ['approval', pendingApproval], ['makeup', makeupNeeded]] as const) if (items.filter(row => row.kind === kind).length > total) fail()
    return { asOf, pendingConsent, pendingApproval, makeupNeeded, items }
  })
}
