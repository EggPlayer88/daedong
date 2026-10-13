import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { normalizeDraft } from '../domain'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import { PendingRequestsProvider, usePendingRequest, useRecoveryStore } from '../app/pending-requests'
import { EventEditor, type Adapter } from './EventEditor'
import type { RelationOptions } from './contracts'
import { IMPORT_FIELDS, IMPORT_LIMITS, findImportCandidates, parseImportTable, prepareImportRows, suggestImportMapping, unmappedImportColumns, type ImportMapping, type ImportRow, type ImportTable } from './import-table'
import styles from './import.css?inline'

export interface CalendarImportProps { member: Membership; members: Membership[]; date: string; adapter: Adapter; relationOptions?: RelationOptions; demo?: boolean; storageLabel?: string; onClose: () => void; onSaved: (event: CalendarEvent) => void; onNavigationLockChange?: (locked: boolean) => void }
const MAX_FILE_BYTES = 1_000_000

// 붙여넣기는 등록 준비다. 실제 저장·권한·응답 유실 처리는 기존 일정 편집기에 맡긴다.
export function CalendarImport(props: CalendarImportProps) {
  const recovery = useRecoveryStore()
  return <PendingRequestsProvider store={recovery}><CalendarImportScope {...props} /></PendingRequestsProvider>
}

