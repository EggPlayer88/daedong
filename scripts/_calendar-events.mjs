// 2026-2 학사일정(official) 스냅샷 — school-constants 에서 옮겨 적은 것만.
//
// ⚠ **원천은 school-constants-2026-2.json 하나뿐이다.** 그 파일은 학사일정 원본
//    (2학기_학사일정.xlsx)을 파싱해 만든 자산이고, repo 에 원본 xlsx 은 없다.
//    여기서는 **자산에 적힌 것만** 옮긴다 — 방학 시작일처럼 자산에 없는 날짜는
//    지어내지 않고 ASK 목록으로 남긴다. 공문서 일정에 추정 날짜가 섞이면
//    그 뒤의 모든 계산(수업일수·시수)이 조용히 틀어진다.
//
// 이 목록을 세 곳이 함께 쓴다:
//   · seed-calendar-2026-2.mjs — DB 에 넣을 SQL
//   · build-fixed-hours.mjs    — DB 를 못 볼 때의 대체 원천 (--from-seed)
//   · tests/test_school_days.mjs — 자산 stale 검출
// 같은 목록을 두 번 적으면 한쪽만 고쳐지고 조용히 갈라진다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CONST_PATH = join(ROOT, 'apps/main/api/doc-ai/_assets/school-constants-2026-2.json')
export const C = JSON.parse(readFileSync(CONST_PATH, 'utf-8'))

const ALL = [1, 2, 3]

/**
 * 학기 기간. 006 에 들어간 값(2026-08-17~2027-01-08)이 아니라 **자산 값**이다.
 * 둘이 다르다는 것은 시드 스크립트가 [질문] 으로 이미 보고했다 —
 * academic_terms UPDATE 가 아직 실행되지 않았으면 파생값이 갈린다.
 */
export const TERM = {
  year: C.year,
  semester: C.semester,
  start_date: C.semester_start,
  end_date: C.semester_end,
}

export const EVENTS = []
const add = (e) => EVENTS.push({ grades: ALL, no_class: false, labels: [], scope: 'official', ...e })

// ── 학기 경계 ───────────────────────────────────────────────────────────────
add({
  title: '2학기 개학', event_type: '행사',
  start_date: C.semester_start, end_date: C.semester_start,
  labels: ['학사'], source: 'semester_start', description: '8월 note: "8/14(금) 개학"',
})
add({
  title: '종업식·졸업식', event_type: '행사',
  start_date: C.semester_end, end_date: C.semester_end,
  labels: ['학사'], source: 'semester_end + 1월 note',
  description: '1월 note: "1/4(월) 종업식·졸업식"',
})

// ── 공휴일·대체휴일 — 수업일수에서 빠지므로 no_class ────────────────────────
add({ title: '광복절', event_type: '휴업일', start_date: '2026-08-15', end_date: '2026-08-15',
      no_class: true, labels: ['공휴일'], source: '8월 note', description: '토요일' })
add({ title: '광복절 대체휴일', event_type: '휴업일', start_date: '2026-08-17', end_date: '2026-08-17',
      no_class: true, labels: ['공휴일'], source: '8월 note' })
add({ title: '추석 연휴', event_type: '휴업일', start_date: '2026-09-24', end_date: '2026-09-26',
      no_class: true, labels: ['공휴일'], source: '9월 note' })
add({ title: '개천절', event_type: '휴업일', start_date: '2026-10-03', end_date: '2026-10-03',
      no_class: true, labels: ['공휴일'], source: '10월 note', description: '토요일' })
add({ title: '한글날', event_type: '휴업일', start_date: '2026-10-09', end_date: '2026-10-09',
      no_class: true, labels: ['공휴일'], source: '10월 note' })
add({ title: '성탄절', event_type: '휴업일', start_date: '2026-12-25', end_date: '2026-12-25',
      no_class: true, labels: ['공휴일'], source: '12월 note' })
add({ title: '개교기념일', event_type: '휴업일', start_date: '2026-11-06', end_date: '2026-11-06',
      no_class: true, labels: ['학사'], source: '11월 note' })

// ── 학교 행사 — 수업일수에는 들어가되 교과 수업 여부가 다르다 ──────────────
add({
  title: '체육대회', event_type: '행사', start_date: '2026-10-08', end_date: '2026-10-08',
  no_class: true, labels: ['학사'], source: '10월 note',
  description: '자산 표기: "수업일수 포함·교과수업 없음" — 수업일수에는 들어가되 교과 수업은 없음',
})
add({
  title: '철쭉제', event_type: '행사', start_date: '2026-12-22', end_date: '2026-12-24',
  no_class: false, labels: ['학사'], source: '12월 note',
  description: '자산 표기: "수업일수 포함·교과수업 축소" — 축소이지 없음이 아니라 no_class=false',
})
add({ title: '학년별 영어듣기평가', event_type: '행사', start_date: '2026-09-01', end_date: '2026-09-03',
      labels: ['평가'], source: '9월 note' })

// ── 정기시험 ────────────────────────────────────────────────────────────────
for (const [key, info] of Object.entries(C.exam_schedule || {})) {
  const g = Number(/grade(\d)/.exec(key)?.[1])
  if (!g || !Array.isArray(info.rounds)) continue
  for (const r of info.rounds) {
    const [s, e] = String(r.period).split('~').map((x) => x.trim())
    add({
      title: `${g}학년 ${r.label}`, event_type: '고사', start_date: s, end_date: e || s,
      grades: [g], labels: ['고사'], source: `exam_schedule.${key}`,
    })
  }
}

/** 자산에 없어서 넣지 못한 것 — 지어내지 않고 물어본다 */
export const ASK = [
  ['겨울방학 시작일·종료일', '자산에 방학 날짜가 없다. 1월 수업일수가 1일(1/4)뿐인 것으로 보아 12월 말~1월 초 방학으로 보이나 확정 날짜가 필요하다'],
  ['재량휴업일', "event_type 에 '재량휴업' 이 있는데 자산에는 한 건도 없다. 올해 지정분이 있는지"],
  ['학기말 고사 이후 일정', '12/3 이후 12/22 철쭉제까지 사이의 학사일정(성적처리 기간 등)'],
  ['1학년 자유학기 관련 일정', '주제선택·진로체험 등 자유학기 활동 일정이 학사일정에 있는지'],
  ['academic_terms 2026-2 기간', `006 에 들어간 값(2026-08-17 ~ 2027-01-08)이 자산(${C.semester_start} ~ ${C.semester_end})과 다르다`],
]
