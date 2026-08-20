// 수업일수·시수 파생 (모듈 C-2) — 캘린더가 계산의 원천이다.
//
// 여기서 고정하는 것:
//   · 파생의 원천은 **official 뿐**이다 (shared 는 시수를 흔들지 못한다)
//   · 산식이 기존 고정표를 **재현**한다 — 감산 규칙을 캘린더에 반영하면 자산과 같은 값
//   · 자산과 캘린더 파생값의 차이는 **기록된 것뿐**이다 (새 차이 → 실패 = stale 검출)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as sd from '../apps/main/src/lib/school-days.js'
import { EVENTS, TERM } from '../scripts/_calendar-events.mjs'
import { buildAsset, diffAgainst, minWeeksFrom } from '../scripts/build-fixed-hours.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'apps/main/api/doc-ai/_assets')
const ASSET = JSON.parse(readFileSync(join(ASSETS, 'fixed-hours-2026-2.json'), 'utf-8'))
const C = JSON.parse(readFileSync(join(ASSETS, 'school-constants-2026-2.json'), 'utf-8'))

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

console.log('\n[날짜 기본기]')
ck('iso 는 지역 시간 기준 — UTC 변환으로 하루 밀리지 않는다', () => {
  A(sd.iso(new Date(2026, 7, 14)) === '2026-08-14', sd.iso(new Date(2026, 7, 14)))
  A(sd.iso(new Date(2027, 0, 1)) === '2027-01-01', sd.iso(new Date(2027, 0, 1)))
  A(sd.iso('2026-09-01') === '2026-09-01', '문자열 통과 실패')
  A(sd.iso(new Date('없는날짜')) === '', 'NaN 이 문자열로 샌다')
})
ck('평일 판정 — 토·일은 수업일 후보가 아니다', () => {
  A(sd.isWeekday('2026-08-14'), '금요일이 평일이 아니라 함')   // 금
  A(!sd.isWeekday('2026-08-15'), '토요일이 평일이라 함')       // 토
  A(!sd.isWeekday('2026-08-16'), '일요일이 평일이라 함')       // 일
  A(sd.isWeekday('2026-08-17'), '월요일이 평일이 아니라 함')   // 월
})
ck('기간 펼치기 — 양 끝 포함, 역순은 빈 배열', () => {
  A(sd.eachDate('2026-09-24', '2026-09-26').length === 3, '3일이 아님')
  A(sd.eachDate('2026-09-26', '2026-09-24').length === 0, '역순이 통과')
  A(sd.eachDate('2026-10-31', '2026-11-01').join() === '2026-10-31,2026-11-01', '월 경계')
})

console.log('\n[원천은 official 뿐 — C-1 경계 그대로]')
const term = { start_date: '2026-08-14', end_date: '2026-08-21' } // 평일 6일 (14,17,18,19,20,21)
const base = [{ scope: 'official', title: '개학', start_date: '2026-08-14', end_date: '2026-08-14' }]
ck('평일만 센다', () => {
  A(sd.classDates(base, term).length === 6, String(sd.classDates(base, term).length))
})
ck('official·no_class 는 수업일에서 빠진다', () => {
  const rows = [...base, { scope: 'official', title: '대체휴일', start_date: '2026-08-17', end_date: '2026-08-17', no_class: true }]
  A(sd.classDates(rows, term).length === 5, '안 빠졌다')
  A(!sd.classDates(rows, term).includes('2026-08-17'), '그날이 남아 있다')
})
ck('shared 는 no_class 여도 시수를 흔들지 못한다', () => {
  const rows = [...base, { scope: 'shared', title: '학년 체험학습', start_date: '2026-08-18', end_date: '2026-08-19', no_class: true }]
  A(sd.classDates(rows, term).length === 6, 'shared 가 수업일을 깎았다')
  A(sd.noClassDates(rows).size === 0, 'shared 가 no_class 집합에 들어왔다')
})
ck('삭제된(soft delete) official 도 무시한다', () => {
  const rows = [...base, { scope: 'official', title: '취소된 휴업', start_date: '2026-08-18', end_date: '2026-08-18', no_class: true, deleted_at: '2026-08-01T00:00:00Z' }]
  A(sd.classDates(rows, term).length === 6, '지운 일정이 아직 깎는다')
})
ck('학기 밖 날짜는 세지 않는다', () => {
  const rows = [...base, { scope: 'official', title: '방학중', start_date: '2026-07-01', end_date: '2026-07-31', no_class: true }]
  A(sd.classDates(rows, term).length === 6, '학기 밖이 영향을 줬다')
})

