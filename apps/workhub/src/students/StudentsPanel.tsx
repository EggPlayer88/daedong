import { useId, useState } from 'react'
import type { Membership } from '../contracts'
import type { ObservationDraft, ObservationView, SourceView } from './contracts'
import type { StudentStore } from './store'
import './students.css'

export interface StudentsPanelProps { member: Membership; members: Membership[]; date: string; store: StudentStore }
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
  const [tab, setTab] = useState<'records' | 'activities'>('records')
  const [courseId, setCourseId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [observedAt, setObservedAt] = useState(date)
  const [activity, setActivity] = useState('')
  const [content, setContent] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<ObservationView>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [exportText, setExportText] = useState('')
  const [, repaint] = useState(0)
  const refresh = () => { setExportText(''); repaint(value => value + 1) }
  let courses: ReturnType<StudentStore['listCourses']> = []
  let records: ObservationView[] = []
  let activities: SourceView[] = []
  let accessError = ''
  try { courses = store.listCourses(member.id, observedAt); records = store.listRecords(member.id); activities = store.listActivities(member.id) }
  catch (failure) { accessError = messageOf(failure) }
  const selectedCourse = courses.find(course => course.id === courseId) ?? courses[0]
  let students: ReturnType<StudentStore['listStudents']> = []
  if (selectedCourse && !accessError) {
    try { students = store.listStudents(member.id, selectedCourse.id, observedAt) } catch (failure) { accessError = messageOf(failure) }
  }
  const selectedStudent = students.find(student => student.id === studentId) ?? students[0]
  function run(action: () => void) { setError(''); setNotice(''); try { action(); refresh() } catch (failure) { setError(messageOf(failure)) } }
  function clearForm() { setActivity(''); setContent(''); setConfirmed(false); setReason(''); setEditing(undefined) }
  function save() {
    if (!selectedCourse || !selectedStudent) { setError('해당 날짜의 승인된 수업과 학생을 선택해 주세요.'); return }
    const draft: ObservationDraft = { courseId: selectedCourse.id, studentId: selectedStudent.id, enrollmentId: selectedStudent.enrollmentId, observedAt, activity, content, confirmed }
    run(() => {
      const saved = editing ? store.reviseObservation(member.id, editing.id, editing.current.version, draft, reason, key()) : store.createObservation(member.id, draft, key())
      clearForm(); setNotice(`관찰 기록 v${saved.current.version} 저장 완료. 이전 개정본은 보존됩니다.`)
    })
  }
  function edit(record: ObservationView) {
    setTab('records'); setEditing(record); setCourseId(record.current.courseId); setStudentId(record.current.studentId); setObservedAt(record.current.observedAt); setActivity(record.current.activity); setContent(record.current.content); setReason(''); setConfirmed(false); setError(''); setNotice('기존 기록의 새 개정본을 작성합니다. 정정 사유와 사실 확인이 필요합니다.')
  }
  function sample() {
    if (!selectedCourse) { setError('승인된 수업을 먼저 선택해 주세요.'); return }
    run(() => {
      const source = store.receiveActivity(member.id, { eventId: `sample-${selectedCourse.id}-1`, sourceSystem: 'synthetic-digital-ethics', activityId: `sample-${date}`, itemId: 'answer-a', revision: 1, operation: 'upsert', courseId: selectedCourse.id, occurredAt: date, questionVersion: 'demo-question-v1', question: '온라인에서 다른 사람의 자료를 공유할 때 무엇을 확인할까요?', answer: '작성자의 허락과 출처 표시 여부를 확인해야 한다고 생각합니다.', alias: '가상 별명 A' })
      setNotice(`가상 활동 수신 완료 · ${labels[source.state]}. 이름을 추측해 연결하지 않았습니다.`); setTab('activities')
    })
  }
  return <section className="students-panel" aria-labelledby={`${formId}-title`}>
    <header className="students-header"><div><p className="eyebrow">나의 수업 · 작성자 전용 기록</p><h1 id={`${formId}-title`}>학생과 수업 기록</h1><p>확인한 사실을 차곡차곡 남기고, 나중에 근거를 다시 찾습니다.</p></div><span className="students-badge">합성 자료 전용</span></header>
    <div className="students-boundary">로컬 개발 미리보기입니다. 실제 학생 정보를 입력하지 마세요. 관리자도 다른 작성자의 본문·건수·근거 목록을 볼 수 없도록 계약을 시험합니다.</div>
    {accessError ? <div role="alert" className="students-error">{accessError}</div> : <>
      <div className="students-tabs" aria-label="학생 업무 선택"><button type="button" aria-pressed={tab === 'records'} onClick={() => setTab('records')}>내 학급·기록</button><button type="button" aria-pressed={tab === 'activities'} onClick={() => setTab('activities')}>수업 활동 받은함 <span>{activities.length}</span></button></div>
      {error && <p role="alert" className="students-error">{error} 입력한 내용은 유지했습니다.</p>}
      {notice && <p role="status" className="students-notice">{notice}</p>}
      <div className="students-context"><label>수업 기준일<input type="date" value={observedAt} max={date} onChange={event => { if (event.target.value) { setObservedAt(event.target.value); setStudentId('') } }} /></label><label>승인된 내 수업<select value={selectedCourse?.id ?? ''} onChange={event => { setCourseId(event.target.value); setStudentId(''); if (editing) clearForm() }}><option value="" disabled>수업 선택</option>{courses.map(course => <option key={course.id} value={course.id}>{course.classLabel} · {course.label}</option>)}</select></label><button type="button" className="secondary" onClick={sample} disabled={!selectedCourse}>가상 수업 활동 받기</button></div>
      {!courses.length && <p className="students-empty">이 날짜에 승인된 수업 배정이 없습니다. 교사 본인 신고나 시간표 표시만으로 명부 권한이 생기지 않습니다.</p>}
      {tab === 'records' ? <>
        <div className="students-layout"><article className="students-card"><h2>내 학급 명부</h2><p className="students-muted">이름·번호는 표시 정보입니다. 학생 ID는 학년·반이 바뀌어도 유지합니다.</p><div className="students-roster">{students.map(student => <button type="button" key={student.id} aria-pressed={student.id === selectedStudent?.id} onClick={() => setStudentId(student.id)}><span>{student.number}번 · {student.name}</span><small>{student.id}</small></button>)}</div>{selectedStudent && <p className="students-muted">학적 기간: {selectedStudent.enrollmentFrom}부터 {selectedStudent.enrollmentUntil} 전까지</p>}</article>
        <article className="students-card"><h2>{editing ? `관찰 기록 정정 · v${editing.current.version} 기준` : '빠른 관찰 기록'}</h2><p className="students-muted">{selectedStudent?.name ?? '학생 선택 필요'} · 개인의 수행과 태도는 학생별로 확인합니다.</p><form onSubmit={event => { event.preventDefault(); save() }} className="students-form"><label>활동<input name="student-activity" value={activity} maxLength={150} onChange={event => setActivity(event.target.value)} placeholder="예: 자료 공유 토의" required /></label><label>직접 확인한 사실<textarea aria-label="직접 확인한 사실" name="student-observation" rows={4} value={content} maxLength={4000} onChange={event => setContent(event.target.value)} placeholder="학생이 실제로 말하거나 수행한 내용을 적어 주세요." required /></label>{editing && <label>정정 사유<input name="student-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={300} required /></label>}<label className="students-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.</label><div className="button-row"><button className="primary" type="submit" disabled={!selectedStudent || !confirmed}>{editing ? '새 개정본 저장' : '관찰 저장'}</button>{editing && <button className="secondary" type="button" onClick={clearForm}>정정 취소</button>}</div></form></article></div>
        <article className="students-card students-records"><div className="students-record-heading"><div><h2>내 관찰 기록 <span>{records.filter(record => record.current.state === 'active').length}건</span></h2><p className="students-muted">철회·정정 이력은 남으며 다른 교사의 기록은 집계하지 않습니다.</p></div><button className="secondary" type="button" onClick={() => { setError(''); try { setExportText(store.exportEvidence(member.id)) } catch (failure) { setError(messageOf(failure)); setExportText('') } }}>근거 목록 텍스트 보기</button></div>{!records.length && <p className="students-empty">아직 본인이 작성한 관찰 기록이 없습니다.</p>}{records.map(record => <RecordCard key={record.id} record={record} onEdit={() => edit(record)} onWithdraw={why => run(() => { store.withdrawObservation(member.id, record.id, record.current.version, why, key()); setNotice('철회 이력을 남겼습니다. 유효 근거 목록에서 제외됩니다.') })} />)}{exportText && <div className="students-export"><label>나의 근거 목록 · AI 생기부 초안 아님<textarea aria-label="나의 근거 목록" readOnly rows={9} value={exportText} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="secondary" onClick={() => { const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `합성_관찰근거_${date}.txt`; anchor.click(); URL.revokeObjectURL(url) }}>텍스트 파일 내려받기</button><p className="students-muted">이미 내려받은 파일은 자동 회수되지 않습니다. 원기록이 바뀌면 다시 확인하세요.</p></div>}</article>
      </> : <article className="students-card"><h2>수업 활동 받은함</h2><p className="students-muted">가상 외부 사건을 수신해 검토하는 흐름입니다. 실제 디지털윤리 사이트에 연결하지 않으며 현재 사이트 CSV를 읽는 파서는 아직 없습니다.</p>{!activities.length && <p className="students-empty">위의 ‘가상 수업 활동 받기’로 수신→학생 확인→관찰 채택을 시험해 보세요.</p>}{activities.map(source => <ActivityCard key={`${source.id}:${source.current.revision}:${source.mapping?.revision ?? 0}`} source={source} member={member} store={store} run={run} onNotice={setNotice} />)}</article>}
    </>}
  </section>
}

function RecordCard({ record, onEdit, onWithdraw }: { record: ObservationView; onEdit: () => void; onWithdraw: (reason: string) => void }) {
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')
  return <section className="students-record"><div className="students-record-heading"><h3>{record.studentName} <small>{record.current.observedAt} · v{record.current.version}</small></h3><span className={`students-badge ${record.needsReview ? 'warning' : ''}`}>{record.current.state === 'withdrawn' ? '철회됨' : record.needsReview ? '원자료 재검토 필요' : '본인 확인 기록'}</span></div><strong>{record.current.activity}</strong><p className="students-content">{record.current.content}</p>{record.current.source && <p className="students-muted">출처 {record.current.source.sourceId} · 원자료 판 {record.current.source.sourceRevision} · 연결 판 {record.current.source.mappingRevision}</p>}{record.needsReview && record.current.state === 'active' && <p className="students-warning">원자료가 바뀌었습니다. 근거 내보내기를 중지했습니다. 이 기록을 철회하고 받은함에서 새 원문을 확인한 뒤 다시 채택하세요.</p>}<details><summary>불변 개정 이력 {record.revisions.length}개</summary><ol className="students-history">{record.revisions.map(revision => <li key={revision.version}><strong>v{revision.version} · {revision.state === 'withdrawn' ? '철회' : '작성/정정'}</strong><span>{revision.reason}</span><p>{revision.content}</p></li>)}</ol></details>{record.current.state === 'active' && <div className="button-row"><button type="button" className="secondary small" onClick={onEdit} disabled={record.needsReview}>정정하기</button><button type="button" className="secondary small" onClick={() => setWithdrawing(value => !value)}>철회하기</button></div>}{withdrawing && record.current.state === 'active' && <form className="students-withdraw" onSubmit={event => { event.preventDefault(); onWithdraw(reason) }}><label>철회 사유<input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} required /></label><button type="submit" className="secondary">사유와 함께 철회</button></form>}</section>
}

