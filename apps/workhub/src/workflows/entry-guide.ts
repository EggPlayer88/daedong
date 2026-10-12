import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { AnswerInput, CollectionInput, CollectionRequest } from './types'

export interface EntryCheck { label: string; ready: boolean; detail: string }
// store.collectionInput의 기존 미리보기 입력 계약과 맞춘다. 학교별 정책 한도가 아니다.
export const collectionUnitLimit = 100
export interface CollectionEntryGuide {
  checks: EntryCheck[]; issues: string[]; warnings: string[]; unitCount: number; memberCount: number
  requiredQuestionCount: number; reviewerName: string; units: { label: string; responsible: string; contributors: string[] }[]
}
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const realDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

// 입력 중 안내만 만든다. 저장·게시 가능 여부는 기존 store가 최신 상태로 판정한다.
export function collectionEntryGuide(input: CollectionInput, members: Membership[], schoolId: string, date: string): CollectionEntryGuide {
  const options = Array.isArray(members) ? members.filter(member => member && member.schoolId === schoolId && activeAt(member, date)) : []
  const find = (id: string) => options.find(member => member.id === id)
  const rawUnits = Array.isArray(input?.units) ? input.units : []
  const issues: string[] = [], warnings: string[] = []
  const requiredQuestionCount = Number(Boolean(clean(input?.textLabel) && input?.textRequired)) + Number(Boolean(clean(input?.numberLabel) && input?.numberRequired))
  const hasTitle = Boolean(clean(input?.title)), hasDate = realDate(input?.dueDate)
  if (!hasTitle) issues.push('수합 제목을 입력해 주세요.')
  if (!hasDate) issues.push('올바른 마감일을 입력해 주세요.')
  else if (input.dueDate < date) warnings.push('마감일이 이미 지났습니다. 게시 후 첫 제출은 지연 제출로 표시됩니다.')
  const hasQuestion = Boolean(clean(input?.textLabel) || clean(input?.numberLabel))
  if (!hasQuestion) issues.push('글 또는 숫자 문항을 하나 이상 입력해 주세요.')
  if ((input?.textRequired && !clean(input?.textLabel)) || (input?.numberRequired && !clean(input?.numberLabel))) issues.push('필수 응답을 받을 문항의 이름을 입력해 주세요.')
  if (!rawUnits.length) issues.push('제출 단위를 하나 이상 정해 주세요.')
  if (rawUnits.length > collectionUnitLimit) issues.push(`한 요청에는 제출 단위를 최대 ${collectionUnitLimit}개까지 설정할 수 있습니다.`)
  const labels = new Set<string>(), participantIds = new Set<string>()
  const unitIssues: string[] = []
  const units = rawUnits.map((unit, index) => {
    const label = clean(unit?.label), responsible = find(unit?.responsibleMemberId)
    if (!label) unitIssues.push(`단위 ${index + 1} 이름을 입력해 주세요.`)
    else if (labels.has(label)) unitIssues.push(`제출 단위 이름 '${label}'이 중복되었습니다.`)
    labels.add(label)
    if (!responsible) unitIssues.push(`단위 ${index + 1}의 현재 학교 제출 책임자를 확인해 주세요.`)
    const contributorIds = Array.isArray(unit?.contributorMemberIds) ? [...new Set(unit.contributorMemberIds)] : []
    if (contributorIds.some(id => !find(id))) unitIssues.push(`단위 ${index + 1}의 공동 작성자 소속을 확인해 주세요.`)
    for (const id of [unit?.responsibleMemberId, ...contributorIds]) if (find(id)) participantIds.add(id)
    return { label: label || `단위 ${index + 1} (이름 미입력)`, responsible: responsible?.name ?? '책임자 확인 필요', contributors: contributorIds.filter(id => id !== unit?.responsibleMemberId).map(id => find(id)?.name ?? '소속 확인 필요') }
  })
  issues.push(...unitIssues)
  const reviewer = input?.reviewMode === 'required' ? find(input.reviewerMemberId) : undefined
  const ownReview = input?.reviewMode === 'required' && rawUnits.some(unit => unit?.responsibleMemberId === input.reviewerMemberId)
  const reviewReady = input?.reviewMode === 'none' || Boolean(reviewer && !ownReview)
  if (input?.reviewMode === 'required' && !reviewer) issues.push('현재 학교의 검토자를 지정해 주세요.')
  if (ownReview) issues.push('검토자가 제출 책임자와 겹칩니다. 다른 검토자 또는 책임자를 지정해 주세요.')
  return { issues, warnings, unitCount: rawUnits.length, memberCount: participantIds.size, requiredQuestionCount, reviewerName: reviewer?.name ?? '', units,
    checks: [
      { label: '안내와 마감', ready: hasTitle && hasDate, detail: hasDate ? `${input.dueDate}까지` : '제목과 마감일을 확인해 주세요' },
      { label: '응답 문항', ready: hasQuestion && !((input?.textRequired && !clean(input?.textLabel)) || (input?.numberRequired && !clean(input?.numberLabel))), detail: `필수 ${requiredQuestionCount}개 · ${requiredQuestionCount ? '필수 문항을 채워야 최종 제출할 수 있습니다' : '설정된 문항을 모두 선택 응답으로 받습니다'}` },
      { label: '제출 대상', ready: rawUnits.length > 0 && rawUnits.length <= collectionUnitLimit && unitIssues.length === 0, detail: `${rawUnits.length}부 · 작성 교사 ${participantIds.size}명` },
      { label: '완료 방식', ready: reviewReady, detail: input?.reviewMode === 'required' ? reviewer ? `${reviewer.name} 검토 후 완료` : '검토자 지정 필요' : '제출 즉시 완료 · 사람 검토 없음' },
    ],
  }
}

export function responseEntryGuide(request: Pick<CollectionRequest, 'textLabel' | 'textRequired' | 'numberLabel' | 'numberRequired'>, input: AnswerInput, resubmission: boolean, reason: string): EntryCheck[] {
  const checks: EntryCheck[] = []
  if (request.textLabel) checks.push({ label: request.textLabel, ready: !request.textRequired || Boolean(clean(input?.text)), detail: request.textRequired ? '필수 글 응답' : '선택 글 응답' })
  if (request.numberLabel) checks.push({ label: request.numberLabel, ready: input?.number === null ? !request.numberRequired : typeof input?.number === 'number' && Number.isFinite(input.number), detail: request.numberRequired ? '필수 숫자 응답 · 0도 입력값입니다' : '선택 숫자 응답' })
  if (resubmission) checks.push({ label: '정정·보완 사유', ready: Boolean(clean(reason)), detail: '새 버전을 제출할 때 필요합니다' })
  return checks
}
