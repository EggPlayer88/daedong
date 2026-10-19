import type { SetupDraft } from './contract'
import type { SchoolAdminSnapshot, SchoolSubject } from './school-admin-contract'
export interface SchoolConfigurationValue { configuration: SetupDraft; subjects: SchoolSubject[] }
export interface SchoolConfigurationConflict { path: string; label: string; original: unknown; mine: unknown; latest: unknown }
export type SchoolConflictChoices = Record<string, 'mine' | 'latest'>
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const fields: Record<string,string> = {schoolName:'학교명',schoolCode:'학교 코드',schoolType:'학교급',gradeCount:'학년 수',schoolYear:'학년도',startsOn:'시작일',lastDay:'마지막 날',name:'이름',termNo:'학기 번호',grade:'학년',classNo:'반 번호',kind:'학급 유형'}
const groups = {terms:'학기',departments:'부서',classes:'학급',subjects:'교과'} as const
export function schoolConfigurationValue(snapshot: SchoolAdminSnapshot): SchoolConfigurationValue { return structuredClone({configuration:snapshot.configuration,subjects:snapshot.subjects}) }
// 서로 다른 항목의 변경은 합치되 같은 항목의 변경·삭제 충돌은 사용자의 선택 전까지 확정하지 않는다.
export function reconcileSchoolConfiguration(base: SchoolConfigurationValue, mine: SchoolConfigurationValue, latest: SchoolConfigurationValue, choices: SchoolConflictChoices = {}) {
  const conflicts: SchoolConfigurationConflict[] = [], unresolved: SchoolConfigurationConflict[] = []
  function merge(path: string,label: string,original: unknown,local: unknown,remote: unknown): unknown {
    if(same(local,original)) return structuredClone(remote)
    if(same(remote,original)||same(local,remote)) return structuredClone(local)
    const conflict={path,label,original:original??null,mine:local??null,latest:remote??null};conflicts.push(conflict)
    if(!choices[path]) unresolved.push(conflict)
    return structuredClone(choices[path]==='latest'?remote:local)
  }
  const config=structuredClone(latest.configuration)
  for(const key of ['schoolName','schoolCode','schoolType','gradeCount','schoolYear','startsOn','lastDay'] as const) config[key]=merge(key,fields[key],base.configuration[key],mine.configuration[key],latest.configuration[key]) as string
  let subjects: SchoolSubject[]=[]
  for(const [group,label] of Object.entries(groups)) {
    const get=(value:SchoolConfigurationValue)=>(group==='subjects'?value.subjects:value.configuration[group as 'terms'|'departments'|'classes']) as unknown as Record<string,string>[]
    const old=new Map(get(base).map(row=>[row.id,row])),local=new Map(get(mine).map(row=>[row.id,row])),remote=new Map(get(latest).map(row=>[row.id,row]))
    const ids=[...new Set([...remote.keys(),...local.keys(),...old.keys()])], result:Record<string,string>[]=[]
    for(const id of ids) {
      const a=old.get(id),b=local.get(id),c=remote.get(id),rowName=`${label} · ${(b??c??a)?.name??id}`
      if(a&&b&&c) {
        const row:Record<string,string>={id}
        for(const key of Object.keys(c).filter(key=>key!=='id')) row[key]=merge(`${group}.${id}.${key}`,`${rowName} / ${fields[key]??key}`,a[key],b[key],c[key]) as string
        result.push(row)
      } else {
        const row=merge(`${group}.${id}`,rowName,a,b,c) as Record<string,string>|undefined
        if(row) result.push(row)
      }
    }
    if(group==='subjects') subjects=result as unknown as SchoolSubject[]
    else Object.assign(config,{[group]:result})
  }
  return {value:{configuration:config,subjects},conflicts,unresolved}
}
export function schoolConfigurationChanges(before: SchoolConfigurationValue,after: SchoolConfigurationValue): {label:string;before:string;after:string}[] {
  const changes:{label:string;before:string;after:string}[]=[]
  const show=(value:unknown):string=>value===undefined?'없음':typeof value==='string'?value||'비어 있음':JSON.stringify(value)
  for(const key of ['schoolName','schoolCode','schoolType','gradeCount','schoolYear','startsOn','lastDay'] as const) if(!same(before.configuration[key],after.configuration[key])) changes.push({label:fields[key],before:show(before.configuration[key]),after:show(after.configuration[key])})
  for(const [group,label] of Object.entries(groups)) {
    const get=(value:SchoolConfigurationValue)=>(group==='subjects'?value.subjects:value.configuration[group as 'terms'|'departments'|'classes']) as unknown as Record<string,string>[]
    const old=new Map(get(before).map(row=>[row.id,row])),next=new Map(get(after).map(row=>[row.id,row]))
    for(const id of new Set([...old.keys(),...next.keys()])) {
      const a=old.get(id),b=next.get(id)
      if(!same(a,b)) changes.push({label:`${label} · ${(b??a)?.name??id}`,before:a?Object.entries(a).filter(([key])=>key!=='id').map(([key,v])=>`${fields[key]??key}: ${v||'비어 있음'}`).join(' / '):'없음',after:b?Object.entries(b).filter(([key])=>key!=='id').map(([key,v])=>`${fields[key]??key}: ${v||'비어 있음'}`).join(' / '):'없음'})
    }
  }
  return changes
}
