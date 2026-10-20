import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableOperationsPanel } from '../../apps/workhub/src/timetable/TimetableOperationsWorkspace'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
import { ServiceError } from '../../apps/workhub/src/services/scoped-rpc'
import { operationCommandHash } from '../../apps/workhub/src/timetable/operations-server'
import styles from '../../apps/workhub/src/style.css?inline'

// 실제 React와 기간·입력·복구 연결을 시험한다. 서버 값과 쓰기 결과는 합성이다.
const w: any = window, copy = (value: any) => structuredClone(value)
const now = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
w.date = day(0); w.future = day(3); w.later = day(35); w.calls = []; w.writes = 0; w.receipts = {}
w.pending = createPendingRequests(); w.drafts = createEditDrafts()
const member = { id: 'teacher-a', userId: 'user-a', schoolId: 'school', name: '원담당', role: 'school_admin', active: true, validFrom: '2020-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const person = { id: member.id, name: member.name }, replacement = { id: 'teacher-b', name: '대강 교사' }
const time = (date: string, hour = '00') => ({ startsAt: date + `T${hour}:00:00.000Z`, endsAt: date + `T${hour}:45:00.000Z` })
const lesson = (id: string, label: string, state = 'scheduled') => ({ id, label, version: 1, time: time(w.future), teachers: [person], groupNames: ['1학년 1반'], roomNames: ['1반 교실'], state, canRequest: state === 'scheduled', allowedTargets: state === 'scheduled' ? [time(w.future, '01')] : [] })
w.lessons = [lesson('scheduled', '선택 국어'), lesson('cancelled', '취소 과학', 'cancelled')]
const getLessons = (from: string, until: string) => w.lessons.filter((row: any) => row.time.startsAt.slice(0, 10) >= from && row.time.startsAt.slice(0, 10) < until)
const before = copy(w.lessons[0]), after = { ...copy(before), version: 2, time: time(w.future, '01') }
w.exchange = { id: 'blocked-request', version: 1, proposalHash: 'a'.repeat(64), state: 'awaiting_approval', kind: 'move', requester: person, requesterIsViewer: true, createdAt: now(), expiresAt: new Date(Date.now() + 600000).toISOString(), reason: '보존할 교환 요청', changes: [{ before, after }], participants: [{ ...person, response: 'accepted', respondedAt: now() }], actions: ['withdraw'] }
const operations: any = {
  readiness: async () => ({ available: true }),
  get: async (_member: string, from: string, until: string) => {
    w.calls.push({ method: 'operations.get', from, until })
    return { asOf: now(), timeZone: 'Asia/Seoul', from, until, canPublish: true, canRequest: true, lessons: copy(getLessons(from, until)), requests: w.blocking ? [copy(w.exchange)] : [], publications: [], drafts: [{ id: 'draft', version: 1, title: '새 학기 초안' }] }
  },
  previewPublish: async (_member: string, input: any) => ({ previewId: 'publication-preview', previewHash: 'a'.repeat(64), createdAt: now(), expiresAt: new Date(Date.now() + 600000).toISOString(), input: copy(input), complete: true, changes: [], participants: [], blockers: [], excludedDays: [], preserved: { outsideRange: true, pastRecords: true, existingChanges: 'retained' } }),
  previewExchange: async () => { throw Error('이 시험은 교환 입력까지만 확인') },
  execute: async (_member: string, command: any, key: string) => {
    w.calls.push({ method: 'execute', command: copy(command), key })
    w.receipts[key] = { requestKey: key, commandHash: await operationCommandHash(command), kind: command.kind, entityId: 'publication', version: 1, status: 'published', recordedAt: now(), changedLessons: [] }; w.writes++
    if (w.dropResult) throw new ServiceError('RESULT_UNKNOWN')
    return copy(w.receipts[key])
  },
  recover: async (_member: string, command: any, key: string) => { w.calls.push({ method: 'recover', command: copy(command), key }); return copy(w.receipts[key]) },
}
const extensions: any = {
  references: async (_member: string, source: any) => ({ asOf: source.asOf, from: source.from, until: source.until, lessons: source.lessons.map((row: any) => ({ lessonId: row.id, version: row.version, groups: [{ id: 'class', name: '1학년 1반' }], rooms: [{ id: 'room', name: '1반 교실' }] })) }),
}
const interventions: any = {
  readiness: async () => ({ available: true, reason: null }),
  get: async (_member: string, from: string, until: string) => {
    w.calls.push({ method: 'interventions.get', from, until })
    if (w.failT3) throw new ServiceError('FORBIDDEN')
    return { asOf: now(), timeZone: 'Asia/Seoul', from, until, lessons: copy(getLessons(from, until)), teachers: [person, replacement], closures: [], requests: copy(w.interventionRequests ?? []) }
  },
}
const schoolDay: any = {
  preview: async (_member: string, input: any, source: any) => {
    const rows = source.lessons.filter((row: any) => row.state === 'scheduled' && row.time.startsAt.startsWith(input.date))
    return { input: copy(input), sourceAsOf: source.asOf, previewId: 'day-preview', previewHash: 'b'.repeat(64), createdAt: now(), expiresAt: new Date(Date.now() + 600000).toISOString(), complete: true,
      coverage: { date: input.date, groupIds: input.groupIds, complete: true, existingRequests: 'complete' }, affectedLessons: rows.map((row: any) => ({ lessonId: row.id, version: row.version })),
      changes: rows.map((row: any) => ({ before: copy(row), after: { ...copy(row), version: row.version + 1, state: 'cancelled' } })),
      requestEffects: w.blocking ? [{ requestId: w.exchange.id, version: w.exchange.version, state: w.exchange.state, handling: 'blocked' }] : [],
      blockers: w.blocking ? [{ code: 'PENDING_REQUEST', message: '기존 교환 확인 필요' }] : [], preserved: { pastRecords: true, outsideTarget: true, existingChanges: w.blocking ? 'blocked' : 'retained' }, lostLessonCount: rows.length, lostSeconds: rows.length * 2700, changesActualSchedule: false }
  },
}
const records: any = {
  get: async (_member: string, id: string) => {
    w.calls.push({ method: 'records.get', id }); const row = w.lessons.find((value: any) => value.id === id)
    return { asOf: now(), timeZone: 'Asia/Seoul', lesson: { id, version: row.version, label: row.label, startsAt: row.time.startsAt, endsAt: row.time.endsAt, state: row.state, teacherIds: row.teachers.map((value: any) => value.id) }, current: null, history: [], nextCursor: null, allowedOutcomes: [] }
  },
}
function Harness() {
  const [revision, setRevision] = useState(0); w.refresh = () => setRevision(value => value + 1)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><TimetableOperationsPanel member={member} date={w.date} initialDate={w.future} server={operations} extensions={extensions} interventions={interventions} schoolDayExecution={schoolDay} executionRecords={records} revision={revision} onNavigationLockChange={value => w.locked = value} /></PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
