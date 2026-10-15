import { Component, lazy, Suspense } from 'react'
import '../../../workhub/src/app/navigation-bridge'
const SchoolSetupWorkspace = lazy(() => import('../../../workhub/src/setup/SchoolSetupWorkspace.tsx').then(module => ({ default: module.SchoolSetupWorkspace })))

class SchoolSetupBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section role="alert"><h1>학교 설정 준비 화면을 불러오지 못했습니다</h1><p>기존 업무 메뉴를 이용하거나 화면을 다시 불러와 주세요. 내려받은 초안 파일이 있으면 다시 이어서 작성할 수 있습니다.</p><button onClick={() => window.location.reload()}>다시 불러오기</button></section>
    return this.props.children
  }
}

// 기존 App의 승인·모듈 공개 판정을 따른다. 설정 준비에는 회원 조회나 서버 쓰기가 없다.
export default function SchoolSetupPage() {
  return <SchoolSetupBoundary><Suspense fallback={<p role="status">학교 설정 준비 화면을 불러오고 있습니다…</p>}><SchoolSetupWorkspace /></Suspense></SchoolSetupBoundary>
}
