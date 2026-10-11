import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { WorkflowStore } from './store'
import { WorkflowError, type AnswerInput, type CollectionDraft, type CollectionInput, type CollectionRequest, type CollectionUnit, type PersonalTask, type TaskInput, type TaskStatus } from './types'
import './workflows.css'

interface Props { member: Membership; members: Membership[]; date: string; store: WorkflowStore }
const taskLabels: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }
const reviewLabels: Record<string, string> = { not_started: '미제출', not_required: '응답 완료 · 검토 없음', pending: '검토 대기', changes_requested: '보완 요청', accepted: '검토 완료' }
const numberValue = (value: string): number | null => value.trim() === '' ? null : Number(value)
function useVersion(store: WorkflowStore) { useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision) }
function useAction() {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const keys = useRef(new Map<string, string>())
  function run<T,>(operation: string, payload: unknown, action: (key: string) => T, message: string): T | undefined {
    const signature = `${operation}:${JSON.stringify(payload)}`
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID())
    try { const value = action(keys.current.get(signature)!); keys.current.delete(signature); setError(''); setNotice(message); return value }
    catch (failure) { setError(failure instanceof Error ? failure.message : '처리하지 못했습니다. 입력을 유지했습니다.'); setNotice(''); return undefined }
  }
  return { error, notice, run, clear: () => { setError(''); setNotice('') } }
}
function Feedback({ error, notice }: { error: string; notice: string }) { return <>{error && <p className="wf-error" role="alert">{error}</p>}{notice && <p className="wf-notice" role="status">{notice}</p>}</> }
function ReadError({ error }: { error: unknown }) { return <p className="wf-error" role="alert">{error instanceof Error ? error.message : '업무 자료를 읽지 못했습니다.'}</p> }

export function WorkflowPanel(props: Props & { page: 'tasks' | 'collections'; initialRequestId?: string }) {
  useVersion(props.store)
  return <section className="wf-panel" aria-label={props.page === 'tasks' ? '내 할 일 상세' : '수합 업무'}>
    <header className="wf-page-heading"><div><p className="wf-eyebrow">학교 안의 나의 업무</p><h2>{props.page === 'tasks' ? '내 할 일' : '함께 모으는 업무'}</h2><p>{props.page === 'tasks' ? '개인 메모와 할 일을 정리합니다. 수합 의무는 실제 제출 상태를 따릅니다.' : '글과 숫자를 바로 받아, 작성부터 보완·완료까지 한곳에서 확인합니다.'}</p></div></header>
    <p className="wf-scope">합성 자료 전용 · 현재 학교의 업무 · 기준일 {props.date}. 실제 개인·학생 정보를 입력하지 마세요.</p>
    {props.page === 'tasks' ? <Tasks {...props} /> : <Collections {...props} />}
  </section>
}

export function HomeWorkSummary(props: Props & { onOpenCollections?: (requestId?: string) => void; onOpenTasks?: () => void }) {
  useVersion(props.store)
  let summary: ReturnType<WorkflowStore['homeSummary']>
  try { summary = props.store.homeSummary(props.member.id) } catch (error) { return <ReadError error={error} /> }
  return <section className="wf-home" aria-label="오늘의 내 업무">
    <div className="wf-section-title"><h2>오늘 챙길 업무</h2><span>{summary.openTasks.length}개 할 일 · {summary.pendingObligations.length}건 수합</span></div>
    <Tasks {...props} compact onOpenTasks={props.onOpenTasks} />
    <div className="wf-home-obligations"><h3>내가 제출할 수합</h3>
      {summary.obligations.length === 0 ? <p className="wf-muted">현재 배정된 수합이 없습니다.</p> : summary.obligations.map(item => <div className="wf-obligation" key={item.unit.id}>
        <div><strong>{item.request.title}</strong>
          <span>{item.unit.label} · {item.request.dueDate}까지 · {item.pendingSupplements.length ? '보완 제출 필요' : reviewLabels[item.reviewState]}</span>
          {item.effective && <small>완료본 v{item.effective.revision}{item.current?.id !== item.effective.id ? ' · 새 판 처리 중' : ''}</small>}
          {item.pendingSupplements.length > 0 && <small className="wf-warning">남은 보완 {item.pendingSupplements.length}건 · {item.pendingSupplements[0].dueDate}까지{item.supplementOverdue ? ' · 보완 기한 초과' : ''}</small>}
        </div>
        <button type="button" className="secondary small" onClick={() => props.onOpenCollections?.(item.request.id)}>수합 원본 보기</button>
      </div>)}
    </div>
    <p className="wf-hint">수합 카드는 체크로 완료하지 않습니다. 완료본이 있어도 남은 보완 요청은 해야 할 업무로 표시합니다.</p>
  </section>
}

