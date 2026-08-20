// 수업일수·시수 파생 — 캘린더를 계산의 원천으로 (모듈 C-2).
//
// ⚠ **파생 계산의 원천은 official 뿐이다** (C-1 경계 그대로).
//    shared 는 교사들이 자유롭게 쓰는 메모판이라, 거기에 누가 무엇을 적든
//    시수가 흔들리면 안 된다. 이 파일에서 날짜를 세는 함수는 모두
//    scope === 'official' 만 본다. 테스트가 이 경계를 고정한다.
//
// ⚠ 이 파일은 **아무것도 import 하지 않는다.** supabase 를 끌어오면 DB 없이
//    돌리는 검증 스크립트·대조 테스트에서 쓸 수 없다.
//    계산은 여기서 순수하게, 조회는 calendar.js 에서.

/** 교수·학습 계획 표는 **5행 고정**이다 (전 학년 동일 — 2학기는 8~12월) */
export const MONTH_ROWS = 5

/** 시수표가 다루는 주당 시수 범위 */
export const WEEKLY_RANGE = [1, 2, 3, 4, 5]

/** 최소 총 시수 = 주당시수 × 이 주 수 (school-constants 의 hours_calculation_rule) */
export const DEFAULT_MIN_WEEKS = 17

/**
 * 날짜 → 'YYYY-MM-DD'.
 * ⚠ toISOString() 을 쓰면 안 된다 — UTC 로 바꾸면서 한국 시간 기준 날짜가 하루
 *   밀린다 (KST 자정은 UTC 전날 15시). 지역 시간 요소로 직접 조립한다.
 */
