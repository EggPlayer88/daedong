import type { useWorkspacePlan } from './useWorkspacePlan'
import styles from './workspace-plan.css?inline'

export function WorkspacePlanCard({ model, hasInput }: { model: ReturnType<typeof useWorkspacePlan>; hasInput: boolean }) {
  const saved = model.saved
  if (!saved) return null
  return <section className="assistant-plan" aria-label="나누어 진행할 업무">
    <style>{styles}</style>
    <header><h3>한 가지씩 진행할게요</h3><button type="button" disabled={!model.manageable} onClick={model.dismiss}>목록 닫기</button></header>
    {model.stale && <p role="status">기준 날짜가 바뀌었습니다. 원문을 다시 검토해 주세요.</p>}
    {model.blockedSelection && <p role="status">선택한 입력은 실행하지 않았습니다. 입력을 비우고 원문을 다시 검토하거나, 목록을 닫은 뒤 현재 날짜로 입력을 확인해 주세요.</p>}
    <ol>{saved.plan.steps.map((step, index) => {
      const outcome = saved.outcomes?.[step.id]
      return <li key={step.id}>
      <button type="button" disabled={!model.selectable || outcome?.kind === 'confirmed'} onClick={() => model.choose(step.id)} aria-label={`${index + 1}단계 선택 · ${step.label}`}>
        <span className="assistant-plan-number">{index + 1}</span><span><strong>{step.label}</strong><span>{step.prompt}</span></span>
        {saved.selectedId === step.id && <small>최근 선택</small>}
      </button>
      {outcome && <div className="assistant-plan-progress" data-outcome={outcome.kind}>
        <strong>{outcome.kind === 'confirmed' ? '서버 처리 확인' : '화면 연결됨'}</strong>
        {outcome.kind === 'confirmed' && <span>{outcome.receipt.title}</span>}
      </div>}
    </li>})}</ol>
    <button type="button" className="assistant-plan-next" disabled={!model.selectable || !model.nextStep} onClick={() => model.nextStep && model.choose(model.nextStep.id)}>다음 단계 준비</button>
    <details><summary>전체 요청 보기</summary><p className="assistant-text">{saved.plan.prompt}</p>
      <button type="button" disabled={!model.manageable || hasInput} onClick={model.restoreOriginal}>원문 다시 검토</button>
    </details>
    <p className="assistant-plan-hint">‘다음 업무’라고 말해도 이어갈 수 있습니다. 단계 선택만으로 실행하지 않습니다.</p>
  </section>
}
