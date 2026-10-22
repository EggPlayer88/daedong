import { fingerprintPilotFixture, invalidPilot, pilotCanonical, pilotDate, pilotDigest, pilotInteger, pilotUnique, validatePilotFixture, type PilotFixture } from './fixture'
import { parsePilotRoster, parseRosterReplacementPreview, registeredTeacherCandidate, registeredTeacherDirectory, rosterReplacementInput, type PilotRoster, type PilotTeacherBinding, type RegisteredTeacherCandidate, type RegisteredTeacherDirectory, type RosterReplacementInput, type RosterReplacementPreview, type RosterRebaseInput } from './roster-contracts'
export type * from './roster-contracts'
export { parsePilotRoster, parseRosterReplacementPreview, registeredTeacherDirectory, rosterReplacementInput } from './roster-contracts'

const directoryContent = (directory: Omit<RegisteredTeacherDirectory, 'fingerprint'>) => ({
  schema: directory.schema, schoolId: directory.schoolId, revision: directory.revision, source: directory.source,
  teachers: [...directory.teachers].sort((a, b) => a.id.localeCompare(b.id, 'en')),
})
export async function createRegisteredTeacherDirectory(schoolId: string, revision: number, teachers: RegisteredTeacherCandidate[], source: RegisteredTeacherDirectory['source'] = 'server'): Promise<RegisteredTeacherDirectory> {
  const content = directoryContent({ schema: 'timetable.pilot.directory.v1', schoolId, revision, source, teachers })
  return registeredTeacherDirectory({ ...content, fingerprint: await pilotDigest(content) })
}
async function checkedDirectory(value: unknown, schoolId: string): Promise<RegisteredTeacherDirectory> {
  const directory = registeredTeacherDirectory(value)
  if (directory.schoolId !== schoolId) return invalidPilot('SCHOOL_MISMATCH')
  if (await pilotDigest(directoryContent(directory)) !== directory.fingerprint) return invalidPilot('SOURCE_CHANGED')
  return directory
}
export async function createPilotRoster(value: unknown): Promise<PilotRoster> {
  const fixture = validatePilotFixture(value), sourceFingerprint = await fingerprintPilotFixture(fixture)
  return { schema: 'timetable.pilot.roster.v1', schoolId: fixture.schoolId, fixtureId: fixture.id, version: 1, revisions: [{ version: 1, effectiveFrom: fixture.dateRange.startsOn, sourceFingerprint, bindings: fixture.teachers.map(teacher => ({ roleId: teacher.id, kind: 'virtual', candidateId: null, label: teacher.label })), request: null, commandFingerprint: null }] }
}
async function checkedRoster(fixture: PilotFixture, value: unknown): Promise<PilotRoster> {
  const roster = parsePilotRoster(value)
  if (roster.schoolId !== fixture.schoolId || roster.fixtureId !== fixture.id) return invalidPilot('SCHOOL_MISMATCH')
  const fingerprint = await fingerprintPilotFixture(fixture), roles = fixture.teachers.map(teacher => teacher.id).sort()
  if (roster.revisions.at(-1)!.sourceFingerprint !== fingerprint) return invalidPilot('SOURCE_CHANGED')
  for (const [index, revision] of roster.revisions.entries()) {
    if (revision.effectiveFrom < fixture.dateRange.startsOn || revision.effectiveFrom > fixture.dateRange.endsOn || pilotCanonical(revision.bindings.map(binding => binding.roleId).sort()) !== pilotCanonical(roles)) return invalidPilot()
    if (revision.request && await pilotDigest(revision.request) !== revision.commandFingerprint) return invalidPilot('REQUEST_CHANGED')
    const virtuals = new Map(fixture.teachers.map(teacher => [teacher.id, teacher.label]))
    if (revision.bindings.some(binding => binding.kind === 'virtual' && binding.label !== virtuals.get(binding.roleId))) return invalidPilot()
    if (index === 0 && revision.bindings.some(binding => binding.kind !== 'virtual')) return invalidPilot('HISTORY_CHANGED')
    if (index > 0) {
      const previous = roster.revisions[index - 1], request = revision.request!
      if ('kind' in request) {
        if (request.previousSourceFingerprint !== previous.sourceFingerprint || pilotCanonical(revision.bindings) !== pilotCanonical(previous.bindings)) return invalidPilot('HISTORY_CHANGED')
      } else {
        if (revision.sourceFingerprint !== previous.sourceFingerprint) return invalidPilot('SOURCE_CHANGED')
        const assignments = new Map(request.assignments.map(assignment => [assignment.roleId, assignment.candidateId]))
        if (request.assignments.some(assignment => !roles.includes(assignment.roleId))) return invalidPilot()
        for (const binding of revision.bindings) {
          const old = previous.bindings.find(old => old.roleId === binding.roleId)!
          if (assignments.has(binding.roleId)) {
            const expected = assignments.get(binding.roleId)
            if (binding.candidateId !== expected || binding.kind !== (expected === null ? 'virtual' : 'registered-reference')) return invalidPilot('HISTORY_CHANGED')
          } else if (pilotCanonical(binding) !== pilotCanonical(old)) return invalidPilot('HISTORY_CHANGED')
        }
      }
    }
  }
  assertNoTeacherConflict(fixture, roster.revisions.at(-1)!.bindings)
  return roster
}
// 과거 판을 바꾸지 않고 수업 날짜에 유효한 연결만 선택한다.
export function rosterBindingsOn(value: unknown, date: string): PilotTeacherBinding[] {
  const roster = parsePilotRoster(value), day = pilotDate(date)
  const revision = [...roster.revisions].reverse().find(revision => revision.effectiveFrom <= day)
  if (!revision) return invalidPilot('DATE_OUTSIDE_ROSTER')
  return structuredClone(revision.bindings)
}
function assertNoTeacherConflict(fixture: PilotFixture, bindings: PilotTeacherBinding[]): void {
  const mapping = new Map(bindings.map(binding => [binding.roleId, binding.candidateId === null ? `virtual:${binding.roleId}` : `member:${binding.candidateId}`]))
  const occupied = new Set<string>()
  for (const lesson of fixture.lessons) {
    const identity = mapping.get(lesson.teacherId)
    if (!identity) return invalidPilot()
    const key = `${lesson.weekday}:${lesson.period}:${identity}`
    if (occupied.has(key)) return invalidPilot('TEACHER_TIME_CONFLICT')
    occupied.add(key)
  }
}
function replacements(fixture: PilotFixture, roster: PilotRoster, directory: RegisteredTeacherDirectory, input: RosterReplacementInput): { bindings: PilotTeacherBinding[]; changes: RosterReplacementPreview['changes'] } {
  const candidates = new Map(directory.teachers.map(teacher => [teacher.id, teacher])), roles = new Map(fixture.teachers.map(teacher => [teacher.id, teacher]))
  const bindings = structuredClone(roster.revisions.at(-1)!.bindings), changes: RosterReplacementPreview['changes'] = []
  for (const assignment of input.assignments) {
    const role = roles.get(assignment.roleId), index = bindings.findIndex(binding => binding.roleId === assignment.roleId)
    if (!role || index < 0) return invalidPilot('UNKNOWN_TEACHER_ROLE')
    const candidate = assignment.candidateId === null ? null : candidates.get(assignment.candidateId)
    if (assignment.candidateId !== null && !candidate) return invalidPilot('UNKNOWN_REGISTERED_TEACHER')
    if (candidate && (!candidate.active || candidate.schoolId !== fixture.schoolId)) return invalidPilot(candidate.active ? 'SCHOOL_MISMATCH' : 'INACTIVE_TEACHER')
    const after: PilotTeacherBinding = candidate ? { roleId: role.id, kind: 'registered-reference', candidateId: candidate.id, label: candidate.label } : { roleId: role.id, kind: 'virtual', candidateId: null, label: role.label }
    if (pilotCanonical(bindings[index]) !== pilotCanonical(after)) changes.push({ roleId: role.id, before: bindings[index], after })
    bindings[index] = after
  }
  // 이번에 바꾸지 않은 연결도 후보가 정지·삭제되었으면 새 판 확정 전에 재확인한다.
  for (const binding of bindings) if (binding.candidateId !== null && !candidates.get(binding.candidateId)?.active) return invalidPilot('INACTIVE_TEACHER')
  assertNoTeacherConflict(fixture, bindings)
  return { bindings, changes }
}
export async function previewRosterReplacement(fixtureValue: unknown, rosterValue: unknown, directoryValue: unknown, inputValue: unknown, today: string): Promise<RosterReplacementPreview> {
  const fixture = validatePilotFixture(fixtureValue), roster = await checkedRoster(fixture, rosterValue), directory = await checkedDirectory(directoryValue, fixture.schoolId), input = rosterReplacementInput(inputValue), date = pilotDate(today)
  if (input.expectedVersion !== roster.version) return invalidPilot('ROSTER_CHANGED')
  if (input.sourceFingerprint !== await fingerprintPilotFixture(fixture)) return invalidPilot('SOURCE_CHANGED')
  if (input.effectiveFrom < date || input.effectiveFrom < roster.revisions.at(-1)!.effectiveFrom || input.effectiveFrom > fixture.dateRange.endsOn) return invalidPilot('INVALID_EFFECTIVE_DATE')
  if (roster.revisions.some(revision => revision.request?.requestKey === input.requestKey)) return invalidPilot('REQUEST_ALREADY_USED')
  const { changes } = replacements(fixture, roster, directory, input)
  if (!changes.length) return invalidPilot('NO_CHANGES')
  const changed = new Set(changes.map(change => change.roleId))
  const content = { schema: 'timetable.pilot.roster-preview.v1' as const, schoolId: fixture.schoolId, fixtureId: fixture.id, input, directoryRevision: directory.revision, directoryFingerprint: directory.fingerprint, rosterFingerprint: await pilotDigest(roster), changes, affectedWeeklyLessons: fixture.lessons.filter(lesson => changed.has(lesson.teacherId)).length }
  return { ...content, previewFingerprint: await pilotDigest(content) }
}
export async function commitRosterReplacement(fixtureValue: unknown, rosterValue: unknown, directoryValue: unknown, previewValue: unknown, today: string): Promise<PilotRoster> {
  const fixture = validatePilotFixture(fixtureValue), roster = await checkedRoster(fixture, rosterValue), preview = parseRosterReplacementPreview(previewValue)
  const { previewFingerprint, ...content } = preview
  if (await pilotDigest(content) !== previewFingerprint) return invalidPilot('PREVIEW_CHANGED')
  if (preview.schoolId !== roster.schoolId || preview.fixtureId !== roster.fixtureId) return invalidPilot('SCHOOL_MISMATCH')
  const old = roster.revisions.find(revision => revision.request?.requestKey === preview.input.requestKey)
  if (old) {
    if (old.commandFingerprint !== await pilotDigest(preview.input)) return invalidPilot('REQUEST_CHANGED')
    return structuredClone(roster)
  }
  const directory = await checkedDirectory(directoryValue, fixture.schoolId)
  if (directory.revision !== preview.directoryRevision || directory.fingerprint !== preview.directoryFingerprint) return invalidPilot('DIRECTORY_CHANGED')
  const fresh = await previewRosterReplacement(fixture, roster, directory, preview.input, today)
  if (fresh.previewFingerprint !== preview.previewFingerprint) return invalidPilot('PREVIEW_CHANGED')
  const { bindings } = replacements(fixture, roster, directory, preview.input)
  return parsePilotRoster({ ...roster, version: roster.version + 1, revisions: [...roster.revisions, { version: roster.version + 1, effectiveFrom: preview.input.effectiveFrom, sourceFingerprint: preview.input.sourceFingerprint, bindings, request: structuredClone(preview.input), commandFingerprint: await pilotDigest(preview.input) }] })
}

