import { canonical, exact, identifier, isoDate, ServiceError, validateLocalInput, version } from '../services/service-values'
export const SCHOOL_DATA_CONTRACT='school-data-maintenance.v1'
export const maintenanceKinds=['course_correct','course_cancel','course_archive','course_restore','course_teacher_correct','student_correct','student_void','student_restore','enrollment_correct'] as const
export type MaintenanceKind=typeof maintenanceKinds[number]
export type MaintenanceState='active'|'archived'|'cancelled'|'voided'
export interface MaintenanceIntent {kind:MaintenanceKind;courseId:string;entityId:string;expectedVersion:number;changes:Record<string,unknown>;reason:string}
export interface MaintenanceCommand {previewId:string;fingerprint:string;intent:MaintenanceIntent}
export interface MaintenanceReceipt {requestKey:string;kind:MaintenanceKind;entityId:string;version:number;recordedAt:string}
export interface MaintenancePreview extends MaintenanceCommand {expiresAt:string;allowed:boolean;blockers:string[];impact:Record<string,number>;before:Record<string,unknown>;after:Record<string,unknown>}
export type MaintenanceClose={requestKey:string;outcome:'applied';receipt:MaintenanceReceipt}|{requestKey:string;outcome:'closed';receipt:null}
export interface MaintenanceCourse {id:string;version:number;state:MaintenanceState;fields:{label:string;validFrom:string;validThrough:string};teacherMemberIds:string[]}
export interface MaintenanceStudent {id:string;version:number;state:MaintenanceState;fields:{name:string;schoolStudentKey:string};enrollment:{id:string;version:number;fields:{grade:number;classLabel:string;seatNumber:number}}}
export interface MaintenanceSnapshot {available:boolean;reason:null|'forbidden'|'not_configured';courses:{id:string;label:string;version:number;state:MaintenanceState}[];course:MaintenanceCourse|null;students:MaintenanceStudent[];teachers:{id:string;label:string;validFrom:string;validThrough:string|null}[]}
export interface SchoolDataMaintenanceServer {get(member:string,course:string|null):Promise<MaintenanceSnapshot>;preview(member:string,intent:MaintenanceIntent):Promise<MaintenancePreview>;commit(member:string,command:MaintenanceCommand,key:string):Promise<MaintenanceReceipt>;close(member:string,command:MaintenanceCommand,key:string):Promise<MaintenanceClose>}
const fail=():never=>{throw new ServiceError('INVALID_RESPONSE')}
const text=(x:unknown,n:number):string=>typeof x==='string'&&x.trim()&&x.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(x)&&!Array.from(x).some(c=>{const v=c.codePointAt(0)!;return v>=0xd800&&v<=0xdfff})?x:fail()
const rows=(x:unknown,max=2000):unknown[]=>Array.isArray(x)&&x.length<=max?x:fail()
const unique=(x:string[])=>{if(new Set(x).size!==x.length)fail();return x}
const ids=(x:unknown)=>unique(rows(x,100).map(identifier))
const state=(x:unknown):MaintenanceState=>['active','archived','cancelled','voided'].includes(String(x))?x as MaintenanceState:fail()
const stamp=(x:unknown):string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x))?x:fail()
const hash=(x:unknown):string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)?x:fail()
const bounded=(x:unknown,max:number)=>{const n=version(x);return n<=max?n:fail()}
function fields(k:MaintenanceKind,x:unknown):Record<string,unknown>{
 if(k==='course_correct'){exact(x,['label','validFrom','validThrough']);const validFrom=isoDate(x.validFrom),validThrough=isoDate(x.validThrough);if(validFrom>validThrough)fail();return {label:text(x.label,120),validFrom,validThrough}}
 if(k==='course_teacher_correct'){exact(x,['teacherMemberIds']);const teacherMemberIds=ids(x.teacherMemberIds).sort();if(!teacherMemberIds.length)fail();return {teacherMemberIds}}
 if(k==='student_correct'){exact(x,['name','schoolStudentKey']);return {name:text(x.name,120),schoolStudentKey:text(x.schoolStudentKey,120)}}
 if(k==='enrollment_correct'){exact(x,['grade','classLabel','seatNumber']);return {grade:bounded(x.grade,20),classLabel:text(x.classLabel,40),seatNumber:bounded(x.seatNumber,999)}}
 exact(x,[]);return {}
}
export function maintenanceIntent(x:unknown):MaintenanceIntent{return validateLocalInput(()=>{exact(x,['kind','courseId','entityId','expectedVersion','changes','reason']);if(!maintenanceKinds.includes(x.kind as MaintenanceKind))fail();const kind=x.kind as MaintenanceKind;const courseId=identifier(x.courseId),entityId=identifier(x.entityId);if(kind.startsWith('course_')&&courseId!==entityId)fail();return {kind,courseId,entityId,expectedVersion:bounded(x.expectedVersion,2147483646),changes:fields(kind,x.changes),reason:text(x.reason,2000)}})}
export function maintenanceCommand(x:unknown):MaintenanceCommand{return validateLocalInput(()=>{exact(x,['previewId','fingerprint','intent']);return {previewId:identifier(x.previewId),fingerprint:hash(x.fingerprint),intent:maintenanceIntent(x.intent)}})}
export function maintenanceSnapshot(x:unknown):MaintenanceSnapshot{
 exact(x,['available','reason','courses','course','students','teachers']);if(typeof x.available!=='boolean'||![null,'forbidden','not_configured'].includes(x.reason as null)||x.available!==(x.reason===null))fail()
 const courses=rows(x.courses).map(c=>{exact(c,['id','label','version','state']);const s=state(c.state);if(s==='voided')fail();return {id:identifier(c.id),label:text(c.label,120),version:version(c.version),state:s}});unique(courses.map(c=>c.id))
 let course:MaintenanceCourse|null=null
 if(x.course!==null){exact(x.course,['id','version','state','fields','teacherMemberIds']);course={id:identifier(x.course.id),version:version(x.course.version),state:state(x.course.state),fields:fields('course_correct',x.course.fields) as MaintenanceCourse['fields'],teacherMemberIds:ids(x.course.teacherMemberIds)};const row=courses.find(c=>c.id===course!.id);if(!row||row.version!==course.version||row.state!==course.state||row.label!==course.fields.label)fail()}
 const students=rows(x.students).map(s=>{exact(s,['id','version','state','fields','enrollment']);exact(s.enrollment,['id','version','fields']);const status=state(s.state);if(!['active','voided'].includes(status))fail();return {id:identifier(s.id),version:version(s.version),state:status,fields:fields('student_correct',s.fields) as MaintenanceStudent['fields'],enrollment:{id:identifier(s.enrollment.id),version:version(s.enrollment.version),fields:fields('enrollment_correct',s.enrollment.fields) as MaintenanceStudent['enrollment']['fields']}}});unique(students.map(s=>s.id));unique(students.map(s=>s.enrollment.id))
 const teachers=rows(x.teachers,300).map(t=>{exact(t,['id','label','validFrom','validThrough']);const validFrom=isoDate(t.validFrom),validThrough=t.validThrough===null?null:isoDate(t.validThrough);if(validThrough!==null&&validFrom>validThrough)fail();return {id:identifier(t.id),label:text(t.label,120),validFrom,validThrough}});unique(teachers.map(t=>t.id))
 if(!x.available&&(courses.length||course||students.length||teachers.length)||!course&&students.length)fail()
 return {available:x.available as boolean,reason:x.reason as MaintenanceSnapshot['reason'],courses,course,students,teachers}
}
export function maintenancePreview(x:unknown,intent:MaintenanceIntent):MaintenancePreview{
 exact(x,['previewId','fingerprint','expiresAt','intent','allowed','blockers','impact','before','after']);if(canonical(maintenanceIntent(x.intent))!==canonical(intent)||typeof x.allowed!=='boolean')fail()
 const codes=['VERSION_CHANGED','ALREADY_CLOSED','OUTSIDE_TERM','PERIOD_CUTS_RELATIONS','IN_PUBLISHED_TIMETABLE','USE_RELATION_CHANGE','HAS_CONTENT','TEACHER_UNAVAILABLE','KEY_TAKEN','GRADE_OUT_OF_RANGE','SEAT_TAKEN','FUTURE_LESSONS','NO_CHANGE'];const blockers=unique(rows(x.blockers,30).map(b=>typeof b==='string'&&codes.includes(b)?b:fail()));if(x.allowed!==(blockers.length===0))fail()
 const keys=['assignments','courseMemberships','enrollments','records','timetableLinks','publishedLessons','futureLessons'];exact(x.impact,keys);const impact:Record<string,number>={};for(const k of keys){const v=x.impact[k];if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)fail();impact[k]=v as number}
 const shape=intent.kind.startsWith('student_')?'student_correct':intent.kind==='enrollment_correct'?'enrollment_correct':intent.kind==='course_teacher_correct'?'course_teacher_correct':'course_correct'
 const before=fields(shape,x.before),after=fields(shape,x.after);if(['course_correct','course_teacher_correct','student_correct','enrollment_correct'].includes(intent.kind)&&canonical(after)!==canonical(intent.changes))fail()
 return {previewId:identifier(x.previewId),fingerprint:hash(x.fingerprint),expiresAt:stamp(x.expiresAt),intent:structuredClone(intent),allowed:x.allowed as boolean,blockers,impact,before,after}
}
export function maintenanceReceipt(x:unknown,c:MaintenanceCommand,key:string):MaintenanceReceipt{exact(x,['requestKey','kind','entityId','version','recordedAt']);if(x.requestKey!==key||x.kind!==c.intent.kind||x.entityId!==c.intent.entityId||version(x.version)!==c.intent.expectedVersion+1)fail();return {requestKey:key,kind:c.intent.kind,entityId:c.intent.entityId,version:x.version as number,recordedAt:stamp(x.recordedAt)}}
export function maintenanceClose(x:unknown,c:MaintenanceCommand,key:string):MaintenanceClose{exact(x,['requestKey','outcome','receipt']);if(x.requestKey!==key)fail();if(x.outcome==='applied')return {requestKey:key,outcome:'applied',receipt:maintenanceReceipt(x.receipt,c,key)};if(x.outcome==='closed'&&x.receipt===null)return {requestKey:key,outcome:'closed',receipt:null};return fail()}
