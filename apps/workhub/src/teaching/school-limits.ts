import schoolLimits from '../setup/assets/school-admin.json'

// 학교 설정이 허용한 특수·기타 학교의 단계도 같은 명부 계약으로 읽는다.
// 실제 학교의 gradeCount와 학기별 학년 적합성은 서버가 다시 확인한다.
export const studentGradeLimit=Math.max(schoolLimits.customGradeTechnicalLimit,...Object.values(schoolLimits.gradeBounds))
