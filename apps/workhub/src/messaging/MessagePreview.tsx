import { useEffect, useRef } from 'react'
import type { MessageAttempt } from './composer'
import { recipientLabel } from './deliveries'

export function MessagePreview({ attempt, busy, onConfirm, onEdit }: { attempt: MessageAttempt; busy: boolean; onConfirm: () => void; onEdit: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }) }, [attempt.key])
  const sent = attempt.command
  if (sent.kind !== 'start' && sent.kind !== 'reply') return null
  return <section className="messaging-preview" aria-label="보내기 전 확인"><h3 tabIndex={-1} ref={heading}>보내기 전 확인</h3>
    <p>{sent.kind === 'start' && sent.mode === 'individual' ? '각 교사와의 개별 대화로 보냅니다. 받는 사람끼리는 서로의 명단을 보지 않습니다.' : sent.kind === 'start' && sent.mode === 'group' ? '참여자가 함께 보는 단체 대화입니다. 참여자 이름과 답장이 서로에게 보입니다.' : '아래 받는 사람에게 메시지를 보냅니다.'}</p>
    <dl><dt>받는 사람 · {attempt.recipientNames.length}명</dt><dd>{attempt.recipientNames.join(', ')}</dd>{sent.kind === 'start' && sent.title && <><dt>대화 제목</dt><dd>{sent.title}</dd></>}<dt>보낼 내용</dt><dd className="messaging-body">{sent.body}</dd></dl>
    {attempt.recipientSnapshots && <ul className="messaging-recipient-identities" aria-label="받는 사람 소속 확인">{attempt.recipientSnapshots.map(person => <li key={person.memberId}>{recipientLabel(person, attempt.recipientSnapshots)}<small>소속 번호: {person.memberId}</small></li>)}</ul>}
    {Boolean(attempt.attachments?.length) && <div><h4>함께 보낼 파일</h4><ul>{attempt.attachments!.map(file => <li key={file.id}>{file.name} · {file.bytes.toLocaleString()}바이트</li>)}</ul></div>}
    <div className="messaging-actions"><button type="button" className="messaging-primary" disabled={busy} onClick={onConfirm}>{busy ? '전송 결과 확인 중…' : '확인한 내용 보내기'}</button><button type="button" disabled={busy} onClick={onEdit}>내용 수정</button></div>
  </section>
}
