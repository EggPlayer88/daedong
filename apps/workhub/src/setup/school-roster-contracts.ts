import { canonical, exact, identifier, isoDate, ServiceError, validateLocalInput, version } from '../services/scoped-rpc'

export const SCHOOL_ROSTER_CONTRACT = 'school-roster.v1'
export interface SchoolRosterCandidate { legacyUserId: string; name: string; memberId: string | null; state: 'unlinked' | 'linked' | 'blocked' }
export interface SchoolRosterSnapshot {
  available: boolean; reason: null | 'not_configured' | 'forbidden'; version: number; asOfDate: string
  candidates: SchoolRosterCandidate[]; teachers: { id: string; label: string }[]
}
export interface SchoolRosterIntent { expectedVersion: number; targetUserIds: string[]; startsOn: string; lastDay: string | null; reason: string }
export interface SchoolRosterPreview {
  previewId: string; fingerprint: string; expiresAt: string; intent: SchoolRosterIntent; allowed: boolean
  items: { legacyUserId: string; name: string; outcome: 'link' | 'membership_only' | 'already_linked' | 'blocked'; memberId: string | null }[]
}
export interface SchoolRosterCommand { previewId: string; fingerprint: string; intent: SchoolRosterIntent }
export interface SchoolRosterReceipt { requestKey: string; version: number; recordedAt: string; items: { legacyUserId: string; memberId: string; outcome: 'linked' | 'already_linked' }[] }
export type SchoolRosterCloseResult = { requestKey: string; outcome: 'applied'; receipt: SchoolRosterReceipt } | { requestKey: string; outcome: 'closed'; receipt: null }
export interface SchoolRosterServer {
  get(memberId: string): Promise<SchoolRosterSnapshot>
  preview(memberId: string, intent: SchoolRosterIntent): Promise<SchoolRosterPreview>
  commit(memberId: string, command: SchoolRosterCommand, requestKey: string): Promise<SchoolRosterReceipt>
  close(memberId: string, command: SchoolRosterCommand, requestKey: string): Promise<SchoolRosterCloseResult>
}
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const uid = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : fail()
const rows = (value: unknown): unknown[] => Array.isArray(value) && value.length <= 300 ? value : fail()
const string = (value: unknown, max: number): string => typeof value === 'string' && value.trim() && Array.from(value).length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !Array.from(value).some(x => { const n=x.codePointAt(0)!; return n>=0xd800&&n<=0xdfff }) ? value : fail()
const hash = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : fail()
const stamp = (value: unknown): string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : fail()
const unique = (values: string[]) => { if (new Set(values).size !== values.length) fail() }

