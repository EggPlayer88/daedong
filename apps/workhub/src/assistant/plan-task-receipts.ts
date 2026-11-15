import type { SavedWorkspacePlan } from './plan-control'
import { hasWorkspacePlanResult } from './plan-control'
import type { TaskReceipt } from './contracts'

// AI 접수 당시의 단계에만 결과를 귀속한다. 다른 대화에서 같은 제목을 썼다는 이유로 합치지 않는다.
export interface TaskPlanOrigin { instanceId: string; stepId: string; prompt: string; scope: string; date: string }
export function captureTaskPlanOrigin(saved: SavedWorkspacePlan | undefined, prompt: string): TaskPlanOrigin | undefined {
  const step = saved?.plan.steps.find(row => row.id === saved.selectedId && row.prompt === prompt && row.command.kind === 'task')
  if (!saved?.instanceId || !step || hasWorkspacePlanResult(saved.outcomes?.[step.id])) return
  return { instanceId: saved.instanceId, stepId: step.id, prompt, scope: saved.scope, date: saved.plan.basisDate }
}
export function recordTaskPlanReceipt(saved: SavedWorkspacePlan | undefined, origin: TaskPlanOrigin | undefined,
  receipt: TaskReceipt, title: string, scope: string, date: string): SavedWorkspacePlan | undefined {
  if (!saved || !origin || saved.instanceId !== origin.instanceId || saved.scope !== origin.scope || scope !== origin.scope ||
      saved.plan.basisDate !== origin.date || date !== origin.date || !title.trim() || !receipt.taskId || !receipt.requestKey ||
      !Number.isSafeInteger(receipt.taskVersion) || receipt.taskVersion < 1) return saved
  const step = saved.plan.steps.find(row => row.id === origin.stepId && row.prompt === origin.prompt && row.command.kind === 'task')
  if (!step || hasWorkspacePlanResult(saved.outcomes?.[step.id])) return saved
  return { ...saved, outcomes: { ...saved.outcomes, [step.id]: { kind: 'confirmed', receipt: {
    kind: 'taskCreate', key: receipt.requestKey, id: receipt.taskId, title, version: receipt.taskVersion,
  } } } }
}
