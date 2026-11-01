import { createRequestAbandonClient } from './request-abandon'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { canonical, exact, identifier, ServiceError, text, version } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import type { OperationsExtensions, PublicationManifest } from './operations-next-contracts'
import { parsePublicationManifest, parsePublicationPage } from './operations-next-server'
import { parsePublishInput } from './operations-server'
import { TIMETABLE_PUBLICATION_API } from './publication-execution-contracts'
import type { PublicationCommitCommand, PublicationCommitReference, PublicationCommitReceipt, PublicationExecutionServer } from './publication-execution-contracts'
import limits from './operations-api-limits.json'

const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new ServiceError('CANCELLED') }
const digest = async (value: unknown): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('')
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail()
  return value as string
}

export async function parsePublicationCommitCommand(value: unknown, now = Date.now(), recovery = false): Promise<PublicationCommitCommand> {
  try {
    if (!Number.isFinite(now)) throw new ServiceError('INVALID_INPUT')
    exact(value, ['kind', 'manifest']); if (value.kind !== 'publish_manifest') fail()
    const raw = value.manifest; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail()
    const candidate = raw as PublicationManifest
    if (!recovery && Date.parse(timestamp(candidate.expiresAt)) <= now) throw new ServiceError('CONFLICT')
    // 원래 접수증 조회는 만료와 무관하다. 서명된 명세 자체의 수명·내용 검증은 그대로 유지한다.
    const basis = recovery ? Date.parse(timestamp(candidate.createdAt)) + 1 : now
    const manifest = await parsePublicationManifest(raw, parsePublishInput(candidate.input), basis)
    if (manifest.blockerCount || manifest.preserved.existingChanges !== 'retained' || !manifest.totalChanges) throw new ServiceError('INVALID_INPUT')
    return { kind: 'publish_manifest', manifest }
  } catch (error) {
    if (error instanceof ServiceError && ['INVALID_INPUT', 'CONFLICT'].includes(error.code)) throw error
    throw new ServiceError('INVALID_INPUT')
  }
}
export function publicationCommitReference(command: PublicationCommitCommand): PublicationCommitReference {
  const manifest = command.manifest
  return { kind: command.kind, previewId: manifest.previewId, previewHash: manifest.previewHash, manifestHash: manifest.manifestHash, basisFingerprint: manifest.basisFingerprint, input: structuredClone(manifest.input), expiresAt: manifest.expiresAt, totalChanges: manifest.totalChanges }
}
export const publicationCommandHash = (command: PublicationCommitCommand): Promise<string> => digest(publicationCommitReference(command))

/** 한 번에 한 페이지만 읽고 ID 집합만 보관한다. 대용량 전체 수업 객체는 메모리에 쌓지 않는다. */
export async function verifyPublicationChanges(extensions: Pick<OperationsExtensions, 'publicationPage'>, memberId: string, raw: PublicationManifest, options: { signal?: AbortSignal; onProgress?: (progress: { pages: number; totalPages: number; changes: number; totalChanges: number }) => void; now?: () => number } = {}): Promise<PublicationCommitCommand> {
  const now = options.now ?? Date.now
  cancelled(options.signal)
  const command = await parsePublicationCommitCommand({ kind: 'publish_manifest', manifest: structuredClone(raw) }, now())
  const manifest = command.manifest, ids = new Set<string>()
  const progress = (pages: number) => options.onProgress?.({ pages, totalPages: manifest.pageHashes.length, changes: ids.size, totalChanges: manifest.totalChanges })
  progress(0)
  for (let index = 0; index < manifest.pageHashes.length; index++) {
    cancelled(options.signal)
    if (Date.parse(manifest.expiresAt) <= now()) throw new ServiceError('CONFLICT')
    const rawPage = await extensions.publicationPage(memberId, manifest, index)
    cancelled(options.signal)
    if (Date.parse(manifest.expiresAt) <= now()) throw new ServiceError('CONFLICT')
    const page = await parsePublicationPage(rawPage, manifest, index)
    cancelled(options.signal)
    if (Date.parse(manifest.expiresAt) <= now()) throw new ServiceError('CONFLICT')
    for (const change of page.changes) { if (ids.has(change.after.id)) fail(); ids.add(change.after.id) }
    progress(index + 1)
  }
  if (ids.size !== manifest.totalChanges) fail()
  if (Date.parse(manifest.expiresAt) <= now()) throw new ServiceError('CONFLICT')
  cancelled(options.signal)
  return command
}