console.log('\n[5행 고정 + 1월 흡수]')
ck('표는 학기 시작 월부터 5행', () => {
  A(sd.monthRows(TERM).join() === '2026-08,2026-09,2026-10,2026-11,2026-12', sd.monthRows(TERM).join())
  A(sd.MONTH_ROWS === 5, String(sd.MONTH_ROWS))
})
ck('1월 수업일은 12월 행에 흡수된다 (6번째 행을 만들지 않는다)', () => {
  const t = sd.monthlyClassDays(EVENTS, TERM)
  A(t.length === 5, `행이 ${t.length}개`)
  A(t.map((m) => m.label).join() === '8월,9월,10월,11월,12월', t.map((m) => m.label).join())
  const dec = t[4]
  A(dec.absorbed.length === 1 && dec.absorbed[0].label === '1월', JSON.stringify(dec.absorbed))
  // 흡수한 만큼 실제로 더해졌는지 — 합계가 새면 누계가 통째로 틀어진다
  const jan = dec.dates.filter((d) => d.startsWith('2027-01')).length
  A(jan === dec.absorbed[0].days, `${jan} ≠ ${dec.absorbed[0].days}`)
})
ck('총 수업일 = 5행 합계 (흡수분 포함, 새는 날이 없다)', () => {
  const t = sd.hoursTable(EVENTS, TERM)
  A(t.total_class_days === sd.classDates(EVENTS, TERM).length, '합계가 다르다')
})

console.log('\n[산식 — 누계 = ⌊주당시수 × 누적 수업일 ÷ 5⌋]')
ck('딱 떨어지는 경우', () => {
  // 매달 5일(=1주) × 주당 4시간 → 매달 4시간, 누계 4·8·12·16·20
  const r = sd.hoursRow([5, 5, 5, 5, 5], 4)
  A(r.months.join() === '4/4,4/8,4/12,4/16,4/20', r.months.join())
  A(r.total === 20, String(r.total))
})
ck('소수는 버리지 않고 다음 달로 넘어간다', () => {
  // 11일 → 8.8시간. 8 을 표시하고 0.8 은 다음 달로
  const r = sd.hoursRow([11, 20], 4)
  A(r.months.join() === '8/8,16/24', r.months.join())
  A(r.hours[0] + r.hours[1] === 24, '합이 안 맞는다')
})
ck('총합은 언제나 ⌊주당 × 총수업일 ÷ 5⌋ — 이월분이 사라지지 않는다', () => {
  for (const w of sd.WEEKLY_RANGE) {
    const days = [11, 20, 20, 20, 19]
    const sum = days.reduce((a, b) => a + b, 0)
    const r = sd.hoursRow(days, w)
    A(r.total === Math.floor((w * sum) / 5), `주당 ${w}: ${r.total} ≠ ${Math.floor((w * sum) / 5)}`)
    A(r.hours.reduce((a, b) => a + b, 0) === r.total, `주당 ${w}: 월 합계 ≠ 누계 끝`)
  }
})
ck('최소 기준(주당 × 17)은 자산 문장에서 읽는다 — 코드에 박지 않는다', () => {
  A(minWeeksFrom(C) === 17, String(minWeeksFrom(C)))
  A(sd.hoursRow([11, 20, 20, 20, 19], 4).min_required === 68, '68 이 아님')
  A(sd.hoursRow([11, 20, 20, 20, 19], 4).ok === true, '72 가 68 미달로 판정')
  A(sd.hoursRow([5, 5, 5, 5, 5], 4).ok === false, '20 이 68 이상으로 판정')
})

