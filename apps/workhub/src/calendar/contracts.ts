import type { CalendarEvent, SaveCommand } from '../contracts'

// 화면은 저장 위치를 모른다. 실제 서버와 개발 저장소가 같은 계약을 구현한다.
export interface CalendarAdapter {
  list(memberId: string): Promise<CalendarEvent[]>
  get(memberId: string, id: string): Promise<CalendarEvent>
  save(memberId: string, command: SaveCommand): Promise<CalendarEvent>
  simulateConcurrentEdit?: (memberId: string, eventId: string) => CalendarEvent
  failNextSave?: () => void
}

export type RelationOptions = Record<'departmentIds' | 'gradeIds' | 'subjectIds', Array<{ id: string; name: string }>>
