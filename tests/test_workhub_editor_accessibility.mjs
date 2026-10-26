import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {EventEditor} from '../apps/workhub/src/calendar/EventEditor.tsx'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
  const props={member:fixtureData.memberships[0],members:fixtureData.memberships,date:fixtureData.basisDate,adapter:{},onClose(){},onSaved(){}};
  export const render=()=>renderToStaticMarkup(<><EventEditor {...props}/><EventEditor {...props} original={fixtureData.events[2]}/></>);
`)
const html = render()
const dialogs = [...html.matchAll(/<dialog\b[^>]*aria-labelledby="([^"]+)"[^>]*>/g)].map(match => match[1])
let passed = 0
function test(name, run) { run(); passed++; console.log('  ✓ ' + name) }
test('동시에 렌더한 새 일정과 수정 일정은 각 제목으로 이름이 연결된다', () => {
  assert.equal(dialogs.length, 2); assert.notEqual(dialogs[0], dialogs[1])
  assert(html.includes(`<h2 id="${dialogs[0]}">일정 등록</h2>`))
  assert(html.includes(`<h2 id="${dialogs[1]}">일정 수정</h2>`))
  const formLabels = [...html.matchAll(/<form\b[^>]*aria-labelledby="([^"]+)"[^>]*>/g)].map(match => match[1])
  assert.deepEqual(formLabels, dialogs)
})
test('대상 안내와 미리보기의 이름 연결도 같은 화면의 다른 편집기와 충돌하지 않는다', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
  const references = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].flatMap(match => match[1].split(' '))
  assert.equal(ids.length, new Set(ids).size)
  for (const ref of references) assert(ids.includes(ref), ref)
  assert.equal((html.match(/aria-labelledby="[^"]+-preview"/g) || []).length, 2)
})
console.log(`일정 편집 접근성 SSR ${passed}개 통과`)
