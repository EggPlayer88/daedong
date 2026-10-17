import type { TimetableBasis, Placement, TimetableIssue } from '../../../../packages/timetable/src/types'
import { validateBasis, validatePlacements } from '../../../../packages/timetable/src/validate'
import type { TimetableConditions } from './contracts'
import { canonical } from '../services/scoped-rpc'
import { timetableConditions } from './server'
import { TimetableWorkbookError, type WorkbookSheet } from './xlsx'
import limits from './limits.json'

export interface TimetableWorkbookDraft { title: string; conditions: TimetableConditions; placements: Placement[] }
export interface TimetableWorkbookPreview extends TimetableWorkbookDraft {
  changedLessons: number; addedConditions: number; removedConditions: number; unassigned: number
  complete: boolean; issues: TimetableIssue[]; unchanged: boolean
}
const headers = {
  기준: ['항목', '값'],
  대상목록: ['대상ID', '종류', '이름', '동시수용'],
  시간대목록: ['시간대ID', '요일(월1)', '교시', '시작(분)', '종료(분)', '차시'],
  수업목록: ['수업ID', '과목ID', '수업명', '차시', '대상ID목록(|구분)', '허용시간대ID목록(|구분)'],
  시수목록: ['과목ID', '필요차시'],
  고정: ['수업ID', '시간대ID'],
  불가: ['대상ID', '요일(월1)', '시작(분)', '종료(분)'],
  선호: ['수업ID', '시간대ID', '피하기정도'],
  배치: ['수업ID', '수업명', '시간대ID(미배정은빈칸)'],
} as const
const fail = (message: string): never => { throw new TimetableWorkbookError(message) }
const stringRows = (rows: (string | number)[][]) => rows.map(row => row.map(String))
const sorted = (rows: string[][]) => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b)))
function catalogue(basis: TimetableBasis): WorkbookSheet[] {
  return [
    { name: '대상목록', rows: [Array.from(headers.대상목록), ...basis.resources.map(r => [r.id, r.kind, r.label, String(r.capacity)])] },
    { name: '시간대목록', rows: [Array.from(headers.시간대목록), ...stringRows(basis.slots.map(s => [s.id, s.day, s.label, s.startMinute, s.endMinute, s.periods]))] },
    { name: '수업목록', rows: [Array.from(headers.수업목록), ...stringRows(basis.lessons.map(l => [l.id, l.courseId, l.label, l.periods, [...l.resourceIds].sort().join('|'), [...l.allowedSlotIds].sort().join('|')]))] },
    { name: '시수목록', rows: [Array.from(headers.시수목록), ...stringRows(basis.courseLoads.map(c => [c.courseId, c.periods]))] },
  ]
}
function assertDraft(basis: TimetableBasis, draft: TimetableWorkbookDraft) {
  if (!validateBasis(basis).valid || !draft.title.trim() || Array.from(draft.title).length > limits.title || !Array.isArray(draft.placements)) fail('기준자료와 초안 이름을 먼저 확인해 주세요.')
  try { timetableConditions(draft.conditions, basis) } catch { fail('조건의 형식 또는 학교가 확정한 필수조건을 확인해 주세요.') }
  const ids = new Set<string>()
  for (const p of draft.placements) {
    const lesson = basis.lessons.find(l => l.id === p.lessonId)
    if (!lesson || ids.has(p.lessonId) || !lesson.allowedSlotIds.includes(p.slotId)) fail('배치의 수업·시간대를 확인해 주세요.')
    ids.add(p.lessonId)
  }
}
export function timetableWorkbookSheets(basis: TimetableBasis, draft: TimetableWorkbookDraft): WorkbookSheet[] {
  assertDraft(basis, draft)
  const positions = new Map(draft.placements.map(p => [p.lessonId, p.slotId]))
  const original = canonical(basis), pieces: string[][] = []
  // UTF-16 서로게이트 쌍을 나누면 UTF-8 엑셀 저장 시 원본 문자가 손상된다.
  const points = Array.from(original)
  for (let i = 0; i < points.length; i += 4000) pieces.push([String(pieces.length + 1), points.slice(i, i + 4000).join('')])
  return [
    { name: '안내', rows: [['시간표 편집 양식', '사용 방법'], ['용도', '현재 기준자료를 바탕으로 조건과 배치를 수정하고 작업을 이어갑니다.'], ['수정할 시트', '고정 · 불가 · 선호 · 배치, 기준 시트의 초안이름'], ['대상과 시간대', '목록의 ID를 사용합니다. 같은 이름도 서로 다른 대상일 수 있습니다.'], ['행 삭제', '배치 행은 지우지 말고 시간대ID를 비워 미배정으로 둡니다.'], ['조건 삭제', '가져오기 미리보기에서 삭제 건수를 확인합니다. 학교 필수조건은 삭제할 수 없습니다.'], ['기준자료', '대상·시수·배정 변경은 학교 기준자료 작업에서 합니다. 목록은 참고용입니다.'], ['공개 여부', '가져오기는 작업 초안만 바꿉니다. 저장·확정·교환 신청은 별도 확인합니다.'], ['파일 보관', '교사 명단과 시간표가 포함되므로 학교에서 허용한 위치에 보관해 주세요.']] },
    { name: '기준', rows: [Array.from(headers.기준), ['형식', 'timetable.workbook.v1'], ['학교', basis.schoolId], ['학기', basis.termId], ['기준ID', basis.id], ['기준판', String(basis.revision)], ['원본지문', basis.sourceFingerprint], ['초안이름', draft.title]] },
    ...catalogue(basis),
    { name: '고정', rows: [Array.from(headers.고정), ...draft.conditions.fixed.map(p => [p.lessonId, p.slotId])] },
    { name: '불가', rows: [Array.from(headers.불가), ...stringRows(draft.conditions.unavailable.map(p => [p.resourceId, p.day, p.startMinute, p.endMinute]))] },
    { name: '선호', rows: [Array.from(headers.선호), ...stringRows(draft.conditions.preferences.map(p => [p.lessonId, p.slotId, p.weight]))] },
    { name: '배치', rows: [Array.from(headers.배치), ...basis.lessons.map(l => [l.id, l.label, positions.get(l.id) ?? ''])] },
    { name: '원본대조', hidden: true, rows: [['순서', '기준자료(수정금지)'], ...pieces] },
  ]
}

