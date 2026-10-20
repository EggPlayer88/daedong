import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableOperationsPanel } from '../../apps/workhub/src/timetable/TimetableOperationsWorkspace'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import { ServiceError, canonical } from '../../apps/workhub/src/services/scoped-rpc'
import { parseSchoolDayExecutionInput, parseSchoolDayExecutionPreview, schoolDayCommitCommand, schoolDayCommandHash, parseSchoolDayCommitReceipt } from '../../apps/workhub/src/timetable/school-day-execution-server'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
const w: any = window, copy = structuredClone
const date = new Date().toISOString().slice(0, 10), future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const member = { id: 'm', schoolId: 's', userId: 'u', name: '합성 교사', role: 'admin', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] } as const
w.scope = recoveryScope(member as any); w.pending = createPendingRequests(); w.drafts = createEditDrafts(); w.calls = []; w.future = future
const hash = async (value: any) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), x => x.toString(16).padStart(2, '0')).join('')
w.view = { asOf: new Date().toISOString(), timeZone: 'Asia/Seoul', from: date, until: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), canPublish: true, canRequest: true, drafts: [{ id: 'draft', version: 2, title: '2학기 초안' }], lessons: [], requests: [], publications: [] }
const bind = (slot: string) => w.drafts.bind(w.scope, slot)
w.saved = () => Object.fromEntries(['timetable-publish', 'timetable-school-day', 'timetable-exchanges'].map(slot => [slot, copy(bind(slot).initial)]))
async function schoolDaySeed() {
  const createdAt = new Date(Date.now() - 120000).toISOString(), expiresAt = new Date(Date.now() - 60000).toISOString()
  const before = { id: 'original-school-day-lesson', version: 1, label: '복구한 학사 변경의 원수업', time: { startsAt: future + 'T00:00:00.000Z', endsAt: future + 'T00:45:00.000Z' }, teachers: [{ id: 'm', name: '합성 교사' }], groupNames: ['1반'], roomNames: [], state: 'scheduled' as const, canRequest: false, allowedTargets: [] }
  const view = { ...copy(w.view), asOf: createdAt, lessons: [before] }
  const references = { asOf: view.asOf, from: view.from, until: view.until, lessons: [{ lessonId: before.id, version: before.version, groups: [{ id: 'group-one', name: '1반' }], rooms: [] }] }
  const input = parseSchoolDayExecutionInput({ kind: 'closure', date: future, groupIds: ['group-one'], reason: '학사 입력 유지', bells: [] })
  const after = { ...before, version: 2, state: 'cancelled' as const }
  const unsigned = { input, sourceAsOf: view.asOf, previewId: 'day-preview', createdAt, expiresAt, complete: true, coverage: { date: future, groupIds: input.groupIds, complete: true, existingRequests: 'complete' },
    affectedLessons: [{ lessonId: before.id, version: before.version }], changes: [{ before, after }], requestEffects: [], blockers: [], preserved: { pastRecords: true, outsideTarget: true, existingChanges: 'retained' }, lostLessonCount: 1, lostSeconds: 2700, changesActualSchedule: false }
  // 만료된 원요청도 실제 미리보기 파서와 명령 생성기를 거친 문맥으로 복구한다.
  const result = await parseSchoolDayExecutionPreview({ ...unsigned, previewHash: await hash(unsigned) }, input, view, references, Date.now(), true)
  w.view.lessons = [copy(after)]
  return schoolDayCommitCommand(result, view, references)
}
w.seed = async (kind: string) => {
  bind('timetable-publish').save({ draftId: 'draft', draftVersion: 2, from: future, lastDay: future, dirty: true })
  bind('timetable-school-day').save({ kind: 'closure', date: future, groupIds: [], reason: '학사 입력 유지', bells: {} })
  bind('timetable-exchanges').save({ kind: 'swap', lessonId: '', targetKey: '', otherLessonId: '', reason: '교환 입력 유지' })
  const command = kind === 'publish_manifest' ? { kind, manifest: { input: { draftId: 'draft', draftVersion: 2, from: future, until: future } } } : await schoolDaySeed()
  if (w.onlyRecoveryDraft) { bind('timetable-publish').remove(); bind('timetable-exchanges').remove() }
  w.pending.put(w.scope, 'timetableOperations', { command, key: 'original-request-123' }); w.seeded = copy(command)
}
async function receipt(command: any, key: string) {
  if (command.kind === 'publish_manifest') return { kind: command.kind, requestKey: key, entityId: 'publication', commandHash: 'a'.repeat(64), version: 4, status: 'published', recordedAt: new Date().toISOString(), manifestHash: 'a'.repeat(64), basisFingerprint: 'b'.repeat(64), changedCount: 1 }
  return parseSchoolDayCommitReceipt({ kind: command.kind, requestKey: key, entityId: 'school-day', commandHash: await schoolDayCommandHash(command), version: 1, status: 'applied',
    recordedAt: new Date(Date.parse(command.context.result.createdAt) + 1000).toISOString(), changedLessonCount: command.context.result.changes.length, lostLessonCount: command.context.result.lostLessonCount,
    changesHash: await hash(command.context.result.changes.map((change: any) => ({ id: change.after.id, version: change.after.version }))) }, command, key)
}
const execution = (kind: string) => ({
  async execute(_: string, command: any, key: string) { w.calls.push({ method: kind + '.execute', command: copy(command), key }); if (w.failWrite) throw new ServiceError('RESULT_UNKNOWN'); return receipt(command, key) },
  async resend(_: string, command: any, key: string) { w.calls.push({ method: kind + '.resend', command: copy(command), key }); if(w.resendError) throw new ServiceError(w.resendError); return receipt(command,key) },
  async recover(_: string, command: any, key: string) { w.calls.push({ method: kind + '.recover', command: copy(command), key }); if (w.delayRecovery) await new Promise(resolve => w.releaseRecovery = resolve); if (w.recoveryError) throw new ServiceError(w.recoveryError); return receipt(command, key) },
})
const publicationExecution = execution('publication'), schoolDayExecution = { ...execution('schoolDay'), preview: async () => { throw Error('미사용') } }
const server: any = {
  readiness: async () => { if (w.failRead) throw new ServiceError('QUERY_FAILED'); return { available: true } },
  get: async (_: string, from: string, until: string) => ({ ...copy(w.view), from, until }),
  recover: async () => { throw Error('다른 계약의 복구로 잘못 전달') }, execute: async () => { throw Error('새 요청이 잘못 실행됨') },
}
const extensions: any = {
  references: async (_: string, view: any) => ({ asOf: view.asOf, from: view.from, until: view.until, lessons: view.lessons.map((lesson: any) => ({ lessonId: lesson.id, version: lesson.version, groups: [{ id: 'group-one', name: '1반' }], rooms: [] })) }),
  publicationManifest: async (_: string, input: any) => {
    const after = { id: 'lesson', version: 1, label: '국어', time: { startsAt: future + 'T00:00:00.000Z', endsAt: future + 'T00:45:00.000Z' }, teachers: [{ id: 'm', name: '합성 교사' }], groupNames: ['1반'], roomNames: [], state: 'scheduled', canRequest: false, allowedTargets: [] }
    w.changes = [{ before: null, after }]
    const unsigned = { previewId: 'preview', previewHash: 'a'.repeat(64), input: copy(input), timeZone: 'Asia/Seoul', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), basisFingerprint: 'b'.repeat(64), totalChanges: 1, pageSize: 200, pageHashes: [await hash(w.changes)], blockerCount: 0, complete: true, preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
    return { ...unsigned, manifestHash: await hash(unsigned) }
  },
  publicationPage: async (_: string, manifest: any, index: number) => { if (w.delayPage) await new Promise(resolve => w.releasePage = resolve); return { previewId: manifest.previewId, manifestHash: manifest.manifestHash, index, pageHash: manifest.pageHashes[index], changes: copy(w.changes) } },
}
function Harness() {
  const [revision, setRevision] = useState(0); w.refresh = () => setRevision(x => x + 1)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{baseStyles}</style><TimetableOperationsPanel server={server} publicationExecution={publicationExecution as any} schoolDayExecution={schoolDayExecution as any} extensions={extensions} member={member as any} date={date} revision={revision} onNavigationLockChange={value => w.locked = value} /></PendingRequestsProvider></EditDraftsProvider>
}
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.root.render(<Harness />) }
