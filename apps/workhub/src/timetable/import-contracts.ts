import type { Placement } from './contracts'
import { preparationInput, preparationSource, type PreparationInput, type PreparationSource } from './preparation'
import { canonical, exact, identifier, isoDate, ServiceError, text, validateLocalInput, version } from '../services/scoped-rpc'

export const TIMETABLE_IMPORT_CONTRACT = 'timetable-import.v1'
export interface TimetableImportInput {
  preparation: PreparationInput; placements: Placement[]; title: string; fileHash: string
}
export interface TimetableImportPreview {
  previewId: string; fingerprint: string; expiresAt: string; input: TimetableImportInput
  termId: string; lessonCount: number; courseCount: number; existingPublicationsPreserved: true
}
export interface TimetableImportCommand { previewId: string; fingerprint: string; input: TimetableImportInput }
export interface TimetableImportReceipt {
  requestKey: string; previewId: string; termId: string; basisId: string; basisRevision: number
  draftId: string; draftVersion: 1; lessonCount: number; recordedAt: string; published: false
}
export interface TimetableImportClose { requestKey: string; outcome: 'applied' | 'closed'; receipt: TimetableImportReceipt | null }
export interface TimetableImportServer {
  get(memberId: string): Promise<PreparationSource>
  preview(memberId: string, input: TimetableImportInput): Promise<TimetableImportPreview>
  commit(memberId: string, command: TimetableImportCommand, key: string): Promise<TimetableImportReceipt>
  close(memberId: string, command: TimetableImportCommand, key: string): Promise<TimetableImportClose>
}
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail()
const timestamp = (v: unknown): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail()
  const value = v as string
  isoDate(value.slice(0, 10))
  return value
}
export { preparationSource as timetableImportSource }
export function timetableImportInput(raw: unknown, source?: PreparationSource): TimetableImportInput {
  return validateLocalInput(() => {
    exact(raw, ['preparation', 'placements', 'title', 'fileHash'])
    const preparation = preparationInput(raw.preparation, source)
    if (preparation.kind !== 'confirm' || !Array.isArray(raw.placements) || raw.placements.length < 1 || raw.placements.length > 5000) fail()
    const placements = (raw.placements as unknown[]).map(row => { exact(row, ['lessonId', 'slotId']); return { lessonId: identifier(row.lessonId), slotId: identifier(row.slotId) } })
    if (new Set(placements.map(p => p.lessonId)).size !== placements.length) fail()
    return { preparation, placements, title: text(raw.title, 100, true), fileHash: hash(raw.fileHash) }
  })
}
export function timetableImportCommand(raw: unknown): TimetableImportCommand {
  return validateLocalInput(() => {
    exact(raw, ['previewId', 'fingerprint', 'input'])
    return { previewId: identifier(raw.previewId), fingerprint: hash(raw.fingerprint), input: timetableImportInput(raw.input) }
  })
}
export function timetableImportPreview(raw: unknown, input: TimetableImportInput): TimetableImportPreview {
  exact(raw, ['previewId', 'fingerprint', 'expiresAt', 'input', 'termId', 'lessonCount', 'courseCount', 'existingPublicationsPreserved'])
  if (canonical(raw.input) !== canonical(input) || raw.termId !== input.preparation.termId ||
      raw.lessonCount !== input.placements.length || raw.courseCount !== input.preparation.draft.plans.length ||
      raw.existingPublicationsPreserved !== true) fail()
  return { previewId: identifier(raw.previewId), fingerprint: hash(raw.fingerprint), expiresAt: timestamp(raw.expiresAt), input: structuredClone(input),
    termId: identifier(raw.termId), lessonCount: version(raw.lessonCount), courseCount: version(raw.courseCount), existingPublicationsPreserved: true }
}
export function timetableImportReceipt(raw: unknown, command: TimetableImportCommand, key: string): TimetableImportReceipt {
  exact(raw, ['requestKey', 'previewId', 'termId', 'basisId', 'basisRevision', 'draftId', 'draftVersion', 'lessonCount', 'recordedAt', 'published'])
  if (raw.requestKey !== key || raw.previewId !== command.previewId || raw.termId !== command.input.preparation.termId ||
      raw.lessonCount !== command.input.placements.length || raw.draftVersion !== 1 || raw.published !== false) fail()
  return { requestKey: key, previewId: command.previewId, termId: identifier(raw.termId), basisId: identifier(raw.basisId), basisRevision: version(raw.basisRevision),
    draftId: identifier(raw.draftId), draftVersion: 1, lessonCount: version(raw.lessonCount), recordedAt: timestamp(raw.recordedAt), published: false }
}
export function timetableImportClose(raw: unknown, command: TimetableImportCommand, key: string): TimetableImportClose {
  exact(raw, ['requestKey', 'outcome', 'receipt'])
  if (raw.requestKey !== key || !['applied', 'closed'].includes(String(raw.outcome))) fail()
  if (raw.outcome === 'closed') { if (raw.receipt !== null) fail(); return { requestKey: key, outcome: 'closed', receipt: null } }
  return { requestKey: key, outcome: 'applied', receipt: timetableImportReceipt(raw.receipt, command, key) }
}
