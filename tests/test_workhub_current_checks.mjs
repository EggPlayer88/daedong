import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { currentChecks, exportCurrentChecks } from '../scripts/export-workhub-current-checks.mjs'

const temporary = mkdtempSync(join(tmpdir(), 'workhub-current-checks-test-'))
const fixtures = join(temporary, 'source'), folder = join(fixtures, 'database/workhub-participation/op1')
let passed = 0
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name) }
try {
  const files = currentChecks()
  mkdirSync(folder, { recursive: true })
  const manifest = { postcheck: 'INT-10', files: files.map(entry => ({ file: entry.file, bytes: entry.bytes.length, sha256: entry.sha256 })) }
  function restore() {
    writeFileSync(join(folder, 'sql-package.json'), JSON.stringify(manifest))
    for (const entry of files) writeFileSync(join(folder, entry.file), entry.bytes)
  }
  restore()
  test('최신 점검 묶음에는 INT-10·OP1-02만 있고 설치·활성화 SQL은 없다', () => {
    const result = exportCurrentChecks(temporary, fixtures)
    assert.equal(result.executedSql, false)
    assert.deepEqual(readdirSync(result.output).sort(), ['INT-10_SQL편집기용_통합점검.sql', 'OP1-02_사후점검.sql', 'README.txt', 'SHA256SUMS'].sort())
    for (const entry of files) assert.deepEqual(readFileSync(join(result.output, entry.file)), entry.bytes)
  })
  test('실수로 이전 INT-05 기준을 사용하면 내보내기를 중단한다', () => {
    writeFileSync(join(folder, 'sql-package.json'), JSON.stringify({ ...manifest, postcheck: 'INT-05' }))
    assert.throws(() => currentChecks(fixtures), /기준/); restore()
  })
  test('SQL이 바뀌거나 기록이 빠지면 빈 배포 폴더도 만들지 않는다', () => {
    const before = readdirSync(temporary)
    writeFileSync(join(folder, files[0].file), Buffer.concat([files[0].bytes, Buffer.from('\n-- changed')]))
    assert.throws(() => exportCurrentChecks(temporary, fixtures), /크기|내용/)
    assert.deepEqual(readdirSync(temporary), before); restore()
    writeFileSync(join(folder, 'sql-package.json'), JSON.stringify({ ...manifest, files: [] }))
    assert.throws(() => currentChecks(fixtures), /기록/); restore()
  })
  test('Windows 줄바꿈만 달라도 승인된 LF 원문으로 내보낸다', () => {
    for (const entry of files) writeFileSync(join(folder, entry.file), entry.bytes.toString('utf8').replace(/\n/g, '\r\n'))
    const result = exportCurrentChecks(temporary, fixtures)
    for (const entry of files) assert.deepEqual(readFileSync(join(result.output, entry.file)), entry.bytes)
  })
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()), '시험 전용 임시 폴더의 범위를 확인합니다.')
  rmSync(temporary, { recursive: true, force: true })
}
console.log(`${passed}건 통과`)
