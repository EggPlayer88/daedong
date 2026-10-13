import assert from 'node:assert/strict'
import { hasPreviewUrl } from './browser/preview-readiness.mjs'

const url = 'http://127.0.0.1:5187/'
let passed = 0
function test(name, run) { run(); passed++; console.log(`  ✓ ${name}`) }

test('평문 Vite 출력에서 소유한 시험 서버 주소를 확인한다', () => {
  assert.equal(hasPreviewUrl(`VITE ready\n  ➜ Local: ${url}\n`, url), true)
})
test('CI처럼 포트 번호 중간에 ANSI 서식이 들어가도 실제 주소를 확인한다', () => {
  const colored = '\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m5187\u001b[22m/\u001b[39m\n'
  assert.equal(colored.includes(url), false)
  assert.equal(hasPreviewUrl(colored, url), true)
})
test('다른 포트·일반 준비 문구·빈 출력으로 기존 서버를 준비 완료로 오인하지 않는다', () => {
  for (const log of ['VITE ready', '', '\u001b[36mhttp://127.0.0.1:\u001b[1m5176\u001b[22m/\u001b[39m']) {
    assert.equal(hasPreviewUrl(log, url), false)
  }
})

console.log(`브라우저 시험 서버 준비 확인: ${passed}개 통과`)
