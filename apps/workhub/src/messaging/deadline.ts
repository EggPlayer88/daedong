import { MessagingError } from './contracts'

/** 제한시간 뒤 풀린 사전 조회·모듈 로딩이 새 전송을 시작하지 않게 한다. */
export async function messageOperation<T>(timeoutMs: number, writing: boolean, execute: (guard: () => void) => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false
  const deadline = Date.now() + timeoutMs
  const expired = () => new MessagingError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')
  const guard = () => { if (stopped || Date.now() >= deadline) throw expired() }
  try {
    return await Promise.race([
      Promise.resolve().then(() => { guard(); return execute(guard) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; reject(expired()) }, timeoutMs) }),
    ])
  } finally { stopped = true; clearTimeout(timer) }
}
