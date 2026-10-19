import policy from '../_assets/browser-policy.json'
import type { TimetableBasis, TimetableIssue, TimetableSlot, ValidationResult } from './types'
export { default as timetablePolicy } from '../_assets/browser-policy.json'
export type { TimetableBasis, Placement, TimetableIssue, ValidationResult } from './types'

const kinds = new Set(['teacher', 'class', 'student_group', 'room', 'equipment'])
const own = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const overlaps = (a: Pick<TimetableSlot, 'day' | 'startMinute' | 'endMinute'>, b: Pick<TimetableSlot, 'day' | 'startMinute' | 'endMinute'>) => a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute

/** 받은 JSON은 미지원 필드까지 검사한다. 조건을 조용히 버리지 않는다. */
export function validateBasis(value: unknown): ValidationResult {
  const issues: TimetableIssue[] = []
  const issue = (code: string, message: string, path: string) => { if (issues.length < policy.maxIssues) issues.push({ code, message, path }) }
  const obj = (v: unknown, keys: string[], path: string): Record<string, unknown> => {
    if (!own(v)) { issue('INVALID_OBJECT', '객체 형식이 필요합니다.', path); return {} }
    for (const key of Object.keys(v)) if (!keys.includes(key)) issue('UNKNOWN_FIELD', `지원하지 않는 항목입니다: ${key}`, `${path}.${key}`)
    for (const key of keys) if (!(key in v)) issue('MISSING_FIELD', `필수 항목이 없습니다: ${key}`, `${path}.${key}`)
    return v
  }
  const text = (v: unknown, path: string, max = 200): v is string => {
    if (typeof v !== 'string' || !v.replace(/[\s\u0085]/gu, '') || v.length > max || /[\u0000-\u001f\uD800-\uDFFF]/u.test(v)) { issue('INVALID_TEXT', '비어 있지 않은 올바른 문자열이 필요합니다.', path); return false }; return true
  }
  const identifier = (v: unknown, path: string): v is string => {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) { issue('INVALID_ID', '식별자는 영문·숫자·밑줄·하이픈 1~100자여야 합니다.', path); return false }; return true
  }
  const number = (v: unknown, min: number, max: number, path: string): v is number => {
    if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) { issue('INVALID_NUMBER', `${min}~${max} 범위의 정수가 필요합니다.`, path); return false }; return true
  }
  const list = (v: unknown, path: string, limit: number): unknown[] => {
    if (!Array.isArray(v) || v.length > limit) { issue('INVALID_ARRAY', `배열 형식과 최대 ${limit}개 한도를 확인해 주세요.`, path); return [] }; return v
  }
  const stringList = (v: unknown, path: string, limit: number, check: (value: unknown, at: string) => value is string): string[] => {
    const rows = list(v, path, limit), result: string[] = []
    rows.forEach((value, i) => { if (check(value, `${path}[${i}]`)) result.push(value) })
    if (new Set(result).size !== result.length) issue('DUPLICATE_REFERENCE', '같은 대상을 중복 지정할 수 없습니다.', path)
    return result
  }
  const ids = (v: unknown, path: string, limit: number) => stringList(v, path, limit, identifier)
  const unique = (map: Map<string, Record<string, unknown>>, row: Record<string, unknown>, path: string) => {
    if (identifier(row.id, `${path}.id`)) { if (map.has(row.id)) issue('DUPLICATE_ID', '식별자가 중복되었습니다.', path); else map.set(row.id, row) }
  }
  const b = obj(value, ['schemaVersion', 'id', 'revision', 'schoolId', 'termId', 'sourceFingerprint', 'schoolLevel', 'unsupportedFeatures', 'resources', 'slots', 'lessons', 'courseLoads', 'fixed', 'unavailable', 'preferences'], 'basis')
  if (b.schemaVersion !== 1) issue('UNSUPPORTED_VERSION', '지원하는 입력 계약은 버전 1입니다.', 'basis.schemaVersion')
  for (const key of ['id', 'schoolId', 'termId']) identifier(b[key], `basis.${key}`)
  number(b.revision, 1, Number.MAX_SAFE_INTEGER, 'basis.revision')
  if (typeof b.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(b.sourceFingerprint)) issue('INVALID_FINGERPRINT', '확인한 원본 자료 지문이 필요합니다.', 'basis.sourceFingerprint')
  if (!['primary', 'middle', 'high', 'other'].includes(b.schoolLevel as string)) issue('INVALID_SCHOOL_LEVEL', '학교급을 확인해 주세요.', 'basis.schoolLevel')
  stringList(b.unsupportedFeatures, 'basis.unsupportedFeatures', 100, text)
  const resources = new Map<string, Record<string, unknown>>()
  list(b.resources, 'basis.resources', policy.maxResources).forEach((raw, i) => {
    const path = `basis.resources[${i}]`, r = obj(raw, ['id', 'kind', 'label', 'capacity'], path)
    unique(resources, r, path); text(r.label, `${path}.label`)
    if (!kinds.has(r.kind as string)) issue('UNKNOWN_RESOURCE_KIND', '지원하지 않는 자원 종류입니다.', `${path}.kind`)
    number(r.capacity, 1, policy.maxCapacity, `${path}.capacity`)
    if (['teacher', 'class', 'student_group'].includes(r.kind as string) && r.capacity !== 1) issue('IDENTITY_CAPACITY', '교사·학급·학생 집단은 같은 시간에 한 수업만 참여합니다.', `${path}.capacity`)
  })
  const slots = new Map<string, Record<string, unknown>>()
  const interval = (r: Record<string, unknown>, path: string) => {
    number(r.day, 1, 7, `${path}.day`); number(r.startMinute, 0, 1439, `${path}.startMinute`); number(r.endMinute, 1, 1440, `${path}.endMinute`)
    if (typeof r.startMinute === 'number' && typeof r.endMinute === 'number' && r.startMinute >= r.endMinute) issue('INVALID_INTERVAL', '종료 시각은 시작 시각 뒤여야 합니다.', path)
  }
  list(b.slots, 'basis.slots', policy.maxSlots).forEach((raw, i) => {
    const path = `basis.slots[${i}]`, r = obj(raw, ['id', 'day', 'label', 'startMinute', 'endMinute', 'periods'], path)
    unique(slots, r, path); text(r.label, `${path}.label`); interval(r, path); number(r.periods, 1, policy.maxPeriods, `${path}.periods`)
  })
  const lessons = new Map<string, Record<string, unknown>>(), loads = new Map<string, number>()
  let domainEntries = 0
  list(b.lessons, 'basis.lessons', policy.maxLessons).forEach((raw, i) => {
    const path = `basis.lessons[${i}]`, r = obj(raw, ['id', 'courseId', 'label', 'periods', 'resourceIds', 'allowedSlotIds'], path)
    unique(lessons, r, path); text(r.label, `${path}.label`); identifier(r.courseId, `${path}.courseId`)
    if (number(r.periods, 1, policy.maxPeriods, `${path}.periods`) && typeof r.courseId === 'string') loads.set(r.courseId, (loads.get(r.courseId) ?? 0) + r.periods)
    const resourceIds = ids(r.resourceIds, `${path}.resourceIds`, policy.maxResources), allowed = ids(r.allowedSlotIds, `${path}.allowedSlotIds`, policy.maxSlots)
    if (!resourceIds.length) issue('EMPTY_RESOURCES', '수업에 참여할 교사와 학생 집단을 지정해 주세요.', `${path}.resourceIds`)
    for (const id of resourceIds) if (!resources.has(id)) issue('UNKNOWN_RESOURCE', '존재하지 않는 수업 참여자·자원입니다.', `${path}.resourceIds`)
    if (!resourceIds.some(id => resources.get(id)?.kind === 'teacher')) issue('MISSING_TEACHER', '담당 교사를 먼저 배정해 주세요.', `${path}.resourceIds`)
    if (!resourceIds.some(id => ['class', 'student_group'].includes(resources.get(id)?.kind as string))) issue('MISSING_STUDENTS', '학급 또는 수강 학생 집단을 지정해 주세요.', `${path}.resourceIds`)
    if (!allowed.length) issue('EMPTY_ALLOWED_SLOTS', '허용 시간대를 하나 이상 지정해 주세요.', `${path}.allowedSlotIds`)
    domainEntries += allowed.length
    for (const id of allowed) { const slot = slots.get(id); if (!slot) issue('UNKNOWN_SLOT', '존재하지 않는 시간대입니다.', `${path}.allowedSlotIds`); else if (slot.periods !== r.periods) issue('BLOCK_PERIODS_MISMATCH', '수업 블록 시수와 허용 시간대 시수가 다릅니다.', `${path}.allowedSlotIds`) }
  })
  if (!lessons.size) issue('EMPTY_LESSONS', '편성할 수업을 먼저 입력해 주세요.', 'basis.lessons')
  if (domainEntries > policy.maxDomainEntries) issue('INPUT_LIMIT', '현재 브라우저 편성 한도를 넘습니다. 계산 실행 환경을 확장해야 합니다.', 'basis.lessons')
  const courseIds = new Set<string>()
  list(b.courseLoads, 'basis.courseLoads', policy.maxLessons).forEach((raw, i) => {
    const path = `basis.courseLoads[${i}]`, r = obj(raw, ['courseId', 'periods'], path)
    if (identifier(r.courseId, `${path}.courseId`)) {
      if (courseIds.has(r.courseId)) issue('DUPLICATE_COURSE', '같은 수업의 시수 기준이 중복되었습니다.', path)
      courseIds.add(r.courseId)
      if (number(r.periods, 1, policy.maxCoursePeriods, `${path}.periods`) && loads.get(r.courseId) !== r.periods) issue('COURSE_LOAD_MISMATCH', '기준 시수와 편성할 활동의 시수 합계가 다릅니다.', path)
    }
  })
  for (const courseId of loads.keys()) if (!courseIds.has(courseId)) issue('MISSING_COURSE_LOAD', '수업별 기준 시수가 없습니다.', 'basis.courseLoads')
  const pairs = (raw: unknown, path: string, weighted: boolean) => {
    const r = obj(raw, weighted ? ['lessonId', 'slotId', 'weight'] : ['lessonId', 'slotId'], path)
    identifier(r.lessonId, `${path}.lessonId`); identifier(r.slotId, `${path}.slotId`)
    const l = typeof r.lessonId === 'string' ? lessons.get(r.lessonId) : undefined
    if (!l) issue('UNKNOWN_LESSON', '존재하지 않는 수업 활동입니다.', `${path}.lessonId`)
    if (typeof r.slotId !== 'string' || !slots.has(r.slotId)) issue('UNKNOWN_SLOT', '존재하지 않는 시간대입니다.', `${path}.slotId`)
    if (l && Array.isArray(l.allowedSlotIds) && !l.allowedSlotIds.includes(r.slotId)) issue('SLOT_NOT_ALLOWED', '해당 수업의 허용 시간대가 아닙니다.', path)
    if (weighted) number(r.weight, 0, policy.maxWeight, `${path}.weight`)
    return r
  }
  const fixed = new Set<unknown>(), preferences = new Set<string>()
  list(b.fixed, 'basis.fixed', policy.maxLessons).forEach((raw, i) => { const r = pairs(raw, `basis.fixed[${i}]`, false); if (fixed.has(r.lessonId)) issue('DUPLICATE_FIXED', '같은 수업을 두 번 고정할 수 없습니다.', `basis.fixed[${i}]`); fixed.add(r.lessonId) })
  list(b.preferences, 'basis.preferences', policy.maxConditions).forEach((raw, i) => { const r = pairs(raw, `basis.preferences[${i}]`, true), key = JSON.stringify([r.lessonId, r.slotId]); if (preferences.has(key)) issue('DUPLICATE_PREFERENCE', '같은 배치 선호가 중복되었습니다.', `basis.preferences[${i}]`); preferences.add(key) })
  list(b.unavailable, 'basis.unavailable', policy.maxConditions).forEach((raw, i) => {
    const path = `basis.unavailable[${i}]`, r = obj(raw, ['resourceId', 'day', 'startMinute', 'endMinute'], path)
    identifier(r.resourceId, `${path}.resourceId`)
    if (typeof r.resourceId !== 'string' || !resources.has(r.resourceId)) issue('UNKNOWN_RESOURCE', '존재하지 않는 수업 참여자·자원입니다.', `${path}.resourceId`)
    interval(r, path)
  })
  return { valid: issues.length === 0, issues }
}

