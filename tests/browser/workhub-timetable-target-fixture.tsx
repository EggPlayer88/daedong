import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableTargetPanel } from '../../apps/workhub/src/timetable/TimetableTargetPanel'
import { createTimetableTargetServer } from '../../apps/workhub/src/timetable/target-server'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import appStyles from '../../apps/workhub/src/style.css?inline'
import themeStyles from '../../apps/workhub/src/appearance/theme.css?inline'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import styles from '../../apps/workhub/src/timetable/timetable-target.css?inline'
// React·parser·어댑터는 실제 코드이며 RPC와 접수 원장은 합성이다.
const w: any = window, copy = (value: any) => structuredClone(value)
w.member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 담당 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.snapshot = { termId: 'now', automaticTermId: 'now', selectedTermId: null, version: 0, terms: [
  { id: 'now', schoolYear: 2026, label: '2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', state: 'current', hasBasis: true, hasPreparationDraft: true },
  { id: 'next', schoolYear: 2027, label: '1학기', firstDay: '2027-03-01', lastDay: '2027-08-15', state: 'planning', hasBasis: false, hasPreparationDraft: false },
] }
w.calls = []; w.receipts = {}; w.commands = {}; w.states = []; w.changed = []; w.actualWrites = 0; w.drafts = createEditDrafts(); w.pending = createPendingRequests(); w.locked = false
const envelope = (data: any) => ({ contract: 'timetable.target.v1', schoolId: 'school', memberId: 'member', data })
const failure = (code: string) => ({ contract: 'timetable.target.v1', schoolId: 'school', memberId: 'member', error: { code } })
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: 'school' }, { id: 'other' }], basisDate: '2026-10-19' }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: copy(args) })
    if (name.endsWith('_get')) {
      if (w.failGet) throw { code: 'QUERY_FAILED' }
      if (w.notReady) return failure('NOT_READY')
      if (w.missing) throw { code: 'PGRST202' }
      return envelope(copy(w.snapshot))
    }
    if (w.holdWrite) await new Promise<void>(resolve => { w.releaseWrite = () => { w.holdWrite = false; resolve() } })
    const input = args.p_input, key = args.p_request_key
    if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(input)) return failure('IDEMPOTENCY_CONFLICT')
    if (w.receipts[key]) return envelope(copy(w.receipts[key]))
    if (args.p_recover_only) return failure('NOT_FOUND')
    if (w.dropBefore) { w.dropBefore = false; throw { code: 'QUERY_FAILED' } }
    if (input.expectedVersion !== w.snapshot.version) return failure('CONFLICT')
    if (w.setFailure) return failure(w.setFailure)
    if (w.snapshot.selectedTermId !== input.termId) { w.actualWrites++; w.snapshot.version++ }
    w.snapshot.selectedTermId = input.termId; w.snapshot.termId = input.termId ?? w.snapshot.automaticTermId
    w.commands[key] = copy(input); w.receipts[key] = { requestKey: key, termId: input.termId, version: w.snapshot.version, effectiveTermId: w.snapshot.termId }
    if (w.failGetAfter) w.failGet = true
    if (w.dropOnce) { w.dropOnce = false; throw { code: 'QUERY_FAILED' } }
    return envelope(copy(w.receipts[key]))
  },
}
w.server = createTimetableTargetServer(connection)
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{appStyles + themeStyles + baseStyles + styles}</style><main className="timetable-workspace"><TimetableTargetPanel member={w.member} server={w.noServer ? undefined : w.server} disabled={Boolean(w.disabled)} refreshKey={w.refreshKey ?? 0} onLockChange={value => w.locked = value} onStateChange={value => w.states.push(copy(value))} onChanged={value => w.changed.push(copy(value))} /><button type="button" disabled={w.disabled}>합성 기존 메뉴</button></main></PendingRequestsProvider></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.render() }
w.mount()
