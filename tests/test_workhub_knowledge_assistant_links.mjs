import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
import * as links from '../apps/workhub/src/knowledge/assistant-links'
import { AnswerView } from '../apps/workhub/src/assistant/AssistantPanel'
import { renderToStaticMarkup } from 'react-dom/server'
export { links }
export const render=(segments,enabled=true)=>renderToStaticMarkup(<AnswerView segments={segments} onOpenKnowledgeCitation={enabled?()=>{}:undefined}/>)
`, { env: { MODE: 'test', VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key' } })
const member = { id: 'member', userId: 'user', schoolId: 'school', name: '나', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
const source = { id: 'source-one', schoolId: 'school', authorMemberId: 'author', title: '학교 규정', kind: 'regulation', body: '전체 원문은 질문 문자열에 복제하지 않습니다.', locator: '제3조', effectiveFrom: '2026-03-01', effectiveThrough: '2027-02-28', version: 7, status: 'published', updatedAt: '2026-10-21T00:00:00Z' }
const citation = { reference: { kind: 'knowledge', id: 'source-one', version: 7 }, title: '학교 규정', locator: '제3조' }
let count = 0
function test(name, run) { run(); count++; console.log('  ✓ ' + name) }
test('게시된 현재 적용 자료만 정확한 원본 ID·판으로 학교 비서에 전달한다', () => {
  const request = m.links.knowledgeAssistantRequest(source, member, '2026-10-21'), context = m.links.knowledgeAssistantContext(request, member)
  assert.equal(context.mode, 'school'); assert.equal(context.intent, 'school_advice'); assert.equal(context.studentContext, null)
  assert.deepEqual(context.references, [{ kind: 'knowledge', id: source.id, version: 7 }]); assert.equal(context.prompt.includes(source.body), false)
  assert.equal(request.schoolId, member.schoolId); assert.equal(request.memberId, member.id)
})
test('적용 첫날·마지막 날을 포함하고 기한 밖·초안·종료 자료는 질문 전달을 거절한다', () => {
  for (const date of ['2026-03-01', '2027-02-28']) assert.equal(m.links.knowledgeAssistantRequest(source, member, date).sourceVersion, 7)
  for (const row of [{ ...source, status: 'draft' }, { ...source, status: 'retired' }, { ...source, effectiveFrom: '2026-11-01' }, { ...source, effectiveThrough: '2026-10-20' }]) assert.throws(() => m.links.knowledgeAssistantRequest(row, member, '2026-10-21'))
})
test('다른 학교 자료와 비활성 소속으로 질문 근거를 만들지 않는다', () => {
  assert.throws(() => m.links.knowledgeAssistantRequest({ ...source, schoolId: 'other' }, member, '2026-10-21'))
  assert.throws(() => m.links.knowledgeAssistantRequest(source, { ...member, active: false }, '2026-10-21'))
})
test('질문 전달 데이터의 계정·학교·양의 정수 판·명시 필드를 검증한다', () => {
  const request = m.links.knowledgeAssistantRequest(source, member, '2026-10-21')
  for (const row of [{ ...request, schoolId: 'other' }, { ...request, memberId: 'other' }, { ...request, sourceVersion: 0 }, { ...request, sourceVersion: 7.1 }, { ...request, sourceId: 'https://example.com' }, { ...request, body: '몰래 붙인 내용' }]) assert.throws(() => m.links.knowledgeAssistantContext(row, member))
})
test('비서 인용은 인용 당시 판을 유지하고 학교 자료 외 자원은 원문 링크로 바꾸지 않는다', () => {
  const request = m.links.knowledgeCitationRequest(citation, member)
  assert.equal(request.sourceVersion, 7); assert.equal(request.sourceId, 'source-one')
  for (const kind of ['document', 'task', 'collection', 'calendar']) assert.throws(() => m.links.knowledgeCitationRequest({ ...citation, reference: { ...citation.reference, kind } }, member))
})
test('원문 열기 요청은 현재 계정·학교와 일치해야 하며 깨진 값은 거절한다', () => {
  const request = { key: 'open-one', ...m.links.knowledgeCitationRequest(citation, member) }
  assert.equal(m.links.validKnowledgeOpenRequest(request, member), true)
  for (const row of [null, {}, { ...request, memberId: 'other' }, { ...request, schoolId: 'other' }, { ...request, sourceVersion: -1 }, { ...request, key: '' }, { ...request, extra: true }]) assert.equal(m.links.validKnowledgeOpenRequest(row, member), false)
})
test('인용 출처 종류를 가리지 않고 버튼을 만들지 않으며 명시 콜백이 있어야 연결한다', () => {
  const segments = [{ text: '답변', citations: [citation, { ...citation, reference: { kind: 'document', id: 'document-one', version: 2 } }] }]
  assert.equal((m.render(segments).match(/인용 원문 보기/g) ?? []).length, 1)
  assert.equal(m.render(segments, false).includes('인용 원문 보기'), false)
})
console.log(`학교 자료·비서 인용 연결 ${count}건 통과`)
