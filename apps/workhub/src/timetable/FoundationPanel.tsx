import { useMemo, useState } from 'react'
import type { TimetableBasis } from './contracts'
import { reviewTimetableFoundation } from './foundation'
import { TimetablePreflightPanel } from './TimetablePreflightPanel'
import { reviewTimetablePreflight } from './preflight'

const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const pageSize = 25
export function FoundationPanel({ basis }: { basis: TimetableBasis | unknown }) {
  const review = useMemo(() => reviewTimetableFoundation(basis), [basis])
  const preflight = useMemo(() => reviewTimetablePreflight(basis), [basis])
  const ready = review.ready && preflight.canCalculate
  const issueCount = new Set([...review.issues, ...preflight.issues].map(issue => `${issue.code}:${issue.path}:${issue.code === 'UNSUPPORTED_FEATURE' ? issue.message : ''}`)).size
  const [query, setQuery] = useState(''), [mode, setMode] = useState<'courses' | 'resources'>('courses'), [page, setPage] = useState(0)
  const needle = query.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '')
  const includes = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '').includes(needle)
  const courseRows = review.courses.filter(row => includes([row.label, ...row.teacherLabels, ...row.groupLabels].join(' ')))
  const resourceRows = review.resources.filter(row => includes(row.label))
  const count = mode === 'courses' ? courseRows.length : resourceRows.length, pages = Math.max(1, Math.ceil(count / pageSize)), current = Math.min(page, pages - 1)
  return <div className="timetable-foundation">
    <div className={ready ? 'timetable-notice' : 'timetable-error'} role="status">
      <strong>{ready ? '기초 자료의 시수·배정·시간대 검사 통과' : `편성 전에 확인할 항목 ${issueCount}건`}</strong>
      <p>{ready ? '필요한 시수와 배정 시수가 일치합니다. 전체 조건을 만족하는 시간표가 존재하는지는 생성 단계에서 확인합니다.' : '원래 학교 자료를 임의로 고치지 않습니다. 학교 확정 자료는 기초 자료에서, 초안에 추가한 조건은 조건 정리에서 확인해 주세요.'}</p>
      {review.issues.length > 0 && <ul className="timetable-issues">{review.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message} <small>({issue.code})</small></li>)}</ul>}
    </div>
    <TimetablePreflightPanel basis={basis} report={preflight} />
    <details>
      <summary>수업 배정과 시수 살펴보기</summary>
      <div className="timetable-toolbar">
        <label>기초 자료 검색<input aria-label="기초 자료 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="교사·학급·수업 이름" /></label>
        <label>살펴볼 자료<select aria-label="살펴볼 기초 자료" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setPage(0) }}><option value="courses">수업별 시수·배정</option><option value="resources">교사·학급별 가능 시간</option></select></label>
      </div>
      <p className="timetable-muted" role="status">검색 결과 {count}건 · {current + 1}/{pages}쪽</p>
      {mode === 'courses' ? <div className="timetable-foundation-table" tabIndex={0} role="region" aria-label="수업별 시수와 담당 표"><table><caption>공식 시수와 수업 활동의 배정 비교</caption><thead><tr><th scope="col">수업</th><th scope="col">기준 / 배정</th><th scope="col">교사</th><th scope="col">학급·학생 집단</th></tr></thead><tbody>{courseRows.slice(current * pageSize, (current + 1) * pageSize).map(row => <tr key={row.id}><th scope="row">{row.label}<small>{row.lessonCount}개 수업 활동</small></th><td>{row.required ?? '미확인'} / {row.assigned}차시</td><td>{row.teacherLabels.join(' · ') || '배정 확인 필요'}</td><td>{row.groupLabels.join(' · ') || '대상 확인 필요'}</td></tr>)}</tbody></table></div>
        : <ul className="timetable-list">{resourceRows.slice(current * pageSize, (current + 1) * pageSize).map(row => <li key={row.id}><strong>{row.label}</strong><span className="timetable-badge">배정 {row.assigned}차시 / 배치 가능 상한 {row.availableUpperBound}차시</span><p className="timetable-muted">{row.days.map(day => `${days[day.day - 1]} ${day.availablePeriods}차시${day.firstMinute !== null && day.lastMinute !== null ? ` (${clock(day.firstMinute)}–${clock(day.lastMinute)})` : ''}`).join(' · ')}</p></li>)}</ul>}
      {!count && <p>검색어에 맞는 자료가 없습니다.</p>}
      {pages > 1 && <nav className="timetable-actions" aria-label="기초 자료 쪽 이동"><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 자료</button><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 자료</button></nav>}
      <p className="timetable-muted">가능 시간은 수업별 허용 시간대와 사용 불가 시간을 기준으로 계산한 상한입니다. 빈 시간을 모두 채워야 한다는 뜻은 아닙니다. 학년별 일과 차이도 각 수업의 허용 시간대에서 확인합니다.</p>
    </details>
  </div>
}
