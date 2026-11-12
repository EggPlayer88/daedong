import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/assistant/specialist-workflows.ts'; export * from '../apps/workhub/src/assistant/workspace-commands.ts'; export * from '../apps/workhub/src/assistant/delivery-workspace.tsx'; export * from '../apps/workhub/src/app/edit-drafts.tsx'`)
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.error('  ✗ ' + name, e) } }
const parse = text => m.parseWorkspaceCommand(text, '2026-11-11')
test('12개 전문 업무는 기존 세 모듈의 입구만 고르고 저장 명령·교사·학생을 만들지 않는다', () => {
  assert.equal(Object.keys(m.specialistWorkflows).length, 12)
  for (const [task, workflow] of Object.entries(m.specialistWorkflows)) {
    assert(['timetable', 'students', 'schoolAdmin'].includes(workflow.page))
    for (const alias of workflow.aliases) {
      const command = parse(alias + ' 준비해줘')
      assert.deepEqual(command, { kind: 'specialist', task })
    }
    assert.equal(workflow.steps.length, 3)
  }
})
test('전문 시작 예시는 모두 무료 업무 명령으로 이어지고 자동 저장을 뜻하지 않는다', () => {
  for (const profile of ['timetable', 'teaching', 'administration']) {
    assert.equal(m.specialistStarters(profile).length, 3)
    for (const text of m.specialistStarters(profile)) assert.equal(parse(text)?.kind, 'specialist', text)
  }
  assert.equal(m.specialistStarters('general'), undefined)
})
test('부정·인용·조건·복합 지시·동명 인물은 전문 업무로 부분 실행하지 않는다', () => {
  for (const text of ['시간표 교환 준비하지 마', '“시간표 교환 준비해줘”', '시간표 교환은 어떻게 하나요', '예시: 평가 기록 보여줘', '교사 명부라는 메뉴를 설명해줘', '김교사 평가 기록 보여줘', '이 학생 상담 기록 보여줘'])
    assert.notEqual(parse(text)?.kind, 'specialist', text)
  assert.equal(parse('시간표 교환 준비해줘; 학교 관리 열어줘').kind, 'clarify')
})
test('공개·승인·삭제를 직접 지시해도 전문 검토 없이 실행하지 않는다', () => {
  for (const text of ['시간표 공개해줘', '시간표 승인해줘', '학생 기록 삭제해줘', '교사에게 관리자 권한 부여해줘'])
    assert.notEqual(parse(text)?.kind, 'specialist', text)
  assert.equal(m.specialistWorkflow('__proto__'), undefined)
  assert.equal(m.specialistWorkflow(null), undefined)
})
test('기존 메뉴·수업 검색의 원문과 검색 종류를 유지한다', () => {
  assert.deepEqual(parse('시간표 열어줘'), {kind:'navigate',page:'timetable'})
  assert.deepEqual(parse('학생 기록 열어줘'), {kind:'navigate',page:'students'})
  assert.deepEqual(parse('수업에서 국어 찾아줘'), {kind:'search',query:'국어',kinds:['course']})
  assert.equal(m.deliveryKind('course'), 'students')
  assert.equal(m.deliveryKind('knowledge'), undefined)
  assert.equal(m.isDeliveryKind('__proto__'), false)
})
test('동적 수업·학기 초안도 업무 전환 전에 검사하며 다른 업무와 혼동하지 않는다', () => {
  assert(m.hasDeliveryDraft('students',['teaching-relations:course-2']))
  assert(m.hasDeliveryDraft('timetable',['timetable-candidates:[school,term]']))
  assert(m.hasDeliveryDraft('schoolAdmin',['teacher-roster-editor']))
  assert(m.hasDeliveryDraft('students',['school-data-maintenance']))
  assert(!m.hasDeliveryDraft('documents',['teaching-editor']))
  assert(!m.hasDeliveryDraft('messages',['messaging-composer-old']))
})
test('초안 슬롯 조회는 활성 범위의 미저장 입력만 반환하고 경로 표시·중지·다른 학교는 제외한다', () => {
  const store = m.createEditDrafts(true)
  store.activate('school-one')
  store.bind('school-one','teaching-relations:course-2').save({body:'보존'})
  store.bind('school-one','timetable-entry').save('operations',false)
  assert.deepEqual(store.dirtySlots('school-one'),['teaching-relations:course-2'])
  assert.deepEqual(store.dirtySlots('school-two'),[])
  store.suspend(); assert.deepEqual(store.dirtySlots('school-one'),[])
  store.activate('school-one'); assert.equal(store.bind('school-one','teaching-relations:course-2').initial.body,'보존')
  store.activate('school-two'); assert.deepEqual(store.dirtySlots('school-two'),[])
})
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
