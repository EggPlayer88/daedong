import type { ReactNode } from 'react'

// 선택기만 접어 현재 학생의 입력과 서버 응답을 계속 볼 수 있게 한다.
export function TeachingPaneSection({ compact, expanded, summary, children }: {
  compact: boolean
  expanded: boolean
  summary: string
  children: ReactNode
}) {
  return compact
    ? <details className="teaching-pane-selection" open={expanded}><summary>{summary}</summary>{children}</details>
    : <div className="teaching-pane-selection-default">{children}</div>
}
