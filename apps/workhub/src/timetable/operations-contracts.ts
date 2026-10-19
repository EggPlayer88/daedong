export const TIMETABLE_OPERATIONS_API = 'timetable-operations.v1' as const
export interface OperationTime { startsAt: string; endsAt: string }
export interface OperationTeacher { id: string; name: string }
/** 학생별 자원·개인 사유를 보내지 않는 표시 전용 DTO다. */
export interface OperationLesson {
  id: string; version: number; label: string; time: OperationTime
  teachers: OperationTeacher[]; groupNames: string[]; roomNames: string[]
  state: 'scheduled' | 'performed' | 'cancelled'; canRequest: boolean; allowedTargets: OperationTime[]
}
export interface OperationLessonChange { before: OperationLesson | null; after: OperationLesson }
export interface OperationBlocker { code: string; message: string; lessonIds: string[] }
export interface PublishInput { draftId: string; draftVersion: number; from: string; until: string }
export type ExchangeInput = {
  kind: 'move'; lessonId: string; expectedVersion: number; target: OperationTime; reason: string
} | {
  kind: 'swap'; lessonId: string; expectedVersion: number; otherLessonId: string; otherExpectedVersion: number; reason: string
}
export interface OperationPreviewBase<T> {
  previewId: string; previewHash: string; createdAt: string; expiresAt: string; input: T
  complete: true; changes: OperationLessonChange[]; participants: OperationTeacher[]; blockers: OperationBlocker[]
}
export interface PublishPreview extends OperationPreviewBase<PublishInput> {
  excludedDays: { date: string; reason: string }[]
  preserved: { outsideRange: true; pastRecords: true; existingChanges: 'retained' | 'blocked' }
}
export type ExchangePreview = OperationPreviewBase<ExchangeInput>
export type RequestState = 'awaiting_consent' | 'awaiting_approval' | 'applied' | 'rejected' | 'withdrawn' | 'expired' | 'stale'
export type RequestAction = 'accept' | 'reject' | 'withdraw' | 'approve' | 'rejectApproval'
export interface OperationConsentView extends OperationTeacher { response: 'pending' | 'accepted' | 'rejected'; respondedAt: string | null }
export interface ExchangeRequestView {
  id: string; version: number; proposalHash: string; state: RequestState; kind: 'move' | 'swap'
  requester: OperationTeacher; requesterIsViewer: boolean; createdAt: string; expiresAt: string; reason: string
  changes: OperationLessonChange[]; participants: OperationConsentView[]; actions: RequestAction[]
}
export interface PublicationView { id: string; version: number; title: string; from: string; until: string; publishedAt: string }
export interface PublishDraftChoice { id: string; version: number; title: string }
export interface OperationsView {
  asOf: string; timeZone: string; from: string; until: string; canPublish: boolean; canRequest: boolean
  drafts: PublishDraftChoice[]; lessons: OperationLesson[]; requests: ExchangeRequestView[]; publications: PublicationView[]
}
export type OperationsReadiness = { available: true } | { available: false; reason: 'not_installed' | 'not_allowed' | 'basis_missing' }
export interface PreviewReference<T> { previewId: string; previewHash: string; expiresAt: string; input: T }
export type OperationCommand =
  | { kind: 'publish'; preview: PreviewReference<PublishInput> }
  | { kind: 'submit'; preview: PreviewReference<ExchangeInput> }
  | { kind: 'action'; requestId: string; expectedVersion: number; proposalHash: string; action: RequestAction }
export interface OperationReceipt {
  requestKey: string; commandHash: string; kind: OperationCommand['kind']; entityId: string; version: number
  status: 'published' | RequestState; recordedAt: string; changedLessons: { id: string; version: number }[]
}
export interface TimetableOperationsServer {
  readiness(memberId: string): Promise<OperationsReadiness>
  get(memberId: string, from: string, until: string): Promise<OperationsView>
  previewPublish(memberId: string, input: PublishInput): Promise<PublishPreview>
  previewExchange(memberId: string, input: ExchangeInput): Promise<ExchangePreview>
  execute(memberId: string, command: OperationCommand, requestKey: string): Promise<OperationReceipt>
  recover(memberId: string, command: OperationCommand, requestKey: string): Promise<OperationReceipt>
  /** 조회에서 접수증을 찾지 못한 원키·원문만 명시적으로 다시 보낸다. */
  resend?(memberId: string, command: OperationCommand, requestKey: string): Promise<OperationReceipt>
}
