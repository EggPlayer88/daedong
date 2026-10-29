// 격리 PostgreSQL 엔진에서만 실행한다. 실제 시험/운영 DB 연결 정보는 읽지 않는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = name => readFileSync(new URL('../sandbox/school-year/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const patch = read('SB-03_시계조작_WHERE_보강.sql')
const signature = 'public.workhub_sandbox_clock_control(text,integer,text,timestamp with time zone)'
const definition = async () => (await db.query('select pg_get_functiondef($1::regprocedure) as value', [signature])).rows[0].value
const snapshot = async () => (await db.query(`select jsonb_build_array(
 (select jsonb_agg(t) from sandbox_private.clock_state t),
 (select jsonb_agg(t) from sandbox_private.clock_segments t),
 (select jsonb_agg(t) from sandbox_private.clock_commands t),
 (select jsonb_agg(t) from sandbox_private.ai_limit t),
 (select jsonb_agg(t) from sandbox_private.ai_charges t)) as value`)).rows[0].value
const check = async (name, run) => { await run(); console.log('  ✓ ' + name) }
const rejected = async (sql, message) => { await assert.rejects(() => db.exec(sql), e => e.message.includes(message)); await db.exec('ROLLBACK') }
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema workhub;create schema sandbox_private;
 create table auth.users(id uuid primary key);
 create table public.users(id text primary key,is_active boolean);
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create table workhub.ai_gateway_requests(id text,state text,actor_user_id uuid,reserved_micro_usd bigint);
 create table sandbox_private.environment(singleton boolean primary key,project_ref text,run_id text);
 insert into sandbox_private.environment values(true,'vfnemvoszjglfblsrzoh','daedong-year-20261028');
 insert into auth.users values(auth.uid());insert into public.users values(auth.uid()::text,true);`)
 await db.exec(read('SB-01_시험시계_누적예산.sql'))
 await db.exec(`insert into sandbox_private.cohort(user_id,teacher_id,purpose) values(auth.uid(),'T09','administrator_teacher');
 create schema unrelated;
 create function unrelated.workhub_sandbox_clock_control() returns text language sql as $$select 'preserved'::text$$;`)
 const original = await definition(), before = await snapshot()
 const metadata = async () => (await db.query('select proowner,proacl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0]
 const beforeMetadata = await metadata()
 await check('기존 원문에서 WHERE 누락을 확인하고 SB-03으로 한 곳만 바꾼다', async () => {
  assert.match(original, /SET revision=revision\+1 RETURNING/)
  await db.exec(patch)
  assert.equal(await definition(), original.replace('SET revision=revision+1 RETURNING', 'SET revision=revision+1 WHERE singleton RETURNING'))
 })
 await check('설치와 재실행이 시계·원 요청·비용·권한을 변경하지 않는다', async () => {
  assert.deepEqual(await snapshot(), before); assert.deepEqual(await metadata(), beforeMetadata)
  await db.exec(patch); assert.deepEqual(await snapshot(), before)
  assert.equal((await db.query('select unrelated.workhub_sandbox_clock_control() as value')).rows[0].value, 'preserved')
 })
 const advance = `select public.workhub_sandbox_clock_control('advance',1,'clock-test-one','2027-04-01T00:00:00+09:00') as value`
 await check('날짜 진행과 같은 요청 번호 재확인이 한 번만 시계를 바꾼다', async () => {
  const first = (await db.query(advance)).rows[0].value
  assert.equal(first.revision, 2); assert.equal(Date.parse(first.virtualNow), Date.parse('2027-04-01T00:00:00+09:00'))
  assert.deepEqual((await db.query(advance)).rows[0].value, first)
  assert.equal((await db.query('select count(*)::int as n from sandbox_private.clock_segments')).rows[0].n, 2)
 })
 await check('같은 번호의 다른 명령·낡은 판·역행 날짜를 계속 거부한다', async () => {
  for (const [sql, message] of [
   [advance.replace("'advance'", "'pause'"), 'IDEMPOTENCY_CONFLICT'],
   [advance.replace('clock-test-one', 'clock-test-two'), 'CONFLICT'],
   [advance.replace("'advance',1", "'advance',2").replace('clock-test-one', 'clock-test-three').replace('2027-04-01', '2027-03-01'), 'INVALID_INPUT']
  ]) await assert.rejects(() => db.query(sql), e => e.message.includes(message))
 })
 await check('시작·일시정지도 단일 행을 갱신하고 이력을 보존한다', async () => {
  await db.query("select public.workhub_sandbox_clock_control('resume',2,'clock-test-resume',null)")
  await db.query("select public.workhub_sandbox_clock_control('pause',3,'clock-test-pause',null)")
  assert.equal((await db.query('select revision from sandbox_private.clock_state')).rows[0].revision, 4)
 })
 await check('실행 중 시험에 다시 설치해도 진행 날짜·명령·예산을 보존한다', async () => {
  const current = await snapshot(); await db.exec(patch); assert.deepEqual(await snapshot(), current)
 })
 await check('다른 프로젝트에서는 적용을 거부한다', async () => {
  await db.exec("update sandbox_private.environment set project_ref='other' where singleton")
  await rejected(patch, 'SANDBOX_ONLY')
  await db.exec("update sandbox_private.environment set project_ref='vfnemvoszjglfblsrzoh' where singleton")
 })
 await check('WHERE가 있어도 다른 원문 변경은 이미 적용됨으로 통과시키지 않는다', async () => {
  await db.exec((await definition()).replace("RAISE EXCEPTION 'FORBIDDEN'", "RAISE EXCEPTION 'CHANGED'"))
  await rejected(patch, 'SANDBOX_CLOCK_SOURCE_CHANGED')
 })
 await check('새 복제 설치기는 SB-01→02→03 순서를 포함한다', async () => {
  const installer = readFileSync(new URL('../scripts/school-sandbox/overrides.mjs', import.meta.url), 'utf8')
  assert(installer.indexOf('SB-01_') < installer.indexOf('SB-02_'))
  assert(installer.indexOf('SB-02_') < installer.indexOf('SB-03_'))
 })
} finally { await db.close() }
