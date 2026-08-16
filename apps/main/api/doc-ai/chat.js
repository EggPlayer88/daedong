// POST /api/doc-ai/chat — 평가계획서 수집 대화 (Node, Vercel Function)
//
// 설계 원칙 (D19): AI 는 "내용 수집"만 한다. 파일 생성은 generate.py 가 결정적으로 수행.
// 이 함수는 manifest 의 필드 명세를 시스템 프롬프트로 주입하고, 대화가 확정되면
// AI 가 ===PLAN_READY=== JSON ===END=== 마커로 결과를 뱉게 한다.
//
// ⚠ 필드 목록을 이 파일에 하드코딩하지 말 것. manifest 가 바뀌면 프롬프트도 따라 바뀌어야 한다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ESM 에는 __dirname 이 없다. import.meta.url 로 파생시킨다.
const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(HERE, '_assets', 'template-manifest.json')

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))

// 모델은 env 로 교체 가능 (기본: 현재 Sonnet 세대)
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

// 비용 폭주 방지 상한
const MAX_MESSAGES = 60
const MAX_TOTAL_CHARS = 40000

// ---------------------------------------------------------------------------
// 시스템 프롬프트 — manifest 에서 코드로 생성
// ---------------------------------------------------------------------------
function fieldLine(f) {
  const bits = [f.type === 'number' ? '숫자' : '텍스트']
  bits.push(f.required ? '필수' : '선택')
  if (f.default !== undefined && f.default !== '') bits.push(`기본값 ${f.default}`)
  return `- ${f.label} (key: ${f.key}, ${bits.join(', ')})`
}

function buildJsonSkeleton(m) {
  const obj = {}
  for (const f of m.fields) obj[f.key] = f.type === 'number' ? 0 : '…'
  const g = m.repeating_group
  if (g) {
    const item = {}
    for (const it of g.item_fields) item[it.key] = '…'
    obj[g.key] = [item]
  }
  return JSON.stringify(obj, null, 2)
}

function buildSystemPrompt(m) {
  const g = m.repeating_group
  const lines = []

  lines.push(
    `너는 대동여자중학교의 ${m.doc_title} 작성 도우미다. 교사와 대화하며 아래 항목을`,
    `수집해 ${m.doc_title}를 완성한다.`,
    '',
    '[수집 항목]'
  )
  for (const f of m.fields) lines.push(fieldLine(f))
  if (g) {
    const itemDesc = g.item_fields.map((it) => `${it.label}(${it.key})`).join(' / ')
    lines.push(
      `- ${g.label} (key: ${g.key}, ${g.min}~${g.max}개) — 각 항목마다: ${itemDesc}`
    )
  }

  lines.push('', '[대화 규칙]')
  lines.push(
    '- 첫 인사에서 무엇을 만들지 한 줄로 안내하고, 교과·학년부터 묻는다.',
    '- 한 번에 1~2개 항목만 묻는다. 교사가 한꺼번에 여러 정보를 주면 모두 반영하고 빠진 것만 이어서 묻는다.',
    '- 교사가 준 정보를 절대 지어내거나 임의로 보완하지 않는다. 불명확하면 되묻는다.'
  )
  const ratio = m.validation?.ratio_sum_100
  if (ratio) {
    const labels = ratio
      .map((k) => m.fields.find((f) => f.key === k)?.label || k)
      .join(' + ')
    lines.push(
      `- ${labels} 의 합이 100 이 아니면 지적하고 재확인한다 (자유학기 등 지필 0% 는 가능 — 사유를 지필평가 계획에 기록).`
    )
  }
  lines.push(
    '- 평가 기준 등 서술 항목은 교사의 메모를 학업성적관리규정에 맞는 문어체(개조식)로 다듬어 제안하고 확인받는다.',
    '- 학생 이름·성적 등 개인정보는 수집하지 않는다. 언급되면 계획서에 넣지 않겠다고 안내한다.',
    '- 모든 항목이 확정되면 전체 내용을 요약해 보여주고 "이대로 생성할까요?" 확인을 받는다.',
    '- 교사가 확정하면, 다른 말 없이 정확히 아래 형식만 출력한다:',
    '',
    '===PLAN_READY===',
    buildJsonSkeleton(m),
    '===END===',
    '',
    '[출력 형식 주의]',
    '- 위 JSON 의 key 는 반드시 그대로 쓴다. 라벨(한글)을 key 로 쓰지 않는다.',
    `- 숫자 항목은 따옴표 없는 숫자로 쓴다.`,
    '- 마커 줄(===PLAN_READY===, ===END===) 앞뒤에 다른 설명을 붙이지 않는다.',
    '- 확정 전에는 절대 이 마커를 출력하지 않는다.'
  )
  return lines.join('\n')
}

