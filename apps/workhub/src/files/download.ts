import { FILE_TECHNICAL_LIMITS, FileError } from './contracts'
import { fileOperation, readBlobBytes } from './validation'

export function safeDownloadName(name: string): string {
  if (typeof name !== 'string') throw new FileError('FILE_NAME_INVALID')
  let clean = name.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/gu, '_').replace(/^[. ]+|[. ]+$/g, '') || 'document'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = '_' + clean
  const extension = /\.[a-z0-9]{1,12}$/i.exec(clean)?.[0] ?? ''
  let stem = extension ? clean.slice(0, -extension.length) : clean
  while (new TextEncoder().encode(stem + extension).length > FILE_TECHNICAL_LIMITS.nameBytes - 5) stem = Array.from(stem).slice(0, -1).join('')
  return stem + extension
}
export function storedZipEntryName(name: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= FILE_TECHNICAL_LIMITS.zipEntries) throw new FileError('FILE_ZIP_LIMIT')
  return String(index + 1).padStart(3, '0') + '_' + safeDownloadName(name)
}
export function requestBlobDownload(blob: Blob, name: string): void {
  let url: string | undefined, anchor: HTMLAnchorElement | undefined
  try {
    if (!(blob instanceof Blob)) throw new FileError('FILE_DOWNLOAD_FAILED')
    const filename = safeDownloadName(name)
    url = URL.createObjectURL(blob); anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
    document.body.append(anchor); anchor.click(); anchor.remove()
    const released = url
    setTimeout(() => { try { URL.revokeObjectURL(released) } catch { /* 정리 실패 원문을 노출하지 않는다. */ } }, 1000)
  } catch {
    try { anchor?.remove(); if (url) URL.revokeObjectURL(url) } catch { /* 다운로드 실패는 고정 안내로 돌린다. */ }
    throw new FileError('FILE_DOWNLOAD_FAILED')
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1
  return crc >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8
  return (crc ^ 0xffffffff) >>> 0
}
function header(size: number) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) } }
// PKWARE APPNOTE 6.3.10 §4.3.7/4.3.12/4.3.16, STORE·UTF-8·CRC32만 사용한다.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
export function buildStoredZip(entries: readonly { name: string; bytes: Uint8Array }[]): Blob {
  if (!Array.isArray(entries) || !entries.length || entries.length > FILE_TECHNICAL_LIMITS.zipEntries) throw new FileError('FILE_ZIP_LIMIT')
  let total = 0
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !(entry.bytes instanceof Uint8Array)) throw new FileError('FILE_ZIP_LIMIT')
    total += entry.bytes.byteLength
    if (total > FILE_TECHNICAL_LIMITS.memoryBytes) throw new FileError('FILE_ZIP_LIMIT')
  }
  const local: BlobPart[] = [], central: BlobPart[] = []
  let offset = 0, centralSize = 0
  entries.forEach((entry, index) => {
    // 순번을 붙여 OS의 대소문자 처리와 원본 이름 중복에도 덮어쓰지 않는다.
    const name = new TextEncoder().encode(storedZipEntryName(entry.name, index))
    const payload = new Uint8Array(entry.bytes), crc = crc32(payload), size = payload.length
    const lh = header(30), ch = header(46)
    lh.view.setUint32(0, 0x04034b50, true); lh.view.setUint16(4, 20, true); lh.view.setUint16(6, 0x0800, true)
    lh.view.setUint16(12, 0x21, true); lh.view.setUint32(14, crc, true); lh.view.setUint32(18, size, true); lh.view.setUint32(22, size, true); lh.view.setUint16(26, name.length, true)
    ch.view.setUint32(0, 0x02014b50, true); ch.view.setUint16(4, 20, true); ch.view.setUint16(6, 20, true); ch.view.setUint16(8, 0x0800, true)
    ch.view.setUint16(14, 0x21, true); ch.view.setUint32(16, crc, true); ch.view.setUint32(20, size, true); ch.view.setUint32(24, size, true); ch.view.setUint16(28, name.length, true); ch.view.setUint32(42, offset, true)
    local.push(lh.bytes, name, payload); central.push(ch.bytes, name)
    offset += lh.bytes.length + name.length + size; centralSize += ch.bytes.length + name.length
  })
  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, entries.length, true); end.view.setUint16(10, entries.length, true)
  end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true)
  return new Blob([...local, ...central, end.bytes], { type: 'application/zip' })
}
export async function createStoredZip(entries: readonly { name: string; blob: Blob }[], signal?: AbortSignal): Promise<Blob> {
  if (!Array.isArray(entries) || !entries.length || entries.length > FILE_TECHNICAL_LIMITS.zipEntries) throw new FileError('FILE_ZIP_LIMIT')
  const snapshot = entries.map(entry => {
    if (!entry || typeof entry.name !== 'string' || !(entry.blob instanceof Blob)) throw new FileError('FILE_ZIP_LIMIT')
    return { name: entry.name, blob: entry.blob }
  })
  if (snapshot.reduce((sum, entry) => sum + entry.blob.size, 0) > FILE_TECHNICAL_LIMITS.memoryBytes) throw new FileError('FILE_ZIP_LIMIT')
  return fileOperation(signal, FILE_TECHNICAL_LIMITS.timeoutMs, async operation => {
    const contents = []
    for (const entry of snapshot) contents.push({ name: entry.name, bytes: await readBlobBytes(entry.blob, FILE_TECHNICAL_LIMITS.memoryBytes, operation) })
    operation.guard()
    return buildStoredZip(contents)
  })
}
