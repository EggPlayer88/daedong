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
  // 옛 일정 응답은 그대로 허용한다. 상태 정보가 오면 세 필드의 조합까지 검증한다.
  let lifecycle: Pick<CalendarEvent, 'status' | 'cancelledAt' | 'cancelReason'> = {}
  if (['status', 'cancelledAt', 'cancelReason'].some(key => Object.hasOwn(raw, key))) {
    if (raw.status === 'active' && raw.cancelledAt === null && raw.cancelReason === null) lifecycle = {status:'active',cancelledAt:null,cancelReason:null}
    else if (raw.status === 'cancelled' && typeof raw.cancelledAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw.cancelledAt) && Number.isFinite(Date.parse(raw.cancelledAt)) &&
      typeof raw.cancelReason === 'string' && raw.cancelReason.trim() && [...raw.cancelReason].length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw.cancelReason))
      lifecycle = {status:'cancelled',cancelledAt:raw.cancelledAt,cancelReason:raw.cancelReason}
    else return bad()
  }
  try {
    const normalized=normalizeDraft(raw as unknown as CalendarEvent,author,members)
    return {...normalized,id:str(raw.id),schoolId,authorMemberId:author.id,version:raw.version as number,updatedAt,...lifecycle}
  } catch { return bad() }
}
