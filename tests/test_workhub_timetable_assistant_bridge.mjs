import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/assistant';export * from '../apps/workhub/src/timetable/assistant-bridge';export * from '../apps/workhub/src/timetable/sample';export * from '../apps/workhub/src/assistant/contracts';`)
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log('  ✓ ' + name) }
const key = 'request-original-1'
function basis() {
  const b = m.timetablePracticeSnapshot('2026-10-17').basis
  b.slots = Array.from({ length: 35 }, (_, i) => ({ id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), day: Math.floor(i / 7) + 1, label: (i % 7 + 1) + '교시', startMinute: 480 + (i % 7) * 55, endMinute: 525 + (i % 7) * 55, periods: 1 }))
  b.lessons = Array.from({ length: 20 }, (_, i) => ({ id: '10000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), courseId: 'course-' + i, label: `2학년 ${i % 5 + 1}반 과학 ${i + 1}회`, periods: 1, resourceIds: ['practice-teacher-a', 'practice-class-a'], allowedSlotIds: b.slots.map(s => s.id) }))
  b.courseLoads = b.lessons.map(l => ({ courseId: l.courseId, periods: 1 }))
  return b
}
async function request(b = basis()) { return m.timetableAssistantRequest(await m.buildTimetableAiContext(b, { fixed: [], unavailable: [], preferences: [] }, 'setup', '이번 학기 수요일 1교시를 가능하면 피하고 싶어요.'), 'practice-teacher-a') }
function proposal(r, changes) { const c = r.context; return { contract: c.contract, stage: c.stage, basisId: c.basisId, basisRevision: c.basisRevision, sourceFingerprint: c.sourceFingerprint, contextFingerprint: c.contextFingerprint, summary: '교사 조건 제안', questions: [], changes } }
function answer(r, value) {
  return m.askResult({ state: 'completed', requestKey: key, thread: { id: 'thread-1', mode: 'school', version: 1, title: '시간표', nextCursor: null, exchanges: [{ id: 'exchange-1', requestKey: key, intent: r.input.intent, prompt: r.input.prompt, segments: [{ text: JSON.stringify(value), citations: [] }], proposal: null, createdAt: '2026-10-17T01:00:00.000Z', studentContext: null }] } }, key)
}
await check('일반 35교시·20수업 UUID 자료가 기존 AI 4000자 한도 안에 들어간다', async () => { const r = await request(); assert.ok(Array.from(r.input.prompt).length <= 4000); assert.ok(r.input.prompt.includes('2학년 1반 과학 1회')); assert.ok(r.input.prompt.includes('예시 교사 가')); assert.ok(!r.input.prompt.includes(r.context.basis.lessons[0].id)); assert.equal(r.input.intent, 'school_advice'); assert.equal(r.input.quality, 'quick'); assert.equal(r.input.reviewOf, null); assert.deepEqual(r.input.references, []); console.log('    실제 요청 길이 ' + Array.from(r.input.prompt).length) })
await check('생성 후 피드백은 선택 대상의 실제 배치를 짧은 별칭으로 포함하고 4000자 한도를 지킨다', async () => {
  const b = basis(), placements = b.lessons.map((lesson, index) => ({ lessonId: lesson.id, slotId: b.slots[index].id }))
  b.lessons.push({ ...structuredClone(b.lessons[0]), id: 'foreign-lesson', courseId: 'foreign-course', label: '선택 범위 밖 수업', resourceIds: ['practice-teacher-b', 'practice-class-b'] })
  b.courseLoads.push({ courseId: 'foreign-course', periods: 1 }); placements.push({ lessonId: 'foreign-lesson', slotId: b.slots[0].id })
  const context = await m.buildTimetableAiContext(b, { fixed: [], unavailable: [], preferences: [] }, 'adjust', '이 배치에서 수업이 몰리는 요일을 설명해 주세요.', placements), r = m.timetableAssistantRequest(context, 'practice-teacher-a')
  const scope = JSON.parse(r.input.prompt.split('\n').at(-2))
  assert.deepEqual(scope.placements, Array.from({ length: 20 }, (_, index) => [`l${index}`, `s${index}`])); assert.ok(!r.input.prompt.includes('선택 범위 밖 수업')); assert.ok(!r.input.prompt.includes(b.lessons[0].id)); assert.ok(Array.from(r.input.prompt).length <= 4000); assert.ok(r.input.prompt.includes('전체 학교의 최적성')); assert.deepEqual(r.context.placements, placements)
  const raw = proposal(r, [{ kind: 'prefer', lessonId: 'l0', slotId: 's0', weight: 3 }]), parsed = m.timetableAssistantAnswer(answer(r, raw), r, key).proposal
  assert.ok(parsed); assert.equal(parsed.stage, 'adjust'); assert.deepEqual(parsed.changes, [{ kind: 'prefer', lessonId: b.lessons[0].id, slotId: b.slots[0].id, weight: 3 }]); console.log('    생성 후 요청 길이 ' + Array.from(r.input.prompt).length)
})
await check('생성 후 피드백에서 설명과 선호만 받으며 고정·차단 응답은 반영하지 않는다', async () => {
  const b = basis(), placements = b.lessons.map((lesson, index) => ({ lessonId: lesson.id, slotId: b.slots[index].id })), context = await m.buildTimetableAiContext(b, { fixed: [], unavailable: [], preferences: [] }, 'adjust', '현재 배치를 검토해 주세요.', placements), r = m.timetableAssistantRequest(context, 'practice-teacher-a')
  assert.ok(m.timetableAssistantAnswer(answer(r, proposal(r, [])), r, key).proposal)
  for (const change of [{ kind: 'fix', lessonId: 'l0', slotId: 's0' }, { kind: 'block', resourceId: 'r0', slotId: 's0' }]) assert.equal(m.timetableAssistantAnswer(answer(r, proposal(r, [change])), r, key).proposal, null)
  const broken = structuredClone(context); broken.placements = []; assert.throws(() => m.timetableAssistantRequest(broken, 'practice-teacher-a'), m.TimetableAssistantInputError)
})
await check('짧은 별칭을 원래 교사·수업·시간대 ID로 복원한다', async () => { const r = await request(), raw = proposal(r, [{ kind: 'block', resourceId: 'r0', slotId: 's0' }, { kind: 'fix', lessonId: 'l0', slotId: 's1' }, { kind: 'prefer', lessonId: 'l1', slotId: 's2', weight: 3 }]); const result = m.timetableAssistantAnswer(answer(r, raw), r, key).proposal; assert.ok(result); assert.equal(result.changes[0].resourceId, 'practice-teacher-a'); assert.equal(result.changes[0].slotId, r.context.basis.slots[0].id); assert.equal(result.changes[1].lessonId, r.context.basis.lessons[0].id); assert.equal(result.changes[2].lessonId, r.context.basis.lessons[1].id) })
await check('기존 원래 ID 응답도 선택한 범위 안이면 채택한다', async () => { const r = await request(); r.input.prompt = '이전에 보낸 원래 요청 그대로'; const raw = proposal(r, [{ kind: 'fix', lessonId: r.context.basis.lessons[0].id, slotId: r.context.basis.slots[0].id }]); assert.ok(m.timetableAssistantAnswer(answer(r, raw), r, key).proposal); assert.equal(r.input.prompt, '이전에 보낸 원래 요청 그대로') })
await check('다른 대상·알 수 없는 별칭·숨은 항목을 반영하지 않는다', async () => { const r = await request(); for (const change of [{ kind: 'block', resourceId: 'practice-teacher-b', slotId: 's0' }, { kind: 'fix', lessonId: 'l99', slotId: 's0' }, { kind: 'fix', lessonId: 'l0', slotId: 's99' }, { kind: 'fix', lessonId: 'l0', slotId: 's0', hidden: true }, { kind: 'make_teacher', lessonId: 'l0', slotId: 's0' }]) assert.equal(m.timetableAssistantAnswer(answer(r, proposal(r, [change])), r, key).proposal, null) })
await check('원래 ID와 별칭 이름이 겹쳐도 대상을 바꾸지 않는다', async () => { const b = basis(); b.lessons[5].id = 'l0'; b.slots[5].id = 's0'; b.lessons.forEach(l => l.allowedSlotIds = b.slots.map(s => s.id)); b.resources.push({ id: 'r0', kind: 'equipment', label: '이름충돌장비', capacity: 1 }); const r = await request(b); const alias = proposal(r, [{ kind: 'fix', lessonId: '_l0', slotId: '_s0' }]); const normalized = m.timetableAssistantAnswer(answer(r, alias), r, key).proposal; assert.ok(normalized); assert.equal(normalized.changes[0].lessonId, b.lessons[0].id); assert.equal(normalized.changes[0].slotId, b.slots[0].id); const original = proposal(r, [{ kind: 'fix', lessonId: 'l0', slotId: 's0' }]); const kept = m.timetableAssistantAnswer(answer(r, original), r, key).proposal; assert.ok(kept); assert.equal(kept.changes[0].lessonId, 'l0'); assert.equal(kept.changes[0].slotId, 's0') })
await check('배열 순서가 바뀌어도 별칭 대상과 짧은 요청 내용이 같다', async () => { const b = basis(), original = await request(b); b.lessons.reverse(); b.slots.reverse(); const reordered = await request(b); const scope = r => JSON.parse(r.input.prompt.split('\n').at(-2)); assert.deepEqual(scope(original), scope(reordered)); const raw = proposal(reordered, [{ kind: 'fix', lessonId: 'l0', slotId: 's0' }]); assert.equal(m.timetableAssistantAnswer(answer(reordered, raw), reordered, key).proposal.changes[0].lessonId, original.context.basis.lessons[0].id) })
await check('원래 접수번호·프롬프트·기초판 지문이 다르면 제안을 채택하지 않는다', async () => { const r = await request(), raw = proposal(r, []), completed = answer(r, raw); assert.throws(() => m.timetableAssistantAnswer(completed, r, 'other-key')); const changed = structuredClone(completed); changed.thread.exchanges[0].prompt += 'changed'; assert.throws(() => m.timetableAssistantAnswer(changed, r, key)); raw.contextFingerprint = 'b'.repeat(64); assert.equal(m.timetableAssistantAnswer(answer(r, raw), r, key).proposal, null) })
await check('지원하지 않는 긴 대상 자료를 자르거나 다른 ID로 추정하지 않는다', async () => { const b = basis(); b.lessons.forEach(l => l.label = '가'.repeat(199)); const context = await m.buildTimetableAiContext(b, { fixed: [], unavailable: [], preferences: [] }, 'setup', '요청'); assert.throws(() => m.timetableAssistantRequest(context, 'practice-teacher-a'), m.TimetableAssistantInputError); assert.equal(context.basis.lessons[0].label.length, 199) })
await check('현재 고정·불가·선호와 수업별 허용 목록을 보내되 범위 밖 대상은 보내지 않는다', async () => {
  const b = basis(); b.lessons[0].allowedSlotIds = [b.slots[0].id, b.slots[2].id]; b.lessons[1].allowedSlotIds = [b.slots[1].id]
  b.lessons.push({ ...structuredClone(b.lessons[0]), id: 'foreign-lesson', courseId: 'foreign-course', label: '범위밖민감수업', resourceIds: ['practice-teacher-b', 'practice-class-b'] }); b.courseLoads.push({ courseId: 'foreign-course', periods: 1 })
  const conditions = { fixed: [{ lessonId: b.lessons[0].id, slotId: b.slots[2].id }, { lessonId: 'foreign-lesson', slotId: b.slots[0].id }], unavailable: [{ resourceId: 'practice-teacher-a', day: 2, startMinute: 550, endMinute: 570 }, { resourceId: 'practice-teacher-b', day: 3, startMinute: 600, endMinute: 620 }], preferences: [{ lessonId: b.lessons[1].id, slotId: b.slots[1].id, weight: 5 }, { lessonId: 'foreign-lesson', slotId: b.slots[0].id, weight: 3 }] }
  const r = m.timetableAssistantRequest(await m.buildTimetableAiContext(b, conditions, 'setup', '현재 조건을 설명해 주세요.'), 'practice-teacher-a'), scope = JSON.parse(r.input.prompt.split('\n').at(-2)), domains = new Map(scope.allowedSlots)
  assert.deepEqual(domains.get(scope.lessons[0][3]), ['s0', 's2']); assert.deepEqual(domains.get(scope.lessons[1][3]), ['s1']); assert.equal(scope.lessons[0][2], 1)
  assert.deepEqual(scope.fixed, [['l0', 's2']]); assert.deepEqual(scope.unavailable, [['r0', 2, 550, 570]]); assert.deepEqual(scope.preferences, [['l1', 's1', 5]]); assert.equal(scope.slots[0][5], 1)
  for (const text of ['foreign-lesson', '범위밖민감수업', 'practice-teacher-b']) assert.ok(!r.input.prompt.includes(text))
  assert.equal(m.timetableAssistantAnswer(answer(r, proposal(r, [{ kind: 'fix', lessonId: 'l0', slotId: 's1' }])), r, key).proposal, null)
  conditions.fixed.reverse(); conditions.unavailable.reverse(); conditions.preferences.reverse(); b.lessons.reverse(); b.slots.reverse(); b.lessons.forEach(l => l.allowedSlotIds.reverse())
  const reordered = m.timetableAssistantRequest(await m.buildTimetableAiContext(b, conditions, 'setup', '현재 조건을 설명해 주세요.'), 'practice-teacher-a'); assert.deepEqual(JSON.parse(reordered.input.prompt.split('\n').at(-2)), scope)
})
await check('연속 수업의 차시와 긴 블록을 표시하고 조건이 많아 한도를 넘으면 자르지 않는다', async () => {
  const b = basis(); b.slots.push({ id: 'long-block', label: '연속 2차시', day: 1, startMinute: 480, endMinute: 580, periods: 2 }); b.lessons[0].periods = 2; b.lessons[0].allowedSlotIds = ['long-block']; b.courseLoads[0].periods = 2
  const r = await request(b), scope = JSON.parse(r.input.prompt.split('\n').at(-2)); assert.equal(scope.lessons[0][2], 2); assert.equal(scope.slots.find(s => s[2] === '연속 2차시')[5], 2)
  const unavailable = Array.from({ length: 300 }, (_, i) => ({ resourceId: 'practice-teacher-a', day: 1, startMinute: i, endMinute: i + 1 })), context = await m.buildTimetableAiContext(b, { fixed: [], unavailable, preferences: [] }, 'setup', '현재 불가를 설명해 주세요.')
  assert.throws(() => m.timetableAssistantRequest(context, 'practice-teacher-a'), /AI 입력 한도/); assert.equal(context.basis.unavailable.length, 300)
})


await check('기존 시간표 미확정 원요청에는 품질 필드를 추가하지 않는다',async()=>{const r=await request();const {quality,reviewOf,...old}=r.input;assert.deepEqual(m.assistantInput(old),old);assert.equal(Object.keys(m.assistantInput(old)).length,7)})
console.log(`시간표 Claude 별칭·원키 보존 ${count}건 통과`)
