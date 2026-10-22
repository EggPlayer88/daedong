import { useEffect, useMemo, useState } from 'react'
import { fixtureData, relationLabels } from './fixtures'
import { createMemoryAdapter } from './memory-adapter'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { createDemoPersistence, type DemoPersistence } from './persistence'
import { createWorkflowStore } from '../workflows/store'
import { persistentWorkflowSnapshot } from '../workflows/file-persistence'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { createPreviewFileRepository, previewFixturePolicy } from '../files/preview-repository'
import { HomeWorkSummary, WorkflowPanel } from '../workflows/WorkflowPanel'
import { createStudentStore } from '../students/store'
import { StudentsPanel } from '../students/StudentsPanel'
import type { WorkflowSnapshot } from '../workflows/types'
import type { StudentSnapshot } from '../students/contracts'
import { WorkspaceShell } from '../app/WorkspaceShell'
import { ModuleBoundary } from '../app/ModuleBoundary'
import { EditSession } from '../app/EditSession'
import { useWorkspaceNavigation } from '../app/navigation'
import { enabledModules, type PageId } from '../modules'
import { TaskPanel } from '../tasks/TaskPanel'
import { createPreviewTaskAdapter } from './task-adapter'
import { WorkspaceSearch } from '../search/WorkspaceSearch'
import { calendarSearchSource, collectionSearchSource, taskSearchSource } from '../search/sources'
import { useResourceNavigation } from '../app/resource-navigation'
import './preview.css'
import { activeAt } from '../domain'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../app/pending-requests'

const previewPages = enabledModules('preview').map(module => module.id)