const SYSTEM_PROMPT = buildSystemPrompt(manifest)

// 테스트용 노출 (Vercel 은 default export 만 핸들러로 쓴다)
export { buildSystemPrompt, validateMessages, SYSTEM_PROMPT }

// ---------------------------------------------------------------------------
// 인증 — Supabase 에 검증 위임 (의존성 0)
// ---------------------------------------------------------------------------
async function verifyUser(authorization) {
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('서버에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다.')
  }
  if (!authorization) return null

  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  })
  if (!r.ok) return null
  return await r.json()
}

// ---------------------------------------------------------------------------
// 요청 검증
// ---------------------------------------------------------------------------
function validateMessages(body) {
  const messages = body?.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages 는 비어있지 않은 배열이어야 합니다.' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { error: `대화가 너무 깁니다 (${messages.length}/${MAX_MESSAGES}). 새로 시작해 주세요.` }
  }
  let total = 0
  for (const m of messages) {
    if (m?.role !== 'user' && m?.role !== 'assistant') {
      return { error: "각 메시지의 role 은 'user' 또는 'assistant' 여야 합니다." }
    }
    if (typeof m.content !== 'string' || m.content.length === 0) {
      return { error: '각 메시지의 content 는 비어있지 않은 문자열이어야 합니다.' }
    }
    total += m.content.length
  }
  if (total > MAX_TOTAL_CHARS) {
    return { error: `대화 총 길이가 너무 깁니다 (${total}/${MAX_TOTAL_CHARS}자). 새로 시작해 주세요.` }
  }
  return { messages }
}

// ---------------------------------------------------------------------------
// 핸들러
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST 만 지원합니다.' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: '서버에 ANTHROPIC_API_KEY 가 없습니다. Vercel 환경변수를 확인해 주세요.',
    })
  }

  let user
  try {
    user = await verifyUser(req.headers.authorization)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' })

  const parsed = validateMessages(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  let r
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        // 양식 수집 대화라 깊은 추론이 필요 없다. thinking 을 끄지 않으면
        // max_tokens 를 사고 토큰이 잠식해 응답이 잘릴 수 있다.
        thinking: { type: 'disabled' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT,
        messages: parsed.messages,
      }),
    })
  } catch (e) {
    return res.status(502).json({ error: `Claude API 에 연결하지 못했습니다: ${e.message}` })
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    console.error('[doc-ai/chat] Anthropic error', r.status, detail.slice(0, 500))
    // 키/토큰 원문은 클라이언트로 내보내지 않는다.
    return res.status(502).json({
      error: `Claude API 오류 (${r.status}). 잠시 후 다시 시도해 주세요.`,
    })
  }

  const data = await r.json()

  if (data.stop_reason === 'refusal') {
    return res.status(200).json({
      reply: '요청을 처리할 수 없습니다. 내용을 바꿔 다시 시도해 주세요.',
      stop_reason: 'refusal',
    })
  }

  const reply = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  return res.status(200).json({
    reply,
    stop_reason: data.stop_reason,
    usage: data.usage,
  })
}
