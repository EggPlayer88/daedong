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

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

// 학업성적관리규정 룰셋 (없으면 규정 안내를 생략한다)
let regulation = null
try {
  regulation = JSON.parse(readFileSync(join(ASSETS, 'regulation-2026.json'), 'utf-8'))
} catch {
  regulation = null
}

// 시수/누계 고정표 (없으면 null — 그 경우 예전처럼 AI 가 제안한다)
let fixedHours = null
try {
  fixedHours = JSON.parse(readFileSync(join(ASSETS, 'fixed-hours-2026-2.json'), 'utf-8'))
} catch {
  fixedHours = null
}

// ---------------------------------------------------------------------------
// prefill — 작년(2025-2) 데이터 팩. 교과·학년이 정해지면 그 한 건만 주입한다.
//   전부 주입하면 프롬프트가 수백 KB 가 되고, 다른 교과 내용이 초안에 섞인다.
// ---------------------------------------------------------------------------
const PREFILL_DIR = join(ASSETS, 'prefill')

/** subject|grade → 파일 경로. 파일명이 아니라 **파일 안의 subject/grade** 를 믿는다. */
function buildPrefillIndex(dir = PREFILL_DIR) {
  const index = new Map()
  if (!existsSync(dir)) return index
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let d
    try {
      d = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
    } catch {
      continue // 깨진 파일 하나가 전체 주입을 막지 않게 한다
    }
    const subject = String(d?.subject || '').trim()
    const grade = Number.parseInt(d?.grade, 10)
    if (!subject || !Number.isInteger(grade)) continue
    const key = `${subject}|${grade}`
    const prev = index.get(key)
    // ⚠ 같은 교과·학년 파일이 둘 이상일 수 있다 ('진로와 직업' 띄어쓰기 변형 실측).
    //   필드가 더 많은 쪽(정보가 더 담긴 쪽)을 쓰고, 같으면 파일명 순서로 정한다.
    if (!prev || Object.keys(d).length > Object.keys(prev.data).length) {
      index.set(key, { file: f, data: d })
    }
  }
  return index
}

const prefillIndex = buildPrefillIndex()

// 성취기준·성취수준 DB (14개 교과). ✗ 미매칭을 메울 때 **이 안에서만** 고르게 한다.
let standardsDb = null
try {
  standardsDb = JSON.parse(readFileSync(join(ASSETS, 'standards-db.json'), 'utf-8'))
} catch {
  standardsDb = null
}

/** 교과명 → DB 키 ('진로와 직업' ↔ '진로와_직업' 처럼 표기가 갈린다) */
function dbSubject(subject, db = standardsDb) {
  const subjects = db?.subjects
  if (!subjects || !subject) return null
  const norm = (x) => String(x).replace(/[\s_·]/g, '')
  const want = norm(subject)
  const key = Object.keys(subjects).find((k) => norm(k) === want)
  return key ? { key, ...subjects[key] } : null
}

/** 대화에서 교과·학년을 찾아 해당 prefill 을 고른다. 없으면 null (백지 모드) */
function pickPrefill(messages, index = prefillIndex) {
  if (index.size === 0) return null
  const subjects = [...new Set([...index.keys()].map((k) => k.split('|')[0]))]
    .sort((a, b) => b.length - a.length) // 긴 이름 먼저 ('기술가정' 이 '기술' 에 먹히지 않게)
  let subject = ''
  let grade = null
  for (const m of messages || []) {
    const text = typeof m?.content === 'string' ? m.content : ''
    // 참고자료 전문(작년 문서)은 교과명 추측에서 제외 — 다른 교과명이 섞여 있다
    if (!text || m.role !== 'user' || text.startsWith('[참고자료: ')) continue
    if (!subject) subject = subjects.find((x) => text.includes(x)) || ''
    if (grade === null) {
      const g = /([1-3])\s*학년/.exec(text)
      if (g) grade = Number(g[1])
    }
    if (subject && grade !== null) break
  }
  if (!subject || grade === null) return null
  return index.get(`${subject}|${grade}`) || null
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

/**
 * 특정 칸을 "어떻게 물어볼지" — manifest.collection_guides.
 * 문구를 프롬프트에 적어 두면 확인 카드와 갈라진다. 자산 한 곳에서 읽는다.
 */
function buildGuideDoc(m = manifest) {
  // FINAL 의 collection_guides 는 사람이 읽는 산문이라, 기계가 읽게 펼친 쪽을 쓴다
  const g = m?.collection_guides_fields
  if (!g) return ''
  const L = ['## 이 두 칸은 물어보는 방식이 정해져 있다']

  const ma = g.min_achievement_plan
  if (ma) {
    L.push(
      '',
      '### 최소 성취수준 미도달 학생 지도 방안',
      `- 학교 관행 문구가 있다: **"${ma.suggest_first}"**`,
      '- **먼저 제안하고 확인받는다.** 백지에서 물어보면 교사가 매번 새로 지어내야 한다.',
      `  "${ma.ask}"`,
      `- ${ma.rule}`
    )
  }

  const ab = g['perf_plans.absentee_points']
  if (ab) {
    L.push(
      '',
      '### 수행평가 미응시자 (결시) 칸',
      `- ⚠ 이 칸에 들어가는 것은 **점수**다. ${ab.meaning}`,
      '  기준 문장("추후 평가 기회 부여" 같은 것)이 아니라 숫자를 받는다.',
      `  확인 카드에도 "${ab.card_label}" 로 표시된다.`,
      `- 이렇게 묻는다: "${ab.ask}"`,
      `- 형식: **${ab.format}**`,
      `- ${ab.rule}`
    )
  }
  return L.join('\n')
}

/**
 * prefill 주입 블록 — "작년 문서 기준으로 달라진 것만 묻는" 모드로 바꾼다.
 *
 * 이 프로젝트의 핵심 통찰(마스터플랜): 이것은 생성이 아니라 **변환** 문제다.
 * 같은 교사가 같은 교과서로 가르치므로 진도·관행은 작년 문서에 이미 검증돼 있다.
 * 그래서 백지에서 묻지 않고, 작년 것을 보여주고 **다른 것만** 받는다.
 *
 * ⚠ 작년 값을 그대로 쓰면 안 되는 것이 셋 있다 (아래 규칙에 명시):
 *   시험 시기·시수(올해 학사일정) / 2학년 성취기준(교육과정이 바뀌었다) / 배점 3분류
 */
const numOf = (v) => {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? ''))
  return m ? Number(m[0]) : 0
}

