import { retryableLazy as lazy } from '../app/retryable-lazy'
import { Suspense, useEffect, useRef, useState } from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {SchoolAdminPanel} from '../setup/SchoolAdminPanel'
import {SchoolTransitions} from './SchoolTransitions'
import {SchoolRosterPanel} from '../setup/SchoolRosterPanel'
import type {SchoolPreparationDestination} from '../setup/school-preparation-summary'
const SchoolAiSettingsPanel=lazy(()=>import('../assistant/SchoolAiWorkspace').then(module=>({default:module.SchoolAiWorkspace})))
const ParticipantAdministration=lazy(()=>import('../participation/ParticipantAdministration').then(module=>({default:module.ParticipantAdministration})))
const SchoolPreparationPanel=lazy(()=>import('../setup/SchoolPreparationPanel').then(module=>({default:module.SchoolPreparationPanel})))
export function SchoolAdministration({connection,member,date,revision=0,onNavigationLockChange,onUpdated,onOpenPreparation,initialGuideOpen=false,transitionOpen}:{connection:SupabaseConnection;member:Membership;date:string;revision?:number;onNavigationLockChange?:(locked:boolean)=>void;onUpdated?:()=>void;onOpenPreparation?:(destination:SchoolPreparationDestination)=>void;initialGuideOpen?:boolean;transitionOpen?:{key:string;id:string}}){
 const[tab,setTab]=useState<'settings'|'transitions'|'roster'|'ai'>(transitionOpen?'transitions':'settings')
 const[guideOpen,setGuideOpen]=useState(initialGuideOpen)
 const[participationOpen,setParticipationOpen]=useState(false)
 const[settingsLocked,setSettingsLocked]=useState(false),[transitionsLocked,setTransitionsLocked]=useState(false),[aiLocked,setAiLocked]=useState(false)
 useEffect(()=>{onNavigationLockChange?.(settingsLocked||transitionsLocked||aiLocked);return()=>onNavigationLockChange?.(false)},[settingsLocked,transitionsLocked,aiLocked,onNavigationLockChange])
 const openedTransition=useRef('')
 useEffect(()=>{if(transitionOpen&&openedTransition.current!==transitionOpen.key&&!settingsLocked&&!transitionsLocked&&!aiLocked){openedTransition.current=transitionOpen.key;setTab('transitions')}},[transitionOpen?.key,settingsLocked,transitionsLocked,aiLocked])
 function openPreparation(destination:SchoolPreparationDestination){if(settingsLocked||transitionsLocked||aiLocked)return;if(destination==='roster')setTab('roster');else if(destination==='school')setTab('settings');else onOpenPreparation?.(destination)}
 return <><details className="school-preparation-disclosure" open={guideOpen} onToggle={event=>setGuideOpen(event.currentTarget.open)}><summary>학교 준비 진행 안내</summary>{guideOpen&&<Suspense fallback={<p role="status">학교 준비 안내를 여는 중…</p>}><SchoolPreparationPanel connection={connection} member={member} revision={revision} disabled={settingsLocked||transitionsLocked||aiLocked} onOpen={openPreparation}/></Suspense>}</details>
 <details open={participationOpen} onToggle={event=>setParticipationOpen(event.currentTarget.open)}><summary>업무 참여 범위·승인 준비</summary>{participationOpen&&<Suspense fallback={<p role="status">참여 설정을 여는 중…</p>}><ParticipantAdministration key={`${member.schoolId}:${member.userId}:${member.id}`} connection={connection} member={member}/></Suspense>}</details>
 <div className="button-row" role="group" aria-label="학교 관리 구분"><button type="button" disabled={settingsLocked||transitionsLocked||aiLocked} aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>학교 구성·교사 담당</button><button type="button" disabled={settingsLocked||transitionsLocked||aiLocked} aria-pressed={tab==='roster'} onClick={()=>setTab('roster')}>가입 교사 연결</button><button type="button" disabled={settingsLocked||transitionsLocked||aiLocked} aria-pressed={tab==='transitions'} onClick={()=>setTab('transitions')}>업무 인계·새 학년도</button><button type="button" disabled={settingsLocked||transitionsLocked||aiLocked} aria-pressed={tab==='ai'} onClick={()=>setTab('ai')}>학교 AI 이용 설정</button></div>{tab==='settings'?<SchoolAdminPanel connection={connection} member={member} date={date} revision={revision} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:tab==='roster'?<SchoolRosterPanel connection={connection} member={member} date={date} onNavigationLockChange={setSettingsLocked} onUpdated={onUpdated}/>:tab==='ai'?<Suspense fallback={<p role="status">학교 AI 설정을 여는 중…</p>}><SchoolAiSettingsPanel connection={connection} member={member} revision={revision} onNavigationLockChange={setAiLocked}/></Suspense>:<SchoolTransitions openRequest={transitionOpen} connection={connection} member={member} revision={revision} onNavigationLockChange={setTransitionsLocked}/>}</>
}
