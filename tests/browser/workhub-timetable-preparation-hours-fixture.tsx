import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetablePreparationHoursPanel } from '../../apps/workhub/src/timetable/TimetablePreparationHoursPanel'
import { exportPreparationHoursWorkbook } from '../../apps/workhub/src/timetable/preparation-hours-workbook'
import { readTimetableXlsx, writeTimetableXlsx } from '../../apps/workhub/src/timetable/xlsx'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import styles from '../../apps/workhub/src/timetable/timetable-preparation-hours.css?inline'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import appStyles from '../../apps/workhub/src/style.css?inline'
import themeStyles from '../../apps/workhub/src/appearance/theme.css?inline'

// React·엑셀 코덱을 실제로 실행하며 서버와 RPC는 이 화면에 연결하지 않는다.
const w: any = window, copy = (value: any) => structuredClone(value)
w.member = { id: 'member-a', userId: 'user-a', schoolId: 'school-a', name: '합성 담당교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.source = { sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), schoolId: 'school-a', schoolLevel: 'middle', termId: 'term-a', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', canEdit: true, canConfirm: true,
 resources: [{ id: 'teacher-a', kind: 'teacher', label: '김교사', capacity: 1 }, { id: 'class-a', kind: 'class', label: '1학년 1반', capacity: 1 }],
 courses: [{ id: 'course-a', label: '국어', requiredPeriods: null, resourceIds: ['teacher-a', 'class-a'] }, { id: 'course-b', label: '국어', requiredPeriods: null, resourceIds: ['teacher-a', 'class-a'] }, { id: 'course-fixed', label: '공식시수 수업', requiredPeriods: 2, resourceIds: ['teacher-a', 'class-a'] }], unsupportedFeatures: [], savedDraft: null }
w.draft = { title: '보존할 준비 초안', slots: [{ id: 'slot-mon', day: 1, label: '1교시', startMinute: 540, endMinute: 585, periods: 1 }], plans: w.source.courses.map((course: any) => ({ courseId: course.id, weeklyPeriods: course.requiredPeriods ?? 1, blocks: [{ id: 'block-' + course.id, periods: 1, allowedSlotIds: ['slot-mon'] }] })) }
w.before = copy(w.draft); w.drafts = createEditDrafts(); w.applied = []; w.locked = false; w.networkCalls = 0; w.disabled = false
w.readTimetableXlsx = readTimetableXlsx
w.makeFile = (kind: string = 'two') => {
 const source = copy(w.source), draft = copy(w.draft)
 if (kind === 'foreign') source.schoolId = 'school-foreign'
 const sheets = readTimetableXlsx(exportPreparationHoursWorkbook(source, draft)), rows = sheets.find(row => row.name === '주당시수')!.rows
 for (const row of rows.slice(1)) {
  if (kind === 'two' && ['course-a', 'course-b'].includes(row[0]) || kind === 'many' && row[0] !== 'course-fixed') row[6] = String(Number(row[6]) + 1)
  if (kind === 'zero' && row[0] === 'course-a') row[6] = '0'
  if (kind === 'invalid' && row[0] === 'course-a') row[6] = ''
  if (kind === 'fixed' && row[0] === 'course-fixed') row[6] = '3'
 }
 if (kind === 'deleted') rows.pop()
 if (kind === 'teacher') sheets.find(row => row.name === '공식배정')!.rows[1][1] = '위조된 배정'
 return Array.from(writeTimetableXlsx(sheets))
}
w.expand = (count: number) => { for (let i = 0; i < count; i++) { const id = 'extra-' + String(i).padStart(3, '0'); w.source.courses.push({ id, label: '동명 수업', requiredPeriods: null, resourceIds: ['teacher-a', 'class-a'] }); w.draft.plans.push({ courseId: id, weeklyPeriods: 1, blocks: [] }) } w.source = copy(w.source); w.draft = copy(w.draft); w.render() }
const originalArrayBuffer = File.prototype.arrayBuffer
File.prototype.arrayBuffer = function () { const file = this; return w.deferFile ? new Promise(resolve => { w.releaseFile = async () => { w.deferFile = false; resolve(await originalArrayBuffer.call(file)) } }) : originalArrayBuffer.call(file) }
URL.createObjectURL = (blob: Blob) => { w.lastBlob = blob; return 'blob:local-preview' }; URL.revokeObjectURL = () => {}
const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (!this.download) click.call(this) }
w.fetch = async () => { w.networkCalls++; throw new Error('이 시험은 서버를 호출하지 않습니다.') }
const style = document.createElement('style'); style.textContent = themeStyles + appStyles + baseStyles + styles; document.head.append(style)
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><TimetablePreparationHoursPanel source={w.hideSource ? undefined : w.source} draft={w.hideSource ? undefined : w.draft} member={w.member} disabled={w.disabled} onLockChange={value => { w.locked = value }} onApply={draft => { w.applied.push(copy(draft)); w.draft = draft; w.render() }} /></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.render() }; w.mount()
