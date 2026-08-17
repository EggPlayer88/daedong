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

// 시수/누계 고정표 (없으면 null — 그 경우 예전처럼 AI 가 제안한다)
let fixedHours = null
try {
  fixedHours = JSON.parse(readFileSync(join(ASSETS, 'fixed-hours-2026-2.json'), 'utf-8'))
} catch {
  fixedHours = null
}

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
 * 시수/누계는 서버가 학사일정 기반 고정표로 자동 주입한다.
 * AI 가 계산·제안하면 고정표와 다른 숫자를 교사에게 보여주게 되므로, 계산을 금지하고
 * "자동 입력된다"는 사실과 실제 값만 안내한다.
 */
function buildHoursDoc(table) {
  if (!table) return ''
  const variants = table.variants || {}
  const row = variants[table.default_variant] || {}
  const keys = Object.keys(row).sort((a, b) => Number(a) - Number(b))
  if (keys.length === 0) return ''

  const L = ['## 시수/누계 — 자동 입력 (직접 계산하지 말 것)']
  L.push(
    '- 월별 시수/누계는 **학사일정 기반 고정표로 서버가 자동 입력**한다.',
    '  네가 계산하거나 제안하지 않는다. 교사에게 필요한 것은 **주당 시수(weekly_hours)** 하나뿐이다.',
    '- 주당 시수를 받으면 그 교과의 시수가 어떻게 들어가는지 알려주고 넘어간다. 예:',
    ...keys.map((k) => {
      const r = row[k]
      return `  · 주당 ${k}시간 → ${r.months.join(', ')} (합계 ${r.total}, 최소 기준 ${r.min_required})`
    }),
    `- 지원 범위는 주당 ${keys[0]}~${keys[keys.length - 1]}시간이다. 그 밖이면 교사가 직접 값을 정해야 한다.`,
    '- 교사가 고정표와 다른 시수를 쓰고 싶다고 하면(요일 배정 특수, 분반 등):',
    '  월별 "시수/누계" 값을 직접 받아 monthly_plan[].hours_cum 에 넣고,',
    '  최종 JSON 에 **"hours_manual": true** 를 함께 넣는다. 그러면 서버가 교사 값을 그대로 쓴다.',
    '- hours_manual 이 없으면 monthly_plan[].hours_cum 에 무엇을 넣어도 고정표 값으로 덮어쓰인다.',
    '  그래도 빈 문자열로 두지 말고 고정표 값을 그대로 적어 교사가 확인 화면에서 보게 한다.',
    '- 단원명·성취기준·평가 요소는 이 규칙과 무관하다 — 평소대로 교사·참고자료에서 받는다.'
  )
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
      `- 교사가 수행평가를 ${cap + 1}회 이상 하겠다고 하면, 계획 자체를 반대하지 않는다.`,
      `  "현재 양식은 수행평가 ${cap}개까지 담깁니다. ${cap + 1}번째부터는 공란으로 남고`,
      `  한글에서 직접 편집해 추가하셔야 합니다. 그대로 진행할까요?" 라고 알리고 교사의 선택을 따른다.`,
      `  (${cap + 1}개 이상을 담는 확장 양식은 준비 중임을 함께 알려도 좋다.)`
    )
  }
  L.push(
    '- 평가 요소는 수행평가마다 최대 3개, 각 요소의 수행수준은 4단계까지 담긴다.',
    '  더 필요하다고 하면 같은 방식으로 한도를 안내하고 범위 안에서 정리한다.',
    '',
    '### 한도를 넘는 계획을 교사가 그대로 원할 때 (제0원칙)',
    '- 계획을 축소시키지 않는다. 문서는 만들되, 다음을 분명히 알린다:',
    `  "${cap}개까지는 문서에 들어가고, 나머지는 공란으로 남습니다. 빠진 내용은 한글에서 직접 편집해 추가하셔야 합니다."`,
    '- PLAN_READY JSON 에는 교사가 확정한 항목을 **전부** 넣는다. 잘라내는 일은 서버가 하고,',
    '  무엇이 빠졌는지도 서버가 다시 알려준다. 네가 임의로 버리지 않는다.'
  )
  return L.join('\n')
}

/**
 * 배점 정합성 규칙 — 서버 검증기(check_scales)와 같은 내용이어야 한다.
 * 대화 단계에서 맞춰두지 않으면 생성 버튼에서 막힌다.
 */