// 시간표 교체와 담당 연결 계획을 함께 갱신하되 이전 연결 판·요청 원문은 남긴다.
export async function rebasePilotRoster(oldFixtureValue: unknown, newFixtureValue: unknown, rosterValue: unknown, effectiveFrom: string, today = effectiveFrom): Promise<PilotRoster> {
  const oldFixture = validatePilotFixture(oldFixtureValue), newFixture = validatePilotFixture(newFixtureValue), date = pilotDate(effectiveFrom), current = pilotDate(today)
  const { revision: oldRevision, lessons: _oldLessons, ...oldStructure } = oldFixture
  const { revision: newRevision, lessons: _newLessons, ...newStructure } = newFixture
  if (pilotCanonical(oldStructure) !== pilotCanonical(newStructure) || newRevision !== oldRevision + 1) return invalidPilot('SOURCE_CHANGED')
  const roster = await checkedRoster(oldFixture, rosterValue)
  if (date < current || date < roster.revisions.at(-1)!.effectiveFrom || date < newFixture.dateRange.startsOn || date > newFixture.dateRange.endsOn) return invalidPilot('INVALID_EFFECTIVE_DATE')
  const bindings = structuredClone(roster.revisions.at(-1)!.bindings)
  assertNoTeacherConflict(newFixture, bindings)
  const previousSourceFingerprint = await fingerprintPilotFixture(oldFixture), sourceFingerprint = await fingerprintPilotFixture(newFixture)
  const requestKey = 'basis-' + (await pilotDigest({ previousSourceFingerprint, sourceFingerprint, date, version: roster.version })).slice(0, 48)
  const request: RosterRebaseInput = { kind: 'basis-rebase', previousSourceFingerprint, sourceFingerprint, effectiveFrom: date, expectedVersion: roster.version, requestKey }
  return parsePilotRoster({ ...roster, version: roster.version + 1, revisions: [...roster.revisions, { version: roster.version + 1, effectiveFrom: date, sourceFingerprint, bindings, request, commandFingerprint: await pilotDigest(request) }] })
}

