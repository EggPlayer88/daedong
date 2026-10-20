import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {DocumentsWorkspace} from '../../apps/workhub/src/documents/DocumentsWorkspace'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider,createPendingRequests} from '../../apps/workhub/src/app/pending-requests'
const w=window as any,clone=structuredClone
const member={id:'member',userId:'user',schoolId:'school',name:'합성 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let current=member
const base={id:'doc',schoolId:'school',ownerMemberId:'member',version:3,latestVersion:3,status:'confirmed',updatedAt:'2026-10-21T00:00:00Z',canEdit:true,origin:null,title:'새 행사 결과',kind:'event_report',body:'저장한 최신 본문\n<img src="https://outside.invalid/x" onerror="window.stolen=true">',visibility:'private',sources:[{kind:'knowledge',sourceId:'source',sourceVersion:2,locator:'규정 2쪽',quote:'확인한 새 근거'}],basisDate:'2026-10-21',studentContext:null}
if(w.student){Object.assign(base,{kind:'student_record',studentContext:{studentId:'student',courseId:'course',evidence:[{kind:'observation',id:'observation',revisionId:'rev',sourceHash:'a'.repeat(64),epoch:1,start:0,end:10}]}})}
const versions:any[]=[{...base,version:1,canEdit:false,title:'첫 문서',body:'최초 본문',status:'draft',sources:[],updatedAt:'2026-10-19T00:00:00Z'},{...base,version:2,canEdit:false,title:'이전 행사 계획',body:'이전 계획 본문',kind:w.student?'student_record':'event_plan',status:'draft',visibility:'school',sources:[{...base.sources[0],sourceVersion:1,locator:'규정 1쪽',quote:'이전 근거'}],basisDate:'2026-10-20',updatedAt:'2026-10-20T00:00:00Z'},base]
if(w.student)versions[1].visibility='private'
w.calls=[];w.prints=[];w.drafts=createEditDrafts();w.pending=createPendingRequests();w.receipts=new Map()
const envelope=(data:any)=>({contract:'documents.v1',schoolId:current.schoolId,memberId:current.id,data})
const connection:any={info:()=>({memberships:[current],schools:[{id:current.schoolId}],basisDate:'2026-10-21'}),getIdentity:async()=>({userId:current.userId,approved:true}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push(clone({name,args}))
 if(name==='workhub_document_list'){if(w.listFail)throw Error('synthetic unavailable');return envelope({items:current.id===member.id?[versions.at(-1)]:[],nextCursor:null,canShare:true})}
 if(name==='workhub_document_history')return envelope({documentId:'doc',versions:versions.slice().reverse().map(d=>({version:d.version,recordedAt:d.updatedAt,status:d.status}))})
 if(name==='workhub_document_get'){
  if(w.readFail)throw Error('synthetic read failure')
  if(w.denied)return {contract:'documents.v1',schoolId:current.schoolId,memberId:current.id,error:{code:'FORBIDDEN'}}
  let result=clone(args.p_version===null?versions.at(-1):versions.find(d=>d.version===args.p_version))
  if(w.wrongId)result.id='different-document'
  if(w.wrongVersion)result={...result,version:1,canEdit:false}
  if(w.changed)result.body='같은 판으로 바뀐 응답'
  const raw=envelope(result)
  if(w.deferGet){w.deferGet=false;await new Promise(resolve=>{w.resolveGet=resolve})}
  return raw
 }
 if(name==='workhub_document_mutate'||name==='workhub_document_request_get'){
  const key=args.p_request_key;if(w.receipts.has(key))return envelope(w.receipts.get(key))
  const result={documentId:'doc',version:4,requestKey:key,recordedAt:'2026-10-21T01:00:00Z'};w.receipts.set(key,result)
  if(w.unknown){w.unknown=false;throw Error('synthetic result unknown')}
  return envelope(result)
 }
 throw Error('unexpected RPC '+name)
}}
const nativeOpen=window.open.bind(window)
window.open=((...args:any[])=>{if(w.popupBlocked)return null;const popup=nativeOpen(...args);if(popup){w.popup=popup;popup.print=()=>{w.prints.push({text:popup.document.body.innerText,html:popup.document.body.innerHTML,title:popup.document.title,openerNull:popup.opener===null,images:popup.document.images.length,script:popup.document.querySelectorAll('script').length,csp:popup.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')})}}return popup}) as any
function App(){const[actor,setActor]=useState(member),[mounted,setMounted]=useState(true),[revision,setRevision]=useState(0)
 w.changeScope=()=>{current={...member,id:'other',userId:'other-user',schoolId:'other-school'};setActor(current)}
 w.refresh=()=>setRevision(value=>value+1);w.unmount=()=>setMounted(false)
 return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>{mounted&&<DocumentsWorkspace connection={connection} member={actor as any} date="2026-10-21" revision={revision} onNavigationLockChange={v=>{w.locked=v}}/>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
