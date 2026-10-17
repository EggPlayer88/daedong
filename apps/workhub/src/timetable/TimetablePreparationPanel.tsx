import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { compilePreparation, initialPreparationDraft, preparationDraft, type PreparationDraft, type PreparationInput, type PreparationServer, type PreparationSource } from './preparation'
import { FoundationPanel } from './FoundationPanel'
import { PreparationEditingTools } from './PreparationEditingTools'
import { hasPreparationEditingInput, initialPreparationEditing, type PreparationEditingState } from './preparation-editing'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'

interface Session { sourceRevision: number; sourceFingerprint: string; termId: string; draftId: string | null; revision: number | null; draft: PreparationDraft; dirty: boolean }
interface SlotInput { day: string; label: string; start: string; end: string; periods: string }
interface PreparationRequest { key: string; command: { input: PreparationInput; source: PreparationSource } }
interface Props { server?: PreparationServer; member: Membership; disabled: boolean; onLockChange?: (locked: boolean) => void; onBasisConfirmed?: () => void }
const days = ['월', '화', '수', '목', '금', '토', '일']
const minute = (value: string) => /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const message = (error: unknown) => error instanceof ServiceError ? error.message : '학교 편성 자료를 확인하지 못했습니다. 현재 입력과 원래 요청은 유지됩니다.'
function sessionFor(source: PreparationSource, restart = false): Session {
  return { sourceRevision: source.sourceRevision, sourceFingerprint: restart ? source.sourceFingerprint : source.savedDraft?.sourceFingerprint ?? source.sourceFingerprint, termId: source.termId, draftId: source.savedDraft?.id ?? null, revision: source.savedDraft?.revision ?? null, draft: !restart && source.savedDraft ? structuredClone(source.savedDraft.draft) : initialPreparationDraft(source), dirty: restart }
}
export function TimetablePreparationPanel(props: Props) {
  const memory = useEditDraft<Session>(props.member, 'timetable-preparation'), recovery = usePendingRequest(props.member, 'timetablePreparation')
  const slotMemory = useEditDraft<SlotInput>(props.member, 'timetable-preparation-slot')
  const editingMemory = useEditDraft<PreparationEditingState>(props.member, 'timetable-preparation-editing')
  const [editing, setEditingValue] = useState<PreparationEditingState>(editingMemory.initial ?? initialPreparationEditing())
  const editingPending = hasPreparationEditingInput(editing)
  const setEditing = (next: PreparationEditingState) => { setEditingValue(next); editingMemory.save(hasPreparationEditingInput(next) ? next : undefined, hasPreparationEditingInput(next)) }
  const [session, setSession] = useState<Session | undefined>(memory.initial), [source, setSource] = useState<PreparationSource>()
  const [opened, setOpened] = useState(Boolean(memory.initial?.dirty || slotMemory.initial || editingMemory.initial || recovery.request)), [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmed, setConfirmed] = useState(false), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [newSlot, setNewSlotValue] = useState<SlotInput>(slotMemory.initial ?? { day: '1', label: '', start: '', end: '', periods: '1' })
  const setNewSlot = (next: SlotInput) => { setNewSlotValue(next); slotMemory.save(next.label || next.start || next.end ? next : undefined, Boolean(next.label || next.start || next.end)) }
  const [clearConfirmed, setClearConfirmed] = useState(false)
  const current = useRef(props), currentSession = useRef(session), life = useRef(0), operation = useRef(false)
  current.current = props; currentSession.current = session
  const pending = recovery.request, locked = busy || Boolean(pending), stale = Boolean(source && session && (source.sourceRevision !== session.sourceRevision || source.sourceFingerprint !== session.sourceFingerprint || source.termId !== session.termId))
  const slotPending = Boolean(newSlot.label || newSlot.start || newSlot.end), canEdit = Boolean(source?.canEdit && session && !stale && !locked && !props.disabled && !loading && !loadError)
  const reviewed = useMemo(() => source && session && !stale ? compilePreparation(source, session.draft) : undefined, [source, session, stale])
  const filtered = source?.courses.filter(course => [course.label, ...course.resourceIds.map(id => source.resources.find(row => row.id === id)?.label ?? '')].join(' ').normalize('NFKC').toLowerCase().replace(/\s/g, '').includes(query.normalize('NFKC').toLowerCase().replace(/\s/g, ''))) ?? []
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages - 1)
  const patch = (next: Session | undefined) => { setSession(next); currentSession.current = next; memory.save(next, Boolean(next?.dirty)); setConfirmed(false) }
  const updateDraft = (draft: PreparationDraft) => { if (session && canEdit) { patch({ ...session, draft, dirty: true }); setError(''); setNotice('') } }
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { props.onLockChange?.(locked || Boolean(session?.dirty) || slotPending || editingPending); return () => props.onLockChange?.(false) }, [locked, session?.dirty, slotPending, editingPending, props.onLockChange])
  useEffect(() => {
    if (!opened || !props.server || props.disabled) return
    let cancelled = false
    setLoading(true); setLoadError('')
    void props.server.get(props.member.id).then(next => { if (cancelled) return; setSource(next); if (!currentSession.current || !currentSession.current.dirty) patch(sessionFor(next)) }).catch(failure => { if (!cancelled) { setSource(undefined); setLoadError(message(failure)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [opened, props.server, props.member.id, props.disabled, reload])
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
      const latest = currentSession.current
      if (latest) patch({ ...latest, dirty: false, draftId: receipt.draftId, revision: receipt.draftRevision })
      setNotice(receipt.kind === 'confirm' ? '학교의 편성 기준판을 만들었습니다. 이제 조건 정리와 시간표 생성으로 이어갈 수 있습니다.' : '미완성 준비 자료를 학교 서버에 저장했습니다. 아직 편성 기준판으로 확정하지 않았습니다.')
      setReload(value => value + 1); if (receipt.kind === 'confirm') current.current.onBasisConfirmed?.()
    } catch (failure) {
      if (epoch !== life.current) return
      setError(message(failure))
      if (failure instanceof ServiceError && (retry ? failure.code === 'NOT_FOUND' : ['INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'NOT_FOUND', 'CONFLICT'].includes(failure.code))) recovery.remove(request.key)
    } finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function discard() { if (locked) return; patch(source ? sessionFor(source, stale) : undefined); setNewSlot({ day: '1', label: '', start: '', end: '', periods: '1' }); setEditing(initialPreparationEditing()); setClearConfirmed(false); setError(''); setNotice(stale ? '현재 공식 자료로 준비를 다시 시작했습니다. 이전 서버 초안은 새로 저장하기 전까지 유지됩니다.' : '저장하지 않은 준비 입력을 정리했습니다. 학교 서버 자료는 삭제하지 않았습니다.') }
  return <details className="timetable-card" open={opened} onToggle={event => { if (!locked) setOpened(event.currentTarget.open) }}><summary>학교 편성 자료 준비</summary>
    <p>학교 관리의 교사·학급·교과·수업 배정을 읽어, 시간표에 필요한 시수와 일과를 준비합니다. 공식 교사 배정과 학생 관계는 이 화면에서 바꾸지 않습니다.</p>
    {!props.server && <p>학교 준비 서버가 연결된 화면에서 사용할 수 있습니다. 편성 연습 자료로 실제 학교의 기준판을 만들지 않습니다.</p>}
    {loading && <p role="status">공식 학교 자료와 준비 초안을 확인하고 있습니다…</p>}{loadError && <p role="alert">{loadError} 시간표 준비 조회 기능의 설치·권한을 확인해 주세요.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={locked || props.disabled || !props.server} onClick={() => { setOpened(true); setReload(value => value + 1) }}>공식 자료 다시 확인</button>{pending && <button type="button" disabled={busy || !props.server} onClick={() => void send('save', true)}>원래 준비 요청 결과 확인</button>}</div>
    {pending && <p className="timetable-notice">준비 자료 저장 또는 기준판 생성 결과를 확인 중입니다. 같은 요청 번호로만 확인하며 새 명령을 만들지 않습니다.</p>}{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {stale && <p role="alert" className="timetable-error">공식 배정이나 학기 기준판이 바뀌었습니다. 작성한 입력을 보관했으며 이전 기준으로 저장·확정하지 않습니다.</p>}
    {source && session && !loading && !loadError && <><p><strong>{source.termLabel}</strong> · {source.firstDay} ~ {source.lastDay} · 공식 자료 {source.sourceRevision}판</p><p className="timetable-muted">학사 달력 날짜를 추정하지 않습니다. 위 학기와 담당 배정이 다르면 학교 관리에서 먼저 수정해 주세요.</p><fieldset disabled={!canEdit}>
      <label>준비 자료 이름<input value={session.draft.title} maxLength={120} onChange={event => updateDraft({ ...session.draft, title: event.target.value })} /></label>
      <details open><summary>요일별 일과·연속수업 시간대 · {session.draft.slots.length}개</summary><p className="timetable-muted">학년별 시각이 다르면 별도 시간대를 만드세요. 연속수업은 전체 실제 시작·종료 시각과 차시 수를 함께 입력합니다.</p><div className="timetable-grid"><label>요일<select aria-label="요일" value={newSlot.day} onChange={e => setNewSlot({ ...newSlot, day: e.target.value })}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label><label>교시 이름<input value={newSlot.label} maxLength={100} onChange={e => setNewSlot({ ...newSlot, label: e.target.value })} placeholder="예: 1학년 1교시" /></label><label>시작 시각<input type="time" value={newSlot.start} onChange={e => setNewSlot({ ...newSlot, start: e.target.value })} /></label><label>종료 시각<input type="time" value={newSlot.end} onChange={e => setNewSlot({ ...newSlot, end: e.target.value })} /></label><label>차시 수<input type="number" min="1" max={limits.maxPeriods} value={newSlot.periods} onChange={e => setNewSlot({ ...newSlot, periods: e.target.value })} /></label></div><div className="timetable-actions"><button type="button" onClick={addSlot}>시간대 추가</button>{slotPending && <button type="button" className="secondary" onClick={() => setNewSlot({ ...newSlot, label: '', start: '', end: '' })}>입력 중인 시간대 비우기</button>}</div><ul className="timetable-list">{session.draft.slots.map(slot => <li key={slot.id} className="timetable-list-row"><span>{days[slot.day - 1]} {slot.label} · {clock(slot.startMinute)}–{clock(slot.endMinute)} · {slot.periods}차시</span><button type="button" className="secondary" onClick={() => updateDraft({ ...session.draft, slots: session.draft.slots.filter(row => row.id !== slot.id), plans: session.draft.plans.map(plan => ({ ...plan, blocks: plan.blocks.map(block => ({ ...block, allowedSlotIds: block.allowedSlotIds.filter(id => id !== slot.id) })) })) })}>이 시간대 삭제</button></li>)}</ul></details>
      <PreparationEditingTools source={source} draft={session.draft} state={editing} disabled={!canEdit || slotPending} onStateChange={setEditing} onApply={updateDraft} />
      {editingPending && <p role="status" className="timetable-muted">편의 작업 입력을 반영하거나 비운 뒤 준비 초안을 저장할 수 있습니다.</p>}
      <label>준비할 수업 검색<input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="교과·교사·학급" /></label><p className="timetable-muted">{filtered.length}개 수업 · {currentPage + 1}/{pages}쪽</p>
      {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(course => { const plan = session.draft.plans.find(row => row.courseId === course.id); if (!plan) return <p key={course.id}>새 공식 수업입니다. 현재 기준으로 준비 자료를 다시 시작해 주세요.</p>; return <details key={course.id}><summary>{course.label} · {plan.blocks.reduce((sum, block) => sum + block.periods, 0)} / {plan.weeklyPeriods}차시</summary><p>{course.resourceIds.map(id => source.resources.find(row => row.id === id)?.label).join(' · ') || '공식 담당·수강 집단 확인 필요'}</p><label>주간 기준 시수<input type="number" min="0" max={limits.maxCoursePeriods} readOnly={course.requiredPeriods !== null} value={plan.weeklyPeriods} onChange={e => changePlan(course.id, old => ({ ...old, weeklyPeriods: Number(e.target.value) }))} /></label><p className="timetable-muted">{course.requiredPeriods !== null ? '학교가 확정한 기준 시수입니다. 이 화면에서 바꾸지 않습니다.' : '학교 자료에 없는 시수를 시간표 준비 초안으로 입력합니다. 기준판 생성 전에 확인해 주세요.'}</p><div className="timetable-actions"><button type="button" className="secondary" disabled={!plan.weeklyPeriods || plan.weeklyPeriods > limits.maxCoursePeriods} onClick={() => changePlan(course.id, old => ({ ...old, blocks: Array.from({ length: old.weeklyPeriods }, (_, index) => old.blocks[index]?.periods === 1 ? old.blocks[index] : { id: crypto.randomUUID(), periods: 1, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === 1).map(slot => slot.id) }) }))}>1차시 수업으로 구성</button><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: [...old.blocks, { id: crypto.randomUUID(), periods: 2, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === 2).map(slot => slot.id) }] }))}>2차시 연속수업 추가</button></div>{plan.blocks.map((block, index) => <section className="timetable-preparation-block" key={block.id}><strong>{index + 1}회 · {block.periods}차시</strong><label>이 수업의 허용 시간대<select multiple value={block.allowedSlotIds} aria-label={`${course.label} ${index + 1}회 허용 시간대`} onChange={e => { const ids = [...e.target.selectedOptions].map(option => option.value); changePlan(course.id, old => ({ ...old, blocks: old.blocks.map(row => row.id === block.id ? { ...row, allowedSlotIds: ids } : row) })) }}>{session.draft.slots.filter(slot => slot.periods === block.periods).map(slot => <option key={slot.id} value={slot.id}>{days[slot.day - 1]} {slot.label} · {clock(slot.startMinute)}–{clock(slot.endMinute)}</option>)}</select></label><div className="timetable-actions"><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: old.blocks.map(row => row.id === block.id ? { ...row, allowedSlotIds: session.draft.slots.filter(slot => slot.periods === row.periods).map(slot => slot.id) } : row) }))}>맞는 전체 시간대 적용</button><button type="button" className="secondary" onClick={() => changePlan(course.id, old => ({ ...old, blocks: old.blocks.filter(row => row.id !== block.id) }))}>이 수업 활동 삭제</button></div></section>)}</details> })}
      {pages > 1 && <nav className="timetable-actions" aria-label="준비 수업 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 준비 수업</button><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 준비 수업</button></nav>}
    </fieldset>{reviewed && (reviewed.basis ? <FoundationPanel basis={reviewed.basis} /> : <details><summary>기준판 생성 전에 확인할 항목 · {reviewed.issues.length}건</summary><ul className="timetable-issues">{reviewed.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></details>)}
    <div className="timetable-actions"><button type="button" disabled={!canEdit || !session.dirty || slotPending || editingPending} onClick={() => void send('save')}>준비 초안 서버에 저장</button></div><p className="timetable-muted">미완성 자료는 초안으로 저장할 수 있습니다. 기준판 생성은 학기 시간표 공개와 별개이며, 기존 공개 시간표를 바꾸지 않습니다.</p>
    <label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={!canEdit || !source.canConfirm || !reviewed?.basis || slotPending || editingPending} onChange={e => setConfirmed(e.target.checked)} />시수·교사 배정·학년별 시간대를 확인했으며 이 자료를 새 편성 기준판으로 만듭니다</label><button type="button" disabled={!canEdit || !source.canConfirm || !reviewed?.basis || !confirmed || slotPending || editingPending} onClick={() => void send('confirm')}>확인한 편성 기준판 만들기</button>
    </>}
    {(session?.dirty || slotPending || editingPending || stale) && !pending && <div className="timetable-actions">{!clearConfirmed ? <button type="button" className="secondary" disabled={busy} onClick={() => setClearConfirmed(true)}>준비 입력 정리</button> : <><p>저장하지 않은 준비 입력을 버리고 현재 공식 자료로 다시 시작합니다.</p><button type="button" className="secondary" disabled={busy} onClick={discard}>준비 입력 버리고 다시 시작</button><button type="button" className="secondary" onClick={() => setClearConfirmed(false)}>준비 입력 계속 보관</button></>}</div>}
  </details>
}
