import {useEffect,useMemo,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {range,type Meal,type Snapshot} from './contracts'
import './neis.css'
import {message,useServer,Updated} from './shared'
export function NeisMeals({connection,member,date,heading='오늘의 급식'}:{connection:SupabaseConnection;member:Membership;date:string;heading?:string}){
 const server=useServer(connection),[data,setData]=useState<Snapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(date)
 const r=useMemo(()=>range('meals',selected),[selected])
 useEffect(()=>{let live=true;setBusy(true);setData(undefined);setError('')
  void server.read(member,r).then(async result=>{
   if(!live)return;setData(result)
   if(result.configured&&(!result.fetchedAt||Date.now()-Date.parse(result.fetchedAt)>86400000)){try{const next=await server.refresh(member,r);if(live)setData(next)}catch(e){if(live)setError(message(e))}}
  }).catch(e=>{if(live)setError(message(e))}).finally(()=>{if(live)setBusy(false)})
  return()=>{live=false}
 },[server,member,r])
 const meals=(data?.rows??[]) as Meal[]
 return <section className="neis-meals" aria-label="학교 급식" aria-busy={busy}><header><h3>{heading}</h3><label><span className="sr-only">급식 날짜</span><input type="date" aria-label="급식 날짜" value={selected} onChange={e=>{if(e.target.value)setSelected(e.target.value)}}/></label></header>
 {error&&<p role="status">{error}</p>}{data&&!data.configured?<p>급식 연결 준비 중</p>:!data&&busy?<p role="status">급식을 불러오는 중…</p>:<>{meals.filter(m=>m.date===selected).map(m=><article key={m.identity}><strong>{m.mealName}</strong><p className="neis-pre">{m.menu}</p><details><summary>영양·원산지</summary><p>{m.calories}</p><p className="neis-pre">{m.origins}</p><p className="neis-pre">{m.nutrition}</p><p>알레르기 표시는 나이스 원문입니다.</p></details></article>)}{data?.configured&&!meals.some(m=>m.date===selected)&&<p>{data.fetchedAt?'이 날짜에 등록된 급식이 없습니다.':'급식 자료를 기다리고 있습니다.'}</p>}</>}
 {data?.configured&&<Updated data={data}/>}</section>
}
