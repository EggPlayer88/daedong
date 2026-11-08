import {useEffect,useMemo,useRef,useState} from 'react'
import type {Membership} from '../contracts'
import type {NeisServer} from './server'
import {addDays,range,csvCell,type Lesson,type Snapshot} from './contracts'
import './neis.css'
import {message,Updated} from './shared'
export function NeisTimetable({server,member,date}:{server:NeisServer;member:Membership;date:string}){
 const[day,setDay]=useState(date),[data,setData]=useState<Snapshot>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[classKey,setClassKey]=useState(''),[attempt,setAttempt]=useState(0)
 const r=useMemo(()=>range('timetable',day),[day]),seq=useRef(0)
 useEffect(()=>{const n=++seq.current;setBusy(true);setError('');setData(undefined)
  void server.read(member,r).then(async value=>{if(n!==seq.current)return;setData(value);if(value.configured&&value.canManage&&(!value.fetchedAt||attempt>0)){const next=await server.refresh(member,r);if(n===seq.current)setData(next)}}).catch(e=>{if(n===seq.current)setError(message(e))}).finally(()=>{if(n===seq.current)setBusy(false)})
  return()=>{seq.current++}
 },[server,member,r,attempt])
 const lessons=(data?.rows??[]) as Lesson[],keys=[...new Set(lessons.map(l=>l.grade+'학년 '+l.className+'반 · '+l.session))].sort()
 const selected=keys.includes(classKey)?classKey:keys[0]??'',filtered=lessons.filter(l=>l.grade+'학년 '+l.className+'반 · '+l.session===selected)
 const weekend=filtered.some(l=>l.date>=addDays(r.from,5)&&l.date<=addDays(r.from,6)),days=Array.from({length:weekend?7:5},(_,i)=>addDays(r.from,i))
 const max=Math.max(7,...filtered.filter(l=>days.includes(l.date)).map(l=>l.period))
 function csv(){const values=[['날짜','학년','반','교시','학기','과목','주야','원본 적재일'],...lessons.map(l=>[l.date,l.grade,l.className,l.period,l.semester,l.subject,l.session,l.loadedOn])],content='\ufeff'+values.map(row=>row.map(csvCell).join(',')).join('\r\n');const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='나이스_학급시간표_'+r.from+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <div aria-busy={busy}><div className="neis-tools"><label>조회 날짜 <input aria-label="시간표 조회 날짜" type="date" value={day} disabled={busy} onChange={e=>{if(e.target.value)setDay(e.target.value)}}/></label><label>학급 <select aria-label="나이스 시간표 학급" value={selected} onChange={e=>setClassKey(e.target.value)}>{keys.map(k=><option key={k}>{k}</option>)}</select></label><button disabled={busy||!data?.canManage||!data?.configured} onClick={()=>setAttempt(x=>x+1)}>최신 시간표 확인</button><button disabled={!lessons.length} onClick={csv}>원본 CSV 내려받기</button></div>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">학급 시간표를 확인하는 중…</p>}{data&&!data.configured&&<p>나이스 학교 연결 준비 중입니다.</p>}{data?.configured&&<><Updated data={data}/><p className="neis-warning">나이스 공개 학급 시간표입니다. 담당 교사·수업 시각이 없어 교환·승인에 사용하는 확정 시간표와 구분됩니다.</p>{!lessons.length?<p>이 기간에 등록된 시간표가 없습니다.</p>:<div className="neis-table-scroll" tabIndex={0} aria-label="나이스 학급 시간표 가로 스크롤"><table className="neis-table"><caption>{selected} · {r.from} 주</caption><thead><tr><th>교시</th>{days.map(d=><th key={d}>{d.slice(5)} ({['일','월','화','수','목','금','토'][new Date(d+'T00:00:00Z').getUTCDay()]})</th>)}</tr></thead><tbody>{Array.from({length:max},(_,i)=>i+1).map(p=><tr key={p}><th>{p}</th>{days.map(d=><td key={d}>{filtered.filter(l=>l.period===p&&l.date===d).map(l=><span key={l.identity}>{l.subject}</span>)}</td>)}</tr>)}</tbody></table></div>}<details><summary>운영 시간표 연결에 필요한 정보</summary><p>시간표 준비에서 기존 수업·담당 교사·학급 연결과 교시별 시각을 확인해야 확정할 수 있습니다. 교과 이름만으로 교사를 자동 배정하지 않습니다.</p></details></>}</div>
}
