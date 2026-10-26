import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import policy from './check-policy.json'
import type { PageId } from '../modules'

export const checkModules = [
  { id: 'calendar', label: '학교 일정', rpc: 'workhub_calendar_list', page: 'calendar' },
  { id: 'tasks', label: '내 업무', rpc: 'workhub_task_list', page: 'tasks' },
  { id: 'school', label: '학교 관리', rpc: 'workhub_school_admin_readiness', page: 'schoolAdmin' },
  { id: 'collections', label: '자료 수합', rpc: 'workhub_collection_basic_readiness', page: 'collections' },
  { id: 'messaging', label: '메시지와 알림', rpc: 'workhub_messaging_readiness', page: 'messages' },
  { id: 'cooperation', label: '협업 요청', rpc: 'workhub_cooperation_catalog', page: 'cooperation' },
  { id: 'knowledge', label: '학교 자료', rpc: 'workhub_knowledge_list', page: 'knowledge' },
  { id: 'documents', label: '문서함', rpc: 'workhub_document_list', page: 'documents' },
  { id: 'guided', label: '질문형 양식', rpc: 'workhub_template_list', page: 'documents' },
  { id: 'teaching', label: '수업과 학생', rpc: 'workhub_teaching_catalog', page: 'students' },
  { id: 'home', label: '홈 요약', rpc: 'workhub_home_overview', page: 'home' },
  { id: 'transitions', label: '인계와 학년도', rpc: 'workhub_school_transition_list', page: 'schoolAdmin' },
  { id: 'timetable', label: '시간표 편성', rpc: 'workhub_timetable_readiness', page: 'timetable' },
  { id: 'timetableOperations', label: '시간표 운영', rpc: 'workhub_timetable_operations_readiness', page: 'timetable' },
  { id: 'timetableInterventions', label: '대강·보강 운영', rpc: 'workhub_timetable_interventions_readiness', page: 'timetable' },
  { id: 'participation', label: '업무 참여 설정', rpc: 'workhub_participant_administration', page: 'schoolAdmin' },
  { id: 'schoolRoster', label: '교사 소속 연결', rpc: 'workhub_school_roster_get', page: 'schoolAdmin' },
  { id: 'schoolData', label: '학교 자료 정정', rpc: 'workhub_school_data_get', page: 'students' },
  { id: 'memory', label: '개인 AI 기억', rpc: 'workhub_ai_memory_list', page: 'assistant' },
] as const satisfies readonly { id: string; label: string; rpc: string; page: PageId }[]
export type CheckId = typeof checkModules[number]['id']
export const checkCodes = ['READ_CONFIRMED', 'READY_RESPONSE', 'PARTIAL', 'DATABASE_MISSING', 'STORAGE_MISSING', 'VERIFICATION_MISSING', 'POLICY_MISSING', 'NOT_CONFIGURED', 'APPROVERS_MISSING', 'DISABLED', 'NOT_READY', 'UNAVAILABLE', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'QUERY_FAILED', 'INVALID_RESPONSE', 'CANCELLED', 'TIMEOUT'] as const
export type CheckCode = typeof checkCodes[number]
export interface ModuleCheck { id: CheckId; code: CheckCode; checkedAt: string }
export type CheckRunner = (id: CheckId, signal: AbortSignal) => Promise<ModuleCheck>
const code = (value: unknown): CheckCode => typeof value === 'string' && checkCodes.includes(value as CheckCode) ? value as CheckCode : 'QUERY_FAILED'
const readinessCode = (result: { available: boolean; reason?: string | null }): CheckCode => {
  if (result.available) return 'READY_RESPONSE'
  if (result.reason === 'not_installed') return 'DATABASE_MISSING'
  if (result.reason === 'basis_missing') return 'NOT_READY'
  if (result.reason === 'not_allowed') return 'FORBIDDEN'
  return code(result.reason?.toUpperCase())
}

