import { canonical, exact, identifier, isoDate, text, ServiceError } from '../services/service-values'
import { parseOperationLessonChange } from './operations-server'
import opLimits from './operations-api-limits.json'
import rosterLimits from '../teacher-roster/limits.json'
import type { OperationBlocker, OperationLessonChange } from './operations-contracts'
export const ROSTER_BRIDGE_CONTRACT = 'timetable-roster-bridge.v1'
export interface RosterOperatingInput { planId: string; planVersion: number; from: string; until: string }
export interface RosterOperatingChoice { id: string; version: number; title: string; from: string; until: string; teachers: number; classes: number; weeklyLessons: number }
export interface RosterOperatingPreview {
 id: string; hash: string; expiresAt: string; input: RosterOperatingInput; timeZone: string
 summary: { teachers: number; classes: number; weeklyLessons: number; changedLessons: number }
 blockers: OperationBlocker[]; changes: OperationLessonChange[]; excludedDays: { date: string; reason: string }[]
}
export interface RosterOperatingCommand { previewId: string; hash: string; input: RosterOperatingInput }
export interface RosterOperatingReceipt { requestKey: string; publicationId: string; changedLessons: number; recordedAt: string; planId: string; from: string; until: string }
export interface RosterOperatingServer {
 get(memberId: string): Promise<{ plans: RosterOperatingChoice[] }>
 preview(memberId: string, input: RosterOperatingInput): Promise<RosterOperatingPreview>
 commit(memberId: string, command: RosterOperatingCommand, key: string, recoverOnly: boolean): Promise<RosterOperatingReceipt>
 close(memberId: string, command: RosterOperatingCommand, key: string): Promise<{ outcome: 'applied'; receipt: RosterOperatingReceipt } | { outcome: 'closed'; receipt: null }>
}
const bad = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const count = (v: unknown, max = opLimits.changes) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : bad()
const positive = (v: unknown) => count(v, 2147483646) > 0 ? v as number : bad()
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : bad()
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : bad()
const at = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? v : bad()
export function rosterOperatingInput(v: unknown): RosterOperatingInput {
 exact(v, ['planId', 'planVersion', 'from', 'until'])
 const from = isoDate(v.from), until = isoDate(v.until)
 if (from >= until || (Date.parse(until) - Date.parse(from)) / 86400000 > opLimits.publishDays) bad()
 return { planId: identifier(v.planId), planVersion: positive(v.planVersion), from, until }
}
export function rosterOperatingChoices(v: unknown) {
 exact(v, ['plans'])
 const plans = list(v.plans, opLimits.drafts).map(p => {
  exact(p, ['id', 'version', 'title', 'from', 'until', 'teachers', 'classes', 'weeklyLessons'])
  const range = rosterOperatingInput({ planId: p.id, planVersion: p.version, from: p.from, until: p.until })
  return { id: range.planId, version: range.planVersion, title: text(p.title, rosterLimits.title, true), from: range.from, until: range.until, teachers: count(p.teachers, rosterLimits.teachers), classes: count(p.classes, rosterLimits.classes), weeklyLessons: count(p.weeklyLessons, rosterLimits.lessons) }
 })
 if (new Set(plans.map(p => p.id)).size !== plans.length) bad()
 return { plans }
}
export function rosterOperatingPreview(v: unknown, input: RosterOperatingInput): RosterOperatingPreview {
 exact(v, ['id', 'hash', 'expiresAt', 'input', 'timeZone', 'summary', 'blockers', 'changes', 'excludedDays'])
 if (canonical(rosterOperatingInput(v.input)) !== canonical(input)) bad()
 const timeZone = text(v.timeZone, 100, true)
 try { new Intl.DateTimeFormat('en', { timeZone }) } catch { bad() }
 exact(v.summary, ['teachers', 'classes', 'weeklyLessons', 'changedLessons'])
 const changes = list(v.changes, opLimits.changes).map(parseOperationLessonChange)
 if (new Set(changes.map(c => c.after.id)).size !== changes.length || changes.length !== count(v.summary.changedLessons)) bad()
 const day = (at: string) => { const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at)); return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-') }
 for (const c of changes) { const nextDay = day(c.after.time.startsAt); if (nextDay < input.from || nextDay >= input.until || c.before && day(c.before.time.startsAt) !== nextDay) bad() }
 const blockers = list(v.blockers, rosterLimits.courses + rosterLimits.teachers + rosterLimits.classes + opLimits.blockers).map(b => { exact(b, ['code', 'message', 'lessonIds']); return { code: text(b.code, 100, true), message: text(b.message, 400, true), lessonIds: list(b.lessonIds, opLimits.changes).map(identifier) } })
 const excludedDays = list(v.excludedDays, opLimits.publishDays).map(d => { exact(d, ['date', 'reason']); const date = isoDate(d.date); if (date < input.from || date >= input.until) bad(); return { date, reason: text(d.reason, 500, true) } })
 return { id: identifier(v.id), hash: hash(v.hash), expiresAt: at(v.expiresAt), input, timeZone, summary: { teachers: count(v.summary.teachers, rosterLimits.teachers), classes: count(v.summary.classes, rosterLimits.classes), weeklyLessons: count(v.summary.weeklyLessons, rosterLimits.lessons), changedLessons: changes.length }, blockers, changes, excludedDays }
}
export function rosterOperatingCommand(v: unknown): RosterOperatingCommand { exact(v, ['previewId', 'hash', 'input']); return { previewId: identifier(v.previewId), hash: hash(v.hash), input: rosterOperatingInput(v.input) } }
export function rosterOperatingReceipt(v: unknown, command: RosterOperatingCommand, key: string): RosterOperatingReceipt {
 exact(v, ['requestKey', 'publicationId', 'changedLessons', 'recordedAt', 'planId', 'from', 'until'])
 if (v.requestKey !== key || v.planId !== command.input.planId || v.from !== command.input.from || v.until !== command.input.until || !count(v.changedLessons)) bad()
 return { requestKey: key, publicationId: identifier(v.publicationId), changedLessons: count(v.changedLessons), recordedAt: at(v.recordedAt), planId: command.input.planId, from: command.input.from, until: command.input.until }
}
