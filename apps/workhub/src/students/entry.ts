// 기존 관찰 저장 계약의 입력 한도를 화면 안내에도 동일하게 사용한다.
export const observationLimits = { activity: 150, content: 4000, reason: 300 }
export interface ObservationInput { activity: string; content: string; reason: string; confirmed: boolean }
export interface EntryIssue { field: 'target' | 'activity' | 'content' | 'reason' | 'confirmed'; message: string }
export function observationInputIssues(input: ObservationInput, targetValid: boolean, editing = false): EntryIssue[] {
  const issues: EntryIssue[] = []
  if (!targetValid) issues.push({ field: 'target', message: '해당 날짜의 승인된 수업과 학생을 다시 확인해 주세요. 다른 학생으로 자동 변경하지 않습니다.' })
  for (const [field, label] of [['activity', '활동'], ['content', '직접 확인한 사실'], ...(editing ? [['reason', '정정 사유']] : [])] as ['activity' | 'content' | 'reason', string][]) {
    if (typeof input[field] !== 'string' || !input[field].trim()) issues.push({ field, message: `${label}${field === 'reason' ? '를' : '을'} 입력해 주세요. 공백만으로는 저장할 수 없습니다.` })
    else if (input[field].length > observationLimits[field]) issues.push({ field, message: `${label}${field === 'reason' ? '는' : '은'} ${observationLimits[field]}자 이내로 작성해 주세요.` })
  }
  if (input.confirmed !== true) issues.push({ field: 'confirmed', message: '학생과 작성한 사실을 직접 확인한 뒤 확인란을 선택해 주세요.' })
  return issues
}
export function activityInputIssues(content: string, confirmed: boolean, targetValid: boolean): EntryIssue[] {
  return observationInputIssues({ activity: '수업 활동', content, reason: '', confirmed }, targetValid)
}
