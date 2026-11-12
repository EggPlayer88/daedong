import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const {
  copyWorkflowResult: copy, workflowResultLabel: label,
  captureWorkflowPlanOrigin: capture, recordWorkflowPlanResult: record,
  hasWorkspacePlanResult: hasResult, nextWorkspacePlanStep: next, recordWorkspacePlanOutcome: mark,
  renderPlan,
} = await loadBrowserModule(`
export * from '../apps/workhub/src/app/workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-control.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspacePlanCard } from '../apps/workhub/src/assistant/WorkspacePlanCard.tsx'
export function renderPlan(saved) {
  return renderToStaticMarkup(createElement(WorkspacePlanCard, { hasInput: false, model: {
    saved, manageable: true, selectable: true, stale: false, blockedSelection: false,
    nextStep: saved.plan.steps.find(step => !saved.outcomes?.[step.id]),
    dismiss() {}, choose() {}, restoreOriginal() {},
  }}))
}`)

const date = '2026-11-12', scope = 'school/member/user', stamp = '2026-11-12T01:02:03.000Z'
const base = { scope, key: 'request-one', recordedAt: stamp }
const intervention = { ...base, kind: 'intervention', action: 'approve', requestId: 'operation-a', requestVersion: 3, changedLessonIds: ['lesson-a', 'lesson-b'] }
const transition = { ...base, kind: 'transition', action: 'apply', recordId: 'handover-a', recordVersion: 1, state: 'awaiting_admin' }
const document = { ...base, kind: 'document', action: 'create', documentId: 'document-a', documentVersion: 1 }
const guided = { scope, key: 'render-one', kind: 'guided', action: 'render', observedAt: stamp, artifactId: 'artifact-a', templateId: 'template-a', templateVersion: 2, responseId: 'response-a', responseVersion: 3, sha256: 'ab'.repeat(32), bytes: 4321 }
const message = { ...base, kind: 'message', action: 'start', deliveries: [{ threadId: 'thread-a', messageId: 'message-a', sequence: 1 }] }
const collection = { ...base, kind: 'collection', action: 'create', requestId: 'collection-a', resourceId: 'collection-a', resourceVersion: 1 }
const timetable = { ...intervention, kind: 'timetable' }
const approvalResults = [intervention, transition, document, guided]
const commands = [
  { kind: 'specialist', task: 'timetableSubstitute' },
  { kind: 'specialist', task: 'schoolTransition' },
  { kind: 'navigate', page: 'documents' },
  { kind: 'navigate', page: 'documents' },
]

function saved(command = { kind: 'navigate', page: 'documents' }) {
  return { scope, selectedId: 'step-1', plan: { kind: 'plan', prompt: '전체 업무 원문', basisDate: date, steps: [
    { id: 'step-1', prompt: '첫 업무 원문', label: '첫 업무', command },
    { id: 'step-2', prompt: '둘째 업무 원문', label: '둘째 업무', command: { kind: 'navigate', page: 'messages' } },
  ] } }
}
const origin = (value, target) => capture(value, value.plan.steps[0].prompt, scope, date, target)
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function firstResult(value) { return value.outcomes?.['step-1']?.results?.[0] }
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }

test('시간표 운영 승인은 교환 승인과 종류·원본 요청·변경 수업을 구분한다', () => {
  const raw = { ...intervention, reason: '비공개 사유', teacherIds: ['private'], command: { kind: 'approve' } }
  const result = copy(raw)
  assert.deepEqual(result, intervention)
  assert.notEqual(result.changedLessonIds, raw.changedLessonIds)
  assert.equal(label(result), '시간표 운영 승인 · 수업 2건 반영')
  assert.equal(label(timetable), '시간표 교환·이동 승인 · 수업 2건 반영')
})

test('운영 승인 전 상태·없는 요청·중복 또는 빈 수업은 반영 결과로 표시하지 않는다', () => {
  for (const raw of [
    ...['create', 'accept', 'reject', 'withdraw', 'close_request'].map(action => ({ ...intervention, action })),
    { ...intervention, requestId: '' }, { ...intervention, changedLessonIds: [] },
    { ...intervention, changedLessonIds: ['lesson-a', 'lesson-a'] }, { ...intervention, changedLessonIds: [''] },
    { ...intervention, changedLessonIds: null }, { ...intervention, changedLessonIds: 'lesson-a' },
  ]) assert.equal(copy(raw), undefined)
})

