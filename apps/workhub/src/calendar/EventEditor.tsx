import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ContractError, type AudienceGroup, type CalendarEvent, type EventDraft, type Membership, type SaveCommand } from '../contracts'
import { activeAt, canEdit, canRead, matchesAudience, normalizeDraft, recommendationReason } from '../domain'
import type { CalendarAdapter, RelationOptions } from './contracts'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { eventTime, visibilityLabels } from './formatting'

// 기존 일정 화면·미리보기 import 경로를 유지한다. 순수 조회 계층은 formatting을 직접 사용한다.
export { dateLabel, eventTime, visibilityLabels } from './formatting'

export interface EventEditorSnapshot { original?: CalendarEvent; draft: EventDraft; version?: number; initialValue: string; conflict?: CalendarEvent }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const noRelations: RelationOptions = { departmentIds: [], gradeIds: [], subjectIds: [] }

export type Adapter = CalendarAdapter
const emptyGroup = (): AudienceGroup => ({ departmentIds: [], gradeIds: [], subjectIds: [] })
const blank = (date: string): EventDraft => ({ title: '', description: '', location: '', startDate: date, endDate: date, allDay: false, startTime: '15:30', endTime: '16:30', visibility: 'school', audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] } })
function audienceLabel(event: EventDraft, members: Membership[], relationLabels: RelationOptions) {
  const groups = event.audience.groups.map(group => (['departmentIds', 'gradeIds', 'subjectIds'] as const).map(field => group[field].map(id => relationLabels[field].find(item => item.id === id)?.name ?? '알 수 없는 조건').join(' 또는 ')).filter(Boolean).join(' + ')).filter(Boolean).join(' / 또는 / ')
  const names = (ids: string[]) => ids.map(id => members.find(item => item.id === id)?.name ?? '알 수 없는 교사').join(', ') || '없음'
  return `${event.audience.all ? '모든 교사' : groups || '직접 포함 교사만'} · 직접 포함: ${names(event.audience.includeMemberIds)} · 제외: ${names(event.audience.excludeMemberIds)}`
}

