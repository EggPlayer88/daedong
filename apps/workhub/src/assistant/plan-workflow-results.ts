import { copyWorkflowResult, type WorkflowResult } from '../app/workflow-results'
import type { SavedWorkspacePlan } from './plan-control'
import type { WorkspacePlan, WorkspacePlanStep } from './workspace-plan'

export interface WorkflowPlanOrigin {
  plan: WorkspacePlan; stepId: string; prompt: string; scope: string; date: string
  target?: { kind: string; id: string }
}

export function captureWorkflowPlanOrigin(saved: SavedWorkspacePlan | undefined, prompt: string, scope: string, date: string,
  target?: WorkflowPlanOrigin['target']): WorkflowPlanOrigin | undefined {
  if (!saved || saved.scope !== scope || saved.plan.basisDate !== date) return
  const step = saved.plan.steps.find(row => row.id === saved.selectedId && row.prompt === prompt)
  if (!step || (saved.outcomes?.[step.id] && saved.outcomes[step.id].kind !== 'opened')) return
  if ((step.command.kind === 'messageDraft' || step.command.kind === 'collectionDraft') && target?.kind !== 'compose') return
  return { plan: saved.plan, stepId: step.id, prompt, scope, date, target: target ? { ...target } : undefined }
}

function matchesStep(step: WorkspacePlanStep, result: WorkflowResult): boolean {
  const command = step.command
  if (command.kind === 'messageDraft') return result.kind === 'message'
  if (command.kind === 'collectionDraft') return result.kind === 'collection'
  if (command.kind === 'navigate') return command.page === ({ message: 'messages', collection: 'collections', timetable: 'timetable' } as const)[result.kind]
  if (command.kind === 'specialist') return command.task === 'timetableExchange' && result.kind === 'timetable'
  if (command.kind === 'search') return command.kinds.includes(result.kind === 'message' ? 'message' : 'collection') && result.kind !== 'timetable'
  return false
}
function matchesTarget(result: WorkflowResult, target: WorkflowPlanOrigin['target']): boolean {
  if (!target) return true
  if (target.kind === 'compose') return result.composeId === target.id &&
    (result.kind === 'message' ? result.action === 'start' : result.kind === 'collection' && (result.action === 'create' || result.action === 'update'))
  return result.kind === 'message' ? target.kind === 'message' && result.deliveries.every(row => row.threadId === target.id)
    : result.kind === 'collection' && target.kind === 'collection' && result.requestId === target.id
}
function sameResource(first: WorkflowResult, next: WorkflowResult): boolean {
  if (first.kind !== next.kind) return false
  if (first.kind === 'message' && next.kind === 'message')
    return next.deliveries.every(row => first.deliveries.some(prior => prior.threadId === row.threadId))
  return first.kind !== 'message' && next.kind !== 'message' && first.requestId === next.requestId
}

// 시작한 계획 객체와 단계·검색 대상을 고정한다. 새 계획이 같은 번호/문구를 재사용해도 늦은 결과를 받지 않는다.
export function recordWorkflowPlanResult(saved: SavedWorkspacePlan | undefined, origin: WorkflowPlanOrigin,
  raw: WorkflowResult, scope: string, date: string): SavedWorkspacePlan | undefined {
  if (!saved || saved.plan !== origin.plan || saved.scope !== origin.scope || scope !== origin.scope ||
      date !== origin.date || saved.plan.basisDate !== date) return saved
  const step = saved.plan.steps.find(row => row.id === origin.stepId && row.prompt === origin.prompt)
  const result = copyWorkflowResult(raw)
  if (!step || !result || result.scope !== scope || !matchesStep(step, result)) return saved
  const before = saved.outcomes?.[step.id]
  if (before?.kind === 'confirmed') return saved
  const results = before?.kind === 'recorded' ? before.results : []
  // 새 작성은 최초 접수에 작성 출처가 필요하다. 이후 공개·제출은 그때 고정한 원본 번호로만 이어진다.
  if (!(origin.target?.kind === 'compose' && results.length) && !matchesTarget(result, origin.target)) return saved
  if (results.some(prior => prior.key === result.key) || (results.length && !sameResource(results[0], result))) return saved
  return { ...saved, outcomes: { ...saved.outcomes, [step.id]: { kind: 'recorded', results: [...results, result] } } }
}