export function parsePublicationCommitReceipt(value: unknown, command: PublicationCommitCommand, key: string, commandHash: string, now = Date.now()): PublicationCommitReceipt {
  try {
    exact(value, ['requestKey', 'commandHash', 'kind', 'entityId', 'version', 'status', 'recordedAt', 'manifestHash', 'basisFingerprint', 'changedCount'])
    const manifest = command.manifest, recordedAt = timestamp(value.recordedAt)
    if (value.requestKey !== key || value.commandHash !== commandHash || value.kind !== command.kind || value.status !== 'published' || value.manifestHash !== manifest.manifestHash || value.basisFingerprint !== manifest.basisFingerprint || value.changedCount !== manifest.totalChanges || Date.parse(recordedAt) < Date.parse(manifest.createdAt) || Date.parse(recordedAt) >= Date.parse(manifest.expiresAt) || Date.parse(recordedAt) > now + limits.clockSkewMs) fail()
    return { requestKey: key, commandHash, kind: command.kind, entityId: identifier(value.entityId), version: version(value.version), status: 'published', recordedAt, manifestHash: manifest.manifestHash, basisFingerprint: manifest.basisFingerprint, changedCount: manifest.totalChanges }
  } catch { return fail() }
}

export function createPublicationExecutionServer(connection: SupabaseConnection, options: { timeoutMs?: number; now?: () => number } = {}): PublicationExecutionServer {
  const rpc = createScopedRpc(connection, TIMETABLE_PUBLICATION_API, { timeoutMs: options.timeoutMs })
  if (options.now !== undefined && typeof options.now !== 'function') throw new ServiceError('INVALID_INPUT')
  const now = () => { const value = options.now ? options.now() : Date.now(); if (!Number.isFinite(value)) throw new ServiceError('INVALID_INPUT'); return value }
  now()
  const closing = createRequestAbandonClient(connection, 'publication', { ...options, now })
  const originals = new Map<string, string>(), receipts = new Map<string, string>(), missingReceipts = new Set<string>()
  const scope = (memberId: string) => {
    identifier(memberId)
    const member = connection.info().memberships.find(row => row.id === memberId)
    if (!member) throw new ServiceError('CANCELLED')
    return recoveryScope(member)
  }
  async function send(memberId: string, value: PublicationCommitCommand, requestedKey: string, recovery: boolean, resend = false): Promise<PublicationCommitReceipt> {
    const originalScope = scope(memberId)
    const command = await parsePublicationCommitCommand(structuredClone(value), now(), recovery || resend)
    const key = text(requestedKey, 200, true); if (key.length < 8) throw new ServiceError('INVALID_INPUT')
    const cacheKey = originalScope + ':' + key, content = canonical(command), original = originals.get(cacheKey)
    closing.assertOpen(cacheKey, publicationCommitReference(command))
    if (original && original !== content) throw new ServiceError('IDEMPOTENCY_CONFLICT')
    if (resend && (!original || !missingReceipts.has(cacheKey))) throw new ServiceError('NOT_READY')
    const commandHash = await publicationCommandHash(command)
    if (scope(memberId) !== originalScope) throw new ServiceError('CANCELLED')
    originals.set(cacheKey, content); missingReceipts.delete(cacheKey)
    // 복구는 동일 RPC의 조회 전용 분기로 보낸다. 목록 재조회·새 확정으로 대체하지 않는다.
    const receipt = await rpc.call(memberId, 'workhub_timetable_publication_execute', { p_command: publicationCommitReference(command), p_request_key: key, p_recover_only: recovery }, raw => parsePublicationCommitReceipt(raw, command, key, commandHash, now()), !recovery).catch(error => {
      if (recovery && error instanceof ServiceError && error.code === 'NOT_FOUND') missingReceipts.add(cacheKey)
      throw error
    })
    const previous = receipts.get(cacheKey), received = canonical(receipt)
    if (previous && previous !== received) throw new ServiceError(recovery ? 'INVALID_RESPONSE' : 'RESULT_UNKNOWN')
    try { closing.acceptReceipt(cacheKey, receipt) } catch { throw new ServiceError(recovery ? 'INVALID_RESPONSE' : 'RESULT_UNKNOWN') }
    receipts.set(cacheKey, received)
    return receipt
  }
  return {
    execute: (memberId, command, key) => send(memberId, command, key, false),
    recover: (memberId, command, key) => send(memberId, command, key, true),
    resend: (memberId, command, key) => send(memberId, command, key, false, true),
    async abandon(memberId, value, requestedKey) {
      const originalScope = scope(memberId), command = await parsePublicationCommitCommand(structuredClone(value), now(), true)
      const key = text(requestedKey, 200, true); if (key.length < 8) throw new ServiceError('INVALID_INPUT')
      const cacheKey = originalScope + ':' + key, content = canonical(command), original = originals.get(cacheKey)
      if (original && original !== content) throw new ServiceError('IDEMPOTENCY_CONFLICT')
      const commandHash = await publicationCommandHash(command)
      if (scope(memberId) !== originalScope) throw new ServiceError('CANCELLED')
      originals.set(cacheKey, content)
      const result = await closing.abandon(memberId, publicationCommitReference(command), key, raw => parsePublicationCommitReceipt(raw, command, key, commandHash, now()))
      if (result.outcome === 'applied') receipts.set(cacheKey, canonical(result.receipt))
      missingReceipts.delete(cacheKey)
      return result
    },
  }
}
