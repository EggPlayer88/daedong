import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditSession } from '../app/EditSession'
import { FileError } from '../files/contracts'
import { createStoredZip, requestBlobDownload } from '../files/download'
import type { WorkflowStore } from './store'
import { WorkflowError, type CollectionRequest } from './types'
import { assertFileExportCurrent, fileExportPlan, type FileExportMode, type FileExportPlan } from './collection-file-export'
import './file-export.css'

interface Batch { plan: FileExportPlan; blobs: Map<string, Blob>; failed: string[]; zip?: Blob }
const jobKey = (job: FileExportPlan['jobs'][number]) => job.submissionId + ':' + job.file.id
const message = (error: unknown) => error instanceof FileError || error instanceof WorkflowError ? error.message : '묶음 파일을 준비하지 못했습니다. 다시 시도해 주세요.'

export function CollectionFileExport({ member, request, store }: { member: Membership; request: CollectionRequest; store: WorkflowStore }) {
  const id = useId()
  const [mode, setMode] = useState<FileExportMode>('effective')
  const [batch, setBatch] = useState<Batch>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController>()
  const generation = useRef(0)
  const live = useRef({ memberId: member.id, schoolId: member.schoolId, requestId: request.id, store })
  live.current = { memberId: member.id, schoolId: member.schoolId, requestId: request.id, store }
  useEditSession(busy)
  function cancel() { generation.current++; active.current?.abort(); active.current = undefined; setBusy(false); setProgress(''); setBatch(undefined); setNotice('준비를 취소했습니다. 제출 자료는 바뀌지 않았습니다.') }
  useEffect(() => {
    setBatch(undefined); setError(''); setNotice(''); setBusy(false)
    return () => { generation.current++; active.current?.abort(); active.current = undefined }
  }, [member.id, member.schoolId, request.id, store])
  function begin() {
    active.current?.abort()
    const controller = new AbortController(), token = ++generation.current, context = live.current
    active.current = controller; setBusy(true); setError(''); setNotice('')
    return { signal: controller.signal, valid: () => token === generation.current && !controller.signal.aborted && live.current.memberId === context.memberId && live.current.schoolId === context.schoolId && live.current.requestId === context.requestId && live.current.store === context.store }
  }
  async function prepare(retry = false) {
    if (busy) return
    const op = begin()
    let work: Batch | undefined
    try {
      const plan = retry && batch ? batch.plan : fileExportPlan(store, member.id, request.id, mode)
      assertFileExportCurrent(store, member.id, plan)
      work = { plan, blobs: retry && batch ? new Map(batch.blobs) : new Map(), failed: [] }
      setBatch(undefined)
      for (const [index, job] of plan.jobs.entries()) {
        if (!op.valid()) return
        setProgress('파일 확인 중 · ' + (index + 1) + '/' + plan.jobs.length + '개')
        const key = jobKey(job)
        if (!work.blobs.has(key)) {
          try { work.blobs.set(key, await store.getSubmissionFile(member.id, job.unitId, job.submissionId, job.file.id, op.signal)) }
          catch (failure) { if (!op.valid()) return; if (failure instanceof WorkflowError) throw failure; work.failed.push(key) }
        }
      }
      if (!op.valid()) return
      assertFileExportCurrent(store, member.id, plan)
      if (work.failed.length) {
        setBatch(work); setError(work.failed.length + '개 파일을 확인하지 못했습니다. 모두 확인되기 전에는 묶음을 내려받지 않습니다.')
        return
      }
      setProgress('묶음 파일 만드는 중')
      work.zip = await createStoredZip([{ name: '수합현황.csv', blob: new Blob([plan.csv], { type: 'text/csv;charset=utf-8' }) }, ...plan.jobs.map(job => ({ name: job.name, blob: work!.blobs.get(jobKey(job))! }))], op.signal)
      if (!op.valid()) return
      assertFileExportCurrent(store, member.id, plan)
      setBatch(work); setNotice(plan.jobs.length + '개 파일과 현황표를 준비했습니다.' + (plan.jobs.length === 0 ? ' 제출 파일 없이 현황표만 포함됩니다.' : ''))
    } catch (failure) {
      if (op.valid()) { setBatch(undefined); setError(message(failure)) }
    } finally { if (op.valid()) { active.current = undefined; setBusy(false); setProgress('') } }
  }
  async function download() {
    if (busy || !batch?.zip) return
    const op = begin()
    try {
      assertFileExportCurrent(store, member.id, batch.plan)
      setProgress('다운로드 전 원본 확인 중')
      // 캐시한 묶음도 현재 원본과 접근 상태를 다시 확인한 뒤 제공한다.
      for (const job of batch.plan.jobs) {
        await store.getSubmissionFile(member.id, job.unitId, job.submissionId, job.file.id, op.signal)
        if (!op.valid()) return
      }
      assertFileExportCurrent(store, member.id, batch.plan)
      if (!op.valid()) return
      requestBlobDownload(batch.zip, batch.plan.title + '_' + (mode === 'effective' ? '완료본' : '최신제출본') + '.zip')
      setNotice('묶음 다운로드를 요청했습니다.')
    } catch (failure) {
      if (op.valid()) { setBatch(undefined); setError(message(failure)) }
    } finally { if (op.valid()) { active.current = undefined; setBusy(false); setProgress('') } }
  }
  return <details className="wf-file-export">
    <summary>제출 파일 모아 받기</summary>
    <div className="wf-file-export-body">
      <label htmlFor={id}>모을 파일 기준<select id={id} value={mode} disabled={busy} onChange={event => { setMode(event.target.value as FileExportMode); setBatch(undefined); setError(''); setNotice('') }}>
        <option value="effective">완료본 · 검토가 끝난 파일</option><option value="current">최신 제출본 · 검토 대기 포함</option>
      </select></label>
      <p className="wf-hint">{mode === 'effective' ? '검토가 필요한 수합은 검토 완료된 제출판을 모읍니다. 검토 없는 수합은 접수된 완료본을 모읍니다.' : '검토 대기·보완 요청 중인 최신 제출판도 포함합니다. 완료본과 다를 수 있습니다.'} 미제출 초안은 포함하지 않습니다.</p>
      <div className="wf-actions"><button type="button" className="secondary small" disabled={busy} onClick={() => void prepare()}>최신 현황으로 묶음 준비</button>
        {batch?.failed.length ? <button type="button" className="secondary small" disabled={busy} onClick={() => void prepare(true)}>실패한 파일 다시 확인</button> : null}
        {batch?.zip && <button type="button" className="primary small" disabled={busy} onClick={() => void download()}>ZIP 내려받기</button>}
        {busy && <button type="button" className="secondary small" onClick={cancel}>묶음 준비 취소</button>}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="wf-hint">{busy ? progress : notice}</p>
      {error && <p role="alert" className="wf-error">{error}</p>}
      {batch && <p className="wf-hint">대상 {batch.plan.totalUnits}단위 중 파일 포함 {batch.plan.includedUnits}단위 · 파일 {batch.plan.jobs.length}개. 제외된 단위와 포함한 제출판은 현황표에 표시합니다.</p>}
      {batch && batch.failed.length > 0 && <ul className="wf-file-failures">{batch.plan.jobs.filter(job => batch.failed.includes(jobKey(job))).slice(0, 20).map(job => <li key={jobKey(job)}>{job.unitLabel} · v{job.revision} · {job.file.name}</li>)}{batch.failed.length > 20 && <li>외 {batch.failed.length - 20}개</li>}</ul>}
      <p className="wf-hint">현재 창의 합성 자료를 ZIP과 CSV로 정리합니다. 준비한 뒤 제출 상태가 바뀌면 다시 준비해야 합니다.</p>
    </div>
  </details>
}
