import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import { recoveryScope } from '../services/recovery-scope'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { MessagingError, type MessageCommand, type MessagingFailureCode, type MessagingReadiness, type MessagingScope, type MessagingServer, type ThreadSummary } from './contracts'
import * as validate from './validation'
import { messageOperation } from './deadline'

/** 기존 로그인 연결을 그대로 사용한다. 권한을 부여하지 않고 응답 범위와 재시도 내용을 확인한다. */
export function createSupabaseMessagingServer(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): MessagingServer {
  const timeoutMs = options.timeoutMs ?? 30000
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new MessagingError('INVALID_INPUT')
  const payloads = new Map<string, string>(), knownThreads = new Map<string, ThreadSummary>(), readyStates = new Map<string, MessagingReadiness>()
  type LocalScope = MessagingScope & { accessStamp: string }
  function scopeFor(memberId: string): LocalScope {
    validate.identifier(memberId)
    const info = connection.info(), member = info.memberships.find(item => item.id === memberId)
    if (!member || !activeAt(member, info.basisDate) || !info.schools.some(item => item.id === member.schoolId)) throw new MessagingError('INACTIVE_MEMBERSHIP')
    return { memberId, schoolId: member.schoolId, userId: member.userId, accessStamp: recoveryScope(member) }
  }
  const scopeKey = (scope: LocalScope) => validate.canonical(scope)
  function current(scope: LocalScope): void {
    try { if (scopeKey(scopeFor(scope.memberId)) !== scopeKey(scope)) throw new Error('연결 변경') }
    catch { throw new MessagingError('CANCELLED') }
  }
  function mapped(error: unknown, writing: boolean): MessagingError {
    if (error instanceof MessagingError) return new MessagingError(writing && ['INVALID_RESPONSE', 'QUERY_FAILED'].includes(error.code) ? 'RESULT_UNKNOWN' : error.code)
    if (error instanceof ContractError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'INVALID_INPUT', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CANCELLED'].includes(error.code)) return new MessagingError(error.code as MessagingFailureCode)
    return new MessagingError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')
  }
  async function identity(scope: LocalScope, guard: () => void): Promise<void> {
    guard(); current(scope)
    const result = await connection.getIdentity()
    guard(); current(scope)
    if (!result || result.userId !== scope.userId) throw new MessagingError('CANCELLED')
    if (!result.approved) throw new MessagingError('FORBIDDEN')
  }
  async function rpc<T>(scope: LocalScope, name: string, args: Record<string, unknown>, parse: (value: unknown) => T, writing = false): Promise<T> {
    try {
      return await messageOperation(timeoutMs, writing, async guard => {
        await identity(scope, guard)
        guard()
        let raw: unknown, rejection: unknown, rejected = false
        try { raw = await connection.rpcVerified(name, { p_member_id: scope.memberId, ...args }) }
        catch (error) { rejected = true; rejection = error }
        guard()
        try { await identity(scope, guard) }
        catch (error) { guard(); if (writing) throw new MessagingError('CANCELLED'); throw error }
        guard()
        if (rejected) throw rejection
        return parse(validate.envelope(raw, scope))
      })
    } catch (error) {
      current(scope)
      throw mapped(error, writing)
    }
  }
  function input<T>(parse: () => T): T { try { return parse() } catch { throw new MessagingError('INVALID_INPUT') } }
  function known(scope: LocalScope, item: ThreadSummary): ThreadSummary { knownThreads.set(`${scopeKey(scope)}:${item.id}`, item); return item }
  return {
    async readiness(memberId) {
      const scope = scopeFor(memberId)
      readyStates.delete(scopeKey(scope))
      const result = await rpc(scope, 'workhub_messaging_readiness', {}, validate.readiness)
      readyStates.set(scopeKey(scope), result)
      return result
    },
    async recipients(memberId, query, cursor) {
      const scope = scopeFor(memberId), args = input(() => ({ p_query: validate.text(query, 200, true).trim(), p_cursor: validate.cursor(cursor ?? null) }))
      return rpc(scope, 'workhub_message_recipients', args, value => {
        const result = validate.page(value, item => validate.recipient(item, scope), item => item.memberId)
        if (result.items.some(item => item.memberId === scope.memberId) || (args.p_cursor !== null && args.p_cursor === result.nextCursor)) throw new MessagingError('INVALID_RESPONSE')
        return result
      })
    },
    async threads(memberId, query, unreadOnly, cursor) {
      const scope = scopeFor(memberId), args = input(() => ({ p_query: validate.text(query, 200, true).trim(), p_unread_only: unreadOnly, p_cursor: validate.cursor(cursor ?? null) }))
      if (typeof unreadOnly !== 'boolean') throw new MessagingError('INVALID_INPUT')
      return rpc(scope, 'workhub_message_threads', args, value => {
        const result = validate.page(value, item => known(scope, validate.thread(item, scope)), item => item.id)
        if ((unreadOnly && result.items.some(item => item.unreadCount === 0)) || (args.p_cursor !== null && args.p_cursor === result.nextCursor)) throw new MessagingError('INVALID_RESPONSE')
        return result
      })
    },
    async messages(memberId, threadId, beforeCursor) {
      const scope = scopeFor(memberId), args = input(() => ({ p_thread_id: validate.identifier(threadId), p_before_cursor: validate.cursor(beforeCursor ?? null) }))
      return rpc(scope, 'workhub_message_get', args, value => {
        const result = validate.messages(value, scope, threadId)
        if (args.p_before_cursor !== null && args.p_before_cursor === result.nextCursor) throw new MessagingError('INVALID_RESPONSE')
        known(scope, result.thread)
        return result
      })
    },
    async inbox(memberId, unreadOnly, cursor) {
      const scope = scopeFor(memberId), args = input(() => ({ p_unread_only: unreadOnly, p_cursor: validate.cursor(cursor ?? null) }))
      if (typeof unreadOnly !== 'boolean') throw new MessagingError('INVALID_INPUT')
      return rpc(scope, 'workhub_inbox_list', args, value => {
        const result = validate.page(value, item => validate.notice(item, scope), item => item.id)
        if ((unreadOnly && result.items.some(item => item.readAt !== null)) || (args.p_cursor !== null && args.p_cursor === result.nextCursor)) throw new MessagingError('INVALID_RESPONSE')
        return result
      })
    },
    async mutate(memberId, command, requestKey, mutationOptions = {}) {
      const scope = scopeFor(memberId), [sent, key] = input(() => [validate.command(command, memberId), validate.identifier(requestKey)] as const)
      const ready = readyStates.get(scopeKey(scope))
      const replayOnly = mutationOptions.recovering === true && (mutationOptions.replayOnly === true || !ready?.available || !ready.limits)
      if ((!ready?.available || !ready.limits) && !replayOnly) throw new MessagingError('NOT_READY')
      const knownKey = `${scopeKey(scope)}:${'threadId' in sent ? sent.threadId : ''}`, context = knownThreads.get(knownKey)
      if (!replayOnly && sent.kind === 'read_thread' && !context) throw new MessagingError('INVALID_INPUT')
      if (!replayOnly && sent.kind === 'read_thread' && sent.throughSequence > context!.latestSequence) throw new MessagingError('INVALID_INPUT')
      if (!replayOnly && 'body' in sent && sent.body.length > ready!.limits!.bodyCharacters) throw new MessagingError('INVALID_INPUT')
      if (!replayOnly && 'attachmentIds' in sent && sent.attachmentIds.length && ready!.attachments !== 'hwpx_basic_v1') throw new MessagingError('NOT_READY')
      if (!replayOnly && sent.kind === 'start' && (sent.title.length > ready!.limits!.titleCharacters || sent.recipients.length > ready!.limits!.recipients)) throw new MessagingError('INVALID_INPUT')
      const requestScope = `${scopeKey(scope)}:${key}`, serialized = validate.canonical(sent), previous = payloads.get(requestScope)
      if (previous !== undefined && previous !== serialized) throw new MessagingError('IDEMPOTENCY_CONFLICT')
      payloads.set(requestScope, serialized)
      return rpc(scope, 'workhub_message_mutate', { p_command: sent, p_request_key: key, p_replay_only: replayOnly }, value => validate.receipt(value, sent, key, memberId), true)
    },
  }
}
