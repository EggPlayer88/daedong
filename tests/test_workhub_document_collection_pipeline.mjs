import assert from 'node:assert/strict'
import {File} from 'node:buffer'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

// 실제 Python 생성기·HWPX 최소 검사·JS 파일 보관/수합/ZIP 구현을 연결한다.
// 저장은 메모리 연습 저장소이고 서버 어댑터는 합성이다. 운영 SQL·Storage·한글 화면 검증은 별도다.
const helper=fileURLToPath(new URL('./helpers/document-collection-fixture.py',import.meta.url))
const root=fileURLToPath(new URL('../',import.meta.url))
const python=[process.env.PYTHON,resolve(root,'tests/.venv/Scripts/python.exe'),resolve(root,'tests/.venv/bin/python'),resolve(root,'.venv/Scripts/python.exe'),resolve(root,'.venv/bin/python'),'python3','python'].filter(Boolean).find(candidate=>{
  if(/[\\/]/.test(candidate)&&!existsSync(candidate))return false
  return spawnSync(candidate,['-c','import lxml.etree'],{stdio:'ignore'}).status===0
})
assert(python,'실제 HWPX 통합 시험에는 lxml이 설치된 Python이 필요합니다. PYTHON 환경변수를 지정해 주세요.')
function runPython(args=[],input){
  const result=spawnSync(python,[helper,...args],{encoding:'utf8',input,cwd:root,maxBuffer:4*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}})
  assert.equal(result.status,0,result.stderr||result.error?.message)
  return JSON.parse(result.stdout)
}
const generated=runPython()
const api=await loadBrowserModule(`
export * from '../apps/workhub/src/collections/collection-export.ts'
export {CollectionServerError} from '../apps/workhub/src/collections/contracts.ts'
export {createWorkflowStore} from '../apps/workhub/src/workflows/store.ts'
export {createPreviewFileRepository} from '../apps/workhub/src/files/preview-repository.ts'
export {unzipSync} from 'fflate'
`)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),clone=value=>structuredClone(value)
const date='2026-10-21',schoolId='pipeline-school',policy={extensions:['hwpx'],maxFileBytes:10*1024*1024,maxFiles:1}
function member(id,name,school=schoolId){return{id,schoolId:school,userId:'account-'+id,name,role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}}
const manager=member('pipeline-manager','가상 수합 담당자'),stranger=member('pipeline-other-school','다른 학교 교사','other-school')
const teachers=generated.documents.map(value=>member(value.memberId,value.name))
const bytes=source=>Buffer.from(source.base64,'base64')
async function fixture(){
  const files=api.createPreviewFileRepository(),store=api.createWorkflowStore({members:[manager,stranger,...teachers],date,files})
  const template=await files.stage(new File([bytes(generated.template)],generated.template.name),policy,{schoolId,memberId:manager.id})
  assert.equal(template.sha256,generated.template.sha256)
  const input={title:'가상 9학급 문서 수합',instructions:'각 교사가 확인한 생성 파일만 직접 제출합니다.',dueDate:date,
    reviewMode:'required',reviewerMemberId:manager.id,textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,
    units:generated.documents.map((document,index)=>({label:document.classLabel+' · 제출 '+String(index+1).padStart(2,'0'),responsibleMemberId:document.memberId,contributorMemberIds:[]})),
    fileCollection:{policy,required:true,templates:[template]}}
  const draft=store.createCollection(manager.id,input,'pipeline-create'),request=store.publishCollection(manager.id,draft.id,draft.version,'pipeline-publish')
  const documents=new Map(),refs=new Map(),submissions=new Map()
  let downloadCalls=0,downloadOverride
  const detail=()=>{const state=store.exportState();return{request:state.requests[0],units:state.units,submissions:state.submissions,reviews:state.reviews,supplements:state.supplements,withdrawals:state.withdrawals}}
  const server={
    async detail(actor,id){assert.equal(actor,manager.id);assert.equal(id,request.id);return detail()},
    async download(actor,parent,ref){
      assert.equal(actor,manager.id);assert.equal(parent.kind,'submission');assert.equal(parent.requestId,request.id);downloadCalls++
      const intercepted=await downloadOverride?.(parent,ref,downloadCalls)
      if(intercepted!==undefined)return intercepted
      return store.getSubmissionFile(actor,parent.unitId,parent.submissionId,ref.id)
    },
  }
  async function submit(document,reason=''){
    const teacher=document.memberId,unit=store.listUnits(teacher,request.id).find(row=>row.responsibleMemberId===teacher)
    const ref=await files.stage(new File([bytes(document)],document.file.name),policy,{schoolId,memberId:teacher})
    assert.equal(ref.sha256,document.file.sha256);assert.equal(ref.bytes,document.file.bytes)
    const before=store.exportState().submissions.length
    const previous=store.getDraft(teacher,unit.id),saved=store.saveDraft(teacher,unit.id,{text:'',number:null,files:[ref]},previous?.version??0,teacher+'-draft-v'+document.revision)
    assert.equal(store.exportState().submissions.length,before,'파일 생성·첨부·초안 저장은 제출이 아니다')
    const version=store.unitSummary(teacher,unit.id).unit.version,key=teacher+'-submit-v'+document.revision
    const result=store.submit(teacher,unit.id,saved.version,version,key,reason)
    // 제출은 반영됐지만 응답을 놓친 상황에서 원키·원판으로 다시 확인한다.
    const recovered=store.submit(teacher,unit.id,saved.version,version,key,reason)
    assert.deepEqual(recovered,result);assert.equal(store.exportState().submissions.length,before+1)
    documents.set(ref.id,document);refs.set(teacher,ref);submissions.set(teacher,result)
    return{unit:store.unitSummary(teacher,unit.id).unit,submission:result,ref}
  }
  return{store,files,request,detail,server,documents,refs,submissions,submit,
    options:{server,member:manager,date,requestId:request.id,mode:'current'},
    get downloadCalls(){return downloadCalls},set downloadOverride(value){downloadOverride=value}}
}
let passed=0,failed=0,f
async function test(name,run){try{await run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
async function verifyZip(batch,context){
  assert(batch.zip);assert.equal(batch.failed.length,0)
  const entries=api.unzipSync(new Uint8Array(await batch.zip.arrayBuffer())),names=Object.keys(entries)
  assert.equal(names.length,37);assert.equal(new Set(names).size,37)
  const csvName=names.find(name=>name.endsWith('.csv'));assert(csvName)
  const csv=new TextDecoder().decode(entries[csvName]);assert.equal(csv.replace(/^\ufeff/,''),batch.plan.csv.replace(/^\ufeff/,''))
  const files=names.filter(name=>name.endsWith('.hwpx'))
  const checked=runPython(['--inspect-stdin'],JSON.stringify(files.map(name=>Buffer.from(entries[name]).toString('base64'))))
  assert.equal(checked.length,36)
  for(const [index,name]of files.entries()){
    const sha=hash(entries[name]),job=batch.plan.jobs.find(job=>job.file.sha256===sha)
    assert(job,'ZIP의 파일이 선택한 제출판 원본에 있어야 합니다.')
    const original=context.documents.get(job.file.id);assert(original)
    assert.deepEqual(Buffer.from(entries[name]),bytes(original));assert.equal(checked[index].sha256,job.file.sha256)
    assert.deepEqual(checked[index].paragraphs,original.paragraphs)
    assert(csv.includes(name));assert(csv.includes(sha));assert(name.includes('_v'+job.revision+'_'))
  }
  return{entries,files}
}
await test('36명·9학급의 실제 생성 HWPX와 최소 검사 결과를 공유하고 손상 원본·매핑을 거부한다',()=>{
  assert.equal(generated.documents.length,36);assert.equal(new Set(generated.documents.map(d=>d.classLabel)).size,9)
  assert.equal(new Set(generated.documents.map(d=>d.name)).size,18)
  assert.equal(new Set(generated.documents.map(d=>d.file.sha256)).size,36)
  assert.equal(new Set(generated.documents.map(d=>d.file.name)).size,1)
  assert.deepEqual(generated.rejections.map(r=>r.case),['not_zip','truncated','wrong_mimetype','changed_template'])
  assert.equal(generated.rejections.at(-1).code,'CONFLICT')
})
await test('기존 확정 양식 6종은 읽기 전용으로 열어 지원 문단만 채우고 나머지 ZIP·XML을 보존한다',()=>{
  const results=runPython(['--real-templates'])
  assert.equal(results.length,6)
  for(const result of results){
    assert.equal(result.supported,true,result.name+': '+result.reason)
    assert(result.supportedParagraphs>0);assert(result.preservedEntries>0)
    assert.notEqual(result.generatedSha256,result.originalSha256)
    assert(result.generatedBytes>0)
  }
})
await test('실제 문서 바이트를 교사별로 첨부하고 명시 제출·응답 유실 복구 후 36판만 보관한다',async()=>{
  f=await fixture()
  for(const document of generated.documents){
    const submitted=await f.submit(document)
    assert.equal(submitted.submission.files[0].name,'응답.hwpx')
    f.store.review(manager.id,submitted.unit.id,submitted.submission.id,'accepted','','',submitted.unit.version,document.memberId+'-accept-v1')
  }
  assert.equal(f.store.exportState().submissions.length,36);assert.equal(f.store.exportState().reviews.length,36)
  const first=generated.documents[0],unit=f.store.listUnits(first.memberId,f.request.id).find(u=>u.responsibleMemberId===first.memberId)
  await assert.rejects(f.store.getSubmissionFile(stranger.id,unit.id,f.submissions.get(first.memberId).id,f.refs.get(first.memberId).id),e=>e.code==='NOT_FOUND')
})
await test('동명이인·같은 파일명 36개를 덮어쓰지 않고 CSV와 ZIP 안의 본문·판·해시를 대조한다',async()=>{
  const batch=await api.prepareCollectionExport(f.options)
  await verifyZip(batch,f)
  const before=f.downloadCalls;await api.recheckCollectionExport({...f.options,batch})
  assert.equal(f.downloadCalls-before,36)
})
await test('정정 v2가 검토 대기여도 완료본 ZIP은 승인 v1을, 최신 ZIP은 v2를 정확히 선택한다',async()=>{
  await f.submit(generated.correction,'가상 교사의 확인 내용 정정')
  const latest=await api.prepareCollectionExport(f.options),effective=await api.prepareCollectionExport({...f.options,mode:'effective'})
  const v2=f.submissions.get(generated.correction.memberId)
  assert.equal(latest.plan.jobs.find(job=>job.submissionId===v2.id).revision,2)
  assert(!effective.plan.jobs.some(job=>job.submissionId===v2.id))
  await verifyZip(latest,f);await verifyZip(effective,f)
  assert.equal(f.store.exportState().submissions.length,37)
})
await test('다운로드 한 건의 응답 유실은 부분 ZIP을 막고 원본 고정 뒤 실패한 파일만 다시 읽는다',async()=>{
  let first=true;const missing=f.refs.get(generated.documents[5].memberId).id
  f.downloadOverride=async(_parent,ref)=>{if(first&&ref.id===missing){first=false;throw new api.CollectionServerError('QUERY_FAILED','가상 다운로드 응답 유실')}}
  const broken=await api.prepareCollectionExport(f.options)
  assert.equal(broken.zip,undefined);assert.equal(broken.failed.length,1);assert.equal(broken.blobs.size,35)
  const calls=f.downloadCalls
  const retry=await api.prepareCollectionExport({...f.options,previous:broken})
  assert.equal(f.downloadCalls-calls,1);await verifyZip(retry,f)
  f.downloadOverride=undefined
})
await test('같은 크기의 변조 바이트도 해시로 거부하고 정상 원본 재조회 후에만 ZIP을 만든다',async()=>{
  const target=f.refs.get(generated.documents[8].memberId).id
  f.downloadOverride=async(_parent,ref)=>{if(ref.id===target){const changed=bytes(f.documents.get(ref.id));changed[changed.length-1]^=1;return new Blob([changed])}}
  const broken=await api.prepareCollectionExport(f.options)
  assert.equal(broken.zip,undefined);assert.equal(broken.failed.length,1);assert.equal(broken.blobs.size,35)
  f.downloadOverride=undefined
  await verifyZip(await api.prepareCollectionExport({...f.options,previous:broken}),f)
})
await test('ZIP 준비 도중 제출 단위의 판이 바뀌면 이전 ZIP과 임시 파일을 배포하지 않는다',async()=>{
  const batch=await api.prepareCollectionExport(f.options),first=generated.documents[0]
  let changed=false
  f.downloadOverride=async()=>{
    if(changed)return
    changed=true
    const unit=f.store.listUnits(manager.id,f.request.id).find(u=>u.responsibleMemberId===first.memberId)
    f.store.openCorrection(manager.id,unit.id,date,'검증 도중 정정 기간 변경',unit.version,'pipeline-change-during-download')
  }
  await assert.rejects(api.recheckCollectionExport({...f.options,batch}),e=>e.code==='CONFLICT')
  assert.equal(batch.zip,undefined);assert.equal(batch.blobs.size,0)
  f.downloadOverride=undefined
})
console.log(`문서 생성·HWPX 검사·수합 ZIP 연결: ${passed} 통과, ${failed} 실패 · 가상 교사 36명 · 합성 생성물 37개 + 기존 양식 사본 6개`)
if(failed)process.exit(1)
