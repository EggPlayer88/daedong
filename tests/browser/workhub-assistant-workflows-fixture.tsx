import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {createAssistantServer} from '../../apps/workhub/src/assistant/server'
import {AssistantError, ASSISTANT_ROUTING} from '../../apps/workhub/src/assistant/contracts'
import {createEditDrafts, EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests, PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'

const w = window as any
let member:any = {id:'member-one',userId:'user-one',schoolId:'school-one',name:'시험 교사',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
w.calls=[];w.navigation=[];w.searches=[];w.opened=[];w.calendar=[];w.tasks=0;w.aiCalls=0
w.ready=w.scenario!=='notready';w.allow=true;w.searchFail=false;w.deferSearch=false;w.taskUnknown=false
w.pending=createPendingRequests();w.memory=createEditDrafts()
const receipts=new Map(),taskReceipts=new Map()
const envelope=(data:any)=>({contract:'assistant.v1',schoolId:member.schoolId,memberId:member.id,data})
const connection:any={
  info:()=>({schools:[{id:member.schoolId}],memberships:[member],basisDate:'2026-11-03'}),
  getIdentity:async()=>({userId:member.userId,approved:true}),
  rpcVerified:async(name:string,args:any)=>{
    if(name==='workhub_ai_policy_threads_list')return envelope({items:[],nextCursor:null})
    if(name==='workhub_ai_policy_thread_get')return envelope(w.thread)
    if(name==='workhub_ai_confirm_task'){
      w.calls.push({kind:'confirm',args:structuredClone(args)})
      if(taskReceipts.has(args.p_request_key))return envelope(taskReceipts.get(args.p_request_key))
      w.tasks++
      const result={requestKey:args.p_request_key,proposalId:args.p_input.proposalId,proposalVersion:2,taskId:'task-one',taskVersion:1,threadVersion:2}
      taskReceipts.set(args.p_request_key,result)
      w.thread={...w.thread,version:2,exchanges:w.thread.exchanges.map((row:any)=>({...row,proposal:{...row.proposal,status:'applied',version:2,resourceId:'task-one'}}))}
      if(w.taskUnknown){w.taskUnknown=false;throw new AssistantError('RESULT_UNKNOWN')}
      return envelope(result)
    }
    throw new AssistantError('NOT_READY')
  },
}
const server=createAssistantServer(connection,{send:async(payload:any)=>{
  if(payload.action==='readiness')return envelope(w.ready?{available:true}:{available:false,reason:'budget_exhausted'})
  w.calls.push({kind:'ask',payload:structuredClone(payload)})
  if(receipts.has(payload.requestKey))return envelope(receipts.get(payload.requestKey))
  w.aiCalls++
  const input=payload.input
  w.thread={id:input.threadId??'thread-one',mode:input.mode,version:input.expectedVersion+1,title:'대화로 업무 처리',nextCursor:null,exchanges:[{
    id:'exchange-one',requestKey:payload.requestKey,intent:input.intent,prompt:input.prompt,studentContext:input.studentContext,
    segments:[{text:'요청한 할 일을 정리했습니다.',citations:[]}],
    proposal:input.intent==='personal_assistant'?{id:'proposal-one',version:1,kind:'create_personal_task',input:{title:'제출 자료 확인',notes:'제출 전 원문 확인',dueDate:'2026-11-04'},status:'pending',resourceId:null}:null,
    createdAt:'2026-11-03T01:00:00Z',execution:{quality:input.quality,model:ASSISTANT_ROUTING.models.quick.id,reviewOf:null},
  }]}
  const result={state:'completed',requestKey:payload.requestKey,thread:structuredClone(w.thread)}
  receipts.set(payload.requestKey,result)
  return envelope(result)
}},{policyReads:true})
const result=()=>({items:[{kind:'knowledge',id:'travel-rule',title:'출장 안내',description:'출장 절차와 제출 자료',meta:'2판 · 게시됨',version:2,locator:'원문 3항'}],coverage:['현재 학교에서 조회 가능한 학교 자료 첫 페이지'],hasMore:true})
function App(){
  const[revision,setRevision]=useState(0),[show,setShow]=useState(true),[context,setContext]=useState<any>()
  w.refresh=()=>setRevision(x=>x+1);w.setShow=setShow;w.setContext=setContext
  w.switchAccount=()=>{member={...member,id:'member-two',userId:'user-two',schoolId:'school-two'};setRevision(x=>x+1)}
  w.endMembership=()=>{member={...member,active:false};setRevision(x=>x+1)}
  const actions={
    navigate:(page:any)=>{w.navigation.push(page);return w.allow},
    search:async(query:any,kinds:any,signal:AbortSignal)=>{
      w.searches.push({query,kinds});w.searchSignal=signal
      if(w.searchFail)throw new Error('합성 조회 실패')
      if(w.deferSearch)return await new Promise<any>(resolve=>w.releaseSearch=()=>resolve(result()))
      return result()
    },
    open:(item:any)=>{w.opened.push(structuredClone(item));return w.allow},
    calendar:(command:any)=>{w.calendar.push(structuredClone(command));return w.allow},
  }
  return <EditDraftsProvider store={w.memory}><PendingRequestsProvider store={w.pending}>
    {show&&<AssistantPanel connection={connection} member={member} date="2026-11-03" revision={revision} server={server}
      settingsServer={{status:async()=>{throw new AssistantError('NOT_READY')}} as any}
      contextRequest={context} workspaceActions={actions} onNavigationLockChange={locked=>w.locked=locked}/>} 
  </PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
