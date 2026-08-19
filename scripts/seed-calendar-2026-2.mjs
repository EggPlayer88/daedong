#!/usr/bin/env node
// 2026-2 학사일정(official) 시드 SQL 생성.
//
// ⚠ **원천은 school-constants-2026-2.json 하나뿐이다.** 그 파일은 학사일정 원본
//    (2학기_학사일정.xlsx)을 파싱해 만든 자산이고, repo 에 원본 xlsx 은 없다.
//    그래서 이 스크립트는 **자산에 적힌 것만** SQL 로 옮긴다 —
//    방학 시작일처럼 자산에 없는 날짜는 지어내지 않고 "질문 목록" 으로 출력한다.
//    공문서 일정에 추정 날짜가 섞이면 그 뒤의 모든 계산이 조용히 틀어진다.
//
// 실행: node scripts/seed-calendar-2026-2.mjs        (SQL 을 화면에 출력만 한다)
//       node scripts/seed-calendar-2026-2.mjs --out seed.sql
// 실행 주체: 계란님이 Supabase SQL Editor 에서 직접 (P7 — 세션은 SQL 을 만들기만)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONST = join(ROOT, 'apps/main/api/doc-ai/_assets/school-constants-2026-2.json')
const C = JSON.parse(readFileSync(CONST, 'utf-8'))
const YEAR = C.year
const SEMESTER = C.semester

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const nums = (a) => `'{${a.join(',')}}'`
// ⚠ 텍스트 배열은 '{'학사'}' 처럼 쓰면 따옴표가 깨진다. ARRAY[...] 로 명시한다
const texts = (a) => (a.length ? `ARRAY[${a.map(q).join(', ')}]::text[]` : `'{}'::text[]`)
const ALL = [1, 2, 3]

/**
 * 이벤트는 **자산의 문장에서 직접 옮긴 것만** 넣는다.
 * source 는 그 근거가 자산의 어디에 있는지다 — 나중에 누가 "이 날짜 어디서 왔냐" 고
 * 물었을 때 되짚을 수 있어야 한다.
 */
const EVENTS = []
const add = (e) => EVENTS.push({ grades: ALL, no_class: false, labels: [], ...e })

// ── 학기 경계 (semester_start / semester_end) ────────────────────────────────
add({
  title: '2학기 개학', type: '행사', start: C.semester_start, end: C.semester_start,
  no_class: false, labels: ['학사'], source: 'semester_start',
  desc: '8월 note: "8/14(금) 개학"',
})
add({
  title: '종업식·졸업식', type: '행사', start: C.semester_end, end: C.semester_end,
  labels: ['학사'], source: 'semester_end + 1월 note',
  desc: '1월 note: "1/4(월) 종업식·졸업식"',
})

// ── 월별 note 에 적힌 날짜들 ────────────────────────────────────────────────
// 공휴일·대체휴일 — 수업일수에서 빠지므로 no_class
add({ title: '광복절', type: '휴업일', start: '2026-08-15', end: '2026-08-15', no_class: true,
      labels: ['공휴일'], source: '8월 note', desc: '토요일' })
add({ title: '광복절 대체휴일', type: '휴업일', start: '2026-08-17', end: '2026-08-17', no_class: true,
      labels: ['공휴일'], source: '8월 note' })
add({ title: '추석 연휴', type: '휴업일', start: '2026-09-24', end: '2026-09-26', no_class: true,
      labels: ['공휴일'], source: '9월 note' })
add({ title: '개천절', type: '휴업일', start: '2026-10-03', end: '2026-10-03', no_class: true,
      labels: ['공휴일'], source: '10월 note', desc: '토요일' })
add({ title: '한글날', type: '휴업일', start: '2026-10-09', end: '2026-10-09', no_class: true,
      labels: ['공휴일'], source: '10월 note' })
add({ title: '성탄절', type: '휴업일', start: '2026-12-25', end: '2026-12-25', no_class: true,
      labels: ['공휴일'], source: '12월 note' })

// 학교 행사 — 수업일수에는 포함되지만 교과 수업 여부가 다르다 (자산 문장 그대로 남긴다)
add({ title: '개교기념일', type: '휴업일', start: '2026-11-06', end: '2026-11-06', no_class: true,
      labels: ['학사'], source: '11월 note' })
add({
  title: '체육대회', type: '행사', start: '2026-10-08', end: '2026-10-08', no_class: true,
  labels: ['학사'], source: '10월 note',
  desc: '자산 표기: "수업일수 포함·교과수업 없음" — 수업일수에는 들어가되 교과 수업은 없음',
})
add({
  title: '철쭉제', type: '행사', start: '2026-12-22', end: '2026-12-24', no_class: false,
  labels: ['학사'], source: '12월 note',
  desc: '자산 표기: "수업일수 포함·교과수업 축소" — 축소이지 없음이 아니라 no_class=false',
})
add({ title: '학년별 영어듣기평가', type: '행사', start: '2026-09-01', end: '2026-09-03',
      labels: ['평가'], source: '9월 note' })

// ── 정기시험 (exam_schedule) ────────────────────────────────────────────────
for (const [key, info] of Object.entries(C.exam_schedule || {})) {
  const g = Number(/grade(\d)/.exec(key)?.[1])
  if (!g || !Array.isArray(info.rounds)) continue
  for (const r of info.rounds) {
    const [s, e] = String(r.period).split('~').map((x) => x.trim())
    add({
      title: `${g}학년 ${r.label}`, type: '고사', start: s, end: e || s,
      grades: [g], labels: ['고사'], source: `exam_schedule.${key}`,
    })
  }
}

// ── SQL ─────────────────────────────────────────────────────────────────────
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
    `  VALUES (v_term, 'official', ${q(e.title)}, ${q(e.type)}, ${texts(e.labels)}, ` +
      `${q(e.start)}, ${q(e.end)}, ${nums(e.grades)}, ${e.no_class}, ` +
      `${e.desc ? q(e.desc) : 'NULL'}, v_admin);   -- 근거: ${e.source}`
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
const ASK = [
  ['겨울방학 시작일·종료일', '자산에 방학 날짜가 없다. 1월 수업일수가 1일(1/4)뿐인 것으로 보아 12월 말~1월 초 방학으로 보이나 확정 날짜가 필요하다'],
  ['재량휴업일', "event_type 에 '재량휴업' 이 있는데 자산에는 한 건도 없다. 올해 지정분이 있는지"],
  ['학기말 고사 이후 일정', '12/3 이후 12/22 철쭉제까지 사이의 학사일정(성적처리 기간 등)'],
  ['1학년 자유학기 관련 일정', '주제선택·진로체험 등 자유학기 활동 일정이 학사일정에 있는지'],
  ['academic_terms 2026-2 기간', `006 에 들어간 값(2026-08-17 ~ 2027-01-08)이 자산(${C.semester_start} ~ ${C.semester_end})과 다르다`],
]
console.error('\n────────────────────────────────────────────────────────')
console.error('[질문] 자산에 없어 시드에 넣지 못한 것 — 확인 후 추가해야 합니다:')
for (const [k, why] of ASK) console.error(`  · ${k}\n      ${why}`)
console.error('\n[제안] academic_terms 를 자산 값으로 맞추는 UPDATE:')
console.error(
  `  UPDATE public.academic_terms SET start_date = '${C.semester_start}', end_date = '${C.semester_end}'\n` +
    `   WHERE year = ${YEAR} AND semester = ${SEMESTER};`
)
console.error('────────────────────────────────────────────────────────')
