// POST /api/doc-ai/chat — 「교수·학습 및 평가 계획서」 수집 대화 (Node, Vercel Function)
//
// 설계 원칙 (D19): AI 는 "내용 수집"만 한다. 파일 생성은 generate.py 가 결정적으로 수행.
//
// 시스템 프롬프트 = ① prompt-rules.v2.md 고정부 (대화 규칙 전문)
//                 + ② school-constants-*.json ({{CONSTANTS}} 자리에 주입)
//                 + ③ manifest v2 에서 생성한 수집 항목·출력 JSON 구조
//
// ⚠ 필드 목록·학교 상수를 이 파일에 하드코딩하지 말 것.
//   자산 3개 중 무엇이 바뀌어도 프롬프트가 자동으로 따라가야 한다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ESM 에는 __dirname 이 없다. import.meta.url 로 파생시킨다.
const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '_assets')

const manifest = JSON.parse(readFileSync(join(ASSETS, 'template-manifest.json'), 'utf-8'))
const constants = JSON.parse(
  readFileSync(join(ASSETS, 'school-constants-2026-2.json'), 'utf-8')
)
const rulesMd = readFileSync(join(ASSETS, 'prompt-rules.v2.md'), 'utf-8')

// 모델은 env 로 교체 가능 (기본: 현재 Sonnet 세대)
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

// v2 는 최종 JSON 이 크다 (월별 5행 + 수행 출제계획 최대 4블록).
// 2000 으로 두면 PLAN_READY JSON 이 중간에 잘린다.
const MAX_TOKENS = 8000

// 비용 폭주 방지 상한 (참고자료 hwpx 를 붙이는 것을 감안한 값)
const MAX_MESSAGES = 80
const MAX_TOTAL_CHARS = 80000

// prompt-rules.v2.md 안의 자리표시 — 여기에 실제 JSON 골격을 끼운다
const SKELETON_MARK = '{ manifest 의 key 구조를 그대로 따르는 JSON }'
const CONSTANTS_MARK = '{{CONSTANTS}}'

// ---------------------------------------------------------------------------
// manifest v2 읽기 헬퍼
//   ⚠ 노드의 key 는 property 이름과 다를 수 있다 (perf_summary → key: "perf_areas").
//     반드시 node.key 를 우선한다.
// ---------------------------------------------------------------------------
const keyOf = (node, fallback) => node?.key || fallback

function typeNote(f) {
  const bits = []
  if (f.type) bits.push(f.type === 'number' ? '숫자' : f.type)
  if (f.enum) bits.push(`값: ${f.enum.join('/')}`)
  if (f.required) bits.push('필수')
  if (f.default !== undefined) bits.push(`기본 ${f.default}`)
  if (f.validation) bits.push(f.validation)
  return bits.length ? ` (${bits.join(', ')})` : ''
}

const itemLines = (fields, indent = '  ') =>
  fields.map((f) => {
    let line = `${indent}- ${f.label} — ${f.key}${typeNote(f)}`
    if (f.options) line += `\n${indent}    선택지: ${f.options.join(' / ')}`
    if (f.row_fields) line += `\n${indent}    각 행: ${f.row_fields.join(', ')} (행 수: ${f.max_rows})`
    if (f.type === 'element_groups') {
      const gf = f.group_fields.map((x) => `${x.label}(${x.key})`).join(', ')
      const lf = f.level_fields.map((x) => `${x.label}(${x.key})`).join(', ')
      line +=
        `\n${indent}    최대 ${f.groups}개 요소, 각 요소마다 levels 배열에 ${f.levels}단계` +
        `\n${indent}    요소: ${gf} / 각 수준: ${lf}` +
        `\n${indent}    형태: [{ "name": "...", "levels": [{ "desc": "...", "points": "..." }, …] }]`
    }
    return line
  })

