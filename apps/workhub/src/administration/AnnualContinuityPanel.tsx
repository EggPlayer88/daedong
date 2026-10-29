import {useEffect,useMemo,useRef,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {createAnnualService,type AnnualReadiness} from './annual-continuity'
import {ServiceError} from '../services/scoped-rpc'
export function AnnualContinuityPanel({connection,member}:{connection:SupabaseConnection;member:Membership}){
 const service=useMemo(()=>createAnnualService(connection),[connection])
 const[from,setFrom]=useState(''),[until,setUntil]=useState(''),[result,setResult]=useState<AnnualReadiness>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const generation=useRef(0),running=useRef(false)
 useEffect(()=>()=>{generation.current++},[service,member.id])
 async function inspect(){if(running.current)return;running.current=true;const token=++generation.current;setBusy(true);setError('');setResult(undefined);try{const value=await service.read(member.id,from,until);if(token===generation.current)setResult(value)}catch(e){if(token===generation.current)setError(e instanceof ServiceError&&e.code==='QUERY_FAILED'?'학년도 사전 점검 연결을 준비 중이거나 조회가 지연되었습니다. 기존 인계와 학교 자료는 아래에서 계속 확인할 수 있습니다.':e instanceof Error?e.message:'점검하지 못했습니다.')}finally{running.current=false;if(token===generation.current)setBusy(false)}}
 const change=(set:(v:string)=>void,value:string)=>{set(value);setResult(undefined);setError('')}
 return <details className="transitions-review"><summary>다음 학년도 소속·관리자 공백 미리 확인</summary><p>재직 소속은 학년도마다 새로 만들지 않습니다. 퇴직·전출 종료일과 관리자 역할은 자동 연장하지 않으며, 학급·담당 배정은 새 학년도에서 따로 확인합니다.</p><form onSubmit={e=>{e.preventDefault();void inspect()}}><fieldset disabled={busy}><label>점검 시작일<input type="date" required value={from} onChange={e=>change(setFrom,e.target.value)}/></label><label>점검 종료 경계일 · 이 날은 제외<input type="date" required value={until} onChange={e=>change(setUntil,e.target.value)}/></label><button>소속·관리자 기간 확인</button></fieldset></form>{busy&&<p role="status">서버의 소속·역할 기간을 대조하고 있습니다…</p>}{error&&<p role="alert">{error}</p>}{result&&<><p role="status">{result.adminGaps.length?'관리자가 없는 기간이 있습니다. 기존 종료일을 확인하고 다른 관리자의 정식 배정을 먼저 준비해 주세요.':'선택한 기간에 학교 관리자 공백이 없습니다.'}</p><ul>{result.adminGaps.map(g=><li key={g.from}>관리자 공백: {g.from}부터 {g.until} 전까지</li>)}</ul><p>기간에 걸친 공식 담당 {result.assignmentCount}건. 이 숫자는 새 학년도 배정 완료 여부를 뜻하지 않습니다.</p><ul>{result.members.filter(m=>m.status!=='active'||m.from>from||m.until!==null&&m.until<until).map(m=><li key={m.id}>{m.name} [{m.id}] · {m.status==='left'?'소속 종료':m.status==='suspended'?'이용 중지':'재직'} · {m.from} ~ {m.until?`${m.until} 전까지`:'종료일 없음'}</li>)}</ul><p>점검만 했으며 소속·종료일·담당·개인 기록은 변경하지 않았습니다. 마지막 관리자 보호는 소속·학교 관리자 역할을 변경할 때 적용됩니다. 로그인 계정 정지나 이미 정해진 기간 만료는 별도로 확인해야 합니다.</p></>}</details>
}
