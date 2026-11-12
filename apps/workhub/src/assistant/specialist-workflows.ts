import type { PageId } from '../modules'

// 대화는 작업의 입구만 고른다. 실제 대상·판·권한·승인은 각 업무의 현재 서버 응답으로 확인한다.
export const specialistWorkflows = {
  timetableView: { page: 'timetable', title: '날짜별 시간표', aliases: ['날짜별 시간표', '오늘 시간표'], steps: ['날짜와 교사·학급 선택', '확정 수업과 변경 이력 확인', '필요한 수업 선택'] },
  timetableExchange: { page: 'timetable', title: '교환 요청·승인', aliases: ['시간표 교환', '시간표 교환 요청', '수업 교환', '시간표 교환 승인'], steps: ['대상 수업과 요청 선택', '영향·당사자 동의 확인', '권한에 맞는 요청·승인'] },
  timetableSubstitute: { page: 'timetable', title: '대강 요청', aliases: ['대강 요청', '수업 대강'], steps: ['대상 수업과 담당 교사 선택', '겹치는 수업·영향 확인', '당사자 동의와 별도 승인'] },
  timetablePublish: { page: 'timetable', title: '시간표 확정·공개', aliases: ['시간표 확정', '시간표 공개'], steps: ['편성안과 적용 기간 선택', '변경되는 수업·충돌 비교', '검토한 판으로 공개 확인'] },
  timetablePrepare: { page: 'timetable', title: '시간표 편성 준비', aliases: ['시간표 준비', '시간표 편성 준비'], steps: ['대상 학기 선택', '공간·학급·수업·시수 점검', '기준판 확인'] },
  teachingRecords: { page: 'students', title: '수업·학생 기록', aliases: ['수업 기록', '관찰 기록', '학생 기록 작성'], steps: ['담당 수업·학생 직접 선택', '원문 근거와 기록 시점 확인', '기록 저장 또는 AI 초안 검토'] },
  teachingAssessment: { page: 'students', title: '평가 기록', aliases: ['평가 기록', '수업 평가'], steps: ['수업·학생 선택', '평가 기준판과 근거 확인', '평가 기록 검토·저장'] },
  teachingActivity: { page: 'students', title: '활동 자료·CSV', aliases: ['활동 자료', '활동 CSV', '활동 자료 가져오기'], steps: ['수업과 원본 파일 선택', '학생 연결·자료 오류 비교', '확인한 자료 반영'] },
  schoolSettings: { page: 'schoolAdmin', title: '학교 기초 자료', aliases: ['학교 기초 자료', '학급 관리', '교과 관리', '학년도 관리'], steps: ['현재 학년도와 원본 조회', '바꿀 항목·기간 선택', '변경 비교 후 저장'] },
  schoolRoster: { page: 'schoolAdmin', title: '교사 명부·배정', aliases: ['교사 명부', '가입 전 교사 명부', '담임 배정'], steps: ['교사·학급 명부 확인', '대상과 배정 기간 선택', '변경 검토·저장'] },
  schoolMembership: { page: 'schoolAdmin', title: '교사 소속 연결', aliases: ['교사 소속', '교사 소속 연결'], steps: ['허용된 연결 후보 조회', '계정과 명부 직접 대조', '기존 권한 안에서 연결 확인'] },
  schoolTransition: { page: 'schoolAdmin', title: '업무 인계·학년도 전환', aliases: ['업무 인계', '공식 담당 인계', '학년도 전환'], steps: ['원본과 인계할 범위 선택', '받는 사람·영향 미리보기', '필요한 확인·수락 진행'] },
} as const satisfies Record<string, { page: PageId; title: string; aliases: readonly string[]; steps: readonly string[] }>
export type SpecialistTask = keyof typeof specialistWorkflows
export type SpecialistPage = typeof specialistWorkflows[SpecialistTask]['page']
export type SpecialistCommand = { kind: 'specialist'; task: SpecialistTask }
export function specialistWorkflow(task: unknown) {
  return typeof task === 'string' && Object.hasOwn(specialistWorkflows, task) ? specialistWorkflows[task as SpecialistTask] : undefined
}
export function specialistStarters(profile: string): readonly string[] | undefined {
  if (profile === 'timetable') return ['날짜별 시간표 보여줘', '시간표 교환 요청 준비해줘', '시간표 확정 검토 열어줘']
  if (profile === 'teaching') return ['수업 기록 준비해줘', '평가 기록 보여줘', '활동 자료 가져오기 시작해줘']
  if (profile === 'administration') return ['학교 기초 자료 보여줘', '교사 명부 보여줘', '업무 인계 준비해줘']
  return undefined
}

// 부정·인용·복합 명령은 상위 분류기에서 먼저 제외한다. 모호한 설명을 부분 일치로 실행하지 않는다.
export function parseSpecialistCommand(text: string): SpecialistCommand | null {
  const ending = '(?:열어|보여|준비해|시작해)\\s*(?:줘|주세요|줄래|줄래요|주실래요|주시겠어요|주십시오)'
  for (const [task, workflow] of Object.entries(specialistWorkflows)) {
    for (const alias of workflow.aliases) {
      const label = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')
      if (new RegExp(`^${label}(?:\\s*(?:화면|검토))?\\s*(?:을|를)?\\s*${ending}$`, 'i').test(text))
        return { kind: 'specialist', task: task as SpecialistTask }
    }
  }
  return null
}
