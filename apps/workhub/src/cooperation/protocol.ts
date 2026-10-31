import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import { recoveryScope } from '../services/recovery-scope'
import type { SupabaseConnection } from '../connection/supabase-connection'

export type ModuleFailure = 'UNAVAILABLE'|'INVALID_INPUT'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'IDEMPOTENCY_CONFLICT'|'QUERY_FAILED'|'SAVE_UNCERTAIN'|'CANCELLED'
export class ModuleError extends Error { constructor(public code:ModuleFailure,message:string,public definitive=false){super(message);this.name='ModuleError'} }
export type Scope={schoolId:string;memberId:string;ownerUserId:string}
const messages:Record<ModuleFailure,string>={UNAVAILABLE:'이 기능의 서버 연결을 준비하고 있습니다.',INVALID_INPUT:'입력 내용과 응답 형식을 확인해 주세요.',FORBIDDEN:'현재 계정으로 접근할 수 없는 자료입니다.',NOT_FOUND:'자료가 없거나 열람할 수 없습니다.',CONFLICT:'다른 곳에서 자료가 변경되었습니다. 내 입력은 보관했습니다. 최신 내용을 확인해 주세요.',IDEMPOTENCY_CONFLICT:'같은 요청 번호의 내용이 달라졌습니다. 이전 요청의 결과부터 확인해 주세요.',QUERY_FAILED:'자료를 불러오지 못했습니다. 빈 자료로 처리하지 않습니다.',SAVE_UNCERTAIN:'저장 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다.',CANCELLED:'계정 또는 학교 연결이 바뀌어 이전 결과를 표시하지 않습니다.'}
export const invalid=(message=messages.INVALID_INPUT):never=>{throw new ModuleError('INVALID_INPUT',message)}
export const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid()
export function text(v:unknown,max=200,empty=false):string{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v))return invalid();return v}
export const id=(v:unknown):string=>/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$/.test(text(v,160))?v as string:invalid()
export const integer=(v:unknown,min=1,max=Number.MAX_SAFE_INTEGER):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:invalid()
export const array=(v:unknown,max=200):unknown[]=>Array.isArray(v)&&v.length<=max?v:invalid()
export const bool=(v:unknown):boolean=>typeof v==='boolean'?v:invalid()
export function date(v:unknown):string{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)return invalid('올바른 날짜를 입력해 주세요.');return s}
export const timestamp=(v:unknown):string=>/^\d{4}-\d{2}-\d{2}T/.test(text(v,40))&&Number.isFinite(Date.parse(v as string))?v as string:invalid()
export const digest=(v:unknown):string=>/^[a-f0-9]{64}$/.test(text(v,64))?v as string:invalid()
export function exact(v:Record<string,unknown>,keys:readonly string[]){if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))invalid('허용되지 않은 입력 항목이 있습니다.')}
export function unique<T>(v:T[],key:(v:T)=>string):T[]{if(new Set(v.map(key)).size!==v.length)invalid('중복 항목이 있습니다.');return v}
export function canonical(v:unknown):string{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v)}
export async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function envelope(raw:unknown,scope:Scope,contract:string,success=true){const v=object(raw);if(v.contractVersion!==contract)throw new ModuleError('UNAVAILABLE',messages.UNAVAILABLE);if(v.schoolId!==scope.schoolId||v.memberId!==scope.memberId||v.ownerUserId!==scope.ownerUserId)throw new ModuleError('FORBIDDEN',messages.FORBIDDEN);if(success&&v.ok!==true)invalid();return v}

