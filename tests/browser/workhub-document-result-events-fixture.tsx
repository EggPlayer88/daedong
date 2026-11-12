import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentsWorkspace } from '../../apps/workhub/src/documents/DocumentsWorkspace'
import { GuidedWorkspace } from '../../apps/workhub/src/documents/GuidedWorkspace'
import { createDocumentsService } from '../../apps/workhub/src/documents/adapter'
import { blobSha, createGuidedService } from '../../apps/workhub/src/documents/guided-adapter'
import { GUIDED_BUCKET } from '../../apps/workhub/src/documents/guided-contracts'
import { ServiceError } from '../../apps/workhub/src/services/service-values'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'

// 실제 문서·질문형 어댑터를 유지하고 RPC·파일 포트만 합성한다. 운영 서버·유료 AI 호출은 없다.
const w = window as any, copy = structuredClone
const member = { id: 'teacher', userId: 'user', schoolId: 'school', name: '가상 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
let current = member
const date = '2026-11-12', recordedAt = '2026-11-12T00:00:00Z'
let document: any = { id: 'doc', schoolId: 'school', ownerMemberId: 'teacher', version: 1, latestVersion: 1, status: 'draft', updatedAt: recordedAt, canEdit: true, origin: null, title: '문서 원본', kind: 'general', body: '학교 내부 검토 본문', visibility: 'private', sources: [], basisDate: date, studentContext: null }
const anchor = { id: 'Contents/section0.xml:p000000', section: 'Contents/section0.xml', paragraph: 0, sourceText: '', sourceHash: 'a'.repeat(64), cell: null }
const inspection = { profile: 'explicit_paragraph_v1', templateSha256: 'b'.repeat(64), anchors: [anchor], unsupportedParagraphs: 0 }
const question = { id: 'q', label: '안내 내용', kind: 'text', required: true, maxLength: 500, options: [], anchorId: anchor.id, sourceText: anchor.sourceText, sourceHash: anchor.sourceHash }
const template: any = { id: 'template', schoolId: 'school', ownerMemberId: w.manager ? 'teacher' : 'other', title: '결과 연결 양식', version: 2, state: w.manager ? 'draft' : 'published', inspection, mapping: { profile: 'explicit_paragraph_v1', templateSha256: 'b'.repeat(64), questions: [question] }, collectionRequestId: w.manager ? null : 'collection', canManage: Boolean(w.manager) }
let response: any = { id: 'response', templateId: template.id, templateVersion: template.version, schoolId: 'school', ownerMemberId: 'teacher', version: 3, answers: { q: '저장한 답변' }, preview: Boolean(w.manager), artifact: null }
const file = new Blob(['PK 합성 HWPX 내용']), documents = new Map(), operations = new Map()
w.calls = []; w.renders = []; w.workflowResults = []; w.listenerTargets = []; w.downloads = 0; w.applied = []
w.pending = createPendingRequests(); w.drafts = createEditDrafts()
const envelope = (contract: string, data: any) => ({ contract, schoolId: current.schoolId, memberId: current.id, data: copy(data) })
const failure = (contract: string, code: string) => ({ contract, schoolId: current.schoolId, memberId: current.id, error: { code } })
async function deferred(raw: any) { if (w.hold) { w.hold = false; await new Promise(resolve => { w.release = resolve }) }; return raw }
function returned(raw: any) { if (w.badField) raw.data[w.badField] = w.badValue; return raw }
const connection: any = {
  info: () => ({ memberships: [current], schools: [{ id: current.schoolId }], basisDate: date }),
  getIdentity: async () => ({ userId: current.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push(copy({ name, args }))
    if (name === 'workhub_document_list') { if (w.listFail) return failure('documents.v1', 'NOT_READY'); return envelope('documents.v1', { items: [document], nextCursor: null, canShare: true }) }
    if (name === 'workhub_document_get') { if (w.getFail) throw Error('합성 후속 조회 실패'); return envelope('documents.v1', document) }
    if (name === 'workhub_document_history') return envelope('documents.v1', { documentId: 'doc', versions: [{ version: document.version, recordedAt, status: document.status }] })
    if (name === 'workhub_document_request_get') return returned(envelope('documents.v1', documents.get(args.p_request_key)))
    if (name === 'workhub_document_mutate') {
      if (w.rejectCode) return failure('documents.v1', w.rejectCode)
      const command = args.p_command, key = args.p_request_key
      if (!documents.has(key)) {
        document = { ...document, ...copy(command.input ?? {}), version: command.kind === 'create' ? 1 : command.expectedVersion + 1, status: command.kind === 'confirm' ? 'confirmed' : command.kind === 'archive' ? 'archived' : 'draft' }
        document.latestVersion = document.version
        documents.set(key, { documentId: document.id, version: document.version, requestKey: key, recordedAt })
        w.applied.push(copy(command))
      }
      if (w.unknown) { w.unknown = false; throw new ServiceError('RESULT_UNKNOWN') }
      return deferred(returned(envelope('documents.v1', documents.get(key))))
    }
    if (name === 'workhub_template_list') { if (w.listFail) return failure('guided.v1', 'NOT_READY'); return envelope('guided.v1', { items: [template], nextCursor: null, canCreate: template.canManage }) }
    if (name === 'workhub_template_get') { if (w.getFail) throw Error('합성 후속 조회 실패'); return envelope('guided.v1', { template, response }) }
    if (name === 'workhub_collection_presentation') return envelope('collection.presentation.v1', { items: [] })
    if (name === 'workhub_template_mutate') {
      const command = args.p_command
      if (command.kind !== 'save_answers') throw Error('시험하지 않는 명령')
      response = { ...response, version: command.expectedVersion + 1, answers: copy(command.answers), artifact: null }
      return envelope('guided.v1', { requestKey: args.p_request_key, templateId: template.id, templateVersion: template.version, responseId: response.id, responseVersion: response.version })
    }
    if (name === 'workhub_template_operation_get') return returned(envelope('guided.v1', operations.get(args.p_operation.requestKey)))
    if (name === 'workhub_template_prepare') return envelope('guided.v1', { templateId: template.id, templateVersion: template.version, bucket: GUIDED_BUCKET, path: `school/teacher/${template.id}/source.hwpx`, bytes: args.p_file.bytes, sha256: args.p_file.sha256, uploaded: false })
    if (name === 'workhub_document_artifact_access') return envelope('guided.v1', { artifact: response.artifact, bucket: GUIDED_BUCKET, path: `school/teacher/${response.artifact.artifactId}/output.hwpx`, ownerMemberId: 'teacher' })
    throw Error('예상하지 않은 RPC: ' + name)
  },
}
const port: any = {
  upload: async () => { w.uploaded = true },
  download: async () => { w.downloads++; return file },
  run: async (input: any) => {
    w.renders.push(copy(input))
    if (w.rejectCode) throw new ServiceError(w.rejectCode)
    if (input.action === 'inspect') return envelope('guided.v1', { templateId: template.id, templateVersion: template.version, inspection })
    if (!operations.has(input.requestKey)) {
      const artifact = { artifactId: 'artifact-' + input.requestKey, templateId: input.templateId, templateVersion: input.templateVersion, responseId: input.responseId, responseVersion: input.responseVersion, bytes: file.size, sha256: await blobSha(file) }
      operations.set(input.requestKey, artifact); response.artifact = copy(artifact); w.applied.push({ kind: 'render', key: input.requestKey })
    }
    if (w.unknown) { w.unknown = false; throw new ServiceError('RESULT_UNKNOWN') }
    return deferred(returned(envelope('guided.v1', operations.get(input.requestKey))))
  },
}
const services = [0, 1].map(() => ({ documents: createDocumentsService(connection), guided: createGuidedService(connection, port) }))
function App() {
  const [mounted, setMounted] = useState(true), [revision, setRevision] = useState(0), [active, setActive] = useState(member), [serviceId, setServiceId] = useState(0), [listenerTarget, setListenerTarget] = useState('original'), [aiDraft, setAiDraft] = useState<any>()
  useEffect(() => { w.ui = { mounted, serviceId, memberId: active.id, listenerTarget } }, [mounted, serviceId, active, listenerTarget])
  w.unmount = () => setMounted(false); w.remount = () => setMounted(true); w.refresh = () => setRevision(value => value + 1)
  w.changeScope = () => { current = { ...member, id: 'other-teacher', userId: 'other-user', schoolId: 'other-school' }; setActive(current) }
  w.changeService = () => setServiceId(1); w.changeListener = () => setListenerTarget('new')
  w.setAi = (requestId = 'ai-request') => setAiDraft({ requestId, schoolId: 'school', memberId: 'teacher', title: 'AI 제안 제목', body: 'AI 검토 초안', sources: [], intent: 'document_draft', studentContext: null })
  const onWorkflowResult = (result: any) => { w.workflowResults.push(copy(result)); w.listenerTargets.push(listenerTarget); if (w.resultThrows) throw Error('합성 업무목록 표시 실패') }
  const props = { presentation: 'assistant' as const, connection, member: active as any, date, revision, onWorkflowResult }
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>{mounted && (w.mode === 'guided'
    ? <GuidedWorkspace {...props} service={services[serviceId].guided} />
    : <DocumentsWorkspace {...props} service={services[serviceId].documents} aiDraft={aiDraft} />)}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(window.document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
