import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { CalendarBatchImport } from '../calendar/CalendarBatchImport'
import type { CalendarAdapter, RelationOptions } from '../calendar/contracts'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import type { ResourceOpenRequest } from '../search/contracts'
import { PendingRequestsProvider, recoveryScope, usePendingRequest, useRecoveryStore } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import type { WorkflowResultListener } from '../app/workflow-results'

export interface AssistantCalendarWorkspaceProps {
  connection: SupabaseConnection
  adapter: CalendarAdapter
  member: Membership
  members: Membership[]
  schoolName: string
  date: string
  revision: number
  relationOptions?: RelationOptions
  openRequest?: ResourceOpenRequest
  onNavigationLockChange?: (locked: boolean) => void
  onPageChange?: (page: 'home' | 'calendar') => void
  onSaved?: () => void
  onWorkflowResult?: WorkflowResultListener
  renderLessonAgenda?: (date: string) => ReactNode
}

// 원래 일정 편집기와 일괄 계약을 그대로 사용한다. 대화 진입만으로 일정·대상·공개 범위를 채우지 않는다.
export function AssistantCalendarWorkspace(props: AssistantCalendarWorkspaceProps) {
  const store = useRecoveryStore()
  return <PendingRequestsProvider store={store}><CalendarWorkspaceScope key={recoveryScope(props.member)} {...props} /></PendingRequestsProvider>
}

function CalendarWorkspaceScope({ connection, adapter, member, members, schoolName, date, revision, relationOptions, openRequest, onNavigationLockChange, onPageChange, onSaved, onWorkflowResult, renderLessonAgenda }: AssistantCalendarWorkspaceProps) {
  const batchPending = usePendingRequest(member, 'calendarBatch')
  const calendarPending = usePendingRequest(member, 'calendar')
  const batchMemory = useEditDraft(member, 'calendar-batch')
  const viewMemory = useEditDraft<'calendar' | 'batch'>(member, 'calendar-assistant-view')
  const openedMemory = useEditDraft<string[]>(member, 'calendar-assistant-opened')
  const openedRequests = useRef(new Set(openedMemory.initial ?? []))
  const rememberOpened = useCallback((key: string) => {
    openedRequests.current.add(key)
    openedMemory.save([...openedRequests.current], false)
  }, [openedMemory])
  const [batchOpen, setBatchOpen] = useState(() => Boolean(batchPending.request || batchMemory.initial || viewMemory.initial === 'batch'))
  const [calendarLocked, setCalendarLocked] = useState(false), [batchLocked, setBatchLocked] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const locked = calendarLocked || batchLocked || Boolean(calendarPending.request || batchPending.request)
  useLayoutEffect(() => {
    onNavigationLockChange?.(locked)
    return () => onNavigationLockChange?.(false)
  }, [locked, onNavigationLockChange])
  useLayoutEffect(() => { viewMemory.save(batchOpen ? 'batch' : 'calendar', false) }, [batchOpen, viewMemory])
  return <section className="assistant-calendar-workspace" aria-label="대화에서 일정 처리">
    <style>{`.assistant-calendar-workspace{min-width:0}.assistant-calendar-workspace>.calendar-conversation-view[hidden]{display:none}.assistant-calendar-workspace .main-content{padding:0}.assistant-calendar-workspace .page-header .eyebrow,.assistant-calendar-workspace .page-header p,.assistant-calendar-workspace .basis-strip,.assistant-calendar-workspace .list-hint{display:none}.assistant-calendar-workspace .page-header{align-items:center;gap:12px;margin-bottom:20px}.assistant-calendar-workspace .page-header h2{margin:0;font-size:1.3rem}.assistant-calendar-workspace .calendar-batch{padding:0;min-width:0}@media(max-width:600px){.assistant-calendar-workspace .page-header{align-items:stretch}.assistant-calendar-workspace .page-header .button-row{flex-wrap:wrap}.assistant-calendar-workspace .cv-toolbar{gap:12px}}`}</style>
    <div className="calendar-conversation-view" hidden={batchOpen}>
      <CalendarPanel presentation="assistant" member={member} members={members} schoolName={schoolName} date={date}
        adapter={adapter} revision={revision + refresh} page="calendar" relationOptions={relationOptions}
        openRequest={!batchOpen && openRequest && !openedRequests.current.has(openRequest.key) ? openRequest : undefined}
        onOpenRequestHandled={rememberOpened} onPageChange={next => onPageChange?.(next)} renderLessonAgenda={renderLessonAgenda}
        onNavigationLockChange={setCalendarLocked} onWorkflowResult={onWorkflowResult} onOpenBatchImport={() => { if (!locked) setBatchOpen(true) }} />
    </div>
    {batchOpen && <CalendarBatchImport connection={connection} member={member} members={members} date={date}
      revision={revision} onNavigationLockChange={setBatchLocked} onWorkflowResult={onWorkflowResult} onClose={() => setBatchOpen(false)}
      onSaved={() => { setRefresh(value => value + 1); onSaved?.() }} />}
  </section>
}
