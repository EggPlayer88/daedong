import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../../contracts'
import type { SupabaseConnection } from '../../connection/supabase-connection'
import { getPilotFixture } from './fixture'
import { createPilotState, recommendPilotSwaps, pilotInbox, PILOT_MANAGER_IDS, type PilotState, type PilotCommand, type PilotEnvelope, type PilotProposalKind } from './operations'
import { createPilotStore, PILOT_BACKUP_MAX_BYTES, type PilotStore } from './persistence'
import { PilotReplacementPanel } from './PilotReplacementPanel'
import styles from './pilot.css?inline'

const kinds = { swap: '수업 교환', move: '수업 이동', substitute: '대강', cancel: '휴강', makeup: '보강' }
const states = { awaiting_consent: '교사 동의 중', awaiting_approval: '담당자 승인 대기', approved: '반영 완료', rejected: '반려', withdrawn: '철회' }
const errorText = (error: unknown) => error instanceof Error ? error.message : '처리하지 못했습니다. 입력을 다시 확인해 주세요.'
export function downloadPilotText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const href = URL.createObjectURL(new Blob([type.startsWith('text/csv') && !text.startsWith('\ufeff') ? '\ufeff' : '', text], { type }))
  const link = document.createElement('a'); link.href = href; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}
export interface PilotPanelProps {
  scope: string; member?: Membership; connection?: SupabaseConnection
  onNavigationLockChange?: (locked: boolean) => void
}
/** 가상 교사의 동의는 로컬 연습 기록에만 남긴다. 운영 RPC로 보낼 수 없다. */
export function TimetablePilotPanel({ scope, member, connection, onNavigationLockChange }: PilotPanelProps) {
  return <PilotScope key={scope} scope={scope} member={member} connection={connection} onNavigationLockChange={onNavigationLockChange} />
}
function PilotScope({ scope, member, connection, onNavigationLockChange }: PilotPanelProps) {
  const fixture = useMemo(getPilotFixture, [])
  const [state, setState] = useState<PilotState>(() => createPilotState(fixture))
  const [tab, setTab] = useState<'day' | 'requests' | 'school' | 'replace' | 'history'>('day')
  const [date, setDate] = useState(fixture.defaultDate), [classId, setClassId] = useState(fixture.classes[0].id)
  const [actorId, setActorId] = useState(fixture.teachers[0].id), [selectedId, setSelectedId] = useState('')
  const [kind, setKind] = useState<PilotProposalKind>('swap'), [partnerId, setPartnerId] = useState('')
  const [targetDate, setTargetDate] = useState(fixture.defaultDate), [targetPeriod, setTargetPeriod] = useState(7), [substituteId, setSubstituteId] = useState('')
  const [reason, setReason] = useState(''), [record, setRecord] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [showNotifications, setShowNotifications] = useState(false)
  const [storeReady, setStoreReady] = useState(false), [storeAttempt, setStoreAttempt] = useState(0)
  const [replacementDirty, setReplacementDirty] = useState(false)
  const [rejections, setRejections] = useState<Record<string, string>>({})
  const [schoolEdited, setSchoolEdited] = useState(false)
  const [schoolClasses, setSchoolClasses] = useState<string[]>(fixture.classes.map(row => row.id)), [schoolReason, setSchoolReason] = useState('')
  const [daySlots, setDaySlots] = useState(fixture.daySlots), [schoolAction, setSchoolAction] = useState<'close' | 'open' | 'special'>('close')
  const live = useRef(state), running = useRef(false), generation = useRef(0)
  const store = useRef<PilotStore>()
  const dirty = Boolean(reason || record || schoolReason || schoolEdited || replacementDirty || Object.values(rejections).some(Boolean))
  const selected = state.lessons.find(row => row.id === selectedId)
  const manager = PILOT_MANAGER_IDS.some(id => id === actorId)
  const teacherName = (id: string) => fixture.teachers.find(row => row.id === id)?.label ?? (id === 'pilot-manager-1' ? '시간표 담당자 A' : id === 'pilot-manager-2' ? '승인 담당자 B' : id)
  const className = (ids: string[]) => ids.map(id => fixture.classes.find(row => row.id === id)?.label ?? id).join(', ')
  const lessons = state.lessons.filter(row => row.date === date && (!classId || row.classIds.includes(classId))).sort((a, b) => a.period - b.period || a.id.localeCompare(b.id))
  const inbox = pilotInbox(state, actorId)
  const recommendations = useMemo(() => selected ? recommendPilotSwaps(state, selected.id) : [], [state, selected])
  useEffect(() => { live.current = state }, [state])
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => {
    let active = true, owned: PilotStore | undefined
    setStoreReady(false)
    void createPilotStore({ fixture, scope, isCurrentScope: () => active }).then(value => {
      owned = value
      if (!active) { value.dispose(); return }
      store.current = value; const next = value.snapshot(); live.current = next; setState(next); setStoreReady(true); setError('')
    }).catch(e => { if (active) setError(errorText(e)) })
    return () => { active = false; owned?.dispose(); store.current = undefined }
  }, [scope, fixture, storeAttempt])
  useEffect(() => { onNavigationLockChange?.(busy || dirty); return () => onNavigationLockChange?.(false) }, [busy, dirty, onNavigationLockChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function execute(command: PilotCommand): Promise<boolean> {
    if (running.current || !store.current || !storeReady) return false
    running.current = true; setBusy(true); setError(''); setNotice('')
    const turn = generation.current
    const envelope: PilotEnvelope = { requestId: crypto.randomUUID(), actorId, expectedRevision: live.current.revision, command }
    try {
      const result = await store.current.transact(envelope)
      if (turn !== generation.current) return false
      live.current = result.state; setState(result.state); setNotice('운영 연습에 반영했습니다. 실제 학교 자료는 변경하지 않았습니다.')
      if (command.type === 'propose') { setReason(''); setPartnerId(''); setTab('requests') }
      if (command.type === 'record') setRecord('')
      if (command.type === 'school_day' || command.type === 'special_day') { setSchoolReason(''); setSchoolEdited(false) }
      if (command.type === 'reject') setRejections(current => ({ ...current, [command.proposalId]: '' }))
      return true
    } catch (e) { if (turn === generation.current) setError(errorText(e)); return false }
    finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  function propose() {
    if (!selected) return
    const command: PilotCommand = { type: 'propose', kind, lessonIds: kind === 'swap' ? [selected.id, partnerId] : [selected.id], reason }
    if (kind === 'move' || kind === 'makeup') { command.targetDate = targetDate; command.targetPeriod = targetPeriod }
    if (kind === 'substitute') command.substituteTeacherId = substituteId
    void execute(command)
  }
  function pick(id: string) { setSelectedId(id); setPartnerId(''); setError(''); setNotice('') }
  function exportDay() {
    const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`
    const rows = [['구분', '날짜', '교시', '시작', '종료', '학급', '교과', '가상 담당', '상태'], ...lessons.map(row => ['운영 연습', row.date, String(row.period), row.startTime, row.endTime, className(row.classIds), row.subject, teacherName(row.teacherId), row.status === 'cancelled' ? '취소' : row.status === 'performed' ? '실시' : '예정'])]
    downloadPilotText(`운영연습_${date}.csv`, rows.map(row => row.map(cell).join(',')).join('\r\n'))
  }
  const selectedRequests = state.proposals.filter(row => manager || row.requesterId === actorId || row.requiredTeacherIds.includes(actorId)).slice().reverse()
  async function backup() {
    try { if (store.current) downloadPilotText('시간표_운영연습_보관.json', await store.current.exportFile(), 'application/json') } catch (e) { setError(errorText(e)) }
  }
  async function restore(file: File | undefined) {
    if (!file || !store.current || running.current) return
    if (file.size > PILOT_BACKUP_MAX_BYTES) { setError('연습 파일은 24MB 이내여야 합니다.'); return }
    running.current = true; setBusy(true)
    const turn = generation.current, owner = store.current
    try {
      const next = await owner.restoreFile(await file.text())
      if (turn !== generation.current) return
      live.current = next; setState(next); setSelectedId(''); setNotice('현재 계정의 연습 기록을 복원했습니다.'); setError('')
    } catch (e) { if (turn === generation.current) setError(errorText(e)) }
    finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  async function reload() {
    if (!store.current || running.current || dirty) return
    const owner = store.current, turn = generation.current
    running.current = true; setBusy(true)
    try {
      const next = await owner.reload()
      if (turn !== generation.current) return
      live.current = next; setState(next); setError(''); setSelectedId('')
    } catch (e) { if (turn === generation.current) setError(errorText(e)) }
    finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  return <section className="timetable-pilot" aria-label="9학급 시간표 운영 연습">
    <style>{styles}</style>
    <div className="pilot-banner"><strong>운영 연습</strong> · 기존 1학기 시드 기반 · {fixture.classes.length}학급 / 가상 교사 {fixture.teachers.length}명<br />실제 학교의 시간표·교사 동의·알림과 분리됩니다. 수업 시각과 연습 날짜도 임시값입니다.</div>
    <header className="pilot-heading"><div><h2>오늘의 학교 운영</h2><p>확정된 시간표에서 변경 요청부터 수업 기록까지</p></div><button type="button" onClick={() => setShowNotifications(value => !value)} aria-expanded={showNotifications}>내 알림 {inbox.filter(row => !row.read).length}</button></header>
    <div className="pilot-toolbar">
      <label>연습 날짜<input type="date" min={fixture.dateRange.startsOn} max={fixture.dateRange.endsOn} value={date} disabled={busy || dirty} onChange={e => { setDate(e.target.value); setSelectedId('') }} /></label>
      <label className="pilot-role">지금 연습할 역할<select aria-label="지금 연습할 역할" value={actorId} disabled={busy || dirty} onChange={e => { setActorId(e.target.value); setError(''); setNotice('') }}>
        <optgroup label="가상 교사">{fixture.teachers.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</optgroup>
        <optgroup label="가상 승인 담당자"><option value="pilot-manager-1">시간표 담당자 A</option><option value="pilot-manager-2">승인 담당자 B</option></optgroup>
      </select></label>
    </div>
    <p className="pilot-hint">역할을 바꿔 각 교사의 수락과 담당자 승인을 진행합니다. 실제 계정에 권한을 부여하거나 다른 교사로 로그인하지 않습니다.</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}{notice && <p className="pilot-success" role="status">{notice}</p>}
    {!storeReady && <p role="status">이 계정의 연습 자료를 준비하고 있습니다. <button onClick={() => setStoreAttempt(value => value + 1)}>저장소 다시 확인</button></p>}
    <details className="pilot-storage"><summary>브라우저에 저장된 연습 기록 관리</summary><p className="pilot-hint">현재 학교·계정별로 이 브라우저에 저장합니다. 실제 가입 교사 연결 계획은 포함하지 않습니다.</p><div className="pilot-actions"><button disabled={busy || !storeReady} onClick={() => void backup()}>연습 기록 보관 파일</button><label>연습 기록 복원<input type="file" accept=".json,application/json" disabled={busy || dirty || !storeReady} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void restore(file) }} /></label><button disabled={busy || dirty || !storeReady} onClick={() => void reload()}>다른 탭 변경 읽기</button></div></details>
    {showNotifications && <section className="pilot-card" aria-label="연습 알림"><h3>내 알림</h3>{dirty && <p className="pilot-hint">작성 중인 내용을 저장하거나 입력 취소한 뒤 알림으로 이동할 수 있습니다.</p>}{inbox.length ? <ul className="pilot-requests">{inbox.slice(0, 30).map(row => <li key={row.id}><strong>{row.title}</strong><div className="pilot-actions"><button disabled={busy || dirty} onClick={() => { if (row.proposalId) setTab('requests'); else if (row.lessonIds[0]) { const lesson = state.lessons.find(x => x.id === row.lessonIds[0]); if (lesson) { setDate(lesson.date); setClassId(lesson.classIds[0]); pick(lesson.id); setTab('day') } } if (!row.read) void execute({ type: 'read_notification', id: row.id }) }}>{row.read ? '다시 열기' : '내용 확인'}</button></div></li>)}</ul> : <p>아직 알림이 없습니다.</p>}</section>}
    <nav className="pilot-tabs" aria-label="운영 연습 메뉴">{([['day', '일과·시간표'], ['requests', '요청·승인'], ['school', '학사 변경'], ['replace', '실제 자료로 교체'], ['history', '변경 이력']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} disabled={busy || dirty && tab !== value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab === 'day' && <>
      <div className="pilot-metrics"><div><strong>{lessons.filter(row => row.status === 'scheduled').length}</strong><span>예정 수업</span></div><div><strong>{state.proposals.filter(row => row.status === 'awaiting_consent').length}</strong><span>동의 대기</span></div><div><strong>{state.proposals.filter(row => row.status === 'awaiting_approval').length}</strong><span>승인 대기</span></div><div><strong>{lessons.filter(row => row.status === 'cancelled' && !state.lessons.some(x => x.originLessonId === row.id && x.status !== 'cancelled')).length}</strong><span>보강 검토</span></div></div>
      <div className="pilot-layout"><section className="pilot-card"><div className="pilot-heading"><label>학급<select aria-label="학급" value={classId} disabled={busy || dirty} onChange={e => { setClassId(e.target.value); setSelectedId('') }}>{fixture.classes.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><button onClick={exportDay}>일과 CSV 내려받기</button></div>
        <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>교시</th><th>수업·담당</th><th>상태</th></tr></thead><tbody>{lessons.map(row => <tr key={row.id} data-selected={selectedId === row.id}><td>{row.period}교시<small>{row.startTime}–{row.endTime}</small></td><td><button disabled={busy || dirty && selectedId !== row.id} onClick={() => pick(row.id)} aria-label={`${row.period}교시 ${row.subject} 선택`}><strong>{row.subject}</strong><small>{teacherName(row.teacherId)}</small></button>{row.originLessonId && <small>원수업에 연결된 보강</small>}</td><td><span className="pilot-label">{row.status === 'performed' ? '실시 완료' : row.status === 'cancelled' ? '취소·보강 검토' : row.version > 1 ? '변경됨' : '예정'}</span></td></tr>)}</tbody></table></div>
        {!lessons.length && <p>이 날짜에는 배정된 수업이 없습니다.</p>}
      </section><aside className="pilot-card"><h3>{selected ? `${selected.period}교시 ${selected.subject}` : '수업을 선택해 주세요'}</h3>{selected && <div className="pilot-form">
        <p className="pilot-hint">{className(selected.classIds)} · {teacherName(selected.teacherId)} · {selected.version}판</p>
        <label>처리할 일<select aria-label="처리할 일" value={kind} disabled={busy} onChange={e => { setKind(e.target.value as PilotProposalKind); setPartnerId(''); setError('') }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {kind === 'swap' && <><label>교환 후보<select aria-label="교환 후보" value={partnerId} onChange={e => setPartnerId(e.target.value)} disabled={busy}><option value="">검증된 후보 선택</option>{recommendations.map(row => <option key={row.lessonId} value={row.lessonId}>{row.date} {row.period}교시 · {row.subject} · {teacherName(row.teacherId)}</option>)}</select></label><p className="pilot-hint">{recommendations.length ? '교사·학급·공간 중복을 검사한 후보입니다. 제출과 승인 때 다시 검사합니다.' : '현재 조회 범위에 교환 가능한 후보가 없습니다. 이동 또는 다른 날짜를 확인해 주세요.'}</p></>}
        {(kind === 'move' || kind === 'makeup') && <><label>변경 날짜<input disabled={busy} type="date" value={targetDate} min={fixture.dateRange.startsOn} max={fixture.dateRange.endsOn} onChange={e => setTargetDate(e.target.value)} /></label><label>변경 교시<select disabled={busy} aria-label="변경 교시" value={targetPeriod} onChange={e => setTargetPeriod(Number(e.target.value))}>{fixture.daySlots.map(row => <option key={row.period} value={row.period}>{row.period}교시 · {row.startTime}</option>)}</select></label></>}
        {kind === 'substitute' && <label>대강 교사<select disabled={busy} aria-label="대강 교사" value={substituteId} onChange={e => setSubstituteId(e.target.value)}><option value="">교사 선택</option>{fixture.teachers.filter(row => row.id !== selected.teacherId).map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
        <label>요청 사유<textarea disabled={busy} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="연수, 출장 등 연습 사유" /></label>
        <div className="pilot-actions"><button disabled={busy || !reason.trim() || kind === 'swap' && !partnerId || kind === 'substitute' && !substituteId} onClick={propose}>변경 요청</button><button disabled={busy} onClick={() => { setReason(''); setRecord(''); setError('') }}>입력 취소</button></div>
        <details><summary>수업 실시 기록</summary><label>수업 기록<textarea disabled={busy} value={record} maxLength={2000} onChange={e => setRecord(e.target.value)} /></label><p className="pilot-hint">담당 교사 역할에서만 기록합니다.</p><button disabled={busy || selected.status !== 'scheduled' || actorId !== selected.teacherId} onClick={() => void execute({ type: 'record', lessonId: selected.id, expectedLessonVersion: selected.version, note: record })}>실시 기록 저장</button></details>
      </div>}</aside></div>
    </>}
    {tab === 'requests' && <section className="pilot-card"><h3>요청부터 반영까지</h3><p className="pilot-hint">요청 → 영향받는 교사 모두 수락 → 별도 담당자 승인 → 시간표·알림 반영</p>{!selectedRequests.length && <p>현재 역할의 요청이 없습니다. 수업을 선택해 변경을 요청하세요.</p>}<ul className="pilot-requests">{selectedRequests.map(row => <li key={row.id}><div className="pilot-heading"><strong>{kinds[row.kind]} · {states[row.status]}</strong><span className="pilot-label">{row.id.slice(-8)}</span></div><p>{row.reason}</p><ul>{row.edits.map(edit => <li key={edit.lessonId}>{edit.after.subject} · {className(edit.after.classIds)}<br />{edit.before ? `${edit.before.date} ${edit.before.period}교시 · ${teacherName(edit.before.teacherId)}` : '보강 신설'} → {edit.after.status === 'cancelled' ? '휴강' : `${edit.after.date} ${edit.after.period}교시 · ${teacherName(edit.after.teacherId)}`}</li>)}</ul><p>동의: {row.requiredTeacherIds.map(id => `${teacherName(id)} ${row.consents.find(c => c.teacherId === id)?.decision === 'accepted' ? '수락' : row.consents.find(c => c.teacherId === id)?.decision === 'rejected' ? '반려' : '대기'}`).join(' / ')}</p>
      <div className="pilot-actions">{row.status === 'awaiting_consent' && row.requiredTeacherIds.includes(actorId) && !row.consents.some(c => c.teacherId === actorId) && <><button disabled={busy} onClick={() => void execute({ type: 'consent', proposalId: row.id, decision: 'accepted' })}>이 변경 수락</button><button disabled={busy} onClick={() => void execute({ type: 'consent', proposalId: row.id, decision: 'rejected' })}>반려</button></>}{row.status === 'awaiting_approval' && manager && row.requesterId !== actorId && <button disabled={busy || Boolean(rejections[row.id])} onClick={() => void execute({ type: 'approve', proposalId: row.id })}>최종 승인·반영</button>}{['awaiting_consent', 'awaiting_approval'].includes(row.status) && row.requesterId === actorId && <button disabled={busy} onClick={() => void execute({ type: 'withdraw', proposalId: row.id })}>요청 철회</button>}</div>
      {manager && row.requesterId !== actorId && ['awaiting_consent', 'awaiting_approval'].includes(row.status) && <details><summary>담당자 반려</summary><label>반려 사유<textarea disabled={busy} maxLength={1000} value={rejections[row.id] ?? ''} onChange={e => setRejections(current => ({ ...current, [row.id]: e.target.value }))} /></label><div className="pilot-actions"><button disabled={busy || !rejections[row.id]?.trim()} onClick={() => void execute({ type: 'reject', proposalId: row.id, reason: rejections[row.id] })}>담당자 반려 확정</button><button disabled={busy} onClick={() => setRejections(current => ({ ...current, [row.id]: '' }))}>반려 입력 취소</button></div></details>}
    </li>)}</ul></section>}
    {tab === 'school' && <section className="pilot-card"><h3>학사 변경</h3>{!manager && <p className="pilot-hint">시간표 담당자 역할로 바꾸면 휴업·특별일과를 반영할 수 있습니다.</p>}<fieldset className="pilot-form" disabled={busy || !manager}><legend>{date} 일과</legend><label>변경 종류<select aria-label="변경 종류" value={schoolAction} onChange={e => { setSchoolAction(e.target.value as typeof schoolAction); setSchoolEdited(true) }}><option value="close">휴업</option><option value="open">휴업 취소</option><option value="special">특별일과</option></select></label><div>{fixture.classes.map(row => <label key={row.id} style={{ display: 'inline-flex', marginRight: 12, gap: 6 }}><input type="checkbox" checked={schoolClasses.includes(row.id)} onChange={e => { setSchoolClasses(e.target.checked ? [...schoolClasses, row.id] : schoolClasses.filter(id => id !== row.id)); setSchoolEdited(true) }} />{row.label}</label>)}</div>
      {schoolAction === 'special' && <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>교시</th><th>시작</th><th>종료</th></tr></thead><tbody>{daySlots.map((row, index) => <tr key={row.period}><td>{row.period}</td><td><input aria-label={`${row.period}교시 시작`} type="time" value={row.startTime} onChange={e => { setDaySlots(daySlots.map((slot, i) => i === index ? { ...slot, startTime: e.target.value } : slot)); setSchoolEdited(true) }} /></td><td><input aria-label={`${row.period}교시 종료`} type="time" value={row.endTime} onChange={e => { setDaySlots(daySlots.map((slot, i) => i === index ? { ...slot, endTime: e.target.value } : slot)); setSchoolEdited(true) }} /></td></tr>)}</tbody></table></div>}
      <label>학사 변경 사유<textarea value={schoolReason} maxLength={1000} onChange={e => setSchoolReason(e.target.value)} /></label><p className="pilot-hint">취소된 수업은 삭제하지 않고 보강 대상과 이력에 남깁니다. 일부 반만 쉬는 합반과 교사 시간 중복은 차단합니다.</p><div className="pilot-actions"><button disabled={!schoolClasses.length || !schoolReason.trim()} onClick={() => void execute(schoolAction === 'special' ? { type: 'special_day', date, classIds: schoolClasses, slots: daySlots, reason: schoolReason } : { type: 'school_day', date, classIds: schoolClasses, closed: schoolAction === 'close', reason: schoolReason })}>연습 일과에 반영</button><button onClick={() => { setSchoolReason(''); setSchoolEdited(false); setSchoolClasses(fixture.classes.map(row => row.id)); setDaySlots(fixture.daySlots); setSchoolAction('close') }}>입력 취소</button></div></fieldset></section>}
    <div hidden={tab !== 'replace'}><PilotReplacementPanel fixture={state.fixture} date={date} state={state} member={member} connection={connection} canApply={manager && storeReady && !busy} execute={execute} onNavigationLockChange={setReplacementDirty} /></div>
    {tab === 'history' && <section className="pilot-card"><h3>변경 이력 · {state.history.length}건</h3><p className="pilot-hint">아래 기록은 모두 가상 역할로 진행한 연습입니다. 실제 학교 승인 원장으로 사용하지 않습니다.</p><ol>{state.history.slice().reverse().slice(0, 100).map(row => <li key={row.revision}><strong>{row.revision}판 · {row.summary}</strong><p>{teacherName(row.actorId)} · 요청 {row.requestId.slice(-8)}</p></li>)}</ol></section>}
  </section>
}
