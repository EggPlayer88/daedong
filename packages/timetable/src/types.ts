/** 주간 편성 계산 계약. 날짜별 실시 수업 ID와 혼용하지 않는다. */
export type ResourceKind = 'teacher' | 'class' | 'student_group' | 'room' | 'equipment'
export interface TimetableResource { id: string; kind: ResourceKind; label: string; capacity: number }
export interface TimetableSlot { id: string; day: number; label: string; startMinute: number; endMinute: number; periods: number }
export interface TimetableLesson { id: string; courseId: string; label: string; periods: number; resourceIds: string[]; allowedSlotIds: string[] }
export interface TimetableBasis {
  schemaVersion: 1; id: string; revision: number; schoolId: string; termId: string; sourceFingerprint: string
  schoolLevel: 'primary' | 'middle' | 'high' | 'other'; unsupportedFeatures: string[]
  resources: TimetableResource[]; slots: TimetableSlot[]; lessons: TimetableLesson[]
  courseLoads: { courseId: string; periods: number }[]
  fixed: { lessonId: string; slotId: string }[]
  unavailable: { resourceId: string; day: number; startMinute: number; endMinute: number }[]
  /** 해당 배치의 비음수 선호 벌점. 값이 작을수록 좋다. */
  preferences: { lessonId: string; slotId: string; weight: number }[]
}
export interface Placement { lessonId: string; slotId: string }
export interface TimetableIssue { code: string; message: string; path: string }
export interface ValidationResult { valid: boolean; issues: TimetableIssue[] }
export interface SolveOptions { maxNodes?: number; maxMs?: number }
export interface SolveResult {
  status: 'feasible' | 'infeasible' | 'unknown' | 'invalid' | 'unsupported'
  placements: Placement[]; issues: TimetableIssue[]; score: number | null
  stats: { nodes: number; elapsedMs: number; exhausted: boolean }; optimal: false
}
