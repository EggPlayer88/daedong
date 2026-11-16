import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, ServiceError } from '../services/scoped-rpc'
import { ROSTER_BRIDGE_CONTRACT, rosterOperatingChoices, rosterOperatingInput, rosterOperatingPreview, rosterOperatingCommand, rosterOperatingReceipt, type RosterOperatingServer } from './roster-bridge-contracts'
export function createRosterOperatingServer(connection: SupabaseConnection): RosterOperatingServer {
 const rpc = createScopedRpc(connection, ROSTER_BRIDGE_CONTRACT)
 const local = <T,>(read: () => T): T => { try { return read() } catch { throw new ServiceError('INVALID_INPUT') } }
 const key = (v: string) => { if (!/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw new ServiceError('INVALID_INPUT'); return v }
 return {
  get: memberId => rpc.call(memberId, 'workhub_timetable_roster_bridge_get', {}, rosterOperatingChoices),
  preview(memberId, value) { const input = local(() => rosterOperatingInput(value)); return rpc.call(memberId, 'workhub_timetable_roster_bridge_preview', { p_input: input }, v => rosterOperatingPreview(v, input)) },
  commit(memberId, value, requestKey, recoverOnly) { const command = local(() => rosterOperatingCommand(value)); return rpc.call(memberId, 'workhub_timetable_roster_bridge_commit', { p_command: command, p_request_key: key(requestKey), p_recover_only: recoverOnly }, v => rosterOperatingReceipt(v, command, requestKey), !recoverOnly) },
  close(memberId, value, requestKey) { const command = local(() => rosterOperatingCommand(value)); return rpc.call(memberId, 'workhub_timetable_roster_bridge_close', { p_command: command, p_request_key: key(requestKey) }, v => {
   if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'outcome,receipt') throw new ServiceError('INVALID_RESPONSE')
   const raw = v as Record<string, unknown>
   if (raw.outcome === 'closed' && raw.receipt === null) return { outcome: 'closed' as const, receipt: null }
   if (raw.outcome === 'applied') return { outcome: 'applied' as const, receipt: rosterOperatingReceipt(raw.receipt, command, requestKey) }
   throw new ServiceError('INVALID_RESPONSE')
  }, true) },
 }
}
