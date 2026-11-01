import { type CollectionStatuses } from './presentation'
import type { CollectionOperationsState } from './operations'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { FileError, type FilePolicy, type FileReference } from '../files/contracts'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { validateFileMetadata } from '../files/validation'
import { requestBlobDownload } from '../files/download'
import { collectionDownloadFailure } from './download-feedback'
import type {
  AnswerInput,
  CollectionDraft,
  CollectionInput,
  CollectionRequest,
} from '../workflows/types'
import {
  CollectionServerError,
  type CollectionCommand,
  type CollectionDetail,
  type CollectionFileParent,
  type CollectionList,
  type CollectionReadiness,
} from './contracts'
import { collectionUnitMemberOptions, validateCollectionUnitInputs } from './unit-inputs'
import { formatCollectionRecordedTime } from './submission-summary'
import { collectionSubmissionGuidance } from './submission-guidance'
import { stageTemplates } from './template-staging'
import {
  CollectionServerPanelProps,
  Upload,
  Session,
  FocusTarget,
  knownRejection,
  accessDenied,
  failureMessage,
  same,
  layoutEffect,
} from './collection-editor-model'
export function useCollectionEditor({
  server,
  operations,
  incomingFile,
  onIncomingFileConsumed,
  member,
  members,
  date,
  revision = 0,
  openRequest,
  onNavigationLockChange,
}: CollectionServerPanelProps) {
  const memory = useEditDraft<Session>(member, 'collection-editor'),
    recovery = usePendingRequest(member, 'collection')
  const operationsRecovery = usePendingRequest(member, 'collectionOps')
  const [session, setSessionState] = useState<Session>(() => memory.initial ?? {})
  const sessionRef = useRef(session),
    life = useRef(0),
    operation = useRef(false)
  const panelRef = useRef<HTMLElement>(null),
    focusTarget = useRef<FocusTarget>(),
    pickerId = useId()
  const focusNext = (name: string, key?: string) => {
    focusTarget.current = { name, key }
  }
  const [readiness, setReadiness] = useState<CollectionReadiness>(),
    [storedList, setStoredList] = useState<{ cursor?: string; value: CollectionList }>(),
    [storedDetail, setDetail] = useState<CollectionDetail>()
  const [statuses, setStatuses] = useState<CollectionStatuses>()
  const [cursor, setCursor] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([])
  const [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [restoring, setRestoring] = useState(false)
  const [readError, setReadError] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState('')
  const [comparison, setComparison] = useState<{
    detail: CollectionDetail
    draft?: CollectionDraft | null
  }>()
  const [exportBusy, setExportBusy] = useState(false)
  const [savingRequest, setSavingRequest] = useState(false)
  const [publishReview, setPublishReview] = useState<CollectionRequest>()
  const [operationState, setOperationState] = useState<CollectionOperationsState>()
  const [operationsLocked, setOperationsLocked] = useState(false)
  const operationRequest = operationsRecovery.request?.command as { requestId?: string } | undefined
  const pending = recovery.request,
    selectedId =
      session.selectedId ??
      (pending?.command.kind !== 'create' ? pending?.command.requestId : undefined) ??
      operationRequest?.requestId
  // 같은 자료의 재조회에서는 화면을 유지한다. 다른 페이지·수합에는 이전 결과를 표시하지 않는다.
  const list = storedList?.cursor === cursor ? storedList?.value : undefined
  const detail = storedDetail?.request.id === selectedId ? storedDetail : undefined
  const setList = (value?: CollectionList) => setStoredList(value ? { cursor, value } : undefined)
  useEffect(() => {
    if (operationsLocked && selectedId) memory.save({ ...sessionRef.current, selectedId }, false)
  }, [operationsLocked, selectedId])
  const enabled = activeAt(member, date)
  const dirty = Boolean(
    publishReview ||
      operationsLocked ||
      operationsRecovery.request ||
      session.editor ||
      session.answer ||
      session.upload ||
      session.review ||
      session.management ||
      session.conflict,
  )
  const parked = Boolean(session.parked)
  const hasWork = Boolean(pending || dirty)
  const locked = Boolean(busy || loading || restoring || exportBusy || (!parked && hasWork))
  const inputBlocked = Boolean(
    busy ||
      session.editor?.saving ||
      pending ||
      session.upload ||
      session.conflict ||
      session.answer?.confirmedVersion ||
      exportBusy ||
      parked ||
      !readiness?.available,
  )
  const blocked = inputBlocked || loading || restoring || Boolean(readError)
  const submissionClosed =
    operationState?.requestId === detail?.request.id && operationState?.phase !== 'open'
  const selectedUnit = detail?.units.find((unit) => unit.id === session.answer?.unitId)
  const policy = readiness?.policy
  let newCollectionPolicy: FilePolicy | undefined
  if (policy) {
    try {
      newCollectionPolicy = hwpxCollectionPolicy(policy)
    } catch {
      /* 기존 기록은 표시하고 새 파일 선택만 닫는다. */
    }
  }
  function setSession(value: Session) {
    sessionRef.current = value
    memory.save(
      value,
      Boolean(
        value.editor ||
          value.answer ||
          value.upload ||
          value.review ||
          value.management ||
          value.conflict,
      ),
    )
    setSessionState(value)
  }
  function resetEditing(selected?: string) {
    setPublishReview(undefined)
    setSession({ selectedId: selected })
    setError('')
    setComparison(undefined)
  }
  function hideDenied() {
    setPublishReview(undefined)
    focusTarget.current = undefined
    memory.remove()
    sessionRef.current = {}
    setSessionState({})
    setDetail(undefined)
    setList(undefined)
    setReadiness(undefined)
    setComparison(undefined)
    setReadError(
      '현재 자료의 접근 권한을 확인할 수 없어 이전 화면을 닫았습니다. 연결을 다시 확인해 주세요.',
    )
  }
  const stillHere = (epoch: number) => life.current === epoch
  const openedRequest = useRef<string>()
  useEffect(() => {
    if (!openRequest || openedRequest.current === openRequest.key || hasWork || busy || exportBusy)
      return
    openedRequest.current = openRequest.key
    focusNext('detail')
    setSession({ selectedId: openRequest.id })
    setError('')
    setNotice('')
  }, [openRequest?.key, hasWork, busy, exportBusy])

  useEffect(() => {
    return () => {
      life.current++
      operation.current = false
    }
  }, [server])
  layoutEffect(() => {
    onNavigationLockChange?.(locked)
    return () => onNavigationLockChange?.(false)
  }, [locked, onNavigationLockChange])
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
    focusTarget.current = {
      name: 'restore-input',
      key: form.dataset.csForm,
      field,
      start: active.selectionStart,
      end: active.selectionEnd,
    }
  }
  layoutEffect(() => {
    const target = focusTarget.current,
      panel = panelRef.current
    if (!target || !panel || busy || restoring || loading || parked) return
    let node: HTMLElement | undefined
    if (target.name === 'restore-input') {
      const active = (panel.getRootNode() as Document | ShadowRoot).activeElement
      // 조회를 기다리는 동안 사용자가 다른 곳으로 옮긴 초점은 되돌리지 않는다.
      if (active && active !== document.body && active !== document.documentElement) {
        focusTarget.current = undefined
        return
      }
      const form = [...panel.querySelectorAll<HTMLFormElement>('form[data-cs-form]')].find(
        (item) => item.dataset.csForm === target.key,
      )
      node = form?.querySelectorAll<HTMLElement>('input,textarea,select')[target.field ?? -1]
    } else
      node = [...panel.querySelectorAll<HTMLElement>('[data-cs-focus]')].find(
        (item) =>
          item.dataset.csFocus === target.name &&
          (!target.key || item.dataset.csKey === target.key),
      )
    if (!node || node.matches(':disabled')) return
    focusTarget.current = undefined
    node.focus({ preventScroll: true })
    if (target.name === 'restore-input') {
      if (
        typeof target.start === 'number' &&
        typeof target.end === 'number' &&
        (node instanceof HTMLTextAreaElement ||
          (node instanceof HTMLInputElement &&
            ['text', 'search', 'tel', 'url', 'password'].includes(node.type)))
      )
        node.setSelectionRange(target.start, target.end)
    } else
      node.scrollIntoView({
        block: ['editor', 'answer', 'detail', 'management', 'review'].includes(target.name)
          ? 'start'
          : 'nearest',
      })
  })

  useEffect(() => {
    if (!hasWork && !busy && !exportBusy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasWork, busy, exportBusy])
  useEffect(() => {
    let current = true
    setLoading(true)
    setReadError('')
    setStatuses(undefined)
    if (!enabled) {
      setList(undefined)
      setReadiness(undefined)
      setLoading(false)
      setReadError('현재 이용 가능한 학교 소속이 아닙니다.')
      return
    }
    // 쓰기 준비 상태와 기존 자료의 읽기는 독립적이다. 확인 API가 없어도 R1 읽기는 유지한다.
    void Promise.allSettled([server.readiness(member.id), server.list(member.id, cursor)])
      .then(async ([ready, result]) => {
        if (!current) return
        setReadiness(ready.status === 'fulfilled' ? ready.value : undefined)
        if (result.status === 'fulfilled') {
          setList(result.value)
          setLoading(false)
          if (server.statuses)
            try {
              const rows = await server.statuses(
                member.id,
                result.value.items.map((r) => r.id),
              )
              if (current) setStatuses(rows)
            } catch {
              if (current) setStatuses(undefined)
            }
        } else {
          setList(undefined)
          if (accessDenied(result.reason)) hideDenied()
          setReadError(
            '수합 목록을 확인하지 못했습니다. 빈 목록으로 판단하지 않습니다. 다시 확인해 주세요.',
          )
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [server, member.id, enabled, cursor, reload, revision])
  useEffect(() => {
    let current = true
    captureInputFocus()
    if (!selectedId || !enabled || parked) {
      setDetail(undefined)
      setRestoring(false)
      return
    }
    setRestoring(true)
    setReadError('')
    void server
      .detail(member.id, selectedId)
      .then(async (value) => {
        // 보관한 공동 초안은 현재 읽기 권한까지 다시 확인한 뒤 표시한다. 원래 버전은 유지한다.
        const answer = sessionRef.current.answer
        const latestDraft = answer
          ? await server.draft(member.id, selectedId, answer.unitId)
          : undefined
        if (!current) return
        setDetail(value)
        const editor = sessionRef.current.editor
        if (editor?.createdId === value.request.id && !editor.original) {
          const changed = value.request.version !== editor.createdVersion
          const original = {
            ...value.request,
            ...structuredClone(editor.input),
            version: editor.createdVersion!,
          }
          setSession({
            ...sessionRef.current,
            conflict: changed,
            editor: { ...editor, original, saving: changed ? false : editor.saving },
          })
          if (changed) {
            setComparison({ detail: value })
            setError(
              '초안을 만드는 동안 다른 변경이 확인되었습니다. 입력을 비교한 뒤 이어 저장해 주세요.',
            )
          }
        }
        const action = sessionRef.current.management ?? sessionRef.current.review
        if (action && !recovery.request) {
          const unit = value.units.find((item) => item.id === action.unitId)
          const allowed =
            unit &&
            (sessionRef.current.management?.kind === 'open_correction'
              ? value.request.managerMemberId === member.id
              : sessionRef.current.management
                ? unit.responsibleMemberId === member.id
                : value.request.reviewerMemberId === member.id)
          if (!allowed) {
            setSession({ selectedId })
            setError('현재 변경 권한을 확인할 수 없어 보관한 관리 입력을 버렸습니다.')
          } else if (
            unit.version !== action.expectedVersion ||
            (action.submissionId && unit.currentSubmissionId !== action.submissionId)
          ) {
            // 포커스 재조회가 새 제출을 이전 의견·철회 사유의 대상으로 바꾸지 않게 한다.
            setSession({ ...sessionRef.current, conflict: true })
            setComparison({ detail: value })
          }
        }
        if (answer?.confirmedVersion) {
          if (latestDraft?.version === answer.confirmedVersion)
            setSession({
              ...sessionRef.current,
              answer: {
                ...answer,
                original: latestDraft,
                input: {
                  text: latestDraft.text,
                  number: latestDraft.number,
                  files: latestDraft.files ?? [],
                },
                confirmedVersion: undefined,
                confirmedInput: undefined,
              },
            })
          else {
            setSession({
              ...sessionRef.current,
              conflict: true,
              answer: { ...answer, confirmedVersion: undefined },
            })
            setComparison({ detail: value, draft: latestDraft })
            setError(
              '초안 저장 뒤 다른 변경이 확인되었습니다. 최신 내용과 내 입력을 비교해 주세요.',
            )
          }
        }
      })
      .catch((failure) => {
        if (!current) return
        setDetail(undefined)
        if (accessDenied(failure) && !recovery.request) hideDenied()
        setReadError(
          '수합 원본의 접근 권한과 최신 상태를 확인하지 못했습니다. 보관한 입력은 확인 전까지 표시하지 않습니다.',
        )
      })
      .finally(() => {
        if (current) setRestoring(false)
      })
    return () => {
      current = false
    }
  }, [server, member.id, selectedId, enabled, parked, reload, revision])

  async function mutate(command: CollectionCommand, key: string = crypto.randomUUID()) {
    const saved = recovery.request
    const retry = Boolean(saved && saved.key === key && same(saved.command, command))
    // 미확정 명령만 준비 해제 중에도 같은 키/본문으로 재확인한다. 새 명령으로 대체하지 않는다.
    if (
      operation.current ||
      !enabled ||
      sessionRef.current.parked ||
      (saved && !retry) ||
      (!retry && (loading || restoring || readError || !readiness?.available))
    )
      return
    if (!retry && command.kind === 'open_correction' && submissionClosed) {
      setError('마감된 수합은 접수를 재개한 뒤 정정 기간을 설정할 수 있습니다.')
      return
    }
    const request = structuredClone(retry ? saved! : { command, key }),
      epoch = life.current
    operation.current = true
    recovery.put(request)
    setSavingRequest(true)
    setBusy('서버에 저장 중…')
    setError('')
    setNotice('')
    try {
      const receipt = await server.mutate(member.id, request.command, request.key)
      if (!stillHere(epoch)) return
      recovery.remove(key)
      // 접수 확인 이후 조회가 실패하더라도 이미 확인된 저장을 다시 실행하지 않는다.
      if (request.command.kind === 'create' && sessionRef.current.editor?.saving) {
        // 생성 접수증을 먼저 보존한다. 뒤의 조회·파일 검사가 실패해도 새 수합을 만들지 않는다.
        setSession({
          ...sessionRef.current,
          selectedId: receipt.requestId,
          editor: {
            ...sessionRef.current.editor,
            createdId: receipt.requestId,
            createdVersion: receipt.resourceVersion,
          },
        })
      } else if (
        request.command.kind === 'save_draft' &&
        sessionRef.current.answer?.unitId === request.command.unitId
      ) {
        // 재제출 사유는 유지하고, 접수 뒤 경합은 방금 저장한 원문을 기준으로 비교한다.
        focusNext('answer')
        setSession({
          ...sessionRef.current,
          recoveryConflict: undefined,
          answer: {
            ...sessionRef.current.answer,
            confirmedVersion: receipt.resourceVersion,
            confirmedInput: structuredClone(request.command.input),
          },
        })
        setError('')
      } else {
        focusNext('detail')
        resetEditing(receipt.requestId)
      }
      const message =
        request.command.kind === 'save_draft'
          ? '초안을 저장했습니다. 최종 제출은 아직 하지 않았습니다.'
          : request.command.kind === 'submit'
            ? '최종 제출을 접수했습니다. 아래 제출 현황에서 검토 상태를 확인해 주세요.'
            : request.command.kind === 'create'
              ? sessionRef.current.editor?.saving
                ? '수합 초안을 만들었습니다. 선택한 양식의 검사와 저장을 이어갑니다.'
                : '수합 초안을 저장했습니다. 내용을 확인한 뒤 대상 교사에게 공개해 주세요.'
              : request.command.kind === 'update'
                ? '수합 초안 변경을 저장했습니다.'
                : request.command.kind === 'publish'
                  ? '대상 교사에게 수합을 공개했습니다.'
                  : request.command.kind === 'review'
                    ? '검토 결과를 저장했습니다.'
                    : request.command.kind === 'withdraw'
                      ? '제출 철회를 처리했습니다.'
                      : '정정 기간을 저장했습니다.'
      setNotice(
        `${message} 접수 시각 ${formatCollectionRecordedTime(receipt.recordedAt)} (한국 표준시)`,
      )
      setReload((value) => value + 1)
    } catch (failure) {
      if (!stillHere(epoch)) return
      // 준비 해제는 복구를 기다릴 수 있다. 원래 요청을 보존해 새 키로 중복 저장하지 않는다.
      const retryNotReady =
        retry && failure instanceof CollectionServerError && failure.code === 'NOT_READY'
      if (knownRejection(failure) && !retryNotReady) {
        recovery.remove(key)
        const current = sessionRef.current
        if (current.editor) setSession({ ...current, editor: { ...current.editor, saving: false } })
      }
      if (failure instanceof CollectionServerError && failure.code === 'IDEMPOTENCY_CONFLICT')
        setSession({ ...sessionRef.current, recoveryConflict: true })
      if (accessDenied(failure)) hideDenied()
      else if (failure instanceof CollectionServerError && failure.code === 'CONFLICT') {
        setSession({ ...sessionRef.current, conflict: true })
        setComparison(undefined)
      }
      setError(
        retryNotReady
          ? '서버가 아직 이 요청을 처리할 준비가 되지 않았습니다. 입력과 기존 요청 번호를 보관했습니다. 준비가 돌아오면 같은 요청으로 다시 확인해 주세요.'
          : failureMessage(failure),
      )
    } finally {
      if (stillHere(epoch)) {
        operation.current = false
        setSavingRequest(false)
        setBusy('')
      }
    }
  }
  function parkEditing() {
    if (operation.current || busy || exportBusy || !hasWork) return
    focusTarget.current = undefined
    setSession({ ...sessionRef.current, parked: true })
    setComparison(undefined)
    setError('')
    setNotice('')
  }
  function resumeEditing() {
    if (operation.current || busy || exportBusy) return
    setDetail(undefined)
    setComparison(undefined)
    setSession({ ...sessionRef.current, parked: false })
    setError('')
    setNotice('')
    setReload((value) => value + 1)
  }
  async function openAnswer(unitId: string) {
    if (locked || !detail) return
    const epoch = life.current
    operation.current = true
    setBusy('공동 초안을 확인 중…')
    setError('')
    try {
      const draft = await server.draft(member.id, detail.request.id, unitId)
      if (stillHere(epoch)) {
        focusNext('answer')
        setSession({
          selectedId: detail.request.id,
          answer: {
            requestId: detail.request.id,
            unitId,
            original: draft,
            input: {
              text: draft?.text ?? '',
              number: draft?.number ?? null,
              files: draft?.files ?? [],
            },
            reason: '',
            correctionRequestId: '',
          },
        })
      }
    } catch (failure) {
      if (stillHere(epoch)) {
        setDetail(undefined)
        if (accessDenied(failure)) hideDenied()
        setError(failureMessage(failure))
        setReadError('제출 초안을 확인하지 못해 수합 상세를 닫았습니다. 다시 연결해 주세요.')
      }
    } finally {
      if (stillHere(epoch)) {
        operation.current = false
        setBusy('')
      }
    }
  }
  async function compareLatest() {
    if (operation.current || !selectedId) return
    const epoch = life.current
    operation.current = true
    setBusy('최신 변경을 확인 중…')
    try {
      const latest = await server.detail(member.id, selectedId)
      const draft = session.answer
        ? await server.draft(member.id, selectedId, session.answer.unitId)
        : undefined
      if (stillHere(epoch)) setComparison({ detail: latest, draft })
    } catch (failure) {
      if (stillHere(epoch)) {
        if (accessDenied(failure)) hideDenied()
        setError(failureMessage(failure))
      }
    } finally {
      if (stillHere(epoch)) {
        operation.current = false
        setBusy('')
      }
    }
  }
  async function uploadFile(initial: Upload) {
    if (operation.current || !policy || !enabled) return
    const epoch = life.current
    operation.current = true
    setBusy('HWPX 파일을 확인 중…')
    setError('')
    let job = initial
    const keep = (next: Upload) => {
      job = next
      if (stillHere(epoch))
        setSession({
          ...sessionRef.current,
          upload: next,
          editor:
            next.rejected && sessionRef.current.editor
              ? { ...sessionRef.current.editor, saving: false }
              : sessionRef.current.editor,
        })
    }
    try {
      if (!job.intent) {
        const intent = await server.prepareUpload(
          member.id,
          job.parent,
          job.file,
          job.policy,
          job.prepareKey,
        )
        if (!stillHere(epoch)) return
        keep({
          ...job,
          intent,
          phase:
            intent.state === 'awaiting_upload'
              ? 'upload'
              : intent.state === 'pending_verification'
                ? 'complete'
                : 'status',
        })
      }
      if (job.phase === 'upload') {
        // 응답 유실 뒤에는 먼저 동일 예약의 완료 여부를 확인한다. 새 파일 ID를 만들지 않는다.
        keep({ ...job, phase: 'complete', cancelable: false })
        await server.upload(member.id, job.intent!, job.file)
        if (!stillHere(epoch)) return
      }
      const status =
        job.phase === 'status'
          ? await server.fileStatus(member.id, job.intent!.fileId)
          : await server.completeUpload(member.id, job.intent!.fileId, job.completeKey)
      if (!stillHere(epoch)) return
      if (status.state === 'ready' && status.file) {
        const current = sessionRef.current,
          ref = status.file
        if (
          job.parent.kind === 'template' &&
          current.editor?.original?.id === job.parent.requestId &&
          current.editor.input.fileCollection
        ) {
          const fileCollection = current.editor.input.fileCollection
          setSession({
            ...current,
            upload: undefined,
            editor: {
              ...current.editor,
              input: {
                ...current.editor.input,
                fileCollection: {
                  ...fileCollection,
                  templates: [
                    ...fileCollection.templates.filter((file) => file.id !== ref.id),
                    ref,
                  ],
                },
              },
              staged: current.editor.staged?.filter((value) => value.id !== job.stagedId),
            },
          })
        } else if (job.parent.kind === 'draft' && current.answer?.unitId === job.parent.unitId) {
          setSession({
            ...current,
            upload: undefined,
            answer: {
              ...current.answer,
              input: {
                ...current.answer.input,
                files: [
                  ...(current.answer.input.files ?? []).filter((file) => file.id !== ref.id),
                  ref,
                ],
              },
            },
          })
        } else throw new CollectionServerError('CONFLICT', '파일을 연결할 입력이 바뀌었습니다.')
        setNotice(
          job.stagedId
            ? '양식 검사를 통과했습니다. 남은 파일과 초안 저장을 이어갑니다.'
            : '파일 준비가 완료되었습니다. 아래 저장 버튼을 눌러 문서에 연결해 주세요. 아직 최종 제출된 상태는 아닙니다.',
        )
      } else {
        keep({
          ...job,
          phase:
            status.state === 'awaiting_upload'
              ? 'upload'
              : status.state === 'pending_verification'
                ? 'complete'
                : 'status',
          rejected: status.state === 'rejected',
          cancelable: true,
        })
        setNotice(
          status.state === 'rejected'
            ? '서버가 파일을 거부했습니다. 다른 파일을 선택해 주세요.'
            : status.state === 'awaiting_upload'
              ? '파일 전송이 아직 확인되지 않았습니다. 같은 파일을 다시 전송할 수 있습니다.'
              : '서버에서 HWPX 파일의 기본 형식을 확인하고 있습니다. 잠시 뒤 같은 파일 상태 다시 확인을 눌러 주세요. 완료된 파일만 저장·제출할 수 있습니다.',
        )
      }
    } catch (failure) {
      if (stillHere(epoch)) {
        if (accessDenied(failure)) hideDenied()
        else if (knownRejection(failure) || failure instanceof FileError)
          keep({ ...job, rejected: true, cancelable: true })
        setError(failureMessage(failure))
      }
    } finally {
      if (stillHere(epoch)) {
        operation.current = false
        setBusy('')
      }
    }
  }
  function chooseFile(
    file: File | undefined,
    parent: CollectionFileParent,
    existing: FileReference[],
    filePolicy: FilePolicy,
    stagedId?: string,
  ) {
    if (!file || (blocked && !stagedId)) return
    let checkedPolicy: FilePolicy
    try {
      checkedPolicy = hwpxCollectionPolicy(filePolicy)
      validateFileMetadata(file, checkedPolicy)
    } catch (failure) {
      pauseTemplateSave()
      setError(
        failure instanceof FileError && failure.code === 'FILE_TYPE_UNSUPPORTED'
          ? 'HWPX 파일만 새로 올릴 수 있습니다. 한글에서 HWPX 형식으로 저장해 주세요.'
          : failureMessage(failure),
      )
      return
    }
    if (existing.some((value) => value.name.normalize('NFC') === file.name.normalize('NFC'))) {
      pauseTemplateSave()
      setError(
        '같은 이름의 파일이 이미 첨부되어 있습니다. 교체하려면 기존 첨부 선택을 제거한 뒤 다시 선택해 주세요. 이전 제출본과 원본 파일은 삭제되지 않습니다.',
      )
      return
    }
    if (existing.length >= checkedPolicy.maxFiles) {
      pauseTemplateSave()
      setError(
        `파일은 최대 ${checkedPolicy.maxFiles}개입니다. 기존 파일을 제거한 뒤 선택해 주세요.`,
      )
      return
    }
    const job: Upload = {
      stagedId,
      file,
      parent,
      policy: checkedPolicy,
      prepareKey: crypto.randomUUID(),
      completeKey: crypto.randomUUID(),
      phase: 'prepare',
    }
    setSession({ ...sessionRef.current, upload: job })
    void uploadFile(job)
    return true
  }
  function pauseTemplateSave() {
    const current = sessionRef.current
    if (current.editor?.saving)
      setSession({ ...current, editor: { ...current.editor, saving: false } })
  }
  function selectTemplates(files: File[]) {
    const current = sessionRef.current,
      editor = current.editor
    if (blocked || !editor?.input.fileCollection || !files.length) return
    try {
      const staged = stageTemplates(
        editor.staged ?? [],
        files,
        editor.input.fileCollection.policy,
        editor.input.fileCollection.templates.length,
      )
      setSession({ ...current, editor: { ...editor, staged } })
      setError('')
      setNotice('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '파일 선택을 확인해 주세요.')
    }
  }
  function saveEditor(event: FormEvent) {
    event.preventDefault()
    const current = sessionRef.current,
      editor = current.editor
    if (operation.current || blocked || !editor || !unitValidation?.valid) return
    if (editor.staged?.length) {
      setSession({ ...current, editor: { ...editor, saving: true } })
      setError('')
      setNotice('')
    } else
      void mutate(
        editor.original
          ? {
              kind: 'update',
              requestId: editor.original.id,
              expectedVersion: editor.original.version,
              input: editor.input,
            }
          : { kind: 'create', input: editor.input },
      )
  }
  // 한 번 누른 저장을 단계별로 진행한다. 미확정 요청·파일 검사는 사용자 재확인 전까지 멈춘다.
  useEffect(() => {
    // 외부 요청 저장소의 동기 알림 뒤 늦게 실행되는 이전 렌더는 다음 단계를 시작하지 않는다.
    if (sessionRef.current !== session) return
    const editor = session.editor
    if (
      !editor?.saving ||
      operation.current ||
      busy ||
      loading ||
      restoring ||
      readError ||
      pending ||
      session.upload ||
      session.conflict ||
      parked ||
      !enabled ||
      !readiness?.available
    )
      return
    if (!editor.original) {
      if (!editor.createdId) void mutate({ kind: 'create', input: editor.input })
      return
    }
    if (detail?.request.id !== editor.original.id) return
    const next = editor.staged?.[0],
      collection = editor.input.fileCollection
    if (next && collection)
      chooseFile(
        next.file,
        { kind: 'template', requestId: editor.original.id, version: editor.original.version },
        collection.templates,
        collection.policy,
        next.id,
      )
    else
      void mutate({
        kind: 'update',
        requestId: editor.original.id,
        expectedVersion: editor.original.version,
        input: editor.input,
      })
  }, [session, busy, loading, restoring, readError, pending, parked, enabled, readiness, detail])
  function attachGenerated() {
    const answer = sessionRef.current.answer
    if (
      submissionClosed ||
      !incomingFile ||
      !answer ||
      incomingFile.requestId !== answer.requestId ||
      detail?.request.id !== answer.requestId ||
      !detail.request.fileCollection
    )
      return
    const file = new File([incomingFile.blob], incomingFile.fileName, {
      type: 'application/hwp+zip',
    })
    // 생성 결과도 수합 파일 예약·업로드·확인을 새로 거친다. 문서함 ID를 제출 ID로 재사용하지 않는다.
    if (
      chooseFile(
        file,
        {
          kind: 'draft',
          requestId: answer.requestId,
          unitId: answer.unitId,
          version: answer.original?.version ?? 0,
        },
        answer.input.files ?? [],
        detail.request.fileCollection.policy,
      )
    )
      onIncomingFileConsumed?.()
  }
  async function download(parent: CollectionFileParent, file: FileReference) {
    if (operation.current || exportBusy) return
    const epoch = life.current
    operation.current = true
    setBusy('파일을 내려받는 중…')
    setError('')
    try {
      const blob = await server.download(member.id, parent, file)
      if (stillHere(epoch)) requestBlobDownload(blob, file.name)
    } catch (failure) {
      if (stillHere(epoch)) {
        if (accessDenied(failure)) hideDenied()
        setError(collectionDownloadFailure(failure))
      }
    } finally {
      if (stillHere(epoch)) {
        operation.current = false
        setBusy('')
      }
    }
  }
  const allowedMembers = members.filter(
    (value) => value.schoolId === member.schoolId && activeAt(value, date),
  )
  const unitValidation = session.editor
    ? validateCollectionUnitInputs(session.editor.input.units, allowedMembers)
    : undefined
  const memberOptions = collectionUnitMemberOptions(allowedMembers)
  const memberLabel = (person: Membership) =>
    memberOptions.find((value) => value.id === person.id)?.label ?? person.name
  const canShowEditor =
    session.editor &&
    (!session.editor.original || detail?.request.id === session.editor.original.id)
  const canShowAnswer =
    session.answer && detail?.request.id === session.answer.requestId && selectedUnit
  const hadSubmission = Boolean(
    selectedUnit && detail?.submissions.some((value) => value.unitId === selectedUnit.id),
  )
  const submissionGuide =
    session.answer && detail && selectedUnit
      ? collectionSubmissionGuidance({
          input: session.answer.input,
          saved: session.answer.original,
          requiredFiles: Boolean(detail.request.fileCollection?.required),
          textLabel: detail.request.textLabel,
          textRequired: detail.request.textRequired,
          numberLabel: detail.request.numberLabel,
          numberRequired: detail.request.numberRequired,
          responsible: selectedUnit.responsibleMemberId === member.id,
          hadSubmission,
          reason: session.answer.reason,
          needsSupplement: detail.supplements.some(
            (value) => value.unitId === selectedUnit.id && !value.fulfilledSubmissionId,
          ),
          correctionRequestId: session.answer.correctionRequestId,
          pendingFile: Boolean(session.upload),
        })
      : undefined
  const action = session.management ?? session.review
  const comparisonUnit = comparison?.detail.units.find((value) => value.id === action?.unitId)
  const actionTargetChanged = Boolean(
    action?.submissionId && comparisonUnit?.currentSubmissionId !== action.submissionId,
  )
  const actionReviews =
    comparison?.detail.reviews.filter((value) => value.submissionId === action?.submissionId) ?? []
  const canRetainAction =
    !action ||
    Boolean(
      comparisonUnit &&
        !actionTargetChanged &&
        (session.management?.kind === 'open_correction'
          ? comparison?.detail.request.managerMemberId === member.id
          : session.management
            ? comparisonUnit.responsibleMemberId === member.id &&
              !actionReviews.some((value) => value.decision === 'accepted')
            : comparison?.detail.request.reviewerMemberId === member.id && !actionReviews.length),
    )
  function retainComparedInput(resolved?: { editor?: CollectionInput; answer?: AnswerInput }) {
    if (!comparison || !canRetainAction) return
    setDetail(comparison.detail)
    setSession({
      ...session,
      conflict: false,
      editor: session.editor
        ? {
            ...session.editor,
            original: comparison.detail.request,
            input: resolved?.editor ?? session.editor.input,
          }
        : undefined,
      answer: session.answer
        ? {
            ...session.answer,
            original: comparison.draft ?? null,
            input: resolved?.answer ?? session.answer.input,
            confirmedInput: undefined,
          }
        : undefined,
      review:
        session.review && comparisonUnit
          ? { ...session.review, expectedVersion: comparisonUnit.version }
          : undefined,
      management:
        session.management && comparisonUnit
          ? { ...session.management, expectedVersion: comparisonUnit.version, confirmed: false }
          : undefined,
    })
    setComparison(undefined)
    setError('')
    setNotice('최신 변경과 내 입력을 반영했습니다. 내용을 검토한 뒤 저장해 주세요.')
  }
  const managementUnit = detail?.units.find((value) => value.id === session.management?.unitId)
  function submitManagement(event: FormEvent) {
    event.preventDefault()
    const form = session.management
    if (blocked || !detail || !form || !managementUnit || !form.confirmed || !form.reason.trim())
      return
    if (
      managementUnit.version !== form.expectedVersion ||
      (form.kind === 'withdraw' && managementUnit.currentSubmissionId !== form.submissionId)
    ) {
      setSession({ ...session, conflict: true })
      setComparison({ detail })
      return
    }
    if (form.kind === 'withdraw' && form.submissionId)
      void mutate({
        kind: 'withdraw',
        requestId: detail.request.id,
        unitId: form.unitId,
        submissionId: form.submissionId,
        expectedVersion: form.expectedVersion,
        reason: form.reason,
      })
    if (
      form.kind === 'open_correction' &&
      !submissionClosed &&
      form.dueDate &&
      form.dueDate >= date
    )
      void mutate({
        kind: 'open_correction',
        requestId: detail.request.id,
        unitId: form.unitId,
        expectedVersion: form.expectedVersion,
        dueDate: form.dueDate,
        reason: form.reason,
      })
  }

  return {
    allowedMembers,
    attachGenerated,
    blocked,
    busy,
    canRetainAction,
    canShowAnswer,
    canShowEditor,
    chooseFile,
    compareLatest,
    comparison,
    comparisonUnit,
    cursor,
    date,
    detail,
    dirty,
    download,
    enabled,
    error,
    exportBusy,
    focusNext,
    hadSubmission,
    hasWork,
    history,
    incomingFile,
    inputBlocked,
    list,
    loading,
    locked,
    managementUnit,
    member,
    memberLabel,
    members,
    mutate,
    newCollectionPolicy,
    notice,
    openAnswer,
    operationState,
    operations,
    panelRef,
    parkEditing,
    parked,
    pending,
    pickerId,
    publishReview,
    readError,
    readiness,
    reload,
    resetEditing,
    restoring,
    resumeEditing,
    retainComparedInput,
    revision,
    saveEditor,
    savingRequest,
    selectTemplates,
    selectedId,
    selectedUnit,
    server,
    session,
    setCursor,
    setDetail,
    setError,
    setExportBusy,
    setHistory,
    setNotice,
    setOperationState,
    setOperationsLocked,
    setPublishReview,
    setReload,
    setSession,
    statuses,
    submissionClosed,
    submissionGuide,
    submitManagement,
    unitValidation,
    uploadFile,
  }
}
