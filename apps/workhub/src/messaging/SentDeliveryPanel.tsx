import { useId, useState } from 'react'
import { recipientLabel, type SentDeliveryRecord } from './deliveries'

export function SentDeliveryPanel({ record, disabled, hasDraft, onOpen, onDismiss }: {
  record: SentDeliveryRecord; disabled: boolean; hasDraft: boolean
  onOpen: (threadId: string) => void; onDismiss: () => void
}) {
  const [query, setQuery] = useState(''), id = useId()
  const people = new Map(record.recipients.map(person => [person.memberId, person]))
  const rows = record.receipt.deliveries.map(delivery => ({ ...delivery, people: delivery.recipientMemberIds.map(memberId => people.get(memberId)!) }))
  const filtered = rows.filter(row => row.people.some(person => `${person.name} ${person.department} ${person.memberId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  const recordedAt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(record.receipt.recordedAt))
  return <section className="messaging-panel messaging-deliveries" aria-label="최근 발송 결과">
    <div className="messaging-actions"><h3>최근 발송 결과</h3><button type="button" disabled={disabled} onClick={onDismiss}>결과 목록 접기</button></div>
    <p>{recordedAt} · {record.receipt.deliveries.length}개 대화에 접수됨{record.mode === 'individual' ? ' · 각자에게 개별 전송' : record.mode === 'group' ? ' · 함께 보는 단체 대화' : ''}</p>
    <p className="messaging-muted">서버 접수 결과입니다. 상대방의 읽음이나 업무 완료를 뜻하지 않습니다. 대화를 열 때 현재 권한을 다시 확인합니다.</p>
    {hasDraft && <p className="messaging-muted">대화를 열면 작성 중인 입력을 접어 보관합니다. 돌아와서 계속 작성할 수 있습니다.</p>}
    {rows.length > 1 && <div className="messaging-filters"><label htmlFor={`${id}-filter`}>발송 결과에서 받는 사람 찾기<input id={`${id}-filter`} type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label></div>}
    <ul className="messaging-delivery-list">{filtered.map(row => <li key={row.threadId}>
      {record.mode === 'group' && record.title && <strong>{record.title}</strong>}
      <ul>{row.people.map(person => <li key={person.memberId}><span>{recipientLabel(person, record.recipients)}</span><small>소속 번호: {person.memberId}</small></li>)}</ul>
      <button type="button" disabled={disabled} onClick={() => onOpen(row.threadId)} aria-label={`${row.people.map(person => recipientLabel(person, record.recipients)).join(', ')} ${hasDraft ? '입력 보관하고 대화 열기' : '대화 열기'}`}>{hasDraft ? '입력 보관하고 대화 열기' : '대화 열기'}</button>
    </li>)}</ul>
    {!filtered.length && <p>이 발송 결과에는 검색한 받는 사람이 없습니다.</p>}
    <p className="messaging-muted">이 목록은 현재 탭의 가장 최근 발송 1건입니다. 이전 대화는 대화 목록에서 계속 확인할 수 있습니다.</p>
  </section>
}
