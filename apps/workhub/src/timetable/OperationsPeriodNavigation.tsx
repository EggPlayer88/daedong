import { useEffect, useState } from 'react'
import { dateOffset } from './OperationChangeList'

interface Props { from: string; until: string; date: string; today: string; days: number; locked: boolean; hasDraft: boolean; onChange: (date: string) => void }
/** 조회 기간만 바꾸며 작성한 명령과 요청 번호는 부모가 보존한다. */
export function OperationsPeriodNavigation({ from, until, date, today, days, locked, hasDraft, onChange }: Props) {
  const [input, setInput] = useState(date)
  useEffect(() => setInput(date), [date])
  const valid = Boolean(dateOffset(input, 0))
  return <section className="ttops-card" aria-label="시간표 공통 조회 기간">
    <div className="ttboard-actions"><button type="button" className="secondary" disabled={locked || !dateOffset(from, -days)} onClick={() => onChange(dateOffset(from, -days))}>이전 조회 기간</button><strong>{from} ~ {dateOffset(until, -1)}</strong><button type="button" className="secondary" disabled={locked || !dateOffset(from, days)} onClick={() => onChange(dateOffset(from, days))}>다음 조회 기간</button></div>
    <div className="ttboard-actions"><label>조회할 날짜<input type="date" aria-label="운영 조회 날짜" value={input} disabled={locked} onChange={event => setInput(event.target.value)} /></label><button type="button" className="secondary" disabled={locked || !valid} onClick={() => onChange(input)}>이 날짜 조회</button><button type="button" className="secondary" disabled={locked} onClick={() => onChange(today)}>오늘 조회</button></div>
    {hasDraft && <p className="ttops-muted">기간을 바꾸어도 작성한 입력은 유지됩니다. 변경 전후 확인은 새 자료로 다시 진행합니다.</p>}
  </section>
}
