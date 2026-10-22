import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {TeachingWorkspace} from '../../apps/workhub/src/teaching/TeachingWorkspace'
import {createPendingRequests,PendingRequestsProvider,recoveryScope} from '../../apps/workhub/src/app/pending-requests'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {rosterRawCsv} from '../../apps/workhub/src/teaching/roster-import'
import {relationCanonical} from '../../apps/workhub/src/teaching/relations-validation'
import {csvHash} from '../../apps/workhub/src/teaching/csv'
import {teachingRosterFixture} from '../fixtures/teaching-roster-import.mjs'
import {snapshot,makeReceipt} from '../helpers/teaching-relations-fixture.mjs'
import styles from '../../apps/workhub/src/style.css?inline'
const w:any=window,copy=(v:any)=>structuredClone(v)
w.member={id:'member-a',schoolId:'school-a',userId:'user-a',name:'관리 교사',role:'calendar_manager',active:true,validFrom:'2020-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const initial=teachingRosterFixture();w.course=initial.course.course;w.course.assignmentId='assignment-a';w.course.validFrom='2026-08-13';w.course.validThrough='2027-02-28';w.students=initial.course.students.map((s:any)=>({...s,validFrom:w.course.validFrom,validThrough:w.course.validThrough}));w.original=copy(w.students)
w.calls=[];w.previews={};w.receipts={};w.writes=0;w.rosterWrites=0;w.pending=createPendingRequests();w.drafts=createEditDrafts();w.csv=rosterRawCsv
const env=()=>({contractVersion:'teaching.v1',schoolId:w.member.schoolId,memberId:w.member.id,ownerUserId:w.member.userId})
const dataEnv=(data:any)=>({contract:'school-data-maintenance.v1',schoolId:w.member.schoolId,memberId:w.member.id,data})
const dataError=(code:string)=>({contract:'school-data-maintenance.v1',schoolId:w.member.schoolId,memberId:w.member.id,error:{code}})
const relEnv=()=>({...env(),contractVersion:'teaching-relations.v1'})
function relations(){const s=snapshot();return {...s,...relEnv(),courseVersion:w.course.version,courseLabel:w.course.label,students:w.students.map((student:any)=>({studentId:student.id,name:student.name,membership:{...s.students[0].membership,id:student.courseMembershipId,studentId:student.id,enrollmentId:student.enrollmentId,label:student.name,courseLabel:w.course.label,validFrom:student.validFrom,validThrough:student.validThrough,effectiveThrough:student.validThrough},enrollment:{...s.students[0].enrollment,id:student.enrollmentId,studentId:student.id,enrollmentId:student.enrollmentId,label:student.name}}))}}
const connection:any={info:()=>({memberships:[w.member],schools:[{id:w.member.schoolId}],basisDate:'2026-10-16'}),getIdentity:async()=>({userId:w.member.userId,approved:true,profile:{id:w.member.userId,name:w.member.name,email:'fake@example.invalid',role:'superadmin',is_active:true,extra_permissions:[],department_id:null}}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push(copy({name,args}));
 if(name==='workhub_teaching_catalog')return {...env(),courses:[copy(w.course)],terms:[{id:'term-a',schoolId:w.member.schoolId,version:1,label:'2학기',firstDay:w.course.validFrom,lastDay:w.course.validThrough}],subjects:[{id:'subject-a',label:'국어'}],approvedTeachers:[{id:w.member.id,label:w.member.name}],canManageCourses:true}
 if(name==='workhub_teaching_course'){if(w.failCourse)throw Error('명부 재조회 실패');const value={...env(),course:copy(w.course),students:copy(w.students),rubrics:[],imports:[]};if(w.holdCourse)await new Promise(resolve=>w.releaseCourse=resolve);return value}
 if(name==='workhub_teaching_student')return {...env(),courseId:w.course.id,studentId:args.p_student_id,observations:[],assessments:[],nextCursor:null}
 if(name==='workhub_teaching_mutate'){w.rosterWrites++;const c=args.p_command;w.course.version++;return {...env(),requestKey:args.p_request_key,commandKind:c.kind,entityId:c.courseId,version:c.expectedVersion+1,outcome:'applied',appliedAt:new Date().toISOString()}}
 if(name==='workhub_school_data_get'){
  if(w.failMaintenance)throw Error('정정 조회 실패');const data={available:true,reason:null,courses:[{id:w.course.id,label:w.course.label,version:w.course.version,state:'active'}],course:{id:w.course.id,version:w.course.version,state:'active',fields:{label:w.course.label,validFrom:w.course.validFrom,validThrough:w.course.validThrough},teacherMemberIds:[w.member.id]},teachers:[],students:w.students.filter((s:any)=>!w.removeTarget||s.id!=='student-a').map((s:any)=>({id:s.id,version:s.version,state:'active',fields:{name:s.name,schoolStudentKey:s.schoolStudentKey},enrollment:{id:s.enrollmentId,version:s.enrollmentVersion??1,fields:{grade:s.grade,classLabel:s.classLabel,seatNumber:s.seatNumber}}}))};const value=dataEnv(data);if(w.holdMaintenance)await new Promise(resolve=>w.releaseMaintenance=resolve);return value
 }
 if(name==='workhub_school_data_preview'){
  const intent=copy(args.p_intent),s=w.students.find((s:any)=>s.id===intent.entityId||s.enrollmentId===intent.entityId),before=intent.kind==='student_correct'?{name:s.name,schoolStudentKey:s.schoolStudentKey}:{grade:s.grade,classLabel:s.classLabel,seatNumber:s.seatNumber};const p={previewId:'preview-'+w.calls.length,fingerprint:'a'.repeat(64),intent,expiresAt:new Date(Date.now()+600000).toISOString(),allowed:true,blockers:[],before,after:copy(intent.changes),impact:{assignments:0,courseMemberships:1,enrollments:1,records:0,timetableLinks:0,publishedLessons:0,futureLessons:0}};w.previews[p.previewId]=p;return dataEnv(copy(p))
 }
 if(name==='workhub_school_data_commit'){
  const key=args.p_request_key,c=args.p_command;if(w.receipts[key])return dataEnv(copy(w.receipts[key]));if(w.conflict)return dataError('CONFLICT');const s=w.students.find((s:any)=>s.id===c.intent.entityId||s.enrollmentId===c.intent.entityId);Object.assign(s,c.intent.changes);if(c.intent.kind==='student_correct')s.version++;else s.enrollmentVersion=(s.enrollmentVersion??1)+1;w.writes++;w.receipts[key]={requestKey:key,kind:c.intent.kind,entityId:c.intent.entityId,version:c.intent.expectedVersion+1,recordedAt:new Date().toISOString()};if(w.dropAfter){w.dropAfter=false;throw Error('반영 후 응답 유실')}return dataEnv(copy(w.receipts[key]))
 }
 if(name==='workhub_school_data_close'){const receipt=w.receipts[args.p_request_key];return dataEnv({requestKey:args.p_request_key,outcome:receipt?'applied':'closed',receipt:receipt??null})}
 if(name==='workhub_teaching_relations')return relations()
 if(name==='workhub_teaching_relation_preview'){
  const intent=copy(args.p_intent),r=relations().students.find((s:any)=>s.studentId===intent.studentId).membership,p={...relEnv(),courseId:w.course.id,previewId:'relation-preview',fingerprint:await csvHash(relationCanonical(intent)),expiresAt:new Date(Date.now()+600000).toISOString(),intent,changes:[{...r,afterThrough:intent.lastDay,effect:'end'}],replacement:null,recordsPreserved:true,historyNotTransferred:true};return p
 }
 if(name==='workhub_teaching_relation_commit'){
  const key=args.p_request_key,c=args.p_command;if(!w.receipts[key]){w.students.find((s:any)=>s.id===c.intent.studentId).validThrough=c.intent.lastDay;w.writes++;w.course.version++;w.receipts[key]={...makeReceipt(c,key),...relEnv()};if(w.dropRelationAfter){w.dropRelationAfter=false;throw Error('관계 반영 후 응답 유실')}}return copy(w.receipts[key])
 }
 throw Error('Unexpected RPC '+name)
}}
function App(){const [revision,setRevision]=useState(0);w.refresh=()=>setRevision(x=>x+1);w.switchMember=()=>{w.member={...w.member,id:'member-b',userId:'user-b'};setRevision(x=>x+1)};return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><TeachingWorkspace connection={connection} member={w.member} date="2026-10-16" revision={revision} onNavigationLockChange={v=>w.locked=v}/></PendingRequestsProvider></EditDraftsProvider>}
w.seedOtherMaintenance=()=>w.drafts.bind(recoveryScope(w.member),'school-data-maintenance').save({courseId:w.course.id,intent:{kind:'student_correct',courseId:w.course.id,entityId:'student-b',expectedVersion:1,changes:{name:'먼저 작성한 학생 이름',schoolStudentKey:'001002'},reason:'앞서 작성한 근거'}},true);w.injectPending=()=>w.pending.put(recoveryScope(w.member),'teaching',{key:crypto.randomUUID(),command:{kind:'roster_import',courseId:w.course.id,expectedVersion:w.course.version,rows:[copy(w.students[0])],validFrom:w.course.validFrom,validThrough:w.course.validThrough}});w.draft=()=>copy(w.drafts.bind(recoveryScope(w.member),'teaching-editor').initial);w.pendingRow=(slot:string)=>copy(w.pending.get(recoveryScope(w.member),slot));createRoot(document.getElementById('root')!).render(<App/>);