function Tasks({ member, date, store, compact = false, onOpenTasks }: Props & { compact?: boolean; onOpenTasks?: () => void }) {
  useVersion(store)
  const [input, setInput] = useState<TaskInput>({ title: '', notes: '', dueDate: '' })
  const [editing, setEditing] = useState<PersonalTask>()
  const action = useAction()
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

function Collections(props: Props & { initialRequestId?: string }) {
  const { member, store } = props
  const [selection, setSelection] = useState<string | undefined>(props.initialRequestId)
  const [editor, setEditor] = useState<{ original?: CollectionRequest }>()
  const [tab, setTab] = useState<'received' | 'sent'>('received')
  useEffect(() => { if (props.initialRequestId) setSelection(props.initialRequestId) }, [props.initialRequestId])
  let requests: CollectionRequest[]
  try { requests = store.listCollections(member.id) } catch (error) { return <ReadError error={error} /> }
  const shown = requests.filter(request => tab === 'sent' ? request.managerMemberId === member.id : request.status === 'published' && (request.reviewerMemberId === member.id || store.listUnits(member.id, request.id).some(unit => unit.members.some(value => value.id === member.id))))
  const selected = requests.find(request => request.id === selection)
  return <><div className="wf-collection-toolbar"><div className="wf-tabs" aria-label="수합 목록 분류"><button aria-pressed={tab === 'received'} onClick={() => { setTab('received'); setSelection(undefined) }}>받은 수합</button><button aria-pressed={tab === 'sent'} onClick={() => { setTab('sent'); setSelection(undefined) }}>내가 만든 수합</button></div><button className="primary" onClick={() => setEditor({})}>+ 수합 만들기</button></div><p className="wf-hint">현재 글·숫자 응답만 지원합니다. 파일 업로드·외부 결재·공식 처리는 연결되지 않았습니다.</p>{editor ? <CollectionForm {...props} original={editor.original} onCancel={() => setEditor(undefined)} onSaved={request => { setEditor(undefined); setSelection(request.id); setTab('sent') }} /> : <div className="wf-collection-layout"><div className="wf-request-list">{shown.length === 0 ? <p className="wf-empty">{tab === 'sent' ? '수합을 만들어 문항과 대상을 정해 보세요.' : '현재 열람할 수 있는 수합이 없습니다.'}</p> : shown.map(request => <button className="wf-request-card" aria-pressed={selection === request.id} key={request.id} onClick={() => setSelection(request.id)}><span className="wf-badge">{request.status === 'draft' ? '작성 중 · 비공개' : request.reviewMode === 'none' ? '검토 없이 응답 완료' : '제출 후 검토'}</span><strong>{request.title}</strong><small>{request.dueDate}까지 · v{request.version}</small></button>)}</div><div className="wf-request-detail">{selected ? <RequestDetail {...props} key={selected.id} request={selected} onEdit={() => setEditor({ original: selected })} /> : <div className="wf-empty"><h3>수합의 원본을 선택해 주세요</h3><p>문항, 내 제출 단위, 접수증과 완료본을 함께 확인합니다.</p></div>}</div></div>}</>
}

function CollectionForm({ member, members, date, store, original, onCancel, onSaved }: Props & { original?: CollectionRequest; onCancel: () => void; onSaved: (request: CollectionRequest) => void }) {
  const [input, setInput] = useState<CollectionInput>(() => original ? structuredClone(original) : { title: '', instructions: '', dueDate: date, reviewMode: 'none', reviewerMemberId: '', textLabel: '안내 및 참고 사항', textRequired: false, numberLabel: '필요 수량', numberRequired: true, units: [{ label: '내 제출 단위', responsibleMemberId: member.id, contributorMemberIds: [] }] })
  const [version, setVersion] = useState(original?.version)
  const action = useAction()
  const options = members.filter(value => value.schoolId === member.schoolId && activeAt(value, date))
  function change<K extends keyof CollectionInput>(key: K, value: CollectionInput[K]) { setInput(current => ({ ...current, [key]: value })) }
  function save(event: FormEvent) {
    event.preventDefault()
    const request = action.run('collection-form', { id: original?.id, input, version }, key => original ? store.updateCollection(member.id, original.id, input, version!, key) : store.createCollection(member.id, input, key), '수합 초안을 저장했습니다.')
    if (request) onSaved(request)
  }
  return <form className="wf-editor" onSubmit={save} aria-label="수합 만들기 양식"><div className="wf-section-title"><h3>{original ? '수합 초안 수정' : '새 수합 만들기'}</h3><span>저장 후 대상을 확인하여 게시합니다</span></div><Feedback {...action} /><label>수합 제목<input required maxLength={120} value={input.title} onChange={event => change('title', event.target.value)} placeholder="예: 학급별 행사 준비 수량" /></label><label>목적·안내<textarea aria-label="목적·안내" rows={2} maxLength={3000} value={input.instructions} onChange={event => change('instructions', event.target.value)} /></label><div className="wf-form-row"><label className="wf-grow">마감일<input required type="date" value={input.dueDate} onChange={event => change('dueDate', event.target.value)} /></label><label className="wf-grow">검토 방식<select aria-label="검토 방식" value={input.reviewMode} onChange={event => change('reviewMode', event.target.value as 'none' | 'required')}><option value="none">검토 없이 제출 즉시 완료</option><option value="required">지정 교사가 검토 후 완료</option></select></label></div>{input.reviewMode === 'required' && <label>검토자<select aria-label="검토자" required value={input.reviewerMemberId} onChange={event => change('reviewerMemberId', event.target.value)}><option value="">검토자를 선택해 주세요</option>{options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select><span className="wf-hint">제출 책임자는 자기 제출을 검토할 수 없습니다.</span></label>}<fieldset className="wf-fieldset"><legend>응답 문항</legend><label>글 문항 (사용하지 않으면 비워 둠)<input maxLength={120} value={input.textLabel} onChange={event => { change('textLabel', event.target.value); if (!event.target.value) change('textRequired', false) }} /></label><label className="wf-checkbox"><input type="checkbox" checked={input.textRequired} disabled={!input.textLabel} onChange={event => change('textRequired', event.target.checked)} />글 응답 필수</label><label>숫자 문항 (사용하지 않으면 비워 둠)<input maxLength={120} value={input.numberLabel} onChange={event => { change('numberLabel', event.target.value); if (!event.target.value) change('numberRequired', false) }} /></label><label className="wf-checkbox"><input type="checkbox" checked={input.numberRequired} disabled={!input.numberLabel} onChange={event => change('numberRequired', event.target.checked)} />숫자 응답 필수 · 0도 유효한 응답</label></fieldset><fieldset className="wf-fieldset"><legend>제출 단위 · {input.units.length}부</legend><p className="wf-hint">공동 작성자가 여러 명이어도 단위당 한 부입니다. 게시할 때 책임자와 구성원을 고정합니다.</p>{input.units.map((unit, index) => <div className="wf-unit-input" key={index}><div className="wf-form-row"><label className="wf-grow">단위 {index + 1} 이름<input required maxLength={100} value={unit.label} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} /></label><label className="wf-grow">최종 제출 책임자<select aria-label={`단위 ${index + 1} 최종 제출 책임자`} value={unit.responsibleMemberId} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, responsibleMemberId: event.target.value } : value))}>{options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label></div><span className="wf-label">함께 초안을 작성할 교사</span><div className="wf-checks">{options.filter(option => option.id !== unit.responsibleMemberId).map(option => <label className="wf-checkbox" key={option.id}><input type="checkbox" checked={unit.contributorMemberIds.includes(option.id)} onChange={event => change('units', input.units.map((value, i) => i === index ? { ...value, contributorMemberIds: event.target.checked ? [...value.contributorMemberIds, option.id] : value.contributorMemberIds.filter(id => id !== option.id) } : value))} />{option.name}</label>)}</div>{input.units.length > 1 && <button className="text-button" type="button" onClick={() => change('units', input.units.filter((_, i) => i !== index))}>이 제출 단위 제거</button>}</div>)}<button type="button" className="secondary small" onClick={() => change('units', [...input.units, { label: `제출 단위 ${input.units.length + 1}`, responsibleMemberId: member.id, contributorMemberIds: [] }])}>+ 제출 단위 추가</button></fieldset>{original && action.error && <button type="button" className="text-button" onClick={() => { const latest = store.getCollection(member.id, original.id); setVersion(latest.version) }}>원본 v{store.getCollection(member.id, original.id).version} 다시 확인 · 입력 유지</button>}<div className="wf-actions"><button type="button" className="secondary" onClick={onCancel}>취소</button><button className="primary" type="submit">수합 초안 저장</button></div></form>
}

