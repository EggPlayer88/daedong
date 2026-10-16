import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { CLASS_KINDS, SCHOOL_TYPES, SETUP_LIMITS, setupGradeLimit, createSetupDraft, newSetupRowId, validateSetupDraft, parseSetupDraft, exportSetupDraft, exportSetupPlan, type SetupDraft } from './contract'
import { ListPagination } from '../app/ListPagination'
import { LIST_PAGE_SIZE, listWindow } from '../app/list-window'
import styles from './school-setup.css?inline'

type Issue = { path: string; message: string }
type Confirmation = { kind: 'import'; draft: SetupDraft; fileName: string } | { kind: 'clear' }
type RowGroup = 'terms' | 'departments' | 'classes'
type FieldOptions = { type?: 'text' | 'date'; numeric?: boolean; maxLength?: number; hint?: string }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const normalPath = (path: string) => path.replace(/\[(\d+)\]/g, '.$1')

// 이 화면의 초안은 현재 탭에만 둔다. 파일 내보내기와 운영 반영은 별개다.
export function SchoolSetupPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId()
  const root = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const operation = useRef(0)
  const editingBlocked = useRef(false)
  const latestDirtyCallback = useRef(onDirtyChange)
  latestDirtyCallback.current = onDirtyChange
  const [draft, setDraft] = useState<SetupDraft>(createSetupDraft)
  const [dirty, setDirty] = useState(false)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [issuePage, setIssuePage] = useState(0)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')
  const [reading, setReading] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [departmentPage, setDepartmentPage] = useState(0)
  const [classPage, setClassPage] = useState(0)
  const [focusRequest, setFocusRequest] = useState<{ path: string; serial: number }>()
  const focusSerial = useRef(0)
  const locked = reading || Boolean(confirmation)
  const departments = listWindow(draft.departments, departmentPage)
  const classes = listWindow(draft.classes, classPage)
  const validated = issues !== null && issues.length === 0
  const reviewIssues = listWindow(issues, issuePage)
  const issueMap = useMemo(() => {
    const result = new Map<string, (Issue & { index: number })[]>()
    issues?.forEach((issue, index) => { const path = normalPath(issue.path); result.set(path, [...(result.get(path) ?? []), { ...issue, index }]) })
    return result
  }, [issues])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; operation.current++; latestDirtyCallback.current?.(false) }
  }, [])
  useBrowserLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useBrowserLayoutEffect(() => {
    if (!focusRequest) return
    const target = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-setup-path]') ?? []).find(element => element.dataset.setupPath === focusRequest.path)
    target?.focus()
  }, [focusRequest, departmentPage, classPage, draft.departments.length, draft.classes.length])
  useEffect(() => {
    const element = dialog.current
    if (confirmation) { element?.showModal(); keepButton.current?.focus() }
    else element?.close()
    return () => element?.close()
  }, [confirmation])

  function focus(path: string) {
    const clean = normalPath(path)
    const row = /^(departments|classes)\.(\d+)/.exec(clean)
    if (row?.[1] === 'departments') setDepartmentPage(Math.floor(Number(row[2]) / LIST_PAGE_SIZE))
    if (row?.[1] === 'classes') setClassPage(Math.floor(Number(row[2]) / LIST_PAGE_SIZE))
    setFocusRequest({ path: clean, serial: ++focusSerial.current })
  }
  function change(update: (current: SetupDraft) => SetupDraft) {
    if (editingBlocked.current) return
    setDraft(update); setDirty(true); setIssues(null); setIssuePage(0); setNotice(''); setFailure('')
  }
  function changeField(key: keyof Omit<SetupDraft, 'terms' | 'departments' | 'classes'>, value: string) {
    change(current => ({ ...current, [key]: value }))
  }
  function changeRow(group: RowGroup, rowId: string, field: string, value: string) {
    change(current => ({ ...current, [group]: current[group].map(row => row.id === rowId ? { ...row, [field]: value } : row) }))
  }
  function addRow(group: RowGroup) {
    if (editingBlocked.current || draft[group].length >= SETUP_LIMITS[group]) return
    try {
      const rowId = newSetupRowId(), index = draft[group].length
      if (group === 'terms') change(current => ({ ...current, terms: [...current.terms, { id: rowId, termNo: '', name: '', startsOn: '', lastDay: '' }] }))
      else if (group === 'departments') change(current => ({ ...current, departments: [...current.departments, { id: rowId, name: '' }] }))
      else change(current => ({ ...current, classes: [...current.classes, { id: rowId, grade: '', classNo: '', name: '', kind: 'regular' }] }))
      focus(`${group}.${index}.${group === 'classes' ? 'grade' : group === 'terms' ? 'termNo' : 'name'}`)
    } catch { showFailure('새 항목을 만들지 못했습니다. 기존 입력은 유지했습니다.') }
  }
  function removeRow(group: RowGroup, rowId: string, index: number) {
    change(current => ({ ...current, [group]: current[group].filter(row => row.id !== rowId) }))
    const remaining = draft[group].length - 1
    if (remaining > 0) focus(`${group}.${Math.min(index, remaining - 1)}.${group === 'classes' ? 'grade' : group === 'terms' ? 'termNo' : 'name'}`)
    else focus(`add-${group}`)
  }
  function showFailure(message: string) { setFailure(message); setNotice(''); focus('failure') }
  function inspect() {
    if (editingBlocked.current) return
    try { setIssues(validateSetupDraft(draft)); setIssuePage(0); setFailure(''); setNotice(''); focus('review') }
    catch { showFailure('입력 내용을 검사하지 못했습니다. 현재 초안을 유지했습니다.') }
  }
  function download(kind: 'draft' | 'plan') {
    if (editingBlocked.current) return
    let url: string | undefined
    let anchor: HTMLAnchorElement | undefined
    try {
      if (kind === 'plan') {
        const nextIssues = validateSetupDraft(draft)
        setIssues(nextIssues); setIssuePage(0)
        if (nextIssues.length) { setNotice(''); focus('review'); return }
      }
      const text = kind === 'draft' ? exportSetupDraft(draft) : exportSetupPlan(draft)
      url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
      anchor = document.createElement('a'); anchor.href = url
      anchor.download = kind === 'draft' ? '학교초기설정_작성초안.json' : '학교초기설정_검토용계획.json'
      document.body.append(anchor); anchor.click(); anchor.remove()
      const releasedUrl = url
      window.setTimeout(() => URL.revokeObjectURL(releasedUrl), 1000)
      setFailure('')
      setNotice(kind === 'draft' ? '작성 초안 파일의 다운로드를 요청했습니다. 파일을 보관하면 이 화면에서 다시 불러올 수 있습니다. 학교 운영에는 반영되지 않았습니다.' : '검토용 계획 파일의 다운로드를 요청했습니다. 담당자 검토를 위한 파일이며 학교 운영에는 반영되지 않았습니다.')
      focus('notice')
    } catch (error) {
      anchor?.remove(); if (url) URL.revokeObjectURL(url)
      showFailure(error instanceof Error ? error.message : '파일을 내보내지 못했습니다. 현재 입력은 그대로 유지했습니다.')
    }
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || editingBlocked.current) return
    const token = ++operation.current
    if (file.size > SETUP_LIMITS.maxImportBytes) { showFailure(`파일은 ${Math.floor(SETUP_LIMITS.maxImportBytes / 1000).toLocaleString()}KB 이내로 선택해 주세요. 현재 입력은 유지했습니다.`); return }
    editingBlocked.current = true; setReading(true); setFailure(''); setNotice('')
    try {
      const text = await file.text()
      if (!alive.current || token !== operation.current) return
      const next = parseSetupDraft(text)
      setConfirmation({ kind: 'import', draft: next, fileName: file.name })
    } catch (error) {
      if (!alive.current || token !== operation.current) return
      editingBlocked.current = false
      showFailure(error instanceof Error ? error.message : '초안 파일을 읽지 못했습니다. 현재 입력은 유지했습니다.')
    } finally {
      if (alive.current && token === operation.current) setReading(false)
    }
  }
  function askClear() {
    if (editingBlocked.current) return
    editingBlocked.current = true; setConfirmation({ kind: 'clear' }); setFailure(''); setNotice('')
  }
  function cancelConfirmation() {
    const target = confirmation?.kind === 'clear' ? 'clear' : 'import'
    // 모달이 닫힌 뒤에만 바깥 입력으로 초점을 돌릴 수 있다.
    dialog.current?.close()
    editingBlocked.current = false; setConfirmation(undefined); focus(target)
  }
  function confirmReplacement() {
    if (!confirmation) return
    try {
      const incoming = confirmation.kind === 'import'
      const next = incoming ? confirmation.draft : createSetupDraft()
      operation.current++; setDraft(next); setDirty(incoming); setIssues(null); setIssuePage(0)
      setDepartmentPage(0); setClassPage(0); setFailure('')
      setNotice(incoming ? '초안 파일을 불러왔습니다. 내용을 검사한 뒤 검토용 계획을 내려받으세요. 학교 운영에는 반영되지 않았습니다.' : '현재 탭의 초안을 비웠습니다. 학교 운영 자료는 변경하지 않았으며 다른 메뉴로 이동할 수 있습니다.')
      dialog.current?.close()
      editingBlocked.current = false; setConfirmation(undefined); focus('notice')
    } catch { dialog.current?.close(); editingBlocked.current = false; setConfirmation(undefined); showFailure('초안을 바꾸지 못했습니다. 기존 입력은 유지했습니다.') }
  }

  function fieldId(path: string) { return `${id}-${normalPath(path).replace(/[^a-zA-Z0-9-]/g, '-')}` }
  function fieldIssues(path: string) { return issueMap.get(path) ?? [] }
  function errorText(path: string) { return fieldIssues(path).map(issue => <span className="setup-field-error" id={`${id}-issue-${issue.index}`} key={issue.index}>{issue.message}</span>) }
  function describedBy(path: string, hint?: string) {
    return [...(hint ? [`${fieldId(path)}-hint`] : []), ...fieldIssues(path).map(issue => `${id}-issue-${issue.index}`)].join(' ') || undefined
  }
  function field(path: string, label: string, value: string, onChange: (value: string) => void, options: FieldOptions = {}) {
    return <label className="setup-field" htmlFor={fieldId(path)}><span>{label}</span>
      <input id={fieldId(path)} aria-label={label} data-setup-path={path} value={value} onChange={event => onChange(event.target.value)} type={options.type ?? 'text'} inputMode={options.numeric ? 'numeric' : undefined} maxLength={options.maxLength} aria-invalid={fieldIssues(path).length ? true : undefined} aria-describedby={describedBy(path, options.hint)} />
      {options.hint && <small id={`${fieldId(path)}-hint`}>{options.hint}</small>}{errorText(path)}
    </label>
  }
  function select(path: string, label: string, value: string, onChange: (value: string) => void, choices: readonly { value: string; label: string }[], placeholder = '선택해 주세요') {
    return <label className="setup-field" htmlFor={fieldId(path)}><span>{label}</span>
      <select id={fieldId(path)} aria-label={label} data-setup-path={path} value={value} onChange={event => onChange(event.target.value)} aria-invalid={fieldIssues(path).length ? true : undefined} aria-describedby={describedBy(path)}>
        <option value="">{placeholder}</option>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>{errorText(path)}
    </label>
  }

  return <section ref={root} className="school-setup" tabIndex={-1} data-setup-path="draft" aria-labelledby={`${id}-heading`}>
    <style>{styles}</style>
    <header className="setup-header"><div><p className="setup-eyebrow">학교 운영 준비</p><h1 id={`${id}-heading`}>학교 초기 설정 준비</h1><p>학교의 기본 정보와 학기·조직을 정리하고, 검토할 파일을 만듭니다.</p></div><span className="setup-badge">운영 미반영</span></header>
    <div className="setup-scope"><strong>현재 탭에만 보관합니다.</strong><span>새로고침하거나 탭을 닫으면 입력이 사라집니다. 이어서 작성하려면 초안 파일을 내려받으세요.</span></div>
    <div className="setup-file-bar"><div><button type="button" className="setup-button" data-setup-path="import" disabled={locked} onClick={() => fileInput.current?.click()}>초안 파일 불러오기</button><button type="button" className="setup-button" disabled={locked} onClick={() => download('draft')}>작성 초안 내려받기</button></div><button type="button" className="setup-text-button" data-setup-path="clear" disabled={locked || !dirty} onClick={askClear}>현재 초안 비우기</button></div>
    <input className="setup-file-input" ref={fileInput} type="file" accept=".json,application/json" aria-label="작성 초안 파일 선택" onChange={importFile} disabled={locked} />
    <p className="setup-file-help">작성 초안은 빈칸이 있어도 보관할 수 있습니다. 검토용 계획 파일은 내용 검사를 통과한 뒤 만들며, 다시 불러오는 용도가 아닙니다.</p>
    {reading && <p className="setup-notice" role="status">초안 파일을 확인하는 중입니다. 입력은 잠시 그대로 보관합니다.</p>}
    {failure && <p className="setup-error" role="alert" tabIndex={-1} data-setup-path="failure">{failure}</p>}
    {notice && <p className="setup-notice" role="status" tabIndex={-1} data-setup-path="notice">{notice}</p>}

    <form noValidate onSubmit={event => { event.preventDefault(); inspect() }}>
      <fieldset className="setup-fields" disabled={locked}><legend className="setup-sr-only">학교 초기 설정 입력</legend>
        <section className="setup-section" aria-labelledby={`${id}-school`}><header><div><p className="setup-step">01</p><h2 id={`${id}-school`}>학교 기본 정보</h2></div></header>
          <div className="setup-grid">
            {field('schoolName', '학교명', draft.schoolName, value => changeField('schoolName', value), { maxLength: SETUP_LIMITS.schoolName })}
            {field('schoolCode', '학교 구분 코드', draft.schoolCode, value => changeField('schoolCode', value), { maxLength: SETUP_LIMITS.schoolCode, hint: '영문·숫자·밑줄·하이픈 2~40자. NEIS 코드가 아니며 중복 여부는 운영 연결 시 확인합니다.' })}
            {select('schoolType', '학교급', draft.schoolType, value => changeField('schoolType', value), SCHOOL_TYPES)}
            {field('gradeCount', '운영 학년 수', draft.gradeCount, value => changeField('gradeCount', value), { numeric: true, maxLength: 2, hint: `선택한 학교급의 1~${setupGradeLimit(draft.schoolType)} 범위입니다. 특수·기타 학교는 실제 운영 체계를 확인해 입력합니다.` })}
          </div>
        </section>
        <section className="setup-section" aria-labelledby={`${id}-year`}><header><div><p className="setup-step">02</p><h2 id={`${id}-year`}>학년도와 학기</h2></div></header>
          <p className="setup-section-help">마지막 날은 해당 날짜까지 포함합니다. 검토용 파일의 기간은 종료일 미포함 방식으로 변환합니다.</p>
          <div className="setup-grid setup-year-grid">
            {field('schoolYear', '학년도', draft.schoolYear, value => changeField('schoolYear', value), { numeric: true, maxLength: 4, hint: '예: 2026' })}
            {field('startsOn', '학년도 시작일', draft.startsOn, value => changeField('startsOn', value), { type: 'date' })}
            {field('lastDay', '학년도 마지막 날 (포함)', draft.lastDay, value => changeField('lastDay', value), { type: 'date' })}
          </div>
          <div className="setup-subheading"><h3 tabIndex={-1} data-setup-path="terms">학기 <span>{draft.terms.length}개</span></h3><button type="button" className="setup-button" data-setup-path="add-terms" disabled={draft.terms.length >= SETUP_LIMITS.terms} onClick={() => addRow('terms')}>학기 추가</button></div>
          {!draft.terms.length && <p className="setup-empty">운영할 학기를 추가해 주세요. 최대 {SETUP_LIMITS.terms}개까지 입력할 수 있습니다.</p>}
          <div className="setup-row-list">{draft.terms.map((term, index) => <fieldset className="setup-row" key={term.id}><legend>학기 {index + 1}</legend><div className="setup-row-fields setup-term-row">
            {field(`terms.${index}.termNo`, '학기 번호', term.termNo, value => changeRow('terms', term.id, 'termNo', value), { numeric: true, maxLength: 1 })}
            {field(`terms.${index}.name`, '학기 이름', term.name, value => changeRow('terms', term.id, 'name', value), { maxLength: SETUP_LIMITS.termName })}
            {field(`terms.${index}.startsOn`, '학기 시작일', term.startsOn, value => changeRow('terms', term.id, 'startsOn', value), { type: 'date' })}
            {field(`terms.${index}.lastDay`, '학기 마지막 날 (포함)', term.lastDay, value => changeRow('terms', term.id, 'lastDay', value), { type: 'date' })}
          </div><button type="button" className="setup-remove" aria-label={`학기 ${index + 1} 삭제`} onClick={() => removeRow('terms', term.id, index)}>삭제</button></fieldset>)}</div>
        </section>
        <section className="setup-section" aria-labelledby={`${id}-departments`}><header><div><p className="setup-step">03</p><h2 id={`${id}-departments`} tabIndex={-1} data-setup-path="departments">부서 구성 <span>{draft.departments.length}개</span></h2></div><button type="button" className="setup-button" data-setup-path="add-departments" disabled={draft.departments.length >= SETUP_LIMITS.departments} onClick={() => addRow('departments')}>부서 추가</button></header>
          <p className="setup-section-help">부서 이름만 준비합니다. 교사 배정과 권한은 설정하지 않습니다.</p>
          {!draft.departments.length && <p className="setup-empty">필요한 부서를 추가해 주세요. 최대 {SETUP_LIMITS.departments}개까지 입력할 수 있습니다.</p>}
          <div className="setup-row-list">{departments.items.map((department, offset) => { const index = departments.start - 1 + offset; return <fieldset className="setup-row setup-department-row" key={department.id}><legend>부서 {index + 1}</legend>
            {field(`departments.${index}.name`, '부서 이름', department.name, value => changeRow('departments', department.id, 'name', value), { maxLength: SETUP_LIMITS.departmentName })}
            <button type="button" className="setup-remove" aria-label={`부서 ${index + 1} 삭제`} onClick={() => removeRow('departments', department.id, index)}>삭제</button>
          </fieldset> })}</div>
          <ListPagination label="부서 목록 페이지" window={departments} disabled={locked} onPageChange={page => { setDepartmentPage(page); focus('departments') }} />
        </section>
        <section className="setup-section" aria-labelledby={`${id}-classes`}><header><div><p className="setup-step">04</p><h2 id={`${id}-classes`} tabIndex={-1} data-setup-path="classes">학급 구성 <span>{draft.classes.length}개</span></h2></div><button type="button" className="setup-button" data-setup-path="add-classes" disabled={draft.classes.length >= SETUP_LIMITS.classes} onClick={() => addRow('classes')}>학급 추가</button></header>
          <p className="setup-section-help">담임·학생 명부를 넣지 않고 학급의 구성만 준비합니다. 반 번호는 필요한 경우 입력합니다.</p>
          {!draft.classes.length && <p className="setup-empty">운영할 학급을 추가해 주세요. 최대 {SETUP_LIMITS.classes.toLocaleString()}개까지 입력할 수 있습니다.</p>}
          <div className="setup-row-list">{classes.items.map((schoolClass, offset) => { const index = classes.start - 1 + offset; return <fieldset className="setup-row" key={schoolClass.id}><legend>학급 {index + 1}</legend><div className="setup-row-fields setup-class-row">
            {field(`classes.${index}.grade`, '학년', schoolClass.grade, value => changeRow('classes', schoolClass.id, 'grade', value), { numeric: true, maxLength: 2 })}
            {field(`classes.${index}.classNo`, '반 번호 (선택)', schoolClass.classNo, value => changeRow('classes', schoolClass.id, 'classNo', value), { numeric: true, maxLength: 2 })}
            {field(`classes.${index}.name`, '학급 이름', schoolClass.name, value => changeRow('classes', schoolClass.id, 'name', value), { maxLength: SETUP_LIMITS.className })}
            {select(`classes.${index}.kind`, '학급 유형', schoolClass.kind, value => changeRow('classes', schoolClass.id, 'kind', value), CLASS_KINDS)}
          </div><button type="button" className="setup-remove" aria-label={`학급 ${index + 1} 삭제`} onClick={() => removeRow('classes', schoolClass.id, index)}>삭제</button></fieldset> })}</div>
          <ListPagination label="학급 목록 페이지" window={classes} disabled={locked} onPageChange={page => { setClassPage(page); focus('classes') }} />
        </section>
        <div className="setup-check-bar"><p>입력한 내용을 검사한 뒤 검토용 계획을 만들 수 있습니다.</p><button type="submit" className="setup-primary">입력 내용 검사</button></div>
      </fieldset>
    </form>
    {issues !== null && <section className={`setup-review${validated ? ' setup-review-ready' : ''}`} tabIndex={-1} data-setup-path="review" aria-labelledby={`${id}-review`}>
      <h2 id={`${id}-review`}>{validated ? '검토할 준비가 되었습니다' : '입력 내용을 확인해 주세요'}</h2>
      {issues.length ? <><p role="alert">확인할 항목이 {issues.length.toLocaleString()}개 있습니다. 항목을 선택하면 해당 입력으로 이동합니다.</p><ul>{reviewIssues.items.map((issue, index) => <li key={`${issue.path}:${reviewIssues.start + index}`}><button type="button" className="setup-issue-link" disabled={locked} onClick={() => focus(issue.path)}>{issue.message}</button></li>)}</ul><ListPagination label="입력 오류 목록 페이지" window={reviewIssues} disabled={locked} onPageChange={page => { setIssuePage(page); focus('review') }} /></> : <>
        <p role="status">입력 형식과 구성 검사를 통과했습니다. 학교 운영에 적용된 상태는 아닙니다.</p>
        <dl className="setup-summary"><div><dt>학교</dt><dd>{draft.schoolName} · {SCHOOL_TYPES.find(type => type.value === draft.schoolType)?.label}</dd></div><div><dt>학년도</dt><dd>{draft.schoolYear}학년도 · {draft.startsOn} ~ {draft.lastDay} (마지막 날 포함)</dd></div><div><dt>구성</dt><dd>학기 {draft.terms.length}개 · 부서 {draft.departments.length}개 · 학급 {draft.classes.length.toLocaleString()}개</dd></div></dl>
        <p className="setup-review-help">검토용 계획은 DB 구축 담당자에게 전달할 참고 자료입니다. 학교 개설·회원 배정·권한 부여·운영 활성화는 별도 확인과 작업이 필요합니다.</p>
        <button type="button" className="setup-primary" disabled={locked} onClick={() => download('plan')}>검토용 계획 내려받기</button>
      </>}
    </section>}

    <dialog ref={dialog} className="setup-confirm" aria-labelledby={confirmation ? `${id}-confirm-title` : undefined} aria-describedby={confirmation ? `${id}-confirm-detail` : undefined} onCancel={event => { event.preventDefault(); cancelConfirmation() }}>
      {confirmation && <><h2 id={`${id}-confirm-title`}>{confirmation.kind === 'clear' ? '현재 초안을 비울까요?' : '현재 초안을 바꿀까요?'}</h2><p id={`${id}-confirm-detail`}>{confirmation.kind === 'clear' ? '현재 탭에 입력한 내용이 사라집니다. 필요하면 취소하고 작성 초안 파일을 먼저 내려받으세요. 학교 운영 자료는 변경하지 않습니다.' : '파일 형식을 확인했습니다. 불러온 초안으로 바꾸면 현재 탭의 입력을 대체합니다. 취소하면 지금 입력은 그대로 남습니다.'}</p>
        {confirmation.kind === 'import' && <div className="setup-import-summary"><strong>{confirmation.draft.schoolName || '학교명 미입력'}</strong><span>{confirmation.fileName}</span><span>학기 {confirmation.draft.terms.length}개 · 부서 {confirmation.draft.departments.length}개 · 학급 {confirmation.draft.classes.length}개</span><small>내용 검사는 바꾼 뒤 다시 진행합니다. 운영 반영은 하지 않습니다.</small></div>}
        <div className="setup-confirm-actions"><button ref={keepButton} type="button" className="setup-button" onClick={cancelConfirmation}>현재 초안 유지</button><button type="button" className="setup-primary" onClick={confirmReplacement}>{confirmation.kind === 'clear' ? '초안 비우기' : '불러온 초안으로 바꾸기'}</button></div>
      </>}
    </dialog>
  </section>
}
