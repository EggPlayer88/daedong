import type { OperationLessonChange, OperationTime, OperationsView } from './operations-contracts'
import type { OperationReferenceView } from './operations-next-contracts'

export const TIMETABLE_SCHOOL_DAY_API = 'timetable-school-day.v1' as const
/** 교시 ID를 추정하지 않고 현재 실제 수업 시각을 특별일과 시각에 대응시킨다. */
export interface SchoolDayExecutionInput {
  kind: 'closure' | 'special_bells'; date: string; groupIds: string[]; reason: string
  bells: { before: OperationTime; after: OperationTime }[]
}
export interface SchoolDayExecutionPreview {
  input: SchoolDayExecutionInput; sourceAsOf: string; previewId: string; previewHash: string
  createdAt: string; expiresAt: string; complete: true
  coverage: { date: string; groupIds: string[]; complete: true; existingRequests: 'complete' }
  affectedLessons: { lessonId: string; version: number }[]; changes: OperationLessonChange[]
  requestEffects: { requestId: string; version: number; state: 'awaiting_consent' | 'awaiting_approval' | 'applied'; handling: 'blocked' }[]
  blockers: { code: string; message: string }[]
  preserved: { pastRecords: true; outsideTarget: true; existingChanges: 'retained' | 'blocked' }
  lostLessonCount: number; lostSeconds: number; changesActualSchedule: false
}
export interface SchoolDayCommitCommand {
  kind: 'school_day'
  preview: { previewId: string; previewHash: string; expiresAt: string }
  /** 복구 검증용 탭 메모리다. RPC로 전송하지 않는다. */
  context: { view: OperationsView; references: OperationReferenceView; result: SchoolDayExecutionPreview }
}
export interface SchoolDayCommitReceipt {
  requestKey: string; commandHash: string; kind: 'school_day'; entityId: string; version: 1; status: 'applied'
  recordedAt: string; changedLessonCount: number; changesHash: string; lostLessonCount: number
}
export interface SchoolDayExecutionServer {
  preview(memberId: string, input: SchoolDayExecutionInput, view: OperationsView, references: OperationReferenceView): Promise<SchoolDayExecutionPreview>
  execute(memberId: string, command: SchoolDayCommitCommand, requestKey: string): Promise<SchoolDayCommitReceipt>
  recover(memberId: string, command: SchoolDayCommitCommand, requestKey: string): Promise<SchoolDayCommitReceipt>
  /** 조회에서 접수증을 찾지 못한 원키·원문만 명시적으로 다시 보낸다. */
  resend?(memberId: string, command: SchoolDayCommitCommand, requestKey: string): Promise<SchoolDayCommitReceipt>
}
