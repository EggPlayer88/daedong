import {useEffect,useMemo,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {createHomeService,type HomeAction,type HomeOverview} from './overview'
import styles from './home-overview.css?inline'
interface Props{connection:SupabaseConnection;member:Membership;revision:number;onOpen:(item:HomeAction)=>void}
export function HomeOverviewPanel({connection,member,revision,onOpen}:Props){
 const service=useMemo(()=>createHomeService(connection),[connection]),[data,setData]=useState<HomeOverview>(),[failed,setFailed]=useState(false),[reload,setReload]=useState(0)
 useEffect(()=>{let live=true;setData(undefined);setFailed(false);void service.load(member.id).then(value=>{if(live)setData(value)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[service,member.id,revision,reload])
 return <section className="home-overview" aria-label="확인할 학교 업무"><style>{styles}</style><header><h2>확인할 일</h2>{data&&<span>서버 확인 {new Date(data.asOf).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}</span>}</header>
 {failed?<details><summary>수합·메시지·학생 후속 업무를 불러오지 못했습니다</summary><p>일정과 내 업무는 각각 확인할 수 있습니다. 다른 항목을 0건으로 판단하지 않습니다.</p><button onClick={()=>setReload(x=>x+1)}>추가 업무 다시 확인</button></details>:!data?<p role="status">내게 연결된 업무를 확인 중…</p>:<>
 <ul>{data.items.map(item=><li key={item.id}><button type="button" onClick={()=>onOpen(item)}><span>{item.priority==='urgent'&&<strong>확인 필요 · </strong>}{item.title}</span><small>{item.label}{item.dueDate&&` · ${item.dueDate}까지`}</small></button></li>)}</ul>
 {!data.items.length&&!data.unavailable.length&&<p>지금 확인할 추가 업무가 없습니다.</p>}
 {data.unavailable.length>0&&<p className="home-overview-note">일부 연결 항목은 확인 중입니다. 확인되지 않은 항목은 건수에 포함하지 않았습니다.</p>}
 <p className="home-overview-note">원본에서 제출·검토·처리를 마치면 반영됩니다. 홈에서 읽었다고 완료되지 않습니다.</p></>}
 </section>
}
