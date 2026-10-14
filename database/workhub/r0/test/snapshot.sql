-- public·auth·storage 상태 지문 (workhub_* 함수 제외)
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
select 'data', 'doc_submissions', count(*) from public.doc_submissions;
