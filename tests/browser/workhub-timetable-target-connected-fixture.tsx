import React, {useState} from 'react'
import {timetablePracticeSnapshot} from '../../apps/workhub/src/timetable/sample'
import {createRoot} from 'react-dom/client'
import {setupWorkbookSheets} from '../../apps/workhub/src/timetable/setup-workbook'
import {readTimetableXlsx,writeTimetableXlsx} from '../../apps/workhub/src/timetable/xlsx'
import hoursStyles from '../../apps/workhub/src/timetable/timetable-preparation-hours.css?inline'
import progressStyles from '../../apps/workhub/src/timetable/preparation-progress.css?inline'
import batchStyles from '../../apps/workhub/src/timetable/timetable-setup-batch.css?inline'
import {compilePreparation} from '../../apps/workhub/src/timetable/preparation'
import {TimetableWorkspace} from '../../apps/workhub/src/timetable/TimetableWorkspace'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {recoveryScope,PendingRequestsProvider,createPendingRequests} from '../../apps/workhub/src/app/pending-requests'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import setupStyles from '../../apps/workhub/src/timetable/timetable-setup.css?inline'
import appStyles from '../../apps/workhub/src/style.css?inline'
import themeStyles from '../../apps/workhub/src/appearance/theme.css?inline'

// React·전송 어댑터는 제품 코드이며 RPC 응답과 저장 원장만 이 합성 시험이 소유한다.
const w:any=window,copy=(value:any)=>structuredClone(value)
const member={id:'m',schoolId:'s',userId:'u',name:'합성 담당 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
w.readTimetableXlsx=readTimetableXlsx;w.writeTimetableXlsx=writeTimetableXlsx;w.member=member;w.calls=[];w.receipts={};w.actualWrites=0;w.drafts=createEditDrafts();w.pending=createPendingRequests();w.locked=false;w.saved=0;w.openedAdmin=0
w.prepWrites=0;w.confirmed=0
w.savedPreparation={id:'prep-saved',revision:1,sourceFingerprint:'a'.repeat(64),draft:{title:'보존할 시수와 일과',slots:[{id:'slot-mon',day:1,label:'월요일 1교시',startMinute:540,endMinute:585,periods:1},{id:'slot-tue',day:2,label:'화요일 1교시',startMinute:540,endMinute:585,periods:1}],plans:[{courseId:'course-a',weeklyPeriods:2,blocks:[{id:'block-a1',periods:1,allowedSlotIds:['slot-mon','slot-tue']},{id:'block-a2',periods:1,allowedSlotIds:['slot-mon','slot-tue']}]},{courseId:'course-b',weeklyPeriods:1,blocks:[{id:'block-b1',periods:1,allowedSlotIds:['slot-mon','slot-tue']}]}]}}
w.initialPreparation=copy(w.savedPreparation)
w.view={termId:'term',termLabel:'2026학년도 2학기',firstDay:'2026-08-13',lastDay:'2027-02-28',referenceDay:'2026-10-19',sourceRevision:1,sourceFingerprint:'a'.repeat(64),canEdit:true,
  spaces:[{id:'room-used',kind:'room',label:'과학실',capacity:1,version:1},{id:'room-free',kind:'room',label:'다목적실',capacity:null,version:1}],
  classes:[{id:'class-a',label:'1반',grade:1},{id:'class-b',label:'1반',grade:2}],
  courses:[{id:'course-a',label:'국어',inTimetable:true,teacherLabels:['김교사'],studentCount:25,link:null},{id:'course-b',label:'국어',inTimetable:true,teacherLabels:['이교사'],studentCount:24,link:{version:1,studentGroup:false,classIds:['class-b'],spaceIds:['room-used']}}],findings:[]}
w.savedPreparation=null
w.target={termId:'term',automaticTermId:'term',selectedTermId:null,version:0,terms:[{id:'term',schoolYear:2026,label:'2학기',firstDay:'2026-08-13',lastDay:'2027-02-28',state:'current',hasBasis:false,hasPreparationDraft:false},{id:'next',schoolYear:2027,label:'1학기',firstDay:'2027-03-01',lastDay:'2027-08-12',state:'planning',hasBasis:false,hasPreparationDraft:false}]}
w.views={term:copy(w.view),next:{...copy(w.view),termId:'next',termLabel:'2027학년도 1학기',firstDay:'2027-03-01',lastDay:'2027-08-12',referenceDay:'2027-03-01',sourceFingerprint:'b'.repeat(64),spaces:[{id:'room-used',kind:'room',label:'다음학기 과학실',capacity:1,version:1}],courses:copy(w.view.courses)}}
Object.defineProperty(w,'view',{configurable:true,get:()=>w.views[w.target.termId]})
w.externalSelect=(termId:string)=>{w.target={...w.target,termId,selectedTermId:termId,version:w.target.version+1}}
w.targetWrites=0;w.targetReceipts={};w.withBasis=Boolean(w.testOptions?.basis);w.targetLegacy=Boolean(w.testOptions?.legacy);w.targetDrop=false
const envelope=(data:any)=>({contract:'timetable.setup.v1',schoolId:'s',memberId:'m',data}),failure=(code:string)=>({contract:'timetable.setup.v1',schoolId:'s',memberId:'m',error:{code}})
const preparationSource=()=>({schoolId:'s',schoolLevel:'middle',termId:w.view.termId,termLabel:w.view.termLabel,firstDay:w.view.firstDay,lastDay:w.view.lastDay,sourceRevision:w.view.sourceRevision,sourceFingerprint:w.view.sourceFingerprint,canEdit:true,canConfirm:true,
  resources:[{id:'teacher-a',kind:'teacher',label:'김교사',capacity:1},{id:'teacher-b',kind:'teacher',label:'이교사',capacity:1},...w.view.classes.map((row:any)=>({id:row.id,kind:'class',label:row.label,capacity:1})),...w.view.courses.filter((row:any)=>row.link?.studentGroup).map((row:any)=>({id:'sg_'+row.id,kind:'student_group',label:row.label+' 수강집단',capacity:1})),...w.view.spaces.filter((row:any)=>row.capacity!==null).map((row:any)=>({id:row.id,kind:row.kind,label:row.label,capacity:row.capacity}))],
  courses:w.view.courses.map((row:any,index:number)=>({id:row.id,label:row.label+' '+(index+1)+'학년',requiredPeriods:null,resourceIds:['teacher-'+(index===0?'a':'b'),...(row.link?.classIds??[]),...(row.link?.studentGroup?['sg_'+row.id]:[]),...(row.link?.spaceIds??[]).filter((id:string)=>w.view.spaces.some((space:any)=>space.id===id&&space.capacity!==null))]})),unsupportedFeatures:[],savedDraft:copy(w.savedPreparation)})
const connection:any={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-19'}),getIdentity:async()=>({userId:'u',approved:true}),rpcVerified:async(name:string,args:any)=>{
  w.calls.push({name,args:copy(args)})
  if(name.startsWith('workhub_timetable_target_')){
    if(w.targetLegacy)throw {code:'PGRST202'}
    const wrap=(data:any)=>({contract:'timetable.target.v1',schoolId:'s',memberId:'m',data})
    const error=(code:string)=>({contract:'timetable.target.v1',schoolId:'s',memberId:'m',error:{code}})
    if(name.endsWith('_get'))return wrap(copy(w.target))
    const key=args.p_request_key,input=args.p_input
    if(args.p_recover_only)return w.targetReceipts[key]?wrap(copy(w.targetReceipts[key])):error('NOT_FOUND')
    if(!w.targetReceipts[key]){
      if(input.expectedVersion!==w.target.version)return error('CONFLICT')
      const changed=w.target.selectedTermId!==input.termId;w.target={...w.target,selectedTermId:input.termId,termId:input.termId??'term',version:w.target.version+(changed?1:0)}
      w.targetReceipts[key]={requestKey:key,termId:input.termId,version:w.target.version,effectiveTermId:w.target.termId};w.targetWrites++
    }
    if(w.targetDrop){w.targetDrop=false;throw {code:'QUERY_FAILED'}}
    return wrap(copy(w.targetReceipts[key]))
  }
  if(name==='workhub_timetable_readiness')return {contract:'timetable.v1',schoolId:'s',memberId:'m',data:w.withBasis?{available:true}:{available:false,reason:'basis_missing'}}
  if(name==='workhub_timetable_get'){
    const snapshot=timetablePracticeSnapshot('2026-10-19');snapshot.basis!.schoolId='s';snapshot.basis!.termId=w.target.termId;snapshot.basis!.id='basis-'+w.target.termId;snapshot.canSave=true
    return {contract:'timetable.v1',schoolId:'s',memberId:'m',data:snapshot}
  }
  if(name==='workhub_timetable_operations_readiness')return {contract:'timetable-operations.v1',schoolId:'s',memberId:'m',data:{available:true}}
  if(name==='workhub_timetable_operations_get')return {contract:'timetable-operations.v1',schoolId:'s',memberId:'m',data:{asOf:'2026-10-19T00:00:00.000Z',timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:true,canRequest:true,drafts:[],lessons:[],requests:[],publications:[]}}

  if(name.startsWith('workhub_timetable_preparation_')){
    const wrapped=(data:any)=>({contract:'timetable.preparation.v1',schoolId:'s',memberId:'m',data})
    if(name.endsWith('_get')){if(w.failPrepRead)throw {code:'QUERY_FAILED'};return wrapped(preparationSource())}
    const input=args.p_input,key=args.p_request_key
    if(args.p_recover_only)return wrapped(copy(w.receipts[key]))
    if(!w.receipts[key]){
      const source=preparationSource();w.prepWrites++
      const receipt={requestKey:key,kind:input.kind,draftId:input.draftId??'prep-new',draftRevision:(input.expectedDraftRevision??0)+1,sourceFingerprint:input.sourceFingerprint,basis:input.kind==='confirm'?compilePreparation(source,input.draft,'confirmed-basis',1).basis:null}
      w.receipts[key]=receipt;w.savedPreparation={id:receipt.draftId,revision:receipt.draftRevision,sourceFingerprint:input.sourceFingerprint,draft:copy(input.draft)}
    }
    if(w.dropPrepOnce){w.dropPrepOnce=false;throw {code:'QUERY_FAILED'}}
    return wrapped(copy(w.receipts[key]))
  }
  if(w.missing)throw {code:'PGRST202'}
  if(name==='workhub_timetable_setup_get'){
    if(w.holdRead)await new Promise<void>(resolve=>{w.releaseRead=()=>{w.holdRead=false;delete w.releaseRead;resolve()}})
    if(w.failRead)throw {code:'QUERY_FAILED'}
    return envelope(copy(w.view))
  }
  if(name!=='workhub_timetable_setup_execute')throw Error('예상하지 않은 RPC '+name)
  const c=args.p_command,key=args.p_request_key
  if(args.p_recover_only)return w.receipts[key]?envelope(copy(w.receipts[key])):failure('NOT_FOUND')
  if(w.receipts[key])return envelope(copy(w.receipts[key]))
  if(w.conflictOnce){w.conflictOnce=false;return failure('CONFLICT')}
  let targetId:string,version:number
  if(c.kind==='space_save'){
    const previous=c.spaceId===null?null:w.view.spaces.find((space:any)=>space.id===c.spaceId)
    if(c.spaceId!==null&&(!previous||previous.version!==c.expectedVersion))return failure('CONFLICT')
    if(w.view.spaces.some((space:any)=>space.id!==c.spaceId&&space.kind===c.input.kind&&space.label===c.input.label.trim()))return failure('CONFLICT')
    targetId=previous?.id??'space-created-'+(w.actualWrites+1);version=(previous?.version??0)+1
    const next={id:targetId,version,...copy(c.input),label:c.input.label.trim()}
    w.view.spaces=previous?w.view.spaces.map((space:any)=>space.id===targetId?next:space):[...w.view.spaces,next]
  }else if(c.kind==='space_remove'){
    const previous=w.view.spaces.find((space:any)=>space.id===c.spaceId)
    if(!previous||previous.version!==c.expectedVersion||w.view.courses.some((course:any)=>course.link?.spaceIds.includes(c.spaceId)))return failure('CONFLICT')
    targetId=c.spaceId;version=previous.version+1;w.view.spaces=w.view.spaces.filter((space:any)=>space.id!==targetId)
  }else if(c.kind==='course_link'){
    const previous=w.view.courses.find((course:any)=>course.id===c.courseId)
    if(!previous||((previous.link?.version??null)!==c.expectedVersion))return failure('CONFLICT')
    if((c.input.studentGroup&&c.input.classIds.length)||c.input.classIds.some((id:string)=>!w.view.classes.some((row:any)=>row.id===id))||c.input.spaceIds.some((id:string)=>!w.view.spaces.some((row:any)=>row.id===id)))return failure('INVALID_INPUT')
    targetId=c.courseId;version=(previous.link?.version??0)+1;previous.link={version,...copy(c.input)}
  }else throw Error('예상하지 않은 준비 명령')
  w.actualWrites++;w.view.sourceRevision++;w.view.sourceFingerprint=w.view.sourceRevision.toString(16).padStart(64,'0')
  w.receipts[key]={requestKey:key,kind:c.kind,targetId,version,sourceFingerprint:w.view.sourceFingerprint}
  if(w.dropOnce){w.dropOnce=false;throw {code:'QUERY_FAILED'}}
  return envelope(copy(w.receipts[key]))
}}
function Harness(){const[revision,setRevision]=useState(0);w.refresh=()=>setRevision(value=>value+1);return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{appStyles+themeStyles+baseStyles+setupStyles+batchStyles+hoursStyles+progressStyles}</style><main className="timetable-workspace"><TimetableWorkspace connection={connection} member={member} date="2026-10-19" revision={revision} onNavigationLockChange={value=>w.locked=value}/></main></PendingRequestsProvider></EditDraftsProvider>}
w.readDraft=(slot:string)=>w.drafts.bind(recoveryScope(member),slot).initial
w.mount=()=>{w.root=createRoot(document.getElementById('root'));w.root.render(<Harness/>)}
w.makeBatchFile=()=>{
  const sheets=setupWorkbookSheets(w.view,'s')
  sheets.find(row=>row.name==='공간')!.rows.find(row=>row[0]==='room-free')![3]='2'
  const course=sheets.find(row=>row.name==='수업연결')!.rows.find(row=>row[0]==='course-a')!
  course[3]='class-a';course[5]='room-free'
  return Array.from(writeTimetableXlsx(sheets))
}
const originalUrl=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{w.lastBlob=blob;return originalUrl(blob)}
w.mount()