console.log('\n[재현 — 고정표의 감산 규칙을 캘린더에 반영하면 자산과 같은 값]')
// 자산이 assumptions 에 "감산(교과수업 0)" 으로 적어 둔 날들.
// 이 세 가지를 캘린더에 no_class 로 표시하면 파생값이 자산과 **정확히** 일치해야 한다.
// 일치하지 않으면 둘 중 하나다 — 산식이 틀렸거나, 자산이 손으로 고쳐졌거나.
const RECONCILE = [
  ['철쭉제', '자산 assumptions: 감산(교과수업 0) — 12/22~24'],
  ['종업식·졸업식', '자산 assumptions: 감산(교과수업 0) — 1/4'],
]
const EXTRA_HOLIDAY = {
  scope: 'official', title: '신정', event_type: '휴업일',
  start_date: '2027-01-01', end_date: '2027-01-01', no_class: true,
}
function reconciled() {
  const rows = EVENTS.map((e) => ({ ...e }))
  for (const [title] of RECONCILE) {
    const r = rows.find((x) => x.title === title)
    if (r) r.no_class = true
  }
  rows.push(EXTRA_HOLIDAY) // school-constants 에 없어 시드에 빠진 공휴일
  return rows
}
ck('산식이 기존 고정표를 그대로 재현한다 (5행 × 주당 1~5 전부)', () => {
  const t = sd.hoursTable(reconciled(), TERM)
  for (const w of sd.WEEKLY_RANGE) {
    const got = t.variants[String(w)].months.join(', ')
    const want = ASSET.variants.common[String(w)].months.join(', ')
    A(got === want, `주당 ${w}: ${got} ≠ 자산 ${want}`)
  }
})
ck('재현 조건의 수업일수도 자산 가정과 맞는다 (12월 19일)', () => {
  const t = sd.monthlyClassDays(reconciled(), TERM)
  A(t[4].days === 19, `12월 ${t[4].days}일`)
  A(t.reduce((a, m) => a + m.days, 0) === 90, '총 90일이 아님')
})

console.log('\n[대조 — 자산 stale 검출]')
// 캘린더를 **있는 그대로** 파생한 값과 자산의 차이.
// 지금 알려진 차이는 12월 행뿐이고 원인이 밝혀져 있다 (위 재현 참조).
// 여기 없는 차이가 새로 생기면 = 캘린더나 자산 한쪽이 움직인 것 → 실패한다.
const KNOWN_DIFF = {
  months: ['12월'],
  reason:
    '캘린더에 아직 반영되지 않은 것 3가지 — 철쭉제 no_class, 종업식 no_class, 신정(1/1) 일정 자체. ' +
    '어느 쪽이 맞는지는 계란님 판정 사항 (감산은 학교 관행이지 산식이 아니다).',
}
const derived = buildAsset(
  { rows: EVENTS, term: TERM, origin: 'seed', note: '테스트' },
  C,
  '테스트'
)
ck('차이는 기록된 달에서만 난다 (새 차이가 생기면 실패)', () => {
  const d = diffAgainst(ASSET, derived)
  const months = [...new Set(d.map((x) => x.month))].sort()
  A(
    months.join() === KNOWN_DIFF.months.join(),
    `기록되지 않은 차이: ${months.join(', ')} (기록: ${KNOWN_DIFF.months.join(', ')})\n      ${KNOWN_DIFF.reason}`
  )
})
ck('기록된 차이가 사라졌으면 그것도 알려야 한다 (기록이 낡음)', () => {
  const d = diffAgainst(ASSET, derived)
  A(
    d.length > 0,
    'KNOWN_DIFF 가 남아 있는데 차이가 없다 — 캘린더가 갱신됐다면 KNOWN_DIFF 를 지우고 자산을 --write 로 다시 생성할 차례다'
  )
  A(d.length === sd.WEEKLY_RANGE.length, `주당 1~5 전부여야 하는데 ${d.length}칸`)
})
ck('월별 수업일수 — 자산(school-constants)과 대조', () => {
  const got = new Map(derived.source.monthly_class_days.map((m) => [m.month, m.days]))
  const want = new Map((C.monthly_class_days || []).map((m) => [m.month, m.days]))
  // 8·9·11월은 같아야 한다. 10월은 체육대회(no_class) 만큼 파생이 1 적다 —
  // school-constants 는 "수업일수 포함·교과수업 없음" 이라 출석 기준으로 세었다
  for (const m of ['8월', '9월', '11월']) A(got.get(m) === want.get(m), `${m}: ${got.get(m)} ≠ ${want.get(m)}`)
  A(got.get('10월') === want.get('10월') - 1, `10월: ${got.get('10월')} vs ${want.get('10월')}`)
})

