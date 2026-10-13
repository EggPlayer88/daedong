import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { subscribeWorkspacePopstate } from './navigation-bridge'

const knownPages = new Set(['home', 'calendar', 'tasks', 'collections', 'students'])
export const navigationBlockedMessage = '작성 중인 내용을 저장하거나 편집을 취소한 뒤 이동해 주세요. 저장 결과를 확인 중이면 먼저 같은 요청의 결과를 확인해 주세요.'

export interface NavigationOptions {
  allowedPages: readonly string[]
  defaultPage?: string
  scopeKey?: string
  locked: boolean
}
export interface WorkspaceLocation { page: string; href: string; corrected: boolean }

// 주소는 화면 선택만 담는다. 학교·회원·권한의 근거로 쓰지 않는다.
export function readWorkspaceLocation(href: string, allowedPages: readonly string[], defaultPage = 'home'): WorkspaceLocation {
  const url = new URL(href)
  const allowed = allowedPages.filter(page => knownPages.has(page))
  const fallback = allowed.includes(defaultPage) ? defaultPage : 'home'
  const values = url.searchParams.getAll('view')
  const page = values.length === 1 && allowed.includes(values[0]) ? values[0] : fallback
  if (values.length && (values.length !== 1 || !allowed.includes(values[0]))) url.searchParams.delete('view')
  return { page, href: url.href, corrected: url.href !== href }
}

export function workspacePageUrl(href: string, page: string, allowedPages: readonly string[], defaultPage = 'home'): string | undefined {
  if (!knownPages.has(page) || !allowedPages.includes(page)) return undefined
  const url = new URL(href)
  if (page === defaultPage) url.searchParams.delete('view')
  else url.searchParams.set('view', page)
  return url.href
}

export interface AnchorNavigation {
  href: string
  target?: string | null
  download?: boolean
  button?: number
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}
// 다른 탭·다운로드·메일·본문 위치 이동은 현재 편집기를 없애지 않는다.
export function anchorLeavesWorkspace(currentHref: string, link: AnchorNavigation): boolean {
  if (link.download || (link.button ?? 0) !== 0 || link.ctrlKey || link.metaKey || link.shiftKey || link.altKey) return false
  if (link.target && !['_self', '_parent', '_top'].includes(link.target.toLowerCase())) return false
  let target: URL
  try { target = new URL(link.href, currentHref) } catch { return false }
  if (!['http:', 'https:'].includes(target.protocol)) return false
  const current = new URL(currentHref)
  return target.origin !== current.origin || target.pathname !== current.pathname || target.search !== current.search
}

type HistoryState = Record<string, unknown>
function stateObject(state: unknown): HistoryState { return state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {} }
function historyIndex(state: unknown): number | undefined {
  const index = stateObject(state).idx
  return typeof index === 'number' && Number.isSafeInteger(index) ? index : undefined
}
function fragmentOnly(first: string, second: string): boolean {
  const a = new URL(first), b = new URL(second)
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
}

export interface NavigationControllerOptions {
  window: Window
  getOptions: () => NavigationOptions
  onPageChange: (page: string) => void
  onAnnouncement: (message: string) => void
}

