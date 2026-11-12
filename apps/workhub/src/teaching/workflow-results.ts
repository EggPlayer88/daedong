import type { Membership } from '../contracts'
import { recoveryScope } from '../services/recovery-scope'
import type { WorkflowResult, WorkflowResultListener } from '../app/workflow-results'
import type { MutationReceipt, TeachingCommand } from './contracts'

// 상담의 본문뿐 아니라 저장·철회 사실도 AI 업무목록에 복제하지 않는다.
function teachingResult(member: Membership, command: TeachingCommand, receipt: MutationReceipt): WorkflowResult | undefined {
  if (command.kind === 'counseling_save' || command.kind === 'record_withdraw' && command.recordKind === 'counseling') return
  const base = { kind: 'teaching' as const, scope: recoveryScope(member), key: receipt.requestKey,
    recordedAt: receipt.appliedAt, courseId: command.kind === 'course_create' ? receipt.entityId : command.courseId,
    entityId: receipt.entityId, entityVersion: receipt.version }
  if (command.kind === 'record_withdraw') {
    if (command.recordKind === 'counseling') return
    return { ...base, action: command.kind, recordKind: command.recordKind }
  }
  if (command.kind === 'assessment_save') return { ...base, action: command.kind, confirmed: command.confirmed }
  if (command.kind === 'activity_review') return { ...base, action: command.kind, disposition: command.disposition }
  if (command.kind === 'activity_correct') return { ...base, action: command.kind, previousImportId: command.previousImportId }
  return { ...base, action: command.kind }
}

export function reportTeachingResult(listener: WorkflowResultListener | undefined, member: Membership, command: TeachingCommand, receipt: MutationReceipt) {
  if (!listener) return
  const result = teachingResult(member, command, receipt)
  if (!result) return
  try { listener(result) } catch {
    // 보조 결과 표시 실패가 검증된 저장이나 원래 요청의 복구 상태를 바꾸지 않는다.
  }
}
