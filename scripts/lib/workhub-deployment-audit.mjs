import { createHash } from 'node:crypto'

// 상한은 외부 HTML이나 번들이 정하지 않는다. 시험에서는 더 작은 상한만 주입한다.
export const AUDIT_LIMITS = Object.freeze({ timeoutMs: 8000, htmlBytes: 524288, assetBytes: 3145728, totalAssetBytes: 8388608, maxAssets: 8, apiBytes: 2097152 })
const NOT_ASSESSED = ['login', 'authorization', 'database_readiness', 'sql_application', 'data_preservation']
const fingerprint = value => createHash('sha256').update(value).digest('hex')
const failure = code => Object.assign(new Error(code), { code })
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const projectRef = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const knownFailures = new Set(['INVALID_ARGUMENTS', 'REQUEST_TIMEOUT', 'REQUEST_FAILED', 'REDIRECT_BLOCKED', 'RESPONSE_TOO_LARGE', 'RESPONSE_BODY_UNSUPPORTED', 'CONTENT_TYPE_UNSUPPORTED', 'HTTP_RESPONSE_UNEXPECTED', 'UNSUPPORTED_MODULE_ASSET', 'UNSUPPORTED_DOCUMENT_BASE'])
const safeFailure = error => knownFailures.has(error?.code) ? error.code : 'REQUEST_FAILED'

function expectedHost(value) {
  if (typeof value !== 'string' || value.length > 160) throw failure('INVALID_ARGUMENTS')
  if (projectRef.test(value)) return value + '.supabase.co'
  const match = /^(?:https:\/\/)?([a-z0-9][a-z0-9-]*\.supabase\.co)\/?$/.exec(value)
  if (!match || !projectRef.test(match[1].split('.')[0])) throw failure('INVALID_ARGUMENTS')
  return match[1]
}
function siteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw failure('INVALID_ARGUMENTS')
  let url
  try { url = new URL(value) } catch { throw failure('INVALID_ARGUMENTS') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw failure('INVALID_ARGUMENTS')
  return url
}
export function parseAuditArguments(args) {
  const parsed = {}, keys = { '--site': 'site', '--expected-project': 'expectedProject', '--output': 'output' }
  for (let i = 0; i < args.length; i += 2) {
    if (!Object.hasOwn(keys, args[i])) throw failure('INVALID_ARGUMENTS')
    const key = keys[args[i]], value = args[i + 1]
    if (!key || Object.hasOwn(parsed, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw failure('INVALID_ARGUMENTS')
    parsed[key] = value
  }
  siteUrl(parsed.site)
  if (parsed.expectedProject !== undefined) expectedHost(parsed.expectedProject)
  if (parsed.output !== undefined && (parsed.output.length > 4096 || parsed.output.includes('\0'))) throw failure('INVALID_ARGUMENTS')
  return parsed
}
function boundedLimits(overrides = {}) {
  if (!plainObject(overrides) || Object.keys(overrides).some(key => !Object.hasOwn(AUDIT_LIMITS, key))) throw failure('INVALID_ARGUMENTS')
  const result = { ...AUDIT_LIMITS, ...overrides }
  for (const key of Object.keys(AUDIT_LIMITS)) if (!Number.isInteger(result[key]) || result[key] <= 0 || result[key] > AUDIT_LIMITS[key]) throw failure('INVALID_ARGUMENTS')
  return result
}
function utc(now) {
  // 외부 응답의 시각·메시지를 보고서로 옮기지 않는다.
  try { const date = now(); return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : new Date().toISOString() }
  catch { return new Date().toISOString() }
}

async function readBounded(fetchImpl, url, { headers, maximum, timeoutMs, types }) {
  const controller = new AbortController()
  let reader, timer
  const task = async () => {
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers })
    if (controller.signal.aborted) throw failure('REQUEST_TIMEOUT')
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw failure('HTTP_RESPONSE_UNEXPECTED')
    if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== url.href) throw failure('REDIRECT_BLOCKED')
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > maximum) throw failure('RESPONSE_TOO_LARGE')
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (types && !types.includes(contentType)) throw failure('CONTENT_TYPE_UNSUPPORTED')
    if (!response.body?.getReader) throw failure('RESPONSE_BODY_UNSUPPORTED')
    reader = response.body.getReader()
    let size = 0
    const chunks = []
    while (true) {
      const chunk = await reader.read()
      if (controller.signal.aborted) throw failure('REQUEST_TIMEOUT')
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximum) throw failure('RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(chunk.value))
    }
    return { status: response.status, body: Buffer.concat(chunks, size) }
  }
  try {
    return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('REQUEST_TIMEOUT')) }, timeoutMs) })])
  } catch (error) { throw failure(controller.signal.aborted ? 'REQUEST_TIMEOUT' : safeFailure(error)) }
  finally {
    clearTimeout(timer)
    controller.abort()
    // 중단을 무시하는 스트림의 cancel 완료까지 기다려 시간 상한을 넘기지 않는다.
    try { Promise.resolve(reader?.cancel()).catch(() => {}) } catch { /* 원시 전송 오류는 버린다. */ }
  }
}

