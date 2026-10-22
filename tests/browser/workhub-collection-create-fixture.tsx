// 실제 React 작성 화면을 합성 서버로 실행한다. 운영 DB·Storage에는 접속하지 않는다.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CollectionServerPanel } from '../../apps/workhub/src/collections/CollectionServerPanel'
import { CollectionServerError } from '../../apps/workhub/src/collections/contracts'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'

const w = window as any, clone = (v: any) => structuredClone(v), now = '2026-10-22T03:00:00Z'
const members = ['김담당', '이교사', '박교사'].map((name, i) => ({ id: `m${i}`, userId: `u${i}`, schoolId: 'school', name, role: 'calendar_manager', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }))
const memory = createEditDrafts(), pending = createPendingRequests(), receipts = new Map(), uploads = new Map()
const policy = { extensions: ['hwpx'], maxFileBytes: w.showcase ? 20971520 : 1024, maxFiles: w.showcase ? 5 : 3 }
w.calls = []; w.fileCalls = []; w.mode = ''; w.failRead = false; w.request = null; w.applied = 0; w.fileMode = ''; w.ready = true
const server: any = {
  async readiness() { if (w.readDelay) await new Promise(r => setTimeout(r, w.readDelay)); return { available: w.ready, reason: w.ready ? 'ready' : 'verification_missing', policy: w.ready ? policy : null } },
  async list() { if (w.readDelay) await new Promise(r => setTimeout(r, w.readDelay)); return { items: w.request ? [clone(w.request)] : [], nextCursor: null } },
  async detail() {
    if (w.readDelay) await new Promise(r => setTimeout(r, w.readDelay))
    if (w.failRead) throw new CollectionServerError('QUERY_FAILED', '조회 실패')
    if (w.mode === 'denied') throw new CollectionServerError('FORBIDDEN', '권한 없음')
    if (!w.request) throw new CollectionServerError('NOT_FOUND', '없음')
    return { request: clone(w.request), units: [], submissions: [], reviews: [], supplements: [], withdrawals: [] }
  },
  async mutate(member: string, command: any, key: string) {
    w.calls.push(clone({ command, key, member }))
    if (receipts.has(key)) return clone(receipts.get(key))
    if (command.kind === 'update' && w.mode === 'conflict') {
      w.mode = ''; w.request.version++; w.request.instructions = '다른 곳에서 바꾼 안내'
      throw new CollectionServerError('CONFLICT', '경합')
    }
    if (command.kind === 'create') w.request = { ...clone(command.input), id: 'r1', schoolId: 'school', managerMemberId: member, status: 'draft', version: 1, publishedAt: null }
    else if (command.kind === 'update') {
      if (command.expectedVersion !== w.request.version) throw new CollectionServerError('CONFLICT', '판 불일치')
      w.request = { ...w.request, ...clone(command.input), version: w.request.version + 1 }
    } else throw Error('공개·제출은 이 시험에서 자동 호출하면 안 됩니다.')
    w.applied++
    const receipt = { requestId: 'r1', resourceId: 'r1', resourceVersion: w.request.version, recordedAt: now, requestKey: key }
    receipts.set(key, receipt)
    if (command.kind === 'create' && w.mode === 'race-after-create') { w.request.version++; w.request.instructions = '생성 직후 다른 변경' }
    if (w.mode === `unknown-${command.kind}`) { w.mode = ''; throw new CollectionServerError('RESULT_UNKNOWN', '유실') }
    return clone(receipt)
  },
  async prepareUpload(member: string, parent: any, file: File, policy: any, key: string) {
    w.fileCalls.push({ kind: 'prepare', parent: clone(parent), key, name: file.name })
    let item = [...uploads.values()].find(v => v.key === key)
    if (!item) {
      const id = `f${uploads.size + 1}`
      item = { key, file: { id, name: file.name, extension: 'hwpx', bytes: file.size, sha256: 'a'.repeat(64) }, blob: file, state: 'awaiting_upload' }; uploads.set(id, item)
    }
    if (w.fileMode === 'unknown-prepare') { w.fileMode = ''; throw new CollectionServerError('RESULT_UNKNOWN', '유실') }
    return { fileId: item.file.id, bucket: 'private', path: item.file.id, expiresAt: '2099-01-01T00:00:00Z', state: item.state }
  },
  async upload(member: string, intent: any) { w.fileCalls.push({ kind: 'upload', id: intent.fileId }) },
  async completeUpload(member: string, id: string, key: string) {
    w.fileCalls.push({ kind: 'complete', id, key })
    const item = uploads.get(id)
    if (w.fileMode === 'reject' || (w.fileMode === 'reject-second' && id === 'f2')) return { fileId: id, state: 'rejected', file: null }
    if (w.fileMode === 'pending') return { fileId: id, state: 'pending_verification', file: null }
    if (w.fileMode === 'unknown-complete') { w.fileMode = ''; throw new CollectionServerError('RESULT_UNKNOWN', '유실') }
    item.state = 'ready'
    return { fileId: id, state: 'ready', file: clone(item.file) }
  },
  async fileStatus() { throw Error('예상 밖 호출') },
  async download(member: string, parent: any, file: any) { return uploads.get(file.id).blob },
}
function App() {
  const [visible, setVisible] = useState(true), [who, setWho] = useState(0), [revision, setRevision] = useState(0)
  w.remount = setVisible; w.switchMember = setWho; w.refresh = () => setRevision(v => v + 1)
  return visible && <CollectionServerPanel server={server} member={members[who] as any} members={members as any} date="2026-10-22" revision={revision} />
}
createRoot(document.getElementById('root')!).render(<EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}><App /></PendingRequestsProvider></EditDraftsProvider>)
