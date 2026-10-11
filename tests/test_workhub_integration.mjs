import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { visibleModules, renderGate } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { AuthContext } from '../apps/main/src/lib/AuthContext.jsx'
  import WorkhubPage from '../apps/main/src/pages/WorkhubPage.jsx'
  export { visibleModules } from '../apps/main/src/lib/modules.js'
  export function renderGate(value) { return renderToStaticMarkup(<AuthContext.Provider value={value}><WorkhubPage /></AuthContext.Provider>) }
`, { env: { MODE: 'test', VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' } })
let failures = 0
function test(name, fn) { try { fn(); console.log('  ✓ ' + name) } catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.message) } }
test('신축 메뉴·라우트는 슈퍼관리자만 대상이며 기존 공개 메뉴를 유지한다', () => {
  for (const role of ['teacher', 'department_head', 'admin']) {
    const modules = visibleModules({ id: 't', role, is_active: true })
    assert(!modules.some(module => module.key === 'workhub'))
    assert(modules.some(module => module.key === 'doc-ai'))
    assert(modules.some(module => module.key === 'submissions'))
  }
  assert(visibleModules({ id: 's', role: 'superadmin', is_active: true }).some(module => module.key === 'workhub'))
})
test('실제 신축 진입은 세션·프로필 동일 계정과 명시적 승인까지 요구한다', () => {
  const base = { session: { user: { id: 's' } }, profile: { id: 's', role: 'superadmin', is_active: true }, profileLoading: false, profileError: null }
  for (const override of [{ session: null }, { profile: { ...base.profile, id: 'previous' } }, { profile: { ...base.profile, is_active: null } }, { profile: { ...base.profile, role: 'admin' } }, { profileError: new Error('network') }]) {
    assert(renderGate({ ...base, ...override }).includes('현재 계정으로 신축 시험 화면을 이용할 수 없습니다'))
  }
  assert(renderGate({ ...base, profileLoading: true }).includes('계정 확인 중'))
})
test('실제 연결 번들에는 합성 계정·학생·실패 조작 도구가 섞이지 않는다', () => {
  const result = buildSync({ entryPoints: [fileURLToPath(new URL('../apps/workhub/src/app/ConnectedWorkspace.tsx', import.meta.url))], bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  const code = result.outputFiles.map(file => file.text).join('\n')
  for (const forbidden of ['fixture-school-gaon', 'fixture-event-morning', 'gaon-soyeon', 'synthetic-students-v1', 'workhub:synthetic:v2:']) assert(!code.includes(forbidden), forbidden)
})
test('기존 회원을 삭제·재가입하는 복구 경로와 별도 인증 클라이언트를 만들지 않는다', () => {
  const file = readFileSync(new URL('../apps/workhub/src/connection/legacy-client.ts', import.meta.url), 'utf8')
  assert(file.includes("from '@daedong/shared'"))
  assert(!/createClient\s*\(/.test(file))
  assert(!/\.from\(['"]users['"]\)/.test(file))
  const gate = readFileSync(new URL('../apps/main/src/pages/WorkhubPage.jsx', import.meta.url), 'utf8')
  assert(gate.includes('useAuth()'))
})
if (failures) process.exitCode = 1
