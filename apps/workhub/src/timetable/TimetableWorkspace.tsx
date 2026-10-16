import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { activeAt } from '../domain'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { validateBasis, validatePlacements, validateSolveResult, timetablePolicy } from '../../../../packages/timetable/src/validate'
import type { TimetableIssue, SolveResult } from '../../../../packages/timetable/src/types'
import { createTimetableServer, timetableWeekStart } from './server'
import type { TimetableServer, TimetableReadiness, TimetableSnapshot, TimetableBasis, TimetableConditions, Placement, SaveDraftInput, TimetableDraft } from './contracts'
import { startTimetableSolve, TimetableSolverError, type TimetableSolver, type SolverTask } from './worker-client'
import { timetablePracticeSnapshot } from './sample'
import limits from './limits.json'
import styles from './timetable.css?inline'
import themeStyles from './timetable-theme.css?inline'
import { TimetableBoard } from './TimetableBoard'
import { FoundationPanel } from './FoundationPanel'
import { TimetableQualitySummary } from './TimetableQualitySummary'
import { ConditionCards } from './ConditionCards'
import { prepareScopedSolve, reviewTimetableFoundation } from './foundation'
import type { TimetableWorkbookDraft } from './workbook'
import { createAssistantServer } from '../assistant/server'
import type { AssistantServer } from '../assistant/contracts'
import type { AssistantHttpPort } from '../assistant/http'
import { createPreparationServer } from './preparation-server'
import type { PreparationServer } from './preparation'
export { TimetableBoard } from './TimetableBoard'
const TimetableOperationsWorkspace = lazy(() => import('./TimetableOperationsWorkspace').then(module => ({ default: module.TimetableOperationsWorkspace })))
const TimetableWorkbookPanel = lazy(() => import('./TimetableWorkbookPanel').then(module => ({ default: module.TimetableWorkbookPanel })))
const TimetableEnginePanel = lazy(() => import('./TimetableEnginePanel').then(module => ({ default: module.TimetableEnginePanel })))
const TimetableAssistantPanel = lazy(() => import('./TimetableAssistantPanel').then(module => ({ default: module.TimetableAssistantPanel })))
const TimetablePreparationPanel = lazy(() => import('./TimetablePreparationPanel').then(module => ({ default: module.TimetablePreparationPanel })))
const timetableAssistantHttp: AssistantHttpPort = { async send(payload, expectedUserId, writing) { const { legacyAssistantHttp } = await import('../assistant/legacy-http'); return legacyAssistantHttp.send(payload, expectedUserId, writing) } }

