-- R1 시험용 Storage 흉내 보강(운영과 무관). 현재 Supabase storage.objects 의 열 일부와 (bucket_id,name) 유일성을 맞춘다.
-- 실제 Storage API(업로드·내려받기 HTTP)는 흉내 내지 않는다 → 시험 결과에 '미실행'으로 따로 적는다.
alter table storage.objects add column owner_id text, add column version text, add column updated_at timestamptz default now();
alter table storage.objects add constraint objects_bucket_name_key unique (bucket_id, name);
alter table storage.buckets add column file_size_limit bigint, add column allowed_mime_types text[];
-- Supabase Storage tenant migration 0024 와 같은 함수. Storage 서버는 요청마다 set_config('storage.operation', '<종류>', true) 를 한다.
create or replace function storage.operation() returns text language plpgsql stable as $$
begin
  return current_setting('storage.operation', true);
end $$;
