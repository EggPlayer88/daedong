// 실제 앱 조회·검증 경로에 합성 네트워크 지연을 넣는다. 운영 Supabase를 호출하지 않는다.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { loadBrowserModule } from '../tests/helpers/load-browser-module.mjs'

const args = process.argv.slice(2)
const value = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
const pageCount = Number(value('--pages', 500)), delayMs = Number(value('--delay-ms', 200)), output = value('--output', '')
const expected = value('--expect', 'success'), lifetimeMs = Number(value('--lifetime-ms', 900000))
if (![pageCount, delayMs, lifetimeMs].every(Number.isSafeInteger) || pageCount < 1 || delayMs < 0 || lifetimeMs < 1 || lifetimeMs > 900000 || !['success', 'CONFLICT'].includes(expected)) throw Error('검사 인자를 확인해 주세요.')
const app = await loadBrowserModule(`export {createSupabaseConnection} from '../apps/workhub/src/connection/supabase-connection'; export {createTimetableOperationsExtensions} from '../apps/workhub/src/timetable/operations-next-server'; export {verifyPublicationChanges} from '../apps/workhub/src/timetable/publication-execution-server'; export {canonical} from '../apps/workhub/src/services/scoped-rpc';`)
const hash = data => createHash('sha256').update(app.canonical(data)).digest('hex')
const pageSize = 200, totalChanges = pageCount * pageSize, captured = Date.now()
const date = new Date(captured + 2 * 86400000).toISOString().slice(0, 10)
const until = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)
const member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 교사', role: 'teacher', active: true, validFrom: '2020-01-01', validThrough: '2100-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const context = { schools: [{ id: 'school', name: '합성 학교' }], memberships: [member], basisDate: new Date(captured).toISOString().slice(0, 10), schoolLabels: { school: { departmentIds: [], gradeIds: [], subjectIds: [] } } }
const rows = index => Array.from({ length: pageSize }, (_, offset) => ({ before: null, after: { id: 'lesson-' + (index * pageSize + offset), version: 1, label: '합성 수업', time: { startsAt: date + 'T00:00:00.000Z', endsAt: date + 'T00:45:00.000Z' }, teachers: [{ id: 'member', name: '합성 교사' }], groupNames: ['합성 학급'], roomNames: [], state: 'scheduled', canRequest: false, allowedTargets: [] } }))
const pageHashes = Array.from({ length: pageCount }, (_, index) => hash(rows(index)))
let manifest, profiles = 0, pageCalls = 0, progress = { pages: 0, totalPages: pageCount, changes: 0, totalChanges }
const delay = () => new Promise(resolve => setTimeout(resolve, delayMs))
const connection = app.createSupabaseConnection({
  getSession: async () => ({ user: { id: 'user' } }),
  fetchMyProfile: async () => { profiles++; await delay(); return { id: 'user', name: '합성 교사', email: 'synthetic@example.invalid', role: 'superadmin', is_active: true, department_id: null, extra_permissions: [] } },
  rpc: async (name, payload) => {
    if (name === 'workhub_context') return { data: context, error: null }
    assert.equal(name, 'workhub_timetable_operations_publish_page'); assert.equal(payload.p_member_id, 'member')
    assert.equal(payload.p_preview_id, manifest.previewId); assert.equal(payload.p_manifest_hash, manifest.manifestHash)
    pageCalls++; await delay()
    return { error: null, data: { contract: 'timetable-operations.next.v1', schoolId: 'school', memberId: 'member', data: { previewId: manifest.previewId, manifestHash: manifest.manifestHash, index: payload.p_index, pageHash: pageHashes[payload.p_index], changes: rows(payload.p_index) } } }
  },
})
await connection.loadContext('school'); profiles = 0
const start = Date.now(), started = performance.now()
const content = { previewId: 'preview', previewHash: 'a'.repeat(64), input: { draftId: 'draft', draftVersion: 1, from: date, until }, timeZone: 'Asia/Seoul', createdAt: new Date(start).toISOString(), expiresAt: new Date(start + lifetimeMs).toISOString(), basisFingerprint: 'b'.repeat(64), totalChanges, pageSize, pageHashes, blockerCount: 0, complete: true, preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
manifest = { ...content, manifestHash: hash(content) }
console.log(JSON.stringify({ stage: 'started', pageCount, totalChanges, delayMs, lifetimeMs, expected }))
let outcome = 'success'
try {
  await app.verifyPublicationChanges(app.createTimetableOperationsExtensions(connection), 'member', manifest, { onProgress: next => { progress = next; if (next.pages && next.pages % 100 === 0) console.log(JSON.stringify({ stage: 'progress', pages: next.pages, elapsedMs: Math.round(performance.now() - started) })) } })
} catch (error) { outcome = error.code ?? error.message }
const result = { pageCount, pageSize, totalChanges, delayMs, lifetimeMs, outcome, expected, verifiedPages: progress.pages, profiles, pageCalls, elapsedMs: Math.round(performance.now() - started), remainingMs: start + lifetimeMs - Date.now(), network: 'synthetic delays; real application identity and parser path', platform: process.platform, node: process.version }
if (output) writeFileSync(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
assert.equal(outcome, expected)
assert.equal(profiles, pageCalls * 3)
if (expected === 'success') { assert.equal(pageCalls, pageCount); assert.equal(progress.changes, totalChanges); assert.ok(result.remainingMs > 0) }
