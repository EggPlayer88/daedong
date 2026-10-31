import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import legacyStyles from '../styles.css?inline'
import workStyles from '../../../workhub/src/style.css?inline'

// 화면 틀은 공통으로 사용하고 기존 문서 스타일은 본문 안에만 적용한다.
// 검증된 양식 UI가 사이트 메뉴·모바일 이동 스타일을 덮지 않도록 경계를 둔다.
export function AppearanceSurface({ children }) {
  const host = useRef(null),
    [root, setRoot] = useState(null)
  useEffect(() => {
    if (host.current)
      setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' }))
  }, [])
  if (typeof document === 'undefined') return children
  return (
    <div ref={host}>
      {root ? (
        createPortal(
          <>
            <style>
              {`@scope (.site-frame-surface) to (.site-legacy-surface) { ${workStyles.replaceAll(':root', '.site-frame-surface')} }`}
              {`@scope (.site-legacy-surface) { ${legacyStyles.replaceAll(':root', '.site-legacy-surface').replace(/(^|[}\s,])body(?=\s*[{,])/g, '$1.site-legacy-surface')} } .site-legacy-surface{min-width:0}.site-legacy-surface .site-page{padding:0;max-width:1100px}.site-legacy-surface .site-page>h2{margin-top:0}`}
            </style>
            <div className="site-frame-surface">{children}</div>
          </>,
          root,
        )
      ) : (
        <p role="status">업무 화면을 준비하고 있습니다…</p>
      )}
    </div>
  )
}
