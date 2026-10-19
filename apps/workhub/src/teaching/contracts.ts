import type { Membership } from '../contracts'

export const TEACHING_CONTRACT = 'teaching.v1' as const
export type TeachingFailure = 'UNAVAILABLE' | 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'QUERY_FAILED' | 'SAVE_UNCERTAIN' | 'CANCELLED'
export class TeachingError extends Error {
  constructor(public code: TeachingFailure, message: string) { super(message); this.name = 'TeachingError' }
}
export interface TeachingScope { schoolId: string; memberId: string; ownerUserId: string }
export interface Scoped { id: string; schoolId: string; version: number }
export interface Term extends Scoped { label: string; firstDay: string; lastDay: string }
export interface Course extends Scoped { label: string; termId: string; subjectId: string; assignmentId: string | null; validFrom: string; validThrough: string; canRecord: boolean; canCounsel: boolean; canManageRoster: boolean }
export interface TeachingCatalog { contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; courses: Course[]; terms: Term[]; subjects: { id: string; label: string }[]; approvedTeachers: { id: string; label: string }[]; canManageCourses: boolean }
export interface Student extends Scoped { schoolStudentKey: string; name: string; grade: number; classLabel: string; seatNumber: number; enrollmentId: string; courseMembershipId: string; validFrom: string; validThrough: string }
export interface Criterion { key: string; label: string; maximum: number }
export interface Rubric extends Scoped { courseId: string; ownerUserId: string; label: string; revisionId: string; criteria: Criterion[]; archived: boolean }
export interface ActivityImportSummary extends Scoped { state:'active'|'superseded'; supersededByImportId:string|null; courseId: string; ownerUserId: string; label: string; occurredOn: string; fileHash: string; adopted: number; held: number; excluded: number }
export interface CourseSnapshot { contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; course: Course; students: Student[]; rubrics: Rubric[]; imports: ActivityImportSummary[] }
export interface PrivateRecord extends Scoped { ownerUserId: string; courseId: string; studentId: string; courseMembershipId: string; assignmentId: string; revisionId: string; occurredOn: string; text: string; state: 'active' | 'withdrawn'; contentHash: string; epoch: number }
export interface Observation extends PrivateRecord { sourceReviewRequired:boolean;kind: 'observation' }
export interface Counseling extends PrivateRecord { kind: 'counseling'; followUpOn: string }
export type ScoreState = 'scored' | 'absent' | 'missing' | 'unconfirmed'
export interface Score { criterionKey: string; state: ScoreState; points: number | null }
export interface Assessment extends Scoped { sourceReviewRequired:boolean; ownerUserId: string; courseId: string; studentId: string; courseMembershipId: string; assignmentId: string; revisionId: string; rubricId: string; rubricRevisionId: string; occurredOn: string; comment: string; scores: Score[]; confirmed: boolean; state: 'active' | 'withdrawn'; total: number | null; contentHash: string; epoch: number }
export interface StudentSnapshot { contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; courseId: string; studentId: string; observations: Observation[]; assessments: Assessment[]; nextCursor: string | null }
export interface CounselingSnapshot { contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; courseId: string; studentId: string; records: Counseling[]; nextCursor: string | null }
export interface RosterRow { schoolStudentKey: string; name: string; grade: number; classLabel: string; seatNumber: number }
export type ActivityKind = 'dilemmas' | 'grading'
export interface ActivityRow { rowNumber: number; alias: string; values: string[]; disposition: 'hold' | 'adopt' | 'exclude'; studentId: string | null; courseMembershipId: string | null; reason: string }
export interface ActivityImportInput { label: string; occurredOn: string; questionVersion: string; questionSnapshot: string; kind: ActivityKind; parserVersion: 'digital-ethics.csv.v1'; rawCsv: string; fileHash: string; headers: string[]; rows: ActivityRow[]; supersedesImportId: string | null }
export interface ActivityCorrespondence {reason:string;previousRows:{itemId:string;itemVersion:number}[];rows:{rowNumber:number;previousItemId:string|null;reason:string}[];omitted:{itemId:string;reason:string}[]}
export interface ActivityCorrectionCommand {kind:'activity_correct';courseId:string;assignmentId:string;previousImportId:string;expectedVersion:number;expectedFileHash:string;input:ActivityImportInput;correspondence:ActivityCorrespondence}
export type TeachingCommand =
  | ActivityCorrectionCommand
  | { kind: 'course_create'; input: { label: string; termId: string; subjectId: string; teacherMemberIds: string[]; validFrom: string; validThrough: string } }
  | { kind: 'roster_import'; courseId: string; expectedVersion: number; rows: RosterRow[]; validFrom: string; validThrough: string }
  | { kind: 'observation_save' | 'counseling_save'; courseId: string; studentId: string; courseMembershipId: string; assignmentId: string; recordId: string | null; expectedVersion: number; sourceActivity?: { itemId: string; itemVersion: number }; input: { occurredOn: string; text: string; followUpOn: string; reason: string } }
  | { kind: 'record_withdraw'; recordKind: 'observation' | 'counseling' | 'assessment'; courseId: string; studentId: string; recordId: string; expectedVersion: number; reason: string }
  | { kind: 'rubric_save'; courseId: string; rubricId: string | null; expectedVersion: number; label: string; criteria: Criterion[] }
  | { kind: 'assessment_save'; courseId: string; studentId: string; courseMembershipId: string; assignmentId: string; recordId: string | null; expectedVersion: number; rubricId: string; rubricRevisionId: string; occurredOn: string; comment: string; scores: Score[]; confirmed: boolean; reason: string }
  | { kind: 'activity_review'; courseId: string; importId: string; itemId: string; expectedVersion: number; disposition: 'hold' | 'adopt' | 'exclude' | 'withdraw'; studentId: string | null; courseMembershipId: string | null; reason: string }
  | { kind: 'activity_import'; courseId: string; assignmentId: string; expectedVersion: number; input: ActivityImportInput }