function moduleAssets(html, site) {
  const urls = new Set()
  // HTML에 명시된 module 자산만 읽는다. JS 실행·재귀 import·외부 CDN 탐색은 하지 않는다.
  const source = html.replace(/<!--[\s\S]*?-->/g, '')
  if (/<base\b[^>]*\bhref\s*=/i.test(source)) throw failure('UNSUPPORTED_DOCUMENT_BASE')
  for (const tag of source.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attrs = new Map()
    for (const attribute of tag[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4])
    const script = tag[1].toLowerCase() === 'script'
    if (script ? attrs.get('type')?.toLowerCase() !== 'module' : !attrs.get('rel')?.toLowerCase().split(/\s+/).includes('modulepreload')) continue
    const raw = attrs.get(script ? 'src' : 'href')
    if (!raw || raw.includes('&')) throw failure('UNSUPPORTED_MODULE_ASSET')
    let url
    try { url = new URL(raw, site) } catch { throw failure('UNSUPPORTED_MODULE_ASSET') }
    if (url.origin !== site.origin || url.username || url.password || url.hash || !/\.(?:m?js)$/i.test(url.pathname)) throw failure('UNSUPPORTED_MODULE_ASSET')
    urls.add(url.href)
  }
  return [...urls]
}
function discover(sources) {
  const hosts = new Set(), keys = new Set()
  let unsupported = false
  for (const source of sources) {
    for (const match of source.matchAll(/https:\/\/([a-z0-9][a-z0-9-]*\.supabase\.co)(?![a-z0-9._:-])/gi)) {
      const host = match[1].toLowerCase()
      if (projectRef.test(host.split('.')[0])) hosts.add(host)
    }
    if (/\bsb_publishable_[a-zA-Z0-9_-]+/.test(source)) unsupported = true
    for (const match of source.matchAll(/(?<![a-zA-Z0-9_-])([a-zA-Z0-9_-]{8,2048}\.[a-zA-Z0-9_-]{8,8192}\.[a-zA-Z0-9_-]{16,1024})(?![a-zA-Z0-9_-])/g)) {
      const parts = match[1].split('.')
      try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        // 서명 검증이 아닌 공개 anon 키 분류다. 사용자 토큰과 서비스 키는 전송하지 않는다.
        if (!plainObject(header) || !plainObject(payload) || header.alg !== 'HS256' || header.typ !== 'JWT' || payload.role !== 'anon' || payload.iss !== 'supabase' || typeof payload.ref !== 'string' || !projectRef.test(payload.ref) || Object.hasOwn(payload, 'sub') || Object.hasOwn(payload, 'session_id') || Buffer.from(parts[2], 'base64url').length !== 32) continue
        keys.add(match[1])
      } catch { /* 분류할 수 없는 토큰은 사용하지 않는다. */ }
    }
  }
  return { hosts, keys, unsupported }
}
function checkResult(status = 'not_checked', code = 'NOT_REQUESTED', httpStatus = null) { return { status, code, httpStatus } }
function jsonBody(response) { try { return JSON.parse(response.body.toString('utf8')) } catch { return null } }

