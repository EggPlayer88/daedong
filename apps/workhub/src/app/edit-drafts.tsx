import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Membership } from '../contracts'
import { recoveryScope } from './pending-requests'

type Entry = { value: unknown; warn: boolean }
type Listener = () => void

// 미저장 입력만 현재 탭 메모리에 둔다. 회원/학교/권한을 확인하는 저장소가 아니며
// 상위 연결 화면이 같은 범위를 재검증한 뒤에만 다시 연다. 영속 저장소는 사용하지 않는다.
export function createEditDrafts(restricted = false) {
  const entries = new Map<string, Map<string, Entry>>()
  const listeners = new Set<Listener>()
  let generation = 0, active = !restricted
  let selected: string | undefined
  const notify = () => { for (const listener of listeners) listener() }
  const allowed = (scope: string, epoch: number) => active && epoch === generation && (selected === undefined || selected === scope)
  return {
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    count: () => [...entries.values()].reduce((count, slots) => count + [...slots.values()].filter(entry => entry.warn).length, 0),
    activate(scope: string) {
      if (selected !== scope) { entries.clear(); generation++; selected = scope }
      active = true
      notify()
    },
    suspend() { active = false; generation++; notify() },
    clear() { entries.clear(); active = false; selected = undefined; generation++; notify() },
    bind<T>(scope: string, slot: string) {
      const epoch = generation
      const saved = allowed(scope, epoch) ? entries.get(scope)?.get(slot)?.value : undefined
      return {
        initial: saved === undefined ? undefined : structuredClone(saved) as T,
        save(value: T | undefined, warn = true) {
          if (!allowed(scope, epoch)) return
          if (value === undefined) entries.get(scope)?.delete(slot)
          else {
            if (!entries.has(scope)) entries.set(scope, new Map())
            entries.get(scope)!.set(slot, { value: structuredClone(value), warn })
          }
          notify()
        },
        remove() {
          if (!allowed(scope, epoch)) return
          entries.get(scope)?.delete(slot); notify()
        },
        removePrefix(prefix: string) {
          if (!allowed(scope, epoch)) return
          const slots = entries.get(scope)
          if (slots) for (const key of slots.keys()) if (key.startsWith(prefix)) slots.delete(key)
          notify()
        },
      }
    },
  }
}
export type EditDrafts = ReturnType<typeof createEditDrafts>
const DraftContext = createContext<EditDrafts | undefined>(undefined)

export function EditDraftsProvider({ store, children }: { store: EditDrafts; children: ReactNode }) {
  const count = useSyncExternalStore(store.subscribe, store.count, store.count)
  useEffect(() => {
    if (!count) return
    // 연결 오류 화면에서도 탭을 닫아 미저장 입력을 잃기 전에 확인한다.
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => window.removeEventListener('beforeunload', beforeLeave)
  }, [count])
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>
}

export function useEditDraft<T>(member: Membership, slot: string) {
  const shared = useContext(DraftContext)
  const [local] = useState(createEditDrafts)
  const store = shared ?? local
  const scope = recoveryScope(member)
  return useMemo(() => store.bind<T>(scope, slot), [store, scope, slot])
}
