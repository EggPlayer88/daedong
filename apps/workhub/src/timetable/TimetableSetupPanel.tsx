import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { setupCommand, type SetupCommand, type SetupServer, type SetupSnapshot } from './setup'
import policy from './setup-policy.json'
import { TimetableSetupBatchPanel } from './TimetableSetupBatchPanel'
import { TimetableSetupChecklist } from './TimetableSetupChecklist'
import './timetable-setup.css'

type Space = SetupSnapshot['spaces'][number]
type Course = SetupSnapshot['courses'][number]
type CourseInput = { classIds: string[]; studentGroup: boolean; spaceIds: string[] }
type Edit = { termId: string; referenceDay: string } & (
  { kind: 'space'; original: Space | null; input: { kind: Space['kind']; label: string; capacity: string }; removing: boolean }
  | { kind: 'course'; original: Course; input: CourseInput })
interface Props { server?: SetupServer; member: Membership; expectedTermId?: string | null; refreshRevision?: number; disabled: boolean; onLockChange?: (locked: boolean) => void; onSaved?: () => void; onOpenSchoolAdmin?: () => void }
const PAGE_SIZE = 20
const display = (row: { label: string; id: string }) => `${row.label} [${row.id}]`
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '')
const capacityText = (value: number | null) => value === null ? '미입력' : `동시에 ${value}개 수업`
const courseInput = (course: Course): CourseInput => structuredClone(course.link ? { classIds: course.link.classIds, studentGroup: course.link.studentGroup, spaceIds: course.link.spaceIds } : { classIds: [], studentGroup: false, spaceIds: [] })
const message = (failure: unknown) => failure instanceof ServiceError ? failure.message : '처리 결과를 확인하지 못했습니다. 현재 입력과 원래 요청을 보관합니다.'
const missing = (ids: readonly string[], rows: readonly { id: string }[]) => ids.filter(id => !rows.some(row => row.id === id))
const toggle = (ids: readonly string[], id: string, checked: boolean) => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)

function commandFor(edit: Edit): SetupCommand {
  if (edit.kind === 'course') return setupCommand({ kind: 'course_link', courseId: edit.original.id, expectedVersion: edit.original.link?.version ?? null, input: edit.input })
  if (edit.removing) return setupCommand({ kind: 'space_remove', spaceId: edit.original?.id, expectedVersion: edit.original?.version })
  const capacity = edit.input.capacity.trim()
  if (capacity && !/^[0-9]+$/.test(capacity)) throw new ServiceError('INVALID_INPUT')
  return setupCommand({ kind: 'space_save', spaceId: edit.original?.id ?? null, expectedVersion: edit.original?.version ?? null, input: { kind: edit.input.kind, label: edit.input.label.trim(), capacity: capacity ? Number(capacity) : null } })
}
function isStale(edit: Edit, snapshot: SetupSnapshot): boolean {
  if (edit.termId !== snapshot.termId || edit.referenceDay !== snapshot.referenceDay) return true
  if (edit.kind === 'space') return Boolean(edit.original && canonical(snapshot.spaces.find(row => row.id === edit.original?.id)) !== canonical(edit.original))
  return canonical(snapshot.courses.find(row => row.id === edit.original.id)) !== canonical(edit.original)
}
function fields(edit: Edit, snapshot: SetupSnapshot, kind: 'original' | 'mine' | 'latest'): string[] {
  if (edit.kind === 'space') {
    const row = kind === 'latest' ? snapshot.spaces.find(row => row.id === edit.original?.id) : edit.original
    if (kind !== 'mine' && !row) return [kind === 'original' && !edit.original ? '새 공간' : '현재 목록에 없음', '—', '—']
    if (kind === 'mine' && edit.removing) return ['공간 삭제', '삭제', '삭제']
    const value = kind === 'mine' ? edit.input : row!
    return [value.kind === 'room' ? '교실·특별실' : '공유 장비', value.label || '미입력', typeof value.capacity === 'string' ? value.capacity.trim() ? `동시에 ${value.capacity}개 수업` : '미입력' : capacityText(value.capacity)]
  }
  const row = kind === 'latest' ? snapshot.courses.find(row => row.id === edit.original.id) : edit.original
  if (kind !== 'mine' && !row) return ['현재 목록에 없음', '—', '—', '—', '—']
  const value = kind === 'mine' ? edit.input : courseInput(row!)
  const names = (ids: string[], rows: { id: string; label: string }[]) => ids.length ? ids.map(id => { const item = rows.find(item => item.id === id); return item ? display(item) : `현재 목록에 없음 [${id}]` }).join(' · ') : '없음'
  return [row?.inTimetable === false ? '편성 제외' : '편성 대상', row?.teacherLabels.join(' · ') || '담당 교사 없음', String(row?.studentCount ?? edit.original.studentCount) + '명', value.studentGroup ? '이 수업의 별도 수강집단' : names(value.classIds, snapshot.classes), names(value.spaceIds, snapshot.spaces)]
}

