import type { DraftFollowup, DraftPeople, DraftPerson } from './draft-followup'

interface Props {
  draft: DraftFollowup
  result?: DraftPeople
  disabled: boolean
  searching: boolean
  pendingInput: boolean
  onSelect: (person: DraftPerson) => void
  onRemove: (id: string) => void
  onDismiss: () => void
  onOpen: () => void
  onCancel: () => void
}

function personLabel(person: DraftPerson) {
  return [person.displayName, person.detail].filter(Boolean).join(' · ')
}

export function DraftFollowupCard({
  draft, result, disabled, searching, pendingInput, onSelect, onRemove, onDismiss, onOpen, onCancel,
}: Props) {
  const { command, selected, dueDate } = draft
  const message = command.kind === 'messageDraft'
  const role = message ? '받는 사람' : '제출 대상'
  const heading = message ? '작성 중인 메시지' : '작성 중인 수합'
  const nextQuestion = result || searching ? '' : !message && !dueDate ? '제출 기한은 언제인가요?' :
    selected.length ? '더 추가할 교사가 있나요? 준비되면 작성 화면에서 확인하세요.' :
    message ? '누구에게 보낼까요? 교사 이름을 적어 주세요.' : '누가 제출하나요? 교사 이름을 적어 주세요.'

  return <section className="assistant-workspace-result" aria-label={heading}>
    <div className="assistant-workspace-result-heading"><h3>{heading}</h3><span>미저장</span></div>
    {command.kind === 'messageDraft'
      ? <p className="assistant-text">{command.body}</p>
      : <><strong>{command.title}</strong>{command.instructions && <p className="assistant-text">{command.instructions}</p>}
          <p>제출 기한 · {dueDate ? <time dateTime={dueDate}>{dueDate}</time> : '미입력'}</p></>}
    <p>{role} · {selected.length}명</p>
    {selected.length > 0 && <ul className="assistant-draft-people" aria-label={role + ' 선택 목록'}>
      {selected.map(person => <li key={person.memberId}><span>{personLabel(person)}</span>
        <button type="button" className="assistant-quiet" disabled={disabled} onClick={() => onRemove(person.memberId)}
          aria-label={personLabel(person) + ' 선택 해제'}>선택 해제</button></li>)}
    </ul>}
    {searching && <p role="status">교사를 찾고 있습니다.</p>}
    {result && <section aria-label="교사 검색 결과">
      <p>“{result.query}” 검색 결과</p>
      {result.items.length ? <ul className="assistant-resource-list">
        {result.items.map(person => {
          const isSelected = selected.some(item => item.memberId === person.memberId)
          return <li key={person.memberId}><button type="button" disabled={disabled || isSelected} onClick={() => onSelect(person)}>
            <strong>{personLabel(person)}</strong><span className="assistant-resource-open">{isSelected ? '선택됨' : '선택'}</span>
          </button></li>
        })}
      </ul> : <p role="status">일치하는 교사가 없습니다. 다른 이름으로 찾아보세요.</p>}
      {result.hasMore && <p className="assistant-hint">일부 결과를 표시했습니다. 이름을 더 자세히 적어 주세요.</p>}
      <button type="button" className="assistant-quiet" disabled={disabled} onClick={onDismiss}>검색 닫기</button>
    </section>}
    {nextQuestion && <p role="status">{nextQuestion}</p>}
    <div className="assistant-actions">
      <button type="button" className="assistant-primary" disabled={disabled || pendingInput || Boolean(result) || searching}
        onClick={onOpen}>작성 화면에서 확인</button>
      <button type="button" className="assistant-quiet" disabled={disabled} onClick={onCancel}>이어 입력 취소</button>
    </div>
  </section>
}
