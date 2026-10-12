// 실제 TypeScript 도메인을 묶어 실행한다. 서버 인증·RLS 검증을 대신하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { domain, fixtureData, createMemoryAdapter, workhubModules, renderPreview, renderEditor } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { PreviewApp } from '../apps/workhub/src/preview/PreviewApp.tsx'
  import { EventEditor } from '../apps/workhub/src/preview/EventEditor.tsx'
  import { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  import { createMemoryAdapter } from '../apps/workhub/src/preview/memory-adapter.ts'
  export * as domain from '../apps/workhub/src/domain.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
  export { createMemoryAdapter } from '../apps/workhub/src/preview/memory-adapter.ts'
  export { workhubModules } from '../apps/workhub/src/modules.ts'
  export function renderPreview() { return renderToStaticMarkup(<PreviewApp />) }
  export function renderEditor() { return renderToStaticMarkup(<EventEditor member={fixtureData.memberships[0]} members={fixtureData.memberships} date={fixtureData.basisDate} adapter={createMemoryAdapter(fixtureData, 0)} onClose={() => {}} onSaved={() => {}} />) }
`)
let failures = 0
async function test(name, run) {
  try { await run(); console.log(`  ✓ ${name}`) }
  catch (error) { failures++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) }
}
const make = (latency = 0) => createMemoryAdapter(fixtureData, latency)
const teacher = fixtureData.memberships.find(member => member.id === 'gaon-soyeon')
const manager = fixtureData.memberships.find(member => member.id === 'gaon-minjun')
const other = fixtureData.memberships.find(member => member.id === 'gaon-seojin')
const date = fixtureData.basisDate
const own = fixtureData.events.find(event => event.id === 'fixture-event-my')
const fresh = () => ({ ...structuredClone(own), title: '새 가상 일정', visibility: 'school' })
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)

await test('학교별 목록과 직접 원본 조회가 다른 학교 자료를 돌려주지 않는다', async () => {
  const adapter = make()
  assert((await adapter.list(teacher.id)).every(event => event.schoolId === teacher.schoolId))
  assert((await adapter.list('nuri-soyeon')).every(event => event.schoolId !== teacher.schoolId))
  await rejects(adapter.get(teacher.id, 'fixture-event-nuri'), 'NOT_FOUND')
})
await test('개인 일정은 같은 학교 일정 담당자도 읽거나 수정하지 못한다', async () => {
  const adapter = make()
  await rejects(adapter.get(manager.id, own.id), 'NOT_FOUND')
  assert.equal(domain.canEdit(own, manager, date), false)
})
await test('학교 전체 열람과 관련 대상 홈 추천을 따로 계산한다', async () => {
  const events = await make().list(teacher.id)
  assert(events.some(event => event.id === 'fixture-event-research'))
  assert(!domain.homeItems(events, teacher, date).upcoming.some(item => item.event.id === 'fixture-event-research'))
  assert(!events.some(event => event.id === 'fixture-event-restricted'))
})
await test('대상은 필드 간 AND, 같은 필드 OR, 조건 간 OR, 제외 우선이다', () => {
  const audience = { all: false, groups: [{ departmentIds: ['curriculum'], gradeIds: ['1', '2'], subjectIds: ['math'] }], includeMemberIds: [], excludeMemberIds: [] }
  assert(domain.matchesAudience(audience, teacher, date))
  assert(!domain.matchesAudience(audience, manager, date))
  audience.groups.push({ departmentIds: ['research'], gradeIds: [], subjectIds: [] })
  assert(domain.matchesAudience(audience, other, date))
  audience.includeMemberIds.push(manager.id)
  assert(domain.matchesAudience(audience, manager, date))
  audience.excludeMemberIds.push(manager.id)
  assert(!domain.matchesAudience(audience, manager, date))
  assert(!domain.matchesAudience({ ...audience, all: true }, manager, date))
})
await test('진행 중인 일정은 오늘 소속, 미래 일정은 시작일 소속으로 추천한다', () => {
  const newlyJoined = { ...teacher, validFrom: date }
  const ongoing = fixtureData.events.find(event => event.id === 'fixture-event-ongoing')
  assert(domain.homeItems([ongoing], newlyJoined, date).today.some(item => item.event.id === ongoing.id))
  const ending = { ...teacher, validThrough: '2026-10-20' }
  const future = fixtureData.events.find(event => event.id === 'fixture-event-next')
  assert.equal(domain.homeItems([future], ending, date).upcoming.length, 0)
})
await test('종료일 당일까지 진행 중이며 지난 일정은 오늘과 다가오는 목록에서 빠진다', () => {
  const event = { ...fixtureData.events[0], startDate: '2026-10-16', endDate: date }
  assert.equal(domain.homeItems([event], teacher, date).today.length, 1)
  assert.equal(domain.homeItems([event], teacher, '2026-10-20').today.length, 0)
  assert.equal(domain.homeItems([event], teacher, '2026-10-20').upcoming.length, 0)
})
await test('종료된 소속은 목록·원본 조회·저장을 모두 거부한다', async () => {
  const adapter = make()
  await rejects(adapter.list('gaon-ended'), 'INACTIVE_MEMBERSHIP')
  await rejects(adapter.get('gaon-ended', own.id), 'INACTIVE_MEMBERSHIP')
  await rejects(adapter.save('gaon-ended', { draft: fresh(), idempotencyKey: 'ended' }), 'INACTIVE_MEMBERSHIP')
})
await test('null·잘못된 필드·깨진 대상 입력을 TypeError 대신 INVALID_INPUT으로 처리한다', async () => {
  for (const draft of [null, {}, { ...fresh(), title: null }, { ...fresh(), description: null }, { ...fresh(), allDay: 'yes' }, { ...fresh(), audience: null }, { ...fresh(), audience: { all: true, groups: 'bad', includeMemberIds: [], excludeMemberIds: [] } }, { ...fresh(), audience: { all: true, groups: [null], includeMemberIds: [], excludeMemberIds: [] } }, { ...fresh(), audience: { all: true, groups: [], includeMemberIds: 'bad', excludeMemberIds: [] } }]) {
    await rejects(make().save(teacher.id, { draft, idempotencyKey: 'invalid' }), 'INVALID_INPUT')
  }
  await rejects(make().save(teacher.id, null), 'INVALID_INPUT')
})
await test('존재하지 않는 날짜·역전 시각·빈 대상·다른 학교 직접 대상을 거부한다', async () => {
  for (const draft of [
    { ...fresh(), startDate: '2026-02-30' },
    { ...fresh(), startTime: '17:00', endTime: '16:00' },
    { ...fresh(), audience: { all: false, groups: [], includeMemberIds: [], excludeMemberIds: [] } },
    { ...fresh(), audience: { all: true, groups: [], includeMemberIds: ['nuri-harin'], excludeMemberIds: [] } },
  ]) await rejects(make().save(teacher.id, { draft, idempotencyKey: 'invalid-date' }), 'INVALID_INPUT')
})
await test('등록은 현재 소속 학교·작성자를 사용하고 원본 한 건을 홈에 연결한다', async () => {
  const adapter = make()
  const event = await adapter.save(teacher.id, { draft: { ...fresh(), schoolId: 'foreign', authorMemberId: 'foreign' }, idempotencyKey: 'create' })
  assert.equal(event.schoolId, teacher.schoolId)
  assert.equal(event.authorMemberId, teacher.id)
  assert.equal(event.version, 1)
  assert.equal(domain.homeItems(await adapter.list(teacher.id), teacher, date).today.filter(item => item.event.id === event.id).length, 1)
})
await test('읽을 수 있는 타인 일정도 일반 교사는 수정하지 못한다', async () => {
  const adapter = make()
  const event = await adapter.get(teacher.id, 'fixture-event-grade')
  await rejects(adapter.save(teacher.id, { draft: event, id: event.id, expectedVersion: event.version, idempotencyKey: 'forbidden' }), 'FORBIDDEN')
})
await test('동시 수정 충돌은 최신 원본을 제공하고 사용자 초안을 바꾸지 않는다', async () => {
  const adapter = make()
  const draft = { ...own, title: '내가 입력 중인 제목' }
  const before = structuredClone(draft)
  adapter.simulateConcurrentEdit(teacher.id, own.id)
  await assert.rejects(adapter.save(teacher.id, { draft, id: own.id, expectedVersion: 1, idempotencyKey: 'conflict' }), error => error.code === 'CONFLICT' && error.current.version === 2)
  assert.deepEqual(draft, before)
  const saved = await adapter.save(teacher.id, { draft, id: own.id, expectedVersion: 2, idempotencyKey: 'resolved' })
  assert.equal(saved.version, 3)
  assert.equal(saved.title, draft.title)
})
await test('같은 버전에서 경합한 저장 중 한 건만 성공한다', async () => {
  const adapter = make()
  const results = await Promise.allSettled(['a', 'b'].map(key => adapter.save(teacher.id, { draft: { ...own, title: key }, id: own.id, expectedVersion: 1, idempotencyKey: key })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT').length, 1)
})
await test('같은 요청 키 재시도는 중복 등록하지 않고 다른 입력은 거부한다', async () => {
  const adapter = make()
  const command = { draft: fresh(), idempotencyKey: 'same' }
  const first = await adapter.save(teacher.id, command)
  assert.deepEqual(await adapter.save(teacher.id, command), first)
  assert.equal((await adapter.list(teacher.id)).filter(event => event.id === first.id).length, 1)
  await rejects(adapter.save(teacher.id, { ...command, draft: { ...command.draft, title: '다른 입력' } }), 'IDEMPOTENCY_CONFLICT')
})
await test('멱등 성공 응답 재시도도 현재 원본의 열람 범위를 재검사한다', async () => {
  const adapter = make()
  const shared = await adapter.save(teacher.id, { draft: fresh(), idempotencyKey: 'shared' })
  const managerCommand = { draft: { ...shared, title: '담당자 수정' }, id: shared.id, expectedVersion: 1, idempotencyKey: 'manager' }
  await adapter.save(manager.id, managerCommand)
  await adapter.save(teacher.id, { draft: { ...shared, visibility: 'private' }, id: shared.id, expectedVersion: 2, idempotencyKey: 'make-private' })
  await rejects(adapter.save(manager.id, managerCommand), 'NOT_FOUND')
})
await test('타인 공유 일정을 담당자 자신의 개인 일정으로 전환하지 못한다', async () => {
  const adapter = make()
  const shared = await adapter.save(teacher.id, { draft: fresh(), idempotencyKey: 'shared' })
  await rejects(adapter.save(manager.id, { draft: { ...shared, visibility: 'private' }, id: shared.id, expectedVersion: 1, idempotencyKey: 'private' }), 'FORBIDDEN')
})
await test('조회·저장 실패 후 재시도할 수 있고 저장 실패는 원본을 바꾸지 않는다', async () => {
  const adapter = make()
  adapter.failNextQuery()
  await rejects(adapter.list(teacher.id), 'QUERY_FAILED')
  assert((await adapter.list(teacher.id)).length > 0)
  const command = { draft: { ...own, title: '실패 후 재시도' }, id: own.id, expectedVersion: 1, idempotencyKey: 'retry' }
  adapter.failNextSave()
  await rejects(adapter.save(teacher.id, command), 'SAVE_FAILED')
  assert.equal((await adapter.get(teacher.id, own.id)).version, 1)
  assert.equal((await adapter.save(teacher.id, command)).version, 2)
})
await test('요청 대기 중 소속이 종료되면 저장 직전에 거부한다', async () => {
  const adapter = make(5)
  const pending = adapter.save(teacher.id, { draft: fresh(), idempotencyKey: 'late' })
  adapter.endMembership(teacher.id)
  await rejects(pending, 'INACTIVE_MEMBERSHIP')
})
await test('합성 자료 초기화가 대기 중 저장을 취소하고 자료를 되살리지 않는다', async () => {
  const adapter = make(5)
  const pending = adapter.save(teacher.id, { draft: fresh(), idempotencyKey: 'before-reset' })
  adapter.reset()
  await rejects(pending, 'CANCELLED')
  assert(!(await adapter.list(teacher.id)).some(event => event.title === '새 가상 일정'))
})
await test('빈 목록 시험과 조회 응답 수정이 실제 원본을 손상시키지 않는다', async () => {
  const adapter = make()
  const event = await adapter.get(teacher.id, own.id)
  event.title = '외부에서 변경'
  assert.equal((await adapter.get(teacher.id, own.id)).title, own.title)
  adapter.setEmpty(true)
  assert.deepEqual(await adapter.list(teacher.id), [])
  adapter.setEmpty(false)
  assert((await adapter.list(teacher.id)).length > 0)
})
await test('신규 모듈은 superadmin 선언이며 운영에서 활성화하지 않는다', () => {
  assert(workhubModules.length > 0)
  assert(workhubModules.every(module => module.visibility === 'superadmin' && module.productionEnabled === false))
})
await test('실제 홈 JSX가 개발 안내·학교 맥락·조회 상태를 렌더한다', () => {
  const html = renderPreview()
  assert(html.includes('로컬 개발 미리보기'))
  assert(html.includes('가온가상중학교'))
  assert(html.includes('현재 소속의 일정을 불러오는 중'))
  assert(html.includes('aria-label="업무 메뉴"'))
})
await test('실제 편집 JSX가 접근 가능한 양식과 열람·추천 구분을 렌더한다', () => {
  const html = renderEditor()
  const dialogTitle = html.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1]
  assert(dialogTitle)
  assert(html.includes(`<h2 id="${dialogTitle}">`))
  assert(html.includes('name="title"'))
  assert(html.includes('대상 미리보기'))
  assert(html.includes('원본 열람 · 현재 기준일 기준'))
  assert(html.includes('홈 추천 후보 · 열람 가능한 교사 중'))
})
await test('일반 진입점 빌드에 합성 학교·계정·업무 동작이 포함되지 않는다', () => {
  const result = buildSync({ entryPoints: [fileURLToPath(new URL('../apps/workhub/src/main.tsx', import.meta.url))], bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  const code = result.outputFiles.map(file => file.text).join('\n')
  for (const forbidden of ['fixture-school-gaon', 'fixture-event-morning', 'gaon-soyeon', 'simulateConcurrentEdit', 'failNextSave', '가상 소속 계정']) assert(!code.includes(forbidden), `개발 내용 유출: ${forbidden}`)
  assert(code.includes('운영 연결 준비 중') || code.includes('\\uC6B4\\uC601'))
})

if (failures) process.exitCode = 1