export function TimetableSetupPanel(props: Props) {
  const scope = recoveryScope(props.member), memory = useEditDraft<Edit>(props.member, 'timetable-setup'), recovery = usePendingRequest(props.member, 'timetableSetup')
  const batchMemory = useEditDraft<unknown>(props.member, 'timetable-setup-batch'), batchRecovery = usePendingRequest(props.member, 'timetableSetupBatch')
  const [batchLocked, setBatchLocked] = useState(Boolean(batchMemory.initial || batchRecovery.request)), [batchBusy, setBatchBusy] = useState(false)
  const batchChanged = useCallback(() => { setReload(value => value + 1); props.onSaved?.() }, [props.onSaved])
  const [edit, setEdit] = useState<Edit | undefined>(memory.initial), [opened, setOpened] = useState(Boolean(memory.initial || recovery.request || batchMemory.initial || batchRecovery.request))
  const [snapshot, setSnapshot] = useState<SetupSnapshot>(), [loadedScope, setLoadedScope] = useState(''), [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState(false), [confirmed, setConfirmed] = useState(false), [discarding, setDiscarding] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0), [spacePage, setSpacePage] = useState(0)
  const [classQuery, setClassQuery] = useState(''), [spaceQuery, setSpaceQuery] = useState('')
  const current = useRef({ props, scope }), life = useRef(0), operation = useRef(false), editorNode = useRef<HTMLElement>(null)
  current.current = { props, scope }
  const pending = recovery.request, locked = busy || Boolean(pending)
  const source = loadedScope === scope ? snapshot : undefined
  const visible = Boolean((props.expectedTermId === undefined || source?.termId === props.expectedTermId) && source && !loading && !loadError && !props.disabled)
  const stale = Boolean(edit && source && isStale(edit, source))
  const canEdit = visible && !locked && !batchLocked && Boolean(source?.canEdit)
  const patch = (next: Edit | undefined) => { setEdit(next); memory.save(next, Boolean(next)); setPreview(false); setConfirmed(false); setDiscarding(false); setError(''); setNotice('') }
  const editKey = edit ? edit.kind + ':' + (edit.original?.id ?? 'new') : ''
  useEffect(() => { if (editKey) editorNode.current?.focus() }, [editKey])
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { props.onLockChange?.(locked || Boolean(edit) || batchLocked || Boolean(batchRecovery.request)); return () => props.onLockChange?.(false) }, [locked, edit, batchLocked, batchRecovery.request, props.onLockChange])
  useEffect(() => {
    life.current++; operation.current = false; setBusy(false); setSnapshot(undefined); setLoadedScope(''); setEdit(memory.initial); setPreview(false); setConfirmed(false); setError(''); setNotice('')
  }, [scope, memory])
  useEffect(() => {
    if (!opened || !props.server || props.disabled) return
    let cancelled = false
    const token = scope
    setLoading(true); setLoadError(''); setPreview(false); setConfirmed(false)
    void props.server.get(props.member.id).then(value => {
      if (cancelled || current.current.scope !== token) return
      setSnapshot(value); setLoadedScope(token)
    }).catch(failure => {
      if (cancelled || current.current.scope !== token) return
      setSnapshot(undefined); setLoadedScope(''); setLoadError(message(failure))
    }).finally(() => { if (!cancelled && current.current.scope === token) setLoading(false) })
    return () => { cancelled = true }
  }, [opened, props.server, props.member.id, props.disabled, scope, reload, props.expectedTermId, props.refreshRevision])

  const filteredCourses = useMemo(() => source?.courses.filter(course => {
    const linked = Boolean(course.link?.studentGroup || course.link?.classIds.length)
    return (filter === 'all' || (filter === 'linked' ? linked : !linked)) && normalize([course.label, course.id, ...course.teacherLabels].join(' ')).includes(normalize(query))
  }) ?? [], [source, query, filter])
  const pages = Math.max(1, Math.ceil(filteredCourses.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1)
  const spacePages = Math.max(1, Math.ceil((source?.spaces.length ?? 0) / PAGE_SIZE)), currentSpacePage = Math.min(spacePage, spacePages - 1)
  const linkedCourses = edit?.kind === 'space' && edit.original && source ? source.courses.filter(row => row.link?.spaceIds.includes(edit.original!.id)) : []
  const missingClasses = edit?.kind === 'course' && source ? missing(edit.input.classIds, source.classes) : []
  const missingSpaces = edit?.kind === 'course' && source ? missing(edit.input.spaceIds, source.spaces) : []
  const missingTarget = Boolean(edit && source && (edit.kind === 'course' ? !source.courses.some(row => row.id === edit.original.id) : edit.original && !source.spaces.some(row => row.id === edit.original?.id)))
  function startSpace(space: Space | null) {
    if (!source || !canEdit || edit) return
    patch({ kind: 'space', termId: source.termId, referenceDay: source.referenceDay, original: space ? structuredClone(space) : null, input: { kind: space?.kind ?? 'room', label: space?.label ?? '', capacity: space?.capacity === null || !space ? '' : String(space.capacity) }, removing: false })
  }
  function startCourse(course: Course) {
    if (!source || !canEdit || edit) return
    patch({ kind: 'course', termId: source.termId, referenceDay: source.referenceDay, original: structuredClone(course), input: courseInput(course) }); setClassQuery(''); setSpaceQuery('')
  }
  function reconcile(keepInput: boolean) {
    if (!edit || !source || !canEdit || missingTarget || edit.termId !== source.termId) return
    if (edit.kind === 'space') {
      const latest = edit.original ? source.spaces.find(row => row.id === edit.original?.id)! : null
      patch({ ...edit, referenceDay: source.referenceDay, original: latest ? structuredClone(latest) : null, input: keepInput ? edit.input : { kind: latest?.kind ?? 'room', label: latest?.label ?? '', capacity: latest?.capacity === null || !latest ? '' : String(latest.capacity) } })
    } else {
      const latest = source.courses.find(row => row.id === edit.original.id)!
      patch({ ...edit, referenceDay: source.referenceDay, original: structuredClone(latest), input: keepInput ? edit.input : courseInput(latest) })
    }
  }
  function compare(removing = false) {
    if (!edit || !source || !canEdit || stale) return
    const candidate = edit.kind === 'space' ? { ...edit, removing } : edit
    try {
      if (removing && linkedCourses.length) throw new ServiceError('CONFLICT')
      setupCommand(commandFor(candidate), source)
      setEdit(candidate); memory.save(candidate, true); setPreview(true); setConfirmed(false); setError('')
    } catch (failure) { setError(failure instanceof ServiceError && failure.code === 'INVALID_INPUT' ? '이름·동시 수업 수·학급 및 공간 선택을 확인해 주세요. 현재 목록에서 빠진 연결은 직접 해제한 뒤 다시 선택해 주세요.' : message(failure)) }
  }
  async function send(retry = false) {
    const server = props.server
    if (!server || operation.current) return
    let request: { key: string; command: SetupCommand }
    if (retry) { if (!pending) return; request = pending as typeof request }
    else {
      if (!source || !edit || !canEdit || stale || !preview || !confirmed) return
      try { request = { key: crypto.randomUUID(), command: setupCommand(commandFor(edit), source) } }
      catch (failure) { setError(message(failure)); return }
      recovery.put(request)
    }
    const epoch = life.current, token = scope
    operation.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const receipt = await (retry ? server.recover(props.member.id, request.command, request.key) : server.execute(props.member.id, request.command, request.key))
      if (life.current !== epoch || current.current.scope !== token) return
      recovery.remove(request.key); patch(undefined)
      setNotice(receipt.kind === 'space_remove' ? '공간을 삭제했습니다. 기존 확정 시간표의 기록은 유지됩니다.' : '준비 입력을 저장했습니다. 시수·일과 준비에서 바뀐 학교 자료를 확인해 주세요.')
      setReload(value => value + 1); current.current.props.onSaved?.()
    } catch (failure) {
      if (life.current !== epoch || current.current.scope !== token) return
      setError(message(failure)); setConfirmed(false)
      if (failure instanceof ServiceError && (retry ? failure.code === 'NOT_FOUND' : ['INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'NOT_FOUND', 'CONFLICT'].includes(failure.code))) {
        recovery.remove(request.key); setPreview(false)
        if (retry) setNotice('원래 요청은 접수되지 않았습니다. 입력을 다시 확인한 뒤 새 요청으로 저장할 수 있습니다.')
        if (failure.code === 'CONFLICT') { setError('같은 이름의 공간, 다른 곳의 수정 또는 다른 학기의 연결 때문에 저장하지 못했습니다. 입력을 보관했으니 최신 자료와 비교해 주세요.'); setReload(value => value + 1) }
      }
    } finally { if (life.current === epoch && current.current.scope === token) { operation.current = false; setBusy(false) } }
  }
  const showComparison = Boolean(edit && source && visible && (preview || stale))
  const labels = edit?.kind === 'space' ? ['종류', '이름', '동시 수업 수'] : ['편성 여부', '담당 교사', '수강 인원', '학생 집단', '사용 공간']

  return <details className="timetable-setup" open={opened} onToggle={event => { if (!locked && !edit && !batchLocked) setOpened(event.currentTarget.open); else if (!event.currentTarget.open) event.currentTarget.open = true }}>
    <summary onClick={event => { if (locked || edit || batchLocked) event.preventDefault() }}>공간·수업 연결 관리</summary>
    <p>교실·특별실·장비와 수업의 학급을 연결합니다. 먼저 이 입력을 저장한 뒤, 주당 시수와 일과를 준비해 주세요.</p>
    {!props.server && <p className="timetable-notice">준비 입력 기능을 연결 중입니다. 학교 관리의 공식 교사·학급·수업 배정은 먼저 확인할 수 있습니다.</p>}
    {props.disabled && <p className="timetable-muted">다른 준비 입력을 저장하거나 정리한 뒤 공간·수업 연결을 편집할 수 있습니다.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={!props.server || busy || props.disabled || batchBusy || loading} onClick={() => { setOpened(true); setReload(value => value + 1) }}>준비 입력 자료 다시 확인</button>{props.onOpenSchoolAdmin && <button type="button" className="secondary" disabled={locked || Boolean(edit) || props.disabled || batchLocked} onClick={props.onOpenSchoolAdmin}>학교 관리 열기</button>}</div>
    {loading && <p role="status">학기와 공간·수업 연결을 확인하고 있습니다…</p>}
    {loadError && <p role="alert" className="timetable-error">{loadError} 이전 자료는 표시하지 않습니다. 작성 중인 입력은 현재 탭에 보관했습니다.</p>}
    {pending && <div className="timetable-notice"><p>저장 결과를 아직 확인하지 못했습니다. 입력과 원래 요청 번호를 보관하고 있으며, 새 저장이나 입력 폐기는 잠시 막습니다.</p><button type="button" disabled={busy || !props.server} onClick={() => void send(true)}>원래 저장 요청 결과 확인</button></div>}
    {error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {(opened || batchLocked || batchRecovery.request) && <TimetableSetupBatchPanel server={props.server} snapshot={visible ? source : undefined} member={props.member} disabled={props.disabled || locked || Boolean(edit)} onLockChange={setBatchLocked} onActivityChange={setBatchBusy} onChanged={batchChanged} />}
    {visible && source && <>
      <p className="timetable-setup-term"><strong>{source.termLabel}</strong> · {source.firstDay} ~ {source.lastDay}<small>담당·수강 인원 확인 기준일 {source.referenceDay}</small></p>
      <div className="timetable-setup-overview"><span>공간 {source.spaces.length}개</span><span>수업 {source.courses.length}개</span><span>학생 집단 연결 필요 {source.courses.filter(row => row.inTimetable && !row.link?.studentGroup && !row.link?.classIds.length).length}개</span></div>
      <TimetableSetupChecklist source={source} disabled={!canEdit || Boolean(edit)} onOpen={action => { if (action.kind === 'space') { const row = source.spaces.find(value => value.id === action.id); if (row) startSpace(row) } else { const row = source.courses.find(value => value.id === action.id); if (row) startCourse(row) } }} onOpenSchoolAdmin={props.onOpenSchoolAdmin} />
      <section aria-label="공간 목록"><div className="timetable-heading"><h3>공간·공유 장비</h3><button type="button" disabled={!canEdit || Boolean(edit)} onClick={() => startSpace(null)}>공간 추가</button></div><p className="timetable-muted">동시 수업 수는 학생 좌석 수가 아닙니다. 한 공간에서 동시에 열 수 있는 수업 수를 직접 입력합니다. 모르면 비워 두세요.</p>
        {!source.spaces.length && <p>등록한 공간이 없습니다. 특별실이나 공유 장비부터 추가할 수 있습니다.</p>}
        <ul className="timetable-list">{source.spaces.slice(currentSpacePage * PAGE_SIZE, (currentSpacePage + 1) * PAGE_SIZE).map(space => <li className="timetable-list-row" key={space.id} aria-label={display(space)}><div><strong>{display(space)}</strong><small>{space.kind === 'room' ? '교실·특별실' : '공유 장비'} · {capacityText(space.capacity)}</small></div><button type="button" className="secondary" disabled={!canEdit || Boolean(edit)} onClick={() => startSpace(space)}>공간 수정</button></li>)}</ul>
        {spacePages > 1 && <nav aria-label="공간 목록 쪽 이동" className="timetable-actions"><button type="button" className="secondary" disabled={!currentSpacePage} onClick={() => setSpacePage(currentSpacePage - 1)}>이전 공간</button><span>{currentSpacePage + 1}/{spacePages}쪽</span><button type="button" className="secondary" disabled={currentSpacePage + 1 >= spacePages} onClick={() => setSpacePage(currentSpacePage + 1)}>다음 공간</button></nav>}
      </section>
      <section aria-label="수업 연결 목록"><h3>수업과 학생 집단</h3><div className="timetable-grid"><label>수업 검색<input value={query} placeholder="수업·담당 교사·수업 ID" onChange={event => { setQuery(event.target.value); setPage(0) }} /></label><label>연결 상태<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">전체 수업</option><option value="missing">연결 필요</option><option value="linked">연결됨</option></select></label></div><p className="timetable-muted">{filteredCourses.length}개 수업 · {currentPage + 1}/{pages}쪽</p>
        <ul className="timetable-list">{filteredCourses.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(course => <li className="timetable-list-row" key={course.id} aria-label={display(course)}><div><strong>{display(course)}</strong><small>{course.teacherLabels.join(' · ') || '담당 교사 없음'} · 수강 {course.studentCount}명 · {course.inTimetable ? '편성 대상' : '편성 제외'}</small><small>{course.link?.studentGroup ? '별도 수강집단' : course.link?.classIds.length ? course.link.classIds.map(id => { const row = source.classes.find(row => row.id === id); return row ? display(row) : `빠진 학급 [${id}]` }).join(' · ') : '학생 집단 연결 필요'} · 공간 {course.link?.spaceIds.length ?? 0}개</small></div><button type="button" className="secondary" disabled={!canEdit || Boolean(edit)} onClick={() => startCourse(course)}>연결 편집</button></li>)}</ul>
        {!filteredCourses.length && <p>조건에 맞는 수업이 없습니다.</p>}
        {pages > 1 && <nav className="timetable-actions" aria-label="수업 연결 목록 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 수업</button><span>{currentPage + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 수업</button></nav>}
      </section>
      {edit && <section className="timetable-setup-editor" ref={editorNode} tabIndex={-1} aria-label={edit.kind === 'space' ? '공간 입력' : '수업 연결 입력'}><h3>{edit.kind === 'space' ? edit.original ? `${display(edit.original)} 수정` : '새 공간 입력' : `${display(edit.original)} 연결 편집`}</h3><p className="timetable-muted">한 항목씩 확인하고 저장합니다. 검색이나 목록 쪽을 바꿔도 이 입력은 유지됩니다. 입력은 현재 탭에만 보관됩니다.</p>
        {stale && <p role="alert" className="timetable-error">학기 기준 또는 이 항목의 자료가 바뀌었습니다. 입력을 보관했으며, 최신 자료를 비교하고 선택하기 전에는 저장하지 않습니다.</p>}
        {missingTarget && <p role="alert">이 항목이 현재 목록에 없습니다. 입력을 정리한 뒤 현재 항목을 다시 선택해 주세요.</p>}
        {edit.termId !== source.termId && <p role="alert">대상 학기가 바뀌었습니다. 이전 학기 입력은 새 학기에 자동으로 옮기지 않습니다. 입력을 정리하고 다시 선택해 주세요.</p>}
        <fieldset disabled={!canEdit || stale || preview}>
          {edit.kind === 'space' ? <><div className="timetable-grid"><label>공간 종류<select value={edit.input.kind} onChange={event => patch({ ...edit, input: { ...edit.input, kind: event.target.value as Space['kind'] } })}><option value="room">교실·특별실</option><option value="equipment">공유 장비</option></select></label><label>공간 이름<input value={edit.input.label} onChange={event => patch({ ...edit, input: { ...edit.input, label: event.target.value } })} /></label><label>동시 수업 수<input type="number" min="1" max={policy.maxCapacity} step="1" placeholder="모르면 비워 두세요" value={edit.input.capacity} onChange={event => patch({ ...edit, input: { ...edit.input, capacity: event.target.value } })} /></label></div><p className="timetable-muted">이름은 {policy.maxSpaceLabel}자까지입니다. 동시 수업 수가 비어 있는 공간도 저장할 수 있지만, 그 공간을 사용하는 시간표는 확정할 수 없습니다.</p>{linkedCourses.length > 0 && <p>현재 학기의 수업 {linkedCourses.length}개에 연결되어 있어 삭제할 수 없습니다. 해당 수업의 공간 연결부터 변경해 주세요.</p>}</> : <>
            <p>{edit.original.teacherLabels.join(' · ') || '담당 교사 없음'} · 수강 {edit.original.studentCount}명 · {edit.original.inTimetable ? '편성 대상' : '편성 제외'}</p>
            <fieldset><legend>학생 집단 연결</legend><label className="timetable-check"><input type="radio" name="timetable-setup-student-mode" checked={!edit.input.studentGroup} onChange={() => patch({ ...edit, input: { ...edit.input, studentGroup: false } })} />공식 학급 선택</label><label className="timetable-check"><input type="radio" name="timetable-setup-student-mode" checked={edit.input.studentGroup} onChange={() => patch({ ...edit, input: { ...edit.input, studentGroup: true, classIds: [] } })} />이 수업의 별도 수강집단</label><p className="timetable-muted">별도 수강집단을 선택하면 학급 선택은 해제됩니다. 서로 다른 수업에 같은 학생이 있다면 같은 학급 자원으로 연결해야 충돌을 검사할 수 있습니다.</p>
              {!edit.input.studentGroup && <><label>학급 찾기<input value={classQuery} onChange={event => setClassQuery(event.target.value)} /></label><p className="timetable-muted">선택 {edit.input.classIds.length}/{policy.maxClassIds}개 · 학년과 ID로 같은 이름을 구분하세요.</p><div className="timetable-setup-options">{source.classes.filter(row => edit.input.classIds.includes(row.id) || normalize(`${row.grade} ${row.label} ${row.id}`).includes(normalize(classQuery))).map(row => <label className="timetable-check" key={row.id}><input type="checkbox" checked={edit.input.classIds.includes(row.id)} disabled={!edit.input.classIds.includes(row.id) && edit.input.classIds.length >= policy.maxClassIds} onChange={event => patch({ ...edit, input: { ...edit.input, classIds: toggle(edit.input.classIds, row.id, event.target.checked) } })} />{row.grade}학년 {display(row)}</label>)}{missingClasses.map(id => <label className="timetable-check timetable-setup-missing" key={id}><input type="checkbox" checked onChange={() => patch({ ...edit, input: { ...edit.input, classIds: edit.input.classIds.filter(value => value !== id) } })} />현재 목록에 없는 학급 [{id}] — 직접 해제 필요</label>)}</div></>}
            </fieldset>
            <fieldset><legend>이 수업에서 함께 사용하는 공간·장비</legend><p className="timetable-muted">여러 공간을 고르면 모두 동시에 사용합니다. 대체할 수 있는 후보 공간의 목록이 아닙니다.</p><label>공간 찾기<input value={spaceQuery} onChange={event => setSpaceQuery(event.target.value)} /></label><p className="timetable-muted">선택 {edit.input.spaceIds.length}/{policy.maxSpaceIds}개</p><div className="timetable-setup-options">{source.spaces.filter(row => edit.input.spaceIds.includes(row.id) || normalize(`${row.label} ${row.id}`).includes(normalize(spaceQuery))).map(row => <label className="timetable-check" key={row.id}><input type="checkbox" checked={edit.input.spaceIds.includes(row.id)} disabled={!edit.input.spaceIds.includes(row.id) && edit.input.spaceIds.length >= policy.maxSpaceIds} onChange={event => patch({ ...edit, input: { ...edit.input, spaceIds: toggle(edit.input.spaceIds, row.id, event.target.checked) } })} />{display(row)} · {capacityText(row.capacity)}</label>)}{missingSpaces.map(id => <label className="timetable-check timetable-setup-missing" key={id}><input type="checkbox" checked onChange={() => patch({ ...edit, input: { ...edit.input, spaceIds: edit.input.spaceIds.filter(value => value !== id) } })} />현재 목록에 없는 공간 [{id}] — 직접 해제 필요</label>)}</div></fieldset>
            {(missingClasses.length > 0 || missingSpaces.length > 0) && <p role="alert">현재 목록에 없는 연결을 그대로 보관했습니다. 직접 해제하고 올바른 항목을 다시 선택해야 저장할 수 있습니다.</p>}
          </>}
        </fieldset>
        {showComparison && <section aria-label="저장 전 변경 비교" className="timetable-setup-comparison"><h4>{stale ? '최신 자료와 내 입력 비교' : edit.kind === 'space' && edit.removing ? '삭제 전 확인' : '저장 전 변경 비교'}</h4>{stale && <p className="timetable-muted">편집 시작 기준일 {edit.referenceDay} · 최신 기준일 {source.referenceDay}</p>}<dl>{labels.map((label, index) => <div key={label}><dt>{label}</dt><dd><span>편집 시작값</span>{fields(edit, source, 'original')[index]}</dd>{stale && <dd><span>최신 저장값</span>{fields(edit, source, 'latest')[index]}</dd>}<dd><span>내 입력</span>{fields(edit, source, 'mine')[index]}</dd></div>)}</dl>{stale && !missingTarget && edit.termId === source.termId && <div className="timetable-actions"><button type="button" disabled={!canEdit} onClick={() => reconcile(true)}>내 입력을 최신 자료에 이어서 편집</button><button type="button" className="secondary" disabled={!canEdit} onClick={() => reconcile(false)}>최신 저장값으로 바꾸기</button></div>}</section>}
        {!stale && <div className="timetable-actions">{!preview ? <><button type="button" disabled={!canEdit} onClick={() => compare()}>변경 내용 확인</button>{edit.kind === 'space' && edit.original && <button type="button" className="secondary" disabled={!canEdit || linkedCourses.length > 0} onClick={() => compare(true)}>공간 삭제 검토</button>}</> : <><label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={!canEdit} onChange={event => setConfirmed(event.target.checked)} />변경 내용을 확인했습니다</label><button type="button" disabled={!canEdit || !confirmed} onClick={() => void send()}>{edit.kind === 'space' && edit.removing ? '확인한 공간 삭제' : '확인한 내용 저장'}</button><button type="button" className="secondary" disabled={locked} onClick={() => { setPreview(false); setConfirmed(false) }}>입력 다시 편집</button></>}</div>}
      </section>}
    </>}
    {edit && !pending && <div className="timetable-actions">{discarding ? <><p>저장하지 않은 이 항목의 입력을 버립니다. 서버 자료는 바뀌지 않습니다.</p><button type="button" className="secondary" disabled={busy} onClick={() => patch(undefined)}>입력 버리고 닫기</button><button type="button" className="secondary" onClick={() => setDiscarding(false)}>입력 계속 보관</button></> : <button type="button" className="secondary" disabled={busy} onClick={() => setDiscarding(true)}>편집 입력 정리</button>}</div>}
  </details>
}