function CalendarImportScope(props: CalendarImportProps) {
  const { member, members, date, adapter, relationOptions, demo = false, storageLabel, onClose, onSaved, onNavigationLockChange } = props
  const recovery = usePendingRequest(member, 'calendar')
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), sourceInput = useRef<HTMLTextAreaElement>(null), resultHeading = useRef<HTMLHeadingElement>(null), errorElement = useRef<HTMLDivElement>(null), noticeElement = useRef<HTMLParagraphElement>(null)
  const alive = useRef(true), generation = useRef(0)
  const editorTrigger = useRef<HTMLButtonElement | null>(null), returnEditorFocus = useRef(false)
  const [source, setSource] = useState(''), [delimiter, setDelimiter] = useState<'auto' | 'tab' | 'comma'>('auto')
  const [table, setTable] = useState<ImportTable>(), [mapping, setMapping] = useState<ImportMapping>(), [rows, setRows] = useState<ImportRow[]>()
  const [existing, setExisting] = useState<CalendarEvent[]>([]), [reading, setReading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [comparisonReady, setComparisonReady] = useState(false)
  const [omissionsConfirmed, setOmissionsConfirmed] = useState(false)
  const [selected, setSelected] = useState<ImportRow>(), [receipts, setReceipts] = useState<Record<string, CalendarEvent>>({}), [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({})
  const [suspended, setSuspended] = useState<{ row: ImportRow; requestKey: string }>()
  const [page, setPage] = useState(0), [closing, setClosing] = useState(false), [listFocus, setListFocus] = useState(0)
  const savedCount = Object.keys(receipts).length, pageRows = listWindow(rows, page)
  const omittedColumns = useMemo(() => table && mapping ? unmappedImportColumns(table, mapping) : [], [table, mapping])
  const unconfirmedOmissions = omittedColumns.length > 0 && !omissionsConfirmed
  const locked = reading || Boolean(selected)
  const pendingRow = suspended && suspended.requestKey === recovery.request?.command.idempotencyKey ? suspended.row : undefined
  const navigationLocked = Boolean(source.trim() || table || selected || savedCount || reading)
  useEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => onNavigationLockChange?.(false)
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    alive.current = true
    const element = dialog.current, root = element?.getRootNode()
    const origin = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null
    element?.showModal(); sourceInput.current?.focus()
    return () => { alive.current = false; generation.current++; element?.close(); if (origin?.isConnected) origin.focus() }
  }, [])
  useEffect(() => { if (error) errorElement.current?.focus() }, [error])
  useEffect(() => { if (listFocus) resultHeading.current?.focus() }, [listFocus])
  useEffect(() => {
    if (!notice || selected) return
    const frame = requestAnimationFrame(() => noticeElement.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [notice, selected])
  useEffect(() => {
    if (selected || !returnEditorFocus.current) return
    returnEditorFocus.current = false
    // 자식 대화상자가 열릴 때 행 버튼은 비활성화된다. 다시 활성화된 뒤 원래 버튼으로 잇는다.
    const frame = requestAnimationFrame(() => {
      const trigger = editorTrigger.current
      if (trigger?.isConnected && !trigger.disabled) trigger.focus()
      else resultHeading.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [selected])
  function clearCheck() { setTable(undefined); setMapping(undefined); setRows(undefined); setExisting([]); setComparisonReady(false); setOmissionsConfirmed(false); setAcknowledged({}); setError(''); setNotice(''); setPage(0) }
  function changeSource(value: string) { generation.current++; setSource(value); clearCheck() }
  function close() { if (locked) return; if (source.trim() || savedCount) setClosing(true); else onClose() }
  function cancelRead() { generation.current++; setReading(false); setNotice('읽기를 취소했습니다. 원본 표는 유지됩니다. 다시 검사하거나 검토를 마칠 수 있습니다.') }
  async function readExisting() {
    const latest: unknown = await adapter.list(member.id)
    // 깨진 목록 일부를 빼고 비교하면 중복 없음으로 오인할 수 있으므로 전체 비교를 중단한다.
    if (!Array.isArray(latest)) throw new Error('기존 일정 목록을 확인하지 못했습니다. 다시 검사해 주세요.')
    const ids = new Set<string>()
    for (const event of latest) {
      if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id || ids.has(event.id) || event.schoolId !== member.schoolId || typeof event.authorMemberId !== 'string' || !event.authorMemberId || !Number.isSafeInteger(event.version) || event.version < 1 || typeof event.updatedAt !== 'string' || Number.isNaN(Date.parse(event.updatedAt))) throw new Error('기존 일정 응답 형식을 확인하지 못했습니다. 다시 검사해 주세요.')
      normalizeDraft(event, member, members); ids.add(event.id)
    }
    return latest as CalendarEvent[]
  }
  async function readFile(file?: File) {
    if (!file || locked || savedCount || recovery.request) return
    const attempt = ++generation.current; setReading(true); setComparisonReady(false); setError(''); setNotice('')
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('파일은 1MB 이하의 UTF-8 CSV·TSV만 열 수 있습니다. 시트에서 필요한 범위를 복사해 붙여넣을 수도 있습니다.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (text.length > IMPORT_LIMITS.text) throw new Error(`한 번에 ${IMPORT_LIMITS.text.toLocaleString()}자까지 확인할 수 있습니다. 필요한 일정 범위만 나누어 주세요.`)
      if (alive.current && attempt === generation.current) { setSource(text); clearCheck() }
    } catch (failure) { if (alive.current && attempt === generation.current) setError(failure instanceof TypeError ? 'UTF-8 텍스트로 읽을 수 없습니다. CSV UTF-8로 저장하거나 시트에서 복사해 붙여넣어 주세요.' : failure instanceof Error ? failure.message : '파일을 읽지 못했습니다. 붙여넣기로 다시 시도해 주세요.') }
    finally { if (alive.current && attempt === generation.current) setReading(false) }
  }
  function inspectColumns() {
    try { const parsed = parseImportTable(source, delimiter); setTable(parsed); setMapping(suggestImportMapping(parsed.headers)); setOmissionsConfirmed(false); setRows(undefined); setError(''); setNotice('열 이름을 확인했습니다. 제목과 시작일을 포함해 가져올 열을 선택하세요.') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '표를 읽지 못했습니다.'); setTable(undefined); setMapping(undefined); setRows(undefined) }
  }
  async function inspectRows() {
    if (!table || !mapping || locked || savedCount || recovery.request) return
    const attempt = ++generation.current; setReading(true); setComparisonReady(false); setError(''); setNotice('')
    try {
      const prepared = prepareImportRows(table, mapping, member, members)
      // 현재 열람할 수 있는 최신 원본만 중복 후보로 비교한다. 실패를 빈 목록으로 취급하지 않는다.
      const latest = await readExisting()
      if (alive.current && attempt === generation.current) { setRows(prepared); setExisting(latest); setComparisonReady(true); setAcknowledged({}); setPage(0); setListFocus(value => value + 1) }
    } catch (failure) { if (alive.current && attempt === generation.current) { setRows(undefined); setExisting([]); setError(failure instanceof Error ? failure.message : '기존 일정을 확인하지 못했습니다. 다시 검사해 주세요.') } }
    finally { if (alive.current && attempt === generation.current) setReading(false) }
  }
  async function refreshComparison() {
    if (!rows || locked) return
    const attempt = ++generation.current; setReading(true); setComparisonReady(false); setAcknowledged({}); setError(''); setNotice('')
    try {
      const latest = await readExisting()
      if (alive.current && attempt === generation.current) { setExisting(latest); setComparisonReady(true); setNotice('현재 열람할 수 있는 일정으로 다시 비교했습니다. 중복 후보가 있으면 별도 등록 여부를 다시 확인해 주세요.') }
    } catch (failure) { if (alive.current && attempt === generation.current) { setExisting([]); setError(failure instanceof Error ? failure.message : '기존 일정을 확인하지 못했습니다. 다시 비교해 주세요.') } }
    finally { if (alive.current && attempt === generation.current) setReading(false) }
  }
  const candidates = (row: ImportRow) => row.draft ? findImportCandidates(row.draft, existing) : []
  return <><style>{styles}</style><dialog ref={dialog} className="editor-dialog calendar-import-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close() }}>
    <header className="dialog-header"><div><p className="eyebrow">학교 일정 · 자료 가져오기</p><h2 id={`${id}-title`}>시트에서 일정 가져오기</h2></div><button type="button" className="icon-button" aria-label="일정 가져오기 닫기" disabled={locked} onClick={close}>✕</button></header>
    <div className="dialog-body">
      <p className="ci-intro">스프레드시트의 제목 행과 일정 행을 함께 복사해 붙여넣으세요. 열을 연결하고 각 일정을 확인한 뒤 등록합니다.</p>
      {demo && <p className="subtle-note">합성 자료 미리보기입니다. 실제 학교·학생 자료를 입력하지 마세요.</p>}
      {error && <div ref={errorElement} className="error-box" role="alert" tabIndex={-1}>{error}</div>}
      {notice && <p ref={noticeElement} className="notice-box" role="status" tabIndex={-1}>{notice}</p>}
      {recovery.request && !selected && !closing && <section className="notice-box" aria-label="가져오기 저장 결과 확인 필요"><h3>먼저 보관한 일정의 저장 결과를 확인하세요</h3><p>{pendingRow ? `원본 ${pendingRow.line}행 ‘${pendingRow.title}’의 요청을 보관했습니다.` : '이전 일정 저장 요청의 결과가 아직 확인되지 않았습니다.'} 다른 행을 등록하기 전에 같은 요청으로 결과를 확인해 주세요. 표와 등록 완료 행은 그대로 유지됩니다.</p>{pendingRow && <button type="button" className="secondary" disabled={reading} onClick={event => { editorTrigger.current = event.currentTarget; setNotice(''); setSelected(pendingRow) }}>보관한 원본 {pendingRow.line}행 다시 확인</button>}<p>가져오기를 종료해 학교 일정으로 돌아갈 수도 있습니다. 현재 탭의 보관 요청은 학교 일정에서 다시 확인하세요. 새로고침하면 복구 정보가 사라집니다.</p></section>}
      {closing ? <section className="notice-box" aria-label="일정 가져오기 종료 확인"><h3>가져오기를 종료할까요?</h3><p>등록 완료한 {savedCount}개 일정은 유지됩니다. 이 창의 원본 표와 아직 등록하지 않은 행은 닫으면 사라집니다.</p>{recovery.request && <p>결과 미확정 요청은 학교 일정의 ‘보관한 일정 확인’에서 같은 요청으로 확인하세요. 아직 등록되지 않았다고 판단해 새 일정으로 다시 입력하지 마세요.</p>}<div className="button-row"><button type="button" className="secondary" autoFocus onClick={() => setClosing(false)}>계속 검토</button><button type="button" className="primary" onClick={onClose}>가져오기 종료</button></div></section> : <>
      <fieldset className="form-fields" disabled={locked || savedCount > 0 || Boolean(recovery.request)}><legend className="sr-only">원본 표와 열 연결</legend>
        <label htmlFor={`${id}-source`}><span id={`${id}-source-label`}>원본 표 붙여넣기</span><textarea ref={sourceInput} id={`${id}-source`} aria-labelledby={`${id}-source-label`} className="ci-source" value={source} onChange={event => changeSource(event.target.value)} aria-describedby={`${id}-source-help`} spellCheck={false} placeholder={'제목\t시작일\t종료일\t장소\n교과 협의\t2026-10-20\t2026-10-20\t회의실'} /></label>
        <p id={`${id}-source-help`} className="hint">최대 {IMPORT_LIMITS.rows}행·{IMPORT_LIMITS.columns}열·{IMPORT_LIMITS.text.toLocaleString()}자. 첫 행은 열 이름입니다. 원본 표는 이 창에서만 처리됩니다.</p>
        <div className="form-grid"><label htmlFor={`${id}-file`}><span id={`${id}-file-label`}>CSV·TSV 파일 열기</span><input id={`${id}-file`} aria-labelledby={`${id}-file-label`} className="ci-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file) }} /></label><label htmlFor={`${id}-delimiter`}><span id={`${id}-delimiter-label`}>열 구분</span><select id={`${id}-delimiter`} aria-labelledby={`${id}-delimiter-label`} value={delimiter} onChange={event => { setDelimiter(event.target.value as typeof delimiter); clearCheck() }}><option value="auto">자동 확인</option><option value="tab">탭 · 시트에서 복사</option><option value="comma">쉼표 · CSV</option></select></label></div>
        <button type="button" className="secondary" disabled={!source.trim()} onClick={inspectColumns}>열 연결 확인</button>
        {table && mapping && <><div className="ci-mapping">{IMPORT_FIELDS.map(field => <label key={field.key} htmlFor={`${id}-map-${field.key}`}><span id={`${id}-map-${field.key}-label`}>{field.label}{field.required ? ' (필수)' : ' (선택)'}</span><select id={`${id}-map-${field.key}`} aria-labelledby={`${id}-map-${field.key}-label`} value={mapping[field.key]} onChange={event => { setMapping({ ...mapping, [field.key]: Number(event.target.value) }); setOmissionsConfirmed(false); setRows(undefined); setExisting([]); setError(''); setNotice('') }}><option value={-1}>가져오지 않음</option>{table.headers.map((header, index) => <option key={index} value={index}>{index + 1}열 · {header || '(열 이름 없음)'}</option>)}</select></label>)}</div>
          {omittedColumns.length > 0 && <section className="notice-box" aria-labelledby={`${id}-omissions-title`}><h3 id={`${id}-omissions-title`}>가져오지 않는 열을 확인하세요</h3><p id={`${id}-omissions-help`}>다음 열에는 값이 있지만 연결하지 않았습니다. 필요한 열을 연결하거나, 아래 내용을 제외해도 되는지 확인한 뒤 등록하세요.</p><ul>{omittedColumns.map(column => <li key={column.index} style={{ overflowWrap: 'anywhere' }}>{column.index + 1}열 ‘{column.label}’ · 값이 있는 {column.count}행 · 예: {column.sample}</li>)}</ul>{omittedColumns.some(column => column.timeLike) && <p>‘시간’·‘일시’에 시작과 종료가 함께 있다면 원본에서 각각의 열로 나누어 연결하세요. 시간 열을 제외하면 종일 일정으로 준비될 수 있습니다.</p>}<label className="check-label"><input type="checkbox" checked={omissionsConfirmed} onChange={event => setOmissionsConfirmed(event.target.checked)} aria-describedby={`${id}-omissions-help`} />표시된 열을 제외하고 등록하는 데 동의합니다</label></section>}
          <p className="hint">연도가 있는 날짜(예: 2026. 10. 13.)와 시간(예: 9:00, 오후 2:30:00)을 사용할 수 있습니다. 초는 00만 허용합니다. 종료일이 비어 있으면 시작일과 같은 날로, 시작·종료 시간이 모두 비어 있으면 종일 일정으로 준비합니다. 그 밖의 빈칸이나 모호한 날짜는 오류로 안내합니다.</p>
          <button type="button" className="primary" onClick={() => { void inspectRows() }}>행 검사 · 기존 일정과 비교</button></>}
      </fieldset>
      {reading && <div className="notice-box"><p role="status">원본 자료와 기존 일정을 확인하는 중…</p><button type="button" className="secondary" onClick={cancelRead}>읽기 취소</button></div>}
      {rows && <section aria-labelledby={`${id}-results`}><h3 ref={resultHeading} id={`${id}-results`} className="ci-summary-title" tabIndex={-1}>가져올 일정 검토</h3><div className="ci-counts" role="status"><span>전체 {rows.length}행</span><span>입력 오류 {rows.filter(row => row.errors.length).length}행</span><span>등록 완료 {savedCount}개</span><span>기존 일정 후보 {rows.filter(row => candidates(row).length && !receipts[row.key]).length}행</span></div>
        <p className="ci-target">새 일정은 ‘나만 보기’로 준비합니다. ‘내용·공유 대상 확인’에서 열람 범위와 홈 추천 대상을 직접 확인한 뒤 등록하세요.</p>
        {unconfirmedOmissions && <p className="notice-box" role="status">등록 전에 위의 ‘가져오지 않는 열’을 연결하거나 제외 여부를 확인해 주세요.</p>}
        <p className="hint">중복 후보는 마지막 검사 시점의 목록입니다. 이후 다른 교사가 등록한 일정은 다시 비교해야 확인할 수 있습니다. 자동 중복 방지를 보장하지는 않습니다.</p>
        {!comparisonReady && <p className="error-box" role="status">기존 일정 비교가 완료되지 않았습니다. 다시 비교한 뒤 등록을 계속해 주세요.</p>}
        <button type="button" className="secondary" disabled={locked} onClick={() => { void refreshComparison() }}>기존 일정 다시 비교</button>
        <p className="hint">원본 ID는 이 표의 행을 구분하는 데 사용합니다. 기존 시트의 변경을 자동 동기화하거나 기존 일정을 수정·삭제하지 않습니다. 이름과 날짜가 같은 일정은 중복 후보로 표시합니다.</p>
        {savedCount > 0 && <p className="hint">등록을 시작한 표의 열 연결은 고정됩니다. 오류 행을 고치려면 이 검토를 마친 뒤 수정한 행만 다시 가져오세요.</p>}
        <div className="ci-rows">{pageRows.items.map(row => {
          const saved = receipts[row.key], duplicates = candidates(row)
          return <article key={row.key} className={`ci-row${row.errors.length ? ' ci-error' : ''}${saved ? ' ci-saved' : ''}`} aria-label={`원본 ${row.line}행 ${row.title || '제목 없음'}`}><div className="ci-row-heading"><h4>{row.title || '(제목 없음)'}</h4><span className="ci-source-id">원본 {row.line}행{row.sourceId ? ` · ID ${row.sourceId}` : ''}</span></div>
            {row.errors.length > 0 ? <><strong>등록 전에 원본을 고쳐 주세요</strong><ul>{row.errors.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : row.draft && <><p>{row.draft.startDate} ~ {row.draft.endDate} · {row.draft.allDay ? '종일' : `${row.draft.startTime}–${row.draft.endTime}`}{row.draft.location ? ` · ${row.draft.location}` : ''}</p>{row.draft.description && <p className="description">{row.draft.description}</p>}</>}
            {saved ? <p role="status">등록 완료 · {saved.title} · 원본 v{saved.version}</p> : row.draft && !row.errors.length && <>{pendingRow?.key === row.key && <p role="status">저장 결과 확인 대기</p>}{duplicates.length > 0 && <div className="ci-warning"><p>같은 제목·날짜·시간의 열람 가능한 일정이 {duplicates.length}개 있습니다. 기존 일정에서 먼저 확인해 주세요.</p><ul>{duplicates.map(event => <li key={event.id}>{event.title} · {event.location || '장소 없음'} · v{event.version}</li>)}</ul><label className="check-label"><input type="checkbox" checked={Boolean(acknowledged[row.key])} disabled={locked || !comparisonReady} onChange={event => setAcknowledged({ ...acknowledged, [row.key]: event.target.checked })} />기존 일정과 별개의 새 일정임을 확인했습니다</label></div>}<div className="button-row"><button type="button" className="primary" disabled={locked || Boolean(recovery.request) || !comparisonReady || unconfirmedOmissions || duplicates.length > 0 && !acknowledged[row.key]} onClick={event => { if (unconfirmedOmissions || recovery.request) return; editorTrigger.current = event.currentTarget; setNotice(''); setSelected(row) }}>내용·공유 대상 확인</button></div></>}
          </article>
        })}</div><ListPagination label="가져올 일정 페이지" window={pageRows} disabled={locked} onPageChange={next => { setPage(next); setListFocus(value => value + 1) }} /></section>}
      </>}
    </div>
    {!closing && <footer className="dialog-footer"><p className="hint">{storageLabel ?? (demo ? '합성 자료 · 개발 저장소' : '현재 학교 서버에 저장')} · 표 검사만으로 저장되지 않습니다.</p><button type="button" className="secondary" disabled={locked} onClick={close}>검토 마치기</button></footer>}
  </dialog>{selected?.draft && <EventEditor key={selected.key} initialDraft={selected.draft} member={member} members={members} date={date} adapter={adapter} relationLabels={relationOptions} demo={demo} storageLabel={storageLabel} suspendLabel="입력창 접고 표 보기" onSuspend={() => { if (!recovery.request) return; setSuspended({ row: selected, requestKey: recovery.request.command.idempotencyKey }); setSelected(undefined); setNotice(`원본 ${selected.line}행의 저장 요청을 보관했습니다. 표에서 같은 요청을 다시 확인할 수 있습니다.`) }} onClose={() => { returnEditorFocus.current = true; setSelected(undefined); setSuspended(undefined) }} onSaved={event => { setReceipts(value => ({ ...value, [selected.key]: event })); setExisting(value => [...value.filter(row => row.id !== event.id), event]); setSelected(undefined); setSuspended(undefined); setNotice(`‘${event.title}’ 등록을 확인했습니다. 남은 행을 계속 검토할 수 있습니다.`); onSaved(event) }} />}</>
}
