import { useId, useRef, useState } from 'react'
import { CLASS_KINDS, SCHOOL_TYPES, SETUP_LIMITS, setupGradeLimit, newSetupRowId, type SetupDraft } from './contract'
import { SCHOOL_ADMIN_LIMITS, type SchoolSubject } from './school-admin-contract'
import { ListPagination } from '../app/ListPagination'
import { LIST_PAGE_SIZE, listWindow } from '../app/list-window'
import { SchoolConfigurationBatchPanel, type SchoolConfigurationBatchPanelProps } from './SchoolConfigurationBatchPanel'
export interface SchoolConfigurationEditorProps { value: SetupDraft; subjects: SchoolSubject[]; createYear: boolean; disabled: boolean; onChange: (value: SetupDraft,subjects:SchoolSubject[])=>void; batch?:Omit<SchoolConfigurationBatchPanelProps,'value'|'disabled'> }
// 행 식별자를 편집 과정 전체에서 보존한다. 이름 변경을 삭제·재생성으로 처리하지 않는다.
export function SchoolConfigurationEditor({value,subjects,createYear,disabled,onChange,batch}:SchoolConfigurationEditorProps) {
  const uid=useId(), [pages,setPages]=useState<Record<string,number>>({}), panel=useRef<HTMLFieldSetElement>(null)
  function jump(group:string) { const heading=panel.current?.querySelector<HTMLElement>(`[data-configuration-section="${group}"]`);heading?.focus();heading?.scrollIntoView({block:'start'}) }
  const change=(key:string,next:string)=>onChange({...value,[key]:next},subjects)
  const input=(label:string,key:string,val:string,edit:(text:string)=>void,type='text',maxLength?:number,readOnly=false)=><label className="setup-field" key={key} htmlFor={`${uid}-${key}`}><span>{label}</span><input aria-label={label} id={`${uid}-${key}`} value={val} onChange={event=>edit(event.target.value)} type={type} maxLength={maxLength} readOnly={readOnly}/></label>
  const select=(label:string,key:string,val:string,edit:(text:string)=>void,options:readonly {value:string;label:string}[])=><label className="setup-field" key={key} htmlFor={`${uid}-${key}`}><span>{label}</span><select aria-label={label} id={`${uid}-${key}`} value={val} onChange={event=>edit(event.target.value)}><option value="">선택해 주세요</option>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  function updateRow(group:'terms'|'departments'|'classes'|'subjects',id:string,key:string,next:string) {
    if(group==='subjects') onChange(value,subjects.map(row=>row.id===id?{...row,[key]:next}:row))
    else onChange({...value,[group]:value[group].map(row=>row.id===id?{...row,[key]:next}:row)},subjects)
  }
  function remove(group:'terms'|'departments'|'classes'|'subjects',id:string) {
    if(group==='subjects') onChange(value,subjects.filter(row=>row.id!==id))
    else onChange({...value,[group]:value[group].filter(row=>row.id!==id)},subjects)
  }
  function add(group:'terms'|'departments'|'classes'|'subjects') {
    const id=newSetupRowId()
    if(group==='subjects') onChange(value,[...subjects,{id,name:''}])
    else if(group==='terms') onChange({...value,terms:[...value.terms,{id,termNo:'',name:'',startsOn:'',lastDay:''}]},subjects)
    else if(group==='departments') onChange({...value,departments:[...value.departments,{id,name:''}]},subjects)
    else onChange({...value,classes:[...value.classes,{id,grade:'',classNo:'',name:'',kind:'regular'}]},subjects)
    const count=group==='subjects'?subjects.length:value[group].length
    setPages(current=>({...current,[group]:Math.floor(count/LIST_PAGE_SIZE)}))
  }
  return <fieldset ref={panel} className="setup-fields school-configuration-editor" disabled={disabled}><legend className="setup-sr-only">학교 운영 구성 입력</legend>
    <nav className="school-configuration-jumps" aria-label="구성 입력 바로가기">{([{key:'school',label:'학교·학년도',count:null},{key:'terms',label:'학기',count:value.terms.length},{key:'classes',label:'학급',count:value.classes.length},{key:'subjects',label:'교과',count:subjects.length},{key:'departments',label:'부서',count:value.departments.length}] as const).map(item=><button type="button" className="setup-button" key={item.key} onClick={()=>jump(item.key)}>{item.label}{item.count!==null&&<span> {item.count}</span>} 입력으로 이동</button>)}</nav>
    {batch&&<SchoolConfigurationBatchPanel {...batch} value={{configuration:value,subjects}} disabled={disabled}/>}
    <section className="setup-section"><h3 tabIndex={-1} data-configuration-section="school">학교와 학년도</h3><div className="setup-grid">
      {input('학교명','schoolName',value.schoolName,v=>change('schoolName',v),'text',SETUP_LIMITS.schoolName)}
      {input('학교 코드','schoolCode',value.schoolCode,v=>change('schoolCode',v),'text',SETUP_LIMITS.schoolCode,true)}
      {select('학교급','schoolType',value.schoolType,v=>change('schoolType',v),SCHOOL_TYPES)}
      {input(`운영 학년 수 (1~${setupGradeLimit(value.schoolType)})`,'gradeCount',value.gradeCount,v=>change('gradeCount',v),'text',2)}
      {input('학년도','schoolYear',value.schoolYear,v=>change('schoolYear',v),'text',4,!createYear)}
      {input('학년도 시작일','startsOn',value.startsOn,v=>change('startsOn',v),'date')}
      {input('학년도 마지막 날 (포함)','lastDay',value.lastDay,v=>change('lastDay',v),'date')}
    </div><p>공식 날짜를 확인해 입력해 주세요. 마지막 날을 포함합니다. 특수·기타 학교의 학년 수는 실제 운영 체계를 따릅니다.</p>{createYear&&<p>학년도 숫자와 시작일의 연도를 맞춰 주세요. 마지막 날은 다음 해여도 됩니다.</p>}</section>
    {(['terms','classes','subjects','departments'] as const).map(group=>{
      const labels={terms:'학기',departments:'부서',classes:'학급',subjects:'교과'},label=labels[group]
      const all=(group==='subjects'?subjects:value[group]) as unknown as Record<string,string>[], page=listWindow(all,pages[group]??0)
      const max=group==='subjects'?SCHOOL_ADMIN_LIMITS.subjects:SETUP_LIMITS[group]
      return <section className="setup-section" key={group}><header><h3 tabIndex={-1} data-configuration-section={group}>{label} · {all.length}개</h3><button type="button" className="setup-button" disabled={all.length>=max} onClick={()=>add(group)}>{label} 추가</button></header>
        {!all.length&&<p className="setup-empty">등록된 {label} 항목이 없습니다.</p>}
        <div className="setup-row-list">{page.items.map(row=><fieldset className="setup-row" key={row.id}><legend>{row.name||`새 ${label}`}</legend><div className="setup-grid">
          {group==='terms'&&input('학기 번호',`${row.id}-termNo`,row.termNo,v=>updateRow(group,row.id,'termNo',v),'text',1)}
          {group==='classes'&&input('학년',`${row.id}-grade`,row.grade,v=>updateRow(group,row.id,'grade',v),'text',2)}
          {group==='classes'&&input('반 번호 (선택)',`${row.id}-classNo`,row.classNo,v=>updateRow(group,row.id,'classNo',v),'text',2)}
          {input(`${label} 이름`,`${row.id}-name`,row.name,v=>updateRow(group,row.id,'name',v),'text',group==='classes'?SETUP_LIMITS.className:50)}
          {group==='classes'&&select('학급 유형',`${row.id}-kind`,row.kind,v=>updateRow(group,row.id,'kind',v),CLASS_KINDS)}
          {group==='terms'&&input('학기 시작일',`${row.id}-startsOn`,row.startsOn,v=>updateRow(group,row.id,'startsOn',v),'date')}
          {group==='terms'&&input('학기 마지막 날 (포함)',`${row.id}-lastDay`,row.lastDay,v=>updateRow(group,row.id,'lastDay',v),'date')}
        </div><button type="button" className="setup-remove" aria-label={`${row.name||label} 구성에서 제외`} onClick={()=>remove(group,row.id)}>구성에서 제외</button></fieldset>)}</div>
        <ListPagination label={`${label} 구성 페이지`} window={page} disabled={disabled} onPageChange={page=>setPages(current=>({...current,[group]:page}))}/>
      </section>
    })}
    <p className="setup-file-help">이미 담당·학생·자료가 연결된 항목은 서버가 제외를 거부합니다. 기록을 지우지 않고 담당 변경이나 학년도 전환 절차를 사용합니다.</p>
  </fieldset>
}
