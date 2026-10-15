import { ContractError } from '../contracts'
import { recoveryScope } from '../app/pending-requests'
import { activeAt } from '../domain'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { SCHOOL_ADMIN_LIMITS, SchoolAdminError, schoolAdminId, schoolAdminInput, schoolAdminYear, schoolAdminCommand, schoolAdminEnvelope, schoolAdminReadiness, schoolAdminSnapshot, schoolAdminReceipt, type SchoolAdminScope, type SchoolAdminServer, type SchoolAdminFailureCode } from './school-admin-contract'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
// 기존 승인 확인 연결만 재사용한다. 관리 권한·대상 학교·현재 버전은 SQL에서 다시 확인해야 한다.
export function createSupabaseSchoolAdminServer(connection: SupabaseConnection, options: {timeoutMs?: number} = {}): SchoolAdminServer {
  const timeoutMs = options.timeoutMs ?? SCHOOL_ADMIN_LIMITS.requestTimeoutMs
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw new SchoolAdminError('INVALID_INPUT')
  const attempts = new Map<string,string>()
  function scopeFor(memberId: string): SchoolAdminScope & { membershipScope: string } {
    schoolAdminInput(() => schoolAdminId(memberId))
    const context = connection.info(), member = context.memberships.find(item=>item.id===memberId)
    if (!member || !context.schools.some(school=>school.id===member.schoolId) || !activeAt(member,context.basisDate)) throw new SchoolAdminError('INACTIVE_MEMBERSHIP')
    return {memberId,schoolId:member.schoolId,userId:member.userId,membershipScope:recoveryScope(member)}
  }
  function current(scope: SchoolAdminScope) { try { if (canonical(scopeFor(scope.memberId)) !== canonical(scope)) throw 0 } catch { throw new SchoolAdminError('CANCELLED') } }
  async function bounded<T>(run: () => PromiseLike<T>, writing = false): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([Promise.resolve().then(run),new Promise<never>((_,reject)=>{ timer=setTimeout(()=>reject(new SchoolAdminError(writing?'RESULT_UNKNOWN':'QUERY_FAILED')),timeoutMs) })]) }
    finally { clearTimeout(timer) }
  }
  function mapped(error: unknown, writing: boolean): SchoolAdminError {
    if (error instanceof SchoolAdminError) return new SchoolAdminError(writing && ['INVALID_RESPONSE','QUERY_FAILED'].includes(error.code) ? 'RESULT_UNKNOWN' : error.code)
    if (error instanceof ContractError && ['FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','INVALID_INPUT','CONFLICT','IDEMPOTENCY_CONFLICT','CANCELLED'].includes(error.code)) return new SchoolAdminError(error.code as SchoolAdminFailureCode)
    return new SchoolAdminError(writing?'RESULT_UNKNOWN':'QUERY_FAILED')
  }
  async function identity(scope: SchoolAdminScope) {
    current(scope)
    const user = await bounded(()=>connection.getIdentity())
    current(scope)
    if (!user || user.userId!==scope.userId) throw new SchoolAdminError('CANCELLED')
    if (!user.approved) throw new SchoolAdminError('FORBIDDEN')
  }
  async function rpc<T>(scope: SchoolAdminScope, name: string, args: Record<string,unknown>, parse: (raw: unknown)=>T, writing = false): Promise<T> {
    try { await identity(scope) } catch(error) { throw mapped(error,false) }
    let raw: unknown, failure: unknown, rejected=false
    try { raw=await bounded(()=>connection.rpcVerified(name,{p_member_id:scope.memberId,...args}),writing) } catch(error) { rejected=true;failure=error }
    try { await identity(scope) } catch(error) {
      const failure=mapped(error,writing)
      if(writing && ['FORBIDDEN','INACTIVE_MEMBERSHIP'].includes(failure.code)) throw new SchoolAdminError('CANCELLED')
      throw failure
    }
    if(rejected) throw mapped(failure,writing)
    try { return parse(schoolAdminEnvelope(raw,scope)) } catch(error) { throw mapped(error,writing) }
  }
  return {
    readiness(memberId) { return rpc(scopeFor(memberId),'workhub_school_admin_readiness',{},schoolAdminReadiness) },
    get(memberId,schoolYear) {
      const year=schoolAdminInput(()=>schoolYear===undefined?undefined:schoolAdminYear(schoolYear))
      return rpc(scopeFor(memberId),'workhub_school_admin_get',{p_school_year:year??null},raw=>schoolAdminSnapshot(raw,year))
    },
    mutate(memberId,command,requestKey) {
      const scope=scopeFor(memberId),checked=schoolAdminInput(()=>schoolAdminCommand(command)),key=schoolAdminInput(()=>schoolAdminId(requestKey))
      const id=canonical([scope,key]),payload=canonical(checked),previous=attempts.get(id)
      if(previous!==undefined && previous!==payload) throw new SchoolAdminError('IDEMPOTENCY_CONFLICT')
      attempts.set(id,payload)
      return rpc(scope,'workhub_school_admin_mutate',{p_command:checked,p_request_key:key},raw=>schoolAdminReceipt(raw,checked,key),true)
    },
  }
}
