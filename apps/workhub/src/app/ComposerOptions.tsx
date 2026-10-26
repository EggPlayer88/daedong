import { useState, type ReactNode } from 'react'

/** 기존 설정은 처음부터 보여 주고, 내용을 지워도 작성 중인 영역을 접지 않는다. */
export function ComposerOptions({ initialOpen = false, summary, children, className }: { initialOpen?: boolean; summary: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(initialOpen)
  return <details className={className} open={open} onToggle={event => setOpen(event.currentTarget.open)} onInvalidCapture={() => setOpen(true)}>
    <summary>{summary}</summary>{children}
  </details>
}
