import { useEffect, useId, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createHomeService, type HomeAction, type HomeKind, type HomeOverview } from './overview'
import styles from './home-overview.css?inline'

interface Props { connection: SupabaseConnection; member: Membership; revision: number; onOpen: (item: HomeAction) => void }
const iconPaths: Record<HomeKind, string> = {
  collection: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
  supplement: 'M6 3h9l4 4v14H6z M14 3v5h5 M12 11v5 M12 18h.01',
  message: 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5',
  student_followup: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3',
  cooperation: 'M7 7h13l-4-4 M20 7l-4 4 M17 17H4l4-4 M4 17l4 4',
}

export function HomeOverviewPanel({ connection, member, revision, onOpen }: Props) {
  const service = useMemo(() => createHomeService(connection), [connection])
  const [data, setData] = useState<HomeOverview>()
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  useEffect(() => {
    let live = true
    setData(undefined); setFailed(false); setExpanded(false)
    void service.load(member.id).then(value => { if (live) setData(value) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [service, member.id, revision, reload])

  const empty = Boolean(data && !data.items.length && !data.unavailable.length)
  // 서버가 준 순서는 유지한다. 첫 목록을 줄이더라도 긴급 항목은 접지 않는다.
  const collapsedItems = data?.items.filter((item, index) => index < 4 || item.priority === 'urgent') ?? []
  const shownItems = data ? (expanded ? data.items : collapsedItems) : []
  return <section className={`home-overview${empty ? ' home-overview-empty-state' : ''}`} aria-label="확인할 학교 업무">
    <style>{styles}</style>
    <header className="home-overview-heading"><h2>확인할 일</h2><span className="home-overview-context">내게 온 업무</span></header>
    {failed ? <div className="home-overview-failure" role="alert">
      <p>수합·메시지·학생 후속 업무를 불러오지 못했습니다</p>
      <p>일정과 내 업무는 각각 확인할 수 있습니다. 다른 항목을 0건으로 판단하지 않습니다.</p>
      <button type="button" className="secondary" onClick={() => setReload(value => value + 1)}>추가 업무 다시 확인</button>
    </div> : !data ? <p className="home-overview-empty" role="status">내게 연결된 업무를 확인 중…</p> : <>
      <ul className="home-overview-items" id={listId}>{shownItems.map(item => <li key={item.id}>
        <button type="button" onClick={() => onOpen(item)} className={item.priority === 'urgent' ? 'is-urgent' : undefined}>
          <span className="home-overview-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={iconPaths[item.kind]} /></svg></span>
          <span className="home-overview-content"><span className="home-overview-title">{item.priority === 'urgent' && <strong>확인 필요 · </strong>}{item.title}</span><small>{item.label}{item.dueDate && ` · ${item.dueDate}까지`}</small></span>
          <span className="home-overview-arrow" aria-hidden="true">›</span>
        </button>
      </li>)}</ul>
      {data.items.length > collapsedItems.length && <button type="button" className="text-button home-overview-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? '업무 목록 접기' : `확인할 업무 ${data.items.length}개 모두 보기`}</button>}
      {!data.items.length && !data.unavailable.length && <p className="home-overview-empty">지금 표시할 추가 업무가 없습니다.</p>}
      {data.unavailable.length > 0 && <p className="home-overview-note">일부 연결 항목은 확인 중입니다. 확인되지 않은 항목은 건수에 포함하지 않았습니다.</p>}
      <details className="home-overview-help"><summary>업무 표시 기준</summary>
        <p>원본에서 제출·검토·처리를 마치면 반영됩니다. 홈에서 읽었다고 완료되지 않습니다.</p>
        <p>서버 확인 {new Date(data.asOf).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}</p>
      </details>
    </>}
  </section>
}
