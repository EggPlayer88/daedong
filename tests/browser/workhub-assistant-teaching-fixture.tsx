// 실제 TeachingWorkspace·전송 어댑터에 합성 학교 응답만 연결한다.
import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {TeachingWorkspace} from '../../apps/workhub/src/teaching/TeachingWorkspace'
import {WorkspacePlanCard} from '../../apps/workhub/src/assistant/WorkspacePlanCard'
import {captureWorkflowPlanOrigin,recordWorkflowPlanResult} from '../../apps/workhub/src/assistant/plan-workflow-results'
import {AssistantDeliveryFrame} from '../../apps/workhub/src/assistant/delivery-workspace'
import {createEditDrafts, EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests, PendingRequestsProvider, recoveryScope} from '../../apps/workhub/src/app/pending-requests'

const w=window as any, copy=structuredClone
const member={id:'member-a',schoolId:'school-a',userId:'user-a',name:'합성 담당 교사',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
const env=()=>({contractVersion:'teaching.v1',schoolId:member.schoolId,memberId:member.id,ownerUserId:member.userId})
const course={id:'course-a',schoolId:'school-a',version:1,label:'1학년 도덕',termId:'term-a',subjectId:'subject-a',assignmentId:'assignment-a',validFrom:'2026-08-13',validThrough:'2027-02-28',canRecord:true,canCounsel:false,canManageRoster:false}
const students=['가','나'].map((name,index)=>({id:'student-'+index,schoolId:'school-a',version:1,schoolStudentKey:'key-'+index,name:'합성 학생 '+name,grade:1,classLabel:'1',seatNumber:index+1,enrollmentId:'enroll-'+index,courseMembershipId:'membership-'+index,validFrom:'2026-08-13',validThrough:'2027-02-28'}))
const observation=(id:string,patch:any={})=>({sourceActivity:null,sourceReviewRequired:false,id,schoolId:'school-a',version:1,ownerUserId:'user-a',courseId:'course-a',studentId:'student-0',courseMembershipId:'membership-0',assignmentId:'assignment-a',revisionId:'rev-'+id,occurredOn:'2026-10-16',text:'관찰 근거 '+id,state:'active',contentHash:'a'.repeat(64),epoch:3,kind:'observation',...patch})
const assessment={id:'assessment-a',schoolId:'school-a',version:1,ownerUserId:'user-a',courseId:'course-a',studentId:'student-0',courseMembershipId:'membership-0',assignmentId:'assignment-a',revisionId:'assessment-rev',rubricId:'rubric-a',rubricRevisionId:'rubric-rev',occurredOn:'2026-10-16',comment:'확정한 평가 의견',scores:[{criterionKey:'criterion-1',state:'scored',points:8}],confirmed:true,state:'active',contentHash:'b'.repeat(64),epoch:2,total:8,sourceReviewRequired:false}
const state={observations:[observation('valid'),observation('stale',{sourceReviewRequired:true}),observation('withdrawn',{state:'withdrawn'}),observation('other-student',{studentId:'student-1',courseMembershipId:'membership-1'})],assessments:[assessment,{...assessment,id:'unconfirmed',revisionId:'unconfirmed-rev',confirmed:false,comment:'확정하지 않은 평가 의견'}],rubrics:[{id:'rubric-a',schoolId:'school-a',version:1,courseId:'course-a',ownerUserId:'user-a',label:'토론 평가',revisionId:'rubric-rev',criteria:[{key:'criterion-1',label:'판단 근거',maximum:10}],archived:false}]}
if(new URLSearchParams(location.search).has('readonly'))course.canRecord=false
w.calls=[];w.drafts=[];w.state=state;w.course=course;w.pending=createPendingRequests();w.memory=createEditDrafts()
const receipts=new Map();let serial=0
const connection:any={
 getIdentity:async()=>({userId:member.userId,approved:true,profile:{id:member.userId,name:member.name,email:'synthetic@example.invalid',role:'teacher',is_active:true,extra_permissions:[],department_id:null}}),
 info:()=>({memberships:[member],schools:[{id:'school-a'}],basisDate:'2026-10-16'}),
 async rpcVerified(name:string,args:any){
  w.calls.push(copy({name,args}))
  if(name==='workhub_teaching_catalog')return {...env(),courses:[copy(course)],terms:[{id:'term-a',schoolId:'school-a',version:1,label:'2026년 2학기',firstDay:'2026-08-13',lastDay:'2027-02-28'}],subjects:[{id:'subject-a',label:'도덕'}],approvedTeachers:[],canManageCourses:false}
  if(name==='workhub_teaching_course')return {...env(),course:copy(course),students:copy(students),rubrics:copy(state.rubrics),imports:[]}
  if(name==='workhub_teaching_student')return {...env(),courseId:course.id,studentId:args.p_student_id,observations:copy(state.observations.filter(r=>r.studentId===args.p_student_id)),assessments:copy(state.assessments.filter(r=>r.studentId===args.p_student_id)),nextCursor:null}
  if(name!=='workhub_teaching_mutate')throw Error('허용하지 않은 합성 RPC: '+name)
  if(w.holdMutation)await new Promise(resolve=>w.releaseMutation=resolve)
  const cmd=args.p_command,key=args.p_request_key
  if(receipts.has(key))return {...copy(receipts.get(key)),outcome:'replayed'}
  if(cmd.kind!=='observation_save')throw Error('허용하지 않은 합성 쓰기: '+cmd.kind)
  if(w.conflictOnce){w.conflictOnce=false;const r=state.observations.find(r=>r.id===cmd.recordId)!;r.version++;r.text='다른 화면의 최신 관찰';return {...env(),ok:false,code:'CONFLICT'}}
  const existing=state.observations.find(r=>r.id===cmd.recordId),id=existing?.id??'saved-'+(++serial),version=(existing?.version??0)+1
  const record=observation(id,{version,revisionId:'rev-'+id+'-'+version,text:cmd.input.text,studentId:cmd.studentId,courseMembershipId:cmd.courseMembershipId,occurredOn:cmd.input.occurredOn})
  if(existing)state.observations.splice(state.observations.indexOf(existing),1,record);else state.observations.push(record)
  const receipt={...env(),requestKey:key,commandKind:cmd.kind,entityId:id,version,outcome:'applied',appliedAt:'2026-10-16T01:00:00Z'}
  receipts.set(key,copy(receipt))
  if(w.failOnce){w.failOnce=false;throw Error('합성 응답 유실')}
  return receipt
 }
}
function App(){
 const params=new URLSearchParams(location.search)
 const [plan,setPlan]=useState<any>(()=>({scope:recoveryScope(member as any),selectedId:'step-a',plan:{kind:'plan',basisDate:'2026-10-16',prompt:'수업 자료 작업',steps:[{id:'step-a',prompt:'수업 자료 작업',label:'수업 자료',command:{kind:'navigate',page:'students'}}]}}))
 const [origin]=useState(()=>captureWorkflowPlanOrigin(plan,'수업 자료 작업',recoveryScope(member as any),'2026-10-16'));w.plan=plan
 const onResult=(result:any)=>setPlan((before:any)=>recordWorkflowPlanResult(before,origin!,result,recoveryScope(member as any),'2026-10-16'))
 const [revision,setRevision]=useState(0),[locked,setLocked]=useState(false),[talking,setTalking]=useState(false)
 const [request,setRequest]=useState<any>(params.has('empty')?undefined:{courseId:params.get('course')??'course-a',token:'open-1',source:'assistant',tab:params.get('tab')??'records'})
 w.refresh=()=>setRevision(v=>v+1);w.openCourse=(courseId:string)=>setRequest({courseId,token:crypto.randomUUID(),source:'assistant',tab:'activity'});w.talk=()=>setTalking(true)
 const work={scope:'synthetic',kind:'students',key:'teaching-work'} as any
 return <EditDraftsProvider store={w.memory}><PendingRequestsProvider store={w.pending}>
  <AssistantDeliveryFrame workspace={work} talking={talking} locked={locked} finishDisabled={locked} onTalk={()=>setTalking(true)} onResume={()=>setTalking(false)} onClose={()=>{w.closed=true}} chat={<section><h2>합성 전문 대화</h2><WorkspacePlanCard hasInput={false} model={{saved:plan,manageable:true,selectable:true,stale:false,blockedSelection:false,dismiss(){},choose(){},restoreOriginal(){}} as any}/></section>}>
   <TeachingWorkspace onWorkflowResult={onResult} presentation="assistant" initialAction={params.has('import')?'activityImport':undefined} initialTab={params.get('tab') as any??'records'} initialRequest={request} connection={connection} member={member as any} date="2026-10-16" revision={revision} onNavigationLockChange={setLocked} onRequestStudentDraft={source=>{w.drafts.push(copy(source));setTalking(true)}}/>
  </AssistantDeliveryFrame>
 </PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)

