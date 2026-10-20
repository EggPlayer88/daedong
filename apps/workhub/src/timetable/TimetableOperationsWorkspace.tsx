import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest, type TimetableRecovery } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import { createTimetableOperationsServer } from './operations-server'
import type { OperationCommand, OperationLesson, OperationReceipt, OperationsReadiness, OperationsView, TimetableOperationsServer } from './operations-contracts'
import { TimetablePublishPanel } from './TimetablePublishPanel'
import { TimetableExchangePanel } from './TimetableExchangePanel'
import { dateOffset } from './OperationChangeList'
import { PublishedTimetableBoard } from './PublishedTimetableBoard'
import { createTimetableOperationsExtensions } from './operations-next-server'
import { createPublicationExecutionServer } from './publication-execution-server'
import type { PublicationCommitCommand, PublicationCommitReceipt, PublicationExecutionServer } from './publication-execution-contracts'
import { createSchoolDayExecutionServer } from './school-day-execution-server'
import type { SchoolDayCommitCommand, SchoolDayCommitReceipt, SchoolDayExecutionServer } from './school-day-execution-contracts'
import type { OperationsExtensions, OperationReferenceView } from './operations-next-contracts'
import { SchoolDayChangePanel } from './SchoolDayChangePanel'
import { timetableWeekStart } from './operations-calendar'
import { createTimetableExecutionRecordsServer } from './execution-records-server'
import type { TimetableExecutionRecordsServer } from './execution-records'
import { TimetableExecutionRecordsPanel } from './TimetableExecutionRecordsPanel'
import { RequestClosePanel } from './RequestClosePanel'
import { createTimetableInterventionsServer } from './interventions-server'
import { TimetableInterventionsPanel } from './TimetableInterventionsPanel'
import type { TimetableInterventionsServer } from './interventions-contracts'
import type { ExchangeInput } from './operations-contracts'
import { createAssistantServer } from '../assistant/server'
import type { AssistantServer } from '../assistant/contracts'
import type { AssistantHttpPort } from '../assistant/http'
import nextLimits from './operations-next-limits.json'
import styles from './operations.css?inline'
import themeStyles from './timetable-theme.css?inline'

type Tab = 'shared' | 'publish' | 'exchange'
interface Props { connection: SupabaseConnection; member: Membership; date: string; revision?: number; onNavigationLockChange?: (locked: boolean) => void; initialLessonId?: string; initialDate?: string; initialRequestId?: string; initialNotificationId?: string; initialIntent?: { kind: 'makeup'; lessonId: string; token: string }; onInitialIntentConsumed?: (token: string) => void; initialDraftId?: string; initialDraftVersion?: number; onInitialDraftConsumed?: () => void; onOpenLesson?: (lessonId: string, date: string) => void }
interface PanelProps extends Omit<Props, 'connection'> { server: TimetableOperationsServer; extensions?: OperationsExtensions; publicationExecution?: PublicationExecutionServer; schoolDayExecution?: SchoolDayExecutionServer; executionRecords?: TimetableExecutionRecordsServer; interventions?: TimetableInterventionsServer; assistantServer?: AssistantServer }
const operatingAssistantHttp: AssistantHttpPort = { async send(payload, expectedUserId, writing) { const { legacyAssistantHttp } = await import('../assistant/legacy-http'); return legacyAssistantHttp.send(payload, expectedUserId, writing) } }
type OperationsCommand = OperationCommand | PublicationCommitCommand | SchoolDayCommitCommand
type OperationsReceipt = OperationReceipt | PublicationCommitReceipt | SchoolDayCommitReceipt
const message = (error: unknown) => error instanceof ServiceError ? error.message : '처리 결과를 확인하지 못했습니다. 입력과 원래 요청 번호를 보관했습니다.'
const rejected = (error: unknown) => error instanceof ServiceError && ['NOT_READY', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'CONFLICT'].includes(error.code)
const readinessMessage = { not_installed: '확정·공유·교환 기능의 서버 연결을 준비 중입니다.', not_allowed: '현재 계정에는 시간표 운영 자료를 볼 권한이 없습니다.', basis_missing: '학교의 시간표 운영 기초 자료를 먼저 연결해야 합니다.' }
const receiptMessage = (receipt: OperationsReceipt) => receipt.kind === 'publish_manifest' ? `전체 기간의 시간표 ${receipt.version}판을 확정했습니다. 변경 수업 ${receipt.changedCount}건을 공유 화면에서 확인할 수 있습니다.` : receipt.kind === 'school_day' ? `학사 변경을 ${receipt.changedLessonCount}개 수업에 반영했습니다. 보강 검토가 필요한 수업은 ${receipt.lostLessonCount}개입니다.` : receipt.kind === 'publish' ? `학교 시간표 ${receipt.version}판을 확정했습니다. 공유 화면에서 적용 기간을 확인할 수 있습니다.` : receipt.status === 'applied' ? '수업 변경을 시간표에 반영했습니다. 최신 수업을 확인해 주세요.' : '수업 변경 요청의 처리 결과를 확인했습니다. 요청 현황에서 다음 단계를 확인해 주세요.'

