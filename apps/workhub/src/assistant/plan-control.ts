import { validWorkspaceText } from './workspace-commands'
import type { WorkspacePlan } from './workspace-plan'
import type { WorkspaceOperationReceipt } from './workspace-operations'
import type { WorkflowResult } from '../app/workflow-results'

export type WorkspacePlanControl =
  | { kind: 'next' }
  | { kind: 'show' }
  | { kind: 'restore' }
  | { kind: 'dismiss' }
  | { kind: 'choose'; number: number }
export type WorkspacePlanOutcome =
  | { kind: 'opened' }
  | { kind: 'confirmed'; receipt: Pick<WorkspaceOperationReceipt, 'kind' | 'key' | 'id' | 'title' | 'version'> | { kind: 'taskCreate'; key: string; id: string; title: string; version: number } }
  | { kind: 'recorded'; results: WorkflowResult[] }
export interface SavedWorkspacePlan {
  instanceId?: string
  plan: WorkspacePlan
  scope: string
  selectedId?: string
  outcomes?: Record<string, WorkspacePlanOutcome>
}

export function hasWorkspacePlanResult(outcome?: WorkspacePlanOutcome): boolean {
  return outcome?.kind === 'confirmed' || outcome?.kind === 'recorded'
}

const ordinalNumbers: Record<string, number> = { 첫: 1, 첫째: 1, 두: 2, 둘째: 2, 세: 3, 셋째: 3, 네: 4, 넷째: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
const prepare = '(?:\\s*(?:으로|로))?(?:\\s*(?:선택해\\s*줘|선택해\\s*주세요|준비해\\s*줘|준비해\\s*주세요|진행해\\s*줘|진행해\\s*주세요|넘어가\\s*줘|넘어가\\s*주세요))?'

// 목록 조작만 분류한다. 일반 질문·인용·부정문이나 업무 본문은 실행 지시로 해석하지 않는다.
export function parseWorkspacePlanControl(prompt: string): WorkspacePlanControl | null {
  if (typeof prompt !== 'string' || !validWorkspaceText(prompt)) return null
  const text = prompt.trim().replace(/[.!?。！？]+$/, '').trim()
  if (new RegExp(`^다음\\s*(?:업무|단계)${prepare}$`).test(text)) return { kind: 'next' }
  const numbered = new RegExp(`^(\\d+)\\s*(?:번(?:째)?(?:\\s*단계)?|단계)${prepare}$`).exec(text)
  if (numbered) return { kind: 'choose', number: Number(numbered[1]) }
  const ordinal = new RegExp(`^(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\\s*번째(?:\\s*(?:단계|업무))?${prepare}$`).exec(text)
    ?? new RegExp(`^(첫째|둘째|셋째|넷째)(?:\\s*(?:단계|업무))?${prepare}$`).exec(text)
  if (ordinal) return { kind: 'choose', number: ordinalNumbers[ordinal[1]] }
  if (/^(?:업무|단계)\s*목록(?:\s*(?:보여\s*줘|보여\s*주세요|확인|확인해\s*줘|확인해\s*주세요))?$/.test(text)) return { kind: 'show' }
  if (/^(?:전체\s*요청|원문)\s*(?:다시\s*)?(?:검토|복원)(?:해\s*(?:줘|주세요))?$/.test(text)) return { kind: 'restore' }
  if (/^(?:업무|단계)\s*목록\s*(?:닫아\s*줘|닫아\s*주세요|닫기)$/.test(text)) return { kind: 'dismiss' }
  return null
}

export function nextWorkspacePlanStep(saved: SavedWorkspacePlan) {
  const index = saved.plan.steps.findIndex(step => step.id === saved.selectedId)
  if (saved.selectedId && index < 0) return undefined
  return saved.plan.steps.slice(index + 1).find(step => !hasWorkspacePlanResult(saved.outcomes?.[step.id]))
}

// 선택/화면 열기는 서버 완료가 아니다. 확인된 개인 업무의 접수증 요약만 별도로 기록한다.
export function recordWorkspacePlanOutcome(saved: SavedWorkspacePlan | undefined, prompt: string,
  kind: 'opened' | 'confirmed', scope: string, date: string, receipt?: WorkspaceOperationReceipt): SavedWorkspacePlan | undefined {
  if (!saved || saved.scope !== scope || !saved.plan || saved.plan.basisDate !== date || !Array.isArray(saved.plan.steps)) return saved
  const step = saved.plan.steps.find(item => item.id === saved.selectedId)
  if (!step || step.prompt !== prompt || hasWorkspacePlanResult(saved.outcomes?.[step.id])) return saved
  let outcome: WorkspacePlanOutcome
  if (kind === 'opened') outcome = { kind }
  else {
    if (!receipt || !((step.command.kind === 'taskChange' && receipt.kind === 'taskChange') ||
      (step.command.kind === 'calendar' && receipt.kind === 'calendarCreate')) ||
      typeof receipt.key !== 'string' || !receipt.key.trim() || typeof receipt.id !== 'string' || !receipt.id.trim() ||
      typeof receipt.title !== 'string' || !receipt.title.trim() || !Number.isSafeInteger(receipt.version) || receipt.version < 1) return saved
    const { kind: receiptKind, key, id, title, version } = receipt
    outcome = { kind, receipt: { kind: receiptKind, key, id, title, version } }
  }
  return { ...saved, outcomes: { ...saved.outcomes, [step.id]: outcome } }
}
