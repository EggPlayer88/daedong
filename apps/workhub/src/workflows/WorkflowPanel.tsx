import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { WorkflowStore } from './store'
import { WorkflowError, type AnswerInput, type CollectionDraft, type CollectionInput, type CollectionRequest, type CollectionUnit, type PersonalTask, type TaskInput, type TaskStatus } from './types'
import './workflows.css'
import homeSummaryStyles from './home-summary.css?inline'
import { useEditSession } from '../app/EditSession'
import { collectionCategoryLabels, collectionHomeSummary, collectionRoleLabels, type CollectionHomeCategory, type CollectionHomeSummary } from './presentation'
import { CollectionWorkbench } from './CollectionWorkbench'
import { collectionWorkbench, filterCollectionRequests, type CollectionRequestFilter } from './collection-workbench'
import { collectionEntryGuide, collectionUnitLimit, responseEntryGuide } from './entry-guide'
import { CollectionRequestPreview, EntryChecklist, EntryIssues } from './CollectionEntryGuide'
import { LIST_PAGE_SIZE, listWindow } from '../app/list-window'
import { ListPagination } from '../app/ListPagination'
import type { CollectionFileRepository, FilePolicy } from '../files/contracts'
import { FileSelection, FileDownloads } from '../files/FileControls'
import { CollectionFileExport } from './CollectionFileExport'

interface Props { member: Membership; members: Membership[]; date: string; store: WorkflowStore; files?: CollectionFileRepository; filePolicy?: FilePolicy }
const taskLabels: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }
const reviewLabels: Record<string, string> = { not_started: '미제출', not_required: '응답 완료 · 검토 없음', pending: '검토 대기', changes_requested: '보완 요청', accepted: '검토 완료' }
const numberValue = (value: string): number | null => value.trim() === '' ? null : Number(value)
function useVersion(store: WorkflowStore) { useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision) }
function useAction() {
  const [error, setError] = useState('')
  const [errorAttempt, setErrorAttempt] = useState(0)
  const errorId = useId()
  const [notice, setNotice] = useState('')
  const keys = useRef(new Map<string, string>())
  function run<T,>(operation: string, payload: unknown, action: (key: string) => T, message: string): T | undefined {
    const signature = `${operation}:${JSON.stringify(payload)}`
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID())
    try { const value = action(keys.current.get(signature)!); keys.current.delete(signature); setError(''); setNotice(message); return value }
    catch (failure) { setError(failure instanceof Error ? failure.message : '처리하지 못했습니다. 입력을 유지했습니다.'); setErrorAttempt(value => value + 1); setNotice(''); return undefined }
  }
  return { error, errorId, errorAttempt, notice, run, clear: () => { setError(''); setNotice('') } }
}
function Feedback({ error, notice, errorId, errorAttempt }: { error: string; notice: string; errorId?: string; errorAttempt?: number }) {
  const target = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) target.current?.focus() }, [error, errorAttempt])
  return <>{error && <p ref={target} id={errorId} tabIndex={-1} className="wf-error" role="alert">{error}</p>}{notice && <p className="wf-notice" role="status" aria-atomic="true">{notice}</p>}</>
}
function ReadError({ error }: { error: unknown }) { return <p className="wf-error" role="alert">{error instanceof Error ? error.message : '업무 자료를 읽지 못했습니다.'}</p> }

export function WorkflowPanel(props: Props & { page: 'tasks' | 'collections'; initialRequestId?: string; initialUnitId?: string }) {
  useVersion(props.store)
  return <section className="wf-panel" aria-label={props.page === 'tasks' ? '내 할 일 상세' : '수합 업무'}>
    <header className="wf-page-heading"><div><p className="wf-eyebrow">학교 안의 나의 업무</p><h2>{props.page === 'tasks' ? '내 할 일' : '함께 모으는 업무'}</h2><p>{props.page === 'tasks' ? '개인 메모와 할 일을 정리합니다. 수합 의무는 실제 제출 상태를 따릅니다.' : '양식과 응답을 모으고, 제출부터 보완·완료까지 확인합니다.'}</p></div></header>
    <p className="wf-scope">합성 자료 전용 · 현재 학교의 업무 · 기준일 {props.date}. 실제 개인·학생 정보를 입력하지 마세요.</p>
    {props.page === 'tasks' ? <Tasks {...props} /> : <Collections {...props} key={`${props.member.schoolId}:${props.member.id}`} />}
  </section>
}

export function HomeWorkSummary(props: Props & { onOpenCollections?: (requestId?: string, unitId?: string) => void; onOpenTasks?: () => void; includeTasks?: boolean }) {
  useVersion(props.store)
  const [, retry] = useState(0)
  const includeTasks = props.includeTasks !== false
  let summary: CollectionHomeSummary | undefined
  let failure: unknown
  try { summary = collectionHomeSummary(props.store, props.member, props.date) } catch (error) { failure = error }
  const shown = summary?.cards.slice(0, 4) ?? []
  const categories: CollectionHomeCategory[] = ['submit', 'review', 'contribute', 'waiting']
  return <section className="wf-home wf-home-compact" aria-label={includeTasks ? '오늘의 내 업무' : '오늘 처리할 수합'}>
    <style>{homeSummaryStyles}</style>
    <div className="wf-section-title wf-home-heading"><h2>{includeTasks ? '오늘 챙길 업무' : '오늘 처리할 수합'}</h2><span>{summary ? `처리할 ${summary.actionCount}건 · 검토 대기 ${summary.waitingCount}건` : '수합 현황 확인 안 됨'}</span></div>
    {includeTasks && <Tasks {...props} compact onOpenTasks={props.onOpenTasks} />}
    {!summary ? <div className="wf-summary-error"><ReadError error={failure} /><button type="button" className="secondary small" onClick={() => retry(value => value + 1)}>수합 현황 다시 확인</button><p className="wf-hint">조회 실패를 할 일 없음으로 표시하지 않습니다.</p></div> : <>
      <div className="wf-home-obligations">
        {summary.cards.length === 0 ? <p className="wf-muted">지금 처리하거나 검토를 기다리는 수합이 없습니다.</p> : categories.map(category => {
          const cards = shown.filter(card => card.category === category)
          return cards.length > 0 && <section className={`wf-home-group wf-home-${category}`} key={category} aria-label={collectionCategoryLabels[category]}>{cards.map(card => <article className="wf-obligation" key={card.unitId} data-collection-unit={card.unitId}>
            <div><span className={`wf-home-category${category === 'waiting' ? ' is-waiting' : ''}`}>{collectionCategoryLabels[category]}</span><strong>{card.title}</strong><span>{card.unitLabel}{!card.hasPendingSupplement && <> · {category === 'waiting' ? `제출 기한 ${card.dueDate}` : `${card.dueDate}까지`}{card.overdue ? ' · 기한 초과' : ''}</>}</span>
              {category === 'contribute' && <small>최종 제출은 책임자가 합니다.</small>}
              {card.effectiveRevision && <small>완료본 v{card.effectiveRevision}{card.currentRevision !== card.effectiveRevision ? ' · 새 판 처리 중' : ''}</small>}
              {card.hasPendingSupplement && <small className="wf-warning">보완 제출 필요 · 남은 보완 {card.pendingSupplementCount}건 · {card.dueDate}까지{card.overdue ? ' · 보완 기한 초과' : ''}</small>}
            </div>
            <button type="button" className="secondary small" disabled={!props.onOpenCollections} title="수합 원본 보기" aria-label={`${card.title} · ${card.unitLabel} · ${card.actionLabel}`} onClick={() => props.onOpenCollections?.(card.requestId, card.unitId)}>{card.actionLabel}</button>
          </article>)}</section>
        })}
      </div>
      {summary.cards.length > shown.length && <p className="wf-hint">총 {summary.cards.length}건 중 먼저 {shown.length}건 표시합니다. 나머지는 수합 전체에서 확인하세요.</p>}
      {props.onOpenCollections && <button type="button" className="text-button" onClick={() => props.onOpenCollections?.()}>수합 전체 보기</button>}
      {summary.cards.length > 0 && <details className="wf-home-details"><summary>역할별 현황</summary>
        <dl className="wf-role-counts">{categories.map(category => <div key={category}><dt>{collectionCategoryLabels[category]}</dt><dd>{summary!.counts[category]}건</dd></div>)}</dl>
        <ul className="wf-home-role-details">{shown.map(card => <li key={card.unitId}><strong>{card.title} · {card.unitLabel}</strong><span>{card.roles.map(role => collectionRoleLabels[role]).join(' · ')} · {card.statusLabel}</span></li>)}</ul>
        <p className="wf-hint">검토 대기는 새 제출이 필요한 할 일과 구분합니다. 완료본이 있어도 남은 보완 요청은 표시합니다. 수합은 원본 화면에서 제출하거나 검토합니다.</p>
      </details>}
    </>}
  </section>
}

