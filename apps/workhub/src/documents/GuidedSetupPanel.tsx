import {useEffect,useId,useRef,useState} from 'react'
import type {Membership} from '../contracts'
import {useEditDraft} from '../app/edit-drafts'
import {canonical} from '../services/scoped-rpc'
import type {GuidedService} from './guided-adapter'
import {GUIDED_LIMITS,type Question,type TemplateDetail} from './guided-contracts'
import {applyGuidedCandidates,createGuidedCandidates,recommendGuidedMode,type GuidedCandidate} from './guided-suggestions'
import {createGuidedSetupOrigin,guidedSetupSuggestion,makeGuidedSetupAiRequest,parseGuidedSetupProposal,verifyGuidedSetupSource,type GuidedSetupAiOrigin,type GuidedSetupAiRequest,type GuidedSetupAiSuggestion} from './guided-setup-ai'

interface Props {
 member:Membership;revision:number;selected:TemplateDetail;questions:Question[];title:string;disabled:boolean;service:GuidedService
 origin?:GuidedSetupAiOrigin;suggestion?:GuidedSetupAiSuggestion
 onApply:(questions:Question[])=>void;onBusyChange:(busy:boolean)=>void
 onRequestAi?:(request:GuidedSetupAiRequest)=>void;onOpenFileCollections?:()=>void
}
type Draft={base:string;method:''|'guided'|'file';rows:GuidedCandidate[];chosen:string[];handled:string;aiReason:string}
const modes={guided:'질문형 수합 검토 가능',file:'파일형 수합 우선 검토',review:'원본 확인 후 방식 선택'}

