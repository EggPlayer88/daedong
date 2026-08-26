// 전 교과 스모크 (대화 시작 쪽) — prefill 색인 35건 전부로 chat 핸들러를 실제로 돌린다.
//
// 왜 있는가: 2026-08-26, 1학년 '디지털 리터러시' 에서만 화면에
//   Unexpected token 'A', "An error o"... 가 떴다. 서버 함수가 JSON 이 아닌 것을
//   돌려줬다는 뜻이고, **교과 하나가 특이한 경로를 탄다는 것을 사람이 먼저 발견했다.**
//   그 일이 다시 없도록 색인의 교과·학년을 전부 자동으로 통과시킨다.
//
// 무엇을 보는가 — 응답 내용의 품질이 아니라 **크래시 0**:
//   · 핸들러가 예외를 던지지 않고 항상 JSON 으로 끝나는가
//   · 교과명을 붙여 써도(공백 없이) 같은 작년 자료를 찾는가
//   · 성취기준 DB 에 없는 교과도 같은 경로를 끝까지 가는가
//
// 짝: tests/test_smoke_subjects.py (생성 완료 쪽 — 실제 hwpx 까지)
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`

// 핸들러는 env 와 외부 호출에 기댄다 — 여기서는 그 둘을 대신 세워 두고 **우리 코드만** 본다.
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.VITE_SUPABASE_URL = 'https://stub.invalid'
process.env.VITE_SUPABASE_ANON_KEY = 'stub'

let lastRequest = null
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  const J = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  if (u.includes('/auth/v1/user')) return J({ id: 'u1' })
  if (u.includes('/rest/v1/users')) return J([{ is_active: true }])
  if (u.includes('api.anthropic.com')) {
    lastRequest = JSON.parse(opts.body)
    return J({ content: [{ type: 'text', text: '네, 시작하겠습니다.' }], stop_reason: 'end_turn' })
  }
  throw new Error(`예상하지 못한 외부 호출: ${u}`)
}

const mod = await import(`${API}/chat.js`)
const { default: handler, prefillIndex, normSubject, standardsDb } = mod

let fail = 0
const ck = (n, fn) => {
  try {
    fn()
    console.log(`  ✓ ${n}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${n}: ${e.message}`)
  }
}
const A = (c, m) => {
  if (!c) throw new Error(m)
}

/** Vercel Node 함수의 res 를 흉내낸다 (status/json 만 쓴다) */
function fakeRes() {
  const o = { code: 0, body: null, headers: {} }
  o.setHeader = (k, v) => {
    o.headers[k] = v
  }
  o.status = (s) => {
    o.code = s
    return o
  }
  o.json = (b) => {
    o.body = b
    return o
  }
  return o
}

/** 교사가 첫 줄을 쳤을 때 실제로 일어나는 일 한 번. 예외는 잡지 않고 그대로 터뜨린다. */
async function startChat(text) {
  lastRequest = null
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { messages: [{ role: 'user', content: text }] },
    },
    res
  )
  const system = lastRequest?.system || []
  return {
    code: res.code,
    body: res.body,
    // prefill 은 고정부 뒤에 **따로** 붙는다 — 블록이 2개면 작년 자료가 주입된 것이다
    prefill: system.length > 1 ? system[1].text : '',
  }
}

const ENTRIES = [...prefillIndex.entries()].map(([key, entry]) => {
  const at = key.lastIndexOf('|')
  return { subject: key.slice(0, at), grade: Number(key.slice(at + 1)), file: entry.file }
})

console.log(`\n[전 교과 대화 시작 — ${ENTRIES.length}건, 크래시 0]`)
const results = new Map()
for (const e of ENTRIES) {
  const label = `${e.subject} ${e.grade}학년`
  // 붙여 쓴 표기도 함께 — 교사가 실제로 그렇게 친다
  const typed = [...new Set([e.subject, normSubject(e.subject)])]
  const seen = []
  let err = null
  for (const t of typed) {
    try {
      seen.push(await startChat(`${e.grade}학년 ${t} 평가계획서 작성하려고 합니다.`))
    } catch (x) {
      err = x
      break
    }
  }
  results.set(label, seen)
  ck(`${label} (${e.file})`, () => {
    A(!err, `핸들러가 터졌다: ${err && `${err.constructor.name}: ${err.message}`}`)
    for (const [i, r] of seen.entries()) {
      A(r.code === 200, `${typed[i]}: ${r.code} — ${JSON.stringify(r.body).slice(0, 120)}`)
      A(typeof r.body?.reply === 'string', `${typed[i]}: reply 가 문자열이 아님`)
      A(r.prefill.includes(e.subject), `${typed[i]}: 작년 자료가 붙지 않음`)
    }
    // 표기가 갈려도 같은 자료여야 한다
    if (seen.length > 1) A(seen[0].prefill === seen[1].prefill, '표기에 따라 다른 자료가 붙음')
  })
}

console.log('\n[성취기준 DB 밖의 교과도 끝까지 간다]')
const DB = new Set(Object.keys(standardsDb?.subjects || {}).map(normSubject))
const OUTSIDE = ENTRIES.filter((e) => !DB.has(normSubject(e.subject)))
console.log(`  (DB 미수록: ${OUTSIDE.map((e) => `${e.subject} ${e.grade}학년`).join(', ') || '없음'})`)
ck('DB 밖 교과가 실제로 있다 (이 테스트의 전제)', () => {
  A(OUTSIDE.length > 0, 'DB 밖 교과가 하나도 없다 — 전제가 깨졌다')
})
ck('DB 밖 교과는 그 사실을 밝히고 작년 자료로 간다', () => {
  for (const e of OUTSIDE) {
    const [r] = results.get(`${e.subject} ${e.grade}학년`)
    A(r.prefill.includes('성취기준 DB 에 없다'), `${e.subject}: DB 부재 안내 없음`)
    A(r.prefill.includes('작년'), `${e.subject}: 작년 계승 경로가 사라짐`)
  }
})

console.log('\n[색인에 없는 교과 — 백지 모드로 가지 크래시가 아니다]')
{
  let r = null
  let err = null
  try {
    r = await startChat('1학년 학교자율시간 탐구활동 평가계획서 작성하려고 합니다.')
  } catch (e) {
    err = e
  }
  ck('모르는 교과: 예외 없이 200', () => {
    A(!err, `터짐: ${err && err.message}`)
    A(r.code === 200, `${r.code}`)
    A(r.prefill === '', '엉뚱한 교과의 작년 자료가 붙음')
  })
}

console.log()
if (fail) {
  console.log(`${fail}건 실패`)
  process.exit(1)
}
console.log(`전부 통과 (${ENTRIES.length}개 교과·학년)`)
