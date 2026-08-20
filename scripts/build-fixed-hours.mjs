#!/usr/bin/env node
// 캘린더(official) → 시수 자산 생성 · 대조 (모듈 C-2).
//
// 왜 자산을 거치나: doc-ai 파이프라인(chat.js / generate.py)은 **자산만 읽는다.**
// 문서를 만들 때마다 DB 를 조회하면, 캘린더를 손보는 순간 이미 만들어 둔 계획서와
// 새 계획서의 시수가 갈린다. 시수는 결재가 끝난 문서에 박히는 숫자다 —
// 언제 찍은 값인지가 파일에 남아 있어야 한다.
//   캘린더 = 원천, 자산 = 그 원천을 **찍은 시점의 스냅샷**.
//
// 실행:
//   node scripts/build-fixed-hours.mjs              # 파생값 + 기존 자산 대조 리포트 (아무것도 안 쓴다)
//   node scripts/build-fixed-hours.mjs --json       # 새 자산 JSON 을 화면에
//   node scripts/build-fixed-hours.mjs --write      # 자산 파일을 실제로 갱신 (계란님 판정 후)
//   node scripts/build-fixed-hours.mjs --from-seed  # DB 대신 시드 스냅샷에서 (기본값: DB 있으면 DB)
//
// ⚠ 기본은 **읽기 전용**이다. 파생값과 자산이 다를 때 어느 쪽이 맞는지는
//   계란님 판정 사항이다 (감산 규칙은 학교 관행이지 산식이 아니다).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EVENTS, TERM } from './_calendar-events.mjs'
import {
  DEFAULT_MIN_WEEKS,
  WEEKLY_RANGE,
  hoursTable,
  noClassBreakdown,
} from '../apps/main/src/lib/school-days.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'apps/main/api/doc-ai/_assets')
const HOURS_PATH = join(ASSETS, 'fixed-hours-2026-2.json')
const CONST_PATH = join(ASSETS, 'school-constants-2026-2.json')

const arg = (name) => process.argv.includes(name)
const argVal = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}

/** 최소 총 시수의 주 수를 자산 문장에서 읽는다 — 코드에 17 을 박지 않는다 */
export function minWeeksFrom(constants) {
  const text = String(constants?.hours_calculation_rule?.min_total_hours || '')
  const m = /×\s*(\d+)/.exec(text)
  return m ? Number(m[1]) : DEFAULT_MIN_WEEKS
}

/**
 * 캘린더 행을 어디서 가져올지.
 * DB 접속 정보가 없으면 시드 스냅샷으로 — 다만 **무엇을 봤는지 반드시 밝힌다.**
 * 어디서 온 숫자인지 모르는 시수표는 없느니만 못하다.
 */
async function loadRows() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (arg('--from-seed') || !url || !key) {
    return {
      rows: EVENTS,
      term: TERM,
      origin: 'seed',
      note: arg('--from-seed')
        ? '시드 스냅샷 (--from-seed)'
        : '시드 스냅샷 — SUPABASE_URL/SUPABASE_SERVICE_KEY 가 없어 DB 를 못 봤다',
    }
  }
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(url, key, { auth: { persistSession: false } })
  const { data: term, error: te } = await db
    .from('academic_terms')
    .select('id, year, semester, start_date, end_date')
    .eq('is_current', true)
    .maybeSingle()
  if (te || !term) throw new Error(`현재 학기를 못 읽었습니다: ${te?.message || '없음'}`)
  const { data: rows, error: ee } = await db
    .from('calendar_events')
    .select('id, scope, title, event_type, start_date, end_date, grades, no_class, deleted_at')
    .eq('term_id', term.id)
  if (ee) throw new Error(`일정을 못 읽었습니다: ${ee.message}`)
  return { rows: rows || [], term, origin: 'db', note: `DB (${url.replace(/^https?:\/\//, '')})` }
}

/** 자산 모양으로 조립. doc-ai 가 읽는 키(months / variants / default_variant)는 그대로 둔다 */
export function buildAsset({ rows, term, origin, note }, constants, stamp) {
  const minWeeks = minWeeksFrom(constants)
  const t = hoursTable(rows, term, { minWeeks })
  const breakdown = noClassBreakdown(rows, term)
  const variants = {}
  for (const w of WEEKLY_RANGE) {
    const r = t.variants[String(w)]
    variants[String(w)] = {
      months: r.months,
      total: r.total,
      min_required: r.min_required,
      ok: r.ok,
    }
  }
  return {
    _comment:
      '학사일정 캘린더(official)에서 파생한 시수/누계표. 서버(generate.py)가 ' +
      'monthly_plan[].hours_cum 을 이 표로 자동 주입 — AI 계산 금지. ' +
      'scripts/build-fixed-hours.mjs 가 생성한다 (손으로 고치지 말 것).',
    generated: stamp,
    algorithm:
      '수업일 = 학기 내 평일 − official·no_class 날짜. ' +
      '누계 = ⌊주당시수 × 누적 수업일수 ÷ 5⌋, 월 시수 = 누계의 차이 ' +
      '(달마다 남는 소수는 버리지 않고 다음 달로 넘어간다).',
    source: {
      origin,
      note,
      term: { start_date: term.start_date, end_date: term.end_date },
      min_weeks: minWeeks,
      // 재현에 필요한 것을 다 적는다 — 이 표가 어느 날짜들에서 나왔는지
      no_class: breakdown.map((b) => ({ title: b.title, dates: b.dates })),
      monthly_class_days: t.monthly.map((m) => ({
        month: m.label,
        days: m.days,
        ...(m.absorbed.length
          ? { absorbed: m.absorbed.map((a) => `${a.label} ${a.days}일`) }
          : {}),
      })),
      total_class_days: t.total_class_days,
    },
    months: t.months,
    default_variant: 'common',
    variant_note:
      'common = 학년 공통. 학년별 감산(고사일 등)은 파생하지 않는다 — ' +
      '캘린더의 고사 일정은 no_class 가 아니기 때문이다. 학년별로 나눠야 하면 ' +
      '해당 일정의 no_class 와 대상 학년을 캘린더에서 지정하고 다시 생성한다.',
    variants: { common: variants },
  }
}

