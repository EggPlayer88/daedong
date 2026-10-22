import type { GeneratedDocument } from '../documents/guided-contracts'
import { CollectionOperations } from './CollectionOperations'
import type { CollectionOperationsServer, CollectionOperationsState } from './operations'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { FileError, type FilePolicy, type FileReference } from '../files/contracts'
import { formatFileBytes } from '../files/FileControls'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { validateFileMetadata } from '../files/validation'
import { requestBlobDownload } from '../files/download'
import type { AnswerInput, CollectionDraft, CollectionInput, CollectionRequest } from '../workflows/types'
import { CollectionServerError, type CollectionServer, type CollectionCommand, type CollectionDetail, type CollectionFileParent, type CollectionList, type CollectionReadiness, type CollectionUpload } from './contracts'
import { CollectionUnitsEditor } from './CollectionUnitsEditor'
import { AnswerInputComparison, CollectionInputComparison } from './CollectionInputComparison'
import { collectionUnitMemberOptions, validateCollectionUnitInputs } from './unit-inputs'
import { CollectionSubmissionHistory } from './CollectionSubmissionHistory'
import { CollectionServerExport } from './CollectionServerExport'
import { formatCollectionRecordedTime, summarizeCollectionSubmission } from './submission-summary'
import { collectionSubmissionGuidance } from './submission-guidance'
import { CollectionSubmissionGuide } from './CollectionSubmissionGuide'
import { CollectionUnitWorkbench } from './CollectionUnitWorkbench'
import { stageTemplates, type StagedTemplate } from './template-staging'
import styles from './collection-server.css?inline'

