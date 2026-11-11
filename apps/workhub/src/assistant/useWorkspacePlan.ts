import type { MutableRefObject } from 'react'
import type { Session } from './workspace-model'
import { parseWorkspacePlan } from './workspace-plan'

// 계획은 입력을 다시 고르는 탭 메모리다. 실행·접수증·업무 완료 상태를 대신하지 않는다.
export function useWorkspacePlan({ session, latest, scope, date, active, editable, update, feedback, selected }: {
  session: Session; latest: MutableRefObject<Session>; scope: string; date: string
  active: boolean; editable: boolean; update: (session: Session) => void
  feedback: (error: string, notice?: string) => void; selected: () => void
}) {
  const continuing = Boolean(session.calendarDialogue || session.draftDialogue)
  const candidate = active && !continuing ? parseWorkspacePlan(session.prompt, date) : null
  const saved = session.workspacePlan?.scope === scope ? session.workspacePlan : undefined
  const stale = Boolean(saved && saved.plan.basisDate !== date)
  const blockedSelection = Boolean(active && stale && saved?.selectedId && session.prompt.trim())
  const manageable = editable && active && !continuing
  const selectable = manageable && !stale && !session.prompt.trim()

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
    const step = current.plan.steps.find(item => item.id === id)
    if (!step) return
    update({ ...latest.current, prompt: step.prompt, workspacePlan: { ...current, selectedId: id } })
    selected(); feedback('', '선택한 요청을 입력칸에 준비했습니다.')
  }
  function dismiss() {
    if (!manageable) return
    update({ ...latest.current, workspacePlan: undefined })
    feedback('', '업무 목록을 닫았습니다. 입력과 이미 처리한 업무는 그대로입니다.')
  }
  function restoreOriginal() {
    if (!manageable || !saved || latest.current.prompt.trim()) return
    update({ ...latest.current, prompt: saved.plan.prompt, workspacePlan: undefined })
    selected(); feedback('', '원문을 입력칸에 복원했습니다. 현재 날짜로 다시 검토해 주세요.')
  }
  return { candidate, saved, stale, blockedSelection, selectable, manageable, build, choose, dismiss, restoreOriginal }
}
