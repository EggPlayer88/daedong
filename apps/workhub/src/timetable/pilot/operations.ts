import {validatePilotFixture, type PilotFixture} from './fixture'
import {validateTimetableReplacementPreview,type TimetableReplacementPreview} from './timetable-replacement'
import {
  PILOT_MANAGER_IDS,PILOT_OPERATIONS_SCHEMA,PilotOperationError,
  type PilotCommand,type PilotCommandResult,type PilotEdit,type PilotEnvelope,type PilotLesson,
  type PilotProposal,type PilotState,type PilotSwapRecommendation,
} from './operations-contracts'
export * from './operations-contracts'

const fail=(code:ConstructorParameters<typeof PilotOperationError>[0],message:string):never=>{throw new PilotOperationError(code,message)}
const clone=<T>(value:T):T=>structuredClone(value)
const MAX_COMMANDS=5000
const unique=(values:string[])=>[...new Set(values)].sort()
const equal=(a:unknown,b:unknown)=>pilotCanonical(a)===pilotCanonical(b)
export function pilotCanonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(pilotCanonical).join(',')+']'
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+pilotCanonical((value as Record<string,unknown>)[key])).join(',')+'}'
  return JSON.stringify(value)
}
export async function pilotDigest(value:unknown):Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pilotCanonical(value)))
  return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('')
}
function day(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)return fail('INVALID_INPUT','날짜를 확인해 주세요.')
  return value
}
function text(value:unknown,max=1000):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(value))return fail('INVALID_INPUT','입력한 글자와 길이를 확인해 주세요.')
  return value.trim()
}
function id(value:unknown):string {const result=text(value,140);if(!/^[A-Za-z0-9_:-]+$/.test(result))return fail('INVALID_INPUT','연습 자료 번호를 확인해 주세요.');return result}
function positive(value:unknown):number {if(!Number.isSafeInteger(value)||(value as number)<1)return fail('INVALID_INPUT','판 또는 교시를 확인해 주세요.');return value as number}
function object(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))return fail('INVALID_INPUT','자료 형식을 확인해 주세요.');return value as Record<string,unknown>}
function exact(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown> {
  const result=object(value)
  if(required.some(key=>!Object.hasOwn(result,key))||Object.keys(result).some(key=>!required.includes(key)&&!optional.includes(key)))return fail('INVALID_INPUT','지원하지 않는 연습 자료 항목이 있습니다.')
  return result
}
function ids(value:unknown,max=100):string[]{if(!Array.isArray(value)||!value.length||value.length>max)return fail('INVALID_INPUT','대상을 선택해 주세요.');const result=value.map(id);if(unique(result).length!==result.length)return fail('INVALID_INPUT','같은 대상을 중복 선택했습니다.');return result}
function time(value:unknown):string {if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return fail('INVALID_INPUT','수업 시각을 확인해 주세요.');return value}
function slots(value:unknown):{period:number;startTime:string;endTime:string}[] {
  if(!Array.isArray(value)||!value.length||value.length>20)return fail('INVALID_INPUT','일과를 확인해 주세요.')
  const result=value.map(item=>{const r=exact(item,['period','startTime','endTime']);const s={period:positive(r.period),startTime:time(r.startTime),endTime:time(r.endTime)};if(s.startTime>=s.endTime)return fail('INVALID_INPUT','수업 종료 시각은 시작 시각보다 늦어야 합니다.');return s}).sort((a,b)=>a.period-b.period)
  if(new Set(result.map(row=>row.period)).size!==result.length||result.some((row,index)=>index>0&&row.startTime<result[index-1].endTime))return fail('INVALID_INPUT','일과의 교시 또는 시각이 겹칩니다.')
  return result
}
export function parsePilotCommand(value:unknown):PilotCommand {
  const type=object(value).type
  if(type==='propose'){
    const r=exact(value,['type','kind','lessonIds','reason'],['targetDate','targetPeriod','substituteTeacherId'])
    if(!['swap','move','substitute','cancel','makeup'].includes(String(r.kind)))return fail('INVALID_INPUT','변경 종류를 확인해 주세요.')
    const kind=r.kind as 'swap'|'move'|'substitute'|'cancel'|'makeup'
    const result:PilotCommand={type,kind,lessonIds:ids(r.lessonIds,2),reason:text(r.reason)}
    if(r.targetDate!==undefined)result.targetDate=day(r.targetDate)
    if(r.targetPeriod!==undefined)result.targetPeriod=positive(r.targetPeriod)
    if(r.substituteTeacherId!==undefined)result.substituteTeacherId=id(r.substituteTeacherId)
    if(result.lessonIds.length!==(kind==='swap'?2:1))return fail('INVALID_INPUT','교환은 두 수업, 나머지는 한 수업을 선택해 주세요.')
    if((kind==='move'||kind==='makeup')?result.targetDate===undefined||result.targetPeriod===undefined:result.targetDate!==undefined||result.targetPeriod!==undefined)return fail('INVALID_INPUT','변경할 날짜와 교시를 확인해 주세요.')
    if(kind==='substitute'?!result.substituteTeacherId:result.substituteTeacherId!==undefined)return fail('INVALID_INPUT','대강 교사를 확인해 주세요.')
    return result
  }
  if(type==='consent'){
    const r=exact(value,['type','proposalId','decision'])
    if(r.decision!=='accepted'&&r.decision!=='rejected')return fail('INVALID_INPUT','수락 또는 반려를 선택해 주세요.')
    return{type,proposalId:id(r.proposalId),decision:r.decision}
  }
  if(type==='approve'||type==='withdraw'){const r=exact(value,['type','proposalId']);return{type,proposalId:id(r.proposalId)}}
  if(type==='reject'){const r=exact(value,['type','proposalId','reason']);return{type,proposalId:id(r.proposalId),reason:text(r.reason)}}
  if(type==='school_day'){
    const r=exact(value,['type','date','classIds','closed','reason'])
    if(typeof r.closed!=='boolean')return fail('INVALID_INPUT','휴업 여부를 확인해 주세요.')
    return{type,date:day(r.date),classIds:ids(r.classIds),closed:r.closed,reason:text(r.reason)}
  }
  if(type==='special_day'){const r=exact(value,['type','date','classIds','slots','reason']);return{type,date:day(r.date),classIds:ids(r.classIds),slots:slots(r.slots),reason:text(r.reason)}}
  if(type==='record'){
    const r=exact(value,['type','lessonId','expectedLessonVersion','note'])
    if(typeof r.note!=='string'||r.note.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.note))return fail('INVALID_INPUT','실시 기록은 2,000자 이내로 입력해 주세요.')
    return{type,lessonId:id(r.lessonId),expectedLessonVersion:positive(r.expectedLessonVersion),note:r.note}
  }
  if(type==='read_notification'){const r=exact(value,['type','id']);return{type,id:id(r.id)}}
  if(type==='replace_timetable'){const r=exact(value,['type','preview','reviewDate','reason']);object(r.preview);return{type,preview:clone(r.preview) as TimetableReplacementPreview,reviewDate:day(r.reviewDate),reason:text(r.reason)}}
  return fail('INVALID_INPUT','지원하지 않는 연습 명령입니다.')
}
function envelope(value:unknown):PilotEnvelope {
  const r=exact(value,['requestId','actorId','expectedRevision','command'])
  const requestId=id(r.requestId)
  if(requestId.length>100)fail('INVALID_INPUT','요청 번호는 100자 이내여야 합니다.')
  return{requestId,actorId:id(r.actorId),expectedRevision:positive(r.expectedRevision),command:parsePilotCommand(r.command)}
}
function actor(state:PilotState,actorId:string):void {
  if(!state.fixture.teachers.some(teacher=>teacher.id===actorId)&&!PILOT_MANAGER_IDS.includes(actorId as typeof PILOT_MANAGER_IDS[number]))fail('FORBIDDEN','연습 역할을 다시 선택해 주세요.')
}
function manager(actorId:string):void {if(!PILOT_MANAGER_IDS.includes(actorId as typeof PILOT_MANAGER_IDS[number]))fail('FORBIDDEN','시간표 담당자 연습 역할에서 처리해 주세요.')}
function inRange(state:PilotState,date:string):void {day(date);if(date<state.fixture.dateRange.startsOn||date>state.fixture.dateRange.endsOn)fail('INVALID_INPUT','연습 학기 안의 날짜를 선택해 주세요.')}
function lesson(state:PilotState,lessonId:string):PilotLesson {return state.lessons.find(item=>item.id===lessonId)??fail('NOT_FOUND','수업을 찾지 못했습니다.')}
function proposal(state:PilotState,proposalId:string):PilotProposal {return state.proposals.find(item=>item.id===proposalId)??fail('NOT_FOUND','요청을 찾지 못했습니다.')}
function checkClasses(state:PilotState,classIds:string[]):void {if(classIds.some(id=>!state.fixture.classes.some(item=>item.id===id)))fail('INVALID_INPUT','현재 학교 연습 학급만 선택할 수 있습니다.')}
function slotFor(state:PilotState,date:string,period:number,classIds:string[]):{period:number;startTime:string;endTime:string} {
  inRange(state,date)
  const applicable=classIds.map(classId=>[...state.specialDays].reverse().find(item=>item.date===date&&item.classIds.includes(classId))?.slots??state.fixture.daySlots)
  const found=applicable.map(items=>items.find(item=>item.period===period))
  if(found.some(item=>!item))return fail('INVALID_INPUT','선택한 날짜에 없는 교시입니다.')
  if(found.some(item=>!equal(item,found[0])))return fail('INVALID_INPUT','합반 학급의 특별 일과가 서로 다릅니다.')
  return found[0]!
}
function isClosed(state:PilotState,item:PilotLesson):boolean {
  const closed=new Set(state.closedDays.filter(day=>day.date===item.date).flatMap(day=>day.classIds))
  const count=item.classIds.filter(classId=>closed.has(classId)).length
  if(count>0&&count<item.classIds.length)fail('PARTIAL_CLOSURE','휴업한 학급과 수업하는 학급이 섞인 합반입니다. 학사 변경 범위를 먼저 확인해 주세요.')
  return count===item.classIds.length
}
function overlap(a:PilotLesson,b:PilotLesson):boolean {return a.date===b.date&&a.startTime<b.endTime&&b.startTime<a.endTime}
function validateChangedLessons(state:PilotState,edits:PilotEdit[]):void {
  const changed=new Map(edits.map(edit=>[edit.lessonId,edit.after]))
  const combined=[...state.lessons.filter(item=>!changed.has(item.id)),...edits.map(edit=>edit.after)]
  const alive=combined.filter(item=>item.status!=='cancelled')
  const byDate=new Map<string,PilotLesson[]>()
  for(const item of alive){const rows=byDate.get(item.date)??[];rows.push(item);byDate.set(item.date,rows)}
  for(const edit of edits){
    const after=edit.after
    if(after.status==='cancelled')continue
    if(isClosed(state,after))fail('SCHOOL_CLOSED','휴업하는 학급의 수업을 배치할 수 없습니다.')
    const formal=slotFor(state,after.date,after.period,after.classIds)
    if(after.startTime!==formal.startTime||after.endTime!==formal.endTime)fail('INVALID_INPUT','현재 일과와 수업 시각이 다릅니다.')
    if(!state.fixture.teachers.some(item=>item.id===after.teacherId))fail('INVALID_INPUT','연습 교사를 찾지 못했습니다.')
    const sameDay=byDate.get(after.date)??[]
    for(const other of sameDay){
      if(other.id===after.id||!overlap(after,other))continue
      if(other.teacherId===after.teacherId||other.classIds.some(id=>after.classIds.includes(id)))fail('RESOURCE_CONFLICT','같은 시간의 교사 또는 학급 수업이 겹칩니다.')
    }
    const room=state.fixture.rooms.find(room=>room.id===after.roomId)
    if(!room)fail('INVALID_INPUT','수업 공간을 찾지 못했습니다.')
    const simultaneous=sameDay.filter(item=>item.roomId===after.roomId&&overlap(after,item))
    // 단순 개수 대신 각 시점의 동시 사용량을 검사한다.
    const points=simultaneous.flatMap(item=>[{at:item.startTime,delta:1},{at:item.endTime,delta:-1}]).sort((a,b)=>a.at.localeCompare(b.at)||a.delta-b.delta)
    let count=0
    for(const point of points){count+=point.delta;if(count>room!.capacity)fail('RESOURCE_CONFLICT','공간의 동시 수업 수를 초과합니다.')}
  }
}
function currentEdits(state:PilotState,p:PilotProposal):void {
  for(const edit of p.edits){
    const current=state.lessons.find(item=>item.id===edit.lessonId)
    if(edit.before===null){if(current)fail('MAKEUP_EXISTS','이미 보강 수업이 있습니다.')}
    else if(!current||current.version!==edit.expectedVersion||!equal(current,edit.before))fail('LESSON_CHANGED','요청 후 원수업이 바뀌었습니다. 기존 요청을 철회하고 다시 확인해 주세요.')
    if(edit.after.originLessonId){
      const origin=lesson(state,edit.after.originLessonId)
      if(origin.status!=='cancelled')fail('LESSON_CHANGED','보강의 원수업이 더 이상 휴강 상태가 아닙니다.')
      if(edit.before===null&&origin.version!==edit.expectedVersion)fail('LESSON_CHANGED','보강 요청 후 원수업 판이 바뀌었습니다. 요청을 다시 작성해 주세요.')
      if(state.lessons.some(item=>item.originLessonId===origin.id&&item.status!=='cancelled'&&item.id!==edit.after.id))fail('MAKEUP_EXISTS','해당 원수업에 연결된 보강이 이미 있습니다.')
    }
  }
  validateChangedLessons(state,p.edits)
}
function notify(state:PilotState,recipients:string[],kind:'request'|'decision'|'changed'|'school_day',title:string,entityId:string|null,lessonIds:string[]):void {
  for(const recipientId of unique(recipients)){
    const noticeId=`notice:${state.revision}:${state.notifications.length+1}`
    state.notifications.push({id:noticeId,recipientId,kind,title,proposalId:entityId,lessonIds:[...lessonIds],revision:state.revision,read:false})
  }
}
function makeEdits(state:PilotState,command:Extract<PilotCommand,{type:'propose'}>,requestId:string):PilotEdit[] {
  const originals=command.lessonIds.map(id=>lesson(state,id))
  if(originals.some(item=>item.status==='performed'))fail('ALREADY_PERFORMED','이미 실시한 수업을 변경할 수 없습니다.')
  if(command.kind==='makeup'){
    const source=originals[0]
    if(source.status!=='cancelled')fail('INVALID_INPUT','휴강 또는 휴업한 원수업에서 보강을 만들어 주세요.')
    if(state.lessons.some(item=>item.originLessonId===source.id&&item.status!=='cancelled'))fail('MAKEUP_EXISTS','이 원수업의 보강이 이미 있습니다.')
    if(source.originLessonId)fail('INVALID_INPUT','보강을 다시 만들 때는 최초 원수업에서 요청해 주세요.')
    const slot=slotFor(state,command.targetDate!,command.targetPeriod!,source.classIds)
    return[{lessonId:`makeup:${requestId}`,expectedVersion:source.version,before:null,after:{...clone(source),...slot,id:`makeup:${requestId}`,originLessonId:source.id,date:command.targetDate!,status:'scheduled',cancellation:null,version:1}}]
  }
  if(originals.some(item=>item.status!=='scheduled'))fail('INVALID_INPUT','예정된 수업만 변경할 수 있습니다.')
  const edits=originals.map(source=>({lessonId:source.id,expectedVersion:source.version,before:clone(source),after:{...clone(source),version:source.version+1}}))
  if(command.kind==='swap'){
    if(originals[0].date===originals[1].date&&originals[0].period===originals[1].period)fail('INVALID_INPUT','원래 시간이 다른 수업을 선택해 주세요.')
    edits.forEach((edit,index)=>{const target=originals[1-index];const slot=slotFor(state,target.date,target.period,edit.after.classIds);edit.after={...edit.after,...slot,date:target.date}})
  }else if(command.kind==='move'){
    const slot=slotFor(state,command.targetDate!,command.targetPeriod!,edits[0].after.classIds)
    edits[0].after={...edits[0].after,...slot,date:command.targetDate!}
    if(edits[0].before!.date===command.targetDate&&edits[0].before!.period===command.targetPeriod)fail('INVALID_INPUT','원래 시간과 같습니다.')
  }else if(command.kind==='substitute'){
    if(edits[0].after.teacherId===command.substituteTeacherId)fail('INVALID_INPUT','대강 교사가 원래 담당 교사와 같습니다.')
    edits[0].after.teacherId=command.substituteTeacherId!
  }else{edits[0].after.status='cancelled';edits[0].after.cancellation='requested'}
  // 이동·교환으로 시수가 달라지는 것을 막는다. 특별 일과 조정은 별도 경로다.
  if(command.kind==='swap'||command.kind==='move'){
    const duration=(item:PilotLesson)=>Number(item.endTime.slice(0,2))*60+Number(item.endTime.slice(3))-Number(item.startTime.slice(0,2))*60-Number(item.startTime.slice(3))
    if(edits.some(edit=>duration(edit.before!)!==duration(edit.after)))fail('INVALID_INPUT','수업 길이가 다른 교시로 이동할 수 없습니다.')
  }
  return edits
}
export function createPilotState(fixtureValue:PilotFixture):PilotState {
  const fixture=validatePilotFixture(fixtureValue)
  const lessons:PilotLesson[]=[]
  for(let stamp=Date.parse(fixture.dateRange.startsOn+'T00:00:00Z');stamp<=Date.parse(fixture.dateRange.endsOn+'T00:00:00Z');stamp+=86400000){
    const date=new Date(stamp),dateKey=date.toISOString().slice(0,10)
    for(const template of fixture.lessons.filter(item=>item.weekday===date.getUTCDay())){
      const slot=fixture.daySlots.find(item=>item.period===template.period)!
      lessons.push({id:`lesson:${dateKey}:${template.id}`,templateId:template.id,originLessonId:null,date:dateKey,period:template.period,startTime:slot.startTime,endTime:slot.endTime,teacherId:template.teacherId,classIds:[...template.classIds],roomId:template.roomId,subject:template.subject,status:'scheduled',cancellation:null,version:1})
    }
  }
  if(lessons.length>20000)fail('CAPACITY_EXCEEDED','연습 학기 자료가 너무 큽니다.')
  return{schema:PILOT_OPERATIONS_SCHEMA,simulated:true,fixture:clone(fixture),revision:1,lessons,proposals:[],notifications:[],history:[],records:[],receipts:[],closedDays:[],specialDays:[],timetableVersions:[]}
}
async function transact(state:PilotState,input:PilotEnvelope):Promise<{entityId:string|null;summary:string;lessonIds:string[]}> {
  const command=input.command
  if(command.type==='replace_timetable'){
    manager(input.actorId)
    const preview=await validateTimetableReplacementPreview(state.fixture,command.preview,command.reviewDate)
    const from=preview.effectiveFrom
    if(state.timetableVersions.some(row=>row.effectiveFrom>=from))fail('CONFLICT','이미 교체한 기준판 이후 날짜부터 새 시간표를 적용해 주세요.')
    if(state.proposals.some(p=>['awaiting_consent','awaiting_approval'].includes(p.status)&&p.edits.some(edit=>(edit.before?.date??edit.after.date)>=from||edit.after.date>=from)))fail('CONFLICT','적용 기간에 대기 중인 변경 요청이 있습니다. 수락·승인 또는 철회를 먼저 마쳐 주세요.')
    if(state.lessons.some(item=>item.date>=from&&(item.version!==1||item.status!=='scheduled'||item.originLessonId!==null)))fail('CONFLICT','적용 기간에 변경·실시·보강 이력이 있습니다. 그 이후 날짜를 선택해 이력을 보존해 주세요.')
    if(state.closedDays.some(row=>row.date>=from)||state.specialDays.some(row=>row.date>=from))fail('CONFLICT','적용 기간에 학사 변경이 있습니다. 그 이후 날짜부터 교체해 주세요.')
    const previousFixture=clone(state.fixture)
    state.fixture=validatePilotFixture({...state.fixture,revision:state.fixture.revision+1,lessons:preview.lessons})
    const generated=createPilotState(state.fixture).lessons.filter(item=>item.date>=from)
    state.lessons=[...state.lessons.filter(item=>item.date<from),...generated]
    state.timetableVersions.push({revision:state.revision,effectiveFrom:from,previewFingerprint:preview.previewFingerprint,previousFixture})
    notify(state,state.fixture.teachers.map(item=>item.id),'changed',`${from}부터 새 학기 시간표 기준이 적용됩니다`,null,[])
    return{entityId:null,summary:`${from} 이후 시간표 교체: ${command.reason}. 이전 수업·접수·실시 이력은 보존했습니다.`,lessonIds:[]}
  }
  if(command.type==='propose'){
    const edits=makeEdits(state,command,input.requestId)
    const sources=command.lessonIds.map(id=>lesson(state,id))
    if(!sources.some(item=>item.teacherId===input.actorId))fail('FORBIDDEN','담당 교사 연습 역할에서 본인 수업의 변경을 요청해 주세요.')
    validateChangedLessons(state,edits)
    const requiredTeacherIds=unique([...sources.map(item=>item.teacherId),...edits.map(edit=>edit.after.teacherId)])
    const entityId=`proposal:${input.requestId}`
    state.proposals.push({id:entityId,kind:command.kind,requesterId:input.actorId,reason:command.reason,status:'awaiting_consent',edits,requiredTeacherIds,consents:[],approvedBy:null,createdRevision:state.revision,resolvedRevision:null})
    notify(state,requiredTeacherIds,'request','시간표 변경 수락 요청',entityId,edits.map(edit=>edit.lessonId))
    return{entityId,summary:'변경 요청을 만들었습니다. 모든 영향 교사의 역할별 수락이 필요합니다.',lessonIds:edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='consent'){
    const p=proposal(state,command.proposalId)
    if(p.status!=='awaiting_consent'&&p.status!=='awaiting_approval')fail('CONFLICT','이미 끝난 요청입니다.')
    if(!p.requiredTeacherIds.includes(input.actorId))fail('FORBIDDEN','이 요청의 영향 교사만 수락하거나 반려할 수 있습니다.')
    if(command.decision==='accepted')currentEdits(state,p)
    if(p.consents.some(item=>item.teacherId===input.actorId))fail('CONFLICT','이미 응답했습니다. 같은 요청 번호로 결과를 다시 확인할 수 있습니다.')
    p.consents.push({teacherId:input.actorId,decision:command.decision,revision:state.revision})
    if(command.decision==='rejected'){p.status='rejected';p.resolvedRevision=state.revision;notify(state,[p.requesterId],'decision','시간표 변경이 반려되었습니다',p.id,p.edits.map(edit=>edit.lessonId))}
    else if(p.requiredTeacherIds.every(id=>p.consents.some(item=>item.teacherId===id&&item.decision==='accepted'))){p.status='awaiting_approval';notify(state,[...PILOT_MANAGER_IDS],'request','시간표 담당자 승인 요청',p.id,p.edits.map(edit=>edit.lessonId))}
    return{entityId:p.id,summary:command.decision==='accepted'?'영향 교사 수락을 연습했습니다.':'영향 교사 반려를 연습했습니다.',lessonIds:p.edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='approve'){
    const p=proposal(state,command.proposalId)
    if(p.requesterId===input.actorId)fail('SELF_APPROVAL','요청한 역할과 다른 담당자 역할이 승인해야 합니다.')
    manager(input.actorId)
    if(p.status!=='awaiting_approval'||!p.requiredTeacherIds.every(id=>p.consents.some(item=>item.teacherId===id&&item.decision==='accepted')))fail('CONSENT_REQUIRED','영향 교사 모두의 수락 후 승인할 수 있습니다.')
    currentEdits(state,p)
    for(const edit of p.edits){const index=state.lessons.findIndex(item=>item.id===edit.lessonId);if(index<0)state.lessons.push(clone(edit.after));else state.lessons[index]=clone(edit.after)}
    p.status='approved';p.approvedBy=input.actorId;p.resolvedRevision=state.revision
    notify(state,p.requiredTeacherIds,'changed','승인한 시간표 변경이 반영되었습니다',p.id,p.edits.map(edit=>edit.lessonId))
    return{entityId:p.id,summary:'별도 시간표 담당자 역할로 승인하고 연습 시간표에 반영했습니다.',lessonIds:p.edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='withdraw'){
    const p=proposal(state,command.proposalId)
    if(input.actorId!==p.requesterId)fail('FORBIDDEN','요청한 역할만 철회할 수 있습니다.')
    if(p.status!=='awaiting_consent'&&p.status!=='awaiting_approval')fail('CONFLICT','이미 끝난 요청은 철회할 수 없습니다.')
    p.status='withdrawn';p.resolvedRevision=state.revision
    notify(state,p.requiredTeacherIds,'decision','시간표 변경 요청이 철회되었습니다',p.id,p.edits.map(edit=>edit.lessonId))
    return{entityId:p.id,summary:'미반영 요청을 철회했습니다.',lessonIds:p.edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='reject'){
    manager(input.actorId)
    const p=proposal(state,command.proposalId)
    if(p.status!=='awaiting_consent'&&p.status!=='awaiting_approval')fail('CONFLICT','이미 끝난 요청입니다.')
    p.status='rejected';p.resolvedRevision=state.revision
    notify(state,p.requiredTeacherIds,'decision','시간표 담당자가 요청을 반려했습니다',p.id,p.edits.map(edit=>edit.lessonId))
    return{entityId:p.id,summary:`담당자 반려: ${command.reason}`,lessonIds:p.edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='school_day'||command.type==='special_day'){
    manager(input.actorId);inRange(state,command.date);checkClasses(state,command.classIds)
    const affected=state.lessons.filter(item=>item.date===command.date&&item.classIds.some(id=>command.classIds.includes(id)))
    if(affected.some(item=>item.status==='performed'))fail('ALREADY_PERFORMED','실시 기록이 있는 수업을 포함한 일과를 바꿀 수 없습니다.')
    const before=affected.map(clone)
    if(command.type==='school_day'){
      for(const row of state.closedDays.filter(item=>item.date===command.date))row.classIds=row.classIds.filter(id=>!command.classIds.includes(id))
      state.closedDays=state.closedDays.filter(item=>item.classIds.length>0)
      if(command.closed)state.closedDays.push({date:command.date,classIds:[...command.classIds],reason:command.reason})
    }else{
      if(command.slots.length!==state.fixture.daySlots.length||state.fixture.daySlots.some(slot=>!command.slots.some(item=>item.period===slot.period)))fail('INVALID_INPUT','특별 일과에는 기존 모든 교시를 넣어 주세요. 휴강은 별도 요청으로 처리합니다.')
      for(const row of state.specialDays.filter(item=>item.date===command.date))row.classIds=row.classIds.filter(id=>!command.classIds.includes(id))
      state.specialDays=state.specialDays.filter(item=>item.classIds.length>0)
      state.specialDays.push({date:command.date,classIds:[...command.classIds],slots:clone(command.slots),reason:command.reason})
    }
    for(const item of affected){
      const closed=isClosed(state,item)
      if(closed&&item.status==='scheduled'){item.status='cancelled';item.cancellation='school_day'}
      else if(!closed&&item.status==='cancelled'&&item.cancellation==='school_day'){
        if(state.lessons.some(other=>other.originLessonId===item.id&&other.status!=='cancelled'))fail('MAKEUP_EXISTS','보강이 연결된 휴업 수업은 바로 복원할 수 없습니다. 보강을 먼저 정리해 주세요.')
        item.status='scheduled';item.cancellation=null
      }
      if(command.type==='special_day'){const slot=slotFor(state,item.date,item.period,item.classIds);item.startTime=slot.startTime;item.endTime=slot.endTime}
      const old=before.find(row=>row.id===item.id)!
      if(!equal(old,item))item.version++
    }
    const edits=affected.filter(item=>!equal(item,before.find(row=>row.id===item.id))).map(item=>({lessonId:item.id,expectedVersion:before.find(row=>row.id===item.id)!.version,before:before.find(row=>row.id===item.id)!,after:item}))
    validateChangedLessons(state,edits)
    notify(state,affected.map(item=>item.teacherId),'school_day',command.type==='school_day'?'학사 휴업 정보가 바뀌었습니다':'특별 일과가 반영되었습니다',null,edits.map(edit=>edit.lessonId))
    return{entityId:null,summary:command.reason,lessonIds:edits.map(edit=>edit.lessonId)}
  }
  if(command.type==='record'){
    const item=lesson(state,command.lessonId)
    if(item.teacherId!==input.actorId)fail('FORBIDDEN','배정된 교사 역할만 실시 기록을 남길 수 있습니다.')
    if(item.version!==command.expectedLessonVersion)fail('LESSON_CHANGED','최신 수업을 다시 확인해 주세요.')
    if(item.status!=='scheduled'||state.records.some(row=>row.lessonId===item.id))fail('CONFLICT','취소됐거나 이미 실시 기록이 있는 수업입니다.')
    item.status='performed';item.version++
    state.records.push({lessonId:item.id,teacherId:input.actorId,lessonVersion:item.version,note:command.note,revision:state.revision})
    return{entityId:item.id,summary:'수업 실시 기록을 저장했습니다.',lessonIds:[item.id]}
  }
  const notice=state.notifications.find(item=>item.id===command.id)
  if(!notice)return fail('NOT_FOUND','알림을 찾지 못했습니다.')
  if(notice.recipientId!==input.actorId)fail('FORBIDDEN','해당 역할의 알림만 읽을 수 있습니다.')
  notice.read=true
  return{entityId:notice.id,summary:'알림을 읽음으로 표시했습니다.',lessonIds:[]}
}
export async function applyPilotCommand(state:PilotState,value:PilotEnvelope):Promise<PilotCommandResult> {
  const input=envelope(value);actor(state,input.actorId)
  const commandHash=await pilotDigest(input),existing=state.receipts.find(row=>row.requestId===input.requestId)
  if(existing){
    if(existing.commandHash!==commandHash||existing.actorId!==input.actorId)fail('CONFLICT','같은 요청 번호에 다른 내용을 사용할 수 없습니다.')
    if(existing.status==='closed')fail('REQUEST_CLOSED','이미 닫힌 요청 번호입니다. 새 요청 번호로 다시 작성해 주세요.')
    return{state,receipt:clone(existing),duplicate:true}
  }
  if(input.expectedRevision!==state.revision)fail('CONFLICT','다른 작업으로 연습 자료가 바뀌었습니다. 최신 자료를 다시 확인해 주세요.')
  if(state.receipts.length>=MAX_COMMANDS)fail('CAPACITY_EXCEEDED','연습 기록이 가득 찼습니다. 내보낸 뒤 새 연습을 시작해 주세요.')
  const next=clone(state);next.revision++
  const result=await transact(next,input)
  const receipt={requestId:input.requestId,commandHash,actorId:input.actorId,revision:next.revision,status:'applied' as const,entityId:result.entityId,simulated:true as const}
  next.receipts.push(receipt)
  next.history.push({revision:next.revision,actorId:input.actorId,requestId:input.requestId,kind:input.command.type,summary:result.summary,lessonIds:result.lessonIds,simulated:true})
  return{state:next,receipt:clone(receipt),duplicate:false}
}
export async function closePilotRequest(state:PilotState,value:PilotEnvelope):Promise<PilotCommandResult> {
  const input=envelope(value);actor(state,input.actorId)
  const commandHash=await pilotDigest(input),existing=state.receipts.find(row=>row.requestId===input.requestId)
  if(existing){
    if(existing.commandHash!==commandHash||existing.actorId!==input.actorId)fail('CONFLICT','원래 요청 번호와 내용을 그대로 확인해 주세요.')
    return{state,receipt:clone(existing),duplicate:true}
  }
  if(state.receipts.length>=MAX_COMMANDS)fail('CAPACITY_EXCEEDED','연습 기록이 가득 찼습니다.')
  const next=clone(state);next.revision++
  const receipt={requestId:input.requestId,commandHash,actorId:input.actorId,revision:next.revision,status:'closed' as const,entityId:null,simulated:true as const}
  next.receipts.push(receipt)
  // 닫기는 원래 명령을 실행하지 않는다. 오래된 판도 닫아 늦은 접수를 막는다.
  next.history.push({revision:next.revision,actorId:input.actorId,requestId:input.requestId,kind:input.command.type,summary:'미반영 요청 번호를 닫았습니다.',lessonIds:[],simulated:true})
  return{state:next,receipt:clone(receipt),duplicate:false}
}
export function recommendPilotSwaps(state:PilotState,lessonId:string,limit=8):PilotSwapRecommendation[] {
  const source=lesson(state,lessonId)
  if(source.status!=='scheduled')return[]
  const result:PilotSwapRecommendation[]=[]
  for(const other of state.lessons.filter(item=>item.id!==source.id&&item.status==='scheduled'&&item.date===source.date&&item.period!==source.period).sort((a,b)=>a.period-b.period||a.id.localeCompare(b.id))){
    try{
      const command:Extract<PilotCommand,{type:'propose'}>={type:'propose',kind:'swap',lessonIds:[source.id,other.id],reason:'충돌 검사 기반 추천'}
      validateChangedLessons(state,makeEdits(state,command,'recommendation'))
      result.push({lessonId:other.id,date:other.date,period:other.period,teacherId:other.teacherId,subject:other.subject,reason:'교사·학급·공간·휴업·수업 길이 충돌 없음. 역할별 수락과 담당자 승인이 필요합니다.'})
    }catch(error){if(!(error instanceof PilotOperationError))throw error}
    if(result.length>=Math.min(30,Math.max(1,limit)))break
  }
  return result
}
export function pilotInbox(state:PilotState,teacherId:string){actor(state,teacherId);return state.notifications.filter(row=>row.recipientId===teacherId).map(clone).reverse()}

// 파일 복원은 현재 계약의 구조·참조·상태 불변식을 검증한다. 서명이나 실제 승인 증명이 아니다.
export function parsePilotState(value:unknown):PilotState {
  const r=exact(value,['schema','simulated','fixture','revision','lessons','proposals','notifications','history','records','receipts','closedDays','specialDays','timetableVersions'])
  if(r.schema!==PILOT_OPERATIONS_SCHEMA||r.simulated!==true)fail('INVALID_INPUT','운영 연습 파일만 불러올 수 있습니다.')
  const fixture=validatePilotFixture(r.fixture),revision=positive(r.revision)
  const state=clone({...r,fixture,revision}) as unknown as PilotState
  for(const key of ['lessons','proposals','notifications','history','records','receipts','closedDays','specialDays','timetableVersions'] as const)if(!Array.isArray(state[key])||state[key].length>(key==='lessons'?20000:key==='notifications'?50000:MAX_COMMANDS))fail('INVALID_INPUT','연습 자료의 크기 또는 목록 형식이 잘못되었습니다.')
  for(const row of state.timetableVersions){
    exact(row,['revision','effectiveFrom','previewFingerprint','previousFixture']);positive(row.revision);inRange(state,day(row.effectiveFrom))
    if(row.revision>revision||!/^[a-f0-9]{64}$/.test(row.previewFingerprint))fail('INVALID_INPUT','시간표 교체 기준이 잘못되었습니다.')
    const previous=validatePilotFixture(row.previousFixture)
    if(previous.schoolId!==fixture.schoolId||previous.id!==fixture.id||previous.revision>=fixture.revision)fail('INVALID_INPUT','이전 시간표의 학교·판이 다릅니다.')
  }
  const teacherIds=new Set(fixture.teachers.map(item=>item.id)),classIds=new Set(fixture.classes.map(item=>item.id)),roomIds=new Set(fixture.rooms.map(item=>item.id))
  const knownActor=(value:unknown)=>{const result=id(value);if(!teacherIds.has(result)&&!PILOT_MANAGER_IDS.includes(result as typeof PILOT_MANAGER_IDS[number]))fail('INVALID_INPUT','없는 연습 역할입니다.');return result}
  const readLesson=(value:unknown):PilotLesson=>{
    const row=exact(value,['id','templateId','originLessonId','date','period','startTime','endTime','teacherId','classIds','roomId','subject','status','cancellation','version'])
    id(row.id);id(row.templateId);if(row.originLessonId!==null)id(row.originLessonId);inRange(state,day(row.date));positive(row.period);time(row.startTime);time(row.endTime);text(row.subject,300);positive(row.version)
    if(String(row.startTime)>=String(row.endTime)||!teacherIds.has(id(row.teacherId))||!roomIds.has(id(row.roomId))||ids(row.classIds).some(id=>!classIds.has(id)))fail('INVALID_INPUT','수업의 교사·학급·공간 또는 시각이 잘못되었습니다.')
    if(!['scheduled','cancelled','performed'].includes(String(row.status))||![null,'school_day','requested'].includes(row.cancellation as null|string)||(row.status==='cancelled')!==(row.cancellation!==null))fail('INVALID_INPUT','수업 상태가 일치하지 않습니다.')
    return row as unknown as PilotLesson
  }
  state.lessons.forEach(readLesson)
  if(new Set(state.lessons.map(item=>item.id)).size!==state.lessons.length)fail('INVALID_INPUT','중복 수업 번호가 있습니다.')
  const lessonIds=new Set(state.lessons.map(item=>item.id))
  for(const item of state.lessons)if(item.originLessonId&&(!lessonIds.has(item.originLessonId)||item.originLessonId===item.id||lesson(state,item.originLessonId).originLessonId))fail('INVALID_INPUT','보강 원수업 연결이 잘못되었습니다.')
  const makeupOrigins=new Set<string>()
  for(const item of state.lessons.filter(row=>row.originLessonId&&row.status!=='cancelled')){
    if(makeupOrigins.has(item.originLessonId!)||lesson(state,item.originLessonId!).status!=='cancelled')fail('INVALID_INPUT','보강이 중복되거나 원수업이 휴강 상태가 아닙니다.')
    makeupOrigins.add(item.originLessonId!)
  }
  for(const row of state.closedDays){exact(row,['date','classIds','reason']);inRange(state,day(row.date));checkClasses(state,ids(row.classIds));text(row.reason)}
  for(const row of state.specialDays){exact(row,['date','classIds','slots','reason']);inRange(state,day(row.date));checkClasses(state,ids(row.classIds));slots(row.slots);text(row.reason)}
  for(const p of state.proposals){
    exact(p,['id','kind','requesterId','reason','status','edits','requiredTeacherIds','consents','approvedBy','createdRevision','resolvedRevision']);id(p.id);knownActor(p.requesterId);text(p.reason);positive(p.createdRevision)
    if(p.createdRevision>revision||!['swap','move','substitute','cancel','makeup'].includes(p.kind)||!['awaiting_consent','awaiting_approval','approved','rejected','withdrawn'].includes(p.status))fail('INVALID_INPUT','변경 요청 상태가 잘못되었습니다.')
    if(!Array.isArray(p.edits)||p.edits.length<1||p.edits.length>2||!Array.isArray(p.consents))fail('INVALID_INPUT','변경 요청 목록이 잘못되었습니다.')
    ids(p.requiredTeacherIds).forEach(value=>{if(!teacherIds.has(value))fail('INVALID_INPUT','영향 교사가 잘못되었습니다.')})
    for(const edit of p.edits){exact(edit,['lessonId','expectedVersion','before','after']);id(edit.lessonId);positive(edit.expectedVersion);if(edit.before!==null)readLesson(edit.before);readLesson(edit.after);if(edit.after.id!==edit.lessonId||edit.before&&edit.before.id!==edit.lessonId)fail('INVALID_INPUT','변경 수업 번호가 다릅니다.')}
    if(new Set(p.consents.map(item=>item.teacherId)).size!==p.consents.length)fail('INVALID_INPUT','중복 동의가 있습니다.')
    for(const consent of p.consents){exact(consent,['teacherId','decision','revision']);if(!p.requiredTeacherIds.includes(consent.teacherId)||!['accepted','rejected'].includes(consent.decision)||positive(consent.revision)>revision)fail('INVALID_INPUT','동의 기록이 잘못되었습니다.')}
    if(p.status==='approved'||p.status==='awaiting_approval'){
      if(!p.requiredTeacherIds.every(id=>p.consents.some(row=>row.teacherId===id&&row.decision==='accepted')))fail('INVALID_INPUT','전원 동의가 없는 승인 자료입니다.')
    }
    if(p.status==='approved'){manager(p.approvedBy??'');if(p.approvedBy===p.requesterId||p.resolvedRevision===null)fail('INVALID_INPUT','승인 기록이 잘못되었습니다.')}
    else if(p.approvedBy!==null)fail('INVALID_INPUT','미승인 요청에 승인자가 있습니다.')
    if(p.resolvedRevision!==null&&positive(p.resolvedRevision)>revision)fail('INVALID_INPUT','요청의 종료 판이 잘못되었습니다.')
  }
  if(new Set(state.proposals.map(row=>row.id)).size!==state.proposals.length)fail('INVALID_INPUT','중복 변경 요청이 있습니다.')
  for(const row of state.notifications){
    exact(row,['id','recipientId','kind','title','proposalId','lessonIds','revision','read']);id(row.id);knownActor(row.recipientId);text(row.title);positive(row.revision)
    if(!['request','decision','changed','school_day'].includes(row.kind)||typeof row.read!=='boolean'||row.revision>revision||!Array.isArray(row.lessonIds)||row.lessonIds.some(value=>typeof value!=='string'))fail('INVALID_INPUT','알림 형식이 잘못되었습니다.')
    if(row.proposalId!==null&&!state.proposals.some(p=>p.id===row.proposalId))fail('INVALID_INPUT','알림의 요청 연결이 잘못되었습니다.')
  }
  for(const row of state.records){
    exact(row,['lessonId','teacherId','lessonVersion','note','revision']);id(row.lessonId);knownActor(row.teacherId);positive(row.lessonVersion);positive(row.revision)
    const item=lesson(state,row.lessonId)
    if(item.status!=='performed'||item.teacherId!==row.teacherId||item.version!==row.lessonVersion||row.revision>revision||typeof row.note!=='string'||row.note.length>2000)fail('INVALID_INPUT','실시 기록과 수업이 일치하지 않습니다.')
  }
  if(new Set(state.records.map(row=>row.lessonId)).size!==state.records.length||state.lessons.some(item=>item.status==='performed'&&!state.records.some(row=>row.lessonId===item.id)))fail('INVALID_INPUT','실시 기록이 중복되거나 없습니다.')
  for(const row of state.receipts){
    exact(row,['requestId','commandHash','actorId','revision','status','entityId','simulated']);id(row.requestId);knownActor(row.actorId);positive(row.revision)
    if(!/^[a-f0-9]{64}$/.test(row.commandHash)||row.revision>revision||!['applied','closed'].includes(row.status)||row.simulated!==true||row.entityId!==null&&typeof row.entityId!=='string')fail('INVALID_INPUT','연습 접수 기록이 잘못되었습니다.')
  }
  if(new Set(state.receipts.map(row=>row.requestId)).size!==state.receipts.length)fail('INVALID_INPUT','중복 요청 번호가 있습니다.')
  if(new Set(state.receipts.map(row=>row.revision)).size!==state.receipts.length||state.receipts.some(row=>row.revision<2))fail('INVALID_INPUT','접수 판이 중복되거나 잘못되었습니다.')
  for(const row of state.history){
    exact(row,['revision','actorId','requestId','kind','summary','lessonIds','simulated']);knownActor(row.actorId);id(row.requestId);text(row.summary,2000)
    if(positive(row.revision)>revision||row.simulated!==true||!['propose','consent','approve','reject','withdraw','school_day','special_day','record','read_notification','replace_timetable'].includes(row.kind)||!Array.isArray(row.lessonIds))fail('INVALID_INPUT','연습 이력이 잘못되었습니다.')
    if(!state.receipts.some(receipt=>receipt.requestId===row.requestId&&receipt.actorId===row.actorId&&receipt.revision===row.revision))fail('INVALID_INPUT','연습 이력의 접수 기록이 없습니다.')
  }
  if(state.history.length!==state.receipts.length||state.receipts.length!==revision-1)fail('INVALID_INPUT','연습 판과 접수 이력이 일치하지 않습니다.')
  if(new Set(state.history.map(row=>row.requestId)).size!==state.history.length)fail('INVALID_INPUT','연습 이력이 중복되었습니다.')
  // 복원 후에도 교사·학급·공간 충돌을 만들 수 없다.
  validateChangedLessons(state,state.lessons.filter(item=>item.status!=='cancelled').map(item=>({lessonId:item.id,expectedVersion:item.version,before:item,after:item})))
  return state
}
