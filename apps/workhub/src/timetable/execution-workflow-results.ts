import type { WorkflowResultListener } from '../app/workflow-results'
import type { ExecutionRecordCommand, ExecutionRecordReceipt } from './execution-records'

// 서버가 검증한 원요청 접수만 표시한다. 기록 결과는 학교 업무 전체의 완료를 뜻하지 않는다.
export function reportExecutionResult(listener: WorkflowResultListener | undefined, scope: string, key: string,
  command: ExecutionRecordCommand, receipt: ExecutionRecordReceipt) {
  if (!listener) return
  try {
    const record = receipt.record
    if (receipt.requestKey !== key || record.lessonId !== command.lessonId || record.lessonVersion !== command.expectedLessonVersion ||
        record.version !== command.expectedRecordVersion + 1 || command.expectedRecordId !== null && record.id !== command.expectedRecordId || record.outcome !== command.outcome) return
    listener({ kind: 'execution', action: command.expectedRecordVersion === 0 ? 'save' : 'correct', scope, key: receipt.requestKey,
      recordedAt: record.recordedAt, recordId: record.id, recordVersion: record.version, lessonId: record.lessonId, lessonVersion: record.lessonVersion, outcome: record.outcome })
  } catch {
    // AI 목록의 보조 표시 실패가 검증된 접수와 원래 요청의 복구 상태를 바꾸지 않는다.
  }
}
