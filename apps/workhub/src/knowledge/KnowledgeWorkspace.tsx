import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {useEditDraft} from '../app/edit-drafts'
import {recoveryScope,usePendingRequest} from '../app/pending-requests'
import {ServiceError} from '../services/scoped-rpc'
import {createKnowledgeService} from './adapter'
import {blankSource,knowledgeCommand,sourceEffective,sourceInput,sourceLabels,SOURCE_KINDS,type KnowledgeCommand,type KnowledgeList,type KnowledgeSource,type SourceInput} from './contracts'
import styles from './knowledge.css?inline'
import {KnowledgeImport,KnowledgeSourceFile} from './KnowledgeImport'
import {KnowledgeCitationPanel} from './KnowledgeCitationPanel'
import {knowledgeAssistantRequest,validKnowledgeOpenRequest,type KnowledgeAssistantRequest,type KnowledgeOpenRequest} from './assistant-links'
interface SourceAction{source:KnowledgeSource;kind:'publish'|'retire';reason:string}
interface Draft{base?:{id:string;version:number};recoveredAction?:Extract<KnowledgeCommand,{reason:string}>;input:SourceInput;original?:KnowledgeSource;action?:SourceAction;pending?:{command:KnowledgeCommand;key:string}}
export interface KnowledgeWorkspaceProps{connection:SupabaseConnection;member:Membership;date:string;revision?:number;onNavigationLockChange?:(locked:boolean)=>void;onAskAssistant?:(request:KnowledgeAssistantRequest)=>void|Promise<void>;openRequest?:KnowledgeOpenRequest;onReturnToSource?:()=>void}
type Props=KnowledgeWorkspaceProps
export function KnowledgeWorkspace(props:Props){return <ScopedKnowledgeWorkspace key={recoveryScope(props.member)} {...props}/> }
function ScopedKnowledgeWorkspace({connection,member,date,revision=0,onNavigationLockChange,onAskAssistant,openRequest,onReturnToSource}:Props){
 const service=useMemo(()=>createKnowledgeService(connection),[connection]),memory=useEditDraft<Draft>(member,'knowledge-editor')
 const recovery=usePendingRequest(member,'knowledge'),importRecovery=usePendingRequest(member,'knowledgeImport')
 const[importing,setImporting]=useState(Boolean(importRecovery.request)),[importLocked,setImportLocked]=useState(false)
 const onImportLock=useCallback((locked:boolean)=>setImportLocked(locked),[])
 const[draft,setDraftState]=useState<Draft|undefined>(()=>{if(memory.initial)return memory.initial;try{if(recovery.request){const command=knowledgeCommand(recovery.request.command);return {input:'input'in command?command.input:blankSource(),base:command.kind==='update'?{id:command.id,version:command.expectedVersion}:undefined,recoveredAction:'reason'in command?command:undefined,pending:{command,key:recovery.request.key}}}}catch{}return undefined}),[data,setData]=useState<KnowledgeList>(),[query,setQuery]=useState(''),[applied,setApplied]=useState(''),[cursor,setCursor]=useState<string|null>(null),[history,setHistory]=useState<(string|null)[]>([])
 const[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const[handing,setHanding]=useState<string>(),handoff=useRef(false)
 const epoch=useRef(0),writing=useRef(false),heading=useRef<HTMLHeadingElement>(null)
 const setDraft=(value:Draft|undefined)=>{memory.save(value);setDraftState(value)}
 const action=draft?.action
 const draftSourceId=draft?.original?.id??draft?.base?.id
 const draftAllowed=!!data&&!loading&&(!draftSourceId||data.items.some(x=>x.id===draftSourceId&&x.status==='draft'&&(data.canManage||x.authorMemberId===member.id)))&&(!action||(data.canManage&&data.items.some(x=>x.id===action.source.id)))
 const setAction=(value:SourceAction|undefined)=>setDraft(value?{input:blankSource(),action:value}:undefined)
 useEffect(()=>{return()=>{epoch.current++}},[service,member.id])
 useEffect(()=>{onNavigationLockChange?.(!!draft||busy||!!action||importLocked);return()=>onNavigationLockChange?.(false)},[draft,busy,action,importLocked,onNavigationLockChange])
 useEffect(()=>{let live=true;setLoading(true);setError('');setData(undefined);void service.list(member.id,applied,cursor).then(value=>{if(live)setData(value)}).catch(failure=>{if(live)setError(failure instanceof ServiceError?failure.message:'학교 자료를 불러오지 못했습니다.')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[service,member.id,applied,cursor,reload,revision])
 useEffect(()=>{if(draft)heading.current?.focus()},[!!draft])
 async function save(command:KnowledgeCommand,key:string=crypto.randomUUID()){
  if(writing.current||(!draft?.pending&&(!draftAllowed||draft?.recoveredAction)))return
  const snapshot={...draft,input:draft?.input??('input'in command?command.input:blankSource()),original:draft?.original,pending:{command,key}}
  recovery.put({command,key});writing.current=true;setBusy(true);setError('');setNotice('');setDraft(snapshot);const started=epoch.current
  try{const receipt=await service.mutate(member.id,command,key);if(started!==epoch.current)return;recovery.remove(key);setDraft(undefined);setNotice(`서버에 ${receipt.version}판으로 저장했습니다.`);setReload(value=>value+1)}
  catch(failure){if(started!==epoch.current)return;if(failure instanceof ServiceError&&['CANCELLED','FORBIDDEN','INACTIVE_MEMBERSHIP'].includes(failure.code))setData(undefined);setError(failure instanceof ServiceError?failure.message:'저장 결과를 확인하지 못했습니다. 원래 요청으로 다시 확인해 주세요.');if(failure instanceof ServiceError&&['INVALID_INPUT','CONFLICT','FORBIDDEN','NOT_FOUND','INACTIVE_MEMBERSHIP'].includes(failure.code)){recovery.remove(key);setDraft({...snapshot,pending:undefined})}}
  finally{if(started===epoch.current){writing.current=false;setBusy(false)}}
 }
 function edit(source?:KnowledgeSource){setAction(undefined);setError('');setNotice('');setDraft({input:source?{title:source.title,kind:source.kind,body:source.body,locator:source.locator,effectiveFrom:source.effectiveFrom,effectiveThrough:source.effectiveThrough}:{...blankSource(),effectiveFrom:date},original:source})}
 async function askAbout(source:KnowledgeSource){
  if(!onAskAssistant||draft||busy||loading||importLocked||handoff.current||!data?.items.some(item=>item.id===source.id&&item.version===source.version))return
  const started=epoch.current;handoff.current=true;setHanding(source.id);setError('')
  try{await onAskAssistant(knowledgeAssistantRequest(source,member,date))}
  catch{if(started===epoch.current)setError('이 자료를 비서에게 전달하지 못했습니다. 게시 상태와 적용 기간을 다시 확인해 주세요.')}
  finally{handoff.current=false;if(started===epoch.current)setHanding(undefined)}
 }
 if(importing)return <section className="knowledge"><style>{styles}</style><KnowledgeImport connection={connection} member={member} date={date} onNavigationLockChange={onImportLock} onClose={()=>setImporting(false)} onCreated={receipt=>{setImporting(false);setNotice(`원본을 연결한 자료 초안을 ${receipt.version}판으로 만들었습니다. 게시 검토는 별도로 진행해 주세요.`);setReload(value=>value+1)}}/></section>
 return <section className="knowledge" aria-label="학교 지식 자료"><style>{styles}</style>
 <header><div><h2>학교 자료</h2><p>규정과 업무 안내의 적용 기간·근거를 함께 확인하세요.</p></div><button type="button" disabled={busy||!!draft||!!action||!data} onClick={()=>edit()}>자료 초안 등록</button><button type="button" disabled={busy||!!draft||!!action} onClick={()=>setImporting(true)}>HWPX에서 자료 가져오기</button></header>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {openRequest&&(draft||busy||importLocked)?<section className="knowledge-citation" role="status"><p>{validKnowledgeOpenRequest(openRequest,member)?'비서 답변에서 선택한 인용 원문 확인을 기다리고 있습니다. 작성 중인 입력과 기존 요청 번호를 먼저 마무리해 주세요.':'현재 계정·학교와 맞지 않는 인용 요청은 열지 않습니다.'}</p></section>:openRequest&&<KnowledgeCitationPanel connection={connection} member={member} date={date} revision={revision+reload} request={openRequest} onAskAssistant={onAskAssistant} onReturnToSource={onReturnToSource}/>}
 {draft?.pending&&<section role="status"><p>이전 요청의 결과를 먼저 확인합니다. 같은 요청으로 재확인하며 새 저장을 만들지 않습니다.</p><button disabled={busy} onClick={()=>void save(draft.pending!.command,draft.pending!.key)}>원래 요청 결과 확인</button></section>}
 {draft&&!draftAllowed&&<section role="status"><p>현재 권한과 자료를 다시 확인할 때까지 편집 내용을 숨겼습니다. 입력과 이전 요청 번호는 이 탭에 보관됩니다.</p><button disabled={loading||busy} onClick={()=>setReload(value=>value+1)}>연결 다시 확인</button>{!draft.pending&&<button disabled={busy} onClick={()=>setDraft(undefined)}>작성 취소</button>}</section>}
 {draft?.recoveredAction&&!draft.pending&&draftAllowed&&<section role="status"><p>이전 변경 요청은 처리되지 않았습니다. 보관한 사유: {draft.recoveredAction.reason}</p><button onClick={()=>setDraft(undefined)}>최신 자료에서 다시 검토</button></section>}
 {draft&&draftAllowed&&!action&&!draft.recoveredAction&&<form aria-label="학교 자료 작성" onSubmit={event=>{event.preventDefault();if(busy||draft.pending||!draftAllowed)return;try{const input=sourceInput(draft.input);const base=draft.original??draft.base;void save(base?{kind:'update',id:base.id,expectedVersion:base.version,input}:{kind:'create',input})}catch{setError('제목·본문·근거 위치와 적용 기간을 확인해 주세요.')}}}>
 <h3 ref={heading} tabIndex={-1}>{draft.original||draft.base?'자료 수정':'자료 초안'}</h3><fieldset disabled={busy||!!draft.pending}>
 <label>제목<input required maxLength={200} value={draft.input.title} onChange={e=>setDraft({...draft,input:{...draft.input,title:e.target.value}})}/></label>
 <label>종류<select aria-label="종류" value={draft.input.kind} onChange={e=>setDraft({...draft,input:{...draft.input,kind:e.target.value as SourceInput['kind']}})}>{SOURCE_KINDS.map(kind=><option key={kind} value={kind}>{sourceLabels[kind]}</option>)}</select></label>
 <label>근거 위치<input required maxLength={500} placeholder="예: 학교 규정 제3조, 연간 계획 12쪽" value={draft.input.locator} onChange={e=>setDraft({...draft,input:{...draft.input,locator:e.target.value}})}/></label>
 <label>적용 시작일<input required type="date" value={draft.input.effectiveFrom} onChange={e=>setDraft({...draft,input:{...draft.input,effectiveFrom:e.target.value}})}/></label>
 <label>적용 마지막 날 · 무기한이면 비움<input type="date" min={draft.input.effectiveFrom} value={draft.input.effectiveThrough} onChange={e=>setDraft({...draft,input:{...draft.input,effectiveThrough:e.target.value}})}/></label>
 <label>확인한 원문<textarea aria-label="확인한 원문" required maxLength={100000} value={draft.input.body} onChange={e=>setDraft({...draft,input:{...draft.input,body:e.target.value}})}/></label>
 <p className="knowledge-muted">초안을 저장한 뒤 담당자의 게시 확인을 거쳐 학교 자료로 사용합니다. 수정 전 판과 근거는 서버 이력에 남습니다.</p>
 </fieldset><div className="knowledge-actions"><button disabled={busy||!!draft.pending}>초안 저장</button><button type="button" disabled={busy||!!draft.pending} onClick={()=>{setDraft(undefined);setError('')}}>작성 취소</button></div></form>}
 {action&&draftAllowed&&<form aria-label="자료 게시 상태 변경" onSubmit={event=>{event.preventDefault();if(busy||draft?.pending||!draftAllowed)return;void save({kind:action.kind,id:action.source.id,expectedVersion:action.source.version,reason:action.reason})}}><h3>{action.source.title} · {action.kind==='publish'?'게시 확인':'게시 종료'}</h3><p>확인한 {action.source.version}판에 적용합니다. 최신 판이 다르면 변경을 멈춥니다.</p><label>확인 근거 또는 사유<textarea aria-label="확인 근거 또는 사유" required maxLength={1000} disabled={busy||!!draft?.pending} value={action.reason} onChange={e=>setAction({...action,reason:e.target.value})}/></label><div className="knowledge-actions"><button disabled={busy||!!draft?.pending}>확인한 변경 적용</button><button type="button" disabled={busy||!!draft?.pending} onClick={()=>setAction(undefined)}>취소</button></div></form>}
 {!draft&&!action&&<><form role="search" onSubmit={event=>{event.preventDefault();setApplied(query.trim());setCursor(null);setHistory([])}}><label>학교 자료 검색<input type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label><button>검색</button></form>
 {loading?<p role="status">학교 자료를 불러오는 중…</p>:data?<><div className="knowledge-list">{data.items.map(source=><article key={source.id}><header><div><h3>{source.title}</h3><p className="knowledge-muted">{sourceLabels[source.kind]} · {source.status==='draft'?'초안':source.status==='retired'?'게시 종료':sourceEffective(source,date)?'현재 적용':'적용 기간 밖'} · {source.version}판</p></div></header><p>{source.locator} · {source.effectiveFrom}~{source.effectiveThrough||'종료일 없음'}</p><details><summary>원문 확인</summary><div className="knowledge-body">{source.body}</div></details><KnowledgeSourceFile key={`${source.id}:${source.version}`} connection={connection} member={member} sourceId={source.id} sourceVersion={source.version}/><div className="knowledge-actions">{onAskAssistant&&<button type="button" disabled={!!handing||!sourceEffective(source,date)} onClick={()=>void askAbout(source)}>{handing===source.id?'자료 전달 중…':'이 자료로 질문'}</button>}{(data.canManage||source.authorMemberId===member.id)&&source.status==='draft'&&<button onClick={()=>edit(source)}>초안 수정</button>}{data.canManage&&source.status!=='retired'&&<button onClick={()=>setAction({source,kind:source.status==='draft'?'publish':'retire',reason:''})}>{source.status==='draft'?'게시 검토':'게시 종료'}</button>}</div></article>)}{!data.items.length&&<p>검색 조건에 맞는 학교 자료가 없습니다.</p>}</div><nav aria-label="학교 자료 페이지"><button disabled={!history.length} onClick={()=>{setCursor(history.at(-1)!);setHistory(history.slice(0,-1))}}>이전</button><span>{history.length+1}쪽</span><button disabled={!data.nextCursor} onClick={()=>{setHistory([...history,cursor]);setCursor(data.nextCursor)}}>다음</button></nav></>:<button onClick={()=>setReload(value=>value+1)}>연결 다시 확인</button>}</>}
 </section>
}
