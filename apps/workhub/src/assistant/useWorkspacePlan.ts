import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Session } from './workspace-model'
import { parseWorkspacePlan } from './workspace-plan'
import { hasWorkspacePlanResult, nextWorkspacePlanStep, parseWorkspacePlanControl, recordWorkspacePlanOutcome } from './plan-control'
import { captureWorkflowPlanOrigin, recordWorkflowPlanResult, type WorkflowPlanOrigin } from './plan-workflow-results'
import type { WorkflowResultListener } from '../app/workflow-results'
import type { WorkspaceOperationReceipt } from './workspace-operations'

// 계획은 탭 메모리다. 화면 연결과 검증된 접수 결과를 구분하며 자동 실행을 만들지 않는다.
export function useWorkspacePlan({ session, latest, scope, date, active, editable, update, feedback, selected }: {
  session: Session; latest: MutableRefObject<Session>; scope: string; date: string
  active: boolean; editable: boolean; update: (session: Session) => void
  feedback: (error: string, notice?: string) => void; selected: () => void
}) {
  const present = useRef({ scope, date, active }), mounted = useRef(true)
  present.current = { scope, date, active }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const continuing = Boolean(session.calendarDialogue || session.draftDialogue)
  const candidate = active && !continuing ? parseWorkspacePlan(session.prompt, date) : null
  const control = active && !continuing ? parseWorkspacePlanControl(session.prompt) : null
  const saved = session.workspacePlan?.scope === scope ? session.workspacePlan : undefined
  const stale = Boolean(saved && saved.plan.basisDate !== date)
  const blockedSelection = Boolean(active && stale && saved?.selectedId && session.prompt.trim() && !control)
  const manageable = editable && active && !continuing
  const selectable = manageable && !stale && !session.prompt.trim()
  const confirmedRestoreMessage = '이미 처리한 단계가 포함되어 있습니다. 전체 요청에서 처리 결과를 확인하고, 남은 업무만 새 요청으로 작성해 주세요.'

  function prepareStep(id: string) {
    const current = latest.current.workspacePlan
    if (!current || current.scope !== scope || current.plan.basisDate !== date) return
    const step = current.plan.steps.find(item => item.id === id)
    if (!step) return
    if (hasWorkspacePlanResult(current.outcomes?.[id])) {
      const resultNotice = current.outcomes?.[id]?.kind === 'recorded' ? '이미 처리 내역을 확인한 단계입니다.' : '이미 서버 처리를 확인한 단계입니다.'
      feedback(resultNotice + ' 처리 결과를 확인하고, 같은 업무가 다시 필요하면 새 요청으로 작성해 주세요.'); return
    }
    update({ ...latest.current, prompt: step.prompt, workspacePlan: { ...current, selectedId: id } })
    selected(); feedback('', '선택한 요청을 입력칸에 준비했습니다.')
  }

  function build(): boolean {
    if (!candidate) return false
    if (!manageable) return true
    if (candidate.kind === 'clarify') { feedback(candidate.message); return true }
    if (latest.current.workspacePlan) {
      feedback('보관한 업무 목록을 먼저 닫아 주세요. 새 요청은 입력칸에 유지했습니다.'); return true
    }
    update({ ...latest.current, prompt: '', workspacePlan: { plan: candidate, scope } })
    selected(); feedback('', '할 일을 나눴습니다. 먼저 할 단계를 선택해 주세요.')
    return true
  }
  function choose(id: string) {
    const current = latest.current.workspacePlan
    if (!selectable || !current || current.scope !== scope || current.plan.basisDate !== date || latest.current.prompt.trim()) return
    prepareStep(id)
  }
  function dismiss() {
    if (!manageable) return
    update({ ...latest.current, workspacePlan: undefined })
    feedback('', '업무 목록을 닫았습니다. 입력과 이미 처리한 업무는 그대로입니다.')
  }
  function restoreOriginal() {
    if (!manageable || !saved || latest.current.prompt.trim()) return
    if (Object.values(saved.outcomes ?? {}).some(hasWorkspacePlanResult)) {
      feedback(confirmedRestoreMessage); return
    }
    update({ ...latest.current, prompt: saved.plan.prompt, workspacePlan: undefined })
    selected(); feedback('', '원문을 입력칸에 복원했습니다. 현재 날짜로 다시 검토해 주세요.')
  }
  function handleControl(): boolean {
    if (!control || continuing || !active) return false
    // 잠금 또는 렌더 이후 입력 변경은 목록 명령으로 우회하지 않는다.
    if (!manageable || latest.current.prompt !== session.prompt) return true
    const current = latest.current.workspacePlan
    if (!current || current.scope !== scope) {
      feedback('보관한 업무 목록이 없습니다. 먼저 여러 업무를 나누어 주세요.'); return true
    }
    if (control.kind === 'show') {
      update({ ...latest.current, prompt: '' })
      feedback('', '보관한 업무 목록을 확인해 주세요. 단계 선택은 요청만 준비합니다.'); return true
    }
    if (control.kind === 'dismiss') {
      update({ ...latest.current, prompt: '', workspacePlan: undefined })
      feedback('', '업무 목록을 닫았습니다. 입력과 이미 처리한 업무는 그대로입니다.'); return true
    }
    if (control.kind === 'restore') {
      if (Object.values(current.outcomes ?? {}).some(hasWorkspacePlanResult)) {
        feedback(confirmedRestoreMessage); return true
      }
      update({ ...latest.current, prompt: current.plan.prompt, workspacePlan: undefined })
      selected(); feedback('', '원문을 입력칸에 복원했습니다. 현재 날짜로 다시 검토해 주세요.'); return true
    }
    if (current.plan.basisDate !== date) {
      feedback('기준 날짜가 바뀌었습니다. 원문을 다시 검토해 주세요.'); return true
    }
    const step = control.kind === 'next' ? nextWorkspacePlanStep(current)
      : Number.isSafeInteger(control.number) && control.number > 0 ? current.plan.steps[control.number - 1] : undefined
    if (!step) {
      if (control.kind === 'next') feedback('', '마지막 단계입니다. 각 업무의 처리 결과를 확인해 주세요.')
      else feedback(`이 목록은 ${current.plan.steps.length}단계까지 있습니다. 단계 번호를 확인해 주세요.`)
      return true
    }
    prepareStep(step.id)
    return true
  }
  function mark(prompt: string, kind: 'opened' | 'confirmed', receipt?: WorkspaceOperationReceipt) {
    if (!active) return
    try {
      const before = latest.current.workspacePlan
      const next = recordWorkspacePlanOutcome(before, prompt, kind, scope, date, receipt)
      if (next !== before) update({ ...latest.current, workspacePlan: next })
    } catch {
      // 보조 목록 표시 실패로 이미 받은 서버 접수 결과를 미확정으로 바꾸지 않는다.
    }
  }
  function resultListener(prompt: string, target?: WorkflowPlanOrigin['target']): WorkflowResultListener | undefined {
    if (!active) return
    const origin = captureWorkflowPlanOrigin(latest.current.workspacePlan, prompt, scope, date, target)
    if (!origin) return
    return result => {
      const current = present.current
      if (!mounted.current || !current.active) return
      try {
        const before = latest.current.workspacePlan
        const next = recordWorkflowPlanResult(before, origin, result, current.scope, current.date)
        if (next !== before) update({ ...latest.current, workspacePlan: next })
      } catch {
        // 보조 이력 기록 실패는 이미 확인된 전송·제출·승인 결과에 영향을 주지 않는다.
      }
    }
  }
  const nextStep = saved ? nextWorkspacePlanStep(saved) : undefined
  return { candidate, control, saved, stale, blockedSelection, selectable, manageable, nextStep, build, choose, dismiss, restoreOriginal, handleControl, mark, resultListener }
}
