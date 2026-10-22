import React,{useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {GuidedWorkspace} from '../../apps/workhub/src/documents/GuidedWorkspace'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {askResult,ASSISTANT_ROUTING} from '../../apps/workhub/src/assistant/contracts'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests,PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {createWorkflowStore} from '../../apps/workhub/src/workflows/store'
import {ContractError} from '../../apps/workhub/src/contracts'
import styles from '../../apps/workhub/src/documents/documents.css?inline'

const w=window as any,clone=structuredClone
const localMember={id:'virtual-teacher',userId:'virtual-user',schoolId:'virtual-school',name:'가상 담당 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const data=clone(fixtureData),calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate})
const initialContext={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels}
const member=w.connected?data.memberships.find(m=>m.id==='gaon-soyeon')!:localMember
let current=member
const anchor=(n:number,sourceText:string,row:number,column:number)=>({id:`Contents/section0.xml:p${String(n).padStart(6,'0')}`,section:'Contents/section0.xml',paragraph:n,sourceText,sourceHash:'a'.repeat(64),cell:{row:String(row),column:String(column)}})
const anchors=[anchor(0,'활동명:',0,0),anchor(1,'',0,1),anchor(2,'실시일:',1,0),anchor(3,'',1,1),anchor(4,'기존 계획 원문을 보존합니다',2,1)]
const mapping={profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),questions:[{id:'existing-question',label:'기존 질문',kind:'longtext',required:true,maxLength:500,options:[],anchorId:anchors[4].id,sourceText:anchors[4].sourceText,sourceHash:anchors[4].sourceHash}]}
let template:any={id:'setup-template',schoolId:member.schoolId,ownerMemberId:member.id,title:'가상 학교 행사 양식',version:2,state:'draft',inspection:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs:w.complex?2:0},mapping,collectionRequestId:null,canManage:true}
let response:any={id:'setup-response',templateId:template.id,templateVersion:2,schoolId:member.schoolId,ownerMemberId:member.id,version:3,answers:{'existing-question':'저장된 기존 답변'},preview:true,artifact:null}
const secondTemplate={...clone(template),id:'setup-template-second',title:'가상 안전교육 양식'}
const secondResponse={...clone(response),id:'setup-response-second',templateId:secondTemplate.id}
const envelope=(value:any)=>({contract:'guided.v1',schoolId:current.schoolId,memberId:current.id,data:clone(value)})
const aiEnvelope=(value:any)=>({contract:'assistant.v1',schoolId:current.schoolId,memberId:current.id,data:clone(value)})
w.calls=[];w.asks=[];w.fileOpens=0;w.pending=createPendingRequests();w.drafts=createEditDrafts();w.receipts=new Map()
w.replyBody=JSON.stringify({mode:'guided',reason:'선택한 두 빈 문단에 활동명과 실시일을 묻습니다.',questions:[{anchorId:anchors[1].id,label:'활동 이름은 무엇인가요?',kind:'text',required:true,maxLength:200,options:[]},{anchorId:anchors[3].id,label:'언제 실시하나요?',kind:'date',required:true,maxLength:10,options:[]}]})
w.source=()=>clone({template,response})
const connection:any={info:()=>w.connected?clone(initialContext):({memberships:[current],schools:[{id:current.schoolId}],basisDate:'2026-10-21'}),loadContext:async()=>clone(initialContext),subscribeIdentity:()=>()=>{},subscribeInvalidation:()=>()=>{},getIdentity:async()=>({userId:current.userId,approved:true,profile:{id:current.userId,name:'가상 담당 교사',email:'virtual@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push(clone({name,args}))
 if(name==='workhub_template_list')return envelope({items:current.schoolId===member.schoolId?[template,secondTemplate]:[],nextCursor:null,canCreate:current.schoolId===member.schoolId})
 if(name==='workhub_template_get'){
  if(w.getError)return {contract:'guided.v1',schoolId:current.schoolId,memberId:current.id,error:{code:w.getError}}
  const result=envelope(args.p_template_id===secondTemplate.id?{template:secondTemplate,response:secondResponse}:{template,response})
  if(w.deferGet){w.deferGet=false;await new Promise(resolve=>w.resolveGet=resolve)}
  return result
 }
 if(name==='workhub_template_collection_targets')return envelope({items:[]})
 if(name==='workhub_template_mutate'||name==='workhub_template_request_get'){
  const command=args.p_command,key=args.p_request_key
  if(w.receipts.has(key))return envelope(w.receipts.get(key))
  if(command.kind!=='save_mapping')throw Error('예상하지 않은 쓰기 '+command.kind)
  template={...template,title:command.title,mapping:clone(command.mapping),version:template.version+1};response=null
  const result={requestKey:key,templateId:template.id,templateVersion:template.version,responseId:null,responseVersion:null};w.receipts.set(key,result)
  if(w.unknown){w.unknown=false;throw Error('synthetic unknown')}
  return envelope(result)
 }
 if(name==='workhub_calendar_list')return calendar.list(args.p_member_id)
 if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id)
 if(name==='workhub_document_list')return{contract:'documents.v1',schoolId:member.schoolId,memberId:member.id,data:{items:[],nextCursor:null,canShare:false}}
 if(name==='workhub_ai_policy_threads_list')return aiEnvelope({items:[],nextCursor:null})
 if(name==='workhub_ai_policy_thread_get')return aiEnvelope(thread)
 if(/mutate|commit|save|render|publish/.test(name))throw Error('예상하지 않은 쓰기 '+name)
 throw new ContractError('QUERY_FAILED','선택 기능은 합성 시험 범위 밖입니다')
}}
let thread:any=null
const assistant:any={readiness:async()=>({available:true}),list:async()=>({items:[],nextCursor:null}),get:async()=>clone(thread),ask:async(_:string,input:any,key:string)=>{
 w.asks.push(clone({input,key}));thread={id:'setup-ai-thread',mode:input.mode,version:(thread?.version??0)+1,title:'질문과 빈칸 연결 제안',nextCursor:null,exchanges:[{id:'setup-exchange',requestKey:key,intent:input.intent,prompt:input.prompt,segments:[{text:w.replyBody,citations:[]}],proposal:null,createdAt:'2026-10-21T00:00:00Z',studentContext:null,...(input.quality?{execution:{quality:input.quality,model:ASSISTANT_ROUTING.models[input.quality as 'quick'|'review'].id,reviewOf:input.reviewOf}}:{})}]};return askResult({state:'completed',requestKey:key,thread},key)
}}
w.aiPort={async send(payload:any){return aiEnvelope(payload.action==='readiness'?{available:true}:await assistant.ask(payload.memberId,payload.input,payload.requestKey))}}
function App(){const[page,setPage]=useState('guided'),[request,setRequest]=useState<any>(),[suggestion,setSuggestion]=useState<any>(),[actor,setActor]=useState(member),[revision,setRevision]=useState(0)
 // 시험에서 갱신 요청과 실제 React 반영을 구분한다. 하위 화면의 이전 요청 정리가 끝난 뒤 표시한다.
 useEffect(()=>{w.appliedRevision=revision},[revision])
 w.changeTemplate=()=>{template={...template,version:3};response=response?{...response,templateVersion:3}:null}
 w.changeSource=()=>{template={...template,inspection:{...template.inspection,templateSha256:'c'.repeat(64)}}}
 w.changeScope=()=>{current={...localMember,id:'other-teacher',userId:'other-user',schoolId:'other-school'};setActor(current)}
 w.refresh=()=>{setRevision(v=>v+1);return revision+1}
 return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style>{page==='guided'?<GuidedWorkspace key={actor.id} connection={connection} member={actor as any} date="2026-10-21" revision={revision} setupAiSuggestion={suggestion} onRequestGuidedSetupAi={value=>{w.lastRequest=clone(value);setRequest(value);setPage('assistant')}} onOpenFileCollections={()=>{w.fileOpens++}} onNavigationLockChange={value=>w.locked=value}/>:<AssistantPanel connection={connection} member={actor as any} date="2026-10-21" server={assistant} contextRequest={request?{id:request.origin.id,request:{mode:'personal',intent:'guided_collection',prompt:request.request.title+'\n\n'+request.request.details,references:[],studentContext:null}}:undefined} onDraftReady={(value,contextId)=>{w.returnContext=contextId;if(request&&contextId===request.origin.id){setSuggestion({origin:request.origin,requestId:value.requestKey,body:value.segments.map(s=>s.text).join('\n\n')});setPage('guided')}}}/>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{w.connected?<ConnectedWorkspace expectedUserId={member.userId} legacyHomeHref="/legacy" connection={connection}/>:<App/>}</React.StrictMode>)
