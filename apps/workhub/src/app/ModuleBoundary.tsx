import { Component, Fragment, createRef, type ReactNode } from 'react'
import shellStyles from './workspace-shell.css?inline'
import feedbackStyles from './workspace-feedback.css?inline'
import { ModuleLoadAttempt } from './retryable-lazy'

export interface ModuleBoundaryProps {
  moduleName: string
  resetKey?: string | number
  onRetry?: () => void
  children: ReactNode
}

export function ModuleFailureView({ moduleName, onRetry, retried = false, fileLoadFailed = false }: { moduleName: string; onRetry: () => void; retried?: boolean; fileLoadFailed?: boolean }) {
  const name = typeof moduleName === 'string' && moduleName.trim() ? moduleName : '업무'
  return <section className="ws-module-failure" role="alert">
    <style>{feedbackStyles}</style>
    <p className="ws-state-kicker">{fileLoadFailed ? '화면 파일 연결 확인' : '화면 연결 확인'}</p>
    <h2 tabIndex={-1}>{name} 화면을 표시하지 못했습니다</h2>
    <p>{fileLoadFailed ? '화면 파일을 가져오지 못했습니다. 사이트가 새로 배포됐거나 인터넷 연결이 잠시 끊겼을 수 있습니다.' : '다른 메뉴는 계속 이용할 수 있습니다. 이 화면만 다시 열어 보세요.'}</p>
    <p>저장된 원본을 삭제하거나 초기화하지 않습니다. 저장하지 않은 입력은 다시 확인해 주세요.</p>
    <button type="button" onClick={onRetry}>이 화면 다시 열기</button>
    {retried && <div className="ws-recovery-warning"><p><strong>같은 오류가 계속되면 다음 순서로 확인해 주세요.</strong></p><ol>
      <li>다른 화면의 작성 중인 입력을 먼저 저장하거나 따로 보관해 주세요.</li>
      <li>결과를 모르는 요청이 있다면 해당 화면에서 기존 요청 번호로 결과를 먼저 확인해 주세요. 새 번호로 다시 보내지 마세요.</li>
      <li>위 확인을 마친 뒤 브라우저를 새로고침해 주세요. 화면 파일의 다운로드 실패는 브라우저에 남아 있을 수 있습니다.</li>
    </ol><p>새로고침하면 현재 탭에만 보관한 입력과 요청 번호가 사라집니다. 결과를 확인하지 못한 요청이 있다면 이 탭을 유지해 주세요.</p></div>}
  </section>
}

class FeatureBoundary extends Component<ModuleBoundaryProps, { failed: boolean; attempt: number; resetKey?: string | number; loadAttempt: object; fileLoadFailed: boolean }> {
  state = { failed: false, attempt: 0, resetKey: this.props.resetKey, loadAttempt: {}, fileLoadFailed: false }
  fallback = createRef<HTMLDivElement>()
  static getDerivedStateFromError(error: unknown) {
    // 파일 주소나 서버 응답 원문은 노출하지 않고 복구 안내 종류만 구분한다.
    const fileLoadFailed = error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(error.message)
    return { failed: true, fileLoadFailed }
  }
  static getDerivedStateFromProps(props: ModuleBoundaryProps, state: { failed: boolean; attempt: number; resetKey?: string | number }) {
    // 정상 화면은 키 변경만으로 재마운트하지 않아 목록 필터와 입력을 유지한다.
    return props.resetKey !== state.resetKey ? { failed: false, fileLoadFailed: false, resetKey: props.resetKey, ...(state.failed ? { attempt: state.attempt + 1, loadAttempt: {} } : {}) } : null
  }
  componentDidCatch() { this.fallback.current?.querySelector<HTMLElement>('h2')?.focus() }
  retry = () => {
    try { this.props.onRetry?.(); this.setState(state => ({ failed: false, attempt: state.attempt + 1, loadAttempt: {} })) }
    catch { this.setState({ failed: true }) }
  }
  render() {
    // 오류 메시지·스택에는 자료나 서버 응답이 들어갈 수 있어 화면에 전달하지 않는다.
    return this.state.failed ? <div ref={this.fallback}><style>{shellStyles}</style><ModuleFailureView moduleName={this.props.moduleName} onRetry={this.retry} retried={this.state.attempt > 0} fileLoadFailed={this.state.fileLoadFailed} /></div> : <ModuleLoadAttempt.Provider value={this.state.loadAttempt}><Fragment key={this.state.attempt}>{this.props.children}</Fragment></ModuleLoadAttempt.Provider>
  }
}

export function ModuleBoundary(props: ModuleBoundaryProps) {
  return <FeatureBoundary {...props} />
}
