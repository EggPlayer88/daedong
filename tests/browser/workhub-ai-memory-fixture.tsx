import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AiMemoryPanel} from '../../apps/workhub/src/assistant/AiMemoryPanel'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {createAiMemoryService} from '../../apps/workhub/src/assistant/memory-server'
import {composeMemoryPrompt} from '../../apps/workhub/src/assistant/memory-prompt'
import {askResult,ASSISTANT_ROUTING} from '../../apps/workhub/src/assistant/contracts'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests,PendingRequestsProvider,recoveryScope} from '../../apps/workhub/src/app/pending-requests'
import {canonical} from '../../apps/workhub/src/services/scoped-rpc'
import styles from '../../apps/workhub/src/assistant/assistant.css?inline'

const w=window as any,clone=structuredClone,today='2026-10-21',stamp='2026-10-21T00:00:00.000Z'
const original={id:'memory-teacher',userId:'memory-user',schoolId:'memory-school',name:'가상 기억 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let current=original
const entry=(id:string,title:string,body:string,patch:any={})=>({id,schoolId:original.schoolId,memberId:original.id,version:1,title,body,category:'preference',enabled:true,expiresOn:null,createdAt:stamp,updatedAt:stamp,...patch})
const rows=new Map<string,any>([
 ['a-style',entry('a-style','답변 방식','짧은 문단으로 정리해 주세요')],
 ['b-routine',entry('b-routine','주간 업무 정리','금요일에 다음 주 준비를 정리합니다',{category:'routine'})],
 ['c-paused',entry('c-paused','잠시 꺼 둔 기억','참고하면 안 되는 중지 내용',{enabled:false})],
 ['d-expired',entry('d-expired','기간이 지난 기억','참고하면 안 되는 지난 내용',{expiresOn:'2026-10-20'})],
 ['e-today',entry('e-today','오늘까지인 기억','오늘은 참고할 수 있는 내용',{expiresOn:today})],
])
const ledger=new Map<string,{command:any,result:any}>()
w.calls=[];w.asks=[];w.used=[];w.pending=createPendingRequests();w.drafts=createEditDrafts();w.canWrite=true
const envelope=(data:any)=>({contract:'memory.v1',schoolId:current.schoolId,memberId:current.id,data:clone(data)})
const error=(code:string)=>({contract:'memory.v1',schoolId:current.schoolId,memberId:current.id,error:{code}})
const owned=()=>[...rows.values()].filter(row=>row.schoolId===current.schoolId&&row.memberId===current.id).sort((a,b)=>a.id.localeCompare(b.id))
const connection:any={
 info:()=>({memberships:[current],schools:[{id:current.schoolId}],basisDate:today}),
 getIdentity:async()=>({userId:current.userId,approved:!w.revoked,profile:{id:current.userId,role:'superadmin',is_active:true,extra_permissions:[],department_id:null}}),
 rpcVerified:async(name:string,args:any)=>{
  w.calls.push(clone({name,args}))
  if(name==='workhub_ai_memory_list'){
   if(w.listError)return error(w.listError)
   const value=envelope({items:owned(),today,canWrite:w.canWrite})
   if(w.deferList){w.deferList=false;await new Promise(resolve=>w.resolveList=resolve)}
   return value
  }
  if(name==='workhub_ai_memory_select'){
   if(w.selectError)return error(w.selectError)
   const selected=[]
   for(const ref of args.p_references){const row=rows.get(ref.id);if(!row||row.schoolId!==current.schoolId||row.memberId!==current.id)return error('NOT_FOUND');if(row.version!==ref.version||!row.enabled||row.expiresOn&&row.expiresOn<today)return error('CONFLICT');selected.push(row)}
   const value=envelope({items:selected,today})
   if(w.deferSelect){w.deferSelect=false;await new Promise(resolve=>w.resolveSelect=resolve)}
   return value
  }
  if(!['workhub_ai_memory_mutate','workhub_ai_memory_recover','workhub_ai_memory_close'].includes(name))throw Error('예상하지 않은 RPC '+name)
  const command=args.p_command,key=args.p_request_key,stored=ledger.get(key)
  if(stored){if(canonical(stored.command)!==canonical(command))return error('IDEMPOTENCY_CONFLICT');if(stored.result.state==='closed'&&name==='workhub_ai_memory_mutate')return error('CONFLICT');return envelope(stored.result)}
  if(name==='workhub_ai_memory_recover')return envelope({state:'missing',requestKey:key})
  if(name==='workhub_ai_memory_close'){
   const result={state:'closed',requestKey:key};ledger.set(key,{command:clone(command),result})
   if(w.closeUnknown){w.closeUnknown=false;throw Error('합성 닫기 응답 유실')}
   return envelope(result)
  }
  if(w.unknownBefore){w.unknownBefore=false;throw Error('합성 접수 전 응답 유실')}
  if(!w.canWrite&&command.kind!=='delete')return error('NOT_READY')
  const before=rows.get(command.id)
  if(w.forceConflict&&before){w.forceConflict=false;before.version++;before.body='다른 탭에서 수정한 원본';return error('CONFLICT')}
  if(command.kind==='create'){
   if(before)return error('CONFLICT')
   rows.set(command.id,entry(command.id,command.title,command.body,{...command,schoolId:current.schoolId,memberId:current.id}))
   delete rows.get(command.id).kind;delete rows.get(command.id).confirmed
  }else{
   if(!before||before.schoolId!==current.schoolId||before.memberId!==current.id)return error('NOT_FOUND')
   if(before.version!==command.expectedVersion)return error('CONFLICT')
   if(command.kind==='delete')rows.delete(command.id)
   else rows.set(command.id,{...before,title:command.title,body:command.body,category:command.category,enabled:command.enabled,expiresOn:command.expiresOn,version:before.version+1,updatedAt:stamp})
  }
  const result={state:'applied',requestKey:key,kind:command.kind,entryId:command.id,version:command.kind==='create'?1:command.expectedVersion+1}
  ledger.set(key,{command:clone(command),result})
  if(w.unknownAfter){w.unknownAfter=false;throw Error('합성 저장 후 응답 유실')}
  return envelope(result)
 }
}
const memoryService=createAiMemoryService(connection)
w.memoryService=memoryService;w.source=()=>clone(owned());w.modify=(id:string)=>{const row=rows.get(id);row.version++;row.body='서버에서 바뀐 내용'};w.receipts=()=>clone([...ledger]);w.restoreRequest=(command:any,key:string)=>w.pending.put(recoveryScope(current),'assistantMemory',{command,key})
let thread:any=null
const assistant:any={readiness:async()=>({available:true}),list:async()=>({items:[],nextCursor:null}),get:async()=>clone(thread),ask:async(_:string,input:any,key:string)=>{
 w.asks.push(clone({input,key}));thread={id:'memory-thread',mode:input.mode,version:(thread?.version??0)+1,title:'기억을 선택한 질문',nextCursor:null,exchanges:[{id:'memory-exchange',requestKey:key,intent:input.intent,prompt:input.prompt,segments:[{text:'선택한 참고 사본을 바탕으로 정리한 합성 답변입니다.',citations:[]}],proposal:null,createdAt:stamp,studentContext:null,...(input.quality?{execution:{quality:input.quality,model:ASSISTANT_ROUTING.models[input.quality as 'quick'|'review'].id,reviewOf:input.reviewOf}}:{})}]};return askResult({state:'completed',requestKey:key,thread},key)
}}
const settings:any={status:async()=>{throw Error('합성 설정 미준비')}}
function App(){const[actor,setActor]=useState(original),[revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[draft,setDraft]=useState('이번 주 준비를 도와주세요')
 w.refresh=()=>setRevision(v=>v+1);w.remount=()=>{setMounted(false);setTimeout(()=>setMounted(true),0)}
 w.switchSchool=()=>{current={...original,id:'memory-other-teacher',userId:'memory-other-user',schoolId:'memory-other-school'};w.drafts.clear();setActor(current)}
 return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style>{w.integrated?<AssistantPanel connection={connection} member={actor as any} date={today} revision={revision} server={assistant} settingsServer={settings} memoryServer={memoryService} onNavigationLockChange={value=>w.locked=value}/>:<><label>확인할 질문<textarea aria-label="확인할 질문" value={draft} onChange={e=>setDraft(e.target.value)}/></label>{mounted&&<AiMemoryPanel key={actor.id} connection={connection} member={actor as any} date={today} revision={revision} canUse={!w.noUse} blocked={Boolean(w.blocked)} service={memoryService} onUse={items=>{w.used.push(clone(items));setDraft(previous=>composeMemoryPrompt(previous,items))}} onLockChange={value=>w.locked=value}/>}</>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
