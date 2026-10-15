import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useEditSession } from '../app/EditSession'
import { FileError, type CollectionFileRepository, type FileOwnerScope, type FilePolicy, type FileReadScope, type FileReference } from './contracts'
import { requestBlobDownload } from './download'
import { normalizeFilePolicy } from './validation'
import './files.css'

interface Operation { controller: AbortController; identity: object }

// 늦게 끝난 파일 읽기가 다른 학교나 새 선택 목록에 결과를 쓰지 않게 한다.
function useFileOperation(identity: object, onBusyChange?: (busy: boolean) => void) {
  const [busy, setBusy] = useState(false)
  const operation = useRef<Operation | null>(null)
  const live = useRef({ identity, onBusyChange })
  live.current = { identity, onBusyChange }
  useEditSession(busy)
  function stop() {
    const previous = operation.current
    operation.current = null
    previous?.controller.abort()
    if (previous) live.current.onBusyChange?.(false)
  }
  useEffect(() => {
    setBusy(false)
    return stop
  }, [identity])
  return {
    busy,
    begin() {
      stop()
      const next: Operation = { controller: new AbortController(), identity }
      operation.current = next
      setBusy(true)
      live.current.onBusyChange?.(true)
      return next
    },
    current(candidate: Operation) {
      return operation.current === candidate && live.current.identity === candidate.identity && !candidate.controller.signal.aborted
    },
    finish(candidate: Operation) {
      if (operation.current !== candidate) return
      operation.current = null
      setBusy(false)
      live.current.onBusyChange?.(false)
    },
    cancel() { stop(); setBusy(false) },
  }
}

function validReferences(value: unknown): value is FileReference[] {
  return Array.isArray(value) && value.every(file => file && typeof file === 'object' && Object.keys(file).length === 5 && ['id', 'name', 'extension', 'bytes', 'sha256'].every(key => Object.hasOwn(file, key)) && typeof file.id === 'string' && typeof file.name === 'string' && typeof file.extension === 'string' && typeof file.sha256 === 'string' && Number.isSafeInteger(file.bytes) && file.bytes >= 0)
}

function policyReady(policy: FilePolicy) {
  try { normalizeFilePolicy(policy); return true } catch { return false }
}

