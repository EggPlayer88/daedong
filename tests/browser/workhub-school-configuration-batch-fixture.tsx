import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SchoolAdminPanel } from '../../apps/workhub/src/setup/SchoolAdminPanel'
import { SchoolAdminError } from '../../apps/workhub/src/setup/school-admin-contract'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import { schoolBatchFixture } from '../fixtures/school-configuration-batch.mjs'
import { schoolBatchWorkbook, schoolBatchSheets } from '../../apps/workhub/src/setup/school-configuration-batch'
import { writeTimetableXlsx } from '../../apps/workhub/src/timetable/xlsx'
const w = window as any
const member = { id:'member-one',userId:'user-one',schoolId:'school-one',name:'학교 관리자',role:'calendar_manager',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[] }
w.data = { version:3,asOfDate:'2026-10-16',availableYears:[2026],...schoolBatchFixture(),memberships:[],assignments:[],capabilities:{configuration:true,memberships:true,assignments:true} }
w.calls=[];w.failRead=false;w.unknownOnce=false
w.memory=createEditDrafts();w.pending=createPendingRequests()
w.xlsx=(group:string,rows:string[][],foreign=false)=>{
 const scope={schoolId:foreign?'other-school':'school-one',schoolYear:'2026'},sheets=schoolBatchSheets(scope,w.data,group as any,true)
 sheets[0].rows=[sheets[0].rows[0],...rows];return [...writeTimetableXlsx(sheets)]
}
w.currentXlsx=(group:string)=>[...schoolBatchWorkbook({schoolId:'school-one',schoolYear:'2026'},w.data,group as any,true)]
const receipts=new Map()
const server={
 async readiness(){return {available:true}},
 async get(){if(w.failRead)throw new SchoolAdminError('QUERY_FAILED');return structuredClone(w.data)},
 async mutate(memberId:string,command:any,key:string){
  w.calls.push(structuredClone({memberId,command,key}));if(receipts.has(key))return structuredClone(receipts.get(key))
  if(command.expectedVersion!==w.data.version)throw new SchoolAdminError('CONFLICT')
  w.data.version++;w.data.configuration=structuredClone(command.configuration);w.data.subjects=structuredClone(command.subjects)
  const receipt={requestKey:key,kind:command.kind,version:w.data.version,schoolYear:Number(command.configuration.schoolYear),recordedAt:'2026-10-16T09:20:00+09:00'}
  receipts.set(key,receipt);if(w.unknownOnce){w.unknownOnce=false;throw new SchoolAdminError('RESULT_UNKNOWN')}return receipt
 }
}
function App(){
 const[revision,setRevision]=useState(0),[show,setShow]=useState(true),[who,setWho]=useState(member)
 w.refresh=()=>setRevision(n=>n+1);w.setShow=setShow;w.changeMember=()=>setWho({...member,id:'member-two',userId:'user-two'})
 return <EditDraftsProvider store={w.memory}><PendingRequestsProvider store={w.pending}>{show&&<SchoolAdminPanel connection={{} as any} server={server as any} member={who as any} date="2026-10-16" revision={revision} onNavigationLockChange={v=>{w.locked=v}}/>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
