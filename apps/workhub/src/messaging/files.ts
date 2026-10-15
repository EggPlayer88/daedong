import type { SupabaseConnection } from '../connection/supabase-connection'
import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import { recoveryScope } from '../app/pending-requests'
import type { FilePolicy } from '../files/contracts'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { fileOperation, normalizeFilePolicy, readBlobBytes, validateFileMetadata, validateSignature } from '../files/validation'
import { MessagingError, type MessageAttachment, type MessagingScope } from './contracts'
import { canonical, envelope, exact, identifier, integer, text } from './validation'
import { messageOperation } from './deadline'

export interface MessageFileReadiness { available: boolean; reason: 'ready' | 'database_missing' | 'storage_missing' | 'verification_missing' | 'disabled'; policy: FilePolicy | null }
export interface MessageFileIntent { fileId: string; bucket: 'workhub-message-files'; path: string; expiresAt: string; state: 'awaiting_upload' | 'pending_basic' | 'ready' }
export interface MessageFileStatus { fileId: string; state: 'awaiting_upload' | 'pending_basic' | 'ready' | 'rejected'; storageObjectId: string | null; file: MessageAttachment | null }
export interface MessageFileServer {
  readiness(memberId: string): Promise<MessageFileReadiness>
  prepare(memberId: string, file: File, policy: FilePolicy, requestKey: string, options?: { replayOnly?: boolean }): Promise<MessageFileIntent>
  upload(memberId: string, intent: MessageFileIntent, file: File): Promise<void>
  complete(memberId: string, fileId: string, requestKey: string): Promise<MessageFileStatus>
  status(memberId: string, fileId: string): Promise<MessageFileStatus>
  download(memberId: string, threadId: string, messageId: string, file: MessageAttachment): Promise<Blob>
}
export interface MessageFilePort {
  upload(bucket: string, path: string, file: File): Promise<void>
  download(bucket: string, path: string): Promise<Blob>
  check(input: { memberId: string; fileId: string; requestKey: string }, expectedUserId: string): Promise<unknown>
}
const invalid = (): never => { throw new MessagingError('INVALID_RESPONSE') }
export function messageFileReadiness(value: unknown): MessageFileReadiness {
  const v = exact(value, ['available', 'reason', 'policy'])
  if (!['ready', 'database_missing', 'storage_missing', 'verification_missing', 'disabled'].includes(String(v.reason)) || v.available !== (v.reason === 'ready')) return invalid()
  let policy: FilePolicy | null = null
  if (v.policy !== null) {
    policy = normalizeFilePolicy(v.policy)
    if (policy.extensions.length !== 1 || policy.extensions[0] !== 'hwpx' || canonical(policy) !== canonical(hwpxCollectionPolicy(policy))) return invalid()
  }
  if (v.available && !policy) return invalid()
  return { available: v.available as boolean, reason: v.reason as MessageFileReadiness['reason'], policy }
}
function location(value: unknown, scope: MessagingScope, fileId: string): { bucket: 'workhub-message-files'; path: string } {
  const v = exact(value, ['bucket', 'path'])
  // 문서 수합과 메시지 첨부는 다른 권한 원장이다. 서버가 발급한 전용 경로만 받는다.
  if (v.bucket !== 'workhub-message-files' || v.path !== `${scope.schoolId}/${scope.memberId}/${fileId}/original.hwpx`) return invalid()
  return { bucket: v.bucket, path: v.path as string }
}
function intent(value: unknown, scope: MessagingScope): MessageFileIntent {
  const v = exact(value, ['fileId', 'bucket', 'path', 'expiresAt', 'state']), fileId = identifier(v.fileId)
  if (!['awaiting_upload', 'pending_basic', 'ready'].includes(String(v.state)) || typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt))) return invalid()
  return { fileId, ...location({ bucket: v.bucket, path: v.path }, scope, fileId), expiresAt: v.expiresAt, state: v.state as MessageFileIntent['state'] }
}
export function messageAttachment(value: unknown): MessageAttachment {
  const v = exact(value, ['id', 'name', 'bytes', 'sha256', 'profile'])
  if (v.profile !== 'hwpx_basic_v1' || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)) return invalid()
  const policy = hwpxCollectionPolicy({ extensions: ['hwpx'], maxFileBytes: 30 * 1024 * 1024, maxFiles: 1 })
  const name = text(v.name, 240), bytes = integer(v.bytes, 1, policy.maxFileBytes)
  if (!/\.hwpx$/i.test(name) || /[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/u.test(name)) return invalid()
  return { id: identifier(v.id), name, bytes, sha256: v.sha256, profile: 'hwpx_basic_v1' }
}
export function messageFileStatus(value: unknown, fileId: string): MessageFileStatus {
  const v = exact(value, ['fileId', 'state', 'storageObjectId', 'file'])
  if (v.fileId !== fileId || !['awaiting_upload', 'pending_basic', 'ready', 'rejected'].includes(String(v.state))) return invalid()
  const file = v.file === null ? null : messageAttachment(v.file), storageObjectId = v.storageObjectId === null ? null : identifier(v.storageObjectId)
  if ((v.state === 'ready' && (!file || !storageObjectId)) || (v.state !== 'ready' && file !== null) || (file && file.id !== fileId)) return invalid()
  return { fileId, state: v.state as MessageFileStatus['state'], storageObjectId, file }
}
export function createMessageFileServer(connection: SupabaseConnection, options: { port?: MessageFilePort; timeoutMs?: number } = {}): MessageFileServer {
  const timeoutMs = options.timeoutMs ?? 55000
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new MessagingError('INVALID_INPUT')
  type Scope = MessagingScope & { accessStamp: string }
  const issued = new Map<string, { scope: Scope; intent: MessageFileIntent; metadata: { name: string; claimedBytes: number; claimedSha256: string } }>(), payloads = new Map<string, string>()
  let portPromise: Promise<MessageFilePort> | undefined
  const port = () => portPromise ??= options.port ? Promise.resolve(options.port) : import('./legacy-message-files').then(module => module.legacyMessageFiles)
  function scopeFor(memberId: string): Scope {
    identifier(memberId)
    const info = connection.info(), member = info.memberships.find(item => item.id === memberId)
    if (!member || !activeAt(member, info.basisDate) || !info.schools.some(item => item.id === member.schoolId)) throw new MessagingError('INACTIVE_MEMBERSHIP')
    return { schoolId: member.schoolId, memberId, userId: member.userId, accessStamp: recoveryScope(member) }
  }
  function current(scope: Scope) { try { if (canonical(scopeFor(scope.memberId)) !== canonical(scope)) throw new Error() } catch { throw new MessagingError('CANCELLED') } }
  async function identity(scope: Scope, guard: () => void) {
    guard(); current(scope)
    const user = await connection.getIdentity()
    guard(); current(scope)
    if (!user || user.userId !== scope.userId) throw new MessagingError('CANCELLED')
    if (!user.approved) throw new MessagingError('FORBIDDEN')
  }
  function mapped(failure: unknown, writing: boolean): MessagingError {
    if (failure instanceof MessagingError) return new MessagingError(writing && ['QUERY_FAILED', 'INVALID_RESPONSE'].includes(failure.code) ? 'RESULT_UNKNOWN' : failure.code)
    if (failure instanceof ContractError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CANCELLED', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_INPUT'].includes(failure.code)) return new MessagingError(failure.code as MessagingError['code'])
    return new MessagingError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')
  }
  async function run<T>(scope: Scope, execute: (guard: () => void) => Promise<T>, writing: boolean): Promise<T> {
    try {
      return await messageOperation(timeoutMs, writing, async guard => {
        await identity(scope, guard)
        guard()
        let result: T | undefined, failure: unknown, rejected = false
        try { result = await execute(guard) } catch (error) { rejected = true; failure = error }
        guard()
        try { await identity(scope, guard) }
        catch (error) { guard(); if (writing) throw new MessagingError('CANCELLED'); throw error }
        guard()
        if (rejected) throw failure
        return result as T
      })
    } catch (error) { current(scope); throw mapped(error, writing) }
  }
  async function rpc<T>(scope: Scope, name: string, args: Record<string, unknown>, parse: (value: unknown) => T, writing = false) {
    return run(scope, async guard => {
      guard()
      const raw = await connection.rpcVerified(name, { p_member_id: scope.memberId, ...args })
      guard()
      return parse(envelope(raw, scope))
    }, writing)
  }
  function remember(scope: Scope, action: string, key: string, payload: unknown) {
    identifier(key)
    const entry = `${canonical(scope)}:${action}:${key}`, prior = payloads.get(entry), serialized = canonical(payload)
    if (prior !== undefined && prior !== serialized) throw new MessagingError('IDEMPOTENCY_CONFLICT')
    payloads.set(entry, serialized)
  }
  async function metadata(file: File, policy: FilePolicy) {
    try {
      validateFileMetadata(file, hwpxCollectionPolicy(policy))
      return await fileOperation(undefined, timeoutMs, async operation => {
        const bytes = await readBlobBytes(file, policy.maxFileBytes, operation); validateSignature(bytes, 'hwpx')
        const hash = await crypto.subtle.digest('SHA-256', bytes); operation.guard()
        return { name: file.name, claimedBytes: bytes.byteLength, claimedSha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') }
      })
    } catch { throw new MessagingError('INVALID_INPUT') }
  }
  function status(value: unknown, scope: Scope, fileId: string) {
    const result = messageFileStatus(value, fileId), prior = issued.get(fileId)
    if (prior && canonical(prior.scope) !== canonical(scope)) return invalid()
    if (result.file && prior && (result.file.name !== prior.metadata.name || result.file.bytes !== prior.metadata.claimedBytes || result.file.sha256 !== prior.metadata.claimedSha256)) return invalid()
    return result
  }
  return {
    readiness(memberId) { const scope = scopeFor(memberId); return rpc(scope, 'workhub_message_file_readiness', {}, messageFileReadiness) },
    async prepare(memberId, file, policy, requestKey, prepareOptions = {}) {
      const scope = scopeFor(memberId), claimed = await run(scope, () => metadata(file, policy), false)
      const args = { p_file: claimed, p_request_key: requestKey, p_replay_only: prepareOptions.replayOnly === true }
      remember(scope, 'prepare', requestKey, { p_file: claimed, p_request_key: requestKey })
      const result = await rpc(scope, 'workhub_message_file_prepare', args, value => intent(value, scope), true), previous = issued.get(result.fileId)
      if (previous && (canonical(previous.scope) !== canonical(scope) || canonical(previous.metadata) !== canonical(claimed) || previous.intent.bucket !== result.bucket || previous.intent.path !== result.path)) throw new MessagingError('RESULT_UNKNOWN')
      issued.set(result.fileId, { scope, intent: structuredClone(result), metadata: claimed }); return result
    },
    async upload(memberId, reservation, file) {
      const scope = scopeFor(memberId), saved = issued.get(reservation.fileId)
      if (!saved || canonical(saved.scope) !== canonical(scope) || canonical(saved.intent) !== canonical(reservation) || reservation.state !== 'awaiting_upload' || Date.parse(reservation.expiresAt) <= Date.now()) throw new MessagingError('INVALID_INPUT')
      const claimed = await run(scope, () => metadata(file, { extensions: ['hwpx'], maxFileBytes: saved.metadata.claimedBytes, maxFiles: 1 }), false)
      if (canonical(claimed) !== canonical(saved.metadata)) throw new MessagingError('INVALID_INPUT')
      await run(scope, async guard => {
        const files = await port(); guard(); current(scope)
        await files.upload(reservation.bucket, reservation.path, file); guard()
      }, true)
    },
    async complete(memberId, fileId, requestKey) {
      const scope = scopeFor(memberId); identifier(fileId); remember(scope, 'complete', requestKey, { fileId })
      const initial = await rpc(scope, 'workhub_message_file_complete', { p_file_id: fileId, p_request_key: requestKey }, value => status(value, scope, fileId), true)
      if (initial.state !== 'pending_basic') return initial
      return run(scope, async guard => {
        const files = await port(); guard(); current(scope)
        const raw = await files.check({ memberId, fileId, requestKey }, scope.userId); guard()
        return status(envelope(raw, scope), scope, fileId)
      }, true)
    },
    status(memberId, fileId) { const scope = scopeFor(memberId); identifier(fileId); return rpc(scope, 'workhub_message_file_status', { p_file_id: fileId }, value => status(value, scope, fileId)) },
    async download(memberId, threadId, messageId, file) {
      const scope = scopeFor(memberId), expected = messageAttachment(file), args = { p_thread_id: identifier(threadId), p_message_id: identifier(messageId), p_file_id: expected.id }
      function access(value: unknown) {
        const v = exact(value, ['threadId', 'messageId', 'file', 'bucket', 'path', 'ownerMemberId', 'storageObjectId'])
        if (v.threadId !== threadId || v.messageId !== messageId || canonical(messageAttachment(v.file)) !== canonical(expected)) return invalid()
        const ownerMemberId = identifier(v.ownerMemberId), storageObjectId = identifier(v.storageObjectId)
        return { ...location({ bucket: v.bucket, path: v.path }, { ...scope, memberId: ownerMemberId }, expected.id), storageObjectId }
      }
      const locationBefore = await rpc(scope, 'workhub_message_file_access', args, access)
      const blob = await run(scope, async guard => {
        const files = await port(); guard(); current(scope)
        const result = await files.download(locationBefore.bucket, locationBefore.path); guard()
        return result
      }, false)
      await run(scope, () => fileOperation(undefined, timeoutMs, async operation => {
        if (!(blob instanceof Blob) || blob.size !== expected.bytes) return invalid()
        const bytes = await readBlobBytes(blob, expected.bytes, operation), hash = await crypto.subtle.digest('SHA-256', bytes); operation.guard()
        if ([...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== expected.sha256) return invalid()
      }), false)
      const locationAfter = await rpc(scope, 'workhub_message_file_access', args, access)
      if (canonical(locationBefore) !== canonical(locationAfter)) return invalid()
      return blob
    },
  }
}
