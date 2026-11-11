import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableWorkspace } from '../../apps/workhub/src/timetable/TimetableWorkspace'
import { EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
import { connection, member, date } from './workhub-timetable-exchanges-fixture'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import { operationCommandHash } from '../../apps/workhub/src/timetable/operations-server'

const w: any = window, originalRpc = connection.rpcVerified
w.enableNext = true
w.workflowResults = []; w.resultThrows = false
// 부가 운영 연결을 준비 중으로 둔다. 교환 RPC는 기존 fixture를 그대로 사용한다.
connection.rpcVerified = async (name: string, args: any) => {
  // 요청 닫기는 기존 실행 접수증을 되돌린다. 실 서비스의 경합은 별도 SQL 회귀가 확인한다.
  if (name === 'workhub_timetable_operations_abandon') {
    w.calls.push({ name, args: structuredClone(args) })
    const receipt = w.receipts[args.p_request_key]
    return { contract: 'timetable-operations.abandon.v1', schoolId: 's', memberId: 'm', data: { kind: args.p_kind, requestKey: args.p_request_key, commandHash: await operationCommandHash(args.p_command), outcome: receipt ? 'applied' : 'abandoned', receipt: receipt ?? null, decidedAt: new Date().toISOString() } }
  }
  if (name === 'workhub_timetable_operations_execute' && (w.resultRecoverMissing && args.p_recover_only || w.resultResendDenied && !args.p_recover_only)) {
    w.calls.push({ name, args: structuredClone(args) })
    return { contract: 'timetable-operations.v1', schoolId: 's', memberId: 'm', error: { code: args.p_recover_only ? 'NOT_FOUND' : 'FORBIDDEN' } }
  }
  if (name === 'workhub_timetable_operations_execute' && w.resultBeforeSaveUnknown) {
    w.resultBeforeSaveUnknown = false; w.calls.push({ name, args: structuredClone(args) }); throw { code: 'QUERY_FAILED' }
  }
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
    <TimetableWorkspace presentation="assistant" initialOperationTab={w.initialOperationTab} initialOperationMode={w.initialOperationMode} connection={connection} member={member as any} date={date} revision={revision} onNavigationLockChange={value => { w.locked = value }} onWorkflowResult={value => { w.workflowResults.push(structuredClone(value)); if (w.resultThrows) throw Error('합성 결과 표시 실패') }} />
  </PendingRequestsProvider></EditDraftsProvider>
}
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.root.render(<Harness />) }
w.mount()
