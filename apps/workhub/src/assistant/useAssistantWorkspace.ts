import { useWorkspacePlan } from './useWorkspacePlan'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
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
  ASSISTANT_LIMITS,
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
import type { SearchItem } from '../search/contracts'
import { parseWorkspaceCommand, type WorkspaceCommand } from './workspace-commands'
import type { DirectDraftCommand } from './draft-commands'
import { useDraftContinuation } from './useDraftContinuation'
import { calendarQuestion, continueCalendar } from './calendar-conversation'
import type { TaskChangeCommand } from './task-change-command'
import type { AssistantWorkspaceSearchResult } from './workspace-model'
import { composeConversationPrompt, readConversationPrompt, conversationPromptLimit, inferConversationProfile, conversationProfile as profileFor, CONVERSATION_PROFILES, type ConversationFocus } from './conversation-guidance'
import { useWorkspaceOperation } from './useWorkspaceOperation'
import {
  AssistantPanelProps,
  Pending,
  Session,
  initial,
  pendingCommand,
  newKey,
} from './workspace-model'
export function useAssistantWorkspace({
  workActive = false,
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
  workspaceActions,
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
              prompt: readConversationPrompt(command.input.prompt).prompt,
              conversationFocus: readConversationPrompt(command.input.prompt).profileId,
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
  const [searchResult, setWorkspaceResult] = useState<{
    prompt: string
    query: string
    result: AssistantWorkspaceSearchResult
    scope: object
    taskChange?: TaskChangeCommand
  }>()
  const [workspaceSearching, setWorkspaceSearching] = useState(false)
  const [workspaceActionNotice, setWorkspaceActionNotice] = useState<{ prompt: string; message: string }>()
  const searchFlight = useRef<AbortController>()
  const searchEpoch = useRef(0)
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
  const workspaceOperation = useWorkspaceOperation({ member, date, actions: workspaceActions?.operations, onSaved: () => {
    update({ ...latest.current, prompt: '', calendarDialogue: undefined })
    setWorkspaceResult(undefined)
    onUpdated?.()
  } })
  const conversationFocus = session.conversationFocus ?? 'auto'
  const conversationProfile = profileFor(conversationFocus === 'auto' ? inferConversationProfile(session) : conversationFocus)
  const canChangeConversationFocus = !workActive && !busy && !recovery.request && !workspaceOperation.locked && !memoryLocked && !session.proposal
  function setConversationFocus(value: ConversationFocus) {
    if (!canChangeConversationFocus || operation.current || (value !== 'auto' && !CONVERSATION_PROFILES.some(row => row.id === value))) return
    update({ ...latest.current, conversationFocus: value })
  }
  const enabled = activeAt(member, date),
    locked = Boolean(
      workActive || session.workspacePlan || session.prompt.trim() || session.calendarDialogue || session.draftDialogue || session.proposal || recovery.request || busy || memoryLocked || workspaceOperation.locked,
    ),
    baseEditable = !workActive && enabled && ready?.available === true && !busy && !recovery.request && !readError && !workspaceOperation.locked,
    editable = baseEditable && !memoryLocked
  const workspaceEditable = !workActive && Boolean(workspaceActions) && enabled && !busy && !recovery.request &&
    !memoryLocked && !session.proposal && !openingCitation && !workspaceOperation.locked
  // 다른 화면이 고정한 원문·학생 근거와 AI 출력은 명령으로 해석하지 않는다.
  const commandContext = Boolean(workspaceActions) && !session.contextId &&
    !session.references.length && !session.studentContext
  const scope = useMemo(() => ({}), [member.id, member.schoolId, date, enabled, revision, server])
  const dialogueScope = recoveryScope(member)
  const workspaceResult = commandContext && enabled && searchResult?.scope === scope ? searchResult : undefined
  const calendarFollowup = commandContext && enabled && session.calendarDialogue?.basisDate === date &&
    session.calendarDialogue.scope === dialogueScope ? session.calendarDialogue.command : undefined
  function draftOpened(command: DirectDraftCommand) {
    const destination = command.kind === 'messageDraft' ? '메시지' : '수합'
    setWorkspaceActionNotice({ prompt: command.prompt, message: workspaceActions?.deliveryInConversation
      ? `${destination} 작업을 대화 안에서 열었습니다. 마지막 확인 전에는 전송·저장하지 않습니다.`
      : `${destination} 화면에서 초안을 확인해 주세요.` })
    setWorkspaceResult(undefined)
    update({ ...latest.current, prompt: '', draftDialogue: undefined })
    setError('')
    setNotice('')
  }
  const continuation = useDraftContinuation({
    session, latest, update, actions: workspaceActions, scope: dialogueScope, basisDate: date, revision,
    active: commandContext && enabled, editable: workspaceEditable, opened: draftOpened,
    feedback: (error, notice = '') => { setError(error); setNotice(notice) },
  })
  // 이어지는 답은 현재 초안에만 사용한다. 잘못된 날짜나 이름도 유료 질문이 되지 않는다.
  const workspaceCommand = commandContext
    ? continuation.draftFollowup?.command ?? calendarFollowup ?? parseWorkspaceCommand(session.prompt, date)
    : null
  const workspacePlan = useWorkspacePlan({ session, latest, scope: dialogueScope, date, active: commandContext && enabled,
    editable: workspaceEditable && !operation.current, update,
    feedback: (error, notice = '') => { setError(error); setNotice(notice) },
    selected: () => { setWorkspaceResult(undefined); setWorkspaceActionNotice(undefined) },
  })
  const freeCommand = Boolean(workspacePlan.candidate) || (workspaceCommand && workspaceCommand.kind !== 'task')
  const promptLimit = freeCommand ? ASSISTANT_LIMITS.promptChars : conversationPromptLimit(conversationProfile.id, session.prompt)
  const canSubmit = !workspacePlan.blockedSelection && (freeCommand ? workspaceEditable : editable)
  const submitLabel = workspacePlan.candidate ? (workspacePlan.candidate.kind === 'plan' ? '업무 나누기' : '요청 확인') : continuation.draftFollowup ? '초안 정보 이어 입력' : calendarFollowup ? '일정 정보 이어 입력' :
    workspaceCommand?.kind === 'taskChange' ? '내 할 일 찾기' :
    workspaceCommand?.kind === 'specialist' ? '업무 시작' :
    workspaceCommand?.kind === 'navigate' ? '바로 이동' :
    workspaceCommand?.kind === 'search' ? '자료 찾기' :
    workspaceCommand?.kind === 'messageDraft' ? (workspaceCommand.firstTurn ? '메시지 초안 확인' : '메시지 초안 열기') :
    workspaceCommand?.kind === 'collectionDraft' ? (workspaceCommand.firstTurn ? '수합 초안 확인' : '수합 초안 열기') :
    workspaceCommand?.kind === 'calendar' ? '일정 초안 열기' :
    workspaceCommand?.kind === 'clarify' ? '요청 확인' : 'AI에게 요청'
  function update(value: Session) {
    latest.current = value
    memory.save(value, Boolean(value.workspacePlan || value.prompt.trim() || value.proposal || value.calendarDialogue || value.draftDialogue))
    setSession(value)
  }
  useEffect(
    () => () => {
      life.current++
    },
    [server],
  )
  useEffect(() => {
    const current = latest.current
    // 창 복귀 재조회는 입력을 유지하고, 실제 소속·권한·기준일이 바뀔 때만 닫는다.
    if (current.draftDialogue && (!enabled || !commandContext ||
        current.draftDialogue.scope !== dialogueScope || current.draftDialogue.basisDate !== date)) {
      update({ ...current, prompt: '', draftDialogue: undefined })
      setNotice('학교 연결이나 기준일이 바뀌어 이전 초안 입력을 닫았습니다.')
      return
    }
    if (current.calendarDialogue && (!enabled || !commandContext ||
        current.calendarDialogue.basisDate !== date || current.calendarDialogue.scope !== dialogueScope)) {
      update({ ...current, prompt: '', calendarDialogue: undefined })
      setNotice('학교 연결이나 기준일이 바뀌어 이전 일정 입력을 닫았습니다.')
    }
  }, [commandContext, enabled, date, dialogueScope])
  useEffect(() => {
    setWorkspaceResult(undefined)
    setWorkspaceActionNotice(undefined)
    return () => {
      searchEpoch.current++
      searchFlight.current?.abort()
      if (searchFlight.current) {
        searchFlight.current = undefined
        operation.current = false
        setBusy(false)
        setWorkspaceSearching(false)
      }
    }
  }, [member.id, member.schoolId, date, enabled, revision, server])
  // 단순 질문 초안은 옆자리와 탭 메모리에 남는다. 처리·복구·편집 확정 중에만 메뉴 이동을 막는다.
  const navigationLocked = Boolean(session.proposal || recovery.request || busy || memoryLocked || workspaceOperation.locked)
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
  async function searchWorkspace(command: Extract<WorkspaceCommand, { kind: 'search' }> | TaskChangeCommand) {
    if (!workspaceActions || !workspaceEditable || operation.current) return
    if (command.kind === 'taskChange' && !workspaceActions.changeTask && !workspaceActions.operations) {
      setError('현재 화면에서는 할 일 변경을 준비할 수 없습니다. 내 업무에서 확인해 주세요.')
      return
    }
    operation.current = true
    setBusy(true)
    setWorkspaceSearching(true)
    setWorkspaceResult(undefined)
    setError('')
    setNotice('')
    const epoch = ++searchEpoch.current, lifecycle = life.current,
      controller = new AbortController(), prompt = latest.current.prompt
    searchFlight.current?.abort()
    searchFlight.current = controller
    try {
      const result = await workspaceActions.search(command.query, command.kind === 'taskChange' ? ['task'] : command.kinds, controller.signal)
      if (controller.signal.aborted || searchEpoch.current !== epoch || life.current !== lifecycle) return
      setWorkspaceResult({ prompt, query: command.query, scope, result,
        ...(command.kind === 'taskChange' ? { taskChange: command } : {}) })
      update({ ...latest.current, prompt: '' })
    } catch {
      if (!controller.signal.aborted && searchEpoch.current === epoch && life.current === lifecycle)
        setError('자료를 찾지 못했습니다. 입력은 유지했습니다. 잠시 뒤 다시 확인해 주세요.')
    } finally {
      if (life.current === lifecycle && searchFlight.current === controller) {
        searchFlight.current = undefined
        operation.current = false
        setBusy(false)
        setWorkspaceSearching(false)
      }
    }
  }
  function openWorkspaceItem(item: SearchItem) {
    if (!workspaceActions || !workspaceEditable || operation.current || latest.current.prompt.trim()) return
    const found = workspaceResult?.result.items.find((row) => row === item)
    if (!found) return
    try {
      if (workspaceResult?.taskChange) {
        if (workspaceActions.operations && found.kind === 'task' && Number.isSafeInteger(found.version)) {
          const selected = workspaceResult
          void workspaceOperation.prepare(selected.prompt, () => workspaceActions.operations!.prepareTask(selected.taskChange!, found))
          setError('')
          return
        }
        if (found.kind !== 'task' || !Number.isSafeInteger(found.version) || !workspaceActions.changeTask?.(workspaceResult.taskChange, found))
          throw new Error('업무 확인 보류')
        setWorkspaceActionNotice({ prompt: workspaceResult.prompt, message: '내 업무에서 변경 내용을 확인해 주세요. 아직 저장하지 않았습니다.' })
        setWorkspaceResult(undefined)
      } else if (!workspaceActions.open(found)) throw new Error('이동 보류')
      setError('')
    } catch {
      setError(workspaceResult?.taskChange ? '할 일을 열지 못했습니다. 현재 작성 중인 작업을 마친 뒤 다시 선택해 주세요.'
        : '자료를 열지 못했습니다. 현재 작성 중인 작업을 확인한 뒤 다시 열어 주세요.')
    }
  }
  function cancelCalendar() {
    if (!calendarFollowup || !workspaceEditable || operation.current) return
    update({ ...latest.current, prompt: '', calendarDialogue: undefined })
    setError('')
    setNotice('일정 작성을 취소했습니다. 저장한 일정은 없습니다.')
  }
  function startDraftFollowup(command: DirectDraftCommand) {
    continuation.startDraftFollowup(command)
    setWorkspaceResult(undefined)
    setWorkspaceActionNotice(undefined)
  }
  function ask() {
    if (latest.current.draftDialogue) { void continuation.reply(); return }
    if (workspacePlan.blockedSelection) { setError('계획의 기준 날짜가 바뀌었습니다. 입력을 유지했으니 현재 날짜로 다시 검토해 주세요.'); return }
    if (workspacePlan.build()) return
    let command = workspaceCommand
    if (latest.current.calendarDialogue && !calendarFollowup) return
    if (calendarFollowup && workspaceEditable && !operation.current) {
      const turn = continueCalendar(calendarFollowup, latest.current.prompt, date)
      if (turn.kind === 'cancel') { cancelCalendar(); return }
      if (turn.kind === 'clarify') { setError(turn.message); setNotice(''); return }
      command = turn.command
    }
    if (workspaceCommand && !workspaceEditable) return
    if (command && workspaceEditable && !operation.current) {
      if (command.kind === 'clarify') {
        setNotice(command.message)
        setError('')
        return
      }
      if (command.kind === 'specialist') {
        if (!workspaceActions?.specialist?.(command)) {
          setError('업무를 열지 못했습니다. 작성 중인 내용이나 결과 확인을 먼저 마쳐 주세요. 요청은 유지했습니다.')
          return
        }
        setWorkspaceActionNotice({ prompt: latest.current.prompt, message: '대상과 현재 원본을 확인할 업무를 열었습니다. 변경은 검토 후 직접 확정합니다.' })
        setWorkspaceResult(undefined); setNotice(''); setError('')
        update({ ...latest.current, prompt: '' })
        return
      }
      if (command.kind === 'search' || command.kind === 'taskChange') {
        void searchWorkspace(command)
        return
      }
      if (command.kind === 'messageDraft' || command.kind === 'collectionDraft') {
        if (command.firstTurn) {
          if (!workspaceActions?.findDraftPeople) { setError('연결된 업무실에서 초안을 확인해 주세요.'); return }
          startDraftFollowup(command)
          return
        }
        const destination = command.kind === 'messageDraft' ? '메시지' : '수합'
        if (!workspaceActions?.prepareDraft?.(command)) {
          setError(`${destination} 초안을 열 수 없습니다. 작성 중인 입력이나 확인할 요청을 마친 뒤 다시 시도해 주세요. 원문은 유지했습니다.`)
          return
        }
        draftOpened(command)
        return
      }
      if (command.kind === 'navigate' || command.kind === 'calendar') {
        if (command.kind === 'calendar' && calendarQuestion(command)) {
          update({ ...latest.current, prompt: '', calendarDialogue: { command, basisDate: date, scope: dialogueScope } })
          setWorkspaceResult(undefined)
          setWorkspaceActionNotice(undefined)
          setNotice('')
          setError('')
          return
        }
        if (command.kind === 'calendar' && workspaceActions?.operations) {
          const calendarCommand = command
          void workspaceOperation.prepare(command.prompt, () => workspaceActions.operations!.prepareCalendar(calendarCommand))
          setError(''); setNotice('')
          return
        }
        try {
          // 이동 전에 busy를 세우면 부모의 기존 이동 보호가 자기 요청까지 막으므로 동기로 넘긴다.
          const accepted = command.kind === 'navigate'
            ? workspaceActions!.navigate(command.page)
            : workspaceActions!.calendar(command)
          if (!accepted) throw new Error('기존 작업 확인 필요')
          setWorkspaceActionNotice({ prompt: command.kind === 'calendar' ? command.prompt : latest.current.prompt,
            message: command.kind === 'calendar'
              ? '일정 화면에서 초안을 확인한 뒤 저장해 주세요. 아직 저장하지 않았습니다.'
              : '요청한 화면을 열었습니다.' })
          setWorkspaceResult(undefined)
          update({ ...latest.current, prompt: '', calendarDialogue: undefined })
          setError('')
          setNotice('')
        } catch {
          setError('화면을 열지 못했습니다. 입력은 유지했습니다. 현재 작성 중인 작업과 이용 가능한 메뉴를 확인해 주세요.')
        }
        return
      }
    }
    if (!editable || operation.current) return
    try {
      let current = latest.current
      if (workspaceCommand?.kind === 'task' && workspaceEditable) {
        current = {
          ...current, mode: 'personal', intent: 'personal_assistant',
          thread: current.mode === 'personal' && current.intent === 'personal_assistant'
            ? current.thread : undefined,
        }
        update(current)
      }
      const
        input = freshAssistantInput({
          mode: current.mode,
          intent: current.intent,
          prompt: composeConversationPrompt(current.prompt, conversationFocus === 'auto' ? inferConversationProfile(current) : conversationProfile.id),
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
    if (!editable || calendarFollowup || continuation.draftFollowup) return
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
    canSubmit,
    ...continuation,
    startDraftFollowup: () => {
      if (workspaceCommand?.kind !== 'messageDraft' && workspaceCommand?.kind !== 'collectionDraft') return
      startDraftFollowup(workspaceCommand)
    },
    calendarFollowup,
    cancelCalendar,
    dismissTaskMatches: () => { setWorkspaceResult(undefined); setError(''); setNotice('할 일 선택을 닫았습니다. 변경한 내용은 없습니다.') },
    baseEditable,
    budgetError,
    busy,
    changeIntent,
    changeMode,
    connection,
    conversationFocus,
    promptLimit,
    canChangeConversationFocus,
    conversationProfile,
    setConversationFocus,
    workspaceOperation,
    workspacePlan,
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
    openWorkspaceItem,
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
    submitLabel,
    setError,
    setMemoryLocked,
    setNotice,
    setRefresh,
    setReviewConfirm,
    taskIssue,
    threads,
    uid,
    update,
    workspaceActions,
    workspaceActionNotice,
    workspaceCommand,
    workspaceEditable,
    workspaceResult,
    workspaceSearching,
  }
}
