import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {SchoolAiOperationsPanel} from '../../apps/workhub/src/assistant/SchoolAiOperationsPanel'
import {SchoolAiWorkspace} from '../../apps/workhub/src/assistant/SchoolAiWorkspace'
import {createSchoolAiOperationsServer} from '../../apps/workhub/src/assistant/school-operations-server'
import {AI_OPERATION_STATES,AI_OPERATION_FEATURES,AI_OPERATION_QUALITIES} from '../../apps/workhub/src/assistant/school-operations-contracts'
import {AssistantError,ASSISTANT_ROUTING} from '../../apps/workhub/src/assistant/contracts'
import {createPendingRequests,PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'

const w=window as any,stamp='2026-10-21T03:00:00.000Z'
let member:any={id:'member-private-one',userId:'user-private-one',schoolId:'school-private-one',name:'시험 관리자',role:'school_admin',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
w.calls=[];w.failList='';w.failPage=false;w.deferPage=false;w.deferList=false;w.deferDiagnostics=false;w.failDiagnostics=false;w.partialDiagnostics=false;w.releaseList=undefined;w.releasePage=undefined;w.releaseDiagnostics=undefined
const pending=createPendingRequests(),drafts=createEditDrafts()
function aggregate(){return{requests:0,settledMicroUsd:0,reservedMicroUsd:0,states:Object.fromEntries(AI_OPERATION_STATES.map(state=>[state,0]))}}
function operations(scope:any,cursor:any){
 const rows=Array.from({length:26},(_,i)=>({id:`row-${scope.schoolId}-${i}`,requestKey:`private-request-${scope.schoolId}-${i}`,feature:i===25?'evaluation':'assistant',quality:i===25?'review':'quick',state:i===0?'unknown':'completed',createdAt:new Date(Date.parse(stamp)-(i+1)*60000).toISOString(),updatedAt:stamp,model:i===25?ASSISTANT_ROUTING.models.review.id:ASSISTANT_ROUTING.models.quick.id,reservedMicroUsd:i===0?14000:0,settledMicroUsd:i===0?null:5000,usage:i===0?null:{inputTokens:100,outputTokens:40},errorCode:i===0?'PROVIDER_UNKNOWN':null,observedOverage:false}))
 const totals=aggregate(),groups=AI_OPERATION_FEATURES.flatMap(feature=>AI_OPERATION_QUALITIES.map(quality=>({...aggregate(),feature,quality})))
 for(const row of rows){const group=groups.find(g=>g.feature===row.feature&&g.quality===row.quality)!;for(const entry of [totals,group]){entry.requests++;entry.settledMicroUsd+=row.settledMicroUsd??0;entry.reservedMicroUsd+=row.reservedMicroUsd;entry.states[row.state]++}}
 if(cursor&&(cursor.month!=='2026-10'||cursor.asOf!==stamp||cursor.afterId!==rows[24].id))throw new AssistantError('INVALID_INPUT')
 return{contract:'assistant.operations.v1',...scope,checkedAt:stamp,month:'2026-10',timeZone:'Asia/Seoul',asOf:stamp,totals,groups,unresolved:{requests:2,reservedMicroUsd:28000,previousMonthRequests:1,previousMonthReservedMicroUsd:14000,oldestCreatedAt:'2026-09-30T01:00:00.000Z',observedOverageRequests:0},items:cursor?rows.slice(25):rows.slice(0,25),nextCursor:cursor?null:{month:'2026-10',asOf:stamp,afterId:rows[24].id}}
}
function diagnostics(scope:any){return{contract:'assistant.school.diagnostics.v1',...scope,checkedAt:stamp,providerContacted:false,checks:[
 {id:'authorization',ok:true,code:'AUTHORIZED'},{id:'serviceConfiguration',ok:true,code:'SERVICE_AUTHENTICATED'},
 {id:'database',ok:w.partialDiagnostics?null:true,code:w.partialDiagnostics?'SQL_READ_UNAVAILABLE':'SQL_READY'},
 {id:'policy',ok:w.partialDiagnostics?null:true,code:w.partialDiagnostics?'SQL_READ_UNAVAILABLE':'POLICY_ENABLED'},
 {id:'schoolKey',ok:true,code:'KEY_PRESENT'},{id:'serverEncryption',ok:true,code:'ENCRYPTION_CONFIGURED'},
 {id:'keyDecryption',ok:w.partialDiagnostics?null:true,code:w.partialDiagnostics?'SQL_READ_UNAVAILABLE':'KEY_DECRYPTABLE'},
 {id:'providerConnection',ok:null,code:'NOT_CHECKED'},
]}}
const connection:any={info:()=>({schools:[{id:member.schoolId}],memberships:[structuredClone(member)],basisDate:'2026-10-21'}),getIdentity:async()=>({userId:member.userId,approved:true}),rpcVerified:async()=>{throw new Error('합성 시험에서 허용하지 않은 RPC')}}
const server=createSchoolAiOperationsServer(connection,{send:async(payload:any,userId:string,writing:boolean)=>{
 w.calls.push(structuredClone({payload,userId,writing}));if(writing)throw new Error('조회가 쓰기로 전송됨')
 const scope={schoolId:member.schoolId,memberId:member.id}
 if(payload.action==='list'){
  if(w.failList)throw new AssistantError(w.failList)
  const result=operations(scope,payload.cursor)
  if(payload.cursor&&w.failPage){w.failPage=false;throw new AssistantError('QUERY_FAILED')}
  if(payload.cursor&&w.deferPage){w.deferPage=false;return new Promise(resolve=>w.releasePage=()=>resolve(result))}
  if(!payload.cursor&&w.deferList){w.deferList=false;return new Promise(resolve=>w.releaseList=()=>resolve(result))}
  return result
 }
 if(payload.action==='diagnostics'){
  if(w.failDiagnostics)throw new AssistantError('FORBIDDEN')
  const result=diagnostics(scope)
  if(w.deferDiagnostics){w.deferDiagnostics=false;return new Promise(resolve=>w.releaseDiagnostics=()=>resolve(result))}
  return result
 }
 throw new Error('허용하지 않은 HTTP 명령')
}})
function App(){const[revision,setRevision]=useState(0),[show,setShow]=useState(true);w.setShow=setShow;w.refresh=()=>setRevision(value=>value+1);w.switchAccount=()=>{member={...member,id:'member-private-two',userId:'user-private-two',schoolId:'school-private-two'};setRevision(value=>value+1)};w.switchRole=()=>{member={...member,role:'teacher'};setRevision(value=>value+1)};return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}>{show&&(w.initialView==='workspace'?<SchoolAiWorkspace connection={connection} member={member} revision={revision} onNavigationLockChange={value=>w.locked=value}/>:<SchoolAiOperationsPanel connection={connection} member={member} revision={revision} server={server}/>)}</PendingRequestsProvider></EditDraftsProvider>}
const host=document.getElementById('root')!,shadow=host.attachShadow({mode:'open'}),target=document.createElement('div');shadow.append(target)
createRoot(target).render(<React.StrictMode><App/></React.StrictMode>)
