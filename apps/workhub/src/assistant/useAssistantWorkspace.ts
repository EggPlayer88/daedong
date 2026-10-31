import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { activeAt } from '../domain'
import {
  assistantInput,
  freshAssistantInput,
  precisionReviewInput,
  confirmTask,
  AssistantError,
  assistantError,
  definiteFailure,
  TASK_INPUT_LIMITS,
  type AssistantIntent,
  type AssistantMode,
  type Readiness,
  type TaskProposal,
  type ThreadSummary,
  type Exchange,
} from './contracts'
import { createAssistantServer } from './server'
import { createSchoolAiSettingsServer } from './school-settings-server'
import type { SchoolAiStatus } from './school-settings-contracts'
import { legacySchoolAiHttp } from './legacy-http'
import { legacyAssistantHttp } from './legacy-http'
import { knowledgeCitationRequest } from '../knowledge/assistant-links'
import type { Citation } from './contracts'
import {
  AssistantPanelProps,
  Pending,
  Session,
  initial,
  pendingCommand,
  newKey,
} from './workspace-model'
export function useAssistantWorkspace({
  connection,
  member,
  date,
  revision = 0,
  onNavigationLockChange,
  onUpdated,
  contextRequest,
  onDraftReady,
  onComposeMessage,
  onOpenTask,
  onOpenKnowledgeCitation,
  server: provided,
  settingsServer: providedSettings,
  memoryServer,
}: AssistantPanelProps) {
  const server = useMemo(
      () =>
        provided ?? createAssistantServer(connection, legacyAssistantHttp, { policyReads: true }),
      [provided, connection],
    ),
    memory = useEditDraft<Session>(member, 'assistant'),
    recovery = usePendingRequest(member, 'assistant')
  const [session, setSession] = useState<Session>(() => {
      const saved = memory.initial ?? initial
      if (recovery.request) {
        try {
          const command = pendingCommand(recovery.request.command)
          if (command.kind === 'ask')
            return {
              ...saved,
              mode: command.input.mode,
              intent: command.input.intent,
              prompt: command.input.prompt,
              references: command.input.references,
              studentContext: command.input.studentContext,
            }
        } catch {}
      }
      return saved
    }),
    latest = useRef(session),
    life = useRef(0),
    operation = useRef(false),
    uid = useId()
  const [ready, setReady] = useState<Readiness>(),
    [threads, setThreads] = useState<ThreadSummary[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [readError, setReadError] = useState('')
  const settingsServer = useMemo(
    () => providedSettings ?? createSchoolAiSettingsServer(connection, legacySchoolAiHttp),
    [providedSettings, connection],
  )
  const [schoolStatus, setSchoolStatus] = useState<SchoolAiStatus>(),
    [budgetError, setBudgetError] = useState('')
  useEffect(() => {
    let cancelled = false
    setSchoolStatus(undefined)
    setBudgetError('')
    if (!activeAt(member, date)) return
    void settingsServer
      .status(member.id)
      .then((value) => {
        if (!cancelled) setSchoolStatus(value)
      })
      .catch(() => {
        if (!cancelled)
          setBudgetError(
            '학교 예산을 확인하지 못했습니다. 요청 시 서버에서 이용 가능 여부를 다시 확인합니다.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [settingsServer, member.id, date, revision, refresh])
  const [reviewConfirm, setReviewConfirm] = useState<string>()
  const [openingCitation, setOpeningCitation] = useState(false),
    citationFlight = useRef(false)
  let pending: Pending | undefined
  try {
    if (recovery.request) pending = pendingCommand(recovery.request.command)
  } catch {
    /* 보존한 원문이 읽히지 않으면 임의로 지우지 않는다. */
  }
  const [memoryLocked, setMemoryLocked] = useState(false)
  const enabled = activeAt(member, date),
    locked = Boolean(
      session.prompt.trim() || session.proposal || recovery.request || busy || memoryLocked,
    ),
    baseEditable = enabled && ready?.available === true && !busy && !recovery.request && !readError,
    editable = baseEditable && !memoryLocked
  function update(value: Session) {
    latest.current = value
    memory.save(value, Boolean(value.prompt.trim() || value.proposal))
    setSession(value)
  }
  useEffect(
    () => () => {
      life.current++
    },
    [server],
  )
  // 단순 질문 초안은 옆자리와 탭 메모리에 남는다. 처리·복구·편집 확정 중에만 메뉴 이동을 막는다.
  const navigationLocked = Boolean(session.proposal || recovery.request || busy || memoryLocked)
  useEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => onNavigationLockChange?.(false)
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!locked) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [locked])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReadError('')
    if (!enabled) {
      setReady(undefined)
      setReadError('학교 소속 기간을 확인해 주세요.')
      setLoading(false)
      return
    }
    void server
      .readiness(member.id)
      .then(async (value) => {
        if (cancelled) return
        setReady(value)
        if (!value.available) {
          setThreads([])
          return
        }
        const result = await server.list(member.id, session.mode)
        if (!cancelled) {
          setThreads(result.items)
          setNextCursor(result.nextCursor)
        }
        const selected = latest.current.thread
        if (selected) {
          const current = await server.get(member.id, selected.id)
          if (current.mode !== session.mode) throw new AssistantError('INVALID_RESPONSE')
          if (
            !cancelled &&
            latest.current.thread?.id === selected.id &&
            latest.current.thread.version === selected.version
          )
            update({ ...latest.current, thread: current })
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setReadError(assistantError(failure).message)
          setThreads([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [server, member.id, enabled, session.mode, revision, refresh])
  async function loadThread(id: string) {
    if (!editable || locked || operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    const epoch = life.current
    try {
      const value = await server.get(member.id, id)
      if (life.current === epoch && value.mode === latest.current.mode)
        update({ ...latest.current, thread: value })
    } catch (failure) {
      if (life.current === epoch) setError(assistantError(failure).message)
    } finally {
      if (life.current === epoch) {
        operation.current = false
        setBusy(false)
      }
    }
  }
  async function moreThreads() {
    if (!nextCursor || loading || operation.current) return
    const epoch = life.current
    operation.current = true
    setLoading(true)
    try {
      const value = await server.list(member.id, latest.current.mode, nextCursor)
      if (life.current !== epoch) return
      setThreads((previous) => [
        ...previous,
        ...value.items.filter((row) => !previous.some((old) => old.id === row.id)),
      ])
      setNextCursor(value.nextCursor)
    } catch (failure) {
      if (life.current === epoch) setReadError(assistantError(failure).message)
    } finally {
      if (life.current === epoch) {
        operation.current = false
        setLoading(false)
      }
    }
  }
  async function moreMessages() {
    const current = latest.current.thread
    if (!current?.nextCursor || !editable || operation.current) return
    operation.current = true
    setBusy(true)
    const epoch = life.current
    try {
      const value = await server.get(member.id, current.id, current.nextCursor)
      if (life.current !== epoch) return
      if (value.version !== current.version) throw new AssistantError('CONFLICT')
      update({
        ...latest.current,
        thread: {
          ...value,
          exchanges: [
            ...value.exchanges.filter((row) => !current.exchanges.some((old) => old.id === row.id)),
            ...current.exchanges,
          ],
        },
      })
    } catch (failure) {
      if (life.current === epoch) setError(assistantError(failure).message)
    } finally {
      if (life.current === epoch) {
        operation.current = false
        setBusy(false)
      }
    }
  }
  async function execute(command: Pending, key: string, closing = false) {
    if (operation.current || !enabled) return
    operation.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const epoch = life.current,
      isClosing = command.kind === 'ask' && (closing || recovery.request?.closeState === 'closing')
    recovery.put({ command, key, ...(isClosing ? { closeState: 'closing' as const } : {}) })
    try {
      if (command.kind === 'ask') {
        const result = isClosing
          ? await server.close!(member.id, command.input, key)
          : await server.ask(member.id, command.input, key)
        if (life.current !== epoch) return
        if (result.state === 'closed') {
          recovery.remove(key)
          setNotice(
            'AI 요청을 닫았습니다. 늦게 도착한 요청은 새 답변을 만들지 않습니다. 작성한 입력은 유지합니다.',
          )
          return
        }
        if (isClosing && result.state === 'rejected') {
          setError(
            '원래 요청이 종료되었으나 닫힘 또는 완료 확인이 필요합니다. 같은 번호로 닫기 결과를 다시 확인해 주세요.',
          )
          return
        }
        if (result.state === 'pending') {
          setNotice(
            result.reason === 'provider_unknown'
              ? 'AI 응답 여부를 확인 중입니다. 같은 요청을 확인해도 AI를 새로 호출하지 않습니다.'
              : '기존 요청을 처리 중입니다. 잠시 뒤 같은 요청으로 확인해 주세요.',
          )
          return
        }
        recovery.remove(key)
        if (result.state === 'rejected') {
          setError(
            result.code === 'COUNT_FAILED'
              ? '사용량을 미리 계산하지 못해 유료 답변 생성을 시작하지 않았습니다. 입력을 유지했습니다.'
              : result.code === 'INPUT_TOO_LARGE'
                ? '선택한 자료가 한 번에 처리할 수 있는 범위를 넘었습니다. 범위를 줄여 다시 요청해 주세요.'
                : result.code === 'TRUNCATED'
                  ? '답변 길이 제한으로 초안을 완료하지 못했습니다. 요청 범위를 줄여 다시 요청해 주세요.'
                  : result.code === 'OUTPUT_INVALID'
                    ? '근거와 형식 검증을 통과하지 못했습니다. 답변을 저장하지 않았습니다.'
                    : 'AI 요청이 거절되었습니다. 설정과 이용 가능 상태를 확인해 주세요.',
          )
          return
        }
        update({
          ...latest.current,
          thread: result.thread,
          prompt: '',
          references: [],
          studentContext: null,
          proposal: undefined,
          taskReview: false,
        })
        setNotice('답변과 근거를 확인해 주세요.')
        setRefresh((value) => value + 1)
      } else {
        const result = await server.confirmTask(member.id, command.input, key)
        if (life.current !== epoch) return
        recovery.remove(key)
        const current = latest.current
        update({
          ...current,
          proposal: undefined,
          taskReview: false,
          thread: current.thread
            ? {
                ...current.thread,
                version: result.threadVersion,
                exchanges: current.thread.exchanges.map((row) =>
                  row.proposal?.id === result.proposalId
                    ? {
                        ...row,
                        proposal: {
                          ...row.proposal,
                          status: 'applied',
                          version: result.proposalVersion,
                          resourceId: result.taskId,
                        },
                      }
                    : row,
                ),
              }
            : undefined,
        })
        setNotice('개인 할 일에 추가했습니다.')
        onUpdated?.()
      }
    } catch (failure) {
      if (life.current !== epoch) return
      const mapped = assistantError(failure, 'RESULT_UNKNOWN')
      if (!isClosing && definiteFailure(mapped)) recovery.remove(key)
      setError(mapped.message)
    } finally {
      if (life.current === epoch) {
        operation.current = false
        setBusy(false)
      }
    }
  }
  function ask() {
    if (!editable || operation.current) return
    try {
      const current = latest.current,
        input = freshAssistantInput({
          mode: current.mode,
          intent: current.intent,
          prompt: current.prompt,
          threadId: current.thread?.id ?? null,
          expectedVersion: current.thread?.version ?? 0,
          references: current.references,
          studentContext: current.studentContext,
        })
      const key = newKey()
      if (current.contextId)
        update({
          ...current,
          requestContexts: { ...current.requestContexts, [key]: current.contextId },
        })
      void execute({ kind: 'ask', input }, key)
    } catch {
      setError('질문 내용과 선택한 근거를 확인해 주세요.')
    }
  }
  function reviewAnswer(source: Exchange) {
    if (!editable || locked || operation.current || !latest.current.thread) return
    try {
      const current = latest.current,
        input = precisionReviewInput(current.thread!, source),
        key = newKey()
      const contextId = current.requestContexts?.[source.requestKey]
      if (contextId)
        update({ ...current, requestContexts: { ...current.requestContexts, [key]: contextId } })
      void execute({ kind: 'ask', input }, key)
    } catch {
      setError('정밀 검토할 원래 답변과 대화 상태를 다시 확인해 주세요.')
    }
  }
  function applyContext() {
    if (!contextRequest || locked || operation.current) return
    const request = contextRequest.request
    try {
      const input = assistantInput({
        ...request,
        prompt: request.prompt?.trim() || '선택한 자료를 바탕으로 초안을 작성해 주세요.',
        threadId: null,
        expectedVersion: 0,
      })
      update({
        ...initial,
        mode: input.mode,
        intent: input.intent,
        prompt: request.prompt ?? '',
        references: input.references,
        studentContext: input.studentContext,
        contextId: contextRequest.id,
      })
      setError('')
      setNotice('전달받은 요청을 불러왔습니다. 내용을 확인한 뒤 보내 주세요.')
    } catch {
      setError('전달받은 근거의 형식을 확인해 주세요.')
    }
  }
  function changeMode(mode: AssistantMode) {
    if (locked || operation.current) return
    update({ ...initial, mode, intent: mode === 'school' ? 'school_advice' : 'personal_assistant' })
    setError('')
    setNotice('')
  }
  function changeIntent(intent: AssistantIntent) {
    if (!editable) return
    update({
      ...latest.current,
      intent,
      studentContext: intent === 'student_record_draft' ? latest.current.studentContext : null,
    })
  }
  async function openKnowledgeCitation(citation: Citation) {
    if (!onOpenKnowledgeCitation || !editable || locked || loading || citationFlight.current) return
    const epoch = life.current
    citationFlight.current = true
    setOpeningCitation(true)
    setError('')
    try {
      await onOpenKnowledgeCitation(knowledgeCitationRequest(citation, member))
    } catch {
      if (epoch === life.current)
        setError('인용 원문을 열지 못했습니다. 답변과 작성 중인 입력은 그대로 유지했습니다.')
    } finally {
      citationFlight.current = false
      if (epoch === life.current) setOpeningCitation(false)
    }
  }
  function openTask(proposal: TaskProposal) {
    if (!onOpenTask || !editable || locked || loading || operation.current) return
    const current = latest.current.thread?.exchanges.find(
      (row) => row.proposal?.id === proposal.id,
    )?.proposal
    if (
      current?.status !== 'applied' ||
      !current.resourceId ||
      current.resourceId !== proposal.resourceId
    )
      return
    // 서버가 확인한 원본 번호로만 이동한다. 이동을 위해 제안을 다시 저장하지 않는다.
    try {
      onOpenTask(current.resourceId)
    } catch {
      setError('추가한 할 일을 열지 못했습니다. 답변과 작성 중인 입력은 그대로 유지했습니다.')
    }
  }
  const draft = session.proposal
  let taskIssue = ''
  if (draft) {
    if (!draft.input.title.trim()) taskIssue = '할 일 제목을 입력해 주세요.'
    else if (Array.from(draft.input.title).length > TASK_INPUT_LIMITS.titleChars)
      taskIssue = `할 일 제목은 ${TASK_INPUT_LIMITS.titleChars}자 이내로 줄여 주세요. 원문은 그대로 보관합니다.`
    else if (Array.from(draft.input.notes).length > TASK_INPUT_LIMITS.notesChars)
      taskIssue = `할 일 메모는 ${TASK_INPUT_LIMITS.notesChars}자 이내로 줄여 주세요. 원문은 그대로 보관합니다.`
    else {
      try {
        confirmTask({
          threadId: session.thread?.id,
          proposalId: draft.id,
          expectedVersion: draft.version,
          input: draft.input,
        })
      } catch {
        taskIssue = '할 일 제목·메모의 문자와 날짜를 확인해 주세요.'
      }
    }
  }
  function reviewTask() {
    if (!draft || !editable || taskIssue) return
    try {
      const checked = confirmTask({
        threadId: session.thread?.id,
        proposalId: draft.id,
        expectedVersion: draft.version,
        input: draft.input,
      })
      update({ ...latest.current, proposal: { ...draft, input: checked.input }, taskReview: true })
      setError('')
    } catch {
      setError('할 일 제목·메모의 문자와 날짜를 확인해 주세요.')
    }
  }
  function addTask() {
    if (!draft || !editable || taskIssue || !session.taskReview) return
    try {
      const checked = confirmTask({
        threadId: session.thread?.id,
        proposalId: draft.id,
        expectedVersion: draft.version,
        input: draft.input,
      })
      void execute({ kind: 'confirmTask', input: checked }, newKey())
    } catch {
      setError('할 일 제목·메모의 문자와 날짜를 확인해 주세요.')
    }
  }

  return {
    addTask,
    applyContext,
    ask,
    baseEditable,
    budgetError,
    busy,
    changeIntent,
    changeMode,
    connection,
    contextRequest,
    date,
    draft,
    editable,
    enabled,
    error,
    execute,
    latest,
    loadThread,
    loading,
    locked,
    member,
    memoryLocked,
    memoryServer,
    moreMessages,
    moreThreads,
    nextCursor,
    notice,
    onComposeMessage,
    onDraftReady,
    onOpenKnowledgeCitation,
    onOpenTask,
    openKnowledgeCitation,
    openTask,
    openingCitation,
    operation,
    pending,
    readError,
    ready,
    recovery,
    reviewAnswer,
    reviewConfirm,
    reviewTask,
    revision,
    schoolStatus,
    server,
    session,
    setError,
    setMemoryLocked,
    setNotice,
    setRefresh,
    setReviewConfirm,
    taskIssue,
    threads,
    uid,
    update,
  }
}
