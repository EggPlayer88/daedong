import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { FileError, type FilePolicy, type FileReference } from '../files/contracts'
import { formatFileBytes } from '../files/FileControls'
import { requestBlobDownload } from '../files/download'
import type { AnswerInput, CollectionDraft, CollectionInput, CollectionRequest } from '../workflows/types'
import { CollectionServerError, type CollectionServer, type CollectionCommand, type CollectionDetail, type CollectionFileParent, type CollectionList, type CollectionReadiness, type CollectionUpload } from './contracts'
import { CollectionUnitsEditor } from './CollectionUnitsEditor'
import { collectionUnitMemberOptions, validateCollectionUnitInputs } from './unit-inputs'
import { CollectionSubmissionHistory } from './CollectionSubmissionHistory'
import { CollectionServerExport } from './CollectionServerExport'
import { formatCollectionRecordedTime, summarizeCollectionSubmission } from './submission-summary'
import styles from './collection-server.css?inline'

export interface CollectionServerPanelProps { server: CollectionServer; member: Membership; members: Membership[]; date: string; revision?: number; onNavigationLockChange?: (locked: boolean) => void }
type Editor = { original?: CollectionRequest; input: CollectionInput }
type Answer = { requestId: string; unitId: string; original: CollectionDraft | null; input: AnswerInput; reason: string; correctionRequestId: string; confirmedVersion?: number }
type Upload = { file: File; parent: CollectionFileParent; policy: FilePolicy; prepareKey: string; completeKey: string; intent?: CollectionUpload; phase: 'prepare' | 'upload' | 'complete' | 'status'; rejected?: boolean; cancelable?: boolean }
type Review = { unitId: string; submissionId: string; expectedVersion: number; note: string; dueDate: string }
type Management = { kind: 'withdraw' | 'open_correction'; unitId: string; submissionId: string | null; expectedVersion: number; reason: string; dueDate: string; confirmed: boolean }
type Session = { selectedId?: string; editor?: Editor; answer?: Answer; upload?: Upload; review?: Review; management?: Management; conflict?: boolean }
const blank = (): CollectionInput => ({ title: '', instructions: '', dueDate: '', reviewMode: 'none', reviewerMemberId: '', textLabel: '', textRequired: false, numberLabel: '', numberRequired: false, units: [] })
const inputOf = ({ title, instructions, dueDate, reviewMode, reviewerMemberId, textLabel, textRequired, numberLabel, numberRequired, units, fileCollection }: CollectionRequest): CollectionInput => ({ title, instructions, dueDate, reviewMode, reviewerMemberId, textLabel, textRequired, numberLabel, numberRequired, units, fileCollection })
const knownRejection = (failure: unknown) => failure instanceof CollectionServerError && ['NOT_READY', 'INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'CONFLICT', 'FILE_NOT_READY', 'FILE_FAILED'].includes(failure.code)
const accessDenied = (failure: unknown) => failure instanceof CollectionServerError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(failure.code)
const failureMessage = (failure: unknown) => failure instanceof FileError ? failure.message : failure instanceof CollectionServerError && failure.code === 'CONFLICT' ? '다른 곳에서 먼저 변경했습니다. 내 입력은 유지했습니다. 최신 원본을 다시 확인한 뒤 편집해 주세요.' : knownRejection(failure) ? '서버가 이 작업을 허용하지 않았습니다. 현재 권한, 기한, 파일과 입력을 확인해 주세요. 입력은 유지했습니다.' : '처리 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다. 같은 요청으로 다시 확인해 주세요.'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const layoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// 소속이 실제로 바뀌면 이전 화면을 첫 렌더부터 제거한다. 일시적인 연결 오류의 복구는 상위 메모리가 맡는다.
export function CollectionServerPanel(props: CollectionServerPanelProps) { return <CollectionScope key={recoveryScope(props.member)} {...props} /> }

function CollectionScope({ server, member, members, date, revision = 0, onNavigationLockChange }: CollectionServerPanelProps) {
  const memory = useEditDraft<Session>(member, 'collection-editor'), recovery = usePendingRequest(member, 'collection')
  const [session, setSessionState] = useState<Session>(() => memory.initial ?? {})
  const sessionRef = useRef(session), life = useRef(0), operation = useRef(false)
  const [readiness, setReadiness] = useState<CollectionReadiness>(), [list, setList] = useState<CollectionList>(), [detail, setDetail] = useState<CollectionDetail>()
  const [cursor, setCursor] = useState<string>(), [history, setHistory] = useState<(string | undefined)[]>([])
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [restoring, setRestoring] = useState(false)
  const [readError, setReadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('')
  const [comparison, setComparison] = useState<{ detail: CollectionDetail; draft?: CollectionDraft | null }>()
  const [exportBusy, setExportBusy] = useState(false)
  const pending = recovery.request, selectedId = session.selectedId ?? (pending?.command.kind !== 'create' ? pending?.command.requestId : undefined)
  const enabled = activeAt(member, date)
  const dirty = Boolean(session.editor || session.answer || session.upload || session.review || session.management || session.conflict)
  const locked = Boolean(busy || pending || dirty || exportBusy)
  const blocked = Boolean(busy || pending || restoring || session.upload || session.conflict || session.answer?.confirmedVersion || exportBusy)
  const selectedUnit = detail?.units.find(unit => unit.id === session.answer?.unitId)
  const policy = readiness?.policy
  function setSession(value: Session) { sessionRef.current = value; memory.save(value, Boolean(value.editor || value.answer || value.upload || value.review || value.management || value.conflict)); setSessionState(value) }
  function resetEditing(selected?: string) { setSession({ selectedId: selected }); setError(''); setComparison(undefined) }
  function hideDenied() { memory.remove(); sessionRef.current = {}; setSessionState({}); setDetail(undefined); setList(undefined); setReadiness(undefined); setComparison(undefined); setReadError('현재 자료의 접근 권한을 확인할 수 없어 이전 화면을 닫았습니다. 연결을 다시 확인해 주세요.') }
  const stillHere = (epoch: number) => life.current === epoch
  useEffect(() => { return () => { life.current++; operation.current = false } }, [server])
  layoutEffect(() => { onNavigationLockChange?.(locked); return () => onNavigationLockChange?.(false) }, [locked, onNavigationLockChange])
  useEffect(() => {
    if (!locked) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [locked])
  useEffect(() => {
    let current = true
    setLoading(true); setReadError(''); setList(undefined)
    if (!enabled) { setReadiness(undefined); setLoading(false); setReadError('현재 이용 가능한 학교 소속이 아닙니다.'); return }
    void server.readiness(member.id).then(async ready => {
      if (!current) return
      setReadiness(ready)
      if (ready.available) { const result = await server.list(member.id, cursor); if (current) setList(result) }
    }).catch(() => { if (current) { setReadiness(undefined); setReadError('문서 수합 연결을 확인하지 못했습니다. 수합이 없는 것으로 표시하지 않습니다.') } }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [server, member.id, enabled, cursor, reload, revision])
  useEffect(() => {
    let current = true
    setDetail(undefined)
    if (!selectedId || !readiness?.available) return
    setRestoring(true); setReadError('')
    void server.detail(member.id, selectedId).then(async value => {
      // 보관한 공동 초안은 현재 읽기 권한까지 다시 확인한 뒤 표시한다. 원래 버전은 유지한다.
      const answer = sessionRef.current.answer
      const latestDraft = answer ? await server.draft(member.id, selectedId, answer.unitId) : undefined
      if (!current) return
      setDetail(value)
      const action = sessionRef.current.management ?? sessionRef.current.review
      if (action && !recovery.request) {
        const unit = value.units.find(item => item.id === action.unitId)
        const allowed = unit && (sessionRef.current.management?.kind === 'open_correction' ? value.request.managerMemberId === member.id : sessionRef.current.management ? unit.responsibleMemberId === member.id : value.request.reviewerMemberId === member.id)
        if (!allowed) {
          setSession({ selectedId }); setError('현재 변경 권한을 확인할 수 없어 보관한 관리 입력을 버렸습니다.')
        } else if (unit.version !== action.expectedVersion || (action.submissionId && unit.currentSubmissionId !== action.submissionId)) {
          // 포커스 재조회가 새 제출을 이전 의견·철회 사유의 대상으로 바꾸지 않게 한다.
          setSession({ ...sessionRef.current, conflict: true }); setComparison({ detail: value })
        }
      }
      if (answer?.confirmedVersion) {
        if (latestDraft?.version === answer.confirmedVersion) setSession({ ...sessionRef.current, answer: { ...answer, original: latestDraft, input: { text: latestDraft.text, number: latestDraft.number, files: latestDraft.files ?? [] }, confirmedVersion: undefined } })
        else { setSession({ ...sessionRef.current, conflict: true, answer: { ...answer, confirmedVersion: undefined } }); setComparison({ detail: value, draft: latestDraft }); setError('초안 저장 뒤 다른 변경이 확인되었습니다. 최신 내용과 내 입력을 비교해 주세요.') }
      }
    }).catch(failure => {
      if (!current) return
      if (accessDenied(failure) && !recovery.request) hideDenied()
      setReadError('수합 원본의 접근 권한과 최신 상태를 확인하지 못했습니다. 보관한 입력은 확인 전까지 표시하지 않습니다.')
    }).finally(() => { if (current) setRestoring(false) })
    return () => { current = false }
  }, [server, member.id, selectedId, readiness?.available, reload, revision])

  async function mutate(command: CollectionCommand, key: string = crypto.randomUUID()) {
    if (operation.current || !readiness?.available || !enabled) return
    const request = { command: structuredClone(command), key }, epoch = life.current
    operation.current = true; recovery.put(request); setBusy('서버에 저장 중…'); setError(''); setNotice('')
    try {
      const receipt = await server.mutate(member.id, request.command, request.key)
      if (!stillHere(epoch)) return
      recovery.remove(key)
      // 접수 확인 이후 조회가 실패하더라도 이미 확인된 저장을 다시 실행하지 않는다.
      if (command.kind === 'save_draft' && sessionRef.current.answer?.unitId === command.unitId) {
        // 재제출 사유·선택한 보완 건은 초안 데이터와 별개다. 저장 뒤에도 같은 편집 세션에 남긴다.
        setSession({ ...sessionRef.current, answer: { ...sessionRef.current.answer, confirmedVersion: receipt.resourceVersion } }); setError('')
      } else resetEditing(receipt.requestId)
      setNotice(`서버에서 처리했습니다. 접수 시각 ${receipt.recordedAt}`); setReload(value => value + 1)
    } catch (failure) {
      if (!stillHere(epoch)) return
      if (knownRejection(failure)) recovery.remove(key)
      if (accessDenied(failure)) hideDenied()
      else if (failure instanceof CollectionServerError && failure.code === 'CONFLICT') { setSession({ ...sessionRef.current, conflict: true }); setComparison(undefined) }
      setError(failureMessage(failure))
    } finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  async function openAnswer(unitId: string) {
    if (locked || !detail) return
    const epoch = life.current; operation.current = true; setBusy('공동 초안을 확인 중…'); setError('')
    try {
      const draft = await server.draft(member.id, detail.request.id, unitId)
      if (stillHere(epoch)) setSession({ selectedId: detail.request.id, answer: { requestId: detail.request.id, unitId, original: draft, input: { text: draft?.text ?? '', number: draft?.number ?? null, files: draft?.files ?? [] }, reason: '', correctionRequestId: '' } })
    } catch (failure) { if (stillHere(epoch)) { setDetail(undefined); if (accessDenied(failure)) hideDenied(); setError(failureMessage(failure)); setReadError('제출 초안을 확인하지 못해 수합 상세를 닫았습니다. 다시 연결해 주세요.') } }
    finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  async function compareLatest() {
    if (operation.current || !selectedId) return
    const epoch = life.current; operation.current = true; setBusy('최신 변경을 확인 중…')
    try {
      const latest = await server.detail(member.id, selectedId)
      const draft = session.answer ? await server.draft(member.id, selectedId, session.answer.unitId) : undefined
      if (stillHere(epoch)) setComparison({ detail: latest, draft })
    } catch (failure) { if (stillHere(epoch)) { if (accessDenied(failure)) hideDenied(); setError(failureMessage(failure)) } }
    finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  async function uploadFile(initial: Upload) {
    if (operation.current || !policy || !enabled) return
    const epoch = life.current
    operation.current = true; setBusy('파일을 서버에서 확인 중…'); setError('')
    let job = initial
    const keep = (next: Upload) => { job = next; if (stillHere(epoch)) setSession({ ...sessionRef.current, upload: next }) }
    try {
      if (!job.intent) {
        const intent = await server.prepareUpload(member.id, job.parent, job.file, job.policy, job.prepareKey)
        if (!stillHere(epoch)) return
        keep({ ...job, intent, phase: intent.state === 'awaiting_upload' ? 'upload' : 'status' })
      }
      if (job.phase === 'upload') {
        // 응답 유실 뒤에는 먼저 동일 예약의 완료 여부를 확인한다. 새 파일 ID를 만들지 않는다.
        keep({ ...job, phase: 'complete', cancelable: false })
        await server.upload(member.id, job.intent!, job.file)
        if (!stillHere(epoch)) return
      }
      const status = job.phase === 'status' ? await server.fileStatus(member.id, job.intent!.fileId) : await server.completeUpload(member.id, job.intent!.fileId, job.completeKey)
      if (!stillHere(epoch)) return
      if (status.state === 'ready' && status.file) {
        const current = sessionRef.current, ref = status.file
        if (job.parent.kind === 'template' && current.editor?.original?.id === job.parent.requestId && current.editor.input.fileCollection) {
          const fileCollection = current.editor.input.fileCollection
          setSession({ ...current, upload: undefined, editor: { ...current.editor, input: { ...current.editor.input, fileCollection: { ...fileCollection, templates: [...fileCollection.templates.filter(file => file.id !== ref.id), ref] } } } })
        } else if (job.parent.kind === 'draft' && current.answer?.unitId === job.parent.unitId) {
          setSession({ ...current, upload: undefined, answer: { ...current.answer, input: { ...current.answer.input, files: [...(current.answer.input.files ?? []).filter(file => file.id !== ref.id), ref] } } })
        } else throw new CollectionServerError('CONFLICT', '파일을 연결할 입력이 바뀌었습니다.')
        setNotice('파일 준비가 완료되었습니다. 아래 저장 버튼을 눌러 문서에 연결해 주세요.')
      } else {
        keep({ ...job, phase: status.state === 'awaiting_upload' ? 'upload' : 'status', rejected: status.state === 'rejected', cancelable: true })
        setNotice(status.state === 'rejected' ? '서버가 파일을 거부했습니다. 다른 파일을 선택해 주세요.' : status.state === 'awaiting_upload' ? '파일 전송이 아직 확인되지 않았습니다. 같은 파일을 다시 전송할 수 있습니다.' : '서버에서 파일을 확인하고 있습니다. 완료된 파일만 저장·제출할 수 있습니다.')
      }
    } catch (failure) { if (stillHere(epoch)) { if (accessDenied(failure)) hideDenied(); else if (knownRejection(failure) || failure instanceof FileError) keep({ ...job, rejected: true, cancelable: true }); setError(failureMessage(failure)) } }
    finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  function chooseFile(file: File | undefined, parent: CollectionFileParent, existing: FileReference[], filePolicy: FilePolicy) {
    if (!file || blocked) return
    if (existing.length >= filePolicy.maxFiles) { setError(`파일은 최대 ${filePolicy.maxFiles}개입니다. 기존 파일을 제거한 뒤 선택해 주세요.`); return }
    const job: Upload = { file, parent, policy: filePolicy, prepareKey: crypto.randomUUID(), completeKey: crypto.randomUUID(), phase: 'prepare' }
    setSession({ ...sessionRef.current, upload: job }); void uploadFile(job)
  }
  async function download(parent: CollectionFileParent, file: FileReference) {
    if (operation.current || exportBusy) return
    const epoch = life.current; operation.current = true; setBusy('파일을 내려받는 중…'); setError('')
    try { const blob = await server.download(member.id, parent, file); if (stillHere(epoch)) requestBlobDownload(blob, file.name) }
    catch (failure) { if (stillHere(epoch)) { if (accessDenied(failure)) hideDenied(); setError('현재 권한으로 파일을 내려받지 못했습니다. 잠시 뒤 다시 확인해 주세요.') } }
    finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  const allowedMembers = members.filter(value => value.schoolId === member.schoolId && activeAt(value, date))
  const unitValidation = session.editor ? validateCollectionUnitInputs(session.editor.input.units, allowedMembers) : undefined
  const memberOptions = collectionUnitMemberOptions(allowedMembers)
  const memberLabel = (person: Membership) => memberOptions.find(value => value.id === person.id)?.label ?? person.name
  const canShowEditor = session.editor && (!session.editor.original || detail?.request.id === session.editor.original.id) && !restoring
  const canShowAnswer = session.answer && detail?.request.id === session.answer.requestId && selectedUnit && !restoring
  const hadSubmission = Boolean(selectedUnit && detail?.submissions.some(value => value.unitId === selectedUnit.id))
  const action = session.management ?? session.review
  const comparisonUnit = comparison?.detail.units.find(value => value.id === action?.unitId)
  const actionTargetChanged = Boolean(action?.submissionId && comparisonUnit?.currentSubmissionId !== action.submissionId)
  const actionReviews = comparison?.detail.reviews.filter(value => value.submissionId === action?.submissionId) ?? []
  const canRetainAction = !action || Boolean(comparisonUnit && !actionTargetChanged && (session.management?.kind === 'open_correction' ? comparison?.detail.request.managerMemberId === member.id : session.management ? comparisonUnit.responsibleMemberId === member.id && !actionReviews.some(value => value.decision === 'accepted') : comparison?.detail.request.reviewerMemberId === member.id && !actionReviews.length))
  function retainComparedInput() {
    if (!comparison || !canRetainAction) return
    setDetail(comparison.detail)
    setSession({ ...session, conflict: false,
      editor: session.editor ? { ...session.editor, original: comparison.detail.request } : undefined,
      answer: session.answer ? { ...session.answer, original: comparison.draft ?? null } : undefined,
      review: session.review && comparisonUnit ? { ...session.review, expectedVersion: comparisonUnit.version } : undefined,
      management: session.management && comparisonUnit ? { ...session.management, expectedVersion: comparisonUnit.version, confirmed: false } : undefined,
    })
    setComparison(undefined); setError(''); setNotice('최신 버전을 확인했습니다. 내 입력을 검토한 뒤 저장해 주세요.')
  }
  const managementUnit = detail?.units.find(value => value.id === session.management?.unitId)
  function submitManagement(event: FormEvent) {
    event.preventDefault()
    const form = session.management
    if (blocked || !detail || !form || !managementUnit || !form.confirmed || !form.reason.trim()) return
    if (managementUnit.version !== form.expectedVersion || (form.kind === 'withdraw' && managementUnit.currentSubmissionId !== form.submissionId)) {
      setSession({ ...session, conflict: true }); setComparison({ detail }); return
    }
    if (form.kind === 'withdraw' && form.submissionId) void mutate({ kind: 'withdraw', requestId: detail.request.id, unitId: form.unitId, submissionId: form.submissionId, expectedVersion: form.expectedVersion, reason: form.reason })
    if (form.kind === 'open_correction' && form.dueDate && form.dueDate >= date) void mutate({ kind: 'open_correction', requestId: detail.request.id, unitId: form.unitId, expectedVersion: form.expectedVersion, dueDate: form.dueDate, reason: form.reason })
  }
  function filesView(files: FileReference[], parent?: CollectionFileParent, remove?: (id: string) => void) {
    return <ul className="cs-files">{files.map(file => <li key={file.id}><span>{file.name} <small>{formatFileBytes(file.bytes)}</small></span><div>{parent && <button type="button" disabled={!!busy || exportBusy} onClick={() => { void download(parent, file) }}>{file.name} 다운로드</button>}{remove && <button type="button" disabled={blocked} onClick={() => remove(file.id)} aria-label={`${file.name} 제거`}>제거</button>}</div></li>)}</ul>
  }
  function picker(label: string, parent: CollectionFileParent, files: FileReference[]) {
    const filePolicy = parent.kind === 'template' ? session.editor?.input.fileCollection?.policy : detail?.request.fileCollection?.policy
    return filePolicy && <label className="cs-file-picker">{label}<input type="file" aria-label={label} disabled={blocked || files.length >= filePolicy.maxFiles} accept={filePolicy.extensions.map(value => `.${value}`).join(',')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; chooseFile(file, parent, files, filePolicy) }} /><small>{filePolicy.extensions.join(', ')} · 파일당 {formatFileBytes(filePolicy.maxFileBytes)} · 최대 {filePolicy.maxFiles}개</small></label>
  }
  return <section className="collection-server" aria-label="서버 문서 수합"><style>{styles}</style>
    <header className="cs-heading"><div><p>학교 업무</p><h2>문서 수합</h2><span>양식을 나누고 작성한 파일을 모읍니다.</span></div>{readiness?.available && <div className="cs-actions"><button type="button" disabled={!!busy || !!pending || loading || exportBusy} onClick={() => setReload(value => value + 1)}>새로 확인</button><button type="button" className="cs-primary" disabled={locked || loading} onClick={() => { setSession({ editor: { input: { ...blank(), fileCollection: { policy: policy!, required: true, templates: [] } } } }); setError(''); setNotice('') }}>새 수합 만들기</button></div>}</header>
    {busy && <p role="status">{busy}</p>}{notice && <p className="cs-notice" role="status">{notice}</p>}{error && <p className="cs-error" role="alert">{error}</p>}
    {pending && <section className="cs-warning" aria-label="수합 저장 결과 확인"><h3>이전 저장 결과 확인이 필요합니다</h3><p>같은 내용과 요청 번호로 다시 확인합니다. 결과가 확인될 때까지 새 저장과 화면 이동을 잠시 멈춥니다. 새로고침하면 보관한 입력이 사라집니다.</p><button type="button" disabled={!!busy || !readiness?.available} onClick={() => { void mutate(pending.command, pending.key) }}>이전 요청 그대로 다시 확인</button></section>}
    {readError && <section className="cs-error" role="alert"><p>{readError}</p><button type="button" disabled={!!busy} onClick={() => setReload(value => value + 1)}>연결과 원본 다시 확인</button></section>}
    {loading && <p role="status">수합 연결과 목록을 확인 중…</p>}
    {!loading && readiness && !readiness.available && <section className="cs-empty"><h3>문서 수합 연결 준비가 필요합니다</h3><p>{readiness.reason === 'database_missing' ? '문서 수합용 DB 함수가 아직 준비되지 않았습니다.' : readiness.reason === 'storage_missing' ? '문서 수합용 파일 저장소 연결이 아직 준비되지 않았습니다.' : readiness.reason === 'verification_missing' ? '업로드한 파일을 서버에서 확인하는 기능이 아직 준비되지 않았습니다.' : '학교의 파일 허용 정책을 먼저 설정해야 합니다.'}</p><p>연결 확인 전에는 등록·업로드·제출을 실행하지 않습니다.</p><button type="button" onClick={() => setReload(value => value + 1)}>준비 상태 다시 확인</button></section>}
    {(!readiness?.available || (readError && !detail && !restoring)) && dirty && !pending && (!session.upload || session.upload.cancelable || session.upload.rejected) && <button type="button" disabled={!!busy} onClick={() => { resetEditing(); setNotice('보관한 입력을 버렸습니다. 다른 메뉴로 이동할 수 있습니다.') }}>입력 버리고 닫기</button>}
    {readiness?.available && <>
      {session.conflict && <section className="cs-warning" aria-label="수합 변경 충돌">
        <h3>최신 내용과 내 입력을 비교해 주세요</h3>
        {comparison ? <><div className="cs-comparison"><div><h4>현재 서버 내용</h4>
          {session.answer ? <p>{comparison.draft?.text || '추가 답변 없음'} · {(comparison.draft?.files ?? []).map(file => file.name).join(', ') || '파일 없음'}</p> : action ? <><p>{comparisonUnit?.label ?? '현재 열람할 수 없는 제출 단위'} · 상태 {comparisonUnit?.version ?? '확인 필요'}판</p><p>현재 제출: {comparison.detail.submissions.find(value => value.id === comparisonUnit?.currentSubmissionId)?.revision ?? '없음'}판</p><p>정정 기한: {comparisonUnit?.correctionUntil || '설정 없음'}</p><p>{comparisonUnit?.correctionReason}</p></> : <><strong>{comparison.detail.request.title}</strong><p>{comparison.detail.request.instructions}</p><p>기한 {comparison.detail.request.dueDate} · 제출 단위 {comparison.detail.request.units.length}개</p><p>{comparison.detail.request.fileCollection?.templates.map(file => file.name).join(', ') || '양식 없음'}</p></>}
        </div><div><h4>내 입력</h4>
          {session.answer ? <p>{session.answer.input.text || '추가 답변 없음'} · {(session.answer.input.files ?? []).map(file => file.name).join(', ') || '파일 없음'}</p> : session.editor ? <><strong>{session.editor.input.title}</strong><p>{session.editor.input.instructions}</p><p>기한 {session.editor.input.dueDate} · 제출 단위 {session.editor.input.units.length}개</p><p>{session.editor.input.fileCollection?.templates.map(file => file.name).join(', ') || '양식 없음'}</p></> : session.management ? <><p>{session.management.kind === 'withdraw' ? '철회' : '정정 허용'} 사유: {session.management.reason}</p><p>{session.management.dueDate && `정정 기한: ${session.management.dueDate}`}</p></> : <p>검토 의견: {session.review?.note || '없음'}</p>}
        </div></div>
          {canRetainAction ? <button type="button" disabled={!!busy} onClick={retainComparedInput}>최신 버전 확인 · 내 입력 유지</button> : <p role="alert">대상 제출 또는 변경 권한이 달라졌습니다. 이 입력을 새 제출에 적용할 수 없습니다. 기존 작성을 닫고 최신 제출을 확인해 주세요.</p>}
        </> : <button type="button" disabled={!!busy} onClick={() => { void compareLatest() }}>최신 원본과 비교</button>}
        <button type="button" disabled={!!busy || !!pending} onClick={() => { resetEditing(selectedId); setReload(value => value + 1) }}>내 변경 버리고 다시 열기</button>
      </section>}
      {session.upload && <section className="cs-warning" aria-label="서버 파일 확인"><h3>{session.upload.file.name}</h3><p>{session.upload.rejected ? '이 파일은 사용할 수 없습니다.' : '파일 준비 완료 여부를 서버에서 확인한 뒤에만 양식이나 제출 내용에 연결합니다.'}</p>{session.upload.rejected ? <button type="button" disabled={!!busy} onClick={() => setSession({ ...session, upload: undefined })}>거부된 파일 선택 해제</button> : <><button type="button" disabled={!!busy || restoring} onClick={() => { void uploadFile(session.upload!) }}>{session.upload.phase === 'upload' ? '같은 파일 전송 재시도' : '같은 파일 상태 다시 확인'}</button>{session.upload.cancelable && <button type="button" disabled={!!busy} onClick={() => { setSession({ ...session, upload: undefined }); setNotice('이 파일의 첨부 선택을 취소했습니다. 서버의 미연결 파일은 정리 정책에 따라 처리됩니다.') }}>첨부 선택 취소</button>}</>}</section>}
      {canShowEditor && <form className="cs-card" aria-label="수합 초안 작성" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!blocked && unitValidation?.valid) void mutate(session.editor!.original ? { kind: 'update', requestId: session.editor!.original.id, expectedVersion: session.editor!.original.version, input: session.editor!.input } : { kind: 'create', input: session.editor!.input }) }}>
        <h3>{session.editor!.original ? '수합 초안 수정' : '새 수합 초안'}</h3><fieldset disabled={blocked}><legend className="cs-sr-only">수합 내용</legend>
          <label>수합 제목<input required value={session.editor!.input.title} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, title: event.target.value } } })} /></label>
          <label>안내 내용<textarea aria-label="안내 내용" rows={3} value={session.editor!.input.instructions} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, instructions: event.target.value } } })} /></label>
          <label>제출 기한<input type="date" required value={session.editor!.input.dueDate} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, dueDate: event.target.value } } })} /></label>
          <label>제출 후 검토<select aria-label="제출 후 검토" value={session.editor!.input.reviewerMemberId} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, reviewerMemberId: event.target.value, reviewMode: event.target.value ? 'required' : 'none' } } })}><option value="">검토 없이 제출 완료</option>{session.editor!.input.reviewerMemberId && !allowedMembers.some(person => person.id === session.editor!.input.reviewerMemberId) && <option value={session.editor!.input.reviewerMemberId}>기존 검토자 · 현재 명부에 없음</option>}{allowedMembers.filter(person => person.id === session.editor!.input.reviewerMemberId || !session.editor!.input.units.some(unit => unit.responsibleMemberId === person.id)).map(person => <option key={person.id} value={person.id}>{memberLabel(person)} 검토</option>)}</select></label>
          <CollectionUnitsEditor units={session.editor!.input.units} members={allowedMembers} reviewerMemberId={session.editor!.input.reviewerMemberId} disabled={blocked} onChange={units => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, units } } })} />
          {session.editor!.original ? <>{picker('양식 파일 선택', { kind: 'template', requestId: session.editor!.original.id, version: session.editor!.original.version }, session.editor!.input.fileCollection?.templates ?? [])}{filesView(session.editor!.input.fileCollection?.templates ?? [], undefined, id => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, fileCollection: { ...session.editor!.input.fileCollection!, templates: session.editor!.input.fileCollection!.templates.filter(file => file.id !== id) } } } }))}</> : <p className="cs-muted">먼저 초안을 저장한 뒤 양식 파일을 올릴 수 있습니다. 대상 교사에게는 공개한 뒤 표시됩니다.</p>}
        </fieldset><div className="cs-actions"><button type="submit" className="cs-primary" disabled={blocked || !unitValidation?.valid}>{session.editor!.original ? '수합 초안 변경 저장' : '수합 초안 저장'}</button><button type="button" disabled={blocked} onClick={() => resetEditing(session.editor?.original?.id)}>작성 취소</button></div>
      </form>}
      {restoring && <p role="status">수합 원본과 보관한 입력의 접근 권한을 다시 확인 중…</p>}
      {detail && !restoring && <section className="cs-card" aria-label="수합 상세"><div className="cs-heading"><div><h3>{detail.request.title}</h3><p>{detail.request.dueDate}까지 · {detail.request.status === 'draft' ? '담당자 초안' : '공개됨'} · v{detail.request.version}</p></div><button type="button" disabled={locked} onClick={() => { resetEditing(); setDetail(undefined) }}>목록으로</button></div><p className="cs-instructions">{detail.request.instructions}</p>
        {filesView(detail.request.fileCollection?.templates ?? [], { kind: 'template', requestId: detail.request.id, version: detail.request.version })}
        {detail.request.status === 'published' && detail.request.managerMemberId === member.id && detail.request.fileCollection && <CollectionServerExport server={server} member={member} requestId={detail.request.id} date={date} disabled={Boolean(busy || pending || dirty || restoring || !enabled)} onBusyChange={setExportBusy} />}
        {detail.request.status === 'draft' && detail.request.managerMemberId === member.id && <div className="cs-actions"><button type="button" disabled={locked} onClick={() => setSession({ selectedId: detail.request.id, editor: { original: detail.request, input: structuredClone(inputOf(detail.request)) } })}>양식 추가·초안 수정</button><button type="button" className="cs-primary" disabled={locked} onClick={() => { void mutate({ kind: 'publish', requestId: detail.request.id, expectedVersion: detail.request.version }) }}>대상 교사에게 공개</button></div>}
        {detail.request.status === 'published' && detail.units.map(unit => {
          const submission = detail.submissions.find(value => value.id === unit.currentSubmissionId), withdrawn = Boolean(submission && unit.withdrawnSubmissionIds.includes(submission.id))
          const review = submission && detail.reviews.find(value => value.submissionId === submission.id), participant = unit.members.some(value => value.id === member.id)
          const supplements = detail.supplements.filter(value => value.unitId === unit.id && !value.fulfilledSubmissionId)
          const summary = summarizeCollectionSubmission(detail, unit, date)
          return <article className="cs-unit" key={unit.id} aria-label={`${unit.label} 제출 현황`}><h4>{unit.label}</h4>
            <CollectionSubmissionHistory detail={detail} unit={unit} members={allowedMembers} date={date} disabled={locked} onDownload={(parent, file) => { void download(parent, file) }} />
            {submission && <p className="cs-muted">제출 v{submission.revision} · 서버 접수 <time dateTime={submission.receiptAt}>{formatCollectionRecordedTime(submission.receiptAt)}</time></p>}
            {submission && !withdrawn && filesView(submission.files ?? [], { kind: 'submission', requestId: detail.request.id, unitId: unit.id, submissionId: submission.id })}
            {participant && <button type="button" disabled={locked} onClick={() => { void openAnswer(unit.id) }}>내 제출 파일 작성</button>}
            {supplements.length > 0 && <p className="cs-warning">보완 요청 {supplements.length}건이 있습니다. 제출 파일을 작성하고 응답할 보완 건을 선택해 주세요.</p>}
            <div className="cs-actions">
              {submission && !withdrawn && unit.responsibleMemberId === member.id && summary.reviewState !== 'accepted' && <button type="button" disabled={locked} onClick={() => setSession({ selectedId: detail.request.id, management: { kind: 'withdraw', unitId: unit.id, submissionId: submission.id, expectedVersion: unit.version, reason: '', dueDate: '', confirmed: false } })}>제출 철회</button>}
              {detail.request.managerMemberId === member.id && <button type="button" disabled={locked} onClick={() => setSession({ selectedId: detail.request.id, management: { kind: 'open_correction', unitId: unit.id, submissionId: null, expectedVersion: unit.version, reason: '', dueDate: unit.correctionUntil >= date ? unit.correctionUntil : '', confirmed: false } })}>정정 기간 설정</button>}
            </div>
            {submission && !withdrawn && detail.request.reviewerMemberId === member.id && !review && (session.review?.unitId === unit.id && session.review.submissionId === submission.id ? <div className="cs-review"><p className="cs-muted">검토 대상: 제출 v{submission.revision}</p><label>검토 의견<textarea aria-label="검토 의견" maxLength={1000} value={session.review.note} disabled={blocked} onChange={event => setSession({ ...session, review: { ...session.review!, note: event.target.value } })} /></label><label>보완 기한<input type="date" min={date} value={session.review.dueDate} disabled={blocked} onChange={event => setSession({ ...session, review: { ...session.review!, dueDate: event.target.value } })} /></label><div className="cs-actions"><button type="button" disabled={blocked} onClick={() => { void mutate({ kind: 'review', requestId: detail.request.id, unitId: unit.id, submissionId: session.review!.submissionId, expectedVersion: session.review!.expectedVersion, decision: 'accepted', note: session.review!.note, dueDate: '' }) }}>검토 완료</button><button type="button" disabled={blocked || !session.review.note.trim() || !session.review.dueDate || session.review.dueDate < date} onClick={() => { void mutate({ kind: 'review', requestId: detail.request.id, unitId: unit.id, submissionId: session.review!.submissionId, expectedVersion: session.review!.expectedVersion, decision: 'changes_requested', note: session.review!.note, dueDate: session.review!.dueDate }) }}>보완 요청</button><button type="button" disabled={blocked} onClick={() => resetEditing(detail.request.id)}>검토 작성 취소</button></div></div> : <button type="button" disabled={locked} onClick={() => setSession({ selectedId: detail.request.id, review: { unitId: unit.id, submissionId: submission.id, expectedVersion: unit.version, note: '', dueDate: '' } })}>제출물 검토</button>)}
          </article>
        })}
      </section>}
      {session.management && managementUnit && detail && !restoring && <form className="cs-card" aria-label="제출 관리" onSubmit={submitManagement}>
        <h3>{managementUnit.label} · {session.management.kind === 'withdraw' ? '제출 철회 확인' : '정정 기간 설정'}</h3>
        <p>{session.management.kind === 'withdraw' ? '현재 제출의 철회를 요청합니다. 접수·검토·철회 이력은 남습니다. 처리 후 현재 제출과 완료본을 다시 확인해 주세요.' : '이 제출 단위의 정정 허용 기간을 설정합니다. 전체 수합 기한은 바뀌지 않습니다.'}</p>
        <fieldset disabled={blocked}><legend className="cs-sr-only">관리 입력</legend>
          <label>{session.management.kind === 'withdraw' ? '철회 사유' : '정정 허용 사유'}<textarea required maxLength={1000} value={session.management.reason} onChange={event => setSession({ ...session, management: { ...session.management!, reason: event.target.value, confirmed: false } })} /></label>
          {session.management.kind === 'open_correction' && <label>정정 종료일<input type="date" required min={date} value={session.management.dueDate} onChange={event => setSession({ ...session, management: { ...session.management!, dueDate: event.target.value, confirmed: false } })} /></label>}
          <label className="cs-confirmation"><input type="checkbox" checked={session.management.confirmed} onChange={event => setSession({ ...session, management: { ...session.management!, confirmed: event.target.checked } })} />대상과 처리 내용을 확인했습니다</label>
        </fieldset>
        <p className="cs-muted">처리 가능 여부와 기한은 서버에서 현재 권한·상태를 기준으로 확인합니다.</p>
        <div className="cs-actions"><button type="submit" className="cs-primary" disabled={blocked || !session.management.confirmed || !session.management.reason.trim() || (session.management.kind === 'open_correction' && (!session.management.dueDate || session.management.dueDate < date))}>{session.management.kind === 'withdraw' ? '확인한 제출 철회 요청' : '정정 기간 저장'}</button><button type="button" disabled={blocked} onClick={() => resetEditing(detail.request.id)}>관리 작성 취소</button></div>
      </form>}
      {canShowAnswer && <form className="cs-card" aria-label="제출 파일 작성" onSubmit={event => { event.preventDefault(); if (!blocked) void mutate({ kind: 'save_draft', requestId: session.answer!.requestId, unitId: session.answer!.unitId, expectedVersion: session.answer!.original?.version ?? 0, input: session.answer!.input }) }}><h3>{selectedUnit!.label} · 제출 준비</h3><p>공동 초안을 저장한 뒤 최종 제출합니다. 초안 저장만으로 제출되지는 않습니다.</p>
        <fieldset disabled={blocked}><legend className="cs-sr-only">제출 파일</legend>{picker('제출 파일 선택', { kind: 'draft', requestId: session.answer!.requestId, unitId: session.answer!.unitId, version: session.answer!.original?.version ?? 0 }, session.answer!.input.files ?? [])}
          {filesView(session.answer!.input.files ?? [], undefined, id => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, files: session.answer!.input.files?.filter(file => file.id !== id) } } }))}
          {detail!.request.textLabel && <label>{detail!.request.textLabel}<textarea aria-label={detail!.request.textLabel} value={session.answer!.input.text} required={detail!.request.textRequired} onChange={event => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, text: event.target.value } } })} /></label>}
          {detail!.request.numberLabel && <label>{detail!.request.numberLabel}<input type="number" value={session.answer!.input.number ?? ''} required={detail!.request.numberRequired} onChange={event => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, number: event.target.value === '' ? null : Number(event.target.value) } } })} /></label>}
          {hadSubmission && <label>재제출 사유<input maxLength={1000} value={session.answer!.reason} onChange={event => setSession({ ...session, answer: { ...session.answer!, reason: event.target.value } })} /></label>}
          {detail!.supplements.some(value => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId) && <label>응답할 보완 요청<select aria-label="응답할 보완 요청" value={session.answer!.correctionRequestId} onChange={event => setSession({ ...session, answer: { ...session.answer!, correctionRequestId: event.target.value } })}><option value="">보완 요청을 선택해 주세요</option>{detail!.supplements.filter(value => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId).map((value, index) => <option key={value.id} value={value.id}>보완 {index + 1} · {value.dueDate}까지</option>)}</select></label>}
        </fieldset><div className="cs-actions"><button type="submit" className="cs-primary" disabled={blocked}>제출 초안 저장</button><button type="button" disabled={blocked} onClick={() => resetEditing(session.answer!.requestId)}>작성 닫기</button>
          {session.answer!.original && selectedUnit!.responsibleMemberId === member.id && <button type="button" disabled={blocked || !same(session.answer!.input, { text: session.answer!.original.text, number: session.answer!.original.number, files: session.answer!.original.files ?? [] }) || Boolean(detail!.request.fileCollection?.required && !session.answer!.input.files?.length) || Boolean(hadSubmission && !session.answer!.reason.trim()) || Boolean(detail!.supplements.some(value => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId) && !session.answer!.correctionRequestId)} onClick={() => { void mutate({ kind: 'submit', requestId: session.answer!.requestId, unitId: session.answer!.unitId, draftId: session.answer!.original!.id, expectedDraftVersion: session.answer!.original!.version, expectedVersion: selectedUnit!.version, reason: session.answer!.reason, ...(session.answer!.correctionRequestId ? { correctionRequestId: session.answer!.correctionRequestId } : {}) }) }}>{hadSubmission ? '저장한 파일 다시 제출' : '저장한 파일 최종 제출'}</button>}
        </div><p className="cs-muted">최종 제출은 책임 교사만 할 수 있습니다. 서버에서 권한과 최신 버전을 다시 확인합니다.</p>
      </form>}
      {!session.editor && !selectedId && !loading && list && <><div className="cs-list" aria-label="수합 목록">{list.items.length ? list.items.map(request => <button type="button" className="cs-list-item" key={request.id} disabled={locked} onClick={() => { setSession({ selectedId: request.id }); setError(''); setNotice('') }}><strong>{request.title}</strong><span>{request.dueDate}까지 · {request.status === 'draft' ? '초안' : '공개'}</span></button>) : <p className="cs-empty">현재 볼 수 있는 수합이 없습니다.</p>}</div><nav className="cs-actions" aria-label="수합 목록 페이지"><button type="button" disabled={locked || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(history.slice(0, -1)) }}>이전 페이지</button><span>{history.length + 1}쪽</span><button type="button" disabled={locked || !list.nextCursor} onClick={() => { setHistory([...history, cursor]); setCursor(list.nextCursor!) }}>다음 페이지</button></nav></>}
    </>}
  </section>
}
