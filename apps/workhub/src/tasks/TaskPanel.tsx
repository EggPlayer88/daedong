import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { TaskError, type PersonalTask, type TaskAdapter, type TaskCommand, type TaskFailureCode, type TaskInput, type TaskStatus } from './contracts'
import { normalizeTaskInput, taskListResponse, taskResponse, TASK_STATUSES } from './validation'
import taskStyles from './tasks.css?inline'
import { compareTasks, isOpenTask, summarizeTasks, taskDueLabels, taskStatusLabels as labels, TASK_DUE_FILTERS, withSelectedTask, type TaskDueFilter } from './presentation'
import { LIST_PAGE_SIZE, listWindow } from '../app/list-window'
import { ListPagination } from '../app/ListPagination'
import { usePendingRequest, recoveryScope, type TaskRecovery } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { TaskEditor } from './TaskEditor'
import { TaskCard } from './TaskCard'

export interface TaskOpenRequest { key: string; taskId?: string; dueFilter?: TaskDueFilter }
export interface TaskPanelProps { adapter: TaskAdapter; member: Membership; date: string; compact?: boolean; onOpenTasks?: (filter?: TaskDueFilter) => void; openRequest?: TaskOpenRequest; revision?: number; onNavigationLockChange?: (locked: boolean) => void }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
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
type Pending = TaskRecovery
type Conflict = { command: Exclude<TaskCommand, { kind: 'create' }>; current?: PersonalTask }
type TaskEditorSnapshot = { editor?: { original?: PersonalTask }; input: TaskInput; conflict?: Conflict }
function errorCode(error: unknown): TaskFailureCode { return error instanceof TaskError ? error.code : 'QUERY_FAILED' }

// 소속이 바뀐 첫 렌더부터 이전 폼·결과를 제거한다. 외부 mount key가 없어도 같은 원칙을 지킨다.
export function TaskPanel(props: TaskPanelProps) {
  const member = props.member
  return <TaskPanelScope key={recoveryScope(member)} {...props} />
}