type Step = 'basis' | 'conditions' | 'compose' | 'publish'
type ConditionForm = { kind: 'fixed' | 'unavailable' | 'preferences'; targetId: string; slotId: string; weight: string }
interface DraftSession {
  practice: boolean; basisIdentity: string; title: string; conditions: TimetableConditions
  placements: Placement[] | null; previous: Placement[] | null; dirty: boolean; form: ConditionForm
  conditionsChanged?: boolean; lockedLessonIds?: string[]
  placementBasis?: TimetableBasis; previousBasis?: TimetableBasis
}
interface WorkspaceProps { connection: SupabaseConnection; member: Membership; date: string; revision?: number; onNavigationLockChange?: (locked: boolean) => void; onOpenSchoolAdmin?: () => void; initialLessonId?: string; initialDate?: string }
interface PanelProps extends Omit<WorkspaceProps, 'connection'> { server: TimetableServer; assistantServer?: AssistantServer; preparationServer?: PreparationServer; runSolver?: TimetableSolver }
const days = ['월', '화', '수', '목', '금', '토', '일']
const steps: { id: Step; label: string }[] = [{ id: 'basis', label: '기초 자료' }, { id: 'conditions', label: '조건 정리' }, { id: 'compose', label: '배치·비교' }, { id: 'publish', label: '공개 검토' }]
const basisIdentity = (basis: TimetableBasis) => canonical([basis.schoolId, basis.termId, basis.id, basis.revision, basis.sourceFingerprint])
const initialSession = (basis: TimetableBasis, practice: boolean): DraftSession => ({ practice, basisIdentity: basisIdentity(basis), title: '시간표 초안', conditions: { fixed: structuredClone(basis.fixed), unavailable: structuredClone(basis.unavailable), preferences: structuredClone(basis.preferences) }, placements: null, previous: null, dirty: false, form: { kind: 'fixed', targetId: '', slotId: '', weight: '1' } })
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
  const route = useEditDraft<'editor' | 'operations'>(props.member, 'timetable-entry')
  const recovery = usePendingRequest(props.member, 'timetableOperations')
  const [mode, setMode] = useState<'editor' | 'operations'>(() => recovery.request || props.initialLessonId !== undefined ? 'operations' : route.initial ?? 'editor')
  const [locked, setLocked] = useState(false)
  const notifyLock = useCallback((value: boolean) => {
    setLocked(value)
    props.onNavigationLockChange?.(value)
  }, [props.onNavigationLockChange])
  function navigate(next: 'editor' | 'operations') {
    if (locked || next === mode) return
    route.save(next, false)
    setMode(next)
  }
  return <><style>{themeStyles}</style>
    <nav aria-label="시간표 작업 구분" className="timetable-entry-navigation" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      <button type="button" className="secondary" aria-pressed={mode === 'editor'} disabled={locked && mode !== 'editor'} onClick={() => navigate('editor')}>내 수업·편성</button>
      <button type="button" className="secondary" aria-pressed={mode === 'operations'} disabled={locked && mode !== 'operations'} onClick={() => navigate('operations')}>확정·공유·교환</button>
    </nav>
    {mode === 'editor'
      ? <TimetableWorkspacePanel {...props} server={server} assistantServer={assistantServer} preparationServer={preparationServer} onNavigationLockChange={notifyLock} />
      : <Suspense fallback={<p role="status">시간표 운영 화면을 준비하는 중…</p>}><TimetableOperationsWorkspace {...props} onNavigationLockChange={notifyLock} /></Suspense>}
  </>
}
export function TimetableWorkspacePanel({ server, assistantServer, preparationServer, member, date, revision = 0, onNavigationLockChange, onOpenSchoolAdmin, runSolver = startTimetableSolve }: PanelProps) {
  const id = useId(), memory = useEditDraft<DraftSession>(member, 'timetable-editor'), aiMemory = useEditDraft<{text:string;sheet:string}>(member, 'timetable-ai'), recovery = usePendingRequest(member, 'timetable')
  const aiRecovery = usePendingRequest(member, 'timetableAssistant'), preparationRecovery = usePendingRequest(member, 'timetablePreparation')
  const [session, setSession] = useState<DraftSession | undefined>(() => memory.initial), [practice, setPractice] = useState(Boolean(memory.initial?.practice))
  const [tab, setTab] = useState<'mine' | 'design'>(() => memory.initial ? 'design' : 'mine'), [step, setStep] = useState<Step>('basis'), [discardConfirm, setDiscardConfirm] = useState(false)
  const [week, setWeek] = useState(() => timetableWeekStart(date)), [snapshot, setSnapshot] = useState<TimetableSnapshot>(), [ready, setReady] = useState<TimetableReadiness>()
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [solving, setSolving] = useState(false)
  const [aiLocked, setAiLocked] = useState(false)
  const [preparationLocked, setPreparationLocked] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [issues, setIssues] = useState<TimetableIssue[]>([]), [result, setResult] = useState<SolveResult>()
  const [selectedLesson, setSelectedLesson] = useState(''), [moveSlot, setMoveSlot] = useState(''), [filter, setFilter] = useState(''), [aiText, setAiText] = useState(aiMemory.initial?.text ?? ''), [aiSheet, setAiSheet] = useState(aiMemory.initial?.sheet ?? '')
  const life = useRef(0), operation = useRef(false), solver = useRef<SolverTask>(), currentSession = useRef(session), feedback = useRef<HTMLDivElement>(null)
  currentSession.current = session
  const enabled = activeAt(member, date), pending = recovery.request
  const current = practice ? timetablePracticeSnapshot(date) : !loadError && !loading && ready?.available ? snapshot : undefined
  const basis = current?.canDesign ? current.basis : null
  const stale = Boolean(basis && session && session.basisIdentity !== basisIdentity(basis))
  const effective = basis && session && !stale ? { ...basis, ...session.conditions } : basis
  const candidateCheck = effective && session?.placements && !stale ? validatePlacements(effective, session.placements) : undefined
  const inputCheck = effective ? validateBasis(effective) : undefined
  const foundation = useMemo(() => effective ? reviewTimetableFoundation(effective) : undefined, [effective])
  const workingLocks = session?.lockedLessonIds ?? []
  const conditionPending = Boolean(session?.form.targetId || session?.form.slotId)
  const liveBasis = useRef<{basis:TimetableBasis|null|undefined; allowed:boolean}>({basis:effective,allowed:false})
  const commandLocked = busy || solving || Boolean(pending), locked = commandLocked || aiLocked || preparationLocked, navLocked = locked || Boolean(session?.dirty) || Boolean(aiText.trim())
  const canEdit = Boolean(basis && session && !stale && !locked && (practice || current?.canDesign)), viewable = Boolean(practice || (!loadError && !loading && ready?.available && snapshot))
  liveBasis.current = {basis:effective,allowed:viewable && !!current?.canDesign && !stale}
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
  }, [server, member.id, week, enabled, revision, reload])
  useEffect(() => { if (basis && !session) update(initialSession(basis, practice)) }, [basis, session, practice])
  useEffect(() => { aiMemory.save(aiText || aiSheet ? {text:aiText,sheet:aiSheet} : undefined, Boolean(aiText.trim())) }, [aiText,aiSheet,aiMemory])
  useEffect(() => { if (current && !current.canDesign && !practice && session) { setTab('mine');setResult(undefined);setIssues([]) } }, [current,practice,session])
  useEffect(() => { if (!viewable || stale) { solver.current?.cancel(); setSelectedLesson(''); setMoveSlot('') } }, [viewable, stale])
  useEffect(() => { setFilter(basis?.resources.find(row => row.kind === 'teacher')?.id ?? '') }, [basis?.id,basis?.revision,basis?.sourceFingerprint])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  function discardUnavailable() { if (locked) return;update(undefined);setAiText('');setAiSheet('');setDiscardConfirm(false);setResult(undefined);setIssues([]);setError('');setNotice('보관한 입력을 버렸습니다. 이제 다른 메뉴로 이동할 수 있습니다.') }
  function enterPractice() { if (locked || session?.dirty) return; const sample = timetablePracticeSnapshot(date); setPractice(true); update(initialSession(sample.basis!, true)); setTab('design'); setStep('basis'); setError(''); setNotice('예시 자료로 편성 연습을 시작했습니다. 실제 학교에 저장하거나 공개하지 않습니다.') }
  function leavePractice() { if (locked) return; setPractice(false); update(undefined); setResult(undefined); setIssues([]); setTab('mine'); setAiText(''); setAiSheet(''); setNotice('편성 연습을 마쳤습니다. 연습 자료는 학교에 저장되지 않았습니다.') }
  function resetDraft() { if (!basis || locked) return; update(initialSession(basis, practice)); setIssues([]); setResult(undefined); setSelectedLesson(''); setMoveSlot(''); setError(''); setNotice('현재 기초 자료로 새 편성을 준비했습니다.'); setAiText(''); setAiSheet('') }
  function changeConditions(conditions: TimetableConditions, fromAssistant = false) { if (!session || !(fromAssistant ? basis && !stale && !commandLocked && viewable && current?.canDesign && !conditionPending : canEdit)) return; update({ ...session, conditions, conditionsChanged: Boolean(session.placements), dirty: true, form: { ...session.form, targetId: '', slotId: '' } }); setResult(undefined); setIssues([]); setSelectedLesson(''); setMoveSlot(''); setAiSheet(''); setError(''); setNotice('조건을 바꿨습니다. 기존 배치는 보관했습니다. 새 조건으로 다시 검사하거나 재계산해 주세요.') }
  function recheckWorkingPlacements() {
    if (!session?.placements || !effective || !canEdit || conditionPending) return
    const checked = validatePlacements(effective, session.placements)
    update({ ...session, placementBasis: checked.valid ? structuredClone(effective) : session.placementBasis, conditionsChanged: false, dirty: true }); setIssues(checked.issues)
    setNotice(checked.valid ? '보관한 배치가 새 조건을 통과했습니다. 그대로 조정하거나 저장할 수 있습니다.' : '보관한 배치를 열었습니다. 충돌을 해결하기 전에는 학교 서버에 저장하거나 확정할 수 없습니다.'); setError('')
  }
  function importWorkingDraft(draft: TimetableWorkbookDraft) {
    if (!basis || !session || !canEdit || conditionPending) return
    const importedBasis = { ...basis, ...draft.conditions }
    update({ ...session, title: draft.title, conditions: structuredClone(draft.conditions), placements: structuredClone(draft.placements), placementBasis: validatePlacements(importedBasis, draft.placements).valid ? structuredClone(importedBasis) : undefined, previous: session.placements ? structuredClone(session.placements) : null, previousBasis: session.placementBasis, lockedLessonIds: [], conditionsChanged: true, dirty: true })
    setSelectedLesson(''); setMoveSlot(''); setIssues([]); setResult(undefined); setAiSheet(''); setStep('compose'); setError(''); setNotice('엑셀 내용을 작업 초안에 가져왔습니다. 배치를 다시 검사한 뒤 이어서 조정해 주세요. 학교 서버에는 아직 저장하지 않았습니다.')
  }
  function adoptEngineCandidate(placements: Placement[]) {
    if (!session || !effective || !canEdit || conditionPending) return
    const prepared = prepareScopedSolve(effective, session.placements, workingLocks)
    if (!prepared.basis) { setIssues(prepared.issues); return }
    const checked = validatePlacements(prepared.basis, placements)
    if (!checked.valid) { setIssues(checked.issues); setError('최적화 후보가 현재 조건과 일치하지 않습니다. 원래 요청을 다시 확인해 주세요.'); return }
    update({ ...session, placements: structuredClone(placements), placementBasis: structuredClone(effective), previous: session.placements ? structuredClone(session.placements) : null, previousBasis: session.placementBasis, conditionsChanged: false, dirty: true })
    setSelectedLesson(''); setMoveSlot(''); setResult(undefined); setIssues([]); setError(''); setStep('compose'); setNotice('최적화 후보를 현재 작업 초안에 반영했습니다. 학교 서버 저장과 시간표 확정은 별도로 진행해 주세요.')
  }
  function toggleWorkingLock(lessonId: string) {
    if (!session?.placements || !canEdit || session.conditionsChanged || basis?.fixed.some(row => row.lessonId === lessonId)) return
    if (!session.placements.some(row => row.lessonId === lessonId)) return
    const next = workingLocks.includes(lessonId) ? workingLocks.filter(id => id !== lessonId) : [...workingLocks, lessonId]
    update({ ...session, lockedLessonIds: next, dirty: true }); setMoveSlot(''); setNotice(next.includes(lessonId) ? '이 배치를 다음 계산에서 유지합니다. 학교의 공식 조건은 바뀌지 않습니다.' : '작업 중 배치 고정을 풀었습니다. 학교의 공식 조건은 유지됩니다.')
  }
  function changeForm(patch: Partial<ConditionForm>) { if (!session || !canEdit) return; update({ ...session, dirty: true, form: { ...session.form, ...patch } }); setError(''); setIssues([]) }
  function addCondition() {
    if (!session || !basis || !canEdit) return
    const form = session.form, slot = basis.slots.find(item => item.id === form.slotId), conditions = structuredClone(session.conditions)
    if (!slot || !form.targetId) { setError('조건을 적용할 대상과 시간을 선택해 주세요.'); return }
    if (form.kind === 'fixed') conditions.fixed.push({ lessonId: form.targetId, slotId: slot.id })
    else if (form.kind === 'unavailable') conditions.unavailable.push({ resourceId: form.targetId, day: slot.day, startMinute: slot.startMinute, endMinute: slot.endMinute })
    else conditions.preferences.push({ lessonId: form.targetId, slotId: slot.id, weight: Number(form.weight) })
    const checked = validateBasis({ ...basis, ...conditions }); if (!checked.valid) { setIssues(checked.issues); setError('추가할 조건을 확인해 주세요.'); return }; changeConditions(conditions)
  }
  function removeCondition(kind: keyof TimetableConditions, index: number) {
    if (!session || !basis || !canEdit) return
    const item = session.conditions[kind][index]
    if (kind !== 'preferences' && basis[kind].some(row => canonical(row) === canonical(item))) { setError('학교가 확정한 필수 조건은 여기서 해제할 수 없습니다. 기초 자료 담당자에게 수정을 요청해 주세요.'); return }
    const conditions = structuredClone(session.conditions); conditions[kind].splice(index, 1); changeConditions(conditions)
  }
  async function generate(scopeResourceId = '') {
    if (!effective || !session || !canEdit || operation.current || conditionPending) return
    const checked = validateBasis(effective); if (!checked.valid || !foundation?.ready) { setIssues([...checked.issues, ...(foundation?.issues ?? [])]); setError('기초 자료와 조건을 먼저 확인해 주세요.'); return }
    const prepared = prepareScopedSolve(effective, session.placements, workingLocks, scopeResourceId)
    if (!prepared.basis) { setIssues(prepared.issues); setError('고정 배치와 부분 재계산 범위를 확인해 주세요.'); return }
    const solveBasis = prepared.basis
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
  const movedPlacements = session?.placements && selectedLesson && moveSlot ? session.placements.map(item => item.lessonId === selectedLesson ? { lessonId: selectedLesson, slotId: moveSlot } : item) : undefined
  const moveBasis = effective && session?.placements ? prepareScopedSolve(effective, session.placements, workingLocks).basis : undefined
  const moveCheck = moveBasis && movedPlacements ? validatePlacements(moveBasis, movedPlacements) : undefined
  function moveLesson() { if (!session || !canEdit || !movedPlacements || !moveCheck?.valid) return; update({ ...session, placements: movedPlacements, placementBasis: effective ? structuredClone(effective) : undefined, previous: structuredClone(session.placements), previousBasis: session.placementBasis, dirty: true }); setSelectedLesson(''); setMoveSlot(''); setResult(undefined); setNotice('이동 후 전체 배치를 다시 검사했습니다. 이전 배치는 되돌릴 수 있습니다.'); setError('') }
  function undoMove() { if (!session?.previous || !effective || !canEdit || !moveBasis) return; const checked = validatePlacements(moveBasis, session.previous); if (!checked.valid) { setIssues(checked.issues); setError('되돌릴 배치가 현재 조건 또는 작업 고정과 다릅니다. 먼저 해당 고정을 확인해 주세요.'); return }; update({ ...session, placements: session.previous, placementBasis: structuredClone(effective), previous: session.placements, previousBasis: session.placementBasis, dirty: true }); setResult(undefined); setNotice('직전 배치로 돌아왔습니다. 전체 필수 조건을 다시 검사했습니다.') }
  function loadDraft(draft: TimetableDraft) { if (!basis || locked || session?.dirty) return; const checked = validatePlacements({ ...basis, ...draft.conditions }, draft.placements); if (!checked.valid) { setIssues(checked.issues); return }; update({ ...initialSession(basis, false), title: draft.title, conditions: structuredClone(draft.conditions), placements: structuredClone(draft.placements), placementBasis: structuredClone({ ...basis, ...draft.conditions }) }); setStep('compose'); setNotice('서버에 저장된 초안을 열었습니다. 이후 저장은 새 초안으로 남습니다.') }
  async function save(retry = false) {
    if (operation.current || practice || !enabled) return
    let request: { command: SaveDraftInput; key: string }
    if (retry) { if (!pending) return; request = pending as { command: SaveDraftInput; key: string } }
    else { if (!basis || !session?.placements || !session.dirty || session.conditionsChanged || conditionPending || !candidateCheck?.valid || !session.title.trim() || !canEdit || !current?.canSave) return; request = { key: crypto.randomUUID(), command: { basisId: basis.id, basisRevision: basis.revision, sourceFingerprint: basis.sourceFingerprint, title: session.title.trim(), conditions: structuredClone(session.conditions), placements: structuredClone(session.placements) } }; recovery.put(request) }
    const epoch = life.current; operation.current = true; setBusy(true); setError(''); setNotice('')
    try { await (retry ? server.recoverDraft(member.id, request.command, request.key) : server.saveDraft(member.id, request.command, request.key)); if (epoch !== life.current) return; recovery.remove(request.key); const latest = currentSession.current; if (latest) update({ ...latest, dirty: false }); setNotice('학교 서버에 새 초안을 저장했습니다. 교사에게 공개된 시간표는 바뀌지 않았습니다.'); setReload(value => value + 1) }
    catch (failure) { if (epoch !== life.current) return; if (retry ? failure instanceof ServiceError && failure.code === 'NOT_FOUND' : confirmedRejection(failure)) { recovery.remove(request.key); if (failure instanceof ServiceError && failure.code === 'CONFLICT') setReload(value => value + 1) }; setError(safeMessage(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  function makeAiSheet() { if (!basis || !session || !aiText.trim() || stale || locked) return; setAiSheet(['시간표 조건 검토 요청', `기준 자료: ${basis.id} / ${basis.revision}판`, `필수 고정 ${session.conditions.fixed.length}건 · 불가시간 ${session.conditions.unavailable.length}건 · 선호 ${session.conditions.preferences.length}건`, '', aiText.trim(), '', '먼저 모호한 대상·기간을 질문하고 필수 조건과 선호 조건을 구분해 주세요. 확정된 교사·학급·시수는 임의 변경하지 않습니다. 제안만 작성하고 저장·공개·교환 승인은 하지 않습니다.'].join('\n')); setNotice('Claude에게 전달할 요청서를 정리했습니다. 아직 AI에 전송하거나 조건을 바꾸지 않았습니다.') }
  const selected = basis?.lessons.find(item => item.id === selectedLesson)
  return <section className="timetable-workspace" aria-labelledby={`${id}-heading`}><style>{themeStyles + styles}</style>
    <header className="timetable-heading"><div><p className="timetable-eyebrow">나의 수업</p><h1 id={`${id}-heading`}>시간표</h1><p className="timetable-muted">확정된 수업을 확인하고, 담당자는 다음 시간표를 준비합니다.</p></div><span className="timetable-badge">{practice ? '예시로 편성 연습' : '연결 시험 · 관리자 공개'}</span></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status" className="timetable-notice">{notice}</p>}</div>
    {pending && <div className="timetable-notice"><strong>저장 결과를 확인하고 있습니다</strong><p>원래 입력과 요청 번호를 보관했습니다. 새 저장 요청을 만들지 않습니다.</p><p className="timetable-muted">요청 번호: {pending.key}</p><button type="button" disabled={busy || solving || !enabled} onClick={() => void save(true)}>{busy ? '확인 중…' : '같은 요청으로 저장 결과 확인'}</button></div>}
    {(!viewable || current?.canDesign === false) && !pending && !busy && !solving && (session?.dirty || aiText.trim()) && <div className="timetable-notice"><p>이 화면에서 입력한 내용이 현재 탭에 보관되어 메뉴 이동을 잠시 막고 있습니다.</p>{!discardConfirm ? <button type="button" className="secondary" onClick={() => setDiscardConfirm(true)}>보관한 입력 정리</button> : <><p>버리면 작성한 조건·배치·AI 요청 입력을 복구할 수 없습니다. 서버에 저장된 초안은 유지됩니다.</p><div className="timetable-actions"><button type="button" onClick={discardUnavailable}>입력 버리고 메뉴 잠금 해제</button><button type="button" className="secondary" onClick={() => setDiscardConfirm(false)}>입력 계속 보관</button></div></>}</div>}
    {!practice && loading && <p role="status">현재 학교의 시간표 연결을 확인하고 있습니다. 작성 중인 입력은 유지합니다.</p>}
    {!practice && loadError && <div className="timetable-error"><h2>시간표 연결을 다시 확인해 주세요</h2><p>현재 권한을 확인할 때까지 수업과 보관한 입력을 숨깁니다.</p><p>{loadError}</p><div className="timetable-actions"><button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>시간표 연결 다시 확인</button>{enabled && <button type="button" className="secondary" disabled={locked || Boolean(session?.dirty) || Boolean(aiText.trim())} onClick={enterPractice}>예시로 편성 연습</button>}</div><p className="timetable-muted">연습을 직접 선택하면 실제 학교 자료와 구분된 예시만 열립니다.</p></div>}
    {!practice && !loading && !loadError && ready && !ready.available && <div className="timetable-empty"><h2>{ready.reason === 'not_allowed' ? '시간표 이용 권한을 확인해 주세요' : ready.reason === 'basis_missing' ? '시간표 기초 자료를 준비하고 있습니다' : '시간표 서버 연결을 준비하고 있습니다'}</h2><p>학교의 확정 자료가 연결되면 실제 수업을 조회하고 초안을 저장할 수 있습니다.</p><ol><li>학교·교사·학급·시수와 배정을 확인합니다.</li><li>필수 조건과 선호 조건을 정리합니다.</li><li>배치를 만들고 충돌을 검사합니다.</li><li>담당자 검토 후 별도 공개 절차를 진행합니다.</li></ol><div className="timetable-actions"><button type="button" disabled={locked} onClick={() => setReload(value => value + 1)}>연결 상태 다시 확인</button>{ready.reason !== 'not_allowed' && <button type="button" className="secondary" disabled={locked || Boolean(session?.dirty)} onClick={enterPractice}>예시로 편성 연습</button>}{onOpenSchoolAdmin && <button type="button" className="secondary" disabled={navLocked} onClick={onOpenSchoolAdmin}>학교 기초 자료 열기</button>}</div><p className="timetable-muted">편성 연습은 가상 자료만 사용하며 학교 자료를 생성하지 않습니다.</p></div>}
    {practice && <div className="timetable-notice timetable-practice"><strong>가상 자료로 편성 연습 중</strong><p>이 예시는 실제 학교와 연결되지 않습니다. 서버 저장·공개·교환 요청은 실행하지 않습니다.</p><button type="button" className="secondary" disabled={locked} onClick={leavePractice}>연습 마치기 · 연습 입력 버리기</button></div>}
    {viewable && current && <><nav className="timetable-tabs" aria-label="시간표 보기"><button type="button" aria-pressed={tab === 'mine'} disabled={locked || practice} onClick={() => setTab('mine')}>내 시간표</button>{current.canDesign && <button type="button" aria-pressed={tab === 'design'} disabled={locked} onClick={() => setTab('design')}>시간표 만들기</button>}</nav>
      {tab === 'mine' && <><div className="timetable-toolbar"><h2>이번 주 내 수업</h2><label>조회할 날짜<input type="date" aria-label="시간표 조회 날짜" value={week} disabled={locked} onChange={event => { if (event.target.value) setWeek(timetableWeekStart(event.target.value)) }} /></label></div><p className="timetable-muted">{current.weekStart}부터 한 주 · 서버가 확인한 내 수업 관계만 표시합니다. 같은 교시라도 실제 시작·종료 시각을 확인해 주세요.</p><div className="timetable-day-list">{current.lessons.length ? [...current.lessons].sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute).map(lesson => <article key={lesson.id} className="timetable-day-card"><time dateTime={lesson.date}>{lesson.date} · {timetableClock(lesson.startMinute)}–{timetableClock(lesson.endMinute)}</time><h3>{lesson.label} {lesson.status !== 'scheduled' && <span className="timetable-badge">{lesson.status === 'changed' ? '변경됨' : '취소됨'}</span>}</h3><p>{lesson.classNames.join(' · ')}{lesson.roomNames.length ? ` / ${lesson.roomNames.join(' · ')}` : ''}</p><p className="timetable-muted">{lesson.teacherNames.join(' · ')} · 확인한 수업 {lesson.version}판</p></article>) : <div className="timetable-empty"><h3>이 주에 공개된 내 수업이 없습니다</h3><p>저장한 편성 초안은 교사에게 공개된 시간표와 구분됩니다.</p></div>}</div><details><summary>수업 교환·변경은 어떻게 하나요?</summary><p>해당 날짜의 실제 수업을 기준으로 변경안을 검토하고, 관련 교사의 동의와 담당자 승인 후 반영하도록 연결을 준비하고 있습니다. 현재 화면에서는 교환을 신청하거나 반영하지 않습니다.</p></details></>}
      {tab === 'design' && basis && session && <><ol className="timetable-steps" aria-label="시간표 편성 단계">{steps.map((item, index) => <li key={item.id}><button type="button" aria-current={step === item.id ? 'step' : undefined} disabled={locked} onClick={() => setStep(item.id)}><span className="timetable-step-number" aria-hidden="true">{index + 1}</span>{item.label}</button></li>)}</ol>
        {stale && <div role="alert" className="timetable-error"><strong>기초 자료가 바뀌었습니다</strong><p>작성한 조건과 배치는 보관했지만 이전 기준으로 계산하거나 저장하지 않습니다. 새 기준을 확인하고 편성을 다시 준비해 주세요.</p><button type="button" disabled={locked} onClick={resetDraft}>기존 초안 입력 버리고 새 기준으로 시작</button></div>}
        {conditionPending && <div className="timetable-notice"><p>입력 중인 조건이 아직 추가되지 않았습니다. 조건을 추가하거나 비운 뒤 계산·저장해 주세요.</p><div className="timetable-actions"><button type="button" className="secondary" disabled={locked} onClick={() => setStep('conditions')}>입력 중인 조건 확인</button><button type="button" className="secondary" disabled={!canEdit} onClick={() => changeForm({targetId:'',slotId:''})}>입력 중인 조건 비우기</button></div></div>}
        {step === 'basis' && <section className="timetable-card"><h2>1. 기초 자료 확인</h2><p>교사·학급·시수는 학교가 확정한 자료를 사용합니다. 시간표 담당자는 이 화면에서 원래 배정을 바꾸지 않습니다.</p><dl className="timetable-summary"><div><dt>기준판</dt><dd>{basis.revision}판</dd></div><div><dt>편성할 수업</dt><dd>{basis.lessons.length}개</dd></div><div><dt>수업 시수</dt><dd>{basis.courseLoads.reduce((n, row) => n + row.periods, 0)}차시</dd></div><div><dt>교사 / 학급</dt><dd>{basis.resources.filter(row => row.kind === 'teacher').length} / {basis.resources.filter(row => row.kind === 'class').length}</dd></div></dl><p className="timetable-muted">수업별 허용 시간대와 실제 시각, 함께 참여하는 교사·학급·학생 집단·공간을 검사합니다.</p><FoundationPanel basis={effective ?? basis} /><div className="timetable-actions"><button type="button" disabled={locked || stale} onClick={() => setStep('conditions')}>조건 정리로 이동</button>{onOpenSchoolAdmin && !practice && <button type="button" className="secondary" disabled={navLocked} onClick={onOpenSchoolAdmin}>기초 자료 수정 요청하러 이동</button>}</div></section>}
        {step === 'conditions' && <section className="timetable-card"><h2>2. 필수 조건과 선호 조건</h2><p>필수 조건은 지키지 못하면 배치할 수 없습니다. 선호 조건은 지킬 수 없더라도 필수 조건을 어기지 않습니다.</p><fieldset disabled={!canEdit}><div className="timetable-grid"><label>조건 종류<select aria-label="조건 종류" value={session.form.kind} onChange={event => changeForm({ kind: event.target.value as ConditionForm['kind'], targetId: '', slotId: '' })}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'}<select aria-label={session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'} value={session.form.targetId} onChange={event => changeForm({ targetId: event.target.value, slotId: '' })}><option value="">선택해 주세요</option>{(session.form.kind === 'unavailable' ? basis.resources : basis.lessons).map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label>조건 시간<select aria-label="조건 시간" value={session.form.slotId} onChange={event => changeForm({ slotId: event.target.value })}><option value="">선택해 주세요</option>{basis.slots.filter(slot => session.form.kind === 'unavailable' || basis.lessons.find(row => row.id === session.form.targetId)?.allowedSlotIds.includes(slot.id)).map(slot => <option key={slot.id} value={slot.id}>{slotLabel(basis, slot.id)}</option>)}</select></label>{session.form.kind === 'preferences' && <label>피하고 싶은 정도<input aria-label="피하고 싶은 정도" type="number" min="1" max={timetablePolicy.maxWeight} step="1" value={session.form.weight} onChange={event => changeForm({ weight: event.target.value })} /></label>}</div><button type="button" onClick={addCondition}>조건 추가</button></fieldset><p className="timetable-muted">선호의 숫자가 클수록 해당 시간대를 더 피하려고 합니다. 이번 계산은 가능한 배치를 우선 찾으며 최적 점수를 보장하지 않습니다.</p>
          <ConditionCards basis={basis} conditions={session.conditions} disabled={!canEdit} onRemove={removeCondition} /><div className="timetable-actions"><button type="button" disabled={!canEdit || !inputCheck?.valid} onClick={() => setStep('compose')}>배치 만들기로 이동</button></div></section>}
        {step === 'compose' && <><section className="timetable-card"><div className="timetable-toolbar"><div><h2>3. 배치 만들기와 조정</h2><p>필수 조건을 모두 확인한 뒤, 수업을 눌러 이동할 수 있습니다.</p></div><div className="timetable-actions"><button type="button" disabled={!canEdit || conditionPending || !inputCheck?.valid || !foundation?.ready} onClick={() => void generate()}>{session.placements ? '다시 계산' : '배치 만들기'}</button>{solving && <button type="button" className="secondary" onClick={() => solver.current?.cancel()}>계산 중지</button>}</div></div>{solving && <p role="status">별도 계산 작업자에서 배치를 찾고 있습니다. 중지해도 입력은 유지됩니다.</p>}{result && <details className="timetable-calculation-details"><summary>계산 결과 자세히</summary><p className="timetable-muted">이번 탐색 {result.stats.nodes.toLocaleString()}개 · {Math.round(result.stats.elapsedMs)}ms{result.score !== null ? ` · 선호 벌점 ${result.score}` : ''} · 최적해 보장 없음</p></details>}{session.placements && !session.conditionsChanged && candidateCheck && <p className={candidateCheck.valid ? 'timetable-validation' : 'timetable-error'} role="status">{candidateCheck.valid ? '전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인' : '충돌이 있어 이 배치를 저장할 수 없습니다.'}</p>}{session.placements && effective && !session.conditionsChanged ? <><TimetableQualitySummary basis={effective} placements={session.placements} previous={session.previous} previousBasis={session.previousBasis} /><label>표에서 볼 대상<select aria-label="표에서 볼 대상" value={filter} disabled={locked} onChange={event => setFilter(event.target.value)}><option value="">전체 수업</option>{basis.resources.map(resource => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select></label><div className="timetable-actions"><button type="button" className="secondary" disabled={!canEdit || conditionPending || !candidateCheck?.valid || !filter} onClick={() => void generate(filter)}>선택 대상만 다시 계산</button><span className="timetable-muted">작업 중 고정 {workingLocks.length}개 · 선택 대상 밖의 배치도 유지합니다.</span></div><TimetableBoard basis={effective} placements={session.placements} filterResourceId={filter} selectedLessonId={selectedLesson} disabled={!canEdit} onSelect={lessonId => { setSelectedLesson(lessonId); setMoveSlot(''); setError('') }} />{selected && <section className="timetable-notice" aria-label="선택한 수업 이동"><h3>{selected.label} 이동</h3><div className="timetable-actions"><button type="button" className="secondary" aria-pressed={workingLocks.includes(selected.id)} disabled={!canEdit || basis.fixed.some(row => row.lessonId === selected.id)} onClick={() => toggleWorkingLock(selected.id)}>{basis.fixed.some(row => row.lessonId === selected.id) ? "학교 조건으로 고정됨" : workingLocks.includes(selected.id) ? "작업 고정 해제" : "이 배치 유지"}</button></div><p>현재 위치: {slotLabel(basis, session.placements.find(row => row.lessonId === selected.id)?.slotId ?? '')}</p><label>이동할 시간<select aria-label="이동할 시간" value={moveSlot} disabled={!canEdit} onChange={event => setMoveSlot(event.target.value)}><option value="">시간을 선택해 주세요</option>{basis.slots.filter(slot => selected.allowedSlotIds.includes(slot.id)).map(slot => <option key={slot.id} value={slot.id}>{slotLabel(basis, slot.id)}</option>)}</select></label>{moveCheck && (moveCheck.valid ? <p>이동 후 전체 필수 조건을 통과합니다.</p> : <IssueList issues={moveCheck.issues} />)}<div className="timetable-actions"><button type="button" disabled={!canEdit || !moveCheck?.valid} onClick={moveLesson}>검사한 위치로 이동</button><button type="button" className="secondary" disabled={locked} onClick={() => { setSelectedLesson(''); setMoveSlot('') }}>이동 닫기</button></div></section>}<div className="timetable-actions"><button type="button" className="secondary" disabled={!canEdit || !session.previous} onClick={undoMove}>직전 배치로 되돌리기</button><button type="button" disabled={!candidateCheck?.valid || locked || stale} onClick={() => setStep('publish')}>초안 저장·공개 검토</button></div></> : <div className="timetable-empty">{session.conditionsChanged ? <><p>조건 변경 전의 배치를 보관하고 있습니다. 다시 검사하면 기존 배치를 보며 조정할 수 있습니다.</p><button type="button" disabled={!canEdit || conditionPending} onClick={recheckWorkingPlacements}>보관한 배치 다시 검사</button></> : "아직 만든 배치가 없습니다. 조건을 확인한 뒤 배치 만들기를 눌러 주세요."}</div>}</section>{current.drafts.length > 0 && <section className="timetable-card"><h3>저장한 초안</h3><ul className="timetable-list">{current.drafts.map(draft => <li key={draft.id} className="timetable-list-row"><div>{draft.title}<small>기초 자료 {draft.basisRevision}판 · 초안 {draft.version}판</small></div><button type="button" className="secondary" disabled={locked || Boolean(session.dirty)} onClick={() => loadDraft(draft)}>이 초안 열기</button></li>)}</ul>{session.dirty && <p className="timetable-muted">작성 중인 초안을 저장하거나 새 편성으로 정리한 뒤 다른 초안을 열 수 있습니다.</p>}</section>}</>}
        {step === 'publish' && <section className="timetable-card"><h2>4. 초안 저장과 공개 검토</h2><p>저장한 초안은 담당자의 작업 자료입니다. 확정된 시간표로 자동 공개하지 않습니다.</p><label>초안 이름<input aria-label="초안 이름" value={session.title} disabled={!canEdit} maxLength={limits.title} onChange={event => { if (session) update({ ...session, title: event.target.value, dirty: true }) }} /></label>{candidateCheck?.valid && !session.conditionsChanged ? <p className="timetable-notice">기초 자료 {basis.revision}판 · {session.placements?.length}개 수업 · 필수 조건 검사 통과</p> : <p className="timetable-error">{session.conditionsChanged ? "보관한 배치를 새 조건으로 다시 검사해 주세요." : "필수 조건을 통과한 배치를 먼저 만들어 주세요."}</p>}<div className="timetable-actions">{!practice && <button type="button" disabled={!canEdit || !session.dirty || session.conditionsChanged || conditionPending || !current.canSave || !candidateCheck?.valid || !session.title.trim()} onClick={() => void save()}>새 초안으로 서버에 저장</button>}<button type="button" className="secondary" disabled={locked} onClick={() => setStep('compose')}>배치 다시 살펴보기</button></div>{practice && <p className="timetable-muted">연습 자료는 학교 서버에 저장하지 않습니다.</p>}<div className="timetable-empty"><h3>확정·공개 연결 준비 중</h3><p>적용 기간, 이미 승인된 수업 변경, 최신 조건판을 다시 검사한 뒤 담당자가 공개하도록 연결합니다. 이번 초안 저장은 학생 기록이나 기존 시간표를 바꾸지 않습니다.</p></div></section>}
        {issues.length > 0 && <div className="timetable-error"><h3>확인할 항목</h3><IssueList issues={issues} /></div>}
        {step === 'compose' && effective && <Suspense fallback={<p role="status">최적화 도구를 준비하는 중…</p>}><TimetableEnginePanel member={member} basis={effective} placements={session.placements} previous={session.placementBasis && session.placements ? { basis: session.placementBasis, placements: session.placements } : undefined} lockedLessonIds={workingLocks} scopeResourceId={filter} disabled={!canEdit || conditionPending || !foundation?.ready} onAdopt={adoptEngineCandidate} /></Suspense>}
        <Suspense fallback={<p role="status">엑셀 작업 도구를 준비하는 중…</p>}><TimetableWorkbookPanel basis={basis} conditions={session.conditions} placements={session.placements ?? []} title={session.title} disabled={!canEdit || conditionPending} onImport={importWorkingDraft} /></Suspense>
        {(!assistantServer || practice) && <details className="timetable-card"><summary>Claude에게 조건 정리를 부탁하려면</summary><p>AI는 조건을 정리하고 조정안을 제안합니다. 계산과 충돌 검사는 프로그램이 담당합니다. 학교 비서 연결이 준비되면 아래 Claude 도움에서 직접 요청할 수 있습니다. 이 요청서는 외부 검토용으로만 정리합니다.</p><label>정리하고 싶은 요청<textarea aria-label="정리하고 싶은 요청" rows={3} maxLength={limits.assistantText} value={aiText} disabled={locked || stale} onChange={event => { setAiText(event.target.value); setAiSheet('') }} placeholder="예: 수요일 오후 교사 회의 시간을 피하고 싶어요. 필수 조건인지 선호 조건인지 먼저 확인해 주세요." /></label><div className="timetable-actions"><button type="button" className="secondary" disabled={!aiText.trim() || locked || stale} onClick={makeAiSheet}>Claude 전달용 요청서 정리</button><button type="button" className="secondary" disabled={locked} onClick={() => { setAiText(''); setAiSheet('') }}>AI 요청 입력 비우기</button></div>{aiSheet && <label>Claude 전달용 요청서<textarea aria-label="Claude 전달용 요청서" rows={8} readOnly value={aiSheet} /></label>}<p className="timetable-muted">요청서는 자동 전송되지 않습니다. 개인의 결근·상담 사유는 넣지 마세요.</p></details>}
        <details><summary>편성을 처음부터 다시 준비</summary><p>지금 작성 중인 조건과 배치를 버리고 현재 기초 자료에서 다시 시작합니다. 서버에 저장한 초안은 지우지 않습니다.</p><button type="button" className="secondary" disabled={locked} onClick={resetDraft}>현재 편성 입력 버리고 새로 시작</button></details>
      </>}
    </>}
    {((preparationServer && !practice) || preparationRecovery.request) && <Suspense fallback={<p role="status">학교 편성 준비 화면을 준비하는 중…</p>}><TimetablePreparationPanel server={practice ? undefined : preparationServer} member={member} disabled={commandLocked || aiLocked || !enabled || practice || Boolean(session?.dirty) || conditionPending} onLockChange={setPreparationLocked} onBasisConfirmed={() => setReload(value => value + 1)} /></Suspense>}
    {((assistantServer && !practice) || aiRecovery.request) && <Suspense fallback={<p role="status">시간표 AI 도움을 준비하는 중…</p>}><TimetableAssistantPanel server={practice ? undefined : assistantServer} member={member} basis={viewable && !stale && current?.canDesign ? basis : null} conditions={viewable && !stale && current?.canDesign ? session?.conditions ?? null : null} placements={viewable && !stale && current?.canDesign ? session?.placements ?? [] : []} disabled={commandLocked || preparationLocked || !viewable || stale || !basis || !session || practice || !current?.canDesign || conditionPending} onApply={conditions => changeConditions(conditions, true)} onLockChange={setAiLocked} /></Suspense>}
  </section>
}
export function IssueList({ issues }: { issues: TimetableIssue[] }) { return <ul className="timetable-issues">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message} <small className="timetable-muted">({issue.code})</small></li>)}</ul> }
