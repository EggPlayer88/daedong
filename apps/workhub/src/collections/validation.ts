import { FILE_TECHNICAL_LIMITS, type FilePolicy, type FileReference } from '../files/contracts'
import { normalizeFilePolicy, validateFileReferences } from '../files/validation'
import type { AnswerInput, CollectionDraft, CollectionInput, CollectionRequest, CollectionUnit, Submission, ReviewRecord, Supplement, Withdrawal } from '../workflows/types'
import { CollectionServerError, type CollectionCommand, type CollectionDetail, type CollectionFileParent, type CollectionFileStatus, type CollectionList, type CollectionReadiness, type CollectionReceipt, type CollectionUpload } from './contracts'

type ObjectValue = Record<string, unknown>
export interface CollectionScope { schoolId: string; memberId: string; userId: string }
const invalid = (): never => { throw new CollectionServerError('INVALID_RESPONSE', '서버 응답의 형식과 연결 범위를 확인하지 못했습니다.') }
const object = (raw: unknown): ObjectValue => raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as ObjectValue : invalid()
function shape(raw: unknown, required: string[], optional: string[] = []): ObjectValue {
  const value = object(raw)
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid()
  return value
}
function array<T>(raw: unknown, parse: (item: unknown) => T, maximum = 1000): T[] {
  if (!Array.isArray(raw) || raw.length > maximum) return invalid()
  return Array.from(raw, parse)
}
function text(raw: unknown, maximum: number, required = false): string {
  if (typeof raw !== 'string' || raw.length > maximum || (required && !raw.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(raw)) return invalid()
  return raw
}
export const collectionIdentifier = (raw: unknown): string => typeof raw === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(raw) ? raw : invalid()
const nullableId = (raw: unknown): string | null => raw === null ? null : collectionIdentifier(raw)
const boolean = (raw: unknown): boolean => typeof raw === 'boolean' ? raw : invalid()
const integer = (raw: unknown, minimum = 1): number => Number.isSafeInteger(raw) && Number(raw) >= minimum ? Number(raw) : invalid()
function oneOf<T extends string>(raw: unknown, values: readonly T[]): T { return typeof raw === 'string' && values.includes(raw as T) ? raw as T : invalid() }
function unique<T extends { id: string }>(values: T[]): T[] { if (new Set(values.map(value => value.id)).size !== values.length) invalid(); return values }
function ids(raw: unknown, maximum = 100): string[] { const values = array(raw, collectionIdentifier, maximum); if (new Set(values).size !== values.length) invalid(); return values }
function date(raw: unknown, optional = false): string {
  if (optional && raw === '') return ''
  if (typeof raw !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) return invalid()
  return raw
}
function instant(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) return invalid()
  date(raw.slice(0, 10)); return raw
}
const generalPolicy: FilePolicy = { extensions: ['pdf', 'hwp', 'hwpx', 'docx', 'xlsx', 'pptx'], maxFileBytes: FILE_TECHNICAL_LIMITS.memoryBytes, maxFiles: FILE_TECHNICAL_LIMITS.zipEntries }
export function collectionFiles(raw: unknown, policy = generalPolicy): FileReference[] {
  try { return validateFileReferences(Array.from(array(raw, value => value, policy.maxFiles)), policy) } catch { return invalid() }
}
export function collectionPolicy(raw: unknown): FilePolicy { try { return normalizeFilePolicy(raw) } catch { return invalid() } }
function input(raw: unknown): CollectionInput {
  const value = shape(raw, ['title', 'instructions', 'dueDate', 'reviewMode', 'reviewerMemberId', 'textLabel', 'textRequired', 'numberLabel', 'numberRequired', 'units'], ['fileCollection'])
  const units = array(value.units, item => {
    const unit = shape(item, ['label', 'responsibleMemberId', 'contributorMemberIds'])
    const result = { label: text(unit.label, 100, true), responsibleMemberId: collectionIdentifier(unit.responsibleMemberId), contributorMemberIds: ids(unit.contributorMemberIds) }
    if (new Set([result.responsibleMemberId, ...result.contributorMemberIds]).size > 100) invalid()
    return result
  }, 100)
  if (!units.length || new Set(units.map(unit => unit.label)).size !== units.length) invalid()
  const result: CollectionInput = { title: text(value.title, 120, true), instructions: text(value.instructions, 3000), dueDate: date(value.dueDate), reviewMode: oneOf(value.reviewMode, ['none', 'required']), reviewerMemberId: value.reviewerMemberId === '' ? '' : collectionIdentifier(value.reviewerMemberId), textLabel: text(value.textLabel, 120), textRequired: boolean(value.textRequired), numberLabel: text(value.numberLabel, 120), numberRequired: boolean(value.numberRequired), units }
  if (value.fileCollection !== undefined) {
    const config = shape(value.fileCollection, ['policy', 'required', 'templates']), policy = collectionPolicy(config.policy)
    result.fileCollection = { policy, required: boolean(config.required), templates: collectionFiles(config.templates, policy) }
  }
  if ((!result.textLabel && !result.numberLabel && !result.fileCollection) || (result.textRequired && !result.textLabel) || (result.numberRequired && !result.numberLabel) || (result.reviewMode === 'required' && !result.reviewerMemberId)) invalid()
  return result
}
function answer(raw: unknown, policy?: FilePolicy): AnswerInput {
  const value = object(raw)
  if (value.number !== null && (typeof value.number !== 'number' || !Number.isFinite(value.number))) invalid()
  return { text: text(value.text, 5000), number: value.number as number | null, ...(value.files === undefined ? {} : { files: collectionFiles(value.files, policy) }) }
}
export function collectionRequest(raw: unknown, scope: CollectionScope, expectedId?: string): CollectionRequest {
  const value = shape(raw, ['title', 'instructions', 'dueDate', 'reviewMode', 'reviewerMemberId', 'textLabel', 'textRequired', 'numberLabel', 'numberRequired', 'units', 'id', 'schoolId', 'managerMemberId', 'status', 'version', 'publishedAt'], ['fileCollection'])
  const { id, schoolId, managerMemberId, status, version, publishedAt, ...body } = value
  const result: CollectionRequest = { ...input(body), id: collectionIdentifier(id), schoolId: collectionIdentifier(schoolId), managerMemberId: collectionIdentifier(managerMemberId), status: oneOf(status, ['draft', 'published']), version: integer(version), publishedAt: publishedAt === null ? null : instant(publishedAt) }
  if (result.schoolId !== scope.schoolId || (expectedId !== undefined && result.id !== expectedId) || (result.status === 'draft') !== (result.publishedAt === null)) invalid()
  return result
}
export function collectionList(raw: unknown, scope: CollectionScope): CollectionList {
  const value = shape(raw, ['items', 'nextCursor'])
  return { items: unique(array(value.items, item => collectionRequest(item, scope), 50)), nextCursor: value.nextCursor === null ? null : collectionCursor(value.nextCursor) }
}
export function collectionCursor(raw: unknown): string { const value = text(raw, 2048, true); if (!/^[A-Za-z0-9_=-]+$/.test(value)) invalid(); return value }
export function collectionDraft(raw: unknown, unitId: string, policy?: FilePolicy): CollectionDraft | null {
  if (raw === null) return null
  const value = shape(raw, ['id', 'unitId', 'lastEditorMemberId', 'version', 'text', 'number'], ['files'])
  const result = { ...answer(value, policy), id: collectionIdentifier(value.id), unitId: collectionIdentifier(value.unitId), lastEditorMemberId: collectionIdentifier(value.lastEditorMemberId), version: integer(value.version) }
  if (result.unitId !== unitId) invalid()
  return result
}
export function collectionDetail(raw: unknown, scope: CollectionScope, requestId: string): CollectionDetail {
  const value = shape(raw, ['request', 'units', 'submissions', 'reviews', 'supplements', 'withdrawals'])
  const request = collectionRequest(value.request, scope, requestId)
  const units: CollectionUnit[] = unique(array(value.units, item => {
    const unit = shape(item, ['id', 'requestId', 'schoolId', 'label', 'responsibleMemberId', 'members', 'version', 'currentSubmissionId', 'effectiveSubmissionId', 'withdrawnSubmissionIds', 'correctionUntil', 'correctionReason'])
    const members = unique(array(unit.members, item => { const member = shape(item, ['id', 'userId', 'name']); return { id: collectionIdentifier(member.id), userId: collectionIdentifier(member.userId), name: text(member.name, 200, true) } }, 100))
    const result = { id: collectionIdentifier(unit.id), requestId: collectionIdentifier(unit.requestId), schoolId: collectionIdentifier(unit.schoolId), label: text(unit.label, 100, true), responsibleMemberId: collectionIdentifier(unit.responsibleMemberId), members, version: integer(unit.version), currentSubmissionId: nullableId(unit.currentSubmissionId), effectiveSubmissionId: nullableId(unit.effectiveSubmissionId), withdrawnSubmissionIds: ids(unit.withdrawnSubmissionIds, 1000), correctionUntil: date(unit.correctionUntil, true), correctionReason: text(unit.correctionReason, 1000) }
    if (result.requestId !== requestId || result.schoolId !== scope.schoolId || !members.some(member => member.id === result.responsibleMemberId) || request.status !== 'published') invalid()
    return result
  }, 100))
  const submissions: Submission[] = unique(array(value.submissions, item => {
    const submission = shape(item, ['id', 'unitId', 'revision', 'submittedBy', 'receiptAt', 'receiptDate', 'dueSnapshot', 'initiallyLate', 'correctionReason', 'previousSubmissionId', 'reviewMode', 'requestKey', 'text', 'number'], ['files'])
    const result = { ...answer(submission, request.fileCollection?.policy), id: collectionIdentifier(submission.id), unitId: collectionIdentifier(submission.unitId), revision: integer(submission.revision), submittedBy: collectionIdentifier(submission.submittedBy), receiptAt: instant(submission.receiptAt), receiptDate: date(submission.receiptDate), dueSnapshot: date(submission.dueSnapshot), initiallyLate: boolean(submission.initiallyLate), correctionReason: text(submission.correctionReason, 1000), previousSubmissionId: nullableId(submission.previousSubmissionId), reviewMode: oneOf(submission.reviewMode, ['none', 'required']), requestKey: collectionRequestKey(submission.requestKey) }
    const unit = units.find(unit => unit.id === result.unitId)
    if (!unit || unit.responsibleMemberId !== result.submittedBy || result.reviewMode !== request.reviewMode || (!request.fileCollection && result.files?.length)) invalid()
    if ((!request.textLabel && result.text) || (!request.numberLabel && result.number !== null) || (request.textRequired && !result.text.trim()) || (request.numberRequired && result.number === null) || (request.fileCollection?.required && !result.files?.length)) invalid()
    return result
  }))
  const linkedSubmission = (unitId: string, submissionId: string) => submissions.some(submission => submission.id === submissionId && submission.unitId === unitId)
  const reviews: ReviewRecord[] = unique(array(value.reviews, item => {
    const review = shape(item, ['id', 'unitId', 'submissionId', 'reviewerMemberId', 'decision', 'note', 'recordedAt'])
    const result = { id: collectionIdentifier(review.id), unitId: collectionIdentifier(review.unitId), submissionId: collectionIdentifier(review.submissionId), reviewerMemberId: collectionIdentifier(review.reviewerMemberId), decision: oneOf(review.decision, ['accepted', 'changes_requested']), note: text(review.note, 1000), recordedAt: instant(review.recordedAt) }
    if (!linkedSubmission(result.unitId, result.submissionId) || request.reviewMode !== 'required' || result.reviewerMemberId !== request.reviewerMemberId) invalid(); return result
  }))
  const supplements: Supplement[] = unique(array(value.supplements, item => {
    const supplement = shape(item, ['id', 'unitId', 'submissionId', 'dueDate', 'fulfilledSubmissionId', 'fulfilledAt'])
    const result = { id: collectionIdentifier(supplement.id), unitId: collectionIdentifier(supplement.unitId), submissionId: collectionIdentifier(supplement.submissionId), dueDate: date(supplement.dueDate), fulfilledSubmissionId: nullableId(supplement.fulfilledSubmissionId), fulfilledAt: supplement.fulfilledAt === null ? null : instant(supplement.fulfilledAt) }
    if (!linkedSubmission(result.unitId, result.submissionId) || (result.fulfilledSubmissionId !== null && !linkedSubmission(result.unitId, result.fulfilledSubmissionId)) || (result.fulfilledSubmissionId === null) !== (result.fulfilledAt === null)) invalid(); return result
  }))
  const withdrawals: Withdrawal[] = unique(array(value.withdrawals, item => {
    const withdrawal = shape(item, ['id', 'unitId', 'submissionId', 'actorMemberId', 'reason', 'recordedAt'])
    const result = { id: collectionIdentifier(withdrawal.id), unitId: collectionIdentifier(withdrawal.unitId), submissionId: collectionIdentifier(withdrawal.submissionId), actorMemberId: collectionIdentifier(withdrawal.actorMemberId), reason: text(withdrawal.reason, 1000, true), recordedAt: instant(withdrawal.recordedAt) }
    if (!linkedSubmission(result.unitId, result.submissionId)) invalid(); return result
  }))
  for (const unit of units) {
    for (const id of [unit.currentSubmissionId, unit.effectiveSubmissionId, ...unit.withdrawnSubmissionIds]) if (id !== null && !linkedSubmission(unit.id, id)) invalid()
    if ((unit.currentSubmissionId !== null && unit.withdrawnSubmissionIds.includes(unit.currentSubmissionId)) || (unit.effectiveSubmissionId !== null && unit.withdrawnSubmissionIds.includes(unit.effectiveSubmissionId))) invalid()
    if (request.reviewMode === 'none' && unit.currentSubmissionId !== unit.effectiveSubmissionId) invalid()
    if (request.reviewMode === 'required' && unit.effectiveSubmissionId !== null && !reviews.some(review => review.unitId === unit.id && review.submissionId === unit.effectiveSubmissionId && review.decision === 'accepted')) invalid()
    const revisions = submissions.filter(submission => submission.unitId === unit.id).map(submission => submission.revision).sort((a, b) => a - b)
    if (revisions.some((revision, index) => revision !== index + 1)) invalid()
    for (const id of unit.withdrawnSubmissionIds) if (!withdrawals.some(withdrawal => withdrawal.unitId === unit.id && withdrawal.submissionId === id)) invalid()
  }
  for (const withdrawal of withdrawals) if (!units.find(unit => unit.id === withdrawal.unitId)?.withdrawnSubmissionIds.includes(withdrawal.submissionId)) invalid()
  for (const submission of submissions) {
    const previous = submissions.find(value => value.id === submission.previousSubmissionId && value.unitId === submission.unitId)
    // 철회하면 current가 과거 완료판 또는 null로 돌아간다. 직전 일련번호와 동일하다고 가정하지 않는다.
    if (submission.previousSubmissionId !== null && (!previous || previous.revision >= submission.revision)) invalid()
  }
  return { request, units, submissions, reviews, supplements, withdrawals }
}
export function collectionReadiness(raw: unknown): CollectionReadiness {
  const value = shape(raw, ['available', 'reason', 'policy'])
  const result = { available: boolean(value.available), reason: oneOf(value.reason, ['ready', 'database_missing', 'storage_missing', 'verification_missing', 'policy_missing']), policy: value.policy === null ? null : collectionPolicy(value.policy) }
  if (result.available !== (result.reason === 'ready') || (result.available && result.policy === null)) invalid()
  return result
}
export const collectionRequestKey = (raw: unknown): string => { const value = text(raw, 200, true); if (value.length < 8) invalid(); return value }
export function collectionReceipt(raw: unknown, key: string, requestId?: string): CollectionReceipt {
  const value = shape(raw, ['requestId', 'resourceId', 'resourceVersion', 'recordedAt', 'requestKey'])
  const result = { requestId: collectionIdentifier(value.requestId), resourceId: collectionIdentifier(value.resourceId), resourceVersion: integer(value.resourceVersion), recordedAt: instant(value.recordedAt), requestKey: collectionRequestKey(value.requestKey) }
  if (result.requestKey !== key || (requestId !== undefined && result.requestId !== requestId)) invalid()
  return result
}
const businessCodes = ['NOT_READY', 'INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'FILE_NOT_READY', 'FILE_FAILED'] as const
export function collectionEnvelope(raw: unknown, scope: CollectionScope): unknown {
  const value = object(raw)
  shape(value, ['contractVersion', 'schoolId', 'memberId', Object.hasOwn(value, 'error') ? 'error' : 'data'])
  if (value.contractVersion !== 1 || value.schoolId !== scope.schoolId || value.memberId !== scope.memberId) invalid()
  if (Object.hasOwn(value, 'error')) { const error = shape(value.error, ['code']); throw new CollectionServerError(oneOf(error.code, businessCodes), '서버가 요청을 처리하지 않았습니다. 입력과 권한을 확인해 주세요.') }
  return value.data
}
export function collectionParent(raw: unknown): CollectionFileParent {
  const value = object(raw), kind = oneOf(value.kind, ['template', 'draft', 'submission']), requestId = collectionIdentifier(value.requestId)
  if (kind === 'template') { shape(value, ['kind', 'requestId', 'version']); return { kind, requestId, version: integer(value.version) } }
  const unitId = collectionIdentifier(value.unitId)
  if (kind === 'draft') { shape(value, ['kind', 'requestId', 'unitId', 'version']); return { kind, requestId, unitId, version: integer(value.version, 0) } }
  shape(value, ['kind', 'requestId', 'unitId', 'submissionId']); return { kind, requestId, unitId, submissionId: collectionIdentifier(value.submissionId) }
}
export function collectionLocation(raw: unknown, scope: CollectionScope, fileId: string): { bucket: string; path: string } {
  const value = object(raw), bucket = text(value.bucket, 100, true), path = text(value.path, 400, true)
  const pieces = path.split('/')
  if (bucket !== 'workhub-collection-files' || pieces.length !== 3 || pieces[0] !== scope.schoolId || pieces[1] !== fileId || !/^[A-Za-z0-9_-]{16,100}$/.test(pieces[2])) invalid()
  return { bucket, path }
}
export function collectionUpload(raw: unknown, scope: CollectionScope): CollectionUpload {
  const value = shape(raw, ['fileId', 'bucket', 'path', 'expiresAt', 'state']), fileId = collectionIdentifier(value.fileId)
  return { fileId, ...collectionLocation(value, scope, fileId), expiresAt: instant(value.expiresAt), state: oneOf(value.state, ['awaiting_upload', 'pending_verification', 'ready', 'rejected']) }
}
export function collectionFileStatus(raw: unknown, fileId: string): CollectionFileStatus {
  const value = shape(raw, ['fileId', 'state', 'file']), id = collectionIdentifier(value.fileId), state = oneOf(value.state, ['awaiting_upload', 'pending_verification', 'ready', 'rejected'])
  const file = value.file === null ? null : collectionFiles([value.file])[0]
  if (id !== fileId || (file !== null && file.id !== id) || (state === 'ready') !== (file !== null)) invalid()
  return { fileId: id, state, file }
}
export function collectionAccess(raw: unknown, scope: CollectionScope, expected: FileReference): { file: FileReference; bucket: string; path: string } {
  const value = shape(raw, ['file', 'bucket', 'path']), file = collectionFiles([value.file])[0]
  if (JSON.stringify(file) !== JSON.stringify(expected)) invalid()
  return { file, ...collectionLocation(value, scope, file.id) }
}
export function collectionCommand(raw: unknown): CollectionCommand {
  const value = object(raw), kind = oneOf(value.kind, ['create', 'update', 'publish', 'save_draft', 'submit', 'review', 'withdraw', 'open_correction'])
  if (kind === 'create') { shape(value, ['kind', 'input']); return { kind, input: input(value.input) } }
  const requestId = collectionIdentifier(value.requestId)
  if (kind === 'update') { shape(value, ['kind', 'requestId', 'expectedVersion', 'input']); return { kind, requestId, expectedVersion: integer(value.expectedVersion), input: input(value.input) } }
  if (kind === 'publish') { shape(value, ['kind', 'requestId', 'expectedVersion']); return { kind, requestId, expectedVersion: integer(value.expectedVersion) } }
  const unitId = collectionIdentifier(value.unitId)
  if (kind === 'save_draft') { shape(value, ['kind', 'requestId', 'unitId', 'expectedVersion', 'input']); shape(value.input, ['text', 'number'], ['files']); return { kind, requestId, unitId, expectedVersion: integer(value.expectedVersion, 0), input: answer(value.input) } }
  const expectedVersion = integer(value.expectedVersion)
  if (kind === 'submit') { shape(value, ['kind', 'requestId', 'unitId', 'draftId', 'expectedDraftVersion', 'expectedVersion', 'reason'], ['correctionRequestId']); return { kind, requestId, unitId, draftId: collectionIdentifier(value.draftId), expectedDraftVersion: integer(value.expectedDraftVersion), expectedVersion, reason: text(value.reason, 1000), ...(value.correctionRequestId === undefined ? {} : { correctionRequestId: collectionIdentifier(value.correctionRequestId) }) } }
  if (kind === 'open_correction') { shape(value, ['kind', 'requestId', 'unitId', 'expectedVersion', 'dueDate', 'reason']); return { kind, requestId, unitId, expectedVersion, dueDate: date(value.dueDate), reason: text(value.reason, 1000, true) } }
  const submissionId = collectionIdentifier(value.submissionId)
  if (kind === 'withdraw') { shape(value, ['kind', 'requestId', 'unitId', 'submissionId', 'expectedVersion', 'reason']); return { kind, requestId, unitId, submissionId, expectedVersion, reason: text(value.reason, 1000, true) } }
  shape(value, ['kind', 'requestId', 'unitId', 'submissionId', 'expectedVersion', 'decision', 'note', 'dueDate'])
  const decision = oneOf(value.decision, ['accepted', 'changes_requested'])
  return { kind, requestId, unitId, submissionId, expectedVersion, decision, note: text(value.note, 1000, decision === 'changes_requested'), dueDate: date(value.dueDate, decision === 'accepted') }
}
export function collectionInputCheck<T>(run: () => T): T { try { return run() } catch { throw new CollectionServerError('INVALID_INPUT', '수합 입력과 확인한 버전을 다시 확인해 주세요.') } }
