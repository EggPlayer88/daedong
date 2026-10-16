// R1 원문은 보존하고, 한국/UTC 날짜가 다른 시점의 실제 정책 기간 제약을 재현한다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(join(ROOT, 'database/workhub/r1/R1-01_정책_파일_실행.sql'), 'utf8')
const constraint = sql.match(/^\s*(CONSTRAINT policy_versions_period_check CHECK .*),$/m)?.[1]
const runner = readFileSync(join(ROOT, 'scripts/verify-workhub-r2-sql.sh'), 'utf8')
const timezone = runner.match(/^step r1-full env PGOPTIONS='-c timezone=([A-Za-z_/]+)' bash /m)?.[1]
const db = new PGlite()
let failures = 0
async function check(name, run) {
  try { await run(); console.log('  ✓ ' + name) }
  catch (error) { failures++; console.log('  ✗ ' + name + ': ' + error.message) }
}

try {
  assert.ok(constraint, 'R1 실제 정책 기간 제약을 읽어야 한다.')
  await db.exec(`CREATE TABLE policy_period_probe(id integer PRIMARY KEY, effective_from date NOT NULL, effective_to date, ${constraint})`)
  async function seed(instant, zone) {
    await db.exec('TRUNCATE policy_period_probe')
    await db.query("SELECT set_config('TimeZone', $1, false)", [zone])
    // 원본 Python TODAY는 Asia/Seoul이다. 종료일은 원본 run_r1.py의 current_date와 같은 세션 날짜 변환이다.
    await db.query("INSERT INTO policy_period_probe VALUES (1, ($1::timestamptz AT TIME ZONE 'Asia/Seoul')::date - 1, NULL)", [instant])
  }
  async function end(instant) {
    return db.query('UPDATE policy_period_probe SET effective_to = $1::timestamptz::date WHERE id=1 RETURNING (effective_to-effective_from) AS days', [instant])
  }
  await check('한국 자정 이후 UTC 날짜로 정책을 닫으면 실제 R1 기간 제약이 거부', async () => {
    const instant = '2026-10-15T15:30:00Z'
    await seed(instant, 'UTC')
    await assert.rejects(() => end(instant), error => error.code === '23514' && error.constraint === 'policy_versions_period_check')
    const rows = (await db.query('SELECT effective_to IS NULL AS unchanged FROM policy_period_probe')).rows
    assert.equal(rows[0].unchanged, true)
  })
  await check('R1 자식 세션 시간대 설정으로 같은 시각 정책 교체가 1일 기간을 유지', async () => {
    assert.equal(timezone, 'Asia/Seoul', 'R1 전용 세션의 시간대 설정이 있어야 한다.')
    await seed('2026-10-15T15:30:00Z', timezone)
    assert.equal((await end('2026-10-15T15:30:00Z')).rows[0].days, 1)
  })
  await check('연도 경계에서도 한국 날짜와 R1 세션 날짜가 일치', async () => {
    await seed('2026-12-31T15:30:00Z', timezone)
    assert.equal((await end('2026-12-31T15:30:00Z')).rows[0].days, 1)
  })
  await check('한국과 UTC 날짜가 같은 낮 시간의 기존 시험도 그대로 유효', async () => {
    for (const zone of ['UTC', timezone]) {
      await seed('2026-10-16T03:30:00Z', zone)
      assert.equal((await end('2026-10-16T03:30:00Z')).rows[0].days, 1)
    }
  })
  await check('상속 PGOPTIONS 제거와 작업자 UTC 설정을 유지하고 R1에만 주입', async () => {
    assert.match(runner, /^unset .*\bPGOPTIONS$/m)
    assert.equal(runner.match(/PGOPTIONS=/g)?.length, 1)
    assert.match(runner, /^step r0-full bash /m)
    assert.match(runner, /^step worker-setup bash /m)
    assert.match(runner, /listen_addresses=127\.0\.0\.1 -c timezone=UTC/)
  })
} finally {
  await db.close()
}
if (failures) process.exitCode = 1
