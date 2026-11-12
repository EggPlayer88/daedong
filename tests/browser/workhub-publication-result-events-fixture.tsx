import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableOperationsWorkspace } from '../../apps/workhub/src/timetable/TimetableOperationsWorkspace'
import { canonical } from '../../apps/workhub/src/services/service-values'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'

// 실제 공개 어댑터와 접수증 검증기를 실행하고, 학교 RPC만 합성 응답으로 대체한다.
const w: any = window, copy = structuredClone
const stamp = '2026-10-18T00:00:00.000Z'
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('')
const originalMember = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 담당교사', role: 'admin', active: true,
  validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const lesson = (id: string) => ({ id, version: 1, label: '결과에 복제하지 않을 수업 ' + id,
  time: { startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-10-19T00:45:00.000Z' },
  teachers: [{ id: 'member', name: '비공개 교사 이름' }], groupNames: ['비공개 학급 이름'], roomNames: [], state: 'scheduled', canRequest: false, allowedTargets: [] })
w.snapshot = { asOf: stamp, timeZone: 'Asia/Seoul', from: '2026-10-12', until: '2026-10-26', canPublish: true, canRequest: false,
  drafts: [{ id: 'draft', version: 2, title: '비공개 초안 제목' }], lessons: [lesson('existing')], requests: [], publications: [] }
w.calls = []; w.results = []; w.listeners = []; w.receipts = {}; w.saved = 0
w.pending = createPendingRequests(); w.drafts = createEditDrafts(); w.currentMember = originalMember; w.date = '2026-10-18'
const envelope = (contract: string, data: unknown) => ({ contract, schoolId: 'school', memberId: 'member', data })
const failure = (contract: string, code: string) => ({ contract, schoolId: 'school', memberId: 'member', error: { code } })
async function receipt(command: any, key: string) {
  if (!w.receipts[key]) {
    w.saved++
    w.receipts[key] = { requestKey: key, commandHash: await hash(command), kind: command.kind, entityId: 'publication-' + w.saved,
      version: command.kind === 'publish' ? 1 : 4, status: 'published', recordedAt: stamp,
      ...(command.kind === 'publish' ? { changedLessons: [{ id: 'published-one', version: 1 }, { id: 'published-two', version: 1 }] }
        : { manifestHash: command.manifestHash, basisFingerprint: command.basisFingerprint, changedCount: command.totalChanges }) }
  }
  return copy(w.receipts[key])
}
async function rpcVerified(name: string, args: any) {
  w.calls.push({ name, args: copy(args) })
  if (name.endsWith('_readiness')) return envelope('timetable-operations.v1', { available: true })
  if (name.endsWith('_get')) return w.failRead ? failure('timetable-operations.v1', 'QUERY_FAILED') : envelope('timetable-operations.v1', { ...copy(w.snapshot), from: args.p_from, until: args.p_until })
  if (name.endsWith('_references')) return envelope('timetable-operations.next.v1', { asOf: w.snapshot.asOf, from: args.p_from, until: args.p_until,
    lessons: w.snapshot.lessons.map((row: any) => ({ lessonId: row.id, version: row.version, groups: [{ id: 'group', name: '합성 학급' }], rooms: [] })) })
  if (name.endsWith('_publish_preview')) {
    const result = { previewId: 'preview', previewHash: 'a'.repeat(64), createdAt: stamp, expiresAt: '2026-10-18T00:10:00.000Z', input: copy(args.p_input), complete: true,
      changes: [{ before: null, after: lesson('published-one') }, { before: null, after: lesson('published-two') }], participants: [{ id: 'member', name: '비공개 교사 이름' }],
      blockers: [], excludedDays: [], preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
    if (w.holdPreview) await new Promise(resolve => { w.releasePreview = resolve })
    return envelope('timetable-operations.v1', result)
  }
  if (name.endsWith('_publish_manifest')) {
    w.pages = [[{ before: null, after: lesson('published-one') }, { before: null, after: lesson('published-two') }, { before: null, after: lesson('published-three') }]]
    const unsigned = { previewId: 'manifest-preview', previewHash: 'b'.repeat(64), input: copy(args.p_input), timeZone: 'Asia/Seoul', createdAt: stamp,
      expiresAt: '2026-10-18T00:10:00.000Z', basisFingerprint: 'c'.repeat(64), totalChanges: 3, pageSize: 200, pageHashes: await Promise.all(w.pages.map(hash)),
      blockerCount: 0, complete: true, preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
    w.manifest = { ...unsigned, manifestHash: await hash(unsigned) }
    if (w.holdPreview) await new Promise(resolve => { w.releasePreview = resolve })
    return envelope('timetable-operations.next.v1', copy(w.manifest))
  }
  if (name.endsWith('_publish_page')) {
    const result = { previewId: w.manifest.previewId, manifestHash: w.manifest.manifestHash, index: args.p_index, pageHash: w.manifest.pageHashes[args.p_index], changes: copy(w.pages[args.p_index]) }
    if (w.badPage) result.changes[0].after.label = '서명과 다른 내용'
    return envelope('timetable-operations.next.v1', result)
  }
  if (name === 'workhub_timetable_operations_abandon') {
    const applied = w.receipts[args.p_request_key] ?? (w.lateApplyOnClose ? await receipt(args.p_command, args.p_request_key) : null)
    const result = { kind: args.p_kind, requestKey: args.p_request_key, commandHash: await hash(args.p_command), outcome: applied ? 'applied' : 'abandoned', receipt: applied, decidedAt: stamp }
    if (w.failCloseOnce) { w.failCloseOnce = false; throw Error('닫기 응답 유실') }
    if (w.holdWrite) await new Promise(resolve => { w.releaseWrite = resolve })
    return envelope('timetable-operations.abandon.v1', result)
  }
  if (name === 'workhub_timetable_operations_execute' || name === 'workhub_timetable_publication_execute') {
    const contract = name === 'workhub_timetable_operations_execute' ? 'timetable-operations.v1' : 'timetable-publication.v1'
    let result
    if (args.p_recover_only) {
      if (!w.receipts[args.p_request_key] || w.recoverMissing) return failure(contract, 'NOT_FOUND')
      result = copy(w.receipts[args.p_request_key])
    } else {
      if (w.reject) return failure(contract, w.reject)
      if (w.failBeforeWrite) { w.failBeforeWrite = false; throw Error('미접수 응답 유실') }
      result = await receipt(args.p_command, args.p_request_key)
      if (w.failOnce) { w.failOnce = false; throw Error('접수 후 응답 유실') }
    }
    if (w.badReceipt) Object.assign(result, copy(w.badReceipt))
    if (w.holdWrite) await new Promise(resolve => { w.releaseWrite = resolve })
    return envelope(contract, result)
  }
  throw Error('예상하지 않은 RPC ' + name)
}
const makeConnection = () => ({ info: () => ({ memberships: [{ ...w.currentMember, role: w.changedRole ?? w.currentMember.role }], schools: [{ id: 'school' }], basisDate: w.date }),
  getIdentity: async () => ({ userId: w.currentMember.userId, approved: !w.revoked }), rpcVerified })
function Harness() {
  const [revision, setRevision] = useState(0), [epoch, setEpoch] = useState(0), [date, setDate] = useState(w.date), [member, setMember] = useState(originalMember)
  const [listener, setListener] = useState('original'), [mounted, setMounted] = useState(true)
  const connection = useMemo(makeConnection, [epoch])
  w.ui = { revision, epoch, date, memberId: member.id, listener, mounted }
  w.refresh = () => setRevision(v => v + 1); w.replaceConnection = () => setEpoch(v => v + 1)
  w.changeDate = () => { w.date = '2026-10-19'; setDate(w.date) }
  w.switchAccount = () => { w.currentMember = { ...originalMember, id: 'other-member', userId: 'other-user' }; setMember(w.currentMember) }
  w.changeListener = () => setListener('new'); w.unmount = () => setMounted(false); w.remount = () => setMounted(true)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>{mounted && <TimetableOperationsWorkspace connection={connection as any} member={member as any}
    date={date} revision={revision} onNavigationLockChange={value => { w.locked = value }} onWorkflowResult={result => {
      w.results.push(copy(result)); w.listeners.push(listener); if (w.resultThrows) throw Error('보조 표시 실패')
    }} />}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
