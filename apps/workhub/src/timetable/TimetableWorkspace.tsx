import { retryableLazy as lazy } from '../app/retryable-lazy'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { createTimetableServer } from './server'
import themeStyles from './timetable-theme.css?inline'
import { TimetableBoard } from './TimetableBoard'
import { createAssistantServer } from '../assistant/server'
import type { AssistantHttpPort } from '../assistant/http'
import { createPreparationServer } from './preparation-server'
import { createTimetableSetupServer } from './setup-server'
import { createTimetableTargetServer } from './target-server'
import { createTimetableImportServer } from './import-server'
import { WorkspaceProps, PanelProps, timetableClock } from './designer-model'
import { useTimetableDesigner } from './useTimetableDesigner'
import { TimetableDesignerView } from './TimetableDesignerView'
export { TimetableBoard } from './TimetableBoard'
const TimetableOperationsWorkspace = lazy(() => import('./TimetableOperationsWorkspace').then(module => ({ default: module.TimetableOperationsWorkspace })))
const TimetablePilotPanel = lazy(() => import('./pilot/TimetablePilotPanel').then(module => ({ default: module.TimetablePilotPanel })))
const TimetableImportPanel = lazy(() => import('./TimetableImportPanel').then(module => ({ default: module.TimetableImportPanel })))