console.log('\n[생성 자산의 모양 — doc-ai 파이프라인 무변경]')
ck('doc-ai 가 읽는 키가 그대로 있다', () => {
  A(Array.isArray(derived.months) && derived.months.length === 5, 'months 5개가 아님')
  A(derived.default_variant === 'common', derived.default_variant)
  const row = derived.variants[derived.default_variant]
  A(row, 'default_variant 가 가리키는 표가 없다')
  for (const w of sd.WEEKLY_RANGE) {
    const r = row[String(w)]
    A(r && Array.isArray(r.months) && r.months.length === 5, `주당 ${w} 행이 없다`)
    A(typeof r.total === 'number' && typeof r.min_required === 'number' && typeof r.ok === 'boolean', `주당 ${w} 필드 누락`)
    A(r.months.every((s) => /^\d+\/\d+$/.test(s)), `주당 ${w}: '시수/누계' 형식이 아님`)
  }
})
ck('기존 자산과 키 구성이 같다 (갈아끼워도 파이프라인이 안 깨진다)', () => {
  for (const k of ['months', 'default_variant', 'variants', 'generated', 'algorithm']) {
    A(k in derived, `${k} 없음`)
    A(k in ASSET, `기존 자산에 ${k} 없음`)
  }
  const oldRow = ASSET.variants[ASSET.default_variant]['4']
  const newRow = derived.variants.common['4']
  A(Object.keys(newRow).sort().join() === Object.keys(oldRow).sort().join(), `${Object.keys(newRow)} ≠ ${Object.keys(oldRow)}`)
})
ck('어느 날짜에서 나온 표인지 근거가 함께 남는다', () => {
  A(derived.source.term.start_date === TERM.start_date, '학기 기간이 안 남음')
  A(derived.source.no_class.length > 0, 'no_class 내역이 안 남음')
  A(derived.source.total_class_days > 0, '총 수업일이 안 남음')
  A(derived.source.origin === 'seed', derived.source.origin)
  // 남긴 근거만으로 표를 다시 만들 수 있어야 한다
  const days = derived.source.monthly_class_days.map((m) => m.days)
  A(sd.hoursRow(days, 4, derived.source.min_weeks).months.join() === derived.variants.common['4'].months.join(), '근거로 재현 불가')
})

console.log('\n[no_class 내역 — 눈으로 검증할 수 있게]')
ck('주말만 걸친 휴일은 0일로 표시된다 (수업일수에 영향 없음)', () => {
  const b = sd.noClassBreakdown(EVENTS, TERM)
  const 광복절 = b.find((x) => x.title === '광복절')
  A(광복절 && 광복절.weekdays === 0, `${광복절?.weekdays}`)
  const 추석 = b.find((x) => x.title === '추석 연휴')
  A(추석 && 추석.weekdays === 2, `추석 ${추석?.weekdays}일 (9/26 은 토요일)`)
})
ck('날짜순으로 정렬돼 있다', () => {
  const b = sd.noClassBreakdown(EVENTS, TERM)
  const sorted = [...b].sort((x, y) => x.start_date.localeCompare(y.start_date))
  A(b.map((x) => x.start_date).join() === sorted.map((x) => x.start_date).join(), '정렬 안 됨')
})
ck('no_class 가 아닌 일정은 목록에 없다 (고사·행사)', () => {
  const titles = sd.noClassBreakdown(EVENTS, TERM).map((x) => x.title)
  A(!titles.some((t) => t.includes('정기시험')), '고사가 수업일을 깎는다')
  A(!titles.includes('철쭉제'), '철쭉제가 no_class 로 들어가 있다 (시드는 false)')
})

console.log('\n[깨진 입력에도 죽지 않는다]')
ck('학기가 없으면 빈 표 — 예외를 던지지 않는다', () => {
  A(sd.monthlyClassDays(EVENTS, null).length === 0, '예외 대신 빈 배열이어야')
  A(sd.classDates(EVENTS, {}).length === 0, '학기 없이 날짜가 나온다')
  A(sd.hoursTable(EVENTS, null).months.length === 0, 'months 가 비어 있지 않다')
  A(sd.noClassBreakdown(EVENTS, null).length >= 0, 'breakdown 이 터진다')
})
ck('일정 배열 자리에 null·문자열이 와도 버틴다', () => {
  for (const bad of [null, undefined, 'rows', 42, {}]) {
    A(sd.noClassDates(bad).size === 0, `${bad} 에서 터짐`)
    A(sd.classDates(bad, TERM).length > 0, `${bad} 에서 수업일이 사라짐`)
  }
  A(sd.classDates([null, undefined, { scope: 'official' }], TERM).length > 0, '깨진 행에서 터짐')
})
ck('날짜가 비었거나 뒤집힌 일정은 무시한다', () => {
  const rows = [
    { scope: 'official', title: '날짜 없음', no_class: true },
    { scope: 'official', title: '뒤집힘', start_date: '2026-09-10', end_date: '2026-09-01', no_class: true },
  ]
  const full = sd.classDates(EVENTS, TERM).length
  A(sd.classDates([...EVENTS, ...rows], TERM).length === full, '이상한 일정이 수업일을 깎았다')
})
ck('주당 시수가 이상해도 표는 만들어진다', () => {
  A(sd.hoursRow([11, 20], 0).total === 0, '0 시간에서 터짐')
  A(sd.hoursRow([11, 20], '4').months.join() === '8/8,16/24', '문자열 숫자 처리')
  A(sd.hoursRow(null, 4).months.length === 0, 'null 일수에서 터짐')
})