/** 기존 자산과의 차이 — 셀 단위로, 어느 달·어느 주당시수인지까지 */
export function diffAgainst(asset, derived) {
  const out = []
  const a = asset?.variants?.[asset?.default_variant] || {}
  const d = derived.variants[derived.default_variant] || {}
  for (const w of WEEKLY_RANGE) {
    const oldRow = a[String(w)]
    const newRow = d[String(w)]
    if (!oldRow || !newRow) continue
    for (let i = 0; i < newRow.months.length; i += 1) {
      if (oldRow.months[i] !== newRow.months[i]) {
        out.push({
          weekly: w,
          month: derived.months[i] || `${i + 1}행`,
          asset: oldRow.months[i] ?? '(없음)',
          derived: newRow.months[i],
        })
      }
    }
  }
  return out
}

// ── 실행 ────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('build-fixed-hours.mjs')) {
  const constants = JSON.parse(readFileSync(CONST_PATH, 'utf-8'))
  const src = await loadRows()
  const stamp = argVal('--stamp') || new Date().toISOString().slice(0, 10)
  const derived = buildAsset(src, constants, stamp)

  if (arg('--json')) {
    console.log(JSON.stringify(derived, null, 1))
  } else if (arg('--write')) {
    writeFileSync(HOURS_PATH, `${JSON.stringify(derived, null, 1)}\n`, 'utf-8')
    console.log(`자산 갱신: ${HOURS_PATH}`)
  }

  // ── 리포트 (언제나 stderr — 파이프로 JSON 만 받아도 근거가 보이게) ────────
  const old = JSON.parse(readFileSync(HOURS_PATH, 'utf-8'))
  const R = (s) => console.error(s)
  R('────────────────────────────────────────────────────────')
  R(`원천: ${src.note}`)
  R(`학기: ${src.term.start_date} ~ ${src.term.end_date}`)
  R('')
  R('[월별 수업일수]  평일 − official·no_class')
  for (const m of derived.source.monthly_class_days) {
    R(`  ${m.month.padStart(4)}  ${String(m.days).padStart(3)}일${m.absorbed ? `   (흡수: ${m.absorbed.join(', ')})` : ''}`)
  }
  R(`  총계  ${derived.source.total_class_days}일`)
  R('')
  R('[수업이 빠진 날]')
  for (const n of derived.source.no_class) {
    R(`  ${n.title} — ${n.dates.length ? n.dates.join(', ') : '평일 없음 (수업일수에 영향 없음)'}`)
  }
  R('')
  R('[파생 시수표 vs 기존 자산]')
  const d = diffAgainst(old, derived)
  const dv = derived.variants.common
  const ov = old.variants?.[old.default_variant] || {}
  R(`  주당 │ ${derived.months.map((m) => m.padStart(7)).join(' ')} │ 합계`)
  for (const w of WEEKLY_RANGE) {
    const nr = dv[String(w)]
    const or = ov[String(w)]
    R(`  파생${w} │ ${nr.months.map((x) => x.padStart(7)).join(' ')} │ ${nr.total}${nr.ok ? '' : ' ⚠최소미달'}`)
    if (or && or.months.join() !== nr.months.join()) {
      R(`  자산${w} │ ${or.months.map((x) => x.padStart(7)).join(' ')} │ ${or.total}`)
    }
  }
  R('')
  if (d.length === 0) {
    R('✓ 파생값과 자산이 모두 일치합니다.')
  } else {
    R(`⚠ 불일치 ${d.length}칸 — 어느 쪽이 맞는지는 계란님 판정 사항입니다.`)
    for (const x of d) R(`  주당 ${x.weekly}시간 ${x.month}: 자산 ${x.asset} ≠ 파생 ${x.derived}`)
    R('')
    R('  기존 자산이 감산했다고 적어 둔 날 (assumptions):')
    for (const s of old.assumptions?.['감산(교과수업 0)'] || []) R(`    · ${s}`)
    R('  → 이 날들이 캘린더에서 no_class 로 표시돼 있는지 확인하면 차이가 설명됩니다.')
  }
  R('────────────────────────────────────────────────────────')
  if (!arg('--json') && !arg('--write')) {
    console.log(d.length === 0 ? '일치' : `불일치 ${d.length}칸 (위 리포트 참조)`)
  }
}
