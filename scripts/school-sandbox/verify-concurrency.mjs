import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'

// 아직 유료 호출을 켜지 않은 복제 DB에서만 실행한다. 공급자는 호출하지 않는다.
const config=loadSecrets(process.argv[2]),people=JSON.parse(readFileSync(join(dirname(process.argv[2]),'accounts.json')))
const a=await connectSandbox(config),b=await connectSandbox(config),probe='sandbox-concurrency-verification'
let changed=false
try{
 await assertMarker(a);await assertMarker(b)
 const before=(await a.query('select enabled,burned_micro_usd from sandbox_private.ai_limit')).rows[0]
 assert.equal(before.enabled,false);assert.equal(Number(before.burned_micro_usd),0)
 assert.equal(Number((await a.query('select count(*) n from workhub.ai_gateway_requests')).rows[0].n),0)
 for(const c of[a,b])await c.query('create temporary table budget_probe(id text,state text,actor_user_id uuid,reserved_micro_usd bigint);create trigger budget_probe_guard before insert or update on budget_probe for each row execute function sandbox_private.charge_ai()')
 await a.query('update sandbox_private.ai_limit set enabled=true,burned_micro_usd=8960000');changed=true
 await a.query('begin');await a.query("insert into budget_probe values($1,'started',$2,10000)",[probe+'-a',people[0].userId])
 // b는 같은 누적 예산 행 잠금에서 기다려야 한다. a 확정 후 남은 금액으로 다시 판정한다.
 const second=b.query("insert into budget_probe values($1,'started',$2,10000)",[probe+'-b',people[1].userId]).then(()=>({ok:true}),error=>({error:error.message}))
 await a.query('commit');const result=await second;assert.equal(result.error,'BUDGET_EXCEEDED')
 assert.equal(Number((await a.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd),9000000)
 console.log('동시 두 계정: 1건만 접수, 다른 1건은 9달러 한도로 차단')
}finally{
 if(changed){
  await a.query('rollback');await a.query('begin')
  // 시험용 접수만 지운다. 실제 호출이 하나라도 생겼으면 금액을 돌리지 않는다.
  assert.equal(Number((await a.query('select count(*) n from workhub.ai_gateway_requests')).rows[0].n),0)
  await a.query('delete from sandbox_private.ai_charges where request_id in($1,$2)',[probe+'-a',probe+'-b'])
  assert.equal(Number((await a.query('select count(*) n from sandbox_private.ai_charges')).rows[0].n),0)
  await a.query('update sandbox_private.ai_limit set enabled=false,burned_micro_usd=0');await a.query('commit')
 }
 await a.end();await b.end()
}
