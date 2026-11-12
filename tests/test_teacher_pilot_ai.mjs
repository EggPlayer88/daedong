import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { teacherPilotAccess, sameTeacherPilot, teacherPilotPages, teacherPilotModules, teacherPilotSearchSources } = await loadBrowserModule(`
 export {teacherPilotAccess,sameTeacherPilot,teacherPilotPages,teacherPilotModules,teacherPilotSearchSources} from '../apps/workhub/src/participation/teacher-pilot-access.ts';
`)
let passed = 0
function check(name, run) { run(); passed++; console.log('  ✓ ' + name) }
const now = Date.parse('2026-11-16T00:00:00.000Z')
const actor = { userId: 'test-user-01', memberId: 'test-member-01', schoolId: 'school-one' }
const allowed = { contract: 'workhub.teacher-pilot.v1', allowed: true, ...actor, batchId: 'pilot-ten', teacherId: 'roster-one', expiresAt: '2026-11-20T15:00:00.000Z', revision: 1 }
check('서버의 별도 TP1 허용만 승인', () => assert.deepEqual(teacherPilotAccess(allowed, actor, now), allowed))
check('거절 응답은 UI AI 권한 없음', () => assert.equal(teacherPilotAccess({ contract: allowed.contract, allowed: false, userId: actor.userId }, actor, now), null))
check('만료 경계는 허용하지 않음', () => assert.equal(teacherPilotAccess(allowed, actor, Date.parse(allowed.expiresAt)), null))
for (const [name, value] of [
  ['다른 사용자', { ...allowed, userId: 'other' }], ['다른 학교', { ...allowed, schoolId: 'other' }], ['다른 소속', { ...allowed, memberId: 'other' }],
  ['다른 계약', { ...allowed, contract: 'workhub.participant.v1' }], ['추가 관리자 권한', { ...allowed, canManage: true }],
  ['배치 누락', { ...allowed, batchId: null }], ['명부 누락', { ...allowed, teacherId: '' }], ['부정 판', { ...allowed, revision: 0 }],
  ['소수 판', { ...allowed, revision: 1.1 }], ['무한 만료', { ...allowed, expiresAt: 'infinity' }], ['날짜만', { ...allowed, expiresAt: '2026-12-01' }],
  ['존재하지 않는 날짜', { ...allowed, expiresAt: '2026-11-31T15:00:00.000Z' }], ['배열', []], ['빈 응답', null],
  ['거절 응답 필드 추가', { contract: allowed.contract, allowed: false, userId: actor.userId, schoolId: actor.schoolId }],
]) check(name + ' 거부', () => assert.throws(() => teacherPilotAccess(value, actor, now)))
check('응답 객체를 그대로 공유하지 않음', () => { const copy = teacherPilotAccess(allowed, actor, now); copy.teacherId = 'different'; assert.equal(allowed.teacherId, 'roster-one') })
check('기존 권한판·연결·기간이 모두 같을 때만 기존 화면 유지', () => assert.equal(sameTeacherPilot(allowed, teacherPilotAccess(allowed, actor, now)), true))
for (const change of [{ revision: 2 }, { expiresAt: '2026-11-21T15:00:00.000Z' }, { batchId: 'other-batch' }, { teacherId: 'other-roster' }])
  check('권한 갱신은 오래된 화면에 조용히 적용하지 않음', () => assert.equal(sameTeacherPilot(allowed, { ...allowed, ...change }), false))
check('철회 뒤 화면 유지 금지', () => assert.equal(sameTeacherPilot(allowed, null), false))
check('교사 시험 메뉴는 인계만 유지하고 관리·키·문서·학교자료를 열지 않음', () => {
  assert(teacherPilotPages.includes('assistant'))
  for (const page of ['knowledge', 'documents', 'home']) assert(!teacherPilotPages.includes(page))
  assert.equal(teacherPilotModules().find(module => module.id === 'schoolAdmin').title, '업무 인계')
  for (const page of ['tasks', 'calendar', 'messages', 'collections']) assert(teacherPilotPages.includes(page))
})
const called = [], sources = ['menu', 'task', 'message', 'document', 'knowledge'].map(kind => ({ kind, label: kind, async load() {
  called.push(kind); return kind === 'menu' ? { items: ['assistant', 'schoolAdmin', 'documents', 'messages'].map(id => ({ id, kind: 'menu' })), nextCursor: null, coverage: '합성 메뉴' } : []
} }))
const safe = teacherPilotSearchSources(sources)
check('권한 밖 검색은 호출 대상에서 제외', () => assert.deepEqual(safe.map(s => s.kind), ['menu', 'task', 'message']))
const menu = await safe[0].load()
check('메뉴 검색 결과도 허용된 화면만 제공', () => assert.deepEqual(menu.items.map(row => row.id), ['assistant', 'schoolAdmin', 'messages']))
check('기존 학교 관리 주소는 인계 전용 문구로 표시', () => assert.equal(menu.items.find(row => row.id === 'schoolAdmin').title, '업무 인계'))
check('필터 과정에서 자료 조회를 먼저 하지 않음', () => assert.deepEqual(called, ['menu']))
console.log(`\n${passed} passed, 0 failed`)
