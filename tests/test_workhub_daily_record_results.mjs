import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const {copyWorkflowResult: copy, workflowResultLabel: label, captureWorkflowPlanOrigin: capture,
  recordWorkflowPlanResult: record, recordWorkspacePlanOutcome: mark, specialistWorkflows, renderPlan} = await loadBrowserModule(`
export * from '../apps/workhub/src/app/workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-control.ts'
export * from '../apps/workhub/src/assistant/specialist-workflows.ts'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {WorkspacePlanCard} from '../apps/workhub/src/assistant/WorkspacePlanCard.tsx'
export function renderPlan(saved) { return renderToStaticMarkup(createElement(WorkspacePlanCard, {hasInput:false, model:{saved,manageable:true,selectable:true,stale:false,blockedSelection:false,nextStep:undefined,dismiss(){},choose(){},restoreOriginal(){}}})) }
`)
const scope = 'school/member/user', date = '2026-11-12', stamp = '2026-11-12T01:02:03.000Z'
const base = {scope, key: 'first-request', recordedAt: stamp}
const cooperation = {...base, kind: 'cooperation', action: 'create', requestId: 'cooperation-a', requestVersion: 1}
const calendar = {...base, kind: 'calendar', action: 'create', eventId: 'calendar-a', eventVersion: 1}
const batch = {...base, kind: 'calendar_batch', action: 'commit', prepareId: 'prepare-a', events: [{eventId: 'calendar-a', eventVersion: 2}, {eventId: 'calendar-b', eventVersion: 1}]}
const observation = {...base, kind: 'teaching', action: 'observation_save', courseId: 'course-a', entityId: 'observation-a', entityVersion: 1}
const teaching = (action, fields = {}) => ({...observation, action, ...fields})
const samples = [cooperation, calendar, batch, observation]
const pages = ['cooperation', 'calendar', 'calendar', 'students']
const teachingSamples = [
  teaching('course_create', {entityId: 'course-a'}), teaching('roster_import', {entityId: 'course-a', entityVersion: 2}), observation,
  teaching('record_withdraw', {recordKind: 'observation', entityVersion: 2}), teaching('rubric_save', {entityId: 'rubric-a'}),
  teaching('assessment_save', {entityId: 'assessment-a', confirmed: false}), teaching('activity_review', {entityId: 'activity-a', disposition: 'hold'}),
  teaching('activity_import', {entityId: 'import-a'}), teaching('activity_correct', {entityId: 'import-b', previousImportId: 'import-a'}),
]
function saved(command = {kind: 'navigate', page: 'students'}) {
  return {scope, selectedId: 'step-1', plan: {kind: 'plan', prompt: '전체 업무 요청', basisDate: date, steps: [
    {id: 'step-1', prompt: '첫 업무 원문', label: '첫 업무', command},
    {id: 'step-2', prompt: '다음 업무 원문', label: '다음 업무', command: {kind: 'navigate', page: 'calendar'}},
  ]}}
}
const origin = (value, target) => capture(value, value.plan.steps[0].prompt, scope, date, target)
const rows = state => state.outcomes?.['step-1']?.results ?? []
const add = (state, bound, result) => record(state, bound, result, scope, date)
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
const secret = {reason: '민감한 사유', body: '학생 본문 비공개', studentId: 'secret-student', studentName: '비공개 학생', scores: [{score: 99}], command: {token: 'private-command'}, members: ['private-member']}
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }

