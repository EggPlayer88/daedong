// 기존 서버 검증을 통과한 처리 결과의 화면 전달용 요약이다. 실행 명령이나 권한 근거로 사용하지 않는다.
interface ResultBase { scope: string; key: string; composeId?: string }
interface RecordedResult { recordedAt: string }
export type CollectionResultAction = 'create' | 'update' | 'publish' | 'save_draft' | 'submit' | 'review' | 'withdraw' | 'open_correction'
export type TransitionResultAction = 'apply' | 'admin_confirm' | 'admin_reject' | 'accept' | 'reject' | 'cancel'
export type TransitionResultState = 'awaiting_admin' | 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed'
export type WorkflowResult = ResultBase & (
  | RecordedResult & { kind: 'message'; action: 'start' | 'reply'; deliveries: { threadId: string; messageId: string; sequence: number }[] }
  | RecordedResult & { kind: 'collection'; action: CollectionResultAction; requestId: string; resourceId: string; resourceVersion: number }
  | RecordedResult & { kind: 'timetable' | 'intervention'; action: 'approve'; requestId: string; requestVersion: number; changedLessonIds: string[] }
  | RecordedResult & { kind: 'transition'; action: TransitionResultAction; recordId: string; recordVersion: number; state: TransitionResultState }
  | RecordedResult & { kind: 'document'; action: 'create' | 'update' | 'confirm' | 'archive'; documentId: string; documentVersion: number }
  | { kind: 'guided'; action: 'render'; observedAt: string; artifactId: string; templateId: string; templateVersion: number; responseId: string; responseVersion: number; sha256: string; bytes: number }
)
export type WorkflowResultListener = (result: WorkflowResult) => void

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const instant = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
const collectionLabels: Record<CollectionResultAction, string> = {
  create: '수합 초안 저장 · 아직 미공개', update: '수합 초안 변경 저장 · 아직 미공개',
  publish: '수합 공개', save_draft: '제출 초안 저장 · 최종 제출 전', submit: '최종 제출 접수',
  review: '제출 검토 결과 저장', withdraw: '제출 철회', open_correction: '정정 기간 저장',
}
const documentLabels = { create: '문서 초안 저장 · 제출 전', update: '문서 변경 저장 · 제출 전', confirm: '문서 내용 확인 · 제출 전', archive: '문서 보관함 이동' } as const
const transitionStates: Record<TransitionResultAction, readonly TransitionResultState[]> = {
  apply: ['awaiting_admin', 'pending', 'completed'], admin_confirm: ['pending'], admin_reject: ['rejected'],
  accept: ['accepted'], reject: ['rejected'], cancel: ['cancelled'],
}

// 결과 표시에 필요한 필드만 복사한다. 본문·학생 자료·수신자 명부는 대화의 결과 기록에 복제하지 않는다.
export function copyWorkflowResult(raw: WorkflowResult): WorkflowResult | undefined {
  if (!raw || !text(raw.scope) || !text(raw.key)) return
  if (raw.composeId !== undefined && !text(raw.composeId)) return
  const shared = { scope: raw.scope, key: raw.key, ...(raw.composeId ? {composeId: raw.composeId} : {}) }
  // 생성물 계약에는 서버 접수 시각이 없다. 클라이언트 확인 시각을 서버 시각으로 꾸미지 않는다.
  if (raw.kind === 'guided') {
    if (raw.action !== 'render' || !instant(raw.observedAt) || !text(raw.artifactId) || !text(raw.templateId) ||
        !version(raw.templateVersion) || !text(raw.responseId) || !version(raw.responseVersion) || !version(raw.bytes) ||
        typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) return
    return { ...shared, kind: raw.kind, action: raw.action, observedAt: raw.observedAt, artifactId: raw.artifactId,
      templateId: raw.templateId, templateVersion: raw.templateVersion, responseId: raw.responseId,
      responseVersion: raw.responseVersion, bytes: raw.bytes, sha256: raw.sha256 }
  }
  if (!instant(raw.recordedAt)) return
  const base = { ...shared, recordedAt: raw.recordedAt }
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
  if ((raw.kind === 'timetable' || raw.kind === 'intervention') && raw.action === 'approve' && text(raw.requestId) && version(raw.requestVersion) &&
      Array.isArray(raw.changedLessonIds) && raw.changedLessonIds.length > 0 && raw.changedLessonIds.every(text) &&
      new Set(raw.changedLessonIds).size === raw.changedLessonIds.length)
    return { ...base, kind: raw.kind, action: raw.action, requestId: raw.requestId, requestVersion: raw.requestVersion, changedLessonIds: [...raw.changedLessonIds] }
  if (raw.kind === 'transition' && Object.hasOwn(transitionStates, raw.action) && transitionStates[raw.action].includes(raw.state) &&
      text(raw.recordId) && version(raw.recordVersion) && (raw.action !== 'apply' || raw.recordVersion === 1))
    return { ...base, kind: raw.kind, action: raw.action, recordId: raw.recordId, recordVersion: raw.recordVersion, state: raw.state }
  if (raw.kind === 'document' && Object.hasOwn(documentLabels, raw.action) && text(raw.documentId) && version(raw.documentVersion))
    return { ...base, kind: raw.kind, action: raw.action, documentId: raw.documentId, documentVersion: raw.documentVersion }
}

export function workflowResultLabel(result: WorkflowResult): string {
  if (result.kind === 'message') return `${result.action === 'start' ? '메시지 전송' : '답장 전송'} · ${result.deliveries.length}개 대화 접수`
  if (result.kind === 'collection') return collectionLabels[result.action]
  if (result.kind === 'document') return documentLabels[result.action]
  if (result.kind === 'guided') return `HWPX 생성 · 답변 ${result.responseVersion}판 · 파일 확인 필요`
  if (result.kind === 'transition') {
    if (result.action === 'apply') return result.state === 'completed' ? '새 학년도 생성'
      : result.state === 'awaiting_admin' ? '인계 신청 · 관리자 확인 대기' : '인계 신청 · 받는 사람 수락 대기'
    return ({ admin_confirm: '인계 관리자 확인 · 받는 사람 수락 대기', admin_reject: '인계 관리자 반려',
      accept: '인계 수락 · 반영 확인', reject: '인계 반려', cancel: '인계 신청 취소' } as const)[result.action]
  }
  if (result.kind === 'intervention') return `시간표 운영 승인 · 수업 ${result.changedLessonIds.length}건 반영`
  return `시간표 교환·이동 승인 · 수업 ${result.changedLessonIds.length}건 반영`
}