export function formatFileBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('ko-KR')}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}MB`
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof FileError ? error.message : fallback
}

export interface FileSelectionProps {
  repository: CollectionFileRepository
  policy: FilePolicy
  owner: FileOwnerScope
  readScope?: FileReadScope
  files: FileReference[]
  onChange: (files: FileReference[]) => void
  label: string
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}

export function FileSelection({ repository, policy, owner, readScope, files, onChange, label, disabled = false, onBusyChange }: FileSelectionProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const replacementInput = useRef<HTMLInputElement>(null)
  const replacementTarget = useRef<string>()
  const selectionOrigin = useRef<HTMLElement | null>(null)
  const restoreInputFocus = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState({ checked: 0, total: 0 })
  const valid = validReferences(files)
  const selected = valid ? files : []
  const ready = policyReady(policy)
  const policyKey = ready ? `${policy.extensions.join(',')}:${policy.maxFileBytes}:${policy.maxFiles}` : 'unavailable'
  const filesKey = valid ? JSON.stringify(files) : 'invalid'
  const scope = readScope ?? { schoolId: owner.schoolId, memberIds: [owner.memberId] }
  const scopeKey = `${scope.schoolId}:${JSON.stringify(scope.memberIds)}`
  // 이 선택기가 만든 임시 파일만 추적한다. 저장된 원문은 저장소의 보호 표시가 지킨다.
  const staged = useMemo(() => ({ owner: { schoolId: owner.schoolId, memberId: owner.memberId }, refs: new Map<string, FileReference>() }), [repository, owner.schoolId, owner.memberId])
  function releaseStaged(candidates: FileReference[]) {
    // 보호 기능이 없는 외부 저장소에는 미저장 여부를 추정해 삭제를 요청하지 않는다.
    if (!repository.retainSaved || !candidates.length) return
    try {
      repository.discardStaged(candidates, staged.owner)
      for (const file of candidates) staged.refs.delete(file.id)
    } catch { /* 회수 실패는 다음 목록 변경·편집 종료 때 다시 시도한다. */ }
  }
  useEffect(() => {
    if (!valid) return
    const keep = new Set(selected.map(file => file.id))
    releaseStaged([...staged.refs.values()].filter(file => !keep.has(file.id)))
  }, [staged, filesKey])
  useEffect(() => () => releaseStaged([...staged.refs.values()]), [staged])
  const identity = useMemo(() => ({}), [repository, owner.schoolId, owner.memberId, policyKey, scopeKey, filesKey, disabled])
  const operation = useFileOperation(identity, onBusyChange)
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => { setError(''); setNotice('') }, [repository, owner.schoolId, owner.memberId, policyKey])
  const blocked = disabled || !ready || !valid
  const totalBytes = selected.reduce((total, file) => total + file.bytes, 0)
  useEffect(() => {
    if (restoreInputFocus.current && !operation.busy && !blocked) { restoreInputFocus.current = false; (selectionOrigin.current?.isConnected ? selectionOrigin.current : input.current)?.focus() }
  }, [operation.busy, blocked])

  async function choose(values: File[], replaceId?: string) {
    if (!values.length || blocked || operation.busy) return
    setError(''); setNotice('')
    const replaceIndex = replaceId === undefined ? -1 : selected.findIndex(file => file.id === replaceId)
    if (replaceId !== undefined && (replaceIndex < 0 || values.length !== 1)) {
      setError('바꿀 파일을 확인하고 새 파일 하나를 선택해 주세요. 기존 선택은 유지했습니다.')
      return
    }
    if (selected.length + values.length - Number(replaceIndex >= 0) > policy.maxFiles) {
      setError(`파일은 최대 ${policy.maxFiles}개까지 선택할 수 있습니다. 기존 선택은 유지했습니다.`)
      return
    }
    const current = operation.begin()
    const stagedOwner = { schoolId: owner.schoolId, memberId: owner.memberId }
    const acquired: FileReference[] = []
    let accepted = false
    setProgress({ checked: 0, total: values.length })
    try {
      const next = [...selected]
      for (const file of values) {
        const reference = await repository.stage(file, policy, stagedOwner, current.controller.signal)
        acquired.push(reference)
        if (!operation.current(current)) return
        // 새 파일의 검사까지 끝나야 기존 선택을 바꾼다. 저장된 초안·제출판의 실물은 유지한다.
        if (replaceIndex >= 0) next[replaceIndex] = reference
        else next.push(reference)
        repository.check(next, policy, scope)
        setProgress(value => ({ ...value, checked: value.checked + 1 }))
      }
      if (!operation.current(current)) return
      for (const reference of acquired) staged.refs.set(reference.id, reference)
      change.current(next)
      accepted = true
      // 교체로 사라진 이전 버튼에 초점을 남기지 않는다.
      if (replaceIndex >= 0) { selectionOrigin.current = input.current; restoreInputFocus.current = true }
      setNotice(replaceIndex >= 0 ? '파일을 바꿨습니다. 기본 확인 완료 · 현재 창에 보관' : '기본 확인 완료 · 현재 창에 보관')
    } catch (failure) {
      if (operation.current(current)) setError(safeError(failure, '파일을 확인하지 못했습니다. 기존 선택은 유지했습니다. 다시 선택해 주세요.'))
    } finally {
      // 이번 묶음에서만 만든 실물을 회수한다. 기존 선택과 저장된 제출 파일은 건드리지 않는다.
      if (!accepted) {
        try {
          repository.discardStaged(acquired, stagedOwner)
          for (const reference of acquired) staged.refs.delete(reference.id)
        } catch { /* 정리 오류가 원래 안내를 덮지 않게 한다. */ }
      }
      operation.finish(current)
    }
  }

  return <section className="wf-file-control" aria-label={label}>
    <div className="wf-file-heading"><strong id={`${id}-title`}>{label}</strong><span>{selected.length}개 · {formatFileBytes(totalBytes)}</span></div>
    <label className="wf-file-picker" data-disabled={blocked || operation.busy ? 'true' : undefined} htmlFor={`${id}-input`}><span>{label} 선택</span>
      <input ref={input} id={`${id}-input`} type="file" multiple accept={ready ? policy.extensions.map(extension => `.${extension}`).join(',') : undefined} disabled={blocked || operation.busy} aria-describedby={`${id}-policy ${id}-status${error || !valid ? ` ${id}-error` : ''}`} onChange={event => {
        const values = Array.from(event.currentTarget.files ?? [])
        // 같은 파일을 다시 골라도 검사 이벤트가 발생하게 입력만 비운다.
        event.currentTarget.value = ''
        selectionOrigin.current = input.current
        void choose(values)
      }} />
    </label>
    <input ref={replacementInput} hidden type="file" aria-label={`${label} 교체 파일 선택`} accept={ready ? policy.extensions.map(extension => `.${extension}`).join(',') : undefined} disabled={blocked || operation.busy} onChange={event => {
      const values = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      const target = replacementTarget.current
      replacementTarget.current = undefined
      if (target !== undefined) void choose(values, target)
    }} />
    <p id={`${id}-policy`} className="wf-file-hint">{ready ? `${policy.extensions.map(extension => extension.toUpperCase()).join(' · ')} · 파일당 ${formatFileBytes(policy.maxFileBytes)} 이하 · 최대 ${policy.maxFiles}개` : '파일 형식과 용량 기준을 확인할 수 없습니다.'}</p>
    {selected.length > 0 && <ul className="wf-file-list" aria-labelledby={`${id}-title`}>{selected.map((file, index) => <li key={`${file.id}:${index}`}>
      <div className="wf-file-description"><span className="wf-file-name">{file.name}</span><small>{formatFileBytes(file.bytes)}</small></div>
      <button type="button" className="wf-file-button" disabled={blocked || operation.busy} aria-label={`${file.name} 바꾸기`} onClick={event => {
        replacementTarget.current = file.id; selectionOrigin.current = event.currentTarget; replacementInput.current?.click()
      }}>바꾸기</button>
      <button type="button" className="wf-file-button" disabled={blocked || operation.busy} aria-label={`${file.name} 제거`} onClick={() => {
        change.current(selected.filter((_, position) => position !== index)); setError(''); setNotice('선택한 파일을 목록에서 제거했습니다.'); input.current?.focus()
      }}>제거</button>
    </li>)}</ul>}
    <div id={`${id}-status`} className="wf-file-status" role="status" aria-live="polite" aria-atomic="true">{operation.busy ? `파일 확인 중 · ${progress.checked}/${progress.total}개` : notice || (selected.length ? '선택한 파일은 최종 제출 전입니다.' : '선택한 파일이 없습니다.')}</div>
    {operation.busy && <button type="button" className="wf-file-button" onClick={() => { restoreInputFocus.current = true; operation.cancel(); setNotice('파일 확인을 취소했습니다. 기존 선택은 유지했습니다.') }}>파일 확인 취소</button>}
    {(error || !valid) && <p id={`${id}-error`} className="wf-file-error" role="alert">{valid ? error : '첨부 파일 목록을 확인할 수 없습니다. 원본을 다시 확인해 주세요.'}</p>}
  </section>
}

export interface FileDownloadsProps {
  files: FileReference[]
  read: (reference: FileReference, signal?: AbortSignal) => Promise<Blob>
  label: string
}

export function FileDownloads({ files, read, label }: FileDownloadsProps) {
  const id = useId()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [readingId, setReadingId] = useState('')
  const downloadButton = useRef<HTMLButtonElement | null>(null)
  const restoreDownloadFocus = useRef(false)
  const valid = validReferences(files)
  const available = valid ? files : []
  const filesKey = valid ? JSON.stringify(files) : 'invalid'
  const identity = useMemo(() => ({}), [filesKey, label])
  const operation = useFileOperation(identity)
  const latestRead = useRef(read)
  latestRead.current = read
  useEffect(() => { setError(''); setNotice('') }, [identity])
  useEffect(() => {
    if (restoreDownloadFocus.current && !operation.busy) { restoreDownloadFocus.current = false; if (downloadButton.current?.isConnected) downloadButton.current.focus() }
  }, [operation.busy])
  async function download(reference: FileReference) {
    if (operation.busy) return
    const current = operation.begin()
    setReadingId(reference.id); setError(''); setNotice('')
    try {
      // 누를 때마다 원본 조회 함수를 거쳐 현재 접근 가능 여부를 확인한다.
      const blob = await latestRead.current(reference, current.controller.signal)
      if (!operation.current(current)) return
      requestBlobDownload(blob, reference.name)
      setNotice('다운로드를 요청했습니다.')
    } catch (failure) {
      if (operation.current(current)) setError(safeError(failure, '파일을 내려받지 못했습니다. 다시 시도해 주세요.'))
    } finally { operation.finish(current) }
  }
  return <section className="wf-file-control wf-file-downloads" aria-label={label}>
    <strong id={`${id}-title`}>{label}</strong>
    {available.length ? <ul className="wf-file-list" aria-labelledby={`${id}-title`}>{available.map((file, index) => <li key={`${file.id}:${index}`}>
      <div className="wf-file-description"><span className="wf-file-name">{file.name}</span><small>{formatFileBytes(file.bytes)}</small></div>
      <button type="button" className="wf-file-button" disabled={operation.busy} aria-label={`${file.name} 다운로드`} onClick={event => { downloadButton.current = event.currentTarget; void download(file) }}>{operation.busy && readingId === file.id ? '확인 중…' : '다운로드'}</button>
    </li>)}</ul> : <p className="wf-file-hint">{valid ? '첨부된 파일이 없습니다.' : '첨부 파일 목록을 확인할 수 없습니다.'}</p>}
    <div className="wf-file-status" role="status" aria-live="polite" aria-atomic="true">{operation.busy ? '다운로드할 파일을 확인하고 있습니다.' : notice}</div>
    {operation.busy && <button type="button" className="wf-file-button" onClick={() => { restoreDownloadFocus.current = true; operation.cancel(); setNotice('다운로드 요청을 취소했습니다.') }}>다운로드 취소</button>}
    {error && <p className="wf-file-error" role="alert">{error}</p>}
  </section>
}
