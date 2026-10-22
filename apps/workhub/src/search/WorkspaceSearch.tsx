import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { SearchItem, SearchKind, SearchSource } from './contracts'
import { searchKindLabels } from './contracts'
import { SEARCH_LIMITS } from './limits'
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
  status: 'loading' | 'ready' | 'failed' | 'unavailable'
  items: SearchItem[]
  coverage?: string
  nextCursor?: string | null
  scanned?: number
  moreLoading?: boolean
  moreFailed?: boolean
  pages?: number
}
const kindLabels = searchKindLabels
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// 각 조회의 세대를 분리해 닫힌 창·이전 범위·이전 재시도의 응답을 버린다.
// 생성만으로 조회하지 않는다. 취소 신호를 지원하지 않는 조회도 UI에 다시 게시하지 않는다.
export function createWorkspaceSearchLoader(publish: (states: SearchSourceState[]) => void) {
  let generation = 0
  let active = false
  let sources: readonly SearchSource[] = []
  let states: SearchSourceState[] = []
  let query = ''
  const versions = new Map<SearchKind, number>()
  const controllers = new Map<SearchKind, AbortController>()
  let activeLoads = 0
  let queued: (() => void)[] = []
  function drain() {
    while (active && activeLoads < SEARCH_LIMITS.concurrentSources && queued.length) {
      activeLoads += 1; queued.shift()!()
    }
  }
  const emit = () => publish(states.map(row => ({ ...row, items: [...row.items] })))
  function load(source: SearchSource, more = false) {
    const epoch = generation
    const previous = states.find(row => row.kind === source.kind)
    if (more && (!previous?.nextCursor || previous.moreLoading)) return
    controllers.get(source.kind)?.abort()
    const controller = new AbortController(); controllers.set(source.kind, controller)
    const version = (versions.get(source.kind) ?? 0) + 1
    versions.set(source.kind, version)
    states = states.map(row => row.kind === source.kind ? more ? { ...row, moreLoading: true, moreFailed: false } : {kind:row.kind,label:row.label,status:'loading',items:[]} : row)
    emit()
    const current = () => active && epoch === generation && version === versions.get(source.kind)
    queued.push(() => { void Promise.resolve().then(() => current() ? source.load({query,cursor:more ? previous?.nextCursor : null,signal:controller.signal}) : undefined).then(result => {
      if (!current()) return
      const paged = !Array.isArray(result) && result && typeof result === 'object' ? result : undefined
      const items = Array.isArray(result) ? result : paged?.items
      if (paged && (typeof paged.coverage !== 'string' || paged.coverage.length > 1000 || !(paged.nextCursor === null || typeof paged.nextCursor === 'string' && paged.nextCursor.length > 0 && paged.nextCursor.length <= SEARCH_LIMITS.cursorChars) || (paged.scanned !== undefined && (!Number.isSafeInteger(paged.scanned) || paged.scanned < 0)))) throw new Error('INVALID_SEARCH_PAGE')
      if (more && paged?.nextCursor && paged.nextCursor === previous?.nextCursor) throw new Error('REPEATED_SEARCH_CURSOR')
      if (!Array.isArray(items) || items.some(item => !item || item.kind !== source.kind || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.meta !== 'string'
        || (item.version !== undefined && (!Number.isSafeInteger(item.version) || item.version < 1))
        || (item.locator !== undefined && typeof item.locator !== 'string')
        || (item.searchValues !== undefined && (!Array.isArray(item.searchValues) || item.searchValues.some(value => typeof value !== 'string'))))) throw new Error('INVALID_SEARCH_RESULT')
      // 응답 객체의 부수 필드를 DOM이나 후속 선택으로 전파하지 않는다.
      const clean = items.map(item => ({ id: item.id, kind: item.kind, title: item.title, description: item.description, meta: item.meta, ...(item.searchValues ? { searchValues: [...item.searchValues] } : {}), ...(typeof item.date === 'string' ? { date: item.date } : {}), ...(typeof item.unitId === 'string' ? { unitId: item.unitId } : {}), ...(item.version !== undefined ? {version:item.version}:{}), ...(item.locator !== undefined ? {locator:item.locator}:{}) }))
      const combined = more ? [...new Map([...(previous?.items ?? []),...clean].map(item=>[`${item.kind}:${item.id}:${item.unitId??''}`,item])).values()] : clean
      const pages = (more ? previous?.pages ?? 0 : 0) + 1
      const limited = combined.length > SEARCH_LIMITS.itemsPerSource || Boolean(paged?.nextCursor && (pages >= SEARCH_LIMITS.pagesPerSource || combined.length >= SEARCH_LIMITS.itemsPerSource))
      states = states.map(row => row.kind === source.kind ? { ...row, status: 'ready', items: combined.slice(0,SEARCH_LIMITS.itemsPerSource), coverage:[paged?.coverage,limited?'한 번에 조회하는 범위에 도달했습니다. 검색어를 좁히거나 해당 메뉴에서 확인해 주세요.':undefined].filter(Boolean).join(' · ')||undefined,nextCursor:limited?null:paged?.nextCursor??null,scanned:(more?previous?.scanned??0:0)+(paged?.scanned??items.length),pages,moreLoading:false,moreFailed:false } : row)
      emit()
    }).catch(failure => {
      if (!current()) return
      if (failure?.code === 'CANCELLED') {
        // 계정·권한 변경 신호면 앞쪽 자료도 신뢰하지 않는다. 다른 자료원의 늦은 응답까지 폐기한다.
        generation += 1; queued = []; activeLoads = 0; versions.clear()
        for (const pending of controllers.values()) pending.abort()
        controllers.clear()
        states = states.map(row=>({kind:row.kind,label:row.label,status:'unavailable',items:[]}));emit();return
      }
      const unavailable = ['NOT_READY','FORBIDDEN','INACTIVE_MEMBERSHIP','UNAVAILABLE'].includes(failure?.code)
      states = states.map(row => row.kind === source.kind ? more && !unavailable ? {...row,moreLoading:false,moreFailed:true} : {kind:row.kind,label:row.label,status:unavailable?'unavailable':'failed',items:[]} : row)
      emit()
    }).finally(()=>{if(epoch===generation){activeLoads-=1;drain()}}) })
    drain()
  }
  return {
    start(next: readonly SearchSource[], requestedQuery = '') {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear(); query = requestedQuery
      generation += 1; active = true; sources = next; versions.clear();activeLoads=0;queued=[]
      states = next.map(source => ({ kind: source.kind, label: source.label, status: 'loading', items: [] }))
      emit()
      next.forEach(source=>load(source))
    },
    retry(kind: SearchKind) {
      if (!active) return
      const source = sources.find(item => item.kind === kind)
      if (source) load(source)
    },
    more(kind: SearchKind) { if(!active)return;const source=sources.find(item=>item.kind===kind);if(source)load(source,true) },
    stop() { active = false; generation += 1; sources = []; states = []; versions.clear();queued=[];activeLoads=0;for(const controller of controllers.values())controller.abort();controllers.clear() },
  }
}