/** 탐색의 점유표와 별도로 결과 전체를 재집계한다. */
export function validatePlacements(basis: TimetableBasis, value: unknown): ValidationResult {
  const checked = validateBasis(basis)
  if (!checked.valid) return checked
  if (basis.unsupportedFeatures.length) return { valid: false, issues: basis.unsupportedFeatures.map(feature => ({ code: 'UNSUPPORTED_FEATURE', message: `아직 검사할 수 없는 조건: ${feature}`, path: 'basis.unsupportedFeatures' })) }
  const issues: TimetableIssue[] = [], add = (code: string, message: string, path: string) => { if (issues.length < policy.maxIssues) issues.push({ code, message, path }) }
  if (!Array.isArray(value) || value.length > policy.maxLessons) return { valid: false, issues: [{ code: 'INVALID_PLACEMENTS', message: '시간표 배치 배열을 확인해 주세요.', path: 'placements' }] }
  const lessons = new Map(basis.lessons.map(x => [x.id, x])), slots = new Map(basis.slots.map(x => [x.id, x])), seen = new Set<string>()
  const events = new Map<string, { day: number; time: number; delta: number }[]>(), actualLoads = new Map<string, number>()
  const unavailable = new Map<string, TimetableBasis['unavailable']>()
  for (const row of basis.unavailable) { const rows = unavailable.get(row.resourceId) ?? []; rows.push(row); unavailable.set(row.resourceId, rows) }
  value.forEach((raw, i) => {
    const path = `placements[${i}]`
    if (!own(raw) || Object.keys(raw).length !== 2 || typeof raw.lessonId !== 'string' || typeof raw.slotId !== 'string') { add('INVALID_PLACEMENT', '수업·시간대 식별자만 포함한 배치가 필요합니다.', path); return }
    const lesson = lessons.get(raw.lessonId), slot = slots.get(raw.slotId)
    if (!lesson || !slot) { add('UNKNOWN_PLACEMENT', '배치의 수업 또는 시간대를 찾을 수 없습니다.', path); return }
    if (seen.has(lesson.id)) add('DUPLICATE_LESSON', '같은 수업 활동이 두 번 배치되었습니다.', path)
    seen.add(lesson.id)
    actualLoads.set(lesson.courseId, (actualLoads.get(lesson.courseId) ?? 0) + lesson.periods)
    if (!lesson.allowedSlotIds.includes(slot.id) || slot.periods !== lesson.periods) add('ILLEGAL_SLOT', '허용되지 않은 시간대 또는 블록 시수입니다.', path)
    if (basis.fixed.some(f => f.lessonId === lesson.id && f.slotId !== slot.id)) add('FIXED_VIOLATION', '고정한 수업 시간이 바뀌었습니다.', path)
    for (const id of lesson.resourceIds) {
      if ((unavailable.get(id) ?? []).some(u => overlaps(slot, u))) add('UNAVAILABLE', '참여자 또는 자원이 사용할 수 없는 시간입니다.', path)
      const rows = events.get(id) ?? []; rows.push({ day: slot.day, time: slot.startMinute, delta: 1 }, { day: slot.day, time: slot.endMinute, delta: -1 }); events.set(id, rows)
    }
  })
  for (const lesson of basis.lessons) if (!seen.has(lesson.id)) add('MISSING_LESSON', `아직 배치되지 않은 수업입니다: ${lesson.label}`, 'placements')
  for (const load of basis.courseLoads) if (actualLoads.get(load.courseId) !== load.periods) add('COURSE_LOAD_MISMATCH', '배치 결과의 시수가 기준 시수와 다릅니다.', 'placements')
  for (const resource of basis.resources) {
    const rows = events.get(resource.id) ?? []; rows.sort((a, b) => a.day - b.day || a.time - b.time || a.delta - b.delta)
    let day = 0, count = 0
    for (const row of rows) { if (row.day !== day) { day = row.day; count = 0 }; count += row.delta; if (count > resource.capacity) { add('RESOURCE_COLLISION', `${resource.label}: 실제 시각이 겹치거나 수용 한도를 넘었습니다.`, `resources.${resource.id}`); break } }
  }
  return { valid: issues.length === 0, issues }
}

