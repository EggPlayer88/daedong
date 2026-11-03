import { useEffect, useId, useRef, type ReactNode } from 'react'
import { fontLicense } from '../assets/fonts/fontLicense'
import tossfaceLicense from '../assets/fonts/tossface/license'

// 업무 본문에서 분리한 표시 정보다. 학교 선택과 실제 권한 검사는 기존 연결 계층이 담당한다.
export function ServiceInfoDialog({ school, name, connection, tools, onClose, restoreFocus }: { school: string; name: string; connection: ReactNode; tools?: ReactNode; onClose: () => void; restoreFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { element?.close(); restoreFocus() }
  }, [])
  return <dialog ref={dialog} className="ws-service-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose() }}>
    <header><div><h2 id={title}>서비스 정보</h2><p>{school} · {name}</p></div><button type="button" className="ws-sheet-close" aria-label="서비스 정보 닫기" onClick={onClose}>✕</button></header>
    <div className="ws-service-body">
      <section><h3>연결 정보</h3><p>{connection}</p></section>
      {tools}
      <section><h3>글꼴</h3><p>Pretendard · Tossface</p><details><summary>글꼴 라이선스</summary><pre>{fontLicense}{'\n\n'}{tossfaceLicense}</pre></details></section>
    </div>
  </dialog>
}