function buildPrefillDoc(pre, m = manifest, c = constants) {
  const d = pre?.data
  if (!d) return ''
  const L = [
    `## 작년 자료 (${d.source || '2025-2'}) — ${d.subject} ${d.grade}학년`,
    '',
    '**이 대화는 백지에서 시작하지 않는다.** 아래는 작년에 이 교과가 실제로 낸 계획서다.',
    '',
    '### 첫 응답에서 할 일 (순서 고정)',
    '1. 아래 작년 구성을 **요약해서 보여준다** (표 말고 3~5줄).',
    '2. **"작년과 같나요? 달라진 것만 알려주세요."** 라고 묻는다.',
    '3. 교사가 "같다" 고 하면 **더 묻지 않고** 작년 값으로 채운 뒤 확인 카드로 넘어간다.',
    '   달라진 것만 말하면 그 부분만 다시 묻는다. 처음부터 다시 훑지 않는다.',
    '',
  ]

  // ── 작년 구성 요약 (기계가 읽을 수 있게 원문 그대로) ──────────────────────
  const ex = d.exam || {}
  L.push('### 작년 구성')
  L.push(`- 정기시험 ${ex.count ?? '?'}회 / 반영비율 ${ex.ratio || '?'} · 수행 ${d.perf_ratio || '?'}`)
  for (const [i, r] of (ex.rounds || []).entries()) {
    const comp = (r.composition_2class || []).join(' + ')
    L.push(`  · ${i + 1}회차 배점(작년 2분류): ${comp || '(없음)'} / 서·논술 ${r.essay_ratio || '?'}`)
  }
  L.push(`- 수행평가 ${(d.perf_areas || []).length}개:`)
  for (const a of d.perf_areas || []) {
    L.push(`  · ${a.name} — ${a.points_normalized || a.points_last_year || ''} (${a.period || '시기 미상'})`)
  }
  L.push(`- 서·논술형 합계(작년): ${d.perf_essay_ratio || '?'} (수행) / 회차별은 위 참조`)
  L.push(`- 최소 성취수준 미도달 지도 방안: ${d.min_achievement_plan || '(없음)'}`)
  L.push('')

  L.push('### 작년 교수·학습 계획 (월별)')
  for (const r of d.monthly_plan || []) {
    L.push(`- ${r.month}: ${r.units || ''}`)
    if (r.standards) L.push(`    성취기준: ${r.standards}`)
    if (r.eval_elements) L.push(`    평가 요소: ${r.eval_elements}`)
  }
  L.push('')

  L.push('### 작년 평가 목적')
  for (const [i, t] of (d.eval_purpose || []).entries()) L.push(`${i + 1}. ${t}`)
  L.push('')

  // ── 그대로 쓰면 안 되는 것 ────────────────────────────────────────────────
  L.push('### ⚠ 작년 값을 그대로 쓰면 안 되는 것')
  L.push(
    `- **시험 시기**: 작년 값(${(ex.rounds || []).map((r) => r.period_last_year).filter(Boolean).join(', ') || '없음'})은 버린다.`,
    '  올해 시기는 위 "학교 공통 정보" 의 exam_schedule 을 쓴다.',
    '- **시수/누계**: 작년 값은 쓰지 않는다. 서버가 올해 학사일정 고정표로 자동 입력한다.',
    '- **정기시험 배점**: 작년은 2분류(선택형+서·논술형)다. 올해는 3분류라',
    '  선택형을 선택형/단답형·완성형으로 **나눠 받아야 한다** — 네가 임의로 나누지 않는다.'
  )

  // ── 서·논술형 합계 — 작년 실적(essay_detail)을 그대로 제시한다 ────────────
  //    ⚠ 회차·영역 칸이 여러 개다. 첫 칸만 보면 실제보다 낮게 나와 멀쩡한 계획이
  //      규정 위반으로 보인다 (파서 v1 이 그랬다). computed_sum 이 작년 실제 합이다.
  const need = regulation?.thresholds?.essay_total_min
  const ed = d.essay_detail
  if (ed && (ex.count ?? 0) > 0) {
    const sum = numOf(ed.computed_sum)
    const cells = [...(ed.exam_cells || []), ...(ed.perf_cells || [])]
    const hasPct = [...cells, ed.total_cell_last_year || ''].some((x) => String(x).includes('%'))
    L.push(
      '',
      `### 서·논술형 (작년 합계 ${sum}%)`,
      `- 지필 칸: ${(ed.exam_cells || []).join(' · ') || '(없음)'}`,
      `- 수행 칸: ${(ed.perf_cells || []).join(' · ') || '(없음)'}`,
      `- 작년 문서의 합계 칸: ${ed.total_cell_last_year || '(없음)'} · 계산 합: ${sum}%`,
      `- 분모는 학기말 총 배점(지필 환산 + 수행 환산)이다. 규정 기준은 ${need}% 이상.`
    )
    if (!hasPct && sum > 0) {
      // 기술가정 2학년 실측 — 원본 칸에 % 표기가 빠져 있어 단위가 불확실하다
      L.push(
        `- ⚠ **작년 값 확인 필요**: 원본 칸에 % 표기가 없다(${cells.join(', ')}).`,
        `  숫자의 단위가 불확실하므로 ${sum}% 가 맞는지 교사에게 확인받고 넘어간다.`,
        '  확인 전까지 이 값을 확정처럼 제시하지 않는다.'
      )
    } else if (need && sum < need) {
      L.push(
        `- ⚠ 작년 합계가 규정(${need}%)에 못 미친다. 요약할 때 **미리** 알리고 조정안을 제시한다.`,
        '  네가 임의로 숫자를 올려 채우지 않는다.'
      )
    }
  }

  // ── 성취기준: 교육과정이 바뀐 학년만 ──────────────────────────────────────
  const curriculum = (c?.curriculum_by_grade || {})[String(d.grade)] || ''
  const st = d.standards_2022
  const changed = d.curriculum_note && !String(d.curriculum_note).includes('유지')
  if (st || changed || /2022/.test(curriculum)) {
    L.push(
      '',
      `### ⚠ 성취기준 — 교육과정이 바뀌었다 (${d.curriculum_note || curriculum})`,
      '- 위 월별 성취기준은 **2015 개정 원문**이다. **코드를 그대로 복사하지 않는다.**'
    )
  }

  const months = st?.by_month || []
  const originals = months.flatMap((mo) => (mo.originals || []).map((o) => ({ ...o, month: mo.month })))
  if (originals.length) {
    L.push(
      '- 아래는 2022 재선정 결과다. **표식대로** 처리한다:',
      '  · **●** — 확정본이다. 그대로 제시하고 넘어간다.',
      '  · **▲** — 후보다. 후보를 함께 보여주고 교사에게 확인받는다.',
      '  · **✗** — 매칭 실패다. 아래 교과 DB **안에서만** 의미가 맞는 것을 제안하고',
      '    교사 확인을 받는다. DB 밖의 코드를 지어내지 않는다 (제1원칙).',
      '- 어느 경우든 확정 문구는 "⚠ 원문 대조 확인 필요" 를 달아 요약에 넣는다.',
      ''
    )
    for (const o of originals) {
      L.push(`  ${o.verdict || '?'} [${o.month}] ${o.original_2015 || ''}`)
      if (o.selected?.code) L.push(`      → [${o.selected.code}] ${o.selected.text || ''}`)
      for (const cand of o.candidates || []) {
        if (o.selected && cand.code === o.selected.code) continue
        L.push(`      후보 [${cand.code}] ${cand.text || ''}${cand.score != null ? ` (유사도 ${cand.score})` : ''}`)
      }
    }
  } else if (st) {
    L.push(`- 재선정 상태: ${st.status || '미상'} — 결과 항목이 없다. 코드는 교사에게 받는다.`)
  }

  // ── 교과 성취기준 DB — ✗ 를 메울 재료. **이 밖에서 고르지 않는다** ────────
  //    전 교과를 넣으면 500KB 다. 해당 교과만, 그것도 코드+본문만 넣는다.
  //    수준별 진술(levels)은 재선정에 등장한 코드에 한해 붙인다.
  const db = st ? dbSubject(d.subject) : null
  if (db) {
    const items = db.items || []
    const used = new Set(
      originals.flatMap((o) => [o.selected?.code, ...(o.candidates || []).map((x) => x.code)]).filter(Boolean)
    )
    L.push(
      '',
      `### ${d.subject} 성취기준 DB (${db.curriculum || ''}, ${items.length}개) — 선택 범위`,
      '- ✗ 를 메우거나 성취수준 진술을 만들 때 **이 목록 안에서만** 고른다.',
      '- 여기 없는 코드를 쓰면 존재하지 않는 성취기준이 공문서에 들어간다.',
      ''
    )
    for (const it of items) L.push(`  [${it.code}] ${it.text}`)

    const withLevels = items.filter((it) => used.has(it.code) && it.levels)
    if (withLevels.length) {
      L.push(
        '',
        `#### 위 재선정에 등장한 코드의 수준별 진술 (학기 단위 성취수준 초안 재료)`,
        '- 그대로 베끼지 말고 **학기 전체**를 아우르는 문장으로 다듬는다. 검토 필요를 함께 알린다.'
      )
      for (const it of withLevels) {
        L.push(`  [${it.code}]`)
        for (const [lv, text] of Object.entries(it.levels)) L.push(`    ${lv}: ${text}`)
      }
    }
  }

  // ── 파서가 자신 없다고 표시한 부분 ────────────────────────────────────────
  const warns = d._warnings || []
  if (warns.length) {
    L.push(
      '',
      '### ⚠ 작년 자료 분리 미완 — 이 부분은 반드시 교사에게 확인',
      ...warns.map((w) => `- ${w}`),
      '- "작년 자료에서 이 부분이 깔끔하게 분리되지 않았습니다" 라고 밝히고 물어본다.',
      '  분리가 안 된 값을 확정처럼 제시하지 않는다.'
    )
  }
  const info = d._info || []
  if (info.length) L.push('', '### 참고 (파서 메모)', ...info.map((x) => `- ${x}`))
  const mr = d._match_report || []
  if (mr.length) {
    L.push(
      '',
      '### 작년 원본에서 보정한 값 (그대로 계승하지 않은 것)',
      ...mr.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`),
      '- 교사가 물으면 "작년 원본과 다른 이유" 를 위 내용대로 설명한다.'
    )
  }

  // ── 수행평가 3분기 ────────────────────────────────────────────────────────
  const plans = d.perf_plans || []
  if (plans.length) {
    L.push(
      '',
      '### 수행평가 출제 계획 — 항목마다 [유지 / 변경 / 신규] 를 묻는다',
      '작년 출제 계획 전문이 아래 raw 에 있다 (셀 좌표 + 원문). 수행평가마다 이렇게 묻는다:',
      '  "작년 \'○○\' 는 그대로 갈까요, 바꿀까요, 새로 만들까요?"',
      '',
      '- **유지** — raw 에서 수행 과제 / 성취기준 / 평가기준 상·중·하 / 평가방법 체크 /',
      '  평가 요소별 수행수준·배점을 **그대로 뽑아** PLAN_READY 구조에 넣는다.',
      '  raw 의 "☑" 는 선택된 평가방법이다. 배점 숫자는 원문 그대로 옮긴다.',
      '  ⚠ 요약하거나 다듬지 않는다. 작년에 결재된 문장이므로 손대면 오히려 위험하다.',
      '- **변경** — 유지와 같은 방식으로 뽑되, 교사가 말한 부분만 고친다.',
      '- **신규** — 작년 것을 버리고 평소대로 대화로 만든다.',
      '',
      `- 작년 미응시자 점수: ${plans.map((x) => `${x.name}=${x.absent_points || '미상'}`).join(', ')}`,
      ''
    )
    for (const pl of plans) {
      L.push(`#### raw — ${pl.name}`)
      for (const line of pl.raw || []) L.push(`  ${line}`)
      L.push('')
    }
  }

  const al = d.achievement_levels || {}
  if (al._note) {
    L.push(
      '### 학기 단위 성취수준',
      `- 작년 자료 메모: ${al._note}`,
      '- 초안을 제안하되 **검토가 필요하다는 점을 반드시 알린다.**'
    )
  }
  return L.join('\n')
}

