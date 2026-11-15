import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Membership } from '../contracts'
import { recoveryScope } from './pending-requests'
import type { CheckpointItem, TabCheckpoint } from './tab-checkpoint'

type Entry = { value: unknown; warn: boolean }
type Listener = () => void

// 기본은 탭 메모리다. 운영 연결 화면이 명시한 경우에만 동일 탭 새로고침 복구를 보조한다.
// 저장값으로 회원·학교·권한을 증명하지 않으며 서버 재검증과 사용자의 복원 선택 뒤에만 연다.
export function createEditDrafts(restricted = false, checkpoint?: TabCheckpoint) {
  const entries = new Map<string, Map<string, Entry>>()
  const waiting = new Map<string, CheckpointItem[]>(), checked = new Set<string>()
  const listeners = new Set<Listener>()
  let generation = 0, active = !restricted
  let selected: string | undefined
  const notify = () => { for (const listener of listeners) listener() }
  const allowed = (scope: string, epoch: number) => active && epoch === generation && (selected === undefined || selected === scope)
  const persist = (scope: string) => {
    if (waiting.get(scope)?.length) return
    checkpoint?.write('drafts', scope, [...(entries.get(scope)?.entries() ?? [])].map(([slot, entry]) => ({ slot, ...entry })))
  }
  return {
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    count: () => [...entries.values()].reduce((count, slots) => count + [...slots.values()].filter(entry => entry.warn).length, 0),
    dirtySlots: (scope: string) => allowed(scope, generation)
      ? [...(entries.get(scope)?.entries() ?? [])].filter(([, entry]) => entry.warn).map(([slot]) => slot) : [],
    restoreCount: (scope: string) => allowed(scope, generation) ? waiting.get(scope)?.length ?? 0 : 0,
    restore(scope: string) {
      if (!allowed(scope, generation)) return false
      const saved = waiting.get(scope)
      if (!saved?.length) return false
      entries.set(scope, new Map(saved.map(item => [item.slot, { value: structuredClone(item.value), warn: item.warn }])))
      waiting.delete(scope); generation++; persist(scope); notify(); return true
    },
    discardRestore(scope: string) {
      if (!allowed(scope, generation)) return
      waiting.delete(scope); persist(scope); notify()
    },
    activate(scope: string) {
      if (selected !== scope) { entries.clear(); waiting.clear(); generation++; selected = scope; checkpoint?.retainScopes([scope]) }
      if (!checked.has(scope)) { checked.add(scope); const saved = checkpoint?.read('drafts', scope); if (saved?.length) waiting.set(scope, saved) }
      active = true
      notify()
    },
    suspend() { active = false; generation++; notify() },
    clear() { entries.clear(); waiting.clear(); checked.clear(); checkpoint?.clear(); active = false; selected = undefined; generation++; notify() },
    bind<T>(scope: string, slot: string) {
      const epoch = generation
      const entry = allowed(scope, epoch) ? entries.get(scope)?.get(slot) : undefined
      const saved = entry?.value
      return {
        dirty: entry?.warn === true,
        initial: saved === undefined ? undefined : structuredClone(saved) as T,
        save(value: T | undefined, warn = true) {
          if (!allowed(scope, epoch)) return
          if (value === undefined) entries.get(scope)?.delete(slot)
          else {
            if (!entries.has(scope)) entries.set(scope, new Map())
            entries.get(scope)!.set(slot, { value: structuredClone(value), warn })
          }
          persist(scope)
          notify()
        },
        remove() {
          if (!allowed(scope, epoch)) return
          entries.get(scope)?.delete(slot); persist(scope); notify()
        },
        removePrefix(prefix: string) {
          if (!allowed(scope, epoch)) return
          const slots = entries.get(scope)
          if (slots) for (const key of slots.keys()) if (key.startsWith(prefix)) slots.delete(key)
          persist(scope)
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
