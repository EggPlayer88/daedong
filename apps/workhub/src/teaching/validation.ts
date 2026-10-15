import { studentGradeLimit } from './school-limits'
import { TEACHING_CONTRACT, TeachingError, type TeachingScope, type Course, type TeachingCatalog, type CourseSnapshot, type Student, type Rubric, type Observation, type Counseling, type Assessment, type StudentSnapshot, type CounselingSnapshot, type MutationReceipt, type TeachingCommand, type ActivitySnapshot } from './contracts'
import policy from './policy.json'
import { assessmentTotal, validateCriteria, validateScores } from './assessment'

export const invalid = (message = '수업 자료의 형식을 확인해 주세요.'): never => { throw new TeachingError('INVALID_INPUT', message) }
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
export function text(value: unknown, max = 120, allowEmpty = false): string { if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) return invalid(); return value }
export const identifier = (value: unknown): string => /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$/.test(text(value, 160)) ? value as string : invalid()
export function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid() }
export const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid()
export function date(value: unknown): string { const v = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0,10) !== v) return invalid('올바른 날짜를 입력해 주세요.'); return v }
export function optionalDate(value: unknown): string { return value === '' ? '' : date(value) }
export const hash = (value: unknown): string => /^[a-f0-9]{64}$/.test(text(value,64)) ? value as string : invalid()
export const array = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : invalid()
export function unique<T>(values: T[], key: (value: T) => string): T[] { if (new Set(values.map(key)).size !== values.length) return invalid('같은 항목이 중복되어 있습니다.'); return values }
export function range(first: unknown, last: unknown): [string,string] { const a=date(first), b=date(last); if(a>b) return invalid('시작일과 종료일을 확인해 주세요.'); return [a,b] }
function own(v: Record<string,unknown>, scope: TeachingScope) { if (v.schoolId!==scope.schoolId || v.ownerUserId!==scope.ownerUserId) throw new TeachingError('FORBIDDEN','현재 학교와 작성자 범위에 맞지 않는 자료입니다.') }
function base(v: Record<string,unknown>, scope: TeachingScope) { if(v.schoolId!==scope.schoolId) throw new TeachingError('FORBIDDEN','현재 학교의 자료가 아닙니다.'); identifier(v.id); integer(v.version) }
export function envelope(value: unknown, scope: TeachingScope): Record<string,unknown> {
  const v=object(value)
  if(v.contractVersion!==TEACHING_CONTRACT) throw new TeachingError('UNAVAILABLE','수업·학생 자료 연결을 준비하고 있습니다.')
  if(v.schoolId!==scope.schoolId || v.memberId!==scope.memberId || v.ownerUserId!==scope.ownerUserId) throw new TeachingError('FORBIDDEN','현재 학교와 계정의 자료가 아닙니다.')
  return v
}
export function courseValue(value: unknown, scope: TeachingScope): Course { const v=object(value);base(v,scope);text(v.label);identifier(v.termId);identifier(v.subjectId);if(v.assignmentId!==null)identifier(v.assignmentId);range(v.validFrom,v.validThrough);boolean(v.canRecord);boolean(v.canCounsel);boolean(v.canManageRoster);if((v.canRecord||v.canCounsel)&&!v.assignmentId)return invalid();return structuredClone(v) as unknown as Course }
export function catalogResponse(value: unknown, scope: TeachingScope): TeachingCatalog {
  const v=envelope(value,scope);boolean(v.canManageCourses)
  const courses=unique(array(v.courses,policy.limits.catalogEntries).map(c=>courseValue(c,scope)),c=>c.id)
  const terms=unique(array(v.terms,policy.limits.catalogEntries).map(raw=>{const t=object(raw);base(t,scope);text(t.label);range(t.firstDay,t.lastDay);return t}),t=>String(t.id))
  for(const key of ['subjects','approvedTeachers']) unique(array(v[key],policy.limits.catalogEntries).map(raw=>{const r=object(raw);identifier(r.id);text(r.label);return r}),r=>String(r.id))
  const termIds=new Set(terms.map(t=>t.id)), subjectIds=new Set((v.subjects as {id:string}[]).map(s=>s.id))
  if(courses.some(c=>!termIds.has(c.termId)||!subjectIds.has(c.subjectId))) return invalid()
  if(!v.canManageCourses && (v.approvedTeachers as unknown[]).length) return invalid()
  return structuredClone({...v,courses,terms}) as unknown as TeachingCatalog
}
export function studentValue(value: unknown, scope: TeachingScope): Student { const v=object(value);base(v,scope);text(v.schoolStudentKey);text(v.name);integer(v.grade,1,studentGradeLimit);text(v.classLabel,40);integer(v.seatNumber,1,999);identifier(v.enrollmentId);identifier(v.courseMembershipId);range(v.validFrom,v.validThrough);return structuredClone(v) as unknown as Student }
export function rubricValue(value: unknown, scope: TeachingScope, courseId: string): Rubric { const v=object(value);base(v,scope);own(v,scope);if(v.courseId!==courseId)return invalid();identifier(v.revisionId);text(v.label);boolean(v.archived);validateCriteria(v.criteria);return structuredClone(v) as unknown as Rubric }
export function courseResponse(value: unknown, scope: TeachingScope, courseId: string): CourseSnapshot {
  const v=envelope(value,scope);const course=courseValue(v.course,scope);if(course.id!==courseId)return invalid()
  const students=unique(array(v.students,policy.limits.courseStudents).map(s=>studentValue(s,scope)),s=>s.id);unique(students,s=>s.schoolStudentKey);unique(students,s=>s.courseMembershipId)
  const rubrics=unique(array(v.rubrics,policy.limits.catalogEntries).map(r=>rubricValue(r,scope,courseId)),r=>r.id)
  const imports=unique(array(v.imports,policy.limits.importHistory).map(raw=>{const r=object(raw);base(r,scope);own(r,scope);if(r.courseId!==courseId)return invalid();text(r.label);date(r.occurredOn);hash(r.fileHash);activityState(r);for(const k of ['adopted','held','excluded'])integer(r[k],0);return r}),r=>String(r.id))
  return structuredClone({...v,course,students,rubrics,imports}) as unknown as CourseSnapshot
}
function privateRecord(value: unknown, scope: TeachingScope, courseId: string, studentId: string): Record<string,unknown> {const v=object(value);base(v,scope);own(v,scope);if(v.courseId!==courseId||v.studentId!==studentId)return invalid();identifier(v.courseMembershipId);identifier(v.assignmentId);identifier(v.revisionId);date(v.occurredOn);hash(v.contentHash);integer(v.epoch,0);if(!['active','withdrawn'].includes(String(v.state)))return invalid();return v}
export function observationValue(value: unknown, scope: TeachingScope, courseId: string, studentId: string): Observation {const v=privateRecord(value,scope,courseId,studentId);if(v.kind!=='observation')return invalid();boolean(v.sourceReviewRequired);text(v.text,policy.limits.recordCharacters);return structuredClone(v) as unknown as Observation}
export function counselingValue(value: unknown, scope: TeachingScope, courseId: string, studentId: string): Counseling {const v=privateRecord(value,scope,courseId,studentId);if(v.kind!=='counseling')return invalid();text(v.text,policy.limits.recordCharacters);optionalDate(v.followUpOn);return structuredClone(v) as unknown as Counseling}
export function assessmentValue(value: unknown, scope: TeachingScope, courseId: string, studentId: string): Assessment {const v=privateRecord(value,scope,courseId,studentId);boolean(v.sourceReviewRequired);identifier(v.rubricId);identifier(v.rubricRevisionId);text(v.comment,policy.limits.recordCharacters,true);boolean(v.confirmed);const scores=validateScores(v.scores);const calculated=assessmentTotal(scores);if(v.total!==calculated)return invalid('서버 평가 합계가 항목 점수와 다릅니다.');if(v.confirmed&&scores.some(s=>s.state==='unconfirmed'))return invalid();return structuredClone(v) as unknown as Assessment}
export function studentResponse(value: unknown, scope: TeachingScope, courseId: string, studentId: string): StudentSnapshot { const v=envelope(value,scope);if(v.courseId!==courseId||v.studentId!==studentId)return invalid();const observations=unique(array(v.observations,policy.limits.pageRecords).map(r=>observationValue(r,scope,courseId,studentId)),r=>r.id);const assessments=unique(array(v.assessments,policy.limits.pageRecords).map(r=>assessmentValue(r,scope,courseId,studentId)),r=>r.id);if(v.nextCursor!==null)text(v.nextCursor,1024);return structuredClone({...v,observations,assessments}) as unknown as StudentSnapshot }
export function counselingResponse(value: unknown, scope: TeachingScope, courseId: string, studentId: string): CounselingSnapshot {const v=envelope(value,scope);if(v.courseId!==courseId||v.studentId!==studentId)return invalid();const records=unique(array(v.records,policy.limits.pageRecords).map(r=>counselingValue(r,scope,courseId,studentId)),r=>r.id);if(v.nextCursor!==null)text(v.nextCursor,1024);return structuredClone({...v,records}) as unknown as CounselingSnapshot}
export function receiptResponse(value: unknown, scope: TeachingScope, command: TeachingCommand, key: string): MutationReceipt {const v=envelope(value,scope);if(v.requestKey!==key||v.commandKind!==command.kind||!['applied','replayed'].includes(String(v.outcome)))return invalid();identifier(v.entityId);integer(v.version);const expectedId=command.kind==='roster_import'?command.courseId:command.kind==='activity_review'?command.itemId:command.kind==='record_withdraw'?command.recordId:command.kind==='rubric_save'?command.rubricId:'recordId' in command?command.recordId:null;const expectedVersion=command.kind==='course_create'||command.kind==='activity_import'||command.kind==='activity_correct'?1:'expectedVersion' in command?command.expectedVersion+1:1;if(expectedId&&v.entityId!==expectedId||v.version!==expectedVersion||command.kind==='activity_correct'&&v.entityId===command.previousImportId)return invalid();if(typeof v.appliedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.appliedAt)||!Number.isFinite(Date.parse(v.appliedAt)))return invalid();return structuredClone(v) as unknown as MutationReceipt}

