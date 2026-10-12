import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { ObservationDraft, ObservationView, SourceView } from './contracts'
import type { StudentStore } from './store'
import './students.css'
import { useEditSession } from '../app/EditSession'
import { evidenceSignature, readObservationRows, searchRoster, studentRecordWorkspace, type RecordFilters, type RecordState } from './presentation'
import { ActivityObservationEntry, ObservationEntry } from './ObservationEntry'
import type { ObservationInput } from './entry'
import { observationLimits } from './entry'

export interface StudentsPanelProps { member: Membership; members: Membership[]; date: string; store: StudentStore }
interface ActivityEntryDraft { studentId: string; fact: string; confirmed: boolean; entryVersion: string; selectionDirty: boolean }
const key = () => globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random()}`
const messageOf = (error: unknown) => error instanceof Error ? error.message : '학생 자료를 처리하지 못했습니다.'
const labels = { received: '학생 연결 확인 전', mapped: '연결 확인 완료', adopted: '관찰로 채택됨', withdrawn: '원자료 철회', deleted: '삭제 이력 · 재수신 차단' }

export function StudentsPanel(props: StudentsPanelProps) {
  // 외부 셸의 학교·소속 변경을 매번 반영한다. 이 검사는 실제 인증을 대신하지 않는다.
  props.store.setContext(props.members, props.date)
  return <StudentWorkspace key={`${props.member.id}:${props.date}`} {...props} />
}

function StudentWorkspace({ member, date, store }: StudentsPanelProps) {
  const formId = useId()
  const panel = useRef<HTMLElement>(null)
  const savedPanel = useRef<HTMLDivElement>(null)
  const recordsHeading = useRef<HTMLHeadingElement>(null)
  const readErrorPanel = useRef<HTMLDivElement>(null)
  const appliedRecordFocus = useRef(''), appliedEntryFocus = useRef(0), appliedSavedFocus = useRef(0)
  const activityDrafts = useRef(new Map<string, ActivityEntryDraft>())
  const [activityDraftCount, setActivityDraftCount] = useState(0)
  const [tab, setTab] = useState<'records' | 'activities'>('records')
  const [courseId, setCourseId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [entryEnrollmentId, setEntryEnrollmentId] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [filters, setFilters] = useState<Omit<RecordFilters, 'studentId' | 'courseId'>>({ scope: 'selected', from: '', until: '', kind: 'all', state: 'all' })
  const [observedAt, setObservedAt] = useState(date)
  const [activity, setActivity] = useState('')
  const [content, setContent] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<ObservationView>()
  const [entryReset, setEntryReset] = useState(0)
  const [entryFocus, setEntryFocus] = useState(0)
  const [savedRecord, setSavedRecord] = useState<ObservationView>()
  const [savedFocus, setSavedFocus] = useState(0)
  const [readFocus, setReadFocus] = useState(0)
  const [recordFocus, setRecordFocus] = useState<{ id: string; key: string }>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [exportText, setExportText] = useState('')
  const [exportSignature, setExportSignature] = useState('')
  const [, repaint] = useState(0)
  const dirty = Boolean(activity || content || confirmed || reason || editing)
  const requestChange = useEditSession(dirty || activityDraftCount > 0)
  const refresh = () => { setExportText(''); repaint(value => value + 1) }
  let courses: ReturnType<StudentStore['listCourses']> = []
  let records: ObservationView[] = []
  let activities: SourceView[] = []
  let accessError = ''
  try { courses = store.listCourses(member.id, observedAt); records = readObservationRows(store.listRecords(member.id)); activities = store.listActivities(member.id) }
  catch (failure) { accessError = messageOf(failure) }
  const selectedCourse = courseId ? courses.find(course => course.id === courseId) : courses[0]
  let students: ReturnType<StudentStore['listStudents']> = []
  if (selectedCourse && !accessError) {
    try { students = store.listStudents(member.id, selectedCourse.id, observedAt) } catch (failure) { accessError = messageOf(failure) }
  }
  const selectedStudent = studentId ? students.find(student => student.id === studentId) : students[0]
  const roster = searchRoster(students, studentQuery)
  const workspace = studentRecordWorkspace(records, { ...filters, studentId: selectedStudent?.id, courseId: selectedCourse?.id })
  const visibleExport = exportSignature === evidenceSignature(records) ? exportText : ''
  const changeFilter = (changes: Partial<typeof filters>) => requestChange(() => setFilters(value => ({ ...value, ...changes })))
  useEffect(() => {
    if (!recordFocus || recordFocus.key === appliedRecordFocus.current || accessError || tab !== 'records') return
    const card = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-student-record-id]') ?? []).find(node => node.dataset.studentRecordId === recordFocus.id)
    const target = card ?? recordsHeading.current
    if (target) appliedRecordFocus.current = recordFocus.key
    target?.focus(); target?.scrollIntoView({ block: 'nearest' })
  }, [recordFocus, accessError, tab])
  useEffect(() => {
    if (!entryFocus || entryFocus === appliedEntryFocus.current || accessError || tab !== 'records') return
    const field = panel.current?.querySelector<HTMLElement>('[data-entry-field="activity"]')
    if (field) appliedEntryFocus.current = entryFocus
    field?.focus(); field?.scrollIntoView({ block: 'nearest' })
  }, [entryFocus, accessError, tab])
  useEffect(() => {
    if (!savedFocus || savedFocus === appliedSavedFocus.current || accessError) return
    if (savedPanel.current) appliedSavedFocus.current = savedFocus
    savedPanel.current?.focus(); savedPanel.current?.scrollIntoView({ block: 'nearest' })
  }, [savedFocus, accessError])
  useEffect(() => {
    if (accessError) readErrorPanel.current?.focus()
    else if (readFocus) panel.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [accessError, readFocus])
  function announceSaved(record: ObservationView) { setSavedRecord(record); setSavedFocus(value => value + 1) }
  function cancelObservation() {
    const recordId = editing?.id
    clearForm()
    if (recordId) setRecordFocus({ id: recordId, key: key() })
    else setEntryFocus(value => value + 1)
  }
  function changeInput(patch: Partial<ObservationInput>) {
    // 첫 입력부터 실제 선택한 ID를 고정해 명부 갱신이 다른 학생으로 대체하지 못하게 한다.
    if (selectedCourse) setCourseId(selectedCourse.id)
    if (selectedStudent) setStudentId(selectedStudent.id)
    if (selectedStudent && !entryEnrollmentId) setEntryEnrollmentId(selectedStudent.enrollmentId)
    if (patch.activity !== undefined) setActivity(patch.activity)
    if (patch.content !== undefined) setContent(patch.content)
    if (patch.reason !== undefined) setReason(patch.reason)
    setConfirmed(patch.confirmed ?? false)
  }
  function openRecord(id: string) {
    run(() => {
      const record = store.getRecord(member.id, id)
      setTab('records'); setFilters({ scope: 'all', from: '', until: '', kind: 'all', state: 'all' }); setRecordFocus({ id: record.id, key: key() })
    })
  }
  function continueRecord(id: string) {
    run(() => {
      const record = store.getRecord(member.id, id)
      clearForm(); setTab('records'); setCourseId(record.current.courseId); setStudentId(record.current.studentId); setObservedAt(record.current.observedAt); setStudentQuery(''); setSavedRecord(undefined); setEntryFocus(value => value + 1)
    })
  }
  function showEvidence() {
    setError('')
    try { setExportText(store.exportEvidence(member.id)); setExportSignature(evidenceSignature(readObservationRows(store.listRecords(member.id)))) } catch (failure) { setError(messageOf(failure)); setExportText('') }
  }
  function downloadEvidence() {
    setError('')
    try {
      const latest = store.exportEvidence(member.id)
      if (latest !== exportText) { setExportText(latest); setExportSignature(evidenceSignature(readObservationRows(store.listRecords(member.id)))); setNotice('근거 목록이 바뀌어 최신 내용으로 갱신했습니다. 내용을 확인한 뒤 다시 내려받아 주세요.'); return }
      const blob = new Blob([latest], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `합성_관찰근거_${date}.txt`; anchor.click(); URL.revokeObjectURL(url)
    } catch (failure) { setError(messageOf(failure)); setExportText('') }
  }
  function run(action: () => void) { setError(''); setNotice(''); try { action(); refresh() } catch (failure) { setError(messageOf(failure)) } }
  function clearForm() { setActivity(''); setContent(''); setConfirmed(false); setReason(''); setEditing(undefined); setEntryEnrollmentId(''); setEntryReset(value => value + 1) }
  function save() {
    if (!selectedCourse || !selectedStudent) { setError('해당 날짜의 승인된 수업과 학생을 선택해 주세요.'); return }
    const draft: ObservationDraft = { courseId: selectedCourse.id, studentId: selectedStudent.id, enrollmentId: selectedStudent.enrollmentId, observedAt, activity, content, confirmed }
    if (entryEnrollmentId && draft.enrollmentId !== entryEnrollmentId) { setError('작성 중인 학생의 학적 연결이 바뀌었습니다. 입력을 취소한 뒤 명부를 다시 확인해 주세요.'); return }
    if (editing && (draft.courseId !== editing.current.courseId || draft.studentId !== editing.current.studentId || draft.enrollmentId !== editing.current.enrollmentId)) { setError('정정할 기록의 학생·수업 연결이 바뀌었습니다. 정정을 취소하고 원기록을 다시 확인해 주세요.'); return }
    run(() => {
      const saved = editing ? store.reviseObservation(member.id, editing.id, editing.current.version, draft, reason, key()) : store.createObservation(member.id, draft, key())
      clearForm(); announceSaved(saved); setNotice(`${saved.studentName} · ${saved.current.observedAt} 관찰 기록 v${saved.current.version} 저장 완료. 이전 개정본은 보존됩니다.`)
    })
  }
  function edit(record: ObservationView) {
    setTab('records'); setStudentQuery(''); setSavedRecord(undefined); setEditing(record); setCourseId(record.current.courseId); setStudentId(record.current.studentId); setObservedAt(record.current.observedAt); setActivity(record.current.activity); setContent(record.current.content); setReason(''); setConfirmed(false); setEntryFocus(value => value + 1); setError(''); setNotice('기존 기록의 새 개정본을 작성합니다. 정정 사유와 사실 확인이 필요합니다.')
  }
  function sample() {
    if (!selectedCourse) { setError('승인된 수업을 먼저 선택해 주세요.'); return }
    run(() => {
      const source = store.receiveActivity(member.id, { eventId: `sample-${selectedCourse.id}-1`, sourceSystem: 'synthetic-digital-ethics', activityId: `sample-${date}`, itemId: 'answer-a', revision: 1, operation: 'upsert', courseId: selectedCourse.id, occurredAt: date, questionVersion: 'demo-question-v1', question: '온라인에서 다른 사람의 자료를 공유할 때 무엇을 확인할까요?', answer: '작성자의 허락과 출처 표시 여부를 확인해야 한다고 생각합니다.', alias: '가상 별명 A' })
      setNotice(`가상 활동 수신 완료 · ${labels[source.state]}. 이름을 추측해 연결하지 않았습니다.`); setTab('activities')
    })
  }
  return <section className="students-panel" aria-labelledby={`${formId}-title`} ref={panel}>
    <header className="students-header"><div><p className="eyebrow">나의 수업 · 작성자 전용 기록</p><h2 id={`${formId}-title`} tabIndex={-1}>학생과 수업 기록</h2><p>확인한 사실을 차곡차곡 남기고, 나중에 근거를 다시 찾습니다.</p></div><span className="students-badge">합성 자료 전용</span></header>
    <div className="students-boundary">로컬 개발 미리보기입니다. 실제 학생 정보를 입력하지 마세요. 관리자도 다른 작성자의 본문·건수·근거 목록을 볼 수 없도록 계약을 시험합니다.</div>
    {accessError ? <div role="alert" className="students-error" ref={readErrorPanel} tabIndex={-1}><p>{accessError}</p>{(dirty || activityDraftCount > 0) && <p>작성 중인 내용은 유지했습니다. 조회가 복구되면 이어서 작성할 수 있습니다.</p>}<div className="button-row"><button type="button" className="secondary" onClick={() => { repaint(value => value + 1); setReadFocus(value => value + 1) }}>학생 자료 다시 확인</button>{(dirty || activityDraftCount > 0) && <button type="button" className="secondary" onClick={() => { clearForm(); activityDrafts.current.clear(); setActivityDraftCount(0); setReadFocus(value => value + 1) }}>보관한 입력 취소</button>}</div></div> : <>
      <div className="students-tabs" aria-label="학생 업무 선택"><button type="button" aria-pressed={tab === 'records'} onClick={() => requestChange(() => setTab('records'))}>내 학급·기록</button><button type="button" aria-pressed={tab === 'activities'} onClick={() => requestChange(() => setTab('activities'))}>수업 활동 받은함 <span>{activities.length}</span></button></div>
      {error && <p role="alert" className="students-error">{error} 입력한 내용은 유지했습니다.</p>}
      {notice && <p role="status" className="students-notice">{notice}</p>}
      {savedRecord && <div className="students-saved" role="region" aria-label="저장한 관찰 기록" aria-describedby={`${formId}-saved-details`} tabIndex={-1} ref={savedPanel}><div id={`${formId}-saved-details`}><strong>{savedRecord.studentName} · {savedRecord.current.observedAt} · v{savedRecord.current.version}</strong><p>{savedRecord.current.source ? '수업 활동을 확인해 채택한 기록' : '직접 관찰 기록'} · {savedRecord.current.activity}</p></div><div className="button-row"><button type="button" className="secondary" onClick={() => requestChange(() => openRecord(savedRecord.id))}>저장한 기록 보기</button><button type="button" className="secondary" onClick={() => requestChange(() => continueRecord(savedRecord.id))}>같은 학생 새 기록</button></div></div>}
      <div className="students-context"><label>수업 기준일<input type="date" value={observedAt} max={date} onChange={event => { const value = event.target.value; if (value) requestChange(() => { setObservedAt(value); setStudentId(''); setStudentQuery(''); clearForm() }) }} /></label><label>승인된 내 수업<select value={selectedCourse?.id ?? ''} onChange={event => { const value = event.target.value; requestChange(() => { setCourseId(value); setStudentId(''); setStudentQuery(''); clearForm() }) }}><option value="" disabled>수업 선택</option>{courses.map(course => <option key={course.id} value={course.id}>{course.classLabel} · {course.label}</option>)}</select></label><button type="button" className="secondary" onClick={() => requestChange(sample)} disabled={!selectedCourse}>가상 수업 활동 받기</button></div>
      {!courses.length && <p className="students-empty">이 날짜에 승인된 수업 배정이 없습니다. 교사 본인 신고나 시간표 표시만으로 명부 권한이 생기지 않습니다.</p>}
      {tab === 'records' ? <>
        <div className="students-layout"><article className="students-card"><h2>내 학급 명부</h2><p className="students-muted">수업 기준일에 수강하는 학생만 표시합니다. 이름·번호가 바뀌어도 학생 ID는 유지됩니다.</p><label>학생 찾기<input type="search" value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="이름 또는 번호" autoComplete="off" /></label><p className="students-roster-count" role="status">명부 {students.length}명 중 {roster.length}명 표시</p>{selectedStudent && <p className="students-selected">선택 학생 <strong>{selectedStudent.number}번 · {selectedStudent.name}</strong>{!roster.some(student => student.id === selectedStudent.id) && <span>검색 결과에는 없지만 선택을 유지하고 있습니다.</span>}</p>}<div className="students-roster">{roster.map(student => <button type="button" key={student.id} aria-pressed={student.id === selectedStudent?.id} onClick={() => requestChange(() => { setStudentId(student.id); clearForm() })}><span>{student.number}번 · {student.name}</span><small>{student.id}</small></button>)}</div>{!roster.length && <p className="students-empty">{students.length ? '검색 조건에 맞는 학생이 없습니다. 이름이나 번호를 다시 확인해 주세요.' : '이 수업 기준일에 조회할 수 있는 학생이 없습니다.'}</p>}{selectedStudent && <p className="students-muted">학적 기간: {selectedStudent.enrollmentFrom}부터 {selectedStudent.enrollmentUntil} 전까지</p>}</article>
        <ObservationEntry input={{ activity, content, reason, confirmed }} target={{ student: selectedStudent ? `${selectedStudent.number}번 · ${selectedStudent.name}` : editing?.studentName ?? '학생 선택 필요', course: selectedCourse ? `${selectedCourse.classLabel} · ${selectedCourse.label}` : '해당 날짜의 승인 수업 확인 필요', date: observedAt, valid: Boolean(selectedCourse && selectedStudent && (!entryEnrollmentId || selectedStudent.enrollmentId === entryEnrollmentId) && (!editing || selectedStudent.enrollmentId === editing.current.enrollmentId)) }} version={editing?.current.version} dirty={dirty} resetToken={entryReset} onChange={changeInput} onSave={save} onCancel={cancelObservation} /></div>
        <article className="students-card students-records"><div className="students-record-heading"><div><h2 ref={recordsHeading} tabIndex={-1}>내 관찰 기록</h2><p className="students-muted">선택한 학생의 기록을 살펴보고, 필요한 기간과 근거를 찾습니다. 다른 교사의 기록은 집계하지 않습니다.</p></div><button className="secondary" type="button" onClick={showEvidence}>근거 목록 텍스트 보기</button></div>
          <p className="students-export-scope">근거 목록은 현재 학교에서 본인이 작성한 모든 유효 기록을 포함합니다. 아래 조회 조건과 관계없이 전체 원자료를 다시 확인합니다.</p>
          <div className="students-record-filters"><label>기록 범위<select aria-label="기록 범위" value={filters.scope} onChange={event => changeFilter({ scope: event.target.value as typeof filters.scope })}><option value="selected">선택 학생 · 현재 수업</option><option value="all">내 전체 기록 · 이전 수업 포함</option></select></label><label>조회 시작일<input type="date" value={filters.from} max={date} onChange={event => changeFilter({ from: event.target.value })} /></label><label>조회 종료일<input type="date" value={filters.until} max={date} onChange={event => changeFilter({ until: event.target.value })} /></label><label>기록 종류<select aria-label="기록 종류" value={filters.kind} onChange={event => changeFilter({ kind: event.target.value as typeof filters.kind })}><option value="all">모든 종류</option><option value="direct">직접 관찰</option><option value="adopted">수업 활동 채택</option></select></label><button type="button" className="secondary" onClick={() => changeFilter({ from: '', until: '', kind: 'all', state: 'all' })}>조회 조건 초기화</button></div>
          {workspace.error ? <p role="alert" className="students-error">{workspace.error}</p> : <>
            <p className="students-muted">{filters.scope === 'selected' ? `${selectedStudent?.name ?? '선택 학생 없음'} · 현재 수업` : '내 전체 기록'}의 조회 기간·종류 기준입니다. 철회 이력과 재검토 기록은 유효 근거에서 분리합니다.</p>
            <div className="students-record-summary" aria-label="관찰 기록 상태">{([['all', '전체 기록'], ['ready', '유효 근거'], ['review', '원자료 재검토'], ['withdrawn', '철회 이력']] as [RecordState, string][]).map(([state, label]) => <button type="button" key={state} aria-pressed={filters.state === state} aria-label={`${label} ${workspace.counts[state]}건 보기`} className={state === 'review' && workspace.counts.review ? 'needs-review' : ''} onClick={() => changeFilter({ state })}><span>{label}</span><strong>{workspace.counts[state]}<small>건</small></strong></button>)}</div>
            <p className="students-result-count" role="status">조회 결과 {workspace.records.length}건 · 관찰일 최신순</p>
            {!workspace.records.length && <p className="students-empty">{!records.length ? '아직 본인이 작성한 관찰 기록이 없습니다.' : '현재 학생과 조회 조건에 맞는 기록이 없습니다. 범위를 바꾸거나 조회 조건을 초기화해 보세요.'}</p>}
            {workspace.records.map((record, index) => <RecordCard key={record.id} record={record} position={index + 1} onEdit={() => requestChange(() => edit(record))} onWithdraw={why => run(() => { store.withdrawObservation(member.id, record.id, record.current.version, why, key()); setRecordFocus({ id: record.id, key: key() }); setNotice('철회 이력을 남겼습니다. 유효 근거 목록에서 제외됩니다.') })} />)}
          </>}
          {visibleExport && <div className="students-export"><label>나의 근거 목록 · 현재 학교의 본인 전체 기록 · AI 생기부 초안 아님<textarea aria-label="나의 근거 목록" readOnly rows={9} value={visibleExport} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="secondary" onClick={downloadEvidence}>텍스트 파일 내려받기</button><p className="students-muted">내려받기 직전에 전체 원자료의 최신판을 다시 확인합니다. 이미 내려받은 파일은 자동 회수되지 않습니다.</p></div>}</article>
      </> : <article className="students-card"><h2>수업 활동 받은함</h2><p className="students-muted">가상 외부 사건을 수신해 검토하는 흐름입니다. 실제 디지털윤리 사이트에 연결하지 않으며 현재 사이트 CSV를 읽는 파서는 아직 없습니다.</p>{!activities.length && <p className="students-empty">위의 ‘가상 수업 활동 받기’로 수신→학생 확인→관찰 채택을 시험해 보세요.</p>}{activities.map((source, index) => <ActivityCard key={source.id} source={source} position={index + 1} member={member} store={store} run={run} onNotice={setNotice} onSaved={announceSaved} drafts={activityDrafts.current} onDraftCountChange={setActivityDraftCount} />)}</article>}
    </>}
  </section>
}

function RecordCard({ record, position, onEdit, onWithdraw }: { record: ObservationView; position: number; onEdit: () => void; onWithdraw: (reason: string) => void }) {
  const id = useId(), reasonField = useRef<HTMLInputElement>(null), withdrawToggle = useRef<HTMLButtonElement>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const reasonError = !reason.trim() ? '철회 사유를 입력해 주세요. 이전 기록과 함께 보존됩니다.' : reason.length > observationLimits.reason ? `철회 사유는 ${observationLimits.reason}자 이내로 작성해 주세요.` : ''
  useEditSession(withdrawing && record.current.state === 'active')
  useEffect(() => { if (withdrawing) reasonField.current?.focus() }, [withdrawing])
  return <section className="students-record" tabIndex={-1} data-student-record-id={record.id} aria-labelledby={`${id}-title ${id}-activity`} aria-describedby={`${id}-state`}>
    <div className="students-record-heading"><h3 id={`${id}-title`}><span className="students-sr-only">관찰 기록 {position} · </span>{record.studentName} <small>{record.current.observedAt} · v{record.current.version}</small></h3><span id={`${id}-state`} className={`students-badge ${record.needsReview ? 'warning' : ''}`}>{record.current.state === 'withdrawn' ? '철회됨' : record.needsReview ? '원자료 재검토 필요' : '본인 확인 기록'}</span></div>
    <strong id={`${id}-activity`}>{record.current.activity}</strong><p className="students-content">{record.current.content}</p>
    {record.current.source && <p className="students-muted">출처 {record.current.source.sourceId} · 원자료 판 {record.current.source.sourceRevision} · 연결 판 {record.current.source.mappingRevision}</p>}
    {record.needsReview && record.current.state === 'active' && <p className="students-warning">원자료가 바뀌었습니다. 근거 내보내기를 중지했습니다. 이 기록을 철회하고 받은함에서 새 원문을 확인한 뒤 다시 채택하세요.</p>}
    <details><summary aria-describedby={`${id}-title ${id}-activity`}>불변 개정 이력 {record.revisions.length}개</summary><ol className="students-history">{record.revisions.map(revision => <li key={revision.version}><strong>v{revision.version} · {revision.state === 'withdrawn' ? '철회' : '작성/정정'}</strong><span>{revision.reason}</span><p>{revision.content}</p></li>)}</ol></details>
    {record.current.state === 'active' && <div className="button-row"><button type="button" className="secondary small" onClick={onEdit} disabled={record.needsReview} aria-describedby={`${id}-title ${id}-activity`}>정정하기</button><button ref={withdrawToggle} type="button" className="secondary small" aria-expanded={withdrawing} aria-controls={withdrawing ? `${id}-withdraw` : undefined} aria-describedby={`${id}-title ${id}-activity`} onClick={() => { setWithdrawing(value => !value); setAttempted(false); withdrawToggle.current?.focus() }}>{withdrawing ? '철회 입력 취소' : '철회하기'}</button></div>}
    {withdrawing && record.current.state === 'active' && <form id={`${id}-withdraw`} className="students-withdraw" aria-label={`${position}번 관찰 기록 철회`} aria-describedby={`${id}-title ${id}-activity`} noValidate onSubmit={event => { event.preventDefault(); setAttempted(true); if (reasonError) reasonField.current?.focus(); else onWithdraw(reason) }}><label>철회 사유<input ref={reasonField} aria-label="철회 사유" value={reason} onChange={event => setReason(event.target.value)} maxLength={observationLimits.reason} required aria-invalid={attempted && Boolean(reasonError)} aria-describedby={`${id}-withdraw-help`} /><span id={`${id}-withdraw-help`} className={attempted && reasonError ? 'students-field-error' : 'students-muted'} role={attempted && reasonError ? 'alert' : undefined}>{attempted && reasonError ? reasonError : '철회해도 이전 기록과 사유는 보존됩니다.'}</span></label><button type="submit" className="secondary">사유와 함께 철회</button></form>}
  </section>
}
function ActivityCard({ source, position, member, store, run, onNotice, onSaved, drafts, onDraftCountChange }: { source: SourceView; position: number; member: Membership; store: StudentStore; run: (action: () => void) => void; onNotice: (message: string) => void; onSaved: (record: ObservationView) => void; drafts: Map<string, ActivityEntryDraft>; onDraftCountChange: (count: number) => void }) {
  const id = useId(), card = useRef<HTMLElement>(null)
  const [focusRequest, setFocusRequest] = useState<{ kind: 'mapping' | 'entry'; key: string }>()
  const [draft, setDraft] = useState<ActivityEntryDraft>(() => drafts.get(source.id) ?? { studentId: source.mapping?.studentId ?? '', fact: '', confirmed: false, entryVersion: `${source.current.revision}:${source.mapping?.revision ?? 0}`, selectionDirty: false })
  const { fact, confirmed, entryVersion, selectionDirty } = draft
  function updateDraft(patch: Partial<ActivityEntryDraft>) {
    const next = { ...draft, ...patch }
    if (next.fact || next.confirmed || next.selectionDirty) drafts.set(source.id, next)
    else drafts.delete(source.id)
    setDraft(next); onDraftCountChange(drafts.size)
  }
  const [, retry] = useState(0)
  const sourceVersion = `${source.current.revision}:${source.mapping?.revision ?? 0}`
  let students: ReturnType<StudentStore['listStudents']> = []
  let courseLabel = '승인 수업 확인 필요', readError = ''
  try {
    students = store.listStudents(member.id, source.current.courseId, source.current.occurredAt)
    const course = store.listCourses(member.id, source.current.occurredAt).find(item => item.id === source.current.courseId)
    if (course) courseLabel = `${course.classLabel} · ${course.label}`
  } catch (failure) { readError = messageOf(failure) }
  const draftChanged = Boolean(fact || confirmed)
  // 이전 확정 선택은 원문 갱신 때 새 미확정 입력으로 취급하지 않는다.
  const studentId = draftChanged || selectionDirty ? draft.studentId : source.mapping?.studentId ?? ''
  const selected = students.find(student => student.id === studentId)
  const enabled = source.current.operation === 'upsert'
  const sourceChanged = draftChanged && (entryVersion !== sourceVersion || source.state === 'adopted' || !enabled)
  const mappingMatches = Boolean(source.mapping && selected?.id === source.mapping.studentId && selected?.enrollmentId === source.mapping.enrollmentId)
  const requestChange = useEditSession(draftChanged || selectionDirty)
  useEffect(() => {
    if (!focusRequest) return
    const target = card.current?.querySelector<HTMLElement>(focusRequest.kind === 'entry' ? '[data-entry-field="content"]' : '.students-map select:not(:disabled)') ?? card.current
    target?.focus(); target?.scrollIntoView({ block: 'nearest' })
  }, [focusRequest])
  function cancelInput() { updateDraft({ fact: '', confirmed: false, studentId: source.mapping?.studentId ?? '', entryVersion: sourceVersion, selectionDirty: false }); setFocusRequest({ kind: 'mapping', key: key() }) }
  return <section className="students-source" ref={card} tabIndex={-1} aria-labelledby={`${id}-title ${id}-question`} aria-describedby={`${id}-state`}>
    <div className="students-record-heading"><h3 id={`${id}-title`}><span className="students-sr-only">수업 활동 {position} · </span>{source.current.alias} <small>원문 판 {source.current.revision}</small></h3><span id={`${id}-state`} className="students-badge">{labels[source.state]}</span></div>
    <p id={`${id}-context`} className="students-muted">{courseLabel} · 활동일 {source.current.occurredAt} · 질문 {source.current.questionVersion}</p><strong id={`${id}-question`}>{source.current.question}</strong><blockquote>{source.current.answer || '(빈 답변)'}</blockquote><p className="students-muted">원자료 ID: {source.id} / 외부 항목: {source.current.itemId}</p>
    {readError && <div className="students-error" role="alert"><p>{readError} 작성 중인 입력은 유지했습니다.</p><button type="button" className="secondary" onClick={() => { retry(value => value + 1); setFocusRequest({ kind: 'mapping', key: key() }) }}>활동 학생 다시 확인</button></div>}
    {sourceChanged && <p role="alert" className="students-warning">작성 중 원문 또는 학생 연결 판이 바뀌었습니다. 입력 내용은 보관했으며 채택은 중지했습니다. 활동 입력을 취소한 뒤 새 원문과 학생 연결을 다시 확인해 주세요.</p>}
    {enabled && <>
      <div className="students-map"><label>교사가 확인한 학생<select aria-label="교사가 확인한 학생" aria-describedby={`${id}-title ${id}-question ${id}-context`} disabled={draftChanged || Boolean(readError)} value={studentId} onChange={event => updateDraft({ studentId: event.target.value, entryVersion: sourceVersion, selectionDirty: event.target.value !== (source.mapping?.studentId ?? '') })}><option value="">별명만으로 자동 연결하지 않습니다</option>{students.map(student => <option value={student.id} key={student.id}>{student.number}번 · {student.name}</option>)}</select></label><button className="secondary" type="button" disabled={!selected || draftChanged || Boolean(readError)} onClick={() => run(() => {
        const mapped = store.confirmMapping(member.id, source.id, source.current.revision, selected!.id, selected!.enrollmentId, source.mappings.at(-1)?.revision ?? 0, key())
        updateDraft({ studentId: mapped.mapping?.studentId ?? '', entryVersion: `${mapped.current.revision}:${mapped.mapping?.revision ?? 0}`, selectionDirty: false }); setFocusRequest({ kind: 'entry', key: key() }); onNotice('학생 연결을 확인했습니다. 아직 관찰이나 평가 근거가 된 것은 아닙니다.')
      })}>학생 연결 확정</button>{!source.mapping && studentId && !draftChanged && <button type="button" className="text-button" onClick={cancelInput}>학생 선택 취소</button>}</div>
      {source.mapping && !mappingMatches && !readError && <p className="students-warning" role="status">선택한 학생과 확정된 연결이 다릅니다. ‘학생 연결 확정’을 눌러 연결을 다시 확인해야 관찰을 채택할 수 있습니다.</p>}
    </>}
    {(draftChanged || (source.state !== 'adopted' && enabled && source.mapping && mappingMatches && !readError)) && <ActivityObservationEntry contextLabel={`수업 활동 ${position} · ${source.current.alias} · ${source.current.occurredAt} 관찰 채택`} content={fact} confirmed={confirmed} sourceRevision={source.current.revision} target={{ student: selected ? `${selected.number}번 · ${selected.name}` : '작성 대상 학생 확인 필요', course: courseLabel, date: source.current.occurredAt, valid: enabled && mappingMatches && !sourceChanged && !readError }} onChange={(nextFact, nextConfirmed) => updateDraft({ studentId, fact: nextFact, confirmed: nextFact !== fact ? false : nextConfirmed, entryVersion: draftChanged ? entryVersion : sourceVersion })} onCancel={cancelInput} onSave={() => run(() => {
      if (!enabled || !mappingMatches || sourceChanged || readError) throw new Error('현재 원문과 확정된 학생 연결을 다시 확인해 주세요.')
      const record = store.adoptActivity(member.id, source.id, source.current.revision, source.mapping!.revision, fact, confirmed, key())
      updateDraft({ fact: '', confirmed: false, selectionDirty: false }); onSaved(record); onNotice(`${record.studentName} · ${record.current.observedAt} 수업 활동을 관찰 기록 v${record.current.version}로 채택했습니다.`)
    })} />}
    {enabled && <details className="students-source-tools"><summary>합성 원자료 정정·철회 시험</summary><p className="students-muted">채택 후 원문을 바꾸면 기존 관찰은 재검토 대상이 됩니다. 작성 중에는 입력을 먼저 저장하거나 취소해 주세요.</p><div className="button-row"><button type="button" className="secondary small" onClick={() => requestChange(() => run(() => { store.receiveActivity(member.id, { ...source.current, eventId: key(), revision: source.current.revision + 1, answer: `${source.current.answer}\n(합성 정정) 공유 전에 상대방의 공개 범위도 확인합니다.`, operation: 'upsert' }); onNotice('원문 새 판을 수신했습니다. 학생 연결과 채택 기록을 다시 확인하세요.') }))}>수정 답변 수신</button><button type="button" className="secondary small" onClick={() => requestChange(() => run(() => { store.receiveActivity(member.id, { ...source.current, eventId: key(), revision: source.current.revision + 1, operation: 'withdraw' }); onNotice('원자료 철회를 수신했습니다. 기존 근거는 재검토 대상입니다.') }))}>원자료 철회 수신</button></div></details>}
  </section>
}