test('인계 신청·관리자 확인·수락·반려·취소·새 학년도 결과 문구를 각각 유지한다', () => {
  const cases = [
    ['apply', 'awaiting_admin', 1, '인계 신청 · 관리자 확인 대기'],
    ['apply', 'pending', 1, '인계 신청 · 받는 사람 수락 대기'],
    ['apply', 'completed', 1, '새 학년도 생성'],
    ['admin_confirm', 'pending', 2, '인계 관리자 확인 · 받는 사람 수락 대기'],
    ['admin_reject', 'rejected', 2, '인계 관리자 반려'],
    ['accept', 'accepted', 3, '인계 수락 · 반영 확인'],
    ['reject', 'rejected', 2, '인계 반려'],
    ['cancel', 'cancelled', 2, '인계 신청 취소'],
  ]
  for (const [action, state, recordVersion, expected] of cases) {
    const raw = { ...transition, action, state, recordVersion }
    assert.deepEqual(copy(raw), raw)
    assert.equal(label(copy(raw)), expected)
  }
})

test('인계 명령과 상태가 어긋나거나 신청 첫 판이 아니면 처리 내역에서 제외한다', () => {
  const allowed = new Map([
    ['apply', ['awaiting_admin', 'pending', 'completed']], ['admin_confirm', ['pending']],
    ['admin_reject', ['rejected']], ['accept', ['accepted']], ['reject', ['rejected']], ['cancel', ['cancelled']],
  ])
  for (const [action, states] of allowed) {
    for (const state of ['awaiting_admin', 'pending', 'accepted', 'rejected', 'cancelled', 'completed', 'unknown']) {
      if (!states.includes(state)) assert.equal(copy({ ...transition, action, state, recordVersion: action === 'apply' ? 1 : 2 }), undefined, action + '/' + state)
    }
  }
  for (const raw of [{ ...transition, action: 'preview' }, { ...transition, recordId: '' }, { ...transition, recordVersion: 2 }]) assert.equal(copy(raw), undefined)
})

test('인계 기록은 담당자·학생·사유·원본 명령 없이 검증된 요약만 복사한다', () => {
  const raw = { ...transition, recipientMemberId: 'private-member', resources: [{ id: 'private-resource' }], note: '인계 사유', plan: { students: ['private-student'] } }
  assert.deepEqual(copy(raw), transition)
})

test('문서 생성·수정·내용 확인·보관 이동은 제출 완료와 구별한다', () => {
  const expected = { create: '문서 초안 저장 · 제출 전', update: '문서 변경 저장 · 제출 전', confirm: '문서 내용 확인 · 제출 전', archive: '문서 보관함 이동' }
  for (const [action, text] of Object.entries(expected)) {
    const result = copy({ ...document, action, documentVersion: action === 'create' ? 1 : 2 })
    assert.equal(result.action, action)
    assert.equal(label(result), text)
  }
  for (const action of ['submit', 'publish', 'render', 'delete']) assert.equal(copy({ ...document, action }), undefined)
})

test('문서 요약은 원본 ID·판·출처만 보존하고 학생 문맥·본문·인용 원문을 복제하지 않는다', () => {
  const raw = { ...document, composeId: 'compose-a', title: '민감 제목', body: '민감 본문', sources: [{ text: '민감 원문' }], studentContext: { name: '학생 이름' }, origin: { documentId: 'source-document' } }
  assert.deepEqual(copy(raw), { ...document, composeId: 'compose-a' })
  assert.equal(copy({ ...document, documentId: '' }), undefined)
})

test('HWPX 결과의 클라이언트 확인 시각을 서버 접수 시각으로 바꾸지 않는다', () => {
  assert.deepEqual(copy(guided), guided)
  const result = copy({ ...guided, recordedAt: '2026-11-12T00:00:00.000Z' })
  assert.equal(result.observedAt, stamp)
  assert.equal(Object.hasOwn(result, 'recordedAt'), false)
  assert.equal(copy({ ...guided, observedAt: undefined, recordedAt: stamp }), undefined)
  assert.equal(label(result), 'HWPX 생성 · 답변 3판 · 파일 확인 필요')
  assert.doesNotMatch(label(result), /서버|제출 완료|제출 접수/)
})

