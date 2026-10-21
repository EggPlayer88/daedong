import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { KnowledgeWorkspace } from '../../apps/workhub/src/knowledge/KnowledgeWorkspace'
import { KnowledgeCitationPanel } from '../../apps/workhub/src/knowledge/KnowledgeCitationPanel'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
let member = { id: 'member-one', schoolId: 'school-one', userId: 'user-one', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const source = { id: 'source-one', schoolId: member.schoolId, authorMemberId: member.id, version: 7, status: 'published', title: '학교 자료 원본', kind: 'school_guide', body: '인용한 7판의 확인된 원문', locator: '제3조', effectiveFrom: '2026-03-01', effectiveThrough: '2027-02-28', updatedAt: '2026-10-19T00:00:00Z' }
const qa = window.qa = { source, calls: [], asks: [], pages: null, revisions: null, historyPages: null, readError: null, fail: false, deferred: false, releases: [], writeUnknown: false, returns: 0, pending: createPendingRequests(), drafts: createEditDrafts(), connectionNumber: 0 }
const envelope = data => ({ contract: 'knowledge.v1', schoolId: member.schoolId, memberId: member.id, data })
function connection() { return { info: () => ({ memberships: [member], schools: [{ id: member.schoolId }], basisDate: '2026-10-19' }), getIdentity: async () => ({ userId: member.userId, approved: true }), rpcVerified: async (name, args) => {
  qa.calls.push({ name, args: structuredClone(args) })
  if (name === 'workhub_knowledge_get' || name === 'workhub_knowledge_history') {
    const revisions = qa.revisions ?? [qa.source]
    const found = qa.revisions ? revisions.find(item => item.version === args.p_source_version) : qa.source
    const entries = revisions.filter(item => args.p_before_version === null || item.version < args.p_before_version).sort((a,b) => b.version-a.version)
    const data = name.endsWith('_get') ? { source: found, isCurrent: found?.version === qa.source.version, canManage: true } : qa.historyPages?.[args.p_before_version ?? 'first'] ?? { sourceId: qa.source.id, authorMemberId: member.id, items: entries.slice(0,50).map(item => ({version:item.version,status:item.status,title:item.title,recordedAt:item.updatedAt,isCurrent:item.version===qa.source.version})), nextBeforeVersion: entries.length > 50 ? entries[49].version : null, canManage: true }
    const raw = qa.readError || name.endsWith('_get') && !found ? { contract:'knowledge.v1',schoolId:member.schoolId,memberId:member.id,error:{code:qa.readError ?? 'NOT_FOUND'} } : envelope(data)
    if (qa.deferred) return new Promise((resolve,reject) => qa.releases.push(() => qa.fail ? reject(Error('synthetic')) : resolve(raw)))
    if (qa.fail) throw Error('synthetic')
    return raw
  }
  if (name === 'workhub_knowledge_original_access') return {contract:'knowledge-import.v1',schoolId:member.schoolId,memberId:member.id,data:{available:false}}
  if (name === 'workhub_knowledge_list') {
    const raw = envelope(qa.pages ? qa.pages[args.p_cursor ?? 'first'] : { items: [structuredClone(qa.source)], nextCursor: null, canManage: true })
    if (qa.deferred) return new Promise((resolve, reject) => qa.releases.push(() => qa.fail ? reject(Error('synthetic')) : resolve(raw)))
    if (qa.fail) throw Error('synthetic')
    return raw
  }
  if (name === 'workhub_knowledge_mutate') { if (qa.writeUnknown) throw Error('synthetic response lost'); return envelope({ id: 'new-source', version: 1, requestKey: args.p_request_key, recordedAt: '2026-10-19T00:00:00Z' }) }
  throw Error('unexpected rpc ' + name)
} } }
function App() {
  const [revision, setRevision] = useState(0), [date, setDate] = useState('2026-10-19'), [conn, setConn] = useState(connection), [open, setOpen] = useState(undefined), [citationOnly, setCitationOnly] = useState(false)
  qa.open = (overrides = {}, only = false) => { setCitationOnly(only); setOpen({ key: 'citation-one', schoolId: member.schoolId, memberId: member.id, sourceId: 'source-one', sourceVersion: 7, title: '학교 자료 원본', locator: '제3조', ...overrides }) }
  qa.refresh = () => setRevision(x => x + 1)
  qa.syncChange = type => { flushSync(() => { if (type === 'date') setDate('2027-03-01'); else if (type === 'connection') setConn(connection()); else setRevision(x => x + 1) }); return document.querySelector('.knowledge-citation')?.textContent }
  qa.changeMember = () => { member = { ...member, id: 'member-other', userId: 'user-other', schoolId: 'school-other' }; setRevision(x => x + 1) }
  const props = { connection: conn, member, date, revision, onAskAssistant: request => qa.asks.push(request), onReturnToSource: () => qa.returns++ }
  return <EditDraftsProvider store={qa.drafts}><PendingRequestsProvider store={qa.pending}>{citationOnly && open ? <KnowledgeCitationPanel {...props} request={open}/> : <KnowledgeWorkspace {...props} openRequest={open}/>}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')).render(<App/>)
