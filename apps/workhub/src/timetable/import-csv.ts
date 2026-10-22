import type { TimetableSlot } from '../../../../packages/timetable/src/types'
import { validatePlacements } from '../../../../packages/timetable/src/validate'
import { canonical, identifier, ServiceError, text } from '../services/scoped-rpc'
import { compilePreparation, type PreparationSource } from './preparation'
import { parsePilotCsvRows } from './pilot/roster'
import { pilotDigest, type PilotFixture } from './pilot/fixture'
import { type TimetableImportInput, timetableImportInput } from './import-contracts'

const headers = ['lessonId', 'courseId', 'day', 'label', 'start', 'end', 'periods', 'teacherIds', 'classIds', 'roomIds']
const fail = (message: string): never => { throw Object.assign(new ServiceError('INVALID_INPUT'), { message }) }
const csv = (rows: string[][]) => '\uFEFF' + rows.map(row => row.map(value => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const minute = (value: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== '24:00') return fail('시각은 09:00과 같이 입력해 주세요.')
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}
const ids = (value: string) => {
  const result = value ? value.split('|').map(v => identifier(v)) : []
  if (new Set(result).size !== result.length) fail('같은 연결 ID가 중복되어 있습니다.')
  return result.sort()
}
export async function timetableImportTemplate(source: PreparationSource): Promise<string> {
  const groups = await Promise.all(source.courses.map(async course => {
    // 수업 순서가 바뀌어도 활동 ID는 같은 수업에 남는다. 긴 서버 ID도 양식 한도를 넘지 않는다.
    const prefix = await pilotDigest(course.id)
    return Array.from({ length: course.requiredPeriods ?? 1 }, (_, index) => {
    const ofKind = (kinds: string[]) => source.resources.filter(r => course.resourceIds.includes(r.id) && kinds.includes(r.kind)).map(r => r.id).sort().join('|')
    return [`import-${prefix}-${index + 1}`, course.id, '', '', '', '', '1', ofKind(['teacher']), ofKind(['class', 'student_group']), ofKind(['room', 'equipment'])]
    })
  }))
  return csv([headers, ...groups.flat()])
}
export function timetableImportReference(source: PreparationSource): string {
  return csv([['kind', 'id', 'name'], ...source.courses.map(c => ['course', c.id, c.label]), ...source.resources.map(r => [r.kind, r.id, r.label])])
}
/** 연습의 시각·교과 배치는 옮기되 실제 학교 ID는 사용자가 확인하여 채운다. */
export function timetableImportPilotTemplate(fixture: PilotFixture): string {
  return csv([headers, ...fixture.lessons.map(lesson => {
    const slot = fixture.daySlots.find(p => p.period === lesson.period)!
    return [lesson.id, '', String(lesson.weekday), `${lesson.subject} · ${lesson.period}교시`, slot.startTime, slot.endTime, '1', '', '', '']
  })])
}
export async function reviewTimetableImport(source: PreparationSource, csvText: string, title: string): Promise<TimetableImportInput> {
  if (new TextEncoder().encode(csvText).length > 2 * 1024 * 1024) fail('가져올 CSV는 2MB 이하로 나누어 주세요.')
  text(title, 100, true)
  let rows: string[][]
  try { rows = parsePilotCsvRows(csvText) } catch { return fail('CSV 열과 따옴표 형식을 확인해 주세요.') }
  if (canonical(rows[0]) !== canonical(headers) || rows.length < 2 || rows.length > 5001) fail('가져오기 양식의 열 이름과 수업 수를 확인해 주세요.')
  const slots = new Map<string, TimetableSlot>(), lessonIds = new Set<string>()
  const plans = source.courses.map(course => ({ courseId: course.id, weeklyPeriods: 0, blocks: [] as { id: string; periods: number; allowedSlotIds: string[] }[] }))
  const placements: TimetableImportInput['placements'] = []
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== headers.length) fail(`${index + 2}행의 열 수가 다릅니다.`)
    const [lessonId, courseId, dayText, label, startText, endText, periodsText, teachers, classes, rooms] = row
    identifier(lessonId); identifier(courseId); text(label, 100, true)
    const course = source.courses.find(c => c.id === courseId)
    if (!course) fail(`${index + 2}행의 수업 ID를 현재 학기 자료에서 찾지 못했습니다.`)
    if (lessonIds.has(lessonId)) fail(`${index + 2}행의 수업 활동 ID가 중복되었습니다.`)
    lessonIds.add(lessonId)
    if (!/^[1-7]$/.test(dayText) || !/^[1-9]\d?$/.test(periodsText)) fail(`${index + 2}행의 요일·차시 수를 확인해 주세요.`)
    const day = Number(dayText), periods = Number(periodsText), startMinute = minute(startText), endMinute = minute(endText)
    if (startMinute >= endMinute || startMinute >= 1440) fail(`${index + 2}행은 같은 날 안에서 시작보다 종료가 늦어야 합니다.`)
    const groups = [ids(teachers), ids(classes), ids(rooms)]
    const kinds = [['teacher'], ['class', 'student_group'], ['room', 'equipment']]
    for (let group = 0; group < groups.length; group++) for (const id of groups[group]) {
      if (!source.resources.some(r => r.id === id && kinds[group].includes(r.kind))) fail(`${index + 2}행의 교사·학급·공간 ID와 종류를 확인해 주세요.`)
    }
    if (!groups[0].length || !groups[1].length || canonical(groups.flat().sort()) !== canonical([...course!.resourceIds].sort())) {
      fail(`${index + 2}행의 담당·학급·공간이 공식 수업 연결과 다릅니다. 학교 자료에서 먼저 연결을 정정하고 다시 불러와 주세요.`)
    }
    const slotId = `import-${day}-${startMinute}-${endMinute}-${periods}`
    if (!slots.has(slotId)) slots.set(slotId, { id: slotId, day, label: `${clock(startMinute)}–${clock(endMinute)}`, startMinute, endMinute, periods })
    const plan = plans.find(p => p.courseId === courseId)!
    plan.weeklyPeriods += periods
    // 가져온 배치를 고정 조건으로 만들지는 않는다. 조정할 때 같은 차시 수의 다른 시간대로 이동할 수 있다.
    plan.blocks.push({ id: lessonId, periods, allowedSlotIds: [] })
    placements.push({ lessonId, slotId })
  }
  const sortedSlots = [...slots.values()].sort((a, b) => a.day - b.day || a.startMinute - b.startMinute || a.id.localeCompare(b.id, 'en'))
  for (const plan of plans) for (const block of plan.blocks) block.allowedSlotIds = sortedSlots.filter(s => s.periods === block.periods).map(s => s.id)
  const draft = { title, slots: sortedSlots, plans }
  const compiled = compilePreparation(source, draft)
  if (!compiled.basis) fail(compiled.issues.map(i => i.message).slice(0, 5).join(' '))
  const review = validatePlacements(compiled.basis!, placements)
  if (!review.valid) fail(review.issues.map(i => i.message).slice(0, 5).join(' '))
  return timetableImportInput({
    preparation: { kind: 'confirm', sourceRevision: source.sourceRevision, sourceFingerprint: source.sourceFingerprint, termId: source.termId,
      draftId: source.savedDraft?.id ?? null, expectedDraftRevision: source.savedDraft?.revision ?? null, draft },
    placements, title, fileHash: await pilotDigest(csvText.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')),
  }, source)
}
