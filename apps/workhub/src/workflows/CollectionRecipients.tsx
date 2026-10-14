import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import { collectionUnitLimit } from './entry-guide'
import { appendCollectionRecipients, collectionRecipients, currentRecipientSelection, filterCollectionRecipients } from './collection-recipients'
import type { UnitInput } from './types'
import styles from './collection-recipients.css?inline'

export interface CollectionRecipientsProps {
  members: Membership[]; schoolId: string; date: string; units: UnitInput[]
  reviewerMemberId?: string; disabled?: boolean; onChange: (units: UnitInput[]) => void
}

export function CollectionRecipients({ members, schoolId, date, units, reviewerMemberId, disabled = false, onChange }: CollectionRecipientsProps) {
  const id = useId(), scope = JSON.stringify([schoolId, date])
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] })
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const context = { members, schoolId, date, units, reviewerMemberId }
  const roster = collectionRecipients(context), eligible = roster.candidates
  const selectionIds = currentRecipientSelection(selection.scope === scope ? selection.ids : [], eligible)
  const selected = new Set(selectionIds), filtered = filterCollectionRecipients(eligible, query), window = listWindow(filtered, page)
  const eligibilityKey = JSON.stringify(eligible.map(member => member.id))
  useEffect(() => {
    setSelection(current => {
      const ids = currentRecipientSelection(current.scope === scope ? current.ids : [], eligible)
      return current.scope === scope && JSON.stringify(current.ids) === JSON.stringify(ids) ? current : { scope, ids }
    })
    // 내용만 바뀌어도 선택을 지우지 않는다. 선택 가능한 ID가 바뀐 경우에만 재확인한다.
  }, [scope, eligibilityKey])
  useEffect(() => { setQuery(''); setPage(0); setNotice(''); setError('') }, [scope])
  const remaining = Math.max(0, collectionUnitLimit - (Array.isArray(units) ? units.length : 0))
  const overLimit = selectionIds.length > remaining, locked = disabled || Boolean(roster.error)
  const duplicateNames = new Map<string, number>(), ordinalById = new Map<string, number>()
  for (const member of eligible) { const ordinal = (duplicateNames.get(member.name) ?? 0) + 1; duplicateNames.set(member.name, ordinal); ordinalById.set(member.id, ordinal) }
  function choose(ids: string[]) { if (!locked) { setSelection({ scope, ids: currentRecipientSelection(ids, eligible) }); setNotice(''); setError('') } }
  function add() {
    if (locked) return
    try {
      const result = appendCollectionRecipients(context, selectionIds)
      onChange(result.units)
      setSelection({ scope, ids: [] }); setError(''); setNotice(`${result.added}명의 제출 단위를 추가했습니다. 내용을 확인한 뒤 수합 초안을 저장해 주세요.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '교사를 추가하지 못했습니다. 선택과 기존 단위를 확인해 주세요.') }
  }
  return <section className="wf-recipient-picker" aria-labelledby={`${id}-title`}>
    <style>{styles}</style>
    <h4 id={`${id}-title`}>교사마다 1부씩 추가</h4>
    <p id={`${id}-help`}>현재 학교의 교사를 선택해 개인별 제출 단위를 추가합니다. 기존 책임자와 검토자는 제외합니다.</p>
    <fieldset disabled={locked} aria-describedby={`${id}-help`}>
      <legend className="sr-only">일괄 추가할 교사 선택</legend>
      <label className="wf-recipient-search">교사 이름 검색<input type="search" maxLength={200} value={query} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
      <div className="wf-recipient-tools">
        <button type="button" className="secondary small" disabled={!filtered.some(member => !selected.has(member.id))} onClick={() => choose([...selectionIds, ...filtered.map(member => member.id)])}>검색 결과 전체 선택 ({filtered.length}명)</button>
        <button type="button" className="text-button" disabled={!filtered.some(member => selected.has(member.id))} onClick={() => { const found = new Set(filtered.map(member => member.id)); choose(selectionIds.filter(value => !found.has(value))) }}>검색 결과 선택 해제</button>
        <button type="button" className="text-button" disabled={!selectionIds.length} onClick={() => choose([])}>모든 선택 해제</button>
      </div>
      <p className="wf-recipient-count" role="status" aria-atomic="true">추가 가능한 교사 {eligible.length}명 · 검색 결과 {filtered.length}명 · 선택 {selectionIds.length}명{query && ' · 다른 검색에서 선택한 교사도 유지됩니다.'}</p>
      <div ref={list} className="wf-recipient-options" tabIndex={-1} role="group" aria-label="추가 가능한 교사">
        {window.items.length ? window.items.map(member => <label className="wf-recipient-option" key={member.id}>
          <input type="checkbox" checked={selected.has(member.id)} onChange={event => choose(event.target.checked ? [...selectionIds, member.id] : selectionIds.filter(value => value !== member.id))} />
          <span>{member.name}{(duplicateNames.get(member.name) ?? 0) > 1 && <small>동명이인 {ordinalById.get(member.id)}</small>}</span>
        </label>) : <p>{query ? '검색한 이름의 추가 가능한 교사가 없습니다.' : '추가할 수 있는 교사가 없습니다.'}</p>}
      </div>
      <ListPagination label="추가할 교사 목록 페이지" window={window} disabled={locked} onPageChange={next => { setPage(next); list.current?.focus() }} />
      <div className="wf-recipient-footer"><p>{remaining}명까지 추가 가능 · 한 요청에 최대 {collectionUnitLimit}부</p><button type="button" className="secondary" disabled={!selectionIds.length || overLimit} onClick={add}>선택한 교사 {selectionIds.length}명 추가</button></div>
    </fieldset>
    {roster.skipped > 0 && <p className="wf-recipient-feedback">소속 정보를 확인할 수 없는 명부 {roster.skipped}건은 표시하지 않았습니다.</p>}
    {(roster.error || error || overLimit) && <p className="wf-recipient-feedback" role="alert">{roster.error || error || `선택한 ${selectionIds.length}명을 모두 추가하면 ${collectionUnitLimit}부를 초과합니다. ${remaining}명 이내로 선택해 주세요.`}</p>}
    {notice && <p className="wf-recipient-feedback" role="status">{notice}</p>}
  </section>
}
