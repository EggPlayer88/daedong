import { useEffect, useId, useRef, useState } from 'react'
import { applySchoolBatch, previewSchoolBatch, readSchoolBatchFile, SCHOOL_BATCH_GROUPS, SCHOOL_BATCH_HEADERS, SCHOOL_BATCH_ROWS, schoolBatchBasis, schoolBatchWorkbook, type SchoolBatchGroup, type SchoolBatchInput, type SchoolBatchPreview, type SchoolBatchScope, type SchoolBatchValue } from './school-configuration-batch'
import styles from './school-configuration-batch.css?inline'

export interface SchoolConfigurationBatchPanelProps {
  value: SchoolBatchValue; scope: SchoolBatchScope; sourceVersion: number; expectedVersion: number; disabled: boolean
  input?: SchoolBatchInput; onInput: (input?: SchoolBatchInput) => void; onApply: (value: SchoolBatchValue) => void
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '파일을 읽지 못했습니다. 기존 입력은 유지했습니다.'
export function SchoolConfigurationBatchPanel(props: SchoolConfigurationBatchPanelProps) {
  const { value, scope, sourceVersion, expectedVersion, disabled, input, onInput, onApply } = props
  const id = useId(), [preview, setPreview] = useState<SchoolBatchPreview>(), [confirmed, setConfirmed] = useState(false)
  const [opened, setOpened] = useState(Boolean(input?.text))
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reading, setReading] = useState(false), [page, setPage] = useState(0)
  const generation = useRef(0), current = useRef(props); current.current = props
  const group = input?.group ?? 'classes', text = input?.text ?? '', basis = schoolBatchBasis(value, sourceVersion)
  const sourceChanged = sourceVersion !== expectedVersion, stale = Boolean(preview && preview.basis !== basis)
  useEffect(() => () => { generation.current++ }, [scope.schoolId, scope.schoolYear])
  const blocked = disabled || reading || sourceChanged
  function resetReview() { setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); setPage(0) }
  function changeText(next: string) { if (blocked) return; resetReview(); onInput({ group, text: next }) }
  async function load(file?: File) {
    if (!file || blocked) return
    const turn = ++generation.current, oldBasis = basis, oldInput = JSON.stringify(input), oldGroup = group, oldScope = JSON.stringify(scope)
    setReading(true); resetReview()
    try {
      const next = await readSchoolBatchFile(file, scope, group)
      if (turn !== generation.current) return
      const now = current.current
      if (now.disabled || now.sourceVersion !== now.expectedVersion || JSON.stringify(now.scope) !== oldScope || oldBasis !== schoolBatchBasis(now.value, now.sourceVersion) || JSON.stringify(now.input) !== oldInput || oldGroup !== (now.input?.group ?? 'classes')) {
        setError('파일을 읽는 동안 학교 자료나 입력이 바뀌었습니다. 이전 입력은 유지했으니 파일을 다시 선택해 주세요.')
        return
      }
      now.onInput({ group, text: next, fileName: file.name, fileScope: { ...scope } }); setNotice('파일을 읽었습니다. 현재 구성과 비교해 주세요.')
    } catch (failure) { if (turn === generation.current) setError(`${errorMessage(failure)} 이전 입력은 유지했습니다.`) }
    finally { if (turn === generation.current) setReading(false) }
  }
  function compare() {
    if (blocked) return
    try {
      if (input?.fileScope && JSON.stringify(input.fileScope) !== JSON.stringify(scope)) throw new Error('파일을 읽은 학교·학년도와 현재 대상이 다릅니다. 현재 대상의 파일을 다시 선택해 주세요.')
      setPreview(previewSchoolBatch({ group, text }, value, sourceVersion)); setConfirmed(false); setError(''); setNotice(''); setPage(0)
    }
    catch (failure) { setPreview(undefined); setConfirmed(false); setError(errorMessage(failure)) }
  }
  function apply() {
    if (blocked || stale || !preview || !confirmed || error) return
    try { onApply(applySchoolBatch(preview, value, sourceVersion)); resetReview(); setNotice('구성 초안에 합쳤습니다. 아래에서 변경 사유와 전체 내용을 검토한 뒤 저장해 주세요.') }
    catch (failure) { setError(errorMessage(failure)); setConfirmed(false) }
  }
  function download(existing: boolean) {
    try {
      const data = new Uint8Array(schoolBatchWorkbook(scope, value, group, existing)).buffer
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${scope.schoolYear}_${SCHOOL_BATCH_GROUPS[group]}_${existing ? '현재자료' : '빈양식'}.xlsx`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError('')
    } catch (failure) { setError(errorMessage(failure)) }
  }
  const shown = preview?.rows.slice(page * 20, (page + 1) * 20) ?? []
  return <details className="school-batch" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <style>{styles}</style><summary>학급·교과·부서 한꺼번에 입력</summary>
    <div className="school-batch-content">
      <p><strong>{value.configuration.schoolName} · {scope.schoolYear || '입력 중'}학년도</strong>의 구성 초안에 합칩니다. 파일에 없는 기존 항목은 유지합니다.</p>
      <label htmlFor={`${id}-group`}>입력 종류 <select id={`${id}-group`} aria-label="일괄 입력 종류" value={group} disabled={disabled || reading || Boolean(text)} onChange={event => { resetReview(); onInput({ group: event.target.value as SchoolBatchGroup, text: '' }) }}>{Object.entries(SCHOOL_BATCH_GROUPS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="school-admin-actions"><button type="button" className="setup-button" disabled={blocked} onClick={() => download(false)}>빈 엑셀 양식</button><button type="button" className="setup-button" disabled={blocked} onClick={() => download(true)}>현재 자료 엑셀</button></div>
      <label htmlFor={`${id}-file`}>XLSX·CSV 파일 <input id={`${id}-file`} aria-label="학교 구성 일괄 파일" type="file" accept=".xlsx,.csv" disabled={blocked} onChange={event => { void load(event.target.files?.[0]); event.target.value = '' }}/></label>
      {reading && <div role="status">파일을 읽는 중입니다. <button type="button" className="setup-button" onClick={() => { generation.current++; setReading(false); setError('읽기를 취소했습니다. 이전 입력은 유지했습니다.') }}>파일 읽기 취소</button></div>}
      <label htmlFor={`${id}-text`}>표 붙여넣기 또는 CSV <textarea id={`${id}-text`} aria-label="학교 구성 일괄 입력" rows={5} disabled={blocked} value={text} onChange={event => changeText(event.target.value)} placeholder={SCHOOL_BATCH_HEADERS[group].join('\t')}/></label>
      <p className="setup-file-help">첫 행: {SCHOOL_BATCH_HEADERS[group].join(' · ')}. {SCHOOL_BATCH_ROWS}행까지 입력합니다. 새 항목의 식별자는 비우고, 기존 항목 수정은 현재 자료의 식별자를 유지해 주세요.{group === 'classes' && ' 유형은 regular(일반), special(특수), multigrade(복식), other(기타)입니다.'}</p>
      {input?.fileName && <p>읽은 파일: {input.fileName}</p>}
      {sourceChanged && <p role="alert">서버의 학교 자료가 바뀌었습니다. 일괄 입력은 보존했습니다. 아래의 ‘변경 내용 검토’에서 최신 자료와 비교한 뒤 여기서 다시 비교해 주세요.</p>}
      {stale && !sourceChanged && <p role="alert">비교한 뒤 구성 초안이 바뀌었습니다. 일괄 입력을 유지하고 다시 비교해 주세요.</p>}
      {error && <p className="setup-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div className="school-admin-actions"><button type="button" className="setup-button" disabled={blocked || !text.trim()} onClick={compare}>현재 구성과 비교</button><button type="button" className="setup-button" disabled={disabled || reading || !text} onClick={() => { resetReview(); onInput(undefined) }}>일괄 입력 비우기</button></div>
      {preview && <section aria-label="일괄 입력 비교"><h4>추가 {preview.rows.filter(row => row.state === 'add').length}개 · 수정 {preview.rows.filter(row => row.state === 'change').length}개 · 일치 {preview.rows.filter(row => row.state === 'same').length}개</h4><p>입력에 없는 기존 {preview.kept}개는 유지합니다. 이 단계에서는 서버에 저장하지 않습니다.</p>
        <div className="school-batch-table"><table><thead><tr><th>행</th><th>판정</th><th>현재</th><th>반영할 값</th></tr></thead><tbody>{shown.map(row => <tr key={row.id}><td>{row.line}</td><td>{{ add: '추가', change: '수정', same: '일치' }[row.state]}</td><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody></table></div>
        {preview.rows.length > 20 && <div className="school-admin-actions"><button type="button" className="setup-button" disabled={page === 0 || blocked} onClick={() => setPage(page - 1)}>이전 비교</button><span>{page + 1} / {Math.ceil(preview.rows.length / 20)}</span><button type="button" className="setup-button" disabled={(page + 1) * 20 >= preview.rows.length || blocked} onClick={() => setPage(page + 1)}>다음 비교</button></div>}
        <label><input type="checkbox" checked={confirmed && !stale} disabled={blocked || stale || Boolean(error)} onChange={event => setConfirmed(event.target.checked)}/> 기존 항목을 유지하고 추가·수정할 내용을 확인했습니다.</label>
        <button type="button" className="setup-primary" disabled={blocked || stale || !confirmed || Boolean(error)} onClick={apply}>구성 초안에 반영</button>
      </section>}
    </div>
  </details>
}
