import { useState } from 'react'
import { useEditSession } from '../app/EditSession'
import { collectionUnitStateLabels, collectionUnitStates, filterCollectionUnits, type CollectionUnitState, type CollectionWorkbench as WorkbenchData } from './collection-workbench'

const pageSize = 20
export function CollectionWorkbench({ data, onOpenUnit, selectedUnitId }: { data: WorkbenchData; onOpenUnit: (id: string) => void; selectedUnitId?: string }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'all' | CollectionUnitState>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page, setPage] = useState(0)
  const requestChange = useEditSession()
  const filtered = filterCollectionUnits(data.rows, query, state, overdueOnly)
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const shown = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  function change(action: () => void) { requestChange(() => { action(); setPage(0) }) }
  return <section className="wf-workbench" aria-label="제출 단위 진행현황">
    <div className="wf-section-title"><h4>제출 단위 진행현황</h4><span>현재 열람 가능한 {data.rows.length}부 · 기한 초과 {data.overdueCount}부</span></div>
    <div className="wf-state-filters" role="group" aria-label="제출 단위 상태 필터">
      <button type="button" aria-pressed={state === 'all'} onClick={() => change(() => setState('all'))}>전체 <strong>{data.rows.length}</strong></button>
      {collectionUnitStates.map(value => <button type="button" key={value} aria-pressed={state === value} onClick={() => change(() => setState(value))}>{collectionUnitStateLabels[value]} <strong>{data.counts[value]}</strong></button>)}
    </div>
    <div className="wf-workbench-controls"><label className="wf-grow">제출 단위 찾기<input type="search" value={query} maxLength={100} placeholder="단위 이름 또는 책임자" onChange={event => change(() => setQuery(event.target.value))} /></label><label className="wf-checkbox"><input type="checkbox" checked={overdueOnly} onChange={event => change(() => setOverdueOnly(event.target.checked))} />기한 초과만</label>{(query || state !== 'all' || overdueOnly) && <button type="button" className="text-button" onClick={() => change(() => { setQuery(''); setState('all'); setOverdueOnly(false) })}>단위 필터 초기화</button>}</div>
    <p className="wf-hint" role="status">조건에 맞는 {filtered.length}부{filtered.length > pageSize ? ` · ${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)}부 표시` : ''}. 상태 필터는 아래 원본과 완료본 합계를 바꾸지 않습니다.</p>
    {shown.length > 0 && <p className="wf-hint wf-table-scroll-hint">표를 좌우로 이동하면 기한과 원본 보기 버튼을 확인할 수 있습니다.</p>}
    {shown.length > 0 ? <div className="wf-workbench-scroll" role="region" aria-label="제출 단위 진행표" tabIndex={0}><table className="wf-workbench-table"><caption className="sr-only">제출 단위별 책임자, 진행상태, 기한, 현재판과 완료판</caption><thead><tr><th scope="col">제출 단위 · 책임자</th><th scope="col">진행상태</th><th scope="col">처리 기한</th><th scope="col">현재 / 완료</th><th scope="col">원본</th></tr></thead><tbody>{shown.map(row => <tr key={row.id} className={selectedUnitId === row.id ? 'is-selected' : undefined} data-wf-progress-unit={row.id}>
      <th scope="row"><strong>{row.label}</strong><small>{row.responsibleName}</small></th><td><span className={`wf-badge wf-unit-state-${row.state}`}>{collectionUnitStateLabels[row.state]}</span><small>{row.nextStep}{row.pendingSupplementCount ? ` · 남은 보완 ${row.pendingSupplementCount}건` : ''}</small>{row.initiallyLate && <small>최초 제출 지연</small>}</td><td>{row.dueDate}<small className={row.overdue ? 'wf-overdue-label' : undefined}>{row.overdue ? row.pendingSupplementCount ? '보완 기한 초과' : '미제출 기한 초과' : row.pendingSupplementCount ? '보완 기한' : '수합 마감'}</small></td><td><span>{row.currentRevision ? `v${row.currentRevision}` : '없음'} / {row.effectiveRevision ? `v${row.effectiveRevision}` : '없음'}</span></td><td><button type="button" className="secondary small" aria-label={`${row.label} 제출 단위 원본 보기`} onClick={() => requestChange(() => onOpenUnit(row.id))}>원본 보기</button></td>
    </tr>)}</tbody></table></div> : <p className="wf-empty">조건에 맞는 제출 단위가 없습니다. 필터를 바꾸면 다른 단위를 확인할 수 있습니다.</p>}
    {lastPage > 0 && <nav className="wf-table-pages" aria-label="제출 단위 표 페이지"><button type="button" className="secondary small" disabled={currentPage === 0} onClick={() => requestChange(() => setPage(currentPage - 1))}>이전</button><span>{currentPage + 1} / {lastPage + 1}쪽</span><button type="button" className="secondary small" disabled={currentPage >= lastPage} onClick={() => requestChange(() => setPage(currentPage + 1))}>다음</button></nav>}
    <p className="wf-hint">완료본과 새 판은 따로 표시합니다. 새 판을 처리하는 동안에도 이전 완료본이 합계에 남습니다. 공동 초안 내용은 이 표에 표시하지 않습니다.</p>
  </section>
}
