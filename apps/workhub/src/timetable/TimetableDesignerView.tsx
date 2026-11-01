import { TimetableBasisStep } from './TimetableBasisStep'
import { TimetableConditionsStep } from './TimetableConditionsStep'
import { TimetableComposeStep } from './TimetableComposeStep'
import { TimetablePublishStep } from './TimetablePublishStep'
import { retryableLazy as lazy } from '../app/retryable-lazy'
import { Suspense } from 'react'
import { timetablePolicy } from '../../../../packages/timetable/src/validate'
import type { TimetableIssue } from '../../../../packages/timetable/src/types'
import { timetableWeekStart } from './server'
import limits from './limits.json'
import styles from './timetable.css?inline'
import themeStyles from './timetable-theme.css?inline'
import editorStyles from './timetable-editor-usability.css?inline'
import workflowStyles from './timetable-workflow-ui.css?inline'
import { ComposerOptions } from '../app/ComposerOptions'
import { TimetableEditorProgress } from './TimetableEditorProgress'
import { TimetableFlowGuide } from './TimetableFlowGuide'
import { TimetableBoard } from './TimetableBoard'
import { TimetableAdjustmentPanel } from './TimetableAdjustmentPanel'
import { TimetablePreflightPanel } from './TimetablePreflightPanel'
import { FoundationPanel } from './FoundationPanel'
import { TimetableQualitySummary } from './TimetableQualitySummary'
import { ConditionCards } from './ConditionCards'
import { ConditionBatchPanel } from './ConditionBatchPanel'
import { initialConditionBatch } from './condition-batch'
import { TimetableTargetPanel } from './TimetableTargetPanel'
import { ConditionForm, steps, timetableClock, slotLabel, conditionLabels } from './designer-model'
import type { useTimetableDesigner } from './useTimetableDesigner'
export function TimetableDesignerView({
  model,
}: {
  model: ReturnType<typeof useTimetableDesigner>
}) {
  const {
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
  } = model
  return (
    <section
      className="timetable-workspace timetable-workflow-ui"
      aria-labelledby={`${id}-heading`}
    >
      <style>{themeStyles + styles + editorStyles + workflowStyles}</style>
      <header className="timetable-heading">
        <div>
          <p className="timetable-eyebrow">{onOpenPublished ? '편성 관리' : '나의 수업'}</p>
          <h1 id={`${id}-heading`}>시간표</h1>
          <p className="timetable-muted">
            {onOpenPublished
              ? '다음 시간표의 기초 자료와 배치를 준비합니다. 이미 공개된 수업은 시간표 보기에서 확인하세요.'
              : '확정된 수업을 확인하고, 담당자는 다음 시간표를 준비합니다.'}
          </p>
        </div>
        <span className="timetable-badge">
          {practice ? '예시로 편성 연습' : '연결 시험 · 관리자 공개'}
        </span>
      </header>
      <div ref={feedback} tabIndex={-1}>
        {error && (
          <p role="alert" className="timetable-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="timetable-notice">
            {notice}
          </p>
        )}
      </div>
      {targetServer && !practice && (
        <div
          ref={(node) => {
            if (node && initialPreparationStep === 'target' && node.dataset.focused !== 'true') {
              node.dataset.focused = 'true'
              node.focus()
              node.scrollIntoView({ block: 'nearest' })
            }
          }}
          tabIndex={-1}
          aria-label="대상 학기 선택 연결"
        >
          <TimetableTargetPanel
            server={targetServer}
            member={member}
            disabled={!enabled || otherTargetLocks.current}
            refreshKey={revision + targetRefresh}
            onLockChange={setTargetLocked}
            onStateChange={observeTarget}
          />
        </div>
      )}
      {targetChecking && !practice && knownTarget && (
        <p role="status" className="timetable-notice">
          준비 학기를 다시 확인하는 동안 새 변경을 잠시 멈춥니다. 원래 요청의 결과 확인은 계속할 수
          있습니다.
        </p>
      )}
      {pending && (
        <div className="timetable-notice">
          <strong>저장 결과를 확인하고 있습니다</strong>
          <p>원래 입력과 요청 번호를 보관했습니다. 새 저장 요청을 만들지 않습니다.</p>
          <p className="timetable-muted">요청 번호: {pending.key}</p>
          <button
            type="button"
            disabled={busy || solving || !enabled}
            onClick={() => void save(true)}
          >
            {busy ? '확인 중…' : '같은 요청으로 저장 결과 확인'}
          </button>
        </div>
      )}
      {(!viewable || current?.canDesign === false) &&
        !pending &&
        !busy &&
        !solving &&
        (session?.dirty || aiText.trim()) && (
          <div className="timetable-notice">
            <p>이 화면에서 입력한 내용이 현재 탭에 보관되어 메뉴 이동을 잠시 막고 있습니다.</p>
            {!discardConfirm ? (
              <button type="button" className="secondary" onClick={() => setDiscardConfirm(true)}>
                보관한 입력 정리
              </button>
            ) : (
              <>
                <p>
                  버리면 작성한 조건·배치·AI 요청 입력을 복구할 수 없습니다. 서버에 저장된 초안은
                  유지됩니다.
                </p>
                <div className="timetable-actions">
                  <button type="button" onClick={discardUnavailable}>
                    입력 버리고 메뉴 잠금 해제
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setDiscardConfirm(false)}
                  >
                    입력 계속 보관
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      {!practice && loading && (
        <p role="status">
          현재 학교의 시간표 연결을 확인하고 있습니다. 작성 중인 입력은 유지합니다.
        </p>
      )}
      {!practice && loadError && (
        <div className="timetable-error">
          <h2>시간표 연결을 다시 확인해 주세요</h2>
          <p>현재 권한을 확인할 때까지 수업과 보관한 입력을 숨깁니다.</p>
          <p>{loadError}</p>
          <div className="timetable-actions">
            <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>
              시간표 연결 다시 확인
            </button>
            {enabled && (
              <button
                type="button"
                className="secondary"
                disabled={locked || Boolean(session?.dirty) || Boolean(aiText.trim())}
                onClick={enterPractice}
              >
                예시로 편성 연습
              </button>
            )}
          </div>
          <p className="timetable-muted">
            연습을 직접 선택하면 실제 학교 자료와 구분된 예시만 열립니다.
          </p>
        </div>
      )}
      {!practice && !loading && !loadError && ready && !ready.available && (
        <div className="timetable-empty">
          <h2>
            {ready.reason === 'not_allowed'
              ? '시간표 이용 권한을 확인해 주세요'
              : ready.reason === 'basis_missing'
                ? '시간표 기초 자료를 준비하고 있습니다'
                : '시간표 서버 연결을 준비하고 있습니다'}
          </h2>
          <p>학교의 확정 자료가 연결되면 실제 수업을 조회하고 초안을 저장할 수 있습니다.</p>
          <ol>
            <li>학교·교사·학급·시수와 배정을 확인합니다.</li>
            <li>필수 조건과 선호 조건을 정리합니다.</li>
            <li>배치를 만들고 충돌을 검사합니다.</li>
            <li>담당자 검토 후 별도 공개 절차를 진행합니다.</li>
          </ol>
          <div className="timetable-actions">
            <button type="button" disabled={locked} onClick={() => setReload((value) => value + 1)}>
              연결 상태 다시 확인
            </button>
            {ready.reason !== 'not_allowed' && (
              <button
                type="button"
                className="secondary"
                disabled={locked || Boolean(session?.dirty)}
                onClick={enterPractice}
              >
                예시로 편성 연습
              </button>
            )}
            {onOpenSchoolAdmin && (
              <button
                type="button"
                className="secondary"
                disabled={navLocked}
                onClick={onOpenSchoolAdmin}
              >
                학교 기초 자료 열기
              </button>
            )}
          </div>
          <p className="timetable-muted">
            편성 연습은 가상 자료만 사용하며 학교 자료를 생성하지 않습니다.
          </p>
        </div>
      )}
      {practice && (
        <div className="timetable-notice timetable-practice">
          <strong>가상 자료로 편성 연습 중</strong>
          <p>
            이 예시는 실제 학교와 연결되지 않습니다. 서버 저장·공개·교환 요청은 실행하지 않습니다.
          </p>
          <button type="button" className="secondary" disabled={locked} onClick={leavePractice}>
            연습 마치기 · 연습 입력 버리기
          </button>
        </div>
      )}
      {viewable && current && (
        <>
          {!onOpenPublished && (
            <nav className="timetable-tabs" aria-label="시간표 보기">
              <button
                type="button"
                aria-pressed={tab === 'mine'}
                disabled={locked || practice}
                onClick={() => setTab('mine')}
              >
                {onOpenPublished ? '공개 시간표 보기' : '내 시간표'}
              </button>
              {current.canDesign && (
                <button
                  type="button"
                  aria-pressed={tab === 'design'}
                  disabled={locked}
                  onClick={() => setTab('design')}
                >
                  시간표 만들기
                </button>
              )}
            </nav>
          )}
          {tab === 'mine' && !onOpenPublished && (
            <>
              <div className="timetable-toolbar">
                <h2>이번 주 내 수업</h2>
                <label>
                  조회할 날짜
                  <input
                    type="date"
                    aria-label="시간표 조회 날짜"
                    value={week}
                    disabled={locked}
                    onChange={(event) => {
                      if (event.target.value) setWeek(timetableWeekStart(event.target.value))
                    }}
                  />
                </label>
              </div>
              <p className="timetable-muted">
                {current.weekStart}부터 한 주 · 서버가 확인한 내 수업 관계만 표시합니다. 같은
                교시라도 실제 시작·종료 시각을 확인해 주세요.
              </p>
              <div className="timetable-day-list">
                {current.lessons.length ? (
                  [...current.lessons]
                    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute)
                    .map((lesson) => (
                      <article key={lesson.id} className="timetable-day-card">
                        <time dateTime={lesson.date}>
                          {lesson.date} · {timetableClock(lesson.startMinute)}–
                          {timetableClock(lesson.endMinute)}
                        </time>
                        <h3>
                          {lesson.label}{' '}
                          {lesson.status !== 'scheduled' && (
                            <span className="timetable-badge">
                              {lesson.status === 'changed' ? '변경됨' : '취소됨'}
                            </span>
                          )}
                        </h3>
                        <p>
                          {lesson.classNames.join(' · ')}
                          {lesson.roomNames.length ? ` / ${lesson.roomNames.join(' · ')}` : ''}
                        </p>
                        <p className="timetable-muted">
                          {lesson.teacherNames.join(' · ')} · 확인한 수업 {lesson.version}판
                        </p>
                      </article>
                    ))
                ) : (
                  <div className="timetable-empty">
                    <h3>이 주에 공개된 내 수업이 없습니다</h3>
                    <p>저장한 편성 초안은 교사에게 공개된 시간표와 구분됩니다.</p>
                  </div>
                )}
              </div>
              <details>
                <summary>수업 교환·변경은 어떻게 하나요?</summary>
                <p>
                  상단의 시간표 보기 화면에서 해당 날짜의 수업을 선택하면 변경안을 검토하고 관련
                  교사의 동의와 담당자 승인 절차를 진행할 수 있습니다. 실제 서버 연결과 현재 권한을
                  확인한 뒤 요청합니다.
                </p>
              </details>
            </>
          )}
          {tab === 'design' && basis && session && (
            <>
              <ol className="timetable-steps" aria-label="시간표 편성 단계">
                {steps.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={step === item.id ? 'step' : undefined}
                      disabled={locked}
                      onClick={() => navigateStep(item.id)}
                    >
                      <span className="timetable-step-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ol>
              <TimetableEditorProgress
                revision={basis.revision}
                conditionCount={
                  session.conditions.fixed.length +
                  session.conditions.unavailable.length +
                  session.conditions.preferences.length
                }
                conditionPending={conditionPending}
                stale={stale}
                checkingRequired={Boolean(session.conditionsChanged)}
                hasPlacements={Boolean(session.placements)}
                valid={Boolean(candidateCheck?.valid)}
                missingCount={
                  partialCheck?.valid ? partialCheck.missingLessonIds.length : undefined
                }
                dirty={session.dirty}
                practice={practice}
                pending={Boolean(pending)}
              />
              <TimetableFlowGuide
                state={{
                  step,
                  pending: Boolean(pending),
                  busy: busy || solving || aiLocked || preparationLocked,
                  stale,
                  conditionPending,
                  basisValid: Boolean(inputCheck?.valid),
                  foundationReady: Boolean(foundation?.ready),
                  canCalculate: Boolean(preflight?.canCalculate),
                  checkingRequired: Boolean(session.conditionsChanged),
                  hasPlacements: Boolean(session.placements),
                  valid: Boolean(candidateCheck?.valid),
                  missingCount: partialCheck?.valid ? partialCheck.missingLessonIds.length : 0,
                  dirty: session.dirty,
                  practice,
                  canSave: current.canSave,
                  saved: savedForCurrent,
                }}
                onStep={navigateStep}
                onHandoff={onOpenOperations ? openSavedPublication : undefined}
                handoffDisabled={navLocked || !savedForCurrent}
              />
              {stale && (
                <div role="alert" className="timetable-error">
                  <strong>기초 자료가 바뀌었습니다</strong>
                  <p>
                    작성한 조건과 배치는 보관했지만 이전 기준으로 계산하거나 저장하지 않습니다. 새
                    기준을 확인하고 편성을 다시 준비해 주세요.
                  </p>
                  <button type="button" disabled={locked} onClick={resetDraft}>
                    기존 초안 입력 버리고 새 기준으로 시작
                  </button>
                </div>
              )}
              {conditionPending && (
                <div className="timetable-notice">
                  <p>
                    입력 중인 조건이 아직 추가되지 않았습니다. 조건을 추가하거나 비운 뒤 계산·저장해
                    주세요.
                  </p>
                  <div className="timetable-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={locked}
                      onClick={() => navigateStep('conditions')}
                    >
                      입력 중인 조건 확인
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canEdit}
                      onClick={clearConditionInput}
                    >
                      입력 중인 조건 비우기
                    </button>
                  </div>
                </div>
              )}
              <TimetableBasisStep model={model} />
              <TimetableConditionsStep model={model} />
              <TimetableComposeStep model={model} />
              <TimetablePublishStep model={model} />
              {issues.length > 0 && (
                <div className="timetable-error">
                  <h3>확인할 항목</h3>
                  <IssueList issues={issues} />
                </div>
              )}
              {step === 'compose' && effective && (
                <Suspense fallback={<p role="status">후보 비교 도구를 준비하는 중…</p>}>
                  <TimetableCandidateLibrary
                    member={member}
                    basis={effective}
                    placements={session.placements}
                    title={session.title}
                    disabled={!canEdit || conditionPending || Boolean(session.conditionsChanged)}
                    onAdopt={adoptEngineCandidate}
                  />
                </Suspense>
              )}
              {step === 'compose' && effective && <TimetablePreflightPanel basis={effective} />}
              {step === 'compose' && effective && (
                <Suspense fallback={<p role="status">최적화 도구를 준비하는 중…</p>}>
                  <TimetableEnginePanel
                    member={member}
                    basis={effective}
                    placements={session.placements}
                    previous={
                      session.placementBasis && session.placements
                        ? { basis: session.placementBasis, placements: session.placements }
                        : undefined
                    }
                    lockedLessonIds={workingLocks}
                    scopeResourceId={filter}
                    disabled={!canEdit || conditionPending || !foundation?.ready}
                    onAdopt={adoptEngineCandidate}
                  />
                </Suspense>
              )}
              <Suspense fallback={<p role="status">엑셀 작업 도구를 준비하는 중…</p>}>
                <TimetableWorkbookPanel
                  basis={basis}
                  conditions={session.conditions}
                  placements={session.placements ?? []}
                  title={session.title}
                  disabled={!canEdit || conditionPending}
                  onImport={importWorkingDraft}
                />
              </Suspense>
              {(!assistantServer || practice) && (
                <details className="timetable-card">
                  <summary>Claude에게 조건 정리를 부탁하려면</summary>
                  <p>
                    AI는 조건을 정리하고 조정안을 제안합니다. 계산과 충돌 검사는 프로그램이
                    담당합니다. 학교 비서 연결이 준비되면 아래 Claude 도움에서 직접 요청할 수
                    있습니다. 이 요청서는 외부 검토용으로만 정리합니다.
                  </p>
                  <label>
                    정리하고 싶은 요청
                    <textarea
                      aria-label="정리하고 싶은 요청"
                      rows={3}
                      maxLength={limits.assistantText}
                      value={aiText}
                      disabled={locked || stale}
                      onChange={(event) => {
                        setAiText(event.target.value)
                        setAiSheet('')
                      }}
                      placeholder="예: 수요일 오후 교사 회의 시간을 피하고 싶어요. 필수 조건인지 선호 조건인지 먼저 확인해 주세요."
                    />
                  </label>
                  <div className="timetable-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!aiText.trim() || locked || stale}
                      onClick={makeAiSheet}
                    >
                      Claude 전달용 요청서 정리
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={locked}
                      onClick={() => {
                        setAiText('')
                        setAiSheet('')
                      }}
                    >
                      AI 요청 입력 비우기
                    </button>
                  </div>
                  {aiSheet && (
                    <label>
                      Claude 전달용 요청서
                      <textarea
                        aria-label="Claude 전달용 요청서"
                        rows={8}
                        readOnly
                        value={aiSheet}
                      />
                    </label>
                  )}
                  <p className="timetable-muted">
                    요청서는 자동 전송되지 않습니다. 개인의 결근·상담 사유는 넣지 마세요.
                  </p>
                </details>
              )}
              <details>
                <summary>편성을 처음부터 다시 준비</summary>
                <p>
                  지금 작성 중인 조건과 배치를 버리고 현재 기초 자료에서 다시 시작합니다. 서버에
                  저장한 초안은 지우지 않습니다.
                </p>
                <button type="button" className="secondary" disabled={locked} onClick={resetDraft}>
                  현재 편성 입력 버리고 새로 시작
                </button>
              </details>
            </>
          )}
        </>
      )}
      {(((preparationServer || setupServer) && !practice) ||
        preparationRecovery.request ||
        setupRecovery.request ||
        setupBatchRecovery.request) && (
        <Suspense fallback={<p role="status">학교 편성 준비 화면을 준비하는 중…</p>}>
          <TimetablePreparationPanel
            initialOpen={
              initialPreparationStep === 'setup' || initialPreparationStep === 'preparation'
            }
            initialSetupOpen={initialPreparationStep === 'setup'}
            server={practice ? undefined : preparationServer}
            setupServer={practice ? undefined : setupServer}
            onOpenSchoolAdmin={onOpenSchoolAdmin}
            member={member}
            expectedTermId={knownTarget?.termId}
            refreshRevision={targetEpoch}
            disabled={
              targetBlocked ||
              commandLocked ||
              aiLocked ||
              !enabled ||
              practice ||
              Boolean(session?.dirty) ||
              conditionPending
            }
            onLockChange={setPreparationLocked}
            onBasisConfirmed={() => setReload((value) => value + 1)}
          />
        </Suspense>
      )}
      {((assistantServer && !practice) || aiRecovery.request) && (
        <Suspense fallback={<p role="status">시간표 AI 도움을 준비하는 중…</p>}>
          <TimetableAssistantPanel
            openRequest={aiOpenRequest}
            server={practice ? undefined : assistantServer}
            member={member}
            basis={viewable && !stale && current?.canDesign ? basis : null}
            conditions={
              viewable && !stale && current?.canDesign ? (session?.conditions ?? null) : null
            }
            placements={viewable && !stale && current?.canDesign ? (session?.placements ?? []) : []}
            disabled={
              targetBlocked ||
              commandLocked ||
              preparationLocked ||
              !viewable ||
              stale ||
              !basis ||
              !session ||
              practice ||
              !current?.canDesign ||
              conditionPending
            }
            onApply={(conditions) => changeConditions(conditions, true)}
            onLockChange={setAiLocked}
            onInputLockChange={setAiInputLocked}
          />
        </Suspense>
      )}
    </section>
  )
}
export function IssueList({ issues }: { issues: TimetableIssue[] }) {
  return (
    <ul className="timetable-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          {issue.message} <small className="timetable-muted">({issue.code})</small>
        </li>
      ))}
    </ul>
  )
}
const TimetableWorkbookPanel = lazy(() =>
  import('./TimetableWorkbookPanel').then((module) => ({ default: module.TimetableWorkbookPanel })),
)
const TimetableCandidateLibrary = lazy(() =>
  import('./TimetableCandidateLibrary').then((module) => ({
    default: module.TimetableCandidateLibrary,
  })),
)
const TimetableEnginePanel = lazy(() =>
  import('./TimetableEnginePanel').then((module) => ({ default: module.TimetableEnginePanel })),
)
const TimetableAssistantPanel = lazy(() =>
  import('./TimetableAssistantPanel').then((module) => ({
    default: module.TimetableAssistantPanel,
  })),
)
const TimetablePreparationPanel = lazy(() =>
  import('./TimetablePreparationPanel').then((module) => ({
    default: module.TimetablePreparationPanel,
  })),
)
