import type { TimetableBasis, SolveResult } from '../../../../packages/timetable/src/types'
import { timetablePolicy, validateSolveResult } from '../../../../packages/timetable/src/validate'

export interface SolverTask { promise: Promise<SolveResult>; cancel(): void }
export type TimetableSolver = (basis: TimetableBasis) => SolverTask
export class TimetableSolverError extends Error {
  constructor(readonly code: 'CANCELLED' | 'UNAVAILABLE' | 'TIMEOUT' | 'FAILED') {
    super({ CANCELLED: '계산을 중지했습니다. 입력은 유지됩니다.', UNAVAILABLE: '이 브라우저에서 별도 계산 작업자를 시작하지 못했습니다.', TIMEOUT: '계산 응답을 확인하지 못했습니다. 불가능하다고 판정한 것은 아닙니다.', FAILED: '계산 결과를 확인하지 못했습니다. 조건과 입력은 유지됩니다.' }[code])
  }
}
export function startTimetableSolve(basis: TimetableBasis): SolverTask {
  const source = structuredClone(basis)
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, settled = false
  let fail: (error: TimetableSolverError) => void = () => {}
  const promise = new Promise<SolveResult>((resolve, reject) => {
    const finish = (value?: SolveResult, error?: TimetableSolverError) => {
      if (settled) return
      settled = true; clearTimeout(timer); worker?.terminate()
      if (error) reject(error); else resolve(value!)
    }
    fail = error => finish(undefined, error)
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      const id = crypto.randomUUID()
      worker.onmessage = event => {
        if (event.data?.id !== id) return
        if (event.data.error || !validateSolveResult(source, event.data.result)) { fail(new TimetableSolverError('FAILED')); return }
        finish(event.data.result)
      }
      worker.onerror = () => fail(new TimetableSolverError('FAILED'))
      worker.onmessageerror = () => fail(new TimetableSolverError('FAILED'))
      // 작업자 내부 탐색 제한과 별개로 전달 오류에도 UI를 계속 사용할 수 있게 한다.
      timer = setTimeout(() => fail(new TimetableSolverError('TIMEOUT')), timetablePolicy.defaultMaxMs + 5000)
      worker.postMessage({ id, basis: source })
    } catch { fail(new TimetableSolverError('UNAVAILABLE')) }
  })
  return { promise, cancel: () => fail(new TimetableSolverError('CANCELLED')) }
}
