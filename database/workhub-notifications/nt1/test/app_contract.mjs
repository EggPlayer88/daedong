import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from '../../../../tests/helpers/load-browser-module.mjs'

// 이 파일에는 운영 주소·키가 없으며, 격리 SQL 시험에서 받은 합성 응답만 읽는다.
const captured = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { message, collection } = await loadBrowserModule(`
import * as message from '../apps/workhub/src/messaging/validation'
import * as collection from '../apps/workhub/src/collections/validation'
export { message, collection }
`)
for (const item of captured.inboxes) {
  const value = message.envelope(item.raw, item.scope)
  const parsed = message.page(value, notice => message.notice(notice, item.scope), notice => notice.id)
  assert.ok(parsed.items.length > 0)
  assert.ok(parsed.items.every(notice => ['messages', 'collections'].includes(notice.source?.module)))
}
for (const item of captured.messages) message.receipt(item.raw, item.command, item.key, item.self)
collection.collectionReceipt(captured.collection.raw, captured.collection.key, captured.collection.requestId)
console.log(`PASS 실제 SQL → 현재 앱 알림·접수증 parser ${captured.inboxes.length + captured.messages.length + 1}건`)
