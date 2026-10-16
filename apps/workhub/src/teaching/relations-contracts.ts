import type { TeachingScope } from './contracts'

export const RELATIONS_CONTRACT = 'teaching-relations.v1' as const
export type RelationKind = 'assignment' | 'course_membership' | 'enrollment'
export type RelationIntentKind = 'assignment_end' | 'assignment_replace' | 'membership_end' | 'student_transfer_out'
export interface TeachingRelation {
  id: string; schoolId: string; version: number; kind: RelationKind
  courseId: string | null; courseLabel: string | null; memberId: string | null; studentId: string | null; enrollmentId: string | null
  label: string; validFrom: string; validThrough: string; effectiveThrough: string | null
}
export interface RelationCapabilities { manageAssignments: boolean; endMemberships: boolean; transferStudents: boolean }
export interface RelationsSnapshot extends TeachingScope {
  contractVersion: typeof RELATIONS_CONTRACT; courseId: string; courseVersion: number; courseLabel: string; basisDate: string
  capabilities: RelationCapabilities; assignments: TeachingRelation[]
  students: { studentId: string; name: string; membership: TeachingRelation; enrollment: TeachingRelation }[]
  approvedTeachers: { memberId: string; label: string; validFrom: string; validThrough: string }[]
}
export interface RelationIntent {
  kind: RelationIntentKind; courseId: string; expectedCourseVersion: number
  relationId: string; expectedRelationVersion: number; studentId: string | null; enrollmentId: string | null
  lastDay: string; replacementMemberId: string | null; reason: string
}
export interface RelationChange extends TeachingRelation { afterThrough: string | null; effect: 'end' | 'cancel_before_start' }
export interface RelationPreview extends TeachingScope {
  contractVersion: typeof RELATIONS_CONTRACT; courseId: string; previewId: string; fingerprint: string; expiresAt: string
  intent: RelationIntent; changes: RelationChange[]
  replacement: { memberId: string; label: string; validFrom: string; validThrough: string } | null
  recordsPreserved: true; historyNotTransferred: true
}
export interface RelationVersion { kind: RelationKind; id: string; version: number }
export interface RelationCommit { previewId: string; previewFingerprint: string; intent: RelationIntent; expectedChanges: RelationVersion[] }
export interface RelationReceipt extends TeachingScope {
  contractVersion: typeof RELATIONS_CONTRACT; previewId: string; previewFingerprint: string; requestKey: string; intentKind: RelationIntentKind
  changes: RelationVersion[]; replacementAssignmentId: string | null; outcome: 'applied' | 'replayed'; appliedAt: string
}
export interface TeachingRelationsAdapter {
  snapshot(memberId: string, courseId: string): Promise<RelationsSnapshot>
  preview(memberId: string, intent: RelationIntent): Promise<RelationPreview>
  commit(memberId: string, command: RelationCommit, requestKey: string): Promise<RelationReceipt>
}
