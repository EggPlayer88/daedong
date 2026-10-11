// 일회용 로컬 PostgreSQL 전용 통합 시험. 운영 DB·실제 회원에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATABASE = 'workhub_contract_test'
const WAIT_MS = 7000
const fail = message => { const error = new Error(message); error.testMessage = message; throw error }

// pg의 connectionString 파서에 원문을 넘기지 않는다. 쿼리 인자에 의한 host/DB 재지정을 막는다.
export function testDatabaseConfig(env) {
  if (env.WORKHUB_TEST_ALLOW_FIXTURES !== '1') fail('안전 게이트: WORKHUB_TEST_ALLOW_FIXTURES=1이 필요합니다.')
  if (!env.WORKHUB_TEST_DATABASE_URL) fail('안전 게이트: WORKHUB_TEST_DATABASE_URL이 필요합니다.')
  let url
  try { url = new URL(env.WORKHUB_TEST_DATABASE_URL) } catch { fail('안전 게이트: 올바른 PostgreSQL 테스트 URL이 필요합니다.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) fail('안전 게이트: PostgreSQL URL의 쿼리·fragment는 허용하지 않습니다.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) fail('안전 게이트: loopback 호스트만 허용합니다.')
  if (url.pathname !== '/' + DATABASE) fail('안전 게이트: 전용 workhub_contract_test DB만 허용합니다.')
  if (!url.username) fail('안전 게이트: 테스트 DB 사용자 이름을 명시해야 합니다.')
  let user, password
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password) } catch { fail('안전 게이트: 테스트 URL 인코딩이 잘못되었습니다.') }
  const port = url.port ? Number(url.port) : 5432
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('안전 게이트: 올바른 테스트 포트가 필요합니다.')
  return {
    host: hostname === 'localhost' ? '127.0.0.1' : hostname,
    port, database: DATABASE, user, password, ssl: false,
    connectionTimeoutMillis: 5000,
    query_timeout: 20000,
    options: '-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000 -c search_path=public',
  }
}

function guardChecks() {
  const env = { WORKHUB_TEST_ALLOW_FIXTURES: '1', WORKHUB_TEST_DATABASE_URL: 'postgresql://fixture:synthetic@127.0.0.1:5432/' + DATABASE }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const config = testDatabaseConfig({ ...env, WORKHUB_TEST_DATABASE_URL: 'postgres://fixture@' + host + '/' + DATABASE })
    assert.equal(config.database, DATABASE)
    assert.ok(['127.0.0.1', '::1'].includes(config.host))
  }
  for (const unsafe of [
    {},
    { ...env, WORKHUB_TEST_ALLOW_FIXTURES: '0' },
    { ...env, WORKHUB_TEST_DATABASE_URL: '' },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'postgresql://fixture@db.example.invalid/' + DATABASE },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/postgres' },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/' + DATABASE + '?host=db.example.invalid' },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/' + DATABASE + '#other' },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'https://fixture@localhost/' + DATABASE },
    { ...env, WORKHUB_TEST_DATABASE_URL: 'postgresql://localhost/' + DATABASE },
  ]) assert.throws(() => testDatabaseConfig(unsafe), error => Boolean(error.testMessage))
  console.log('  ✓ DB 접속 안전 게이트 12조건: 허용 3·차단 9 (DB 접속 없음)')
}

