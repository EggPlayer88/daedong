import { recoveryScope } from '../services/recovery-scope'
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CalendarEvent, Membership, SaveCommand } from '../contracts'
import type { PersonalTask, TaskCommand } from '../tasks/contracts'
import type { CollectionCommand } from '../collections/contracts'
import type { CheckpointItem, TabCheckpoint } from './tab-checkpoint'

export type TaskRecovery = { command: TaskCommand; key: string; original?: PersonalTask; fromAssistant?: true }
export type CalendarRecovery = { command: SaveCommand; original?: CalendarEvent }
// 작성 출처는 같은 탭의 복구 메타일 뿐 서버 명령에 포함하지 않는다.
export type CollectionRecovery = { command: CollectionCommand; key: string; composeId?: string }
export type ModuleRecovery = { command: unknown; key: string; composeId?: string }
export type SchoolRosterRecovery = ModuleRecovery & { closeState?: 'closing' }
// 닫기 응답이 유실되어도 원키·원문과 닫는 단계를 같은 탭에서 함께 보관한다.
export type TimetableRecovery = ModuleRecovery & { closeState?: 'available' | 'closing' }
type Requests = { assistantOperation: ModuleRecovery; teacherRoster: SchoolRosterRecovery; neis: ModuleRecovery; annualOperations: ModuleRecovery; assistantMemory: SchoolRosterRecovery; assistantSchoolSettings: SchoolRosterRecovery; schoolDataMaintenance: SchoolRosterRecovery; timetableImport: TimetableRecovery; timetableInterventions: TimetableRecovery; timetableOperationsAssistant: SchoolRosterRecovery; schoolRoster: SchoolRosterRecovery; timetableExecutionRecords: TimetableRecovery; timetableTarget: ModuleRecovery; timetableSetupBatch: ModuleRecovery; timetableSetup: ModuleRecovery; timetableAssistant: SchoolRosterRecovery; timetablePreparation: ModuleRecovery; timetableOperations: TimetableRecovery; timetable: ModuleRecovery; task: TaskRecovery; calendar: CalendarRecovery; collection: CollectionRecovery; schoolAdmin: ModuleRecovery; teaching: ModuleRecovery; teachingRelations: ModuleRecovery; messaging: ModuleRecovery; messagingFile: ModuleRecovery; knowledge: ModuleRecovery; assistant: SchoolRosterRecovery; collectionOps: ModuleRecovery; documents: ModuleRecovery; cooperation: ModuleRecovery; calendarBatch: ModuleRecovery; handover: ModuleRecovery; guidedDocuments: ModuleRecovery; knowledgeImport: ModuleRecovery }
type Listener = () => void

// 서버에 보낸 원명령만 보관한다. 동일 탭 복구를 선택해도 자동 재전송하지 않으며 로그아웃 때는 폐기한다.
export function createPendingRequests(checkpoint?: TabCheckpoint) {
  const entries = new Map<string, TaskRecovery | CalendarRecovery | CollectionRecovery | ModuleRecovery>()
  const waiting = new Map<string, CheckpointItem[]>(), checked = new Set<string>()
  let verifiedScopes = new Set<string>()
  const listeners = new Set<Listener>()
  const notify = () => { for (const listener of listeners) listener() }
  const persist = (scope: string) => {
    if (!verifiedScopes.has(scope) || waiting.get(scope)?.length) return
    checkpoint?.write('pending', scope, [...entries.entries()].filter(([id]) => id.slice(0, id.lastIndexOf(':')) === scope).map(([id, value]) => ({ slot: id.slice(id.lastIndexOf(':') + 1), value, warn: true })))
  }
  return {
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    get<T extends keyof Requests>(scope: string, kind: T): Requests[T] | undefined { return entries.get(scope + ':' + kind) as Requests[T] | undefined },
    put<T extends keyof Requests>(scope: string, kind: T, request: Requests[T]) { entries.set(scope + ':' + kind, structuredClone(request)); persist(scope); notify() },
    remove(scope: string, kind: keyof Requests, key?: string) {
      const id = scope + ':' + kind
      const saved = entries.get(id)
      if (!saved || (key && ('key' in saved ? saved.key : saved.command.idempotencyKey) !== key)) return
      entries.delete(id); persist(scope); notify()
    },
    restoreCount: (scope: string) => verifiedScopes.has(scope) ? waiting.get(scope)?.length ?? 0 : 0,
    restore(scope: string) {
      if (!verifiedScopes.has(scope)) return false
      const saved = waiting.get(scope)
      if (!saved?.length) return false
      for (const item of saved) entries.set(scope + ':' + item.slot, structuredClone(item.value) as ModuleRecovery)
      waiting.delete(scope); persist(scope); notify(); return true
    },
    retainScopes(scopes: readonly string[]) {
      const allowed = new Set(scopes)
      verifiedScopes = allowed; checkpoint?.retainScopes(scopes)
      let changed = false
      for (const key of entries.keys()) if (!allowed.has(key.slice(0, key.lastIndexOf(':')))) { entries.delete(key); changed = true }
      for (const key of waiting.keys()) if (!allowed.has(key)) { waiting.delete(key); changed = true }
      for (const scope of scopes) if (!checked.has(scope)) {
        checked.add(scope); const saved = checkpoint?.read('pending', scope)
        if (saved?.length) { waiting.set(scope, saved); changed = true }
      }
      if (changed) notify()
    },
    clear() { entries.clear(); waiting.clear(); checked.clear(); verifiedScopes.clear(); checkpoint?.clear(); notify() },
    count: () => entries.size,
  }
}
export type PendingRequests = ReturnType<typeof createPendingRequests>
export { recoveryScope } from '../services/recovery-scope'
const PendingContext = createContext<PendingRequests | undefined>(undefined)

export function PendingRequestsProvider({ children, store }: { children: ReactNode; store: PendingRequests }) {
  const count = useSyncExternalStore(store.subscribe, store.count, store.count)
  useEffect(() => {
    if (!count) return
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => window.removeEventListener('beforeunload', beforeLeave)
  }, [count])
  return <PendingContext.Provider value={store}>{children}</PendingContext.Provider>
}

export function useRecoveryStore() {
  const shared = useContext(PendingContext)
  const [local] = useState(createPendingRequests)
  return shared ?? local
}

export function usePendingRequest<T extends keyof Requests>(member: Membership, kind: T) {
  const store = useRecoveryStore()
  const scope = recoveryScope(member)
  const request = useSyncExternalStore(store.subscribe, () => store.get(scope, kind), () => store.get(scope, kind))
  return { request, put: (value: Requests[T]) => store.put(scope, kind, value), remove: (key?: string) => store.remove(scope, kind, key) }
}
