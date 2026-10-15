import type { FilePolicy, FileReference } from '../files/contracts'
import type { CollectionInput, CollectionRequest, CollectionUnit, CollectionDraft, Submission, ReviewRecord, Supplement, Withdrawal, AnswerInput } from '../workflows/types'

// R1 호환 계약이다. 권한과 접수 시각은 서버가 결정하며 프리뷰 store를 재실행하지 않는다.
export const COLLECTION_CONTRACT_VERSION = 1 as const
export interface CollectionReadiness { available: boolean; reason: 'ready' | 'database_missing' | 'storage_missing' | 'verification_missing' | 'policy_missing'; policy: FilePolicy | null }
export interface CollectionList { items: CollectionRequest[]; nextCursor: string | null }
export interface CollectionDetail { request: CollectionRequest; units: CollectionUnit[]; submissions: Submission[]; reviews: ReviewRecord[]; supplements: Supplement[]; withdrawals: Withdrawal[] }
export type CollectionCommand =
  | { kind: 'create'; input: CollectionInput }
  | { kind: 'update'; requestId: string; expectedVersion: number; input: CollectionInput }
  | { kind: 'publish'; requestId: string; expectedVersion: number }
  | { kind: 'save_draft'; requestId: string; unitId: string; expectedVersion: number; input: AnswerInput }
  | { kind: 'submit'; requestId: string; unitId: string; draftId: string; expectedDraftVersion: number; expectedVersion: number; reason: string; correctionRequestId?: string }
  | { kind: 'review'; requestId: string; unitId: string; submissionId: string; expectedVersion: number; decision: 'accepted' | 'changes_requested'; note: string; dueDate: string }
  | { kind: 'withdraw'; requestId: string; unitId: string; submissionId: string; expectedVersion: number; reason: string }
  | { kind: 'open_correction'; requestId: string; unitId: string; expectedVersion: number; dueDate: string; reason: string }
export interface CollectionReceipt { requestId: string; resourceId: string; resourceVersion: number; recordedAt: string; requestKey: string }
export type CollectionFileParent =
  | { kind: 'template'; requestId: string; version: number }
  | { kind: 'draft'; requestId: string; unitId: string; version: number }
  | { kind: 'submission'; requestId: string; unitId: string; submissionId: string }
export type CollectionFileState = 'awaiting_upload' | 'pending_verification' | 'ready' | 'rejected'
export interface CollectionUpload { fileId: string; bucket: string; path: string; expiresAt: string; state: CollectionFileState }
export interface CollectionFileStatus { fileId: string; state: CollectionFileState; file: FileReference | null }
export interface CollectionServer {
  readiness(memberId: string): Promise<CollectionReadiness>
  list(memberId: string, cursor?: string): Promise<CollectionList>
  detail(memberId: string, requestId: string): Promise<CollectionDetail>
  draft(memberId: string, requestId: string, unitId: string): Promise<CollectionDraft | null>
  mutate(memberId: string, command: CollectionCommand, requestKey: string): Promise<CollectionReceipt>
  prepareUpload(memberId: string, parent: CollectionFileParent, file: File, policy: FilePolicy, requestKey: string): Promise<CollectionUpload>
  upload(memberId: string, intent: CollectionUpload, file: File): Promise<void>
  completeUpload(memberId: string, fileId: string, requestKey: string): Promise<CollectionFileStatus>
  fileStatus(memberId: string, fileId: string): Promise<CollectionFileStatus>
  download(memberId: string, parent: CollectionFileParent, file: FileReference): Promise<Blob>
}
export type CollectionFailureCode = 'NOT_READY' | 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'QUERY_FAILED' | 'RESULT_UNKNOWN' | 'CANCELLED' | 'FILE_NOT_READY' | 'FILE_FAILED'
export class CollectionServerError extends Error {
  constructor(readonly code: CollectionFailureCode, message: string) { super(message); this.name = 'CollectionServerError' }
}
