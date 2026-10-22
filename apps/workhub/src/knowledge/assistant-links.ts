import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import { assistantInput, type AssistantContextRequest, type Citation } from '../assistant/contracts'
import { exact, identifier, isoDate, ServiceError, text, version } from '../services/scoped-rpc'
import { knowledgeSource, sourceEffective, type KnowledgeSource } from './contracts'

export interface KnowledgeAssistantRequest {
  schoolId: string; memberId: string; sourceId: string; sourceVersion: number; title: string; locator: string
}
export interface KnowledgeOpenRequest extends KnowledgeAssistantRequest { key: string }

export function knowledgeAssistantRequest(source: KnowledgeSource, member: Membership, date: string): KnowledgeAssistantRequest {
  const checked = knowledgeSource(source, member)
  if (!activeAt(member, isoDate(date)) || !sourceEffective(checked, date)) throw new ServiceError('NOT_READY')
  return { schoolId: member.schoolId, memberId: member.id, sourceId: checked.id, sourceVersion: checked.version, title: checked.title, locator: checked.locator }
}

export function knowledgeAssistantContext(raw: KnowledgeAssistantRequest, member: Membership): AssistantContextRequest {
  exact(raw, ['schoolId', 'memberId', 'sourceId', 'sourceVersion', 'title', 'locator'])
  if (raw.schoolId !== member.schoolId || raw.memberId !== member.id) throw new ServiceError('CANCELLED')
  const checked = assistantInput({ mode: 'school', intent: 'school_advice', prompt: `선택한 학교 자료 「${text(raw.title, 200, true)}」 ${version(raw.sourceVersion)}판을 근거로 질문합니다.\n근거 위치: ${text(raw.locator, 500, true)}\n\n확인하고 싶은 내용: `, references: [{ kind: 'knowledge', id: identifier(raw.sourceId), version: version(raw.sourceVersion) }], studentContext: null, threadId: null, expectedVersion: 0 })
  return { mode: checked.mode, intent: checked.intent, prompt: checked.prompt, references: checked.references, studentContext: null }
}

export function knowledgeCitationRequest(citation: Citation, member: Membership): KnowledgeAssistantRequest {
  if (citation.reference.kind !== 'knowledge' || !('version' in citation.reference)) throw new ServiceError('INVALID_INPUT')
  return { schoolId: member.schoolId, memberId: member.id, sourceId: identifier(citation.reference.id), sourceVersion: version(citation.reference.version), title: text(citation.title, 200, true), locator: text(citation.locator, 500, true) }
}

export function validKnowledgeOpenRequest(raw: KnowledgeOpenRequest, member: Membership): boolean {
  try {
    exact(raw, ['key', 'schoolId', 'memberId', 'sourceId', 'sourceVersion', 'title', 'locator'])
    if (raw.schoolId !== member.schoolId || raw.memberId !== member.id) return false
    text(raw.key, 200, true); identifier(raw.sourceId); version(raw.sourceVersion); text(raw.title, 200, true); text(raw.locator, 500, true)
    return true
  } catch { return false }
}
