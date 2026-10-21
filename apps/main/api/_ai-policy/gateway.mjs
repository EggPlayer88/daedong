// 학교별 키와 예산 원장은 서버에서만 읽는다. 공급자 응답이 불명확하면 자동 재호출하지 않는다.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const routing = JSON.parse(readFileSync(new URL('../workhub-ai/_assets/model-routing.json', import.meta.url), 'utf8'))
const ID = /^[A-Za-z0-9_-]{1,100}$/
export class SchoolAiError extends Error {
  constructor(code, status = 503) { super(code); this.name = 'SchoolAiError'; this.code = code; this.status = status }
}
function fail(code = 'NOT_CONFIGURED', status) { throw new SchoolAiError(code, status) }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_RESPONSE'); return value }
function base64(value, expectedLength) {
  if (typeof value !== 'string' || !value || value.length > 4096 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('KEY_UNAVAILABLE')
  const result = Buffer.from(value, 'base64')
  if (result.toString('base64') !== value || expectedLength !== undefined && result.length !== expectedLength) fail('KEY_UNAVAILABLE')
  return result
}
function masterKey(keyId, env) {
  if (typeof keyId !== 'string' || !ID.test(keyId)) fail('KEY_UNAVAILABLE')
  let keys
  try { keys = JSON.parse(env.WORKHUB_AI_KEY_ENCRYPTION_KEYS ?? '') } catch { fail('KEY_UNAVAILABLE') }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.hasOwn(keys, keyId)) fail('KEY_UNAVAILABLE')
  return base64(keys[keyId], 32)
}
function aad(schoolId, version) {
  if (typeof schoolId !== 'string' || !ID.test(schoolId) || !Number.isSafeInteger(version) || version < 1) fail('KEY_UNAVAILABLE')
  return Buffer.from(JSON.stringify(['workhub.ai.school-key.v1', schoolId, version]), 'utf8')
}
export function encryptSchoolKey({ schoolId, credentialVersion, apiKey }, env = process.env) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/.test(apiKey)) fail('INVALID_INPUT', 400)
  const keyId = env.WORKHUB_AI_ACTIVE_KEY_ID, iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', masterKey(keyId, env), iv)
  cipher.setAAD(aad(schoolId, credentialVersion))
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return { keyId, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}
export function decryptSchoolKey({ schoolId, credentialVersion, envelope }, env = process.env) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(envelope?.keyId, env), base64(envelope?.iv, 12))
    decipher.setAAD(aad(schoolId, credentialVersion)); decipher.setAuthTag(base64(envelope?.tag, 16))
    const plaintext = Buffer.concat([decipher.update(base64(envelope?.ciphertext)), decipher.final()]).toString('utf8')
    if (!/^[A-Za-z0-9_-]{20,512}$/.test(plaintext)) fail('KEY_UNAVAILABLE')
    return plaintext
  } catch { fail('KEY_UNAVAILABLE') }
}
export function canonicalAiPayload(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalAiPayload).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalAiPayload(value[key])}`).join(',')}}`
  fail('INVALID_INPUT', 400)
}
export const hashAiPayload = value => createHash('sha256').update(canonicalAiPayload(value)).digest('hex')

