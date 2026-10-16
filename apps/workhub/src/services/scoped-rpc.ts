import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { LegacyIdentity } from '../connection/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'

export type ServiceCode = 'NOT_READY' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'CANCELLED' | 'QUERY_FAILED' | 'RESULT_UNKNOWN' | 'INVALID_RESPONSE'
const messages: Record<ServiceCode,string> = {
  NOT_READY:'이 기능의 서버 연결을 준비 중입니다. 기존 입력은 유지됩니다.',
  FORBIDDEN:'현재 계정으로 이 자료를 처리할 수 없습니다.', INACTIVE_MEMBERSHIP:'현재 학교 소속을 다시 확인해 주세요.',
  INVALID_INPUT:'입력 내용과 형식을 확인해 주세요.', NOT_FOUND:'현재 열람할 수 있는 자료가 아닙니다.',
  CONFLICT:'다른 곳에서 수정된 자료입니다. 내 입력을 보관한 뒤 최신 원본을 다시 확인해 주세요.',
  IDEMPOTENCY_CONFLICT:'원래 요청 번호의 내용이 달라 자동 재전송하지 않습니다. 기존 요청을 확인해 주세요.',
  CANCELLED:'학교 또는 계정이 바뀌어 이전 응답을 닫았습니다.', QUERY_FAILED:'자료를 불러오지 못했습니다. 다시 확인해 주세요.',
  RESULT_UNKNOWN:'저장 결과를 확인하지 못했습니다. 같은 내용과 요청 번호로 다시 확인해 주세요.',
  INVALID_RESPONSE:'서버 자료의 형식을 확인하지 못했습니다. 다시 조회해 주세요.',
}
export class ServiceError extends Error { constructor(readonly code: ServiceCode) { super(messages[code]); this.name='ServiceError' } }
// exact·version 등 응답 검증기를 재사용하는 경우, 전송 전 입력 검사 안에서만 오류를 구분한다.
export function validateLocalInput<T>(validate:()=>T):T {
  try{return validate()}
  catch(error){if(error instanceof ServiceError&&error.code==='INVALID_RESPONSE')throw new ServiceError('INVALID_INPUT');throw error}
}
export const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value)
export function exact(value: unknown, keys: readonly string[]): asserts value is Record<string,unknown> { if (!object(value) || Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key))) throw new ServiceError('INVALID_RESPONSE') }
export function identifier(value: unknown): string { if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new ServiceError('INVALID_INPUT');return value }
export function text(value: unknown,max:number,required=false):string { if(typeof value!=='string'||Array.from(value).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(required&&!value.trim()))throw new ServiceError('INVALID_INPUT');return value }
export function version(value: unknown):number { if(!Number.isSafeInteger(value)||(value as number)<1)throw new ServiceError('INVALID_RESPONSE');return value as number }
export function isoDate(value:unknown):string { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new ServiceError('INVALID_INPUT');return value }
export const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value)

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
  async function call<T>(memberId:string,name:string,args:Record<string,unknown>,parse:(data:unknown,member:Membership)=>T,writing=false):Promise<T> {
    const original=scope(memberId)
    const payload=structuredClone(args)
    if(writing){const key=text(payload.p_request_key,200,true);if(key.length<8)throw new ServiceError('INVALID_INPUT');const id=original.fingerprint+':'+name+':'+key, content=canonical(payload);if(commands.has(id)&&commands.get(id)!==content)throw new ServiceError('IDEMPOTENCY_CONFLICT');commands.set(id,content)}
    let timeout:ReturnType<typeof setTimeout>|undefined, expired=false
    const checkDeadline=()=>{if(expired)throw new ServiceError(writing?'RESULT_UNKNOWN':'QUERY_FAILED')}
    try {
      const processResponse=async()=>{
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
