interface Props {
  revision: number
  conditionCount: number
  conditionPending: boolean
  stale: boolean
  checkingRequired: boolean
  hasPlacements: boolean
  valid: boolean
  missingCount?: number
  dirty: boolean
  practice: boolean
  pending: boolean
}

// 화면 이동이나 조건 입력만으로 서버 저장·공개가 끝났다고 표시하지 않는다.
export function TimetableEditorProgress(props: Props) {
  const placement = props.stale || props.checkingRequired ? '다시 검사 필요'
    : !props.hasPlacements ? '아직 배치 전'
    : props.conditionPending ? '입력 조건 반영 전'
    : props.valid ? '필수 조건 통과'
    : props.missingCount ? `미배정 ${props.missingCount}개` : '충돌 확인 필요'
  const saved = props.pending ? '결과 확인 필요'
    : props.practice ? '연습 · 저장 안 함'
    : props.dirty ? '저장 전 변경 있음'
    : props.hasPlacements ? '서버 초안 확인됨' : '아직 저장 전'
  return <section className="timetable-editor-progress" aria-label="현재 편성 상태">
    <dl>
      <div><dt>기초 자료</dt><dd>{props.revision}판{props.stale ? ' · 입력 기준 변경됨' : ''}</dd></div>
      <div><dt>반영한 조건</dt><dd>{props.conditionCount}개{props.conditionPending ? ' · 입력 중' : ''}</dd></div>
      <div><dt>배치 검사</dt><dd>{placement}</dd></div>
      <div><dt>서버 저장</dt><dd>{saved}</dd></div>
    </dl>
    <p>단계를 옮겨도 작성 중인 입력은 현재 탭에 유지됩니다. 초안 저장 후 확정·공유를 별도로 진행합니다.</p>
  </section>
}
