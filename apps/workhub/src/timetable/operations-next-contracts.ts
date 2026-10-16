import type { ExchangeInput, ExchangePreview, OperationLessonChange, OperationTeacher, OperationTime, OperationsView, PublishInput } from './operations-contracts'

/** 기존 운영 v1의 전체 응답 계약을 느슨하게 만들지 않는 별도 확장이다. */
export const TIMETABLE_OPERATIONS_NEXT_API = 'timetable-operations.next.v1' as const
export interface OperationReferenceView {
  asOf: string; from: string; until: string
  lessons: { lessonId: string; version: number; groups: OperationTeacher[]; rooms: OperationTeacher[] }[]
}
export interface ExchangeRecommendationInput { lessonId: string; expectedVersion: number; reason: string; from: string; until: string }
export interface ExchangeRecommendations {
  input: ExchangeRecommendationInput; sourceAsOf: string; coverage: { from: string; until: string; complete: true }
  status: 'candidates' | 'none_found' | 'search_limited'; explanations: string[]
  candidates: { id: string; explanation: string; input: ExchangeInput; preview: ExchangePreview }[]
}
export interface PublicationManifest {
  previewId: string; previewHash: string; input: PublishInput; timeZone: string; createdAt: string; expiresAt: string; basisFingerprint: string
  manifestHash: string; totalChanges: number; pageSize: number; pageHashes: string[]; blockerCount: number
  complete: true; preserved: { pastRecords: true; outsideRange: true; existingChanges: 'retained' | 'blocked' }
}
export interface PublicationChangePage { previewId: string; manifestHash: string; index: number; pageHash: string; changes: OperationLessonChange[] }
export interface SchoolDayChangeInput {
  kind: 'closure' | 'special_bells'; date: string; groupIds: string[]; reason: string
  bells: { periodId: string; time: OperationTime }[]
}
export interface SchoolDayChangePreview {
  input: SchoolDayChangeInput; sourceAsOf: string; previewId: string; previewHash: string; expiresAt: string
  complete: true; affectedLessons: { lessonId: string; version: number }[]; blockers: { code: string; message: string }[]
  pendingRequests: number; changesActualSchedule: false
}
export interface OperationsExtensions {
  references(memberId: string, view: OperationsView): Promise<OperationReferenceView>
  recommendations(memberId: string, input: ExchangeRecommendationInput, view: OperationsView): Promise<ExchangeRecommendations>
  publicationManifest(memberId: string, input: PublishInput): Promise<PublicationManifest>
  publicationPage(memberId: string, manifest: PublicationManifest, index: number): Promise<PublicationChangePage>
  previewSchoolDay(memberId: string, input: SchoolDayChangeInput, view: OperationsView, references: OperationReferenceView): Promise<SchoolDayChangePreview>
}
