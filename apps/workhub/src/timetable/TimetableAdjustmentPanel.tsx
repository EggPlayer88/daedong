import { useEffect, useMemo, useState } from 'react'
import type { Placement, TimetableBasis } from './contracts'
import { adjustmentSourceKey, findSwapCandidates, reviewAdjustment, reviewPartialPlacements } from './adjustments'
import type { AdjustmentCommand } from './adjustments'
import limits from './adjustments-limits.json'

interface Props {
  basis: TimetableBasis; placements: Placement[]; lockedLessonIds: string[]; selectedLessonId: string; disabled: boolean
  onSelect: (id: string) => void; onToggleLock: (id: string) => void; onApply: (command: AdjustmentCommand, sourceKey: string) => void
}
const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const slotName = (basis: TimetableBasis, id: string | null) => { const slot = basis.slots.find(row => row.id === id); return slot ? `${days[slot.day - 1]} ${slot.label} · ${clock(slot.startMinute)}–${clock(slot.endMinute)}` : id === null ? '미배정' : '확인되지 않은 시간대' }

/** 변경 전후를 확인한 뒤 명령만 부모에 넘긴다. 부모는 최신 전체 배치로 다시 검증한다. */
export function TimetableAdjustmentPanel({ basis, placements, lockedLessonIds, selectedLessonId, disabled, onSelect, onToggleLock, onApply }: Props) {
  const [mode, setMode] = useState<'move' | 'swap'>('move'), [slotId, setSlotId] = useState(''), [otherId, setOtherId] = useState('')
  const [query, setQuery] = useState(''), [unassignedQuery, setUnassignedQuery] = useState(''), [shown, setShown] = useState(limits.unassignedPage)
  const [candidates, setCandidates] = useState<{ sourceKey: string; query: string; lessonId: string; result: ReturnType<typeof findSwapCandidates> }>()
  const sourceKey = adjustmentSourceKey(basis, placements, lockedLessonIds), selectionKey = sourceKey + ':' + selectedLessonId
  const [reviewKey, setReviewKey] = useState(selectionKey)
  useEffect(() => { setMode('move'); setSlotId(''); setOtherId(''); setCandidates(undefined); setReviewKey(selectionKey) }, [selectionKey])
  useEffect(() => { setShown(limits.unassignedPage) }, [unassignedQuery])
  const partial = useMemo(() => reviewPartialPlacements(basis, placements), [sourceKey])
  const indexes = useMemo(() => ({ resources: new Map(basis.resources.map(row => [row.id, row])), lessons: new Map(basis.lessons.map(row => [row.id, row])), placements: new Map(placements.map(row => [row.lessonId, row])), missing: new Set(partial.missingLessonIds) }), [sourceKey])
  const selected = indexes.lessons.get(selectedLessonId), original = indexes.placements.get(selectedLessonId)
  const fresh = reviewKey === selectionKey
  const command: AdjustmentCommand | undefined = selected && fresh ? mode === 'swap' ? otherId ? { kind: 'swap', lessonId: selected.id, otherLessonId: otherId } : undefined : slotId ? { kind: original ? 'move' : 'assign', lessonId: selected.id, slotId } : undefined : undefined
  const reviewed = useMemo(() => command ? reviewAdjustment(basis, placements, lockedLessonIds, command) : undefined, [sourceKey, selectedLessonId, fresh, mode, slotId, otherId])
  const normalized = unassignedQuery.trim().toLocaleLowerCase()
  const searchable = (row: TimetableBasis['lessons'][number]) => [row.label, ...row.resourceIds.map(id => indexes.resources.get(id)?.label ?? '')].join(' ').toLocaleLowerCase()
  const missing = basis.lessons.filter(row => indexes.missing.has(row.id) && (!normalized || searchable(row).includes(normalized)))
  const currentCandidates = candidates?.sourceKey === sourceKey && candidates.lessonId === selectedLessonId && candidates.query === query ? candidates.result : undefined
  const partners = basis.lessons.filter(row => row.id !== selectedLessonId && indexes.placements.has(row.id) && (!query.trim() || searchable(row).includes(query.trim().toLocaleLowerCase()))).slice(0, limits.candidateChecks)
  function changeMode(next: 'move' | 'swap') { if (disabled) return; setMode(next); setSlotId(''); setOtherId(''); setCandidates(undefined); setReviewKey(selectionKey) }
  return <div className="timetable-adjustment">
    {partial.missingLessonIds.length > 0 && <section className="timetable-notice" aria-label="미배정 수업 이어 배치">
      <h3>아직 배치하지 않은 수업 {partial.missingLessonIds.length}개</h3><p>현재 배치한 수업은 보존합니다. 남은 수업을 하나씩 배치하거나 다시 계산해 이어서 완성하세요. 모든 수업이 조건을 통과하기 전에는 저장·확정할 수 없습니다.</p>
      <label>미배정 수업 검색<input aria-label="미배정 수업 검색" value={unassignedQuery} maxLength={limits.searchLength} disabled={disabled} onChange={event => setUnassignedQuery(event.target.value)} placeholder="수업·교사·학급 이름" /></label>
      <ul className="timetable-list">{missing.slice(0, shown).map(lesson => <li className="timetable-list-row" key={lesson.id}><div>{lesson.label}<small>{lesson.periods}차시 · {lesson.resourceIds.map(id => indexes.resources.get(id)?.label).filter(Boolean).join(' · ')}</small></div><button type="button" className="secondary" disabled={disabled} onClick={() => onSelect(lesson.id)} aria-label={`${lesson.label} 미배정 수업 배치`}>배치하기</button></li>)}</ul>
      {!missing.length && <p>검색어에 맞는 미배정 수업이 없습니다.</p>}{missing.length > shown && <button type="button" className="secondary" disabled={disabled} onClick={() => setShown(value => value + limits.unassignedPage)}>미배정 수업 더 보기</button>}
    </section>}
    {selected && <section className="timetable-notice" aria-label="선택한 수업 이동"><h3>{selected.label} {original ? '이동' : '배치'}</h3>
      <div className="timetable-actions">{original && <button type="button" className="secondary" aria-pressed={lockedLessonIds.includes(selected.id)} disabled={disabled || basis.fixed.some(row => row.lessonId === selected.id)} onClick={() => onToggleLock(selected.id)}>{basis.fixed.some(row => row.lessonId === selected.id) ? '필수 조건으로 고정됨' : lockedLessonIds.includes(selected.id) ? '작업 고정 해제' : '이 배치 유지'}</button>}
        <button type="button" className="secondary" aria-pressed={mode === 'move'} disabled={disabled} onClick={() => changeMode('move')}>{original ? '다른 시간으로 이동' : '미배정 수업 배치'}</button>
        {original && <button type="button" className="secondary" aria-pressed={mode === 'swap'} disabled={disabled} onClick={() => changeMode('swap')}>두 수업 맞교환</button>}
      </div><p>현재 위치: {slotName(basis, original?.slotId ?? null)}</p>
      {mode === 'move' || !original ? <label>{original ? '이동할 시간' : '배치할 시간'}<select aria-label={original ? '이동할 시간' : '배치할 시간'} value={fresh ? slotId : ''} disabled={disabled} onChange={event => { setSlotId(event.target.value); setReviewKey(selectionKey) }}><option value="">시간을 선택해 주세요</option>{basis.slots.filter(slot => selected.allowedSlotIds.includes(slot.id)).map(slot => <option value={slot.id} key={slot.id}>{slotName(basis, slot.id)}</option>)}</select></label> : <div>
        <label>교환 대상 검색<input aria-label="교환 대상 검색" value={query} maxLength={limits.searchLength} disabled={disabled} onChange={event => { setQuery(event.target.value); setOtherId(''); setCandidates(undefined) }} placeholder="수업·교사·학급 이름" /></label>
        <label>교환할 수업<select aria-label="교환할 수업" value={fresh ? otherId : ''} disabled={disabled} onChange={event => { setOtherId(event.target.value); setReviewKey(selectionKey) }}><option value="">서로 바꿀 수업 선택</option>{partners.map(row => <option key={row.id} value={row.id}>{row.label} · {slotName(basis, indexes.placements.get(row.id)?.slotId ?? null)}</option>)}</select></label>
        <p className="timetable-muted">검색에 맞는 배정 수업을 최대 {limits.candidateChecks}개 표시합니다. 표시되지 않은 수업은 검색어로 좁혀 주세요.</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => { if (!disabled) setCandidates({ sourceKey, query, lessonId: selected.id, result: findSwapCandidates(basis, placements, lockedLessonIds, selected.id, query) }) }}>가능한 교환 대상 찾기</button>
        {currentCandidates && <section aria-label="검사한 교환 후보"><p>{currentCandidates.scanned}/{currentCandidates.total}개 검사 · 가능한 후보 {currentCandidates.candidates.length}개{currentCandidates.limited ? ' · 일부 범위만 검사했습니다. 검색을 좁혀 다시 찾을 수 있습니다.' : ''}</p>{!currentCandidates.candidates.length && <p>확인한 범위에서는 두 수업을 바로 바꿀 수 있는 후보가 없습니다. 조건을 자동 완화하지 않습니다.</p>}<ul className="timetable-list">{currentCandidates.candidates.map(candidate => <li key={candidate.lessonId} className="timetable-list-row"><span>{indexes.lessons.get(candidate.lessonId)?.label}</span><button type="button" className="secondary" disabled={disabled} onClick={() => { setOtherId(candidate.lessonId); setReviewKey(selectionKey) }}>이 교환 검토</button></li>)}</ul></section>}
      </div>}
      {reviewed && <section aria-label="배치 변경 전후"><h4>반영 전 확인</h4><ul>{reviewed.changes.map(change => <li key={change.lessonId}><strong>{indexes.lessons.get(change.lessonId)?.label}</strong><p>{slotName(basis, change.beforeSlotId)} → {slotName(basis, change.afterSlotId)}</p></li>)}</ul>
        {reviewed.valid ? <p role="status">{reviewed.complete ? command?.kind === 'swap' ? '두 수업을 함께 바꾸면 전체 필수 조건을 통과합니다.' : '이동 후 전체 필수 조건을 통과합니다.' : `현재 배정된 수업의 조건을 통과합니다. 남은 미배정 ${reviewed.missingLessonIds.length}개를 마쳐야 저장할 수 있습니다.`}</p> : <ul className="timetable-issues" role="alert">{reviewed.issues.map((entry, index) => <li key={`${entry.code}-${index}`}>{entry.message} <small>({entry.code})</small></li>)}</ul>}
      </section>}
      <div className="timetable-actions"><button type="button" disabled={disabled || !reviewed?.valid || !fresh} onClick={() => { if (!disabled && reviewed?.valid && fresh) onApply(reviewed.command, reviewed.sourceKey) }}>{mode === 'swap' && original ? '검사한 두 수업 함께 교환' : original ? '검사한 위치로 이동' : '검사한 시간에 배치'}</button><button type="button" className="secondary" disabled={disabled} onClick={() => onSelect('')}>이동 닫기</button></div>
      <p className="timetable-muted">작업 초안만 조정합니다. 학교 서버 저장·학기 시간표 확정·교사 동의 요청은 실행하지 않습니다.</p>
    </section>}
  </div>
}
