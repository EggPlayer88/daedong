import type { OperationBlocker, OperationConsentView, OperationLesson, OperationLessonChange, OperationTeacher, OperationTime, RequestAction, RequestState } from './operations-contracts'

export const INTERVENTIONS_CONTRACT = 'timetable-interventions.v1' as const
export const INTERVENTIONS_LIMITS = { reopenedLessons: 500, summaryItems: 20 } as const
export type InterventionKind = 'substitute' | 'cancel' | 'makeup' | 'reopen'
export type InterventionInput =
  | { kind: 'substitute'; lessonId: string; expectedVersion: number; substituteTeacherId: string; reason: string }
  | { kind: 'cancel'; lessonId: string; expectedVersion: number; reason: string }
  | { kind: 'makeup'; lessonId: string; expectedVersion: number; target: OperationTime; reason: string }
  | { kind: 'reopen'; schoolDayChangeId: string; reason: string }
export interface InterventionClosure { id: string; date: string; reason: string; lessonIds: string[]; reopened: boolean }
export interface InterventionPreview {
  previewId: string; previewHash: string; createdAt: string; expiresAt: string; input: InterventionInput
  complete: true; changes: OperationLessonChange[]; participants: OperationTeacher[]; blockers: OperationBlocker[]
  hours: { removedSeconds: number; addedSeconds: number }
}
export interface InterventionRequest {
  id: string; version: number; proposalHash: string; state: RequestState; kind: InterventionKind; input: InterventionInput
  requester: OperationTeacher; requesterIsViewer: boolean; createdAt: string; expiresAt: string; reason: string
  changes: OperationLessonChange[]; participants: OperationConsentView[]; actions: RequestAction[]
}
export interface InterventionsView {
  asOf: string; timeZone: string; from: string; until: string
  lessons: OperationLesson[]; teachers: OperationTeacher[]; closures: InterventionClosure[]; requests: InterventionRequest[]
}
export type InterventionCommand =
  | { kind: 'submit'; preview: Pick<InterventionPreview, 'previewId' | 'previewHash' | 'expiresAt' | 'input'> }
  | { kind: 'action'; requestId: string; expectedVersion: number; proposalHash: string; action: RequestAction }
export interface InterventionReceipt {
  requestKey: string; commandHash: string; kind: InterventionCommand['kind']; entityId: string; version: number
  status: RequestState; recordedAt: string; changedLessons: { id: string; version: number }[]
}
export type InterventionCloseResult = {
  requestKey: string; commandHash: string; decidedAt: string
} & ({ outcome: 'applied'; receipt: InterventionReceipt } | { outcome: 'closed'; receipt: null })
export type InterventionsReadiness =
  | { available: true; reason: null }
  | { available: false; reason: 'not_configured' | 'not_allowed' | 'approvers_missing' }
export interface InterventionSource {
  kind: 'intervention' | 'exchange' | 'school_day'; requestId: string | null
  schoolDayChangeId: string | null; date: string; lessonId: string | null
}
export interface InterventionsSummary {
  asOf: string; pendingConsent: number; pendingApproval: number; makeupNeeded: number
  items: { id: string; kind: 'consent' | 'approval' | 'makeup'; label: string; date: string; lessonId: string | null; requestId: string | null }[]
}
export type InterventionSummary = InterventionsSummary
export interface TimetableInterventionsServer {
  readiness(memberId: string): Promise<InterventionsReadiness>
  get(memberId: string, from: string, until: string): Promise<InterventionsView>
  preview(memberId: string, input: InterventionInput, source: InterventionsView): Promise<InterventionPreview>
  execute(memberId: string, command: InterventionCommand, requestKey: string): Promise<InterventionReceipt>
  recover(memberId: string, command: InterventionCommand, requestKey: string): Promise<InterventionReceipt>
  close(memberId: string, command: InterventionCommand, requestKey: string): Promise<InterventionCloseResult>
  resolve(memberId: string, sourceId: string): Promise<InterventionSource>
  summary(memberId: string): Promise<InterventionsSummary>
}
