import { useState } from 'react'

interface Props {
  state?: 'available' | 'closing'
  busy: boolean
  disabled?: boolean
  onConfirm: () => void
}

/** 서버가 확정한 결과를 받기 전에는 입력과 원래 요청을 지우지 않는다. */
export function RequestClosePanel({ state, busy, disabled, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false)
  if (!state) return null
  if (state === 'closing') return <div className="ttops-request-close" aria-label="요청 닫기">
    <p>요청 닫기 결과를 확인하고 있습니다. 같은 번호로 닫기를 다시 확인할 수 있습니다. 확인 전에는 원래 요청을 다시 보내거나 새 요청을 만들지 않습니다.</p>
    <button type="button" disabled={busy || disabled} onClick={onConfirm}>{busy ? '요청 닫기 확인 중…' : '요청 닫기 결과 다시 확인'}</button>
  </div>
  return <div className="ttops-request-close" aria-label="요청 닫기">
    {confirming ? <>
      <p>아직 처리되지 않았다면 이 요청 번호를 영구히 닫습니다. 입력은 보관하며, 다시 보내려면 최신 내용을 확인해 새 요청을 만들어야 합니다.</p>
      <p>이미 처리됐다면 원래 성공 결과를 보여 줍니다. 반영된 시간표나 실시 기록을 되돌리는 기능은 아닙니다.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || disabled} onClick={onConfirm}>요청 닫기 확인</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>계속 결과 확인하기</button>
      </div>
    </> : <button type="button" className="secondary" disabled={busy || disabled} onClick={() => setConfirming(true)}>이 요청 닫기</button>}
  </div>
}
