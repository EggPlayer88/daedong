import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { createWorkflowStore, createPreviewFileRepository, fixtureData, fileExportPlan, assertFileExportCurrent, renderExport } = await loadBrowserModule(`
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CollectionFileExport} from '../apps/workhub/src/workflows/CollectionFileExport'
export {createWorkflowStore} from '../apps/workhub/src/workflows/store'
export {createPreviewFileRepository} from '../apps/workhub/src/files/preview-repository'
export {fixtureData} from '../apps/workhub/src/preview/fixtures'
export {fileExportPlan,assertFileExportCurrent} from '../apps/workhub/src/workflows/collection-file-export'
export const renderExport=props=>renderToStaticMarkup(<CollectionFileExport {...props}/>)
`)
const manager='gaon-minjun', author='gaon-soyeon', date=fixtureData.basisDate, members=fixtureData.memberships
const policy={extensions:['pdf'],maxFileBytes:2048,maxFiles:3}
let serial=0,passed=0,failed=0
const key=()=>String(++serial)
async function test(name,run){try{await run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.log('  ✗ '+name+': '+error.stack)}}
function fixture(options={}) {
 const files=createPreviewFileRepository(),store=createWorkflowStore({members,date,files})
 const draft=store.createCollection(manager,{title:'수합/검증',instructions:'합성 자료',dueDate:'2026-10-21',reviewMode:'required',reviewerMemberId:manager,textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[{label:'=1+1',responsibleMemberId:author,contributorMemberIds:[]},{label:'미제출 단위',responsibleMemberId:'gaon-seojin',contributorMemberIds:[]}],fileCollection:{policy,required:true,templates:[]},...options},key())
 const request=store.publishCollection(manager,draft.id,1,key()),unit=store.listUnits(manager,request.id)[0]
 return {files,store,request,unit}
}
async function submit(f,name='응답.pdf') {
 const file=await f.files.stage(new File(['%PDF-1.4\n합성 '+name],name,{type:'application/pdf'}),policy,{schoolId:'fixture-school-gaon',memberId:author})
 const draft=f.store.saveDraft(author,f.unit.id,{text:'',number:null,files:[file]},f.store.getDraft(author,f.unit.id)?.version??0,key())
 return f.store.submit(author,f.unit.id,draft.version,f.store.unitSummary(author,f.unit.id).unit.version,key(),'합성 정정')
}
function accept(f,submission){f.store.review(manager,f.unit.id,submission.id,'accepted','','',f.store.unitSummary(manager,f.unit.id).unit.version,key())}
await test('미제출 단위도 현황표에 남기고 완료본 없음은 파일 수에 넣지 않는다',()=>{
 const f=fixture(),p=fileExportPlan(f.store,manager,f.request.id,'effective')
 assert.equal(p.jobs.length,0);assert.equal(p.totalUnits,2);assert.equal(p.includedUnits,0);assert.match(p.csv,/완료본 없음/);assert.match(p.csv,/미제출 단위/);assert.equal(p.csv.charCodeAt(0),0xfeff)
})
await test('검토 대기본은 완료본에서 제외하고 최신 제출 기준에만 넣는다',async()=>{
 const f=fixture(),s=await submit(f)
 assert.equal(fileExportPlan(f.store,manager,f.request.id,'effective').jobs.length,0)
 const p=fileExportPlan(f.store,manager,f.request.id,'current');assert.equal(p.jobs[0].submissionId,s.id);assert.match(p.csv,/검토 대기/)
})
await test('완료 v1 이후 검토 대기 v2가 생겨도 완료본 기준은 v1을 고정한다',async()=>{
 const f=fixture(),s1=await submit(f,'1차.pdf');accept(f,s1);const s2=await submit(f,'2차.pdf')
 assert.equal(fileExportPlan(f.store,manager,f.request.id,'effective').jobs[0].submissionId,s1.id)
 assert.equal(fileExportPlan(f.store,manager,f.request.id,'current').jobs[0].submissionId,s2.id)
})
await test('새 제출판이나 검토 변경이 생기면 기존 다운로드 준비를 무효화한다',async()=>{
 const f=fixture(),s=await submit(f),p=fileExportPlan(f.store,manager,f.request.id,'current')
 accept(f,s);assert.throws(()=>assertFileExportCurrent(f.store,manager,p),e=>e.code==='VERSION_CONFLICT')
})
await test('철회된 제출판은 새 계획에 포함하지 않는다',async()=>{
 const f=fixture();await submit(f);const p=fileExportPlan(f.store,manager,f.request.id,'current')
 f.store.withdraw(author,f.unit.id,f.store.unitSummary(author,f.unit.id).unit.version,'잘못 첨부',key())
 assert.equal(fileExportPlan(f.store,manager,f.request.id,'current').jobs.length,0)
 assert.throws(()=>assertFileExportCurrent(f.store,manager,p),e=>e.code==='VERSION_CONFLICT')
})
await test('미제출 초안 파일은 최신 제출본에도 들어가지 않는다',async()=>{
 const f=fixture(),ref=await f.files.stage(new File(['%PDF-1.4\n비공개 초안'],'초안.pdf',{type:'application/pdf'}),policy,{schoolId:'fixture-school-gaon',memberId:author})
 f.store.saveDraft(author,f.unit.id,{text:'',number:null,files:[ref]},0,key())
 assert.equal(fileExportPlan(f.store,manager,f.request.id,'current').jobs.length,0)
 assert.doesNotMatch(fileExportPlan(f.store,manager,f.request.id,'current').csv,/초안.pdf/)
})
await test('수식 같은 단위명과 파일명은 CSV에서 수식이 되지 않는다',async()=>{
 const f=fixture();await submit(f,'=응답.pdf');const p=fileExportPlan(f.store,manager,f.request.id,'current')
 assert.match(p.csv,/"'=1\+1"/);assert.match(p.csv,/"'=응답.pdf"/);assert.match(p.csv,/002_001_=1\+1_v1_=응답.pdf/)
})
await test('CSV는 따옴표·쉼표·줄바꿈을 하나의 인용 셀로 보존한다',async()=>{
 const f=fixture({units:[{label:'합성 "A",B\nC',responsibleMemberId:author,contributorMemberIds:[]}]})
 await submit(f);assert.match(fileExportPlan(f.store,manager,f.request.id,'current').csv,/"합성 ""A"",B\nC"/)
})
await test('다운로드에 관계 없는 개인 할 일 변경은 준비를 무효화하지 않는다',async()=>{
 const f=fixture();await submit(f);const p=fileExportPlan(f.store,manager,f.request.id,'current')
 f.store.createTask(manager,{title:'개인 합성',notes:'',dueDate:''},key());assert.doesNotThrow(()=>assertFileExportCurrent(f.store,manager,p))
})
await test('담당자 외 참가자와 타 학교는 묶음을 준비하지 못한다',()=>{
 const f=fixture();for(const actor of [author,'nuri-soyeon'])assert.throws(()=>fileExportPlan(f.store,actor,f.request.id,'current'))
 assert.throws(()=>fileExportPlan(f.store,manager,f.request.id,'invalid'))
})
await test('담당자의 소속이 만료되면 이미 준비한 계획도 사용하지 못한다',async()=>{
 const f=fixture();await submit(f);const p=fileExportPlan(f.store,manager,f.request.id,'current')
 f.store.setContext({members:members.map(m=>m.id===manager?{...m,active:false}:m),date})
 assert.throws(()=>assertFileExportCurrent(f.store,manager,p))
})
await test('검토 없는 수합은 접수한 제출판이 완료본이다',async()=>{
 const f=fixture({reviewMode:'none',reviewerMemberId:''}),s=await submit(f)
 const p=fileExportPlan(f.store,manager,f.request.id,'effective');assert.equal(p.jobs[0].submissionId,s.id);assert.match(p.csv,/응답 완료/)
})
await test('완료본/최신 제출 선택과 준비 버튼을 SSR에서 구분한다',()=>{
 const f=fixture(),html=renderExport({store:f.store,member:members.find(m=>m.id===manager),request:f.request})
 assert.match(html,/제출 파일 모아 받기/);assert.match(html,/검토 대기 포함/);assert.match(html,/최신 현황으로 묶음 준비/);assert.doesNotMatch(html,/>ZIP 내려받기</);assert.match(html,/미제출 초안은 포함하지 않습니다/)
})
console.log('\n'+passed+' passed, '+failed+' failed');if(failed)process.exitCode=1
