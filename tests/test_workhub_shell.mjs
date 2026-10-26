// 공통 셸은 실제 JSX로 검사한다. 오류 경계의 클라이언트 포착은 별도 브라우저 시험 대상이다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { renderShell, renderFailure, renderBoundary, enabledModules, workhubModules } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { WorkspaceShell } from '../apps/workhub/src/app/WorkspaceShell.tsx'
  import { ModuleBoundary, ModuleFailureView } from '../apps/workhub/src/app/ModuleBoundary.tsx'
  export { enabledModules, workhubModules } from '../apps/workhub/src/modules.ts'
  export function renderShell(props) { return renderToStaticMarkup(<WorkspaceShell page="home" onNavigate={()=>{}} mode="preview" schoolName="가상 학교" memberName="가상 교사" {...props}><main><h1>기능 화면 제목</h1><p>기능 본문</p></main></WorkspaceShell>) }
  export function renderFailure(name) { return renderToStaticMarkup(<ModuleFailureView moduleName={name} onRetry={()=>{}}/>) }
  export function renderBoundary() { return renderToStaticMarkup(<ModuleBoundary moduleName="내 업무"><p>정상 기능 본문</p></ModuleBoundary>) }
`)
let passed = 0, failed = 0
function test(name, action) { try { action(); passed++; console.log(`  ✓ ${name}`) } catch(error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error}`) } }
const body = html => html.replace(/<style>[\s\S]*?<\/style>/g, '')
test('메뉴의 실제 구현 범위와 공개 제한을 중앙 목록에서 고정한다', () => {
  assert.deepEqual(enabledModules('connected').map(value=>value.id),['home','calendar','tasks','collections','documents','cooperation','assistant','knowledge','messages','schoolAdmin','timetable','students'])
  assert.deepEqual(enabledModules('preview').map(value=>value.id),['home','calendar','tasks','collections','students'])
  assert(workhubModules.every(value=>value.visibility==='superadmin'&&value.productionEnabled===false))
  assert.equal(workhubModules.find(value=>value.id==='tasks').parentId,'home')
  assert.equal(workhubModules.find(value=>value.id==='collections').group,'work')
  assert.equal(workhubModules.find(value=>value.id==='students').group,'teaching')
  assert.deepEqual(enabledModules('unknown'),[])
})
test('연결 화면은 새 서버 모듈과 명시적 AI 준비 안내를 제공한다', () => {
  const html=body(renderShell({mode:'connected',page:'tasks'}))
  for(const name of ['홈','시간표','업무','자료'])assert(html.includes(`>${name}</span>`))
  assert.match(html,/aria-label="메시지와 알림"/);assert.match(html,/aria-label="관련 업무 메뉴"/)
  for(const name of ['학교 자료','학교 관리','수업과 학생'])assert(!html.includes(`>${name}</span>`))
  assert.match(html,/>자료 수합<\/button>/)
  assert.equal(workhubModules.find(value=>value.id==='timetable').visibility,'superadmin')
  const assistant=html.match(/<button[^>]*class="[^"]*ws-assistant-trigger[^"]*"[\s\S]*?<\/button>/g)||[]
  assert.equal(assistant.length,1);assert(assistant[0].includes('AI 비서'));assert(!assistant[0].includes('준비 중'))
  assert(!html.includes('<textarea'));assert(!html.includes('대화 전송'))
  assert.match(html,/aria-label="신축 업무 메뉴"/)
  assert.match(html,/class="ws-more-button"[^>]*aria-haspopup="dialog"/)
  assert.match(html,/aria-label="업무" aria-current="page"/)
})
test('미리보기의 보조 화면은 더보기와 현재 위치로 연결하고 숨은 링크를 만들지 않는다', () => {
  const html=body(renderShell({page:'students'}))
  assert.match(html,/aria-label="업무 메뉴"/);assert.match(html,/aria-expanded="false" aria-controls="([^"]+)"/)
  const target=html.match(/aria-expanded="false" aria-controls="([^"]+)"/)[1]
  assert(html.includes(`id="${target}"`));assert.match(html,/ws-more-current/);assert(!html.includes('>수업과 학생</span>'))
  assert.match(html,/<strong aria-current="page">수업과 학생<\/strong>/)
})
test('본문 제목과 main을 중복하지 않고 건너뛰기와 현재 위치를 제공한다', () => {
  const html=body(renderShell({page:'tasks'}))
  assert.equal((html.match(/<main>/g)||[]).length,1);assert.equal((html.match(/<h1>/g)||[]).length,1)
  assert.match(html,/>본문으로 건너뛰기<\/a>/);assert.match(html,/aria-label="현재 위치"/)
  assert.match(html,/<span>홈<\/span>/);assert.match(html,/<strong aria-current="page">내 업무<\/strong>/)
})
test('편집 잠금은 모든 이동 버튼에 적용하되 더보기는 탐색 가능하다', () => {
  const html=body(renderShell({locked:true}))
  const buttons=html.match(/<button[^>]*class="ws-menu-button[^>]*>/g)||[]
  assert.equal(buttons.length,4);assert(buttons.every(value=>value.includes('disabled=""')&&value.includes('aria-describedby=')))
  assert.match(html,/role="status"[^>]*>작성한 내용을 저장/)
  assert(!html.match(/class="ws-more-button"[^>]*disabled/))
})
test('미리보기 저장 안내와 이름은 안전한 텍스트로 표시한다', () => {
  const html=body(renderShell({schoolName:'<script>학교</script>',memberName:'<img>교사',storageLabel:'합성 자료 · 임시 메모리'}))
  assert.match(html,/합성 자료 · 임시 메모리/);assert(!html.includes('<script>'));assert(!html.includes('<img>'))
  assert.match(html,/&lt;script&gt;학교/)
})
test('지원하지 않는 모듈은 내용 대신 안전한 안내를 보여준다', () => {
  const html=body(renderShell({mode:'connected',page:'unsupported-module'}))
  assert(!html.includes('기능 본문'));assert.match(html,/이 화면은 아직 연결되지 않았습니다/)
  assert(!html.includes('>unsupported-module</span>'))
})
test('누락되거나 깨진 표시 이름에도 셸과 오류 안내가 렌더된다', () => {
  const html=body(renderShell({schoolName:null,memberName:[]}))
  assert.match(html,/학교 업무실/);assert.match(html,/선생님/)
  for(const value of [null,[],{},''])assert.match(renderFailure(value),/업무 화면을 표시하지 못했습니다/)
})
test('기능 오류 화면은 원본 초기화 없이 다시 열기를 제공하고 정상 본문을 감싸기만 한다', () => {
  const html=renderFailure('내 업무')
  assert.match(html,/role="alert"/);assert.match(html,/저장된 원본을 삭제하거나 초기화하지 않습니다/)
  assert.match(html,/저장하지 않은 입력은 다시 확인/);assert.match(html,/>이 화면 다시 열기<\/button>/)
  assert(!html.includes('다시 로그인'));assert.equal(renderBoundary(),'<p>정상 기능 본문</p>')
})
console.log(`공통 셸 UI ${passed}개 통과`)
if(failed)process.exit(1)
