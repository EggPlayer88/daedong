import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { ServiceError } from '../services/scoped-rpc'
import { createTimetableInterventionsServer } from './interventions-server'
import type { InterventionsSummary, TimetableInterventionsServer } from './interventions-contracts'

export function TimetableActionSummary({ connection, ...props }: {
  connection: SupabaseConnection; member: Membership; date: string; revision?: number
  onOpen: (item: InterventionsSummary['items'][number]) => void
}) {
  const server = useMemo(() => createTimetableInterventionsServer(connection), [connection])
  return <TimetableActionSummaryPanel {...props} server={server} />
}

/** 준비되지 않은 모듈은 홈을 막지 않는다. 실패를 '할 일 없음'으로 표시하지도 않는다. */
export function TimetableActionSummaryPanel({ server, member, date, revision = 0, onOpen }: {
  server: Pick<TimetableInterventionsServer, 'summary'>; member: Membership; date: string; revision?: number
  onOpen: (item: InterventionsSummary['items'][number]) => void
}) {
  const [state, setState] = useState<{ key: string; value?: InterventionsSummary; failed?: boolean }>()
  const [retry, setRetry] = useState(0), key = JSON.stringify([member, date, revision, retry])
  useEffect(() => {
    let cancelled = false
    void server.summary(member.id).then(value => { if (!cancelled) setState({ key, value }) }).catch(error => {
      if (!cancelled) setState({ key, failed: !(error instanceof ServiceError && ['NOT_READY', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(error.code)) })
    })
    return () => { cancelled = true }
  }, [server, member.id, key])
  if (state?.key !== key) return null
  if (state.failed) return <details className="home-summary-status"><summary>시간표 확인할 일 연결 확인</summary><p>시간표 요청 현황을 읽지 못했습니다.</p><button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>다시 확인</button></details>
  const value = state.value
  if (!value || !value.pendingConsent && !value.pendingApproval && !value.makeupNeeded) return null
  return <section className="tt-home-actions" aria-label="시간표 확인할 일">
    <style>{`.tt-home-actions{border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:16px;margin-block:12px;background:var(--surface,#fff)}.tt-home-actions h2{font-size:1rem;margin:0 0 6px}.tt-home-actions p{margin:4px 0;color:var(--muted,#526174)}.tt-home-actions ul{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:6px}.tt-home-actions li button{width:100%;text-align:left;display:flex;justify-content:space-between;gap:12px;padding:10px 12px;min-height:44px}.tt-home-actions small{white-space:nowrap}`}</style>
    <h2>시간표 확인할 일</h2>
    <p>동의 {value.pendingConsent}건 · 승인 {value.pendingApproval}건 · 보강 검토 {value.makeupNeeded}건</p>
    <ul>{value.items.slice(0, 3).map(item => <li key={item.id}><button type="button" className="secondary" onClick={() => onOpen(item)}><span>{item.label}</span><small>{item.date}</small></button></li>)}</ul>
    {value.items.length > 3 && <p><small>먼저 확인할 3건을 표시합니다. 시간표에서 전체를 확인하세요.</small></p>}
  </section>
}