export interface ActivityItem extends Scoped { ownerUserId: string; courseId: string; importId: string; rowNumber: number; alias: string; values: string[]; disposition: 'hold' | 'adopt' | 'exclude' | 'withdraw'; studentId: string | null; courseMembershipId: string | null; reason: string; revisionId: string; mappingVersion: number }
export interface ActivitySnapshot { version:number;state:'active'|'superseded';supersedesImportId:string|null;supersededByImportId:string|null; contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; courseId: string; importId: string; label: string; occurredOn: string; questionVersion: string; questionSnapshot: string; kind: ActivityKind; fileHash: string; headers: string[]; items: ActivityItem[] }
export interface MutationReceipt { contractVersion: typeof TEACHING_CONTRACT; schoolId: string; memberId: string; ownerUserId: string; requestKey: string; commandKind: TeachingCommand['kind']; entityId: string; version: number; outcome: 'applied' | 'replayed'; appliedAt: string }
export interface TeachingAdapter {
  catalog(memberId: string): Promise<TeachingCatalog>
  course(memberId: string, courseId: string): Promise<CourseSnapshot>
  student(memberId: string, courseId: string, studentId: string, cursor?: string | null): Promise<StudentSnapshot>
  counseling(memberId: string, courseId: string, studentId: string, cursor?: string | null): Promise<CounselingSnapshot>
  activity(memberId: string, courseId: string, importId: string): Promise<ActivitySnapshot>
  rubricRevision(memberId:string,courseId:string,rubricId:string,revisionId:string):Promise<Rubric>
  mutate(memberId: string, command: TeachingCommand, requestKey: string): Promise<MutationReceipt>
}
export const teachingScope = (member: Membership): TeachingScope => ({ schoolId: member.schoolId, memberId: member.id, ownerUserId: member.userId })
