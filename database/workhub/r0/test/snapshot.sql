-- public·auth·storage 상태 지문 (workhub_* 함수 제외)
-- 범위: 구조(표·열·제약·함수·사용자 트리거·정책·권한) + 회원·Auth·제출·Storage 목록(buckets·objects)의 행 수·행 해시.
-- 범위 밖: Storage 파일 본문 바이트(DB 밖 저장소), PostgreSQL 내부 트리거.
\pset format unaligned
\pset tuples_only on
select 'rel', n.nspname, c.relname, c.relkind, c.relrowsecurity, coalesce(array_to_string(c.relacl,','),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') order by 2,3;
select 'col', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default,'')
  from information_schema.columns where table_schema in ('public','auth','storage') order by 2,3,4;
select 'con', conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
  where connamespace in ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) order by 2,3;
select 'fn', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(array_to_string(p.proacl,','),''), p.prosecdef
  from pg_proc p where p.pronamespace in ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace)
   and p.proname not like 'workhub\_%' order by 2;
select 'trg', tgrelid::regclass::text, tgname, tgenabled, md5(pg_get_triggerdef(oid)) from pg_trigger
  where not tgisinternal and tgrelid in (select c.oid from pg_class c where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace)) order by 2,3;
select 'pol', schemaname, tablename, policyname, cmd, array_to_string(roles,','), coalesce(qual,''), coalesce(with_check,'')
  from pg_policies where schemaname in ('public','auth','storage') order by 2,3,4;
select 'nsp', nspname, coalesce(array_to_string(nspacl,','),'') from pg_namespace where nspname in ('public','auth','storage','extensions');
select 'defacl', defaclrole::regrole, coalesce(defaclnamespace::regnamespace::text,''), defaclobjtype, array_to_string(defaclacl,',') from pg_default_acl order by 2,3,4;
select 'data', 'users', md5(string_agg(u::text, '|' order by u.id)) from public.users u;
select 'data', 'auth.users', md5(string_agg(a::text, '|' order by a.id)) from auth.users a;
-- 자료: 행 수와 행 전체 해시(값·경로가 하나라도 바뀌거나 행이 빠지면 달라진다). Storage 는 목록(메타데이터) 표만 본다.
select 'data', 'doc_submissions', count(*), md5(coalesce(string_agg(d::text, '|' order by d::text), '')) from public.doc_submissions d;
select 'data', 'storage.buckets', count(*), md5(coalesce(string_agg(b::text, '|' order by b.id), '')) from storage.buckets b;
select 'data', 'storage.objects', count(*), md5(coalesce(string_agg(o::text, '|' order by o.bucket_id, o.name, o.id), '')) from storage.objects o;
