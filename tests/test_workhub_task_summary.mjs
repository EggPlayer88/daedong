// 홈의 기한 분류·발췌와 실제 JSX를 검사한다. 원본 조회·이동은 브라우저 통합 시험에서 확인한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { summarizeTasks, taskDueGroup, taskNoteExcerpt, withSelectedTask, renderSummary, renderInitialPanel } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { TaskPanel, TaskDueSummary } from '../apps/workhub/src/tasks/TaskPanel.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { summarizeTasks, taskDueGroup, taskNoteExcerpt, withSelectedTask } from '../apps/workhub/src/tasks/presentation.ts'
  export function renderSummary(props) { return renderToStaticMarkup(<TaskDueSummary date="2026-10-19" state="ready" onOpenTasks={()=>{}} {...props} />) }
  export function renderInitialPanel() { return renderToStaticMarkup(<TaskPanel member={fixtureData.memberships[0]} date="2026-10-19" compact adapter={{list:async()=>[],get:async()=>{throw Error('unused')}}} />) }
`)
const date = '2026-10-19'
const task = (id, dueDate = '', status = 'todo', extra = {}) => ({ id, schoolId: 'school', ownerMemberId: 'member', title: `업무 ${id}`, notes: '', dueDate, status, version: 1, updatedAt: '2026-10-19T00:00:00Z', ...extra })
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`) } }
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '')

test('어제·오늘·내일·기한 없음은 기준일에서 겹치지 않는 네 분류다', () => {
  assert.deepEqual(['2026-10-18',date,'2026-10-20',''].map(due => taskDueGroup(task('one', due), date)), ['overdue','today','upcoming','none'])
  assert.equal(taskDueGroup(task('month', '2026-09-30'), '2026-10-01'), 'overdue')
  assert.equal(taskDueGroup(task('year', '2027-01-01'), '2026-12-31'), 'upcoming')
})
test('완료·취소는 요약에서 제외하고 진행·대기를 실제 기한에 포함한다', () => {
  const result = summarizeTasks([task('a','2026-10-18'),task('b',date,'doing'),task('c','2026-10-20','waiting'),task('d'),task('e',date,'done'),task('f','2026-10-18','cancelled')],date)
  assert.equal(result.total,4)
  assert.deepEqual(result.counts,{overdue:1,today:1,upcoming:1,none:1})
  assert.equal(Object.values(result.counts).reduce((sum,n)=>sum+n,0),result.total)
  assert.deepEqual(result.items.map(item=>item.reason),['기한 지남','오늘까지','예정','기한 없음'])
})
test('홈은 최대 네 원본을 기한순으로 보이고 전체 건수는 숨기지 않는다', () => {
  const tasks=[task('future','2027-01-01'),task('none'),task('today',date),task('old','2026-10-01'),task('tomorrow','2026-10-20'),task('older','2026-09-01')]
  const before=structuredClone(tasks), result=summarizeTasks(tasks,date)
  assert.equal(result.total,6);assert.equal(result.items.length,4)
  assert.deepEqual(result.items.map(item=>item.task.id),['older','old','today','tomorrow'])
  assert.deepEqual(tasks,before)
})
test('기한과 제목이 같아도 원본 ID로 안정된 순서를 유지한다', () => {
  const tasks=[task('z',date,'todo',{title:'같은 제목'}),task('a',date,'todo',{title:'같은 제목'})]
  assert.deepEqual(summarizeTasks(tasks,date).items.map(item=>item.task.id),['a','z'])
})
test('전부 완료 또는 빈 목록은 실제 확인된 0건이며 표시할 원본이 없다', () => {
  for(const tasks of [[],[task('a',date,'done'),task('b','','cancelled')]]) {
    const result=summarizeTasks(tasks,date)
    assert.equal(result.total,0);assert.deepEqual(result.items,[]);assert(Object.values(result.counts).every(value=>value===0))
  }
})
test('메모 발췌는 개행을 정리하고 이모지를 자르지 않으며 원문을 바꾸지 않는다', () => {
  assert.equal(taskNoteExcerpt('  첫째\n\t둘째  '),'첫째 둘째')
  const notes='😀'.repeat(91)
  const result=taskNoteExcerpt(notes)
  assert.equal(result,'😀'.repeat(90)+'…');assert.equal(Array.from(result).length,91);assert.equal(notes.length,182)
  assert.equal(taskNoteExcerpt('짧은 메모'),'짧은 메모');assert.equal(taskNoteExcerpt(' \n '),'')
})
test('원본 조회보다 오래된 목록이 늦게 와도 확인한 최신 판을 유지한다', () => {
  const older=task('a',date), selected={...older,title:'최신 원본',version:2}
  const result=withSelectedTask([older,task('b')],selected)
  assert.equal(result.length,2);assert.equal(result[0].version,2);assert.equal(result[0].title,'최신 원본');assert.equal(older.version,1)
})
test('목록이 더 최신이면 원본 조회 응답으로 되돌리지 않으며 누락 원본은 한 번만 합친다', () => {
  const selected=task('a',date), newer={...selected,version:3,title:'목록 최신 판'}
  assert.deepEqual(withSelectedTask([newer],selected),[newer])
  assert.deepEqual(withSelectedTask([],selected),[selected])
  assert.equal(withSelectedTask(withSelectedTask([],selected),selected).length,1)
})
test('조회 중·조회 실패에는 이전 업무가 있어도 숫자와 이동 요약을 렌더하지 않는다', () => {
  for(const state of ['loading','error']) {
    assert.equal(renderSummary({tasks:[task('a',date)],state}),'')
    assert.equal(renderSummary({tasks:null,state}),'')
  }
})
test('확인된 요약의 네 버튼은 기한과 건수를 접근 가능한 이름으로 제공한다', () => {
  const html=renderSummary({tasks:[task('a',date),task('b','2026-10-18')]})
  assert.match(html,/role="group" aria-label="개인 업무 기한 요약"/)
  for(const label of ['기한 지남 업무 1개 보기','오늘까지 업무 1개 보기','예정 업무 0개 보기','기한 없음 업무 0개 보기'])assert(html.includes(`aria-label="${label}"`))
  assert.equal((html.match(/<button /g)||[]).length,4)
})
test('작성 중 또는 이동 경로가 없으면 기한 요약의 모든 이동을 잠근다', () => {
  for(const props of [{disabled:true},{onOpenTasks:undefined}]) {
    const html=renderSummary({tasks:[],...props})
    assert.equal((html.match(/disabled=""/g)||[]).length,4)
  }
})
test('초기 TaskPanel SSR은 조회 중을 표시하며 거짓 0건과 과거 요약을 내보내지 않는다', () => {
  const html=text(renderInitialPanel())
  assert.match(html,/내 업무 확인 중/);assert.match(html,/내 업무를 불러오는 중/)
  assert(!html.includes('진행할 업무 0개'));assert(!html.includes('개인 업무 기한 요약'));assert(!html.includes('현재 분류 0개'))
})
console.log(`\n홈 업무 요약 ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
