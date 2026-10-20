import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { activeAt } from '../domain'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { validateBasis, validatePlacements, validateSolveResult, timetablePolicy } from '../../../../packages/timetable/src/validate'
import type { TimetableIssue, SolveResult } from '../../../../packages/timetable/src/types'
import { createTimetableServer, timetableConditions, timetableWeekStart } from './server'
import type { TimetableServer, TimetableReadiness, TimetableSnapshot, TimetableBasis, TimetableConditions, Placement, SaveDraftInput, TimetableDraft } from './contracts'
import { startTimetableSolve, TimetableSolverError, type TimetableSolver, type SolverTask } from './worker-client'
import { timetablePracticeSnapshot } from './sample'
import limits from './limits.json'
import styles from './timetable.css?inline'
import themeStyles from './timetable-theme.css?inline'
import editorStyles from './timetable-editor-usability.css?inline'
import { TimetableEditorProgress } from './TimetableEditorProgress'
import { TimetableFlowGuide } from './TimetableFlowGuide'
import { matchesSavedTimetableDraft, timetableDraftCommand, type SavedTimetableDraft } from './flow'
import { TimetableBoard } from './TimetableBoard'
import { TimetableAdjustmentPanel } from './TimetableAdjustmentPanel'
import { adjustmentSourceKey, reviewAdjustment, reviewPartialPlacements, reviewProtectedPlacements, type AdjustmentCommand } from './adjustments'
import { reviewTimetablePreflight } from './preflight'
import { TimetablePreflightPanel } from './TimetablePreflightPanel'
import { FoundationPanel } from './FoundationPanel'
import { TimetableQualitySummary } from './TimetableQualitySummary'
import { ConditionCards } from './ConditionCards'
import { ConditionBatchPanel } from './ConditionBatchPanel'
import { conditionBatchSourceKey, hasConditionBatchInput, initialConditionBatch, type ConditionBatchState } from './condition-batch'
import { prepareScopedSolve, reviewTimetableFoundation } from './foundation'
import type { TimetableWorkbookDraft } from './workbook'
import { createAssistantServer } from '../assistant/server'
import type { AssistantServer } from '../assistant/contracts'
import type { AssistantHttpPort } from '../assistant/http'
import { createPreparationServer } from './preparation-server'
import type { PreparationServer } from './preparation'
import { createTimetableSetupServer } from './setup-server'
import type { SetupServer } from './setup'
import { createTimetableTargetServer } from './target-server'
import type { TargetServer, TargetSnapshot } from './target'
import { TimetableTargetPanel, type TargetPanelState } from './TimetableTargetPanel'
import { scopeTimetableServers, targetScopeKey } from './target-scope'
import { createTimetableImportServer } from './import-server'
export { TimetableBoard } from './TimetableBoard'
const TimetableOperationsWorkspace = lazy(() => import('./TimetableOperationsWorkspace').then(module => ({ default: module.TimetableOperationsWorkspace })))
const TimetablePilotPanel = lazy(() => import('./pilot/TimetablePilotPanel').then(module => ({ default: module.TimetablePilotPanel })))
const TimetableImportPanel = lazy(() => import('./TimetableImportPanel').then(module => ({ default: module.TimetableImportPanel })))
const TimetableWorkbookPanel = lazy(() => import('./TimetableWorkbookPanel').then(module => ({ default: module.TimetableWorkbookPanel })))
const TimetableCandidateLibrary = lazy(() => import('./TimetableCandidateLibrary').then(module => ({ default: module.TimetableCandidateLibrary })))
const TimetableEnginePanel = lazy(() => import('./TimetableEnginePanel').then(module => ({ default: module.TimetableEnginePanel })))
const TimetableAssistantPanel = lazy(() => import('./TimetableAssistantPanel').then(module => ({ default: module.TimetableAssistantPanel })))
const TimetablePreparationPanel = lazy(() => import('./TimetablePreparationPanel').then(module => ({ default: module.TimetablePreparationPanel })))
const timetableAssistantHttp: AssistantHttpPort = { async send(payload, expectedUserId, writing) { const { legacyAssistantHttp } = await import('../assistant/legacy-http'); return legacyAssistantHttp.send(payload, expectedUserId, writing) } }

