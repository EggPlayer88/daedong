import { useMemo, useState } from 'react'
import { reviewTimetablePreflight, type PreflightCard, type PreflightCode, type TimetablePreflightReport } from './preflight'

const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s/g, '')
const pageSize = 10
const labels: Record<PreflightCode, string> = {
  FIXED_RESOURCE_COLLISION: '고정 수업 겹침', NO_AVAILABLE_SLOT: '허용 시간 소진', RESOURCE_PERIOD_SHORTAGE: '시수 수용 부족',
}

function EvidenceRows({ label, rows }: { label: string; rows: { id: string; text: string }[] }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), current = Math.min(page, pages - 1)
  return <div><strong>{label} {rows.length}건</strong><ul>{rows.slice(current * pageSize, (current + 1) * pageSize).map(row => <li key={row.id}>{row.text}</li>)}</ul>
    {!rows.length && <p className="timetable-muted">사용할 수 있는 시간대가 남아 있지 않습니다.</p>}
    {pages > 1 && <nav className="timetable-actions" aria-label={`${label} 쪽 이동`}><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 {label}</button><span>{current + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 {label}</button></nav>}
  </div>
}

function EvidenceCard({ card }: { card: PreflightCard }) {
  const [open, setOpen] = useState(false)
  return <li className="timetable-card" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
    <h4>{card.title}</h4><span className="timetable-badge">{labels[card.code]} · 확정 충돌</span>
    <p>{card.message}</p><p>{card.nextStep}</p>
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>관련 수업·대상·시간 보기</summary>
      {open && <>
        <EvidenceRows label="관련 수업" rows={card.lessons.map(row => ({ id: row.id, text: `${row.label} · ${row.periods}차시` }))} />
        <EvidenceRows label="관련 대상" rows={card.resources.map(row => ({ id: row.id, text: row.label }))} />
        <EvidenceRows label="검사한 시간" rows={card.slots.map(row => ({ id: row.id, text: `${days[row.day - 1]} ${row.label} · ${clock(row.startMinute)}–${clock(row.endMinute)} · ${row.periods}차시` }))} />
      </>}
    </details>
  </li>
}

export function TimetablePreflightPanel({ basis, report: suppliedReport }: { basis: unknown; report?: TimetablePreflightReport }) {
  const report = useMemo(() => suppliedReport ?? reviewTimetablePreflight(basis), [basis, suppliedReport])
  const [query, setQuery] = useState(''), [kind, setKind] = useState<PreflightCode | ''>(''), [page, setPage] = useState(0)
  const searchable = useMemo(() => report.cards.map(card => ({ card, search: normalize([
    card.title, card.message, ...card.lessons.map(row => row.label), ...card.resources.map(row => row.label),
    ...card.slots.map(row => `${days[row.day - 1]} ${row.label} ${clock(row.startMinute)} ${clock(row.endMinute)}`),
  ].join(' ')) })), [report])
  const matches = useMemo(() => { const needle = normalize(query); return searchable.filter(row => (!kind || row.card.code === kind) && row.search.includes(needle)) }, [searchable, query, kind])
  const pages = Math.max(1, Math.ceil(matches.length / pageSize)), current = Math.min(page, pages - 1)
  const scopeExplanation = <p className="timetable-muted">고정 수업 겹침, 불가 시간으로 인한 허용 시간 소진, 자원별 시수 수용 부족만 확인합니다. 충돌 없음이나 가능 시수 상한은 시간표가 만들어진다는 보장이 아닙니다. 실제 계산과 생성·조정 후 전체 필수조건 검사를 따로 거칩니다. 조건을 자동으로 바꾸지 않습니다.</p>
  return <section className="timetable-preflight" aria-label="계산 전 충돌 설명">
    {report.canCalculate ? <>
      <p className="timetable-validation" role="status">확정 충돌 미발견 · 실제 계산과 결과 검사가 필요합니다.</p>
      <details><summary>검사 범위와 한계</summary><p>현재 검사 범위에서 확정 충돌을 찾지 못했습니다. 편성 가능 여부는 아직 미판정입니다.</p>{scopeExplanation}</details>
    </> : <>
      <h3>계산 전 충돌 설명</h3><p className="timetable-error" role="status">
        {report.status === 'blocked' ? `현재 조건으로 편성할 수 없는 이유 ${report.cards.length}건을 찾았습니다.`
          : report.status === 'invalid' ? '입력 형식을 먼저 확인해야 충돌을 설명할 수 있습니다.'
          : '아직 검사할 수 없는 조건이 있어 편성 가능 여부를 판정하지 않았습니다.'}
      </p>{scopeExplanation}
    </>}
    {report.inputIssues.length > 0 && <ul className="timetable-issues">{report.inputIssues.map((issue, i) => <li key={`${issue.path}-${i}`}>{issue.message} <small>({issue.code})</small></li>)}</ul>}
    {report.unsupportedFeatures.length > 0 && <ul>{report.unsupportedFeatures.map(feature => <li key={feature}>미지원 조건: {feature}</li>)}</ul>}
    {report.cards.length > 0 && <>
      <div className="timetable-toolbar"><label>충돌 설명 검색<input aria-label="충돌 설명 검색" value={query} placeholder="교사·학급·수업·시간" onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
        <label>살펴볼 충돌<select aria-label="살펴볼 충돌" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0) }}><option value="">모든 확정 충돌</option>{(Object.keys(labels) as PreflightCode[]).map(code => <option key={code} value={code}>{labels[code]}</option>)}</select></label></div>
      <p role="status">충돌 설명 {matches.length}건 · {current + 1}/{pages}쪽</p>
      <ul className="timetable-list" aria-label="확정 충돌 목록">{matches.slice(current * pageSize, (current + 1) * pageSize).map(({ card }) => <EvidenceCard key={card.id} card={card} />)}</ul>
      {!matches.length && <p>검색 조건에 맞는 충돌이 없습니다. 전체 충돌 {report.cards.length}건은 아직 남아 있습니다.</p>}
      {pages > 1 && <nav className="timetable-actions" aria-label="충돌 설명 쪽 이동"><button type="button" className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>이전 충돌</button><button type="button" className="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음 충돌</button></nav>}
    </>}
  </section>
}
