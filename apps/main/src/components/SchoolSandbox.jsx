import { useEffect, useState } from 'react'
import { supabase } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { acceptSandboxClock, clearSandboxClock, businessTime, sandboxInputDate, isSchoolSandbox } from '../../../workhub/src/sandbox/clock'

// 이 경계가 준비된 뒤에만 업무 화면을 연다. 시계 연결이 끊기면 실제 날짜로 대체하지 않는다.
export default function SchoolSandbox({children}) {
 const {session}=useAuth(),uid=session?.user?.id
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0),[advance,setAdvance]=useState(''),[dateEdited,setDateEdited]=useState(false)
 const [pending,setPending]=useState(null)
 useEffect(()=>{
  if(!isSchoolSandbox())return
  clearSandboxClock();setState(null);setPending(null);setError('');setAdvance('');setDateEdited(false)
  if(!uid)return
  let alive=true,running=false
  async function read(){if(running)return;running=true;try{
   const {data,error}=await supabase.rpc('workhub_sandbox_status');if(error)throw error
   if(alive&&acceptSandboxClock(data)){setState(data);setError('')}
  }catch{if(alive)setError('시험 시계를 확인하지 못했습니다. 다시 확인할 때까지 새 업무를 시작하지 마세요.')}finally{running=false}}
  void read();const timer=setInterval(read,5000),pulse=setInterval(()=>setTick(n=>n+1),1000)
  return()=>{alive=false;clearInterval(timer);clearInterval(pulse);clearSandboxClock()}
 },[uid])
 const virtualDate=state?sandboxInputDate(businessTime()):''
 useEffect(()=>{if(virtualDate&&!dateEdited&&!pending)setAdvance(virtualDate)},[virtualDate,dateEdited,pending])
 if(!isSchoolSandbox())return children
 const send=async(action)=>{
  const input=pending??{p_action:action,p_expected_version:state.revision,p_request_key:crypto.randomUUID(),p_advance_to:action==='advance'?advance+'T00:00:00+09:00':null}
  setPending(input);setBusy(true);setError('')
  try{const {data,error}=await supabase.rpc('workhub_sandbox_clock_control',input);if(error)throw error;if(acceptSandboxClock(data))setState(data);setPending(null);setDateEdited(false)}catch(error){
   // DB가 명시적으로 거절한 명령과 응답 유실을 구분한다. 결과 미상은 원키를 보존한다.
   if(error?.code==='P0001'&&['CONFLICT','INVALID_INPUT','FORBIDDEN','IDEMPOTENCY_CONFLICT'].includes(error.message)){
    setPending(null);setError(error.message==='CONFLICT'?'다른 창에서 시계를 바꿨습니다. 최신 상태를 확인한 뒤 다시 선택해 주세요.':'현재 시계와 권한으로 이 변경을 할 수 없습니다.')
   }else setError('시계 변경 결과를 확인하지 못했습니다. 같은 요청 다시 확인을 눌러 주세요.')
  }finally{setBusy(false)}
 }
 const now=state?new Date(businessTime()).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'로그인 후 확인'
 return <>
  <aside aria-label="가상 학교 시험 환경" style={{background:'#fff4d7',color:'#443313',padding:'12px 20px',borderBottom:'1px solid #dec98b',fontSize:14,display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
   <strong>가상 학교 · 운영 사이트와 분리</strong><span aria-live="off">{now} · {state?.running?'진행 중':'일시정지'}</span>
   <span>실제 1시간 = 가상 1년 · 전체 AI 상한 $9</span>
   {state?.canControl&&<>
    <button disabled={busy||!!pending} onClick={()=>send(state.running?'pause':'resume')}>{state.running?'시간 멈춤':'1년 시험 시작·계속'}</button>
    {!state.running&&<><label>다음 점검일 <input type="date" min={virtualDate} max={sandboxInputDate(Date.parse(state.endAt))} disabled={busy||!!pending} value={advance} onChange={e=>{setAdvance(e.target.value);setDateEdited(true)}}/></label><button disabled={busy||!!pending||!advance||advance<=virtualDate} onClick={()=>send('advance')}>선택 날짜로 진행</button></>}
    <span>AI 최대 예약 누적 ${(state.ai.reservedCeilingMicroUsd/1e6).toFixed(2)} / $9 · {state.ai.enabled?'허용':'유료 호출 잠김'}</span>
    {pending&&<button disabled={busy} onClick={()=>send(pending.p_action)}>같은 요청 다시 확인</button>}
   </>}
   <small>업무 날짜는 가상 시각입니다. 접수·감사·비용 기록은 실제 시각으로 남습니다. 점검일은 현재보다 뒤인 날짜를 선택해 주세요.</small>
   {error&&<p role="alert">{error}</p>}
  </aside>
  {!uid||state?children:<p role="status">가상 학교 시계를 확인하고 있습니다…</p>}
 </>
}
