// 화면 안의 이동만 맡는다. 링크로 이동해도 입력 폼과 원래 요청은 다시 만들지 않는다.
export function PageHeading({ title, description, children }) {
  return <header className="site-page-heading"><div><h2 tabIndex={-1}>{title}</h2>{description && <p className="muted">{description}</p>}</div>{children}</header>
}

export function SectionLinks({ items }) {
  return <nav className="site-section-links" aria-label="이 화면에서 바로 이동">{items.map(({ id, label }) => <a key={id} href={`#${id}`} onClick={event => {
    const target = event.currentTarget.getRootNode().getElementById(id)
    if (!target) return
    event.preventDefault()
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start' })
  }}>{label}<span aria-hidden="true">↓</span></a>)}</nav>
}

export function ScrollTable({ label, children }) {
  return <div className="site-table-block"><p className="site-table-help">작은 화면에서는 표를 좌우로 밀어 확인하세요.</p><div className="scroll-x" role="region" aria-label={label} tabIndex={0}>{children}</div></div>
}
