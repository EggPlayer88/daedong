import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { compilePreparation, initialPreparationDraft, preparationDraft, type PreparationDraft, type PreparationInput, type PreparationServer, type PreparationSource } from './preparation'
import { FoundationPanel } from './FoundationPanel'
import { adoptPreparationSource, reviewPreparationRefresh, retainPreparationSession, type PreparationSession } from './preparation-refresh'
import { TimetableSetupPanel } from './TimetableSetupPanel'
import { TimetablePreparationHoursPanel } from './TimetablePreparationHoursPanel'
import { PreparationProgressPanel } from './PreparationProgressPanel'
import type { SetupServer } from './setup'
import { PreparationEditingTools } from './PreparationEditingTools'
import { hasPreparationEditingInput, initialPreparationEditing, type PreparationEditingState } from './preparation-editing'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'

type Session = PreparationSession
interface SlotInput { day: string; label: string; start: string; end: string; periods: string }
interface PreparationRequest { key: string; command: { input: PreparationInput; source: PreparationSource } }
interface Props { server?: PreparationServer; setupServer?: SetupServer; onOpenSchoolAdmin?: () => void; member: Membership; expectedTermId?: string | null; refreshRevision?: number; disabled: boolean; onLockChange?: (locked: boolean) => void; onBasisConfirmed?: () => void }
const days = ['월', '화', '수', '목', '금', '토', '일']
const minute = (value: string) => /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const message = (error: unknown) => error instanceof ServiceError ? error.message : '학교 편성 자료를 확인하지 못했습니다. 현재 입력과 원래 요청은 유지됩니다.'
function sessionFor(source: PreparationSource, restart = false): Session {
  return { sourceRevision: source.sourceRevision, sourceFingerprint: restart ? source.sourceFingerprint : source.savedDraft?.sourceFingerprint ?? source.sourceFingerprint, termId: source.termId, draftId: source.savedDraft?.id ?? null, revision: source.savedDraft?.revision ?? null, draft: !restart && source.savedDraft ? structuredClone(source.savedDraft.draft) : initialPreparationDraft(source), dirty: restart, reviewedSource: restart || !source.savedDraft || source.savedDraft.sourceFingerprint === source.sourceFingerprint ? structuredClone(source) : undefined }
}
export function TimetablePreparationPanel(props: Props) {
  const memory = useEditDraft<Session>(props.member, 'timetable-preparation'), recovery = usePendingRequest(props.member, 'timetablePreparation')
  const setupRecovery = usePendingRequest(props.member, 'timetableSetup'), setupBatchRecovery = usePendingRequest(props.member, 'timetableSetupBatch')
  const setupMemory = useEditDraft<unknown>(props.member, 'timetable-setup'), setupBatchMemory = useEditDraft<unknown>(props.member, 'timetable-setup-batch')
  const hoursMemory = useEditDraft<unknown>(props.member, 'timetable-preparation-hours')
  const [hoursLocked, setHoursLocked] = useState(Boolean(hoursMemory.initial))
  const [setupLocked, setSetupLocked] = useState(false)
  const courseNodes = useRef(new Map<string, HTMLDetailsElement>())
  const [courseFocus, setCourseFocus] = useState<{ id: string; serial: number }>()
  const setupSaved = useCallback(() => { setOpened(true); setConfirmed(false); setReload(value => value + 1) }, [])
  const slotMemory = useEditDraft<SlotInput>(props.member, 'timetable-preparation-slot')
  const editingMemory = useEditDraft<PreparationEditingState>(props.member, 'timetable-preparation-editing')
  const [editing, setEditingValue] = useState<PreparationEditingState>(editingMemory.initial ?? initialPreparationEditing())
  const editingPending = hasPreparationEditingInput(editing)
  const setEditing = (next: PreparationEditingState) => { setEditingValue(next); editingMemory.save(hasPreparationEditingInput(next) ? next : undefined, hasPreparationEditingInput(next)) }
  const [session, setSession] = useState<Session | undefined>(memory.initial), [source, setSource] = useState<PreparationSource>()
  const [opened, setOpened] = useState(Boolean(hoursMemory.initial || memory.initial?.dirty || slotMemory.initial || editingMemory.initial || recovery.request || setupRecovery.request || setupMemory.initial || setupBatchRecovery.request || setupBatchMemory.initial)), [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmed, setConfirmed] = useState(false), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [newSlot, setNewSlotValue] = useState<SlotInput>(slotMemory.initial ?? { day: '1', label: '', start: '', end: '', periods: '1' })
  const setNewSlot = (next: SlotInput) => { setNewSlotValue(next); slotMemory.save(next.label || next.start || next.end ? next : undefined, Boolean(next.label || next.start || next.end)) }
  const [clearConfirmed, setClearConfirmed] = useState(false), [refreshConfirmed, setRefreshConfirmed] = useState(false)
  const current = useRef(props), currentSession = useRef(session), life = useRef(0), operation = useRef(false)
  current.current = props; currentSession.current = session
  const pending = recovery.request, locked = busy || Boolean(pending)
  const sourceStale = Boolean(source && session && (source.sourceRevision !== session.sourceRevision || source.sourceFingerprint !== session.sourceFingerprint || source.termId !== session.termId))
  const draftConflict = Boolean(source && session && (session.draftId !== (source.savedDraft?.id ?? null) || session.revision !== (source.savedDraft?.revision ?? null)))
  const termAligned = props.expectedTermId === undefined || source?.termId === props.expectedTermId
  const stale = sourceStale || draftConflict
  const slotPending = Boolean(newSlot.label || newSlot.start || newSlot.end), inputAvailable = Boolean(termAligned && source?.canEdit && session && !stale && !locked && !props.disabled && !loading && !loadError && !setupLocked && !setupRecovery.request)
  const canEdit = inputAvailable && !hoursLocked
  const refreshReview = useMemo(() => source && session && stale ? reviewPreparationRefresh(session, source) : undefined, [source, session, stale])
  const reviewed = useMemo(() => source && session && !stale ? compilePreparation(source, session.draft) : undefined, [source, session, stale])
  const filtered = useMemo(() => {
    if (!source) return []
    const exactId = source.courses.find(course => course.id === query.trim())
    if (exactId) return [exactId]
    const names = new Map(source.resources.map(row => [row.id, row.label])), term = query.normalize('NFKC').toLowerCase().replace(/\s/g, '')
    return source.courses.filter(course => [course.id, course.label, ...course.resourceIds.map(id => names.get(id) ?? '')].join(' ').normalize('NFKC').toLowerCase().replace(/\s/g, '').includes(term))
  }, [source, query])
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages - 1)
  const patch = (next: Session | undefined) => { setSession(next); currentSession.current = next; memory.save(next, Boolean(next?.dirty)); setConfirmed(false) }
  const updateDraft = (draft: PreparationDraft) => { if (session && canEdit) { patch({ ...session, draft, dirty: true }); setError(''); setNotice('') } }
  function applyHoursDraft(draft: PreparationDraft) {
    if (!session || !source || !inputAvailable || slotPending || editingPending) return
    patch({ ...session, draft: preparationDraft(draft, source), dirty: true }); setError(''); setNotice('엑셀에서 확인한 시수를 준비 초안에 반영했습니다. 수업 활동과 시간대는 그대로이며, 서버 저장은 아래에서 별도로 진행해 주세요.')
  }
  function selectCourse(courseId: string) { setQuery(courseId); setPage(0); setCourseFocus(previous => ({ id: courseId, serial: (previous?.serial ?? 0) + 1 })) }
  useEffect(() => {
    if (!courseFocus) return
    const node = courseNodes.current.get(courseFocus.id)
    if (node) { node.open = true; node.querySelector('summary')?.focus(); node.scrollIntoView({ block: 'nearest' }) }
  }, [courseFocus])
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { props.onLockChange?.(hoursLocked || locked || setupLocked || Boolean(setupRecovery.request) || Boolean(session?.dirty) || slotPending || editingPending); return () => props.onLockChange?.(false) }, [hoursLocked, locked, setupLocked, setupRecovery.request, session?.dirty, slotPending, editingPending, props.onLockChange])
  useEffect(() => {
    if (!opened || !props.server || props.disabled) return
    let cancelled = false
    setLoading(true); setLoadError(''); setRefreshConfirmed(false)
    void props.server.get(props.member.id).then(next => { if (cancelled) return; setSource(next); if ((!currentSession.current?.dirty && !slotPending && !editingPending && !hoursLocked && !pending && currentSession.current?.termId !== next.termId) || !retainPreparationSession(currentSession.current, next)) patch(sessionFor(next)) }).catch(failure => { if (!cancelled) { setSource(undefined); setLoadError(message(failure)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [opened, props.server, props.member.id, props.disabled, reload, props.expectedTermId, props.refreshRevision])
  function addSlot() {
    if (!session || !canEdit) return
    const slot = { id: crypto.randomUUID(), day: Number(newSlot.day), label: newSlot.label.trim(), startMinute: minute(newSlot.start), endMinute: minute(newSlot.end), periods: Number(newSlot.periods) }
    const draft = { ...session.draft, slots: [...session.draft.slots, slot] }
    try { preparationDraft(draft, source) } catch { setError('요일·교시 이름·시작/종료 시각·차시 수를 확인해 주세요.'); return }
    updateDraft(draft); setNewSlot({ ...newSlot, label: '', start: '', end: '' })
  }
  function changePlan(courseId: string, change: (plan: PreparationDraft['plans'][number]) => PreparationDraft['plans'][number]) {
    if (!session || !canEdit) return
    updateDraft({ ...session.draft, plans: session.draft.plans.map(plan => plan.courseId === courseId ? change(structuredClone(plan)) : plan) })
  }
  async function send(kind: 'save' | 'confirm', retry = false) {
    if (!props.server || operation.current) return
    let request: PreparationRequest
    if (retry) { if (!pending) return; request = pending as typeof request }
    else {
      if (!canEdit || !source || !session || slotPending || editingPending || kind === 'confirm' && (!source.canConfirm || !reviewed?.basis || !confirmed)) return
      request = { key: crypto.randomUUID(), command: { input: { kind, sourceRevision: source.sourceRevision, sourceFingerprint: source.sourceFingerprint, termId: source.termId, draftId: session.draftId, expectedDraftRevision: session.revision, draft: structuredClone(session.draft) }, source: structuredClone(source) } }
      try { preparationDraft(request.command.input.draft, source) } catch { setError('아직 입력 형식이 맞지 않는 항목이 있습니다. 현재 입력은 보관했습니다.'); return }
      recovery.put(request)
    }
    const epoch = life.current; operation.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (!request.command?.input || !request.command?.source) throw new ServiceError('INVALID_INPUT')
      const receipt = await (retry ? props.server.recover(props.member.id, request.command.input, request.key, request.command.source) : props.server.execute(props.member.id, request.command.input, request.key))
      if (epoch !== life.current) return
      recovery.remove(request.key)
      const original = request.command.input
      patch({ sourceRevision: original.sourceRevision, sourceFingerprint: original.sourceFingerprint, termId: original.termId, draft: structuredClone(original.draft), reviewedSource: structuredClone(request.command.source), dirty: false, draftId: receipt.draftId, revision: receipt.draftRevision })
      setNotice(receipt.kind === 'confirm' ? '학교의 편성 기준판을 만들었습니다. 이제 조건 정리와 시간표 생성으로 이어갈 수 있습니다.' : '미완성 준비 자료를 학교 서버에 저장했습니다. 아직 편성 기준판으로 확정하지 않았습니다.')
      setReload(value => value + 1); if (receipt.kind === 'confirm') current.current.onBasisConfirmed?.()
    } catch (failure) {
      if (epoch !== life.current) return
      setError(message(failure))
      if (failure instanceof ServiceError && failure.code === 'CONFLICT' && !retry) setReload(value => value + 1)
      if (failure instanceof ServiceError && (retry ? failure.code === 'NOT_FOUND' : ['INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'NOT_FOUND', 'CONFLICT'].includes(failure.code))) recovery.remove(request.key)
    } finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function discard() { if (hoursLocked || locked || setupLocked || setupRecovery.request) return; patch(source ? sessionFor(source, stale) : undefined); setNewSlot({ day: '1', label: '', start: '', end: '', periods: '1' }); setEditing(initialPreparationEditing()); setClearConfirmed(false); setError(''); setNotice(stale ? '현재 공식 자료로 준비를 다시 시작했습니다. 이전 서버 초안은 새로 저장하기 전까지 유지됩니다.' : '저장하지 않은 준비 입력을 정리했습니다. 학교 서버 자료는 삭제하지 않았습니다.') }
  return <details className="timetable-card" open={opened} onToggle={event => { if (!locked && !setupLocked && !hoursLocked) setOpened(event.currentTarget.open) }}><summary onClick={event => { if (locked || setupLocked || hoursLocked) event.preventDefault() }}>학교 편성 자료 준비</summary>
    <p>학교 관리의 교사·학급·교과·수업 배정을 읽어, 시간표에 필요한 시수와 일과를 준비합니다. 공식 교사 배정과 학생 관계는 이 화면에서 바꾸지 않습니다.</p>
    {!props.server && <p>학교 준비 서버가 연결된 화면에서 사용할 수 있습니다. 편성 연습 자료로 실제 학교의 기준판을 만들지 않습니다.</p>}
    {((opened || setupLocked) && props.setupServer || setupRecovery.request || setupBatchRecovery.request) && <TimetableSetupPanel server={props.setupServer} member={props.member} expectedTermId={props.expectedTermId} refreshRevision={props.refreshRevision} disabled={props.disabled || hoursLocked || locked || Boolean(session?.dirty) || slotPending || editingPending} onLockChange={setSetupLocked} onSaved={setupSaved} onOpenSchoolAdmin={props.onOpenSchoolAdmin} />}
    {(props.setupServer && (session?.dirty || slotPending || editingPending || hoursLocked)) && <p className="timetable-muted">공간·수업 연결을 바꾸려면 먼저 작성 중인 시수·일과를 초안으로 저장하거나 입력을 정리해 주세요.</p>}
    {setupLocked && <p role="status" className="timetable-muted">공간·수업 연결 작업을 마치면 시수·일과 준비를 이어갈 수 있습니다.</p>}
    {loading && <p role="status">공식 학교 자료와 준비 초안을 확인하고 있습니다…</p>}{loadError && <p role="alert">{loadError} 시간표 준비 조회 기능의 설치·권한을 확인해 주세요.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={locked || props.disabled || !props.server} onClick={() => { setOpened(true); setReload(value => value + 1) }}>공식 자료 다시 확인</button>{pending && <button type="button" disabled={busy || !props.server} onClick={() => void send('save', true)}>원래 준비 요청 결과 확인</button>}</div>
    {(opened || hoursLocked) && <TimetablePreparationHoursPanel member={props.member} source={termAligned && !loading && !loadError ? source : undefined} draft={session?.draft} disabled={!inputAvailable || slotPending || editingPending} onApply={applyHoursDraft} onLockChange={setHoursLocked} />}
    {hoursLocked && <p className="timetable-muted">엑셀 시수 비교를 반영하거나 닫으면 개별 시수·시간대 편집과 저장을 이어갈 수 있습니다.</p>}
    {pending && <p className="timetable-notice">준비 자료 저장 또는 기준판 생성 결과를 확인 중입니다. 같은 요청 번호로만 확인하며 새 명령을 만들지 않습니다.</p>}{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {sourceStale && <p role="alert" className="timetable-error">공식 배정이나 학기 기준판이 바뀌었습니다. 작성한 입력을 보관했으며 이전 기준으로 저장·확정하지 않습니다.</p>}
    {draftConflict && <p role="alert" className="timetable-error">서버의 준비 초안 판이 바뀌었습니다. 작성한 입력을 보관했으며 다른 사람의 초안을 덮어쓰지 않습니다.</p>}
    {termAligned && refreshReview && source && session && !loading && !loadError && <section className="timetable-card" aria-label="공식 자료 변경 확인"><h3>시수·일과를 보존하고 이어서 준비</h3><p>{refreshReview.reason}</p>{!refreshReview.previousKnown && <p>이전 공식 자료의 상세 내역이 없어 현재 연결 전체를 표시합니다.</p>}<details><summary>공식 자료 변경 내역 · {refreshReview.changes.length}건</summary>{refreshReview.changes.length ? <ul className="timetable-list">{refreshReview.changes.map((change, index) => <li key={index}><strong>{change.label}</strong><p>이전: {change.before}</p><p>현재: {change.after}</p></li>)}</ul> : <p>공식 항목의 표시값은 같습니다. 현재 학기·담당 관계와 서버 초안의 변경 안내를 확인해 주세요.</p>}</details>{refreshReview.allowed && <><label className="timetable-check"><input type="checkbox" checked={refreshConfirmed} disabled={hoursLocked || locked || setupLocked || props.disabled} onChange={event => setRefreshConfirmed(event.target.checked)} />변경된 공식 자료를 확인했고 기존 시수·일과를 이어서 사용합니다</label><button type="button" disabled={!refreshConfirmed || hoursLocked || locked || setupLocked || props.disabled} onClick={() => { try { patch(adoptPreparationSource(session, source)); setRefreshConfirmed(false); setNotice('시수·일과를 보존한 채 현재 공식 자료를 채택했습니다. 초안을 저장하고 편성 기준판을 다시 확인해 주세요.'); setError('') } catch { setError('공식 자료를 다시 확인해 주세요. 이전 입력은 보관했습니다.') } }}>입력 보존하고 현재 자료 채택</button></>}</section>}
    {termAligned && source && session && !loading && !loadError && <><p><strong>{source.termLabel}</strong> · {source.firstDay} ~ {source.lastDay} · 공식 자료 {source.sourceRevision}판</p><p className="timetable-muted">학사 달력 날짜를 추정하지 않습니다. 위 학기와 담당 배정이 다르면 학교 관리에서 먼저 수정해 주세요.</p><PreparationProgressPanel source={source} draft={session.draft} onSelectCourse={selectCourse} disabled={!canEdit} /><fieldset disabled={!canEdit}>
      <label>준비 자료 이름<input value={session.draft.title} maxLength={120} onChange={event => updateDraft({ ...session.draft, title: event.target.value })} /></label>
      <details open><summary>요일별 일과·연속수업 시간대 · {session.draft.slots.length}개</summary><p className="timetable-muted">학년별 시각이 다르면 별도 시간대를 만드세요. 연속수업은 전체 실제 시작·종료 시각과 차시 수를 함께 입력합니다.</p><div className="timetable-grid"><label>요일<select aria-label="요일" value={newSlot.day} onChange={e => setNewSlot({ ...newSlot, day: e.target.value })}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label><label>교시 이름<input value={newSlot.label} maxLength={100} onChange={e => setNewSlot({ ...newSlot, label: e.target.value })} placeholder="예: 1학년 1교시" /></label><label>시작 시각<input type="time" value={newSlot.start} onChange={e => setNewSlot({ ...newSlot, start: e.target.value })} /></label><label>종료 시각<input type="time" value={newSlot.end} onChange={e => setNewSlot({ ...newSlot, end: e.target.value })} /></label><label>차시 수<input type="number" min="1" max={limits.maxPeriods} value={newSlot.periods} onChange={e => setNewSlot({ ...newSlot, periods: e.target.value })} /></label></div><div className="timetable-actions"><button type="button" onClick={addSlot}>시간대 추가</button>{slotPending && <button type="button" className="secondary" onClick={() => setNewSlot({ ...newSlot, label: '', start: '', end: '' })}>입력 중인 시간대 비우기</button>}</div><ul className="timetable-list">{session.draft.slots.map(slot => <li key={slot.id} className="timetable-list-row"><span>{days[slot.day - 1]} {slot.label} · {clock(slot.startMinute)}–{clock(slot.endMinute)} · {slot.periods}차시</span><button type="button" className="secondary" onClick={() => updateDraft({ ...session.draft, slots: session.draft.slots.filter(row => row.id !== slot.id), plans: session.draft.plans.map(plan => ({ ...plan, blocks: plan.blocks.map(block => ({ ...block, allowedSlotIds: block.allowedSlotIds.filter(id => id !== slot.id) })) })) })}>이 시간대 삭제</button></li>)}</ul></details>
      <PreparationEditingTools source={source} draft={session.draft} state={editing} disabled={!canEdit || slotPending} onStateChange={setEditing} onApply={updateDraft} />
      {editingPending && <p role="status" className="timetable-muted">편의 작업 입력을 반영하거나 비운 뒤 준비 초안을 저장할 수 있습니다.</p>}
      <label>준비할 수업 검색<input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="교과·교사·학급·수업 ID" /></label><p className="timetable-muted">{filtered.length}개 수업 · {currentPage + 1}/{pages}쪽</p>
      {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(course => { const plan = session.draft.plans.find(row => row.courseId === course.id); if (!plan) return <p key={course.id}>새 공식 수업입니다. 현재 기준으로 준비 자료를 다시 시작해 주세요.</p>; return <details key={course.id} ref={node => { if (node) courseNodes.current.set(course.id, node); else courseNodes.current.delete(course.id) }} aria-label={`${course.label} [${course.id}] 준비 편집`}><summary>{course.label} · {plan.blocks.reduce((sum, block) => sum + block.periods, 0)} / {plan.weeklyPeriods}차시</summary><p className="timetable-muted">수업 ID: {course.id}</p><p>{course.resourceIds.map(id => source.resources.find(row => row.id === id)?.label).join(' · ') || '공식 담당·수강 집단 확인 필요'}</p><label>주간 기준 시수<input type="number" min="0" max={limits.maxCoursePeriods} readOnly={course.requiredPeriods !== null} value={plan.weeklyPeriods} onChange={e => changePlan(course.id, old => ({ ...old, weeklyPeriods: Number(e.target.value) }))} /></label><p className="timetable-muted">{course.requiredPeriods !== null ? '학교가 확정한 기준 시수입니다. 이 화면에서 바꾸지 않습니다.' : '학교 자료에 없는 시수를 시간표 준비 초안으로 입력합니다. 기준판 생성 전에 확인해 주세요.'}</p><div className="timetable-actions"><button type="button" className="secondary" disabled={!plan.weeklyPeriods || plan.weeklyPeriods > limits.maxCoursePeriods} onClick={() => changePlan(course.id, old => ({ ...old, blocks: Array.from({ length: old.weeklyPeriods }, (_, index) => old.blocks[index]?.periods === 1 ? old.blocks[index] : { id: crypto.randomUUID(), periods: 1, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === 1).map(slot => slot.id) }) }))}>1차시 수업으로 구성</button><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: [...old.blocks, { id: crypto.randomUUID(), periods: 2, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === 2).map(slot => slot.id) }] }))}>2차시 연속수업 추가</button></div>{plan.blocks.map((block, index) => <section className="timetable-preparation-block" key={block.id}><strong>{index + 1}회 · {block.periods}차시</strong><label>이 수업의 허용 시간대<select multiple value={block.allowedSlotIds} aria-label={`${course.label} ${index + 1}회 허용 시간대`} onChange={e => { const ids = [...e.target.selectedOptions].map(option => option.value); changePlan(course.id, old => ({ ...old, blocks: old.blocks.map(row => row.id === block.id ? { ...row, allowedSlotIds: ids } : row) })) }}>{session.draft.slots.filter(slot => slot.periods === block.periods).map(slot => <option key={slot.id} value={slot.id}>{days[slot.day - 1]} {slot.label} · {clock(slot.startMinute)}–{clock(slot.endMinute)}</option>)}</select></label><div className="timetable-actions"><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: old.blocks.map(row => row.id === block.id ? { ...row, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === row.periods).map(slot => slot.id) } : row) }))}>맞는 전체 시간대 적용</button><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: old.blocks.filter(row => row.id !== block.id) }))}>이 수업 활동 삭제</button></div></section>)}</details> })}
      {pages > 1 && <nav className="timetable-actions" aria-label="준비 수업 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 준비 수업</button><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 준비 수업</button></nav>}
    </fieldset>{reviewed && (reviewed.basis ? <FoundationPanel basis={reviewed.basis} /> : <details><summary>기준판 생성 전에 확인할 항목 · {reviewed.issues.length}건</summary><ul className="timetable-issues">{reviewed.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></details>)}
    <div className="timetable-actions"><button type="button" disabled={!canEdit || !session.dirty || slotPending || editingPending} onClick={() => void send('save')}>준비 초안 서버에 저장</button></div><p className="timetable-muted">미완성 자료는 초안으로 저장할 수 있습니다. 기준판 생성은 학기 시간표 공개와 별개이며, 기존 공개 시간표를 바꾸지 않습니다.</p>
    <label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={!canEdit || !source.canConfirm || !reviewed?.basis || slotPending || editingPending} onChange={e => setConfirmed(e.target.checked)} />시수·교사 배정·학년별 시간대를 확인했으며 이 자료를 새 편성 기준판으로 만듭니다</label><button type="button" disabled={!canEdit || !source.canConfirm || !reviewed?.basis || !confirmed || slotPending || editingPending} onClick={() => void send('confirm')}>확인한 편성 기준판 만들기</button>
    </>}
    {(session?.dirty || slotPending || editingPending || stale) && !pending && <div className="timetable-actions">{!clearConfirmed ? <button type="button" className="secondary" disabled={busy || setupLocked || hoursLocked} onClick={() => setClearConfirmed(true)}>준비 입력 정리</button> : <><p>저장하지 않은 준비 입력을 버리고 현재 공식 자료로 다시 시작합니다.</p><button type="button" className="secondary" disabled={busy || setupLocked || hoursLocked} onClick={discard}>준비 입력 버리고 다시 시작</button><button type="button" className="secondary" onClick={() => setClearConfirmed(false)}>준비 입력 계속 보관</button></>}</div>}
  </details>
}
