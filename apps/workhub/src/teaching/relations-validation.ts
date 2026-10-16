import { TeachingError, type TeachingFailure, type TeachingScope } from './contracts'
import { object, identifier, text, integer, date, range, boolean, array, unique, hash } from './validation'
import { RELATIONS_CONTRACT, type TeachingRelation, type RelationsSnapshot, type RelationIntent, type RelationPreview, type RelationCommit, type RelationReceipt, type RelationVersion } from './relations-contracts'
import policy from './policy.json'

const bad = (message = '담당·수강 관계와 변경 범위를 다시 확인해 주세요.'): never => { throw new TeachingError('INVALID_INPUT', message) }
const envelopeKeys=['contractVersion','schoolId','memberId','ownerUserId']
function dtoKeys(v:Record<string,unknown>,keys:string[]){exact(v,[...envelopeKeys,...keys,...(Object.hasOwn(v,'ok')?['ok']:[])]);if(Object.hasOwn(v,'ok')&&v.ok!==true)bad()}
function exact(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) bad() }
export function relationCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(relationCanonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + relationCanonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export function relationsEnvelope(raw: unknown, scope: TeachingScope) {
  const v = object(raw)
  if (v.contractVersion !== RELATIONS_CONTRACT) throw new TeachingError('UNAVAILABLE', '담당·수강 관계 변경 기능을 준비하고 있습니다. 기존 기록은 계속 확인할 수 있습니다.')
  if (v.schoolId !== scope.schoolId || v.memberId !== scope.memberId || v.ownerUserId !== scope.ownerUserId) throw new TeachingError('FORBIDDEN', '현재 학교와 계정의 관계 자료가 아닙니다.')
  return v
}
export function nextDay(value: string): string { const d = new Date(date(value) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return date(d.toISOString().slice(0,10)) }
function timestamp(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return bad(); date(value.slice(0,10)); return value }
function relation(raw: unknown, scope: TeachingScope, change=false): TeachingRelation {
  const v = object(raw); exact(v,['id','schoolId','version','kind','courseId','courseLabel','memberId','studentId','enrollmentId','label','validFrom','validThrough','effectiveThrough',...(change?['afterThrough','effect']:[])]); identifier(v.id); integer(v.version); text(v.label)
  if (v.schoolId !== scope.schoolId) throw new TeachingError('FORBIDDEN', '다른 학교의 관계가 포함되어 있습니다.')
  range(v.validFrom, v.validThrough)
  if (v.effectiveThrough !== null && (date(v.effectiveThrough) < String(v.validFrom) || String(v.effectiveThrough) > String(v.validThrough))) bad()
  if (v.kind === 'assignment') { identifier(v.courseId); text(v.courseLabel); identifier(v.memberId); if (v.studentId !== null || v.enrollmentId !== null) bad() }
  else if (v.kind === 'course_membership') { identifier(v.courseId); text(v.courseLabel); identifier(v.studentId); identifier(v.enrollmentId); if (v.memberId !== null) bad() }
  else if (v.kind === 'enrollment') { identifier(v.studentId); if (v.memberId !== null || v.courseId !== null || v.courseLabel !== null || v.enrollmentId !== v.id) bad() }
  else bad()
  return structuredClone(v) as unknown as TeachingRelation
}
export function relationsSnapshot(raw: unknown, scope: TeachingScope, courseId: string): RelationsSnapshot {
  const v = relationsEnvelope(raw, scope); dtoKeys(v,['courseId','courseVersion','courseLabel','basisDate','capabilities','assignments','students','approvedTeachers']); if (v.courseId !== courseId) bad(); integer(v.courseVersion); text(v.courseLabel); date(v.basisDate)
  const capabilities = object(v.capabilities); exact(capabilities, ['manageAssignments','endMemberships','transferStudents']); Object.values(capabilities).forEach(boolean)
  const assignments = unique(array(v.assignments, policy.limits.catalogEntries).map(r => relation(r, scope)), r => r.id)
  if (assignments.some(r => r.kind !== 'assignment' || r.courseId !== courseId)) bad()
  const students = unique(array(v.students, policy.limits.courseStudents).map(raw => {
    const s = object(raw); exact(s,['studentId','name','membership','enrollment']); identifier(s.studentId); text(s.name); const membership = relation(s.membership, scope), enrollment = relation(s.enrollment, scope)
    if (membership.kind !== 'course_membership' || membership.courseId !== courseId || enrollment.kind !== 'enrollment' || membership.studentId !== s.studentId || enrollment.studentId !== s.studentId || membership.enrollmentId !== enrollment.id || membership.validFrom < enrollment.validFrom || membership.validThrough > enrollment.validThrough) bad()
    return { studentId: s.studentId as string, name: s.name as string, membership, enrollment }
  }), s => s.studentId)
  unique(students, s => s.membership.id)
  const approvedTeachers = unique(array(v.approvedTeachers, policy.limits.catalogEntries).map(raw => { const t=object(raw); exact(t,['memberId','label','validFrom','validThrough']); identifier(t.memberId); text(t.label); range(t.validFrom,t.validThrough); return t }), t => String(t.memberId))
  if (!capabilities.manageAssignments && approvedTeachers.length) bad()
  return structuredClone({...v, assignments, students, approvedTeachers}) as unknown as RelationsSnapshot
}
export function validateRelationIntent(raw: unknown): RelationIntent {
  const v=object(raw); exact(v,['kind','courseId','expectedCourseVersion','relationId','expectedRelationVersion','studentId','enrollmentId','lastDay','replacementMemberId','reason'])
  identifier(v.courseId); integer(v.expectedCourseVersion); identifier(v.relationId); integer(v.expectedRelationVersion); date(v.lastDay); text(v.reason,policy.limits.relationReasonCharacters)
  if (v.kind === 'assignment_end' || v.kind === 'assignment_replace') {
    if (v.studentId !== null || v.enrollmentId !== null) bad()
    if (v.kind === 'assignment_replace') identifier(v.replacementMemberId); else if (v.replacementMemberId !== null) bad()
  } else if (v.kind === 'membership_end' || v.kind === 'student_transfer_out') {
    identifier(v.studentId); identifier(v.enrollmentId); if (v.replacementMemberId !== null || v.kind === 'student_transfer_out' && v.relationId !== v.enrollmentId) bad()
  } else bad()
  return structuredClone(v) as unknown as RelationIntent
}
export function validateRelationSelection(raw: unknown, snapshot: RelationsSnapshot): RelationIntent {
  const i=validateRelationIntent(raw), assignment=i.kind.startsWith('assignment_'), student=snapshot.students.find(s=>s.studentId===i.studentId)
  if (i.courseId!==snapshot.courseId || i.expectedCourseVersion!==snapshot.courseVersion) throw new TeachingError('CONFLICT','수업 정보가 바뀌었습니다. 최신 관계를 확인하고 다시 미리보기 해 주세요.')
  if (assignment ? !snapshot.capabilities.manageAssignments : i.kind==='membership_end' ? !snapshot.capabilities.endMemberships : !snapshot.capabilities.transferStudents) throw new TeachingError('FORBIDDEN','현재 계정에 이 관계를 변경할 권한이 없습니다.')
  const target=assignment?snapshot.assignments.find(r=>r.id===i.relationId):i.kind==='membership_end'?student?.membership:student?.enrollment
  if (!target || target.id!==i.relationId || target.version!==i.expectedRelationVersion || !assignment&&student?.enrollment.id!==i.enrollmentId) throw new TeachingError('CONFLICT','선택한 관계가 바뀌었습니다. 입력을 유지했으니 최신 관계와 비교해 주세요.')
  if (target.effectiveThrough===null || i.lastDay<snapshot.basisDate || i.lastDay<target.validFrom || i.lastDay>=target.effectiveThrough) return bad('마지막 유효일은 오늘과 시작일 이후이며, 현재 종료일보다 빨라야 합니다. 소급 변경은 별도 확인이 필요합니다.')
  if (i.kind==='assignment_replace') {
    const teacher=snapshot.approvedTeachers.find(t=>t.memberId===i.replacementMemberId), start=nextDay(i.lastDay)
    if (!teacher || teacher.memberId===target.memberId || teacher.validFrom>start || teacher.validThrough<target.effectiveThrough) return bad('새 담당 교사는 다른 교사이며 다음날부터 기존 종료일까지 소속이 유효해야 합니다.')
    if (snapshot.assignments.some(a=>a.memberId===teacher.memberId&&a.effectiveThrough!==null&&a.validFrom<=target.effectiveThrough!&&a.effectiveThrough>=start)) bad('새 담당 교사의 기존 담당 기간과 겹칩니다.')
  }
  return i
}
export function assertRelationPreviewFresh(preview:Pick<RelationPreview,'expiresAt'>,now=Date.now()):void {
  timestamp(preview.expiresAt)
  if(Date.parse(preview.expiresAt)<=now)throw new TeachingError('CONFLICT','미리보기 유효기간이 지났습니다. 입력을 유지했으니 변경 영향을 다시 확인해 주세요.')
}
export function relationsPreview(raw: unknown, scope: TeachingScope, intent: RelationIntent): RelationPreview {
  const v=relationsEnvelope(raw,scope); dtoKeys(v,['courseId','previewId','fingerprint','expiresAt','intent','changes','replacement','recordsPreserved','historyNotTransferred']); identifier(v.previewId); hash(v.fingerprint); timestamp(v.expiresAt); assertRelationPreviewFresh({expiresAt:v.expiresAt as string})
  const normalized=validateRelationIntent(v.intent)
  if (v.courseId!==intent.courseId || relationCanonical(normalized)!==relationCanonical(intent) || v.recordsPreserved!==true || v.historyNotTransferred!==true) bad()
  const changes=unique(array(v.changes,policy.limits.courseStudents+1).map(raw=>{
    const r=relation(raw,scope,true), c=object(raw)
    if (r.effectiveThrough===null || r.effectiveThrough<=intent.lastDay) bad()
    const after=r.validFrom>intent.lastDay?null:intent.lastDay
    if (c.afterThrough!==after || c.effect!==(after===null?'cancel_before_start':'end')) bad()
    return {...r,afterThrough:after,effect:c.effect} as RelationPreview['changes'][number]
  }),r=>r.kind+':'+r.id)
  const target=changes.find(r=>r.id===intent.relationId)
  if (!target || target.version!==intent.expectedRelationVersion || target.afterThrough!==intent.lastDay) return bad()
  if (intent.kind.startsWith('assignment_')) { if (changes.length!==1 || target.kind!=='assignment' || target.courseId!==intent.courseId) bad() }
  else if (intent.kind==='membership_end') { if (changes.length!==1 || target.kind!=='course_membership' || target.courseId!==intent.courseId || target.studentId!==intent.studentId || target.enrollmentId!==intent.enrollmentId) bad() }
  else {
    if (target.kind!=='enrollment' || changes.filter(r=>r.kind==='enrollment').length!==1 || changes.some(r=>!['enrollment','course_membership'].includes(r.kind)||r.studentId!==intent.studentId||r.enrollmentId!==intent.enrollmentId)) bad()
  }
  if (intent.kind==='assignment_replace') {
    const replacement=object(v.replacement); exact(replacement,['memberId','label','validFrom','validThrough']); text(replacement.label); range(replacement.validFrom,replacement.validThrough)
    if (replacement.memberId!==intent.replacementMemberId || replacement.memberId===target.memberId || replacement.validFrom!==nextDay(intent.lastDay) || replacement.validThrough!==target.effectiveThrough) bad()
  } else if (v.replacement!==null) bad()
  return structuredClone({...v,intent:normalized,changes}) as unknown as RelationPreview
}
function versions(raw:unknown):RelationVersion[] { return unique(array(raw,policy.limits.courseStudents+1).map(raw=>{const v=object(raw);exact(v,['kind','id','version']);identifier(v.id);integer(v.version);if(!['assignment','course_membership','enrollment'].includes(String(v.kind)))bad();return structuredClone(v) as unknown as RelationVersion}),v=>v.kind+':'+v.id) }
export function validateRelationCommit(raw:unknown):RelationCommit {
  const v=object(raw);exact(v,['previewId','previewFingerprint','intent','expectedChanges']);identifier(v.previewId);hash(v.previewFingerprint)
  const intent=validateRelationIntent(v.intent),expectedChanges=versions(v.expectedChanges),target=expectedChanges.find(r=>r.id===intent.relationId)
  if(!target||target.version!==intent.expectedRelationVersion)return bad()
  const kind=intent.kind.startsWith('assignment_')?'assignment':intent.kind==='membership_end'?'course_membership':'enrollment'
  if(target.kind!==kind || kind!=='enrollment'&&expectedChanges.length!==1 || kind==='enrollment'&&(expectedChanges.length<1||expectedChanges.filter(r=>r.kind==='enrollment').length!==1||expectedChanges.some(r=>r.kind==='assignment')))bad()
  return {...v,intent,expectedChanges} as unknown as RelationCommit
}
export function relationCommit(preview:RelationPreview):RelationCommit { return validateRelationCommit({previewId:preview.previewId,previewFingerprint:preview.fingerprint,intent:preview.intent,expectedChanges:preview.changes.map(({kind,id,version})=>({kind,id,version}))}) }
export function relationsReceipt(raw:unknown,scope:TeachingScope,command:RelationCommit,key:string):RelationReceipt {
  const v=relationsEnvelope(raw,scope);dtoKeys(v,['previewId','previewFingerprint','requestKey','intentKind','changes','replacementAssignmentId','outcome','appliedAt']);timestamp(v.appliedAt)
  if(v.previewId!==command.previewId||v.previewFingerprint!==command.previewFingerprint||v.requestKey!==key||v.intentKind!==command.intent.kind||!['applied','replayed'].includes(String(v.outcome)))bad()
  const changes=versions(v.changes)
  if(changes.length!==command.expectedChanges.length||command.expectedChanges.some(old=>!changes.some(r=>r.kind===old.kind&&r.id===old.id&&r.version===old.version+1)))bad()
  if(command.intent.kind==='assignment_replace'){identifier(v.replacementAssignmentId);if(command.expectedChanges.some(r=>r.id===v.replacementAssignmentId))bad()}else if(v.replacementAssignmentId!==null)bad()
  return structuredClone({...v,changes}) as unknown as RelationReceipt
}

// 현재 화면이 이미 아는 영향은 누락을 허용하지 않는다. 다른 수업 전체의 완전성은 서버가 보장한다.
export function validateKnownRelationPreview(preview:RelationPreview,snapshot:RelationsSnapshot):RelationPreview {
  const i=validateRelationSelection(preview.intent,snapshot),student=snapshot.students.find(s=>s.studentId===i.studentId)
  const known=i.kind.startsWith('assignment_')?snapshot.assignments.filter(r=>r.id===i.relationId):i.kind==='membership_end'?(student?[student.membership]:[]):student?[student.enrollment,student.membership]:[]
  const semanticKeys=['id','schoolId','version','kind','courseId','memberId','studentId','enrollmentId','validFrom','validThrough','effectiveThrough'] as const
  for(const row of known){
    const changed=preview.changes.find(r=>r.kind===row.kind&&r.id===row.id),affected=row.effectiveThrough!==null&&row.effectiveThrough>i.lastDay
    if(affected&&!changed||!affected&&changed) return bad('미리보기에서 확인한 관계의 영향이 빠졌거나 달라졌습니다. 최신 자료를 다시 확인해 주세요.')
    if(changed&&semanticKeys.some(k=>changed[k]!==row[k]))return bad('미리보기의 관계 정보가 현재 자료와 다릅니다.')
  }
  return preview
}
export function relationFailure(raw:unknown,scope:TeachingScope,binding?:{requestKey:string;commandHash:string}):TeachingFailure {
  const v=relationsEnvelope(raw,scope)
  exact(v,[...envelopeKeys,'ok','code',...(binding?['requestKey','commandHash']:[])])
  if(v.ok!==false||!['UNAVAILABLE','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','QUERY_FAILED'].includes(String(v.code)))return bad()
  if(binding&&(v.requestKey!==binding.requestKey||v.commandHash!==binding.commandHash))return bad()
  return v.code as TeachingFailure
}
