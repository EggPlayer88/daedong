import catalog from '../../../main/api/workhub-ai/_assets/conversation-profiles.json'
import { ASSISTANT_LIMITS, AssistantError, type AssistantContextRequest } from './contracts'

export type ConversationProfileId = keyof typeof catalog.profiles
export type ConversationFocus = 'auto' | ConversationProfileId
export interface ConversationProfile {
  id: ConversationProfileId
  label: string
  keywords: readonly string[]
  description: string
  starterPrompts: readonly string[]
  guidance: readonly string[]
}

export const CONVERSATION_PROFILES: readonly ConversationProfile[] = Object.entries(catalog.profiles)
  .map(([id, profile]) => ({ id: id as ConversationProfileId, ...profile }))

export function conversationProfile(id: unknown): ConversationProfile {
  return CONVERSATION_PROFILES.find(profile => profile.id === id) ?? CONVERSATION_PROFILES[0]
}

function knownProfile(id: unknown): id is ConversationProfileId {
  return typeof id === 'string' && Object.hasOwn(catalog.profiles, id)
}

// 단어와 조사만 읽어 '일정한' 같은 무관한 부분 문자열을 분야 단서로 삼지 않는다.
const wordBoundary = '[^\\p{L}\\p{N}_]'
const particles = '(?:(?:은|는|이|가|을|를|의|에|에서|에게|와|과|도|만|까지|부터|보다|처럼|으로|로|이란|란|인지|이라면|라면|이랑|랑|요)){0,2}'
const keywordPatterns = CONVERSATION_PROFILES.map(profile => ({
  id: profile.id,
  patterns: profile.keywords.map(keyword => new RegExp(
    '(?:^|' + wordBoundary + ')' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') +
    particles + '(?=$|' + wordBoundary + ')', 'u')),
}))

function profileFromPrompt(prompt: unknown): ConversationProfileId {
  if (typeof prompt !== 'string') return 'general'
  let selected: ConversationProfileId = 'general', maximum = 0
  for (const profile of keywordPatterns) {
    // 같은 단어의 반복으로 다른 분야 단서를 덮어쓰지 않는다.
    const score = profile.patterns.filter(pattern => pattern.test(prompt)).length
    if (score > maximum) { maximum = score; selected = profile.id }
    else if (score === maximum) selected = 'general'
  }
  return selected
}

// 확정된 문맥을 우선하고 문장 단서는 답변 관점에만 보탠다. 자료·권한·실행 범위는 그대로다.
export function inferConversationProfile(context: Pick<AssistantContextRequest, 'intent'> &
  Partial<Pick<AssistantContextRequest, 'references' | 'studentContext' | 'prompt'>>): ConversationProfileId {
  if (context.studentContext) return 'teaching'
  const intent = catalog.intentProfiles[context.intent as keyof typeof catalog.intentProfiles]
  if (knownProfile(intent)) return intent
  const profiles = new Set((Array.isArray(context.references) ? context.references : []).map(reference =>
    catalog.referenceProfiles[reference.kind as keyof typeof catalog.referenceProfiles]).filter(knownProfile))
  if (profiles.size) return profiles.size === 1 ? [...profiles][0] : 'general'
  return profileFromPrompt(context.prompt)
}

function tail(id: ConversationProfileId): string {
  return catalog.transport.start + catalog.transport.tags[id] + catalog.transport.end
}

// 화면에서만 마지막 꼬리표 한 겹을 벗긴다. 저장·복구·재검토에는 보관한 원요청을 그대로 쓴다.
export function readConversationPrompt(prompt: string): { profileId: ConversationProfileId; prompt: string } {
  for (const profile of CONVERSATION_PROFILES) {
    const marker = tail(profile.id)
    if (prompt.endsWith(marker)) return { profileId: profile.id, prompt: prompt.slice(0, -marker.length) }
  }
  return { profileId: 'general', prompt }
}

// 화면의 남은 글자 수와 실제 전송 검증이 같은 꼬리표 길이를 사용한다.
export function conversationPromptLimit(profileId: ConversationProfileId, prompt = ''): number {
  if (!knownProfile(profileId) || typeof prompt !== 'string') throw new AssistantError('INVALID_INPUT')
  const needsTail = profileId !== 'general' || readConversationPrompt(prompt).prompt !== prompt
  return ASSISTANT_LIMITS.promptChars - (needsTail ? Array.from(tail(profileId)).length : 0)
}

export function composeConversationPrompt(prompt: string, profileId: ConversationProfileId): string {
  if (!knownProfile(profileId) || typeof prompt !== 'string' || !prompt.trim() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)) throw new AssistantError('INVALID_INPUT')
  for (const letter of prompt) {
    const code = letter.charCodeAt(0)
    if (letter.length === 1 && code >= 0xd800 && code <= 0xdfff) throw new AssistantError('INVALID_INPUT')
  }
  // 꼬리표는 첫 줄 제목과 두 글자 이상 검색어에 섞이지 않는다. 같은 모양의 원문은 한 겹 더해 보존한다.
  const limit = conversationPromptLimit(profileId, prompt)
  if (Array.from(prompt).length > limit) throw new AssistantError('INVALID_INPUT')
  return limit === ASSISTANT_LIMITS.promptChars ? prompt : prompt + tail(profileId)
}
