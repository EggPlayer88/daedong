import React from 'react'
import { createRoot } from 'react-dom/client'
import { TeacherPilotEntry } from '../../apps/workhub/src/participation/TeacherPilotEntry'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'
import { createDialogueTaskFixture } from './workhub-dialogue-task-fixture'

// 인증·DB 응답만 합성한다. 일반 교사 진입점과 실제 AI 연결 셸·작업 화면을 그대로 사용한다.
const w = window as any, config = w.pilotCase ?? {}, clone = structuredClone
const school = fixtureData.schools[0]
const self = { ...fixtureData.memberships[0], id: 'member-01', userId: 'user-01', schoolId: school.id, role: 'teacher', name: '[시험] 가상 교사', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const context = { schools: [school], memberships: [self], basisDate: '2026-11-16', schoolLabels: { [school.id]: relationLabels } }
const access = { userId: self.userId, schoolId: self.schoolId, memberId: self.id, scopes: ['messages', 'tasks', 'calendar', 'cooperation', 'collections', 'transitions', 'teaching', 'timetable'], expiresAt: '2026-11-23T03:00:00.000Z', revision: 1 }
const capability = { contract: 'workhub.teacher-pilot.v1', allowed: true, userId: self.userId, schoolId: self.schoolId, memberId: self.id, batchId: 'batch-ten', teacherId: 'roster-one', expiresAt: config.short ? '2026-11-16T03:00:03.000Z' : access.expiresAt, revision: 1, ...config.capability }
const qaTasks = createDialogueTaskFixture(self)
const qa = w.qa = { calls: [], qaTasks, allowed: config.allowed !== false, revision: 1, revoke() { qa.allowed = false; window.dispatchEvent(new Event('focus')) }, revise() { qa.revision++; window.dispatchEvent(new Event('focus')) } }
const services: any = {
  getSession: async () => ({ user: { id: self.userId } }),
  fetchMyProfile: async () => ({ id: self.userId, name: self.name, email: 'synthetic@example.invalid', role: 'teacher', extra_permissions: [], department_id: null, is_active: true }),
  onAuthStateChange() { return () => {} }, async signOut() {}, async signInWithGoogle() {},
  async rpc(name: string, args: any) {
    qa.calls.push(clone({ name, args }))
    const ok = (data: any) => ({ data: clone(data), error: null })
    if (name === 'workhub_teacher_pilot_access') {
      if (config.missing) return { data: null, error: { code: 'PGRST202', message: 'missing' } }
      if (config.failure) throw Error('합성 연결 실패')
      return ok(qa.allowed ? { ...capability, revision: qa.revision } : { contract: capability.contract, userId: self.userId, allowed: false })
    }
    if (name === 'workhub_participant_context') return ok(context)
    if (name === 'workhub_calendar_list') return ok([])
    if (name === 'workhub_school_transition_list') return ok({ contract: 'school-transitions.v1', schoolId: self.schoolId, memberId: self.id, data: { canManageYear: false, dutyApproval: 'admin_review_v1', years: [], recipients: [], resources: [], records: [], nextCursor: null } })
    if (name === 'workhub_task_mutate' && config.denyTask) return { data: null, error: { message: 'FORBIDDEN' } }
    if (['workhub_task_list', 'workhub_task_get', 'workhub_task_mutate'].includes(name)) return qaTasks.rpc(name, args)
    if (name === 'workhub_collection_list') return ok({ contractVersion: 1, schoolId: self.schoolId, memberId: self.id, error: { code: 'NOT_READY' } })
    return { data: null, error: { message: 'NOT_READY' } }
  },
}
createRoot(document.getElementById('root')!).render(<TeacherPilotEntry access={access} legacyHomeHref="/account" connection={createSupabaseConnection(services, { participant: true })}/>)
