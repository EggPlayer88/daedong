import { canonical, exact, isoDate as readDate, ServiceError, validateLocalInput } from '../services/service-values'
import limits from './limits.json'

export const CONTRACT = 'teacher-roster.v1'
export type Teacher = { id: string; name: string; kind: 'person' | 'vacancy' }
export type ClassRow = { id: string; grade: number; number: number; name: string; officialId: string | null }
export type Course = { id: string; name: string; subject: string; teacherId: string; classId: string; weeklyHours: number }
export type Slot = { id: string; day: number; period: number; start: number; end: number }
export type Lesson = { id: string; courseId: string; slotId: string }
export type Plan = {
  id: string; termId: string; title: string; from: string; until: string
  teachers: Teacher[]; classes: ClassRow[]; courses: Course[]; slots: Slot[]; lessons: Lesson[]
  homerooms: { classId: string; teacherId: string }[]
}
export type Finding = { code: string; message: string; ids: string[] }
export type SavedPlan = { version: number; state: 'draft' | 'published'; plan: Plan }
export type Link = { teacherId: string; memberId: string; from: string; until: string }
export type Snapshot = {
  revision: number; terms: { id: string; name: string; from: string; until: string }[]
  teachers: Teacher[]; members: { id: string; name: string; from: string; until: string | null }[]
  classes: (ClassRow & { yearId: string })[]; plans: SavedPlan[]; links: Link[]
}
export type Intent =
  | { kind: 'save'; expectedRevision: number; plan: Plan }
  | { kind: 'publish'; expectedRevision: number; planId: string; version: number }
  | { kind: 'link'; expectedRevision: number; teacherId: string; memberId: string; from: string; until: string }
