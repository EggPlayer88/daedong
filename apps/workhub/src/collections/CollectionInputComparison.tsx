import { useId, useState, type ReactNode } from 'react'
import type { Membership } from '../contracts'
import type { FileReference } from '../files/contracts'
import { formatFileBytes } from '../files/FileControls'
import type { AnswerInput, CollectionInput, UnitInput } from '../workflows/types'
import { collectionUnitMemberOptions } from './unit-inputs'
import { compareAnswerInputs, compareCollectionInputs, isAnswerComparisonInput, isCollectionComparisonInput, resolveAnswerInputs, resolveCollectionInputs, type ComparisonChoices, type ComparisonField, type ComparisonState } from './conflict-comparison'
import styles from './collection-comparison.css?inline'

export interface CollectionInputComparisonProps {
  base: CollectionInput; latest: CollectionInput; mine: CollectionInput; members: Membership[]; disabled?: boolean; onResolve: (input: CollectionInput) => void
}
export interface AnswerInputComparisonProps {
  base: AnswerInput; latest: AnswerInput; mine: AnswerInput; labels?: { text?: string; number?: string }; disabled?: boolean; onResolve: (input: AnswerInput) => void
}
const reasons: Record<ComparisonState, string> = {
  unchanged: '양쪽 모두 바꾸지 않은 항목입니다. 현재 서버 내용을 유지합니다.',
  latest: '내가 바꾸지 않은 항목입니다. 다른 사람이 바꾼 현재 서버 내용을 유지합니다.',
  mine: '나만 바꾼 항목입니다. 내 입력을 반영합니다.',
  same: '양쪽이 같은 내용으로 바꿨습니다. 동일한 내용을 유지합니다.',
  conflict: '양쪽에서 서로 다르게 바꿨습니다. 사용할 내용을 직접 선택해 주세요.',
}
const textValue = (value: string) => <p className="csc-value">{value || '미입력'}</p>
function FileValues({ files }: { files: FileReference[] }) {
  return files.length ? <ul className="csc-files">{files.map((file, index) => <li key={index}><strong>{file.name}</strong><p>{file.extension.toUpperCase()} · {formatFileBytes(file.bytes)} ({file.bytes.toLocaleString('ko-KR')}바이트)</p>
    <details><summary>파일 식별 정보</summary><dl><dt>파일 번호</dt><dd>{file.id}</dd><dt>내용 확인값</dt><dd>{file.sha256}</dd></dl></details>
  </li>)}</ul> : <p>파일 없음</p>
}
function UnitValues({ units, memberName }: { units: UnitInput[]; memberName: (id: string) => string }) {
  return units.length ? <ol className="csc-units">{units.map((unit, index) => <li key={index}><strong>{unit.label || '이름 미입력'}</strong><p>책임 교사: {memberName(unit.responsibleMemberId)}</p><p>공동 작성자: {unit.contributorMemberIds.length ? unit.contributorMemberIds.map(memberName).join(', ') : '없음'}</p></li>)}</ol> : <p>제출 단위 없음</p>
}
function collectionValue(key: keyof CollectionInput, value: CollectionInput[keyof CollectionInput], memberName: (id: string) => string): ReactNode {
  switch (key) {
    case 'units': return <UnitValues units={value as UnitInput[]} memberName={memberName} />
    case 'fileCollection': {
      const file = value as CollectionInput['fileCollection']
      if (!file) return <p>파일 수합 사용 안 함</p>
      return <><dl><dt>파일 첨부</dt><dd>{file.required ? '필수' : '선택'}</dd><dt>허용 형식</dt><dd>{file.policy.extensions.map(extension => extension.toUpperCase()).join(', ') || '없음'}</dd><dt>파일당 최대 크기</dt><dd>{formatFileBytes(file.policy.maxFileBytes)} ({file.policy.maxFileBytes.toLocaleString('ko-KR')}바이트)</dd><dt>최대 파일 수</dt><dd>{file.policy.maxFiles}개</dd></dl><h5>양식 파일</h5><FileValues files={file.templates} /></>
    }
    case 'reviewMode': return <p>{value === 'required' ? '검토 필요' : '검토 없이 제출 완료'}</p>
    case 'reviewerMemberId': return <p>{value ? memberName(value as string) : '검토 교사 없음'}</p>
    case 'textRequired': case 'numberRequired': return <p>{value ? '필수' : '선택'}</p>
    default: return textValue(value as string)
  }
}
function Comparison<T>({ fields, disabled = false, onResolve, resolve, renderValue }: {
  fields: ComparisonField<T>[]; disabled?: boolean; onResolve: (input: T) => void; resolve: (choices: ComparisonChoices<T>) => T | null; renderValue: (key: keyof T, value: T[keyof T]) => ReactNode
}) {
  const id = useId(), [choices, setChoices] = useState<ComparisonChoices<T>>({})
  const conflicts = fields.filter(field => field.state === 'conflict'), unresolved = conflicts.filter(field => !choices[field.key]).length
  const changed = fields.filter(field => field.state !== 'unchanged'), unchanged = fields.filter(field => field.state === 'unchanged')
  const group = (field: ComparisonField<T>) => <fieldset className="csc-field" key={String(field.key)} disabled={disabled} aria-describedby={id + '-' + String(field.key) + '-reason'}>
    <legend>{field.label}</legend><p id={id + '-' + String(field.key) + '-reason'} className="csc-reason">{reasons[field.state]}</p>
    <div className="csc-values"><div><h5>현재 서버</h5>{renderValue(field.key, field.latest)}</div><div><h5>내 입력</h5>{renderValue(field.key, field.mine)}</div></div>
    <details className="csc-base"><summary>비교 기준 원본</summary>{renderValue(field.key, field.base)}</details>
    {field.state === 'conflict' && <div className="csc-choices">
      <label><input type="radio" name={id + '-' + String(field.key)} aria-label={field.label + ' · 현재 서버 내용 사용'} checked={choices[field.key] === 'latest'} onChange={() => setChoices(previous => ({ ...previous, [field.key]: 'latest' }))} />현재 서버 내용 사용</label>
      <label><input type="radio" name={id + '-' + String(field.key)} aria-label={field.label + ' · 내 입력 사용'} checked={choices[field.key] === 'mine'} onChange={() => setChoices(previous => ({ ...previous, [field.key]: 'mine' }))} />내 입력 사용</label>
    </div>}
  </fieldset>
  return <div className="csc-comparison"><style>{styles}</style><p>편집 시작 또는 마지막 저장 접수 시점의 원본을 기준으로 비교했습니다. 내가 바꾸지 않은 항목은 현재 서버 내용을 유지합니다. 제출 단위와 파일 목록은 묶음 전체를 비교합니다.</p>
    <div role="status" aria-live="polite">{unresolved ? '서로 다르게 바뀐 항목 ' + unresolved + '개를 선택해 주세요.' : conflicts.length ? '서로 다르게 바뀐 항목을 모두 선택했습니다.' : '서로 다르게 바뀐 항목이 없어 자동으로 반영할 수 있습니다.'}</div>
    {changed.length > 0 ? changed.map(group) : <p>입력 내용은 달라지지 않았습니다. 최신 버전을 기준으로 편집을 계속할 수 있습니다.</p>}
    {unchanged.length > 0 && <details className="csc-unchanged"><summary>변경되지 않은 항목 {unchanged.length}개 보기</summary>{unchanged.map(group)}</details>}
    <button type="button" className="cs-primary" disabled={disabled || unresolved > 0} onClick={() => {
      if (disabled || unresolved > 0) return
      const input = resolve(choices)
      if (input) onResolve(input)
    }}>비교한 내용으로 편집 계속</button>
    <p className="csc-footnote">아직 저장하지 않습니다. 편집 화면에서 확인한 뒤 저장하면 서버가 최신 버전을 다시 확인합니다.</p>
  </div>
}
function InvalidComparison() { return <p role="alert">비교할 입력 형식을 확인하지 못했습니다. 입력을 자동으로 바꾸지 않았습니다. 최신 원본을 다시 확인해 주세요.</p> }

