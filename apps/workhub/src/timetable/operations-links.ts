import type { OperationLesson, OperationsView } from './operations-contracts'
import type { InterventionKind, InterventionsView } from './interventions-contracts'
import { parseInterventionsView } from './interventions-domain'
import { canonical } from '../services/scoped-rpc'

export interface InterventionOpenIntent {
  kind: 'substitute' | 'cancel' | 'makeup'; lessonId: string; token: string
  expectedVersion?: number; origin?: 'home' | 'timetable'
}
export interface VerifiedLessonChange {
  lessonId: string; kind: InterventionKind; label: string
  before: OperationLesson | null; after: OperationLesson; originalLessonId: string
}
const labels: Record<InterventionKind, string> = { substitute: '대강 반영', cancel: '휴강 반영', makeup: '보강 반영', reopen: '휴업 취소 반영' }
export function sameOperationLesson(left: OperationLesson, right: OperationLesson) {
  const snapshot = ({ canRequest: _allowed, allowedTargets: _targets, ...lesson }: OperationLesson) => lesson
  return canonical(snapshot(left)) === canonical(snapshot(right))
}

/** 다른 조회의 이력은 현재 수업과 ID·판·실제 내용까지 일치할 때만 설명 근거로 쓴다. */
export function verifiedInterventionChanges(view: OperationsView, extension: InterventionsView | undefined, memberId: string): { available: boolean; changes: VerifiedLessonChange[] } {
  if (!extension) return { available: false, changes: [] }
  try {
    if (extension.timeZone !== view.timeZone || extension.from !== view.from || extension.until !== view.until) return { available: false, changes: [] }
    const checked = parseInterventionsView(extension, memberId, view.from, view.until)
    const current = new Map(view.lessons.map(lesson => [lesson.id, lesson]))
    const snapshots = new Map(checked.lessons.map(lesson => [lesson.id, lesson]))
    const changes: VerifiedLessonChange[] = []
    for (const request of checked.requests) {
      if (request.state !== 'applied') continue
      for (const change of request.changes) {
        const lesson = current.get(change.after.id), snapshot = snapshots.get(change.after.id)
        if (!lesson || !snapshot || !sameOperationLesson(lesson, snapshot) || !sameOperationLesson(lesson, change.after)) continue
        changes.push({
          lessonId: lesson.id, kind: request.kind, label: labels[request.kind],
          before: change.before, after: change.after,
          originalLessonId: request.input.kind === 'makeup' ? request.input.lessonId : '',
        })
      }
    }
    return { available: true, changes }
  } catch { return { available: false, changes: [] } }
}

export function matchedInterventionLesson(lesson: OperationLesson, extension: InterventionsView | undefined) {
  const found = extension?.lessons.find(row => row.id === lesson.id)
  return found && sameOperationLesson(lesson, found) ? found : undefined
}