export interface CollectionServerPanelProps { server: CollectionServer; operations?: CollectionOperationsServer; incomingFile?: GeneratedDocument; onIncomingFileConsumed?: () => void; member: Membership; members: Membership[]; date: string; revision?: number; openRequest?: { key: string; id: string }; onNavigationLockChange?: (locked: boolean) => void }
type Editor = { original?: CollectionRequest; input: CollectionInput; staged?: StagedTemplate[]; saving?: boolean; createdId?: string; createdVersion?: number }
type Answer = { requestId: string; unitId: string; original: CollectionDraft | null; input: AnswerInput; reason: string; correctionRequestId: string; confirmedVersion?: number; confirmedInput?: AnswerInput }
type Upload = { stagedId?: string; file: File; parent: CollectionFileParent; policy: FilePolicy; prepareKey: string; completeKey: string; intent?: CollectionUpload; phase: 'prepare' | 'upload' | 'complete' | 'status'; rejected?: boolean; cancelable?: boolean }
type Review = { unitId: string; submissionId: string; expectedVersion: number; note: string; dueDate: string }
type Management = { kind: 'withdraw' | 'open_correction'; unitId: string; submissionId: string | null; expectedVersion: number; reason: string; dueDate: string; confirmed: boolean }
type Session = { selectedId?: string; editor?: Editor; answer?: Answer; upload?: Upload; review?: Review; management?: Management; conflict?: boolean; parked?: boolean; recoveryConflict?: boolean }
type FocusTarget = { name: string; key?: string; field?: number; start?: number | null; end?: number | null }
const blank = (): CollectionInput => ({ title: '', instructions: '', dueDate: '', reviewMode: 'none', reviewerMemberId: '', textLabel: '', textRequired: false, numberLabel: '', numberRequired: false, units: [] })
const inputOf = ({ title, instructions, dueDate, reviewMode, reviewerMemberId, textLabel, textRequired, numberLabel, numberRequired, units, fileCollection }: CollectionRequest): CollectionInput => ({ title, instructions, dueDate, reviewMode, reviewerMemberId, textLabel, textRequired, numberLabel, numberRequired, units, fileCollection })
const knownRejection = (failure: unknown) => failure instanceof CollectionServerError && ['INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'CONFLICT', 'FILE_NOT_READY', 'FILE_FAILED'].includes(failure.code)
const accessDenied = (failure: unknown) => failure instanceof CollectionServerError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(failure.code)
const failureMessage = (failure: unknown) => failure instanceof FileError ? failure.message : failure instanceof CollectionServerError && failure.code === 'NOT_READY' ? '현재 파일 확인 연결을 준비 중이거나 요청이 많습니다. 입력과 기존 요청 번호를 보관했습니다. 잠시 뒤 다시 확인해 주세요.' : failure instanceof CollectionServerError && failure.code === 'IDEMPOTENCY_CONFLICT' ? '저장 요청이 서버의 기존 기록과 일치하지 않습니다. 입력과 요청 번호는 보관했습니다. 새 요청으로 다시 저장하지 말고 관리자에게 확인해 주세요.' : failure instanceof CollectionServerError && failure.code === 'CONFLICT' ? '다른 곳에서 먼저 변경했습니다. 내 입력은 유지했습니다. 최신 원본을 다시 확인한 뒤 편집해 주세요.' : knownRejection(failure) ? '서버가 이 작업을 허용하지 않았습니다. 현재 권한, 기한, 파일과 입력을 확인해 주세요. 입력은 유지했습니다.' : '처리 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다. 같은 요청으로 다시 확인해 주세요.'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const layoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// 소속이 실제로 바뀌면 이전 화면을 첫 렌더부터 제거한다. 일시적인 연결 오류의 복구는 상위 메모리가 맡는다.
export function CollectionServerPanel(props: CollectionServerPanelProps) { return <CollectionScope key={recoveryScope(props.member)} {...props} /> }

function CollectionScope({ server, operations, incomingFile, onIncomingFileConsumed, member, members, date, revision = 0, openRequest, onNavigationLockChange }: CollectionServerPanelProps) {
  const memory = useEditDraft<Session>(member, 'collection-editor'), recovery = usePendingRequest(member, 'collection')
  const operationsRecovery = usePendingRequest(member, 'collectionOps')
  const [session, setSessionState] = useState<Session>(() => memory.initial ?? {})
  const sessionRef = useRef(session), life = useRef(0), operation = useRef(false)
  const panelRef = useRef<HTMLElement>(null), focusTarget = useRef<FocusTarget>(), pickerId = useId()
  const focusNext = (name: string, key?: string) => { focusTarget.current = { name, key } }
  const [readiness, setReadiness] = useState<CollectionReadiness>(), [storedList, setStoredList] = useState<{ cursor?: string; value: CollectionList }>(), [storedDetail, setDetail] = useState<CollectionDetail>()
  const [cursor, setCursor] = useState<string>(), [history, setHistory] = useState<(string | undefined)[]>([])
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [restoring, setRestoring] = useState(false)
  const [readError, setReadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('')
  const [comparison, setComparison] = useState<{ detail: CollectionDetail; draft?: CollectionDraft | null }>()
  const [exportBusy, setExportBusy] = useState(false)
  const [operationState, setOperationState] = useState<CollectionOperationsState>()
  const [operationsLocked, setOperationsLocked] = useState(false)
  const operationRequest = operationsRecovery.request?.command as { requestId?: string } | undefined
  const pending = recovery.request, selectedId = session.selectedId ?? (pending?.command.kind !== 'create' ? pending?.command.requestId : undefined) ?? operationRequest?.requestId
  // 같은 자료의 재조회에서는 화면을 유지한다. 다른 페이지·수합에는 이전 결과를 표시하지 않는다.
  const list = storedList?.cursor === cursor ? storedList?.value : undefined
  const detail = storedDetail?.request.id === selectedId ? storedDetail : undefined
  const setList = (value?: CollectionList) => setStoredList(value ? { cursor, value } : undefined)
  useEffect(() => { if (operationsLocked && selectedId) memory.save({ ...sessionRef.current, selectedId }, false) }, [operationsLocked, selectedId])
  const enabled = activeAt(member, date)
  const dirty = Boolean(operationsLocked || operationsRecovery.request || session.editor || session.answer || session.upload || session.review || session.management || session.conflict)
  const parked = Boolean(session.parked)
  const hasWork = Boolean(pending || dirty)
  const locked = Boolean(busy || loading || restoring || exportBusy || (!parked && hasWork))
  const inputBlocked = Boolean(busy || session.editor?.saving || pending || session.upload || session.conflict || session.answer?.confirmedVersion || exportBusy || parked || !readiness?.available)
  const blocked = inputBlocked || loading || restoring || Boolean(readError)
  const submissionClosed = operationState?.requestId === detail?.request.id && operationState?.phase !== 'open'
  const selectedUnit = detail?.units.find(unit => unit.id === session.answer?.unitId)
  const policy = readiness?.policy
  let newCollectionPolicy: FilePolicy | undefined
  if (policy) { try { newCollectionPolicy = hwpxCollectionPolicy(policy) } catch { /* 기존 기록은 표시하고 새 파일 선택만 닫는다. */ } }
  function setSession(value: Session) { sessionRef.current = value; memory.save(value, Boolean(value.editor || value.answer || value.upload || value.review || value.management || value.conflict)); setSessionState(value) }
  function resetEditing(selected?: string) { setSession({ selectedId: selected }); setError(''); setComparison(undefined) }
  function hideDenied() { focusTarget.current = undefined; memory.remove(); sessionRef.current = {}; setSessionState({}); setDetail(undefined); setList(undefined); setReadiness(undefined); setComparison(undefined); setReadError('현재 자료의 접근 권한을 확인할 수 없어 이전 화면을 닫았습니다. 연결을 다시 확인해 주세요.') }
  const stillHere = (epoch: number) => life.current === epoch
  const openedRequest = useRef<string>()
  useEffect(() => {
    if (!openRequest || openedRequest.current === openRequest.key || hasWork || busy || exportBusy) return
    openedRequest.current = openRequest.key
    focusNext('detail'); setSession({ selectedId: openRequest.id }); setError(''); setNotice('')
  }, [openRequest?.key, hasWork, busy, exportBusy])

  useEffect(() => { return () => { life.current++; operation.current = false } }, [server])
  layoutEffect(() => { onNavigationLockChange?.(locked); return () => onNavigationLockChange?.(false) }, [locked, onNavigationLockChange])
  // 사용자가 연 화면만 이동한다. 재조회 중 사라진 입력은 같은 폼이 돌아올 때 복원한다.
  function captureInputFocus() {
    if (focusTarget.current || !panelRef.current) return
    const root = panelRef.current.getRootNode() as Document | ShadowRoot
    const active = root.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const form = active?.closest<HTMLFormElement>('form[data-cs-form]')
    if (!active || !form || !panelRef.current.contains(form)) return
    const fields = [...form.querySelectorAll('input,textarea,select')]
    const field = fields.indexOf(active)
    if (field < 0) return
    focusTarget.current = { name: 'restore-input', key: form.dataset.csForm, field, start: active.selectionStart, end: active.selectionEnd }
  }
  layoutEffect(() => {
    const target = focusTarget.current, panel = panelRef.current
    if (!target || !panel || busy || restoring || loading || parked) return
    let node: HTMLElement | undefined
    if (target.name === 'restore-input') {
      const active = (panel.getRootNode() as Document | ShadowRoot).activeElement
      // 조회를 기다리는 동안 사용자가 다른 곳으로 옮긴 초점은 되돌리지 않는다.
      if (active && active !== document.body && active !== document.documentElement) { focusTarget.current = undefined; return }
      const form = [...panel.querySelectorAll<HTMLFormElement>('form[data-cs-form]')].find(item => item.dataset.csForm === target.key)
      node = form?.querySelectorAll<HTMLElement>('input,textarea,select')[target.field ?? -1]
    } else node = [...panel.querySelectorAll<HTMLElement>('[data-cs-focus]')].find(item => item.dataset.csFocus === target.name && (!target.key || item.dataset.csKey === target.key))
    if (!node || node.matches(':disabled')) return
    focusTarget.current = undefined
    node.focus({ preventScroll: true })
    if (target.name === 'restore-input') {
      if (typeof target.start === 'number' && typeof target.end === 'number' && (node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && ['text', 'search', 'tel', 'url', 'password'].includes(node.type)))) node.setSelectionRange(target.start, target.end)
    } else node.scrollIntoView({ block: ['editor', 'answer', 'detail', 'management', 'review'].includes(target.name) ? 'start' : 'nearest' })
  })

  useEffect(() => {
    if (!hasWork && !busy && !exportBusy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [hasWork, busy, exportBusy])
  useEffect(() => {
    let current = true
    setLoading(true); setReadError('')
    if (!enabled) { setList(undefined); setReadiness(undefined); setLoading(false); setReadError('현재 이용 가능한 학교 소속이 아닙니다.'); return }
    // 쓰기 준비 상태와 기존 자료의 읽기는 독립적이다. 확인 API가 없어도 R1 읽기는 유지한다.
    void Promise.allSettled([server.readiness(member.id), server.list(member.id, cursor)]).then(([ready, result]) => {
      if (!current) return
      setReadiness(ready.status === 'fulfilled' ? ready.value : undefined)
      if (result.status === 'fulfilled') setList(result.value)
      else { setList(undefined); if (accessDenied(result.reason)) hideDenied(); setReadError('수합 목록을 확인하지 못했습니다. 빈 목록으로 판단하지 않습니다. 다시 확인해 주세요.') }
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [server, member.id, enabled, cursor, reload, revision])
  useEffect(() => {
    let current = true
    captureInputFocus()
    if (!selectedId || !enabled || parked) { setDetail(undefined); setRestoring(false); return }
    setRestoring(true); setReadError('')
    void server.detail(member.id, selectedId).then(async value => {
      // 보관한 공동 초안은 현재 읽기 권한까지 다시 확인한 뒤 표시한다. 원래 버전은 유지한다.
      const answer = sessionRef.current.answer
      const latestDraft = answer ? await server.draft(member.id, selectedId, answer.unitId) : undefined
      if (!current) return
      setDetail(value)
      const editor = sessionRef.current.editor
      if (editor?.createdId === value.request.id && !editor.original) {
        const changed = value.request.version !== editor.createdVersion
        const original = { ...value.request, ...structuredClone(editor.input), version: editor.createdVersion! }
        setSession({ ...sessionRef.current, conflict: changed, editor: { ...editor, original, saving: changed ? false : editor.saving } })
        if (changed) { setComparison({ detail: value }); setError('초안을 만드는 동안 다른 변경이 확인되었습니다. 입력을 비교한 뒤 이어 저장해 주세요.') }
      }
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
        if (latestDraft?.version === answer.confirmedVersion) setSession({ ...sessionRef.current, answer: { ...answer, original: latestDraft, input: { text: latestDraft.text, number: latestDraft.number, files: latestDraft.files ?? [] }, confirmedVersion: undefined, confirmedInput: undefined } })
        else { setSession({ ...sessionRef.current, conflict: true, answer: { ...answer, confirmedVersion: undefined } }); setComparison({ detail: value, draft: latestDraft }); setError('초안 저장 뒤 다른 변경이 확인되었습니다. 최신 내용과 내 입력을 비교해 주세요.') }
      }
    }).catch(failure => {
      if (!current) return
      setDetail(undefined)
      if (accessDenied(failure) && !recovery.request) hideDenied()
      setReadError('수합 원본의 접근 권한과 최신 상태를 확인하지 못했습니다. 보관한 입력은 확인 전까지 표시하지 않습니다.')
    }).finally(() => { if (current) setRestoring(false) })
    return () => { current = false }
  }, [server, member.id, selectedId, enabled, parked, reload, revision])

  async function mutate(command: CollectionCommand, key: string = crypto.randomUUID()) {
    const saved = recovery.request
    const retry = Boolean(saved && saved.key === key && same(saved.command, command))
    // 미확정 명령만 준비 해제 중에도 같은 키/본문으로 재확인한다. 새 명령으로 대체하지 않는다.
    if (operation.current || !enabled || sessionRef.current.parked || (saved && !retry) || (!retry && (loading || restoring || readError || !readiness?.available))) return
    const request = structuredClone(retry ? saved! : { command, key }), epoch = life.current
    operation.current = true; recovery.put(request); setBusy('서버에 저장 중…'); setError(''); setNotice('')
    try {
      const receipt = await server.mutate(member.id, request.command, request.key)
      if (!stillHere(epoch)) return
      recovery.remove(key)
      // 접수 확인 이후 조회가 실패하더라도 이미 확인된 저장을 다시 실행하지 않는다.
      if (request.command.kind === 'create' && sessionRef.current.editor?.saving) {
        // 생성 접수증을 먼저 보존한다. 뒤의 조회·파일 검사가 실패해도 새 수합을 만들지 않는다.
        setSession({ ...sessionRef.current, selectedId: receipt.requestId, editor: { ...sessionRef.current.editor, createdId: receipt.requestId, createdVersion: receipt.resourceVersion } })
      } else if (request.command.kind === 'save_draft' && sessionRef.current.answer?.unitId === request.command.unitId) {
        // 재제출 사유는 유지하고, 접수 뒤 경합은 방금 저장한 원문을 기준으로 비교한다.
        focusNext('answer')
        setSession({ ...sessionRef.current, recoveryConflict: undefined, answer: { ...sessionRef.current.answer, confirmedVersion: receipt.resourceVersion, confirmedInput: structuredClone(request.command.input) } }); setError('')
      } else { focusNext('detail'); resetEditing(receipt.requestId) }
      const message = request.command.kind === 'save_draft' ? '초안을 저장했습니다. 최종 제출은 아직 하지 않았습니다.' : request.command.kind === 'submit' ? '최종 제출을 접수했습니다. 아래 제출 현황에서 검토 상태를 확인해 주세요.' : request.command.kind === 'create' ? (sessionRef.current.editor?.saving ? '수합 초안을 만들었습니다. 선택한 양식의 검사와 저장을 이어갑니다.' : '수합 초안을 저장했습니다. 내용을 확인한 뒤 대상 교사에게 공개해 주세요.') : request.command.kind === 'update' ? '수합 초안 변경을 저장했습니다.' : request.command.kind === 'publish' ? '대상 교사에게 수합을 공개했습니다.' : request.command.kind === 'review' ? '검토 결과를 저장했습니다.' : request.command.kind === 'withdraw' ? '제출 철회를 처리했습니다.' : '정정 기간을 저장했습니다.'
      setNotice(`${message} 접수 시각 ${formatCollectionRecordedTime(receipt.recordedAt)} (한국 표준시)`); setReload(value => value + 1)
    } catch (failure) {
      if (!stillHere(epoch)) return
      // 준비 해제는 복구를 기다릴 수 있다. 원래 요청을 보존해 새 키로 중복 저장하지 않는다.
      const retryNotReady = retry && failure instanceof CollectionServerError && failure.code === 'NOT_READY'
      if (knownRejection(failure) && !retryNotReady) {
        recovery.remove(key)
        const current = sessionRef.current
        if (current.editor) setSession({ ...current, editor: { ...current.editor, saving: false } })
      }
      if (failure instanceof CollectionServerError && failure.code === 'IDEMPOTENCY_CONFLICT') setSession({ ...sessionRef.current, recoveryConflict: true })
      if (accessDenied(failure)) hideDenied()
      else if (failure instanceof CollectionServerError && failure.code === 'CONFLICT') { setSession({ ...sessionRef.current, conflict: true }); setComparison(undefined) }
      setError(retryNotReady ? '서버가 아직 이 요청을 처리할 준비가 되지 않았습니다. 입력과 기존 요청 번호를 보관했습니다. 준비가 돌아오면 같은 요청으로 다시 확인해 주세요.' : failureMessage(failure))
    } finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  function parkEditing() {
    if (operation.current || busy || exportBusy || !hasWork) return
    focusTarget.current = undefined; setSession({ ...sessionRef.current, parked: true }); setComparison(undefined); setError(''); setNotice('')
  }
  function resumeEditing() {
    if (operation.current || busy || exportBusy) return
    setDetail(undefined); setComparison(undefined); setSession({ ...sessionRef.current, parked: false }); setError(''); setNotice(''); setReload(value => value + 1)
  }
  async function openAnswer(unitId: string) {
    if (locked || !detail) return
    const epoch = life.current; operation.current = true; setBusy('공동 초안을 확인 중…'); setError('')
    try {
      const draft = await server.draft(member.id, detail.request.id, unitId)
      if (stillHere(epoch)) { focusNext('answer'); setSession({ selectedId: detail.request.id, answer: { requestId: detail.request.id, unitId, original: draft, input: { text: draft?.text ?? '', number: draft?.number ?? null, files: draft?.files ?? [] }, reason: '', correctionRequestId: '' } }) }
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
    operation.current = true; setBusy('HWPX 파일을 확인 중…'); setError('')
    let job = initial
    const keep = (next: Upload) => { job = next; if (stillHere(epoch)) setSession({ ...sessionRef.current, upload: next, editor: next.rejected && sessionRef.current.editor ? { ...sessionRef.current.editor, saving: false } : sessionRef.current.editor }) }
    try {
      if (!job.intent) {
        const intent = await server.prepareUpload(member.id, job.parent, job.file, job.policy, job.prepareKey)
        if (!stillHere(epoch)) return
        keep({ ...job, intent, phase: intent.state === 'awaiting_upload' ? 'upload' : intent.state === 'pending_verification' ? 'complete' : 'status' })
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
          setSession({ ...current, upload: undefined, editor: { ...current.editor, input: { ...current.editor.input, fileCollection: { ...fileCollection, templates: [...fileCollection.templates.filter(file => file.id !== ref.id), ref] } }, staged: current.editor.staged?.filter(value => value.id !== job.stagedId) } })
        } else if (job.parent.kind === 'draft' && current.answer?.unitId === job.parent.unitId) {
          setSession({ ...current, upload: undefined, answer: { ...current.answer, input: { ...current.answer.input, files: [...(current.answer.input.files ?? []).filter(file => file.id !== ref.id), ref] } } })
        } else throw new CollectionServerError('CONFLICT', '파일을 연결할 입력이 바뀌었습니다.')
        setNotice(job.stagedId ? '양식 검사를 통과했습니다. 남은 파일과 초안 저장을 이어갑니다.' : '파일 준비가 완료되었습니다. 아래 저장 버튼을 눌러 문서에 연결해 주세요. 아직 최종 제출된 상태는 아닙니다.')
      } else {
        keep({ ...job, phase: status.state === 'awaiting_upload' ? 'upload' : status.state === 'pending_verification' ? 'complete' : 'status', rejected: status.state === 'rejected', cancelable: true })
        setNotice(status.state === 'rejected' ? '서버가 파일을 거부했습니다. 다른 파일을 선택해 주세요.' : status.state === 'awaiting_upload' ? '파일 전송이 아직 확인되지 않았습니다. 같은 파일을 다시 전송할 수 있습니다.' : '서버에서 HWPX 파일의 기본 형식을 확인하고 있습니다. 잠시 뒤 같은 파일 상태 다시 확인을 눌러 주세요. 완료된 파일만 저장·제출할 수 있습니다.')
      }
    } catch (failure) { if (stillHere(epoch)) { if (accessDenied(failure)) hideDenied(); else if (knownRejection(failure) || failure instanceof FileError) keep({ ...job, rejected: true, cancelable: true }); setError(failureMessage(failure)) } }
    finally { if (stillHere(epoch)) { operation.current = false; setBusy('') } }
  }
  function chooseFile(file: File | undefined, parent: CollectionFileParent, existing: FileReference[], filePolicy: FilePolicy, stagedId?: string) {
    if (!file || (blocked && !stagedId)) return
    let checkedPolicy: FilePolicy
    try {
      checkedPolicy = hwpxCollectionPolicy(filePolicy)
      validateFileMetadata(file, checkedPolicy)
    } catch (failure) { pauseTemplateSave(); setError(failure instanceof FileError && failure.code === 'FILE_TYPE_UNSUPPORTED' ? 'HWPX 파일만 새로 올릴 수 있습니다. 한글에서 HWPX 형식으로 저장해 주세요.' : failureMessage(failure)); return }
    if (existing.length >= checkedPolicy.maxFiles) { pauseTemplateSave(); setError(`파일은 최대 ${checkedPolicy.maxFiles}개입니다. 기존 파일을 제거한 뒤 선택해 주세요.`); return }
    const job: Upload = { stagedId, file, parent, policy: checkedPolicy, prepareKey: crypto.randomUUID(), completeKey: crypto.randomUUID(), phase: 'prepare' }
    setSession({ ...sessionRef.current, upload: job }); void uploadFile(job); return true
  }
  function pauseTemplateSave() {
    const current = sessionRef.current
    if (current.editor?.saving) setSession({ ...current, editor: { ...current.editor, saving: false } })
  }
  function selectTemplates(files: File[]) {
    const current = sessionRef.current, editor = current.editor
    if (blocked || !editor?.input.fileCollection || !files.length) return
    try {
      const staged = stageTemplates(editor.staged ?? [], files, editor.input.fileCollection.policy, editor.input.fileCollection.templates.length)
      setSession({ ...current, editor: { ...editor, staged } }); setError(''); setNotice('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '파일 선택을 확인해 주세요.') }
  }
  function saveEditor(event: FormEvent) {
    event.preventDefault()
    const current = sessionRef.current, editor = current.editor
    if (operation.current || blocked || !editor || !unitValidation?.valid) return
    if (editor.staged?.length) {
      setSession({ ...current, editor: { ...editor, saving: true } }); setError(''); setNotice('')
    } else void mutate(editor.original ? { kind: 'update', requestId: editor.original.id, expectedVersion: editor.original.version, input: editor.input } : { kind: 'create', input: editor.input })
  }
  // 한 번 누른 저장을 단계별로 진행한다. 미확정 요청·파일 검사는 사용자 재확인 전까지 멈춘다.
  useEffect(() => {
    // 외부 요청 저장소의 동기 알림 뒤 늦게 실행되는 이전 렌더는 다음 단계를 시작하지 않는다.
    if (sessionRef.current !== session) return
    const editor = session.editor
    if (!editor?.saving || operation.current || busy || loading || restoring || readError || pending || session.upload || session.conflict || parked || !enabled || !readiness?.available) return
    if (!editor.original) {
      if (!editor.createdId) void mutate({ kind: 'create', input: editor.input })
      return
    }
    if (detail?.request.id !== editor.original.id) return
    const next = editor.staged?.[0], collection = editor.input.fileCollection
    if (next && collection) chooseFile(next.file, { kind: 'template', requestId: editor.original.id, version: editor.original.version }, collection.templates, collection.policy, next.id)
    else void mutate({ kind: 'update', requestId: editor.original.id, expectedVersion: editor.original.version, input: editor.input })
  }, [session, busy, loading, restoring, readError, pending, parked, enabled, readiness, detail])
  function attachGenerated() {
    const answer = sessionRef.current.answer
    if (submissionClosed || !incomingFile || !answer || incomingFile.requestId !== answer.requestId || detail?.request.id !== answer.requestId || !detail.request.fileCollection) return
    const file = new File([incomingFile.blob], incomingFile.fileName, {type:'application/hwp+zip'})
    // 생성 결과도 수합 파일 예약·업로드·확인을 새로 거친다. 문서함 ID를 제출 ID로 재사용하지 않는다.
    if (chooseFile(file, {kind:'draft',requestId:answer.requestId,unitId:answer.unitId,version:answer.original?.version ?? 0},answer.input.files ?? [],detail.request.fileCollection.policy)) onIncomingFileConsumed?.()
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
  const canShowEditor = session.editor && (!session.editor.original || detail?.request.id === session.editor.original.id)
  const canShowAnswer = session.answer && detail?.request.id === session.answer.requestId && selectedUnit
  const hadSubmission = Boolean(selectedUnit && detail?.submissions.some(value => value.unitId === selectedUnit.id))
  const submissionGuide = session.answer && detail && selectedUnit ? collectionSubmissionGuidance({
    input: session.answer.input, saved: session.answer.original, requiredFiles: Boolean(detail.request.fileCollection?.required),
    textLabel: detail.request.textLabel, textRequired: detail.request.textRequired,
    numberLabel: detail.request.numberLabel, numberRequired: detail.request.numberRequired,
    responsible: selectedUnit.responsibleMemberId === member.id, hadSubmission, reason: session.answer.reason,
    needsSupplement: detail.supplements.some(value => value.unitId === selectedUnit.id && !value.fulfilledSubmissionId),
    correctionRequestId: session.answer.correctionRequestId, pendingFile: Boolean(session.upload),
  }) : undefined
  const action = session.management ?? session.review
  const comparisonUnit = comparison?.detail.units.find(value => value.id === action?.unitId)
  const actionTargetChanged = Boolean(action?.submissionId && comparisonUnit?.currentSubmissionId !== action.submissionId)
  const actionReviews = comparison?.detail.reviews.filter(value => value.submissionId === action?.submissionId) ?? []
  const canRetainAction = !action || Boolean(comparisonUnit && !actionTargetChanged && (session.management?.kind === 'open_correction' ? comparison?.detail.request.managerMemberId === member.id : session.management ? comparisonUnit.responsibleMemberId === member.id && !actionReviews.some(value => value.decision === 'accepted') : comparison?.detail.request.reviewerMemberId === member.id && !actionReviews.length))
  function retainComparedInput(resolved?: { editor?: CollectionInput; answer?: AnswerInput }) {
    if (!comparison || !canRetainAction) return
    setDetail(comparison.detail)
    setSession({ ...session, conflict: false,
      editor: session.editor ? { ...session.editor, original: comparison.detail.request, input: resolved?.editor ?? session.editor.input } : undefined,
      answer: session.answer ? { ...session.answer, original: comparison.draft ?? null, input: resolved?.answer ?? session.answer.input, confirmedInput: undefined } : undefined,
      review: session.review && comparisonUnit ? { ...session.review, expectedVersion: comparisonUnit.version } : undefined,
      management: session.management && comparisonUnit ? { ...session.management, expectedVersion: comparisonUnit.version, confirmed: false } : undefined,
    })
    setComparison(undefined); setError(''); setNotice('최신 변경과 내 입력을 반영했습니다. 내용을 검토한 뒤 저장해 주세요.')
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
  function filesView(files: FileReference[], parent?: CollectionFileParent, remove?: (id: string) => void, downloadable?: string[]) {
    return <ul className="cs-files">{files.map(file => <li key={file.id}><span>{file.name} <small>{formatFileBytes(file.bytes)}</small></span><div>{parent && (!downloadable || downloadable.includes(file.id)) && <button type="button" disabled={!!busy || exportBusy} aria-label={`${file.name} 다운로드`} onClick={() => { void download(parent, file) }}>내려받기</button>}{remove && <button type="button" disabled={blocked} onClick={() => remove(file.id)} aria-label={`${file.name} 제거`}>제거</button>}</div></li>)}</ul>
  }
  function picker(label: string, parent: CollectionFileParent, files: FileReference[]) {
    const originalPolicy = parent.kind === 'template' ? session.editor?.input.fileCollection?.policy : detail?.request.fileCollection?.policy
    if (!originalPolicy) return null
    let filePolicy: FilePolicy
    try { filePolicy = hwpxCollectionPolicy(originalPolicy) }
    catch { return <p className="cs-warning">이 수합의 파일 규칙에는 HWPX가 포함되어 있지 않습니다. 담당자가 규칙을 변경한 뒤 새 파일을 올릴 수 있습니다. 기존 파일은 그대로 내려받을 수 있습니다.</p> }
    const descriptionId = `${pickerId}-${parent.kind}-file-rule`
    return <label className="cs-file-picker">{label}<input type="file" aria-label={label} aria-describedby={descriptionId} disabled={blocked || parent.kind === 'draft' && submissionClosed || files.length >= filePolicy.maxFiles} accept=".hwpx" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; chooseFile(file, parent, files, filePolicy) }} /><small id={descriptionId}>HWPX · 파일당 {formatFileBytes(filePolicy.maxFileBytes)} · 첨부 {files.length}/{filePolicy.maxFiles}개{files.length >= filePolicy.maxFiles ? ' · 다른 파일을 올리려면 기존 첨부 선택을 먼저 제거해 주세요.' : ' · 한글에서 HWPX 형식으로 저장한 파일을 선택하세요.'}</small></label>
  }
  return <section ref={panelRef} className="collection-server" aria-label="서버 문서 수합"><style>{styles}</style>
    <header className="cs-heading"><div><p>학교 업무</p><h2>문서 수합</h2><span>HWPX 양식을 나누고 작성한 파일을 모읍니다.</span></div>{readiness?.available && !parked && <div className="cs-actions"><button type="button" disabled={!!busy || !!pending || loading || exportBusy} onClick={() => setReload(value => value + 1)}>새로 확인</button><button type="button" className="cs-primary" data-cs-focus="create-button" disabled={locked || loading || !newCollectionPolicy} onClick={() => { if (!newCollectionPolicy) return; focusNext('editor'); setSession({ editor: { staged: [], input: { ...blank(), fileCollection: { policy: newCollectionPolicy, required: true, templates: [] } } } }); setError(''); setNotice('') }}>새 수합 만들기</button></div>}</header>
    {readiness?.available && !parked && !newCollectionPolicy && <p className="cs-warning">HWPX 수합 규칙을 먼저 연결해야 새 수합을 만들 수 있습니다. 기존 기록은 확인할 수 있습니다.</p>}
    {busy && <p role="status">{busy}</p>}{notice && <p className="cs-notice" role="status">{notice}</p>}{error && <p className="cs-error" role="alert">{error}</p>}
    {parked && <section className="cs-notice" aria-label="보관한 수합 작업"><h3>작성 중인 수합 작업을 보관했습니다</h3><p>업무실 안의 다른 메뉴를 이용할 수 있습니다. 자료 수합으로 돌아와 보관한 입력{pending ? '과 기존 요청 번호로 결과를' : '을'} 다시 확인해 주세요.</p><p>새로고침·탭 닫기·로그아웃·학교 변경 시 보관 내용이 사라질 수 있습니다. 이 보관은 서버 저장이 아닙니다.</p><button type="button" disabled={!!busy || exportBusy} onClick={resumeEditing}>보관한 입력과 요청 다시 열기</button></section>}
    {pending && !parked && <section className="cs-warning" aria-label="수합 저장 결과 확인"><h3>이전 저장 결과 확인이 필요합니다</h3><p>같은 내용과 요청 번호로 다시 확인합니다. 결과를 확인하기 전에는 새 저장을 하지 않습니다. 서버 준비가 해제돼도 이전 요청의 결과는 다시 확인할 수 있습니다.</p>{session.recoveryConflict && <p role="alert">기존 요청 기록과 일치하지 않아 자동으로 새 요청을 만들지 않습니다. 보관한 상태로 관리자에게 확인해 주세요.</p>}<button type="button" disabled={!!busy || !enabled} onClick={() => { void mutate(pending.command, pending.key) }}>이전 요청 그대로 다시 확인</button></section>}
    {!parked && hasWork && (pending || !readiness?.available) && <section className="cs-warning" aria-label="수합 입력 임시 보관"><p>지금 확인하기 어렵다면 입력과 기존 요청 번호를 이 탭에 보관하고 업무실 안의 다른 메뉴를 이용할 수 있습니다. 새로고침하면 보관 내용이 사라집니다.</p><button type="button" disabled={!!busy || exportBusy} onClick={parkEditing}>입력 보관하고 다른 메뉴 이용</button></section>}
    {readError && <section className="cs-error" role="alert"><p>{readError}</p><button type="button" disabled={!!busy} onClick={() => setReload(value => value + 1)}>연결과 원본 다시 확인</button></section>}
    {loading && <p className={list || detail || session.editor ? "cs-sr-only" : undefined} role="status">수합 연결과 목록을 확인 중…</p>}
    {!loading && !readiness?.available && <section className="cs-empty"><h3>문서 수합 연결 준비가 필요합니다</h3><p>HWPX 전용 수합 연결을 준비 중입니다.</p><p>{!readiness ? '현재 연결을 확인하지 못해 원인을 확정할 수 없습니다.' : readiness.reason === 'database_missing' ? '문서 수합용 DB 함수가 아직 준비되지 않았습니다.' : readiness?.reason === 'storage_missing' ? '문서 수합용 파일 저장소 연결이 아직 준비되지 않았습니다.' : readiness?.reason === 'verification_missing' ? 'HWPX 파일의 기본 확인 기능이 아직 연결되지 않았습니다.' : '학교의 파일 허용 정책을 먼저 설정해야 합니다.'}</p><p>새 등록·업로드·제출은 준비 후 이용할 수 있습니다. 기존 자료는 현재 읽기 권한에 따라 조회하고 내려받을 수 있습니다.</p><button type="button" onClick={() => setReload(value => value + 1)}>준비 상태 다시 확인</button></section>}
    {!parked && (!readiness?.available || (readError && !detail && !restoring)) && dirty && !pending && (!session.upload || session.upload.cancelable || session.upload.rejected) && <button type="button" disabled={!!busy} onClick={() => { resetEditing(); setNotice('보관한 입력을 버렸습니다. 다른 메뉴로 이동할 수 있습니다.') }}>입력 버리고 닫기</button>}
    {enabled && !parked && <>
      {session.conflict && <section className="cs-warning" aria-label="수합 변경 충돌">
        <h3>최신 내용과 내 입력을 비교해 주세요</h3>
        {comparison ? <>
          {session.editor?.original ? <CollectionInputComparison base={inputOf(session.editor.original)} latest={inputOf(comparison.detail.request)} mine={session.editor.input} members={members.filter(person => person.schoolId === member.schoolId)} disabled={!!busy || !!pending} onResolve={input => retainComparedInput({ editor: input })} />
            : session.answer ? <AnswerInputComparison base={session.answer.confirmedInput ?? { text: session.answer.original?.text ?? '', number: session.answer.original?.number ?? null, files: session.answer.original?.files ?? [] }} latest={{ text: comparison.draft?.text ?? '', number: comparison.draft?.number ?? null, files: comparison.draft?.files ?? [] }} mine={session.answer.input} labels={{ text: comparison.detail.request.textLabel, number: comparison.detail.request.numberLabel }} disabled={!!busy || !!pending} onResolve={input => retainComparedInput({ answer: input })} />
            : <><div className="cs-comparison"><div><h4>현재 서버 내용</h4><p>{comparisonUnit?.label ?? '현재 열람할 수 없는 제출 단위'} · 상태 {comparisonUnit?.version ?? '확인 필요'}판</p><p>현재 제출: {comparison.detail.submissions.find(value => value.id === comparisonUnit?.currentSubmissionId)?.revision ?? '없음'}판</p><p>정정 기한: {comparisonUnit?.correctionUntil || '설정 없음'}</p><p>{comparisonUnit?.correctionReason}</p></div><div><h4>내 입력</h4>{session.management ? <><p>{session.management.kind === 'withdraw' ? '철회' : '정정 허용'} 사유: {session.management.reason}</p><p>{session.management.dueDate && `정정 기한: ${session.management.dueDate}`}</p></> : <p>검토 의견: {session.review?.note || '없음'}</p>}</div></div>
              {canRetainAction ? <button type="button" disabled={!!busy} onClick={() => retainComparedInput()}>최신 버전 확인 · 내 입력 유지</button> : <p role="alert">대상 제출 또는 변경 권한이 달라졌습니다. 이 입력을 새 제출에 적용할 수 없습니다. 기존 작성을 닫고 최신 제출을 확인해 주세요.</p>}</>}
        </> : <button type="button" disabled={!!busy} onClick={() => { void compareLatest() }}>최신 원본과 비교</button>}
        <button type="button" disabled={!!busy || !!pending} onClick={() => { resetEditing(selectedId); setReload(value => value + 1) }}>내 변경 버리고 다시 열기</button>
      </section>}
      {session.upload && <section className="cs-warning" aria-label="서버 파일 확인"><h3>{session.upload.file.name}</h3><p>{session.upload.rejected ? '이 파일은 사용할 수 없습니다.' : 'HWPX 기본 형식과 업로드 완료 여부를 확인하고 있습니다. 완료되면 양식이나 제출 파일로 저장할 수 있습니다.'}</p>{session.upload.rejected ? <button type="button" disabled={!!busy} onClick={() => setSession({ ...session, upload: undefined, editor: session.editor ? { ...session.editor, saving: false, staged: session.editor.staged?.filter(value => value.id !== session.upload?.stagedId) } : undefined })}>거부된 파일 선택 해제</button> : <><button type="button" disabled={!!busy || restoring} onClick={() => { void uploadFile(session.upload!) }}>{session.upload.phase === 'upload' ? '같은 파일 전송 재시도' : '같은 파일 상태 다시 확인'}</button>{session.upload.cancelable && <button type="button" disabled={!!busy} onClick={() => { setSession({ ...session, upload: undefined, editor: session.editor ? { ...session.editor, saving: false, staged: session.editor.staged?.filter(value => value.id !== session.upload?.stagedId) } : undefined }); setNotice('이 파일의 첨부 선택을 취소했습니다.') }}>첨부 선택 취소</button>}</>}</section>}
      {canShowEditor && <form className="cs-card cs-composer" data-cs-form="editor" aria-label="수합 초안 작성" onSubmit={saveEditor}>
        <div className="cs-composer-heading"><span className="cs-draft-badge">담당자 초안 · 공개 전</span><h3 tabIndex={-1} data-cs-focus="editor">{session.editor!.original ? '수합 초안 수정' : '새 수합 초안'}</h3><p className="cs-muted">내용과 양식을 한 번에 저장하세요. 공개는 저장 후 따로 결정합니다.</p></div><fieldset disabled={inputBlocked}><legend className="cs-sr-only">수합 내용</legend>
          <section className="cs-compose-section"><h4>1. 무엇을 받을까요?</h4><div className="cs-basics"><label>수합 제목<input placeholder="예: 1학기 학급 운영계획" required value={session.editor!.input.title} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, title: event.target.value } } })} /></label>
          <label>제출 기한<input type="date" required value={session.editor!.input.dueDate} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, dueDate: event.target.value } } })} /></label>
          </div>
          <label>안내 내용<textarea aria-label="안내 내용" rows={2} placeholder="작성 방법이나 꼭 알려야 할 내용을 적어 주세요." value={session.editor!.input.instructions} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, instructions: event.target.value } } })} /></label>
          </section>
          <section className="cs-compose-section"><h4>2. 나눠 줄 양식</h4><p className="cs-muted">{session.editor!.staged !== undefined ? '양식이 있으면 선택하세요. 저장할 때 HWPX 검사와 업로드를 진행합니다.' : '양식을 선택하고 검사 완료 후 초안 변경을 저장하세요.'}</p>
          {session.editor!.staged !== undefined ? <>
            <label className="cs-file-picker cs-template-picker"><span className="cs-template-prompt">HWPX 양식 선택</span><input className="cs-sr-only" type="file" aria-label="양식 파일 선택" aria-describedby={`${pickerId}-staged-rule`} accept=".hwpx" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; selectTemplates(files) }} /><small id={`${pickerId}-staged-rule`}>HWPX · 파일당 {formatFileBytes(session.editor!.input.fileCollection!.policy.maxFileBytes)} · 최대 {session.editor!.input.fileCollection!.policy.maxFiles}개 · 선택한 파일은 아래에 표시됩니다.</small></label>
            <ul className="cs-files" aria-label="선택한 양식">{session.editor!.staged.map(item => <li key={item.id}><span>{item.file.name}<small> · {formatFileBytes(item.file.size)} · 저장 대기</small></span><button type="button" aria-label={`${item.file.name} 선택 취소`} onClick={() => setSession({ ...session, editor: { ...session.editor!, staged: session.editor!.staged!.filter(value => value.id !== item.id) } })}>선택 취소</button></li>)}</ul>
          </> : session.editor!.original && picker('양식 파일 선택', { kind: 'template', requestId: session.editor!.original.id, version: session.editor!.original.version }, session.editor!.input.fileCollection?.templates ?? [])}
          {filesView(session.editor!.input.fileCollection?.templates ?? [], session.editor!.original ? { kind: 'template', requestId: session.editor!.original.id, version: session.editor!.original.version } : undefined, id => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, fileCollection: { ...session.editor!.input.fileCollection!, templates: session.editor!.input.fileCollection!.templates.filter(file => file.id !== id) } } } }), session.editor!.original?.fileCollection?.templates.map(file => file.id) ?? [])}
          </section>
          <section className="cs-compose-section"><h4>3. 누가 제출하나요?</h4>
          <CollectionUnitsEditor units={session.editor!.input.units} members={allowedMembers} reviewerMemberId={session.editor!.input.reviewerMemberId} disabled={inputBlocked} onChange={units => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, units } } })} />
          </section>
          <details className="cs-optional" open={session.editor!.input.reviewMode === 'required' || undefined}><summary>선택 설정 · 제출 후 담당자 검토</summary><p className="cs-muted">검토자를 지정하면 제출한 파일을 확인하고 보완을 요청할 수 있습니다.</p>
          <label>제출 후 검토<select aria-label="제출 후 검토" value={session.editor!.input.reviewerMemberId} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, reviewerMemberId: event.target.value, reviewMode: event.target.value ? 'required' : 'none' } } })}><option value="">검토 없이 제출 완료</option>{session.editor!.input.reviewerMemberId && !allowedMembers.some(person => person.id === session.editor!.input.reviewerMemberId) && <option value={session.editor!.input.reviewerMemberId}>기존 검토자 · 현재 명부에 없음</option>}{allowedMembers.filter(person => person.id === session.editor!.input.reviewerMemberId || !session.editor!.input.units.some(unit => unit.responsibleMemberId === person.id)).map(person => <option key={person.id} value={person.id}>{memberLabel(person)} 검토</option>)}</select></label>
          </details>
          <details className="cs-optional"><summary>함께 받을 답변 · 글과 숫자</summary><p className="cs-muted">파일과 함께 필요한 답변만 요청하세요. 질문을 비우면 해당 항목은 표시하지 않습니다.</p>
            <label>글 응답 질문<input maxLength={120} value={session.editor!.input.textLabel} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, textLabel: event.target.value, textRequired: event.target.value.trim() ? session.editor!.input.textRequired : false } } })} /></label>
            <label className="cs-confirmation"><input type="checkbox" checked={session.editor!.input.textRequired} disabled={!session.editor!.input.textLabel.trim()} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, textRequired: event.target.checked } } })} />글 응답 필수</label>
            <label>숫자 응답 질문<input maxLength={120} value={session.editor!.input.numberLabel} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, numberLabel: event.target.value, numberRequired: event.target.value.trim() ? session.editor!.input.numberRequired : false } } })} /></label>
            <label className="cs-confirmation"><input type="checkbox" checked={session.editor!.input.numberRequired} disabled={!session.editor!.input.numberLabel.trim()} onChange={event => setSession({ ...session, editor: { ...session.editor!, input: { ...session.editor!.input, numberRequired: event.target.checked } } })} />숫자 응답 필수 · 0도 유효한 응답</label>
          </details>
        </fieldset><footer className="cs-compose-footer"><p role="status">{session.editor!.saving ? (session.upload ? "양식을 확인 중입니다. 완료된 파일만 초안에 연결합니다." : "초안과 양식을 저장 중입니다…") : session.editor!.createdId ? "초안은 만들어졌습니다. 남은 양식을 확인한 뒤 같은 초안에 저장합니다." : "저장해도 교사에게 공개되지 않습니다."}</p><div className="cs-actions"><button type="submit" className="cs-primary" disabled={blocked || !unitValidation?.valid}>{session.editor!.original ? '수합 초안 변경 저장' : '수합 초안 저장'}</button><button type="button" disabled={blocked} onClick={() => { focusNext(session.editor?.original ? 'edit-button' : 'create-button'); resetEditing(session.editor?.original?.id) }}>작성 취소</button></div></footer>
      </form>}
      {restoring && <p className={detail ? "cs-sr-only" : undefined} role="status">수합 원본과 보관한 입력의 접근 권한을 다시 확인 중…</p>}
      {detail && !session.editor && <section className="cs-card" aria-label="수합 상세"><div className="cs-heading"><div><h3 tabIndex={-1} data-cs-focus="detail">{detail.request.title}</h3><p>{detail.request.dueDate}까지 · {detail.request.status === 'draft' ? '담당자 초안' : '공개됨'} · v{detail.request.version}</p></div><button type="button" disabled={locked} onClick={() => { focusNext('list-item', detail.request.id); resetEditing(); setDetail(undefined) }}>목록으로</button></div><p className="cs-instructions">{detail.request.instructions}</p>
        {incomingFile?.requestId === detail.request.id && <p className="cs-notice" role="status">문서함에서 만든 {incomingFile.fileName} 파일이 있습니다. 내 제출 파일 작성을 열고 첨부한 뒤 최종 제출을 확인하세요.</p>}
        {operations && detail.request.status === 'published' && <CollectionOperations key={detail.request.id} server={operations} member={member} requestId={detail.request.id} date={date} disabled={Boolean(busy || pending || session.editor || session.answer || session.upload || session.review || session.management || session.conflict || exportBusy)} revision={reload + revision} onLock={setOperationsLocked} onState={setOperationState} onChanged={() => setReload(value => value + 1)} />}
        {filesView(detail.request.fileCollection?.templates ?? [], { kind: 'template', requestId: detail.request.id, version: detail.request.version })}
        {detail.request.status === 'published' && detail.request.managerMemberId === member.id && detail.request.fileCollection && <CollectionServerExport server={server} member={member} requestId={detail.request.id} date={date} disabled={Boolean(busy || pending || dirty || restoring || !enabled)} onBusyChange={setExportBusy} />}
        {detail.request.status === 'draft' && detail.request.managerMemberId === member.id && <div className="cs-actions"><button type="button" data-cs-focus="edit-button" disabled={locked || !readiness?.available} onClick={() => { focusNext('editor'); setSession({ selectedId: detail.request.id, editor: { original: detail.request, input: structuredClone(inputOf(detail.request)) } }) }}>양식 추가·초안 수정</button><button type="button" className="cs-primary" disabled={locked || !readiness?.available} onClick={() => { void mutate({ kind: 'publish', requestId: detail.request.id, expectedVersion: detail.request.version }) }}>대상 교사에게 공개</button></div>}
        {detail.request.status === 'published' && <CollectionUnitWorkbench detail={detail} memberId={member.id} date={date} locked={locked} activeUnitId={session.answer?.unitId ?? session.review?.unitId ?? session.management?.unitId}>{unit => {
          const submission = detail.submissions.find(value => value.id === unit.currentSubmissionId), withdrawn = Boolean(submission && unit.withdrawnSubmissionIds.includes(submission.id))
          const review = submission && detail.reviews.find(value => value.submissionId === submission.id), participant = unit.members.some(value => value.id === member.id)
          const supplements = detail.supplements.filter(value => value.unitId === unit.id && !value.fulfilledSubmissionId)
          const summary = summarizeCollectionSubmission(detail, unit, date)
          return <article className="cs-unit" key={unit.id} aria-label={`${unit.label} 제출 현황`}><h4>{unit.label}</h4>
            <CollectionSubmissionHistory detail={detail} unit={unit} members={allowedMembers} date={date} disabled={locked} onDownload={(parent, file) => { void download(parent, file) }} />
            {submission && <p className="cs-muted">제출 v{submission.revision} · 서버 접수 <time dateTime={submission.receiptAt}>{formatCollectionRecordedTime(submission.receiptAt)}</time></p>}
            {submission && !withdrawn && filesView(submission.files ?? [], { kind: 'submission', requestId: detail.request.id, unitId: unit.id, submissionId: submission.id })}
            {participant && <button type="button" data-cs-focus="answer-button" data-cs-key={unit.id} disabled={locked || !readiness?.available || submissionClosed} onClick={() => { void openAnswer(unit.id) }}>내 제출 파일 작성</button>}
            {supplements.length > 0 && <p className="cs-warning">보완 요청 {supplements.length}건이 있습니다. 제출 파일을 작성하고 응답할 보완 건을 선택해 주세요.</p>}
            <div className="cs-actions">
              {submission && !withdrawn && unit.responsibleMemberId === member.id && summary.reviewState !== 'accepted' && <button type="button" data-cs-focus="manage-button" data-cs-key={`${unit.id}-withdraw`} disabled={locked || !readiness?.available} onClick={() => { focusNext('management'); setSession({ selectedId: detail.request.id, management: { kind: 'withdraw', unitId: unit.id, submissionId: submission.id, expectedVersion: unit.version, reason: '', dueDate: '', confirmed: false } }) }}>제출 철회</button>}
              {detail.request.managerMemberId === member.id && <button type="button" data-cs-focus="manage-button" data-cs-key={`${unit.id}-open_correction`} disabled={locked || !readiness?.available} onClick={() => { focusNext('management'); setSession({ selectedId: detail.request.id, management: { kind: 'open_correction', unitId: unit.id, submissionId: null, expectedVersion: unit.version, reason: '', dueDate: unit.correctionUntil >= date ? unit.correctionUntil : '', confirmed: false } }) }}>정정 기간 설정</button>}
            </div>
            {submission && !withdrawn && detail.request.reviewerMemberId === member.id && !review && (session.review?.unitId === unit.id && session.review.submissionId === submission.id ? <div className="cs-review"><p className="cs-muted" tabIndex={-1} data-cs-focus="review">검토 대상: 제출 v{submission.revision}</p><label>검토 의견<textarea aria-label="검토 의견" maxLength={1000} value={session.review.note} disabled={blocked} onChange={event => setSession({ ...session, review: { ...session.review!, note: event.target.value } })} /></label><label>보완 기한<input type="date" min={date} value={session.review.dueDate} disabled={blocked} onChange={event => setSession({ ...session, review: { ...session.review!, dueDate: event.target.value } })} /></label><div className="cs-actions"><button type="button" disabled={blocked} onClick={() => { void mutate({ kind: 'review', requestId: detail.request.id, unitId: unit.id, submissionId: session.review!.submissionId, expectedVersion: session.review!.expectedVersion, decision: 'accepted', note: session.review!.note, dueDate: '' }) }}>검토 완료</button><button type="button" disabled={blocked || !session.review.note.trim() || !session.review.dueDate || session.review.dueDate < date} onClick={() => { void mutate({ kind: 'review', requestId: detail.request.id, unitId: unit.id, submissionId: session.review!.submissionId, expectedVersion: session.review!.expectedVersion, decision: 'changes_requested', note: session.review!.note, dueDate: session.review!.dueDate }) }}>보완 요청</button><button type="button" disabled={blocked} onClick={() => { focusNext('review-button', unit.id); resetEditing(detail.request.id) }}>검토 작성 취소</button></div></div> : <button type="button" data-cs-focus="review-button" data-cs-key={unit.id} disabled={locked || !readiness?.available} onClick={() => { focusNext('review'); setSession({ selectedId: detail.request.id, review: { unitId: unit.id, submissionId: submission.id, expectedVersion: unit.version, note: '', dueDate: '' } }) }}>제출물 검토</button>)}
          </article>
        }}</CollectionUnitWorkbench>}
      </section>}
      {session.management && managementUnit && detail && <form className="cs-card" data-cs-form="management" aria-label="제출 관리" onSubmit={submitManagement}>
        <h3 tabIndex={-1} data-cs-focus="management">{managementUnit.label} · {session.management.kind === 'withdraw' ? '제출 철회 확인' : '정정 기간 설정'}</h3>
        <p>{session.management.kind === 'withdraw' ? '현재 제출의 철회를 요청합니다. 접수·검토·철회 이력은 남습니다. 처리 후 현재 제출과 완료본을 다시 확인해 주세요.' : '이 제출 단위의 정정 허용 기간을 설정합니다. 전체 수합 기한은 바뀌지 않습니다.'}</p>
        <fieldset disabled={inputBlocked}><legend className="cs-sr-only">관리 입력</legend>
          <label>{session.management.kind === 'withdraw' ? '철회 사유' : '정정 허용 사유'}<textarea required maxLength={1000} value={session.management.reason} onChange={event => setSession({ ...session, management: { ...session.management!, reason: event.target.value, confirmed: false } })} /></label>
          {session.management.kind === 'open_correction' && <label>정정 종료일<input type="date" required min={date} value={session.management.dueDate} onChange={event => setSession({ ...session, management: { ...session.management!, dueDate: event.target.value, confirmed: false } })} /></label>}
          <label className="cs-confirmation"><input type="checkbox" checked={session.management.confirmed} onChange={event => setSession({ ...session, management: { ...session.management!, confirmed: event.target.checked } })} />대상과 처리 내용을 확인했습니다</label>
        </fieldset>
        <p className="cs-muted">처리 가능 여부와 기한은 서버에서 현재 권한·상태를 기준으로 확인합니다.</p>
        <div className="cs-actions"><button type="submit" className="cs-primary" disabled={blocked || !session.management.confirmed || !session.management.reason.trim() || (session.management.kind === 'open_correction' && (!session.management.dueDate || session.management.dueDate < date))}>{session.management.kind === 'withdraw' ? '확인한 제출 철회 요청' : '정정 기간 저장'}</button><button type="button" disabled={blocked} onClick={() => { focusNext('manage-button', `${session.management!.unitId}-${session.management!.kind}`); resetEditing(detail.request.id) }}>관리 작성 취소</button></div>
      </form>}
      {canShowAnswer && <form className="cs-card" data-cs-form="answer" noValidate aria-label="제출 파일 작성" onSubmit={event => { event.preventDefault(); if (!blocked && !submissionClosed) void mutate({ kind: 'save_draft', requestId: session.answer!.requestId, unitId: session.answer!.unitId, expectedVersion: session.answer!.original?.version ?? 0, input: session.answer!.input }) }}><h3 tabIndex={-1} data-cs-focus="answer">{selectedUnit!.label} · 제출 준비</h3>{submissionGuide && <CollectionSubmissionGuide guidance={submissionGuide} />}{submissionClosed && <p role="status" className="cs-warning">접수가 마감되었거나 보관 중입니다. 작성한 입력은 유지되며 새 저장·제출은 담당자가 접수를 재개한 뒤 할 수 있습니다.</p>}
        <fieldset disabled={inputBlocked}><legend className="cs-sr-only">제출 파일</legend>{picker('제출 파일 선택', { kind: 'draft', requestId: session.answer!.requestId, unitId: session.answer!.unitId, version: session.answer!.original?.version ?? 0 }, session.answer!.input.files ?? [])}
          {incomingFile?.requestId === session.answer!.requestId && <button type="button" disabled={blocked || submissionClosed || !detail!.request.fileCollection} onClick={attachGenerated}>문서함에서 만든 HWPX 첨부</button>}
          {session.answer!.input.files?.some(file => file.extension !== 'hwpx') && <p className="cs-warning">이 초안에는 HWPX가 아닌 기존 파일이 있습니다. 새로 저장하거나 제출하려면 해당 첨부 선택을 빼고 HWPX 파일로 바꿔 주세요. 과거 제출본은 그대로 보존됩니다.</p>}
          {filesView(session.answer!.input.files ?? [], undefined, id => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, files: session.answer!.input.files?.filter(file => file.id !== id) } } }))}
          {detail!.request.textLabel && <label>{detail!.request.textLabel}<textarea maxLength={5000} aria-label={detail!.request.textLabel} value={session.answer!.input.text} required={detail!.request.textRequired} onChange={event => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, text: event.target.value } } })} /></label>}
          {detail!.request.numberLabel && <label>{detail!.request.numberLabel}<input type="number" step="any" value={session.answer!.input.number ?? ''} required={detail!.request.numberRequired} onChange={event => setSession({ ...session, answer: { ...session.answer!, input: { ...session.answer!.input, number: event.target.value === '' ? null : Number(event.target.value) } } })} /></label>}
          {hadSubmission && <label>재제출 사유<input maxLength={1000} value={session.answer!.reason} onChange={event => setSession({ ...session, answer: { ...session.answer!, reason: event.target.value } })} /></label>}
          {detail!.supplements.some(value => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId) && <label>응답할 보완 요청<select aria-label="응답할 보완 요청" value={session.answer!.correctionRequestId} onChange={event => setSession({ ...session, answer: { ...session.answer!, correctionRequestId: event.target.value } })}><option value="">보완 요청을 선택해 주세요</option>{detail!.supplements.filter(value => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId).map((value, index) => <option key={value.id} value={value.id}>보완 {index + 1} · {value.dueDate}까지</option>)}</select></label>}
        </fieldset><div className="cs-actions"><button type="submit" className={submissionGuide?.canSubmit ? undefined : "cs-primary"} disabled={blocked || submissionClosed}>제출 초안 저장</button><button type="button" disabled={blocked} onClick={() => { focusNext('answer-button', session.answer!.unitId); resetEditing(session.answer!.requestId) }}>작성 닫기</button>
          {session.answer!.original && selectedUnit!.responsibleMemberId === member.id && <button type="button" className={submissionGuide?.canSubmit ? "cs-primary" : undefined} disabled={blocked || submissionClosed || !submissionGuide?.canSubmit} onClick={() => { void mutate({ kind: 'submit', requestId: session.answer!.requestId, unitId: session.answer!.unitId, draftId: session.answer!.original!.id, expectedDraftVersion: session.answer!.original!.version, expectedVersion: selectedUnit!.version, reason: session.answer!.reason, ...(session.answer!.correctionRequestId ? { correctionRequestId: session.answer!.correctionRequestId } : {}) }) }}>{hadSubmission ? '저장한 파일 다시 제출' : '저장한 파일 최종 제출'}</button>}
        </div><p className="cs-muted">최종 제출은 책임 교사만 할 수 있습니다. 서버에서 권한과 최신 버전을 다시 확인합니다.</p>
      </form>}
      {!session.editor && !selectedId && list && <><div className="cs-list" aria-label="수합 목록">{list.items.length ? list.items.map(request => <button type="button" className="cs-list-item" data-cs-focus="list-item" data-cs-key={request.id} key={request.id} disabled={locked} onClick={() => { focusNext('detail'); setSession({ selectedId: request.id }); setError(''); setNotice('') }}><strong>{request.title}</strong><span>{request.dueDate}까지 · {request.status === 'draft' ? '초안' : '공개'}</span></button>) : <p className="cs-empty">현재 볼 수 있는 수합이 없습니다.</p>}</div><nav className="cs-actions" aria-label="수합 목록 페이지"><button type="button" disabled={locked || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(history.slice(0, -1)) }}>이전 페이지</button><span>{history.length + 1}쪽</span><button type="button" disabled={locked || !list.nextCursor} onClick={() => { setHistory([...history, cursor]); setCursor(list.nextCursor!) }}>다음 페이지</button></nav></>}
    </>}
  </section>
}
