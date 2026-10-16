import { isSetupDate } from './contract'

// 새 학년도 입력에만 적용한다. 기존 기록을 바꾸거나 특정 시작 월·일을 강제하지 않는다.
export const ACADEMIC_YEAR_START_MESSAGE = '학년도 숫자와 학년도 시작일의 연도가 같아야 합니다.'
export function academicYearStartMatches(year: number, startsOn: string): boolean {
  return Number.isSafeInteger(year) && isSetupDate(startsOn) && year === Number(startsOn.slice(0, 4))
}