export function GuidedSetupPanel(props:Props){
 const source=props.selected.template,inspection=source.inspection!,existing=source.mapping?.questions??[]
 const base=canonical([source,props.selected.response]),defaults=createGuidedCandidates(inspection,existing),report=recommendGuidedMode(inspection,existing)
 const memory=useEditDraft<Draft>(props.member,`guided-setup-proposals:${source.id}:${source.version}`),[initial]=useState(()=>memory.initial?.base===base?memory.initial:undefined)
 const[method,setMethod]=useState<Draft['method']>(initial?.method??''),[rows,setRows]=useState(initial?.rows??defaults),[chosen,setChosen]=useState<string[]>(initial?.chosen??[])
 const[handled,setHandled]=useState(initial?.handled??''),[aiReason,setAiReason]=useState(initial?.aiReason??''),[confirmed,setConfirmed]=useState(''),[sendConfirmed,setSendConfirmed]=useState('')
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const id=useId(),latest=useRef(props),generation=useRef(0),running=useRef(false);latest.current=props
 const fingerprint=canonical([base,rows,chosen,props.questions,props.title]),changed=canonical(rows)!==canonical(defaults)
 const selectedRows=rows.filter(row=>chosen.includes(row.anchorId))
 const locked=props.disabled||busy
 useEffect(()=>{memory.save({base,method,rows,chosen,handled,aiReason},changed||chosen.length>0)},[base,method,rows,chosen,handled,aiReason,changed,memory])
 useEffect(()=>()=>{generation.current++;props.onBusyChange(false)},[])
 useEffect(()=>{generation.current++;running.current=false;setBusy(false);props.onBusyChange(false);setConfirmed('');setSendConfirmed('')},[props.revision,props.disabled,base])
 useEffect(()=>{
  if(!props.suggestion||props.suggestion.requestId===handled||props.disabled)return
  const turn=++generation.current
  running.current=true;setBusy(true);props.onBusyChange(true);setError('')
  void(async()=>{
   const suggestion=guidedSetupSuggestion(props.suggestion,props.member)
   if(!props.origin||canonical(suggestion.origin)!==canonical(props.origin))throw Error('origin')
   verifyGuidedSetupSource(props.origin,props.selected,props.member)
   const fresh=await props.service.get(props.member.id,props.origin.templateId)
   verifyGuidedSetupSource(props.origin,fresh,props.member)
   if(turn!==generation.current||latest.current.disabled||latest.current.revision!==props.revision||canonical([latest.current.selected.template,latest.current.selected.response])!==base)return
   const proposal=parseGuidedSetupProposal(suggestion.body,props.origin)
   setRows(proposal.questions);setChosen([]);setMethod('guided');setAiReason(`${modes[proposal.mode]} · ${proposal.reason}`)
   setConfirmed('');setSendConfirmed('');setNotice('AI 제안을 받았습니다. 질문과 원본 위치를 확인하고 필요한 항목만 선택해 주세요.');setError('');setHandled(suggestion.requestId)
  })().catch(()=>{if(turn===generation.current){setError('돌아온 제안의 형식·원래 양식·선택 위치를 확인하지 못했습니다. 기존 질문은 그대로이며 제안을 반영하지 않습니다.');setHandled(props.suggestion!.requestId)}}).finally(()=>{if(turn===generation.current){running.current=false;setBusy(false);props.onBusyChange(false)}})
  return()=>{generation.current++;running.current=false;setBusy(false);props.onBusyChange(false)}
 },[props.suggestion,props.origin,props.selected,props.member,props.disabled,props.revision,handled])
 function reset(){setRows(defaults);setChosen([]);setAiReason('');setConfirmed('');setSendConfirmed('');setError('');setNotice('원본 기준 후보를 다시 표시했습니다.')}
 function change(anchorId:string,patch:Partial<GuidedCandidate>){setRows(value=>value.map(row=>row.anchorId===anchorId?{...row,...patch}:row));setConfirmed('');setSendConfirmed('')}
 async function checked(action:'apply'|'ai'){
  if(locked||running.current||!selectedRows.length||action==='apply'&&confirmed!==fingerprint||action==='ai'&&(sendConfirmed!==fingerprint||changed))return
  const turn=++generation.current;running.current=true;setBusy(true);props.onBusyChange(true);setError('');setNotice('')
  try{
   const original=defaults.filter(row=>chosen.includes(row.anchorId)),origin=createGuidedSetupOrigin(props.member,props.selected,original,`guided-setup-${crypto.randomUUID()}`)
   const fresh=await props.service.get(props.member.id,source.id)
   verifyGuidedSetupSource(origin,fresh,props.member)
   if(turn!==generation.current||latest.current.disabled||latest.current.revision!==props.revision||canonical([latest.current.selected.template,latest.current.selected.response])!==base||canonical(latest.current.questions)!==canonical(props.questions)||latest.current.title!==props.title)return
   if(action==='ai'){
    const request=makeGuidedSetupAiRequest(props.member,fresh,original,origin.id)
    props.onRequestAi?.(request)
   }else{
    const next=applyGuidedCandidates(inspection,props.questions,selectedRows)
    props.onApply(next);setChosen([]);setConfirmed('');setSendConfirmed('');setRows(defaults);setAiReason('')
    setNotice('선택한 질문을 편집 화면에 추가했습니다. 내용을 확인한 뒤 질문·위치 매핑 저장을 눌러 주세요.')
   }
  }catch{if(turn===generation.current)setError(action==='ai'?'원본 확인 또는 AI 전달 준비에 실패했습니다. 선택 범위·글자 수·양식 판을 확인해 주세요. 입력은 유지했습니다.':'원본 판·질문 내용·답변 형식을 확인하지 못했습니다. 아무 질문도 반영하지 않았습니다.')}
  finally{running.current=false;if(turn===generation.current){setBusy(false);props.onBusyChange(false)}}
 }
 return <section className="guided-setup documents-panel" aria-label="수합 방식과 질문 제안">
  <h4>수합 방식과 질문 제안</h4><strong>{modes[report.mode]}</strong>
  <ul className="documents-muted">{report.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
  <p className="documents-muted">원본 검사에 따른 안내입니다. 담당자가 방식을 정하며, 제안만으로 파일이나 질문을 저장하지 않습니다.</p>
  <div className="documents-actions"><button type="button" disabled={locked} aria-pressed={method==='guided'} onClick={()=>setMethod('guided')}>질문형으로 준비</button><button type="button" disabled={locked} aria-pressed={method==='file'} onClick={()=>setMethod('file')}>파일형으로 진행</button></div>
  {props.disabled&&!busy&&<p className="documents-muted">작성 중인 질문·답변을 저장하고 처리 결과를 확인한 뒤 제안을 사용할 수 있습니다.</p>}
  {method==='file'&&<div><p>파일형 수합에서는 교사가 원본을 내려받아 작성하고 다시 제출합니다. 수합 화면에서 양식 파일과 대상을 등록해 주세요.</p>{props.onOpenFileCollections&&<button type="button" disabled={locked} onClick={props.onOpenFileCollections}>파일형 수합 화면 열기</button>}</div>}
  {method==='guided'&&<>
   <p className="documents-muted">빈 문단 {report.unlinkedBlankCount}개 중 후보 {rows.length}개를 표시합니다. 나머지 위치는 아래 원본 목록에서 직접 연결할 수 있습니다.</p>
   {aiReason&&<p className="documents-status">AI 검토: {aiReason}</p>}
   <p className="documents-muted">앞 문단이 이 칸의 항목 이름인지 확인해 주세요. 위치가 비슷해도 다른 질문일 수 있습니다.</p>
   {rows.map((row,index)=>{const anchor=inspection.anchors.find(a=>a.id===row.anchorId)!;return <fieldset className="guided-question" key={row.anchorId} disabled={locked}>
    <legend>연결 후보 {index+1}</legend>
    <label className="documents-check"><input aria-label={`제안 선택 ${index+1}`} type="checkbox" checked={chosen.includes(row.anchorId)} onChange={e=>{setChosen(value=>e.target.checked?[...value,row.anchorId]:value.filter(v=>v!==row.anchorId));setConfirmed('');setSendConfirmed('')}}/>이 후보 선택</label>
    <p className="documents-muted">{anchor?.cell?`표 셀 ${anchor.cell.row===''?'?':Number(anchor.cell.row)+1}행 ${anchor.cell.column===''?'?':Number(anchor.cell.column)+1}열`:'본문 문단'} · {row.anchorId}</p>
    <p>바뀔 원문: (빈 문단)</p><p className="documents-body">앞 문단 참고: {row.context||'확인할 짧은 문맥 없음'}</p>
    <label htmlFor={`${id}-${index}-label`}>제안 질문 {index+1}<input id={`${id}-${index}-label`} value={row.label} maxLength={200} onChange={e=>change(row.anchorId,{label:e.target.value})}/></label>
    <details><summary>답변 형식 조정</summary><label>답변 형식<select aria-label={`제안 답변 형식 ${index+1}`} value={row.kind} onChange={e=>change(row.anchorId,{kind:e.target.value as Question['kind'],options:e.target.value==='select'?['']:[]})}><option value="text">짧은 글</option><option value="longtext">여러 줄 글</option><option value="number">숫자</option><option value="date">날짜</option><option value="select">선택 항목</option></select></label>
    <label className="documents-check"><input type="checkbox" checked={row.required} onChange={e=>change(row.anchorId,{required:e.target.checked})}/>필수 답변</label><label>최대 글자 수<input aria-label={`제안 최대 글자 수 ${index+1}`} type="number" min={1} max={GUIDED_LIMITS.maxAnswerCharacters} value={row.maxLength} onChange={e=>change(row.anchorId,{maxLength:Number(e.target.value)})}/></label>
    {row.kind==='select'&&<label>선택 항목 · 한 줄에 하나<textarea aria-label={`제안 선택 항목 ${index+1}`} value={row.options.join('\n')} onChange={e=>change(row.anchorId,{options:e.target.value.split('\n')})}/></label>}</details>
   </fieldset>})}
   {!rows.length&&<p>자동으로 연결할 제안이 없습니다. 원본 위치를 보고 직접 질문을 연결할 수 있습니다.</p>}
   <div className="documents-actions"><button type="button" disabled={locked} onClick={reset}>원본 기준 후보 다시 보기</button></div>
   {props.onRequestAi&&<details><summary>선택한 후보를 AI와 검토</summary><p>선택한 위치와 위에 표시된 질문·앞 문단 참고만 비서에 전달합니다. 비서 화면에서 실행을 눌러야 학교 예산으로 요청합니다.</p>{changed&&<p>수정한 제안은 먼저 반영하거나 원본 기준 후보로 되돌린 뒤 AI에 요청해 주세요.</p>}
    <label className="documents-check"><input type="checkbox" disabled={locked||changed||!selectedRows.length} checked={sendConfirmed===fingerprint} onChange={e=>setSendConfirmed(e.target.checked?fingerprint:'')}/>AI에 보낼 항목과 문맥을 확인했습니다</label>
    <button type="button" disabled={locked||changed||!selectedRows.length||sendConfirmed!==fingerprint} onClick={()=>void checked('ai')}>선택한 질문 제안 받기</button></details>}
   <label className="documents-check"><input type="checkbox" disabled={locked||!selectedRows.length} checked={confirmed===fingerprint} onChange={e=>setConfirmed(e.target.checked?fingerprint:'')}/>선택한 질문과 원본 위치를 확인했습니다</label>
   <button type="button" disabled={locked||!selectedRows.length||confirmed!==fingerprint} onClick={()=>void checked('apply')}>선택한 연결 제안 반영</button>
  </>}
  {busy&&<p role="status">원래 양식과 작성 권한을 다시 확인하는 중…</p>}{error&&<><p role="alert">{error}</p>{props.suggestion&&<button type="button" disabled={locked||changed} onClick={()=>setHandled('')}>돌아온 제안 다시 확인</button>}</>}{notice&&<p role="status">{notice}</p>}
 </section>
}
