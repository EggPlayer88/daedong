import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, ServiceError } from '../services/scoped-rpc'
import { CONTRACT, snapshot, intent, preview, command, receipt, closeResult, type RosterServer } from './contracts'

export function createTeacherRosterServer(connection: SupabaseConnection): RosterServer {
  const rpc = createScopedRpc(connection, CONTRACT)
  const key = (value: string) => { if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw new ServiceError('INVALID_INPUT'); return value }
  return {
    get: memberId => rpc.call(memberId, 'workhub_teacher_roster_get', {}, snapshot),
    preview(memberId, value) { const input = intent(value); return rpc.call(memberId, 'workhub_teacher_roster_preview', { p_intent: input }, v => preview(v, input)) },
    commit(memberId, value, requestKey) { const c = command(value); return rpc.call(memberId, 'workhub_teacher_roster_commit', { p_command: c, p_request_key: key(requestKey) }, v => receipt(v, c, requestKey), true) },
    close(memberId, value, requestKey) { const c = command(value); return rpc.call(memberId, 'workhub_teacher_roster_close', { p_command: c, p_request_key: key(requestKey) }, v => closeResult(v, c, requestKey), true) },
  }
}
