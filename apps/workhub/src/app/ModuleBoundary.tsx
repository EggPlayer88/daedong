import { Component, Fragment, createRef, type ReactNode } from 'react'
import shellStyles from './workspace-shell.css?inline'

export interface ModuleBoundaryProps {
  moduleName: string
  resetKey?: string | number
  onRetry?: () => void
  children: ReactNode
}

export function ModuleFailureView({ moduleName, onRetry }: { moduleName: string; onRetry: () => void }) {
  const name = typeof moduleName === 'string' && moduleName.trim() ? moduleName : '업무'
  return <section className="ws-module-failure" role="alert"><h2 tabIndex={-1}>{name} 화면을 표시하지 못했습니다</h2><p>다른 메뉴는 계속 이용할 수 있습니다. 이 화면만 다시 열어 보세요.</p><p>저장된 원본을 삭제하거나 초기화하지 않습니다. 저장하지 않은 입력은 다시 확인해 주세요.</p><button type="button" onClick={onRetry}>이 화면 다시 열기</button></section>
}

class FeatureBoundary extends Component<ModuleBoundaryProps, { failed: boolean; attempt: number; resetKey?: string | number }> {
  state = { failed: false, attempt: 0, resetKey: this.props.resetKey }
  fallback = createRef<HTMLDivElement>()
  static getDerivedStateFromError() { return { failed: true } }
  static getDerivedStateFromProps(props: ModuleBoundaryProps, state: { resetKey?: string | number }) {
    // 정상 화면은 키 변경만으로 재마운트하지 않아 목록 필터와 입력을 유지한다.
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
  }
  componentDidCatch() { this.fallback.current?.querySelector<HTMLElement>('h2')?.focus() }
  retry = () => {
    try { this.props.onRetry?.(); this.setState(state => ({ failed: false, attempt: state.attempt + 1 })) }
    catch { this.setState({ failed: true }) }
  }
  render() {
    // 오류 메시지·스택에는 자료나 서버 응답이 들어갈 수 있어 화면에 전달하지 않는다.
    return this.state.failed ? <div ref={this.fallback}><style>{shellStyles}</style><ModuleFailureView moduleName={this.props.moduleName} onRetry={this.retry} /></div> : <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}

export function ModuleBoundary(props: ModuleBoundaryProps) {
  return <FeatureBoundary {...props} />
}
