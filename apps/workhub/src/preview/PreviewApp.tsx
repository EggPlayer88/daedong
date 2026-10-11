import { useState } from 'react'
import { fixtureData, relationLabels } from './fixtures'
import { createMemoryAdapter } from './memory-adapter'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { createDemoPersistence, type DemoPersistence } from './persistence'
import { createWorkflowStore } from '../workflows/store'
import { HomeWorkSummary, WorkflowPanel } from '../workflows/WorkflowPanel'
import { createStudentStore } from '../students/store'
import { StudentsPanel } from '../students/StudentsPanel'
import type { WorkflowSnapshot } from '../workflows/types'
import type { StudentSnapshot } from '../students/contracts'
import './preview.css'

type Page = 'home' | 'calendar' | 'tasks' | 'collections' | 'students'
const pages: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'home', label: '오늘', icon: '◷' },
  { id: 'calendar', label: '학교 일정', icon: '▦' },
  { id: 'tasks', label: '내 업무', icon: '✓' },
  { id: 'collections', label: '자료 수합', icon: '▤' },
  { id: 'students', label: '수업과 학생', icon: '◎' },
]

export function PreviewApp({ persistence = createDemoPersistence() }: { persistence?: DemoPersistence }) {
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  function createStores() {
    const calendar = createMemoryAdapter(fixtureData, 150, { snapshot: persistence.load('calendar'), onChange(snapshot) { persistence.save('calendar', snapshot); setRevision(value => value + 1) } })
    const current = calendar.info()
    return { calendar,
    workflows: createWorkflowStore({ members: current.memberships, date: current.basisDate, snapshot: persistence.load('workflows') as WorkflowSnapshot | undefined, onChange(snapshot) { persistence.save('workflows', snapshot); setRevision(value => value + 1) } }),
    students: createStudentStore({ members: current.memberships, date: current.basisDate, snapshot: persistence.load('students') as StudentSnapshot | undefined, onChange(snapshot) { persistence.save('students', snapshot); setRevision(value => value + 1) } }),
  }}
  const [stores, setStores] = useState(createStores)
  const [info, setInfo] = useState(stores.calendar.info)
  const [memberId, setMemberId] = useState(info.memberships[0].id)
  const [page, setPage] = useState<Page>('home')
  const [selectedRequest, setSelectedRequest] = useState<string>()
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0)
  const [empty, setEmpty] = useState(false)
  const member = info.memberships.find(item => item.id === memberId)!
  const school = info.schools.find(item => item.id === member.schoolId)!
  const storageLabel = persistence.persistent ? '합성 자료 · 이 브라우저에 저장' : '합성 자료 · 임시 메모리 저장 (새로고침 시 초기화)'
  function selectMember(id: string) { setMemberId(id); setPage('home'); setSelectedRequest(undefined); setError('') }
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
    const next = createStores()
    setStores(next); setInfo(next.calendar.info()); setRevision(value => value + 1)
    setEmpty(false); setPage('home'); setSelectedRequest(undefined); setWorkspaceGeneration(value => value + 1)
  }
  return <><a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <div className="preview-banner"><strong>로컬 개발 미리보기</strong><span>{persistence.persistent ? '모두 합성 자료입니다 · 새로고침 후에도 유지 · 실제 서비스 연결 없음' : '모두 합성 자료입니다 · 임시 메모리 · 실제 서비스 연결 없음'}</span></div>
    <div className="app-shell">
      <aside className="sidebar"><div className="brand"><span className="brand-mark">學</span><div><strong>하루를 잇는 학교</strong><span>업무혁신시스템</span></div></div><div className="school-tag"><span className="status-dot" />{school.name}<span className="small-tag">가상</span></div>
        <div className="sidebar-intro"><p>오늘의 일을 가볍게,<br /><strong>함께하는 일을 선명하게.</strong></p></div>
        <div className="sidebar-bottom"><span className="avatar">{member.name[0]}</span><div><strong>{member.name} 선생님</strong><small>{member.role === 'calendar_manager' ? '가상 일정 담당자' : '가상 교사'}{!member.active ? ' · 소속 종료' : ''}</small></div></div>
      </aside>
      <div className="workspace-wrap">
        <nav className="main-nav" aria-label="업무 메뉴">{pages.map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setSelectedRequest(undefined); setError('') }}><span className="menu-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}<span className="nav-note">일정에서 기록까지,<br />나의 업무를 한곳에서.</span></nav>
        {error && <div className="error-box preview-error" role="alert">{error}</div>}
        <div key={`${memberId}:${workspaceGeneration}`}>
          {page === 'home' || page === 'calendar' ? <CalendarPanel member={member} members={info.memberships} schoolName={school.name} date={info.basisDate} adapter={stores.calendar} revision={revision} page={page} onPageChange={setPage} demo relationOptions={relationLabels} storageLabel={storageLabel} homeExtras={<HomeWorkSummary member={member} members={info.memberships} date={info.basisDate} store={stores.workflows} onOpenTasks={() => setPage('tasks')} onOpenCollections={requestId => { setSelectedRequest(requestId); setPage('collections') }} />} /> : <main id="main-content" className="main-content">
            <header className="page-header"><div><p className="eyebrow">{school.name} · {info.basisDate} 기준</p><h1>{page === 'tasks' ? '내 업무' : page === 'collections' ? '자료 수합' : '수업과 학생'}</h1><p>{page === 'tasks' ? '기억해야 할 일은 내려놓고, 해야 할 일에 집중하세요.' : page === 'collections' ? '요청부터 제출과 확인까지, 한 흐름으로.' : '수업에서 확인한 사실을, 학생의 성장 기록으로.'}</p></div></header>
            <div className="basis-strip"><span className="small-tag">합성 자료</span><span>{storageLabel}. 실제 학생·교사의 개인정보는 입력하지 마세요.</span></div>
            {page === 'students' ? <StudentsPanel member={member} members={info.memberships} date={info.basisDate} store={stores.students} /> : <WorkflowPanel member={member} members={info.memberships} date={info.basisDate} store={stores.workflows} page={page} initialRequestId={selectedRequest} />}
            <footer className="workspace-footer">{storageLabel}<span>업무혁신시스템 · 로컬 계약 검증</span></footer>
          </main>}
        </div>
        <details className="developer-panel"><summary>개발 시험 도구 <span>학교·계정 전환 / 실패 상황</span></summary><p>합성 계정 선택은 실제 로그인이 아닙니다. 운영 서버의 권한은 별도 DB 회귀시험으로 검증합니다.</p><div className="developer-grid">
          <label>가상 학교<select value={member.schoolId} onChange={event => { const next = info.memberships.find(item => item.schoolId === event.target.value && item.userId === member.userId) ?? info.memberships.find(item => item.schoolId === event.target.value)!; selectMember(next.id) }}>{info.schools.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>가상 소속 계정<select value={memberId} onChange={event => selectMember(event.target.value)}>{info.memberships.filter(item => item.schoolId === member.schoolId).map(item => <option value={item.id} key={item.id}>{item.name} · {item.role === 'calendar_manager' ? '일정 담당' : '교사'}{!item.active ? ' (종료)' : ''}</option>)}</select></label>
        </div><div className="button-row">
          <button className="secondary small" onClick={() => { stores.calendar.failNextQuery(); setRevision(value => value + 1) }}>다음 조회 실패</button>
          <button className="secondary small" onClick={() => stores.calendar.failNextSave()}>다음 저장 실패</button>
          <button className="secondary small" aria-pressed={empty} onClick={() => { stores.calendar.setEmpty(!empty); setEmpty(!empty); setRevision(value => value + 1) }}>{empty ? '자료 다시 표시' : '빈 목록 시험'}</button>
          <button className="secondary small" disabled={!member.active} onClick={() => run(() => { stores.calendar.endMembership(member.id); refreshContext() })}>현재 소속 종료</button>
          <button className="secondary small" onClick={() => run(reset)}>합성 자료 초기화</button>
        </div><p className="hint">실제 회원과 운영 DB는 이 도구로 변경되지 않습니다. 영속 저장이 가능한 환경은 한 창에서만 편집하여 여러 창의 덮어쓰기를 방지합니다.</p></details>
      </div>
    </div>
  </>
}
