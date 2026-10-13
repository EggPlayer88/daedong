import type { CalendarEvent, EventDraft, Membership } from '../contracts'
import { normalizeDraft } from '../domain'

// 브라우저에서 한 번에 검토할 입력의 처리 한도다. 학교 일정·정책의 한도가 아니다.
export const IMPORT_LIMITS = { text: 250_000, rows: 200, columns: 30 } as const
export type ImportField = 'sourceId' | 'title' | 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'location' | 'description'
export type ImportMapping = Record<ImportField, number>
export interface ImportTable {
  headers: string[]
  rows: Array<{ line: number; cells: string[] }>
  delimiter: 'tab' | 'comma'
}
export interface ImportRow {
  key: string
  line: number
  sourceId: string
  title: string
  draft?: EventDraft
  errors: string[]
}
export interface UnmappedImportColumn { index: number; label: string; count: number; sample: string; timeLike: boolean }
export const IMPORT_FIELDS: ReadonlyArray<{ key: ImportField; label: string; required?: boolean }> = [
  { key: 'sourceId', label: '원본 ID' },
  { key: 'title', label: '제목', required: true },
  { key: 'startDate', label: '시작일', required: true },
  { key: 'endDate', label: '종료일' },
  { key: 'startTime', label: '시작 시간' },
  { key: 'endTime', label: '종료 시간' },
  { key: 'location', label: '장소' },
  { key: 'description', label: '설명' },
]

const aliases: Record<ImportField, readonly string[]> = {
  sourceId: ['원본 id', '원본id', '일정 id', '일정id', 'sourceid', 'source_id', 'source id', 'id'],
  title: ['제목', '일정명', '일정 제목', '행사명', 'title'],
  startDate: ['시작일', '시작 날짜', '날짜', '일자', 'startdate', 'start_date', 'start date'],
  endDate: ['종료일', '종료 날짜', 'enddate', 'end_date', 'end date'],
  startTime: ['시작 시간', '시작시간', 'starttime', 'start_time', 'start time'],
  endTime: ['종료 시간', '종료시간', 'endtime', 'end_time', 'end time'],
  location: ['장소', 'location'],
  description: ['설명', '내용', '안내', '비고', 'description'],
}

export function suggestImportMapping(headers: unknown): ImportMapping {
  const values = Array.isArray(headers) && headers.every(value => typeof value === 'string') ? headers : []
  return Object.fromEntries(IMPORT_FIELDS.map(({ key }) => {
    const candidates = values.flatMap((value, index) => aliases[key].includes(value.trim().toLowerCase()) ? [index] : [])
    // 같은 뜻의 열이 둘 이상이면 사용자가 선택할 때까지 비워 둔다.
    return [key, candidates.length === 1 ? candidates[0] : -1]
  })) as ImportMapping
}

// 값이 있는 열의 제외는 자동으로 동의한 것으로 보지 않는다. 빈 열은 확인을 요구하지 않는다.
export function unmappedImportColumns(table: ImportTable, mapping: ImportMapping): UnmappedImportColumn[] {
  const mapped = new Set(IMPORT_FIELDS.map(field => mapping[field.key]).filter(index => Number.isInteger(index) && index >= 0))
  return table.headers.flatMap((header, index) => {
    if (mapped.has(index)) return []
    const values = table.rows.map(row => row.cells[index]?.trim() ?? '').filter(Boolean)
    return values.length ? [{ index, label: header || '(열 이름 없음)', count: values.length, sample: values[0].slice(0, 80), timeLike: /시간|일시|time/i.test(header) }] : []
  })
}

function detectDelimiter(text: string): 'tab' | 'comma' {
  let quoted = false, tabs = 0, commas = 0, content = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      content = true
      if (quoted && text[index + 1] === '"') index++
      else quoted = !quoted
    } else if (!quoted) {
      if (char === '\n' || char === '\r') {
        if (content || tabs || commas) break
      } else if (char === '\t') tabs++
      else if (char === ',') commas++
      else if (char.trim()) content = true
    }
  }
  if (tabs && commas) throw new Error('첫 행에 쉼표와 탭이 함께 있습니다. 구분자를 직접 선택해 주세요.')
  return tabs ? 'tab' : 'comma'
}

