import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import { recoveryScope } from '../app/pending-requests'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { TeachingError, type TeachingAdapter, type TeachingFailure, type TeachingScope, type TeachingCommand } from './contracts'
import { identifier, text, envelope, catalogResponse, courseResponse, studentResponse, counselingResponse, receiptResponse, activityResponse, rubricRevisionResponse } from './validation'
import { validateCommand } from './commands'
import { csvHash } from './csv'

const messages:Record<TeachingFailure,string>={UNAVAILABLE:'수업·학생 자료 연결을 준비하고 있습니다. 학교 담당자에게 연결 상태를 확인해 주세요.',INVALID_INPUT:'입력 내용과 자료 형식을 확인해 주세요.',FORBIDDEN:'현재 계정으로 이 자료를 볼 수 없습니다.',NOT_FOUND:'자료가 없거나 열람할 수 없습니다.',CONFLICT:'다른 곳에서 먼저 수정했습니다. 내 입력은 유지했습니다. 최신 자료를 확인해 주세요.',IDEMPOTENCY_CONFLICT:'같은 요청 번호에 다른 내용이 있습니다. 기존 요청을 변경하지 않고 결과를 확인해 주세요.',QUERY_FAILED:'수업 자료를 불러오지 못했습니다. 없는 자료로 처리하지 않습니다.',SAVE_UNCERTAIN:'저장 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다.',CANCELLED:'계정 또는 학교 연결이 바뀌어 이전 결과를 표시하지 않습니다.'}
type Scope=TeachingScope&{accessStamp:string}
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value)}
export function createTeachingAdapter(connection:SupabaseConnection,options:{timeoutMs?:number}={}):TeachingAdapter {
  const timeoutMs=options.timeoutMs??30000
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120000)throw new TeachingError('INVALID_INPUT',messages.INVALID_INPUT)
  // 원문 대신 명령 지문만 이 어댑터 메모리에 둔다. 최종 멱등성의 근거는 서버 원장이다.
  const requests=new Map<string,string>()
  function scope(memberId:string):Scope {
    identifier(memberId)
    const c=connection.info(),m=c.memberships.find(m=>m.id===memberId)
    if(!m||!c.schools.some(s=>s.id===m.schoolId)||!activeAt(m,c.basisDate))throw new TeachingError('FORBIDDEN',messages.FORBIDDEN)
    return {schoolId:m.schoolId,memberId:m.id,ownerUserId:m.userId,accessStamp:recoveryScope(m)}
  }
  function stillCurrent(old:Scope):void {
    let current:Scope
    try{current=scope(old.memberId)}catch{throw new TeachingError('CANCELLED',messages.CANCELLED)}
    if(JSON.stringify(old)!==JSON.stringify(current))throw new TeachingError('CANCELLED',messages.CANCELLED)
  }
  async function identityStamp(s:Scope):Promise<string> {
    const identity=await connection.getIdentity()
    stillCurrent(s)
    if(!identity?.approved||identity.userId!==s.ownerUserId||!identity.profile?.is_active||identity.profile.id!==s.ownerUserId)throw new TeachingError('CANCELLED',messages.CANCELLED)
    const profile=identity.profile
    if(!Array.isArray(profile.extra_permissions)||profile.extra_permissions.some(value=>typeof value!=='string'))throw new TeachingError('CANCELLED',messages.CANCELLED)
    return JSON.stringify([identity.userId,identity.approved,profile.role,profile.is_active,profile.department_id,[...profile.extra_permissions].sort()])
  }
  function failure(error:unknown,writing:boolean):TeachingError {
    if(error instanceof TeachingError)return error
    if(error instanceof ContractError){if(writing){const code=error.code==='CANCELLED'||error.code==='FORBIDDEN'||error.code==='INACTIVE_MEMBERSHIP'?'CANCELLED':'SAVE_UNCERTAIN';return new TeachingError(code,messages[code])}const code=error.code==='INACTIVE_MEMBERSHIP'?'CANCELLED':Object.hasOwn(messages,error.code)?error.code as TeachingFailure:writing?'SAVE_UNCERTAIN':'QUERY_FAILED';return new TeachingError(code,messages[code])}
    const code=writing?'SAVE_UNCERTAIN':'QUERY_FAILED'
    return new TeachingError(code,messages[code])
  }
  async function timed<T>(operation:(guard:()=>void)=>Promise<T>,writing:boolean):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined,expired=false
    const deadlineFailure=()=>new TeachingError(writing?'SAVE_UNCERTAIN':'QUERY_FAILED',messages[writing?'SAVE_UNCERTAIN':'QUERY_FAILED'])
    const guard=()=>{if(expired)throw deadlineFailure()}
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(deadlineFailure())},timeoutMs)})
    // 만료한 사전 확인이 늦게 풀려도 RPC를 새로 시작하지 않는다.
    try{return await Promise.race([operation(guard),timeout])}finally{expired=true;if(timer!==undefined)clearTimeout(timer)}
  }
  async function request<T>(memberId:string,name:string,args:Record<string,unknown>,parse:(raw:unknown,s:TeachingScope)=>T,writing=false):Promise<T> {
    const s=scope(memberId)
    return timed(async(guard)=>{
      try {
        guard()
        const before=await identityStamp(s)
        guard()
        const raw=await connection.rpcVerified(name,{p_member_id:memberId,...args})
        guard();stillCurrent(s)
        const after=await identityStamp(s)
        guard()
        if(before!==after)throw new TeachingError('CANCELLED',messages.CANCELLED)
        if(raw&&typeof raw==='object'&&'ok' in raw&&(raw as {ok:unknown}).ok===false){
          try{envelope(raw,s)}catch(error){if(writing)throw new TeachingError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw error}
          const rawCode=(raw as {code?:string}).code
          const code:TeachingFailure=rawCode&&Object.hasOwn(messages,rawCode)?rawCode as TeachingFailure:writing?'SAVE_UNCERTAIN':'QUERY_FAILED'
          throw new TeachingError(code,messages[code])
        }
        try{return parse(raw,s)}catch(parseError){if(writing)throw new TeachingError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw parseError}
      }catch(error){guard();stillCurrent(s);throw failure(error,writing)}
    },writing)
  }
  return {
    catalog:memberId=>request(memberId,'workhub_teaching_catalog',{},catalogResponse),
    course:(memberId,courseId)=>request(memberId,'workhub_teaching_course',{p_course_id:identifier(courseId)},(r,s)=>courseResponse(r,s,courseId)),
    student:(memberId,courseId,studentId,cursor=null)=>request(memberId,'workhub_teaching_student',{p_course_id:identifier(courseId),p_student_id:identifier(studentId),p_cursor:cursor===null?null:text(cursor,1024)},(r,s)=>studentResponse(r,s,courseId,studentId)),
    counseling:(memberId,courseId,studentId,cursor=null)=>request(memberId,'workhub_teaching_counseling',{p_course_id:identifier(courseId),p_student_id:identifier(studentId),p_cursor:cursor===null?null:text(cursor,1024)},(r,s)=>counselingResponse(r,s,courseId,studentId)),
    activity:(memberId,courseId,importId)=>request(memberId,'workhub_teaching_activity',{p_course_id:identifier(courseId),p_import_id:identifier(importId)},(r,s)=>activityResponse(r,s,courseId,importId)),
    rubricRevision:(memberId,courseId,rubricId,revisionId)=>request(memberId,'workhub_teaching_rubric_revision',{p_course_id:identifier(courseId),p_rubric_id:identifier(rubricId),p_revision_id:identifier(revisionId)},(r,s)=>rubricRevisionResponse(r,s,courseId,rubricId,revisionId)),
    async mutate(memberId:string,command:TeachingCommand,requestKey:string){
      const normalized=validateCommand(command);identifier(requestKey)
      if((normalized.kind==='activity_import'||normalized.kind==='activity_correct')&&await csvHash(normalized.input.rawCsv)!==normalized.input.fileHash)throw new TeachingError('INVALID_INPUT','CSV 원문 지문이 다릅니다. 원본을 다시 확인해 주세요.')
      const s=scope(memberId),requestScope=JSON.stringify([s.schoolId,s.ownerUserId,s.memberId,requestKey]),fingerprint=await csvHash(canonical(normalized))
      const previous=requests.get(requestScope)
      if(previous!==undefined&&previous!==fingerprint)throw new TeachingError('IDEMPOTENCY_CONFLICT',messages.IDEMPOTENCY_CONFLICT)
      requests.set(requestScope,fingerprint)
      return request(memberId,'workhub_teaching_mutate',{p_command:normalized,p_request_key:requestKey},(r,scope)=>receiptResponse(r,scope,normalized,requestKey),true)
    },
  }
}
