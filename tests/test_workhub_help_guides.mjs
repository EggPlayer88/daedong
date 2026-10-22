// 실제 업무를 찾는 검색어가 기존 메뉴와 올바른 안내로 이어지는지 확인한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const {workspaceGuides,findGuides,guidePageTitle,workhubModules}=await loadBrowserModule(`
 export * from '../apps/workhub/src/support/catalog'
 export {workhubModules} from '../apps/workhub/src/modules'
`)
let count=0
function test(name,run){run();count++;console.log('  ✓ '+name)}
function destination(query,id,page){const found=findGuides(query).find(guide=>guide.id===id);assert(found,`${query}: ${id} 안내를 찾지 못함`);assert.equal(found.page,page);return found}

test('메뉴를 새로 만들지 않고 모든 안내를 기존 업무 화면에 연결한다',()=>{
 assert.equal(new Set(workspaceGuides.map(guide=>guide.id)).size,workspaceGuides.length)
 for(const guide of workspaceGuides){
  const menu=workhubModules.find(module=>module.id===guide.page)
  assert(menu,guide.id);assert.equal(guidePageTitle(guide.page),menu.title)
  assert.equal(menu.visibility,'superadmin');assert.equal(guide.steps.length,3)
  for(const text of [guide.title,guide.summary,guide.note,...guide.steps])assert.equal(typeof text==='string'&&text.trim().length>0,true,guide.id)
 }
})
test('공백·한글 조합·영문 대소문자가 달라도 자료 수합 안내를 찾는다',()=>{
 const query='  자료   ＺＩＰ  '
 destination(query,'collect','collections')
 assert.deepEqual(findGuides('학교 자료'.normalize('NFD')).map(guide=>guide.id),findGuides('학교 자료').map(guide=>guide.id))
 assert.deepEqual(findGuides('HWPX').map(guide=>guide.id),findGuides('hwpx').map(guide=>guide.id))
})
test('여러 단어가 함께 맞는 안내만 찾고 빈 검색은 전체를 보여 준다',()=>{
 assert.deepEqual(findGuides('  '),workspaceGuides)
 assert.equal(findGuides('존재하지않는기능').length,0)
 assert.equal(findGuides('가상교사 원천징수').length,0)
 destination('기억 사용기한','assistant-memory','assistant')
 assert(!findGuides('기억 사용기한').some(guide=>guide.id==='collect'))
})
test('학교 일괄 입력과 학기 편성 준비를 서로 맞는 메뉴로 안내한다',()=>{
 destination('초기자료 엑셀','school-preparation','schoolAdmin')
 destination('학교 정정','school-preparation','schoolAdmin')
 destination('학기선택 시수','timetable-design','timetable')
 destination('하드조건 공간','timetable-design','timetable')
})
test('교환과 대강·휴강·보강의 담당 흐름을 각각 찾을 수 있다',()=>{
 destination('교환 승인','timetable-view','timetable')
 for(const query of ['대강','휴강 보강','결손'])destination(query,'timetable-interventions','timetable')
})
test('양식 준비에서 생성·제출·담당자 묶음 다운로드까지 역할별 안내가 있다',()=>{
 destination('빈칸연결 추천','guided-setup','documents')
 destination('질문제안 매핑','guided-setup','documents')
 destination('HWPX 생성 제출','documents','documents')
 destination('첨부 제출','submit','collections')
 destination('전체다운로드 ZIP','collect','collections')
})
test('과거 원문·개인 기억·정밀 검토와 비용 없는 연습을 찾을 수 있다',()=>{
 destination('과거 원문','knowledge','knowledge')
 destination('장기기억 중지','assistant-memory','assistant')
 destination('Haiku Sonnet','assistant','assistant')
 destination('정밀검토 예산','assistant','assistant')
 destination('가상교사 연습','practice','schoolAdmin')
})
test('안내 검색만으로 업무 화면·서버 연결·AI 호출 코드를 불러오지 않는다',()=>{
 const result=buildSync({entryPoints:[fileURLToPath(new URL('../apps/workhub/src/support/catalog.ts',import.meta.url))],bundle:true,write:false,metafile:true,platform:'neutral',format:'esm',logLevel:'silent'})
 const files=Object.keys(result.metafile.inputs).map(path=>path.replaceAll('\\','/'))
 assert(files.every(path=>/\/(support\/(catalog\.ts|guide-data\.json)|modules\.ts)$/.test(path)),files.join('\n'))
})
console.log(`사용 안내 검색 ${count}건 통과`)
