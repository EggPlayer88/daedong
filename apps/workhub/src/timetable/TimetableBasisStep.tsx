import { FoundationPanel } from './FoundationPanel'
import type { useTimetableDesigner } from './useTimetableDesigner'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function TimetableBasisStep({
  model,
}: {
  model: Pick<
    ReturnType<typeof useTimetableDesigner>,
    | 'basis'
    | 'effective'
    | 'filter'
    | 'locked'
    | 'navLocked'
    | 'navigateStep'
    | 'onOpenSchoolAdmin'
    | 'practice'
    | 'revision'
    | 'stale'
    | 'step'
    | 'stepHeading'
    | 'session'
    | 'current'
  >
}) {
  const {
    basis,
    effective,
    filter,
    locked,
    navLocked,
    navigateStep,
    onOpenSchoolAdmin,
    practice,
    revision,
    stale,
    step,
    stepHeading,
    session,
    current,
  } = model
  if (!basis || !session || !current) return null
  return (
    <>
      {step === 'basis' && (
        <section className="timetable-card">
          <h2 ref={stepHeading} tabIndex={-1} className="timetable-editor-heading">
            1. 기초 자료 확인
          </h2>
          <p>
            교사·학급·시수는 학교가 확정한 자료를 사용합니다. 시간표 담당자는 이 화면에서 원래
            배정을 바꾸지 않습니다.
          </p>
          <dl className="timetable-summary">
            <div>
              <dt>기준판</dt>
              <dd>{basis.revision}판</dd>
            </div>
            <div>
              <dt>편성할 수업</dt>
              <dd>{basis.lessons.length}개</dd>
            </div>
            <div>
              <dt>수업 시수</dt>
              <dd>{basis.courseLoads.reduce((n, row) => n + row.periods, 0)}차시</dd>
            </div>
            <div>
              <dt>교사 / 학급</dt>
              <dd>
                {basis.resources.filter((row) => row.kind === 'teacher').length} /{' '}
                {basis.resources.filter((row) => row.kind === 'class').length}
              </dd>
            </div>
          </dl>
          <p className="timetable-muted">
            수업별 허용 시간대와 실제 시각, 함께 참여하는 교사·학급·학생 집단·공간을 검사합니다.
          </p>
          <FoundationPanel basis={effective ?? basis} />
          <div className="timetable-actions">
            <button
              type="button"
              disabled={locked || stale}
              onClick={() => navigateStep('conditions')}
            >
              조건 정리로 이동
            </button>
            {onOpenSchoolAdmin && !practice && (
              <button
                type="button"
                className="secondary"
                disabled={navLocked}
                onClick={onOpenSchoolAdmin}
              >
                기초 자료 수정 요청하러 이동
              </button>
            )}
          </div>
        </section>
      )}
    </>
  )
}
