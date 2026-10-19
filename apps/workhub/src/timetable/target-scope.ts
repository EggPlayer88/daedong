import { canonical, ServiceError } from '../services/scoped-rpc'
import type { TargetServer, TargetSnapshot } from './target'
import type { TimetableServer } from './contracts'
import type { PreparationServer } from './preparation'
import type { SetupServer } from './setup'

export const targetScopeKey = (value: TargetSnapshot) => canonical([value.termId, value.selectedTermId, value.version])
export interface TargetScopeState { checking: boolean; snapshot?: TargetSnapshot }

/** 조회 응답을 학기별로 검증한다. 이미 접수된 명령의 복구에는 현재 선택을 요구하지 않는다. */
export function scopeTimetableServers(options: {
  target?: TargetServer
  state: () => TargetScopeState
  observe: (snapshot: TargetSnapshot) => void
  mismatch: () => void
  timetable: TimetableServer
  preparation?: PreparationServer
  setup?: SetupServer
}) {
  const contexts = new Map<string, { termId: string; key?: string }>()
  function reject(): never { options.mismatch(); throw new ServiceError('CONFLICT') }
  function assertTerm(termId: string | null, started?: TargetSnapshot) {
    const now = options.state().snapshot
    if (started && now && targetScopeKey(started) !== targetScopeKey(now)) reject()
    if (now && now.termId !== termId) reject()
  }
  async function beforeWrite(memberId: string) {
    const state = options.state()
    // 이전 T1 서버는 대상 학기 API가 없으므로 기존 계약을 계속 사용한다.
    if (!options.target || !state.snapshot) return
    if (state.checking) throw new ServiceError('CONFLICT')
    const original = structuredClone(state.snapshot), fresh = await options.target.get(memberId)
    const current = options.state()
    options.observe(fresh)
    if (current.checking || !current.snapshot || targetScopeKey(original) !== targetScopeKey(current.snapshot) || targetScopeKey(original) !== targetScopeKey(fresh)) reject()
  }
  const timetable: TimetableServer = {
    ...options.timetable,
    async get(memberId, week) {
      const started = options.state().snapshot, result = await options.timetable.get(memberId, week)
      if (result.basis) assertTerm(result.basis.termId, started)
      return result
    },
    async saveDraft(memberId, input, key) {
      await beforeWrite(memberId)
      return options.timetable.saveDraft(memberId, input, key)
    },
    recoverDraft: (...args) => options.timetable.recoverDraft(...args),
  }
  const preparation: PreparationServer | undefined = options.preparation && {
    async get(memberId) {
      const started = options.state().snapshot, result = await options.preparation!.get(memberId)
      assertTerm(result.termId, started)
      return result
    },
    async execute(memberId, input, key) {
      await beforeWrite(memberId); assertTerm(input.termId)
      return options.preparation!.execute(memberId, input, key)
    },
    recover: (...args) => options.preparation!.recover(...args),
  }
  const setup: SetupServer | undefined = options.setup && {
    async get(memberId) {
      const started = options.state().snapshot, result = await options.setup!.get(memberId)
      assertTerm(result.termId, started)
      const snapshot = options.state().snapshot
      contexts.set(memberId, { termId: result.termId, key: snapshot && targetScopeKey(snapshot) })
      return result
    },
    async execute(memberId, command, key) {
      await beforeWrite(memberId)
      const context = contexts.get(memberId), snapshot = options.state().snapshot
      if (snapshot) {
        if (!context || context.key !== targetScopeKey(snapshot)) reject()
        assertTerm(context.termId)
      }
      return options.setup!.execute(memberId, command, key)
    },
    recover: (...args) => options.setup!.recover(...args),
  }
  return { timetable, preparation, setup }
}
