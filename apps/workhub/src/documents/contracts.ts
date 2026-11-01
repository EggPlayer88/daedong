import type { Membership } from '../contracts'
import { ASSISTANT_LIMITS, assistantReference, type StudentContext } from '../assistant/contracts'
import { exact, identifier, isoDate, object, ServiceError, text, version } from '../services/service-values'

export const DOCUMENT_CONTRACT = 'documents.v1'
export const DOCUMENT_KINDS = ['parent_letter', 'event_plan', 'event_report', 'rubric', 'general', 'student_record'] as const
export type DocumentKind = typeof DOCUMENT_KINDS[number]
export const documentKindLabels: Record<DocumentKind, string> = { parent_letter: '가정통신문', event_plan: '행사 계획', event_report: '행사 결과', rubric: '수행평가 기준 초안', general: '일반 문서', student_record: '학생 기록 검토 초안' }
export interface DocumentSource { kind: 'knowledge' | 'document' | 'collection' | 'calendar' | 'task'; sourceId: string; sourceVersion: number; locator: string; quote: string }
export interface DocumentInput { title: string; kind: DocumentKind; body: string; visibility: 'private' | 'school'; sources: DocumentSource[]; basisDate: string; studentContext: StudentContext | null }
export interface LibraryDocument extends DocumentInput {
  id: string; schoolId: string; ownerMemberId: string; version: number; latestVersion: number
  status: 'draft' | 'confirmed' | 'archived'; updatedAt: string; canEdit: boolean
  origin: { documentId: string; version: number } | null
}
export interface DocumentList { items: LibraryDocument[]; nextCursor: string | null; canShare: boolean }
export interface DocumentReceipt { documentId: string; version: number; requestKey: string; recordedAt: string }
export type DocumentCommand =
  | { kind: 'create'; input: DocumentInput; origin: LibraryDocument['origin'] }
  | { kind: 'update'; documentId: string; expectedVersion: number; input: DocumentInput }
  | { kind: 'confirm' | 'archive'; documentId: string; expectedVersion: number }
