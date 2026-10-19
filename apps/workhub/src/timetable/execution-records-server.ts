import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { canonical, createScopedRpc, identifier, object, ServiceError } from '../services/scoped-rpc'
import { EXECUTION_RECORDS_CONTRACT, executionRecordCommand, executionRecordCommandHash, parseExecutionRecordReceipt, parseExecutionRecordsView, parseExecutionHistoryPage, type ExecutionRecordCommand, type ExecutionRecordsView, type ExecutionRecord, type TimetableExecutionRecordsServer } from './execution-records'
import policy from './execution-records-policy.json'

export function createTimetableExecutionRecordsServer(connection: SupabaseConnection, options: { timeoutMs?: number; now?: () => number } = {}): TimetableExecutionRecordsServer {
  const now = () => { const value = options.now ? options.now() : Date.now(); if (!Number.isFinite(value)) throw new ServiceError('INVALID_INPUT'); return value }
  now()
  const scopedConnection: SupabaseConnection = { ...connection, async rpcVerified(name, args) {
    try { return await connection.rpcVerified(name, args) }
    catch (error) {
      if (object(error) && error.code === 'PGRST202') {
        const member = connection.info().memberships.find(row => row.id === args?.p_member_id)
        return { contract: EXECUTION_RECORDS_CONTRACT, schoolId: member?.schoolId, memberId: args?.p_member_id, error: { code: 'NOT_READY' } }
      }
      throw error
    }
  } }
  const rpc = createScopedRpc(scopedConnection, EXECUTION_RECORDS_CONTRACT, options)
  const sources = new Map<string, { token: string; view: ExecutionRecordsView }>(), generations = new Map<string, number>()
  const cursors = new Map<string, { token: string; lessonId: string; anchor: number; last: ExecutionRecord; asOf: string; generation: number }>()
  const originals = new Map<string, ExecutionRecordCommand>(), missing = new Set<string>(), receipts = new Map<string, string>()
  const scope = (memberId: string) => { const member = connection.info().memberships.find(row => row.id === memberId); if (!member) throw new ServiceError('CANCELLED'); return recoveryScope(member) }
  const sourceKey = (memberId: string, lessonId: string) => memberId + ':' + lessonId
  function request(memberId: string, raw: ExecutionRecordCommand, key: string) {
    identifier(key); if (key.length < policy.minRequestKeyLength) throw new ServiceError('INVALID_INPUT')
    const command = executionRecordCommand(raw), token = scope(memberId), id = token + ':' + key, previous = originals.get(id)
    if (previous && canonical(previous) !== canonical(command)) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    return { command, token, id }
  }
  async function send(memberId: string, command: ExecutionRecordCommand, key: string, recover: boolean, token: string) {
    const hash = await executionRecordCommandHash(command)
    if (scope(memberId) !== token) throw new ServiceError('CANCELLED')
    return rpc.call(memberId, 'workhub_timetable_execution_record', { p_command: command, p_request_key: key, p_recover_only: recover }, raw => {
      const receipt = parseExecutionRecordReceipt(raw, command, key, hash, memberId, now()), id = token + ':' + key, value = canonical(receipt), original = receipts.get(id)
      // 첫 기록의 ID와 기록시각도 한번 확인한 접수증 뒤에는 달라질 수 없다.
      if (original !== undefined && original !== value) throw new ServiceError('INVALID_RESPONSE')
      receipts.set(id, value); return receipt
    }, !recover)
  }
  return {
    async get(memberId, lessonId) {
      identifier(lessonId); const token = scope(memberId), id = sourceKey(memberId, lessonId), generation = (generations.get(id) ?? 0) + 1
      generations.set(id, generation); sources.delete(id)
      const view = await rpc.call(memberId, 'workhub_timetable_execution_get', { p_lesson_id: lessonId }, raw => parseExecutionRecordsView(raw, lessonId, now()))
      if (token !== scope(memberId) || generations.get(id) !== generation) throw new ServiceError('CANCELLED')
      sources.set(id, { token, view: structuredClone(view) })
      if (view.nextCursor) cursors.set(token + ':' + view.nextCursor, { token, lessonId, anchor: view.current!.version, last: structuredClone(view.history.at(-1)!), asOf: view.asOf, generation })
      return view
    },
    async history(memberId, lessonId, anchor, cursor) {
      identifier(lessonId); const token = scope(memberId), cached = cursors.get(token + ':' + cursor), id = sourceKey(memberId, lessonId)
      if (!cached || cached.lessonId !== lessonId || cached.anchor !== anchor || cached.generation !== generations.get(id)) throw new ServiceError('CONFLICT')
      const page = await rpc.call(memberId, 'workhub_timetable_execution_history', { p_lesson_id: lessonId, p_anchor_version: anchor, p_cursor: cursor, p_page_size: policy.pageSize }, raw => parseExecutionHistoryPage(raw, lessonId, anchor, cached.last.version - 1, cached.last.id, cached.last, cached.asOf))
      if (token !== scope(memberId) || cached.generation !== generations.get(id)) throw new ServiceError('CANCELLED')
      if (page.nextCursor === cursor) throw new ServiceError('INVALID_RESPONSE')
      if (page.nextCursor) cursors.set(token + ':' + page.nextCursor, { ...cached, last: structuredClone(page.history.at(-1)!) })
      return page
    },
    execute(memberId, raw, key) {
      const { command, token, id } = request(memberId, raw, key), source = sources.get(sourceKey(memberId, command.lessonId))
      if (!source) throw new ServiceError('NOT_READY')
      if (source.token !== token) throw new ServiceError('CANCELLED')
      executionRecordCommand(command, source.view); originals.set(id, structuredClone(command)); missing.delete(id)
      return send(memberId, command, key, false, token)
    },
    recover(memberId, raw, key) {
      const { command, token, id } = request(memberId, raw, key); originals.set(id, structuredClone(command)); missing.delete(id)
      return send(memberId, command, key, true, token).catch(error => { if (error instanceof ServiceError && error.code === 'NOT_FOUND') missing.add(id); throw error })
    },
    resend(memberId, raw, key) {
      const { command, token, id } = request(memberId, raw, key)
      if (!originals.has(id) || !missing.has(id)) throw new ServiceError('NOT_READY')
      missing.delete(id); return send(memberId, command, key, false, token)
    },
  }
}