export function TimetableOperationsWorkspace(props: Props) {
  const server = useMemo(() => createTimetableOperationsServer(props.connection), [props.connection])
  const extensions = useMemo(() => createTimetableOperationsExtensions(props.connection), [props.connection])
  const publicationExecution = useMemo(() => createPublicationExecutionServer(props.connection), [props.connection])
  const executionRecords = useMemo(() => createTimetableExecutionRecordsServer(props.connection), [props.connection])
  const schoolDayExecution = useMemo(() => createSchoolDayExecutionServer(props.connection), [props.connection])
  const interventions = useMemo(() => createTimetableInterventionsServer(props.connection), [props.connection])
  const assistantServer = useMemo(() => createAssistantServer(props.connection, operatingAssistantHttp), [props.connection])
  return <TimetableOperationsPanel key={recoveryScope(props.member)} {...props} server={server} executionRecords={executionRecords} extensions={extensions} publicationExecution={publicationExecution} schoolDayExecution={schoolDayExecution} interventions={interventions} assistantServer={assistantServer} />
}
export function TimetableOperationsPanel({ server, member, date, revision = 0, onNavigationLockChange, extensions, publicationExecution, schoolDayExecution, executionRecords, interventions, assistantServer, initialLessonId, initialDate, initialRequestId, initialNotificationId, initialIntent, onInitialIntentConsumed, initialDraftId, initialDraftVersion, onInitialDraftConsumed, onOpenLesson }: PanelProps) {
  const id = useId(), pendingStore = usePendingRequest(member, 'timetableOperations')
  const route = useEditDraft<Tab>(member, 'timetable-operations-tab'), publishMemory = useEditDraft<unknown>(member, 'timetable-publish'), exchangeMemory = useEditDraft<unknown>(member, 'timetable-exchanges')
  const schoolDayMemory = useEditDraft<unknown>(member, 'timetable-school-day')
  const initialRecordsRecovery = usePendingRequest(member, 'timetableExecutionRecords')
  const interventionPending = usePendingRequest(member, 'timetableInterventions')
  const interventionAssistantPending = usePendingRequest(member, 'timetableOperationsAssistant')
  const [interventionsLocked, setInterventionsLocked] = useState(false)
  const [requestMode, setRequestMode] = useState<'exchange' | 'interventions'>(() => interventionPending.request || interventionAssistantPending.request || initialIntent ? 'interventions' : 'exchange')
  const [interventionLink, setInterventionLink] = useState<{ requestId?: string; schoolDayChangeId?: string }>()
  const [proposalSelection, setProposalSelection] = useState<{ input: ExchangeInput; token: number }>()
  const resolvedNotification = useRef(''), [sourceError, setSourceError] = useState('')
  const pending = pendingStore.request as (TimetableRecovery & { command: OperationsCommand }) | undefined
  const memberScope = recoveryScope(member)
  const [tab, setTab] = useState<Tab>(() => interventionPending.request || interventionAssistantPending.request ? 'exchange' : initialRecordsRecovery.request ? 'shared' : pending ? ['publish', 'publish_manifest', 'school_day'].includes(pending.command.kind) ? 'publish' : 'exchange' : initialRequestId || initialNotificationId || initialIntent ? 'exchange' : route.initial ?? 'shared')
  const focusedDate = dateOffset(initialDate ?? date, 0) || date, focusSource = useRef(focusedDate)
  const [from, setFrom] = useState(() => timetableWeekStart(focusedDate)), [reload, setReload] = useState(0), [ready, setReady] = useState<OperationsReadiness>()
  const [boardDate, setBoardDate] = useState(focusedDate), [schoolDayDirty, setSchoolDayDirty] = useState(Boolean(schoolDayMemory.initial))
  const [boardFilter, setBoardFilter] = useState({ teacher: member.id, group: '' })
  const [recordLessonId, setRecordLessonId] = useState(initialLessonId ?? (initialRecordsRecovery.request?.command as { lessonId?: string } | undefined)?.lessonId ?? ''), [recordsLocked, setRecordsLocked] = useState(false)
  const recordsPending = initialRecordsRecovery, incomingLesson = useRef(initialLessonId)
  const [boardMode, setBoardMode] = useState<'week' | 'day'>()
  const [fetched, setFetched] = useState<{ key: string; value: OperationsView }>(), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('')
  const [missingKey, setMissingKey] = useState<string>(), [resendConfirmed, setResendConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [discard, setDiscard] = useState(false)
  const [publishDirty, setPublishDirty] = useState(Boolean(publishMemory.initial)), [exchangeDirty, setExchangeDirty] = useState(Boolean(exchangeMemory.initial)), [publishEpoch, setPublishEpoch] = useState(0), [exchangeEpoch, setExchangeEpoch] = useState(0)
  const [schoolDayEpoch, setSchoolDayEpoch] = useState(0), [publicationBusy, setPublicationBusy] = useState(false), [schoolDayBusy, setSchoolDayBusy] = useState(false)
  const inspecting = useRef({ publication: false, schoolDay: false })
  const [requestSelection, setRequestSelection] = useState<{ requestId: string; token: number }>(), handledRequest = useRef('')
  const [sourceSelection, setSourceSelection] = useState<{ lessonId: string; token: number }>(), selectionToken = useRef(0)
  const [publishLink, setPublishLink] = useState<{ id: string; version: number }>(), handledPublishLink = useRef('')
  const [references, setReferences] = useState<OperationReferenceView>(), [referenceError, setReferenceError] = useState('')
  const life = useRef(0), running = useRef(false), feedback = useRef<HTMLDivElement>(null)
  const until = dateOffset(from, nextLimits.sharedWindowDays), enabled = activeAt(member, date), queryKey = JSON.stringify([date, from, until, revision, reload, enabled])
  const view = !loading && !loadError && ready?.available && fetched?.key === queryKey && enabled ? fetched.value : null
  const current = useRef({ view, enabled, pending }); current.current = { view, enabled, pending }
  const interventionLock = interventionsLocked || Boolean(interventionPending.request) || Boolean(interventionAssistantPending.request)
  const writeLocked = busy || Boolean(pending), otherLocked = writeLocked || publicationBusy || schoolDayBusy || recordsLocked || Boolean(recordsPending.request), locked = otherLocked || interventionLock, navLocked = locked || publishDirty || exchangeDirty || schoolDayDirty
  const intentShown = useRef('')
  useEffect(() => {
    if (!initialIntent || intentShown.current === initialIntent.token || otherLocked || exchangeDirty || publishDirty || schoolDayDirty) return
    intentShown.current = initialIntent.token
    setRequestMode('interventions'); setTab('exchange'); route.save('exchange', false)
  }, [initialIntent, otherLocked, exchangeDirty, publishDirty, schoolDayDirty])
  const refresh = useCallback(() => setReload(value => value + 1), [])
  const changePublishDirty = useCallback((value: boolean) => setPublishDirty(value), [])
  const changeExchangeDirty = useCallback((value: boolean) => setExchangeDirty(value), [])
  const changePublicationBusy = useCallback((value: boolean) => { inspecting.current.publication = value; setPublicationBusy(value) }, [])
  const changeSchoolDayBusy = useCallback((value: boolean) => { inspecting.current.schoolDay = value; setSchoolDayBusy(value) }, [])
  useEffect(() => {
    if (incomingLesson.current === initialLessonId || locked) return
    incomingLesson.current = initialLessonId
    if (initialLessonId) setRecordLessonId(initialLessonId)
  }, [initialLessonId, locked])
  useEffect(() => {
    if (!initialRequestId || handledRequest.current === initialRequestId || locked) return
    handledRequest.current = initialRequestId; setRequestMode('exchange'); setRequestSelection({ requestId: initialRequestId, token: ++selectionToken.current }); setTab('exchange'); route.save('exchange', false)
  }, [initialRequestId, locked])
  useEffect(() => {
    if (!initialNotificationId || !interventions || resolvedNotification.current === initialNotificationId || navLocked) return
    let cancelled = false; setSourceError('')
    void interventions.resolve(member.id, initialNotificationId).then(source => {
      if (cancelled) return
      resolvedNotification.current = initialNotificationId
      setBoardDate(source.date); setFrom(timetableWeekStart(source.date))
      if (source.lessonId) setRecordLessonId(source.lessonId)
      if (source.kind === 'exchange' && source.requestId) {
        setRequestMode('exchange'); setRequestSelection({ requestId: source.requestId, token: ++selectionToken.current })
      } else {
        setRequestMode('interventions'); setInterventionLink({ requestId: source.requestId ?? undefined, schoolDayChangeId: source.schoolDayChangeId ?? undefined })
      }
      setTab('exchange'); route.save('exchange', false)
    }).catch(failure => {
      if (cancelled) return
      // 기존 T2만 설치된 학교의 교환 알림은 종전 조회를 그대로 이용한다.
      if (failure instanceof ServiceError && failure.code === 'NOT_READY') {
        resolvedNotification.current = initialNotificationId; setRequestMode('exchange')
        setRequestSelection({ requestId: initialNotificationId, token: ++selectionToken.current }); setTab('exchange')
      } else setSourceError('알림의 시간표 원본을 확인하지 못했습니다. 다른 요청으로 연결하지 않았습니다.')
    })
    return () => { cancelled = true }
  }, [initialNotificationId, interventions, member.id, navLocked, reload])
  useEffect(() => {
    if (!initialDraftId || !Number.isSafeInteger(initialDraftVersion) || initialDraftVersion! < 1) return
    const key = JSON.stringify([initialDraftId, initialDraftVersion])
    if (handledPublishLink.current === key) return
    handledPublishLink.current = key; onInitialDraftConsumed?.()
    if (pending || navLocked) { setNotice('보관한 입력과 원래 요청을 먼저 확인해 주세요. 편성 화면에서 연결한 초안으로 기존 입력을 바꾸지 않았습니다.'); return }
    setPublishLink({ id: initialDraftId, version: initialDraftVersion! }); setTab('publish'); route.save('publish', false)
  }, [initialDraftId, initialDraftVersion, pending, navLocked, onInitialDraftConsumed])
  useEffect(() => { if (focusedDate !== focusSource.current && !locked) { focusSource.current = focusedDate; setBoardDate(focusedDate); setFrom(timetableWeekStart(focusedDate)) } }, [focusedDate, locked])
  useEffect(() => { life.current++; return () => { life.current++; running.current = false } }, [server, publicationExecution, schoolDayExecution, memberScope])
  useEffect(() => { onNavigationLockChange?.(navLocked); return () => onNavigationLockChange?.(false) }, [navLocked, onNavigationLockChange])
  useEffect(() => { if (!navLocked) return; const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', beforeLeave); return () => window.removeEventListener('beforeunload', beforeLeave) }, [navLocked])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError(''); setReady(undefined)
    if (!enabled || !until) { setFetched(undefined); setLoadError('현재 학교 소속과 조회 기간을 확인해 주세요.'); setLoading(false); return }
    void server.readiness(member.id).then(async value => {
      if (cancelled) return
      setReady(value)
      if (!value.available) { setFetched(undefined); return }
      const next = await server.get(member.id, from, until)
      if (!cancelled) setFetched({ key: queryKey, value: next })
    }).catch(failure => { if (!cancelled) { setFetched(undefined); setLoadError(message(failure)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [server, member.id, queryKey, enabled, from, until])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  useEffect(() => {
    let cancelled = false; setReferences(undefined); setReferenceError('')
    if (!view || !extensions) return
    void extensions.references(member.id, view).then(result => { if (!cancelled) setReferences(result) }).catch(() => { if (!cancelled) setReferenceError('학급별 조회 연결을 확인하지 못했습니다. 교사별 시간표와 기존 요청은 계속 이용할 수 있습니다.') })
    return () => { cancelled = true }
  }, [view, extensions, member.id])
  function open(next: Tab) { if (locked || next === tab) return; route.save(next, false); setTab(next); setDiscard(false) }
  function clearCommandDraft(command: OperationsCommand) {
    if (command.kind === 'publish' || command.kind === 'publish_manifest') { publishMemory.remove(); setPublishEpoch(value => value + 1); setPublishDirty(false) }
    else if (command.kind === 'school_day') { schoolDayMemory.remove(); setSchoolDayEpoch(value => value + 1); setSchoolDayDirty(false) }
    // 기존 요청에 응답한 결과를 복구해도 별도로 작성 중인 새 요청은 지우지 않는다.
    else if (command.kind === 'submit') { exchangeMemory.remove(); setExchangeEpoch(value => value + 1); setExchangeDirty(false) }
  }
  async function dispatch(command: OperationsCommand, key: string, mode: 'execute' | 'recover' | 'resend'): Promise<OperationsReceipt> {
    if (command.kind === 'publish_manifest') {
      if (!publicationExecution || !publicationExecution[mode]) throw new ServiceError('NOT_READY')
      return publicationExecution[mode]!(member.id, command, key)
    }
    if (command.kind === 'school_day') {
      if (!schoolDayExecution || !schoolDayExecution[mode]) throw new ServiceError('NOT_READY')
      return schoolDayExecution[mode]!(member.id, command, key)
    }
    if (!server[mode]) throw new ServiceError('NOT_READY')
    return server[mode]!(member.id, command, key)
  }
  async function runCommand(command: OperationsCommand): Promise<OperationsReceipt> {
    const live = current.current, snapshot = live.view
    if (running.current || live.pending || recordsPending.request || interventionLock) throw new ServiceError('RESULT_UNKNOWN')
    if (inspecting.current.publication || inspecting.current.schoolDay) throw new ServiceError('NOT_READY')
    if (!live.enabled || !snapshot) throw new ServiceError('NOT_READY')
    if (['publish', 'publish_manifest', 'school_day'].includes(command.kind) && !snapshot.canPublish || command.kind === 'submit' && !snapshot.canRequest) throw new ServiceError('FORBIDDEN')
    if (command.kind === 'publish_manifest' && !snapshot.drafts.some(draft => draft.id === command.manifest.input.draftId && draft.version === command.manifest.input.draftVersion)) throw new ServiceError('CONFLICT')
    if (command.kind === 'school_day' && command.context.view.asOf !== snapshot.asOf) throw new ServiceError('CONFLICT')
    if (command.kind === 'action' && !snapshot.requests.some(request => request.id === command.requestId && request.version === command.expectedVersion && request.proposalHash === command.proposalHash && request.actions.includes(command.action))) throw new ServiceError('CONFLICT')
    const request = { command: structuredClone(command), key: crypto.randomUUID() }, generation = life.current
    running.current = true; setBusy(true); setError(''); setNotice(''); pendingStore.put(request)
    try {
      const receipt = await dispatch(request.command, request.key, 'execute')
      if (generation !== life.current) throw new ServiceError('CANCELLED')
      pendingStore.remove(request.key); setNotice(receiptMessage(receipt)); refresh()
      return receipt
    } catch (failure) {
      if (generation === life.current && rejected(failure)) {
        pendingStore.remove(request.key)
        if (failure instanceof ServiceError && failure.code !== 'INVALID_INPUT') { if (command.kind === 'school_day') setError(message(failure)); refresh() }
      }
      throw failure
    } finally { if (generation === life.current) { running.current = false; setBusy(false) } }
  }
  const execute = (command: OperationCommand) => runCommand(command) as Promise<OperationReceipt>
  const executePublication = (command: PublicationCommitCommand) => runCommand(command) as Promise<PublicationCommitReceipt>
  const executeSchoolDay = (command: SchoolDayCommitCommand) => runCommand(command) as Promise<SchoolDayCommitReceipt>
  async function recover(resend = false) {
    if (!pending || pending.closeState === 'closing' || running.current || !enabled || resend && (missingKey !== pending.key || !resendConfirmed)) return
    const request = structuredClone(pending), generation = life.current
    running.current = true; setBusy(true); setError(''); setNotice(''); setMissingKey(undefined); setResendConfirmed(false)
    try {
      const receipt = await dispatch(request.command, request.key, resend ? 'resend' : 'recover')
      if (generation !== life.current) return
      pendingStore.remove(request.key); clearCommandDraft(request.command); setNotice(receiptMessage(receipt)); refresh()
    } catch (failure) {
      if (generation !== life.current) return
      // 현재 권한·준비 조회 실패로 이전 실행이 취소되었다고 판단하지 않는다.
      if (!resend && failure instanceof ServiceError && failure.code === 'NOT_FOUND') { setMissingKey(request.key); setNotice('아직 접수증을 찾지 못했습니다. 최초 요청이 늦게 처리될 수 있어 입력과 원래 요청 번호를 유지합니다.') }
      else {
        if (resend && rejected(failure)) pendingStore.put({ ...request, closeState: 'available' })
        setError(message(failure))
      }
    } finally { if (generation === life.current) { running.current = false; setBusy(false) } }
  }
  async function closeRequest() {
    if (!pending?.closeState || running.current || !enabled) return
    const request = structuredClone(pending), generation = life.current
    running.current = true; setBusy(true); setError(''); setNotice(''); setMissingKey(undefined); setResendConfirmed(false)
    // 닫기를 보낸 뒤 응답이 끊겨도 같은 요청의 닫기만 다시 확인한다.
    pendingStore.put({ ...request, closeState: 'closing' })
    try {
      let result
      if (request.command.kind === 'publish_manifest') {
        if (!publicationExecution?.abandon) throw new ServiceError('NOT_READY')
        result = await publicationExecution.abandon(member.id, request.command, request.key)
      } else if (request.command.kind === 'school_day') {
        if (!schoolDayExecution?.abandon) throw new ServiceError('NOT_READY')
        result = await schoolDayExecution.abandon(member.id, request.command, request.key)
      } else {
        if (!server.abandon) throw new ServiceError('NOT_READY')
        result = await server.abandon(member.id, request.command, request.key)
      }
      if (generation !== life.current) return
      pendingStore.remove(request.key)
      if (result.outcome === 'applied') {
        clearCommandDraft(request.command)
        setNotice('원래 요청이 이미 처리된 것을 확인했습니다. ' + receiptMessage(result.receipt))
      } else {
        // 입력은 남기고 이전 미리보기·확인만 버려 새 검토 없이 재전송하지 않게 한다.
        if (request.command.kind === 'publish' || request.command.kind === 'publish_manifest') setPublishEpoch(value => value + 1)
        else if (request.command.kind === 'school_day') setSchoolDayEpoch(value => value + 1)
        else if (request.command.kind === 'submit') setExchangeEpoch(value => value + 1)
        setNotice('이 요청을 닫았습니다. 입력은 보관했습니다. 최신 시간표와 변경 내용을 다시 확인한 뒤 새 요청으로 보낼 수 있습니다.')
      }
      refresh()
    } catch (failure) {
      if (generation === life.current) setError('요청 닫기를 확인하지 못했습니다. 원래 번호와 입력을 유지합니다. ' + message(failure))
    } finally { if (generation === life.current) { running.current = false; setBusy(false) } }
  }
  function discardInputs() {
    if (locked) return
    publishMemory.remove(); exchangeMemory.remove(); schoolDayMemory.remove(); setPublishEpoch(value => value + 1); setExchangeEpoch(value => value + 1); setSchoolDayEpoch(value => value + 1)
    setPublishDirty(false); setExchangeDirty(false); setSchoolDayDirty(false); setDiscard(false); setNotice('보관한 입력을 버렸습니다. 다른 메뉴로 이동할 수 있습니다.'); setError('')
  }
  function requestLesson(lesson: OperationLesson) {
    if (locked || !view?.canRequest || !lesson.canRequest) return
    setSourceSelection({ lessonId: lesson.id, token: ++selectionToken.current }); setRequestMode('exchange'); open('exchange')
  }
  return <section className="timetable-operations" aria-labelledby={`${id}-title`}>
    <style>{themeStyles + styles}</style>
    <header className="ttops-header"><div><p className="ttops-eyebrow">학교 시간표</p><h1 id={`${id}-title`}>시간표 운영</h1><p className="ttops-muted">확정된 수업을 함께 확인하고, 변경은 상대 확인과 승인을 거쳐 반영합니다.</p></div><button type="button" className="secondary" onClick={refresh} disabled={busy || publicationBusy || schoolDayBusy || recordsLocked || loading}>최신 시간표 확인</button></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="ttops-error">{error}</p>}{notice && <p role="status" className="ttops-notice">{notice}</p>}{sourceError && <p role="alert">{sourceError} <button type="button" onClick={refresh}>원본 다시 확인</button></p>}</div>
    {pending && <section className="ttops-pending" aria-labelledby={`${id}-pending`}>
      <h3 id={`${id}-pending`}>{pending.closeState === 'closing' ? '요청 닫기 결과 확인이 필요합니다' : '원래 요청의 결과 확인이 필요합니다'}</h3><p>{pending.closeState === 'closing' ? '보관한 번호와 내용으로 닫기 결과를 확인합니다.' : '새 요청을 만들지 않고 보관한 요청 번호의 결과만 조회합니다.'} 확인 전에는 다른 시간표 변경을 시작할 수 없습니다.</p>
      <details><summary>보관한 요청 번호</summary><code>{pending.key}</code></details>
      {pending.closeState !== 'closing' && <button type="button" disabled={busy || !enabled} onClick={() => void recover()}>{busy ? '처리 결과 확인 중…' : '원래 요청 결과만 다시 확인'}</button>}
      {pending.closeState !== 'closing' && missingKey === pending.key && <div className="ttops-retry"><p>다시 조회하거나, 원래 내용 그대로 같은 번호로만 다시 보낼 수 있습니다. 이미 처리됐다면 원래 결과를 받습니다. 새 요청 번호를 만들지 않습니다.</p>
        <label><input type="checkbox" checked={resendConfirmed} disabled={busy || !enabled} onChange={event => setResendConfirmed(event.target.checked)} />늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다</label>
        <button type="button" disabled={busy || !enabled || !resendConfirmed || !(pending.command.kind === 'publish_manifest' ? publicationExecution?.resend : pending.command.kind === 'school_day' ? schoolDayExecution?.resend : server.resend)} onClick={() => void recover(true)}>같은 번호·같은 내용으로 다시 보내기</button>
      </div>}
      <RequestClosePanel key={pending.key} state={pending.closeState} busy={busy} disabled={!enabled || !(pending.command.kind === 'publish_manifest' ? publicationExecution?.abandon : pending.command.kind === 'school_day' ? schoolDayExecution?.abandon : server.abandon)} onConfirm={() => void closeRequest()} />
      <p className="ttops-muted">입력과 요청 번호는 현재 탭에만 보관됩니다. 확인을 마칠 때까지 새로고침하거나 창을 닫지 마세요.</p>
    </section>}
    {loading && <p role="status">시간표 운영 연결을 확인하고 있습니다…</p>}
    {!loading && loadError && <div role="alert" className="ttops-error"><h3>시간표 운영 자료를 불러오지 못했습니다</h3><p>{loadError}</p><p>이전 자료는 숨겼습니다. 작성한 입력은 연결 확인 뒤 이어서 사용할 수 있습니다.</p><button type="button" className="secondary" onClick={refresh} disabled={busy}>운영 연결 다시 확인</button></div>}
    {!loading && !loadError && ready && !ready.available && <div role="status" className="ttops-card"><h3>시간표 운영 연결 준비 중</h3><p>{readinessMessage[ready.reason]}</p><p className="ttops-muted">연결되지 않은 시간표를 임의로 만들거나 확정하지 않습니다. 편성 화면의 초안 작업은 별도로 이용할 수 있습니다.</p></div>}
    <nav className="ttops-tabs" aria-label="시간표 운영 작업"><button type="button" aria-pressed={tab === 'shared'} disabled={locked && tab !== 'shared'} onClick={() => open('shared')}>공유 시간표</button>{(!view || view.canPublish || publishDirty || schoolDayDirty || tab === 'publish') && <button type="button" aria-pressed={tab === 'publish'} disabled={locked && tab !== 'publish'} onClick={() => open('publish')}>시간표 확정{publishDirty ? ' · 작성 중' : ''}</button>}<button type="button" aria-pressed={tab === 'exchange'} disabled={locked && tab !== 'exchange'} onClick={() => open('exchange')}>교환·변경 요청{exchangeDirty ? ' · 작성 중' : ''}</button></nav>
    <div hidden={tab !== 'shared'}>
      {view && <section className="ttops-card" aria-label="확정 수업 조회">
        <PublishedTimetableBoard view={view} memberId={member.id} date={date} initialDate={boardDate} initialFilter={boardFilter} onFilterChange={setBoardFilter} initialMode={boardMode} onModeChange={setBoardMode} locked={locked} selectionLocked={recordsLocked || Boolean(recordsPending.request)} references={references} onRequest={requestLesson} onRangeChange={(first, selected) => { setBoardDate(selected); if (first < view.from || dateOffset(first, 7) > view.until) setFrom(first) }} initialLessonId={recordLessonId} onSelectLesson={setRecordLessonId} onOpenLesson={onOpenLesson} />
        {referenceError && <details><summary>학급 연결 상태</summary><p className="ttops-muted">{referenceError}</p></details>}
        <details className="ttops-publications"><summary>적용 중인 확정본 {view.publications.length}건</summary>{view.publications.length ? <ul>{view.publications.map(item => <li key={item.id}><strong>{item.title} · {item.version}판</strong><p>{item.from} ~ {dateOffset(item.until, -1)}</p><small>확정 시각 {new Date(item.publishedAt).toLocaleString('ko-KR', { timeZone: view.timeZone })}</small></li>)}</ul> : <p>이 조회 기간에 적용되는 확정본이 없습니다.</p>}</details>
      </section>}
      <TimetableExecutionRecordsPanel member={member} lesson={view?.lessons.find(lesson => lesson.id === recordLessonId)} server={executionRecords} disabled={writeLocked || publicationBusy || schoolDayBusy || interventionLock || !enabled} refreshKey={revision + reload} onLockChange={setRecordsLocked} onRecorded={refresh} />
    </div>
    <div hidden={tab !== 'publish'}><TimetablePublishPanel key={publishEpoch} initialDraftId={publishLink?.id} initialDraftVersion={publishLink?.version} onInitialDraftConsumed={() => setPublishLink(undefined)} server={server} member={member} view={view} loading={loading} locked={writeLocked || schoolDayBusy || recordsLocked || interventionLock} onCommand={execute} onDirtyChange={changePublishDirty} extensions={extensions} onPublicationCommand={publicationExecution ? executePublication : undefined} onPublicationBusyChange={changePublicationBusy} /><SchoolDayChangePanel key={'school-day-' + schoolDayEpoch} member={member} view={view} references={references} extensions={extensions} locked={writeLocked || publicationBusy || recordsLocked || interventionLock} onDirtyChange={setSchoolDayDirty} execution={schoolDayExecution} onCommand={schoolDayExecution ? executeSchoolDay : undefined} onBusyChange={changeSchoolDayBusy} /></div>
    <div hidden={tab !== 'exchange'}>
      {interventions && <nav className="ttops-tabs" aria-label="수업 변경 종류">
        <button type="button" aria-pressed={requestMode === 'exchange'} disabled={interventionLock} onClick={() => setRequestMode('exchange')}>이동·교환</button>
        <button type="button" aria-pressed={requestMode === 'interventions'} disabled={otherLocked || exchangeDirty} onClick={() => setRequestMode('interventions')}>대강·휴강·보강</button>
      </nav>}
      <div hidden={requestMode !== 'exchange'}><TimetableExchangePanel key={exchangeEpoch} server={server} member={member} view={view} loading={loading} locked={locked} onCommand={execute} onDirtyChange={changeExchangeDirty} onReload={refresh} revision={revision + reload} requestSelection={requestSelection} onRequestSelectionConsumed={() => setRequestSelection(undefined)} sourceSelection={sourceSelection} onSelectionConsumed={() => setSourceSelection(undefined)} proposalSelection={proposalSelection} onProposalSelectionConsumed={() => setProposalSelection(undefined)} extensions={extensions} /></div>
      {interventions && <div hidden={requestMode !== 'interventions'}><TimetableInterventionsPanel initialIntent={initialIntent} onInitialIntentConsumed={onInitialIntentConsumed} server={interventions} member={member} date={boardDate} view={view ?? undefined} selectedLessonId={recordLessonId} initialRequestId={interventionLink?.requestId} initialSchoolDayChangeId={interventionLink?.schoolDayChangeId} revision={revision + reload} disabled={otherLocked || exchangeDirty || publishDirty || schoolDayDirty || !enabled} assistantServer={assistantServer} onChanged={refresh} onLockChange={setInterventionsLocked} onExchangeProposal={input => { setProposalSelection({ input, token: ++selectionToken.current }); setRequestMode('exchange') }} /></div>}
    </div>
    {(publishDirty || exchangeDirty || schoolDayDirty) && !locked && (!view || tab === 'shared' || tab === 'publish' && !view.canPublish || tab === 'exchange' && (!view.canRequest || schoolDayDirty)) && <section className="ttops-reset" aria-label="보관한 입력 정리">
      {discard ? <><p>현재 탭에 보관한 확정·교환·학사 변경 입력을 모두 버립니다. 이미 서버에 반영된 시간표와 요청은 바뀌지 않습니다.</p><button type="button" className="secondary" onClick={discardInputs}>입력 버리고 메뉴 잠금 해제</button><button type="button" className="secondary" onClick={() => setDiscard(false)}>계속 작성하기</button></> : <button type="button" className="secondary" onClick={() => setDiscard(true)}>보관한 입력 정리</button>}
    </section>}
  </section>
}
