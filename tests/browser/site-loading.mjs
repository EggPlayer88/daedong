// 실제 App·지연 import·라우트를 사용한다. 인증 상태와 자료만 합성하고 외부 요청은 차단한다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url)), origin = 'http://127.0.0.1:5196', outdir = join(root, '.tmp-site-loading-output')
const result = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './apps/main/src/App.jsx'; createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, sourcefile: 'entry.jsx', loader: 'jsx' }, jsx: 'automatic', bundle: true, write: false, splitting: true, format: 'esm', outdir, entryNames: 'entry', chunkNames: '[name]-[hash]', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-boundaries', setup(builder) {
  builder.onLoad({ filter: /lib[\\/]AuthContext\.jsx$/ }, () => ({ loader: 'jsx', contents: `import {createContext,useContext} from 'react'; export const AuthContext=createContext(null); export const useAuth=()=>useContext(AuthContext); export function AuthProvider({children}){const profile={id:'synthetic-user',name:'시험 교사',email:'teacher@example.invalid',role:'teacher',is_active:window.loadingConfig.active!==false};return <AuthContext.Provider value={{profile,session:{user:{id:profile.id},access_token:'synthetic'},isLoggedIn:true,loading:false,profileLoading:false,profileError:null}}>{children}</AuthContext.Provider>}` }))
  builder.onLoad({ filter: /site[\\/]SeasonalWorkProvider\.jsx$/ }, () => ({ loader: 'jsx', contents: `export function SeasonalWorkProvider({children}){return children} export const useSeasonalWork=()=>({state:{enabled:true},loading:false});` }))
  builder.onLoad({ filter: /lib[\\/]MessagingPilotContext\.jsx$/ }, () => ({ loader: 'jsx', contents: `export function MessagingPilotProvider({children}){return children} export const useMessagingPilot=()=>({access:null,checking:false});` }))
  builder.onLoad({ filter: /lib[\\/]docAiStore\.js$/ }, () => ({ loader: 'js', contents: `export const listConversations=async()=>({rows:[],error:null});export const loadConversation=async()=>({row:null});export const saveConversation=async()=>({error:null});export const deleteConversation=async()=>({error:null});export const markCompleted=async()=>({error:null});export const newConversationId=()=>crypto.randomUUID();` }))
  builder.onLoad({ filter: /lib[\\/]submissions\.js$/ }, args => {
    let source = readFileSync(args.path, 'utf8'); const names = ['listMine', 'listAll', 'submit', 'cancelSubmission', 'downloadUrl', 'removeFile']
    for (const name of names) source = source.replace(`export async function ${name}(`, `async function unused_${name}(`)
    return { loader: 'js', contents: source + '\n' + names.map(name => `export const ${name}=async()=>({rows:[],error:null});`).join('\n') }
  })
} }], logLevel: 'silent' })
const files = new Map(result.outputFiles.map(file => ['/' + relative(outdir, file.path).replaceAll('\\', '/'), file.contents]))
const css = readFileSync(join(root, 'apps/main/src/styles.css'), 'utf8'), browser = await launchBrowser(), passed = [], output = process.env.WORKHUB_QA_OUTPUT
let context, page, requested, external, errors
async function start(config = {}) {
  await context?.close(); context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(10000)
  requested = []; external = []; errors = []; page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { external.push(url.origin); return route.abort() }
    if (url.pathname.endsWith('.js')) {
      requested.push(url.pathname)
      if (url.pathname.includes(config.fail ?? 'NEVER')) return route.fulfill({ status: 503, body: 'synthetic private error must not appear' })
      if (url.pathname.includes(config.delay ?? 'NEVER')) await new Promise(done => setTimeout(done, 500))
      const contents = files.get(url.pathname)
      return contents ? route.fulfill({ contentType: 'text/javascript', body: Buffer.from(contents) }) : route.fulfill({ status: 404, body: '' })
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.loadingConfig=${JSON.stringify(config)}</script><script type="module" src="/entry.js"></script></html>` })
  })
  await page.goto(origin + (config.path ?? '/'))
}
const nav = label => page.locator('.ws-navigation').getByRole('link', { name: label, exact: true })
async function capture(name) { if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, name + '.png'), fullPage: true }) } }
async function test(name, config, run) {
  await start(config)
  try { await run(); assert.deepEqual(external, []); assert.deepEqual(errors, []) } catch (error) { console.error({errors, external, requested}); await capture('failure'); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
try {
  await test('대시보드는 문서·제출·관리·일정 화면 파일을 받지 않는다', {}, async () => {
    await page.getByRole('heading', { name: '오늘의 업무', exact: true }).waitFor(); assert(!requested.some(path => /DocAiPage|SubmissionsPage|AdminUsersPage|CalendarPage/.test(path)))
  })
  await test('로딩 중 메뉴가 유지되고 완료 뒤 새 제목으로 초점을 옮긴다', { delay: 'DocAiPage' }, async () => {
    await nav('평가계획서 작성').click(); await page.locator('[data-page-loading]').waitFor(); assert(await nav('홈').isVisible())
    await page.getByRole('heading', { name: /^문서 작성 AI —/ }).waitFor(); await page.waitForFunction(() => (()=>{let el=document.activeElement;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement;return el?.textContent})()?.startsWith('문서 작성 AI —'))
    assert(!requested.some(path => /SubmissionsPage|AdminUsersPage|CalendarPage/.test(path)))
  })
  await test('늦게 도착한 화면이 사용자가 이동한 초점을 빼앗지 않는다', { delay: 'DocAiPage' }, async () => {
    await nav('평가계획서 작성').click(); await page.locator('[data-page-loading]').waitFor(); await nav('홈').focus(); await page.getByRole('heading', { name: /^문서 작성 AI —/ }).waitFor()
    assert.equal(await page.evaluate(() => (()=>{let el=document.activeElement;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement;return el?.textContent})()), '홈')
  })
  await test('로딩 중 나가면 늦은 화면이 다시 나타나지 않는다', { delay: 'DocAiPage' }, async () => {
    await nav('평가계획서 작성').click(); await page.locator('[data-page-loading]').waitFor(); await nav('홈').click(); await page.getByRole('heading', { name: '오늘의 업무', exact: true }).waitFor(); await page.waitForTimeout(650)
    assert.equal(await page.getByRole('heading', { name: /^문서 작성 AI —/ }).count(), 0); assert.equal(await page.evaluate(() => (()=>{let el=document.activeElement;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement;return el?.textContent})()), '오늘의 업무')
  })
  await test('화면 다운로드 실패는 다른 메뉴를 막지 않고 원문 오류를 숨긴다', { fail: 'DocAiPage' }, async () => {
    await nav('평가계획서 작성').click(); await page.getByRole('alert').waitFor(); assert.doesNotMatch(await page.getByRole('alert').innerText(), /private error|synthetic|https?:|TypeError/)
    await page.getByRole('button', { name: '이 화면 다시 열기' }).click(); await page.getByRole('alert').getByText(/현재 탭에만 보관한 입력/).waitFor(); await capture('loading-recovery')
    await nav('평가계획서 제출').click(); await page.getByRole('heading', { name: '평가계획 제출', exact: true }).waitFor()
  })
  await test('문서 입력은 다른 화면 왕복 후 유지되고 유료 호출하지 않는다', {}, async () => {
    await nav('평가계획서 작성').click(); const field = page.locator('.composer input:not([type=file])'); await field.fill('요청하지 않는 시험 입력')
    await nav('홈').click(); await nav('평가계획서 작성').click(); assert.equal(await field.inputValue(), '요청하지 않는 시험 입력')
  })
  await test('일반 교사 관리자 주소 접근은 기존 대시보드로 돌리고 관리 코드를 받지 않는다', { path: '/admin/users' }, async () => {
    await page.getByRole('heading', { name: '오늘의 업무', exact: true }).waitFor(); assert(!requested.some(path => /AdminUsersPage/.test(path))); assert.equal(await nav('사용자 관리').count(), 0)
  })
  await test('승인 대기는 업무 코드를 불러오지 않는다', { active: false, path: '/doc-ai' }, async () => {
    await page.getByText('승인 대기중입니다', { exact: false }).waitFor(); assert(!requested.some(path => /DocAiPage|SubmissionsPage|AdminUsersPage|CalendarPage/.test(path)))
  })
  await test('320px 로딩 안내가 넘치지 않고 메뉴를 사용할 수 있다', { delay: 'DocAiPage' }, async () => {
    await page.setViewportSize({ width: 320, height: 820 }); await page.getByRole('button',{name:'더보기',exact:true}).click(); await nav('평가계획서 작성').click(); await page.locator('[data-page-loading]').waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await capture('loading-mobile')
  })
  console.log(`화면 지연 로딩 ${passed.length}건 통과 · 외부 요청 0`)
  if (output) writeFileSync(join(output, 'results.json'), JSON.stringify({ passed, externalRequests: 0 }, null, 2))
} finally { await browser.close() }
