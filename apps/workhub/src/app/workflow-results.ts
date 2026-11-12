// 기존 서버 검증을 통과한 처리 결과의 화면 전달용 요약이다. 실행 명령이나 권한 근거로 사용하지 않는다.
interface ResultBase { scope: string; key: string; composeId?: string }
interface RecordedResult { recordedAt: string }
export type CollectionResultAction = 'create' | 'update' | 'publish' | 'save_draft' | 'submit' | 'review' | 'withdraw' | 'open_correction'
export type TransitionResultAction = 'apply' | 'admin_confirm' | 'admin_reject' | 'accept' | 'reject' | 'cancel'
export type TransitionResultState = 'awaiting_admin' | 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed'
export type CooperationResultAction = 'create' | 'accept' | 'decline' | 'request_completion' | 'confirm_completion' | 'return_completion' | 'retract_completion' | 'cancel'
export type TeachingResultAction = 'course_create' | 'roster_import' | 'observation_save' | 'record_withdraw' | 'rubric_save' | 'assessment_save' | 'activity_review' | 'activity_import' | 'activity_correct'
export type WorkflowResult = ResultBase & (
  | RecordedResult & { kind: 'message'; action: 'start' | 'reply'; deliveries: { threadId: string; messageId: string; sequence: number }[] }
  | RecordedResult & { kind: 'collection'; action: CollectionResultAction; requestId: string; resourceId: string; resourceVersion: number }
  | RecordedResult & { kind: 'timetable' | 'intervention'; action: 'approve'; requestId: string; requestVersion: number; changedLessonIds: string[] }
  | RecordedResult & { kind: 'transition'; action: TransitionResultAction; recordId: string; recordVersion: number; state: TransitionResultState }
  | RecordedResult & { kind: 'document'; action: 'create' | 'update' | 'confirm' | 'archive'; documentId: string; documentVersion: number }
  | RecordedResult & { kind: 'cooperation'; action: CooperationResultAction; requestId: string; requestVersion: number }
  | RecordedResult & { kind: 'calendar'; action: 'create' | 'update'; eventId: string; eventVersion: number }
  | RecordedResult & { kind: 'calendar_batch'; action: 'commit'; prepareId: string; events: { eventId: string; eventVersion: number }[] }
  | RecordedResult & { kind: 'teaching'; action: TeachingResultAction; courseId: string; entityId: string; entityVersion: number; recordKind?: 'observation' | 'assessment'; confirmed?: boolean; disposition?: 'hold' | 'adopt' | 'exclude' | 'withdraw'; previousImportId?: string }
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
const cooperationLabels: Record<CooperationResultAction, string> = {
  create: '협업 요청 접수 · 응답 대기', accept: '협업 수락 · 진행 중', decline: '협업 요청 반려',
  request_completion: '협업 완료 확인 요청 · 확인 대기', confirm_completion: '협업 완료 확인',
  return_completion: '협업 보완 요청', retract_completion: '협업 완료 요청 철회', cancel: '협업 요청 취소',
}
const teachingActions: readonly TeachingResultAction[] = ['course_create', 'roster_import', 'observation_save', 'record_withdraw', 'rubric_save', 'assessment_save', 'activity_review', 'activity_import', 'activity_correct']
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
  if (raw.kind === 'cooperation' && Object.hasOwn(cooperationLabels, raw.action) && text(raw.requestId) && version(raw.requestVersion) && (raw.action !== 'create' || raw.requestVersion === 1))
    return { ...base, kind: raw.kind, action: raw.action, requestId: raw.requestId, requestVersion: raw.requestVersion }
  if (raw.kind === 'calendar' && ['create', 'update'].includes(raw.action) && text(raw.eventId) && version(raw.eventVersion) && (raw.action !== 'create' || raw.eventVersion === 1))
    return { ...base, kind: raw.kind, action: raw.action, eventId: raw.eventId, eventVersion: raw.eventVersion }
  if (raw.kind === 'calendar_batch' && raw.action === 'commit' && text(raw.prepareId) && Array.isArray(raw.events) && raw.events.length > 0 &&
      raw.events.every(row => row && text(row.eventId) && version(row.eventVersion)) && new Set(raw.events.map(row => row.eventId)).size === raw.events.length)
    return { ...base, kind: raw.kind, action: raw.action, prepareId: raw.prepareId, events: raw.events.map(({eventId, eventVersion}) => ({eventId, eventVersion})) }
  if (raw.kind === 'teaching' && teachingActions.includes(raw.action) && text(raw.courseId) && text(raw.entityId) && version(raw.entityVersion)) {
    if (raw.action === 'course_create' && (raw.courseId !== raw.entityId || raw.entityVersion !== 1)) return
    if (raw.action === 'record_withdraw' && !['observation', 'assessment'].includes(raw.recordKind ?? '')) return
    if (raw.action === 'assessment_save' && typeof raw.confirmed !== 'boolean') return
    if (raw.action === 'activity_review' && !['hold', 'adopt', 'exclude', 'withdraw'].includes(raw.disposition ?? '')) return
    if (raw.action === 'activity_correct' && (!text(raw.previousImportId) || raw.previousImportId === raw.entityId || raw.entityVersion !== 1)) return
    return { ...base, kind: raw.kind, action: raw.action, courseId: raw.courseId, entityId: raw.entityId, entityVersion: raw.entityVersion,
      ...(raw.action === 'record_withdraw' ? {recordKind: raw.recordKind} : {}),
      ...(raw.action === 'assessment_save' ? {confirmed: raw.confirmed} : {}),
      ...(raw.action === 'activity_review' ? {disposition: raw.disposition} : {}),
      ...(raw.action === 'activity_correct' ? {previousImportId: raw.previousImportId} : {}) }
  }
}

export function workflowResultLabel(result: WorkflowResult): string {
  if (result.kind === 'message') return `${result.action === 'start' ? '메시지 전송' : '답장 전송'} · ${result.deliveries.length}개 대화 접수`
  if (result.kind === 'collection') return collectionLabels[result.action]
  if (result.kind === 'document') return documentLabels[result.action]
  if (result.kind === 'cooperation') return cooperationLabels[result.action]
  if (result.kind === 'calendar') return result.action === 'create' ? '일정 등록' : '일정 변경 저장'
  if (result.kind === 'calendar_batch') return `일정 일괄 반영 · ${result.events.length}건 접수`
  if (result.kind === 'teaching') {
    switch (result.action) {
      case 'course_create': return '수업 등록'
      case 'roster_import': return '수강 명부 반영'
      case 'observation_save': return '관찰 기록 저장'
      case 'record_withdraw': return result.recordKind === 'assessment' ? '평가 기록 철회' : '관찰 기록 철회'
      case 'rubric_save': return '평가 기준판 저장'
      case 'assessment_save': return result.confirmed ? '평가 확인 저장' : '평가 초안 저장'
      case 'activity_import': return '활동 자료 가져오기 · 근거 검토 필요'
      case 'activity_correct': return '활동 원문 정정 · 연결 기록 재검토 필요'
      case 'activity_review': return ({hold:'활동 근거 보류',adopt:'활동 근거 채택',exclude:'활동 근거 제외',withdraw:'활동 근거 철회'} as const)[result.disposition!]
    }
  }
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
