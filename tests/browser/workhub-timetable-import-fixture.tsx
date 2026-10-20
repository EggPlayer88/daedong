import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableImportPanel } from '../../apps/workhub/src/timetable/TimetableImportPanel'
import { createTimetableImportServer } from '../../apps/workhub/src/timetable/import-server'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import { TimetableActionSummaryPanel } from '../../apps/workhub/src/timetable/TimetableActionSummary'
import { ServiceError } from '../../apps/workhub/src/services/scoped-rpc'
import theme from '../../apps/workhub/src/style.css?inline'
import styles from '../../apps/workhub/src/timetable/timetable.css?inline'
import { timetableImportWorkbookSheets } from '../../apps/workhub/src/timetable/import-workbook'
import { writeTimetableXlsx } from '../../apps/workhub/src/timetable/xlsx'
const w: any = window, copy = (v: any) => structuredClone(v)
w.member = { id: 'manager', schoolId: 'school', userId: 'user', name: '합성 관리자', role: 'school_admin', active: true, validFrom: '2020-01-01', validThrough: '2100-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.source = { schoolId: 'school', schoolLevel: 'middle', termId: 'term', termLabel: '2027학년도 1학기', firstDay: '2027-03-01', lastDay: '2027-08-12', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64),
 canEdit: true, canConfirm: true, resources: [{ id: 'teacher', kind: 'teacher', label: '교사', capacity: 1 }, { id: 'class', kind: 'class', label: '학급', capacity: 1 }, { id: 'room', kind: 'room', label: '교실', capacity: 1 }],
 courses: [{ id: 'course', label: '국어', requiredPeriods: 1, resourceIds: ['teacher', 'class', 'room'] }], unsupportedFeatures: [], savedDraft: null }
w.calls = []; w.receipts = {}; w.closed = {}; w.commands = {}; w.actualWrites = 0; w.published = []; w.locks = []
w.workbook = async (kind: string = 'valid') => {
 const sheets = await timetableImportWorkbookSheets(w.source), row = sheets[0].rows[1]
 row.splice(2, 5, '1', '국어 1회', '09:00', '09:45', '1')
 if (kind === 'stale') sheets.find(s => s.name === '_학교연결')!.rows.find(r => r[0] === 'sourceFingerprint')![1] = 'b'.repeat(64)
 return Array.from(writeTimetableXlsx(sheets))
}
w.pending = createPendingRequests(); w.drafts = createEditDrafts()
const envelope = (data: any) => ({ contract: 'timetable-import.v1', schoolId: 'school', memberId: 'manager', data })
const fail = (code: string) => ({ contract: 'timetable-import.v1', schoolId: 'school', memberId: 'manager', error: { code } })
const connection: any = {
 info: () => ({ memberships: [w.member], schools: [{ id: 'school' }], basisDate: '2026-10-20' }),
 getIdentity: async () => ({ userId: w.member.userId, approved: true }),
 rpcVerified: async (name: string, args: any) => {
  w.calls.push({ name, args: copy(args) })
  if (name.endsWith('_get')) { if (w.failGet) throw new Error('합성 조회 실패'); return envelope(copy(w.source)) }
  if (name.endsWith('_preview')) return envelope({ previewId: 'preview', fingerprint: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), input: args.p_input, termId: 'term', courseCount: 1, lessonCount: 1, existingPublicationsPreserved: true })
  const c = args.p_command, key = args.p_request_key
  if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(c)) return fail('IDEMPOTENCY_CONFLICT')
  w.commands[key] = copy(c)
  if (name.endsWith('_close')) {
   const result = w.receipts[key] ? { requestKey: key, outcome: 'applied', receipt: w.receipts[key] } : { requestKey: key, outcome: 'closed', receipt: null }
   if (!w.receipts[key]) w.closed[key] = true
   if (w.dropClose) { w.dropClose = false; throw new Error('응답 유실') }
   return envelope(result)
  }
  if (w.receipts[key]) return envelope(w.receipts[key])
  if (w.closed[key] || w.conflict) return fail('CONFLICT')
  if (w.dropBefore) { w.dropBefore = false; throw new Error('응답 유실') }
  w.actualWrites++
  w.receipts[key] = { requestKey: key, previewId: c.previewId, termId: 'term', basisId: 'basis', basisRevision: 1, draftId: 'draft', draftVersion: 1, lessonCount: 1, recordedAt: new Date().toISOString(), published: false }
  if (w.dropAfter) { w.dropAfter = false; throw new Error('응답 유실') }
  return envelope(w.receipts[key])
 },
}
w.server = createTimetableImportServer(connection)
w.summary = { asOf: new Date().toISOString(), pendingConsent: 1, pendingApproval: 1, makeupNeeded: 1, items: [
 { id: 'consent', kind: 'consent', label: '국어 대강 동의', date: '2027-03-08', lessonId: 'lesson', requestId: 'request' },
 { id: 'approval', kind: 'approval', label: '보강 승인', date: '2027-03-09', lessonId: 'lesson2', requestId: 'request2' },
 { id: 'makeup', kind: 'makeup', label: '휴강 보강 검토', date: '2027-03-10', lessonId: 'lesson3', requestId: null },
] }
w.summaryServer = { summary: async () => { if (w.summaryFail) throw new ServiceError(w.summaryFail); return copy(w.summary) } }
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>
 <style>{theme + styles}</style><main className="timetable-workspace">
 <TimetableImportPanel server={w.server} member={w.member} onLockChange={v => { w.locked = v; w.locks.push(v) }} onOpenPublish={v => w.published.push(v)} onOpenSchoolAdmin={() => {}} onOpenTeaching={() => {}} />
 <TimetableActionSummaryPanel server={w.summaryServer} member={w.member} date="2026-10-20" revision={w.revision ?? 0} onOpen={item => w.summaryOpened = copy(item)} />
 </main></PendingRequestsProvider></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.render() }
w.mount()
