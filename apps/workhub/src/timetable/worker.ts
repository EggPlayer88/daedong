import { solveTimetable } from '../../../../packages/timetable/src/solver'
import { timetablePolicy } from '../../../../packages/timetable/src/validate'

// 계산은 별도 스레드에 격리한다. 취소는 클라이언트가 이 작업자 자체를 종료한다.
self.onmessage = (event: MessageEvent) => {
  const message = event.data
  if (!message || typeof message.id !== 'string' || !Object.hasOwn(message, 'basis')) return
  try {
    const result = solveTimetable(message.basis, { maxNodes: timetablePolicy.defaultMaxNodes, maxMs: timetablePolicy.defaultMaxMs })
    self.postMessage({ id: message.id, result })
  } catch {
    self.postMessage({ id: message.id, error: 'CALCULATION_FAILED' })
  }
}
