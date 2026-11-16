import React,{useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CalendarPanel} from '../../apps/workhub/src/calendar/CalendarPanel'
import {createSupabaseCalendarAdapter} from '../../apps/workhub/src/connection/supabase-calendar'
import {fixtureData} from '../../apps/workhub/src/preview/fixtures'
import {EditDraftsProvider,createEditDrafts} from '../../apps/workhub/src/app/edit-drafts'
import {PendingRequestsProvider,createPendingRequests,recoveryScope} from '../../apps/workhub/src/app/pending-requests'
import {canonical,sha256} from '../../apps/workhub/src/cooperation/protocol'
import styles from '../../apps/workhub/src/style.css?inline'

const w=window as any,copy=structuredClone,member=fixtureData.memberships.find(m=>m.id==='gaon-minjun')!
let events=copy(fixtureData.events),active=member
const drafts=createEditDrafts(),pending=createPendingRequests(),receipts=new Map<string,any>(),stamp='2026-10-19T02:03:04.000Z'
const qa=w.qa={calls:[],results:[],writes:0,pending:()=>pending.get(recoveryScope(member),'calendarLifecycle'),pendingCount:()=>pending.count(),events:()=>copy(events)} as any
const header=()=>({contractVersion:'calendar.lifecycle.v1',schoolId:member.schoolId,memberId:member.id,ownerUserId:member.userId})
const connection:any={info:()=>({...fixtureData,memberships:fixtureData.memberships}),getIdentity:async()=>({userId:active.userId,approved:true,profile:{id:active.userId,is_active:true,role:'teacher',extra_permissions:[],department_id:null}}),
 async rpcVerified(name:string,args:any){qa.calls.push(copy({name,args}))
  if(name==='workhub_calendar_list')return copy(events.filter(e=>e.schoolId===active.schoolId&&e.status!=='cancelled'))
  if(name==='workhub_calendar_cancelled_list')return copy(events.filter(e=>e.schoolId===active.schoolId&&e.status==='cancelled'))
  if(name==='workhub_calendar_get')return copy(events.find(e=>e.id===args.p_event_id))
  if(name!=='workhub_calendar_cancel')throw Error('Unexpected RPC '+name)
  const c=args.p_command,key=args.p_request_key
  let response=receipts.get(key)
  if(!response){
   if(args.p_recover_only)return {...header(),ok:false,outcome:'unknown',code:'SAVE_UNCERTAIN',requestKey:key,commandHash:await sha256(canonical(c))}
   if(qa.failBefore){qa.failBefore=false;throw Error('합성 전송 실패')}
   if(qa.conflict){qa.conflict=false;events=events.map(e=>e.id===c.eventId?{...e,version:e.version+1}:e);return {...header(),ok:false,outcome:'rejected',code:'CONFLICT',requestKey:key,commandHash:await sha256(canonical(c))}}
   const e=events.find(e=>e.id===c.eventId)!
   const next={...e,status:'cancelled',version:e.version+1,updatedAt:stamp,cancelledAt:stamp,cancelReason:c.reason}
   events=events.map(e=>e.id===c.eventId?next:e);qa.writes++
   response={...header(),ok:true,requestKey:key,event:next,recordedAt:stamp};receipts.set(key,copy(response))
  }
  if(qa.hold){qa.hold=false;await new Promise(resolve=>qa.release=resolve)}
  if(qa.failAfter){qa.failAfter=false;throw Error('합성 응답 유실')}
  return copy(response)
 }}
function App(){
 const [generation,setGeneration]=useState(0),[service,setService]=useState(0),[date,setDate]=useState(fixtureData.basisDate),[current,setCurrent]=useState(member),[page,setPage]=useState<'calendar'|'home'>('calendar')
 const adapter=useMemo(()=>createSupabaseCalendarAdapter({...connection}),[service])
 qa.remount=()=>setGeneration(n=>n+1);qa.changeDate=()=>setDate('2026-10-20');qa.changeService=()=>setService(n=>n+1);qa.home=()=>setPage('home')
 qa.changeScope=()=>{active=fixtureData.memberships.find(m=>m.id==='nuri-harin')!;setCurrent(active)}
 return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{styles}</style><CalendarPanel key={generation} member={current} members={fixtureData.memberships} schoolName="합성 학교" date={date} adapter={adapter} revision={0} page={page} onPageChange={setPage} onWorkflowResult={result=>{qa.results.push(copy(result));if(qa.resultThrows)throw Error('표시 오류')}} /></PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
