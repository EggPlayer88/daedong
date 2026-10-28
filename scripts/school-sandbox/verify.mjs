import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker,SANDBOX_REF} from './environment.mjs'
const config=loadSecrets(process.argv[2]),directory=dirname(process.argv[2]),people=JSON.parse(readFileSync(join(directory,'accounts.json'))),school=JSON.parse(readFileSync(join(directory,'school.json')))
const c=await connectSandbox(config),results=[]
const record=(label)=>{results.push({label,result:'PASS'});console.log('  ✓ '+label)}
const admin=people.find(p=>p.role==='administrator_teacher'),ordinary=people.find(p=>p.role==='teacher')
try{await assertMarker(c)
 const counts=(await c.query("select (select count(*) from auth.users) users,(select count(*) from public.users where role='superadmin') admins,(select count(*) from workhub.memberships where status='active') members,(select count(*) from workhub.year_classes) classes,(select count(*) from workhub.students) students,(select count(*) from storage.buckets where public) public_buckets")).rows[0]
 assert.deepEqual(Object.values(counts).map(Number),[22,1,22,9,270,0]);record('22명·관리자 1명·9학급·가명 학생 270명·공개 버킷 0')
 for(const person of people){
  const response=await fetch(`https://${SANDBOX_REF}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.anonKey,'content-type':'application/json'},body:JSON.stringify({email:person.email,password:person.password})})
  assert.equal(response.status,200,person.teacherId+' 로그인');const auth=await response.json();assert.equal(auth.user.id,person.userId)
  const status=await fetch(`https://${SANDBOX_REF}.supabase.co/rest/v1/rpc/workhub_sandbox_status`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${auth.access_token}`,'content-type':'application/json'},body:'{}'})
  assert.equal(status.status,200,person.teacherId+' 시험 시계');const body=await status.json();assert.equal(body.canControl,person.role==='administrator_teacher');assert.equal(body.running,false);assert.equal(body.segments.length,1)
 }
 record('22개 임시 계정 실제 Auth 로그인·PostgREST 시험 시계·권한 확인')
 const anonymous=await fetch(`https://${SANDBOX_REF}.supabase.co/rest/v1/rpc/workhub_sandbox_status`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${config.anonKey}`,'content-type':'application/json'},body:'{}'});assert.ok([401,403].includes(anonymous.status));record('비로그인 시험 시계 접근 거부')
 await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.userId]);
 const initial=(await c.query('select public.workhub_sandbox_status() v')).rows[0].v
 const resumed=(await c.query("select public.workhub_sandbox_clock_control('resume',1,'verify-clock-resume') v")).rows[0].v;assert.equal(resumed.running,true)
 const duplicate=(await c.query("select public.workhub_sandbox_clock_control('resume',1,'verify-clock-resume') v")).rows[0].v;assert.deepEqual(duplicate,resumed)
 await c.query("update sandbox_private.clock_segments set real_at=clock_timestamp()-interval '1 hour' where revision=2")
 assert.equal((await c.query('select sandbox_private.domain_now()=end_at done from sandbox_private.clock_state')).rows[0].done,true)
 await c.query('rollback');record('실제 PostgreSQL: 1시간→학년도 종료·원요청 복구·최종 일시정지 보존')
 await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[ordinary.userId]);
 await assert.rejects(()=>c.query("select public.workhub_sandbox_clock_control('resume',1,'verify-denied-resume')"),/FORBIDDEN/);await c.query('rollback');record('일반 교사는 가속 시계 제어 불가')
 await c.query('begin');await c.query("update sandbox_private.cohort set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[ordinary.userId]);await c.query("select set_config('request.jwt.claim.sub',$1,true)",[ordinary.userId]);await assert.rejects(()=>c.query('select public.workhub_sandbox_status()'),/FORBIDDEN/);await c.query('rollback');record('시험 계정 유효기간은 가상 시간이 아닌 실제 시계로 만료')
 // 공급자 호출 없이 실제 DB 트리거를 시험한다. 시험 변경은 전부 롤백한다.
 await c.query('begin');await c.query('create temporary table budget_probe(id text,state text,actor_user_id uuid,reserved_micro_usd bigint);create trigger budget_probe_guard before insert or update on budget_probe for each row execute function sandbox_private.charge_ai()')
 await c.query('savepoint disabled');await assert.rejects(()=>c.query("insert into budget_probe values('verify-disabled','started',$1,10000)",[admin.userId]),/NOT_READY/);await c.query('rollback to savepoint disabled')
 await c.query('update sandbox_private.ai_limit set enabled=true,burned_micro_usd=8960000')
 await c.query("insert into budget_probe values('verify-at-cap','started',$1,10000)",[admin.userId]);assert.equal(Number((await c.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd),9000000)
 await c.query('savepoint exceeded');await assert.rejects(()=>c.query("insert into budget_probe values('verify-over-cap','started',$1,10000)",[ordinary.userId]),/BUDGET_EXCEEDED/);await c.query('rollback to savepoint exceeded')
 await c.query("update budget_probe set state='failed' where id='verify-at-cap'");assert.equal(Number((await c.query('select burned_micro_usd from sandbox_private.ai_limit')).rows[0].burned_micro_usd),9000000)
 await c.query('savepoint repeat');await assert.rejects(()=>c.query("update budget_probe set state='started' where id='verify-at-cap'"),/CONFLICT/);await c.query('rollback to savepoint repeat')
 await c.query('rollback');record('AI 실제 DB 트리거: 꺼짐 차단·9달러 초과 차단·다른 교사 합산·실패 후 미환급·재시작 차단')
 const final=(await c.query('select * from sandbox_private.ai_limit')).rows[0];assert.equal(final.enabled,false);assert.equal(Number(final.burned_micro_usd),0);record('검증 후 유료 AI 잠금·사용액 0·시계 일시정지 유지')
 writeFileSync(join(directory,'verification.json'),JSON.stringify({at:new Date().toISOString(),projectRef:SANDBOX_REF,results},null,2),{mode:0o600})
}finally{await c.end()}
