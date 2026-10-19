import type { TimetableBasis, Placement } from '../../../../packages/timetable/src/types'
export type { TimetableBasis, Placement }
export const TIMETABLE_CONTRACT = 'timetable.v1'
export type TimetableConditions = Pick<TimetableBasis, 'fixed' | 'unavailable' | 'preferences'>
export type TimetableReadiness = { available: true } | { available: false; reason: 'not_installed' | 'basis_missing' | 'not_allowed' }
export interface TimetableDraft {
  id: string; version: number; title: string; basisId: string; basisRevision: number; sourceFingerprint: string
  conditions: TimetableConditions; placements: Placement[]
}
// 이 목록은 서버가 현재 교사의 실제 수업 관계로 제한한다. 상담·결근 사유는 포함하지 않는다.
export interface PublishedLesson {
  id: string; version: number; date: string; startMinute: number; endMinute: number; label: string
  teacherNames: string[]; classNames: string[]; roomNames: string[]; status: 'scheduled' | 'changed' | 'cancelled'
}
export interface TimetableSnapshot {
  basis: TimetableBasis | null; canDesign: boolean; canSave: boolean; drafts: TimetableDraft[]
  weekStart: string; lessons: PublishedLesson[]
}
// 기존 후보를 덮어쓰지 않고 새 초안을 만든다. 재시도만 같은 요청 번호를 사용한다.
export interface SaveDraftInput {
  basisId: string; basisRevision: number; sourceFingerprint: string; title: string
  conditions: TimetableConditions; placements: Placement[]
}
export interface SaveDraftReceipt { requestKey: string; draftId: string; version: number; basisRevision: number }
export interface TimetableServer {
  readiness(memberId: string): Promise<TimetableReadiness>
  get(memberId: string, weekStart: string): Promise<TimetableSnapshot>
  recoverDraft(memberId: string, input: SaveDraftInput, key: string): Promise<SaveDraftReceipt>
  saveDraft(memberId: string, input: SaveDraftInput, key: string): Promise<SaveDraftReceipt>
}
