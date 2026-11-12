import type { WorkflowResultListener } from '../app/workflow-results'
import type { OperationCommand, OperationReceipt } from './operations-contracts'
import type { PublicationCommitCommand, PublicationCommitReceipt } from './publication-execution-contracts'
import type { SchoolDayCommitCommand, SchoolDayCommitReceipt } from './school-day-execution-contracts'

// 검증된 공개·승인 접수만 알린다. 미리보기와 학사 변경을 공개 완료로 해석하지 않는다.
export function reportOperationResult(listener: WorkflowResultListener | undefined, scope: string, key: string,
  command: OperationCommand | PublicationCommitCommand | SchoolDayCommitCommand,
  receipt: OperationReceipt | PublicationCommitReceipt | SchoolDayCommitReceipt) {
  if (!listener) return
  try {
    if (receipt.requestKey !== key) return
    if (command.kind === 'action' && command.action === 'approve' && receipt.kind === 'action' && receipt.status === 'applied') {
      if (receipt.entityId !== command.requestId || receipt.version !== command.expectedVersion + 1 || !receipt.changedLessons.length) return
      listener({ kind: 'timetable', action: 'approve', scope, key: receipt.requestKey, recordedAt: receipt.recordedAt,
        requestId: receipt.entityId, requestVersion: receipt.version, changedLessonIds: receipt.changedLessons.map(lesson => lesson.id) })
    } else if (receipt.status === 'published' && command.kind === 'publish' && receipt.kind === 'publish') {
      if (receipt.version !== 1 || !receipt.changedLessons.length) return
      listener({ kind: 'publication', action: 'publish', scope, key: receipt.requestKey, recordedAt: receipt.recordedAt,
        publicationId: receipt.entityId, publicationVersion: receipt.version, changedCount: receipt.changedLessons.length })
    } else if (receipt.status === 'published' && command.kind === 'publish_manifest' && receipt.kind === 'publish_manifest') {
      if (receipt.manifestHash !== command.manifest.manifestHash || receipt.basisFingerprint !== command.manifest.basisFingerprint ||
          receipt.changedCount !== command.manifest.totalChanges || !receipt.changedCount) return
      listener({ kind: 'publication', action: 'publish_manifest', scope, key: receipt.requestKey, recordedAt: receipt.recordedAt,
        publicationId: receipt.entityId, publicationVersion: receipt.version, changedCount: receipt.changedCount })
    }
  } catch {
    // AI 목록의 보조 표시 오류가 정상 접수 결과·원키 복구 상태에 영향을 주지 않는다.
  }
}