// BrowserRouter가 쓰는 idx를 보존한다. 잠긴 POP은 capture 단계에서 Router보다 먼저
// 차단하고 원래 항목으로 되돌리므로 편집 컴포넌트를 unmount하지 않는다.
export function createWorkspaceNavigationController({ window: host, getOptions, onPageChange, onAnnouncement }: NavigationControllerOptions) {
  let active = false
  let unsubscribePopstate: (() => void) | undefined
  let localNotification = false
  let current = { href: host.location.href, state: host.history.state as unknown }
  let restoring = false
  let lastScope: string | undefined
  let entrySequence = 0

  function announce() { onAnnouncement(navigationBlockedMessage) }
  function notifyRouter() {
    localNotification = true
    try { host.dispatchEvent(new PopStateEvent('popstate', { state: host.history.state })) }
    finally { localNotification = false }
  }
  function acceptCurrent(normalize = true) {
    const options = getOptions()
    const next = readWorkspaceLocation(host.location.href, options.allowedPages, options.defaultPage)
    let state = stateObject(host.history.state)
    // 독립 미리보기와 브라우저 기본 해시 이동에도 같은 문서 내 복귀 지점을 부여한다.
    if (historyIndex(state) === undefined) state = { ...state, idx: (historyIndex(current.state) ?? -1) + 1 }
    if ((normalize && next.corrected) || historyIndex(host.history.state) === undefined) host.history.replaceState(state, '', normalize ? next.href : host.location.href)
    current = { href: host.location.href, state: host.history.state }
    onPageChange(next.page)
    return next.corrected
  }
  function onPopState(event: PopStateEvent) {
    if (!active || localNotification) return
    const target = { href: host.location.href, state: host.history.state as unknown }
    if (restoring && target.href === current.href && historyIndex(target.state) === historyIndex(current.state)) {
      event.stopImmediatePropagation(); restoring = false; return
    }
    if ((getOptions().locked || restoring) && !fragmentOnly(current.href, target.href)) {
      event.stopImmediatePropagation()
      announce()
      const from = historyIndex(current.state), to = historyIndex(target.state)
      if (from !== undefined && to !== undefined && from !== to) {
        restoring = true
        host.history.go(from - to)
      } else {
        // idx가 없는 외부 코드의 history 항목도 초안을 버리지는 않는다.
        // 이 예외에서는 이동한 항목을 원래 주소로 교정하고 현재 화면을 유지한다.
        host.history.replaceState(current.state, '', current.href)
        restoring = false
      }
      return
    }
    restoring = false
    acceptCurrent()
  }
  function onClick(event: MouseEvent) {
    if (!getOptions().locked || event.defaultPrevented) return
    const anchor = event.composedPath().find(node => node instanceof Element && node.tagName.toLowerCase() === 'a') as HTMLAnchorElement | undefined
    if (!anchor || !anchor.hasAttribute('href')) return
    if (!anchorLeavesWorkspace(host.location.href, { href: anchor.href, target: anchor.target && anchor.target === host.name ? '_self' : anchor.target, download: anchor.hasAttribute('download'), button: event.button, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey })) return
    event.preventDefault(); event.stopImmediatePropagation(); announce()
  }
  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!getOptions().locked) return
    event.preventDefault(); event.returnValue = ''
  }
  function sync() {
    const options = getOptions()
    const changedScope = options.scopeKey !== undefined && lastScope !== undefined && options.scopeKey !== lastScope
    if (options.scopeKey !== undefined) lastScope = options.scopeKey
    if (changedScope) {
      const url = workspacePageUrl(host.location.href, options.defaultPage ?? 'home', options.allowedPages, options.defaultPage)
      if (url) host.history.replaceState(host.history.state, '', url)
      restoring = false
      onAnnouncement('')
      acceptCurrent()
      // 자식의 layout effect가 부모 BrowserRouter 구독보다 먼저 실행될 수 있다.
      queueMicrotask(() => { if (active) notifyRouter() })
    } else if (acceptCurrent()) queueMicrotask(() => { if (active) notifyRouter() })
  }
  return {
    start() {
      if (active) return
      active = true
      unsubscribePopstate = subscribeWorkspacePopstate(host, onPopState)
      host.document.addEventListener('click', onClick, true)
      host.addEventListener('beforeunload', onBeforeUnload)
      sync()
    },
    stop() {
      active = false
      unsubscribePopstate?.()
      unsubscribePopstate = undefined
      host.document.removeEventListener('click', onClick, true)
      host.removeEventListener('beforeunload', onBeforeUnload)
    },
    sync,
    requestNavigate(page: string) {
      if (getOptions().locked || restoring) { announce(); return false }
      const options = getOptions()
      const href = workspacePageUrl(host.location.href, page, options.allowedPages, options.defaultPage)
      if (!href) { onAnnouncement('현재 화면에서 이용할 수 없는 메뉴입니다.'); return false }
      const currentPage = readWorkspaceLocation(host.location.href, options.allowedPages, options.defaultPage).page
      if (page === currentPage) { onAnnouncement(''); return true }
      const index = historyIndex(host.history.state) ?? historyIndex(current.state) ?? 0
      host.history.pushState({ ...stateObject(host.history.state), idx: index + 1, key: `workhub-${Date.now()}-${++entrySequence}` }, '', href)
      acceptCurrent(); onAnnouncement(''); notifyRouter()
      return true
    },
    requestAction(action: () => void) {
      if (getOptions().locked || restoring) { announce(); return false }
      onAnnouncement(''); action(); return true
    },
  }
}

export function useWorkspaceNavigation(options: NavigationOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [page, setPage] = useState(() => typeof window === 'undefined' ? options.defaultPage ?? 'home' : readWorkspaceLocation(window.location.href, options.allowedPages, options.defaultPage).page)
  const [announcement, setAnnouncement] = useState('')
  const controller = useRef<ReturnType<typeof createWorkspaceNavigationController>>()
  const allowedKey = options.allowedPages.join('|')
  useLayoutEffect(() => {
    const next = createWorkspaceNavigationController({ window, getOptions: () => optionsRef.current, onPageChange: setPage, onAnnouncement: setAnnouncement })
    controller.current = next; next.start()
    return () => { next.stop(); if (controller.current === next) controller.current = undefined }
  }, [])
  useLayoutEffect(() => { controller.current?.sync() }, [allowedKey, options.defaultPage, options.scopeKey])
  const requestNavigate = useCallback((next: string) => controller.current?.requestNavigate(next) ?? false, [])
  const requestAction = useCallback((action: () => void) => controller.current?.requestAction(action) ?? false, [])
  const clearAnnouncement = useCallback(() => setAnnouncement(''), [])
  return { page, requestNavigate, requestAction, announcement, clearAnnouncement }
}