/** 수집 항목 문서 — manifest v2 구조를 그대로 서술한다 */
function buildFieldDoc(m) {
  const L = [`## 수집 항목과 출력 key (manifest v${m.manifest_version})`]
  L.push(
    '최종 JSON 은 아래 key 를 그대로 쓴다. 라벨(한글)을 key 로 쓰지 않는다.',
    '값을 모르면 빈 문자열 "" 또는 빈 배열 [] 로 둔다 — 추정으로 채우지 않는다(제1원칙).',
    ''
  )

  L.push('### 기본 정보')
  L.push(...itemLines(m.basic_fields, ''))

  const mp = m.monthly_plan
  if (mp) {
    L.push(
      '',
      `### 교수·학습 계획 — key: ${keyOf(mp, 'monthly_plan')} (${mp.rows}행 고정, month 순서: ${mp.months.join(', ')})`,
      '각 행 객체: { "month": "8월", ... }'
    )
    L.push(...itemLines(mp.row_fields, ''))
  }

  const ep = m.eval_purpose
  if (ep) {
    L.push('', `### ${ep.label} — key: ${keyOf(ep, 'eval_purpose')} (문자열 ${ep.count}개 배열)`)
  }

  const ex = m.exam
  if (ex) {
    L.push('', `### 정기시험 — key: ${keyOf(ex, 'exam')} (객체)`)
    L.push(...itemLines(ex.fields, ''))
    L.push(
      `- 회차 배열 — rounds (최대 ${ex.rounds.max}개, count 만큼만 채운다)`,
      ...itemLines(ex.rounds.item_fields, '  ')
    )
  }

  const ps = m.perf_summary
  if (ps) {
    L.push(
      '',
      `### 평가 세부 운영 계획의 수행평가 열 — key: ${keyOf(ps, 'perf_areas')} (${ps.min}~${ps.max}개 배열)`
    )
    L.push(...itemLines(ps.item_fields, ''))
  }

  if (m.essay_total_ratio) {
    const f = m.essay_total_ratio
    L.push('', `### ${f.label} — key: ${keyOf(f, 'essay_total_ratio')}${typeNote(f)}`)
  }

  const al = m.achievement_levels
  if (al) {
    L.push(
      '',
      `### ${al.label} — key: ${keyOf(al, 'achievement_levels')} (객체, key 는 ${al.levels.join('/')})`
    )
  }

  const pp = m.perf_plans
  if (pp) {
    L.push(
      '',
      `### 수행평가 출제 계획 — key: ${keyOf(pp, 'perf_plans')} (배열, 최대 ${pp.max}개. 수행평가 개수만큼)`
    )
    L.push(...itemLines(pp.item_fields, ''))
  }

  const mip = m.min_achievement_plan
  if (mip) {
    L.push('', `### ${mip.label} — key: ${keyOf(mip, 'min_achievement_plan')}${typeNote(mip)}`)
  }

  return L.join('\n')
}

/**
 * 현재 양식(template.hwpx)의 물리 한도.
 * manifest.limits 에서 읽어 프롬프트에 명시한다 — 한도를 넘겨 수집해봐야
 * generate 가 거부하므로, 대화 단계에서 미리 안내하는 편이 교사에게 낫다.
 */
function buildLimitDoc(m) {
  const lim = m.limits
  if (!lim) return ''
  const areas = lim.perf_areas_max
  const plans = lim.perf_plans_max
  const cap = Math.min(areas ?? Infinity, plans ?? Infinity)

  const L = ['## 현재 양식의 한도 (반드시 지킬 것)']
  if (lim.exam_count) L.push(`- 정기시험 횟수: ${lim.exam_count.join(' / ')} 회만 가능`)
  if (Number.isFinite(cap)) {
    L.push(
      `- **수행평가는 최대 ${cap}개까지만** 이 양식에 담긴다 (세부 운영 계획 ${areas}열 / 출제 계획 ${plans}블록).`,
      `- 교사가 수행평가를 ${cap + 1}회 이상 하겠다고 하면, 계획 자체를 반대하지 말고 이렇게 안내한다:`,
      `  "현재 양식은 수행평가 ${cap}개까지 담을 수 있습니다. ${cap + 1}개 이상을 담는 확장 양식은 준비 중이니,`,
      `  지금은 ${cap}개까지만 계획서에 넣고 나머지는 양식이 준비된 뒤에 추가하시겠어요?"`,
      `  그 뒤 교사의 선택에 따라 진행하고, PLAN_READY JSON 에는 ${cap}개까지만 넣는다.`
    )
  }
  L.push(
    '- 평가 요소는 수행평가마다 최대 3개, 각 요소의 수행수준은 4단계까지 담긴다.',
    '  더 필요하다고 하면 같은 방식으로 한도를 안내하고 범위 안에서 정리한다.'
  )
  return L.join('\n')
}

