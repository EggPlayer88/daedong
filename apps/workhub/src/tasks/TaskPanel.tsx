import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { TaskError, type PersonalTask, type TaskAdapter, type TaskCommand, type TaskFailureCode, type TaskInput, type TaskStatus } from './contracts'
import { normalizeTaskInput, taskListResponse, taskResponse, TASK_STATUSES } from './validation'
import taskStyles from './tasks.css?inline'
import { compareTasks, isOpenTask, summarizeTasks, taskDueGroup, taskDueLabels, taskNoteExcerpt, TASK_DUE_FILTERS, withSelectedTask, type TaskDueFilter } from './presentation'

export interface TaskOpenRequest { key: string; taskId?: string; dueFilter?: TaskDueFilter }
export interface TaskPanelProps { adapter: TaskAdapter; member: Membership; date: string; compact?: boolean; onOpenTasks?: (filter?: TaskDueFilter) => void; openRequest?: TaskOpenRequest; revision?: number; onNavigationLockChange?: (locked: boolean) => void }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const labels: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }
const blank = (): TaskInput => ({ title: '', notes: '', dueDate: '' })
const inputOf = (task: PersonalTask): TaskInput => ({ title: task.title, notes: task.notes, dueDate: task.dueDate })
const isOpen = isOpenTask
const failureText: Record<TaskFailureCode, string> = {
  INVALID_INPUT: '제목은 120자, 메모는 2,000자 이내로 입력하고 기한을 확인해 주세요. 입력은 그대로 남아 있습니다.',
  NOT_FOUND: '업무가 없거나 현재 소속으로 확인할 수 없습니다. 입력은 유지했습니다. 목록을 다시 확인해 주세요.',
  FORBIDDEN: '이 업무를 볼 수 있는 권한이 확인되지 않았습니다. 이전 업무 화면을 닫았습니다.',
  INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다. 이전 업무 화면을 닫았습니다.',
  CONFLICT: '다른 창에서 업무를 먼저 변경했습니다. 최신 내용과 내 변경을 비교해 주세요.',
  IDEMPOTENCY_CONFLICT: '이전 요청의 내용을 확인할 수 없습니다. 입력은 유지했습니다. 같은 요청으로 확인을 다시 시도해 주세요.',
  QUERY_FAILED: '저장 결과를 확인하지 못했습니다. 입력은 유지했습니다.',
  SAVE_FAILED: '저장 완료 여부를 확인하지 못했습니다. 입력은 유지했습니다.',
  CANCELLED: '연결 상태가 바뀌어 저장 결과를 확인하지 못했습니다. 입력은 유지했습니다.',
}
type Pending = { command: TaskCommand; key: string }
type Conflict = { command: Exclude<TaskCommand, { kind: 'create' }>; current?: PersonalTask }
function errorCode(error: unknown): TaskFailureCode { return error instanceof TaskError ? error.code : 'QUERY_FAILED' }

// 소속이 바뀐 첫 렌더부터 이전 폼·결과를 제거한다. 외부 mount key가 없어도 같은 원칙을 지킨다.
export function TaskPanel(props: TaskPanelProps) {
  const member = props.member
  return <TaskPanelScope key={JSON.stringify([member.schoolId, member.id, member.userId, member.active, member.validFrom, member.validThrough])} {...props} />
}