function Tasks({ member, date, store, compact = false, onOpenTasks }: Props & { compact?: boolean; onOpenTasks?: () => void }) {
  useVersion(store)
  const [input, setInput] = useState<TaskInput>({ title: '', notes: '', dueDate: '' })
  const [editing, setEditing] = useState<PersonalTask>()
  const action = useAction()
  useEditSession(Boolean(editing || input.title || input.notes || input.dueDate))
  let tasks: PersonalTask[]
  try { tasks = store.listTasks(member.id) } catch (error) { return <ReadError error={error} /> }
  const shown = compact ? tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled').slice(0, 5) : tasks
  const latest = editing ? tasks.find(task => task.id === editing.id) : undefined
  function save(event: FormEvent) {
    event.preventDefault()
    const result = action.run(editing ? 'update-task' : 'create-task', { input, id: editing?.id, version: editing?.version }, key => editing ? store.updateTask(member.id, editing.id, input, editing.version, key) : store.createTask(member.id, input, key), editing ? '할 일을 수정했습니다.' : '내 할 일에 추가했습니다.')
    if (result) { setInput({ title: '', notes: '', dueDate: '' }); setEditing(undefined) }
  }
  return <div className="wf-tasks"><Feedback {...action} /><form className="wf-task-form" onSubmit={save} aria-label={editing ? '할 일 편집' : '할 일 추가'}><div className="wf-form-row"><label className="wf-grow">{editing ? '수정할 할 일' : '해야 할 일'}<input required maxLength={120} value={input.title} placeholder="예: 체험학습 안내 내용 확인" onChange={event => setInput({ ...input, title: event.target.value })} /></label><label className="wf-date">기한 (선택)<input type="date" value={input.dueDate} onChange={event => setInput({ ...input, dueDate: event.target.value })} /></label><button type="submit" className="primary">{editing ? '수정 저장' : '+ 추가'}</button></div>{(!compact || editing) && <label>나만 보는 메모<textarea aria-label="나만 보는 메모" maxLength={2000} rows={2} value={input.notes} onChange={event => setInput({ ...input, notes: event.target.value })} /></label>}{editing && <div className="wf-actions"><button className="secondary small" type="button" onClick={() => { setEditing(undefined); setInput({ title: '', notes: '', dueDate: '' }); action.clear() }}>편집 취소</button><span className="wf-hint">확인한 원본 v{editing.version}</span></div>}{editing && latest && latest.version !== editing.version && <div className="wf-warning"><p>최신 원본 v{latest.version}: {latest.title} / {latest.dueDate || '기한 없음'}</p><p className="wf-preserve">{latest.notes || '메모 없음'}</p><button className="secondary small" type="button" onClick={() => setEditing(latest)}>최신 내용 확인 · 내 입력 유지</button></div>}</form><div className="wf-task-list">{shown.length === 0 ? <p className="wf-empty">{compact ? '지금 진행할 개인 할 일이 없습니다.' : '첫 할 일을 추가해 보세요.'}</p> : shown.map(task => <article className={`wf-task ${task.status === 'done' ? 'is-done' : ''}`} key={task.id}><label className="wf-task-check"><input type="checkbox" checked={task.status === 'done'} disabled={task.status === 'cancelled'} aria-label={`${task.title} 완료`} onChange={event => action.run('task-status', { id: task.id, version: task.version, status: event.target.checked ? 'done' : 'todo' }, key => store.setTaskStatus(member.id, task.id, event.target.checked ? 'done' : 'todo', task.version, key), event.target.checked ? '완료로 표시했습니다.' : '할 일을 다시 열었습니다.')} /><span><strong>{task.title}</strong><small>{task.dueDate ? `${task.dueDate}까지${task.dueDate < date && !['done', 'cancelled'].includes(task.status) ? ' · 기한 지남' : ''}` : '기한 없음'} · {taskLabels[task.status]} · v{task.version}</small>{task.notes && <span className="wf-task-note">{task.notes}</span>}</span></label>{!compact && <div className="wf-task-tools"><label><span className="sr-only">{task.title} 상태</span><select aria-label={`${task.title} 상태`} value={task.status} onChange={event => action.run('task-status', { id: task.id, version: task.version, status: event.target.value }, key => store.setTaskStatus(member.id, task.id, event.target.value as TaskStatus, task.version, key), '할 일 상태를 변경했습니다.')}>{Object.entries(taskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="text-button" onClick={() => { setEditing(task); setInput({ title: task.title, notes: task.notes, dueDate: task.dueDate }); action.clear() }}>편집</button></div>}</article>)}</div>{compact && onOpenTasks && <button className="text-button" onClick={onOpenTasks}>모든 할 일 관리하기</button>}</div>
}

function Collections(props: Props & { initialRequestId?: string; initialUnitId?: string }) {
  const { member, store } = props
  const [selection, setSelection] = useState<string | undefined>(props.initialRequestId)
  const [targetUnit, setTargetUnit] = useState(props.initialUnitId)
  const [editor, setEditor] = useState<{ original?: CollectionRequest; fileMode?: boolean }>()
  const [tab, setTab] = useState<'received' | 'sent'>()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<CollectionRequestFilter>('all')
  const [requestPage, setRequestPage] = useState({ page: 0, anchorId: props.initialRequestId })
  const requestList = useRef<HTMLElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const createFileButton = useRef<HTMLButtonElement>(null)
  const requestQuery = useRef<HTMLInputElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const editorOrigin = useRef<'create' | 'create-file' | 'edit'>('create')
  const pendingFocus = useRef<'create' | 'create-file' | 'edit' | 'detail'>()
  useEffect(() => {
    if (editor || !pendingFocus.current) return
    const target = pendingFocus.current === 'create-file' ? createFileButton.current : pendingFocus.current === 'create' ? createButton.current
      : detail.current?.querySelector<HTMLElement>(pendingFocus.current === 'edit' ? '[data-wf-edit-request]' : '.wf-detail-heading h3')
    target?.focus(); pendingFocus.current = undefined
  }, [editor, selection])
  const requestChange = useEditSession(Boolean(editor))
  useEffect(() => { if (props.initialRequestId) { setSelection(props.initialRequestId); setTargetUnit(props.initialUnitId); setTab(undefined); setQuery(''); setStatus('all'); setRequestPage({ page: 0, anchorId: props.initialRequestId }) } }, [props.initialRequestId, props.initialUnitId])
  let requests: CollectionRequest[] = []
  let received: CollectionRequest[] = []
  let readFailure: unknown
  try {
    requests = store.listCollections(member.id)
    received = requests.filter(request => request.status === 'published' && (request.reviewerMemberId === member.id || store.listUnits(member.id, request.id).some(unit => unit.members.some(value => value.id === member.id))))
  } catch (error) { readFailure = error; requests = []; received = [] }
  const selected = requests.find(request => request.id === selection)
  // 원본 권한을 확인한 뒤 직접 연 요청이 실제로 속하는 목록을 선택한다.
  const activeTab = tab ?? (selected?.managerMemberId === member.id && !received.some(request => request.id === selected.id) ? 'sent' : 'received')
  const candidates = activeTab === 'sent' ? requests.filter(request => request.managerMemberId === member.id) : received
  const shown = filterCollectionRequests(candidates, query, status)
  const anchorIndex = requestPage.anchorId ? shown.findIndex(request => request.id === requestPage.anchorId) : -1
  const requestWindow = listWindow(shown, anchorIndex >= 0 ? Math.floor(anchorIndex / LIST_PAGE_SIZE) : requestPage.page)
  useEffect(() => {
    if (!readFailure && anchorIndex < 0 && requestPage.page !== requestWindow.page) setRequestPage({ page: requestWindow.page, anchorId: undefined })
  }, [readFailure, anchorIndex, requestPage.page, requestWindow.page])
  function resetRequestPage() { setRequestPage({ page: 0, anchorId: undefined }) }
  function chooseTab(value: 'received' | 'sent') { requestChange(() => { setTab(value); setSelection(undefined); setTargetUnit(undefined); setQuery(''); setStatus('all'); resetRequestPage() }) }
  if (readFailure) return <ReadError error={readFailure} />
  return <>
    <div className="wf-collection-toolbar"><div className="wf-tabs" aria-label="수합 목록 분류"><button aria-pressed={activeTab === 'received'} onClick={() => chooseTab('received')}>받은 수합</button><button aria-pressed={activeTab === 'sent'} onClick={() => chooseTab('sent')}>내가 만든 수합</button></div><div className="wf-actions">{props.files && props.filePolicy && <button ref={createFileButton} className="primary" onClick={() => requestChange(() => { editorOrigin.current = 'create-file'; setEditor({ fileMode: true }) })}>+ 파일 수합 만들기</button>}<button ref={createButton} className={props.files ? "secondary" : "primary"} onClick={() => requestChange(() => { editorOrigin.current = 'create'; setEditor({}) })}>+ 수합 만들기</button></div></div>
    <p className="wf-hint">{props.files && props.filePolicy ? '글·숫자 응답을 받거나 파일을 모을 수 있습니다. 파일형 수합은 현재 창의 미리보기이며 새로고침하면 사라집니다.' : '현재 글·숫자 응답만 지원합니다. 파일 보관소는 연결되지 않았습니다.'}</p>
    {editor ? <CollectionForm {...props} fileMode={editor.fileMode} original={editor.original} onCancel={() => { pendingFocus.current = editorOrigin.current; setEditor(undefined) }} onSaved={request => { pendingFocus.current = 'detail'; setEditor(undefined); setSelection(request.id); setTargetUnit(undefined); setTab('sent'); setQuery(''); setStatus('all'); setRequestPage({ page: 0, anchorId: request.id }) }} /> : <>
      <div className="wf-request-filters"><label className="wf-grow">수합 제목 찾기<input ref={requestQuery} type="search" maxLength={120} value={query} onChange={event => requestChange(() => { setQuery(event.target.value); resetRequestPage() })} placeholder="제목으로 수합을 찾으세요" /></label><label>수합 게시 상태<select aria-label="수합 게시 상태" value={status} onChange={event => requestChange(() => { setStatus(event.target.value as CollectionRequestFilter); resetRequestPage() })}><option value="all">모든 상태</option><option value="published">게시된 수합</option><option value="draft">작성 중 · 비공개</option></select></label>{(query || status !== 'all') && <button type="button" className="text-button" onClick={() => requestChange(() => { setQuery(''); setStatus('all'); resetRequestPage(); requestQuery.current?.focus() })}>수합 필터 초기화</button>}</div>
      <p className="wf-hint" role="status">{activeTab === 'sent' ? '내가 만든 수합' : '받은 수합'} {candidates.length}건 중 조건에 맞는 수합 {shown.length}건</p>
      <div className="wf-collection-layout"><div className="wf-request-column"><section ref={requestList} className="wf-request-list" tabIndex={-1} aria-label="수합 요청 목록">{shown.length === 0 ? <p className="wf-empty">{candidates.length > 0 ? '조건에 맞는 수합이 없습니다. 제목이나 게시 상태를 바꿔 보세요.' : activeTab === 'sent' ? '수합을 만들어 문항과 대상을 정해 보세요.' : '현재 열람할 수 있는 수합이 없습니다.'}</p> : requestWindow.items.map(request => <button className="wf-request-card" aria-pressed={selection === request.id} key={request.id} onClick={() => requestChange(() => { setSelection(request.id); setTargetUnit(undefined); setTab(activeTab) })}><span className="wf-badge">{request.status === 'draft' ? '작성 중 · 비공개' : request.reviewMode === 'none' ? '검토 없이 응답 완료' : '제출 후 검토'}</span><strong>{request.title}</strong><small>{request.dueDate}까지 · v{request.version}</small></button>)}</section><ListPagination label="수합 요청 목록 페이지" window={requestWindow} onPageChange={page => requestChange(() => { setRequestPage({ page, anchorId: undefined }); requestList.current?.focus() })} /></div>
        <div ref={detail} className="wf-request-detail">{selected ? <>{!shown.some(request => request.id === selected.id) && <p className="wf-hint">선택한 수합은 현재 목록 조건에 포함되지 않습니다. 확인 중인 원본은 그대로 유지합니다.</p>}<RequestDetail {...props} key={selected.id} request={selected} initialUnitId={targetUnit} onEdit={() => requestChange(() => { editorOrigin.current = 'edit'; setEditor({ original: selected }) })} /></> : <div className="wf-empty" role={selection ? 'alert' : undefined}><h3>{selection ? '요청한 수합을 확인할 수 없습니다' : '수합의 원본을 선택해 주세요'}</h3><p>{selection ? '현재 소속으로 열람할 수 있는 원본인지 확인해 주세요. 다른 수합을 대신 열지 않았습니다.' : '문항, 내 제출 단위, 접수증과 완료본을 함께 확인합니다.'}</p></div>}</div>
      </div>
    </>}
  </>
}

function CollectionForm({ member, members, date, store, files, filePolicy, fileMode, original, onCancel, onSaved }: Props & { fileMode?: boolean; original?: CollectionRequest; onCancel: () => void; onSaved: (request: CollectionRequest) => void }) {
  const [input, setInput] = useState<CollectionInput>(() => original ? structuredClone(original) : { title: '', instructions: '', dueDate: date, reviewMode: 'none', reviewerMemberId: '', textLabel: '안내 및 참고 사항', textRequired: false, numberLabel: '필요 수량', numberRequired: true, units: [{ label: '내 제출 단위', responsibleMemberId: member.id, contributorMemberIds: [] }], ...(fileMode && filePolicy ? { textLabel: '전달 사항', textRequired: false, numberLabel: '', numberRequired: false, fileCollection: { policy: structuredClone(filePolicy), required: true, templates: [] } } : {}) })
  const [fileBusy, setFileBusy] = useState(false)
  const [version, setVersion] = useState(original?.version)
  const [comparison, setComparison] = useState<CollectionRequest>()
  const comparisonTitle = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (comparison) comparisonTitle.current?.focus() }, [comparison])
  const formId = useId()
  const editorElement = useRef<HTMLFormElement>(null)
  const unitFocus = useRef<number>()
  useEffect(() => { editorElement.current?.querySelector<HTMLInputElement>('[data-wf-request-title]')?.focus() }, [])
  useEffect(() => {
    if (unitFocus.current === undefined) return
    editorElement.current?.querySelector<HTMLInputElement>(`[data-wf-unit-name="${unitFocus.current}"]`)?.focus(); unitFocus.current = undefined
  }, [input.units.length])
  const action = useAction()
  const options = members.filter(value => value.schoolId === member.schoolId && activeAt(value, date))
  const guide = collectionEntryGuide(input, members, member.schoolId, date)
  function change<K extends keyof CollectionInput>(key: K, value: CollectionInput[K]) { setInput(current => ({ ...current, [key]: value })) }
  function save(event: FormEvent) {
    event.preventDefault()
    if (fileBusy) return
    const request = action.run('collection-form', { id: original?.id, input, version }, key => original ? store.updateCollection(member.id, original.id, input, version!, key) : store.createCollection(member.id, input, key), '수합 초안을 저장했습니다.')
    if (request) onSaved(request)
  }
  return <form ref={editorElement} className="wf-editor" onSubmit={save} aria-label="수합 만들기 양식" aria-describedby={action.error ? action.errorId : undefined}>
    <div className="wf-section-title"><h3>{original ? '수합 초안 수정' : '새 수합 만들기'}</h3><span>초안 저장 → 대상·문항 확인 → 게시</span></div>
    <p className="wf-hint">초안은 나만 볼 수 있습니다. 저장한 뒤 대상과 문항을 확인하고 게시하면 지정한 교사가 응답할 수 있습니다.</p>
    <Feedback {...action} />
    <fieldset className="wf-fieldset"><legend>1. 무엇을 언제까지 받을까요?</legend>
      <label htmlFor={`${formId}-title`}>수합 제목<input id={`${formId}-title`} data-wf-request-title required maxLength={120} value={input.title} onChange={event => change('title', event.target.value)} placeholder="예: 학급별 행사 준비 수량" /></label>
      <label>목적·안내<textarea aria-label="목적·안내" rows={2} maxLength={3000} value={input.instructions} onChange={event => change('instructions', event.target.value)} placeholder="왜 받는지, 무엇을 확인해 작성하면 되는지 알려 주세요" /></label>
      <div className="wf-form-row"><label className="wf-grow">마감일<input required type="date" value={input.dueDate} onChange={event => change('dueDate', event.target.value)} /></label><label className="wf-grow">검토 방식<select aria-label="검토 방식" value={input.reviewMode} onChange={event => change('reviewMode', event.target.value as 'none' | 'required')}><option value="none">검토 없이 제출 즉시 완료</option><option value="required">지정 교사가 검토 후 완료</option></select></label></div>
      <p className="wf-hint">{input.reviewMode === 'none' ? '수량 조사처럼 검토가 필요하지 않으면 제출 즉시 완료로 집계합니다.' : '응답을 먼저 접수하고 지정한 교사가 확인한 판만 완료본으로 집계합니다.'}</p>
      {input.reviewMode === 'required' && <label>검토자<select aria-label="검토자" required value={input.reviewerMemberId} onChange={event => change('reviewerMemberId', event.target.value)}><option value="">검토자를 선택해 주세요</option>{options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select><span className="wf-hint">제출 책임자는 자기 제출을 검토할 수 없습니다. 공동 작성자는 검토자를 겸할 수 있습니다.</span></label>}
    </fieldset>
    <fieldset className="wf-fieldset"><legend>2. 어떤 응답을 받을까요?</legend>
      {input.fileCollection && <div className="wf-file-request-settings">
        <h4>파일로 받기</h4><p className="wf-hint">양식을 첨부하면 대상 교사가 내려받아 작성할 수 있습니다. 게시한 뒤에는 양식을 바꿀 수 없습니다.</p>
        <p className="wf-warning">파일형 수합과 파일은 현재 창에서만 보관합니다. 새로고침하면 초기화됩니다. 서버 저장·파일 검사는 연결 준비 중입니다.</p>
        {files ? <FileSelection repository={files} policy={input.fileCollection.policy} owner={{ schoolId: member.schoolId, memberId: member.id }} files={input.fileCollection.templates} onChange={templates => change('fileCollection', { ...input.fileCollection!, templates })} label="양식 파일" onBusyChange={setFileBusy} /> : <p role="alert" className="wf-error">파일 기능을 준비하지 못했습니다. 입력 내용은 그대로 두었습니다.</p>}
        <label className="wf-checkbox"><input type="checkbox" checked={input.fileCollection.required} onChange={event => change('fileCollection', { ...input.fileCollection!, required: event.target.checked })} />제출 파일 필수</label>
        <p className="wf-hint">아래 글·숫자 문항은 필요한 경우 함께 받을 수 있습니다.</p>
      </div>}
      <p className="wf-hint">글·숫자 중 필요한 문항만 남기세요. 필수 응답도 작성 중에는 비워 둔 채 초안을 저장할 수 있습니다.</p>
      <label>글 문항 (사용하지 않으면 비워 둠)<input maxLength={120} value={input.textLabel} onChange={event => { change('textLabel', event.target.value); if (!event.target.value.trim()) change('textRequired', false) }} /></label><label className="wf-checkbox"><input type="checkbox" checked={input.textRequired} disabled={!input.textLabel.trim()} onChange={event => change('textRequired', event.target.checked)} />글 응답 필수</label>
      <label>숫자 문항 (사용하지 않으면 비워 둠)<input maxLength={120} value={input.numberLabel} onChange={event => { change('numberLabel', event.target.value); if (!event.target.value.trim()) change('numberRequired', false) }} /></label><label className="wf-checkbox"><input type="checkbox" checked={input.numberRequired} disabled={!input.numberLabel.trim()} onChange={event => change('numberRequired', event.target.checked)} />숫자 응답 필수 · 0도 유효한 응답</label>
    </fieldset>
    <fieldset className="wf-fieldset"><legend>3. 누가 몇 부를 제출할까요?</legend><p className="wf-hint">현재 {input.units.length}개 제출 단위입니다. 학급·학년·교과처럼 한 부씩 받을 기준을 정하세요. 책임자는 최종 제출하고, 공동 작성자는 같은 초안을 함께 씁니다.</p>
      {input.units.map((unit, index) => <fieldset className="wf-unit-input" key={index}><legend id={`${formId}-unit-${index}-context`}>제출 단위 {index + 1}</legend><div className="wf-form-row"><label className="wf-grow" htmlFor={`${formId}-unit-${index}-name`}>단위 {index + 1} 이름<input id={`${formId}-unit-${index}-name`} data-wf-unit-name={index} required maxLength={100} value={unit.label} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} /></label><label className="wf-grow" htmlFor={`${formId}-unit-${index}-responsible`}>최종 제출 책임자<select id={`${formId}-unit-${index}-responsible`} aria-label={`단위 ${index + 1} 최종 제출 책임자`} value={unit.responsibleMemberId} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, responsibleMemberId: event.target.value } : value))}>{options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label></div>
        <span className="wf-label">함께 초안을 작성할 교사</span><div className="wf-checks">{options.filter(option => option.id !== unit.responsibleMemberId).map(option => <label className="wf-checkbox" key={option.id} htmlFor={`${formId}-unit-${index}-contributor-${option.id}`}><input id={`${formId}-unit-${index}-contributor-${option.id}`} aria-describedby={`${formId}-unit-${index}-context`} type="checkbox" checked={unit.contributorMemberIds.includes(option.id)} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, contributorMemberIds: event.target.checked ? [...value.contributorMemberIds, option.id] : value.contributorMemberIds.filter(id => id !== option.id) } : value))} />{option.name}</label>)}</div>{input.units.length > 1 && <button className="text-button" type="button" aria-describedby={`${formId}-unit-${index}-context`} onClick={() => { unitFocus.current = Math.min(index, input.units.length - 2); change('units', input.units.filter((_, i) => i !== index)) }}>이 제출 단위 제거</button>}
      </fieldset>)}
      <button type="button" className="secondary small" disabled={input.units.length >= collectionUnitLimit} onClick={() => { unitFocus.current = input.units.length; change('units', [...input.units, { label: `제출 단위 ${input.units.length + 1}`, responsibleMemberId: member.id, contributorMemberIds: [] }]) }}>+ 제출 단위 추가</button><p className="wf-hint">한 요청에 최대 {collectionUnitLimit}개 제출 단위를 설정할 수 있습니다.</p>
    </fieldset>
    <div className="wf-guide-grid"><EntryChecklist checks={guide.checks} label="저장 전 입력 확인" /><CollectionRequestPreview input={input} guide={guide} /></div>
    <EntryIssues guide={guide} /><p className="wf-hint">현재 입력을 정리한 미리보기입니다. 저장·게시할 때 대상과 최신 내용을 다시 확인합니다.</p>
    {original && action.error && <button type="button" className="text-button" onClick={() => { const latest = action.run('read-latest-request', { id: original.id }, () => store.getCollection(member.id, original.id), '최신 원본을 아래에 표시했습니다. 내 입력은 그대로입니다.'); if (latest) setComparison(latest) }}>최신 원본 비교 · 내 입력 유지</button>}
    {comparison && <section className="wf-version-comparison" aria-label="최신 수합 원본 비교"><h4 ref={comparisonTitle} tabIndex={-1}>최신 원본 v{comparison.version}</h4><CollectionRequestPreview input={comparison} guide={collectionEntryGuide(comparison, members, member.schoolId, date)} /><p className="wf-hint">위 입력은 내 내용입니다. 최신 원본과 비교한 뒤 내 입력으로 저장할지 결정하세요. 게시된 원본은 수정할 수 없습니다.</p><button type="button" className="secondary small" disabled={comparison.status !== 'draft'} onClick={() => setVersion(comparison.version)}>이 원본 확인 · 내 입력 유지</button><p className="wf-hint">저장 기준 원본 v{version}</p></section>}
    <div className="wf-actions"><button type="button" className="secondary" onClick={onCancel}>취소</button><button className="primary" type="submit" disabled={fileBusy}>수합 초안 저장</button></div>
  </form>
}