export function schoolRosterIntent(value: unknown): SchoolRosterIntent {
  return validateLocalInput(() => {
    exact(value, ['expectedVersion','targetUserIds','startsOn','lastDay','reason'])
    const targetUserIds=rows(value.targetUserIds).map(uid); unique(targetUserIds)
    if (!targetUserIds.length) fail()
    const startsOn=isoDate(value.startsOn), lastDay=value.lastDay===null?null:isoDate(value.lastDay)
    if (startsOn<'2020-01-01'||startsOn>'2100-12-31'||lastDay!==null&&(lastDay<startsOn||lastDay>'2100-12-31')) fail()
    const expectedVersion=version(value.expectedVersion)
    if(expectedVersion>2147483647)fail()
    return {expectedVersion,targetUserIds:[...targetUserIds].sort(),startsOn,lastDay,reason:string(value.reason,200).trim()}
  })
}
export function schoolRosterCommand(value: unknown): SchoolRosterCommand {
  return validateLocalInput(() => { exact(value,['previewId','fingerprint','intent']); return {previewId:identifier(value.previewId),fingerprint:hash(value.fingerprint),intent:schoolRosterIntent(value.intent)} })
}
export function schoolRosterSnapshot(value: unknown): SchoolRosterSnapshot {
  exact(value,['available','reason','version','asOfDate','candidates','teachers'])
  if(typeof value.available!=='boolean'||!([null,'not_configured','forbidden'] as unknown[]).includes(value.reason)||value.available!==(value.reason===null))fail()
  const candidates=rows(value.candidates).map(raw=>{
    exact(raw,['legacyUserId','name','memberId','state'])
    if(!['unlinked','linked','blocked'].includes(String(raw.state)))fail()
    const row={legacyUserId:uid(raw.legacyUserId),name:string(raw.name,50),memberId:raw.memberId===null?null:identifier(raw.memberId),state:raw.state as SchoolRosterCandidate['state']}
    if(row.state==='linked'&&row.memberId===null||row.state==='unlinked'&&row.memberId!==null)fail()
    return row
  })
  const teachers=rows(value.teachers).map(raw=>{exact(raw,['id','label']);return {id:identifier(raw.id),label:string(raw.label,120)}})
  unique(candidates.map(x=>x.legacyUserId));unique(candidates.flatMap(x=>x.memberId===null?[]:[x.memberId]));unique(teachers.map(x=>x.id))
  if(!value.available&&(candidates.length||teachers.length))fail()
  return {available:value.available as boolean,reason:value.reason as SchoolRosterSnapshot['reason'],version:version(value.version),asOfDate:isoDate(value.asOfDate),candidates,teachers}
}
export function schoolRosterPreview(value: unknown, intent: SchoolRosterIntent): SchoolRosterPreview {
  exact(value,['previewId','fingerprint','expiresAt','intent','items','allowed'])
  if(canonical(schoolRosterIntent(value.intent))!==canonical(intent)||typeof value.allowed!=='boolean')fail()
  const items=rows(value.items).map(raw=>{
    exact(raw,['legacyUserId','name','outcome','memberId'])
    if(!['link','membership_only','already_linked','blocked'].includes(String(raw.outcome)))fail()
    const row={legacyUserId:uid(raw.legacyUserId),name:string(raw.name,50),outcome:raw.outcome as SchoolRosterPreview['items'][number]['outcome'],memberId:raw.memberId===null?null:identifier(raw.memberId)}
    if(row.outcome==='already_linked'&&row.memberId===null||['link','membership_only'].includes(row.outcome)&&row.memberId!==null)fail()
    return row
  })
  unique(items.map(x=>x.legacyUserId))
  unique(items.flatMap(x=>x.memberId===null?[]:[x.memberId]))
  if(canonical(items.map(x=>x.legacyUserId).sort())!==canonical(intent.targetUserIds)||value.allowed!==!items.some(x=>x.outcome==='blocked'))fail()
  return {previewId:identifier(value.previewId),fingerprint:hash(value.fingerprint),expiresAt:stamp(value.expiresAt),intent:structuredClone(intent),items,allowed:value.allowed as boolean}
}
export function schoolRosterReceipt(value: unknown, command: SchoolRosterCommand, key: string): SchoolRosterReceipt {
  exact(value,['requestKey','version','recordedAt','items'])
  if(value.requestKey!==key||version(value.version)!==command.intent.expectedVersion+1)fail()
  const items=rows(value.items).map(raw=>{
    exact(raw,['legacyUserId','memberId','outcome'])
    if(!['linked','already_linked'].includes(String(raw.outcome)))fail()
    return {legacyUserId:uid(raw.legacyUserId),memberId:identifier(raw.memberId),outcome:raw.outcome as 'linked'|'already_linked'}
  })
  unique(items.map(x=>x.legacyUserId));unique(items.map(x=>x.memberId))
  if(canonical(items.map(x=>x.legacyUserId).sort())!==canonical(command.intent.targetUserIds))fail()
  return {requestKey:key,version:value.version as number,recordedAt:stamp(value.recordedAt),items}
}
export function schoolRosterCloseResult(value: unknown, command: SchoolRosterCommand, key: string): SchoolRosterCloseResult {
  exact(value,['requestKey','outcome','receipt'])
  if(value.requestKey!==key)fail()
  if(value.outcome==='applied')return {requestKey:key,outcome:'applied',receipt:schoolRosterReceipt(value.receipt,command,key)}
  if(value.outcome==='closed'&&value.receipt===null)return {requestKey:key,outcome:'closed',receipt:null}
  return fail()
}
