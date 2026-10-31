import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { canonical, identifier, object, ServiceError } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { INTERVENTIONS_CONTRACT, type InterventionCommand, type InterventionReceipt, type TimetableInterventionsServer } from './interventions-contracts'
import { interventionCommand, interventionHash, interventionInput, interventionRange, parseInterventionClose, parseInterventionPreview, parseInterventionReceipt, parseInterventionSource, parseInterventionsReadiness, parseInterventionsSummary, parseInterventionsView } from './interventions-domain'

/** 기존 인증·학교 검증을 재사용하며 모듈이 꺼진 동안에도 원키 복구를 선행 차단하지 않는다. */
export function createTimetableInterventionsServer(connection: SupabaseConnection, options: { timeoutMs?: number; now?: () => number } = {}): TimetableInterventionsServer {
  // T3 미설치만 준비 중으로 구분한다. 기존 T2 알림은 계속 열고 네트워크·권한 실패는 숨기지 않는다.
  const scopedConnection: SupabaseConnection = { ...connection, async rpcVerified(name, args) {
    try { return await connection.rpcVerified(name, args) }
    catch (error) {
      if (object(error) && (error.code === 'PGRST202' || error.rpcCode === 'PGRST202')) {
        const member = connection.info().memberships.find(row => row.id === args?.p_member_id)
        return { contract: INTERVENTIONS_CONTRACT, schoolId: member?.schoolId, memberId: args?.p_member_id, error: { code: 'NOT_READY' } }
      }
      throw error
    }
  } }
  const rpc = createScopedRpc(scopedConnection, INTERVENTIONS_CONTRACT, options)
  const original = new Map<string, string>(), receipts = new Map<string, string>(), closed = new Map<string, string>()
  const now = () => options.now?.() ?? Date.now()
  function scope(memberId: string) {
    const member = connection.info().memberships.find(row => row.id === identifier(memberId))
    if (!member) throw new ServiceError('CANCELLED')
    return recoveryScope(member)
  }
  function remember(token: string, command: InterventionCommand, key: string) {
    identifier(key); if (key.length < 8) throw new ServiceError('INVALID_INPUT')
    const id = token + ':' + key, value = canonical(command)
    if (original.has(id) && original.get(id) !== value) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    original.set(id, value); return id
  }
  function receipt(id: string, value: InterventionReceipt) {
    const canonicalReceipt = canonical(value)
    if (closed.has(id) || receipts.has(id) && receipts.get(id) !== canonicalReceipt) throw new ServiceError('RESULT_UNKNOWN')
    receipts.set(id, canonicalReceipt); return value
  }
  async function send(memberId: string, raw: InterventionCommand, key: string, recovering: boolean) {
    const command = interventionCommand(raw), token = scope(memberId), id = remember(token, command, key)
    if (closed.has(id)) throw new ServiceError('CONFLICT')
    // 해시 계산·조회 중 판이 바뀌더라도 원문은 수정하지 않는다.
    const digest = await interventionHash(command)
    if (token !== scope(memberId)) throw new ServiceError('CANCELLED')
    const result = await rpc.call(memberId, 'workhub_timetable_interventions_execute', { p_command: command, p_request_key: key, p_recover_only: recovering }, value => parseInterventionReceipt(value, command, key, digest, now()), !recovering)
    if (token !== scope(memberId)) throw new ServiceError('CANCELLED')
    return receipt(id, result)
  }
  return {
    readiness(memberId) { return rpc.call(memberId, 'workhub_timetable_interventions_readiness', {}, parseInterventionsReadiness) },
    get(memberId, from, until) {
      const range = interventionRange(from, until)
      return rpc.call(memberId, 'workhub_timetable_interventions_get', { p_from: range.from, p_until: range.until }, value => parseInterventionsView(value, memberId, from, until, now()))
    },
    preview(memberId, raw, source) {
      const input = interventionInput(raw)
      return rpc.call(memberId, 'workhub_timetable_interventions_preview', { p_input: input }, value => parseInterventionPreview(value, input, source, now()))
    },
    execute(memberId, command, key) { return send(memberId, command, key, false) },
    recover(memberId, command, key) { return send(memberId, command, key, true) },
    async close(memberId, raw, key) {
      const command = interventionCommand(raw), token = scope(memberId), id = remember(token, command, key), digest = await interventionHash(command)
      if (token !== scope(memberId)) throw new ServiceError('CANCELLED')
      const result = await rpc.call(memberId, 'workhub_timetable_interventions_close', { p_command: command, p_request_key: key }, value => parseInterventionClose(value, command, key, digest, now()), true)
      if (token !== scope(memberId)) throw new ServiceError('CANCELLED')
      if (result.outcome === 'applied') receipt(id, result.receipt)
      else {
        const text = canonical(result)
        if (receipts.has(id) || closed.has(id) && closed.get(id) !== text) throw new ServiceError('RESULT_UNKNOWN')
        closed.set(id, text)
      }
      return result
    },
    resolve(memberId, sourceId) { return rpc.call(memberId, 'workhub_timetable_interventions_resolve', { p_source_id: identifier(sourceId) }, parseInterventionSource) },
    summary(memberId) { return rpc.call(memberId, 'workhub_timetable_interventions_summary', {}, value => parseInterventionsSummary(value, now())) },
  }
}
