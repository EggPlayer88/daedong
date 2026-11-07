import {useCallback,useEffect,useRef,useState} from 'react'
import type {CalendarEvent,Membership} from '../contracts'
import {usePendingRequest} from '../app/pending-requests'
import type {NeisServer} from './server'
import {academicYear,comparison,range,applyIssue,type Snapshot,type Schedule,type Selection,NeisError} from './contracts'
import './neis.css'
import {message,Updated} from './shared'
export function NeisCalendar({server,member,date,onLock,onUpdated}:{server:NeisServer;member:Membership;date:string;onLock?:(v:boolean)=>void;onUpdated?:()=>void}){
 const[year,setYear]=useState(academicYear(date)),[data,setData]=useState<Snapshot>(),[events,setEvents]=useState<CalendarEvent[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const[chosen,setChosen]=useState<Record<string,Selection>>({}),[confirmed,setConfirmed]=useState(false),[filter,setFilter]=useState('pending'),[page,setPage]=useState(0)
 const pending=usePendingRequest(member,'neis'),running=useRef(false),alive=useRef(true),generation=useRef(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[])
 const load=useCallback(async(refresh=false)=>{
  const token=++generation.current;setBusy(true);setError('')
  try{const r=range('schedule',date,year),[value,calendar]=await Promise.all([refresh?server.refresh(member,r):server.read(member,r),server.events(member)])
   if(alive.current&&token===generation.current){setData(value);setEvents(calendar)}
  }catch(e){if(alive.current&&token===generation.current)setError(message(e))}
  finally{if(alive.current&&token===generation.current)setBusy(false)}
 },[server,member,date,year])
 useEffect(()=>{setData(undefined);setEvents([]);void load()},[load])
 const locked=busy||!!pending.request||Object.keys(chosen).length>0
 useEffect(()=>{onLock?.(locked);return()=>onLock?.(false)},[onLock,locked])
 const rows=(data?.rows??[]) as Schedule[]
 const visible=rows.filter(s=>filter==='all'||filter==='pending'&&!['same','ignored'].includes(comparison(s).state)||filter==='missing'&&!s.present)
 const labels:Record<string,string>={new:'새 일정',changed:'변경 있음',same:'반영됨',missing:'원본에서 빠짐',ignored:'이번 변경 보류',unavailable:'기존 일정 확인 필요'}
 function select(s:Schedule,patch:Partial<Selection>={}){
  setConfirmed(false);setChosen(old=>({...old,[s.id]:{...(old[s.id]??{id:s.id,version:s.version,decision:'apply',eventId:s.eventId,eventVersion:s.current?.version??null,replaces:null,overwrite:false}),...patch}}))
 }
 async function close(){
  const original=pending.request;if(!original||running.current)return
  running.current=true;setBusy(true);setError('')
  try{const result=await server.close(member,original.command as Selection[],original.key);if(!alive.current)return;pending.remove(original.key);setChosen({});setConfirmed(false);setNotice(result.outcome==='applied'?'이미 반영된 요청입니다.':'이 요청을 닫았습니다. 늦게 도착한 원 요청도 반영되지 않습니다.');onUpdated?.();await load()}
  catch(e){if(alive.current)setError(message(e))}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 async function apply(recover=false){
  if(running.current)return
  const original=recover?pending.request:undefined
  if(recover&&!original)return
  const command=original?original.command as Selection[]:Object.values(chosen)
  if(!command.length||command.length>50||!recover&&!confirmed)return
  const key=original?.key??crypto.randomUUID()
  running.current=true;setBusy(true);setError('');setNotice('');pending.put({key,command})
  try{
   const result=await server.apply(member,command,key)
   if(!alive.current)return
   pending.remove(key);setChosen({});setConfirmed(false);setNotice(result.items.filter(x=>x.decision==='applied').length+'건 반영 · '+result.items.filter(x=>x.decision==='ignored').length+'건 보류')
   onUpdated?.();await load()
  }catch(e){if(alive.current){setError(message(e));if(!recover&&e instanceof NeisError&&['CONFLICT','INVALID_INPUT','FORBIDDEN','INACTIVE_MEMBERSHIP','IDEMPOTENCY_CONFLICT','NOT_READY'].includes(e.code))pending.remove(key)}}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 return <div aria-busy={busy}>
 <div className="neis-tools"><label>학년도 <input type="number" min={2020} max={2100} value={year} disabled={locked} onChange={e=>{const y=Number(e.target.value);if(y>=2020&&y<=2100){setYear(y);setPage(0)}}}/></label>
 <button disabled={locked} onClick={()=>load(true)}>나이스 최신 자료 가져오기</button><button disabled={locked} onClick={()=>load()}>비교 다시 확인</button></div>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {pending.request&&<div className="neis-recovery"><p>반영 결과를 확인할 요청이 있습니다. 내용과 요청 번호는 보존했습니다.</p><button disabled={busy} onClick={()=>apply(true)}>같은 요청의 결과 확인</button><button disabled={busy} onClick={close}>이 요청 닫기</button></div>}
 {data&&!data.configured&&<p role="status">학교 연결 등록 후 학사일정을 가져올 수 있습니다.</p>}
 {data?.configured&&<><Updated data={data}/>{!data.canManage?<p>일정 관리 권한이 필요합니다.</p>:<>
 <div className="neis-tools"><label>보기 <select value={filter} disabled={busy||!!pending.request} onChange={e=>{setFilter(e.target.value);setPage(0)}}><option value="pending">확인할 변경</option><option value="all">전체</option><option value="missing">원본에서 빠진 일정</option></select></label><span>{visible.length}건 · 선택 {Object.keys(chosen).length}/50건</span>
 <button disabled={busy||!!pending.request||!Object.keys(chosen).length} onClick={()=>{setChosen({});setConfirmed(false)}}>선택 비우기</button></div>
 {!visible.length&&<p>확인할 변경이 없습니다.</p>}
 <div className="neis-schedules">{visible.slice(page*20,page*20+20).map(s=>{
  const selection=chosen[s.id],target=selection?.eventId?events.find(e=>e.id===selection.eventId)??null:s.current
  const issue=applyIssue(s.data,member)
  const previous=selection?.replaces?rows.find(x=>x.id===selection.replaces):undefined,diff=comparison(s,target,previous?.baseline??s.baseline)
  return <article key={s.id} className="neis-schedule"><header><label><input type="checkbox" checked={!!selection} disabled={busy||!!pending.request||!selection&&Object.keys(chosen).length>=50||diff.state==='same'||diff.state==='unavailable'} onChange={e=>{if(e.target.checked)select(s,{decision:s.present&&!issue?'apply':'ignore'});else{setChosen(old=>{const next={...old};delete next[s.id];return next});setConfirmed(false)}}}/><strong>{s.data.title}</strong></label><span className="neis-badge">{labels[comparison(s).state]}</span></header>
  <p>{s.data.date} · {s.data.grades.length?s.data.grades.join('·')+'학년':'학년 미지정'} · {s.data.dayKind}</p>
  {issue&&<p className="neis-warning">{issue} 원문을 줄이지 않고 보존합니다. 이번 변경을 보류한 뒤 일정 화면에서 따로 작성해 주세요.</p>}
  {!s.present&&<p>기존 일정은 유지됩니다. 삭제·휴업 처리는 별도로 확인하세요.</p>}
  <details open={!!selection}><summary>원본·기존 일정 비교</summary>
   <div className="neis-comparison"><div><h4>나이스 원본</h4><p>{s.data.title} · {s.data.date}</p><p className="neis-pre">{s.data.content||'추가 내용 없음'}</p></div><div><h4>사이트 일정</h4>{target?<><p>{target.title} · {target.startDate} ~ {target.endDate}</p><p className="neis-pre">{target.description||'추가 내용 없음'}</p><p>{target.allDay?'종일':target.startTime+' ~ '+target.endTime} · {target.location||'장소 미지정'} · {target.visibility==='school'?'학교 전체':target.visibility==='private'?'개인':'선택 대상'}</p></>:<p>연결된 일정 없음</p>}</div></div>
   {selection&&<fieldset disabled={busy||!!pending.request}><legend>이 변경의 처리</legend><select aria-label={s.data.title+' 처리'} value={selection.decision} onChange={e=>select(s,{decision:e.target.value as 'apply'|'ignore'})}><option value="apply" disabled={!s.present||!!issue}>일정에 반영</option><option value="ignore">이번 변경 보류</option></select>
    {selection.decision==='apply'&&!s.eventId&&<label>연결할 기존 일정 <select aria-label={s.data.title+' 기존 일정'} value={selection.eventId??''} onChange={e=>{const t=events.find(x=>x.id===e.target.value),old=rows.find(x=>x.eventId===t?.id);select(s,{eventId:t?.id??null,eventVersion:t?.version??null,replaces:old?.id??null,overwrite:false})}}><option value="">새 학교 일정으로 등록</option>{events.filter(e=>e.startDate>=year+'-03-01'&&e.startDate<(year+1)+'-03-01').map(e=>{const linked=rows.find(x=>x.eventId===e.id);return<option key={e.id} value={e.id} disabled={!!linked?.present}>{e.startDate} · {e.title}{linked?.present?' (이미 연결됨)':''}</option>})}</select></label>}
    {selection.decision==='apply'&&diff.conflicts.length>0&&<label className="neis-warning"><input type="checkbox" checked={selection.overwrite} onChange={e=>select(s,{overwrite:e.target.checked})}/>충돌한 제목·설명·날짜를 나이스 값으로 바꾸는 것을 확인했습니다.</label>}
    {selection.decision==='apply'&&<p className="neis-meta">{target?'기존 시간·장소·공개 범위·대상은 유지됩니다.':'종일 · 학교 전체 일정으로 등록됩니다.'} 수업 취소·이동은 이 작업에 포함되지 않습니다.</p>}
   </fieldset>}
  </details></article>
 })}
 </div><div className="neis-tools"><button disabled={page===0||busy||!!pending.request} onClick={()=>setPage(p=>p-1)}>이전</button><span>{Math.min(page+1,Math.max(1,Math.ceil(visible.length/20)))} / {Math.max(1,Math.ceil(visible.length/20))}</span><button disabled={(page+1)*20>=visible.length||busy||!!pending.request} onClick={()=>setPage(p=>p+1)}>다음</button></div>
 {Object.keys(chosen).length>0&&<div className="neis-confirm"><label><input type="checkbox" checked={confirmed} disabled={busy||!!pending.request} onChange={e=>setConfirmed(e.target.checked)}/>선택한 변경과 공개 범위를 확인했습니다.</label><button className="primary" disabled={!confirmed||busy||!!pending.request||Object.values(chosen).some(s=>{const row=rows.find(r=>r.id===s.id);if(!row)return true;const previous=rows.find(x=>x.id===s.replaces);return s.decision==='apply'&&comparison(row,events.find(x=>x.id===s.eventId)??null,previous?.baseline??row.baseline).conflicts.length>0&&!s.overwrite})} onClick={()=>apply()}>선택 {Object.keys(chosen).length}건 반영·보류</button></div>}
 </>}</>}
 </div>
}
