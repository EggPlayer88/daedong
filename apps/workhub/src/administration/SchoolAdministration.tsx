import {lazy,Suspense,useEffect,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {SchoolAdminPanel} from '../setup/SchoolAdminPanel'
import {SchoolTransitions} from './SchoolTransitions'
import {SchoolRosterPanel} from '../setup/SchoolRosterPanel'
import type {SchoolPreparationDestination} from '../setup/school-preparation-summary'
const SchoolPreparationPanel=lazy(()=>import('../setup/SchoolPreparationPanel').then(module=>({default:module.SchoolPreparationPanel})))
export function SchoolAdministration({connection,member,date,revision=0,onNavigationLockChange,onUpdated,onOpenPreparation,initialGuideOpen=false}:{connection:SupabaseConnection;member:Membership;date:string;revision?:number;onNavigationLockChange?:(locked:boolean)=>void;onUpdated?:()=>void;onOpenPreparation?:(destination:SchoolPreparationDestination)=>void;initialGuideOpen?:boolean}){
 const[tab,setTab]=useState<'settings'|'transitions'|'roster'>('settings')
 const[guideOpen,setGuideOpen]=useState(initialGuideOpen)
 const[settingsLocked,setSettingsLocked]=useState(false),[transitionsLocked,setTransitionsLocked]=useState(false)
 useEffect(()=>{onNavigationLockChange?.(settingsLocked||transitionsLocked);return()=>onNavigationLockChange?.(false)},[settingsLocked,transitionsLocked,onNavigationLockChange])
 function openPreparation(destination:SchoolPreparationDestination){if(settingsLocked||transitionsLocked)return;if(destination==='roster')setTab('roster');else if(destination==='school')setTab('settings');else onOpenPreparation?.(destination)}
 return <><details className="school-preparation-disclosure" open={guideOpen} onToggle={event=>setGuideOpen(event.currentTarget.open)}><summary>학교 준비 진행 안내</summary>{guideOpen&&<Suspense fallback={<p role="status">학교 준비 안내를 여는 중…</p>}><SchoolPreparationPanel connection={connection} member={member} revision={revision} disabled={settingsLocked||transitionsLocked} onOpen={openPreparation}/></Suspense>}</details>
 <div className="button-row" role="group" aria-label="학교 관리 구분"><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>학교 구성·교사 담당</button><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='roster'} onClick={()=>setTab('roster')}>가입 교사 연결</button><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='transitions'} onClick={()=>setTab('transitions')}>업무 인계·새 학년도</button></div>{tab==='settings'?<SchoolAdminPanel connection={connection} member={member} date={date} revision={revision} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:tab==='roster'?<SchoolRosterPanel connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:<SchoolTransitions connection={connection} member={member} revision={revision} onNavigationLockChange={setTransitionsLocked}/>}</>
}
