import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { recoveryScope } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import { createKnowledgeService } from './adapter'
import type { KnowledgeHistory, KnowledgeHistoryItem } from './contracts'
import type { KnowledgeAssistantRequest } from './assistant-links'
import { KnowledgeCitationPanel } from './KnowledgeCitationPanel'

interface Props {
 connection:SupabaseConnection;member:Membership;date:string;revision:number;sourceId:string;title:string
 onClose:()=>void;onAskAssistant?:(request:KnowledgeAssistantRequest)=>void|Promise<void>
}
export function KnowledgeHistoryPanel(props:Props) {
 return <HistoryScope key={`${recoveryScope(props.member)}:${props.sourceId}`} {...props}/>
}
function HistoryScope({connection,member,date,revision,sourceId,title,onClose,onAskAssistant}:Props) {
 const service=useMemo(()=>createKnowledgeService(connection),[connection])
 const [before,setBefore]=useState<number|null>(null),[pages,setPages]=useState<(number|null)[]>([]),[reload,setReload]=useState(0),[selected,setSelected]=useState<KnowledgeHistoryItem>()
 const key=useMemo(()=>({}),[service,member,date,revision,sourceId,before,reload])
 const [read,setRead]=useState<{key:object;data?:KnowledgeHistory;error?:string}>()
 const current=read?.key===key?read:undefined
 useEffect(()=>{
  let live=true;setSelected(undefined)
  if(!activeAt(member,date)){setRead({key,error:'현재 학교 소속을 확인한 뒤 이전 판을 열어 주세요.'});return}
  void service.history(member.id,sourceId,before).then(data=>{if(live)setRead({key,data})}).catch(failure=>{if(live)setRead({key,error:failure instanceof ServiceError?failure.message:'이전 판 목록을 확인하지 못했습니다.'})})
  return()=>{live=false}
 },[key])
 return <section className="knowledge-citation" aria-label="학교 자료 이전 판">
  <header><h3>{title} · 이전 판</h3><button type="button" onClick={onClose}>이전 판 닫기</button></header>
  <p className="knowledge-muted">열람 권한이 있는 판만 최신순으로 표시합니다. 제목·본문·적용 기간은 각 판에 기록된 값입니다.</p>
  {!current?<p role="status">이전 판을 불러오는 중…</p>:current.error?<><p role="alert">{current.error}</p><button type="button" onClick={()=>setReload(x=>x+1)}>이전 판 다시 확인</button></>:current.data?<>
   <ul className="knowledge-history-list">{current.data.items.map(item=><li key={item.version}><button type="button" aria-pressed={selected?.version===item.version} onClick={()=>setSelected(item)}>{item.version}판 · {item.title}</button><span>{item.status==='draft'?'초안':item.status==='retired'?'게시 종료':'게시'}{item.isCurrent?' · 최신 판':''} · {item.recordedAt}</span></li>)}</ul>
   {!current.data.items.length&&<p>열람할 수 있는 이전 판이 없습니다.</p>}
   <nav aria-label="자료 판 이력 페이지"><button type="button" disabled={!pages.length} onClick={()=>{setBefore(pages.at(-1)!);setPages(pages.slice(0,-1))}}>앞선 판 목록</button><span>{pages.length+1}쪽</span><button type="button" disabled={current.data.nextBeforeVersion===null} onClick={()=>{setPages([...pages,before]);setBefore(current.data!.nextBeforeVersion)}}>더 오래된 판</button></nav>
   {selected&&<KnowledgeCitationPanel connection={connection} member={member} date={date} revision={revision+reload} context="history" request={{key:`history-${sourceId}-${selected.version}`,schoolId:member.schoolId,memberId:member.id,sourceId,sourceVersion:selected.version,title:selected.title,locator:'선택한 판의 기록'}} onAskAssistant={onAskAssistant}/>}
  </>:null}
 </section>
}
