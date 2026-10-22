import type { OperationLesson, OperationsView, OperationTeacher } from './operations-contracts'
import type { OperationReferenceView } from './operations-next-contracts'
import { parseOperationsView } from './operations-server'
import { parseOperationReferences } from './operations-next-server'
import { canonical, isoDate } from '../services/scoped-rpc'
import { timetableDateOffset, timetableLocalDate, timetableWeekStart } from './operations-calendar'
import { writeTimetableXlsx, type WorkbookSheet } from './xlsx'
import limits from './operations-api-limits.json'
import printStyles from './published-export.css?inline'
import type { InterventionsView } from './interventions-contracts'
import { verifiedInterventionChanges } from './operations-links'

export interface PublishedExportSelection { mode: 'day' | 'week' | 'loaded'; date: string; teacherId: string; groupId: string }
export interface PublishedExportRow {
  id: string; version: number; date: string; endDate: string; start: string; end: string; label: string
  teachers: OperationTeacher[]; groups: OperationTeacher[] | null; rooms: OperationTeacher[] | null
  teacherLabels: string[]; groupLabels: string[]; roomLabels: string[]
  state: string; change: string; originalTime: string
  originalLessonId: string; previousTeachers: string
}
export interface PublishedExportReport {
  sourceKey: string; from: string; until: string; requestedFrom: string; requestedUntil: string
  timeZone: string; asOf: string; target: string; teacherId: string; groupId: string
  rows: PublishedExportRow[]; dates: string[]; notices: string[]; referencesAvailable: boolean
}
export class PublishedExportError extends Error {}
const invalid = (message = '시간표의 조회 범위와 연결 정보를 다시 확인해 주세요.'): never => { throw new PublishedExportError(message) }
const stateLabels = { scheduled: '예정', performed: '진행 완료', cancelled: '취소' }
export const PUBLISHED_EXPORT_NOTICE = '화면에서 조회한 수업만 담은 사본입니다. 학기 전체 시간표가 아니며, 이후 변경 사항은 다시 조회해 출력해 주세요.'
export const publishedExportSourceKey = (view: OperationsView, references: OperationReferenceView | undefined, selection: PublishedExportSelection, memberId: string, interventions?: InterventionsView) => canonical([view, references ?? null, selection, memberId, interventions ?? null])
const displayNames = (values: OperationTeacher[], all: Map<string, string>) => {
  const counts = new Map<string, number>(); for (const name of all.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
  return values.map(value => value.name + ((counts.get(value.name) ?? 0) > 1 ? ` [${value.id}]` : ''))
}
const mapNames = (values: OperationTeacher[]) => {
  const result = new Map<string, string>()
  for (const value of values) { if (result.has(value.id) && result.get(value.id) !== value.name) invalid('같은 식별자의 이름이 서로 다릅니다. 다시 조회해 주세요.'); result.set(value.id, value.name) }
  return result
}
function lessonVersion(value: OperationLesson) { const { canRequest: _request, allowedTargets: _targets, ...stable } = value; return canonical(stable) }

/** 이미 조회된 기간만 출력한다. 이름으로 교사·학급을 합치거나 없는 날짜를 조회한 것으로 보충하지 않는다. */
export function buildPublishedExport(view: OperationsView, references: OperationReferenceView | undefined, selection: PublishedExportSelection, memberId: string, interventions?: InterventionsView): PublishedExportReport {
  try {
    isoDate(view.from); isoDate(view.until); isoDate(selection.date)
    const span = (Date.parse(view.until) - Date.parse(view.from)) / 86400000
    if (span < 1 || span > limits.listDays || !['day', 'week', 'loaded'].includes(selection.mode) || typeof selection.teacherId !== 'string' || typeof selection.groupId !== 'string') invalid()
    const source = parseOperationsView(view, memberId, view.from, view.until)
    let refs: OperationReferenceView | undefined
    if (references) { try { refs = parseOperationReferences(references, source) } catch { /* 교사별 출력은 안정된 교사 ID와 본체만으로 계속 제공한다. */ } }
    if (selection.groupId && !refs) invalid('학급 식별 정보를 다시 확인한 뒤 출력해 주세요. 같은 학급 이름으로 대신 묶지 않습니다.')
    const teachers = mapNames(source.lessons.flatMap(row => row.teachers)), groups = mapNames(refs?.lessons.flatMap(row => row.groups) ?? []), rooms = mapNames(refs?.lessons.flatMap(row => row.rooms) ?? [])
    if (selection.teacherId && selection.teacherId !== memberId && !teachers.has(selection.teacherId) || selection.groupId && !groups.has(selection.groupId)) invalid('선택한 교사 또는 학급을 현재 조회 자료에서 확인하지 못했습니다.')
    const target = [selection.teacherId ? selection.teacherId === memberId ? '내 시간표' : displayNames([{ id: selection.teacherId, name: teachers.get(selection.teacherId)! }], teachers)[0] + ' 교사' : '', selection.groupId ? displayNames([{ id: selection.groupId, name: groups.get(selection.groupId)! }], groups)[0] + ' 학급' : ''].filter(Boolean).join(' · ') || '허용된 전체 수업'
    const requestedFrom = selection.mode === 'loaded' ? source.from : selection.mode === 'week' ? timetableWeekStart(selection.date) : selection.date
    const requestedUntil = selection.mode === 'loaded' ? source.until : timetableDateOffset(requestedFrom, selection.mode === 'week' ? 7 : 1)
    const from = requestedFrom < source.from ? source.from : requestedFrom, until = requestedUntil > source.until ? source.until : requestedUntil
    if (until <= from) invalid('선택한 날짜는 현재 조회 범위 밖입니다. 해당 날짜의 시간표를 먼저 조회해 주세요.')
    const referencesById = new Map(refs?.lessons.map(row => [row.lessonId, row]) ?? [])
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: source.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const timeText = (time: OperationLesson['time']) => `${timetableLocalDate(time.startsAt, source.timeZone)} ${clock.format(new Date(time.startsAt))} ~ ${timetableLocalDate(time.endsAt, source.timeZone)} ${clock.format(new Date(time.endsAt))}`
    const applied = new Map<string, { kind: 'move' | 'swap'; before: OperationLesson | null; after: OperationLesson }[]>()
    const interventionEvidence = verifiedInterventionChanges(source, interventions, memberId)
    const evidenceByLesson = new Map<string, typeof interventionEvidence.changes>()
    for (const change of interventionEvidence.changes) {
      const rows = evidenceByLesson.get(change.lessonId)
      if (rows) rows.push(change)
      else evidenceByLesson.set(change.lessonId, [change])
    }
    for (const request of source.requests) if (request.state === 'applied') for (const change of request.changes) applied.set(change.after.id, [...(applied.get(change.after.id) ?? []), { ...change, kind: request.kind }])
    const rows = source.lessons.filter(lesson => {
      const date = timetableLocalDate(lesson.time.startsAt, source.timeZone)
      return date >= from && date < until && (!selection.teacherId || lesson.teachers.some(teacher => teacher.id === selection.teacherId)) && (!selection.groupId || referencesById.get(lesson.id)?.groups.some(group => group.id === selection.groupId))
    }).sort((a, b) => a.time.startsAt.localeCompare(b.time.startsAt) || a.id.localeCompare(b.id)).map(lesson => {
      const related = (applied.get(lesson.id) ?? []).filter(row => lessonVersion(row.after) === lessonVersion(lesson))
      const previous = [...new Set(related.map(row => row.before ? timeText(row.before.time) : ''))], kinds = new Set(related.map(row => row.kind))
      const extra = evidenceByLesson.get(lesson.id) ?? []
      const extraLabels = [...new Set(extra.map(row => row.label))]
      const originals = [...new Set(extra.map(row => row.originalLessonId).filter(Boolean))]
      const formerTeachers = [...new Set(extra.filter(row => row.kind === 'substitute' && row.before).map(row => row.before!.teachers.map(person => `${person.name} [${person.id}]`).join(' · ')))]
      const ref = referencesById.get(lesson.id)
      return { id: lesson.id, version: lesson.version, date: timetableLocalDate(lesson.time.startsAt, source.timeZone), endDate: timetableLocalDate(lesson.time.endsAt, source.timeZone), start: clock.format(new Date(lesson.time.startsAt)), end: clock.format(new Date(lesson.time.endsAt)), label: lesson.label,
        teachers: structuredClone(lesson.teachers), groups: ref ? structuredClone(ref.groups) : null, rooms: ref ? structuredClone(ref.rooms) : null,
        teacherLabels: displayNames(lesson.teachers, teachers), groupLabels: ref ? displayNames(ref.groups, groups) : [...lesson.groupNames], roomLabels: ref ? displayNames(ref.rooms, rooms) : [...lesson.roomNames],
        state: stateLabels[lesson.state], change: extraLabels.length ? extraLabels.join(' · ') : related.length ? kinds.size === 1 ? kinds.has('swap') ? '임시 교환 반영' : '임시 이동 반영' : '임시 변경 반영' : lesson.version > 1 ? '판 갱신 · 재확정·변경 여부 미확인' : '현재 반영본', originalTime: previous.length === 1 ? previous[0] : previous.length > 1 ? '이전 시각은 변경 이력에서 확인' : '',
        originalLessonId: originals.length === 1 ? originals[0] : '', previousTeachers: formerTeachers.length === 1 ? formerTeachers[0] : '' }
    })
    const dates = Array.from({ length: (Date.parse(until) - Date.parse(from)) / 86400000 }, (_, i) => timetableDateOffset(from, i))
    const notices = [PUBLISHED_EXPORT_NOTICE, '취소 수업도 포함합니다. 수업이 없는 날짜를 휴업 또는 공강으로 확정하지 않습니다.', '임시 교환·이동과 변경 전 시각은 현재 수업 판과 일치하는 적용 완료 요청만 표시합니다. 2판 이상인데 일치하는 요청이 없으면 판 갱신만 표시합니다. 정식 재확정일 수도 있으며 실제 수업 시각 변경 여부와 원인은 추정하지 않습니다. 전체 변경 이력이나 개인 사유는 포함하지 않습니다.']
    notices.push(interventionEvidence.available ? '대강·휴강·보강·휴업 취소는 같은 조회 기간의 적용 완료 이력과 현재 수업의 ID·판·내용이 모두 일치할 때만 표시합니다. 보강은 확인된 취소 원수업 ID를 함께 표시합니다.' : '대강·보강 이력 연결을 확인하지 못했습니다. 실제 수업은 출력하지만 변경 원인은 추정하지 않습니다.')
    if (!refs) notices.push('학급·공간 식별 정보는 확인되지 않았습니다. 표시 이름은 참고용이며 같은 이름의 학급을 합치지 않습니다.')
    if (from !== requestedFrom || until !== requestedUntil) notices.push('선택한 주·날짜 중 실제 조회된 부분만 포함했습니다. 조회 범위 밖 날짜는 누락된 수업으로 판단하지 않습니다.')
    return { sourceKey: publishedExportSourceKey(view, references, selection, memberId, interventions), from, until, requestedFrom, requestedUntil, timeZone: source.timeZone, asOf: source.asOf, target, teacherId: selection.teacherId, groupId: selection.groupId, rows, dates, notices, referencesAvailable: Boolean(refs) }
  } catch (error) { if (error instanceof PublishedExportError) throw error; return invalid() }
}

export function publishedExportSheets(report: PublishedExportReport): WorkbookSheet[] {
  return [{ name: '시간표', rows: [['시작일', '시작 시각', '종료일', '종료 시각', '수업', '교사', '학급', '공간', '상태', '반영 상태', '변경 전 시각', '수업 ID', '수업 판', '교사 ID 목록', '학급 ID 목록', '공간 ID 목록', '취소 원수업 ID', '이전 담당'], ...report.rows.map(row => [row.date, row.start, row.endDate, row.end, row.label, row.teacherLabels.join('\n'), row.groupLabels.join('\n'), row.roomLabels.join('\n'), row.state, row.change, row.originalTime, row.id, String(row.version), JSON.stringify(row.teachers.map(value => value.id)), row.groups ? JSON.stringify(row.groups.map(value => value.id)) : '미확인', row.rooms ? JSON.stringify(row.rooms.map(value => value.id)) : '미확인', row.originalLessonId, row.previousTeachers])] },
    { name: '출력 범위', rows: [['항목', '내용'], ['대상', report.target], ['교사 ID', report.teacherId], ['학급 ID', report.groupId], ['포함 시작일', report.from], ['포함 마지막 날', timetableDateOffset(report.until, -1)], ['요청 시작일', report.requestedFrom], ['요청 마지막 날', timetableDateOffset(report.requestedUntil, -1)], ['시간대', report.timeZone], ['서버 조회 시각(UTC)', report.asOf], ['수업 건수(취소 포함)', String(report.rows.length)], ...report.notices.map((notice, i) => ['안내 ' + (i + 1), notice]), ...report.dates.map(date => [date, String(report.rows.filter(row => row.date === date).length) + '건'])] }]
}
export const publishedExportXlsx = (report: PublishedExportReport) => writeTimetableXlsx(publishedExportSheets(report))
export const publishedExportFilename = (report: PublishedExportReport) => `확정시간표_${report.target}_${report.from}_${timetableDateOffset(report.until, -1)}.xlsx`
export const publishedRowTime = (row: PublishedExportRow) => row.start + ' ~ ' + (row.endDate !== row.date ? row.endDate + ' ' : '') + row.end

/** 문자열은 HTML이 아니라 텍스트 노드로 넣는다. 팝업 실패가 화면 미리보기 상태를 지우지 않는다. */
export function printPublishedExport(report: PublishedExportReport): void {
  let popup: Window | null = null
  try {
    popup = window.open('about:blank', '_blank', 'popup')
    if (!popup) invalid('인쇄 창이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러 주세요. 미리보기와 선택은 유지됩니다.')
    popup!.opener = null
    const doc = popup!.document
    const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value?: string) => { const element = doc.createElement(tag); if (value !== undefined) element.textContent = value; return element }
    doc.documentElement.lang = 'ko'; doc.head.replaceChildren(node('title', '확정 시간표 · ' + report.target), node('style', printStyles))
    const main = node('main'); main.className = 'ttpublished-print'
    main.append(node('h1', report.target), node('p', `${report.from} ~ ${timetableDateOffset(report.until, -1)} · ${report.rows.length}건(취소 포함) · ${report.timeZone}`), node('p', '서버 조회 시각(UTC): ' + report.asOf))
    for (const notice of report.notices) { const p = node('p', notice); p.className = 'ttpublished-notice'; main.append(p) }
    for (const date of report.dates) {
      const section = node('section'); section.className = 'ttpublished-day'; section.append(node('h2', date))
      const rows = report.rows.filter(row => row.date === date)
      if (!rows.length) section.append(node('p', '조회된 수업 없음 · 휴업·공강 여부를 확정하는 표시가 아닙니다.'))
      else {
        const table = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody')
        for (const title of ['실제 시각', '수업·상태', '교사', '학급·공간', '변경']) { const th = node('th', title); th.scope = 'col'; tr.append(th) }; head.append(tr)
        for (const row of rows) { const line = node('tr'); for (const value of [publishedRowTime(row), `${row.label}\n${row.state} · ${row.version}판`, row.teacherLabels.join('\n'), [...row.groupLabels, ...row.roomLabels].join('\n'), row.change + (row.originalTime ? '\n변경 전: ' + row.originalTime : '') + (row.originalLessonId ? '\n취소 원수업: ' + row.originalLessonId : '') + (row.previousTeachers ? '\n이전 담당: ' + row.previousTeachers : '')]) line.append(node('td', value)); body.append(line) }
        table.append(head, body); section.append(table)
      }
      main.append(section)
    }
    popup!.addEventListener('afterprint', () => { try { popup?.document.body.replaceChildren(); popup?.close() } catch { /* 인쇄가 끝난 창의 정리 실패는 다시 열지 않는다. */ } }, { once: true })
    doc.body.replaceChildren(main); popup!.focus(); popup!.print()
  } catch (error) { try { popup?.close() } catch { /* 닫힌 창은 다시 열지 않는다. */ }; if (error instanceof PublishedExportError) throw error; invalid('인쇄 창을 준비하지 못했습니다. 미리보기와 선택은 유지됩니다. 다시 시도해 주세요.') }
}
