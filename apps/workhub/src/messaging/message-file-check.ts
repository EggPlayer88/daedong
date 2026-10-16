import type { LegacySession } from '../connection/contracts'
import { MessagingError } from './contracts'
import { identifier } from './validation'
import { HWPX_BASIC_TIMEOUT_MS } from '../files/hwpx-basic-policy'

/** 서버 wrapper는 별도 연결 단계다. 수합용 경로나 수합 fileId로 우회하지 않는다. */
export function createMessageFileCheck(options: { getSession(): Promise<LegacySession | null>; fetch?: typeof fetch; timeoutMs?: number }) {
  const timeoutMs = options.timeoutMs ?? HWPX_BASIC_TIMEOUT_MS, send = options.fetch ?? globalThis.fetch
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new MessagingError('INVALID_INPUT')
  return { async check(input: { memberId: string; fileId: string; requestKey: string }, expectedUserId: string): Promise<unknown> {
    const body = JSON.stringify({ memberId: identifier(input.memberId), fileId: identifier(input.fileId), requestKey: identifier(input.requestKey) }), controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, stopped = false
    function guard() { if (stopped) throw new MessagingError('RESULT_UNKNOWN') }
    async function session() {
      const value = await options.getSession(); guard()
      if (!value?.access_token || value.user.id !== expectedUserId) throw new MessagingError('CANCELLED')
      return value
    }
    async function run() {
      try {
        const identity = await session()
        const response = await send('/api/messages/check-hwpx', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${identity.access_token}`, 'Content-Type': 'application/json' }, body })
        await session(); guard()
        if (response.status === 401 || response.status === 403) throw new MessagingError('FORBIDDEN')
        if (!response.body) throw new MessagingError('RESULT_UNKNOWN')
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []; let size = 0
        while (true) {
          const next = await reader.read(); guard()
          if (next.done) break
          size += next.value.byteLength
          if (size > 16384) throw new MessagingError('RESULT_UNKNOWN')
          chunks.push(next.value)
        }
        const bytes = new Uint8Array(size); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        await session(); guard()
        if (!response.ok) {
          const value = result as { error?: { code?: unknown } } | null
          const code = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value.error && typeof value.error === 'object' && !Array.isArray(value.error) && Object.keys(value.error).length === 1 ? value.error.code : null
          if (typeof code === 'string' && ['NOT_READY', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'].includes(code)) throw new MessagingError(code as MessagingError['code'])
          throw new MessagingError('RESULT_UNKNOWN')
        }
        return result
      } catch (error) {
        guard()
        if (error instanceof MessagingError && error.code === 'CANCELLED') throw error
        await session()
        throw error instanceof MessagingError ? error : new MessagingError('RESULT_UNKNOWN')
      }
    }
    try { return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; controller.abort(); if (reader) void reader.cancel().catch(() => {}); reject(new MessagingError('RESULT_UNKNOWN')) }, timeoutMs) })]) }
    finally { clearTimeout(timer); controller.abort(); if (reader) void reader.cancel().catch(() => {}) }
  } }
}
