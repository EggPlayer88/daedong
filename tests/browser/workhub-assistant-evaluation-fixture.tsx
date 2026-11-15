import './reset-fixture-checkpoint'
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {createSupabaseConnection} from '../../apps/workhub/src/connection/supabase-connection'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
const w=window as any,member={...fixtureData.memberships[0],id:'member-01',userId:'user-01',schoolId:fixtureData.schools[0].id,active:true,validFrom:'2026-01-01',validThrough:'2027-12-31'}
let denied=false,authChanged=()=>{}
const qa:any={calls:[],deny(){denied=true;authChanged()}};w.evaluationQA=qa
const services:any={getSession:async()=>({user:{id:member.userId}}),fetchMyProfile:async()=>({id:member.userId,name:'가상 관리자',email:'virtual@example.invalid',role:'superadmin',is_active:!denied,extra_permissions:[],department_id:null}),onAuthStateChange(cb:any){authChanged=()=>cb({user:{id:member.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},async rpc(name:string,args:any){qa.calls.push({name,args:structuredClone(args)});const ok=(data:any)=>({data,error:null});if(name==='workhub_context')return ok({schools:fixtureData.schools,memberships:[member],basisDate:'2026-11-11',schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))});if(name==='workhub_calendar_list'||name==='workhub_task_list')return ok([]);return{data:null,error:{message:'NOT_READY'}}}}
const connection=createSupabaseConnection(services)
function App(){const[links,setLinks]=useState<any>({authoring:'/doc-ai',submissions:'/submissions'});qa.links=setLinks;return <ConnectedWorkspace connection={connection} expectedUserId={member.userId} legacyHomeHref="/account" legacyEvaluationLinks={links}/>}
createRoot(document.getElementById('root')!).render(<App/> )