/** 출력 JSON 골격 — manifest v2 에서 생성 */
function buildSkeleton(m) {
  const blank = (f) => (f.type === 'number' ? 0 : '')
  const obj = {}

  for (const f of m.basic_fields) obj[f.key] = blank(f)

  const mp = m.monthly_plan
  if (mp) {
    obj[keyOf(mp, 'monthly_plan')] = mp.months.map((month) => {
      const row = { month }
      for (const rf of mp.row_fields) row[rf.key] = ''
      return row
    })
  }

  const ep = m.eval_purpose
  if (ep) obj[keyOf(ep, 'eval_purpose')] = Array.from({ length: ep.count }, () => '')

  const ex = m.exam
  if (ex) {
    const e = {}
    for (const f of ex.fields) e[f.key] = blank(f)
    const round = {}
    for (const f of ex.rounds.item_fields) round[f.key] = ''
    e.rounds = [round]
    obj[keyOf(ex, 'exam')] = e
  }

  const ps = m.perf_summary
  if (ps) {
    const item = {}
    for (const f of ps.item_fields) item[f.key] = ''
    obj[keyOf(ps, 'perf_areas')] = [item]
  }

  if (m.essay_total_ratio) obj[keyOf(m.essay_total_ratio, 'essay_total_ratio')] = 0

  const al = m.achievement_levels
  if (al) {
    const levels = {}
    for (const lv of al.levels) levels[lv] = ''
    obj[keyOf(al, 'achievement_levels')] = levels
  }

  const pp = m.perf_plans
  if (pp) {
    const item = {}
    for (const f of pp.item_fields) {
      if (f.type === 'multi_select') item[f.key] = []
      else if (f.type === 'element_groups') {
        const level = {}
        for (const lf of f.level_fields) level[lf.key] = ''
        const group = {}
        for (const gf of f.group_fields) group[gf.key] = ''
        group.levels = Array.from({ length: f.levels }, () => ({ ...level }))
        item[f.key] = [group]
      } else if (f.type === 'table_rows') {
        const row = {}
        for (const rf of f.row_fields) row[rf] = ''
        item[f.key] = [row]
      } else item[f.key] = ''
    }
    obj[keyOf(pp, 'perf_plans')] = [item]
  }

  if (m.min_achievement_plan) obj[keyOf(m.min_achievement_plan, 'min_achievement_plan')] = ''

  return JSON.stringify(obj, null, 2)
}

/** prompt-rules.v2.md 의 머리말(설명 블록)을 떼고 본문만 남긴다 */
function rulesBody(md) {
  const i = md.indexOf('\n---\n')
  return (i === -1 ? md : md.slice(i + 5)).trim()
}

export function buildSystemPrompt(m = manifest, c = constants, md = rulesMd) {
  let body = rulesBody(md)

  // ① 학교 상수 주입
  if (body.includes(CONSTANTS_MARK)) {
    body = body.replace(CONSTANTS_MARK, JSON.stringify(c, null, 2))
  } else {
    body += `\n\n## 학교 공통 정보\n${JSON.stringify(c, null, 2)}`
  }

  // ② 출력 JSON 골격 주입
  const skeleton = buildSkeleton(m)
  body = body.includes(SKELETON_MARK)
    ? body.replace(SKELETON_MARK, skeleton)
    : `${body}\n\n===PLAN_READY===\n${skeleton}\n===END===`

  // ③ 양식 한도 + 수집 항목 문서를 "완료 절차" 바로 앞에 끼운다
  const inserted = [buildLimitDoc(m), buildFieldDoc(m)].filter(Boolean).join('\n\n')
  const at = body.indexOf('## 완료 절차')
  body =
    at === -1
      ? `${body}\n\n${inserted}`
      : `${body.slice(0, at)}${inserted}\n\n${body.slice(at)}`

  return body
}

const SYSTEM_PROMPT = buildSystemPrompt()

// 테스트용 노출 (Vercel 은 default export 만 핸들러로 쓴다)
export { buildFieldDoc, buildSkeleton, validateMessages, SYSTEM_PROMPT, manifest, constants }

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
    return {
      error:
        `대화 총 길이가 상한을 넘었습니다 (${total}/${MAX_TOTAL_CHARS}자). ` +
        '참고자료를 줄이거나 새로 시작해 주세요.',
    }
  }
  return { messages }
}

/**
 * 프롬프트 캐싱 — 시스템 프롬프트(고정)와 직전까지의 대화를 캐시 구간으로 잡는다.
 * 폼 채우기 대화는 턴이 길고 참고자료가 붙어 히스토리가 커지므로 효과가 크다.
 */
function toApiMessages(messages) {
  return messages.map((m, i) => {
    const block = { type: 'text', text: m.content }
    if (i === messages.length - 1) block.cache_control = { type: 'ephemeral' }
    return { role: m.role, content: [block] }
  })
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
        max_tokens: MAX_TOKENS,
        // 양식 수집 대화라 깊은 추론이 필요 없다. thinking 을 끄지 않으면
        // max_tokens 를 사고 토큰이 잠식해 PLAN_READY JSON 이 잘릴 수 있다.
        thinking: { type: 'disabled' },
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: toApiMessages(parsed.messages),
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

  // max_tokens 로 잘렸으면 프론트가 알아야 한다 (PLAN_READY JSON 이 깨질 수 있음)
  return res.status(200).json({
    reply,
    stop_reason: data.stop_reason,
    truncated: data.stop_reason === 'max_tokens',
    usage: data.usage,
  })
}
