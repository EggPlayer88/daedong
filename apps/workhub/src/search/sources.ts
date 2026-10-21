import type { CalendarAdapter } from '../calendar/contracts'
import { eventTime, visibilityLabels } from '../calendar/formatting'
import { ContractError, type Membership } from '../contracts'
import { activeAt, canRead } from '../domain'
import type { TaskAdapter, TaskStatus } from '../tasks/contracts'
import { taskListResponse } from '../tasks/validation'
import type { WorkflowStore } from '../workflows/store'
import { enabledModules, type PageId, type WorkspaceMode } from '../modules'
import type { SearchItem, SearchSource } from './contracts'

const taskLabels: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', waiting: '대기', done: '완료', cancelled: '취소' }
function usable(member: Membership, date: string) {
  if (!activeAt(member, date)) throw new ContractError('INACTIVE_MEMBERSHIP', '현재 이용 가능한 학교 소속을 확인해 주세요.')
}

const menuHints: Record<PageId, string> = {
  home: '오늘 할 일과 확인할 소식', calendar: '학사일정 · 학교 행사 · 일정 등록', tasks: '나의 할 일과 기한 관리',
  collections: '양식 배포 · 문서 제출 · 제출 현황', documents: '문서 작성 · 초안 · 보관 문서 · 기존 평가계획서 연결은 문서함에서 확인',
  cooperation: '업무 요청 · 수락 · 반려 · 완료 확인', assistant: '학교 업무 질문 · AI 도움',
  knowledge: '학교 규정 · 연간 계획 · 업무 안내 · 원문', messages: '교사 대화 · 메신저 · 알림',
  schoolAdmin: '교과 · 학급 · 교사 · 부서 · 학년도 관리', timetable: '시간표 편성 · 교환 · 날짜별 수업',
  students: '수업 · 학생 · 관찰 · 평가 · 기록 출력',
}
// 실제 등록 메뉴만 제공하며 검색을 위해 메뉴 공개 범위를 늘리지 않는다.
export function menuSearchSource(mode: WorkspaceMode): SearchSource {
  return { kind: 'menu', label: '메뉴', async load() {
    return { items: enabledModules(mode).map(module => ({ kind: 'menu' as const, id: module.id, title: module.title,
      description: menuHints[module.id], meta: '메뉴로 이동' })), nextCursor: null, coverage: '현재 업무 공간에서 제공하는 메뉴' }
  } }
}

export function calendarSearchSource(adapter: CalendarAdapter, member: Membership, date: string): SearchSource {
  return { kind: 'calendar', label: '학교 일정', async load() {
    usable(member, date)
    const events = await adapter.list(member.id)
    if (!Array.isArray(events)) throw new Error('일정 조회 형식 확인 필요')
    return events.filter(event => canRead(event, member, date)).map(event => ({
      kind: 'calendar', id: event.id, title: event.title, description: event.description,
      meta: `${event.startDate}${event.endDate === event.startDate ? '' : ` ~ ${event.endDate}`} · ${eventTime(event)} · ${event.location || '장소 미지정'} · ${visibilityLabels[event.visibility]}`,
      searchValues: [event.endDate, event.location, ...(event.allDay ? [] : [event.startTime, event.endTime])],
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
