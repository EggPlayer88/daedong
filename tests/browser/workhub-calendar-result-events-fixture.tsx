import React, {useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AssistantCalendarWorkspace} from '../../apps/workhub/src/assistant/AssistantCalendarWorkspace'
import {createSupabaseCalendarAdapter} from '../../apps/workhub/src/connection/supabase-calendar'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {fixtureData, relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {EditDraftsProvider, createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider, createPendingRequests, recoveryScope} from '../../apps/workhub/src/app/pending-requests'
import {ContractError} from '../../apps/workhub/src/contracts'
import {batchDraft} from '../../apps/workhub/src/calendar/batch-domain'
import {canonical, sha256} from '../../apps/workhub/src/cooperation/protocol'
import styles from '../../apps/workhub/src/style.css?inline'

// 실제 일정 편집기·일반/일괄 어댑터를 사용하고 RPC와 접수 원장만 합성한다.
const w = window as any, copy = structuredClone, member = fixtureData.memberships.find(item => item.id === 'gaon-minjun')!
const memory = createMemoryAdapter(fixtureData, 0), pending = createPendingRequests(), drafts = createEditDrafts()
const scope = recoveryScope(member), previews = new Map(), receipts = new Map(), eventReceipts = new Map()
let serial = 0, activeMember = member
const qa = w.qa = {calls: [] as any[], saves: [] as any[], batchSaves: [] as any[], results: [] as any[], targets: [] as string[], locked: false,
  snapshot: () => memory.exportState(), concurrent: () => memory.simulateConcurrentEdit(member.id, 'fixture-event-morning'),
  pending: () => copy(pending.get(scope, 'calendarBatch') ?? pending.get(scope, 'calendar')), pendingCount: () => pending.count(),
  forgetDrafts: () => { drafts.bind(scope, 'calendar-batch').remove(); drafts.bind(scope, 'calendar-editor').remove() },
  receipt: (key: string) => copy(receipts.get(key) ?? eventReceipts.get(key)),
} as any
const envelope = () => ({ok: true, contractVersion: 'calendar-batch.v1', schoolId: member.schoolId, memberId: member.id, ownerUserId: member.userId})
async function response(value: any) {
  if (qa.hold) { qa.hold = false; await new Promise(resolve => { qa.release = resolve }) }
  if (qa.failAfter) { qa.failAfter = false; throw new ContractError('SAVE_FAILED', '합성 접수 후 응답 유실') }
  const result = copy(value)
  if (qa.badField) result[qa.badField] = qa.badValue
  if (qa.partialBatch) result.items = result.items.slice(1)
  if (qa.wrongBatchEvent) result.items[0].eventId = 'unrelated-event'
  return result
}
const connection: any = {
  info: () => ({...memory.info(), relationLabels}),
  getIdentity: async () => ({userId: activeMember.userId, approved: !qa.revoked, profile: {id: activeMember.userId, name: activeMember.name, role: 'teacher', is_active: !qa.revoked, extra_permissions: [], department_id: null}}),
  async rpcVerified(name: string, args: any) {
    qa.calls.push(copy({name, args}))
    if (name === 'workhub_calendar_list') { if (qa.listFail) throw Error('합성 조회 실패'); return memory.list(args.p_member_id) }
    if (name === 'workhub_calendar_get') return memory.get(args.p_member_id, args.p_event_id)
    if (name === 'workhub_calendar_save') {
      qa.saves.push(copy(args.p_command))
      if (qa.reject) throw new ContractError('FORBIDDEN', '합성 저장 거부')
      const saved = await memory.save(args.p_member_id, args.p_command)
      eventReceipts.set(args.p_command.idempotencyKey, copy(saved))
      return response(saved)
    }
    if (name === 'workhub_calendar_batch_prepare') {
      const input = args.p_input, original = await memory.get(member.id, 'fixture-event-morning')
      const {id, schoolId, authorMemberId, version, updatedAt, ...originalDraft} = original
      const rows = input.rows.map((row: any, index: number) => ({...row, incoming: copy(row.draft), state: qa.batchUpdate && index === 0 ? 'changed' : 'new', reason: '', eventId: qa.batchUpdate && index === 0 ? original.id : null, expectedVersion: qa.batchUpdate && index === 0 ? original.version : null, baseline: qa.batchUpdate && index === 0 ? batchDraft(originalDraft, member, fixtureData.memberships) : null, current: qa.batchUpdate && index === 0 ? original : null}))
      const result = {...envelope(), prepareId: 'prepare-' + (++serial), previewHash: await sha256(canonical(rows)), sourceKey: input.sourceKey, fileHash: input.fileHash, expiresAt: '2030-01-01T00:00:00Z', rows}
      previews.set(result.prepareId, copy(result)); return result
    }
    if (name === 'workhub_calendar_batch_commit') {
      const key = args.p_request_key, command = args.p_command
      if (receipts.has(key)) return response({...copy(receipts.get(key)), outcome: 'replayed'})
      const preview = previews.get(command.prepareId)
      const items = command.selections.map((selection: any) => {
        const row = preview.rows.find((item: any) => item.key === selection.key); qa.batchSaves.push(copy(row.incoming))
        return {key: selection.key, sourceId: selection.sourceId, eventId: selection.eventId ?? 'batch-event-' + (++serial), version: selection.expectedVersion ? selection.expectedVersion + 1 : 1}
      })
      const receipt = {...envelope(), requestKey: key, prepareId: command.prepareId, previewHash: command.previewHash, outcome: 'applied', appliedAt: '2026-10-19T01:23:45.000Z', items}
      receipts.set(key, copy(receipt)); return response(receipt)
    }
    throw Error('정의하지 않은 RPC ' + name)
  },
}
function App() {
  const [generation, setGeneration] = useState(0), [serviceEpoch, setServiceEpoch] = useState(0), [listener, setListener] = useState('original'), [date, setDate] = useState(fixtureData.basisDate), [active, setActive] = useState(member)
  const activeConnection = useMemo(() => ({...connection}), [serviceEpoch]), adapter = useMemo(() => createSupabaseCalendarAdapter(activeConnection), [activeConnection])
  qa.remount = () => setGeneration(value => value + 1); qa.changeService = () => setServiceEpoch(value => value + 1)
  qa.changeDate = () => setDate('2026-10-20'); qa.changeListener = () => setListener('replacement')
  qa.changeScope = () => { activeMember = fixtureData.memberships.find(item => item.id === 'nuri-harin')!; setActive(activeMember) }
  return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{styles}</style><div style={{padding: 20}}>
    <AssistantCalendarWorkspace key={generation} connection={activeConnection} adapter={adapter} member={active} members={fixtureData.memberships} schoolName="합성 학교" date={date} revision={0} relationOptions={relationLabels}
      onNavigationLockChange={value => { qa.locked = value }} onWorkflowResult={result => { qa.results.push(copy(result)); qa.targets.push(listener); if (qa.resultThrows) throw Error('합성 결과 표시 오류') }} />
  </div></PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
