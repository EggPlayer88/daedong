import { FILE_TECHNICAL_LIMITS, FileError, type FilePolicy, type FileReference } from './contracts'
const kinds: Record<string, readonly string[]> = {
  pdf: ['application/pdf'], hwp: ['application/x-hwp', 'application/x-hwp-v5', 'application/haansofthwp', 'application/vnd.hancom.hwp'],
  hwpx: ['application/hwp+zip', 'application/haansofthwpx', 'application/vnd.hancom.hwpx', 'application/zip'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export function normalizeFilePolicy(raw: unknown): FilePolicy {
  if (!object(raw) || !exact(raw, ['extensions', 'maxFileBytes', 'maxFiles']) || !Array.isArray(raw.extensions) || !raw.extensions.length || raw.extensions.some(value => typeof value !== 'string' || !Object.hasOwn(kinds, value)) || new Set(raw.extensions).size !== raw.extensions.length || !Number.isSafeInteger(raw.maxFileBytes) || Number(raw.maxFileBytes) < 1 || Number(raw.maxFileBytes) > FILE_TECHNICAL_LIMITS.memoryBytes || !Number.isSafeInteger(raw.maxFiles) || Number(raw.maxFiles) < 1 || Number(raw.maxFiles) > FILE_TECHNICAL_LIMITS.zipEntries) throw new FileError('FILE_POLICY_INVALID')
  return { extensions: [...raw.extensions], maxFileBytes: Number(raw.maxFileBytes), maxFiles: Number(raw.maxFiles) }
}
export function fileExtension(name: unknown): string {
  if (typeof name !== 'string' || !name || name !== name.trim() || name.endsWith('.') || /[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/u.test(name) || new TextEncoder().encode(name).length > FILE_TECHNICAL_LIMITS.nameBytes || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new FileError('FILE_NAME_INVALID')
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (!extension || name.slice(0, -(extension.length + 1)).replaceAll('.', '').trim() === '') throw new FileError('FILE_NAME_INVALID')
  return extension
}
export function validateFileReferences(raw: unknown, policy: FilePolicy): FileReference[] {
  const checked = normalizeFilePolicy(policy)
  if (!Array.isArray(raw)) throw new FileError('FILE_UNAVAILABLE')
  if (raw.length > checked.maxFiles) throw new FileError('FILE_COUNT_LIMIT')
  const ids = new Set(), names = new Set(), hashes = new Set()
  return raw.map(value => {
    if (!object(value) || !exact(value, ['id', 'name', 'extension', 'bytes', 'sha256']) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || typeof value.name !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new FileError('FILE_UNAVAILABLE')
    const extension = fileExtension(value.name)
    if (extension !== value.extension || !checked.extensions.includes(extension)) throw new FileError('FILE_TYPE_UNSUPPORTED')
    if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > checked.maxFileBytes) throw new FileError('FILE_SIZE_LIMIT')
    const nameKey = value.name.normalize('NFC').toLowerCase()
    if (ids.has(value.id) || names.has(nameKey) || hashes.has(value.sha256)) throw new FileError('FILE_DUPLICATE')
    ids.add(value.id); names.add(nameKey); hashes.add(value.sha256)
    return { id: value.id, name: value.name, extension, bytes: Number(value.bytes), sha256: value.sha256 }
  })
}
export function validateFileMetadata(file: File, policy: FilePolicy): string {
  if (!(file instanceof Blob) || typeof file.name !== 'string' || typeof file.type !== 'string') throw new FileError('FILE_UNAVAILABLE')
  const checked = normalizeFilePolicy(policy), extension = fileExtension(file.name)
  if (!checked.extensions.includes(extension)) throw new FileError('FILE_TYPE_UNSUPPORTED')
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > checked.maxFileBytes) throw new FileError('FILE_SIZE_LIMIT')
  const mime = file.type.toLowerCase()
  if (mime && mime !== 'application/octet-stream' && !kinds[extension].includes(mime)) throw new FileError('FILE_MIME_MISMATCH')
  return extension
}
// 표식만 비교하며 문서 유효성·매크로·악성 코드 검사가 끝났다는 뜻이 아니다.
export function validateSignature(bytes: Uint8Array, extension: string): void {
  const expected = extension === 'pdf' ? [0x25, 0x50, 0x44, 0x46, 0x2d] : extension === 'hwp' ? [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] : [0x50, 0x4b, 0x03, 0x04]
  if (bytes.length < expected.length || expected.some((byte, index) => byte !== bytes[index])) throw new FileError('FILE_SIGNATURE_MISMATCH')
}
export interface FileOperation { guard(): void; onStop(callback: () => void): void }
export async function fileOperation<T>(signal: AbortSignal | undefined, timeoutMs: number, run: (operation: FileOperation) => Promise<T>): Promise<T> {
  if (signal?.aborted) throw new FileError('FILE_ABORTED')
  let stopped: 'FILE_ABORTED' | 'FILE_TIMEOUT' | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const callbacks: (() => void)[] = []
  let abort: (() => void) | undefined
  const guard = () => { if (stopped || signal?.aborted) throw new FileError(stopped ?? 'FILE_ABORTED') }
  try {
    return await Promise.race([Promise.resolve().then(() => { guard(); return run({ guard, onStop: callback => callbacks.push(callback) }) }), new Promise<never>((_, reject) => {
      abort = () => { stopped = 'FILE_ABORTED'; reject(new FileError(stopped)) }
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { stopped = 'FILE_TIMEOUT'; reject(new FileError(stopped)) }, timeoutMs)
    })])
  } catch (error) { throw error instanceof FileError ? error : new FileError('FILE_READ_FAILED') }
  finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); for (const callback of callbacks) { try { callback() } catch { /* 원시 오류는 내보내지 않는다. */ } } }
}
export async function readBlobBytes(blob: Blob, maximum: number, operation: FileOperation): Promise<Uint8Array<ArrayBuffer>> {
  operation.guard()
  if (!(blob instanceof Blob) || blob.size > maximum) throw new FileError('FILE_SIZE_LIMIT')
  const reader = blob.stream().getReader(), chunks: Uint8Array[] = []
  operation.onStop(() => { void reader.cancel().catch(() => {}) })
  let size = 0
  while (true) {
    const next = await reader.read(); operation.guard()
    if (next.done) break
    size += next.value.byteLength
    if (size > maximum || size > blob.size) throw new FileError('FILE_SIZE_LIMIT')
    chunks.push(next.value)
  }
  if (size !== blob.size) throw new FileError('FILE_READ_FAILED')
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
