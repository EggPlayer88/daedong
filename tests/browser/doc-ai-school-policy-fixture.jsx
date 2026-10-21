import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AuthContext} from '../../apps/main/src/lib/AuthContext.jsx'
import DocAiPage from '../../apps/main/src/pages/DocAiPage.jsx'
const qa=window.qa={show:true,calls:[],saves:[],loads:[],receipts:{},mode:'ok',generated:0,release:null}
qa.store={listConversations:async()=>({rows:[],error:null}),loadConversation:async id=>({row:{id,messages:[]},error:null}),saveConversation:async row=>{qa.saves.push(row);return{error:null}},markCompleted:async()=>({error:null}),deleteConversation:async()=>({error:null}),newConversationId:()=>crypto.randomUUID()}
function App(){const[user,setUser]=useState('user-one'),[show,setShow]=useState(true);qa.changeUser=setUser;qa.show=setShow;return<AuthContext.Provider value={{session:user?{user:{id:user},access_token:'token-'+user}:null}}>{show&&<DocAiPage/>}</AuthContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>)