export function parsePilotCsvRows(text: string): string[][] {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 200000) return invalidPilot('INVALID_CSV')
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false
  for (let index = 0; index <= input.length; index++) {
    const char = input[index] ?? '\n'
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index++ }
      else if (char === '"') { quoted = false; closed = true }
      else if (index === input.length) return invalidPilot('INVALID_CSV')
      else cell += char
    } else if (char === '"' && !cell && !closed) quoted = true
    else if (char === ',' || char === '\n') {
      row.push(cell); cell = ''; closed = false
      if (char === '\n') { if (row.some(cell => cell !== '')) rows.push(row); row = [] }
    } else { if (closed || char === '"' || char === '\r') return invalidPilot('INVALID_CSV'); cell += char }
  }
  if (rows.length > 501) return invalidPilot('INVALID_CSV')
  return rows
}
export async function parseRegisteredTeacherCsv(text: string, schoolId: string, revision = 1): Promise<RegisteredTeacherDirectory> {
  const rows = parsePilotCsvRows(text), [header, ...body] = rows
  if (pilotCanonical(header) !== pilotCanonical(['id', 'schoolId', 'label', 'active']) || !body.length) return invalidPilot('INVALID_CSV')
  const teachers = body.map(row => {
    if (row.length !== 4 || row[3] !== 'true' && row[3] !== 'false') return invalidPilot('INVALID_CSV')
    return registeredTeacherCandidate({ id: row[0], schoolId: row[1], label: row[2], active: row[3] === 'true' })
  })
  return createRegisteredTeacherDirectory(schoolId, pilotInteger(revision), pilotUnique(teachers, teacher => teacher.id), 'administrator-csv')
}
const csvCell = (value: string): string => '"' + (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"'
export function exportPilotRosterCsv(value: unknown, date: string): string {
  const roster = parsePilotRoster(value), day = pilotDate(date), bindings = rosterBindingsOn(roster, day)
  // 학교 밖 공유용에는 회원 식별자·메일·연락처를 넣지 않는다. 재가져오기 명단과도 구분한다.
  const rows = [['적용일', '가상 역할', '표시 이름', '연결 상태'], ...bindings.map(binding => [day, binding.roleId, binding.label, binding.kind === 'virtual' ? '가상 교사' : '가입 교사 연결 후보'])]
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}
