// BrowserRouter가 먼저 popstate를 처리하면 편집 화면이 사라질 수 있으므로,
// 앱 진입 시에는 React·업무 화면과 무관한 작은 이벤트 전달기만 준비한다.
// 실제 탐색 로직은 신축 화면을 열 때 불러오며, 구독이 없으면 아무 동작도 하지 않는다.
type PopstateListener = (event: PopStateEvent) => void
const dispatchers = new WeakMap<Window, Set<PopstateListener>>()

function preparePopstateBridge(host: Window): Set<PopstateListener> {
  let listeners = dispatchers.get(host)
  if (!listeners) {
    listeners = new Set()
    const registered = listeners
    host.addEventListener('popstate', event => {
      for (const listener of registered) {
        listener(event)
        if (event.cancelBubble) break
      }
    }, true)
    dispatchers.set(host, listeners)
  }
  return listeners
}

if (typeof window !== 'undefined') preparePopstateBridge(window)

export function subscribeWorkspacePopstate(host: Window, listener: PopstateListener): () => void {
  const listeners = preparePopstateBridge(host)
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
