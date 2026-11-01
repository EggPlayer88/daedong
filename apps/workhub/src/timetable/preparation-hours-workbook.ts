import { canonical, exact } from '../services/service-values'
import { preparationDraft, preparationSource, type PreparationDraft, type PreparationSource } from './preparation'
import { readTimetableXlsx, writeTimetableXlsx, TimetableWorkbookError, type WorkbookSheet } from './xlsx'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'
import workbookLimits from './workbook-limits.json'

export interface PreparationHoursChange {
  courseId: string; label: string; before: number; after: number; activityPeriods: number; warnings: string[]
}
export interface PreparationHoursPreview {
  sourceKey: string
  hours: { courseId: string; weeklyPeriods: number }[]
  changes: PreparationHoursChange[]
  unchanged: number
  warnings: string[]
}
const headers = {
  기준: ['항목', '값'],
  주당시수: ['수업ID(수정금지)', '수업명(수정금지)', '공식시수(수정금지)', '배정참고(수정금지)', '현재시수(수정금지)', '활동합계(수정금지)', '입력시수'],
  공식배정: ['자원ID(수정금지)', '종류(수정금지)', '이름(수정금지)', '동시수업수(수정금지)'],
  원본대조: ['순서', '준비원본·현재입력(수정금지)'],
} as const
const fail = (message: string): never => { throw new TimetableWorkbookError(message) }
function at(sheet: string, line: number, column: number, message: string): never {
  return fail(`${sheet} 시트 ${line}행 ${String.fromCharCode(65 + column)}열: ${message}`)
}
function checked(source: PreparationSource, draft: PreparationDraft): { source: PreparationSource; draft: PreparationDraft } {
  try {
    const current = preparationSource(source, source?.schoolId)
    return { source: current, draft: preparationDraft(draft, current) }
  } catch { return fail('준비 원본 또는 현재 입력을 확인하지 못했습니다. 준비 화면에서 자료를 다시 확인해 주세요.') }
}
/** 학교·학기뿐 아니라 현재 초안 전체를 대조해 파일을 읽는 동안 바뀐 입력도 보호한다. */
export function preparationHoursWorkbookKey(source: PreparationSource, draft: PreparationDraft): string {
  const current = checked(source, draft)
  return canonical([current.source, current.draft])
}
function rawSheets(source: PreparationSource, draft: PreparationDraft): WorkbookSheet[] {
  const sourceKey = canonical([source, draft]), points = Array.from(sourceKey), pieces: string[][] = []
  // 긴 원본은 서로게이트 쌍을 자르지 않고 나누며, 숨은 시트는 인증이 아닌 변경 대조용이다.
  for (let index = 0; index < points.length; index += 4000) pieces.push([String(pieces.length + 1), points.slice(index, index + 4000).join('')])
  const plans = new Map(draft.plans.map(plan => [plan.courseId, plan])), resources = new Map(source.resources.map(resource => [resource.id, resource]))
  return [
    { name: '안내', rows: [['주당 시수 준비 엑셀', '사용 방법'],
      ['수정할 칸', '주당시수 시트의 입력시수(G열)만 수정합니다. 수업ID와 모든 행을 유지해 주세요. 행 순서 변경은 가능합니다.'],
      ['공식 시수', '공식시수가 있는 수업은 파일에서 바꿀 수 없습니다. 공식시수가 미정인 수업만 담당자가 입력합니다.'],
      ['입력 범위', `0~${limits.maxCoursePeriods}의 정수를 입력합니다. 0은 아직 정하지 않은 시수이며, 빈칸이나 소수·수식은 받지 않습니다.`],
      ['수업 활동', '시수만 바뀝니다. 기존 시간대·수업 활동·허용 시간대는 그대로 보존하므로 활동 합계가 다르면 화면에서 조정해 주세요.'],
      ['적용 절차', '가져오기 → 전후 비교 → 변경할 수업 선택 → 현재 준비 입력에 반영합니다. 서버 저장과 기준판 확정은 준비 화면에서 따로 합니다.'],
      ['원본 유효기간', '학교·학기·공식 자료 또는 현재 준비 입력이 바뀌면 기존 파일은 반영할 수 없습니다. 새 양식에 옮겨 다시 확인해 주세요.'],
      ['공식 배정', '교사·학급·공간 배정은 참고 자료입니다. 이름이 같아도 ID로 구분하며 이 파일에서 배정을 바꾸지 않습니다.'],
      ['파일 보관', '교사·학급·수업 정보가 포함됩니다. 학교에서 허용한 위치에 보관해 주세요.']] },
    { name: '기준', rows: [Array.from(headers.기준), ['형식', 'timetable.preparation.hours.workbook.v1'], ['학교', source.schoolId], ['학기', source.termId], ['학기명', source.termLabel], ['학기시작', source.firstDay], ['학기종료', source.lastDay], ['기준판', String(source.sourceRevision)], ['원본지문', source.sourceFingerprint], ['준비이름', draft.title], ['저장초안ID', source.savedDraft?.id ?? ''], ['저장초안판', source.savedDraft ? String(source.savedDraft.revision) : '']] },
    { name: '주당시수', rows: [Array.from(headers.주당시수), ...source.courses.map(course => {
      const plan = plans.get(course.id)!
      return [course.id, course.label, course.requiredPeriods === null ? '미정' : String(course.requiredPeriods), course.resourceIds.map(id => `${resources.get(id)!.label} [${id}]`).join(' / '), String(plan.weeklyPeriods), String(plan.blocks.reduce((sum, block) => sum + block.periods, 0)), String(plan.weeklyPeriods)]
    })] },
    { name: '공식배정', rows: [Array.from(headers.공식배정), ...source.resources.map(resource => [resource.id, resource.kind, resource.label, String(resource.capacity)])] },
    { name: '원본대조', hidden: true, rows: [Array.from(headers.원본대조), ...pieces] },
  ]
}
export function preparationHoursWorkbookSheets(source: PreparationSource, draft: PreparationDraft): WorkbookSheet[] {
  const current = checked(source, draft)
  return rawSheets(current.source, current.draft)
}
export function exportPreparationHoursWorkbook(source: PreparationSource, draft: PreparationDraft): Uint8Array {
  return writeTimetableXlsx(preparationHoursWorkbookSheets(source, draft))
}
function rebuildPreview(source: PreparationSource, draft: PreparationDraft, values: unknown): PreparationHoursPreview {
  if (!source.canEdit) fail('현재 계정은 준비 시수를 수정할 수 없습니다. 권한과 원본을 다시 확인해 주세요.')
  if (!Array.isArray(values) || values.length !== source.courses.length) return fail('시수 미리보기의 수업 목록이 현재 준비 자료와 다릅니다. 파일을 다시 읽어 주세요.')
  const received = new Map<string, number>()
  for (const value of values) {
    try { exact(value, ['courseId', 'weeklyPeriods']) } catch { return fail('시수 미리보기의 입력 형식을 확인하지 못했습니다. 파일을 다시 읽어 주세요.') }
    const course = source.courses.find(course => course.id === value.courseId)
    if (!course || received.has(course.id) || !Number.isSafeInteger(value.weeklyPeriods) || (value.weeklyPeriods as number) < 0 || (value.weeklyPeriods as number) > limits.maxCoursePeriods || course.requiredPeriods !== null && value.weeklyPeriods !== course.requiredPeriods) return fail('시수 미리보기의 수업·공식 시수·입력 범위를 확인하지 못했습니다. 파일을 다시 읽어 주세요.')
    received.set(course.id, value.weeklyPeriods as number)
  }
  const courses = new Map(source.courses.map(course => [course.id, course])), changes: PreparationHoursChange[] = []
  for (const plan of draft.plans) {
    const after = received.get(plan.courseId)!, activityPeriods = plan.blocks.reduce((sum, block) => sum + block.periods, 0)
    if (after === plan.weeklyPeriods) continue
    const warnings: string[] = []
    if (!after) warnings.push('시수가 0이므로 미완성으로 남습니다. 기준판 확정 전에 시수를 입력해 주세요.')
    if (after !== activityPeriods) warnings.push(`기존 수업 활동 합계 ${activityPeriods}차시는 유지됩니다. 입력시수 ${after}차시에 맞게 활동을 직접 조정해 주세요.`)
    changes.push({ courseId: plan.courseId, label: courses.get(plan.courseId)!.label, before: plan.weeklyPeriods, after, activityPeriods, warnings })
  }
  const warnings: string[] = []
  const mismatch = changes.filter(change => change.after !== change.activityPeriods).length
  if (mismatch) warnings.push(`${mismatch}개 변경 수업의 시수와 기존 활동 합계가 다릅니다. 선택해 반영해도 활동·시간대는 자동으로 바뀌지 않습니다.`)
  const incomplete = source.courses.filter(course => received.get(course.id) === 0).length
  if (incomplete) warnings.push(`파일 전체 기준 ${incomplete}개 수업의 시수가 0입니다. 미완성 초안은 저장할 수 있지만 기준판 확정 전 보완이 필요합니다.`)
  return { sourceKey: canonical([source, draft]), hours: source.courses.map(course => ({ courseId: course.id, weeklyPeriods: received.get(course.id)! })), changes, unchanged: source.courses.length - changes.length, warnings }
}
export function previewPreparationHoursWorkbook(sheets: WorkbookSheet[], source: PreparationSource, draft: PreparationDraft): PreparationHoursPreview {
  const current = checked(source, draft); source = current.source; draft = current.draft
  if (!Array.isArray(sheets) || sheets.length > workbookLimits.sheets || sheets.some(sheet => !sheet || typeof sheet.name !== 'string' || !Array.isArray(sheet.rows) || sheet.rows.length > workbookLimits.rows || sheet.rows.some(row => !Array.isArray(row) || row.length > workbookLimits.columns || row.some(cell => typeof cell !== 'string' || cell.length > workbookLimits.cellChars)))) fail('읽을 수 있는 주당 시수 엑셀인지 확인해 주세요.')
  const expected = rawSheets(source, draft), byName = new Map(sheets.map(sheet => [sheet.name, sheet]))
  if (byName.size !== sheets.length || byName.size !== expected.length || expected.some(sheet => !byName.has(sheet.name))) fail('필수 시트가 빠졌거나 다른 양식입니다. 현재 준비 화면에서 시수 엑셀을 다시 내려받아 주세요.')
  function rows(name: keyof typeof headers): { cells: string[]; line: number }[] {
    const sheet = byName.get(name)!, header = Array.from(headers[name])
    const normalize = (row: string[], line: number) => {
      if (row.slice(header.length).some(cell => cell !== '')) at(name, line, header.length, '제공한 열 밖에 값이 있습니다.')
      return Array.from({ length: header.length }, (_, index) => row[index] ?? '')
    }
    if (canonical(normalize(sheet.rows[0] ?? [], 1)) !== canonical(header)) at(name, 1, 0, '제공한 열 이름을 유지해 주세요.')
    return sheet.rows.slice(1).map((row, index) => ({ cells: normalize(row, index + 2), line: index + 2 })).filter(row => row.cells.some(cell => cell !== ''))
  }
  function fixedTable(name: '기준' | '공식배정') {
    const wanted = expected.find(sheet => sheet.name === name)!.rows.slice(1), originals = new Map(wanted.map(row => [row[0], row])), used = new Set<string>()
    for (const { cells, line } of rows(name)) {
      const original = originals.get(cells[0])
      if (!original || used.has(cells[0])) at(name, line, 0, '알 수 없거나 중복된 ID·항목입니다. 제공한 행을 유지해 주세요.')
      used.add(cells[0])
      const changed = original.findIndex((cell, index) => cell !== cells[index])
      if (changed >= 0) at(name, line, changed, '학교·학기 또는 공식 원본이 다릅니다. 현재 자료를 다시 내려받아 주세요.')
    }
    if (used.size !== originals.size) fail(`${name} 시트에서 제공한 행이 빠졌습니다. 행을 지우지 말아 주세요.`)
  }
  fixedTable('기준'); fixedTable('공식배정')
  if (canonical(byName.get('원본대조')!.rows) !== canonical(expected.find(sheet => sheet.name === '원본대조')!.rows)) fail('원본대조 시트가 현재 준비 자료·입력과 다릅니다. 시수 엑셀을 새로 내려받아 주세요.')
  const originals = new Map(expected.find(sheet => sheet.name === '주당시수')!.rows.slice(1).map(row => [row[0], row])), values: { courseId: string; weeklyPeriods: number }[] = [], used = new Set<string>()
  for (const { cells, line } of rows('주당시수')) {
    const original = originals.get(cells[0])
    if (!original || used.has(cells[0])) at('주당시수', line, 0, '알 수 없거나 중복된 수업ID입니다. 제공한 행을 유지해 주세요.')
    used.add(cells[0])
    const changed = original.slice(0, 6).findIndex((cell, index) => cell !== cells[index])
    if (changed >= 0) at('주당시수', line, changed, '공식 배정과 현재 입력은 파일에서 바꿀 수 없습니다. 입력시수(G열)만 수정해 주세요.')
    const weeklyPeriods = Number(cells[6])
    if (!/^(0|[1-9][0-9]*)$/.test(cells[6]) || !Number.isSafeInteger(weeklyPeriods) || weeklyPeriods > limits.maxCoursePeriods) at('주당시수', line, 6, `시수는 0~${limits.maxCoursePeriods}의 정수로 입력해 주세요. 아직 정하지 않았으면 0을 입력합니다.`)
    const course = source.courses.find(course => course.id === cells[0])!
    if (course.requiredPeriods !== null && weeklyPeriods !== course.requiredPeriods) at('주당시수', line, 6, '공식 시수가 있는 수업은 이 파일에서 바꿀 수 없습니다. 원본 담당자에게 확인해 주세요.')
    values.push({ courseId: course.id, weeklyPeriods })
  }
  if (used.size !== source.courses.length) fail('주당시수 시트에서 수업 행이 빠졌습니다. 시수를 0으로 남길 수 있지만 수업 행은 유지해 주세요.')
  return rebuildPreview(source, draft, values)
}
export function importPreparationHoursWorkbook(bytes: Uint8Array, source: PreparationSource, draft: PreparationDraft): PreparationHoursPreview {
  return previewPreparationHoursWorkbook(readTimetableXlsx(bytes), source, draft)
}
/** 선택한 시수만 로컬 초안에 반영한다. 서버 저장·기준판 확정은 기존 준비 흐름을 사용한다. */
export function applyPreparationHoursWorkbook(source: PreparationSource, draft: PreparationDraft, preview: PreparationHoursPreview, selectedCourseIds: string[]): PreparationDraft {
  const current = checked(source, draft); source = current.source; draft = current.draft
  try { exact(preview, ['sourceKey', 'hours', 'changes', 'unchanged', 'warnings']) } catch { return fail('시수 미리보기가 바뀌었습니다. 파일을 다시 읽고 확인해 주세요.') }
  if (preview.sourceKey !== canonical([source, draft])) fail('미리보기 이후 준비 자료 또는 입력이 바뀌었습니다. 새 양식으로 다시 확인해 주세요.')
  const verified = rebuildPreview(source, draft, preview.hours)
  if (canonical(verified) !== canonical(preview)) fail('시수 미리보기가 바뀌었습니다. 파일을 다시 읽고 확인해 주세요.')
  const changed = new Map(verified.changes.map(change => [change.courseId, change]))
  if (!Array.isArray(selectedCourseIds) || !selectedCourseIds.length || selectedCourseIds.length > changed.size || new Set(selectedCourseIds).size !== selectedCourseIds.length || selectedCourseIds.some(id => typeof id !== 'string' || !changed.has(id))) fail('반영할 변경 수업을 중복 없이 선택해 주세요.')
  const selected = new Set(selectedCourseIds)
  const result = { ...draft, plans: draft.plans.map(plan => selected.has(plan.courseId) ? { ...plan, weeklyPeriods: changed.get(plan.courseId)!.after } : plan) }
  return preparationDraft(result, source)
}