export function previewTimetableWorkbook(sheets: WorkbookSheet[], basis: TimetableBasis, current: TimetableWorkbookDraft): TimetableWorkbookPreview {
  assertDraft(basis, current)
  const expected = timetableWorkbookSheets(basis, current), byName = new Map(sheets.map(s => [s.name, s]))
  if (byName.size !== sheets.length || byName.size !== expected.length || expected.some(s => !byName.has(s.name))) fail('필수 시트가 빠졌거나 다른 양식입니다. 현재 화면에서 양식을 다시 내려받아 주세요.')
  function rows(name: keyof typeof headers): string[][] {
    const sheet = byName.get(name)!, header = Array.from(headers[name])
    const normalize = (row: string[]) => { const copy = [...row]; while (copy.length > header.length && copy.at(-1) === '') copy.pop(); if (copy.length > header.length) fail(`${name} 시트에 예상하지 않은 열이 있습니다.`); return Array.from({ length: header.length }, (_, i) => copy[i] ?? '') }
    if (canonical(normalize(sheet.rows[0] ?? [])) !== canonical(header)) fail(`${name} 시트의 열 이름이 다릅니다. 제공한 열 이름을 유지해 주세요.`)
    return sheet.rows.slice(1).filter(r => r.some(c => c !== '')).map(normalize)
  }
  const metadata = rows('기준'), meta = new Map(metadata.map(r => [r[0], r[1]]))
  const originalMetadata = expected.find(s => s.name === '기준')!.rows.slice(1)
  if (meta.size !== metadata.length || meta.size !== originalMetadata.length) fail('기준 시트의 항목을 확인해 주세요.')
  for (const [key, value] of originalMetadata) if (key !== '초안이름' && meta.get(key) !== value) fail('다른 학교·학기 또는 이전 기준판의 파일입니다. 현재 자료를 다시 내려받아 주세요.')
  const originalRows = byName.get('원본대조')!.rows
  if (canonical(originalRows) !== canonical(expected.find(s => s.name === '원본대조')!.rows)) fail('파일의 기준자료가 현재 원본과 다릅니다. 원본을 다시 확인해 주세요.')
  for (const sheet of catalogue(basis)) if (canonical(sorted(rows(sheet.name as keyof typeof headers))) !== canonical(sorted(sheet.rows.slice(1)))) fail(`${sheet.name} 시트의 공식 자료가 바뀌었습니다. 학교 기준자료에서 먼저 수정해 주세요.`)
  const integer = (value: string, name: string) => { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail(`${name}에는 정수를 입력해 주세요.`); return Number(value) }
  const conditions: TimetableConditions = {
    fixed: rows('고정').map(r => ({ lessonId: r[0], slotId: r[1] })),
    unavailable: rows('불가').map(r => ({ resourceId: r[0], day: integer(r[1], '요일'), startMinute: integer(r[2], '시작 분'), endMinute: integer(r[3], '종료 분') })),
    preferences: rows('선호').map(r => ({ lessonId: r[0], slotId: r[1], weight: integer(r[2], '피하기 정도') })),
  }
  const placementRows = rows('배치'), ids = new Set<string>(), placements: Placement[] = []
  for (const [id, label, slot] of placementRows) {
    const lesson = basis.lessons.find(l => l.id === id)
    if (!lesson || ids.has(id) || lesson.label !== label) fail('배치 시트의 수업ID·수업명을 확인해 주세요. 같은 수업을 두 번 적을 수 없습니다.')
    ids.add(id); if (slot) placements.push({ lessonId: id, slotId: slot })
  }
  if (ids.size !== basis.lessons.length) fail('배치 시트에서 수업 행이 빠졌습니다. 미배정은 행을 지우지 말고 시간대ID를 비워 주세요.')
  const title = meta.get('초안이름') ?? '', draft = { title, conditions, placements }
  assertDraft(basis, draft)
  const before = new Map(current.placements.map(p => [p.lessonId, p.slotId])), after = new Map(placements.map(p => [p.lessonId, p.slotId]))
  const keys = (c: TimetableConditions) => new Set(Object.entries(c).flatMap(([kind, list]) => list.map(row => `${kind}:${canonical(row)}`)))
  const oldKeys = keys(current.conditions), nextKeys = keys(conditions), check = validatePlacements({ ...basis, ...conditions }, placements)
  const changedLessons = basis.lessons.filter(l => before.get(l.id) !== after.get(l.id)).length
  const addedConditions = [...nextKeys].filter(key => !oldKeys.has(key)).length, removedConditions = [...oldKeys].filter(key => !nextKeys.has(key)).length
  return { ...draft, changedLessons, addedConditions, removedConditions, unassigned: basis.lessons.length - placements.length, complete: check.valid, issues: check.issues, unchanged: !changedLessons && !addedConditions && !removedConditions && title === current.title }
}

