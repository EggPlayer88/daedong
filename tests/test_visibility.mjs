// 모듈 공개 범위 — 개발 중 화면이 실사용자에게 보이지 않는다.
//
// 지키는 것:
//   · 메뉴 숨김 **과** 라우트 차단 둘 다 (숨김만으로는 주소를 아는 사람이 들어온다)
//   · 실사용 중인 화면(평가계획서·제출)은 **이전과 똑같이** 보인다
//   · 신규 모듈의 기본값은 superadmin — visibility 를 빼먹으면 안 보이는 쪽으로 실패한다
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

const work = mkdtempSync(join(tmpdir(), 'vis-'))
const entry = join(ROOT, 'tests', '.vis-entry.jsx')
// ⚠ 컴포넌트를 함수처럼 부르면 훅이 깨진다 — JSX 로 그리는 하네스를 번들 안에 둔다
writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '../apps/main/src/components/Layout.jsx'
import { AuthContext } from '../apps/main/src/lib/AuthContext.jsx'
import * as mods from '../apps/main/src/lib/modules.js'

/** 실제 라우터로 그린다 — 주소를 직접 쳤을 때 무엇이 보이는지 확인용 */
export function renderAt(profile, path) {
  const mods2 = mods.visibleModules(profile)
  const SCREENS = {
    dashboard: <div>대시보드 화면</div>,
    'doc-ai': <div>문서 작성 AI 화면</div>,
    submissions: <div>평가계획 제출 화면</div>,
    calendar: <div>학사일정 화면</div>,
    'admin-users': <div>사용자 관리 화면</div>,
  }
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session: { user: { id: profile?.id } }, profile, loading: false }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            {mods2.map((m) =>
              m.to === '/'
                ? <Route key={m.key} index element={SCREENS[m.key]} />
                : <Route key={m.key} path={m.to.slice(1)} element={SCREENS[m.key]} />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

export function renderNav(profile) {
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session: { user: { id: profile?.id } }, profile, loading: false }}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>본문</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}
export { mods }
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
const { mods, renderNav, renderAt } = await import(bundle)

const USERS = {
  teacher: { id: 't', name: '교사', role: 'teacher', is_active: true },
  head: { id: 'h', name: '부장', role: 'department_head', is_active: true },
  admin: { id: 'a', name: '관리자', role: 'admin', is_active: true },
  superadmin: { id: 's', name: '슈퍼', role: 'superadmin', is_active: true },
}

const nav = (profile) => renderNav(profile)

console.log('\n[메뉴 노출 — 역할별]')
ck('일반 교사: 평가계획서·제출은 보이고 캘린더는 안 보인다', () => {
  const html = nav(USERS.teacher)
  A(html.includes('문서 작성 AI'), '평가계획서 메뉴가 사라졌다 (실사용 중인 화면이다)')
  A(html.includes('평가계획 제출'), '제출 메뉴가 사라졌다')
  A(html.includes('대시보드'), '대시보드가 사라졌다')
  A(!html.includes('학사일정'), '개발 중인 캘린더가 교사에게 보인다')
  A(!html.includes('사용자 관리'), '관리 메뉴가 교사에게 보인다')
})
ck('부장교사도 캘린더는 안 보인다', () => {
  A(!nav(USERS.head).includes('학사일정'), '부장에게 보인다')
})
ck('관리자도 캘린더는 안 보인다 (당분간 superadmin 만)', () => {
  const html = nav(USERS.admin)
  A(html.includes('사용자 관리'), '관리자에게 사용자 관리가 안 보인다')
  A(!html.includes('학사일정'), 'admin 에게 캘린더가 보인다')
})
ck('슈퍼관리자만 캘린더가 보인다', () => {
  A(nav(USERS.superadmin).includes('학사일정'), 'superadmin 에게도 안 보인다')
})

