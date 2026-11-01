import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { canonical, exact, identifier, object, ServiceError, text } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import limits from './operations-api-limits.json'

export const TIMETABLE_REQUEST_ABANDON_API = 'timetable-operations.abandon.v1' as const
export type RequestAbandonKind = 'operations' | 'publication' | 'school_day' | 'execution'
interface RequestAbandonBase { kind: RequestAbandonKind; requestKey: string; commandHash: string; decidedAt: string }
export type RequestAbandonResult<T> = RequestAbandonBase & ({ outcome: 'applied'; receipt: T } | { outcome: 'abandoned'; receipt: null })
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const digest = async (command: unknown): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(command)))), byte => byte.toString(16).padStart(2, '0')).join('')
function timestamp(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) fail()
  return raw as string
}

/** 닫힘 응답만 잠금 해제 근거다. CONFLICT나 접수증 부재를 닫힘으로 추정하지 않는다. */
export async function parseRequestAbandonResult<T>(raw: unknown, kind: RequestAbandonKind, requestKey: string, commandHash: string, parseReceipt: (value: unknown) => T | Promise<T>, now = Date.now()): Promise<RequestAbandonResult<T>> {
  try {
    exact(raw, ['kind', 'requestKey', 'commandHash', 'outcome', 'receipt', 'decidedAt'])
    if (raw.kind !== kind || raw.requestKey !== requestKey || raw.commandHash !== commandHash || !/^[a-f0-9]{64}$/.test(commandHash)) fail()
    const decidedAt = timestamp(raw.decidedAt)
    if (!Number.isFinite(now) || Date.parse(decidedAt) > now + limits.clockSkewMs) fail()
    const base = { kind, requestKey, commandHash, decidedAt }
    if (raw.outcome === 'abandoned') {
      if (raw.receipt !== null) fail()
      return { ...base, outcome: 'abandoned', receipt: null }
    }
    if (raw.outcome !== 'applied' || raw.receipt === null) fail()
    const receipt = await parseReceipt(raw.receipt)
    // 모든 기존 접수증은 직접 또는 실시 기록 안에 기록 시각을 가진다.
    const checked: unknown = receipt
    if (!object(checked)) return fail()
    const recordedAt = timestamp(Object.hasOwn(checked, 'recordedAt') ? checked.recordedAt : object(checked.record) ? checked.record.recordedAt : undefined)
    if (recordedAt > decidedAt) fail()
    return { ...base, outcome: 'applied', receipt }
  } catch { return fail() }
}

/** 실행과 닫기 응답의 경합에도 원문·접수증·종결 결과가 뒤집히지 않도록 같은 원키로 비교한다. */
export function createRequestAbandonClient(connection: SupabaseConnection, kind: RequestAbandonKind, options: { timeoutMs?: number; now?: () => number } = {}) {
  const rpc = createScopedRpc(connection, TIMETABLE_REQUEST_ABANDON_API, { timeoutMs: options.timeoutMs })
  const commands = new Map<string, string>(), receipts = new Map<string, string>(), abandoned = new Map<string, string>()
  const scope = (memberId: string) => {
    const member = connection.info().memberships.find(row => row.id === identifier(memberId))
    if (!member) throw new ServiceError('CANCELLED')
    return recoveryScope(member)
  }
  function remember(identity: string, command: unknown) {
    const content = canonical(command), previous = commands.get(identity)
    if (previous !== undefined && previous !== content) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    commands.set(identity, content)
  }
  function assertOpen(identity: string, command: unknown) {
    remember(identity, command)
    if (abandoned.has(identity)) throw new ServiceError('CONFLICT')
  }
  function acceptReceipt<T>(identity: string, receipt: T): T {
    const value = canonical(receipt), previous = receipts.get(identity)
    if (abandoned.has(identity) || previous !== undefined && previous !== value) fail()
    receipts.set(identity, value)
    return receipt
  }
  async function abandon<T>(memberId: string, commandValue: unknown, key: string, parseReceipt: (value: unknown) => T | Promise<T>): Promise<RequestAbandonResult<T>> {
    text(key, 200, true); if (!/^[A-Za-z0-9_-]{8,200}$/.test(key) || !object(commandValue)) throw new ServiceError('INVALID_INPUT')
    const token = scope(memberId), identity = token + ':' + key, command = structuredClone(commandValue)
    remember(identity, command)
    const commandHash = await digest(command)
    if (scope(memberId) !== token) throw new ServiceError('CANCELLED')
    // 닫기는 취소 기록을 쓸 수 있다. 통신 실패·시간초과는 결과 미상으로 남긴다.
    const result = await rpc.call(memberId, 'workhub_timetable_operations_abandon', { p_kind: kind, p_command: command, p_request_key: key }, raw =>
      parseRequestAbandonResult(raw, kind, key, commandHash, parseReceipt, options.now ? options.now() : Date.now()), true)
    if (scope(memberId) !== token) throw new ServiceError('CANCELLED')
    try {
      if (result.outcome === 'applied') acceptReceipt(identity, result.receipt)
      else {
        const value = canonical(result), previous = abandoned.get(identity)
        if (receipts.has(identity) || previous !== undefined && previous !== value) fail()
        abandoned.set(identity, value)
      }
    } catch { throw new ServiceError('RESULT_UNKNOWN') }
    // RPC가 시간초과로 끝난 뒤의 늦은 파서 완료는 위 상태표를 갱신하지 않는다.
    return result
  }
  return { assertOpen, acceptReceipt, abandon }
}
