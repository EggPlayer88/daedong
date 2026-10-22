import {AssistantError} from '../../apps/workhub/src/assistant/contracts'
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableInterventionsPanel } from '../../apps/workhub/src/timetable/TimetableInterventionsPanel'
import { TimetableExchangePanel } from '../../apps/workhub/src/timetable/TimetableExchangePanel'
import { TimetableActionSummaryPanel } from '../../apps/workhub/src/timetable/TimetableActionSummary'
import { createTimetableInterventionsServer } from '../../apps/workhub/src/timetable/interventions-server'
import { interventionHash } from '../../apps/workhub/src/timetable/interventions-domain'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import styles from '../../apps/workhub/src/style.css?inline'
const w: any = window, copy = (value: any) => structuredClone(value), stamp = () => new Date().toISOString()
w.date = new Date().toISOString().slice(0, 10)
w.future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
w.until = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
const span = (hour = '01') => ({ startsAt: w.future + `T${hour}:00:00.000Z`, endsAt: w.future + `T${hour}:45:00.000Z` })
const person = (id = 'teacher-a') => ({ id, name: id === 'teacher-a' ? '원담당 교사' : id === 'teacher-b' ? '대강 교사' : '별도 승인자' })
const member = (id = 'teacher-a') => ({ ...person(id), schoolId: 'school', userId: 'user-' + id, role: id === 'manager' ? 'admin' : 'teacher', active: true, validFrom: '2020-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] })
w.member = member(); w.calls = []; w.aiCalls = []; w.writes = 0; w.receipts = {}; w.closes = {}; w.previews = {}; w.pending = createPendingRequests(); w.drafts = createEditDrafts()
w.lesson = { id: 'lesson-one', version: 1, label: '국어 1회', time: span(), teachers: [person()], groupNames: ['1-1'], roomNames: ['1-1'], state: 'scheduled', canRequest: true, allowedTargets: [span('02')] }
w.originalLesson = copy(w.lesson); w.requests = []; w.closures = []
const actions = (row: any) => {
  if (!['awaiting_consent', 'awaiting_approval'].includes(row.state)) return []
  const result: string[] = []
  if (row.state === 'awaiting_consent' && row.participants.some((p: any) => p.id === w.member.id && p.response === 'pending')) result.push('accept', 'reject')
  if (row.requester.id === w.member.id) result.push('withdraw')
  if (row.state === 'awaiting_approval' && row.requester.id !== w.member.id && w.member.id === 'manager') result.push('approve', 'rejectApproval')
  return result
}
const view = (from = w.date, until = w.until) => ({ asOf: stamp(), timeZone: 'Asia/Seoul', from, until, lessons: [copy(w.lesson)], teachers: [person(), person('teacher-b')], closures: copy(w.closures), requests: w.requests.map((row: any) => ({ ...copy(row), requesterIsViewer: row.requester.id === w.member.id, actions: actions(row) })) })
w.exchangeView = () => ({ ...view(), canPublish: false, canRequest: true, drafts: [], publications: [], requests: [] })
const envelope = (data: any) => ({ contract: 'timetable-interventions.v1', schoolId: w.member.schoolId, memberId: w.member.id, data })
const error = (code: string) => ({ contract: 'timetable-interventions.v1', schoolId: w.member.schoolId, memberId: w.member.id, error: { code } })
function makePreview(input: any) {
  const before = { ...copy(w.lesson), canRequest: false, allowedTargets: [] }
  const after = { ...copy(before), version: before.version + 1 }
  if (input.kind === 'substitute') after.teachers = [person(input.substituteTeacherId)]
  if (input.kind === 'cancel') after.state = 'cancelled'
  if (input.kind === 'makeup') { after.id = 't3-makeup'; after.version = 1; after.state = 'scheduled'; after.time = copy(input.target) }
  if (input.kind === 'reopen') after.state = 'scheduled'
  const changed = { before: input.kind === 'makeup' ? null : before, after }, people = [...new Map([...before.teachers, ...after.teachers].map((t: any) => [t.id, t])).values()]
  return { previewId: 'preview-' + w.calls.length, previewHash: 'a'.repeat(64), createdAt: stamp(), expiresAt: new Date(Date.now() + 600000).toISOString(), input: copy(input), complete: true, changes: [changed], participants: people,
    blockers: w.blocked ? [{ code: 'RESOURCE_BUSY', message: '대강 교사의 다른 수업과 겹칩니다.', lessonIds: [before.id] }] : [], hours: { removedSeconds: input.kind === 'cancel' ? 2700 : 0, addedSeconds: ['makeup', 'reopen'].includes(input.kind) ? 2700 : 0 } }
}
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: w.member.schoolId }], basisDate: w.date }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: copy(args) })
    if (name.endsWith('_readiness')) return envelope(w.notReady ? { available: false, reason: 'not_configured' } : { available: true, reason: null })
    if (name.endsWith('_get')) { if (w.failGet) throw Error('조회 실패'); return envelope(view(args.p_from, args.p_until)) }
    if (name.endsWith('_preview')) {
      const result = makePreview(args.p_input); w.previews[result.previewId] = copy(result)
      if (w.holdPreview) await new Promise(resolve => w.releasePreview = resolve)
      return envelope(result)
    }
    if (name.endsWith('_close')) {
      const key = args.p_request_key
      if (!w.closes[key]) w.closes[key] = { requestKey: key, commandHash: await interventionHash(args.p_command), decidedAt: stamp(), outcome: w.receipts[key] ? 'applied' : 'closed', receipt: w.receipts[key] ?? null }
      if (w.dropClose) { w.dropClose = false; throw Error('닫기 응답 유실') }
      return envelope(copy(w.closes[key]))
    }
    if (!name.endsWith('_execute')) throw Error('미정의 RPC ' + name)
    const command = args.p_command, key = args.p_request_key
    if (w.closes[key]?.outcome === 'closed') return error('CONFLICT')
    if (w.receipts[key]) return envelope(copy(w.receipts[key]))
    if (args.p_recover_only) return error('NOT_FOUND')
    if (w.dropBefore) { w.dropBefore = false; throw Error('처리 전 응답 유실') }
    const commandHash = await interventionHash(command), recordedAt = stamp()
    let row: any
    if (command.kind === 'submit') {
      const p = w.previews[command.preview.previewId]
      row = { id: 'request-' + key, version: 1, proposalHash: p.previewHash, state: 'awaiting_consent', kind: p.input.kind, input: copy(p.input), requester: person(w.member.id), createdAt: recordedAt, expiresAt: new Date(Date.now() + 600000).toISOString(), reason: p.input.reason, changes: copy(p.changes), participants: p.participants.map((t: any) => ({ ...t, response: 'pending', respondedAt: null })) }
      w.requests.push(row)
    } else {
      row = w.requests.find((r: any) => r.id === command.requestId)
      if (!row || row.version !== command.expectedVersion || !actions(row).includes(command.action)) return error('CONFLICT')
      row.version++
      if (command.action === 'accept') { const p = row.participants.find((t: any) => t.id === w.member.id); p.response = 'accepted'; p.respondedAt = recordedAt; if (row.participants.every((t: any) => t.response === 'accepted')) row.state = 'awaiting_approval' }
      else if (command.action === 'approve') { row.state = 'applied'; w.lesson = copy(row.changes[0].after) }
      else if (command.action === 'withdraw') row.state = 'withdrawn'
      else { row.state = 'rejected'; if (command.action === 'reject') { const p = row.participants.find((t: any) => t.id === w.member.id); p.response = 'rejected'; p.respondedAt = recordedAt } }
    }
    w.receipts[key] = { requestKey: key, commandHash, kind: command.kind, entityId: row.id, version: row.version, status: row.state, recordedAt, changedLessons: row.state === 'applied' ? [{ id: w.lesson.id, version: w.lesson.version }] : [] }; w.writes++
    if (w.dropAfter) { w.dropAfter = false; throw Error('처리 후 응답 유실') }
    return envelope(copy(w.receipts[key]))
  },
}
const server = createTimetableInterventionsServer(connection)
const assistant: any = {
  close:async(id:string,input:any,key:string)=>{w.aiCloses??=[];w.aiCloses.push({id,input:copy(input),key});if(w.aiCloseUnknown){w.aiCloseUnknown=false;throw new AssistantError('RESULT_UNKNOWN')}return{state:'closed',requestKey:key}},
  readiness: async () => ({ available: true }),
  ask: async (id: string, input: any, key: string) => {
    w.aiCalls.push({ id, input: copy(input), key });if(w.aiFailCode)throw new AssistantError(w.aiFailCode)
    if (w.aiPending) return { state: 'pending', requestKey: key, reason: 'provider_unknown' }
    const contextHash = /contextHash=([a-f0-9]{64})/.exec(input.prompt)![1]
    const proposal = w.aiMode === 'move' ? { kind: 'move', lesson: 'l0', reason: '상담한 수업 이동', target: span('02') } : { kind: 'substitute', lesson: 'l0', teacher: 't1', reason: '상담한 대강 요청' }
    const result = { state: 'completed', requestKey: key, thread: { exchanges: [{ requestKey: key, prompt: input.prompt, intent: input.intent, segments: [{ text: JSON.stringify({ contextHash, summary: '현재 수업을 확인한 제안입니다.', questions: [], proposal }), citations: [] }] }] } }
    if (w.holdAI) await new Promise(resolve => w.releaseAI = resolve)
    return result
  },
}
function Harness() {
  const [revision, change] = useState(0), [locked, setLocked] = useState(false), [proposal, setProposal] = useState<any>(), [mode, setMode] = useState('interventions')
  const exchanges = useMemo(() => w.exchangeView(), [revision])
  w.refresh = () => change(value => value + 1); w.locked = locked; w.switchMember = (id: string) => { w.member = member(id); change(value => value + 1) }
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><main>
    {w.summary && <TimetableActionSummaryPanel server={{ summary: async () => copy(w.summary) }} member={w.member} date={w.date} onOpen={item => { w.openedSummary = copy(item) }} />}
    <div hidden={mode !== 'interventions'}><TimetableInterventionsPanel server={server} member={w.member} date={w.date} view={exchanges} revision={revision} selectedLessonId="lesson-one" initialIntent={w.initialIntent} onInitialIntentConsumed={token => { w.consumedIntent = token; w.initialIntent = undefined }} assistantServer={assistant} onChanged={w.refresh} onLockChange={setLocked} onExchangeProposal={input => { w.forwarded = copy(input); setProposal({ input, token: Date.now() }); setMode('exchange') }} /></div>
    <div hidden={mode !== 'exchange'}><TimetableExchangePanel server={{} as any} member={w.member} view={exchanges} loading={false} locked={locked} onCommand={async () => { throw Error('명시적 교환 제출은 이번 시험 대상 아님') }} onDirtyChange={() => {}} onReload={w.refresh} proposalSelection={proposal} onProposalSelectionConsumed={() => setProposal(undefined)} /></div>
  </main></PendingRequestsProvider></EditDraftsProvider>
}
w.scope = () => recoveryScope(w.member); w.pendingRow = () => copy(w.pending.get(w.scope(), 'timetableInterventions'))
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.root.render(<Harness />) }
w.mount()