const excerpt = (value: string, limit: number) => { const chars = Array.from(value.replace(/\s+/gu, ' ').trim()); return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : chars.join('') }
export function SearchResultsView({ states, query, kind, locked = false, moreDisabled = false, onRetry, onMore, onOpen }: {
  states: readonly SearchSourceState[]; query: string; kind?: SearchKind; locked?: boolean
  onRetry: (kind: SearchKind) => void; onOpen: (item: SearchItem) => void
  onMore?: (kind: SearchKind) => void
  moreDisabled?: boolean
}) {
  const [visible,setVisible] = useState(50)
  const sourceHeading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>setVisible(50),[query,kind])
  const relevant = states.filter(source => !kind || source.kind === kind)
  const loading = relevant.some(source => source.status === 'loading')
  const failed = relevant.some(source => source.status === 'failed')
  const unavailable = relevant.some(source=>source.status==='unavailable')
  const limited = relevant.some(source=>Boolean(source.nextCursor || source.coverage || source.moreFailed))
  const matches = filterSearchItems(relevant.flatMap(source => source.status === 'ready' ? source.items : []), query, kind)
  const partial = loading || failed || unavailable || limited
  return <div className="ws-search-results">
    <p className="ws-search-count" role="status" aria-live="polite">{partial ? `현재 확인한 결과 ${matches.length}건` : `검색 결과 ${matches.length}건`}{matches.length > visible ? ` · 앞의 ${visible}건 표시` : ''}{partial ? ' · 아래 조회 범위 안의 결과이며 전체 보관 자료 수가 아닙니다.' : ''}</p>
    <button className="ws-search-scope-link" type="button" onClick={()=>{sourceHeading.current?.scrollIntoView({block:'nearest'});sourceHeading.current?.focus()}}>조회 범위와 추가 자료 확인</button>
    {!matches.length && <p className="ws-search-empty">{loading ? '자료를 불러오고 있습니다. 잠시만 기다려 주세요.' : failed ? '확인한 자료에서는 일치하는 항목이 없습니다. 실패한 범위를 다시 불러와 주세요.' : unavailable || limited ? '현재 조회한 범위에서는 일치하는 항목이 없습니다. 연결 상태나 추가 조회를 확인해 주세요.' : states.length ? '일치하는 업무가 없습니다. 검색어나 범위를 바꿔 보세요.' : '현재 찾을 수 있는 업무 범위가 없습니다.'}</p>}
    {matches.length > 0 && <ul className="ws-search-list" aria-label="업무 검색 결과">{matches.slice(0, visible).map(item => <li key={`${item.kind}:${item.id}:${item.unitId ?? ''}`}><button className="ws-search-result" type="button" disabled={locked} onClick={() => onOpen(item)}>
      <span className="ws-search-kind">{kindLabels[item.kind]}</span><strong>{item.title}</strong><span className="ws-search-meta">{excerpt(item.meta, 150)}</span>{item.description && <span className="ws-search-excerpt">{excerpt(item.description, 150)}</span>}<span className="ws-search-open">{item.kind==='menu'?'메뉴 열기':'원본 열기'} <span aria-hidden="true">→</span></span>
    </button></li>)}</ul>}
    {matches.length > visible && <button type="button" className="ws-search-more" onClick={()=>setVisible(value=>value+50)}>조회한 결과 더 보기</button>}
    <h3 className="ws-search-scope-heading" tabIndex={-1} ref={sourceHeading}>조회 범위와 추가 자료</h3>
    <div className="ws-search-source-states" aria-label="검색 범위별 조회 상태">{relevant.map(source => <div key={source.kind} className={`ws-search-source ws-search-source-${source.status}`}>
      <span>{source.label}</span>{source.status === 'loading' ? <span role="status">불러오는 중…</span> : source.status === 'failed' || source.status === 'unavailable' ? <><span>{source.status==='unavailable'?'연결 또는 이용 권한 확인 필요':'불러오지 못했습니다'}</span><button type="button" onClick={() => onRetry(source.kind)} aria-label={`${source.label} 다시 불러오기`}>다시 불러오기</button></> : <><span>{source.nextCursor?'일부 조회':'조회 완료'}</span>{source.coverage&&<span>{source.coverage}</span>}{source.nextCursor&&onMore&&<button type="button" disabled={source.moreLoading||moreDisabled} onClick={()=>onMore(source.kind)} aria-label={`${source.label} 자료 더 조회`}>{source.moreLoading?'불러오는 중…':source.moreFailed?'다음 자료 다시 조회':'자료 더 조회'}</button>}{source.moreFailed&&<span role="alert">추가 조회 실패 · 확인한 결과는 유지했습니다.</span>}</>}
    </div>)}</div>
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
  const [submitted,setSubmitted]=useState({query:'',version:0})
  const [kind, setKind] = useState<SearchKind | undefined>()
  const [notice, setNotice] = useState('')
  const [states, setStates] = useState<SearchSourceState[]>([])
  const [loader] = useState(() => createWorkspaceSearchLoader(setStates))
  useBrowserLayoutEffect(() => {
    if (!open) return
    dialog.current?.showModal()
    input.current?.focus()
    loader.start(sources,submitted.query)
    return () => loader.stop()
  }, [open, sources, loader, submitted])
  useEffect(() => () => { loader.stop(); dialog.current?.close() }, [loader])
  function close(restoreFocus = true) {
    loader.stop()
    if (dialog.current?.open) {
      // close 이벤트는 나중에 도착한다. 새 원본의 포커스를 옛 닫기 이벤트로 덮지 않는다.
      managedCloseEvents.current += 1
      dialog.current.close()
    }
    setOpen(false); setStates([]); setQuery(''); setSubmitted({query:'',version:0}); setKind(undefined); setNotice('')
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
      {open && <><header className="ws-search-header"><div><p>메뉴와 업무 자료를 한곳에서</p><h2 id={`${id}-title`}>업무 찾기</h2></div><button className="ws-search-close" type="button" onClick={() => close()} aria-label="업무 찾기 닫기">닫기</button></header>
      <div className="ws-search-body"><p className="ws-search-hint" id={`${id}-help`}>현재 이용할 수 있는 자료만 찾습니다. 검색어와 결과는 이 창을 닫으면 지워집니다.</p>
        <form onSubmit={event=>{event.preventDefault();setSubmitted(value=>({query:query.trim(),version:value.version+1}))}}><div className="ws-search-fields"><div className="ws-search-field"><label htmlFor={`${id}-query`}>검색어</label><input ref={input} id={`${id}-query`} type="search" autoComplete="off" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="메뉴·문서·업무 이름을 입력하세요" /></div><div className="ws-search-field"><label htmlFor={`${id}-kind`}>검색 범위</label><select id={`${id}-kind`} value={kind ?? ''} onChange={event => setKind((event.target.value || undefined) as SearchKind | undefined)}><option value="">전체</option>{sources.map(source => <option key={source.kind} value={source.kind}>{source.label}</option>)}</select></div></div><button className="ws-search-submit" type="submit">자료 검색</button></form>
        {query.trim()!==submitted.query&&<p className="ws-search-hint" role="status">불러온 자료에서 먼저 찾았습니다. Enter 또는 자료 검색을 누르면 제목·본문까지 다시 찾습니다.</p>}
        {locked && <p className="ws-search-notice" role="status">작성한 내용을 저장하거나 편집을 마친 뒤 항목을 열어 주세요.</p>}
        {notice && <p className="ws-search-notice" role="status">{notice}</p>}
        <SearchResultsView states={states} query={query} kind={kind} locked={locked} onRetry={sourceKind => loader.retry(sourceKind)} moreDisabled={query.trim()!==submitted.query} onMore={sourceKind=>loader.more(sourceKind)} onOpen={choose} />
      </div></>}
    </dialog>
  </div>
}