test('협업의 접수·수락·완료 요청·확인·보완·철회·취소를 최소 접수 필드로 복사한다', () => {
  for (const action of ['create', 'accept', 'decline', 'request_completion', 'confirm_completion', 'return_completion', 'retract_completion', 'cancel']) {
    const expected = {...cooperation, action, requestVersion: action === 'create' ? 1 : 3}
    assert.deepEqual(copy({...expected, ...secret}), expected)
  }
})
test('협업 수락과 완료 요청을 최종 완료 확인으로 표시하지 않는다', () => {
  assert.match(label(cooperation), /접수.*응답 대기/)
  assert.match(label({...cooperation, action: 'accept'}), /수락.*진행 중/)
  assert.match(label({...cooperation, action: 'request_completion'}), /확인 요청.*대기/)
  assert.equal(label({...cooperation, action: 'confirm_completion'}), '협업 완료 확인')
  for (const [action, word] of [['decline', '반려'], ['return_completion', '보완'], ['retract_completion', '철회'], ['cancel', '취소']]) assert.match(label({...cooperation, action}), new RegExp(word))
})
test('일정 등록·수정은 원본 번호와 저장판·서버 시각만 복사한다', () => {
  assert.deepEqual(copy({...calendar, ...secret}), calendar)
  const update = {...calendar, action: 'update', eventVersion: 2}
  assert.deepEqual(copy({...update, ...secret}), update)
  assert.equal(label(calendar), '일정 등록'); assert.equal(label(update), '일정 변경 저장')
})
test('일괄 일정은 접수한 전체 원본판을 깊게 복사하며 원본 행·본문을 담지 않는다', () => {
  const raw = {...batch, ...secret, events: batch.events.map(item => ({...item, ...secret, sourceId: 'private-source'}))}, result = copy(raw)
  assert.deepEqual(result, batch); assert.notEqual(result.events, raw.events); assert.notEqual(result.events[0], raw.events[0])
  assert.match(label(result), /일괄.*2건 접수/)
})
test('수업·명부·관찰·평가·활동 결과에서 학생·근거 본문을 복제하지 않는다', () => {
  for (const sample of teachingSamples) assert.deepEqual(copy({...sample, ...secret, sourceText: '원문 비공개', evidence: [{student: '비공개'}]}), sample)
})
test('평가 초안과 확인 저장, 관찰·평가 철회를 명확히 구분한다', () => {
  assert.equal(label(teaching('assessment_save', {confirmed: false})), '평가 초안 저장')
  assert.equal(label(teaching('assessment_save', {confirmed: true})), '평가 확인 저장')
  assert.equal(label(teaching('record_withdraw', {recordKind: 'observation'})), '관찰 기록 철회')
  assert.equal(label(teaching('record_withdraw', {recordKind: 'assessment'})), '평가 기록 철회')
  assert.equal(label(teaching('course_create')), '수업 등록'); assert.equal(label(teaching('roster_import')), '수강 명부 반영'); assert.equal(label(teaching('rubric_save')), '평가 기준판 저장')
})
test('활동 보류·채택·제외·철회와 가져오기·정정 후 재검토를 구분한다', () => {
  for (const [disposition, word] of [['hold', '보류'], ['adopt', '채택'], ['exclude', '제외'], ['withdraw', '철회']]) assert.equal(label(teaching('activity_review', {disposition})), '활동 근거 ' + word)
  assert.match(label(teaching('activity_import')), /가져오기.*검토 필요/)
  assert.match(label(teaching('activity_correct')), /정정.*재검토 필요/)
})
test('공통 범위·원키·접수 시각·작성 출처가 손상되면 새 네 종류 결과를 거부한다', () => {
  const broken = [{scope: ''}, {scope: null}, {scope: 'x\u0000'}, {key: ''}, {key: 42}, {key: 'x'.repeat(513)}, {recordedAt: 'bad-time'}, {recordedAt: undefined}, {composeId: ''}, {composeId: 1}, {composeId: 'bad\nvalue'}]
  for (const sample of samples) for (const patch of broken) assert.equal(copy({...sample, ...patch}), undefined, JSON.stringify({kind: sample.kind, patch}))
})
test('알 수 없는 처리와 상담 저장은 결과로 복제하지 않는다', () => {
  for (const sample of samples) for (const action of ['unknown', '', null, 'counseling_save', 'counseling_update', 'counseling_delete']) assert.equal(copy({...sample, action}), undefined)
})
test('협업 신규·일정 신규는 1판만 인정하며 식별자와 판 손상을 거부한다', () => {
  for (const [sample, id, version] of [[cooperation, 'requestId', 'requestVersion'], [calendar, 'eventId', 'eventVersion']]) {
    for (const value of [0, -1, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2]) assert.equal(copy({...sample, [version]: value}), undefined)
    for (const value of ['', null, 1, 'bad\u0007']) assert.equal(copy({...sample, [id]: value}), undefined)
  }
})
test('일괄 원본 묶음 누락·빈 행·잘못된 행·중복 원본 번호를 거부한다', () => {
  for (const events of [undefined, null, [], 'events', [null], [{}], [{eventId: 'x', eventVersion: 0}], [{eventId: '', eventVersion: 1}], [batch.events[0], batch.events[0]]]) assert.equal(copy({...batch, events}), undefined)
  for (const prepareId of ['', null, 1, 'bad\n']) assert.equal(copy({...batch, prepareId}), undefined)
})
test('수업 결과의 수업·대상 번호와 판을 추측하거나 숫자 문자열로 보정하지 않는다', () => {
  for (const patch of [{courseId: ''}, {courseId: null}, {entityId: ''}, {entityId: 1}, {entityVersion: 0}, {entityVersion: '1'}, {entityVersion: 1.5}]) assert.equal(copy({...observation, ...patch}), undefined)
})
test('신규 수업은 수업 번호와 생성 대상 번호가 같고 1판이어야 한다', () => {
  assert.equal(copy(teaching('course_create')), undefined)
  assert.equal(copy(teaching('course_create', {entityId: 'course-a', entityVersion: 2})), undefined)
  assert(copy(teaching('course_create', {entityId: 'course-a'})))
})
test('철회는 관찰·평가 원본 종류가 명시되어야 한다', () => {
  for (const recordKind of [undefined, null, '', true, 'counseling', 'observation_save']) assert.equal(copy(teaching('record_withdraw', {recordKind})), undefined)
  for (const recordKind of ['observation', 'assessment']) assert(copy(teaching('record_withdraw', {recordKind})))
})
test('평가 저장은 확인 여부가 실제 boolean이어야 한다', () => {
  for (const confirmed of [undefined, null, '', 'true', 0, 1, {}]) assert.equal(copy(teaching('assessment_save', {confirmed})), undefined)
  for (const confirmed of [true, false]) assert.equal(copy(teaching('assessment_save', {confirmed})).confirmed, confirmed)
})
test('활동 검토는 네 가지 처리 구분이 반드시 필요하다', () => {
  for (const disposition of [undefined, null, '', true, 'accepted', 'confirmed']) assert.equal(copy(teaching('activity_review', {disposition})), undefined)
  for (const disposition of ['hold', 'adopt', 'exclude', 'withdraw']) assert.equal(copy(teaching('activity_review', {disposition})).disposition, disposition)
})
test('활동 정정은 다른 이전 가져오기 번호와 새 원본 1판을 요구한다', () => {
  const corrected = teaching('activity_correct', {entityId: 'import-b', previousImportId: 'import-a'})
  assert.deepEqual(copy(corrected), corrected)
  for (const patch of [{previousImportId: undefined}, {previousImportId: ''}, {previousImportId: 1}, {previousImportId: 'import-b'}, {entityVersion: 2}]) assert.equal(copy({...corrected, ...patch}), undefined)
})
test('다른 처리 종류의 선택 메타는 섞이지 않고 필요한 항목만 복사된다', () => {
  assert.deepEqual(copy({...observation, confirmed: true, recordKind: 'assessment', disposition: 'adopt', previousImportId: 'private-import'}), observation)
  const assessment = teaching('assessment_save', {confirmed: true})
  assert.deepEqual(copy({...assessment, disposition: 'adopt', recordKind: 'observation', previousImportId: 'private-import'}), assessment)
})
test('계획 결과의 SSR에도 학생·사유 본문 없이 단계별 접수만 표시된다', () => {
  const value = saved(), bound = origin(value), state = add(value, bound, {...observation, ...secret}), html = renderPlan(state)
  assert.match(html, /관찰 기록 저장/); assert.doesNotMatch(html, /민감한 사유|학생 본문 비공개|secret-student|비공개 학생|private-command/)
})
test('선택한 계획·단계·정확한 원문과 조회 대상을 출처로 고정한다', () => {
  const value = saved(), target = {kind: 'course', id: 'course-a'}, bound = origin(value, target)
  assert.equal(bound.plan, value.plan); assert.equal(bound.stepId, 'step-1'); assert.deepEqual(bound.target, target); assert.notEqual(bound.target, target)
  assert.equal(capture(value, '첫 업무 원문 ', scope, date), undefined); assert.equal(origin({...value, selectedId: undefined}), undefined)
})
test('학교·현재 범위·기준일이 바뀌거나 결과의 범위가 다르면 추가하지 않는다', () => {
  samples.forEach((sample, index) => {
    const value = saved({kind: 'navigate', page: pages[index]}), bound = origin(value)
    assert.equal(record(value, bound, sample, 'other-scope', date), value); assert.equal(record(value, bound, sample, scope, '2026-11-13'), value)
    assert.equal(add(value, bound, {...sample, scope: 'other-scope'}), value)
    const changed = {...value, scope: 'other-scope'}; assert.equal(add(changed, bound, sample), changed)
  })
})
test('같은 번호·문구를 재사용한 새 계획에는 이전의 늦은 결과를 붙이지 않는다', () => {
  samples.forEach((sample, index) => {
    const value = saved({kind: 'navigate', page: pages[index]}), bound = origin(value), changed = {...value, plan: structuredClone(value.plan)}
    assert.equal(rows(add(value, bound, sample)).length, 1)
    assert.equal(add(changed, bound, sample), changed)
  })
})
test('각 업무의 메뉴 진입 결과를 일치하는 메뉴 단계에만 연결한다', () => {
  samples.forEach((sample, index) => { for (const page of ['cooperation', 'calendar', 'students', 'messages']) { const value = saved({kind: 'navigate', page}), result = add(value, origin(value), sample); assert.equal(rows(result).length, page === pages[index] ? 1 : 0) } })
})
test('기존 개인 일정 명령의 확정 접수와 일정 편집기 결과를 중복 연결하지 않는다', () => {
  const value = saved({kind: 'calendar', title: '개인 일정', date}), bound = origin(value)
  assert.equal(add(value, bound, calendar), value); assert.equal(add(value, bound, batch), value)
  const confirmed = {...value, outcomes: {'step-1': {kind: 'confirmed', receipt: {kind: 'calendarCreate', key: 'personal-key', id: 'calendar-a', title: '개인 일정', version: 1}}}}
  assert.equal(add(confirmed, bound, calendar), confirmed)
})
test('검색으로 선택한 협업·일정·수업 번호와 결과 원본이 정확히 일치해야 한다', () => {
  for (const [kind, sample, field] of [['cooperation', cooperation, 'requestId'], ['calendar', calendar, 'eventId'], ['course', observation, 'courseId']]) {
    const value = saved({kind: 'search', query: '선택한 원본', kinds: [kind]}), bound = origin(value, {kind, id: sample[field]})
    assert.equal(rows(add(value, bound, sample)).length, 1); assert.equal(add(value, bound, {...sample, [field]: 'different-target'}), value)
    assert.equal(add(value, origin(value, {kind: 'document', id: sample[field]}), sample), value)
  }
})
test('검색 종류가 다르면 같은 ID 문자열이라도 다른 업무 결과를 받지 않는다', () => {
  for (const kinds of [['message'], ['document'], ['collection']]) { const value = saved({kind: 'search', query: '자료', kinds}); for (const sample of samples) assert.equal(add(value, origin(value), sample), value) }
  const value = saved({kind: 'search', query: '일정', kinds: ['calendar']}); assert.equal(add(value, origin(value, {kind: 'calendar', id: 'calendar-a'}), batch), value)
})
test('관찰·평가·활동 전문작업은 해당 처리 종류만 연결한다', () => {
  const allowed = {teachingRecords: ['observation_save', 'record_withdraw'], teachingAssessment: ['rubric_save', 'assessment_save'], teachingActivity: ['activity_import', 'activity_review', 'activity_correct']}
  for (const [task, actions] of Object.entries(allowed)) for (const sample of teachingSamples) {
    const value = saved({kind: 'specialist', task}), result = add(value, origin(value), sample)
    assert.equal(rows(result).length, actions.includes(sample.action) ? 1 : 0, task + ':' + sample.action)
  }
  for (const [task, recordKind] of [['teachingRecords', 'assessment'], ['teachingAssessment', 'observation']]) { const value = saved({kind: 'specialist', task}); assert.equal(add(value, origin(value), teaching('record_withdraw', {recordKind})), value) }
  const value = saved({kind: 'specialist', task: 'teachingAssessment'}); assert.equal(rows(add(value, origin(value), teaching('record_withdraw', {recordKind: 'assessment'}))).length, 1)
})
test('시간표·학교관리 전문작업에 수업 기록이나 일상 업무 결과를 섞지 않는다', () => {
  for (const task of Object.keys(specialistWorkflows).filter(task => !task.startsWith('teaching'))) { const value = saved({kind: 'specialist', task}); for (const sample of samples) assert.equal(add(value, origin(value), sample), value) }
})
test('수업 메뉴와 전문작업에서도 상담 저장·상담 철회는 결과로 인정하지 않는다', () => {
  for (const command of [{kind: 'navigate', page: 'students'}, {kind: 'specialist', task: 'teachingRecords'}, {kind: 'search', query: '학생', kinds: ['course']}]) {
    const value = saved(command), bound = origin(value)
    for (const action of ['counseling_save', 'counseling_withdraw']) assert.equal(add(value, bound, teaching(action)), value)
    assert.equal(add(value, bound, teaching('record_withdraw', {recordKind: 'counseling'})), value)
  }
})
test('협업은 첫 요청에 고정하고 같은 요청의 단계별 접수만 이어 붙인다', () => {
  const value = saved({kind: 'navigate', page: 'cooperation'}), bound = origin(value); let state = add(value, bound, cooperation)
  for (const [index, action] of ['accept', 'request_completion', 'return_completion', 'request_completion', 'confirm_completion'].entries()) state = add(state, bound, {...cooperation, action, key: 'stage-' + index, requestVersion: index + 2})
  assert.equal(rows(state).length, 6); assert.equal(add(state, bound, {...cooperation, key: 'another-request', requestId: 'cooperation-b'}), state)
})
test('일정은 첫 원본을 고정하고 단일·일괄 결과를 한 단계에 혼합하지 않는다', () => {
  const value = saved({kind: 'navigate', page: 'calendar'}), bound = origin(value), first = add(value, bound, calendar)
  const changed = add(first, bound, {...calendar, key: 'update-key', action: 'update', eventVersion: 2}); assert.equal(rows(changed).length, 2)
  assert.equal(add(changed, bound, {...calendar, key: 'other-key', eventId: 'calendar-other'}), changed); assert.equal(add(changed, bound, batch), changed)
  const grouped = add(value, bound, batch); assert.equal(add(grouped, bound, calendar), grouped); assert.equal(add(grouped, bound, {...batch, key: 'other-key', prepareId: 'prepare-b'}), grouped)
})
test('같은 수업의 다른 학생 기록이나 다른 수업의 같은 번호는 첫 기록에 합치지 않는다', () => {
  const value = saved(), bound = origin(value), first = add(value, bound, observation)
  for (const patch of [{entityId: 'other-student-record'}, {courseId: 'other-course'}]) assert.equal(add(first, bound, {...observation, key: 'another-key', ...patch}), first)
  assert.equal(add(first, bound, teaching('assessment_save', {key: 'assessment-key', confirmed: false})), first)
})
test('관찰 저장에서 같은 관찰 원본 철회만 이어 기록한다', () => {
  const value = saved({kind: 'specialist', task: 'teachingRecords'}), bound = origin(value), first = add(value, bound, observation)
  const withdrawn = teaching('record_withdraw', {key: 'withdraw-key', recordKind: 'observation', entityVersion: 2})
  assert.equal(rows(add(first, bound, withdrawn)).length, 2)
  assert.equal(add(first, bound, {...withdrawn, entityId: 'other-record'}), first); assert.equal(add(first, bound, {...withdrawn, recordKind: 'assessment'}), first)
})
test('평가 초안·확인·철회는 같은 평가 기록과 종류를 고정한다', () => {
  const value = saved({kind: 'specialist', task: 'teachingAssessment'}), bound = origin(value)
  let state = add(value, bound, teaching('assessment_save', {entityId: 'assessment-a', confirmed: false}))
  state = add(state, bound, teaching('assessment_save', {key: 'confirm-key', entityId: 'assessment-a', entityVersion: 2, confirmed: true}))
  state = add(state, bound, teaching('record_withdraw', {key: 'withdraw-key', entityId: 'assessment-a', entityVersion: 3, recordKind: 'assessment'}))
  assert.deepEqual(rows(state).map(item => item.action), ['assessment_save', 'assessment_save', 'record_withdraw'])
})
test('활동 검토의 후속 처리도 같은 근거 항목만 허용한다', () => {
  const value = saved({kind: 'specialist', task: 'teachingActivity'}), bound = origin(value), sample = teaching('activity_review', {entityId: 'activity-a', disposition: 'hold'}), first = add(value, bound, sample)
  assert.equal(rows(add(first, bound, {...sample, key: 'adopt-key', disposition: 'adopt', entityVersion: 2})).length, 2)
  assert.equal(add(first, bound, {...sample, key: 'other-key', entityId: 'other-activity'}), first)
  assert.equal(add(first, bound, teaching('activity_import', {key: 'import-key', entityId: 'activity-a'})), first)
})
test('활동 가져오기 뒤 정정은 새 ID의 1판을 직전 최신 자료에만 연결한다', () => {
  const value = saved({kind: 'specialist', task: 'teachingActivity'}), bound = origin(value), imported = teaching('activity_import', {entityId: 'import-a'})
  const first = add(value, bound, imported), second = add(first, bound, teaching('activity_correct', {key: 'correct-b', entityId: 'import-b', previousImportId: 'import-a'}))
  const third = add(second, bound, teaching('activity_correct', {key: 'correct-c', entityId: 'import-c', previousImportId: 'import-b'}))
  assert.deepEqual(rows(third).map(item => item.entityId), ['import-a', 'import-b', 'import-c'])
  for (const previousImportId of ['import-a', 'import-b', 'unrelated']) assert.equal(add(third, bound, teaching('activity_correct', {key: 'stale-key', entityId: 'import-d', previousImportId})), third)
  assert.equal(add(third, bound, teaching('activity_correct', {key: 'wrong-course', courseId: 'course-b', entityId: 'import-d', previousImportId: 'import-c'})), third)
})
test('이전에 가져온 자료의 정정부터 시작해도 다음 정정의 연결을 정확히 유지한다', () => {
  const value = saved({kind: 'specialist', task: 'teachingActivity'}), bound = origin(value)
  const first = add(value, bound, teaching('activity_correct', {entityId: 'import-b', previousImportId: 'import-a'}))
  const second = add(first, bound, teaching('activity_correct', {key: 'next-key', entityId: 'import-c', previousImportId: 'import-b'}))
  assert.equal(rows(second).length, 2); assert.equal(add(second, bound, teaching('activity_correct', {key: 'old-key', entityId: 'import-d', previousImportId: 'import-a'})), second)
})
test('정정 뒤 과거 가져오기 결과를 다른 키로 다시 붙여 최신 계보를 되돌리지 않는다', () => {
  const value = saved({kind: 'specialist', task: 'teachingActivity'}), bound = origin(value), imported = teaching('activity_import', {entityId: 'import-a'})
  const first = add(value, bound, imported), corrected = add(first, bound, teaching('activity_correct', {key: 'correct-key', entityId: 'import-b', previousImportId: 'import-a'}))
  assert.equal(add(corrected, bound, {...imported, key: 'late-old-import'}), corrected)
})
test('같은 요청 번호의 재시도·변형 결과는 종류별로 중복 추가하지 않는다', () => {
  samples.forEach((sample, index) => { const value = saved({kind: 'navigate', page: pages[index]}), bound = origin(value), first = add(value, bound, sample); assert.equal(add(first, bound, structuredClone(sample)), first); assert.equal(add(first, bound, {...sample, recordedAt: '2026-11-12T02:00:00Z'}), first); assert.equal(rows(first).length, 1) })
})
test('현재 선택 단계가 바뀌어도 원래 단계에만 접수하고 확정된 개인 업무는 덮지 않는다', () => {
  const value = saved(), bound = origin(value), changed = {...value, selectedId: 'step-2'}, result = add(changed, bound, observation)
  assert.equal(rows(result).length, 1); assert.equal(result.outcomes['step-2'], undefined)
  const confirmed = {...value, outcomes: {'step-1': {kind: 'confirmed', receipt: {kind: 'taskChange', key: 'task-key', id: 'task', title: '내 업무', version: 1}}}}
  assert.equal(add(confirmed, bound, observation), confirmed); assert.equal(origin(confirmed), undefined)
  assert.equal(mark(result, '첫 업무 원문', 'opened', scope, date), result)
})
test('원본 계획·접수 자료를 변경하지 않고 외부 배열 변경도 기록에 전파하지 않는다', () => {
  const value = freeze(saved({kind: 'navigate', page: 'calendar'})), original = JSON.stringify(value), raw = structuredClone(batch), state = add(value, origin(value), raw)
  assert.equal(JSON.stringify(value), original); assert.equal(state.plan, value.plan)
  raw.events[0].eventId = 'mutated'; raw.events.push({eventId: 'new', eventVersion: 1})
  assert.deepEqual(rows(state)[0].events, batch.events)
})
console.log(`일상 업무·수업 기록 결과 연결: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