type Step = 'basis' | 'conditions' | 'compose' | 'publish'
type ConditionForm = { kind: 'fixed' | 'unavailable' | 'preferences'; targetId: string; slotId: string; weight: string }
interface DraftSession {
  practice: boolean; termId?: string; basisIdentity: string; title: string; conditions: TimetableConditions
  placements: Placement[] | null; previous: Placement[] | null; dirty: boolean; form: ConditionForm
  conditionsChanged?: boolean; lockedLessonIds?: string[]
  placementBasis?: TimetableBasis; previousBasis?: TimetableBasis
  conditionBatch?: ConditionBatchState
  savedDraft?: SavedTimetableDraft
}
interface WorkspaceProps { connection: SupabaseConnection; member: Membership; date: string; revision?: number; onNavigationLockChange?: (locked: boolean) => void; onOpenSchoolAdmin?: () => void; onOpenTeaching?: () => void; initialLessonId?: string; initialDate?: string; initialRequestId?: string; initialNotificationId?: string }
interface PanelProps extends Omit<WorkspaceProps, 'connection'> { server: TimetableServer; assistantServer?: AssistantServer; preparationServer?: PreparationServer; setupServer?: SetupServer; targetServer?: TargetServer; runSolver?: TimetableSolver; onOpenOperations?: (draft: { id: string; version: number }) => void }
const days = ['월', '화', '수', '목', '금', '토', '일']
const steps: { id: Step; label: string }[] = [{ id: 'basis', label: '기초 자료' }, { id: 'conditions', label: '조건 정리' }, { id: 'compose', label: '배치·비교' }, { id: 'publish', label: '공개 검토' }]
const basisIdentity = (basis: TimetableBasis) => canonical([basis.schoolId, basis.termId, basis.id, basis.revision, basis.sourceFingerprint])
const initialSession = (basis: TimetableBasis, practice: boolean): DraftSession => ({ practice, termId: basis.termId, basisIdentity: basisIdentity(basis), title: '시간표 초안', conditions: { fixed: structuredClone(basis.fixed), unavailable: structuredClone(basis.unavailable), preferences: structuredClone(basis.preferences) }, placements: null, previous: null, dirty: false, form: { kind: 'fixed', targetId: '', slotId: '', weight: '1' } })
export const timetableClock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const slotLabel = (basis: TimetableBasis, id: string) => { const slot = basis.slots.find(item => item.id === id); return slot ? `${days[slot.day - 1]} ${slot.label} · ${timetableClock(slot.startMinute)}–${timetableClock(slot.endMinute)}` : '확인되지 않은 시간대' }
const conditionLabels = { fixed: '반드시 이 시간에', unavailable: '사용할 수 없는 시간', preferences: '가능하면 피할 시간' }
function safeMessage(error: unknown) { return error instanceof ServiceError || error instanceof TimetableSolverError ? error.message : '처리 결과를 확인하지 못했습니다. 입력은 유지했습니다.' }
const confirmedRejection = (error: unknown) => error instanceof ServiceError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'NOT_READY'].includes(error.code)
export function TimetableWorkspace(props: WorkspaceProps) {
  return <TimetableWorkspaceEntry key={recoveryScope(props.member)} {...props} />
}
function TimetableWorkspaceEntry(props: WorkspaceProps) {
  const server = useMemo(() => createTimetableServer(props.connection), [props.connection])
  const assistantServer = useMemo(() => createAssistantServer(props.connection, timetableAssistantHttp), [props.connection])
  const preparationServer = useMemo(() => createPreparationServer(props.connection), [props.connection])
  const setupServer = useMemo(() => createTimetableSetupServer(props.connection), [props.connection])
  const targetServer = useMemo(() => createTimetableTargetServer(props.connection), [props.connection])
  const importServer = useMemo(() => createTimetableImportServer(props.connection), [props.connection])
  const route = useEditDraft<'editor' | 'operations' | 'pilot' | 'import'>(props.member, 'timetable-entry')
  const recovery = usePendingRequest(props.member, 'timetableOperations')
  const importRecovery = usePendingRequest(props.member, 'timetableImport'), interventionRecovery = usePendingRequest(props.member, 'timetableInterventions')
  const operationsAiRecovery = usePendingRequest(props.member, 'timetableOperationsAssistant')
  const [mode, setMode] = useState<'editor' | 'operations' | 'pilot' | 'import'>(() => importRecovery.request ? 'import' : recovery.request || interventionRecovery.request || operationsAiRecovery.request || (props.initialLessonId !== undefined || props.initialRequestId !== undefined || props.initialNotificationId !== undefined) ? 'operations' : route.initial ?? 'editor')
  const [locked, setLocked] = useState(false)
  const [publicationDraft, setPublicationDraft] = useState<{ id: string; version: number }>()
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
    <nav aria-label="시간표 작업 구분" className="timetable-entry-navigation" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      <button type="button" className="secondary" aria-pressed={mode === 'editor'} disabled={locked && mode !== 'editor'} onClick={() => navigate('editor')}>내 수업·편성</button>
      <button type="button" className="secondary" aria-pressed={mode === 'operations'} disabled={locked && mode !== 'operations'} onClick={() => navigate('operations')}>확정·공유·교환</button>
      <button type="button" className="secondary" aria-pressed={mode === 'pilot'} disabled={locked && mode !== 'pilot'} onClick={() => navigate('pilot')}>9학급 운영 연습</button>
      <button type="button" className="text-button" aria-pressed={mode === 'import'} disabled={locked && mode !== 'import'} onClick={() => navigate('import')}>실제 시간표 가져오기</button>
    </nav>
    {mode === 'editor'
      ? <TimetableWorkspacePanel {...props} server={server} assistantServer={assistantServer} preparationServer={preparationServer} setupServer={setupServer} targetServer={targetServer} onOpenOperations={openPublication} onNavigationLockChange={notifyLock} />
      : mode === 'pilot' ? <Suspense fallback={<p role="status">학교 운영 연습을 준비하는 중…</p>}><TimetablePilotPanel scope={JSON.stringify([props.member.schoolId, props.member.userId])} member={props.member} connection={props.connection} onNavigationLockChange={notifyLock} /></Suspense>
      : mode === 'import' ? <Suspense fallback={<p role="status">시간표 가져오기를 준비하는 중…</p>}><TimetableImportPanel server={importServer} member={props.member} onLockChange={notifyLock} onOpenPublish={openPublication} onOpenSchoolAdmin={props.onOpenSchoolAdmin} onOpenTeaching={props.onOpenTeaching} /></Suspense>
      : <Suspense fallback={<p role="status">시간표 운영 화면을 준비하는 중…</p>}><TimetableOperationsWorkspace {...props} initialDraftId={publicationDraft?.id} initialDraftVersion={publicationDraft?.version} onInitialDraftConsumed={consumePublicationDraft} onNavigationLockChange={notifyLock} /></Suspense>}
  </>
}
export function TimetableWorkspacePanel({ server: baseServer, assistantServer, preparationServer: basePreparationServer, setupServer: baseSetupServer, targetServer, member, date, revision = 0, onNavigationLockChange, onOpenSchoolAdmin, onOpenOperations, runSolver = startTimetableSolve }: PanelProps) {
  const id = useId(), memory = useEditDraft<DraftSession>(member, 'timetable-editor'), aiMemory = useEditDraft<{text:string;sheet:string}>(member, 'timetable-ai'), recovery = usePendingRequest(member, 'timetable')
  const aiRecovery = usePendingRequest(member, 'timetableAssistant'), preparationRecovery = usePendingRequest(member, 'timetablePreparation'), setupRecovery = usePendingRequest(member, 'timetableSetup'), setupBatchRecovery = usePendingRequest(member, 'timetableSetupBatch')
  const stepMemory = useEditDraft<Step>(member, 'timetable-editor-step')
  const targetRecovery = usePendingRequest(member, 'timetableTarget')
  const [targetState, setTargetState] = useState<TargetPanelState>({ status: targetServer ? 'loading' : 'unavailable' })
  const [targetLocked, setTargetLocked] = useState(Boolean(targetRecovery.request)), [targetRefresh, setTargetRefresh] = useState(0), [targetEpoch, setTargetEpoch] = useState(0)
  const targetScope = useRef<{ checking: boolean; snapshot?: TargetSnapshot }>({ checking: Boolean(targetServer) })
  const otherTargetLocks = useRef(false)
  const practiceSnapshot = useMemo(() => timetablePracticeSnapshot(date), [date])
  const [session, setSession] = useState<DraftSession | undefined>(() => memory.initial), [practice, setPractice] = useState(Boolean(memory.initial?.practice))
  const [tab, setTab] = useState<'mine' | 'design'>(() => memory.initial ? 'design' : 'mine'), [step, setStep] = useState<Step>(stepMemory.initial ?? 'basis'), [discardConfirm, setDiscardConfirm] = useState(false)
  const [week, setWeek] = useState(() => timetableWeekStart(date)), [snapshot, setSnapshot] = useState<TimetableSnapshot>(), [ready, setReady] = useState<TimetableReadiness>()
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [solving, setSolving] = useState(false)
  const [aiLocked, setAiLocked] = useState(false), [aiInputLocked, setAiInputLocked] = useState(false)
  const [aiOpenRequest, setAiOpenRequest] = useState<{ stage: 'setup' | 'adjust'; token: number }>()
  const [preparationLocked, setPreparationLocked] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [issues, setIssues] = useState<TimetableIssue[]>([]), [result, setResult] = useState<SolveResult>()
  const [selectedLesson, setSelectedLesson] = useState(''), [filter, setFilter] = useState(''), [aiText, setAiText] = useState(aiMemory.initial?.text ?? ''), [aiSheet, setAiSheet] = useState(aiMemory.initial?.sheet ?? '')
  const [conditionSearch, setConditionSearch] = useState('')
  const stepHeading = useRef<HTMLHeadingElement>(null), focusStep = useRef(false)
  const life = useRef(0), operation = useRef(false), solver = useRef<SolverTask>(), currentSession = useRef(session), feedback = useRef<HTMLDivElement>(null)
  currentSession.current = session
  const observeTarget = useCallback((next: TargetPanelState) => {
    const previous = targetScope.current.snapshot
    // 연결이 끊겼다고 이미 확인한 대상 학기를 잊지 않는다. 기존 T1의 미지원은 첫 조회에서만 독립 처리한다.
    targetScope.current = { checking: next.status !== 'ready', snapshot: next.status === 'ready' ? next.snapshot : previous }
    setTargetState(next)
    if (next.status !== 'ready' || !next.snapshot) return
    const latest = currentSession.current
    let storedTerm = latest?.termId ?? latest?.placementBasis?.termId
    if (!storedTerm && latest) { try { storedTerm = JSON.parse(latest.basisIdentity)[1] } catch { /* 이전 메모리는 안전하게 그대로 보존한다. */ } }
    const changed = previous ? targetScopeKey(previous) !== targetScopeKey(next.snapshot) : Boolean(latest && !latest.practice && storedTerm && storedTerm !== next.snapshot.termId)
    if (!changed) return
    // 성공한 저장 자료는 서버에 남아 있다. 미저장/결과 미상은 자동으로 버리지 않는다.
    if (!otherTargetLocks.current && !latest?.dirty) { currentSession.current = undefined; setSession(undefined); memory.save(undefined, false); setResult(undefined); setIssues([]) }
    setSnapshot(undefined); setLoading(true); setSelectedLesson(''); setDiscardConfirm(false)
    setNotice('학교의 준비 대상 학기가 바뀌어 자료를 다시 확인합니다. 작성 중인 입력과 원래 요청은 보관했습니다.')
    setReload(value => value + 1); setTargetEpoch(value => value + 1)
  }, [memory])
  const targetMismatch = useCallback(() => { setNotice('준비 대상 학기가 변경되었습니다. 서로 다른 학기의 자료를 섞지 않고 다시 확인합니다.'); setTargetRefresh(value => value + 1) }, [])
  const scoped = useMemo(() => scopeTimetableServers({ target: targetServer, state: () => targetScope.current,
    observe: value => observeTarget({ status: 'ready', snapshot: value }), mismatch: targetMismatch,
    timetable: baseServer, preparation: basePreparationServer, setup: baseSetupServer,
  }), [baseServer, basePreparationServer, baseSetupServer, targetServer, observeTarget, targetMismatch])
  const server = scoped.timetable, preparationServer = scoped.preparation, setupServer = scoped.setup
  const knownTarget = targetState.status === 'ready' ? targetState.snapshot : targetScope.current.snapshot
  const targetChecking = Boolean(targetServer && (targetState.status === 'loading' || (knownTarget && targetState.status !== 'ready')))
  const targetViewMismatch = Boolean(!practice && knownTarget && snapshot?.basis && snapshot.basis.termId !== knownTarget.termId)
  const targetBlocked = !practice && (targetChecking || targetLocked || Boolean(targetRecovery.request) || targetViewMismatch)
  useEffect(() => {
    if (!targetServer) return
    const refresh = () => { if (document.visibilityState !== 'hidden') setTargetRefresh(value => value + 1) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [targetServer])
  const enabled = activeAt(member, date), pending = recovery.request
  const current = practice ? practiceSnapshot : !loadError && !loading && ready?.available ? snapshot : undefined
  const basis = current?.canDesign ? current.basis : null
  const stale = targetViewMismatch || Boolean(basis && session && session.basisIdentity !== basisIdentity(basis))
  const effective = useMemo(() => basis && session && !stale ? { ...basis, ...session.conditions } : basis, [basis, session?.conditions, stale])
  const candidateCheck = useMemo(() => effective && session?.placements && !stale ? validatePlacements(effective, session.placements) : undefined, [effective, session?.placements, stale])
  const partialCheck = useMemo(() => effective && session?.placements && !stale ? reviewPartialPlacements(effective, session.placements) : undefined, [effective, session?.placements, stale])
  const inputCheck = useMemo(() => effective ? validateBasis(effective) : undefined, [effective])
  const preflight = useMemo(() => effective ? reviewTimetablePreflight(effective) : undefined, [effective])
  const foundation = useMemo(() => effective ? reviewTimetableFoundation(effective) : undefined, [effective])
  const workingLocks = session?.lockedLessonIds ?? []
  const singleConditionPending = Boolean(session?.form.targetId || session?.form.slotId), batchPending = hasConditionBatchInput(session?.conditionBatch)
  const conditionPending = singleConditionPending || batchPending
  const conditionTargets = basis && session ? session.form.kind === 'unavailable' ? basis.resources : basis.lessons : []
  const conditionQuery = conditionSearch.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s/g, '')
  const matchingTargets = conditionTargets.filter(row => [row.label, row.id, ...('resourceIds' in row ? row.resourceIds.map(id => basis?.resources.find(resource => resource.id === id)?.label ?? id) : [])].join(' ').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s/g, '').includes(conditionQuery))
  const selectedTarget = conditionTargets.find(row => row.id === session?.form.targetId)
  const shownTargets = selectedTarget && !matchingTargets.includes(selectedTarget) ? [selectedTarget, ...matchingTargets] : matchingTargets
  const targetLabelCounts = new Map<string, number>()
  conditionTargets.forEach(row => targetLabelCounts.set(row.label, (targetLabelCounts.get(row.label) ?? 0) + 1))
  const targetLabel = (row: { id: string; label: string }) => (targetLabelCounts.get(row.label) ?? 0) > 1 ? `${row.label} [${row.id}]` : row.label
  const selectedConditionTime = basis && session?.form.slotId ? slotLabel(basis, session.form.slotId) : ''
  const liveBasis = useRef<{basis:TimetableBasis|null|undefined; allowed:boolean}>({basis:effective,allowed:false})
  const commandLocked = busy || solving || Boolean(pending), locked = commandLocked || aiLocked || preparationLocked || targetBlocked, navLocked = locked || Boolean(session?.dirty) || Boolean(aiText.trim())
  otherTargetLocks.current = commandLocked || aiLocked || aiInputLocked || preparationLocked || Boolean(session?.dirty) || Boolean(aiText.trim()) || conditionPending || Boolean(aiRecovery.request || preparationRecovery.request || setupRecovery.request || setupBatchRecovery.request)
  const canEdit = Boolean(basis && session && !stale && !locked && (practice || current?.canDesign)), viewable = Boolean(practice || (!loadError && !loading && ready?.available && snapshot))
  liveBasis.current = {basis:effective,allowed:viewable && !!current?.canDesign && !stale}
  const savedForCurrent = Boolean(basis && session && !stale && !session.dirty && matchesSavedTimetableDraft(session.savedDraft, timetableDraftCommand(basis, session)))
  function openSavedPublication() {
    const latest = currentSession.current
    if (!onOpenOperations || !basis || !latest?.savedDraft || navLocked || stale || conditionPending || latest.conditionsChanged || !current?.canSave || !candidateCheck?.valid || practice || !matchesSavedTimetableDraft(latest.savedDraft, timetableDraftCommand(basis, latest))) return
    onOpenOperations({ id: latest.savedDraft.id, version: latest.savedDraft.version })
  }
  function navigateStep(next: Step) {
    if (locked) return
    if (next === step) { stepHeading.current?.focus(); return }
    focusStep.current = true
    setStep(next)
  }
  useEffect(() => { stepMemory.save(step, false) }, [step])
  useEffect(() => { if (focusStep.current) { focusStep.current = false; stepHeading.current?.focus() } }, [step])
  function update(next: DraftSession | undefined) { currentSession.current = next; setSession(next); memory.save(next, Boolean(next?.dirty)) }
  useEffect(() => { life.current++; return () => { life.current++; solver.current?.cancel(); operation.current = false } }, [server])
  useEffect(() => { onNavigationLockChange?.(navLocked); return () => onNavigationLockChange?.(false) }, [navLocked, onNavigationLockChange])
  useEffect(() => { if (!navLocked) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [navLocked])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError('')
    if (!enabled) { setReady(undefined); setSnapshot(undefined); setLoadError('현재 학교 소속을 다시 확인해 주세요.'); setLoading(false); return }
    void server.readiness(member.id).then(async value => { if (cancelled) return; setReady(value); if (!value.available) { setSnapshot(undefined); return }; const next = await server.get(member.id, week); if (!cancelled) setSnapshot(next) }).catch(failure => { if (!cancelled) { setSnapshot(undefined); setLoadError(safeMessage(failure)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [server, member.id, week, enabled, revision, reload, targetEpoch])
  useEffect(() => { if (basis && !session && !targetViewMismatch) update(initialSession(basis, practice)) }, [basis, session, practice, targetViewMismatch])
  useEffect(() => { aiMemory.save(aiText || aiSheet ? {text:aiText,sheet:aiSheet} : undefined, Boolean(aiText.trim())) }, [aiText,aiSheet,aiMemory])
  useEffect(() => { if (current && !current.canDesign && !practice && session) { setTab('mine');setResult(undefined);setIssues([]) } }, [current,practice,session])
  useEffect(() => { if (!viewable || stale) { solver.current?.cancel(); setSelectedLesson('') } }, [viewable, stale])
  useEffect(() => { setFilter(basis?.resources.find(row => row.kind === 'teacher')?.id ?? '') }, [basis?.id,basis?.revision,basis?.sourceFingerprint])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  function discardUnavailable() { if (locked) return;update(undefined);setAiText('');setAiSheet('');setDiscardConfirm(false);setResult(undefined);setIssues([]);setError('');setNotice('보관한 입력을 버렸습니다. 이제 다른 메뉴로 이동할 수 있습니다.') }
  function enterPractice() { if (locked || session?.dirty) return; const sample = timetablePracticeSnapshot(date); setPractice(true); update(initialSession(sample.basis!, true)); setTab('design'); setStep('basis'); setError(''); setNotice('예시 자료로 편성 연습을 시작했습니다. 실제 학교에 저장하거나 공개하지 않습니다.') }
  function leavePractice() { if (locked) return; setPractice(false); update(undefined); setResult(undefined); setIssues([]); setTab('mine'); setAiText(''); setAiSheet(''); setNotice('편성 연습을 마쳤습니다. 연습 자료는 학교에 저장되지 않았습니다.') }
  function resetDraft() { if (!basis || locked) return; update(initialSession(basis, practice)); setIssues([]); setResult(undefined); setSelectedLesson(''); setError(''); setNotice('현재 기초 자료로 새 편성을 준비했습니다.'); setAiText(''); setAiSheet('') }
  function changeConditions(conditions: TimetableConditions, fromAssistant = false, sourceKey?: string): boolean {
    const latest = currentSession.current
    if (!latest || !basis || !(fromAssistant ? !targetBlocked && !stale && !commandLocked && viewable && current?.canDesign && !conditionPending : canEdit) || batchPending && !sourceKey || sourceKey && (singleConditionPending || sourceKey !== conditionBatchSourceKey(basis, latest.conditions))) return false
    try { conditions = timetableConditions(conditions, basis) } catch { setError('기초 자료와 적용할 조건을 다시 확인해 주세요. 입력은 보관했습니다.'); return false }
    update({ ...latest, conditions, conditionBatch: initialConditionBatch(), conditionsChanged: Boolean(latest.placements), dirty: true, form: { ...latest.form, targetId: '', slotId: '' } }); setResult(undefined); setIssues([]); setSelectedLesson(''); setAiSheet(''); setError(''); setNotice('조건을 바꿨습니다. 기존 배치는 보관했습니다. 새 조건으로 다시 검사하거나 재계산해 주세요.'); return true
  }
  function changeBatch(state: ConditionBatchState) { const latest = currentSession.current; if (!latest || !canEdit || singleConditionPending) return; update({ ...latest, conditionBatch: state, dirty: latest.dirty || hasConditionBatchInput(state) }) }
  function clearConditionInput() { const latest = currentSession.current; if (!latest || !canEdit) return; update({ ...latest, conditionBatch: initialConditionBatch(), form: { ...latest.form, targetId: '', slotId: '' } }) }
  function recheckWorkingPlacements() {
    if (!session?.placements || !effective || !canEdit || conditionPending) return
    const checked = reviewPartialPlacements(effective, session.placements)
    update({ ...session, placementBasis: checked.valid ? structuredClone(effective) : session.placementBasis, conditionsChanged: false, dirty: true }); setIssues(checked.issues)
    setNotice(checked.valid ? checked.complete ? '보관한 배치가 새 조건을 통과했습니다. 그대로 조정하거나 저장할 수 있습니다.' : `보관한 배치를 열었습니다. 미배정 수업 ${checked.missingLessonIds.length}개를 이어서 배치해 주세요.` : '보관한 배치를 열었습니다. 충돌을 해결하기 전에는 학교 서버에 저장하거나 확정할 수 없습니다.'); setError('')
  }
  function importWorkingDraft(draft: TimetableWorkbookDraft) {
    if (!basis || !session || !canEdit || conditionPending) return
    const importedBasis = { ...basis, ...draft.conditions }
    update({ ...session, title: draft.title, conditions: structuredClone(draft.conditions), placements: structuredClone(draft.placements), placementBasis: validatePlacements(importedBasis, draft.placements).valid ? structuredClone(importedBasis) : undefined, previous: session.placements ? structuredClone(session.placements) : null, previousBasis: session.placementBasis, lockedLessonIds: [], conditionsChanged: true, dirty: true })
    setSelectedLesson(''); setIssues([]); setResult(undefined); setAiSheet(''); setStep('compose'); setError(''); setNotice('엑셀 내용을 작업 초안에 가져왔습니다. 배치를 다시 검사한 뒤 이어서 조정해 주세요. 학교 서버에는 아직 저장하지 않았습니다.')
  }
  function adoptEngineCandidate(placements: Placement[]): boolean {
    if (!session || !effective || !canEdit || conditionPending) return false
    const prepared = prepareScopedSolve(effective, session.placements, workingLocks)
    if (!prepared.basis) { setIssues(prepared.issues); return false }
    const checked = validatePlacements(prepared.basis, placements)
    if (!checked.valid) { setIssues(checked.issues); setError('선택한 후보가 현재 조건이나 작업 중 고정과 일치하지 않습니다. 원래 요청을 다시 확인해 주세요.'); return false }
    update({ ...session, placements: structuredClone(placements), placementBasis: structuredClone(effective), previous: session.placements ? structuredClone(session.placements) : null, previousBasis: session.placementBasis, conditionsChanged: false, dirty: true })
    setSelectedLesson(''); setResult(undefined); setIssues([]); setError(''); setStep('compose'); setNotice('선택한 후보를 현재 작업 초안에 반영했습니다. 학교 서버 저장과 시간표 확정은 별도로 진행해 주세요.')
    return true
  }
  function toggleWorkingLock(lessonId: string) {
    if (!session?.placements || !canEdit || conditionPending || session.conditionsChanged || basis?.fixed.some(row => row.lessonId === lessonId)) return
    if (!session.placements.some(row => row.lessonId === lessonId)) return
    const next = workingLocks.includes(lessonId) ? workingLocks.filter(id => id !== lessonId) : [...workingLocks, lessonId]
    update({ ...session, lockedLessonIds: next, dirty: true }); setNotice(next.includes(lessonId) ? '이 배치를 다음 계산에서 유지합니다. 학교의 공식 조건은 바뀌지 않습니다.' : '작업 중 배치 고정을 풀었습니다. 학교의 공식 조건은 유지됩니다.')
  }
  function changeForm(patch: Partial<ConditionForm>) { if (!session || !canEdit || batchPending) return; update({ ...session, dirty: true, form: { ...session.form, ...patch } }); setError(''); setIssues([]) }
  function addCondition() {
    if (!session || !basis || !canEdit || batchPending) return
    const form = session.form, slot = basis.slots.find(item => item.id === form.slotId), conditions = structuredClone(session.conditions)
    if (!slot || !form.targetId) { setError('조건을 적용할 대상과 시간을 선택해 주세요.'); return }
    if (form.kind === 'fixed') conditions.fixed.push({ lessonId: form.targetId, slotId: slot.id })
    else if (form.kind === 'unavailable') conditions.unavailable.push({ resourceId: form.targetId, day: slot.day, startMinute: slot.startMinute, endMinute: slot.endMinute })
    else conditions.preferences.push({ lessonId: form.targetId, slotId: slot.id, weight: Number(form.weight) })
    const checked = validateBasis({ ...basis, ...conditions }); if (!checked.valid) { setIssues(checked.issues); setError('추가할 조건을 확인해 주세요.'); return }; changeConditions(conditions)
  }
  function removeCondition(kind: keyof TimetableConditions, index: number) {
    if (!session || !basis || !canEdit || batchPending) return
    const item = session.conditions[kind][index]
    if (kind !== 'preferences' && basis[kind].some(row => canonical(row) === canonical(item))) { setError('학교가 확정한 필수 조건은 여기서 해제할 수 없습니다. 기초 자료 담당자에게 수정을 요청해 주세요.'); return }
    const conditions = structuredClone(session.conditions); conditions[kind].splice(index, 1); changeConditions(conditions)
  }
  async function generate(scopeResourceId = '') {
    if (!effective || !session || !canEdit || operation.current || conditionPending) return
    const checked = validateBasis(effective); if (!checked.valid || !foundation?.ready || !preflight?.canCalculate) { setIssues([...checked.issues, ...(foundation?.issues ?? []), ...(preflight?.issues ?? [])]); setError('기초 자료와 조건을 먼저 확인해 주세요.'); return }
    const prepared = prepareScopedSolve(effective, session.placements, workingLocks, scopeResourceId)
    if (!prepared.basis) { setIssues(prepared.issues); setError('고정 배치와 부분 재계산 범위를 확인해 주세요.'); return }
    const solveBasis = prepared.basis
    const beforeSolve = reviewTimetablePreflight(solveBasis)
    if (!beforeSolve.canCalculate) { setIssues(beforeSolve.issues); setError('고정 배치와 현재 조건에서 해결해야 할 항목이 있습니다. 아래 문제 목록을 확인해 주세요.'); return }
    operation.current = true; setSolving(true); setError(''); setNotice(''); setIssues([])
    const epoch = life.current, source = canonical(effective)
    try {
      const task = runSolver(structuredClone(solveBasis)); solver.current = task; const next = await task.promise
      if (epoch !== life.current) return
      const latest = currentSession.current
      if (!liveBasis.current.allowed || canonical(liveBasis.current.basis) !== source || !latest || latest.basisIdentity !== basisIdentity(effective) || canonical({ ...effective, ...latest.conditions }) !== source) return
      if (!validateSolveResult(solveBasis, next)) { setError('계산 응답의 형식을 확인하지 못했습니다. 이전 배치와 입력은 유지합니다.');return }
      setResult(next)
      if (next.status === 'feasible') {
        const validated = validatePlacements(solveBasis, next.placements)
        if (!validated.valid) { setIssues(validated.issues); setError('계산 결과가 독립 검사를 통과하지 못해 채택하지 않았습니다.'); return }
        update({ ...latest, placements: structuredClone(next.placements), placementBasis: structuredClone(effective), previous: latest.placements ? structuredClone(latest.placements) : null, previousBasis: latest.placementBasis, conditionsChanged: false, dirty: true }); setNotice(scopeResourceId ? `선택 대상만 다시 계산했습니다. ${prepared.kept}개 고정 배치를 유지하고 전체 필수조건을 다시 검사했습니다.` : '필수 조건을 통과한 배치를 찾았습니다. 선호 조건과 수업별 배치를 확인해 주세요.'); setStep('compose')
      } else { setIssues(next.issues); setNotice(next.status === 'infeasible' ? '현재 지원 범위의 조건을 모두 탐색했지만 가능한 배치가 없습니다. 필수 조건은 자동으로 완화하지 않습니다.' : next.status === 'unknown' ? '이번 계산 한도 안에서 가능한 배치를 찾지 못했습니다. 불가능하다는 뜻은 아닙니다.' : '입력 또는 지원하지 않는 조건을 먼저 확인해 주세요.') }
    } catch (failure) { if (epoch === life.current) setError(safeMessage(failure)) }
    finally { if (epoch === life.current) { solver.current = undefined; operation.current = false; setSolving(false) } }
  }
  function applyAdjustment(command: AdjustmentCommand, requestedSource: string) {
    const latest = currentSession.current
    if (!latest?.placements || !effective || !canEdit || conditionPending || latest.conditionsChanged) return
    const currentBasis = { ...effective, ...latest.conditions }, locks = latest.lockedLessonIds ?? []
    if (!liveBasis.current.allowed || canonical(liveBasis.current.basis) !== canonical(currentBasis) || requestedSource !== adjustmentSourceKey(currentBasis, latest.placements, locks)) { setError('조정 기준이 바뀌었습니다. 현재 수업과 조건을 다시 확인해 주세요.'); return }
    const reviewed = reviewAdjustment(currentBasis, latest.placements, locks, command)
    if (!reviewed.valid) { setIssues(reviewed.issues); setError('이 조정은 현재 필수 조건을 통과하지 못했습니다. 기존 배치를 유지합니다.'); return }
    update({ ...latest, placements: structuredClone(reviewed.placements), placementBasis: structuredClone(currentBasis), previous: structuredClone(latest.placements), previousBasis: latest.placementBasis, dirty: true })
    setSelectedLesson(''); setResult(undefined); setIssues([]); setError('')
    setNotice(reviewed.complete ? command.kind === 'swap' ? '두 수업을 함께 교환하고 전체 필수 조건을 다시 검사했습니다. 직전 배치로 되돌릴 수 있습니다.' : '이동 후 전체 배치를 다시 검사했습니다. 이전 배치는 되돌릴 수 있습니다.' : `작업 초안에 배치했습니다. 미배정 ${reviewed.missingLessonIds.length}개를 더 마쳐야 저장할 수 있습니다.`)
  }
  function undoMove() {
    if (!session?.previous || !session.placements || !effective || !canEdit || conditionPending || session.conditionsChanged) return
    const checked = reviewProtectedPlacements(effective, session.placements, session.previous, workingLocks)
    if (!checked.valid) { setIssues(checked.issues); setError('되돌릴 배치가 현재 조건 또는 작업 고정과 다릅니다. 먼저 해당 고정을 확인해 주세요.'); return }
    update({ ...session, placements: session.previous, placementBasis: structuredClone(effective), previous: session.placements, previousBasis: session.placementBasis, dirty: true })
    setSelectedLesson(''); setResult(undefined); setIssues([]); setError(''); setNotice(checked.complete ? '직전 배치로 돌아왔습니다. 전체 필수 조건을 다시 검사했습니다.' : `직전 미완성 배치로 돌아왔습니다. 남은 미배정 ${checked.missingLessonIds.length}개는 저장 전 마쳐야 합니다.`)
  }
  function loadDraft(draft: TimetableDraft) { if (!basis || locked || session?.dirty) return; const checked = validatePlacements({ ...basis, ...draft.conditions }, draft.placements); if (!checked.valid) { setIssues(checked.issues); return }; update({ ...initialSession(basis, false), title: draft.title, savedDraft: { id: draft.id, version: draft.version, commandKey: canonical(timetableDraftCommand(basis, draft)) }, conditions: structuredClone(draft.conditions), placements: structuredClone(draft.placements), placementBasis: structuredClone({ ...basis, ...draft.conditions }) }); setStep('compose'); setNotice('서버에 저장된 초안을 열었습니다. 이후 저장은 새 초안으로 남습니다.') }
  async function save(retry = false) {
    if (operation.current || practice || !enabled) return
    let request: { command: SaveDraftInput; key: string }
    if (retry) { if (!pending) return; request = pending as { command: SaveDraftInput; key: string } }
    else { if (!basis || !session?.placements || !session.dirty || session.conditionsChanged || conditionPending || !candidateCheck?.valid || !session.title.trim() || !canEdit || !current?.canSave) return; request = { key: crypto.randomUUID(), command: { basisId: basis.id, basisRevision: basis.revision, sourceFingerprint: basis.sourceFingerprint, title: session.title.trim(), conditions: structuredClone(session.conditions), placements: structuredClone(session.placements) } }; recovery.put(request) }
    const epoch = life.current; operation.current = true; setBusy(true); setError(''); setNotice('')
    try { const receipt = await (retry ? server.recoverDraft(member.id, request.command, request.key) : server.saveDraft(member.id, request.command, request.key)); if (epoch !== life.current) return; recovery.remove(request.key); const latest = currentSession.current; if (latest?.placementBasis && canonical(timetableDraftCommand(latest.placementBasis, latest)) === canonical(request.command)) update({ ...latest, dirty: false, savedDraft: { id: receipt.draftId, version: receipt.version, commandKey: canonical(request.command) } }); setNotice('학교 서버에 새 초안을 저장했습니다. 교사에게 공개된 시간표는 바뀌지 않았습니다.'); setReload(value => value + 1) }
    catch (failure) { if (epoch !== life.current) return; if (retry ? failure instanceof ServiceError && failure.code === 'NOT_FOUND' : confirmedRejection(failure)) { recovery.remove(request.key); if (failure instanceof ServiceError && failure.code === 'CONFLICT') setReload(value => value + 1) }; setError(safeMessage(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function makeAiSheet() { if (!basis || !session || !aiText.trim() || stale || locked) return; setAiSheet(['시간표 조건 검토 요청', `기준 자료: ${basis.id} / ${basis.revision}판`, `필수 고정 ${session.conditions.fixed.length}건 · 불가시간 ${session.conditions.unavailable.length}건 · 선호 ${session.conditions.preferences.length}건`, '', aiText.trim(), '', '먼저 모호한 대상·기간을 질문하고 필수 조건과 선호 조건을 구분해 주세요. 확정된 교사·학급·시수는 임의 변경하지 않습니다. 제안만 작성하고 저장·공개·교환 승인은 하지 않습니다.'].join('\n')); setNotice('Claude에게 전달할 요청서를 정리했습니다. 아직 AI에 전송하거나 조건을 바꾸지 않았습니다.') }
  return <section className="timetable-workspace" aria-labelledby={`${id}-heading`}><style>{themeStyles + styles + editorStyles}</style>
    <header className="timetable-heading"><div><p className="timetable-eyebrow">나의 수업</p><h1 id={`${id}-heading`}>시간표</h1><p className="timetable-muted">확정된 수업을 확인하고, 담당자는 다음 시간표를 준비합니다.</p></div><span className="timetable-badge">{practice ? '예시로 편성 연습' : '연결 시험 · 관리자 공개'}</span></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status" className="timetable-notice">{notice}</p>}</div>
    {targetServer && !practice && <TimetableTargetPanel server={targetServer} member={member} disabled={!enabled || otherTargetLocks.current} refreshKey={revision + targetRefresh} onLockChange={setTargetLocked} onStateChange={observeTarget} />}
    {targetChecking && !practice && knownTarget && <p role="status" className="timetable-notice">준비 학기를 다시 확인하는 동안 새 변경을 잠시 멈춥니다. 원래 요청의 결과 확인은 계속할 수 있습니다.</p>}
    {pending && <div className="timetable-notice"><strong>저장 결과를 확인하고 있습니다</strong><p>원래 입력과 요청 번호를 보관했습니다. 새 저장 요청을 만들지 않습니다.</p><p className="timetable-muted">요청 번호: {pending.key}</p><button type="button" disabled={busy || solving || !enabled} onClick={() => void save(true)}>{busy ? '확인 중…' : '같은 요청으로 저장 결과 확인'}</button></div>}
    {(!viewable || current?.canDesign === false) && !pending && !busy && !solving && (session?.dirty || aiText.trim()) && <div className="timetable-notice"><p>이 화면에서 입력한 내용이 현재 탭에 보관되어 메뉴 이동을 잠시 막고 있습니다.</p>{!discardConfirm ? <button type="button" className="secondary" onClick={() => setDiscardConfirm(true)}>보관한 입력 정리</button> : <><p>버리면 작성한 조건·배치·AI 요청 입력을 복구할 수 없습니다. 서버에 저장된 초안은 유지됩니다.</p><div className="timetable-actions"><button type="button" onClick={discardUnavailable}>입력 버리고 메뉴 잠금 해제</button><button type="button" className="secondary" onClick={() => setDiscardConfirm(false)}>입력 계속 보관</button></div></>}</div>}
    {!practice && loading && <p role="status">현재 학교의 시간표 연결을 확인하고 있습니다. 작성 중인 입력은 유지합니다.</p>}
    {!practice && loadError && <div className="timetable-error"><h2>시간표 연결을 다시 확인해 주세요</h2><p>현재 권한을 확인할 때까지 수업과 보관한 입력을 숨깁니다.</p><p>{loadError}</p><div className="timetable-actions"><button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>시간표 연결 다시 확인</button>{enabled && <button type="button" className="secondary" disabled={locked || Boolean(session?.dirty) || Boolean(aiText.trim())} onClick={enterPractice}>예시로 편성 연습</button>}</div><p className="timetable-muted">연습을 직접 선택하면 실제 학교 자료와 구분된 예시만 열립니다.</p></div>}
    {!practice && !loading && !loadError && ready && !ready.available && <div className="timetable-empty"><h2>{ready.reason === 'not_allowed' ? '시간표 이용 권한을 확인해 주세요' : ready.reason === 'basis_missing' ? '시간표 기초 자료를 준비하고 있습니다' : '시간표 서버 연결을 준비하고 있습니다'}</h2><p>학교의 확정 자료가 연결되면 실제 수업을 조회하고 초안을 저장할 수 있습니다.</p><ol><li>학교·교사·학급·시수와 배정을 확인합니다.</li><li>필수 조건과 선호 조건을 정리합니다.</li><li>배치를 만들고 충돌을 검사합니다.</li><li>담당자 검토 후 별도 공개 절차를 진행합니다.</li></ol><div className="timetable-actions"><button type="button" disabled={locked} onClick={() => setReload(value => value + 1)}>연결 상태 다시 확인</button>{ready.reason !== 'not_allowed' && <button type="button" className="secondary" disabled={locked || Boolean(session?.dirty)} onClick={enterPractice}>예시로 편성 연습</button>}{onOpenSchoolAdmin && <button type="button" className="secondary" disabled={navLocked} onClick={onOpenSchoolAdmin}>학교 기초 자료 열기</button>}</div><p className="timetable-muted">편성 연습은 가상 자료만 사용하며 학교 자료를 생성하지 않습니다.</p></div>}
    {practice && <div className="timetable-notice timetable-practice"><strong>가상 자료로 편성 연습 중</strong><p>이 예시는 실제 학교와 연결되지 않습니다. 서버 저장·공개·교환 요청은 실행하지 않습니다.</p><button type="button" className="secondary" disabled={locked} onClick={leavePractice}>연습 마치기 · 연습 입력 버리기</button></div>}
    {viewable && current && <><nav className="timetable-tabs" aria-label="시간표 보기"><button type="button" aria-pressed={tab === 'mine'} disabled={locked || practice} onClick={() => setTab('mine')}>내 시간표</button>{current.canDesign && <button type="button" aria-pressed={tab === 'design'} disabled={locked} onClick={() => setTab('design')}>시간표 만들기</button>}</nav>
      {tab === 'mine' && <><div className="timetable-toolbar"><h2>이번 주 내 수업</h2><label>조회할 날짜<input type="date" aria-label="시간표 조회 날짜" value={week} disabled={locked} onChange={event => { if (event.target.value) setWeek(timetableWeekStart(event.target.value)) }} /></label></div><p className="timetable-muted">{current.weekStart}부터 한 주 · 서버가 확인한 내 수업 관계만 표시합니다. 같은 교시라도 실제 시작·종료 시각을 확인해 주세요.</p><div className="timetable-day-list">{current.lessons.length ? [...current.lessons].sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute).map(lesson => <article key={lesson.id} className="timetable-day-card"><time dateTime={lesson.date}>{lesson.date} · {timetableClock(lesson.startMinute)}–{timetableClock(lesson.endMinute)}</time><h3>{lesson.label} {lesson.status !== 'scheduled' && <span className="timetable-badge">{lesson.status === 'changed' ? '변경됨' : '취소됨'}</span>}</h3><p>{lesson.classNames.join(' · ')}{lesson.roomNames.length ? ` / ${lesson.roomNames.join(' · ')}` : ''}</p><p className="timetable-muted">{lesson.teacherNames.join(' · ')} · 확인한 수업 {lesson.version}판</p></article>) : <div className="timetable-empty"><h3>이 주에 공개된 내 수업이 없습니다</h3><p>저장한 편성 초안은 교사에게 공개된 시간표와 구분됩니다.</p></div>}</div><details><summary>수업 교환·변경은 어떻게 하나요?</summary><p>상단의 확정·공유·교환 화면에서 해당 날짜의 수업을 선택하면 변경안을 검토하고 관련 교사의 동의와 담당자 승인 절차를 진행할 수 있습니다. 실제 서버 연결과 현재 권한을 확인한 뒤 요청합니다.</p></details></>}
      {tab === 'design' && basis && session && <><ol className="timetable-steps" aria-label="시간표 편성 단계">{steps.map((item, index) => <li key={item.id}><button type="button" aria-current={step === item.id ? 'step' : undefined} disabled={locked} onClick={() => navigateStep(item.id)}><span className="timetable-step-number" aria-hidden="true">{index + 1}</span>{item.label}</button></li>)}</ol>
        <TimetableEditorProgress revision={basis.revision} conditionCount={session.conditions.fixed.length + session.conditions.unavailable.length + session.conditions.preferences.length} conditionPending={conditionPending} stale={stale} checkingRequired={Boolean(session.conditionsChanged)} hasPlacements={Boolean(session.placements)} valid={Boolean(candidateCheck?.valid)} missingCount={partialCheck?.valid ? partialCheck.missingLessonIds.length : undefined} dirty={session.dirty} practice={practice} pending={Boolean(pending)} />
        <TimetableFlowGuide state={{ step, pending: Boolean(pending), busy: busy || solving || aiLocked || preparationLocked, stale, conditionPending, basisValid: Boolean(inputCheck?.valid), foundationReady: Boolean(foundation?.ready), canCalculate: Boolean(preflight?.canCalculate), checkingRequired: Boolean(session.conditionsChanged), hasPlacements: Boolean(session.placements), valid: Boolean(candidateCheck?.valid), missingCount: partialCheck?.valid ? partialCheck.missingLessonIds.length : 0, dirty: session.dirty, practice, canSave: current.canSave, saved: savedForCurrent }} onStep={navigateStep} onHandoff={onOpenOperations ? openSavedPublication : undefined} handoffDisabled={navLocked || !savedForCurrent} />
        {stale && <div role="alert" className="timetable-error"><strong>기초 자료가 바뀌었습니다</strong><p>작성한 조건과 배치는 보관했지만 이전 기준으로 계산하거나 저장하지 않습니다. 새 기준을 확인하고 편성을 다시 준비해 주세요.</p><button type="button" disabled={locked} onClick={resetDraft}>기존 초안 입력 버리고 새 기준으로 시작</button></div>}
        {conditionPending && <div className="timetable-notice"><p>입력 중인 조건이 아직 추가되지 않았습니다. 조건을 추가하거나 비운 뒤 계산·저장해 주세요.</p><div className="timetable-actions"><button type="button" className="secondary" disabled={locked} onClick={() => navigateStep('conditions')}>입력 중인 조건 확인</button><button type="button" className="secondary" disabled={!canEdit} onClick={clearConditionInput}>입력 중인 조건 비우기</button></div></div>}
        {step === 'basis' && <section className="timetable-card"><h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">1. 기초 자료 확인</h2><p>교사·학급·시수는 학교가 확정한 자료를 사용합니다. 시간표 담당자는 이 화면에서 원래 배정을 바꾸지 않습니다.</p><dl className="timetable-summary"><div><dt>기준판</dt><dd>{basis.revision}판</dd></div><div><dt>편성할 수업</dt><dd>{basis.lessons.length}개</dd></div><div><dt>수업 시수</dt><dd>{basis.courseLoads.reduce((n, row) => n + row.periods, 0)}차시</dd></div><div><dt>교사 / 학급</dt><dd>{basis.resources.filter(row => row.kind === 'teacher').length} / {basis.resources.filter(row => row.kind === 'class').length}</dd></div></dl><p className="timetable-muted">수업별 허용 시간대와 실제 시각, 함께 참여하는 교사·학급·학생 집단·공간을 검사합니다.</p><FoundationPanel basis={effective ?? basis} /><div className="timetable-actions"><button type="button" disabled={locked || stale} onClick={() => navigateStep('conditions')}>조건 정리로 이동</button>{onOpenSchoolAdmin && !practice && <button type="button" className="secondary" disabled={navLocked} onClick={onOpenSchoolAdmin}>기초 자료 수정 요청하러 이동</button>}</div></section>}
        {step === 'conditions' && <section className="timetable-card"><h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">2. 필수 조건과 선호 조건</h2><p>필수 조건은 지키지 못하면 배치할 수 없습니다. 선호 조건은 지킬 수 없더라도 필수 조건을 어기지 않습니다.</p>{assistantServer && !practice && <button type="button" className="secondary" disabled={locked || stale || conditionPending} onClick={() => setAiOpenRequest(value => ({ stage: 'setup', token: (value?.token ?? 0) + 1 }))}>Claude 조건 도움 열기</button>}<fieldset disabled={!canEdit || batchPending}><label className="timetable-condition-search">조건 대상 검색<input type="search" aria-label="조건 대상 검색" value={conditionSearch} onChange={event => setConditionSearch(event.target.value)} placeholder="교사·학급 또는 수업 이름" /><small>검색 {matchingTargets.length}개{selectedTarget && !matchingTargets.includes(selectedTarget) ? ' · 검색 밖의 선택 대상은 유지합니다.' : ''}</small></label><div className="timetable-grid"><label>조건 종류<select aria-label="조건 종류" value={session.form.kind} onChange={event => { changeForm({ kind: event.target.value as ConditionForm['kind'], targetId: '', slotId: '' }); setConditionSearch('') }}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'}<select aria-label={session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'} value={session.form.targetId} onChange={event => changeForm({ targetId: event.target.value, slotId: '' })}><option value="">선택해 주세요</option>{shownTargets.map(row => <option key={row.id} value={row.id}>{targetLabel(row)}</option>)}</select></label><label>조건 시간<select aria-label="조건 시간" disabled={!session.form.targetId} value={session.form.slotId} onChange={event => changeForm({ slotId: event.target.value })}><option value="">선택해 주세요</option>{basis.slots.filter(slot => session.form.kind === 'unavailable' || basis.lessons.find(row => row.id === session.form.targetId)?.allowedSlotIds.includes(slot.id)).map(slot => <option key={slot.id} value={slot.id}>{slotLabel(basis, slot.id)}</option>)}</select></label>{session.form.kind === 'preferences' && <label>피하고 싶은 정도<input aria-label="피하고 싶은 정도" type="number" min="1" max={timetablePolicy.maxWeight} step="1" value={session.form.weight} onChange={event => changeForm({ weight: event.target.value })} /></label>}</div><section className="timetable-condition-preview" aria-live="polite" aria-label="추가할 조건 확인"><p>{selectedTarget ? <>{conditionLabels[session.form.kind]} · {targetLabel(selectedTarget)}{selectedConditionTime ? ` · ${selectedConditionTime}` : ' · 시간을 선택해 주세요.'}</> : '대상을 먼저 선택한 뒤 시간을 지정해 주세요.'}</p>{singleConditionPending && <p className="timetable-muted">아직 조건 목록에 추가하지 않았습니다.</p>}</section><button type="button" disabled={!session.form.targetId || !session.form.slotId} onClick={addCondition}>조건 추가</button></fieldset><p className="timetable-muted">선호의 숫자가 클수록 해당 시간대를 더 피하려고 합니다. 이번 계산은 가능한 배치를 우선 찾으며 최적 점수를 보장하지 않습니다.</p>
          <ConditionBatchPanel basis={basis} conditions={session.conditions} state={session.conditionBatch ?? initialConditionBatch()} disabled={!canEdit || singleConditionPending} onStateChange={changeBatch} onApply={(conditions, sourceKey) => changeConditions(conditions, false, sourceKey)} /><ConditionCards basis={basis} conditions={session.conditions} disabled={!canEdit || batchPending} onRemove={removeCondition} /><div className="timetable-actions"><button type="button" className="secondary" disabled={locked} onClick={() => navigateStep('basis')}>기초 자료 다시 확인</button><button type="button" disabled={!canEdit || !inputCheck?.valid} onClick={() => navigateStep('compose')}>배치 만들기로 이동</button></div></section>}
        {step === 'compose' && <><section className="timetable-card"><div className="timetable-actions"><button type="button" className="secondary" disabled={locked} onClick={() => navigateStep('conditions')}>조건 다시 살펴보기</button></div><div className="timetable-toolbar"><div><h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">3. 배치 만들기와 조정</h2><p>수업을 눌러 이동하거나 두 수업을 함께 바꿀 수 있습니다. 미배정 수업도 이어서 완성할 수 있습니다.</p></div><div className="timetable-actions"><button type="button" disabled={!canEdit || conditionPending || !inputCheck?.valid || !foundation?.ready || !preflight?.canCalculate} onClick={() => void generate()}>{session.placements ? '다시 계산' : '배치 만들기'}</button>{solving && <button type="button" className="secondary" onClick={() => solver.current?.cancel()}>계산 중지</button>}</div></div>{solving && <p role="status">별도 계산 작업자에서 배치를 찾고 있습니다. 중지해도 입력은 유지됩니다.</p>}{result && <details className="timetable-calculation-details"><summary>계산 결과 자세히</summary><p className="timetable-muted">이번 탐색 {result.stats.nodes.toLocaleString()}개 · {Math.round(result.stats.elapsedMs)}ms{result.score !== null ? ` · 선호 벌점 ${result.score}` : ''} · 최적해 보장 없음</p></details>}{session.placements && !session.conditionsChanged && candidateCheck && <p className={candidateCheck.valid ? 'timetable-validation' : 'timetable-error'} role="status">{candidateCheck.valid ? '전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인' : partialCheck?.valid && partialCheck.missingLessonIds.length ? `배치된 수업 검사 통과 · 미배정 ${partialCheck.missingLessonIds.length}개 · 저장·확정 전 완성 필요` : '충돌이 있어 이 배치를 저장할 수 없습니다.'}</p>}{session.placements && effective && !session.conditionsChanged ? <><TimetableQualitySummary basis={effective} placements={session.placements} previous={session.previous} previousBasis={session.previousBasis} />{assistantServer && !practice && <button type="button" className="secondary" disabled={locked || stale || conditionPending || !candidateCheck?.valid} onClick={() => setAiOpenRequest(value => ({ stage: 'adjust', token: (value?.token ?? 0) + 1 }))}>Claude 결과 검토 열기</button>}<label>표에서 볼 대상<select aria-label="표에서 볼 대상" value={filter} disabled={locked} onChange={event => setFilter(event.target.value)}><option value="">전체 수업</option>{basis.resources.map(resource => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select></label><div className="timetable-actions"><button type="button" className="secondary" disabled={!canEdit || conditionPending || !candidateCheck?.valid || !filter} onClick={() => void generate(filter)}>선택 대상만 다시 계산</button><span className="timetable-muted">작업 중 고정 {workingLocks.length}개 · 선택 대상 밖의 배치도 유지합니다.</span></div><TimetableBoard basis={effective} placements={session.placements} filterResourceId={filter} selectedLessonId={selectedLesson} disabled={!canEdit || conditionPending} onSelect={lessonId => { setSelectedLesson(lessonId); setError('') }} /><TimetableAdjustmentPanel basis={effective} placements={session.placements} lockedLessonIds={workingLocks} selectedLessonId={selectedLesson} disabled={!canEdit || conditionPending} onSelect={setSelectedLesson} onToggleLock={toggleWorkingLock} onApply={applyAdjustment} /><div className="timetable-actions"><button type="button" className="secondary" disabled={!canEdit || conditionPending || !session.previous} onClick={undoMove}>직전 배치로 되돌리기</button><button type="button" disabled={!candidateCheck?.valid || conditionPending || locked || stale} onClick={() => navigateStep('publish')}>초안 저장·공개 검토</button></div></> : <div className="timetable-empty">{session.conditionsChanged ? <><p>조건 변경 전의 배치를 보관하고 있습니다. 다시 검사하면 기존 배치를 보며 조정할 수 있습니다.</p><button type="button" disabled={!canEdit || conditionPending} onClick={recheckWorkingPlacements}>보관한 배치 다시 검사</button></> : "아직 만든 배치가 없습니다. 조건을 확인한 뒤 배치 만들기를 눌러 주세요."}</div>}</section>{current.drafts.length > 0 && <section className="timetable-card"><h3>저장한 초안</h3><ul className="timetable-list">{current.drafts.map(draft => <li key={draft.id} className="timetable-list-row"><div>{draft.title}<small>기초 자료 {draft.basisRevision}판 · 초안 {draft.version}판</small></div><button type="button" className="secondary" disabled={locked || Boolean(session.dirty)} onClick={() => loadDraft(draft)}>이 초안 열기</button></li>)}</ul>{session.dirty && <p className="timetable-muted">작성 중인 초안을 저장하거나 새 편성으로 정리한 뒤 다른 초안을 열 수 있습니다.</p>}</section>}</>}
        {step === 'publish' && <section className="timetable-card"><h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">4. 초안 저장과 공개 검토</h2><p>저장한 초안은 담당자의 작업 자료입니다. 확정된 시간표로 자동 공개하지 않습니다.</p><label>초안 이름<input aria-label="초안 이름" value={session.title} disabled={!canEdit} maxLength={limits.title} onChange={event => { if (session) update({ ...session, title: event.target.value, dirty: true }) }} /></label>{candidateCheck?.valid && !session.conditionsChanged ? <p className="timetable-notice">기초 자료 {basis.revision}판 · {session.placements?.length}개 수업 · 필수 조건 검사 통과</p> : <p className="timetable-error">{session.conditionsChanged ? "보관한 배치를 새 조건으로 다시 검사해 주세요." : "필수 조건을 통과한 배치를 먼저 만들어 주세요."}</p>}<div className="timetable-actions">{!practice && <button type="button" disabled={!canEdit || !session.dirty || session.conditionsChanged || conditionPending || !current.canSave || !candidateCheck?.valid || !session.title.trim()} onClick={() => void save()}>새 초안으로 서버에 저장</button>}<button type="button" className="secondary" disabled={locked} onClick={() => navigateStep('compose')}>배치 다시 살펴보기</button></div>{practice && <p className="timetable-muted">연습 자료는 학교 서버에 저장하지 않습니다.</p>}<div className="timetable-empty"><h3>저장 후 확정·공유·교환으로 이동</h3><p>초안을 저장하고 상단의 확정·공유·교환 화면에서 적용 기간과 변경 영향을 검토한 뒤 확정하세요. 실제 서버 준비 상태는 그 화면에서 확인합니다. 이번 초안 저장은 학생 기록이나 기존 시간표를 바꾸지 않습니다.</p></div></section>}
        {issues.length > 0 && <div className="timetable-error"><h3>확인할 항목</h3><IssueList issues={issues} /></div>}
        {step === 'compose' && effective && <Suspense fallback={<p role="status">후보 비교 도구를 준비하는 중…</p>}><TimetableCandidateLibrary member={member} basis={effective} placements={session.placements} title={session.title} disabled={!canEdit || conditionPending || Boolean(session.conditionsChanged)} onAdopt={adoptEngineCandidate} /></Suspense>}
        {step === 'compose' && effective && <TimetablePreflightPanel basis={effective} />}
        {step === 'compose' && effective && <Suspense fallback={<p role="status">최적화 도구를 준비하는 중…</p>}><TimetableEnginePanel member={member} basis={effective} placements={session.placements} previous={session.placementBasis && session.placements ? { basis: session.placementBasis, placements: session.placements } : undefined} lockedLessonIds={workingLocks} scopeResourceId={filter} disabled={!canEdit || conditionPending || !foundation?.ready} onAdopt={adoptEngineCandidate} /></Suspense>}
        <Suspense fallback={<p role="status">엑셀 작업 도구를 준비하는 중…</p>}><TimetableWorkbookPanel basis={basis} conditions={session.conditions} placements={session.placements ?? []} title={session.title} disabled={!canEdit || conditionPending} onImport={importWorkingDraft} /></Suspense>
        {(!assistantServer || practice) && <details className="timetable-card"><summary>Claude에게 조건 정리를 부탁하려면</summary><p>AI는 조건을 정리하고 조정안을 제안합니다. 계산과 충돌 검사는 프로그램이 담당합니다. 학교 비서 연결이 준비되면 아래 Claude 도움에서 직접 요청할 수 있습니다. 이 요청서는 외부 검토용으로만 정리합니다.</p><label>정리하고 싶은 요청<textarea aria-label="정리하고 싶은 요청" rows={3} maxLength={limits.assistantText} value={aiText} disabled={locked || stale} onChange={event => { setAiText(event.target.value); setAiSheet('') }} placeholder="예: 수요일 오후 교사 회의 시간을 피하고 싶어요. 필수 조건인지 선호 조건인지 먼저 확인해 주세요." /></label><div className="timetable-actions"><button type="button" className="secondary" disabled={!aiText.trim() || locked || stale} onClick={makeAiSheet}>Claude 전달용 요청서 정리</button><button type="button" className="secondary" disabled={locked} onClick={() => { setAiText(''); setAiSheet('') }}>AI 요청 입력 비우기</button></div>{aiSheet && <label>Claude 전달용 요청서<textarea aria-label="Claude 전달용 요청서" rows={8} readOnly value={aiSheet} /></label>}<p className="timetable-muted">요청서는 자동 전송되지 않습니다. 개인의 결근·상담 사유는 넣지 마세요.</p></details>}
        <details><summary>편성을 처음부터 다시 준비</summary><p>지금 작성 중인 조건과 배치를 버리고 현재 기초 자료에서 다시 시작합니다. 서버에 저장한 초안은 지우지 않습니다.</p><button type="button" className="secondary" disabled={locked} onClick={resetDraft}>현재 편성 입력 버리고 새로 시작</button></details>
      </>}
    </>}
    {(((preparationServer || setupServer) && !practice) || preparationRecovery.request || setupRecovery.request || setupBatchRecovery.request) && <Suspense fallback={<p role="status">학교 편성 준비 화면을 준비하는 중…</p>}><TimetablePreparationPanel server={practice ? undefined : preparationServer} setupServer={practice ? undefined : setupServer} onOpenSchoolAdmin={onOpenSchoolAdmin} member={member} expectedTermId={knownTarget?.termId} refreshRevision={targetEpoch} disabled={targetBlocked || commandLocked || aiLocked || !enabled || practice || Boolean(session?.dirty) || conditionPending} onLockChange={setPreparationLocked} onBasisConfirmed={() => setReload(value => value + 1)} /></Suspense>}
    {((assistantServer && !practice) || aiRecovery.request) && <Suspense fallback={<p role="status">시간표 AI 도움을 준비하는 중…</p>}><TimetableAssistantPanel openRequest={aiOpenRequest} server={practice ? undefined : assistantServer} member={member} basis={viewable && !stale && current?.canDesign ? basis : null} conditions={viewable && !stale && current?.canDesign ? session?.conditions ?? null : null} placements={viewable && !stale && current?.canDesign ? session?.placements ?? [] : []} disabled={targetBlocked || commandLocked || preparationLocked || !viewable || stale || !basis || !session || practice || !current?.canDesign || conditionPending} onApply={conditions => changeConditions(conditions, true)} onLockChange={setAiLocked} onInputLockChange={setAiInputLocked} /></Suspense>}
  </section>
}
export function IssueList({ issues }: { issues: TimetableIssue[] }) { return <ul className="timetable-issues">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message} <small className="timetable-muted">({issue.code})</small></li>)}</ul> }
