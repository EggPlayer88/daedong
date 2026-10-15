import { FILE_TECHNICAL_LIMITS, FileError, type CollectionFileRepository, type FileOwnerScope, type FilePolicy, type FileReadScope, type FileReference } from './contracts'
import { fileOperation, normalizeFilePolicy, readBlobBytes, validateFileMetadata, validateFileReferences, validateSignature } from './validation'
// 합성 미리보기 전용 규칙이다. 일반 수합의 운영 정책으로 사용하지 않는다.
export const previewFixturePolicy: FilePolicy = { extensions: ['pdf', 'hwp', 'hwpx', 'docx', 'xlsx', 'pptx'], maxFileBytes: 10 * 1024 * 1024, maxFiles: 3 }
type Stored = { ref: FileReference; owner: FileOwnerScope; blob: Blob }
const scopeId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id)
export function createPreviewFileRepository(options: { maxTotalBytes?: number; timeoutMs?: number } = {}): CollectionFileRepository {
  const maximum = options.maxTotalBytes ?? FILE_TECHNICAL_LIMITS.memoryBytes, timeout = options.timeoutMs ?? FILE_TECHNICAL_LIMITS.timeoutMs
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > FILE_TECHNICAL_LIMITS.memoryBytes || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > FILE_TECHNICAL_LIMITS.timeoutMs) throw new FileError('FILE_POLICY_INVALID')
  const files = new Map<string, Stored>(), retained = new Set<string>()
  let total = 0, reserved = 0, generation = 0
  function exactFile(ref: FileReference): Stored {
    if (!ref || typeof ref.id !== 'string') throw new FileError('FILE_UNAVAILABLE')
    const saved = files.get(ref.id)
    if (!saved || Object.keys(ref).length !== 5 || (['id', 'name', 'extension', 'bytes', 'sha256'] as const).some(key => ref[key] !== saved.ref[key]) || saved.blob.size !== saved.ref.bytes) throw new FileError('FILE_UNAVAILABLE')
    return saved
  }
  function lookup(ref: FileReference, scope: FileReadScope): Stored {
    const saved = exactFile(ref)
    if (!scopeId(scope?.schoolId) || !Array.isArray(scope?.memberIds) || !scope.memberIds.every(scopeId) || scope.schoolId !== saved.owner.schoolId || !scope.memberIds.includes(saved.owner.memberId)) throw new FileError('FILE_SCOPE_DENIED')
    return saved
  }
  return {
    async stage(file, policy, owner, signal) {
      const checked = normalizeFilePolicy(policy), extension = validateFileMetadata(file, checked)
      if (!scopeId(owner?.schoolId) || !scopeId(owner?.memberId)) throw new FileError('FILE_SCOPE_DENIED')
      const identity = { schoolId: owner.schoolId, memberId: owner.memberId }, name = file.name, size = file.size, epoch = generation
      if (size + total + reserved > maximum) throw new FileError('FILE_MEMORY_LIMIT')
      if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID || globalThis.isSecureContext === false) throw new FileError('FILE_CRYPTO_UNAVAILABLE')
      reserved += size
      let transferred = false
      try { return await fileOperation(signal, timeout, async operation => {
        const bytes = await readBlobBytes(file, checked.maxFileBytes, operation)
        validateSignature(bytes, extension)
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
        operation.guard()
        if (generation !== epoch) throw new FileError('FILE_UNAVAILABLE')
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        if (total + reserved > maximum) throw new FileError('FILE_MEMORY_LIMIT')
        const ref = { id: globalThis.crypto.randomUUID(), name, extension, bytes: size, sha256 }
        files.set(ref.id, { ref: { ...ref }, owner: identity, blob: new Blob([bytes], { type: file.type }) }); reserved -= size; total += size; transferred = true
        return ref
      }) } finally { if (!transferred) reserved -= size }
    },
    check(refs, policy, scope) { for (const ref of validateFileReferences(refs, policy)) lookup(ref, scope) },
    async read(ref, scope, signal) {
      const stored = lookup(ref, scope), epoch = generation
      return fileOperation(signal, timeout, async operation => {
        operation.guard()
        // 원본 Blob은 외부에 노출하지 않고 불변 복사본을 반환한다.
        const blob = stored.blob.slice(0, stored.blob.size, stored.blob.type)
        operation.guard()
        if (epoch !== generation) throw new FileError('FILE_UNAVAILABLE')
        return blob
      })
    },
    retainSaved(refs) {
      if (!Array.isArray(refs)) throw new FileError('FILE_UNAVAILABLE')
      // 한 참조가 손상돼도 일부 파일만 보호되는 일이 없도록 먼저 전부 확인한다.
      const found = Array.from(refs, ref => exactFile(ref))
      for (const entry of found) retained.add(entry.ref.id)
    },
    discardStaged(refs, owner) {
      if (!scopeId(owner?.schoolId) || !scopeId(owner?.memberId)) throw new FileError('FILE_SCOPE_DENIED')
      if (!Array.isArray(refs)) throw new FileError('FILE_UNAVAILABLE')
      const found = new Map<string, Stored>()
      // 이미 회수되거나 초기화된 참조는 무시한다. 다른 선택·제출 참조를 추정 수집하지 않는다.
      for (const ref of refs) if (ref && files.has(ref.id)) found.set(ref.id, lookup(ref, { schoolId: owner.schoolId, memberIds: [owner.memberId] }))
      for (const [id, entry] of found) if (!retained.has(id)) { files.delete(id); total -= entry.ref.bytes }
    },
    reset() { generation++; files.clear(); retained.clear(); total = 0 },
  }
}
