import { CLASS_KINDS, newSetupRowId, SETUP_LIMITS, validateSetupDraft, type SetupDraft } from './contract'
import { SCHOOL_ADMIN_LIMITS, schoolAdminSubjects, type SchoolSubject } from './school-admin-contract'
import { parseCsv, readCsvFile } from '../teaching/csv'
import csvPolicy from '../teaching/policy.json'
import workbookLimits from '../timetable/workbook-limits.json'
import { readTimetableXlsx, writeTimetableXlsx, type WorkbookSheet } from '../timetable/xlsx'

export const SCHOOL_BATCH_GROUPS = { classes: '학급', subjects: '교과', departments: '부서' } as const
export type SchoolBatchGroup = keyof typeof SCHOOL_BATCH_GROUPS
export interface SchoolBatchInput { group: SchoolBatchGroup; text: string; fileName?: string; fileScope?: SchoolBatchScope }
export interface SchoolBatchScope { schoolId: string; schoolYear: string }
export interface SchoolBatchValue { configuration: SetupDraft; subjects: SchoolSubject[] }
export interface SchoolBatchRow { line: number; id: string; label: string; state: 'add' | 'change' | 'same'; before: string; after: string }
export interface SchoolBatchPreview { group: SchoolBatchGroup; basis: string; next: SchoolBatchValue; rows: SchoolBatchRow[]; kept: number }
export const SCHOOL_BATCH_ROWS = csvPolicy.limits.csvRows
const fields = { classes: ['id', 'grade', 'classNo', 'name', 'kind'], subjects: ['id', 'name'], departments: ['id', 'name'] } as const
export const SCHOOL_BATCH_HEADERS = { classes: ['식별자', '학년', '반번호', '이름', '유형'], subjects: ['식별자', '이름'], departments: ['식별자', '이름'] } as const
const fail = (message: string): never => { throw new Error(message) }
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
export const schoolBatchCsv = (rows: readonly (readonly string[])[]): string => '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')
const groupRows = (value: SchoolBatchValue, group: SchoolBatchGroup) => (group === 'subjects' ? value.subjects : value.configuration[group]) as unknown as Record<string, string>[]
export function schoolBatchBasis(value: SchoolBatchValue, version: number): string { return JSON.stringify([version, value]) }
function tableText(text: string): string {
  // TSV를 먼저 셀로 분리한 뒤 CSV로 이스케이프한다. 셀의 쉼표를 열 구분으로 바꾸지 않는다.
  if (!text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].includes('\t')) return text
  if (new TextEncoder().encode(text).length > csvPolicy.limits.csvBytes) fail('붙여넣은 표가 너무 큽니다. 여러 번으로 나누어 입력해 주세요.')
  const source = text.replace(/^\uFEFF/, ''), rows: string[][] = []
  let row: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
  const finishCell = () => { if (cell.length > csvPolicy.limits.cellCharacters) fail('한 칸의 내용이 너무 깁니다.'); row.push(cell); cell = ''; state = 'start'; if (row.length > SCHOOL_BATCH_HEADERS.classes.length) fail('표의 열이 너무 많습니다.') }
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > SCHOOL_BATCH_ROWS + 1) fail(`한 번에 ${SCHOOL_BATCH_ROWS}행까지 입력할 수 있습니다.`) }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (state === 'quoted') {
      if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++ } else state = 'closed' } else cell += char
      if (cell.length > csvPolicy.limits.cellCharacters) fail('한 칸의 내용이 너무 깁니다.')
      continue
    }
    if (char === '\t') { finishCell(); continue }
    if (char === '\r' || char === '\n') { if (char === '\r' && source[i + 1] === '\n') i++; finishRow(); continue }
    if (state === 'closed') fail('닫는 따옴표 뒤에 잘못된 내용이 있습니다.')
    if (char === '"') { if (state !== 'start') fail('표의 따옴표 형식이 올바르지 않습니다.'); state = 'quoted'; continue }
    cell += char; state = 'plain'
    if (cell.length > csvPolicy.limits.cellCharacters) fail('한 칸의 내용이 너무 깁니다.')
  }
  if (state === 'quoted') fail('표의 닫는 따옴표가 없습니다.')
  if (cell !== '' || row.length || state === 'closed' || source.endsWith('\t')) finishRow()
  return schoolBatchCsv(rows)
}
export function schoolBatchTable(text: string, group: SchoolBatchGroup): string[][] {
  const [header, ...body] = parseCsv(tableText(text))
  if (JSON.stringify(header) !== JSON.stringify(SCHOOL_BATCH_HEADERS[group])) fail(`${SCHOOL_BATCH_GROUPS[group]} 양식의 항목 이름과 순서를 유지해 주세요.`)
  const rows = body.filter(row => row.some(cell => cell.trim()))
  if (!rows.length) fail('추가하거나 수정할 행을 넣어 주세요.')
  return rows
}
const describe = (row: Record<string, string>, group: SchoolBatchGroup) => group === 'classes'
  ? `${row.name} · ${row.grade}학년 · ${row.classNo || '미지정'}반 · ${CLASS_KINDS.find(item => item.value === row.kind)?.label ?? row.kind}` : row.name
