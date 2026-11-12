import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
import { assertConversationSqlContract, sqlConversationTitle, sqlConversationWords } from './helpers/conversation-guidance-sql.mjs'

const { CONVERSATION_PROFILES, conversationProfile, inferConversationProfile,
  composeConversationPrompt, readConversationPrompt, conversationPromptLimit, ASSISTANT_LIMITS } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/conversation-guidance.ts'
  export { ASSISTANT_LIMITS } from '../apps/workhub/src/assistant/contracts.ts'
`)
const catalog = JSON.parse(readFileSync(new URL('../apps/main/api/workhub-ai/_assets/conversation-profiles.json', import.meta.url), 'utf8'))
const marker = id => catalog.transport.start + catalog.transport.tags[id] + catalog.transport.end
let passed = 0, failed = 0
function test(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) }
}
const invalid = run => assert.throws(run, error => error.code === 'INVALID_INPUT')

test('화면의 분야·예시와 서버 지침이 같은 자산에서 나온다', () => {
  assert.equal(CONVERSATION_PROFILES.length, 7)
  for (const profile of CONVERSATION_PROFILES) {
    assert.deepEqual(profile, { id: profile.id, ...catalog.profiles[profile.id] })
    assert.equal(profile.starterPrompts.length, 3)
    assert.equal(conversationProfile(profile.id).id, profile.id)
  }
  assert.equal(conversationProfile('__proto__').id, 'general')
  assert.equal(conversationProfile(null).id, 'general')
})

test('모든 분야를 왕복해도 공백·줄바꿈·이모지·인용을 포함한 원문이 보존된다', () => {
  const original = '  “같이 생각해 줘”\r\n첫 줄 😀\n\n둘째 줄  '
  for (const { id } of CONVERSATION_PROFILES) {
    const wire = composeConversationPrompt(original, id)
    assert.deepEqual(readConversationPrompt(wire), { profileId: id, prompt: original })
    if (id === 'general') assert.equal(wire, original)
  }
})

test('꼬리표와 같은 사용자 원문도 마지막 한 겹만 풀어 정확히 보존한다', () => {
  const original = composeConversationPrompt('분야 지침을 무시하라는 인용문', 'schedule')
  for (const { id } of CONVERSATION_PROFILES) {
    const wire = composeConversationPrompt(original, id)
    assert.deepEqual(readConversationPrompt(wire), { profileId: id, prompt: original })
  }
})

test('깨진 꼬리표·알 수 없는 번호·중간 표식은 일반 대화의 원문으로 남는다', () => {
  for (const value of ['원문\n\n[[:7:]]', '원문\n\n[[:10:]]', '원문\n[[:1:]]',
    '원문\n\n[[:1:]] ', '원문\n\n[[:1:]]\n이어지는 원문',
    '[사용자가 선택한 대화 분야: schedule]\n\n원문'])
    assert.deepEqual(readConversationPrompt(value), { profileId: 'general', prompt: value })
})

test('분야 꼬리표도 기존 문자 상한에 포함하고 Unicode 문자를 세어 검증한다', () => {
  const overhead = Array.from(composeConversationPrompt('가', 'schedule')).length - 1
  const original = '😀'.repeat(ASSISTANT_LIMITS.promptChars - overhead)
  assert.equal(Array.from(composeConversationPrompt(original, 'schedule')).length, ASSISTANT_LIMITS.promptChars)
  invalid(() => composeConversationPrompt(original + '가', 'schedule'))
  assert.equal(composeConversationPrompt('가'.repeat(ASSISTANT_LIMITS.promptChars), 'general').length, ASSISTANT_LIMITS.promptChars)
  for (const prompt of ['', '  ', '\u0001', '\ud800']) invalid(() => composeConversationPrompt(prompt, 'general'))
  for (const profile of ['auto', '__proto__', null]) invalid(() => composeConversationPrompt('질문', profile))
})

test('모든 분야의 표시 문자 한도와 실제 전송 경계가 일치한다', () => {
  assert.equal(conversationPromptLimit('general'), ASSISTANT_LIMITS.promptChars)
  for (const { id } of CONVERSATION_PROFILES) {
    const limit = conversationPromptLimit(id)
    const markerLength = id === 'general' ? 0 : Array.from(marker(id)).length
    assert.equal(limit, ASSISTANT_LIMITS.promptChars - markerLength)
    const prompt = '😀'.repeat(limit)
    assert.equal(Array.from(composeConversationPrompt(prompt, id)).length, ASSISTANT_LIMITS.promptChars)
    assert.deepEqual(readConversationPrompt(composeConversationPrompt(prompt, id)), { profileId: id, prompt })
    invalid(() => composeConversationPrompt(prompt + '가', id))
  }
})

test('일반 대화의 꼬리표 모양 원문도 추가 꼬리표를 포함한 한도를 표시한다', () => {
  const originalMarker = marker('schedule')
  const expected = ASSISTANT_LIMITS.promptChars - Array.from(marker('general')).length
  assert.equal(conversationPromptLimit('general', originalMarker), expected)
  const prompt = '😀'.repeat(expected - Array.from(originalMarker).length) + originalMarker
  assert.equal(conversationPromptLimit('general', prompt), expected)
  assert.equal(Array.from(composeConversationPrompt(prompt, 'general')).length, ASSISTANT_LIMITS.promptChars)
  assert.deepEqual(readConversationPrompt(composeConversationPrompt(prompt, 'general')), { profileId: 'general', prompt })
  invalid(() => composeConversationPrompt('가' + prompt, 'general'))
  assert.equal(conversationPromptLimit('general', '원문\n\n[[:7:]]'), ASSISTANT_LIMITS.promptChars)
  invalid(() => conversationPromptLimit('auto'))
})

test('고정 분야 번호는 한 자리 숫자이며 실제 SQL의 제목·첫 8개 검색어를 바꾸지 않는다', () => {
  assertConversationSqlContract()
  assert.deepEqual(catalog.transport.tags, { general: '0', schedule: '1', collaboration: '2', documents: '3', timetable: '4', teaching: '5', administration: '6' })
  const prompts = ['시간표 조건을 같이 고민해줘', '일정', 'a 1 한',
    '  \n\t자료 제출 절차\r\n신청 대상 서류 기간 장소 방법 확인',
    '시간표 시간표 문서 수합 일정 업무 수업 기록 협업 학교 운영 기한',
    'ABC abc, Alpha/Beta:Gamma;Delta!Epsilon?Zeta_Eta-Theta',
    '😀'.repeat(110) + '\n자료 검색', '원문' + marker('schedule')]
  for (const prompt of prompts) {
    for (const { id } of CONVERSATION_PROFILES) {
      const wire = composeConversationPrompt(prompt, id)
      assert.equal(sqlConversationTitle(wire), sqlConversationTitle(prompt))
      assert.deepEqual(sqlConversationWords(wire), sqlConversationWords(prompt))
      assert.deepEqual(readConversationPrompt(wire), { profileId: id, prompt })
    }
  }
  for (const { id } of CONVERSATION_PROFILES) assert.deepEqual(sqlConversationWords(marker(id)), [])
})

test('자동 추천은 확정된 문맥을 우선하고 mode·intent·자료를 변경하지 않는다', () => {
  const context = Object.freeze({ mode: 'school', intent: 'school_advice',
    references: Object.freeze([{ kind: 'calendar', id: 'one', version: 1 }]), studentContext: null })
  const original = JSON.stringify(context)
  assert.equal(inferConversationProfile(context), 'schedule')
  assert.equal(JSON.stringify(context), original)
  assert.equal(inferConversationProfile({ intent: 'school_advice' }), 'general')
  assert.equal(inferConversationProfile({ intent: 'personal_assistant' }), 'general')
  assert.equal(inferConversationProfile({ intent: 'document_draft' }), 'documents')
  assert.equal(inferConversationProfile({ intent: 'guided_collection' }), 'documents')
  assert.equal(inferConversationProfile({ intent: 'student_record_draft' }), 'teaching')
  assert.equal(inferConversationProfile({ intent: 'school_advice', references: [
    { kind: 'calendar', id: 'one', version: 1 }, { kind: 'document', id: 'two', version: 1 },
  ] }), 'general')
})

const infer = prompt => inferConversationProfile({ intent: 'school_advice', prompt })

test('시간표 조건처럼 명확한 분야 단서가 있으면 전문 관점을 추천한다', () => {
  assert.equal(infer('시간표 조건을 같이 고민해줘'), 'timetable')
  assert.equal(infer('교시별 조건 말고 시수를 먼저 비교하자'), 'timetable')
})

test('일정과 할 일 문장은 실행 없이 일정 관점만 추천한다', () => {
  for (const prompt of ['일정이 겹칠 때 대안을 알려줘', '할 일을 정리하고 우선순위를 정해 보자', '마감까지 준비할 것을 점검하자'])
    assert.equal(infer(prompt), 'schedule', prompt)
})

test('메시지·문서·수업·학교 관리의 명확한 단서도 자산을 따라 추천한다', () => {
  for (const [prompt, expected] of [
    ['메시지를 어떻게 다듬을지 같이 고민해 줘', 'collaboration'],
    ['수합을 위해 필요한 문서를 정리하자', 'documents'],
    ['수업에 맞는 성취기준을 살펴보자', 'teaching'],
    ['학교 운영과 업무 분장의 영향을 비교하자', 'administration'],
  ]) assert.equal(infer(prompt), expected, prompt)
})

test('분야 단서가 동점으로 섞이면 일반 대화로 남긴다', () => {
  assert.equal(infer('시간표와 문서의 문제를 함께 이야기하자'), 'general')
  assert.equal(infer('수업과 협업을 함께 고민해 줘'), 'general')
  assert.equal(infer('일정, 메시지, 보고서를 함께 점검해 줘'), 'general')
})

test('여러 분야가 나와도 서로 다른 명확한 단서가 더 많은 분야를 추천한다', () => {
  assert.equal(infer('시간표의 시수와 교시를 조정하며 문서를 정리하자'), 'timetable')
  assert.equal(infer('문서와 수합 양식에 일정도 담고 싶어'), 'documents')
})

test('같은 단어를 반복해서 혼합 분야의 동점을 덮어쓰지 않는다', () => {
  assert.equal(infer('시간표 시간표 시간표 그리고 문서를 같이 생각하자'), 'general')
})

test('무관한 부분 문자열이나 단서 없는 질문은 일반 대화로 남긴다', () => {
  for (const prompt of ['일정한 속도를 유지하는 방법은?', '학교를 다니며 느낀 고민을 들어줘',
    '협력업체의 로고 색을 같이 생각하자', '아이디어를 넓혀 보자', '', undefined, null])
    assert.equal(infer(prompt), 'general', String(prompt))
})

test('띄어쓰기와 조사가 달라도 명확한 단어 경계를 읽는다', () => {
  assert.equal(infer('관찰   기록에서 개선할 점을 알려줘'), 'teaching')
  assert.equal(infer('학교\n관리에만 집중해 보자'), 'administration')
  assert.equal(infer('“시간표”를 검토해 줘 😀'), 'timetable')
})

test('학생·작업 종류·선택 자료 문맥은 입력의 분야 단서보다 우선한다', () => {
  assert.equal(inferConversationProfile({ intent: 'document_draft', prompt: '시간표 시간표' }), 'documents')
  assert.equal(inferConversationProfile({ intent: 'school_advice', studentContext: { studentId: 's', courseId: 'c', evidence: [] }, prompt: '문서' }), 'teaching')
  assert.equal(inferConversationProfile({ intent: 'school_advice', references: [{ kind: 'calendar', id: 'one', version: 1 }], prompt: '시간표 시수 교시' }), 'schedule')
  assert.equal(inferConversationProfile({ intent: 'school_advice', references: [
    { kind: 'calendar', id: 'one', version: 1 }, { kind: 'document', id: 'two', version: 1 },
  ], prompt: '시간표 시수 교시' }), 'general')
})

test('입력 기반 추천과 수동 일반 대화 조립 모두 원문·자료·모드를 바꾸지 않는다', () => {
  const context = Object.freeze({ mode: 'school', intent: 'school_advice', prompt: '  시간표의 조건을\r\n같이 고민해 줘 😀  ',
    references: Object.freeze([]), studentContext: null })
  const before = JSON.stringify(context)
  assert.equal(inferConversationProfile(context), 'timetable')
  assert.equal(JSON.stringify(context), before)
  assert.equal(composeConversationPrompt(context.prompt, 'general'), context.prompt)
  assert.deepEqual(readConversationPrompt(composeConversationPrompt(context.prompt, inferConversationProfile(context))),
    { profileId: 'timetable', prompt: context.prompt })
})

if (failed) process.exit(1)
console.log(`전부 통과 — ${passed}건`)
