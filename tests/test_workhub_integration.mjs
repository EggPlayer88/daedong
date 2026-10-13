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
  for (const override of [{ session: null }, { profile: { ...base.profile, id: 'previous' } }, { profile: { ...base.profile, is_active: null } }, ...['teacher', 'department_head', 'admin'].map(role => ({ profile: { ...base.profile, role } })), { profile: { ...base.profile, is_active: false } }, { profileError: new Error('network') }]) {
    assert(renderGate({ ...base, ...override }).includes('현재 계정으로 신축 시험 화면을 이용할 수 없습니다'))
  }
  assert(renderGate({ ...base, profileLoading: true }).includes('계정 확인 중'))
})
test('기존 앱 첫 청크는 작은 이벤트 전달기만 포함하고 신축 탐색·화면은 지연 로딩한다', () => {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('../apps/main/src/pages/WorkhubPage.jsx', import.meta.url))],
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', splitting: true,
    outdir: 'workhub-integration-test', metafile: true, jsx: 'automatic', loader: { '.css': 'text' },
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' }), 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  const outputs = result.metafile.outputs
  const entry = Object.keys(outputs).find(path => outputs[path].entryPoint?.endsWith('/WorkhubPage.jsx'))
  assert(entry, '신축 진입 화면의 청크가 없다')
  const initial = new Set()
  function visit(path) {
    if (initial.has(path) || !outputs[path]) return
    initial.add(path)
    for (const imported of outputs[path].imports) if (imported.kind !== 'dynamic-import') visit(imported.path)
  }
  visit(entry)
  const initialInputs = [...initial].flatMap(path => Object.keys(outputs[path].inputs))
  assert(initialInputs.some(path => path.endsWith('/navigation-bridge.ts')))
  // 이 검사에서는 CSS를 텍스트로 읽으므로 글꼴의 정적 import 경계도 원본 그래프에서 확인한다.
  const initialSources = new Set()
  function visitSource(path) {
    if (initialSources.has(path) || !result.metafile.inputs[path]) return
    initialSources.add(path)
    for (const imported of result.metafile.inputs[path].imports) if (imported.kind !== 'dynamic-import' && !imported.external) visitSource(imported.path)
  }
  visitSource(outputs[entry].entryPoint)
  assert(![...initialSources].some(path => path.endsWith('/typography.css')))
  for (const suffix of ['/navigation.ts', '/ConnectedWorkspace.tsx']) {
    assert(!initialInputs.some(path => path.endsWith(suffix)), `첫 청크에 신축 구현 포함: ${suffix}`)
  }
  assert(Object.keys(outputs).some(path => !initial.has(path) && Object.keys(outputs[path].inputs).some(input => input.endsWith('/navigation.ts'))))
})
test('실제 연결 번들에는 합성 계정·학생·실패 조작 도구가 섞이지 않는다', () => {
  const result = buildSync({ entryPoints: [fileURLToPath(new URL('../apps/workhub/src/app/ConnectedWorkspace.tsx', import.meta.url))], bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  const code = result.outputFiles.map(file => file.text).join('\n')
  for (const forbidden of ['fixture-school-gaon', 'fixture-event-morning', 'gaon-soyeon', 'synthetic-students-v1', 'workhub:synthetic:v2:', 'workhub:synthetic:v3:']) assert(!code.includes(forbidden), forbidden)
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
