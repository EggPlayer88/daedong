import type { CollectionSubmissionGuidance } from './submission-guidance'
import styles from './submission-guidance.css?inline'

const steps = [{ id: 'write', label: '작성' }, { id: 'save', label: '초안 저장' }, { id: 'submit', label: '최종 제출' }] as const

export function CollectionSubmissionGuide({ guidance }: { guidance: CollectionSubmissionGuidance }) {
  const reasons = Array.isArray(guidance?.reasons) ? guidance.reasons.filter(reason => typeof reason === 'string' && reason) : []
  const stage = steps.some(step => step.id === guidance?.stage) ? guidance.stage : 'write'
  const message = typeof guidance?.message === 'string' && guidance.message ? guidance.message : '제출 준비 상태를 다시 확인해 주세요.'
  return <aside className="cs-submission-guide" aria-label="제출 준비 안내">
    <style>{styles}</style>
    <ol aria-label="제출 순서">{steps.map((step, index) => <li key={step.id} aria-current={stage === step.id ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{step.label}</li>)}</ol>
    <p className="csg-message" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <p className="csg-note">초안 저장만으로 제출되지는 않습니다. 최종 제출은 책임 교사만 할 수 있습니다.</p>
    {reasons.length > 1 && <details><summary>제출 전 확인할 사항 {reasons.length - 1}개 더 보기</summary><ul>{reasons.slice(1).map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
  </aside>
}
