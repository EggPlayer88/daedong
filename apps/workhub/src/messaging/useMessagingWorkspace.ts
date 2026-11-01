import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import {
  MessagingError,
  type InboxNotice,
  type Message,
  type MessageCommand,
  type MessagingReadiness,
  type Page,
  type Recipient,
  type ThreadSummary,
} from './contracts'
import { createSupabaseMessagingServer } from './supabase-messaging'
import {
  blankMessageDraft,
  isMessageDraftDirty,
  messageAttempt,
  newMessageKey,
  retryMessageAttempt,
  type MessageAttempt,
  type MessageDraft,
} from './composer'
import { restoreSentDelivery, sentDeliveryRecord, type SentDeliveryRecord } from './deliveries'
import { command as checkedCommand } from './validation'
import { createMessageFileServer } from './files'
import { requestBlobDownload } from '../files/download'
import {
  MessagingWorkspaceProps,
  DraftMemory,
  errorOf,
  timeLabel,
  sourceLabels,
  mergePage,
} from './workspace-model'
export function useMessagingWorkspace({
  openRequest,
  onReturnToSource,
  connection,
  member,
  date,
  revision = 0,
  onNavigationLockChange,
  onUpdated,
  onOpenSource,
  canOpenSource,
  composeRequest,
  onComposeRequestConsumed,
  server: provided,
  fileServer: providedFiles,
}: MessagingWorkspaceProps) {
  const server = useMemo(
    () => provided ?? createSupabaseMessagingServer(connection),
    [connection, provided],
  )
  const fileServer = useMemo(
    () => providedFiles ?? createMessageFileServer(connection),
    [connection, providedFiles],
  )
  const memory = useEditDraft<DraftMemory>(member, 'messaging-composer')
  const deliveryMemory = useEditDraft<SentDeliveryRecord>(member, 'messaging-latest-delivery')
  const [delivered, setDelivered] = useState(() =>
    restoreSentDelivery(deliveryMemory.initial, recoveryScope(member), member.id),
  )
  const recovery = usePendingRequest(member, 'messaging')
  const fileRecovery = usePendingRequest(member, 'messagingFile')
  const [restored] = useState(() => memory.initial)
  const [restoredPending] = useState<MessageAttempt | null>(() => {
    if (!recovery.request) return restored?.pending ?? null
    try {
      return {
        key: recovery.request.key,
        command: checkedCommand(recovery.request.command, member.id),
        recipientNames: restored?.pending?.recipientNames ?? [],
        recipientSnapshots: restored?.pending?.recipientSnapshots,
      }
    } catch {
      return null
    }
  })
  const [draft, setDraft] = useState<MessageDraft>(restored?.draft ?? blankMessageDraft())
  const [composing, setComposing] = useState(restored?.composing ?? false)
  const [pending, setPending] = useState<MessageAttempt | null>(restoredPending)
  const [folded, setFolded] = useState(Boolean(restoredPending) || restored?.folded === true)
  const [preview, setPreview] = useState<MessageAttempt | null>(null)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [fileLocked, setFileLocked] = useState(false)
  const [tab, setTab] = useState<'messages' | 'inbox'>('messages')
  const [readiness, setReadiness] = useState<MessagingReadiness | null>(null)
  const [readyError, setReadyError] = useState(''),
    [checking, setChecking] = useState(true),
    [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [unreadOnly, setUnreadOnly] = useState(false)
  const [threads, setThreads] = useState<Page<ThreadSummary>>({ items: [], nextCursor: null }),
    [loadingThreads, setLoadingThreads] = useState(false),
    [threadError, setThreadError] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null),
    [handledOpenKey, setHandledOpenKey] = useState('')
  const focusThread = useRef(false),
    threadHeading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<ThreadSummary | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false),
    [messageError, setMessageError] = useState('')
  const [inbox, setInbox] = useState<Page<InboxNotice>>({ items: [], nextCursor: null }),
    [loadingInbox, setLoadingInbox] = useState(false),
    [inboxError, setInboxError] = useState('')
  const [openingSource, setOpeningSource] = useState<string | null>(null),
    [sourceError, setSourceError] = useState<{ noticeId: string; message: string } | null>(null)
  const sourceInFlight = useRef(false)
  const [recipientQuery, setRecipientQuery] = useState(''),
    [recipientSearch, setRecipientSearch] = useState(''),
    [recipientRefresh, setRecipientRefresh] = useState(0)
  const [recipients, setRecipients] = useState<Page<Recipient>>({ items: [], nextCursor: null }),
    [loadingRecipients, setLoadingRecipients] = useState(false),
    [recipientError, setRecipientError] = useState('')
  const alive = useRef(true),
    inFlight = useRef(false),
    listGeneration = useRef(0),
    messageGeneration = useRef(0),
    recipientGeneration = useRef(0),
    inboxGeneration = useRef(0)
  const serverGeneration = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null),
    composerInput = useRef<HTMLTextAreaElement>(null),
    id = useId()
  const enabled = activeAt(member, date),
    usable = enabled && !denied && readiness?.available === true
  const dirty = composing && isMessageDraftDirty(draft),
    locked = busy || fileLocked || Boolean(pending || preview || openingSource)
  const navigationLocked =
    busy || fileLocked || Boolean(preview) || (!folded && (dirty || Boolean(pending)))
  const hasAnyDraft = dirty || Boolean(pending)
  const waitingOpen = Boolean(openRequest && openRequest.key !== handledOpenKey)
  useEffect(() => {
    alive.current = true
    serverGeneration.current++
    return () => {
      alive.current = false
      serverGeneration.current++
      listGeneration.current++
      messageGeneration.current++
      recipientGeneration.current++
      inboxGeneration.current++
    }
  }, [server])
  useEffect(() => {
    memory.save(hasAnyDraft ? { draft, composing, pending, folded } : undefined, hasAnyDraft)
  }, [memory, draft, composing, pending, folded, hasAnyDraft])
  useEffect(() => {
    deliveryMemory.save(delivered ?? undefined, false)
  }, [deliveryMemory, delivered])
  useEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => onNavigationLockChange?.(false)
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!hasAnyDraft) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasAnyDraft])
  function purge() {
    listGeneration.current++
    messageGeneration.current++
    recipientGeneration.current++
    inboxGeneration.current++
    setThreads({ items: [], nextCursor: null })
    setInbox({ items: [], nextCursor: null })
    setMessages([])
    setSelected(null)
    setOpenedId(null)
    focusThread.current = false
    setRecipients({ items: [], nextCursor: null })
    setPreview(null)
    setPending(null)
    recovery.remove()
    setDraft(blankMessageDraft())
    setComposing(false)
    memory.remove()
    setDenied(true)
    setDelivered(null)
    deliveryMemory.remove()
  }
  function report(failure: unknown, assign: (value: string) => void) {
    if (!alive.current) return
    const problem = errorOf(failure)
    if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(problem.code)) purge()
    if (problem.code === 'CANCELLED') {
      // 같은 계정의 토큰 갱신도 요청을 취소할 수 있다. 결과만 숨기고 미확정 입력은 보관한다.
      setReadiness(null)
      setThreads({ items: [], nextCursor: null })
      setInbox({ items: [], nextCursor: null })
      setMessages([])
      setSelected(null)
      setRecipients({ items: [], nextCursor: null })
    }
    assign(problem.message)
  }
  useEffect(() => {
    let current = true
    setChecking(true)
    setReadyError('')
    if (!enabled) {
      purge()
      setChecking(false)
      return
    }
    void server
      .readiness(member.id)
      .then((value) => {
        if (!current) return
        setReadiness(value)
        setDenied(false)
      })
      .catch((failure) => {
        if (current) {
          setReadiness(null)
          report(failure, setReadyError)
        }
      })
      .finally(() => {
        if (current) setChecking(false)
      })
    return () => {
      current = false
    }
  }, [server, member.id, enabled, revision, refresh])
  useEffect(() => {
    if (!usable) return
    void loadThreads(false)
    void loadInbox(false)
    return () => {
      listGeneration.current++
      inboxGeneration.current++
    }
  }, [server, usable, search, unreadOnly, refresh, revision])
  useEffect(() => {
    if (!usable || !composing || draft.thread) return
    void loadRecipients(false)
    return () => {
      recipientGeneration.current++
    }
  }, [server, usable, composing, draft.thread?.id, recipientSearch, recipientRefresh])
  useEffect(() => {
    // 홈의 선택은 한 번만 처리한다. 재렌더·배경 조회가 사용자의 다른 대화 선택을 되돌리지 않는다.
    if (!usable || !openRequest || openRequest.key === handledOpenKey || navigationLocked) return
    setHandledOpenKey(openRequest.key)
    openThread(openRequest.id)
  }, [usable, openRequest?.key, openRequest?.id, handledOpenKey, navigationLocked])
  useEffect(() => {
    if (!usable || !openedId) return
    void loadMessages(openedId, false)
    return () => {
      messageGeneration.current++
    }
  }, [server, usable, openedId, refresh, revision])
  useEffect(() => {
    if (!usable || loadingMessages || (!selected && !messageError) || !focusThread.current) return
    threadHeading.current?.focus()
    focusThread.current = false
  }, [usable, loadingMessages, selected, messageError])
  function openThread(threadId: string) {
    messageGeneration.current++
    setTab('messages')
    setOpenedId(threadId)
    setSelected(null)
    setMessages([])
    setMessageCursor(null)
    setMessageError('')
    focusThread.current = true
    // 같은 대화를 다시 요청한 경우에도 현재 권한과 내용을 다시 확인한다.
    if (openedId === threadId) void loadMessages(threadId, false)
  }
  function closeThread() {
    messageGeneration.current++
    setOpenedId(null)
    setSelected(null)
    setMessages([])
    setMessageCursor(null)
    setMessageError('')
    setLoadingMessages(false)
    focusThread.current = false
    heading.current?.focus()
  }
  function openDeliveredThread(threadId: string) {
    if (
      !usable ||
      checking ||
      locked ||
      !delivered?.receipt.deliveries.some((row) => row.threadId === threadId)
    )
      return
    // 새 초안은 접기만 한다. 접수증에 있는 번호로 조회하며 새 전송이나 자동 읽음은 하지 않는다.
    if (composing) setFolded(true)
    openThread(threadId)
  }
  async function loadThreads(more: boolean) {
    const generation = ++listGeneration.current,
      cursor = more ? (threads.nextCursor ?? undefined) : undefined
    setLoadingThreads(true)
    setThreadError('')
    try {
      const result = await server.threads(member.id, search, unreadOnly, cursor)
      if (!alive.current || generation !== listGeneration.current) return
      setThreads((previous) => ({
        items: more ? mergePage(previous.items, result.items, (item) => item.id) : result.items,
        nextCursor: result.nextCursor,
      }))
    } catch (failure) {
      if (generation === listGeneration.current) {
        if (!more) setThreads({ items: [], nextCursor: null })
        report(failure, setThreadError)
      }
    } finally {
      if (alive.current && generation === listGeneration.current) setLoadingThreads(false)
    }
  }
  async function loadInbox(more: boolean) {
    const generation = ++inboxGeneration.current
    setLoadingInbox(true)
    setInboxError('')
    try {
      const result = await server.inbox(
        member.id,
        unreadOnly,
        more ? (inbox.nextCursor ?? undefined) : undefined,
      )
      if (!alive.current || generation !== inboxGeneration.current) return
      setInbox((previous) => ({
        items: more ? mergePage(previous.items, result.items, (item) => item.id) : result.items,
        nextCursor: result.nextCursor,
      }))
    } catch (failure) {
      if (generation === inboxGeneration.current) {
        if (!more) setInbox({ items: [], nextCursor: null })
        report(failure, setInboxError)
      }
    } finally {
      if (alive.current && generation === inboxGeneration.current) setLoadingInbox(false)
    }
  }
  async function loadMessages(threadId: string, more: boolean) {
    const generation = ++messageGeneration.current
    setLoadingMessages(true)
    setMessageError('')
    if (!more) {
      setMessages([])
      setSelected(null)
      setMessageCursor(null)
    }
    try {
      const result = await server.messages(
        member.id,
        threadId,
        more ? (messageCursor ?? undefined) : undefined,
      )
      if (!alive.current || generation !== messageGeneration.current) return
      setSelected(result.thread)
      setMessages((previous) =>
        more
          ? mergePage(result.items, previous, (item) => item.id).sort(
              (a, b) => a.sequence - b.sequence,
            )
          : result.items,
      )
      setMessageCursor(result.nextCursor)
    } catch (failure) {
      if (generation === messageGeneration.current) report(failure, setMessageError)
    } finally {
      if (alive.current && generation === messageGeneration.current) setLoadingMessages(false)
    }
  }
  async function loadRecipients(more: boolean) {
    const generation = ++recipientGeneration.current
    setLoadingRecipients(true)
    setRecipientError('')
    try {
      const result = await server.recipients(
        member.id,
        recipientSearch,
        more ? (recipients.nextCursor ?? undefined) : undefined,
      )
      if (!alive.current || generation !== recipientGeneration.current) return
      setRecipients((previous) => ({
        items: more
          ? mergePage(previous.items, result.items, (item) => item.memberId)
          : result.items,
        nextCursor: result.nextCursor,
      }))
    } catch (failure) {
      if (generation === recipientGeneration.current) {
        if (!more) setRecipients({ items: [], nextCursor: null })
        report(failure, setRecipientError)
      }
    } finally {
      if (alive.current && generation === recipientGeneration.current) setLoadingRecipients(false)
    }
  }
  function start(thread: ThreadSummary | null = null) {
    if (locked || dirty) return
    setDraft({ ...blankMessageDraft(), thread })
    setComposing(true)
    setFolded(false)
    setError('')
    setNotice('')
    setDiscardConfirm(false)
    setConflict(false)
    setTimeout(() => composerInput.current?.focus(), 0)
  }
  function useAiDraft() {
    if (
      !usable ||
      locked ||
      dirty ||
      !composeRequest ||
      composeRequest.schoolId !== member.schoolId ||
      composeRequest.memberId !== member.id ||
      typeof composeRequest.body !== 'string' ||
      !composeRequest.body.trim() ||
      Array.from(composeRequest.body).length > 50000
    )
      return
    setDraft({ ...blankMessageDraft(), body: composeRequest.body })
    setComposing(true)
    setFolded(false)
    setError('')
    setNotice('AI 초안을 불러왔습니다. 받는 사람과 내용을 확인한 뒤 전송해 주세요.')
    setDiscardConfirm(false)
    setConflict(false)
    onComposeRequestConsumed?.()
  }
  function closeComposer() {
    if (locked) return
    if (dirty && !discardConfirm) {
      setDiscardConfirm(true)
      return
    }
    setComposing(false)
    setDraft(blankMessageDraft())
    setPreview(null)
    setDiscardConfirm(false)
    memory.remove()
    heading.current?.focus()
  }
  function prepare(event: FormEvent) {
    event.preventDefault()
    if (locked) return
    try {
      if (
        !readiness?.limits ||
        Array.from(draft.body).length > readiness.limits.bodyCharacters ||
        Array.from(draft.title).length > readiness.limits.titleCharacters ||
        draft.recipients.length > readiness.limits.recipients
      )
        throw new MessagingError('INVALID_INPUT')
      setPreview(messageAttempt(draft, member.id, newMessageKey()))
      setError('')
      setDiscardConfirm(false)
    } catch (failure) {
      report(failure, setError)
    }
  }
  async function send(attempt: MessageAttempt, recovering = false) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const saved = retryMessageAttempt(attempt)
    const generation = serverGeneration.current
    setPending(saved)
    recovery.put({ key: saved.key, command: saved.command })
    setPreview(null)
    try {
      // 연결 복원 후에는 대화 권한을 먼저 다시 조회한다. 요청 번호와 원본 버전은 바꾸지 않는다.
      if (saved.command.kind === 'read_thread' && usable)
        await server.messages(member.id, saved.command.threadId)
      const result = await server.mutate(member.id, saved.command, saved.key, {
        recovering,
        replayOnly: recovering && !usable,
      })
      if (!alive.current || generation !== serverGeneration.current) return
      const confirmed =
        saved.command.kind === 'start' || saved.command.kind === 'reply'
          ? sentDeliveryRecord(saved, result, recoveryScope(member), member.id)
          : null
      setPending(null)
      recovery.remove(saved.key)
      setFolded(false)
      if (saved.command.kind === 'start' || saved.command.kind === 'reply') {
        setDelivered(confirmed)
        setDraft(blankMessageDraft())
        setComposing(false)
        memory.remove()
        setNotice(
          `메시지를 보냈습니다. ${result.deliveries.length}개 대화에 접수되었습니다. ${timeLabel(result.recordedAt)}`,
        )
      } else setNotice('읽음으로 표시했습니다. 업무 처리나 문서 제출 상태는 바뀌지 않습니다.')
      setRefresh((value) => value + 1)
      onUpdated?.()
    } catch (failure) {
      if (!alive.current || generation !== serverGeneration.current) return
      const problem = errorOf(failure)
      if (
        ![
          'RESULT_UNKNOWN',
          'QUERY_FAILED',
          'INVALID_RESPONSE',
          'IDEMPOTENCY_CONFLICT',
          'CANCELLED',
          'NOT_READY',
        ].includes(problem.code)
      ) {
        setPending(null)
        recovery.remove(saved.key)
      }
      if (problem.code === 'CONFLICT' && saved.command.kind === 'read_notice') {
        setError('알림의 읽음 상태가 변경되었습니다. 최신 알림을 다시 불러온 뒤 확인해 주세요.')
        setRefresh((value) => value + 1)
      } else {
        if (problem.code === 'CONFLICT') setConflict(true)
        report(problem, setError)
      }
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  function mark(command: MessageCommand) {
    if (locked || inFlight.current) return
    void send({ key: newMessageKey(), command, recipientNames: [] })
  }
  async function openNoticeSource(item: InboxNotice) {
    if (
      !item.source ||
      !onOpenSource ||
      !canOpenSource?.(item.source) ||
      navigationLocked ||
      sourceInFlight.current
    )
      return
    sourceInFlight.current = true
    setOpeningSource(item.id)
    setSourceError(null)
    try {
      // 알림의 문구로 현재 담당자나 완료 상태를 추정하지 않는다. 원본 화면이 현재 권한과 상태를 다시 확인한다.
      await onOpenSource(item.source)
    } catch (failure) {
      if (!alive.current) return
      const code =
        failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined
      const label = sourceLabels[item.source.module]
      setSourceError({
        noticeId: item.id,
        message: ['FORBIDDEN', 'NOT_FOUND', 'INACTIVE_MEMBERSHIP'].includes(String(code))
          ? `${label} 원본이 없거나 현재 권한으로 열 수 없습니다. 알림의 읽음이나 업무 처리 상태는 바꾸지 않았습니다.`
          : `${label} 원본을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요. 알림과 작성 중인 내용은 그대로 남아 있습니다.`,
      })
    } finally {
      sourceInFlight.current = false
      if (alive.current) setOpeningSource(null)
    }
  }
  async function refreshReplyParticipants() {
    if (!draft.thread || locked) return
    setBusy(true)
    try {
      const latest = await server.messages(member.id, draft.thread.id)
      if (!alive.current) return
      setDraft((value) => ({ ...value, thread: latest.thread }))
      setSelected(latest.thread)
      setConflict(false)
      setNotice(
        '현재 참여자를 다시 불러왔습니다. 작성한 내용은 유지했습니다. 받는 사람을 확인하고 다시 전송해 주세요.',
      )
    } catch (failure) {
      report(failure, setError)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  function chooseRecipient(recipient: Recipient) {
    setDraft((current) => {
      const already = current.recipients.some((item) => item.memberId === recipient.memberId)
      return {
        ...current,
        recipients: already
          ? current.recipients.filter((item) => item.memberId !== recipient.memberId)
          : current.mode === 'direct'
            ? [recipient]
            : [...current.recipients, recipient],
      }
    })
  }
  async function downloadMessageFile(message: Message, file: Message['attachments'][number]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await fileServer.download(member.id, message.threadId, message.id, file)
      if (!alive.current) return
      requestBlobDownload(blob, file.name)
      setNotice('파일 내려받기를 요청했습니다.')
    } catch (failure) {
      report(failure, setError)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const selectedSequence = messages.reduce((max, item) => Math.max(max, item.sequence), 0)
  const canRead = selected && selectedSequence > selected.readSequence
  const recipientPeers = mergePage(recipients.items, draft.recipients, (item) => item.memberId)

  return {
    busy,
    canOpenSource,
    canRead,
    checking,
    chooseRecipient,
    closeComposer,
    closeThread,
    composeRequest,
    composerInput,
    composing,
    conflict,
    delivered,
    denied,
    dirty,
    discardConfirm,
    downloadMessageFile,
    draft,
    enabled,
    error,
    fileLocked,
    fileRecovery,
    fileServer,
    focusThread,
    folded,
    heading,
    id,
    inbox,
    inboxError,
    loadInbox,
    loadMessages,
    loadRecipients,
    loadThreads,
    loadingInbox,
    loadingMessages,
    loadingRecipients,
    loadingThreads,
    locked,
    mark,
    member,
    messageCursor,
    messageError,
    messages,
    navigationLocked,
    notice,
    onOpenSource,
    onReturnToSource,
    openDeliveredThread,
    openNoticeSource,
    openRequest,
    openThread,
    openedId,
    openingSource,
    pending,
    prepare,
    preview,
    query,
    readiness,
    readyError,
    recipientError,
    recipientPeers,
    recipientQuery,
    recipients,
    refreshReplyParticipants,
    selected,
    selectedSequence,
    send,
    setDelivered,
    setDraft,
    setFileLocked,
    setFolded,
    setPreview,
    setQuery,
    setRecipientQuery,
    setRecipientRefresh,
    setRecipientSearch,
    setRefresh,
    setSearch,
    setTab,
    setUnreadOnly,
    sourceError,
    start,
    tab,
    threadError,
    threadHeading,
    threads,
    unreadOnly,
    usable,
    useAiDraft,
    waitingOpen,
  }
}
