import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { collectionExportPlan, collectionExportParts, collectionExportJobKey, prepareCollectionExport, recheckCollectionExport, releaseCollectionExport, CollectionServerError, FILE_TECHNICAL_LIMITS } = await loadBrowserModule(`
export * from '../apps/workhub/src/collections/collection-export'
export {CollectionServerError} from '../apps/workhub/src/collections/contracts'
export {FILE_TECHNICAL_LIMITS} from '../apps/workhub/src/files/contracts'
`)
let passed=0,failed=0
async function test(name,run){try{await run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.log('  ✗ '+name+': '+error.stack)}}
const date='2026-10-15', member={id:'manager',schoolId:'school',userId:'user-manager',name:'담당',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
const hash=value=>createHash('sha256').update(value).digest('hex')
const clone=value=>structuredClone(value)
const error=code=>new CollectionServerError(code,'합성 오류')
const hasCode=code=>value=>value.code===code
function fixture(options={}) {
 const payloads=new Map(),calls=[],state={downloads:0,details:0}
 const data={request:{id:'request',schoolId:'school',managerMemberId:'manager',status:'published',version:2,publishedAt:'2026-10-15T01:00:00Z',title:'제출 파일',instructions:'합성 자료',dueDate:'2026-10-20',reviewMode:'required',reviewerMemberId:'manager',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[],fileCollection:{policy:{extensions:['pdf'],maxFileBytes:FILE_TECHNICAL_LIMITS.memoryBytes,maxFiles:512},required:false,templates:[]}},units:[],submissions:[],reviews:[],supplements:[],withdrawals:[]}
 function addUnit(id,label=id) {
  const responsibleMemberId='author-'+id
  data.request.units.push({label,responsibleMemberId,contributorMemberIds:[]})
  const unit={id,requestId:'request',schoolId:'school',label,responsibleMemberId,members:[{id:responsibleMemberId,userId:'user-'+id,name:'교사 '+id}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}
  data.units.push(unit);return unit
 }
 function addSubmission(unit,{accepted=false,names=['응답.pdf'],contents,files}={}) {
  const revision=data.submissions.filter(s=>s.unitId===unit.id).length+1,id=unit.id+'-s'+revision
  const refs=files??names.map((name,index)=>{const bytes=Buffer.from(contents?.[index]??'%PDF-1.4\n'+id+'-'+index);const fileId=id+'-f'+index;payloads.set(fileId,new Blob([bytes]));return {id:fileId,name,extension:'pdf',bytes:bytes.length,sha256:hash(bytes)}})
  const submission={id,unitId:unit.id,revision,submittedBy:unit.responsibleMemberId,receiptAt:'2026-10-15T02:00:00Z',receiptDate:date,dueSnapshot:'2026-10-20',initiallyLate:false,correctionReason:revision>1?'정정':'',previousSubmissionId:unit.currentSubmissionId,reviewMode:data.request.reviewMode,requestKey:'key-'+id,text:'',number:null,files:refs}
  data.submissions.push(submission);unit.currentSubmissionId=id;unit.version++
  if(accepted||data.request.reviewMode==='none'){unit.effectiveSubmissionId=id;if(data.request.reviewMode==='required')data.reviews.push({id:id+'-review',unitId:unit.id,submissionId:id,reviewerMemberId:'manager',decision:'accepted',note:'',recordedAt:'2026-10-15T03:00:00Z'})}
  return submission
 }
 const unit=addUnit('unit-a','=1+1'),second=addUnit('unit-b','미제출')
 const server={async detail(actor,requestId){state.details++;assert.equal(actor,'manager');assert.equal(requestId,'request');await options.detail?.(state,data);return clone(data)},async download(actor,parent,file){state.downloads++;calls.push({actor,parent:clone(parent),file:clone(file)});const result=await options.download?.(state,file,data);if(result!==undefined)return result;return payloads.get(file.id)}}
 return {data,payloads,calls,state,server,unit,second,addUnit,addSubmission,options:{server,member,date,requestId:'request',mode:'current'}}
}
async function entries(zip){const bytes=new Uint8Array(await zip.arrayBuffer()),view=new DataView(bytes.buffer),result=[];let offset=0;while(view.getUint32(offset,true)===0x04034b50){const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;result.push({name:new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLength)),bytes:bytes.slice(start,start+length)});offset=start+length}assert.equal(view.getUint32(offset,true),0x02014b50);return result}
const many=f=>f.addSubmission(f.unit,{names:Array.from({length:512},(_,i)=>'가상교사'+String(i).padStart(3,'0')+'.pdf')})
await test('512개 파일은 상한을 높이지 않고 511개와 1개로 나눈다',()=>{const f=fixture();many(f);const parts=collectionExportParts(f.data,member,date,'current');assert.deepEqual(parts.map(p=>p.jobs.length),[511,1]);assert.deepEqual(parts.map(p=>p.part.index),[0,1]);assert(parts.every(p=>p.part.count===2&&p.part.totalFiles===512&&p.totalBytes<=FILE_TECHNICAL_LIMITS.memoryBytes));assert.equal(new Set(parts.flatMap(p=>p.jobs.map(collectionExportJobKey))).size,512);assert.equal(parts[0].fingerprint,parts[1].fingerprint)})
await test('120MiB 메타데이터는 90MiB와 30MiB로 나누며 CSV 바이트도 계산한다',()=>{const f=fixture();f.addSubmission(f.unit,{files:Array.from({length:4},(_,i)=>({id:'file-'+i,name:'큰자료'+i+'.pdf',extension:'pdf',bytes:30*1024*1024,sha256:hash('large-'+i)}))});const parts=collectionExportParts(f.data,member,date,'current');assert.deepEqual(parts.map(p=>p.jobs.length),[3,1]);for(const p of parts)assert.equal(p.totalBytes,p.jobs.reduce((s,j)=>s+j.file.bytes,0)+new TextEncoder().encode(p.csv).length);assert.equal(f.state.downloads,0)})
await test('한 파일과 CSV만으로 상한을 넘으면 파일을 쪼개거나 다운로드하지 않는다',()=>{const f=fixture();f.addSubmission(f.unit,{files:[{id:'large',name:'단일파일.pdf',extension:'pdf',bytes:FILE_TECHNICAL_LIMITS.memoryBytes,sha256:hash('large')}]});assert.throws(()=>collectionExportParts(f.data,member,date,'current'),hasCode('FILE_ZIP_LIMIT'));assert.equal(f.state.downloads,0)})
await test('분할 순서와 현황표는 서버 배열의 순서에 영향받지 않는다',()=>{const f=fixture();many(f);const first=collectionExportParts(f.data,member,date,'current');f.data.units.reverse();f.data.request.units.reverse();f.data.submissions[0].files.reverse();assert.deepEqual(collectionExportParts(f.data,member,date,'current'),first)})
await test('각 묶음 CSV 이름·해시가 실제 ZIP과 일치하며 원본이 빠지지 않는다',async()=>{const f=fixture();many(f);const hashes=[];for(let index=0;index<2;index++){const batch=await prepareCollectionExport({...f.options,partIndex:index});const zip=await entries(batch.zip);assert.equal(zip.length,batch.plan.jobs.length+1);for(let j=0;j<batch.plan.jobs.length;j++){const job=batch.plan.jobs[j],entry=zip[j+1];assert.equal(hash(entry.bytes),job.file.sha256);assert(batch.plan.csv.includes(entry.name));hashes.push(job.file.sha256)}assert.match(batch.plan.csv,/미제출/);releaseCollectionExport(batch)}assert.equal(hashes.length,512);assert.equal(new Set(hashes).size,512)})
await test('2번 묶음 준비는 1번 파일을 전송하거나 메모리에 담지 않는다',async()=>{const f=fixture();many(f);const batch=await prepareCollectionExport({...f.options,partIndex:1});assert.equal(batch.blobs.size,1);assert.equal(f.state.downloads,1);assert.equal(batch.plan.jobs.length,1);assert.equal(batch.plan.part.index,1)})
await test('같은 묶음의 실패 파일만 다시 받고 다른 묶음 캐시를 재사용하지 않는다',async()=>{let broken=true;const f=fixture({download:async()=>{if(broken)throw error('QUERY_FAILED')}});many(f);const first=await prepareCollectionExport({...f.options,partIndex:1});assert.equal(first.failed.length,1);broken=false;const recovered=await prepareCollectionExport({...f.options,partIndex:1,previous:first});assert.ok(recovered.zip);assert.equal(f.state.downloads,2);await assert.rejects(prepareCollectionExport({...f.options,partIndex:0,previous:recovered}),hasCode('CONFLICT'));assert.equal(recovered.blobs.size,0);assert.equal(recovered.zip,undefined)})
await test('다음 묶음 전에 제출판이 바뀌면 원래 지문으로 이어받지 않는다',async()=>{const f=fixture();many(f);const first=await prepareCollectionExport({...f.options,partIndex:1});const count=f.state.downloads;f.unit.version++;await assert.rejects(prepareCollectionExport({...f.options,partIndex:0,expectedFingerprint:first.plan.fingerprint}),hasCode('CONFLICT'));assert.equal(f.state.downloads,count)})
await test('분할 ZIP 준비 도중 다른 제출이 바뀌어도 기존 묶음을 내주지 않는다',async()=>{const f=fixture({download:async(state,file,data)=>{data.units[1].version++}});many(f);await assert.rejects(prepareCollectionExport({...f.options,partIndex:1}),hasCode('CONFLICT'))})
await test('다음 묶음으로 이동할 때 해제한 이전 ZIP은 재확인과 재시도에 쓸 수 없다',async()=>{const f=fixture();many(f);const batch=await prepareCollectionExport({...f.options,partIndex:1});releaseCollectionExport(batch);assert.equal(batch.blobs.size,0);assert.equal(batch.zip,undefined);await assert.rejects(recheckCollectionExport({...f.options,batch}),hasCode('CONFLICT'));await assert.rejects(prepareCollectionExport({...f.options,partIndex:1,previous:batch}),hasCode('CONFLICT'))})
await test('다운로드 직전 권한 상실은 분할 ZIP도 폐기한다',async()=>{let deny=false;const f=fixture({download:async()=>{if(deny)throw error('FORBIDDEN')}});many(f);const batch=await prepareCollectionExport({...f.options,partIndex:1});deny=true;await assert.rejects(recheckCollectionExport({...f.options,batch}),hasCode('FORBIDDEN'));assert.equal(batch.blobs.size,0);assert.equal(batch.zip,undefined)})
await test('음수·소수·존재하지 않는 묶음 번호로 파일을 받지 않는다',async()=>{const f=fixture();many(f);for(const partIndex of [-1,0.5,2,Infinity])await assert.rejects(prepareCollectionExport({...f.options,partIndex}),e=>['INVALID_RESPONSE','CONFLICT'].includes(e.code));assert.equal(f.state.downloads,0)})
await test('파일 없는 수합은 현황표 하나인 1번 묶음을 유지한다',async()=>{const f=fixture();const batch=await prepareCollectionExport({...f.options,partIndex:0});assert.equal(batch.plan.part.count,1);assert.equal(batch.plan.part.totalFiles,0);assert.equal((await entries(batch.zip)).length,1);assert.equal(f.state.downloads,0)})
await test('분할 선택 전에 취소되면 전체 현황도 조회하지 않는다',async()=>{const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(prepareCollectionExport({...f.options,partIndex:0,signal:controller.signal}),hasCode('CANCELLED'));assert.equal(f.state.details,0)})
console.log('\n'+passed+' passed, '+failed+' failed');if(failed)process.exitCode=1
