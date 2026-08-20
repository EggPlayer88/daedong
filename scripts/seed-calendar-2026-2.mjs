#!/usr/bin/env node
// 2026-2 학사일정(official) 시드 SQL 생성.
//
// 일정 목록 자체는 _calendar-events.mjs 가 들고 있다 (시수 파생·대조 테스트와
// 같은 목록을 봐야 하므로). 이 파일은 그것을 SQL 로 옮기기만 한다.
//
// 실행: node scripts/seed-calendar-2026-2.mjs        (SQL 을 화면에 출력만 한다)
//       node scripts/seed-calendar-2026-2.mjs --out seed.sql
// 실행 주체: 계란님이 Supabase SQL Editor 에서 직접 (P7 — 세션은 SQL 을 만들기만)
import { writeFileSync } from 'node:fs'
import { ASK, C, EVENTS, TERM } from './_calendar-events.mjs'

const YEAR = TERM.year
const SEMESTER = TERM.semester

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const nums = (a) => `'{${a.join(',')}}'`
// ⚠ 텍스트 배열은 '{'학사'}' 처럼 쓰면 따옴표가 깨진다. ARRAY[...] 로 명시한다
const texts = (a) => (a.length ? `ARRAY[${a.map(q).join(', ')}]::text[]` : `'{}'::text[]`)

const lines = []
lines.push('-- 2026-2 학사일정(official) 시드 — scripts/seed-calendar-2026-2.mjs 가 생성')
lines.push(`-- 원천: apps/main/api/doc-ai/_assets/school-constants-2026-2.json (${C._comment?.slice(0, 40) || ''}…)`)
lines.push('-- ⚠ 자산에 없는 날짜(방학 등)는 넣지 않았다. 아래 [질문] 목록 참조.')
lines.push('-- 실행: SQL Editor 에 붙여넣기. created_by 는 실행하는 관리자 계정으로 채운다.')
lines.push('')
lines.push('DO $$')
lines.push('DECLARE')
lines.push('  v_term  TEXT;')
lines.push('  v_admin TEXT;')
lines.push('BEGIN')
lines.push(`  SELECT id INTO v_term FROM public.academic_terms WHERE year = ${YEAR} AND semester = ${SEMESTER};`)
lines.push("  SELECT id INTO v_admin FROM public.users WHERE role IN ('superadmin','admin') ORDER BY created_at LIMIT 1;")
lines.push("  IF v_term IS NULL OR v_admin IS NULL THEN")
lines.push("    RAISE EXCEPTION '학기(academic_terms) 또는 관리자 계정을 찾지 못했습니다';")
lines.push('  END IF;')
lines.push('')
lines.push('  -- 같은 학기의 official 을 지우고 다시 넣는다 (여러 번 실행해도 같은 결과)')
lines.push("  DELETE FROM public.calendar_events WHERE term_id = v_term AND scope = 'official';")
lines.push('')
for (const e of EVENTS) {
  lines.push('  INSERT INTO public.calendar_events')
  lines.push('    (term_id, scope, title, event_type, labels, start_date, end_date, grades, no_class, description, created_by)')
  lines.push(
    `  VALUES (v_term, 'official', ${q(e.title)}, ${q(e.event_type)}, ${texts(e.labels)}, ` +
      `${q(e.start_date)}, ${q(e.end_date)}, ${nums(e.grades)}, ${e.no_class}, ` +
      `${e.description ? q(e.description) : 'NULL'}, v_admin);   -- 근거: ${e.source}`
  )
}
lines.push('END $$;')
lines.push('')
lines.push('-- [검증]')
lines.push(`-- SELECT COUNT(*) FROM public.calendar_events WHERE scope='official';  → ${EVENTS.length}`)
lines.push("-- SELECT title, start_date, end_date, no_class FROM public.calendar_events WHERE scope='official' ORDER BY start_date;")

const sql = lines.join('\n')
const outIdx = process.argv.indexOf('--out')
if (outIdx > 0 && process.argv[outIdx + 1]) {
  writeFileSync(process.argv[outIdx + 1], `${sql}\n`, 'utf-8')
  console.log(`${EVENTS.length}건 → ${process.argv[outIdx + 1]}`)
} else {
  console.log(sql)
}

// ── 자산에 없어서 넣지 못한 것 (지어내지 않는다) ────────────────────────────
console.error('\n────────────────────────────────────────────────────────')
console.error('[질문] 자산에 없어 시드에 넣지 못한 것 — 확인 후 추가해야 합니다:')
for (const [k, why] of ASK) console.error(`  · ${k}\n      ${why}`)
console.error('\n[제안] academic_terms 를 자산 값으로 맞추는 UPDATE:')
console.error(
  `  UPDATE public.academic_terms SET start_date = '${TERM.start_date}', end_date = '${TERM.end_date}'\n` +
    `   WHERE year = ${YEAR} AND semester = ${SEMESTER};`
)
console.error('────────────────────────────────────────────────────────')
