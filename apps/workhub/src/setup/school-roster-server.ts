import type { SupabaseConnection } from '../connection/supabase-connection'
import { ServiceError } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { SCHOOL_ROSTER_CONTRACT, schoolRosterSnapshot, schoolRosterIntent, schoolRosterPreview, schoolRosterCommand, schoolRosterReceipt, schoolRosterCloseResult, type SchoolRosterServer } from './school-roster-contracts'

// 가상 교사·이름 매칭을 이 경로에 넣지 않는다. 서버가 허용한 기존 회원 UID만 연결한다.
export function createSchoolRosterServer(connection: SupabaseConnection, options: {timeoutMs?: number} = {}): SchoolRosterServer {
  const transport=createScopedRpc(connection,SCHOOL_ROSTER_CONTRACT,options)
  return {
    get: memberId=>transport.call(memberId,'workhub_school_roster_get',{},schoolRosterSnapshot),
    preview(memberId,input) {
      const intent=schoolRosterIntent(input)
      return transport.call(memberId,'workhub_school_roster_preview',{p_intent:intent},raw=>schoolRosterPreview(raw,intent))
    },
    commit(memberId,input,key) {
      const command=schoolRosterCommand(input)
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(key))throw new ServiceError('INVALID_INPUT')
      // 만료된 미리보기여도 기존 번호 결과 확인은 원문 그대로 보낸다. 접수증 우선 판정은 서버 책임이다.
      return transport.call(memberId,'workhub_school_roster_commit',{p_command:command,p_request_key:key},raw=>schoolRosterReceipt(raw,command,key),true)
    },
    close(memberId,input,key) {
      const command=schoolRosterCommand(input)
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(key))throw new ServiceError('INVALID_INPUT')
      // CONFLICT만 보고 입력 잠금을 풀지 않는다. 서버가 원접수증 또는 취소 장벽을 확정해야 한다.
      return transport.call(memberId,'workhub_school_roster_close',{p_command:command,p_request_key:key},raw=>schoolRosterCloseResult(raw,command,key),true)
    },
  }
}
