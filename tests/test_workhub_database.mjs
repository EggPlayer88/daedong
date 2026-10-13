// 실제 PostgreSQL 엔진에서 원본 SQL과 신축 제안을 검증한다. 운영 DB에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { buildSync } from 'esbuild'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new PGlite()
let failures = 0
const ck = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name) } catch (e) { failures++; console.log('  ✗ ' + name + ': ' + e.message) } }
const ids = Object.fromEntries(['owner','manager','teacher','other','pending'].map((name,i)=>[name,'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]))
async function asUser(name, fn, role='authenticated') {
  await db.exec('SET ROLE '+role)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[ids[name]??''])
  try { return await fn() } finally { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub','',false)") }
}
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value
const call=(name,args=[]) => value('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)
const rejected=(fn,code) => assert.rejects(fn,e=>e.code===code||e.message===code)
try {
  await db.exec([
    "CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA storage;",
    "CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}'::jsonb);",
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
    "CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);",
    "CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
    "CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;",
    "GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;"
  ].join('\n'))
  for(const file of ['001_users_departments.sql','002_schedules_tasks.sql','003_signup_approval.sql','004_doc_ai_conversations.sql','005_doc_submissions.sql','006_calendar.sql','007_submission_delete.sql']) await db.exec(readFileSync(join(ROOT,'migrations',file),'utf8'))
  for(const [name,id] of Object.entries(ids)) await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name',$3::text))",[id,name+'@example.invalid',name])
  await db.exec("UPDATE public.users SET is_active=true,role=CASE WHEN name='owner' THEN 'superadmin' ELSE 'teacher' END WHERE name<>'pending'")
  await db.query("INSERT INTO public.doc_ai_conversations(user_id,messages) VALUES($1,'[]')",[ids.owner])
  await db.query("INSERT INTO public.doc_submissions(user_id,subject,grade,file_name,file_path) VALUES($1,'합성 교과',1,'fixture.hwpx',$2)",[ids.owner,ids.owner+'/fixture.hwpx'])
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('submissions',$1)",[ids.owner+'/fixture.hwpx'])
  const oldDocuments=await value("SELECT jsonb_build_object('conversations',(SELECT jsonb_agg(to_jsonb(c)) FROM public.doc_ai_conversations c),'submissions',(SELECT jsonb_agg(to_jsonb(s)) FROM public.doc_submissions s),'files',(SELECT jsonb_agg(to_jsonb(o)) FROM storage.objects o)) AS value")
  const oldUsers=await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u')
  const oldTrigger=await value("SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS value")
  const oldPolicies=await value("SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) AS value FROM pg_policies p WHERE schemaname='public'")
  await db.exec(readFileSync(join(ROOT,'database/workhub/001-calendar-foundation.proposed.sql'),'utf8'))
  await ck('추가 SQL 적용 후 기존 회원 식별자·승인·역할·프로필 전체 보존',async()=>assert.deepEqual(await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u'),oldUsers))
  await ck('기존 가입 트리거와 기존 RLS 정책 원문 보존',async()=>{
    assert.equal(await value("SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS value"),oldTrigger)
    assert.deepEqual(await value("SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) AS value FROM pg_policies p WHERE schemaname='public' AND tablename NOT LIKE 'workhub_%'"),oldPolicies)
  })
  await ck('기존 대화·제출·Storage 소유자 참조와 파일 경로 보존',async()=>{
    assert.deepEqual(await value("SELECT jsonb_build_object('conversations',(SELECT jsonb_agg(to_jsonb(c)) FROM public.doc_ai_conversations c),'submissions',(SELECT jsonb_agg(to_jsonb(s)) FROM public.doc_submissions s),'files',(SELECT jsonb_agg(to_jsonb(o)) FROM storage.objects o)) AS value"),oldDocuments)
  })
  await ck('회원 보존 dry-run은 실제 실행 후 회원 행을 변경하지 않음',async()=>{
    await db.exec(readFileSync(join(ROOT,'database/workhub/002-account-preservation-dry-run.sql'),'utf8'))
    assert.deepEqual(await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u'),oldUsers)
  })
  await ck('초기 연결 제안은 자리표시자 실행 시 쓰기 전에 중단',async()=>{
    await assert.rejects(()=>db.exec(readFileSync(join(ROOT,'database/workhub/003-bootstrap-school.proposed.sql'),'utf8')),/초기 연결 값을/)
    await db.exec('ROLLBACK')
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_schools'),0)
  })
  const today=await value('SELECT public.workhub_today()::text AS value')
  await db.exec("INSERT INTO public.workhub_schools(id,name) VALUES('A','가상 A학교'),('B','가상 B학교')")
  for(const [name,id] of Object.entries(ids)) await db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,role,active,valid_from,valid_through,department_ids,grade_ids,subject_ids) VALUES($1,$2,$3,$4,true,public.workhub_today()-1,public.workhub_today()+30,ARRAY['d1'],ARRAY['g1'],ARRAY['s1'])",[name,name==='other'?'B':'A',id,name==='manager'?'calendar_manager':'teacher'])
  await ck('기본 공개 범위는 승인된 기존 superadmin만 허용',async()=>{
    assert.equal((await asUser('owner',()=>call('workhub_context'))).schools.length,1)
    await rejected(()=>asUser('teacher',()=>call('workhub_context')),'FORBIDDEN')
    assert.equal((await asUser('teacher',()=>db.query('SELECT * FROM public.workhub_schools'))).rows.length,0)
  })
  await ck('익명 RPC 실행 거부',async()=>assert.rejects(()=>asUser('',()=>call('workhub_context'),'anon'),/permission denied/))
  // 아래 확대 모드는 임시 DB의 시험 조건일 뿐 운영 설정 변경이 아니다.
  await db.exec("UPDATE public.workhub_settings SET rollout_mode='members'")
  await ck('context는 현재 학교 roster만 제공하고 이메일 제외',async()=>{
    const c=await asUser('teacher',()=>call('workhub_context'))
    assert.deepEqual(c.schools.map(x=>x.id),['A']); assert.ok(c.memberships.every(x=>x.schoolId==='A'&&!('email' in x))); assert.equal(c.basisDate,today)
  })
  await ck('미승인 계정은 active 소속으로도 서버 진입 불가',async()=>rejected(()=>asUser('pending',()=>call('workhub_context')),'FORBIDDEN'))
  await ck('타인의 소속 ID 위장 거부',async()=>rejected(()=>asUser('teacher',()=>call('workhub_calendar_list',['owner'])),'INACTIVE_MEMBERSHIP'))
  const audience={all:true,groups:[],includeMemberIds:[],excludeMemberIds:[]}
  const draft={title:'검증 일정',description:'',location:'',startDate:today,endDate:today,allDay:true,startTime:'',endTime:'',visibility:'school',audience}
  const create=(name,key,d=draft)=>asUser(name,()=>call('workhub_calendar_save',[name,{idempotencyKey:key,draft:d}]))
  let event
  await ck('일정·멱등 접수·감사 기록 동시 저장',async()=>{
    event=await create('owner','first'); assert.equal(event.schoolId,'A'); assert.equal(event.authorMemberId,'owner'); assert.equal(event.version,1)
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_calendar_receipts'),1)
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_calendar_audit'),1)
  })
  await ck('동일 요청 재시도는 같은 결과·감사 중복 없음',async()=>{
    assert.deepEqual(await create('owner','first'),event);assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_calendar_audit'),1)
  })
  await ck('같은 멱등 키의 다른 입력 거부',async()=>rejected(()=>create('owner','first',{...draft,title:'다름'}),'IDEMPOTENCY_CONFLICT'))
  await ck('타학교 목록·개별조회·직접 SELECT 차단',async()=>{
    assert.deepEqual(await asUser('other',()=>call('workhub_calendar_list',['other'])),[])
    await rejected(()=>asUser('other',()=>call('workhub_calendar_get',['other',event.id])),'NOT_FOUND')
    assert.equal((await asUser('other',()=>db.query('SELECT * FROM public.workhub_calendar_events'))).rows.length,0)
  })
  await ck('직접 UPDATE 및 receipt·audit 열람 차단',async()=>{
    await assert.rejects(()=>asUser('owner',()=>db.query('UPDATE public.workhub_calendar_events SET version=2 WHERE id=$1',[event.id])),/permission denied/)
    await assert.rejects(()=>asUser('owner',()=>db.query('SELECT * FROM public.workhub_calendar_receipts')),/permission denied/)
    await assert.rejects(()=>asUser('owner',()=>db.query('SELECT * FROM public.workhub_calendar_audit')),/permission denied/)
  })
  await ck('일반 교사의 타인 일정 수정 거부',async()=>rejected(()=>asUser('teacher',()=>call('workhub_calendar_save',['teacher',{id:event.id,expectedVersion:1,idempotencyKey:'deny',draft}])),'FORBIDDEN'))
  let command
  await ck('담당자 수정과 낡은 버전 충돌 검사',async()=>{
    command={id:event.id,expectedVersion:1,idempotencyKey:'manager-edit',draft:{...draft,title:'담당자 수정'}}
    assert.equal((await asUser('manager',()=>call('workhub_calendar_save',['manager',command]))).version,2)
    await rejected(()=>asUser('owner',()=>call('workhub_calendar_save',['owner',{id:event.id,expectedVersion:1,idempotencyKey:'stale',draft}])),'CONFLICT')
  })
  await ck('담당자가 타인 일정을 private으로 변경할 수 없음',async()=>rejected(()=>asUser('manager',()=>call('workhub_calendar_save',['manager',{id:event.id,expectedVersion:2,idempotencyKey:'private-attempt',draft:{...draft,visibility:'private'}}])),'FORBIDDEN'))
  await asUser('owner',()=>call('workhub_calendar_save',['owner',{id:event.id,expectedVersion:2,idempotencyKey:'private',draft:{...draft,visibility:'private'}}]))
  await ck('private은 관리자 역할로도 열람 불가',async()=>{
    await rejected(()=>asUser('manager',()=>call('workhub_calendar_get',['manager',event.id])),'NOT_FOUND')
    assert.equal((await asUser('manager',()=>db.query('SELECT * FROM public.workhub_calendar_events'))).rows.length,0)
    assert.equal((await asUser('owner',()=>call('workhub_calendar_get',['owner',event.id]))).version,3)
  })
  await ck('성공 receipt 재반환 시 현재 열람권한 재검사',async()=>rejected(()=>asUser('manager',()=>call('workhub_calendar_save',['manager',command])),'NOT_FOUND'))
  await ck('그룹 내 AND·그룹 간 OR·명시 제외 우선',async()=>{
    const e1=await create('owner','and',{...draft,visibility:'audience',audience:{...audience,all:false,groups:[{departmentIds:['d1'],gradeIds:['wrong'],subjectIds:[]}]}})
    await rejected(()=>asUser('teacher',()=>call('workhub_calendar_get',['teacher',e1.id])),'NOT_FOUND')
    const e2=await create('owner','or',{...draft,visibility:'audience',audience:{...audience,all:false,groups:[{departmentIds:['wrong'],gradeIds:[],subjectIds:[]},{departmentIds:[],gradeIds:['g1'],subjectIds:[]}]}})
    assert.equal((await asUser('teacher',()=>call('workhub_calendar_get',['teacher',e2.id]))).id,e2.id)
    const e3=await create('owner','exclude',{...draft,visibility:'audience',audience:{...audience,includeMemberIds:['teacher'],excludeMemberIds:['teacher']}})
    await rejected(()=>asUser('teacher',()=>call('workhub_calendar_get',['teacher',e3.id])),'NOT_FOUND')
  })
  await ck('타학교 대상·깨진 배열·틀린 날짜와 시간 입력 거부',async()=>{
    for(const bad of [{...draft,audience:{...audience,includeMemberIds:['other']}},{...draft,audience:{...audience,groups:[null]}},{...draft,startDate:'2026-02-30'},{...draft,allDay:false,startTime:'25:00',endTime:'26:00'}]) await rejected(()=>create('owner','bad',bad),'INVALID_INPUT')
  })
  await ck('소속 종료 후 조회·저장·이전 receipt 모두 차단',async()=>{
    await db.exec("UPDATE public.workhub_memberships SET active=false WHERE id='owner'")
    await rejected(()=>asUser('owner',()=>call('workhub_calendar_list',['owner'])),'INACTIVE_MEMBERSHIP')
    await rejected(()=>create('owner','first'),'INACTIVE_MEMBERSHIP')
    assert.equal((await asUser('owner',()=>db.query('SELECT * FROM public.workhub_calendar_events'))).rows.length,0)
    await db.exec("UPDATE public.workhub_memberships SET active=true WHERE id='owner'")
  })
  await ck('receipt 실패 시 업무 저장도 함께 롤백',async()=>{
    const before=await value('SELECT count(*)::int AS value FROM public.workhub_calendar_events')
    await db.exec("CREATE FUNCTION public.workhub_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ROLLBACK'; END $$; CREATE TRIGGER test_fail_receipt BEFORE INSERT ON public.workhub_calendar_receipts FOR EACH ROW EXECUTE FUNCTION public.workhub_test_fail()")
    await rejected(()=>create('owner','rollback'),'TEST_ROLLBACK')
    assert.equal(await value('SELECT count(*)::int AS value FROM public.workhub_calendar_events'),before)
    await db.exec('DROP TRIGGER test_fail_receipt ON public.workhub_calendar_receipts; DROP FUNCTION public.workhub_test_fail()')
  })
  await ck('기존 가입 트리거는 계속 신규 회원을 teacher·승인 대기로 생성',async()=>{
    await db.exec("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-000000000099','new@example.invalid','{\"name\":\"new\"}')")
    assert.deepEqual((await db.query("SELECT role,is_active FROM public.users WHERE id='00000000-0000-4000-8000-000000000099'")).rows[0],{role:'teacher',is_active:false})
  })
  const built=buildSync({stdin:{contents:"export * from './apps/workhub/src/connection/supabase-connection.ts'; export * from './apps/workhub/src/connection/supabase-calendar.ts'; export * from './apps/workhub/src/connection/validation.ts'",resolveDir:ROOT,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify({})},logLevel:'silent'})
  const {createSupabaseConnection,createSupabaseCalendarAdapter,contextResponse,eventResponse}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
  await ck('연결은 기존 세션·프로필 재사용하며 true만 승인',async()=>{
    let calls=0,active=false
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:active}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:()=>()=>{},rpc:async()=>{calls++;return{data:[],error:null}}}
    const connection=createSupabaseConnection(services)
    await rejected(()=>connection.loadContext(),'FORBIDDEN');assert.equal(calls,0)
    active=true;assert.deepEqual(await createSupabaseCalendarAdapter(connection).list('owner'),[]);assert.equal(calls,1)
  })
  await ck('계정 변경 뒤 늦게 도착한 RPC 결과 취소',async()=>{
    let listener,resolveRequest
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:callback=>(listener=callback,()=>{}),rpc:async()=>new Promise(resolve=>{resolveRequest=resolve})}
    const connection=createSupabaseConnection(services),off=connection.subscribeIdentity(()=>{})
    const pending=connection.rpcVerified('workhub_context')
    while(!resolveRequest) await new Promise(resolve=>setTimeout(resolve,0))
    listener(null);resolveRequest({data:{schools:[]},error:null})
    await rejected(()=>pending,'CANCELLED');off()
  })

  await ck('서버에 저장한 비BMP 제목도 같은 길이 계약으로 목록 수신',async()=>{
    const saved=await create('owner','unicode',{...draft,title:'😀'.repeat(60)})
    const context=contextResponse(await asUser('owner',()=>call('workhub_context')))
    assert.equal(eventResponse(saved,'A',context.memberships).title,saved.title)
    const rows=await asUser('owner',()=>call('workhub_calendar_list',['owner']))
    assert.ok(rows.map(row=>eventResponse(row,'A',context.memberships)).some(row=>row.id===saved.id))
  })
  await ck('깨진 라벨·교차 학교 roster·날짜·일정 응답은 명시적 실패',async()=>{
    const context=await asUser('owner',()=>call('workhub_context'))
    for(const broken of [
      {...context,schoolLabels:{A:{departmentIds:null,gradeIds:[],subjectIds:[]}}},
      {...context,memberships:[{...context.memberships[0],schoolId:'B'}]},
      {...context,basisDate:'2026-02-30'},
    ]) assert.throws(()=>contextResponse(broken),error=>error.code==='QUERY_FAILED')
    for(const broken of [{...event,schoolId:'B'},{...event,audience:{all:true,groups:null}},{...event,version:'1'}]) assert.throws(()=>eventResponse(broken,'A',context.memberships),error=>error.code==='QUERY_FAILED')
  })
  await ck('승인 취소 회원은 대상 roster에서도 active=false',async()=>{
    const context=await asUser('owner',()=>call('workhub_context'))
    assert.equal(context.memberships.find(member=>member.id==='pending').active,false)
  })
  await ck('같은 학교·회원의 활성 소속 기간 중첩 INSERT·UPDATE 거부',async()=>{
    await rejected(()=>db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,active,valid_from,valid_through) VALUES('overlap','A',$1,true,public.workhub_today(),public.workhub_today()+10)",[ids.owner]),'OVERLAPPING_MEMBERSHIP')
    await db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,active,valid_from,valid_through) VALUES('future','A',$1,true,public.workhub_today()+31,public.workhub_today()+60)",[ids.owner])
    await rejected(()=>db.exec("UPDATE public.workhub_memberships SET valid_from=public.workhub_today()+30 WHERE id='future'"),'OVERLAPPING_MEMBERSHIP')
    await db.query("INSERT INTO public.workhub_memberships(id,school_id,user_id,active,valid_from,valid_through) VALUES('inactive-overlap','A',$1,false,public.workhub_today()+1,public.workhub_today()+10)",[ids.owner])
    await rejected(()=>db.exec("UPDATE public.workhub_memberships SET active=true WHERE id='inactive-overlap'"),'OVERLAPPING_MEMBERSHIP')
    await rejected(()=>db.query("UPDATE public.workhub_memberships SET user_id=$1 WHERE id='owner'",[ids.manager]),'IMMUTABLE_MEMBERSHIP_IDENTITY')
  })
  await ck('서버 요청 한도를 넘는 대상 배열은 거부',async()=>{
    await rejected(()=>create('owner','too-many',{...draft,audience:{...audience,groups:Array.from({length:51},()=>({departmentIds:[],gradeIds:[],subjectIds:[]}))}}),'INVALID_INPUT')
  })
  await ck('auth 이벤트 직후 폐기 통지, 프로필 조회 실패도 구독자에게 전달',async()=>{
    let listener,fail=false
    const notifications=[],invalidations=[]
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>{if(fail)throw new Error('합성 조회 실패');return{id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}},signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:callback=>(listener=callback,()=>{}),rpc:async()=>({data:await asUser('owner',()=>call('workhub_context')),error:null})}
    const connection=createSupabaseConnection(services)
    await connection.loadContext()
    const offInvalid=connection.subscribeInvalidation(error=>invalidations.push(error.code))
    const off=connection.subscribeIdentity((identity,error)=>notifications.push({identity,error}))
    while(!listener)await new Promise(resolve=>setTimeout(resolve,0))
    fail=true;listener(null)
    assert.deepEqual(connection.info().schools,[]);assert.equal(invalidations[0],'CANCELLED')
    for(let attempt=0;attempt<50&&!notifications.length;attempt++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(notifications.length,1);assert.equal(notifications[0].error.code,'QUERY_FAILED')
    off();offInvalid()
  })
  await ck('서버가 소속 종료를 반환하면 화면 폐기 구독자에게 즉시 통지',async()=>{
    const invalidations=[]
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:()=>()=>{},rpc:async()=>({data:null,error:{message:'INACTIVE_MEMBERSHIP'}})}
    const connection=createSupabaseConnection(services),off=connection.subscribeInvalidation(error=>invalidations.push(error.code))
    await rejected(()=>connection.rpcVerified('workhub_calendar_list',{p_member_id:'owner'}),'INACTIVE_MEMBERSHIP')
    assert.deepEqual(invalidations,['INACTIVE_MEMBERSHIP']);off()
  })


  await ck('동일 UID 토큰 갱신은 캐시를 유지하고 승인 재검증 후 성공 통지',async()=>{
    let listener
    const notices=[],invalidations=[]
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:callback=>(listener=callback,()=>{}),rpc:async()=>({data:await asUser('owner',()=>call('workhub_context')),error:null})}
    const connection=createSupabaseConnection(services);await connection.loadContext()
    const offInvalid=connection.subscribeInvalidation(error=>invalidations.push(error))
    const off=connection.subscribeIdentity(identity=>notices.push(identity))
    while(!listener)await new Promise(resolve=>setTimeout(resolve,0))
    listener({user:{id:ids.owner}})
    assert.equal(connection.info().schools[0].id,'A')
    for(let attempt=0;attempt<50&&!notices.length;attempt++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(notices.length,1);assert.equal(invalidations.length,0);assert.equal(notices[0].approved,true)
    off();offInvalid()
  })
  await ck('이전 세대의 늦은 context 실패는 새 context를 지우지 않음',async()=>{
    let listener,late
    let requests=0
    const current=await asUser('owner',()=>call('workhub_context'))
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:callback=>(listener=callback,()=>{}),rpc:async()=>++requests===1?new Promise(resolve=>{late=resolve}):{data:current,error:null}}
    const connection=createSupabaseConnection(services),off=connection.subscribeIdentity(()=>{})
    const pending=connection.loadContext()
    while(!late)await new Promise(resolve=>setTimeout(resolve,0))
    listener({user:{id:ids.owner}})
    await connection.loadContext()
    late({data:current,error:null})
    await rejected(()=>pending,'CANCELLED')
    assert.equal(connection.info().schools[0].id,'A');off()
  })


  await ck('동일 UID 토큰 갱신 후 승인 취소가 확인되면 캐시를 폐기',async()=>{
    let listener,active=true
    const notices=[],invalidations=[]
    const services={getSession:async()=>({user:{id:ids.owner}}),fetchMyProfile:async()=>({id:ids.owner,name:'owner',email:'owner@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:active}),signInWithGoogle:async()=>{},signOut:async()=>{},onAuthStateChange:callback=>(listener=callback,()=>{}),rpc:async()=>({data:await asUser('owner',()=>call('workhub_context')),error:null})}
    const connection=createSupabaseConnection(services);await connection.loadContext()
    const offInvalid=connection.subscribeInvalidation(error=>invalidations.push(error.code))
    const off=connection.subscribeIdentity(identity=>notices.push(identity))
    while(!listener)await new Promise(resolve=>setTimeout(resolve,0))
    active=false;listener({user:{id:ids.owner}})
    assert.equal(connection.info().schools[0].id,'A')
    for(let attempt=0;attempt<50&&!notices.length;attempt++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(notices.length,1);assert.equal(notices[0].approved,false)
    assert.deepEqual(connection.info().schools,[]);assert.equal(invalidations.length,1)
    off();offInvalid()
  })
  await ck('확정 값을 채운 초기 소속 연결은 기존 회원 보존·재실행 중복 없음',async()=>{
    const before=await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u')
    const sql=readFileSync(join(ROOT,'database/workhub/003-bootstrap-school.proposed.sql'),'utf8')
      .replace('<기존 public.users.id>',ids.owner).replace('<확정 학교 식별자>','bootstrap').replace('<확정 학교명>','합성 초기 학교')
      .replace('v_valid_from date := NULL','v_valid_from date := CURRENT_DATE').replace('v_valid_through date := NULL','v_valid_through date := CURRENT_DATE+30')
    await db.exec(sql);await db.exec(sql)
    assert.equal(await value("SELECT count(*)::int AS value FROM public.workhub_memberships WHERE school_id='bootstrap'"),1)
    assert.deepEqual(await value('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) AS value FROM public.users u'),before)
    await assert.rejects(()=>db.exec(sql.replace('CURRENT_DATE+30','CURRENT_DATE+60')),/기존 소속과 초기 연결이 다릅니다/)
    await db.exec('ROLLBACK')
    assert.equal(await value("SELECT (valid_through=CURRENT_DATE+30) AS value FROM public.workhub_memberships WHERE school_id='bootstrap'"),true)
  })

} finally { await db.close() }
if(failures) process.exit(1)
