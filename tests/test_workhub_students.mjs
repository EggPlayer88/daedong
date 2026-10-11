// 합성 학생 계약의 권한·기간·불변 이력·외부 원자료 정정을 실제 코드로 검사한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createStudentStore, createStudentFixture, within, fixtureData, renderStudents } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { StudentsPanel } from '../apps/workhub/src/students/StudentsPanel.tsx'
  import { createStudentStore } from '../apps/workhub/src/students/store.ts'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { createStudentStore, createStudentFixture, within } from '../apps/workhub/src/students/store.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export function renderStudents(member, members, date, store) { return renderToStaticMarkup(<StudentsPanel member={member} members={members} date={date} store={store} />) }
`)
let failures = 0
let passed = 0
function test(name, run) { try { run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failures++; console.log(`  ✗ ${name}: ${error.stack || error}`) } }
const members = fixtureData.memberships
const date = fixtureData.basisDate
const teacher = members.find(item => item.id === 'gaon-soyeon')
const manager = members.find(item => item.id === 'gaon-minjun')
const second = members.find(item => item.id === 'gaon-seojin')
const foreign = members.find(item => item.id === 'nuri-soyeon')
const make = options => createStudentStore({ members, date, ...options })
const code = (action, expected) => assert.throws(action, error => error.code === expected)
function draft(store, member = teacher) {
  const course = store.listCourses(member.id)[0]
  const student = store.listStudents(member.id, course.id)[0]
  return { courseId: course.id, studentId: student.id, enrollmentId: student.enrollmentId, observedAt: date, activity: '합성 토의', content: '자료 공유 전에 출처를 확인해야 한다고 설명함.', confirmed: true }
}
function event(store, changes = {}) { return { eventId: 'event-1', sourceSystem: 'synthetic-lesson', activityId: 'activity-1', itemId: 'response-1', revision: 1, operation: 'upsert', courseId: store.listCourses(teacher.id)[0].id, occurredAt: date, questionVersion: 'question-v1', question: '자료를 공유할 때 확인할 점은?', answer: '출처를 확인한다.', alias: '가상 별명', ...changes } }
function adopted(store) {
  const source = store.receiveActivity(teacher.id, event(store))
  const data = draft(store)
  const mapped = store.confirmMapping(teacher.id, source.id, 1, data.studentId, data.enrollmentId, 0, 'mapping')
  const record = store.adoptActivity(teacher.id, mapped.id, 1, 1, '공유 시 출처 확인이 필요하다고 답함.', true, 'adopt')
  return { source, record, data }
}

test('합성 명부는 학교별 불변 학생 ID와 학년도 학급·학적·수강을 분리한다', () => {
  const state = make().exportState()
  assert.equal(state.kind, 'synthetic-students-v1')
  assert(state.students.every(student => !('grade' in student) && !('number' in student)))
  assert.equal(new Set(state.students.map(item => item.id)).size, state.students.length)
  assert(state.enrollments.every(item => item.studentId && item.classId && item.from < item.until))
})
test('담당 배정은 승인과 기간 모두 맞아야 하며 본인 과목 신고로 조회권이 생기지 않는다', () => {
  const state = createStudentFixture(members, date)
  state.assignments.filter(item => item.userId === teacher.userId && item.schoolId === teacher.schoolId).forEach(item => { item.approved = false })
  const store = make({ snapshot: state })
  assert.equal(store.listCourses(teacher.id).length, 0)
  code(() => store.listStudents(teacher.id, state.courses[0].id), 'NOT_FOUND')
})
test('학적·수강·배정 기간의 시작은 포함하고 종료는 제외한다', () => {
  assert(within('2026-03-01', { from: '2026-03-01', until: '2027-03-01' }))
  assert(!within('2027-03-01', { from: '2026-03-01', until: '2027-03-01' }))
  const store = make()
  assert.equal(store.listCourses(teacher.id, '2027-03-01').length, 0)
})
test('다른 학교의 수업·학생·학적을 요청해도 자료가 반환되지 않는다', () => {
  const store = make(); const otherDraft = draft(store, foreign)
  code(() => store.listStudents(teacher.id, otherDraft.courseId), 'NOT_FOUND')
  code(() => store.createObservation(teacher.id, { ...draft(store), studentId: otherDraft.studentId, enrollmentId: otherDraft.enrollmentId }, 'cross'), 'PERIOD_MISMATCH')
  assert.equal(store.listRecords(teacher.id).length, 0)
})
test('학생과 학적 ID를 서로 뒤바꾸면 저장되지 않는다', () => {
  const store = make(); const data = draft(store); const roster = store.listStudents(teacher.id, data.courseId)
  code(() => store.createObservation(teacher.id, { ...data, enrollmentId: roster[1].enrollmentId }, 'wrong'), 'PERIOD_MISMATCH')
})
test('학생이 수강하거나 재적하지 않은 관찰일의 저장을 거부한다', () => {
  const state = createStudentFixture(members, date); state.enrollments[0].until = date
  state.courseMemberships.filter(item => item.enrollmentId === state.enrollments[0].id).forEach(item => { item.until = date })
  const store = make({ snapshot: state }); const course = store.listCourses(teacher.id)[0]
  code(() => store.createObservation(teacher.id, { courseId: course.id, studentId: state.students[0].id, enrollmentId: state.enrollments[0].id, observedAt: date, activity: '합성', content: '확인 사실', confirmed: true }, 'ended'), 'PERIOD_MISMATCH')
})
test('미래·없는 날짜·빈 내용·사실 미확인 입력은 안전하게 거부한다', () => {
  const store = make(); const base = draft(store)
  for (const input of [null, {}, { ...base, observedAt: '2026-02-30' }, { ...base, observedAt: '2099-01-01' }, { ...base, content: '' }, { ...base, confirmed: false }]) code(() => store.createObservation(teacher.id, input, 'bad'), 'INVALID_INPUT')
})
test('작성 학교·작성자는 명령의 임의 필드가 아닌 현재 소속으로 정한다', () => {
  const store = make(); const record = store.createObservation(teacher.id, { ...draft(store), schoolId: foreign.schoolId, authorUserId: manager.userId }, 'record')
  assert.equal(record.schoolId, teacher.schoolId); assert.equal(record.authorUserId, teacher.userId)
})
test('관리자도 타인의 기록 목록·건수·직접조회·정정·철회에 예외가 없다', () => {
  const store = make(); const record = store.createObservation(teacher.id, draft(store), 'own')
  for (const member of [manager, second, foreign]) {
    assert.equal(store.listRecords(member.id).length, 0)
    code(() => store.getRecord(member.id, record.id), 'NOT_FOUND')
    code(() => store.withdrawObservation(member.id, record.id, 1, '시도', 'withdraw'), 'NOT_FOUND')
  }
  code(() => store.reviseObservation(manager.id, record.id, 1, draft(store, manager), '정정 시도', 'edit'), 'NOT_FOUND')
  assert(!store.exportEvidence(manager.id).includes(record.current.content))
})
test('종료 소속은 목록·직접조회·수신·저장·근거 출력 모두 차단한다', () => {
  const store = make(); const base = draft(store); const activity = event(store); const record = store.createObservation(teacher.id, base, 'record')
  store.setContext(members.map(item => item.id === teacher.id ? { ...item, active: false } : item), date)
  for (const action of [() => store.listCourses(teacher.id), () => store.listRecords(teacher.id), () => store.getRecord(teacher.id, record.id), () => store.createObservation(teacher.id, base, 'again'), () => store.receiveActivity(teacher.id, activity), () => store.exportEvidence(teacher.id)]) code(action, 'INACTIVE_MEMBERSHIP')
})
test('정정은 새 불변 개정본을 만들고 이전 내용과 학생 맥락을 보존한다', () => {
  const store = make(); const base = draft(store); const first = store.createObservation(teacher.id, base, 'create')
  const second = store.reviseObservation(teacher.id, first.id, 1, { ...base, content: '정정해 확인한 사실' }, '오타와 내용 확인', 'edit')
  assert.equal(second.current.version, 2); assert.equal(second.revisions[0].content, base.content)
  assert.equal(first.revisions.length, 1)
  second.revisions[0].content = '외부 변경'; assert.equal(store.getRecord(teacher.id, first.id).revisions[0].content, base.content)
})
test('동시 정정의 오래된 기대판과 사유 없는 정정을 거부한다', () => {
  const store = make(); const base = draft(store); const record = store.createObservation(teacher.id, base, 'create')
  store.reviseObservation(teacher.id, record.id, 1, { ...base, content: '첫 정정' }, '확인', 'a')
  code(() => store.reviseObservation(teacher.id, record.id, 1, { ...base, content: '둘째 정정' }, '확인', 'b'), 'CONFLICT')
  code(() => store.reviseObservation(teacher.id, record.id, 2, base, '', 'c'), 'INVALID_INPUT')
  assert.equal(store.getRecord(teacher.id, record.id).current.content, '첫 정정')
})
test('같은 저장 요청은 한 번만 반영하고 같은 키의 다른 내용을 거부한다', () => {
  const store = make(); const base = draft(store)
  const first = store.createObservation(teacher.id, base, 'same')
  assert.equal(store.createObservation(teacher.id, base, 'same').id, first.id)
  code(() => store.createObservation(teacher.id, { ...base, content: '다른 내용' }, 'same'), 'IDEMPOTENCY_CONFLICT')
  assert.equal(store.listRecords(teacher.id).length, 1)
})
test('철회는 이력을 남기고 출력에서 제외하며 직접 되살릴 수 없다', () => {
  const store = make(); const base = draft(store); const record = store.createObservation(teacher.id, base, 'create')
  const withdrawn = store.withdrawObservation(teacher.id, record.id, 1, '학생 재확인 필요', 'withdraw')
  assert.equal(withdrawn.revisions.length, 2); assert.equal(withdrawn.current.state, 'withdrawn')
  assert(!store.exportEvidence(teacher.id).includes(base.content))
  code(() => store.reviseObservation(teacher.id, record.id, 2, base, '복원 시도', 'restore'), 'CONFLICT')
})
test('같은 학교의 작성자는 새 학년도 유효 소속에서 과거 기록을 이력으로 정정한다', () => {
  const store = make(); const base = draft(store); const record = store.createObservation(teacher.id, base, 'record')
  const renewed = { ...teacher, id: 'renewed-membership', validFrom: '2027-03-01', validThrough: '2028-02-29' }
  store.setContext([renewed], '2027-04-01')
  const revised = store.reviseObservation(renewed.id, record.id, 1, { ...base, content: '작년 사실 정정' }, '작성자 과거 정정', 'past')
  assert.equal(revised.authorUserId, teacher.userId); assert.equal(revised.current.version, 2)
})
test('활동 수신만으로 학생 자동 연결이나 관찰 기록이 생기지 않는다', () => {
  const store = make(); const source = store.receiveActivity(teacher.id, event(store))
  assert.equal(source.state, 'received'); assert.equal(source.mapping, undefined)
  assert.equal(store.listRecords(teacher.id).length, 0)
})
test('동일 사건 중복은 한 번만 수신하고 같은 사건의 다른 내용은 격리한다', () => {
  const store = make(); const input = event(store)
  const first = store.receiveActivity(teacher.id, input)
  assert.equal(store.receiveActivity(teacher.id, input).id, first.id)
  code(() => store.receiveActivity(teacher.id, { ...input, answer: '바뀜' }), 'IDEMPOTENCY_CONFLICT')
  assert.equal(store.listActivities(teacher.id).length, 1)
})
test('원자료의 낮거나 같은 판은 다른 사건 ID여도 덮어쓰지 않는다', () => {
  const store = make(); store.receiveActivity(teacher.id, event(store, { revision: 2 }))
  code(() => store.receiveActivity(teacher.id, event(store, { eventId: 'old', revision: 1 })), 'STALE_SOURCE')
  code(() => store.receiveActivity(teacher.id, event(store, { eventId: 'same-revision', revision: 2, answer: '충돌 내용' })), 'STALE_SOURCE')
})
test('학교 범위는 수신 입력을 믿지 않고 현재 소속에서 정한다', () => {
  const store = make(); const source = store.receiveActivity(teacher.id, { ...event(store), schoolId: foreign.schoolId, ownerUserId: manager.userId })
  assert.equal(source.schoolId, teacher.schoolId); assert.equal(source.ownerUserId, teacher.userId)
  code(() => store.receiveActivity(foreign.id, event(store)), 'NOT_FOUND')
  assert.equal(store.listActivities(manager.id).length, 0)
})
test('학생 연결 확정에서도 다른 학교·틀린 학적·오래된 판을 거부한다', () => {
  const store = make(); const source = store.receiveActivity(teacher.id, event(store)); const other = draft(store, foreign); const base = draft(store)
  code(() => store.confirmMapping(teacher.id, source.id, 1, other.studentId, other.enrollmentId, 0, 'foreign'), 'PERIOD_MISMATCH')
  store.confirmMapping(teacher.id, source.id, 1, base.studentId, base.enrollmentId, 0, 'first')
  code(() => store.confirmMapping(teacher.id, source.id, 1, base.studentId, base.enrollmentId, 0, 'stale'), 'CONFLICT')
})
test('같은 원문판의 같은 학생 연결 재확인은 불필요한 개정과 재검토를 만들지 않는다', () => {
  const store = make(); const { source, record, data } = adopted(store)
  const repeated = store.confirmMapping(teacher.id, source.id, 1, data.studentId, data.enrollmentId, 1, 'same-again')
  assert.equal(repeated.mapping.revision, 1)
  assert.equal(store.getRecord(teacher.id, record.id).needsReview, false)
})
test('교사의 내용·확인·현재 매핑이 있어야 채택되고 중복 채택되지 않는다', () => {
  const store = make(); const source = store.receiveActivity(teacher.id, event(store)); const base = draft(store)
  code(() => store.adoptActivity(teacher.id, source.id, 1, 0, '확인 사실', true, 'unmapped'), 'STALE_SOURCE')
  store.confirmMapping(teacher.id, source.id, 1, base.studentId, base.enrollmentId, 0, 'map')
  code(() => store.adoptActivity(teacher.id, source.id, 1, 1, '확인 사실', false, 'unconfirmed'), 'INVALID_INPUT')
  const record = store.adoptActivity(teacher.id, source.id, 1, 1, '교사가 확인한 사실', true, 'adopt')
  assert.equal(record.current.source.sourceRevision, 1)
  assert.equal(store.adoptActivity(teacher.id, source.id, 1, 1, '교사가 확인한 사실', true, 'adopt').id, record.id)
  code(() => store.adoptActivity(teacher.id, source.id, 1, 1, '별도 중복', true, 'duplicate'), 'CONFLICT')
})
test('원자료 정정 직후 관찰을 재검토로 보고 출력과 조용한 덮어쓰기를 차단한다', () => {
  const store = make(); const { record, data } = adopted(store)
  store.receiveActivity(teacher.id, event(store, { eventId: 'event-2', revision: 2, answer: '수정한 답변', questionVersion: 'question-v2' }))
  const current = store.getRecord(teacher.id, record.id)
  assert(current.needsReview); assert.equal(current.revisions.length, 1)
  code(() => store.exportEvidence(teacher.id), 'STALE_SOURCE')
  code(() => store.reviseObservation(teacher.id, record.id, 1, data, '단순 덮어쓰기', 'edit'), 'STALE_SOURCE')
})
test('학생 연결 정정도 이전 채택 근거를 재검토로 만든다', () => {
  const store = make(); const { source, record, data } = adopted(store); const student = store.listStudents(teacher.id, data.courseId)[1]
  store.confirmMapping(teacher.id, source.id, 1, student.id, student.enrollmentId, 1, 'remap')
  assert(store.getRecord(teacher.id, record.id).needsReview)
  code(() => store.exportEvidence(teacher.id), 'STALE_SOURCE')
})
test('정정 후 철회·재연결·재채택하면 새 근거판으로 내보낼 수 있다', () => {
  const store = make(); const { source, record, data } = adopted(store)
  store.receiveActivity(teacher.id, event(store, { eventId: 'event-2', revision: 2, answer: '수정 답변' }))
  store.withdrawObservation(teacher.id, record.id, 1, '원자료 정정 반영', 'withdraw')
  store.confirmMapping(teacher.id, source.id, 2, data.studentId, data.enrollmentId, 1, 'map-again')
  store.adoptActivity(teacher.id, source.id, 2, 2, '정정 원문에서 확인한 사실', true, 'adopt-again')
  const text = store.exportEvidence(teacher.id)
  assert(text.includes('정정 원문에서 확인한 사실')); assert(text.includes(`${source.id}@2`))
  assert(!text.includes('공유 시 출처 확인이 필요하다고 답함.'))
})
test('원자료 철회는 즉시 출력 차단하며 삭제 이력은 재수신·복원 후 재생성을 막는다', () => {
  const store = make(); adopted(store)
  store.receiveActivity(teacher.id, event(store, { eventId: 'withdraw-event', revision: 2, operation: 'withdraw' }))
  code(() => store.exportEvidence(teacher.id), 'STALE_SOURCE')
  store.receiveActivity(teacher.id, event(store, { eventId: 'delete-event', revision: 3, operation: 'delete' }))
  const restored = make({ snapshot: store.exportState() })
  code(() => restored.receiveActivity(teacher.id, event(restored, { eventId: 'resurrect', revision: 4 })), 'DELETED_SOURCE')
  assert.equal(restored.receiveActivity(teacher.id, event(restored)).state, 'deleted')
})
test('복원한 상태는 불변 이력과 멱등 접수증을 유지하고 외부 스냅샷 수정에 영향받지 않는다', () => {
  const store = make(); const base = draft(store); const record = store.createObservation(teacher.id, base, 'create')
  const snapshot = store.exportState(); const restored = make({ snapshot })
  snapshot.observations[0].revisions[0].content = '외부 수정'
  assert.equal(restored.createObservation(teacher.id, base, 'create').id, record.id)
  assert.equal(restored.getRecord(teacher.id, record.id).current.content, base.content)
  restored.reset(); assert.equal(restored.listRecords(teacher.id).length, 0)
})
test('서로 다른 저장 형식과 깨진 개정 이력은 복원하지 않는다', () => {
  code(() => make({ snapshot: { kind: 'actual-students', schemaVersion: 1 } }), 'INVALID_INPUT')
  const store = make(); store.createObservation(teacher.id, draft(store), 'create')
  const state = store.exportState(); state.observations[0].revisions = [null]
  code(() => make({ snapshot: state }), 'INVALID_INPUT')
})
test('저장 콜백 실패는 메모리·개정판·접수증을 함께 유지하고 같은 키로 재시도할 수 있다', () => {
  let broken = false; const saved = []
  const store = make({ onChange: state => { if (broken) throw new Error('합성 저장 공간 부족'); saved.push(state) } })
  const base = draft(store); const first = store.createObservation(teacher.id, base, 'first'); const before = store.exportState()
  broken = true
  assert.throws(() => store.reviseObservation(teacher.id, first.id, 1, { ...base, content: '저장할 정정 내용' }, '확인', 'retry'), /저장 공간/)
  assert.deepEqual(store.exportState(), before)
  assert.throws(() => store.reset(), /저장 공간/)
  assert.deepEqual(store.exportState(), before)
  broken = false
  assert.equal(store.reviseObservation(teacher.id, first.id, 1, { ...base, content: '저장할 정정 내용' }, '확인', 'retry').current.version, 2)
  assert.equal(saved.length, 2)
})
test('신규 관찰·원자료의 저장 실패도 고아 객체와 성공 접수증을 남기지 않는다', () => {
  let broken = true
  const store = make({ onChange: () => { if (broken) throw new Error('합성 저장 실패') } })
  const before = store.exportState(); const base = draft(store); const input = event(store)
  assert.throws(() => store.createObservation(teacher.id, base, 'create'), /저장 실패/)
  assert.throws(() => store.receiveActivity(teacher.id, input), /저장 실패/)
  assert.deepEqual(store.exportState(), before)
  broken = false
  assert.equal(store.createObservation(teacher.id, base, 'create').current.version, 1)
  assert.equal(store.receiveActivity(teacher.id, input).current.revision, 1)
})
test('복원 시 다른 학교 참조·학생 학적 오연결·출처 판·상태 훼손을 거부한다', () => {
  const store = make(); adopted(store); const baseline = store.exportState()
  const changes = [
    state => { state.enrollments[0].schoolId = foreign.schoolId },
    state => { state.courses[0].classId = 'missing' },
    state => { state.assignments[0].courseId = 'missing' },
    state => { state.courseMemberships[0].studentId = 'missing' },
    state => { state.observations[0].revisions[0].source.sourceRevision = 99 },
    state => { state.observations[0].revisions[0].state = 'deleted' },
    state => { state.sources[0].revisions[0].operation = 'execute' },
    state => { state.sources[0].mappings[0].enrollmentId = 'missing' },
    state => { state.receipts[0].resultId = 'missing' },
  ]
  for (const change of changes) { const snapshot = structuredClone(baseline); change(snapshot); code(() => make({ snapshot }), 'INVALID_INPUT') }
})
test('근거 텍스트는 작성한 원문과 실제 기록판을 출력하고 AI 생기부 문장처럼 표시하지 않는다', () => {
  const store = make(); const record = store.createObservation(teacher.id, { ...draft(store), content: '<script>가상 원문</script>' }, 'record')
  const text = store.exportEvidence(teacher.id)
  assert(text.includes(`${record.id}@v1`)); assert(text.includes('<script>가상 원문</script>'))
  assert(text.includes('생기부 AI 초안이나 공식 입력 결과가 아닙니다.'))
})
test('실제 JSX는 합성 경계·명부·작성양식을 렌더하고 원문 HTML을 실행 가능한 태그로 만들지 않는다', () => {
  const store = make(); store.createObservation(teacher.id, { ...draft(store), content: '<script>가상 원문</script>' }, 'record')
  const html = renderStudents(teacher, members, date, store)
  assert(html.includes('합성 자료 전용')); assert(html.includes('내 학급 명부'))
  assert(html.includes('직접 확인한 사실')); assert(html.includes('근거 목록 텍스트 보기'))
  assert(html.includes('&lt;script&gt;가상 원문&lt;/script&gt;')); assert(!html.includes('<script>가상 원문</script>'))
})
test('소속 종료 JSX에는 이전 학생 이름과 기록이 렌더되지 않는다', () => {
  const store = make(); store.createObservation(teacher.id, draft(store), 'record')
  const ended = members.map(item => item.id === teacher.id ? { ...item, active: false } : item)
  const html = renderStudents(ended.find(item => item.id === teacher.id), ended, date, store)
  assert(html.includes('학교 소속이 종료')); assert(!html.includes('가상 학생 가')); assert(!html.includes('자료 공유 전에 출처'))
})

console.log(`학생 모듈: ${passed}개 통과, ${failures}개 실패 · 합성 계약 검증이며 서버 RLS 검증이 아님`)
if (failures) process.exitCode = 1
