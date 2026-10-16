import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { readWorkspaceLocation, workspacePageUrl, anchorLeavesWorkspace, createWorkspaceNavigationController, navigationBlockedMessage, workspaceExitBlockedMessage, enabledModules } = await loadBrowserModule(`export * from '../apps/workhub/src/app/navigation.ts'; export { enabledModules } from '../apps/workhub/src/modules.ts'`)
const pages = ['home', 'calendar', 'tasks']
const base = 'https://school.invalid/workhub?filter=%ED%95%99%EA%B5%90&view=tasks#main-content'
let failed = 0
async function test(name, run) { try { await run(); console.log(`  ✓ ${name}`) } catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) } }

await test('허용된 직접 주소는 현재 경로·다른 query·hash를 유지한다', () => {
  assert.deepEqual(readWorkspaceLocation(base, pages), { page: 'tasks', href: base, corrected: false })
  assert.equal(workspacePageUrl(base, 'calendar', pages), base.replace('view=tasks', 'view=calendar'))
  assert.equal(workspacePageUrl(base, 'home', pages), base.replace('&view=tasks', ''))
})
await test('없는 메뉴·해당 모드에 없는 메뉴·중복 view는 홈으로 안전 복원한다', () => {
  for (const query of ['view=unknown', 'view=students', 'view=tasks&view=calendar', 'view=', 'view=__proto__']) {
    assert.deepEqual(readWorkspaceLocation(`https://school.invalid/workhub?keep=1&${query}#target`, pages), { page: 'home', href: 'https://school.invalid/workhub?keep=1#target', corrected: true })
  }
  assert.equal(workspacePageUrl(base, 'students', pages), undefined)
  assert.equal(workspacePageUrl(base, 'invented', [...pages, 'invented']), undefined)
})
await test('미리보기에서만 허용한 화면은 실제 연결 목록으로 바꾸면 열리지 않는다', () => {
  const href = 'https://school.invalid/workhub?view=students'
  assert.equal(readWorkspaceLocation(href, [...pages, 'students']).page, 'students')
  assert.equal(readWorkspaceLocation(href, pages).page, 'home')
})
await test('연결 메뉴의 실제 주소 이동과 시간표의 미리보기 차단이 함께 유지된다', () => {
  const connected = enabledModules('connected').map(module => module.id)
  for (const page of connected) {
    const href = workspacePageUrl(base, page, connected)
    assert.ok(href, page)
    assert.equal(readWorkspaceLocation(href, connected).page, page)
  }
  const preview = enabledModules('preview').map(module => module.id)
  assert.equal(workspacePageUrl(base, 'timetable', preview), undefined)
  assert.equal(readWorkspaceLocation('https://school.invalid/workhub?view=timetable', preview).page, 'home')
})
await test('현재 탭의 다른 경로·다른 화면 query·외부 문서 이동을 구분한다', () => {
  for (const href of ['/doc-ai', '?view=calendar', 'https://other.invalid', '/workhub']) assert.equal(anchorLeavesWorkspace(base, { href }), true)
  for (const href of [base, '#main-content', '#other-target', 'mailto:teacher@example.invalid', 'tel:123']) assert.equal(anchorLeavesWorkspace(base, { href }), false)
})
await test('새 탭·다운로드·보조 클릭은 현재 초안을 없애는 이동으로 취급하지 않는다', () => {
  for (const options of [{ target: '_blank' }, { target: 'reference' }, { download: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) assert.equal(anchorLeavesWorkspace(base, { href: '/doc-ai', ...options }), false)
  for (const target of ['_self', '_top', '_parent']) assert.equal(anchorLeavesWorkspace(base, { href: '/doc-ai', target }), true)
})

// 순수 제어 흐름은 가상 history로, 실제 이벤트 전파는 browser/workhub-navigation에서 검증한다.
const originalPopStateEvent = globalThis.PopStateEvent
globalThis.PopStateEvent = class extends Event { constructor(type, options = {}) { super(type); this.state = options.state } }
function fixture(href = base) {
  let url = href, entries = [{ href, state: { idx: 7, usr: { preserved: true }, key: 'legacy' } }], position = 0
  const host = new EventTarget()
  host.document = new EventTarget()
  Object.defineProperty(host, 'location', { get: () => new URL(url) })
  host.history = {
    get state() { return entries[position].state },
    get length() { return entries.length },
    replaceState(state, _, next) { url = new URL(next, url).href; entries[position] = { href: url, state } },
    pushState(state, _, next) { url = new URL(next, url).href; entries = [...entries.slice(0, position + 1), { href: url, state }]; position++ },
    go(delta) { position += delta; url = entries[position].href; host.dispatchEvent(new PopStateEvent('popstate', { state: entries[position].state })) },
  }
  const options = { allowedPages: pages, locked: false }
  let page, announcement = ''
  const controller = createWorkspaceNavigationController({ window: host, getOptions: () => options, onPageChange: next => { page = next }, onAnnouncement: value => { announcement = value } })
  controller.start()
  return { host, options, controller, get page() { return page }, get announcement() { return announcement } }
}
try {
  await test('최초 deep link를 유지하고 같은 화면 요청은 history를 늘리지 않는다', () => {
    const f = fixture()
    assert.equal(f.page, 'tasks')
    assert.equal(f.controller.requestNavigate('tasks'), true)
    assert.equal(f.host.history.length, 1)
    f.options.scopeKey = 'school-a'; f.controller.sync()
    assert.equal(f.page, 'tasks')
    assert.equal(f.host.history.length, 1)
    f.controller.stop()
  })
  await test('허용 화면 이동만 기록하며 기존 Router 상태와 다른 query를 보존한다', () => {
    const f = fixture()
    assert.equal(f.controller.requestNavigate('calendar'), true)
    assert.equal(f.page, 'calendar')
    assert.equal(f.host.history.length, 2)
    assert.equal(f.host.history.state.idx, 8)
    assert.deepEqual(f.host.history.state.usr, { preserved: true })
    assert.equal(f.host.location.hash, '#main-content')
    assert.equal(f.host.location.searchParams.get('filter'), '학교')
    assert.equal(f.controller.requestNavigate('students'), false)
    assert.equal(f.host.history.length, 2)
    f.controller.stop()
  })
  await test('편집 잠금은 화면 이동과 일반 action을 모두 동기적으로 거부한다', () => {
    const f = fixture(); f.options.locked = true
    let actions = 0
    assert.equal(f.controller.requestNavigate('calendar'), false)
    assert.equal(f.controller.requestAction(() => actions++), false)
    assert.equal(actions, 0)
    assert.equal(f.page, 'tasks')
    assert.equal(f.host.history.length, 1)
    assert.equal(f.announcement, navigationBlockedMessage)
    f.options.locked = false
    assert.equal(f.controller.requestAction(() => actions++), true)
    assert.equal(actions, 1)
    assert.equal(f.announcement, '')
    f.controller.stop()
  })
  await test('소속이 처음 정해질 때는 유지하고 다른 소속으로 변경할 때만 홈으로 교체한다', () => {
    const f = fixture()
    f.options.scopeKey = 'school-a'; f.controller.sync(); assert.equal(f.page, 'tasks')
    f.options.scopeKey = undefined; f.controller.sync(); assert.equal(f.page, 'tasks')
    f.options.scopeKey = 'school-b'; f.controller.sync(); assert.equal(f.page, 'home')
    assert.equal(f.host.history.length, 1)
    assert.equal(f.host.location.searchParams.get('filter'), '학교')
    assert.equal(f.host.location.hash, '#main-content')
    f.controller.stop()
  })
  await test('보관 잠금은 내부 메뉴를 허용하고 학교 변경 action은 차단한다', () => {
    const f = fixture(); f.options.exitLocked = true
    let actions = 0
    assert.equal(f.controller.requestNavigate('calendar'), true)
    assert.equal(f.page, 'calendar')
    assert.equal(f.controller.requestAction(() => actions++), false)
    assert.equal(actions, 0)
    assert.equal(f.announcement, workspaceExitBlockedMessage)
    f.options.exitLocked = false
    assert.equal(f.controller.requestAction(() => actions++), true)
    assert.equal(actions, 1)
    f.controller.stop()
  })
  await test('보관 잠금은 같은 업무실의 POP은 허용하고 바깥 경로로 가는 POP은 되돌린다', () => {
    const f = fixture('https://school.invalid/legacy')
    f.host.history.pushState({ idx: 8 }, '', base); f.controller.sync()
    f.options.exitLocked = true
    f.controller.requestNavigate('calendar')
    f.host.history.go(-1)
    assert.equal(f.page, 'tasks')
    assert.equal(f.host.location.href, base)
    f.host.history.go(-1)
    assert.equal(f.page, 'tasks')
    assert.equal(f.host.location.href, base)
    assert.equal(f.announcement, workspaceExitBlockedMessage)
    f.options.exitLocked = false
    f.host.history.go(-1)
    assert.equal(f.host.location.pathname, '/legacy')
    f.controller.stop()
  })
  await test('입력창을 접어도 보관 자료의 새로고침 경고는 유지하고 완료 뒤 해제한다', () => {
    const f = fixture(); f.options.exitLocked = true
    const first = new Event('beforeunload', { cancelable: true }); f.host.dispatchEvent(first)
    assert.equal(first.defaultPrevented, true)
    f.options.exitLocked = false
    const second = new Event('beforeunload', { cancelable: true }); f.host.dispatchEvent(second)
    assert.equal(second.defaultPrevented, false)
    f.controller.stop()
  })
  await test('설정에서 메뉴를 제외하면 현재 URL도 교정하고 기존 항목을 덧붙이지 않는다', () => {
    const f = fixture()
    f.options.allowedPages = ['home', 'calendar']; f.controller.sync()
    assert.equal(f.page, 'home')
    assert.equal(f.host.location.searchParams.has('view'), false)
    assert.equal(f.host.history.length, 1)
    f.controller.stop()
  })
  await test('잠긴 새로고침 경고는 정리 후에 남지 않는다', () => {
    const f = fixture(); f.options.locked = true
    const first = new Event('beforeunload', { cancelable: true }); f.host.dispatchEvent(first)
    assert.equal(first.defaultPrevented, true)
    f.controller.stop()
    const second = new Event('beforeunload', { cancelable: true }); f.host.dispatchEvent(second)
    assert.equal(second.defaultPrevented, false)
  })
} finally {
  if (originalPopStateEvent === undefined) delete globalThis.PopStateEvent
  else globalThis.PopStateEvent = originalPopStateEvent
}
if (failed) process.exitCode = 1
