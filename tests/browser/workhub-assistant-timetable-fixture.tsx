import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableWorkspace } from '../../apps/workhub/src/timetable/TimetableWorkspace'
import { EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
import { connection, member, date } from './workhub-timetable-exchanges-fixture'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'

const w: any = window, originalRpc = connection.rpcVerified
w.enableNext = true
// 부가 운영 연결을 준비 중으로 둔다. 교환 RPC는 기존 fixture를 그대로 사용한다.
connection.rpcVerified = async (name: string, args: any) => {
  if (name === 'workhub_timetable_interventions_readiness') return { contract: 'timetable-interventions.v1', schoolId: 's', memberId: 'm', data: w.enableInterventions ? { available: true, reason: null } : { available: false, reason: 'not_configured' } }
  if (name === 'workhub_timetable_interventions_get') return { contract: 'timetable-interventions.v1', schoolId: 's', memberId: 'm', data: { asOf: new Date().toISOString(), timeZone: 'Asia/Seoul', from: args.p_from, until: args.p_until, lessons: structuredClone(w.view.lessons), teachers: [{ id: 'm', name: '내 교사' }, { id: 'other', name: '상대 교사' }], closures: [], requests: [] } }
  if (w.notAllowed && name === 'workhub_timetable_operations_readiness') return { contract: 'timetable-operations.v1', schoolId: 's', memberId: 'm', data: { available: false, reason: 'not_allowed' } }
  return originalRpc(name, args)
}
function Harness() {
  const [revision, refresh] = useState(0)
  w.refresh = () => refresh(value => value + 1)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>
    <style>{baseStyles}</style>
    <TimetableWorkspace presentation="assistant" initialOperationTab={w.initialOperationTab} initialOperationMode={w.initialOperationMode} connection={connection} member={member as any} date={date} revision={revision} onNavigationLockChange={value => { w.locked = value }} />
  </PendingRequestsProvider></EditDraftsProvider>
}
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.root.render(<Harness />) }
w.mount()
