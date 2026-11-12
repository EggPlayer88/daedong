import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareTransitionCaptureMetadata, transitionCaptureMetadataSource, TRANSITION_CAPTURE_MODE } from './integration/workhub-transition-capture-metadata.mjs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url)), mode = TRANSITION_CAPTURE_MODE
const paths = Object.fromEntries(['p7', 'p8'].map(suite => [suite, `database/workhub/${suite}/test/app_contract_${suite}.ts`]))
const originals = Object.fromEntries(Object.entries(paths).map(([suite, path]) => [suite, readFileSync(join(repo, path), 'utf8')]))
const hash = value => createHash('sha256').update(value).digest('hex')
const work = mkdtempSync(join(tmpdir(), 'workhub-release-r0-verify-metadata-'))
let count = 0, sequence = 0
async function test(name, run) { await run(); count++; console.log('  ✓ ' + name) }
function fixture() {
  const run = join(work, 'run-' + (++sequence)), snapshot = join(run, 'source'), report = join(run, 'reports', 'source-manifest.json')
  const files = Object.entries(paths).map(([suite, path]) => {
    const target = join(snapshot, path), source = originals[suite]
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source)
    return { path, sourceSha256: hash(source), testedSha256: hash(source) }
  })
  mkdirSync(dirname(report), { recursive: true })
  const manifest = { schemaVersion: 1, sqlCommit: '5c05c2d78af44e4b10455ba06291d93971f7628e', appCommit: 'test-app', files }
  writeFileSync(report, JSON.stringify(manifest))
  return { snapshot, report, manifest }
}
function expectedReceipt(suite, source, capture, output, isRecovery = false) {
  const start = source.indexOf(suite === 'p7' ? 'same = c.raw.data && {' : 'same = { requestKey: c.raw.data.requestKey')
  assert(start >= 0)
  const end = source.indexOf(suite === 'p7' ? '\n        break' : '\n        bump(states,', start)
  assert(end > start)
  // 사본에서 실제 실행할 비교식 그대로 평가한다. 새 비교식을 시험에 따로 복제하지 않는다.
  return new Function('c', 'out', 'isRecovery', `let same; ${source.slice(start, end)}; return same`)(capture, output, isRecovery)
}
const server = { requestKey: 'receipt-key', recordId: 'record-one', version: 1, state: 'completed', recordedAt: '2026-11-12T01:02:03.000Z' }
const output = { ...server, legacyDutyReceipt: false }, capture = { raw: { data: server }, command: { kind: 'apply' }, dutyRecord: false }

