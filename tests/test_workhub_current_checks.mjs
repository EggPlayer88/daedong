import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { currentChecks, currentCheckSources, exportCurrentChecks } from '../scripts/export-workhub-current-checks.mjs'

const temporary = mkdtempSync(join(tmpdir(), 'workhub-current-checks-test-'))
const fixtures = join(temporary, 'source')
const manifestPath = 'database/workhub-current/int11/sql-package.json'
let passed = 0
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name) }
try {
  const files = currentChecks()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  mkdirSync(dirname(join(fixtures, manifestPath)), { recursive: true })
  function restore() {
    writeFileSync(join(fixtures, manifestPath), JSON.stringify(manifest))
    for (const [index, entry] of files.entries()) {
      mkdirSync(dirname(join(fixtures, currentCheckSources[index])), { recursive: true })
      writeFileSync(join(fixtures, currentCheckSources[index]), entry.bytes)
    }
  }
  const setManifest = value => writeFileSync(join(fixtures, manifestPath), JSON.stringify(value))
  restore()
  test('현재 점검 묶음에는 INT-11·AF1·AF2·SP1의 점검 원문만 포함한다', () => {
    const result = exportCurrentChecks(temporary, fixtures)
    assert.equal(result.executedSql, false)
    assert.equal(result.postcheck, 'INT-11')
    assert.deepEqual(readdirSync(result.output).sort(), [...files.map(entry => entry.file), 'README.txt', 'SHA256SUMS'].sort())
    for (const entry of files) assert.deepEqual(readFileSync(join(result.output, entry.file)), entry.bytes)
    const readme = readFileSync(join(result.output, 'README.txt'), 'utf8')
    assert.match(readme, /48단계/)
    assert.match(readme, /INT-10·OP1-02는 AF1 이전/)
    assert.match(readme, /현재 정책 활성화 성공을 증명하지 않습니다/)
  })
  test('과거 INT-10 기준을 현재 기준으로 내보내지 않는다', () => {
    setManifest({ ...manifest, postcheck: 'INT-10' })
    assert.throws(() => currentChecks(fixtures), /기준/); restore()
  })
  test('SQL 변조·누락은 폴더 생성 전에 거절한다', () => {
    const before = readdirSync(temporary)
    writeFileSync(join(fixtures, currentCheckSources[0]), Buffer.concat([files[0].bytes, Buffer.from('\n-- changed')]))
    assert.throws(() => exportCurrentChecks(temporary, fixtures), /크기|내용/)
    assert.deepEqual(readdirSync(temporary), before); restore()
    setManifest({ ...manifest, files: [] })
    assert.throws(() => currentChecks(fixtures), /기록/); restore()
  })
  test('같은 길이 SQL 변조도 해시로 거절한다', () => {
    writeFileSync(join(fixtures, currentCheckSources[0]), Buffer.from(files[0].bytes.toString('utf8').replace('INT-11', 'INT-10')))
    assert.throws(() => currentChecks(fixtures), /내용/); restore()
  })
  test('설치 파일 추가·경로 변경·중복 기록은 허용하지 않는다', () => {
    for (const entries of [
      [...manifest.files, { ...manifest.files[0], source: 'database/site-presentation/sp1/SP1-01_기간업무_메뉴표시.sql' }],
      manifest.files.map((entry, index) => index ? entry : { ...entry, source: '../outside.sql' }),
      [manifest.files[0], ...manifest.files.slice(0, -1)],
    ]) {
      setManifest({ ...manifest, files: entries })
      assert.throws(() => exportCurrentChecks(temporary, fixtures), /기록/)
    }
    restore()
  })
  test('Windows 줄바꿈만 다르면 승인된 LF 원문을 내보낸다', () => {
    for (const [index, entry] of files.entries()) writeFileSync(join(fixtures, currentCheckSources[index]), entry.bytes.toString('utf8').replace(/\n/g, '\r\n'))
    const result = exportCurrentChecks(temporary, fixtures)
    for (const entry of files) assert.deepEqual(readFileSync(join(result.output, entry.file)), entry.bytes)
    restore()
  })
  test('반복 내보내기는 이전 폴더를 덮어쓰지 않는다', () => {
    const first = exportCurrentChecks(temporary, fixtures), second = exportCurrentChecks(temporary, fixtures)
    assert.notEqual(first.output, second.output)
    for (const entry of files) assert.deepEqual(readFileSync(join(first.output, entry.file)), readFileSync(join(second.output, entry.file)))
  })
  test('CLI는 실행·접속 옵션을 거절한다', () => {
    assert.throws(() => execFileSync(process.execPath, ['scripts/export-workhub-current-checks.mjs', '--execute'], { encoding:'utf8', windowsHide:true, stdio:'pipe' }), /SQL 실행 옵션은 없습니다/)
  })
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()), '시험 전용 임시 폴더의 범위를 확인합니다.')
  rmSync(temporary, { recursive: true, force: true })
}
console.log(`${passed}건 통과`)
