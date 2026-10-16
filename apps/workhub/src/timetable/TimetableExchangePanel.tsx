import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/scoped-rpc'
import type { ExchangeInput, ExchangePreview, ExchangeRequestView, OperationCommand, OperationReceipt, OperationTime, OperationsView, RequestAction, RequestState, TimetableOperationsServer } from './operations-contracts'
import { OperationChangeList, OperationLessonLabel } from './OperationChangeList'
import styles from './timetable-exchanges.css?inline'
import apiLimits from './operations-api-limits.json'

export interface TimetableExchangePanelProps {
  server: TimetableOperationsServer; member: Membership; view: OperationsView | null; loading: boolean; locked: boolean
  onCommand: (command: OperationCommand) => Promise<OperationReceipt>; onDirtyChange: (dirty: boolean) => void
  onReload: () => void; revision?: number
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
// 같은 학교의 권한 범위가 바뀌어도 이전 입력을 새 소속 화면에 표시하지 않는다.
export function TimetableExchangePanel(props: TimetableExchangePanelProps) {
  return <ExchangePanelSession key={recoveryScope(props.member)} {...props} />
}
function ExchangePanelSession({ server, member, view, loading, locked, onCommand, onDirtyChange, onReload, revision = 0 }: TimetableExchangePanelProps) {
  const id = useId(), memory = useEditDraft<ExchangeDraft>(member, 'timetable-exchanges')
  const [draft, setDraft] = useState<ExchangeDraft>(() => memory.initial ?? emptyDraft())
  const [preview, setPreview] = useState<ExchangePreview>(), [confirmed, setConfirmed] = useState(false)
  const [selected, setSelected] = useState<SelectedAction>(), [actionConfirmed, setActionConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(Date.now)
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
  const hasTimedRequests = Boolean(view?.requests.some(request => request.actions.length > 0))
  const dirty = dirtyDraft(draft) || Boolean(selected) || busy

  useEffect(() => { life.current++; return () => { life.current++; sequence.current++; operation.current = false } }, [server])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { setPreview(undefined); setConfirmed(false); setSelected(undefined); setActionConfirmed(false); sequence.current++ }, [sourceKey, revision])
  useEffect(() => {
    if (!preview && !selected && !hasTimedRequests) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [preview, selected, hasTimedRequests])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  function update(patch: Partial<ExchangeDraft>) {
    if (unavailable) return
    const next = { ...draft, ...patch }; setDraft(next); memory.save(next, dirtyDraft(next))
    setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); sequence.current++
  }
  function clearDraft() {
    if (locked || busy) return
    setDraft(emptyDraft()); memory.remove(); setPreview(undefined); setConfirmed(false); setSelected(undefined); setActionConfirmed(false); setError(''); setNotice('보내지 않은 변경 요청 입력을 비웠습니다. 이미 보낸 요청은 그대로 남습니다.'); sequence.current++
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
  return <section className="timetable-exchanges" aria-labelledby={id + '-title'}><style>{styles}</style>
    <header><h2 id={id + '-title'}>수업 변경 요청</h2><p className="timetable-muted">변경안을 먼저 확인하고, 관련 교사의 동의와 담당자 승인 후 시간표에 반영합니다.</p></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status" className="timetable-notice">{notice}</p>}</div>
    {!visible ? <p role="status">{loading ? '현재 수업과 요청 권한을 확인하고 있습니다.' : '현재 권한과 수업을 확인할 때까지 보관한 변경 요청 입력을 숨깁니다.'}</p> : view && <>
      <section className="timetable-card" aria-labelledby={id + '-compose'}>
        <h3 id={id + '-compose'}>새 변경 요청</h3>
        {!view.canRequest ? <p>현재 계정에는 새 수업 변경 요청 권한이 없습니다. 조회할 수 있는 요청은 아래에서 확인하세요.</p> : !myLessons.length ? <p>이 조회 기간에 변경을 요청할 수 있는 내 수업이 없습니다. 조회 기간이나 승인된 수업 배정을 확인해 주세요.</p> : <>
          <fieldset disabled={unavailable}><legend className="timetable-exchanges-sr">바꿀 수업과 목적지 선택</legend>
            <div className="timetable-grid">
              <label>요청할 변경 종류<select aria-label="요청할 변경 종류" value={draft.kind} onChange={event => update({ kind: event.target.value as 'move' | 'swap', targetKey: '', otherLessonId: '' })}><option value="swap">다른 수업과 교환</option><option value="move">빈 시간으로 이동</option></select></label>
              <label>변경할 내 수업<select aria-label="변경할 내 수업" value={draft.lessonId} onChange={event => update({ lessonId: event.target.value, targetKey: '', otherLessonId: '' })}><option value="">내 수업을 선택해 주세요</option>{myLessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.label} · {formatTime(lesson.time, view.timeZone)}</option>)}</select></label>
              {draft.kind === 'swap' ? <label>교환할 상대 수업<select aria-label="교환할 상대 수업" value={draft.otherLessonId} onChange={event => update({ otherLessonId: event.target.value })}><option value="">상대 수업을 선택해 주세요</option>{swapCandidates(source, view).map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.label} · {lesson.teachers.map(teacher => teacher.name).join('·')} · {formatTime(lesson.time, view.timeZone)}</option>)}</select></label> : <label>이동할 공식 시간<select aria-label="이동할 공식 시간" value={draft.targetKey} onChange={event => update({ targetKey: event.target.value })}><option value="">허용된 시간을 선택해 주세요</option>{source && moveTargets(source).map(target => <option key={timeKey(target)} value={timeKey(target)}>{formatTime(target, view.timeZone)}</option>)}</select></label>}
            </div>
            {source && <div className="timetable-muted">현재 수업: <OperationLessonLabel lesson={source} timeZone={view.timeZone} /></div>}
            {draft.kind === 'move' && source && !moveTargets(source).length && <p>이 수업에 등록된 다른 허용 시간이 없습니다. 담당자에게 공식 일과를 확인해 주세요.</p>}
            {draft.kind === 'swap' && source && !swapCandidates(source, view).length && <p>현재 기간에 시간이 맞는 교환 후보가 없습니다. 조회 기간이나 담당자가 정한 허용 시간을 확인해 주세요.</p>}
            <label>변경 요청 사유<textarea aria-label="변경 요청 사유" rows={3} maxLength={apiLimits.reason} value={draft.reason} onChange={event => update({ reason: event.target.value })} placeholder="관련 교사가 알아야 할 업무상 이유만 적어 주세요." /></label>
            <p className="timetable-muted">개인 상담이나 자세한 부재 사유는 넣지 마세요. 현재 화면은 한 수업의 이동 또는 두 수업 간 교환을 지원합니다.</p>
            <div className="timetable-actions"><button type="button" disabled={!input || unavailable} onClick={() => void inspect()}>{busy ? '확인 중…' : '변경 전후 미리보기'}</button><button type="button" className="secondary" disabled={unavailable || !dirtyDraft(draft)} onClick={clearDraft}>보내지 않은 요청 입력 비우기</button></div>
          </fieldset>
          {draft.lessonId && !source && <p role="status" className="timetable-error">선택했던 수업이 최신 조회에 없습니다. 내 입력은 유지했으니 수업을 다시 선택해 주세요.</p>}
        </>}
        {shownPreview && <section className="timetable-exchange-preview" aria-label="수업 변경 미리보기"><h4>변경 전후 확인</h4><OperationChangeList changes={shownPreview.changes} timeZone={view.timeZone} />
          <p><strong>동의가 필요한 교사:</strong> {shownPreview.participants.map(participant => participant.name).join(' · ')}</p>
          {shownPreview.blockers.length > 0 && <ul className="timetable-issues" aria-label="변경 요청을 막는 사유">{shownPreview.blockers.map((blocker, index) => <li key={blocker.code + index}>{blocker.message}</li>)}</ul>}
          {!previewCurrent && <p role="status" className="timetable-error">확인 기한이나 입력이 달라졌습니다. 변경 전후를 다시 확인해 주세요.</p>}
          <label className="timetable-exchange-check"><input type="checkbox" checked={confirmed} disabled={unavailable || !previewCurrent || shownPreview.blockers.length > 0} onChange={event => setConfirmed(event.target.checked)} />변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다</label>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}>내 동의와 변경 요청 보내기</button>
          <p className="timetable-muted">제출하면 내 동의도 같은 변경안에 기록됩니다. 다른 교사의 동의를 대신하지 않으며 실제 시간표는 담당자가 최종 승인할 때 바뀝니다.</p>
        </section>}
      </section>
      <section className="timetable-card" aria-labelledby={id + '-requests'}><div className="timetable-toolbar"><h3 id={id + '-requests'}>관련 변경 요청</h3><button type="button" className="secondary" disabled={locked || busy} onClick={onReload}>요청 상태 새로 확인</button></div><p className="timetable-muted">읽음 여부를 동의로 처리하지 않습니다. 동의 완료와 시간표 반영 완료도 구분합니다.</p>
        {!view.requests.length ? <p>현재 조회할 수 있는 변경 요청이 없습니다.</p> : <div className="timetable-exchange-requests">{view.requests.map(request => <article key={request.id} className="timetable-exchange-request" aria-labelledby={id + '-request-' + request.id}>
          <div className="timetable-toolbar"><h4 id={id + '-request-' + request.id}>{request.requester.name} · {request.kind === 'swap' ? '수업 교환' : '수업 이동'}</h4><strong className="timetable-badge">{statusText[request.state]}</strong></div><p className="timetable-exchange-reason">{request.reason}</p><OperationChangeList changes={request.changes} timeZone={view.timeZone} />
          <ul className="timetable-exchange-consents" aria-label="교사별 동의 상태">{request.participants.map(participant => <li key={participant.id}><span>{participant.name}</span><strong>{participant.response === 'accepted' ? '동의함' : participant.response === 'rejected' ? '동의하지 않음' : '응답 대기'}</strong></li>)}</ul>
          {request.state === 'awaiting_approval' && <p className="timetable-muted">관련 교사의 동의를 모았습니다. 담당자가 승인하기 전까지 실제 시간표는 그대로입니다.</p>}
          {request.requesterIsViewer && request.state === 'awaiting_approval' && <p className="timetable-muted">본인이 요청한 변경은 다른 승인 담당자가 확인해야 합니다.</p>}
          <div className="timetable-actions">{request.actions.filter(action => !(action === 'approve' && request.requesterIsViewer)).map(action => <button type="button" key={action} className={action === 'approve' || action === 'accept' ? undefined : 'secondary'} disabled={unavailable || Date.parse(request.expiresAt) <= clock} onClick={() => chooseAction(request, action)}>{actionText[action]}</button>)}</div>
          {selected?.requestId === request.id && <section className="timetable-exchange-confirm" aria-label="변경 요청 응답 확인"><h5>{actionText[selected.action]}</h5><p>{selected.action === 'approve' ? '현재 수업판·모든 교사의 동의·자원 충돌을 서버가 다시 검사한 뒤 수업 전체를 함께 반영합니다.' : selected.action === 'accept' ? '지금 표시된 변경안에 동의합니다. 이 동의만으로 실제 시간표를 바꾸지 않습니다.' : selected.action === 'withdraw' ? '아직 반영되지 않은 요청을 철회합니다.' : '이 요청을 거절하며 실제 시간표는 바꾸지 않습니다.'}</p>
            {(!selectedCurrent || !responseBeforeExpiry) && <p role="status">요청의 판 또는 기한이 바뀌었습니다. 최신 요청을 다시 확인해 주세요.</p>}
            <label className="timetable-exchange-check"><input type="checkbox" checked={actionConfirmed} disabled={unavailable || !selectedCurrent || !responseBeforeExpiry} onChange={event => setActionConfirmed(event.target.checked)} />현재 수업과 변경 내용을 확인했습니다</label>
            <div className="timetable-actions"><button type="button" disabled={unavailable || !selectedCurrent || !responseBeforeExpiry || !actionConfirmed} onClick={() => void performAction()}>확인한 응답 보내기</button><button type="button" className="secondary" disabled={locked || busy} onClick={() => { setSelected(undefined); setActionConfirmed(false) }}>응답 확인 닫기</button></div>
          </section>}
        </article>)}</div>}
      </section>
    </>}
  </section>
}
