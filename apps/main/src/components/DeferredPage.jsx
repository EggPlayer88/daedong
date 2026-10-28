import { Component, createRef, lazy, Suspense } from 'react'

// 첫 화면에서는 사용하지 않는 업무 코드를 받지 않는다. 재시도는 해당 화면만 다시 연다.
// 메뉴·권한 판정은 App의 기존 라우트 등록에 그대로 맡긴다.
export function deferredPage(load, label) {
  return class DeferredPage extends Component {
    state = { Screen: lazy(load), failed: false, retried: false }
    failure = createRef()
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch() { this.failure.current?.focus() }
    retry = () => this.setState({ Screen: lazy(load), failed: false, retried: true })
    render() {
      if (this.state.failed) return <section className="site-page site-page-loading" role="alert">
        <h2 ref={this.failure} tabIndex={-1}>{label} 화면을 불러오지 못했습니다</h2>
        <p>다른 메뉴는 계속 이용할 수 있습니다. 연결을 확인한 뒤 이 화면만 다시 열어 보세요.</p>
        {this.state.retried && <p>같은 문제가 계속되면 다른 화면의 입력과 처리 중인 요청을 정리한 뒤 새로고침해 주세요. 현재 탭에만 보관한 입력은 사라질 수 있습니다.</p>}
        <button type="button" className="btn-plain" onClick={this.retry}>이 화면 다시 열기</button>
      </section>
      const Screen = this.state.Screen
      return <Suspense fallback={<section className="site-page site-page-loading" role="status" aria-busy="true" data-page-loading><p>{label} 화면을 불러오는 중…</p><p className="muted">잠시만 기다려 주세요. 다른 메뉴로 이동할 수 있습니다.</p></section>}><Screen {...this.props} /></Suspense>
    }
  }
}
