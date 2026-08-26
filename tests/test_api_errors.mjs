// fetch 공통 에러 처리 — **JSON 이 아닌 응답이 화면에 그대로 새지 않는지.**
//
// 왜 있는가: 서버 함수가 죽거나 시간을 넘기면 Vercel 은 우리 JSON 대신 자기 오류 페이지를
//   돌려준다. 그것을 그대로 r.json() 하면 교사 화면에 이 문장이 뜬다:
//       Unexpected token 'A', "An error o"... is not valid JSON
//   2026-08-26 기준 같은 혼란이 세 번째였다. 여기서 고정한다.
//
// 지키는 것:
//   · 비JSON 응답은 사람이 읽는 문장으로 바뀐다
//   · 그러면서 **상태 코드는 남는다** — 다음에 같은 일이 나면 504(시간 초과)인지
//     500(크래시)인지 로그 없이도 갈린다. 조용히 삼키면 추적이 처음으로 돌아간다
//   · 서버가 JSON 으로 답한 실패(400·403·409)는 던지지 않고 호출부로 넘어간다
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { postJson, ApiError } = await import(`${ROOT}/apps/main/src/lib/api.js`)

let fail = 0
const ck = (n, fn) =>
  fn().then(
    () => console.log(`  ✓ ${n}`),
    (e) => {
      fail++
      console.log(`  ✗ ${n}: ${e.message}`)
    }
  )
const A = (c, m) => {
  if (!c) throw new Error(m)
}

// 콘솔 진단은 이 테스트의 관심사가 아니다 — 대신 실제로 찍히는지만 세어 둔다
const logged = []
console.error = (...a) => logged.push(a.join(' '))

/** 서버 응답 하나를 세워 두고 postJson 을 부른다 */
function serve(body, { status = 200, type = 'application/json' } = {}) {
  globalThis.fetch = async () =>
    // 204 등 본문 없는 상태 코드는 Response 가 빈 문자열 본문을 거부한다 — null 로 준다
    new Response(body === '' ? null : body, {
      status,
      headers: type ? { 'content-type': type } : {},
    })
  return postJson('/api/doc-ai/chat', { messages: [] }, 'tok')
}

/** 던진 오류를 돌려준다 (안 던지면 실패) */
async function thrown(fn) {
  try {
    await fn()
  } catch (e) {
    return e
  }
  throw new Error('던지지 않았다')
}

console.log('\n[비JSON 응답 — 교사가 읽을 수 있는 문장으로]')
// Vercel 이 함수 크래시·시간 초과에 돌려주는 실제 문구 (앞부분이 "An error o…")
const VERCEL_ERR = 'An error occurred with this application.\n\nFUNCTION_INVOCATION_FAILED'

await ck('크래시(500) → 일시적인 서버 오류', async () => {
  const e = await thrown(() => serve(VERCEL_ERR, { status: 500, type: 'text/plain' }))
  A(e instanceof ApiError, `ApiError 가 아님: ${e.name}`)
  A(!/Unexpected token|not valid JSON/.test(e.message), `원문이 샜다: ${e.message}`)
  A(e.message.includes('일시적인 서버 오류'), e.message)
  A(e.message.includes('500'), `상태 코드가 사라짐: ${e.message}`)
  A(e.status === 500, `status=${e.status}`)
})
await ck('시간 초과(504) → 시간 초과라고 말한다', async () => {
  const e = await thrown(() => serve(VERCEL_ERR, { status: 504, type: 'text/plain' }))
  A(e.message.includes('처리 시간을 넘겼습니다'), e.message)
  A(e.message.includes('504'), e.message)
})
await ck('502·503 → 잠시 후 다시', async () => {
  for (const s of [502, 503]) {
    const e = await thrown(() => serve('Bad gateway', { status: s, type: 'text/plain' }))
    A(e.message.includes('일시적으로 응답하지 못했습니다'), `${s}: ${e.message}`)
    A(e.message.includes(String(s)), `${s}: 코드 없음`)
  }
})
await ck('413 → 내용이 너무 크다고 말한다', async () => {
  const e = await thrown(() => serve('Payload too large', { status: 413, type: 'text/plain' }))
  A(e.message.includes('너무 큽니다'), e.message)
})
await ck('HTML 오류 페이지도 같은 경로', async () => {
  const e = await thrown(() =>
    serve('<!doctype html><title>500</title>', { status: 500, type: 'text/html' })
  )
  A(e.message.includes('일시적인 서버 오류'), e.message)
})
await ck('content-type 이 json 이라고 우겨도 파싱에 실패하면 비JSON', async () => {
  // 오류 페이지가 잘못된 헤더를 달고 오는 경우가 있다 — 헤더만 믿지 않는다
  const e = await thrown(() => serve(VERCEL_ERR, { status: 500, type: 'application/json' }))
  A(e.message.includes('일시적인 서버 오류'), e.message)
})
await ck('원문 앞부분을 콘솔에 남긴다 (다음 추적용)', async () => {
  logged.length = 0
  await thrown(() => serve(VERCEL_ERR, { status: 500, type: 'text/plain' }))
  A(logged.length === 1, `콘솔 기록 ${logged.length}건`)
  A(logged[0].includes('An error occurred'), `원문이 남지 않음: ${logged[0]}`)
  A(logged[0].includes('500'), '상태 코드가 남지 않음')
})

