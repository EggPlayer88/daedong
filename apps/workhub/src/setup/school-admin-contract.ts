import limits from './assets/school-admin.json'
import { isSetupDate, parseSetupDraft, exportSetupDraft, validateSetupDraft, type SetupDraft } from './contract'

export const SCHOOL_ADMIN_SCHEMA_VERSION = 1 as const
export const SCHOOL_ADMIN_LIMITS = limits
export const SCHOOL_ASSIGNMENT_KINDS = [
  { value: 'homeroom', label: '담임' }, { value: 'department', label: '부서 담당' },
  { value: 'subject', label: '교과 담당' }, { value: 'duty', label: '업무 담당' },
] as const
export type AssignmentKind = typeof SCHOOL_ASSIGNMENT_KINDS[number]['value']
export type SchoolMemberStatus = 'pending' | 'active' | 'suspended' | 'ended' | 'rejected'
export const SCHOOL_MEMBER_LABELS: Record<SchoolMemberStatus, string> = { pending: '승인 대기', active: '재직', suspended: '이용 중지', ended: '소속 종료', rejected: '반려' }
export interface SchoolAdminScope { schoolId: string; memberId: string; userId: string }
export interface SchoolAdminCapabilities { configuration: boolean; memberships: boolean; assignments: boolean }
export type SchoolAdminReadiness = { available: false; reason: 'not_installed' | 'not_configured' | 'forbidden' } | { available: true }
export interface SchoolSubject { id: string; name: string }
export interface SchoolAdminMember { id: string; name: string; status: SchoolMemberStatus; startsOn: string; lastDay: string; version: number }
export interface SchoolAssignment { id: string; memberId: string; kind: AssignmentKind; targetId: string | null; label: string; startsOn: string; lastDay: string; status: 'active' | 'ended'; version: number }
export interface SchoolAdminSnapshot {
  version: number; asOfDate: string; availableYears: number[]; configuration: SetupDraft; subjects: SchoolSubject[]
  memberships: SchoolAdminMember[]; assignments: SchoolAssignment[]; capabilities: SchoolAdminCapabilities
}
export type SchoolAdminCommand =
  | { kind: 'save_configuration'; expectedVersion: number; mode: 'update' | 'create_year'; configuration: SetupDraft; subjects: SchoolSubject[]; reason: string }
  | { kind: 'assign_duty'; expectedVersion: number; schoolYear: number; memberId: string; assignmentKind: AssignmentKind; targetId: string | null; label: string; startsOn: string; lastDay: string; reason: string }
  | { kind: 'end_assignment'; expectedVersion: number; schoolYear: number; assignmentId: string; lastDay: string; reason: string }
  | { kind: 'review_membership'; expectedVersion: number; schoolYear: number; targetMemberId: string; decision: Exclude<SchoolMemberStatus, 'pending'>; startsOn: string; lastDay: string; reason: string }