try {
  await test('원본 기대값은 PR #125의 축약 모양이며 현재 앱 메타데이터와 exact 비교하면 실패한다', () => {
    for (const suite of ['p7', 'p8']) {
      const expected = expectedReceipt(suite, originals[suite], capture, output)
      assert.equal(Object.hasOwn(expected, 'version'), false)
      assert.equal(Object.hasOwn(expected, 'recordedAt'), false)
      assert.throws(() => assert.deepEqual(output, expected))
    }
  })
  await test('고정 원본의 두 비교식에만 서버 판·접수 시각을 추가하고 기존 조건은 보존한다', () => {
    for (const suite of ['p7', 'p8']) {
      const adapted = transitionCaptureMetadataSource(suite, originals[suite], mode)
      assert.deepEqual(expectedReceipt(suite, adapted, capture, output), output)
      assert.equal(adapted.replace(', version: c.raw.data.version, recordedAt: c.raw.data.recordedAt', ''), originals[suite])
    }
  })
  await test('현재 모드는 앱 메타데이터 누락을 옛 축약 모양으로 조용히 허용하지 않는다', () => {
    for (const suite of ['p7', 'p8']) {
      const expected = expectedReceipt(suite, transitionCaptureMetadataSource(suite, originals[suite], mode), capture, output)
      for (const key of ['version', 'recordedAt']) {
        const missing = { ...output }; delete missing[key]
        assert.throws(() => assert.deepEqual(missing, expected))
      }
    }
  })
  await test('앱 결과의 다른 유효 판·시각·번호·상태·추가 필드도 서버 원문과 다른 값으로 거부한다', () => {
    for (const suite of ['p7', 'p8']) {
      const expected = expectedReceipt(suite, transitionCaptureMetadataSource(suite, originals[suite], mode), capture, output)
      for (const patch of [{ version: 2 }, { recordedAt: '2026-11-12T01:02:04.000Z' }, { recordedAt: '2026-11-12T01:02:03Z' }, { requestKey: 'other' }, { recordId: 'other' }, { state: 'pending' }, { legacyDutyReceipt: true }, { extra: 'untrusted' }]) assert.throws(() => assert.deepEqual({ ...output, ...patch }, expected))
    }
  })
  await test('P7 옛 공식 담당 복구 여부와 P8 현재 접수 구분을 기존 조건 그대로 검사한다', () => {
    const old = { ...capture, raw: { data: { ...server, state: 'pending' } }, dutyRecord: true }
    const p7 = transitionCaptureMetadataSource('p7', originals.p7, mode), p8 = transitionCaptureMetadataSource('p8', originals.p8, mode)
    assert.equal(expectedReceipt('p7', p7, old, output, true).legacyDutyReceipt, true)
    assert.equal(expectedReceipt('p7', p7, old, output, false).legacyDutyReceipt, false)
    assert.equal(expectedReceipt('p8', p8, old, output, true).legacyDutyReceipt, false)
  })
  await test('원본 해시가 다르거나 이미 보정됐거나 알 수 없는 모드이면 중단한다', () => {
    for (const suite of ['p7', 'p8']) {
      for (const source of [originals[suite] + '\n', originals[suite].replace('same =', 'same='), transitionCaptureMetadataSource(suite, originals[suite], mode)]) assert.throws(() => transitionCaptureMetadataSource(suite, source, mode), /UNEXPECTED_RECEIPT_CAPTURE_SOURCE/)
      for (const value of [undefined, '', 'legacy', 'auto']) assert.throws(() => transitionCaptureMetadataSource(suite, originals[suite], value), /INVALID_RECEIPT_CAPTURE_MODE/)
    }
  })
  await test('Windows와 Linux 줄끝 차이는 내용 해시를 유지하며 보정 후 줄끝도 보존한다', () => {
    for (const suite of ['p7', 'p8']) {
      const unix = originals[suite].replace(/\r\n/g, '\n'), windows = unix.replace(/\n/g, '\r\n')
      assert.equal(transitionCaptureMetadataSource(suite, windows, mode).replace(/\r\n/g, '\n'), transitionCaptureMetadataSource(suite, unix, mode))
    }
  })
  await test('사본에만 적용하고 manifest에 원본과 실행한 검증기 해시를 각각 남긴다', () => {
    const value = fixture(), sql = join(value.snapshot, 'database/workhub/p7/unchanged.sql')
    writeFileSync(sql, 'SQL 원문 보존')
    const result = prepareTransitionCaptureMetadata(value.snapshot, value.report, mode)
    const manifest = JSON.parse(readFileSync(value.report, 'utf8'))
    assert.equal(result.files.length, 2)
    for (const [suite, path] of Object.entries(paths)) {
      const row = manifest.files.find(item => item.path === path)
      assert.equal(row.sourceSha256, hash(originals[suite]))
      assert.equal(row.testedSha256, hash(readFileSync(join(value.snapshot, path))))
      assert.notEqual(row.sourceSha256, row.testedSha256)
      assert.equal(readFileSync(join(repo, path), 'utf8'), originals[suite])
    }
    assert.equal(readFileSync(sql, 'utf8'), 'SQL 원문 보존')
    assert.deepEqual(manifest.transitionReceiptMetadata, result)
    assert.throws(() => prepareTransitionCaptureMetadata(value.snapshot, value.report, mode), /INVALID_RECEIPT_CAPTURE_MANIFEST/)
  })
  await test('두 번째 사본 원문이 다르면 첫 사본과 manifest도 변경하지 않는다', () => {
    const value = fixture(), first = join(value.snapshot, paths.p7), second = join(value.snapshot, paths.p8), before = readFileSync(value.report, 'utf8')
    writeFileSync(second, originals.p8 + '\n')
    assert.throws(() => prepareTransitionCaptureMetadata(value.snapshot, value.report, mode), /INVALID_RECEIPT_CAPTURE_MANIFEST/)
    assert.equal(readFileSync(first, 'utf8'), originals.p7)
    assert.equal(readFileSync(value.report, 'utf8'), before)
  })
  await test('변조한 manifest의 기준 커밋·원본 해시·실행 해시·중복 경로를 허용하지 않는다', () => {
    for (const change of [m => { m.sqlCommit = 'other' }, m => { m.files[0].sourceSha256 = '0'.repeat(64) }, m => { m.files[0].testedSha256 = '0'.repeat(64) }, m => { m.files.push(m.files[0]) }]) {
      const value = fixture(); change(value.manifest); writeFileSync(value.report, JSON.stringify(value.manifest))
      assert.throws(() => prepareTransitionCaptureMetadata(value.snapshot, value.report, mode), /INVALID_RECEIPT_CAPTURE_MANIFEST/)
      assert.equal(readFileSync(join(value.snapshot, paths.p7), 'utf8'), originals.p7)
    }
  })
  await test('저장소 원본 경로나 다른 출력 폴더를 사본으로 지정하면 쓰기 전에 거부한다', () => {
    const value = fixture()
    assert.throws(() => prepareTransitionCaptureMetadata(repo, value.report, mode), /INVALID_RECEIPT_CAPTURE_PATH/)
    const misplaced = join(dirname(value.report), 'other.json'); writeFileSync(misplaced, JSON.stringify(value.manifest))
    assert.throws(() => prepareTransitionCaptureMetadata(value.snapshot, misplaced, mode), /INVALID_RECEIPT_CAPTURE_PATH/)
  })
  await test('실제 인계 서비스의 판·접수 시각은 보정한 P7·P8 기대값과 정확히 일치한다', async () => {
    const { createTransitionService } = await loadBrowserModule(`export { createTransitionService } from '../apps/workhub/src/administration/transitions.ts'`)
    const member = { id: 'm', schoolId: 's', userId: 'u', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
    const command = { kind: 'apply', fingerprint: 'a'.repeat(64), plan: { kind: 'new_year', sourceYearId: 'y26', targetYear: 2027, firstDay: '2027-03-01', lastDay: '2028-02-29', term1First: '2027-03-01', term1Last: '2027-08-12', term2First: '2027-08-13', term2Last: '2028-02-29', copyStructure: true } }
    const connection = { info: () => ({ memberships: [member], schools: [{ id: 's' }], basisDate: '2026-11-12' }), getIdentity: async () => ({ userId: 'u', approved: true }), rpcVerified: async () => ({ contract: 'school-transitions.v1', schoolId: 's', memberId: 'm', data: structuredClone(server) }) }
    const actual = await createTransitionService(connection).mutate('m', command, server.requestKey)
    for (const suite of ['p7', 'p8']) assert.deepEqual(actual, expectedReceipt(suite, transitionCaptureMetadataSource(suite, originals[suite], mode), { ...capture, command }, actual))
  })
  console.log(`인계 SQL 캡처 메타데이터 대조: ${count}건 통과`)
} finally {
  // 이 시험에서 만든 임시 사본만 정리한다. 저장소 원본과 SQL은 쓰지 않는다.
  rmSync(work, { recursive: true, force: true })
}
