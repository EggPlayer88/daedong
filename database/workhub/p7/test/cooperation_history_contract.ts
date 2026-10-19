// 협업 인계 뒤 상세 이력 계약 — 앱(Codex)이 옮겨 쓸 기준 구현(2026-10-16 통합 검토 1번).
// 지금 앱 detailResponse(PR #48 5f3d40f apps/workhub/src/cooperation/adapter.ts)와 다른 점만 있다:
//   1) action 'handover' 를 받는다(상태는 그대로, 받는 사람만 바뀜).
//   2) 처리자 확인을 "지금 당사자"가 아니라 "그 행 때의 당사자"로 한다. 그때의 받는 사람은 이력을 따라가며 계산하고,
//      서버가 준 recipientMemberId(그 행 뒤의 받는 사람)와 하나라도 다르면 거부한다.
//   3) 이력 행의 이름은 actorName 을 쓴다(요청 본문의 senderName · recipientName 은 지금 당사자 이름이다).
// 과거 행의 처리자를 새 담당자로 바꾸거나 행을 지우는 해석은 하지 않는다 — 어긋나면 화면을 열지 않는다(INVALID_INPUT).
import { envelope, object, id, text, timestamp, integer, array, unique, invalid, type Scope } from 'p7app/cooperation/protocol'
import { requestValue } from 'p7app/cooperation/adapter'
import { COOPERATION_CONTRACT, COOPERATION_LIMITS, actionLabels, allowedActions, nextCooperationStatus,
         type CooperationAction, type CooperationRequest } from 'p7app/cooperation/contracts'

export type HistoryRow = { id: string; action: 'create' | 'handover' | CooperationAction; actorMemberId: string; actorName: string;
  recipientMemberId: string; previousRecipientMemberId: string | null; comment: string; recordedAt: string; version: number }

const HANDOVER_FROM: CooperationRequest['status'][] = ['requested', 'accepted', 'completion_requested']

export function proposedDetailResponse(raw: unknown, s: Scope, requestId: string): { request: CooperationRequest; history: HistoryRow[] } {
  const v = envelope(raw, s, COOPERATION_CONTRACT), request = requestValue(v.request, s)
  if (request.id !== requestId) invalid()
  const history = unique(array(v.history, 1000).map(raw => {
    const r = object(raw); id(r.id)
    if (r.action !== 'create' && r.action !== 'handover' && !Object.hasOwn(actionLabels, String(r.action))) invalid()
    id(r.actorMemberId); text(r.actorName, 120); id(r.recipientMemberId)
    if (r.action === 'handover') id(r.previousRecipientMemberId); else if (r.previousRecipientMemberId !== null) invalid()
    text(r.comment, COOPERATION_LIMITS.reason, true); timestamp(r.recordedAt); integer(r.version, 1, request.version)
    return r as unknown as HistoryRow
  }), r => r.id)
  if (history.length !== request.version) invalid()
  let state: CooperationRequest['status'] = 'requested', recipient = ''
  history.forEach((h, i) => {
    if (h.version !== i + 1) invalid()
    if (i === 0) {
      if (h.action !== 'create' || h.actorMemberId !== request.senderMemberId || h.recipientMemberId === request.senderMemberId) invalid()
      recipient = h.recipientMemberId; return
    }
    if (h.action === 'handover') {
      // 인계: 수락한 새 받는 사람이 처리자, 넘겨준 사람 = 직전 받는 사람. 보낸 사람 · 같은 사람에게는 넘길 수 없다. 상태는 그대로.
      if (!HANDOVER_FROM.includes(state) || h.previousRecipientMemberId !== recipient || h.actorMemberId !== h.recipientMemberId
          || h.actorMemberId === recipient || h.actorMemberId === request.senderMemberId) invalid()
      recipient = h.recipientMemberId; return
    }
    if (h.recipientMemberId !== recipient) invalid()
    const then = { ...request, status: state, recipientMemberId: recipient }
    if (!allowedActions(then, { id: h.actorMemberId, schoolId: s.schoolId }).includes(h.action as CooperationAction)) invalid()
    state = nextCooperationStatus(h.action as CooperationAction)
  })
  if (state !== request.status || recipient !== request.recipientMemberId) invalid()
  return { request, history }
}

// 화면 이력 한 줄(지금 앱은 senderName/recipientName 으로 이름을 고른다 — 인계 뒤에는 이전 받는 사람의 처리가 새 사람 이름으로 보인다)
export function historyLine(h: HistoryRow): string {
  const label = h.action === 'create' ? '요청 작성' : h.action === 'handover' ? '업무 인계' : actionLabels[h.action]
  return `${label} · ${h.actorName}`
}
