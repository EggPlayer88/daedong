import type { CalendarEvent, Membership } from '../contracts'
import { createVerifiedTransport, envelope, exact, id, integer, invalid, object, timestamp, type Scope } from '../cooperation/protocol'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { eventResponse } from './event-response'

export const CALENDAR_LIFECYCLE_CONTRACT = 'calendar.lifecycle.v1'
export interface CalendarCancelCommand { eventId: string; expectedVersion: number; reason: string }
export interface CalendarCancelReceipt { event: CalendarEvent; recordedAt: string; requestKey: string }
export interface CalendarLifecycleAdapter {
  listCancelled(memberId: string): Promise<CalendarEvent[]>
  cancel(memberId: string, command: CalendarCancelCommand, key: string): Promise<CalendarCancelReceipt>
  recoverCancel(memberId: string, command: CalendarCancelCommand, key: string): Promise<CalendarCancelReceipt>
}

export function cancelCommand(value: unknown): CalendarCancelCommand {
  const v = object(value)
  exact(v, ['eventId', 'expectedVersion', 'reason'])
  if (typeof v.reason !== 'string' || !v.reason.trim() || [...v.reason].length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v.reason))
    return invalid('취소 사유를 1~500자로 입력해 주세요.')
  return {eventId:id(v.eventId),expectedVersion:integer(v.expectedVersion),reason:v.reason.trim()}
}

export function cancelReceipt(raw: unknown, scope: Scope, command: CalendarCancelCommand, key: string, members: Membership[]): CalendarCancelReceipt {
  const v = envelope(raw, scope, CALENDAR_LIFECYCLE_CONTRACT)
  const event = eventResponse(v.event, scope.schoolId, members)
  const recordedAt = timestamp(v.recordedAt)
  if (v.requestKey !== key || event.id !== command.eventId || event.version !== command.expectedVersion + 1 || event.status !== 'cancelled' ||
      event.cancelReason !== command.reason || !event.cancelledAt || Date.parse(event.cancelledAt) > Date.parse(recordedAt)) return invalid('취소 접수 결과와 원래 요청이 일치하지 않습니다.')
  return {event,recordedAt,requestKey:key}
}

export function createCalendarLifecycleAdapter(connection: SupabaseConnection, timeoutMs?: number): CalendarLifecycleAdapter {
  const transport = createVerifiedTransport(connection, CALENDAR_LIFECYCLE_CONTRACT, timeoutMs)
  async function send(memberId: string, input: CalendarCancelCommand, key: string, recoverOnly: boolean) {
    const command = cancelCommand(input)
    await transport.remember(memberId, key, command)
    return transport.call(memberId, 'workhub_calendar_cancel', {p_command:command,p_request_key:key,p_recover_only:recoverOnly},
      (raw, scope) => cancelReceipt(raw, scope, command, key, connection.info().memberships), true)
  }
  return {
    listCancelled: memberId => transport.call(memberId, 'workhub_calendar_cancelled_list', {}, (raw, scope) => {
      if (!Array.isArray(raw) || raw.length > 20000) return invalid('취소한 일정 목록을 확인하지 못했습니다.')
      const rows = raw.map(value => eventResponse(value, scope.schoolId, connection.info().memberships))
      if (rows.some(event => event.status !== 'cancelled') || new Set(rows.map(event => event.id)).size !== rows.length) return invalid()
      return rows
    }),
    cancel: (memberId, command, key) => send(memberId, command, key, false),
    recoverCancel: (memberId, command, key) => send(memberId, command, key, true),
  }
}
