import { exact, isoDate, ServiceError, validateLocalInput } from '../services/service-values'
import policy from './setup-policy.json'

export const SETUP_CONTRACT = 'timetable.setup.v1'
export interface SetupSpace { id: string; kind: 'room' | 'equipment'; label: string; capacity: number | null; version: number }
export interface SetupClass { id: string; label: string; grade: number }
export interface SetupCourseLink { version: number; studentGroup: boolean; classIds: string[]; spaceIds: string[] }
export interface SetupCourse { id: string; label: string; inTimetable: boolean; teacherLabels: string[]; studentCount: number; link: SetupCourseLink | null }
export interface SetupFinding { code: keyof typeof SETUP_FINDINGS; targetId: string; message: string; blocksConfirm: boolean }
export interface SetupSnapshot {
  termId: string; termLabel: string; firstDay: string; lastDay: string; referenceDay: string
  sourceRevision: number; sourceFingerprint: string; canEdit: true
  spaces: SetupSpace[]; classes: SetupClass[]; courses: SetupCourse[]; findings: SetupFinding[]
}
export type SetupCommand =
  | { kind: 'space_save'; spaceId: string | null; expectedVersion: number | null; input: { kind: 'room' | 'equipment'; label: string; capacity: number | null } }
  | { kind: 'space_remove'; spaceId: string; expectedVersion: number }
  | { kind: 'course_link'; courseId: string; expectedVersion: number | null; input: { classIds: string[]; studentGroup: boolean; spaceIds: string[] } }
export interface SetupReceipt { requestKey: string; kind: SetupCommand['kind']; targetId: string; version: number; sourceFingerprint: string | null }
export interface SetupServer {
  get(memberId: string): Promise<SetupSnapshot>
  execute(memberId: string, command: SetupCommand, key: string): Promise<SetupReceipt>
  recover(memberId: string, command: SetupCommand, key: string): Promise<SetupReceipt>
}
export const SETUP_FINDINGS = {
  SPACE_CAPACITY_MISSING: true, STUDENT_OVERLAP: true, LINK_CLASS_REMOVED: true, LINK_SPACE_REMOVED: true,
  COURSE_STARTS_LATER: true, COURSE_ENDS_EARLY: true, TEACHER_CHANGES_IN_TERM: true, TEACHER_LEAVES_IN_TERM: true,
  COURSE_ID_UNSUPPORTED: true, COURSE_TEACHER_MISSING: false, COURSE_LINK_MISSING: false,
} as const
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
const id = (value: unknown): string => typeof value === 'string' && idPattern.test(value) ? value : fail()
const rawId = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail()
const num = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fail()
const str = (value: unknown, max: number): string => typeof value === 'string' && value.trim() && Array.from(value).length <= max ? value : fail()
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail()
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : fail()
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail()
const unique = <T,>(rows: T[], key: (row: T) => string): T[] => new Set(rows.map(key)).size === rows.length ? rows : fail()
const ids = (value: unknown, max: number): string[] => { const result = unique(arr(value).map(id), x => x); if (result.length > max) fail(); return result }
const spaceKind = (value: unknown): SetupSpace['kind'] => value === 'room' || value === 'equipment' ? value : fail()
const cap = (value: unknown) => value === null ? null : num(value, 1, policy.maxCapacity)
const revision = (value: unknown) => value === null ? null : num(value)

/** 미완성 원본의 빠진 참조와 지원하지 않는 수업 ID를 보존해야 담당자가 고칠 수 있다. */
export function setupSnapshot(value: unknown): SetupSnapshot {
  try {
    exact(value, ['termId', 'termLabel', 'firstDay', 'lastDay', 'referenceDay', 'sourceRevision', 'sourceFingerprint', 'canEdit', 'spaces', 'classes', 'courses', 'findings'])
    id(value.termId); str(value.termLabel, policy.maxTermLabel)
    const firstDay = isoDate(value.firstDay), lastDay = isoDate(value.lastDay), referenceDay = isoDate(value.referenceDay)
    if (firstDay > lastDay || referenceDay < firstDay || referenceDay > lastDay || value.canEdit !== true) fail()
    num(value.sourceRevision); hash(value.sourceFingerprint)
    const spaces = unique(arr(value.spaces).map(row => {
      exact(row, ['id', 'kind', 'label', 'capacity', 'version'])
      return { id: id(row.id), kind: spaceKind(row.kind), label: str(row.label, policy.maxSpaceLabel), capacity: cap(row.capacity), version: num(row.version) }
    }), row => row.id)
    const classes = unique(arr(value.classes).map(row => {
      exact(row, ['id', 'label', 'grade']); return { id: id(row.id), label: str(row.label, policy.maxClassLabel), grade: num(row.grade, 1, policy.maxGrade) }
    }), row => row.id)
    const courses = unique(arr(value.courses).map(row => {
      exact(row, ['id', 'label', 'inTimetable', 'teacherLabels', 'studentCount', 'link'])
      const courseId = rawId(row.id), inTimetable = bool(row.inTimetable)
      if (inTimetable && !idPattern.test(courseId)) fail()
      let link: SetupCourseLink | null = null
      if (row.link !== null) {
        exact(row.link, ['version', 'studentGroup', 'classIds', 'spaceIds'])
        link = { version: num(row.link.version), studentGroup: bool(row.link.studentGroup), classIds: ids(row.link.classIds, policy.maxClassIds), spaceIds: ids(row.link.spaceIds, policy.maxSpaceIds) }
        if (link.studentGroup && link.classIds.length) fail()
      }
      return { id: courseId, label: str(row.label, policy.maxCourseLabel), inTimetable, teacherLabels: arr(row.teacherLabels).map(label => str(label, policy.maxTeacherLabel)), studentCount: num(row.studentCount, 0), link }
    }), row => row.id)
    const findings = arr(value.findings).map(row => {
      exact(row, ['code', 'targetId', 'message', 'blocksConfirm'])
      if (typeof row.code !== 'string' || !Object.hasOwn(SETUP_FINDINGS, row.code) || SETUP_FINDINGS[row.code as keyof typeof SETUP_FINDINGS] !== row.blocksConfirm) fail()
      return { code: row.code as keyof typeof SETUP_FINDINGS, targetId: rawId(row.targetId), message: str(row.message, policy.maxFindingMessage), blocksConfirm: row.blocksConfirm as boolean }
    })
    return structuredClone({ ...value, spaces, classes, courses, findings }) as unknown as SetupSnapshot
  } catch { return fail() }
}

