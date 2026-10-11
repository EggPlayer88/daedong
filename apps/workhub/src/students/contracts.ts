import type { Membership } from '../contracts'

export interface Period { from: string; until: string }
export interface Student { id: string; schoolId: string; name: string; status: 'enrolled' | 'transferred' }
export interface AcademicClass { id: string; schoolId: string; year: number; label: string }
export interface Enrollment extends Period { id: string; schoolId: string; studentId: string; classId: string; number: number }
export interface Course { id: string; schoolId: string; classId: string; label: string }
export interface TeachingAssignment extends Period { courseId: string; schoolId: string; userId: string; approved: boolean }
export interface CourseMembership extends Period { courseId: string; schoolId: string; studentId: string; enrollmentId: string }
export interface EvidenceRef { sourceId: string; sourceRevision: number; mappingRevision: number }
export interface ObservationDraft {
  studentId: string; enrollmentId: string; courseId: string; observedAt: string; activity: string; content: string; confirmed: boolean
}
export interface ObservationRevision extends ObservationDraft {
  version: number; reason: string; state: 'active' | 'withdrawn'; createdAt: string; source?: EvidenceRef
}
export interface Observation {
  id: string; schoolId: string; authorUserId: string; authorMemberId: string; revisions: ObservationRevision[]
}
export interface ObservationView extends Observation { current: ObservationRevision; needsReview: boolean; studentName: string }
export interface ActivityEvent {
  eventId: string; sourceSystem: string; activityId: string; itemId: string; revision: number
  operation: 'upsert' | 'withdraw' | 'delete'; courseId: string; occurredAt: string
  questionVersion: string; question: string; answer: string; alias: string
}
export interface ActivityRevision extends ActivityEvent { receivedAt: string }
export interface ActivityMapping { studentId: string; enrollmentId: string; revision: number; sourceRevision: number }
export interface SourceItem {
  id: string; schoolId: string; ownerUserId: string; revisions: ActivityRevision[]; mappings: ActivityMapping[]
}
export interface SourceView extends SourceItem { current: ActivityRevision; mapping?: ActivityMapping; state: 'received' | 'mapped' | 'adopted' | 'withdrawn' | 'deleted' }
export interface Receipt { key: string; payload: string; resultId: string }
export interface StudentSnapshot {
  kind: 'synthetic-students-v1'; schemaVersion: 1; serial: number
  students: Student[]; classes: AcademicClass[]; enrollments: Enrollment[]; courses: Course[]
  assignments: TeachingAssignment[]; courseMemberships: CourseMembership[]
  observations: Observation[]; sources: SourceItem[]; receipts: Receipt[]
}
export interface StudentStoreOptions {
  members: Membership[]; date: string; snapshot?: StudentSnapshot; onChange?: (snapshot: StudentSnapshot) => void
}
export type StudentErrorCode = 'INVALID_INPUT' | 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'FORBIDDEN' | 'PERIOD_MISMATCH' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'STALE_SOURCE' | 'DELETED_SOURCE'
export class StudentError extends Error {
  constructor(public code: StudentErrorCode, message: string) { super(message); this.name = 'StudentError' }
}
