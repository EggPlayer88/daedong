import { canonical } from '../services/service-values'
import { setupCommand, setupSnapshot, type SetupCommand, type SetupSnapshot } from './setup'
import { TimetableWorkbookError, type WorkbookSheet } from './xlsx'
import policy from './setup-policy.json'
import workbookLimits from './workbook-limits.json'

export interface SetupWorkbookItem {
  id: string; label: string; command: SetupCommand; before: string[]; after: string[]
}
export interface SetupWorkbookPreview {
  sourceKey: string; items: SetupWorkbookItem[]; unchanged: number; notices: string[]
  referenceDayChange?: { from: string; to: string }
}
const headers = {
  기준: ['항목', '값'],
  공간: ['공간ID(수정금지)', '종류(수정금지)', '이름', '동시수업수(빈칸은미정)', '기준판(수정금지)'],
  수업연결: ['수업ID(수정금지)', '수업명(수정금지)', '연결판(수정금지)', '학급ID(|구분)', '별도수강집단(예·아니오)', '공간ID(|구분)'],
  공식학급: ['학급ID', '학급명', '학년'],
  공식수업: ['수업ID', '수업명', '편성대상', '교사명', '수강학생수'],
  원본대조: ['순서', '학교·준비원본(수정금지)'],
} as const
const fail = (message: string): never => { throw new TimetableWorkbookError(message) }
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const ordered = (ids: string[]) => [...ids].sort()
const sameIds = (a: string[], b: string[]) => canonical(ordered(a)) === canonical(ordered(b))
const capacityText = (capacity: number | null) => capacity === null ? '미입력' : `${capacity}개 수업`
const colName = (index: number) => String.fromCharCode(65 + index)
function at(sheet: string, line: number, column: number, message: string): never { return fail(`${sheet} 시트 ${line}행 ${colName(column)}열: ${message}`) }
function checkedSource(source: SetupSnapshot, schoolId: string): SetupSnapshot {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(schoolId)) fail('학교 식별자를 확인한 뒤 준비 자료를 다시 조회해 주세요.')
  try { return setupSnapshot(source) } catch { return fail('준비 원본을 확인하지 못했습니다. 현재 자료를 다시 조회해 주세요.') }
}
/** 같은 학교·같은 원본의 미리보기만 저장하도록 전체 원본을 묶는다. 회원별 파일은 아니다. */
export function setupWorkbookSourceKey(source: SetupSnapshot, schoolId: string): string {
  return canonical([schoolId, checkedSource(source, schoolId)])
}
function rawSheets(source: SetupSnapshot, schoolId: string): WorkbookSheet[] {
  const points = Array.from(canonical([schoolId, source])), pieces: string[][] = []
  // 서로게이트 쌍을 자르지 않아 긴 교사명·학급명도 엑셀 왕복에서 보존한다.
  for (let index = 0; index < points.length; index += 4000) pieces.push([String(pieces.length + 1), points.slice(index, index + 4000).join('')])
  return [
    { name: '안내', rows: [['준비 자료 엑셀', '사용 방법'],
      ['용도', '현재 공간과 수업 연결을 편집합니다. 가져온 뒤 변경 내용을 확인하고 선택한 항목만 저장합니다.'],
      ['수정할 칸', '공간의 이름·동시수업수 / 수업연결의 학급ID·별도수강집단·공간ID만 수정합니다.'],
      ['정원 의미', '학생 좌석 수가 아니라 동시에 진행할 수 있는 수업 수입니다. 빈칸은 미입력으로 남으며 임의로 1을 넣지 않습니다.'],
      ['ID 입력', '공식학급과 공간 시트의 ID를 복사합니다. 여러 ID는 |로 구분합니다. 이름이 같아도 다른 대상입니다.'],
      ['별도수강집단', '예는 수강 학생을 별도 집단으로 묶습니다. 이때 학급ID는 비웁니다. 아니오는 선택한 공식 학급을 사용합니다.'],
      ['추가·삭제', '행과 ID·종류·기준판을 바꾸지 않습니다. 새 공간 추가와 공간 삭제는 화면에서 처리합니다.'],
      ['공식 자료', '교사 배정·학급명·수강 학생 수는 참고 자료이며 이 파일로 수정할 수 없습니다.'],
      ['저장 방식', '항목별로 순서대로 저장합니다. 전체가 한 번에 성공하거나 취소되는 방식이 아니므로 중단 시 완료된 항목을 확인합니다.'],
      ['원본 유효기간', '학교·학기·원본이 바뀌면 새 양식을 내려받아 다시 확인합니다. 날짜만 지난 파일은 공식 자료·판·원본지문이 그대로인지 대조한 뒤 변경 비교를 다시 확인합니다.'],
      ['파일 보관', '교사명과 학급·수업 정보가 포함됩니다. 학교에서 허용한 위치에 보관해 주세요.']] },
    { name: '기준', rows: [Array.from(headers.기준), ['형식', 'timetable.setup.workbook.v1'], ['학교', schoolId], ['학기', source.termId], ['학기명', source.termLabel], ['학기시작', source.firstDay], ['학기종료', source.lastDay], ['기준일', source.referenceDay], ['기준판', String(source.sourceRevision)], ['원본지문', source.sourceFingerprint]] },
    { name: '공간', rows: [Array.from(headers.공간), ...source.spaces.map(row => [row.id, row.kind, row.label, row.capacity === null ? '' : String(row.capacity), String(row.version)])] },
    { name: '수업연결', rows: [Array.from(headers.수업연결), ...source.courses.map(row => [row.id, row.label, row.link ? String(row.link.version) : '', row.link?.classIds.join('|') ?? '', row.link?.studentGroup ? '예' : '아니오', row.link?.spaceIds.join('|') ?? ''])] },
    { name: '공식학급', rows: [Array.from(headers.공식학급), ...source.classes.map(row => [row.id, row.label, String(row.grade)])] },
    { name: '공식수업', rows: [Array.from(headers.공식수업), ...source.courses.map(row => [row.id, row.label, row.inTimetable ? '예' : '아니오', row.teacherLabels.join(' / '), String(row.studentCount)])] },
    { name: '원본대조', hidden: true, rows: [Array.from(headers.원본대조), ...pieces] },
  ]
}
export function setupWorkbookSheets(source: SetupSnapshot, schoolId: string): WorkbookSheet[] {
  return rawSheets(checkedSource(source, schoolId), schoolId)
}