export function activityResponse(value: unknown, scope: TeachingScope, courseId: string, importId: string): ActivitySnapshot {
  const v=envelope(value,scope);if(v.courseId!==courseId||v.importId!==importId)return invalid();integer(v.version);activityState(v);if(v.supersedesImportId!==null)identifier(v.supersedesImportId);if(v.supersedesImportId===importId||v.supersededByImportId===importId)return invalid();text(v.label);date(v.occurredOn);text(v.questionVersion);text(v.questionSnapshot,policy.limits.recordCharacters);hash(v.fileHash)
  if(v.kind!=='dilemmas'&&v.kind!=='grading')return invalid()
  const expected=policy.activityProfiles[v.kind];if(!Array.isArray(v.headers)||JSON.stringify(v.headers)!==JSON.stringify(expected))return invalid()
  const items=unique(array(v.items,policy.limits.csvRows).map(raw=>{const r=object(raw);base(r,scope);own(r,scope);if(r.courseId!==courseId||r.importId!==importId)return invalid();integer(r.rowNumber,2,policy.limits.csvRows+1);text(r.alias,policy.limits.cellCharacters,true);if(!Array.isArray(r.values)||r.values.length!==expected.length)return invalid();r.values.forEach(value=>text(value,policy.limits.cellCharacters,true));if(r.alias!==r.values[0]||!['hold','adopt','exclude','withdraw'].includes(String(r.disposition)))return invalid();if(r.disposition==='adopt'){identifier(r.studentId);identifier(r.courseMembershipId)}else if(r.studentId!==null||r.courseMembershipId!==null)return invalid();text(r.reason,2000,true);identifier(r.revisionId);integer(r.mappingVersion,0);return r}),r=>String(r.id));unique(items,r=>String(r.rowNumber))
  return structuredClone({...v,items}) as unknown as ActivitySnapshot
}

export function rubricRevisionResponse(raw:unknown,scope:TeachingScope,courseId:string,rubricId:string,revisionId:string):Rubric{const v=envelope(raw,scope),r=rubricValue(v.rubric,scope,courseId);if(r.id!==rubricId||r.revisionId!==revisionId)return invalid('요청한 평가 기준판과 다른 자료입니다.');return r}

function activityState(v:Record<string,unknown>){if(!['active','superseded'].includes(String(v.state)))return invalid();if(v.state==='active'&&v.supersededByImportId!==null)return invalid();if(v.state==='superseded')identifier(v.supersededByImportId)}
