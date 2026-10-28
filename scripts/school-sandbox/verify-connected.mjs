import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'

// 서버 연결 뒤의 점검. 실제 누적 차감액은 초기화하지 않으며 경계 시험은 롤백한다.
const path=process.argv[2],directory=dirname(path),people=JSON.parse(readFileSync(join(directory,'accounts.json')))
const c=await connectSandbox(loadSecrets(path)),results=[]
const pass=label=>{results.push({label,status:'PASS'});console.log('  ✓ '+label)}
try{await assertMarker(c)
 const status=(await c.query(`select
  (select count(*) from auth.users)::int users,
  (select count(*) from public.users where role='superadmin')::int administrators,
  (select count(*) from workhub.memberships where status='active')::int members,
  (select count(*) from workhub.year_classes)::int classes,
  (select count(*) from workhub.students)::int students,
  (select count(*) from storage.buckets where public)::int public_buckets,
  (select count(*) from workhub.ai_credentials)::int credentials`)).rows[0]
 assert.deepEqual(Object.values(status),[22,1,22,9,270,0,1]);pass('가명 22명·관리자 1명·9학급·270명·private 저장소·전용 키 1개')
 for(const row of(await c.query('select * from sandbox_private.overrides')).rows){
  const source=(await c.query('select pg_get_functiondef($1::regprocedure) source',[row.signature])).rows[0].source
  assert.equal(createHash('sha256').update(source).digest('hex'),row.after_sha256,row.signature)
 }
 pass('복제 전용 시계·권한 변경의 적용 지문 일치')
 const clock=(await c.query('select * from sandbox_private.clock_segments order by revision desc limit 1')).rows[0]
 assert.equal(clock.running,false);assert.equal(clock.virtual_at.toISOString(),'2027-02-28T15:00:00.000Z');pass('Claude가 시작하기 전 3월 1일 일시정지 유지')
 const budget=(await c.query('select * from sandbox_private.ai_limit')).rows[0]
 assert.equal(budget.enabled,true);assert.equal(Number(budget.cap_micro_usd),9000000)
 assert.equal(Number((await c.query('select coalesce(sum(ceiling_micro_usd),0) value from sandbox_private.ai_charges')).rows[0].value),Number(budget.burned_micro_usd))
 const ai=(await c.query(`select count(*) filter(where state='completed')::int completed,
  count(*) filter(where state in('prepared','started','provider_unknown'))::int unresolved,
  coalesce(sum(actual_micro_usd),0)::bigint actual from workhub.ai_gateway_requests`)).rows[0]
 assert.ok(ai.completed>=1);assert.equal(ai.unresolved,0);assert.ok(Number(ai.actual)<=Number(budget.burned_micro_usd));pass('실제 Haiku 완료·미완료 0·정산액이 누적 상한 차감 이내')
 await c.query('begin')
 try{
  await c.query('create temporary table budget_probe(id text,state text,actor_user_id uuid,reserved_micro_usd bigint);create trigger probe before insert or update on budget_probe for each row execute function sandbox_private.charge_ai()')
  await c.query('update sandbox_private.ai_limit set burned_micro_usd=8960000 where singleton')
  await c.query("insert into budget_probe values('connected-check-at-cap','started',$1,10000)",[people[0].userId])
  assert.equal(Number((await c.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd),9000000)
  await c.query('savepoint exceed')
  await assert.rejects(()=>c.query("insert into budget_probe values('connected-check-over-cap','started',$1,10000)",[people[1].userId]),/BUDGET_EXCEEDED/)
  await c.query('rollback to savepoint exceed')
  await c.query("update budget_probe set state='failed' where id='connected-check-at-cap'")
  assert.equal(Number((await c.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd),9000000)
 }finally{await c.query('rollback')}
 assert.equal((await c.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd,budget.burned_micro_usd)
 pass('보완한 누적 예산 함수의 9달러 도달·초과 거절·미환급 및 실제 사용액 보존')
 writeFileSync(join(directory,'connected-verification.json'),JSON.stringify({at:new Date().toISOString(),status,ai,limitMicroUsd:9000000,burnedMicroUsd:Number(budget.burned_micro_usd),results},null,2))
}finally{await c.end()}