/** 수집 항목 문서 — manifest 구조를 그대로 서술한다 */
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
      `### ${al.label} — key: ${keyOf(al, 'achievement_levels')} (객체, key 는 ${al.levels.join('/')})`,
      '  ⚠ 단계 수는 양식 유형이 정한다 — 위 "양식 유형" 절을 따른다.'
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
 * 양식 유형(variant)별 대화 분기.
 * 서버가 교과·학년으로 유형을 정하므로 너는 고르지 않는다 — 다만 **1학년 2학기(자유학기)는
 * 물어볼 것 자체가 다르므로** 대화 초반에 분기해야 한다.
 */
function buildVariantDoc(m) {
  const v = m?.variant_routing
  if (!v) return ''
  const items = v.items || {}
  const fam = m.variants || {}
  const artsList = fam.arts?.subjects || []
  const arts = artsList.join(' · ')

  const L = ['## 양식 유형 (서버가 자동 결정 — 너는 대화만 맞춘다)']
  L.push(
    '교과와 학년이 정해지면 어떤 양식으로 나갈지는 서버가 정한다:',
    ...(v._resolution_order || []).map((r) => `  · ${r}`),
    '- 아직 만들어지지 않은 유형이면 생성 단계에서 "○○ 양식이 아직 준비되지 않았습니다" 안내가 나간다.',
    '  그 경우에도 대화는 끝까지 진행해 내용을 확정해 둔다 — 양식이 준비되면 바로 생성할 수 있다.',
    ''
  )

  if (items.grade1_free) {
    L.push(
      '### 1학년 2학기 = 자유학기 — 물어볼 것이 다르다',
      '실측: 작년 1학년 문서에는 **3절(반영비율) 자체가 없다.** "평정" 0회 / "이수" 48회.',
      '즉 점수로 매기지 않는다. 따라서 이 경우에만 대화를 이렇게 바꾼다:',
      '',
      '**묻지 않는다** (이 항목들은 자유학기 계획서에 없다):',
      '- 정기시험 횟수·시기·배점',
      '- 반영비율 (지필 : 수행)',
      '- 서·논술형 반영비율, 30% 규정',
      '- 수행평가 영역별 만점·반영비율',
      '',
      '**대신 묻는다**:',
      '- 수행평가(점수화하지 않는 평가) — 무엇을 어떻게 보는지, 시기',
      '- 성취수준 진술 — 점수가 아니라 도달 정도를 서술로',
      '- 이수 여부 판단 기준과 피드백 방법',
      '',
      '- 교사가 "반영비율은요?" 라고 먼저 물으면, 자유학기라 점수화하지 않는다는 점을 설명한다.',
      '- ⚠ **이 유형의 상세 수집 항목은 아직 확정 대기 중이다.** 확정 전까지는 위 범위에서',
      '  교사에게 필요한 것을 묻고, 확정되지 않은 항목을 지어내지 않는다 (제1원칙).',
      '  교사에게도 "자유학기 양식은 준비 중이라 지금은 내용 정리까지만 됩니다" 라고 미리 알린다.',
      ''
    )
  }

  if (items.arts && arts) {
    const lv = fam.arts?.achievement_levels || []
    const base = fam[items.default?.uses]?.achievement_levels || []
    L.push(
      `### ${arts} — 예체능형 (성취수준 ${lv.length}단계)`,
      '- 정기시험 없이 수행 100% 가 실측 관행이다. 지필 관련 질문은 생략하고 확인만 받는다.',
      `- **성취수준은 ${lv.join('·')} ${lv.length}단계만 받는다.** 예체능판 양식에는`,
      `  ${base.filter((x) => !lv.includes(x)).join('·')} 칸 자체가 없다.`,
      `  ${base.filter((x) => !lv.includes(x)).join('·')} 진술을 묻지 말고, achievement_levels 에도 넣지 않는다.`,
      '  (실수로 넣어도 서버가 버리지만, 교사에게 쓸데없는 질문을 하는 셈이 된다)',
      `- ⚠ **보건·정보는 여기 해당하지 않는다.** 수행 100% 인 점은 같아도 성취도는`,
      `  ${base.length}단계라 기본 양식을 쓴다. 교과명을 정확히 확인하고 넘어간다.`,
      ''
    )
  }
  return L.join('\n').trimEnd()
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
      `  ⚠ "확장 양식이 준비 중" 이라고 말하지 않는다. 지금 양식이 학교 공용 마스터이고,`,
      `     ${cap}개를 넘기는 확장 계획은 없다 — 없는 예정을 만들지 않는다.`
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
/**
 * 학업성적관리규정 한계선 — 대화 중에 미리 맞추게 한다.
 * 판정은 서버 검증기(V01~V18)가 하지만, 생성 단계에서 막히기 전에 대화에서 잡는 편이 낫다.
 */
function buildRegulationDoc(reg = regulation) {
  if (!reg) return ''
  const th = reg.thresholds || {}
  const el = reg.eligibility || {}
  const types = reg.plan_types || {}

  const L = ['## 학업성적관리규정 한계선 (근거: 학교 학업성적관리규정)']
  L.push(
    '- 규정은 **상한·하한만** 정한다. 구체 수치를 정할 권한은 교과협의회에 있다.',
    '  수치를 제안할 때는 반드시 이렇게 밝힌다: **"규정 적합 범위 내 예시이며, 확정 권한은 교과협의회에 있습니다."**',
    ''
  )

  L.push('### 평가 유형 — 교사가 고른다 (강제하지 않는다)')
  for (const [k, t] of Object.entries(types)) {
    if (k.startsWith('_')) continue
    const bits = [`정기시험 ${t.exam_count}회`]
    if (t.written_max) bits.push(`지필 ≤${t.written_max}%`)
    if (t.perf_min) bits.push(`수행 ≥${t.perf_min}%`)
    L.push(`- **${k}. ${t.label}** — ${bits.join(' / ')}`)
  }
  L.push(
    '- 유형 B·C 는 **"할 수 있다"** 는 임의규정이다. 자격이 있어도 A 형을 택할 수 있으므로',
    '  **유형을 단정해 밀어붙이지 않는다.** 교과·학년으로 가능한 유형을 제시하고 교사가 고르게 한다.',
    `- 지필 1회(B) 가능: ${(el.type_b_subjects || []).slice(0, 3).join(' · ')} 또는 3학년 2학기 편성 교과`,
    `- 수행 100%(C) 가능: ${(el.type_c_subjects || []).join(' · ')}, 주당 1시수 과목`,
    ''
  )

  L.push('### 반드시 지켜야 하는 수치')
  L.push(
    `- 수행평가 반영 합계 **≥ ${th.perf_total_min}%**`,
    `- 수행평가 **한 영역 ≤ ${th.perf_area_max}%** (음악·미술·체육·주당1시수는 완화 단서 대상)`,
    `  → **수행 100% 로 하면 영역당 ${th.perf_area_max}% 상한 때문에 최소 ${Math.ceil(100 / th.perf_area_max)}개 영역이 필요하다.**`,
    `     (${th.perf_area_max} + ${th.perf_area_max} = ${th.perf_area_max * 2} < 100 이므로 2개로는 불가능하다.)`,
    `     교사가 수행 100% 를 택하면 이 산수를 먼저 알려주고 영역 수를 함께 정한다.`,
    `- 서·논술형 **≥ ${th.essay_total_min}%** — ⚠ 분모는 **학기말 총 배점(지필 환산 + 수행 환산)** 이다.`,
    `     정기시험 안에서 30% 가 아니다. 예: 정기 60%(회차 30%씩)에서 서논술 30점이면 기여는 9+9=18% 뿐이다.`,
    `- 정기시험은 **매 회차 서·논술형을 포함**한다.`,
    `- 정기시험 1회면 반영비율 **≤ ${th.written_max_when_single_round}%**`,
    `- 지필은 특별한 사유가 없으면 **${th.written_full_marks}점 만점**`,
    ''
  )

  L.push('### 대화 중에 부드럽게 짚을 것')
  L.push(
    '- **영역명이 추상적일 때** ("수행1", "탐구2") — 무엇을 평가하는지 드러나는 이름을 함께 제안한다.',
    '  ("\'수행1\' 보다 \'실험 설계 보고서\' 처럼 적으시면 학생 안내와 기록에 좋습니다. 어떻게 할까요?")',
    '- **결시자·학적변동자 처리 기준이 비었을 때** — 평가계획서 필수 기재 항목임을 알리고 한 줄 초안을 제안한다.',
    '- 지적이 아니라 제안으로 말한다. 교사가 그대로 두겠다고 하면 그대로 진행한다.',
    ''
  )
  L.push(
    '- 위 한계선을 어기면 생성 단계에서 **근거 조문과 함께 거부**된다. 요약 단계에서 미리 확인시킨다.',
    '- ⚠ 횟수 선택(정기시험 1회 / 수행 100%)은 **교과 교사의 재량**이다.',
    '  심의·결재 절차를 되묻지 않는다. 교사가 이미 아는 일이고, 최종 검토는 관리자 단계에서 한다.',
    '- 규정 안내는 **한 줄**로 한다. 조문 번호를 늘어놓지 않는다 — 필요한 조문은 서버가 붙인다.'
  )
  return L.join('\n')
}

/**
 * 학년·교과군별 실측 기본값 — **제시하고 확인받는** 흐름으로 쓴다.
 * 관행이지 규칙이 아니므로 단정하면 제1원칙을 어기게 된다.
 */
function buildDefaultsDoc(c = constants) {
  const d = c?.grade_defaults
  if (!d) return ''

  const L = ['## 학년·교과군별 기본값 (제시 → 확인. 단정 금지)']
  L.push(
    '교과와 학년을 받으면 아래 관행을 **먼저 제시하고 맞는지 확인받은 뒤** 진행한다.',
    '"보통 이렇게 하시는데, 선생님도 이렇게 할까요?" 형태로 묻고, 다르면 교사 답을 따른다.',
    ''
  )

  const g3 = d.grade3
  if (g3) {
    const r = g3.ratio || {}
    const w = g3.written_composition || {}
    L.push(
      `### ${g3.applies_to || '3학년'}`,
      `- 정기시험 ${g3.exams}회, 지필 ${r.written}% : 수행 ${r.performance}%`,
      `- 지필 구성은 선택형 ${w.mc} + 서·논술형 ${w.essay} 이 다수`,
      ...(g3.exceptions || []).map(
        (e) =>
          `- 예외 실측: ${e.subject} 는 선택형 ${e.written_composition.mc} + 서·논술형 ${e.written_composition.essay}` +
          ` → 교과마다 다를 수 있으니 반드시 확인한다`
      )
    )
  }

  const ah = d.arts_health
  if (ah) {
    const r = ah.ratio || {}
    L.push(
      '',
      `### ${(ah.applies_to || []).join(' · ')}`,
      `- 정기시험 ${ah.exams}회, 수행 ${r.performance}%`,
      `- 수행평가 ${ah.perf_count}개를 ${(ah.perf_ratio_pattern || []).join('/')} 로 나누는 패턴이 다수`,
      '- ⚠ 현재 양식은 수행 2개까지 담긴다. 3개로 하시겠다면 세 번째는 공란으로 남고',
      '  한글에서 직접 편집해야 한다는 점을 미리 알린다 (제0원칙).'
    )
  }

  const g1 = d.grade1_semester2
  if (g1) {
    L.push(
      '',
      `### ${g1.applies_to || '1학년 2학기'} — 자유학기`,
      '- 점수화하지 않는다. **반영비율·지필·서·논술형을 묻지 않는다.** (아래 자유학기 절 참조)'
    )
  }

  L.push(
    '',
    '- 위 값은 전부 **작년 실측에서 나온 관행**이다. 규정이 아니므로 교사가 다르게 하겠다면 그대로 따른다.',
    '- 기본값을 제시할 때 근거를 함께 밝힌다 ("작년 3학년 계획서 기준입니다").'
  )
  return L.join('\n')
}

/**
 * 정기시험 평가방법 3분류 (2026 학교 확정) + 작년 2분류 → 올해 3분류 전환 질문.
 * 분류·명칭·현행 양식의 칸 목록은 전부 manifest.exam 에서 읽는다.
 */
function buildExamMethodDoc(m = manifest) {
  const spec = m?.exam
  const cats = spec?.method_categories
  if (!Array.isArray(cats) || cats.length === 0) return ''
  const have = Array.isArray(spec.template_categories) ? spec.template_categories : null
  const nameOf = (c) => c.short_label || c.label
  const counted = cats.filter((c) => c.essay_countable)
  const notCounted = cats.filter((c) => !c.essay_countable)

  const L = [
    '## 정기시험 평가방법 3분류 (2026학년도부터)',
    '',
    '정기시험 배점은 다음 셋으로 나눠 받는다. **회차 100점 = 셋의 합**이다.',
  ]
  for (const c of cats) {
    L.push(`- **${c.label}** — key \`${c.key}\`${c._note ? ` · ${c._note}` : ''}`)
  }
  L.push(
    '',
    '### 서·논술형 30% 에 들어가는 것은 하나뿐이다',
    `- 산입: ${counted.map(nameOf).join(' · ') || '없음'}`,
    `- **미산입**: ${notCounted.map(nameOf).join(' · ')}`,
    `- ${notCounted.filter((c) => c.key !== 'mc').map(nameOf).join('·')}은 주관식이지만 규정이 말하는`,
    '  서·논술형이 아니다. 30% 계산에 넣지 않는다 — 넣으면 규정 미달을 채운 것처럼 보인다.',
    '- 합계는 서버가 재계산한다. 회차별 `essay_ratio` 만 정확히 주면 된다.',
    '',
    '### 작년 자료는 2분류다 — 반드시 나눠 받는다 (시험 있는 전 교과 공통)',
    '- 작년 계획서·참고자료의 지필 배점은 "선택형 + 서·논술형" 두 칸뿐이다.',
    '  그 선택형 안에 올해의 단답형·완성형이 섞여 있다.',
    '- 그래서 정기시험 배점을 받을 때 이렇게 묻는다:',
    '  "올해부터 정기시험 배점을 선택형 / 단답형·완성형 / 서·논술형 3가지로 적습니다.',
    '   작년에는 선택형 N점이었는데, 올해는 이 N점을 선택형과 단답형·완성형으로',
    '   어떻게 나누실까요?"',
    '- ⚠ **네가 임의로 나누지 않는다.** "보통 이렇게 하십니다" 도 하지 않는다.',
    '  작년 값에 근거가 없는 분배는 교사가 정하지 않은 숫자가 문서에 들어가는 것이다.',
    '  교사가 "잘 모르겠다" 고 하면 나누지 말고 그대로 두거나 공란으로 남긴다.'
  )

  if (have && cats.some((c) => !have.includes(c.key))) {
    const missing = cats.filter((c) => !have.includes(c.key))
    const present = cats.filter((c) => have.includes(c.key))
    L.push(
      '',
      '### 현행 양식에는 아직 칸이 없다 (과도기 — 숨기지 않는다)',
      `- 지금 쓰는 양식의 정기시험 표는 ${present.map(nameOf).join(' · ')} 칸만 있다.`,
      `- ${missing.map(nameOf).join(' · ')} 배점은 **문서에 들어가지 못한다.**`,
      '  그래도 교사에게는 3분류로 받는다 — 값은 확인 카드에 남고, 서버가',
      '  "무엇이 문서에서 빠졌는지" 를 알린다.',
      '- 선택형 칸에 합쳐 적을지는 **교사가 정한다.** 네가 합치지 않는다.',
      '- 새 양식이 배포되면 이 제약은 사라진다고 함께 알려도 좋다.'
    )
  }
  return L.join('\n')
}

/**
 * 정기시험 횟수 × 수행평가 개수 세트 (2025-2 실측 53블록 + 학교 확정).
 * 규정이 아니라 학교 관행이라 **막지 않는다** — 세트를 알리고 교사의 선택을 따른다.
 * 수치·이유·전환 안내는 전부 constants.perf_count_rule 에서 읽는다.
 */
function buildCountSetDoc(c = constants) {
  const rule = c?.perf_count_rule
  const by = rule?.by_exams
  if (!by) return ''

  const L = ['## 정기시험 횟수 × 수행평가 개수 (세트)', '']
  for (const [count, s] of Object.entries(by)) {
    if (!s || typeof s !== 'object') continue
    const want = s.min === s.max ? `${s.min}개` : `${s.min}~${s.max}개`
    const fixed = s.fixed ? ' **(고정)**' : ''
    L.push(`- 정기시험 ${count}회 → 수행평가 ${want}${fixed}${s.note ? ` — ${s.note}` : ''}`)
  }

  const ex = rule.excluded || []
  if (ex.length) {
    L.push('', '### 이 조합은 쓰지 않는다')
    for (const e of ex) L.push(`- ${e.set} — ${e.reason}`)
  }

  L.push(
    '',
    '### 세트 밖을 교사가 원할 때 (제0원칙)',
    `- ${rule.off_set_handling || '거부하지 않는다.'}`,
    '- 반대하지 말고 알린다: "이 조합은 올해 세트 밖입니다. 그래도 진행할까요?"',
    '  교사가 진행을 원하면 PLAN_READY 에는 교사가 확정한 대로 **전부** 넣는다.',
    '  자르고 알리는 일은 서버가 한다.'
  )

  const notes = rule.transition_notes || []
  if (notes.length) {
    L.push('', '### 작년과 달라진 조합 (먼저 짚어 줄 것)')
    for (const t of notes) {
      const w = t.was || {}
      const n = t.now || {}
      L.push(
        `- ${t.case}: 작년 시험 ${w.exams}회 × 수행 ${w.perf_areas}개 → 올해는 수행 ${n.perf_areas}개.`,
        `  ${t.guidance}`,
        '  어느 영역을 합칠지/뺄지는 **교사에게 묻고** 정한다. 네가 골라 주지 않는다.'
      )
    }
  }
  return L.join('\n')
}

function buildScaleDoc(c = constants) {
  const rule = c?.essay_ratio_rule || {}
  const L = [
    '## 배점 정합성 (생성 전 반드시 맞출 것)',
    '',
    '### 각 평가는 각각 100점 만점이다 (학교 관행 실측)',
    '- **정기시험 각 회차** — 선택형 + 단답형·완성형 + 서·논술형 = 100 (예: 60 + 10 + 30).',
    '  회차가 2회면 두 회차 **모두 각각** 100점이다. 3분류는 위 절을 따른다.',
    '- **수행평가 각 영역** — 영역마다 만점 100점이다. 영역들의 만점을 나눠 갖지 않는다.',
    '  (❌ 영역 2개를 60점 + 40점으로 쪼개는 방식이 아니다)',
    '- 가중치는 점수가 아니라 **반영비율(%)로만** 준다.',
    '  · 정기시험 반영비율 + 수행평가 반영비율 = 100%',
    '  · 수행평가 영역별 반영비율의 합 = 수행평가 전체 반영비율',
    '  · 정기시험 회차별 반영비율의 합 = 정기시험 전체 반영비율 (안 주면 균등 배분)',
    '- 표기는 **"만점(반영비율%)"** 형식이고 **서버가 조립한다** — 수행 영역이면 "100(40%)".',
    '  너는 각 영역의 **반영비율(ratio)** 만 정확히 주면 된다. 괄호 안 숫자를 직접 계산하지 않는다.',
    '',
    '### 서·논술형 반영비율',
    '- 회차별·수행 영역별로 **반드시 수집**한다. 합계는 서버가 재계산하므로 네가 더할 필요는 없다.',
    '- 적용 여부는 **교과명이 아니라 평가 유형**이 정한다 — 유형 C(수행 100%)·D(자유학기)는 제외.',
    '  자세한 한계선은 위 "학업성적관리규정 한계선" 절을 따른다.',
  ]

  const hint = rule.last_year_type_hint || {}
  const req = hint.typically_A || []
  const exempt = hint.typically_C || []
  if (req.length || exempt.length) {
    L.push(
      '',
      '### 작년 선택 유형 (짐작용 — 확정 아님)',
      `- 보통 유형 A 를 택한 교과: ${req.join(' · ')}`,
      `- 보통 유형 C(수행 100%)를 택한 교과: ${exempt.join(' · ')}`,
      '- ⚠ 작년 관행일 뿐이다. **올해 유형은 교사가 고른다** — 이 목록으로 단정하지 않는다.',
      `  "작년에는 ${exempt[0] || '이 교과'}가 수행 100% 로 하셨던데 올해도 그렇게 할까요?" 처럼 묻는다.`
    )
  }

  L.push(
    '',
    '- 이 규칙에 어긋나면 생성 단계에서 "어느 합이 몇 점/몇 %인지" 와 함께 거부된다.',
    '  요약 단계에서 미리 합을 계산해 보여주고 교사에게 확인받는다.'
  )
  return L.join('\n')
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
  const inserted = [
    buildVariantDoc(m),
    buildRegulationDoc(),
    buildDefaultsDoc(consts),
    buildExamMethodDoc(m),
    buildCountSetDoc(consts),
    buildScaleDoc(consts),
    buildHoursDoc(table),
    buildLimitDoc(m),
    buildGuideDoc(m),
    buildFieldDoc(m),
  ]
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
  buildGuideDoc,
  buildPrefillDoc,
  buildPrefillIndex,
  pickPrefill,
  prefillIndex,
  standardsDb,
  dbSubject,
  buildSkeleton,
  buildHoursDoc,
  buildLimitDoc,
  buildScaleDoc,
  buildExamMethodDoc,
  buildCountSetDoc,
  buildDefaultsDoc,
  buildVariantDoc,
  buildRegulationDoc,
  regulation,
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

  // 교과·학년이 드러났으면 그 한 건만 붙인다 (없으면 지금까지처럼 백지 모드).
  // ⚠ 고정부 뒤에 **따로 붙인다** — 앞쪽 고정부는 모든 교사에게 같아 캐시가 살고,
  //   prefill 은 교과·학년별로 같아 그 교사의 다음 턴에서 다시 캐시된다.
  const prefill = pickPrefill(parsed.messages)
  const prefillDoc = prefill ? buildPrefillDoc(prefill) : ''
  if (prefill) console.log(`[doc-ai/chat] prefill: ${prefill.file}`)

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
        system: prefillDoc
          ? [
              { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: prefillDoc, cache_control: { type: 'ephemeral' } },
            ]
          : [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
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
