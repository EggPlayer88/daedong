import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetablePreparationPanel } from '../../apps/workhub/src/timetable/TimetablePreparationPanel'
import { createPreparationServer } from '../../apps/workhub/src/timetable/preparation-server'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import themeStyles from '../../apps/workhub/src/timetable/timetable-theme.css?inline'
import preparationStyles from '../../apps/workhub/src/timetable/timetable-preparation-flow.css?inline'
import progressStyles from '../../apps/workhub/src/timetable/preparation-progress.css?inline'

// 화면·전송 어댑터는 실제 구현, 학교와 조회 응답만 합성 자료이다.
const w = window as any
const member = { id: 'm', schoolId: 's', userId: 'u', name: '합성 담당자', role: 'admin', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.calls = []; w.drafts = createEditDrafts(); w.pending = createPendingRequests()
w.source = { sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), schoolId: 's', schoolLevel: 'middle', termId: 't', termLabel: '2027학년도 1학기', firstDay: '2027-03-01', lastDay: '2027-07-20', canEdit: true, canConfirm: true,
  resources: [{ id: 'teacher', kind: 'teacher', label: '합성 김교사', capacity: 1 }, { id: 'class', kind: 'class', label: '1학년 1반', capacity: 1 }],
  courses: [{ id: 'course-a', label: '국어', requiredPeriods: null, resourceIds: ['teacher', 'class'] }, { id: 'course-b', label: '과학', requiredPeriods: 2, resourceIds: ['teacher', 'class'] }], unsupportedFeatures: [], savedDraft: null }
const connection: any = { info: () => ({ memberships: [member], schools: [{ id: 's' }], basisDate: '2026-10-27' }), getIdentity: async () => ({ userId: 'u', approved: true }), rpcVerified: async (name: string, args: unknown) => {
  w.calls.push({ name, args: structuredClone(args) })
  if (name.endsWith('_get')) return { contract: 'timetable.preparation.v1', schoolId: 's', memberId: 'm', data: structuredClone(w.source) }
  throw Error('이 화면 이동 시험에서는 쓰기 호출을 허용하지 않습니다.')
} }
const server = createPreparationServer(connection)
createRoot(document.getElementById('root')!).render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{themeStyles + baseStyles + preparationStyles + progressStyles}</style><section className="timetable-workspace"><TimetablePreparationPanel initialOpen server={server} member={member as any} disabled={false} onLockChange={locked => { w.locked = locked }} /></section></PendingRequestsProvider></EditDraftsProvider>)
