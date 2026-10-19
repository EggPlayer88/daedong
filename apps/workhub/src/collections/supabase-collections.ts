import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { FILE_TECHNICAL_LIMITS, FileError, type FilePolicy, type FileReference } from '../files/contracts'
import { fileOperation, readBlobBytes, validateFileMetadata, validateSignature } from '../files/validation'
import { HWPX_BASIC_TIMEOUT_MS, hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import type { BasicFileCheckPort } from './basic-file-check'
import { CollectionServerError, type CollectionFailureCode, type CollectionFileParent, type CollectionServer, type CollectionUpload } from './contracts'
import { collectionAccess, collectionCommand, collectionCursor, collectionDetail, collectionDraft, collectionEnvelope, collectionFiles, collectionFileStatus, collectionIdentifier, collectionInputCheck, collectionList, collectionParent, collectionReadiness, collectionReceipt, collectionRequestKey, collectionUpload, type CollectionScope } from './validation'

export interface CollectionStoragePort { upload(bucket: string, path: string, file: File): Promise<void>; download(bucket: string, path: string): Promise<Blob> }
export interface CollectionServerOptions { storage?: CollectionStoragePort; basicCheck?: BasicFileCheckPort; timeoutMs?: number; now?: () => number }
const messages: Record<CollectionFailureCode, string> = {
  NOT_READY: '문서 수합 서버와 파일 보관 설정이 아직 준비되지 않았습니다.', INVALID_INPUT: '입력 내용과 확인한 버전을 다시 확인해 주세요.',
  INVALID_RESPONSE: '서버 응답을 확인하지 못했습니다. 새로 조회해 주세요.', FORBIDDEN: '현재 계정으로 이 자료를 처리할 수 없습니다.',
  INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다.', NOT_FOUND: '자료가 없거나 열람할 수 없습니다.',
  CONFLICT: '다른 곳에서 먼저 변경했습니다. 최신 자료와 입력을 비교해 주세요.', IDEMPOTENCY_CONFLICT: '같은 요청 번호에 다른 내용이 포함되어 있습니다.',
  QUERY_FAILED: '서버 연결을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.', RESULT_UNKNOWN: '처리 결과를 확인하지 못했습니다. 같은 요청 번호로 다시 확인해 주세요.',
  CANCELLED: '계정이나 학교 연결이 변경되어 이전 요청을 취소했습니다.', FILE_NOT_READY: '파일의 기본 확인이 아직 끝나지 않았습니다.', FILE_FAILED: 'HWPX 파일을 확인하지 못했습니다. 원본을 다시 확인해 주세요.',
}
const fail = (code: CollectionFailureCode): CollectionServerError => new CollectionServerError(code, messages[code])
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

// 인증과 학교 소속은 기존 연결을 재사용한다. 성공은 서버 접수증·검증된 파일로만 판단한다.
export function createSupabaseCollectionServer(connection: SupabaseConnection, options: CollectionServerOptions = {}): CollectionServer {
  const timeoutMs = options.timeoutMs ?? FILE_TECHNICAL_LIMITS.timeoutMs, now = options.now ?? Date.now
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw fail('INVALID_INPUT')
  let storagePromise: Promise<CollectionStoragePort> | undefined
  const storage = () => storagePromise ??= options.storage ? Promise.resolve(options.storage) : import('./legacy-storage').then(value => value.legacyStorage)
  let checkerPromise: Promise<BasicFileCheckPort> | undefined
  const checker = () => checkerPromise ??= options.basicCheck ? Promise.resolve(options.basicCheck) : import('./legacy-basic-check').then(value => value.legacyBasicFileCheck)
  const intents = new Map<string, { scope: CollectionScope; parent: CollectionFileParent; intent: CollectionUpload; metadata: { name: string; extension: string; claimedBytes: number; claimedSha256: string } }>()
  const requestPayloads = new Map<string, string>()
  function scopeFor(memberId: string): CollectionScope {
    collectionInputCheck(() => collectionIdentifier(memberId))
    const context = connection.info(), member = context.memberships.find(member => member.id === memberId)
    if (!member || !context.schools.some(school => school.id === member.schoolId)) throw fail('INACTIVE_MEMBERSHIP')
    if (!activeAt(member, context.basisDate)) throw fail('INACTIVE_MEMBERSHIP')
    return { schoolId: member.schoolId, memberId, userId: member.userId }
  }
  function current(scope: CollectionScope): void {
    try { if (canonical(scopeFor(scope.memberId)) !== canonical(scope)) throw fail('CANCELLED') }
    catch { throw fail('CANCELLED') }
  }
  async function bounded<T>(run: () => PromiseLike<T>, code: CollectionFailureCode, budgetMs = timeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fail(code)), budgetMs) })]) }
    finally { clearTimeout(timer) }
  }
  async function identity(scope: CollectionScope, after = false): Promise<void> {
    current(scope)
    let identity: Awaited<ReturnType<SupabaseConnection['getIdentity']>>
    try { identity = await bounded(() => connection.getIdentity(), 'QUERY_FAILED') }
    catch (error) { current(scope); throw mapped(error, false) }
    current(scope)
    if (!identity || identity.userId !== scope.userId) throw fail('CANCELLED')
    if (!identity.approved) throw fail(after ? 'CANCELLED' : 'FORBIDDEN')
  }
  function mapped(error: unknown, writing: boolean): CollectionServerError {
    if (error instanceof CollectionServerError) {
      if (writing && ['INVALID_RESPONSE', 'QUERY_FAILED'].includes(error.code)) return fail('RESULT_UNKNOWN')
      return fail(error.code)
    }
    if (error instanceof ContractError && ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'INVALID_INPUT', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CANCELLED'].includes(error.code)) return fail(error.code as CollectionFailureCode)
    return fail(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')
  }
  async function rpc<T>(scope: CollectionScope, name: string, args: Record<string, unknown>, parse: (raw: unknown) => T, writing = false): Promise<T> {
    await identity(scope)
    let raw: unknown, rejection: unknown, rejected = false
    try { raw = await bounded(() => connection.rpcVerified(name, { p_member_id: scope.memberId, ...args }), writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED') }
    catch (error) { rejected = true; rejection = error }
    // 실패 응답도 이전 계정·학교의 정보를 새 화면에 전달하지 않는다.
    try { await identity(scope, true) } catch (error) { throw mapped(error, writing) }
    if (rejected) throw mapped(rejection, writing)
    try { return parse(collectionEnvelope(raw, scope)) } catch (error) { throw mapped(error, writing) }
  }
  function remember(scope: CollectionScope, name: string, key: string, args: unknown): void {
    const id = `${scope.userId}:${scope.schoolId}:${scope.memberId}:${name}:${key}`, payload = canonical(args), prior = requestPayloads.get(id)
    if (prior !== undefined && prior !== payload) throw fail('IDEMPOTENCY_CONFLICT')
    requestPayloads.set(id, payload)
  }
  async function metadata(file: File, policy: FilePolicy) {
    try {
      const extension = validateFileMetadata(file, hwpxCollectionPolicy(policy))
      return await fileOperation(undefined, timeoutMs, async operation => {
        const bytes = await readBlobBytes(file, policy.maxFileBytes, operation); validateSignature(bytes, extension)
        if (!globalThis.crypto?.subtle) throw new FileError('FILE_CRYPTO_UNAVAILABLE')
        const digest = await crypto.subtle.digest('SHA-256', bytes); operation.guard()
        return { name: file.name, extension, claimedBytes: bytes.byteLength, claimedSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
      })
    } catch { throw fail('FILE_FAILED') }
  }
  async function scopedMetadata(scope: CollectionScope, file: File, policy: FilePolicy) {
    let result: Awaited<ReturnType<typeof metadata>>
    try { result = await metadata(file, policy) }
    catch (error) { await identity(scope, true); throw error }
    await identity(scope, true)
    return result
  }
  function checkedStatus(scope: CollectionScope, fileId: string, raw: unknown) {
    const status = collectionFileStatus(raw, fileId), issued = intents.get(fileId)
    if (issued && canonical(issued.scope) !== canonical(scope)) throw fail('INVALID_RESPONSE')
    if (issued && status.file && (status.file.name !== issued.metadata.name || status.file.extension !== issued.metadata.extension || status.file.bytes !== issued.metadata.claimedBytes || status.file.sha256 !== issued.metadata.claimedSha256)) throw fail('INVALID_RESPONSE')
    return status
  }
  return {
    async readiness(memberId) {
      const scope = scopeFor(memberId)
      return rpc(scope, 'workhub_collection_basic_readiness', {}, raw => {
        const ready = collectionReadiness(raw)
        if (ready.available) {
          if (!ready.policy || ready.policy.extensions.length !== 1 || ready.policy.extensions[0] !== 'hwpx') throw fail('INVALID_RESPONSE')
          return { ...ready, policy: hwpxCollectionPolicy(ready.policy) }
        }
        return ready
      })
    },
    async list(memberId, cursor) {
      const scope = scopeFor(memberId), value = collectionInputCheck(() => cursor === undefined ? null : collectionCursor(cursor))
      return rpc(scope, 'workhub_collection_list', { p_cursor: value }, raw => collectionList(raw, scope))
    },
    async detail(memberId, requestId) {
      const scope = scopeFor(memberId), id = collectionInputCheck(() => collectionIdentifier(requestId))
      return rpc(scope, 'workhub_collection_get', { p_request_id: id }, raw => collectionDetail(raw, scope, id))
    },
    async draft(memberId, requestId, unitId) {
      const scope = scopeFor(memberId), [request, unit] = collectionInputCheck(() => [collectionIdentifier(requestId), collectionIdentifier(unitId)])
      return rpc(scope, 'workhub_collection_draft_get', { p_request_id: request, p_unit_id: unit }, raw => collectionDraft(raw, unit))
    },
    async mutate(memberId, command, requestKey) {
      const scope = scopeFor(memberId), [checked, key] = collectionInputCheck(() => [collectionCommand(command), collectionRequestKey(requestKey)] as const)
      remember(scope, 'mutate', key, checked)
      return rpc(scope, 'workhub_collection_mutate', { p_command: checked, p_request_key: key }, raw => {
        const receipt = collectionReceipt(raw, key, checked.kind === 'create' ? undefined : checked.requestId)
        if (checked.kind === 'create' && receipt.resourceId !== receipt.requestId) throw fail('INVALID_RESPONSE')
        if (['update', 'publish'].includes(checked.kind) && 'requestId' in checked && receipt.resourceId !== checked.requestId) throw fail('INVALID_RESPONSE')
        if (['review', 'withdraw', 'open_correction'].includes(checked.kind) && 'unitId' in checked && receipt.resourceId !== checked.unitId) throw fail('INVALID_RESPONSE')
        return receipt
      }, true)
    },
    async prepareUpload(memberId, parent, file, policy, requestKey) {
      const scope = scopeFor(memberId), [checkedParent, key] = collectionInputCheck(() => [collectionParent(parent), collectionRequestKey(requestKey)] as const)
      if (checkedParent.kind === 'submission') throw fail('INVALID_INPUT')
      await identity(scope)
      const claimed = await scopedMetadata(scope, file, policy)
      current(scope)
      const args = { p_parent: checkedParent, p_file: claimed, p_request_key: key }
      remember(scope, 'file_prepare', key, args)
      const intent = await rpc(scope, 'workhub_file_prepare', args, raw => collectionUpload(raw, scope), true)
      const prior = intents.get(intent.fileId)
      if (prior && (canonical(prior.parent) !== canonical(checkedParent) || canonical(prior.metadata) !== canonical(claimed) || canonical(prior.scope) !== canonical(scope) || prior.intent.bucket !== intent.bucket || prior.intent.path !== intent.path)) throw fail('RESULT_UNKNOWN')
      intents.set(intent.fileId, { scope, parent: checkedParent, intent: structuredClone(intent), metadata: claimed })
      return intent
    },
    async upload(memberId, intent, file) {
      const scope = scopeFor(memberId), issued = intents.get(intent?.fileId)
      if (!issued || canonical(issued.scope) !== canonical(scope) || canonical(issued.intent) !== canonical(intent) || !['awaiting_upload', 'pending_verification'].includes(intent.state) || Date.parse(intent.expiresAt) <= now()) throw fail('INVALID_INPUT')
      const location = { bucket: issued.intent.bucket, path: issued.intent.path }
      await identity(scope)
      const claimed = await scopedMetadata(scope, file, { extensions: [issued.metadata.extension], maxFileBytes: issued.metadata.claimedBytes, maxFiles: 1 })
      if (canonical(claimed) !== canonical(issued.metadata)) throw fail('INVALID_INPUT')
      await identity(scope)
      let rejection: unknown, rejected = false
      try { await bounded(async () => (await storage()).upload(location.bucket, location.path, file), 'RESULT_UNKNOWN') }
      catch (error) { rejected = true; rejection = error }
      try { await identity(scope, true) } catch (error) { throw mapped(error, true) }
      if (rejected) throw mapped(rejection, true)
      // Storage 응답은 파일 검증 완료가 아니다. complete/status로만 준비 상태를 확인한다.
    },
    async completeUpload(memberId, fileId, requestKey) {
      const scope = scopeFor(memberId), [id, key] = collectionInputCheck(() => [collectionIdentifier(fileId), collectionRequestKey(requestKey)])
      remember(scope, 'file_complete', key, { fileId: id })
      const status = await rpc(scope, 'workhub_file_complete', { p_file_id: id, p_request_key: key }, raw => checkedStatus(scope, id, raw), true)
      if (status.state !== 'pending_verification') return status
      // 브라우저의 해시/표식만으로 ready를 만들지 않는다. 같은 요청 번호로 서버의 실물 확인을 요청한다.
      await identity(scope)
      let response: unknown, rejected = false, rejection: unknown
      try { response = await bounded(async () => (await checker()).check({ memberId, fileId: id, requestKey: key }, scope.userId), 'RESULT_UNKNOWN', options.timeoutMs ?? HWPX_BASIC_TIMEOUT_MS) }
      catch (error) { rejected = true; rejection = error }
      try { await identity(scope, true) } catch (error) { throw mapped(error, true) }
      if (rejected) throw mapped(rejection, true)
      try { return checkedStatus(scope, id, collectionEnvelope(response, scope)) } catch (error) { throw mapped(error, true) }
    },
    async fileStatus(memberId, fileId) {
      const scope = scopeFor(memberId), id = collectionInputCheck(() => collectionIdentifier(fileId))
      return rpc(scope, 'workhub_file_status', { p_file_id: id }, raw => checkedStatus(scope, id, raw))
    },
    async download(memberId, parent, file) {
      const scope = scopeFor(memberId), [checkedParent, expected] = collectionInputCheck(() => [collectionParent(parent), collectionFiles([file])[0]] as const)
      const accessArgs = { p_parent: checkedParent, p_file_id: expected.id }
      const access = await rpc(scope, 'workhub_file_access', accessArgs, raw => collectionAccess(raw, scope, expected))
      let blob: Blob
      try { blob = await bounded(async () => (await storage()).download(access.bucket, access.path), 'FILE_FAILED') }
      catch (error) { try { await identity(scope, true) } catch (error) { throw mapped(error, false) }; throw mapped(error, false) }
      await identity(scope, true)
      try {
        await fileOperation(undefined, timeoutMs, async operation => {
          if (!(blob instanceof Blob) || blob.size !== expected.bytes) throw fail('FILE_FAILED')
          const bytes = await readBlobBytes(blob, expected.bytes, operation)
          const digest = await crypto.subtle.digest('SHA-256', bytes); operation.guard()
          const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
          if (hash !== expected.sha256) throw fail('FILE_FAILED')
        })
      } catch { await identity(scope, true); throw fail('FILE_FAILED') }
      // 전송 중 권한·제출판이 바뀌면 파일 본문을 화면에 넘기지 않는다.
      const currentAccess = await rpc(scope, 'workhub_file_access', accessArgs, raw => collectionAccess(raw, scope, expected))
      if (canonical(currentAccess) !== canonical(access)) throw fail('INVALID_RESPONSE')
      return blob
    },
  }
}
