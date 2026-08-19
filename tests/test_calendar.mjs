// 학사일정(official) + 공유 캘린더(shared) — 006_calendar.
//
// 이 파일이 지키는 가장 중요한 것:
//   **파생 계산(시수·수업일수)의 원천은 official 뿐이다.**
//   shared 는 교사들이 자유롭게 쓰는 칸이라, 거기 무엇을 적어도 시수가 흔들리면 안 된다.
//
// 그 밖에: 월간 격자, soft delete·복구, 라벨 자동완성, RLS 정책(정적 대조),
//          그리고 정책을 그대로 흉내 낸 가짜 클라이언트로 돌린 CRUD 흐름.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL = readFileSync(join(ROOT, 'migrations/006_calendar.sql'), 'utf-8')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

const work = mkdtempSync(join(tmpdir(), 'cal-'))
const entry = join(ROOT, 'tests', '.cal-entry.jsx')
writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server'
import CalendarPage from '../apps/main/src/pages/CalendarPage.jsx'
import * as cal from '../apps/main/src/lib/calendar.js'
export { renderToStaticMarkup, CalendarPage, cal }
`)
const bundle = join(work, 'b.cjs')
try {
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
    '--loader:.jsx=jsx',
    '--define:import.meta.env={"MODE":"test","VITE_SUPABASE_URL":"http://x","VITE_SUPABASE_ANON_KEY":"k"}',
    `--outfile=${bundle}`, '--log-level=error',
  ])
} finally {
  rmSync(entry, { force: true })
}
const { cal } = await import(bundle)

const ev = (o) => ({
  id: o.id || Math.random().toString(36).slice(2),
  scope: 'shared', title: '일정', event_type: '기타', labels: [],
  start_date: '2026-09-10', end_date: '2026-09-10', grades: [1, 2, 3],
  no_class: false, deleted_at: null, ...o,
})

console.log('\n[파생 계산의 원천은 official 뿐]')
ck('shared 의 no_class 는 세지 않는다', () => {
  const rows = [
    ev({ scope: 'official', no_class: true, start_date: '2026-10-09', end_date: '2026-10-09' }),
    // 교사가 공유 칸에 "체험학습" 을 적고 수업 없음처럼 표시해도 시수는 그대로다
    ev({ scope: 'shared', no_class: true, start_date: '2026-10-12', end_date: '2026-10-12' }),
  ]
  const days = cal.noClassDates(rows)
  A(days.has('2026-10-09'), 'official 이 안 세짐')
  A(!days.has('2026-10-12'), 'shared 가 시수 계산에 섞였다 — 이 경계가 무너지면 시수가 흔들린다')
})
ck('officialOnly 가 shared·삭제분을 걸러낸다', () => {
  const rows = [
    ev({ scope: 'official' }),
    ev({ scope: 'shared' }),
    ev({ scope: 'official', deleted_at: '2026-09-01T00:00:00Z' }),
  ]
  A(cal.officialOnly(rows).length === 1, `${cal.officialOnly(rows).length}건`)
})
ck('기간 일정은 날짜를 모두 편다', () => {
  const days = cal.noClassDates([
    ev({ scope: 'official', no_class: true, start_date: '2026-09-24', end_date: '2026-09-26' }),
  ])
  A(days.size === 3 && days.has('2026-09-25'), [...days].join(','))
})
ck('삭제된 official 은 세지 않는다', () => {
  const days = cal.noClassDates([
    ev({ scope: 'official', no_class: true, deleted_at: '2026-09-01T00:00:00Z' }),
  ])
  A(days.size === 0, [...days].join(','))
})
ck('입력이 깨져도 죽지 않는다', () => {
  A(cal.noClassDates(null).size === 0, 'null')
  A(cal.eachDate('말도안됨', 'x').length === 0, '잘못된 날짜')
  A(cal.eachDate('2026-09-10', '2026-09-01').length === 0, '역순 기간')
})

ck('시간대 때문에 날짜가 밀리지 않는다 (KST)', () => {
  // toISOString() 을 쓰면 KST 자정이 UTC 전날 15시가 되어 하루씩 밀린다
  A(cal.iso(new Date(2026, 9, 9)) === '2026-10-09', cal.iso(new Date(2026, 9, 9)))
  A(cal.eachDate('2026-10-09', '2026-10-09')[0] === '2026-10-09', cal.eachDate('2026-10-09', '2026-10-09')[0])
  const g = cal.monthGrid([], 2026, 10).flat().filter((d) => d.inMonth)
  A(g[0].date === '2026-10-01' && g.at(-1).date === '2026-10-31', `${g[0].date} ~ ${g.at(-1).date}`)
})

console.log('\n[shared 에는 no_class 를 아예 못 쓴다]')
ck('validate 가 막는다', () => {
  A(cal.validate(ev({ scope: 'shared', no_class: true }))?.includes('학사일정에만'), '통과됨')
  A(cal.validate(ev({ scope: 'official', no_class: true })) === null, 'official 이 막힘')
})
ck('저장 직전에도 강제로 false (화면을 우회해도)', () => {
  const src = readFileSync(join(ROOT, 'apps/main/src/lib/calendar.js'), 'utf-8')
  const hits = src.match(/no_class:\s*ev\.scope === 'official'|no_class:\s*patch\.scope === 'official'/g) || []
  A(hits.length === 2, `create·update 두 곳이어야 하는데 ${hits.length}곳`)
})
ck('UI 도 official 에서만 보여준다', () => {
  const page = readFileSync(join(ROOT, 'apps/main/src/pages/CalendarPage.jsx'), 'utf-8')
  A(page.includes("{editing.scope === 'official' && ("), 'no_class 체크박스가 조건 없이 보인다')
})

console.log('\n[검증 규칙]')
ck('제목·기간·학년', () => {
  A(cal.validate(ev({ title: '  ' }))?.includes('제목'), '빈 제목 통과')
  A(cal.validate(ev({ start_date: '2026-09-10', end_date: '2026-09-01' }))?.includes('종료일'), '역순 통과')
  A(cal.validate(ev({ grades: [] }))?.includes('학년'), '학년 없이 통과')
  A(cal.validate(ev({ event_type: '없는유형' }))?.includes('유형'), '이상한 유형 통과')
  A(cal.validate(ev({})) === null, '정상안이 막힘')
})

console.log('\n[월간 격자]')
const grid = cal.monthGrid([
  ev({ scope: 'official', title: '추석', start_date: '2026-09-24', end_date: '2026-09-26' }),
], 2026, 9)
ck('6주 × 7일', () => {
  A(grid.length === 6 && grid.every((w) => w.length === 7), '격자 모양이 아님')
})
ck('기간 일정이 걸치는 날마다 나온다', () => {
  const days = grid.flat().filter((d) => d.events.length)
  A(days.length === 3, `${days.length}일`)
  A(days.map((d) => d.date).join(',') === '2026-09-24,2026-09-25,2026-09-26', days.map((d) => d.date).join(','))
})
ck('앞뒤 달 칸은 inMonth=false', () => {
  const out = grid.flat().filter((d) => !d.inMonth)
  A(out.length > 0, '앞뒤 달 칸이 없음')
  A(grid.flat().filter((d) => d.inMonth).length === 30, '9월이 30일이 아님')
})

console.log('\n[라벨 자동완성 — 자유 입력 + 기존 라벨]')
ck('많이 쓴 라벨이 앞에 온다', () => {
  const rows = [
    ev({ labels: ['교무', '성적'] }), ev({ labels: ['교무'] }), ev({ labels: ['생활'] }),
    ev({ labels: ['교무'], deleted_at: 'x' }),   // 삭제분은 세지 않는다
  ]
  A(cal.knownLabels(rows).join(',') === '교무,생활,성적', cal.knownLabels(rows).join(','))
})

console.log('\n[RLS — official 은 admin 만, shared 는 승인 교사 전원]')
ck('official 쓰기는 is_admin() 을 요구한다', () => {
  A(/cal_official_insert[\s\S]*scope = 'official' AND public\.is_admin\(\)/.test(SQL), 'insert 정책 없음')
  A(/cal_official_update[\s\S]*scope = 'official' AND public\.is_admin\(\)/.test(SQL), 'update 정책 없음')
})
ck('shared 는 승인 교사 전원 (남의 일정도 편집)', () => {
  A(/cal_shared_update[\s\S]*scope = 'shared' AND public\.is_approved\(\)/.test(SQL), 'shared update 정책 없음')
  A(!/cal_shared_update[\s\S]*created_by = auth\.uid/.test(SQL), 'shared 를 작성자로 제한하고 있다')
})
ck('물리 DELETE 정책이 없다 (soft delete 만)', () => {
  A(!/FOR DELETE/.test(SQL), '삭제 경로가 열려 있음')
  A(SQL.includes('deleted_at'), 'soft delete 칼럼 없음')
})
ck('anon 차단 · 조회는 승인자만', () => {
  A(/REVOKE ALL ON public\.calendar_events\s+FROM anon/.test(SQL), 'anon REVOKE 없음')
  A(/cal_select[\s\S]*public\.is_approved\(\)/.test(SQL), '조회 게이트 없음')
})

console.log('\n[E2E — 정책을 흉내 낸 가짜 저장소로 흐름 확인]')
// ⚠ 실제 DB 가 아니다. RLS 규칙을 그대로 옮겨 적은 모형으로 흐름만 본다.
//   진짜 거부는 배포 후 계란님이 두 계정으로 확인해야 한다 (보고서에 적었다).
function fakeStore() {
  const rows = []
  const allow = (role, scope) => (scope === 'official' ? ['admin', 'superadmin'].includes(role) : true)
  return {
    rows,
    insert(user, e) {
      if (!allow(user.role, e.scope)) return { error: new Error('RLS: new row violates policy') }
      rows.push({ ...e, id: `e${rows.length + 1}`, created_by: user.id, deleted_at: null })
      return { error: null }
    },
    update(user, id, patch) {
      const r = rows.find((x) => x.id === id)
      if (!r) return { error: new Error('없는 행') }
      if (!allow(user.role, r.scope)) return { error: new Error('RLS: 수정 권한 없음') }
      Object.assign(r, patch, { updated_by: user.id })
      return { error: null }
    },
  }
}
const admin = { id: 'a1', role: 'admin' }
const teacher = { id: 't1', role: 'teacher' }
const store = fakeStore()

ck('official 생성 (admin)', () => {
  A(!store.insert(admin, ev({ scope: 'official', title: '개교기념일', no_class: true })).error, '거부됨')
})
ck('official 생성 시도 → 일반 교사는 거부', () => {
  const { error } = store.insert(teacher, ev({ scope: 'official', title: '몰래 추가' }))
  A(error, '일반 교사가 학사일정을 만들 수 있다')
  A(store.rows.length === 1, `행이 늘었다: ${store.rows.length}`)
})
ck('shared 생성 (교사)', () => {
  A(!store.insert(teacher, ev({ scope: 'shared', title: '학년 협의회' })).error, '거부됨')
})
ck('shared 수정 — 남의 일정도 (구글시트 은유)', () => {
  const id = store.rows.find((r) => r.scope === 'shared').id
  const other = { id: 't2', role: 'teacher' }
  A(!store.update(other, id, { title: '학년 협의회(장소 변경)' }).error, '거부됨')
  const row = store.rows.find((r) => r.id === id)
  A(row.title.includes('장소 변경') && row.updated_by === 't2', JSON.stringify(row))
})
ck('official 수정 시도 → 일반 교사는 거부', () => {
  const id = store.rows.find((r) => r.scope === 'official').id
  A(store.update(teacher, id, { title: '바꿔치기' }).error, '일반 교사가 학사일정을 고칠 수 있다')
})
ck('soft delete → 목록에서 사라지고 휴지통에 남는다', () => {
  const id = store.rows.find((r) => r.scope === 'shared').id
  store.update(teacher, id, { deleted_at: '2026-09-01T00:00:00Z' })
  A(cal.alive(store.rows).every((r) => r.id !== id), '목록에 아직 있다')
  A(cal.deletedOnly(store.rows).some((r) => r.id === id), '휴지통에 없다')
})
ck('복구 → 목록으로 돌아온다', () => {
  const id = cal.deletedOnly(store.rows)[0].id
  store.update(admin, id, { deleted_at: null })
  A(cal.alive(store.rows).some((r) => r.id === id), '복구 안 됨')
  A(cal.deletedOnly(store.rows).length === 0, '휴지통에 남아 있다')
})
ck('삭제된 official 은 그동안 시수 계산에서도 빠져 있었다', () => {
  const rows = [ev({ scope: 'official', no_class: true, deleted_at: 'x' })]
  A(cal.noClassDates(rows).size === 0, '삭제분이 시수에 남았다')
})

console.log('\n[화면]')
const page = readFileSync(join(ROOT, 'apps/main/src/pages/CalendarPage.jsx'), 'utf-8')
ck('공식/공유를 색 + 아이콘 둘 다로 가른다', () => {
  A(page.includes('SCOPE_ICON[ev.scope]'), '아이콘 표기 없음')
  A(page.includes('`cal-chip ${ev.scope}`'), '색 구분 없음')
  const css = readFileSync(join(ROOT, 'apps/main/src/styles.css'), 'utf-8')
  A(css.includes('.cal-chip.official') && css.includes('.cal-chip.shared'), 'CSS 구분 없음')
})
ck('월간·목록·휴지통 세 뷰', () => {
  for (const v of ["'month'", "'list'", "'trash'"]) A(page.includes(v), `뷰 없음: ${v}`)
  A(page.includes('isAdmin ? [[\'trash\''), '휴지통이 admin 전용이 아님')
})
ck('삭제는 한 번 묻고 복구 가능함을 알린다', () => {
  A(page.includes('window.confirm'), '확인 없음')
  A(page.includes('휴지통에서 되돌릴 수 있습니다'), '복구 안내 없음')
})
ck('메뉴·라우트 등록', () => {
  const layout = readFileSync(join(ROOT, 'apps/main/src/components/Layout.jsx'), 'utf-8')
  A(layout.includes("to: '/calendar', label: '학사일정·캘린더'"), '메뉴 없음')
  const app = readFileSync(join(ROOT, 'apps/main/src/App.jsx'), 'utf-8')
  A(app.includes('path="calendar"'), '라우트 없음')
})

console.log('\n[시드 스크립트 — 자산에 있는 것만]')
const seed = execFileSync('node', [join(ROOT, 'scripts/seed-calendar-2026-2.mjs')], { encoding: 'utf-8' })
const C = JSON.parse(readFileSync(join(ROOT, 'apps/main/api/doc-ai/_assets/school-constants-2026-2.json'), 'utf-8'))
ck('학기 경계·공휴일·고사가 들어간다', () => {
  for (const s of ['2학기 개학', '추석 연휴', '개교기념일', '체육대회', '2학년 1회 정기시험', '3학년 정기시험']) {
    A(seed.includes(s), `누락: ${s}`)
  }
  A(seed.includes(C.semester_start) && seed.includes(C.semester_end), '학기 경계 날짜 없음')
})
ck('텍스트 배열이 깨지지 않는다', () => {
  A(seed.includes("ARRAY['공휴일']::text[]"), '라벨 배열 표기 오류')
  A(!/'\{'/.test(seed), "'{' 로 시작하는 깨진 배열 리터럴")
})
ck('자산에 없는 날짜는 넣지 않는다', () => {
  for (const s of ['방학', '재량휴업']) {
    A(!new RegExp(`'${s}[^']*'`).test(seed), `지어낸 일정이 있다: ${s}`)
  }
})
ck('여러 번 실행해도 같은 결과 (DELETE 후 INSERT)', () => {
  A(seed.includes("DELETE FROM public.calendar_events WHERE term_id = v_term AND scope = 'official'"), '멱등성 없음')
  A(!seed.includes("scope = 'shared'"), '공유 일정까지 지운다')
})
ck('근거를 주석으로 남긴다', () => {
  A(seed.includes('-- 근거: exam_schedule.grade3'), '근거 주석 없음')
  A(seed.includes('-- 근거: 10월 note'), '근거 주석 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
