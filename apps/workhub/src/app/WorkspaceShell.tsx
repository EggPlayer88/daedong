import { useSiteNavigation } from './site-navigation'
import '../assets/fonts/tossface/tossface.css'
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { enabledModules, moduleGroupLabels, type ModuleGroup, type PageId, type WorkhubModule, type WorkspaceMode } from '../modules'
import shellStyles from './workspace-shell.css?inline'
import themeStyles from '../appearance/theme.css?inline'
import mobileStyles from './mobile-navigation.css?inline'
import appearanceStyles from '../appearance/appearance.css?inline'
import { AppearanceDialog, AppearancePanel } from '../appearance/AppearancePanel'
import { useAppearancePreferences } from '../appearance/preferences'
import { WorkspaceIcon } from './WorkspaceIcon'
import { WorkspaceAssistantDialog } from './WorkspaceAssistant'
import { fontLicense } from '../assets/fonts/fontLicense'
import tossfaceLicense from '../assets/fonts/tossface/license'
import { availableNavigation } from './navigation-groups'
import renewalStyles from './workspace-renewal.css?inline'
import navigationStyles from './navigation-ui.css?inline'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface WorkspaceShellProps {
  page: PageId
  onNavigate: (page: PageId) => void
  mode: WorkspaceMode
  schoolName: string
  memberName: string
  contextControls?: ReactNode
  quickActions?: ReactNode
  locked?: boolean
  notice?: ReactNode
  storageLabel?: string
  children: ReactNode
  tools?: ReactNode
  onOpenAssistant?: () => void
  assistantOpen?: boolean
  sidePanel?: ReactNode
  navigationModules?: readonly WorkhubModule[]
  participant?: boolean
}