function RequestDetail(props: Props & { request: CollectionRequest; initialUnitId?: string; onEdit: () => void }) {
  const { member, store, request, onEdit } = props
  const heading = useRef<HTMLHeadingElement>(null)
  const action = useAction()
  const units = store.listUnits(member.id, request.id)
  const totals = store.collectionSummary(member.id, request.id)
  const progress = collectionWorkbench(store, member, request)
  const publishGuide = collectionEntryGuide(request, props.members, member.schoolId, props.date)
  const [targetUnit, setTargetUnit] = useState({ id: props.initialUnitId, sequence: 0 })
  const [unitPage, setUnitPage] = useState({ page: 0, anchorId: props.initialUnitId })
  const unitList = useRef<HTMLDivElement>(null)
  const requestChange = useEditSession()
  useEffect(() => {
    setTargetUnit(current => ({ id: props.initialUnitId, sequence: current.sequence + 1 }))
    setUnitPage({ page: 0, anchorId: props.initialUnitId })
  }, [props.initialUnitId])
  const missingTarget = useRef<HTMLParagraphElement>(null)
  const unitUnavailable = Boolean(targetUnit.id && !units.some(unit => unit.id === targetUnit.id))
  useEffect(() => { if (unitUnavailable) missingTarget.current?.focus() }, [unitUnavailable, targetUnit])
  const anchorIndex = unitPage.anchorId ? units.findIndex(unit => unit.id === unitPage.anchorId) : -1
  const unitWindow = listWindow(units, anchorIndex >= 0 ? Math.floor(anchorIndex / LIST_PAGE_SIZE) : unitPage.page)
  useEffect(() => {
    if (anchorIndex < 0 && unitPage.page !== unitWindow.page) setUnitPage({ page: unitWindow.page, anchorId: undefined })
  }, [anchorIndex, unitPage.page, unitWindow.page])
  function openUnit(id: string) {
    setTargetUnit(current => ({ id, sequence: current.sequence + 1 }))
    setUnitPage({ page: 0, anchorId: id })
  }
  return <section>
    <div className="wf-detail-heading"><span className="wf-badge">{request.status === 'draft' ? '아직 게시하지 않음' : '게시됨 · 대상 고정'}</span><h3 ref={heading} tabIndex={-1}>{request.title}</h3><p className="wf-preserve">{request.instructions || '추가 안내 없음'}</p><p className="wf-hint">{request.dueDate}까지 · {request.reviewMode === 'none' ? '입력 검사 후 응답 완료, 사람 검토 없음' : '제출과 검토 완료를 따로 표시'} · 원본 v{request.version}</p></div>
    <Feedback {...action} />
    {request.fileCollection && <div className="wf-file-request-guide"><p className="wf-warning">파일형 수합 체험 · 현재 창에만 보관하며 새로고침하면 초기화됩니다. 실제 서버에 제출하지 않습니다.</p><FileDownloads label="배부 양식" files={request.fileCollection.templates} read={(file, signal) => store.getTemplateFile(member.id, request.id, file.id, signal)} /></div>}
    {unitUnavailable && <p ref={missingTarget} tabIndex={-1} className="wf-warning wf-unit-unavailable" role="alert">요청한 제출 단위를 현재 확인할 수 없습니다. 다른 단위를 대신 선택하지 않았습니다.</p>}
    {request.status === 'draft' ? <div className="wf-publish-check">
      <h4>게시 전 대상 확인</h4><p>총 {request.units.length}개 제출 단위입니다. 게시하면 문항·책임자·구성원은 고정됩니다. 마감과 필수 문항, 검토 방식을 함께 확인해 주세요.</p>
      <div className="wf-guide-grid"><EntryChecklist checks={publishGuide.checks} label="게시 전 입력 확인" /><CollectionRequestPreview input={request} guide={publishGuide} beforePublish /></div>
      <EntryIssues guide={publishGuide} /><p className="wf-hint">저장된 초안을 기준으로 표시합니다. 게시할 때 최신 원본과 대상 소속을 다시 확인합니다.</p>
      <div className="wf-actions"><button data-wf-edit-request className="secondary" onClick={onEdit}>초안 수정</button><button className="primary" onClick={() => { const published = action.run('publish', { id: request.id, version: request.version }, key => store.publishCollection(member.id, request.id, request.version, key), '대상과 문항을 고정하여 게시했습니다.'); if (published) heading.current?.focus() }}>대상 확인 · 게시</button></div>
    </div> : <>
      <div className="wf-progress"><span>열람 가능한 단위 <strong>{totals.totalUnits}부</strong></span><span>유효 제출 <strong>{totals.submittedUnits}부</strong></span><span>완료본 <strong>{totals.completedUnits}부</strong></span></div>
      {request.numberLabel && <p className="wf-hint">{request.numberLabel} 합계: <strong>{totals.numericTotal ?? '범위를 초과하여 계산할 수 없음'}</strong> · 완료본 중 숫자 응답 {totals.numberResponseUnits}부만 집계합니다.</p>}
      {request.fileCollection && request.managerMemberId === member.id && <CollectionFileExport member={member} request={request} store={store} />}
      <CollectionWorkbench data={progress} selectedUnitId={targetUnit.id} onOpenUnit={openUnit} />
      <div ref={unitList} className="wf-unit-list" tabIndex={-1} aria-label="제출 단위 원본 목록">{unitWindow.items.map(unit => <UnitPanel {...props} key={unit.id} unit={unit} highlighted={unit.id === targetUnit.id} focusSequence={targetUnit.sequence} />)}</div>
      <ListPagination label="제출 단위 원본 페이지" window={unitWindow} onPageChange={page => requestChange(() => { setUnitPage({ page, anchorId: undefined }); setTargetUnit(current => ({ id: undefined, sequence: current.sequence + 1 })); unitList.current?.focus() })} />
    </>}
  </section>
}

