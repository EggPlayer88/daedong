import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import { newSetupRowId, validateSetupDraft } from './contract'
import { academicYearStartMatches, ACADEMIC_YEAR_START_MESSAGE } from './academic-year'
import { SCHOOL_ADMIN_LIMITS, SCHOOL_ASSIGNMENT_KINDS, SCHOOL_MEMBER_LABELS, SchoolAdminError, schoolAdminCommand, schoolAdminSubjects, type SchoolAdminCommand, type SchoolAdminServer, type SchoolAdminSnapshot, type SchoolAdminMember, type SchoolAssignment, type SchoolAdminReadiness } from './school-admin-contract'
import { createSupabaseSchoolAdminServer } from './school-admin-server'
import { reconcileSchoolConfiguration, schoolConfigurationChanges, schoolConfigurationValue, type SchoolConflictChoices } from './school-admin-edit'
import { SchoolConfigurationEditor } from './SchoolConfigurationEditor'
import styles from './school-setup.css?inline'
import adminStyles from './school-admin.css?inline'

export interface SchoolAdminPanelProps { connection: SupabaseConnection; member: Membership; date: string; revision?: number; onNavigationLockChange?: (locked:boolean)=>void; onUpdated?:()=>void; server?:SchoolAdminServer }
type Session = { command?:SchoolAdminCommand; base?:SchoolAdminSnapshot; reviewing?:boolean; pending?:{command:SchoolAdminCommand;key:string}; conflict?:boolean; choices?:SchoolConflictChoices }
const layoutEffect=typeof window==='undefined'?useEffect:useLayoutEffect
const confirmedRejection=(error:unknown)=>error instanceof SchoolAdminError&&['NOT_READY','INVALID_INPUT','FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','CONFLICT'].includes(error.code)
const safeMessage=(error:unknown)=>error instanceof SchoolAdminError?error.message:'학교 관리 요청을 완료하지 못했습니다. 입력은 보존했습니다.'
const formatDate=(date:string)=>new Date(date).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const pretty=(value:unknown)=>value===null?'없음':typeof value==='string'?value:JSON.stringify(value)

