import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const root = createRoot(document.getElementById('root')!)

// 개발 진입점을 분리하여 일반 빌드에는 합성 자료와 조작 기능을 포함하지 않는다.
if (import.meta.env.DEV) {
  import('./preview/DemoBootstrap').then(({ DemoBootstrap }) => {
    root.render(<React.StrictMode><DemoBootstrap /></React.StrictMode>)
  }).catch(() => {
    root.render(<main className="production"><h1>미리보기를 불러오지 못했습니다.</h1><p>개발 서버를 확인한 뒤 새로고침해 주세요.</p></main>)
  })
} else {
  root.render(<main className="production"><span className="brand-mark">學</span><p className="eyebrow">학교업무혁신시스템</p><h1>운영 연결 준비 중</h1><p>업무 화면은 아직 공개되지 않았습니다.</p><p className="muted">학교 연결과 접근 승인이 완료되면 이용할 수 있습니다.</p></main>)
}
