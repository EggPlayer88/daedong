import limits from './limits.json'
import type { useTimetableDesigner } from './useTimetableDesigner'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function TimetablePublishStep({
  model,
}: {
  model: Pick<
    ReturnType<typeof useTimetableDesigner>,
    | 'basis'
    | 'canEdit'
    | 'candidateCheck'
    | 'conditionPending'
    | 'current'
    | 'locked'
    | 'navigateStep'
    | 'practice'
    | 'revision'
    | 'save'
    | 'session'
    | 'step'
    | 'stepHeading'
    | 'update'
  >
}) {
  const {
    basis,
    canEdit,
    candidateCheck,
    conditionPending,
    current,
    locked,
    navigateStep,
    practice,
    revision,
    save,
    session,
    step,
    stepHeading,
    update,
  } = model
  if (!basis || !session || !current) return null
  return (
    <>
      {step === 'publish' && (
        <section className="timetable-card">
          <h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">
            4. 초안 저장과 공개 검토
          </h2>
          <p>저장한 초안은 담당자의 작업 자료입니다. 확정된 시간표로 자동 공개하지 않습니다.</p>
          <div className="tt-workflow-save">
            <label>
              초안 이름
              <input
                aria-label="초안 이름"
                value={session.title}
                disabled={!canEdit}
                maxLength={limits.title}
                onChange={(event) => {
                  if (session) update({ ...session, title: event.target.value, dirty: true })
                }}
              />
            </label>
            {candidateCheck?.valid && !session.conditionsChanged ? (
              <p className="timetable-notice">
                기초 자료 {basis.revision}판 · {session.placements?.length}개 수업 · 필수 조건 검사
                통과
              </p>
            ) : (
              <p className="timetable-error">
                {session.conditionsChanged
                  ? '보관한 배치를 새 조건으로 다시 검사해 주세요.'
                  : '필수 조건을 통과한 배치를 먼저 만들어 주세요.'}
              </p>
            )}
            <div className="timetable-actions">
              {!practice && (
                <button
                  type="button"
                  disabled={
                    !canEdit ||
                    !session.dirty ||
                    session.conditionsChanged ||
                    conditionPending ||
                    !current.canSave ||
                    !candidateCheck?.valid ||
                    !session.title.trim()
                  }
                  onClick={() => void save()}
                >
                  새 초안으로 서버에 저장
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => navigateStep('compose')}
              >
                배치 다시 살펴보기
              </button>
            </div>
          </div>
          {practice && (
            <p className="timetable-muted">연습 자료는 학교 서버에 저장하지 않습니다.</p>
          )}
          <div className="timetable-empty">
            <h3>저장 후 확정·공유·교환으로 이동</h3>
            <p>
              초안을 저장하고 상단의 시간표 보기 화면에서 적용 기간과 변경 영향을 검토한 뒤
              확정하세요. 실제 서버 준비 상태는 그 화면에서 확인합니다. 이번 초안 저장은 학생
              기록이나 기존 시간표를 바꾸지 않습니다.
            </p>
          </div>
        </section>
      )}
    </>
  )
}
