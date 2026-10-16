import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { canonical, createScopedRpc, identifier, ServiceError, validateLocalInput } from '../services/scoped-rpc'
import { PREPARATION_CONTRACT, preparationSource, preparationInput, preparationReceipt, type PreparationInput, type PreparationServer, type PreparationSource } from './preparation'

export function createPreparationServer(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): PreparationServer {
  const rpc = createScopedRpc(connection, PREPARATION_CONTRACT, options), sources = new Map<string, { scope: string; source: PreparationSource }>(), requests = new Map<string, { input: PreparationInput; source: PreparationSource }>()
  const scope = (memberId: string) => { const member = connection.info().memberships.find(row => row.id === memberId); if (!member) throw new ServiceError('CANCELLED'); return recoveryScope(member) }
  return {
    async get(memberId) {
      const result = await rpc.call(memberId, 'workhub_timetable_preparation_get', {}, (raw, member) => preparationSource(raw, member.schoolId))
      sources.set(memberId, { scope: scope(memberId), source: structuredClone(result) }); return result
    },
    execute(memberId, input, key) {
      identifier(key); if (key.length < 8) throw new ServiceError('INVALID_INPUT')
      const token = scope(memberId), saved = sources.get(memberId), previous = requests.get(token + ':' + key)
      if (previous && canonical(previous.input) !== canonical(input)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
      if (!saved) throw new ServiceError('NOT_READY')
      if (saved.scope !== token) throw new ServiceError('CANCELLED')
      const source = saved.source
      if (!source.canEdit || input.kind === 'confirm' && !source.canConfirm) throw new ServiceError('FORBIDDEN')
      const command = validateLocalInput(() => preparationInput(input, source))
      if (command.draftId !== (source.savedDraft?.id ?? null) || command.expectedDraftRevision !== (source.savedDraft?.revision ?? null)) throw new ServiceError('CONFLICT')
      requests.set(token + ':' + key, { input: structuredClone(command), source: structuredClone(source) })
      return rpc.call(memberId, 'workhub_timetable_preparation_execute', { p_input: command, p_request_key: key, p_recover_only: false }, (raw, member) => {
        const receipt = preparationReceipt(raw, command, key, source)
        if (receipt.basis && receipt.basis.schoolId !== member.schoolId) throw new ServiceError('INVALID_RESPONSE')
        return receipt
      }, true)
    },
    recover(memberId, input, key, originalSource) {
      identifier(key); if (key.length < 8) throw new ServiceError('INVALID_INPUT')
      const command = validateLocalInput(() => preparationInput(input)), previous = requests.get(scope(memberId) + ':' + key)
      if (previous && canonical(previous.input) !== canonical(command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
      const member = connection.info().memberships.find(row => row.id === memberId)
      const original = originalSource ?? previous?.source
      // 복구 응답도 최초 공식 자료와 전부 대조한다. 최신 get 실패가 복구를 막지는 않는다.
      if (!member || !original) throw new ServiceError('INVALID_INPUT')
      const source = validateLocalInput(() => preparationSource(original, member.schoolId))
      validateLocalInput(() => preparationInput(command, source))
      // 최신 원본 조회나 기능 상태를 복구 명령 앞에 두지 않는다.
      return rpc.call(memberId, 'workhub_timetable_preparation_execute', { p_input: command, p_request_key: key, p_recover_only: true }, (raw, member) => {
        const receipt = preparationReceipt(raw, command, key, source)
        if (receipt.basis && receipt.basis.schoolId !== member.schoolId) throw new ServiceError('INVALID_RESPONSE')
        return receipt
      })
    },
  }
}
