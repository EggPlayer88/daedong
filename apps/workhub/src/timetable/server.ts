import { recoveryScope } from '../app/pending-requests'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, exact, identifier, isoDate, text, version, ServiceError, canonical } from '../services/scoped-rpc'
import { validateBasis, validatePlacements } from '../../../../packages/timetable/src/validate'
import { TIMETABLE_CONTRACT, type TimetableBasis, type TimetableSnapshot, type TimetableConditions, type SaveDraftInput, type SaveDraftReceipt, type TimetableServer, type TimetableReadiness } from './contracts'
import limits from './limits.json'
import policy from '../../../../packages/timetable/_assets/browser-policy.json'
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail()
const int = (v: unknown, min: number, max: number): number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : fail()
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail()
const hash = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail()
export const timetableWeekStart = (day: string): string => { const d = new Date(isoDate(day)+'T00:00:00Z');d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);return d.toISOString().slice(0,10) }
export function timetableReadiness(raw: unknown): TimetableReadiness {
  if (raw && typeof raw === 'object' && 'available' in raw && raw.available === true) { exact(raw, ['available']);return {available:true} }
  exact(raw, ['available','reason']);if(raw.available !== false || !['not_installed','basis_missing','not_allowed'].includes(String(raw.reason)))fail()
  return raw as TimetableReadiness
}
export function timetableConditions(raw: unknown, basis: TimetableBasis): TimetableConditions {
  exact(raw, ['fixed','unavailable','preferences'])
  const candidate = {...basis, ...structuredClone(raw)} as TimetableBasis
  if (!validateBasis(candidate).valid) fail()
  // 학교가 확정한 필수조건을 담당자 초안이나 AI가 제거하지 못하게 한다.
  for (const key of ['fixed','unavailable'] as const) for (const item of basis[key]) if (!candidate[key].some(row => canonical(row) === canonical(item))) fail()
  return {fixed:candidate.fixed, unavailable:candidate.unavailable, preferences:candidate.preferences}
}
export function timetableSaveInput(raw: unknown, basis: TimetableBasis): SaveDraftInput {
  exact(raw, ['basisId','basisRevision','sourceFingerprint','title','conditions','placements'])
  if (raw.basisId !== basis.id || raw.basisRevision !== basis.revision || raw.sourceFingerprint !== basis.sourceFingerprint) throw new ServiceError('CONFLICT')
  text(raw.title, limits.title, true)
  const conditions=timetableConditions(raw.conditions,basis)
  if(!validatePlacements({...basis,...conditions}, raw.placements).valid) fail()
  return structuredClone({...raw,conditions}) as unknown as SaveDraftInput
}
// 재확인에서는 최신 기초판으로 원래 명령을 재작성하지 않는다. 서버 원장의 결과만 읽는다.
export function timetableRecoveryInput(raw: unknown): SaveDraftInput {
  exact(raw,['basisId','basisRevision','sourceFingerprint','title','conditions','placements'])
  identifier(raw.basisId);version(raw.basisRevision);hash(raw.sourceFingerprint);text(raw.title,limits.title,true)
  const pairs=(v: unknown,max: number,weighted=false)=>list(v,max).forEach(row=>{exact(row,weighted?['lessonId','slotId','weight']:['lessonId','slotId']);identifier(row.lessonId);identifier(row.slotId);if(weighted)int(row.weight,0,policy.maxWeight)})
  exact(raw.conditions,['fixed','unavailable','preferences'])
  pairs(raw.conditions.fixed,policy.maxLessons);pairs(raw.conditions.preferences,policy.maxConditions,true);pairs(raw.placements,policy.maxLessons)
  list(raw.conditions.unavailable,policy.maxConditions).forEach(row=>{exact(row,['resourceId','day','startMinute','endMinute']);identifier(row.resourceId);int(row.day,1,7);const start=int(row.startMinute,0,1439),end=int(row.endMinute,1,1440);if(start>=end)fail()})
  return structuredClone(raw) as unknown as SaveDraftInput
}
export function timetableSnapshot(raw: unknown, schoolId: string, requestedWeek: string): TimetableSnapshot {
  exact(raw, ['basis','canDesign','canSave','drafts','weekStart','lessons'])
  const canDesign=bool(raw.canDesign),canSave=bool(raw.canSave)
  if(canSave&&!canDesign || raw.weekStart !== requestedWeek || timetableWeekStart(requestedWeek)!==requestedWeek)fail()
  if(canDesign ? !validateBasis(raw.basis).valid : raw.basis!==null)fail()
  const basis=raw.basis as TimetableBasis | null
  if(basis && basis.schoolId!==schoolId)fail()
  const drafts=list(raw.drafts,limits.drafts).map(item=>{
    if(!basis)fail()
    exact(item,['id','version','title','basisId','basisRevision','sourceFingerprint','conditions','placements'])
    identifier(item.id);version(item.version);hash(item.sourceFingerprint)
    const value=timetableSaveInput({basisId:item.basisId,basisRevision:item.basisRevision,sourceFingerprint:item.sourceFingerprint,title:item.title,conditions:item.conditions,placements:item.placements},basis!)
    return {id:item.id as string, version:item.version as number,...value}
  })
  if(new Set(drafts.map(d=>d.id)).size!==drafts.length || (!canDesign&&drafts.length))fail()
  const until=new Date(requestedWeek+'T00:00:00Z');until.setUTCDate(until.getUTCDate()+7)
  const end=until.toISOString().slice(0,10)
  const names=(v: unknown)=>list(v,limits.displayNames).map(name=>text(name,100,true))
  const lessons=list(raw.lessons,limits.publishedLessons).map(item=>{
    exact(item,['id','version','date','startMinute','endMinute','label','teacherNames','classNames','roomNames','status'])
    identifier(item.id);version(item.version);isoDate(item.date);text(item.label,120,true)
    const startMinute=int(item.startMinute,0,1439),endMinute=int(item.endMinute,1,1440)
    if(startMinute>=endMinute || (item.date as string)<requestedWeek || (item.date as string)>=end || !['scheduled','changed','cancelled'].includes(String(item.status)))fail()
    return {...item,id:item.id as string,startMinute,endMinute,teacherNames:names(item.teacherNames),classNames:names(item.classNames),roomNames:names(item.roomNames)}
  })
  if(new Set(lessons.map(l=>l.id)).size!==lessons.length)fail()
  // 표시 이름으로 소유권을 추측하지 않는다. 서버는 소속과 수업 관계를 다시 확인한다.
  return structuredClone({basis,canDesign,canSave,drafts,weekStart:requestedWeek,lessons}) as TimetableSnapshot
}
export function timetableReceipt(raw: unknown, input: SaveDraftInput, key: string): SaveDraftReceipt {
  exact(raw,['requestKey','draftId','version','basisRevision'])
  if(raw.requestKey!==key || raw.basisRevision!==input.basisRevision || raw.version!==1)fail()
  identifier(raw.draftId);return structuredClone(raw) as unknown as SaveDraftReceipt
}
export function createTimetableServer(connection: SupabaseConnection, options:{timeoutMs?:number}={}): TimetableServer {
  const transport=createScopedRpc(connection,TIMETABLE_CONTRACT,options)
  // 실제 읽은 기초 자료 판만 새 저장의 기준으로 삼는다.
  const bases=new Map<string,{snapshot:TimetableSnapshot;scope:string}>()
  const scope=(memberId:string)=>{const member=connection.info().memberships.find(m=>m.id===memberId);if(!member)throw new ServiceError('CANCELLED');return recoveryScope(member)}
  const originals=new Map<string,SaveDraftInput>()
  return {
    readiness:memberId=>transport.call(memberId,'workhub_timetable_readiness',{},timetableReadiness),
    async get(memberId,weekStart){
      isoDate(weekStart);if(timetableWeekStart(weekStart)!==weekStart)throw new ServiceError('INVALID_INPUT')
      const result=await transport.call(memberId,'workhub_timetable_get',{p_week_start:weekStart},(raw,member)=>timetableSnapshot(raw,member.schoolId,weekStart))
      bases.set(memberId,{snapshot:structuredClone(result),scope:scope(memberId)});return result
    },
    recoverDraft(memberId,input,key){
      const command=timetableRecoveryInput(input);text(key,200,true);if(key.length<8)throw new ServiceError('INVALID_INPUT')
      const original=originals.get(scope(memberId)+':'+key)
      if(original&&canonical(original)!==canonical(command))throw new ServiceError('IDEMPOTENCY_CONFLICT')
      return transport.call(memberId,'workhub_timetable_save_draft',{p_input:command,p_request_key:key,p_recover_only:true},raw=>timetableReceipt(raw,command,key))
    },
    async saveDraft(memberId,input,key){
      const requestId=scope(memberId)+':'+key,old=originals.get(requestId)
      let command:SaveDraftInput
      if(old){if(canonical(old)!==canonical(input))throw new ServiceError('IDEMPOTENCY_CONFLICT');command=structuredClone(old)}
      else {
        const saved=bases.get(memberId);if(!saved)throw new ServiceError('NOT_READY')
        if(saved.scope!==scope(memberId))throw new ServiceError('CANCELLED')
        const current=saved.snapshot
        if(!current.canSave||!current.basis)throw new ServiceError('FORBIDDEN')
        try{command=timetableSaveInput(input,current.basis)}catch(error){if(error instanceof ServiceError&&error.code==='CONFLICT')throw error;throw new ServiceError('INVALID_INPUT')}
        originals.set(requestId,structuredClone(command))
      }
      return transport.call(memberId,'workhub_timetable_save_draft',{p_input:command,p_request_key:key,p_recover_only:false},raw=>timetableReceipt(raw,command,key),true)
    },
  }
}
