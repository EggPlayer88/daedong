import React,{useState}from'react'
import{createRoot}from'react-dom/client'
import{SchoolAdminPanel}from'../../apps/workhub/src/setup/SchoolAdminPanel'
import{SchoolAdminError}from'../../apps/workhub/src/setup/school-admin-contract'
import{EditDraftsProvider,createEditDrafts}from'../../apps/workhub/src/app/edit-drafts'
import{PendingRequestsProvider,createPendingRequests}from'../../apps/workhub/src/app/pending-requests'
// 실제 관리 패널을 쓰되 학교·계정·서버 응답은 합성이다.
const w=window as any,clone=structuredClone
const member={id:'member-one',userId:'user-one',schoolId:'school-one',name:'가상 관리자',role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[]} as const
const configuration={draftId:'year-one',schoolName:'합성 중학교',schoolCode:'synthetic-middle',schoolType:'middle',gradeCount:'3',schoolYear:'2026',startsOn:'2026-03-01',lastDay:'2027-02-28',terms:[{id:'term-one',termNo:'1',name:'1학기',startsOn:'2026-03-01',lastDay:'2026-08-12'},{id:'term-two',termNo:'2',name:'2학기',startsOn:'2026-08-13',lastDay:'2027-02-28'}],departments:[{id:'dept-one',name:'합성 부서'}],classes:[{id:'class-one',grade:'1',classNo:'1',name:'1학년 1반',kind:'regular'}]}
const data={version:3,asOfDate:'2026-11-12',availableYears:[2026],configuration,subjects:[{id:'subject-one',name:'도덕'}],memberships:[{id:'member-one',name:'가상 관리자',status:'active',startsOn:'2026-01-01',lastDay:'2027-12-31',version:1}],assignments:[],capabilities:{configuration:true,memberships:true,assignments:true}}
const receipts=new Map(),pending=createPendingRequests(),memory=createEditDrafts()
const q=w.qa={calls:[],results:[],alternate:[],writes:0,hold:false,unknown:false,malformed:'',failRead:false,throwResult:false,throwUpdated:false,pending,data}
const server:any={async readiness(){return{available:true}},async get(){if(q.failRead)throw new SchoolAdminError('QUERY_FAILED');return clone(data)},async mutate(memberId:string,c:any,key:string){
 q.calls.push(clone({memberId,c,key}));if(q.hold)await new Promise<void>(resolve=>q.release=resolve)
 if(receipts.has(key))return clone(receipts.get(key))
 if(c.expectedVersion!==data.version)throw new SchoolAdminError('CONFLICT')
 if(c.kind==='save_configuration'){data.configuration=clone(c.configuration);data.subjects=clone(c.subjects);data.availableYears=[...new Set([...data.availableYears,Number(c.configuration.schoolYear)])]}
 data.version++;q.writes++
 const r:any={requestKey:key,kind:c.kind,version:data.version,schoolYear:c.kind==='save_configuration'?Number(c.configuration.schoolYear):c.schoolYear,recordedAt:'2026-11-12T03:00:00.000Z'}
 receipts.set(key,clone(r));if(q.unknown){q.unknown=false;throw new SchoolAdminError('RESULT_UNKNOWN')}
 if(q.malformed==='key')r.requestKey='wrong';if(q.malformed==='kind')r.kind='assign_duty';if(q.malformed==='year')r.schoolYear=2025;if(q.malformed==='version')r.version=c.expectedVersion;if(q.malformed==='time')r.recordedAt='bad'
 return r
}}
const connection:any={},listener=(r:any)=>{q.results.push(clone(r));if(q.throwResult)throw Error('합성 표시 실패')}
function App(){const[show,setShow]=useState(true),[date,setDate]=useState('2026-11-12'),[service,setService]=useState(()=>server),[account,setAccount]=useState<any>(member),[callback,setCallback]=useState(()=>listener);q.setShow=setShow;q.setDate=setDate;q.replaceServer=()=>setService({...server});q.switchAccount=()=>setAccount({...member,id:'member-two',userId:'user-two'});q.replaceListener=()=>setCallback(()=>(r:any)=>q.alternate.push(clone(r)))
 return<EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}>{show&&<SchoolAdminPanel connection={connection} server={service} member={account} date={date} onWorkflowResult={callback} onUpdated={()=>{if(q.throwUpdated)throw Error('합성 후속 갱신 실패')}}/>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