function RequestDetail(props: Props & { request: CollectionRequest; onEdit: () => void }) {
  const { member, store, request, onEdit } = props
  const action = useAction()
  const units = store.listUnits(member.id, request.id)
  const totals = store.collectionSummary(member.id, request.id)
  return <section>
    <div className="wf-detail-heading"><span className="wf-badge">{request.status === 'draft' ? '아직 게시하지 않음' : '게시됨 · 대상 고정'}</span><h3>{request.title}</h3><p className="wf-preserve">{request.instructions || '추가 안내 없음'}</p><p className="wf-hint">{request.dueDate}까지 · {request.reviewMode === 'none' ? '입력 검사 후 응답 완료, 사람 검토 없음' : '제출과 검토 완료를 따로 표시'} · 원본 v{request.version}</p></div>
    <Feedback {...action} />
    {request.status === 'draft' ? <div className="wf-warning">
      <h4>게시 전 대상 확인</h4><p>총 {request.units.length}개 제출 단위입니다. 게시하면 문항·책임자·구성원은 고정됩니다.</p>
      <ul>{request.units.map(unit => <li key={unit.label}>{unit.label} — 책임자 {props.members.find(value => value.id === unit.responsibleMemberId)?.name ?? '확인 필요'}, 공동 구성원 {new Set([unit.responsibleMemberId, ...unit.contributorMemberIds]).size}명</li>)}</ul>
      <div className="wf-actions"><button className="secondary" onClick={onEdit}>초안 수정</button><button className="primary" onClick={() => action.run('publish', { id: request.id, version: request.version }, key => store.publishCollection(member.id, request.id, request.version, key), '대상과 문항을 고정하여 게시했습니다.')}>대상 확인 · 게시</button></div>
    </div> : <>
      <div className="wf-progress"><span>열람 가능한 단위 <strong>{totals.totalUnits}부</strong></span><span>유효 제출 <strong>{totals.submittedUnits}부</strong></span><span>완료본 <strong>{totals.completedUnits}부</strong></span></div>
      {request.numberLabel && <p className="wf-hint">{request.numberLabel} 합계: <strong>{totals.numericTotal ?? '범위를 초과하여 계산할 수 없음'}</strong> · 완료본 중 숫자 응답 {totals.numberResponseUnits}부만 집계합니다.</p>}
      <div className="wf-unit-list">{units.map(unit => <UnitPanel {...props} key={unit.id} unit={unit} />)}</div>
    </>}
  </section>
}

