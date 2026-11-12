import assert from 'node:assert/strict'
import { buildLegacyEvaluationLinks as build } from '../apps/main/src/site/legacy-evaluation-links.js'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { MODULES, visibleModules } = await loadBrowserModule(`export { MODULES, visibleModules } from '../apps/main/src/lib/modules.js'`,{env:{MODE:'test',VITE_SUPABASE_URL:'https://synthetic.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
const profile = { id:'admin-one', role:'superadmin', is_active:true }, modules = visibleModules(profile)
const ready = { state:{enabled:true}, loading:false, error:'' }
const hrefs = { authoring:'/school-site/doc-ai', submissions:'/school-site/submissions' }
let failed = 0
function test(name, run) { try { run(); console.log('  ✓ ' + name) } catch(error) { failed++; console.error('  ✗ ' + name,error) } }

test('활성 기간 업무의 허용된 기존 두 주소만 전달한다',()=> {
  assert.deepEqual(build(modules,ready,hrefs),hrefs)
  assert.equal(MODULES.find(item=>item.key==='doc-ai').to,'/doc-ai')
  assert.equal(MODULES.find(item=>item.key==='submissions').to,'/submissions')
})
test('기간 업무 숨김은 두 새 AI 진입 링크 모두 숨긴다',()=> {
  assert.deepEqual(build(modules,{...ready,state:{enabled:false}},hrefs),{})
})
test('설정 조회 중이면 과거 활성 값을 새 연결 근거로 쓰지 않는다',()=> {
  assert.deepEqual(build(modules,{...ready,loading:true},hrefs),{})
  assert.deepEqual(build(modules,{state:{enabled:true}},hrefs),{})
})
test('설정 조회 실패는 과거 활성 상태가 있어도 링크를 제공하지 않는다',()=> {
  assert.deepEqual(build(modules,{...ready,error:'조회 실패'},hrefs),{})
})
test('미설치와 잘못된 활성 값은 표시 중으로 판단하지 않는다',()=> {
  for(const seasonal of [undefined,null,{...ready,state:null},{...ready,state:{enabled:'true'}},{...ready,state:{enabled:1}}]) assert.deepEqual(build(modules,seasonal,hrefs),{})
})
test('허용된 모듈이 하나면 그 주소 하나만 전달한다',()=> {
  assert.deepEqual(build(modules.filter(item=>item.key==='doc-ai'),ready,hrefs),{authoring:hrefs.authoring})
  assert.deepEqual(build(modules.filter(item=>item.key==='submissions'),ready,hrefs),{submissions:hrefs.submissions})
})
test('다른 모듈이나 비정상 모듈 목록으로 기간 업무를 추정하지 않는다',()=> {
  for(const items of [undefined,null,{},[],[{key:'documents'}]]) assert.deepEqual(build(items,ready,hrefs),{})
})
test('주소 누락과 빈 값은 추측하지 않고 현재 라우터 기준 주소만 보존한다',()=> {
  assert.deepEqual(build(modules,ready,{authoring:''}),{})
  assert.deepEqual(build(modules,ready,{authoring:hrefs.authoring}),{authoring:hrefs.authoring})
  assert.deepEqual(build(modules,ready,{...hrefs,unrelated:'/admin/users'}),hrefs)
})
test('기존 역할별 모듈 공개 범위에 새 변경이 없다',()=> {
  const teacher=visibleModules({id:'teacher-one',role:'teacher',is_active:true})
  assert(teacher.some(item=>item.key==='doc-ai'));assert(teacher.some(item=>item.key==='submissions'))
  assert(!teacher.some(item=>item.key==='workhub'));assert(!teacher.some(item=>item.key==='admin-users'))
})
if(failed) process.exit(1)
