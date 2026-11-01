import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { activeAt } from '../domain'
import { canonical, ServiceError } from '../services/service-values'
import {
  validateBasis,
  validatePlacements,
  validateSolveResult,
} from '../../../../packages/timetable/src/validate'
import type { TimetableIssue, SolveResult } from '../../../../packages/timetable/src/types'
import { timetableConditions, timetableWeekStart } from './server'
import type {
  TimetableReadiness,
  TimetableSnapshot,
  TimetableBasis,
  TimetableConditions,
  Placement,
  SaveDraftInput,
  TimetableDraft,
} from './contracts'
import { startTimetableSolve, type SolverTask } from './worker-client'
import { timetablePracticeSnapshot } from './sample'
import { matchesSavedTimetableDraft, timetableDraftCommand } from './flow'
import {
  adjustmentSourceKey,
  reviewAdjustment,
  reviewPartialPlacements,
  reviewProtectedPlacements,
  type AdjustmentCommand,
} from './adjustments'
import { reviewTimetablePreflight } from './preflight'
import {
  conditionBatchSourceKey,
  hasConditionBatchInput,
  initialConditionBatch,
  type ConditionBatchState,
} from './condition-batch'
import { prepareScopedSolve, reviewTimetableFoundation } from './foundation'
import type { TimetableWorkbookDraft } from './workbook'
import type { TargetSnapshot } from './target'
import { type TargetPanelState } from './TimetableTargetPanel'
import { scopeTimetableServers, targetScopeKey } from './target-scope'
import {
  Step,
  ConditionForm,
  DraftSession,
  PanelProps,
  basisIdentity,
  initialSession,
  slotLabel,
  safeMessage,
  confirmedRejection,
} from './designer-model'
export function useTimetableDesigner({
  server: baseServer,
  assistantServer,
  preparationServer: basePreparationServer,
  setupServer: baseSetupServer,
  targetServer,
  member,
  date,
  revision = 0,
  onNavigationLockChange,
  onOpenSchoolAdmin,
  onOpenOperations,
  onOpenPublished,
  initialPreparationStep,
  runSolver = startTimetableSolve,
}: PanelProps) {
  const id = useId(),
    memory = useEditDraft<DraftSession>(member, 'timetable-editor'),
    aiMemory = useEditDraft<{ text: string; sheet: string }>(member, 'timetable-ai'),
    recovery = usePendingRequest(member, 'timetable')
  const aiRecovery = usePendingRequest(member, 'timetableAssistant'),
    preparationRecovery = usePendingRequest(member, 'timetablePreparation'),
    setupRecovery = usePendingRequest(member, 'timetableSetup'),
    setupBatchRecovery = usePendingRequest(member, 'timetableSetupBatch')
  const stepMemory = useEditDraft<Step>(member, 'timetable-editor-step')
  const targetRecovery = usePendingRequest(member, 'timetableTarget')
  const [targetState, setTargetState] = useState<TargetPanelState>({
    status: targetServer ? 'loading' : 'unavailable',
  })
  const [targetLocked, setTargetLocked] = useState(Boolean(targetRecovery.request)),
    [targetRefresh, setTargetRefresh] = useState(0),
    [targetEpoch, setTargetEpoch] = useState(0)
  const targetScope = useRef<{ checking: boolean; snapshot?: TargetSnapshot }>({
    checking: Boolean(targetServer),
  })
  const otherTargetLocks = useRef(false)
  const practiceSnapshot = useMemo(() => timetablePracticeSnapshot(date), [date])
  // 단순히 열어 본 예시가 공식 준비 링크를 가리지 않게 한다. 작성한 연습과 미확정 요청은 보존한다.
  const resetUnusedPractice = Boolean(
    initialPreparationStep &&
      memory.initial?.practice &&
      !memory.initial.dirty &&
      !memory.initial.placements &&
      !memory.initial.form.targetId &&
      !memory.initial.form.slotId &&
      !hasConditionBatchInput(memory.initial.conditionBatch) &&
      !aiMemory.initial?.text &&
      !aiMemory.initial?.sheet &&
      ![
        recovery,
        aiRecovery,
        preparationRecovery,
        setupRecovery,
        setupBatchRecovery,
        targetRecovery,
      ].some((store) => store.request),
  )
  const [session, setSession] = useState<DraftSession | undefined>(() =>
      resetUnusedPractice ? undefined : memory.initial,
    ),
    [practice, setPractice] = useState(!resetUnusedPractice && Boolean(memory.initial?.practice))
  useEffect(() => {
    if (resetUnusedPractice) memory.remove()
  }, [resetUnusedPractice, memory])
  const [tab, setTab] = useState<'mine' | 'design'>(() =>
      memory.initial || initialPreparationStep || onOpenPublished ? 'design' : 'mine',
    ),
    [step, setStep] = useState<Step>(
      initialPreparationStep ? 'basis' : (stepMemory.initial ?? 'basis'),
    ),
    [discardConfirm, setDiscardConfirm] = useState(false)
  const [week, setWeek] = useState(() => timetableWeekStart(date)),
    [snapshot, setSnapshot] = useState<TimetableSnapshot>(),
    [ready, setReady] = useState<TimetableReadiness>()
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [solving, setSolving] = useState(false)
  const [aiLocked, setAiLocked] = useState(false),
    [aiInputLocked, setAiInputLocked] = useState(false)
  const [aiOpenRequest, setAiOpenRequest] = useState<{ stage: 'setup' | 'adjust'; token: number }>()
  const [preparationLocked, setPreparationLocked] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [issues, setIssues] = useState<TimetableIssue[]>([]),
    [result, setResult] = useState<SolveResult>()
  const [selectedLesson, setSelectedLesson] = useState(''),
    [filter, setFilter] = useState(''),
    [aiText, setAiText] = useState(aiMemory.initial?.text ?? ''),
    [aiSheet, setAiSheet] = useState(aiMemory.initial?.sheet ?? '')
  const [conditionSearch, setConditionSearch] = useState('')
  const stepHeading = useRef<HTMLHeadingElement>(null),
    focusStep = useRef(false)
  const life = useRef(0),
    operation = useRef(false),
    solver = useRef<SolverTask>(),
    currentSession = useRef(session),
    feedback = useRef<HTMLDivElement>(null)
  currentSession.current = session
  const observeTarget = useCallback(
    (next: TargetPanelState) => {
      const previous = targetScope.current.snapshot
      // 연결이 끊겼다고 이미 확인한 대상 학기를 잊지 않는다. 기존 T1의 미지원은 첫 조회에서만 독립 처리한다.
      targetScope.current = {
        checking: next.status !== 'ready',
        snapshot: next.status === 'ready' ? next.snapshot : previous,
      }
      setTargetState(next)
      if (next.status !== 'ready' || !next.snapshot) return
      const latest = currentSession.current
      let storedTerm = latest?.termId ?? latest?.placementBasis?.termId
      if (!storedTerm && latest) {
        try {
          storedTerm = JSON.parse(latest.basisIdentity)[1]
        } catch {
          /* 이전 메모리는 안전하게 그대로 보존한다. */
        }
      }
      const changed = previous
        ? targetScopeKey(previous) !== targetScopeKey(next.snapshot)
        : Boolean(latest && !latest.practice && storedTerm && storedTerm !== next.snapshot.termId)
      if (!changed) return
      // 성공한 저장 자료는 서버에 남아 있다. 미저장/결과 미상은 자동으로 버리지 않는다.
      if (!otherTargetLocks.current && !latest?.dirty) {
        currentSession.current = undefined
        setSession(undefined)
        memory.save(undefined, false)
        setResult(undefined)
        setIssues([])
      }
      setSnapshot(undefined)
      setLoading(true)
      setSelectedLesson('')
      setDiscardConfirm(false)
      setNotice(
        '학교의 준비 대상 학기가 바뀌어 자료를 다시 확인합니다. 작성 중인 입력과 원래 요청은 보관했습니다.',
      )
      setReload((value) => value + 1)
      setTargetEpoch((value) => value + 1)
    },
    [memory],
  )
  const targetMismatch = useCallback(() => {
    setNotice('준비 대상 학기가 변경되었습니다. 서로 다른 학기의 자료를 섞지 않고 다시 확인합니다.')
    setTargetRefresh((value) => value + 1)
  }, [])
  const scoped = useMemo(
    () =>
      scopeTimetableServers({
        target: targetServer,
        state: () => targetScope.current,
        observe: (value) => observeTarget({ status: 'ready', snapshot: value }),
        mismatch: targetMismatch,
        timetable: baseServer,
        preparation: basePreparationServer,
        setup: baseSetupServer,
      }),
    [
      baseServer,
      basePreparationServer,
      baseSetupServer,
      targetServer,
      observeTarget,
      targetMismatch,
    ],
  )
  const server = scoped.timetable,
    preparationServer = scoped.preparation,
    setupServer = scoped.setup
  const knownTarget =
    targetState.status === 'ready' ? targetState.snapshot : targetScope.current.snapshot
  const targetChecking = Boolean(
    targetServer &&
      (targetState.status === 'loading' || (knownTarget && targetState.status !== 'ready')),
  )
  const targetViewMismatch = Boolean(
    !practice && knownTarget && snapshot?.basis && snapshot.basis.termId !== knownTarget.termId,
  )
  const targetBlocked =
    !practice &&
    (targetChecking || targetLocked || Boolean(targetRecovery.request) || targetViewMismatch)
  useEffect(() => {
    if (!targetServer) return
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setTargetRefresh((value) => value + 1)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [targetServer])
  const enabled = activeAt(member, date),
    pending = recovery.request
  const current = practice
    ? practiceSnapshot
    : !loadError && !loading && ready?.available
      ? snapshot
      : undefined
  const basis = current?.canDesign ? current.basis : null
  const stale =
    targetViewMismatch ||
    Boolean(basis && session && session.basisIdentity !== basisIdentity(basis))
  const effective = useMemo(
    () => (basis && session && !stale ? { ...basis, ...session.conditions } : basis),
    [basis, session?.conditions, stale],
  )
  const candidateCheck = useMemo(
    () =>
      effective && session?.placements && !stale
        ? validatePlacements(effective, session.placements)
        : undefined,
    [effective, session?.placements, stale],
  )
  const partialCheck = useMemo(
    () =>
      effective && session?.placements && !stale
        ? reviewPartialPlacements(effective, session.placements)
        : undefined,
    [effective, session?.placements, stale],
  )
  const inputCheck = useMemo(() => (effective ? validateBasis(effective) : undefined), [effective])
  const preflight = useMemo(
    () => (effective ? reviewTimetablePreflight(effective) : undefined),
    [effective],
  )
  const foundation = useMemo(
    () => (effective ? reviewTimetableFoundation(effective) : undefined),
    [effective],
  )
  const workingLocks = session?.lockedLessonIds ?? []
  const singleConditionPending = Boolean(session?.form.targetId || session?.form.slotId),
    batchPending = hasConditionBatchInput(session?.conditionBatch)
  const conditionPending = singleConditionPending || batchPending
  const conditionTargets =
    basis && session ? (session.form.kind === 'unavailable' ? basis.resources : basis.lessons) : []
  const conditionQuery = conditionSearch
    .normalize('NFKC')
    .toLocaleLowerCase('ko')
    .replace(/\s/g, '')
  const matchingTargets = conditionTargets.filter((row) =>
    [
      row.label,
      row.id,
      ...('resourceIds' in row
        ? row.resourceIds.map(
            (id) => basis?.resources.find((resource) => resource.id === id)?.label ?? id,
          )
        : []),
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase('ko')
      .replace(/\s/g, '')
      .includes(conditionQuery),
  )
  const selectedTarget = conditionTargets.find((row) => row.id === session?.form.targetId)
  const shownTargets =
    selectedTarget && !matchingTargets.includes(selectedTarget)
      ? [selectedTarget, ...matchingTargets]
      : matchingTargets
  const targetLabelCounts = new Map<string, number>()
  conditionTargets.forEach((row) =>
    targetLabelCounts.set(row.label, (targetLabelCounts.get(row.label) ?? 0) + 1),
  )
  const targetLabel = (row: { id: string; label: string }) =>
    (targetLabelCounts.get(row.label) ?? 0) > 1 ? `${row.label} [${row.id}]` : row.label
  const selectedConditionTime =
    basis && session?.form.slotId ? slotLabel(basis, session.form.slotId) : ''
  const liveBasis = useRef<{ basis: TimetableBasis | null | undefined; allowed: boolean }>({
    basis: effective,
    allowed: false,
  })
  const commandLocked = busy || solving || Boolean(pending),
    locked = commandLocked || aiLocked || preparationLocked || targetBlocked,
    navLocked = locked || Boolean(session?.dirty) || Boolean(aiText.trim())
  otherTargetLocks.current =
    commandLocked ||
    aiLocked ||
    aiInputLocked ||
    preparationLocked ||
    Boolean(session?.dirty) ||
    Boolean(aiText.trim()) ||
    conditionPending ||
    Boolean(
      aiRecovery.request ||
        preparationRecovery.request ||
        setupRecovery.request ||
        setupBatchRecovery.request,
    )
  const canEdit = Boolean(
      basis && session && !stale && !locked && (practice || current?.canDesign),
    ),
    viewable = Boolean(practice || (!loadError && !loading && ready?.available && snapshot))
  liveBasis.current = { basis: effective, allowed: viewable && !!current?.canDesign && !stale }
  const savedForCurrent = Boolean(
    basis &&
      session &&
      !stale &&
      !session.dirty &&
      matchesSavedTimetableDraft(session.savedDraft, timetableDraftCommand(basis, session)),
  )
  function openSavedPublication() {
    const latest = currentSession.current
    if (
      !onOpenOperations ||
      !basis ||
      !latest?.savedDraft ||
      navLocked ||
      stale ||
      conditionPending ||
      latest.conditionsChanged ||
      !current?.canSave ||
      !candidateCheck?.valid ||
      practice ||
      !matchesSavedTimetableDraft(latest.savedDraft, timetableDraftCommand(basis, latest))
    )
      return
    onOpenOperations({ id: latest.savedDraft.id, version: latest.savedDraft.version })
  }
  function navigateStep(next: Step) {
    if (locked) return
    if (next === step) {
      stepHeading.current?.focus()
      return
    }
    focusStep.current = true
    setStep(next)
  }
  useEffect(() => {
    stepMemory.save(step, false)
  }, [step])
  useEffect(() => {
    if (focusStep.current) {
      focusStep.current = false
      stepHeading.current?.focus()
    }
  }, [step])
  function update(next: DraftSession | undefined) {
    currentSession.current = next
    setSession(next)
    memory.save(next, Boolean(next?.dirty))
  }
  useEffect(() => {
    life.current++
    return () => {
      life.current++
      solver.current?.cancel()
      operation.current = false
    }
  }, [server])
  useEffect(() => {
    onNavigationLockChange?.(navLocked)
    return () => onNavigationLockChange?.(false)
  }, [navLocked, onNavigationLockChange])
  useEffect(() => {
    if (!navLocked) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [navLocked])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    if (!enabled) {
      setReady(undefined)
      setSnapshot(undefined)
      setLoadError('현재 학교 소속을 다시 확인해 주세요.')
      setLoading(false)
      return
    }
    void server
      .readiness(member.id)
      .then(async (value) => {
        if (cancelled) return
        setReady(value)
        if (!value.available) {
          setSnapshot(undefined)
          return
        }
        const next = await server.get(member.id, week)
        if (!cancelled) setSnapshot(next)
      })
      .catch((failure) => {
        if (!cancelled) {
          setSnapshot(undefined)
          setLoadError(safeMessage(failure))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [server, member.id, week, enabled, revision, reload, targetEpoch])
  useEffect(() => {
    if (basis && !session && !targetViewMismatch) update(initialSession(basis, practice))
  }, [basis, session, practice, targetViewMismatch])
  useEffect(() => {
    aiMemory.save(
      aiText || aiSheet ? { text: aiText, sheet: aiSheet } : undefined,
      Boolean(aiText.trim()),
    )
  }, [aiText, aiSheet, aiMemory])
  useEffect(() => {
    if (current && !current.canDesign && !practice && session) {
      setTab('mine')
      setResult(undefined)
      setIssues([])
    }
  }, [current, practice, session])
  useEffect(() => {
    if (!viewable || stale) {
      solver.current?.cancel()
      setSelectedLesson('')
    }
  }, [viewable, stale])
  useEffect(() => {
    setFilter(basis?.resources.find((row) => row.kind === 'teacher')?.id ?? '')
  }, [basis?.id, basis?.revision, basis?.sourceFingerprint])
  useEffect(() => {
    if (error || notice) feedback.current?.focus()
  }, [error, notice])
  function discardUnavailable() {
    if (locked) return
    update(undefined)
    setAiText('')
    setAiSheet('')
    setDiscardConfirm(false)
    setResult(undefined)
    setIssues([])
    setError('')
    setNotice('보관한 입력을 버렸습니다. 이제 다른 메뉴로 이동할 수 있습니다.')
  }
  function enterPractice() {
    if (locked || session?.dirty) return
    const sample = timetablePracticeSnapshot(date)
    setPractice(true)
    update(initialSession(sample.basis!, true))
    setTab('design')
    setStep('basis')
    setError('')
    setNotice('예시 자료로 편성 연습을 시작했습니다. 실제 학교에 저장하거나 공개하지 않습니다.')
  }
  function leavePractice() {
    if (locked) return
    setPractice(false)
    update(undefined)
    setResult(undefined)
    setIssues([])
    setTab(onOpenPublished ? 'design' : 'mine')
    setAiText('')
    setAiSheet('')
    setNotice('편성 연습을 마쳤습니다. 연습 자료는 학교에 저장되지 않았습니다.')
  }
  function resetDraft() {
    if (!basis || locked) return
    update(initialSession(basis, practice))
    setIssues([])
    setResult(undefined)
    setSelectedLesson('')
    setError('')
    setNotice('현재 기초 자료로 새 편성을 준비했습니다.')
    setAiText('')
    setAiSheet('')
  }
  function changeConditions(
    conditions: TimetableConditions,
    fromAssistant = false,
    sourceKey?: string,
  ): boolean {
    const latest = currentSession.current
    if (
      !latest ||
      !basis ||
      !(fromAssistant
        ? !targetBlocked &&
          !stale &&
          !commandLocked &&
          viewable &&
          current?.canDesign &&
          !conditionPending
        : canEdit) ||
      (batchPending && !sourceKey) ||
      (sourceKey &&
        (singleConditionPending || sourceKey !== conditionBatchSourceKey(basis, latest.conditions)))
    )
      return false
    try {
      conditions = timetableConditions(conditions, basis)
    } catch {
      setError('기초 자료와 적용할 조건을 다시 확인해 주세요. 입력은 보관했습니다.')
      return false
    }
    update({
      ...latest,
      conditions,
      conditionBatch: initialConditionBatch(),
      conditionsChanged: Boolean(latest.placements),
      dirty: true,
      form: { ...latest.form, targetId: '', slotId: '' },
    })
    setResult(undefined)
    setIssues([])
    setSelectedLesson('')
    setAiSheet('')
    setError('')
    setNotice(
      '조건을 바꿨습니다. 기존 배치는 보관했습니다. 새 조건으로 다시 검사하거나 재계산해 주세요.',
    )
    return true
  }
  function changeBatch(state: ConditionBatchState) {
    const latest = currentSession.current
    if (!latest || !canEdit || singleConditionPending) return
    update({
      ...latest,
      conditionBatch: state,
      dirty: latest.dirty || hasConditionBatchInput(state),
    })
  }
  function clearConditionInput() {
    const latest = currentSession.current
    if (!latest || !canEdit) return
    update({
      ...latest,
      conditionBatch: initialConditionBatch(),
      form: { ...latest.form, targetId: '', slotId: '' },
    })
  }
  function recheckWorkingPlacements() {
    if (!session?.placements || !effective || !canEdit || conditionPending) return
    const checked = reviewPartialPlacements(effective, session.placements)
    update({
      ...session,
      placementBasis: checked.valid ? structuredClone(effective) : session.placementBasis,
      conditionsChanged: false,
      dirty: true,
    })
    setIssues(checked.issues)
    setNotice(
      checked.valid
        ? checked.complete
          ? '보관한 배치가 새 조건을 통과했습니다. 그대로 조정하거나 저장할 수 있습니다.'
          : `보관한 배치를 열었습니다. 미배정 수업 ${checked.missingLessonIds.length}개를 이어서 배치해 주세요.`
        : '보관한 배치를 열었습니다. 충돌을 해결하기 전에는 학교 서버에 저장하거나 확정할 수 없습니다.',
    )
    setError('')
  }
  function importWorkingDraft(draft: TimetableWorkbookDraft) {
    if (!basis || !session || !canEdit || conditionPending) return
    const importedBasis = { ...basis, ...draft.conditions }
    update({
      ...session,
      title: draft.title,
      conditions: structuredClone(draft.conditions),
      placements: structuredClone(draft.placements),
      placementBasis: validatePlacements(importedBasis, draft.placements).valid
        ? structuredClone(importedBasis)
        : undefined,
      previous: session.placements ? structuredClone(session.placements) : null,
      previousBasis: session.placementBasis,
      lockedLessonIds: [],
      conditionsChanged: true,
      dirty: true,
    })
    setSelectedLesson('')
    setIssues([])
    setResult(undefined)
    setAiSheet('')
    setStep('compose')
    setError('')
    setNotice(
      '엑셀 내용을 작업 초안에 가져왔습니다. 배치를 다시 검사한 뒤 이어서 조정해 주세요. 학교 서버에는 아직 저장하지 않았습니다.',
    )
  }
  function adoptEngineCandidate(placements: Placement[]): boolean {
    if (!session || !effective || !canEdit || conditionPending) return false
    const prepared = prepareScopedSolve(effective, session.placements, workingLocks)
    if (!prepared.basis) {
      setIssues(prepared.issues)
      return false
    }
    const checked = validatePlacements(prepared.basis, placements)
    if (!checked.valid) {
      setIssues(checked.issues)
      setError(
        '선택한 후보가 현재 조건이나 작업 중 고정과 일치하지 않습니다. 원래 요청을 다시 확인해 주세요.',
      )
      return false
    }
    update({
      ...session,
      placements: structuredClone(placements),
      placementBasis: structuredClone(effective),
      previous: session.placements ? structuredClone(session.placements) : null,
      previousBasis: session.placementBasis,
      conditionsChanged: false,
      dirty: true,
    })
    setSelectedLesson('')
    setResult(undefined)
    setIssues([])
    setError('')
    setStep('compose')
    setNotice(
      '선택한 후보를 현재 작업 초안에 반영했습니다. 학교 서버 저장과 시간표 확정은 별도로 진행해 주세요.',
    )
    return true
  }
  function toggleWorkingLock(lessonId: string) {
    if (
      !session?.placements ||
      !canEdit ||
      conditionPending ||
      session.conditionsChanged ||
      basis?.fixed.some((row) => row.lessonId === lessonId)
    )
      return
    if (!session.placements.some((row) => row.lessonId === lessonId)) return
    const next = workingLocks.includes(lessonId)
      ? workingLocks.filter((id) => id !== lessonId)
      : [...workingLocks, lessonId]
    update({ ...session, lockedLessonIds: next, dirty: true })
    setNotice(
      next.includes(lessonId)
        ? '이 배치를 다음 계산에서 유지합니다. 학교의 공식 조건은 바뀌지 않습니다.'
        : '작업 중 배치 고정을 풀었습니다. 학교의 공식 조건은 유지됩니다.',
    )
  }
  function changeForm(patch: Partial<ConditionForm>) {
    if (!session || !canEdit || batchPending) return
    update({ ...session, dirty: true, form: { ...session.form, ...patch } })
    setError('')
    setIssues([])
  }
  function addCondition() {
    if (!session || !basis || !canEdit || batchPending) return
    const form = session.form,
      slot = basis.slots.find((item) => item.id === form.slotId),
      conditions = structuredClone(session.conditions)
    if (!slot || !form.targetId) {
      setError('조건을 적용할 대상과 시간을 선택해 주세요.')
      return
    }
    if (form.kind === 'fixed') conditions.fixed.push({ lessonId: form.targetId, slotId: slot.id })
    else if (form.kind === 'unavailable')
      conditions.unavailable.push({
        resourceId: form.targetId,
        day: slot.day,
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
      })
    else
      conditions.preferences.push({
        lessonId: form.targetId,
        slotId: slot.id,
        weight: Number(form.weight),
      })
    const checked = validateBasis({ ...basis, ...conditions })
    if (!checked.valid) {
      setIssues(checked.issues)
      setError('추가할 조건을 확인해 주세요.')
      return
    }
    changeConditions(conditions)
  }
  function removeCondition(kind: keyof TimetableConditions, index: number) {
    if (!session || !basis || !canEdit || batchPending) return
    const item = session.conditions[kind][index]
    if (kind !== 'preferences' && basis[kind].some((row) => canonical(row) === canonical(item))) {
      setError(
        '학교가 확정한 필수 조건은 여기서 해제할 수 없습니다. 기초 자료 담당자에게 수정을 요청해 주세요.',
      )
      return
    }
    const conditions = structuredClone(session.conditions)
    conditions[kind].splice(index, 1)
    changeConditions(conditions)
  }
  async function generate(scopeResourceId = '') {
    if (!effective || !session || !canEdit || operation.current || conditionPending) return
    const checked = validateBasis(effective)
    if (!checked.valid || !foundation?.ready || !preflight?.canCalculate) {
      setIssues([...checked.issues, ...(foundation?.issues ?? []), ...(preflight?.issues ?? [])])
      setError('기초 자료와 조건을 먼저 확인해 주세요.')
      return
    }
    const prepared = prepareScopedSolve(
      effective,
      session.placements,
      workingLocks,
      scopeResourceId,
    )
    if (!prepared.basis) {
      setIssues(prepared.issues)
      setError('고정 배치와 부분 재계산 범위를 확인해 주세요.')
      return
    }
    const solveBasis = prepared.basis
    const beforeSolve = reviewTimetablePreflight(solveBasis)
    if (!beforeSolve.canCalculate) {
      setIssues(beforeSolve.issues)
      setError(
        '고정 배치와 현재 조건에서 해결해야 할 항목이 있습니다. 아래 문제 목록을 확인해 주세요.',
      )
      return
    }
    operation.current = true
    setSolving(true)
    setError('')
    setNotice('')
    setIssues([])
    const epoch = life.current,
      source = canonical(effective)
    try {
      const task = runSolver(structuredClone(solveBasis))
      solver.current = task
      const next = await task.promise
      if (epoch !== life.current) return
      const latest = currentSession.current
      if (
        !liveBasis.current.allowed ||
        canonical(liveBasis.current.basis) !== source ||
        !latest ||
        latest.basisIdentity !== basisIdentity(effective) ||
        canonical({ ...effective, ...latest.conditions }) !== source
      )
        return
      if (!validateSolveResult(solveBasis, next)) {
        setError('계산 응답의 형식을 확인하지 못했습니다. 이전 배치와 입력은 유지합니다.')
        return
      }
      setResult(next)
      if (next.status === 'feasible') {
        const validated = validatePlacements(solveBasis, next.placements)
        if (!validated.valid) {
          setIssues(validated.issues)
          setError('계산 결과가 독립 검사를 통과하지 못해 채택하지 않았습니다.')
          return
        }
        update({
          ...latest,
          placements: structuredClone(next.placements),
          placementBasis: structuredClone(effective),
          previous: latest.placements ? structuredClone(latest.placements) : null,
          previousBasis: latest.placementBasis,
          conditionsChanged: false,
          dirty: true,
        })
        setNotice(
          scopeResourceId
            ? `선택 대상만 다시 계산했습니다. ${prepared.kept}개 고정 배치를 유지하고 전체 필수조건을 다시 검사했습니다.`
            : '필수 조건을 통과한 배치를 찾았습니다. 선호 조건과 수업별 배치를 확인해 주세요.',
        )
        setStep('compose')
      } else {
        setIssues(next.issues)
        setNotice(
          next.status === 'infeasible'
            ? '현재 지원 범위의 조건을 모두 탐색했지만 가능한 배치가 없습니다. 필수 조건은 자동으로 완화하지 않습니다.'
            : next.status === 'unknown'
              ? '이번 계산 한도 안에서 가능한 배치를 찾지 못했습니다. 불가능하다는 뜻은 아닙니다.'
              : '입력 또는 지원하지 않는 조건을 먼저 확인해 주세요.',
        )
      }
    } catch (failure) {
      if (epoch === life.current) setError(safeMessage(failure))
    } finally {
      if (epoch === life.current) {
        solver.current = undefined
        operation.current = false
        setSolving(false)
      }
    }
  }
  function applyAdjustment(command: AdjustmentCommand, requestedSource: string) {
    const latest = currentSession.current
    if (
      !latest?.placements ||
      !effective ||
      !canEdit ||
      conditionPending ||
      latest.conditionsChanged
    )
      return
    const currentBasis = { ...effective, ...latest.conditions },
      locks = latest.lockedLessonIds ?? []
    if (
      !liveBasis.current.allowed ||
      canonical(liveBasis.current.basis) !== canonical(currentBasis) ||
      requestedSource !== adjustmentSourceKey(currentBasis, latest.placements, locks)
    ) {
      setError('조정 기준이 바뀌었습니다. 현재 수업과 조건을 다시 확인해 주세요.')
      return
    }
    const reviewed = reviewAdjustment(currentBasis, latest.placements, locks, command)
    if (!reviewed.valid) {
      setIssues(reviewed.issues)
      setError('이 조정은 현재 필수 조건을 통과하지 못했습니다. 기존 배치를 유지합니다.')
      return
    }
    update({
      ...latest,
      placements: structuredClone(reviewed.placements),
      placementBasis: structuredClone(currentBasis),
      previous: structuredClone(latest.placements),
      previousBasis: latest.placementBasis,
      dirty: true,
    })
    setSelectedLesson('')
    setResult(undefined)
    setIssues([])
    setError('')
    setNotice(
      reviewed.complete
        ? command.kind === 'swap'
          ? '두 수업을 함께 교환하고 전체 필수 조건을 다시 검사했습니다. 직전 배치로 되돌릴 수 있습니다.'
          : '이동 후 전체 배치를 다시 검사했습니다. 이전 배치는 되돌릴 수 있습니다.'
        : `작업 초안에 배치했습니다. 미배정 ${reviewed.missingLessonIds.length}개를 더 마쳐야 저장할 수 있습니다.`,
    )
  }
  function undoMove() {
    if (
      !session?.previous ||
      !session.placements ||
      !effective ||
      !canEdit ||
      conditionPending ||
      session.conditionsChanged
    )
      return
    const checked = reviewProtectedPlacements(
      effective,
      session.placements,
      session.previous,
      workingLocks,
    )
    if (!checked.valid) {
      setIssues(checked.issues)
      setError('되돌릴 배치가 현재 조건 또는 작업 고정과 다릅니다. 먼저 해당 고정을 확인해 주세요.')
      return
    }
    update({
      ...session,
      placements: session.previous,
      placementBasis: structuredClone(effective),
      previous: session.placements,
      previousBasis: session.placementBasis,
      dirty: true,
    })
    setSelectedLesson('')
    setResult(undefined)
    setIssues([])
    setError('')
    setNotice(
      checked.complete
        ? '직전 배치로 돌아왔습니다. 전체 필수 조건을 다시 검사했습니다.'
        : `직전 미완성 배치로 돌아왔습니다. 남은 미배정 ${checked.missingLessonIds.length}개는 저장 전 마쳐야 합니다.`,
    )
  }
  function loadDraft(draft: TimetableDraft) {
    if (!basis || locked || session?.dirty) return
    const checked = validatePlacements({ ...basis, ...draft.conditions }, draft.placements)
    if (!checked.valid) {
      setIssues(checked.issues)
      return
    }
    update({
      ...initialSession(basis, false),
      title: draft.title,
      savedDraft: {
        id: draft.id,
        version: draft.version,
        commandKey: canonical(timetableDraftCommand(basis, draft)),
      },
      conditions: structuredClone(draft.conditions),
      placements: structuredClone(draft.placements),
      placementBasis: structuredClone({ ...basis, ...draft.conditions }),
    })
    setStep('compose')
    setNotice('서버에 저장된 초안을 열었습니다. 이후 저장은 새 초안으로 남습니다.')
  }
  async function save(retry = false) {
    if (operation.current || practice || !enabled) return
    let request: { command: SaveDraftInput; key: string }
    if (retry) {
      if (!pending) return
      request = pending as { command: SaveDraftInput; key: string }
    } else {
      if (
        !basis ||
        !session?.placements ||
        !session.dirty ||
        session.conditionsChanged ||
        conditionPending ||
        !candidateCheck?.valid ||
        !session.title.trim() ||
        !canEdit ||
        !current?.canSave
      )
        return
      request = {
        key: crypto.randomUUID(),
        command: {
          basisId: basis.id,
          basisRevision: basis.revision,
          sourceFingerprint: basis.sourceFingerprint,
          title: session.title.trim(),
          conditions: structuredClone(session.conditions),
          placements: structuredClone(session.placements),
        },
      }
      recovery.put(request)
    }
    const epoch = life.current
    operation.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const receipt = await (retry
        ? server.recoverDraft(member.id, request.command, request.key)
        : server.saveDraft(member.id, request.command, request.key))
      if (epoch !== life.current) return
      recovery.remove(request.key)
      const latest = currentSession.current
      if (
        latest?.placementBasis &&
        canonical(timetableDraftCommand(latest.placementBasis, latest)) ===
          canonical(request.command)
      )
        update({
          ...latest,
          dirty: false,
          savedDraft: {
            id: receipt.draftId,
            version: receipt.version,
            commandKey: canonical(request.command),
          },
        })
      setNotice('학교 서버에 새 초안을 저장했습니다. 교사에게 공개된 시간표는 바뀌지 않았습니다.')
      setReload((value) => value + 1)
    } catch (failure) {
      if (epoch !== life.current) return
      if (
        retry
          ? failure instanceof ServiceError && failure.code === 'NOT_FOUND'
          : confirmedRejection(failure)
      ) {
        recovery.remove(request.key)
        if (failure instanceof ServiceError && failure.code === 'CONFLICT')
          setReload((value) => value + 1)
      }
      setError(safeMessage(failure))
    } finally {
      if (epoch === life.current) {
        operation.current = false
        setBusy(false)
      }
    }
  }
  function makeAiSheet() {
    if (!basis || !session || !aiText.trim() || stale || locked) return
    setAiSheet(
      [
        '시간표 조건 검토 요청',
        `기준 자료: ${basis.id} / ${basis.revision}판`,
        `필수 고정 ${session.conditions.fixed.length}건 · 불가시간 ${session.conditions.unavailable.length}건 · 선호 ${session.conditions.preferences.length}건`,
        '',
        aiText.trim(),
        '',
        '먼저 모호한 대상·기간을 질문하고 필수 조건과 선호 조건을 구분해 주세요. 확정된 교사·학급·시수는 임의 변경하지 않습니다. 제안만 작성하고 저장·공개·교환 승인은 하지 않습니다.',
      ].join('\n'),
    )
    setNotice(
      'Claude에게 전달할 요청서를 정리했습니다. 아직 AI에 전송하거나 조건을 바꾸지 않았습니다.',
    )
  }

  return {
    addCondition,
    adoptEngineCandidate,
    aiLocked,
    aiOpenRequest,
    aiRecovery,
    aiSheet,
    aiText,
    applyAdjustment,
    assistantServer,
    basis,
    batchPending,
    busy,
    canEdit,
    candidateCheck,
    changeBatch,
    changeConditions,
    changeForm,
    clearConditionInput,
    commandLocked,
    conditionPending,
    conditionSearch,
    current,
    discardConfirm,
    discardUnavailable,
    effective,
    enabled,
    enterPractice,
    error,
    feedback,
    filter,
    foundation,
    generate,
    id,
    importWorkingDraft,
    initialPreparationStep,
    inputCheck,
    issues,
    knownTarget,
    leavePractice,
    loadDraft,
    loadError,
    loading,
    locked,
    makeAiSheet,
    matchingTargets,
    member,
    navLocked,
    navigateStep,
    notice,
    observeTarget,
    onOpenOperations,
    onOpenPublished,
    onOpenSchoolAdmin,
    openSavedPublication,
    otherTargetLocks,
    partialCheck,
    pending,
    practice,
    preflight,
    preparationLocked,
    preparationRecovery,
    preparationServer,
    ready,
    recheckWorkingPlacements,
    removeCondition,
    resetDraft,
    result,
    revision,
    save,
    savedForCurrent,
    selectedConditionTime,
    selectedLesson,
    selectedTarget,
    session,
    setAiInputLocked,
    setAiLocked,
    setAiOpenRequest,
    setAiSheet,
    setAiText,
    setConditionSearch,
    setDiscardConfirm,
    setError,
    setFilter,
    setPreparationLocked,
    setReload,
    setSelectedLesson,
    setTab,
    setTargetLocked,
    setWeek,
    setupBatchRecovery,
    setupRecovery,
    setupServer,
    shownTargets,
    singleConditionPending,
    solver,
    solving,
    stale,
    step,
    stepHeading,
    tab,
    targetBlocked,
    targetChecking,
    targetEpoch,
    targetLabel,
    targetRefresh,
    targetServer,
    toggleWorkingLock,
    undoMove,
    update,
    viewable,
    week,
    workingLocks,
  }
}
