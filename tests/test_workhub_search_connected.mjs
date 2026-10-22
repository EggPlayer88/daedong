import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { createModuleSearchSources, createConnectedSearchSources, createSupabaseCollectionServer, createSearchResponses, menuSearchSource, enabledModules, SEARCH_KINDS, searchKindLabels, SEARCH_LIMITS, filterSearchItems, searchExcerpt } = await loadBrowserModule(`
 export { createModuleSearchSources, createConnectedSearchSources, searchExcerpt } from '../apps/workhub/src/search/connected-sources.ts'
 export { menuSearchSource } from '../apps/workhub/src/search/sources.ts'
 export { enabledModules } from '../apps/workhub/src/modules.ts'
 export { SEARCH_KINDS, searchKindLabels } from '../apps/workhub/src/search/contracts.ts'
 export { SEARCH_LIMITS } from '../apps/workhub/src/search/limits.ts'
 export { filterSearchItems } from '../apps/workhub/src/search/presentation.ts'
 export { createSupabaseCollectionServer } from '../apps/workhub/src/collections/supabase-collections.ts'
 export { createSearchResponses } from './helpers/workhub-search-responses.ts'
`)
const member = { id: 'member-one', schoolId: 'school-one', userId: 'user-one', active: true, role: 'teacher', validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const date = '2026-10-21', empty = () => ({ items: [], nextCursor: null })
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
const rejects = (run, code) => assert.rejects(run, error => error.code === code)
const find = (sources, kind) => sources.find(source => source.kind === kind)
function fixture(patch = {}, selectedMember = member, guard = () => {}) {
  const calls = []
  const methods = {
    collections: { list: async (...args) => { calls.push(['collection', ...args]); return empty() } },
    documents: { list: async (...args) => { calls.push(['document', ...args]); return empty() } },
    knowledge: { list: async (...args) => { calls.push(['knowledge', ...args]); return empty() } },
    cooperation: { list: async (...args) => { calls.push(['cooperation', ...args]); return empty() } },
    messages: { threads: async (...args) => { calls.push(['message', ...args]); return empty() } },
    teaching: { catalog: async (...args) => { calls.push(['course', ...args]); return { courses: [], terms: [], subjects: [] } } },
    ...patch,
  }
  const readers = Object.fromEntries(Object.entries(methods).map(([key, value]) => [key, async () => value]))
  return { calls, methods, readers, sources: createModuleSearchSources(selectedMember, date, readers, guard) }
}
function liveFixture() {
  const state = { member: structuredClone(member), identity: { userId: member.userId, approved: true, profile: { id: member.userId, role: 'superadmin', is_active: true, department_id: null, extra_permissions: [] } } }
  const calls = []
  const knowledge = { id: 'source-one', schoolId: member.schoolId, authorMemberId: member.id, version: 4, status: 'published', updatedAt: '2026-10-21T00:00:00.000Z', title: '학사업무 지침', body: '학교 자료 원문', kind: 'school_guide', locator: '업무 지침 3쪽', effectiveFrom: '2026-03-01', effectiveThrough: '' }
  const connection = {
    info: () => ({ schools: [{ id: member.schoolId }], memberships: [state.member], basisDate: date }),
    getIdentity: async () => structuredClone(state.identity),
    rpcVerified: async (name, args) => {
      calls.push([name, structuredClone(args)])
      assert.equal(name, 'workhub_knowledge_list')
      return { contract: 'knowledge.v1', schoolId: member.schoolId, memberId: member.id, data: { items: [knowledge], nextCursor: null, canManage: false } }
    },
  }
  const sources = createConnectedSearchSources(connection, member, date, { calendarAdapter: { list: async () => [] }, taskAdapter: { list: async () => [] }, collectionServer: { list: async () => empty() } })
  return { state, calls, connection, knowledge, sources }
}

await test('전체 메뉴는 기존 등록부와 정확히 같고 미리보기에서 운영 메뉴를 늘리지 않는다', async () => {
  for (const mode of ['connected', 'preview']) {
    const page = await menuSearchSource(mode).load()
    assert.deepEqual(page.items.map(item => item.id), enabledModules(mode).map(item => item.id))
    assert.equal(page.nextCursor, null)
    assert.equal(page.items.every(item => item.kind === 'menu'), true)
  }
  assert.equal((await menuSearchSource('connected').load()).items.length, 12)
  assert.equal((await menuSearchSource('preview').load()).items.length, 5)
})
await test('검색 종류와 표시 이름이 한 계약을 쓰고 신규 메뉴·자료가 검색된다', async () => {
  assert.equal(SEARCH_KINDS.length, 9)
  assert.deepEqual(Object.keys(searchKindLabels), [...SEARCH_KINDS])
  const menus = (await menuSearchSource('connected').load()).items
  for (const [query, id] of [['메신저', 'messages'], ['원문', 'knowledge'], ['시간표', 'timetable'], ['AI 도움', 'assistant'], ['평가계획서', 'documents']]) {
    assert(filterSearchItems(menus, query).some(item => item.id === id), query)
  }
})
await test('소스 생성·메뉴 열기는 RPC·유료 호출을 하지 않고 기존 목록만 지연 연결한다', async () => {
  const f = liveFixture()
  assert.deepEqual(f.sources.map(source => source.kind), [...SEARCH_KINDS])
  assert.equal(f.calls.length, 0)
  await find(f.sources, 'menu').load()
  assert.equal(f.calls.length, 0)
  const page = await find(f.sources, 'knowledge').load({ query: '학사업무' })
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0], ['workhub_knowledge_list', { p_query: '학사업무', p_cursor: null, p_member_id: member.id }])
  assert.equal(page.items[0].version, 4)
  assert.equal(page.items[0].locator, '업무 지침 3쪽')
})
await test('6개 모듈의 실제 전송 어댑터·응답 parser를 함께 거치며 목록 외 RPC는 0건이다', async () => {
  const f = liveFixture(), responses = createSearchResponses(member, date)
  f.connection.rpcVerified = async (name, args) => { f.calls.push([name, structuredClone(args)]); return responses.respond(name, args) }
  const sources = createConnectedSearchSources(f.connection, member, date, { calendarAdapter: { list: async () => [] }, taskAdapter: { list: async () => [] }, collectionServer: createSupabaseCollectionServer(f.connection) })
  for (const kind of ['collection', 'document', 'knowledge', 'cooperation', 'message', 'course']) {
    const page = await find(sources, kind).load({ query: '통합검색' })
    assert.equal(page.items.length, 1, kind)
    assert.equal(filterSearchItems(page.items, '통합검색').length, 1, kind)
  }
  assert.deepEqual(f.calls.map(call => call[0]).sort(), ['workhub_collection_list', 'workhub_document_list', 'workhub_document_list', 'workhub_knowledge_list', 'workhub_cooperation_list', 'workhub_cooperation_list', 'workhub_message_threads', 'workhub_teaching_catalog'].sort())
})
await test('문서는 현재와 보관을 각 한 쪽만 조회하고 학생 기록 본문은 인덱싱하지 않는다', async () => {
  const calls = []
  const f = fixture({ documents: { list: async (...args) => {
    calls.push(args)
    return { items: [
      { id: args[2] ? 'archived' : 'current', title: '행사 계획', kind: 'general', body: '행사 준비 원문', studentContext: null, version: 3, basisDate: date, status: args[2] ? 'archived' : 'draft', visibility: 'private' },
      { id: 'student-private', title: '학생 기록', kind: 'student_record', body: '절대 전역 검색에 올리지 않는 학생 상담', studentContext: { studentId: 'student-one' }, version: 1 },
    ], nextCursor: args[2] ? null : 'current-page2' }
  } } })
  const page = await find(f.sources, 'document').load({ query: '행사' })
  assert.deepEqual(calls, [[member.id, '행사', false, null], [member.id, '행사', true, null]])
  assert.equal(page.items.length, 2); assert.equal(page.scanned, 4)
  assert(!JSON.stringify(page).includes('학생 상담')); assert(!JSON.stringify(page.items).includes('student-private'))
  assert.match(page.coverage, /학생 기록 문서 제외/)
  assert(page.items.every(item => item.version === 3))
})
await test('현재 문서의 다음 쪽만 남으면 보관 목록을 중복 조회하지 않는다', async () => {
  const calls = []
  const f = fixture({ documents: { list: async (...args) => { calls.push(args); return { items: [], nextCursor: !args[2] && args[3] === null ? 'more-current' : null } } } })
  const source = find(f.sources, 'document'), first = await source.load({ query: '준비' })
  assert(first.nextCursor)
  const next = await source.load({ query: '준비', cursor: first.nextCursor })
  assert.deepEqual(calls, [[member.id, '준비', false, null], [member.id, '준비', true, null], [member.id, '준비', false, 'more-current']])
  assert.equal(next.nextCursor, null)
})
await test('학교 자료는 원문 검색어 근처 요약과 정확한 판·위치를 전달한다', async () => {
  const body = '앞 내용 '.repeat(500) + '연가 처리 절차 확인' + ' 뒷 내용'.repeat(500)
  const f = fixture({ knowledge: { list: async () => ({ items: [{ id: 'source', title: '학교 지침', body, version: 9, locator: '복무 지침 5쪽', effectiveFrom: date, effectiveThrough: '', status: 'retired' }], nextCursor: null }) } })
  const page = await find(f.sources, 'knowledge').load({ query: '연가 처리' })
  assert.equal(page.items[0].version, 9); assert.equal(page.items[0].locator, '복무 지침 5쪽')
  assert.match(page.items[0].description, /연가 처리/)
  assert(page.items[0].description.length < 325)
  assert.equal(filterSearchItems(page.items, '연가 처리').length, 1)
  assert.equal(filterSearchItems(page.items, '복무 지침').length, 1)
  assert(!JSON.stringify(page).includes(body))
})
await test('수합은 서버에 없는 검색 기능을 가장하지 않고 읽은 목록만 반환한다', async () => {
  const calls = []
  const f = fixture({ collections: { list: async (...args) => { calls.push(args); return { items: [{ id: 'collection', title: '평가 계획', instructions: '새 학기 준비', dueDate: date, status: 'published', managerMemberId: member.id }], nextCursor: 'collection2' } } } })
  const page = await find(f.sources, 'collection').load({ query: '평가' })
  assert.deepEqual(calls, [[member.id, undefined]])
  assert.match(page.coverage, /조회한 목록/)
  assert(page.nextCursor)
  assert.equal(filterSearchItems(page.items, '평가').length, 1)
})
await test('협업 검색은 받은·보낸 함을 한 쪽씩 읽고 끝난 함은 건너뛴다', async () => {
  const calls = []
  const f = fixture({ cooperation: { list: async (id, filter) => { calls.push([id, filter]); return { items: [], nextCursor: filter.box === 'sent' && !filter.cursor ? 'sent2' : null } } } })
  const source = find(f.sources, 'cooperation'), first = await source.load({ query: '협조' })
  await source.load({ query: '협조', cursor: first.nextCursor })
  assert.deepEqual(calls.map(call => call[1]), [
    { box: 'received', query: '협조', status: 'all', cursor: null },
    { box: 'sent', query: '협조', status: 'all', cursor: null },
    { box: 'sent', query: '협조', status: 'all', cursor: 'sent2' },
  ])
})
await test('메신저 검색은 대화 이름과 다른 참여자만 사용하며 읽음·본문·첨부를 호출하지 않는다', async () => {
  const calls = []
  const f = fixture({ messages: { threads: async (...args) => { calls.push(args); return { items: [{ id: 'thread', title: '', kind: 'direct', participants: [{ memberId: member.id, name: '본인' }, { memberId: 'other', name: '김교사' }], unreadCount: 4, body: '검색되면 안 되는 메시지 내용' }], nextCursor: null } } } })
  const page = await find(f.sources, 'message').load({ query: '김교사' })
  assert.deepEqual(calls, [[member.id, '김교사', false, undefined]])
  assert.equal(page.items[0].title, '김교사'); assert.match(page.items[0].meta, /4개/)
  assert(!JSON.stringify(page.items).includes('메시지 내용')); assert(!JSON.stringify(page.items).includes('본인'))
})
await test('수업 검색은 목록의 수업명·교과·학기만 사용하고 학생·평가·상담을 복제하지 않는다', async () => {
  const f = fixture({ teaching: { catalog: async () => ({ courses: [{ id: 'course', label: '1학년 국어', termId: 'term', subjectId: 'subject', validFrom: date, validThrough: '2026-12-31', secret: '학생명 상담 평가' }], terms: [{ id: 'term', label: '2026 2학기' }], subjects: [{ id: 'subject', label: '국어' }], students: [{ name: '학생 실명' }] }) } })
  const page = await find(f.sources, 'course').load({ query: '국어' })
  assert.equal(page.nextCursor, null); assert.equal(page.items[0].description, '국어 · 2026 2학기')
  assert(!JSON.stringify(page.items).includes('학생'))
  assert.equal(filterSearchItems(page.items, '2학기').length, 1)
})
await test('변경된 검색어·다른 자료 종류·다른 학교·다른 소속에는 이전 커서를 재사용하지 않는다', async () => {
  const f = fixture({ knowledge: { list: async () => ({ items: [], nextCursor: 'next' }) } })
  const source = find(f.sources, 'knowledge'), page = await source.load({ query: '지침' })
  await rejects(() => source.load({ query: '연수', cursor: page.nextCursor }), 'INVALID_INPUT')
  await rejects(() => find(f.sources, 'message').load({ query: '지침', cursor: page.nextCursor }), 'INVALID_INPUT')
  for (const patch of [{ schoolId: 'another' }, { id: 'another' }]) {
    const other = fixture({}, { ...member, ...patch })
    await rejects(() => find(other.sources, 'knowledge').load({ query: '지침', cursor: page.nextCursor }), 'INVALID_INPUT')
    assert.equal(other.calls.length, 0)
  }
})
await test('깨진 커서와 입력 한도 초과는 목록 조회 전에 멈춘다', async () => {
  const f = fixture(), source = find(f.sources, 'knowledge')
  for (const cursor of ['', '{', '{}', '[]', 'null', 'x'.repeat(SEARCH_LIMITS.cursorChars + 1)]) await rejects(() => source.load({ cursor }), 'INVALID_INPUT')
  for (const query of ['x'.repeat(SEARCH_LIMITS.queryChars + 1), 'bad\u0000input', 'bad\u0085input', '\ud800']) await rejects(() => source.load({ query }), 'INVALID_INPUT')
  assert.equal(f.calls.length, 0)
  await source.load({ query: '🦆 학교'.normalize('NFD') })
  assert.equal(f.calls[0][2], '🦆 학교')
})
await test('서버가 같은 커서를 되돌리면 무한 다음 쪽 조회로 이어지지 않는다', async () => {
  const f = fixture({ knowledge: { list: async () => ({ items: [], nextCursor: 'same' }) } })
  const source = find(f.sources, 'knowledge'), first = await source.load()
  await rejects(() => source.load({ cursor: first.nextCursor }), 'QUERY_FAILED')
})
await test('정해진 페이지 한도를 넘거나 커서가 오염된 응답은 검색 성공으로 처리하지 않는다', async () => {
  for (const value of [{ items: new Array(SEARCH_LIMITS.pageItems + 1).fill({}), nextCursor: null }, { items: [], nextCursor: '' }, { items: [], nextCursor: 9 }]) {
    const f = fixture({ knowledge: { list: async () => value } })
    await rejects(() => find(f.sources, 'knowledge').load(), 'QUERY_FAILED')
  }
})
await test('기능 미준비와 일반 조회 실패는 다른 자료원의 결과와 구별할 수 있게 보존한다', async () => {
  for (const code of ['NOT_READY', 'UNAVAILABLE', 'FORBIDDEN', 'QUERY_FAILED']) {
    const error = Object.assign(new Error('private backend detail'), { code })
    const f = fixture({ knowledge: { list: async () => { throw error } } })
    await rejects(() => find(f.sources, 'knowledge').load(), code)
    assert.deepEqual((await find(f.sources, 'message').load()).items, [])
  }
})
await test('종료 소속과 취소된 조회는 어댑터 호출을 시작하지 않는다', async () => {
  const inactive = fixture({}, { ...member, active: false })
  await rejects(() => find(inactive.sources, 'knowledge').load(), 'INACTIVE_MEMBERSHIP')
  assert.equal(inactive.calls.length, 0)
  const f = fixture(), controller = new AbortController(); controller.abort()
  await rejects(() => find(f.sources, 'knowledge').load({ signal: controller.signal }), 'CANCELLED')
  assert.equal(f.calls.length, 0)
})
await test('늦게 끝난 목록은 창 닫기나 소속 변경 뒤 표시하지 않는다', async () => {
  for (const change of ['signal', 'scope']) {
    let resume, called
    const started = new Promise(resolve => { called = resolve }), controller = new AbortController()
    let current = true
    const f = fixture({ knowledge: { list: async () => { called(); return new Promise(resolve => { resume = resolve }) } } }, member, () => { if (!current) throw Object.assign(new Error('changed'), { code: 'CANCELLED' }) })
    const result = find(f.sources, 'knowledge').load({ signal: controller.signal })
    await started
    if (change === 'signal') controller.abort(); else current = false
    resume(empty())
    await rejects(() => result, 'CANCELLED')
  }
})
await test('학교 소속 변경을 반영한 실제 연결에서도 이전 범위 검색을 차단한다', async () => {
  const f = liveFixture()
  f.state.member.role = 'calendar_manager'
  await rejects(() => find(f.sources, 'knowledge').load(), 'CANCELLED')
  assert.equal(f.calls.length, 0)
})
await test('실제 RPC의 다른 학교 응답이나 타인 초안이 전역 검색으로 나오지 않는다', async () => {
  for (const corrupt of [f => f.knowledge.schoolId = 'other-school', f => { f.knowledge.status = 'draft'; f.knowledge.authorMemberId = 'another-teacher' }]) {
    const f = liveFixture(); corrupt(f)
    await rejects(() => find(f.sources, 'knowledge').load(), 'INVALID_RESPONSE')
  }
})
await test('실제 RPC 도중 승인·소속이 바뀌면 원래 목록이 늦게 와도 닫는다', async () => {
  for (const mutate of [f => f.state.member.gradeIds = ['changed'], f => f.state.identity.approved = false]) {
    const f = liveFixture(), original = f.connection.rpcVerified
    f.connection.rpcVerified = async (...args) => { const result = await original(...args); mutate(f); return result }
    await rejects(() => find(f.sources, 'knowledge').load(), 'CANCELLED')
  }
})
await test('일부 함의 실패를 전체 목록 완료나 누락 없는 결과로 표시하지 않는다', async () => {
  const error = Object.assign(new Error('offline'), { code: 'QUERY_FAILED' })
  const f = fixture({ documents: { list: async (_id, _query, archived) => { if (archived) throw error; return empty() } } })
  await rejects(() => find(f.sources, 'document').load(), 'QUERY_FAILED')
})
await test('요약은 한글 조합과 공백을 정리하고 긴 원문을 제한한다', () => {
  const body = '학교'.normalize('NFD') + '\n\n원문\t' + '가'.repeat(2000)
  const excerpt = searchExcerpt(body, '학교 원문')
  assert(excerpt.startsWith('학교 원문 ')); assert(excerpt.length <= 321)
  assert.equal(searchExcerpt('', ''), '')
  const emoji = searchExcerpt('가'.repeat(400) + '🦆' + '나'.repeat(47) + '검색할 문구' + '다'.repeat(400), '검색할 문구')
  assert.match(emoji, /검색할 문구/)
  assert(!/[\uD800-\uDFFF]/u.test(emoji))
})
console.log(`\n전체 메뉴·연결 검색: ${passed} 통과, ${failed} 실패`)
if (failed) process.exitCode = 1
