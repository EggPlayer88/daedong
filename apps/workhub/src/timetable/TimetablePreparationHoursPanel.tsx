import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope } from '../app/pending-requests'
import { requestBlobDownload } from '../files/download'
import type { PreparationDraft, PreparationSource } from './preparation'
import { applyPreparationHoursWorkbook, exportPreparationHoursWorkbook, importPreparationHoursWorkbook, preparationHoursWorkbookKey } from './preparation-hours-workbook'
import { TimetableWorkbookError } from './xlsx'
import limits from './workbook-limits.json'
import './timetable-preparation-hours.css'

type Preview = ReturnType<typeof importPreparationHoursWorkbook>
interface HeldFile { fileName: string; bytes: Uint8Array; preview: Preview; selected: string[]; invalid: boolean }
interface Props {
  source?: PreparationSource; draft?: PreparationDraft; member: Membership; disabled: boolean
  onApply: (draft: PreparationDraft) => void; onLockChange?: (locked: boolean) => void
}
const PAGE_SIZE = 20
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '')
const errorText = (error: unknown) => error instanceof TimetableWorkbookError ? error.message : '시수 파일을 확인하지 못했습니다. 준비 초안과 보관한 파일은 유지됩니다.'
const download = (bytes: Uint8Array, name: string) => requestBlobDownload(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)

