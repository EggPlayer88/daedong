import { useId, useState, type ReactNode } from 'react'
import { recipientLabel, type DeliveryPerson } from './deliveries'

export const messageModeLabels = { direct: '1:1 메시지', group: '함께 보는 단체 대화', individual: '각자에게 개별 전송', reply: '기존 대화에 답장' }

// 접기·펼치기는 표시 상태만 바꾼다. 선택한 명부와 전송용 사본은 기존 작성기가 관리한다.
export function MessageRecipientPicker({ people, peers, mode, disabled, forceOpen = false, readOnly = false, children }: {
  people: readonly DeliveryPerson[]; peers: readonly DeliveryPerson[]
  mode: keyof typeof messageModeLabels; disabled: boolean; forceOpen?: boolean; readOnly?: boolean; children?: ReactNode
}) {
  const selected = Array.isArray(people) ? people : []
  const known = Array.isArray(peers) ? peers : []
  const [editing, setEditing] = useState(selected.length === 0)
  const id = useId()
  const expanded = editing || selected.length === 0 || forceOpen
  const names = selected.map(person => recipientLabel(person, known)).join(', ')
  const summary = <span className="messaging-recipient-summary">
    <span><strong>받는 사람</strong><span>{selected.length}명</span></span>
    <span className="messaging-recipient-names">{names || '받는 사람을 선택해 주세요.'}</span>
    <span className="messaging-recipient-mode">{messageModeLabels[mode]}</span>
  </span>
  return <div className="messaging-recipient-picker">
    {readOnly ? summary : <details className="messaging-recipient-editor" open={expanded}
      onToggle={event => { if (!forceOpen && selected.length > 0) setEditing(event.currentTarget.open) }}>
      <summary aria-controls={id} aria-label={expanded ? '받는 사람 선택 접기' : '받는 사람 변경'} aria-disabled={disabled}
        onClick={event => { if (disabled || forceOpen || selected.length === 0) event.preventDefault() }}>
        {summary}<span className="messaging-recipient-toggle" aria-hidden="true">{expanded ? '선택 중' : '변경'}</span>
      </summary>
      <div id={id} className="messaging-recipient-options">{children}
        <button type="button" className="messaging-recipient-done" disabled={disabled || !selected.length || forceOpen} onClick={() => setEditing(false)}>선택 완료</button>
      </div>
    </details>}
    <p className="messaging-mode-guidance">{mode === 'group' ? '참여자와 답장을 서로 볼 수 있습니다.' : mode === 'individual' ? '받는 사람마다 별도의 대화로 보냅니다.' : mode === 'reply' ? '현재 대화의 참여자에게 보냅니다.' : '선택한 한 명과 대화합니다.'}</p>
  </div>
}
