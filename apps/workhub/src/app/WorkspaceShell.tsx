import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react'
import { enabledModules, moduleGroupLabels, type ModuleGroup, type PageId, type WorkhubModule, type WorkspaceMode } from '../modules'
import shellStyles from './workspace-shell.css?inline'

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
  const [expanded, setExpanded] = useState(false)
  const moreId = useId()
  const contentId = useId()
  const lockId = useId()
  const modules = enabledModules(mode)
  const current = modules.find(module => module.id === page)
  const additional = modules.filter(module => module.group === 'work' || module.group === 'teaching')
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
    setExpanded(false)
    focusContent()
  }, [page])

  function navigate(next: PageId) {
    if (locked || !modules.some(module => module.id === next)) return
    onNavigate(next)
  }
  function menuButton(module: WorkhubModule) {
    return <button type="button" key={module.id} className={`ws-menu-button${module.parentId ? ' ws-child-menu' : ''}`} aria-current={page === module.id ? 'page' : undefined} disabled={locked} aria-describedby={locked ? lockId : undefined} onClick={() => navigate(module.id)}>
      <span className="ws-menu-icon" aria-hidden="true">{module.icon}</span><span>{module.title}</span>{module.parentId && <span className="ws-child-note" aria-hidden="true">내 할 일</span>}
    </button>
  }
  function group(groupId: ModuleGroup) {
    const items = modules.filter(module => module.group === groupId)
    return items.length ? <div className={`ws-menu-group ws-group-${groupId}`} key={groupId}><p className="ws-group-label">{moduleGroupLabels[groupId]}</p>{items.map(menuButton)}</div> : null
  }

  return <div className={`ws-shell ws-mode-${mode}`} data-workspace-mode={mode}>
    <style>{shellStyles}</style>
    <a className="ws-skip-link" href={`#${contentId}`} onClick={event => { event.preventDefault(); focusContent() }}>본문으로 건너뛰기</a>
    <div className="ws-mode-banner"><strong>{mode === 'preview' ? '로컬 개발 미리보기' : '신축 업무실 · 연결 시험'}</strong><span>{storageLabel ?? (mode === 'preview' ? '합성 자료 · 실제 서비스 연결 없음' : '현재 학교 서버에 저장')}</span></div>
    <div className="ws-frame">
      <aside className="ws-sidebar" aria-label="학교 업무실 안내">
        <div className="ws-brand"><span className="ws-brand-mark" aria-hidden="true">學</span><div><strong>하루를 잇는 학교</strong><span>업무혁신시스템</span></div></div>
        <div className="ws-school"><span className="ws-school-dot" aria-hidden="true" /><strong>{school}</strong>{mode === 'preview' && <span className="ws-mode-tag">가상</span>}</div>
        <nav className="ws-navigation" aria-label={mode === 'connected' ? '신축 업무 메뉴' : '업무 메뉴'}>
          {group('today')}{group('school')}
          {additional.length > 0 && <><button className="ws-more-button" type="button" aria-expanded={expanded} aria-controls={moreId} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">•••</span>더보기</button><div id={moreId} className={`ws-extra-menus${expanded ? ' ws-extra-open' : ''}`}>{group('work')}{group('teaching')}</div></>}
        </nav>
        <div className="ws-sidebar-note"><p>오늘의 일을 가볍게,<br /><strong>함께하는 일을 선명하게.</strong></p></div>
        <div className="ws-member"><span className="ws-avatar" aria-hidden="true">{Array.from(name)[0]}</span><div><strong>{name}</strong><span>{mode === 'preview' ? '합성 자료로 흐름 확인' : '현재 학교의 업무 공간'}</span></div></div>
      </aside>
      <div className="ws-workspace">
        <header className="ws-context"><nav aria-label="현재 위치" className="ws-breadcrumb"><span>업무실</span><span aria-hidden="true">/</span>{current?.parentId && <><span>{modules.find(module => module.id === current.parentId)?.title}</span><span aria-hidden="true">/</span></>}<strong aria-current="page">{current?.title ?? '화면 확인'}</strong></nav><div className="ws-header-actions">{quickActions}{contextControls && <div className="ws-context-controls">{contextControls}</div>}</div></header>
        {notice && <div className="ws-notice">{notice}</div>}
        {locked && <p className="ws-locked" role="status" id={lockId}>작성한 내용을 저장하거나 편집을 마친 뒤 이동해 주세요. 처리 중인 요청이 있다면 먼저 결과를 확인해 주세요.</p>}
        <div id={contentId} ref={content} className="ws-content" tabIndex={-1}>{current ? children : <main className="ws-unavailable"><h1>이 화면은 아직 연결되지 않았습니다</h1><p>메뉴에서 현재 이용할 수 있는 화면을 선택해 주세요.</p></main>}</div>
        {tools && <div className="ws-tools">{tools}</div>}
      </div>
    </div>
  </div>
}
