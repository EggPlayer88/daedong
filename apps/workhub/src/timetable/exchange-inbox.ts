import { businessTime, businessIso } from '../sandbox/clock'
import type { ExchangeRequestView, RequestAction } from './operations-contracts'

export const exchangeFilters = {
  all: '전체 요청', mine: '내 응답이 필요한 요청', consent: '내가 동의할 요청',
  approval: '내가 승인할 요청', requested: '내가 보낸 요청', active: '진행 중인 요청', finished: '끝난 요청',
} as const
export type ExchangeFilter = keyof typeof exchangeFilters
export const activeExchange = (request: ExchangeRequestView) => request.state === 'awaiting_consent' || request.state === 'awaiting_approval'

// 목록의 분류는 버튼과 같은 서버 actions를 사용한다. 권한이나 요청 상태를 새로 만들어 내지 않는다.
export function visibleExchangeActions(request: ExchangeRequestView): RequestAction[] {
  return request.actions.filter(action => !(action === 'approve' && request.requesterIsViewer))
}
export function exchangeAttention(request: ExchangeRequestView, now: number) {
  const actions = Date.parse(request.expiresAt) > businessTime(now) ? visibleExchangeActions(request) : []
  return { consent: actions.some(action => action === 'accept' || action === 'reject'), approval: actions.some(action => action === 'approve' || action === 'rejectApproval') }
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').trim()
export function selectExchangeRequests(requests: ExchangeRequestView[], filter: ExchangeFilter, query: string, now: number) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  return requests.filter(request => {
    const attention = exchangeAttention(request, now)
    const matches = filter === 'all' || filter === 'mine' && (attention.consent || attention.approval) || filter === 'consent' && attention.consent || filter === 'approval' && attention.approval || filter === 'requested' && request.requesterIsViewer || filter === 'active' && activeExchange(request) || filter === 'finished' && !activeExchange(request)
    if (!matches) return false
    const text = normalize([request.id, request.requester.name, request.reason, ...request.participants.map(person => person.name), ...request.changes.flatMap(change => { const lesson = change.before ?? change.after; return [lesson.label, ...lesson.groupNames, ...lesson.teachers.map(person => person.name)] })].join(' '))
    return terms.every(term => text.includes(term))
  }).sort((a, b) => {
    const left = exchangeAttention(a, now), right = exchangeAttention(b, now)
    return Number(right.consent || right.approval) - Number(left.consent || left.approval) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
  })
}
export function exchangeNextStep(request: ExchangeRequestView, now: number) {
  if (activeExchange(request) && Date.parse(request.expiresAt) <= businessTime(now)) return '응답 기한이 지났습니다. 요청 상태를 새로 확인해 주세요.'
  const attention = exchangeAttention(request, now)
  if (attention.consent) return '내가 변경안을 확인하고 동의 여부를 응답할 차례입니다.'
  if (attention.approval) return '담당자가 변경안을 최종 확인할 차례입니다.'
  if (request.state === 'awaiting_consent') return '아직 응답하지 않은 관련 교사의 동의를 기다리고 있습니다.'
  if (request.state === 'awaiting_approval') return '동의를 모두 모았습니다. 담당자의 최종 승인을 기다리고 있습니다.'
  if (request.state === 'applied') return '변경된 시간표가 반영되었습니다. 공유 시간표에서 확인할 수 있습니다.'
  if (request.state === 'stale') return '수업 정보가 달라졌습니다. 최신 시간표를 확인하고 새 요청을 준비해 주세요.'
  return '이 요청의 처리가 끝났습니다. 이 요청으로 실제 수업을 바꾸지 않습니다.'
}

/** 알림에 든 ID는 조회 권한이 확인된 현재 목록에서만 찾는다. 이름·순번 대체는 하지 않는다. */
export function findExchangeRequest(requests: ExchangeRequestView[], requestId: string) {
  return requests.find(request => request.id === requestId)
}
export function exchangeConsentSummary(request: ExchangeRequestView) {
  const accepted = request.participants.filter(person => person.response === 'accepted').length
  const pending = request.participants.filter(person => person.response === 'pending').length
  const rejected = request.participants.filter(person => person.response === 'rejected').length
  return { accepted, pending, rejected, total: request.participants.length }
}
export type ExchangeProgressState = 'complete' | 'current' | 'waiting' | 'stopped'
export function exchangeProgress(request: ExchangeRequestView, now: number): { label: string; state: ExchangeProgressState }[] {
  const applied = request.state === 'applied'
  const stopped = !applied && (!activeExchange(request) || Date.parse(request.expiresAt) <= businessTime(now))
  const consentComplete = request.participants.length > 0 && request.participants.every(person => person.response === 'accepted')
  return [
    { label: '요청 접수', state: 'complete' },
    { label: '관련 교사 동의', state: consentComplete ? 'complete' : stopped ? 'stopped' : 'current' },
    { label: '담당자 승인', state: applied ? 'complete' : stopped ? 'stopped' : request.state === 'awaiting_approval' ? 'current' : 'waiting' },
    { label: '시간표 반영', state: applied ? 'complete' : stopped ? 'stopped' : 'waiting' },
  ]
}
