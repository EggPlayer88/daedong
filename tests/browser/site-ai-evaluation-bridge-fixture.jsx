import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthContext } from '../../apps/main/src/lib/AuthContext.jsx'
import { SeasonalWorkContext } from '../../apps/main/src/site/SeasonalWorkProvider.jsx'
import WorkhubPage from '../../apps/main/src/pages/WorkhubPage.jsx'

// 실제 main WorkhubPage 게이트와 주소 조립을 확인한다. 자식 업무 앱만 props 관측용으로 대체한다.
window.evaluationBridge = { mounts:0, unmounts:0 }
function Fixture() {
  const [auth,setAuth] = useState({session:{user:{id:'admin-one'}},profile:{id:'admin-one',name:'가상 관리자',role:'superadmin',is_active:true},profileLoading:false,profileError:null})
  const [seasonal,setSeasonal] = useState({state:{enabled:false},loading:false,error:''})
  window.evaluationBridge.setSeasonal = setSeasonal
  window.evaluationBridge.setAuth = setAuth
  return <AuthContext.Provider value={auth}><SeasonalWorkContext.Provider value={seasonal}>
    <BrowserRouter basename="/school-site"><WorkhubPage /></BrowserRouter>
  </SeasonalWorkContext.Provider></AuthContext.Provider>
}
createRoot(document.getElementById('root')).render(<Fixture />)
