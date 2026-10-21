import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AssistantPracticePanel} from '../../apps/workhub/src/assistant/practice/AssistantPracticePanel'
import {createPendingRequests,PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
const w=window as any
w.outerPending=createPendingRequests();w.outerDrafts=createEditDrafts();w.outerPending.put('operating-scope','assistantSchoolSettings',{key:'real-unresolved-key',command:{expectedCredentialVersion:2}})
const binding=w.outerDrafts.bind('operating-scope','assistant');binding.save({prompt:'운영 화면에서 보관 중인 입력'})
function App(){const[show,setShow]=useState(true);w.setShow=setShow;return <PendingRequestsProvider store={w.outerPending}><EditDraftsProvider store={w.outerDrafts}>{show&&<AssistantPracticePanel onNavigationLockChange={value=>w.practiceLocked=value}/>}</EditDraftsProvider></PendingRequestsProvider>}
const host=document.getElementById('root')!;const shadow=host.attachShadow({mode:'open'});const target=document.createElement('div');shadow.append(target);createRoot(target).render(<React.StrictMode><App/></React.StrictMode>)