function UnitPanel(props: Props & { request: CollectionRequest; unit: CollectionUnit; highlighted?: boolean; focusSequence?: number }) {
  const { member, store, request, unit, date } = props
  const target = useRef<HTMLElement>(null)
  const fieldId = useId()
  const responseToggle = useRef<HTMLButtonElement>(null)
  const closeResponse = () => { setEditing(false); responseToggle.current?.focus() }
  useEffect(() => { if (props.highlighted) { target.current?.focus(); target.current?.scrollIntoView?.({ block: 'center' }) } }, [props.highlighted, props.focusSequence])
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [note, setNote] = useState('')
  const [due, setDue] = useState(date)
  const action = useAction()
  useEditSession(Boolean(note))
  function runAction<T,>(operation: string, payload: unknown, execute: (key: string) => T, message: string) {
    const result = action.run(operation, payload, execute, message)
    if (result !== undefined) { setNote(''); target.current?.focus() }
    return result
  }
  const summary = store.unitSummary(member.id, unit.id)
  const submissions = store.getSubmissions(member.id, unit.id)
  const isContributor = unit.members.some(value => value.id === member.id)
  const isResponsible = unit.responsibleMemberId === member.id
  const isReviewer = request.reviewMode === 'required' && request.reviewerMemberId === member.id && !isResponsible
  const isManager = request.managerMemberId === member.id
  return <article ref={target} tabIndex={-1} className={`wf-unit${props.highlighted ? ' wf-unit-target' : ''}`} data-wf-unit-id={unit.id} aria-label={`${unit.label} 제출 단위`}>{props.highlighted && <p className="wf-target-mark">선택한 제출 단위</p>}<div className="wf-section-title"><h4 id={`${fieldId}-context`}>{unit.label}</h4><span className="wf-badge">{reviewLabels[summary.reviewState]}</span></div><p className="wf-hint">책임자 {unit.members.find(value => value.id === unit.responsibleMemberId)?.name} · 공동 구성원 {unit.members.map(value => value.name).join(', ')} · 단위 v{unit.version}</p><div className="wf-progress"><span>현재 제출 <strong>{summary.current ? `v${summary.current.revision}` : '없음'}</strong></span><span>완료본 <strong>{summary.effective ? `v${summary.effective.revision}` : '없음'}</strong></span></div><div className="wf-status-notes">{summary.initiallyLate && <span>최초 제출 지연</span>}{summary.currentlyOverdue && <span>현재 미제출 연체</span>}{summary.supplementOverdue && <span>보완 기한 초과</span>}</div><Feedback {...action} />{note && <button type="button" className="text-button" onClick={() => { setNote(''); target.current?.focus() }}>의견·사유 입력 취소</button>}{summary.current && <div className="wf-submitted"><h5>현재 제출 내용 · v{summary.current.revision}</h5>{request.textLabel && <p className="wf-preserve"><strong>{request.textLabel}</strong><br />{summary.current.text || '(미입력)'}</p>}{request.numberLabel && <p><strong>{request.numberLabel}</strong>: {summary.current.number ?? '(미입력)'}</p>}{request.fileCollection && <FileDownloads label={"현재 제출 파일 · v" + summary.current.revision} files={summary.current.files ?? []} read={(file, signal) => store.getSubmissionFile(member.id, unit.id, summary.current!.id, file.id, signal)} />}<p className="wf-hint">로컬 접수 {summary.current.receiptAt} · 제출 당시 마감 {summary.current.dueSnapshot}<br />{summary.current.reviewMode === 'none' ? '사람 검토 없이 입력 검사로 완료' : '제출 접수와 검토 완료는 다릅니다'}</p>{summary.supplements.filter(supplement => supplement.fulfilledSubmissionId === summary.current!.id).map(supplement => <p className="wf-hint" key={supplement.id}>보완 기한 {supplement.dueDate} · {summary.current!.receiptDate > supplement.dueDate ? '기한 후 제출' : '기한 내 제출'} · 접수 {summary.current!.receiptDate}</p>)}</div>}{summary.reviews.at(-1)?.note && <p className="wf-review-note">검토 의견: {summary.reviews.at(-1)?.note}</p>}{summary.pendingSupplements.length > 0 && <div className="wf-warning"><p>{`보완 제출 기한: ${summary.pendingSupplements[0].dueDate}${summary.pendingSupplements.length > 1 ? ' · 가장 빠른 기한' : ''}`}</p>{summary.pendingSupplements.length > 1 && <><p>남은 보완 요청 {summary.pendingSupplements.length}건 · 기한이 빠른 순서</p><ul>{summary.pendingSupplements.map(supplement => <li key={supplement.id}>{supplement.dueDate}까지</li>)}</ul></>}</div>}{isContributor ? <><button ref={responseToggle} className="secondary small" aria-expanded={editing} aria-controls={editing ? `${fieldId}-response` : undefined} onClick={() => editing ? closeResponse() : setEditing(true)}>{editing ? '편집 취소 · 닫기' : summary.current ? '정정·보완 초안 작성' : '응답 초안 작성'}</button>{editing && <SubmissionEditor {...props} formId={`${fieldId}-response`} contextId={`${fieldId}-context`} onSubmitted={closeResponse} />}</> : <p className="wf-hint">미제출 초안은 지정된 공동 작성자만 볼 수 있습니다.</p>}{isReviewer && summary.current && summary.reviewState === 'pending' && <form className="wf-review-form" aria-label={`${unit.label} 제출판 검토`} aria-describedby={action.error ? action.errorId : `${fieldId}-context`} onSubmit={event => { event.preventDefault(); runAction('accept', { id: unit.id, version: unit.version, submission: summary.current!.id, note }, key => store.review(member.id, unit.id, summary.current!.id, 'accepted', note, '', unit.version, key), '이 제출판을 검토 완료본으로 확정했습니다.') }}><label htmlFor={`${fieldId}-review`}>검토 의견<textarea id={`${fieldId}-review`} aria-describedby={`${fieldId}-context`} aria-label="검토 의견" maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} /></label><label htmlFor={`${fieldId}-review-due`}>보완을 요청할 경우 기한<input id={`${fieldId}-review-due`} aria-describedby={`${fieldId}-context`} type="date" min={date} value={due} onChange={event => setDue(event.target.value)} /></label><div className="wf-actions"><button className="secondary" type="button" onClick={() => runAction('changes', { id: unit.id, version: unit.version, submission: summary.current!.id, note, due }, key => store.review(member.id, unit.id, summary.current!.id, 'changes_requested', note, due, unit.version, key), '보완을 요청했습니다. 기존 완료본은 유지됩니다.')}>보완 요청</button><button className="primary" type="submit">이 버전 검토 완료</button></div></form>}{isResponsible && summary.current && summary.reviewState !== 'accepted' && <details className="wf-secondary-action"><summary>현재 제출 철회</summary><label htmlFor={`${fieldId}-withdraw-note`}>철회 사유<input id={`${fieldId}-withdraw-note`} aria-describedby={`${fieldId}-context`} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label><button className="secondary small" onClick={() => runAction('withdraw', { id: unit.id, version: unit.version, note }, key => store.withdraw(member.id, unit.id, unit.version, note, key), '현재 제출을 철회했습니다. 완료본과 미제출 여부를 다시 계산했습니다.')}>사유 확인 · 철회</button></details>}{isManager && <details className="wf-secondary-action"><summary>마감 후 정정·철회 기간 열기</summary><label htmlFor={`${fieldId}-correction-due`}>허용 종료일<input id={`${fieldId}-correction-due`} aria-describedby={`${fieldId}-context`} type="date" min={date} value={due} onChange={event => setDue(event.target.value)} /></label><label htmlFor={`${fieldId}-correction-note`}>허용 사유<input id={`${fieldId}-correction-note`} aria-describedby={`${fieldId}-context`} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label><button className="secondary small" onClick={() => runAction('open-correction', { id: unit.id, version: unit.version, due, note }, key => store.openCorrection(member.id, unit.id, due, note, unit.version, key), '이 단위의 정정·철회 기간을 열었습니다.')}>이 단위에만 적용</button></details>}{submissions.length > 0 && <details className="wf-history" onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>제출 이력 · {submissions.length}판</summary>{historyOpen && submissions.map(submission => <div key={submission.id}><strong>v{submission.revision} {unit.withdrawnSubmissionIds.includes(submission.id) ? '· 철회됨' : unit.effectiveSubmissionId === submission.id ? '· 현재 완료본' : ''}</strong><p className="wf-hint">{submission.receiptAt} · 당시 마감 {submission.dueSnapshot}</p>{submission.correctionReason && <p>정정 사유: {submission.correctionReason}</p>}<p className="wf-preserve">{request.textLabel && `${request.textLabel}: ${submission.text || '(미입력)'}`}</p>{request.numberLabel && <p>{request.numberLabel}: {submission.number ?? '(미입력)'}</p>}{request.fileCollection && <FileDownloads label={'제출 이력 파일 · v' + submission.revision} files={submission.files ?? []} read={(file, signal) => store.getSubmissionFile(member.id, unit.id, submission.id, file.id, signal)} />}</div>)}</details>}</article>
}

