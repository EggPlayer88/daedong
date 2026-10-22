import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { recoveryScope } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { libraryDocument, documentKindLabels, type LibraryDocument } from './contracts'
import type { DocumentsService } from './adapter'
import { assertDocumentPrintable, documentFieldChanges, documentStatusLabels, documentVersionFingerprint, DOCUMENT_PRINT_NOTICE, DocumentPrintError, openDocumentPrintWindow, readSavedDocument, type DocumentFieldChange, type DocumentPrintSession } from './document-review'

interface Props { document:LibraryDocument; service:DocumentsService; member:Membership; disabled:boolean; revision:number }
type Report = {key:string;document:LibraryDocument;before?:LibraryDocument;changes?:DocumentFieldChange[]}

export function DocumentReviewTools({document,service,member,disabled,revision}:Props){
  const id=useId(),[opened,setOpened]=useState(false),[report,setReport]=useState<Report>(),[history,setHistory]=useState<Awaited<ReturnType<DocumentsService['history']>>>([]),[previous,setPrevious]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(''),[retryPrint,setRetryPrint]=useState(false)
  const alive=useRef(true),generation=useRef(0),running=useRef(false),printWindow=useRef<DocumentPrintSession>(),heading=useRef<HTMLHeadingElement>(null)
  const key=canonical([recoveryScope(member),documentVersionFingerprint(document),revision,disabled]),gate=useRef(key);gate.current=key
  const visible=!disabled&&report?.key===key?report:undefined,confirmation=visible?documentVersionFingerprint(visible.document):''
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;printWindow.current?.close()}},[])
  useEffect(()=>{generation.current++;running.current=false;printWindow.current?.close();printWindow.current=undefined;setReport(undefined);setHistory([]);setPrevious('');setConfirmed('');setBusy(false);setError('');setNotice('');setRetryPrint(false)},[key,service])
  const close=()=>{generation.current++;running.current=false;printWindow.current?.close();printWindow.current=undefined;setOpened(false);setBusy(false);setReport(undefined);setConfirmed('');setError('');setNotice('');setRetryPrint(false)}
  async function run(action:'preview'|'compare'|'print'){
    if(disabled||running.current||action==='print'&&(!visible||confirmed!==confirmation))return
    const expected=visible?.document??document,token=++generation.current,captured=key
    const current=()=>alive.current&&generation.current===token&&gate.current===captured
    let session:DocumentPrintSession|undefined,stage:'read'|'output'='read'
    running.current=true;setBusy(true);setError('');setNotice('');setRetryPrint(false)
    if(action!=='print'){setReport(undefined);setConfirmed('')}
    try{
      if(action==='print'){assertDocumentPrintable(expected);stage='output';printWindow.current?.close();session=openDocumentPrintWindow();printWindow.current=session;stage='read'}
      const fresh=await readSavedDocument(service,member,expected)
      if(!current())return
      if(action==='print'){
        assertDocumentPrintable(fresh);stage='output'
        if(!session?.isOpen())throw new DocumentPrintError('인쇄 창이 닫혔습니다. 다시 시도해 주세요.')
        session.print(fresh);setReport(value=>value?{...value,document:fresh}:value);setNotice('인쇄 창에 선택한 저장판을 보냈습니다. 브라우저에서 인쇄 또는 PDF 저장 결과를 확인해 주세요.');return
      }
      const versions=await service.history(member.id,fresh.id)
      if(!current())return
      if(!versions.some(v=>v.version===fresh.version&&v.status===fresh.status))throw new ServiceError('INVALID_RESPONSE')
      setHistory(versions)
      if(action==='compare'){
        const older=Number(previous)
        if(!Number.isSafeInteger(older)||older>=fresh.version||!versions.some(v=>v.version===older))throw new ServiceError('INVALID_INPUT')
        const before=libraryDocument(await service.get(member.id,fresh.id,older),member,fresh.id,older)
        if(!current())return
        const changes=documentFieldChanges(before,fresh)
        setReport({key:captured,document:fresh,before,changes});setNotice(`v${older}에서 v${fresh.version}까지 변경한 항목 ${changes.length}개를 확인했습니다.`)
      }else{
        setPrevious(String(versions.find(v=>v.version<fresh.version)?.version??''));setReport({key:captured,document:fresh})
      }
      heading.current?.focus()
    }catch(failure){
      session?.close();if(printWindow.current===session)printWindow.current=undefined
      if(!current())return
      if(stage==='output'&&failure instanceof DocumentPrintError){setError(failure.message);setRetryPrint(true)}
      else{setReport(undefined);setConfirmed('');setError('선택한 문서의 저장판과 현재 조회 권한을 확인하지 못했습니다. 이전 미리보기는 숨겼으며 작성 중인 입력은 유지됩니다.')}
    }finally{
      if(!current())session?.close()
      if(current()){running.current=false;setBusy(false)}
    }
  }
  return <section className="documents-review-tools" aria-label="저장판 비교와 인쇄">
    {!opened?<button type="button" disabled={disabled} onClick={()=>{setOpened(true);void run('preview')}}>저장판 비교·인쇄</button>:<div className="documents-panel">
      <header className="documents-header"><h4 ref={heading} tabIndex={-1}>저장판 비교·인쇄</h4><button type="button" onClick={close}>보조 도구 닫기</button></header>
      <p className="documents-muted">선택한 문서의 v{document.version} 저장판을 확인합니다. 작성 중인 내용은 비교와 인쇄에 포함하지 않습니다.</p>
      {busy&&<p role="status">선택한 저장판을 확인하는 중…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {disabled&&<p role="status">진행 중인 요청과 문서함 연결을 먼저 확인해 주세요.</p>}
      {!visible&&!busy&&<button type="button" disabled={disabled} onClick={()=>void run('preview')}>저장판 다시 확인</button>}
      {visible&&<>
        {history.some(v=>v.version<visible.document.version)?<div className="documents-actions"><label htmlFor={`${id}-previous`}>비교할 이전 판<select aria-label="비교할 이전 판" id={`${id}-previous`} disabled={busy} value={previous} onChange={event=>{setPrevious(event.target.value);setReport(value=>value?{key:value.key,document:value.document}:value);setConfirmed('');setError('');setNotice('');setRetryPrint(false)}}>{history.filter(v=>v.version<visible.document.version).map(v=><option key={v.version} value={v.version}>v{v.version} · {documentStatusLabels[v.status]}</option>)}</select></label><button type="button" disabled={busy||!previous} onClick={()=>void run('compare')}>선택한 두 판 비교</button></div>:<p>조회된 이력에 이 판보다 이전인 저장판이 없습니다.</p>}
        {visible.changes&&<section aria-label="저장판 변경 항목"><h4>v{visible.before!.version} → v{visible.document.version}</h4>{!visible.changes.length?<p>비교한 내용과 근거가 같습니다.</p>:visible.changes.map(change=><section key={change.label}><h5>{change.label}</h5><div className="documents-comparison"><div><h6>이전 · v{visible.before!.version}</h6><p className="documents-body">{change.before}</p></div><div><h6>선택 · v{visible.document.version}</h6><p className="documents-body">{change.after}</p></div></div></section>)}</section>}
        <details open aria-label="저장판 인쇄 미리보기"><summary>선택한 저장판 미리보기 · v{visible.document.version}</summary><h4>{visible.document.title}</h4><p>{documentKindLabels[visible.document.kind]} · {documentStatusLabels[visible.document.status]} · {visible.document.visibility==='private'?'나만 보기':'학교 공유'}</p><p>기준일 {visible.document.basisDate} · 저장 시각 {visible.document.updatedAt}</p>{visible.document.version<visible.document.latestVersion&&<p>이전 저장판입니다.</p>}<p className="documents-body">{visible.document.body}</p>{visible.document.sources.length>0&&<><h5>저장판에 연결한 근거</h5><ul>{visible.document.sources.map((source,i)=><li key={i}><p>{source.locator} · v{source.sourceVersion}</p>{source.quote&&<p className="documents-body">{source.quote}</p>}</li>)}</ul></>}</details>
        {(visible.document.studentContext||visible.document.kind==='student_record')?<p>학생 기록 초안은 이 화면에서 인쇄하지 않습니다. 현재 관찰·평가 기록은 수업과 학생에서 출력할 수 있습니다.</p>:<><p className="documents-muted">{DOCUMENT_PRINT_NOTICE}</p><label className="documents-check"><input type="checkbox" disabled={busy} checked={confirmed===confirmation} onChange={event=>setConfirmed(event.target.checked?confirmation:'')}/>선택한 저장판과 본문·근거를 확인했습니다</label><button type="button" disabled={busy||confirmed!==confirmation} onClick={()=>void run('print')}>{retryPrint?'인쇄 다시 시도':'인쇄 · PDF 저장'}</button>{retryPrint&&<p>미리보기와 작성 중인 입력은 유지했습니다. 다시 시도할 때 저장판과 조회 권한을 다시 확인합니다.</p>}</>}
      </>}
    </div>}
  </section>
}