export function EventEditor({ original: providedOriginal, initialDraft, draftSlot = 'calendar-editor', member, members, date, adapter, onClose, onSaved, onDiscard, onSuspend, suspendLabel = '입력창 접고 목록 보기', onNavigationLockChange, relationLabels = noRelations, demo = false, storageLabel = '학교 서버에 저장' }: {
  original?: CalendarEvent; initialDraft?: EventDraft; draftSlot?: string; member: Membership; members: Membership[]; date: string; adapter: Adapter; onClose: () => void; onSaved: (event: CalendarEvent) => void; onDiscard?: () => void; onSuspend?: () => void; suspendLabel?: string; onNavigationLockChange?: (locked: boolean) => void; relationLabels?: RelationOptions; demo?: boolean; storageLabel?: string
}) {
  const recovery = usePendingRequest(member, 'calendar')
  const [restored] = useState(() => recovery.request)
  const editMemory = useEditDraft<EventEditorSnapshot>(member, draftSlot)
  const [savedDraft] = useState(() => restored ? undefined : editMemory.initial)
  const original = restored ? restored.original : savedDraft ? savedDraft.original : providedOriginal
  const retiredDraft = useRef(false)
  const [restoreState, setRestoreState] = useState<'checking' | 'ready' | 'retry' | 'denied'>(savedDraft?.original ? 'checking' : 'ready')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [restoreError, setRestoreError] = useState('')
  const [draft, setDraft] = useState<EventDraft>(() => restored ? structuredClone(restored.command.draft) : savedDraft ? structuredClone(savedDraft.draft) : original || initialDraft ? structuredClone(original ?? initialDraft!) : blank(date))
  const [version, setVersion] = useState(savedDraft?.version ?? original?.version)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState<CalendarEvent | undefined>(savedDraft?.conflict)
  const [pending, setPending] = useState<SaveCommand | undefined>(restored?.command)
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const titleInput = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const saveRequest = useRef<{ payload: string; key: string }>()
  const errorRef = useRef<HTMLDivElement>(null)
  const initialValue = useRef(savedDraft?.initialValue ?? JSON.stringify(draft))
  const dirty = Boolean(initialDraft) || JSON.stringify(draft) !== initialValue.current
  useBrowserLayoutEffect(() => {
    if (retiredDraft.current) return
    editMemory.save({ original, draft, version, initialValue: initialValue.current, conflict }, dirty || saving || Boolean(conflict))
  })
  useEffect(() => {
    if (!savedDraft?.original) return
    let current = true
    setRestoreState('checking'); setRestoreError('')
    void adapter.get(member.id, savedDraft.original.id).then(latest => {
      if (!current) return
      if (!latest || latest.id !== savedDraft.original!.id || latest.schoolId !== member.schoolId || !Number.isSafeInteger(latest.version) || latest.version < 1) throw new Error('일정 원본의 응답을 확인하지 못했습니다.')
      normalizeDraft(latest, member, members)
      if (!canEdit(latest, member, date)) throw new ContractError('FORBIDDEN', '현재 원본을 수정할 수 없습니다.')
      // 최신 원본의 버전을 입력에 덮어쓰지 않는다. 저장 시 충돌 검사를 유지한다.
      if (savedDraft.conflict) setConflict(latest)
      setRestoreState('ready'); setNotice('연결을 다시 확인했습니다. 저장하지 않은 입력을 복원했습니다.')
    }).catch(failure => {
      if (!current) return
      if (failure instanceof ContractError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(failure.code)) {
        retiredDraft.current = true; editMemory.remove(); onDiscard?.(); setRestoreState('denied')
        setRestoreError('이전 일정의 수정 권한을 확인할 수 없어 보관한 입력을 폐기했습니다. 목록에서 다시 확인해 주세요.')
      } else { setRestoreState('retry'); setRestoreError('일정 원본을 다시 확인하지 못했습니다. 보관한 입력을 표시하지 않고 유지합니다. 다시 확인해 주세요.') }
    })
    return () => { current = false }
  }, [adapter, member.id, restoreAttempt])
  function closeEditor() { retiredDraft.current = true; editMemory.remove(); onClose() }
  useEffect(() => {
    onNavigationLockChange?.(dirty || saving || Boolean(pending) || Boolean(conflict))
    return () => onNavigationLockChange?.(false)
  }, [dirty, saving, Boolean(pending), Boolean(conflict), onNavigationLockChange])
  useEffect(() => {
    alive.current = true
    const element = dialog.current
    const root = element?.getRootNode()
    const previouslyFocused = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null
    element?.showModal()
    titleInput.current?.focus()
    return () => { alive.current = false; element?.close(); if (previouslyFocused?.isConnected) previouslyFocused.focus() }
  }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => { if (savedDraft && restoreState === 'ready') titleInput.current?.focus() }, [restoreState])
  function change<K extends keyof EventDraft>(key: K, value: EventDraft[K]) { setDraft(current => ({ ...current, [key]: value })); setError('') }
  const schoolMembers = members.filter(item => item.schoolId === member.schoolId)
  const previewEvent: CalendarEvent = { ...draft, id: original?.id ?? 'preview-unsaved', schoolId: member.schoolId, authorMemberId: original?.authorMemberId ?? member.id, version: version ?? 0, updatedAt: '' }
  const targetDate = draft.startDate > date ? draft.startDate : date
  const targetMembers = schoolMembers.filter(item => matchesAudience(draft.audience, item, targetDate))
  const readMembers = schoolMembers.filter(item => canRead(previewEvent, item, date))
  const homeMembers = readMembers.filter(item => recommendationReason(previewEvent, item, date) !== null)
  function setMemberList(field: 'includeMemberIds' | 'excludeMemberIds', id: string, checked: boolean) {
    change('audience', { ...draft.audience, [field]: checked ? [...draft.audience[field], id] : draft.audience[field].filter(value => value !== id) })
  }
  function groupValue(index: number, field: keyof AudienceGroup, id: string, checked: boolean) {
    change('audience', { ...draft.audience, groups: draft.audience.groups.map((group, i) => i !== index ? group : { ...group, [field]: checked ? [...group[field], id] : group[field].filter(value => value !== id) }) })
  }
  async function perform(command: SaveCommand) {
    if (inFlight.current || conflict || restoreState !== 'ready') return
    inFlight.current = true; recovery.put({ command, original }); setSaving(true); setError('')
    try {
      const result = await adapter.save(member.id, command)
      if (alive.current) { retiredDraft.current = true; editMemory.remove(); recovery.remove(command.idempotencyKey); setPending(undefined); onSaved(result) }
    } catch (failure) {
      if (!alive.current) return
      if (failure instanceof ContractError && ['INVALID_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CONFLICT'].includes(failure.code)) {
        recovery.remove(command.idempotencyKey); setPending(undefined)
        if (failure.code === 'CONFLICT') setConflict(failure.current)
        if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(failure.code)) { retiredDraft.current = true; editMemory.remove(); onDiscard?.(); setRestoreState('denied'); setRestoreError('현재 일정의 수정 권한을 확인할 수 없어 보관한 입력을 폐기했습니다.') }
      } else {
        // 응답만 사라진 경우 새 요청을 만들면 중복될 수 있어 원래 명령을 고정한다.
        setPending(command)
      }
      setError(failure instanceof Error ? failure.message : '저장 중 오류가 발생했습니다. 입력은 유지했습니다.')
    } finally { inFlight.current = false; if (alive.current) setSaving(false) }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    if (pending || inFlight.current || conflict) return
    const payload = JSON.stringify({ draft, id: original?.id, expectedVersion: version })
    if (saveRequest.current?.payload !== payload) saveRequest.current = { payload, key: crypto.randomUUID() }
    void perform({ draft: structuredClone(draft), id: original?.id, expectedVersion: version, idempotencyKey: saveRequest.current.key })
  }
  if (restoreState !== 'ready') return <dialog ref={dialog} className="editor-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); closeEditor() }}><header className="dialog-header"><h2 id={`${id}-title`}>보관한 일정 입력 확인</h2><button type="button" className="icon-button" aria-label="일정 편집 닫기" onClick={closeEditor}>✕</button></header><div className="dialog-body"><p role={restoreState === 'checking' ? 'status' : 'alert'}>{restoreState === 'checking' ? '현재 일정의 수정 권한을 다시 확인하는 중…' : restoreError}</p>{restoreState === 'retry' && <button type="button" className="primary" onClick={() => setRestoreAttempt(value => value + 1)}>원본 다시 확인</button>}<button type="button" className="secondary" onClick={closeEditor}>{restoreState === 'denied' ? '닫기' : '보관한 입력 폐기'}</button></div></dialog>
  return <dialog ref={dialog} className="editor-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!saving && !pending) closeEditor() }}>
    <form onSubmit={save} aria-labelledby={`${id}-title`} aria-describedby={error ? `${id}-error` : undefined}>
      <header className="dialog-header"><div><p className="eyebrow">학교 일정 · {original ? `원본 v${version}` : '새 일정'}</p><h2 id={`${id}-title`}>{original ? '일정 수정' : '일정 등록'}</h2></div><button type="button" className="icon-button" aria-label="일정 편집 닫기" disabled={saving || Boolean(pending)} onClick={closeEditor}>✕</button></header>
      <div className="dialog-body">
        <p className="subtle-note">{demo ? '합성 자료로 등록 흐름을 확인합니다. 실제 학교나 학생의 개인정보는 입력하지 마세요.' : '현재 선택한 학교의 일정입니다. 저장된 변경은 같은 학교의 열람 대상에게 반영됩니다.'}</p>
        {error && <div ref={errorRef} id={`${id}-error`} className="error-box" role="alert" tabIndex={-1}>{error}</div>}
        {notice && <p className="notice-box" role="status">{notice}</p>}
        {pending && <section className="notice-box" aria-label="일정 저장 결과 확인 필요"><h3>먼저 이전 저장 결과를 확인해 주세요</h3><p>저장이 처리된 뒤 응답만 끊겼을 수 있습니다. 중복 등록을 막기 위해 입력과 요청 번호를 유지합니다.</p><button type="button" className="primary" disabled={saving} onClick={() => { void perform(pending) }}>같은 요청으로 저장 결과 확인</button>{onSuspend && <><p>현재 탭에서 요청을 보관하고 목록을 볼 수 있습니다. 새로고침하면 복구 정보가 사라집니다.</p><button type="button" className="secondary" disabled={saving} onClick={onSuspend}>{suspendLabel}</button></>}</section>}
        {conflict && <section className="conflict-box" aria-labelledby={`${id}-conflict`}><h3 id={`${id}-conflict`}>원본이 v{conflict.version}으로 바뀌었습니다</h3><p>다른 교사가 저장한 제목: <strong>{conflict.title}</strong></p><p>현재 원본: {conflict.startDate} ~ {conflict.endDate}, {eventTime(conflict)} / {visibilityLabels[conflict.visibility]}</p><p>내 입력은 아래에 그대로 남아 있습니다. 현재 원본을 확인한 뒤 다시 저장해 주세요.</p><details><summary>현재 원본의 전체 내용 확인</summary><dl className="event-detail"><div><dt>장소</dt><dd>{conflict.location || '장소 미지정'}</dd></div><div><dt>안내</dt><dd className="description">{conflict.description || '등록된 안내 없음'}</dd></div><div><dt>관련 대상</dt><dd>{audienceLabel(conflict, members, relationLabels)}</dd></div></dl></details><div className="button-row"><button type="button" className="secondary" onClick={() => { setVersion(conflict.version); setConflict(undefined); setError(''); setNotice('변경된 원본을 확인했습니다. 내 입력으로 바꾸려면 다시 저장해 주세요.') }}>변경 확인 · 내 입력 유지</button><button type="button" className="text-button" onClick={() => { setDraft(structuredClone(conflict)); setVersion(conflict.version); setConflict(undefined); setError(''); setNotice('현재 원본을 불러왔습니다. 이전 입력은 이 양식에서 대체되었습니다.') }}>현재 원본으로 입력 바꾸기</button></div></section>}
        <fieldset disabled={saving || Boolean(pending)} className="form-fields"><legend className="sr-only">일정 기본 정보</legend>
          <label>일정 제목 <span className="required">필수</span><input ref={titleInput} name="title" required maxLength={100} value={draft.title} placeholder="예: 2학년 체험학습 준비 협의" onChange={event => change('title', event.target.value)} /></label>
          <div className="form-grid"><label>시작일 <span className="required">필수</span><input name="startDate" required type="date" value={draft.startDate} onChange={event => { const startDate = event.target.value; setDraft(current => ({ ...current, startDate, endDate: current.endDate < startDate ? startDate : current.endDate })) }} /></label><label>종료일 <span className="required">필수</span><input name="endDate" required type="date" min={draft.startDate} value={draft.endDate} onChange={event => change('endDate', event.target.value)} /></label></div>
          <label className="check-label"><input type="checkbox" checked={draft.allDay} onChange={event => change('allDay', event.target.checked)} />종일 일정</label>
          {!draft.allDay && <div className="form-grid"><label>시작 시간<input required type="time" value={draft.startTime} onChange={event => change('startTime', event.target.value)} /></label><label>종료 시간<input required type="time" value={draft.endTime} onChange={event => change('endTime', event.target.value)} /></label></div>}
          <label>장소<input maxLength={100} value={draft.location} placeholder="예: 2학년 연구실" onChange={event => change('location', event.target.value)} /></label>
          <label>안내 내용<textarea rows={3} maxLength={2000} value={draft.description} placeholder="함께 알아야 할 준비 사항을 적어 주세요." onChange={event => change('description', event.target.value)} /></label>
          <label>누가 원본을 볼 수 있나요?<select value={draft.visibility} onChange={event => change('visibility', event.target.value as EventDraft['visibility'])}><option value="school">학교 교사 전체</option><option value="audience">관련 대상만</option><option value="private" disabled={Boolean(original && original.authorMemberId !== member.id)}>나만 보기</option></select></label>
          <section className="audience-section" aria-labelledby={`${id}-audience`}><h3 id={`${id}-audience`}>누구의 홈에 필요한 일정인가요?</h3><p className="muted">열람 범위와 추천 대상은 다릅니다. 학교 전체가 읽을 수 있어도 관련 교사에게만 추천할 수 있습니다.</p>
            <label className="check-label"><input type="checkbox" checked={draft.audience.all} onChange={event => change('audience', { ...draft.audience, all: event.target.checked, groups: !event.target.checked && !draft.audience.groups.length ? [emptyGroup()] : draft.audience.groups })} />모든 교사와 관련 있는 일정</label>
            {!draft.audience.all && <><p className="hint">한 조건 안에서 부서·학년·교과는 모두 일치해야 합니다. 같은 항목의 여러 값 또는 서로 다른 조건은 하나만 맞아도 포함됩니다.</p>{draft.audience.groups.map((group, index) => <fieldset className="audience-group" key={index}><legend>관련 조건 {index + 1}{index > 0 ? ' · 또는' : ''}</legend>{(['departmentIds', 'gradeIds', 'subjectIds'] as const).map(field => <div className="check-row" key={field}><span className="group-label">{field === 'departmentIds' ? '부서' : field === 'gradeIds' ? '학년' : '교과'}</span>{relationLabels[field].map(option => <label className="check-label" key={option.id}><input type="checkbox" checked={group[field].includes(option.id)} onChange={event => groupValue(index, field, option.id, event.target.checked)} />{option.name}</label>)}</div>)}<button className="text-button" type="button" onClick={() => change('audience', { ...draft.audience, groups: draft.audience.groups.filter((_, i) => i !== index) })}>조건 {index + 1} 삭제</button></fieldset>)}<button type="button" className="secondary small" onClick={() => change('audience', { ...draft.audience, groups: [...draft.audience.groups, emptyGroup()] })}>+ 관련 조건 추가 (또는)</button></>}
            <details className="individual-targets"><summary>교사 직접 포함·제외</summary><p className="hint">직접 포함은 조건에 추가됩니다. 제외는 모든 조건과 직접 포함보다 우선합니다.</p>{schoolMembers.filter(item => activeAt(item, date)).map(item => <div className="member-target" key={item.id}><span>{item.name}</span><label className="check-label"><input type="checkbox" aria-label={`${item.name} 직접 포함`} checked={draft.audience.includeMemberIds.includes(item.id)} onChange={event => setMemberList('includeMemberIds', item.id, event.target.checked)} />포함</label><label className="check-label"><input type="checkbox" aria-label={`${item.name} 제외`} checked={draft.audience.excludeMemberIds.includes(item.id)} onChange={event => setMemberList('excludeMemberIds', item.id, event.target.checked)} />제외</label></div>)}</details>
          </section>
        </fieldset>
        <section className="audience-preview" aria-labelledby={`${id}-preview`}><h3 id={`${id}-preview`}>대상 미리보기</h3><dl><div><dt>관련 대상 · {targetDate} 기준</dt><dd>{targetMembers.length}명 <span>{targetMembers.map(item => item.name).join(', ') || '해당 없음'}</span></dd></div><div><dt>원본 열람 · 현재 기준일 기준</dt><dd>{readMembers.length}명 <span>{readMembers.map(item => item.name).join(', ') || '해당 없음'}</span></dd></div><div><dt>홈 추천 후보 · 열람 가능한 교사 중</dt><dd>{homeMembers.length}명 <span>{homeMembers.map(item => item.name).join(', ') || '해당 없음'}</span></dd></div></dl><p className="hint">진행 중인 일정은 현재 기준일, 미래 일정은 시작일의 소속 관계로 추천합니다. 작성자는 본인 일정을 확인하며 지난 일정은 홈에 나타나지 않습니다.</p></section>
        {demo && original && adapter.simulateConcurrentEdit && adapter.failNextSave && <details className="developer-inline"><summary>개발 시험 · 동시 수정 / 저장 실패</summary><div className="button-row"><button type="button" className="secondary small" disabled={saving || Boolean(pending)} onClick={() => { try { adapter.simulateConcurrentEdit?.(member.id, original.id); setNotice('가상 원본을 다른 교사가 수정했습니다. 저장을 눌러 충돌과 입력 보존을 확인하세요.') } catch (failure) { setError((failure as Error).message) } }}>다른 교사 수정 발생</button><button type="button" className="secondary small" disabled={saving || Boolean(pending)} onClick={() => { adapter.failNextSave?.(); setNotice('다음 저장이 한 번 실패합니다. 입력을 유지한 재시도를 확인하세요.') }}>다음 저장 실패</button></div></details>}
      </div>
      <footer className="dialog-footer"><p className="hint">{original ? `확인한 원본 v${version} · ${storageLabel}` : storageLabel}</p><div className="button-row"><button type="button" className="secondary" disabled={saving || Boolean(pending)} onClick={closeEditor}>취소</button><button className="primary" type="submit" disabled={saving || Boolean(pending) || Boolean(conflict)}>{saving ? '저장 중…' : original ? '수정 저장' : '일정 등록'}</button></div></footer>
    </form>
  </dialog>
}