export async function auditDeployment(options, { fetch: fetchImpl = globalThis.fetch, now = () => new Date(), limits: overrides } = {}) {
  const report = {
    kind: 'workhub-deployment-audit', schemaVersion: 1, purpose: 'read_only_public_deployment_probe',
    probeScope: { role: 'anon', schema: 'public', method: 'GET', contextArguments: 'none' }, status: 'incomplete', code: 'NOT_STARTED',
    startedAt: utc(now), finishedAt: null, assets: [],
    project: { fingerprint: null, expectedMatch: 'unknown' },
    checks: { openApi: { ...checkResult(), contextListed: null }, context: checkResult() },
    notAssessed: [...NOT_ASSESSED],
  }
  const finish = (status, code) => { report.status = status; report.code = code; report.finishedAt = utc(now); return report }
  let site, expected, limits
  try {
    site = siteUrl(options?.site)
    expected = options?.expectedProject === undefined ? undefined : expectedHost(options.expectedProject)
    limits = boundedLimits(overrides)
    if (typeof fetchImpl !== 'function') throw failure('INVALID_ARGUMENTS')
  } catch { return finish('blocked', 'INVALID_ARGUMENTS') }
  try {
    const html = await readBounded(fetchImpl, site, { headers: { Accept: 'text/html' }, maximum: limits.htmlBytes, timeoutMs: limits.timeoutMs, types: ['text/html', 'application/xhtml+xml'] })
    if (html.status !== 200) return finish('incomplete', 'SITE_HTTP_UNEXPECTED')
    const assets = moduleAssets(html.body.toString('utf8'), site)
    if (!assets.length) return finish('blocked', 'NO_MODULE_ASSETS')
    if (assets.length > limits.maxAssets) return finish('blocked', 'ASSET_COUNT_LIMIT')
    const sources = []
    let remaining = limits.totalAssetBytes
    for (const asset of assets) {
      if (remaining <= 0) return finish('blocked', 'ASSET_TOTAL_SIZE_LIMIT')
      const result = await readBounded(fetchImpl, new URL(asset), { headers: { Accept: 'text/javascript, application/javascript' }, maximum: Math.min(limits.assetBytes, remaining), timeoutMs: limits.timeoutMs, types: ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'] })
      if (result.status !== 200) return finish('incomplete', 'ASSET_HTTP_UNEXPECTED')
      report.assets.push({ sha256: fingerprint(result.body), bytes: result.body.length })
      remaining -= result.body.length
      sources.push(result.body.toString('utf8'))
    }
    const found = discover(sources)
    if (found.hosts.size !== 1) return finish('blocked', found.hosts.size ? 'AMBIGUOUS_PROJECT' : 'PROJECT_NOT_FOUND')
    const host = [...found.hosts][0]
    report.project.fingerprint = fingerprint(host)
    if (expected !== undefined) {
      report.project.expectedMatch = host === expected ? 'matched' : 'mismatch'
      if (host !== expected) return finish('blocked', 'EXPECTED_PROJECT_MISMATCH')
    }
    const keys = [...found.keys].filter(key => JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).ref + '.supabase.co' === host)
    if (keys.length !== 1) return finish('blocked', keys.length > 1 ? 'AMBIGUOUS_ANON_KEY' : found.unsupported ? 'UNSUPPORTED_PUBLISHABLE_KEY' : 'MATCHING_ANON_KEY_NOT_FOUND')
    const headers = { Accept: 'application/json', 'Accept-Profile': 'public', apikey: keys[0], Authorization: 'Bearer ' + keys[0] }
    // URL은 검증한 단일 프로젝트 호스트와 고정 경로만으로 만든다.
    try {
      const response = await readBounded(fetchImpl, new URL('https://' + host + '/rest/v1/'), { headers: { ...headers, Accept: 'application/openapi+json' }, maximum: limits.apiBytes, timeoutMs: limits.timeoutMs })
      const body = jsonBody(response)
      if (response.status === 200 && plainObject(body) && (body.swagger === '2.0' || typeof body.openapi === 'string') && plainObject(body.paths)) {
        report.checks.openApi = { ...checkResult('observed', 'ANONYMOUS_SCHEMA_OBSERVED', 200), contextListed: Object.hasOwn(body.paths, '/rpc/workhub_context') }
      } else report.checks.openApi = { ...checkResult('unknown', response.status === 401 || response.status === 403 ? 'SCHEMA_VISIBILITY_UNKNOWN' : 'SCHEMA_UNRESOLVED', response.status), contextListed: null }
    } catch (error) { report.checks.openApi = { ...checkResult('unknown', safeFailure(error)), contextListed: null } }
    try {
      const response = await readBounded(fetchImpl, new URL('https://' + host + '/rest/v1/rpc/workhub_context'), { headers, maximum: limits.apiBytes, timeoutMs: limits.timeoutMs })
      const body = jsonBody(response)
      if (response.status === 200 && body !== null) report.checks.context = checkResult('observed', 'ANONYMOUS_RESPONSE_RECEIVED', 200)
      else report.checks.context = checkResult('unknown', plainObject(body) && body.code === 'PGRST202' ? 'RPC_NOT_RESOLVED' : response.status === 401 || response.status === 403 ? 'ANONYMOUS_ACCESS_RESTRICTED' : 'RPC_UNRESOLVED', response.status)
    } catch (error) { report.checks.context = checkResult('unknown', safeFailure(error)) }
    return finish(report.checks.openApi.status === 'observed' && report.checks.context.status === 'observed' ? 'observed' : 'incomplete', 'ANONYMOUS_PROBES_FINISHED')
  } catch (error) { return finish('incomplete', safeFailure(error)) }
}
