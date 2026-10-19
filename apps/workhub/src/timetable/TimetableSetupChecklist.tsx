import { useMemo, useState } from 'react'
import type { SetupSnapshot } from './setup'
import { setupChecklist, setupChecklistText, type SetupAction } from './setup-checklist'
import { requestBlobDownload } from '../files/download'

interface Props { source: SetupSnapshot; disabled: boolean; onOpen: (action: SetupAction) => void; onOpenSchoolAdmin?: () => void }
export function TimetableSetupChecklist({ source, disabled, onOpen, onOpenSchoolAdmin }: Props) {
  const review = useMemo(() => setupChecklist(source), [source])
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(0), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const rows = review.items.filter(item => filter === 'all' || item.group === filter), pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages - 1)
  function download() { try { requestBlobDownload(new Blob([setupChecklistText(source)], { type: 'text/plain;charset=utf-8' }), '시간표_준비점검표.txt'); setNotice('준비 점검표 내려받기를 요청했습니다.'); setError('') } catch { setError('점검표를 내려받지 못했습니다. 현재 입력은 유지됩니다.') } }
  return <section className="timetable-setup-checklist" aria-label="시간표 준비 점검"><h3>먼저 확인할 준비 항목</h3>
    <div className="timetable-setup-overview"><span>학생 집단 연결 {review.connectedCourses}/{review.activeCourses}개 수업</span><span>사용 공간의 동시 수업 수 {review.spacesReady}/{review.spacesUsed}개 입력</span></div>
    <p className="timetable-muted">연결 현황입니다. 이 숫자가 모두 채워져도 시수·일과와 편성 조건을 별도로 검사해야 합니다.</p>
    <details><summary>편성 전 확인할 항목 {review.items.length}건</summary><label>준비 점검 항목<select aria-label="준비 점검 항목" value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">전체</option><option value="connection">수업·학급·공간 연결</option><option value="capacity">공간 동시 수업 수</option><option value="official">공식 학기·교사 배정</option></select></label>
      {!rows.length && <p>이 분류에 표시할 진단이 없습니다. 시수·일과 준비와 기준판 검사를 이어가세요.</p>}
      <ul className="timetable-issues">{rows.slice(currentPage * 20, (currentPage + 1) * 20).map(item => <li key={item.id}><strong>{item.blocksConfirm ? '확정 전 해결' : '입력 확인'}</strong> · {item.message}<small className="timetable-muted"> 대상 [{item.target}]</small><div className="timetable-actions">{item.actions.map(action => <button key={action.kind + action.id} type="button" className="secondary" disabled={disabled} onClick={() => onOpen(action)}>{action.label} [{action.id}] {action.kind === 'space' ? '동시 수업 수 확인' : '연결 확인'}</button>)}{item.needsSchoolAdmin && (onOpenSchoolAdmin ? <button type="button" className="secondary" disabled={disabled} onClick={onOpenSchoolAdmin}>공식 자료 학교 관리에서 확인</button> : <span>학교 관리에서 공식 자료를 확인해 주세요.</span>)}</div></li>)}</ul>
      {pages > 1 && <nav aria-label="준비 점검 쪽 이동" className="timetable-actions"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 점검 항목</button><span>{currentPage + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 점검 항목</button></nav>}
    </details><button type="button" className="secondary" disabled={disabled} onClick={download}>준비 점검표 내려받기</button>{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
