import type { AnswerInput, CollectionInput } from '../workflows/types'
import { isCollectionUnitInputs } from './unit-inputs'

export type ComparisonChoice = 'latest' | 'mine'
export type ComparisonState = 'unchanged' | 'latest' | 'mine' | 'same' | 'conflict'
export interface ComparisonField<T> { key: keyof T; label: string; base: T[keyof T]; latest: T[keyof T]; mine: T[keyof T]; state: ComparisonState }
export type ComparisonChoices<T> = Partial<Record<keyof T, ComparisonChoice>>

// 키를 추가하면 비교 목록도 함께 보완해야 컴파일된다. 배열은 구성원 한 명 교체도 변경으로 본다.
export const collectionComparisonLabels = {
  title: '수합 제목', instructions: '안내 내용', dueDate: '제출 기한',
  reviewMode: '제출 후 검토 방식', reviewerMemberId: '검토 교사',
  textLabel: '추가 답변 항목 이름', textRequired: '추가 답변 필수 여부',
  numberLabel: '숫자 답변 항목 이름', numberRequired: '숫자 답변 필수 여부',
  units: '제출 단위와 교사', fileCollection: '파일 수합 설정과 양식',
} satisfies Record<keyof CollectionInput, string>
export const answerComparisonLabels = { text: '추가 답변', number: '숫자 답변', files: '제출 파일' } satisfies Record<keyof AnswerInput, string>

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(item => typeof item === 'string')
const files = (value: unknown) => Array.isArray(value) && Array.from(value).every(file => record(file) && typeof file.id === 'string' && typeof file.name === 'string' && typeof file.extension === 'string' && finite(file.bytes) && typeof file.sha256 === 'string')

/** 손상된 보관 입력을 빈 값으로 바꿔서 병합하지 않는다. 업무 유효성은 기존 저장 검사가 맡는다. */
export function isCollectionComparisonInput(value: unknown): value is CollectionInput {
  if (!record(value)) return false
  if (!['title', 'instructions', 'dueDate', 'reviewerMemberId', 'textLabel', 'numberLabel'].every(key => typeof value[key] === 'string')
    || !['none', 'required'].includes(value.reviewMode as string) || typeof value.textRequired !== 'boolean' || typeof value.numberRequired !== 'boolean' || !isCollectionUnitInputs(value.units)) return false
  const file = value.fileCollection
  return file === undefined || (record(file) && typeof file.required === 'boolean' && files(file.templates) && record(file.policy)
    && strings(file.policy.extensions) && finite(file.policy.maxFileBytes) && finite(file.policy.maxFiles))
}
export function isAnswerComparisonInput(value: unknown): value is AnswerInput {
  return record(value) && typeof value.text === 'string' && (value.number === null || finite(value.number)) && (value.files === undefined || files(value.files))
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index]))
  if (!record(a) || !record(b)) return false
  const left = Object.keys(a).filter(key => a[key] !== undefined), right = Object.keys(b).filter(key => b[key] !== undefined)
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
}
function compare<T>(base: T, latest: T, mine: T, labels: Record<keyof T, string>): ComparisonField<T>[] {
  return (Object.keys(labels) as (keyof T)[]).map(key => {
    const serverChanged = !equal(base[key], latest[key]), mineChanged = !equal(base[key], mine[key])
    const state: ComparisonState = !serverChanged && !mineChanged ? 'unchanged' : !mineChanged ? 'latest' : !serverChanged ? 'mine' : equal(latest[key], mine[key]) ? 'same' : 'conflict'
    return { key, label: labels[key], base: base[key], latest: latest[key], mine: mine[key], state }
  })
}
function resolve<T>(fields: ComparisonField<T>[], choices: ComparisonChoices<T>): T | null {
  const output: Partial<T> = {}
  for (const field of fields) {
    const choice = field.state === 'conflict' ? choices[field.key] : field.state === 'mine' ? 'mine' : 'latest'
    if (choice !== 'latest' && choice !== 'mine') return null
    // 원본과 참조를 공유하지 않아 비교 뒤 편집이 다른 버전을 바꾸지 않게 한다.
    output[field.key] = structuredClone(choice === 'mine' ? field.mine : field.latest)
  }
  return output as T
}

export function compareCollectionInputs(base: CollectionInput, latest: CollectionInput, mine: CollectionInput) {
  if (![base, latest, mine].every(isCollectionComparisonInput)) throw new Error('비교할 수합 입력을 확인하지 못했습니다.')
  return compare(base, latest, mine, collectionComparisonLabels)
}
export function resolveCollectionInputs(base: CollectionInput, latest: CollectionInput, mine: CollectionInput, choices: ComparisonChoices<CollectionInput> = {}) {
  return resolve(compareCollectionInputs(base, latest, mine), choices)
}
const answerValues = (input: AnswerInput): AnswerInput => ({ text: input.text, number: input.number, files: input.files ?? [] })
export function compareAnswerInputs(base: AnswerInput, latest: AnswerInput, mine: AnswerInput) {
  if (![base, latest, mine].every(isAnswerComparisonInput)) throw new Error('비교할 제출 입력을 확인하지 못했습니다.')
  return compare(answerValues(base), answerValues(latest), answerValues(mine), answerComparisonLabels)
}
export function resolveAnswerInputs(base: AnswerInput, latest: AnswerInput, mine: AnswerInput, choices: ComparisonChoices<AnswerInput> = {}) {
  return resolve(compareAnswerInputs(base, latest, mine), choices)
}
