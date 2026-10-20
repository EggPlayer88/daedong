import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { createSchoolPreparationService, type SchoolPreparationService } from './school-preparation-service'
import type { SchoolPreparationDestination, SchoolPreparationReport } from './school-preparation-summary'
import styles from './school-preparation.css?inline'

export interface SchoolPreparationPanelProps {
  connection: SupabaseConnection; member: Membership; revision?: number
  disabled?: boolean
  onOpen: (destination: SchoolPreparationDestination) => void
}
const states = { present: '자료 확인', action: '입력·확인', blocked: '정리 필요', unavailable: '연결 확인', unknown: '조회 확인' } as const

/** 부모가 필요할 때 펼쳐 렌더한다. 계정/학교/역할 전환 시 이전 집계와 늦은 응답을 함께 버린다. */
export function SchoolPreparationPanel(props: SchoolPreparationPanelProps) {
  return <ScopedSchoolPreparationPanel {...props} key={recoveryScope(props.member)} />
}
function ScopedSchoolPreparationPanel({ connection, member, revision = 0, disabled = false, onOpen }: SchoolPreparationPanelProps) {
  const service = useMemo(() => createSchoolPreparationService(connection), [connection])
  return <SchoolPreparationView service={service} memberId={member.id} revision={revision} disabled={disabled} onOpen={onOpen} />
}
export function SchoolPreparationView({ service, memberId, revision = 0, disabled = false, onOpen }: {
  service: SchoolPreparationService; memberId: string; revision?: number; disabled?: boolean; onOpen: (destination: SchoolPreparationDestination) => void
}) {
  const [report, setReport] = useState<SchoolPreparationReport | null>(null), [busy, setBusy] = useState(true)
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), generation = useRef(0)
  useEffect(() => {
    const run = ++generation.current
    setBusy(true); setReport(null); setError('')
    void service.get(memberId).then(value => {
      if (run !== generation.current) return
      setReport(value)
    }).catch(() => {
      if (run !== generation.current) return
      setError('학교 준비 현황을 확인하지 못했습니다. 계정·학교 연결을 확인한 뒤 다시 조회해 주세요.')
    }).finally(() => { if (run === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [service, memberId, revision, refresh])
  return <section className="school-preparation" aria-label="학교 준비 진행 안내" aria-busy={busy}>
    <style>{styles}</style>
    <div className="school-preparation-heading"><div><h3>학교 자료 준비</h3><p>교사 연결부터 실제 시간표까지, 다음에 입력할 곳을 확인하세요.</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>현황 다시 확인</button></div>
    {busy && <p role="status">학교 자료와 선택한 학기를 확인하는 중입니다.</p>}
    {error && <p role="alert">{error}</p>}
    {disabled && <p role="status">작성 중인 입력이나 확인 중인 요청을 먼저 마무리하면 다음 화면으로 이동할 수 있습니다.</p>}
    {report && <>
      <div className="school-preparation-overview">
        <div><strong>{report.termLabel ?? '대상 학기 확인 필요'}</strong><p>입력·정리할 단계 {report.needsAttention}개 · 조회·연결 확인 {report.unknownCount}개</p></div>
        {report.next && <button type="button" className="primary" disabled={disabled} onClick={() => onOpen(report.next!)}>다음 단계 · {report.steps.find(row => row.id === report.next)?.title}</button>}
      </div>
      <ol className="school-preparation-steps">{report.steps.map((row, index) => <li key={row.id} data-state={row.state}>
        <div className="school-preparation-step-main"><span className="school-preparation-number" aria-hidden="true">{index + 1}</span><div>
          <h4>{row.title}<span className="school-preparation-state">{states[row.state]}</span></h4><p>{row.summary}</p>
        </div><button type="button" className="secondary" disabled={disabled} onClick={() => onOpen(row.id)}>{row.action}</button></div>
        <details><summary>{row.title} 확인 범위와 다음 작업</summary><ul>{row.details.map((detail, i) => <li key={i}>{detail}</li>)}</ul>
          {row.details.length === 0 && <p>해당 화면에서 연결 상태와 입력 내용을 확인해 주세요. 이번 조회만으로 준비 완료를 판단하지 않습니다.</p>}</details>
      </li>)}</ol>
      <p className="school-preparation-footnote">이 안내는 저장된 자료를 읽어 요약합니다. 교사 명단의 정확성, 전체 학교 준비 완료, 시간표 확정·공개 여부를 대신 확인하지 않습니다. 미저장 입력은 포함하지 않습니다.</p>
    </>}
  </section>
}
