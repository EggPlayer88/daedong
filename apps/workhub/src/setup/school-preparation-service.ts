import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { recoveryScope } from '../app/pending-requests'
import { canonical, object, ServiceError } from '../services/scoped-rpc'
import { createSchoolRosterServer } from './school-roster-server'
import { createSupabaseSchoolAdminServer } from './school-admin-server'
import { createTeachingAdapter } from '../teaching/adapter'
import { createTimetableTargetServer } from '../timetable/target-server'
import { createTimetableSetupServer } from '../timetable/setup-server'
import { createPreparationServer } from '../timetable/preparation-server'
import { createTimetableImportServer } from '../timetable/import-server'
import { schoolPreparationSummary, type PreparationRead, type SchoolPreparationReport } from './school-preparation-summary'

export interface SchoolPreparationService { get(memberId: string): Promise<SchoolPreparationReport> }

/** 화면을 열었을 때만 읽는다. 기존 조회 어댑터의 학교·신원·응답 검증을 그대로 사용한다. */
export function createSchoolPreparationService(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): SchoolPreparationService {
  const roster = createSchoolRosterServer(connection, options), school = createSupabaseSchoolAdminServer(connection, options)
  const teaching = createTeachingAdapter(connection, options), target = createTimetableTargetServer(connection, options)
  const setup = createTimetableSetupServer(connection, options), preparation = createPreparationServer(connection, options)
  const imported = createTimetableImportServer(connection, options)
  function scope(memberId: string) {
    const info = connection.info(), member = info.memberships.find(row => row.id === memberId)
    if (!member || !info.schools.some(row => row.id === member.schoolId) || !activeAt(member, info.basisDate)) throw new ServiceError('INACTIVE_MEMBERSHIP')
    return canonical([recoveryScope(member), info.basisDate])
  }
  async function read<T>(run: () => Promise<T>): Promise<PreparationRead<T>> {
    try { return { ok: true, value: await run() } }
    catch (error) {
      // 인증·소속 전환은 전체 결과를 버린다. 다른 조회 실패는 해당 단계만 확인 필요로 남긴다.
      if (object(error) && ['CANCELLED', 'INACTIVE_MEMBERSHIP'].includes(String(error.code))) throw error
      return { ok: false, code: object(error) && typeof error.code === 'string' ? error.code : 'QUERY_FAILED' }
    }
  }
  return { async get(memberId) {
    const original = scope(memberId), firstTarget = await read(() => target.get(memberId))
    const term = firstTarget.ok ? firstTarget.value.terms.find(row => row.id === firstTarget.value.termId) : undefined
    const settled = await Promise.allSettled([
      read(() => roster.get(memberId)), read(() => school.get(memberId, term?.schoolYear)), read(() => teaching.catalog(memberId)),
      read(() => setup.get(memberId)), read(() => preparation.get(memberId)), read(() => imported.get(memberId)),
    ] as const)
    // allSettled로 모든 응답을 수거한 뒤 계정 전환 실패를 다시 올린다.
    for (const result of settled) if (result.status === 'rejected') throw result.reason
    if (scope(memberId) !== original) throw new ServiceError('CANCELLED')
    const [rosterRead, schoolRead, teachingRead, setupRead, preparationRead, importRead] = settled.map(row => row.status === 'fulfilled' ? row.value : undefined) as [
      Awaited<ReturnType<typeof roster.get>> extends infer T ? PreparationRead<T> : never,
      Awaited<ReturnType<typeof school.get>> extends infer T ? PreparationRead<T> : never,
      Awaited<ReturnType<typeof teaching.catalog>> extends infer T ? PreparationRead<T> : never,
      Awaited<ReturnType<typeof setup.get>> extends infer T ? PreparationRead<T> : never,
      Awaited<ReturnType<typeof preparation.get>> extends infer T ? PreparationRead<T> : never,
      Awaited<ReturnType<typeof imported.get>> extends infer T ? PreparationRead<T> : never,
    ]
    // 학기 선택을 서버에서 바꾸는 중이면 서로 다른 학기의 수치를 한 장에 섞지 않는다.
    const lastTarget = firstTarget.ok ? await read(() => target.get(memberId)) : firstTarget
    if (scope(memberId) !== original) throw new ServiceError('CANCELLED')
    const stable = firstTarget.ok && lastTarget.ok && canonical(firstTarget.value) === canonical(lastTarget.value)
    const targetRead = stable ? lastTarget : { ok: false as const, code: lastTarget.ok ? 'CONFLICT' : lastTarget.code }
    return schoolPreparationSummary({ roster: rosterRead, target: targetRead, school: schoolRead, teaching: teachingRead,
      setup: setupRead, preparation: preparationRead, imported: importRead }, new Date().toISOString())
  } }
}
