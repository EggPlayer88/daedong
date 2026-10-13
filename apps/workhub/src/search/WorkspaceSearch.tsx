import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { SearchItem, SearchKind, SearchSource } from './contracts'
import { filterSearchItems } from './presentation'
import searchStyles from './search.css?inline'
import { WorkspaceIcon } from '../app/WorkspaceIcon'

export interface WorkspaceSearchProps {
  sources: readonly SearchSource[]
  scopeKey: string
  locked?: boolean
  onOpen: (item: SearchItem) => boolean
}
export interface SearchSourceState {
  kind: SearchKind
  label: string
  status: 'loading' | 'ready' | 'failed'
  items: SearchItem[]
}
const kindLabels: Record<SearchKind, string> = { calendar: '학교 일정', task: '내 업무', collection: '자료 수합' }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// 각 조회의 세대를 분리해 닫힌 창·이전 범위·이전 재시도의 응답을 버린다.
// 생성만으로 조회하지 않는다. 취소 신호를 지원하지 않는 조회도 UI에 다시 게시하지 않는다.
export function createWorkspaceSearchLoader(publish: (states: SearchSourceState[]) => void) {
  let generation = 0
  let active = false
  let sources: readonly SearchSource[] = []
  let states: SearchSourceState[] = []
  const versions = new Map<SearchKind, number>()
  const emit = () => publish(states.map(row => ({ ...row, items: [...row.items] })))
  function load(source: SearchSource) {
    const epoch = generation
    const version = (versions.get(source.kind) ?? 0) + 1
    versions.set(source.kind, version)
    states = states.map(row => row.kind === source.kind ? { ...row, status: 'loading', items: [] } : row)
    emit()
    const current = () => active && epoch === generation && version === versions.get(source.kind)
    void Promise.resolve().then(() => current() ? source.load() : undefined).then(items => {
      if (!current()) return
      if (!Array.isArray(items) || items.some(item => !item || item.kind !== source.kind || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.meta !== 'string'
        || (item.searchValues !== undefined && (!Array.isArray(item.searchValues) || item.searchValues.some(value => typeof value !== 'string'))))) throw new Error('INVALID_SEARCH_RESULT')
      // 응답 객체의 부수 필드를 DOM이나 후속 선택으로 전파하지 않는다.
      const clean = items.map(item => ({ id: item.id, kind: item.kind, title: item.title, description: item.description, meta: item.meta, ...(item.searchValues ? { searchValues: [...item.searchValues] } : {}), ...(typeof item.date === 'string' ? { date: item.date } : {}), ...(typeof item.unitId === 'string' ? { unitId: item.unitId } : {}) }))
      states = states.map(row => row.kind === source.kind ? { ...row, status: 'ready', items: clean } : row)
      emit()
    }).catch(() => {
      if (!current()) return
      states = states.map(row => row.kind === source.kind ? { ...row, status: 'failed', items: [] } : row)
      emit()
    })
  }
  return {
    start(next: readonly SearchSource[]) {
      generation += 1; active = true; sources = next; versions.clear()
      states = next.map(source => ({ kind: source.kind, label: source.label, status: 'loading', items: [] }))
      emit()
      next.forEach(load)
    },
    retry(kind: SearchKind) {
      if (!active) return
      const source = sources.find(item => item.kind === kind)
      if (source) load(source)
    },
    stop() { active = false; generation += 1; sources = []; states = []; versions.clear() },
  }
}

const excerpt = (value: string, limit: number) => { const chars = Array.from(value.replace(/\s+/gu, ' ').trim()); return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : chars.join('') }
export function SearchResultsView({ states, query, kind, locked = false, onRetry, onOpen }: {
  states: readonly SearchSourceState[]; query: string; kind?: SearchKind; locked?: boolean
  onRetry: (kind: SearchKind) => void; onOpen: (item: SearchItem) => void
}) {
  const relevant = states.filter(source => !kind || source.kind === kind)
  const loading = relevant.some(source => source.status === 'loading')
  const failed = relevant.some(source => source.status === 'failed')
  const matches = filterSearchItems(relevant.flatMap(source => source.status === 'ready' ? source.items : []), query, kind)
  const partial = loading || failed
  return <div className="ws-search-results">
    <div className="ws-search-source-states" aria-label="검색 범위별 조회 상태">{relevant.map(source => <div key={source.kind} className={`ws-search-source ws-search-source-${source.status}`}>
      <span>{source.label}</span>{source.status === 'loading' ? <span role="status">불러오는 중…</span> : source.status === 'failed' ? <><span>불러오지 못했습니다</span><button type="button" onClick={() => onRetry(source.kind)} aria-label={`${source.label} 다시 불러오기`}>다시 불러오기</button></> : <span>조회 완료</span>}
    </div>)}</div>
    <p className="ws-search-count" role="status" aria-live="polite">{partial ? `현재 확인한 결과 ${matches.length}건` : `검색 결과 ${matches.length}건`}{matches.length > 50 ? ' · 앞의 50건 표시' : ''}{partial ? ' · 일부 자료는 아직 확인하지 못했습니다.' : ''}</p>
    {!matches.length && <p className="ws-search-empty">{loading ? '자료를 불러오고 있습니다. 잠시만 기다려 주세요.' : failed ? '확인한 자료에서는 일치하는 항목이 없습니다. 실패한 범위를 다시 불러와 주세요.' : states.length ? '일치하는 업무가 없습니다. 검색어나 범위를 바꿔 보세요.' : '현재 찾을 수 있는 업무 범위가 없습니다.'}</p>}
    {matches.length > 0 && <ul className="ws-search-list" aria-label="업무 검색 결과">{matches.slice(0, 50).map(item => <li key={`${item.kind}:${item.id}:${item.unitId ?? ''}`}><button className="ws-search-result" type="button" disabled={locked} onClick={() => onOpen(item)}>
      <span className="ws-search-kind">{kindLabels[item.kind]}</span><strong>{item.title}</strong><span className="ws-search-meta">{excerpt(item.meta, 150)}</span>{item.description && <span className="ws-search-excerpt">{excerpt(item.description, 150)}</span>}<span className="ws-search-open">원본 열기 <span aria-hidden="true">→</span></span>
    </button></li>)}</ul>}
    {matches.length > 50 && <p className="ws-search-hint">검색어나 범위를 좁히면 원하는 항목을 더 쉽게 찾을 수 있습니다.</p>}
  </div>
}