function TaskPanelScope({ adapter, member, date, compact = false, onOpenTasks, openRequest, revision = 0, onNavigationLockChange }: TaskPanelProps) {
  const id = useId()
  const recovery = usePendingRequest(member, 'task')
  const [recovered] = useState(() => recovery.request)
  const editMemory = useEditDraft<TaskEditorSnapshot>(member, 'task-editor')
  const [savedDraft] = useState(() => recovered ? undefined : editMemory.initial)
  const restoreOriginalId = savedDraft?.editor?.original?.id ?? savedDraft?.conflict?.command.taskId
  const [restoreState, setRestoreState] = useState<'checking' | 'ready' | 'retry'>(restoreOriginalId ? 'checking' : 'ready')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const retiredDraft = useRef(false)
  const restoreDiscarded = useRef(false)
  const [tasks, setTasks] = useState<PersonalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [editor, setEditor] = useState<{ original?: PersonalTask } | undefined>(() => recovered && recovered.command.kind !== 'status' ? { original: recovered.original } : savedDraft?.editor)
  const [input, setInput] = useState<TaskInput>(() => recovered && recovered.command.kind !== 'status' ? structuredClone(recovered.command.input) : savedDraft ? structuredClone(savedDraft.input) : blank())
  const [filter, setFilter] = useState<'open' | 'all' | TaskStatus>('open')
  const [dueFilter, setDueFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [listPage, setListPage] = useState(0)
  const [busy, setBusy] = useState<'saving' | 'opening' | ''>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [denied, setDenied] = useState('')
  const [pending, setPending] = useState<Pending | undefined>(recovered)
  const [pendingFolded, setPendingFolded] = useState(Boolean(recovered))
  const [savedTaskId, setSavedTaskId] = useState<string>()
  const [conflict, setConflict] = useState<Conflict | undefined>(savedDraft?.conflict)
  const [selectedTask, setSelectedTask] = useState<PersonalTask>()
  const [unavailableTaskId, setUnavailableTaskId] = useState<string>()
  const [openError, setOpenError] = useState('')
  const [openAttempt, setOpenAttempt] = useState(0)
  const panel = useRef<HTMLElement>(null)
  const editorTrigger = useRef<HTMLButtonElement | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  const noticeMessage = useRef<HTMLDivElement>(null)
  const registrationButton = useRef<HTMLButtonElement>(null)
  const nextFocus = useRef<'title' | 'return' | 'error' | 'notice' | 'denied' | 'recovery'>()
  const deniedMessage = useRef<HTMLDivElement>(null)
  const recoveryMessage = useRef<HTMLElement>(null)
  const focusTask = useRef<string>()
  const listHeading = useRef<HTMLDivElement>(null)
  const focusList = useRef(false)
  const alive = useRef(true)
  const listGeneration = useRef(0)
  const operationGeneration = useRef(0)
  const inFlight = useRef(false)
  const pendingRef = useRef<Pending | undefined>(recovered)
  const scope = { memberId: member.id, schoolId: member.schoolId }
  const enabled = activeAt(member, date)
  const locked = !!busy || !!pending || !!conflict || !!denied || !enabled || restoreState !== 'ready'
  const dirty = !!editor && JSON.stringify(input) !== JSON.stringify(editor.original ? inputOf(editor.original) : blank())
  const navigationLocked = (!pendingFolded && (dirty || !!pending)) || !!busy || !!conflict
  useBrowserLayoutEffect(() => {
    if (retiredDraft.current) return
    editMemory.save(editor || conflict ? { editor, input, conflict } : undefined, dirty || Boolean(conflict))
  })
  useEffect(() => {
    if (!restoreOriginalId) return
    let current = true
    setRestoreState('checking')
    void adapter.get(member.id, restoreOriginalId).then(raw => {
      if (!current || restoreDiscarded.current) return
      const latest = taskResponse(raw, scope, restoreOriginalId)
      merge(latest)
      if (savedDraft?.conflict) setConflict({ ...savedDraft.conflict, current: latest })
      // 이전 원본 버전으로 저장해야 재연결 사이 변경도 충돌로 확인할 수 있다.
      setRestoreState('ready'); setNotice('연결을 다시 확인했습니다. 저장하지 않은 입력을 복원했습니다.'); nextFocus.current = 'title'
    }).catch(failure => {
      if (!current || restoreDiscarded.current) return
      const code = errorCode(failure)
      if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(code)) { purge('이전 업무의 수정 권한을 확인할 수 없어 보관한 입력을 폐기했습니다. 목록에서 다시 확인해 주세요.'); setRestoreState('ready') }
      else setRestoreState('retry')
    })
    return () => { current = false }
  }, [adapter, member.id, restoreAttempt])
  // 입력 양식과 목록은 저장·취소로 교체되므로, 화면에 남은 다음 조작 위치로 잇는다.
  useBrowserLayoutEffect(() => {
    if (!nextFocus.current || busy) return
    const target = nextFocus.current === 'denied' ? deniedMessage.current
      : nextFocus.current === 'recovery' ? recoveryMessage.current
      : nextFocus.current === 'title' ? titleInput.current
      : nextFocus.current === 'error' ? errorMessage.current
        : nextFocus.current === 'notice' ? noticeMessage.current
          : editorTrigger.current?.isConnected && !editorTrigger.current.disabled ? editorTrigger.current : registrationButton.current
    if (!target || ('disabled' in target && target.disabled)) return
    target.focus()
    nextFocus.current = undefined
  })
  useBrowserLayoutEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => { onNavigationLockChange?.(false) }
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!navigationLocked && !pending) return
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => { window.removeEventListener('beforeunload', beforeLeave) }
  }, [navigationLocked, pending])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; listGeneration.current++; operationGeneration.current++; inFlight.current = false }
  }, [adapter])

  function purge(message: string) {
    restoreDiscarded.current = true; retiredDraft.current = true; editMemory.remove()
    listGeneration.current++; operationGeneration.current++
    pendingRef.current = undefined; inFlight.current = false; recovery.remove()
    setTasks([]); setSelectedTask(undefined); setUnavailableTaskId(undefined); focusTask.current = undefined; setOpenError('')
    setEditor(undefined); setInput(blank()); setPending(undefined); setConflict(undefined)
    setError(''); setNotice(''); setBusy(''); setLoading(false); setDenied(message)
    nextFocus.current = 'denied'; editorTrigger.current = null
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
    setSearch(''); setFilter(taskId ? 'all' : 'open'); setListPage(0)
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
    else {
      // 검색으로 찾은 원본이 뒤쪽에 있어도 그 원본이 포함된 쪽부터 연다.
      const index = filtered.findIndex(task => task.id === focusTask.current)
      if (index >= 0) setListPage(Math.floor(index / LIST_PAGE_SIZE))
    }
  }, [selectedTask, loading, loadError, filter, dueFilter, search, unavailableTaskId, listPage, tasks])

  function merge(result: PersonalTask) {
    setTasks(current => {
      const previous = current.find(task => task.id === result.id)
      if (previous && previous.version > result.version) return current
      return previous ? current.map(task => task.id === result.id ? result : task) : [...current, result]
    })
  }
  async function perform(command: TaskCommand, requestKey: string = crypto.randomUUID()) {
    if (inFlight.current || denied || !enabled || restoreState !== 'ready') return
    const request: Pending = { command: structuredClone(command), key: requestKey, original: editor?.original ?? pending?.original }
    const operation = ++operationGeneration.current
    const current = () => alive.current && operation === operationGeneration.current
    inFlight.current = true; pendingRef.current = request; recovery.put(request)
    listGeneration.current++; setLoading(false)
    setBusy('saving'); setError(''); setNotice(''); setSavedTaskId(undefined); setPending(undefined); setConflict(undefined); setPendingFolded(false)
    try {
      const raw = command.kind === 'create' ? await adapter.create(member.id, command.input, requestKey)
        : command.kind === 'update' ? await adapter.update(member.id, command.taskId, command.input, command.expectedVersion, requestKey)
          : await adapter.setStatus(member.id, command.taskId, command.status, command.expectedVersion, requestKey)
      if (!current()) return
      const result = taskResponse(raw, scope, command.kind === 'create' ? undefined : command.taskId)
      listGeneration.current++; merge(result)
      pendingRef.current = undefined; recovery.remove(requestKey); setPending(undefined); setError(''); setSavedTaskId(result.id)
      if (command.kind !== 'status') { retiredDraft.current = true; editMemory.remove(); setEditor(undefined); setInput(blank()) }
      else if (editor?.original?.id === result.id && command.expectedVersion === editor.original.version) setEditor({ original: result })
      setNotice(command.kind === 'create' ? '내 업무에 추가했습니다.' : command.kind === 'update' ? '업무 내용을 수정했습니다.' : `업무를 ‘${labels[result.status]}’ 상태로 변경했습니다.`)
      nextFocus.current = 'notice'
      // 이전 접수 결과가 반환된 재시도도 현재 원본은 다시 조회한다.
      setReload(value => value + 1)
    } catch (failure) {
      if (!current()) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') { purge(failureText[code]); return }
      if (code === 'CONFLICT' && command.kind !== 'create') {
        // 이전 편집을 저장·취소한 뒤 생긴 상태 변경 충돌도 새 보관 대상으로 취급한다.
        retiredDraft.current = false
        let latest: PersonalTask | undefined
        try { if (failure instanceof TaskError && failure.current) latest = taskResponse(failure.current, scope, command.taskId) } catch { /* 검증되지 않은 충돌 원문을 표시하지 않는다. */ }
        if (latest) merge(latest)
        pendingRef.current = undefined; recovery.remove(requestKey); setPending(undefined); setConflict({ command, current: latest })
      } else if (code === 'INVALID_INPUT' || code === 'NOT_FOUND') {
        pendingRef.current = undefined; recovery.remove(requestKey); setPending(undefined)
      } else setPending(request)
      setError(failureText[code])
      nextFocus.current = 'error'
    } finally {
      if (current()) { inFlight.current = false; setBusy('') }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (locked || pendingRef.current) return
    let normalized: TaskInput
    try { normalized = normalizeTaskInput(input) }
    catch (failure) { nextFocus.current = 'error'; setError(failure instanceof TaskError ? failure.message : failureText.INVALID_INPUT); errorMessage.current?.focus(); return }
    void perform(editor?.original ? { kind: 'update', taskId: editor.original.id, input: normalized, expectedVersion: editor.original.version } : { kind: 'create', input: normalized })
  }
  async function beginEdit(task: PersonalTask, trigger: HTMLButtonElement) {
    if (locked || inFlight.current || editor) return
    editorTrigger.current = trigger
    const operation = ++operationGeneration.current
    inFlight.current = true; setBusy('opening'); setError(''); setNotice('')
    try {
      const raw = await adapter.get(member.id, task.id)
      if (!alive.current || operation !== operationGeneration.current) return
      const original = taskResponse(raw, scope, task.id)
      merge(original); retiredDraft.current = false; setEditor({ original }); setInput(inputOf(original)); nextFocus.current = 'title'
    } catch (failure) {
      if (!alive.current || operation !== operationGeneration.current) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') purge(failureText[code])
      else { setError('업무 원본을 불러오지 못했습니다. 목록의 내용을 덮어쓰지 않았습니다. 다시 시도해 주세요.'); nextFocus.current = 'error' }
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
      merge(latest); setConflict({ ...conflict, current: latest }); setError(failureText.CONFLICT); nextFocus.current = 'error'
    } catch (failure) {
      if (!alive.current || operation !== operationGeneration.current) return
      const code = errorCode(failure)
      if (code === 'FORBIDDEN' || code === 'INACTIVE_MEMBERSHIP') purge(failureText[code])
      else { setError('최신 업무를 확인하지 못했습니다. 내 변경은 보존했습니다. 다시 불러와 주세요.'); nextFocus.current = 'error' }
    } finally { if (alive.current && operation === operationGeneration.current) { inFlight.current = false; setBusy('') } }
  }
  function useLatest() {
    if (!conflict?.current || busy) return
    const latest = conflict.current
    if (conflict.command.kind === 'update') { setEditor({ original: latest }); setInput(inputOf(latest)) }
    setConflict(undefined); setError(''); setNotice('최신 업무를 유지했습니다. 내 변경은 서버에 적용하지 않았습니다.')
    nextFocus.current = conflict.command.kind === 'update' ? 'title' : 'notice'
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
  const taskWindow = listWindow(filtered, listPage)
  const shown = compact ? summary.items.map(item => item.task) : taskWindow.items
  useBrowserLayoutEffect(() => {
    if (loading || loadError) return
    if (!focusTask.current && taskWindow.page !== listPage) setListPage(taskWindow.page)
    if (focusList.current) { listHeading.current?.focus(); listHeading.current?.scrollIntoView({ block: 'nearest' }); focusList.current = false }
  }, [listPage, taskWindow.page, loading, loadError])
  function showSavedTask() {
    if (!savedTaskId || navigationLocked) return
    setSearch(''); setFilter('all'); setDueFilter('all')
    focusTask.current = savedTaskId
    setSelectedTask(tasks.find(task => task.id === savedTaskId))
  }
  function changeListPage(page: number) {
    if (navigationLocked) return
    focusList.current = true; setListPage(page)
  }
  const emptyMessage = !tasks.length ? '아직 등록한 개인 업무가 없습니다.' : compact ? '지금 진행할 개인 업무가 없습니다.' : '현재 검색·분류에 맞는 업무가 없습니다.'
  // 확인된 빈 목록만 작게 표시한다. 입력·오류·결과 미상 안내는 기존 공간을 유지한다.
  const compactEmpty = compact && !loading && !loadError && !denied && enabled && !pending && !editor && !conflict && !error && !openError && !notice && restoreState === 'ready' && summary.total === 0
  return <section ref={panel} className={`task-panel${compact ? ' task-compact' : ''}${compactEmpty ? ' task-state-empty' : ''}`} aria-labelledby={`${id}-heading`}>
    <style>{taskStyles}</style>
    <header className="task-heading"><div><p className="task-eyebrow">{compact ? '나만 보기' : '현재 학교 · 나만 보는 업무'}</p><h2 id={`${id}-heading`}>{compact ? '내 할 일' : '내 업무'}</h2>{!compact && <p>개인 할 일과 메모를 정리합니다. 업무를 완료해도 수합 제출이나 학교 일정은 바뀌지 않습니다.</p>}</div><button ref={registrationButton} type="button" className="task-primary" disabled={locked || !!editor || loading || !!loadError} onClick={event => { editorTrigger.current = event.currentTarget; nextFocus.current = 'title'; retiredDraft.current = false; setEditor({}); setInput(blank()); setError(''); setNotice('') }}>할 일 등록</button></header>
    {denied || !enabled ? <div ref={deniedMessage} tabIndex={-1} className="task-error" role="alert"><p>{denied || failureText.INACTIVE_MEMBERSHIP}</p>{enabled && <button type="button" className="task-secondary" onClick={() => setReload(value => value + 1)}>연결 다시 확인</button>}</div> : <>
      {notice && <div ref={noticeMessage} className="task-notice" role="status" tabIndex={-1}>{notice}{savedTaskId && !compact && <button type="button" className="task-text-button" disabled={navigationLocked} onClick={showSavedTask}>저장한 업무 보기</button>}</div>}
      {error && <p ref={errorMessage} id={`${id}-error`} className="task-error" role="alert" tabIndex={-1}>{error}</p>}
      {openError && <div className="task-error" role="alert"><p>{openError}</p><button type="button" className="task-secondary" disabled={locked || !!editor} onClick={() => setOpenAttempt(value => value + 1)}>업무 원본 다시 확인</button></div>}
      {pending && <section ref={recoveryMessage} tabIndex={-1} className="task-retry" aria-label="저장 결과 확인 필요"><h3>먼저 이전 요청의 결과를 확인해 주세요</h3><p>같은 내용과 요청 번호로 다시 확인합니다. 입력창을 접어 목록과 다른 화면을 볼 수 있습니다. 결과 확인 전에는 새 업무 저장을 잠시 멈춥니다. 새로고침하면 복구 정보가 사라집니다.</p><button type="button" className="task-primary" disabled={!!busy} onClick={() => { void perform(pending.command, pending.key) }}>이전 요청 그대로 다시 확인</button><button type="button" className="task-secondary" disabled={!!busy} onClick={() => { setPendingFolded(!pendingFolded); nextFocus.current = 'recovery' }}>{pendingFolded ? '보관한 입력 보기' : '입력창 접고 목록 보기'}</button></section>}
      {restoreState !== 'ready' && <section className="task-retry" aria-label="보관한 업무 입력 확인"><p role={restoreState === 'checking' ? 'status' : 'alert'}>{restoreState === 'checking' ? '현재 업무의 수정 권한을 다시 확인하는 중…' : '업무 원본을 다시 확인하지 못했습니다. 보관한 입력을 표시하지 않고 유지합니다.'}</p>{restoreState === 'retry' && <button type="button" className="task-primary" onClick={() => setRestoreAttempt(value => value + 1)}>보관한 업무 원본 다시 확인</button>}<button type="button" className="task-secondary" onClick={() => { restoreDiscarded.current = true; retiredDraft.current = true; editMemory.remove(); setEditor(undefined); setInput(blank()); setConflict(undefined); setRestoreState('ready') }}>보관한 입력 폐기</button></section>}
      {restoreState === 'ready' && conflict && <section className="task-conflict" aria-label="업무 변경 내용 비교"><h3>최신 업무와 내 변경을 비교해 주세요</h3>{conflict.current ? <><div className="task-comparison"><div><h4>최신 업무 · v{conflict.current.version}</h4><TaskContents task={conflict.current} /></div><div><h4>내가 적용하려던 변경</h4>{conflict.command.kind === 'update' ? <TaskContents task={{ ...conflict.current, ...conflict.command.input }} /> : <p>상태를 <strong>{labels[conflict.command.status]}</strong>로 변경</p>}</div></div><div className="task-actions"><button type="button" className="task-primary" disabled={!!busy} onClick={() => { const current = conflict.current; if (current) void perform({ ...conflict.command, expectedVersion: current.version }) }}>최신 내용 확인 · 내 변경 다시 적용</button><button type="button" className="task-secondary" disabled={!!busy} onClick={useLatest}>최신 내용 사용</button></div></> : <><p>최신 원본을 확인하기 전에는 덮어쓰지 않습니다. 내 입력은 아래에 남아 있습니다.</p><button type="button" className="task-secondary" disabled={!!busy} onClick={() => { void loadConflict() }}>최신 업무 불러오기</button></>}</section>}
      {restoreState === 'ready' && editor && !pendingFolded && <TaskEditor id={id} original={editor.original} input={input} locked={locked} saving={busy === 'saving'}
        errorId={error ? `${id}-error` : undefined} titleRef={titleInput}
        onTitleChange={value => { setInput({ ...input, title: value }); setError('') }}
        onDueDateChange={value => setInput({ ...input, dueDate: value })}
        onNotesChange={value => { setInput({ ...input, notes: value }); setError('') }}
        onSubmit={submit}
        onCancel={() => { nextFocus.current = 'return'; retiredDraft.current = true; editMemory.remove(); setEditor(undefined); setInput(blank()); setError('') }} />}
      {!compact && <div className="task-filters"><label htmlFor={`${id}-search`}>업무 검색<input id={`${id}-search`} aria-label="업무 검색" type="search" value={search} onChange={event => { setSearch(event.target.value); setListPage(0) }} placeholder="제목·나의 메모 검색" /></label><label htmlFor={`${id}-status`}>상태<select id={`${id}-status`} aria-label="상태" value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setListPage(0) }}><option value="open">진행할 업무</option><option value="all">모든 상태</option>{TASK_STATUSES.map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label><label htmlFor={`${id}-filter-due`}>기한 분류<select id={`${id}-filter-due`} aria-label="기한 분류" value={dueFilter} onChange={event => { setDueFilter(event.target.value); setListPage(0) }}><option value="all">모든 기한</option><option value="overdue">기한 지남</option><option value="today">오늘까지</option><option value="upcoming">앞으로</option><option value="none">기한 없음</option></select></label></div>}
      {!compactEmpty && <div ref={listHeading} className="task-list-heading" tabIndex={-1} aria-label="내 업무 목록"><span>{loading ? '내 업무 확인 중' : loadError ? '조회 실패 · 건수 확인 안 됨' : compact ? `진행할 업무 ${summary.total}개${summary.total > 4 ? ' · 먼저 4개 표시' : ''}` : `현재 분류 ${filtered.length}개`}</span><button type="button" className="task-text-button" disabled={!!busy || loading} onClick={() => setReload(value => value + 1)}>목록 새로고침</button></div>}
      {compact && summary.total > 0 && <TaskDueSummary tasks={currentTasks} date={date} state={loading ? 'loading' : loadError ? 'error' : 'ready'} disabled={navigationLocked} onOpenTasks={onOpenTasks} />}
      {loading ? <p className="task-loading" role="status">내 업무를 불러오는 중…</p> : loadError ? <div className="task-error" role="alert"><p>{loadError}</p><button type="button" className="task-secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></div> : <div className="task-list">{shown.length ? shown.map(task => <TaskCard key={task.id} id={id} task={task} date={date} compact={compact}
        highlighted={selectedTask?.id === task.id} locked={locked} editing={!!editor}
        onStatusChange={status => { void perform({ kind: 'status', taskId: task.id, status, expectedVersion: task.version }) }}
        onEdit={trigger => { void beginEdit(task, trigger) }} />) : <p className="task-empty">{emptyMessage}</p>}</div>}
      {!compact && !loading && !loadError && <ListPagination label="내 업무 목록 페이지" window={taskWindow} disabled={navigationLocked} onPageChange={changeListPage} />}
      {busy === 'opening' && <p role="status" className="task-loading">업무 원본을 확인하는 중…</p>}
      {compact && <div className={compactEmpty ? 'task-empty-actions' : undefined}>
        {onOpenTasks && <button type="button" className="task-text-button task-more" disabled={navigationLocked} onClick={() => onOpenTasks()}>모든 내 업무 보기</button>}
        <details className="task-home-help"><summary>개인 할 일 이용 안내</summary><p>개인 할 일과 메모를 정리합니다. 업무를 완료해도 수합 제출이나 학교 일정은 바뀌지 않습니다.</p>{compactEmpty && <button type="button" className="task-text-button" disabled={!!busy || loading} onClick={event => { event.currentTarget.closest('details')?.querySelector('summary')?.focus(); setReload(value => value + 1) }}>목록 새로고침</button>}</details>
      </div>}
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
