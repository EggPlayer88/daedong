import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { FILE_TECHNICAL_LIMITS } from '../files/contracts'
import { ServiceError } from './scoped-rpc'

// 문서 생성과 학교 원문 가져오기가 같은 만료·학교 범위 검사를 사용한다.
export function createScopedFileOperation(connection: SupabaseConnection, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? FILE_TECHNICAL_LIMITS.timeoutMs
  const validate = (value: number) => { if (!Number.isFinite(value) || value < 1 || value > 120000) throw new ServiceError('INVALID_INPUT') }
  validate(timeoutMs)
  const scopeFor = (memberId: string) => {
    const member = connection.info().memberships.find(value => value.id === memberId)
    if (!member) throw new ServiceError('INACTIVE_MEMBERSHIP')
    return recoveryScope(member)
  }
  return async function bounded<T>(run: (guard: () => void) => Promise<T>, code: 'RESULT_UNKNOWN' | 'QUERY_FAILED', memberId: string, budgetMs = timeoutMs): Promise<T> {
    validate(budgetMs)
    const scope = scopeFor(memberId)
    let timer: ReturnType<typeof setTimeout> | undefined, expired = false
    const guard = () => {
      if (expired) throw new ServiceError(code)
      try { if (scopeFor(memberId) !== scope) throw new ServiceError('CANCELLED') }
      catch { throw new ServiceError('CANCELLED') }
    }
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(guard) }), new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new ServiceError(code)) }, budgetMs) })]) }
    catch (error) { throw error instanceof ServiceError ? error : new ServiceError(code) }
    finally { expired = true; clearTimeout(timer) }
  }
}