test('HWPX 결과에는 파일 확인용 메타데이터만 남기고 파일 바이트·본문·학생 정보·URL을 복제하지 않는다', () => {
  const raw = { ...guided, body: '비공개 답변', answers: { student: 'private' }, file: new Uint8Array([1, 2, 3]), downloadUrl: 'https://example.invalid/private', storagePath: 'private/path', originalFilename: '비공개.hwpx' }
  assert.deepEqual(copy(raw), guided)
})

test('HWPX 원본 양식·답변·생성물 번호 또는 생성 동작이 없으면 결과를 만들지 않는다', () => {
  for (const field of ['artifactId', 'templateId', 'responseId']) {
    for (const value of ['', null, 1, 'bad\nvalue']) assert.equal(copy({ ...guided, [field]: value }), undefined, field)
  }
  for (const action of ['save', 'submit', 'download']) assert.equal(copy({ ...guided, action }), undefined)
})

test('판·파일 크기의 0·음수·소수·문자열·무한대·안전 범위 초과를 거부한다', () => {
  const fields = [[intervention, 'requestVersion'], [transition, 'recordVersion'], [document, 'documentVersion'], [guided, 'templateVersion'], [guided, 'responseVersion'], [guided, 'bytes']]
  for (const [raw, field] of fields) {
    for (const value of [0, -1, 1.5, '1', null, undefined, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(copy({ ...raw, [field]: value }), undefined, field + '/' + String(value))
  }
})

test('HWPX 지문은 정확히 64자리 소문자 16진수여야 한다', () => {
  for (const sha256 of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63) + '\n', null, 123]) assert.equal(copy({ ...guided, sha256 }), undefined)
})

test('새 결과에도 학교·요청 번호·시각·작성 출처의 기존 경계를 적용한다', () => {
  for (const raw of approvalResults) {
    for (const field of ['scope', 'key']) for (const value of ['', null, 123, 'bad\nvalue', 'x'.repeat(513)]) assert.equal(copy({ ...raw, [field]: value }), undefined)
    for (const composeId of ['', null, 123, 'bad\nvalue', 'x'.repeat(513)]) assert.equal(copy({ ...raw, composeId }), undefined)
    const field = raw.kind === 'guided' ? 'observedAt' : 'recordedAt'
    for (const value of [undefined, null, 'not-an-instant', '']) assert.equal(copy({ ...raw, [field]: value }), undefined)
  }
})

test('각 새 결과는 해당 업무를 여는 정확한 명령 종류에만 연결한다', () => {
  const matrix = [
    [{ kind: 'specialist', task: 'timetableSubstitute' }, ['intervention']],
    [{ kind: 'specialist', task: 'timetableExchange' }, ['timetable']],
    [{ kind: 'specialist', task: 'schoolTransition' }, ['transition']],
    [{ kind: 'navigate', page: 'timetable' }, ['timetable', 'intervention']],
    [{ kind: 'navigate', page: 'schoolAdmin' }, ['transition']],
    [{ kind: 'navigate', page: 'documents' }, ['document', 'guided']],
    [{ kind: 'specialist', task: 'schoolSettings' }, []],
    [{ kind: 'specialist', task: 'schoolRoster' }, []],
    [{ kind: 'specialist', task: 'timetablePrepare' }, []],
    [{ kind: 'specialist', task: 'timetablePublish' }, []],
    [{ kind: 'navigate', page: 'messages' }, []],
    [{ kind: 'navigate', page: 'collections' }, []],
    [{ kind: 'calendar', prompt: '일정' }, []],
  ]
  for (const [command, allowed] of matrix) {
    for (const result of [...approvalResults, timetable]) {
      const value = saved(command), updated = record(value, origin(value), result, scope, date)
      if (allowed.includes(result.kind)) assert.deepEqual(firstResult(updated), result, command.kind + '/' + result.kind)
      else assert.equal(updated, value, command.kind + '/' + result.kind)
    }
  }
})

