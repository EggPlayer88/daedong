import React from 'react'
import { createRoot } from 'react-dom/client'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { TimetableSetupBatchPanel } from '../../apps/workhub/src/timetable/TimetableSetupBatchPanel'
import { createTimetableSetupServer } from '../../apps/workhub/src/timetable/setup-server'
import { setupWorkbookSheets, previewSetupWorkbook } from '../../apps/workhub/src/timetable/setup-workbook'
import { writeTimetableXlsx, readTimetableXlsx } from '../../apps/workhub/src/timetable/xlsx'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import batchStyles from '../../apps/workhub/src/timetable/timetable-setup-batch.css?inline'
import appStyles from '../../apps/workhub/src/style.css?inline'
import themeStyles from '../../apps/workhub/src/appearance/theme.css?inline'

// 실제 React·파일 codec·전송 어댑터와 합성 RPC를 함께 구동한다. 실제 DB·Storage는 호출하지 않는다.
const w: any = window, copy = (value: any) => structuredClone(value)
const member = { id: 'm', schoolId: 's', userId: 'u', name: '합성 담당 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.member = member; w.calls = []; w.receipts = {}; w.actualWrites = 0; w.drafts = createEditDrafts(); w.pending = createPendingRequests(); w.locked = false; w.changed = 0
w.view = { termId: 'term', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', referenceDay: '2026-10-19', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), canEdit: true,
  spaces: [{ id: 'room-a', kind: 'room', label: '과학실', capacity: 1, version: 1 }, { id: 'room-b', kind: 'room', label: '다목적실', capacity: null, version: 1 }],
  classes: [{ id: 'class-a', label: '1반', grade: 1 }, { id: 'class-b', label: '1반', grade: 2 }],
  courses: [{ id: 'course-a', label: '국어', inTimetable: true, teacherLabels: ['김교사'], studentCount: 25, link: null }, { id: 'course-b', label: '국어', inTimetable: true, teacherLabels: ['이교사'], studentCount: 24, link: { version: 1, studentGroup: false, classIds: ['class-b'], spaceIds: ['room-a'] } }], findings: [] }
w.snapshot = copy(w.view)
const envelope = (data: any) => ({ contract: 'timetable.setup.v1', schoolId: 's', memberId: 'm', data }), failure = (code: string) => ({ contract: 'timetable.setup.v1', schoolId: 's', memberId: 'm', error: { code } })
const connection: any = { info: () => ({ memberships: [member], schools: [{ id: 's' }], basisDate: '2026-10-19' }), getIdentity: async () => ({ userId: 'u', approved: true }), rpcVerified: async (name: string, args: any) => {
  w.calls.push({ name, args: copy(args) })
  if (name === 'workhub_timetable_setup_get') {
    if (w.holdRead) await new Promise<void>(resolve => { w.releaseRead = () => { w.holdRead = false; delete w.releaseRead; resolve() } })
    if (w.failRead) throw { code: 'QUERY_FAILED' }
    return envelope(copy(w.view))
  }
  if (name !== 'workhub_timetable_setup_execute') throw Error('예상하지 않은 RPC ' + name)
  const c = args.p_command, key = args.p_request_key
  if (args.p_recover_only) return w.receipts[key] ? envelope(copy(w.receipts[key])) : failure('NOT_FOUND')
  if (w.receipts[key]) return envelope(copy(w.receipts[key]))
  if (w.dropBeforeOnce) { w.dropBeforeOnce = false; throw { code: 'QUERY_FAILED' } }
  if (w.rejectAt === w.actualWrites + 1) return failure('CONFLICT')
  let targetId: string, version: number
  if (c.kind === 'space_save') {
    const previous = w.view.spaces.find((row: any) => row.id === c.spaceId)
    if (!previous || previous.version !== c.expectedVersion) return failure('CONFLICT')
    targetId = previous.id; version = previous.version + 1
    w.view.spaces = w.view.spaces.map((row: any) => row.id === targetId ? { id: targetId, version, ...copy(c.input) } : row)
  } else if (c.kind === 'course_link') {
    const previous = w.view.courses.find((row: any) => row.id === c.courseId)
    if (!previous || (previous.link?.version ?? null) !== c.expectedVersion) return failure('CONFLICT')
    targetId = previous.id; version = (previous.link?.version ?? 0) + 1; previous.link = { version, ...copy(c.input) }
  } else throw Error('일괄 작업은 추가·삭제를 보내면 안 됩니다')
  w.actualWrites++; w.view.sourceRevision++; w.view.sourceFingerprint = w.view.sourceRevision.toString(16).padStart(64, '0')
  w.receipts[key] = { requestKey: key, kind: c.kind, targetId, version, sourceFingerprint: w.view.sourceFingerprint }
  if (w.holdAfterWrite) await new Promise<void>(resolve => { w.releaseWrite = () => { w.holdAfterWrite = false; delete w.releaseWrite; resolve() } })
  if (w.dropOnce) { w.dropOnce = false; throw { code: 'QUERY_FAILED' } }
  return envelope(copy(w.receipts[key]))
} }
const server = createTimetableSetupServer(connection)
Object.assign(w, { zipSync, unzipSync, strToU8, strFromU8, setupWorkbookSheets, previewSetupWorkbook, writeTimetableXlsx, readTimetableXlsx })
const createUrl = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { w.lastBlob = blob; return createUrl(blob) }
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{appStyles + themeStyles + baseStyles + batchStyles}</style><main className="timetable-workspace"><TimetableSetupBatchPanel server={server} snapshot={w.hideSource ? undefined : w.snapshot} member={member} disabled={Boolean(w.disabled)} onLockChange={value => w.locked = value} onChanged={() => { w.changed++; w.snapshot = copy(w.view); w.render() }} /></main></PendingRequestsProvider></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.render() }
w.makeFile = (kind = 'two') => {
  const sheets = setupWorkbookSheets(w.snapshot, 's'), spaces = sheets.find((row: any) => row.name === '공간')!.rows, courses = sheets.find((row: any) => row.name === '수업연결')!.rows
  if (kind !== 'none') { spaces.find((row: any) => row[0] === 'room-a')![3] = '2'; courses.find((row: any) => row[0] === 'course-a')![3] = 'class-a'; courses.find((row: any) => row[0] === 'course-a')![5] = 'room-a' }
  if (kind === 'null') { spaces.find((row: any) => row[0] === 'room-a')![3] = ''; courses.find((row: any) => row[0] === 'course-a')![3] = ''; courses.find((row: any) => row[0] === 'course-a')![5] = '' }
  if (kind === 'foreign') sheets.find((row: any) => row.name === '기준')!.rows.find((row: any) => row[0] === '학교')![1] = 'other-school'
  if (kind === 'invalid') spaces.find((row: any) => row[0] === 'room-a')![3] = '0'
  if (kind === 'deleted') spaces.splice(1, 1)
  if (kind === 'many') for (const row of courses.slice(1)) { row[3] = 'class-a'; row[5] = '' }
  const bytes = writeTimetableXlsx(sheets)
  if (kind === 'formula') { const files = unzipSync(bytes); files['xl/worksheets/sheet3.xml'] = strToU8(strFromU8(files['xl/worksheets/sheet3.xml']).replace('<is>', '<f>1+1</f><is>')); return Array.from(zipSync(files)) }
  return Array.from(bytes)
}
w.mount()
