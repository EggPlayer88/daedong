import {lazy,Suspense,useEffect,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {recoveryScope} from '../app/pending-requests'
import styles from './school-operations.css?inline'
const Settings=lazy(()=>import('./SchoolAiSettingsPanel').then(m=>({default:m.SchoolAiSettingsPanel})))
const Operations=lazy(()=>import('./SchoolAiOperationsPanel').then(m=>({default:m.SchoolAiOperationsPanel})))
const Practice=lazy(()=>import('./practice/AssistantPracticePanel').then(m=>({default:m.AssistantPracticePanel})))
interface Props {connection:SupabaseConnection;member:Membership;revision?:number;onNavigationLockChange?:(locked:boolean)=>void}
export function SchoolAiWorkspace(props:Props){return <Scope key={recoveryScope(props.member)} {...props}/>}
function Scope({connection,member,revision,onNavigationLockChange}:Props){
 const[tab,setTab]=useState<'practice'|'settings'|'operations'>('practice'),[locked,setLocked]=useState(false)
 useEffect(()=>{onNavigationLockChange?.(locked);return()=>onNavigationLockChange?.(false)},[locked,onNavigationLockChange])
 return <section className="school-ai-workspace"><style>{styles}</style><div className="school-ai-workspace-tabs" role="group" aria-label="학교 AI 작업 구분">{([['practice','가상 교사 연습'],['settings','학교 키·예산'],['operations','운영 현황·진단']] as const).map(([key,label])=><button type="button" key={key} disabled={locked} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div><Suspense fallback={<p role="status">AI 화면을 여는 중…</p>}>{tab==='practice'?<Practice onNavigationLockChange={setLocked}/>:tab==='settings'?<Settings connection={connection} member={member} revision={revision} onNavigationLockChange={setLocked}/>:<Operations connection={connection} member={member} revision={revision}/>}</Suspense></section>
}
