import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { FILE_TECHNICAL_LIMITS, FileError, type FileReference } from '../files/contracts'
import { createStoredZip, storedZipEntryName } from '../files/download'
import { fileOperation, readBlobBytes } from '../files/validation'
import { CollectionServerError, type CollectionDetail, type CollectionServer } from './contracts'
import { collectionDetail } from './validation'
import { summarizeCollectionSubmission } from './submission-summary'

export type CollectionExportMode = 'effective' | 'current'
export interface CollectionExportJob { unitId: string; submissionId: string; revision: number; unitLabel: string; file: FileReference; name: string }
export interface CollectionExportPlan {
  requestId: string; title: string; mode: CollectionExportMode; fingerprint: string
  jobs: CollectionExportJob[]; csv: string; totalUnits: number; includedUnits: number; totalBytes: number
}
export interface CollectionExportBatch { plan: CollectionExportPlan; blobs: Map<string, Blob>; failed: string[]; zip?: Blob }
interface ExportOptions { server: CollectionServer; member: Membership; date: string; signal?: AbortSignal; onProgress?: (message: string) => void }
interface IssuedBatch { plan: CollectionExportPlan; blobs: Map<string, Blob>; zip?: Blob }
// 이 탭에서 확인한 결과만 재시도에 쓴다. 화면 쪽 Map 변경으로 검증하지 않은 파일을 끼워 넣지 않는다.
const issuedBatches = new WeakMap<CollectionExportBatch, IssuedBatch>()
const states = { unsubmitted: '미제출', pending: '검토 대기', changes_requested: '보완 요청', accepted: '검토 완료', complete: '응답 완료', unavailable: '확인 필요' }
const fail = (code: 'INVALID_RESPONSE' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'CONFLICT' | 'CANCELLED' | 'FILE_FAILED') => new CollectionServerError(code, {
  INVALID_RESPONSE: '수합 전체 현황과 파일 정보를 확인하지 못했습니다. 다시 조회해 주세요.',
  FORBIDDEN: '이 수합의 담당자만 제출 파일을 모을 수 있습니다.',
  INACTIVE_MEMBERSHIP: '현재 유효한 학교 소속을 확인해 주세요.',
  CONFLICT: '제출 또는 검토 상태가 바뀌었습니다. 최신 현황으로 다시 준비해 주세요.',
  CANCELLED: '묶음 준비를 취소했습니다.',
  FILE_FAILED: '파일 내용을 확인하지 못했습니다. 다시 시도해 주세요.',
}[code])
function guard(signal?: AbortSignal) { if (signal?.aborted) throw fail('CANCELLED') }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function cell(value: string | number) {
  let text = String(value)
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}
const byId = <T extends { id: string }>(values: readonly T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
export function collectionExportJobKey(job: CollectionExportJob): string { return JSON.stringify([job.unitId, job.submissionId, job.file.id]) }

export function collectionExportPlan(raw: CollectionDetail, member: Membership, date: string, mode: CollectionExportMode): CollectionExportPlan {
  if (!member || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date || !activeAt(member, date)) throw fail('INACTIVE_MEMBERSHIP')
  if (!raw?.request || raw.request.schoolId !== member.schoolId || raw.request.managerMemberId !== member.id || raw.request.status !== 'published' || !raw.request.fileCollection || !['effective', 'current'].includes(mode)) throw fail('FORBIDDEN')
  const detail = collectionDetail(raw, { schoolId: member.schoolId, memberId: member.id, userId: member.userId }, raw.request.id)
  const { request } = detail
  // 상세 조회가 담당자에게 전체 단위를 돌려줬는지 확인한다. 일부만 왔을 때 완전한 ZIP처럼 내보내지 않는다.
  const expected = request.units.map(unit => ({ label: unit.label, responsibleMemberId: unit.responsibleMemberId, members: [...new Set([unit.responsibleMemberId, ...unit.contributorMemberIds])] }))
  const actual = detail.units.map(unit => ({ label: unit.label, responsibleMemberId: unit.responsibleMemberId, members: unit.members.map(value => value.id) }))
  if (canonical(expected) !== canonical(actual)) throw fail('INVALID_RESPONSE')
  const jobs: CollectionExportJob[] = [], rows: (string | number)[][] = [['제출 단위', '다운로드 기준', '포함 여부', '선택한 제출판', '현재 제출 상태', '원본 파일명', '묶음 안 파일명', 'SHA-256']]
  let includedUnits = 0, totalBytes = 0
  for (const [index, unit] of byId(detail.units).entries()) {
    const summary = summarizeCollectionSubmission(detail, unit, date)
    if (summary.reviewState === 'unavailable') throw fail('INVALID_RESPONSE')
    const selected = mode === 'effective' ? summary.effective : summary.current
    const files = byId(selected?.files ?? [])
    if (files.length) includedUnits++
    const omitted = selected ? '첨부 파일 없음' : mode === 'effective' ? '완료본 없음' : summary.withdrawals.length ? '철회 후 제출 없음' : '미제출'
    const common = [unit.label, mode === 'effective' ? '완료본' : '최신 제출본', files.length ? '포함' : omitted, selected ? 'v' + selected.revision : '', states[summary.reviewState]]
    if (!files.length) rows.push([...common, '', '', ''])
    for (const file of files) {
      if (jobs.length + 2 > FILE_TECHNICAL_LIMITS.zipEntries) throw new FileError('FILE_ZIP_LIMIT')
      const name = String(index + 1).padStart(3, '0') + '_' + unit.label + '_v' + selected!.revision + '_' + file.name
      rows.push([...common, file.name, storedZipEntryName(name, jobs.length + 1), file.sha256])
      jobs.push({ unitId: unit.id, submissionId: selected!.id, revision: selected!.revision, unitLabel: unit.label, file: { ...file }, name })
      totalBytes += file.bytes
      if (totalBytes > FILE_TECHNICAL_LIMITS.memoryBytes) throw new FileError('FILE_ZIP_LIMIT')
    }
  }
  const csv = '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n')
  totalBytes += new TextEncoder().encode(csv).length
  if (totalBytes > FILE_TECHNICAL_LIMITS.memoryBytes) throw new FileError('FILE_ZIP_LIMIT')
  const fingerprint = canonical({ detail, mode, member: { id: member.id, userId: member.userId, schoolId: member.schoolId, active: member.active, validFrom: member.validFrom, validThrough: member.validThrough }, date })
  return freeze({ requestId: request.id, title: request.title, mode, fingerprint, jobs, csv, totalUnits: detail.units.length, includedUnits, totalBytes })
}
async function current(options: ExportOptions, requestId: string, mode: CollectionExportMode): Promise<CollectionExportPlan> {
  guard(options.signal)
  let detail: CollectionDetail
  try { detail = await options.server.detail(options.member.id, requestId) } catch (error) { guard(options.signal); throw safeError(error) }
  guard(options.signal)
  if (detail?.request?.id !== requestId) throw fail('INVALID_RESPONSE')
  return collectionExportPlan(detail, options.member, options.date, mode)
}
async function unchanged(options: ExportOptions, plan: CollectionExportPlan): Promise<void> {
  const latest = await current(options, plan.requestId, plan.mode)
  guard(options.signal)
  if (latest.fingerprint !== plan.fingerprint) throw fail('CONFLICT')
}
function safeError(error: unknown): CollectionServerError | FileError {
  return error instanceof CollectionServerError || error instanceof FileError ? error : fail('INVALID_RESPONSE')
}
function retryable(error: unknown): boolean {
  return error instanceof CollectionServerError && ['QUERY_FAILED', 'FILE_FAILED', 'FILE_NOT_READY'].includes(error.code)
    || error instanceof FileError && ['FILE_TIMEOUT', 'FILE_READ_FAILED'].includes(error.code)
}
async function download(options: ExportOptions, plan: CollectionExportPlan, job: CollectionExportJob): Promise<Blob> {
  guard(options.signal)
  const blob = await options.server.download(options.member.id, { kind: 'submission', requestId: plan.requestId, unitId: job.unitId, submissionId: job.submissionId }, job.file)
  guard(options.signal)
  if (!(blob instanceof Blob) || blob.size !== job.file.bytes) throw fail('FILE_FAILED')
  // 서버 어댑터의 검증과 별도로 ZIP에 넣는 바이트도 참조값과 대조한다.
  await fileOperation(options.signal, FILE_TECHNICAL_LIMITS.timeoutMs, async operation => {
    const bytes = await readBlobBytes(blob, job.file.bytes, operation)
    guard(options.signal); operation.guard()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    guard(options.signal); operation.guard()
    if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== job.file.sha256) throw new FileError('FILE_READ_FAILED')
  })
  guard(options.signal)
  return blob
}
function invalidate(batch?: CollectionExportBatch) {
  if (!batch) return
  const issued = issuedBatches.get(batch)
  issued?.blobs.clear(); issuedBatches.delete(batch); batch.blobs.clear(); delete batch.zip
}
function issue(plan: CollectionExportPlan, blobs: Map<string, Blob>, failed: string[], zip?: Blob): CollectionExportBatch {
  const batch = { plan, blobs: new Map(blobs), failed, ...(zip ? { zip } : {}) }
  issuedBatches.set(batch, { plan, blobs: new Map(blobs), zip })
  return batch
}
export async function prepareCollectionExport(options: ExportOptions & { requestId: string; mode: CollectionExportMode; previous?: CollectionExportBatch }): Promise<CollectionExportBatch> {
  const blobs = new Map<string, Blob>()
  try {
    guard(options.signal)
    options.onProgress?.('최신 제출 현황을 확인하고 있습니다.')
    const plan = await current(options, options.requestId, options.mode)
    guard(options.signal)
    if (options.previous) {
      const previous = issuedBatches.get(options.previous)
      if (!previous || previous.plan.fingerprint !== plan.fingerprint) throw fail('CONFLICT')
      for (const [key, blob] of previous.blobs) blobs.set(key, blob)
    }
    const failed: string[] = []
    for (const [index, job] of plan.jobs.entries()) {
      guard(options.signal)
      const key = collectionExportJobKey(job)
      if (blobs.has(key)) continue
      options.onProgress?.(`${index + 1}/${plan.jobs.length}개 파일을 확인하고 있습니다.`)
      try {
        const blob = await download(options, plan, job)
        guard(options.signal); blobs.set(key, blob)
      } catch (error) {
        guard(options.signal)
        if (!retryable(error)) throw safeError(error)
        failed.push(key)
      }
    }
    await unchanged(options, plan); guard(options.signal)
    if (failed.length) return issue(plan, blobs, failed)
    options.onProgress?.('제출 현황표와 파일을 ZIP으로 묶고 있습니다.')
    const zip = await createStoredZip([{ name: '제출현황.csv', blob: new Blob([plan.csv], { type: 'text/csv;charset=utf-8' }) }, ...plan.jobs.map(job => ({ name: job.name, blob: blobs.get(collectionExportJobKey(job))! }))], options.signal)
    guard(options.signal)
    await unchanged(options, plan); guard(options.signal)
    return issue(plan, blobs, [], zip)
  } catch (error) {
    blobs.clear(); invalidate(options.previous); guard(options.signal); throw safeError(error)
  }
}
export async function recheckCollectionExport(options: ExportOptions & { batch: CollectionExportBatch }): Promise<void> {
  try {
    guard(options.signal)
    const issued = issuedBatches.get(options.batch)
    if (!issued?.zip || issued.zip !== options.batch.zip || issued.plan !== options.batch.plan || options.batch.failed.length) throw fail('CONFLICT')
    await unchanged(options, issued.plan); guard(options.signal)
    // 현 RPC에는 전체 수합을 잠그는 기능이 없다. 다운로드 직전에 파일별 권한·본문과 전체 현황을 다시 확인한다.
    for (const [index, job] of issued.plan.jobs.entries()) {
      options.onProgress?.(`다운로드 전 ${index + 1}/${issued.plan.jobs.length}개 파일을 다시 확인하고 있습니다.`)
      await download(options, issued.plan, job); guard(options.signal)
    }
    await unchanged(options, issued.plan); guard(options.signal)
  } catch (error) { invalidate(options.batch); guard(options.signal); throw safeError(error) }
}