export async function executeSchoolAi({ actorUserId, feature = 'evaluation', memberId = null, requestKey, quality = 'quick', payload, recoverOnly = false, cancelOnly = false, buildProviderBody, transformResponse }, { env = process.env, fetcher = fetch, now = Date.now, deadlineAt } = {}) {
  if (typeof actorUserId !== 'string' || !ID.test(actorUserId) || feature !== 'evaluation' || memberId !== null || typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey) || !['quick', 'review'].includes(quality) || typeof recoverOnly !== 'boolean' || typeof cancelOnly !== 'boolean' || recoverOnly && cancelOnly) fail('INVALID_INPUT', 400)
  const payloadHash = hashAiPayload({ quality, payload }), base = { p_actor_user_id: actorUserId, p_feature: feature, p_member_id: memberId, p_request_key: requestKey }
  const url = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL, serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) fail('NOT_CONFIGURED')
  // 인증을 포함한 호출 시작 시각을 핸들러에서 받는다. 마지막 8초는 원장 기록에 남긴다.
  const began = now(), deadline = Math.min(deadlineAt ?? began + 50000, began + 50000)
  if (!Number.isFinite(deadline)) fail('INVALID_INPUT', 400)
  const remaining = () => deadline - now()
  const signal = (maxMs, leaveMs = 0) => {
    const available = Math.floor(remaining() - leaveMs)
    if (available <= 0) fail('DEADLINE_EXCEEDED')
    return AbortSignal.timeout(Math.min(maxMs, available))
  }
  let schoolId
  async function rpc(action, args, leaveMs = 0) {
    let response, result
    try { response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/workhub_ai_gateway_${action}`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: signal(12000, leaveMs) }); result = await response.json() } catch { fail('GATEWAY_UNAVAILABLE') }
    if (!response.ok) fail('GATEWAY_UNAVAILABLE')
    if (!result || result.contract !== 'ai-gateway.v1' || result.actorUserId !== actorUserId || result.feature !== feature || result.requestKey !== requestKey) fail('INVALID_RESPONSE')
    if (result.error) fail(typeof result.error.code === 'string' ? result.error.code : 'INVALID_RESPONSE', ['FORBIDDEN','INACTIVE_MEMBERSHIP'].includes(result.error.code) ? 403 : 409)
    if (typeof result.schoolId !== 'string' && result.schoolId !== null || schoolId && result.schoolId !== schoolId) fail('INVALID_RESPONSE')
    schoolId = result.schoolId
    if (!result.data || typeof result.data !== 'object') fail('INVALID_RESPONSE')
    return result.data
  }
  const terminal = data => {
    if (data.state === 'completed') {
      if (data.quality !== quality || data.model !== routing.models[quality].id || !data.response || typeof data.response !== 'object' || Buffer.byteLength(JSON.stringify(data.response)) > 1000000) fail('INVALID_RESPONSE')
      integer(data.usage?.inputTokens); integer(data.usage?.outputTokens)
      return { ...data.response, state: 'completed', requestKey }
    }
    if (['pending','provider_unknown','claimed','started'].includes(data.state)) return { state: 'pending', requestKey, code: 'RESULT_UNKNOWN' }
    if (data.state === 'missing') return { state: 'missing', requestKey }
    if (['failed','rejected','closed'].includes(data.state)) return { state: data.state === 'closed' ? 'closed' : 'failed', requestKey, code: typeof data.code === 'string' ? data.code : 'CANCELLED' }
    fail('INVALID_RESPONSE')
  }
  if (cancelOnly) return terminal(await rpc('release', { ...base, p_lease_token: null, p_reason: 'CANCELLED' }))
  if (recoverOnly) return terminal(await rpc('recover', { ...base, p_payload_sha256: payloadHash }))
  const prepared = await rpc('prepare', { ...base, p_payload_sha256: payloadHash, p_quality: quality, p_input: null, p_review_of: null })
  if (prepared.state !== 'claimed') return terminal(prepared)
  if (!schoolId || typeof prepared.leaseToken !== 'string' || !ID.test(prepared.leaseToken)) fail('INVALID_RESPONSE')
  const lease = { ...base, p_lease_token: prepared.leaseToken }
  const release = async reason => terminal(await rpc('release', { ...lease, p_reason: reason }))
  let body, key, model
  try {
    model = routing.models[quality]
    if (!model || prepared.policy?.model !== model.id || prepared.policy.maxInputTokens !== routing.maxInputTokens || prepared.policy.maxOutputTokens !== routing.maxOutputTokens) throw Error('policy mismatch')
    integer(prepared.policy.version, 1)
    // 8만 토큰 사전 허용은 유지하며, 추정 오차를 포함한 10만 토큰 비용이 먼저 예약됐을 때만 시작한다.
    const requiredReserve = Math.ceil((routing.reserveInputTokens * model.inputMicroUsdPerMtok + routing.maxOutputTokens * model.outputMicroUsdPerMtok) / 1000000)
    if (integer(prepared.policy.reservedMicroUsd, 1) !== requiredReserve) throw Error('reservation mismatch')
    key = decryptSchoolKey({ schoolId, credentialVersion: integer(prepared.credential?.version, 1), envelope: prepared.credential }, env)
    body = buildProviderBody({ model: model.id, quality, maxInputTokens: routing.maxInputTokens, maxOutputTokens: routing.maxOutputTokens, effort: model.effort })
    if (!body || body.model !== model.id || body.max_tokens !== routing.maxOutputTokens || body.stream === true || body.tool_choice || /"cache_control"\s*:/.test(JSON.stringify(body))) throw Error('provider body mismatch')
    if (Buffer.byteLength(JSON.stringify(body)) > 1000000) return await release('INPUT_TOO_LARGE')
  } catch { return await release('CANCELLED') }
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
  if (remaining() <= 16000) return await release('CANCELLED')
  let counted
  try {
    const countBody = { model: body.model, system: body.system, messages: body.messages, ...(body.tools ? { tools: body.tools } : {}), ...(body.thinking ? { thinking: body.thinking } : {}), ...(body.output_config ? { output_config: body.output_config } : {}) }
    const countResponse = await fetcher('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify(countBody), signal: signal(12000, 16000) })
    if (!countResponse.ok) throw Error('count failed')
    counted = integer((await countResponse.json()).input_tokens)
  } catch { return await release('COUNT_FAILED') }
  if (counted > routing.maxInputTokens) return await release('INPUT_TOO_LARGE')
  if (remaining() <= 10000) return await release('CANCELLED')
  const started = await rpc('start', { ...lease, p_counted_input_tokens: counted, p_provider_body_sha256: hashAiPayload(body) }, 9000)
  if (started.started !== true) return { state: 'pending', requestKey, code: 'RESULT_UNKNOWN' }
  // start 이후 어느 실패도 예산을 임의 해제하거나 공급자를 재호출하지 않는다.
  const unknown = async observedUsage => { try { await rpc('finish', { ...lease, p_result: { state: 'provider_unknown', ...(observedUsage ? { observedUsage } : {}) } }) } catch {} return { state: 'pending', requestKey, code: 'RESULT_UNKNOWN' } }
  if (remaining() <= 8000) return await unknown()
  try {
    const generated = await fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal: signal(35000, 8000) })
    if (!generated.ok) return await unknown()
    const provider = await generated.json()
    if (!provider || provider.model !== model.id || typeof provider.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(provider.id) || !Array.isArray(provider.content) || !['end_turn','max_tokens','stop_sequence','refusal'].includes(provider.stop_reason)) return await unknown()
    // 사전 전액 예약한 범위만 자동 정산한다. 범위를 넘으면 예약을 보존한 결과미상으로 남긴다.
    const usage = { inputTokens: integer(provider.usage?.input_tokens), outputTokens: integer(provider.usage?.output_tokens) }
    if (usage.inputTokens > routing.reserveInputTokens || usage.outputTokens > routing.maxOutputTokens) return await unknown(usage)
    if ((provider.usage.cache_creation_input_tokens ?? 0) !== 0 || (provider.usage.cache_read_input_tokens ?? 0) !== 0) return await unknown()
    const text = provider.content.filter(row => row?.type === 'text').map(row => { if (typeof row.text !== 'string') throw Error('invalid text'); return row.text }).join('')
    const response = transformResponse({ text, stop_reason: provider.stop_reason, usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } })
    if (!response || typeof response !== 'object' || Buffer.byteLength(JSON.stringify(response)) > 1000000) return await unknown()
    return terminal(await rpc('finish', { ...lease, p_result: { state: 'completed', response, usage, providerMessageId: provider.id } }))
  } catch { return await unknown() }
}
