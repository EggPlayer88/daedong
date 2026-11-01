import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { LegacyIdentity } from '../connection/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from './recovery-scope'

import { ServiceError, object, identifier, text, canonical, exact, serviceMessages as messages, type ServiceCode } from './service-values'
export * from './service-values'

// 인증은 기존 연결에 위임한다. 여기서는 학교 범위·응답 세대·저장 결과만 확인한다.
export function createScopedRpc(connection:SupabaseConnection, contract:string, options:{timeoutMs?:number}={}) {
  const timeoutMs=options.timeoutMs??25000
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ServiceError('INVALID_INPUT')
  const commands=new Map<string,string>()
  function scope(memberId:string) {
    identifier(memberId)
    const context=connection.info(), member=context.memberships.find(item=>item.id===memberId)
    if(!member||!context.schools.some(item=>item.id===member.schoolId)||!activeAt(member,context.basisDate))throw new ServiceError('INACTIVE_MEMBERSHIP')
    return { member, fingerprint:recoveryScope(member) }
  }
  async function call<T>(memberId:string,name:string,args:Record<string,unknown>,parse:(data:unknown,member:Membership)=>T,writing=false,operationGuard?:()=>void):Promise<T> {
    const original=scope(memberId)
    const payload=structuredClone(args)
    if(writing){const key=text(payload.p_request_key,200,true);if(key.length<8)throw new ServiceError('INVALID_INPUT');const id=original.fingerprint+':'+name+':'+key, content=canonical(payload);if(commands.has(id)&&commands.get(id)!==content)throw new ServiceError('IDEMPOTENCY_CONFLICT');commands.set(id,content)}
    let timeout:ReturnType<typeof setTimeout>|undefined, expired=false
    const checkDeadline=()=>{if(expired)throw new ServiceError(writing?'RESULT_UNKNOWN':'QUERY_FAILED');operationGuard?.()}
    try {
      const processResponse=async()=>{
      // 파일 전송 등 상위 작업이 이미 끝났다면 신원 조회 뒤에도 새 RPC를 시작하지 않는다.
      checkDeadline()
      const access=(identity:LegacyIdentity)=>canonical([identity.userId,identity.approved,identity.profile?.role,identity.profile?.is_active,identity.profile?.department_id,[...(identity.profile?.extra_permissions??[])].sort()])
      const before=await connection.getIdentity()
      checkDeadline()
      if(!before?.approved||before.userId!==original.member.userId||scope(memberId).fingerprint!==original.fingerprint)throw new ServiceError('CANCELLED')
      const raw=await connection.rpcVerified(name,{...payload,p_member_id:memberId})
      checkDeadline()
      let identity:LegacyIdentity|null
      // 저장 뒤 조회 실패는 저장 거절의 증거가 아니다. 원래 요청의 결과를 남긴다.
      try{identity=await connection.getIdentity()}catch{throw new ServiceError('CANCELLED')}
      checkDeadline()
      if(!identity?.approved||access(identity)!==access(before)||scope(memberId).fingerprint!==original.fingerprint)throw new ServiceError('CANCELLED')
      if(!object(raw)||raw.contract!==contract||raw.schoolId!==original.member.schoolId||raw.memberId!==memberId)throw new ServiceError('INVALID_RESPONSE')
      if(Object.hasOwn(raw,'error')){exact(raw,['contract','schoolId','memberId','error']);exact(raw.error,['code']);const code=raw.error.code;if(typeof code!=='string'||!Object.hasOwn(messages,code))throw new ServiceError('INVALID_RESPONSE');throw new ServiceError(code as ServiceCode)}
      exact(raw,['contract','schoolId','memberId','data'])
      try{return parse(raw.data,original.member)}catch{throw new ServiceError('INVALID_RESPONSE')}
      }
      return await Promise.race([processResponse(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(new ServiceError(writing?'RESULT_UNKNOWN':'QUERY_FAILED'))},timeoutMs)})])
    }catch(error){
      try{if(scope(memberId).fingerprint!==original.fingerprint)throw new ServiceError('CANCELLED')}catch{throw new ServiceError('CANCELLED')}
      if(error instanceof ServiceError){if(writing&&['INVALID_RESPONSE','QUERY_FAILED'].includes(error.code))throw new ServiceError('RESULT_UNKNOWN');throw error}
      if(object(error)&&typeof error.code==='string'&&['FORBIDDEN','INACTIVE_MEMBERSHIP','CANCELLED','CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_INPUT','NOT_FOUND'].includes(error.code))throw new ServiceError(error.code as ServiceCode)
      throw new ServiceError(writing?'RESULT_UNKNOWN':'QUERY_FAILED')
    }finally{expired=true;clearTimeout(timeout)}
  }
  return {call}
}
