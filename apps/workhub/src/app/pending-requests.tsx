import { recoveryScope } from '../services/recovery-scope'
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CalendarEvent, Membership, SaveCommand } from '../contracts'
import type { PersonalTask, TaskCommand } from '../tasks/contracts'
import type { CollectionCommand } from '../collections/contracts'

export type TaskRecovery = { command: TaskCommand; key: string; original?: PersonalTask }
export type CalendarRecovery = { command: SaveCommand; original?: CalendarEvent }
export type CollectionRecovery = { command: CollectionCommand; key: string }
export type ModuleRecovery = { command: unknown; key: string }
export type SchoolRosterRecovery = ModuleRecovery & { closeState?: 'closing' }
// 닫기 응답이 유실되어도 원키·원문과 닫는 단계를 같은 탭에서 함께 보관한다.
export type TimetableRecovery = ModuleRecovery & { closeState?: 'available' | 'closing' }
type Requests = { annualOperations: ModuleRecovery; assistantMemory: SchoolRosterRecovery; assistantSchoolSettings: SchoolRosterRecovery; schoolDataMaintenance: SchoolRosterRecovery; timetableImport: TimetableRecovery; timetableInterventions: TimetableRecovery; timetableOperationsAssistant: SchoolRosterRecovery; schoolRoster: SchoolRosterRecovery; timetableExecutionRecords: TimetableRecovery; timetableTarget: ModuleRecovery; timetableSetupBatch: ModuleRecovery; timetableSetup: ModuleRecovery; timetableAssistant: SchoolRosterRecovery; timetablePreparation: ModuleRecovery; timetableOperations: TimetableRecovery; timetable: ModuleRecovery; task: TaskRecovery; calendar: CalendarRecovery; collection: CollectionRecovery; schoolAdmin: ModuleRecovery; teaching: ModuleRecovery; teachingRelations: ModuleRecovery; messaging: ModuleRecovery; messagingFile: ModuleRecovery; knowledge: ModuleRecovery; assistant: SchoolRosterRecovery; collectionOps: ModuleRecovery; documents: ModuleRecovery; cooperation: ModuleRecovery; calendarBatch: ModuleRecovery; handover: ModuleRecovery; guidedDocuments: ModuleRecovery; knowledgeImport: ModuleRecovery }
type Listener = () => void

// 결과 미확정 명령만 현재 탭 메모리에 둔다. 새로고침·로그아웃 후 복구 저장소로 쓰지 않는다.
export function createPendingRequests() {
  const entries = new Map<string, TaskRecovery | CalendarRecovery | CollectionRecovery | ModuleRecovery>()
  const listeners = new Set<Listener>()
  const notify = () => { for (const listener of listeners) listener() }
  return {
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    get<T extends keyof Requests>(scope: string, kind: T): Requests[T] | undefined { return entries.get(scope + ':' + kind) as Requests[T] | undefined },
    put<T extends keyof Requests>(scope: string, kind: T, request: Requests[T]) { entries.set(scope + ':' + kind, structuredClone(request)); notify() },
    remove(scope: string, kind: keyof Requests, key?: string) {
      const id = scope + ':' + kind
      const saved = entries.get(id)
      if (!saved || (key && ('key' in saved ? saved.key : saved.command.idempotencyKey) !== key)) return
      entries.delete(id); notify()
    },
    retainScopes(scopes: readonly string[]) {
      const allowed = new Set(scopes)
      let changed = false
      for (const key of entries.keys()) if (!allowed.has(key.slice(0, key.lastIndexOf(':')))) { entries.delete(key); changed = true }
      if (changed) notify()
    },
    clear() { entries.clear(); notify() },
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
