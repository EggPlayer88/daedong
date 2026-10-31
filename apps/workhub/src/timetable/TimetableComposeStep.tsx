import { TimetableBoard } from './TimetableBoard'
import { TimetableAdjustmentPanel } from './TimetableAdjustmentPanel'
import { TimetableQualitySummary } from './TimetableQualitySummary'
import type { useTimetableDesigner } from './useTimetableDesigner'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function TimetableComposeStep({
  model,
}: {
  model: Pick<
    ReturnType<typeof useTimetableDesigner>,
    | 'applyAdjustment'
    | 'assistantServer'
    | 'basis'
    | 'canEdit'
    | 'candidateCheck'
    | 'conditionPending'
    | 'current'
    | 'effective'
    | 'filter'
    | 'foundation'
    | 'generate'
    | 'id'
    | 'inputCheck'
    | 'loadDraft'
    | 'locked'
    | 'navigateStep'
    | 'partialCheck'
    | 'practice'
    | 'preflight'
    | 'ready'
    | 'recheckWorkingPlacements'
    | 'result'
    | 'selectedLesson'
    | 'session'
    | 'setAiOpenRequest'
    | 'setError'
    | 'setFilter'
    | 'setSelectedLesson'
    | 'solver'
    | 'solving'
    | 'stale'
    | 'step'
    | 'stepHeading'
    | 'toggleWorkingLock'
    | 'undoMove'
    | 'workingLocks'
  >
}) {
  const {
    applyAdjustment,
    assistantServer,
    basis,
    canEdit,
    candidateCheck,
    conditionPending,
    current,
    effective,
    filter,
    foundation,
    generate,
    id,
    inputCheck,
    loadDraft,
    locked,
    navigateStep,
    partialCheck,
    practice,
    preflight,
    ready,
    recheckWorkingPlacements,
    result,
    selectedLesson,
    session,
    setAiOpenRequest,
    setError,
    setFilter,
    setSelectedLesson,
    solver,
    solving,
    stale,
    step,
    stepHeading,
    toggleWorkingLock,
    undoMove,
    workingLocks,
  } = model
  if (!basis || !session || !current) return null
  return (
    <>
      {step === 'compose' && (
        <>
          <section className="timetable-card">
            <div className="timetable-actions">
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => navigateStep('conditions')}
              >
                조건 다시 살펴보기
              </button>
            </div>
            <div className="timetable-toolbar">
              <div>
                <h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">
                  3. 배치 만들기와 조정
                </h2>
                <p>
                  수업을 눌러 이동하거나 두 수업을 함께 바꿀 수 있습니다. 미배정 수업도 이어서
                  완성할 수 있습니다.
                </p>
              </div>
              <div className="timetable-actions">
                <button
                  type="button"
                  disabled={
                    !canEdit ||
                    conditionPending ||
                    !inputCheck?.valid ||
                    !foundation?.ready ||
                    !preflight?.canCalculate
                  }
                  onClick={() => void generate()}
                >
                  {session.placements ? '다시 계산' : '배치 만들기'}
                </button>
                {solving && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => solver.current?.cancel()}
                  >
                    계산 중지
                  </button>
                )}
              </div>
            </div>
            {solving && (
              <p role="status">
                별도 계산 작업자에서 배치를 찾고 있습니다. 중지해도 입력은 유지됩니다.
              </p>
            )}
            {result && (
              <details className="timetable-calculation-details">
                <summary>계산 결과 자세히</summary>
                <p className="timetable-muted">
                  이번 탐색 {result.stats.nodes.toLocaleString()}개 ·{' '}
                  {Math.round(result.stats.elapsedMs)}ms
                  {result.score !== null ? ` · 선호 벌점 ${result.score}` : ''} · 최적해 보장 없음
                </p>
              </details>
            )}
            {session.placements && !session.conditionsChanged && candidateCheck && (
              <p
                className={candidateCheck.valid ? 'timetable-validation' : 'timetable-error'}
                role="status"
              >
                {candidateCheck.valid
                  ? '전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인'
                  : partialCheck?.valid && partialCheck.missingLessonIds.length
                    ? `배치된 수업 검사 통과 · 미배정 ${partialCheck.missingLessonIds.length}개 · 저장·확정 전 완성 필요`
                    : '충돌이 있어 이 배치를 저장할 수 없습니다.'}
              </p>
            )}
            {session.placements && effective && !session.conditionsChanged ? (
              <>
                <TimetableQualitySummary
                  basis={effective}
                  placements={session.placements}
                  previous={session.previous}
                  previousBasis={session.previousBasis}
                />
                {assistantServer && !practice && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={locked || stale || conditionPending || !candidateCheck?.valid}
                    onClick={() =>
                      setAiOpenRequest((value) => ({
                        stage: 'adjust',
                        token: (value?.token ?? 0) + 1,
                      }))
                    }
                  >
                    Claude 결과 검토 열기
                  </button>
                )}
                <label>
                  표에서 볼 대상
                  <select
                    aria-label="표에서 볼 대상"
                    value={filter}
                    disabled={locked}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="">전체 수업</option>
                    {basis.resources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="timetable-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canEdit || conditionPending || !candidateCheck?.valid || !filter}
                    onClick={() => void generate(filter)}
                  >
                    선택 대상만 다시 계산
                  </button>
                  <span className="timetable-muted">
                    작업 중 고정 {workingLocks.length}개 · 선택 대상 밖의 배치도 유지합니다.
                  </span>
                </div>
                <TimetableBoard
                  basis={effective}
                  placements={session.placements}
                  filterResourceId={filter}
                  selectedLessonId={selectedLesson}
                  disabled={!canEdit || conditionPending}
                  onSelect={(lessonId) => {
                    setSelectedLesson(lessonId)
                    setError('')
                  }}
                />
                <TimetableAdjustmentPanel
                  basis={effective}
                  placements={session.placements}
                  lockedLessonIds={workingLocks}
                  selectedLessonId={selectedLesson}
                  disabled={!canEdit || conditionPending}
                  onSelect={setSelectedLesson}
                  onToggleLock={toggleWorkingLock}
                  onApply={applyAdjustment}
                />
                <div className="timetable-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canEdit || conditionPending || !session.previous}
                    onClick={undoMove}
                  >
                    직전 배치로 되돌리기
                  </button>
                  <button
                    type="button"
                    disabled={!candidateCheck?.valid || conditionPending || locked || stale}
                    onClick={() => navigateStep('publish')}
                  >
                    초안 저장·공개 검토
                  </button>
                </div>
              </>
            ) : (
              <div className="timetable-empty">
                {session.conditionsChanged ? (
                  <>
                    <p>
                      조건 변경 전의 배치를 보관하고 있습니다. 다시 검사하면 기존 배치를 보며 조정할
                      수 있습니다.
                    </p>
                    <button
                      type="button"
                      disabled={!canEdit || conditionPending}
                      onClick={recheckWorkingPlacements}
                    >
                      보관한 배치 다시 검사
                    </button>
                  </>
                ) : (
                  '아직 만든 배치가 없습니다. 조건을 확인한 뒤 배치 만들기를 눌러 주세요.'
                )}
              </div>
            )}
          </section>
          {current.drafts.length > 0 && (
            <section className="timetable-card">
              <h3>저장한 초안</h3>
              <ul className="timetable-list">
                {current.drafts.map((draft) => (
                  <li key={draft.id} className="timetable-list-row">
                    <div>
                      {draft.title}
                      <small>
                        기초 자료 {draft.basisRevision}판 · 초안 {draft.version}판
                      </small>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={locked || Boolean(session.dirty)}
                      onClick={() => loadDraft(draft)}
                    >
                      이 초안 열기
                    </button>
                  </li>
                ))}
              </ul>
              {session.dirty && (
                <p className="timetable-muted">
                  작성 중인 초안을 저장하거나 새 편성으로 정리한 뒤 다른 초안을 열 수 있습니다.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </>
  )
}
