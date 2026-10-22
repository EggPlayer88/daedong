import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { canonical, createScopedRpc, identifier, object, ServiceError } from '../services/scoped-rpc'
import { TARGET_CONTRACT, targetCommand, targetReceipt, targetSnapshot, type TargetCommand, type TargetServer, type TargetSnapshot } from './target'
import policy from './target-policy.json'

export function createTimetableTargetServer(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): TargetServer {
  // 기존 T1에는 조회 함수가 없다. 함수 부재만 선택기 준비 중으로 분리하고 네트워크 실패는 숨기지 않는다.
  const scopedConnection: SupabaseConnection = { ...connection, async rpcVerified(name, args) {
    try { return await connection.rpcVerified(name, args) }
    catch (error) {
      if (object(error) && (error.code === 'PGRST202' || error.rpcCode === 'PGRST202')) {
        const member = connection.info().memberships.find(row => row.id === args?.p_member_id)
        return { contract: TARGET_CONTRACT, schoolId: member?.schoolId, memberId: args?.p_member_id, error: { code: 'NOT_READY' } }
      }
      throw error
    }
  } }
  const rpc = createScopedRpc(scopedConnection, TARGET_CONTRACT, options)
  const sources = new Map<string, { scope: string; snapshot: TargetSnapshot }>(), requests = new Map<string, TargetCommand>(), missingReceipts = new Set<string>()
  const scope = (memberId: string) => { const member = connection.info().memberships.find(row => row.id === memberId); if (!member) throw new ServiceError('CANCELLED'); return recoveryScope(member) }
  function request(memberId: string, raw: TargetCommand, key: string) {
    identifier(key); if (key.length < policy.minRequestKeyLength) throw new ServiceError('INVALID_INPUT')
    const input = targetCommand(raw), token = scope(memberId), requestId = token + ':' + key, previous = requests.get(requestId)
    if (previous && canonical(previous) !== canonical(input)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    return { input, token, requestId }
  }
  return {
    async get(memberId) {
      const token = scope(memberId)
      const snapshot = await rpc.call(memberId, 'workhub_timetable_target_get', {}, targetSnapshot)
      if (scope(memberId) !== token) throw new ServiceError('CANCELLED')
      sources.set(memberId, { scope: token, snapshot: structuredClone(snapshot) }); return snapshot
    },
    execute(memberId, raw, key) {
      const { input, token, requestId } = request(memberId, raw, key), source = sources.get(memberId)
      if (!source) throw new ServiceError('NOT_READY')
      if (source.scope !== token) throw new ServiceError('CANCELLED')
      targetCommand(input, source.snapshot); requests.set(requestId, structuredClone(input))
      return rpc.call(memberId, 'workhub_timetable_target_set', { p_input: input, p_request_key: key, p_recover_only: false }, value => targetReceipt(value, input, key, source.snapshot), true)
    },
    recover(memberId, raw, key) {
      const { input, requestId } = request(memberId, raw, key); requests.set(requestId, structuredClone(input))
      missingReceipts.delete(requestId)
      return rpc.call(memberId, 'workhub_timetable_target_set', { p_input: input, p_request_key: key, p_recover_only: true }, value => targetReceipt(value, input, key)).catch(error => {
        if (error instanceof ServiceError && error.code === 'NOT_FOUND') missingReceipts.add(requestId)
        throw error
      })
    },
    resend(memberId, raw, key) {
      const { input, requestId } = request(memberId, raw, key)
      // NOT_FOUND는 늦은 최초 요청을 취소하는 증거가 아니다. 조회한 원키·원문만 재전송한다.
      if (!requests.has(requestId) || !missingReceipts.has(requestId)) throw new ServiceError('NOT_READY')
      missingReceipts.delete(requestId)
      return rpc.call(memberId, 'workhub_timetable_target_set', { p_input: input, p_request_key: key, p_recover_only: false }, value => targetReceipt(value, input, key), true)
    },
  }
}
