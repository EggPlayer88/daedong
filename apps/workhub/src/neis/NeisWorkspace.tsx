import {useEffect,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import './neis.css'
import {useServer} from './shared'
import {NeisCalendar} from './NeisCalendar'
import {NeisTimetable} from './NeisTimetable'
type Props={connection:SupabaseConnection;member:Membership;date:string;onNavigationLockChange?:(locked:boolean)=>void;onUpdated?:()=>void}
export function NeisWorkspace({connection,member,date,onNavigationLockChange,onUpdated}:Props){
 const server=useServer(connection),[tab,setTab]=useState<'schedule'|'timetable'>('schedule'),[locked,setLocked]=useState(false)
 useEffect(()=>{onNavigationLockChange?.(locked);return()=>onNavigationLockChange?.(false)},[locked,onNavigationLockChange])
 return <section className="neis-workspace"><header><h2>나이스 학교 자료</h2><p>학사일정은 비교 후 반영하고, 학급 시간표는 원본을 확인합니다.</p></header>
 <div className="button-row" role="group" aria-label="나이스 자료 구분"><button disabled={locked} aria-pressed={tab==='schedule'} onClick={()=>setTab('schedule')}>학사일정 비교</button><button disabled={locked} aria-pressed={tab==='timetable'} onClick={()=>setTab('timetable')}>학급 시간표</button></div>
 {tab==='schedule'?<NeisCalendar server={server} member={member} date={date} onLock={setLocked} onUpdated={onUpdated}/>:<NeisTimetable server={server} member={member} date={date}/>}
 </section>
}
