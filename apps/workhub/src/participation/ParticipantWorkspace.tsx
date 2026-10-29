import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Membership } from '../contracts'
import { enabledModules, type PageId } from '../modules'
import '../typography.css'
import { WorkspaceShell } from '../app/WorkspaceShell'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { createEditDrafts, EditDraftsProvider } from '../app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../app/pending-requests'
import { useWorkspaceNavigation } from '../app/navigation'
import { ModuleBoundary } from '../app/ModuleBoundary'
import { watchSchoolDay } from '../app/school-day'
import { navigationBlockedMessage } from '../app/navigation'
import { createSupabaseTaskAdapter } from '../tasks/supabase-task-adapter'
import { createSupabaseCalendarAdapter } from '../connection/supabase-calendar'
import { createSupabaseCollectionServer } from '../collections/supabase-collections'
import { createCollectionOperations } from '../collections/operations'
import { TaskPanel } from '../tasks/TaskPanel'
import { CalendarPanel } from '../calendar/CalendarPanel'
import scopeDefinitions from './scopes.json'
import theme from '../style.css?inline'

const Messages=lazy(()=>import('../messaging/MessagingWorkspace').then(m=>({default:m.MessagingWorkspace})))
const Cooperation=lazy(()=>import('../cooperation/CooperationWorkspace').then(m=>({default:m.CooperationWorkspace})))
const Transitions=lazy(()=>import('../administration/SchoolTransitions').then(m=>({default:m.SchoolTransitions})))
const Timetable=lazy(()=>import('../timetable/TimetableOperationsWorkspace').then(m=>({default:m.TimetableOperationsWorkspace})))
const Teaching=lazy(()=>import('../teaching/TeachingWorkspace').then(m=>({default:m.TeachingWorkspace})))
const Collections=lazy(()=>import('../collections/CollectionServerPanel').then(m=>({default:m.CollectionServerPanel})))
const TimetableAgenda=lazy(()=>import('../timetable/TimetableAgendaPanel').then(m=>({default:m.TimetableAgendaWorkspace})))
export interface ParticipantAccess { userId:string;schoolId:string;memberId:string;scopes:string[];expiresAt:string;revision:number }
export const participantPage = (scope:string):PageId => ({teaching:'students',transitions:'schoolAdmin'}[scope] ?? scope) as PageId

