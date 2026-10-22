import { useEffect, useState } from 'react'
import { workhubModules, type PageId } from '../modules'
import type { SearchItem, SearchKind } from '../search/contracts'

type ResourceKind = Exclude<SearchKind, 'menu'>
type DueFilter = 'overdue' | 'today' | 'upcoming' | 'none'
interface Selection { scopeKey: string; key: string; kind: ResourceKind; id?: string; unitId?: string; dueFilter?: DueFilter; version?: number; locator?: string }
const destination: Record<ResourceKind, PageId> = { calendar: 'calendar', task: 'tasks', collection: 'collections', cooperation: 'cooperation', message: 'messages', document:'documents', knowledge:'knowledge', course:'students' }

// 원본 선택은 현재 화면의 일회성 의도다. 학생/업무 식별자와 검색어를 주소나 영속 저장소에 남기지 않는다.
export function useResourceNavigation(scopeKey: string, page: PageId, requestNavigate: (page: PageId) => boolean) {
  const [selection, setSelection] = useState<Selection>()
  const current = selection?.scopeKey === scopeKey && destination[selection.kind] === page ? selection : undefined
  useEffect(() => {
    setSelection(previous => previous && (previous.scopeKey !== scopeKey || destination[previous.kind] !== page) ? undefined : previous)
  }, [scopeKey, page])
  function open(kind: ResourceKind, values: { id?: string; unitId?: string; dueFilter?: DueFilter; version?: number; locator?: string }) {
    if (!requestNavigate(destination[kind])) return false
    setSelection({ scopeKey, key: crypto.randomUUID(), kind, ...values })
    return true
  }
  return {
    current,
    clear: () => setSelection(undefined),
    navigate(next: PageId) { if (!requestNavigate(next)) return false; setSelection(undefined); return true },
    openSearchItem: (item: SearchItem) => {
      if (item.kind === 'menu') {
        const target = workhubModules.find(module=>module.id===item.id)
        if (!target || !requestNavigate(target.id)) return false
        setSelection(undefined); return true
      }
      return open(item.kind, { id: item.id, unitId: item.unitId, version:item.version, locator:item.locator })
    },
    openMessage: (id: string) => open('message', { id }),
    openCooperation: (id: string) => open('cooperation', { id }),
    openTasks: (dueFilter?: DueFilter) => open('task', { dueFilter }),
    openCollection: (id?: string, unitId?: string) => open('collection', { id, unitId }),
  }
}