test('메시지·수합 작성 단계를 승인·문서·생성물 결과로 처리하지 않는다', () => {
  for (const kind of ['messageDraft', 'collectionDraft']) {
    const value = saved({ kind, prompt: '새 작성' }), bound = origin(value, { kind: 'compose', id: 'compose-a' })
    for (const result of approvalResults) assert.equal(record(value, bound, { ...result, composeId: 'compose-a' }, scope, date), value)
  }
})

test('새 결과도 선택한 원문·학교·기준일에 한해서 출처를 만든다', () => {
  for (const command of commands) {
    const value = saved(command)
    assert(origin(value))
    assert.equal(capture(value, '첫 업무 원문 ', scope, date), undefined)
    assert.equal(capture(value, '첫 업무 원문', 'other-scope', date), undefined)
    assert.equal(capture(value, '첫 업무 원문', scope, '2026-11-13'), undefined)
    assert.equal(origin({ ...value, selectedId: 'missing' }), undefined)
  }
})

test('같은 번호와 문구로 새 목록을 만들어도 이전 작업의 늦은 결과는 옮기지 않는다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const before = saved(commands[index]), bound = origin(before), newer = { ...before, plan: structuredClone(before.plan) }
    assert.equal(record(newer, bound, result, scope, date), newer)
    assert.equal(record(undefined, bound, result, scope, date), undefined)
  }
})

test('현재 날짜·학교·결과 범위가 달라진 뒤에는 이전 결과를 기록하지 않는다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = saved(commands[index]), bound = origin(value)
    assert.equal(record(value, bound, result, scope, '2026-11-13'), value)
    assert.equal(record(value, bound, result, 'other-scope', date), value)
    assert.equal(record(value, bound, { ...result, scope: 'other-scope' }, scope, date), value)
    const changed = { ...value, scope: 'other-scope' }
    assert.equal(record(changed, bound, result, scope, date), changed)
  }
})

test('처리 중 선택 단계를 바꿔도 결과는 시작한 원래 단계에만 남는다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = saved(commands[index]), bound = origin(value), moved = { ...value, selectedId: 'step-2' }
    const updated = record(moved, bound, result, scope, date)
    assert.deepEqual(firstResult(updated), result)
    assert.equal(updated.selectedId, 'step-2')
    assert.equal(updated.outcomes['step-2'], undefined)
  }
})

test('인계 후속 결과는 같은 기록 번호로만 이어지고 같은 요청 번호는 중복 추가하지 않는다', () => {
  const value = saved(commands[1]), bound = origin(value)
  let current = record(value, bound, transition, scope, date)
  assert.equal(record(current, bound, structuredClone(transition), scope, date), current)
  assert.equal(record(current, bound, { ...transition, state: 'pending' }, scope, date), current)
  for (const [action, state, recordVersion] of [['admin_confirm', 'pending', 2], ['accept', 'accepted', 3]]) {
    current = record(current, bound, { ...transition, key: action, action, state, recordVersion }, scope, date)
  }
  assert.deepEqual(current.outcomes['step-1'].results.map(row => row.action), ['apply', 'admin_confirm', 'accept'])
  assert.equal(record(current, bound, { ...transition, key: 'other', recordId: 'handover-b' }, scope, date), current)
})

test('운영 승인과 교환 승인은 같은 요청 문자열을 써도 서로의 결과로 이어지지 않는다', () => {
  for (const first of [intervention, timetable]) {
    const value = saved({ kind: 'navigate', page: 'timetable' }), bound = origin(value), current = record(value, bound, first, scope, date)
    const otherKind = first.kind === 'intervention' ? 'timetable' : 'intervention'
    assert.equal(record(current, bound, { ...first, key: 'next-key', kind: otherKind }, scope, date), current)
    assert.equal(record(current, bound, { ...first, key: 'next-key', requestId: 'other-request' }, scope, date), current)
    const updated = record(current, bound, { ...first, key: 'next-key', requestVersion: 4 }, scope, date)
    assert.equal(updated.outcomes['step-1'].results.length, 2)
  }
})

test('같은 문서의 저장·내용 확인·보관 이동을 보존하고 다른 원본을 섞지 않는다', () => {
  const value = saved(), bound = origin(value)
  let current = record(value, bound, document, scope, date)
  for (const [index, action] of ['update', 'confirm', 'archive'].entries()) current = record(current, bound, { ...document, key: action, action, documentVersion: index + 2 }, scope, date)
  assert.deepEqual(current.outcomes['step-1'].results.map(row => row.action), ['create', 'update', 'confirm', 'archive'])
  assert.equal(record(current, bound, { ...document, key: 'other-key', documentId: 'document-b' }, scope, date), current)
})

