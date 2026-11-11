import { exact, isoDate, ServiceError } from '../services/service-values'
import { plan, type Plan } from './contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc } from '../services/scoped-rpc'
export type Published = { date: string; timeZone: string; available: boolean; plans: Plan[]; myTeacherIds: string[] }
export function published(v: unknown, date: string): Published {
  exact(v, ['date', 'timeZone', 'available', 'plans', 'myTeacherIds'])
  if (v.date !== date || typeof v.timeZone !== 'string' || typeof v.available !== 'boolean' || !Array.isArray(v.plans) || v.plans.length > 100 || !Array.isArray(v.myTeacherIds) || v.myTeacherIds.length > 300) throw new ServiceError('INVALID_RESPONSE')
  try { new Intl.DateTimeFormat('ko', { timeZone: v.timeZone }) } catch { throw new ServiceError('INVALID_RESPONSE') }
  const plans = v.plans.map(plan), myTeacherIds = v.myTeacherIds as string[]
  if (new Set(plans.map(p => p.id)).size !== plans.length || new Set(myTeacherIds).size !== myTeacherIds.length || plans.some(p => p.from > date || p.until <= date) || myTeacherIds.some(id => !plans.some(p => p.teachers.some(t => t.id === id))) || !v.available && (plans.length || myTeacherIds.length)) throw new ServiceError('INVALID_RESPONSE')
  return { date, timeZone: v.timeZone, available: v.available, plans, myTeacherIds }
}
export function createPublishedRosterServer(connection: SupabaseConnection) {
  const rpc = createScopedRpc(connection, 'teacher-roster.v1')
  return { get(memberId: string, date: string) { isoDate(date); return rpc.call(memberId, 'workhub_teacher_roster_published', { p_date: date }, v => published(v, date)) } }
}
