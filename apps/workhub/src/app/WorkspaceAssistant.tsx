import { useEffect, useId, useRef, useState } from 'react'
import type { PageId, WorkhubModule } from '../modules'
import { WorkspaceIcon } from './WorkspaceIcon'

// Claude 연결 전에는 실제 업무 화면으로 이동하는 안내만 제공한다.
export function WorkspaceAssistant({ modules, onNavigate, locked }: { modules: readonly WorkhubModule[]; onNavigate: (page: PageId) => void; locked: boolean }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLButtonElement>('.icon-button')?.focus()
    return () => { element?.close() }
  }, [open])
  function close(restore = true) { dialog.current?.close(); setOpen(false); if (restore) trigger.current?.focus() }
  return <div className="ws-assistant">
    <button ref={trigger} type="button" className="ws-utility-button ws-assistant-trigger" aria-haspopup="dialog" disabled={locked} onClick={() => setOpen(true)}><WorkspaceIcon name="assistant" /><span>AI 비서</span><small>준비 중</small></button>
    <dialog ref={dialog} className="ws-assistant-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close() }}>
      {open && <><header className="dialog-header"><div><p className="eyebrow">CLAUDE · 연결 준비 중</p><h2 id={`${id}-title`}>AI 비서</h2></div><button type="button" className="icon-button" aria-label="AI 비서 닫기" onClick={() => close()}>✕</button></header>
        <div className="dialog-body"><p className="ws-assistant-intro">학교 규정 확인부터 내 업무 정리까지,<br />이곳에서 요청할 수 있도록 준비하고 있습니다.</p><p className="hint">현재는 대화를 전송하거나 AI 작업을 실행할 수 없습니다.</p>
          <h3>지금 바로 할 수 있는 일</h3><div className="ws-assistant-actions">{modules.filter(module => ['home', 'tasks', 'calendar'].includes(module.id)).map(module => <button type="button" key={module.id} className="ws-assistant-action" disabled={locked} onClick={() => { if (!locked) { close(false); onNavigate(module.id) } }}><WorkspaceIcon name={module.id} /><span>{module.title} 열기</span><span aria-hidden="true">→</span></button>)}</div>
          <p className="hint">이미 등록된 자료는 상단의 ‘업무 찾기’에서 검색할 수 있습니다.</p></div></>}
    </dialog>
  </div>
}
