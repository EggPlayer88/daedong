-- 시험용 Supabase 흉내 (운영과 무관). superuser = supabase_admin 으로 실행.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin noinherit createrole login;
create role supabase_storage_admin noinherit createrole login;
create role postgres login createrole createdb bypassrls;
grant anon, authenticated, service_role to postgres with admin option;
grant all on database r0 to postgres;
grant create on schema public to postgres;
alter schema public owner to postgres;
create schema auth authorization supabase_auth_admin;
create schema storage authorization supabase_storage_admin;
create schema extensions; grant usage on schema extensions to postgres, anon, authenticated, service_role;
grant create on schema extensions to postgres;
grant usage on schema auth to postgres, anon, authenticated, service_role;
grant usage on schema storage to postgres, anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
alter table auth.users owner to supabase_auth_admin;
grant select, references, trigger on auth.users to postgres;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
alter function auth.uid() owner to supabase_auth_admin; alter function auth.role() owner to supabase_auth_admin;
grant execute on function auth.uid(), auth.role() to postgres, anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres; -- 정책 생성 허용(흉내)
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to postgres, anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant execute on function storage.foldername(text) to postgres, anon, authenticated, service_role;
create schema supabase_migrations authorization postgres;
create table supabase_migrations.schema_migrations (version text primary key); alter table supabase_migrations.schema_migrations owner to postgres;
-- Supabase 기본 권한: postgres 가 public 에 만드는 객체는 API 역할에 자동 부여
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- 확장은 superuser 로 미리 허용 (Supabase 는 postgres 가 extensions 에 설치 가능)
create extension pgcrypto with schema extensions;