export function SchoolAdminPanel(props:SchoolAdminPanelProps) {
  return <SchoolAdminScope key={`${props.member.userId}:${props.member.schoolId}:${props.member.id}`} {...props}/>
}
function SchoolAdminScope({connection,member,date,revision=0,onNavigationLockChange,onUpdated,server:provided}:SchoolAdminPanelProps) {
  const server=useMemo(()=>provided??createSupabaseSchoolAdminServer(connection),[provided,connection])
  const recovery=usePendingRequest(member,'schoolAdmin'),memory=useEditDraft<Session>(member,'school-admin-editor')
  const [session,setSessionState]=useState<Session>(()=>{
    const saved=memory.initial??{}
    if(recovery.request){try{const command=schoolAdminCommand(recovery.request.command,{existingRequest:true});return {...saved,command,pending:{command,key:recovery.request.key},reviewing:true}}catch{return saved}}
    return saved
  })
  const latest=useRef(session),life=useRef(0),operation=useRef(false),panel=useRef<HTMLElement>(null),uid=useId()
  const [snapshot,setSnapshot]=useState<SchoolAdminSnapshot>(),[ready,setReady]=useState<SchoolAdminReadiness>(),[year,setYear]=useState<number>()
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
  const [error,setError]=useState(''),[readError,setReadError]=useState(''),[notice,setNotice]=useState(''),[issues,setIssues]=useState<string[]>([])
  const [tab,setTab]=useState<'configuration'|'memberships'|'assignments'>('configuration'),[search,setSearch]=useState(''),[page,setPage]=useState(0)
  const [focus,setFocus]=useState<{target:string;serial:number}>(),focusSerial=useRef(0)
  const enabled=activeAt(member,date),locked=Boolean(session.command||session.pending||recovery.request||busy)
  const editable=enabled&&ready?.available===true&&!!snapshot&&!readError&&!busy&&!session.pending&&!recovery.request&&!session.reviewing&&!session.conflict
  const assignable=snapshot?.memberships.filter(item=>item.status==='active')??[]
  const command=session.command
  function update(value:Session) { latest.current=value;memory.save(value,Boolean(value.command||value.pending));setSessionState(value) }
  function move(target:string) { setFocus({target,serial:++focusSerial.current}) }
  useEffect(()=>()=>{life.current++;operation.current=false},[server])
  layoutEffect(()=>{onNavigationLockChange?.(locked);return()=>onNavigationLockChange?.(false)},[locked,onNavigationLockChange])
  useEffect(()=>{if(!locked)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[locked])
  layoutEffect(()=>{if(!focus)return;const node=panel.current?.querySelector<HTMLElement>(`[data-admin-focus="${focus.target}"]`);if(node){node.focus({preventScroll:true});node.scrollIntoView({block:'start'})}},[focus])
  useEffect(()=>{
    let cancelled=false
    if(!enabled){setReady(undefined);setSnapshot(undefined);setReadError('학교 소속의 이용 기간을 확인해 주세요.');setLoading(false);return}
    setLoading(true);setReadError('')
    void server.readiness(member.id).then(async value=>{
      if(cancelled)return;setReady(value)
      if(!value.available){setSnapshot(undefined);return}
      const next=await server.get(member.id,year)
      if(!cancelled)setSnapshot(next)
    }).catch(failure=>{if(!cancelled){setReadError(safeMessage(failure));if(failure instanceof SchoolAdminError&&['FORBIDDEN','INACTIVE_MEMBERSHIP','CANCELLED'].includes(failure.code))setSnapshot(undefined)}}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[server,member.id,member.schoolId,enabled,year,revision,reload])
  function change(patch:Partial<SchoolAdminCommand>) { if(operation.current||latest.current.pending||!editable||!latest.current.command)return;update({...latest.current,command:{...latest.current.command,...patch} as SchoolAdminCommand,reviewing:false});setIssues([]);setError('');setNotice('') }
  function start(next:SchoolAdminCommand) { if(operation.current||latest.current.command||latest.current.pending||!snapshot||locked||!enabled)return;update({command:next,base:structuredClone(snapshot)});setError('');setIssues([]);setNotice('');move('editor') }
  function editConfiguration(create=false) {
    if(!snapshot)return
    const value=schoolConfigurationValue(snapshot)
    if(create){
      value.configuration={...value.configuration,draftId:newSetupRowId(),schoolYear:'',startsOn:'',lastDay:'',terms:value.configuration.terms.map(row=>({...row,id:newSetupRowId(),startsOn:'',lastDay:''})),departments:value.configuration.departments.map(row=>({...row,id:newSetupRowId()})),classes:value.configuration.classes.map(row=>({...row,id:newSetupRowId()}))}
      value.subjects=value.subjects.map(row=>({...row,id:newSetupRowId()}))
    }
    start({kind:'save_configuration',expectedVersion:snapshot.version,mode:create?'create_year':'update',...value,reason:''})
  }
  function editMember(target:SchoolAdminMember) {
    if(!snapshot)return
    start({kind:'review_membership',expectedVersion:snapshot.version,schoolYear:Number(snapshot.configuration.schoolYear),targetMemberId:target.id,decision:target.status==='pending'?'active':target.status==='active'?'suspended':'active',startsOn:target.startsOn,lastDay:target.lastDay,reason:''})
  }
  function addAssignment() {
    if(!snapshot)return
    start({kind:'assign_duty',expectedVersion:snapshot.version,schoolYear:Number(snapshot.configuration.schoolYear),memberId:'',assignmentKind:'homeroom',targetId:'',label:'',startsOn:snapshot.configuration.startsOn,lastDay:snapshot.configuration.lastDay,reason:''})
  }
  function endAssignment(target:SchoolAssignment) {
    if(!snapshot)return
    start({kind:'end_assignment',expectedVersion:snapshot.version,schoolYear:Number(snapshot.configuration.schoolYear),assignmentId:target.id,lastDay:target.lastDay,reason:''})
  }
  function cancel() { if(busy||session.pending||recovery.request)return;update({});setIssues([]);setError('');move('heading') }
  function review() {
    if(!editable||!command||!snapshot||loading)return
    if(command.expectedVersion!==snapshot.version){update({...session,conflict:true,reviewing:false,choices:{}});setError('편집을 시작한 뒤 학교 자료가 변경되었습니다. 변경을 비교해 주세요.');move('conflict');return}
    const problems:string[]=[]
    if(command.kind==='save_configuration'){
      problems.push(...validateSetupDraft(command.configuration).map(issue=>issue.message))
      try{schoolAdminSubjects(command.subjects)}catch{problems.push('교과의 이름·식별자가 중복되거나 비어 있는지 확인해 주세요.')}
      if(command.mode==='create_year'&&!academicYearStartMatches(Number(command.configuration.schoolYear),command.configuration.startsOn))problems.push(ACADEMIC_YEAR_START_MESSAGE)
      if(command.mode==='create_year'&&snapshot.availableYears.includes(Number(command.configuration.schoolYear)))problems.push('이미 있는 학년도입니다. 해당 학년도를 선택해 수정해 주세요.')
    }
    if(!command.reason.trim())problems.push('변경 사유를 입력해 주세요.')
    try{schoolAdminCommand(command)}catch{if(!problems.length)problems.push('대상, 이름, 기간과 필수 입력을 확인해 주세요.')}
    if(command.kind==='assign_duty'){
      const target=snapshot.memberships.find(item=>item.id===command.memberId)
      if(!target||target.status!=='active')problems.push('재직 중인 교사를 선택해 주세요.')
      if(command.startsOn<snapshot.configuration.startsOn||command.lastDay>snapshot.configuration.lastDay)problems.push('담당 기간은 선택한 학년도 안에 있어야 합니다.')
      if(target&&(command.startsOn<target.startsOn||command.lastDay>target.lastDay))problems.push('담당 기간은 교사의 학교 소속 기간 안에 있어야 합니다.')
    }
    if(command.kind==='end_assignment'){
      const target=snapshot.assignments.find(item=>item.id===command.assignmentId)
      if(!target||target.status!=='active'||command.lastDay<target.startsOn||command.lastDay>target.lastDay)problems.push('현재 담당 기간 안에서 마지막 날을 선택해 주세요.')
    }
    setIssues([...new Set(problems)]);setError('')
    if(problems.length){move('issues');return}
    update({...session,command:schoolAdminCommand(command),reviewing:true});move('review')
  }
  async function submit(retry=false) {
    if(operation.current||!enabled||!ready?.available)return
    const current=latest.current
    if(!retry&&(!current.reviewing||!current.command))return
    let pending=current.pending
    try{pending=pending??{command:schoolAdminCommand(current.command),key:crypto.randomUUID()}}catch{setError('변경 요청을 준비하지 못했습니다. 입력은 유지했습니다.');move('error');return}
    // 네트워크 요청 전부터 원문과 번호를 함께 보존한다. 재시도 때 새 번호를 만들지 않는다.
    recovery.put(pending);update({...current,pending});operation.current=true;setBusy(true);setError('');const epoch=life.current
    try{
      const receipt=await server.mutate(member.id,pending.command,pending.key,{existingRequest:retry})
      if(epoch!==life.current)return
      recovery.remove(pending.key);update({});setIssues([]);setNotice(`${formatDate(receipt.recordedAt)}에 변경 반영을 확인했습니다. 최신 자료를 다시 확인합니다.`)
      setYear(receipt.schoolYear);setReload(value=>value+1);move('notice')
      try { onUpdated?.() } catch { /* 저장 접수증은 유효하다. 상위 갱신 실패를 미저장으로 바꾸지 않는다. */ }
    }catch(failure){
      if(epoch!==life.current)return
      if(confirmedRejection(failure)){
        recovery.remove(pending.key)
        update({...latest.current,pending:undefined,reviewing:false,conflict:failure instanceof SchoolAdminError&&failure.code==='CONFLICT',choices:{}})
        if(failure instanceof SchoolAdminError&&failure.code==='CONFLICT')setReload(value=>value+1)
      }
      setError(safeMessage(failure));move('error')
    }finally{if(epoch===life.current){operation.current=false;setBusy(false)}}
  }
  const configMerge=(()=>{
    if(command?.kind!=='save_configuration'||!session.base||!snapshot)return undefined
    const mine={configuration:command.configuration,subjects:command.subjects}
    if(command.mode==='update')return reconcileSchoolConfiguration(schoolConfigurationValue(session.base),mine,schoolConfigurationValue(snapshot),session.choices)
    // 새 학년도의 구성은 유지하되 학교 공통 정보의 동시 변경만 비교한다.
    const base=structuredClone(mine),remote=structuredClone(mine)
    for(const key of ['schoolName','schoolCode','schoolType','gradeCount'] as const){base.configuration[key]=session.base.configuration[key];remote.configuration[key]=snapshot.configuration[key]}
    return reconcileSchoolConfiguration(base,mine,remote,session.choices)
  })()
  function resolveConflict(){
    if(!command||!snapshot||session.pending||busy||readError||loading)return
    if(configMerge?.unresolved.length)return
    let next:SchoolAdminCommand={...command,expectedVersion:snapshot.version}
    if(command.kind==='save_configuration'&&configMerge)next={...command,...configMerge.value,expectedVersion:snapshot.version}
    if(command.kind==='save_configuration'&&command.mode==='create_year'&&snapshot.availableYears.includes(Number(command.configuration.schoolYear))){setError('같은 학년도가 이미 생성되었습니다. 초안을 보관하고 해당 학년도를 선택해 다시 편집해 주세요.');return}
    update({command:next,base:structuredClone(snapshot)});setError('');setIssues([]);move('editor')
  }
  const filteredMembers=(snapshot?.memberships??[]).filter(item=>`${item.name} ${SCHOOL_MEMBER_LABELS[item.status]}`.includes(search.trim()))
  const memberPage=listWindow(filteredMembers,page)
  const memberNames=new Map((snapshot?.memberships??[]).map(item=>[item.id,item.name]))
  const filteredAssignments=(snapshot?.assignments??[]).filter(item=>`${memberNames.get(item.memberId)??''} ${item.label} ${SCHOOL_ASSIGNMENT_KINDS.find(kind=>kind.value===item.kind)?.label??''}`.includes(search.trim()))
  const assignmentPage=listWindow(filteredAssignments,page)
  function field(label:string,key:string,value:string,onChange:(value:string)=>void,type='text',maxLength?:number) { return <label className="setup-field" htmlFor={`${uid}-${key}`}><span>{label}</span><input aria-label={label} id={`${uid}-${key}`} type={type} value={value} onChange={event=>onChange(event.target.value)} maxLength={maxLength}/></label> }
  function selection(label:string,key:string,value:string,onChange:(value:string)=>void,options:{value:string;label:string}[]) { return <label className="setup-field" htmlFor={`${uid}-${key}`}><span>{label}</span><select aria-label={label} id={`${uid}-${key}`} value={value} onChange={event=>onChange(event.target.value)}><option value="">선택해 주세요</option>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
  const tabs=[{id:'configuration',label:'학교 구성'},{id:'memberships',label:'교사 소속'},{id:'assignments',label:'공식 담당'}] as const
  const noRead=Boolean(readError||!ready?.available||!enabled)
  const disabled=locked||noRead||loading
  return <section ref={panel} className="school-setup school-admin" aria-labelledby={`${uid}-heading`}><style>{styles}</style><style>{adminStyles}</style>
    <header className="setup-header"><div><p className="setup-eyebrow">학교 운영</p><h1 id={`${uid}-heading`} data-admin-focus="heading" tabIndex={-1}>학교 관리</h1><p>학교 구성과 소속·공식 담당을 함께 관리합니다.</p></div>{snapshot&&<span className="setup-badge">{snapshot.configuration.schoolYear}학년도</span>}</header>
    {loading&&<p role="status" className="setup-notice">학교 관리 정보를 확인하고 있습니다. 작성 중인 입력은 유지합니다.</p>}
    {readError&&<div role="alert" className="setup-error"><p>{readError}</p><button type="button" className="setup-button" disabled={loading||busy} onClick={()=>setReload(value=>value+1)}>연결 다시 확인</button></div>}
    {ready&&!ready.available&&<div className="setup-scope" role="status"><strong>{ready.reason==='forbidden'?'학교 관리 권한을 확인해 주세요':'학교 관리 연결 준비가 필요합니다'}</strong><span>서버 기능과 관리자 배정이 준비되면 실제 학교 정보를 조회하고 반영할 수 있습니다.</span><button type="button" className="setup-button" disabled={loading} onClick={()=>setReload(value=>value+1)}>준비 상태 다시 확인</button></div>}
    {notice&&<p className="setup-notice" role="status" tabIndex={-1} data-admin-focus="notice">{notice}</p>}
    {error&&<p className="setup-error" role="alert" tabIndex={-1} data-admin-focus="error">{error}</p>}
    {recovery.request&&!session.pending&&<p className="setup-error" role="alert">보관된 요청을 현재 화면에서 복원하지 못했습니다. 요청 번호를 유지하고 관리자에게 확인해 주세요. 새 요청을 보내거나 입력을 버리지 않습니다.</p>}
    {session.pending&&<div className="setup-scope"><strong>처리 결과 확인이 필요합니다</strong><span>입력과 요청 번호 {session.pending.key}를 보관했습니다. 새로고침하거나 다른 내용으로 다시 보내지 말고 같은 요청으로 확인해 주세요.</span><button type="button" className="setup-primary" disabled={busy||noRead} onClick={()=>void submit(true)}>{busy?'확인 중…':'같은 요청으로 결과 확인'}</button></div>}
    {snapshot&&!noRead&&<>
      <div className="school-admin-toolbar"><label>학년도 <select aria-label="조회 학년도" value={year??Number(snapshot.configuration.schoolYear)} disabled={disabled} onChange={event=>{setYear(Number(event.target.value));setSearch('');setPage(0)}}>{snapshot.availableYears.map(value=><option key={value} value={value}>{value}학년도</option>)}</select></label><button type="button" className="setup-button" disabled={busy||loading} onClick={()=>setReload(value=>value+1)}>최신 자료 확인</button><span>기준일 {snapshot.asOfDate}</span></div>
      <nav className="school-admin-tabs" aria-label="학교 관리 항목">{tabs.map(item=><button type="button" key={item.id} aria-current={tab===item.id?'page':undefined} disabled={locked} onClick={()=>{setTab(item.id);setSearch('');setPage(0)}}>{item.label}</button>)}</nav>
      {!command&&tab==='configuration'&&<section className="setup-section"><header><h2>학교 구성</h2>{snapshot.capabilities.configuration&&<div className="school-admin-actions"><button type="button" className="setup-button" disabled={disabled} onClick={()=>editConfiguration()}>구성 수정</button><button type="button" className="setup-button" disabled={disabled} onClick={()=>editConfiguration(true)}>새 학년도 준비</button></div>}</header><dl className="setup-summary"><div><dt>학교</dt><dd>{snapshot.configuration.schoolName}</dd></div><div><dt>학년도</dt><dd>{snapshot.configuration.startsOn} ~ {snapshot.configuration.lastDay}</dd></div><div><dt>운영 구성</dt><dd>학기 {snapshot.configuration.terms.length}개 · 부서 {snapshot.configuration.departments.length}개 · 학급 {snapshot.configuration.classes.length}개 · 교과 {snapshot.subjects.length}개</dd></div></dl><div className="school-admin-summary-groups">{snapshot.configuration.terms.map(term=><p key={term.id}><strong>{term.name}</strong> {term.startsOn} ~ {term.lastDay}</p>)}<p>부서: {snapshot.configuration.departments.map(row=>row.name).join(' · ')||'없음'}</p><p>교과: {snapshot.subjects.map(row=>row.name).join(' · ')||'없음'}</p></div><p className="setup-file-help">새 학년도는 구성 초안만 복사합니다. 교사 담당·학생·제출 자료는 자동으로 옮기지 않습니다.</p></section>}
      {!command&&tab!=='configuration'&&<><div className="school-admin-toolbar">{field('이름·상태 검색','search',search,value=>{setSearch(value);setPage(0)},'search')}{tab==='assignments'&&snapshot.capabilities.assignments&&<button type="button" className="setup-primary" disabled={disabled} onClick={addAssignment}>담당 배정</button>}</div>
        {tab==='memberships'?<><p>등록된 학교 소속 {snapshot.memberships.length}명 · 검색 결과 {filteredMembers.length}명</p><ul className="school-admin-list">{memberPage.items.map(target=><li key={target.id}><div><strong>{target.name}</strong><span>{SCHOOL_MEMBER_LABELS[target.status]} · {target.startsOn} ~ {target.lastDay}</span></div>{snapshot.capabilities.memberships&&target.id!==member.id&&<button type="button" className="setup-button" disabled={disabled} onClick={()=>editMember(target)} aria-label={`${target.name} 소속 관리`}>소속 관리</button>}</li>)}</ul>{!filteredMembers.length&&<p className="setup-empty">해당하는 교사 소속이 없습니다.</p>}<ListPagination label="교사 소속 목록 페이지" window={memberPage} disabled={disabled} onPageChange={setPage}/><p className="setup-file-help">학교 소속만 관리합니다. 기존 로그인 계정, 가입 승인, 최고관리자 권한을 생성하거나 변경하지 않습니다. 자신의 소속 변경은 다른 관리자에게 요청합니다.</p></>:<><p>공식 담당 {snapshot.assignments.length}건 · 검색 결과 {filteredAssignments.length}건</p><ul className="school-admin-list">{assignmentPage.items.map(target=><li key={target.id}><div><strong>{memberNames.get(target.memberId)} · {target.label}</strong><span>{target.startsOn} ~ {target.lastDay} · {target.status==='ended'?'종료일 확정':'배정 기록'}</span></div>{snapshot.capabilities.assignments&&target.status==='active'&&<button type="button" className="setup-button" disabled={disabled} onClick={()=>endAssignment(target)}>담당 종료</button>}</li>)}</ul>{!filteredAssignments.length&&<p className="setup-empty">해당하는 공식 담당이 없습니다.</p>}<ListPagination label="공식 담당 목록 페이지" window={assignmentPage} disabled={disabled} onPageChange={setPage}/></>}
      </>}
    </>}
    {command&&<section className="school-admin-editor" data-admin-focus="editor" tabIndex={-1} aria-labelledby={`${uid}-editor`}><header><h2 id={`${uid}-editor`}>{command.kind==='save_configuration'?(command.mode==='create_year'?'새 학년도 구성':'학교 구성 수정'):command.kind==='assign_duty'?'공식 담당 배정':command.kind==='end_assignment'?'담당 종료':'교사 소속 관리'}</h2><p>입력은 현재 탭에 보관하며, 변경 내용을 확인한 뒤 서버에 반영합니다.</p></header>
      <form onSubmit={event=>{event.preventDefault();review()}}>
        {command.kind==='save_configuration'&&<SchoolConfigurationEditor value={command.configuration} subjects={command.subjects} createYear={command.mode==='create_year'} disabled={!editable} onChange={(configuration,subjects)=>change({configuration,subjects})}/>}
        <fieldset className="setup-fields" disabled={!editable}><legend className="setup-sr-only">관리 변경 내용</legend><div className="setup-grid">
          {command.kind==='assign_duty'&&<>
            {selection('담당 교사','assignment-member',command.memberId,value=>change({memberId:value}),assignable.map(item=>({value:item.id,label:item.name})))}
            {selection('담당 유형','assignment-kind',command.assignmentKind,value=>change({assignmentKind:value as typeof command.assignmentKind,targetId:value==='duty'?null:'',label:''}),[...SCHOOL_ASSIGNMENT_KINDS])}
            {command.assignmentKind!=='duty'&&selection('담당 대상','assignment-target',command.targetId??'',value=>{const choices=command.assignmentKind==='homeroom'?snapshot?.configuration.classes:command.assignmentKind==='department'?snapshot?.configuration.departments:snapshot?.subjects;change({targetId:value,label:choices?.find(item=>item.id===value)?.name??''})},(command.assignmentKind==='homeroom'?snapshot?.configuration.classes:command.assignmentKind==='department'?snapshot?.configuration.departments:snapshot?.subjects)?.map(item=>({value:item.id,label:item.name}))??[])}
            {field('담당 이름','assignment-label',command.label,value=>change({label:value}),'text',SCHOOL_ADMIN_LIMITS.dutyLabelLength)}
          </>}
          {command.kind==='review_membership'&&<><p>대상: <strong>{snapshot?.memberships.find(item=>item.id===command.targetMemberId)?.name??session.base?.memberships.find(item=>item.id===command.targetMemberId)?.name}</strong></p>{selection('변경할 소속 상태','member-decision',command.decision,value=>change({decision:value as typeof command.decision}),(['active','suspended','ended','rejected'] as const).map(value=>({value,label:SCHOOL_MEMBER_LABELS[value]})))}</>}
          {command.kind==='end_assignment'&&<p>대상: <strong>{session.base?.assignments.find(item=>item.id===command.assignmentId)?.label}</strong></p>}
          {(command.kind==='assign_duty'||command.kind==='review_membership')&&field(command.kind==='review_membership'?'소속 시작일':'담당 시작일','startsOn',command.startsOn,value=>change({startsOn:value}),'date')}
          {command.kind!=='save_configuration'&&field('마지막 날 (포함)','lastDay',command.lastDay,value=>change({lastDay:value}),'date')}
        </div><div className="setup-field"><label htmlFor={`${uid}-reason`}>변경 사유</label><textarea id={`${uid}-reason`} value={command.reason} maxLength={SCHOOL_ADMIN_LIMITS.reasonLength} onChange={event=>change({reason:event.target.value})} rows={3}/></div></fieldset>
        {issues.length>0&&<div className="setup-error" role="alert" tabIndex={-1} data-admin-focus="issues"><strong>입력 내용을 확인해 주세요</strong><ul>{issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
        {!session.reviewing&&!session.conflict&&!session.pending&&<div className="school-admin-actions"><button type="button" className="setup-button" disabled={busy} onClick={cancel}>입력 취소</button><button type="submit" className="setup-primary" disabled={!editable||loading}>변경 내용 검토</button></div>}
      </form>
      {session.reviewing&&<div className="setup-review" tabIndex={-1} data-admin-focus="review"><h3>반영할 내용을 확인해 주세요</h3><SchoolAdminReview command={command} base={session.base}/>{command.kind==='review_membership'&&<p>소속 상태는 반영 시점에 바뀝니다. 입력한 기간은 해당 교사의 학교 소속 기간이며, 로그인 계정과 기존 가입 승인은 변경하지 않습니다.</p>}<p><strong>변경 사유:</strong> {command.reason}</p><div className="school-admin-actions"><button type="button" className="setup-button" disabled={busy||!!session.pending} onClick={()=>{update({...session,reviewing:false});move('editor')}}>입력으로 돌아가기</button><button type="button" className="setup-primary" disabled={busy||!!session.pending||noRead||loading} onClick={()=>void submit()}>{busy?'반영 중…':'확인한 내용 반영'}</button></div></div>}
      {session.conflict&&<div className="setup-review" tabIndex={-1} data-admin-focus="conflict"><h3>최신 자료와 내 입력 비교</h3><p>다른 항목의 변경은 함께 보존합니다. 같은 항목을 양쪽에서 바꾼 경우 유지할 내용을 선택해 주세요.</p>
        {configMerge&&<><p>선택할 충돌 {configMerge.unresolved.length}개</p>{configMerge.conflicts.map(conflict=><fieldset className="school-admin-conflict" key={conflict.path}><legend>{conflict.label}</legend><p>편집 전: {pretty(conflict.original)}</p><label><input type="radio" name={`${uid}-${conflict.path}`} checked={session.choices?.[conflict.path]==='mine'} onChange={()=>update({...session,choices:{...session.choices,[conflict.path]:'mine'}})}/> 내 입력: {pretty(conflict.mine)}</label><label><input type="radio" name={`${uid}-${conflict.path}`} checked={session.choices?.[conflict.path]==='latest'} onChange={()=>update({...session,choices:{...session.choices,[conflict.path]:'latest'}})}/> 최신 자료: {pretty(conflict.latest)}</label></fieldset>)}</>}
        {!configMerge&&<><h4>내가 요청한 변경</h4><SchoolAdminReview command={command} base={session.base}/><h4>현재 서버의 상태</h4><SchoolAdminReview command={command} base={snapshot} current/></>}
        <div className="school-admin-actions"><button type="button" className="setup-button" disabled={busy||!!session.pending} onClick={cancel}>입력 취소</button><button type="button" className="setup-primary" disabled={loading||busy||noRead||Boolean(configMerge?.unresolved.length)} onClick={resolveConflict}>선택한 내용으로 다시 편집</button></div>
      </div>}
    </section>}
  </section>
}
export function SchoolAdminReview({command,base,current=false}:{command:SchoolAdminCommand;base?:SchoolAdminSnapshot;current?:boolean}) {
  if(!base)return <p>비교할 원본을 조회해야 합니다.</p>
  if(command.kind==='save_configuration') {
    if(current)return <dl className="setup-summary"><div><dt>학년도 목록</dt><dd>{base.availableYears.join(', ')}</dd></div><div><dt>학교</dt><dd>{base.configuration.schoolName} · {base.configuration.schoolType} · {base.configuration.gradeCount}학년</dd></div></dl>
    const changes=schoolConfigurationChanges(schoolConfigurationValue(base),{configuration:command.configuration,subjects:command.subjects})
    return <><p>{command.mode==='create_year'?'새 학년도를 만듭니다. 기존 학년도 자료는 보존합니다.':'변경된 항목 전체입니다. 표시되지 않은 기존 입력은 그대로 유지합니다.'}</p>{!changes.length?<p>구성 값의 변경이 없습니다.</p>:<ul className="school-admin-changes">{changes.map((change,index)=><li key={index}><strong>{change.label}</strong><span>이전: {change.before}</span><span>변경: {change.after}</span></li>)}</ul>}</>
  }
  if(command.kind==='review_membership') {
    const target=base.memberships.find(item=>item.id===command.targetMemberId)
    return <dl className="setup-summary"><div><dt>교사</dt><dd>{target?.name??'현재 조회되지 않는 소속'}</dd></div><div><dt>소속 상태</dt><dd>{current?(target?SCHOOL_MEMBER_LABELS[target.status]:'확인 필요'):`${target?SCHOOL_MEMBER_LABELS[target.status]:'확인 필요'} → ${SCHOOL_MEMBER_LABELS[command.decision]}`}</dd></div><div><dt>{current?'현재 소속 기간':'기존 소속 기간'}</dt><dd>{target?.startsOn} ~ {target?.lastDay}</dd></div>{!current&&<div><dt>변경할 소속 기간</dt><dd>{command.startsOn} ~ {command.lastDay}</dd></div>}</dl>
  }
  if(command.kind==='end_assignment') {
    const target=base.assignments.find(item=>item.id===command.assignmentId)
    return <dl className="setup-summary"><div><dt>담당</dt><dd>{target?.label??'현재 조회되지 않는 담당'}</dd></div><div><dt>교사</dt><dd>{base.memberships.find(item=>item.id===target?.memberId)?.name??'확인 필요'}</dd></div><div><dt>기존 기간</dt><dd>{target?.startsOn} ~ {target?.lastDay}</dd></div><div><dt>{current?'상태':'변경할 마지막 날'}</dt><dd>{current?target?.status:command.lastDay}</dd></div></dl>
  }
  return <dl className="setup-summary"><div><dt>교사</dt><dd>{base.memberships.find(item=>item.id===command.memberId)?.name??'현재 조회되지 않는 소속'}</dd></div><div><dt>담당</dt><dd>{SCHOOL_ASSIGNMENT_KINDS.find(item=>item.value===command.assignmentKind)?.label} · {command.label}</dd></div><div><dt>기간</dt><dd>{command.startsOn} ~ {command.lastDay}</dd></div>{current&&<div><dt>현재 배정</dt><dd>{base.assignments.filter(item=>item.memberId===command.memberId).map(item=>`${item.label} (${item.startsOn} ~ ${item.lastDay})`).join(' / ')||'없음'}</dd></div>}</dl>
}
