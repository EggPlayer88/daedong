// 원 요청은 현재 탭 메모리에만 보관한다. 계정마다 나누고 응답 미상 때 새 번호로 바꾸지 않는다.
const sessions = new Map()
export function readDocAiSession(userId) { return userId ? sessions.get(userId) : undefined }
export function saveDocAiSession(userId, snapshot) { if (userId) sessions.set(userId, structuredClone(snapshot)) }
export function createDocAiAttempt(messages, quality = 'quick', requestKey = crypto.randomUUID()) {
  if (!['quick','review'].includes(quality) || typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey) || !Array.isArray(messages) || !messages.length || messages.length > 80 || messages.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content) || messages.reduce((n,m) => n+m.content.length,0)>80000) throw Error('대화 내용과 요청 방식을 확인해 주세요.')
  return { messages: structuredClone(messages), quality, requestKey }
}
export function docAiRequestBody(attempt, recoverOnly = false, cancelOnly = false) { return { ...createDocAiAttempt(attempt.messages, attempt.quality, attempt.requestKey), recoverOnly, ...(cancelOnly ? { cancelOnly: true } : {}) } }
export function classifyDocAiReply(data, requestKey) {
  if (!data || data.requestKey !== requestKey) return 'unknown'
  if (data.state === 'completed' && typeof data.reply === 'string' && ['end_turn','max_tokens','stop_sequence','refusal'].includes(data.stop_reason)) return 'completed'
  if (data.state === 'missing') return 'missing'
  if (['failed','closed'].includes(data.state) && typeof data.code === 'string') return 'failed'
  return 'unknown'
}