const timetableAssistantHttp: AssistantHttpPort = { async send(payload, expectedUserId, writing) { const { legacyAssistantHttp } = await import('../assistant/legacy-http'); return legacyAssistantHttp.send(payload, expectedUserId, writing) } }
export function TimetableWorkspace(props: WorkspaceProps) {
  return <TimetableWorkspaceEntry key={recoveryScope(props.member)} {...props} />
}
function TimetableWorkspaceEntry(props: WorkspaceProps) {
  const server = useMemo(() => createTimetableServer(props.connection), [props.connection])
  const assistantServer = useMemo(() => createAssistantServer(props.connection, timetableAssistantHttp, {policyReads:true}), [props.connection])
  const preparationServer = useMemo(() => createPreparationServer(props.connection), [props.connection])
  const setupServer = useMemo(() => createTimetableSetupServer(props.connection), [props.connection])
  const targetServer = useMemo(() => createTimetableTargetServer(props.connection), [props.connection])
  const importServer = useMemo(() => createTimetableImportServer(props.connection), [props.connection])
  const route = useEditDraft<'editor' | 'operations' | 'pilot' | 'import'>(props.member, 'timetable-entry')
  const recovery = usePendingRequest(props.member, 'timetableOperations')
  const importRecovery = usePendingRequest(props.member, 'timetableImport'), interventionRecovery = usePendingRequest(props.member, 'timetableInterventions')
  const operationsAiRecovery = usePendingRequest(props.member, 'timetableOperationsAssistant')
  const editorRecovery = usePendingRequest(props.member, 'timetable'), editorAiRecovery = usePendingRequest(props.member, 'timetableAssistant')
  const preparationRecovery = usePendingRequest(props.member, 'timetablePreparation'), setupRecovery = usePendingRequest(props.member, 'timetableSetup')
  const setupBatchRecovery = usePendingRequest(props.member, 'timetableSetupBatch'), targetRecovery = usePendingRequest(props.member, 'timetableTarget')
  // 새 기본 화면보다 미확정 편성 작업의 원 요청 복구를 먼저 보여 준다.
  const hasEditorRecovery = [editorRecovery, editorAiRecovery, preparationRecovery, setupRecovery, setupBatchRecovery, targetRecovery].some(item => item.request)
  const [mode, setMode] = useState<'editor' | 'operations' | 'pilot' | 'import'>(() => importRecovery.request ? 'import' : hasEditorRecovery ? 'editor' : recovery.request || interventionRecovery.request || operationsAiRecovery.request || (props.initialLessonId !== undefined || props.initialRequestId !== undefined || props.initialNotificationId !== undefined || props.initialIntent !== undefined) ? 'operations' : props.initialPreparationStep === 'import' ? 'import' : props.initialPreparationStep ? 'editor' : route.initial ?? 'operations')
  const [locked, setLocked] = useState(false)
  const [publicationDraft, setPublicationDraft] = useState<{ id: string; version: number }>()
  const [consumedIntent, setConsumedIntent] = useState('')
  const consumeIntent = useCallback((token: string) => setConsumedIntent(token), [])
  const consumePublicationDraft = useCallback(() => setPublicationDraft(undefined), [])
  const notifyLock = useCallback((value: boolean) => {
    setLocked(value)
    props.onNavigationLockChange?.(value)
  }, [props.onNavigationLockChange])
  function navigate(next: 'editor' | 'operations' | 'pilot' | 'import') {
    if (locked || next === mode) return
    route.save(next, false)
    setMode(next)
  }
  function openPublication(draft: { id: string; version: number }) {
    if (locked) return
    setPublicationDraft(draft); route.save('operations', false); setMode('operations')
  }
  return <><style>{themeStyles}</style>
    <header className="timetable-entry-header"><div>{mode === 'operations' ? <h1>시간표</h1> : <strong>시간표</strong>}</div><nav aria-label="시간표 작업 구분" className="timetable-entry-navigation" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      <button type="button" className="secondary" aria-pressed={mode === 'editor'} disabled={locked && mode !== 'editor'} onClick={() => navigate('editor')}>편성 관리</button>
      <button type="button" className="secondary" aria-pressed={mode === 'operations'} disabled={locked && mode !== 'operations'} onClick={() => navigate('operations')}>시간표 보기</button>
      <details className="timetable-entry-tools" open={mode === 'pilot' || mode === 'import' || undefined}><summary>시간표 관리 도구</summary><div><button type="button" className="secondary" aria-pressed={mode === 'pilot'} disabled={locked && mode !== 'pilot'} onClick={() => navigate('pilot')}>9학급 운영 연습</button>
      <button type="button" className="text-button" aria-pressed={mode === 'import'} disabled={locked && mode !== 'import'} onClick={() => navigate('import')}>실제 시간표 가져오기</button></div></details>
    </nav></header>
    {mode === 'editor'
      ? <TimetableWorkspacePanel {...props} server={server} assistantServer={assistantServer} preparationServer={preparationServer} setupServer={setupServer} targetServer={targetServer} onOpenOperations={openPublication} onOpenPublished={() => navigate('operations')} onNavigationLockChange={notifyLock} />
      : mode === 'pilot' ? <Suspense fallback={<p role="status">학교 운영 연습을 준비하는 중…</p>}><TimetablePilotPanel scope={JSON.stringify([props.member.schoolId, props.member.userId])} member={props.member} connection={props.connection} onNavigationLockChange={notifyLock} /></Suspense>
      : mode === 'import' ? <Suspense fallback={<p role="status">시간표 가져오기를 준비하는 중…</p>}><TimetableImportPanel server={importServer} member={props.member} correctionContext={{ connection: props.connection, date: props.date, revision: props.revision }} onLockChange={notifyLock} onOpenPublish={openPublication} onOpenSchoolAdmin={props.onOpenSchoolAdmin} onOpenTeaching={props.onOpenTeaching} /></Suspense>
      : <Suspense fallback={<p role="status">시간표 운영 화면을 준비하는 중…</p>}><TimetableOperationsWorkspace embeddedHeader {...props} initialIntent={props.initialIntent?.token !== consumedIntent ? props.initialIntent : undefined} onInitialIntentConsumed={consumeIntent} initialDraftId={publicationDraft?.id} initialDraftVersion={publicationDraft?.version} onInitialDraftConsumed={consumePublicationDraft} onNavigationLockChange={notifyLock} /></Suspense>}
  </>
}
export { IssueList } from './TimetableDesignerView'
export function TimetableWorkspacePanel(props: PanelProps) {
 return <TimetableDesignerView model={useTimetableDesigner(props)} />;
}

export { timetableClock } from './designer-model'