// 공통 화면 틀을 재사용하되 승인된 업무만 구성한다. 서버도 모든 RPC에서 같은 범위를 검사한다.
export function ParticipantWorkspace({access,connection:provided}:{access:ParticipantAccess;connection?:SupabaseConnection}) {
 const [connection]=useState(()=>provided??createSupabaseConnection(undefined,{participant:true}))
 const [drafts]=useState(()=>createEditDrafts(true)),[pending]=useState(createPendingRequests)
 const draftCount=useSyncExternalStore(drafts.subscribe,drafts.count,drafts.count),pendingCount=useSyncExternalStore(pending.subscribe,pending.count,pending.count)
 const accessKey=JSON.stringify([access.userId,access.schoolId,access.memberId,access.revision,access.expiresAt,access.scopes])
 const [loaded,setContext]=useState<{key:string;member:Membership;members:Membership[];date:string;name:string}>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[locked,setLocked]=useState(false)
 // 소속/범위가 바뀐 렌더에서 이전 학교 내용을 한 프레임도 전달하지 않는다.
 const context=loaded?.key===accessKey?loaded:undefined
 const pages=scopeDefinitions.filter(s=>access.scopes.includes(s.id))
 const displayModules=pages.flatMap(scope=>enabledModules('connected').filter(module=>module.id===participantPage(scope.id)).map(module=>({...module,title:scope.label})))
 const navigation=useWorkspaceNavigation({allowedPages:pages.map(s=>participantPage(s.id)),defaultPage:participantPage(pages[0]?.id??'messages'),scopeKey:`${access.userId}:${access.memberId}`,locked:locked||(!context&&(draftCount>0||pendingCount>0)),exitLocked:draftCount>0||pendingCount>0})
 const page=navigation.page as PageId
 const [opened,setOpened]=useState<{page:PageId;id:string;key:string;lessonDate?:string}>()
 const basisDate=useRef<string>();basisDate.current=context?.date
 const host=useRef<HTMLDivElement>(null),[root,setRoot]=useState<ShadowRoot>()
 const taskAdapter=useMemo(()=>createSupabaseTaskAdapter(connection),[connection]),calendarAdapter=useMemo(()=>createSupabaseCalendarAdapter(connection),[connection])
 const collectionServer=useMemo(()=>createSupabaseCollectionServer(connection),[connection]),collectionOperations=useMemo(()=>createCollectionOperations(connection),[connection])
 useEffect(()=>{if(host.current)setRoot(host.current.shadowRoot??host.current.attachShadow({mode:'open'}))},[])
 useEffect(()=>watchSchoolDay(window,()=>setAttempt(n=>n+1),()=>basisDate.current),[])
 useEffect(()=>{setOpened(undefined)},[access.userId,access.memberId,access.schoolId])
 useEffect(()=>{
  let alive=true,invalidated=false
  setContext(undefined);setError('')
  const stop=()=>{invalidated=true;if(alive){drafts.suspend();setContext(undefined);setError('현재 참여 허용과 학교 소속을 다시 확인해 주세요.')}}
  const off=connection.subscribeInvalidation(stop),deadline=setTimeout(stop,10000)
  void connection.loadContext(access.schoolId).then(c=>{
   if(!alive||invalidated)return
   clearTimeout(deadline)
   const member=c.memberships.find(m=>m.id===access.memberId&&m.userId===access.userId&&m.schoolId===access.schoolId)
   if(Date.parse(access.expiresAt)<=Date.now()||!member||!activeAt(member,c.basisDate)||c.schools.length!==1||c.memberships.some(m=>m.schoolId!==access.schoolId))throw new Error('scope')
   drafts.activate(recoveryScope(member));pending.retainScopes([recoveryScope(member)])
   setContext({key:accessKey,member,members:c.memberships,date:c.basisDate,name:c.schools.find(s=>s.id===member.schoolId)!.name})
  }).catch(()=>{clearTimeout(deadline);stop()})
  const expiry=setTimeout(stop,Math.min(2147483647,Math.max(0,Date.parse(access.expiresAt)-Date.now())))
  return()=>{alive=false;clearTimeout(deadline);clearTimeout(expiry);off()}
 },[connection,drafts,pending,accessKey,attempt])
 function open(next:PageId,id?:string,lessonDate?:string){if(!pages.some(s=>participantPage(s.id)===next)||!navigation.requestNavigate(next))return false;setOpened(id?{page:next,id,key:crypto.randomUUID(),lessonDate}:undefined);return true}
 const props=context?{connection,member:context.member,date:context.date,onNavigationLockChange:setLocked}:null
 const content=<WorkspaceShell participant mode="connected" page={page} onNavigate={next=>{open(next)}} schoolName={context?.name??'업무실'} memberName={context?.member.name??'선생님'} navigationModules={displayModules} locked={locked} notice={navigation.announcement&&<p role="status">{navigation.announcement}</p>}><main className="main-content participant-workspace"><header className="page-header"><div><p className="eyebrow">{context?.name??'업무실'} · 업무 참여</p><h1>{pages.find(scope=>participantPage(scope.id)===page)?.label??'업무실'}</h1></div></header>
 {error?<div role="alert"><p>{error}</p><button onClick={()=>setAttempt(n=>n+1)}>학교 소속 다시 확인</button></div>:props&&context?<ModuleBoundary moduleName={pages.find(s=>participantPage(s.id)===page)?.label??'업무'} resetKey={`${access.userId}:${access.memberId}:${page}`}><Suspense fallback={<p role="status">업무 화면을 준비하고 있습니다…</p>}>
 {page==='messages'?<Messages {...props} canOpenSource={s=>['cooperation','timetable','collections','tasks','calendar','transitions'].includes(s.module)&&access.scopes.includes(s.module)} onOpenSource={s=>{if(!open(s.module==='transitions'?'schoolAdmin':s.module as PageId,s.id))throw new Error(navigationBlockedMessage)}}/>:null}
 {page==='tasks'?<TaskPanel adapter={taskAdapter} member={context.member} date={context.date} onNavigationLockChange={setLocked} openRequest={opened?.page===page?{key:opened.key,taskId:opened.id}:undefined}/>:null}
 {page==='calendar'?<CalendarPanel member={context.member} members={context.members} schoolName={context.name} date={context.date} adapter={calendarAdapter} revision={attempt} page="calendar" onPageChange={()=>{}} onNavigationLockChange={setLocked} openRequest={opened?.page===page?{key:opened.key,id:opened.id}:undefined}
 renderLessonAgenda={access.scopes.includes('timetable')?date=><ModuleBoundary moduleName="내 수업" resetKey={`${context.member.id}:${date}`}><Suspense fallback={<p role="status">내 수업을 확인하고 있습니다…</p>}><TimetableAgenda connection={connection} member={context.member} date={date} revision={attempt} onOpen={(id,day)=>{open('timetable',id,day)}}/></Suspense></ModuleBoundary>:undefined}/>:null}
 {page==='cooperation'?<Cooperation {...props} onOpenTask={id=>open('tasks',id)} openRequest={opened?.page===page?{key:opened.key,id:opened.id}:undefined}/>:null}
 {page==='schoolAdmin'?<Transitions {...props} openRequest={opened?.page===page?{key:opened.key,id:opened.id}:undefined}/>:null}
 {page==='timetable'?<Timetable embeddedHeader {...props} aiEnabled={false} initialNotificationId={opened?.page===page&&!opened.lessonDate?opened.id:undefined} initialLessonId={opened?.page===page&&opened.lessonDate?opened.id:undefined} initialDate={opened?.page===page?opened.lessonDate:undefined}/>:null}
 {page==='students'?<Teaching {...props}/>:null}
 {page==='collections'?<Collections server={collectionServer} operations={collectionOperations} member={context.member} members={context.members} date={context.date} onNavigationLockChange={setLocked} openRequest={opened?.page===page?{key:opened.key,id:opened.id}:undefined}/>:null}
 </Suspense></ModuleBoundary>:<p role="status">학교 소속을 확인하고 있습니다…</p>}
 </main></WorkspaceShell>
 return <div ref={host}>{root?createPortal(<EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{theme.replaceAll(':root',':host').replace(/(^|[}\s,])body(?=\s*[{,])/g,'$1.participant-workspace')}{`:host{display:block}.participant-workspace{min-width:0}.ws-participant .participant-workspace>.page-header{margin-bottom:20px}.ws-participant .ws-context{min-height:64px}@media(max-width:720px){.ws-shell.ws-participant .ws-navigation{grid-template-columns:repeat(var(--ws-nav-count),minmax(0,1fr))}.ws-participant .ws-context{min-height:36px}}`}</style>{content}</PendingRequestsProvider></EditDraftsProvider>,root):<p role="status">업무 참여 화면을 준비하고 있습니다…</p>}</div>
}
