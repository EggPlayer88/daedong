import { useEffect, useRef, type ReactNode } from 'react'
import type { SearchKind } from '../search/contracts'
import styles from './delivery-workspace.css?inline'

export type DeliveryKind = 'messages' | 'collections' | 'documents'
export interface DeliveryWorkspace {
  scope: string
  kind: DeliveryKind
  key: string
  request?: { key: string; id: string; version?: number }
}
export const deliveryLabels: Record<DeliveryKind, string> = { messages: '메시지 작성·확인', collections: '수합 작성·제출', documents: '문서 작성·파일 생성' }
export const deliveryDraftSlots: Record<DeliveryKind, readonly string[]> = {
  messages: ['messaging-composer'], collections: ['collection-editor'],
  documents: ['document-editor', 'guided-documents'],
}
export function deliveryKind(kind: SearchKind): DeliveryKind | undefined {
  return kind === 'message' ? 'messages' : kind === 'collection' ? 'collections' : kind === 'document' ? 'documents' : undefined
}

// 대화와 업무 편집기는 각각 한 번만 마운트한다. 접어도 원문·요청 번호의 소유자는 바뀌지 않는다.
export function AssistantDeliveryFrame({ workspace, talking, locked, finishDisabled = false, error, onTalk, onResume, onClose, children, chat }: {
  workspace?: DeliveryWorkspace; talking: boolean; locked: boolean; finishDisabled?: boolean
  error?: string
  onTalk: () => void; onResume: () => void; onClose: () => void
  children?: ReactNode; chat: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (workspace && !talking) heading.current?.focus() }, [workspace?.key, talking])
  return <div className="assistant-delivery"><style>{styles}</style>
    {workspace && <header className="assistant-delivery-header">
      <div><span>대화에서 이어서</span><h2 tabIndex={-1} ref={heading}>{deliveryLabels[workspace.kind]}</h2></div>
      <div className="assistant-delivery-controls">
        {talking ? <button type="button" disabled={locked} onClick={onResume}>작성하던 업무 보기</button>
          : <button type="button" disabled={locked} onClick={onTalk}>대화 보기</button>}
        <button type="button" disabled={locked || finishDisabled} onClick={onClose}>작업 마치기</button>
      </div>
    </header>}
    {error && <p className="assistant-delivery-error" role="alert">{error}</p>}
    {workspace && <div className="assistant-delivery-work" hidden={talking}>{children}</div>}
    <div hidden={Boolean(workspace && !talking)}>{chat}</div>
  </div>
}