export interface DocumentAiRequest { intent: 'document_draft' | 'guided_collection' | 'student_record_draft'; sourceId?: string; sourceVersion?: number; title: string; details: string; studentContext?: StudentContext | null }
export interface DocumentAiDraft { requestId: string; schoolId: string; memberId: string; title: string; body: string; sources: DocumentSource[]; intent: 'document_draft' | 'guided_collection' | 'student_record_draft'; studentContext: StudentContext | null }
export function blankDocument(date: string): DocumentInput { return { title: '', kind: 'general', body: '', visibility: 'private', sources: [], basisDate: date, studentContext: null } }
export function documentStudentContext(raw: unknown): StudentContext | null {
  if (raw === null) return null
  exact(raw, ['studentId', 'courseId', 'evidence'])
  if (!Array.isArray(raw.evidence) || !raw.evidence.length || raw.evidence.length > 100) throw new ServiceError('INVALID_INPUT')
  const evidence = raw.evidence.map(assistantReference)
  if (evidence.some(item => 'version' in item) || new Set(evidence.map(item => JSON.stringify(item))).size !== evidence.length) throw new ServiceError('INVALID_INPUT')
  return { studentId: identifier(raw.studentId), courseId: identifier(raw.courseId), evidence: evidence as StudentContext['evidence'] }
}
function source(value: unknown): DocumentSource {
  exact(value, ['kind', 'sourceId', 'sourceVersion', 'locator', 'quote'])
  if (!['knowledge', 'document', 'collection', 'calendar', 'task'].includes(String(value.kind))) throw new ServiceError('INVALID_INPUT')
  return { kind: value.kind as DocumentSource['kind'], sourceId: identifier(value.sourceId), sourceVersion: version(value.sourceVersion), locator: text(value.locator, 500, true), quote: text(value.quote, 2000) }
}
export function documentInput(value: unknown): DocumentInput {
  exact(value, ['title', 'kind', 'body', 'visibility', 'sources', 'basisDate', 'studentContext'])
  if (!DOCUMENT_KINDS.includes(value.kind as DocumentKind) || !['private', 'school'].includes(String(value.visibility)) || !Array.isArray(value.sources) || value.sources.length > 100) throw new ServiceError('INVALID_INPUT')
  const sources = value.sources.map(source)
  if (new Set(sources.map(item => [item.kind, item.sourceId, item.sourceVersion, item.locator].join(':'))).size !== sources.length) throw new ServiceError('INVALID_INPUT')
  const studentContext = documentStudentContext(value.studentContext)
  if ((value.kind === 'student_record') !== Boolean(studentContext) || (studentContext && value.visibility !== 'private')) throw new ServiceError('INVALID_INPUT')
  return { title: text(value.title, 200, true).trim(), kind: value.kind as DocumentKind, body: text(value.body, 100000, true), visibility: value.visibility as DocumentInput['visibility'], sources, basisDate: isoDate(value.basisDate), studentContext }
}
export function libraryDocument(value: unknown, member: Membership, documentId?: string, requestedVersion?: number): LibraryDocument {
  exact(value, ['id', 'schoolId', 'ownerMemberId', 'version', 'latestVersion', 'status', 'updatedAt', 'canEdit', 'origin', 'title', 'kind', 'body', 'visibility', 'sources', 'basisDate', 'studentContext'])
  if (value.schoolId !== member.schoolId || (documentId && value.id !== documentId) || !['draft', 'confirmed', 'archived'].includes(String(value.status)) || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || typeof value.canEdit !== 'boolean') throw new ServiceError('INVALID_RESPONSE')
  const currentVersion = version(value.version), latestVersion = version(value.latestVersion)
  if (currentVersion > latestVersion || (requestedVersion && currentVersion !== requestedVersion) || (!requestedVersion && currentVersion !== latestVersion) || (currentVersion !== latestVersion && value.canEdit)) throw new ServiceError('INVALID_RESPONSE')
  const input = documentInput(Object.fromEntries(['title', 'kind', 'body', 'visibility', 'sources', 'basisDate', 'studentContext'].map(key => [key, value[key]])))
  if ((input.visibility === 'private' || value.canEdit) && value.ownerMemberId !== member.id) throw new ServiceError('INVALID_RESPONSE')
  let origin: LibraryDocument['origin'] = null
  if (value.origin !== null) { exact(value.origin, ['documentId', 'version']); origin = { documentId: identifier(value.origin.documentId), version: version(value.origin.version) } }
  return { ...input, id: identifier(value.id), schoolId: member.schoolId, ownerMemberId: identifier(value.ownerMemberId), version: currentVersion, latestVersion, status: value.status as LibraryDocument['status'], updatedAt: value.updatedAt, canEdit: value.canEdit, origin }
}
export function documentList(value: unknown, member: Membership): DocumentList {
  exact(value, ['items', 'nextCursor', 'canShare'])
  if (!Array.isArray(value.items) || value.items.length > 50 || typeof value.canShare !== 'boolean') throw new ServiceError('INVALID_RESPONSE')
  const items = value.items.map(item => libraryDocument(item, member))
  if (new Set(items.map(item => item.id)).size !== items.length) throw new ServiceError('INVALID_RESPONSE')
  return { items, nextCursor: value.nextCursor === null ? null : text(value.nextCursor, 2000, true), canShare: value.canShare }
}
export function documentCommand(value: unknown): DocumentCommand {
  if (!object(value)) throw new ServiceError('INVALID_INPUT')
  if (value.kind === 'create') {
    exact(value, ['kind', 'input', 'origin'])
    let origin: LibraryDocument['origin'] = null
    if (value.origin !== null) { exact(value.origin, ['documentId', 'version']); origin = { documentId: identifier(value.origin.documentId), version: version(value.origin.version) } }
    return { kind: 'create', input: documentInput(value.input), origin }
  }
  if (value.kind === 'update') { exact(value, ['kind', 'documentId', 'expectedVersion', 'input']); return { kind: 'update', documentId: identifier(value.documentId), expectedVersion: version(value.expectedVersion), input: documentInput(value.input) } }
  exact(value, ['kind', 'documentId', 'expectedVersion'])
  if (!['confirm', 'archive'].includes(String(value.kind))) throw new ServiceError('INVALID_INPUT')
  return { kind: value.kind as 'confirm' | 'archive', documentId: identifier(value.documentId), expectedVersion: version(value.expectedVersion) }
}
export function documentReceipt(value: unknown, key: string, command: DocumentCommand): DocumentReceipt {
  exact(value, ['documentId', 'version', 'requestKey', 'recordedAt'])
  if (value.requestKey !== key || ('documentId' in command && value.documentId !== command.documentId) || typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt))) throw new ServiceError('INVALID_RESPONSE')
  const nextVersion = version(value.version)
  if ('expectedVersion' in command && nextVersion !== command.expectedVersion + 1) throw new ServiceError('INVALID_RESPONSE')
  return { documentId: identifier(value.documentId), version: nextVersion, requestKey: key, recordedAt: value.recordedAt }
}
export function documentAiDraft(value: unknown, member: Membership): DocumentAiDraft {
  exact(value, ['requestId', 'schoolId', 'memberId', 'title', 'body', 'sources', 'intent', 'studentContext'])
  if (value.schoolId !== member.schoolId || value.memberId !== member.id || !Array.isArray(value.sources) || value.sources.length > 100) throw new ServiceError('INVALID_RESPONSE')
  const studentContext = documentStudentContext(value.studentContext)
  if (!['document_draft', 'guided_collection', 'student_record_draft'].includes(String(value.intent)) || ((value.intent === 'student_record_draft') !== Boolean(studentContext))) throw new ServiceError('INVALID_RESPONSE')
  return { requestId: identifier(value.requestId), schoolId: member.schoolId, memberId: member.id, title: text(value.title, 200, true), body: text(value.body, 100000, true), sources: value.sources.map(source), intent: value.intent as DocumentAiDraft['intent'], studentContext }
}
export function documentPlainText(document: DocumentInput): string {
  return `${document.title}\n\n${document.body}\n\n기준일: ${document.basisDate}${document.sources.length ? '\n\n확인할 근거\n' + document.sources.map(item => `- ${item.locator} (자료 ${item.sourceId}, v${item.sourceVersion})\n  ${item.quote}`).join('\n') : ''}\n`
}
export function documentAiRequest(input: DocumentInput, original: LibraryDocument | null): DocumentAiRequest {
  const title = input.title || documentKindLabels[input.kind]
  let details = `문서 종류: ${documentKindLabels[input.kind]}\n기준일: ${input.basisDate}\n아래는 교사가 작성 중인 입력입니다. 연결된 문서 근거와 달라진 부분은 아직 저장되지 않았을 수 있습니다.\n${input.body}`
  if (Array.from(title + '\n' + details).length > ASSISTANT_LIMITS.promptChars - 200) {
    if (!original || original.body !== input.body || original.title !== input.title || original.basisDate !== input.basisDate || original.kind !== input.kind) throw new ServiceError('INVALID_INPUT')
    details = `저장한 문서 v${original.version}의 내용을 근거로 초안을 다듬어 주세요. 원문에 없는 사실과 날짜는 추정하지 마세요. 기준일: ${input.basisDate}`
  }
  return { intent: input.studentContext ? 'student_record_draft' : 'document_draft', studentContext: input.studentContext, ...(original ? { sourceId: original.id, sourceVersion: original.version } : {}), title, details }
}
