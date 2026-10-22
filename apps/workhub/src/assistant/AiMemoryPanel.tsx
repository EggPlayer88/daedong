import {useEffect,useId,useMemo,useRef,useState} from 'react'
import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {useEditDraft} from '../app/edit-drafts'
import {recoveryScope,usePendingRequest} from '../app/pending-requests'
import {activeAt} from '../domain'
import {canonical,ServiceError} from '../services/scoped-rpc'
import {MEMORY_LIMITS,memoryCommand,memoryUsable,type MemoryCommand,type MemoryEntry,type MemoryList,type MemoryResult,type MemoryService} from './memory-contracts'
import {createAiMemoryService} from './memory-server'

export interface AiMemoryPanelProps {
 connection:SupabaseConnection;member:Membership;date:string;revision?:number;blocked?:boolean;canUse?:boolean
 onUse:(items:MemoryEntry[])=>void;onLockChange?:(locked:boolean)=>void;service?:MemoryService
}
type Reference={id:string;version:number}
type Editor={id:string;base:MemoryEntry|null;title:string;body:string;category:MemoryEntry['category'];enabled:boolean;expiresOn:string}
type Draft={editor:Editor|null;selected:Reference[];open:boolean}
type Pending={command:MemoryCommand;key:string;closeState?:'closing'}
const emptyEditor=():Editor=>({id:crypto.randomUUID(),base:null,title:'',body:'',category:'preference',enabled:true,expiresOn:''})
const edit=(row:MemoryEntry):Editor=>({id:row.id,base:row,title:row.title,body:row.body,category:row.category,enabled:row.enabled,expiresOn:row.expiresOn??''})
const fields=(row:Editor)=>({title:row.title,body:row.body,category:row.category,enabled:row.enabled,expiresOn:row.expiresOn||null})
const issue=(error:unknown)=>error instanceof ServiceError?error.message:'기억 저장소를 확인하지 못했습니다. 입력은 유지했습니다.'
const finalFailure=(error:unknown)=>error instanceof ServiceError&&['INVALID_INPUT','CONFLICT','IDEMPOTENCY_CONFLICT','NOT_FOUND','NOT_READY'].includes(error.code)

