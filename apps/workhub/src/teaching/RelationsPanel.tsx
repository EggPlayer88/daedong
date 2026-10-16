import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { TeachingError } from './contracts'
import policy from './policy.json'
import type { TeachingRelationsAdapter, RelationsSnapshot, TeachingRelation, RelationIntent, RelationPreview, RelationCommit, RelationIntentKind } from './relations-contracts'
import { validateRelationSelection, validateRelationCommit, relationCommit, assertRelationPreviewFresh } from './relations-validation'

interface RelationDraft { intent?: RelationIntent; preview?: RelationPreview; confirmed: boolean }
const empty = (): RelationDraft => ({ confirmed:false })
const names: Record<RelationIntentKind,string> = { assignment_end:'담당 교사 종료', assignment_replace:'담당 교사 교체', membership_end:'이 수업의 수강 종료', student_transfer_out:'학생 전출 처리' }
const relationNames = { assignment:'교사 담당', course_membership:'수강 관계', enrollment:'학교 학적' }
export function RelationsPanel({adapter,member,courseId,revision=0,blockedReason,onClose,onSaved}:{adapter:TeachingRelationsAdapter;member:Membership;courseId:string;revision?:number;blockedReason?:string;onClose:()=>void;onSaved:()=>void}) {
  const memory=useEditDraft<RelationDraft>(member,'teaching-relations:'+courseId),recovery=usePendingRequest(member,'teachingRelations')
  const [draft,setDraft]=useState<RelationDraft>(()=>memory.initial??empty()),[snapshot,setSnapshot]=useState<RelationsSnapshot>(),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[stale,setStale]=useState(false)
  const alive=useRef(true),generation=useRef(0),inFlight=useRef(false),draftRef=useRef(draft),feedback=useRef<HTMLDivElement>(null)
  const pending=recovery.request,locked=busy||Boolean(pending),ready=Boolean(snapshot)&&!loading&&!loadError&&!blockedReason
  function change(value:RelationDraft){draftRef.current=value;setDraft(value);memory.save(value.intent?value:undefined,Boolean(value.intent))}
  function message(f:unknown){return f instanceof TeachingError?f.message:'관계 자료를 확인하지 못했습니다. 입력을 유지했습니다.'}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[adapter])
  useEffect(()=>{
    let current=true;const seq=++generation.current;setLoading(true);setLoadError('');setStale(Boolean(draftRef.current.preview))
    void adapter.snapshot(member.id,courseId).then(value=>{if(!current||!alive.current||seq!==generation.current)return;setSnapshot(value);setLoading(false)}).catch(f=>{if(!current||!alive.current||seq!==generation.current)return;setSnapshot(undefined);setLoading(false);setLoadError(message(f))})
    return()=>{current=false;generation.current++}
  },[adapter,member.id,courseId,revision,reload])
  useEffect(()=>{if(error||notice||loadError)feedback.current?.focus()},[error,notice,loadError])
  function begin(kind:RelationIntentKind,target:TeachingRelation){if(!snapshot||locked)return;change({confirmed:false,intent:{kind,courseId,expectedCourseVersion:snapshot.courseVersion,relationId:target.id,expectedRelationVersion:target.version,studentId:target.studentId,enrollmentId:target.enrollmentId,lastDay:snapshot.basisDate>target.validFrom?snapshot.basisDate:target.validFrom,replacementMemberId:kind==='assignment_replace'?'':null,reason:''}});setError('');setNotice('');setStale(false)}
  function edit(patch:Partial<RelationIntent>){if(locked||!draft.intent)return;change({intent:{...draft.intent,...patch},confirmed:false});setError('');setStale(false)}
  async function preview(){
    if(!snapshot||!draft.intent||locked||!ready||inFlight.current)return
    let intent:RelationIntent;try{intent=validateRelationSelection(draft.intent,snapshot)}catch(f){setError(message(f));return}
    const seq=generation.current;inFlight.current=true;setBusy(true);setError('');setNotice('')
    try{const result=await adapter.preview(member.id,intent);if(!alive.current)return;if(seq!==generation.current){setError('확인 중 관계가 갱신되었습니다. 입력을 유지했으니 다시 미리보기 해 주세요.');return}change({intent,preview:result,confirmed:false});setStale(false)}catch(f){if(alive.current)setError(message(f))}finally{if(alive.current){inFlight.current=false;setBusy(false)}}
  }
  async function commit(command:RelationCommit,key?:string){
    if(inFlight.current||(!key&&(!ready||pending||stale||!draft.confirmed)))return
    let normalized:RelationCommit;try{normalized=validateRelationCommit(command);if(!key&&snapshot){validateRelationSelection(normalized.intent,snapshot);if(!draft.preview)throw new TeachingError('CONFLICT','변경 영향을 먼저 확인해 주세요.');assertRelationPreviewFresh(draft.preview)}}catch(f){setError(message(f));return}
    const requestKey=key??crypto.randomUUID();inFlight.current=true;setBusy(true);setError('');setNotice('');recovery.put({command:normalized,key:requestKey})
    try{await adapter.commit(member.id,normalized,requestKey);if(!alive.current)return;recovery.remove(requestKey);change(empty());setStale(false);setNotice('서버에서 관계 변경을 확인했습니다. 기존 학생과 기록은 보존됩니다.');setReload(x=>x+1);onSaved()}
    catch(f){if(!alive.current)return;const code=f instanceof TeachingError?f.code:'SAVE_UNCERTAIN';if(!key&&['INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','UNAVAILABLE'].includes(code)){recovery.remove(requestKey);change({...draftRef.current,confirmed:false});setStale(true);if(code==='CONFLICT')setReload(x=>x+1)}setError(message(f))}
    finally{if(alive.current){inFlight.current=false;setBusy(false)}}
  }
  function useLatest(){if(!snapshot||!draft.intent||locked)return;const i=draft.intent,s=snapshot.students.find(s=>s.studentId===i.studentId),target=i.kind.startsWith('assignment_')?snapshot.assignments.find(r=>r.id===i.relationId):i.kind==='membership_end'?s?.membership:s?.enrollment;if(!target||target.id!==i.relationId){setError('선택한 관계를 현재 목록에서 확인할 수 없습니다. 새 대상을 선택해 주세요.');return}change({intent:{...i,expectedCourseVersion:snapshot.courseVersion,expectedRelationVersion:target.version},confirmed:false});setStale(false);setError('');setNotice('최신 관계판을 반영했습니다. 기간과 대상을 다시 미리보기 해 주세요.')}
  function close(){if(locked)return;memory.remove();onClose()}
  const manageable=(r:TeachingRelation)=>Boolean(snapshot&&r.effectiveThrough&&r.effectiveThrough>snapshot.basisDate&&r.effectiveThrough>r.validFrom)
  return <section className="teaching-card" aria-label="담당·수강 관계 관리"><header className="teaching-toolbar"><h3>담당·수강 관계 관리</h3><button type="button" className="secondary" disabled={locked} onClick={close}>{draft.intent?'입력 버리고 관계 관리 닫기':'관계 관리 닫기'}</button></header>
    <p>종료는 학생 삭제가 아닙니다. 기존 관찰·상담·평가와 작성자 이력을 남기고 앞으로의 관계만 변경합니다. 새 교사에게 개인 기록을 넘기지 않습니다.</p>
    {(error||notice||loadError)&&<div ref={feedback} tabIndex={-1} role={error||loadError?'alert':'status'} className={error||loadError?'teaching-error':'teaching-notice'}>{error||loadError||notice}</div>}
    {pending&&<section aria-label="관계 변경 결과 확인"><h4>원래 요청 결과를 먼저 확인해 주세요</h4><p>입력·명령·요청 번호는 현재 탭에 보관했습니다. 새 미리보기나 다른 변경을 보내지 않고 같은 요청으로 확인합니다.</p><button type="button" disabled={busy} onClick={()=>void commit(pending.command as RelationCommit,pending.key)}>같은 관계 변경 요청으로 결과 확인</button></section>}
    {blockedReason&&<p role="alert">{blockedReason} 보관한 입력과 원래 요청은 유지합니다.</p>}
    {loading&&<p role="status">담당·수강 관계를 확인하는 중…</p>}
    {!ready&&<p>관계 변경 기능의 연결을 확인할 때까지 변경할 수 없습니다. 기존 수업·학생 기록은 이 패널을 닫고 확인할 수 있습니다.</p>}
    <button type="button" className="secondary" disabled={busy||loading} onClick={()=>setReload(x=>x+1)}>관계 다시 확인</button>
    {snapshot&&!blockedReason&&<>
      <p>기준일 {snapshot.basisDate} · {snapshot.courseLabel} · 수업 {snapshot.courseVersion}판</p>
      <details open={!draft.intent||stale}><summary>교사 담당 {snapshot.assignments.length}건</summary>{snapshot.assignments.length?snapshot.assignments.map(r=><article key={r.id}><h4>{r.label}</h4><p>{r.validFrom} ~ {r.effectiveThrough??'시작 전 취소'} · 관계 {r.version}판</p>{snapshot.capabilities.manageAssignments&&<div className="teaching-actions"><button type="button" className="secondary" disabled={!ready||locked||Boolean(draft.intent)||!manageable(r)} onClick={()=>begin('assignment_replace',r)}>담당 교체 · {r.label}</button><button type="button" className="secondary" disabled={!ready||locked||Boolean(draft.intent)||!manageable(r)} onClick={()=>begin('assignment_end',r)}>담당 종료 · {r.label}</button></div>}</article>):<p>등록된 담당 관계가 없습니다.</p>}</details>
      <details open={!draft.intent||stale}><summary>학생 수강 {snapshot.students.length}명</summary>{snapshot.students.map(s=><article key={s.studentId}><h4>{s.name}</h4><p>수강 {s.membership.validFrom} ~ {s.membership.effectiveThrough??'시작 전 취소'} · 관계 {s.membership.version}판</p><div className="teaching-actions">{snapshot.capabilities.endMemberships&&<button type="button" className="secondary" disabled={!ready||locked||Boolean(draft.intent)||!manageable(s.membership)} onClick={()=>begin('membership_end',s.membership)}>수강 종료 · {s.name}</button>}{snapshot.capabilities.transferStudents&&<button type="button" className="secondary" disabled={!ready||locked||Boolean(draft.intent)||!manageable(s.enrollment)} onClick={()=>begin('student_transfer_out',s.enrollment)}>전출 처리 · {s.name}</button>}</div></article>)}</details>
      {draft.intent&&<form onSubmit={e=>{e.preventDefault();void preview()}} aria-label="관계 변경 입력"><h4>{names[draft.intent.kind]}</h4><p>{draft.intent.kind==='student_transfer_out'?'선택 학적과 연결된 다른 수업도 함께 종료됩니다. 다음 화면에서 전체 영향 범위를 확인합니다.':draft.intent.kind==='membership_end'?'선택한 수업의 수강만 종료합니다. 학교 학적과 다른 수업은 유지합니다.':draft.intent.kind==='assignment_replace'?'선택한 교사의 마지막 유효일 다음날부터 새 교사가 담당합니다. 오늘 입력하면 새 담당은 가장 빨라도 내일부터 시작합니다. 공동 담당 중 다른 교사는 그대로입니다.':'선택한 담당 관계만 종료합니다. 다른 담당 교사의 관계는 유지합니다.'}</p>
        <fieldset disabled={locked||!ready}><legend className="teaching-sr">관계 변경 입력</legend><label>마지막 유효일<input aria-label="마지막 유효일" type="date" required min={snapshot.basisDate} value={draft.intent.lastDay} onChange={e=>edit({lastDay:e.target.value})}/></label>
        {draft.intent.kind==='assignment_replace'&&<label>새 담당 교사<select aria-label="새 담당 교사" required value={draft.intent.replacementMemberId??''} onChange={e=>edit({replacementMemberId:e.target.value})}><option value="">교사 선택</option>{snapshot.approvedTeachers.map(t=><option key={t.memberId} value={t.memberId}>{t.label}</option>)}</select></label>}
        <label>변경 사유<textarea aria-label="변경 사유" required maxLength={policy.limits.relationReasonCharacters} value={draft.intent.reason} onChange={e=>edit({reason:e.target.value})}/></label><button type="submit">변경 영향 미리보기</button><button type="button" className="secondary" onClick={()=>{change(empty());setError('');setStale(false)}}>입력 취소</button></fieldset>
        {(stale||draft.intent.expectedCourseVersion!==snapshot.courseVersion)&&<p role="status">입력 뒤 자료가 다시 조회되었거나 판이 바뀌었습니다. 현재 관계와 입력을 비교하고 미리보기를 새로 확인해 주세요.</p>}
        <button type="button" className="secondary" disabled={locked||!ready} onClick={useLatest}>최신 관계판 확인 · 입력 유지</button>
      </form>}
    </>}
    {ready&&draft.preview&&<section className="teaching-card" aria-label="관계 변경 영향 미리보기"><h4>변경될 관계 {draft.preview.changes.length}건</h4><p>미리보기 만료: {draft.preview.expiresAt} · 사유: {draft.preview.intent.reason}</p><ul>{draft.preview.changes.map(r=><li key={r.kind+':'+r.id}><strong>{relationNames[r.kind]} · {r.label}</strong>{r.courseLabel&&<span> · {r.courseLabel}</span>}<p>{r.validFrom} ~ {r.effectiveThrough} → {r.afterThrough??'시작 전 취소'} · 관계 {r.version}판</p></li>)}</ul>{draft.preview.replacement&&<p>새 담당: {draft.preview.replacement.label} · {draft.preview.replacement.validFrom} ~ {draft.preview.replacement.validThrough}</p>}<p>학생 원본·기존 기록 보존 / 개인 기록 자동 인계 없음 / 선택하지 않은 학생과 담당은 변경하지 않음</p><label className="teaching-check"><input type="checkbox" disabled={locked||stale} checked={draft.confirmed} onChange={e=>change({...draft,confirmed:e.target.checked})}/>대상·기간·전체 영향과 기존 기록 보존을 확인했습니다.</label><button type="button" disabled={locked||stale||!draft.confirmed} onClick={()=>{if(draft.preview)void commit(relationCommit(draft.preview))}}>확인한 관계 변경 적용</button></section>}
  </section>
}
