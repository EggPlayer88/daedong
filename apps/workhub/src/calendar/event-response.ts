import type { CalendarEvent, Membership } from '../contracts'
import { normalizeDraft } from '../domain'
import { bad, record, str } from '../response-values'

// 일정 화면과 연결 어댑터가 같은 순수 응답 검증을 사용한다.
export function eventResponse(value: unknown, schoolId: string, members: Membership[]): CalendarEvent {
  const raw=record(value)
  if(raw.schoolId!==schoolId || !Number.isSafeInteger(raw.version) || (raw.version as number)<1) return bad()
  const author=members.find(m=>m.id===raw.authorMemberId&&m.schoolId===schoolId)
  if(!author) return bad()
  const updatedAt=str(raw.updatedAt,60)
  if(Number.isNaN(Date.parse(updatedAt))) return bad()
  try {
    const normalized=normalizeDraft(raw as unknown as CalendarEvent,author,members)
    return {...normalized,id:str(raw.id),schoolId,authorMemberId:author.id,version:raw.version as number,updatedAt}
  } catch { return bad() }
}
