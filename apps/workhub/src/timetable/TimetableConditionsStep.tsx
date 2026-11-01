import { timetablePolicy } from '../../../../packages/timetable/src/validate'
import { ComposerOptions } from '../app/ComposerOptions'
import { ConditionCards } from './ConditionCards'
import { ConditionBatchPanel } from './ConditionBatchPanel'
import { initialConditionBatch } from './condition-batch'
import { ConditionForm, slotLabel, conditionLabels } from './designer-model'
import type { useTimetableDesigner } from './useTimetableDesigner'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function TimetableConditionsStep({
  model,
}: {
  model: Pick<
    ReturnType<typeof useTimetableDesigner>,
    | 'addCondition'
    | 'assistantServer'
    | 'basis'
    | 'batchPending'
    | 'canEdit'
    | 'changeBatch'
    | 'changeConditions'
    | 'changeForm'
    | 'conditionPending'
    | 'conditionSearch'
    | 'filter'
    | 'id'
    | 'inputCheck'
    | 'locked'
    | 'matchingTargets'
    | 'navigateStep'
    | 'practice'
    | 'removeCondition'
    | 'selectedConditionTime'
    | 'selectedTarget'
    | 'session'
    | 'setAiOpenRequest'
    | 'setConditionSearch'
    | 'shownTargets'
    | 'singleConditionPending'
    | 'stale'
    | 'step'
    | 'stepHeading'
    | 'targetLabel'
    | 'current'
  >
}) {
  const {
    addCondition,
    assistantServer,
    basis,
    batchPending,
    canEdit,
    changeBatch,
    changeConditions,
    changeForm,
    conditionPending,
    conditionSearch,
    filter,
    id,
    inputCheck,
    locked,
    matchingTargets,
    navigateStep,
    practice,
    removeCondition,
    selectedConditionTime,
    selectedTarget,
    session,
    setAiOpenRequest,
    setConditionSearch,
    shownTargets,
    singleConditionPending,
    stale,
    step,
    stepHeading,
    targetLabel,
    current,
  } = model
  if (!basis || !session || !current) return null
  return (
    <>
      {step === 'conditions' && (
        <section className="timetable-card">
          <div className="tt-workflow-title">
            <div>
              <span className="tt-workflow-kicker">조건 정리</span>
              <h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">
                2. 필수 조건과 선호 조건
              </h2>
              <p>꼭 지킬 조건과 가능하면 피할 시간을 나누어 입력하세요.</p>
            </div>
          </div>
          {assistantServer && !practice && (
            <button
              type="button"
              className="secondary"
              disabled={locked || stale || conditionPending}
              onClick={() =>
                setAiOpenRequest((value) => ({ stage: 'setup', token: (value?.token ?? 0) + 1 }))
              }
            >
              Claude 조건 도움 열기
            </button>
          )}
          <fieldset className="tt-workflow-input" disabled={!canEdit || batchPending}>
            <legend>새 조건 입력</legend>
            <label className="timetable-condition-search">
              조건 대상 검색
              <input
                type="search"
                aria-label="조건 대상 검색"
                value={conditionSearch}
                onChange={(event) => setConditionSearch(event.target.value)}
                placeholder="교사·학급 또는 수업 이름"
              />
              <small>
                검색 {matchingTargets.length}개
                {selectedTarget && !matchingTargets.includes(selectedTarget)
                  ? ' · 검색 밖의 선택 대상은 유지합니다.'
                  : ''}
              </small>
            </label>
            <div className="timetable-grid">
              <label>
                조건 종류
                <select
                  aria-label="조건 종류"
                  value={session.form.kind}
                  onChange={(event) => {
                    changeForm({
                      kind: event.target.value as ConditionForm['kind'],
                      targetId: '',
                      slotId: '',
                    })
                    setConditionSearch('')
                  }}
                >
                  {Object.entries(conditionLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'}
                <select
                  aria-label={session.form.kind === 'unavailable' ? '조건 대상' : '조건 수업'}
                  value={session.form.targetId}
                  onChange={(event) => changeForm({ targetId: event.target.value, slotId: '' })}
                >
                  <option value="">선택해 주세요</option>
                  {shownTargets.map((row) => (
                    <option key={row.id} value={row.id}>
                      {targetLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                조건 시간
                <select
                  aria-label="조건 시간"
                  disabled={!session.form.targetId}
                  value={session.form.slotId}
                  onChange={(event) => changeForm({ slotId: event.target.value })}
                >
                  <option value="">선택해 주세요</option>
                  {basis.slots
                    .filter(
                      (slot) =>
                        session.form.kind === 'unavailable' ||
                        basis.lessons
                          .find((row) => row.id === session.form.targetId)
                          ?.allowedSlotIds.includes(slot.id),
                    )
                    .map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slotLabel(basis, slot.id)}
                      </option>
                    ))}
                </select>
              </label>
              {session.form.kind === 'preferences' && (
                <label>
                  피하고 싶은 정도
                  <input
                    aria-label="피하고 싶은 정도"
                    type="number"
                    min="1"
                    max={timetablePolicy.maxWeight}
                    step="1"
                    value={session.form.weight}
                    onChange={(event) => changeForm({ weight: event.target.value })}
                  />
                </label>
              )}
            </div>
            <section
              className="timetable-condition-preview"
              aria-live="polite"
              aria-label="추가할 조건 확인"
            >
              <p>
                {selectedTarget ? (
                  <>
                    {conditionLabels[session.form.kind]} · {targetLabel(selectedTarget)}
                    {selectedConditionTime
                      ? ` · ${selectedConditionTime}`
                      : ' · 시간을 선택해 주세요.'}
                  </>
                ) : (
                  '대상을 먼저 선택한 뒤 시간을 지정해 주세요.'
                )}
              </p>
              {singleConditionPending && (
                <p className="timetable-muted">아직 조건 목록에 추가하지 않았습니다.</p>
              )}
            </section>
            <button
              type="button"
              disabled={!session.form.targetId || !session.form.slotId}
              onClick={addCondition}
            >
              조건 추가
            </button>
          </fieldset>
          <ComposerOptions className="tt-workflow-help" summary="필수·선호 조건은 어떻게 다른가요?">
            <p>
              필수 조건은 지키지 못하면 배치할 수 없습니다. 선호 조건은 지킬 수 없더라도 필수 조건을
              어기지 않습니다.
            </p>
            <p>
              선호의 숫자가 클수록 해당 시간대를 더 피하려고 합니다. 이번 계산은 가능한 배치를 우선
              찾으며 최적 점수를 보장하지 않습니다.
            </p>
          </ComposerOptions>
          <ConditionBatchPanel
            basis={basis}
            conditions={session.conditions}
            state={session.conditionBatch ?? initialConditionBatch()}
            disabled={!canEdit || singleConditionPending}
            onStateChange={changeBatch}
            onApply={(conditions, sourceKey) => changeConditions(conditions, false, sourceKey)}
          />
          <div className="tt-workflow-section">
            <h3>등록한 조건</h3>
            <p className="timetable-muted">학교 확정 조건과 이번 초안의 조건을 함께 확인합니다.</p>
            <ConditionCards
              basis={basis}
              conditions={session.conditions}
              disabled={!canEdit || batchPending}
              onRemove={removeCondition}
            />
          </div>
          <div className="timetable-actions">
            <button
              type="button"
              className="secondary"
              disabled={locked}
              onClick={() => navigateStep('basis')}
            >
              기초 자료 다시 확인
            </button>
            <button
              type="button"
              disabled={!canEdit || !inputCheck?.valid}
              onClick={() => navigateStep('compose')}
            >
              배치 만들기로 이동
            </button>
          </div>
        </section>
      )}
    </>
  )
}
