// 기존 서버 검증을 통과한 처리 결과의 화면 전달용 요약이다. 실행 명령이나 권한 근거로 사용하지 않는다.
interface ResultBase { scope: string; key: string; recordedAt: string; composeId?: string }
export type CollectionResultAction = 'create' | 'update' | 'publish' | 'save_draft' | 'submit' | 'review' | 'withdraw' | 'open_correction'
export type WorkflowResult = ResultBase & (
  | { kind: 'message'; action: 'start' | 'reply'; deliveries: { threadId: string; messageId: string; sequence: number }[] }
  | { kind: 'collection'; action: CollectionResultAction; requestId: string; resourceId: string; resourceVersion: number }
  | { kind: 'timetable'; action: 'approve'; requestId: string; requestVersion: number; changedLessonIds: string[] }
)
export type WorkflowResultListener = (result: WorkflowResult) => void

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const collectionLabels: Record<CollectionResultAction, string> = {
  create: '수합 초안 저장 · 아직 미공개', update: '수합 초안 변경 저장 · 아직 미공개',
  publish: '수합 공개', save_draft: '제출 초안 저장 · 최종 제출 전', submit: '최종 제출 접수',
  review: '제출 검토 결과 저장', withdraw: '제출 철회', open_correction: '정정 기간 저장',
}

// 결과 표시에 필요한 필드만 복사한다. 본문·학생 자료·수신자 명부는 대화의 결과 기록에 복제하지 않는다.
export function copyWorkflowResult(raw: WorkflowResult): WorkflowResult | undefined {
  if (!raw || !text(raw.scope) || !text(raw.key) || !text(raw.recordedAt) || !Number.isFinite(Date.parse(raw.recordedAt))) return
  if (raw.composeId !== undefined && !text(raw.composeId)) return
  const base = { scope: raw.scope, key: raw.key, recordedAt: raw.recordedAt, ...(raw.composeId ? {composeId: raw.composeId} : {}) }
  if (raw.kind === 'message' && (raw.action === 'start' || raw.action === 'reply')) {
    if (!Array.isArray(raw.deliveries) || !raw.deliveries.length ||
        raw.deliveries.some(row => !row || !text(row.threadId) || !text(row.messageId) || !version(row.sequence)) ||
        new Set(raw.deliveries.map(row => row.messageId)).size !== raw.deliveries.length) return
    return { ...base, kind: raw.kind, action: raw.action,
      deliveries: raw.deliveries.map(({ threadId, messageId, sequence }) => ({ threadId, messageId, sequence })) }
  }
  if (raw.kind === 'collection' && Object.hasOwn(collectionLabels, raw.action) &&
      text(raw.requestId) && text(raw.resourceId) && version(raw.resourceVersion))
    return { ...base, kind: raw.kind, action: raw.action, requestId: raw.requestId, resourceId: raw.resourceId, resourceVersion: raw.resourceVersion }
  if (raw.kind === 'timetable' && raw.action === 'approve' && text(raw.requestId) && version(raw.requestVersion) &&
      Array.isArray(raw.changedLessonIds) && raw.changedLessonIds.length > 0 && raw.changedLessonIds.every(text) &&
      new Set(raw.changedLessonIds).size === raw.changedLessonIds.length)
    return { ...base, kind: raw.kind, action: raw.action, requestId: raw.requestId, requestVersion: raw.requestVersion, changedLessonIds: [...raw.changedLessonIds] }
}

export function workflowResultLabel(result: WorkflowResult): string {
  if (result.kind === 'message') return `${result.action === 'start' ? '메시지 전송' : '답장 전송'} · ${result.deliveries.length}개 대화 접수`
  if (result.kind === 'collection') return collectionLabels[result.action]
  return `시간표 교환·이동 승인 · 수업 ${result.changedLessonIds.length}건 반영`
}
