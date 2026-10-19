import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionServerPanel} from '../apps/workhub/src/collections/CollectionServerPanel'
  import {fixtureData} from '../apps/workhub/src/preview/fixtures'
  export function render() {
    const server = new Proxy({}, {get() {return () => {throw new Error('렌더 중 서버 요청 금지')}}})
    return renderToStaticMarkup(<CollectionServerPanel server={server} member={fixtureData.memberships[0]} members={fixtureData.memberships} date={fixtureData.basisDate} />)
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