function buildScaleDoc() {
  return [
    '## 배점 정합성 (생성 전 반드시 맞출 것)',
    '- **정기시험은 각 회차가 100점 만점**이다: 선택형 만점 + 서·논술형 만점 = 100.',
    '  (예: 선택형 70 + 서·논술형 30). 회차가 2회면 두 회차 모두 각각 100점이다.',
    '- **수행평가는 영역 만점의 합이 100점**이다: 영역이 2개면 예를 들어 60 + 40.',
    '- 가중치는 점수가 아니라 **반영비율(%)로만** 준다. 정기시험 반영비율 + 수행평가 반영비율 = 100%.',
    '- 만점 표기는 "N점(M%)" 형식이며 **M 은 서버가 계산한다**(M = N × 해당 반영비율 ÷ 100).',
    '  너는 N(점수)만 정확히 주면 된다. 괄호 안 %를 직접 계산해 넣지 않아도 된다.',
    '- 서·논술형 반영비율은 회차별·수행 영역별로 **반드시 수집**하고, 전체 합계를',
    '  essay_total_ratio 에 넣는다. 합계가 30% 미만이면 예외 교과인지 확인하고 조정을 권한다.',
    '- 이 규칙에 어긋나면 생성 단계에서 "어느 합이 몇 점인지" 와 함께 거부된다.',
    '  요약 단계에서 미리 합을 계산해 보여주고 교사에게 확인받는다.',
  ].join('\n')
}

/** 출력 JSON 골격 — manifest v2 에서 생성 */
function buildSkeleton(m, table = fixedHours) {
  const blank = (f) => (f.type === 'number' ? 0 : '')
  const obj = {}

  for (const f of m.basic_fields) obj[f.key] = blank(f)

  // 시수 고정표를 쓸 때만 존재하는 제어 플래그 (교사가 직접 시수를 정한 경우 true)
  if (table) obj.hours_manual = false

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

/**
 * 고정표가 있으면 상수의 hours_calculation_rule 을 대체한다.
 * 그 규칙은 "공식으로 근사값을 제안하라"고 지시하고 고정표와 다른 예시(9/9, 16/25…)를
 * 담고 있어, 그대로 주입하면 AI 가 상충하는 두 지시를 받는다.
 */
function reconcileConstants(c, table) {
  if (!table || !c?.hours_calculation_rule) return c
  const out = { ...c }
  out.hours_calculation_rule = {
    _replaced: '시수/누계는 학사일정 기반 고정표로 서버가 자동 입력한다 — 아래 "시수/누계" 절 참조.',
    _note: 'AI 는 시수를 계산하지 않는다. 교사에게서 주당 시수만 받는다.',
    source: table.generated ? `fixed-hours (${table.generated})` : 'fixed-hours',
    algorithm: table.algorithm,
  }
  return out
}

export function buildSystemPrompt(m = manifest, c = constants, md = rulesMd, table = fixedHours) {
  let body = rulesBody(md)

  // ① 학교 상수 주입 (고정표와 상충하는 시수 규칙은 대체)
  const consts = reconcileConstants(c, table)
  if (body.includes(CONSTANTS_MARK)) {
    body = body.replace(CONSTANTS_MARK, JSON.stringify(consts, null, 2))
  } else {
    body += `\n\n## 학교 공통 정보\n${JSON.stringify(consts, null, 2)}`
  }

  // ② 출력 JSON 골격 주입
  const skeleton = buildSkeleton(m, table)
  body = body.includes(SKELETON_MARK)
    ? body.replace(SKELETON_MARK, skeleton)
    : `${body}\n\n===PLAN_READY===\n${skeleton}\n===END===`

  // ③ 시수 자동입력 + 양식 한도 + 수집 항목 문서를 "완료 절차" 바로 앞에 끼운다
  const inserted = [buildScaleDoc(), buildHoursDoc(table), buildLimitDoc(m), buildFieldDoc(m)]
    .filter(Boolean)
    .join('\n\n')
  const at = body.indexOf('## 완료 절차')
  body =
    at === -1
      ? `${body}\n\n${inserted}`
      : `${body.slice(0, at)}${inserted}\n\n${body.slice(at)}`

  return body
}

const SYSTEM_PROMPT = buildSystemPrompt()

// 테스트용 노출 (Vercel 은 default export 만 핸들러로 쓴다)
export {
  buildFieldDoc,
  buildSkeleton,
  buildHoursDoc,
  buildLimitDoc,
  buildScaleDoc,
  reconcileConstants,
  validateMessages,
  SYSTEM_PROMPT,
  manifest,
  constants,
  fixedHours,
}

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

/**
 * 승인 확인 (D20) — RLS 와 별개의 API 비용 방어선.
 *
 * RLS 는 DB 접근만 막는다. 이 함수들은 Claude API 를 호출하므로,
 * 미승인 계정이 토큰만 들고 들어와도 비용이 발생하지 않도록 여기서 한 번 더 막는다.
 * users_select 정책은 "본인 행" 을 예외로 허용하므로 사용자 토큰으로 조회 가능하다.
 *
 * @returns true(승인) | false(대기) — 행이 없으면 대기로 본다(안전한 쪽)
 */
async function isApproved(authorization, userId) {
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const r = await fetch(
    `${url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=is_active`,
    { headers: { apikey: anonKey, Authorization: authorization } }
  )
  if (!r.ok) return false
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 && rows[0].is_active === true
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

  // D20 — 승인 전에는 Claude API 를 태우지 않는다 (RLS 와 별개의 비용 방어선)
  if (!(await isApproved(req.headers.authorization, user.id))) {
    return res.status(403).json({
      error: 'PENDING_APPROVAL',
      message: '승인 대기중입니다. 관리자 승인 후 이용할 수 있습니다.',
    })
  }

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