function UnitPanel(props: Props & { request: CollectionRequest; unit: CollectionUnit }) {
  const { member, store, request, unit, date } = props
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [due, setDue] = useState(date)
  const action = useAction()
  const summary = store.unitSummary(member.id, unit.id)
  const submissions = store.getSubmissions(member.id, unit.id)
  const isContributor = unit.members.some(value => value.id === member.id)
  const isResponsible = unit.responsibleMemberId === member.id
  const isReviewer = request.reviewMode === 'required' && request.reviewerMemberId === member.id && !isResponsible
  const isManager = request.managerMemberId === member.id
  return <article className="wf-unit"><div className="wf-section-title"><h4>{unit.label}</h4><span className="wf-badge">{reviewLabels[summary.reviewState]}</span></div><p className="wf-hint">책임자 {unit.members.find(value => value.id === unit.responsibleMemberId)?.name} · 공동 구성원 {unit.members.map(value => value.name).join(', ')} · 단위 v{unit.version}</p><div className="wf-progress"><span>현재 제출 <strong>{summary.current ? `v${summary.current.revision}` : '없음'}</strong></span><span>완료본 <strong>{summary.effective ? `v${summary.effective.revision}` : '없음'}</strong></span></div><div className="wf-status-notes">{summary.initiallyLate && <span>최초 제출 지연</span>}{summary.currentlyOverdue && <span>현재 미제출 연체</span>}{summary.supplementOverdue && <span>보완 기한 초과</span>}</div><Feedback {...action} />{summary.current && <div className="wf-submitted"><h5>현재 제출 내용 · v{summary.current.revision}</h5>{request.textLabel && <p className="wf-preserve"><strong>{request.textLabel}</strong><br />{summary.current.text || '(미입력)'}</p>}{request.numberLabel && <p><strong>{request.numberLabel}</strong>: {summary.current.number ?? '(미입력)'}</p>}<p className="wf-hint">로컬 접수 {summary.current.receiptAt} · 제출 당시 마감 {summary.current.dueSnapshot}<br />{summary.current.reviewMode === 'none' ? '사람 검토 없이 입력 검사로 완료' : '제출 접수와 검토 완료는 다릅니다'}</p></div>}{summary.reviews.at(-1)?.note && <p className="wf-review-note">검토 의견: {summary.reviews.at(-1)?.note}</p>}{summary.supplements.some(value => !value.fulfilledSubmissionId) && <p className="wf-warning">보완 제출 기한: {summary.supplements.filter(value => !value.fulfilledSubmissionId).at(-1)?.dueDate}</p>}{isContributor ? <><button className="secondary small" onClick={() => setEditing(value => !value)}>{editing ? '초안 편집 접기' : summary.current ? '정정·보완 초안 작성' : '응답 초안 작성'}</button>{editing && <SubmissionEditor {...props} onSubmitted={() => setEditing(false)} />}</> : <p className="wf-hint">미제출 초안은 지정된 공동 작성자만 볼 수 있습니다.</p>}{isReviewer && summary.current && summary.reviewState === 'pending' && <form className="wf-review-form" onSubmit={event => { event.preventDefault(); action.run('accept', { id: unit.id, version: unit.version, submission: summary.current!.id, note }, key => store.review(member.id, unit.id, summary.current!.id, 'accepted', note, '', unit.version, key), '이 제출판을 검토 완료본으로 확정했습니다.') }}><label>검토 의견<textarea aria-label="검토 의견" maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} /></label><label>보완을 요청할 경우 기한<input type="date" min={date} value={due} onChange={event => setDue(event.target.value)} /></label><div className="wf-actions"><button className="secondary" type="button" onClick={() => action.run('changes', { id: unit.id, version: unit.version, submission: summary.current!.id, note, due }, key => store.review(member.id, unit.id, summary.current!.id, 'changes_requested', note, due, unit.version, key), '보완을 요청했습니다. 기존 완료본은 유지됩니다.')}>보완 요청</button><button className="primary" type="submit">이 버전 검토 완료</button></div></form>}{isResponsible && summary.current && summary.reviewState !== 'accepted' && <details className="wf-secondary-action"><summary>현재 제출 철회</summary><label>철회 사유<input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label><button className="secondary small" onClick={() => action.run('withdraw', { id: unit.id, version: unit.version, note }, key => store.withdraw(member.id, unit.id, unit.version, note, key), '현재 제출을 철회했습니다. 완료본과 미제출 여부를 다시 계산했습니다.')}>사유 확인 · 철회</button></details>}{isManager && <details className="wf-secondary-action"><summary>마감 후 정정·철회 기간 열기</summary><label>허용 종료일<input type="date" min={date} value={due} onChange={event => setDue(event.target.value)} /></label><label>허용 사유<input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label><button className="secondary small" onClick={() => action.run('open-correction', { id: unit.id, version: unit.version, due, note }, key => store.openCorrection(member.id, unit.id, due, note, unit.version, key), '이 단위의 정정·철회 기간을 열었습니다.')}>이 단위에만 적용</button></details>}{submissions.length > 0 && <details className="wf-history"><summary>제출 이력 · {submissions.length}판</summary>{submissions.map(submission => <div key={submission.id}><strong>v{submission.revision} {unit.withdrawnSubmissionIds.includes(submission.id) ? '· 철회됨' : unit.effectiveSubmissionId === submission.id ? '· 현재 완료본' : ''}</strong><p className="wf-hint">{submission.receiptAt} · 당시 마감 {submission.dueSnapshot}</p>{submission.correctionReason && <p>정정 사유: {submission.correctionReason}</p>}<p className="wf-preserve">{request.textLabel && `${request.textLabel}: ${submission.text || '(미입력)'}`}</p>{request.numberLabel && <p>{request.numberLabel}: {submission.number ?? '(미입력)'}</p>}</div>)}</details>}</article>
}