function SubmissionEditor({ member, store, files, request, unit, date, formId, contextId, onSubmitted }: Props & { request: CollectionRequest; unit: CollectionUnit; formId: string; contextId: string; onSubmitted: () => void }) {
  const formElement = useRef<HTMLFormElement>(null)
  useEffect(() => { formElement.current?.querySelector<HTMLElement>('textarea,input')?.focus() }, [])
  const [saved, setSaved] = useState<CollectionDraft | null>(() => store.getDraft(member.id, unit.id))
  const [input, setInput] = useState<AnswerInput>(() => ({ text: saved?.text ?? '', number: saved?.number ?? null, ...(request.fileCollection ? { files: structuredClone(saved?.files ?? []) } : {}) }))
  const [fileBusy, setFileBusy] = useState(false)
  const [filesConfirmed, setFilesConfirmed] = useState(false)
  const [rawNumber, setRawNumber] = useState(saved?.number === null || saved?.number === undefined ? '' : String(saved.number))
  const [invalidNumber, setInvalidNumber] = useState(false)
  const [reason, setReason] = useState('')
  const action = useAction()
  const latest = store.getDraft(member.id, unit.id)
  const history = store.getSubmissions(member.id, unit.id)
  const pendingSupplements = store.unitSummary(member.id, unit.id).pendingSupplements
  const dirty = !saved || input.text !== saved.text || input.number !== saved.number || invalidNumber || JSON.stringify(input.files ?? []) !== JSON.stringify(saved.files ?? [])
  const stale = (latest?.version ?? 0) !== (saved?.version ?? 0)
  const responsible = unit.responsibleMemberId === member.id
  const checks = responseEntryGuide(request, input, history.length > 0, reason)
  if (invalidNumber) checks.push({ label: '숫자 입력 형식', ready: false, detail: '입력 중인 숫자를 완성하거나 비워 주세요.' })
  const incomplete = checks.some(check => !check.ready) || Boolean(request.fileCollection && !filesConfirmed)
  useEditSession(dirty || stale || Boolean(reason) || fileBusy)
  function save(event: FormEvent) {
    event.preventDefault()
    if (invalidNumber || fileBusy) return
    const result = action.run('draft', { unitId: unit.id, input, version: saved?.version ?? 0 }, key => store.saveDraft(member.id, unit.id, input, saved?.version ?? 0, key), '공동 초안을 저장했습니다. 아직 제출한 것은 아닙니다.')
    if (result) { setSaved(result); setInput({ text: result.text, number: result.number, ...(request.fileCollection ? { files: result.files ?? [] } : {}) }); setFilesConfirmed(false); setRawNumber(result.number === null ? '' : String(result.number)); setInvalidNumber(false) }
  }
  return <form ref={formElement} id={formId} className="wf-response-form" onSubmit={save} aria-label={`${unit.label} 응답 초안`} aria-describedby={action.error ? action.errorId : `${formId}-help`}>
    <div className="wf-section-title"><h5>공동 초안 · 지정 구성원만 열람</h5><span>{responsible ? '내 역할: 최종 제출 책임자' : '내 역할: 공동 작성자'}</span></div>
    <p id={`${formId}-help`} className="wf-hint">{responsible ? '먼저 초안을 저장하고, 필수 응답을 확인한 뒤 최종 제출하세요.' : `초안까지 함께 작성합니다. 최종 제출은 ${unit.members.find(value => value.id === unit.responsibleMemberId)?.name ?? '책임자'} 교사가 합니다.`} 일부 문항이 비어 있어도 초안 저장은 가능합니다.</p>
    <Feedback {...action} />
    {request.textLabel && <label htmlFor={`${formId}-text`}>{request.textLabel}{request.textRequired ? ' (제출 시 필수)' : ' (선택)'}<textarea id={`${formId}-text`} aria-describedby={contextId} aria-label={request.textLabel} aria-required={request.textRequired} rows={3} maxLength={5000} value={input.text} onChange={event => setInput({ ...input, text: event.target.value })} /></label>}
    {request.numberLabel && <label htmlFor={`${formId}-number`}>{request.numberLabel}{request.numberRequired ? ' (제출 시 필수)' : ' (선택)'}<input id={`${formId}-number`} aria-describedby={`${contextId} ${formId}-number-help`} aria-label={request.numberLabel} aria-required={request.numberRequired} aria-invalid={invalidNumber || undefined} type="number" step="any" value={rawNumber} onInput={event => setInvalidNumber(event.currentTarget.validity.badInput)} onChange={event => { setRawNumber(event.target.value); setInvalidNumber(event.target.validity.badInput); setInput({ ...input, number: numberValue(event.target.value) }) }} /><span id={`${formId}-number-help`} className="wf-hint">{invalidNumber ? '입력 중인 숫자를 완성하거나 비워 주세요. ' : ''}0은 응답값이며 빈칸과 다릅니다.</span></label>}
    {request.fileCollection && <div className="wf-file-response">
      {files ? <FileSelection repository={files} policy={request.fileCollection.policy} owner={{ schoolId: member.schoolId, memberId: member.id }} readScope={{ schoolId: member.schoolId, memberIds: unit.members.map(value => value.id) }} files={input.files ?? []} onChange={next => { setInput(current => ({ ...current, files: next })); setFilesConfirmed(false) }} label="제출 파일" onBusyChange={setFileBusy} /> : <p className="wf-error" role="alert">파일 기능을 준비하지 못했습니다. 입력은 유지했습니다.</p>}
      {saved && !dirty && <FileDownloads label="저장한 초안 파일" files={saved.files ?? []} read={(file, signal) => store.getDraftFile(member.id, unit.id, file.id, signal)} />}
      {responsible && <label className="wf-checkbox"><input type="checkbox" checked={filesConfirmed && !dirty && !stale && !fileBusy} disabled={dirty || stale || fileBusy} onChange={event => setFilesConfirmed(event.target.checked)} />저장한 파일 목록과 내용을 확인했습니다</label>}
      <p className="wf-hint">파일 선택 → 초안 저장 → 파일 확인 → 최종 제출 순서입니다. 선택과 초안 저장만으로 제출되지 않습니다.</p>
    </div>}
    {history.length > 0 && <label htmlFor={`${formId}-reason`}>정정·보완 사유 (재제출 필수)<textarea id={`${formId}-reason`} aria-describedby={contextId} aria-required="true" aria-label="정정·보완 사유" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>}
    <EntryChecklist checks={checks} label="최종 제출 전 확인" />
    <p className="wf-response-state" role="status" aria-atomic="true">{stale ? '공동 초안이 변경됐습니다. 최신 내용을 확인해 주세요.' : dirty ? '아직 저장하지 않은 입력이 있습니다.' : `공동 초안 v${saved?.version} 저장됨 · 최종 제출 전입니다.`}</p>
    {history.length > 0 && date > request.dueDate && <p className="wf-hint">{pendingSupplements.length ? '미완료 보완 요청에 응답할 수 있습니다. 보완 기한이 지났으면 기한 후 제출로 표시합니다.' : unit.correctionUntil && date <= unit.correctionUntil ? `마감 후 정정 허용 기간: ${unit.correctionUntil}까지` : '마감일이 지났습니다. 새 버전 제출에는 요청 관리자의 정정 허용 기간이 필요합니다.'}</p>}
    {stale && <div className="wf-warning"><p>다른 작성자가 초안 v{latest?.version ?? 0}을 저장했습니다.</p><p className="wf-preserve">최신 글: {latest?.text || '(미입력)'}<br />최신 숫자: {latest?.number ?? '(미입력)'}</p>{request.fileCollection && <p>최신 파일: {(latest?.files ?? []).map(file => file.name).join(', ') || '(없음)'}</p>}<button type="button" className="secondary small" onClick={() => { setSaved(latest); setFilesConfirmed(false) }}>최신 내용 확인 · 내 입력 유지</button></div>}
    <div className="wf-actions"><button type="submit" className="secondary" disabled={fileBusy}>초안 저장</button>{responsible && <button className="primary" type="button" disabled={dirty || stale || incomplete || fileBusy} onClick={() => { const result = action.run('submit', { unitId: unit.id, draftVersion: saved!.version, version: unit.version, reason }, key => store.submit(member.id, unit.id, saved!.version, unit.version, key, reason), request.reviewMode === 'required' ? '제출했습니다. 지정 교사의 검토를 기다립니다.' : '제출하여 응답 완료로 접수했습니다.'); if (result) onSubmitted() }}>{history.length ? '새 버전 제출' : '최종 제출'}</button>}</div>
    <p className="wf-hint">{responsible ? stale ? '최신 공동 초안을 확인한 뒤 저장과 제출을 진행해 주세요.' : dirty ? '변경한 초안을 저장한 뒤 최종 제출하세요.' : incomplete ? request.fileCollection ? '필수 응답·사유를 채우고 저장한 파일 확인에 체크해 주세요.' : '확인 필요로 표시된 필수 응답·사유를 채워 주세요.' : request.reviewMode === 'required' ? '최종 제출하면 접수되고, 지정 교사의 검토가 끝나면 완료본이 됩니다.' : '최종 제출하면 응답 완료로 집계됩니다.' : '공동 작성자는 초안을 편집합니다. 최종 제출은 책임자가 진행합니다.'}</p>
  </form>
}
