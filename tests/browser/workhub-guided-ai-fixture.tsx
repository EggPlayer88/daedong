import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {GuidedWorkspace} from '../../apps/workhub/src/documents/GuidedWorkspace'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {askResult} from '../../apps/workhub/src/assistant/contracts'
import {guidedAiSuggestion,type GuidedAiRequest,type GuidedAiSuggestion} from '../../apps/workhub/src/documents/guided-ai'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests,PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {createWorkflowStore} from '../../apps/workhub/src/workflows/store'
import {ContractError} from '../../apps/workhub/src/contracts'
import styles from '../../apps/workhub/src/documents/documents.css?inline'
const w=window as any,clone=structuredClone
const localMember={id:'member',userId:'user',schoolId:'school',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const data=clone(fixtureData),calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate})
const initialContext={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels}
const member=w.connected?data.memberships.find(m=>m.id==='gaon-soyeon')!:localMember
let current=member
const anchors=[0,1].map(n=>({id:`Contents/section0.xml:p00000${n}`,section:'Contents/section0.xml',paragraph:n,sourceText:'원문',sourceHash:'a'.repeat(64),cell:null}))
const mapping={profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),questions:anchors.map((a,n)=>({id:`q${n}`,label:n?'참여 인원':'참여 계획',kind:n?'number':'longtext',required:true,maxLength:n?10:200,options:[],anchorId:a.id,sourceText:a.sourceText,sourceHash:a.sourceHash}))}
let template={id:'template',schoolId:member.schoolId,ownerMemberId:'other',title:'원래 참여 양식',version:2,state:'published',inspection:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs:0},mapping,collectionRequestId:'collection',canManage:false}
let response={id:'response',templateId:'template',templateVersion:2,schoolId:member.schoolId,ownerMemberId:member.id,version:3,answers:{q0:'저장된 계획',q1:'3'},preview:false,artifact:null}
const envelope=(data:any)=>({contract:'guided.v1',schoolId:current.schoolId,memberId:current.id,data})
w.calls=[];w.asks=[];w.pending=createPendingRequests();w.drafts=createEditDrafts();w.receipts=new Map()
const connection:any={info:()=>w.connected?clone(initialContext):({memberships:[current],schools:[{id:current.schoolId}],basisDate:'2026-10-21'}),loadContext:async()=>clone(initialContext),subscribeIdentity:()=>()=>{},subscribeInvalidation:()=>()=>{},getIdentity:async()=>({userId:current.userId,approved:true,profile:{id:current.userId,name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push(clone({name,args}))
 if(name==='workhub_template_list')return envelope({items:current.schoolId===member.schoolId?[template]:[],nextCursor:null,canCreate:false})
 if(name==='workhub_template_get'){
  if(w.readFail)throw Error('synthetic read failure')
  const value=envelope(clone({template,response}))
  if(w.deferGet){w.deferGet=false;await new Promise(resolve=>{w.resolveGet=resolve})}
  return value
 }
 if(name==='workhub_template_mutate'||name==='workhub_template_request_get'){
  const command=args.p_command,key=args.p_request_key
  if(w.receipts.has(key))return envelope(w.receipts.get(key))
  response={...response,version:response.version+1,answers:clone(command.answers)}
  const result={requestKey:key,templateId:'template',templateVersion:2,responseId:'response',responseVersion:response.version};w.receipts.set(key,result)
  if(w.unknown){w.unknown=false;throw Error('synthetic unknown')}
  return envelope(result)
 }
 if(name==='workhub_calendar_list')return calendar.list(args.p_member_id)
 if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id)
 if(name==='workhub_document_list')return {contract:'documents.v1',schoolId:member.schoolId,memberId:member.id,data:{items:[],nextCursor:null,canShare:false}}
 if(name==='workhub_ai_threads_list')return {contract:'assistant.v1',schoolId:member.schoolId,memberId:member.id,data:{items:[],nextCursor:null}}
 if(name==='workhub_ai_thread_get')return {contract:'assistant.v1',schoolId:member.schoolId,memberId:member.id,data:clone(thread)}
 if(/mutate|commit|save|render|publish/.test(name))throw Error('unexpected write '+name)
 throw new ContractError('QUERY_FAILED','선택 기능은 합성 시험에 포함하지 않습니다')
}}
let thread:any=null
const assistant:any={readiness:async()=>({available:true}),list:async()=>({items:[],nextCursor:null}),get:async()=>clone(thread),ask:async(_:string,input:any,key:string)=>{
 w.asks.push(clone({input,key}));thread={id:'thread',mode:input.mode,version:(thread?.version??0)+1,title:'질문형 작성 도움',nextCursor:null,exchanges:[...(thread?.exchanges??(w.includeOld?[{id:'old-exchange',requestKey:'old-request',intent:'guided_collection',prompt:'이전의 다른 양식 질문',segments:[{text:'다른 양식의 과거 제안',citations:[]}],proposal:null,createdAt:'2026-10-20T00:00:00Z',studentContext:null}]:[])),{id:'exchange-'+key,requestKey:key,intent:input.intent,prompt:input.prompt,segments:[{text:'제안한 참여 계획',citations:[]}],proposal:null,createdAt:'2026-10-21T00:00:00Z',studentContext:null}]};return askResult({state:'completed',requestKey:key,thread},key)
}}
w.aiPort={async send(payload:any){const data=payload.action==='readiness'?{available:true}:await assistant.ask(payload.memberId,payload.input,payload.requestKey);return {contract:'assistant.v1',schoolId:member.schoolId,memberId:member.id,data}}}
function App(){const[page,setPage]=useState('guided'),[request,setRequest]=useState<GuidedAiRequest>(),[suggestion,setSuggestion]=useState<GuidedAiSuggestion>(),[actor,setActor]=useState(member),[mounted,setMounted]=useState(true),[error,setError]=useState('')
 w.changeTemplate=()=>{template={...template,version:3};response={...response,templateVersion:3}}
 w.changeResponse=()=>{response={...response,version:4}}
 w.changeScope=()=>{current={...member,id:'member2',userId:'user2',schoolId:'school2'};setActor(current)}
 w.unmount=()=>setMounted(false);w.remount=()=>setMounted(true)
 w.returnRaw=()=>{if(request){setSuggestion(guidedAiSuggestion({origin:request.origin,requestId:'late-request',body:'제안한 참여 계획'},actor));setPage('guided')}}
 return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><p role="status">{error}</p>{mounted&&(page==='guided'?<GuidedWorkspace connection={connection} member={actor as any} date="2026-10-21" aiSuggestion={suggestion} onRequestGuidedAi={value=>{w.lastRequest=clone(value);setRequest(value);setPage('assistant')}} onNavigationLockChange={value=>{w.locked=value}}/>:<AssistantPanel connection={connection} member={actor as any} date="2026-10-21" server={assistant} contextRequest={request?{id:request.origin.id,request:{mode:'personal',intent:'guided_collection',prompt:request.request.title+'\n\n'+request.request.details,references:[],studentContext:null}}:undefined} onDraftReady={(value,contextId)=>{w.returnContext=contextId;if(!request||contextId!==request.origin.id){setError('원래 양식 요청을 찾지 못했습니다');return}setSuggestion(guidedAiSuggestion({origin:request.origin,requestId:value.requestKey,body:value.segments.map(s=>s.text).join('\n\n')},actor));setPage('guided')}}/>)}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{w.connected?<ConnectedWorkspace expectedUserId={member.userId} legacyHomeHref='/legacy' connection={connection}/>:<App/>}</React.StrictMode>)