function SubmissionEditor({ member, store, request, unit, onSubmitted }: Props & { request: CollectionRequest; unit: CollectionUnit; onSubmitted: () => void }) {
  const [saved, setSaved] = useState<CollectionDraft | null>(() => store.getDraft(member.id, unit.id))
  const [input, setInput] = useState<AnswerInput>(() => ({ text: saved?.text ?? '', number: saved?.number ?? null }))
  const [rawNumber, setRawNumber] = useState(saved?.number === null || saved?.number === undefined ? '' : String(saved.number))
  const [reason, setReason] = useState('')
  const action = useAction()
  const latest = store.getDraft(member.id, unit.id)
  const history = store.getSubmissions(member.id, unit.id)
  const dirty = !saved || input.text !== saved.text || input.number !== saved.number
  const stale = (latest?.version ?? 0) !== (saved?.version ?? 0)
  const responsible = unit.responsibleMemberId === member.id
  function save(event: FormEvent) { event.preventDefault(); const result = action.run('draft', { unitId: unit.id, input, version: saved?.version ?? 0 }, key => store.saveDraft(member.id, unit.id, input, saved?.version ?? 0, key), '공동 초안을 저장했습니다. 아직 제출한 것은 아닙니다.'); if (result) setSaved(result) }
  return <form className="wf-response-form" onSubmit={save} aria-label={`${unit.label} 응답 초안`}><h5>공동 초안 · 지정 구성원만 열람</h5><Feedback {...action} />{request.textLabel && <label>{request.textLabel}{request.textRequired ? ' (제출 시 필수)' : ''}<textarea aria-label={request.textLabel} aria-required={request.textRequired} rows={3} maxLength={5000} value={input.text} onChange={event => setInput({ ...input, text: event.target.value })} /></label>}{request.numberLabel && <label>{request.numberLabel}{request.numberRequired ? ' (제출 시 필수)' : ''}<input aria-label={request.numberLabel} aria-required={request.numberRequired} type="number" step="any" value={rawNumber} onChange={event => { setRawNumber(event.target.value); setInput({ ...input, number: numberValue(event.target.value) }) }} /></label>}{history.length > 0 && <label>정정·보완 사유 (재제출 필수)<textarea aria-label="정정·보완 사유" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>}{stale && <div className="wf-warning"><p>다른 작성자가 초안 v{latest?.version ?? 0}을 저장했습니다.</p><p className="wf-preserve">최신 글: {latest?.text || '(미입력)'}<br />최신 숫자: {latest?.number ?? '(미입력)'}</p><button type="button" className="secondary small" onClick={() => setSaved(latest)}>최신 내용 확인 · 내 입력 유지</button></div>}<div className="wf-actions"><button type="submit" className="secondary">초안 저장</button>{responsible && <button className="primary" type="button" disabled={dirty || stale} onClick={() => { const result = action.run('submit', { unitId: unit.id, draftVersion: saved!.version, version: unit.version, reason }, key => store.submit(member.id, unit.id, saved!.version, unit.version, key, reason), '제출판과 로컬 접수증을 저장했습니다.'); if (result) onSubmitted() }}>{history.length ? '새 버전 제출' : '최종 제출'}</button>}</div><p className="wf-hint">{responsible ? dirty ? '변경한 초안을 저장한 뒤 최종 제출하세요.' : '저장된 초안을 불변 제출판으로 접수합니다.' : '공동 작성자는 초안을 편집합니다. 최종 제출은 책임자가 진행합니다.'}</p></form>
}
