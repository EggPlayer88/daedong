import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import { recoveryScope } from '../services/recovery-scope'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { TeachingError, type TeachingFailure, type TeachingScope } from './contracts'
import type { TeachingRelationsAdapter, RelationIntent, RelationCommit, RelationsSnapshot } from './relations-contracts'
import { identifier } from './validation'
import { relationsSnapshot, validateRelationIntent, relationsPreview, validateRelationCommit, relationsReceipt, relationCanonical, validateKnownRelationPreview, validateRelationSelection, relationFailure } from './relations-validation'
import { csvHash } from './csv'

// 기존 teaching.v1 전송의 계정·소속 재확인과 결과 미상 처리 규칙을 그대로 사용한다.
const messages: Record<TeachingFailure,string> = {
  UNAVAILABLE: '담당·수강 관계 변경 기능을 준비하고 있습니다. 기존 수업 기록은 계속 확인할 수 있습니다.',
  INVALID_INPUT: '변경 대상과 마지막 유효일, 사유를 확인해 주세요.', FORBIDDEN: '현재 계정에 이 관계를 변경할 권한이 없습니다.',
  NOT_FOUND: '관계가 없거나 현재 계정으로 확인할 수 없습니다.', CONFLICT: '관계 또는 미리보기가 바뀌었습니다. 입력을 유지했으니 최신 자료를 확인해 주세요.',
  IDEMPOTENCY_CONFLICT: '원래 요청 번호에 다른 내용이 있습니다. 명령을 바꾸지 않고 기존 결과를 확인해 주세요.',
  QUERY_FAILED: '관계 자료를 확인하지 못했습니다. 기존 입력은 이 탭에 유지합니다.',
  SAVE_UNCERTAIN: '변경 결과를 확인하지 못했습니다. 입력과 원래 요청 번호를 보관했습니다.',
  CANCELLED: '계정 또는 학교 연결이 바뀌어 이전 결과를 표시하지 않습니다.',
}
type Scope=TeachingScope&{accessStamp:string}
export function createTeachingRelationsAdapter(connection:SupabaseConnection,options:{timeoutMs?:number}={}):TeachingRelationsAdapter {
  const timeoutMs=options.timeoutMs??30000
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120000)throw new TeachingError('INVALID_INPUT',messages.INVALID_INPUT)
  // 원문 대신 명령 지문만 이 어댑터 메모리에 둔다. 최종 멱등성의 근거는 서버 원장이다.
  const requests=new Map<string,string>(),snapshots=new Map<string,RelationsSnapshot>(),snapshotGeneration=new Map<string,number>(),unavailableSnapshots=new Set<string>()
  const snapshotKey=(s:Scope,courseId:string)=>JSON.stringify([s.schoolId,s.ownerUserId,s.memberId,s.accessStamp,courseId])
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
  async function request<T>(memberId:string,name:string,args:Record<string,unknown>,parse:(raw:unknown,s:TeachingScope)=>T,writing=false,binding?:{requestKey:string;commandHash:string}):Promise<T> {
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
          let code:TeachingFailure
          try{code=relationFailure(raw,s,binding)}catch(error){if(writing)throw new TeachingError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw error}
          throw new TeachingError(code,messages[code])
        }
        try{return parse(raw,s)}catch(parseError){if(writing)throw new TeachingError('SAVE_UNCERTAIN',messages.SAVE_UNCERTAIN);throw parseError}
      }catch(error){guard();stillCurrent(s);throw failure(error,writing)}
    },writing)
  }
  return {
    async snapshot(memberId,courseId) {
      const key=snapshotKey(scope(memberId),identifier(courseId)),generation=(snapshotGeneration.get(key)??0)+1;snapshotGeneration.set(key,generation);snapshots.delete(key);unavailableSnapshots.delete(key)
      try{
        const result=await request(memberId,'workhub_teaching_relations',{p_course_id:courseId},(raw,s)=>relationsSnapshot(raw,s,courseId));if(snapshotGeneration.get(key)===generation)snapshots.set(key,result);return result
      }catch(error){
        // 같은 조회 범위의 최신 준비 상태만 기억한다. 확정·원요청 복구에는 적용하지 않는다.
        if(snapshotGeneration.get(key)===generation&&error instanceof TeachingError&&error.code==='UNAVAILABLE')unavailableSnapshots.add(key)
        throw error
      }
    },
    async preview(memberId,intent:RelationIntent) {
      const normalized=validateRelationIntent(intent),key=snapshotKey(scope(memberId),normalized.courseId),snapshot=snapshots.get(key)
      if(!snapshot){if(unavailableSnapshots.has(key))throw new TeachingError('UNAVAILABLE',messages.UNAVAILABLE);throw new TeachingError('QUERY_FAILED','최신 관계를 먼저 조회한 뒤 변경 영향을 확인해 주세요.')}
      validateRelationSelection(normalized,snapshot)
      return request(memberId,'workhub_teaching_relation_preview',{p_intent:normalized},(raw,s)=>{
        if(snapshots.get(key)!==snapshot)throw new TeachingError('CONFLICT',messages.CONFLICT)
        return validateKnownRelationPreview(relationsPreview(raw,s,normalized),snapshot)
      })
    },
    async commit(memberId:string,command:RelationCommit,requestKey:string) {
      const normalized=validateRelationCommit(command); identifier(requestKey)
      const s=scope(memberId),requestScope=JSON.stringify([s.schoolId,s.ownerUserId,s.memberId,requestKey]),fingerprint=await csvHash(relationCanonical(normalized))
      const previous=requests.get(requestScope)
      if(previous!==undefined&&previous!==fingerprint)throw new TeachingError('IDEMPOTENCY_CONFLICT',messages.IDEMPOTENCY_CONFLICT)
      requests.set(requestScope,fingerprint)
      return request(memberId,'workhub_teaching_relation_commit',{p_command:normalized,p_request_key:requestKey},(raw,scope)=>relationsReceipt(raw,scope,normalized,requestKey),true,{requestKey,commandHash:fingerprint})
    },
  }
}
