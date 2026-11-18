import { createHash } from 'node:crypto'

const hash = text => createHash('sha256').update(text).digest('hex')

/**
 * 실제 학교 자료가 아닌, 유효 배치를 함께 만드는 합성 학교다.
 * 과목별 3~4시수, 학급별 30시수를 먼저 배치한 뒤 그 배치와 양립하는 조건을 추가한다.
 * 조건을 삭제하거나 완화해서 가능한 문제로 바꾸지 않는다.
 */
export function makeQualitySchool({ classes = 9, complex = false, seed = 71283 } = {}) {
  if (!Number.isInteger(classes) || classes < 1 || classes > 18) throw new Error('합성 학교는 1~18학급을 지원합니다.')
  if (typeof complex !== 'boolean' || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('합성 학교의 복합 조건과 시드를 확인해 주세요.')
  const groups = Math.ceil(classes / 3)
  // 4교시 뒤 긴 휴식도 실제 시각으로 표현한다. 블록은 휴식을 포함한 전 구간을 점유한다.
  const starts = [540, 595, 650, 705, 800, 855]
  const slots = Array.from({ length: 30 }, (_, i) => ({
    id: `slot_${i}`, day: Math.floor(i / 6) + 1, label: `합성 ${Math.floor(i / 6) + 1}일 ${i % 6 + 1}교시`,
    startMinute: starts[i % 6], endMinute: starts[i % 6] + 45, periods: 1,
  }))
  const singleSlots = [...slots]
  if (complex) for (let day = 1; day <= 5; day++) for (let period = 0; period < 5; period++) slots.push({
    id: `block_${day}_${period}`, day, label: `합성 ${day}일 ${period + 1}~${period + 2}교시`,
    startMinute: starts[period], endMinute: starts[period + 1] + 45, periods: 2,
  })
  const resources = [
    ...Array.from({ length: classes }, (_, i) => ({ id: `class_${i}`, kind: 'class', label: `합성 ${i + 1}반`, capacity: 1 })),
    ...Array.from({ length: groups * 8 }, (_, i) => ({ id: `teacher_${i}`, kind: 'teacher', label: `합성 교과교사 ${i + 1}`, capacity: 1 })),
  ]
  if (complex) {
    resources.push({ id: 'native_teacher', kind: 'teacher', label: '합성 공동 원어민 교사', capacity: 1 },
      { id: 'laboratory', kind: 'room', label: '합성 공동 실습실', capacity: 2 },
      { id: 'equipment', kind: 'equipment', label: '합성 공동 장비', capacity: 1 })
    for (let g = 0; g < groups; g++) if (g * 3 + 1 < classes) resources.push({
      id: `shared_students_${g}`, kind: 'student_group', label: `합성 ${g + 1}집단 수강 교집합`, capacity: 1,
    })
  }
  // 첫 두 교시만 같은 과목인 배열. 모든 과목의 총시수는 여전히 3 또는 4다.
  const pattern = complex ? [0, 0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5] : Array.from({ length: 30 }, (_, i) => i % 8)
  const lessons = [], witness = [], courseLoads = [], fixed = [], unavailable = [], preferences = []
  const rows = [], slotMap = new Map(slots.map(s => [s.id, s]))
  for (let c = 0; c < classes; c++) {
    const hours = Array(8).fill(0), group = Math.floor(c / 3)
    for (let at = 0; at < 30; at++) {
      if (complex && at === 1) continue
      const subject = (pattern[at] + c) % 8, periods = complex && at === 0 ? 2 : 1
      const teacher = `teacher_${group * 8 + subject}`
      const resourceIds = [`class_${c}`, teacher]
      if (complex && (c % 3 === 0 && subject === 6 && c + 1 < classes || c % 3 === 1 && subject === 5)) resourceIds.push(`shared_students_${group}`)
      const lesson = { id: `lesson_${c}_${at}`, courseId: `course_${c}_${subject}`, label: `합성 ${c + 1}반 ${subject === 7 ? '영어' : `${subject + 1}과목`}`, periods,
        resourceIds, allowedSlotIds: slots.filter(s => s.periods === periods).map(s => s.id) }
      const place = { lessonId: lesson.id, slotId: periods === 2 ? 'block_1_0' : `slot_${at}` }
      lessons.push(lesson); witness.push(place); rows.push({ c, at, subject, lesson, place }); hours[subject] += periods
      if (complex && at === 29) {
        // 학급별로 서로 다른 교과교사 한 명을 합성 담임으로 명시한다.
        resources.find(r => r.id === teacher).label = `합성 ${c + 1}반 담임 겸 교과교사`
        lesson.label += ' · 담임 담당 고정 수업'
        fixed.push({ ...place })
      }
    }
    if (hours.some(n => n < 3 || n > 4)) throw new Error('합성 과목 시수 구성 오류입니다.')
    courseLoads.push(...hours.map((periods, subject) => ({ courseId: `course_${c}_${subject}`, periods })))
  }
  if (complex) {
    const usage = new Map()
    const attachOnce = (resource, subject, capacity) => {
      for (let c = 0; c < classes; c++) {
        const choice = rows.filter(r => r.c === c && r.subject === subject && r.lesson.periods === 1)
          .find(r => (usage.get(`${resource}:${r.place.slotId}`) ?? 0) < capacity)
        if (!choice) throw new Error(`합성 ${resource}의 알려진 유효 배치를 만들 수 없습니다.`)
        const k = `${resource}:${choice.place.slotId}`
        usage.set(k, (usage.get(k) ?? 0) + 1); choice.lesson.resourceIds.push(resource)
      }
    }
    attachOnce('native_teacher', 7, 1)
    attachOnce('laboratory', 2, 2)
    attachOnce('equipment', 4, 1)
    // 수업이 없는 교시에만 불가시간을 넣는다. 이 배치를 품질 탐색의 정답으로 고정하지는 않는다.
    for (const teacher of resources.filter(r => r.kind === 'teacher')) {
      const occupied = rows.filter(r => r.lesson.resourceIds.includes(teacher.id)).map(r => slotMap.get(r.place.slotId))
      const free = singleSlots.filter(s => !occupied.some(o => o.day === s.day && o.startMinute < s.endMinute && s.startMinute < o.endMinute))
      if (free.length) {
        const index = parseInt(hash(`${seed}:${teacher.id}`).slice(0, 8), 16) % free.length, slot = free[index]
        unavailable.push({ resourceId: teacher.id, day: slot.day, startMinute: slot.startMinute, endMinute: slot.endMinute })
      }
    }
  }
  // 같은 과목의 반복 활동은 같은 시간 선호를 갖게 하여 불필요한 카드 구분을 만들지 않는다.
  for (const lesson of lessons) for (const slotId of lesson.allowedSlotIds) {
    const value = parseInt(hash(`${seed}:${lesson.courseId}:${slotId}`).slice(0, 8), 16) % 11
    if (value < 3) preferences.push({ lessonId: lesson.id, slotId, weight: value + 1 })
  }
  const basis = { schemaVersion: 1, id: `synthetic_quality_${classes}_${complex ? 'complex' : 'simple'}`, revision: 1,
    schoolId: 'synthetic_quality_school', termId: 'synthetic_term', sourceFingerprint: '', schoolLevel: 'middle', unsupportedFeatures: [],
    resources, slots, lessons, courseLoads, fixed, unavailable, preferences }
  basis.sourceFingerprint = hash(JSON.stringify(basis))
  return { basis, witness, label: `실제 학교가 아닌 합성 ${classes}학급·${classes * 30}시수 ${complex ? '공동교사·집단·자원·블록·고정·불가시간 포함' : '기본 반복과목'} 문제` }
}
