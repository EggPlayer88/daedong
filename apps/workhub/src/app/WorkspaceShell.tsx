import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react'
import { enabledModules, moduleGroupLabels, type ModuleGroup, type PageId, type WorkhubModule, type WorkspaceMode } from '../modules'
import shellStyles from './workspace-shell.css?inline'
import themeStyles from '../appearance/theme.css?inline'
import mobileStyles from './mobile-navigation.css?inline'
import appearanceStyles from '../appearance/appearance.css?inline'
import { AppearanceDialog, AppearancePanel } from '../appearance/AppearancePanel'
import { useAppearancePreferences } from '../appearance/preferences'
import { WorkspaceIcon } from './WorkspaceIcon'
import { WorkspaceAssistant, WorkspaceAssistantDialog } from './WorkspaceAssistant'
import { fontLicense } from '../assets/fonts/fontLicense'

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
}

export function WorkspaceShell({ page, onNavigate, mode, schoolName, memberName, contextControls, quickActions, locked = false, notice, storageLabel, children, tools }: WorkspaceShellProps) {
  const content = useRef<HTMLDivElement>(null)
  const previousPage = useRef(page)
  const moreButton = useRef<HTMLButtonElement>(null)
  const mobileSheet = useRef<HTMLDialogElement>(null)
  const desktopUtilities = useRef<HTMLDivElement>(null)
  const restoreAfterResize = useRef(false)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
  const [mobilePanel, setMobilePanel] = useState<'more' | 'appearance' | 'assistant' | null>(null)
  const expanded = mobilePanel === 'more'
  const moreId = useId()
  const contentId = useId()
  const lockId = useId()
  const appearance = useAppearancePreferences()
  const modules = enabledModules(mode)
  const current = modules.find(module => module.id === page)
  const additional = modules.filter(module => module.group === 'work' || module.group === 'teaching')
  const secondaryPage = additional.some(module => module.id === page)
  const name = typeof memberName === 'string' && memberName.trim() ? memberName : '선생님'
  const school = typeof schoolName === 'string' && schoolName.trim() ? schoolName : '학교 업무실'

  function focusContent() {
    // document 검색이나 해시 이동은 ShadowRoot 안의 본문을 찾지 못할 수 있다.
    const target = content.current?.querySelector<HTMLElement>('h1') ?? content.current?.querySelector<HTMLElement>('main') ?? content.current
    if (target) { target.setAttribute('tabindex', '-1'); target.focus() }
  }
  // 새 화면이 보이기 전에 접는다. 늦은 닫기가 다음 더보기 클릭을 취소하지 않게 한다.
  useBrowserLayoutEffect(() => {
    if (previousPage.current === page) return
    previousPage.current = page
    closeMobile(false)
    focusContent()
  }, [page])

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
    if (mobile || !mobilePanel) return
    closeMobile(false)
    focusContent()
  }, [mobile, mobilePanel])
  useBrowserLayoutEffect(() => {
    const element = mobileSheet.current
    if (expanded && mobile) {
      element?.showModal()
      element?.querySelector<HTMLButtonElement>('.ws-sheet-close')?.focus()
    } else element?.close()
    return () => { element?.close() }
  }, [expanded, mobile])
  function closeMobile(restore = true) {
    mobileSheet.current?.close()
    setMobilePanel(null)
    if (restore && moreButton.current?.getClientRects().length) moreButton.current.focus()
  }
  function openUtility(panel: 'appearance' | 'assistant') {
    // 먼저 현재 top-layer를 닫아 설정·비서와 포커스 함정이 겹치지 않게 한다.
    mobileSheet.current?.close()
    setMobilePanel(panel)
  }
  function navigate(next: PageId) {
    if (locked || !modules.some(module => module.id === next)) return
    closeMobile(false)
    if (next === page) focusContent()
    onNavigate(next)
  }
  function menuButton(module: WorkhubModule) {
    return <button type="button" key={module.id} className={`ws-menu-button${module.parentId ? ' ws-child-menu' : ''}`} aria-current={page === module.id ? 'page' : undefined} disabled={locked} aria-describedby={locked ? lockId : undefined} onClick={() => navigate(module.id)}>
      <span className="ws-menu-icon"><WorkspaceIcon name={module.id} /></span><span>{module.title}</span>
    </button>
  }
  function group(groupId: ModuleGroup) {
    const items = modules.filter(module => module.group === groupId)
    return items.length ? <div className={`ws-menu-group ws-group-${groupId}`} key={groupId}><p className="ws-group-label">{moduleGroupLabels[groupId]}</p>{items.map(menuButton)}</div> : null
  }

  return <div className={`ws-shell ws-mode-${mode}`} data-workspace-mode={mode} data-theme={appearance.preferences.theme} data-density={appearance.preferences.density} data-text-size={appearance.preferences.textSize}>
    <a className="ws-skip-link" href={`#${contentId}`} onClick={event => { event.preventDefault(); focusContent() }}>본문으로 건너뛰기</a>
    <div className="ws-mode-banner"><strong>{mode === 'preview' ? '로컬 개발 미리보기' : '신축 업무실 · 연결 시험'}</strong><span>{storageLabel ?? (mode === 'preview' ? '합성 자료 · 실제 서비스 연결 없음' : '현재 학교 서버에 저장')}</span></div>
    <div className="ws-frame">
      <aside className="ws-sidebar" aria-label="학교 업무실 안내">
        <div className="ws-brand"><span className="ws-brand-mark"><WorkspaceIcon name="school" /></span><div><strong>학교 업무실</strong><span>업무혁신시스템</span></div></div>
        <div className="ws-school"><span className="ws-school-dot" aria-hidden="true" /><strong>{school}</strong>{mode === 'preview' && <span className="ws-mode-tag">가상</span>}</div>
        <nav className="ws-navigation" aria-label={mode === 'connected' ? '신축 업무 메뉴' : '업무 메뉴'}>
          {group('today')}{group('school')}
          <button ref={moreButton} className={`ws-more-button${secondaryPage ? ' ws-more-current' : ''}`} type="button" aria-expanded={expanded} aria-controls={moreId} aria-haspopup="dialog" onClick={() => setMobilePanel('more')}><span aria-hidden="true">•••</span><span>더보기</span></button>
          {additional.length > 0 && <div className="ws-extra-menus">{group('work')}{group('teaching')}</div>}
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
              <div className="ws-sheet-body">
                {additional.length > 0 && <div className="ws-sheet-menus">{group('work')}{group('teaching')}</div>}
                {locked && <p className="ws-sheet-lock">작성 중인 내용을 저장하거나 편집을 마친 뒤 이동할 수 있습니다.</p>}
                <div className="ws-sheet-utilities"><button type="button" className="ws-utility-button" aria-haspopup="dialog" disabled={locked} onClick={() => openUtility('assistant')}><WorkspaceIcon name="assistant" /><span>AI 비서</span><small>준비 중</small></button><button type="button" className="ws-utility-button" aria-haspopup="dialog" onClick={() => openUtility('appearance')}><WorkspaceIcon name="appearance" /><span>화면 설정</span></button></div>
                {mobile && contextControls && <div className="ws-sheet-context">{contextControls}</div>}
              </div></>}
          </dialog>
        </nav>
        <div ref={desktopUtilities} className="ws-utilities">{!mobile && <><WorkspaceAssistant modules={modules} onNavigate={navigate} locked={locked} /><AppearancePanel preferences={appearance.preferences} onChange={appearance.update} onReset={appearance.reset} persistenceError={appearance.persistenceError} /></>}</div>
        <div className="ws-member"><span className="ws-avatar" aria-hidden="true">{Array.from(name)[0]}</span><div><strong>{name}</strong><span>{mode === 'preview' ? '합성 자료로 흐름 확인' : '현재 학교의 업무 공간'}</span></div></div>
      </aside>
      <div className="ws-workspace">
        <header className="ws-context"><nav aria-label="현재 위치" className="ws-breadcrumb"><span>업무실</span><span aria-hidden="true">/</span>{current?.parentId && <><span>{modules.find(module => module.id === current.parentId)?.title}</span><span aria-hidden="true">/</span></>}<strong aria-current="page">{current?.title ?? '화면 확인'}</strong></nav><div className="ws-header-actions">{quickActions}{!mobile && contextControls && <div className="ws-context-controls">{contextControls}</div>}</div></header>
        {notice && <div className="ws-notice">{notice}</div>}
        {locked && <p className="ws-locked" role="status" id={lockId}>작성한 내용을 저장하거나 편집을 마친 뒤 이동해 주세요. 처리 중인 요청이 있다면 먼저 결과를 확인해 주세요.</p>}
        <div id={contentId} ref={content} className="ws-content" tabIndex={-1}>{current ? children : <main className="ws-unavailable"><h1>이 화면은 아직 연결되지 않았습니다</h1><p>메뉴에서 현재 이용할 수 있는 화면을 선택해 주세요.</p></main>}</div>
        {tools && <div className="ws-tools">{tools}</div>}
        <details className="ws-font-license"><summary>글꼴 라이선스</summary><pre>{fontLicense}</pre></details>
      </div>
    </div>
    {mobile && mobilePanel === 'appearance' && <AppearanceDialog preferences={appearance.preferences} onChange={appearance.update} onReset={appearance.reset} persistenceError={appearance.persistenceError} onClose={() => closeMobile()} returnFocus={moreButton.current} />}
    {mobile && mobilePanel === 'assistant' && <WorkspaceAssistantDialog modules={modules} onNavigate={navigate} locked={locked} onClose={() => closeMobile()} returnFocus={moreButton.current} />}
    <style>{themeStyles}{shellStyles}{mobileStyles}{mobile ? appearanceStyles : null}</style>
  </div>
}
