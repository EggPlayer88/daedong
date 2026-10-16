import limits from './operations-limits.json'
// 날짜별 이동·교환의 사전 검증이다. 서버 권한·잠금·동의 원장을 대신하지 않는다.
export const TIMETABLE_OPERATIONS_CONTRACT = 'timetable-operations.v1' as const
export type OperationKind = 'swap' | 'move' | 'substitute' | 'cancel' | 'makeup'
export interface OperationSpan { startsAt: string; endsAt: string }
export interface OperationResource { id: string; kind: 'teacher' | 'group' | 'room' | 'student'; memberId: string | null; capacity: number }
export interface OperationUse { resourceId: string; units: number }
export interface OperationMember { id: string; accountId: string; active: boolean; canApprove: boolean }
export interface DatedLesson extends OperationSpan {
  id: string; schoolId: string; version: number; courseId: string; occurrenceKey: string
  state: 'scheduled' | 'performed' | 'cancelled'; teacherMemberIds: string[]; resources: OperationUse[]; allowedSpans: OperationSpan[]
}
export interface OperationsSnapshot {
  contract: typeof TIMETABLE_OPERATIONS_CONTRACT; schoolId: string; basisRevisionId: string; revision: number; timeZone: string
  coverage: OperationSpan & { complete: boolean }; resources: OperationResource[]; members: OperationMember[]
  lessons: DatedLesson[]; unavailable: (OperationSpan & { resourceId: string })[]; closed: OperationSpan[]
}
export interface LessonMove { lessonId: string; expectedVersion: number; from: OperationSpan; to: OperationSpan }
export interface TimetableChangeProposal {
  schoolId: string; basisRevisionId: string; kind: OperationKind; requesterMemberId: string; expiresAt: string
  baseFingerprint: string; proposalFingerprint: string; moves: LessonMove[]
}
export interface OperationConsent {
  memberId: string; accountId: string; proposalFingerprint: string; baseFingerprint: string
  response: 'accepted' | 'rejected'; respondedAt: string
}
export interface OperationIssue { code: string; message: string; lessonIds: string[]; resourceIds: string[] }
export interface OperationReport {
  status: 'valid' | 'invalid' | 'stale' | 'unsupported'; issues: OperationIssue[]; requiredMemberIds: string[]
  serverRevalidationRequired: true
}
export class TimetableOperationError extends Error {
  constructor(readonly code: string) { super('시간표 변경 입력의 형식 또는 범위를 확인해 주세요.'); this.name='TimetableOperationError' }
}
const invalid=():never=>{throw new TimetableOperationError('INVALID_INPUT')}
function object(value: unknown): Record<string,unknown> { if(!value||typeof value!=='object'||Array.isArray(value))return invalid();return value as Record<string,unknown> }
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{const row=object(value);if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return invalid();return row}
function id(value:unknown):string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))return invalid();return value}
function integer(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<1)return invalid();return value as number}
function bool(value:unknown):boolean{if(typeof value!=='boolean')return invalid();return value}
function timestamp(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)return invalid()
  return value
}
function hash(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return invalid();return value}
function rows<T>(value:unknown,read:(value:unknown)=>T,max=limits.snapshotRows):T[]{if(!Array.isArray(value)||value.length>max)return invalid();return value.map(read)}
function unique<T>(values:T[]):T[]{if(new Set(values).size!==values.length)return invalid();return values}
function oneOf<T extends string>(value:unknown,values:readonly T[]):T{if(!values.includes(value as T))return invalid();return value as T}
function span(value:unknown):OperationSpan {const r=exact(value,['startsAt','endsAt']),startsAt=timestamp(r.startsAt),endsAt=timestamp(r.endsAt);if(startsAt>=endsAt)return invalid();return{startsAt,endsAt}}
const overlap=(a:OperationSpan,b:OperationSpan)=>a.startsAt<b.endsAt&&b.startsAt<a.endsAt
const contained=(item:OperationSpan,scope:OperationSpan)=>item.startsAt>=scope.startsAt&&item.endsAt<=scope.endsAt
const sameSpan=(a:OperationSpan,b:OperationSpan)=>a.startsAt===b.startsAt&&a.endsAt===b.endsAt
const sorted=<T>(values:T[],key:(value:T)=>string)=>[...values].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0)
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
  return JSON.stringify(value)
}
async function digest(value:unknown):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('')}