// 기능 어댑터의 조회/쓰기 계약. 인증 방식 자체는 기존 공유 연결만 사용한다.
export function createVerifiedTransport(connection:SupabaseConnection,contract:string,timeoutMs=30000){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120000)invalid()
  const fingerprints=new Map<string,string>()
  function scope(memberId:string):Scope&{accessStamp:string}{id(memberId);const c=connection.info(),m=c.memberships.find(m=>m.id===memberId);if(!m||!c.schools.some(s=>s.id===m.schoolId)||!activeAt(m,c.basisDate))throw new ModuleError('FORBIDDEN',messages.FORBIDDEN);return {schoolId:m.schoolId,memberId:m.id,ownerUserId:m.userId,accessStamp:recoveryScope(m)}}
  function current(s:ReturnType<typeof scope>){try{if(canonical(scope(s.memberId))===canonical(s))return}catch{}throw new ModuleError('CANCELLED',messages.CANCELLED)}
  async function identity(s:ReturnType<typeof scope>){const v=await connection.getIdentity();current(s);if(!v?.approved||v.userId!==s.ownerUserId||v.profile?.id!==s.ownerUserId||!v.profile.is_active||!Array.isArray(v.profile.extra_permissions)||v.profile.extra_permissions.some(p=>typeof p!=='string'))throw new ModuleError('CANCELLED',messages.CANCELLED);return canonical([v.userId,v.approved,v.profile.role,v.profile.is_active,v.profile.department_id,[...v.profile.extra_permissions].sort()])}
  async function call<T>(memberId:string,name:string,args:Record<string,unknown>,parse:(v:unknown,s:Scope)=>T,writing=false):Promise<T>{
    const s=scope(memberId)
    let timer:ReturnType<typeof setTimeout>|undefined,expired=false
    const deadlineFailure=()=>new ModuleError(writing?'SAVE_UNCERTAIN':'QUERY_FAILED',messages[writing?'SAVE_UNCERTAIN':'QUERY_FAILED'])
    const guard=()=>{if(expired)throw deadlineFailure()}
    // Promise.race만으로는 늦게 끝난 인증 확인이 다음 쓰기를 시작하는 것을 막지 못한다.
    // 각 await 뒤에 만료를 확인해 이미 종료한 요청은 더 진행하지 않는다.
    async function run(){
      try{
        guard()
        const before=await identity(s)
        guard()
        const raw=await connection.rpcVerified(name,{p_member_id:memberId,...args})
        guard();current(s)
        const after=await identity(s)
        guard()
        if(before!==after)throw new ModuleError('CANCELLED',messages.CANCELLED)
        if(raw&&typeof raw==='object'&&'ok'in raw&&raw.ok===false){
          try{
            const rejected=envelope(raw,s,contract,false)
            if(writing){
              const commandHash=await sha256(canonical(args.p_command))
              guard()
              if(rejected.requestKey!==args.p_request_key||rejected.commandHash!==commandHash||rejected.outcome!=='rejected')invalid()
            }
          }catch(error){guard();if(writing)throw new ModuleError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw error}
          const code=(raw as {code?:string}).code
          throw new ModuleError(code&&Object.hasOwn(messages,code)?code as ModuleFailure:writing?'SAVE_UNCERTAIN':'QUERY_FAILED',code&&Object.hasOwn(messages,code)?messages[code as ModuleFailure]:messages[writing?'SAVE_UNCERTAIN':'QUERY_FAILED'],writing&&!!code&&['INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','UNAVAILABLE'].includes(code))
        }
        guard()
        try{return parse(raw,s)}catch(error){if(writing)throw new ModuleError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw error}
      }catch(error){
        guard();current(s)
        if(error instanceof ModuleError)throw error
        const cancelled=error instanceof ContractError&&['CANCELLED','FORBIDDEN','INACTIVE_MEMBERSHIP'].includes(error.code)
        const code=cancelled?'CANCELLED':writing?'SAVE_UNCERTAIN':'QUERY_FAILED'
        throw new ModuleError(code,messages[code])
      }
    }
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(deadlineFailure())},timeoutMs)})
    try{return await Promise.race([run(),timeout])}
    finally{expired=true;if(timer!==undefined)clearTimeout(timer)}
  }
  async function remember(memberId:string,key:string,command:unknown){id(key);const s=scope(memberId),slot=canonical([s.schoolId,s.ownerUserId,s.memberId,key]),hash=await sha256(canonical(command));const old=fingerprints.get(slot);if(old!==undefined&&old!==hash)throw new ModuleError('IDEMPOTENCY_CONFLICT',messages.IDEMPOTENCY_CONFLICT);fingerprints.set(slot,hash)}
  return {call,remember}
}
export function message(error:unknown):string{return error instanceof ModuleError?error.message:messages.QUERY_FAILED}
export function uncertain(error:unknown):boolean{return !(error instanceof ModuleError)||['SAVE_UNCERTAIN','CANCELLED','QUERY_FAILED','IDEMPOTENCY_CONFLICT'].includes(error.code)}
