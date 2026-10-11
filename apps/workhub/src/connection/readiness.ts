import { activeAt } from '../domain'
import type { LegacyServices } from './contracts'
import { contextResponse, profileResponse } from './validation'

export type ReadinessStage = 'logged_out' | 'profile_missing' | 'pending' | 'forbidden' | 'invalid_configuration' | 'foundation_missing' | 'no_membership' | 'ready' | 'unavailable'

const stagesByCode = {
  SESSION_ABSENT: 'logged_out',
  PROFILE_ABSENT: 'profile_missing',
  APPROVAL_PENDING: 'pending',
  SUPERADMIN_REQUIRED: 'forbidden',
  INVALID_CONFIGURATION: 'invalid_configuration',
  INVALID_OPTIONS: 'invalid_configuration',
  CONTEXT_FUNCTION_MISSING: 'foundation_missing',
  NO_ACTIVE_MEMBERSHIP: 'no_membership',
  CONTEXT_READY: 'ready',
  SESSION_READ_FAILED: 'unavailable',
  SESSION_INVALID: 'unavailable',
  PROFILE_READ_FAILED: 'unavailable',
  PROFILE_INVALID: 'unavailable',
  CONTEXT_READ_FAILED: 'unavailable',
  CONTEXT_INVALID: 'unavailable',
  SESSION_RECHECK_FAILED: 'unavailable',
  SESSION_CHANGED: 'unavailable',
  TIMEOUT: 'unavailable',
  CANCELLED: 'unavailable',
  NETWORK_OFFLINE: 'unavailable',
  UNAVAILABLE: 'unavailable',
  SERVER_FORBIDDEN: 'forbidden',
  INVALID_REPORT: 'unavailable',
} as const satisfies Record<string, ReadinessStage>

export type ReadinessCode = keyof typeof stagesByCode
export interface ReadinessReport {
  stage: ReadinessStage
  code: ReadinessCode
  checkedAt: string
  readySchoolCount: number
}
export interface ReadinessOptions { timeoutMs?: number; signal?: AbortSignal }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const report = (code: ReadinessCode, readySchoolCount = 0): ReadinessReport => ({ stage: stagesByCode[code], code, checkedAt: new Date().toISOString(), readySchoolCount })
class CheckStopped extends Error {
  constructor(readonly code: 'TIMEOUT' | 'CANCELLED') { super(code) }
}

function sessionUser(value: unknown): string | null {
  if (value === null) return null
  if (!record(value) || !record(value.user) || typeof value.user.id !== 'string' || !value.user.id.trim() || value.user.id.length > 256) throw new Error('SESSION_INVALID')
  return value.user.id
}

// 전체 진단에 하나의 제한 시간을 적용한다. 취소 후 늦게 온 응답은 후속 조회로 이어지지 않는다.
// 공용 서비스에 취소 API가 없으므로 이미 전송한 읽기 요청 자체의 중단을 보장하지 않는다.
function boundedReader(deadline: number, signal?: AbortSignal) {
  return <T,>(read: () => PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new CheckStopped('CANCELLED')); return }
    const remaining = deadline - Date.now()
    if (remaining <= 0) { reject(new CheckStopped('TIMEOUT')); return }
    let settled = false
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    const abort = () => finish({ error: new CheckStopped('CANCELLED') })
    const timer = setTimeout(() => finish({ error: new CheckStopped('TIMEOUT') }), remaining)
    signal?.addEventListener('abort', abort, { once: true })
    try { Promise.resolve(read()).then(value => finish({ value }), error => finish({ error })) }
    catch (error) { finish({ error }) }
  })
}

