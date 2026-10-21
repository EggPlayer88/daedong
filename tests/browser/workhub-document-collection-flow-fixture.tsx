// 가상 학교의 합성 전송만 제공한다. 화면·서비스·응답 파서·수합 저장 규칙은 제품 코드를 사용한다.
import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {ContractError} from '../../apps/workhub/src/contracts'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {createWorkflowStore} from '../../apps/workhub/src/workflows/store'

const w=window as any,copy=structuredClone,now=()=>new Date().toISOString(),seed=w.flowSeed
const data=copy(fixtureData),day=now().slice(0,10)
data.basisDate=day;data.events=[]
data.memberships.forEach(m=>{m.validFrom='2020-01-01';m.validThrough='2099-12-31'})
const teacher=data.memberships.find(m=>m.id==='gaon-soyeon')!,second=data.memberships.find(m=>m.id==='gaon-seojin')!,manager=data.memberships.find(m=>m.id==='gaon-minjun')!
const teachers=[teacher,second];teachers.forEach((m,i)=>m.name=seed.documents[i].name)
const calendar=createMemoryAdapter(data,0),ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels}
let active=teacher,identity:any
const identityFor=(m:any)=>({userId:m.userId,approved:true,profile:{id:m.userId,name:m.name,email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}})
identity=identityFor(active)
const bytes=(base64:string)=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),hash=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('')
const storage=new Map<string,Blob>(),fileRecords=new Map<string,any>(),receipts=new Map<string,any>(),responses=new Map<string,any>(),artifacts=new Map<string,any>()
const policy={extensions:['hwpx'],maxFileBytes:1048576,maxFiles:3}
const flow=w.flow={calls:[],http:[],uploads:[],downloads:[],applied:[],unknownKind:'',unknownGuided:false,holdDownload:false,releaseDownload:null,changedAccess:false,getError:'',holdGet:false,releaseGet:null}
const repository:any={check(refs:any[]){for(const ref of refs){const f=fileRecords.get(ref.id);if(!f||!f.ready||JSON.stringify(f.file)!==JSON.stringify(ref))throw new ContractError('INVALID_INPUT','합성 보관소의 확인된 원본만 사용합니다')}},retainSaved(){}}
const workflows=createWorkflowStore({members:data.memberships,date:day,files:repository})
const request=workflows.createCollection(manager.id,{title:'학급 운영 자료 최종 수합',instructions:'파일을 직접 확인한 뒤 책임 교사가 최종 제출합니다.',dueDate:'2099-12-01',reviewMode:'none',reviewerMemberId:'',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:teachers.map((m,i)=>({label:seed.documents[i].classLabel+' · '+m.name,responsibleMemberId:m.id,contributorMemberIds:[]})),fileCollection:{policy,required:true,templates:[]}},'setup-collection')
workflows.publishCollection(manager.id,request.id,1,'setup-publish')
const wrong=workflows.createCollection(manager.id,{...request,title:'목록 첫 번째의 다른 수합'},'setup-other')
workflows.publishCollection(manager.id,wrong.id,1,'setup-other-publish')
const template:any={id:'guided-real-hwpx',schoolId:teacher.schoolId,ownerMemberId:manager.id,title:'학교자료'.repeat(50),version:2,state:'published',inspection:seed.inspection,mapping:seed.mapping,collectionRequestId:request.id,canManage:false}
flow.template=template;flow.requestId=request.id;flow.wrongRequestId=wrong.id;flow.teacherIds=teachers.map(m=>m.id);flow.managerId=manager.id
flow.snapshot=()=>copy(workflows.exportState())
flow.changeSavedAnswer=(note:string)=>{const r=responses.get(active.id);if(!r)throw Error('저장한 답변이 없습니다');r.answers.note=note;r.version++;r.artifact=null}
const actor=(id:string)=>{const m=ctx.memberships.find(m=>m.id===id);if(!m||m.userId!==identity.userId)throw new ContractError('FORBIDDEN','합성 현재 계정과 소속이 다릅니다');return m}
const env=(m:any,contract:string,value:any)=>({contract,schoolId:m.schoolId,memberId:m.id,data:copy(value)})
const collection=(m:any,value:any)=>({contractVersion:1,schoolId:m.schoolId,memberId:m.id,data:copy(value)})
const deny=(m:any,contract:string,code='NOT_FOUND')=>({contract,schoolId:m.schoolId,memberId:m.id,error:{code}})
function scopedTemplate(m:any){if(m.schoolId!==template.schoolId)throw new ContractError('NOT_FOUND','다른 학교의 양식입니다');return template}
function detail(m:any,id:string){const r=workflows.getCollection(m.id,id),units=workflows.listUnits(m.id,id),s=workflows.exportState(),ids=new Set(units.map(u=>u.id));return {request:r,units,submissions:s.submissions.filter(x=>ids.has(x.unitId)),reviews:s.reviews.filter(x=>ids.has(x.unitId)),supplements:s.supplements.filter(x=>ids.has(x.unitId)),withdrawals:s.withdrawals.filter(x=>ids.has(x.unitId))}}
function status(f:any){return {fileId:f.file.id,state:f.ready?'ready':'pending_verification',file:f.ready?f.file:null}}
flow.session=async()=>({access_token:'synthetic-session',user:{id:identity.userId}})
flow.storage={async upload(bucket:string,path:string,file:File){flow.uploads.push({bucket,path,name:file.name,bytes:file.size,sha256:await hash(file)});if(storage.has(bucket+'/'+path))return {error:{code:'duplicate'}};storage.set(bucket+'/'+path,file);return {error:null}},async download(bucket:string,path:string){flow.downloads.push({bucket,path});const blob=storage.get(bucket+'/'+path);if(flow.holdDownload){flow.holdDownload=false;await new Promise(resolve=>flow.releaseDownload=resolve)}return {data:blob??null,error:blob?null:{code:'missing'}}}}
flow.handleHttp=async(path:string,p:any)=>{
 const m=actor(p.memberId);flow.http.push(copy({path,p}))
 if(path==='/api/workhub-documents/guided'){
  scopedTemplate(m);const r=responses.get(m.id);if(!r||r.version!==p.responseVersion||template.version!==p.templateVersion)return {status:409,body:{error:{code:'CONFLICT'}}}
  const prior=receipts.get('render:'+m.id+':'+p.requestKey);if(prior)return {body:env(m,'guided.v1',prior)}
  const generated=seed.documents[teachers.findIndex(t=>t.id===m.id)];if(JSON.stringify(r.answers)!==JSON.stringify(generated.answers))throw Error('시험 입력과 실제 Python 생성물의 답변이 다릅니다')
  const a={artifactId:'artifact-'+m.id+'-'+r.version,templateId:template.id,templateVersion:template.version,responseId:r.id,responseVersion:r.version,bytes:generated.file.bytes,sha256:generated.file.sha256}
  const location=`${m.schoolId}/${m.id}/${a.artifactId}/output.hwpx`;storage.set('workhub-document-files/'+location,new Blob([bytes(generated.base64)],{type:'application/hwp+zip'}));artifacts.set(a.artifactId,{artifact:a,bucket:'workhub-document-files',path:location,ownerMemberId:m.id});r.artifact=a;receipts.set('render:'+m.id+':'+p.requestKey,a);return {body:env(m,'guided.v1',a)}
 }
 if(path==='/api/collections/check-hwpx'){
  const f=fileRecords.get(p.fileId);if(!f||f.owner!==m.id)return {status:403,body:{error:{code:'FORBIDDEN'}}}
  const blob=storage.get(f.intent.bucket+'/'+f.intent.path);if(!blob||blob.size!==f.file.bytes||await hash(blob)!==f.file.sha256)throw Error('업로드한 실제 바이트와 준비 메타데이터 불일치')
  // 실제 Python 최소 검사에 통과한 생성물과 같은 해시여야 합성 ready 응답을 제공한다.
  if(!seed.documents.some((d:any)=>d.file.sha256===f.file.sha256))throw Error('Python 검사 대상이 아닌 파일')
  f.ready=true;return {body:collection(m,status(f))}
 }
 throw Error('예상하지 않은 합성 HTTP '+path)
}
const connection:any={getIdentity:async()=>copy(identity),loadContext:async()=>copy(ctx),info:()=>copy(ctx),subscribeIdentity:()=>()=>{},subscribeInvalidation:()=>()=>{},checkReadiness:async()=>({stage:'ready',code:'READY',checkedAt:now(),readySchoolCount:2}),rpcVerified:async(name:string,args:any)=>{
 const m=actor(args.p_member_id);flow.calls.push(copy({name,args}))
 if(name==='workhub_calendar_list')return calendar.list(m.id)
 if(name==='workhub_calendar_get')return calendar.get(m.id,args.p_event_id)
 if(name==='workhub_task_list')return workflows.listTasks(m.id)
 if(name==='workhub_home_overview')return env(m,'home.v1',{asOf:now(),items:[],counts:{collection:0,supplement:0,message:0,student_followup:0,cooperation:0},unavailable:[]})
 if(name==='workhub_document_list')return env(m,'documents.v1',{items:[],nextCursor:null,canShare:false})
 if(name==='workhub_template_list')return env(m,'guided.v1',{items:m.schoolId===template.schoolId?[template]:[],nextCursor:null,canCreate:false})
 if(name==='workhub_template_get'){scopedTemplate(m);if(flow.holdGet){flow.holdGet=false;await new Promise(resolve=>flow.releaseGet=resolve)}if(flow.getError)return deny(m,'guided.v1',flow.getError);if(args.p_template_id!==template.id)return deny(m,'guided.v1');return env(m,'guided.v1',{template,response:responses.get(m.id)??null})}
 if(name==='workhub_template_mutate'||name==='workhub_template_request_get'){
  scopedTemplate(m);const key='guided:'+m.id+':'+args.p_request_key,c=args.p_command
  if(receipts.has(key))return env(m,'guided.v1',receipts.get(key))
  if(name.endsWith('request_get'))return deny(m,'guided.v1')
  const previous=responses.get(m.id);if(c.templateVersion!==template.version||(previous?.version??0)!==c.expectedVersion)return deny(m,'guided.v1','CONFLICT')
  const r={id:'response-'+m.id,templateId:template.id,templateVersion:template.version,schoolId:m.schoolId,ownerMemberId:m.id,version:(previous?.version??0)+1,answers:copy(c.answers),preview:false,artifact:null};responses.set(m.id,r)
  const receipt={requestKey:args.p_request_key,templateId:template.id,templateVersion:template.version,responseId:r.id,responseVersion:r.version};receipts.set(key,receipt);flow.applied.push({kind:'save_answers',memberId:m.id,key:args.p_request_key})
  if(flow.unknownGuided){flow.unknownGuided=false;throw Error('합성 답변 저장 응답 유실')}return env(m,'guided.v1',receipt)
 }
 if(name==='workhub_document_artifact_access'){
  const a=artifacts.get(args.p_artifact_id);if(!a||a.ownerMemberId!==m.id)return deny(m,'guided.v1')
  const result=copy(a);if(flow.changedAccess)result.artifact.sha256='f'.repeat(64);return env(m,'guided.v1',result)
 }
 if(name==='workhub_template_operation_get'){const r=receipts.get('render:'+m.id+':'+args.p_operation.requestKey);return r?env(m,'guided.v1',r):deny(m,'guided.v1')}
 if(name==='workhub_collection_basic_readiness')return collection(m,{available:true,reason:'ready',policy})
 if(name==='workhub_collection_list')return collection(m,{items:workflows.listCollections(m.id).reverse(),nextCursor:null})
 if(name==='workhub_collection_get')return collection(m,detail(m,args.p_request_id))
 if(name==='workhub_collection_draft_get')return collection(m,workflows.getDraft(m.id,args.p_unit_id))
 if(name==='workhub_collection_operations_get'){
  const d=detail(m,args.p_request_id),all=workflows.exportState().units.filter(u=>u.requestId===d.request.id),completed=all.filter(u=>u.effectiveSubmissionId).length,canManage=m.id===manager.id
  return env(m,'collection-operations.v1',{requestId:d.request.id,version:1,phase:'open',dueDate:d.request.dueDate,canManage,totals:{total:all.length,missing:all.length-completed,submitted:0,accepted:completed,changesRequested:0},units:canManage?all.map(u=>({id:u.id,label:u.label,responsibleMemberId:u.responsibleMemberId,version:u.version,state:u.effectiveSubmissionId?'accepted':'missing'})):[]})
 }
 if(name==='workhub_collection_mutate'){
  const key='collection:'+m.id+':'+args.p_request_key,c=args.p_command,old=receipts.get(key)
  if(old){if(old.command!==JSON.stringify(c))throw new ContractError('IDEMPOTENCY_CONFLICT','명령이 달라졌습니다');return collection(m,old.receipt)}
  let result:any;if(c.kind==='save_draft')result=workflows.saveDraft(m.id,c.unitId,c.input,c.expectedVersion,args.p_request_key);else if(c.kind==='submit')result=workflows.submit(m.id,c.unitId,c.expectedDraftVersion,c.expectedVersion,args.p_request_key,c.reason);else throw Error('예상하지 않은 수합 명령')
  const receipt={requestId:c.requestId,resourceId:result.id,resourceVersion:result.version??result.revision,recordedAt:now(),requestKey:args.p_request_key};receipts.set(key,{receipt,command:JSON.stringify(c)});flow.applied.push({kind:c.kind,memberId:m.id,key:args.p_request_key})
  if(flow.unknownKind===c.kind){flow.unknownKind='';throw Error('합성 수합 접수 응답 유실')}return collection(m,receipt)
 }
 if(name==='workhub_file_prepare'){
  const key='file:'+m.id+':'+args.p_request_key;if(receipts.has(key))return collection(m,receipts.get(key))
  const id='upload-'+(fileRecords.size+1),f=args.p_file,intent={fileId:id,bucket:'workhub-collection-files',path:`${m.schoolId}/${id}/synthetic_unique_token`,expiresAt:new Date(Date.now()+600000).toISOString(),state:'awaiting_upload'}
  fileRecords.set(id,{owner:m.id,parent:copy(args.p_parent),file:{id,name:f.name,extension:f.extension,bytes:f.claimedBytes,sha256:f.claimedSha256},intent,ready:false});receipts.set(key,intent);return collection(m,intent)
 }
 if(name==='workhub_file_complete'||name==='workhub_file_status'){const f=fileRecords.get(args.p_file_id);if(f.owner!==m.id)throw new ContractError('FORBIDDEN','다른 작성자');return collection(m,status(f))}
 if(name==='workhub_file_access'){
  const f=fileRecords.get(args.p_file_id),d=detail(m,args.p_parent.requestId);if(!f||!d.submissions.some(s=>s.id===args.p_parent.submissionId&&s.files?.some(x=>x.id===f.file.id)))throw new ContractError('NOT_FOUND','현재 제출 원본에 없습니다')
  return collection(m,{file:f.file,bucket:f.intent.bucket,path:f.intent.path})
 }
 throw new ContractError('QUERY_FAILED','이 합성 시험에서 사용하지 않는 선택 기능입니다')
}}
function App(){const[epoch,setEpoch]=useState(0);flow.login=(id:string)=>{active=data.memberships.find(m=>m.id===id)!;identity=identityFor(active);setEpoch(n=>n+1)};return <ConnectedWorkspace key={epoch} expectedUserId={identity.userId} legacyHomeHref='/legacy' connection={connection}/>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
