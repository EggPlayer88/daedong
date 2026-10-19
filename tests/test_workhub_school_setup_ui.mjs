// 실제 화면을 서버 렌더해 안내와 필드 연결을 확인한다. 파일 동작은 브라우저 시험에서 검증한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { render } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { SchoolSetupPanel } from '../apps/workhub/src/setup/SchoolSetupPanel.tsx'
  export function render(props) { return renderToStaticMarkup(<><SchoolSetupPanel {...props}/><SchoolSetupPanel {...props}/></>) }
`)
let passed = 0
function test(name, action) { action(); passed++; console.log('  ✓ ' + name) }
let calls = 0
const html = render({ onDirtyChange: () => { calls++ } })
test('운영 미반영과 탭 종료의 한계, 미완성 초안 보관 방법을 명시한다', () => {
  assert.match(html, /운영 미반영/)
  assert.match(html, /새로고침하거나 탭을 닫으면 입력이 사라집니다/)
  assert.match(html, /작성 초안은 빈칸이 있어도 보관할 수 있습니다/)
  assert.match(html, /다시 불러오는 용도가 아닙니다/)
  assert.equal(calls, 0)
})
test('반복된 실제 폼의 ID와 레이블·설명 연결이 겹치지 않는다', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  assert.equal(ids.length, new Set(ids).size)
  const references = [...html.matchAll(/\b(?:for|aria-labelledby|aria-describedby)="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/))
  for (const reference of references) assert(ids.includes(reference), reference)
  assert.match(html, /type="file"/)
  assert.match(html, /aria-label="작성 초안 파일 선택"/)
  assert.match(html, /<form[^>]*novalidate/i)
  assert(!html.includes('검토할 준비가 되었습니다'))
})
console.log(`학교 설정 화면 SSR ${passed}개 통과`)
