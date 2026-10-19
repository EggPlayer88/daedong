import { useEffect, useId, useRef, useState } from 'react'
import type { TimetableBasis, Placement } from '../../../../packages/timetable/src/types'
import type { TimetableConditions } from './contracts'
import { canonical } from '../services/scoped-rpc'
import { requestBlobDownload } from '../files/download'
import { readTimetableXlsx, writeTimetableXlsx, TimetableWorkbookError } from './xlsx'
import { previewTimetableWorkbook, timetablePrintSheets, timetableWorkbookSheets, type TimetableWorkbookDraft, type TimetableWorkbookPreview } from './workbook'
import limits from './workbook-limits.json'

interface Props extends TimetableWorkbookDraft {
  basis: TimetableBasis; conditions: TimetableConditions; placements: Placement[]
  disabled: boolean; onImport: (draft: TimetableWorkbookDraft) => void
}
export function TimetableWorkbookPanel(props: Props) {
  const id = useId(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<{ fingerprint: string; value: TimetableWorkbookPreview }>(), [confirmed, setConfirmed] = useState(false)
  const input = useRef<HTMLInputElement>(null), life = useRef(0), operation = useRef(false), latest = useRef(props)
  latest.current = props
  const fingerprint = canonical([props.basis, props.title, props.conditions, props.placements])
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { setPreview(undefined); setConfirmed(false) }, [fingerprint, props.disabled])
  const draft = (): TimetableWorkbookDraft => ({ title: latest.current.title, conditions: latest.current.conditions, placements: latest.current.placements })
  async function load(file: File | undefined) {
    if (!file || latest.current.disabled || operation.current) return
    setPreview(undefined); setConfirmed(false)
    if (!/\.xlsx$/i.test(file.name) || file.size > limits.fileBytes) { setError('8 MiB 이하의 편집용 XLSX 양식을 선택해 주세요.'); return }
    const epoch = life.current, original = fingerprint
    operation.current = true; setBusy(true); setError(''); setNotice(''); setPreview(undefined); setConfirmed(false)
    try {
      const sheets = readTimetableXlsx(new Uint8Array(await file.arrayBuffer()))
      if (epoch !== life.current) return
      if (latest.current.disabled || canonical([latest.current.basis, latest.current.title, latest.current.conditions, latest.current.placements]) !== original) { setError('파일을 읽는 동안 기준이나 작업 내용이 바뀌었습니다. 현재 파일을 다시 선택해 주세요.'); return }
      setPreview({ fingerprint: original, value: previewTimetableWorkbook(sheets, latest.current.basis, draft()) })
    } catch (failure) { if (epoch === life.current) setError(failure instanceof TimetableWorkbookError ? failure.message : '엑셀 파일을 확인하지 못했습니다. 기존 작업은 유지됩니다.') }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false); if (input.current) input.current.value = '' } }
  }
  function download(kind: 'edit' | 'print') {
    if (latest.current.disabled || operation.current) return
    try {
      const sheets = kind === 'edit' ? timetableWorkbookSheets(latest.current.basis, draft()) : timetablePrintSheets(latest.current.basis, draft())
      const bytes = writeTimetableXlsx(sheets)
      requestBlobDownload(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${latest.current.title}_${kind === 'edit' ? '편집용' : '출력용'}.xlsx`)
      setError(''); setNotice('엑셀 내려받기를 요청했습니다. 파일에는 현재 작업 초안이 담깁니다.')
    } catch (failure) { setError(failure instanceof TimetableWorkbookError ? failure.message : '내려받기를 시작하지 못했습니다. 현재 작업은 유지됩니다.') }
  }
  function apply() {
    if (!preview || !confirmed || props.disabled || busy || preview.value.unchanged || preview.fingerprint !== fingerprint) return
    props.onImport({ title: preview.value.title, conditions: structuredClone(preview.value.conditions), placements: structuredClone(preview.value.placements) })
    setPreview(undefined); setConfirmed(false); setNotice('확인한 내용을 작업 초안에 반영했습니다. 학교 서버 저장과 시간표 확정은 별도로 진행해 주세요.')
  }
  return <details className="timetable-card"><summary>엑셀로 내려받기·작업 이어가기</summary>
    <p>편집용 파일에서 조건과 배치를 수정한 뒤 다시 가져올 수 있습니다. 현재 탭을 닫기 전에 미완성 작업도 파일로 보관할 수 있습니다.</p>
    <div className="timetable-actions"><button type="button" className="secondary" disabled={props.disabled || busy} onClick={() => download('edit')}>편집용 엑셀 내려받기</button><button type="button" className="secondary" disabled={props.disabled || busy} onClick={() => download('print')}>출력용 엑셀 내려받기</button></div>
    <label htmlFor={`${id}-file`}>편집용 엑셀 가져오기</label><input ref={input} id={`${id}-file`} type="file" accept=".xlsx" disabled={props.disabled || busy} onChange={event => void load(event.target.files?.[0])} />
    <p className="timetable-muted">8 MiB 이하 · 매크로·수식·병합 셀 제외 · 공식 교사 배정과 시수는 학교 기준자료에서 수정합니다.</p>
    {busy && <p role="status">엑셀의 기준판과 변경 내용을 확인하고 있습니다…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && preview.fingerprint === fingerprint && <section aria-label="엑셀 변경 미리보기"><h3>가져오기 전 확인</h3><dl className="timetable-summary"><div><dt>배치 변경</dt><dd>{preview.value.changedLessons}개</dd></div><div><dt>조건 추가 / 삭제</dt><dd>{preview.value.addedConditions} / {preview.value.removedConditions}</dd></div><div><dt>미배정</dt><dd>{preview.value.unassigned}개</dd></div></dl>
      {preview.value.unchanged ? <p>현재 작업과 같습니다. 다시 반영할 내용이 없습니다.</p> : <><p>{preview.value.complete ? '전체 필수조건 검사를 통과한 배치입니다.' : '미완성 작업입니다. 초안으로 이어갈 수 있지만 문제를 해결하기 전에는 확정할 수 없습니다.'}</p>{preview.value.issues.length > 0 && <ul>{preview.value.issues.slice(0, 10).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}<label><input type="checkbox" checked={confirmed} disabled={props.disabled || busy} onChange={event => setConfirmed(event.target.checked)} />조건 삭제와 배치 변경을 확인했으며 현재 작업 초안에 반영합니다</label><button type="button" disabled={!confirmed || props.disabled || busy} onClick={apply}>확인한 초안 가져오기</button></>}
      <button type="button" className="secondary" disabled={busy} onClick={() => { setPreview(undefined); setConfirmed(false) }}>가져오기 닫기</button></section>}
  </details>
}
