import type { ReactNode } from 'react'

// 대화에서는 다른 원본 찾기만 접는다. 선택한 입력·검사·오류·접수 확인은 계속 표시한다.
export function DocumentPaneSection({ compact, expanded, summary, children }: {
  compact: boolean
  expanded: boolean
  summary: string
  children: ReactNode
}) {
  return compact
    ? <details className="documents-pane-disclosure" open={expanded}><summary>{summary}</summary>{children}</details>
    : <div className="documents-pane-section">{children}</div>
}
