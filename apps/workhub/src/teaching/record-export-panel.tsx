import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { recoveryScope } from '../app/pending-requests'
import { requestBlobDownload } from '../files/download'
import { TeachingError, teachingScope, type TeachingAdapter } from './contracts'
import { readRecordExport, recordExportCsv, RecordExportError, RECORD_EXPORT_NOTICE, recordConfirmationLabel, recordReviewLabel, recordStateLabel, type RecordExportReport, type RecordExportSelection } from './record-export'
import { openRecordPrintWindow, type RecordPrintSession } from './record-export-print'
import policy from './record-export-policy.json'
import styles from './record-export.css?inline'

export interface RecordExportPanelProps { adapter:TeachingAdapter; member:Membership; courseId:string; studentId:string; firstDay:string; lastDay:string; revision?:number; blockedReason?:string; onClose:()=>void }
export function RecordExportPanel({adapter,member,courseId,studentId,firstDay,lastDay,revision=0,blockedReason='',onClose}:RecordExportPanelProps){
  const id=useId(),scopeKey=recoveryScope(member),target=scopeKey+':'+courseId+':'+studentId
  const [selection,setSelection]=useState<RecordExportSelection>({firstDay,lastDay,observations:true,assessments:true,includeWithdrawn:false}),[report,setReport]=useState<RecordExportReport>(),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[page,setPage]=useState(0),[retryAction,setRetryAction]=useState<'csv'|'print'>(),[feedbackVersion,setFeedbackVersion]=useState(0)
  const generation=useRef(0),alive=useRef(true),inFlight=useRef(false),printWindow=useRef<RecordPrintSession>(),feedback=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null)
  const gate=useRef({target,blockedReason,revision});gate.current={target,blockedReason,revision}
  const readScope=teachingScope(member)
  useEffect(()=>{alive.current=true;heading.current?.focus();return()=>{alive.current=false;generation.current++;printWindow.current?.close()}},[])
  useEffect(()=>{generation.current++;inFlight.current=false;printWindow.current?.close();printWindow.current=undefined;setReport(undefined);setConfirmed(false);setBusy(false);setPage(0);setNotice('');setError('');setRetryAction(undefined)},[target,adapter,revision,blockedReason])
  useEffect(()=>{if(error||notice)feedback.current?.focus()},[error,notice,feedbackVersion])
  function update(next:RecordExportSelection){if(inFlight.current)return;printWindow.current?.close();printWindow.current=undefined;setSelection(next);setReport(undefined);setConfirmed(false);setError('');setNotice('');setRetryAction(undefined);setPage(0)}
  async function run(action:'preview'|'csv'|'print'){
    if(inFlight.current||gate.current.blockedReason||action!=='preview'&&(!report||!confirmed))return
    const expected=report,token=++generation.current,captured={...gate.current}
    let session:RecordPrintSession|undefined
    let failureStage:'read'|'output'='read'
    const closeSession=()=>{session?.close();if(printWindow.current===session)printWindow.current=undefined}
    const current=()=>alive.current&&generation.current===token&&gate.current.target===captured.target&&gate.current.revision===captured.revision&&!gate.current.blockedReason
    inFlight.current=true;setBusy(true);setError('');setNotice('');setRetryAction(undefined)
    try {
      if(action==='print'){failureStage='output';printWindow.current?.close();session=openRecordPrintWindow();printWindow.current=session;failureStage='read'}
      const latest=await readRecordExport(adapter,readScope,courseId,studentId,selection,current)
      if(!current())return
      setReport(latest)
      if(action==='preview'){setPage(0);setConfirmed(false);setNotice('최신 기록으로 미리보기를 만들었습니다. 학생·기간·상태를 확인해 주세요.');return}
      if(latest.fingerprint!==expected?.fingerprint){setPage(0);setConfirmed(false);closeSession();setNotice('미리보기 이후 자료가 달라졌습니다. 바뀐 내용을 다시 확인한 뒤 내려받거나 인쇄해 주세요.');return}
      if(!latest.rows.length){setConfirmed(false);return}
      // 브라우저 출력 실패만 재시도할 수 있다. 최신 자료·권한 확인 실패는 기존처럼 숨긴다.
      failureStage='output'
      if(action==='csv'){requestBlobDownload(new Blob([recordExportCsv(latest)],{type:'text/csv;charset=utf-8'}),'학생기록_'+latest.student.name+'_'+selection.firstDay+'_'+selection.lastDay+'.csv');setNotice('CSV 내려받기를 요청했습니다. 파일의 저장 여부를 확인해 주세요.')}
      else {if(!session?.isOpen())throw new RecordExportError('POPUP','인쇄 창이 닫혔습니다. 인쇄를 다시 눌러 주세요.');session.print(latest);setNotice('인쇄 창에 자료를 보냈습니다. 인쇄 또는 PDF 저장 결과를 확인해 주세요.')}
    } catch(f) {
      closeSession()
      if(!current())return
      if(failureStage==='output'&&action!=='preview'){
        setRetryAction(action)
        setError(f instanceof RecordExportError?f.message:action==='csv'?'CSV 내려받기를 시작하지 못했습니다. 다시 시도하거나 인쇄 · PDF 저장을 이용해 주세요.':'인쇄 창을 준비하지 못했습니다. 다시 시도해 주세요.')
      }else{
        setReport(undefined);setConfirmed(false)
        setError(f instanceof RecordExportError?f.message:f instanceof TeachingError?(f.code==='INVALID_INPUT'?'서버 자료의 형식을 확인하지 못해 출력을 중단했습니다. 다시 확인해 주세요.':f.message):'자료를 확인하거나 출력하지 못했습니다. 선택한 기간은 유지했습니다. 다시 시도해 주세요.')
      }
    } finally {if(current()){inFlight.current=false;setBusy(false);setFeedbackVersion(v=>v+1)}}
  }
  const visible=blockedReason?undefined:report,pages=Math.max(1,Math.ceil((visible?.rows.length??0)/policy.limits.previewPageSize)),actualPage=Math.min(page,pages-1),rows=visible?.rows.slice(actualPage*policy.limits.previewPageSize,(actualPage+1)*policy.limits.previewPageSize)??[]
  return <section className="record-export" aria-labelledby={id+'-title'}><style>{styles}</style><header><div><h3 id={id+'-title'} ref={heading} tabIndex={-1}>기록 출력·내보내기</h3><p>관찰과 평가를 기간별로 정리합니다. 상담 기록은 포함하지 않습니다.</p></div><button type="button" className="secondary" onClick={()=>{generation.current++;printWindow.current?.close();onClose()}}>출력 닫기</button></header>
    <p className="record-export-note">{RECORD_EXPORT_NOTICE} 현재 기록판이 2판 이상이어도 정정 이유·이전 본문은 이 출력에서 확인할 수 없습니다.</p>
    {blockedReason&&<p role="alert">{blockedReason} 출력 자료를 숨겼습니다. 연결을 확인한 뒤 미리보기를 다시 만들어 주세요.</p>}
    <fieldset disabled={busy||Boolean(blockedReason)}><legend>출력 범위</legend><div className="record-export-dates"><label htmlFor={id+'-first'}>출력 시작일<input id={id+'-first'} type="date" value={selection.firstDay} onChange={e=>update({...selection,firstDay:e.target.value})}/></label><label htmlFor={id+'-last'}>출력 종료일<input id={id+'-last'} type="date" value={selection.lastDay} onChange={e=>update({...selection,lastDay:e.target.value})}/></label></div><div className="record-export-options"><label><input type="checkbox" checked={selection.observations} onChange={e=>update({...selection,observations:e.target.checked})}/>관찰 기록</label><label><input type="checkbox" checked={selection.assessments} onChange={e=>update({...selection,assessments:e.target.checked})}/>평가 기록</label><label><input type="checkbox" checked={selection.includeWithdrawn} onChange={e=>update({...selection,includeWithdrawn:e.target.checked})}/>철회 기록도 참고용으로 포함</label></div><button type="button" onClick={()=>void run('preview')}>기록 미리보기</button></fieldset>
    {busy&&<p role="status">최신 기록과 조회 범위를 확인하고 있습니다.</p>}
    {(error||notice)&&!blockedReason&&<div ref={feedback} tabIndex={-1} role={error?'alert':'status'}><p>{error||notice}</p>{retryAction&&<><p>미리보기·현재 페이지·선택과 확인은 유지했습니다. 다시 시도할 때 최신 자료와 권한을 다시 확인합니다.</p><button type="button" className="secondary" disabled={busy||!confirmed} onClick={()=>void run(retryAction)}>{retryAction==='print'?'인쇄 다시 시도':'CSV 다시 시도'}</button></>}</div>}
    {visible&&<div aria-label="기록 출력 미리보기"><h4>{visible.courseLabel} · {visible.student.name}</h4><p>{visible.student.grade}학년 {visible.student.classLabel}반 {visible.student.seatNumber}번 · {visible.selection.firstDay} ~ {visible.selection.lastDay}</p><p>선택 범위 {visible.rows.length}건 · {visible.selection.includeWithdrawn?'철회 기록 포함':'철회 기록 제외'} · 근거 재검토 {visible.rows.filter(r=>r.sourceReviewRequired).length}건</p><p className="record-export-note">확인 시각 {visible.checkedAt} · 다운로드·인쇄 직전에 다시 조회합니다. 이후 정정한 내용은 다시 출력해 주세요.</p>
      {!visible.rows.length?<p>선택한 범위에서 출력할 관찰·평가 기록이 없습니다.</p>:<><ol className="record-export-records" start={actualPage*policy.limits.previewPageSize+1}>{rows.map(row=><li key={row.kind+':'+row.id}><h5>{row.occurredOn} · {row.kind==='observation'?'관찰':'평가'}</h5><p>{recordStateLabel(row)} · 현재 기록 {row.version}판 · {recordConfirmationLabel(row)}</p><p className={row.sourceReviewRequired?'record-export-review':''}>{recordReviewLabel(row)}</p><p className="record-export-text">{row.text||'의견 없음'}</p>{row.kind==='assessment'&&<><p>평가 당시 기준: {row.rubricLabel} · 기준 {row.rubricVersion}판</p><ul>{row.scores.map((score,i)=><li key={i}>{score}</li>)}</ul><p>{row.total===null?'합계 없음 · 항목별 상태 확인':'합계 '+row.total+'점'}</p></>}</li>)}</ol>{pages>1&&<nav aria-label="출력 미리보기 페이지"><button type="button" className="secondary" disabled={busy||actualPage===0} onClick={()=>setPage(p=>p-1)}>이전 기록</button><span>{actualPage+1} / {pages}페이지</span><button type="button" className="secondary" disabled={busy||actualPage===pages-1} onClick={()=>setPage(p=>p+1)}>다음 기록</button></nav>}<label className="record-export-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>학생·기간·기록 상태와 철회·근거 재검토 표시를 확인했습니다.</label><div className="record-export-actions"><button type="button" disabled={busy||!confirmed} onClick={()=>void run('csv')}>CSV 내려받기</button><button type="button" className="secondary" disabled={busy||!confirmed} onClick={()=>void run('print')}>인쇄 · PDF 저장</button></div></>}
    </div>}
  </section>
}
