import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { requestBlobDownload } from '../files/download'
import { TeachingError, teachingScope, type TeachingAdapter, type TeachingCatalog } from './contracts'
import { readCsvFile } from './csv'
import policy from './policy.json'
import {
  blankCourseBatch, courseBatchBasis, courseBatchHeaders, courseBatchLimit, courseBatchTemplate, courseBatchTokens, courseBatchRowsCsv, courseBatchResultsCsv,
  failCourseBatchAttempt, finishCourseBatchAttempt, parseCourseBatch, reviewCourseBatch, startCourseBatchAttempt,
  type CourseBatchAttempt, type CourseBatchDraft, type CourseBatchMapping, type CourseBatchRow,
} from './course-batch'
import styles from './course-batch.css?inline'

export interface CourseBatchPanelProps {
  adapter:TeachingAdapter; member:Membership; catalog?:TeachingCatalog; disabled:boolean; canRecover:boolean;
  onBusyChange:(busy:boolean)=>void; onSaved:()=>void; onClose:()=>void
}
export function CourseBatchPanel(props:CourseBatchPanelProps) {
  return <CourseBatchBody key={recoveryScope(props.member)} {...props}/>
}
function CourseBatchBody({adapter,member,catalog,disabled,canRecover,onBusyChange,onSaved,onClose}:CourseBatchPanelProps) {
  const memory=useEditDraft<CourseBatchDraft>(member,'teaching-course-batch'),recovery=usePendingRequest(member,'teaching')
  const [draft,setDraft]=useState(()=>memory.initial??blankCourseBatch()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [reviewed,setReviewed]=useState(''),[confirmed,setConfirmed]=useState(''),[discard,setDiscard]=useState(false),[page,setPage]=useState(0)
  const current=useRef(draft),flight=useRef(false),alive=useRef(true),adapterRef=useRef(adapter),generation=useRef(0),readGeneration=useRef(0)
  // 연결이 교체된 바로 그 렌더부터 이전 비동기 결과를 무효화한다.
  if(adapterRef.current!==adapter){adapterRef.current=adapter;generation.current++}
  useEffect(()=>{alive.current=true;flight.current=false;setBusy(false);onBusyChange(false);return()=>{alive.current=false;generation.current++;readGeneration.current++;onBusyChange(false)}},[adapter,onBusyChange])
  const parsed=useMemo(()=>{try{return {rows:draft.raw?parseCourseBatch(draft.raw):[],error:''}}catch(f){return {rows:[] as CourseBatchRow[],error:message(f)}}},[draft.raw])
  const reviews=useMemo(()=>catalog?reviewCourseBatch(parsed.rows,draft.mapping,catalog):[],[parsed.rows,draft.mapping,catalog])
  const tokens=courseBatchTokens(parsed.rows),basis=catalog?courseBatchBasis(catalog):''
  const reviewKey=JSON.stringify([draft.raw,draft.mapping,basis]),selectionKey=JSON.stringify([reviewKey,[...draft.selected].sort((a,b)=>a-b)])
  const pending=recovery.request,unknown=draft.attempts.find(a=>a.status==='unknown'),hasAttempts=draft.attempts.length>0
  const access=useRef({disabled,pending,canRecover});access.current={disabled,pending,canRecover}
  const pendingOwned=Boolean(pending&&unknown&&pending.key===unknown.key&&JSON.stringify(pending.command)===JSON.stringify(unknown.command))
  const locked=busy||Boolean(pending)||Boolean(unknown),saved=draft.attempts.filter(a=>a.status==='saved'),rejected=draft.attempts.filter(a=>a.status==='rejected')
  const reviewedNow=reviewed===reviewKey&&Boolean(catalog),reviewAllowed=!disabled&&!locked
  const ready=reviews.filter(r=>!r.problems.length&&!saved.some(a=>a.rowNumber===r.row.rowNumber))
  const selectedReady=ready.filter(r=>draft.selected.includes(r.row.rowNumber))
  function save(next:CourseBatchDraft){current.current=next;setDraft(next);memory.save(next,Boolean(next.raw||next.attempts.length))}
  function updateAttempt(attempt:CourseBatchAttempt){save({...current.current,attempts:[...current.current.attempts.filter(a=>a.rowNumber!==attempt.rowNumber),attempt]})}
  function edits(patch:Partial<CourseBatchDraft>){if(flight.current||access.current.disabled||access.current.pending||current.current.attempts.length)return;readGeneration.current++;setConfirmed('');setReviewed('');setError('');setNotice('');setPage(0);save({...current.current,...patch,selected:[]})}
  function map(kind:keyof CourseBatchMapping,token:string,id:string){edits({mapping:{...draft.mapping,[kind]:{...draft.mapping[kind],[token]:id}}})}
  function begin(){readGeneration.current++;flight.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('')}
  function end(){flight.current=false;setBusy(false);onBusyChange(false)}
  const valid=(epoch:number)=>alive.current&&epoch===generation.current
  async function upload(file:File|undefined) {
    if(!file||locked||hasAttempts)return
    const epoch=generation.current,read=++readGeneration.current
    try {const raw=await readCsvFile(file);if(!valid(epoch)||read!==readGeneration.current||flight.current||access.current.disabled||access.current.pending||current.current.attempts.length)return;edits({raw,mapping:{terms:{},subjects:{},teachers:{}}})}
    catch(f){if(valid(epoch)&&read===readGeneration.current)setError(message(f))}
  }
  async function send(attempt:CourseBatchAttempt,recovering:boolean,epoch:number):Promise<boolean> {
    // 전송 전에 원명령과 번호를 탭 메모리·공통 복구 슬롯 양쪽에 고정한다.
    updateAttempt({...attempt,status:'unknown'})
    recovery.put({key:attempt.key,command:attempt.command})
    try {
      const receipt=await adapter.mutate(member.id,attempt.command,attempt.key)
      if(!valid(epoch))return false
      const next=finishCourseBatchAttempt(attempt,receipt,teachingScope(member))
      updateAttempt(next);recovery.remove(attempt.key)
      return true
    }catch(f) {
      if(!valid(epoch))return false
      const next=failCourseBatchAttempt(attempt,f,recovering)
      updateAttempt(next)
      if(next.status==='rejected')recovery.remove(attempt.key)
      setError(next.status==='unknown'?'저장 결과를 아직 모릅니다. 뒤의 수업은 보내지 않았습니다. 원래 번호로 결과를 먼저 확인해 주세요.':next.message)
      return false
    }
  }
  async function submit() {
    if(flight.current||disabled||pending||unknown||!reviewedNow||confirmed!==selectionKey||!selectedReady.length||!catalog)return
    const epoch=generation.current,initial=structuredClone(current.current),selected=selectedReady.map(r=>r.row.rowNumber),expectedBasis=basis
    begin();setConfirmed('')
    try {
      const fresh=await adapter.catalog(member.id)
      if(!valid(epoch))return
      if(courseBatchBasis(fresh)!==expectedBasis)throw new TeachingError('CONFLICT','공식 학기·교과·담당 또는 수업 목록이 바뀌었습니다. 자료 새로 확인 후 목록을 다시 비교해 주세요.')
      if(fresh.courses.length+selected.length>policy.limits.catalogEntries)throw new TeachingError('INVALID_INPUT',`수업 목록 한도(${policy.limits.catalogEntries}개)를 넘습니다. 선택 개수를 줄여 주세요.`)
      for(const rowNumber of selected) {
        if(!valid(epoch))return
        // 각 행을 새로 보내기 직전에도 현재 목록으로 중복·기간·담당 변경을 확인한다.
        const latest=await adapter.catalog(member.id)
        if(!valid(epoch))return
        const review=reviewCourseBatch(parseCourseBatch(initial.raw),initial.mapping,latest).find(r=>r.row.rowNumber===rowNumber)
        const original=reviews.find(r=>r.row.rowNumber===rowNumber)
        if(!review||!original?.command||JSON.stringify(review.command)!==JSON.stringify(original.command)||review.problems.length||latest.courses.length>=policy.limits.catalogEntries)throw new TeachingError('CONFLICT',`${rowNumber}행을 보내기 전 공식 자료가 바뀌었습니다. 앞서 저장한 수업은 유지합니다. 자료를 새로 확인해 주세요.`)
        const attempt=startCourseBatchAttempt(review,crypto.randomUUID(),current.current.attempts)
        if(!await send(attempt,false,epoch))return
      }
      if(valid(epoch))setNotice(`선택한 수업 ${selected.length}개의 서버 저장을 확인했습니다.`)
    }catch(f){if(valid(epoch)){setError(message(f));setReviewed('')}}
    finally{if(valid(epoch)){end();onSaved()}}
  }
  async function recover() {
    if(flight.current||!canRecover||!unknown||(pending&&!pendingOwned))return
    const epoch=generation.current
    begin()
    try {if(await send(unknown,true,epoch)&&valid(epoch)){setNotice('원래 요청의 저장 결과를 확인했습니다. 남은 행은 다시 비교한 뒤 선택해 주세요.');setReviewed('');setConfirmed('')}}
    finally {if(valid(epoch)){end();onSaved()}}
  }
  function close() {
    if(flight.current||pending||unknown||((draft.raw||hasAttempts)&&!discard))return
    memory.remove();onClose()
  }
  function download(kind:'template'|'remaining'|'results'='template') {
    if(flight.current||(kind==='remaining'&&(access.current.pending||current.current.attempts.some(a=>a.status==='unknown'))))return
    const rows=parsed.rows.filter(r=>!saved.some(a=>a.rowNumber===r.rowNumber))
    const raw=kind==='results'?courseBatchResultsCsv(parsed.rows,current.current.attempts):kind==='remaining'?courseBatchRowsCsv(rows):courseBatchTemplate()
    requestBlobDownload(new Blob([raw],{type:'text/csv;charset=utf-8'}),kind==='results'?'수업_등록_처리결과.csv':kind==='remaining'?'아직_등록하지_않은_수업.csv':'수업_일괄등록_빈양식.csv')
    setNotice('CSV 내려받기를 요청했습니다. 실제 저장된 파일을 확인해 주세요.')
  }
  const visible=reviews.slice(page*policy.limits.pageRecords,(page+1)*policy.limits.pageRecords)
  return <section className="teaching-card course-batch" aria-label="수업 일괄 등록"><style>{styles}</style>
    <h3>수업 여러 개 등록</h3>
    <p>CSV를 읽고 학기·교과·담당을 직접 연결한 뒤 선택한 수업만 저장합니다. 수강 명부와 시간표 배치는 이 단계에서 바뀌지 않습니다.</p>
    <p className="teaching-muted">최대 {courseBatchLimit}행 · UTF-8 CSV · 여러 담당은 | 로 구분 · 입력과 복구 번호는 현재 탭에만 보관됩니다.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {(pending||unknown)&&<section aria-label="일괄 수업 저장 결과 확인"><h4>원래 요청의 결과부터 확인해 주세요</h4><p>결과를 모르는 행이 있으면 다음 행과 새 요청을 보내지 않습니다. 탭을 닫거나 새로고침하지 말아 주세요.</p>
      {pending&&!pendingOwned?<p role="alert">현재 목록과 다른 수업 요청이 남아 있습니다. 원래 입력을 보존한 화면에서 결과를 확인해 주세요.</p>:<button type="button" disabled={busy||!canRecover} onClick={()=>void recover()}>이 행을 같은 번호로 다시 확인</button>}
    </section>}
    {disabled&&<p role="status">현재 연결·목록·등록 권한을 확인한 뒤 계속할 수 있습니다. 작성한 입력과 저장 결과는 유지합니다.</p>}
    <p aria-live="polite">저장 확인 {saved.length}개 · 결과 미확인 {unknown?1:0}개 · 거절 {rejected.length}개 · 아직 보내지 않음 {Math.max(0,parsed.rows.length-draft.attempts.length)}개</p>
    {(!catalog||catalog.canManageCourses)&&<>
      <div className="teaching-actions"><button type="button" className="secondary" onClick={()=>download()} disabled={busy}>빈 CSV 양식</button>
        {hasAttempts&&<><button type="button" className="secondary" disabled={locked} onClick={()=>download('remaining')}>미저장 수업 CSV 내려받기</button><button type="button" className="secondary" disabled={busy} onClick={()=>download('results')}>행별 처리 결과 내려받기</button></>}</div>
      <label>수업 CSV 파일<input type="file" accept=".csv,text/csv" disabled={disabled||locked||hasAttempts} onChange={e=>void upload(e.target.files?.[0])}/></label>
      <label>수업 CSV 내용<textarea aria-label="수업 CSV 내용" rows={5} value={draft.raw} disabled={disabled||locked||hasAttempts} onChange={e=>edits({raw:e.target.value})}/></label>
      <p className="teaching-muted">첫 행: {courseBatchHeaders.join(', ')}. 시작일·종료일은 YYYY-MM-DD로 직접 입력합니다.</p>
      {parsed.error&&<p role="alert">{parsed.error}</p>}
      {parsed.rows.length>0&&catalog&&<><h4>파일의 항목을 공식 목록에 연결</h4>
        <p>같은 이름도 식별 번호를 확인해 선택해 주세요. 파일의 이름으로 자동 연결하지 않습니다.</p>
        <div className="course-batch-mappings">{(['terms','subjects','teachers'] as const).map(kind=>{
          const label=kind==='terms'?'학기':kind==='subjects'?'교과':'담당 교사'
          const options=kind==='terms'?catalog.terms:kind==='subjects'?catalog.subjects:catalog.approvedTeachers
          return tokens[kind].map(token=><label key={`${kind}:${token}`}>{label} 연결 · {token}<select aria-label={`${label} 연결 · ${token}`} value={Object.hasOwn(draft.mapping[kind],token)?draft.mapping[kind][token]:''} disabled={disabled||locked||hasAttempts} onChange={e=>map(kind,token,e.target.value)}>
            <option value="">직접 선택</option>{options.map(o=><option key={o.id} value={o.id}>{o.label} [{o.id}]{'firstDay'in o&&'lastDay'in o?` · ${o.firstDay} ~ ${o.lastDay}`:''}</option>)}
          </select></label>)
        })}</div>
        <button type="button" className="secondary" disabled={!reviewAllowed} onClick={()=>{setReviewed(reviewKey);setConfirmed('');setPage(0);setError('');save({...draft,selected:ready.map(r=>r.row.rowNumber)})}}>목록 비교하기</button>
      </>}
      {reviews.length>0&&<><div className="course-batch-table" tabIndex={0} aria-label="수업 등록 비교"><table><thead><tr><th>선택</th><th>수업</th><th>학기 · 교과</th><th>담당</th><th>기간</th><th>결과</th></tr></thead><tbody>{visible.map(r=>{
        const attempt=draft.attempts.find(a=>a.rowNumber===r.row.rowNumber),done=attempt?.status==='saved'
        return <tr key={r.row.rowNumber}><td><input type="checkbox" aria-label={`${r.row.rowNumber}행 수업 선택`} checked={!done&&draft.selected.includes(r.row.rowNumber)} disabled={disabled||locked||done||Boolean(r.problems.length)||!reviewedNow} onChange={e=>{setConfirmed('');save({...draft,selected:e.target.checked?[...draft.selected,r.row.rowNumber]:draft.selected.filter(x=>x!==r.row.rowNumber)})}}/></td>
          <td>{r.row.rowNumber}행 · {r.row.label||'이름 없음'}</td><td>{catalog?.terms.find(t=>t.id===r.command?.input.termId)?.label??r.row.term}<br/>{catalog?.subjects.find(t=>t.id===r.command?.input.subjectId)?.label??r.row.subject}</td>
          <td>{r.command?.input.teacherMemberIds.map(id=>`${catalog?.approvedTeachers.find(t=>t.id===id)?.label??'목록 확인 필요'} [${id}]`).join(', ')||r.row.teachers.join(', ')}</td>
          <td>{r.row.validFrom} ~ {r.row.validThrough}</td><td>{done?`저장 확인 · ${attempt.receipt?.entityId}`:attempt?.status==='unknown'?'결과 미확인':r.problems.join(' ')||attempt?.message||'등록 가능'}</td></tr>
      })}</tbody></table></div>
        {reviews.length>policy.limits.pageRecords&&<div className="teaching-actions"><button type="button" disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>이전 수업</button><span>{page+1} / {Math.ceil(reviews.length/policy.limits.pageRecords)}</span><button type="button" disabled={(page+1)*policy.limits.pageRecords>=reviews.length||busy} onClick={()=>setPage(p=>p+1)}>다음 수업</button></div>}
        {!reviewedNow&&<p role="status">현재 목록을 다시 비교해 주세요. 완료한 행과 원래 요청 번호는 유지합니다.</p>}
        <label className="course-batch-confirm"><input type="checkbox" checked={confirmed===selectionKey} disabled={disabled||locked||!reviewedNow||!selectedReady.length} onChange={e=>setConfirmed(e.target.checked?selectionKey:'')}/>선택한 수업의 학기·교과·담당·기간을 확인했습니다.</label>
        <button type="button" disabled={disabled||locked||!reviewedNow||confirmed!==selectionKey||!selectedReady.length} onClick={()=>void submit()}>선택한 수업 {selectedReady.length}개 저장</button>
      </>}
    </>}
    <p className="teaching-muted">행마다 순서대로 저장합니다. 중간에 멈춰도 먼저 완료한 수업은 유지하며 다시 보내지 않습니다. 동시에 다른 관리자가 등록한 수업은 각 행 전송 직전 다시 확인합니다.</p>
    <details><summary>목록 닫기</summary>{(draft.raw||hasAttempts)&&<label className="course-batch-confirm"><input type="checkbox" checked={discard} disabled={locked} onChange={e=>setDiscard(e.target.checked)}/>저장한 수업은 유지하고 남은 입력만 정리하겠습니다.</label>}<button type="button" className="secondary" disabled={locked||Boolean((draft.raw||hasAttempts)&&!discard)} onClick={close}>일괄 등록 닫기</button></details>
  </section>
}
function message(f:unknown){return f instanceof TeachingError?f.message:'자료를 확인하지 못했습니다. 현재 입력을 유지했습니다.'}