test('질문형 생성물은 같은 양식·답변 원본의 새 판만 이어 기록한다', () => {
  const value = saved(), bound = origin(value), first = record(value, bound, guided, scope, date)
  const later = { ...guided, key: 'render-two', artifactId: 'artifact-b', responseVersion: 4, bytes: 5000, sha256: 'cd'.repeat(32) }
  const updated = record(first, bound, later, scope, date)
  assert.deepEqual(updated.outcomes['step-1'].results, [guided, later])
  for (const patch of [{ templateId: 'other-template' }, { responseId: 'other-response' }]) assert.equal(record(first, bound, { ...later, ...patch }, scope, date), first)
})

test('문서함과 질문형 양식을 오가도 처음 고정한 결과 종류를 다른 종류로 바꾸지 않는다', () => {
  for (const [first, later] of [[document, guided], [guided, document]]) {
    const value = saved(), bound = origin(value), current = record(value, bound, first, scope, date)
    assert.equal(record(current, bound, { ...later, key: 'later-key' }, scope, date), current)
  }
})

test('문서 검색은 검색 종류와 선택한 원본 ID가 모두 맞는 경우에만 결과를 받는다', () => {
  const value = saved({ kind: 'search', query: '보고서', kinds: ['document'] }), target = { kind: 'document', id: 'document-a' }, bound = origin(value, target)
  assert.notEqual(bound.target, target)
  assert.deepEqual(firstResult(record(value, bound, document, scope, date)), document)
  for (const result of [guided, intervention, transition, message, collection, { ...document, documentId: 'document-b' }]) assert.equal(record(value, bound, result, scope, date), value)
  assert.equal(record(value, origin(value, { kind: 'collection', id: 'document-a' }), document, scope, date), value)
  const otherKinds = saved({ kind: 'search', query: '보고서', kinds: ['knowledge', 'collection'] })
  assert.equal(record(otherKinds, origin(otherKinds, target), document, scope, date), otherKinds)
})

test('검색한 문서의 복제 원본 메타데이터로 새 문서를 원본 결과처럼 연결하지 않는다', () => {
  const value = saved({ kind: 'search', query: '보고서', kinds: ['document'] }), bound = origin(value, { kind: 'document', id: 'document-a' })
  const clone = { ...document, documentId: 'cloned-document', originalId: 'document-a', origin: { documentId: 'document-a', version: 1 } }
  assert.equal(record(value, bound, clone, scope, date), value)
  const first = record(value, bound, document, scope, date)
  assert.equal(record(first, bound, { ...clone, key: 'clone-key' }, scope, date), first)
  assert.equal(record(first, bound, guided, scope, date), first)
})

test('일반 문서 열기와 검색의 첫 결과에 별도 AI 작성 출처를 끼워 넣지 않는다', () => {
  for (const [command, target] of [[{ kind: 'navigate', page: 'documents' }, undefined], [{ kind: 'search', query: '보고서', kinds: ['document'] }, { kind: 'document', id: 'document-a' }]]) {
    const value = saved(command), bound = origin(value, target)
    for (const action of ['create', 'update', 'confirm', 'archive']) assert.equal(record(value, bound, { ...document, action, composeId: 'separate-ai-request' }, scope, date), value)
    assert.deepEqual(firstResult(record(value, bound, document, scope, date)), document)
  }
})

test('첫 문서 원본을 고정한 뒤 AI 도움을 받아 수정해도 같은 문서의 후속 결과만 보존한다', () => {
  const value = saved(), bound = origin(value), first = record(value, bound, document, scope, date)
  const later = { ...document, action: 'update', key: 'update-ai', documentVersion: 2, composeId: 'separate-ai-request' }
  const updated = record(first, bound, later, scope, date)
  assert.deepEqual(updated.outcomes['step-1'].results, [document, later])
  assert.equal(record(first, bound, { ...later, documentId: 'other-document' }, scope, date), first)
})