export function PreviewApp({ persistence = createDemoPersistence() }: { persistence?: DemoPersistence }) {
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  function createStores() {
    const calendar = createMemoryAdapter(fixtureData, 150, { snapshot: persistence.load('calendar'), onChange(snapshot) { persistence.save('calendar', snapshot); setRevision(value => value + 1) } })
    const current = calendar.info()
    const files = createPreviewFileRepository()
    return { calendar, files,
      workflows: createWorkflowStore({ files, members: current.memberships, date: current.basisDate, snapshot: persistence.load('workflows') as WorkflowSnapshot | undefined, onChange(snapshot) { persistence.save('workflows', persistentWorkflowSnapshot(snapshot)); setRevision(value => value + 1) } }),
      students: createStudentStore({ members: current.memberships, date: current.basisDate, snapshot: persistence.load('students') as StudentSnapshot | undefined, onChange(snapshot) { persistence.save('students', snapshot); setRevision(value => value + 1) } }),
    }
  }
  const [stores, setStores] = useState(createStores)
  const taskAdapter = useMemo(() => createPreviewTaskAdapter(stores.workflows), [stores.workflows])
  const [info, setInfo] = useState(stores.calendar.info)
  const [memberId, setMemberId] = useState(info.memberships[0].id)
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0)
  const [empty, setEmpty] = useState(false)
  const [taskLocked, setTaskLocked] = useState(false)
  const [calendarLocked, setCalendarLocked] = useState(false)
  const [draftLocked, setDraftLocked] = useState(false)
  const member = info.memberships.find(item => item.id === memberId)!
  const school = info.schools.find(item => item.id === member.schoolId)!
  const locked = taskLocked || calendarLocked || draftLocked
  const scopeKey = `${memberId}:${workspaceGeneration}:${member.active}`
  const pendingRequests = useMemo(createPendingRequests, [member.userId, workspaceGeneration])
  useEffect(() => {
    pendingRequests.retainScopes(info.memberships.filter(item => item.userId === member.userId && activeAt(item, info.basisDate)).map(recoveryScope))
  }, [info, member.userId, pendingRequests])
  const navigation = useWorkspaceNavigation({ allowedPages: previewPages, scopeKey, locked })
  const page = navigation.page as PageId
  const resource = useResourceNavigation(scopeKey, page, navigation.requestNavigate)
  const requested = resource.current
  const searchSources = useMemo(() => [calendarSearchSource(stores.calendar, member, info.basisDate), taskSearchSource(taskAdapter, member, info.basisDate), collectionSearchSource(stores.workflows, member, info.basisDate)], [stores, taskAdapter, member, info.basisDate])
  const storageLabel = persistence.persistent ? '합성 자료 · 일정·업무·글·숫자 수합은 이 브라우저에 저장 · 학생·활동 기록은 새로고침 시 초기화' : '합성 자료 · 임시 메모리 저장 (새로고침 시 초기화)'
  const pageStorageLabel = page === 'collections' ? '합성 자료 · 파일형 수합과 파일은 현재 창에서만 보관 (새로고침 시 초기화)' : page === 'students' ? '합성 자료 · 학생·활동 기록은 현재 창에서만 임시 보관 (새로고침 시 초기화)' : storageLabel
  function navigate(next: PageId) { if (resource.navigate(next)) setError('') }
  function selectMember(id: string) { navigation.requestAction(() => { resource.clear(); setMemberId(id); setError('') }) }
  function run(operation: () => void) { try { operation(); setError('') } catch (failure) { setError(failure instanceof Error ? failure.message : '개발 도구 실행에 실패했습니다.') } }
  function refreshContext() {
    const next = stores.calendar.info()
    stores.workflows.setContext({ members: next.memberships, date: next.basisDate })
    stores.students.setContext(next.memberships, next.basisDate)
    setInfo(next); setRevision(value => value + 1)
  }
  function reset() {
    persistence.replaceAll({})
    stores.calendar.cancelPending()
    stores.files.reset()
    const next = createStores()
    setStores(next); setInfo(next.calendar.info()); setRevision(value => value + 1)
    setEmpty(false); resource.clear(); setWorkspaceGeneration(value => value + 1)
  }
  const tools = <details className="developer-panel"><summary>개발 시험 도구 <span>학교·계정 전환 / 실패 상황</span></summary><p>합성 계정 선택은 실제 로그인이 아닙니다. 운영 서버의 권한은 별도 DB 회귀시험으로 검증합니다.</p><div className="developer-grid">
    <label>가상 학교<select disabled={locked} value={member.schoolId} onChange={event => { const next = info.memberships.find(item => item.schoolId === event.target.value && item.userId === member.userId) ?? info.memberships.find(item => item.schoolId === event.target.value)!; selectMember(next.id) }}>{info.schools.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label>가상 소속 계정<select disabled={locked} value={memberId} onChange={event => selectMember(event.target.value)}>{info.memberships.filter(item => item.schoolId === member.schoolId).map(item => <option value={item.id} key={item.id}>{item.name} · {item.role === 'calendar_manager' ? '일정 담당' : '교사'}{!item.active ? ' (종료)' : ''}</option>)}</select></label>
  </div><div className="button-row">
    <button className="secondary small" onClick={() => { stores.calendar.failNextQuery(); setRevision(value => value + 1) }}>다음 조회 실패</button>
    <button className="secondary small" onClick={() => stores.calendar.failNextSave()}>다음 저장 실패</button>
    <button className="secondary small" disabled={locked} aria-pressed={empty} onClick={() => navigation.requestAction(() => { stores.calendar.setEmpty(!empty); setEmpty(!empty); setRevision(value => value + 1) })}>{empty ? '자료 다시 표시' : '빈 목록 시험'}</button>
    <button className="secondary small" disabled={!member.active} onClick={() => run(() => { stores.calendar.endMembership(member.id); refreshContext() })}>현재 소속 종료</button>
    <button className="secondary small" disabled={locked} onClick={() => navigation.requestAction(() => run(reset))}>합성 자료 초기화</button>
  </div><p className="hint">실제 회원과 운영 DB는 이 도구로 변경되지 않습니다. 학생·활동 기록은 브라우저에 영구 저장하지 않고 이전 버전에서 저장한 학생 자료도 자동으로 열지 않습니다. 일정·업무·수합의 영속 저장이 가능한 환경은 한 창에서만 편집합니다.</p></details>
  return <PendingRequestsProvider store={pendingRequests}><WorkspaceShell mode="preview" page={page} onNavigate={navigate} schoolName={school.name} memberName={member.name} storageLabel={pageStorageLabel}
    locked={locked} notice={navigation.announcement} tools={tools}
    quickActions={<WorkspaceSearch key={`${scopeKey}:${page}`} scopeKey={scopeKey} sources={searchSources} locked={locked} onOpen={resource.openSearchItem} />}
    contextControls={<label>학교 선택<select disabled={locked} value={member.schoolId} onChange={event => { const next = info.memberships.find(item => item.schoolId === event.target.value && item.userId === member.userId) ?? info.memberships.find(item => item.schoolId === event.target.value)!; selectMember(next.id) }}>{info.schools.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}>
    {error && <div className="error-box preview-error" role="alert">{error}</div>}
    <EditSession key={scopeKey} onLockChange={setDraftLocked}>
      <ModuleBoundary moduleName={enabledModules('preview').find(module => module.id === page)?.title ?? '업무 화면'} resetKey={`${scopeKey}:${page}`}>
        {page === 'home' || page === 'calendar' ? <CalendarPanel key={scopeKey} member={member} members={info.memberships} schoolName={school.name} date={info.basisDate} adapter={stores.calendar} revision={revision} page={page} onPageChange={navigate} onNavigationLockChange={setCalendarLocked} demo relationOptions={relationLabels} storageLabel={storageLabel}
          openRequest={requested?.kind === 'calendar' && requested.id ? { key: requested.key, id: requested.id } : undefined}
          homeExtras={<ModuleBoundary moduleName="내 업무" resetKey={scopeKey}><TaskPanel member={member} date={info.basisDate} adapter={taskAdapter} revision={revision} compact onNavigationLockChange={setTaskLocked} onOpenTasks={resource.openTasks} /></ModuleBoundary>}
          homePriority={<ModuleBoundary moduleName="수합 요약" resetKey={scopeKey}><HomeWorkSummary member={member} members={info.memberships} date={info.basisDate} store={stores.workflows} includeTasks={false} onOpenCollections={resource.openCollection} /></ModuleBoundary>} /> :
          <main id="main-content" className="main-content">
            <header className="page-header"><div><p className="eyebrow">{school.name} · {info.basisDate} 기준</p><h1 tabIndex={-1}>{page === 'tasks' ? '내 업무' : page === 'collections' ? '자료 수합' : '수업과 학생'}</h1></div></header>
            <div className="basis-strip"><span className="small-tag">합성 자료</span><span>{pageStorageLabel}. 실제 학생·교사의 개인정보는 입력하지 마세요.</span></div>
            {page === 'students' ? <StudentsPanel member={member} members={info.memberships} date={info.basisDate} store={stores.students} /> : page === 'tasks' ? <TaskPanel member={member} date={info.basisDate} adapter={taskAdapter} revision={revision} onNavigationLockChange={setTaskLocked} openRequest={requested?.kind === 'task' ? { key: requested.key, taskId: requested.id, dueFilter: requested.dueFilter } : undefined} /> : <WorkflowPanel key={`${scopeKey}:${requested?.key ?? 'list'}`} member={member} members={info.memberships} date={info.basisDate} store={stores.workflows} files={stores.files} filePolicy={hwpxCollectionPolicy(previewFixturePolicy)} page="collections" initialRequestId={requested?.kind === 'collection' ? requested.id : undefined} initialUnitId={requested?.kind === 'collection' ? requested.unitId : undefined} />}
            <footer className="workspace-footer">{pageStorageLabel}<span>업무혁신시스템 · 로컬 계약 검증</span></footer>
          </main>}
      </ModuleBoundary>
    </EditSession>
  </WorkspaceShell></PendingRequestsProvider>
}