/** 서버 요청 해시와 복구를 위해 공백·배열 순서를 자동으로 바꾸지 않는다. */
export function setupCommand(value: unknown, source?: SetupSnapshot): SetupCommand {
  return validateLocalInput(() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
    const raw = value as Record<string, unknown>
    if (raw.kind === 'space_save') {
      exact(raw, ['kind', 'spaceId', 'expectedVersion', 'input']); exact(raw.input, ['kind', 'label', 'capacity'])
      const expectedVersion = revision(raw.expectedVersion)
      if ((raw.spaceId === null) !== (expectedVersion === null)) fail()
      if (raw.spaceId !== null) id(raw.spaceId)
      const kind = spaceKind(raw.input.kind), label = str(raw.input.label, policy.maxSpaceLabel); cap(raw.input.capacity)
      if (/[\u0000-\u001f\u007f]|[\uD800-\uDFFF]/u.test(label)) fail()
      if (source) {
        if (raw.spaceId !== null) {
          const current = source.spaces.find(row => row.id === raw.spaceId)
          if (!current || current.version !== expectedVersion) throw new ServiceError('CONFLICT')
        }
        if (source.spaces.some(row => row.id !== raw.spaceId && row.kind === kind && row.label === label.trim())) throw new ServiceError('CONFLICT')
      }
    } else if (raw.kind === 'space_remove') {
      exact(raw, ['kind', 'spaceId', 'expectedVersion']); id(raw.spaceId); num(raw.expectedVersion)
      if (source) {
        const current = source.spaces.find(row => row.id === raw.spaceId)
        if (!current || current.version !== raw.expectedVersion || source.courses.some(course => course.link?.spaceIds.includes(raw.spaceId as string))) throw new ServiceError('CONFLICT')
      }
    } else if (raw.kind === 'course_link') {
      exact(raw, ['kind', 'courseId', 'expectedVersion', 'input']); id(raw.courseId); revision(raw.expectedVersion)
      exact(raw.input, ['classIds', 'studentGroup', 'spaceIds'])
      const classIds = ids(raw.input.classIds, policy.maxClassIds), studentGroup = bool(raw.input.studentGroup), spaceIds = ids(raw.input.spaceIds, policy.maxSpaceIds)
      if (studentGroup && classIds.length) fail()
      if (source) {
        const current = source.courses.find(row => row.id === raw.courseId)
        if (!current || (current.link?.version ?? null) !== raw.expectedVersion) throw new ServiceError('CONFLICT')
        if (classIds.some(ref => !source.classes.some(row => row.id === ref)) || spaceIds.some(ref => !source.spaces.some(row => row.id === ref))) fail()
      }
    } else fail()
    return structuredClone(raw) as unknown as SetupCommand
  })
}

export function setupReceipt(value: unknown, command: SetupCommand, key: string): SetupReceipt {
  exact(value, ['requestKey', 'kind', 'targetId', 'version', 'sourceFingerprint'])
  id(value.targetId); num(value.version)
  if (value.sourceFingerprint !== null) hash(value.sourceFingerprint)
  if (value.requestKey !== key || value.kind !== command.kind || value.version !== (command.expectedVersion ?? 0) + 1) fail()
  const target = command.kind === 'course_link' ? command.courseId : command.spaceId
  if (target !== null && value.targetId !== target) fail()
  return structuredClone(value) as unknown as SetupReceipt
}
