import { useMemo, useState } from 'react'
import type { PreparationDraft, PreparationSource } from './preparation'
import { filterPreparationProgress, preparationProgress, type PreparationProgressFilter } from './preparation-progress'
import './preparation-progress.css'

interface Props { source: PreparationSource; draft: PreparationDraft; onSelectCourse: (id: string) => void; disabled?: boolean }
const filters: { key: PreparationProgressFilter; label: string }[] = [{ key: 'all', label: '전체 수업' }, { key: 'hours', label: '시수 확인' }, { key: 'activities', label: '활동 구성 확인' }, { key: 'slots', label: '허용 시간대 확인' }, { key: 'resources', label: '교사·학생 연결 확인' }, { key: 'ready', label: '기본 입력 채움' }]
const kinds = { teacher: '교사', class: '학급', student_group: '수강 집단', room: '공간', equipment: '장비' }
export function PreparationProgressPanel({ source, draft, onSelectCourse, disabled = false }: Props) {
  const review = useMemo(() => preparationProgress(source, draft), [source, draft])
  const [filter, setFilter] = useState<PreparationProgressFilter>('all'), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [resourceQuery, setResourceQuery] = useState(''), [resourceKind, setResourceKind] = useState('all'), [resourcePage, setResourcePage] = useState(0)
  const rows = filterPreparationProgress(review.courses, filter, query), pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages - 1)
  const needle = resourceQuery.trim().toLocaleLowerCase('ko-KR'), resources = review.resources.filter(row => (resourceKind === 'all' || row.kind === resourceKind) && (!needle || `${row.label} ${row.id}`.toLocaleLowerCase('ko-KR').includes(needle))), resourcePages = Math.max(1, Math.ceil(resources.length / 20)), currentResourcePage = Math.min(resourcePage, resourcePages - 1)
  return <section className="timetable-preparation-progress" aria-label="시수·활동 입력 점검"><h3>시수·활동 입력 점검</h3>
    {!review.available ? <p role="alert">공식 준비 자료를 읽을 수 없어 입력 현황을 계산하지 못했습니다. 자료를 다시 확인해 주세요.</p> : <>
      <p className="timetable-progress-summary">전체 {review.counts.all}개 수업 중 기본 입력 채움 {review.counts.ready}개 · 확인 필요 {review.counts.all - review.counts.ready}개</p>
      <p className="timetable-muted">현재 입력의 누락 점검입니다. 모든 항목을 채워도 시간 충돌·학교 조건·서버 검사를 통과해야 기준판을 만들 수 있습니다.</p>
      {review.structuralProblem && <p role="alert">초안의 형식이나 공식 자료와 맞지 않는 항목이 있습니다. 원래 입력은 유지됩니다.{review.unexpectedPlans > 0 && ` 공식 목록에 없는 수업 계획 ${review.unexpectedPlans}개를 확인해 주세요.`}</p>}
      <details><summary>확인할 수업 찾아가기</summary><div className="timetable-progress-controls"><label>입력 점검 분류<select aria-label="입력 점검 분류" value={filter} onChange={event => { setFilter(event.target.value as PreparationProgressFilter); setPage(0) }}>{filters.map(item => <option key={item.key} value={item.key}>{item.label} ({review.counts[item.key]})</option>)}</select></label><label>점검할 수업 검색<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="수업·교사·학급 이름 또는 ID" /></label></div>
        <p role="status">조건에 맞는 수업 {rows.length}개 · {currentPage + 1}/{pages}쪽</p>
        {!rows.length && <p>이 조건에 해당하는 수업이 없습니다.</p>}
        <ul className="timetable-progress-courses">{rows.slice(currentPage * 20, (currentPage + 1) * 20).map(row => <li key={row.courseId}><strong>{row.label || '이름 없는 수업'} [{row.courseId}]</strong><span>주당 {row.weeklyPeriods ?? '미입력'}차시 · 활동 {row.activityCount}개 / {row.activityPeriods ?? '확인 필요'}차시</span><small className="timetable-muted">{row.resourceLabels.join(' · ') || '교사·학생 연결 없음'}</small><p>{row.ready ? '기본 입력 채움' : row.notes.join(' · ')}</p><button type="button" className="secondary" disabled={disabled} onClick={() => onSelectCourse(row.courseId)}>{row.label || '이름 없는 수업'} [{row.courseId}] 입력으로 이동</button></li>)}</ul>
        {pages > 1 && <nav className="timetable-actions" aria-label="입력 점검 수업 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 수업</button><span>{currentPage + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 수업</button></nav>}
      </details>
      <details><summary>교사·학급별 배정 시수 보기</summary><p className="timetable-muted">입력한 주당 시수를 각 담당 교사·학급·수강 집단에 합산합니다. 미입력 또는 공식 시수와 다른 수업은 미정으로 표시합니다. 허용 시간대와 동시 수업 조건이 있으므로 이 합계만으로 과부하를 판정하지 않습니다.</p><div className="timetable-progress-controls"><label>시수 요약 대상<select aria-label="시수 요약 대상" value={resourceKind} onChange={event => { setResourceKind(event.target.value); setResourcePage(0) }}><option value="all">전체</option><option value="teacher">교사</option><option value="class">학급</option><option value="student_group">수강 집단</option></select></label><label>시수 요약 검색<input type="search" value={resourceQuery} onChange={event => { setResourceQuery(event.target.value); setResourcePage(0) }} placeholder="이름 또는 ID" /></label></div><p role="status">대상 {resources.length}명/집단 · {currentResourcePage + 1}/{resourcePages}쪽</p>
        <ul className="timetable-progress-resources">{resources.slice(currentResourcePage * 20, (currentResourcePage + 1) * 20).map(row => <li key={row.id}><strong>{kinds[row.kind]} · {row.label || '이름 없음'} [{row.id}]</strong><span>연결 수업 {row.courseIds.length}개 · 입력된 시수 합계 {row.weeklyPeriods}차시{row.unknownCourses > 0 && ` + 미정 ${row.unknownCourses}개 수업`}</span></li>)}</ul>{!resources.length && <p>이 조건에 해당하는 교사·학급·수강 집단이 없습니다.</p>}
        {resourcePages > 1 && <nav className="timetable-actions" aria-label="시수 요약 쪽 이동"><button type="button" className="secondary" disabled={!currentResourcePage} onClick={() => setResourcePage(currentResourcePage - 1)}>이전 대상</button><span>{currentResourcePage + 1}/{resourcePages}쪽</span><button type="button" className="secondary" disabled={currentResourcePage + 1 >= resourcePages} onClick={() => setResourcePage(currentResourcePage + 1)}>다음 대상</button></nav>}
      </details>
    </>}
  </section>
}
