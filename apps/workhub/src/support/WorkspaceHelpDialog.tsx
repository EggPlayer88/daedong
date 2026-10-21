import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceHelpProps } from './WorkspaceHelp'
import { findGuides, guidePageTitle, workspaceGuides } from './catalog'
import { checkCodes, checkModules, createModuleChecker, exportModuleChecks, type CheckCode, type CheckId, type ModuleCheck } from './module-checks'
import styles from './help.css?inline'

type HelpTab = 'guide' | 'checks'
type CheckFilter = 'all' | 'attention' | 'unchecked'
function checkGroup(result: ModuleCheck | undefined): 'confirmed' | 'attention' | 'unchecked' {
  if (!result || result.code === 'CANCELLED') return 'unchecked'
  return result.code === 'READ_CONFIRMED' || result.code === 'READY_RESPONSE' ? 'confirmed' : 'attention'
}
const statusText: Record<CheckCode, { title: string; detail: string }> = {
  READ_CONFIRMED: { title: '조회 확인', detail: '현재 계정으로 조회 응답을 확인했습니다.' },
  READY_RESPONSE: { title: '준비 응답 확인', detail: '서버가 준비 상태를 응답했습니다. 저장과 파일 전송 확인은 별도입니다.' },
  PARTIAL: { title: '일부 준비 필요', detail: '조회 응답은 받았지만 일부 기능의 준비가 더 필요합니다.' },
  DATABASE_MISSING: { title: '조회 기능 준비 필요', detail: '관리자가 DB 설치와 함수 등록 상태를 확인해야 합니다.' },
  STORAGE_MISSING: { title: '파일 저장소 확인 필요', detail: '관리자가 파일 저장소 구성을 확인해야 합니다.' },
  VERIFICATION_MISSING: { title: '파일 확인 기능 준비 필요', detail: '관리자가 파일 확인 기능의 연결 상태를 확인해야 합니다.' },
  POLICY_MISSING: { title: '학교 이용 설정 필요', detail: '관리자가 이 기능의 학교 이용 설정을 확인해야 합니다.' },
  NOT_CONFIGURED: { title: '설정 준비 중', detail: '이 기능에 필요한 설정을 아직 확인하지 못했습니다.' },
  DISABLED: { title: '이용 중지 상태', detail: '학교에서 이 기능을 중지한 상태입니다.' },
  NOT_READY: { title: '기능 준비 중', detail: '설치와 이용 설정의 준비 상태를 확인해야 합니다.' },
  UNAVAILABLE: { title: '현재 이용할 수 없음', detail: '서버의 기능 준비 상태를 확인해야 합니다.' },
  FORBIDDEN: { title: '이용 권한 확인 필요', detail: '현재 계정의 권한을 확인하기 위해 나머지 점검을 멈췄습니다.' },
  INACTIVE_MEMBERSHIP: { title: '학교 소속 확인 필요', detail: '현재 학교 소속을 확인하기 위해 나머지 점검을 멈췄습니다.' },
  QUERY_FAILED: { title: '조회하지 못함', detail: '연결 상태를 확인한 뒤 이 항목을 다시 조회해 주세요.' },
  INVALID_RESPONSE: { title: '응답 확인 필요', detail: '서버 응답 형식을 확인하지 못했습니다. 관리자에게 점검 결과를 전달해 주세요.' },
  CANCELLED: { title: '조회 취소', detail: '현재 계정과 학교 연결을 다시 확인한 뒤 점검해 주세요.' },
  TIMEOUT: { title: '응답 대기 시간 초과', detail: '응답을 확인하지 못했습니다. 잠시 후 이 항목을 다시 조회해 주세요.' },
}
const lockNotice = '작성 중이거나 결과를 확인 중인 입력이 있습니다. 안내는 볼 수 있지만, 입력을 보관한 화면에서 먼저 처리한 뒤 메뉴 이동과 연결 점검을 이용해 주세요.'
const lockProgressNotice = '입력 처리가 끝날 때까지 연결 점검을 멈춥니다.'
function validResult(result: ModuleCheck, id: CheckId): boolean {
  return result?.id === id && checkCodes.includes(result.code) && typeof result.checkedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.checkedAt) && Number.isFinite(Date.parse(result.checkedAt))
    && new Date(result.checkedAt).toISOString() === result.checkedAt
}

