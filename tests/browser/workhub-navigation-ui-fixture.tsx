// 실제 공통 화면과 합성 조회·읽음 응답만 사용한다. 운영 계정·DB·AI는 연결하지 않는다.
import React,{useState} from 'react'
import{createRoot}from'react-dom/client'
import{WorkspaceShell}from'../../apps/workhub/src/app/WorkspaceShell'
import{WorkspaceSearch}from'../../apps/workhub/src/search/WorkspaceSearch'
import{MessagingWorkspace}from'../../apps/workhub/src/messaging/MessagingWorkspace'
import{ConnectionRecoveryActions}from'../../apps/workhub/src/app/ConnectionRecoveryActions'
import{ConnectionReadinessPanel}from'../../apps/workhub/src/app/ConnectionReadinessPanel'
import{ModuleFailureView}from'../../apps/workhub/src/app/ModuleBoundary'
import{EditDraftsProvider,createEditDrafts}from'../../apps/workhub/src/app/edit-drafts'
import{PendingRequestsProvider,createPendingRequests}from'../../apps/workhub/src/app/pending-requests'
import baseStyles from '../../apps/workhub/src/style.css?inline'
import{enabledModules}from'../../apps/workhub/src/modules'
const now='2026-10-27T01:30:00.000Z',member={id:'teacher',userId:'user',schoolId:'school',name:'시험 선생님',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const notices=[{id:'notice',schoolId:'school',ownerMemberId:'teacher',title:'현장체험학습 계획서 제출 안내',body:'이번 주 금요일까지 학급별 계획서를 제출해 주세요.\n제출 양식과 기한은 문서 수합에서 확인할 수 있습니다.',createdAt:now,readAt:null,version:1,source:{module:'collections',id:'collection-one'}},{id:'cooperation',schoolId:'school',ownerMemberId:'teacher',title:'학년 협의 자료 확인 요청',body:'담당 업무와 준비 자료를 확인해 주세요.',createdAt:now,readAt:now,version:2,source:{module:'cooperation',id:'cooperation-one'}},{id:'hidden',schoolId:'school',ownerMemberId:'teacher',title:'학생 기록 확인',body:'접근 가능한 메뉴에서 확인해 주세요.',createdAt:now,readAt:null,version:1,source:{module:'students',id:'student-one'}}]
const qa=window.qa={writes:[],opens:[],loads:[],checks:0,retries:0,discarded:0,empty:false,failed:false}
const clone=value=>structuredClone(value),drafts=createEditDrafts(),pending=createPendingRequests()
const modules=enabledModules('connected').filter(item=>!window.uiConfig?.participant||['home','tasks','messages'].includes(item.id))
const sources=[{kind:'menu',label:'메뉴',async load(){qa.loads.push('menu');return modules.map(item=>({kind:'menu',id:item.id,title:item.title,description:'학교 업무 메뉴 바로 열기',meta:'현재 이용 가능한 메뉴'}))}},{kind:'knowledge',label:'학교 자료',async load(){qa.loads.push('knowledge');if(qa.failed)throw new Error('synthetic');return[{kind:'knowledge',id:'guide',title:'현장체험학습 운영 안내',description:'안전교육, 학급별 계획서 제출, 인원 확인 절차를 안내합니다.',meta:'2026학년도 · 게시 자료 · 판 3',version:3}]} }]
const server={async readiness(){return{available:true,reason:'ready',limits:{bodyCharacters:5000,titleCharacters:100,recipients:100},attachments:'not_configured'}},async recipients(){return{items:[],nextCursor:null}},async threads(){return{items:[],nextCursor:null}},async inbox(member,unread){return{items:qa.empty?[]:clone(notices.filter(n=>!unread||!n.readAt)),nextCursor:null}},async mutate(member,command,key){qa.writes.push(clone(command));const n=notices.find(n=>n.id===command.noticeId);n.readAt=now;n.version++;return{requestKey:key,kind:command.kind,recordedAt:now,deliveries:[],threadId:null,throughSequence:null,noticeId:n.id,version:n.version}}}
function App(){
 const[page,setPage]=useState(window.uiConfig?.page??'messages'),[view,setView]=useState(window.uiConfig?.view??'messages'),[locked,setLocked]=useState(false),[hasDraft,setDraft]=useState(true),[hasPending,setPending]=useState(false),[revision,setRevision]=useState(0)
 Object.assign(qa,{navigate:setPage,view:setView,lock:setLocked,pending:setPending,refresh:()=>setRevision(v=>v+1)})
 return <><style>{baseStyles}</style><EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><WorkspaceShell page={page} mode='connected' schoolName='대동여자중학교 · 화면 시험' memberName='시험 선생님' navigationModules={modules} participant={Boolean(window.uiConfig?.participant)} locked={locked} onNavigate={setPage} quickActions={<WorkspaceSearch scopeKey='synthetic-school' sources={sources} locked={locked} onOpen={item=>{qa.opens.push(item);if(locked)return false;if(item.kind==='menu')setPage(item.id);return true}}/>}>
 <main className='main-content'><header className='page-header'><div><p className='eyebrow'>대동여자중학교 · 화면 시험</p><h1 tabIndex={-1}>{modules.find(item=>item.id===page)?.title}</h1></div></header>
 {view==='messages'?<MessagingWorkspace member={member} server={server} connection={{}} date='2026-10-27' revision={revision} onNavigationLockChange={setLocked} canOpenSource={source=>source.module==='collections'} onOpenSource={source=>{qa.opens.push(source)}}/>:
 view==='recovery'?<ConnectionRecoveryActions hasDraft={hasDraft} hasPending={hasPending} announcement='' legacyHomeHref='/legacy' onDiscard={()=>{if(hasPending)return false;qa.discarded++;setDraft(false);return true}}/>:
 view==='readiness'?<ConnectionReadinessPanel runCheck={async()=>{qa.checks++;return{stage:'no_membership',code:'NO_ACTIVE_MEMBERSHIP',checkedAt:now,readySchoolCount:0}}}/>:
 <ModuleFailureView moduleName='학교 자료' retried onRetry={()=>qa.retries++}/>}
 </main></WorkspaceShell></PendingRequestsProvider></EditDraftsProvider></>
}
createRoot(document.getElementById('root')).render(<App/> )