function ActivityCard({ source, member, store, run, onNotice }: { source: SourceView; member: Membership; store: StudentStore; run: (action: () => void) => void; onNotice: (message: string) => void }) {
  const [studentId, setStudentId] = useState(source.mapping?.studentId ?? '')
  const [fact, setFact] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  let students: ReturnType<StudentStore['listStudents']> = []
  try { students = store.listStudents(member.id, source.current.courseId, source.current.occurredAt) } catch { /* 종료되거나 확인되지 않은 담당 관계는 연결 후보를 제공하지 않는다. */ }
  const selected = students.find(student => student.id === studentId)
  const enabled = source.current.operation === 'upsert'
  return <section className="students-source"><div className="students-record-heading"><h3>{source.current.alias} <small>원문 판 {source.current.revision}</small></h3><span className="students-badge">{labels[source.state]}</span></div><p className="students-muted">활동일 {source.current.occurredAt} · 질문 {source.current.questionVersion}</p><strong>{source.current.question}</strong><blockquote>{source.current.answer || '(빈 답변)'}</blockquote><p className="students-muted">원자료 ID: {source.id} / 외부 항목: {source.current.itemId}</p>{enabled && <><div className="students-map"><label>교사가 확인한 학생<select value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">별명만으로 자동 연결하지 않습니다</option>{students.map(student => <option value={student.id} key={student.id}>{student.number}번 · {student.name}</option>)}</select></label><button className="secondary" type="button" disabled={!selected} onClick={() => run(() => { store.confirmMapping(member.id, source.id, source.current.revision, selected!.id, selected!.enrollmentId, source.mappings.at(-1)?.revision ?? 0, key()); onNotice('학생 연결을 확인했습니다. 아직 관찰이나 평가 근거가 된 것은 아닙니다.') })}>학생 연결 확정</button></div>{source.mapping && source.state !== 'adopted' && <form className="students-form" onSubmit={event => { event.preventDefault(); run(() => { store.adoptActivity(member.id, source.id, source.current.revision, source.mapping!.revision, fact, confirmed, key()); onNotice('직접 확인한 내용을 본인 관찰 기록으로 채택했습니다.') }) }}><label>교사가 확인한 관찰 사실<textarea aria-label="교사가 확인한 관찰 사실" rows={3} value={fact} onChange={event => setFact(event.target.value)} maxLength={4000} required placeholder="답변을 그대로 성취·인성으로 추정하지 않고 확인한 사실을 적습니다." /></label><label className="students-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />원문·질문·학생 연결을 직접 검토했습니다.</label><button className="primary" type="submit" disabled={!confirmed}>내 관찰로 채택</button></form>}<details className="students-source-tools"><summary>합성 원자료 정정·철회 시험</summary><p className="students-muted">채택 후 원문을 바꾸면 기존 관찰은 재검토 대상이 됩니다.</p><div className="button-row"><button type="button" className="secondary small" onClick={() => run(() => { store.receiveActivity(member.id, { ...source.current, eventId: key(), revision: source.current.revision + 1, answer: `${source.current.answer}\n(합성 정정) 공유 전에 상대방의 공개 범위도 확인합니다.`, operation: 'upsert' }); onNotice('원문 새 판을 수신했습니다. 학생 연결과 채택 기록을 다시 확인하세요.') })}>수정 답변 수신</button><button type="button" className="secondary small" onClick={() => run(() => { store.receiveActivity(member.id, { ...source.current, eventId: key(), revision: source.current.revision + 1, operation: 'withdraw' }); onNotice('원자료 철회를 수신했습니다. 기존 근거는 재검토 대상입니다.') })}>원자료 철회 수신</button></div></details></>}</section>
}
