// 사용자가 제공한 로컬 전환 자료를 앱 가져오기 계약으로 변환한다. 운영 DB·API에 접속하지 않는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function prepareRoster(source, { from, until, officialClasses = [], anonymous = false } = {}) {
  if (source.kind !== 'teacher-roster-design-data' || !Array.isArray(source.teachers) || !Array.isArray(source.lessons) || !Array.isArray(source.courses)) throw Error('전환 자료 형식이 다릅니다.')
  const teacherIds = new Map(source.teachers.map((r, i) => [r.proposedTeacherRecordId, anonymous ? `teacher_${i + 1}` : r.proposedTeacherRecordId]))
  const classLabels = [...new Set(source.lessons.map(r => r.classLabel))].sort()
  const classes = classLabels.map((label, i) => {
    if (!/^\d+-\d+$/.test(label)) throw Error('학급 이름을 학년-반으로 확인하세요.')
    const [grade, number] = label.split('-').map(Number), matches = officialClasses.filter(c => c.grade === grade && c.class_no === number)
    if (matches.length > 1) throw Error('기존 학급 후보가 중복됩니다.')
    return { id: anonymous ? `class_${i + 1}` : randomUUID(), grade, number, name: `${grade}학년 ${number}반`, officialId: matches[0]?.id ?? null }
  })
  const classIds = new Map(classLabels.map((l, i) => [l, classes[i].id]))
  const courseIds = new Map(source.courses.map((r, i) => [r.proposedPlanningCourseId, anonymous ? `course_${i + 1}` : r.proposedPlanningCourseId]))
  const subjects = [...new Set(source.courses.map(r => r.subjectLabel))].sort()
  const minute = v => { if (!/^\d{2}:\d{2}$/.test(v)) throw Error('교시 시각 오류'); const [h, m] = v.split(':').map(Number); if (h > 23 || m > 59) throw Error('교시 시각 범위 오류'); return h * 60 + m }
  const slots = new Map()
  const lessons = source.lessons.map((r, i) => {
    const id = `slot_${r.day}_${r.period}`, slot = { id, day: r.day, period: r.period, start: minute(r.startsAtLocal), end: minute(r.endsAtLocal) }
    if (slots.has(id) && JSON.stringify(slots.get(id)) !== JSON.stringify(slot)) throw Error('학급별 일과가 다르면 별도 교시를 정의하세요.')
    slots.set(id, slot)
    return { id: anonymous ? `lesson_${i + 1}` : `roster_lesson_${r.classLabel.replace('-', '_')}_${r.day}_${r.period}`, courseId: courseIds.get(r.proposedPlanningCourseId), slotId: id }
  })
  const plan = {
    id: anonymous ? 'fixture_plan' : randomUUID(), termId: anonymous ? 'fixture_term' : source.termId,
    title: anonymous ? '9학급 합성 시간표' : '가져온 기본 시간표', from, until,
    teachers: source.teachers.map((r, i) => ({ id: teacherIds.get(r.proposedTeacherRecordId), name: anonymous ? `교사 ${i + 1}` : r.displayName, kind: 'person' })),
    classes,
    courses: source.courses.map((r, i) => ({ id: courseIds.get(r.proposedPlanningCourseId), name: anonymous ? `수업 ${i + 1}` : `${r.classLabel} ${r.subjectLabel} · ${source.teachers.find(t => t.proposedTeacherRecordId === r.teacherRecordId)?.displayName}`, subject: anonymous ? `교과 ${subjects.indexOf(r.subjectLabel) + 1}` : r.subjectLabel, teacherId: teacherIds.get(r.teacherRecordId), classId: classIds.get(r.classLabel), weeklyHours: r.weeklyLessons })),
    slots: [...slots.values()].sort((a, b) => a.day - b.day || a.period - b.period), lessons,
    // 창체 교사를 담임으로 자동 확정하지 않는다. 앱의 담임 선택에서 확인한다.
    homerooms: [],
  }
  return { format: 'teacher-roster-plan.v1', plan, accountCandidates: anonymous ? [] : source.teachers.filter(t => t.existingMemberIdCandidate).map(t => ({ teacherId: teacherIds.get(t.proposedTeacherRecordId), memberId: t.existingMemberIdCandidate })), source: { sha256: anonymous ? null : source.sourceSha256, referenceOnly: true }, homeroomCandidates: anonymous ? [] : source.teachers.flatMap(t => t.homeroomProposals.map(h => ({ classId: classIds.get(h.classLabel), teacherId: teacherIds.get(t.proposedTeacherRecordId) }))) }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [input, output, from, until, classesFile, flag] = process.argv.slice(2)
  if (!input || !output || !from || !until || flag && flag !== '--anonymous') throw Error('사용법: node scripts/prepare-teacher-roster.mjs 원본.json 출력.json 시작일 종료제외일 기존학급.json|none [--anonymous]')
  const source = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''))
  const officialClasses = classesFile && classesFile !== 'none' ? JSON.parse(readFileSync(classesFile, 'utf8').replace(/^\uFEFF/, '')).classes : []
  const value = prepareRoster(source, { from, until, officialClasses: flag ? [] : officialClasses, anonymous: flag === '--anonymous' })
  const text = JSON.stringify(value, null, 2) + '\n'
  writeFileSync(output, text)
  console.log(JSON.stringify({ teachers: value.plan.teachers.length, classes: value.plan.classes.length, lessons: value.plan.lessons.length, sha256: createHash('sha256').update(text).digest('hex'), databaseApplied: false }))
}
