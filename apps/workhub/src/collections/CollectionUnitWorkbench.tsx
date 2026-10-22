import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { CollectionDetail } from './contracts'
import type { CollectionUnit } from '../workflows/types'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import { collectionUnitRows, filterCollectionUnits, UNIT_FILTERS, unitFilterLabels, type UnitFilter } from './unit-workbench'

interface Props {
  detail: CollectionDetail; memberId: string; date: string; locked: boolean; activeUnitId?: string
  children: (unit: CollectionUnit) => ReactNode
}
export function CollectionUnitWorkbench(props: Props) { return <Workbench key={props.detail.request.id} {...props} /> }
function Workbench({ detail, memberId, date, locked, activeUnitId, children }: Props) {
  const [filter, setFilter] = useState<UnitFilter>('all'), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const rows = useMemo(() => collectionUnitRows(detail, memberId, date), [detail, memberId, date])
  const matches = filterCollectionUnits(rows, filter, query), window = listWindow(matches, page)
  const pinned = rows.find(row => row.unit.id === activeUnitId && !window.items.some(item => item.unit.id === activeUnitId))
  const counts = new Map(UNIT_FILTERS.map(value => [value, filterCollectionUnits(rows, value, '').length]))
  function changeFilter(value: UnitFilter) { setFilter(value); setPage(0) }
  return <section className="cs-workbench" aria-label="제출 현황 찾기">
    <h4 ref={heading} tabIndex={-1}>제출 현황 · {rows.length.toLocaleString()}개 단위</h4>
    <div className="cs-workbench-filters" role="group" aria-label="제출 상태 선택">{UNIT_FILTERS.filter(value => value !== 'unavailable' || counts.get(value)).map(value => <button type="button" key={value} aria-pressed={filter === value} disabled={locked} onClick={() => changeFilter(value)}>{unitFilterLabels[value]} {counts.get(value)}</button>)}</div>
    <label className="cs-workbench-search">제출 단위·교사 찾기<input type="search" maxLength={200} value={query} disabled={locked} placeholder="단위 이름, 교사 이름 또는 소속 번호" onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
    <p className="cs-muted" role="status">현재 열람 가능한 단위 중 {matches.length.toLocaleString()}개 · {unitFilterLabels[filter]}{query.trim() ? ` · “${query.trim()}”` : ''}</p>
    {locked && <p className="cs-muted">작성하거나 처리 중인 단위를 유지합니다. 입력을 닫거나 처리 결과를 확인한 뒤 목록 조건을 바꿀 수 있습니다.</p>}
    {pinned && <div className="cs-workbench-pinned"><p className="cs-muted">작성 중인 단위를 현재 목록과 별도로 유지했습니다.</p>{children(pinned.unit)}</div>}
    {!matches.length && <p className="cs-empty">조건에 맞는 제출 단위가 없습니다.{(query || filter !== 'all') && <button type="button" disabled={locked} onClick={() => { setQuery(''); changeFilter('all') }}>검색 조건 초기화</button>}</p>}
    {window.items.map(row => <div key={row.unit.id} data-collection-unit={row.unit.id}>{children(row.unit)}</div>)}
    <ListPagination label="제출 현황 페이지" window={window} disabled={locked} onPageChange={value => { setPage(value); heading.current?.focus() }} />
    <details className="cs-workbench-help"><summary>현황 집계 기준</summary><p>수합에 참여하는 교사 수가 아닌 제출 단위 수입니다. 최신 제출·철회·보완·검토 기록을 기준으로 하며, ‘내가 참여’는 다른 상태와 겹칠 수 있습니다. 목록 필터는 저장·제출·검토 권한을 바꾸지 않습니다.</p></details>
  </section>
}
