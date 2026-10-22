import { invalidPilot, pilotDate, pilotExact, pilotHash, pilotId, pilotInteger, pilotLabel, pilotRows, pilotUnique } from './fixture'

// 회원 ID는 인증 증명이 아니다. 서버 조회 또는 관리자가 확인한 CSV의 연결 후보를 명시 선택한다.
export interface RegisteredTeacherCandidate { id: string; schoolId: string; label: string; active: boolean }
export interface RegisteredTeacherDirectory {
  schema: 'timetable.pilot.directory.v1'; schoolId: string; revision: number
  source: 'server' | 'administrator-csv'; teachers: RegisteredTeacherCandidate[]; fingerprint: string
}
export interface PilotTeacherBinding {
  roleId: string; kind: 'virtual' | 'registered-reference'; candidateId: string | null; label: string
}
export interface RosterReplacementInput {
  expectedVersion: number; sourceFingerprint: string; effectiveFrom: string; requestKey: string
  assignments: { roleId: string; candidateId: string | null }[]
}
export interface PilotRosterRevision {
  version: number; effectiveFrom: string; bindings: PilotTeacherBinding[]; sourceFingerprint: string
  request: RosterReplacementInput | RosterRebaseInput | null; commandFingerprint: string | null
}
export interface RosterRebaseInput {
  kind: 'basis-rebase'; previousSourceFingerprint: string; sourceFingerprint: string
  effectiveFrom: string; expectedVersion: number; requestKey: string
}
export interface PilotRoster {
  schema: 'timetable.pilot.roster.v1'; schoolId: string; fixtureId: string; version: number
  revisions: PilotRosterRevision[]
}
export interface RosterReplacementPreview {
  schema: 'timetable.pilot.roster-preview.v1'; schoolId: string; fixtureId: string; input: RosterReplacementInput
  directoryRevision: number; directoryFingerprint: string; rosterFingerprint: string
  changes: { roleId: string; before: PilotTeacherBinding; after: PilotTeacherBinding }[]
  affectedWeeklyLessons: number; previewFingerprint: string
}
export function registeredTeacherCandidate(value: unknown): RegisteredTeacherCandidate {
  const item = pilotExact(value, ['id', 'schoolId', 'label', 'active'])
  if (typeof item.active !== 'boolean') return invalidPilot()
  return { id: pilotId(item.id), schoolId: pilotId(item.schoolId), label: pilotLabel(item.label), active: item.active }
}
export function registeredTeacherDirectory(value: unknown): RegisteredTeacherDirectory {
  const row = pilotExact(value, ['schema', 'schoolId', 'revision', 'source', 'teachers', 'fingerprint'])
  if (row.schema !== 'timetable.pilot.directory.v1' || row.source !== 'server' && row.source !== 'administrator-csv') return invalidPilot()
  const schoolId = pilotId(row.schoolId)
  const teachers = pilotUnique(pilotRows(row.teachers, registeredTeacherCandidate, 500), teacher => teacher.id)
  if (teachers.some(teacher => teacher.schoolId !== schoolId)) return invalidPilot('SCHOOL_MISMATCH')
  return { schema: 'timetable.pilot.directory.v1', schoolId, revision: pilotInteger(row.revision), source: row.source, teachers, fingerprint: pilotHash(row.fingerprint) }
}
export function teacherBinding(value: unknown): PilotTeacherBinding {
  const row = pilotExact(value, ['roleId', 'kind', 'candidateId', 'label'])
  if (row.kind !== 'virtual' && row.kind !== 'registered-reference') return invalidPilot()
  if (row.kind === 'virtual' ? row.candidateId !== null : row.candidateId === null) return invalidPilot()
  return { roleId: pilotId(row.roleId), kind: row.kind, candidateId: row.candidateId === null ? null : pilotId(row.candidateId), label: pilotLabel(row.label) }
}
export function rosterReplacementInput(value: unknown): RosterReplacementInput {
  const row = pilotExact(value, ['expectedVersion', 'sourceFingerprint', 'effectiveFrom', 'requestKey', 'assignments'])
  const assignments = pilotUnique(pilotRows(row.assignments, value => {
    const item = pilotExact(value, ['roleId', 'candidateId'])
    return { roleId: pilotId(item.roleId), candidateId: item.candidateId === null ? null : pilotId(item.candidateId) }
  }, 500), item => item.roleId).sort((a, b) => a.roleId.localeCompare(b.roleId, 'en'))
  if (!assignments.length) return invalidPilot()
  return { expectedVersion: pilotInteger(row.expectedVersion), sourceFingerprint: pilotHash(row.sourceFingerprint), effectiveFrom: pilotDate(row.effectiveFrom), requestKey: pilotId(row.requestKey), assignments }
}
function rosterRevisionRequest(value: unknown): RosterReplacementInput | RosterRebaseInput {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'kind')) {
    const row = pilotExact(value, ['kind', 'previousSourceFingerprint', 'sourceFingerprint', 'effectiveFrom', 'expectedVersion', 'requestKey'])
    if (row.kind !== 'basis-rebase') return invalidPilot()
    return { kind: 'basis-rebase', previousSourceFingerprint: pilotHash(row.previousSourceFingerprint), sourceFingerprint: pilotHash(row.sourceFingerprint), effectiveFrom: pilotDate(row.effectiveFrom), expectedVersion: pilotInteger(row.expectedVersion), requestKey: pilotId(row.requestKey) }
  }
  return rosterReplacementInput(value)
}
export function parsePilotRoster(value: unknown): PilotRoster {
  const row = pilotExact(value, ['schema', 'schoolId', 'fixtureId', 'version', 'revisions'])
  if (row.schema !== 'timetable.pilot.roster.v1') return invalidPilot()
  const revisions = pilotRows(row.revisions, value => {
    const item = pilotExact(value, ['version', 'effectiveFrom', 'bindings', 'sourceFingerprint', 'request', 'commandFingerprint'])
    const bindings = pilotUnique(pilotRows(item.bindings, teacherBinding, 500), binding => binding.roleId)
    const request = item.request === null ? null : rosterRevisionRequest(item.request)
    const commandFingerprint = item.commandFingerprint === null ? null : pilotHash(item.commandFingerprint)
    if ((request === null) !== (commandFingerprint === null) || !bindings.length) return invalidPilot()
    return { version: pilotInteger(item.version), effectiveFrom: pilotDate(item.effectiveFrom), bindings, sourceFingerprint: pilotHash(item.sourceFingerprint), request, commandFingerprint }
  }, 1000)
  const version = pilotInteger(row.version)
  if (!revisions.length || version !== revisions.length || revisions.some((item, index) => item.version !== index + 1 || index === 0 && item.request !== null || index > 0 && (!item.request || item.effectiveFrom < revisions[index - 1].effectiveFrom || item.request.effectiveFrom !== item.effectiveFrom || item.request.expectedVersion !== index || item.request.sourceFingerprint !== item.sourceFingerprint))) return invalidPilot()
  pilotUnique(revisions.filter(item => item.request), item => item.request!.requestKey)
  return { schema: 'timetable.pilot.roster.v1', schoolId: pilotId(row.schoolId), fixtureId: pilotId(row.fixtureId), version, revisions }
}
export function parseRosterReplacementPreview(value: unknown): RosterReplacementPreview {
  const row = pilotExact(value, ['schema', 'schoolId', 'fixtureId', 'input', 'directoryRevision', 'directoryFingerprint', 'rosterFingerprint', 'changes', 'affectedWeeklyLessons', 'previewFingerprint'])
  if (row.schema !== 'timetable.pilot.roster-preview.v1') return invalidPilot()
  const changes = pilotUnique(pilotRows(row.changes, value => {
    const change = pilotExact(value, ['roleId', 'before', 'after']), roleId = pilotId(change.roleId), before = teacherBinding(change.before), after = teacherBinding(change.after)
    if (before.roleId !== roleId || after.roleId !== roleId) return invalidPilot()
    return { roleId, before, after }
  }, 500), change => change.roleId)
  return { schema: 'timetable.pilot.roster-preview.v1', schoolId: pilotId(row.schoolId), fixtureId: pilotId(row.fixtureId), input: rosterReplacementInput(row.input), directoryRevision: pilotInteger(row.directoryRevision), directoryFingerprint: pilotHash(row.directoryFingerprint), rosterFingerprint: pilotHash(row.rosterFingerprint), changes, affectedWeeklyLessons: pilotInteger(row.affectedWeeklyLessons, 0), previewFingerprint: pilotHash(row.previewFingerprint) }
}
