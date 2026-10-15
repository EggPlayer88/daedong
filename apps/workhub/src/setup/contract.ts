import schoolAdminLimits from './assets/school-admin.json'
// 학교 초기 설정의 검토 자료다. 운영 ID·회원·권한·활성화 상태를 만들지 않는다.
export const SCHOOL_TYPES = [
  { value: 'elementary', label: '초등학교' }, { value: 'middle', label: '중학교' },
  { value: 'high', label: '고등학교' }, { value: 'special', label: '특수학교' }, { value: 'other', label: '기타' },
] as const
export const CLASS_KINDS = [
  { value: 'regular', label: '일반 학급' }, { value: 'special', label: '특수 학급' },
  { value: 'multigrade', label: '복식 학급' }, { value: 'other', label: '기타 학급' },
] as const
// 명칭 한도는 통합 설계 원본 제약에 맞춘다. 배열·파일 한도는 이 준비 화면의 처리 한도다.
export const SETUP_LIMITS = { schoolName: 100, schoolCode: 40, termName: 50, departmentName: 50, className: 30, terms: 4, departments: 100, classes: 2000, maxImportBytes: 1_000_000 } as const
// 일반 학교급의 운영 범위와 특수·기타의 기술 한도를 구분한다. 특수학교의 법정 학년 수를 추정하지 않는다.
export function setupGradeLimit(schoolType: string): number {
  const bounds = schoolAdminLimits.gradeBounds as Record<string, number>
  return bounds[schoolType] ?? schoolAdminLimits.customGradeTechnicalLimit
}
export interface SetupTerm { id: string; termNo: string; name: string; startsOn: string; lastDay: string }
export interface SetupDepartment { id: string; name: string }
export interface SetupClass { id: string; grade: string; classNo: string; name: string; kind: string }
export interface SetupDraft {
  draftId: string
  schoolName: string; schoolCode: string; schoolType: string; gradeCount: string
  schoolYear: string; startsOn: string; lastDay: string
  terms: SetupTerm[]; departments: SetupDepartment[]; classes: SetupClass[]
}
export interface SetupIssue { path: string; message: string }

export function newSetupRowId(): string { return 'draft-' + crypto.randomUUID() }
export function createSetupDraft(): SetupDraft {
  return { draftId: newSetupRowId(), schoolName: '', schoolCode: '', schoolType: '', gradeCount: '', schoolYear: '', startsOn: '', lastDay: '', terms: [], departments: [], classes: [] }
}
const rootStrings = ['draftId', 'schoolName', 'schoolCode', 'schoolType', 'gradeCount', 'schoolYear', 'startsOn', 'lastDay'] as const
const rowFields = {
  terms: ['id', 'termNo', 'name', 'startsOn', 'lastDay'],
  departments: ['id', 'name'],
  classes: ['id', 'grade', 'classNo', 'name', 'kind'],
} as const
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
}
function identifier(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) }
function textSize(value: string): number { return Array.from(value).length }

