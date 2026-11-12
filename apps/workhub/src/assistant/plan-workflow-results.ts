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
  if (command.kind === 'navigate') return command.page === ({ message: 'messages', collection: 'collections', timetable: 'timetable',
    intervention: 'timetable', transition: 'schoolAdmin', document: 'documents', guided: 'documents',
    cooperation: 'cooperation', calendar: 'calendar', calendar_batch: 'calendar', teaching: 'students' } as const)[result.kind]
  if (command.kind === 'specialist') return command.task === 'timetableExchange' && result.kind === 'timetable' ||
    command.task === 'timetableSubstitute' && result.kind === 'intervention' || command.task === 'schoolTransition' && result.kind === 'transition' ||
    result.kind === 'teaching' && (command.task === 'teachingRecords' && ['observation_save', 'record_withdraw'].includes(result.action) && result.recordKind !== 'assessment' ||
      command.task === 'teachingAssessment' && ['rubric_save', 'assessment_save', 'record_withdraw'].includes(result.action) && result.recordKind !== 'observation' ||
      command.task === 'teachingActivity' && ['activity_import', 'activity_review', 'activity_correct'].includes(result.action))
  if (command.kind === 'search') return result.kind === 'teaching' ? command.kinds.includes('course')
    : (result.kind === 'message' || result.kind === 'collection' || result.kind === 'document' || result.kind === 'cooperation' || result.kind === 'calendar') && command.kinds.includes(result.kind)
  return false
}
function matchesTarget(result: WorkflowResult, target: WorkflowPlanOrigin['target']): boolean {
  if (!target) return true
  if (target.kind === 'compose') return result.composeId === target.id &&
    (result.kind === 'message' ? result.action === 'start' : result.kind === 'collection' && (result.action === 'create' || result.action === 'update'))
  return result.kind === 'message' ? target.kind === 'message' && result.deliveries.every(row => row.threadId === target.id)
    : result.kind === 'collection' ? target.kind === 'collection' && result.requestId === target.id
      : result.kind === 'document' ? target.kind === 'document' && result.documentId === target.id
        : result.kind === 'cooperation' ? target.kind === 'cooperation' && result.requestId === target.id
          : result.kind === 'calendar' ? target.kind === 'calendar' && result.eventId === target.id
            : result.kind === 'teaching' && target.kind === 'course' && result.courseId === target.id
}
function teachingResource(result: Extract<WorkflowResult, {kind:'teaching'}>): string {
  if (result.action === 'record_withdraw') return result.recordKind!
  return {course_create:'course',roster_import:'course',observation_save:'observation',rubric_save:'rubric',assessment_save:'assessment',activity_review:'activity-item',activity_import:'activity-import',activity_correct:'activity-import'}[result.action]
}
function sameResource(first: WorkflowResult, next: WorkflowResult): boolean {
  if (first.kind !== next.kind) return false
  if (first.kind === 'message' && next.kind === 'message')
    return next.deliveries.every(row => first.deliveries.some(prior => prior.threadId === row.threadId))
  if (first.kind === 'transition' && next.kind === 'transition') return first.recordId === next.recordId
  if (first.kind === 'document' && next.kind === 'document') return first.documentId === next.documentId
  if (first.kind === 'guided' && next.kind === 'guided') return first.templateId === next.templateId && first.responseId === next.responseId
  if (first.kind === 'calendar' && next.kind === 'calendar') return first.eventId === next.eventId
  if (first.kind === 'calendar_batch' && next.kind === 'calendar_batch') return first.prepareId === next.prepareId
  if (first.kind === 'teaching' && next.kind === 'teaching') return first.courseId === next.courseId && teachingResource(first) === teachingResource(next) &&
    (next.action === 'activity_correct' ? next.previousImportId === first.entityId : first.entityId === next.entityId)
  return (first.kind === 'collection' || first.kind === 'timetable' || first.kind === 'intervention' || first.kind === 'cooperation') &&
    (next.kind === 'collection' || next.kind === 'timetable' || next.kind === 'intervention' || next.kind === 'cooperation') && first.requestId === next.requestId
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
  // 별도 유료 답변에서 온 새 문서 초안은 이전에 열었던 문서 화면 요청의 결과로 추정하지 않는다.
  if (!results.length && result.kind === 'document' && result.composeId && origin.target?.kind !== 'compose') return saved
  // 새 작성은 최초 접수에 작성 출처가 필요하다. 이후 공개·제출은 그때 고정한 원본 번호로만 이어진다.
  if (!(origin.target?.kind === 'compose' && results.length) && !matchesTarget(result, origin.target)) return saved
  // 활동 정정은 새 자료 ID를 만든다. 검증된 이전 자료 ID가 직전 접수와 이어질 때만 같은 계보로 기록한다.
  const anchor = result.kind === 'teaching' && ['activity_import', 'activity_correct'].includes(result.action) ? results.at(-1) : results[0]
  if (results.some(prior => prior.key === result.key) || (anchor && !sameResource(anchor, result))) return saved
  return { ...saved, outcomes: { ...saved.outcomes, [step.id]: { kind: 'recorded', results: [...results, result] } } }
}