async function run() {
  guardChecks()
  if (process.argv.includes('--check-guard')) return
  const config = testDatabaseConfig(process.env)
  const { Client } = await import('pg')
  const clients = new Set()
  let observer
  let fixtureStarted = false
  let passed = 0
  let stage = '테스트 전용 DB 연결'
  const open = async label => {
    const client = new Client({ ...config, application_name: 'workhub-contract-test/' + label })
    // 연결 종료 오류는 query/검증 결과로 보고한다. URL이나 비밀번호는 출력하지 않는다.
    client.on('error', () => {})
    clients.add(client)
    await client.connect()
    const info = (await client.query('SELECT pg_backend_pid() AS pid, current_database() AS db, current_setting(\'transaction_isolation\') AS isolation')).rows[0]
    assert.equal(info.db, DATABASE)
    // Docker 포트 전달에서는 서버 자신의 주소가 172.x일 수 있다. 접속 endpoint는 위 config에서 loopback으로 고정했다.
    assert.equal(info.isolation, 'read committed', '경합 계약은 READ COMMITTED에서 검증합니다.')
    client.testPid = info.pid
    return client
  }
  const close = async client => {
    if (!clients.has(client)) return
    try { await client.query('ROLLBACK') } catch { /* 중단·실패한 트랜잭션을 버린다. */ }
    try { await client.end() } finally { clients.delete(client) }
  }
  const withTwo = async (label, callback) => {
    const first = await open(label + '/first')
    let second
    try {
      second = await open(label + '/second')
      assert.notEqual(first.testPid, second.testPid, '서로 다른 PostgreSQL backend가 필요합니다.')
      assert.notEqual(first.testPid, observer.testPid)
      assert.notEqual(second.testPid, observer.testPid)
      await callback(first, second)
    } finally {
      // 첫 연결의 잠금을 먼저 풀면 둘째의 대기 query가 끝난 뒤 ROLLBACK할 수 있다.
      await close(first)
      if (second) await close(second)
    }
  }
  const value = async (sql, args = []) => (await observer.query(sql, args)).rows[0].value
  const begin = async (client, userId) => {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    if (userId) {
      await client.query('SET LOCAL ROLE authenticated')
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId])
    }
  }
  const save = (client, memberId, command) => client.query('SELECT public.workhub_calendar_save($1,$2::jsonb) AS value', [memberId, JSON.stringify(command)])
  const start = promise => {
    const pending = { settled: false, promise: undefined }
    pending.promise = promise.then(result => { pending.settled = true; return { ok: true, result } }, error => { pending.settled = true; return { ok: false, error } })
    return pending
  }
  const blockedBy = async (waiting, holding, pending, label, expectedEvent) => {
    const deadline = performance.now() + WAIT_MS
    while (performance.now() < deadline) {
      const row = (await observer.query('SELECT state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [waiting.testPid])).rows[0]
      if (row?.wait_event_type === 'Lock' && row.blockers.includes(holding.testPid) && (!expectedEvent || row.wait_event === expectedEvent)) {
        console.log('    잠금 대기 확인: ' + label + ' / ' + row.wait_event)
        return
      }
      if (pending.settled) fail(label + ': 예상한 잠금 대기 전에 요청이 종료되었습니다.')
      // 이 간격은 관측 query의 빈도 제한이다. 경과 시간으로 선후를 가정하지 않는다.
      await pollDelay(20)
    }
    fail(label + ': 제한 시간 내 지정 backend의 잠금 대기를 관측하지 못했습니다.')
  }
  const finish = async (client, pending, expectedError) => {
    const outcome = await pending.promise
    if (expectedError) {
      assert.equal(outcome.ok, false, '두 번째 요청은 ' + expectedError + '여야 합니다.')
      assert.equal(outcome.error.code, 'P0001')
      assert.equal(outcome.error.message, expectedError)
      await client.query('ROLLBACK')
      return outcome.error
    }
    if (!outcome.ok) fail('저장 성공이 필요한 요청 실패: SQLSTATE ' + (outcome.error.code || 'UNKNOWN'))
    await client.query('COMMIT')
    return outcome.result.rows[0].value
  }
  const counts = () => value("SELECT jsonb_build_object('events',(SELECT count(*) FROM public.workhub_calendar_events),'receipts',(SELECT count(*) FROM public.workhub_calendar_receipts),'audit',(SELECT count(*) FROM public.workhub_calendar_audit)) AS value")
  const delta = (before, after, expected) => {
    assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]])), expected)
  }
  const integrity = async () => {
    assert.equal(await value("SELECT count(*)::int AS value FROM public.workhub_calendar_receipts r JOIN public.workhub_calendar_events e ON e.id=r.event_id WHERE r.school_id<>e.school_id OR r.result->>'id'<>e.id OR r.result->>'schoolId'<>e.school_id OR NOT EXISTS (SELECT 1 FROM public.workhub_calendar_audit a WHERE a.event_id=r.event_id AND a.actor_member_id=r.member_id AND a.event_version=(r.result->>'version')::int)"), 0)
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_calendar_events e WHERE e.version<>(SELECT count(*) FROM public.workhub_calendar_audit a WHERE a.event_id=e.id) OR e.version<>(SELECT count(*) FROM public.workhub_calendar_receipts r WHERE r.event_id=e.id)'), 0)
    const total = await counts()
    assert.equal(total.receipts, total.audit)
  }
  const check = async (name, fn) => {
    stage = name
    await fn()
    await integrity()
    passed++
    console.log('  ✓ ' + name)
  }

  try {
    observer = await open('observer')
    stage = '빈 테스트 DB 및 전용 역할 확인'
    const safe = (await observer.query("SELECT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%') AS schemas, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS objects, (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions, (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('authenticated','anon')) AS roles")).rows[0]
    if (!safe.superuser || safe.schemas || safe.objects || safe.functions || safe.roles) fail('안전 게이트: 빈 전용 PostgreSQL 인스턴스와 테스트 관리자 역할이 필요합니다. 기존 DB는 초기화하지 않습니다.')
    console.log('  ✓ loopback·전용 DB명·빈 스키마·빈 테스트 역할 확인')
    stage = '합성 인프라와 원본 마이그레이션 적용'
    fixtureStarted = true
    await observer.query('BEGIN')
    await observer.query([
      'CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA storage;',
      "CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}'::jsonb);",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      'CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);',
      'CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;',
      "CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;",
      'GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;',
    ].join('\n'))
    for (const file of ['001_users_departments.sql', '002_schedules_tasks.sql', '003_signup_approval.sql', '004_doc_ai_conversations.sql', '005_doc_submissions.sql', '006_calendar.sql', '007_submission_delete.sql']) {
      await observer.query(readFileSync(join(ROOT, 'migrations', file), 'utf8'))
    }
    await observer.query('COMMIT')
    await observer.query(readFileSync(join(ROOT, 'database/workhub/001-calendar-foundation.proposed.sql'), 'utf8'))
    const ids = Object.fromEntries(['owner', 'manager', 'revoked', 'ended', 'overlap'].map((name, i) => [name, '10000000-0000-4000-8000-' + String(i + 1).padStart(12, '0')]))
    for (const [name, id] of Object.entries(ids)) await observer.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name',$3::text))", [id, name + '@example.invalid', '합성 ' + name])
    await observer.query("UPDATE public.users SET is_active=true,role='superadmin'")
    await observer.query("INSERT INTO public.workhub_schools(id,name) VALUES('race-school','합성 경합 학교')")
    for (const name of ['owner', 'manager', 'revoked', 'ended']) await observer.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,role,active,valid_from,valid_through) VALUES($1,'race-school',$2,$3,true,public.workhub_today()-1,public.workhub_today()+30)", [name, ids[name], name === 'manager' ? 'calendar_manager' : 'teacher'])
    const today = await value('SELECT public.workhub_today()::text AS value')
    const draft = title => ({ title, description: '', location: '', startDate: today, endDate: today, allDay: true, startTime: '', endTime: '', visibility: 'school', audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] } })
    console.log('  ✓ 원본 001~007 + 신축 제안 적용, 합성 회원만 생성, 기본 superadmin 게이트 유지')

    await check('같은 멱등 키·같은 입력: 동시 요청이 같은 결과 1건으로 합쳐짐', async () => {
      const before = await counts()
      await withTwo('same-key-same-input', async (first, second) => {
        const command = { idempotencyKey: 'same-input', draft: draft('합성 동일 요청') }
        await begin(first, ids.owner)
        const winner = (await save(first, 'owner', command)).rows[0].value
        await begin(second, ids.owner)
        const follower = start(save(second, 'owner', command))
        await blockedBy(second, first, follower, '동일 소속 직렬화')
        await first.query('COMMIT')
        assert.deepEqual(await finish(second, follower), winner)
      })
      delta(before, await counts(), { events: 1, receipts: 1, audit: 1 })
    })

    await check('같은 멱등 키·다른 입력: 첫 저장만 반영하고 둘째 입력 거부', async () => {
      const before = await counts()
      await withTwo('same-key-different-input', async (first, second) => {
        const command = { idempotencyKey: 'different-input', draft: draft('합성 최초 입력') }
        await begin(first, ids.owner)
        const winner = (await save(first, 'owner', command)).rows[0].value
        await begin(second, ids.owner)
        const follower = start(save(second, 'owner', { ...command, draft: draft('합성 충돌 입력') }))
        await blockedBy(second, first, follower, '같은 키의 다른 입력')
        await first.query('COMMIT')
        await finish(second, follower, 'IDEMPOTENCY_CONFLICT')
        assert.equal(await value("SELECT draft->>'title' AS value FROM public.workhub_calendar_events WHERE id=$1", [winner.id]), command.draft.title)
      })
      delta(before, await counts(), { events: 1, receipts: 1, audit: 1 })
    })

    await check('다른 소속의 같은 expectedVersion 수정: 하나만 성공하고 최신 원본 충돌 반환', async () => {
      await withTwo('different-member-version', async (first, second) => {
        await begin(first, ids.owner)
        const original = (await save(first, 'owner', { idempotencyKey: 'version-create', draft: draft('합성 원본') })).rows[0].value
        await first.query('COMMIT')
        const before = await counts()
        const command = { id: original.id, expectedVersion: 1, idempotencyKey: 'version-first', draft: draft('합성 승자 수정') }
        await begin(first, ids.owner)
        const winner = (await save(first, 'owner', command)).rows[0].value
        await begin(second, ids.manager)
        const follower = start(save(second, 'manager', { ...command, idempotencyKey: 'version-second', draft: draft('합성 늦은 수정') }))
        await blockedBy(second, first, follower, '다른 소속의 원본 행 수정')
        await first.query('COMMIT')
        const conflict = await finish(second, follower, 'CONFLICT')
        assert.deepEqual(JSON.parse(conflict.detail), winner)
        assert.equal(winner.version, 2)
        assert.equal(await value('SELECT version AS value FROM public.workhub_calendar_events WHERE id=$1', [original.id]), 2)
        delta(before, await counts(), { events: 0, receipts: 1, audit: 1 })
      })
    })

    await check('가입 승인 해제가 먼저 잠금을 잡으면 대기한 저장 거부', async () => {
      const before = await counts()
      await withTwo('approval-revoked-first', async (first, second) => {
        await begin(first)
        await first.query('UPDATE public.users SET is_active=false WHERE id=$1', [ids.revoked])
        await begin(second, ids.revoked)
        const follower = start(save(second, 'revoked', { idempotencyKey: 'revoked-save', draft: draft('합성 승인 철회') }))
        await blockedBy(second, first, follower, '회원 승인 행 잠금')
        await first.query('COMMIT')
        await finish(second, follower, 'FORBIDDEN')
      })
      delta(before, await counts(), { events: 0, receipts: 0, audit: 0 })
    })

    await check('소속 종료가 먼저 잠금을 잡으면 대기한 저장 거부', async () => {
      const before = await counts()
      await withTwo('membership-ended-first', async (first, second) => {
        await begin(first)
        await first.query("UPDATE public.workhub_memberships SET active=false WHERE id='ended'")
        await begin(second, ids.ended)
        const follower = start(save(second, 'ended', { idempotencyKey: 'ended-save', draft: draft('합성 소속 종료') }))
        await blockedBy(second, first, follower, '학교 소속 행 잠금')
        await first.query('COMMIT')
        await finish(second, follower, 'INACTIVE_MEMBERSHIP')
      })
      delta(before, await counts(), { events: 0, receipts: 0, audit: 0 })
    })

    await check('같은 학교·사용자 활성 기간 동시 INSERT: advisory 대기 후 중첩 거부', async () => {
      const before = await counts()
      await withTwo('overlap-insert', async (first, second) => {
        const insert = "INSERT INTO public.workhub_memberships(id,school_id,user_id,active,valid_from,valid_through) VALUES($1,'race-school',$2,true,public.workhub_today()+$3::int,public.workhub_today()+$4::int)"
        await begin(first)
        await first.query(insert, ['overlap-first', ids.overlap, 1, 20])
        await begin(second)
        const follower = start(second.query(insert, ['overlap-second', ids.overlap, 10, 30]))
        await blockedBy(second, first, follower, '동일 학교·계정 기간 중첩', 'advisory')
        await first.query('COMMIT')
        await finish(second, follower, 'OVERLAPPING_MEMBERSHIP')
        assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_memberships WHERE user_id=$1 AND active', [ids.overlap]), 1)
      })
      delta(before, await counts(), { events: 0, receipts: 0, audit: 0 })
    })
    console.log('\nPostgreSQL 독립 연결 경쟁 검증 ' + passed + '개 통과. receipt·audit 일관성 매번 확인.')
  } catch (error) {
    console.error('  ✗ 단계: ' + stage)
    if (error.testMessage) console.error(error.testMessage)
    else if (error instanceof assert.AssertionError) console.error(error.message)
    else console.error('SQL/연결 오류 코드: ' + (error.code || 'UNKNOWN') + ' (접속 정보·원문 오류는 출력하지 않음)')
    process.exitCode = 1
  } finally {
    // DB 자체를 DROP/초기화하지 않는다. 완료·실패한 fixture는 CI의 일회용 서비스가 정리한다.
    for (const client of [...clients].filter(client => client !== observer)) await close(client)
    if (observer) await close(observer)
    if (fixtureStarted) console.log('테스트 연결 종료. 합성 fixture는 이 전용 인스턴스에 남으며, 재실행에는 새 빈 인스턴스가 필요합니다.')
  }
}

run().catch(error => {
  console.error(error.testMessage || '테스트 시작 실패. 전용 환경변수와 pg 설치 상태를 확인해 주세요.')
  process.exitCode = 1
})
