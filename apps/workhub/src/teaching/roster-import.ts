import type { CourseSnapshot, RosterRow, Student } from './contracts'
import { TeachingError } from './contracts'
import { csvHash, parseRosterCsv, readCsvFile } from './csv'
import policy from './policy.json'
import workbookLimits from '../timetable/workbook-limits.json'
import { readTimetableXlsx, writeTimetableXlsx, type WorkbookSheet } from '../timetable/xlsx'

const contract = 'teaching-roster-workbook.v1'
const inputSheet = '수강명부', scopeSheet = '_수업연결'
const fail = (message: string): never => { throw new TeachingError('INVALID_INPUT', message) }
export interface RosterFileInfo { name: string; format: 'csv' | 'xlsx'; fingerprint: string }
export interface RosterImportReviewInput { roster: RosterRow[]; validFrom: string; validThrough: string; expectedVersion: number; rosterBasis?: string }
export interface RosterComparisonRow { row: RosterRow; rowNumber: number; state: 'new' | 'matched' | 'correction'; existing: Student | null; differences: string[] }
export interface RosterComparison { rows: RosterComparisonRow[]; added: number; matched: number; corrections: number; kept: number; periodError: string }
const copyRow = (student: RosterRow): RosterRow => ({ schoolStudentKey: student.schoolStudentKey, name: student.name, grade: student.grade, classLabel: student.classLabel, seatNumber: student.seatNumber })
// 검증용 내부 CSV는 값을 보존한다. 내려받는 파일은 문자열 셀 XLSX를 사용한다.
export const rosterRawCsv = (rows: readonly RosterRow[]): string => '\uFEFF' + [policy.rosterHeaders, ...rows.map(row => [row.schoolStudentKey, row.name, row.grade, row.classLabel, row.seatNumber])]
  .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
