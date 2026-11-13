import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {AssistantError, ASSISTANT_ROUTING, type AssistantServer, type AskResult, type AssistantThread, type TaskReceipt} from '../../apps/workhub/src/assistant/contracts'
import {createEditDrafts, EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests, PendingRequestsProvider, recoveryScope} from '../../apps/workhub/src/app/pending-requests'
import type {Membership} from '../../apps/workhub/src/contracts'
const member:Membership={id:'member-test',userId:'user-test',schoolId:'school-test',name:'시험 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const date='2026-11-13',scope=recoveryScope(member),memory=createEditDrafts(),pending=createPendingRequests()
const asks=new Map<string,AskResult>(),tasks=new Map<string,TaskReceipt>(),threads=new Map<string,AssistantThread>()
const qa=(window as any).qa={calls:[] as any[],aiCalls:0,applied:0,unknown:false,deferred:false,release:undefined,opened:[] as string[],setShow:(_value:boolean)=>{},snapshot:()=>memory.bind<any>(scope,'assistant').initial,pending:()=>pending.count(),dropThread:()=>{const binding=memory.bind<any>(scope,'assistant');binding.save({...binding.initial,thread:undefined},true)}}
let serial=0
const server:AssistantServer={
  readiness:async()=>({available:true}), list:async()=>({items:[],nextCursor:null}),
  get:async(_memberId,id)=>{const thread=threads.get(id);if(!thread)throw new AssistantError('NOT_FOUND');return structuredClone(thread)},
  async ask(memberId,input,key){
    qa.calls.push(structuredClone({kind:'ask',memberId,input,key}));if(asks.has(key))return structuredClone(asks.get(key)!)
    qa.aiCalls++;const index=++serial
    const thread:AssistantThread={id:'thread-'+index,mode:input.mode,version:1,title:'시험 할 일 초안',nextCursor:null,exchanges:[{
      id:'exchange-'+index,requestKey:key,intent:input.intent,prompt:input.prompt,segments:[{text:'안내장 준비를 할 일 초안으로 정리했습니다.',citations:[]}],
      proposal:{id:'proposal-'+index,version:1,kind:'create_personal_task',input:{title:'안내장 준비',notes:'입력한 내용',dueDate:'2026-11-18'},status:'pending',resourceId:null},
      createdAt:'2026-11-13T01:00:00Z',studentContext:null,execution:{quality:'quick',model:ASSISTANT_ROUTING.models.quick.id,reviewOf:null},
    }]}
    threads.set(thread.id,thread);const result={state:'completed' as const,requestKey:key,thread};asks.set(key,result);return structuredClone(result)
  },
  async confirmTask(memberId,input,key){
    qa.calls.push(structuredClone({kind:'confirmTask',memberId,input,key}));if(tasks.has(key))return structuredClone(tasks.get(key)!)
    qa.applied++;const result={requestKey:key,proposalId:input.proposalId,proposalVersion:input.expectedVersion+1,taskId:'task-'+qa.applied,taskVersion:1,threadVersion:2}
    tasks.set(key,result);const thread=threads.get(input.threadId)!
    thread.version=2;thread.exchanges=thread.exchanges.map(exchange=>exchange.proposal?.id===input.proposalId?{...exchange,proposal:{...exchange.proposal,status:'applied',version:result.proposalVersion,resourceId:result.taskId}}:exchange)
    if(qa.deferred){qa.deferred=false;await new Promise<void>(resolve=>{qa.release=resolve})}
    if(qa.unknown){qa.unknown=false;throw new AssistantError('RESULT_UNKNOWN')}
    return structuredClone(result)
  },
}
const connection:any={info:()=>({schools:[{id:member.schoolId}],memberships:[member],basisDate:date}),getIdentity:async()=>({userId:member.userId,approved:true})}
const actions:any={navigate:()=>true,calendar:()=>true,search:async()=>({items:[],coverage:[],hasMore:false}),open:(item:any)=>{qa.opened.push(item.id);return true}}
const settingsServer:any={status:async()=>{throw new AssistantError('NOT_READY')}}
function App(){const[show,setShow]=useState(true);qa.setShow=setShow;return <EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}>{show&&<AssistantPanel connection={connection} member={member} date={date} revision={0} server={server} settingsServer={settingsServer} workspaceActions={actions} onOpenTask={id=>{qa.opened.push(id);return true}}/>}</PendingRequestsProvider></EditDraftsProvider>}
createRoot(document.getElementById('root')!).render(<App/> )