export function iso(d) {
  if (!(d instanceof Date)) return String(d || '')
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 'YYYY-MM-DD' → Date (지역 시간 자정). 문자열을 그대로 Date 에 넣으면 UTC 로 읽힌다 */
export const at = (s) => new Date(`${iso(s)}T00:00:00`)

/** 기간 안의 모든 날짜 (양 끝 포함) */
export function eachDate(start, end) {
  const s = at(start)
  const e = at(end || start)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return []
  const out = []
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(iso(d))
  return out
}

/** 월~금만 수업일 후보다. 토·일은 애초에 세지 않는다 */
export function isWeekday(date) {
  const d = at(date)
  if (Number.isNaN(d.getTime())) return false
  const w = d.getDay()
  return w >= 1 && w <= 5
}

/**
 * 살아 있는 official 일정만 — 파생 계산이 보는 유일한 창.
 * 배열이 아닌 것이 오면 "일정이 없다" 로 본다. 조회가 실패해 null 이 흘러들어도
 * 화면이 죽는 대신 **수업일이 하나도 안 깎인 표**가 나온다 — 시수가 과소계상되는
 * 쪽보다 낫고, 눈으로 바로 이상함을 알 수 있다.
 */
export const officialRows = (rows) =>
  (Array.isArray(rows) ? rows : []).filter((r) => r && !r.deleted_at && r.scope === 'official')

/** no_class 로 표시된 official 일정 (기간 일정은 펼치기 전 원본 그대로) */
export const noClassEvents = (rows) => officialRows(rows).filter((r) => r.no_class)

/** 수업이 없는 날짜 집합. shared 는 절대 섞지 않는다 */
export function noClassDates(rows) {
  const out = new Set()
  for (const r of noClassEvents(rows)) {
    for (const d of eachDate(r.start_date, r.end_date)) out.add(d)
  }
  return out
}

/**
 * 수업일 = 학기 기간 내 평일 − official·no_class 날짜.
 *
 * ⚠ 여기서 말하는 "수업일" 은 **교과 수업이 있는 날**이다.
 *   출석 기준 수업일수(체육대회처럼 교과 수업은 없어도 등교하는 날을 포함)와는
 *   다를 수 있다. 시수는 교과 수업이 있는 날에서만 나오므로 이쪽을 센다.
 */
export function classDates(rows, term) {
  if (!term?.start_date || !term?.end_date) return []
  const off = noClassDates(rows)
  return eachDate(term.start_date, term.end_date).filter((d) => isWeekday(d) && !off.has(d))
}

const monthLabel = (ym) => `${Number(ym.slice(5, 7))}월`

/**
 * 표에 실릴 5개 월(YYYY-MM). 학기 시작 월부터 연속 5개.
 * 그 뒤에 남는 월(2학기의 1월)은 행을 만들지 않고 **마지막 행에 흡수**한다 —
 * 양식이 5행 고정이라 6번째 행을 만들 수 없다.
 */
export function monthRows(term, count = MONTH_ROWS) {
  if (!term?.start_date) return []
  const s = at(term.start_date)
  const out = []
  for (let i = 0; i < count; i += 1) {
    const d = new Date(s.getFullYear(), s.getMonth() + i, 1)
    out.push(iso(d).slice(0, 7))
  }
  return out
}

/**
 * 월별 수업일수. 5행 고정 + 범위 밖 월은 마지막 행에 흡수.
 * 반환: [{ ym, label, days, dates, absorbed: [{ ym, label, days }] }]
 */
export function monthlyClassDays(rows, term, count = MONTH_ROWS) {
  const months = monthRows(term, count)
  if (months.length === 0) return []
  const byMonth = new Map()
  for (const d of classDates(rows, term)) {
    const ym = d.slice(0, 7)
    if (!byMonth.has(ym)) byMonth.set(ym, [])
    byMonth.get(ym).push(d)
  }
  const table = months.map((ym) => ({
    ym,
    label: monthLabel(ym),
    days: (byMonth.get(ym) || []).length,
    dates: byMonth.get(ym) || [],
    absorbed: [],
  }))
  const last = table[table.length - 1]
  // 표 밖의 월(1월 등)을 마지막 행으로 합친다 — 합계가 새어 나가지 않게
  for (const [ym, dates] of [...byMonth.entries()].sort()) {
    if (months.includes(ym)) continue
    if (ym < months[0]) continue // 학기 시작 전은 애초에 없다 (방어)
    last.absorbed.push({ ym, label: monthLabel(ym), days: dates.length })
    last.days += dates.length
    last.dates = [...last.dates, ...dates]
  }
  return table
}

/**
 * 주당 시수 → 월별 시수/누계 한 줄.
 *
 * 산식: **누계 = ⌊주당시수 × 누적 수업일수 ÷ 5⌋**, 월 시수 = 누계의 차이.
 * "주당시수 × 그 달의 수업 주 수(수업일÷5)" 를 달마다 더해 가되, 소수는 버리지
 * 않고 다음 달로 넘긴다. 기존 고정표(주별 이월)와 같은 값이 나오며, 정수 연산이라
 * 부동소수 오차가 없다. 총합은 언제나 ⌊주당시수 × 총수업일 ÷ 5⌋ 로 맞는다.
 */
export function hoursRow(dayCounts, weekly, minWeeks = DEFAULT_MIN_WEEKS) {
  const w = Number(weekly)
  const days = (dayCounts || []).map((n) => Number(n) || 0)
  const hours = []
  const cums = []
  let acc = 0
  let prev = 0
  for (const d of days) {
    acc += d
    const cum = Math.floor((w * acc) / 5) // w·acc 가 정수라 오차가 없다
    hours.push(cum - prev)
    cums.push(cum)
    prev = cum
  }
  const total = cums.length ? cums[cums.length - 1] : 0
  const minRequired = w * minWeeks
  return {
    months: hours.map((h, i) => `${h}/${cums[i]}`),
    hours,
    cums,
    total,
    min_required: minRequired,
    ok: total >= minRequired,
  }
}

/**
 * 시수표 전체 (주당 1~5시간). fixed-hours 자산과 같은 모양으로 만든다 —
 * doc-ai 파이프라인은 자산만 읽으므로, 모양이 같아야 그대로 갈아끼울 수 있다.
 */
export function hoursTable(rows, term, opts = {}) {
  const { minWeeks = DEFAULT_MIN_WEEKS, weeklyRange = WEEKLY_RANGE, count = MONTH_ROWS } = opts
  const monthly = monthlyClassDays(rows, term, count)
  const days = monthly.map((m) => m.days)
  const variants = {}
  for (const w of weeklyRange) variants[String(w)] = hoursRow(days, w, minWeeks)
  return {
    months: monthly.map((m) => m.label),
    monthly,
    total_class_days: days.reduce((a, b) => a + b, 0),
    variants,
  }
}

/**
 * no_class 일정 목록 (어떤 날이 빠졌는지 눈으로 확인하는 용도).
 * 학기 밖 날짜는 빼고, 실제로 수업일에서 깎인 평일 수를 함께 준다.
 */
export function noClassBreakdown(rows, term) {
  const inTerm = term?.start_date && term?.end_date
    ? new Set(eachDate(term.start_date, term.end_date))
    : null
  return noClassEvents(rows)
    .map((r) => {
      const dates = eachDate(r.start_date, r.end_date).filter(
        (d) => (!inTerm || inTerm.has(d)) && isWeekday(d)
      )
      return {
        id: r.id,
        title: r.title,
        event_type: r.event_type,
        start_date: r.start_date,
        end_date: r.end_date,
        weekdays: dates.length, // 주말만 걸친 일정은 0 — 수업일수에 영향 없음
        dates,
      }
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
}
