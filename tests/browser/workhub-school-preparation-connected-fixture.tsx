import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { ContractError } from '../../apps/workhub/src/contracts'
import { preparationMember, preparationRpcKeys, schoolPreparationEnvelope, schoolPreparationFixture } from '../fixtures/school-preparation.mjs'

// 부모 셸과 하위 화면·어댑터는 실제 코드다. 이 시험은 읽기 전용 합성 응답만 제공한다.
const w: any = window, copy = (value: any) => structuredClone(value)
const member = copy(preparationMember), labels = { departmentIds: [], gradeIds: [], subjectIds: [] }
const context = { schools: [{ id: member.schoolId, name: '시험 학교' }], memberships: [member], basisDate: '2026-10-21', relationLabels: labels, schoolLabels: { [member.schoolId]: labels } }
const identity = { userId: member.userId, approved: true, profile: { id: member.userId, name: '관리자', email: 'fixture@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true } }
w.state = schoolPreparationFixture(); w.calls = []; w.writes = []; w.fail = ''; w.missing = ''
const wrap = (contract: string, data: unknown) => ({ contract, schoolId: member.schoolId, memberId: member.id, data })
const connection: any = {
  info: () => copy(context), getIdentity: async () => copy(identity), loadContext: async () => copy(context),
  subscribeIdentity: (callback: () => void) => { w.refreshIdentity = callback; return () => {} },
  subscribeInvalidation: () => () => {},
  rpcVerified: async (name: string, args: unknown) => {
    w.calls.push({ name, args: copy(args) })
    if (name === w.fail) throw new ContractError('QUERY_FAILED')
    if (name === w.missing) throw { code: 'PGRST202' }
    if (name === 'workhub_school_admin_readiness') return { kind: 'workhub-school-admin', schemaVersion: 1, schoolId: member.schoolId, memberId: member.id, data: { available: true } }
    if (name === 'workhub_timetable_readiness') return wrap('timetable.v1', { available: false, reason: 'basis_missing' })
    if (name === 'workhub_timetable_interventions_readiness') return wrap('timetable-interventions.v1', { available: false, reason: 'not_installed' })
    if (name === 'workhub_timetable_operations_readiness') return wrap('timetable-operations.v1', { available: false, reason: 'not_installed' })
    const key = preparationRpcKeys[name as keyof typeof preparationRpcKeys]
    if (key) return schoolPreparationEnvelope(name, copy(w.state[key]))
    w.writes.push({ name, args: copy(args) })
    throw Error(`읽기 이동 시험에서 허용하지 않은 RPC: ${name}`)
  },
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={member.userId} legacyHomeHref="/legacy" connection={connection} />)
