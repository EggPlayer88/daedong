import { canonical } from '../services/service-values'
import type { Placement, SaveDraftInput, TimetableBasis, TimetableConditions } from './contracts'

export type TimetableStep = 'basis' | 'conditions' | 'compose' | 'publish'
export interface SavedTimetableDraft { id: string; version: number; commandKey: string }
export interface FlowState {
  step: TimetableStep; pending: boolean; busy: boolean; stale: boolean; conditionPending: boolean
  basisValid: boolean; foundationReady: boolean; canCalculate: boolean; checkingRequired: boolean
  hasPlacements: boolean; valid: boolean; missingCount: number; dirty: boolean; practice: boolean
  canSave: boolean; saved: boolean
}
export interface FlowGuidance { title: string; description: string; target?: TimetableStep | 'handoff'; action?: string }

// 접수증을 현재 편성과 연결할 때는 제목·조건·배치와 기초판을 모두 대조한다.
export function timetableDraftCommand(basis: TimetableBasis, session: { title: string; conditions: TimetableConditions; placements: Placement[] | null }): SaveDraftInput | null {
  if (!session.placements) return null
  return { basisId: basis.id, basisRevision: basis.revision, sourceFingerprint: basis.sourceFingerprint,
    title: session.title.trim(), conditions: session.conditions, placements: session.placements }
}
export function matchesSavedTimetableDraft(saved: SavedTimetableDraft | undefined, command: SaveDraftInput | null): boolean {
  return Boolean(saved && command && saved.commandKey === canonical(command))
}
export function timetableFlowGuidance(s: FlowState): FlowGuidance {
  if (s.pending) return { title: '원래 저장 결과부터 확인해 주세요', description: '입력과 요청 번호를 보관했습니다. 위의 결과 확인 버튼으로 접수 여부를 확인한 뒤 이어서 진행합니다.' }
  if (s.busy) return { title: '진행 중인 작업을 확인하고 있습니다', description: '계산·AI 검토·학교 준비 작업이 끝나면 같은 편성에서 이어갑니다.' }
  if (s.stale) return { title: '학교 기초 자료가 바뀌었습니다', description: '이전 입력을 보관했습니다. 새 기준을 확인한 뒤 다시 준비해야 합니다.', target: 'basis', action: '바뀐 기초 자료 살펴보기' }
  if (s.conditionPending) return { title: '작성 중인 조건을 먼저 마쳐 주세요', description: '아직 반영하지 않은 조건이 있습니다. 검토 후 반영하거나 입력을 비워 주세요.', target: 'conditions', action: '미반영 조건 이어서 작성' }
  if (!s.basisValid || !s.foundationReady) return { title: '기초 자료의 확인 항목을 해결해 주세요', description: '교사·학급·시수·공간과 허용 시간대의 문제를 해결해야 계산할 수 있습니다.', target: 'basis', action: '기초 자료 문제 확인' }
  if (!s.canCalculate) return { title: '함께 지킬 수 없는 조건을 확인해 주세요', description: '필수 조건은 자동으로 풀지 않습니다. 겹치는 시간과 대상을 확인해 조건을 조정해 주세요.', target: 'conditions', action: '충돌 조건 검토하기' }
  if (s.checkingRequired) return { title: '조건 변경 전 배치를 다시 검사해 주세요', description: '기존 배치를 보관했습니다. 새 조건을 적용해 검사한 뒤 조정하거나 다시 계산할 수 있습니다.', target: 'compose', action: '보관 배치 검사하러 가기' }
  if (!s.hasPlacements) {
    if (s.step === 'basis') return { title: '학교 사정과 교사별 조건을 정리해 주세요', description: '필수 조건과 선호 조건을 구분하고, AI 제안도 반영 전에 직접 확인합니다.', target: 'conditions', action: '조건 입력 시작하기' }
    return { title: '계산을 시작할 준비가 되었습니다', description: '배치 만들기는 가능한 배치를 먼저 찾습니다. 최적화 도구로 여러 후보를 비교할 수도 있습니다.', ...(s.step !== 'compose' ? { target: 'compose' as const, action: '생성 화면으로 이동' } : {}) }
  }
  if (!s.valid) return { title: s.missingCount > 0 ? `미배정 수업 ${s.missingCount}개를 마쳐 주세요` : '배치의 충돌을 해결해 주세요', description: '현재 배치는 저장하지 않습니다. 수업을 옮기거나 조건을 검토한 뒤 다시 검사합니다.', target: 'compose', action: '배치 검토 계속하기' }
  if (s.step !== 'publish') return { title: '배치 검사를 통과했습니다', description: '교사·학급별 배치와 선호 점수를 검토하고, 비교할 후보를 보관한 뒤 저장 단계로 이동하세요.', target: 'publish', action: '검토한 배치 저장 단계로' }
  if (s.practice) return { title: '연습 배치를 검토했습니다', description: '연습 결과는 현재 탭에서 비교하거나 파일로 내려받을 수 있습니다. 실제 학교 저장·확정은 실행하지 않습니다.' }
  if (!s.canSave) return { title: '현재 초안 저장 권한을 확인해 주세요', description: '배치와 입력은 유지됩니다. 학교 연결과 현재 담당 권한을 확인한 뒤 저장합니다.' }
  if (s.dirty || !s.saved) return { title: '검토한 편성을 학교 서버에 저장해 주세요', description: '아래 저장 버튼은 새 초안을 만듭니다. 저장이 확인된 뒤 적용 기간과 공개 영향을 검토합니다.' }
  return { title: '저장한 초안의 확정 검토를 시작할 수 있습니다', description: '초안 번호와 판을 확정 화면에 전달합니다. 최신 서버 목록을 다시 확인하며, 이 이동만으로 공개하지 않습니다.', target: 'handoff', action: '저장한 초안으로 확정 검토 열기' }
}