export function CollectionInputComparison({ base, latest, mine, members, disabled, onResolve }: CollectionInputComparisonProps) {
  if (![base, latest, mine].every(isCollectionComparisonInput)) return <InvalidComparison />
  const options = collectionUnitMemberOptions(members)
  const memberName = (memberId: string) => memberId ? options.find(member => member.id === memberId)?.label ?? '현재 명부에 없는 교사 · ' + memberId : '선택 안 함'
  // 비교할 값이 바뀌면 이전 원본에 대한 선택을 이어 쓰지 않는다.
  return <Comparison key={JSON.stringify([base, latest, mine])} fields={compareCollectionInputs(base, latest, mine)} disabled={disabled} onResolve={onResolve}
    resolve={choices => resolveCollectionInputs(base, latest, mine, choices)} renderValue={(key, value) => collectionValue(key, value, memberName)} />
}
export function AnswerInputComparison({ base, latest, mine, labels, disabled, onResolve }: AnswerInputComparisonProps) {
  if (![base, latest, mine].every(isAnswerComparisonInput)) return <InvalidComparison />
  const fields = compareAnswerInputs(base, latest, mine).map(field => ({ ...field, label: field.key === 'text' ? labels?.text || field.label : field.key === 'number' ? labels?.number || field.label : field.label }))
  return <Comparison key={JSON.stringify([base, latest, mine])} fields={fields} disabled={disabled} onResolve={onResolve}
    resolve={choices => resolveAnswerInputs(base, latest, mine, choices)} renderValue={(key, value) => key === 'files' ? <FileValues files={(value as FileReference[] | undefined) ?? []} /> : key === 'number' ? <p>{value === null ? '미입력' : String(value)}</p> : textValue(value as string)} />
}
