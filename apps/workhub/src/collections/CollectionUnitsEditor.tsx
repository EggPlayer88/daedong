import { useId, useState } from 'react'
import type { Membership } from '../contracts'
import { collectionUnitLimit } from '../workflows/entry-guide'
import type { UnitInput } from '../workflows/types'
import { appendPersonalCollectionUnit, appendSharedCollectionUnit, collectionUnitMemberOptions, isCollectionUnitInputs, validateCollectionUnitInputs } from './unit-inputs'
import styles from './collection-units.css?inline'

export interface CollectionUnitsEditorProps {
  units: UnitInput[]; members: Membership[]; reviewerMemberId?: string; disabled?: boolean; onChange: (units: UnitInput[]) => void
}

/** 입력값은 부모가 보관한다. 등록 방식 변경이나 명부 갱신으로 기존 대상을 지우지 않는다. */
export function CollectionUnitsEditor({ units, members, reviewerMemberId = '', disabled = false, onChange }: CollectionUnitsEditorProps) {
  const id = useId(), [message, setMessage] = useState(''), [search, setSearch] = useState('')
  const validation = validateCollectionUnitInputs(units, members), options = collectionUnitMemberOptions(members)
  // 검색은 표시만 바꾸며 선택한 제출 대상과 원본 명부는 보존한다.
  const query = search.normalize('NFC').trim().toLocaleLowerCase('ko')
  const visibleOptions = options.filter(person => person.label.normalize('NFC').toLocaleLowerCase('ko').includes(query))
  const editable = isCollectionUnitInputs(units), values = editable ? units : []
  const locked = disabled || !editable || validation.issues.some(issue => issue.field === 'members')
  const name = (memberId: string) => options.find(member => member.id === memberId)?.label ?? '현재 명부에 없는 교사'
  function change(next: UnitInput[]) { if (!locked) { setMessage(''); onChange(next) } }
  function attempt(action: () => UnitInput[]) { if (locked) return; try { change(action()) } catch (failure) { setMessage(failure instanceof Error ? failure.message : '선택을 확인해 주세요.') } }
  const globalIssues = validation.issues.filter(issue => issue.unitIndex === null)
  return <fieldset className="cs-unit-editor" disabled={locked} aria-describedby={`${id}-help`}><style>{styles}</style><legend>제출 대상</legend>
    <p id={`${id}-help`}>제출할 교사를 선택하세요. 함께 한 부를 낼 때는 공동 제출 단위를 추가하세요.</p>
    <fieldset className="cs-personal-units"><legend>교사마다 한 부</legend><label className="cs-unit-search" htmlFor={`${id}-search`}>교사 찾기<input id={`${id}-search`} type="search" placeholder="이름·소속으로 찾기" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="cs-unit-options">{visibleOptions.map(person => {
      const assigned = values.filter(unit => unit.responsibleMemberId === person.id)
      const personal = assigned.length === 1 && assigned[0].label === person.label && !assigned[0].contributorMemberIds.length
      const chosenReviewer = person.id === reviewerMemberId
      return <label key={person.id}><input type="checkbox" checked={!!assigned.length} disabled={locked || chosenReviewer || (!!assigned.length && !personal) || (!assigned.length && values.length >= collectionUnitLimit)} onChange={event => {
        if (event.target.checked) attempt(() => appendPersonalCollectionUnit(values, members, person.id, reviewerMemberId))
        else if (personal) change(values.filter(unit => unit !== assigned[0]))
      }} /><span>{person.label}{chosenReviewer && <small>현재 검토자</small>}{assigned.length > 0 && !personal && <small>아래 제출 단위에서 조정</small>}</span></label>
    })}</div>{!options.length ? <p>선택할 수 있는 교사가 없습니다. 현재 학교의 명부를 확인해 주세요.</p> : !visibleOptions.length && <p role="status">검색 결과가 없습니다. 선택한 제출 대상은 아래에 유지됩니다.</p>}</fieldset>
    <div className="cs-unit-add"><span>현재 {values.length}부 · 최대 {collectionUnitLimit}부</span><button type="button" disabled={locked || values.length >= collectionUnitLimit} onClick={() => attempt(() => appendSharedCollectionUnit(values))}>공동 제출 단위 추가</button></div>
    {globalIssues.length > 0 && <ul className="cs-unit-errors" role="alert">{globalIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
    {values.map((unit, index) => {
      const issues = validation.issues.filter(issue => issue.unitIndex === index), responsible = options.find(person => person.id === unit.responsibleMemberId)
      const unknown = [...new Set(unit.contributorMemberIds)].filter(memberId => !options.some(person => person.id === memberId))
      const custom = !responsible || unit.label !== responsible.label || !!unit.contributorMemberIds.length
      const patch = (partial: Partial<UnitInput>) => change(values.map((current, position) => position === index ? { ...current, ...partial } : current))
      const toggleContributor = (memberId: string, selected: boolean) => patch({ contributorMemberIds: selected ? [...unit.contributorMemberIds, memberId] : unit.contributorMemberIds.filter(value => value !== memberId) })
      return <details key={index} className="cs-unit-settings" open={custom || !!issues.length}><summary><strong>{unit.label || `제출 단위 ${index + 1}`}</strong><span>책임: {unit.responsibleMemberId ? name(unit.responsibleMemberId) : '선택 필요'} · 공동 작성자 {unit.contributorMemberIds.length}명</span></summary>
        <div className="cs-unit-fields">
          <label>제출 단위 이름<input aria-label={`제출 단위 ${index + 1} 이름`} value={unit.label} maxLength={100} aria-invalid={issues.some(issue => issue.field === 'label')} aria-describedby={issues.length ? `${id}-errors-${index}` : undefined} onChange={event => patch({ label: event.target.value })} /></label>
          <label>책임 교사<select aria-label={`책임 교사 ${index + 1}`} value={unit.responsibleMemberId} aria-invalid={issues.some(issue => issue.field === 'responsible')} aria-describedby={issues.length ? `${id}-errors-${index}` : undefined} onChange={event => patch({ responsibleMemberId: event.target.value })}><option value="">책임 교사를 선택하세요</option>{unit.responsibleMemberId && !responsible && <option value={unit.responsibleMemberId}>기존 책임자 · 현재 명부에 없음</option>}{options.map(person => <option key={person.id} value={person.id} disabled={person.id === reviewerMemberId}>{person.label}{person.id === reviewerMemberId ? ' · 현재 검토자' : ''}</option>)}</select></label>
          {unit.responsibleMemberId === reviewerMemberId && reviewerMemberId && <p className="cs-unit-notice">현재 책임 교사가 검토자로도 선택되어 있습니다. 담당자 또는 검토자 설정을 확인해 주세요. 최종 권한은 서버에서 확인합니다.</p>}
          <fieldset><legend>공동 작성자 {index + 1}</legend><div className="cs-unit-options">{options.filter(person => person.id !== unit.responsibleMemberId || unit.contributorMemberIds.includes(person.id)).map(person => <label key={person.id}><input type="checkbox" aria-label={`${person.label} · 공동 작성자 ${index + 1}`} checked={unit.contributorMemberIds.includes(person.id)} onChange={event => toggleContributor(person.id, event.target.checked)} /><span>{person.label}{person.id === unit.responsibleMemberId && <small>현재 책임 교사로도 선택됨</small>}</span></label>)}{unknown.map((memberId, position) => <label className="cs-unavailable-member" key={memberId}><input type="checkbox" aria-label={`명부에 없는 공동 작성자 ${position + 1} · 제출 단위 ${index + 1}`} checked onChange={() => toggleContributor(memberId, false)} /><span>기존 공동 작성자 {position + 1} · 현재 명부에 없음<small>선택을 직접 해제할 수 있습니다.</small></span></label>)}</div></fieldset>
          {issues.length > 0 && <ul id={`${id}-errors-${index}`} className="cs-unit-errors" role="alert">{issues.map((issue, ordinal) => <li key={ordinal}>{issue.message}</li>)}</ul>}
          <button type="button" className="cs-unit-remove" aria-label={`${unit.label || `제출 단위 ${index + 1}`} 제출 단위 제거`} onClick={() => change(values.filter((_, position) => position !== index))}>이 제출 단위 제거</button>
        </div>
      </details>
    })}
    {message && <p className="cs-unit-errors" role="alert">{message}</p>}
    <p className="cs-unit-footnote">공개한 뒤에는 제출 단위와 구성원을 바꿀 수 없습니다. 지금 설정한 내용은 초안 저장 시 함께 저장됩니다.</p>
  </fieldset>
}