export function AiMemoryPanel(props:AiMemoryPanelProps){return <MemoryScope key={recoveryScope(props.member)} {...props}/>}
function MemoryScope(props:AiMemoryPanelProps){
 const {member,date,revision=0}=props,uid=useId()
 const service=useMemo(()=>props.service??createAiMemoryService(props.connection),[props.service,props.connection])
 const draft=useEditDraft<Draft>(member,'ai-memory-editor'),recovery=usePendingRequest(member,'assistantMemory')
 const [editor,setEditor]=useState<Editor|null>(draft.initial?.editor??null),[selected,setSelected]=useState<Reference[]>(draft.initial?.selected??[])
 const [open,setOpen]=useState(Boolean(draft.initial?.open||recovery.request)),[listing,setListing]=useState<MemoryList>(),[filter,setFilter]=useState('')
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [confirmed,setConfirmed]=useState(''),[useConfirmed,setUseConfirmed]=useState(''),[deleting,setDeleting]=useState<MemoryEntry|null>(null),[deleteConfirmed,setDeleteConfirmed]=useState(false),[closeReview,setCloseReview]=useState(false)
 const [missing,setMissing]=useState(false),[discard,setDiscard]=useState(false),life=useRef(0),flight=useRef(false),latest=useRef(props);latest.current=props
 const enabled=activeAt(member,date),pending=recovery.request as Pending|undefined
 const dirty=Boolean(editor&&(editor.base?canonical(fields(editor))!==canonical(fields(edit(editor.base))):editor.title||editor.body||editor.expiresOn))
 const locked=Boolean(dirty||busy||pending||deleting),unavailable=Boolean(props.blocked||!enabled),controls=unavailable||busy||loading||Boolean(pending),browsingBlocked=controls||Boolean(deleting)
 const currentRows=listing?.items??[],formKey=canonical(editor),selectionKey=canonical([selected,currentRows,listing?.today])
 const stale=Boolean(editor?.base&&listing&&!currentRows.some(row=>row.id===editor.id&&row.version===editor.base!.version))
 const canSave=Boolean(editor&&listing?.canWrite&&!stale&&!controls&&dirty)
 const selectedRows=currentRows.filter(row=>selected.some(ref=>ref.id===row.id&&ref.version===row.version))
 const validSelection=Boolean(listing&&selected.length&&selectedRows.length===selected.length&&selectedRows.every(row=>memoryUsable(row,listing.today)))
 const matches=currentRows.filter(row=>(row.title+' '+row.body).toLocaleLowerCase('ko-KR').includes(filter.toLocaleLowerCase('ko-KR')))
 useEffect(()=>{draft.save({editor,selected,open},dirty)},[editor,selected,open,dirty,draft])
 useEffect(()=>{props.onLockChange?.(locked);return()=>props.onLockChange?.(false)},[locked,props.onLockChange])
 useEffect(()=>()=>{life.current++;flight.current=false},[])
 useEffect(()=>{
  const epoch=++life.current;flight.current=false;setBusy(false);setConfirmed('');setUseConfirmed('');setDeleteConfirmed(false);setDeleting(null);setListing(undefined);setError('')
  if(!open||!enabled){setLoading(false);return}
  setLoading(true)
  void service.list(member.id).then(value=>{if(epoch===life.current){setListing(value)}}).catch(failure=>{if(epoch===life.current)setError(issue(failure))}).finally(()=>{if(epoch===life.current)setLoading(false)})
  return()=>{life.current++}
 },[service,member.id,enabled,date,revision,refresh,open])
 useEffect(()=>{if(props.blocked){setConfirmed('');setUseConfirmed('');setDeleteConfirmed(false)}},[props.blocked])
 function change(patch:Partial<Editor>){setEditor(value=>value?{...value,...patch}:value);setConfirmed('');setDiscard(false)}
 function clearEditor(){setEditor(null);setConfirmed('');setDiscard(false)}
 function receive(value:MemoryResult,original:Pending){
  if(value.state==='missing'){setMissing(true);setNotice('원래 요청의 접수 기록이 없습니다. 같은 내용으로 다시 보내거나 이 요청을 닫을 수 있습니다.');return}
  recovery.remove(original.key);setMissing(false);setCloseReview(false);setDeleting(null);setDeleteConfirmed(false);setSelected([]);setUseConfirmed('')
  if(value.state==='applied'){clearEditor();setNotice(value.kind==='delete'?'기억 목록에서 삭제했습니다. 이미 질문에 넣거나 보낸 내용은 별도로 남을 수 있습니다.':'저장 접수 결과를 확인했습니다. 현재 목록을 다시 읽습니다.')}
  else setNotice('요청 닫힘을 확인했습니다. 늦게 도착한 원래 명령은 반영되지 않습니다. 편집 입력은 유지했습니다.')
  setRefresh(value=>value+1)
 }
 async function execute(command:MemoryCommand,key:string,action:'mutate'|'recover'|'close'){
  if(unavailable||flight.current)return
  const original:Pending={command,key,...(action==='close'||pending?.closeState==='closing'?{closeState:'closing' as const}:{})}
  flight.current=true;setBusy(true);setError('');setNotice('');recovery.put(original);setMissing(false)
  const epoch=life.current,actual=original.closeState==='closing'?'close':action
  try{
   const result=await service[actual](member.id,command,key)
   if(epoch===life.current)receive(result,original)
  }catch(failure){
   if(epoch===life.current){
    // 복구 중 거절은 원래 요청의 부재를 증명하지 않는다. 닫힘/접수 확인까지 원번호를 보존한다.
    if(action==='mutate'&&actual!=='close'&&!pending&&finalFailure(failure)){
     recovery.remove(key)
     if(failure instanceof ServiceError&&failure.code==='CONFLICT')setRefresh(value=>value+1)
    }
    setError(issue(failure))
   }
  }finally{if(epoch===life.current){flight.current=false;setBusy(false)}}
 }
 function save(){
  if(!canSave||confirmed!==formKey||!editor)return
  try{const command=memoryCommand({kind:editor.base?'update':'create',id:editor.id,...(editor.base?{expectedVersion:editor.base.version}:{}),...fields(editor),confirmed:true});void execute(command,crypto.randomUUID(),'mutate')}catch(failure){setError(issue(failure))}
 }
 async function useSelected(){
  if(browsingBlocked||flight.current||editor||!validSelection||!props.canUse||useConfirmed!==selectionKey)return
  flight.current=true;setBusy(true);setError('');setNotice('');const epoch=life.current,refs=structuredClone(selected)
  try{
   const value=await service.select(member.id,refs)
   if(epoch!==life.current||latest.current.blocked||!latest.current.canUse)return
   props.onUse(value.items);setSelected([]);setUseConfirmed('');setNotice('선택한 기억을 질문 입력란에 넣었습니다. 내용을 확인한 뒤 AI에게 요청해 주세요.')
  }catch(failure){if(epoch===life.current)setError(issue(failure))}
  finally{if(epoch===life.current){flight.current=false;setBusy(false)}}
 }
 return <section className="assistant-memory" aria-label="나의 AI 기억">
  <button type="button" className="assistant-memory-toggle" aria-expanded={open} disabled={unavailable||busy||Boolean(pending)||Boolean(editor)||Boolean(deleting)} onClick={()=>setOpen(value=>!value)}>나의 AI 기억{listing?' · '+listing.items.length+'개':''}</button>
  {open&&<div className="assistant-memory-content">
   <p className="assistant-hint">현재 학교에서 나만 사용하는 선호·반복 업무 메모입니다. 직접 확인해 저장하며 대화에서 자동 수집하지 않습니다.</p>
   <p className="assistant-hint">선택한 기억은 이번 질문에 복사됩니다. 목록에서 삭제·중지해도 작성 중인 질문과 이미 보낸 대화는 지워지지 않습니다.</p>
   {!enabled&&<p role="status">현재 학교 소속을 확인해 주세요.</p>}
   {loading&&<p role="status">저장한 기억을 확인하고 있습니다.</p>}
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {listing&&!listing.canWrite&&<p role="status">새 기억 저장과 질문에 사용하기는 준비 중입니다. 기존 기억 조회와 삭제·요청 복구는 가능합니다.</p>}
   {!editor&&<div className="assistant-actions">
    <button type="button" disabled={browsingBlocked} onClick={()=>setRefresh(value=>value+1)}>기억 목록 새로고침</button>
    <button type="button" disabled={browsingBlocked||!listing?.canWrite||currentRows.length>=MEMORY_LIMITS.maxEntries} onClick={()=>{setEditor(emptyEditor());setError('');setNotice('');setSelected([])}}>새 기억 추가</button>
   </div>}
   {listing&&!editor&&<>
    <label htmlFor={uid+'-search'}>기억 찾기<input id={uid+'-search'} type="search" value={filter} disabled={controls} onChange={event=>setFilter(event.target.value)}/></label>
    <p className="assistant-hint">{currentRows.length} / {MEMORY_LIMITS.maxEntries}개 · {listing.today} 기준</p>
    {!currentRows.length&&<p>저장한 기억이 없습니다. 자주 쓰는 표현 방식이나 반복 업무 순서부터 추가해 보세요.</p>}
    {currentRows.length>0&&!matches.length&&<p>검색 조건에 맞는 기억이 없습니다.</p>}
    <ul className="assistant-memory-list">{matches.map(row=><li key={row.id}>
     <label className="assistant-memory-check"><input type="checkbox" aria-label={'기억 선택: '+row.title} checked={selected.some(ref=>ref.id===row.id&&ref.version===row.version)} disabled={browsingBlocked||!listing.canWrite||!memoryUsable(row,listing.today)||!selected.some(ref=>ref.id===row.id)&&selected.length>=MEMORY_LIMITS.maxSelected} onChange={event=>{setSelected(value=>event.target.checked?[...value.filter(ref=>ref.id!==row.id),{id:row.id,version:row.version}]:value.filter(ref=>ref.id!==row.id));setUseConfirmed('')}}/><strong>{row.title}</strong></label>
     <p className="assistant-hint">{row.category==='preference'?'업무 선호':'반복 업무'} · {!row.enabled?'일시중지':row.expiresOn&&row.expiresOn<listing.today?'기한 지남':'사용 가능'} · {row.expiresOn?'사용기한 '+row.expiresOn:'기한 미지정'} · v{row.version}</p>
     <details><summary>기억 내용 보기</summary><p className="assistant-text">{row.body}</p></details>
     <div className="assistant-actions"><button type="button" disabled={browsingBlocked||!listing.canWrite} onClick={()=>{setEditor(edit(row));setConfirmed('');setError('');setSelected([])}}>수정 · 중지 설정: {row.title}</button><button type="button" disabled={browsingBlocked} onClick={()=>{setDeleting(row);setDeleteConfirmed(false);setError('')}}>삭제: {row.title}</button></div>
    </li>)}</ul>
    {selected.length>0&&<div className="assistant-context"><h4>이번 질문에 넣을 기억 {selected.length}개</h4>
     {selectedRows.map(row=><div key={row.id}><strong>{row.title}</strong><p className="assistant-text">{row.body}</p></div>)}
     {!validSelection&&<p role="alert">선택한 기억이 바뀌었거나 중지·만료되었습니다. 목록에서 다시 확인해 주세요.</p>}
     <label className="assistant-memory-check"><input type="checkbox" checked={useConfirmed===selectionKey} disabled={browsingBlocked||!validSelection||!props.canUse} onChange={event=>setUseConfirmed(event.target.checked?selectionKey:'')}/>이 내용을 이번 질문에 넣겠습니다</label>
     <button type="button" disabled={browsingBlocked||!props.canUse||!listing.canWrite||!validSelection||useConfirmed!==selectionKey} onClick={()=>void useSelected()}>선택한 기억을 질문에 넣기</button>
     <button type="button" disabled={browsingBlocked} onClick={()=>{setSelected([]);setUseConfirmed('')}}>기억 선택 비우기</button>
     {!props.canUse&&<p className="assistant-hint">일반 업무 안내·개인 비서·문서 초안에서 사용할 수 있습니다. 현재 요청의 처리를 먼저 마무리해 주세요.</p>}
    </div>}
   </>}
   {editor&&<section className="assistant-memory-editor" aria-label="기억 편집">
    <button type="button" disabled={controls} onClick={()=>setRefresh(value=>value+1)}>편집 입력 유지하고 원본 다시 확인</button>
    <h3>{editor.base?'기억 수정':'새 기억'}</h3><p className="assistant-hint">학생 개인·상담·건강 정보나 비밀번호는 저장하지 마세요. 기억은 학교 규정이나 학생 기록의 근거가 아닙니다.</p>
    {stale&&<p role="alert">서버의 기억이 변경되거나 삭제되었습니다. 내 입력은 유지했습니다. 내용을 따로 확인한 뒤 편집을 닫고 최신 기억을 다시 열어 주세요.</p>}
    <label htmlFor={uid+'-title'}>기억 제목<input id={uid+'-title'} value={editor.title} maxLength={MEMORY_LIMITS.titleCharacters} disabled={controls} onChange={event=>change({title:event.target.value})}/></label>
    <label htmlFor={uid+'-body'}>기억 내용</label><textarea id={uid+'-body'} rows={4} value={editor.body} disabled={controls} onChange={event=>change({body:event.target.value})}/>
    <span className="assistant-hint">{Array.from(editor.body).length} / {MEMORY_LIMITS.bodyCharacters}자</span>
    <label htmlFor={uid+'-category'}>기억 종류<select id={uid+'-category'} value={editor.category} disabled={controls} onChange={event=>change({category:event.target.value as MemoryEntry['category']})}><option value="preference">업무 선호</option><option value="routine">반복 업무</option></select></label>
    <label htmlFor={uid+'-expires'}>사용기한 · 선택 사항<input id={uid+'-expires'} type="date" value={editor.expiresOn} disabled={controls} onChange={event=>change({expiresOn:event.target.value})}/></label>
    <p className="assistant-hint">기한이 지나면 질문에 새로 넣을 수 없습니다. 목록에서 확인·삭제할 수 있으며 자동 삭제하지 않습니다. 비우면 직접 중지·삭제할 때까지 보관합니다.</p>
    <label className="assistant-memory-check"><input type="checkbox" checked={editor.enabled} disabled={controls} onChange={event=>change({enabled:event.target.checked})}/>질문에 사용할 수 있도록 켜기</label>
    <label className="assistant-memory-check"><input type="checkbox" checked={confirmed===formKey} disabled={!canSave} onChange={event=>setConfirmed(event.target.checked?formKey:'')}/>내용과 보관 범위를 확인했습니다</label>
    <div className="assistant-actions"><button type="button" disabled={!canSave||confirmed!==formKey} onClick={save}>확인한 기억 저장</button><button type="button" disabled={controls} onClick={()=>dirty?setDiscard(true):clearEditor()}>기억 편집 닫기</button></div>
    {discard&&<div className="assistant-context"><p>이번 편집 내용을 버리고 닫습니다. 서버에 저장한 기억은 그대로입니다.</p><button type="button" disabled={controls} onClick={clearEditor}>편집 버리고 닫기</button><button type="button" disabled={controls} onClick={()=>setDiscard(false)}>계속 편집</button></div>}
   </section>}
   {deleting&&<section className="assistant-context" aria-label="기억 삭제 확인"><h3>{deleting.title} 삭제</h3><p>기억 목록에서 제목과 본문을 지웁니다. 이미 작성 중인 질문·보낸 대화·내려받은 파일은 별도로 남습니다.</p><label className="assistant-memory-check"><input type="checkbox" disabled={controls} checked={deleteConfirmed} onChange={event=>setDeleteConfirmed(event.target.checked)}/>기억 목록에서 삭제할 내용을 확인했습니다</label><button type="button" disabled={controls||!deleteConfirmed} onClick={()=>void execute(memoryCommand({kind:'delete',id:deleting.id,expectedVersion:deleting.version,confirmed:true}),crypto.randomUUID(),'mutate')}>확인한 기억 삭제</button><button type="button" disabled={controls} onClick={()=>setDeleting(null)}>삭제 취소</button></section>}
   {pending&&<section className="assistant-pending" aria-label="기억 요청 복구"><h3>기억 저장 결과 확인</h3><p>입력과 원래 요청 번호를 보관했습니다. 확인 전 새 저장은 하지 않습니다.</p><code>{pending.key}</code><div className="assistant-actions"><button type="button" disabled={unavailable||busy} onClick={()=>void execute(pending.command,pending.key,pending.closeState==='closing'?'close':'recover')}>{pending.closeState==='closing'?'기억 요청 닫힘 다시 확인':'같은 기억 요청 결과 확인'}</button>
    {missing&&pending.closeState!=='closing'&&<button type="button" disabled={unavailable||busy} onClick={()=>void execute(pending.command,pending.key,'mutate')}>같은 내용·번호로 다시 저장</button>}
    {pending.closeState!=='closing'&&<button type="button" disabled={unavailable||busy} onClick={()=>setCloseReview(true)}>이 기억 요청 닫기</button>}</div>
    {closeReview&&pending.closeState!=='closing'&&<div><p>이미 처리됐다면 원접수증을 확인하고, 아직 접수되지 않았다면 이 번호가 뒤늦게 저장되지 않도록 닫습니다.</p><button type="button" disabled={unavailable||busy} onClick={()=>void execute(pending.command,pending.key,'close')}>확인하고 기억 요청 닫기</button></div>}
   </section>}
  </div>}
 </section>
}
