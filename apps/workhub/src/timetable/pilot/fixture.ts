import data from './pilot-data.json'

export interface PilotTeacher { id: string; label: string; kind: 'virtual' | 'registered-reference' }
export interface PilotClass { id: string; label: string }
export interface PilotLessonTemplate {
  id: string; teacherId: string; classIds: string[]; subject: string; weekday: number; period: number; roomId: string
}
export interface PilotFixture {
  schema: 'timetable.pilot.v1'; id: string; schoolId: string; revision: number; label: string
  source: { kind: 'legacy-synthetic-seed'; sha256: string; originalCollisionCount: number; notes: string[] }
  teachers: PilotTeacher[]; classes: PilotClass[]; rooms: { id: string; label: string; capacity: number }[]
  lessons: PilotLessonTemplate[]; daySlots: { period: number; startTime: string; endTime: string }[]
  dateRange: { startsOn: string; endsOn: string }; defaultDate: string
}
const pilotMessages: Readonly<Record<string, string>> = {
  INVALID_CSV: 'CSV의 열 이름과 값이 안내한 형식인지 확인해 주세요. UTF-8 형식으로 다시 저장하면 한글을 유지할 수 있습니다.',
  SCHOOL_MISMATCH: '현재 학교와 다른 학교의 자료입니다. 현재 학교에서 확인한 명단을 사용해 주세요.',
  SOURCE_CHANGED: '기준 시간표가 바뀌었습니다. 현재 자료를 다시 열어 변경 내용을 비교해 주세요.',
  DIRECTORY_CHANGED: '확인한 교사 명단이 바뀌었습니다. 최신 명단으로 연결 계획을 다시 확인해 주세요.',
  ROSTER_CHANGED: '교사 연결 계획이 바뀌었습니다. 현재 계획을 다시 확인해 주세요.',
  PREVIEW_CHANGED: '변경 비교 이후 자료가 바뀌었습니다. 비교를 다시 실행한 뒤 반영해 주세요.',
  REQUEST_CHANGED: '같은 요청 번호의 내용이 원래 요청과 다릅니다. 원래 내용을 보존한 상태에서 다시 확인해 주세요.',
  REQUEST_ALREADY_USED: '이미 사용한 요청 번호입니다. 기존 처리 결과를 먼저 확인해 주세요.',
  HISTORY_CHANGED: '이전 연결 이력이 원본과 다릅니다. 자료를 덮어쓰지 않고 확인이 필요합니다.',
  TEACHER_TIME_CONFLICT: '같은 교사에게 같은 요일·교시의 수업이 겹칩니다. 다른 교사를 연결하거나 수업 시간을 조정해 주세요.',
  RESOURCE_CONFLICT: '교사·학급·공간에 같은 시간의 수업이 겹칩니다. 해당 배치를 조정해 주세요.',
  CLASS_TIME_CONFLICT: '같은 학급의 같은 요일·교시에 수업이 두 번 들어 있습니다.',
  SLOT_CONFLICT: '교시의 시작·종료 시각이 서로 겹칩니다. 임시 일과 시각을 확인해 주세요.',
  UNKNOWN_TEACHER_ROLE: '현재 시간표에 없는 교사 역할입니다. 내려받은 시간표의 역할 번호를 사용해 주세요.',
  UNKNOWN_REGISTERED_TEACHER: '확인한 명단에 없는 교사입니다. 명단을 다시 읽고 직접 선택해 주세요.',
  INACTIVE_TEACHER: '활성 소속이 확인되지 않은 교사입니다. 현재 학교에서 활동 중인 교사를 선택해 주세요.',
  UNMAPPED_TEACHER: '연결 계획에서 빠진 교사 역할이 있습니다. 모든 역할의 연결 상태를 확인해 주세요.',
  DATE_OUTSIDE_ROSTER: '이 날짜에는 사용할 교사 연결 계획이 없습니다.',
  INVALID_EFFECTIVE_DATE: '적용일은 연습 기준일 이후이며 현재 학기 안이어야 합니다. 이미 정한 다음 판보다 앞설 수 없습니다.',
  INCOMPLETE_TIMETABLE: '기존 학급·요일·교시가 빠졌거나 추가됐습니다. 내려받은 주간 시간표의 수업 칸을 유지하고 내용을 바꿔 주세요.',
  LESSON_ID_ONLY_CHANGE: '수업 내용은 같고 번호만 바뀌었습니다. 기존 수업 번호를 유지해 주세요.',
  DUPLICATE_LESSON: '같은 수업 번호에 서로 다른 배치가 있거나 같은 학급이 중복됐습니다.',
  NO_CHANGES: '현재 자료와 다른 내용이 없습니다. 바꿀 내용을 입력한 뒤 다시 비교해 주세요.',
}
export class PilotDataError extends Error {
  constructor(readonly code: string, message = pilotMessages[code] ?? '운영 연습 자료의 형식과 기준을 다시 확인해 주세요.') { super(message); this.name = 'PilotDataError' }
}
export const invalidPilot = (code = 'INVALID_INPUT'): never => { throw new PilotDataError(code) }
export function pilotExact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidPilot()
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalidPilot()
  return row
}
export function pilotId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return invalidPilot()
  return value
}
export function pilotLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 300 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalidPilot()
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return invalidPilot() }
    else if (code >= 0xdc00 && code <= 0xdfff) return invalidPilot()
  }
  return value
}
export function pilotDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return invalidPilot()
  return value
}
export function pilotInteger(value: unknown, min = 1, max = 100000): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return invalidPilot()
  return value as number
}
export function pilotHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalidPilot()
  return value
}
export function pilotRows<T>(value: unknown, read: (value: unknown) => T, max = 20000): T[] {
  if (!Array.isArray(value) || value.length > max) return invalidPilot()
  return value.map(read)
}
export function pilotUnique<T>(rows: T[], key: (row: T) => string): T[] {
  if (new Set(rows.map(key)).size !== rows.length) return invalidPilot()
  return rows
}
export function pilotCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(pilotCanonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + pilotCanonical((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value)
}
export async function pilotDigest(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pilotCanonical(value))))].map(value => value.toString(16).padStart(2, '0')).join('')
}
const clock = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return invalidPilot()
  return value
}
export function validatePilotFixture(value: unknown): PilotFixture {
  const row = pilotExact(value, ['schema', 'id', 'schoolId', 'revision', 'label', 'source', 'teachers', 'classes', 'rooms', 'lessons', 'daySlots', 'dateRange', 'defaultDate'])
  if (row.schema !== 'timetable.pilot.v1') return invalidPilot()
  const source = pilotExact(row.source, ['kind', 'sha256', 'originalCollisionCount', 'notes'])
  if (source.kind !== 'legacy-synthetic-seed') return invalidPilot()
  const dateRange = pilotExact(row.dateRange, ['startsOn', 'endsOn'])
  const startsOn = pilotDate(dateRange.startsOn), endsOn = pilotDate(dateRange.endsOn), defaultDate = pilotDate(row.defaultDate)
  if (startsOn > endsOn || defaultDate < startsOn || defaultDate > endsOn) return invalidPilot()
  const teachers = pilotUnique(pilotRows(row.teachers, value => {
    const item = pilotExact(value, ['id', 'label', 'kind'])
    if (item.kind !== 'virtual' && item.kind !== 'registered-reference') return invalidPilot()
    return { id: pilotId(item.id), label: pilotLabel(item.label), kind: item.kind as PilotTeacher['kind'] }
  }, 500), item => item.id)
  const classes = pilotUnique(pilotRows(row.classes, value => { const item = pilotExact(value, ['id', 'label']); return { id: pilotId(item.id), label: pilotLabel(item.label) } }, 500), item => item.id)
  const rooms = pilotUnique(pilotRows(row.rooms, value => { const item = pilotExact(value, ['id', 'label', 'capacity']); return { id: pilotId(item.id), label: pilotLabel(item.label), capacity: pilotInteger(item.capacity, 1, 100) } }, 500), item => item.id)
  const daySlots = pilotUnique(pilotRows(row.daySlots, value => {
    const item = pilotExact(value, ['period', 'startTime', 'endTime'])
    const startTime = clock(item.startTime), endTime = clock(item.endTime)
    if (startTime >= endTime) return invalidPilot()
    return { period: pilotInteger(item.period, 1, 30), startTime, endTime }
  }, 30), item => String(item.period))
  for (const left of daySlots) for (const right of daySlots) if (left.period !== right.period && left.startTime < right.endTime && right.startTime < left.endTime) return invalidPilot('SLOT_CONFLICT')
  const teacherIds = new Set(teachers.map(item => item.id)), classIds = new Set(classes.map(item => item.id)), roomIds = new Set(rooms.map(item => item.id)), periods = new Set(daySlots.map(item => item.period))
  const lessons = pilotUnique(pilotRows(row.lessons, value => {
    const item = pilotExact(value, ['id', 'teacherId', 'classIds', 'subject', 'weekday', 'period', 'roomId'])
    const lesson = { id: pilotId(item.id), teacherId: pilotId(item.teacherId), classIds: pilotUnique(pilotRows(item.classIds, pilotId, 100), id => id), subject: pilotLabel(item.subject), weekday: pilotInteger(item.weekday, 1, 5), period: pilotInteger(item.period, 1, 30), roomId: pilotId(item.roomId) }
    if (!lesson.classIds.length || !teacherIds.has(lesson.teacherId) || lesson.classIds.some(id => !classIds.has(id)) || !roomIds.has(lesson.roomId) || !periods.has(lesson.period)) return invalidPilot()
    return lesson
  }), item => item.id)
  const occupancy = new Map<string, number>()
  for (const lesson of lessons) {
    const keys = [`teacher:${lesson.teacherId}`, ...lesson.classIds.map(id => `class:${id}`), `room:${lesson.roomId}`]
    for (const key of keys) {
      const slot = `${lesson.weekday}:${lesson.period}:${key}`, count = (occupancy.get(slot) ?? 0) + 1
      occupancy.set(slot, count)
      const capacity = key.startsWith('room:') ? rooms.find(room => room.id === lesson.roomId)!.capacity : 1
      if (count > capacity) return invalidPilot('RESOURCE_CONFLICT')
    }
  }
  if (!teachers.length || !classes.length || !rooms.length || !daySlots.length || !lessons.length) return invalidPilot()
  return { schema: 'timetable.pilot.v1', id: pilotId(row.id), schoolId: pilotId(row.schoolId), revision: pilotInteger(row.revision), label: pilotLabel(row.label), source: { kind: 'legacy-synthetic-seed', sha256: pilotHash(source.sha256), originalCollisionCount: pilotInteger(source.originalCollisionCount, 0), notes: pilotRows(source.notes, pilotLabel, 30) }, teachers, classes, rooms, lessons, daySlots, dateRange: { startsOn, endsOn }, defaultDate }
}
export function getPilotFixture(): PilotFixture {
  const classes = data.classLabels.map((label, index) => ({ id: `pilot-c${index + 1}`, label }))
  const teachers: PilotTeacher[] = ['a', 'b', 'c'].flatMap((group, index) => data.subjects.map(subject => ({ id: `pilot-${subject.legacyTeacherId}-${group}`, label: `가상 ${subject.label} 교사 ${index + 1}`, kind: 'virtual' })))
  const rooms = classes.map(group => ({ id: `room-${group.id}`, label: `${group.label} 교실`, capacity: data.roomCapacity }))
  const lessons = classes.flatMap((group, classIndex) => {
    const result: PilotLessonTemplate[] = data.regularPeriodsPerDay.flatMap((periods, dayIndex) => Array.from({ length: periods }, (_, periodIndex) => {
      // 과거 시드의 회전식은 보존하고, 학년별로 역할을 나눠 교환할 수 있는 공강도 확보한다.
      const subject = data.subjects[(periodIndex + classIndex + dayIndex * 2) % data.subjects.length]
      return { id: `${group.id}-d${dayIndex + 1}-p${periodIndex + 1}`, teacherId: `pilot-${subject.legacyTeacherId}-${['a', 'b', 'c'][Math.floor(classIndex / 3)]}`, classIds: [group.id], subject: subject.label, weekday: dayIndex + 1, period: periodIndex + 1, roomId: rooms[classIndex].id }
    }))
    result.push({ id: `${group.id}-d${data.special.weekday}-p${data.special.period}`, teacherId: teachers[classIndex].id, classIds: [group.id], subject: data.special.label, weekday: data.special.weekday, period: data.special.period, roomId: rooms[classIndex].id })
    return result
  })
  return validatePilotFixture({ schema: 'timetable.pilot.v1', id: data.id, schoolId: data.schoolId, revision: data.revision, label: data.label, source: data.source, teachers, classes, rooms, lessons, daySlots: data.daySlots, dateRange: data.dateRange, defaultDate: data.defaultDate })
}
export const fingerprintPilotFixture = (value: unknown): Promise<string> => pilotDigest(validatePilotFixture(value))