export function parseImportTable(input: unknown, delimiter: 'auto' | 'tab' | 'comma' = 'auto'): ImportTable {
  if (typeof input !== 'string') throw new Error('가져올 표는 텍스트로 입력해 주세요.')
  if (input.length > IMPORT_LIMITS.text) throw new Error(`한 번에 ${IMPORT_LIMITS.text.toLocaleString('ko-KR')}자까지 검사할 수 있습니다. 표를 나누어 주세요.`)
  if (!['auto', 'tab', 'comma'].includes(delimiter)) throw new Error('지원하는 구분자는 탭과 쉼표입니다.')
  const text = input.replace(/^\uFEFF/, '')
  if (!text.trim()) throw new Error('열 제목과 일정 행이 있는 표를 입력해 주세요.')
  const selected = delimiter === 'auto' ? detectDelimiter(text) : delimiter
  const separator = selected === 'tab' ? '\t' : ','
  const records: Array<{ line: number; cells: string[] }> = []
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, startLine = 1
  const finishCell = () => {
    cells.push(cell)
    if (cells.length > IMPORT_LIMITS.columns) throw new Error(`${startLine}행에 열이 너무 많습니다. ${IMPORT_LIMITS.columns}개 열까지 검사할 수 있습니다.`)
    cell = ''; closed = false
  }
  const finishRecord = () => {
    finishCell()
    if (cells.some(value => value.trim())) {
      records.push({ line: startLine, cells })
      if (records.length > IMPORT_LIMITS.rows + 1) throw new Error(`일정은 한 번에 ${IMPORT_LIMITS.rows}행까지 검사할 수 있습니다. 표를 나누어 주세요.`)
    }
    cells = []
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++ }
        else { quoted = false; closed = true }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[index + 1] === '\n') index++
        cell += '\n'; line++
      } else cell += char
    } else if (char === separator) finishCell()
    else if (char === '\r' || char === '\n') {
      finishRecord()
      if (char === '\r' && text[index + 1] === '\n') index++
      line++; startLine = line
    } else if (char === '"' && !cell && !closed) quoted = true
    else {
      if (char === '"' || closed) throw new Error(`${line}행의 따옴표 형식이 올바르지 않습니다. 셀 전체를 큰따옴표로 감싸고 내부 큰따옴표는 두 번 써 주세요.`)
      cell += char
    }
  }
  if (quoted) throw new Error(`${startLine}행에서 시작한 큰따옴표가 닫히지 않았습니다.`)
  finishRecord()
  if (!records.length) throw new Error('열 제목과 일정 행이 있는 표를 입력해 주세요.')
  const [header, ...rows] = records
  return { headers: header.cells.map(value => value.trim()), rows, delimiter: selected }
}