/** 파일은 저장 명령을 직접 실행하지 않는다. 전후 비교와 원본 대조를 마친 명령만 돌려준다. */
export function previewSetupWorkbook(sheets: WorkbookSheet[], source: SetupSnapshot, schoolId: string): SetupWorkbookPreview {
  source = checkedSource(source, schoolId)
  if (!Array.isArray(sheets) || sheets.length > workbookLimits.sheets || sheets.some(sheet => !sheet || typeof sheet.name !== 'string' || !Array.isArray(sheet.rows) || sheet.rows.length > workbookLimits.rows || sheet.rows.some(row => !Array.isArray(row) || row.length > workbookLimits.columns || row.some(cell => typeof cell !== 'string' || cell.length > workbookLimits.cellChars)))) fail('읽을 수 있는 준비 자료 엑셀인지 확인해 주세요.')
  let expected = rawSheets(source, schoolId)
  const byName = new Map(sheets.map(sheet => [sheet.name, sheet]))
  if (byName.size !== sheets.length || byName.size !== expected.length || expected.some(sheet => !byName.has(sheet.name))) fail('필수 시트가 빠졌거나 다른 양식입니다. 현재 준비 화면에서 엑셀을 다시 내려받아 주세요.')
  function rows(name: keyof typeof headers): { line: number; cells: string[] }[] {
    const sheet = byName.get(name)!, header = Array.from(headers[name])
    const normalize = (row: string[], line: number) => {
      if (row.slice(header.length).some(cell => cell !== '')) at(name, line, header.length, '제공한 열 밖에 값이 있습니다.')
      return Array.from({ length: header.length }, (_, index) => row[index] ?? '')
    }
    if (canonical(normalize(sheet.rows[0] ?? [], 1)) !== canonical(header)) at(name, 1, 0, '제공한 열 이름을 유지해 주세요.')
    return sheet.rows.slice(1).map((row, index) => ({ line: index + 2, cells: normalize(row, index + 2) })).filter(row => row.cells.some(cell => cell !== ''))
  }
  function fixedTable(name: keyof typeof headers, wanted: string[][]) {
    const received = rows(name), originals = new Map(wanted.map(row => [row[0], row])), used = new Set<string>()
    for (const { cells, line } of received) {
      const original = originals.get(cells[0])
      if (!original || used.has(cells[0])) at(name, line, 0, '알 수 없거나 중복된 ID·항목입니다. 제공한 행을 유지해 주세요.')
      used.add(cells[0])
      const changed = original.findIndex((value, index) => value !== cells[index])
      if (changed >= 0) at(name, line, changed, '학교·학기 또는 공식 원본이 다릅니다. 현재 자료를 다시 내려받아 주세요.')
    }
    if (used.size !== originals.size) fail(`${name} 시트에서 제공한 행이 빠졌습니다. 행을 지우지 말아 주세요.`)
  }
  const fileReferenceDay = rows('기준').find(row => row.cells[0] === '기준일')?.cells[1]
  let referenceDayChange: SetupWorkbookPreview['referenceDayChange']
  if (fileReferenceDay && fileReferenceDay !== source.referenceDay) {
    // 지난 날짜 하나만 바꿔 과거 대조본을 재생성한다. 판·지문·실제 자료는 현재값 그대로 비교한다.
    // 미래 날짜나 학기 밖 날짜는 파일 메타데이터를 바꾼 것으로 보고 허용하지 않는다.
    if (fileReferenceDay > source.referenceDay) fail('기준 시트의 기준일이 현재 자료보다 뒤입니다. 제공한 기준 정보를 유지해 주세요.')
    let datedSource: SetupSnapshot
    try { datedSource = setupSnapshot({ ...source, referenceDay: fileReferenceDay }) }
    catch { return fail('기준 시트의 기준일이 올바르지 않거나 현재 학기 밖입니다. 제공한 기준 정보를 유지해 주세요.') }
    expected = rawSheets(datedSource, schoolId)
    referenceDayChange = { from: fileReferenceDay, to: source.referenceDay }
  }
  fixedTable('기준', expected.find(sheet => sheet.name === '기준')!.rows.slice(1))
  // 숨은 원본은 인증 장치가 아니라 자료가 바뀌었는지 확인하는 대조본이다. 서버는 별도로 권한·판을 검사한다.
  if (canonical(byName.get('원본대조')!.rows) !== canonical(expected.find(sheet => sheet.name === '원본대조')!.rows)) fail('원본대조 시트의 준비 자료가 현재 원본과 다릅니다. 새 양식을 내려받아 주세요.')
  for (const name of ['공식학급', '공식수업'] as const) fixedTable(name, expected.find(sheet => sheet.name === name)!.rows.slice(1))
  const items: SetupWorkbookItem[] = [], usedSpaces = new Set<string>(), usedCourses = new Set<string>()
  const planned = structuredClone(source)
  const linkDetails = (input: { studentGroup: boolean; classIds: string[]; spaceIds: string[] }) => [
    `대상: ${input.studentGroup ? '별도 수강집단' : input.classIds.length ? input.classIds.map(id => `${source.classes.find(row => row.id === id)?.label ?? '없어진 학급'} [${id}]`).join(', ') : '미연결'}`,
    `공간(원본 이름·ID): ${input.spaceIds.length ? input.spaceIds.map(id => `${source.spaces.find(row => row.id === id)?.label ?? '없어진 공간'} [${id}]`).join(', ') : '선택 없음'}`,
  ]
  for (const { cells: row, line } of rows('공간')) {
    const original = source.spaces.find(space => space.id === row[0])
    if (!original || usedSpaces.has(row[0])) at('공간', line, 0, '알 수 없거나 중복된 공간ID입니다. 추가·삭제는 화면에서 처리해 주세요.')
    usedSpaces.add(row[0])
    if (row[1] !== original.kind) at('공간', line, 1, '공간 종류는 파일에서 바꿀 수 없습니다.')
    if (row[4] !== String(original.version)) at('공간', line, 4, '공간의 기준판은 수정할 수 없습니다.')
    if (!row[2].trim() || Array.from(row[2]).length > policy.maxSpaceLabel || /[\u0000-\u001f\u007f]|[\uD800-\uDFFF]/u.test(row[2])) at('공간', line, 2, `공간 이름은 제어 문자가 없는 ${policy.maxSpaceLabel}자 이내의 글자로 입력해 주세요.`)
    const capacity = row[3] === '' ? null : Number(row[3])
    if (capacity !== null && (!/^[1-9][0-9]*$/.test(row[3]) || !Number.isSafeInteger(capacity) || capacity > policy.maxCapacity)) at('공간', line, 3, `동시수업수는 1~${policy.maxCapacity}의 정수로 입력하거나 빈칸으로 남겨 주세요.`)
    const target = planned.spaces.find(space => space.id === original.id)!
    target.label = row[2].trim(); target.capacity = capacity
    if (original.label === row[2].trim() && original.capacity === capacity) continue
    let command: SetupCommand
    try { command = setupCommand({ kind: 'space_save', spaceId: original.id, expectedVersion: original.version, input: { kind: original.kind, label: row[2], capacity } }, source) }
    catch { return at('공간', line, 2, '같은 종류의 다른 공간과 이름이 겹치거나 입력 형식이 맞지 않습니다. 이름 바꾸기 순서를 화면에서 확인해 주세요.') }
    items.push({ id: `space:${original.id}`, label: `${original.label} [${original.id}]`, command,
      before: [`이름: ${original.label}`, `동시수업수: ${capacityText(original.capacity)}`], after: [`이름: ${row[2]}`, `동시수업수: ${capacityText(capacity)}`] })
  }
  if (usedSpaces.size !== source.spaces.length) fail('공간 시트에서 공간 행이 빠졌습니다. 삭제는 화면에서 처리해 주세요.')
  const names = new Set<string>()
  for (const row of planned.spaces) {
    const key = canonical([row.kind, row.label])
    if (names.has(key)) fail(`공간 시트: 같은 종류의 공간 이름 '${row.label}'이 중복됩니다. 이름을 다르게 입력해 주세요.`)
    names.add(key)
  }
  const ids = (value: string, name: string, line: number, column: number, maximum: number) => {
    const values = value === '' ? [] : value.split('|')
    if (values.length > maximum || values.some(id => !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(values).size !== values.length) at(name, line, column, `중복 없이 ID를 |로 구분해 ${maximum}개 이하로 입력해 주세요. ID 사이 공백은 넣지 않습니다.`)
    return values
  }
  for (const { cells: row, line } of rows('수업연결')) {
    const original = source.courses.find(course => course.id === row[0])
    if (!original || usedCourses.has(row[0])) at('수업연결', line, 0, '알 수 없거나 중복된 수업ID입니다. 제공한 행을 유지해 주세요.')
    usedCourses.add(row[0])
    if (row[1] !== original.label) at('수업연결', line, 1, '공식 수업명은 파일에서 바꿀 수 없습니다.')
    if (row[2] !== (original.link ? String(original.link.version) : '')) at('수업연결', line, 2, '연결판은 수정할 수 없습니다.')
    const classIds = ids(row[3], '수업연결', line, 3, policy.maxClassIds), spaceIds = ids(row[5], '수업연결', line, 5, policy.maxSpaceIds)
    if (!['예', '아니오'].includes(row[4])) at('수업연결', line, 4, '별도수강집단은 예 또는 아니오로 입력해 주세요.')
    const input = { classIds, studentGroup: row[4] === '예', spaceIds }
    if (input.studentGroup && classIds.length) at('수업연결', line, 4, '별도수강집단을 선택할 때는 학급ID를 비워 주세요.')
    const previous = original.link ?? { classIds: [], studentGroup: false, spaceIds: [] }
    if (sameIds(previous.classIds, classIds) && previous.studentGroup === input.studentGroup && sameIds(previous.spaceIds, spaceIds)) continue
    if (classIds.some(id => !source.classes.some(row => row.id === id))) at('수업연결', line, 3, '현재 공식학급 시트에 없는 학급ID입니다. 연결을 직접 다시 선택해 주세요.')
    if (spaceIds.some(id => !source.spaces.some(row => row.id === id))) at('수업연결', line, 5, '현재 공간 시트에 없는 공간ID입니다. 연결을 직접 다시 선택해 주세요.')
    let command: SetupCommand
    try { command = setupCommand({ kind: 'course_link', courseId: original.id, expectedVersion: original.link?.version ?? null, input }, source) }
    catch { return at('수업연결', line, 0, '이 수업의 식별자 또는 연결 입력을 저장할 수 없습니다. 준비 화면에서 원본 문제를 확인해 주세요.') }
    planned.courses.find(course => course.id === original.id)!.link = { version: original.link?.version ?? 1, ...input }
    items.push({ id: `course:${original.id}`, label: `${original.label} [${original.id}]`, command, before: linkDetails(previous), after: linkDetails(input) })
  }
  if (usedCourses.size !== source.courses.length) fail('수업연결 시트에서 수업 행이 빠졌습니다. 행을 지우지 말고 연결할 학급·공간 칸을 수정해 주세요.')
  const notices: string[] = referenceDayChange ? [`파일 기준일(${referenceDayChange.from})에서 현재 기준일(${referenceDayChange.to})로 날짜만 바뀌었습니다. 학교·학기·공식 자료·판·원본지문이 그대로인지 대조했습니다. 저장할 변경 내용을 다시 확인해 주세요.`] : []
  const missingCapacity = planned.spaces.filter(row => row.capacity === null).length
  const missingLinks = planned.courses.filter(row => !row.link || (!row.link.studentGroup && !row.link.classIds.length)).length
  const excluded = planned.courses.filter(row => !row.inTimetable).length
  const brokenLinks = planned.courses.filter(row => row.link && (row.link.classIds.some(id => !planned.classes.some(c => c.id === id)) || row.link.spaceIds.some(id => !planned.spaces.some(s => s.id === id)))).length
  if (missingCapacity) notices.push(`파일 전체 기준 ${missingCapacity}개 공간의 동시수업수가 미입력입니다. 빈칸은 미정으로 보존됩니다. 편성에 사용할 공간은 기준 확정 전에 채워야 합니다.`)
  if (missingLinks) notices.push(`파일 전체 기준 ${missingLinks}개 수업이 학급·수강집단에 연결되지 않았습니다. 자동으로 연결하지 않습니다.`)
  if (excluded) notices.push(`${excluded}개 수업은 현재 편성 대상에서 제외되어 있습니다. 연결을 수정해도 학사 기간·원본 문제가 자동으로 해결되지는 않습니다.`)
  if (brokenLinks) notices.push(`${brokenLinks}개 수업의 변경하지 않은 원본에 없어진 학급·공간 연결이 있습니다. 해당 수업은 화면에서 직접 확인해 주세요.`)
  return { sourceKey: canonical([schoolId, source]), items: [...items.filter(item => item.command.kind === 'space_save').sort(compareId), ...items.filter(item => item.command.kind === 'course_link').sort(compareId)], unchanged: source.spaces.length + source.courses.length - items.length, notices, ...(referenceDayChange ? { referenceDayChange } : {}) }
}
