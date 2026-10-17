import { useMemo, useState } from 'react'
import type { CpSatRequest, CpSatResponse } from '../../../../packages/timetable/src/cpSat'
import { reviewCandidate, type CandidateLessonDetail } from './candidate-review'

const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/g, '')
const pageSize = 25
function Location({ row }: { row: CandidateLessonDetail | null }) {
  return row ? <><span>{days[row.slot.day - 1]} {row.slot.label} · {clock(row.slot.startMinute)}–{clock(row.slot.endMinute)}</span><small>{row.resources.map(resource => resource.label).join(' · ')}</small></> : <span>배정 없음</span>
}
export function TimetableCandidateReview({ request, response, selected }: { request: CpSatRequest; response: CpSatResponse; selected: number }) {
  const [baseline, setBaseline] = useState('current'), [resourceId, setResourceId] = useState(''), [query, setQuery] = useState(''), [day, setDay] = useState(0), [page, setPage] = useState(0), [schedulePage, setSchedulePage] = useState(0)
  const candidate = response.candidates[selected]
  const options = [...(request.previous ? [{ value: 'current', label: '계산 요청 당시의 작업 배치' }] : []), ...response.candidates.flatMap((_, index) => index === selected ? [] : [{ value: String(index), label: `후보 ${index + 1}` }])]
  const comparison = options.some(option => option.value === baseline) ? baseline : options[0]?.value
  const previous = comparison === 'current' ? request.previous ?? undefined : comparison !== undefined ? { basis: request.basis, placements: response.candidates[Number(comparison)].placements } : undefined
  const reviewed = useMemo(() => {
    try { return candidate ? reviewCandidate(request.basis, candidate.placements, previous) : null } catch { return null }
  }, [request, candidate, previous?.basis, previous?.placements])
  const resources = request.basis.resources.filter(row => ['teacher', 'class', 'student_group', 'room'].includes(row.kind))
  const visibleResources = resources.filter(row => normalize(row.label).includes(normalize(query)))
  const resource = visibleResources.find(row => row.id === resourceId) ?? visibleResources[0]
  const schedule = reviewed?.rows.filter(row => row.resources.some(item => item.id === resource?.id)).sort((a, b) => a.slot.day - b.slot.day || a.slot.startMinute - b.slot.startMinute || a.label.localeCompare(b.label)) ?? []
  const presentDays = [...new Set(request.basis.slots.map(row => row.day))].sort((a, b) => a - b), selectedDay = presentDays.includes(day) ? day : presentDays[0]
  const daily = schedule.filter(row => row.slot.day === selectedDay), dailyPages = Math.max(1, Math.ceil(daily.length / pageSize)), dailyPage = Math.min(schedulePage, dailyPages - 1)
  const pages = Math.max(1, Math.ceil((reviewed?.changes.length ?? 0) / pageSize)), currentPage = Math.min(page, pages - 1)
  if (!reviewed) return <p role="alert">후보를 다시 검증하지 못했습니다. 계산 결과를 다시 확인해 주세요.</p>
  return <section className="timetable-candidate-review" aria-label="선택 후보 자세히 비교">
    <h3>후보 {selected + 1} 자세히 살펴보기</h3><p className="timetable-muted">비교와 조회만 합니다. 아래의 반영 확인 전에는 작업 배치가 바뀌지 않습니다.</p>
    <details><summary>수업별 바뀌는 부분 · {reviewed.compared ? `${reviewed.changes.length}개` : '비교할 배치 없음'}</summary>
      {options.length > 0 && <label>비교 기준<select aria-label="비교 기준" value={comparison} onChange={event => { setBaseline(event.target.value); setPage(0) }}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
      {reviewed.compared ? <><p>이동 {reviewed.counts.moved}개 · 배정 변경 {reviewed.counts.reassigned}개 · 추가 {reviewed.counts.added}개 · 제외 {reviewed.counts.removed}개</p><p className="timetable-muted">하나의 수업이 이동과 배정 변경에 함께 포함될 수 있습니다. 이전 배정은 당시 자료로 표시합니다.</p>
        {reviewed.changes.length ? <div className="timetable-foundation-table" role="region" aria-label="후보 수업 변경 비교표" tabIndex={0}><table><caption>비교 기준 → 선택 후보</caption><thead><tr><th scope="col">수업</th><th scope="col">변경 전</th><th scope="col">선택 후보</th></tr></thead><tbody>{reviewed.changes.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => <tr key={row.lessonId}><th scope="row">{row.after?.label ?? row.before?.label}<small>{[row.added && '추가', row.removed && '제외', row.moved && '이동', row.reassigned && '배정 변경'].filter(Boolean).join(' · ')}</small></th><td><Location row={row.before} /></td><td><Location row={row.after} /></td></tr>)}</tbody></table></div> : <p>실제 수업 시각과 배정이 같습니다.</p>}
        {pages > 1 && <nav className="timetable-actions" aria-label="후보 변경 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 변경</button><span>{currentPage + 1}/{pages}쪽 · 전체 {reviewed.changes.length}개</span><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 변경</button></nav>}
      </> : <p>처음 만든 후보 하나만 있어 비교할 배치가 없습니다. 아래에서 교사·학급별 배치를 확인해 주세요.</p>}
    </details>
    <details><summary>교사·학급별 후보 시간표</summary><div className="timetable-grid"><label>후보 시간표 대상 검색<input aria-label="후보 시간표 대상 검색" value={query} onChange={event => { setQuery(event.target.value); setSchedulePage(0) }} placeholder="교사·학급·교실" /></label><label>후보 시간표 대상<select aria-label="후보 시간표 대상" value={resource?.id ?? ''} disabled={!visibleResources.length} onChange={event => { setResourceId(event.target.value); setSchedulePage(0) }}>{visibleResources.length ? visibleResources.map(row => <option key={row.id} value={row.id}>{row.label} · {row.kind === 'teacher' ? '교사' : row.kind === 'room' ? '공간' : '학급·수강 집단'}</option>) : <option value="">검색 결과 없음</option>}</select></label></div>
      {resource && <><p><strong>{resource.label}</strong> · 주간 {schedule.reduce((sum, row) => sum + row.periods, 0)}차시</p><nav className="timetable-actions" aria-label="후보 시간표 요일">{presentDays.map(value => <button type="button" className="secondary" key={value} aria-pressed={value === selectedDay} onClick={() => { setDay(value); setSchedulePage(0) }}>{days[value - 1]}요일</button>)}</nav><ul className="timetable-list">{daily.slice(dailyPage * pageSize, (dailyPage + 1) * pageSize).map(row => <li key={row.lessonId}><strong>{row.label} · {row.periods}차시</strong><p><Location row={row} /></p></li>)}</ul>{!daily.length && <p>이 요일에 배정된 수업이 없습니다.</p>}{dailyPages > 1 && <nav className="timetable-actions" aria-label="후보 일과 쪽 이동"><button type="button" className="secondary" disabled={!dailyPage} onClick={() => setSchedulePage(dailyPage - 1)}>이전 수업</button><span>{dailyPage + 1}/{dailyPages}쪽</span><button type="button" className="secondary" disabled={dailyPage + 1 >= dailyPages} onClick={() => setSchedulePage(dailyPage + 1)}>다음 수업</button></nav>}</>}
    </details>
  </section>
}
