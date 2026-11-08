import {PGlite} from '@electric-sql/pglite'
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist'
import {readFileSync} from 'node:fs'
const root=new URL('../../',import.meta.url)
const sql=p=>readFileSync(new URL(p,root),'utf8')
export async function neisDatabase(){
 const db=new PGlite({extensions:{btree_gist}})
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 `)
 for(const p of ['001_users_departments.sql','002_schedules_tasks.sql','003_signup_approval.sql','004_doc_ai_conversations.sql','005_doc_submissions.sql','006_calendar.sql','007_submission_delete.sql'])await db.exec(sql('migrations/'+p))
 const uid='00000000-0000-4000-8000-000000000001'
 await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data)VALUES($1,'neis@example.invalid','{\"name\":\"시험 관리자\"}')",[uid])
 await db.exec("UPDATE public.users SET role='superadmin',is_active=true")
 await db.exec(sql('database/workhub/r0/R0-01_B01_기반.sql'))
 await db.exec(sql('database/workhub/r0/R0-02_B02_일정업무.sql'))
 const year=new Date().getUTCFullYear()
 const data={admin_user_id:uid,approval_ref:'격리 DB 합성 시험',school_code:'neis-test',school_name:'나이스 시험 학교',school_level:'middle',grade_count:3,timezone:'Asia/Seoul',school_year:year,year_first_day:year+'-03-01',year_last_day:(year+1)+'-02-28',terms:[{term_no:1,label:'1학기',first_day:year+'-03-01',last_day:year+'-08-15'},{term_no:2,label:'2학기',first_day:year+'-08-16',last_day:(year+1)+'-02-28'}]}
 await db.query('SELECT workhub_private.bootstrap_first_school($1::jsonb)',[JSON.stringify(data)])
 // 실제 P2 원문의 공통 exact 함수만 가져온다. N1은 P2 표·쓰기 함수에 의존하지 않는다.
 const p2=sql('database/workhub/p2/P2-01_일정일괄_협업_모델.sql')
 const exact=p2.match(/CREATE(?: OR REPLACE)? FUNCTION workhub_private.p2_exact\([\s\S]*?\$\$;/i)
 if(!exact)throw Error('P2 exact 원문을 찾지 못했습니다.')
 await db.exec(exact[0])
 const member=(await db.query('SELECT id,school_id,account_id FROM workhub.memberships')).rows[0]
 const before=(await db.query("SELECT md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)) hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('workhub_private','public')")).rows[0].hash
 await db.exec(sql('database/workhub-neis/n1/N1-01_나이스연결_모델과함수.sql'))
 const value=async(name,args=[]) => (await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value
 const as=async(role,fn)=>{await db.exec('SET ROLE '+role);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);try{return await fn()}finally{await db.exec('RESET ROLE')}}
 await db.query("INSERT INTO neis_private.connections(school_id,office_code,school_code,school_name,active)VALUES($1,'K10','7892043','나이스 시험 학교',true)",[member.school_id])
 return{db,uid,year,member,before,value,as,sql}
}
