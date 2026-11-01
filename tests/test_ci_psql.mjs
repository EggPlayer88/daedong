// 실제 CI의 클라이언트 실행 경계를 검사한다. DB·네트워크에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash'
const unix = path => process.platform === 'win32'
  ? execFileSync(bash, ['-c', 'cygpath -u "$1"', 'path', path], { encoding: 'utf8', windowsHide: true }).trim()
  : path
const dir = mkdtempSync(join(tmpdir(), 'ci-psql-'))
const stub = join(dir, 'client with spaces.sh')
const wrapper = unix(fileURLToPath(new URL('../scripts/ci-psql.sh', import.meta.url)))
writeFileSync(stub, '#!/usr/bin/env bash\nprintf "%s\\0" "${LD_LIBRARY_PATH-unset}" "$@"\nexit "${CI_PSQL_STUB_EXIT:-0}"\n')
chmodSync(stub, 0o755)
const env = { ...process.env, LD_LIBRARY_PATH: '/isolated/server/lib', WORKHUB_CI_SYSTEM_PSQL: unix(stub) }
let count = 0
const check = (name, test) => { test(); count++; console.log('  ✓ ' + name) }
const run = (args, extra = {}) => spawnSync(bash, [wrapper, ...args], { env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true })
try {
  check('클라이언트에서만 서버 라이브러리를 제거하고 공백·SQL 인자를 그대로 넘긴다', () => {
    const args = ['-h', '/tmp/socket with spaces', '-p', '55447', '-c', 'SELECT 1;']
    const result = run(args)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.stdout.split('\0').slice(0, -1), ['unset', ...args])
    assert.equal(env.LD_LIBRARY_PATH, '/isolated/server/lib')
  })
  check('시스템 클라이언트 오류 종료를 성공으로 바꾸지 않는다', () => {
    assert.equal(run(['--version'], { CI_PSQL_STUB_EXIT: '7' }).status, 7)
  })
  check('명시한 클라이언트가 없으면 다른 버전을 임의 실행하지 않는다', () => {
    for (const value of ['', unix(join(dir, 'absent'))]) {
      const result = run([], { WORKHUB_CI_SYSTEM_PSQL: value })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /CI psql/)
    }
  })
  console.log(`전부 통과 (${count})`)
} finally { rmSync(dir, { recursive: true, force: true }) }
