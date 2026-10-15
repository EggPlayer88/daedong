import { CollectionServerError } from './contracts'
import type { LegacySession } from '../connection/contracts'
import { HWPX_BASIC_TIMEOUT_MS } from '../files/hwpx-basic-policy'
export interface BasicFileCheckInput { memberId: string; fileId: string; requestKey: string }
export interface BasicFileCheckPort { check(input: BasicFileCheckInput, expectedUserId: string): Promise<unknown> }
const RESPONSE_LIMIT = 16 * 1024
const unknown = () => new CollectionServerError('RESULT_UNKNOWN', '파일 확인 결과를 받지 못했습니다. 같은 파일로 다시 확인해 주세요.')
const cancelled = () => new CollectionServerError('CANCELLED', '로그인 계정이 바뀌어 이전 파일 확인을 취소했습니다.')
// 파일 본문·Storage 경로·서버 키를 받지 않는다. 원문은 서버가 DB에서 발급받은 경로로 읽는다.
export function createBasicFileCheck(options: { getSession(): Promise<LegacySession | null>; fetch?: typeof fetch; timeoutMs?: number }): BasicFileCheckPort {
  const send = options.fetch ?? globalThis.fetch, timeout = options.timeoutMs ?? HWPX_BASIC_TIMEOUT_MS
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000) throw new CollectionServerError('INVALID_INPUT', '파일 확인 설정을 확인해 주세요.')
  return { async check(input, expectedUserId) {
    // 첫 await 전 원문을 고정한다. 호출자가 입력을 바꾸어도 다른 파일·요청 번호를 보내지 않는다.
    const body = JSON.stringify({ memberId: input.memberId, fileId: input.fileId, requestKey: input.requestKey })
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timedOut = false, timer: ReturnType<typeof setTimeout> | undefined
    const guard = () => { if (timedOut) throw unknown() }
    const stopReading = () => { if (reader) void reader.cancel().catch(() => {}) }
    async function sameSession() {
      let session: LegacySession | null
      try { session = await options.getSession() } catch { throw unknown() }
      guard()
      if (!session || session.user.id !== expectedUserId || !session.access_token) throw cancelled()
      return session
    }
    async function execute() {
      try {
        const session = await sameSession()
        const response = await send('/api/collections/check-hwpx', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body })
        guard()
        // 실패 응답도 이전 계정에 속한 결과이므로 현재 로그인부터 확인한다.
        await sameSession()
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new CollectionServerError('FORBIDDEN', '현재 계정으로 파일을 확인할 수 없습니다.')
          // 배포/연결 미완료와 통신 장애는 확정 파일 거절로 바꾸지 않는다.
          throw unknown()
        }
        if (!response.body) throw unknown()
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const next = await reader.read()
          guard()
          if (next.done) break
          size += next.value.byteLength
          if (size > RESPONSE_LIMIT) throw unknown()
          chunks.push(next.value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        // 본문 전송 도중의 계정 변경도 막는다. 응답 헤더를 받은 시점만 확인해서는 부족하다.
        await sameSession()
        return data
      } catch (error) {
        guard()
        if (error instanceof CollectionServerError && error.code === 'CANCELLED') throw error
        await sameSession()
        throw error instanceof CollectionServerError ? error : unknown()
      }
    }
    try {
      return await Promise.race([execute(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); stopReading(); reject(unknown()) }, timeout)
      })])
    } finally { clearTimeout(timer); controller.abort(); stopReading() }
  } }
}
