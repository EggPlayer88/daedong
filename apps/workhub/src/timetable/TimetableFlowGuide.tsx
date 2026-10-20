import type { FlowState, TimetableStep } from './flow'
import { timetableFlowGuidance } from './flow'

export function TimetableFlowGuide({ state, onStep, onHandoff, handoffDisabled }: { state: FlowState; onStep: (step: TimetableStep) => void; onHandoff?: () => void; handoffDisabled?: boolean }) {
  const guidance = timetableFlowGuidance(state), target = guidance.target
  const show = target && (target === 'handoff' ? Boolean(onHandoff) : target !== state.step)
  return <section className="timetable-flow-guide" aria-label="편성 다음 단계">
    <div><strong>{guidance.title}</strong><p>{guidance.description}</p></div>
    {show && <button type="button" className="secondary" disabled={state.busy || state.pending || (target === 'handoff' && handoffDisabled)} onClick={() => target === 'handoff' ? onHandoff?.() : onStep(target)}>{guidance.action}</button>}
  </section>
}
