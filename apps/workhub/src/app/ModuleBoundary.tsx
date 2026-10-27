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

export function ModuleFailureView({ moduleName, onRetry, retried = false }: { moduleName: string; onRetry: () => void; retried?: boolean }) {
  const name = typeof moduleName === 'string' && moduleName.trim() ? moduleName : '업무'
  return <section className="ws-module-failure" role="alert"><style>{feedbackStyles}</style><p className="ws-state-kicker">화면 연결 확인</p><h2 tabIndex={-1}>{name} 화면을 표시하지 못했습니다</h2><p>다른 메뉴는 계속 이용할 수 있습니다. 이 화면만 다시 열어 보세요.</p><p>저장된 원본을 삭제하거나 초기화하지 않습니다. 저장하지 않은 입력은 다시 확인해 주세요.</p>{retried && <p className="ws-recovery-warning">다시 열어도 같은 오류가 계속되면 연결이나 배포 상태를 확인해 주세요. 화면 파일의 다운로드 실패는 브라우저에 남아 있을 수 있습니다. 새로고침이 필요하면 먼저 다른 화면의 입력과 결과를 모르는 요청을 정리해 주세요. 새로고침하면 현재 탭에만 보관한 입력과 요청 번호가 사라집니다.</p>}<button type="button" onClick={onRetry}>이 화면 다시 열기</button></section>
}

class FeatureBoundary extends Component<ModuleBoundaryProps, { failed: boolean; attempt: number; resetKey?: string | number; loadAttempt: object }> {
  state = { failed: false, attempt: 0, resetKey: this.props.resetKey, loadAttempt: {} }
  fallback = createRef<HTMLDivElement>()
  static getDerivedStateFromError() { return { failed: true } }
  static getDerivedStateFromProps(props: ModuleBoundaryProps, state: { failed: boolean; attempt: number; resetKey?: string | number }) {
    // 정상 화면은 키 변경만으로 재마운트하지 않아 목록 필터와 입력을 유지한다.
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey, ...(state.failed ? { attempt: state.attempt + 1, loadAttempt: {} } : {}) } : null
  }
  componentDidCatch() { this.fallback.current?.querySelector<HTMLElement>('h2')?.focus() }
  retry = () => {
    try { this.props.onRetry?.(); this.setState(state => ({ failed: false, attempt: state.attempt + 1, loadAttempt: {} })) }
    catch { this.setState({ failed: true }) }
  }
  render() {
    // 오류 메시지·스택에는 자료나 서버 응답이 들어갈 수 있어 화면에 전달하지 않는다.
    return this.state.failed ? <div ref={this.fallback}><style>{shellStyles}</style><ModuleFailureView moduleName={this.props.moduleName} onRetry={this.retry} retried={this.state.attempt > 0} /></div> : <ModuleLoadAttempt.Provider value={this.state.loadAttempt}><Fragment key={this.state.attempt}>{this.props.children}</Fragment></ModuleLoadAttempt.Provider>
  }
}

export function ModuleBoundary(props: ModuleBoundaryProps) {
  return <FeatureBoundary {...props} />
}