export interface SchoolAdminReceipt { requestKey: string; kind: SchoolAdminCommand['kind']; version: number; schoolYear: number; recordedAt: string }
export type SchoolAdminFailureCode = 'NOT_READY' | 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'QUERY_FAILED' | 'RESULT_UNKNOWN' | 'CANCELLED'
const failureMessages: Record<SchoolAdminFailureCode, string> = {
  NOT_READY: '학교 관리 기능의 서버 준비가 아직 완료되지 않았습니다.',
  INVALID_INPUT: '입력한 학교 정보·기간·배정을 확인해 주세요.', INVALID_RESPONSE: '학교 관리 응답을 검증하지 못했습니다.',
  FORBIDDEN: '현재 계정에 이 학교 관리 작업 권한이 없습니다.', INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다.',
  NOT_FOUND: '해당 자료가 없거나 현재 학교에서 확인할 수 없습니다.', CONFLICT: '다른 곳에서 먼저 변경했습니다. 내 입력을 유지하고 최신 자료를 비교해 주세요.',
  IDEMPOTENCY_CONFLICT: '같은 요청 번호의 내용이 일치하지 않습니다. 입력과 기존 요청 번호를 보존했습니다.',
  QUERY_FAILED: '학교 관리 서버에 연결하지 못했습니다. 아직 준비되지 않았거나 일시적인 연결 문제일 수 있습니다.',
  RESULT_UNKNOWN: '저장 결과가 아직 확인되지 않았습니다. 입력과 요청 번호를 보존했습니다.', CANCELLED: '계정 또는 학교 연결이 바뀌어 이전 요청의 표시를 중단했습니다.',
}
export class SchoolAdminError extends Error { constructor(public code: SchoolAdminFailureCode) { super(failureMessages[code]); this.name = 'SchoolAdminError' } }
const invalid = (): never => { throw new SchoolAdminError('INVALID_RESPONSE') }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown> }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { const row = object(value); if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalid(); return row }
function text(value: unknown, max: number, empty = false, multiline = false): string { if (typeof value !== 'string' || (!empty && !value.trim()) || Array.from(value).length > max || Array.from(value).some(char => { const code=char.codePointAt(0)!; return code>=0xd800&&code<=0xdfff }) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return invalid(); return value }
export function schoolAdminId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) return invalid(); return value }
export function schoolAdminVersion(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid(); return value as number }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value }
function date(value: unknown): string { if (typeof value !== 'string' || !isSetupDate(value)) return invalid(); return value }
export function schoolAdminYear(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < limits.schoolYearBounds.min || (value as number) > limits.schoolYearBounds.max) return invalid(); return value as number }
function oneOf<T extends string>(value: unknown, options: readonly T[]): T { if (!options.includes(value as T)) return invalid(); return value as T }
function rows<T>(value: unknown, max: number, parse: (row: unknown) => T): T[] { if (!Array.isArray(value) || value.length > max) return invalid(); return value.map(parse) }
function uniqueIds(rows: {id: string}[]) { if (new Set(rows.map(row => row.id)).size !== rows.length) invalid() }
function period(startsOn: string, lastDay: string) { if (startsOn > lastDay) invalid() }
export function schoolAdminInput<T>(read: () => T): T { try { return read() } catch { throw new SchoolAdminError('INVALID_INPUT') } }
function configuration(value: unknown): SetupDraft {
  let draft: SetupDraft
  try { draft = parseSetupDraft(JSON.stringify({ kind: 'school-setup-draft', schemaVersion: 1, deploymentState: 'not_applied', input: value })) } catch { return invalid() }
  if (validateSetupDraft(draft).length) return invalid()
  return draft
}
export function schoolAdminSubjects(value: unknown): SchoolSubject[] {
  const result = rows(value, limits.subjects, item => { const row = exact(item, ['id','name']); return {id: schoolAdminId(row.id), name: text(row.name, 50)} })
  uniqueIds(result)
  if (new Set(result.map(row => row.name.trim())).size !== result.length) invalid()
  return result
}
export function schoolAdminEnvelope(raw: unknown, scope: SchoolAdminScope): unknown {
  const row = object(raw)
  if (row.kind !== 'workhub-school-admin' || row.schemaVersion !== SCHOOL_ADMIN_SCHEMA_VERSION || row.schoolId !== scope.schoolId || row.memberId !== scope.memberId) return invalid()
  if (Object.hasOwn(row, 'error')) {
    exact(row, ['kind','schemaVersion','schoolId','memberId','error'])
    const error = exact(row.error, ['code'])
    const code = oneOf(error.code, ['NOT_READY','INVALID_INPUT','FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT'] as const)
    throw new SchoolAdminError(code)
  }
  return exact(row, ['kind','schemaVersion','schoolId','memberId','data']).data
}
export function schoolAdminReadiness(value: unknown): SchoolAdminReadiness {
  const row = object(value)
  if (row.available === true) { exact(row, ['available']); return {available: true} }
  exact(row, ['available','reason']); if (row.available !== false) return invalid()
  return {available: false, reason: oneOf(row.reason, ['not_installed','not_configured','forbidden'] as const)}
}
export function schoolAdminSnapshot(value: unknown, requestedYear?: number): SchoolAdminSnapshot {
  const row = exact(value, ['version','asOfDate','availableYears','configuration','subjects','memberships','assignments','capabilities'])
  const config = configuration(row.configuration), year = Number(config.schoolYear)
  if (requestedYear !== undefined && year !== requestedYear) return invalid()
  const years = rows(row.availableYears, limits.years, schoolAdminYear)
  if (!years.includes(year) || new Set(years).size !== years.length) return invalid()
  const subjects = schoolAdminSubjects(row.subjects)
  const configIds = new Set([config.draftId,...config.terms.map(x=>x.id),...config.departments.map(x=>x.id),...config.classes.map(x=>x.id)])
  if(subjects.some(item=>configIds.has(item.id))) return invalid()
  const memberships = rows(row.memberships, limits.memberships, value => {
    const item = exact(value, ['id','name','status','startsOn','lastDay','version'])
    const member = {id:schoolAdminId(item.id),name:text(item.name,100),status:oneOf(item.status,['pending','active','suspended','ended','rejected'] as const),startsOn:date(item.startsOn),lastDay:date(item.lastDay),version:schoolAdminVersion(item.version)}
    period(member.startsOn,member.lastDay); return member
  }); uniqueIds(memberships)
  const assignments = rows(row.assignments, limits.assignments, value => {
    const item = exact(value, ['id','memberId','kind','targetId','label','startsOn','lastDay','status','version'])
    const assignment = {id:schoolAdminId(item.id),memberId:schoolAdminId(item.memberId),kind:oneOf(item.kind,SCHOOL_ASSIGNMENT_KINDS.map(kind => kind.value)),targetId:item.targetId === null ? null : schoolAdminId(item.targetId),label:text(item.label,limits.dutyLabelLength),startsOn:date(item.startsOn),lastDay:date(item.lastDay),status:oneOf(item.status,['active','ended'] as const),version:schoolAdminVersion(item.version)}
    period(assignment.startsOn,assignment.lastDay)
    if (!memberships.some(member => member.id === assignment.memberId) || assignment.startsOn < config.startsOn || assignment.lastDay > config.lastDay) return invalid()
    const targets = assignment.kind === 'homeroom' ? config.classes : assignment.kind === 'department' ? config.departments : subjects
    if (assignment.kind === 'duty' ? assignment.targetId !== null : !targets.some(target => target.id === assignment.targetId)) return invalid()
    return assignment
  }); uniqueIds(assignments)
  const capabilities = exact(row.capabilities, ['configuration','memberships','assignments'])
  return {version:schoolAdminVersion(row.version),asOfDate:date(row.asOfDate),availableYears:years,configuration:config,subjects,memberships,assignments,capabilities:{configuration:bool(capabilities.configuration),memberships:bool(capabilities.memberships),assignments:bool(capabilities.assignments)}}
}
export function schoolAdminCommand(value: unknown): SchoolAdminCommand {
  const row = object(value), expectedVersion = schoolAdminVersion(row.expectedVersion), reason = text(row.reason,limits.reasonLength,false,true).trim()
  if (row.kind === 'save_configuration') {
    exact(row,['kind','expectedVersion','mode','configuration','subjects','reason'])
    const config = configuration(row.configuration), subjects = schoolAdminSubjects(row.subjects)
    const ids = [config.draftId,...config.terms.map(x=>x.id),...config.departments.map(x=>x.id),...config.classes.map(x=>x.id),...subjects.map(x=>x.id)]
    if (new Set(ids).size !== ids.length) return invalid()
    return {kind:row.kind,expectedVersion,mode:oneOf(row.mode,['update','create_year'] as const),configuration:config,subjects,reason}
  }
  const schoolYear = schoolAdminYear(row.schoolYear)
  if (row.kind === 'assign_duty') {
    exact(row,['kind','expectedVersion','schoolYear','memberId','assignmentKind','targetId','label','startsOn','lastDay','reason'])
    const startsOn = date(row.startsOn), lastDay = date(row.lastDay); period(startsOn,lastDay)
    const kind = oneOf(row.assignmentKind,SCHOOL_ASSIGNMENT_KINDS.map(item=>item.value)), targetId = row.targetId === null ? null : schoolAdminId(row.targetId)
    if (kind === 'duty' ? targetId !== null : targetId === null) return invalid()
    return {kind:row.kind,expectedVersion,schoolYear,memberId:schoolAdminId(row.memberId),assignmentKind:kind,targetId,label:text(row.label,limits.dutyLabelLength).trim(),startsOn,lastDay,reason}
  }
  if (row.kind === 'end_assignment') {
    exact(row,['kind','expectedVersion','schoolYear','assignmentId','lastDay','reason'])
    return {kind:row.kind,expectedVersion,schoolYear,assignmentId:schoolAdminId(row.assignmentId),lastDay:date(row.lastDay),reason}
  }
  if (row.kind === 'review_membership') {
    exact(row,['kind','expectedVersion','schoolYear','targetMemberId','decision','startsOn','lastDay','reason'])
    const startsOn = date(row.startsOn), lastDay = date(row.lastDay); period(startsOn,lastDay)
    return {kind:row.kind,expectedVersion,schoolYear,targetMemberId:schoolAdminId(row.targetMemberId),decision:oneOf(row.decision,['active','suspended','ended','rejected'] as const),startsOn,lastDay,reason}
  }
  return invalid()
}
// 서버가 확인한 접수증만 완료 근거로 쓴다. 재전송의 과거 접수증은 현재 조회 버전과 구별한다.
export function schoolAdminReceipt(value: unknown, command: SchoolAdminCommand, requestKey: string): SchoolAdminReceipt {
  const row = exact(value,['requestKey','kind','version','schoolYear','recordedAt'])
  const year = command.kind === 'save_configuration' ? Number(command.configuration.schoolYear) : command.schoolYear
  if (row.requestKey !== requestKey || row.kind !== command.kind || row.schoolYear !== year || typeof row.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.recordedAt) || !Number.isFinite(Date.parse(row.recordedAt)) || !isSetupDate(row.recordedAt.slice(0,10))) return invalid()
  const version = schoolAdminVersion(row.version)
  if (version <= command.expectedVersion) return invalid()
  return {requestKey,kind:command.kind,version,schoolYear:year,recordedAt:row.recordedAt}
}
export function cloneSchoolConfiguration(value: SetupDraft): SetupDraft { return parseSetupDraft(exportSetupDraft(value)) }
export interface SchoolAdminServer {
  readiness(memberId: string): Promise<SchoolAdminReadiness>
  get(memberId: string, schoolYear?: number): Promise<SchoolAdminSnapshot>
  mutate(memberId: string, command: SchoolAdminCommand, requestKey: string): Promise<SchoolAdminReceipt>
}