function TaskPanelScope({ adapter, member, date, compact = false, onOpenTasks, openRequest, revision = 0, onNavigationLockChange }: TaskPanelProps) {
  const id = useId()
  const [tasks, setTasks] = useState<PersonalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [editor, setEditor] = useState<{ original?: PersonalTask }>()
  const [input, setInput] = useState<TaskInput>(blank)
  const [filter, setFilter] = useState<'open' | 'all' | TaskStatus>('open')
  const [dueFilter, setDueFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<'saving' | 'opening' | ''>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [denied, setDenied] = useState('')
  const [pending, setPending] = useState<Pending>()
  const [conflict, setConflict] = useState<Conflict>()
  const [selectedTask, setSelectedTask] = useState<PersonalTask>()
  const [unavailableTaskId, setUnavailableTaskId] = useState<string>()
  const [openError, setOpenError] = useState('')
  const [openAttempt, setOpenAttempt] = useState(0)
  const panel = useRef<HTMLElement>(null)
  const focusTask = useRef<string>()
  const alive = useRef(true)
  const listGeneration = useRef(0)
  const operationGeneration = useRef(0)
  const inFlight = useRef(false)
  const pendingRef = useRef<Pending>()
  const scope = { memberId: member.id, schoolId: member.schoolId }
  const enabled = activeAt(member, date)
  const locked = !!busy || !!pending || !!conflict || !!denied || !enabled
  const navigationLocked = !!editor || !!busy || !!pending || !!conflict
  useBrowserLayoutEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => { onNavigationLockChange?.(false) }
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!navigationLocked) return
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => { window.removeEventListener('beforeunload', beforeLeave) }
  }, [navigationLocked])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; listGeneration.current++; operationGeneration.current++; inFlight.current = false }
  }, [adapter])

  function purge(message: string) {
    listGeneration.current++; operationGeneration.current++
    pendingRef.current = undefined; inFlight.current = false
    setTasks([]); setSelectedTask(undefined); setUnavailableTaskId(undefined); focusTask.current = undefined; setOpenError('')
    setEditor(undefined); setInput(blank()); setPending(undefined); setConflict(undefined)
    setError(''); setNotice(''); setBusy(''); setLoading(false); setDenied(message)
  }
  useEffect(() => {
    const generation = ++listGeneration.current
    if (!enabled) { purge(failureText.INACTIVE_MEMBERSHIP); return }
    setLoading(true); setLoadError(''); setSelectedTask(undefined); setUnavailableTaskId(undefined)
    void adapter.list(member.id).then(raw => {
      if (!alive.current || generation !== listGeneration.current) return
      const result = taskListResponse(raw, scope)
      setTasks(result); setDenied('')
    }).catch(failure => {
      if (!alive.current || generation !== listGeneration.current) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') purge(failureText[code])
      else { setTasks([]); setLoadError('내 업무를 불러오지 못했습니다. 업무가 없는 것으로 처리하지 않습니다. 잠시 뒤 다시 불러와 주세요.') }
    }).finally(() => { if (alive.current && generation === listGeneration.current) setLoading(false) })
    return () => { listGeneration.current++ }
  }, [adapter, member.id, revision, reload, enabled])

  // 요청 번호가 바뀔 때만 이동 요청을 처리한다. 읽기 요청은 편집기를 자동으로 열지 않는다.
  useEffect(() => {
    if (compact || !openRequest?.key || !enabled) return
    if (inFlight.current || editor || pending || conflict || denied) return
    const { taskId, dueFilter: requestedFilter } = openRequest
    setSearch(''); setFilter(taskId ? 'all' : 'open')
    setDueFilter(!taskId && requestedFilter && TASK_DUE_FILTERS.includes(requestedFilter) ? requestedFilter : 'all')
    setSelectedTask(undefined); focusTask.current = undefined; setOpenError(''); setNotice('')
    if (!taskId) return
    const operation = ++operationGeneration.current
    const current = () => alive.current && operation === operationGeneration.current
    inFlight.current = true; setBusy('opening')
    void adapter.get(member.id, taskId).then(raw => {
      if (!current()) return
      const original = taskResponse(raw, scope, taskId)
      focusTask.current = original.id
      setUnavailableTaskId(undefined); setSelectedTask(original); merge(original)
      setNotice('요청한 업무의 최신 원본을 확인했습니다. 내용을 검토한 뒤 수정하거나 상태를 바꿔 주세요.')
    }).catch(failure => {
      if (!current()) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') { purge(failureText[code]); return }
      setSelectedTask(undefined); focusTask.current = undefined
      if (code === 'NOT_FOUND') { setUnavailableTaskId(taskId); setTasks(currentTasks => currentTasks.filter(task => task.id !== taskId)) }
      setOpenError(code === 'NOT_FOUND' ? '찾은 업무가 없거나 현재 소속으로 확인할 수 없습니다. 최신 목록에서 다시 찾아 주세요.' : '요청한 업무의 원본을 확인하지 못했습니다. 다시 확인해 주세요.')
    }).finally(() => { if (current()) { inFlight.current = false; setBusy('') } })
    return () => {
      if (operation === operationGeneration.current) { operationGeneration.current++; inFlight.current = false; setBusy('') }
    }
  }, [adapter, member.id, enabled, compact, openRequest?.key, openAttempt])
  // 빠른 원본 응답이 필터 초기화보다 먼저 반영될 수 있다. 카드가 나타난 commit에서 요청을 마친다.
  useBrowserLayoutEffect(() => {
    if (loading || loadError || !focusTask.current) return
    const card = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-task-id]') ?? []).find(node => node.dataset.taskId === focusTask.current)
    if (card) { card.focus(); card.scrollIntoView({ block: 'nearest' }); focusTask.current = undefined }
  }, [selectedTask, loading, loadError, filter, dueFilter, search, unavailableTaskId])

  function merge(result: PersonalTask) {
    setTasks(current => {
      const previous = current.find(task => task.id === result.id)
      if (previous && previous.version > result.version) return current
      return previous ? current.map(task => task.id === result.id ? result : task) : [...current, result]
    })
  }
  async function perform(command: TaskCommand, requestKey: string = crypto.randomUUID()) {
    if (inFlight.current || denied || !enabled) return
    const request: Pending = { command: structuredClone(command), key: requestKey }
    const operation = ++operationGeneration.current
    const current = () => alive.current && operation === operationGeneration.current
    inFlight.current = true; pendingRef.current = request
    listGeneration.current++; setLoading(false)
    setBusy('saving'); setError(''); setNotice(''); setPending(undefined); setConflict(undefined)
    try {
      const raw = command.kind === 'create' ? await adapter.create(member.id, command.input, requestKey)
        : command.kind === 'update' ? await adapter.update(member.id, command.taskId, command.input, command.expectedVersion, requestKey)
          : await adapter.setStatus(member.id, command.taskId, command.status, command.expectedVersion, requestKey)
      if (!current()) return
      const result = taskResponse(raw, scope, command.kind === 'create' ? undefined : command.taskId)
      listGeneration.current++; merge(result)
      pendingRef.current = undefined; setPending(undefined); setError('')
      if (command.kind !== 'status') { setEditor(undefined); setInput(blank()) }
      else if (editor?.original?.id === result.id && command.expectedVersion === editor.original.version) setEditor({ original: result })
      setNotice(command.kind === 'create' ? '내 업무에 추가했습니다.' : command.kind === 'update' ? '업무 내용을 수정했습니다.' : `업무를 ‘${labels[result.status]}’ 상태로 변경했습니다.`)
      // 이전 접수 결과가 반환된 재시도도 현재 원본은 다시 조회한다.
      setReload(value => value + 1)
    } catch (failure) {
      if (!current()) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') { purge(failureText[code]); return }
      if (code === 'CONFLICT' && command.kind !== 'create') {
        let latest: PersonalTask | undefined
        try { if (failure instanceof TaskError && failure.current) latest = taskResponse(failure.current, scope, command.taskId) } catch { /* 검증되지 않은 충돌 원문을 표시하지 않는다. */ }
        if (latest) merge(latest)
        pendingRef.current = undefined; setPending(undefined); setConflict({ command, current: latest })
      } else if (code === 'INVALID_INPUT' || code === 'NOT_FOUND') {
        pendingRef.current = undefined; setPending(undefined)
      } else setPending(request)
      setError(failureText[code])
    } finally {
      if (current()) { inFlight.current = false; setBusy('') }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (locked || pendingRef.current) return
    let normalized: TaskInput
    try { normalized = normalizeTaskInput(input) }
    catch (failure) { setError(failure instanceof TaskError ? failure.message : failureText.INVALID_INPUT); return }
    void perform(editor?.original ? { kind: 'update', taskId: editor.original.id, input: normalized, expectedVersion: editor.original.version } : { kind: 'create', input: normalized })
  }
  async function beginEdit(task: PersonalTask) {
    if (locked || inFlight.current || editor) return
    const operation = ++operationGeneration.current
    inFlight.current = true; setBusy('opening'); setError(''); setNotice('')
    try {
      const raw = await adapter.get(member.id, task.id)
      if (!alive.current || operation !== operationGeneration.current) return
      const original = taskResponse(raw, scope, task.id)
      merge(original); setEditor({ original }); setInput(inputOf(original))
    } catch (failure) {
      if (!alive.current || operation !== operationGeneration.current) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') purge(failureText[code])
      else setError('업무 원본을 불러오지 못했습니다. 목록의 내용을 덮어쓰지 않았습니다. 다시 시도해 주세요.')
    } finally { if (alive.current && operation === operationGeneration.current) { inFlight.current = false; setBusy('') } }
  }
  async function loadConflict() {
    if (!conflict || inFlight.current) return
    const operation = ++operationGeneration.current
    inFlight.current = true; setBusy('opening')
    try {
      const raw = await adapter.get(member.id, conflict.command.taskId)
      if (!alive.current || operation !== operationGeneration.current) return
      const latest = taskResponse(raw, scope, conflict.command.taskId)
      merge(latest); setConflict({ ...conflict, current: latest }); setError(failureText.CONFLICT)
    } catch (failure) {
      if (!alive.current || operation !== operationGeneration.current) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') purge(failureText[code])
      else setError('최신 업무를 확인하지 못했습니다. 내 변경은 보존했습니다. 다시 불러와 주세요.')
    } finally { if (alive.current && operation === operationGeneration.current) { inFlight.current = false; setBusy('') } }
  }
  function useLatest() {
    if (!conflict?.current || busy) return
    const latest = conflict.current
    if (conflict.command.kind === 'update') { setEditor({ original: latest }); setInput(inputOf(latest)) }
    setConflict(undefined); setError(''); setNotice('최신 업무를 유지했습니다. 내 변경은 서버에 적용하지 않았습니다.')
  }
  const currentTasks = withSelectedTask(tasks, selectedTask).filter(task => task.id !== unavailableTaskId)
  const summary = summarizeTasks(currentTasks, date)
  const filtered = currentTasks.filter(task => {
    if (compact) return isOpen(task)
    if (filter === 'open' ? !isOpen(task) : filter !== 'all' && task.status !== filter) return false
    if (dueFilter === 'overdue' && (!isOpen(task) || !task.dueDate || task.dueDate >= date)) return false
    if (dueFilter === 'today' && task.dueDate !== date) return false
    if (dueFilter === 'upcoming' && (!task.dueDate || task.dueDate <= date)) return false
    if (dueFilter === 'none' && task.dueDate !== '') return false
    return `${task.title} ${task.notes}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  }).sort(compareTasks)
  const shown = compact ? summary.items.map(item => item.task) : filtered
  const emptyMessage = !tasks.length ? '아직 등록한 개인 업무가 없습니다.' : compact ? '지금 진행할 개인 업무가 없습니다.' : '현재 검색·분류에 맞는 업무가 없습니다.'
  return <section ref={panel} className={`task-panel${compact ? ' task-compact' : ''}`} aria-labelledby={`${id}-heading`}>
    <style>{taskStyles}</style>
    <header className="task-heading"><div><p className="task-eyebrow">현재 학교 · 나만 보는 업무</p><h2 id={`${id}-heading`}>{compact ? '오늘 챙길 내 업무' : '내 업무'}</h2><p>개인 할 일과 메모를 정리합니다. 업무를 완료해도 수합 제출이나 학교 일정은 바뀌지 않습니다.</p></div><button type="button" className="task-primary" disabled={locked || !!editor || loading || !!loadError} onClick={() => { setEditor({}); setInput(blank()); setError(''); setNotice('') }}>할 일 등록</button></header>
    {denied || !enabled ? <div className="task-error" role="alert"><p>{denied || failureText.INACTIVE_MEMBERSHIP}</p>{enabled && <button type="button" className="task-secondary" onClick={() => setReload(value => value + 1)}>연결 다시 확인</button>}</div> : <>
      {notice && <p className="task-notice" role="status">{notice}</p>}
      {error && <p className="task-error" role="alert">{error}</p>}
      {openError && <div className="task-error" role="alert"><p>{openError}</p><button type="button" className="task-secondary" disabled={locked || !!editor} onClick={() => setOpenAttempt(value => value + 1)}>업무 원본 다시 확인</button></div>}
      {pending && <section className="task-retry" aria-label="저장 결과 확인 필요"><h3>먼저 이전 요청의 결과를 확인해 주세요</h3><p>같은 내용과 요청 번호로 다시 확인합니다. 중복 저장을 막기 위해 결과를 확인할 때까지 입력 수정·취소와 다른 업무 변경을 잠시 멈춥니다.</p><button type="button" className="task-primary" disabled={!!busy} onClick={() => { void perform(pending.command, pending.key) }}>이전 요청 그대로 다시 확인</button></section>}
      {conflict && <section className="task-conflict" aria-label="업무 변경 내용 비교"><h3>최신 업무와 내 변경을 비교해 주세요</h3>{conflict.current ? <><div className="task-comparison"><div><h4>최신 업무 · v{conflict.current.version}</h4><TaskContents task={conflict.current} /></div><div><h4>내가 적용하려던 변경</h4>{conflict.command.kind === 'update' ? <TaskContents task={{ ...conflict.current, ...conflict.command.input }} /> : <p>상태를 <strong>{labels[conflict.command.status]}</strong>로 변경</p>}</div></div><div className="task-actions"><button type="button" className="task-primary" disabled={!!busy} onClick={() => { const current = conflict.current; if (current) void perform({ ...conflict.command, expectedVersion: current.version }) }}>최신 내용 확인 · 내 변경 다시 적용</button><button type="button" className="task-secondary" disabled={!!busy} onClick={useLatest}>최신 내용 사용</button></div></> : <><p>최신 원본을 확인하기 전에는 덮어쓰지 않습니다. 내 입력은 아래에 남아 있습니다.</p><button type="button" className="task-secondary" disabled={!!busy} onClick={() => { void loadConflict() }}>최신 업무 불러오기</button></>}</section>}
      {editor && <form className="task-editor" onSubmit={submit} aria-label={editor.original ? '내 업무 수정' : '내 업무 등록'}><h3>{editor.original ? '업무 내용 수정' : '새 할 일'}</h3><fieldset disabled={locked}><legend className="task-sr-only">업무 입력</legend><div className="task-form-row"><label className="task-title-field" htmlFor={`${id}-title`}>해야 할 일<input autoFocus id={`${id}-title`} name="task-title" aria-label="해야 할 일" required value={input.title} onChange={event => { setInput({ ...input, title: event.target.value }); setError('') }} placeholder="예: 체험학습 안내 내용 확인" /><small>{Array.from(input.title).length}/120자</small></label><label htmlFor={`${id}-due`}>기한 (선택)<input id={`${id}-due`} name="task-due" aria-label="기한 (선택)" type="date" value={input.dueDate} onChange={event => setInput({ ...input, dueDate: event.target.value })} /></label></div><label htmlFor={`${id}-notes`}>나만 보는 메모<textarea id={`${id}-notes`} name="task-notes" aria-label="나만 보는 메모" rows={3} value={input.notes} onChange={event => { setInput({ ...input, notes: event.target.value }); setError('') }} /><small>{Array.from(input.notes).length.toLocaleString()}/2,000자</small></label></fieldset><div className="task-actions"><button type="submit" className="task-primary" disabled={locked}>{busy === 'saving' ? '저장 중…' : editor.original ? '수정 저장' : '내 업무에 추가'}</button><button type="button" className="task-secondary" disabled={locked} onClick={() => { setEditor(undefined); setInput(blank()); setError('') }}>편집 취소</button>{editor.original && <small>확인한 원본 v{editor.original.version}</small>}</div></form>}
      {!compact && <div className="task-filters"><label htmlFor={`${id}-search`}>업무 검색<input id={`${id}-search`} aria-label="업무 검색" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="제목·나의 메모 검색" /></label><label htmlFor={`${id}-status`}>상태<select id={`${id}-status`} aria-label="상태" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="open">진행할 업무</option><option value="all">모든 상태</option>{TASK_STATUSES.map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label><label htmlFor={`${id}-filter-due`}>기한 분류<select id={`${id}-filter-due`} aria-label="기한 분류" value={dueFilter} onChange={event => setDueFilter(event.target.value)}><option value="all">모든 기한</option><option value="overdue">기한 지남</option><option value="today">오늘까지</option><option value="upcoming">앞으로</option><option value="none">기한 없음</option></select></label></div>}
      <div className="task-list-heading"><span>{loading ? '내 업무 확인 중' : loadError ? '조회 실패 · 건수 확인 안 됨' : compact ? `진행할 업무 ${summary.total}개${summary.total > 4 ? ' · 먼저 4개 표시' : ''}` : `현재 분류 ${shown.length}개`}</span><button type="button" className="task-text-button" disabled={!!busy || !!pending || loading} onClick={() => setReload(value => value + 1)}>목록 새로고침</button></div>
      {compact && <TaskDueSummary tasks={currentTasks} date={date} state={loading ? 'loading' : loadError ? 'error' : 'ready'} disabled={navigationLocked} onOpenTasks={onOpenTasks} />}
      {loading ? <p className="task-loading" role="status">내 업무를 불러오는 중…</p> : loadError ? <div className="task-error" role="alert"><p>{loadError}</p><button type="button" className="task-secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></div> : <div className="task-list">{shown.length ? shown.map(task => <article className={`task-card task-status-${task.status}${selectedTask?.id === task.id ? ' task-card-highlighted' : ''}`} key={task.id} data-task-id={task.id} tabIndex={-1} aria-label={task.title}><div className="task-card-content"><h3>{task.title}</h3><div className="task-meta"><span className="task-status-badge">{labels[task.status]}</span><span className={task.dueDate && task.dueDate < date && isOpen(task) ? 'task-overdue' : ''}>{task.dueDate ? `${task.dueDate}까지${task.dueDate < date && isOpen(task) ? ' · 기한 지남' : ''}` : '기한 없음'}</span><small>v{task.version}</small>{compact && <span className="task-reason">{taskDueLabels[taskDueGroup(task, date)]}</span>}</div>{task.notes && <p className="task-notes">{compact ? taskNoteExcerpt(task.notes) : task.notes}</p>}</div><div className="task-card-actions"><button type="button" className="task-secondary" disabled={locked} onClick={() => { void perform({ kind: 'status', taskId: task.id, status: task.status === 'done' || task.status === 'cancelled' ? 'todo' : 'done', expectedVersion: task.version }) }}>{task.status === 'done' || task.status === 'cancelled' ? '다시 시작' : '완료'}</button>{!compact && <><select aria-label={`${task.title} 상태`} value={task.status} disabled={locked} onChange={event => { void perform({ kind: 'status', taskId: task.id, status: event.target.value as TaskStatus, expectedVersion: task.version }) }}>{TASK_STATUSES.map(status => <option value={status} key={status}>{labels[status]}</option>)}</select><button type="button" className="task-text-button" disabled={locked || !!editor} onClick={() => { void beginEdit(task) }}>수정</button></>}</div></article>) : <p className="task-empty">{emptyMessage}</p>}</div>}
      {busy === 'opening' && <p role="status" className="task-loading">업무 원본을 확인하는 중…</p>}
      {compact && onOpenTasks && <button type="button" className="task-text-button task-more" disabled={!!busy || !!pending || !!conflict || !!editor} onClick={() => onOpenTasks()}>모든 내 업무 보기</button>}
    </>}
  </section>
}

function TaskContents({ task }: { task: PersonalTask }) {
  return <dl><dt>제목</dt><dd>{task.title}</dd><dt>기한</dt><dd>{task.dueDate || '기한 없음'}</dd><dt>메모</dt><dd className="task-notes">{task.notes || '메모 없음'}</dd><dt>상태</dt><dd>{labels[task.status]}</dd></dl>
}

// 홈 요약은 조회가 끝난 현재 원본에 대해서만 숫자를 표시한다.
export function TaskDueSummary({ tasks, date, state, disabled = false, onOpenTasks }: { tasks: readonly PersonalTask[]; date: string; state: 'loading' | 'error' | 'ready'; disabled?: boolean; onOpenTasks?: (filter?: TaskDueFilter) => void }) {
  if (state !== 'ready') return null
  const summary = summarizeTasks(tasks, date)
  return <div className="task-due-summary" role="group" aria-label="개인 업무 기한 요약">{TASK_DUE_FILTERS.map(filter => <button type="button" className={`task-due-tile task-due-${filter}`} key={filter} disabled={disabled || !onOpenTasks} aria-label={`${taskDueLabels[filter]} 업무 ${summary.counts[filter]}개 보기`} onClick={() => onOpenTasks?.(filter)}><span>{taskDueLabels[filter]}</span><strong>{summary.counts[filter]}<small>개</small></strong></button>)}</div>
}
