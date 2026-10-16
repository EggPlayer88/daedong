import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render, limits } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionServerExport} from '../apps/workhub/src/collections/CollectionServerExport'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures'
  export { FILE_TECHNICAL_LIMITS as limits } from '../apps/workhub/src/files/contracts'
  export function render(disabled = false) {
    const server = new Proxy({}, {get() { return () => {throw new Error('렌더 중 서버 요청 금지')} }})
    return renderToStaticMarkup(<CollectionServerExport server={server} member={fixtureData.memberships[0]} requestId="synthetic-export" date={fixtureData.basisDate} disabled={disabled} />)
  }
`)
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
const stripStyles = value => value.replace(/<style>[\s\S]*?<\/style>/g, '')

test('서버 ZIP 화면은 기본 접힌 상세 안에 완료본 기준과 키보드 조작 요소를 제공한다', () => {
  const html = render(), body = stripStyles(html)
  assert.match(body, /<details class="cs-file-export"><summary>제출 파일 모아 받기<\/summary>/)
  assert.doesNotMatch(body, /<details[^>]*\bopen(?:=|\s|>)/)
  assert.match(body, /<option value="effective" selected="">완료본/)
  assert.match(body, /<label for="([^"]+)">모을 파일 기준<\/label><select id="\1"/)
  assert.match(html, /:focus-visible/)
})
test('준비하기 전에는 ZIP 완료나 다운로드를 가장하지 않고 자동 서버 조회도 하지 않는다', () => {
  const body = stripStyles(render())
  assert.match(body, /최신 현황으로 묶음 준비/)
  assert.doesNotMatch(body, /ZIP 내려받기|파일과 제출 현황표를 준비했습니다|download=|href=/)
  assert.match(body, /role="status" aria-live="polite" aria-atomic="true"/)
})
test('다른 편집이 진행 중이면 파일 기준과 준비 버튼 모두 잠근다', () => {
  const body = stripStyles(render(true))
  assert.match(body, /<select[^>]*disabled=""/)
  assert.match(body, /<button type="button" disabled="">최신 현황으로 묶음 준비/)
})
test('범위·초안 제외·직전 재확인·실제 기술상한을 보이며 전체학교 원자적 묶음으로 설명하지 않는다', () => {
  const body = stripStyles(render())
  assert.match(body, /이 수합의 제출 자료/)
  assert.match(body, /미제출 초안과 철회한 제출판은 포함하지 않습니다/)
  assert.match(body, /내려받기 직전에 제출 상태와 파일 접근을 다시 확인/)
  assert(body.includes(`첨부 파일 ${limits.zipEntries - 1}개`))
  assert(body.includes(`합계 ${limits.memoryBytes / 1024 / 1024} MiB`))
  assert.doesNotMatch(body, /학교 전체|원자적|스냅샷 확정|100%/)
})
console.log(`\n서버 수합 ZIP 화면: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
