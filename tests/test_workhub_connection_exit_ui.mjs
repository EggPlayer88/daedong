// 오류 화면이 약속하는 이동·보관 동작을 실제 JSX로 확인한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionRecoveryActions } from '../apps/workhub/src/app/ConnectionRecoveryActions.tsx'
  export function render(props) { return renderToStaticMarkup(<ConnectionRecoveryActions {...props}/>) }
`)
let passed = 0, failed = 0
function test(name, action) { try { action(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
let discards = 0
const base = { legacyHomeHref: '/', hasDraft: false, hasPending: false, announcement: '', onDiscard: () => { discards++; return true } }
test('보관 내용이 없으면 기존 메뉴 이용을 안내하고 폐기를 요구하지 않는다', () => {
  const html = render(base)
  assert.match(html, /기존 업무 메뉴는 계속 이용할 수 있습니다/)
  assert(!html.includes('임시 입력 버리기'))
})
test('일반 초안은 복구와 명시 폐기를 선택하고 탭 종료의 한계를 알린다', () => {
  const html = render({ ...base, hasDraft: true, announcement: '이동 차단' })
  assert.match(html, /같은 계정과 학교의 입력을 복원/)
  assert.match(html, /임시 입력 버리기/)
  assert.match(html, /입력을 보호하기 위해 이동을 막았습니다/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /새로고침하거나 이 탭을 닫으면 보관 정보가 사라집니다/)
})
test('결과 미확정 요청은 초안 유무와 관계없이 일반 폐기를 제공하지 않는다', () => {
  for (const hasDraft of [false, true]) {
    const html = render({ ...base, hasDraft, hasPending: true, announcement: '이동 차단' })
    assert.match(html, /이미 서버에 저장됐을 수 있어/)
    assert.match(html, /같은 요청으로 결과를 확인/)
    assert.match(html, /요청을 보호하기 위해 이동을 막았습니다/)
    assert(!html.includes('임시 입력 버리기'))
    assert(!html.includes('기존 업무 메뉴는 계속 이용할 수 있습니다'))
  }
})
test('보관 정보가 있으면 전달받은 주소를 그대로 사용하는 새 탭 링크를 제공한다', () => {
  for (const state of [{ hasDraft: true }, { hasPending: true }]) for (const legacyHomeHref of ['/', '/legacy', '/school/', '/school/legacy?from=workhub&mode=menu']) {
    const html = render({ ...base, ...state, legacyHomeHref })
    assert(html.includes(`href="${legacyHomeHref.replaceAll('&', '&amp;')}" target="_blank" rel="noopener noreferrer"`))
    assert.match(html, /기존 메뉴를 새 탭에서 이용/)
  }
  assert.equal(discards, 0)
})
console.log('연결 오류 이동 UI ' + passed + '개 통과')
if (failed) process.exitCode = 1
