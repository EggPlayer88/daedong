// D20 서버 게이트 — 승인 전에는 Claude API 를 호출하지 않는지까지 확인
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
process.env.VITE_SUPABASE_URL = 'https://fake.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.ANTHROPIC_API_KEY = 'sk-test'
const mod = await import(`${API}/chat.js`)

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

const realFetch = globalThis.fetch
let calls = []
function mockFetch({ isActive, rowMissing = false }) {
  calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url))
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'uid-1', email: 't@x.com' }) }
    }
    if (String(url).includes('/rest/v1/users')) {
      return { ok: true, json: async () => (rowMissing ? [] : [{ is_active: isActive }]) }
    }
    if (String(url).includes('api.anthropic.com')) {
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }) }
    }
    throw new Error('예상치 못한 호출: ' + url)
  }
}
const mockRes = () => {
  const r = { code: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}
const req = { method: 'POST', headers: { authorization: 'Bearer tok' }, body: { messages: [{ role: 'user', content: '안녕' }] } }

console.log('\n[chat 게이트]')
mockFetch({ isActive: false })
const r1 = mockRes(); await mod.default(req, r1)
ck('미승인 → 403 PENDING_APPROVAL', () => {
  A(r1.code === 403, `code=${r1.code}`)
  A(r1.body.error === 'PENDING_APPROVAL', JSON.stringify(r1.body))
  A(r1.body.message?.includes('승인 대기'), '안내 문구 없음')
})
ck('미승인이면 Claude API 를 호출하지 않는다 (비용 방어선)', () => {
  A(!calls.some(u => u.includes('anthropic.com')), `호출됨: ${calls.join(', ')}`)
})

mockFetch({ rowMissing: true })
const r2 = mockRes(); await mod.default(req, r2)
ck('users 행이 없으면 대기로 본다 (안전한 쪽)', () => A(r2.code === 403, `code=${r2.code}`))

mockFetch({ isActive: true })
const r3 = mockRes(); await mod.default(req, r3)
ck('승인 → 정상 통과 + Claude 호출', () => {
  A(r3.code === 200, `code=${r3.code}`)
  A(calls.some(u => u.includes('anthropic.com')), '호출 안 됨')
})

// 토큰 없음은 승인 조회 전에 401
globalThis.fetch = async () => { throw new Error('호출되면 안 됨') }
const r4 = mockRes()
await mod.default({ ...req, headers: {} }, r4)
ck('토큰 없으면 401 (승인 조회도 안 함)', () => A(r4.code === 401, `code=${r4.code}`))

globalThis.fetch = realFetch
console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
