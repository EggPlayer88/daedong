import { ContractError, type CalendarEvent, type Membership, type School } from '../contracts'
import { normalizeDraft } from '../domain'
import type { ConnectionContext, LegacyProfile, RelationLabels } from './contracts'

const bad = (): never => { throw new ContractError('QUERY_FAILED', '서버 응답 형식을 확인할 수 없습니다. 다시 연결해 주세요.') }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad()
const str = (value: unknown, max = 200): string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= max ? value : bad()
const strings = (value: unknown): string[] => Array.isArray(value) && value.length <= 1000 && value.every(item => typeof item === 'string' && item.length <= 200) ? value as string[] : bad()
const date = (value: unknown): string => {
  const text = str(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + 'T00:00:00Z')) || new Date(text + 'T00:00:00Z').toISOString().slice(0,10) !== text) bad()
  return text
}
function labels(value: unknown): RelationLabels {
  const row = record(value)
  const dimension = (items: unknown) => {
    if (!Array.isArray(items) || items.length > 1000) return bad()
    const parsed = items.map(item => { const label=record(item); return {id:str(label.id),name:str(label.name,100)} })
    if (new Set(parsed.map(item=>item.id)).size !== parsed.length) bad()
    return parsed
  }
  return { departmentIds: dimension(row.departmentIds), gradeIds: dimension(row.gradeIds), subjectIds: dimension(row.subjectIds) }
}
export function profileResponse(value: unknown, userId: string): LegacyProfile | null {
  if (value === null) return null
  const row=record(value)
  if (row.id !== userId || typeof row.is_active !== 'boolean') return bad()
  return { id:userId, name:str(row.name,200), email:str(row.email,500), role:str(row.role,100), extra_permissions:strings(row.extra_permissions), department_id:row.department_id === null ? null : str(row.department_id), is_active:row.is_active }
}
export function contextResponse(value: unknown, selectedSchool?: string): ConnectionContext {
  const raw=record(value)
  if (!Array.isArray(raw.schools) || !Array.isArray(raw.memberships)) return bad()
  const schools:School[]=raw.schools.map(item=>{ const row=record(item);return{id:str(row.id),name:str(row.name,100)} })
  const schoolIds=new Set(schools.map(school=>school.id))
  if(schoolIds.size!==schools.length) return bad()
  const memberships:Membership[]=raw.memberships.map(item=>{
    const m=record(item)
    if (!schoolIds.has(str(m.schoolId)) || !['teacher','calendar_manager'].includes(str(m.role)) || typeof m.active!=='boolean') return bad()
    const validFrom=date(m.validFrom),validThrough=date(m.validThrough)
    if(validFrom>validThrough) return bad()
    return {id:str(m.id),schoolId:m.schoolId as string,userId:str(m.userId),name:str(m.name,200),role:m.role as Membership['role'],active:m.active,validFrom,validThrough,departmentIds:strings(m.departmentIds),gradeIds:strings(m.gradeIds),subjectIds:strings(m.subjectIds)}
  })
  if(new Set(memberships.map(m=>m.id)).size!==memberships.length) return bad()
  const rawLabels=record(raw.schoolLabels)
  const schoolLabels:Record<string,RelationLabels>={}
  for(const school of schools) schoolLabels[school.id]=labels(rawLabels[school.id])
  if(Object.keys(rawLabels).some(id=>!schoolIds.has(id))) return bad()
  const selected=selectedSchool??schools[0]?.id
  if(selectedSchool&&!schoolIds.has(selectedSchool)) throw new ContractError('FORBIDDEN','이 학교에 연결할 수 없습니다.')
  return {schools,memberships,basisDate:date(raw.basisDate),schoolLabels,relationLabels:selected?schoolLabels[selected]:{departmentIds:[],gradeIds:[],subjectIds:[]}}
}
export function eventResponse(value: unknown, schoolId: string, members: Membership[]): CalendarEvent {
  const raw=record(value)
  if(raw.schoolId!==schoolId || !Number.isSafeInteger(raw.version) || (raw.version as number)<1) return bad()
  const author=members.find(m=>m.id===raw.authorMemberId&&m.schoolId===schoolId)
  if(!author) return bad()
  const updatedAt=str(raw.updatedAt,60)
  if(Number.isNaN(Date.parse(updatedAt))) return bad()
  try {
    const normalized=normalizeDraft(raw as unknown as CalendarEvent,author,members)
    return {...normalized,id:str(raw.id),schoolId,authorMemberId:author.id,version:raw.version as number,updatedAt}
  } catch { return bad() }
}
