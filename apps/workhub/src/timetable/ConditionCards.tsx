import { useState } from 'react'
import { canonical } from '../services/scoped-rpc'
import type { TimetableBasis, TimetableConditions } from './contracts'

const labels = { fixed: '반드시 이 시간에', unavailable: '사용할 수 없는 시간', preferences: '가능하면 피할 시간' }
const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export function ConditionCards({ basis, conditions, disabled, onRemove }: { basis: TimetableBasis; conditions: TimetableConditions; disabled: boolean; onRemove: (kind: keyof TimetableConditions, index: number) => void }) {
  const [query, setQuery] = useState('')
  const search = query.normalize('NFKC').toLowerCase().replace(/\s/g, '')
  return <div className="timetable-conditions">
    <label>등록한 조건 검색<input aria-label="등록한 조건 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="교사·수업·시간" /></label>
    <p className="timetable-muted">적용 범위: 현재 기준판의 학기 주간 편성. 특정 날짜만 바꿀 때는 확정된 수업에서 변경을 요청합니다.</p>
    {(Object.keys(labels) as (keyof TimetableConditions)[]).map(kind => <section key={kind} aria-label={`${labels[kind]} 목록`}><h3>{labels[kind]} · {conditions[kind].length}건</h3><ul className="timetable-list">{conditions[kind].map((row, index) => {
      const inherited = basis[kind].some(item => canonical(item) === canonical(row)), protectedRow = inherited && kind !== 'preferences'
      const slot = 'slotId' in row ? basis.slots.find(item => item.id === row.slotId) : undefined
      const label = 'resourceId' in row
        ? `${basis.resources.find(item => item.id === row.resourceId)?.label ?? '확인되지 않은 대상'} · ${days[row.day - 1]} ${clock(row.startMinute)}–${clock(row.endMinute)}`
        : `${basis.lessons.find(item => item.id === row.lessonId)?.label ?? '확인되지 않은 수업'} · ${slot ? `${days[slot.day - 1]} ${slot.label} · ${clock(slot.startMinute)}–${clock(slot.endMinute)}` : '확인되지 않은 시간대'}${'weight' in row ? ` · 피하기 ${row.weight}` : ''}`
      if (!label.normalize('NFKC').toLowerCase().replace(/\s/g, '').includes(search)) return null
      return <li key={`${kind}-${index}`} className="timetable-list-row"><div><strong>{label}</strong><small>{protectedRow ? '학교가 확정한 조건' : inherited ? '학교 기준자료의 선호' : '담당자가 이 초안에 추가한 조건'}</small><span className="timetable-badge">{kind === 'preferences' ? '선호' : '필수'}</span><small>형식 확인 완료 · 배치 전체 검사는 생성·조정 후 진행</small></div><button type="button" className="secondary" disabled={disabled || protectedRow} aria-label={`${label} 조건 삭제`} onClick={() => onRemove(kind, index)}>삭제</button></li>
    })}</ul>{!conditions[kind].length && <p className="timetable-muted">등록한 조건이 없습니다.</p>}</section>)}
  </div>
}
