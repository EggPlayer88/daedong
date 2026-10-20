import type { PreparationSource } from './preparation'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { parsePilotCsvRows } from './pilot/roster'
import { timetableImportReference, timetableImportTemplate } from './import-csv'
import { readTimetableXlsx, writeTimetableXlsx, type WorkbookSheet } from './xlsx'

const contract = 'timetable-import-workbook.v1'
const inputSheet = '시간표입력', sourceSheet = '_학교연결'
const machineHeaders = ['lessonId', 'courseId', 'day', 'label', 'start', 'end', 'periods', 'teacherIds', 'classIds', 'roomIds']
const headers = ['수업활동 ID', '수업 ID', '요일(1~7)', '수업 표시명', '시작(HH:MM)', '종료(HH:MM)', '차시 수', '교사 ID', '학급 ID', '공간 ID', '수업 이름(참고)', '교사(참고)', '학급(참고)', '공간(참고)']
const fail = (message: string): never => { throw Object.assign(new ServiceError('INVALID_INPUT'), { message }) }
// 내부 전달용 CSV다. 엑셀 다운로드는 모든 셀을 문자열로 쓰는 기존 XLSX 작성기를 사용한다.
const toCsv = (rows: string[][]) => '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
const resourceLabels = (source: PreparationSource, ids: string) => ids.split('|').filter(Boolean).map(id => {
  const item = source.resources.find(resource => resource.id === id)
  return item ? `${item.label} [${item.id}]` : `[${id}]`
}).join(' · ')

export async function timetableImportWorkbookSheets(source: PreparationSource): Promise<WorkbookSheet[]> {
  const rows = parsePilotCsvRows(await timetableImportTemplate(source)).slice(1).map(row => {
    const course = source.courses.find(value => value.id === row[1])!
    return [...row, course.label, resourceLabels(source, row[7]), resourceLabels(source, row[8]), resourceLabels(source, row[9])]
  })
  return [
    { name: inputSheet, rows: [[...headers], ...rows] },
    { name: '공식자료', rows: parsePilotCsvRows(timetableImportReference(source)) },
    { name: '작성안내', rows: [
      ['항목', '안내'],
      ['대상 학기', `${source.termLabel} (${source.firstDay} ~ ${source.lastDay})`],
      ['입력', '시간표입력 시트의 요일·표시명·시작·종료·차시 수를 채우세요. 요일은 월요일 1부터 일요일 7까지입니다.'],
      ['시각', '09:00처럼 시와 분을 문자로 입력하세요. 자정을 넘는 수업은 받지 않습니다.'],
      ['공식 연결', 'ID는 이름으로 추정하지 않습니다. 담당·학급·공간이 다르면 사이트에서 공식 수업 연결을 먼저 정정하세요.'],
      ['참고 열', '수업 이름·교사·학급·공간의 참고 열은 설명용입니다. 참고 이름을 바꿔도 배정은 바뀌지 않습니다.'],
      ['전체 수업', '선택한 학기 전체 수업이 필요합니다. 행을 빠뜨리지 말고 수식·병합 셀 대신 값을 입력하세요.'],
      ['학교 자료 변경', '학교·학기·공식 자료가 달라졌다면 새 양식을 받으세요. 업로드해도 저장·공개는 자동 실행하지 않습니다.'],
    ] },
    { name: sourceSheet, hidden: true, rows: [['contract', contract], ['schoolId', source.schoolId], ['termId', source.termId], ['sourceFingerprint', source.sourceFingerprint]] },
  ]
}
export async function timetableImportWorkbook(source: PreparationSource): Promise<Uint8Array> {
  return writeTimetableXlsx(await timetableImportWorkbookSheets(source))
}
export function timetableImportWorkbookCsv(sheets: WorkbookSheet[], source: PreparationSource): string {
  const metadata = sheets.find(sheet => sheet.name === sourceSheet), input = sheets.find(sheet => sheet.name === inputSheet)
  if (!metadata || !input || sheets.filter(sheet => sheet.name === inputSheet || sheet.name === sourceSheet).length !== 2) return fail('사이트에서 받은 실제 시간표 XLSX 양식을 사용해 주세요.')
  const expected = [['contract', contract], ['schoolId', source.schoolId], ['termId', source.termId], ['sourceFingerprint', source.sourceFingerprint]]
  if (canonical(metadata.rows) !== canonical(expected)) fail('다른 학교·학기이거나 학교 자료가 변경된 양식입니다. 현재 자료로 새 양식을 받아 주세요. 기존 입력은 유지합니다.')
  if (canonical(input.rows[0]) !== canonical(headers)) fail('시간표입력 시트의 열 이름이나 순서가 바뀌었습니다. 원래 양식을 사용해 주세요.')
  const rows = input.rows.slice(1).filter(row => row.some(cell => cell.trim() !== ''))
  if (!rows.length || rows.length > 5000) fail('시간표입력 시트에는 수업 배치를 1~5,000행 넣어 주세요.')
  const values = rows.map((row, index) => {
    if (row.length > headers.length) fail(`${index + 2}행에 양식 밖의 열이 있습니다.`)
    // 시각 셀의 엑셀 내부 소수를 임의 시각으로 바꾸지 않는다.
    if ([row[4], row[5]].some(value => value && !/^\d{2}:\d{2}$/.test(value))) fail(`${index + 2}행의 시각은 09:00처럼 문자로 입력해 주세요.`)
    return Array.from({ length: machineHeaders.length }, (_, i) => row[i] ?? '')
  })
  return toCsv([machineHeaders, ...values])
}
export function readTimetableImportWorkbook(bytes: Uint8Array, source: PreparationSource): string {
  return timetableImportWorkbookCsv(readTimetableXlsx(bytes), source)
}

export interface ImportDisplayRow { id: string; course: string; day: string; label: string; time: string; periods: string; teachers: string; classes: string; rooms: string }
/** 표시용 변환이며 허용 판정은 reviewTimetableImport와 서버가 담당한다. */
export function timetableImportDisplayRows(csv: string, source: PreparationSource): ImportDisplayRow[] {
  const rows = parsePilotCsvRows(csv)
  if (canonical(rows[0]) !== canonical(machineHeaders)) return []
  const days = ['', '월', '화', '수', '목', '금', '토', '일']
  return rows.slice(1).map(row => ({
    id: row[0], course: `${source.courses.find(course => course.id === row[1])?.label ?? '알 수 없는 수업'} [${row[1]}]`,
    day: days[Number(row[2])] ?? row[2], label: row[3], time: `${row[4]} ~ ${row[5]}`, periods: row[6],
    teachers: resourceLabels(source, row[7]), classes: resourceLabels(source, row[8]), rooms: resourceLabels(source, row[9]),
  }))
}