console.log('\n[화면·시드 배선]')
ck('캘린더 화면에 수업일수·시수 뷰가 있다', () => {
  const page = readFileSync(join(ROOT, 'apps/main/src/pages/CalendarPage.jsx'), 'utf-8')
  A(page.includes("'hours'"), '뷰 전환에 hours 가 없다')
  A(page.includes('school-days.js'), '파생 함수를 안 쓴다')
  A(page.includes('noClassBreakdown'), 'no_class 목록을 병기하지 않는다')
})
ck('calendar.js 는 날짜 산식을 따로 갖지 않는다 (한 곳에서만)', () => {
  const src = readFileSync(join(ROOT, 'apps/main/src/lib/calendar.js'), 'utf-8')
  A(!/export function iso\(/.test(src), 'iso 가 두 곳에 있다')
  A(!/export function noClassDates\(/.test(src), 'noClassDates 가 두 곳에 있다')
  A(src.includes("from './school-days.js'"), 'school-days 를 안 본다')
})
ck('시드와 파생이 같은 일정 목록을 본다', () => {
  const seed = readFileSync(join(ROOT, 'scripts/seed-calendar-2026-2.mjs'), 'utf-8')
  A(seed.includes('_calendar-events.mjs'), '시드가 목록을 따로 들고 있다')
  A(!seed.includes("title: '체육대회'"), '시드에 일정이 아직 박혀 있다')
})
ck('생성기는 기본이 읽기 전용이다 (--write 없이는 자산을 안 건드린다)', () => {
  const gen = readFileSync(join(ROOT, 'scripts/build-fixed-hours.mjs'), 'utf-8')
  A(/arg\('--write'\)/.test(gen), '--write 게이트 없음')
  A(gen.indexOf("arg('--write')") < gen.indexOf('writeFileSync(HOURS_PATH'), '쓰기가 게이트 밖')
})

console.log('\n[화면이 실제로 그려지는가]')
// ⚠ 여기서 볼 수 있는 것은 "탭이 있고 페이지가 안 죽는다" 까지다.
//    view 는 컴포넌트 내부 상태라 서버 렌더에서 'hours' 로 넘길 수 없다 —
//    표 자체의 값은 위 순수 함수 테스트가 지킨다.
{
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const work = mkdtempSync(join(tmpdir(), 'sd-'))
  // ⚠ 진입점은 repo 안에 둬야 한다 — tmpdir 에 두면 node_modules 를 못 찾는다
  const entry = join(ROOT, 'tests', '.sd-entry.jsx')
  writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import CalendarPage from '../apps/main/src/pages/CalendarPage.jsx'
import { AuthContext } from '../apps/main/src/lib/AuthContext.jsx'
export function render(profile) {
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session: { user: { id: 'u1' } }, profile, loading: false }}>
      <MemoryRouter><CalendarPage /></MemoryRouter>
    </AuthContext.Provider>
  )
}
`)
  const bundle = join(work, 'b.cjs')
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
      entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic', '--loader:.jsx=jsx',
      '--define:import.meta.env={"MODE":"test","VITE_SUPABASE_URL":"http://x","VITE_SUPABASE_ANON_KEY":"k"}',
      `--outfile=${bundle}`, '--log-level=error',
    ])
  } finally {
    rmSync(entry, { force: true })
  }
  const { render } = await import(bundle)
  const html = render({ id: 's', role: 'superadmin', is_active: true })
  ck('페이지가 그려지고 수업일수·시수 탭이 있다', () => {
    A(html.includes('수업일수·시수'), '탭이 없다')
    A(html.includes('학사일정 · 캘린더'), '페이지가 안 그려졌다')
  })
  ck('학기를 못 읽은 상태(초기 렌더)에서도 죽지 않는다', () => {
    // term 이 null 인 첫 렌더 — 파생 표는 계산하지 않고 넘어가야 한다
    A(html.length > 500, `렌더 결과가 너무 짧다: ${html.length}`)
  })
  rmSync(work, { recursive: true, force: true })
}

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