function dateValue(value: string, label: string, errors: string[]): string {
  // 요일은 버리지 않고 실제 달력과 대조한다. 연도나 날짜를 요일로 추측하지 않는다.
  const weekday = /[ \t]*\(([일월화수목금토])(?:요일)?\)$/.exec(value)
  const dateText = weekday ? value.slice(0, weekday.index).trimEnd() : value
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText) || /^(\d{4})\.[ \t]*(\d{1,2})\.[ \t]*(\d{1,2})\.?$/.exec(dateText) || /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(dateText)
  if (!match) {
    errors.push(`${label}은 연도가 있는 YYYY-MM-DD, YYYY. M. D. 또는 YYYY/M/D로 입력해 주세요.`)
    return ''
  }
  const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  const date = new Date(`${result}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== result) {
    errors.push(`${label}이 실제 달력에 없는 날짜입니다.`)
    return ''
  }
  if (weekday) {
    const actualWeekday = '일월화수목금토'[date.getUTCDay()]
    if (weekday[1] !== actualWeekday) {
      errors.push(`${label}의 요일 (${weekday[1]})이 실제 날짜 ${result} (${actualWeekday})과 다릅니다. 원본 날짜와 요일을 확인해 주세요.`)
      return ''
    }
  }
  return result
}

function timeValue(value: string, label: string, errors: string[]): string {
  if (!value) return ''
  const match = /^(?:(오전|오후)[ \t]*)?(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(value)
  if (!match || Number(match[2]) > (match[1] ? 12 : 23) || match[1] && Number(match[2]) < 1) {
    errors.push(`${label}은 9:00, 09:00 또는 오전/오후 9:00:00 형식으로 입력해 주세요.`)
    return ''
  }
  // 일정 계약은 분 단위다. 초를 버려 다른 시각으로 등록하지 않는다.
  if (match[4] && match[4] !== '00') {
    errors.push(`${label}은 분 단위로만 등록할 수 있습니다. 0이 아닌 초는 원본에서 확인해 주세요.`)
    return ''
  }
  const hour = match[1] ? Number(match[2]) % 12 + (match[1] === '오후' ? 12 : 0) : Number(match[2])
  return `${String(hour).padStart(2, '0')}:${match[3]}`
}

function sameScheduleKey(draft: EventDraft): string {
  return JSON.stringify([draft.title.trim(), draft.startDate, draft.endDate, draft.allDay, draft.allDay ? '' : draft.startTime, draft.allDay ? '' : draft.endTime])
}

export function prepareImportRows(table: ImportTable, mapping: ImportMapping, member: Membership, members: Membership[]): ImportRow[] {
  if (!table || !Array.isArray(table.headers) || !table.headers.length || table.headers.some(value => typeof value !== 'string') || !Array.isArray(table.rows) || table.rows.length > IMPORT_LIMITS.rows || table.headers.length > IMPORT_LIMITS.columns) throw new Error('검사할 표 형식이 올바르지 않습니다. 원본을 다시 불러와 주세요.')
  const mappingErrors: string[] = [], usedColumns = new Set<number>()
  for (const field of IMPORT_FIELDS) {
    const column = mapping?.[field.key]
    if (!Number.isInteger(column) || column < -1 || column >= table.headers.length) mappingErrors.push(`${field.label}의 연결 열을 다시 선택해 주세요.`)
    else if (column === -1) {
      if (field.required) mappingErrors.push(`${field.label} 열을 연결해 주세요.`)
    } else if (usedColumns.has(column)) mappingErrors.push('같은 열을 여러 항목에 연결할 수 없습니다.')
    else usedColumns.add(column)
  }
  const rows: ImportRow[] = table.rows.map((row, index) => {
    const validCells = row && Array.isArray(row.cells) && row.cells.every(value => typeof value === 'string')
    const cells = validCells ? row.cells : []
    const value = (field: ImportField): string => {
      const column = mapping?.[field]
      return Number.isInteger(column) && column >= 0 && typeof cells[column] === 'string' ? cells[column].trim() : ''
    }
    const errors = [...new Set(mappingErrors)]
    const line = Number.isSafeInteger(row?.line) && row.line > 0 ? row.line : index + 2
    const result: ImportRow = { key: `import-row-${index + 1}`, line, sourceId: value('sourceId'), title: value('title'), errors }
    if (!validCells || cells.length !== table.headers.length) errors.push(`열 수가 제목 행의 ${table.headers.length}개와 다릅니다. 빈 셀의 구분자도 유지해 주세요.`)
    if (errors.length) return result
    if (!result.title) errors.push('제목을 입력해 주세요.')
    const startDate = dateValue(value('startDate'), '시작일', errors)
    const endDate = value('endDate') ? dateValue(value('endDate'), '종료일', errors) : startDate
    const rawStartTime = value('startTime'), rawEndTime = value('endTime'), allDay = !rawStartTime && !rawEndTime
    const startTime = timeValue(rawStartTime, '시작 시간', errors), endTime = timeValue(rawEndTime, '종료 시간', errors)
    if (!allDay && (!rawStartTime || !rawEndTime)) errors.push('시간 일정은 시작·종료 시간을 모두 입력해 주세요.')
    if (errors.length) return result
    try {
      result.draft = normalizeDraft({
        title: result.title, startDate, endDate, startTime, endTime, allDay,
        location: value('location'), description: value('description'), visibility: 'private',
        audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] },
      }, member, Array.isArray(members) ? members : [])
    } catch (error) { errors.push(error instanceof Error ? error.message : '일정 입력을 확인해 주세요.') }
    return result
  })
  const sourceIds = new Map<string, ImportRow[]>(), schedules = new Map<string, ImportRow[]>()
  for (const row of rows) {
    if (row.sourceId) sourceIds.set(row.sourceId, [...(sourceIds.get(row.sourceId) ?? []), row])
    if (row.draft) {
      const key = sameScheduleKey(row.draft)
      schedules.set(key, [...(schedules.get(key) ?? []), row])
    }
  }
  for (const [id, group] of sourceIds) if (group.length > 1) {
    for (const row of group) row.errors.push(`원본 ID “${id}”가 중복됩니다. 한 행만 남기거나 ID를 확인해 주세요.`)
  }
  for (const group of schedules.values()) if (group.length > 1) {
    for (const row of group) row.errors.push('제목·기간·시간이 같은 일정이 표 안에 중복됩니다. 원본을 확인해 주세요.')
  }
  for (const row of rows) if (row.errors.length) delete row.draft
  return rows
}

// 호출자가 현재 소속에서 읽을 수 있는 최신 목록만 전달한다. 일치해도 덮어쓰지 않는다.
export function findImportCandidates(draft: EventDraft, events: CalendarEvent[]): CalendarEvent[] {
  if (!draft || typeof draft.title !== 'string' || !Array.isArray(events)) return []
  const key = sameScheduleKey(draft)
  return events.filter(event => event && typeof event.title === 'string' && sameScheduleKey(event) === key)
}
