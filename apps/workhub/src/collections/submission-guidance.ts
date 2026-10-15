import type { AnswerInput, CollectionDraft } from '../workflows/types'
import type { FileReference } from '../files/contracts'

export interface CollectionSubmissionGuidanceInput {
  input: AnswerInput
  saved: CollectionDraft | null
  requiredFiles: boolean
  textLabel: string
  textRequired: boolean
  numberLabel: string
  numberRequired: boolean
  responsible: boolean
  hadSubmission: boolean
  reason: string
  needsSupplement: boolean
  correctionRequestId: string
  pendingFile: boolean
}

export interface CollectionSubmissionGuidance {
  canSubmit: boolean
  savedCurrent: boolean
  reasons: string[]
  stage: 'write' | 'save' | 'submit'
  message: string
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const filesValid = (value: unknown): value is FileReference[] | undefined => value === undefined || (Array.isArray(value) && value.every(file => file && typeof file === 'object' && typeof file.id === 'string' && Boolean(file.id) && typeof file.name === 'string' && Boolean(file.name) && typeof file.extension === 'string' && Boolean(file.extension) && typeof file.bytes === 'number' && Number.isFinite(file.bytes) && file.bytes > 0 && typeof file.sha256 === 'string' && Boolean(file.sha256)))
const answerValid = (input: AnswerInput | null | undefined) => Boolean(input && typeof input.text === 'string' && (input.number === null || (typeof input.number === 'number' && Number.isFinite(input.number))) && filesValid(input.files))

// 표시와 버튼 안내용이다. 권한·기한·파일 상태·최신 버전의 최종 판정은 서버가 수행한다.
export function collectionSubmissionGuidance(options: CollectionSubmissionGuidanceInput): CollectionSubmissionGuidance {
  const { input, saved } = options
  // 공백과 파일 순서를 유지한다. 초안과 다른 내용을 제출한 것처럼 안내하지 않는다.
  const savedCurrent = Boolean(answerValid(input) && answerValid(saved) && input.text === saved!.text && input.number === saved!.number && JSON.stringify(input.files ?? []) === JSON.stringify(saved!.files ?? []))
  const writing: string[] = []
  if (options.pendingFile) writing.push('파일 처리가 끝난 뒤 초안을 저장해 주세요.')
  if (!input || typeof input.text !== 'string') writing.push('글 응답을 확인해 주세요.')
  else if (options.textRequired && !clean(input.text)) writing.push(`${clean(options.textLabel) || '필수 글 응답'} 항목을 입력해 주세요.`)
  if (!input || (input.number !== null && (typeof input.number !== 'number' || !Number.isFinite(input.number)))) writing.push(`${clean(options.numberLabel) || '숫자 응답'} 항목에 올바른 숫자를 입력해 주세요.`)
  else if (options.numberRequired && input.number === null) writing.push(`${clean(options.numberLabel) || '필수 숫자 응답'} 항목을 입력해 주세요. 0도 응답값입니다.`)
  if (!filesValid(input?.files)) writing.push('첨부 파일 정보를 다시 확인해 주세요.')
  else if (options.requiredFiles && !input?.files?.length) writing.push('제출할 HWPX 파일을 첨부해 주세요.')
  const reasons = [...writing]
  if (!savedCurrent) reasons.push(saved ? '변경한 내용을 초안에 저장해 주세요.' : '작성한 내용을 먼저 초안에 저장해 주세요.')
  if (!options.responsible) reasons.push('공동 작성자는 초안까지 저장할 수 있습니다. 최종 제출은 책임 교사가 진행해 주세요.')
  if (options.hadSubmission && !clean(options.reason)) reasons.push('재제출 사유를 입력해 주세요.')
  if (options.needsSupplement && !clean(options.correctionRequestId)) reasons.push('응답할 보완 요청을 선택해 주세요.')
  const stage = writing.length ? 'write' : savedCurrent ? 'submit' : 'save'
  return {
    canSubmit: reasons.length === 0,
    savedCurrent,
    reasons,
    stage,
    message: reasons[0] ?? (options.hadSubmission ? '저장한 초안을 다시 제출할 준비가 되었습니다.' : '저장한 초안을 최종 제출할 준비가 되었습니다.'),
  }
}