export type Preview = { id: string; hash: string; expiresAt: string; intent: Intent; findings: Finding[]; summary: { teachers: number; lessons: number; courses: number; homerooms: number } }
export type Command = { previewId: string; hash: string; intent: Intent }
export type Receipt = { requestKey: string; revision: number; kind: Intent['kind']; targetId: string }
export type CloseResult = { outcome: 'applied'; receipt: Receipt } | { outcome: 'closed'; receipt: null }
export interface RosterServer {
  get(memberId: string): Promise<Snapshot>
  preview(memberId: string, intent: Intent): Promise<Preview>
  commit(memberId: string, command: Command, key: string): Promise<Receipt>
  close(memberId: string, command: Command, key: string): Promise<CloseResult>
}
const bad = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const identifier = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : bad()
const isoDate = (v: unknown): string => { const d = readDate(v); if (d < '2020-01-01' || d > '2100-12-31') bad(); return d }
const string = (v: unknown, max = limits.name): string => typeof v === 'string' && v === v.trim() && Array.from(v).length > 0 && Array.from(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v) ? v : bad()
const integer = (v: unknown, min = 0, max = 2147483646): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : bad()
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : bad()
const unique = (values: string[]) => { if (new Set(values).size !== values.length) bad() }
const dateRange = (from: unknown, until: unknown) => { const a = isoDate(from), b = isoDate(until); if (a >= b) bad(); return { from: a, until: b } }
export function teacher(v: unknown): Teacher {
  exact(v, ['id', 'name', 'kind']); if (v.kind !== 'person' && v.kind !== 'vacancy') bad()
  return { id: identifier(v.id), name: string(v.name), kind: v.kind as Teacher['kind'] }
}
export function classRow(v: unknown): ClassRow {
  exact(v, ['id', 'grade', 'number', 'name', 'officialId'])
  return { id: identifier(v.id), grade: integer(v.grade, 1, 20), number: integer(v.number, 1, 99), name: string(v.name, 30), officialId: v.officialId === null ? null : identifier(v.officialId) }
}
export function plan(v: unknown): Plan {
  exact(v, ['id', 'termId', 'title', 'from', 'until', 'teachers', 'classes', 'courses', 'slots', 'lessons', 'homerooms'])
  const teachers = array(v.teachers, limits.teachers).map(teacher), classes = array(v.classes, limits.classes).map(classRow)
  const courses = array(v.courses, limits.courses).map(r => { exact(r, ['id', 'name', 'subject', 'teacherId', 'classId', 'weeklyHours']); return { id: identifier(r.id), name: string(r.name, 120), subject: string(r.subject, 50), teacherId: identifier(r.teacherId), classId: identifier(r.classId), weeklyHours: integer(r.weeklyHours, 1, 140) } })
  const slots = array(v.slots, limits.slots).map(r => { exact(r, ['id', 'day', 'period', 'start', 'end']); const start = integer(r.start, 0, 1439), end = integer(r.end, 1, 1440); if (end <= start) bad(); return { id: identifier(r.id), day: integer(r.day, 1, 7), period: integer(r.period, 1, 20), start, end } })
  const lessons = array(v.lessons, limits.lessons).map(r => { exact(r, ['id', 'courseId', 'slotId']); return { id: identifier(r.id), courseId: identifier(r.courseId), slotId: identifier(r.slotId) } })
  const homerooms = array(v.homerooms, limits.classes).map(r => { exact(r, ['classId', 'teacherId']); return { classId: identifier(r.classId), teacherId: identifier(r.teacherId) } })
  for (const rows of [teachers, classes, courses, slots, lessons]) unique(rows.map(r => r.id))
  unique(classes.map(r => `${r.grade}:${r.number}`)); unique(classes.flatMap(r => r.officialId ? [r.officialId] : [])); unique(slots.map(r => `${r.day}:${r.period}`)); unique(homerooms.map(r => r.classId))
  const ts = new Set(teachers.map(r => r.id)), cs = new Set(classes.map(r => r.id)), co = new Set(courses.map(r => r.id)), sl = new Set(slots.map(r => r.id))
  if (courses.some(r => !ts.has(r.teacherId) || !cs.has(r.classId)) || lessons.some(r => !co.has(r.courseId) || !sl.has(r.slotId)) || homerooms.some(r => !ts.has(r.teacherId) || !cs.has(r.classId))) bad()
  return { id: identifier(v.id), termId: identifier(v.termId), title: string(v.title, limits.title), ...dateRange(v.from, v.until), teachers, classes, courses, slots, lessons, homerooms }
}
export const localPlan = (v: unknown) => validateLocalInput(() => plan(v))
export function findings(p: Plan): Finding[] {
  const result: Finding[] = [], courses = new Map(p.courses.map(r => [r.id, r])), slots = new Map(p.slots.map(r => [r.id, r]))
  if (!p.teachers.length || !p.classes.length || !p.courses.length || !p.lessons.length) result.push({ code: 'EMPTY', message: '교사·학급·수업과 교시 배치를 채워 주세요.', ids: [] })
  for (const c of p.courses) if (p.lessons.filter(r => r.courseId === c.id).length !== c.weeklyHours) result.push({ code: 'HOURS', message: `${c.name}의 주당 시수와 배치 수가 다릅니다.`, ids: [c.id] })
  const ordered = p.lessons.map(r => ({ ...r, course: courses.get(r.courseId)!, slot: slots.get(r.slotId)! })).sort((a, b) => a.slot.day - b.slot.day || a.slot.start - b.slot.start)
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length && ordered[j].slot.day === ordered[i].slot.day && ordered[j].slot.start < ordered[i].slot.end; j++) {
    const a = ordered[i], b = ordered[j]
    if (a.course.teacherId === b.course.teacherId || a.course.classId === b.course.classId) result.push({ code: 'OVERLAP', message: '같은 시간에 교사 또는 학급 수업이 겹칩니다.', ids: [a.id, b.id] })
    if (result.length >= limits.lessons) return result
  }
  return result
}
export function intent(v: unknown): Intent {
  return validateLocalInput(() => {
    if (!v || typeof v !== 'object' || !('kind' in v)) bad()
    const x = v as Record<string, unknown>, expectedRevision = integer(x.expectedRevision)
    if (x.kind === 'save') { exact(x, ['kind', 'expectedRevision', 'plan']); return { kind: 'save', expectedRevision, plan: plan(x.plan) } }
    if (x.kind === 'publish') { exact(x, ['kind', 'expectedRevision', 'planId', 'version']); return { kind: 'publish', expectedRevision, planId: identifier(x.planId), version: integer(x.version, 1) } }
    if (x.kind === 'link') { exact(x, ['kind', 'expectedRevision', 'teacherId', 'memberId', 'from', 'until']); return { kind: 'link', expectedRevision, teacherId: identifier(x.teacherId), memberId: identifier(x.memberId), ...dateRange(x.from, x.until) } }
    return bad()
  })
}
export function snapshot(v: unknown): Snapshot {
  exact(v, ['revision', 'terms', 'teachers', 'members', 'classes', 'plans', 'links'])
  const terms = array(v.terms, 200).map(r => { exact(r, ['id', 'name', 'from', 'until']); return { id: identifier(r.id), name: string(r.name, 200), ...dateRange(r.from, r.until) } })
  const teachers = array(v.teachers, limits.teachers).map(teacher)
  const members = array(v.members, limits.teachers).map(r => { exact(r, ['id', 'name', 'from', 'until']); const from = isoDate(r.from), until = r.until === null ? null : isoDate(r.until); if (until && until <= from) bad(); return { id: identifier(r.id), name: string(r.name, 120), from, until } })
  const classes = array(v.classes, limits.classes * 10).map(r => { exact(r, ['id', 'grade', 'number', 'name', 'officialId', 'yearId']); const { yearId, ...c } = r; return { ...classRow(c), yearId: identifier(yearId) } })
  const plans = array(v.plans, 100).map(r => { exact(r, ['version', 'state', 'plan']); if (r.state !== 'draft' && r.state !== 'published') bad(); return { version: integer(r.version, 1), state: r.state as SavedPlan['state'], plan: plan(r.plan) } })
  const links = array(v.links, 3000).map(r => { exact(r, ['teacherId', 'memberId', 'from', 'until']); return { teacherId: identifier(r.teacherId), memberId: identifier(r.memberId), ...dateRange(r.from, r.until) } })
  for (const rows of [terms, teachers, members, classes]) unique(rows.map(r => r.id)); unique(plans.map(r => r.plan.id))
  return { revision: integer(v.revision), terms, teachers, members, classes, plans, links }
}
export function preview(v: unknown, expected: Intent): Preview {
  exact(v, ['id', 'hash', 'expiresAt', 'intent', 'findings', 'summary'])
  if (canonical(intent(v.intent)) !== canonical(expected) || typeof v.hash !== 'string' || !/^[a-f0-9]{64}$/.test(v.hash) || typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt))) bad()
  const errors = array(v.findings, limits.lessons).map(r => { exact(r, ['code', 'message', 'ids']); return { code: string(r.code), message: string(r.message, 300), ids: array(r.ids, limits.lessons).map(identifier) } })
  exact(v.summary, ['teachers', 'lessons', 'courses', 'homerooms'])
  return { id: identifier(v.id), hash: v.hash as string, expiresAt: v.expiresAt as string, intent: expected, findings: errors, summary: { teachers: integer(v.summary.teachers), lessons: integer(v.summary.lessons), courses: integer(v.summary.courses), homerooms: integer(v.summary.homerooms) } }
}
export function command(v: unknown): Command {
  return validateLocalInput(() => { exact(v, ['previewId', 'hash', 'intent']); if (typeof v.hash !== 'string' || !/^[a-f0-9]{64}$/.test(v.hash)) bad(); return { previewId: identifier(v.previewId), hash: v.hash as string, intent: intent(v.intent) } })
}
export function receipt(v: unknown, c: Command, key: string): Receipt {
  exact(v, ['requestKey', 'revision', 'kind', 'targetId'])
  if (v.requestKey !== key || v.kind !== c.intent.kind || integer(v.revision, 1) !== c.intent.expectedRevision + 1 || v.targetId !== (c.intent.kind === 'save' ? c.intent.plan.id : c.intent.kind === 'publish' ? c.intent.planId : c.intent.teacherId)) bad()
  return { requestKey: key, revision: v.revision as number, kind: c.intent.kind, targetId: identifier(v.targetId) }
}
export function closeResult(v: unknown, c: Command, key: string): CloseResult {
  exact(v, ['outcome', 'receipt']); if (v.outcome === 'closed' && v.receipt === null) return { outcome: 'closed', receipt: null }
  if (v.outcome === 'applied') return { outcome: 'applied', receipt: receipt(v.receipt, c, key) }; return bad()
}
