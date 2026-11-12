import type { ReactNode } from 'react'
import styles from './evaluation-workspace.css?inline'

export type EvaluationTarget = 'authoring' | 'submissions'
export type LegacyEvaluationLinks = Partial<Record<EvaluationTarget, string>>
export const evaluationLabels: Record<EvaluationTarget, string> = { authoring: '평가계획서 작성', submissions: '평가계획서 제출' }

// 주소는 사이트의 기존 메뉴 표에서만 공급한다. 대화·AI 응답은 주소를 만들지 않는다.
export function evaluationLink(links: LegacyEvaluationLinks | undefined, target: EvaluationTarget): string | undefined {
  const value = links?.[target]
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f?#]/.test(value)) return undefined
  return value
}

export function EvaluationWorkspace({ links, target, locked = false }: { links?: LegacyEvaluationLinks; target: EvaluationTarget; locked?: boolean }) {
  const href = evaluationLink(links, target)
  let action: ReactNode
  if (!href) action = <p role="status">현재 평가계획서 연결을 사용할 수 없습니다. 기간 업무 표시 상태를 확인한 뒤 다시 요청해 주세요.</p>
  else if (locked) action = <p role="status">진행 중인 요청을 확인한 뒤 열 수 있습니다.</p>
  else action = <a className="assistant-evaluation-open" href={href} target="_blank" rel="noopener noreferrer">{evaluationLabels[target]} 열기 · 새 탭<span aria-hidden="true">↗</span></a>
  return <section className="assistant-evaluation" aria-label="평가계획서 업무 연결">
    <style>{styles}</style>
    <h3>{evaluationLabels[target]}</h3>
    <p>{target === 'authoring' ? '기존 작성 화면에서 교과·학년을 확인하고 계획서를 만듭니다.' : '기존 제출 화면에서 파일·교과·학년을 확인하고 제출합니다.'}</p>
    {action}
    <small>현재 대화는 유지됩니다. AI 요청·파일 생성·제출은 열린 화면에서 직접 확인합니다.</small>
  </section>
}
