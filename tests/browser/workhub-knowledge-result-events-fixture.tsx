import React,{useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {KnowledgeWorkspace} from '../../apps/workhub/src/knowledge/KnowledgeWorkspace'
import {KnowledgeImport} from '../../apps/workhub/src/knowledge/KnowledgeImport'
import {createKnowledgeImportService} from '../../apps/workhub/src/knowledge/import-adapter'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider,createPendingRequests,recoveryScope} from '../../apps/workhub/src/app/pending-requests'

// 실제 React·자료 서비스·가져오기 서비스를 사용하고 서버 원장과 Storage 전송만 합성한다.
const w=window as any,copy=structuredClone,stamp='2026-10-16T01:02:03Z'
let member={id:'member-a',schoolId:'school-a',userId:'user-a',name:'합성 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const source={id:'source-a',schoolId:'school-a',authorMemberId:'member-a',title:'합성 학교 규정',kind:'regulation',body:'민감한 원문은 결과에 복제하지 않음',locator:'제3조 2항',effectiveFrom:'2026-03-01',effectiveThrough:'2027-02-28',version:1,status:'draft',updatedAt:stamp}
const sources=[source],receipts=new Map<string,any>(),extractions=new Map<string,any>(),reservations=new Map<string,any>()
const pending=createPendingRequests(),drafts=createEditDrafts()
const qa=w.qa={calls:[] as any[],ports:[] as any[],results:[] as any[],listeners:[] as string[],created:[] as any[],writes:0,canManage:true,available:true,identityRole:'teacher',approved:true,
 sources,pending:()=>copy(pending.get(recoveryScope(member),'knowledge')??pending.get(recoveryScope(member),'knowledgeImport')),pendingCount:()=>pending.count(),receipt:(key:string)=>copy(receipts.get(key)),forgetDrafts:()=>{drafts.bind(recoveryScope(member),'knowledge-editor').remove();drafts.bind(recoveryScope(member),'knowledge-import').remove()}} as any
const envelope=(contract:string,data:any)=>({contract,schoolId:member.schoolId,memberId:member.id,data})
const reject=(contract:string,code:string)=>({contract,schoolId:member.schoolId,memberId:member.id,error:{code}})
async function respond(value:any,stage:string){
 if(qa.hold===stage){qa.hold=undefined;await new Promise(resolve=>qa.release=resolve)}
 if(qa.unknown&&['mutate','commit'].includes(stage)){qa.unknown=false;throw Error('합성 저장 후 응답 유실')}
 if(qa.badReceipt&&['mutate','commit'].includes(stage))value={...value,data:{...value.data,...qa.badReceipt}}
 return copy(value)
}
const connection:any={
 info:()=>({memberships:[member],schools:[{id:member.schoolId}],basisDate:'2026-10-16'}),
 getIdentity:async()=>({userId:member.userId,approved:qa.approved,profile:{id:member.userId,role:qa.identityRole,is_active:true,extra_permissions:[],department_id:null}}),
 async rpcVerified(name:string,args:any){
  qa.calls.push(copy({name,args}))
  if(name==='workhub_knowledge_list'){if(qa.failRead)throw Error('합성 후속 조회 실패');return envelope('knowledge.v1',{items:copy(sources),nextCursor:null,canManage:qa.canManage})}
  if(name==='workhub_knowledge_history'){const row=sources.find(s=>s.id===args.p_source_id)!;return envelope('knowledge.v1',{sourceId:row.id,authorMemberId:row.authorMemberId,items:[{version:row.version,status:row.status,title:row.title,recordedAt:row.updatedAt,isCurrent:true}],nextBeforeVersion:null,canManage:qa.canManage})}
  if(name==='workhub_knowledge_original_access')return envelope('knowledge-import.v1',{available:false})
  if(name==='workhub_knowledge_mutate'){
   const key=args.p_request_key,command=args.p_command
   if(receipts.has(key))return respond(envelope('knowledge.v1',receipts.get(key)),'mutate')
   if(qa.reject)return reject('knowledge.v1',qa.reject)
   let row=sources.find(s=>s.id===command.id)
   if(command.kind==='create'){row={...source,...copy(command.input),id:'created-'+(++qa.writes),version:1,status:'draft'};sources.push(row!)}
   else{if(!row||row.version!==command.expectedVersion||command.kind==='update'&&row.status!=='draft')return reject('knowledge.v1','CONFLICT');row.version++;if(command.kind==='update')Object.assign(row,copy(command.input));else row.status=command.kind==='publish'?'published':'retired';qa.writes++}
   const receipt={id:row!.id,version:row!.version,requestKey:key,recordedAt:stamp};receipts.set(key,copy(receipt));return respond(envelope('knowledge.v1',receipt),'mutate')
  }
  if(name==='workhub_knowledge_import_readiness')return respond(envelope('knowledge-import.v1',{available:qa.available}),'ready')
  if(name==='workhub_knowledge_file_prepare'||name==='workhub_knowledge_file_prepare_get'){
   const key=args.p_request_key
   if(!reservations.has(key)){if(name.endsWith('_get'))return reject('knowledge-import.v1','NOT_FOUND');reservations.set(key,{fileId:'file-a',fileVersion:1,bucket:'workhub-knowledge-files',path:'school-a/member-a/file-a/original.hwpx',bytes:args.p_file.bytes,sha256:args.p_file.sha256,uploaded:false})}
   return respond(envelope('knowledge-import.v1',reservations.get(key)),'prepare')
  }
  if(name==='workhub_knowledge_file_extract_get')return envelope('knowledge-import.v1',extractions.get(args.p_request_key))
  if(name==='workhub_knowledge_import_commit'||name==='workhub_knowledge_import_request_get'){
   const key=args.p_request_key
   if(receipts.has(key))return respond(envelope('knowledge-import.v1',receipts.get(key)),'commit')
   if(qa.reject)return reject('knowledge-import.v1',qa.reject)
   if(name.endsWith('_get'))return reject('knowledge-import.v1','NOT_FOUND')
   const row={...source,...copy(args.p_import.input),id:'imported-'+(++qa.writes),version:1,status:'draft'};sources.push(row)
   const receipt={id:row.id,version:1,requestKey:key,recordedAt:stamp};receipts.set(key,copy(receipt));return respond(envelope('knowledge-import.v1',receipt),'commit')
  }
  throw Error('정의하지 않은 합성 RPC '+name)
 }
}
const port:any={
 async upload(path:string,file:File){qa.ports.push({kind:'upload',path,bytes:file.size});for(const r of reservations.values())r.uploaded=true;await respond({},'upload')},
 async extract(input:any){qa.ports.push(copy({kind:'extract',input}));const reservation=[...reservations.values()][0],result={fileId:'file-a',fileVersion:1,name:'합성학교규정.hwpx',extraction:{profile:'hwpx_text_v1',fileSha256:reservation.sha256,extractionSha256:'b'.repeat(64),blocks:[{id:'Contents/section0.xml:p000000',locator:'문단 1',text:'확인한 HWPX 원문'}],omittedObjects:1}};extractions.set(input.requestKey,copy(result));return respond(envelope('knowledge-import.v1',result),'extract')},
 async download(){throw Error('합성 원본 다운로드는 사용하지 않는다')}
}
function App(){
 const[epoch,setEpoch]=useState(0),[serviceEpoch,setServiceEpoch]=useState(0),[shown,setShown]=useState(true),[date,setDate]=useState('2026-10-16'),[listener,setListener]=useState('original'),[refresh,setRefresh]=useState(0)
 const activeConnection=useMemo(()=>({...connection}),[serviceEpoch]),service=useMemo(()=>{const real=createKnowledgeImportService(activeConnection,port);return{...real,async commit(...args:Parameters<typeof real.commit>){const receipt=await real.commit(...args);return qa.serviceBadVersion?{...receipt,version:2}:receipt}}},[activeConnection])
 qa.remount=()=>{qa.forgetDrafts();setEpoch(v=>v+1)};qa.replaceService=()=>setServiceEpoch(v=>v+1);qa.changeDate=()=>setDate('2026-10-17');qa.changeListener=()=>setListener('replacement');qa.hide=()=>setShown(false);qa.refresh=()=>setRefresh(v=>v+1);qa.changeScope=()=>{member={...member,role:'school_admin'};setRefresh(v=>v+1)}
 const report=(result:any)=>{qa.results.push(copy(result));qa.listeners.push(listener);if(qa.resultThrows)throw Error('합성 결과 콜백 오류')}
 return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}>{shown&&(location.search.includes('import')?<KnowledgeImport key={epoch} connection={activeConnection} service={service} member={member} date={date} onWorkflowResult={report} onClose={()=>setShown(false)} onCreated={receipt=>{qa.created.push(copy(receipt));if(qa.createdThrows)throw Error('합성 후속 화면 오류')}}/>:<KnowledgeWorkspace key={epoch} connection={activeConnection} member={member} date={date} revision={refresh} onWorkflowResult={report}/>)}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
