import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render, example, valid } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionServerPanel} from '../apps/workhub/src/collections/CollectionServerPanel'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures'
  import {isCurrentCollectionComposeRequest} from '../apps/workhub/src/collections/collection-editor-model'
  const member = fixtureData.memberships[0], date = fixtureData.basisDate
  export const example = {id:'compose-1', schoolId:member.schoolId, memberId:member.id, basisDate:date, title:'비공개 수합 제목', instructions:'첫 줄\\n둘째 줄'}
  export function valid(request, basisDate = date) { return isCurrentCollectionComposeRequest(request, member, basisDate) }
  export function render(composeRequest) {
    const server = new Proxy({}, {get() {return () => {throw new Error('렌더 중 서버 요청 금지')}}})
    return renderToStaticMarkup(<CollectionServerPanel server={server} composeRequest={composeRequest} member={member} members={fixtureData.memberships} date={fixtureData.basisDate} />)
  }
`)
const html = render(), body = html.replace(/<style>[\s\S]*?<\/style>/g, '')
assert.match(body, /aria-label="서버 문서 수합"/)
assert.match(body, /role="status"[^>]*>수합 연결과 목록을 확인 중/)
assert.doesNotMatch(body, /새 수합 만들기|type="file"|최종 제출|현재 볼 수 있는 수합이 없습니다/)
console.log('  ✓ 수합 SSR은 연결 확인 중임을 알리고 확인 전 등록·업로드·빈 목록을 표시하지 않는다')
assert.equal((body.match(/<h2>/g) || []).length, 1)
assert.equal((body.match(/<main/g) || []).length, 0)
assert.equal((body.match(/<h1/g) || []).length, 0)
console.log('  ✓ 서버 수합 화면은 공통 셸의 본문과 최상위 제목을 중복하지 않는다')

assert.equal(valid(example), true)
assert.equal(valid({ ...example, title: '가'.repeat(120), instructions: '가'.repeat(3000) }), true)
assert.equal(valid({ ...example, instructions: '' }), true)
for (const patch of [
  { schoolId: 'other' }, { memberId: 'other' }, { basisDate: '1999-01-01' }, { id: '잘못된 번호' },
  { title: '  ' }, { title: '가'.repeat(121) }, { title: '줄\n바꿈' }, { instructions: '가'.repeat(3001) },
  { instructions: '\u0000' }, { title: '\ud800', instructions: '\udc00' }, { instructions: null }, { title: [] },
]) assert.equal(valid({ ...example, ...patch }), false)
assert.equal(valid({ ...example, basisDate: '2026-02-31' }, '2026-02-31'), false)
console.log('  ✓ 수합 제안은 현재 소속·날짜와 기존 길이 한도 및 원문 문자를 확인한다')

const offered = render(example).replace(/<style>[\s\S]*?<\/style>/g, '')
assert.match(offered, /aria-label="전달받은 수합 초안"/)
assert.match(offered, /<button[^>]*disabled[^>]*>수합 초안 사용<\/button>/)
assert.doesNotMatch(offered, /비공개 수합 제목|첫 줄|수합 초안 작성/)
for (const patch of [{ schoolId: 'other' }, { memberId: 'other' }, { basisDate: '1999-01-01' }]) {
  assert.doesNotMatch(render({ ...example, ...patch }), /aria-label="전달받은 수합 초안"|비공개 수합 제목/)
}
console.log('  ✓ 연결을 확인하기 전에는 제안 내용과 작성란을 열지 않고 이전 학교·날짜의 제안은 숨긴다')
