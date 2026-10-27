import React,{useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {TeachingWorkspace} from '../../apps/workhub/src/teaching/TeachingWorkspace'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider,createPendingRequests} from '../../apps/workhub/src/app/pending-requests'
import type {Membership} from '../../apps/workhub/src/contracts'
import type {SupabaseConnection} from '../../apps/workhub/src/connection/supabase-connection'
const clone=<T,>(value:T):T=>structuredClone(value)
const member:Membership={id:'member-a',schoolId:'school-a',userId:'user-a',name:'합성 관리자',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2029-01-01',departmentIds:[],gradeIds:[],subjectIds:[]}
const memory=createEditDrafts(),pending=createPendingRequests()
const qa:any={calls:[],courses:[],failAt:0,reject:false,hold:false,holdFile:false,failCatalog:false,pending,memory}
;(window as any).qa=qa
const receipts=new Map<string,unknown>()
const env=(m:Membership)=>({contractVersion:'teaching.v1',schoolId:m.schoolId,memberId:m.id,ownerUserId:m.userId})
function catalog(m:Membership) {
  return {...env(m),courses:qa.courses.filter((c:any)=>c.schoolId===m.schoolId),terms:[
    {id:'term-a',schoolId:m.schoolId,version:1,label:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-31'},
    {id:'term-b',schoolId:m.schoolId,version:1,label:'1학기',firstDay:'2028-03-01',lastDay:'2028-07-31'},
  ],subjects:[{id:'subject-a',label:'국어'},{id:'subject-b',label:'국어'}],approvedTeachers:[{id:'teacher-a',label:'동명 교사'},{id:'teacher-b',label:'동명 교사'}],canManageCourses:true}
}
function connection(m:Membership):SupabaseConnection {
  return {
    getIdentity:async()=>({userId:m.userId,approved:true,profile:{id:m.userId,name:m.name,email:'synthetic@example.invalid',role:'superadmin',is_active:true,extra_permissions:[],department_id:null}}),
    info:()=>({memberships:[m],schools:[{id:m.schoolId,name:'합성 학교'}],basisDate:'2026-10-21'}),
    async rpcVerified(name:string,args:any){
      qa.calls.push(clone({name,args,schoolId:m.schoolId}))
      if(name==='workhub_teaching_catalog'){if(qa.failCatalog)throw Error('합성 조회 실패');return clone(catalog(m))}
      if(name!=='workhub_teaching_mutate')throw Error('예상하지 않은 호출 '+name)
      const key=m.schoolId+':'+args.p_request_key
      if(qa.reject)return {...env(m),ok:false,code:'FORBIDDEN'}
      if(receipts.has(key))return {...clone(receipts.get(key) as object),outcome:'replayed'}
      const command=args.p_command
      if(command.kind!=='course_create')throw Error('다른 명령')
      const id='course-'+(qa.courses.length+1)
      qa.courses.push({id,schoolId:m.schoolId,version:1,label:command.input.label,termId:command.input.termId,subjectId:command.input.subjectId,assignmentId:'assignment-'+id,validFrom:command.input.validFrom,validThrough:command.input.validThrough,canRecord:true,canCounsel:true,canManageRoster:true})
      const receipt={...env(m),requestKey:args.p_request_key,commandKind:'course_create',entityId:id,version:1,outcome:'applied',appliedAt:'2026-10-21T01:00:00Z'}
      receipts.set(key,clone(receipt))
      if(qa.hold){qa.hold=false;await new Promise<void>(resolve=>{qa.release=resolve})}
      if(qa.failAt===qa.courses.length){qa.failAt=0;throw Error('합성 응답 유실')}
      return clone(receipt)
    },
  } as unknown as SupabaseConnection
}
const originalRead=File.prototype.arrayBuffer
File.prototype.arrayBuffer=async function(){const result=await originalRead.call(this);if(qa.holdFile){qa.holdFile=false;await new Promise<void>(resolve=>{qa.releaseFile=resolve})}return result}
function App(){
  const [current,setCurrent]=useState(member),[revision,setRevision]=useState(0),[epoch,setEpoch]=useState(0),[mount,setMount]=useState(0),[locked,setLocked]=useState(false)
  const api=useMemo(()=>connection(current),[current,epoch])
  qa.refresh=()=>setRevision(v=>v+1);qa.replaceConnection=()=>setEpoch(v=>v+1);qa.remount=()=>setMount(v=>v+1)
  qa.switchAccount=()=>setCurrent({...member,id:'member-b',schoolId:'school-b',userId:'user-b',name:'다른 합성 계정'})
  return <><button disabled={locked} data-connection-epoch={epoch} data-school-id={current.schoolId} data-member-id={current.id}>다른 화면</button><EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}><TeachingWorkspace key={mount} connection={api} member={current} revision={revision} date="2026-10-21" onNavigationLockChange={setLocked}/></PendingRequestsProvider></EditDraftsProvider></>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
