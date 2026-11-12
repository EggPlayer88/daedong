import { retryableLazy as lazy } from '../app/retryable-lazy'
import { Suspense, useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { SchoolAdminPanel } from '../setup/SchoolAdminPanel'
import { SchoolTransitions } from './SchoolTransitions'
import { SchoolRosterPanel } from '../setup/SchoolRosterPanel'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, useRecoveryStore } from '../app/pending-requests'
import type { WorkflowResultListener } from '../app/workflow-results'
import type { SchoolPreparationDestination } from '../setup/school-preparation-summary'
import styles from './school-administration-conversation.css?inline'

const TeacherRosterPanel = lazy(() => import('../teacher-roster/TeacherRosterPanel').then(module => ({ default: module.TeacherRosterPanel })))
const NeisWorkspace = lazy(() => import('../neis/NeisWorkspace').then(module => ({ default: module.NeisWorkspace })))
const SchoolAiSettingsPanel = lazy(() => import('../assistant/SchoolAiWorkspace').then(module => ({ default: module.SchoolAiWorkspace })))
const ParticipantAdministration = lazy(() => import('../participation/ParticipantAdministration').then(module => ({ default: module.ParticipantAdministration })))
const SchoolPreparationPanel = lazy(() => import('../setup/SchoolPreparationPanel').then(module => ({ default: module.SchoolPreparationPanel })))

const sections = [
  { id: 'teachers', label: '교사 명부·기본 시간표', process: '명부 선택 → 배정 확인 → 저장 또는 시간표 등록' },
  { id: 'neis', label: '나이스 학교 자료', process: '원본 조회 → 기존 일정과 비교 → 선택 반영' },
  { id: 'settings', label: '학교 구성·교사 담당', process: '학년도·담당 선택 → 변경 비교 → 확인 후 저장' },
  { id: 'roster', label: '가입 교사 연결', process: '연결 후보 선택 → 계정·소속 확인 → 연결' },
  { id: 'transitions', label: '업무 인계·새 학년도', process: '대상 선택 → 변경 영향 확인 → 요청·승인·인수' },
  { id: 'ai', label: '학교 AI 이용 설정', process: '현재 정책과 사용액 확인 → 필요한 설정 검토' },
] as const
export type SchoolAdministrationSection = typeof sections[number]['id']
type Props = {
  connection: SupabaseConnection; member: Membership; date: string; revision?: number
  onNavigationLockChange?: (locked: boolean) => void; onUpdated?: () => void
  onWorkflowResult?: WorkflowResultListener
  onOpenPreparation?: (destination: SchoolPreparationDestination) => void
  initialGuideOpen?: boolean; transitionOpen?: { key: string; id: string }
  presentation?: 'page' | 'assistant'; initialSection?: SchoolAdministrationSection
}

