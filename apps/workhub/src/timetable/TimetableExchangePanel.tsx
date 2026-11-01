import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/service-values'
import type { ExchangeInput, ExchangePreview, ExchangeRequestView, OperationCommand, OperationReceipt, OperationTime, OperationsView, RequestAction, RequestState, TimetableOperationsServer } from './operations-contracts'
import { OperationChangeList, OperationLessonLabel } from './OperationChangeList'
import styles from './timetable-exchanges.css?inline'
import inboxStyles from './timetable-exchange-inbox.css?inline'
import apiLimits from './operations-api-limits.json'
import type { ExchangeRecommendations, OperationsExtensions } from './operations-next-contracts'
import { activeExchange, exchangeAttention, exchangeConsentSummary, exchangeFilters, exchangeNextStep, exchangeProgress, findExchangeRequest, selectExchangeRequests, visibleExchangeActions, type ExchangeFilter } from './exchange-inbox'
import { timetableDateOffset } from './operations-calendar'
import { operationTeacherLabels, selectOperationLessons } from './operation-review'
import reviewStyles from './operation-review.css?inline'
import workflowStyles from './timetable-workflow-ui.css?inline'
import { ComposerOptions } from '../app/ComposerOptions'

export interface TimetableExchangePanelProps {
  server: TimetableOperationsServer; member: Membership; view: OperationsView | null; loading: boolean; locked: boolean
  onCommand: (command: OperationCommand) => Promise<OperationReceipt>; onDirtyChange: (dirty: boolean) => void
  onReload: () => void; revision?: number
  requestSelection?: { requestId: string; token: number }; onRequestSelectionConsumed?: () => void
  sourceSelection?: { lessonId: string; token: number }; extensions?: OperationsExtensions; onSelectionConsumed?: () => void
  proposalSelection?: { input: ExchangeInput; token: number }; onProposalSelectionConsumed?: () => void
}
interface ExchangeDraft { kind: 'move' | 'swap'; lessonId: string; targetKey: string; otherLessonId: string; reason: string }
interface SelectedAction { requestId: string; expectedVersion: number; proposalHash: string; action: RequestAction }
const emptyDraft = (): ExchangeDraft => ({ kind: 'swap', lessonId: '', targetKey: '', otherLessonId: '', reason: '' })
const timeKey = (time: OperationTime) => time.startsAt + '|' + time.endsAt
const statusText: Record<RequestState, string> = { awaiting_consent: '관련 교사 동의 대기', awaiting_approval: '담당자 승인 대기', applied: '시간표 반영 완료', rejected: '거절됨', withdrawn: '요청 철회', expired: '기한 지남', stale: '최신 수업으로 재검토 필요' }
const actionText: Record<RequestAction, string> = { accept: '변경안에 동의', reject: '동의하지 않음', withdraw: '요청 철회', approve: '승인하고 시간표에 반영', rejectApproval: '승인하지 않음' }
const dirtyDraft = (draft: ExchangeDraft) => Boolean(draft.lessonId || draft.targetKey || draft.otherLessonId || draft.reason.trim())
const failureText = (error: unknown) => error instanceof ServiceError ? error.message : '처리 결과를 확인하지 못했습니다. 입력과 기존 요청은 유지됩니다.'
function formatTime(time: OperationTime, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return formatter.format(new Date(time.startsAt)) + ' – ' + formatter.format(new Date(time.endsAt))
}
const futureLesson = (lesson: OperationsView['lessons'][number], now = Date.now()) => lesson.state === 'scheduled' && Date.parse(lesson.time.startsAt) > now
const moveTargets = (lesson: OperationsView['lessons'][number], now = Date.now()) => lesson.allowedTargets.filter(target => timeKey(target) !== timeKey(lesson.time) && Date.parse(target.startsAt) > now && Date.parse(target.endsAt) - Date.parse(target.startsAt) === Date.parse(lesson.time.endsAt) - Date.parse(lesson.time.startsAt))
const swapCandidates = (source: OperationsView['lessons'][number] | undefined, view: OperationsView, now = Date.now()) => source ? view.lessons.filter(other => other.id !== source.id && futureLesson(other, now) && moveTargets(source, now).some(target => timeKey(target) === timeKey(other.time)) && moveTargets(other, now).some(target => timeKey(target) === timeKey(source.time))) : []
function inputFor(draft: ExchangeDraft, view: OperationsView): ExchangeInput | null {
  const lesson = view.lessons.find(item => item.id === draft.lessonId && item.canRequest && futureLesson(item))
  if (!view.canRequest || !lesson || !draft.reason.trim()) return null
  if (draft.kind === 'move') {
    const target = moveTargets(lesson).find(item => timeKey(item) === draft.targetKey)
    return target ? { kind: 'move', lessonId: lesson.id, expectedVersion: lesson.version, target: structuredClone(target), reason: draft.reason.trim() } : null
  }
  const other = swapCandidates(lesson, view).find(item => item.id === draft.otherLessonId)
  return other ? { kind: 'swap', lessonId: lesson.id, expectedVersion: lesson.version, otherLessonId: other.id, otherExpectedVersion: other.version, reason: draft.reason.trim() } : null
}
function ExchangeRequestDetails({ request, timeZone, selected }: { request: ExchangeRequestView; timeZone: string; selected: boolean }) {
  const participantLabels = operationTeacherLabels(request.participants)
  const [expanded, setExpanded] = useState(() => visibleExchangeActions(request).length > 0 && Date.parse(request.expiresAt) > Date.now())
  useEffect(() => { if (selected) setExpanded(true) }, [selected])
  return <details className="timetable-exchange-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>변경 전후와 교사별 응답 보기</summary>
    <OperationChangeList changes={request.changes} timeZone={timeZone} />
    <ul className="timetable-exchange-consents" aria-label="교사별 동의 상태">{request.participants.map(participant => <li key={participant.id}><span>{participantLabels.get(participant.id)}</span><strong>{participant.response === 'accepted' ? '동의함' : participant.response === 'rejected' ? '동의하지 않음' : '응답 대기'}</strong></li>)}</ul>
  </details>
}
// 같은 학교의 권한 범위가 바뀌어도 이전 입력을 새 소속 화면에 표시하지 않는다.
export function TimetableExchangePanel(props: TimetableExchangePanelProps) {
  return <ExchangePanelSession key={recoveryScope(props.member)} {...props} />
}
function ExchangePanelSession({ server, member, view, loading, locked, onCommand, onDirtyChange, onReload, revision = 0, sourceSelection, extensions, onSelectionConsumed, requestSelection, onRequestSelectionConsumed, proposalSelection, onProposalSelectionConsumed }: TimetableExchangePanelProps) {
  const composeHeading = useRef<HTMLHeadingElement>(null), requestsHeading = useRef<HTMLHeadingElement>(null)
  function jumpTo(section: 'compose' | 'requests') {
    const node = (section === 'compose' ? composeHeading : requestsHeading).current
    node?.focus(); node?.scrollIntoView({ block: 'start' })
  }
  const id = useId(), memory = useEditDraft<ExchangeDraft>(member, 'timetable-exchanges')
  const [draft, setDraft] = useState<ExchangeDraft>(() => memory.initial ?? emptyDraft())
  const [preview, setPreview] = useState<ExchangePreview>(), [confirmed, setConfirmed] = useState(false)
  const [selected, setSelected] = useState<SelectedAction>(), [actionConfirmed, setActionConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(Date.now)
  const [suggestions, setSuggestions] = useState<ExchangeRecommendations>(), [replaceSource, setReplaceSource] = useState<string>()
  const [replaceProposal, setReplaceProposal] = useState<ExchangeInput>(), usedProposal = useRef<number>()
  const [requestFilter, setRequestFilter] = useState<ExchangeFilter>('all'), [requestQuery, setRequestQuery] = useState(''), [requestLimit, setRequestLimit] = useState(20)
  const [sourceQuery, setSourceQuery] = useState(''), [candidateQuery, setCandidateQuery] = useState('')
  const [openedRequest, setOpenedRequest] = useState<{ requestId: string; token: number }>()
  const opened = view && openedRequest ? findExchangeRequest(view.requests, openedRequest.requestId) : undefined
  const appliedRequest = useRef<number>(), focusedRequest = useRef<number>(), requestCards = useRef(new Map<string, HTMLElement>()), requestFeedback = useRef<HTMLDivElement>(null)
  const appliedSelection = useRef<number>()
  const life = useRef(0), operation = useRef(false), sequence = useRef(0), feedback = useRef<HTMLDivElement>(null), previewSource = useRef('')
  const sourceKey = view && !loading ? canonical([view.from, view.until, view.canRequest, view.lessons, view.requests]) : ''
  const current = useRef({ sourceKey, draft, view }); current.current = { sourceKey, draft, view }
  const visible = Boolean(view && !loading), input = view && visible ? inputFor(draft, view) : null
  const unavailable = locked || busy || !visible
  const shownPreview = preview && previewSource.current === sourceKey && view?.canRequest ? preview : undefined
  const previewCurrent = Boolean(shownPreview && input && canonical(shownPreview.input) === canonical(input) && Date.parse(shownPreview.expiresAt) > clock)
  const canSubmit = previewCurrent && preview?.blockers.length === 0 && confirmed && !unavailable
  const selectedRequest = view?.requests.find(request => request.id === selected?.requestId)
  const selectedCurrent = Boolean(selected && selectedRequest && selected.expectedVersion === selectedRequest.version && selected.proposalHash === selectedRequest.proposalHash && selectedRequest.actions.includes(selected.action) && !(selected.action === 'approve' && selectedRequest.requesterIsViewer))
  const responseBeforeExpiry = Boolean(!selected || selectedRequest && Date.parse(selectedRequest.expiresAt) > clock)
  const hasTimedRequests = Boolean(view?.requests.some(activeExchange))
  const dirty = dirtyDraft(draft) || Boolean(selected) || busy

  useEffect(() => { life.current++; return () => { life.current++; sequence.current++; operation.current = false } }, [server])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { setPreview(undefined); setConfirmed(false); setSelected(undefined); setActionConfirmed(false); sequence.current++ }, [sourceKey, revision])
  useEffect(() => { setSuggestions(undefined) }, [sourceKey, revision, draft.lessonId, draft.reason])
  useEffect(() => {
    if (!sourceSelection || sourceSelection.token === appliedSelection.current || unavailable || !view) return
    appliedSelection.current = sourceSelection.token
    onSelectionConsumed?.()
    const source = view.lessons.find(lesson => lesson.id === sourceSelection.lessonId && lesson.canRequest && futureLesson(lesson))
    if (!source || !view.canRequest) { setError('선택한 수업의 현재 판과 요청 권한을 다시 확인해 주세요.'); return }
    if (dirtyDraft(draft)) { setReplaceSource(source.id); return }
    const next = { ...emptyDraft(), lessonId: source.id }; setDraft(next); memory.save(next, true); setPreview(undefined); setConfirmed(false); setSelected(undefined); setActionConfirmed(false); setNotice('시간표에서 선택한 수업으로 변경 요청을 시작합니다.'); sequence.current++
  }, [sourceSelection, unavailable, sourceKey])
  useEffect(() => {
    if (!requestSelection || requestSelection.token === appliedRequest.current || unavailable || !view) return
    appliedRequest.current = requestSelection.token
    // 직접 열기는 조회일 뿐이다. 새 요청 입력·기존 응답 확인·원래 요청 번호를 바꾸지 않는다.
    setOpenedRequest({ ...requestSelection }); onRequestSelectionConsumed?.()
  }, [requestSelection, unavailable, sourceKey, onRequestSelectionConsumed])
  useEffect(() => {
    if (!proposalSelection || proposalSelection.token === usedProposal.current || unavailable || !view) return
    usedProposal.current = proposalSelection.token; onProposalSelectionConsumed?.()
    if (dirtyDraft(draft) || selected) { setReplaceProposal(structuredClone(proposalSelection.input)); return }
    adoptExternalProposal(proposalSelection.input)
  }, [proposalSelection, unavailable, sourceKey, onProposalSelectionConsumed])
  useEffect(() => {
    if (!openedRequest || !visible) return
    if (opened && focusedRequest.current !== openedRequest.token) {
      const card = requestCards.current.get(opened.id)
      if (card) { focusedRequest.current = openedRequest.token; card.focus(); card.scrollIntoView({ block: 'nearest' }) }
    } else if (!opened && focusedRequest.current !== openedRequest.token) requestFeedback.current?.focus()
  }, [openedRequest, opened?.id, visible])
  useEffect(() => {
    if (!preview && !selected && !hasTimedRequests && !suggestions) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [preview, selected, hasTimedRequests, suggestions])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  function update(patch: Partial<ExchangeDraft>) {
    if (unavailable) return
    const next = { ...draft, ...patch }; setDraft(next); memory.save(next, dirtyDraft(next))
    setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); sequence.current++
  }
  function replaceSelectedSource() {
    if (!replaceSource || unavailable || !view?.lessons.some(lesson => lesson.id === replaceSource && lesson.canRequest && futureLesson(lesson))) return
    update({ ...emptyDraft(), lessonId: replaceSource }); setReplaceSource(undefined)
  }
  async function recommend() {
    if (!extensions || !view || !view.canRequest || unavailable || operation.current || !draft.reason.trim()) return
    const source = view.lessons.find(lesson => lesson.id === draft.lessonId && lesson.canRequest && futureLesson(lesson))
    if (!source) return
    const epoch = life.current, token = ++sequence.current, expectedSource = sourceKey
    const expectedDraft = canonical(draft)
    operation.current = true; setBusy(true); setSuggestions(undefined); setError(''); setNotice('')
    try {
      const result = await extensions.recommendations(member.id, { lessonId: source.id, expectedVersion: source.version, reason: draft.reason.trim(), from: view.from, until: view.until }, view)
      if (epoch !== life.current || token !== sequence.current || current.current.sourceKey !== expectedSource || canonical(current.current.draft) !== expectedDraft) return
      setSuggestions(result)
    } catch (failure) { if (epoch === life.current && token === sequence.current) setError(failure instanceof ServiceError && failure.code === 'NOT_READY' ? '교환 추천 연결을 준비 중입니다. 아래에서 상대 수업을 직접 선택할 수 있습니다.' : failureText(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function selectRecommendation(input: ExchangeInput) {
    if (unavailable) return
    update(input.kind === 'swap' ? { kind: 'swap', lessonId: input.lessonId, otherLessonId: input.otherLessonId, targetKey: '', reason: input.reason } : { kind: 'move', lessonId: input.lessonId, targetKey: timeKey(input.target), otherLessonId: '', reason: input.reason })
    setSuggestions(undefined); setNotice('추천안을 선택했습니다. 변경 전후를 다시 확인한 뒤 직접 요청을 보내 주세요.')
  }
  function adoptExternalProposal(proposal: ExchangeInput) {
    if (unavailable || !view) return
    const next: ExchangeDraft = proposal.kind === 'swap' ? { kind: 'swap', lessonId: proposal.lessonId, otherLessonId: proposal.otherLessonId, targetKey: '', reason: proposal.reason } : { kind: 'move', lessonId: proposal.lessonId, otherLessonId: '', targetKey: timeKey(proposal.target), reason: proposal.reason }
    // AI의 오래된 판이나 현재 공식 허용 시간 밖 제안은 직접 입력처럼 보이게 채우지 않는다.
    if (canonical(inputFor(next, view)) !== canonical(proposal)) { setError('제안 이후 수업 판이나 허용 시간이 바뀌었습니다. 최신 수업으로 다시 상담해 주세요. 기존 입력은 유지합니다.'); return }
    update(next); setReplaceProposal(undefined); setSelected(undefined); setActionConfirmed(false)
    setNotice('확인한 제안을 입력에 채웠습니다. 서버에서 변경 전후를 다시 확인한 뒤 직접 보내 주세요.')
  }
  function clearDraft() {
    if (locked || busy) return
    setSourceQuery(''); setCandidateQuery(''); setDraft(emptyDraft()); memory.remove(); setPreview(undefined); setConfirmed(false); setSelected(undefined); setActionConfirmed(false); setError(''); setNotice('보내지 않은 변경 요청 입력을 비웠습니다. 이미 보낸 요청은 그대로 남습니다.'); sequence.current++
  }
  async function inspect() {
    if (!view || !input || unavailable || operation.current) return
    const epoch = life.current, token = ++sequence.current, expectedSource = sourceKey, expectedInput = canonical(input)
    operation.current = true; setBusy(true); setPreview(undefined); setConfirmed(false); setError(''); setNotice('')
    try {
      const next = await server.previewExchange(member.id, structuredClone(input))
      if (epoch !== life.current || token !== sequence.current || current.current.sourceKey !== expectedSource || !current.current.view || canonical(inputFor(current.current.draft, current.current.view)) !== expectedInput) return
      setClock(Date.now()); previewSource.current = expectedSource; setPreview(next)
      if (next.blockers.length) setNotice('아직 요청할 수 없는 항목이 있습니다. 아래 사유를 확인해 주세요.')
    } catch (failure) { if (epoch === life.current && token === sequence.current) setError(failureText(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  async function submit() {
    if (!preview || !input || !canSubmit || operation.current || Date.parse(preview.expiresAt) <= Date.now()) return
    const command: OperationCommand = { kind: 'submit', preview: { previewId: preview.previewId, previewHash: preview.previewHash, expiresAt: preview.expiresAt, input: structuredClone(preview.input) } }
    const epoch = life.current; operation.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const receipt = await onCommand(command)
      if (epoch !== life.current) return
      setDraft(emptyDraft()); memory.remove(); setPreview(undefined); setConfirmed(false)
      setNotice(receipt.status === 'awaiting_approval' ? '내 동의와 변경 요청을 기록했습니다. 담당자가 승인할 때까지 실제 수업은 바뀌지 않습니다.' : '내 동의와 변경 요청을 기록했습니다. 다른 교사의 동의와 담당자 승인이 끝날 때까지 실제 수업은 바뀌지 않습니다.')
    } catch (failure) { if (epoch === life.current) { setError(failureText(failure)); setConfirmed(false) } }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function chooseAction(request: ExchangeRequestView, action: RequestAction) {
    if (unavailable || !request.actions.includes(action) || Date.parse(request.expiresAt) <= Date.now() || action === 'approve' && request.requesterIsViewer) return
    setSelected({ requestId: request.id, expectedVersion: request.version, proposalHash: request.proposalHash, action }); setActionConfirmed(false); setClock(Date.now()); setError(''); setNotice('')
  }
  async function performAction() {
    if (!selected || !selectedRequest || !selectedCurrent || !responseBeforeExpiry || !actionConfirmed || unavailable || operation.current) return
    if (Date.parse(selectedRequest.expiresAt) <= Date.now()) return
    const command: OperationCommand = { kind: 'action', ...selected }, epoch = life.current
    operation.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const receipt = await onCommand(command)
      if (epoch !== life.current) return
      setSelected(undefined); setActionConfirmed(false)
      setNotice(receipt.status === 'applied' ? '담당자 승인이 완료되어 시간표에 반영했습니다.' : selected.action === 'accept' ? '동의를 기록했습니다. 실제 수업은 담당자 승인 후 바뀝니다.' : selected.action === 'withdraw' ? '변경 요청을 철회했습니다. 실제 수업을 되돌리는 작업은 수행하지 않았습니다.' : '요청에 대한 거절을 기록했습니다. 실제 수업은 바뀌지 않았습니다.')
    } catch (failure) { if (epoch === life.current) { setError(failureText(failure)); setActionConfirmed(false) } }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  const source = view?.lessons.find(lesson => lesson.id === draft.lessonId)
  const myLessons = view?.lessons.filter(lesson => lesson.canRequest && futureLesson(lesson)) ?? []
  const candidates = view ? swapCandidates(source, view) : []
  const sourceOptions = selectOperationLessons(myLessons, sourceQuery, draft.lessonId, view?.timeZone ?? 'UTC')
  const candidateOptions = selectOperationLessons(candidates, candidateQuery, draft.otherLessonId, view?.timeZone ?? 'UTC')
  const peopleLabels = operationTeacherLabels(view?.lessons.flatMap(lesson => lesson.teachers) ?? [])
  const lessonNames = new Map<string, number>(); for (const lesson of view?.lessons ?? []) lessonNames.set(lesson.label, (lessonNames.get(lesson.label) ?? 0) + 1)
  const lessonOption = (lesson: OperationsView['lessons'][number]) => [lesson.label + ((lessonNames.get(lesson.label) ?? 0) > 1 ? ` [${lesson.id}]` : ''), lesson.groupNames.join('·'), lesson.teachers.map(person => peopleLabels.get(person.id)).join('·'), formatTime(lesson.time, view!.timeZone)].filter(Boolean).join(' · ')
  const selectedCandidate = candidates.find(lesson => lesson.id === draft.otherLessonId)
  const requests = view?.requests ?? [], shownRequests = selectExchangeRequests(requests, requestFilter, requestQuery, clock)
  const attentionCounts = requests.reduce((counts, request) => { const attention = exchangeAttention(request, clock); return { consent: counts.consent + Number(attention.consent), approval: counts.approval + Number(attention.approval), requested: counts.requested + Number(request.requesterIsViewer) } }, { consent: 0, approval: 0, requested: 0 })
  const requestPage = shownRequests.slice(0, requestLimit)
  const pinnedRequest = selectedRequest && !requestPage.some(request => request.id === selectedRequest.id) ? selectedRequest : undefined
  const openedPinned = opened && !requestPage.some(request => request.id === opened.id) && pinnedRequest?.id !== opened.id ? opened : undefined
  const displayedRequests = [openedPinned, pinnedRequest, ...requestPage].filter((request): request is ExchangeRequestView => Boolean(request))
  function changeRequestFilter(filter: ExchangeFilter) { setRequestFilter(filter); setRequestLimit(20) }
  function resetRequestFilters() { setRequestFilter('all'); setRequestQuery(''); setRequestLimit(20) }
  const requestDate = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: view?.timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  return <section className="timetable-exchanges timetable-workflow-ui" aria-labelledby={id + '-title'}><style>{styles}{inboxStyles}{reviewStyles}{workflowStyles}</style>
    <header><h2 id={id + '-title'}>수업 변경 요청</h2><p className="timetable-muted">변경안을 먼저 확인하고, 관련 교사의 동의와 담당자 승인 후 시간표에 반영합니다.</p><ol className="timetable-exchange-flow" aria-label="수업 변경 진행 순서"><li>후보 비교·내 동의와 요청</li><li>관련 교사 동의</li><li>담당자 승인</li><li>시간표 반영</li></ol></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status" className="timetable-notice">{notice}</p>}</div>
    {replaceSource && visible && <section className="ttops-pending" aria-label="기존 변경 요청 입력 보존"><p>작성 중인 요청이 있습니다. 시간표에서 선택한 수업으로 바꾸면 보내지 않은 입력을 비웁니다.</p><button type="button" disabled={unavailable} onClick={replaceSelectedSource}>기존 입력을 비우고 선택한 수업으로 시작</button><button type="button" className="secondary" disabled={unavailable} onClick={() => setReplaceSource(undefined)}>기존 입력 계속 작성</button></section>}
    {replaceProposal && visible && <section className="ttops-pending" aria-label="AI 제안과 기존 입력 확인"><p>작성 중인 입력을 보관했습니다. 확인한 AI 제안으로 바꾸려면 아래 버튼을 눌러 주세요.</p><p>{replaceProposal.reason}</p><button type="button" disabled={unavailable} onClick={() => adoptExternalProposal(replaceProposal)}>기존 입력 대신 확인한 AI 제안 채우기</button><button type="button" className="secondary" disabled={unavailable} onClick={() => setReplaceProposal(undefined)}>기존 입력 계속 작성</button></section>}
    {!visible ? <p role="status">{loading ? '현재 수업과 요청 권한을 확인하고 있습니다.' : '현재 권한과 수업을 확인할 때까지 보관한 변경 요청 입력을 숨깁니다.'}</p> : view && <>
      <section className="tt-exchange-overview" aria-label="변경 요청 빠른 이동">
        <div className="tt-workflow-title"><div><strong>내가 할 일부터 확인하세요</strong><p>조회 기간 안에서 내게 필요한 동의·승인과 보낸 요청을 모았습니다.</p></div><nav className="tt-workflow-jumps" aria-label="교환 요청 화면 이동"><button type="button" disabled={!view.canRequest || unavailable} onClick={() => jumpTo('compose')}>새 요청 작성</button><button type="button" className="secondary" onClick={() => jumpTo('requests')}>동의·승인 확인</button></nav></div>
        <div className="timetable-exchange-inbox-summary" role="group" aria-label="내가 확인할 변경 요청">
          {([{ filter: 'consent', title: '내 동의', count: attentionCounts.consent }, { filter: 'approval', title: '내 승인', count: attentionCounts.approval }, { filter: 'requested', title: '내 요청', count: attentionCounts.requested }] as const).map(item => <button key={item.filter} type="button" className="secondary" aria-pressed={requestFilter === item.filter} aria-label={`${item.title} ${item.count}건 보기`} onClick={() => { changeRequestFilter(item.filter); jumpTo('requests') }}><span>{item.title}</span><strong>{item.count}</strong></button>)}
        </div>
      </section>
      <section className="timetable-card" aria-labelledby={id + '-requests'}><div className="timetable-toolbar"><h3 ref={requestsHeading} tabIndex={-1} className="tt-workflow-focus" id={id + '-requests'}>관련 변경 요청</h3><button type="button" className="secondary" disabled={locked || busy} onClick={onReload}>요청 상태 새로 확인</button></div><p className="timetable-muted">현재 조회 기간 {view.from} ~ {timetableDateOffset(view.until, -1)}에 받은 요청입니다. 읽음 여부와 동의, 최종 반영은 각각 구분합니다.</p>
        {openedRequest && <div className="timetable-exchange-opened" ref={requestFeedback} tabIndex={-1} role="status" aria-label="선택한 변경 요청 안내">
          <p>{opened ? '알림에서 선택한 요청을 표시했습니다. 읽는 것만으로 동의하거나 승인하지 않습니다.' : '선택한 요청을 현재 조회 기간과 권한에서 찾지 못했습니다. 다른 요청을 대신 열지 않았습니다.'}</p>
          <p className="timetable-muted">요청 번호 <span>{openedRequest.requestId}</span>{!opened && ' · 조회 기간 또는 학교를 확인한 뒤 요청 상태를 다시 조회해 주세요.'}</p>
          <button type="button" className="secondary" disabled={busy || locked} onClick={() => setOpenedRequest(undefined)}>선택한 요청 표시 닫기</button>
        </div>}
        <div className="timetable-exchange-inbox-controls"><label>요청 상태로 보기<select aria-label="요청 상태로 보기" value={requestFilter} onChange={event => changeRequestFilter(event.target.value as ExchangeFilter)}>{Object.entries(exchangeFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>변경 요청 검색<input type="search" value={requestQuery} onChange={event => { setRequestQuery(event.target.value); setRequestLimit(20) }} placeholder="교사, 수업, 학급, 사유, 요청 번호" aria-label="변경 요청 검색" /></label></div>
        <div className="timetable-exchange-inbox-results"><p role="status">{exchangeFilters[requestFilter]} {shownRequests.length}건 · 전체 {requests.length}건{pinnedRequest ? ' · 확인 중인 요청 1건 별도 표시' : ''}{openedPinned ? ' · 선택한 요청 1건 별도 표시' : ''}</p>{(requestFilter !== 'all' || requestQuery) && <button type="button" className="secondary" onClick={resetRequestFilters}>검색·필터 초기화</button>}</div>
        {pinnedRequest && <p className="timetable-notice">확인 중인 요청은 검색·필터와 관계없이 함께 표시합니다. 응답 확인을 닫으면 원래 목록으로 돌아갑니다.</p>}
        {!shownRequests.length && <p className="timetable-exchange-empty">{!requests.length ? '현재 조회 기간에 확인할 변경 요청이 없습니다. 다른 기간의 요청은 조회 기간을 바꿔 확인해 주세요.' : requestQuery.trim() ? '검색 조건에 맞는 요청이 없습니다. 검색어를 줄이거나 검색·필터를 초기화해 주세요.' : requestFilter === 'consent' || requestFilter === 'approval' || requestFilter === 'mine' ? '지금 내가 응답할 요청이 없습니다. 이미 응답한 요청은 진행 중인 요청이나 전체 요청에서 확인할 수 있습니다.' : '선택한 상태의 요청이 없습니다. 전체 요청에서 다른 상태를 확인해 주세요.'}</p>}
        {displayedRequests.length > 0 && <div className="timetable-exchange-requests">{displayedRequests.map(request => <article key={request.id} ref={element => { if (element) requestCards.current.set(request.id, element); else requestCards.current.delete(request.id) }} tabIndex={-1} data-request-id={request.id} className={'timetable-exchange-request' + (pinnedRequest?.id === request.id || opened?.id === request.id ? ' timetable-exchange-pinned' : '')} aria-labelledby={id + '-request-' + request.id}>
          <div className="timetable-toolbar"><h4 id={id + '-request-' + request.id}>{request.requester.name} · {request.kind === 'swap' ? '수업 교환' : '수업 이동'}</h4><strong className="timetable-badge">{activeExchange(request) && Date.parse(request.expiresAt) <= clock ? '응답 기한 지남 · 상태 확인 필요' : statusText[request.state]}</strong></div><p className="timetable-exchange-reason">{request.reason}</p>
          <p className="timetable-muted">{request.changes.map(change => { const lesson = change.before ?? change.after; return `${lesson.label} · ${lesson.groupNames.join('·')}` }).join(' / ')}</p>
          <p className="timetable-exchange-request-meta"><span>요청 {requestDate(request.createdAt)}</span><span>응답 기한 {requestDate(request.expiresAt)}</span></p><p className="timetable-exchange-next">{exchangeNextStep(request, clock)}</p>
          <ol className="timetable-exchange-progress" aria-label="요청 처리 단계">{exchangeProgress(request, clock).map(step => <li key={step.label} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}><span>{step.label}</span><strong>{{ complete: '완료', current: '진행 중', waiting: '대기', stopped: '진행 안 함' }[step.state]}</strong></li>)}</ol>
          <p className="timetable-muted">동의 {exchangeConsentSummary(request).accepted}/{exchangeConsentSummary(request).total}명{exchangeConsentSummary(request).pending > 0 ? ` · 응답 대기 ${exchangeConsentSummary(request).pending}명` : ''}{exchangeConsentSummary(request).rejected > 0 ? ` · 동의하지 않음 ${exchangeConsentSummary(request).rejected}명` : ''}</p><details className="timetable-muted"><summary>요청 식별 정보</summary><p>요청 번호 {request.id}</p></details>
          <ExchangeRequestDetails request={request} timeZone={view.timeZone} selected={selected?.requestId === request.id || opened?.id === request.id} />
          {request.requesterIsViewer && request.state === 'awaiting_approval' && <p className="timetable-muted">본인이 요청한 변경은 다른 승인 담당자가 확인해야 합니다.</p>}
          <div className="timetable-actions">{visibleExchangeActions(request).map(action => <button type="button" key={action} className={action === 'approve' || action === 'accept' ? undefined : 'secondary'} disabled={unavailable || Date.parse(request.expiresAt) <= clock} onClick={() => chooseAction(request, action)}>{actionText[action]}</button>)}</div>
          {selected?.requestId === request.id && <section className="timetable-exchange-confirm" aria-label="변경 요청 응답 확인"><h5>{actionText[selected.action]}</h5><p>{selected.action === 'approve' ? '현재 수업판·모든 교사의 동의·자원 충돌을 서버가 다시 검사한 뒤 수업 전체를 함께 반영합니다.' : selected.action === 'accept' ? '지금 표시된 변경안에 동의합니다. 이 동의만으로 실제 시간표를 바꾸지 않습니다.' : selected.action === 'withdraw' ? '아직 반영되지 않은 요청을 철회합니다.' : '이 요청을 거절하며 실제 시간표는 바꾸지 않습니다.'}</p>
            {(!selectedCurrent || !responseBeforeExpiry) && <p role="status">요청의 판 또는 기한이 바뀌었습니다. 최신 요청을 다시 확인해 주세요.</p>}
            <label className="timetable-exchange-check"><input type="checkbox" checked={actionConfirmed} disabled={unavailable || !selectedCurrent || !responseBeforeExpiry} onChange={event => setActionConfirmed(event.target.checked)} />현재 수업과 변경 내용을 확인했습니다</label>
            <div className="timetable-actions"><button type="button" disabled={unavailable || !selectedCurrent || !responseBeforeExpiry || !actionConfirmed} onClick={() => void performAction()}>{selected.action === 'approve' ? '승인하고 시간표에 반영' : selected.action === 'accept' ? '확인한 변경에 동의' : selected.action === 'withdraw' ? '확인한 요청 철회' : '확인한 요청 반려'}</button><button type="button" className="secondary" disabled={locked || busy} onClick={() => { setSelected(undefined); setActionConfirmed(false) }}>응답 확인 닫기</button></div>
          </section>}
        </article>)}</div>}
        {shownRequests.length > requestLimit && <button type="button" className="secondary" onClick={() => setRequestLimit(value => value + 20)}>변경 요청 20건 더 보기 ({requestLimit}/{shownRequests.length})</button>}
      </section>
      <section className="timetable-card tt-exchange-compose" aria-labelledby={id + '-compose'}>
        <div className="tt-workflow-title"><div><span className="tt-workflow-kicker">수업 선택 → 변경 비교 → 요청</span><h3 ref={composeHeading} tabIndex={-1} className="tt-workflow-focus" id={id + '-compose'}>새 변경 요청</h3><p>바꿀 내 수업을 고르고 상대 수업이나 빈 시간을 확인하세요.</p></div></div>
        {!view.canRequest ? <p>현재 계정에는 새 수업 변경 요청 권한이 없습니다. 조회할 수 있는 요청은 아래에서 확인하세요.</p> : !myLessons.length ? <p>이 조회 기간에 변경을 요청할 수 있는 내 수업이 없습니다. 조회 기간이나 승인된 수업 배정을 확인해 주세요.</p> : <>
          <fieldset disabled={unavailable}><legend>바꿀 수업과 목적지 선택</legend>
            <div className="ttops-review-search"><label>내 수업 찾기<input type="search" aria-label="내 수업 찾기" value={sourceQuery} placeholder="수업·학급·날짜·식별 번호" onChange={event => setSourceQuery(event.target.value)} /></label>{draft.kind === 'swap' && <label>교환 상대 찾기<input type="search" aria-label="교환 상대 찾기" value={candidateQuery} placeholder="교사·학급·수업·날짜" disabled={!source} onChange={event => setCandidateQuery(event.target.value)} /></label>}</div>
            <div className="timetable-grid">
              <label>요청할 변경 종류<select aria-label="요청할 변경 종류" value={draft.kind} onChange={event => update({ kind: event.target.value as 'move' | 'swap', targetKey: '', otherLessonId: '' })}><option value="swap">다른 수업과 교환</option><option value="move">빈 시간으로 이동</option></select></label>
              <label>변경할 내 수업<select aria-label="변경할 내 수업" value={draft.lessonId} onChange={event => update({ lessonId: event.target.value, targetKey: '', otherLessonId: '' })}><option value="">내 수업을 선택해 주세요</option>{draft.lessonId && !myLessons.some(lesson => lesson.id === draft.lessonId) && <option value={draft.lessonId}>이전 선택 · 현재 수업 재확인 필요 [{draft.lessonId}]</option>}{sourceOptions.rows.map(lesson => <option key={lesson.id} value={lesson.id}>{lessonOption(lesson)}</option>)}</select></label>
              {draft.kind === 'swap' ? <label>교환할 상대 수업<select aria-label="교환할 상대 수업" value={draft.otherLessonId} onChange={event => update({ otherLessonId: event.target.value })}><option value="">상대 수업을 선택해 주세요</option>{draft.otherLessonId && !selectedCandidate && <option value={draft.otherLessonId}>이전 상대 · 현재 교환 가능 여부 재확인 [{draft.otherLessonId}]</option>}{candidateOptions.rows.map(lesson => <option key={lesson.id} value={lesson.id}>{lessonOption(lesson)}</option>)}</select></label> : <label>이동할 공식 시간<select aria-label="이동할 공식 시간" value={draft.targetKey} onChange={event => update({ targetKey: event.target.value })}><option value="">허용된 시간을 선택해 주세요</option>{source && moveTargets(source).map(target => <option key={timeKey(target)} value={timeKey(target)}>{formatTime(target, view.timeZone)}</option>)}</select></label>}
            </div>
            {(sourceQuery || candidateQuery && draft.kind === 'swap') && <p className="ttops-review-result" role="status">내 수업 검색 {sourceOptions.matches}건{draft.kind === 'swap' ? ` · 교환 후보 검색 ${candidateOptions.matches}건` : ''}{sourceOptions.pinned || draft.kind === 'swap' && candidateOptions.pinned ? ' · 검색 밖의 선택한 수업도 유지합니다.' : ''} 검색만으로 요청할 수업은 바뀌지 않습니다.</p>}
            {draft.kind === 'swap' && draft.otherLessonId && !selectedCandidate && <p role="status">선택했던 상대 수업의 현재 시간·판·허용 조건을 다시 확인해야 합니다. 사유와 기존 선택은 보관했습니다.</p>}
            {source && <div className="timetable-muted">현재 수업: <OperationLessonLabel lesson={source} timeZone={view.timeZone} /></div>}
            {draft.kind === 'move' && source && !moveTargets(source).length && <p>이 수업에 등록된 다른 허용 시간이 없습니다. 담당자에게 공식 일과를 확인해 주세요.</p>}
            {draft.kind === 'swap' && source && !candidates.length && <p>현재 기간에 시간이 맞는 교환 후보가 없습니다. 조회 기간이나 담당자가 정한 허용 시간을 확인해 주세요.</p>}
            <label>변경 요청 사유<textarea aria-label="변경 요청 사유" rows={3} maxLength={apiLimits.reason} value={draft.reason} onChange={event => update({ reason: event.target.value })} placeholder="관련 교사가 알아야 할 업무상 이유만 적어 주세요." /></label>
            <div className="timetable-actions"><button type="button" className="secondary" disabled={!extensions || !source || !draft.reason.trim() || unavailable} onClick={() => void recommend()}>가능한 교환안 추천받기</button></div>
            <ComposerOptions className="tt-workflow-help" summary="추천과 요청 사유 안내"><p className="timetable-muted">추천은 현재 수업과 조건을 서버에서 검사한 후보입니다. 추천만으로 요청을 보내거나 시간표를 바꾸지 않습니다.{!extensions && ' 추천 서버 연결은 준비 중입니다.'}</p>
            <p className="timetable-muted">개인 상담이나 자세한 부재 사유는 넣지 마세요. 현재 화면은 한 수업의 이동 또는 두 수업 간 교환을 지원합니다.</p></ComposerOptions>
            <div className="timetable-actions"><button type="button" disabled={!input || unavailable} onClick={() => void inspect()}>{busy ? '확인 중…' : '변경 전후 미리보기'}</button><button type="button" className="secondary" disabled={unavailable || !dirtyDraft(draft)} onClick={clearDraft}>보내지 않은 요청 입력 비우기</button></div>
          </fieldset>
          {draft.lessonId && !source && <p role="status" className="timetable-error">선택했던 수업이 최신 조회에 없습니다. 내 입력은 유지했으니 수업을 다시 선택해 주세요.</p>}
          {suggestions && <section className="timetable-exchange-preview" aria-label="검사된 교환 후보"><h4>교환 후보 비교</h4>{suggestions.explanations.map((explanation, index) => <p key={index}>{explanation}</p>)}{suggestions.status === 'search_limited' && <p role="status">탐색 한도 안에서 확인한 결과입니다. 다른 교환이 불가능하다는 뜻은 아닙니다.</p>}{!suggestions.candidates.length && <p role="status">검사한 범위에 추천할 후보가 없습니다. 조회 기간이나 공식 허용 시간을 확인하고 직접 상대 수업을 선택할 수 있습니다.</p>}{suggestions.candidates.map((candidate, index) => <article key={candidate.id}><h5>후보 {index + 1}</h5><p>{candidate.explanation}</p><OperationChangeList changes={candidate.preview.changes} timeZone={view.timeZone} /><p>동의 대상: {candidate.preview.participants.map(person => operationTeacherLabels(candidate.preview.participants).get(person.id)).join(' · ')}</p><button type="button" className="secondary" disabled={unavailable || Date.parse(candidate.preview.expiresAt) <= clock} onClick={() => selectRecommendation(candidate.input)}>후보 {index + 1} 선택</button></article>)}</section>}
        </>}
        {shownPreview && <section className="timetable-exchange-preview" aria-label="수업 변경 미리보기"><h4>변경 전후 확인</h4><OperationChangeList changes={shownPreview.changes} timeZone={view.timeZone} />
          <p><strong>동의가 필요한 교사:</strong> {shownPreview.participants.map(participant => operationTeacherLabels(shownPreview.participants).get(participant.id)).join(' · ')}</p>
          {shownPreview.blockers.length > 0 && <ul className="timetable-issues" aria-label="변경 요청을 막는 사유">{shownPreview.blockers.map((blocker, index) => <li key={blocker.code + index}>{blocker.message}</li>)}</ul>}
          {!previewCurrent && <p role="status" className="timetable-error">확인 기한이나 입력이 달라졌습니다. 변경 전후를 다시 확인해 주세요.</p>}
          <label className="timetable-exchange-check"><input type="checkbox" checked={confirmed} disabled={unavailable || !previewCurrent || shownPreview.blockers.length > 0} onChange={event => setConfirmed(event.target.checked)} />변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다</label>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}>내 동의와 변경 요청 보내기</button>
          <p className="timetable-muted">제출하면 내 동의도 같은 변경안에 기록됩니다. 다른 교사의 동의를 대신하지 않으며 실제 시간표는 담당자가 최종 승인할 때 바뀝니다.</p>
        </section>}
      </section>
    </>}
  </section>
}
