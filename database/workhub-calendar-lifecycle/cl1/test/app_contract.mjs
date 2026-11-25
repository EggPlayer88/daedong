import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from '../../../../tests/helpers/load-browser-module.mjs'

// 운영 파일·키 없이 격리 SQL 시험에서 생성한 응답만 대조한다.
const c = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { cancelReceipt, eventResponse, envelope, canonical, sha256 } = await loadBrowserModule(`
export { cancelReceipt } from '../apps/workhub/src/calendar/lifecycle'
export { eventResponse } from '../apps/workhub/src/calendar/event-response'
export { envelope, canonical, sha256 } from '../apps/workhub/src/cooperation/protocol'
`)
assert.equal(eventResponse(c.active, c.scope.schoolId, c.members).status, 'active')
assert.deepEqual(cancelReceipt(c.receipt, c.scope, c.command, c.key, c.members), cancelReceipt(c.recovered, c.scope, c.command, c.key, c.members))
assert.equal(envelope(c.unknown, c.scope, 'calendar.lifecycle.v1', false).outcome, 'unknown')
assert.equal(c.unknown.commandHash, await sha256(canonical(c.command)))
assert.throws(() => cancelReceipt({...c.receipt, event:{...c.receipt.event,version:c.command.expectedVersion}}, c.scope, c.command, c.key, c.members))
assert.throws(() => cancelReceipt({...c.receipt, schoolId:'other-school'}, c.scope, c.command, c.key, c.members))
console.log('PASS 실제 SQL → 일정 취소·복구·명령 해시·잘못된 판·다른 학교 앱 parser 6건')