test('새 결과마다 원요청 재확인과 같은 번호의 다른 내용은 중복 기록하지 않는다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = saved(commands[index]), bound = origin(value), first = record(value, bound, result, scope, date)
    assert.equal(record(first, bound, structuredClone(result), scope, date), first)
    const stampField = result.kind === 'guided' ? 'observedAt' : 'recordedAt'
    assert.equal(record(first, bound, { ...result, [stampField]: '2026-11-12T02:00:00.000Z' }, scope, date), first)
    assert.equal(first.outcomes['step-1'].results.length, 1)
  }
})

test('고정된 원본 계획과 결과를 수정하지 않고 기록 후 호출자의 변경과 분리한다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = freeze(saved(commands[index])), before = JSON.stringify(value), raw = structuredClone(result), updated = record(value, origin(value), raw, scope, date)
    assert.equal(JSON.stringify(value), before)
    assert.equal(updated.plan, value.plan)
    assert.notEqual(firstResult(updated), raw)
    raw.key = 'changed-key'
    if (raw.changedLessonIds) raw.changedLessonIds.push('changed-lesson')
    if (raw.kind === 'guided') raw.sha256 = 'ef'.repeat(32)
    assert.deepEqual(firstResult(updated), result)
  }
})

test('기존 화면 연결은 새 결과로 바꾸되 확인된 개인 업무나 기록은 덮어쓰지 않는다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = saved(commands[index]), bound = origin(value)
    const opened = { ...value, outcomes: { 'step-1': { kind: 'opened' } } }
    const updated = record(opened, bound, result, scope, date)
    assert.equal(updated.outcomes['step-1'].kind, 'recorded')
    assert.equal(mark(updated, '첫 업무 원문', 'opened', scope, date), updated)
    assert.equal(origin(updated), undefined)
    const confirmed = { ...value, outcomes: { 'step-1': { kind: 'confirmed', receipt: { kind: 'taskChange', key: 'task-key', id: 'task-id', title: '할 일', version: 1 } } } }
    assert.equal(record(confirmed, bound, result, scope, date), confirmed)
  }
})

test('처리 기록이 있는 승인·생성 단계는 다음 선택에서 건너뛰고 단순 화면 연결은 남긴다', () => {
  for (const [index, result] of approvalResults.entries()) {
    const value = saved(commands[index]), first = record(value, origin(value), result, scope, date)
    assert.equal(hasResult(first.outcomes['step-1']), true)
    assert.equal(next({ ...first, selectedId: undefined }).id, 'step-2')
    const opened = { ...value, selectedId: undefined, outcomes: { 'step-1': { kind: 'opened' } } }
    assert.equal(next(opened).id, 'step-1')
    const all = { ...first, selectedId: undefined, outcomes: { ...first.outcomes, 'step-2': { kind: 'recorded', results: [message] } } }
    assert.equal(next(all), undefined)
  }
})

test('기존 처리 내역 화면은 마지막 상태·앞선 이력·재선택 잠금을 새 인계 결과에도 유지한다', () => {
  const value = saved(commands[1]), bound = origin(value)
  const first = record(value, bound, transition, scope, date)
  const current = record(first, bound, { ...transition, key: 'accept-key', action: 'accept', recordVersion: 3, state: 'accepted' }, scope, date)
  const html = renderPlan(current)
  assert.match(html, /data-outcome="recorded"/)
  assert.match(html, /처리 내역 확인/)
  assert.match(html, /인계 수락 · 반영 확인/)
  assert.match(html, /이전 처리 1건/)
  assert.match(html, /인계 신청 · 관리자 확인 대기/)
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="1단계 선택 · 첫 업무"/)
  assert.doesNotMatch(html, /서버 처리 확인/)
})

test('HWPX 결과 화면은 생성과 파일 확인 필요를 표시하며 기존 메시지·수합 표시는 보존한다', () => {
  for (const result of [guided, message, collection]) {
    const value = saved(), current = { ...value, outcomes: { 'step-1': { kind: 'recorded', results: [result] } } }
    const html = renderPlan(current)
    assert(html.includes(label(result)))
    assert.match(html, /처리 내역 확인/)
    assert.doesNotMatch(html, /서버 처리 확인/)
    assert.doesNotMatch(html, /이전 처리 0건/)
  }
})

console.log(`승인·문서 생성 결과 연결: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
