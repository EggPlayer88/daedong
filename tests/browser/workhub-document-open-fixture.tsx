import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {DocumentsWorkspace} from '../../apps/workhub/src/documents/DocumentsWorkspace'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider,createPendingRequests} from '../../apps/workhub/src/app/pending-requests'

// 검색 결과의 식별자·저장판을 실제 전송 어댑터와 화면에 넣는다. DB·외부 호출은 하지 않는다.
const w=window as any,clone=structuredClone
const member={id:'member',userId:'user',schoolId:'school',name:'가상 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let current=member
const base={id:'visible',schoolId:'school',ownerMemberId:'member',version:3,latestVersion:3,status:'confirmed',updatedAt:'2026-10-21T00:00:00Z',canEdit:true,origin:null,title:'같은 이름의 문서',kind:'general',body:'목록에 보이는 다른 문서',visibility:'private',sources:[],basisDate:'2026-10-21',studentContext:null}
const docs:any={visible:[{...base}],hidden:[{...base,id:'hidden',version:1,canEdit:false,body:'목록 밖 과거 저장판 본문',updatedAt:'2026-10-19T00:00:00Z'},{...base,id:'hidden',version:2,canEdit:false,body:'목록 밖 두 번째 저장판',updatedAt:'2026-10-20T00:00:00Z'},{...base,id:'hidden',body:'목록 밖 최신 저장판 본문'}]}
const anchor={id:'Contents/section0.xml:p000000',section:'Contents/section0.xml',paragraph:0,sourceText:'빈칸',sourceHash:'b'.repeat(64),cell:null}
const question={id:'q',label:'행사 안내',kind:'text',required:true,maxLength:500,options:[],anchorId:anchor.id,sourceText:anchor.sourceText,sourceHash:anchor.sourceHash}
const inspection={profile:'explicit_paragraph_v1',templateSha256:'a'.repeat(64),anchors:[anchor],unsupportedParagraphs:0}
const template={id:'template',schoolId:'school',ownerMemberId:'other',title:'가상 질문형 양식',version:1,state:'published',inspection,mapping:{profile:'explicit_paragraph_v1',templateSha256:'a'.repeat(64),questions:[question]},collectionRequestId:'collection',canManage:false}
let response={id:'answer',templateId:'template',templateVersion:1,schoolId:'school',ownerMemberId:'member',version:1,answers:{q:'저장한 답변'},preview:false,artifact:null}
w.calls=[];w.drafts=createEditDrafts();w.pending=createPendingRequests();w.receipts=new Map()
const envelope=(contract:string,data:any)=>({contract,schoolId:current.schoolId,memberId:current.id,data})
const connection:any={info:()=>({memberships:[current],schools:[{id:current.schoolId}],basisDate:'2026-10-21'}),getIdentity:async()=>({userId:current.userId,approved:true}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push(clone({name,args}))
 if(name==='workhub_document_list'){if(w.listFail)throw Error('synthetic list failure');return envelope('documents.v1',{items:current.id===member.id?[docs.visible.at(-1)]:[],nextCursor:null,canShare:true})}
 if(name==='workhub_document_history'){
  if(w.historyFail)throw Error('synthetic history failure')
  const raw=envelope('documents.v1',{documentId:w.wrongHistory?'different':args.p_document_id,versions:docs[args.p_document_id].filter((d:any)=>!w.historyRecentOnly||d.version===3).slice().reverse().map((d:any)=>({version:d.version,recordedAt:d.updatedAt,status:d.status}))})
  if(w.deferHistory){w.deferHistory=false;await new Promise(resolve=>{w.resolveHistory=resolve})}
  return raw
 }
 if(name==='workhub_document_get'){
  if(w.readFail)throw Error('synthetic read failure')
  if(w.denied)return {contract:'documents.v1',schoolId:current.schoolId,memberId:current.id,error:{code:'FORBIDDEN'}}
  let result=clone(args.p_version===null?docs[args.p_document_id]?.at(-1):docs[args.p_document_id]?.find((d:any)=>d.version===args.p_version))
  if(!result)return{contract:'documents.v1',schoolId:current.schoolId,memberId:current.id,error:{code:'NOT_FOUND'}}
  if(w.wrongId)result.id='different'
  if(w.wrongVersion)result=clone(docs[args.p_document_id].at(-1))
  const raw=envelope('documents.v1',result)
  if(w.deferGet){w.deferGet=false;await new Promise(resolve=>{w.resolveGet=resolve})}
  return raw
 }
 if(name==='workhub_document_mutate'||name==='workhub_document_request_get'){
  const key=args.p_request_key
  if(w.receipts.has(key))return envelope('documents.v1',w.receipts.get(key))
  const command=args.p_command,id=command.documentId??'visible',version=(docs[id]?.at(-1)?.version??0)+1
  docs[id].push({...docs[id].at(-1),...command.input,version,latestVersion:version,updatedAt:'2026-10-21T01:00:00Z'})
  const receipt={documentId:id,version,requestKey:key,recordedAt:'2026-10-21T01:00:00Z'}
  w.receipts.set(key,receipt)
  if(w.unknown){w.unknown=false;throw Error('synthetic result unknown')}
  return envelope('documents.v1',receipt)
 }
 if(name==='workhub_template_list')return envelope('guided.v1',{items:[template],nextCursor:null,canCreate:true})
 if(name==='workhub_template_get')return envelope('guided.v1',{template,response})
 if(name==='workhub_template_mutate'||name==='workhub_template_request_get'){
  const key=args.p_request_key
  if(w.receipts.has(key))return envelope('guided.v1',w.receipts.get(key))
  response={...response,version:response.version+1,answers:args.p_command.answers}
  const receipt={requestKey:key,templateId:'template',templateVersion:1,responseId:'answer',responseVersion:response.version}
  w.receipts.set(key,receipt)
  if(w.unknown){w.unknown=false;throw Error('synthetic result unknown')}
  return envelope('guided.v1',receipt)
 }
 throw Error('unexpected RPC '+name)
}}
function App(){const[actor,setActor]=useState(member),[request,setRequest]=useState<any>(w.initialRequest),[revision,setRevision]=useState(0)
 w.openDocument=(id='hidden',version=1)=>setRequest({key:crypto.randomUUID(),id,version})
 w.openExact=(next:any)=>setRequest(next)
 w.changeScope=()=>{current={...member,id:'other',userId:'other-user',schoolId:'other-school'};setActor(current)}
 w.refresh=()=>setRevision(v=>v+1)
 return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><DocumentsWorkspace connection={connection} member={actor as any} date="2026-10-21" revision={revision} openRequest={request} onNavigationLockChange={value=>{w.locked=value}}/></PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
