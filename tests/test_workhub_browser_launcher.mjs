import assert from 'node:assert/strict'
import { browserLaunchOptions } from './browser/launch-browser.mjs'

let passed = 0
function test(name, run) { run(); passed++; console.log(`  ✓ ${name}`) }
test('로컬 기본 실행은 설치된 Chrome을 명시적으로 사용한다', () => {
  assert.deepEqual(browserLaunchOptions({}), { headless: true, channel: 'chrome' })
})
test('CI Chromium은 Chrome 채널을 넘기지 않아 고정 버전 브라우저를 사용한다', () => {
  assert.deepEqual(browserLaunchOptions({ PLAYWRIGHT_CHANNEL: 'chromium' }), { headless: true })
})
test('명시한 로컬 Edge 설정을 지키고 알 수 없는 채널을 조용히 대체하지 않는다', () => {
  assert.deepEqual(browserLaunchOptions({ PLAYWRIGHT_CHANNEL: 'msedge' }), { headless: true, channel: 'msedge' })
  assert.throws(() => browserLaunchOptions({ PLAYWRIGHT_CHANNEL: 'unknown' }), /지원하지 않는/)
})
console.log(`브라우저 실행 설정: ${passed}개 통과`)
