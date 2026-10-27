import { ComposerOptions } from '../app/ComposerOptions'
import { useMemo, useState } from 'react'
import { evaluateTimetableQuality } from '../../../../packages/timetable/src/quality'
import { validatePlacements } from '../../../../packages/timetable/src/validate'
import type { TimetableBasis, Placement } from './contracts'

const days = ['월', '화', '수', '목', '금', '토', '일']
export function TimetableQualitySummary({ basis, placements, previous, previousBasis }: { basis: TimetableBasis; placements: Placement[]; previous: Placement[] | null; previousBasis?: TimetableBasis }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const result = useMemo(() => evaluateTimetableQuality(basis, placements, previous && validatePlacements(previousBasis ?? basis, previous).valid ? { basis: previousBasis ?? basis, placements: previous } : undefined), [basis, placements, previous, previousBasis])
  if (!result.valid) return <p className="timetable-muted">현재 배치의 필수조건을 먼저 해결하면 품질과 교사별 부담을 비교할 수 있습니다.</p>
  const loads = result.teacherLoads.filter(row => row.label.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase().trim()))
  const pages = Math.max(1, Math.ceil(loads.length / 25)), current = Math.min(page, pages - 1)
  return <section aria-label="편성 후보 품질" className="timetable-quality">
    <h3>배치 검토 요약</h3><dl className="timetable-summary"><div><dt>시수 배정</dt><dd>{result.scheduledPeriods} / {result.requiredPeriods}차시</dd></div><div><dt>선호 벌점</dt><dd>{result.preferencePenalty}</dd></div><div><dt>교사 하루 최대</dt><dd>{Math.max(0, ...result.teacherLoads.map(row => row.maxDailyPeriods))}차시</dd></div><div><dt>직전 배치와 비교</dt><dd>{result.changes ? `${result.changes.moved}개 이동` : '비교 전'}</dd></div></dl>
    <ComposerOptions className="tt-workflow-help" summary="점수와 비교 기준 읽는 법"><p className="timetable-muted">선호 벌점은 낮을수록 좋습니다. 조건이 달라진 후보 사이의 벌점은 직접 비교하지 않습니다. 최적 시간표라고 보장하는 점수는 아닙니다.</p></ComposerOptions>
    <details><summary>교사별 수업 부담과 요일 분포</summary><label>부담을 확인할 교사<input aria-label="부담을 확인할 교사" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="교사 이름" /></label><ul className="timetable-list">{loads.slice(current * 25, (current + 1) * 25).map(row => <li key={row.resourceId}><strong>{row.label} · 총 {row.totalPeriods}차시</strong><p>{row.days.map(day => `${days[day.day - 1]} ${day.periods}차시`).join(' · ')}</p><small>수업 사이 간격(휴식 포함): {row.days.reduce((sum, day) => sum + day.idleMinutes, 0)}분 · 하루 최대 {row.maxDailyPeriods}차시</small></li>)}</ul>{!loads.length && <p>검색한 교사가 없습니다.</p>}{pages > 1 && <nav className="timetable-actions" aria-label="교사별 부담 쪽 이동"><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 교사</button><span>{current + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 교사</button></nav>}<p className="timetable-muted">간격에는 점심과 쉬는 시간이 포함됩니다. 공강 교시 수나 근무 부담의 확정값으로 해석하지 마세요.</p></details>
  </section>
}
