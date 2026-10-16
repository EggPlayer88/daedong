import type { TimetableSnapshot, TimetableBasis } from './contracts'
import { timetableWeekStart } from './server'

// 사용자가 연습을 선택했을 때만 쓴다. 실제 학교 자료나 저장 가능한 초안으로 취급하지 않는다.
export function timetablePracticeSnapshot(date: string): TimetableSnapshot {
  const slots = [1, 2, 3].flatMap(day => [0, 1, 2].map(period => ({ id: `practice-${day}-${period + 1}`, day, label: `${period + 1}교시`, startMinute: 540 + period * 55, endMinute: 585 + period * 55, periods: 1 })))
  const basis: TimetableBasis = {
    schemaVersion: 1, id: 'practice-basis', revision: 1, schoolId: 'practice-school', termId: 'practice-term', sourceFingerprint: 'a'.repeat(64), schoolLevel: 'middle', unsupportedFeatures: [],
    resources: [
      { id: 'practice-teacher-a', kind: 'teacher', label: '예시 교사 가', capacity: 1 },
      { id: 'practice-teacher-b', kind: 'teacher', label: '예시 교사 나', capacity: 1 },
      { id: 'practice-class-a', kind: 'class', label: '예시 1반', capacity: 1 },
      { id: 'practice-class-b', kind: 'class', label: '예시 2반', capacity: 1 },
      { id: 'practice-room', kind: 'room', label: '예시 실험실', capacity: 1 },
    ], slots,
    lessons: [
      { id: 'practice-lesson-a1', courseId: 'practice-course-a', label: '예시 1반 과학 1회', periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-a', 'practice-room'], allowedSlotIds: slots.map(slot => slot.id) },
      { id: 'practice-lesson-a2', courseId: 'practice-course-a', label: '예시 1반 과학 2회', periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-a', 'practice-room'], allowedSlotIds: slots.map(slot => slot.id) },
      { id: 'practice-lesson-b1', courseId: 'practice-course-b', label: '예시 2반 과학 1회', periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-b', 'practice-room'], allowedSlotIds: slots.map(slot => slot.id) },
      { id: 'practice-lesson-b2', courseId: 'practice-course-b', label: '예시 2반 과학 2회', periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-b', 'practice-room'], allowedSlotIds: slots.map(slot => slot.id) },
      { id: 'practice-lesson-c1', courseId: 'practice-course-c', label: '예시 1반 국어', periods: 1, resourceIds: ['practice-teacher-b', 'practice-class-a'], allowedSlotIds: slots.map(slot => slot.id) },
      { id: 'practice-lesson-d1', courseId: 'practice-course-d', label: '예시 2반 국어', periods: 1, resourceIds: ['practice-teacher-b', 'practice-class-b'], allowedSlotIds: slots.map(slot => slot.id) },
    ],
    courseLoads: [{ courseId: 'practice-course-a', periods: 2 }, { courseId: 'practice-course-b', periods: 2 }, { courseId: 'practice-course-c', periods: 1 }, { courseId: 'practice-course-d', periods: 1 }], fixed: [], unavailable: [], preferences: [],
  }
  return { basis, canDesign: true, canSave: false, drafts: [], weekStart: timetableWeekStart(date), lessons: [] }
}
