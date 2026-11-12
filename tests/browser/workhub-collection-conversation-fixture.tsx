import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CollectionServerPanel } from '../../apps/workhub/src/collections/CollectionServerPanel'
import { CollectionServerError } from '../../apps/workhub/src/collections/contracts'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'

// 대화 표시만 달리하고 실제 수합 훅의 파일·저장·공개·제출 경로를 합성 서버로 확인한다.
const w = window as any, copy = (value: any) => structuredClone(value), now = '2026-11-11T03:00:00Z'
const members = ['담당교사', '시험교사'].map((name, index) => ({ id: `member-${index}`, userId: `user-${index}`, schoolId: 'school', name, role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }))
const policy = { extensions: ['hwpx'], maxFileBytes: 1024, maxFiles: 3 }
const state: any = { request: null, units: [], draft: null, submissions: [], reviews: [], supplements: [], withdrawals: [] }
const receipts = new Map(), files = new Map(), edits = createEditDrafts(), pending = createPendingRequests()
w.calls = []; w.uploads = []; w.workflowResults = []; w.resultThrows = false; w.unknown = ''; w.fileMode = ''; w.denied = false; w.phase = 'open'; w.state = state
const server: any = {
  async readiness() { return { available: true, reason: 'ready', policy } },
  async list() { return { items: state.request ? [copy(state.request)] : [], nextCursor: null } },
  async detail() {
    if (w.denied) throw new CollectionServerError(typeof w.denied === 'string' ? w.denied : 'FORBIDDEN', '권한 없음')
    return copy({ ...state, draft: undefined })
  },
  async draft() { return copy(state.draft) },
  async mutate(member: string, command: any, key: string) {
    w.calls.push(copy({ member, command, key }))
    if (receipts.has(key)) return copy(receipts.get(key))
    if (w.denied) throw new CollectionServerError('FORBIDDEN', '권한 없음')
    let id = 'request-1', version = 1
    if (command.kind === 'create') state.request = { ...copy(command.input), id, schoolId: 'school', managerMemberId: member, status: 'draft', version: 1, publishedAt: null }
    else if (command.kind === 'update') {
      if (command.expectedVersion !== state.request.version) throw new CollectionServerError('CONFLICT', '판 변경')
      state.request = { ...state.request, ...copy(command.input), version: state.request.version + 1 }; version = state.request.version
    } else if (command.kind === 'publish') {
      if (command.expectedVersion !== state.request.version) throw new CollectionServerError('CONFLICT', '판 변경')
      state.request.status = 'published'; state.request.publishedAt = now; state.request.version++; version = state.request.version
      state.units = state.request.units.map((unit: any, index: number) => ({ ...unit, id: `unit-${index}`, requestId: state.request.id, schoolId: 'school', members: members.filter(person => person.id === unit.responsibleMemberId || unit.contributorMemberIds.includes(person.id)), version: 1, currentSubmissionId: null, effectiveSubmissionId: null, withdrawnSubmissionIds: [], correctionUntil: '', correctionReason: '' }))
    } else if (command.kind === 'save_draft') {
      if (command.expectedVersion !== (state.draft?.version ?? 0)) throw new CollectionServerError('CONFLICT', '판 변경')
      state.draft = { ...copy(command.input), id: 'draft-1', unitId: command.unitId, lastEditorMemberId: member, version: (state.draft?.version ?? 0) + 1 }; id = state.draft.id; version = state.draft.version
    } else if (command.kind === 'submit') {
      const unit = state.units.find((value: any) => value.id === command.unitId)
      if (unit.responsibleMemberId !== member || command.expectedVersion !== unit.version || command.expectedDraftVersion !== state.draft.version) throw new CollectionServerError('CONFLICT', '판 또는 책임자 변경')
      id = `submission-${state.submissions.length + 1}`; version = state.submissions.length + 1
      state.submissions.push({ ...copy(state.draft), id, unitId: unit.id, revision: version, submittedBy: member, receiptAt: now, receiptDate: '2026-11-11', dueSnapshot: state.request.dueDate, initiallyLate: false, correctionReason: command.reason, previousSubmissionId: unit.currentSubmissionId, reviewMode: 'none', requestKey: key })
      unit.currentSubmissionId = id; unit.effectiveSubmissionId = id; unit.version++
    } else throw Error(`미지원 명령 ${command.kind}`)
    const receipt = { requestId: 'request-1', resourceId: id, resourceVersion: version, recordedAt: now, requestKey: key }
    receipts.set(key, receipt)
    if (w.unknown === command.kind) { w.unknown = ''; throw new CollectionServerError('RESULT_UNKNOWN', '응답 유실') }
    return copy(receipt)
  },
  async prepareUpload(member: string, parent: any, file: File, _policy: any, key: string) {
    w.uploads.push({ kind: 'prepare', key, parent: copy(parent) })
    let value = [...files.values()].find(item => item.key === key)
    if (!value) { const id = `file-${files.size + 1}`; value = { key, blob: file, state: 'awaiting_upload', file: { id, name: file.name, extension: 'hwpx', bytes: file.size, sha256: 'a'.repeat(64) } }; files.set(id, value) }
    return { fileId: value.file.id, bucket: 'private', path: value.file.id, expiresAt: '2099-01-01T00:00:00Z', state: value.state }
  },
  async upload(_member: string, intent: any) { w.uploads.push({ kind: 'upload', id: intent.fileId }) },
  async completeUpload(_member: string, id: string, key: string) {
    w.uploads.push({ kind: 'complete', id, key }); const value = files.get(id)
    value.state = w.fileMode === 'reject' ? 'rejected' : w.fileMode === 'pending' ? 'pending_verification' : 'ready'
    return { fileId: id, state: value.state, file: value.state === 'ready' ? copy(value.file) : null }
  },
  async fileStatus(_member: string, id: string) { const value = files.get(id); return { fileId: id, state: value.state, file: value.state === 'ready' ? copy(value.file) : null } },
  async download(_member: string, _parent: any, file: any) { return files.get(file.id).blob },
}
const operations: any = { async get() { return { requestId: 'request-1', version: 1, phase: w.phase, dueDate: state.request.dueDate, canManage: true, totals: { total: state.units.length, missing: state.units.length, submitted: 0, accepted: 0, changesRequested: 0 }, units: [] } } }
function App() {
  const [visible, setVisible] = useState(true), [revision, setRevision] = useState(0), [compose, setCompose] = useState(w.withCompose ? { id: 'compose-1', schoolId: 'school', memberId: 'member-0', basisDate: '2026-11-11', title: 'AI로 준비한 수합', instructions: '양식을 작성해 주세요.', dueDate: '2026-11-20', targetMemberIds: ['member-0'] } : undefined)
  const [incoming, setIncoming] = useState<any>()
  w.remount = setVisible; w.refresh = () => setRevision(value => value + 1)
  w.provideGenerated = () => setIncoming({ requestId: 'request-1', artifactId: 'document-artifact-1', templateId: 'template-1', templateVersion: 1, blob: new Blob(['PK synthetic generated']), fileName: '질문답변.hwpx' })
  return visible && <CollectionServerPanel presentation="assistant" server={server} operations={operations} member={members[0] as any} members={members as any} date="2026-11-11" revision={revision} composeRequest={compose} onComposeRequestConsumed={() => setCompose(undefined)} incomingFile={incoming} onIncomingFileConsumed={() => setIncoming(undefined)} onNavigationLockChange={value => { w.locked = value }} onWorkflowResult={value => { w.workflowResults.push(copy(value)); if (w.resultThrows) throw Error('합성 결과 표시 실패') }} />
}
createRoot(document.getElementById('root')!).render(<EditDraftsProvider store={edits}><PendingRequestsProvider store={pending}><App /></PendingRequestsProvider></EditDraftsProvider>)