export function WorkspaceShell({ page, onNavigate, mode, schoolName, memberName, contextControls, quickActions, locked = false, notice, storageLabel, children, tools, onOpenAssistant, assistantOpen, sidePanel, navigationModules, participant = false }: WorkspaceShellProps) {
  const site = useSiteNavigation()
  const sitePage = site.current
  const content = useRef<HTMLDivElement>(null)
  const previousPage = useRef<string>(sitePage?.key ?? page)
  const moreButton = useRef<HTMLButtonElement>(null)
  const mobileSheet = useRef<HTMLDialogElement>(null)
  const desktopUtilities = useRef<HTMLDivElement>(null)
  const assistantButton = useRef<HTMLButtonElement>(null)
  const utilityReturn = useRef<HTMLElement | null>(null)
  const previousMobile = useRef<boolean>()
  const restoreAfterResize = useRef(false)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
  const [mobilePanel, setMobilePanel] = useState<'more' | 'appearance' | 'assistant' | null>(null)
  const expanded = mobilePanel === 'more'
  const moreId = useId()
  const contentId = useId()
  const lockId = useId()
  const appearance = useAppearancePreferences()
  // 참여 화면은 기존 접근 검사가 구성한 표시 목록만 받는다. 이 목록으로 권한을 부여하지 않는다.
  const modules = navigationModules === undefined ? enabledModules(mode) : navigationModules.filter(item => enabledModules(mode).some(available => available.id === item.id))
  const assistantAvailable = !participant && (mode === 'preview' || modules.some(item => item.id === 'assistant'))
  const current = modules.find(module => module.id === page)
  // 이용 가능 목록은 그대로 두고 자주 쓰는 화면만 바깥에 배치한다.
  const { primary, related, additional } = availableNavigation(modules, page, participant)
  const currentGroupLabel = primary.find(group => group.active)?.label
  const secondaryPage = !primary.some(group => group.active) && additional.some(module => module.id === page)
  const name = typeof memberName === 'string' && memberName.trim() ? memberName : '선생님'
  const school = typeof schoolName === 'string' && schoolName.trim() ? schoolName : '학교 업무실'

  function focusContent() {
    // document 검색이나 해시 이동은 ShadowRoot 안의 본문을 찾지 못할 수 있다.
    const target = content.current?.closest('.ws-stage')?.querySelector<HTMLElement>('.ws-ai-full h1') ?? content.current?.querySelector<HTMLElement>('h1,h2') ?? content.current?.querySelector<HTMLElement>('main') ?? content.current
    if (target) { target.setAttribute('tabindex', '-1'); target.focus() }
  }
  // 새 화면이 보이기 전에 접는다. 늦은 닫기가 다음 더보기 클릭을 취소하지 않게 한다.
  useBrowserLayoutEffect(() => {
    if (previousPage.current === (sitePage?.key ?? page)) return
    previousPage.current = sitePage?.key ?? page
    closeMobile(false)
    focusContent()
    // 같은 셸에서 지연 로딩하는 문서 제목도 안내하되 사용자가 옮긴 초점은 지킨다.
    const region = content.current
    if (!sitePage || !region?.querySelector('[data-page-loading]')) return
    const tree = region.getRootNode() as Document | ShadowRoot
    const waitingTarget = tree.activeElement
    const observer = new MutationObserver(() => {
      const heading = region.querySelector<HTMLElement>('h1,h2')
      if (!heading || region.querySelector('[data-page-loading]')) return
      observer.disconnect()
      if (tree.activeElement !== waitingTarget) return
      heading.setAttribute('tabindex', '-1'); heading.focus()
    })
    observer.observe(region, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [page, sitePage?.key])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => {
      restoreAfterResize.current = query.matches && Boolean(desktopUtilities.current?.querySelector('dialog[open]'))
      setMobile(query.matches)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  // 화면을 넓힌 순간 사라지는 모바일 버튼에 초점을 남기지 않는다.
  useBrowserLayoutEffect(() => {
    if (restoreAfterResize.current) { restoreAfterResize.current = false; focusContent() }
    const changed = previousMobile.current !== undefined && previousMobile.current !== mobile
    previousMobile.current = mobile
    if (!changed || !mobilePanel) return
    closeMobile(false)
    focusContent()
  }, [mobile, mobilePanel])
  useBrowserLayoutEffect(() => {
    const element = mobileSheet.current
    if (expanded) {
      element?.showModal()
      element?.querySelector<HTMLButtonElement>('.ws-sheet-close')?.focus()
    } else element?.close()
    return () => { element?.close() }
  }, [expanded])
  function closeMobile(restore = true) {
    if (!restore) utilityReturn.current = null
    mobileSheet.current?.close()
    setMobilePanel(null)
    if (restore && moreButton.current?.getClientRects().length) moreButton.current.focus()
  }
  function openUtility(panel: 'appearance' | 'assistant', source: HTMLElement | null = moreButton.current) {
    if (panel === 'assistant' && !assistantAvailable) return
    // 먼저 현재 top-layer를 닫아 설정·비서와 포커스 함정이 겹치지 않게 한다.
    if (panel === 'assistant' && onOpenAssistant) { closeMobile(false); onOpenAssistant(); return }
    if (panel === 'assistant' && mode === 'connected') { navigate('assistant'); return }
    utilityReturn.current = source
    mobileSheet.current?.close()
    setMobilePanel(panel)
  }
  function navigate(next: PageId) {
    if (locked || !modules.some(module => module.id === next)) return
    closeMobile(false)
    if (next === page) focusContent()
    onNavigate(next)
  }
  function closeUtility() { setMobilePanel(null) }
  function restoreUtilityFocus() {
    if (utilityReturn.current?.isConnected && utilityReturn.current.getClientRects().length) utilityReturn.current.focus()
    else focusContent()
  }
  function menuButton(module: WorkhubModule) {
    return <button type="button" key={module.id} aria-label={module.title} className={`ws-menu-button${module.parentId ? ' ws-child-menu' : ''}`} aria-current={!sitePage && page === module.id ? 'page' : undefined} disabled={locked} aria-describedby={locked ? lockId : undefined} onClick={() => navigate(module.id)}>
      <span className="ws-menu-icon"><WorkspaceIcon name={module.id} /></span><span>{module.title}</span>{page === module.id && <small className="ws-menu-current" aria-hidden="true">현재</small>}
    </button>
  }
  function group(groupId: ModuleGroup) {
    const items = additional.filter(module => module.group === groupId)
    return items.length ? <div className={`ws-menu-group ws-group-${groupId}`} key={groupId}><p className="ws-group-label">{moduleGroupLabels[groupId]}</p>{items.map(menuButton)}</div> : null
  }

  return <div className={`ws-shell ws-mode-${mode}${participant ? ' ws-participant' : ''}`} style={{ '--ws-nav-count': primary.length + 1 } as CSSProperties} data-workspace-mode={mode} data-theme={appearance.preferences.theme} data-density={appearance.preferences.density} data-text-size={appearance.preferences.textSize}>
    <a className="ws-skip-link" href={`#${contentId}`} onClick={event => { event.preventDefault(); focusContent() }}>본문으로 건너뛰기</a>
    {mode === 'preview' && <div className="ws-mode-banner"><strong>로컬 개발 미리보기</strong><span>{storageLabel ?? '합성 자료 · 실제 서비스 연결 없음'}</span></div>}
    <div className="ws-frame">
      <aside className="ws-sidebar" aria-label="학교 업무실 안내">
        <div className="ws-brand"><span className="ws-brand-mark"><WorkspaceIcon name="school" /></span><div><strong>학교 업무</strong><span>업무혁신시스템</span></div></div>
        <div className="ws-school"><span className="ws-school-dot" aria-hidden="true" /><strong>{school}</strong>{mode === 'preview' && <span className="ws-mode-tag">가상</span>}</div>
        {!mobile && contextControls && <div className="ws-school-context">{contextControls}</div>}
        <nav className="ws-navigation" aria-label={participant ? '허용된 업무' : '업무 메뉴'}>
          <div className="ws-primary-menus">{site.home}{primary.map(group => <button key={group.home} type="button" className="ws-menu-button" aria-label={group.label} aria-current={!sitePage && group.active ? 'page' : undefined} disabled={locked} aria-describedby={locked ? lockId : undefined} onClick={() => navigate(group.home)}><span className="ws-menu-icon"><WorkspaceIcon name={group.home} /></span><span>{group.label}</span></button>)}</div>
          {assistantAvailable && <button ref={assistantButton} type="button" aria-label="AI 비서" className="ws-menu-button ws-assistant-trigger" disabled={locked && !onOpenAssistant} aria-describedby={locked && !onOpenAssistant ? lockId : undefined} aria-current={page === 'assistant' ? 'page' : undefined} aria-expanded={onOpenAssistant ? assistantOpen : undefined} aria-haspopup={mode === 'preview' || onOpenAssistant ? 'dialog' : undefined} onClick={() => openUtility('assistant', assistantButton.current)}><span className="ws-menu-icon"><WorkspaceIcon name="assistant" /></span><span>AI 비서</span></button>}
          {site.seasonal && <section className="ws-site-seasonal" aria-label="진행 중인 기간 업무"><p className="ws-group-label">기간 업무</p>{site.seasonal}</section>}
          <button ref={moreButton} className={`ws-more-button${secondaryPage ? ' ws-more-current' : ''}`} type="button" aria-expanded={expanded} aria-controls={moreId} aria-haspopup="dialog" onClick={() => setMobilePanel('more')}><span aria-hidden="true">•••</span><span>더보기</span></button>
          <dialog ref={mobileSheet} id={moreId} className="ws-mobile-sheet" aria-labelledby={`${moreId}-title`} onKeyDown={event => {
            if (event.key !== 'Tab' || event.nativeEvent.isComposing) return
            const candidates = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
            const root = event.currentTarget.getRootNode()
            const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
            const first = candidates[0], last = candidates[candidates.length - 1]
            if (event.shiftKey && active === first && last) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && active === last && first) { event.preventDefault(); first.focus() }
          }} onCancel={event => { event.preventDefault(); closeMobile() }}>
            {expanded && <><header className="ws-sheet-header"><div><h2 id={`${moreId}-title`}>더보기</h2><p>{school} · {name}</p></div><button type="button" className="ws-sheet-close" aria-label="더보기 닫기" onClick={() => closeMobile()}>✕</button></header>
              <div className="ws-sheet-body"><p className="ws-sheet-location">현재 위치 <strong>{sitePage?.title ?? current?.title ?? '화면 확인'}</strong></p>
                {site.seasonal && <section className="ws-site-seasonal-mobile" aria-label="진행 중인 기간 업무"><h3>기간 업무</h3>{site.seasonal}</section>}{site.utilities && <section className="ws-site-utilities" aria-label="사이트 관리">{site.utilities}</section>}{additional.length > 0 && <div className="ws-sheet-menus">{group('today')}{group('school')}{group('work')}{group('teaching')}</div>}
                {locked && <p className="ws-sheet-lock">작성 중인 내용을 저장하거나 편집을 마친 뒤 이동할 수 있습니다.</p>}
                <div className="ws-sheet-utilities">{assistantAvailable && <button type="button" className="ws-utility-button" aria-haspopup={mode === 'preview' || onOpenAssistant ? 'dialog' : undefined} disabled={locked && !onOpenAssistant} onClick={() => openUtility('assistant')}><WorkspaceIcon name="assistant" /><span>AI 비서</span>{mode === 'preview' && <small>준비 중</small>}</button>}<button type="button" className="ws-utility-button" aria-haspopup="dialog" onClick={() => openUtility('appearance')}><WorkspaceIcon name="appearance" /><span>화면 설정</span></button></div>
                {mobile && contextControls && <div className="ws-sheet-context">{contextControls}</div>}
              </div></>}
          </dialog>
        </nav>
        <div ref={desktopUtilities} className="ws-utilities">{!mobile && <><AppearancePanel preferences={appearance.preferences} onChange={appearance.update} onReset={appearance.reset} persistenceError={appearance.persistenceError} /></>}</div>
        <div className="ws-member"><span className="ws-avatar" aria-hidden="true">{Array.from(name)[0]}</span><div><strong>{name}</strong><span>{mode === 'preview' ? '미리보기 계정' : '나의 학교 업무실'}</span></div></div>
      </aside>
      <div className="ws-workspace">
        <header className="ws-context"><nav aria-label="현재 위치" className="ws-breadcrumb"><span>학교 업무</span><span aria-hidden="true">/</span>{!sitePage && currentGroupLabel && currentGroupLabel !== current?.title && <><span className="ws-breadcrumb-group">{currentGroupLabel}</span><span aria-hidden="true">/</span></>}<strong aria-current="page">{sitePage?.title ?? current?.title ?? '화면 확인'}</strong></nav><div className="ws-header-actions">{quickActions}{modules.some(item => item.id === 'messages') && <button type="button" className="ws-header-messages" aria-label="메시지와 알림" aria-current={page === 'messages' ? 'page' : undefined} disabled={locked} onClick={() => navigate('messages')}><WorkspaceIcon name="messages" /></button>}{assistantAvailable && (onOpenAssistant || mode === 'preview') && <button className="ws-mobile-ai" type="button" aria-label="AI 비서 열기" aria-haspopup="dialog" aria-expanded={assistantOpen} onClick={event => openUtility('assistant', event.currentTarget)}><WorkspaceIcon name="assistant" /></button>}</div></header>
        {!sitePage && related.length > 1 && <nav className="ws-related" aria-label="관련 업무 메뉴"><span className="ws-related-label">관련 업무</span>{related.map(module => <button type="button" key={module.id} aria-current={!sitePage && page === module.id ? 'page' : undefined} disabled={locked} onClick={() => navigate(module.id)}>{module.title}</button>)}</nav>}
        <div className="ws-stage"><div className="ws-stage-main">
        {notice && <div className="ws-notice">{notice}</div>}
        {locked && <p className="ws-locked" role="status" id={lockId}><strong>이동하기 전에 현재 작업을 확인해 주세요</strong>작성한 내용을 저장하거나 편집을 마친 뒤 이동해 주세요. 처리 중인 요청이 있다면 먼저 결과를 확인해 주세요.</p>}
        <div id={contentId} ref={content} className="ws-content" tabIndex={-1}>{current || sitePage ? children : <main className="ws-unavailable"><p className="ws-state-kicker">이용 가능한 메뉴 확인</p><h1>이 화면은 아직 연결되지 않았습니다</h1><p>메뉴에서 현재 이용할 수 있는 화면을 선택해 주세요.</p></main>}</div>
        {tools && <div className="ws-tools">{tools}</div>}
        {mode === 'connected' && <details className="ws-connection-info"><summary>학교·연결 정보</summary><p>{participant ? '허용된 업무 참여' : '관리자 시범 사용'} · {storageLabel ?? '현재 학교 서버에 저장'}</p></details>}
        <details className="ws-font-license"><summary>글꼴 라이선스</summary><pre>{fontLicense}{'\n\n'}{tossfaceLicense}</pre></details>
        </div>{sidePanel}</div>
      </div>
    </div>
    {mobilePanel === 'appearance' && <AppearanceDialog preferences={appearance.preferences} onChange={appearance.update} onReset={appearance.reset} persistenceError={appearance.persistenceError} onClose={closeUtility} returnFocus={utilityReturn.current} restoreFocus={restoreUtilityFocus} />}
    {mobilePanel === 'assistant' && <WorkspaceAssistantDialog modules={modules} onNavigate={navigate} locked={locked} onClose={closeUtility} returnFocus={utilityReturn.current} />}
    <style>{themeStyles}{shellStyles}{mobileStyles}{appearanceStyles}{renewalStyles}{navigationStyles}</style>
  </div>
}
