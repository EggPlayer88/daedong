import type { Membership } from '../contracts'
import { recoveryScope } from '../services/recovery-scope'
import { ASSISTANT_LIMITS } from '../assistant/contracts'
import { canonical, exact, identifier, ServiceError, text, version } from '../services/service-values'
import { answers, detail, mapping, type Mapping, type TemplateDetail } from './guided-contracts'
import type { DocumentAiRequest } from './contracts'

// 비서 서버에 보내지 않는 현재 탭의 복귀 주소다. 양식과 답변의 판을 추측하지 않는다.
export interface GuidedAiOrigin {
  id: string; scope: string; templateId: string; templateVersion: number; mapping: Mapping
  responseId: string | null; responseVersion: number; answers: Record<string, string>
}
export interface GuidedAiRequest { origin: GuidedAiOrigin; request: DocumentAiRequest }
export interface GuidedAiSuggestion { origin: GuidedAiOrigin; requestId: string; body: string }

export function guidedAiOrigin(raw: unknown, member: Membership): GuidedAiOrigin {
  exact(raw, ['id', 'scope', 'templateId', 'templateVersion', 'mapping', 'responseId', 'responseVersion', 'answers'])
  if (raw.scope !== recoveryScope(member)) throw new ServiceError('CANCELLED')
  const map = mapping(raw.mapping), responseId = raw.responseId === null ? null : identifier(raw.responseId)
  if (responseId === null ? raw.responseVersion !== 0 : !Number.isSafeInteger(raw.responseVersion) || Number(raw.responseVersion) < 1) throw new ServiceError('INVALID_INPUT')
  return { id: identifier(raw.id), scope: raw.scope as string, templateId: identifier(raw.templateId), templateVersion: version(raw.templateVersion), mapping: map, responseId, responseVersion: raw.responseVersion as number, answers: answers(map, raw.answers, false) }
}

export function makeGuidedAiRequest(member: Membership, value: TemplateDetail, input: Record<string, string>, id: string): GuidedAiRequest {
  const current = detail(value, member)
  if (!current.template.mapping) throw new ServiceError('INVALID_INPUT')
  const origin = guidedAiOrigin({ id, scope: recoveryScope(member), templateId: current.template.id, templateVersion: current.template.version, mapping: current.template.mapping, responseId: current.response?.id ?? null, responseVersion: current.response?.version ?? 0, answers: input }, member)
  const title = current.template.title, details = `질문에 필요한 내용 제안만 해 주세요. 답변이나 파일을 자동 저장하지 마세요.\n${origin.mapping.questions.map(q => `${q.label}: ${origin.answers[q.id]}`).join('\n')}`
  if (Array.from(title + '\n\n' + details).length > ASSISTANT_LIMITS.promptChars - 200) throw new ServiceError('INVALID_INPUT')
  return { origin, request: { intent: 'guided_collection', title, details } }
}

export function guidedAiSuggestion(raw: unknown, member: Membership): GuidedAiSuggestion {
  exact(raw, ['origin', 'requestId', 'body'])
  return { origin: guidedAiOrigin(raw.origin, member), requestId: identifier(raw.requestId), body: text(raw.body, ASSISTANT_LIMITS.answerChars, true) }
}

export function verifyGuidedAiSource(origin: GuidedAiOrigin, raw: unknown, member: Membership): TemplateDetail {
  const expected = guidedAiOrigin(origin, member), current = detail(raw, member, expected.templateId)
  if (current.template.version !== expected.templateVersion || canonical(current.template.mapping) !== canonical(expected.mapping) || (current.response?.id ?? null) !== expected.responseId || (current.response?.version ?? 0) !== expected.responseVersion) throw new ServiceError('CONFLICT')
  return current
}

export function applyGuidedAiAnswer(origin: GuidedAiOrigin, current: Record<string, string>, questionId: string, value: string): Record<string, string> {
  if (!origin.mapping.questions.some(q => q.id === questionId)) throw new ServiceError('INVALID_INPUT')
  // 선택하지 않은 답변은 원문 그대로 유지한다. 숫자·날짜·선택·길이 검사는 기존 계약을 사용한다.
  const next = { ...current, [questionId]: value }
  answers(origin.mapping, next, false)
  return next
}
