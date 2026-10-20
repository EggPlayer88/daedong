import {useEffect,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {SchoolAdminPanel} from '../setup/SchoolAdminPanel'
import {SchoolTransitions} from './SchoolTransitions'
import {SchoolRosterPanel} from '../setup/SchoolRosterPanel'
export function SchoolAdministration({connection,member,date,revision=0,onNavigationLockChange,onUpdated}:{connection:SupabaseConnection;member:Membership;date:string;revision?:number;onNavigationLockChange?:(locked:boolean)=>void;onUpdated?:()=>void}){
 const[tab,setTab]=useState<'settings'|'transitions'|'roster'>('settings')
 const[settingsLocked,setSettingsLocked]=useState(false),[transitionsLocked,setTransitionsLocked]=useState(false)
 useEffect(()=>{onNavigationLockChange?.(settingsLocked||transitionsLocked);return()=>onNavigationLockChange?.(false)},[settingsLocked,transitionsLocked,onNavigationLockChange])
 return <><div className="button-row" role="group" aria-label="학교 관리 구분"><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>학교 구성·교사 담당</button><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='roster'} onClick={()=>setTab('roster')}>가입 교사 연결</button><button type="button" disabled={settingsLocked||transitionsLocked} aria-pressed={tab==='transitions'} onClick={()=>setTab('transitions')}>업무 인계·새 학년도</button></div>{tab==='settings'?<SchoolAdminPanel connection={connection} member={member} date={date} revision={revision} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:tab==='roster'?<SchoolRosterPanel connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:<SchoolTransitions connection={connection} member={member} revision={revision} onNavigationLockChange={setTransitionsLocked}/>}</>
}