export function TimetablePreparationHoursPanel(props: Props) {
  const id = useId(), scope = recoveryScope(props.member), memory = useEditDraft<HeldFile>(props.member, 'timetable-preparation-hours')
  const [heldState, setHeldState] = useState(() => ({ scope, value: memory.initial })), [opened, setOpened] = useState(Boolean(memory.initial))
  const held = heldState.scope === scope ? heldState.value : undefined
  const [reading, setReading] = useState(false), [confirmed, setConfirmed] = useState(false), [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const latest = useRef({ props, scope, held }), life = useRef(0), readTicket = useRef(0), validity = useRef(0), operation = useRef(false)
  latest.current = { props, scope, held }
  const currentKey = useMemo(() => {
    if (!props.source || !props.draft || props.source.schoolId !== props.member.schoolId) return ''
    try { return preparationHoursWorkbookKey(props.source, props.draft) } catch { return '' }
  }, [props.source, props.draft, props.member.schoolId])
  const available = !props.disabled && Boolean(currentKey && props.source?.canEdit)
  const stale = Boolean(held && held.preview.sourceKey !== currentKey)
  const locked = reading || Boolean(held?.preview.changes.length)
  const canUse = available && !reading
  const canSelect = canUse && !stale && !held?.invalid
  const filtered = useMemo(() => (held?.preview.changes ?? []).filter(row => normalized(row.label + ' ' + row.courseId).includes(normalized(query))), [held?.preview, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), shownPage = Math.min(page, pages - 1)
  const selectedCount = held?.selected.length ?? 0
  function persist(value: HeldFile | undefined) {
    setHeldState({ scope, value }); latest.current.held = value
    memory.save(value, Boolean(value?.preview.changes.length))
  }
  useEffect(() => () => { life.current++; readTicket.current++ }, [])
  useEffect(() => { props.onLockChange?.(locked); return () => props.onLockChange?.(false) }, [locked, props.onLockChange])
  useEffect(() => { validity.current++; setConfirmed(false) }, [currentKey, props.disabled])
  useEffect(() => {
    life.current++; readTicket.current++; operation.current = false; setReading(false)
    setHeldState({ scope, value: memory.initial }); setOpened(Boolean(memory.initial)); setConfirmed(false); setDiscarding(false)
    setError(''); setNotice(''); setQuery(''); setPage(0)
  }, [scope, memory])
  function inspect(bytes: Uint8Array, fileName: string) {
    const value = latest.current
    if (!value.props.source || !value.props.draft || value.props.disabled || !value.props.source.canEdit || value.scope !== scope) return
    const preview = importPreparationHoursWorkbook(bytes, value.props.source, value.props.draft)
    persist({ fileName, bytes, preview, selected: preview.changes.map(row => row.courseId), invalid: false })
    setConfirmed(false); setDiscarding(false); setError(''); setQuery(''); setPage(0)
    setNotice(preview.changes.length ? '아직 준비 초안을 바꾸지 않았습니다. 변경 전후 시수를 확인하고 반영할 수업을 선택해 주세요.' : '현재 시수와 같습니다. 반영할 변경이 없습니다.')
  }
  async function readFile(file: File | undefined) {
    if (!file || !available || operation.current) return
    const epoch = life.current, token = scope, ticket = ++readTicket.current, originalKey = currentKey, originalValidity = validity.current
    operation.current = true; setReading(true); setConfirmed(false); setDiscarding(false); setError(''); setNotice('')
    if (held) persist({ ...held, invalid: true })
    const active = () => epoch === life.current && ticket === readTicket.current && token === latest.current.scope
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > limits.fileBytes) throw new TimetableWorkbookError('이 화면에서 내려받은 8 MiB 이하 XLSX 양식을 선택해 주세요.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!active()) return
      const now = latest.current.props
      if (validity.current !== originalValidity || now.disabled || !now.source?.canEdit || !now.draft || now.source.schoolId !== now.member.schoolId || preparationHoursWorkbookKey(now.source, now.draft) !== originalKey) throw new TimetableWorkbookError('파일을 읽는 동안 학교 자료나 준비 초안이 바뀌었습니다. 현재 자료를 확인한 뒤 다시 불러와 주세요.')
      inspect(bytes, file.name)
    } catch (failure) { if (active()) setError(errorText(failure)) }
    finally { if (active()) { operation.current = false; setReading(false) } }
  }
  function apply() {
    if (!held || !confirmed || !selectedCount || !canSelect || operation.current) return
    try {
      const now = latest.current.props
      if (!now.source || !now.draft || now.disabled || !now.source.canEdit || now.source.schoolId !== now.member.schoolId) return
      const next = applyPreparationHoursWorkbook(now.source, now.draft, held.preview, held.selected)
      now.onApply(next); persist(undefined); setConfirmed(false); setDiscarding(false); setError('')
      setNotice(`선택한 ${selectedCount}개 수업의 시수를 준비 초안에 반영했습니다. 활동·일과는 그대로이며 서버 저장과 기준판 만들기는 별도로 진행해 주세요.`)
    } catch (failure) { setError(errorText(failure)); setConfirmed(false) }
  }
  function select(ids: string[]) { if (!held || !canSelect) return; persist({ ...held, selected: ids }); setConfirmed(false) }
  function clear() { if (reading) return; persist(undefined); setConfirmed(false); setDiscarding(false); setError(''); setNotice('불러온 시수 파일의 미리보기를 정리했습니다. 기존 준비 초안은 그대로입니다.') }
  return <details className="timetable-preparation-hours" open={opened} onToggle={event => { if (!locked) setOpened(event.currentTarget.open); else if (!event.currentTarget.open) event.currentTarget.open = true }}>
    <summary onClick={event => { if (locked) event.preventDefault() }}>엑셀로 주당 시수 한 번에 준비</summary>
    <p>공식 배정과 수업 ID를 기준으로 주당 시수를 정리합니다. 엑셀의 ‘입력시수’ 칸만 수정한 뒤, 비교하고 선택한 값을 준비 초안에 반영하세요.</p>
    <p className="timetable-muted">일과와 활동은 자동으로 바꾸지 않습니다. 활동 합계가 시수와 다르면 반영 후 ‘시간대 편집·요일 복사·수업 일괄 구성’에서 확인하세요. 파일과 미반영 입력은 현재 탭에만 보관됩니다.</p>
    {props.disabled && <p role="status">다른 편집을 마치거나 현재 자료를 확인한 뒤 시수를 반영할 수 있습니다. 불러온 파일은 보관합니다.</p>}
    {!currentKey && <p role="status">학교 자료와 준비 초안을 다시 확인하면 시수 양식을 사용할 수 있습니다. 보관한 미리보기는 유지됩니다.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={!canUse} onClick={() => { if (!props.source || !props.draft) return; try { download(exportPreparationHoursWorkbook(props.source, props.draft), '시간표_준비_주당시수.xlsx'); setError(''); setNotice('현재 준비 초안의 시수 엑셀 내려받기를 요청했습니다.') } catch (failure) { setError(errorText(failure)) } }}>준비 시수 엑셀 내려받기</button></div>
    <label htmlFor={`${id}-file`}>준비 시수 엑셀 불러오기</label><input id={`${id}-file`} type="file" accept=".xlsx" disabled={!canUse} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void readFile(file) }} />
    <p className="timetable-muted">8 MiB 이하 XLSX · 빈칸은 시수로 처리하지 않음 · 공식 시수가 정해진 수업은 수정 불가 · 서버로 파일을 전송하지 않음</p>
    {reading && <p role="status">시수 엑셀과 준비 초안을 비교하고 있습니다…</p>}{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {held && <section aria-label="준비 시수 변경 비교">
      <h4>주당 시수 변경 비교</h4><p>{held.fileName}</p>
      {stale && <p role="alert" className="timetable-error">학교 자료나 준비 초안이 바뀌어 반영을 멈췄습니다. 미리보기는 보관했습니다. 최신 양식을 내려받아 변경 내용을 옮긴 뒤 다시 불러와 주세요.</p>}
      {held.invalid && <p role="alert">새 파일을 확인하지 못해 이전 승인을 해제했습니다. 보관한 파일을 다시 검사할 수 있습니다.</p>}
      <p>변경 {held.preview.changes.length}개 · 선택 {selectedCount}개 · 검색 결과 {filtered.length}개</p>
      {held.preview.warnings.length > 0 && <details><summary>시수 반영 전 안내 {held.preview.warnings.length}건</summary><ul>{held.preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {held.preview.changes.length > 0 && <>
        <label>시수 변경 수업 검색<input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="수업명 또는 수업 ID" /></label>
        <div className="timetable-actions"><button type="button" className="secondary" disabled={!canSelect} onClick={() => select(held.preview.changes.map(row => row.courseId))}>변경 시수 모두 선택</button><button type="button" className="secondary" disabled={!canSelect} onClick={() => select([])}>시수 선택 모두 해제</button></div>
        <ul className="timetable-hours-changes">{filtered.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE).map(row => <li key={row.courseId}>
          <label className="timetable-check"><input type="checkbox" checked={held.selected.includes(row.courseId)} disabled={!canSelect} onChange={event => select(event.target.checked ? [...new Set([...held.selected, row.courseId])] : held.selected.filter(value => value !== row.courseId))} />{row.label} [{row.courseId}]</label>
          <dl><div><dt>현재 시수</dt><dd>{row.before}차시</dd></div><div><dt>가져온 시수</dt><dd>{row.after}차시</dd></div><div><dt>기존 활동 합계</dt><dd>{row.activityPeriods}차시</dd></div></dl>
          {row.warnings.length > 0 && <ul>{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </li>)}</ul>
        {!filtered.length && <p>검색 조건에 맞는 시수 변경이 없습니다.</p>}
        {pages > 1 && <nav className="timetable-actions" aria-label="시수 변경 수업 쪽 이동"><button type="button" className="secondary" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>이전 시수 변경</button><span>{shownPage + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={shownPage + 1 === pages} onClick={() => setPage(shownPage + 1)}>다음 시수 변경</button></nav>}
        <label className="timetable-check timetable-hours-confirm"><input type="checkbox" checked={confirmed} disabled={!canSelect || !selectedCount} onChange={event => setConfirmed(event.target.checked)} />선택한 시수와 기존 활동 합계를 확인했으며 준비 초안에 반영합니다</label>
        <button type="button" disabled={!canSelect || !confirmed || !selectedCount} onClick={apply}>선택한 시수를 준비 초안에 반영</button>
      </>}
      <div className="timetable-actions timetable-hours-recovery">
        <button type="button" className="secondary" disabled={reading} onClick={() => { try { download(held.bytes, held.fileName); setError('') } catch (failure) { setError(errorText(failure)) } }}>보관한 시수 파일 내려받기</button>
        {held.invalid && <button type="button" className="secondary" disabled={!canUse || stale} onClick={() => { try { inspect(held.bytes, held.fileName) } catch (failure) { setError(errorText(failure)) } }}>보관한 시수 파일 다시 검사</button>}
        <button type="button" className="secondary" disabled={reading} onClick={() => held.preview.changes.length ? setDiscarding(true) : clear()}>시수 파일 미리보기 정리</button>
      </div>
      {discarding && <div role="group" aria-label="미반영 시수 정리 확인"><p>반영하지 않은 시수 선택을 버릴까요? 현재 준비 초안은 유지됩니다.</p><div className="timetable-actions"><button type="button" disabled={reading} onClick={clear}>미반영 시수 버리기</button><button type="button" className="secondary" onClick={() => setDiscarding(false)}>시수 미리보기 계속 보기</button></div></div>}
    </section>}
  </details>
}