export function WorkspaceSearch(props: WorkspaceSearchProps) {
  // 같은 컴포넌트를 유지해도 범위 변경은 검색어와 결과를 즉시 새 상태로 교체한다.
  return <SearchWorkspace key={props.scopeKey} {...props} />
}
function SearchWorkspace({ sources, locked = false, onOpen }: WorkspaceSearchProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const managedCloseEvents = useRef(0)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<SearchKind | undefined>()
  const [notice, setNotice] = useState('')
  const [states, setStates] = useState<SearchSourceState[]>([])
  const [loader] = useState(() => createWorkspaceSearchLoader(setStates))
  useBrowserLayoutEffect(() => {
    if (!open) return
    dialog.current?.showModal()
    input.current?.focus()
    loader.start(sources)
    return () => loader.stop()
  }, [open, sources, loader])
  useEffect(() => () => { loader.stop(); dialog.current?.close() }, [loader])
  function close(restoreFocus = true) {
    loader.stop()
    if (dialog.current?.open) {
      // close 이벤트는 나중에 도착한다. 새 원본의 포커스를 옛 닫기 이벤트로 덮지 않는다.
      managedCloseEvents.current += 1
      dialog.current.close()
    }
    setOpen(false); setStates([]); setQuery(''); setKind(undefined); setNotice('')
    if (restoreFocus && trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus()
  }
  function handleNativeClose() {
    if (managedCloseEvents.current > 0) { managedCloseEvents.current -= 1; return }
    // 외부에서 닫힌 경우만 정리한다. 이전 닫기 이벤트가 재개방한 창을 닫지 않는다.
    if (dialog.current?.isConnected && !dialog.current.open) close()
  }
  function choose(item: SearchItem) {
    if (locked) return
    try { if (onOpen(item)) close(false); else setNotice('지금은 이 항목을 열 수 없습니다. 작성 중인 내용이나 현재 이용 범위를 확인해 주세요.') }
    catch { setNotice('항목을 열지 못했습니다. 잠시 뒤 다시 시도해 주세요.') }
  }
  return <div className="ws-search">
    <style>{searchStyles}</style>
    <button ref={trigger} type="button" className="ws-search-trigger" aria-haspopup="dialog" disabled={locked} onClick={() => { if (!locked) setOpen(true) }}><WorkspaceIcon name="search" />업무 찾기</button>
    <dialog ref={dialog} className="ws-search-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close() } }} onCancel={event => { event.preventDefault(); close() }} onClose={handleNativeClose}>
      {open && <><header className="ws-search-header"><div><p>{sources.map(source => source.label).join(' · ')}</p><h2 id={`${id}-title`}>업무 찾기</h2></div><button className="ws-search-close" type="button" onClick={() => close()} aria-label="업무 찾기 닫기">닫기</button></header>
      <div className="ws-search-body"><p className="ws-search-hint" id={`${id}-help`}>현재 이용할 수 있는 자료만 찾습니다. 검색어와 결과는 이 창을 닫으면 지워집니다.</p>
        <div className="ws-search-fields"><div className="ws-search-field"><label htmlFor={`${id}-query`}>검색어</label><input ref={input} id={`${id}-query`} type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="업무 제목이나 내용을 입력하세요" /></div><div className="ws-search-field"><label htmlFor={`${id}-kind`}>검색 범위</label><select id={`${id}-kind`} value={kind ?? ''} onChange={event => setKind((event.target.value || undefined) as SearchKind | undefined)}><option value="">전체</option>{sources.map(source => <option key={source.kind} value={source.kind}>{source.label}</option>)}</select></div></div>
        {locked && <p className="ws-search-notice" role="status">작성한 내용을 저장하거나 편집을 마친 뒤 항목을 열어 주세요.</p>}
        {notice && <p className="ws-search-notice" role="status">{notice}</p>}
        <SearchResultsView states={states} query={query} kind={kind} locked={locked} onRetry={sourceKind => loader.retry(sourceKind)} onOpen={choose} />
      </div></>}
    </dialog>
  </div>
}