/** 기존 세션·본인 프로필·학교 컨텍스트만 읽는다. 회원 생성·로그인·로그아웃·쓰기·세션 구독은 호출하지 않는다. */
export async function runReadinessCheck(services: LegacyServices | null | undefined, options: ReadinessOptions = {}): Promise<ReadinessReport> {
  let failureCode: ReadinessCode = 'INVALID_CONFIGURATION'
  try {
    if (!services || !['getSession', 'fetchMyProfile', 'rpc'].every(key => typeof (services as unknown as Record<string, unknown>)[key] === 'function')) return report('INVALID_CONFIGURATION')
    if (!options || typeof options !== 'object' || Array.isArray(options)) return report('INVALID_OPTIONS')
    const timeoutMs = options.timeoutMs === undefined ? 10_000 : options.timeoutMs
    const signal = options.signal
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) return report('INVALID_OPTIONS')
    const read = boundedReader(Date.now() + timeoutMs, signal)

    failureCode = 'SESSION_READ_FAILED'
    const initial = await read(() => services.getSession())
    failureCode = 'SESSION_INVALID'
    const userId = sessionUser(initial)
    if (userId === null) return report('SESSION_ABSENT')

    failureCode = 'PROFILE_READ_FAILED'
    const rawProfile = await read(() => services.fetchMyProfile(userId))
    failureCode = 'SESSION_RECHECK_FAILED'
    const afterProfile = await read(() => services.getSession())
    failureCode = 'SESSION_INVALID'
    if (sessionUser(afterProfile) !== userId) return report('SESSION_CHANGED')
    failureCode = 'PROFILE_INVALID'
    const profile = profileResponse(rawProfile, userId)
    if (!profile) return report('PROFILE_ABSENT')
    if (!profile.is_active) return report('APPROVAL_PENDING')
    if (profile.role !== 'superadmin') return report('SUPERADMIN_REQUIRED')

    failureCode = 'CONTEXT_READ_FAILED'
    const response = await read(() => services.rpc('workhub_context'))
    failureCode = 'SESSION_RECHECK_FAILED'
    const afterContext = await read(() => services.getSession())
    failureCode = 'SESSION_INVALID'
    if (sessionUser(afterContext) !== userId) return report('SESSION_CHANGED')
    failureCode = 'CONTEXT_INVALID'
    if (!record(response) || !Object.hasOwn(response, 'data') || !Object.hasOwn(response, 'error')) return report('CONTEXT_INVALID')
    if (response.error !== null) {
      if (!record(response.error)) return report('CONTEXT_INVALID')
      // PGRST202는 함수 부재 또는 스키마 캐시의 함수 서명 불일치다. 네트워크 오류를 미설치로 추정하지 않는다.
      // 근거: https://docs.postgrest.org/en/stable/references/errors.html
      if (response.error.code === 'PGRST202') return report('CONTEXT_FUNCTION_MISSING')
      if (response.error.message === 'FORBIDDEN' || response.error.code === '42501') return report('SERVER_FORBIDDEN')
      if (response.error.message === 'INACTIVE_MEMBERSHIP') return report('NO_ACTIVE_MEMBERSHIP')
      return report('CONTEXT_READ_FAILED')
    }
    const context = contextResponse(response.data)
    const readySchools = new Set(context.memberships.filter(member => member.userId === userId && activeAt(member, context.basisDate)).map(member => member.schoolId))
    return readySchools.size ? report('CONTEXT_READY', readySchools.size) : report('NO_ACTIVE_MEMBERSHIP')
  } catch (error) {
    // 예외 원문·프로필·컨텍스트를 결과나 로그에 복사하지 않는다.
    return report(error instanceof CheckStopped ? error.code : failureCode)
  }
}

/** 지원용 JSON은 허용된 네 필드만 새 객체에 담는다. 호출자가 붙인 원문·개인정보도 제외한다. */
export function exportReport(value: ReadinessReport): string {
  let safe = report('INVALID_REPORT')
  try {
    if (record(value) && typeof value.code === 'string' && Object.hasOwn(stagesByCode, value.code) && value.stage === stagesByCode[value.code as ReadinessCode] && typeof value.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt) && new Date(value.checkedAt).toISOString() === value.checkedAt && Number.isSafeInteger(value.readySchoolCount) && (value.stage === 'ready' ? value.readySchoolCount > 0 : value.readySchoolCount === 0)) {
      safe = { stage: value.stage as ReadinessStage, code: value.code as ReadinessCode, checkedAt: value.checkedAt, readySchoolCount: value.readySchoolCount }
    }
  } catch { /* 손상된 결과의 임의 문자열을 내보내지 않는다. */ }
  return JSON.stringify(safe, null, 2)
}