// 미완성 내용은 보관하되 손상·권한 필드 삽입·무제한 배열은 파일 단계에서 거부한다.
function checkedDraft(value: unknown): SetupDraft {
  if (!record(value) || !exactKeys(value, [...rootStrings, ...Object.keys(rowFields)]) ||
      rootStrings.some(key => typeof value[key] !== 'string' || (value[key] as string).length > 4000) ||
      !identifier(value.draftId as string)) throw new Error('학교 설정 초안의 형식이 올바르지 않습니다.')
  const ids = new Set([value.draftId as string])
  for (const [key, fields] of Object.entries(rowFields)) {
    const rows = value[key]
    if (!Array.isArray(rows) || rows.length > SETUP_LIMITS[key as keyof typeof rowFields]) throw new Error('설정 항목의 형식이나 개수 한도를 확인해 주세요.')
    for (const row of rows) {
      if (!record(row) || !exactKeys(row, fields) || fields.some(field => typeof row[field] !== 'string' || (row[field] as string).length > 4000) ||
          !identifier(row.id as string) || ids.has(row.id as string)) throw new Error('설정 항목이 손상되었거나 같은 항목 식별자가 중복되었습니다.')
      ids.add(row.id as string)
    }
  }
  // 새 객체만 반환해 파싱한 외부 객체의 속성·참조를 그대로 쓰지 않는다.
  return {
    ...Object.fromEntries(rootStrings.map(key => [key, value[key]])),
    ...Object.fromEntries(Object.entries(rowFields).map(([key, fields]) => [key, (value[key] as Record<string, string>[]).map(row => Object.fromEntries(fields.map(field => [field, row[field]])))])),
  } as unknown as SetupDraft
}
function boundedText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > SETUP_LIMITS.maxImportBytes) throw new Error('초안 파일은 1MB 이하의 JSON이어야 합니다.')
}
export function parseSetupDraft(text: string): SetupDraft {
  boundedText(text)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('JSON 파일을 읽지 못했습니다. 기존 입력은 유지됩니다.') }
  if (!record(value) || !exactKeys(value, ['kind', 'schemaVersion', 'deploymentState', 'input']) ||
      value.kind !== 'school-setup-draft' || value.schemaVersion !== 1 || value.deploymentState !== 'not_applied') {
    throw new Error('지원하는 학교 설정 초안 파일이 아닙니다. 검토용 계획 파일은 초안으로 불러올 수 없습니다.')
  }
  return checkedDraft(value.input)
}
export function exportSetupDraft(input: SetupDraft): string {
  const text = JSON.stringify({ kind: 'school-setup-draft', schemaVersion: 1, deploymentState: 'not_applied', input: checkedDraft(input) }, null, 2)
  boundedText(text)
  return text
}
export function isSetupDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const time = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function nextDate(value: string): string {
  const result = new Date(Date.parse(value + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  if (!isSetupDate(result)) throw new Error('종료일을 변환할 수 없습니다.')
  return result
}
function integer(value: string, min: number, max: number): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}
export function validateSetupDraft(input: unknown): SetupIssue[] {
  let value: SetupDraft
  try { value = checkedDraft(input) } catch (error) { return [{ path: 'draft', message: error instanceof Error ? error.message : '설정 형식을 확인해 주세요.' }] }
  const issues: SetupIssue[] = []
  const add = (path: string, message: string) => { issues.push({ path, message }) }
  function name(path: string, raw: string, max: number, label: string) {
    const clean = raw.trim()
    if (!clean || textSize(clean) > max) add(path, label + '은(는) 1~' + max + '자로 입력해 주세요.')
    if (/[\u0000-\u001f\u007f]/.test(clean) || Array.from(clean).some(char => { const code = char.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff })) add(path, label + '에 사용할 수 없는 문자가 있습니다.')
  }
  function period(prefix: string, starts: string, last: string, label: string) {
    const path = (key: string) => prefix ? prefix + '.' + key : key
    if (!isSetupDate(starts)) add(path('startsOn'), label + ' 시작일을 정확히 입력해 주세요.')
    if (!isSetupDate(last) || last === '9999-12-31') add(path('lastDay'), label + ' 마지막 날을 정확히 입력해 주세요.')
    if (isSetupDate(starts) && isSetupDate(last) && starts > last) add(path('lastDay'), label + ' 마지막 날은 시작일보다 빠를 수 없습니다.')
  }
  name('schoolName', value.schoolName, SETUP_LIMITS.schoolName, '학교 이름')
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(value.schoolCode.trim())) add('schoolCode', '학교 코드는 영문·숫자·밑줄·하이픈 2~40자로 입력해 주세요.')
  if (!SCHOOL_TYPES.some(item => item.value === value.schoolType)) add('schoolType', '학교급을 선택해 주세요.')
  const gradeLimit = setupGradeLimit(value.schoolType)
  if (!integer(value.gradeCount, 1, gradeLimit)) add('gradeCount', `운영 학년 수는 선택한 학교급의 1~${gradeLimit} 범위로 입력해 주세요.`)
  if (!integer(value.schoolYear, schoolAdminLimits.schoolYearBounds.min, schoolAdminLimits.schoolYearBounds.max)) add('schoolYear', `학년도는 ${schoolAdminLimits.schoolYearBounds.min}~${schoolAdminLimits.schoolYearBounds.max}으로 입력해 주세요.`)
  period('', value.startsOn, value.lastDay, '학년도')
  if (!value.terms.length) add('terms', '학기를 한 개 이상 입력해 주세요.')
  const termNos = new Set<string>(), termNames = new Set<string>()
  value.terms.forEach((term, index) => {
    const path = 'terms.' + index
    if (!integer(term.termNo, 1, 4) || termNos.has(term.termNo)) add(path + '.termNo', '학기 번호는 서로 다른 1~4로 입력해 주세요.')
    termNos.add(term.termNo)
    name(path + '.name', term.name, SETUP_LIMITS.termName, '학기 이름')
    if (termNames.has(term.name.trim())) add(path + '.name', '같은 학기 이름을 중복해서 사용할 수 없습니다.')
    termNames.add(term.name.trim())
    period(path, term.startsOn, term.lastDay, '학기')
    if (isSetupDate(term.startsOn) && isSetupDate(value.startsOn) && term.startsOn < value.startsOn) add(path + '.startsOn', '학기 시작일은 학년도 안에 있어야 합니다.')
    if (isSetupDate(term.lastDay) && isSetupDate(value.lastDay) && term.lastDay > value.lastDay) add(path + '.lastDay', '학기 마지막 날은 학년도 안에 있어야 합니다.')
    if (isSetupDate(term.startsOn) && isSetupDate(term.lastDay) && term.startsOn <= term.lastDay &&
        value.terms.slice(0, index).some(other => isSetupDate(other.startsOn) && isSetupDate(other.lastDay) && other.startsOn <= other.lastDay && term.startsOn <= other.lastDay && term.lastDay >= other.startsOn)) {
      add(path + '.startsOn', '다른 학기와 날짜가 겹칩니다. 마지막 날도 해당 학기에 포함됩니다.')
    }
  })
  const departments = new Set<string>()
  value.departments.forEach((item, index) => {
    name('departments.' + index + '.name', item.name, SETUP_LIMITS.departmentName, '부서 이름')
    if (departments.has(item.name.trim())) add('departments.' + index + '.name', '같은 부서 이름을 중복해서 사용할 수 없습니다.')
    departments.add(item.name.trim())
  })
  const classes = new Set<string>(), classCoordinates = new Set<string>()
  value.classes.forEach((item, index) => {
    const path = 'classes.' + index
    name(path + '.name', item.name, SETUP_LIMITS.className, '학급 이름')
    if (classes.has(item.name.trim())) add(path + '.name', '학급 이름은 이 학년도 안에서 서로 달라야 합니다.')
    classes.add(item.name.trim())
    if (!integer(item.grade, 1, gradeLimit) || (integer(value.gradeCount, 1, gradeLimit) && Number(item.grade) > Number(value.gradeCount))) add(path + '.grade', '학급의 학년은 학교의 학년 수 안에서 선택해 주세요.')
    if (item.classNo !== '' && !integer(item.classNo, 1, 99)) add(path + '.classNo', '반 번호는 비워 두거나 1~99로 입력해 주세요.')
    if (item.classNo && integer(item.grade, 1, gradeLimit) && integer(item.classNo, 1, 99)) {
      const coordinate = `${Number(item.grade)}:${Number(item.classNo)}`
      if (classCoordinates.has(coordinate)) add(path + '.classNo', '같은 학년·반 번호를 중복해서 등록할 수 없습니다.')
      classCoordinates.add(coordinate)
    }
    if (!CLASS_KINDS.some(kind => kind.value === item.kind)) add(path + '.kind', '학급 유형을 선택해 주세요.')
  })
  return issues
}
export function exportSetupPlan(input: SetupDraft): string {
  const issues = validateSetupDraft(input)
  if (issues.length) throw new Error('검토용 계획을 내려받기 전에 입력 오류 ' + issues.length + '개를 확인해 주세요.')
  const value = checkedDraft(input)
  return JSON.stringify({
    kind: 'school-setup-plan', schemaVersion: 1, deploymentState: 'not_applied', sourceDraftId: value.draftId,
    school: { code: value.schoolCode.trim(), name: value.schoolName.trim(), schoolLevel: value.schoolType, gradeCount: Number(value.gradeCount) },
    academicYear: { schoolYear: Number(value.schoolYear), startsOn: value.startsOn, endsBefore: nextDate(value.lastDay) },
    terms: value.terms.map(item => ({ draftRowId: item.id, termNo: Number(item.termNo), name: item.name.trim(), startsOn: item.startsOn, endsBefore: nextDate(item.lastDay) })),
    departments: value.departments.map(item => ({ draftRowId: item.id, name: item.name.trim() })),
    classes: value.classes.map(item => ({ draftRowId: item.id, grade: Number(item.grade), classNo: item.classNo ? Number(item.classNo) : null, label: item.name.trim(), kind: item.kind })),
    // 이 파일은 명령이 아니다. 실제 적용에서는 별도 승인과 서버의 최신 검사가 필요하다.
    pendingChecks: ['학교 코드 전역 중복', '기존 학교와의 연결 또는 신규 개설 확인', '부서 종류·유효 기간', '기존 회원·학교 소속·담당 연결', '서버 권한·기간·관계 검증', '확정 SQL 검토와 사용자 적용'],
  }, null, 2)
}
