// 실제 화면을 합성 회원·제출 자료와 연결한다. 운영 요청은 시험 도구가 차단한다.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {supabase} from '@daedong/shared'
import {AuthContext} from '../../apps/main/src/lib/AuthContext.jsx'
import { SeasonalWorkContext } from '../../apps/main/src/site/SeasonalWorkProvider.jsx'
import Layout from '../../apps/main/src/components/Layout.jsx'
import Dashboard from '../../apps/main/src/pages/DashboardPage.jsx'
import Submissions from '../../apps/main/src/pages/SubmissionsPage.jsx'
import AdminUsers from '../../apps/main/src/pages/AdminUsersPage.jsx'
import DocAi from '../../apps/main/src/pages/DocAiPage.jsx'
import Login from '../../apps/main/src/pages/LoginPage.jsx'
import Pending from '../../apps/main/src/pages/PendingPage.jsx'
import {visibleModules} from '../../apps/main/src/lib/modules.js'
const config=window.siteConfig??{}, long=config.long
const profile={id:'synthetic-user',name:long?'이름이 긴 시험 선생님'.repeat(6):'시험 선생님',email:long?'school-teacher-'.repeat(8)+'@example.invalid':'teacher@example.invalid',role:config.role??'superadmin',is_active:true,extra_permissions:[]}
const now='2026-10-27T08:00:00Z'
const rows=Array.from({length:long?48:3},(_,i)=>({id:'file-'+i,user_id:profile.id,subject:i%2?'수학':'국어',grade:i%3+1,file_name:long?'아주긴평가계획서파일이름'.repeat(12)+i+'.hwpx':`2026학년도_2학기_${i%3+1}학년_평가계획서.hwpx`,file_path:'synthetic/'+i,note:i===0?'최종 확인한 평가계획서입니다.':'',status:['submitted','replaced','deleted'][i%3],submitted_at:now}))
const people=Array.from({length:long?60:4},(_,i)=>({...profile,id:'person-'+i,name:'시험 교사 '+(i+1),email:long?profile.email:`teacher${i+1}@example.invalid`,is_active:i>0,role:'teacher',created_at:now,departments:{name:'교무부'}}))
window.qa={writes:[],loads:[],ai:0}
const qa=window.qa
supabase.from=()=>({select(){return this},order:async()=>({data:people,error:null}),update(data){qa.writes.push(data);return{eq:async()=>({error:null})}}})
supabase.auth.signOut=async()=>({error:null})
qa.submissions={listMine:async()=>({rows,error:null}),listAll:async()=>({rows,error:null}),submit:async data=>{qa.writes.push({kind:'submit',subject:data.subject,grade:data.grade,note:data.note});return{error:{message:'시험 연결 실패: 입력을 유지합니다.'}}},cancelSubmission:async row=>{qa.writes.push({kind:'cancel',id:row.id});return{error:null}},downloadUrl:async()=>({url:null,error:{message:'시험 다운로드 응답'}}),removeFile:async()=>({error:null})}
const convs=Array.from({length:long?36:3},(_,i)=>({id:'conv-'+i,title:long?'긴 평가계획 대화 제목 '.repeat(8):`${i+1}학년 수학 평가계획`,subject:'수학',grade:i%3+1,status:'draft',updated_at:now}))
qa.store={listConversations:async()=>({rows:convs,error:null}),loadConversation:async id=>{qa.loads.push(id);return{row:{id,messages:[{role:'assistant',content:long?('확인할 평가계획 내용과 근거를 정리합니다.\n').repeat(120):'평가계획서를 만들기 전에 다음 내용을 확인해 주세요.\n\n1. 교과와 학년을 확인합니다.\n2. 평가 영역과 방법을 정합니다.\n3. 완성된 내용을 검토한 뒤 한글 파일을 생성합니다.\n\n지난 학기 자료가 있다면 참고자료로 첨부할 수 있습니다.'}]},error:null}},saveConversation:async()=>({error:null}),deleteConversation:async()=>({error:null}),markCompleted:async()=>({error:null}),newConversationId:()=>crypto.randomUUID()}
const screens={'/':<Dashboard accountOnly/>,'/submissions':<Submissions/>,'/admin/users':<AdminUsers/>,'/doc-ai':<DocAi/>}
const menu=visibleModules(profile);qa.allowed=menu.map(item=>item.to)
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{profile,session:{user:{id:profile.id,email:profile.email},access_token:'synthetic-token'},profileError:null}}><SeasonalWorkContext.Provider value={{state:{enabled:true}}}><MemoryRouter initialEntries={[config.path??'/']}>
{config.view==='login'?<Login/>:config.view==='pending'?<Pending/>:<Routes><Route element={<Layout/>}>{menu.map(item=>item.to==='/'?<Route key={item.key} index element={screens['/']}/>:<Route key={item.key} path={item.to} element={screens[item.to]??<h2>기존 업무 연결</h2>}/>)}</Route></Routes>}
</MemoryRouter></SeasonalWorkContext.Provider></AuthContext.Provider>)
