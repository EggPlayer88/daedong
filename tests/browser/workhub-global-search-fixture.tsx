import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'

// 가상 교사 36명만 있는 합성 학교. 실제 계정·DB·AI를 호출하지 않는다.
const w=window as any,clone=structuredClone,date='2026-10-21'
const teacher={...fixtureData.memberships[0],id:'member-01',userId:'user-01',schoolId:fixtureData.schools[0].id,name:'가상 교사 01',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31'}
const members=Array.from({length:36},(_,i)=>({...teacher,id:`member-${String(i+1).padStart(2,'0')}`,userId:`user-${String(i+1).padStart(2,'0')}`,name:`가상 교사 ${String(i+1).padStart(2,'0')}`}))
let denied=false,authChanged=()=>{}
const context={schools:fixtureData.schools,memberships:members,basisDate:date,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}
const envelope=(contract:string,data:any)=>({contract,schoolId:teacher.schoolId,memberId:teacher.id,data})
const doc=(n:number)=>({id:`doc-${n}`,schoolId:teacher.schoolId,ownerMemberId:teacher.id,version:2,latestVersion:2,status:'confirmed',updatedAt:'2026-10-20T00:00:00Z',canEdit:false,origin:null,title:`학교 행사 문서 ${String(n).padStart(2,'0')}`,kind:'general',body:n===1?'앞부분 '.repeat(100)+'멀리숨은문장'+' 뒷부분'.repeat(50):`검색한 ${n}번 문서의 정확한 2판`,visibility:'private',sources:[],basisDate:date,studentContext:null})
const source={id:'source-one',schoolId:teacher.schoolId,authorMemberId:teacher.id,version:2,status:'retired',title:'지난 학년도 학사 지침',body:'과거 원문 2판의 확정 내용',kind:'school_guide',locator:'학사 지침 3쪽',effectiveFrom:'2025-03-01',effectiveThrough:'2026-02-28',updatedAt:'2026-10-19T00:00:00Z'}
const course={id:'course-one',schoolId:teacher.schoolId,version:1,label:'가상 1학년 국어',termId:'term-one',subjectId:'korean',assignmentId:'assignment-one',validFrom:'2026-08-13',validThrough:'2027-02-28',canRecord:true,canCounsel:false,canManageRoster:true}
const teaching={contractVersion:'teaching.v1',schoolId:teacher.schoolId,memberId:teacher.id,ownerUserId:teacher.userId}
w.qa={calls:[],failNext:false,defer:false,releases:[],deny(){denied=true;authChanged()},teachers:members}
const services:any={getSession:async()=>({user:{id:teacher.userId}}),fetchMyProfile:async()=>({id:teacher.userId,name:teacher.name,email:'virtual@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}),onAuthStateChange(cb:any){authChanged=()=>cb({user:{id:teacher.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},async rpc(name:string,args:any){
 w.qa.calls.push(clone({name,args})); const ok=(data:any)=>({data,error:null})
 if(name==='workhub_context')return ok(clone(context))
 if(name==='workhub_calendar_list'||name==='workhub_task_list')return ok([])
 if(name==='workhub_collection_list')return ok({contractVersion:1,schoolId:teacher.schoolId,memberId:teacher.id,error:{code:'NOT_READY'}})
 if(name==='workhub_document_list'){
   if(args.p_cursor&&w.qa.failNext){w.qa.failNext=false;return{data:null,error:{message:'QUERY_FAILED'}}}
   let items=args.p_archived?Array.from({length:10},(_,i)=>({...doc(i+51),status:'archived'})):Array.from({length:args.p_cursor?1:50},(_,i)=>doc(args.p_cursor?61:i+1))
   if(args.p_query)items=items.filter(d=>(d.title+'\n'+d.body).includes(args.p_query))
   const raw=ok(envelope('documents.v1',{items,nextCursor:!args.p_archived&&!args.p_query&&!args.p_cursor?'next-docs':null,canShare:true}))
   if(w.qa.defer){w.qa.defer=false;await new Promise(resolve=>w.qa.releases.push(()=>resolve(null)))}return raw
 }
 if(name==='workhub_document_get')return ok(envelope('documents.v1',{...doc(Number(args.p_document_id.slice(4))),version:args.p_version,latestVersion:3}))
 if(name==='workhub_document_history')return ok(envelope('documents.v1',{documentId:args.p_document_id,versions:[3,2,1].map(version=>({version,recordedAt:'2026-10-20T00:00:00Z',status:'confirmed'}))}))
 if(name==='workhub_template_list')return ok(envelope('guided.v1',{items:[],nextCursor:null,canCreate:true}))
 if(name==='workhub_knowledge_list')return ok(envelope('knowledge.v1',{items:!args.p_query||(source.title+source.body).includes(args.p_query)?[source]:[],nextCursor:null,canManage:true}))
 if(name==='workhub_knowledge_get')return ok(envelope('knowledge.v1',{source:clone(source),isCurrent:false,canManage:true}))
 if(name==='workhub_knowledge_history')return ok(envelope('knowledge.v1',{sourceId:source.id,authorMemberId:teacher.id,items:[{version:2,status:'retired',title:source.title,recordedAt:source.updatedAt,isCurrent:false}],nextBeforeVersion:null,canManage:true}))
 if(name==='workhub_teaching_catalog')return ok({...teaching,courses:[course],terms:[{id:'term-one',schoolId:teacher.schoolId,version:1,label:'2026 2학기',firstDay:'2026-08-13',lastDay:'2027-02-28'}],subjects:[{id:'korean',label:'국어'}],approvedTeachers:members.map(m=>({id:m.id,label:m.name})),canManageCourses:true})
 if(name==='workhub_teaching_course')return ok({...teaching,course,students:[],rubrics:[],imports:[]})
 return{data:null,error:{message:'NOT_READY'}}
}}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={teacher.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)}/> )
