import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope } from '../app/pending-requests'
import type { Placement, TimetableBasis } from './contracts'
import { canonicalTimetableJson } from '../../../../packages/timetable/src/cpSat'
import { validateBasis, validatePlacements } from '../../../../packages/timetable/src/validate'
import type { CandidateLessonDetail } from './candidate-review'
import { adoptSavedCandidate, appendCandidate, candidateMatchesBasis, candidateLibraryPolicy as policy, compareSavedCandidates, createSavedCandidate, filterCandidateChanges, readCandidateLibrary, type SavedCandidate } from './candidate-library'

export interface TimetableCandidateLibraryProps {
  member: Membership; basis: TimetableBasis; placements: Placement[] | null; title?: string; disabled: boolean
  onAdopt(placements: Placement[]): void | boolean
}
const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
function Position({ row }: { row: CandidateLessonDetail | null }) {
  return row ? <><span>{days[row.slot.day - 1]} {row.slot.label} · {clock(row.slot.startMinute)}–{clock(row.slot.endMinute)}</span><small>{row.resources.map(resource => `${resource.label} [${resource.id}]`).join(' · ')}</small></> : <span>배정 없음</span>
}
/** 소속·학교·학기가 바뀌면 이전 보관함을 새 작업에 보여주지 않는다. */
export function TimetableCandidateLibrary(props: TimetableCandidateLibraryProps) {
  if (!validateBasis(props.basis).valid) return <p role="alert">후보 보관에 필요한 기초 자료를 확인하지 못했습니다.</p>
  return <CandidateLibrary key={JSON.stringify([recoveryScope(props.member), props.basis.schoolId, props.basis.termId])} {...props} />
}
function CandidateLibrary({ member, basis, placements, title, disabled, onAdopt }: TimetableCandidateLibraryProps) {
  const memory = useEditDraft<SavedCandidate[]>(member, `timetable-candidates:${JSON.stringify([basis.schoolId, basis.termId])}`)
  const initial = useMemo(() => { try { return { entries: readCandidateLibrary(memory.initial ?? [], basis), error: '' } } catch (error) { return { entries: [] as SavedCandidate[], error: (error as Error).message } } }, [memory])
  const [entries, setEntries] = useState(initial.entries), [restoreError, setRestoreError] = useState(initial.error)
  const [name, setName] = useState(title?.trim() || '비교 후보'), [selectedId, setSelectedId] = useState(initial.entries.at(-1)?.id ?? ''), [comparisonId, setComparisonId] = useState('working')
  const [query, setQuery] = useState(''), [resourceId, setResourceId] = useState(''), [page, setPage] = useState(0), [notice, setNotice] = useState(''), [error, setError] = useState(''), [consent, setConsent] = useState('')
  const selected = entries.find(row => row.id === selectedId)
  const currentValid = useMemo(() => validatePlacements(basis, placements).valid, [basis, placements])
  const currentKey = useMemo(() => canonicalTimetableJson({ basis, placements }), [basis, placements])
  const consentKey = canonicalTimetableJson([selected?.id, currentKey, comparisonId])
  const matches = useMemo(() => selected ? candidateMatchesBasis(selected, basis) : false, [selected, basis])
  const comparison = useMemo(() => {
    if (!selected) return null
    try {
      const before = comparisonId === 'working' ? currentValid ? createSavedCandidate(basis, placements!, '현재 작업', 'working', '2000-01-01T00:00:00.000Z') : null : entries.find(row => row.id === comparisonId)
      if (!before || before.id === selected.id) return null
      return compareSavedCandidates(before, selected)
    } catch { return null }
  }, [selected, comparisonId, currentValid, basis, placements, entries])
  const resources = useMemo(() => {
    const rows = new Map<string, { id: string; label: string; kind: string }>()
    for (const change of comparison?.changes ?? []) for (const side of [change.before, change.after]) for (const resource of side?.resources ?? []) {
      if (!['teacher', 'class', 'student_group'].includes(resource.kind)) continue
      const old = rows.get(resource.id)
      rows.set(resource.id, { ...resource, label: old && old.label !== resource.label ? `${old.label} → ${resource.label}` : resource.label })
    }
    return [...rows.values()]
  }, [comparison])
  const changes = filterCandidateChanges(comparison?.changes ?? [], query, resourceId)
  const pages = Math.max(1, Math.ceil(changes.length / policy.pageSize)), currentPage = Math.min(page, pages - 1)
  useEffect(() => { setConsent(''); setPage(0) }, [currentKey, selectedId, comparisonId, disabled])
  function saveEntries(next: SavedCandidate[]) { setEntries(next); memory.save(next.length ? next : undefined) }
  function capture() {
    if (disabled || !currentValid || restoreError) return
    try {
      const candidate = createSavedCandidate(basis, placements!, name, crypto.randomUUID(), new Date().toISOString())
      saveEntries(appendCandidate(entries, candidate)); setSelectedId(candidate.id); setComparisonId('working'); setConsent(''); setError(''); setNotice('현재 배치를 탭 보관함에 넣었습니다. 서버 저장이나 학기 시간표 확정은 하지 않았습니다.')
    } catch (reason) { setError((reason as Error).message); setNotice('') }
  }
  function adopt() {
    if (disabled || !selected || consent !== consentKey || restoreError) return
    try { const checked = adoptSavedCandidate(selected, basis); if (onAdopt(checked) === false) { setConsent(''); setNotice(''); setError('현재 작업의 고정·권한·입력 상태 때문에 후보를 반영하지 못했습니다. 작업 배치 안내를 확인해 주세요.'); return }; setConsent(''); setError(''); setNotice('확인한 후보를 현재 작업 배치에 반영했습니다. 서버 저장과 학기 확정은 별도 단계입니다.') } catch (reason) { setError((reason as Error).message) }
  }
  function remove(id: string) {
    if (disabled) return
    const next = entries.filter(row => row.id !== id); saveEntries(next)
    if (selectedId === id) setSelectedId(next.at(-1)?.id ?? '')
    if (comparisonId === id) setComparisonId('working')
    setConsent(''); setNotice('선택한 후보만 탭 보관함에서 지웠습니다. 현재 작업과 서버 초안은 그대로입니다.'); setError('')
  }
  return <section className="timetable-card timetable-candidate-library" aria-label="후보 보관과 비교">
    <details><summary>다시 계산 전에 후보 보관·비교 · {entries.length}개</summary><h3>후보 보관과 비교</h3><p className="timetable-muted">다시 계산하기 전에 마음에 드는 배치를 보관해 비교하세요. 현재 탭에만 최대 {policy.maxCandidates}개 보관하며, 새로고침·브라우저 종료 후에는 복원되지 않습니다. 남길 결과는 서버 초안으로 저장해 주세요.</p>
    {restoreError ? <><p role="alert">{restoreError}</p><button type="button" className="secondary" disabled={disabled} onClick={() => { memory.remove(); setEntries([]); setRestoreError(''); setSelectedId('') }}>검증하지 못한 후보 보관함 비우기</button></> : <>
      <div className="timetable-grid"><label>보관 후보 이름<input aria-label="보관 후보 이름" maxLength={policy.titleLength} disabled={disabled} value={name} onChange={event => setName(event.target.value)} /></label><div className="timetable-actions"><button type="button" className="secondary" disabled={disabled || !currentValid || !name.trim() || entries.length >= policy.maxCandidates} onClick={capture}>현재 배치를 후보로 보관</button><span>{entries.length}/{policy.maxCandidates}개 보관</span></div></div>
      {!currentValid && <p className="timetable-muted">미배정·충돌을 해결한 전체 배치만 후보로 보관할 수 있습니다. 기존 보관 후보의 조회·비교는 가능합니다.</p>}
      {!!entries.length && <><label>검토할 보관 후보<select aria-label="검토할 보관 후보" value={selected?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setComparisonId('working'); setConsent(''); setPage(0); setResourceId('') }}>{entries.map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.title} · {row.basis.revision}판</option>)}</select></label>
        {selected && <><p><strong>{selected.title}</strong> · 기초 자료 {selected.basis.revision}판 · 보관 시각 <time dateTime={selected.capturedAt}>{new Date(selected.capturedAt).toLocaleString('ko-KR')}</time></p><details><summary>이 후보의 원본과 조건</summary><p>기초판 {selected.basis.id} · 학기 {selected.basis.termId}</p><p>원본 지문 <code>{selected.basis.sourceFingerprint}</code></p><p>고정 {selected.basis.fixed.length}개 · 불가 {selected.basis.unavailable.length}개 · 선호 {selected.basis.preferences.length}개 · 수업 {selected.placements.length}개</p><p className="timetable-muted">생성 방식이나 최적성은 추정하지 않습니다. 보관 당시의 전체 기초 자료와 조건을 배치와 함께 독립 검증합니다.</p></details>
        <p className={matches ? 'timetable-notice' : 'timetable-error'}>{matches ? '현재 기초 자료·조건과 같습니다. 확인 후 현재 작업 배치로 채택할 수 있습니다.' : '현재 기초 자료 또는 조건과 다릅니다. 이전 후보로 조회·비교만 하며 채택은 막습니다.'}</p>
        <label>보관 후보 비교 기준<select aria-label="보관 후보 비교 기준" value={comparisonId} onChange={event => { setComparisonId(event.target.value); setPage(0); setResourceId('') }}><option value="working">현재 작업 배치{currentValid ? '' : ' (불완전하여 비교 불가)'}</option>{entries.filter(row => row.id !== selected.id).map(row => <option key={row.id} value={row.id}>{row.title} · 보관 후보 {entries.indexOf(row) + 1}</option>)}</select></label>
        {comparison ? <><p>이동 {comparison.counts.moved}개 · 배정 변경 {comparison.counts.reassigned}개 · 추가 {comparison.counts.added}개 · 제외 {comparison.counts.removed}개</p><p className="timetable-muted">이동과 배정 변경은 같은 수업에 함께 해당할 수 있습니다. 이름 대신 수업 ID로 비교하며 과거 배정은 당시 이름과 시각으로 표시합니다.</p>
          {comparison.scores ? <><dl className="timetable-summary"><div><dt>선호 벌점 · 비교 기준 → 선택 후보</dt><dd>{comparison.scores.beforePenalty} → {comparison.scores.afterPenalty}</dd></div><div><dt>교사 하루 최대 · 비교 기준 → 선택 후보</dt><dd>{comparison.scores.beforePeak} → {comparison.scores.afterPeak}차시</dd></div></dl><p className="timetable-muted">전체 기초 자료와 조건이 같을 때만 점수를 비교합니다. 선호 벌점은 낮을수록 좋지만 전교 최적이나 실제 교사 만족도를 보장하지 않습니다.</p></> : <p className="timetable-notice">기초 자료 또는 조건이 달라 벌점·부담 점수를 직접 비교하지 않습니다. 아래에서는 수업 시각과 배정의 차이만 확인합니다.</p>}
          <details><summary>바뀌는 수업 자세히 · {comparison.changes.length}개</summary><div className="timetable-grid"><label>후보 변경 검색<input aria-label="후보 변경 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="수업·교사·학급 이름 또는 ID" /></label><label>후보 변경 교사·학급<select aria-label="후보 변경 교사·학급" value={resourceId} onChange={event => { setResourceId(event.target.value); setPage(0) }}><option value="">전체 변경</option>{resources.map(row => <option key={row.id} value={row.id}>{row.label} [{row.id}] · {row.kind === 'teacher' ? '교사' : '학급·수강 집단'}</option>)}</select></label></div>
            {changes.length ? <div className="timetable-foundation-table" role="region" aria-label="보관 후보 변경표" tabIndex={0}><table><caption>비교 기준 → 선택 후보 · 검색 결과 {changes.length}개</caption><thead><tr><th scope="col">수업</th><th scope="col">비교 기준</th><th scope="col">선택 후보</th></tr></thead><tbody>{changes.slice(currentPage * policy.pageSize, (currentPage + 1) * policy.pageSize).map(row => <tr key={row.lessonId}><th scope="row">{row.after?.label ?? row.before?.label}<small>[{row.lessonId}] · {[row.added && '추가', row.removed && '제외', row.moved && '이동', row.reassigned && '배정 변경'].filter(Boolean).join(' · ')}</small></th><td><Position row={row.before} /></td><td><Position row={row.after} /></td></tr>)}</tbody></table></div> : <p>{comparison.changes.length ? '검색 조건에 맞는 변경이 없습니다.' : '실제 수업 시각과 배정이 같습니다.'}</p>}
            {pages > 1 && <nav className="timetable-actions" aria-label="보관 후보 변경 쪽 이동"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전 후보 변경</button><span>{currentPage + 1}/{pages}쪽 · 전체 {changes.length}개</span><button type="button" className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음 후보 변경</button></nav>}
          </details>
        </> : <p className="timetable-muted">완성된 다른 배치를 비교 기준으로 선택하면 변경 수업을 확인할 수 있습니다.</p>}
        <label className="timetable-check"><input type="checkbox" aria-label="선택 후보와 현재 작업의 변경 내용을 확인했으며 작업 배치로 채택합니다" disabled={disabled || !matches} checked={consent === consentKey} onChange={event => setConsent(event.target.checked ? consentKey : '')} />선택 후보와 현재 작업의 변경 내용을 확인했으며 작업 배치로 채택합니다</label><div className="timetable-actions"><button type="button" disabled={disabled || !matches || consent !== consentKey} onClick={adopt}>확인한 후보를 작업 배치로 채택</button><button type="button" className="secondary" disabled={disabled} onClick={() => remove(selected.id)}>선택 후보만 보관함에서 지우기</button></div><p className="timetable-muted">채택은 현재 작업 배치만 바꿉니다. 서버 저장·학교 공유·학기 확정은 별도로 확인합니다.</p></>}
      </>}
    </>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</details>
  </section>
}
