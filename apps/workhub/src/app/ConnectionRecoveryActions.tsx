import { useEffect, useRef, useState } from 'react'

interface Props {
  hasDraft: boolean
  hasPending: boolean
  announcement: string
  onDiscard: () => boolean
}

// 연결 화면에서도 이동 보호의 이유와 가능한 다음 행동을 함께 보여 준다.
export function ConnectionRecoveryActions({ hasDraft, hasPending, announcement, onDiscard }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const discardButton = useRef<HTMLButtonElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const resultMessage = useRef<HTMLParagraphElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (!hasDraft || hasPending) setConfirming(false)
  }, [hasDraft, hasPending])
  useEffect(() => {
    if (confirming) keepButton.current?.focus()
    else if (returnFocus.current) { discardButton.current?.focus(); returnFocus.current = false }
  }, [confirming])
  useEffect(() => { if (message) resultMessage.current?.focus() }, [message])

  function discard() {
    // 확인창을 연 뒤 새 요청이 생겼더라도 상위에서 현재 저장소를 다시 확인한다.
    if (!onDiscard()) {
      setConfirming(false)
      setMessage('저장 결과 확인이 필요한 요청이 있어 입력을 버리지 않았습니다.')
      return
    }
    setConfirming(false)
    setMessage('임시 입력을 버렸습니다. 이제 상단의 기존 업무 메뉴로 이동할 수 있습니다.')
  }

  return <section aria-label="연결 중 입력 보관과 이동" style={{ marginTop: 24 }}>
    {hasPending ? <p>저장 결과를 확인하지 못한 요청이 있습니다. 이미 서버에 저장됐을 수 있어 확인 전에는 현재 탭을 유지해 주세요. 연결을 다시 확인한 뒤 같은 요청으로 결과를 확인할 수 있습니다.</p>
      : hasDraft ? <p>작성 중인 내용은 현재 탭에 임시 보관했습니다. 연결을 다시 확인하면 같은 계정과 학교의 입력을 복원합니다. 임시 입력을 버리면 기존 업무 메뉴로 이동할 수 있습니다.</p>
        : <p>기존 업무 메뉴는 계속 이용할 수 있습니다.</p>}
    {(hasDraft || hasPending) && <p className="hint">새로고침하거나 이 탭을 닫으면 보관 정보가 사라집니다. 기존 메뉴를 새 탭에서 열면 이 탭의 보관 정보는 유지됩니다.</p>}
    {announcement && <p className="notice-box" role="status" aria-live="polite">
      {hasPending ? '저장 결과 확인이 필요한 요청을 보호하기 위해 이동을 막았습니다. 연결을 다시 확인하거나 기존 메뉴를 새 탭에서 이용해 주세요.'
        : hasDraft ? '임시 보관한 입력을 보호하기 위해 이동을 막았습니다. 연결을 다시 확인하거나 입력을 버린 뒤 이동해 주세요.'
          : announcement}
    </p>}
    {message && <p ref={resultMessage} role="status" tabIndex={-1}>{message}</p>}
    {hasDraft && !hasPending && (confirming ? <section className="notice-box" aria-label="임시 입력 폐기 확인">
      <h2>보관한 입력을 버릴까요?</h2>
      <p>아직 저장하지 않은 업무·일정 입력과 가져오기 진행 정보를 지웁니다. 서버에 이미 저장된 자료는 삭제하지 않습니다. 이 선택은 되돌릴 수 없습니다.</p>
      <div className="button-row" style={{ flexWrap: 'wrap' }}>
        <button ref={keepButton} type="button" className="secondary" onClick={() => { returnFocus.current = true; setConfirming(false) }}>계속 보관</button>
        <button type="button" className="primary" onClick={discard}>입력 버리고 메뉴 이용</button>
      </div>
    </section> : <button ref={discardButton} type="button" className="secondary" onClick={() => { setMessage(''); setConfirming(true) }}>임시 입력 버리기</button>)}
    {(hasDraft || hasPending) && <p style={{ marginTop: 16 }}><a href="/" target="_blank" rel="noopener noreferrer">기존 메뉴를 새 탭에서 이용</a></p>}
  </section>
}
