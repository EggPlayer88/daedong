import { useMemo, useState } from 'react'
import type { OperationsView } from './operations-contracts'
import type { OperationReferenceView } from './operations-next-contracts'
import { buildPublishedExport, publishedExportFilename, publishedExportXlsx, printPublishedExport, publishedRowTime, PublishedExportError } from './published-export'
import { timetableDateOffset } from './operations-calendar'
import { requestBlobDownload } from '../files/download'
import limits from './operations-next-limits.json'
import styles from './published-export.css?inline'
import type { InterventionsView } from './interventions-contracts'

interface Props { view: OperationsView; references?: OperationReferenceView; interventions?: InterventionsView; memberId: string; teacherId: string; groupId: string; date: string; mode: 'day' | 'week'; locked: boolean }
export function PublishedTimetableExport({ view, references, interventions, memberId, teacherId, groupId, date, mode, locked }: Props) {
  const [open, setOpen] = useState(false), [range, setRange] = useState<'screen' | 'loaded'>('screen'), [previewKey, setPreviewKey] = useState(''), [previewDate, setPreviewDate] = useState(''), [shown, setShown] = useState(limits.boardLessons), [feedback, setFeedback] = useState<{ key: string; error?: string; notice?: string }>()
  const prepared = useMemo(() => { if (!open) return {}; try { return { report: buildPublishedExport(view, references, { mode: range === 'loaded' ? 'loaded' : mode, date, teacherId, groupId }, memberId, interventions) } } catch (error) { return { error: error instanceof PublishedExportError ? error.message : '출력할 시간표를 확인하지 못했습니다.' } } }, [open, view, references, interventions, memberId, teacherId, groupId, date, mode, range])
  const report = prepared.report, key = report?.sourceKey ?? '', preview = report && previewKey === key ? report : undefined, currentFeedback = feedback?.key === key ? feedback : undefined
  const selectedDate = preview?.dates.includes(previewDate) ? previewDate : preview?.dates[0] ?? '', rows = preview?.rows.filter(row => row.date === selectedDate) ?? []
  function showPreview() { if (locked || !report) return; setPreviewKey(key); setPreviewDate(report.from); setShown(limits.boardLessons); setFeedback(undefined) }
  function output(kind: 'print' | 'xlsx') {
    if (locked || !report || !preview) return
    try {
      if (kind === 'print') printPublishedExport(report)
      else { const bytes = publishedExportXlsx(report); requestBlobDownload(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), publishedExportFilename(report)) }
      setFeedback({ key, notice: kind === 'print' ? '인쇄 창에서 프린터 또는 PDF로 저장을 선택해 주세요. 저장 결과는 기기에서 확인해 주세요.' : 'XLSX 내려받기를 요청했습니다. 실제 저장 결과는 기기에서 확인해 주세요.' })
    } catch (error) { setFeedback({ key, error: error instanceof PublishedExportError ? error.message : '파일을 준비하거나 내려받지 못했습니다. 미리보기는 유지됩니다. 다시 시도해 주세요.' }) }
  }
  return <details className="ttpublished-export" onToggle={event => setOpen(event.currentTarget.open)}><style>{styles}</style><summary>인쇄·PDF·엑셀 내려받기</summary>
    <p>현재 선택한 교사·학급의 실제 날짜별 수업을 출력합니다. 학교에 저장된 시간표를 바꾸지 않습니다.</p>
    <label>출력할 기간<select aria-label="출력할 기간" disabled={locked} value={range} onChange={event => { setRange(event.target.value as 'screen' | 'loaded'); setPreviewKey(''); setFeedback(undefined) }}><option value="screen">현재 {mode === 'week' ? '주' : '날짜'}</option><option value="loaded">현재 조회한 기간 전체</option></select></label>
    <p className="ttpublished-notice">조회된 범위: {view.from} ~ {timetableDateOffset(view.until, -1)} · {view.timeZone}. 학기 전체를 뜻하지 않습니다.</p>
    {prepared.error && <p role="status">{prepared.error}</p>}
    <button type="button" className="secondary" disabled={locked || !report} onClick={showPreview}>출력 미리보기</button>
    {previewKey && !preview && <p role="status">조회 자료나 선택 범위가 바뀌었습니다. 현재 자료로 미리보기를 다시 열어 주세요.</p>}
    {preview && <section aria-label="확정 시간표 출력 미리보기"><h4>{preview.target}</h4><p>{preview.from} ~ {timetableDateOffset(preview.until, -1)} · 전체 {preview.rows.length}건(취소 포함)</p><p className="ttpublished-notice">서버 조회 시각(UTC): {preview.asOf}</p>
      <details><summary>출력 범위와 변경 표시 안내</summary>{preview.notices.map(notice => <p key={notice}>{notice}</p>)}</details>
      <label>미리보기 날짜<select aria-label="미리보기 날짜" value={selectedDate} disabled={locked} onChange={event => { setPreviewDate(event.target.value); setShown(limits.boardLessons) }}>{preview.dates.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <p>{selectedDate} · {rows.length}건{rows.length > shown ? ` 중 ${shown}건 표시 · 출력 파일에는 전체 ${preview.rows.length}건 포함` : ''}</p>
      {rows.length ? <div className="ttpublished-table" role="region" aria-label="선택 날짜 출력 내용" tabIndex={0}><table><caption>{selectedDate} 실제 수업</caption><thead><tr>{['실제 시각', '수업·상태', '교사', '학급·공간', '변경'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.slice(0, shown).map(row => <tr key={row.id}><td>{publishedRowTime(row)}</td><td>{row.label}<small>{row.state} · {row.version}판</small></td><td>{row.teacherLabels.join(' · ')}</td><td>{[...row.groupLabels, ...row.roomLabels].join(' · ')}</td><td>{row.change}{row.originalTime && <small>변경 전: {row.originalTime}</small>}{row.originalLessonId && <small>취소 원수업: {row.originalLessonId}</small>}{row.previousTeachers && <small>이전 담당: {row.previousTeachers}</small>}</td></tr>)}</tbody></table></div> : <p>조회된 수업 없음 · 휴업·공강 여부를 확정하는 표시가 아닙니다.</p>}
      {rows.length > shown && <button type="button" className="secondary" disabled={locked} onClick={() => setShown(value => value + limits.boardLessons)}>출력 미리보기 더 보기</button>}
      <div className="ttboard-actions"><button type="button" disabled={locked} onClick={() => output('print')}>인쇄·PDF로 저장</button><button type="button" className="secondary" disabled={locked} onClick={() => output('xlsx')}>확정 시간표 XLSX 내려받기</button><button type="button" className="secondary" disabled={locked} onClick={() => setPreviewKey('')}>출력 미리보기 닫기</button></div>
    </section>}
    {currentFeedback?.error && <p role="alert">{currentFeedback.error}</p>}{currentFeedback?.notice && <p role="status">{currentFeedback.notice}</p>}
  </details>
}
