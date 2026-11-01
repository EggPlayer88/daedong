import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { canonical, identifier, ServiceError } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { SETUP_CONTRACT, setupCommand, setupReceipt, setupSnapshot, type SetupCommand, type SetupServer, type SetupSnapshot } from './setup'
import policy from './setup-policy.json'

export function createTimetableSetupServer(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): SetupServer {
  const rpc = createScopedRpc(connection, SETUP_CONTRACT, options)
  const sources = new Map<string, { scope: string; value: SetupSnapshot }>()
  const requests = new Map<string, SetupCommand>()
  const scope = (memberId: string) => {
    const member = connection.info().memberships.find(row => row.id === memberId)
    if (!member) throw new ServiceError('CANCELLED')
    return recoveryScope(member)
  }
  function request(memberId: string, raw: SetupCommand, key: string) {
    identifier(key); if (key.length < policy.minRequestKeyLength) throw new ServiceError('INVALID_INPUT')
    const command = setupCommand(raw), token = scope(memberId), requestId = token + ':' + key, previous = requests.get(requestId)
    if (previous && canonical(previous) !== canonical(command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    return { command, token, requestId }
  }
  return {
    async get(memberId) {
      const value = await rpc.call(memberId, 'workhub_timetable_setup_get', {}, setupSnapshot)
      sources.set(memberId, { scope: scope(memberId), value: structuredClone(value) })
      return value
    },
    execute(memberId, raw, key) {
      const { command, token, requestId } = request(memberId, raw, key), saved = sources.get(memberId)
      if (!saved) throw new ServiceError('NOT_READY')
      if (saved.scope !== token) throw new ServiceError('CANCELLED')
      setupCommand(command, saved.value)
      requests.set(requestId, structuredClone(command))
      return rpc.call(memberId, 'workhub_timetable_setup_execute', { p_command: command, p_request_key: key, p_recover_only: false }, value => setupReceipt(value, command, key), true)
    },
    recover(memberId, raw, key) {
      const { command, requestId } = request(memberId, raw, key)
      requests.set(requestId, structuredClone(command))
      // 모듈 중지·원본 변경·재조회 실패 뒤에도 원장에 남은 최초 접수증만 확인한다.
      return rpc.call(memberId, 'workhub_timetable_setup_execute', { p_command: command, p_request_key: key, p_recover_only: true }, value => setupReceipt(value, command, key))
    },
  }
}