export function parseOperationsSnapshot(value:unknown):OperationsSnapshot {
  const r=exact(value,['contract','schoolId','basisRevisionId','revision','timeZone','coverage','resources','members','lessons','unavailable','closed'])
  if(r.contract!==TIMETABLE_OPERATIONS_CONTRACT||typeof r.timeZone!=='string')return invalid()
  try{new Intl.DateTimeFormat('en',{timeZone:r.timeZone})}catch{return invalid()}
  const schoolId=id(r.schoolId),c=exact(r.coverage,['startsAt','endsAt','complete']),coverage={...span({startsAt:c.startsAt,endsAt:c.endsAt}),complete:bool(c.complete)}
  const members=rows(r.members,value=>{const row=exact(value,['id','accountId','active','canApprove']);return{id:id(row.id),accountId:id(row.accountId),active:bool(row.active),canApprove:bool(row.canApprove)}})
  unique(members.map(item=>item.id));const memberIds=new Set(members.map(member=>member.id))
  const resources=rows(r.resources,value=>{
    const row=exact(value,['id','kind','memberId','capacity']),kind=oneOf(row.kind,['teacher','group','room','student'] as const)
    const resource={id:id(row.id),kind,memberId:row.memberId===null?null:id(row.memberId),capacity:integer(row.capacity)}
    if(kind==='teacher'?!resource.memberId||!memberIds.has(resource.memberId):resource.memberId!==null)return invalid()
    if(resource.capacity>limits.capacity||kind!=='room'&&resource.capacity!==1)return invalid()
    return resource
  })
  unique(resources.map(item=>item.id));unique(resources.filter(item=>item.kind==='teacher').map(item=>item.memberId));const resourceMap=new Map(resources.map(resource=>[resource.id,resource]))
  const lessons=rows(r.lessons,value=>{
    const row=exact(value,['id','schoolId','version','courseId','occurrenceKey','state','startsAt','endsAt','teacherMemberIds','resources','allowedSpans'])
    const teacherMemberIds=unique(rows(row.teacherMemberIds,id,limits.resourcesPerLesson)),uses=rows(row.resources,value=>{const use=exact(value,['resourceId','units']);return{resourceId:id(use.resourceId),units:integer(use.units)}},limits.resourcesPerLesson)
    unique(uses.map(use=>use.resourceId))
    if(row.schoolId!==schoolId||!teacherMemberIds.length||teacherMemberIds.some(memberId=>!memberIds.has(memberId))||!uses.length)return invalid()
    if(uses.some(use=>{const resource=resourceMap.get(use.resourceId);return !resource||use.units>resource.capacity}))return invalid()
    if(!uses.some(use=>['group','student'].includes(resourceMap.get(use.resourceId)!.kind)))return invalid()
    const allowedSpans=rows(row.allowedSpans,span,limits.allowedSpansPerLesson);if(!allowedSpans.length||allowedSpans.some(item=>!contained(item,coverage)))return invalid();unique(allowedSpans.map(canonical))
    const actualTeachers=uses.map(use=>resourceMap.get(use.resourceId)!).filter(resource=>resource.kind==='teacher').map(resource=>resource.memberId!)
    if(canonical([...teacherMemberIds].sort())!==canonical(actualTeachers.sort()))return invalid()
    const lesson={id:id(row.id),schoolId,version:integer(row.version),courseId:id(row.courseId),occurrenceKey:id(row.occurrenceKey),state:oneOf(row.state,['scheduled','performed','cancelled'] as const),...span({startsAt:row.startsAt,endsAt:row.endsAt}),teacherMemberIds,resources:uses,allowedSpans}
    if(!overlap(lesson,coverage))return invalid()
    return lesson
  })
  unique(lessons.map(item=>item.id))
  const unavailable=rows(r.unavailable,value=>{const row=exact(value,['resourceId','startsAt','endsAt']),resourceId=id(row.resourceId);if(!resourceMap.has(resourceId))return invalid();return{resourceId,...span({startsAt:row.startsAt,endsAt:row.endsAt})}})
  const closed=rows(r.closed,span)
  return{contract:TIMETABLE_OPERATIONS_CONTRACT,schoolId,basisRevisionId:id(r.basisRevisionId),revision:integer(r.revision),timeZone:r.timeZone,coverage,resources,members,lessons,unavailable,closed}
}
function normalizedSnapshot(snapshot:OperationsSnapshot):unknown {
  return {...snapshot,members:sorted(snapshot.members,m=>m.id),resources:sorted(snapshot.resources,r=>r.id),
    lessons:sorted(snapshot.lessons,l=>l.id).map(l=>({...l,teacherMemberIds:[...l.teacherMemberIds].sort(),resources:sorted(l.resources,r=>r.resourceId),allowedSpans:sorted(l.allowedSpans,r=>canonical(r))})),
    unavailable:sorted(snapshot.unavailable,r=>canonical(r)),closed:sorted(snapshot.closed,r=>canonical(r))}
}
export async function operationsBaseFingerprint(value:unknown):Promise<string>{return digest(normalizedSnapshot(parseOperationsSnapshot(value)))}
function parseChangeWithoutFingerprint(value:unknown):Omit<TimetableChangeProposal,'proposalFingerprint'>{
  const r=exact(value,['schoolId','basisRevisionId','kind','requesterMemberId','expiresAt','baseFingerprint','moves'])
  const moves=rows(r.moves,value=>{const row=exact(value,['lessonId','expectedVersion','from','to']);return{lessonId:id(row.lessonId),expectedVersion:integer(row.expectedVersion),from:span(row.from),to:span(row.to)}},limits.moves)
  unique(moves.map(move=>move.lessonId))
  return{schoolId:id(r.schoolId),basisRevisionId:id(r.basisRevisionId),kind:oneOf(r.kind,['swap','move','substitute','cancel','makeup'] as const),requesterMemberId:id(r.requesterMemberId),expiresAt:timestamp(r.expiresAt),baseFingerprint:hash(r.baseFingerprint),moves:sorted(moves,m=>m.lessonId)}
}
export async function createTimetableChangeProposal(value:unknown):Promise<TimetableChangeProposal> {
  const input=parseChangeWithoutFingerprint(value)
  return{...input,proposalFingerprint:await digest(input)}
}
function parseProposal(value:unknown):TimetableChangeProposal {
  const r=exact(value,['schoolId','basisRevisionId','kind','requesterMemberId','expiresAt','baseFingerprint','proposalFingerprint','moves'])
  const {proposalFingerprint,...rest}=r
  return{...parseChangeWithoutFingerprint(rest),proposalFingerprint:hash(proposalFingerprint)}
}
function report(status:OperationReport['status'],issues:OperationIssue[]=[],requiredMemberIds:string[]=[]):OperationReport{return{status,issues,requiredMemberIds,serverRevalidationRequired:true}}
function issue(code:string,message:string,lessonIds:string[]=[],resourceIds:string[]=[]):OperationIssue{return{code,message,lessonIds,resourceIds}}
function localDay(timestamp:string,timeZone:string):string{return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp))}
export async function validateTimetableChange(snapshotValue:unknown,proposalValue:unknown,nowValue:string):Promise<OperationReport> {
  let snapshot:OperationsSnapshot,proposal:TimetableChangeProposal,now:string
  try{snapshot=parseOperationsSnapshot(snapshotValue);proposal=parseProposal(proposalValue);now=timestamp(nowValue)}catch{return report('invalid',[issue('INVALID_INPUT','시간표 변경 입력 형식을 확인해 주세요.')])}
  if(!['move','swap'].includes(proposal.kind))return report('unsupported',[issue('UNSUPPORTED_KIND','이 검증기는 날짜별 이동과 교환만 지원합니다. 대강·휴강·보강은 별도 서버 계약이 필요합니다.')])
  if(proposal.schoolId!==snapshot.schoolId)return report('invalid',[issue('SCHOOL_MISMATCH','현재 학교의 수업만 변경할 수 있습니다.')])
  if(!snapshot.coverage.complete)return report('unsupported',[issue('COVERAGE_INCOMPLETE','변경 기간의 수업·자원·휴업 자료를 모두 확인해야 합니다.')])
  const {proposalFingerprint,...unsigned}=proposal
  if(proposalFingerprint!==await digest(unsigned))return report('invalid',[issue('PROPOSAL_TAMPERED','확인한 변경안의 내용이 달라졌습니다.')])
  if(proposal.baseFingerprint!==await operationsBaseFingerprint(snapshot)||proposal.basisRevisionId!==snapshot.basisRevisionId)return report('stale',[issue('BASIS_CHANGED','기준 자료가 바뀌었습니다. 최신 시간표로 변경안을 다시 확인해 주세요.')])
  if(proposal.expiresAt<=now)return report('stale',[issue('CHANGE_EXPIRED','변경안의 확인 기한이 지났습니다.')])
  if(proposal.kind==='move'&&proposal.moves.length!==1||proposal.kind==='swap'&&proposal.moves.length<2)return report('invalid',[issue('INVALID_MOVE_COUNT','이동은 한 수업, 교환은 두 수업 이상을 선택해 주세요.')])
  const requester=snapshot.members.find(m=>m.id===proposal.requesterMemberId)
  if(!requester?.active)return report('invalid',[issue('REQUESTER_INACTIVE','요청자의 현재 학교 소속을 확인해 주세요.')])
  const sourceLessons=proposal.moves.map(move=>snapshot.lessons.find(lesson=>lesson.id===move.lessonId))
  if(sourceLessons.some(lesson=>!lesson))return report('stale',[issue('LESSON_MISSING','변경할 수업을 최신 자료에서 찾지 못했습니다.')])
  const lessons=sourceLessons as DatedLesson[]
  if(!lessons.some(lesson=>lesson.teacherMemberIds.includes(requester.id)))return report('invalid',[issue('REQUESTER_NOT_PARTICIPANT','본인이 담당하는 수업이 포함된 변경안을 요청해 주세요.')])
  const requiredMemberIds=unique([...new Set(lessons.flatMap(lesson=>lesson.teacherMemberIds))]).sort()
  if(requiredMemberIds.some(memberId=>!snapshot.members.some(m=>m.id===memberId&&m.active)))return report('stale',[issue('PARTICIPANT_INACTIVE','관련 교사의 소속 상태를 다시 확인해 주세요.')],requiredMemberIds)
  const issues:OperationIssue[]=[]
  for(const move of proposal.moves){
    const original=lessons.find(lesson=>lesson.id===move.lessonId)!
    if(original.version!==move.expectedVersion||!sameSpan(original,move.from))return report('stale',[issue('LESSON_CHANGED','수업의 판 또는 원래 시간이 달라졌습니다.',[original.id])],requiredMemberIds)
    if(original.state!=='scheduled')issues.push(issue('LESSON_NOT_SCHEDULED','이미 실시하거나 취소한 수업은 이 변경 경로로 옮기지 않습니다.',[original.id]))
    if(original.startsAt<=now||move.to.startsAt<=now)issues.push(issue('PAST_LESSON','이미 시작한 수업 또는 과거 시각으로 변경할 수 없습니다.',[original.id]))
    if(!contained(move.from,snapshot.coverage)||!contained(move.to,snapshot.coverage))issues.push(issue('OUTSIDE_COVERAGE','변경 전후 전체 시간이 조회 범위 안에 있어야 합니다.',[original.id]))
    if(!original.allowedSpans.some(allowed=>sameSpan(allowed,move.to)))issues.push(issue('TARGET_NOT_ALLOWED','이 수업이 배정될 수 있는 공식 일과의 시간대를 선택해 주세요.',[original.id]))
    if(sameSpan(move.from,move.to))issues.push(issue('NO_CHANGE','원래 시간과 같은 변경은 요청하지 않습니다.',[original.id]))
    if(Date.parse(move.from.endsAt)-Date.parse(move.from.startsAt)!==Date.parse(move.to.endsAt)-Date.parse(move.to.startsAt))issues.push(issue('DURATION_CHANGED','수업 길이를 유지하는 이동·교환만 지원합니다.',[original.id]))
    // 이 계약은 하루 안에 끝나는 수업만 처리한다. 자정 경계 종료는 앞날 수업이다.
    const lastInstant=new Date(Date.parse(move.to.endsAt)-1).toISOString()
    if(localDay(move.to.startsAt,snapshot.timeZone)!==localDay(lastInstant,snapshot.timeZone))issues.push(issue('OVERNIGHT_UNSUPPORTED','날짜를 넘기는 수업은 별도 일과 검증이 필요합니다.',[original.id]))
    if(snapshot.closed.some(closed=>overlap(closed,move.to)))issues.push(issue('SCHOOL_CLOSED','휴업 또는 수업 불가 시간입니다.',[original.id]))
  }
  if(proposal.kind==='swap'){
    const sources=proposal.moves.map(move=>canonical(move.from)).sort(),destinations=proposal.moves.map(move=>canonical(move.to)).sort()
    if(canonical(sources)!==canonical(destinations))issues.push(issue('SWAP_NOT_PERMUTATION','교환은 선택한 수업의 원래 시간들을 서로 바꾸는 변경이어야 합니다.',proposal.moves.map(move=>move.lessonId)))
  }
  if(issues.length)return report('invalid',issues,requiredMemberIds)
  const finalLessons=snapshot.lessons.filter(lesson=>lesson.state!=='cancelled').map(lesson=>{const move=proposal.moves.find(move=>move.lessonId===lesson.id);return move?{...lesson,...move.to}:lesson})
  const movedIds=new Set(proposal.moves.map(move=>move.lessonId))
  for(const lesson of finalLessons.filter(lesson=>movedIds.has(lesson.id))){
    for(const blocked of snapshot.unavailable)if(lesson.resources.some(use=>use.resourceId===blocked.resourceId)&&overlap(lesson,blocked))issues.push(issue('RESOURCE_UNAVAILABLE','해당 시간에 사용할 수 없는 교사·공간·수업 자원입니다.',[lesson.id],[blocked.resourceId]))
  }
  const affectedResources=new Set(lessons.flatMap(lesson=>lesson.resources.map(use=>use.resourceId)))
  for(const resource of snapshot.resources.filter(resource=>affectedResources.has(resource.id))){
    const events=finalLessons.flatMap(lesson=>lesson.resources.filter(use=>use.resourceId===resource.id).flatMap(use=>[
      {at:lesson.startsAt,delta:use.units,lesson},{at:lesson.endsAt,delta:-use.units,lesson}]))
      .sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:a.delta-b.delta)
    const active=new Map<string,DatedLesson>();let total=0,movedCount=0
    for(let index=0;index<events.length;){
      const at=events[index].at
      while(index<events.length&&events[index].at===at){const event=events[index++];total+=event.delta
        if(event.delta<0){active.delete(event.lesson.id);if(movedIds.has(event.lesson.id))movedCount--}
        else{active.set(event.lesson.id,event.lesson);if(movedIds.has(event.lesson.id))movedCount++}}
      // 같은 시각의 종료와 시작을 함께 처리하므로 인접 수업은 겹치지 않는다.
      if(index<events.length&&total>resource.capacity&&movedCount>0){
        const lessonIds=[...active.keys()].sort()
        if(!issues.some(item=>item.code==='RESOURCE_CONFLICT'&&item.resourceIds[0]===resource.id&&canonical(item.lessonIds)===canonical(lessonIds)))issues.push(issue('RESOURCE_CONFLICT','같은 시간의 교사·학생집단·공간 사용이 겹칩니다.',lessonIds,[resource.id]))
      }
    }
  }
  return report(issues.length?'invalid':'valid',issues,requiredMemberIds)
}
function parseConsent(value:unknown):OperationConsent{
  const r=exact(value,['memberId','accountId','proposalFingerprint','baseFingerprint','response','respondedAt'])
  return{memberId:id(r.memberId),accountId:id(r.accountId),proposalFingerprint:hash(r.proposalFingerprint),baseFingerprint:hash(r.baseFingerprint),response:oneOf(r.response,['accepted','rejected'] as const),respondedAt:timestamp(r.respondedAt)}
}
// 동의의 진위와 최종 승인 권한은 서버가 확인한다. 이 함수는 현재 조회한 원장의 일관성만 검사한다.
export async function validateTimetableApproval(snapshotValue:unknown,proposalValue:unknown,consentsValue:unknown,approverMemberId:string,nowValue:string):Promise<OperationReport>{
  const validation=await validateTimetableChange(snapshotValue,proposalValue,nowValue)
  if(validation.status!=='valid')return validation
  const snapshot=parseOperationsSnapshot(snapshotValue),proposal=parseProposal(proposalValue)
  let consents:OperationConsent[]
  try{consents=rows(consentsValue,parseConsent);unique(consents.map(consent=>consent.memberId));id(approverMemberId)}catch{return report('invalid',[issue('INVALID_CONSENT','동의 원장의 형식을 확인해 주세요.')],validation.requiredMemberIds)}
  const approver=snapshot.members.find(member=>member.id===approverMemberId),requester=snapshot.members.find(member=>member.id===proposal.requesterMemberId)!
  if(!approver?.active||!approver.canApprove)return report('invalid',[issue('APPROVER_REQUIRED','현재 승인 권한을 가진 담당자가 확인해야 합니다.')],validation.requiredMemberIds)
  if(approver.accountId===requester.accountId)return report('invalid',[issue('SELF_APPROVAL_DENIED','본인이 요청한 변경은 지정 대리 승인자가 확인해야 합니다.')],validation.requiredMemberIds)
  if(consents.some(consent=>!validation.requiredMemberIds.includes(consent.memberId)))return report('invalid',[issue('UNEXPECTED_CONSENT','이 변경안의 참여자가 아닌 동의가 포함되어 있습니다.')],validation.requiredMemberIds)
  const issues:OperationIssue[]=[]
  for(const memberId of validation.requiredMemberIds){
    const consent=consents.find(consent=>consent.memberId===memberId),member=snapshot.members.find(member=>member.id===memberId)!
    if(!consent){issues.push(issue('CONSENT_MISSING','관련 교사 모두의 명시적인 동의가 필요합니다.'));continue}
    if(consent.accountId!==member.accountId||consent.proposalFingerprint!==proposal.proposalFingerprint||consent.baseFingerprint!==proposal.baseFingerprint||consent.respondedAt>nowValue||consent.respondedAt>=proposal.expiresAt)issues.push(issue('CONSENT_STALE','현재 변경안과 정확히 일치하는 동의를 다시 받아야 합니다.'))
    else if(consent.response!=='accepted')issues.push(issue('CONSENT_REJECTED','관련 교사가 거절한 변경안은 반영할 수 없습니다.'))
  }
  return report(issues.some(item=>item.code==='CONSENT_STALE')?'stale':issues.length?'invalid':'valid',issues,validation.requiredMemberIds)
}
