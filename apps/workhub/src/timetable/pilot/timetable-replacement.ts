import { fingerprintPilotFixture, invalidPilot, pilotCanonical, pilotDate, pilotDigest, pilotExact, pilotHash, pilotId, pilotInteger, pilotLabel, pilotRows, pilotUnique, validatePilotFixture, type PilotFixture, type PilotLessonTemplate } from './fixture'
import { parsePilotCsvRows } from './roster'
import { teacherBinding, type PilotTeacherBinding } from './roster-contracts'

export interface TimetableReplacementChange {
  classId: string; weekday: number; period: number; before: string; after: string
}
export interface TimetableReplacementPreview {
  schema: 'timetable.pilot.timetable-preview.v1'; fixtureId: string; schoolId: string; baseRevision: number
  baseFingerprint: string; csvFingerprint: string; effectiveFrom: string; lessons: PilotLessonTemplate[]
  changes: TimetableReplacementChange[]; previewFingerprint: string
}
const header = ['lessonId', 'weekday', 'period', 'classId', 'subject', 'teacherRoleId', 'roomId']
const sortedLessons = (lessons: PilotLessonTemplate[]) => [...lessons].map(lesson => ({ ...lesson, classIds: [...lesson.classIds].sort() })).sort((a, b) => a.id.localeCompare(b.id, 'en'))
const cellKey = (classId: string, weekday: number, period: number) => `${classId}:${weekday}:${period}`
const cellLabel = (lesson: PilotLessonTemplate) => `${lesson.subject} / ${lesson.teacherId} / ${lesson.roomId}`
function cells(lessons: PilotLessonTemplate[]): Map<string, PilotLessonTemplate> {
  const result = new Map<string, PilotLessonTemplate>()
  for (const lesson of lessons) for (const classId of lesson.classIds) {
    const key = cellKey(classId, lesson.weekday, lesson.period)
    if (result.has(key)) return invalidPilot('CLASS_TIME_CONFLICT')
    result.set(key, lesson)
  }
  return result
}
function inspectChanges(fixture: PilotFixture, lessons: PilotLessonTemplate[]): TimetableReplacementChange[] {
  const before = cells(fixture.lessons), after = cells(lessons)
  // 수업 없는 칸을 누락과 구별할 계약이 없으므로 이번 교체는 기존 주간 일과를 그대로 채워야 한다.
  if (before.size !== after.size || [...before.keys()].some(key => !after.has(key))) return invalidPilot('INCOMPLETE_TIMETABLE')
  const result: TimetableReplacementChange[] = []
  for (const [key, old] of before) {
    const next = after.get(key)!
    if (cellLabel(old) !== cellLabel(next)) {
      const classId = old.classIds.find(id => cellKey(id, old.weekday, old.period) === key)!
      result.push({ classId, weekday: old.weekday, period: old.period, before: cellLabel(old), after: cellLabel(next) })
    }
  }
  // 수업 ID만 갈아끼우는 입력도 이력상 변경이므로 공개 없이 무시하지 않는다.
  if (!result.length && pilotCanonical(sortedLessons(lessons)) !== pilotCanonical(sortedLessons(fixture.lessons))) return invalidPilot('LESSON_ID_ONLY_CHANGE')
  if (!result.length) return invalidPilot('NO_CHANGES')
  return result.sort((a, b) => cellKey(a.classId, a.weekday, a.period).localeCompare(cellKey(b.classId, b.weekday, b.period), 'en'))
}
function parseTimetableCsv(text: string, fixture: PilotFixture): PilotLessonTemplate[] {
  const rows = parsePilotCsvRows(text)
  if (pilotCanonical(rows[0]) !== pilotCanonical(header) || rows.length < 2) return invalidPilot('INVALID_CSV')
  const lessons = new Map<string, PilotLessonTemplate>()
  for (const row of rows.slice(1)) {
    if (row.length !== header.length || !/^[1-5]$/.test(row[1]) || !/^[1-9]\d?$/.test(row[2])) return invalidPilot('INVALID_CSV')
    const parsed = { id: pilotId(row[0]), weekday: Number(row[1]), period: Number(row[2]), classIds: [pilotId(row[3])], subject: pilotLabel(row[4]), teacherId: pilotId(row[5]), roomId: pilotId(row[6]) }
    const old = lessons.get(parsed.id)
    if (old) {
      if (old.weekday !== parsed.weekday || old.period !== parsed.period || old.subject !== parsed.subject || old.teacherId !== parsed.teacherId || old.roomId !== parsed.roomId || old.classIds.includes(parsed.classIds[0])) return invalidPilot('DUPLICATE_LESSON')
      old.classIds.push(parsed.classIds[0])
    } else lessons.set(parsed.id, parsed)
  }
  return sortedLessons(validatePilotFixture({ ...fixture, lessons: [...lessons.values()] }).lessons)
}
export function assertTimetableTeacherBindings(fixtureValue: unknown, bindingsValue: unknown): void {
  const fixture = validatePilotFixture(fixtureValue), bindings = pilotUnique(pilotRows(bindingsValue, teacherBinding, 500), binding => binding.roleId)
  const map = new Map(bindings.map(binding => [binding.roleId, binding.candidateId === null ? `virtual:${binding.roleId}` : `member:${binding.candidateId}`]))
  if (map.size !== fixture.teachers.length || fixture.teachers.some(teacher => !map.has(teacher.id))) return invalidPilot('UNMAPPED_TEACHER')
  const slots = new Set<string>()
  for (const lesson of fixture.lessons) {
    const key = `${lesson.weekday}:${lesson.period}:${map.get(lesson.teacherId)}`
    if (slots.has(key)) return invalidPilot('TEACHER_TIME_CONFLICT')
    slots.add(key)
  }
}
export async function previewTimetableReplacement(fixtureValue: unknown, text: string, effectiveFrom: string, today: string, bindings?: PilotTeacherBinding[]): Promise<TimetableReplacementPreview> {
  const fixture = validatePilotFixture(fixtureValue), date = pilotDate(effectiveFrom), current = pilotDate(today)
  if (date < current || date < fixture.dateRange.startsOn || date > fixture.dateRange.endsOn) return invalidPilot('INVALID_EFFECTIVE_DATE')
  const lessons = parseTimetableCsv(text, fixture), changes = inspectChanges(fixture, lessons)
  if (bindings) assertTimetableTeacherBindings({ ...fixture, lessons }, bindings)
  const content = { schema: 'timetable.pilot.timetable-preview.v1' as const, fixtureId: fixture.id, schoolId: fixture.schoolId, baseRevision: fixture.revision, baseFingerprint: await fingerprintPilotFixture(fixture), csvFingerprint: await pilotDigest(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')), effectiveFrom: date, lessons, changes }
  return { ...content, previewFingerprint: await pilotDigest(content) }
}
export async function validateTimetableReplacementPreview(fixtureValue: unknown, value: unknown, today: string, bindings?: PilotTeacherBinding[]): Promise<TimetableReplacementPreview> {
  const fixture = validatePilotFixture(fixtureValue), row = pilotExact(value, ['schema', 'fixtureId', 'schoolId', 'baseRevision', 'baseFingerprint', 'csvFingerprint', 'effectiveFrom', 'lessons', 'changes', 'previewFingerprint'])
  if (row.schema !== 'timetable.pilot.timetable-preview.v1') return invalidPilot()
  const baseFingerprint = pilotHash(row.baseFingerprint), effectiveFrom = pilotDate(row.effectiveFrom), current = pilotDate(today)
  if (pilotId(row.fixtureId) !== fixture.id || pilotId(row.schoolId) !== fixture.schoolId || pilotInteger(row.baseRevision) !== fixture.revision || baseFingerprint !== await fingerprintPilotFixture(fixture)) return invalidPilot('SOURCE_CHANGED')
  if (effectiveFrom < current || effectiveFrom < fixture.dateRange.startsOn || effectiveFrom > fixture.dateRange.endsOn) return invalidPilot('INVALID_EFFECTIVE_DATE')
  const lessons = sortedLessons(validatePilotFixture({ ...fixture, lessons: row.lessons }).lessons), changes = inspectChanges(fixture, lessons)
  if (bindings) assertTimetableTeacherBindings({ ...fixture, lessons }, bindings)
  const expected = { schema: 'timetable.pilot.timetable-preview.v1' as const, fixtureId: fixture.id, schoolId: fixture.schoolId, baseRevision: fixture.revision, baseFingerprint, csvFingerprint: pilotHash(row.csvFingerprint), effectiveFrom, lessons, changes }
  if (pilotCanonical(row.changes) !== pilotCanonical(changes) || await pilotDigest(expected) !== pilotHash(row.previewFingerprint)) return invalidPilot('PREVIEW_CHANGED')
  return { ...expected, previewFingerprint: row.previewFingerprint as string }
}
const escape = (text: string) => '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
export function exportPilotTimetableCsv(fixtureValue: unknown): string {
  const fixture = validatePilotFixture(fixtureValue)
  return '\uFEFF' + [header, ...sortedLessons(fixture.lessons).flatMap(lesson => lesson.classIds.map(classId => [lesson.id, String(lesson.weekday), String(lesson.period), classId, lesson.subject, lesson.teacherId, lesson.roomId]))].map(row => row.map(escape).join(',')).join('\r\n')
}
