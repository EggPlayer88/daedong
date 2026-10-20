import { useEffect, useId, useRef, useState } from 'react'
import type { TeachingImportPanelProps } from './ImportPanel'
import { assertRosterImportReady, compareRosterImport, readRosterFile, rosterReviewBasis, rosterWorkbook } from './roster-import'
import { safeCsv } from './csv'
import policy from './policy.json'
import workbookLimits from '../timetable/workbook-limits.json'
import styles from './roster-import.css?inline'

function download(name: string, bytes: Uint8Array | string, type: string) {
  const contents = typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer
  const url = URL.createObjectURL(new Blob([contents], { type })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : '파일을 읽지 못했습니다. 이전 입력은 유지했습니다.'
export function RosterImportPanel(props: TeachingImportPanelProps) {
  const { draft, course, disabled, onChange, onSave, onCancel, saveLabel = '확인한 자료 저장' } = props
  const id = useId(), [reading, setReading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(0), generation = useRef(0), current = useRef(props)
  current.current = props
  const basis = rosterReviewBasis(course), scope = JSON.stringify([course.schoolId, course.memberId, course.ownerUserId, course.course.id])
  useEffect(() => () => { generation.current++ }, [scope])
  const stale = draft.expectedVersion !== course.course.version || Boolean(draft.roster.length && draft.rosterBasis !== basis)
  let comparison: ReturnType<typeof compareRosterImport> | undefined, comparisonError = ''
  try { comparison = compareRosterImport(draft.roster, course, draft.validFrom, draft.validThrough) } catch (failure) { comparisonError = message(failure) }
  const blocked = disabled || reading || stale || Boolean(error || comparisonError || comparison?.periodError || comparison?.corrections) || !course.course.canManageRoster
  const rows = comparison?.rows.filter(row => filter === 'all' || row.state === filter) ?? []
  const pages = Math.max(1, Math.ceil(rows.length / 20)), shownPage = Math.min(page, pages - 1)
  function revise(change: Partial<typeof draft>) { onChange({ ...draft, ...change, confirmed: false }); setNotice('') }
  async function load(file?: File) {
    if (!file || disabled || reading) return
    const turn = ++generation.current, original = rosterReviewBasis(course)
    setReading(true); setError(''); setNotice(''); onChange({ ...draft, confirmed: false })
    try {
      const next = await readRosterFile(file, course)
      if (turn !== generation.current) return
      const latest = current.current
      if (latest.disabled || original !== rosterReviewBasis(latest.course)) {
        setError('파일을 읽는 동안 수업 또는 명부가 바뀌었습니다. 이전 입력은 유지했습니다. 최신 자료를 확인한 뒤 파일을 다시 선택해 주세요.')
        return
      }
      latest.onChange({ ...latest.draft, ...next, rosterBasis: original, expectedVersion: latest.course.course.version, confirmed: false })
      setPage(0); setFilter('all'); setNotice('파일을 읽었습니다. 현재 수업 명부와 비교한 뒤 저장해 주세요.')
    } catch (failure) { if (turn === generation.current) setError(`${message(failure)} 이전에 읽은 입력은 유지했습니다.`) }
    finally { if (turn === generation.current) setReading(false) }
  }
  function cancelRead() { generation.current++; setReading(false); setError('파일 읽기를 취소했습니다. 이전 입력은 유지했습니다.'); setNotice('') }
  function adopt() {
    if (disabled || reading) return
    onChange({ ...draft, expectedVersion: course.course.version, rosterBasis: basis, confirmed: false })
    setError(''); setNotice('입력을 유지하고 현재 수업 명부로 다시 비교했습니다. 차이와 기간을 다시 확인해 주세요.')
  }
  function save() {
    if (blocked || !draft.confirmed) return
    try { assertRosterImportReady(draft, course); onSave() } catch (failure) { setError(message(failure)) }
  }
  function workbook(existing: boolean) {
    try {
      download(existing ? '현재수강명부_입력양식.xlsx' : '수강명부_입력양식.xlsx', rosterWorkbook(course, existing), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (failure) { setError(message(failure)) }
  }
  return <section className="teaching-card teaching-roster-import" aria-labelledby={`${id}-heading`}>
    <style>{styles}</style>
    <header><h3 id={`${id}-heading`}>수강 명부 가져오기</h3><p>{course.course.label} · 수업 기간 {course.course.validFrom} ~ {course.course.validThrough}</p></header>
    <p>학교내학생번호로 현재 수업 명부만 대조합니다. 이름만으로 합치거나 기존 학생 정보를 자동으로 바꾸지 않습니다.</p>
    <div className="teaching-actions"><button type="button" className="secondary" disabled={disabled || reading} onClick={() => workbook(false)}>빈 명부 엑셀 양식</button>
      <button type="button" className="secondary" disabled={disabled || reading || !course.students.length} onClick={() => workbook(true)}>현재 명부를 엑셀로 받기</button>
      <details><summary>CSV 양식</summary><button type="button" className="secondary" disabled={disabled || reading} onClick={() => download('수강명부_입력양식.csv', safeCsv(policy.rosterHeaders, []), 'text/csv;charset=utf-8')}>빈 명부 양식 내려받기</button></details></div>
    {error && <p role="alert" className="teaching-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {reading && <div role="status"><p>명부 파일을 확인하고 있습니다. 저장은 아직 하지 않습니다.</p><button type="button" className="secondary" onClick={cancelRead}>파일 읽기 취소</button></div>}
    {stale && <div role="alert" className="teaching-roster-review-warning"><strong>현재 수업 명부가 바뀌었습니다.</strong><p>파일과 입력을 보관했습니다. 최신 명부와 다시 비교한 뒤 확인해야 저장할 수 있습니다.</p>
      <button type="button" disabled={disabled || reading} onClick={adopt}>입력 유지하고 최신 명부와 비교</button></div>}
    {error && draft.roster.length > 0 && !stale && <button type="button" className="secondary" disabled={disabled || reading} onClick={adopt}>보관한 이전 파일 다시 비교</button>}
    <fieldset disabled={disabled || reading}><legend>파일과 수강 기간</legend>
      <label htmlFor={`${id}-file`}>명부 파일(XLSX·CSV)<input id={`${id}-file`} aria-label="CSV 파일" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void load(file) }} /></label>
      <p>XLSX {workbookLimits.fileBytes / 1048576} MiB · UTF-8 CSV {policy.limits.csvBytes / 1048576} MiB · {policy.limits.csvRows}행까지. XLSX는 이 수업에서 받은 양식을 사용하세요.</p>
      {draft.file && <p className="teaching-roster-file">읽은 파일: <strong>{draft.file.name}</strong> · {draft.file.format.toUpperCase()} · {draft.roster.length}행</p>}
      <div className="teaching-grid"><label>수강 시작일<input type="date" required value={draft.validFrom} onChange={event => revise({ validFrom: event.target.value })} /></label>
        <label>수강 종료일<input type="date" required value={draft.validThrough} onChange={event => revise({ validThrough: event.target.value })} /></label></div>
    </fieldset>
    {(comparisonError || comparison?.periodError) && <p role="alert" className="teaching-error">{comparisonError || comparison?.periodError}</p>}
    {comparison && draft.roster.length > 0 && <>
      <div className="teaching-roster-counts" role="status"><span>새 연결 후보 {comparison.added}명</span><span>현재 명부와 일치 {comparison.matched}명</span><span>정정 필요 {comparison.corrections}명</span><span>파일에 없는 기존 학생 {comparison.kept}명 유지</span></div>
      <p className="teaching-roster-scope">새 연결 후보가 학교 전체의 새 학생이라는 뜻은 아닙니다. 다른 수업의 학생번호·학적과 실제 저장 가능 여부는 서버가 다시 확인합니다.</p>
      {comparison.corrections > 0 && <p role="alert" className="teaching-error">정정 필요 행이 있어 저장을 막았습니다. 기존 학생 정보는 학교 자료 정정·보관에서, 수강 기간은 담당·수강 관계 관리에서 먼저 확인하거나 파일을 고쳐 주세요.</p>}
      <label>비교 행 보기<select aria-label="명부 비교 상태" value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">전체</option><option value="new">새 연결 후보</option><option value="matched">현재 명부와 일치</option><option value="correction">정정 필요</option></select></label>
      <div className="teaching-table-wrap" tabIndex={0} role="region" aria-label="명부 비교 표"><table><caption>저장 전 수강 명부 확인 · {rows.length}행</caption><thead><tr>{[...policy.rosterHeaders, '비교 결과'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.slice(shownPage * 20, (shownPage + 1) * 20).map(item => <tr key={item.row.schoolStudentKey}><td>{item.row.schoolStudentKey}</td><td>{item.row.name}</td><td>{item.row.grade}</td><td>{item.row.classLabel}</td><td>{item.row.seatNumber}</td><td><strong>{({ new: '새 연결 후보', matched: '현재 명부와 일치', correction: '정정 필요' })[item.state]}</strong>{item.differences.length > 0 && <ul>{item.differences.map(difference => <li key={difference}>{difference}</li>)}</ul>}</td></tr>)}</tbody></table></div>
      {pages > 1 && <nav className="teaching-actions" aria-label="가져올 자료 페이지"><button type="button" className="secondary" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>이전 20행</button><span>{shownPage + 1} / {pages}</span><button type="button" className="secondary" disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>다음 20행</button></nav>}
      <label className="teaching-check"><input type="checkbox" checked={draft.confirmed && !blocked} disabled={blocked} onChange={event => {
        if (event.target.checked) { try { assertRosterImportReady(draft, course) } catch (failure) { setError(message(failure)); return } }
        onChange({ ...draft, confirmed: event.target.checked })
      }} />명부 차이와 수강 기간을 확인했으며 기존 학생과 기록을 유지합니다.</label>
    </>}
    <div className="teaching-actions"><button type="button" disabled={blocked || !draft.confirmed || !draft.roster.length} onClick={save}>{saveLabel}</button><button type="button" className="secondary" disabled={disabled || reading} onClick={onCancel}>가져오기 취소</button></div>
  </section>
}