export function SchoolAdministration({ connection, member, date, revision = 0, onNavigationLockChange, onWorkflowResult, onUpdated, onOpenPreparation, initialGuideOpen = false, transitionOpen, presentation = 'page', initialSection = 'settings' }: Props) {
  const recovery = useRecoveryStore(), scope = recoveryScope(member)
  const settingsDraft = useEditDraft<unknown>(member, 'school-admin-editor')
  const rosterDraft = useEditDraft<unknown>(member, 'school-roster')
  const teachersDraft = useEditDraft<unknown>(member, 'teacher-roster-editor')
  const transitionDraft = useEditDraft<unknown>(member, 'school-transitions')
  // 연결 재조회로 화면이 다시 만들어져도 처음 요청한 메뉴보다 보관한 업무의 복구가 우선이다.
  // 명령과 요청 번호는 기존 저장소에 두고, 여기서는 복구할 화면만 선택한다.
  const [restoredSection] = useState<SchoolAdministrationSection | undefined>(() => {
    const requests = [['teachers', 'teacherRoster'], ['roster', 'schoolRoster'], ['settings', 'schoolAdmin'], ['transitions', 'handover'], ['neis', 'neis'], ['ai', 'assistantSchoolSettings']] as const
    const pending = requests.find(([, kind]) => recovery.get(scope, kind))
    if (pending) return pending[0]
    return teachersDraft.dirty ? 'teachers' : rosterDraft.dirty ? 'roster' : settingsDraft.dirty ? 'settings' : transitionDraft.dirty ? 'transitions' : undefined
  })
  const [tab, setTab] = useState<SchoolAdministrationSection>(restoredSection ?? (transitionOpen ? 'transitions' : initialSection))
  const [guideOpen, setGuideOpen] = useState(initialGuideOpen)
  const [participationOpen, setParticipationOpen] = useState(false)
  const [settingsLocked, setSettingsLocked] = useState(false), [transitionsLocked, setTransitionsLocked] = useState(false), [aiLocked, setAiLocked] = useState(false)
  const locked = settingsLocked || transitionsLocked || aiLocked
  useEffect(() => { onNavigationLockChange?.(locked); return () => onNavigationLockChange?.(false) }, [locked, onNavigationLockChange])
  const openedTransition = useRef(restoredSection && restoredSection !== 'transitions' ? transitionOpen?.key ?? '' : ''), previousSection = useRef(initialSection)
  useEffect(() => {
    if (transitionOpen && openedTransition.current !== transitionOpen.key && !locked) {
      openedTransition.current = transitionOpen.key; setTab('transitions')
    }
  }, [transitionOpen?.key, locked])
  useEffect(() => {
    if (previousSection.current === initialSection) return
    previousSection.current = initialSection
    // 작성 중인 업무를 끝낸 뒤에 옛 이동 요청이 뒤늦게 실행되지 않게 한다.
    if (!locked && !transitionOpen) setTab(initialSection)
  }, [initialSection, locked, transitionOpen])
  function openPreparation(destination: SchoolPreparationDestination) {
    if (locked) return
    if (destination === 'roster') setTab('roster')
    else if (destination === 'school') setTab('settings')
    else onOpenPreparation?.(destination)
  }
  const assistant = presentation === 'assistant', current = sections.find(section => section.id === tab)!
  const tools = <>
    <details className="school-preparation-disclosure" open={guideOpen} onToggle={event => setGuideOpen(event.currentTarget.open)}>
      <summary>학교 준비 진행 안내</summary>
      {guideOpen && <Suspense fallback={<p role="status">학교 준비 안내를 여는 중…</p>}><SchoolPreparationPanel connection={connection} member={member} revision={revision} disabled={locked} onOpen={openPreparation} /></Suspense>}
    </details>
    <details open={participationOpen} onToggle={event => setParticipationOpen(event.currentTarget.open)}>
      <summary>업무 참여 범위·승인 준비</summary>
      {participationOpen && <Suspense fallback={<p role="status">참여 설정을 여는 중…</p>}><ParticipantAdministration key={`${member.schoolId}:${member.userId}:${member.id}`} connection={connection} member={member} /></Suspense>}
    </details>
  </>
  return <section className={assistant ? 'school-administration-conversation' : undefined} aria-label={assistant ? '대화에서 학교 관리' : undefined}>
    {assistant && <><style>{styles}</style><header className="school-administration-conversation__header">
      <label>학교 관리 업무<select aria-label="학교 관리 업무" disabled={locked} value={tab} onChange={event => setTab(event.target.value as SchoolAdministrationSection)}>{sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
      <p>{current.process}</p>
    </header></>}
    {!assistant && tools}
    {!assistant && <div className="button-row" role="group" aria-label="학교 관리 구분">{sections.map(section => <button key={section.id} type="button" disabled={locked} aria-pressed={tab === section.id} onClick={() => setTab(section.id)}>{section.label}</button>)}</div>}
    <div className={assistant ? 'school-administration-conversation__work' : undefined}>
      {tab === 'teachers' ? <Suspense fallback={<p role="status">교사 명부를 여는 중…</p>}><TeacherRosterPanel connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated} /></Suspense> :
        tab === 'neis' ? <Suspense fallback={<p role="status">나이스 자료를 여는 중…</p>}><NeisWorkspace connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated} /></Suspense> :
          tab === 'settings' ? <SchoolAdminPanel onWorkflowResult={onWorkflowResult} connection={connection} member={member} date={date} revision={revision} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated} /> :
            tab === 'roster' ? <SchoolRosterPanel connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated} /> :
              tab === 'ai' ? <Suspense fallback={<p role="status">학교 AI 설정을 여는 중…</p>}><SchoolAiSettingsPanel connection={connection} member={member} revision={revision} onNavigationLockChange={setAiLocked} /></Suspense> :
                <SchoolTransitions presentation={presentation} openRequest={transitionOpen} connection={connection} member={member} revision={revision} onNavigationLockChange={setTransitionsLocked} onWorkflowResult={onWorkflowResult} />}
    </div>
    {assistant && <details className="school-administration-conversation__tools"><summary>준비 현황·참여 범위</summary>{tools}</details>}
  </section>
}
