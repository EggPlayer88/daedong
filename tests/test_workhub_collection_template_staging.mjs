import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { stageTemplates, render } = await loadBrowserModule(`
  export {stageTemplates} from '../apps/workhub/src/collections/template-staging'
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionServerPanel} from '../apps/workhub/src/collections/CollectionServerPanel'
  import {EditDraftsProvider,createEditDrafts} from '../apps/workhub/src/app/edit-drafts'
  import {recoveryScope} from '../apps/workhub/src/app/pending-requests'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures'
  export function render() {
    const member=fixtureData.memberships[0],store=createEditDrafts()
    store.bind(recoveryScope(member),'collection-editor').save({editor:{staged:[],input:{title:'시험 수합',instructions:'',dueDate:'2026-10-31',reviewMode:'none',reviewerMemberId:'',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[],fileCollection:{required:true,policy:{extensions:['hwpx'],maxFiles:5,maxFileBytes:20971520},templates:[]}}}})
    return renderToStaticMarkup(<EditDraftsProvider store={store}><CollectionServerPanel server={{}} member={member} members={fixtureData.memberships} date={fixtureData.basisDate}/></EditDraftsProvider>)
  }
`)
const policy = { extensions: ['hwpx'], maxFileBytes: 100, maxFiles: 3 }, file = (name = '양식.hwpx', size = 10) => new File([new Uint8Array(size)], name)
let n = 0, passed = 0
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name) }
test('파일 선택은 원본을 보존하며 서로 다른 선택 ID를 부여한다', () => {
  const current = [{ id: 'first', file: file() }], result = stageTemplates(current, [file(), file()], policy, 0, () => `new-${++n}`)
  assert.equal(current.length, 1); assert.equal(result.length, 3); assert.equal(new Set(result.map(v => v.id)).size, 3)
  assert.equal(result[0].file, current[0].file)
})
test('이미 검사한 첨부와 대기 파일을 합산해 서버 한도를 지킨다', () => {
  assert.throws(() => stageTemplates([{ id: '1', file: file() }], [file()], policy, 2), /최대 3개/)
  assert.equal(stageTemplates([], [file()], policy, 2).length, 1)
})
for (const [name, invalid] of [['다른 형식', file('양식.pdf')], ['빈 파일', file('빈.hwpx', 0)], ['초과 크기', file('큰.hwpx', 101)]]) test(`${name}이 섞인 선택은 전체를 거부하고 기존 선택을 보존한다`, () => {
  const current = [{ id: '1', file: file() }]
  assert.throws(() => stageTemplates(current, [file(), invalid], policy, 0))
  assert.equal(current.length, 1)
})
test('선택 취소는 기존 파일 선택 배열을 변경하지 않는다', () => {
  const current = [{ id: '1', file: file() }]
  assert.deepEqual(stageTemplates(current, [], policy, 0), current)
})
test('화면은 처음부터 양식 선택과 비공개 안내를 보여주고 추가 설정은 접는다', () => {
  const html = render().replace(/<style>[\s\S]*?<\/style>/g, '')
  for (const text of ['1. 무엇을 받을까요?', '2. 나눠 줄 양식', '3. 누가 제출하나요?', '저장해도 교사에게 공개되지 않습니다.', '양식 파일 선택']) assert(html.includes(text))
  assert.match(html, /type="file"[^>]*multiple=""/)
  assert.doesNotMatch(html, /먼저 초안을 저장한 뒤|<details[^>]*open/)
})
console.log(`\n수합 양식 선택·SSR: ${passed} 통과`)
