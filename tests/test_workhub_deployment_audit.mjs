import assert from 'node:assert/strict'

// 실제 주소·키·DB를 사용하지 않는다. 주입을 놓친 fetch도 네트워크 전에 실패한다.
const realFetch = globalThis.fetch
let unexpectedFetches = 0
globalThis.fetch = async () => { unexpectedFetches++; throw new Error('시험의 실제 네트워크 호출 금지') }
let passed = 0, failed = 0
async function test(name, run) {
  try { await run(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) }
}

const SITE = 'https://deployment.example.invalid'
const PROJECT = 'abcdefghijklmnopqrst'
const OTHER = 'zyxwvutsrqponmlkjihgf'
const API = `https://${PROJECT}.supabase.co`
const LEAK = 'SYNTHETIC_PRIVATE_BODY_DO_NOT_REPORT'
const NOW = new Date('2026-10-14T06:00:00.000Z')
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
function token(patch = {}, header = { alg: 'HS256', typ: 'JWT' }) {
  return `${encode(header)}.${encode({ iss: 'supabase', ref: PROJECT, role: 'anon', iat: 1, exp: 4102444800, ...patch })}.${Buffer.alloc(32, 7).toString('base64url')}`
}
const ANON = token()
const bundle = (key = ANON, project = PROJECT) => `const endpoint="https://${project}.supabase.co";const publicKey="${key}";`
const html = (...paths) => '<!doctype html><html><head>' + paths.map(path => `<script type="module" src="${path}"></script>`).join('') + '</head></html>'
function response(url, body, status = 200, headers = {}, overrides = {}) {
  const contentType = /\.m?js$/.test(new URL(url).pathname) ? 'text/javascript' : url.startsWith(API) ? 'application/json' : 'text/html'
  const result = new Response(body, { status, headers: { 'content-type': contentType, ...headers } })
  Object.defineProperties(result, { url: { value: url, configurable: true }, redirected: { value: false, configurable: true } })
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(result, key, { value })
  return result
}
function fixture(overrides = {}) {
  const calls = []
  const fetch = async (input, init = {}) => {
    const url = String(input)
    const call = { url, init, headers: new Headers(init.headers) }
    calls.push(call)
    assert.equal(init.method, 'GET', '조사는 GET만 허용한다')
    assert.equal(init.redirect, 'manual', '리다이렉트는 자동으로 따르지 않는다')
    assert.equal(init.credentials, 'omit', '브라우저 세션·쿠키를 붙이지 않는다')
    assert.ok(init.signal instanceof AbortSignal)
    if (!url.startsWith(API + '/rest/v1/')) {
      assert.equal(call.headers.has('authorization'), false)
      assert.equal(call.headers.has('apikey'), false)
    }
    if (Object.hasOwn(overrides, url)) {
      const value = overrides[url]
      return typeof value === 'function' ? value(call) : value
    }
    if (url === SITE || url === SITE + '/') return response(url, html('/assets/main.js'), 200, { 'content-type': 'text/html' })
    if (url === SITE + '/assets/main.js') return response(url, bundle(), 200, { 'content-type': 'text/javascript' })
    if (url === API + '/rest/v1/') return response(url, JSON.stringify({ swagger: '2.0', paths: { '/rpc/workhub_context': { get: {} } } }), 200, { 'content-type': 'application/openapi+json' })
    if (url === API + '/rest/v1/rpc/workhub_context') return response(url, JSON.stringify({ code: '42501', message: LEAK }), 403, { 'content-type': 'application/json' })
    throw new Error('허용하지 않은 합성 요청: ' + url)
  }
  return { calls, fetch }
}
let auditDeployment, AUDIT_LIMITS, parseAuditArguments, runDeploymentAuditCli
const apiCalls = fixture => fixture.calls.filter(call => new URL(call.url).hostname.endsWith('.supabase.co'))
const noApi = fixture => assert.equal(apiCalls(fixture).length, 0)
function safeRequests(mock) {
  // 전송 함수의 assert를 제품이 오류로 처리해도 시험이 조용히 통과하지 않게 호출 뒤 다시 검사한다.
  for (const call of mock.calls) {
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.redirect, 'manual')
    assert.equal(call.init.credentials, 'omit')
    assert.equal(call.init.body, undefined)
    assert.equal(call.headers.has('cookie'), false)
    assert.ok(call.init.signal instanceof AbortSignal)
    if (!call.url.startsWith(API + '/rest/v1/')) {
      assert.equal(call.headers.has('authorization'), false)
      assert.equal(call.headers.has('apikey'), false)
    }
  }
}
function safeReport(report, secrets = []) {
  assert.deepEqual(Object.keys(report).sort(), ['assets', 'checks', 'code', 'finishedAt', 'kind', 'notAssessed', 'probeScope', 'project', 'purpose', 'schemaVersion', 'startedAt', 'status'].sort())
  assert.equal(report.kind, 'workhub-deployment-audit')
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.purpose, 'read_only_public_deployment_probe')
  assert.deepEqual(report.probeScope, { role: 'anon', schema: 'public', method: 'GET', contextArguments: 'none' })
  assert.ok(['observed', 'blocked', 'incomplete'].includes(report.status))
  assert.equal(new Date(report.startedAt).toISOString(), report.startedAt)
  assert.equal(new Date(report.finishedAt).toISOString(), report.finishedAt)
  assert.deepEqual(Object.keys(report.project).sort(), ['expectedMatch', 'fingerprint'])
  assert.ok(report.project.fingerprint === null || /^[a-f0-9]{64}$/.test(report.project.fingerprint))
  assert.deepEqual(Object.keys(report.checks).sort(), ['context', 'openApi'])
  assert.deepEqual(Object.keys(report.checks.context).sort(), ['code', 'httpStatus', 'status'])
  assert.deepEqual(Object.keys(report.checks.openApi).sort(), ['code', 'contextListed', 'httpStatus', 'status'])
  assert.deepEqual(report.notAssessed, ['login', 'authorization', 'database_readiness', 'sql_application', 'data_preservation'])
  for (const asset of report.assets) {
    assert.deepEqual(Object.keys(asset).sort(), ['bytes', 'sha256'])
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes >= 0)
  }
  const serialized = JSON.stringify(report)
  for (const secret of [ANON, LEAK, API, PROJECT, SITE, ...secrets]) assert.equal(serialized.includes(secret), false, '조사 결과에 원문이 남으면 안 된다')
}
async function inspect(mock, options = {}, dependencies = {}) {
  const report = await auditDeployment({ site: SITE, expectedProject: PROJECT, ...options }, { fetch: mock.fetch, now: () => NOW, ...dependencies })
  safeRequests(mock)
  safeReport(report)
  return report
}