export function WorkspaceHelpDialog({ connection, memberId, scopeKey, locked, onNavigate, runCheck, onClose, returnFocus }: WorkspaceHelpProps & { onClose: () => void; returnFocus?: HTMLElement | null }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<HelpTab>('guide'), [query, setQuery] = useState(''), [selected, setSelected] = useState(workspaceGuides[0].id)
  const [results, setResults] = useState<ModuleCheck[]>([]), [running, setRunning] = useState<CheckId | null>(null)
  const [checkFilter, setCheckFilter] = useState<CheckFilter>('all')
  const [notice, setNotice] = useState(''), [navigationNotice, setNavigationNotice] = useState('')
  const operation = useRef<{ epoch: number; controller: AbortController | null }>({ epoch: 0, controller: null })
  const checkFocus = useRef<string | null>(null)
  const alive = useRef(false), lockedNow = useRef(locked)
  lockedNow.current = locked
  const checker = useMemo(() => runCheck ?? createModuleChecker(connection, memberId), [connection, memberId, runCheck])
  const guides = useMemo(() => findGuides(query), [query])
  const guide = guides.find(item => item.id === selected) ?? guides[0]
  const checks = checkModules.map(item => ({ ...item, result: results.find(result => result.id === item.id) }))
  const visibleChecks = checks.filter(item => checkFilter === 'all' || checkGroup(item.result) === checkFilter || running === item.id)
  const counts = checks.reduce((count, item) => { count[checkGroup(item.result)]++; return count }, { confirmed: 0, attention: 0, unchecked: 0 })
  const stop = useCallback(() => {
    operation.current.epoch++
    operation.current.controller?.abort()
    operation.current.controller = null
    setRunning(null)
  }, [])
  const close = () => { stop(); onClose() }

  useLayoutEffect(() => {
    alive.current = true
    const element = dialog.current, root = element?.getRootNode()
    const active = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.activeElement : document.activeElement
    const previous = returnFocus ?? (active instanceof HTMLElement ? active : null)
    element?.showModal(); search.current?.focus()
    return () => {
      alive.current = false
      operation.current.epoch++
      operation.current.controller?.abort()
      operation.current.controller = null
      element?.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [returnFocus, scopeKey, memberId, connection])
  useLayoutEffect(() => { if (locked) { stop(); setNotice(lockProgressNotice) } else setNotice(previous => previous === lockProgressNotice ? '' : previous) }, [locked, stop])
  useLayoutEffect(() => {
    if (running || !checkFocus.current) return
    const element = dialog.current, root = element?.getRootNode()
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
    // 재확인 성공으로 필터에서 행이 사라질 때 키보드의 현재 위치를 보존한다.
    if (element && !element.querySelector(`[data-check="${checkFocus.current}"]`) && (!active || !element.contains(active))) {
      element.querySelector<HTMLButtonElement>('.wh-help-check-filter [aria-pressed="true"]')?.focus()
    }
    checkFocus.current = null
  }, [running, results, checkFilter])

  function changeTab(next: HelpTab) {
    if (next === tab) return
    if (operation.current.controller) { stop(); setNotice('점검을 중지했습니다. 완료한 항목의 조회 결과만 남아 있습니다.') }
    setTab(next)
  }
  async function startChecks(ids: readonly CheckId[], all: boolean) {
    if (lockedNow.current || operation.current.controller) return
    const root = dialog.current?.getRootNode(), active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
    checkFocus.current = active?.closest<HTMLElement>('[data-check]')?.dataset.check ?? null
    const epoch = ++operation.current.epoch, controller = new AbortController()
    operation.current.controller = controller
    if (all) setResults([])
    else setResults(previous => previous.filter(result => !ids.includes(result.id)))
    setNavigationNotice('')
    setNotice('항목을 하나씩 조회합니다. 자료를 저장하거나 변경하지 않습니다.')
    const current = () => alive.current && operation.current.epoch === epoch && !controller.signal.aborted && !lockedNow.current
    try {
      for (const checkId of ids) {
        if (!current()) return
        setRunning(checkId)
        let result: ModuleCheck
        try {
          const response = await checker(checkId, controller.signal)
          result = validResult(response, checkId) ? response : { id: checkId, code: 'INVALID_RESPONSE', checkedAt: new Date().toISOString() }
        } catch { result = { id: checkId, code: 'QUERY_FAILED', checkedAt: new Date().toISOString() } }
        if (!current()) return
        setResults(previous => [...previous.filter(item => item.id !== checkId), result])
        if (['CANCELLED', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(result.code)) {
          setNotice('현재 계정과 학교 연결을 확인하기 위해 나머지 점검을 멈췄습니다.')
          return
        }
      }
      if (current()) setNotice('요청한 항목의 조회를 마쳤습니다. 저장·제출·파일 전송 확인과 기능 활성화는 별도입니다.')
    } finally {
      if (operation.current.epoch === epoch) { operation.current.controller = null; if (alive.current) setRunning(null) }
    }
  }
  function downloadChecks() {
    if (!results.length || running) return
    try {
      const blob = new Blob([exportModuleChecks(results)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = '업무실-연결점검.json'
      try { document.body.appendChild(link); link.click() }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('지원용 점검 파일의 내려받기를 요청했습니다. 기능 코드와 확인 시각만 담았습니다.')
    } catch { setNotice('지원용 점검 파일을 만들지 못했습니다. 연결 점검을 다시 실행해 주세요.') }
  }

  return <><style>{styles}</style><dialog ref={dialog} className="wh-help-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const element = event.currentTarget, root = element.getRootNode()
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
    const items = Array.from(element.querySelectorAll<HTMLElement>('button,input,summary,[href],[tabindex]')).filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0)
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && active === first && last) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && active === last && first) { event.preventDefault(); first.focus() }
  }}>
    <header className="wh-help-header"><div><h2 id={`${id}-title`}>업무실 도움말</h2><p id={`${id}-intro`}>필요한 일을 찾고, 사용 순서를 확인하세요.</p></div><button type="button" className="wh-help-icon" aria-label="업무실 도움말 닫기" onClick={close}>✕</button></header>
    <div className="wh-help-tabs" role="tablist" aria-label="도움말 종류">{([{ value: 'guide', label: '사용 방법' }, { value: 'checks', label: '기능 연결 점검' }] as const).map(item => <button key={item.value} id={`${id}-${item.value}-tab`} type="button" role="tab" aria-selected={tab === item.value} aria-controls={`${id}-${item.value}-panel`} tabIndex={tab === item.value ? 0 : -1} onClick={() => changeTab(item.value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'guide' : event.key === 'End' ? 'checks' : tab === 'guide' ? 'checks' : 'guide'; changeTab(next); dialog.current?.querySelector<HTMLButtonElement>(`[id="${id}-${next}-tab"]`)?.focus() } }}>{item.label}</button>)}</div>
    {locked && <p className="wh-help-warning" role="status">{lockNotice}</p>}
    {tab === 'guide' ? <section className="wh-help-body" role="tabpanel" id={`${id}-guide-panel`} aria-labelledby={`${id}-guide-tab`}>
      <label className="wh-help-search" htmlFor={`${id}-search`}>어떤 일을 하시나요?<input ref={search} id={`${id}-search`} type="search" value={query} maxLength={200} placeholder="예: 제출, 인쇄, 인계" onChange={event => { setQuery(event.target.value); setNavigationNotice('') }}/></label>
      <p className="wh-help-count" role="status">{guides.length}개 사용 방법</p>
      {guide ? <div className="wh-help-guides"><nav className="wh-help-guide-list" aria-label="업무별 사용 방법">{guides.map(item => <button key={item.id} type="button" aria-current={guide.id === item.id ? 'true' : undefined} onClick={() => { setSelected(item.id); setNavigationNotice('') }}>{item.title}</button>)}</nav><article className="wh-help-guide" aria-labelledby={`${id}-guide-title`}><h3 id={`${id}-guide-title`}>{guide.title}</h3><p className="wh-help-summary">{guide.summary}</p><ol>{guide.steps.map((step, index) => <li key={index}><span aria-hidden="true">{index + 1}</span><p>{step}</p></li>)}</ol><p className="wh-help-note">{guide.note}</p><button type="button" className="wh-help-primary" disabled={locked} onClick={() => { if (lockedNow.current) return; if (onNavigate(guide.page)) close(); else setNavigationNotice('현재 화면의 입력이나 처리 상태를 확인한 뒤 이동해 주세요.') }}>{guidePageTitle(guide.page)} 열기</button>{navigationNotice && <p className="wh-help-note" role="status">{navigationNotice}</p>}</article></div> : <p className="wh-help-empty">찾는 사용 방법이 없습니다. ‘제출’, ‘학생’, ‘메시지’처럼 다른 말로 찾아보세요.</p>}
    </section> : <section className="wh-help-body" role="tabpanel" id={`${id}-checks-panel`} aria-labelledby={`${id}-checks-tab`}>
      <div className="wh-help-check-intro"><h3>현재 계정으로 조회할 수 있는지 확인해요</h3><p>버튼을 누를 때만 {checkModules.length}개 기능을 차례로 조회합니다. 조회 성공은 기능 활성화 완료를 뜻하지 않습니다.</p><details><summary>이번 점검의 범위</summary><p>학교별 목록 또는 준비 상태 응답만 확인합니다. 저장·제출·메시지 읽음·파일 업로드와 내려받기·AI 호출은 하지 않습니다. 실제 사용 확인은 별도로 필요합니다.</p><p>지원용 파일에는 기능 코드와 확인 시각만 담습니다. 이름·이메일·계정 및 학교 식별자·학생 정보·문서와 메시지 내용은 담지 않습니다.</p></details></div>
      <div className="wh-help-actions"><button type="button" className="wh-help-primary" disabled={locked || !!running} onClick={() => void startChecks(checkModules.map(item => item.id), true)}>전체 연결 점검</button>{running && <button type="button" className="wh-help-secondary" onClick={() => { stop(); setNotice('점검을 중지했습니다. 완료한 항목의 조회 결과만 남아 있습니다.') }}>점검 중지</button>}<button type="button" className="wh-help-secondary" disabled={!results.length || !!running} onClick={downloadChecks}>지원용 JSON 내려받기</button></div>
      <p className="wh-help-progress" role="status" aria-live="polite">{running ? `${checkModules.find(item => item.id === running)?.label} 조회 중 · ` : ''}{results.length} / {checkModules.length}개 항목 결과{notice && ` · ${notice}`}</p>
      <dl className="wh-help-check-summary" aria-label="연결 점검 요약"><div><dt>조회 응답 확인</dt><dd>{counts.confirmed}</dd></div><div><dt>확인 필요</dt><dd>{counts.attention}</dd></div><div><dt>미확인·취소</dt><dd>{counts.unchecked}</dd></div></dl>
      <div className="wh-help-check-filter" role="group" aria-label="연결 점검 결과 보기">{([{ value: 'all', label: '전체' }, { value: 'attention', label: '확인 필요' }, { value: 'unchecked', label: '미확인·취소' }] as const).map(item => <button key={item.value} type="button" aria-pressed={checkFilter === item.value} onClick={() => setCheckFilter(item.value)}>{item.label}</button>)}</div>
      {navigationNotice && <p className="wh-help-note" role="status">{navigationNotice}</p>}
      {!visibleChecks.length && <p className="wh-help-empty">이 조건에 해당하는 항목이 없습니다. ‘전체’에서 모든 조회 상태를 확인할 수 있습니다.</p>}
      <ul className="wh-help-checks">{visibleChecks.map(item => {
        const { result } = item, status = result ? statusText[result.code] : null
        return <li key={item.id} data-check={item.id}><div className="wh-help-check-content"><h4>{item.label}</h4><p className="wh-help-check-status">{running === item.id ? '조회 중…' : status?.title ?? '아직 확인하지 않음'}</p>{result && <><p>{status?.detail}</p><details><summary>진단 코드와 확인 시각</summary><code>{result.code}</code><time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString('ko-KR')}</time></details></>}</div><div className="wh-help-row-actions"><button type="button" className="wh-help-secondary" disabled={locked || !!running} aria-label={`${item.label} ${result ? '다시 확인' : '확인'}`} onClick={() => void startChecks([item.id], false)}>{result ? '다시 확인' : '확인'}</button><button type="button" className="wh-help-secondary" disabled={locked || !!running} aria-label={`${item.label} 관련 메뉴 열기`} onClick={() => { if (lockedNow.current || operation.current.controller) return; if (onNavigate(item.page)) close(); else setNavigationNotice('현재 화면의 입력이나 처리 상태를 확인한 뒤 이동해 주세요.') }}>{guidePageTitle(item.page)} 열기</button></div></li>
      })}</ul>
    </section>}
    <footer className="wh-help-footer"><span>학교의 준비 상태와 현재 권한에 따라 사용할 수 있는 기능이 다릅니다.</span><button type="button" className="wh-help-secondary" onClick={close}>닫기</button></footer>
  </dialog></>
}

export default WorkspaceHelpDialog
