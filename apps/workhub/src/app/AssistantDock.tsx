import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { WorkspaceIcon } from './WorkspaceIcon'

interface Props {
  open: boolean
  fullPage?: boolean
  closeDisabled?: boolean
  contextLabel: string
  onClose: () => void
  children: ReactNode
}

// 닫아도 대화 컴포넌트는 유지한다. 입력·원 요청 번호를 버리거나 다시 전송하지 않는다.
export function AssistantDock({ open, fullPage = false, closeDisabled = false, contextLabel, onClose, children }: Props) {
  const id = useId(), panel = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const innerFocus = useRef<HTMLElement | null>(null)
  const visible = useRef(false)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches)
  const modal = mobile && !fullPage
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1100px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const element = panel.current
    if (!element) return
    if (open || fullPage) {
      const root = element.getRootNode()
      const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
      if (!visible.current && active instanceof HTMLElement && !element.contains(active)) returnTo.current = active
      const focused = visible.current ? innerFocus.current : null
      // 같은 대화를 넓은 화면에서는 옆자리로, 작은 화면에서는 modal로 연다.
      element.close()
      if (modal) element.showModal(); else element.show()
      // 반응형 전환이 사용자가 고른 버튼을 닫기 버튼으로 바꾸지 않게 한다.
      if (focused?.isConnected && element.contains(focused) && focused.getClientRects().length && !focused.matches(':disabled')) focused.focus()
      else close.current?.focus()
      visible.current = true
    } else {
      element.close()
      visible.current = false
      const target = returnTo.current
      if (target?.isConnected && target.getClientRects().length) target.focus()
      else if (target) {
        // 화면 크기가 달라져 원래 버튼이 사라졌으면 현재 보이는 AI 진입점으로 돌아간다.
        const fallback = Array.from(element.closest('.ws-shell')?.querySelectorAll<HTMLElement>('.ws-mobile-ai,.ws-assistant-trigger') ?? []).find(button => button.getClientRects().length)
        fallback?.focus()
      }
      returnTo.current = null
    }
    innerFocus.current = null
    return () => {
      const root = element.getRootNode()
      const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
      innerFocus.current = active instanceof HTMLElement && element.contains(active) ? active : null
      element.close()
    }
  }, [open, modal, fullPage])
  return <dialog ref={panel} className={`ws-ai-dock${fullPage ? ' ws-ai-full' : ''}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); const root = panel.current?.getRootNode(); const focused = root instanceof ShadowRoot ? root.activeElement : document.activeElement; if (!closeDisabled && !(focused instanceof HTMLSelectElement)) onClose() }} onKeyDown={event => {
      if (event.key === 'Escape' && event.target instanceof HTMLSelectElement) { event.stopPropagation(); return }
      if (!fullPage && !mobile && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!closeDisabled) onClose() }
    }}>
    <header className="ws-ai-heading"><div><WorkspaceIcon name="assistant" />{fullPage ? <h1 id={id}>AI 비서</h1> : <h2 id={id}>AI 비서</h2>}</div><button ref={close} type="button" disabled={closeDisabled} aria-label="AI 비서 닫기" onClick={onClose}>✕</button></header>
    {!fullPage && <div className="ws-ai-context"><span>열어 둔 화면</span><strong>{contextLabel}</strong><small>화면 내용은 자동으로 전달되지 않습니다.</small></div>}
    <div className="ws-ai-body" role={fullPage ? 'main' : undefined}>{children}</div>
  </dialog>
}