try {
  await test('모듈과 CLI를 import해도 네트워크·표준 출력이 발생하지 않는다', async () => {
    const messages = []
    const oldLog = console.log, oldError = console.error
    const oldOut = process.stdout.write, oldErr = process.stderr.write
    console.log = (...args) => messages.push(args); console.error = (...args) => messages.push(args)
    process.stdout.write = value => { messages.push(String(value)); return true }
    process.stderr.write = value => { messages.push(String(value)); return true }
    try {
      ;({ auditDeployment, AUDIT_LIMITS, parseAuditArguments } = await import('../scripts/lib/workhub-deployment-audit.mjs'))
      ;({ runDeploymentAuditCli } = await import('../scripts/check-workhub-deployment.mjs'))
    } finally { console.log = oldLog; console.error = oldError; process.stdout.write = oldOut; process.stderr.write = oldErr }
    assert.deepEqual(messages, [])
    assert.equal(unexpectedFetches, 0)
  })

  await test('확인된 공개 anon 키만 같은 프로젝트의 GET 두 경로에 보내고 고정 보고서를 만든다', async () => {
    const mock = fixture()
    const report = await inspect(mock)
    assert.equal(report.project.expectedMatch, 'matched')
    assert.equal(report.checks.openApi.contextListed, true)
    assert.deepEqual(apiCalls(mock).map(call => call.url), [API + '/rest/v1/', API + '/rest/v1/rpc/workhub_context'])
    for (const call of apiCalls(mock)) {
      assert.equal(call.headers.get('apikey'), ANON)
      assert.equal(call.headers.get('authorization'), `Bearer ${ANON}`)
      assert.equal(call.headers.get('accept-profile'), 'public')
    }
  })

  await test('기대한 프로젝트와 다른 배포 번들은 API 요청 전에 중단한다', async () => {
    const mock = fixture()
    const report = await inspect(mock, { expectedProject: OTHER })
    assert.equal(report.project.expectedMatch, 'mismatch')
    assert.equal(report.status, 'blocked')
    noApi(mock)
  })

  await test('서비스 역할·사용자 토큰·다른 ref·issuer·alg의 키는 외부에 보내지 않는다', async () => {
    for (const key of [token({ role: 'service_role' }), token({ role: 'authenticated' }), token({ sub: 'synthetic-user-id' }), token({ ref: OTHER }), token({ iss: 'other' }), token({}, { alg: 'none' })]) {
      const mock = fixture({ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', bundle(key)) })
      const report = await inspect(mock)
      assert.equal(report.code, 'MATCHING_ANON_KEY_NOT_FOUND')
      safeReport(report, [key])
      noApi(mock)
    }
  })

  await test('중복 자산·중복 문자열은 중복 요청을 만들지 않는다', async () => {
    const mock = fixture({
      [SITE + '/']: response(SITE + '/', html('/assets/main.js', '/assets/main.js') + '<link rel="modulepreload" href="/assets/main.js">'),
      [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', bundle() + bundle()),
    })
    const report = await inspect(mock)
    assert.equal(report.project.expectedMatch, 'matched')
    assert.equal(mock.calls.filter(call => call.url === SITE + '/assets/main.js').length, 1)
    assert.equal(apiCalls(mock).length, 2)
  })

  await test('두 프로젝트 또는 상충하는 공개 키가 섞인 번들은 추측해 연결하지 않는다', async () => {
    for (const extra of [bundle(token({ ref: OTHER }), OTHER), bundle(token({ exp: 4102444700 }))]) {
      const mock = fixture({ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', bundle() + extra) })
      const report = await inspect(mock)
      assert.notEqual(report.status, 'observed')
      noApi(mock)
    }
  })

  await test('외부 origin의 module 자산은 요청하거나 일부 근거만으로 API를 검사하지 않는다', async () => {
    const mock = fixture({ [SITE + '/']: response(SITE + '/', html('/assets/main.js', 'https://untrusted.example.invalid/steal.js')) })
    const report = await inspect(mock)
    assert.equal(report.code, 'UNSUPPORTED_MODULE_ASSET')
    assert.equal(mock.calls.some(call => call.url.includes('untrusted.example.invalid')), false)
    noApi(mock)
  })

  await test('base 태그·inline module·비JS 모듈은 실제 실행 위치를 추정하지 않는다', async () => {
    for (const [source, code] of [
      ['<base href="https://untrusted.example.invalid/">' + html('assets/main.js'), 'UNSUPPORTED_DOCUMENT_BASE'],
      [html('/assets/main.js') + '<script type="module">import "https://untrusted.example.invalid/other.js"</script>', 'UNSUPPORTED_MODULE_ASSET'],
      [html('/assets/main.js', '/module-without-extension'), 'UNSUPPORTED_MODULE_ASSET'],
    ]) {
      const mock = fixture({ [SITE + '/']: response(SITE + '/', source) })
      const report = await inspect(mock)
      assert.equal(report.code, code)
      assert.equal(mock.calls.length, 1)
      noApi(mock)
    }
  })

  await test('사이트와 자산의 리다이렉트는 같은 origin을 포함해 따르지 않는다', async () => {
    for (const requested of [SITE + '/', SITE + '/assets/main.js']) {
      for (const location of [SITE + '/redirected.js', 'https://untrusted.example.invalid/steal.js']) {
        const mock = fixture({ [requested]: response(requested, LEAK, 302, { location }) })
        const report = await inspect(mock)
        assert.equal(report.code, 'REDIRECT_BLOCKED')
        assert.equal(mock.calls.some(call => call.url === location), false)
        noApi(mock)
      }
    }
  })

  await test('API 리다이렉트에도 키를 다른 주소로 전달하지 않는다', async () => {
    const target = 'https://untrusted.example.invalid/steal'
    const mock = fixture({ [API + '/rest/v1/']: response(API + '/rest/v1/', LEAK, 307, { location: target }) })
    const report = await inspect(mock)
    assert.equal(report.checks.openApi.status, 'unknown')
    assert.equal(report.checks.openApi.code, 'REDIRECT_BLOCKED')
    assert.equal(mock.calls.some(call => call.url === target), false)
  })

  await test('응답 객체가 다른 최종 URL이나 자동 리다이렉트를 표시해도 결과를 버린다', async () => {
    for (const overrides of [{ url: 'https://untrusted.example.invalid/main.js' }, { redirected: true }]) {
      const mock = fixture({ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', bundle(), 200, {}, overrides) })
      const report = await inspect(mock)
      assert.equal(report.code, 'REDIRECT_BLOCKED')
      noApi(mock)
    }
  })

  await test('자산 수 상한을 넘으면 앞부분만 검사한 상태로 API에 진행하지 않는다', async () => {
    const mock = fixture({ [SITE + '/']: response(SITE + '/', html('/assets/main.js', '/assets/extra.js')) })
    const report = await inspect(mock, {}, { limits: { maxAssets: 1 } })
    assert.equal(report.code, 'ASSET_COUNT_LIMIT')
    noApi(mock)
  })

  await test('HTML·자산·누적 자산 크기 상한은 Content-Length가 없어도 적용한다', async () => {
    for (const [overrides, limits] of [
      [{ [SITE + '/']: response(SITE + '/', html('/assets/main.js') + '가'.repeat(100)) }, { htmlBytes: 80 }],
      [{ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', bundle() + LEAK.repeat(30)) }, { assetBytes: 100 }],
      [{ [SITE + '/']: response(SITE + '/', html('/assets/main.js', '/assets/extra.js')), [SITE + '/assets/extra.js']: response(SITE + '/assets/extra.js', 'x'.repeat(200)) }, { totalAssetBytes: Buffer.byteLength(bundle()) + 50 }],
    ]) {
      const mock = fixture(overrides)
      const report = await inspect(mock, {}, { limits })
      assert.equal(report.code, 'RESPONSE_TOO_LARGE')
      noApi(mock)
    }
  })

  await test('API의 초과 본문은 파싱·출력하지 않고 확인 불가로 남긴다', async () => {
    const mock = fixture({ [API + '/rest/v1/']: response(API + '/rest/v1/', JSON.stringify({ paths: {}, secret: LEAK.repeat(30) })) })
    const report = await inspect(mock, {}, { limits: { apiBytes: 100 } })
    assert.equal(report.checks.openApi.status, 'unknown')
    assert.equal(report.checks.openApi.code, 'RESPONSE_TOO_LARGE')
  })

  await test('거짓 Content-Length와 여러 UTF-8 청크에도 실제 바이트 상한을 적용하고 취소한다', async () => {
    let cancelled = false
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('가'.repeat(20))); controller.enqueue(new TextEncoder().encode('나'.repeat(20))) },
      cancel() { cancelled = true },
    })
    const mock = fixture({ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', stream, 200, { 'content-length': '1' }) })
    const report = await inspect(mock, {}, { limits: { assetBytes: 100 } })
    assert.equal(report.code, 'RESPONSE_TOO_LARGE')
    assert.equal(cancelled, true)
    noApi(mock)
  })

  await test('응답이 멈추면 AbortSignal로 중단하고 API에 진행하지 않는다', async () => {
    let aborted = false
    const mock = fixture({ [SITE + '/']: ({ init }) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new Error(LEAK)) }, { once: true })
    }) })
    const report = await inspect(mock, {}, { limits: { timeoutMs: 10 } })
    assert.equal(aborted, true)
    assert.equal(report.code, 'REQUEST_TIMEOUT')
    noApi(mock)
  })

  await test('헤더 뒤 본문과 cancel이 멈춰도 시간 상한으로 반환한다', async () => {
    const stream = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) })
    const mock = fixture({ [SITE + '/assets/main.js']: response(SITE + '/assets/main.js', stream) })
    const report = await inspect(mock, {}, { limits: { timeoutMs: 10 } })
    assert.equal(report.code, 'REQUEST_TIMEOUT')
    noApi(mock)
  })

  await test('네트워크 오류 원문은 보고서나 console에 재출력하지 않는다', async () => {
    const messages = []
    const oldLog = console.log, oldError = console.error
    console.log = (...args) => messages.push(args); console.error = (...args) => messages.push(args)
    try {
      const mock = fixture({ [SITE + '/']: () => { throw new Error(`${LEAK} ${ANON}`) } })
      const report = await inspect(mock)
      assert.notEqual(report.status, 'observed')
      noApi(mock)
    } finally { console.log = oldLog; console.error = oldError }
    assert.deepEqual(messages, [])
  })

  await test('OpenAPI 401은 공개 목록 확인 불가이며 DB 함수 부재가 아니다', async () => {
    const mock = fixture({ [API + '/rest/v1/']: response(API + '/rest/v1/', LEAK, 401) })
    const report = await inspect(mock)
    assert.equal(report.checks.openApi.status, 'unknown')
    assert.equal(report.checks.openApi.contextListed, null)
    assert.equal(report.checks.openApi.httpStatus, 401)
    assert.equal(report.checks.openApi.code, 'SCHEMA_VISIBILITY_UNKNOWN')
  })

  await test('PGRST202는 물리 함수 미설치 판정으로 확대하지 않는다', async () => {
    const mock = fixture({ [API + '/rest/v1/rpc/workhub_context']: response(API + '/rest/v1/rpc/workhub_context', JSON.stringify({ code: 'PGRST202', message: LEAK }), 404) })
    const report = await inspect(mock)
    assert.equal(report.checks.context.status, 'unknown')
    assert.equal(report.checks.context.httpStatus, 404)
    assert.equal(report.checks.context.code, 'RPC_NOT_RESOLVED')
    assert.doesNotMatch(report.checks.context.code, /NOT_INSTALLED|PHYSICALLY_ABSENT|FOUNDATION_MISSING/)
  })

  await test('익명 200의 학교 응답은 담지 않으며 로그인·권한·DB 준비 완료로 표시하지 않는다', async () => {
    const mock = fixture({ [API + '/rest/v1/rpc/workhub_context']: response(API + '/rest/v1/rpc/workhub_context', JSON.stringify({ schools: [{ id: LEAK }], memberships: [{ userId: LEAK }] })) })
    const report = await inspect(mock)
    assert.equal(report.checks.context.httpStatus, 200)
    assert.equal(report.checks.context.code, 'ANONYMOUS_RESPONSE_RECEIVED')
    assert.notEqual(report.status, 'ready')
  })

  await test('잘못된 사이트·자격증명 URL·상한 값은 첫 fetch 전에 거부한다', async () => {
    for (const site of ['http://deployment.example.invalid', `https://user:${LEAK}@deployment.example.invalid`, 'file:///secret', 'not-a-url']) {
      const mock = fixture()
      const report = await inspect(mock, { site })
      assert.equal(report.status, 'blocked')
      assert.equal(mock.calls.length, 0)
    }
    for (const limits of [{ timeoutMs: 0 }, { maxAssets: -1 }, { apiBytes: '10' }, { timeoutMs: AUDIT_LIMITS.timeoutMs + 1 }]) {
      const mock = fixture()
      const report = await inspect(mock, {}, { limits })
      assert.equal(report.status, 'blocked')
      assert.equal(mock.calls.length, 0)
    }
  })

  await test('CLI의 잘못된 인자는 고정 오류로 거부하며 입력·토큰 원문을 출력하지 않는다', async () => {
    for (const argv of [[], ['--secret', LEAK], ['--site', `https://user:${LEAK}@deployment.example.invalid`], ['--site', SITE, '--site', SITE], ['--site', SITE, '--expected-project', ANON], ['--site', SITE, 'toString', LEAK], ['--site', SITE, '__proto__', LEAK]]) {
      assert.throws(() => parseAuditArguments(argv), error => error.code === 'INVALID_ARGUMENTS' && !error.message.includes(LEAK) && !error.message.includes(ANON))
      const mock = fixture(), out = [], err = [], writes = []
      const code = await runDeploymentAuditCli(argv, { fetch: mock.fetch, now: () => NOW, stdout: value => out.push(value), stderr: value => err.push(value), writeFile: (...args) => writes.push(args) })
      assert.notEqual(code, 0)
      assert.equal(mock.calls.length, 0)
      assert.deepEqual(writes, [])
      const output = JSON.stringify([out, err])
      assert.equal(output.includes(LEAK), false)
      assert.equal(output.includes(ANON), false)
    }
  })

  await test('CLI 성공 출력도 고정 JSON이며 실제 네트워크·파일 쓰기를 사용하지 않는다', async () => {
    const mock = fixture(), out = [], err = [], writes = []
    await runDeploymentAuditCli(['--site', SITE, '--expected-project', PROJECT], { fetch: mock.fetch, now: () => NOW, stdout: value => out.push(value), stderr: value => err.push(value), writeFile: (...args) => writes.push(args) })
    safeReport(JSON.parse(out.join('')))
    safeRequests(mock)
    assert.deepEqual(err, [])
    assert.deepEqual(writes, [])
    assert.equal(unexpectedFetches, 0)
  })

  await test('CLI 파일 출력은 기존 파일 덮어쓰기를 금지하며 쓰기 실패 원문을 숨긴다', async () => {
    const argv = ['--site', SITE, '--expected-project', PROJECT, '--output', 'synthetic-report.json']
    const mock = fixture(), out = [], err = [], writes = []
    await runDeploymentAuditCli(argv, { fetch: mock.fetch, now: () => NOW, stdout: value => out.push(value), stderr: value => err.push(value), writeFile: (...args) => writes.push(args) })
    assert.equal(writes.length, 1)
    assert.equal(writes[0][0], 'synthetic-report.json')
    assert.deepEqual(writes[0][2], { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    safeReport(JSON.parse(writes[0][1]))
    assert.equal(writes[0][1], out.join(''))
    assert.deepEqual(err, [])
    const failedOut = [], failedErr = []
    const code = await runDeploymentAuditCli(argv, { fetch: fixture().fetch, now: () => NOW, stdout: value => failedOut.push(value), stderr: value => failedErr.push(value), writeFile: () => { throw new Error(`${LEAK} ${ANON}`) } })
    assert.equal(code, 2)
    assert.deepEqual(failedOut, [])
    assert.deepEqual(failedErr, ['{"code":"REPORT_WRITE_FAILED"}\n'])
  })
} finally { globalThis.fetch = realFetch }

console.log(`배포 연결 읽기 조사: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
