import type { PersonalTask, TaskStatus } from './contracts'

export const taskStatusLabels: Readonly<Record<TaskStatus, string>> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }

export type TaskDueFilter = 'overdue' | 'today' | 'upcoming' | 'none'
export const TASK_DUE_FILTERS: readonly TaskDueFilter[] = ['overdue', 'today', 'upcoming', 'none']
export const taskDueLabels: Readonly<Record<TaskDueFilter, string>> = { overdue: '기한 지남', today: '오늘까지', upcoming: '예정', none: '기한 없음' }
export const isOpenTask = (task: PersonalTask): boolean => task.status !== 'done' && task.status !== 'cancelled'

// 검증을 통과한 업무를 표시 목적으로만 분류한다. 원본 상태와 기한은 바꾸지 않는다.
export function taskDueGroup(task: PersonalTask, date: string): TaskDueFilter {
  return !task.dueDate ? 'none' : task.dueDate < date ? 'overdue' : task.dueDate === date ? 'today' : 'upcoming'
}
export function compareTasks(a: PersonalTask, b: PersonalTask): number {
  return Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}
export function taskNoteExcerpt(notes: string, limit = 90): string {
  const points = Array.from(notes.replace(/\s+/gu, ' ').trim())
  return points.length > limit ? `${points.slice(0, limit).join('')}…` : points.join('')
}
export function summarizeTasks(tasks: readonly PersonalTask[], date: string) {
  const open = tasks.filter(isOpenTask).sort(compareTasks)
  const counts: Record<TaskDueFilter, number> = { overdue: 0, today: 0, upcoming: 0, none: 0 }
  for (const task of open) counts[taskDueGroup(task, date)]++
  return { counts, total: open.length, items: open.slice(0, 4).map(task => ({ task, reason: taskDueLabels[taskDueGroup(task, date)] })) }
}

// 목록과 원본 조회의 응답 순서가 달라도 방금 확인한 더 최신 판을 표시한다.
export function withSelectedTask(tasks: readonly PersonalTask[], selected?: PersonalTask): PersonalTask[] {
  if (!selected) return [...tasks]
  const current = tasks.find(task => task.id === selected.id)
  if (current && current.version >= selected.version) return [...tasks]
  return current ? tasks.map(task => task.id === selected.id ? selected : task) : [...tasks, selected]
}
