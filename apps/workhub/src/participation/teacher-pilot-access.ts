import { ServiceError } from '../services/service-values'
import { enabledModules, type PageId } from '../modules'
import type { SearchSource, SearchKind, SearchItem } from '../search/contracts'

export interface TeacherPilotAccess {
  contract: 'workhub.teacher-pilot.v1'; allowed: true; userId: string; schoolId: string; memberId: string
  batchId: string; teacherId: string; expiresAt: string; revision: number
}
type Actor = Pick<TeacherPilotAccess, 'userId' | 'schoolId' | 'memberId'>
const identifiers = ['userId', 'schoolId', 'memberId', 'batchId', 'teacherId'] as const
const keys = ['contract', 'allowed', ...identifiers, 'expiresAt', 'revision'].sort().join(',')
// OP1 업무 범위와 별도인 TP1 명시 허용이다. schoolAdmin 주소는 기존 OP1과 같이 인계 전용으로 렌더한다.
// 학교 관리·키 관리·문서 제작 권한은 추가하지 않는다.
export const teacherPilotPages: readonly PageId[] = ['assistant', 'tasks', 'calendar', 'messages', 'collections', 'cooperation', 'students', 'timetable', 'schoolAdmin']
export const teacherPilotModules = () => enabledModules('connected').filter(module => teacherPilotPages.includes(module.id)).map(module => module.id === 'schoolAdmin' ? { ...module, title: '업무 인계' } : module)
export function teacherPilotAccess(value: unknown, actor: Actor, now = Date.now()): TeacherPilotAccess | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_RESPONSE')
  const v = value as Record<string, unknown>
  const invalid = () => { throw new ServiceError('INVALID_RESPONSE') }
  if (v.contract !== 'workhub.teacher-pilot.v1' || v.userId !== actor.userId) return invalid()
  if (v.allowed === false && Object.keys(v).sort().join(',') === 'allowed,contract,userId') return null
  if (Object.keys(v).sort().join(',') !== keys || v.allowed !== true ||
      identifiers.some(key => typeof v[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v[key] as string)) ||
      v.schoolId !== actor.schoolId || v.memberId !== actor.memberId || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 ||
      typeof v.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v.expiresAt) || !Number.isFinite(Date.parse(v.expiresAt)) || new Date(v.expiresAt).toISOString().slice(0,19) !== v.expiresAt.slice(0,19)) return invalid()
  if (Date.parse(v.expiresAt as string) <= now) return null
  return { ...v } as unknown as TeacherPilotAccess
}
export function sameTeacherPilot(a: TeacherPilotAccess, b: TeacherPilotAccess | null): boolean {
  return Boolean(b && Object.keys(a).every(key => a[key as keyof TeacherPilotAccess] === b[key as keyof TeacherPilotAccess]))
}
const sourcePages: Record<SearchKind, PageId | null> = { menu: null, calendar: 'calendar', task: 'tasks', message: 'messages', collection: 'collections', cooperation: 'cooperation', course: 'students', document: 'documents', knowledge: 'knowledge' }
export function teacherPilotSearchSources(sources: SearchSource[]): SearchSource[] {
  return sources.filter(source => source.kind === 'menu' || teacherPilotPages.includes(sourcePages[source.kind]!)).map(source => source.kind !== 'menu' ? source : {
    ...source, async load(options) {
      const value = await source.load(options)
      const allowed = (item: { id: string }) => teacherPilotPages.includes(item.id as PageId)
      const label = (item: SearchItem) => item.id === 'schoolAdmin' ? { ...item, title: '업무 인계', description: '내가 참여하는 업무 인계 요청과 인수 확인', searchValues: ['업무 인계', '인수 확인'] } : item
      return Array.isArray(value) ? value.filter(allowed).map(label) : { ...value, items: value.items.filter(allowed).map(label) }
    },
  })
}
