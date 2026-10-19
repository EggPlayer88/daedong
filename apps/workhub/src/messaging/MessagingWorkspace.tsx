import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { MessagingError, type InboxNotice, type Message, type MessageCommand, type MessagingReadiness, type MessagingServer, type NotificationSource, type Page, type Recipient, type ThreadSummary } from './contracts'
import { createSupabaseMessagingServer } from './supabase-messaging'
import { blankMessageDraft, isMessageDraftDirty, messageAttempt, newMessageKey, retryMessageAttempt, type MessageAttempt, type MessageDraft } from './composer'
import { MessagePreview } from './MessagePreview'
import { command as checkedCommand } from './validation'
import { createMessageFileServer, type MessageFileServer } from './files'
import { MessageAttachments } from './MessageAttachments'
import { requestBlobDownload } from '../files/download'
import messagingStyles from './messaging.css?inline'

export interface MessageComposeRequest {id:string;schoolId:string;memberId:string;body:string}
export interface MessagingWorkspaceProps {
  openRequest?: { key: string; id: string }
  onReturnToSource?: () => void
  composeRequest?: MessageComposeRequest
  onComposeRequestConsumed?: () => void
  connection: SupabaseConnection; member: Membership; date: string; revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onOpenSource?: (source: NotificationSource) => void | Promise<void>
  canOpenSource?: (source: NotificationSource) => boolean
  /** 시험과 상위 모듈 조합에만 사용한다. 기본 연결은 기존 공용 로그인이다. */
  server?: MessagingServer
  fileServer?: MessageFileServer
}
type DraftMemory = { draft: MessageDraft; composing: boolean; pending: MessageAttempt | null; folded?: boolean }
const errorOf = (error: unknown) => error instanceof MessagingError ? error : new MessagingError('QUERY_FAILED')
const timeLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const sourceLabels = { calendar: '일정', tasks: '업무', collections: '문서 수합', messages: '메시지', students: '학생', knowledge: '학교 자료', cooperation: '협업 요청', timetable: '시간표 변경 요청' }
function mergePage<T>(before: T[], after: T[], key: (item: T) => string): T[] {
  const result = new Map(before.map(item => [key(item), item]))
  for (const item of after) result.set(key(item), item)
  return [...result.values()]
}
export function MessagingWorkspace(props: MessagingWorkspaceProps) {
  return <MessagingWorkspaceScope key={recoveryScope(props.member)} {...props} />
}
function MessagingWorkspaceScope({ openRequest, onReturnToSource, connection, member, date, revision = 0, onNavigationLockChange, onOpenSource, canOpenSource, composeRequest, onComposeRequestConsumed, server: provided, fileServer: providedFiles }: MessagingWorkspaceProps) {
  const server = useMemo(() => provided ?? createSupabaseMessagingServer(connection), [connection, provided])
  const fileServer = useMemo(() => providedFiles ?? createMessageFileServer(connection), [connection, providedFiles])
  const memory = useEditDraft<DraftMemory>(member, 'messaging-composer')
  const recovery = usePendingRequest(member, 'messaging')
  const fileRecovery = usePendingRequest(member, 'messagingFile')
  const [restored] = useState(() => memory.initial)
  const [restoredPending] = useState<MessageAttempt | null>(() => {
    if (!recovery.request) return restored?.pending ?? null
    try { return { key: recovery.request.key, command: checkedCommand(recovery.request.command, member.id), recipientNames: restored?.pending?.recipientNames ?? [] } }
    catch { return null }
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
  const [readyError, setReadyError] = useState(''), [checking, setChecking] = useState(true), [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [unreadOnly, setUnreadOnly] = useState(false)
  const [threads, setThreads] = useState<Page<ThreadSummary>>({ items: [], nextCursor: null }), [loadingThreads, setLoadingThreads] = useState(false), [threadError, setThreadError] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null), [handledOpenKey, setHandledOpenKey] = useState('')
  const focusThread = useRef(false), threadHeading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<ThreadSummary | null>(null), [messages, setMessages] = useState<Message[]>([]), [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false), [messageError, setMessageError] = useState('')
  const [inbox, setInbox] = useState<Page<InboxNotice>>({ items: [], nextCursor: null }), [loadingInbox, setLoadingInbox] = useState(false), [inboxError, setInboxError] = useState('')
  const [openingSource, setOpeningSource] = useState<string | null>(null), [sourceError, setSourceError] = useState<{ noticeId: string; message: string } | null>(null)
  const sourceInFlight = useRef(false)
  const [recipientQuery, setRecipientQuery] = useState(''), [recipientSearch, setRecipientSearch] = useState(''), [recipientRefresh, setRecipientRefresh] = useState(0)
  const [recipients, setRecipients] = useState<Page<Recipient>>({ items: [], nextCursor: null }), [loadingRecipients, setLoadingRecipients] = useState(false), [recipientError, setRecipientError] = useState('')
  const alive = useRef(true), inFlight = useRef(false), listGeneration = useRef(0), messageGeneration = useRef(0), recipientGeneration = useRef(0), inboxGeneration = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null), composerInput = useRef<HTMLTextAreaElement>(null), id = useId()
  const enabled = activeAt(member, date), usable = enabled && !denied && readiness?.available === true
  const dirty = composing && isMessageDraftDirty(draft), locked = busy || fileLocked || Boolean(pending || preview || openingSource)
  const navigationLocked = busy || fileLocked || Boolean(preview) || (!folded && (dirty || Boolean(pending)))
  const hasAnyDraft = dirty || Boolean(pending)
  const waitingOpen = Boolean(openRequest && openRequest.key !== handledOpenKey)
  useEffect(() => { alive.current = true; return () => { alive.current = false; listGeneration.current++; messageGeneration.current++; recipientGeneration.current++; inboxGeneration.current++ } }, [server])
  useEffect(() => { memory.save(hasAnyDraft ? { draft, composing, pending, folded } : undefined, hasAnyDraft) }, [memory, draft, composing, pending, folded, hasAnyDraft])
  useEffect(() => { onNavigationLockChange?.(navigationLocked); return () => onNavigationLockChange?.(false) }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!hasAnyDraft) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler)
  }, [hasAnyDraft])
  function purge() {
    listGeneration.current++; messageGeneration.current++; recipientGeneration.current++; inboxGeneration.current++
    setThreads({ items: [], nextCursor: null }); setInbox({ items: [], nextCursor: null }); setMessages([]); setSelected(null); setOpenedId(null); focusThread.current = false; setRecipients({ items: [], nextCursor: null })
    setPreview(null); setPending(null); recovery.remove(); setDraft(blankMessageDraft()); setComposing(false); memory.remove(); setDenied(true)
  }
  function report(failure: unknown, assign: (value: string) => void) {
    if (!alive.current) return
    const problem = errorOf(failure)
    if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(problem.code)) purge()
    if (problem.code === 'CANCELLED') {
      // 같은 계정의 토큰 갱신도 요청을 취소할 수 있다. 결과만 숨기고 미확정 입력은 보관한다.
      setReadiness(null); setThreads({ items: [], nextCursor: null }); setInbox({ items: [], nextCursor: null }); setMessages([]); setSelected(null); setRecipients({ items: [], nextCursor: null })
    }
    assign(problem.message)
  }
  useEffect(() => {
    let current = true
    setChecking(true); setReadyError('')
    if (!enabled) { purge(); setChecking(false); return }
    void server.readiness(member.id).then(value => { if (!current) return; setReadiness(value); setDenied(false) }).catch(failure => { if (current) { setReadiness(null); report(failure, setReadyError) } }).finally(() => { if (current) setChecking(false) })
    return () => { current = false }
  }, [server, member.id, enabled, revision, refresh])
  useEffect(() => {
    if (!usable) return
    void loadThreads(false)
    void loadInbox(false)
    return () => { listGeneration.current++; inboxGeneration.current++ }
  }, [server, usable, search, unreadOnly, refresh, revision])
  useEffect(() => {
    if (!usable || !composing || draft.thread) return
    void loadRecipients(false)
    return () => { recipientGeneration.current++ }
  }, [server, usable, composing, draft.thread?.id, recipientSearch, recipientRefresh])
  useEffect(() => {
    // 홈의 선택은 한 번만 처리한다. 재렌더·배경 조회가 사용자의 다른 대화 선택을 되돌리지 않는다.
    if (!usable || !openRequest || openRequest.key === handledOpenKey || navigationLocked) return
    setHandledOpenKey(openRequest.key); openThread(openRequest.id)
  }, [usable, openRequest?.key, openRequest?.id, handledOpenKey, navigationLocked])
  useEffect(() => {
    if (!usable || !openedId) return
    void loadMessages(openedId, false)
    return () => { messageGeneration.current++ }
  }, [server, usable, openedId, refresh, revision])
  useEffect(() => {
    if (!usable || loadingMessages || (!selected && !messageError) || !focusThread.current) return
    threadHeading.current?.focus(); focusThread.current = false
  }, [usable, loadingMessages, selected, messageError])
  function openThread(threadId: string) {
    messageGeneration.current++; setTab('messages'); setOpenedId(threadId)
    setSelected(null); setMessages([]); setMessageCursor(null); setMessageError(''); focusThread.current = true
    // 같은 대화를 다시 요청한 경우에도 현재 권한과 내용을 다시 확인한다.
    if (openedId === threadId) void loadMessages(threadId, false)
  }
  function closeThread() {
    messageGeneration.current++; setOpenedId(null); setSelected(null); setMessages([]); setMessageCursor(null)
    setMessageError(''); setLoadingMessages(false); focusThread.current = false; heading.current?.focus()
  }
  async function loadThreads(more: boolean) {
    const generation = ++listGeneration.current, cursor = more ? threads.nextCursor ?? undefined : undefined
    setLoadingThreads(true); setThreadError('')
    try {
      const result = await server.threads(member.id, search, unreadOnly, cursor)
      if (!alive.current || generation !== listGeneration.current) return
      setThreads(previous => ({ items: more ? mergePage(previous.items, result.items, item => item.id) : result.items, nextCursor: result.nextCursor }))
    } catch (failure) { if (generation === listGeneration.current) { if (!more) setThreads({ items: [], nextCursor: null }); report(failure, setThreadError) } }
    finally { if (alive.current && generation === listGeneration.current) setLoadingThreads(false) }
  }
  async function loadInbox(more: boolean) {
    const generation = ++inboxGeneration.current
    setLoadingInbox(true); setInboxError('')
    try {
      const result = await server.inbox(member.id, unreadOnly, more ? inbox.nextCursor ?? undefined : undefined)
      if (!alive.current || generation !== inboxGeneration.current) return
      setInbox(previous => ({ items: more ? mergePage(previous.items, result.items, item => item.id) : result.items, nextCursor: result.nextCursor }))
    } catch (failure) { if (generation === inboxGeneration.current) { if (!more) setInbox({ items: [], nextCursor: null }); report(failure, setInboxError) } }
    finally { if (alive.current && generation === inboxGeneration.current) setLoadingInbox(false) }
  }
  async function loadMessages(threadId: string, more: boolean) {
    const generation = ++messageGeneration.current
    setLoadingMessages(true); setMessageError('')
    if (!more) { setMessages([]); setSelected(null); setMessageCursor(null) }
    try {
      const result = await server.messages(member.id, threadId, more ? messageCursor ?? undefined : undefined)
      if (!alive.current || generation !== messageGeneration.current) return
      setSelected(result.thread); setMessages(previous => more ? mergePage(result.items, previous, item => item.id).sort((a, b) => a.sequence - b.sequence) : result.items); setMessageCursor(result.nextCursor)
    } catch (failure) { if (generation === messageGeneration.current) report(failure, setMessageError) }
    finally { if (alive.current && generation === messageGeneration.current) setLoadingMessages(false) }
  }
  async function loadRecipients(more: boolean) {
    const generation = ++recipientGeneration.current
    setLoadingRecipients(true); setRecipientError('')
    try {
      const result = await server.recipients(member.id, recipientSearch, more ? recipients.nextCursor ?? undefined : undefined)
      if (!alive.current || generation !== recipientGeneration.current) return
      setRecipients(previous => ({ items: more ? mergePage(previous.items, result.items, item => item.memberId) : result.items, nextCursor: result.nextCursor }))
    } catch (failure) { if (generation === recipientGeneration.current) { if (!more) setRecipients({ items: [], nextCursor: null }); report(failure, setRecipientError) } }
    finally { if (alive.current && generation === recipientGeneration.current) setLoadingRecipients(false) }
  }
  function start(thread: ThreadSummary | null = null) {
    if (locked || dirty) return
    setDraft({ ...blankMessageDraft(), thread }); setComposing(true); setFolded(false); setError(''); setNotice(''); setDiscardConfirm(false); setConflict(false)
    setTimeout(() => composerInput.current?.focus(), 0)
  }
  function useAiDraft() {
    if (!usable || locked || dirty || !composeRequest || composeRequest.schoolId !== member.schoolId || composeRequest.memberId !== member.id || typeof composeRequest.body !== 'string' || !composeRequest.body.trim() || Array.from(composeRequest.body).length > 50000) return
    setDraft({...blankMessageDraft(),body:composeRequest.body});setComposing(true);setFolded(false);setError('');setNotice('AI 초안을 불러왔습니다. 받는 사람과 내용을 확인한 뒤 전송해 주세요.');setDiscardConfirm(false);setConflict(false);onComposeRequestConsumed?.()
  }
  function closeComposer() {
    if (locked) return
    if (dirty && !discardConfirm) { setDiscardConfirm(true); return }
    setComposing(false); setDraft(blankMessageDraft()); setPreview(null); setDiscardConfirm(false); memory.remove(); heading.current?.focus()
  }
  function prepare(event: FormEvent) {
    event.preventDefault()
    if (locked) return
    try { if (!readiness?.limits || Array.from(draft.body).length > readiness.limits.bodyCharacters || Array.from(draft.title).length > readiness.limits.titleCharacters || draft.recipients.length > readiness.limits.recipients) throw new MessagingError('INVALID_INPUT'); setPreview(messageAttempt(draft, member.id, newMessageKey())); setError(''); setDiscardConfirm(false) }
    catch (failure) { report(failure, setError) }
  }
  async function send(attempt: MessageAttempt, recovering = false) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    const saved = retryMessageAttempt(attempt)
    setPending(saved); recovery.put({ key: saved.key, command: saved.command }); setPreview(null)
    try {
      // 연결 복원 후에는 대화 권한을 먼저 다시 조회한다. 요청 번호와 원본 버전은 바꾸지 않는다.
      if (saved.command.kind === 'read_thread' && usable) await server.messages(member.id, saved.command.threadId)
      const result = await server.mutate(member.id, saved.command, saved.key, { recovering, replayOnly: recovering && !usable })
      if (!alive.current) return
      setPending(null); recovery.remove(saved.key); setFolded(false)
      if (saved.command.kind === 'start' || saved.command.kind === 'reply') {
        setDraft(blankMessageDraft()); setComposing(false); memory.remove()
        setNotice(`메시지를 보냈습니다. ${result.deliveries.length}개 대화에 접수되었습니다. ${timeLabel(result.recordedAt)}`)
      } else setNotice('읽음으로 표시했습니다. 업무 처리나 문서 제출 상태는 바뀌지 않습니다.')
      setRefresh(value => value + 1)
    } catch (failure) {
      if (!alive.current) return
      const problem = errorOf(failure)
      if (!['RESULT_UNKNOWN', 'QUERY_FAILED', 'INVALID_RESPONSE', 'IDEMPOTENCY_CONFLICT', 'CANCELLED', 'NOT_READY'].includes(problem.code)) { setPending(null); recovery.remove(saved.key) }
      if (problem.code === 'CONFLICT' && saved.command.kind === 'read_notice') {
        setError('알림의 읽음 상태가 변경되었습니다. 최신 알림을 다시 불러온 뒤 확인해 주세요.')
        setRefresh(value => value + 1)
      } else {
        if (problem.code === 'CONFLICT') setConflict(true)
        report(problem, setError)
      }
    } finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  function mark(command: MessageCommand) { if (locked || inFlight.current) return; void send({ key: newMessageKey(), command, recipientNames: [] }) }
  async function openNoticeSource(item: InboxNotice) {
    if (!item.source || !onOpenSource || !canOpenSource?.(item.source) || navigationLocked || sourceInFlight.current) return
    sourceInFlight.current = true; setOpeningSource(item.id); setSourceError(null)
    try {
      // 알림의 문구로 현재 담당자나 완료 상태를 추정하지 않는다. 원본 화면이 현재 권한과 상태를 다시 확인한다.
      await onOpenSource(item.source)
    } catch (failure) {
      if (!alive.current) return
      const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined
      const label = sourceLabels[item.source.module]
      setSourceError({ noticeId: item.id, message: ['FORBIDDEN', 'NOT_FOUND', 'INACTIVE_MEMBERSHIP'].includes(String(code))
        ? `${label} 원본이 없거나 현재 권한으로 열 수 없습니다. 알림의 읽음이나 업무 처리 상태는 바꾸지 않았습니다.`
        : `${label} 원본을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요. 알림과 작성 중인 내용은 그대로 남아 있습니다.` })
    } finally { sourceInFlight.current = false; if (alive.current) setOpeningSource(null) }
  }
  async function refreshReplyParticipants() {
    if (!draft.thread || locked) return
    setBusy(true)
    try {
      const latest = await server.messages(member.id, draft.thread.id)
      if (!alive.current) return
      setDraft(value => ({ ...value, thread: latest.thread })); setSelected(latest.thread); setConflict(false)
      setNotice('현재 참여자를 다시 불러왔습니다. 작성한 내용은 유지했습니다. 받는 사람을 확인하고 다시 전송해 주세요.')
    } catch (failure) { report(failure, setError) }
    finally { if (alive.current) setBusy(false) }
  }
  function chooseRecipient(recipient: Recipient) {
    setDraft(current => {
      const already = current.recipients.some(item => item.memberId === recipient.memberId)
      return { ...current, recipients: already ? current.recipients.filter(item => item.memberId !== recipient.memberId) : current.mode === 'direct' ? [recipient] : [...current.recipients, recipient] }
    })
  }
  async function downloadMessageFile(message: Message, file: Message['attachments'][number]) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const blob = await fileServer.download(member.id, message.threadId, message.id, file)
      if (!alive.current) return
      requestBlobDownload(blob, file.name); setNotice('파일 내려받기를 요청했습니다.')
    } catch (failure) { report(failure, setError) }
    finally { if (alive.current) setBusy(false) }
  }
  const selectedSequence = messages.reduce((max, item) => Math.max(max, item.sequence), 0)
  const canRead = selected && selectedSequence > selected.readSequence
  return <section className="messaging-workspace" aria-labelledby={`${id}-heading`}>
    <style>{messagingStyles}</style>
    <header className="messaging-header"><div><h2 id={`${id}-heading`} tabIndex={-1} ref={heading}>메시지와 알림</h2><p>학교 선생님과 대화하고, 내 업무 알림을 확인합니다.</p></div><button type="button" className="messaging-primary" disabled={!usable || locked || dirty} onClick={() => start()}>새 메시지</button></header>
    {openRequest && onReturnToSource && <div className="messaging-actions"><button type="button" disabled={navigationLocked} onClick={onReturnToSource}>홈으로 돌아가기</button><p className="messaging-muted">대화를 열어도 자동으로 읽음 처리하지 않습니다.</p></div>}
    {waitingOpen && usable && navigationLocked && <section className="messaging-status" aria-label="요청한 대화 열기"><p>작성 중인 입력과 이전 요청은 보관합니다. 입력을 접은 뒤 요청한 대화를 열어 주세요.</p><button type="button" disabled={busy || fileLocked || Boolean(preview)} onClick={() => setFolded(true)}>입력 접고 요청한 대화 열기</button></section>}
    {composeRequest?.schoolId === member.schoolId && composeRequest.memberId === member.id && <section className="messaging-status" aria-label="AI 메시지 초안"><p>AI가 작성한 메시지 초안이 있습니다. 받는 사람은 직접 선택하고 보내기 전에 내용을 확인하세요.{dirty && ' 현재 작성 중인 메시지를 먼저 마무리해 주세요.'}</p><button type="button" disabled={!usable || locked || dirty} onClick={useAiDraft}>전달받은 메시지 초안 사용</button></section>}
    {checking && <p role="status">메시지 연결을 확인하는 중…</p>}
    {notice && <div className="messaging-status" role="status">{notice}</div>}
    {error && <div className="messaging-status" role="alert">{error}</div>}
    {!usable && !checking && <div className="messaging-status" role="alert"><p>{readyError || (!enabled || denied ? '현재 학교의 메시지 이용 권한을 다시 확인해 주세요.' : '메시지와 알림의 서버 연결을 준비하고 있습니다. 준비되지 않은 대화를 빈 목록으로 표시하지 않습니다.')}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>연결 다시 확인</button></div>}
    {pending && <section className="messaging-status messaging-recovery" aria-label="이전 메시지 요청 확인"><h3>이전 요청의 결과를 먼저 확인해 주세요</h3><p>같은 내용과 요청 번호로 다시 확인합니다. 확인 전에는 새 메시지 전송을 멈춥니다. 보관 정보는 현재 탭에만 남습니다. 연결 준비를 확인하지 못한 경우에는 기존 접수증만 조회합니다.</p><div className="messaging-actions"><button type="button" className="messaging-primary" disabled={busy || !enabled || denied} onClick={() => void send(pending, true)}>이전 요청 그대로 다시 확인</button><button type="button" disabled={busy} onClick={() => setFolded(value => !value)}>{folded ? '보관한 입력 보기' : '입력 접고 목록 보기'}</button></div></section>}
    {!usable && !denied && enabled && fileRecovery.request && <MessageAttachments server={fileServer} member={member} enabled={false} disabled={busy || Boolean(pending)} files={draft.attachments} onChange={files => setDraft(value => ({ ...value, attachments: files }))} onLockChange={setFileLocked} />}
    {usable && <>
      <div className="messaging-tabs" role="group" aria-label="메시지 분류"><button type="button" aria-pressed={tab === 'messages'} onClick={() => setTab('messages')}>대화</button><button type="button" aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>업무 알림</button></div>
      {composing && <form hidden={folded} className="messaging-compose" onSubmit={prepare} aria-label={draft.thread ? '답장 작성' : '새 메시지 작성'}><h3>{draft.thread ? '답장 작성' : '새 메시지 작성'}</h3>
        {conflict && <div className="messaging-status" role="alert"><p>{draft.thread ? '참여자가 바뀌었습니다. 아래 버튼으로 현재 참여자를 확인한 뒤 다시 보내 주세요.' : '받는 사람 정보를 다시 확인해 주세요. 교사 명단을 다시 조회하고 받는 사람을 다시 선택하면 최신 정보를 사용합니다. 메시지 내용은 유지됩니다.'}</p>{draft.thread && <button type="button" disabled={locked} onClick={() => void refreshReplyParticipants()}>현재 참여자 다시 확인</button>}</div>}
        <fieldset disabled={locked}><legend>받는 사람과 내용</legend>
          {draft.thread ? <p>받는 사람: {draft.thread.participants.filter(item => item.memberId !== member.id).map(item => item.name).join(', ')}</p> : <>
            <label htmlFor={`${id}-mode`}>보내는 방식<select id={`${id}-mode`} value={draft.mode} onChange={event => setDraft(value => ({ ...value, mode: event.target.value as MessageDraft['mode'], recipients: event.target.value === 'direct' ? value.recipients.slice(0, 1) : value.recipients }))}><option value="direct">1:1 메시지</option><option value="group">함께 보는 단체 대화</option><option value="individual">각자에게 개별 전송</option></select></label>
            <p className="messaging-muted">{draft.mode === 'group' ? '단체 대화에서는 참여자와 답장을 서로 볼 수 있습니다.' : draft.mode === 'individual' ? '같은 내용을 각 교사와의 개별 대화에 보냅니다.' : '한 명의 교사와 대화합니다.'}</p>
            <div className="messaging-filters"><label htmlFor={`${id}-recipient-search`}>교사 이름·부서 검색<input id={`${id}-recipient-search`} value={recipientQuery} onChange={event => setRecipientQuery(event.target.value)} maxLength={200} /></label><button type="button" disabled={loadingRecipients} onClick={() => { setRecipientSearch(recipientQuery); setRecipientRefresh(value => value + 1) }}>교사 찾기</button></div>
            {recipientError && <div role="alert">{recipientError}<button type="button" onClick={() => void loadRecipients(false)}>받는 사람 다시 조회</button></div>}
            {loadingRecipients && <p role="status">교사 명단 확인 중…</p>}
            <ul className="messaging-recipient-list" aria-label="받는 사람 선택">{recipients.items.map(recipient => <li key={recipient.memberId}><label><input type="checkbox" checked={draft.recipients.some(item => item.memberId === recipient.memberId)} disabled={!draft.recipients.some(item => item.memberId === recipient.memberId) && draft.mode !== 'direct' && draft.recipients.length >= (readiness?.limits?.recipients ?? 0)} onChange={() => chooseRecipient(recipient)} /><span>{recipient.name}{recipient.department && ` · ${recipient.department}`}</span></label></li>)}</ul>
            {!loadingRecipients && !recipientError && recipients.items.length === 0 && <p className="messaging-muted">검색 조건에 맞는 교사가 없습니다.</p>}
            {recipients.nextCursor && <button type="button" disabled={loadingRecipients} onClick={() => void loadRecipients(true)}>교사 더 보기</button>}
            <div className="messaging-selected" aria-label={`선택한 받는 사람 ${draft.recipients.length}명`}>{draft.recipients.map(recipient => <button type="button" key={recipient.memberId} onClick={() => chooseRecipient(recipient)} aria-label={`${recipient.name} 받는 사람에서 제외`}>{recipient.name} ×</button>)}</div>
            {draft.mode === 'group' && <label htmlFor={`${id}-title`}>대화 제목<input id={`${id}-title`} value={draft.title} maxLength={readiness?.limits?.titleCharacters} required onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>}
          </>}
          <div><label htmlFor={`${id}-body`}>메시지</label><textarea id={`${id}-body`} ref={composerInput} value={draft.body} maxLength={readiness?.limits?.bodyCharacters} required={!draft.attachments.length} onChange={event => setDraft(value => ({ ...value, body: event.target.value }))} /></div>
          <p className="messaging-muted">{Array.from(draft.body).length.toLocaleString()} / {readiness?.limits?.bodyCharacters.toLocaleString()}자</p>
        </fieldset>
        <MessageAttachments server={fileServer} member={member} enabled={readiness?.attachments === 'hwpx_basic_v1'} disabled={busy || Boolean(pending || preview)} files={draft.attachments} onChange={files => setDraft(value => ({ ...value, attachments: files }))} onLockChange={setFileLocked} />
        {!pending && !preview && <div className="messaging-actions"><button className="messaging-primary" type="submit" disabled={busy || fileLocked || (conflict && Boolean(draft.thread))}>받는 사람과 내용 확인</button><button type="button" disabled={busy || fileLocked} onClick={closeComposer}>{discardConfirm ? '작성한 입력 버리고 닫기' : '작성 닫기'}</button>{dirty && <button type="button" disabled={busy} onClick={() => setFolded(true)}>입력 접고 목록 보기</button>}</div>}
        {discardConfirm && <p role="status">닫기를 한 번 더 누르면 아직 보내지 않은 입력을 버립니다.</p>}
      </form>}
      {composing && folded && !pending && <div className="messaging-status"><p>작성 중인 메시지를 현재 탭에 보관했습니다.</p><button type="button" onClick={() => setFolded(false)}>작성 계속하기</button></div>}
      {preview && <MessagePreview attempt={preview} busy={busy} onConfirm={() => void send(preview)} onEdit={() => setPreview(null)} />}
      <div className="messaging-filters"><label className="messaging-check"><input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)} />읽지 않은 항목만</label><button type="button" disabled={busy || loadingThreads || loadingInbox} onClick={() => setRefresh(value => value + 1)}>새로고침</button></div>
      {tab === 'messages' ? <div className="messaging-grid"><section className="messaging-panel" aria-label="대화 목록">
        <form className="messaging-filters" onSubmit={event => { event.preventDefault(); setSearch(query) }}><label htmlFor={`${id}-search`}>대화 검색<input type="search" id={`${id}-search`} placeholder="대화 제목·참여자" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><button type="submit">검색</button></form>
        {threadError && <p role="alert">{threadError}</p>}{loadingThreads && <p role="status">대화를 불러오는 중…</p>}
        <ul className="messaging-list">{threads.items.map(thread => <li key={thread.id}><button type="button" aria-current={selected?.id === thread.id} onClick={() => openThread(thread.id)}><strong>{thread.title || thread.participants.filter(item => item.memberId !== member.id).map(item => item.name).join(', ')}</strong><small>{timeLabel(thread.updatedAt)} · {thread.kind === 'group' ? '단체 대화' : '1:1 대화'}</small>{thread.unreadCount > 0 && <span className="messaging-badge">읽지 않은 메시지 {thread.unreadCount}개</span>}</button></li>)}</ul>
        {!loadingThreads && !threadError && !threads.items.length && <p className="messaging-empty">조건에 맞는 대화가 없습니다.</p>}
        {threads.nextCursor && <button type="button" disabled={loadingThreads} onClick={() => void loadThreads(true)}>대화 더 보기</button>}
      </section><section className="messaging-panel" aria-label="선택한 대화">{openedId && <div className="messaging-actions"><button type="button" onClick={closeThread}>대화 목록으로 돌아가기</button></div>}{selected ? <>
        <h3 ref={threadHeading} tabIndex={-1}>{selected.title || selected.participants.filter(item => item.memberId !== member.id).map(item => item.name).join(', ')}</h3><p className="messaging-muted">참여자: {selected.participants.map(item => item.name).join(', ')}</p>
        {messageError && <div role="alert">{messageError}<button type="button" onClick={() => void loadMessages(selected.id, false)}>대화 다시 불러오기</button></div>}
        {messageCursor && <button type="button" disabled={loadingMessages} onClick={() => void loadMessages(selected.id, true)}>이전 메시지 보기</button>}
        <ol className="messaging-messages" aria-label="메시지 내용">{messages.map(message => <li key={message.id} data-own={message.senderMemberId === member.id}><div className="messaging-message-meta"><strong>{message.senderName}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div><p className="messaging-body">{message.body}</p>{message.attachments.map(file => <button type="button" disabled={busy || readiness?.attachments !== 'hwpx_basic_v1'} key={file.id} onClick={() => void downloadMessageFile(message, file)}>{file.name} 내려받기</button>)}</li>)}</ol>
        {loadingMessages && <p role="status">메시지를 불러오는 중…</p>}
        <div className="messaging-actions"><button type="button" className="messaging-primary" disabled={locked || dirty || !selected.canSend || loadingMessages || Boolean(messageError)} onClick={() => start(selected)}>답장</button><button type="button" disabled={locked || !canRead || loadingMessages || Boolean(messageError)} onClick={() => mark({ kind: 'read_thread', threadId: selected.id, throughSequence: selectedSequence })}>화면에 연 메시지까지 읽음 표시</button></div>
        {!selected.canSend && <p className="messaging-muted">현재 대화에 답장할 수 없습니다.</p>}
      </> : openedId ? <><h3 ref={threadHeading} tabIndex={-1}>요청한 대화</h3>{loadingMessages && <p role="status">대화를 확인하는 중…</p>}{messageError && <div role="alert"><p>{messageError}</p><button type="button" disabled={loadingMessages} onClick={() => { focusThread.current = true; void loadMessages(openedId, false) }}>요청한 대화 다시 확인</button></div>}</> : <p className="messaging-empty">대화를 선택해 주세요.</p>}</section></div> : <section className="messaging-panel messaging-inbox" aria-label="내 업무 알림">
        <p className="messaging-muted">알림을 읽거나 원본을 열어도 협업 수락·완료 확인, 업무 완료, 수합 제출, 승인 상태가 바뀌지는 않습니다. 협업의 현재 담당자와 처리 상태는 원본에서 확인해 주세요.</p>
        {inboxError && <p role="alert">{inboxError}</p>}{loadingInbox && <p role="status">알림을 불러오는 중…</p>}
        {inbox.items.map(item => <article key={item.id}><div className="messaging-message-meta"><h3>{item.title}</h3><time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time></div><p className="messaging-body">{item.body}</p><div className="messaging-actions">{item.readAt ? <span className="messaging-muted">읽음</span> : <button type="button" disabled={locked} onClick={() => mark({ kind: 'read_notice', noticeId: item.id, expectedVersion: item.version })}>읽음으로 표시</button>}{item.source && onOpenSource && canOpenSource?.(item.source) && <button type="button" disabled={navigationLocked || Boolean(openingSource)} onClick={() => void openNoticeSource(item)}>{openingSource === item.id ? `${sourceLabels[item.source.module]} 원본 확인 중…` : `${sourceLabels[item.source.module]} 원본 열기`}</button>}</div>{sourceError?.noticeId === item.id && <p role="alert">{sourceError.message}</p>}</article>)}
        {!loadingInbox && !inboxError && inbox.items.length === 0 && <p className="messaging-empty">조건에 맞는 알림이 없습니다.</p>}
        {inbox.nextCursor && <button type="button" disabled={loadingInbox} onClick={() => void loadInbox(true)}>알림 더 보기</button>}
      </section>}
    </>}
  </section>
}
