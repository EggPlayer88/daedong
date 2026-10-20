import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TeachingImportPanel, type ImportDraft } from '../../apps/workhub/src/teaching/ImportPanel'
import { rosterWorkbookSheets, rosterRawCsv, rosterReviewBasis, assertRosterImportReady } from '../../apps/workhub/src/teaching/roster-import'
import { writeTimetableXlsx } from '../../apps/workhub/src/timetable/xlsx'
import styles from '../../apps/workhub/src/teaching/teaching.css?inline'
import { teachingRosterFixture } from '../fixtures/teaching-roster-import.mjs'
const w: any = window, copy = (value: any) => structuredClone(value)
w.saved = []; w.changes = []; w.cancelled = 0
const originalRead = File.prototype.arrayBuffer
File.prototype.arrayBuffer = async function () {
  const bytes = await originalRead.call(this)
  if (w.delayNext) { w.delayNext = false; await new Promise<void>(resolve => { w.releaseRead = resolve }) }
  return bytes
}
const initial = teachingRosterFixture()
w.csv = rosterRawCsv
w.file = (rows: any[], wrongScope = false) => {
  const sheets = rosterWorkbookSheets(w.course)
  sheets[0].rows.push(...rows.map(row => [row.schoolStudentKey, row.name, String(row.grade), row.classLabel, String(row.seatNumber)]))
  if (wrongScope) sheets[2].rows[1][1] = 'another-school'
  return Array.from(writeTimetableXlsx(sheets))
}
function App() {
  const [course, setCourse] = useState(initial.course), [draft, setDraft] = useState<ImportDraft>({ ...initial.draft, rosterBasis: rosterReviewBasis(initial.course) } as ImportDraft)
  const [disabled, setDisabled] = useState(false), [shown, setShown] = useState(true)
  w.course = course; w.draft = draft; w.setDisabled = setDisabled; w.hide = () => setShown(false)
  w.updateCourse = (next: any) => setCourse(copy(next))
  const change = (next: ImportDraft) => { w.changes.push(copy(next)); setDraft(next) }
  return <><style>{styles}</style>{shown ? <TeachingImportPanel draft={draft} course={course} disabled={disabled} onChange={change} onCancel={() => { w.cancelled++; setShown(false) }} onSave={() => {
    assertRosterImportReady(draft, course); w.saved.push(copy(draft))
  }} /> : <p>가져오기를 닫았습니다.</p>}</>
}
createRoot(document.getElementById('root')!).render(<App />)
