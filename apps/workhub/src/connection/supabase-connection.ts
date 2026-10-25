import { ContractError, type CalendarEvent, type FailureCode } from '../contracts'
import type { ConnectionContext, LegacyIdentity, LegacyServices, RpcError } from './contracts'
import { contextResponse, profileResponse } from './validation'
import { runReadinessCheck, type ReadinessReport } from './readiness'

const emptyContext = (): ConnectionContext => ({ schools: [], memberships: [], basisDate: '', relationLabels: {departmentIds:[],gradeIds:[],subjectIds:[]}, schoolLabels: {} })
const messages: Partial<Record<FailureCode, string>> = {
  FORBIDDEN: '현재 계정에 업무 공간을 이용할 권한이 없습니다.',
  INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다.',
  NOT_FOUND: '일정이 없거나 현재 소속으로 열람할 수 없습니다.',
  INVALID_INPUT: '입력 형식을 확인해 주세요.',
  CONFLICT: '다른 사람이 먼저 수정했습니다. 내 입력은 보존했습니다.',
  IDEMPOTENCY_CONFLICT: '같은 요청 번호에 다른 입력이 포함되었습니다.',
}
export function rpcFailure(error: RpcError): ContractError {
  const code = error.message as FailureCode
  if (!Object.hasOwn(messages,code)) {
    const failure = new ContractError('QUERY_FAILED', '연결 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    // 기존 오류 코드·인증 판정은 유지한다. 미설치 증분을 식별할 안전한 코드만 어댑터에 전달한다.
    if (error.code === 'PGRST202') Object.assign(failure, { rpcCode: 'PGRST202' })
    return failure
  }
  let current: CalendarEvent | undefined
  if (code === 'CONFLICT' && error.details) {
    try { current = JSON.parse(error.details) as CalendarEvent } catch { /* 내부 오류 원문은 노출하지 않는다. */ }
  }
  return new ContractError(code, messages[code]!, current)
}

// 기본 연결은 기존 공용 인스턴스만 사용한다. 별도 회원 생성·프로필 변경은 없다.
export function createSupabaseConnection(provided?: LegacyServices, options: { messagingPilot?: boolean } = {}) {
  let context = emptyContext()
  let generation = 0
  let verifiedUserId: string | null = null
  let verifiedAccess: string | null = null
  let servicesPromise: Promise<LegacyServices> | undefined
  const services = () => servicesPromise ??= provided ? Promise.resolve(provided) : import('./legacy-client').then(module => module.legacyServices)
  const invalidationListeners = new Set<(reason: ContractError) => void>()
  const invalidate = (reason: ContractError, advance = true) => {
    if(advance) generation++
    context=emptyContext()
    for(const listener of invalidationListeners) listener(reason)
  }

  async function getIdentity(): Promise<LegacyIdentity | null> {
    const started=generation
    try {
      const api=await services()
      const session=await api.getSession()
      if(started!==generation) throw new ContractError('CANCELLED','계정이 바뀌어 이전 요청을 취소했습니다.')
      if(!session) {
        if(context.schools.length) invalidate(new ContractError('CANCELLED','로그인 연결이 종료되었습니다.'))
        verifiedUserId=null;verifiedAccess=null
        return null
      }
      const raw=await api.fetchMyProfile(session.user.id)
      const current=await api.getSession()
      if(started!==generation || current?.user.id!==session.user.id) throw new ContractError('CANCELLED','계정이 바뀌어 이전 요청을 취소했습니다.')
      const profile=profileResponse(raw,session.user.id)
      const access=JSON.stringify([session.user.id,profile?.is_active===true,profile?.role??null])
      if(verifiedAccess!==null && verifiedAccess!==access) invalidate(new ContractError('CANCELLED','가입 승인 또는 계정 권한이 변경되어 연결을 다시 확인합니다.'),false)
      verifiedUserId=session.user.id;verifiedAccess=access
      if(!profile?.is_active) context=emptyContext()
      return {userId:session.user.id,profile,approved:profile?.is_active===true}
    } catch(error) {
      const failure=error instanceof ContractError?error:new ContractError('QUERY_FAILED','가입 상태를 확인하지 못했습니다. 다시 연결해 주세요.')
      if(started===generation && failure.code!=='CANCELLED') invalidate(failure,false)
      throw failure
    }
  }
  async function rpcVerified(name: string, args?: Record<string, unknown>): Promise<unknown> {
    const started = generation
    const identity = await getIdentity()
    if (!identity?.approved) {
      const failure=new ContractError('FORBIDDEN','로그인과 기존 가입 승인 상태를 확인해 주세요.')
      invalidate(failure);throw failure
    }
    const api = await services()
    const { data, error } = await api.rpc(name, args)
    const current=await api.getSession()
    if (started !== generation || current?.user.id!==identity.userId) {
      const failure=new ContractError('CANCELLED','계정이 바뀌어 이전 요청 결과를 취소했습니다.')
      if(started===generation && verifiedUserId===identity.userId) invalidate(failure)
      throw failure
    }
    if (error) {
      const failure=rpcFailure(error)
      if(failure.code==='FORBIDDEN'||failure.code==='INACTIVE_MEMBERSHIP') invalidate(failure)
      throw failure
    }
    return data
  }
  return {
    getIdentity,
    async checkReadiness(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ReadinessReport> {
      // 설정이 없는 경우 공용 클라이언트를 만들지 않는다. 진단도 같은 인증 인스턴스만 읽는다.
      if (!provided && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY)) return runReadinessCheck(undefined, options)
      try { return await runReadinessCheck(await services(), options) }
      catch { return { stage: 'unavailable', code: 'UNAVAILABLE', checkedAt: new Date().toISOString(), readySchoolCount: 0 } }
    },
    async signIn() { await (await services()).signInWithGoogle() },
    async signOut() { invalidate(new ContractError('CANCELLED','로그인 연결이 종료되었습니다.')); await (await services()).signOut() },
    subscribeInvalidation(callback: (reason: ContractError) => void) {
      invalidationListeners.add(callback)
      return () => { invalidationListeners.delete(callback) }
    },
    subscribeIdentity(callback: (identity: LegacyIdentity | null, error?: unknown) => void) {
      let disposed = false
      let unsubscribe = () => {}
      void services().then(api => {
        if (disposed) return
        unsubscribe = api.onAuthStateChange(session => {
          // 동일 UID 토큰 갱신은 진행 중 응답만 취소한다. 승인 재검증 전에는 초안을 지우지 않는다.
          if((session?.user.id??null)!==verifiedUserId) invalidate(new ContractError('CANCELLED','로그인 상태가 바뀌어 연결을 다시 확인합니다.'))
          else generation++
          const changed = generation
          // 공용 인증 이벤트 처리가 반환된 다음 별도 작업에서 프로필을 읽는다.
          setTimeout(() => {
            if(disposed || changed!==generation) return
            void getIdentity().then(identity => { if (!disposed && changed === generation) callback(identity) },
              error => { if (!disposed && changed === generation) callback(null, error) })
          },0)
        })
      }).catch(error => {
        if(disposed) return
        invalidate(new ContractError('QUERY_FAILED','로그인 상태 변경을 확인할 수 없습니다.'))
        callback(null,error)
      })
      return () => { disposed = true; unsubscribe() }
    },
    async loadContext(schoolId?: string): Promise<ConnectionContext> {
      const started=generation
      try { context=contextResponse(await rpcVerified(options.messagingPilot ? 'workhub_messaging_pilot_context' : 'workhub_context'),schoolId);return structuredClone(context) }
      catch(error) { if(started===generation && !(error instanceof ContractError && error.code==='CANCELLED')) context=emptyContext();throw error }
    },
    info: (): ConnectionContext => structuredClone(context),
    rpcVerified,
  }
}
export type SupabaseConnection = ReturnType<typeof createSupabaseConnection>
