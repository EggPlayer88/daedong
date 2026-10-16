import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createPendingRequests, createEditDrafts } = await loadBrowserModule(`
  export {createPendingRequests} from '../apps/workhub/src/app/pending-requests.tsx'
  export {createEditDrafts} from '../apps/workhub/src/app/edit-drafts.tsx'
`)
const pending = createPendingRequests()
const command = { kind: 'submit', requestId: 'request', unitId: 'unit', draftId: 'draft', expectedDraftVersion: 3, expectedVersion: 2, reason: '보완', correctionRequestId: 'supplement' }
pending.put('same-school', 'collection', { key: 'stable-key', command })
command.reason = '나중 수정'
assert.equal(pending.get('same-school', 'collection').command.reason, '보완')
pending.remove('same-school', 'collection', 'different-key')
assert.equal(pending.count(), 1)
pending.retainScopes(['same-school'])
assert.equal(pending.get('same-school', 'collection').key, 'stable-key')
console.log('  ✓ 수합 미확정 명령의 원래 본문·보완 요청·키가 재조회에도 유지된다')
pending.put('same-school', 'task', { key: 'task-key', command: { kind: 'create', input: { title: '업무', notes: '', dueDate: '' } } })
pending.remove('same-school', 'collection', 'stable-key')
assert.equal(pending.count(), 1)
assert.equal(pending.get('same-school', 'task').key, 'task-key')
pending.retainScopes(['different-school'])
assert.equal(pending.count(), 0)
console.log('  ✓ 수합 접수 확인은 개인 업무 복구를 지우지 않고 학교 변경은 이전 명령을 제거한다')
const edits = createEditDrafts(true)
edits.activate('same-school')
const original = edits.bind('same-school', 'collection-editor')
original.save({ title: '미저장 수합', files: [{ id: 'ready-file' }] })
edits.suspend()
original.save({ title: '늦게 도착한 응답' })
assert.equal(edits.bind('same-school', 'collection-editor').initial, undefined)
edits.activate('same-school')
assert.equal(edits.bind('same-school', 'collection-editor').initial.title, '미저장 수합')
edits.activate('different-school')
assert.equal(edits.bind('different-school', 'collection-editor').initial, undefined)
assert.equal(edits.count(), 0)
console.log('  ✓ 연결 실패 중 수합 입력은 숨기고 동일 범위 재검증 후 복원하며 다른 학교에는 남기지 않는다')
