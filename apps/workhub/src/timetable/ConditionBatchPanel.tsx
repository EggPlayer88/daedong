import { useEffect, useMemo, useState } from 'react'
import { timetablePolicy } from '../../../../packages/timetable/src/validate'
import type { TimetableBasis, TimetableConditions } from './contracts'
import type { TimetableSlot } from '../../../../packages/timetable/src/types'
import { applyConditionBatch, conditionBatchClock, conditionBatchMinute, conditionBatchSourceKey, hasConditionBatchInput, initialConditionBatch, previewConditionBatch, type ConditionBatchState } from './condition-batch'
import { conditionTargetLabels } from './condition-policy'

interface Props { basis: TimetableBasis; conditions: TimetableConditions; state: ConditionBatchState; disabled: boolean; onStateChange: (state: ConditionBatchState) => void; onApply: (conditions: TimetableConditions, sourceKey: string) => boolean }
const kinds = { teacher: '교사', class: '학급', student_group: '수강 집단', room: '공간', equipment: '장비' }
const days = ['월', '화', '수', '목', '금', '토', '일']
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s/g, '')
function Lines({ title, rows }: { title: string; rows: string[] }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(rows.length / 20)), current = Math.min(page, pages - 1)
  return <details open={rows.length <= 5 || undefined}><summary>{title} · {rows.length}건</summary><ul>{rows.slice(current * 20, (current + 1) * 20).map((row, index) => <li key={current * 20 + index}>{row}</li>)}</ul>{pages > 1 && <nav className="timetable-actions" aria-label={`${title} 쪽 이동`}><span>{current + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 {title}</button><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 {title}</button></nav>}</details>
}
function SlotDay({ day, slots, selected, onChange }: { day: number; slots: TimetableSlot[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(slots.length / 20)), current = Math.min(page, pages - 1), chosen = new Set(selected)
  return <details open={slots.some(slot => chosen.has(slot.id)) || undefined}><summary>{days[day - 1]}요일 · 선택 {slots.filter(slot => chosen.has(slot.id)).length}/{slots.length}</summary>
    <div className="timetable-actions"><button type="button" className="secondary" onClick={() => onChange([...new Set([...selected, ...slots.map(slot => slot.id)])])}>{days[day - 1]}요일 시간 모두 선택</button><button type="button" className="secondary" disabled={!slots.some(slot => chosen.has(slot.id))} onClick={() => { const ids = new Set(slots.map(slot => slot.id)); onChange(selected.filter(id => !ids.has(id))) }}>{days[day - 1]}요일 시간 해제</button></div>
    {slots.slice(current * 20, (current + 1) * 20).map(slot => <label className="timetable-check" key={slot.id}><input type="checkbox" aria-label={`실제 시간 ${days[day - 1]} ${slot.label} ${conditionBatchClock(slot.startMinute)}–${conditionBatchClock(slot.endMinute)} [${slot.id}]`} checked={chosen.has(slot.id)} onChange={event => onChange(event.target.checked ? [...selected, slot.id] : selected.filter(id => id !== slot.id))} /><span>{slot.label} · {conditionBatchClock(slot.startMinute)}–{conditionBatchClock(slot.endMinute)} · {slot.periods}차시<small> [{slot.id}]</small></span></label>)}
    {pages > 1 && <nav className="timetable-actions" aria-label={`${days[day - 1]}요일 시간 쪽 이동`}><span>{current + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 {days[day - 1]}요일 시간</button><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 {days[day - 1]}요일 시간</button></nav>}
  </details>
}
export function ConditionBatchPanel({ basis, conditions, state, disabled, onStateChange, onApply }: Props) {
  const [error, setError] = useState(''), [page, setPage] = useState(0)
  const sourceKey = useMemo(() => conditionBatchSourceKey(basis, conditions), [basis, conditions])
  const preview = state.preview?.sourceKey === sourceKey ? state.preview : undefined, pending = hasConditionBatchInput(state)
  const slotDays = useMemo(() => days.map((_, index) => ({ day: index + 1, slots: basis.slots.filter(slot => slot.day === index + 1).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id, 'en')) })).filter(row => row.slots.length), [basis.slots])
  const targetLabels = useMemo(() => conditionTargetLabels(basis.resources), [basis.resources])
  const matching = useMemo(() => basis.resources.filter(resource => (!state.resourceKind || resource.kind === state.resourceKind) && normalize(`${resource.label} ${resource.id}`).includes(normalize(state.search))).sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.id.localeCompare(b.id, 'en')), [basis.resources, state.resourceKind, state.search])
  const pages = Math.max(1, Math.ceil(matching.length / 20)), shown = Math.min(page, pages - 1)
  useEffect(() => { if (state.preview && state.preview.sourceKey !== sourceKey) { onStateChange({ ...state, preview: undefined, confirmed: false }); setError('기초 자료나 현재 조건이 바뀌어 미리보기를 닫았습니다. 입력은 보관했으니 다시 확인해 주세요.') } }, [sourceKey, state, onStateChange])
  function change(patch: Partial<ConditionBatchState>) { if (disabled) return; onStateChange({ ...state, ...patch, preview: undefined, confirmed: false }); setError('') }
  function inspect() {
    if (disabled) return
    try { const next = previewConditionBatch(basis, conditions, state.inputMode === 'slots' ? { kind: state.kind, resourceIds: state.resourceIds, slotIds: state.slotIds ?? [], weight: state.kind === 'preferences' ? Number(state.weight) : 1 } : { kind: state.kind, resourceIds: state.resourceIds, days: state.days, startMinute: conditionBatchMinute(state.start), endMinute: conditionBatchMinute(state.end), weight: state.kind === 'preferences' ? Number(state.weight) : 1 }); onStateChange({ ...state, preview: next, confirmed: false }); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '선택한 대상과 시간을 확인해 주세요.') }
  }
  function apply() {
    if (disabled || !preview || !state.confirmed) return
    try { const next = applyConditionBatch(basis, conditions, preview); if (!onApply(next, preview.sourceKey)) throw new Error('현재 작업 상태가 바뀌었습니다. 입력을 유지했으니 다시 확인해 주세요.'); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '반영할 내용을 다시 확인해 주세요.') }
  }
  return <details className="timetable-card timetable-condition-batch" style={{ overflowWrap: 'anywhere' }} open={pending || undefined}><summary>여러 대상·요일에 조건 한 번에 추가</summary>
    <p className="timetable-muted">학기 내 매주 반복할 회의·출장·피하고 싶은 시간을 지정합니다. 특정 날짜의 임시 변경은 확정·공유·교환 화면을 이용해 주세요.</p>
    <fieldset disabled={disabled}><legend>주간 조건 일괄 입력</legend><div className="timetable-grid"><label>일괄 조건 종류<select aria-label="일괄 조건 종류" value={state.kind} onChange={event => change({ kind: event.target.value as ConditionBatchState['kind'] })}><option value="unavailable">필수: 사용할 수 없는 시간</option><option value="preferences">선호: 가능하면 피할 시간</option></select></label><label>일괄 조건 대상 종류<select aria-label="일괄 조건 대상 종류" value={state.resourceKind} onChange={event => { change({ resourceKind: event.target.value }); setPage(0) }}><option value="">모든 대상</option>{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>일괄 조건 대상 검색<input aria-label="일괄 조건 대상 검색" value={state.search} onChange={event => { change({ search: event.target.value }); setPage(0) }} placeholder="교사·학급·수강 집단" /></label></div>
      <p>선택 {state.resourceIds.length}개 · 검색 {matching.length}개 · {shown + 1}/{pages}쪽</p><div className="timetable-actions"><button type="button" className="secondary" disabled={!matching.length} onClick={() => change({ resourceIds: [...new Set([...state.resourceIds, ...matching.map(row => row.id)])] })}>검색된 조건 대상 모두 선택 ({matching.length})</button><button type="button" className="secondary" disabled={!state.resourceIds.length} onClick={() => change({ resourceIds: [] })}>조건 대상 선택 해제</button></div>
      <fieldset><legend>조건 적용 대상</legend>{matching.slice(shown * 20, (shown + 1) * 20).map(resource => <label className="timetable-check" key={resource.id}><input type="checkbox" aria-label={`일괄 대상 ${targetLabels.get(resource.id)}`} checked={state.resourceIds.includes(resource.id)} onChange={event => change({ resourceIds: event.target.checked ? [...state.resourceIds, resource.id] : state.resourceIds.filter(id => id !== resource.id) })} />{targetLabels.get(resource.id)} · {kinds[resource.kind]}</label>)}{!matching.length && <p>검색된 대상이 없습니다. 다른 검색에서 선택한 대상은 유지합니다.</p>}</fieldset>
      {pages > 1 && <nav className="timetable-actions" aria-label="일괄 조건 대상 쪽 이동"><button type="button" className="secondary" disabled={!shown} onClick={() => setPage(shown - 1)}>이전 조건 대상</button><button type="button" className="secondary" disabled={shown + 1 >= pages} onClick={() => setPage(shown + 1)}>다음 조건 대상</button></nav>}
      <label>시간 선택 방식<select aria-label="일괄 시간 선택 방식" value={state.inputMode ?? 'range'} onChange={event => change({ inputMode: event.target.value as 'range' | 'slots' })}><option value="range">요일과 시각 직접 입력</option><option value="slots">실제 시간표에서 여러 시간 선택</option></select></label>
      {state.inputMode === 'slots' ? <fieldset><legend>조건을 적용할 실제 시간대</legend><p className="timetable-muted">선택한 방식만 반영합니다. 직접 적은 시각은 반영 전까지 보관하며, 시간 선택 방식을 바꾸면 다시 볼 수 있습니다.</p><p>선택 {state.slotIds?.length ?? 0}개 · 서로 다른 요일과 교시를 함께 고를 수 있습니다. 같은 이름이어도 실제 시각과 ID로 확인해 주세요.</p><div className="timetable-grid">{slotDays.map(row => <SlotDay key={row.day} {...row} selected={state.slotIds ?? []} onChange={slotIds => change({ slotIds })} />)}</div><button type="button" className="secondary" disabled={!state.slotIds?.length} onClick={() => change({ slotIds: [] })}>실제 시간 선택 모두 해제</button></fieldset> : <>
      <fieldset><legend>매주 적용 요일</legend><div className="timetable-actions">{days.map((day, index) => <label className="timetable-check" key={day}><input type="checkbox" aria-label={`일괄 ${day}요일`} checked={state.days.includes(index + 1)} onChange={event => change({ days: event.target.checked ? [...state.days, index + 1] : state.days.filter(value => value !== index + 1) })} />{day}</label>)}</div></fieldset>
      <div className="timetable-grid"><label>일괄 시작 시각<input type="time" aria-label="일괄 시작 시각" value={state.start} onChange={event => change({ start: event.target.value })} /></label><label>일괄 종료 시각<input type="time" aria-label="일괄 종료 시각" value={state.end} onChange={event => change({ end: event.target.value })} /></label></div></>}
      {state.kind === 'preferences' && <label>일괄 피하고 싶은 정도<input type="number" aria-label="일괄 피하고 싶은 정도" min="1" max={timetablePolicy.maxWeight} step="1" value={state.weight} onChange={event => change({ weight: event.target.value })} /></label>}
      <p className="timetable-muted">실제 시각이 조금이라도 겹치는 수업에 적용합니다. 연속 수업도 전체 블록을 기준으로 봅니다.{state.kind === 'preferences' ? ' 공동 수업은 한 번만 계산하고 기존의 더 강한 선호는 유지합니다.' : ' 학교가 정한 고정·불가 조건은 그대로 둡니다.'}</p>
      <div className="timetable-actions"><button type="button" onClick={inspect}>일괄 조건 미리보기</button>{pending && <button type="button" className="secondary" onClick={() => { onStateChange(initialConditionBatch()); setError('') }}>일괄 조건 입력 비우기</button>}</div>
      {error && <p role="alert" className="timetable-error">{error}</p>}
      {preview && <section aria-label="일괄 조건 검토 결과"><h3>추가·강화 {preview.rows.length}건 · 기존 유지 {preview.skipped}건</h3><p>선택 {preview.action.resourceIds.length}개 대상의 수업 {preview.affectedLessons}개를 검토했습니다. 아직 작업 초안에 반영하지 않았습니다.</p>{preview.rows.length > 0 ? <Lines title="일괄 조건 변경 내용" rows={preview.rows} /> : <p>추가할 조건이 없습니다. 해당 시간의 허용 수업이 없거나 기존 조건이 이미 적용되어 있습니다.</p>}
        {preview.warnings.length > 0 && <div className="timetable-notice" role="status"><p>반영 후 확정 충돌 {preview.warnings.length}건이 남아 계산이 막힙니다. 조건은 자동으로 풀지 않습니다. 반영한다면 이 충돌을 해결한 뒤 계산해 주세요.</p><Lines title="반영 후 해결할 충돌" rows={preview.warnings} /></div>}
        <label className="timetable-check"><input type="checkbox" checked={state.confirmed} disabled={!preview.rows.length} onChange={event => { if (!disabled) onStateChange({ ...state, confirmed: event.target.checked }) }} />매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다</label><button type="button" disabled={!state.confirmed || !preview.rows.length} onClick={apply}>확인한 일괄 조건 반영</button>
        <p className="timetable-muted">작업 초안의 조건만 바꿉니다. 기존 배치는 보관하며, 다시 검사·계산해야 저장할 수 있습니다.</p>
      </section>}
    </fieldset>
  </details>
}