const ordered = (students: readonly Student[]) => [...students].sort((a, b) => a.id.localeCompare(b.id)).map(student => ({
  id: student.id, version: student.version, ...copyRow(student), enrollmentId: student.enrollmentId,
  courseMembershipId: student.courseMembershipId, validFrom: student.validFrom, validThrough: student.validThrough,
}))
/** 현재 탭의 대조 기준이다. 학생 자료를 브라우저 영속 저장소나 URL에 넣지 않는다. */
export function rosterReviewBasis(course: CourseSnapshot): string {
  return JSON.stringify([course.schoolId, course.memberId, course.ownerUserId, course.course.id, course.course.version,
    course.course.validFrom, course.course.validThrough, course.course.canManageRoster, ordered(course.students)])
}
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export function compareRosterImport(rows: readonly RosterRow[], course: CourseSnapshot, validFrom: string, validThrough: string): RosterComparison {
  const checked = rows.length ? parseRosterCsv(rosterRawCsv(rows)) : []
  const periodError = !validDate(validFrom) || !validDate(validThrough) || validFrom > validThrough
    ? '수강 시작일과 종료일을 확인해 주세요.'
    : validFrom < course.course.validFrom || validThrough > course.course.validThrough
      ? `수강 기간은 수업 기간 ${course.course.validFrom} ~ ${course.course.validThrough} 안에 있어야 합니다.` : ''
  const byKey = new Map<string, Student[]>(), bySeat = new Map<string, Student[]>()
  const seatKey = (student: RosterRow) => JSON.stringify([student.grade, student.classLabel, student.seatNumber])
  for (const student of course.students) {
    byKey.set(student.schoolStudentKey, [...(byKey.get(student.schoolStudentKey) ?? []), student])
    const seat = seatKey(student); bySeat.set(seat, [...(bySeat.get(seat) ?? []), student])
  }
  const result = checked.map((row, index): RosterComparisonRow => {
    const matches = byKey.get(row.schoolStudentKey) ?? [], existing = matches.length === 1 ? matches[0] : null, differences: string[] = []
    if (matches.length > 1) differences.push('현재 명부에 같은 학교내학생번호가 여러 건입니다. 원본을 확인해 주세요.')
    if (existing) {
      for (const [key, label] of [['name', '이름'], ['grade', '학년'], ['classLabel', '반'], ['seatNumber', '번호']] as const) {
        if (row[key] !== existing[key]) differences.push(`${label}: 현재 ${existing[key]} → 파일 ${row[key]}`)
      }
      if (existing.validFrom !== validFrom || existing.validThrough !== validThrough) differences.push(`수강 기간: 현재 ${existing.validFrom} ~ ${existing.validThrough} → 입력 ${validFrom} ~ ${validThrough}`)
    }
    const occupied = bySeat.get(seatKey(row))?.find(student => student.schoolStudentKey !== row.schoolStudentKey &&
      validFrom <= student.validThrough && validThrough >= student.validFrom)
    if (occupied) differences.push('같은 수강 기간의 학년·반·번호를 다른 학교내학생번호가 사용합니다. 학생번호와 학적을 직접 확인해 주세요.')
    return { row, rowNumber: index + 2, existing, differences, state: differences.length ? 'correction' : existing ? 'matched' : 'new' }
  })
  const imported = new Set(checked.map(row => row.schoolStudentKey))
  return { rows: result, added: result.filter(row => row.state === 'new').length, matched: result.filter(row => row.state === 'matched').length,
    corrections: result.filter(row => row.state === 'correction').length, kept: course.students.filter(row => !imported.has(row.schoolStudentKey)).length, periodError }
}
export function assertRosterImportReady(input: RosterImportReviewInput, course: CourseSnapshot): RosterComparison {
  if (!course.course.canManageRoster) fail('현재 수업의 명부 관리 권한을 다시 확인해 주세요.')
  if (!input.roster.length) fail('가져올 학생을 먼저 확인해 주세요.')
  if (input.expectedVersion !== course.course.version || input.rosterBasis !== rosterReviewBasis(course)) fail('현재 명부가 바뀌었습니다. 입력을 유지한 채 최신 명부와 다시 비교해 주세요.')
  const result = compareRosterImport(input.roster, course, input.validFrom, input.validThrough)
  if (result.periodError) fail(result.periodError)
  if (result.corrections) fail('기존 학생 정보나 수강 기간이 다른 행이 있습니다. 기존 자료를 정정하거나 파일을 고친 뒤 다시 확인해 주세요.')
  return result
}
export function rosterWorkbookSheets(course: CourseSnapshot, includeExisting = false): WorkbookSheet[] {
  if (includeExisting && course.students.length > policy.limits.csvRows) fail(`현재 명부가 ${policy.limits.csvRows}명을 넘어 한 파일로 가져올 수 없습니다. 빈 양식으로 나누어 준비해 주세요.`)
  return [
    { name: inputSheet, rows: [[...policy.rosterHeaders], ...(includeExisting ? course.students.map(student => [student.schoolStudentKey, student.name, String(student.grade), student.classLabel, String(student.seatNumber)]) : [])] },
    { name: '작성안내', rows: [['항목', '안내'], ['수업', `${course.course.label} [${course.course.id}]`], ['수업 기간', `${course.course.validFrom} ~ ${course.course.validThrough}`],
      ['학교내학생번호', '공식 학생번호를 문자로 입력하세요. 앞자리 0을 지우거나 이름으로 대신 연결하지 않습니다.'],
      ['입력 범위', `${policy.limits.csvRows}행까지. 수강명부 시트의 항목 이름과 순서를 유지하고 수식·병합 셀은 사용하지 않습니다.`],
      ['기존 학생', '이름·학년·반·번호·수강 기간이 다르면 자동 변경하지 않습니다. 사이트에서 정정하거나 파일을 고쳐 주세요.'],
      ['누락 학생', '파일에서 빠진 학생과 기존 기록은 유지됩니다. 명부 전체를 삭제·교체하는 기능이 아닙니다.'],
      ['확인 범위', '화면에서 읽은 현재 수업 명부만 대조합니다. 다른 수업의 학생과 학교 전체 학생번호는 저장 시 서버가 다시 확인합니다.']] },
    { name: scopeSheet, hidden: true, rows: [['contract', contract], ['schoolId', course.schoolId], ['courseId', course.course.id]] },
  ]
}
export function rosterWorkbook(course: CourseSnapshot, includeExisting = false): Uint8Array { return writeTimetableXlsx(rosterWorkbookSheets(course, includeExisting)) }
export function rosterWorkbookCsv(sheets: WorkbookSheet[], course: CourseSnapshot): string {
  const inputs = sheets.filter(sheet => sheet.name === inputSheet), scopes = sheets.filter(sheet => sheet.name === scopeSheet)
  if (inputs.length !== 1 || scopes.length !== 1) fail('사이트에서 받은 수강 명부 XLSX 양식을 사용해 주세요.')
  if (JSON.stringify(scopes[0].rows) !== JSON.stringify([['contract', contract], ['schoolId', course.schoolId], ['courseId', course.course.id]])) fail('다른 학교 또는 수업의 명부 양식입니다. 현재 수업의 양식을 받아 주세요.')
  const [header, ...body] = inputs[0].rows
  if (JSON.stringify(header) !== JSON.stringify(policy.rosterHeaders)) fail('수강명부 시트의 항목 이름이나 순서가 바뀌었습니다.')
  const rows = body.filter(row => row.some(value => value.trim() !== ''))
  if (!rows.length || rows.length > policy.limits.csvRows) fail(`학생을 1~${policy.limits.csvRows}행 넣어 주세요.`)
  if (rows.some(row => row.length > policy.rosterHeaders.length)) fail('수강명부 시트에 양식 밖의 열이 있습니다.')
  const raw = '\uFEFF' + [policy.rosterHeaders, ...rows.map(row => policy.rosterHeaders.map((_, i) => row[i] ?? ''))]
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  parseRosterCsv(raw)
  return raw
}
export async function readRosterFile(file: File, course: CourseSnapshot): Promise<{ rawCsv: string; roster: RosterRow[]; file: RosterFileInfo }> {
  const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : file.name.toLowerCase().endsWith('.csv') ? 'csv' : null
  if (!format) return fail('수강 명부는 XLSX 또는 UTF-8 CSV 파일로 올려 주세요.')
  let rawCsv: string
  if (format === 'xlsx') {
    if (file.size > workbookLimits.fileBytes) fail(`XLSX는 ${workbookLimits.fileBytes / 1048576} MiB 이하로 나누어 올려 주세요.`)
    rawCsv = rosterWorkbookCsv(readTimetableXlsx(new Uint8Array(await file.arrayBuffer())), course)
  } else rawCsv = await readCsvFile(file)
  return { rawCsv, roster: parseRosterCsv(rawCsv), file: { name: file.name, format, fingerprint: await csvHash(rawCsv) } }
}
