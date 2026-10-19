import type { Membership } from '../contracts'
import type { FilePolicy, FileReference } from '../files/contracts'

export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled'
export interface TaskInput { title: string; notes: string; dueDate: string }
export interface PersonalTask extends TaskInput { id: string; schoolId: string; ownerMemberId: string; status: TaskStatus; version: number }
export interface UnitInput { label: string; responsibleMemberId: string; contributorMemberIds: string[] }
export interface CollectionInput {
  title: string; instructions: string; dueDate: string; reviewMode: 'none' | 'required'; reviewerMemberId: string
  textLabel: string; textRequired: boolean; numberLabel: string; numberRequired: boolean; units: UnitInput[]
  fileCollection?: { policy: FilePolicy; required: boolean; templates: FileReference[] }
}
export interface CollectionRequest extends CollectionInput { id: string; schoolId: string; managerMemberId: string; status: 'draft' | 'published'; version: number; publishedAt: string | null }
export interface UnitMember { id: string; userId: string; name: string }
export interface CollectionUnit {
  id: string; requestId: string; schoolId: string; label: string; responsibleMemberId: string; members: UnitMember[]
  version: number; currentSubmissionId: string | null; effectiveSubmissionId: string | null
  withdrawnSubmissionIds: string[]; correctionUntil: string; correctionReason: string
}
export interface AnswerInput { text: string; number: number | null; files?: FileReference[] }
export interface CollectionDraft extends AnswerInput { id: string; unitId: string; lastEditorMemberId: string; version: number }
export interface Submission extends AnswerInput {
  id: string; unitId: string; revision: number; submittedBy: string; receiptAt: string; receiptDate: string
  dueSnapshot: string; initiallyLate: boolean; correctionReason: string; previousSubmissionId: string | null
  reviewMode: 'none' | 'required'; requestKey: string
}
export interface ReviewRecord { id: string; unitId: string; submissionId: string; reviewerMemberId: string; decision: 'accepted' | 'changes_requested'; note: string; recordedAt: string }
export interface Supplement { id: string; unitId: string; submissionId: string; dueDate: string; fulfilledSubmissionId: string | null; fulfilledAt: string | null }
export interface Withdrawal { id: string; unitId: string; submissionId: string; actorMemberId: string; reason: string; recordedAt: string }
export interface CommandReceipt { key: string; payload: string; kind: 'task' | 'request' | 'unit' | 'draft' | 'submission'; resourceId: string; result: unknown }
export interface WorkflowSnapshot { schemaVersion: 1; tasks: PersonalTask[]; requests: CollectionRequest[]; units: CollectionUnit[]; drafts: CollectionDraft[]; submissions: Submission[]; reviews: ReviewRecord[]; supplements: Supplement[]; withdrawals: Withdrawal[]; receipts: CommandReceipt[] }
export interface WorkflowContext { members: Membership[]; date: string }
export class WorkflowError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'FORBIDDEN' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_STATE' | 'STORAGE_FAILED', message: string) { super(message); this.name = 'WorkflowError' }
}