export function timetablePrintSheets(basis: TimetableBasis, draft: TimetableWorkbookDraft): WorkbookSheet[] {
  assertDraft(basis, draft)
  const days = ['', '월', '화', '수', '목', '금', '토', '일'], clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  const lookup = new Map(draft.placements.map(p => [p.lessonId, p.slotId]))
  return [{ name: '시간표', rows: [['초안', '요일', '교시', '시작', '종료', '수업', '교사', '학급·집단', '공간'], ...basis.lessons.map(lesson => {
    const slot = basis.slots.find(s => s.id === lookup.get(lesson.id)), resources = basis.resources.filter(r => lesson.resourceIds.includes(r.id))
    return [draft.title, slot ? days[slot.day] : '미배정', slot?.label ?? '', slot ? clock(slot.startMinute) : '', slot ? clock(slot.endMinute) : '', lesson.label, resources.filter(r => r.kind === 'teacher').map(r => r.label).join(' / '), resources.filter(r => r.kind === 'class' || r.kind === 'student_group').map(r => r.label).join(' / '), resources.filter(r => r.kind === 'room').map(r => r.label).join(' / ')]
  })] }, { name: '안내', rows: [['자료 종류', '작업 초안 출력'], ['공개 상태', '이 파일은 학기 확정 또는 교환 승인을 증명하지 않습니다.'], ['다시 가져오기', '수정 후 가져오기는 편집용 엑셀 양식을 사용해 주세요.']] }]
}