/** Worker와 주입된 계산기 모두 런타임 결과를 확인한 뒤 화면에 넘긴다. */
export function validateSolveResult(basis: TimetableBasis, value: unknown): boolean {
  const exactKeys = (v: unknown, keys: string[]): v is Record<string, unknown> => own(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
  if (!exactKeys(value, ['status', 'placements', 'issues', 'score', 'stats', 'optimal'])) return false
  if (!['feasible', 'infeasible', 'unknown', 'invalid', 'unsupported'].includes(value.status as string) || value.optimal !== false) return false
  if (!exactKeys(value.stats, ['nodes', 'elapsedMs', 'exhausted']) || !Number.isSafeInteger(value.stats.nodes) || (value.stats.nodes as number) < 0 || (value.stats.nodes as number) > policy.maximumMaxNodes || typeof value.stats.elapsedMs !== 'number' || !Number.isFinite(value.stats.elapsedMs) || value.stats.elapsedMs < 0 || typeof value.stats.exhausted !== 'boolean') return false
  if (value.stats.exhausted !== (value.status === 'infeasible')) return false
  if (!Array.isArray(value.placements) || value.placements.length > policy.maxLessons || !Array.isArray(value.issues) || value.issues.length > policy.maxIssues + 1) return false
  for (const issue of value.issues) {
    if (!exactKeys(issue, ['code', 'message', 'path']) || typeof issue.code !== 'string' || !/^[A-Z_]{1,100}$/.test(issue.code) || typeof issue.message !== 'string' || !issue.message.trim() || issue.message.length > 2000 || typeof issue.path !== 'string' || issue.path.length > 500) return false
  }
  if (value.status === 'feasible') {
    if (value.issues.length || typeof value.score !== 'number' || !Number.isSafeInteger(value.score) || value.score < 0 || !validatePlacements(basis, value.placements).valid) return false
    const weights = new Map<string, Map<string, number>>()
    for (const row of basis.preferences) { const pairs = weights.get(row.lessonId) ?? new Map<string, number>(); pairs.set(row.slotId, row.weight); weights.set(row.lessonId, pairs) }
    const expected = value.placements.reduce((sum: number, row: { lessonId: string; slotId: string }) => sum + (weights.get(row.lessonId)?.get(row.slotId) ?? 0), 0)
    return value.score === expected
  }
  if (value.placements.length || value.score !== null || !value.issues.length) return false
  const checked = validateBasis(basis)
  if (value.status === 'invalid') return true
  if (!checked.valid) return false
  if (value.status === 'unsupported') return basis.unsupportedFeatures.length > 0 && value.issues.every(i => i.code === 'UNSUPPORTED_FEATURE')
  return basis.unsupportedFeatures.length === 0
}