console.log('\n[네트워크가 끊긴 경우]')
await ck('fetch 자체가 실패 → 연결 안내', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  const e = await thrown(() => postJson('/api/doc-ai/chat', {}, 'tok'))
  A(e instanceof ApiError, e.name)
  A(e.message.includes('연결하지 못했습니다'), e.message)
  A(!e.message.includes('Failed to fetch'), `원문이 샜다: ${e.message}`)
})

console.log('\n[서버가 JSON 으로 답한 실패는 그대로 넘긴다]')
await ck('400 REGULATION_VIOLATION 은 던지지 않는다', async () => {
  const r = await serve(JSON.stringify({ error: 'REGULATION_VIOLATION', findings: [1] }), {
    status: 400,
  })
  A(r.status === 400 && r.ok === false, `${r.status}/${r.ok}`)
  A(r.data.error === 'REGULATION_VIOLATION', JSON.stringify(r.data))
})
await ck('403 PENDING_APPROVAL 도 그대로', async () => {
  const r = await serve(JSON.stringify({ error: 'PENDING_APPROVAL' }), { status: 403 })
  A(r.status === 403 && r.data.error === 'PENDING_APPROVAL', JSON.stringify(r.data))
})
await ck('409 TEMPLATE_MISSING 도 그대로', async () => {
  const r = await serve(JSON.stringify({ error: 'TEMPLATE_MISSING' }), { status: 409 })
  A(r.status === 409 && r.data.error === 'TEMPLATE_MISSING', JSON.stringify(r.data))
})
await ck('200 정상 응답', async () => {
  const r = await serve(JSON.stringify({ reply: '안녕하세요' }))
  A(r.ok && r.data.reply === '안녕하세요', JSON.stringify(r.data))
})
await ck('본문이 빈 정상 응답은 빈 객체', async () => {
  const r = await serve('', { status: 204, type: '' })
  A(r.ok && JSON.stringify(r.data) === '{}', JSON.stringify(r.data))
})
await ck('본문이 빈 실패는 사람이 읽는 문장', async () => {
  const e = await thrown(() => serve('', { status: 500, type: '' }))
  A(e.message.includes('일시적인 서버 오류'), e.message)
})

console.log('\n[화면 코드가 이 경로를 실제로 쓰는지]')
const { readFileSync } = await import('node:fs')
const page = readFileSync(`${ROOT}/apps/main/src/pages/DocAiPage.jsx`, 'utf-8')
await ck('DocAiPage 에 날 fetch + r.json() 조합이 남아 있지 않다', async () => {
  A(!/await\s+fetch\(/.test(page), '날 fetch 가 남아 있다')
  A(!/\.json\(\)/.test(page), 'r.json() 이 남아 있다')
  const n = (page.match(/postJson\(/g) || []).length
  A(n === 4, `postJson 호출 ${n}건 (chat·check_only·generate·extract 4건이어야 한다)`)
})

console.log()
if (fail) {
  console.log(`${fail}건 실패`)
  process.exit(1)
}
console.log('전부 통과')