// T4 import_get은 t1_mark로 원본 판 추적값을 기록하므로 이 읽기 전용 목록에서 제외한다.
// 각 화면의 검증기를 그대로 이용한다. 저장·읽음·파일 획득·AI 호출은 실행하지 않는다.
async function probe(id: CheckId, connection: SupabaseConnection, memberId: string): Promise<CheckCode> {
  switch (id) {
    case 'calendar': await (await import('../connection/supabase-calendar')).createSupabaseCalendarAdapter(connection).list(memberId); return 'READ_CONFIRMED'
    case 'tasks': await (await import('../tasks/supabase-task-adapter')).createSupabaseTaskAdapter(connection).list(memberId); return 'READ_CONFIRMED'
    case 'school': return readinessCode(await (await import('../setup/school-admin-server')).createSupabaseSchoolAdminServer(connection).readiness(memberId))
    case 'collections': return readinessCode(await (await import('../collections/supabase-collections')).createSupabaseCollectionServer(connection).readiness(memberId))
    case 'messaging': {
      const result = await (await import('../messaging/supabase-messaging')).createSupabaseMessagingServer(connection).readiness(memberId)
      return result.available && result.attachments === 'not_configured' ? 'PARTIAL' : readinessCode(result)
    }
    case 'cooperation': await (await import('../cooperation/adapter')).createCooperationAdapter(connection).catalog(memberId); return 'READ_CONFIRMED'
    case 'knowledge': await (await import('../knowledge/adapter')).createKnowledgeService(connection).list(memberId, ''); return 'READ_CONFIRMED'
    case 'documents': await (await import('../documents/adapter')).createDocumentsService(connection).list(memberId, '', false); return 'READ_CONFIRMED'
    case 'guided': await (await import('../documents/guided-adapter')).createGuidedService(connection).list(memberId); return 'READ_CONFIRMED'
    case 'teaching': await (await import('../teaching/adapter')).createTeachingAdapter(connection).catalog(memberId); return 'READ_CONFIRMED'
    case 'home': return (await (await import('../home/overview')).createHomeService(connection).load(memberId)).unavailable.length ? 'PARTIAL' : 'READ_CONFIRMED'
    case 'transitions': return (await (await import('../administration/transitions')).createTransitionService(connection).list(memberId)).dutyApproval === null ? 'PARTIAL' : 'READ_CONFIRMED'
    case 'timetable': return readinessCode(await (await import('../timetable/server')).createTimetableServer(connection).readiness(memberId))
    case 'timetableOperations': return readinessCode(await (await import('../timetable/operations-server')).createTimetableOperationsServer(connection).readiness(memberId))
    case 'timetableInterventions': return readinessCode(await (await import('../timetable/interventions-server')).createTimetableInterventionsServer(connection).readiness(memberId))
    case 'participation': {
      const member = connection.info().memberships.find(item => item.id === memberId)
      if (!member) return 'CANCELLED'
      const raw = await connection.rpcVerified('workhub_participant_administration', { p_member_id: memberId })
      const { participantAdministration } = await import('../participation/contracts')
      participantAdministration(raw, member)
      // 만료된 허용도 목록에 남는다. 목록 성공을 참여 허용으로 표시하지 않는다.
      return 'READ_CONFIRMED'
    }
    case 'schoolRoster': return readinessCode(await (await import('../setup/school-roster-server')).createSchoolRosterServer(connection).get(memberId))
    case 'schoolData': return readinessCode(await (await import('../teaching/school-data-maintenance-server')).createSchoolDataMaintenanceServer(connection).get(memberId, null))
    // 비활성 상태에서도 목록은 읽을 수 있다. 목록 성공만으로 개인 기억의 쓰기 준비를 표시하지 않는다.
    case 'memory': return (await (await import('../assistant/memory-server')).createAiMemoryService(connection).list(memberId)).canWrite ? 'READY_RESPONSE' : 'DISABLED'

  }
}

export function createModuleChecker(connection: SupabaseConnection, memberId: string, options: { timeoutMs?: number } = {}): CheckRunner {
  const timeoutMs = options.timeoutMs ?? policy.timeoutMs
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw new Error('점검 대기 시간을 확인해 주세요.')
  return async (id, signal) => {
    const definition = checkModules.find(item => item.id === id)
    if (!definition) throw new Error('지원하지 않는 점검입니다.')
    const scope = () => { const member = connection.info().memberships.find(item => item.id === memberId); return member ? recoveryScope(member) : '' }
    const originalScope = scope()
    let ended = false, timer: ReturnType<typeof setTimeout> | undefined, removeAbort = () => {}
    const ensureCurrent = () => { if (ended || signal.aborted || !originalScope || scope() !== originalScope) throw { code: 'CANCELLED' } }
    // 인증은 기존 연결에 위임한다. 지연된 시작과 조회 이외 호출만 이 점검에서 차단한다.
    const guarded: SupabaseConnection = { ...connection, async getIdentity() { ensureCurrent(); const identity = await connection.getIdentity(); ensureCurrent(); return identity }, async rpcVerified(name, args) {
      ensureCurrent()
      if (name !== definition.rpc) throw { code: 'INVALID_RESPONSE' }
      const response = await connection.rpcVerified(name, args)
      ensureCurrent()
      return response
    } }
    let result: CheckCode
    try {
      ensureCurrent()
      result = await Promise.race([
        probe(id, guarded, memberId),
        new Promise<CheckCode>(resolve => {
          const abort = () => { ended = true; resolve('CANCELLED') }
          signal.addEventListener('abort', abort, { once: true }); removeAbort = () => signal.removeEventListener('abort', abort)
          timer = setTimeout(() => { ended = true; resolve('TIMEOUT') }, timeoutMs)
        }),
      ])
      if (signal.aborted || scope() !== originalScope) result = 'CANCELLED'
    } catch (error) { result = signal.aborted || scope() !== originalScope ? 'CANCELLED' : code(error && typeof error === 'object' && 'code' in error ? error.code : null) }
    finally { ended = true; clearTimeout(timer); removeAbort() }
    return { id, code: result, checkedAt: new Date().toISOString() }
  }
}

// 원문·자료 개수·식별자는 내보내지 않고 고정 코드와 시각만 추린다.
export function exportModuleChecks(results: readonly ModuleCheck[]): string {
  const seen = new Set<string>()
  const checks = results.map(result => {
    if (!checkModules.some(item => item.id === result.id) || seen.has(result.id) || !checkCodes.includes(result.code) || typeof result.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.checkedAt) || !Number.isFinite(Date.parse(result.checkedAt)) || new Date(result.checkedAt).toISOString() !== result.checkedAt) throw new Error('점검 결과를 확인해 주세요.')
    seen.add(result.id)
    return { id: result.id, code: result.code, checkedAt: result.checkedAt }
  })
  return JSON.stringify({ format: 'workhub-module-check.v1', scope: 'read_only', checks }, null, 2)
}
