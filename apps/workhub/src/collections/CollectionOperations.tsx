import { useEffect,useRef,useState } from 'react'
import type {Membership} from '../contracts'
import {useEditDraft} from '../app/edit-drafts'
import {recoveryScope,usePendingRequest} from '../app/pending-requests'
import {ServiceError} from '../services/scoped-rpc'
import {operation,type CollectionOperation,type CollectionOperationsServer,type CollectionOperationsState} from './operations'
interface Draft{baseVersion:number;kind:CollectionOperation['kind'];reason:string;dueDate:string;selected:string[];confirmed:boolean;pending?:{command:CollectionOperation;key:string}}
interface Props{server:CollectionOperationsServer;member:Membership;requestId:string;date:string;disabled:boolean;revision:number;onLock:(locked:boolean)=>void;onChanged:()=>void;onState?:(state:CollectionOperationsState)=>void}
const labels={close:'접수 마감',reopen:'접수 재개',extend:'기한 변경',archive:'보관함으로 이동',remind:'미제출·보완 대상 알림'}
export function CollectionOperations(props:Props){return <ScopedCollectionOperations key={recoveryScope(props.member)+props.requestId} {...props}/> }
function ScopedCollectionOperations({server,member,requestId,date,disabled,revision,onLock,onChanged,onState}:Props){
 const memory=useEditDraft<Draft>(member,'collection-operations:'+requestId),recovery=usePendingRequest(member,'collectionOps')
 const[draft,setState]=useState<Draft|undefined>(()=>{if(memory.initial)return memory.initial;try{if(recovery.request){const command=operation(recovery.request.command as CollectionOperation);if(command.requestId===requestId)return {baseVersion:command.expectedVersion,kind:command.kind,reason:command.reason,dueDate:'dueDate'in command?command.dueDate:'',selected:command.kind==='remind'?command.recipients.map(x=>x.unitId):[],confirmed:false,pending:{command,key:recovery.request.key}}}}catch{}return undefined}),[data,setData]=useState<CollectionOperationsState>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
 const alive=useRef(true),writing=useRef(false),latestDraft=useRef(draft),lastData=useRef<CollectionOperationsState>(),stateCallback=useRef(onState)
 latestDraft.current=draft;stateCallback.current=onState
 const setDraft=(value:Draft|undefined)=>{latestDraft.current=value;memory.save(value);setState(value)}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{onLock(!!draft||busy);return()=>onLock(false)},[draft,busy,onLock])
 useEffect(()=>{let live=true;setData(undefined);void server.get(member.id,requestId).then(value=>{if(live){const previous=lastData.current;lastData.current=value;const current=latestDraft.current;if(previous&&JSON.stringify(previous)!==JSON.stringify(value)&&current&&!current.pending)setDraft({...current,confirmed:false});setData(value);setError('');stateCallback.current?.(value)}}).catch(()=>{if(live)setError('운영 도구를 아직 연결하지 못했습니다. 기존 제출·다운로드 기능은 계속 사용할 수 있습니다.')});return()=>{live=false}},[server,member.id,requestId,revision,reload])
 async function save(command:CollectionOperation,key:string=crypto.randomUUID()){
  if(writing.current)return;writing.current=true;setBusy(true);setError('');setNotice('')
  const snapshot={...draft!,pending:{command,key}};setDraft(snapshot);recovery.put({command,key})
  try{await server.mutate(member.id,command,key);if(!alive.current)return;recovery.remove(key);setDraft(undefined);setNotice('확인한 운영 변경을 서버에 저장했습니다.');setReload(x=>x+1);onChanged()}
  catch(failure){if(!alive.current)return;setError(failure instanceof ServiceError?failure.message:'변경 결과를 확인하지 못했습니다.');if(failure instanceof ServiceError&&['INVALID_INPUT','CONFLICT','FORBIDDEN','NOT_FOUND','INACTIVE_MEMBERSHIP'].includes(failure.code)){recovery.remove(key);setDraft({...snapshot,pending:undefined,confirmed:false});if(failure.code!=='INVALID_INPUT')setReload(x=>x+1)}}
  finally{writing.current=false;if(alive.current)setBusy(false)}
 }
 const targets=data?.units.filter(unit=>unit.state==='missing'||unit.state==='changes_requested')??[]
 const options:CollectionOperation['kind'][]=data?.phase==='open'?['close','extend','remind']:data?.phase==='closed'?['reopen','archive']:['reopen']
 return <details className="cs-optional" open={draft||notice?true:undefined}><summary>수합 운영 · 마감과 대상 알림</summary>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!data&&<button disabled={disabled} onClick={()=>setReload(x=>x+1)}>운영 상태 다시 확인</button>}
 {data&&<><p>접수 상태: {data.phase==='open'?'진행 중':data.phase==='closed'?'마감':'보관'} · {data.dueDate}까지</p><p>전체 {data.totals.total} · 미제출 {data.totals.missing} · 제출 {data.totals.submitted} · 검토 완료 {data.totals.accepted} · 보완 {data.totals.changesRequested}</p></>}
 {data?.canManage&&!draft&&<div className="cs-actions">{options.map(kind=><button key={kind} disabled={disabled||kind==='remind'&&!targets.length} onClick={()=>setDraft({baseVersion:data.version,kind,reason:'',dueDate:data.dueDate,selected:[],confirmed:false})}>{labels[kind]}</button>)}</div>}
 {draft&&<form aria-label="수합 운영 변경" onSubmit={event=>{event.preventDefault();if(disabled||busy||draft.pending||!data?.canManage||!options.includes(draft.kind)||!draft.confirmed||data.version!==draft.baseVersion)return;const common={requestId,expectedVersion:draft.baseVersion,reason:draft.reason};const command:CollectionOperation=draft.kind==='remind'?{...common,kind:'remind',recipients:targets.filter(x=>draft.selected.includes(x.id)).map(x=>({unitId:x.id,memberId:x.responsibleMemberId,expectedVersion:x.version}))}:draft.kind==='extend'||draft.kind==='reopen'?{...common,kind:draft.kind,dueDate:draft.dueDate}:{...common,kind:draft.kind};void save(command)}}>
 <h4>{labels[draft.kind]}</h4><p>확인한 운영 판: {draft.baseVersion}</p>{data&&!options.includes(draft.kind)&&!draft.pending&&<p role="alert">현재 접수 상태에서는 이 변경을 적용할 수 없습니다. 취소한 뒤 가능한 작업을 다시 선택해 주세요.</p>}{data && data.version !== draft.baseVersion && !draft.pending && <section role="alert"><p>다른 곳에서 운영 상태가 변경되었습니다. 현재 상태 {data.phase}, 기한 {data.dueDate}, {data.version}판과 대조한 뒤 다시 확인하세요.</p><button type="button" onClick={()=>setDraft({...draft,baseVersion:data.version,selected:[],confirmed:false})}>최신 상태를 기준으로 다시 검토</button></section>}<fieldset disabled={busy||!!draft.pending||!data?.canManage||!options.includes(draft.kind)}><label>변경 사유 또는 알림 내용<textarea aria-label="변경 사유 또는 알림 내용" required maxLength={1000} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value,confirmed:false})}/></label>
 {(draft.kind==='extend'||draft.kind==='reopen')&&<label>새 접수 기한<input aria-label="새 접수 기한" type="date" required min={date} value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value,confirmed:false})}/></label>}
 {draft.kind==='remind'&&<><p>선택한 제출 단위의 책임 교사에게 사이트 알림을 보냅니다. 읽음과 제출 완료는 별개입니다.</p>{targets.map(unit=><label key={unit.id}><input type="checkbox" checked={draft.selected.includes(unit.id)} onChange={e=>setDraft({...draft,confirmed:false,selected:e.target.checked?[...draft.selected,unit.id]:draft.selected.filter(id=>id!==unit.id)})}/>{unit.label} · {unit.state==='missing'?'미제출':'보완 필요'}</label>)}</>}
 <p>마감·보관은 제출 자료를 삭제하지 않습니다. 변경된 판 또는 이미 제출된 알림 대상은 서버에서 다시 확인합니다.</p><label><input type="checkbox" checked={draft.confirmed} onChange={e=>setDraft({...draft,confirmed:e.target.checked})}/>변경 내용과 대상을 확인했습니다</label></fieldset>
 <div className="cs-actions"><button disabled={disabled||busy||!!draft.pending||!data?.canManage||!options.includes(draft.kind)||data.version!==draft.baseVersion||!draft.confirmed||!draft.reason.trim()||draft.kind==='remind'&&!draft.selected.length}>확인한 운영 변경 적용</button><button type="button" disabled={busy||!!draft.pending} onClick={()=>setDraft(undefined)}>취소</button></div>
 {draft.pending&&<button type="button" disabled={busy} onClick={()=>void save(draft.pending!.command,draft.pending!.key)}>원래 운영 요청 결과 확인</button>}
 </form>}
 </details>
}