console.log('\n[라우트 — URL 직접 접근 차단]')
ck('볼 수 없는 모듈은 라우트가 만들어지지 않는다', () => {
  for (const role of ['teacher', 'head', 'admin']) {
    const keys = mods.visibleModules(USERS[role]).map((m) => m.key)
    A(!keys.includes('calendar'), `${role} 에게 calendar 라우트가 생긴다`)
  }
  A(mods.visibleModules(USERS.superadmin).map((m) => m.key).includes('calendar'), 'superadmin 에게 없다')
})
ck('없는 주소는 대시보드로 되돌린다 (App 의 * 라우트)', () => {
  const app = readFileSync(join(ROOT, 'apps/main/src/App.jsx'), 'utf-8')
  A(app.includes('<Route path="*" element={<Navigate to="/" replace />} />'), '폴백 라우트 없음')
  // 라우트를 표에서 만든다 — 화면 목록을 손으로 또 적으면 한쪽만 바뀐다
  A(app.includes('visibleModules(profile)'), '라우트가 공개 범위를 안 본다')
  A(!/<Route path="calendar"/.test(app), '캘린더 라우트가 무조건 등록돼 있다')
})
// ⚠ <Navigate> 는 effect 로 움직여 서버 렌더에서는 관찰되지 않는다.
//    여기서 확인할 수 있는 것은 "막힌 화면이 그려지지 않는다" 까지다 —
//    실제 이동은 react-router 의 몫이고, 폴백 라우트가 있는지는 위에서 봤다.
ck('/calendar 직접 접근 — 교사에게 캘린더가 그려지지 않는다', () => {
  const html = renderAt(USERS.teacher, '/calendar')
  A(!html.includes('학사일정 화면'), '주소를 치면 캘린더가 열린다')
  // 다른 화면이 대신 새어 나오지도 않는다
  for (const leak of ['평가계획 제출 화면', '사용자 관리 화면']) {
    A(!html.includes(leak), `엉뚱한 화면이 그려짐: ${leak}`)
  }
})
ck('/calendar 직접 접근 — admin 도 튕긴다', () => {
  A(!renderAt(USERS.admin, '/calendar').includes('학사일정 화면'), 'admin 이 주소로 들어간다')
})
ck('/calendar 직접 접근 — superadmin 은 열린다', () => {
  A(renderAt(USERS.superadmin, '/calendar').includes('학사일정 화면'), 'superadmin 이 못 들어간다')
})
ck('실사용 화면은 주소로도 그대로 열린다', () => {
  A(renderAt(USERS.teacher, '/doc-ai').includes('문서 작성 AI 화면'), '평가계획서가 안 열린다')
  A(renderAt(USERS.teacher, '/submissions').includes('평가계획 제출 화면'), '제출이 안 열린다')
})
ck('없는 주소도 어떤 화면도 그리지 않는다', () => {
  const html = renderAt(USERS.teacher, '/없는주소')
  for (const screen of ['대시보드 화면', '문서 작성 AI 화면', '학사일정 화면']) {
    A(!html.includes(screen), `없는 주소에서 ${screen} 이 그려짐`)
  }
  // 메뉴(레이아웃)는 그대로 나온다 — 이동은 클라이언트에서 일어난다
  A(html.includes('평가계획 제출'), '레이아웃까지 사라졌다')
})
ck('메뉴와 라우트가 같은 표를 본다', () => {
  const layout = readFileSync(join(ROOT, 'apps/main/src/components/Layout.jsx'), 'utf-8')
  A(layout.includes('visibleModules(profile)'), '메뉴가 공개 범위를 안 본다')
  A(!layout.includes('const MENU = ['), '메뉴 목록이 따로 남아 있다')
})

console.log('\n[기본값 — 새 모듈은 안 보이는 쪽으로 실패한다]')
ck('visibility 를 빼먹으면 superadmin 전용', () => {
  A(mods.DEFAULT_VISIBILITY === 'superadmin', mods.DEFAULT_VISIBILITY)
  const anon = { key: 'x', to: '/x', label: '새 모듈' }   // visibility 없음
  A(!mods.isVisible(USERS.teacher, anon), '교사에게 보인다')
  A(!mods.isVisible(USERS.admin, anon), 'admin 에게 보인다')
  A(mods.isVisible(USERS.superadmin, anon), 'superadmin 에게도 안 보인다')
})
ck('프로필이 없으면(로그인 직후 등) 제한 모듈은 안 보인다', () => {
  A(!mods.isVisible(null, { key: 'c', visibility: 'superadmin' }), 'null 프로필에 보인다')
  A(!mods.isVisible(undefined, { key: 'c', visibility: 'admin' }), 'undefined 프로필에 보인다')
  A(mods.isVisible(null, { key: 'd', visibility: 'all' }), "'all' 이 막힌다")
})
ck('공개 범위 값이 세 가지뿐', () => {
  A(JSON.stringify(mods.VISIBILITY) === JSON.stringify(['all', 'admin', 'superadmin']), mods.VISIBILITY.join(','))
  for (const m of mods.MODULES) {
    A(!m.visibility || mods.VISIBILITY.includes(m.visibility), `${m.key}: ${m.visibility}`)
  }
})

console.log('\n[실사용 화면은 이전과 동일]')
ck('평가계획서·제출은 all (교사 포함 전원)', () => {
  for (const key of ['doc-ai', 'submissions', 'dashboard']) {
    const m = mods.MODULES.find((x) => x.key === key)
    A(m.visibility === 'all', `${key}: ${m.visibility}`)
    for (const role of Object.keys(USERS)) A(mods.isVisible(USERS[role], m), `${key} 가 ${role} 에게 안 보인다`)
  }
})
ck('사용자 관리는 예전 판정(admin+) 그대로', () => {
  const m = mods.MODULES.find((x) => x.key === 'admin-users')
  A(m.visibility === 'admin' && m.action === 'users.manage', JSON.stringify(m))
  A(!mods.isVisible(USERS.teacher, m) && !mods.isVisible(USERS.head, m), '하위 역할에 보인다')
  A(mods.isVisible(USERS.admin, m) && mods.isVisible(USERS.superadmin, m), 'admin+ 에게 안 보인다')
})
ck('모든 모듈에 화면이 연결돼 있다', () => {
  const app = readFileSync(join(ROOT, 'apps/main/src/App.jsx'), 'utf-8')
  for (const m of mods.MODULES) {
    A(new RegExp(`['"]?${m.key}['"]?:`).test(app), `SCREENS 에 ${m.key} 없음`)
  }
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
