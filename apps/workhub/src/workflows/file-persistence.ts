import type { WorkflowSnapshot } from './types'

// 파일 바이트와 연결된 자료는 현재 탭 메모리에만 둔다. 접수 결과의 과거 양식도 함께 제외한다.
export function persistentWorkflowSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const result = structuredClone(snapshot)
  const requests = new Set(result.requests.filter(value => value.fileCollection !== undefined).map(value => value.id))
  const fileUnits = new Set([...result.drafts, ...result.submissions].filter(value => value.files !== undefined).map(value => value.unitId))
  for (const receipt of result.receipts) {
    const value = receipt.result as Record<string, unknown>
    if (receipt.kind === 'request' && value.fileCollection !== undefined) requests.add(receipt.resourceId)
    if ((receipt.kind === 'draft' || receipt.kind === 'submission') && value.files !== undefined && typeof value.unitId === 'string') fileUnits.add(value.unitId)
  }
  for (const unit of result.units) if (fileUnits.has(unit.id)) requests.add(unit.requestId)
  const units = new Set(result.units.filter(value => requests.has(value.requestId)).map(value => value.id))
  const draftIds = new Set(result.drafts.filter(value => units.has(value.unitId)).map(value => value.id))
  const submissionIds = new Set(result.submissions.filter(value => units.has(value.unitId)).map(value => value.id))
  result.requests = result.requests.filter(value => !requests.has(value.id))
  result.units = result.units.filter(value => !units.has(value.id))
  result.drafts = result.drafts.filter(value => !units.has(value.unitId))
  result.submissions = result.submissions.filter(value => !units.has(value.unitId))
  result.reviews = result.reviews.filter(value => !units.has(value.unitId))
  result.supplements = result.supplements.filter(value => !units.has(value.unitId))
  result.withdrawals = result.withdrawals.filter(value => !units.has(value.unitId))
  result.receipts = result.receipts.filter(value => value.kind === 'task' || !(value.kind === 'request' ? requests : value.kind === 'unit' ? units : value.kind === 'draft' ? draftIds : submissionIds).has(value.resourceId))
  return result
}
