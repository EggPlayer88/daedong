import type { CalendarAdapter } from '../calendar/contracts'
import { eventTime, visibilityLabels } from '../calendar/EventEditor'
import { ContractError, type Membership } from '../contracts'
import { activeAt, canRead } from '../domain'
import type { TaskAdapter, TaskStatus } from '../tasks/contracts'
import { taskListResponse } from '../tasks/validation'
import type { WorkflowStore } from '../workflows/store'
import type { SearchItem, SearchSource } from './contracts'

const taskLabels: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }
function usable(member: Membership, date: string) {
  if (!activeAt(member, date)) throw new ContractError('INACTIVE_MEMBERSHIP', '현재 이용 가능한 학교 소속을 확인해 주세요.')
}

export function calendarSearchSource(adapter: CalendarAdapter, member: Membership, date: string): SearchSource {
  return { kind: 'calendar', label: '학교 일정', async load() {
    usable(member, date)
    const events = await adapter.list(member.id)
    if (!Array.isArray(events)) throw new Error('일정 조회 형식 확인 필요')
    return events.filter(event => canRead(event, member, date)).map(event => ({
      kind: 'calendar', id: event.id, title: event.title, description: event.description,
      meta: `${event.startDate}${event.endDate === event.startDate ? '' : ` ~ ${event.endDate}`} · ${eventTime(event)} · ${event.location || '장소 미지정'} · ${visibilityLabels[event.visibility]}`,
      date: event.startDate,
    }))
  } }
}

export function taskSearchSource(adapter: TaskAdapter, member: Membership, date: string): SearchSource {
  return { kind: 'task', label: '내 업무', async load() {
    usable(member, date)
    const tasks = taskListResponse(await adapter.list(member.id), { memberId: member.id, schoolId: member.schoolId })
    return tasks.map(task => ({ kind: 'task', id: task.id, title: task.title, description: task.notes,
      meta: `${taskLabels[task.status]} · ${task.dueDate ? `${task.dueDate}까지` : '기한 없음'} · 나만 보는 업무`, date: task.dueDate || undefined,
    }))
  } }
}

// 미리보기 수합 전용이다. 원시 저장소/전체 스냅샷 대신 기존 열람 함수를 이용한다.
export function collectionSearchSource(store: WorkflowStore, member: Membership, date: string): SearchSource {
  return { kind: 'collection', label: '자료 수합', async load(): Promise<SearchItem[]> {
    usable(member, date)
    return store.listCollections(member.id).map(request => ({ kind: 'collection', id: request.id,
      title: request.title, description: request.instructions, date: request.dueDate,
      meta: `${request.dueDate}까지 · ${request.status === 'draft' ? '요청 초안' : '공개된 수합'} · ${request.managerMemberId === member.id ? '내가 만든 수합' : '참여하는 수합'}`,
    }))
  } }
}
