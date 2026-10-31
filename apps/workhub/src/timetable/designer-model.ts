import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { canonical, ServiceError } from '../services/service-values'
import type { TimetableServer, TimetableBasis, TimetableConditions, Placement } from './contracts'
import { TimetableSolverError, type TimetableSolver } from './worker-client'
import { type SavedTimetableDraft } from './flow'
import { type ConditionBatchState } from './condition-batch'
import type { AssistantServer } from '../assistant/contracts'
import type { PreparationServer } from './preparation'
import type { SetupServer } from './setup'
import type { TargetServer } from './target'
export type Step = 'basis' | 'conditions' | 'compose' | 'publish'
export type ConditionForm = {
  kind: 'fixed' | 'unavailable' | 'preferences'
  targetId: string
  slotId: string
  weight: string
}
export interface DraftSession {
  practice: boolean
  termId?: string
  basisIdentity: string
  title: string
  conditions: TimetableConditions
  placements: Placement[] | null
  previous: Placement[] | null
  dirty: boolean
  form: ConditionForm
  conditionsChanged?: boolean
  lockedLessonIds?: string[]
  placementBasis?: TimetableBasis
  previousBasis?: TimetableBasis
  conditionBatch?: ConditionBatchState
  savedDraft?: SavedTimetableDraft
}
export interface WorkspaceProps {
  connection: SupabaseConnection
  member: Membership
  date: string
  revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onOpenSchoolAdmin?: () => void
  onOpenTeaching?: () => void
  initialLessonId?: string
  initialDate?: string
  initialRequestId?: string
  initialNotificationId?: string
  initialIntent?: { kind: 'makeup'; lessonId: string; token: string }
  initialPreparationStep?: 'target' | 'setup' | 'preparation' | 'import'
}
export interface PanelProps extends Omit<WorkspaceProps, 'connection'> {
  server: TimetableServer
  assistantServer?: AssistantServer
  preparationServer?: PreparationServer
  setupServer?: SetupServer
  targetServer?: TargetServer
  runSolver?: TimetableSolver
  onOpenOperations?: (draft: { id: string; version: number }) => void
  onOpenPublished?: () => void
}
export const days = ['월', '화', '수', '목', '금', '토', '일']
export const steps: { id: Step; label: string }[] = [
  { id: 'basis', label: '기초 자료' },
  { id: 'conditions', label: '조건 정리' },
  { id: 'compose', label: '배치·비교' },
  { id: 'publish', label: '공개 검토' },
]
export const basisIdentity = (basis: TimetableBasis) =>
  canonical([basis.schoolId, basis.termId, basis.id, basis.revision, basis.sourceFingerprint])
export const initialSession = (basis: TimetableBasis, practice: boolean): DraftSession => ({
  practice,
  termId: basis.termId,
  basisIdentity: basisIdentity(basis),
  title: '시간표 초안',
  conditions: {
    fixed: structuredClone(basis.fixed),
    unavailable: structuredClone(basis.unavailable),
    preferences: structuredClone(basis.preferences),
  },
  placements: null,
  previous: null,
  dirty: false,
  form: { kind: 'fixed', targetId: '', slotId: '', weight: '1' },
})
export const timetableClock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export const slotLabel = (basis: TimetableBasis, id: string) => {
  const slot = basis.slots.find((item) => item.id === id)
  return slot
    ? `${days[slot.day - 1]} ${slot.label} · ${timetableClock(slot.startMinute)}–${timetableClock(slot.endMinute)}`
    : '확인되지 않은 시간대'
}
export const conditionLabels = {
  fixed: '반드시 이 시간에',
  unavailable: '사용할 수 없는 시간',
  preferences: '가능하면 피할 시간',
}
export function safeMessage(error: unknown) {
  return error instanceof ServiceError || error instanceof TimetableSolverError
    ? error.message
    : '처리 결과를 확인하지 못했습니다. 입력은 유지했습니다.'
}
export const confirmedRejection = (error: unknown) =>
  error instanceof ServiceError &&
  [
    'FORBIDDEN',
    'INACTIVE_MEMBERSHIP',
    'INVALID_INPUT',
    'NOT_FOUND',
    'CONFLICT',
    'NOT_READY',
  ].includes(error.code)