export function previewSchoolBatch(input: SchoolBatchInput, value: SchoolBatchValue, version: number, makeId = newSetupRowId): SchoolBatchPreview {
  const incoming = schoolBatchTable(input.text, input.group), current = groupRows(value, input.group), next = structuredClone(value)
  const ids = new Set([value.configuration.draftId, ...value.configuration.terms.map(row => row.id), ...value.configuration.classes.map(row => row.id), ...value.configuration.departments.map(row => row.id), ...value.subjects.map(row => row.id)])
  const byId = new Map(current.map(row => [row.id, row])), used = new Set<string>(), rows: SchoolBatchRow[] = []
  const output = groupRows(next, input.group), byPosition = new Map(output.map((row, index) => [row.id, index]))
  incoming.forEach((cells, index) => {
    const row = Object.fromEntries(fields[input.group].map((key, i) => [key, cells[i].trim()]))
    const existing = row.id ? byId.get(row.id) : undefined
    if (row.id && !existing) fail(`${index + 2}행의 식별자는 현재 ${SCHOOL_BATCH_GROUPS[input.group]}에 없습니다. 다른 학교·학년도 자료를 연결하지 않습니다.`)
    if (row.id && used.has(row.id)) fail(`${index + 2}행의 식별자가 중복됩니다.`)
    if (!row.id && current.some(item => item.name.trim() === row.name)) fail(`${index + 2}행의 이름은 이미 있습니다. 이름으로 연결하지 않으므로 현재 자료 양식의 식별자를 유지해 주세요.`)
    if (!row.id) {
      row.id = makeId()
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(row.id) || ids.has(row.id)) fail('새 행 식별자를 준비하지 못했습니다. 다시 비교해 주세요.')
      ids.add(row.id)
    }
    used.add(row.id)
    if (existing) output[byPosition.get(row.id)!] = row
    else output.push(row)
    const same = existing && fields[input.group].every(key => existing[key] === row[key])
    rows.push({ line: index + 2, id: row.id, label: row.name, state: same ? 'same' : existing ? 'change' : 'add', before: existing ? describe(existing, input.group) : '새 항목', after: describe(row, input.group) })
  })
  const limit = input.group === 'subjects' ? SCHOOL_ADMIN_LIMITS.subjects : SETUP_LIMITS[input.group]
  if (output.length > limit) fail(`기존 자료와 합치면 ${SCHOOL_BATCH_GROUPS[input.group]} ${limit}개 한도를 넘습니다.`)
  if (input.group === 'subjects') {
    try { schoolAdminSubjects(next.subjects) } catch { fail('교과 이름·식별자가 비어 있거나 중복되는지 확인해 주세요.') }
  } else {
    const issues = validateSetupDraft(next.configuration).filter(issue => issue.path === 'draft' || issue.path.startsWith(`${input.group}.`) || (input.group === 'classes' && issue.path === 'gradeCount'))
    if (issues.length) fail(issues.map(issue => issue.message).join(' '))
  }
  return { group: input.group, basis: schoolBatchBasis(value, version), next, rows, kept: current.filter(row => !used.has(row.id)).length }
}
export function applySchoolBatch(preview: SchoolBatchPreview, value: SchoolBatchValue, version: number): SchoolBatchValue {
  if (preview.basis !== schoolBatchBasis(value, version)) fail('비교한 뒤 학교 자료 또는 편집 내용이 바뀌었습니다. 일괄 입력을 유지하고 다시 비교해 주세요.')
  return structuredClone(preview.next)
}
export function schoolBatchSheets(scope: SchoolBatchScope, value: SchoolBatchValue, group: SchoolBatchGroup, includeExisting = false): WorkbookSheet[] {
  const existing = includeExisting ? groupRows(value, group) : []
  if (existing.length > SCHOOL_BATCH_ROWS) fail(`현재 자료가 ${SCHOOL_BATCH_ROWS}행을 넘습니다. 빈 양식에 필요한 자료만 나누어 준비해 주세요.`)
  return [
    { name: '학교자료', rows: [[...SCHOOL_BATCH_HEADERS[group]], ...existing.map(row => fields[group].map(key => row[key]))] },
    { name: '작성안내', rows: [['항목', '안내'], ['대상', `${scope.schoolYear}학년도 ${SCHOOL_BATCH_GROUPS[group]}`], ['식별자', '새 항목은 비웁니다. 기존 항목 수정은 현재 자료의 식별자를 유지합니다. 이름으로 자동 연결하지 않습니다.'], ['유형', CLASS_KINDS.map(item => `${item.value}=${item.label}`).join(', ')], ['기존 자료', '파일에 없는 항목은 그대로 유지됩니다. 서버 저장 전 전체 변경을 다시 확인합니다.'], ['한도', `${SCHOOL_BATCH_ROWS}행까지 나누어 입력합니다. 수식·병합 셀을 쓰지 않습니다.`]] },
    { name: '_학교연결', hidden: true, rows: [['contract', 'school-configuration-batch.v1'], ['schoolId', scope.schoolId], ['schoolYear', scope.schoolYear], ['group', group]] },
  ]
}
export function schoolBatchWorkbook(scope: SchoolBatchScope, value: SchoolBatchValue, group: SchoolBatchGroup, includeExisting = false): Uint8Array {
  return writeTimetableXlsx(schoolBatchSheets(scope, value, group, includeExisting))
}
export function schoolBatchWorkbookText(sheets: WorkbookSheet[], scope: SchoolBatchScope, group: SchoolBatchGroup): string {
  const input = sheets.filter(sheet => sheet.name === '학교자료'), meta = sheets.filter(sheet => sheet.name === '_학교연결')
  const expected = [['contract', 'school-configuration-batch.v1'], ['schoolId', scope.schoolId], ['schoolYear', scope.schoolYear], ['group', group]]
  if (input.length !== 1 || meta.length !== 1 || JSON.stringify(meta[0].rows) !== JSON.stringify(expected)) fail('다른 학교·학년도·입력 종류의 양식입니다. 현재 화면의 양식을 받아 주세요.')
  const width = SCHOOL_BATCH_HEADERS[group].length
  if (input[0].rows.some(row => row.length > width)) fail('양식 밖의 열이 있습니다.')
  const text = schoolBatchCsv(input[0].rows.map(row => Array.from({ length: width }, (_, i) => row[i] ?? '')))
  schoolBatchTable(text, group)
  return text
}
export async function readSchoolBatchFile(file: File, scope: SchoolBatchScope, group: SchoolBatchGroup): Promise<string> {
  if (file.name.toLowerCase().endsWith('.csv')) { const text = await readCsvFile(file); schoolBatchTable(text, group); return text }
  if (!file.name.toLowerCase().endsWith('.xlsx')) fail('XLSX 또는 UTF-8 CSV 파일을 선택해 주세요.')
  if (file.size > workbookLimits.fileBytes) fail(`XLSX는 ${workbookLimits.fileBytes / 1048576} MiB 이하로 나누어 올려 주세요.`)
  return schoolBatchWorkbookText(readTimetableXlsx(new Uint8Array(await file.arrayBuffer())), scope, group)
}
