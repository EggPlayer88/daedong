import { createWorkspaceSearchLoader, type SearchSourceState } from '../search/WorkspaceSearch'
import { SEARCH_KINDS, type SearchItem, type SearchKind, type SearchSource } from '../search/contracts'
import { SEARCH_LIMITS } from '../search/limits'
import { filterSearchItems } from '../search/presentation'

export interface AssistantSearchResult {
  items: SearchItem[]
  coverage: string[]
  hasMore: boolean
}

// 대화에서도 메뉴 검색과 같은 조회·응답 검사·권한 경로를 사용한다.
// 요청한 자료원의 첫 쪽만 읽으며, 조회된 원문을 유료 AI에 자동 전달하지 않는다.
export function searchAssistantWorkspace(
  sources: readonly SearchSource[], query: string, kinds: readonly SearchKind[], signal: AbortSignal,
): Promise<AssistantSearchResult> {
  if (typeof query !== 'string' || !query.trim() || Array.from(query).length > SEARCH_LIMITS.queryChars
    || !Array.isArray(kinds) || !kinds.length || kinds.some(kind => !SEARCH_KINDS.includes(kind))) {
    return Promise.reject(new Error('검색어와 자료 종류를 다시 확인해 주세요.'))
  }
  const selected = sources.filter(source => kinds.includes(source.kind))
  if (!selected.length) return Promise.reject(new Error('현재 화면에서 조회할 수 없는 자료입니다.'))
  return new Promise((resolve, reject) => {
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result?: AssistantSearchResult, error?: Error) => {
      if (finished) return
      finished = true
      loader.stop()
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(undefined, new Error('자료 조회를 취소했습니다.'))
    const loader = createWorkspaceSearchLoader((states: SearchSourceState[]) => {
      if (finished || states.some(state => state.status === 'loading')) return
      const ready = states.filter(state => state.status === 'ready')
      if (!ready.length) {
        finish(undefined, new Error('자료를 확인하지 못했습니다. 연결 또는 현재 이용 권한을 확인해 주세요.'))
        return
      }
      const matches = filterSearchItems(ready.flatMap(state => state.items), query.trim())
      const coverage = states.flatMap(state => state.status !== 'ready'
        ? [`${state.label}: ${state.status === 'unavailable' ? '연결 또는 이용 권한 확인 필요' : '조회 실패'}`]
        : [state.coverage ? `${state.label}: ${state.coverage}` : '', state.nextCursor ? `${state.label}: 첫 쪽만 조회했습니다.` : ''].filter(Boolean))
      if (matches.length > 20) coverage.push(`확인한 ${matches.length}건 중 앞의 20건을 표시합니다. 검색어를 좁혀 주세요.`)
      finish({ items: matches.slice(0, 20), coverage, hasMore: matches.length > 20 || states.some(state => Boolean(state.nextCursor) || state.status !== 'ready') })
    })
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(undefined, new Error('자료 조회가 지연되고 있습니다. 검색어를 유지한 채 다시 요청해 주세요.')), 15000)
    loader.start(selected, query.trim())
  })
}
