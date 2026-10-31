import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  createSeasonalService,
  parseSeasonalStatus,
} from '../apps/main/src/site/seasonal-service.js'
const db = new PGlite()
let count = 0
async function check(name, action) {
  await action()
  count++
  console.log('  ✓ ' + name)
}
const admin = '00000000-0000-4000-8000-000000000001',
  teacher = '00000000-0000-4000-8000-000000000002',
  other = '00000000-0000-4000-8000-000000000003'
await db.exec(
  `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$; CREATE TABLE public.users(id text PRIMARY KEY,role text,is_active boolean); INSERT INTO public.users VALUES ('${admin}','superadmin',true),('${teacher}','teacher',true),('${other}','admin',true);`,
)
const uid = (id) => db.query("SELECT set_config('test.uid',$1,false)", [id])
const status = async () =>
  (await db.query('SELECT public.site_seasonal_status() AS value')).rows[0].value
const save = async (enabled, version, key) =>
  (
    await db.query('SELECT public.site_seasonal_set($1,$2,$3,$4) AS value', [
      'assessment-plan',
      enabled,
      version,
      key,
    ])
  ).rows[0].value
const key = '10000000-0000-4000-8000-000000000001'
try {
  await check('증분 설치는 기존 회원 자료와 함수를 변경하지 않는다', async () => {
    await db.exec(
      readFileSync(
        new URL('../database/site-presentation/sp1/SP1-01_기간업무_메뉴표시.sql', import.meta.url),
        'utf8',
      ),
    )
    assert.equal((await db.query('SELECT count(*) AS n FROM public.users')).rows[0].n, 3)
  })
  await check('승인 교사는 숨김 상태만 읽고 설정은 바꿀 수 없다', async () => {
    await uid(teacher)
    const s = await status()
    assert.equal(s.enabled, false)
    assert.equal(s.canManage, false)
    assert.equal(parseSeasonalStatus(s).version, 1)
    await assert.rejects(save(true, 1, key), /FORBIDDEN/)
  })
  await check('미로그인과 승인 취소 사용자의 조회를 거부한다', async () => {
    await uid('')
    await assert.rejects(status(), /FORBIDDEN/)
    await db.query('UPDATE public.users SET is_active=false WHERE id=$1', [teacher])
    await uid(teacher)
    await assert.rejects(status(), /FORBIDDEN/)
    await db.query('UPDATE public.users SET is_active=true WHERE id=$1', [teacher])
  })
  let receipt
  await check('관리자 표시 저장과 교사의 실제 조회가 같은 설정을 읽는다', async () => {
    await uid(admin)
    receipt = await save(true, 1, key)
    assert.equal(receipt.version, 2)
    await uid(teacher)
    assert.equal((await status()).enabled, true)
  })
  await check('응답 유실 후 같은 요청은 한 번만 적용된다', async () => {
    await uid(admin)
    assert.deepEqual(await save(true, 1, key), receipt)
    assert.equal((await status()).version, 2)
  })
  await check('같은 번호의 다른 내용과 오래된 판을 거부한다', async () => {
    await assert.rejects(save(false, 1, key), /IDEMPOTENCY_CONFLICT/)
    await uid(other)
    await assert.rejects(save(false, 1, key), /CONFLICT/)
  })
  await check('다른 관리자가 숨겨도 이전 접수증 재조회는 설정을 되돌리지 않는다', async () => {
    await save(false, 2, key)
    await uid(admin)
    assert.deepEqual(await save(true, 1, key), receipt)
    assert.equal((await status()).enabled, false)
    assert.equal((await status()).version, 3)
  })
  await check('권한 회수 후에는 자기 접수증도 관리 쓰기 함수에서 거부한다', async () => {
    await db.query('UPDATE public.users SET role=$1 WHERE id=$2', ['teacher', admin])
    await assert.rejects(save(true, 1, key), /FORBIDDEN/)
    await db.query('UPDATE public.users SET role=$1 WHERE id=$2', ['superadmin', admin])
  })
  await check('메뉴 설정 표와 접수 기록은 인증 역할이 직접 읽거나 쓰지 못한다', async () => {
    const grants = await db.query(
      "SELECT grantee FROM information_schema.table_privileges WHERE table_schema='site_presentation' AND grantee IN ('anon','authenticated','PUBLIC')",
    )
    assert.equal(grants.rows.length, 0)
    await db.exec('SET ROLE authenticated')
    await assert.rejects(
      db.query('SELECT * FROM site_presentation.seasonal_work'),
      /permission denied/,
    )
    await db.exec('RESET ROLE')
  })
  await check('가짜 기능·빈 판·빈 요청 번호를 거부한다', async () => {
    await uid(admin)
    await assert.rejects(save(true, null, key), /INVALID_INPUT/)
    await assert.rejects(save(true, 3, null), /INVALID_INPUT/)
    await assert.rejects(
      db.query("SELECT public.site_seasonal_set('other',true,3,$1)", [key]),
      /INVALID_INPUT/,
    )
  })
  await check('실제 SQL JSON을 전송 어댑터가 읽고 원 요청을 보존한다', async () => {
    const calls = []
    const service = createSeasonalService({
      rpc: async (name, args) => {
        calls.push({ name, args })
        return { data: await status() }
      },
    })
    assert.equal((await service.read()).enabled, false)
    await service.save({ enabled: true, version: 3, key })
    assert.deepEqual(calls[1].args, {
      p_feature: 'assessment-plan',
      p_enabled: true,
      p_expected_version: 3,
      p_request_key: key,
    })
  })
  await check('설정 미설치·통신 미상·잘못된 응답을 표시 완료로 바꾸지 않는다', async () => {
    await assert.rejects(
      createSeasonalService({ rpc: async () => ({ error: { code: 'PGRST202' } }) }).read(),
      (e) => e.code === 'NOT_INSTALLED',
    )
    await assert.rejects(
      createSeasonalService({ rpc: () => new Promise(() => {}) }, { timeoutMs: 5 }).save({
        enabled: true,
        version: 3,
        key,
      }),
    )
    for (const bad of [null, {}, { ...receipt, enabled: 'true' }, { ...receipt, version: 0 }])
      assert.throws(() => parseSeasonalStatus(bad))
  })
  await check('사후 점검과 익명 함수 실행 거부', async () => {
    const rows = (
      await db.query(
        readFileSync(
          new URL('../database/site-presentation/sp1/SP1-02_사후점검.sql', import.meta.url),
          'utf8',
        ),
      )
    ).rows
    assert.equal(rows.length, 7)
    assert.ok(
      rows.every((row) => ['ok', 'info'].includes(row.status)),
      JSON.stringify(rows),
    )
    await uid(teacher)
    await db.exec('SET ROLE authenticated')
    assert.equal((await status()).canManage, false)
    await assert.rejects(save(true, 3, key), /FORBIDDEN/)
    await db.exec('RESET ROLE')
    await db.exec('SET ROLE anon')
    await assert.rejects(status(), /permission denied/)
    await db.exec('RESET ROLE')
  })
  console.log(`전부 통과 (${count})`)
} finally {
  await db.close()
}
