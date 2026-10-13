import { ContractError, type CalendarEvent, type SaveCommand } from '../contracts'
import type { SupabaseConnection } from './supabase-connection'
import { eventResponse } from './validation'

// 학교·작성자·현재 소속은 서버가 auth.uid 기준으로 검증한다. 로컬 검사는 응답 형식 보호다.
export function createSupabaseCalendarAdapter(connection: SupabaseConnection) {
  const parse=(raw:unknown,memberId:string):CalendarEvent=>{
    const context=connection.info()
    const member=context.memberships.find(item=>item.id===memberId)
    if(!member) throw new ContractError('QUERY_FAILED','학교 연결을 새로 불러와 주세요.')
    return eventResponse(raw,member.schoolId,context.memberships)
  }
  return {
    info: () => connection.info(),
    async list(memberId: string): Promise<CalendarEvent[]> {
      const rows = await connection.rpcVerified('workhub_calendar_list', { p_member_id: memberId })
      if (!Array.isArray(rows)) throw new ContractError('QUERY_FAILED', '일정 목록 응답을 확인할 수 없습니다.')
      return rows.map(row=>parse(row,memberId))
    },
    async get(memberId: string, id: string): Promise<CalendarEvent> {
      return parse(await connection.rpcVerified('workhub_calendar_get', { p_member_id: memberId, p_event_id: id }),memberId)
    },
    async save(memberId: string, command: SaveCommand): Promise<CalendarEvent> {
      // 충돌 응답은 저장 직전의 가시 학교 context로 검증한다(오류 시 connection 캐시가 비워짐).
      const context=connection.info()
      try { return parse(await connection.rpcVerified('workhub_calendar_save', { p_member_id: memberId, p_command: command }),memberId) }
      catch(error) {
        if(error instanceof ContractError && error.code==='CONFLICT' && error.current) {
          const member=context.memberships.find(item=>item.id===memberId)
          if(!member) throw new ContractError('QUERY_FAILED','학교 연결을 새로 불러와 주세요.')
          error.current=eventResponse(error.current,member.schoolId,context.memberships)
        }
        throw error
      }
    },
  }
}
