import type { CalendarEvent, EventDraft, Membership } from '../contracts'
import { normalizeDraft } from '../domain'
import { eventResponse } from '../connection/validation'
export type Kind = 'meals'|'schedule'|'timetable'|'classes'
export type Range = {kind:Kind;year:number;from:string;to:string}
export type Source = {identity:string;contentHash:string;loadedOn:string}
export type Meal = Source & {date:string;mealCode:string;mealName:string;menu:string;calories:string;origins:string;nutrition:string}
export type Lesson = Source & {date:string;grade:number;className:string;session:string;period:number;semester:number;subject:string}
export type SchoolClass = Source & {grade:number;className:string;session:string}
export type ScheduleData = Source & {date:string;title:string;content:string;grades:number[];dayKind:string;course:string;session:string}
export type Schedule = {id:string;version:number;data:ScheduleData;present:boolean;eventId:string|null;baseline:EventDraft|null;dismissed:boolean;supersededBy:null;current:CalendarEvent|null}
export type Snapshot = Range & {contract:'neis.v1';schoolId:string;memberId:string;today:string;configured:boolean;canManage:boolean;source:{officeCode:string;schoolCode:string;schoolName:string}|null;version:number;fetchedAt:string|null;errorCode:string|null;rows:(Meal|Lesson|SchoolClass|Schedule)[]}
export type Selection = {id:string;version:number;decision:'apply'|'ignore';eventId:string|null;eventVersion:number|null;replaces:string|null;overwrite:boolean}
export type Closed = {outcome:'applied'|'closed';receipt:Receipt|null}
export type Receipt = {contract:'neis.receipt.v1';schoolId:string;memberId:string;requestKey:string;recordedAt:string;items:({sourceId:string;decision:'ignored'}|{sourceId:string;decision:'applied';event:CalendarEvent})[]}
const errors:Record<string,string>={
 NOT_READY:'나이스 연결을 준비하고 있습니다.', KEY_MISSING:'서버에 나이스 API 키를 등록해 주세요.',
 QUERY_FAILED:'자료를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.', INVALID_RESPONSE:'자료 형식을 확인하지 못했습니다. 기존 자료는 유지됩니다.',
 CONFLICT:'비교 후 자료가 바뀌었거나 같은 일정이 있습니다. 최신 자료와 연결할 일정을 다시 확인해 주세요.',
 RESULT_UNKNOWN:'반영 결과를 확인하지 못했습니다. 같은 요청의 결과 확인을 눌러 주세요.',
 FORBIDDEN:'현재 권한으로 이 작업을 할 수 없습니다.', CANCELLED:'계정 또는 소속이 바뀌어 이전 요청을 중단했습니다.',
 INVALID_INPUT:'기간과 선택한 항목을 확인해 주세요.', IDEMPOTENCY_CONFLICT:'이 요청 번호에 다른 내용이 있습니다. 기존 요청을 확인해 주세요.'
}
export class NeisError extends Error {constructor(readonly code:string){super(errors[code]??errors.QUERY_FAILED)}}
export function fail():never {throw new NeisError('INVALID_RESPONSE')}
export function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>}
function str(v:unknown,max=8000):string {if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(v))return fail();return v}
function num(v:unknown,min=0,max=20000):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)return fail();return v}
function bool(v:unknown):boolean {if(typeof v!=='boolean')return fail();return v}
export function iso(v:unknown):string{const s=str(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)return fail();return s}
function stamp(v:unknown):string|null {if(v===null)return null;const s=str(v,60);if(!Number.isFinite(Date.parse(s)))return fail();return s}
function source(v:Record<string,unknown>):Source{const identity=str(v.identity,64),contentHash=str(v.contentHash,64);if(!/^[a-f0-9]{64}$/.test(identity)||!/^[a-f0-9]{64}$/.test(contentHash))return fail();return{identity,contentHash,loadedOn:iso(v.loadedOn)}}
export function academicYear(today:string):number{return Number(today.slice(0,4))-(Number(today.slice(5,7))<3?1:0)}
export function addDays(value:string,days:number):string{const d=new Date(iso(value)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function range(kind:Kind,today:string,year=academicYear(today)):Range{
 iso(today);if(!Number.isSafeInteger(year)||year<2020||year>2100)throw new NeisError('INVALID_INPUT')
 if(kind==='schedule'||kind==='classes')return{kind,year,from:year+'-03-01',to:addDays((year+1)+'-03-01',-1)}
 if(kind==='timetable'){const d=new Date(today+'T00:00:00Z'),monday=addDays(today,-((d.getUTCDay()+6)%7));return{kind,year,from:monday,to:addDays(monday,13)}}
 const d=new Date(today+'T00:00:00Z');d.setUTCDate(1);const from=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+2);d.setUTCDate(0)
 return{kind,year,from,to:d.toISOString().slice(0,10)}
}
export function incoming(data:ScheduleData):EventDraft{return{title:data.title,description:[data.content,'대상 학년: '+(data.grades.join('·')||'미지정'),'나이스 구분: '+data.dayKind].filter(Boolean).join('\n'),location:'',startDate:data.date,endDate:data.date,allDay:true,startTime:'',endTime:'',visibility:'school',audience:{all:true,groups:[],includeMemberIds:[],excludeMemberIds:[]}}}
// 기존 일정 입력 규칙을 그대로 사용한다. 긴 원문을 몰래 잘라 반영하지 않는다.
export function applyIssue(data:ScheduleData,member:Membership):string|null {try{normalizeDraft(incoming(data),member,[member]);return null}catch(e){return e instanceof Error?e.message:'일정 입력 기준을 확인해 주세요.'}}
export function csvCell(value:unknown):string {const s=String(value),safe=/^[\s\uFEFF]*[=+@-]/u.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"'}
export const comparedFields=['title','description','startDate','endDate'] as const
export function comparison(s:Schedule,target:CalendarEvent|null=s.current,baseline:EventDraft|null=s.baseline){
 const proposed=incoming(s.data)
 const changes=comparedFields.filter(k=>target?.[k]!==proposed[k]&&(baseline===null||proposed[k]!==baseline[k]))
 const conflicts=target?changes.filter(k=>baseline===null||(target[k]!==baseline[k]&&proposed[k]!==baseline[k])):[]
 return{proposed,changes,conflicts,state:s.dismissed?'ignored':!s.present?'missing':!s.eventId?'new':!s.current?'unavailable':changes.length?'changed':'same'}
}
export function snapshot(raw:unknown,expected:Range,member:Membership,members:Membership[]):Snapshot{
 const r=record(raw)
 for(const [k,v]of Object.entries(expected))if(r[k]!==v)return fail()
 if(r.contract!=='neis.v1'||r.schoolId!==member.schoolId||r.memberId!==member.id)return fail()
 const configured=bool(r.configured),canManage=bool(r.canManage)
 const src=r.source===null?null:record(r.source)
 const sourceInfo=src?{officeCode:str(src.officeCode,3),schoolCode:str(src.schoolCode,7),schoolName:str(src.schoolName,100)}:null
 if(sourceInfo&&(!/^[A-Z][0-9]{2}$/.test(sourceInfo.officeCode)||!/^\d{7}$/.test(sourceInfo.schoolCode)))return fail()
 if(configured&&!sourceInfo)return fail()
 if(!Array.isArray(r.rows)||r.rows.length>20000)return fail()
 const seen=new Set<string>()
 const rows=r.rows.map(rawRow=>{
  const v=record(rawRow)
  if(expected.kind==='schedule'){
   const d=record(v.data),meta=source(d)
   if(seen.has(str(v.id,200)))return fail();seen.add(v.id as string)
   if(!Array.isArray(d.grades)||d.grades.length>6||new Set(d.grades).size!==d.grades.length)return fail()
   const data:ScheduleData={...meta,date:iso(d.date),title:str(d.title,200),content:str(d.content,4000),grades:d.grades.map(g=>num(g,1,6)),dayKind:str(d.dayKind,100),course:str(d.course,100),session:str(d.session,100)}
   if(!data.title||data.date<expected.from||data.date>expected.to)return fail()
   const current=v.current===null?null:eventResponse(v.current,member.schoolId,members)
   const eventId=v.eventId===null?null:str(v.eventId,200)
   if(current?.id!==eventId&&current!==null||v.supersededBy!==null)return fail()
   // 기준판은 서버가 보관한 원본 필드만 비교한다. 임의 필드는 화면에 전파하지 않는다.
   let baseline:EventDraft|null=null
   if(v.baseline!==null){const b=record(v.baseline);baseline={...incoming(data),title:str(b.title,200),description:str(b.description,5000),startDate:iso(b.startDate),endDate:iso(b.endDate)}}
   return{id:str(v.id,200),version:num(v.version,1,999999999),data,present:bool(v.present),eventId,baseline,dismissed:bool(v.dismissed),supersededBy:null,current} as Schedule
  }
  const meta=source(v);if(seen.has(meta.identity))return fail();seen.add(meta.identity)
  if(expected.kind==='meals'){
   const date=iso(v.date),mealCode=str(v.mealCode,1)
   if(date<expected.from||date>expected.to||!['1','2','3'].includes(mealCode))return fail()
   return{...meta,date,mealCode,mealName:str(v.mealName,40),menu:str(v.menu),calories:str(v.calories,100),origins:str(v.origins),nutrition:str(v.nutrition)} as Meal
  }
  const base={...meta,grade:num(v.grade,1,3),className:str(v.className,50),session:str(v.session,100)}
  if(expected.kind==='classes')return base as SchoolClass
  const date=iso(v.date);if(date<expected.from||date>expected.to)return fail()
  return{...base,date,period:num(v.period,1,16),semester:num(v.semester,1,2),subject:str(v.subject,300)} as Lesson
 })
 if((!configured||expected.kind==='schedule'&&!canManage)&&rows.length)return fail()
 return{...expected,contract:'neis.v1',schoolId:member.schoolId,memberId:member.id,today:iso(r.today),configured,canManage,source:sourceInfo,version:num(r.version,0,999999999),fetchedAt:stamp(r.fetchedAt),errorCode:r.errorCode===null?null:str(r.errorCode,80),rows}
}
export function closed(raw:unknown,key:string,selections:Selection[],member:Membership,members:Membership[]):Closed{const r=record(raw);if(r.contract!=='neis.closed.v1'||r.schoolId!==member.schoolId||r.memberId!==member.id||r.requestKey!==key)return fail();if(r.outcome==='closed'&&r.receipt===null)return{outcome:'closed',receipt:null};if(r.outcome==='applied')return{outcome:'applied',receipt:receipt(r.receipt,key,selections,member,members)};return fail()}
export function receipt(raw:unknown,key:string,selections:Selection[],member:Membership,members:Membership[]):Receipt{
 const r=record(raw);if(r.contract!=='neis.receipt.v1'||r.schoolId!==member.schoolId||r.memberId!==member.id||r.requestKey!==key||!Array.isArray(r.items)||r.items.length!==selections.length)return fail()
 const seen=new Set<string>(),items=r.items.map(v=>{
  const x=record(v),s=selections.find(s=>s.id===x.sourceId);if(!s||seen.has(s.id))return fail();seen.add(s.id)
  if(s.decision==='ignore'&&x.decision==='ignored')return{sourceId:s.id,decision:'ignored' as const}
  if(s.decision!=='apply'||x.decision!=='applied')return fail()
  const event=eventResponse(x.event,member.schoolId,members)
  if(s.eventId!==null&&event.id!==s.eventId)return fail()
  return{sourceId:s.id,decision:'applied' as const,event}
 })
 const recordedAt=stamp(r.recordedAt);if(!recordedAt)return fail()
 return{contract:'neis.receipt.v1',schoolId:member.schoolId,memberId:member.id,requestKey:key,recordedAt,items}
}
