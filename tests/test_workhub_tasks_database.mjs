// 개인 업무 SQL·RLS·RPC 계약을 임시 PGlite에서 실행한다. 운영 DB 연결은 없다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { buildSync } from 'esbuild'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new PGlite()
let failures=0, checks=0
const ck=async(name,fn)=>{checks++;try{await fn();console.log('  ✓ '+name)}catch(error){failures++;console.log('  ✗ '+name+': '+error.message)}}
const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value
const call=(name,args=[])=>value('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)
const rejected=(fn,message)=>assert.rejects(fn,error=>error.code==='P0001'&&error.message===message)
const ids=Object.fromEntries(['owner','manager','teacher','other','pending'].map((name,i)=>[name,'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]))
async function asUser(name,fn,role='authenticated'){
  await db.exec('SET ROLE '+role)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[ids[name]??''])
  try{return await fn()}finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)")}
}
const allRows=()=>value("SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.workhub_personal_tasks t),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY school_id,member_id,request_key) FROM public.workhub_task_receipts r),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.workhub_task_audit a)) AS value")
const counts=()=>value("SELECT jsonb_build_object('tasks',(SELECT count(*) FROM public.workhub_personal_tasks),'receipts',(SELECT count(*) FROM public.workhub_task_receipts),'audit',(SELECT count(*) FROM public.workhub_task_audit)) AS value")
try{
  await db.exec([
    'CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA storage;',
    "CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}'::jsonb);",
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
    'CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);',
    'CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;',
    "CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;",
    'GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;'
  ].join('\n'))
  for(const file of ['001_users_departments.sql','002_schedules_tasks.sql','003_signup_approval.sql','004_doc_ai_conversations.sql','005_doc_submissions.sql','006_calendar.sql','007_submission_delete.sql'])await db.exec(readFileSync(join(ROOT,'migrations',file),'utf8'))
  await db.exec(readFileSync(join(ROOT,'database/workhub/001-calendar-foundation.proposed.sql'),'utf8'))
  for(const [name,id]of Object.entries(ids))await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name',$3::text))",[id,name+'@example.invalid','합성 '+name])
  await db.exec("UPDATE public.users SET is_active=true,role=CASE WHEN email='owner@example.invalid' THEN 'superadmin' WHEN email='manager@example.invalid' THEN 'admin' ELSE 'teacher' END WHERE email<>'pending@example.invalid'")
  const baselineUsers=await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u')
  const baselineFunctions=await value("SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'body',pg_get_functiondef(p.oid),'grants',p.proacl) ORDER BY p.oid) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")
  const baselinePolicies=await value("SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) AS value FROM pg_policies p WHERE schemaname='public'")
  await db.exec(readFileSync(join(ROOT,'database/workhub/004-personal-tasks.proposed.sql'),'utf8'))
  await ck('개인 업무 SQL은 기존 회원·함수·권한·RLS를 변경하지 않음',async()=>{
    assert.deepEqual(await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u'),baselineUsers)
    assert.deepEqual(await value("SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'body',pg_get_functiondef(p.oid),'grants',p.proacl) ORDER BY p.oid) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname NOT LIKE 'workhub_task_%'"),baselineFunctions)
    assert.deepEqual(await value("SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) AS value FROM pg_policies p WHERE schemaname='public' AND tablename NOT IN ('workhub_personal_tasks','workhub_task_receipts','workhub_task_audit')"),baselinePolicies)
  })
  await db.exec("INSERT INTO public.workhub_schools(id,name) VALUES('A','합성 A학교'),('B','합성 B학교')")
  for(const [name,id]of Object.entries(ids))await db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,role,active,valid_from,valid_through) VALUES($1,$2,$3,$4,true,public.workhub_today()-1,public.workhub_today()+30)",[name,name==='other'?'B':'A',id,name==='manager'?'calendar_manager':'teacher'])
  await db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,active,valid_from,valid_through) VALUES('owner-B','B',$1,true,public.workhub_today()-1,public.workhub_today()+30)",[ids.owner])
  const input={title:'합성 개인 업무',notes:'',dueDate:''}
  const create={kind:'create',input}
  const mutate=(user,member,command,key)=>asUser(user,()=>call('workhub_task_mutate',[member,command,key]))
  const own=(command,key)=>mutate('owner','owner',command,key)
  const get=(user,member,id)=>asUser(user,()=>call('workhub_task_get',[member,id]))
  await ck('기본 공개 게이트는 기존 승인 superadmin만 허용',async()=>{
    assert.deepEqual(await asUser('owner',()=>call('workhub_task_list',['owner'])),[])
    await rejected(()=>asUser('teacher',()=>call('workhub_task_list',['teacher'])),'FORBIDDEN')
    await rejected(()=>mutate('manager','manager',create,'restricted'),'FORBIDDEN')
  })
  await ck('익명 RPC·비공개 helper 실행 차단',async()=>{
    for(const [name,args]of [['workhub_task_list',['owner']],['workhub_task_get',['owner','x']],['workhub_task_mutate',['owner',create,'x']],['workhub_task_visible',['x']]])await assert.rejects(()=>asUser('',()=>call(name,args),'anon'),/permission denied/)
    for(const [name,args]of [['workhub_task_input',[input]],['workhub_task_trim',['x']]])await assert.rejects(()=>asUser('owner',()=>call(name,args)),/permission denied/)
  })
  let task
  await ck('개인 업무·멱등 receipt·감사 기록을 원자적으로 생성',async()=>{
    task=await own(create,'create')
    assert.deepEqual(task,{...input,id:task.id,schoolId:'A',ownerMemberId:'owner',status:'todo',version:1})
    assert.deepEqual(await counts(),{tasks:1,receipts:1,audit:1})
    assert.deepEqual(await get('owner','owner',task.id),task)
  })
  await ck('공백 정규화는 JS trim과 동일하고 기한 없음은 빈 문자열',async()=>{
    const space='\t\r\n\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
    const result=await own({kind:'create',input:{title:space+'제목'+space,notes:space+'메모'+space,dueDate:''}},'whitespace')
    assert.equal(result.title,'제목');assert.equal(result.notes,'메모');assert.equal(result.dueDate,'')
    await rejected(()=>own({kind:'create',input:{...input,title:space}},'blank-title'),'INVALID_INPUT')
  })
  await ck('Unicode 코드포인트 한도 120·2000 및 초과 거부',async()=>{
    const result=await own({kind:'create',input:{title:'😀'.repeat(120),notes:'😀'.repeat(2000),dueDate:'2028-02-29'}},'unicode')
    assert.equal(Array.from(result.title).length,120);assert.equal(Array.from(result.notes).length,2000)
    for(const bad of [{...input,title:'😀'.repeat(121)},{...input,notes:'😀'.repeat(2001)},{...input,title:' '+ 'x'.repeat(120)}])await rejected(()=>own({kind:'create',input:bad},'overlong'),'INVALID_INPUT')
  })
  await ck('잘못된 명령·타입·추가 필드·소유자 덮어쓰기 입력 거부',async()=>{
    for(const command of [null,[],{},true,{kind:null},{kind:'delete'},{kind:'create',input:null},{kind:'create',input:[]},{kind:'create',input:{...input,notes:null}},{kind:'create',input:{...input,title:4}},{kind:'create',input:{title:'누락'}},{kind:'create',input:{...input,ownerMemberId:'manager'}},{...create,schoolId:'B'},{...create,status:'done'},{kind:'update',taskId:task.id,input,expectedVersion:0},{kind:'update',taskId:task.id,input,expectedVersion:'1'},{kind:'update',taskId:task.id,input,expectedVersion:1.2},{kind:'update',taskId:[],input,expectedVersion:1},{kind:'status',taskId:task.id,status:'unknown',expectedVersion:1},{kind:'status',taskId:task.id,status:null,expectedVersion:1},{kind:'status',taskId:task.id,status:'done',expectedVersion:1,input}]){
      await rejected(()=>own(command,'invalid-command'),'INVALID_INPUT')
    }
  })
  await ck('실재하지 않는 날짜·비정규 날짜·누락 날짜 거부',async()=>{
    for(const dueDate of ['2026-02-29','2028-02-30','2026-13-01','2026-1-01',' 2026-01-01','0000-01-01','infinity',null,42])await rejected(()=>own({kind:'create',input:{...input,dueDate}},'bad-date'),'INVALID_INPUT')
  })
  await ck('빈 요청 키·공백 요청 키·한도 초과 거부',async()=>{
    for(const key of [null,'','\t \n','x'.repeat(201)])await rejected(()=>own(create,key),'INVALID_INPUT')
  })
  await ck('원래 요청 키의 앞뒤 공백을 자동 변경하지 않음',async()=>{
    const a=await own(create,' key '),b=await own(create,'key')
    assert.notEqual(a.id,b.id)
  })
  let current
  await ck('본인 내용 수정은 기한과 메모를 변경하고 버전을 올림',async()=>{
    current=await own({kind:'update',taskId:task.id,input:{title:'수정한 제목',notes:'추가 메모',dueDate:'2026-12-01'},expectedVersion:1},'update')
    assert.equal(current.status,'todo');assert.equal(current.version,2);assert.equal(current.dueDate,'2026-12-01')
  })
  await ck('상태 5종 전환과 같은 상태의 새 요청은 각각 새 버전',async()=>{
    for(const status of ['doing','waiting','done','cancelled','todo','todo']){
      const prior=current
      current=await own({kind:'status',taskId:task.id,status,expectedVersion:current.version},'status-'+(current.version+1))
      assert.equal(current.status,status);assert.equal(current.version,prior.version+1)
      assert.equal(current.title,prior.title);assert.equal(current.notes,prior.notes);assert.equal(current.dueDate,prior.dueDate)
    }
  })
  await ck('낡은 버전은 최신 PersonalTask를 충돌 상세에 반환',async()=>{
    await assert.rejects(()=>own({kind:'status',taskId:task.id,status:'done',expectedVersion:1},'stale'),error=>{
      assert.equal(error.code,'P0001');assert.equal(error.message,'CONFLICT');assert.deepEqual(JSON.parse(error.detail),current);return true
    })
  })
  await ck('같은 정규화 명령 재시도는 최초 결과·감사 중복 없음',async()=>{
    const before=await counts()
    assert.deepEqual(await own({kind:'create',input:{...input,title:' '+input.title+' '}},'create'),task)
    assert.deepEqual(await counts(),before)
    assert.deepEqual(await get('owner','owner',task.id),current)
  })
  await ck('같은 키에 다른 내용·다른 명령이면 멱등 충돌',async()=>{
    await rejected(()=>own({kind:'create',input:{...input,title:'다른 제목'}},'create'),'IDEMPOTENCY_CONFLICT')
    await rejected(()=>own({kind:'status',taskId:task.id,status:'done',expectedVersion:current.version},'create'),'IDEMPOTENCY_CONFLICT')
  })
  // members 확대는 합성 DB에서 권한 부정시험을 위한 조건이며 운영 설정 변경이 아니다.
  await db.exec("UPDATE public.workhub_settings SET rollout_mode='members'")
  await ck('다른 교사·학교 관리자도 타인 업무 조회·수정·상태 변경 불가',async()=>{
    for(const user of ['teacher','manager','other']){
      await rejected(()=>get(user,user,task.id),'NOT_FOUND')
      await rejected(()=>mutate(user,user,{kind:'update',taskId:task.id,input,expectedVersion:current.version},'foreign-update'),'NOT_FOUND')
      await rejected(()=>mutate(user,user,{kind:'status',taskId:task.id,status:'done',expectedVersion:current.version},'foreign-status'),'NOT_FOUND')
      assert.deepEqual(await asUser(user,()=>call('workhub_task_list',[user])),[])
    }
  })
  await ck('타인 소속 ID를 보내는 위장은 소속 게이트에서 거부',async()=>{
    await rejected(()=>get('manager','owner',task.id),'INACTIVE_MEMBERSHIP')
    await rejected(()=>mutate('manager','owner',create,'impersonate'),'INACTIVE_MEMBERSHIP')
  })
  await ck('같은 계정의 다른 학교 소속도 원래 학교 업무를 가져올 수 없음',async()=>{
    await rejected(()=>get('owner','owner-B',task.id),'NOT_FOUND')
    await rejected(()=>mutate('owner','owner-B',{kind:'status',taskId:task.id,status:'done',expectedVersion:current.version},'cross-member'),'NOT_FOUND')
    const ownB=await mutate('owner','owner-B',create,'create')
    assert.equal(ownB.schoolId,'B');assert.equal(ownB.ownerMemberId,'owner-B')
    assert.notEqual(ownB.id,task.id)
    assert.deepEqual((await asUser('owner',()=>call('workhub_task_list',['owner-B']))).map(t=>t.id),[ownB.id])
  })
  await ck('직접 SELECT의 RLS도 본인 현재 소속 자료만 허용',async()=>{
    assert.ok((await asUser('owner',()=>db.query('SELECT * FROM public.workhub_personal_tasks'))).rows.some(row=>row.id===task.id))
    for(const name of ['teacher','manager','other'])assert.equal((await asUser(name,()=>db.query('SELECT * FROM public.workhub_personal_tasks'))).rows.length,0)
  })
  await ck('직접 INSERT·UPDATE·DELETE 및 receipt·감사·sequence 접근 차단',async()=>{
    for(const sql of [
      "INSERT INTO public.workhub_personal_tasks(school_id,owner_member_id,title) VALUES('A','owner','우회')",
      "UPDATE public.workhub_personal_tasks SET title='우회' WHERE owner_member_id='owner'",
      "DELETE FROM public.workhub_personal_tasks WHERE owner_member_id='owner'",
      'SELECT * FROM public.workhub_task_receipts','SELECT * FROM public.workhub_task_audit',
      "SELECT nextval('public.workhub_task_audit_id_seq')",
    ])await assert.rejects(()=>asUser('owner',()=>db.query(sql)),/permission denied/)
  })
  await ck('미승인 회원은 활성 소속이 있어도 개인 업무 RPC 거부',async()=>{
    await rejected(()=>asUser('pending',()=>call('workhub_task_list',['pending'])),'FORBIDDEN')
    await rejected(()=>mutate('pending','pending',create,'pending'),'FORBIDDEN')
  })
  await ck('소속 종료 시 조회·이전 receipt·직접 SELECT 모두 차단',async()=>{
    await db.exec("UPDATE public.workhub_memberships SET active=false WHERE id='owner'")
    try{
      await rejected(()=>asUser('owner',()=>call('workhub_task_list',['owner'])),'INACTIVE_MEMBERSHIP')
      await rejected(()=>get('owner','owner',task.id),'INACTIVE_MEMBERSHIP')
      await rejected(()=>own(create,'create'),'INACTIVE_MEMBERSHIP')
      assert.equal((await asUser('owner',()=>db.query("SELECT * FROM public.workhub_personal_tasks WHERE school_id='A'"))).rows.length,0)
    }finally{await db.exec("UPDATE public.workhub_memberships SET active=true WHERE id='owner'")}
  })
  await ck('가입 승인 철회 시 이전 receipt·직접 SELECT도 차단',async()=>{
    await db.query('UPDATE public.users SET is_active=false WHERE id=$1',[ids.owner])
    try{
      await rejected(()=>own(create,'create'),'FORBIDDEN')
      await rejected(()=>get('owner','owner',task.id),'FORBIDDEN')
      assert.equal((await asUser('owner',()=>db.query('SELECT * FROM public.workhub_personal_tasks'))).rows.length,0)
    }finally{await db.query('UPDATE public.users SET is_active=true WHERE id=$1',[ids.owner])}
  })
  await ck('receipt 기록 실패 시 생성·수정·상태·감사 모두 롤백',async()=>{
    await db.exec("CREATE FUNCTION public.task_test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_RECEIPT_ROLLBACK'; END $$; CREATE TRIGGER task_test_fail_receipt BEFORE INSERT ON public.workhub_task_receipts FOR EACH ROW EXECUTE FUNCTION public.task_test_fail_receipt()")
    try{
      for(const command of [create,{kind:'update',taskId:task.id,input,expectedVersion:current.version},{kind:'status',taskId:task.id,status:'done',expectedVersion:current.version}]){
        const before=await allRows()
        await rejected(()=>own(command,'forced-receipt-failure'),'TEST_RECEIPT_ROLLBACK')
        assert.deepEqual(await allRows(),before)
      }
    }finally{await db.exec('DROP TRIGGER task_test_fail_receipt ON public.workhub_task_receipts; DROP FUNCTION public.task_test_fail_receipt()')}
  })
  await ck('감사 기록 실패 시 업무와 receipt 모두 롤백',async()=>{
    const before=await allRows()
    await db.exec("CREATE FUNCTION public.task_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_AUDIT_ROLLBACK'; END $$; CREATE TRIGGER task_test_fail_audit BEFORE INSERT ON public.workhub_task_audit FOR EACH ROW EXECUTE FUNCTION public.task_test_fail_audit()")
    try{await rejected(()=>own(create,'forced-audit-failure'),'TEST_AUDIT_ROLLBACK');assert.deepEqual(await allRows(),before)}
    finally{await db.exec('DROP TRIGGER task_test_fail_audit ON public.workhub_task_audit; DROP FUNCTION public.task_test_fail_audit()')}
  })
  await ck('업무 버전·receipt·감사 소유자 연결과 수가 일치',async()=>{
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_personal_tasks t WHERE t.version<>(SELECT count(*) FROM public.workhub_task_audit a WHERE a.task_id=t.id) OR t.version<>(SELECT count(*) FROM public.workhub_task_receipts r WHERE r.task_id=t.id)'),0)
    assert.equal(await value("SELECT count(*)::int AS value FROM public.workhub_task_receipts r WHERE NOT EXISTS (SELECT 1 FROM public.workhub_task_audit a WHERE a.task_id=r.task_id AND a.school_id=r.school_id AND a.actor_member_id=r.member_id AND a.task_version=(r.result->>'version')::int)"),0)
  })
  await ck('기존 일정 RPC 권한·동작은 개인 업무 추가 후에도 유지',async()=>{
    const date=await value('SELECT public.workhub_today()::text AS value')
    const draft={title:'기존 일정 회귀',description:'',location:'',startDate:date,endDate:date,allDay:true,startTime:'',endTime:'',visibility:'private',audience:{all:true,groups:[],includeMemberIds:[],excludeMemberIds:[]}}
    const event=await asUser('owner',()=>call('workhub_calendar_save',['owner',{idempotencyKey:'calendar-unaffected',draft}]))
    assert.equal(event.version,1)
    assert.deepEqual(await asUser('owner',()=>call('workhub_calendar_get',['owner',event.id])),event)
    await rejected(()=>asUser('manager',()=>call('workhub_calendar_get',['manager',event.id])),'NOT_FOUND')
  })

  await ck('실제 adapter와 SQL 왕복에서 Unicode·상태·충돌·재시도 계약 일치',async()=>{
    const built=buildSync({stdin:{contents:"export * from './apps/workhub/src/connection/supabase-connection.ts'; export * from './apps/workhub/src/tasks/supabase-task-adapter.ts'",resolveDir:ROOT,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify({})},logLevel:'silent'})
    const {createSupabaseConnection,createSupabaseTaskAdapter}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
    const services={
      getSession:async()=>({user:{id:ids.owner}}),
      fetchMyProfile:async()=>(await db.query('SELECT * FROM public.users WHERE id=$1',[ids.owner])).rows[0],
      onAuthStateChange:()=>()=>{},signInWithGoogle:async()=>{},signOut:async()=>{},
      rpc:async(name,args={})=>{
        const params={workhub_context:[],workhub_task_list:[args.p_member_id],workhub_task_get:[args.p_member_id,args.p_task_id],workhub_task_mutate:[args.p_member_id,args.p_command,args.p_request_key]}[name]
        assert.ok(params,'시험 transport는 합의한 RPC만 허용합니다.')
        try{return{data:await asUser('owner',()=>call(name,params)),error:null}}
        catch(error){return{data:null,error:{message:error.message,details:error.detail,code:error.code}}}
      }
    }
    const connection=createSupabaseConnection(services);await connection.loadContext('A')
    const adapter=createSupabaseTaskAdapter(connection)
    const input={title:'😀'.repeat(120),notes:'\t 합성 왕복 메모 \u3000',dueDate:'2028-02-29'}
    const created=await adapter.create('owner',input,'adapter-create')
    assert.equal(created.notes,'합성 왕복 메모');assert.equal(created.status,'todo')
    const updated=await adapter.update('owner',created.id,{title:'왕복 수정',notes:'메모 수정',dueDate:''},created.version,'adapter-update')
    const completed=await adapter.setStatus('owner',created.id,'done',updated.version,'adapter-status')
    assert.deepEqual(await adapter.get('owner',created.id),completed)
    assert.deepEqual(await adapter.create('owner',input,'adapter-create'),created)
    assert.ok((await adapter.list('owner')).some(task=>task.id===created.id&&task.version===completed.version))
    await assert.rejects(()=>adapter.setStatus('owner',created.id,'waiting',1,'adapter-stale'),error=>{
      assert.equal(error.code,'CONFLICT');assert.deepEqual(error.current,completed);return true
    })
  })

}finally{await db.close()}
console.log('\n개인 업무 DB 계약 '+(checks-failures)+'/'+checks+' 통과')
if(failures)process.exit(1)
